import type { RollingOptionsPtDePositionRecord } from "../../storage/rolling-options-pt-de-position-store";
import type {
    RollingOptionsPtDeConfig,
    RollingOptionsPtDeEngineState,
    RollingOptionsPtDeMarketSnapshot
} from "./types";

const gFutureBrokeragePct = 0.05;
const gOptionBrokeragePct = 0.01;
const gBrokerageGstMultiplier = 1.18;

function clampNumber(pValue: number, pMin: number, pMax: number): number {
    return Math.min(Math.max(pValue, pMin), pMax);
}

function formatDateInputValue(pDateValue: Date): string {
    if (!(pDateValue instanceof Date) || Number.isNaN(pDateValue.getTime())) {
        return "";
    }

    const vYear = String(pDateValue.getFullYear());
    const vMonth = String(pDateValue.getMonth() + 1).padStart(2, "0");
    const vDay = String(pDateValue.getDate()).padStart(2, "0");
    return `${vYear}-${vMonth}-${vDay}`;
}

function getLastFridayOfMonth(pYear: number, pMonthIndex: number): Date {
    const objDate = new Date(pYear, pMonthIndex + 1, 0);
    while (objDate.getDay() !== 5) {
        objDate.setDate(objDate.getDate() - 1);
    }
    return objDate;
}

export function resolveExpiryDateByMode(
    pExpiryMode: string,
    pReferenceDate = new Date()
): string {
    const vMode = String(pExpiryMode || "").trim();
    const objCurrentDate = new Date(pReferenceDate);
    const vCurrentDayOfWeek = objCurrentDate.getDay();

    if (vMode === "1") {
        objCurrentDate.setDate(objCurrentDate.getDate() + 1);
        return formatDateInputValue(objCurrentDate);
    }

    if (vMode === "2") {
        objCurrentDate.setDate(objCurrentDate.getDate() + 2);
        return formatDateInputValue(objCurrentDate);
    }

    if (vMode === "4") {
        const vDaysToThisFriday = (5 - vCurrentDayOfWeek + 7) % 7;
        const vDaysToWeeklyFriday = vCurrentDayOfWeek >= 2 ? (vDaysToThisFriday + 7) : vDaysToThisFriday;
        objCurrentDate.setDate(objCurrentDate.getDate() + vDaysToWeeklyFriday);
        return formatDateInputValue(objCurrentDate);
    }

    if (vMode === "5") {
        const vDaysToThisFriday = (5 - vCurrentDayOfWeek + 7) % 7;
        const vDaysToBiWeeklyFriday = vCurrentDayOfWeek >= 2 ? (vDaysToThisFriday + 14) : (vDaysToThisFriday + 7);
        objCurrentDate.setDate(objCurrentDate.getDate() + vDaysToBiWeeklyFriday);
        return formatDateInputValue(objCurrentDate);
    }

    if (vMode === "6") {
        const objLastFridayOfMonth = getLastFridayOfMonth(objCurrentDate.getFullYear(), objCurrentDate.getMonth());
        const objLastFridayOfNextMonth = getLastFridayOfMonth(objCurrentDate.getFullYear(), objCurrentDate.getMonth() + 1);
        return formatDateInputValue(objCurrentDate.getDate() > 15 ? objLastFridayOfNextMonth : objLastFridayOfMonth);
    }

    return formatDateInputValue(objCurrentDate);
}

function getStandardBricks(
    pMark: number,
    pStep: number,
    pAnchor: number,
    pLastDir: -1 | 0 | 1,
    pMaxBricks = 25
): { bricks: Array<{ open: number; close: number; }>; anchor: number; lastDir: -1 | 0 | 1; } {
    const objBricks: Array<{ open: number; close: number; }> = [];
    let vAnchor = pAnchor;
    let vLastDir: -1 | 0 | 1 = pLastDir;
    let vGuard = 0;

    while (vGuard < pMaxBricks) {
        const vDiff = pMark - vAnchor;
        let vDir: -1 | 0 | 1 = 0;

        if (vLastDir === 0) {
            if (vDiff >= pStep) {
                vDir = 1;
            }
            else if (vDiff <= -pStep) {
                vDir = -1;
            }
            else {
                break;
            }
        }
        else if (vLastDir === 1) {
            if (vDiff >= pStep) {
                vDir = 1;
            }
            else if (vDiff <= -(2 * pStep)) {
                vDir = -1;
            }
            else {
                break;
            }
        }
        else {
            if (vDiff <= -pStep) {
                vDir = -1;
            }
            else if (vDiff >= (2 * pStep)) {
                vDir = 1;
            }
            else {
                break;
            }
        }

        const vOpen = vAnchor;
        const vClose = vOpen + (vDir * pStep);
        objBricks.push({ open: vOpen, close: vClose });
        vAnchor = vClose;
        vLastDir = vDir;
        vGuard += 1;
    }

    return { bricks: objBricks, anchor: vAnchor, lastDir: vLastDir };
}

