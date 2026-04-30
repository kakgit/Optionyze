import crypto from "node:crypto";
import type { Request, Response } from "express";
import {
    estimatePositionCharges,
    getPositionPnl,
} from "../../strategies/rolling-options-pt-de/engine";
import { applyClosedOptionPnlToProfile } from "../../strategies/rolling-options-pt-de/options-pnl";
import {
    clearRollingOptionsPtDeClosedPositions,
    listRollingOptionsPtDeClosedPositions,
    listRollingOptionsPtDeOpenPositions,
    saveRollingOptionsPtDePosition,
    type RollingOptionsPtDePositionRecord
} from "../../storage/rolling-options-pt-de-position-store";
import { listRollingOptionsPtDeEvents } from "../../storage/rolling-options-pt-de-event-store";
import { clearRollingOptionsPtDeEvents } from "../../storage/rolling-options-pt-de-event-store";
import {
    loadRollingOptionsPtDeProfile,
    saveRollingOptionsPtDeProfile,
    type RollingOptionsPtDeProfileRecord
} from "../../storage/rolling-options-pt-de-profile-store";
import {
    loadRollingOptionsPtDeRuntime,
    saveRollingOptionsPtDeRuntime,
    type RollingOptionsPtDeRuntimeRecord
} from "../../storage/rolling-options-pt-de-runtime-store";
import type { RollingOptionsPtDeService } from "../../strategies/rolling-options-pt-de/service";
import { gRollingOptionsTelegramEventTypes, logRollingOptionsPtDeEvent } from "../../strategies/rolling-options-pt-de/event-logger";

function getUserIdFromReq(pReq: Request): string {
    const vUserId = String(pReq.authAccount?.accountId || pReq.body?.userId || pReq.query?.userId || "demo-paper").trim();
    return vUserId || "demo-paper";
}

function getDefaultUiState(): Record<string, unknown> {
    return {
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
        autoOptQtyPct: 100,
        addOneLotFuture: false,
        renkoFeedEnabled: true,
        renkoFeedPts: 10,
        renkoFeedPriceSrc: "spot_price",
        optionsPnl: 0,
        telegramAlertsEnabled: false,
        telegramAlertTypes: [
            "engine_started",
            "engine_stopped",
            "engine_error",
            "sl_triggered",
            "tp_triggered",
            "reentry_opened",
            "kill_switch"
        ],
        closedFromDate: "",
        closedToDate: ""
    };
}

function getContractNameForSymbol(pSymbol: string): string {
    const vSymbol = String(pSymbol || "").trim().toUpperCase();
    if (vSymbol === "ETH") {
        return "ETHUSD";
    }
    return "BTCUSD";
}

function getLotSizeForSymbol(pSymbol: string): number {
    const vSymbol = String(pSymbol || "").trim().toUpperCase();
    return vSymbol === "ETH" ? 0.01 : 0.001;
}

function normalizeNumber(pValue: unknown, pFallback: number): number {
    const vNumber = Number(pValue);
    return Number.isFinite(vNumber) ? vNumber : pFallback;
}

async function getMergedUiState(pUserId: string): Promise<Record<string, unknown>> {
    const objProfile = await loadRollingOptionsPtDeProfile(pUserId);
    return {
        ...getDefaultUiState(),
        ...(objProfile?.uiState || {})
    };
}

async function getDefaultRuntimeState(pUserId: string): Promise<RollingOptionsPtDeRuntimeRecord> {
    const objUiState = await getMergedUiState(pUserId);
    const vSymbol = String(objUiState.symbol || "BTC").trim().toUpperCase() || "BTC";

    return {
        userId: pUserId,
        status: "idle",
        autoTraderEnabled: false,
        currentSymbol: vSymbol,
        currentContractName: getContractNameForSymbol(vSymbol),
        currentExpiryMode: String(objUiState.expiryMode1 || "1"),
        currentExpiryDate: String(objUiState.expiryDate1 || ""),
        renkoEnabled: Boolean(objUiState.renkoFeedEnabled ?? true),
        renkoPoints: Number(objUiState.renkoFeedPts || 10),
        renkoSource: String(objUiState.renkoFeedPriceSrc || "spot_price"),
        lastSpotPrice: null,
        lastFuturesPrice: null,
        lastSignal: "IDLE",
        lastCycleAt: "",
        lastError: "",
        state: {},
        updatedAt: ""
    };
}

