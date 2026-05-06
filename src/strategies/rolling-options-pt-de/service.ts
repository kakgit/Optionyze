import crypto from "node:crypto";
import { RunnerManager } from "../../runners/runner-manager";
import {
    listRollingOptionsPtDeClosedPositions,
    listRollingOptionsPtDeOpenPositions,
    saveRollingOptionsPtDePosition,
    type RollingOptionsPtDePositionRecord
} from "../../storage/rolling-options-pt-de-position-store";
import { loadRollingOptionsPtDeProfile } from "../../storage/rolling-options-pt-de-profile-store";
import {
    listRollingOptionsPtDeRuntime,
    saveRollingOptionsPtDeRuntime,
    type RollingOptionsPtDeRuntimeRecord
} from "../../storage/rolling-options-pt-de-runtime-store";
import {
    buildConfigFromUiState,
    estimatePositionCharges,
    getOpenPositionsSummary,
    getPositionPnl,
    shouldTriggerOption,
    updateRenkoState
} from "./engine";
import { logRollingOptionsPtDeEvent } from "./event-logger";
import {
    ensureLiveTickerSymbols,
    findBestLiveOptionContract,
    getLiveMarketSnapshot,
    getLiveOptionTicker
} from "./market-data";
import { applyClosedOptionPnlToProfile } from "./options-pnl";
import type {
    RollingOptionsPtDeConfig,
    RollingOptionsPtDeEngineState,
    RollingOptionsPtDeMarketSnapshot
} from "./types";

export class RollingOptionsPtDeService {
    private readonly stateByUserId = new Map<string, RollingOptionsPtDeEngineState>();

    public constructor(private readonly runnerManager: RunnerManager) {}

    private createInitialState(pUserId: string): RollingOptionsPtDeEngineState {
        return {
            userId: pUserId,
            running: false,
            isBusy: false,
            timerRef: null,
            cycleCount: 0,
            consecutiveFailures: 0,
            lastError: "",
            lastCycleAt: null,
            renko: {
                anchor: null,
                lastDir: 0,
                lastColor: ""
            },
            market: {
                lastSpotPrice: null,
                lastFuturesPrice: null,
                lastSource: "simulated"
            }
        };
    }

    private getOrCreateState(pUserId: string): RollingOptionsPtDeEngineState {
        const vUserId = String(pUserId || "").trim() || "demo-paper";
        let objState = this.stateByUserId.get(vUserId);
        if (!objState) {
            objState = this.createInitialState(vUserId);
            this.stateByUserId.set(vUserId, objState);
        }
        return objState;
    }

    public async hydrate(): Promise<void> {
        const objRuntimeRows = await listRollingOptionsPtDeRuntime();
        for (const objRuntime of objRuntimeRows) {
            if (!objRuntime.autoTraderEnabled || objRuntime.status !== "running") {
                continue;
            }

            const objState = this.getOrCreateState(objRuntime.userId);
            objState.running = true;
            objState.cycleCount = Number((objRuntime.state?.cycleCount as number) || 0);
            objState.consecutiveFailures = Number((objRuntime.state?.consecutiveFailures as number) || 0);
            objState.lastError = String(objRuntime.lastError || "");
            objState.lastCycleAt = objRuntime.lastCycleAt || null;
            objState.renko.anchor = Number.isFinite(Number(objRuntime.state?.renkoAnchor))
                ? Number(objRuntime.state?.renkoAnchor)
                : null;
            objState.renko.lastDir = Number(objRuntime.state?.renkoLastDir || 0) as -1 | 0 | 1;
            objState.renko.lastColor = String(objRuntime.state?.renkoLastColor || "") as "" | "R" | "G";
            objState.market.lastSpotPrice = objRuntime.lastSpotPrice;
            objState.market.lastFuturesPrice = objRuntime.lastFuturesPrice;
            objState.market.lastSource = String(objRuntime.state?.marketSource || "simulated") === "public" ? "public" : "simulated";
            this.armTimer(objState);
        }
    }

    private armTimer(pState: RollingOptionsPtDeEngineState, pLoopSeconds = 8): void {
        if (pState.timerRef) {
            clearInterval(pState.timerRef);
        }

        pState.timerRef = setInterval(() => {
            void this.runCycle(pState.userId);
        }, Math.max(5, pLoopSeconds) * 1000);
    }

    private async loadConfig(pUserId: string): Promise<RollingOptionsPtDeConfig> {
        const objProfile = await loadRollingOptionsPtDeProfile(pUserId);
        return buildConfigFromUiState({
            symbol: "BTC",
            manualFutQty: 1,
            manualFutOrderType: "market_order",
            action1: "sell",
            legSide1: "ce",
            expiryMode1: "1",
            expiryDate1: "",
            manualOptQty1: 1,
            newDelta1: 0.53,
            reDelta1: 0.53,
            deltaTp1: 0.15,
            deltaSl1: 0.85,
            reEnter1: false,
            redOptQtyPct: 100,
            greenOptQtyPct: 100,
            greenReDelta: 0.53,
            greenTpDelta: 0.15,
            greenSlDelta: 0.85,
            addOneLotFuture: false,
            renkoFeedEnabled: true,
            renkoFeedPts: 10,
            renkoFeedPriceSrc: "spot_price",
            ...(objProfile?.uiState || {})
        });
    }