export function updateRenkoState(
    pEngineState: RollingOptionsPtDeEngineState,
    pSnapshot: RollingOptionsPtDeMarketSnapshot,
    pConfig: RollingOptionsPtDeConfig
): Array<"R" | "G"> {
    const objSignals: Array<"R" | "G"> = [];
    const vPrice = pConfig.renkoPriceSource === "spot_price"
        ? pSnapshot.spotPrice
        : (pConfig.renkoPriceSource === "best_bid"
            ? pSnapshot.bestBidPrice
            : (pConfig.renkoPriceSource === "best_ask"
                ? pSnapshot.bestAskPrice
                : pSnapshot.futuresPrice));
    const vStep = Math.max(1, Number(pConfig.renkoStepPoints || 10));

    if (!Number.isFinite(vPrice) || vPrice <= 0) {
        return objSignals;
    }

    if (!Number.isFinite(Number(pEngineState.renko.anchor))) {
        pEngineState.renko.anchor = Math.floor(vPrice / vStep) * vStep;
        pEngineState.renko.lastDir = 0;
        pEngineState.renko.lastColor = "";
        return objSignals;
    }

    const objBuild = getStandardBricks(
        vPrice,
        vStep,
        Number(pEngineState.renko.anchor),
        pEngineState.renko.lastDir
    );

    pEngineState.renko.anchor = objBuild.anchor;
    pEngineState.renko.lastDir = objBuild.lastDir;

    for (const objBrick of objBuild.bricks) {
        const vColor = objBrick.close > objBrick.open ? "G" : "R";
        objSignals.push(vColor);
        pEngineState.renko.lastColor = vColor;
    }

    return objSignals;
}

export function getOpenPositionsSummary(pPositions: RollingOptionsPtDePositionRecord[]): {
    futureQty: number;
    futureSide: "" | "BUY" | "SELL";
    hasOpenOption: boolean;
} {
    const objOpenPositions = pPositions.filter((objRow) => objRow.status === "OPEN");
    const objFutures = objOpenPositions.filter((objRow) => objRow.instrumentType === "FUTURE");
    const objOptions = objOpenPositions.filter((objRow) => objRow.instrumentType === "OPTION");

    return {
        futureQty: objFutures.reduce((pSum, objRow) => pSum + Math.max(0, Number(objRow.qty || 0)), 0),
        futureSide: objFutures[0]?.action || "",
        hasOpenOption: objOptions.length > 0
    };
}

export function shouldTriggerOption(
    pPosition: RollingOptionsPtDePositionRecord,
    pCurrentDelta: number
): { shouldAct: boolean; reason: "" | "sl" | "tp"; } {
    const vTransType = String(pPosition.action || "").toUpperCase();
    const vDeltaSl = Number((pPosition.metadata?.deltaStopLoss as number) || 0);
    const vDeltaTp = Number((pPosition.metadata?.deltaTakeProfit as number) || 0);
    const vAbsDelta = Math.abs(pCurrentDelta);
    const bHasSl = Number.isFinite(vDeltaSl) && vDeltaSl > 0;
    const bHasTp = Number.isFinite(vDeltaTp) && vDeltaTp > 0;

    if (!Number.isFinite(vAbsDelta) || (!bHasSl && !bHasTp)) {
        return { shouldAct: false, reason: "" };
    }

    if (vTransType === "SELL") {
        if (bHasSl && vAbsDelta >= vDeltaSl) {
            return { shouldAct: true, reason: "sl" };
        }
        if (bHasTp && vAbsDelta <= vDeltaTp) {
            return { shouldAct: true, reason: "tp" };
        }
    }
    else if (vTransType === "BUY") {
        if (bHasSl && vAbsDelta <= vDeltaSl) {
            return { shouldAct: true, reason: "sl" };
        }
        if (bHasTp && vAbsDelta >= vDeltaTp) {
            return { shouldAct: true, reason: "tp" };
        }
    }

    return { shouldAct: false, reason: "" };
}

export function getSimulatedCurrentDelta(
    pPosition: RollingOptionsPtDePositionRecord,
    pSnapshot: RollingOptionsPtDeMarketSnapshot
): number {
    const vEntryDelta = Math.abs(Number(pPosition.entryDelta || 0.53));
    const vEntrySpot = Number((pPosition.metadata?.entrySpotPrice as number) || pSnapshot.spotPrice);
    const vSpotMovePct = vEntrySpot > 0 ? ((pSnapshot.spotPrice - vEntrySpot) / vEntrySpot) : 0;
    const vDirectionFactor = String(pPosition.optionSide || "").toUpperCase() === "CE" ? 1 : -1;
    const vDeltaShift = vSpotMovePct * 12 * vDirectionFactor;
    return clampNumber(vEntryDelta + vDeltaShift, 0.05, 0.95);
}

export function getSimulatedOptionMark(
    pPosition: RollingOptionsPtDePositionRecord,
    pSnapshot: RollingOptionsPtDeMarketSnapshot,
    pCurrentDelta: number
): number {
    const vSpotBase = Number(pSnapshot.spotPrice || 0);
    const vVolFactor = 0.012;
    const vTimeValue = Math.max(0.0015, Math.abs(pCurrentDelta) * vVolFactor);
    const vMark = vSpotBase * vTimeValue;
    return Number(vMark.toFixed(2));
}