async function loadEffectiveRuntimeState(pUserId: string): Promise<RollingOptionsPtDeRuntimeRecord> {
    return await loadRollingOptionsPtDeRuntime(pUserId) || await getDefaultRuntimeState(pUserId);
}

function getBaseSpotPriceForSymbol(pSymbol: string): number {
    return String(pSymbol || "").trim().toUpperCase() === "ETH" ? 3200 : 64000;
}

function getSimulatedSpotPrice(pSymbol: string): number {
    const vBase = getBaseSpotPriceForSymbol(pSymbol);
    return Number((vBase + ((Date.now() % 1000) - 500) / 10).toFixed(2));
}

function getSimulatedFuturePrice(pSymbol: string): number {
    const vSpotPrice = getSimulatedSpotPrice(pSymbol);
    return Number((vSpotPrice * 1.0012).toFixed(2));
}

function getSimulatedOptionPrice(pSymbol: string, pDelta: number): number {
    const vSpotPrice = getSimulatedSpotPrice(pSymbol);
    const vPremiumFactor = Math.max(0.0025, Math.min(Math.abs(pDelta) * 0.018, 0.02));
    return Number((vSpotPrice * vPremiumFactor).toFixed(2));
}

function createPositionBase(pUserId: string): Pick<
    RollingOptionsPtDePositionRecord,
    "positionId" | "userId" | "groupId" | "cycleId" | "createdAt" | "updatedAt"
> {
    const vNow = new Date().toISOString();
    return {
        positionId: crypto.randomUUID(),
        userId: pUserId,
        groupId: `group_${Date.now()}`,
        cycleId: `manual_${Date.now()}`,
        createdAt: vNow,
        updatedAt: vNow
    };
}

async function updateRuntimeFromUiState(
    pUserId: string,
    pOverrides: Partial<RollingOptionsPtDeRuntimeRecord> = {}
): Promise<RollingOptionsPtDeRuntimeRecord> {
    const objRuntime = await loadEffectiveRuntimeState(pUserId);
    const objUiState = await getMergedUiState(pUserId);
    const vSymbol = String(objUiState.symbol || objRuntime.currentSymbol || "BTC").trim().toUpperCase() || "BTC";
    const objNextRuntime: RollingOptionsPtDeRuntimeRecord = {
        ...objRuntime,
        currentSymbol: vSymbol,
        currentContractName: getContractNameForSymbol(vSymbol),
        currentExpiryMode: String(objUiState.expiryMode1 || objRuntime.currentExpiryMode || "1"),
        currentExpiryDate: String(objUiState.expiryDate1 || objRuntime.currentExpiryDate || ""),
        renkoEnabled: Boolean(objUiState.renkoFeedEnabled ?? objRuntime.renkoEnabled),
        renkoPoints: Number(objUiState.renkoFeedPts || objRuntime.renkoPoints || 10),
        renkoSource: String(objUiState.renkoFeedPriceSrc || objRuntime.renkoSource || "spot_price"),
        updatedAt: "",
        ...pOverrides
    };

    return saveRollingOptionsPtDeRuntime(objNextRuntime);
}

