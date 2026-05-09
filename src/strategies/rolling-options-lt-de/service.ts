import crypto from "node:crypto";
const DeltaRestClient = require("delta-rest-client");
import { RunnerManager } from "../../runners/runner-manager";
import { getDeltaApiProfile } from "../../storage/delta-api-profile-store";
import {
    listRollingOptionsLtDeImportedPositions,
    replaceRollingOptionsLtDeImportedPositions,
    type RollingOptionsLtDeImportedPositionRecord,
    type RollingOptionsLtDePositionMetadata
} from "../../storage/rolling-options-lt-de-position-store";
import { loadRollingOptionsLtDeProfile } from "../../storage/rolling-options-lt-de-profile-store";
import {
    listRollingOptionsLtDeRuntime,
    loadRollingOptionsLtDeRuntime,
    saveRollingOptionsLtDeRuntime,
    type RollingOptionsLtDeRuntimeRecord
} from "../../storage/rolling-options-lt-de-runtime-store";
import { buildConfigFromUiState, updateRenkoState } from "../rolling-options-pt-de/engine";
import {
    ensureLiveTickerSymbolsForOwner,
    findBestLiveOptionContract,
    getLiveTickerFeedStats,
    getLiveTickerSymbolsForOwner,
    getLiveMarketSnapshot,
    getLiveOptionTicker,
    releaseLiveTickerSymbolsForOwner
} from "../rolling-options-pt-de/market-data";
import { logRollingOptionsLtDeEvent } from "./event-logger";
import type { RollingOptionsPtDeConfig, RollingOptionsPtDeEngineState, RollingOptionsPtDeMarketSnapshot } from "../rolling-options-pt-de/types";

interface EnrichedImportedPosition extends RollingOptionsLtDeImportedPositionRecord {
    currentDelta: number | null;
    isOption: boolean;
}

interface DeltaPositionRow {
    product_symbol?: string;
    symbol?: string;
    size?: number | string | null;
    net_size?: number | string | null;
    entry_price?: number | string | null;
    mark_price?: number | string | null;
    liquidation_price?: number | string | null;
    realized_pnl?: number | string | null;
    unrealized_pnl?: number | string | null;
    margin?: number | string | null;
    product_id?: number | string | null;
}

interface DeltaActiveOrderRow {
    id?: number | string | null;
    state?: string | null;
    size?: number | string | null;
    unfilled_size?: number | string | null;
    product_symbol?: string | null;
    [key: string]: unknown;
}

const gFutureLimitRetryDelayMs = 5000;
const gFutureLimitRetryCount = 5;

function isOptionContract(pContractName: string): boolean {
    const vContractName = String(pContractName || "").trim().toUpperCase();
    return vContractName.startsWith("C-") || vContractName.startsWith("P-");
}

function getLotSizeForContractName(pContractName: string): number {
    const vContractName = String(pContractName || "").trim().toUpperCase();
    return vContractName.includes("ETH") ? 0.01 : 0.001;
}

function calculateImportedPnl(pPosition: RollingOptionsLtDeImportedPositionRecord, pMarkPrice: number): number {
    const vEntryPrice = Number(pPosition.entryPrice || 0);
    const vQty = Math.max(0, Number(pPosition.qty || 0));
    const vLotSize = Math.max(0, getLotSizeForContractName(pPosition.contractName));
    const vMarkPrice = Number(pMarkPrice || 0);
    const vSide = String(pPosition.side || "").trim().toUpperCase();
    if (!(vQty > 0) || !(vLotSize > 0) || !(Number.isFinite(vMarkPrice))) {
        return Number(pPosition.pnl || 0);
    }

    const vRawPnl = vSide === "BUY"
        ? ((vMarkPrice - vEntryPrice) * vQty * vLotSize)
        : ((vEntryPrice - vMarkPrice) * vQty * vLotSize);
    return Number(vRawPnl.toFixed(2));
}

function shouldTriggerImportedOption(
    pSide: string,
    pCurrentDelta: number,
    pTakeProfitDelta: number,
    pStopLossDelta: number
): { shouldAct: boolean; reason: "" | "sl" | "tp"; } {
    const vSide = String(pSide || "").trim().toUpperCase();
    const vAbsDelta = Math.abs(Number(pCurrentDelta || 0));
    const vDeltaTp = Number(pTakeProfitDelta || 0);
    const vDeltaSl = Number(pStopLossDelta || 0);
    const bHasTp = Number.isFinite(vDeltaTp) && vDeltaTp > 0;
    const bHasSl = Number.isFinite(vDeltaSl) && vDeltaSl > 0;

    if (!Number.isFinite(vAbsDelta) || (!bHasTp && !bHasSl)) {
        return { shouldAct: false, reason: "" };
    }

    if (vSide === "SELL") {
        if (bHasSl && vAbsDelta >= vDeltaSl) {
            return { shouldAct: true, reason: "sl" };
        }
        if (bHasTp && vAbsDelta <= vDeltaTp) {
            return { shouldAct: true, reason: "tp" };
        }
        return { shouldAct: false, reason: "" };
    }

    if (bHasSl && vAbsDelta <= vDeltaSl) {
        return { shouldAct: true, reason: "sl" };
    }
    if (bHasTp && vAbsDelta >= vDeltaTp) {
        return { shouldAct: true, reason: "tp" };
    }
    return { shouldAct: false, reason: "" };
}

function toFiniteNumber(pValue: unknown, pFallback = 0): number {
    const vNumber = Number(pValue);
    return Number.isFinite(vNumber) ? vNumber : pFallback;
}

function sleep(pDurationMs: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, pDurationMs));
}

export class RollingOptionsLtDeService {
    private readonly stateByUserId = new Map<string, RollingOptionsPtDeEngineState>();
    private readonly lastErrorLogByUserId = new Map<string, { message: string; loggedAtMs: number }>();

    public constructor(private readonly runnerManager: RunnerManager) {}

    private shouldLogCycleError(pUserId: string, pMessage: string): boolean {
        const vUserId = String(pUserId || "").trim();
        const vMessage = String(pMessage || "").trim() || "Live cycle failed.";
        const vNowMs = Date.now();
        const objPrevious = this.lastErrorLogByUserId.get(vUserId);
        if (!objPrevious) {
            this.lastErrorLogByUserId.set(vUserId, { message: vMessage, loggedAtMs: vNowMs });
            return true;
        }

        const bMessageChanged = objPrevious.message !== vMessage;
        const bCooldownElapsed = (vNowMs - objPrevious.loggedAtMs) >= (5 * 60 * 1000);
        if (bMessageChanged || bCooldownElapsed) {
            this.lastErrorLogByUserId.set(vUserId, { message: vMessage, loggedAtMs: vNowMs });
            return true;
        }

        return false;
    }

    private getTickerOwnerId(pUserId: string): string {
        return `rolling-options-lt-de:${String(pUserId || "").trim()}`;
    }

    private refreshTickerScope(pUserId: string, pSymbols: string[]): void {
        ensureLiveTickerSymbolsForOwner(this.getTickerOwnerId(pUserId), pSymbols);
    }

    private releaseTickerScope(pUserId: string): void {
        releaseLiveTickerSymbolsForOwner(this.getTickerOwnerId(pUserId));
    }