    private getSimulatedSnapshot(pState: RollingOptionsPtDeEngineState, pConfig: RollingOptionsPtDeConfig): RollingOptionsPtDeMarketSnapshot {
        const vBase = pConfig.symbol === "ETH" ? 3200 : 64000;
        const vLastSpot = Number(pState.market.lastSpotPrice || vBase);
        const vBias = pState.renko.lastColor === "R" ? -1 : 1;
        const vRandomMove = ((Date.now() % 11) - 5) * (pConfig.renkoStepPoints / 4);
        const vTrendMove = vBias * (pConfig.renkoStepPoints / 5);
        const vSpotPrice = Number(Math.max(1, vLastSpot + vRandomMove + vTrendMove).toFixed(2));
        const vFuturesPrice = Number((vSpotPrice * 1.0012).toFixed(2));
        const vBestBidPrice = Number((vFuturesPrice * 0.9998).toFixed(2));
        const vBestAskPrice = Number((vFuturesPrice * 1.0002).toFixed(2));

        return {
            symbol: pConfig.symbol,
            contractName: pConfig.contractName,
            spotPrice: vSpotPrice,
            futuresPrice: vFuturesPrice,
            bestBidPrice: vBestBidPrice,
            bestAskPrice: vBestAskPrice,
            priceSource: "simulated",
            ts: new Date().toISOString()
        };
    }

    private getRuleValues(
        pConfig: RollingOptionsPtDeConfig,
        pColorCode: "R" | "G"
    ): {
        colorCode: "R" | "G";
        reDelta: number;
        takeProfitDelta: number;
        stopLossDelta: number;
    } {
        if (pColorCode === "G") {
            return {
                colorCode: "G",
                reDelta: Number(pConfig.greenReDelta ?? pConfig.reDelta ?? 0.53),
                takeProfitDelta: Number(pConfig.greenDeltaTakeProfit ?? pConfig.deltaTakeProfit ?? 0.15),
                stopLossDelta: Number(pConfig.greenDeltaStopLoss ?? pConfig.deltaStopLoss ?? 0.85)
            };
        }

        return {
            colorCode: "R",
            reDelta: Number(pConfig.redReDelta ?? pConfig.reDelta ?? 0.53),
            takeProfitDelta: Number(pConfig.redDeltaTakeProfit ?? pConfig.deltaTakeProfit ?? 0.15),
            stopLossDelta: Number(pConfig.redDeltaStopLoss ?? pConfig.deltaStopLoss ?? 0.85)
        };
    }

    private async getMarketSnapshot(pState: RollingOptionsPtDeEngineState, pConfig: RollingOptionsPtDeConfig): Promise<RollingOptionsPtDeMarketSnapshot> {
        ensureLiveTickerSymbols([pConfig.contractName]);
        try {
            return await getLiveMarketSnapshot(pConfig);
        }
        catch (_objError) {
            return this.getSimulatedSnapshot(pState, pConfig);
        }
    }

    private async buildRuntimeRecord(
        pUserId: string,
        pConfig: RollingOptionsPtDeConfig,
        pState: RollingOptionsPtDeEngineState,
        pOverrides: Partial<RollingOptionsPtDeRuntimeRecord> = {}
    ): Promise<RollingOptionsPtDeRuntimeRecord> {
        const objOpenPositions = await listRollingOptionsPtDeOpenPositions(pUserId);
        const vLastSignal = pOverrides.lastSignal
            || (pState.renko.lastColor === "R" ? "RED" : (pState.renko.lastColor === "G" ? "GREEN" : "IDLE"));

        return {
            userId: pUserId,
            status: pOverrides.status || (pState.running ? "running" : "stopped"),
            autoTraderEnabled: pOverrides.autoTraderEnabled ?? pState.running,
            currentSymbol: pConfig.symbol,
            currentContractName: pConfig.contractName,
            currentExpiryMode: pConfig.expiryMode,
            currentExpiryDate: pConfig.expiryDate,
            renkoEnabled: pConfig.renkoEnabled,
            renkoPoints: pConfig.renkoStepPoints,
            renkoSource: pConfig.renkoPriceSource,
            lastSpotPrice: pOverrides.lastSpotPrice ?? pState.market.lastSpotPrice,
            lastFuturesPrice: pOverrides.lastFuturesPrice ?? pState.market.lastFuturesPrice,
            lastSignal: vLastSignal,
            lastCycleAt: pOverrides.lastCycleAt ?? pState.lastCycleAt ?? "",
            lastError: pOverrides.lastError ?? pState.lastError,
            state: {
                cycleCount: pState.cycleCount,
                consecutiveFailures: pState.consecutiveFailures,
                renkoAnchor: pState.renko.anchor,
                renkoLastDir: pState.renko.lastDir,
                renkoLastColor: pState.renko.lastColor,
                marketSource: pState.market.lastSource,
                openPositions: objOpenPositions.length
            },
            updatedAt: ""
        };
    }

    private async syncRuntime(
        pUserId: string,
        pConfig: RollingOptionsPtDeConfig,
        pState: RollingOptionsPtDeEngineState,
        pOverrides: Partial<RollingOptionsPtDeRuntimeRecord> = {}
    ): Promise<RollingOptionsPtDeRuntimeRecord> {
        const objRuntime = await this.buildRuntimeRecord(pUserId, pConfig, pState, pOverrides);
        await this.runnerManager.setState({
            userId: pUserId,
            strategyType: "rolling-options-pt-de",
            status: objRuntime.status === "running" ? "running" : "stopped",
            updatedAt: new Date().toISOString(),
            message: objRuntime.lastError || objRuntime.lastSignal || "Rolling Options PT Demo",
            state: objRuntime.state
        });
        return saveRollingOptionsPtDeRuntime(objRuntime);
    }