async function closeOpenPositionsByInstrument(
    pUserId: string,
    pInstrumentType: "OPTION" | "FUTURE" | "ALL",
    pReason: string
): Promise<RollingOptionsPtDePositionRecord[]> {
    const objOpenPositions = await listRollingOptionsPtDeOpenPositions(pUserId);
    const objTargetPositions = objOpenPositions.filter((objPosition) => {
        return pInstrumentType === "ALL" || objPosition.instrumentType === pInstrumentType;
    });

    const objClosedPositions: RollingOptionsPtDePositionRecord[] = [];

    for (const objPosition of objTargetPositions) {
        const vExitPrice = objPosition.instrumentType === "FUTURE"
            ? getSimulatedFuturePrice(objPosition.symbol)
            : getSimulatedOptionPrice(objPosition.symbol, objPosition.exitDelta ?? objPosition.entryDelta ?? 0.53);
        const vExitCharges = estimatePositionCharges(objPosition.instrumentType, objPosition.qty, objPosition.lotSize, vExitPrice);
        const vPnl = getPositionPnl(objPosition, vExitPrice);
        const objClosed = await saveRollingOptionsPtDePosition({
            ...objPosition,
            status: "CLOSED",
            exitPrice: vExitPrice,
            markPrice: vExitPrice,
            charges: Number((Number(objPosition.charges || 0) + vExitCharges).toFixed(4)),
            pnl: vPnl,
            closedReason: pReason,
            closedAt: new Date().toISOString(),
            updatedAt: ""
        });
        objClosedPositions.push(objClosed);
    }

    if (objClosedPositions.length > 0) {
        await applyClosedOptionPnlToProfile(pUserId, objClosedPositions);
    }

    return objClosedPositions;
}

export function renderRollingOptionsPaperDemoPage(req: Request, res: Response): void {
    res.render("rolling-options-pt-de", {
        pageTitle: "Rolling Options - Demo | Optionyze",
        currentAccount: req.authAccount,
        rollingTelegramEventTypes: gRollingOptionsTelegramEventTypes
    });
}

export async function getRollingOptionsPtDeProfile(req: Request, res: Response): Promise<void> {
    const vUserId = getUserIdFromReq(req);
    const objProfile = await loadRollingOptionsPtDeProfile(vUserId);

    res.json({
        status: "success",
        data: {
            userId: vUserId,
            uiState: {
                ...getDefaultUiState(),
                ...(objProfile?.uiState || {})
            },
            updatedAt: objProfile?.updatedAt || ""
        }
    });
}

export async function saveRollingOptionsPtDeProfileController(req: Request, res: Response): Promise<void> {
    const vUserId = getUserIdFromReq(req);
    const objExisting = await loadRollingOptionsPtDeProfile(vUserId);

    const objProfile: RollingOptionsPtDeProfileRecord = {
        userId: vUserId,
        uiState: {
            ...getDefaultUiState(),
            ...(objExisting?.uiState || {}),
            ...((req.body?.uiState || {}) as Record<string, unknown>)
        },
        updatedAt: ""
    };

    const objSaved = await saveRollingOptionsPtDeProfile(objProfile);
    res.json({ status: "success", data: objSaved });
}

export async function getRollingOptionsPtDeStatus(req: Request, res: Response): Promise<void> {
    const vUserId = getUserIdFromReq(req);
    const objRuntime = await loadRollingOptionsPtDeRuntime(vUserId);
    const objOpenPositions = await listRollingOptionsPtDeOpenPositions(vUserId);
    const objClosedPositions = await listRollingOptionsPtDeClosedPositions(vUserId);
    const objStatus = objRuntime || await getDefaultRuntimeState(vUserId);

    res.json({
        status: "success",
        data: {
            ...objStatus,
            counts: {
                openPositions: objOpenPositions.length,
                closedPositions: objClosedPositions.length
            }
        }
    });
}

export async function getRollingOptionsPtDeOpenPositions(req: Request, res: Response): Promise<void> {
    const vUserId = getUserIdFromReq(req);
    const objRows = await listRollingOptionsPtDeOpenPositions(vUserId);

    res.json({
        status: "success",
        data: objRows
    });
}

export async function getRollingOptionsPtDeClosedPositions(req: Request, res: Response): Promise<void> {
    const vUserId = getUserIdFromReq(req);
    const vFromDate = String(req.query?.fromDate || "").trim();
    const vToDate = String(req.query?.toDate || "").trim();
    const objRows = await listRollingOptionsPtDeClosedPositions(vUserId, {
        fromDate: vFromDate,
        toDate: vToDate
    });

    res.json({
        status: "success",
        data: objRows
    });
}