    private async getDeltaClient(pUserId: string): Promise<{ client: any; profileId: string; }> {
        const objProfile = await loadRollingOptionsLtDeProfile(pUserId);
        const vProfileId = String(objProfile?.selectedApiProfileId || "").trim();
        if (!vProfileId) {
            throw new Error("Select an API profile before running the live auto trader.");
        }

        const objDeltaProfile = await getDeltaApiProfile(pUserId, vProfileId);
        if (!objDeltaProfile) {
            throw new Error("Selected Delta API profile was not found.");
        }

        return {
            client: await new DeltaRestClient(objDeltaProfile.apiKey, objDeltaProfile.apiSecret),
            profileId: vProfileId
        };
    }

    private async persistImportedPositions(
        pUserId: string,
        pPositions: RollingOptionsLtDeImportedPositionRecord[]
    ): Promise<RollingOptionsLtDeImportedPositionRecord[]> {
        return replaceRollingOptionsLtDeImportedPositions(pUserId, pPositions);
    }

    private parseDeltaPayload(pRaw: unknown): Record<string, unknown> {
        if (!pRaw) {
            return {};
        }
        if (typeof pRaw === "string") {
            try {
                return JSON.parse(pRaw) as Record<string, unknown>;
            }
            catch (_objError) {
                return {};
            }
        }
        if (Buffer.isBuffer(pRaw)) {
            try {
                return JSON.parse(pRaw.toString("utf8")) as Record<string, unknown>;
            }
            catch (_objError) {
                return {};
            }
        }
        if (typeof pRaw === "object") {
            return pRaw as Record<string, unknown>;
        }
        return {};
    }

    private readResponsePayload(pResponse: { data?: unknown; body?: unknown } | unknown): Record<string, unknown> {
        const objResponse = (pResponse || {}) as { data?: unknown; body?: unknown };
        return this.parseDeltaPayload(objResponse.data ?? objResponse.body ?? {});
    }

    private getOrderId(pPayload: Record<string, unknown>): string {
        const objResult = (pPayload.result && typeof pPayload.result === "object")
            ? pPayload.result as Record<string, unknown>
            : {};
        return String(objResult.id || objResult.order_id || "").trim();
    }

    private async findActiveFutureOrderById(
        pClient: any,
        pContractName: string,
        pOrderId: string
    ): Promise<DeltaActiveOrderRow | null> {
        if (!pOrderId || typeof pClient?.apis?.Orders?.getOrders !== "function") {
            return null;
        }

        const objResponse = await pClient.apis.Orders.getOrders({
            product_symbol: pContractName,
            state: "open",
            page_size: 100
        });
        const objPayload = this.readResponsePayload(objResponse);
        const arrRows = Array.isArray(objPayload.result) ? objPayload.result as DeltaActiveOrderRow[] : [];
        return arrRows.find((objRow) => String(objRow.id || "").trim() === pOrderId) || null;
    }

    private async repriceOrReplaceLimitFutureOrder(
        pClient: any,
        pContractName: string,
        pOrderId: string,
        pSide: "buy" | "sell",
        pQty: number,
        pNextPrice: string
    ): Promise<string> {
        if (typeof pClient?.apis?.Orders?.editOrder === "function") {
            const objResponse = await pClient.apis.Orders.editOrder({
                order: {
                    id: Number.isFinite(Number(pOrderId)) ? Number(pOrderId) : pOrderId,
                    product_symbol: pContractName,
                    size: pQty,
                    limit_price: pNextPrice
                }
            });
            const objPayload = this.readResponsePayload(objResponse);
            return this.getOrderId(objPayload) || pOrderId;
        }

        if (typeof pClient?.apis?.Orders?.cancelOrder === "function") {
            await pClient.apis.Orders.cancelOrder({
                order: {
                    id: Number.isFinite(Number(pOrderId)) ? Number(pOrderId) : pOrderId,
                    product_symbol: pContractName
                }
            });
            const objResponse = await pClient.apis.Orders.placeOrder({
                order: {
                    product_symbol: pContractName,
                    size: pQty,
                    side: pSide,
                    order_type: "limit_order",
                    limit_price: pNextPrice,
                    time_in_force: "gtc",
                    post_only: false,
                    reduce_only: false
                }
            });
            const objPayload = this.readResponsePayload(objResponse);
            return this.getOrderId(objPayload);
        }

        throw new Error("Delta client does not support safe limit-order repricing.");
    }

    private async placeManagedFutureEntryOrder(
        pUserId: string,
        pConfig: RollingOptionsPtDeConfig,
        pQty: number
    ): Promise<{ entryPrice: number; entryTs: string; orderTypeUsed: "limit_order" | "market_order"; }> {
        const { client } = await this.getDeltaClient(pUserId);
        const vQty = Math.max(1, Math.floor(Number(pQty || 1)));
        const vSide = this.getFutureEntrySide(pConfig);
        let objSnapshot = await this.getMarketSnapshot(pConfig);
        const objOrderPayload: Record<string, unknown> = {
            product_symbol: pConfig.contractName,
            size: vQty,
            side: vSide,
            order_type: pConfig.futureOrderType,
            time_in_force: "gtc",
            post_only: false,
            reduce_only: false
        };

        if (pConfig.futureOrderType !== "limit_order") {
            await client.apis.Orders.placeOrder({
                order: objOrderPayload
            });
            return {
                entryPrice: Number(objSnapshot.futuresPrice || 0),
                entryTs: String(objSnapshot.ts || new Date().toISOString()),
                orderTypeUsed: "market_order"
            };
        }

        objOrderPayload.limit_price = String(objSnapshot.futuresPrice);
        let objResponse = await client.apis.Orders.placeOrder({
            order: objOrderPayload
        });
        let objPayload = this.readResponsePayload(objResponse);
        let vOrderId = this.getOrderId(objPayload);

        for (let vAttempt = 0; vAttempt < gFutureLimitRetryCount; vAttempt += 1) {
            await sleep(gFutureLimitRetryDelayMs);
            const objActiveOrder = await this.findActiveFutureOrderById(client, pConfig.contractName, vOrderId);
            if (!objActiveOrder) {
                return {
                    entryPrice: Number(objSnapshot.futuresPrice || 0),
                    entryTs: String(objSnapshot.ts || new Date().toISOString()),
                    orderTypeUsed: "limit_order"
                };
            }

            const vUnfilledSize = Math.max(0, Math.floor(Number(objActiveOrder.unfilled_size ?? objActiveOrder.size ?? vQty)));
            if (!(vUnfilledSize > 0)) {
                return {
                    entryPrice: Number(objSnapshot.futuresPrice || 0),
                    entryTs: String(objSnapshot.ts || new Date().toISOString()),
                    orderTypeUsed: "limit_order"
                };
            }

            if (vAttempt === (gFutureLimitRetryCount - 1)) {
                break;
            }

            objSnapshot = await this.getMarketSnapshot(pConfig);
            vOrderId = await this.repriceOrReplaceLimitFutureOrder(
                client,
                pConfig.contractName,
                vOrderId,
                vSide,
                vQty,
                String(objSnapshot.futuresPrice)
            );
        }

        const objActiveOrder = await this.findActiveFutureOrderById(client, pConfig.contractName, vOrderId);
        const vRemainingSize = Math.max(0, Math.floor(Number(objActiveOrder?.unfilled_size ?? objActiveOrder?.size ?? vQty)));
        if (objActiveOrder) {
            if (typeof client?.apis?.Orders?.cancelOrder !== "function") {
                throw new Error("Unable to cancel unfilled future limit order safely.");
            }
            await client.apis.Orders.cancelOrder({
                order: {
                    id: Number.isFinite(Number(vOrderId)) ? Number(vOrderId) : vOrderId,
                    product_symbol: pConfig.contractName
                }
            });
        }

        objSnapshot = await this.getMarketSnapshot(pConfig);
        await client.apis.Orders.placeOrder({
            order: {
                product_symbol: pConfig.contractName,
                size: Math.max(1, vRemainingSize || vQty),
                side: vSide,
                order_type: "market_order",
                time_in_force: "gtc",
                post_only: false,
                reduce_only: false
            }
        });
        return {
            entryPrice: Number(objSnapshot.futuresPrice || 0),
            entryTs: String(objSnapshot.ts || new Date().toISOString()),
            orderTypeUsed: "market_order"
        };
    }