    private async openFuturePosition(
        pUserId: string,
        pConfig: RollingOptionsPtDeConfig,
        pQty: number,
        pReason: string
    ): Promise<RollingOptionsPtDePositionRecord> {
        const objSnapshot = await this.getMarketSnapshot(this.getOrCreateState(pUserId), pConfig);
        const objPosition = await saveRollingOptionsPtDePosition({
            positionId: crypto.randomUUID(),
            userId: pUserId,
            groupId: `group_${Date.now()}`,
            cycleId: `cycle_${Date.now()}`,
            status: "OPEN",
            symbol: pConfig.symbol,
            contractName: `${pConfig.contractName} FUT`,
            instrumentType: "FUTURE",
            optionSide: "",
            action: pConfig.action === "sell" ? "BUY" : "SELL",
            strike: null,
            expiryDate: pConfig.expiryDate,
            qty: pQty,
            lotSize: pConfig.lotSize,
            entryPrice: objSnapshot.futuresPrice,
            exitPrice: null,
            markPrice: objSnapshot.futuresPrice,
            entryDelta: null,
            exitDelta: null,
            charges: estimatePositionCharges("FUTURE", pQty, pConfig.lotSize, objSnapshot.futuresPrice),
            pnl: 0,
            openedReason: pReason,
            closedReason: "",
            openedAt: objSnapshot.ts,
            closedAt: "",
            metadata: {
                orderType: pConfig.futureOrderType,
                source: "server-strategy"
            },
            createdAt: objSnapshot.ts,
            updatedAt: objSnapshot.ts
        });

        await logRollingOptionsPtDeEvent({
            userId: pUserId,
            eventType: pReason === "SL add one future" ? "extra_future_added" : "future_opened",
            severity: "success",
            title: pReason === "SL add one future" ? "Extra Future Added" : "Future Opened",
            message: `${objPosition.action} future paper position opened.`,
            payload: {
                symbol: pConfig.symbol,
                contractName: objPosition.contractName,
                qty: pQty,
                reason: pReason
            }
        });

        return objPosition;
    }

    private async openOptionPositions(
        pUserId: string,
        pConfig: RollingOptionsPtDeConfig,
        pQty: number,
        pReason: string,
        pColorCode: "R" | "G",
        pUseReEntryDelta = false
    ): Promise<RollingOptionsPtDePositionRecord[]> {
        const objSnapshot = await this.getMarketSnapshot(this.getOrCreateState(pUserId), pConfig);
        const vOptionSides: Array<"CE" | "PE"> = pConfig.legSide === "both"
            ? ["CE", "PE"]
            : [pConfig.legSide === "pe" ? "PE" : "CE"];
        const objRuleValues = this.getRuleValues(pConfig, pColorCode);
        const vTargetDelta = pUseReEntryDelta ? objRuleValues.reDelta : pConfig.newDelta;
        const vStrike = Math.round(objSnapshot.spotPrice / 100) * 100;
        const objSaved: RollingOptionsPtDePositionRecord[] = [];

        for (const vOptionSide of vOptionSides) {
            const objLiveContract = await findBestLiveOptionContract(pConfig, vOptionSide, vTargetDelta);
            if (objLiveContract?.contractSymbol) {
                ensureLiveTickerSymbols([objLiveContract.contractSymbol]);
            }
            const vMark = objLiveContract?.markPrice || Number((objSnapshot.spotPrice * Math.max(0.002, Math.abs(vTargetDelta) * 0.012)).toFixed(2));
            const vEntryDelta = objLiveContract ? Math.abs(objLiveContract.delta) : vTargetDelta;
            if (this.wouldOptionTriggerImmediately(objRuleValues, pConfig.action === "buy" ? "BUY" : "SELL", vEntryDelta)) {
                await logRollingOptionsPtDeEvent({
                    userId: pUserId,
                    eventType: "manual_action",
                    severity: "warning",
                    title: "Option Re-entry Skipped",
                    message: `Skipped ${pReason} because the replacement delta ${vEntryDelta.toFixed(4)} already violates TP/SL settings.`,
                    payload: {
                        symbol: pConfig.symbol,
                        reason: "replacement_option_immediate_trigger_skip",
                        contractName: objLiveContract?.contractSymbol || `${pConfig.contractName} ${vOptionSide}`,
                        delta: vEntryDelta
                    }
                });
                continue;
            }
            objSaved.push(await saveRollingOptionsPtDePosition({
                positionId: crypto.randomUUID(),
                userId: pUserId,
                groupId: `group_${Date.now()}`,
                cycleId: `cycle_${Date.now()}`,
                status: "OPEN",
                symbol: pConfig.symbol,
                contractName: objLiveContract?.contractSymbol || `${pConfig.contractName} ${vOptionSide}`,
                instrumentType: "OPTION",
                optionSide: vOptionSide,
                action: pConfig.action === "buy" ? "BUY" : "SELL",
                strike: objLiveContract?.strike || vStrike,
                expiryDate: objLiveContract?.expiryDate || pConfig.expiryDate,
                qty: pQty,
                lotSize: pConfig.lotSize,
                entryPrice: vMark,
                exitPrice: null,
                markPrice: vMark,
                entryDelta: vEntryDelta,
                exitDelta: vEntryDelta,
                charges: estimatePositionCharges("OPTION", pQty, pConfig.lotSize, vMark),
                pnl: 0,
                openedReason: pReason,
                closedReason: "",
                openedAt: objSnapshot.ts,
                closedAt: "",
                metadata: {
                    deltaTakeProfit: objRuleValues.takeProfitDelta,
                    deltaStopLoss: objRuleValues.stopLossDelta,
                    reEntryDelta: objRuleValues.reDelta,
                    reEnter: pConfig.reEnter,
                    ruleColor: objRuleValues.colorCode,
                    entrySpotPrice: objSnapshot.spotPrice,
                    productSymbol: objLiveContract?.contractSymbol || "",
                    productDelta: objLiveContract?.delta || vTargetDelta,
                    productGamma: objLiveContract?.gamma || 0,
                    productTheta: objLiveContract?.theta || 0,
                    productVega: objLiveContract?.vega || 0,
                    expiryMode: pConfig.expiryMode,
                    requestedExpiryDate: pConfig.expiryDate,
                    resolvedExpiryDate: objLiveContract?.expiryDate || pConfig.expiryDate,
                    usedNextDayExpiryFallback: Boolean(objLiveContract?.usedNextDayFallback),
                    source: objSnapshot.priceSource === "public" ? "server-strategy-live" : "server-strategy-simulated"
                },
                createdAt: objSnapshot.ts,
                updatedAt: objSnapshot.ts
            }));
        }

        const objFallbackPositions = objSaved.filter((objRow) => Boolean(objRow.metadata?.usedNextDayExpiryFallback));
        if (objFallbackPositions.length > 0) {
            const objFirstFallback = objFallbackPositions[0];
            await logRollingOptionsPtDeEvent({
                userId: pUserId,
                eventType: "manual_action",
                severity: "info",
                title: "Next-Day Expiry Fallback Used",
                message: `Used next-day expiry fallback for ${objFallbackPositions.length} option leg(s).`,
                payload: {
                    symbol: pConfig.symbol,
                    qty: objFallbackPositions.length,
                    reason: "next_day_expiry_fallback",
                    requestedExpiryDate: String(objFirstFallback.metadata?.requestedExpiryDate || pConfig.expiryDate),
                    resolvedExpiryDate: String(objFirstFallback.metadata?.resolvedExpiryDate || objFirstFallback.expiryDate || pConfig.expiryDate)
                }
            });
        }

        await logRollingOptionsPtDeEvent({
            userId: pUserId,
            eventType: pReason.toLowerCase().includes("re-entry") || pReason.toLowerCase().includes("replacement")
                ? "reentry_opened"
                : "option_opened",
            severity: "success",
            title: pReason.toLowerCase().includes("re-entry") || pReason.toLowerCase().includes("replacement")
                ? "Replacement Option Opened"
                : "Option Opened",
            message: `Opened ${objSaved.length} option paper leg(s).`,
            payload: {
                symbol: pConfig.symbol,
                qty: pQty,
                reason: pReason
            }
        });

        return objSaved;
    }