export async function getRollingOptionsPtDeEvents(req: Request, res: Response): Promise<void> {
    const vUserId = getUserIdFromReq(req);
    const objRows = await listRollingOptionsPtDeEvents(vUserId, 100);
    res.json({
        status: "success",
        data: objRows
    });
}

export async function toggleRollingOptionsPtDeAutoTrader(
    req: Request,
    res: Response,
    pService: RollingOptionsPtDeService
): Promise<void> {
    const vUserId = getUserIdFromReq(req);
    const objRuntime = await loadEffectiveRuntimeState(vUserId);
    const objResult = objRuntime.autoTraderEnabled
        ? await pService.stop(vUserId)
        : await pService.start(vUserId);
    const objSaved = await loadEffectiveRuntimeState(vUserId);
    res.json({ status: objResult.status, message: objResult.message, data: objSaved });
}

export async function executeRollingOptionsPtDeManualFuture(req: Request, res: Response): Promise<void> {
    const vUserId = getUserIdFromReq(req);
    const objUiState = await getMergedUiState(vUserId);
    const vSymbol = String(objUiState.symbol || "BTC").trim().toUpperCase() || "BTC";
    const vAction = String(req.body?.action || "SELL").trim().toUpperCase() === "BUY" ? "BUY" : "SELL";
    const vQty = Math.max(1, Math.floor(normalizeNumber(objUiState.manualFutQty, 1)));
    const vLotSize = getLotSizeForSymbol(vSymbol);
    const vEntryPrice = getSimulatedFuturePrice(vSymbol);
    const vNow = new Date().toISOString();

    const objPosition: RollingOptionsPtDePositionRecord = {
        ...createPositionBase(vUserId),
        status: "OPEN",
        symbol: vSymbol,
        contractName: `${getContractNameForSymbol(vSymbol)} FUT`,
        instrumentType: "FUTURE",
        optionSide: "",
        action: vAction,
        strike: null,
        expiryDate: String(objUiState.expiryDate1 || ""),
        qty: vQty,
        lotSize: vLotSize,
        entryPrice: vEntryPrice,
        exitPrice: null,
        markPrice: vEntryPrice,
        entryDelta: null,
        exitDelta: null,
        charges: estimatePositionCharges("FUTURE", vQty, vLotSize, vEntryPrice),
        pnl: 0,
        openedReason: `Manual ${vAction} FUT`,
        closedReason: "",
        openedAt: vNow,
        closedAt: "",
        metadata: {
            orderType: String(objUiState.manualFutOrderType || "market_order"),
            source: "demo-manual-future"
        }
    };

    const objSavedPosition = await saveRollingOptionsPtDePosition(objPosition);
    const objRuntime = await updateRuntimeFromUiState(vUserId, {
        status: "running",
        currentSymbol: vSymbol,
        currentContractName: getContractNameForSymbol(vSymbol),
        lastFuturesPrice: vEntryPrice,
        lastSpotPrice: getSimulatedSpotPrice(vSymbol),
        lastSignal: `MANUAL_${vAction}_FUT`,
        lastCycleAt: vNow,
        lastError: ""
    });
    await logRollingOptionsPtDeEvent({
        userId: vUserId,
        eventType: "manual_action",
        severity: "info",
        title: `Manual ${vAction} Future`,
        message: `${vAction} future paper position opened.`,
        payload: {
            symbol: vSymbol,
            contractName: objPosition.contractName,
            qty: vQty,
            reason: "manual_future"
        }
    });

    res.json({ status: "success", data: { position: objSavedPosition, runtime: objRuntime } });
}