export function getPositionPnl(
    pPosition: RollingOptionsPtDePositionRecord,
    pExitPrice: number
): number {
    const vEntryPrice = Number(pPosition.entryPrice || 0);
    const vQty = Math.max(1, Number(pPosition.qty || 1));
    const vLotSize = Math.max(0, Number(pPosition.lotSize || 0));
    const vSignedMove = pPosition.action === "BUY"
        ? (pExitPrice - vEntryPrice)
        : (vEntryPrice - pExitPrice);
    return Number((vSignedMove * vQty * vLotSize).toFixed(2));
}

export function estimatePositionCharges(
    pInstrumentType: "OPTION" | "FUTURE",
    pQty: number,
    pLotSize: number,
    pPrice: number
): number {
    const vQty = Math.max(1, Number(pQty || 1));
    const vLotSize = Math.max(0, Number(pLotSize || 0));
    const vPrice = Math.max(0, Number(pPrice || 0));
    const vNotional = vQty * vLotSize * vPrice;
    const vBrokeragePct = pInstrumentType === "FUTURE" ? gFutureBrokeragePct : gOptionBrokeragePct;
    return Number((((vNotional * vBrokeragePct) / 100) * gBrokerageGstMultiplier).toFixed(4));
}

export function buildConfigFromUiState(pUiState: Record<string, unknown>): RollingOptionsPtDeConfig {
    const normalizeQtyPct = (pValue: unknown, pFallback: number): number => {
        const vNumber = Number(pValue);
        return Number.isFinite(vNumber) ? Math.max(0, Math.round(vNumber)) : pFallback;
    };

    const vSymbol = String(pUiState.symbol || "BTC").trim().toUpperCase() || "BTC";
    const vAction = String(pUiState.action1 || "sell").trim().toLowerCase() === "buy" ? "buy" : "sell";
    const vLegSideRaw = String(pUiState.legSide1 || "ce").trim().toLowerCase();
    const vLegSide = vLegSideRaw === "both" || vLegSideRaw === "pe" ? vLegSideRaw : "ce";
    const vPriceSourceRaw = String(pUiState.renkoFeedPriceSrc || "spot_price").trim();
    const vPriceSource = vPriceSourceRaw === "mark_price" || vPriceSourceRaw === "best_bid" || vPriceSourceRaw === "best_ask"
        ? vPriceSourceRaw
        : "spot_price";

    const vExpiryMode = String(pUiState.expiryMode1 || "1") as "1" | "2" | "4" | "5" | "6" | "7";
    const vEffectiveExpiryDate = resolveExpiryDateByMode(vExpiryMode);

    return {
        symbol: vSymbol,
        contractName: vSymbol === "ETH" ? "ETHUSD" : "BTCUSD",
        lotSize: vSymbol === "ETH" ? 0.01 : 0.001,
        futureQty: Math.max(1, Math.floor(Number(pUiState.manualFutQty || 1))),
        futureOrderType: String(pUiState.manualFutOrderType || "market_order").trim() === "limit_order" ? "limit_order" : "market_order",
        action: vAction,
        legSide: vLegSide,
        expiryMode: vExpiryMode,
        expiryDate: vEffectiveExpiryDate,
        optionQty: Math.max(1, Math.floor(Number(pUiState.manualOptQty1 || 1))),
        redOptionQtyPct: normalizeQtyPct(pUiState.redOptQtyPct ?? pUiState.autoOptQtyPct, 100),
        greenOptionQtyPct: normalizeQtyPct(pUiState.greenOptQtyPct, 100),
        newDelta: Number(pUiState.newDelta1 || 0.53),
        redReDelta: Number(pUiState.reRedDelta ?? pUiState.reDelta1 ?? 0.53),
        redDeltaTakeProfit: Number(pUiState.redTpDelta ?? pUiState.deltaTp1 ?? 0.15),
        redDeltaStopLoss: Number(pUiState.redSlDelta ?? pUiState.deltaSl1 ?? 0.85),
        greenReDelta: Number(pUiState.greenReDelta ?? pUiState.reDelta1 ?? 0.53),
        greenDeltaTakeProfit: Number(pUiState.greenTpDelta ?? pUiState.deltaTp1 ?? 0.15),
        greenDeltaStopLoss: Number(pUiState.greenSlDelta ?? pUiState.deltaSl1 ?? 0.85),
        reDelta: Number(pUiState.reRedDelta ?? pUiState.reDelta1 ?? 0.53),
        deltaTakeProfit: Number(pUiState.redTpDelta ?? pUiState.deltaTp1 ?? 0.15),
        deltaStopLoss: Number(pUiState.redSlDelta ?? pUiState.deltaSl1 ?? 0.85),
        reEnter: Boolean(pUiState.reEnter1),
        addOneLotFuture: Boolean(pUiState.addOneLotFuture),
        renkoEnabled: Boolean(pUiState.renkoFeedEnabled ?? true),
        renkoStepPoints: Math.max(1, Math.round(Number(pUiState.renkoFeedPts || 10))),
        renkoPriceSource: vPriceSource,
        loopSeconds: 8
    };
}