    private wouldOptionTriggerImmediately(
        pRuleValues: {
            takeProfitDelta: number;
            stopLossDelta: number;
        },
        pAction: "BUY" | "SELL",
        pDelta: number
    ): boolean {
        const vAbsDelta = Math.abs(Number(pDelta || 0));
        const vDeltaSl = Number(pRuleValues.stopLossDelta || 0);
        const vDeltaTp = Number(pRuleValues.takeProfitDelta || 0);
        const bHasSl = Number.isFinite(vDeltaSl) && vDeltaSl > 0;
        const bHasTp = Number.isFinite(vDeltaTp) && vDeltaTp > 0;

        if (!Number.isFinite(vAbsDelta)) {
            return false;
        }

        if (pAction === "SELL") {
            if (bHasSl && vAbsDelta >= vDeltaSl) {
                return true;
            }
            if (bHasTp && vAbsDelta <= vDeltaTp) {
                return true;
            }
            return false;
        }

        if (bHasSl && vAbsDelta <= vDeltaSl) {
            return true;
        }
        if (bHasTp && vAbsDelta >= vDeltaTp) {
            return true;
        }
        return false;
    }

    private async closePositions(
        pPositions: RollingOptionsPtDePositionRecord[],
        pConfig: RollingOptionsPtDeConfig,
        pReason: string
    ): Promise<RollingOptionsPtDePositionRecord[]> {
        const objSnapshot = await this.getMarketSnapshot(this.getOrCreateState(pPositions[0]?.userId || "demo-paper"), pConfig);
        const objClosed: RollingOptionsPtDePositionRecord[] = [];

        for (const objPosition of pPositions) {
            const vProductSymbol = String(objPosition.metadata?.productSymbol || "").trim();
            const objLiveTicker = objPosition.instrumentType === "OPTION" && vProductSymbol
                ? await getLiveOptionTicker(vProductSymbol)
                : null;
            const vCurrentDelta = objPosition.instrumentType === "OPTION"
                ? Math.abs(Number(objLiveTicker?.delta || objPosition.exitDelta || objPosition.entryDelta || 0.53))
                : null;
            const vExitPrice = objPosition.instrumentType === "OPTION"
                ? Number(objLiveTicker?.markPrice || objPosition.markPrice || objPosition.entryPrice || 0)
                : objSnapshot.futuresPrice;
            const vExitCharges = estimatePositionCharges(objPosition.instrumentType, objPosition.qty, objPosition.lotSize, vExitPrice);
            objClosed.push(await saveRollingOptionsPtDePosition({
                ...objPosition,
                status: "CLOSED",
                exitPrice: vExitPrice,
                markPrice: vExitPrice,
                exitDelta: vCurrentDelta,
                charges: Number((Number(objPosition.charges || 0) + vExitCharges).toFixed(4)),
                pnl: getPositionPnl(objPosition, vExitPrice),
                closedReason: pReason,
                closedAt: objSnapshot.ts,
                updatedAt: ""
            }));
        }

        if (objClosed.length > 0) {
            await applyClosedOptionPnlToProfile(objClosed[0].userId, objClosed);
            await logRollingOptionsPtDeEvent({
                userId: objClosed[0].userId,
                eventType: pReason.toLowerCase().includes("sl")
                    ? "sl_triggered"
                    : (pReason.toLowerCase().includes("tp") ? "tp_triggered" : "option_closed"),
                severity: pReason.toLowerCase().includes("sl") ? "warning" : "info",
                title: pReason.toLowerCase().includes("sl")
                    ? "SL Triggered"
                    : (pReason.toLowerCase().includes("tp") ? "TP Triggered" : "Position Closed"),
                message: `Closed ${objClosed.length} paper position(s).`,
                payload: {
                    symbol: pConfig.symbol,
                    qty: objClosed.length,
                    reason: pReason
                }
            });
        }

        return objClosed;
    }