export async function executeRollingOptionsPtDeManualOption(req: Request, res: Response): Promise<void> {
    const vUserId = getUserIdFromReq(req);
    const objUiState = await getMergedUiState(vUserId);
    const vSymbol = String(objUiState.symbol || "BTC").trim().toUpperCase() || "BTC";
    const vAction = String(objUiState.action1 || "sell").trim().toUpperCase() === "BUY" ? "BUY" : "SELL";
    const vLegSide = String(objUiState.legSide1 || "ce").trim().toUpperCase();
    const vQty = Math.max(1, Math.floor(normalizeNumber(objUiState.manualOptQty1, 1)));
    const vLotSize = getLotSizeForSymbol(vSymbol);
    const vExpiryDate = String(objUiState.expiryDate1 || "");
    const vDelta = normalizeNumber(objUiState.newDelta1, 0.53);
    const vSpotPrice = getSimulatedSpotPrice(vSymbol);
    const vStrike = Math.round(vSpotPrice / 100) * 100;
    const objSides: Array<"CE" | "PE"> = vLegSide === "BOTH" ? ["CE", "PE"] : [vLegSide === "PE" ? "PE" : "CE"];
    const vNow = new Date().toISOString();
    const objSavedPositions: RollingOptionsPtDePositionRecord[] = [];

    for (const vOptionSide of objSides) {
        const vEntryPrice = getSimulatedOptionPrice(vSymbol, vDelta);
        const objPosition: RollingOptionsPtDePositionRecord = {
            ...createPositionBase(vUserId),
            status: "OPEN",
            symbol: vSymbol,
            contractName: `${getContractNameForSymbol(vSymbol)} ${vOptionSide}`,
            instrumentType: "OPTION",
            optionSide: vOptionSide,
            action: vAction,
            strike: vStrike,
            expiryDate: vExpiryDate,
            qty: vQty,
            lotSize: vLotSize,
            entryPrice: vEntryPrice,
            exitPrice: null,
            markPrice: vEntryPrice,
            entryDelta: vDelta,
            exitDelta: vDelta,
            charges: estimatePositionCharges("OPTION", vQty, vLotSize, vEntryPrice),
            pnl: 0,
            openedReason: `Manual ${vAction} ${vOptionSide}`,
            closedReason: "",
            openedAt: vNow,
            closedAt: "",
            metadata: {
                expiryMode: String(objUiState.expiryMode1 || "1"),
                takeProfitDelta: normalizeNumber(objUiState.deltaTp1, 0.15),
                stopLossDelta: normalizeNumber(objUiState.deltaSl1, 0.85),
                reEnter: Boolean(objUiState.reEnter1),
                source: "demo-manual-option"
            }
        };

        objSavedPositions.push(await saveRollingOptionsPtDePosition(objPosition));
    }

    const objRuntime = await updateRuntimeFromUiState(vUserId, {
        status: "running",
        currentSymbol: vSymbol,
        currentContractName: getContractNameForSymbol(vSymbol),
        lastSpotPrice: vSpotPrice,
        lastSignal: `MANUAL_OPEN_OPTION_${vLegSide === "BOTH" ? "BOTH" : vLegSide}`,
        lastCycleAt: vNow,
        lastError: ""
    });
    await logRollingOptionsPtDeEvent({
        userId: vUserId,
        eventType: "manual_action",
        severity: "info",
        title: "Manual Option Open",
        message: `Opened ${objSavedPositions.length} manual option paper leg(s).`,
        payload: {
            symbol: vSymbol,
            qty: vQty,
            reason: "manual_option_open"
        }
    });

    res.json({ status: "success", data: { positions: objSavedPositions, runtime: objRuntime } });
}