    private mapLivePosition(pUserId: string, pRow: DeltaPositionRow, pIndex: number): RollingOptionsLtDeImportedPositionRecord {
        const vNetSize = toFiniteNumber(pRow.net_size ?? pRow.size, 0);
        const vSide = vNetSize < 0 ? "SELL" : "BUY";
        return {
            userId: pUserId,
            importId: String(pRow.product_id ?? pRow.product_symbol ?? pRow.symbol ?? `position-${pIndex}`),
            contractName: String(pRow.product_symbol || pRow.symbol || "Unknown"),
            side: vSide,
            qty: Math.abs(vNetSize),
            entryPrice: toFiniteNumber(pRow.entry_price, 0),
            markPrice: toFiniteNumber(pRow.mark_price, 0),
            entryDelta: null,
            currentDelta: null,
            charges: 0,
            pnl: Number((toFiniteNumber(pRow.realized_pnl, 0) + toFiniteNumber(pRow.unrealized_pnl, 0)).toFixed(2)),
            margin: toFiniteNumber(pRow.margin, 0),
            liquidationPrice: toFiniteNumber(pRow.liquidation_price, 0),
            openedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
    }

    private async fetchCurrentDeltaPositions(pUserId: string, pSymbol: string): Promise<RollingOptionsLtDeImportedPositionRecord[]> {
        const { client } = await this.getDeltaClient(pUserId);
        const objResponse = typeof (client.apis?.Positions as { getMarginedPositions?: unknown } | undefined)?.getMarginedPositions === "function"
            ? await (client.apis.Positions as { getMarginedPositions: (pParams: Record<string, unknown>) => Promise<unknown> }).getMarginedPositions({})
            : await (client.apis.Positions as { getPositions: (pParams: Record<string, unknown>) => Promise<unknown> }).getPositions({
                underlying_asset_symbol: pSymbol
            });
        const objPayload = this.readResponsePayload(objResponse);
        const arrRows = Array.isArray(objPayload.result) ? objPayload.result as DeltaPositionRow[] : [];
        return arrRows
            .map((objRow, vIndex) => this.mapLivePosition(pUserId, objRow, vIndex))
            .filter((objRow) => objRow.qty > 0);
    }

    public async reconcileUserPositions(pUserId: string, pSymbol?: string): Promise<RollingOptionsLtDeImportedPositionRecord[]> {
        const objConfig = await this.loadConfig(pUserId);
        const vSymbol = String(pSymbol || objConfig.symbol || "").trim().toUpperCase() || objConfig.symbol;
        const arrSaved = await listRollingOptionsLtDeImportedPositions(pUserId);
        const arrLive = await this.fetchCurrentDeltaPositions(pUserId, vSymbol);
        const objLiveByContract = new Map(arrLive.map((objRow) => [objRow.contractName, objRow]));
        const arrReconciled = arrSaved
            .map((objSavedRow): RollingOptionsLtDeImportedPositionRecord | null => {
                const objLiveRow = objLiveByContract.get(objSavedRow.contractName);
                if (!objLiveRow) {
                    return null;
                }
                return {
                    ...objLiveRow,
                    entryDelta: objSavedRow.entryDelta ?? objLiveRow.entryDelta,
                    currentDelta: objSavedRow.currentDelta ?? objLiveRow.currentDelta,
                    charges: objSavedRow.charges ?? objLiveRow.charges,
                    metadata: objSavedRow.metadata ?? objLiveRow.metadata,
                    openedAt: objSavedRow.openedAt || objLiveRow.openedAt
                };
            })
            .filter((objRow): objRow is RollingOptionsLtDeImportedPositionRecord => Boolean(objRow));

        await this.persistImportedPositions(pUserId, arrReconciled);

        const vRemovedCount = Math.max(0, arrSaved.length - arrReconciled.length);
        if (vRemovedCount > 0) {
            await logRollingOptionsLtDeEvent({
                userId: pUserId,
                eventType: "manual_action",
                severity: "warning",
                title: "Live Positions Reconciled",
                message: `Removed ${vRemovedCount} saved live position${vRemovedCount === 1 ? "" : "s"} that no longer exist on Delta Exchange.`,
                payload: {
                    symbol: vSymbol,
                    qty: vRemovedCount,
                    reason: "reconcile_removed_missing_positions"
                }
            });
        }

        return arrReconciled;
    }

    private meetsEntryDeltaRule(
        pAction: "buy" | "sell",
        pDelta: number,
        pTargetDelta: number
    ): boolean {
        const vAbsDelta = Math.abs(Number(pDelta || 0));
        const vTargetDelta = Math.abs(Number(pTargetDelta || 0));
        if (!Number.isFinite(vAbsDelta) || !(vTargetDelta > 0)) {
            return false;
        }

        if (pAction === "sell") {
            return vAbsDelta <= vTargetDelta;
        }
        return vAbsDelta >= vTargetDelta;
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

    private buildOptionMetadata(
        pConfig: RollingOptionsPtDeConfig,
        pColorCode: "R" | "G",
        pReason: string
    ): RollingOptionsLtDePositionMetadata {
        const objRuleValues = this.getRuleValues(pConfig, pColorCode);
        return {
            ruleColor: objRuleValues.colorCode,
            takeProfitDelta: objRuleValues.takeProfitDelta,
            stopLossDelta: objRuleValues.stopLossDelta,
            reEntryDelta: objRuleValues.reDelta,
            openedReason: pReason
        };
    }

    private wouldOptionTriggerImmediately(
        pRuleValues: {
            takeProfitDelta: number;
            stopLossDelta: number;
        },
        pPositionSide: "BUY" | "SELL",
        pDelta: number
    ): boolean {
        return shouldTriggerImportedOption(
            pPositionSide,
            pDelta,
            Number(pRuleValues.takeProfitDelta || 0),
            Number(pRuleValues.stopLossDelta || 0)
        ).shouldAct;
    }

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
        const vUserId = String(pUserId || "").trim();
        let objState = this.stateByUserId.get(vUserId);
        if (!objState) {
            objState = this.createInitialState(vUserId);
            this.stateByUserId.set(vUserId, objState);
        }
        return objState;
    }

    public async hydrate(): Promise<void> {
        const arrRuntimeRows = await listRollingOptionsLtDeRuntime();
        for (const objRuntime of arrRuntimeRows) {
            if (!objRuntime.autoTraderEnabled || objRuntime.status !== "running") {
                continue;
            }

            const objState = this.getOrCreateState(objRuntime.userId);
            objState.running = true;
            objState.cycleCount = Number(objRuntime.state?.cycleCount || 0);
            objState.consecutiveFailures = Number(objRuntime.state?.consecutiveFailures || 0);
            objState.lastError = String(objRuntime.lastError || "");
            objState.lastCycleAt = objRuntime.lastCycleAt || null;
            objState.renko.anchor = Number.isFinite(Number(objRuntime.state?.renkoAnchor))
                ? Number(objRuntime.state?.renkoAnchor)
                : null;
            objState.renko.lastDir = Number(objRuntime.state?.renkoLastDir || 0) as -1 | 0 | 1;
            objState.renko.lastColor = String(objRuntime.state?.renkoLastColor || "") as "" | "R" | "G";
            objState.market.lastSpotPrice = objRuntime.lastSpotPrice;
            objState.market.lastFuturesPrice = objRuntime.lastFuturesPrice;
            objState.market.lastSource = String(objRuntime.state?.marketSource || "public") === "simulated" ? "simulated" : "public";
            const objConfig = await this.loadConfig(objRuntime.userId);
            this.armTimer(objState, objConfig.loopSeconds);
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
        const objProfile = await loadRollingOptionsLtDeProfile(pUserId);
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
            reEnter1: false,
            redOptQtyPct: 100,
            reRedDelta: 0.53,
            redTpDelta: 0.15,
            redSlDelta: 0.85,
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

    private async getMarketSnapshot(pConfig: RollingOptionsPtDeConfig): Promise<RollingOptionsPtDeMarketSnapshot> {
        return getLiveMarketSnapshot(pConfig);
    }

    private async refreshImportedPositions(
        pConfig: RollingOptionsPtDeConfig,
        pSnapshot: RollingOptionsPtDeMarketSnapshot,
        pPositions: RollingOptionsLtDeImportedPositionRecord[]
    ): Promise<EnrichedImportedPosition[]> {
        const arrOptionContracts = pPositions
            .filter((objPosition) => isOptionContract(objPosition.contractName))
            .map((objPosition) => String(objPosition.contractName || "").trim())
            .filter(Boolean);
        const objTickerByContract = new Map<string, Awaited<ReturnType<typeof getLiveOptionTicker>>>();
        await Promise.all(arrOptionContracts.map(async (pContractName) => {
            objTickerByContract.set(pContractName, await getLiveOptionTicker(pContractName));
        }));

        const arrEnriched: EnrichedImportedPosition[] = [];
        for (const objPosition of pPositions) {
            const bIsOption = isOptionContract(objPosition.contractName);
            if (!bIsOption) {
                const vMarkPrice = pSnapshot.futuresPrice;
                arrEnriched.push({
                    ...objPosition,
                    markPrice: vMarkPrice,
                    pnl: calculateImportedPnl(objPosition, vMarkPrice),
                    updatedAt: new Date().toISOString(),
                    currentDelta: null,
                    isOption: false
                });
                continue;
            }

            const objTicker = objTickerByContract.get(String(objPosition.contractName || "").trim()) || null;
            const vMarkPrice = Number(objTicker?.markPrice || objPosition.markPrice || objPosition.entryPrice || 0);
            const vCurrentDelta = objTicker?.delta === null || objTicker?.delta === undefined
                ? null
                : Math.abs(Number(objTicker.delta));
            arrEnriched.push({
                ...objPosition,
                markPrice: vMarkPrice,
                entryDelta: objPosition.entryDelta ?? (Number.isFinite(Number(vCurrentDelta)) ? Number(vCurrentDelta) : null),
                pnl: calculateImportedPnl(objPosition, vMarkPrice),
                updatedAt: new Date().toISOString(),
                currentDelta: Number.isFinite(Number(vCurrentDelta)) ? Number(vCurrentDelta) : null,
                isOption: true
            });
        }
        return arrEnriched;
    }

    private async appendImportedPosition(
        pUserId: string,
        pPosition: RollingOptionsLtDeImportedPositionRecord
    ): Promise<void> {
        const arrExisting = await listRollingOptionsLtDeImportedPositions(pUserId);
        await this.persistImportedPositions(pUserId, [...arrExisting, pPosition]);
    }

    private getFutureEntrySide(pConfig: RollingOptionsPtDeConfig): "buy" | "sell" {
        return pConfig.action === "sell" ? "buy" : "sell";
    }

    private getRenkoOptionQty(pFutureQty: number, pQtyPct: number): number {
        const vBaseQty = Math.max(0, Number(pFutureQty || 0));
        const vPercent = Math.max(0, Number(pQtyPct || 0));

        if (!(vBaseQty > 0) || !(vPercent > 0)) {
            return 0;
        }

        return Math.max(1, Math.round(vBaseQty * vPercent / 100));
    }

    private async openGreenRenkoFutureEntry(
        pUserId: string,
        pConfig: RollingOptionsPtDeConfig,
        pPositions: RollingOptionsLtDeImportedPositionRecord[],
        pReason: string
    ): Promise<number> {
        const arrFutures = pPositions.filter((objRow) => !isOptionContract(objRow.contractName));
        const arrOptions = pPositions.filter((objRow) => isOptionContract(objRow.contractName));

        if (arrOptions.length > 0 || arrFutures.length <= 0) {
            return 0;
        }

        const vTotalFutureQty = arrFutures.reduce((pSum, objRow) => pSum + Math.max(0, Number(objRow.qty || 0)), 0);
        const vFutureQty = this.getRenkoOptionQty(vTotalFutureQty, pConfig.greenOptionQtyPct);
        if (!(vFutureQty > 0)) {
            return 0;
        }

        await this.openInitialFutureEntry(pUserId, pConfig, vFutureQty, pReason);
        return vFutureQty;
    }

    private async openInitialFutureEntry(
        pUserId: string,
        pConfig: RollingOptionsPtDeConfig,
        pQty: number,
        pReason: string
    ): Promise<RollingOptionsLtDeImportedPositionRecord> {
        const vQty = Math.max(1, Math.floor(Number(pQty || 1)));
        const vSide = this.getFutureEntrySide(pConfig);
        const objPlacedOrder = await this.placeManagedFutureEntryOrder(pUserId, pConfig, vQty);

        const objTrackedPosition: RollingOptionsLtDeImportedPositionRecord = {
            userId: pUserId,
            importId: crypto.randomUUID(),
            contractName: pConfig.contractName,
            side: vSide.toUpperCase(),
            qty: vQty,
            entryPrice: Number(objPlacedOrder.entryPrice || 0),
            markPrice: Number(objPlacedOrder.entryPrice || 0),
            entryDelta: null,
            currentDelta: null,
            charges: 0,
            pnl: 0,
            margin: 0,
            liquidationPrice: 0,
            openedAt: objPlacedOrder.entryTs,
            updatedAt: objPlacedOrder.entryTs
        };
        await this.appendImportedPosition(pUserId, objTrackedPosition);
        await logRollingOptionsLtDeEvent({
            userId: pUserId,
            eventType: pReason === "SL add one future" ? "extra_future_added" : "future_opened",
            severity: pReason === "SL add one future" ? "warning" : "success",
            title: pReason === "SL add one future" ? "Extra Future Added" : "Future Opened",
            message: `${objTrackedPosition.side} future live order placed from the server runner.`,
            payload: {
                symbol: pConfig.symbol,
                contractName: pConfig.contractName,
                qty: objTrackedPosition.qty,
                reason: pReason,
                orderType: objPlacedOrder.orderTypeUsed
            }
        });
        return objTrackedPosition;
    }

    private async openFutureAddition(
        pUserId: string,
        pConfig: RollingOptionsPtDeConfig,
        pSnapshot: RollingOptionsPtDeMarketSnapshot
    ): Promise<void> {
        const { client } = await this.getDeltaClient(pUserId);
        const vSide = pConfig.action === "sell" ? "buy" : "sell";
        await client.apis.Orders.placeOrder({
            order: {
                product_symbol: pConfig.contractName,
                size: 1,
                side: vSide,
                order_type: "market_order",
                time_in_force: "gtc",
                post_only: false,
                reduce_only: false
            }
        });

        await this.appendImportedPosition(pUserId, {
            userId: pUserId,
            importId: crypto.randomUUID(),
            contractName: pConfig.contractName,
            side: vSide.toUpperCase(),
            qty: 1,
            entryPrice: Number(pSnapshot.futuresPrice || 0),
            markPrice: Number(pSnapshot.futuresPrice || 0),
            entryDelta: null,
            currentDelta: null,
            charges: 0,
            pnl: 0,
            margin: 0,
            liquidationPrice: 0,
            openedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
        await logRollingOptionsLtDeEvent({
            userId: pUserId,
            eventType: "extra_future_added",
            severity: "warning",
            title: "Extra Future Added",
            message: "Added one more future lot after SL as configured.",
            payload: {
                symbol: pConfig.symbol,
                contractName: pConfig.contractName,
                qty: 1,
                reason: "sl_add_one_future"
            }
        });
    }

    private async openOptionEntries(
        pUserId: string,
        pConfig: RollingOptionsPtDeConfig,
        pQty: number,
        pTargetDelta: number,
        pReason: string,
        pColorCode: "R" | "G" = "R"
    ): Promise<RollingOptionsLtDeImportedPositionRecord[]> {
        if (!(Number(pQty) > 0)) {
            return [];
        }

        const { client } = await this.getDeltaClient(pUserId);
        const vPositionSide = pConfig.action === "buy" ? "BUY" : "SELL";
        const arrOptionSides: Array<"CE" | "PE"> = pConfig.legSide === "both"
            ? ["CE", "PE"]
            : [pConfig.legSide === "pe" ? "PE" : "CE"];
        const arrCreated: RollingOptionsLtDeImportedPositionRecord[] = [];
        const objRuleValues = this.getRuleValues(pConfig, pColorCode);

        for (const vOptionSide of arrOptionSides) {
            const objContract = await findBestLiveOptionContract(pConfig, vOptionSide, pTargetDelta);
            if (!objContract?.contractSymbol) {
                continue;
            }
            if (!this.meetsEntryDeltaRule(pConfig.action, objContract.delta, pTargetDelta)) {
                continue;
            }
            if (this.wouldOptionTriggerImmediately(objRuleValues, vPositionSide, Math.abs(objContract.delta))) {
                continue;
            }

            await client.apis.Orders.placeOrder({
                order: {
                    product_symbol: objContract.contractSymbol,
                    size: pQty,
                    side: pConfig.action,
                    order_type: "market_order",
                    time_in_force: "gtc",
                    post_only: false,
                    reduce_only: false
                }
            });

            arrCreated.push({
                userId: pUserId,
                importId: crypto.randomUUID(),
                contractName: objContract.contractSymbol,
                side: vPositionSide,
                qty: pQty,
                entryPrice: Number(objContract.markPrice || 0),
                markPrice: Number(objContract.markPrice || 0),
                entryDelta: Number.isFinite(Number(objContract.delta)) ? Math.abs(Number(objContract.delta)) : null,
                currentDelta: Number.isFinite(Number(objContract.delta)) ? Math.abs(Number(objContract.delta)) : null,
                charges: 0,
                pnl: 0,
                margin: 0,
                liquidationPrice: 0,
                metadata: this.buildOptionMetadata(pConfig, pColorCode, pReason),
                openedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            });
        }

        if (arrCreated.length > 0) {
            const arrExisting = await listRollingOptionsLtDeImportedPositions(pUserId);
            await this.persistImportedPositions(pUserId, [...arrExisting, ...arrCreated]);
            await logRollingOptionsLtDeEvent({
                userId: pUserId,
                eventType: pReason.toLowerCase().includes("replacement") || pReason.toLowerCase().includes("re-entry") ? "reentry_opened" : "option_opened",
                severity: "success",
                title: pReason.toLowerCase().includes("replacement") || pReason.toLowerCase().includes("re-entry") ? "Replacement Option Opened" : "Option Opened",
                message: `Opened ${arrCreated.length} live option leg${arrCreated.length === 1 ? "" : "s"} from the server runner.`,
                payload: {
                    symbol: pConfig.symbol,
                    qty: pQty,
                    reason: pReason
                }
            });
        }

        return arrCreated;
    }

    private async handleRenkoOptionEntry(
        pUserId: string,
        pConfig: RollingOptionsPtDeConfig,
        pPositions: RollingOptionsLtDeImportedPositionRecord[],
        pColorCode: "R" | "G"
    ): Promise<number> {
        if (pColorCode === "G") {
            return await this.openGreenRenkoFutureEntry(
                pUserId,
                pConfig,
                pPositions,
                "Renko GREEN future entry"
            );
        }

        const arrFutures = pPositions.filter((objRow) => !isOptionContract(objRow.contractName));
        const arrOptions = pPositions.filter((objRow) => isOptionContract(objRow.contractName));
        if (arrOptions.length > 0 || arrFutures.length <= 0) {
            return 0;
        }

        const vTotalFutureQty = arrFutures.reduce((pSum, objRow) => pSum + Math.max(0, Number(objRow.qty || 0)), 0);
        if (!(vTotalFutureQty > 0)) {
            return 0;
        }

        const vQtyPct = pColorCode === "R" ? pConfig.redOptionQtyPct : pConfig.greenOptionQtyPct;
        const vOptionQty = this.getRenkoOptionQty(vTotalFutureQty, vQtyPct);
        if (!(vOptionQty > 0)) {
            return 0;
        }
        const arrCreated = await this.openOptionEntries(
            pUserId,
            pConfig,
            vOptionQty,
            Number(pConfig.newDelta || 0.53),
            pColorCode === "R" ? "Renko RED option entry" : "Renko GREEN option entry",
            pColorCode
        );
        return arrCreated.length;
    }

    private async closeImportedPositionOnDelta(
        pUserId: string,
        pPosition: RollingOptionsLtDeImportedPositionRecord
    ): Promise<void> {
        const { client } = await this.getDeltaClient(pUserId);
        await client.apis.Orders.placeOrder({
            order: {
                product_symbol: pPosition.contractName,
                size: Math.max(1, Math.floor(Number(pPosition.qty || 0))),
                side: String(pPosition.side || "").trim().toUpperCase() === "BUY" ? "sell" : "buy",
                order_type: "market_order",
                time_in_force: "gtc",
                post_only: false,
                reduce_only: true
            }
        });
    }

    private async handleOptionTrigger(
        pUserId: string,
        pConfig: RollingOptionsPtDeConfig,
        pPosition: EnrichedImportedPosition,
        pReason: "sl" | "tp",
        pSnapshot: RollingOptionsPtDeMarketSnapshot
    ): Promise<void> {
        await this.closeImportedPositionOnDelta(pUserId, pPosition);
        const arrRemaining = (await listRollingOptionsLtDeImportedPositions(pUserId))
            .filter((objRow) => objRow.importId !== pPosition.importId);
        await this.persistImportedPositions(pUserId, arrRemaining);
        await logRollingOptionsLtDeEvent({
            userId: pUserId,
            eventType: pReason === "sl" ? "sl_triggered" : "tp_triggered",
            severity: pReason === "sl" ? "warning" : "info",
            title: pReason === "sl" ? "SL Triggered" : "TP Triggered",
            message: `Closed live position ${pPosition.contractName} from the server runner.`,
            payload: {
                symbol: pConfig.symbol,
                contractName: pPosition.contractName,
                qty: pPosition.qty,
                reason: pReason
            }
        });

        const vCurrentRenkoColor = String(this.getOrCreateState(pUserId).renko.lastColor || "").trim().toUpperCase();
        const vActiveRuleColor: "R" | "G" = pConfig.renkoEnabled && vCurrentRenkoColor === "G" ? "G" : "R";
        const objRuleValues = this.getRuleValues(pConfig, vActiveRuleColor);
        let arrNextPositions = arrRemaining;

        if (vActiveRuleColor === "R" && pReason === "sl" && pConfig.addOneLotFuture) {
            await this.openFutureAddition(pUserId, pConfig, pSnapshot);
            arrNextPositions = await listRollingOptionsLtDeImportedPositions(pUserId);
        }

        if (vActiveRuleColor === "R") {
            const vFutureQty = arrNextPositions
                .filter((objRow) => !isOptionContract(objRow.contractName))
                .reduce((pSum, objRow) => pSum + Math.max(0, Number(objRow.qty || 0)), 0);
            const vBaseQty = Math.max(0, vFutureQty || Number(pPosition.qty || 0));
            const vReEntryQty = this.getRenkoOptionQty(vBaseQty, pConfig.redOptionQtyPct);
            if (!(vReEntryQty > 0)) {
                return;
            }
            await this.openOptionEntries(
                pUserId,
                pConfig,
                vReEntryQty,
                objRuleValues.reDelta,
                pReason === "sl" ? "SL replacement option" : "TP replacement option",
                vActiveRuleColor
            );
            return;
        }

        if (pReason === "sl") {
            await this.openGreenRenkoFutureEntry(
                pUserId,
                pConfig,
                arrNextPositions,
                "SL GREEN future entry"
            );
        }
    }

    private async buildRuntimeRecord(
        pUserId: string,
        pConfig: RollingOptionsPtDeConfig,
        pState: RollingOptionsPtDeEngineState,
        pOverrides: Partial<RollingOptionsLtDeRuntimeRecord> = {}
    ): Promise<RollingOptionsLtDeRuntimeRecord> {
        const arrImported = await listRollingOptionsLtDeImportedPositions(pUserId);
        const arrWatchedSymbols = getLiveTickerSymbolsForOwner(this.getTickerOwnerId(pUserId));
        const objFeedStats = getLiveTickerFeedStats();
        const vLastSignal = pOverrides.lastSignal
            || (pState.renko.lastColor === "R" ? "RED" : (pState.renko.lastColor === "G" ? "GREEN" : "IDLE"));
        return {
            userId: pUserId,
            status: pOverrides.status || (pState.running ? "running" : "stopped"),
            autoTraderEnabled: pOverrides.autoTraderEnabled ?? pState.running,
            selectedApiProfileId: pOverrides.selectedApiProfileId || String((await loadRollingOptionsLtDeProfile(pUserId))?.selectedApiProfileId || ""),
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
                marketDataOwnerId: this.getTickerOwnerId(pUserId),
                marketDataConnectionState: objFeedStats.connectionState,
                marketDataOwnerCount: objFeedStats.ownerCount,
                marketDataDesiredSymbolCount: objFeedStats.desiredSymbolCount,
                marketDataCachedTickerCount: objFeedStats.cachedTickerCount,
                marketDataWatchedSymbols: arrWatchedSymbols,
                importedOpenPositions: arrImported.length,
                importedOptionPositions: arrImported.filter((objRow) => String(objRow.contractName || "").toUpperCase().startsWith("C-") || String(objRow.contractName || "").toUpperCase().startsWith("P-")).length,
                importedFuturePositions: arrImported.filter((objRow) => !(String(objRow.contractName || "").toUpperCase().startsWith("C-") || String(objRow.contractName || "").toUpperCase().startsWith("P-"))).length
            },
            updatedAt: ""
        };
    }

    private async syncRuntime(
        pUserId: string,
        pConfig: RollingOptionsPtDeConfig,
        pState: RollingOptionsPtDeEngineState,
        pOverrides: Partial<RollingOptionsLtDeRuntimeRecord> = {}
    ): Promise<RollingOptionsLtDeRuntimeRecord> {
        const objRuntime = await this.buildRuntimeRecord(pUserId, pConfig, pState, pOverrides);
        await this.runnerManager.setState({
            userId: pUserId,
            strategyType: "rolling-options-lt-de",
            status: objRuntime.status === "running" ? "running" : (objRuntime.status === "error" ? "error" : "stopped"),
            updatedAt: new Date().toISOString(),
            message: objRuntime.lastError || objRuntime.lastSignal || "Rolling Options LT Live",
            state: objRuntime.state
        });
        return saveRollingOptionsLtDeRuntime(objRuntime);
    }

    public async startUser(pUserId: string): Promise<RollingOptionsLtDeRuntimeRecord> {
        const objConfig = await this.loadConfig(pUserId);
        const objProfile = await loadRollingOptionsLtDeProfile(pUserId);
        const objState = this.getOrCreateState(pUserId);
        objState.running = true;
        objState.lastError = "";
        this.armTimer(objState, objConfig.loopSeconds);
        await this.runCycle(pUserId);
        return this.syncRuntime(pUserId, objConfig, objState, {
            status: "running",
            autoTraderEnabled: true,
            selectedApiProfileId: String(objProfile?.selectedApiProfileId || "")
        });
    }

    public async stopUser(pUserId: string): Promise<RollingOptionsLtDeRuntimeRecord> {
        const objConfig = await this.loadConfig(pUserId);
        const objProfile = await loadRollingOptionsLtDeProfile(pUserId);
        const objState = this.getOrCreateState(pUserId);
        objState.running = false;
        if (objState.timerRef) {
            clearInterval(objState.timerRef);
            objState.timerRef = null;
        }
        this.releaseTickerScope(pUserId);
        return this.syncRuntime(pUserId, objConfig, objState, {
            status: "stopped",
            autoTraderEnabled: false,
            selectedApiProfileId: String(objProfile?.selectedApiProfileId || "")
        });
    }

    public async emergencyStopUser(pUserId: string): Promise<{
        runtime: RollingOptionsLtDeRuntimeRecord;
        closedPositions: RollingOptionsLtDeImportedPositionRecord[];
    }> {
        const arrOpenPositions = await listRollingOptionsLtDeImportedPositions(pUserId);
        const objConfig = await this.loadConfig(pUserId);
        const arrClosedPositions: RollingOptionsLtDeImportedPositionRecord[] = [];

        for (const objPosition of arrOpenPositions) {
            await this.closeImportedPositionOnDelta(pUserId, objPosition);
            arrClosedPositions.push(objPosition);
        }

        await this.persistImportedPositions(pUserId, []);
        const objRuntime = await this.stopUser(pUserId);

        await logRollingOptionsLtDeEvent({
            userId: pUserId,
            eventType: "kill_switch",
            severity: "warning",
            title: "Kill Switch Executed",
            message: arrClosedPositions.length > 0
                ? `Kill switch closed ${arrClosedPositions.length} live position${arrClosedPositions.length === 1 ? "" : "s"} and stopped the live runner.`
                : "Kill switch stopped the live runner. No saved imported live positions were open.",
            payload: {
                symbol: objConfig.symbol,
                qty: arrClosedPositions.length,
                reason: "kill_switch"
            }
        });

        return {
            runtime: objRuntime,
            closedPositions: arrClosedPositions
        };
    }

    public async setManualRenkoSignal(
        pUserId: string,
        pColorCode: "R" | "G"
    ): Promise<RollingOptionsLtDeRuntimeRecord> {
        const objState = this.getOrCreateState(pUserId);
        const objConfig = await this.loadConfig(pUserId);
        const vColorCode = pColorCode === "G" ? "G" : "R";

        objState.renko.lastColor = vColorCode;
        objState.renko.lastDir = vColorCode === "R" ? -1 : 1;
        objState.lastError = "";
        objState.lastCycleAt = new Date().toISOString();

        await logRollingOptionsLtDeEvent({
            userId: pUserId,
            eventType: "renko_change_detected",
            severity: "info",
            title: "Renko Change Detected",
            message: `Manual Renko signal changed to ${vColorCode === "R" ? "RED" : "GREEN"}.`,
            payload: {
                symbol: objConfig.symbol,
                reason: vColorCode === "R" ? "manual_renko_red" : "manual_renko_green",
                renkoColor: vColorCode
            }
        });

        const objRuntime = await this.syncRuntime(pUserId, objConfig, objState, {
            status: objState.running ? "running" : "stopped",
            autoTraderEnabled: objState.running,
            lastSignal: vColorCode === "R" ? "MANUAL_RED" : "MANUAL_GREEN",
            lastCycleAt: objState.lastCycleAt,
            lastError: ""
        });

        if (!objState.running) {
            return objRuntime;
        }

        await this.runCycle(pUserId);
        return await loadRollingOptionsLtDeRuntime(pUserId) || objRuntime;
    }

    public async executeStrategy(
        pUserId: string,
        pRenkoColorCode?: "R" | "G"
    ): Promise<{ status: string; message: string; }> {
        const objState = this.getOrCreateState(pUserId);
        const objConfig = await this.loadConfig(pUserId);
        const vRenkoColor = pRenkoColorCode === "G"
            ? "G"
            : ((pRenkoColorCode === "R" ? "R" : objState.renko.lastColor) === "G" ? "G" : "R");

        objState.renko.lastColor = vRenkoColor;
        objState.renko.lastDir = vRenkoColor === "R" ? -1 : 1;
        objState.lastError = "";

        const arrExistingPositions = await listRollingOptionsLtDeImportedPositions(pUserId);
        const arrExistingFutures = arrExistingPositions.filter((objRow) => !isOptionContract(objRow.contractName));
        const arrExistingOptions = arrExistingPositions.filter((objRow) => isOptionContract(objRow.contractName));
        const bHadTrackedOptions = arrExistingOptions.length > 0;
        let bOpenedFuture = false;
        let bOpenedOption = false;

        if (arrExistingFutures.length <= 0) {
            await this.openInitialFutureEntry(
                pUserId,
                objConfig,
                Math.max(1, Math.floor(Number(objConfig.futureQty || 1))),
                "Strategy initial future"
            );
            bOpenedFuture = true;
        }

        const arrUpdatedPositions = await listRollingOptionsLtDeImportedPositions(pUserId);
        const vTotalFutureQty = arrUpdatedPositions
            .filter((objRow) => !isOptionContract(objRow.contractName))
            .reduce((pSum, objRow) => pSum + Math.max(0, Number(objRow.qty || 0)), 0);

        if (arrExistingOptions.length <= 0 && vTotalFutureQty > 0 && vRenkoColor === "R") {
            const arrCreatedOptions = await this.handleRenkoOptionEntry(
                pUserId,
                objConfig,
                arrUpdatedPositions,
                vRenkoColor
            );
            bOpenedOption = arrCreatedOptions > 0;
        }

        objState.lastCycleAt = new Date().toISOString();
        await this.syncRuntime(pUserId, objConfig, objState, {
            status: objState.running ? "running" : "stopped",
            autoTraderEnabled: objState.running,
            lastSignal: vRenkoColor === "R" ? "EXEC_STRATEGY_RED" : "EXEC_STRATEGY_GREEN",
            lastCycleAt: objState.lastCycleAt,
            lastError: ""
        });
        await logRollingOptionsLtDeEvent({
            userId: pUserId,
            eventType: "strategy_executed",
            severity: "success",
            title: "Strategy Executed",
            message: bOpenedFuture || bOpenedOption
                ? "Initial live strategy entry executed."
                : "Live strategy execution skipped because tracked positions already exist.",
            payload: {
                symbol: objConfig.symbol,
                reason: "strategy_execute",
                renkoColor: vRenkoColor,
                openedFuture: bOpenedFuture,
                openedOption: bOpenedOption
            }
        });

        return {
            status: bOpenedFuture || bOpenedOption ? "success" : "warning",
            message: bOpenedFuture || bOpenedOption
                ? `Live strategy executed using ${vRenkoColor === "R" ? "RED" : "GREEN"} Renko sizing.`
                : (bHadTrackedOptions
                    ? "Strategy execution skipped because option positions are already tracked."
                    : "No option entry was placed from the current Renko state.")
        };
    }

    public async runCycle(pUserId: string): Promise<{ status: string; message: string; }> {
        const objState = this.getOrCreateState(pUserId);
        if (objState.isBusy) {
            return { status: "warning", message: "Live cycle already in progress." };
        }

        objState.isBusy = true;
        try {
            const objConfig = await this.loadConfig(pUserId);
            const objProfile = await loadRollingOptionsLtDeProfile(pUserId);
            const arrCurrentPositions = await this.reconcileUserPositions(pUserId, objConfig.symbol);
            this.refreshTickerScope(pUserId, [
                objConfig.contractName,
                ...arrCurrentPositions
                    .filter((objRow) => isOptionContract(objRow.contractName))
                    .map((objRow) => String(objRow.contractName || "").trim())
                    .filter(Boolean)
            ]);
            const objSnapshot = await this.getMarketSnapshot(objConfig);
            objState.market.lastSpotPrice = objSnapshot.spotPrice;
            objState.market.lastFuturesPrice = objSnapshot.futuresPrice;
            objState.market.lastSource = objSnapshot.priceSource;
            let vPreviousRenkoColor = String(objState.renko.lastColor || "").trim().toUpperCase() === "G" ? "G" : "R";
            if (String(objState.renko.lastColor || "").trim().toUpperCase() !== "G" && String(objState.renko.lastColor || "").trim().toUpperCase() !== "R") {
                vPreviousRenkoColor = "";
            }
            const arrRenkoSignals = objConfig.renkoEnabled
                ? updateRenkoState(objState, objSnapshot, objConfig)
                : [];

            for (const vRenkoSignal of arrRenkoSignals) {
                if (!objState.running) {
                    break;
                }
                const bRenkoColorChanged = vPreviousRenkoColor !== vRenkoSignal;
                if (bRenkoColorChanged) {
                    await logRollingOptionsLtDeEvent({
                        userId: pUserId,
                        eventType: "renko_change_detected",
                        severity: "info",
                        title: "Renko Change Detected",
                        message: vPreviousRenkoColor
                            ? `Renko changed from ${vPreviousRenkoColor === "R" ? "RED" : "GREEN"} to ${vRenkoSignal === "R" ? "RED" : "GREEN"}.`
                            : `Renko changed to ${vRenkoSignal === "R" ? "RED" : "GREEN"}.`,
                        payload: {
                            symbol: objConfig.symbol,
                            reason: vRenkoSignal === "R" ? "renko_red_brick" : "renko_green_brick",
                            renkoColor: vRenkoSignal,
                            previousRenkoColor: vPreviousRenkoColor || ""
                        }
                    });
                    vPreviousRenkoColor = vRenkoSignal;
                }
                if (vRenkoSignal === "G" && !bRenkoColorChanged) {
                    continue;
                }
                const arrPositionsBeforeEntry = await listRollingOptionsLtDeImportedPositions(pUserId);
                await this.handleRenkoOptionEntry(pUserId, objConfig, arrPositionsBeforeEntry, vRenkoSignal);
            }

            if (objState.running && objState.renko.lastColor === "R") {
                const arrPositionsBeforeFallbackEntry = await listRollingOptionsLtDeImportedPositions(pUserId);
                await this.handleRenkoOptionEntry(
                    pUserId,
                    objConfig,
                    arrPositionsBeforeFallbackEntry,
                    "R"
                );
            }

            const arrRefreshedPositions = await this.refreshImportedPositions(
                objConfig,
                objSnapshot,
                await listRollingOptionsLtDeImportedPositions(pUserId)
            );
            await this.persistImportedPositions(pUserId, arrRefreshedPositions.map((objRow) => ({
                userId: objRow.userId,
                importId: objRow.importId,
                contractName: objRow.contractName,
                side: objRow.side,
                qty: objRow.qty,
                entryPrice: objRow.entryPrice,
                markPrice: objRow.markPrice,
                entryDelta: objRow.entryDelta,
                currentDelta: objRow.currentDelta,
                charges: objRow.charges,
                pnl: objRow.pnl,
                margin: objRow.margin,
                liquidationPrice: objRow.liquidationPrice,
                metadata: objRow.metadata,
                openedAt: objRow.openedAt,
                updatedAt: objRow.updatedAt
            })));

            let vTriggerSignal = "";
            for (const objPosition of arrRefreshedPositions) {
                if (!objState.running || !objPosition.isOption || !Number.isFinite(Number(objPosition.currentDelta))) {
                    continue;
                }

                const vStoredTakeProfitDelta = Number(objPosition.metadata?.takeProfitDelta);
                const vStoredStopLossDelta = Number(objPosition.metadata?.stopLossDelta);
                const objDecision = shouldTriggerImportedOption(
                    objPosition.side,
                    Number(objPosition.currentDelta),
                    Number.isFinite(vStoredTakeProfitDelta) ? vStoredTakeProfitDelta : Number(objConfig.deltaTakeProfit || 0),
                    Number.isFinite(vStoredStopLossDelta) ? vStoredStopLossDelta : Number(objConfig.deltaStopLoss || 0)
                );
                if (objDecision.shouldAct && objDecision.reason) {
                    await this.handleOptionTrigger(pUserId, objConfig, objPosition, objDecision.reason, objSnapshot);
                    vTriggerSignal = objDecision.reason === "sl" ? "SL_TRIGGERED" : "TP_TRIGGERED";
                    break;
                }
            }

            objState.cycleCount += 1;
            objState.consecutiveFailures = 0;
            objState.lastError = "";
            objState.lastCycleAt = objSnapshot.ts;
            this.lastErrorLogByUserId.delete(pUserId);

            await this.syncRuntime(pUserId, objConfig, objState, {
                status: objState.running ? "running" : "paused",
                autoTraderEnabled: objState.running,
                selectedApiProfileId: String(objProfile?.selectedApiProfileId || ""),
                lastSpotPrice: objSnapshot.spotPrice,
                lastFuturesPrice: objSnapshot.futuresPrice,
                lastCycleAt: objSnapshot.ts,
                lastSignal: vTriggerSignal || (arrRenkoSignals.at(-1)
                    ? (arrRenkoSignals.at(-1) === "R" ? "RED" : "GREEN")
                    : (objState.renko.lastColor === "R" ? "RED" : (objState.renko.lastColor === "G" ? "GREEN" : "IDLE")))
            });

            return {
                status: "success",
                message: vTriggerSignal
                    ? `Live cycle completed with ${vTriggerSignal === "SL_TRIGGERED" ? "SL" : "TP"} execution.`
                    : (arrRenkoSignals.length
                        ? `Live cycle completed with Renko ${arrRenkoSignals.at(-1) === "R" ? "RED" : "GREEN"} signal.`
                        : "Live cycle completed.")
            };
        }
        catch (objError) {
            const objConfig = await this.loadConfig(pUserId);
            const objProfile = await loadRollingOptionsLtDeProfile(pUserId);
            objState.consecutiveFailures += 1;
            objState.lastError = objError instanceof Error ? objError.message : "Live cycle failed.";
            await this.syncRuntime(pUserId, objConfig, objState, {
                status: "error",
                autoTraderEnabled: objState.running,
                selectedApiProfileId: String(objProfile?.selectedApiProfileId || ""),
                lastError: objState.lastError
            });
            if (this.shouldLogCycleError(pUserId, objState.lastError)) {
                await logRollingOptionsLtDeEvent({
                    userId: pUserId,
                    eventType: "engine_error",
                    severity: "error",
                    title: "Live Runner Error",
                    message: objState.lastError,
                    payload: {
                        symbol: objConfig.symbol,
                        reason: "engine_error"
                    }
                });
            }
            return {
                status: "danger",
                message: objState.lastError
            };
        }
        finally {
            objState.isBusy = false;
        }
    }
}