    private getRenkoOptionQty(pFutureQty: number, pQtyPct: number): number {
        const vBaseQty = Math.max(0, Number(pFutureQty || 0));
        const vPercent = Math.max(0, Number(pQtyPct || 0));

        if (!(vBaseQty > 0) || !(vPercent > 0)) {
            return 0;
        }

        return Math.max(1, Math.round(vBaseQty * vPercent / 100));
    }

    private async openGreenRenkoFuturePosition(
        pUserId: string,
        pConfig: RollingOptionsPtDeConfig,
        pReason: string
    ): Promise<void> {
        const objSummary = getOpenPositionsSummary(await listRollingOptionsPtDeOpenPositions(pUserId));
        const vFutureQty = this.getRenkoOptionQty(objSummary.futureQty, pConfig.greenOptionQtyPct);

        if (!(vFutureQty > 0)) {
            await logRollingOptionsPtDeEvent({
                userId: pUserId,
                eventType: "manual_action",
                severity: "info",
                title: "Renko GREEN Futures Skipped",
                message: "Skipped GREEN Renko future entry because Green Opt Qty % is 0.",
                payload: {
                    symbol: pConfig.symbol,
                    reason: "renko_green_future_skipped_zero_qty_pct"
                }
            });
            return;
        }

        await this.openFuturePosition(pUserId, pConfig, vFutureQty, pReason);
    }

    public async executeStrategy(pUserId: string): Promise<{ status: string; message: string; }> {
        const objState = this.getOrCreateState(pUserId);
        const objConfig = await this.loadConfig(pUserId);
        const objSummary = getOpenPositionsSummary(await listRollingOptionsPtDeOpenPositions(pUserId));

        if (objSummary.futureQty <= 0) {
            await this.openFuturePosition(pUserId, objConfig, objConfig.futureQty, "Strategy initial future");
        }

        const objNextSummary = getOpenPositionsSummary(await listRollingOptionsPtDeOpenPositions(pUserId));
        if (!objNextSummary.hasOpenOption && objNextSummary.futureQty > 0) {
            const vQty = this.getRenkoOptionQty(objNextSummary.futureQty, objConfig.redOptionQtyPct);
            await this.openOptionPositions(pUserId, objConfig, vQty, "Strategy initial option entry", "R");
        }

        await this.syncRuntime(pUserId, objConfig, objState, {
            status: objState.running ? "running" : "stopped",
            lastSignal: "STRATEGY_EXECUTED",
            lastCycleAt: new Date().toISOString(),
            lastError: ""
        });
        await logRollingOptionsPtDeEvent({
            userId: pUserId,
            eventType: "strategy_executed",
            severity: "success",
            title: "Strategy Executed",
            message: "Initial futures and option entry flow executed.",
            payload: {
                symbol: objConfig.symbol,
                reason: "strategy_execute"
            }
        });

        return { status: "success", message: "Strategy executed." };
    }

    public async start(pUserId: string): Promise<{ status: string; message: string; }> {
        const objState = this.getOrCreateState(pUserId);
        if (objState.running) {
            return { status: "warning", message: "Auto trader already running." };
        }

        const objConfig = await this.loadConfig(pUserId);
        objState.running = true;
        objState.lastError = "";
        this.armTimer(objState, objConfig.loopSeconds);
        await this.syncRuntime(pUserId, objConfig, objState, {
            status: "running",
            autoTraderEnabled: true,
            lastSignal: "AUTO_TRADER_ON",
            lastCycleAt: new Date().toISOString()
        });
        await logRollingOptionsPtDeEvent({
            userId: pUserId,
            eventType: "engine_started",
            severity: "success",
            title: "Auto Trader Started",
            message: "Server-side auto trader started.",
            payload: {
                symbol: objConfig.symbol,
                reason: "engine_started"
            }
        });
        void this.runCycle(pUserId);
        return { status: "success", message: "Auto trader started." };
    }