export async function exitRollingOptionsPtDeManualPositions(req: Request, res: Response): Promise<void> {
    const vUserId = getUserIdFromReq(req);
    const vInstrumentParam = String(req.body?.instrumentType || "ALL").trim().toUpperCase();
    const vInstrumentType = vInstrumentParam === "OPTION" || vInstrumentParam === "FUTURE"
        ? vInstrumentParam
        : "ALL";
    const objClosedPositions = await closeOpenPositionsByInstrument(
        vUserId,
        vInstrumentType,
        `Manual exit ${vInstrumentType.toLowerCase()}`
    );
    const objRuntime = await updateRuntimeFromUiState(vUserId, {
        status: "stopped",
        lastSignal: `MANUAL_EXIT_${vInstrumentType}`,
        lastCycleAt: new Date().toISOString(),
        lastError: ""
    });
    await logRollingOptionsPtDeEvent({
        userId: vUserId,
        eventType: vInstrumentType === "ALL" ? "kill_switch" : "manual_action",
        severity: vInstrumentType === "ALL" ? "warning" : "info",
        title: vInstrumentType === "ALL" ? "Kill Switch Executed" : `Manual Exit ${vInstrumentType}`,
        message: `Closed ${objClosedPositions.length} ${vInstrumentType.toLowerCase()} paper position(s).`,
        payload: {
            qty: objClosedPositions.length,
            reason: `manual_exit_${vInstrumentType.toLowerCase()}`
        }
    });

    res.json({
        status: "success",
        data: {
            closedCount: objClosedPositions.length,
            positions: objClosedPositions,
            runtime: objRuntime
        }
    });
}

export async function runRollingOptionsPtDeStrategyExecution(
    req: Request,
    res: Response,
    pService: RollingOptionsPtDeService
): Promise<void> {
    const vUserId = getUserIdFromReq(req);
    const objResult = await pService.executeStrategy(vUserId);
    const objRuntime = await loadEffectiveRuntimeState(vUserId);
    res.json({ status: objResult.status, message: objResult.message, data: objRuntime });
}

export async function runRollingOptionsPtDeStrategyCycle(
    req: Request,
    res: Response,
    pService: RollingOptionsPtDeService
): Promise<void> {
    const vUserId = getUserIdFromReq(req);
    const objResult = await pService.runCycle(vUserId);
    const objRuntime = await loadEffectiveRuntimeState(vUserId);
    res.json({ status: objResult.status, message: objResult.message, data: objRuntime });
}

export async function setRollingOptionsPtDeManualRenkoSignal(
    req: Request,
    res: Response,
    pService: RollingOptionsPtDeService
): Promise<void> {
    const vUserId = getUserIdFromReq(req);
    const vColorCode = String(req.body?.color || "").trim().toUpperCase() === "R" ? "R" : "G";
    const objResult = await pService.setManualRenkoSignal(vUserId, vColorCode);
    const objRuntime = await loadEffectiveRuntimeState(vUserId);
    res.json({ status: objResult.status, message: objResult.message, data: objRuntime });
}

export async function resetRollingOptionsPtDeStrategy(
    req: Request,
    res: Response,
    pService: RollingOptionsPtDeService
): Promise<void> {
    const vUserId = getUserIdFromReq(req);
    const objResult = await pService.reset(vUserId);
    const objRuntime = await loadEffectiveRuntimeState(vUserId);
    res.json({ status: objResult.status, message: objResult.message, data: objRuntime });
}

export async function clearRollingOptionsPtDeClosedPositionsController(req: Request, res: Response): Promise<void> {
    const vUserId = getUserIdFromReq(req);
    const vDeletedCount = await clearRollingOptionsPtDeClosedPositions(vUserId);
    await logRollingOptionsPtDeEvent({
        userId: vUserId,
        eventType: "manual_action",
        severity: "warning",
        title: "Closed Positions Cleared",
        message: `Deleted ${vDeletedCount} closed paper position(s).`,
        payload: {
            qty: vDeletedCount,
            reason: "clear_closed_positions"
        }
    });
    res.json({
        status: "success",
        message: `Cleared ${vDeletedCount} closed paper position(s).`,
        data: {
            deletedCount: vDeletedCount
        }
    });
}

export async function clearRollingOptionsPtDeEventsController(req: Request, res: Response): Promise<void> {
    const vUserId = getUserIdFromReq(req);
    const vDeletedCount = await clearRollingOptionsPtDeEvents(vUserId);
    res.json({
        status: "success",
        message: `Cleared ${vDeletedCount} activity log event(s).`,
        data: {
            deletedCount: vDeletedCount
        }
    });
}