    public async stop(pUserId: string, pReason = "Manual stop"): Promise<{ status: string; message: string; }> {
        const objState = this.getOrCreateState(pUserId);
        if (objState.timerRef) {
            clearInterval(objState.timerRef);
            objState.timerRef = null;
        }
        objState.running = false;
        const objConfig = await this.loadConfig(pUserId);
        await this.syncRuntime(pUserId, objConfig, objState, {
            status: "stopped",
            autoTraderEnabled: false,
            lastSignal: pReason === "Manual stop" ? "AUTO_TRADER_OFF" : "ENGINE_STOPPED"
        });
        await logRollingOptionsPtDeEvent({
            userId: pUserId,
            eventType: "engine_stopped",
            severity: "info",
            title: "Auto Trader Stopped",
            message: "Server-side auto trader stopped.",
            payload: {
                symbol: objConfig.symbol,
                reason: pReason
            }
        });
        return { status: "success", message: "Auto trader stopped." };
    }

    private async handleRenkoOptionEntry(
        pUserId: string,
        pConfig: RollingOptionsPtDeConfig,
        pColorCode: "R" | "G"
    ): Promise<void> {
        const objOpenPositions = await listRollingOptionsPtDeOpenPositions(pUserId);
        const objSummary = getOpenPositionsSummary(objOpenPositions);
        const vColorLabel = pColorCode === "R" ? "RED" : "GREEN";

        if (objSummary.hasOpenOption) {
            await logRollingOptionsPtDeEvent({
                userId: pUserId,
                eventType: "manual_action",
                severity: "info",
                title: `Renko ${vColorLabel} Skipped`,
                message: `Skipped ${vColorLabel} Renko option entry because an option position is already open.`,
                payload: {
                    symbol: pConfig.symbol,
                    reason: "renko_option_skipped_option_already_open"
                }
            });
            return;
        }

        if (objSummary.futureQty <= 0) {
            await logRollingOptionsPtDeEvent({
                userId: pUserId,
                eventType: "manual_action",
                severity: "info",
                title: `Renko ${vColorLabel} Skipped`,
                message: `Skipped ${vColorLabel} Renko option entry because no futures position is open.`,
                payload: {
                    symbol: pConfig.symbol,
                    reason: "renko_option_skipped_no_open_future"
                }
            });
            return;
        }

        const vQtyPct = pColorCode === "R" ? pConfig.redOptionQtyPct : pConfig.greenOptionQtyPct;
        const vQty = this.getRenkoOptionQty(objSummary.futureQty, vQtyPct);
        if (!(vQty > 0)) {
            await logRollingOptionsPtDeEvent({
                userId: pUserId,
                eventType: "manual_action",
                severity: "info",
                title: `Renko ${vColorLabel} Skipped`,
                message: `Skipped ${vColorLabel} Renko option entry because the configured qty % is 0.`,
                payload: {
                    symbol: pConfig.symbol,
                    reason: "renko_option_skipped_zero_qty_pct",
                    renkoColor: pColorCode
                }
            });
            return;
        }
        await this.openOptionPositions(
            pUserId,
            pConfig,
            vQty,
            pColorCode === "R" ? "Renko RED option entry" : "Renko GREEN option entry",
            pColorCode
        );
    }

    private async handleRenkoRedFlow(pUserId: string, pConfig: RollingOptionsPtDeConfig): Promise<void> {
        await this.handleRenkoOptionEntry(pUserId, pConfig, "R");
    }

    private async handleRenkoGreenFlow(pUserId: string, pConfig: RollingOptionsPtDeConfig): Promise<void> {
        const objSummary = getOpenPositionsSummary(await listRollingOptionsPtDeOpenPositions(pUserId));

        if (objSummary.futureQty <= 0) {
            await logRollingOptionsPtDeEvent({
                userId: pUserId,
                eventType: "manual_action",
                severity: "info",
                title: "Renko GREEN Skipped",
                message: "Skipped GREEN Renko future entry because no futures position is open.",
                payload: {
                    symbol: pConfig.symbol,
                    reason: "renko_green_future_skipped_no_open_future"
                }
            });
            return;
        }

        if (objSummary.hasOpenOption) {
            await logRollingOptionsPtDeEvent({
                userId: pUserId,
                eventType: "manual_action",
                severity: "info",
                title: "Renko GREEN Skipped",
                message: "Skipped GREEN Renko future entry because an option position is already open.",
                payload: {
                    symbol: pConfig.symbol,
                    reason: "renko_green_future_skipped_option_already_open"
                }
            });
            return;
        }

        await this.openGreenRenkoFuturePosition(pUserId, pConfig, "Renko GREEN future entry");
    }

    private async handleOptionTrigger(
        pUserId: string,
        pConfig: RollingOptionsPtDeConfig,
        pPosition: RollingOptionsPtDePositionRecord,
        pReason: "sl" | "tp"
    ): Promise<void> {
        const vCurrentRenkoColor = String(this.getOrCreateState(pUserId).renko.lastColor || "").trim().toUpperCase();
        const vStoredRuleColor = String(pPosition.metadata?.ruleColor || "").trim().toUpperCase();
        const vActiveRuleColor = pConfig.renkoEnabled
            ? (vCurrentRenkoColor === "G" ? "G" : "R")
            : (vStoredRuleColor === "G" ? "G" : "R");
        const bUseRedFlow = vActiveRuleColor === "R";
        const vCloseReason = pReason === "sl" ? "SL triggered" : "TP triggered";

        await this.closePositions([pPosition], pConfig, vCloseReason);

        if (bUseRedFlow) {
            if (pReason === "sl" && pConfig.addOneLotFuture) {
                await this.openFuturePosition(pUserId, pConfig, 1, "SL add one future");
            }

            const objSummary = getOpenPositionsSummary(await listRollingOptionsPtDeOpenPositions(pUserId));
            if (objSummary.futureQty > 0) {
                const vReplacementQty = this.getRenkoOptionQty(objSummary.futureQty, pConfig.redOptionQtyPct);
                if (!(vReplacementQty > 0)) {
                    return;
                }
                await this.openOptionPositions(
                    pUserId,
                    pConfig,
                    vReplacementQty,
                    pReason === "sl" ? "SL replacement option" : "TP replacement option",
                    "R",
                    true
                );
            }
            return;
        }

        if (pReason === "sl") {
            await this.openGreenRenkoFuturePosition(pUserId, pConfig, "SL GREEN future entry");
        }
    }

    public async runCycle(pUserId: string): Promise<{ status: string; message: string; }> {
        const objState = this.getOrCreateState(pUserId);
        if (objState.isBusy) {
            return { status: "warning", message: "Cycle already in progress." };
        }

        objState.isBusy = true;
        try {
            const objConfig = await this.loadConfig(pUserId);
            const objCurrentOpenPositions = await listRollingOptionsPtDeOpenPositions(pUserId);
            ensureLiveTickerSymbols([
                objConfig.contractName,
                ...objCurrentOpenPositions
                    .map((objRow) => String(objRow.metadata?.productSymbol || "").trim())
                    .filter(Boolean)
            ]);
            const objSnapshot = await this.getMarketSnapshot(objState, objConfig);
            objState.market.lastSpotPrice = objSnapshot.spotPrice;
            objState.market.lastFuturesPrice = objSnapshot.futuresPrice;
            objState.market.lastSource = objSnapshot.priceSource;

            const objRenkoSignals = objConfig.renkoEnabled
                ? updateRenkoState(objState, objSnapshot, objConfig)
                : [];

            for (const vRenkoSignal of objRenkoSignals) {
                if (!objState.running) {
                    break;
                }

                if (vRenkoSignal === "R") {
                    await logRollingOptionsPtDeEvent({
                        userId: pUserId,
                        eventType: "renko_change_detected",
                        severity: "info",
                        title: "Renko Change Detected",
                        message: "Server detected a RED renko brick.",
                        payload: {
                            symbol: objConfig.symbol,
                            reason: "renko_red_brick",
                            renkoColor: "R"
                        }
                    });
                    await this.handleRenkoRedFlow(pUserId, objConfig);
                    continue;
                }

                await logRollingOptionsPtDeEvent({
                    userId: pUserId,
                    eventType: "renko_change_detected",
                    severity: "info",
                    title: "Renko Change Detected",
                    message: "Server detected a GREEN renko brick.",
                    payload: {
                        symbol: objConfig.symbol,
                        reason: "renko_green_brick",
                        renkoColor: "G"
                    }
                });

                await logRollingOptionsPtDeEvent({
                    userId: pUserId,
                    eventType: "manual_action",
                    severity: "info",
                    title: "Renko Green Detected",
                    message: "Server detected a GREEN renko brick.",
                    payload: {
                        symbol: objConfig.symbol,
                        reason: "renko_green_brick"
                    }
                });
                await this.handleRenkoGreenFlow(pUserId, objConfig);
            }

            const objOpenFutures = objCurrentOpenPositions
                .filter((objRow) => objRow.instrumentType === "FUTURE");
            const objOpenOptions = objCurrentOpenPositions
                .filter((objRow) => objRow.instrumentType === "OPTION");

            for (const objPosition of objOpenFutures) {
                await saveRollingOptionsPtDePosition({
                    ...objPosition,
                    markPrice: objSnapshot.futuresPrice,
                    pnl: getPositionPnl(objPosition, objSnapshot.futuresPrice),
                    updatedAt: ""
                });
            }

            for (const objPosition of objOpenOptions) {
                const vProductSymbol = String(objPosition.metadata?.productSymbol || "").trim();
                const objLiveTicker = vProductSymbol ? await getLiveOptionTicker(vProductSymbol) : null;
                const vCurrentDelta = Math.abs(Number(objLiveTicker?.delta || objPosition.exitDelta || objPosition.entryDelta || 0.53));
                const vMarkPrice = Number(objLiveTicker?.markPrice || objPosition.markPrice || objPosition.entryPrice || 0);
                await saveRollingOptionsPtDePosition({
                    ...objPosition,
                    markPrice: vMarkPrice,
                    exitDelta: vCurrentDelta,
                    pnl: getPositionPnl(objPosition, vMarkPrice),
                    updatedAt: ""
                });

                if (!objState.running) {
                    continue;
                }

                const objDecision = shouldTriggerOption(objPosition, vCurrentDelta);
                if (objDecision.shouldAct && objDecision.reason) {
                    await this.handleOptionTrigger(pUserId, objConfig, objPosition, objDecision.reason);
                    break;
                }
            }

            objState.cycleCount += 1;
            objState.consecutiveFailures = 0;
            objState.lastError = "";
            objState.lastCycleAt = new Date().toISOString();
            const vLastRenkoSignal = objRenkoSignals.at(-1);
            await this.syncRuntime(pUserId, objConfig, objState, {
                status: objState.running ? "running" : "stopped",
                autoTraderEnabled: objState.running,
                lastSpotPrice: objSnapshot.spotPrice,
                lastFuturesPrice: objSnapshot.futuresPrice,
                lastSignal: vLastRenkoSignal
                    ? (vLastRenkoSignal === "R" ? "RED" : "GREEN")
                    : (objState.renko.lastColor === "R" ? "RED" : (objState.renko.lastColor === "G" ? "GREEN" : "IDLE")),
                lastCycleAt: objState.lastCycleAt
            });
            return { status: "success", message: "Cycle completed." };
        }
        catch (objError) {
            const objConfig = await this.loadConfig(pUserId);
            objState.consecutiveFailures += 1;
            objState.lastError = objError instanceof Error ? objError.message : String(objError);
            objState.lastCycleAt = new Date().toISOString();
            await this.syncRuntime(pUserId, objConfig, objState, {
                status: objState.running ? "running" : "error",
                autoTraderEnabled: objState.running,
                lastError: objState.lastError,
                lastSignal: "ENGINE_ERROR",
                lastCycleAt: objState.lastCycleAt
            });
            await logRollingOptionsPtDeEvent({
                userId: pUserId,
                eventType: "engine_error",
                severity: "error",
                title: "Engine Error",
                message: objState.lastError,
                payload: {
                    reason: "engine_error"
                }
            });
            return { status: "danger", message: objState.lastError };
        }
        finally {
            objState.isBusy = false;
        }
    }

    public async emergencyStop(pUserId: string): Promise<{ status: string; message: string; }> {
        const objConfig = await this.loadConfig(pUserId);
        const objOpenPositions = await listRollingOptionsPtDeOpenPositions(pUserId);
        if (objOpenPositions.length > 0) {
            await this.closePositions(objOpenPositions, objConfig, "Emergency stop");
        }
        await this.stop(pUserId, "Emergency stop");
        await logRollingOptionsPtDeEvent({
            userId: pUserId,
            eventType: "kill_switch",
            severity: "warning",
            title: "Kill Switch",
            message: "Emergency stop closed open paper positions and stopped the engine.",
            payload: {
                symbol: objConfig.symbol,
                qty: objOpenPositions.length,
                reason: "kill_switch"
            }
        });
        return { status: "success", message: "Emergency stop completed." };
    }

    public async reset(pUserId: string): Promise<{ status: string; message: string; }> {
        await this.stop(pUserId, "Reset");
        const objConfig = await this.loadConfig(pUserId);
        const objState = this.getOrCreateState(pUserId);
        objState.cycleCount = 0;
        objState.consecutiveFailures = 0;
        objState.lastError = "";
        objState.lastCycleAt = null;
        objState.renko.anchor = null;
        objState.renko.lastDir = 0;
        objState.renko.lastColor = "";
        await this.syncRuntime(pUserId, objConfig, objState, {
            status: "stopped",
            autoTraderEnabled: false,
            lastSignal: "RESET"
        });
        await logRollingOptionsPtDeEvent({
            userId: pUserId,
            eventType: "manual_action",
            severity: "info",
            title: "Strategy Reset",
            message: "Rolling Options server state was reset.",
            payload: {
                symbol: objConfig.symbol,
                reason: "reset"
            }
        });
        return { status: "success", message: "Strategy state reset." };
    }

    public async setManualRenkoSignal(
        pUserId: string,
        pColorCode: "R" | "G"
    ): Promise<{ status: string; message: string; color: "R" | "G"; }> {
        const objState = this.getOrCreateState(pUserId);
        const objConfig = await this.loadConfig(pUserId);
        const vColorCode = pColorCode === "R" ? "R" : "G";

        objState.renko.lastColor = vColorCode;
        objState.renko.lastDir = vColorCode === "R" ? -1 : 1;
        objState.lastError = "";
        objState.lastCycleAt = new Date().toISOString();

        await this.syncRuntime(pUserId, objConfig, objState, {
            status: objState.running ? "running" : "stopped",
            autoTraderEnabled: objState.running,
            lastSignal: vColorCode === "R" ? "MANUAL_RED" : "MANUAL_GREEN",
            lastCycleAt: objState.lastCycleAt,
            lastError: ""
        });

        await logRollingOptionsPtDeEvent({
            userId: pUserId,
            eventType: "manual_action",
            severity: "info",
            title: "Manual Renko Signal",
            message: `Manual Renko signal changed to ${vColorCode === "R" ? "RED" : "GREEN"}.`,
            payload: {
                symbol: objConfig.symbol,
                reason: vColorCode === "R" ? "manual_renko_red" : "manual_renko_green"
            }
        });

        if (objState.running) {
            if (vColorCode === "R") {
                await this.handleRenkoRedFlow(pUserId, objConfig);
            }
            else {
                await this.handleRenkoGreenFlow(pUserId, objConfig);
            }
        }

        return {
            status: "success",
            message: `Manual Renko signal set to ${vColorCode === "R" ? "RED" : "GREEN"}.`,
            color: vColorCode
        };
    }

    public async getCounts(pUserId: string): Promise<{ open: number; closed: number; }> {
        const objOpen = await listRollingOptionsPtDeOpenPositions(pUserId);
        const objClosed = await listRollingOptionsPtDeClosedPositions(pUserId);
        return { open: objOpen.length, closed: objClosed.length };
    }
}
