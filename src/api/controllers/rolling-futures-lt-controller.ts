import type { Request, Response } from "express";
import crypto from "node:crypto";
const DeltaRestClient = require("delta-rest-client");
import { getAccountById } from "../../storage/accounts-store";
import { getDeltaApiProfile } from "../../storage/delta-api-profile-store";
import {
    deleteRollingFuturesLtImportedPosition,
    getDefaultRollingFuturesLtProfile,
    listRollingFuturesLtImportedPositions,
    loadRollingFuturesLtProfile,
    replaceRollingFuturesLtImportedPositions,
    saveRollingFuturesLtProfile,
    type RollingFuturesLtConnectionStatus,
    type RollingFuturesLtImportedPositionRecord,
    type RollingFuturesLtProfileRecord,
    type RollingFuturesLtStrategyCode
} from "../../storage/rolling-futures-lt-store";
import {
    getDefaultRollingFuturesLtRuntime,
    listRollingFuturesLtRuntime,
    loadRollingFuturesLtRuntime,
    saveRollingFuturesLtRuntime,
    type RollingFuturesLtRuntimeRecord
} from "../../storage/rolling-futures-lt-runtime-store";
import {
    clearRollingOptionsEventsByStrategy,
    deleteRollingOptionsEventByStrategy,
    listRollingOptionsEventsByStrategy,
    saveRollingOptionsEvent
} from "../../storage/rolling-options-pt-de-event-store";
import { findBestLiveOptionContract, getLiveMarketSnapshot, getLiveOptionTicker } from "../../strategies/rolling-options-pt-de/market-data";

interface DeltaWalletBalanceRow {
    asset_symbol?: string;
    symbol?: string;
    available_balance?: number | string | null;
    balance?: number | string | null;
    wallet_balance?: number | string | null;
    total_margin?: number | string | null;
    blocked_margin?: number | string | null;
    position_margin?: number | string | null;
    order_margin?: number | string | null;
    [key: string]: unknown;
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
    [key: string]: unknown;
}

interface DeltaOrderHistoryRow {
    id?: number | string | null;
    state?: string | null;
    size?: number | string | null;
    side?: string | null;
    average_fill_price?: number | string | null;
    paid_commission?: number | string | null;
    created_at?: string | number | null;
    updated_at?: string | number | null;
    product_symbol?: string | null;
    order_id?: string | number | null;
    meta_data?: {
        pnl?: number | string | null;
        order_type?: string | null;
        [key: string]: unknown;
    } | null;
    [key: string]: unknown;
}

interface DeltaActiveOrderRow {
    id?: number | string | null;
    state?: string | null;
    size?: number | string | null;
    unfilled_size?: number | string | null;
    product_symbol?: string | null;
    [key: string]: unknown;
}

const gStrategyNames: Record<RollingFuturesLtStrategyCode, string> = {
    "rolling-futures-lt-long": "Long Rolling Futures",
    "rolling-futures-lt-short": "Short Rolling Futures",
    "rolling-futures-lt-dual": "Dual Rolling Futures"
};
const gFutureLimitRetryDelayMs = 5000;
const gFutureLimitRetryCount = 5;
const gProfitCloseReEntryCooldownMs = 5 * 60 * 1000;
const gRestartCloseProtectionMs = 5 * 60 * 1000;
const gNeutralityHedgeCooldownMs = 2 * 60 * 1000;
const gDeltaUiTimezoneOffsetMinutes = 5.5 * 60;
const gManualFutureOrderLocks = new Set<string>();
const gManualOptionOrderLocks = new Set<string>();
const gExecStrategyLocks = new Set<string>();
const gNeutralityHedgeLocks = new Set<string>();
const gAutoTraderIntervals = new Map<string, NodeJS.Timeout>();
const gAutoTraderCycleLocks = new Set<string>();
const gNeutralityHedgePendingMs = 45 * 1000;
const gRollingFuturesTelegramEventTypes = new Set([
    "engine_started",
    "engine_stopped",
    "engine_error",
    "strategy_executed",
    "future_opened",
    "future_closed",
    "option_opened",
    "option_closed",
    "sl_triggered",
    "tp_triggered",
    "kill_switch"
]);

interface RollingFuturesLtPositionGreeks {
    deltaPerContract: number;
    deltaTotal: number;
    deltaDisplayPerContract: number;
    deltaDisplayTotal: number;
    gammaPerContract: number;
    gammaTotal: number;
    thetaPerContract: number;
    thetaTotal: number;
    thetaDisplayTotal: number;
    thetaBaseDisplayTotal: number;
    vegaPerContract: number;
    vegaTotal: number;
}

interface RollingFuturesLtEnrichedPositionRecord extends RollingFuturesLtImportedPositionRecord {
    contractKind: "future" | "option";
    lotSize: number;
    greeks: RollingFuturesLtPositionGreeks;
}

interface RollingFuturesLtOpenPositionTotals {
    totalDeltaPerContract: number;
    totalDelta: number;
    totalDeltaDisplayPerContract: number;
    totalDeltaDisplay: number;
    totalGammaPerContract: number;
    totalGamma: number;
    totalThetaPerContract: number;
    totalTheta: number;
    totalThetaDisplay: number;
    totalThetaBaseDisplay: number;
    totalVegaPerContract: number;
    totalVega: number;
    totalCharges: number;
    totalPnl: number;
    totalMargin: number;
    positionCount: number;
}

interface RollingFuturesLtNeutralStatus {
    mode: "none" | "delta" | "range" | "gamma";
    totalDelta: number;
    totalTheta: number;
    totalGamma: number;
    minDelta: number | null;
    maxDelta: number | null;
    deltaDriftPct: number | null;
    baseOptionDeltaAbs: number | null;
    gammaFactor: number | null;
    deltaBalanceTone: "secondary" | "success" | "danger";
    deltaBalanceText: string;
}

interface RollingFuturesLtOpenPositionsPayload {
    positions: RollingFuturesLtEnrichedPositionRecord[];
    totals: RollingFuturesLtOpenPositionTotals;
    neutralStatus: RollingFuturesLtNeutralStatus;
    recoveryMetrics: {
        totalBrokerageToRecover: number;
        totalPnl: number;
        netPnl: number;
    };
}

interface RollingFuturesLtOptionMetadata {
    baseDelta?: number;
    baseTheta?: number;
    takeProfitDelta?: number;
    stopLossDelta?: number;
    reEntryDelta?: number;
    reEnterEnabled?: boolean;
    openedReason?: string;
}

interface RollingFuturesLtAccountSummarySnapshot {
    symbol: "BTC" | "ETH";
    oneLotValue: number | null;
    totalBalance: number | null;
    blockedMargin: number | null;
    availableBalance: number | null;
    healthPct: number | null;
    profileLabel: string;
    openCount: number;
}

function getAccountId(req: Request): string {
    return String(req.authAccount?.accountId || "").trim();
}

async function readLiveProfile(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode
): Promise<RollingFuturesLtProfileRecord> {
    return await loadRollingFuturesLtProfile(pUserId, pStrategyCode) || getDefaultRollingFuturesLtProfile(pUserId, pStrategyCode);
}

async function ensureRuntimeProfileSelection(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pSelectedApiProfileId: string
) {
    const objExisting = await loadRollingFuturesLtRuntime(pUserId, pStrategyCode);
    return saveRollingFuturesLtRuntime({
        ...(objExisting || getDefaultRollingFuturesLtRuntime(pUserId, pStrategyCode)),
        userId: pUserId,
        strategyCode: pStrategyCode,
        selectedApiProfileId: String(pSelectedApiProfileId || "").trim()
    });
}

function getErrorMessage(pError: unknown, pFallback: string): string {
    if (pError instanceof Error && pError.message) {
        return pError.message;
    }

    if (pError && typeof pError === "object") {
        const objError = pError as { message?: unknown; error?: unknown; response?: { data?: { message?: unknown } } };
        const vMessage = String(objError.message || objError.error || objError.response?.data?.message || "").trim();
        if (vMessage) {
            return vMessage;
        }
    }

    return pFallback;
}

function sleep(pDurationMs: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, Math.max(0, Number(pDurationMs || 0)));
    });
}

function parseDeltaPayload(pRaw: unknown): Record<string, unknown> {
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

function readResponsePayload(pResponse: { data?: unknown; body?: unknown } | unknown): Record<string, unknown> {
    const objResponse = (pResponse || {}) as { data?: unknown; body?: unknown };
    return parseDeltaPayload(objResponse.data ?? objResponse.body ?? {});
}

function getOrderId(pPayload: Record<string, unknown>): string {
    const objResult = (pPayload.result && typeof pPayload.result === "object")
        ? pPayload.result as Record<string, unknown>
        : {};
    return String(objResult.id || objResult.order_id || "").trim();
}

function getOrderState(pPayload: Record<string, unknown>): string {
    const objResult = (pPayload.result && typeof pPayload.result === "object")
        ? pPayload.result as Record<string, unknown>
        : {};
    return String(objResult.state || objResult.status || "").trim().toLowerCase();
}

function isCancelledLikeOrderState(pState: string): boolean {
    return ["cancelled", "canceled", "rejected", "expired", "failed"].includes(String(pState || "").trim().toLowerCase());
}

function toFiniteNumber(pValue: unknown, pFallback = 0): number {
    const vNumber = Number(pValue);
    return Number.isFinite(vNumber) ? vNumber : pFallback;
}

function pickUsdBalanceRow(pRows: DeltaWalletBalanceRow[]): DeltaWalletBalanceRow | null {
    const arrPriority = ["USD", "USDT"];
    for (const vAsset of arrPriority) {
        const objRow = pRows.find((pRow) => String(pRow.asset_symbol || pRow.symbol || "").trim().toUpperCase() === vAsset) || null;
        if (objRow) {
            return objRow;
        }
    }
    return pRows[0] || null;
}

function getAvailableBalanceUsd(pRow: DeltaWalletBalanceRow | null): number {
    if (!pRow) {
        return 0;
    }
    return toFiniteNumber(pRow.available_balance ?? pRow.wallet_balance ?? pRow.balance, 0);
}

function getBlockedMarginUsd(pRow: DeltaWalletBalanceRow | null): number {
    if (!pRow) {
        return 0;
    }
    const vExplicitBlocked = toFiniteNumber(pRow.blocked_margin ?? pRow.position_margin ?? pRow.order_margin, Number.NaN);
    if (Number.isFinite(vExplicitBlocked)) {
        return vExplicitBlocked;
    }
    const vBalance = toFiniteNumber(pRow.balance ?? pRow.wallet_balance, 0);
    return Math.max(0, vBalance - getAvailableBalanceUsd(pRow));
}

function getTotalBalanceUsd(pRow: DeltaWalletBalanceRow | null): number {
    if (!pRow) {
        return 0;
    }
    return toFiniteNumber(pRow.total_margin ?? pRow.balance ?? pRow.wallet_balance, Number.NaN)
        || Math.max(0, getAvailableBalanceUsd(pRow) + getBlockedMarginUsd(pRow));
}

function getContractNameForSymbol(pSymbol: string): string {
    return String(pSymbol || "").trim().toUpperCase() === "ETH" ? "ETHUSD" : "BTCUSD";
}

function getLotSizeForSymbol(pSymbol: string): number {
    return String(pSymbol || "").trim().toUpperCase() === "ETH" ? 0.01 : 0.001;
}

function formatIsoDateFromParts(pYear: number, pMonthIndex: number, pDay: number): string {
    const vYear = String(pYear).padStart(4, "0");
    const vMonth = String(pMonthIndex + 1).padStart(2, "0");
    const vDayValue = String(pDay).padStart(2, "0");
    return `${vYear}-${vMonth}-${vDayValue}`;
}

function getLastFridayOfMonthUtc(pYear: number, pMonthIndex: number): Date {
    const objDate = new Date(Date.UTC(pYear, pMonthIndex + 1, 0));
    while (objDate.getUTCDay() !== 5) {
        objDate.setUTCDate(objDate.getUTCDate() - 1);
    }
    return objDate;
}

function getFutureFridayUtc(pBaseDate: Date, pFridayOffset: number): Date {
    const vCurrentDayOfWeek = pBaseDate.getUTCDay();
    const vDaysToThisFriday = (5 - vCurrentDayOfWeek + 7) % 7;
    const objDate = new Date(pBaseDate.getTime());
    objDate.setUTCDate(pBaseDate.getUTCDate() + vDaysToThisFriday + (pFridayOffset * 7));
    return objDate;
}

function getDaysBetweenUtcDates(pFromDate: Date, pToDate: Date): number {
    const vMsPerDay = 24 * 60 * 60 * 1000;
    return Math.floor((pToDate.getTime() - pFromDate.getTime()) / vMsPerDay);
}

function resolveRollingFuturesExpiryDateByMode(pExpiryMode: string): string {
    const vMode = String(pExpiryMode || "").trim();
    const objNow = new Date();
    const objDate = new Date(Date.UTC(objNow.getUTCFullYear(), objNow.getUTCMonth(), objNow.getUTCDate()));

    if (vMode === "1") {
        objDate.setUTCDate(objDate.getUTCDate() + 1);
        return formatIsoDateFromParts(objDate.getUTCFullYear(), objDate.getUTCMonth(), objDate.getUTCDate());
    }
    if (vMode === "2") {
        objDate.setUTCDate(objDate.getUTCDate() + 2);
        return formatIsoDateFromParts(objDate.getUTCFullYear(), objDate.getUTCMonth(), objDate.getUTCDate());
    }
    if (vMode === "4") {
        const objWeekly = getFutureFridayUtc(objDate, objDate.getUTCDay() >= 1 ? 1 : 0);
        return formatIsoDateFromParts(objWeekly.getUTCFullYear(), objWeekly.getUTCMonth(), objWeekly.getUTCDate());
    }
    if (vMode === "5") {
        const objBiWeeklyCandidate = getFutureFridayUtc(objDate, 1);
        const vDaysToCandidate = getDaysBetweenUtcDates(objDate, objBiWeeklyCandidate);
        const objBiWeekly = vDaysToCandidate <= 7 ? getFutureFridayUtc(objDate, 2) : objBiWeeklyCandidate;
        return formatIsoDateFromParts(objBiWeekly.getUTCFullYear(), objBiWeekly.getUTCMonth(), objBiWeekly.getUTCDate());
    }
    if (vMode === "6") {
        const objLastFriday = getLastFridayOfMonthUtc(objDate.getUTCFullYear(), objDate.getUTCMonth());
        const objLastFridayNextMonth = getLastFridayOfMonthUtc(objDate.getUTCFullYear(), objDate.getUTCMonth() + 1);
        const objSelected = getDaysBetweenUtcDates(objDate, objLastFriday) <= 14 ? objLastFridayNextMonth : objLastFriday;
        return formatIsoDateFromParts(objSelected.getUTCFullYear(), objSelected.getUTCMonth(), objSelected.getUTCDate());
    }
    if (vMode === "7") {
        const objLastFridayNextMonth = getLastFridayOfMonthUtc(objDate.getUTCFullYear(), objDate.getUTCMonth() + 1);
        const objLastFridayThirdMonth = getLastFridayOfMonthUtc(objDate.getUTCFullYear(), objDate.getUTCMonth() + 2);
        const objSelected = getDaysBetweenUtcDates(objDate, objLastFridayNextMonth) <= 30
            ? objLastFridayThirdMonth
            : objLastFridayNextMonth;
        return formatIsoDateFromParts(objSelected.getUTCFullYear(), objSelected.getUTCMonth(), objSelected.getUTCDate());
    }

    return formatIsoDateFromParts(objDate.getUTCFullYear(), objDate.getUTCMonth(), objDate.getUTCDate());
}

function normalizeRollingFuturesExpiryDate(pExpiryMode: string, pExpiryDate: unknown): string {
    const vSavedDate = String(pExpiryDate || "").trim();
    if (!vSavedDate) {
        return resolveRollingFuturesExpiryDateByMode(pExpiryMode);
    }
    const objSavedDate = new Date(`${vSavedDate}T00:00:00Z`);
    if (Number.isNaN(objSavedDate.getTime())) {
        return resolveRollingFuturesExpiryDateByMode(pExpiryMode);
    }
    const objToday = new Date();
    const objTodayUtc = new Date(Date.UTC(objToday.getUTCFullYear(), objToday.getUTCMonth(), objToday.getUTCDate()));
    if (objSavedDate.getTime() < objTodayUtc.getTime()) {
        return resolveRollingFuturesExpiryDateByMode(pExpiryMode);
    }
    return vSavedDate;
}

function getManualFutureOrderLockKey(pUserId: string, pStrategyCode: RollingFuturesLtStrategyCode): string {
    return `${String(pUserId || "").trim()}::${String(pStrategyCode || "").trim()}`;
}

function getNeutralityHedgeLockKey(pUserId: string, pStrategyCode: RollingFuturesLtStrategyCode): string {
    return `${getManualFutureOrderLockKey(pUserId, pStrategyCode)}::neutrality`;
}

function buildLiveMarketSnapshotConfig(pSymbol: string, pOrderType: "market_order" | "limit_order" = "market_order") {
    const vSymbol = normalizeSymbolValue(pSymbol);
    return {
        symbol: vSymbol,
        contractName: getContractNameForSymbol(vSymbol),
        lotSize: getLotSizeForSymbol(vSymbol),
        futureQty: 1,
        futureOrderType: pOrderType,
        action: "buy" as const,
        legSide: "ce" as const,
        expiryMode: "1" as const,
        expiryDate: "",
        optionQty: 1,
        redOptionQtyPct: 100,
        greenOptionQtyPct: 100,
        newDelta: 0.53,
        reDelta: 0.53,
        deltaTakeProfit: 0.15,
        deltaStopLoss: 0.85,
        reEnter: false,
        addOneLotFuture: false,
        renkoEnabled: false,
        renkoStepPoints: 10,
        renkoPriceSource: "spot_price" as const,
        loopSeconds: 8
    };
}

function normalizeSymbolValue(pValue: unknown): "BTC" | "ETH" {
    const vValue = String(pValue || "").trim().toUpperCase();
    return vValue === "ETH" || vValue === "ETHUSD" ? "ETH" : "BTC";
}

function normalizeBooleanValue(pValue: unknown, pFallback: boolean): boolean {
    if (typeof pValue === "boolean") {
        return pValue;
    }
    if (typeof pValue === "number") {
        return pValue !== 0;
    }
    const vValue = String(pValue || "").trim().toLowerCase();
    if (!vValue) {
        return pFallback;
    }
    if (["true", "1", "yes", "on"].includes(vValue)) {
        return true;
    }
    if (["false", "0", "no", "off"].includes(vValue)) {
        return false;
    }
    return pFallback;
}

function normalizeStringValue(pValue: unknown, pFallback: string): string {
    const vValue = String(pValue ?? "").trim();
    return vValue || pFallback;
}

function normalizeRollingFuturesLegSelection(pValue: unknown, pFallback: string): "ce" | "pe" | "both" {
    const vFallback = String(pFallback || "").trim().toLowerCase();
    const vValue = String(pValue || "").trim().toLowerCase();
    if (vValue === "both" || vFallback === "both") {
        return "both";
    }
    return vValue === "pe" ? "pe" : "ce";
}

function getDefaultManualTraderUiState(
    pStrategyCode: RollingFuturesLtStrategyCode
): Record<string, unknown> {
    const bIsShort = pStrategyCode === "rolling-futures-lt-short";
    const bIsDual = pStrategyCode === "rolling-futures-lt-dual";
    return {
        startQty: "1",
        symbol: "BTC",
        manualFutOrderType: "market_order",
        bsFutQty: "1",
        minusDelta: bIsDual ? "-10" : "-25",
        plusDelta: bIsDual ? "10" : "25",
        action1: "sell",
        legs1: bIsDual ? "both" : (bIsShort ? "pe" : "ce"),
        onlyDeltaNeutral: false,
        rangeDeltaNeutral: false,
        gammaAwareNeutral: false,
        expiryMode1: bIsDual ? "6" : "5",
        expiryDate1: "",
        qty1: "1",
        newD1: bIsDual ? "0.25" : "0.53",
        reD1: bIsDual ? "0.25" : "0.53",
        tpD1: bIsDual ? "0.12" : "0.25",
        slD1: bIsDual ? "0.50" : "0.65",
        reEnter1: true,
        closeNetProfitBrokerage: bIsDual,
        brokerageMultiplier: bIsDual ? "10" : "3",
        reEnterBrok: bIsDual,
        closeBlockedMargin: bIsDual,
        blockedMarginPct: bIsDual ? "10" : "20",
        reEnterBlock: bIsDual,
        telegramAlertTypes: [],
        closedFromDate: "",
        closedToDate: ""
    };
}

function isFutureContractSymbol(pValue: unknown): boolean {
    const vSymbol = String(pValue || "").trim().toUpperCase();
    return Boolean(vSymbol) && !vSymbol.startsWith("C-") && !vSymbol.startsWith("P-");
}

function isOptionContractSymbol(pValue: unknown): boolean {
    const vSymbol = String(pValue || "").trim().toUpperCase();
    return vSymbol.startsWith("C-") || vSymbol.startsWith("P-");
}

function listTrackedOpenOptionPositions(
    pTrackedPositions: RollingFuturesLtImportedPositionRecord[]
): RollingFuturesLtImportedPositionRecord[] {
    return Array.isArray(pTrackedPositions)
        ? pTrackedPositions.filter((objPosition) => isOptionContractSymbol(objPosition.contractName))
        : [];
}

function hasTrackedOptionLeg(
    pTrackedPositions: RollingFuturesLtImportedPositionRecord[],
    pLegSide: "ce" | "pe"
): boolean {
    return listTrackedOpenOptionPositions(pTrackedPositions).some((objPosition) => getTrackedOptionLegSide(objPosition.contractName) === pLegSide);
}

function isTrackedContractForSymbol(pContractName: unknown, pSymbol: string): boolean {
    const vContract = String(pContractName || "").trim().toUpperCase();
    const vSymbol = normalizeSymbolValue(pSymbol);
    return (isFutureContractSymbol(vContract) && vContract.startsWith(vSymbol))
        || (isOptionContractSymbol(vContract) && (vContract.startsWith(`C-${vSymbol}-`) || vContract.startsWith(`P-${vSymbol}-`)));
}

function getTrackedOptionMetadata(pPosition: RollingFuturesLtImportedPositionRecord): RollingFuturesLtOptionMetadata {
    return pPosition.metadata && typeof pPosition.metadata === "object"
        ? pPosition.metadata as RollingFuturesLtOptionMetadata
        : {};
}

function optionMetadataToRecord(pMetadata: RollingFuturesLtOptionMetadata): Record<string, unknown> {
    return {
        baseDelta: pMetadata.baseDelta,
        baseTheta: pMetadata.baseTheta,
        takeProfitDelta: pMetadata.takeProfitDelta,
        stopLossDelta: pMetadata.stopLossDelta,
        reEntryDelta: pMetadata.reEntryDelta,
        reEnterEnabled: pMetadata.reEnterEnabled,
        openedReason: pMetadata.openedReason
    };
}

function hasMissingTrackedOptionBaseGreeks(pPosition: RollingFuturesLtImportedPositionRecord): boolean {
    if (!isOptionContractSymbol(pPosition.contractName)) {
        return false;
    }
    const objMetadata = getTrackedOptionMetadata(pPosition);
    return !(Number(objMetadata.baseDelta) > 0) || !Number.isFinite(Number(objMetadata.baseTheta));
}

function applyImportedBaseDelta(
    pPositions: RollingFuturesLtImportedPositionRecord[],
    pBaseDelta: number
): RollingFuturesLtImportedPositionRecord[] {
    const vBaseDelta = Math.max(0, Number(pBaseDelta || 0));
    return pPositions.map((objPosition) => {
        if (!isOptionContractSymbol(objPosition.contractName)) {
            return objPosition;
        }
        const objMetadata = getTrackedOptionMetadata(objPosition);
        return {
            ...objPosition,
            metadata: optionMetadataToRecord({
                ...objMetadata,
                baseDelta: vBaseDelta
            })
        };
    });
}

async function applyImportedOptionBaseGreeks(
    pPositions: RollingFuturesLtImportedPositionRecord[],
    pFallbackDelta: number
): Promise<RollingFuturesLtImportedPositionRecord[]> {
    const vFallbackDelta = Math.max(0, Number(pFallbackDelta || 0));
    const arrOptionContracts = Array.from(new Set(
        pPositions
            .map((objPosition) => String(objPosition.contractName || "").trim())
            .filter((vContractName) => isOptionContractSymbol(vContractName))
    ));
    const objTickerByContract = new Map<string, Awaited<ReturnType<typeof getLiveOptionTicker>>>();
    await Promise.all(arrOptionContracts.map(async (vContractName) => {
        try {
            objTickerByContract.set(vContractName, await getLiveOptionTicker(vContractName));
        }
        catch (_objError) {
            objTickerByContract.set(vContractName, null);
        }
    }));

    return pPositions.map((objPosition) => {
        if (!isOptionContractSymbol(objPosition.contractName)) {
            return objPosition;
        }
        const vContractName = String(objPosition.contractName || "").trim();
        const objTicker = objTickerByContract.get(vContractName);
        const objMetadata = getTrackedOptionMetadata(objPosition);
        const vBaseDelta = Math.abs(Number.isFinite(Number(objTicker?.delta)) ? Number(objTicker?.delta) : vFallbackDelta);
        const vBaseTheta = Math.abs(Number.isFinite(Number(objTicker?.theta)) ? Number(objTicker?.theta) : 0);
        return {
            ...objPosition,
            metadata: optionMetadataToRecord({
                ...objMetadata,
                baseDelta: vBaseDelta,
                baseTheta: vBaseTheta
            })
        };
    });
}

const gFutureBrokeragePct = 0.05;
const gOptionBrokeragePct = 0.01;
const gOptionPremiumCapPct = 3.5;
const gBrokerageGstMultiplier = 1.18;

function estimateLivePositionCharges(
    pContractName: unknown,
    pQty: number,
    pLotSize: number,
    pEntryPrice: number,
    pUnderlyingPrice = 0
): number {
    const vLotSize = Math.max(0, Number(pLotSize || 0));
    const vQty = Math.max(0, Number(pQty || 0));
    const vEntryPrice = Math.max(0, Number(pEntryPrice || 0));
    if (!(vLotSize > 0) || !(vQty > 0) || !(vEntryPrice > 0)) {
        return 0;
    }
    if (isOptionContractSymbol(pContractName)) {
        const vUnderlying = Math.max(0, Number(pUnderlyingPrice || 0));
        if (!(vUnderlying > 0)) {
            return 0;
        }
        const vOrderNotional = vQty * vLotSize * vUnderlying;
        const vTradingFee = (vOrderNotional * gOptionBrokeragePct) / 100;
        const vPremiumCap = ((vQty * vLotSize * vEntryPrice) * gOptionPremiumCapPct) / 100;
        const vEffectiveFee = Math.min(vTradingFee, vPremiumCap);
        return Number((vEffectiveFee * gBrokerageGstMultiplier).toFixed(4));
    }
    const vNotional = vQty * vLotSize * vEntryPrice;
    return Number((((vNotional * gFutureBrokeragePct) / 100) * gBrokerageGstMultiplier).toFixed(4));
}

function calculateLivePositionPnl(
    pSide: unknown,
    pQty: number,
    pLotSize: number,
    pEntryPrice: number,
    pMarkPrice: number
): number {
    const vLotSize = Math.max(0, Number(pLotSize || 0));
    const vQty = Math.max(0, Number(pQty || 0));
    const vEntryPrice = Number(pEntryPrice || 0);
    const vMarkPrice = Number(pMarkPrice || 0);
    if (!(vLotSize > 0) || !(vQty > 0) || !Number.isFinite(vEntryPrice) || !Number.isFinite(vMarkPrice)) {
        return 0;
    }
    const vSignedMove = String(pSide || "").trim().toUpperCase() === "BUY"
        ? (vMarkPrice - vEntryPrice)
        : (vEntryPrice - vMarkPrice);
    return Number((vSignedMove * vQty * vLotSize).toFixed(2));
}

function getLiveOptionRuleMetadataFromUiState(
    pUiState: Record<string, unknown>,
    pReason: string
): RollingFuturesLtOptionMetadata {
    return {
        takeProfitDelta: Math.max(0, Number(pUiState.tpD1 || 0.25)),
        stopLossDelta: Math.max(0, Number(pUiState.slD1 || 0.65)),
        reEntryDelta: Math.max(0, Number(pUiState.reD1 || 0.53)),
        reEnterEnabled: Boolean(pUiState.reEnter1),
        openedReason: pReason
    };
}

function shouldTriggerTrackedOption(
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

function getTrackedOptionLegSide(pContractName: string): "ce" | "pe" {
    return String(pContractName || "").trim().toUpperCase().startsWith("P-") ? "pe" : "ce";
}

function getSelectedFuturePositionValue(
    pRows: DeltaPositionRow[],
    pSelectedSymbol: string,
    pLivePrice: number
): number {
    const vSymbol = normalizeSymbolValue(pSelectedSymbol);
    const vFallbackLotSize = getLotSizeForSymbol(vSymbol);
    return pRows.reduce((pSum, pRow) => {
        const vContractSymbol = String(pRow.product_symbol || pRow.symbol || "").trim().toUpperCase();
        if (!isFutureContractSymbol(vContractSymbol) || !vContractSymbol.startsWith(vSymbol)) {
            return pSum;
        }
        const vQty = Math.abs(toFiniteNumber(pRow.net_size ?? pRow.size, 0));
        if (!(vQty > 0)) {
            return pSum;
        }
        const vMarkPrice = toFiniteNumber(pRow.mark_price, pLivePrice);
        const vPrice = Number.isFinite(vMarkPrice) && vMarkPrice > 0 ? vMarkPrice : pLivePrice;
        return pSum + (vQty * vFallbackLotSize * Math.max(0, vPrice));
    }, 0);
}

function mapLivePosition(
    pRow: DeltaPositionRow,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pUserId: string,
    pIndex: number
): RollingFuturesLtImportedPositionRecord {
    const vNetSize = toFiniteNumber(pRow.net_size ?? pRow.size, 0);
    const vSide = vNetSize < 0 ? "SELL" : "BUY";
    return {
        userId: pUserId,
        strategyCode: pStrategyCode,
        importId: String(pRow.product_id ?? pRow.product_symbol ?? pRow.symbol ?? `position-${pIndex}`),
        contractName: String(pRow.product_symbol || pRow.symbol || "Unknown"),
        side: vSide,
        qty: Math.abs(vNetSize),
        entryPrice: toFiniteNumber(pRow.entry_price, 0),
        markPrice: toFiniteNumber(pRow.mark_price, 0),
        charges: 0,
        pnl: Number((toFiniteNumber(pRow.realized_pnl, 0) + toFiniteNumber(pRow.unrealized_pnl, 0)).toFixed(2)),
        margin: toFiniteNumber(pRow.margin, 0),
        liquidationPrice: toFiniteNumber(pRow.liquidation_price, 0),
        openedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
}

function toEpochMicros(pDateValue: string, pEndOfMinute = false): number | null {
    const vValue = String(pDateValue || "").trim();
    if (!vValue) {
        return null;
    }

    if (/[zZ]$|[+\-]\d{2}:\d{2}$/.test(vValue)) {
        const vEpochMs = Date.parse(vValue);
        if (!Number.isNaN(vEpochMs)) {
            return vEpochMs * 1000;
        }
    }

    const objMatch = vValue.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!objMatch) {
        return null;
    }

    const vYear = Number(objMatch[1]);
    const vMonthIndex = Number(objMatch[2]) - 1;
    const vDay = Number(objMatch[3]);
    const vHour = Number(objMatch[4]);
    const vMinute = Number(objMatch[5]);
    const vSecond = pEndOfMinute ? 59 : Number(objMatch[6] || 0);
    const vMillisecond = pEndOfMinute ? 999 : 0;
    const vUtcEpochMs = Date.UTC(vYear, vMonthIndex, vDay, vHour, vMinute, vSecond, vMillisecond)
        - (gDeltaUiTimezoneOffsetMinutes * 60 * 1000);
    return vUtcEpochMs * 1000;
}

function formatOrderType(pValue: unknown): string {
    const vValue = String(pValue || "").trim();
    return vValue ? vValue.replaceAll("_", " ") : "-";
}

function mapLiveClosedPosition(pRow: DeltaOrderHistoryRow, pIndex: number) {
    const vSide = String(pRow.side || "").trim().toUpperCase();
    const vPrice = toFiniteNumber(pRow.average_fill_price, 0);
    const vQty = Math.abs(toFiniteNumber(pRow.size, 0));
    const vCommission = toFiniteNumber(pRow.paid_commission, 0);
    const vCreatedAt = String(pRow.created_at || pRow.updated_at || "").trim();
    const vUpdatedAt = String(pRow.updated_at || pRow.created_at || "").trim();
    const vPnl = toFiniteNumber(pRow.meta_data?.pnl, Number.NaN);
    return {
        rowId: String(pRow.id ?? pRow.order_id ?? `fill-${pIndex}`),
        symbol: String(pRow.product_symbol || "-"),
        side: vSide || "-",
        qty: vQty,
        buyPrice: vSide === "BUY" ? vPrice : null,
        sellPrice: vSide === "SELL" ? vPrice : null,
        charges: vCommission,
        pnl: Number.isFinite(vPnl) ? vPnl : null,
        startAt: vCreatedAt,
        endAt: vUpdatedAt,
        orderType: formatOrderType(pRow.meta_data?.order_type)
    };
}

async function getDeltaClientForAccountId(pAccountId: string, pProfileId: string) {
    const vAccountId = String(pAccountId || "").trim();
    if (!vAccountId) {
        throw new Error("Please sign in to continue.");
    }
    const objAccount = await getAccountById(vAccountId);
    if (!objAccount) {
        throw new Error("Account not found.");
    }
    const objProfile = await getDeltaApiProfile(vAccountId, pProfileId);
    if (!objProfile) {
        throw new Error("Delta API profile not found.");
    }
    const objClient = await new DeltaRestClient(objProfile.apiKey, objProfile.apiSecret);
    return {
        account: objAccount,
        client: objClient,
        profile: objProfile
    };
}

function getDeltaErrorPayload(pError: unknown): { error?: { code?: string; context?: { client_ip?: string } } } | null {
    const vRawData = (pError as { response?: { data?: unknown } } | null)?.response?.data;
    if (!vRawData) {
        return null;
    }
    if (typeof vRawData === "string") {
        try {
            return JSON.parse(vRawData);
        }
        catch (_objError) {
            return null;
        }
    }
    if (typeof vRawData === "object") {
        return vRawData as { error?: { code?: string; context?: { client_ip?: string } } };
    }
    return null;
}

function isRetryablePostOnlyRejection(pError: unknown): boolean {
    const vMessage = getErrorMessage(pError, "").toLowerCase();
    const vCode = String(getDeltaErrorPayload(pError)?.error?.code || "").trim().toLowerCase();
    return vCode.includes("post_only")
        || vMessage.includes("post only")
        || vMessage.includes("post_only")
        || vMessage.includes("would execute")
        || vMessage.includes("would match")
        || vMessage.includes("immediately match")
        || vMessage.includes("taker");
}

async function getOutboundPublicIp(): Promise<string> {
    const arrUrls = [
        "https://api.ipify.org?format=json",
        "https://ifconfig.me/all.json",
        "https://checkip.amazonaws.com/"
    ];

    for (const vUrl of arrUrls) {
        try {
            const objResponse = await fetch(vUrl, { method: "GET" });
            if (!objResponse.ok) {
                continue;
            }

            const vText = String(await objResponse.text() || "").trim();
            if (!vText) {
                continue;
            }

            if (vText.startsWith("{")) {
                const objParsed = JSON.parse(vText) as { ip?: string; ip_addr?: string };
                const vIp = String(objParsed.ip || objParsed.ip_addr || "").trim();
                if (vIp) {
                    return vIp;
                }
                continue;
            }

            return vText;
        }
        catch (_objError) {
        }
    }

    return "";
}

async function getFriendlyDeltaConnectionError(pError: unknown): Promise<{
    state: RollingFuturesLtConnectionStatus["state"];
    message: string;
    outboundIp: string;
}> {
    const vRawMessage = getErrorMessage(pError, "Error testing Delta connection.");
    const vNormalized = vRawMessage.toLowerCase();
    const objPayload = getDeltaErrorPayload(pError);
    const vCode = String(objPayload?.error?.code || "").trim();
    const vClientIp = String(objPayload?.error?.context?.client_ip || "").trim();
    const vOutboundIp = vClientIp || await getOutboundPublicIp();

    if (vCode === "ip_not_whitelisted_for_api_key") {
        return {
            state: "auth_failed",
            message: vOutboundIp
                ? `Delta rejected this API because IP ${vOutboundIp} is not whitelisted. Please add this IP in Delta Exchange and retry.`
                : "Delta rejected this API because the current server IP is not whitelisted in Delta Exchange.",
            outboundIp: vOutboundIp
        };
    }

    if (vNormalized.includes("unauthorized") || vNormalized.includes("forbidden") || vNormalized.includes("ip")) {
        return {
            state: "auth_failed",
            message: vOutboundIp
                ? `Delta authentication failed. If you use IP whitelisting, whitelist server IP ${vOutboundIp} in Delta Exchange.`
                : "Delta authentication failed. Check the API key, secret, permissions, and IP whitelist.",
            outboundIp: vOutboundIp
        };
    }

    if (vNormalized.includes("rate limit")) {
        return {
            state: "rate_limited",
            message: "Delta API rate limit was hit. Connection is temporarily degraded.",
            outboundIp: vOutboundIp
        };
    }

    if (vNormalized.includes("fetch failed") || vNormalized.includes("network") || vNormalized.includes("timeout")) {
        return {
            state: "disconnected",
            message: "Delta connection is currently unreachable. The live runner should avoid fresh execution until connectivity recovers.",
            outboundIp: vOutboundIp
        };
    }

    return {
        state: "warning",
        message: vRawMessage,
        outboundIp: vOutboundIp
    };
}

async function resolveProfileId(req: Request, pStrategyCode: RollingFuturesLtStrategyCode): Promise<string> {
    const vQueryProfileId = String(req.query?.profileId || req.body?.profileId || "").trim();
    if (vQueryProfileId) {
        return vQueryProfileId;
    }
    const objProfile = await readLiveProfile(getAccountId(req), pStrategyCode);
    return String(objProfile.selectedApiProfileId || "").trim();
}

function getMergedUiState(pProfile: RollingFuturesLtProfileRecord): Record<string, unknown> {
    const objUiState = (pProfile.uiState && typeof pProfile.uiState === "object") ? pProfile.uiState : {};
    const objDefaults = getDefaultManualTraderUiState(pProfile.strategyCode);
    const arrTelegramPrefs = Array.isArray(objUiState.telegramAlertTypes)
        ? objUiState.telegramAlertTypes
            .map((pValue) => String(pValue || "").trim())
            .filter((pValue) => Boolean(pValue) && gRollingFuturesTelegramEventTypes.has(pValue))
        : [];
    return {
        startQty: normalizeStringValue(objUiState.startQty, String(objDefaults.startQty)),
        symbol: normalizeSymbolValue(objUiState.symbol),
        manualFutOrderType: String(objUiState.manualFutOrderType || "market_order").trim() === "limit_order" ? "limit_order" : "market_order",
        bsFutQty: normalizeStringValue(objUiState.bsFutQty, String(objDefaults.bsFutQty)),
        minusDelta: normalizeStringValue(objUiState.minusDelta, String(objDefaults.minusDelta)),
        plusDelta: normalizeStringValue(objUiState.plusDelta, String(objDefaults.plusDelta)),
        action1: String(objUiState.action1 || objDefaults.action1).trim().toLowerCase() === "buy" ? "buy" : "sell",
        legs1: String(objUiState.legs1 || objDefaults.legs1).trim().toLowerCase() === "pe" ? "pe" : "ce",
        onlyDeltaNeutral: normalizeBooleanValue(objUiState.onlyDeltaNeutral, Boolean(objDefaults.onlyDeltaNeutral)),
        rangeDeltaNeutral: normalizeBooleanValue(objUiState.rangeDeltaNeutral, Boolean(objDefaults.rangeDeltaNeutral)),
        gammaAwareNeutral: normalizeBooleanValue(objUiState.gammaAwareNeutral, Boolean(objDefaults.gammaAwareNeutral)),
        expiryMode1: normalizeStringValue(objUiState.expiryMode1, String(objDefaults.expiryMode1)),
        expiryDate1: normalizeRollingFuturesExpiryDate(
            normalizeStringValue(objUiState.expiryMode1, String(objDefaults.expiryMode1)),
            objUiState.expiryDate1
        ),
        qty1: normalizeStringValue(objUiState.qty1, String(objDefaults.qty1)),
        newD1: normalizeStringValue(objUiState.newD1, String(objDefaults.newD1)),
        reD1: normalizeStringValue(objUiState.reD1, String(objDefaults.reD1)),
        tpD1: normalizeStringValue(objUiState.tpD1, String(objDefaults.tpD1)),
        slD1: normalizeStringValue(objUiState.slD1, String(objDefaults.slD1)),
        reEnter1: normalizeBooleanValue(objUiState.reEnter1, Boolean(objDefaults.reEnter1)),
        closeNetProfitBrokerage: normalizeBooleanValue(objUiState.closeNetProfitBrokerage, Boolean(objDefaults.closeNetProfitBrokerage)),
        brokerageMultiplier: normalizeStringValue(objUiState.brokerageMultiplier, String(objDefaults.brokerageMultiplier)),
        reEnterBrok: normalizeBooleanValue(objUiState.reEnterBrok, Boolean(objDefaults.reEnterBrok)),
        closeBlockedMargin: normalizeBooleanValue(objUiState.closeBlockedMargin, Boolean(objDefaults.closeBlockedMargin)),
        blockedMarginPct: normalizeStringValue(objUiState.blockedMarginPct, String(objDefaults.blockedMarginPct)),
        reEnterBlock: normalizeBooleanValue(objUiState.reEnterBlock, Boolean(objDefaults.reEnterBlock)),
        telegramAlertTypes: Array.from(new Set(arrTelegramPrefs)),
        closedFromDate: String(objUiState.closedFromDate || "").trim(),
        closedToDate: String(objUiState.closedToDate || "").trim()
    };
}

function normalizeProfileSaveInput(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pIncoming: Partial<RollingFuturesLtProfileRecord>
): RollingFuturesLtProfileRecord {
    const objUiState = (pIncoming.uiState && typeof pIncoming.uiState === "object") ? pIncoming.uiState : {};
    const objDefaults = getDefaultManualTraderUiState(pStrategyCode);
    const arrTelegramPrefs = Array.isArray(objUiState.telegramAlertTypes)
        ? objUiState.telegramAlertTypes
            .map((pValue) => String(pValue || "").trim())
            .filter((pValue) => Boolean(pValue) && gRollingFuturesTelegramEventTypes.has(pValue))
        : [];
    return {
        ...getDefaultRollingFuturesLtProfile(pUserId, pStrategyCode),
        ...pIncoming,
        userId: pUserId,
        strategyCode: pStrategyCode,
        selectedApiProfileId: String(pIncoming.selectedApiProfileId || "").trim(),
        uiState: {
            startQty: normalizeStringValue(objUiState.startQty, String(objDefaults.startQty)),
            symbol: normalizeSymbolValue(objUiState.symbol),
            manualFutOrderType: String(objUiState.manualFutOrderType || "market_order").trim() === "limit_order" ? "limit_order" : "market_order",
            bsFutQty: normalizeStringValue(objUiState.bsFutQty, String(objDefaults.bsFutQty)),
            minusDelta: normalizeStringValue(objUiState.minusDelta, String(objDefaults.minusDelta)),
            plusDelta: normalizeStringValue(objUiState.plusDelta, String(objDefaults.plusDelta)),
            action1: String(objUiState.action1 || objDefaults.action1).trim().toLowerCase() === "buy" ? "buy" : "sell",
            legs1: normalizeRollingFuturesLegSelection(objUiState.legs1, String(objDefaults.legs1 || "ce")),
            onlyDeltaNeutral: normalizeBooleanValue(objUiState.onlyDeltaNeutral, Boolean(objDefaults.onlyDeltaNeutral)),
            rangeDeltaNeutral: normalizeBooleanValue(objUiState.rangeDeltaNeutral, Boolean(objDefaults.rangeDeltaNeutral)),
            gammaAwareNeutral: normalizeBooleanValue(objUiState.gammaAwareNeutral, Boolean(objDefaults.gammaAwareNeutral)),
            expiryMode1: normalizeStringValue(objUiState.expiryMode1, String(objDefaults.expiryMode1)),
            expiryDate1: normalizeRollingFuturesExpiryDate(
                normalizeStringValue(objUiState.expiryMode1, String(objDefaults.expiryMode1)),
                objUiState.expiryDate1
            ),
            qty1: normalizeStringValue(objUiState.qty1, String(objDefaults.qty1)),
            newD1: normalizeStringValue(objUiState.newD1, String(objDefaults.newD1)),
            reD1: normalizeStringValue(objUiState.reD1, String(objDefaults.reD1)),
            tpD1: normalizeStringValue(objUiState.tpD1, String(objDefaults.tpD1)),
            slD1: normalizeStringValue(objUiState.slD1, String(objDefaults.slD1)),
            reEnter1: normalizeBooleanValue(objUiState.reEnter1, Boolean(objDefaults.reEnter1)),
            closeNetProfitBrokerage: normalizeBooleanValue(objUiState.closeNetProfitBrokerage, Boolean(objDefaults.closeNetProfitBrokerage)),
            brokerageMultiplier: normalizeStringValue(objUiState.brokerageMultiplier, String(objDefaults.brokerageMultiplier)),
            reEnterBrok: normalizeBooleanValue(objUiState.reEnterBrok, Boolean(objDefaults.reEnterBrok)),
            closeBlockedMargin: normalizeBooleanValue(objUiState.closeBlockedMargin, Boolean(objDefaults.closeBlockedMargin)),
            blockedMarginPct: normalizeStringValue(objUiState.blockedMarginPct, String(objDefaults.blockedMarginPct)),
            reEnterBlock: normalizeBooleanValue(objUiState.reEnterBlock, Boolean(objDefaults.reEnterBlock)),
            telegramAlertTypes: Array.from(new Set(arrTelegramPrefs)),
            closedFromDate: String(objUiState.closedFromDate || "").trim(),
            closedToDate: String(objUiState.closedToDate || "").trim()
        },
        connectionStatus: {
            ...getDefaultRollingFuturesLtProfile(pUserId, pStrategyCode).connectionStatus,
            ...(pIncoming.connectionStatus || {})
        },
        updatedAt: ""
    };
}

async function performRollingFuturesLtConnectionCheck(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pProfileId = ""
): Promise<{
    profile: RollingFuturesLtProfileRecord;
    summary: {
        currency: string;
        availableBalance: number;
        blockedMargin: number;
    } | null;
}> {
    const objProfile = await readLiveProfile(pUserId, pStrategyCode);
    const vProfileId = String(pProfileId || objProfile.selectedApiProfileId || "").trim();
    const vNow = new Date().toISOString();

    if (!vProfileId) {
        const objStatus: RollingFuturesLtConnectionStatus = {
            ...objProfile.connectionStatus,
            state: "not_selected",
            message: "Select an API profile to start live connection checks.",
            lastCheckedAt: vNow
        };
        return {
            profile: await saveRollingFuturesLtProfile({
                ...objProfile,
                selectedApiProfileId: "",
                connectionStatus: objStatus
            }),
            summary: null
        };
    }

    try {
        const { client, profile } = await getDeltaClientForAccountId(pUserId, vProfileId);
        const objResponse = await client.apis.Wallet.getBalances();
        const objPayload = readResponsePayload(objResponse);
        const arrRows = Array.isArray(objPayload.result) ? objPayload.result as DeltaWalletBalanceRow[] : [];
        const objUsdRow = pickUsdBalanceRow(arrRows);
        const vOutboundIp = await getOutboundPublicIp();
        const objStatus: RollingFuturesLtConnectionStatus = {
            ...objProfile.connectionStatus,
            state: "connected",
            message: `Connected to Delta API profile ${profile.referenceName}.`,
            outboundIp: vOutboundIp,
            lastCheckedAt: vNow,
            lastSuccessAt: vNow,
            consecutiveFailures: 0
        };
        return {
            profile: await saveRollingFuturesLtProfile({
                ...objProfile,
                selectedApiProfileId: vProfileId,
                connectionStatus: objStatus
            }),
            summary: {
                currency: String(objUsdRow?.asset_symbol || objUsdRow?.symbol || "USD").toUpperCase(),
                availableBalance: Number(getAvailableBalanceUsd(objUsdRow).toFixed(2)),
                blockedMargin: Number(getBlockedMarginUsd(objUsdRow).toFixed(2))
            }
        };
    }
    catch (objError) {
        const objFriendly = await getFriendlyDeltaConnectionError(objError);
        const objStatus: RollingFuturesLtConnectionStatus = {
            ...objProfile.connectionStatus,
            state: objFriendly.state,
            message: objFriendly.message,
            outboundIp: objFriendly.outboundIp,
            lastCheckedAt: vNow,
            consecutiveFailures: Number(objProfile.connectionStatus?.consecutiveFailures || 0) + 1
        };
        return {
            profile: await saveRollingFuturesLtProfile({
                ...objProfile,
                selectedApiProfileId: vProfileId,
                connectionStatus: objStatus
            }),
            summary: null
        };
    }
}

async function fetchLiveFuturePositions(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pProfileId: string,
    pSymbolOverride?: string
): Promise<RollingFuturesLtImportedPositionRecord[]> {
    const objProfile = await readLiveProfile(pUserId, pStrategyCode);
    const objUiState = getMergedUiState(objProfile);
    const vSymbol = normalizeSymbolValue(pSymbolOverride || objUiState.symbol);
    const arrSavedPositions = await listRollingFuturesLtImportedPositions(pUserId, pStrategyCode);
    const objSavedByContractSide = new Map<string, RollingFuturesLtImportedPositionRecord>();
    arrSavedPositions.forEach((objRow) => {
        objSavedByContractSide.set(
            `${String(objRow.contractName || "").trim().toUpperCase()}::${String(objRow.side || "").trim().toUpperCase()}`,
            objRow
        );
    });
    const { client } = await getDeltaClientForAccountId(pUserId, pProfileId);
    const objPositionsApi = client.apis?.Positions as {
        getMarginedPositions?: (pParams: Record<string, unknown>) => Promise<unknown>;
        getPositions?: (pParams: Record<string, unknown>) => Promise<unknown>;
    };
    if (typeof objPositionsApi?.getMarginedPositions !== "function" && typeof objPositionsApi?.getPositions !== "function") {
        throw new Error("Delta positions API is not available in the installed client.");
    }
    const objResponse = typeof objPositionsApi?.getMarginedPositions === "function"
        ? await objPositionsApi.getMarginedPositions({})
        : await objPositionsApi.getPositions!({
            underlying_asset_symbol: vSymbol
        });
    const objPayload = readResponsePayload(objResponse);
    const arrRows = Array.isArray(objPayload.result) ? objPayload.result as DeltaPositionRow[] : [];
    return arrRows
        .filter((objRow) => {
            const vContract = String(objRow.product_symbol || objRow.symbol || "").trim().toUpperCase();
            return isTrackedContractForSymbol(vContract, vSymbol);
        })
        .map((objRow, pIndex) => {
            const objLiveRow = mapLivePosition(objRow, pStrategyCode, pUserId, pIndex);
            const objSavedRow = objSavedByContractSide.get(
                `${String(objLiveRow.contractName || "").trim().toUpperCase()}::${String(objLiveRow.side || "").trim().toUpperCase()}`
            );
            if (!objSavedRow) {
                return objLiveRow;
            }
            return {
                ...objLiveRow,
                importId: String(objSavedRow.importId || objLiveRow.importId).trim() || objLiveRow.importId,
                openedAt: String(objSavedRow.openedAt || objLiveRow.openedAt).trim() || objLiveRow.openedAt,
                metadata: objSavedRow.metadata && typeof objSavedRow.metadata === "object"
                    ? objSavedRow.metadata
                    : undefined
            } satisfies RollingFuturesLtImportedPositionRecord;
        })
        .filter((objRow) => objRow.qty > 0);
}

async function fetchAccountSummarySnapshot(
    pUserId: string,
    pProfileId: string,
    pSymbol: "BTC" | "ETH"
): Promise<RollingFuturesLtAccountSummarySnapshot> {
    const vLotSize = getLotSizeForSymbol(pSymbol);
    const { client, profile } = await getDeltaClientForAccountId(pUserId, pProfileId);
    const objPositionsApi = client.apis?.Positions as {
        getMarginedPositions?: (pParams: Record<string, unknown>) => Promise<unknown>;
        getPositions?: (pParams: Record<string, unknown>) => Promise<unknown>;
    } | undefined;
    const [objWalletResult, objMarketResult, objPositionsResult] = await Promise.allSettled([
        client.apis.Wallet.getBalances(),
        getLiveMarketSnapshot({
            symbol: pSymbol,
            contractName: getContractNameForSymbol(pSymbol),
            lotSize: vLotSize,
            futureQty: 1,
            futureOrderType: "market_order",
            action: "buy",
            legSide: "ce",
            expiryMode: "1",
            expiryDate: "",
            optionQty: 1,
            redOptionQtyPct: 100,
            greenOptionQtyPct: 100,
            newDelta: 0.53,
            reDelta: 0.53,
            deltaTakeProfit: 0.15,
            deltaStopLoss: 0.85,
            reEnter: false,
            addOneLotFuture: false,
            renkoEnabled: false,
            renkoStepPoints: 10,
            renkoPriceSource: "spot_price",
            loopSeconds: 8
        }),
        typeof objPositionsApi?.getMarginedPositions === "function"
            ? objPositionsApi.getMarginedPositions({})
            : (typeof objPositionsApi?.getPositions === "function"
                ? objPositionsApi.getPositions({ underlying_asset_symbol: pSymbol })
                : Promise.resolve(null))
    ]);
    if (objWalletResult.status !== "fulfilled") {
        throw objWalletResult.reason;
    }
    const objWalletPayload = readResponsePayload(objWalletResult.value);
    const arrRows = Array.isArray(objWalletPayload.result) ? objWalletPayload.result as DeltaWalletBalanceRow[] : [];
    const objUsdRow = pickUsdBalanceRow(arrRows);
    const objMarketSnapshot = objMarketResult.status === "fulfilled" ? objMarketResult.value : null;
    const objPositionsPayload = objPositionsResult.status === "fulfilled" ? readResponsePayload(objPositionsResult.value || {}) : {};
    const arrPositions = Array.isArray(objPositionsPayload.result)
        ? objPositionsPayload.result as DeltaPositionRow[]
        : (objPositionsPayload.result ? [objPositionsPayload.result as DeltaPositionRow] : []);
    const vAvailableBalance = getAvailableBalanceUsd(objUsdRow);
    const vBlockedMargin = getBlockedMarginUsd(objUsdRow);
    const vTotalBalance = getTotalBalanceUsd(objUsdRow);
    const vLivePrice = Number(objMarketSnapshot?.futuresPrice || 0);
    const vOneLotValue = Number.isFinite(vLivePrice) && vLivePrice > 0 ? vLivePrice * vLotSize : Number.NaN;
    const vSelectedFuturePositionValue = getSelectedFuturePositionValue(arrPositions, pSymbol, vLivePrice);
    const vHealthPct = vAvailableBalance > 0 && vSelectedFuturePositionValue > 0
        ? Number(((vSelectedFuturePositionValue / vAvailableBalance) * 100).toFixed(2))
        : Number.NaN;

    return {
        symbol: pSymbol,
        oneLotValue: Number.isFinite(vOneLotValue) ? Number(vOneLotValue.toFixed(2)) : null,
        totalBalance: Number.isFinite(vTotalBalance) ? Number(vTotalBalance.toFixed(2)) : null,
        blockedMargin: Number.isFinite(vBlockedMargin) ? Number(vBlockedMargin.toFixed(2)) : null,
        availableBalance: Number.isFinite(vAvailableBalance) ? Number(vAvailableBalance.toFixed(2)) : null,
        healthPct: Number.isFinite(vHealthPct) ? vHealthPct : null,
        profileLabel: profile.referenceName || profile.apiKey || "",
        openCount: arrPositions.filter((objRow) => {
            const vContract = String(objRow.product_symbol || objRow.symbol || "").trim().toUpperCase();
            const vQty = Math.abs(toFiniteNumber(objRow.net_size ?? objRow.size, 0));
            return isFutureContractSymbol(vContract) && vContract.startsWith(pSymbol) && vQty > 0;
        }).length
    };
}

async function enrichTrackedOpenPositions(
    pPositions: RollingFuturesLtImportedPositionRecord[]
): Promise<{
    positions: RollingFuturesLtEnrichedPositionRecord[];
    totals: RollingFuturesLtOpenPositionTotals;
}> {
    const arrPositions = Array.isArray(pPositions) ? pPositions : [];
    const arrOptionContracts = arrPositions
        .filter((objRow) => isOptionContractSymbol(objRow.contractName))
        .map((objRow) => String(objRow.contractName || "").trim())
        .filter(Boolean);
    const objTickerByContract = new Map<string, Awaited<ReturnType<typeof getLiveOptionTicker>>>();
    await Promise.all(arrOptionContracts.map(async (pContractName) => {
        objTickerByContract.set(pContractName, await getLiveOptionTicker(pContractName));
    }));
    const arrUnderlyingSymbols = Array.from(new Set(
        arrPositions.map((objRow) => normalizeSymbolValue(String(objRow.contractName || "").includes("ETH") ? "ETH" : "BTC"))
    ));
    const objUnderlyingPriceBySymbol = new Map<"BTC" | "ETH", number>();
    await Promise.all(arrUnderlyingSymbols.map(async (pSymbol) => {
        try {
            const objSnapshot = await getLiveMarketSnapshot(buildLiveMarketSnapshotConfig(pSymbol));
            const vUnderlyingPrice = Number(objSnapshot.futuresPrice || objSnapshot.spotPrice || 0);
            objUnderlyingPriceBySymbol.set(pSymbol, Number.isFinite(vUnderlyingPrice) ? vUnderlyingPrice : 0);
        }
        catch (_objError) {
            objUnderlyingPriceBySymbol.set(pSymbol, 0);
        }
    }));

    const objTotals: RollingFuturesLtOpenPositionTotals = {
        totalDeltaPerContract: 0,
        totalDelta: 0,
        totalDeltaDisplayPerContract: 0,
        totalDeltaDisplay: 0,
        totalGammaPerContract: 0,
        totalGamma: 0,
        totalThetaPerContract: 0,
        totalTheta: 0,
        totalThetaDisplay: 0,
        totalThetaBaseDisplay: 0,
        totalVegaPerContract: 0,
        totalVega: 0,
        totalCharges: 0,
        totalPnl: 0,
        totalMargin: 0,
        positionCount: 0
    };

    const arrEnriched = arrPositions.map((objPosition) => {
        const vContractName = String(objPosition.contractName || "").trim();
        const vQty = Math.max(0, Number(objPosition.qty || 0));
        const vSideMultiplier = String(objPosition.side || "").trim().toUpperCase() === "SELL" ? -1 : 1;
        const bIsFuture = isFutureContractSymbol(vContractName);
        const objTicker = bIsFuture ? null : (objTickerByContract.get(vContractName) || null);
        const objMetadata = getTrackedOptionMetadata(objPosition);
        const vDeltaRaw = bIsFuture ? 1 : Number(objTicker?.delta || 0);
        const vGammaRaw = bIsFuture ? 0 : Number(objTicker?.gamma || 0);
        const vThetaRaw = bIsFuture ? 0 : Number(objTicker?.theta || 0);
        const vVegaRaw = bIsFuture ? 0 : Number(objTicker?.vega || 0);
        const vMarkPrice = Number.isFinite(Number(objTicker?.markPrice))
            ? Number(objTicker?.markPrice || 0)
            : Number(objPosition.markPrice || 0);
        const vPositionSymbol = normalizeSymbolValue(vContractName.includes("ETH") ? "ETH" : "BTC");
        const vLotSize = getLotSizeForSymbol(vPositionSymbol);
        const vUnderlyingPrice = Number(objUnderlyingPriceBySymbol.get(vPositionSymbol) || 0);
        const vThetaPerContractScaled = Number.isFinite(vThetaRaw) ? (vThetaRaw * (bIsFuture ? 1 : vLotSize)) : 0;
        const vDisplayDelta = bIsFuture
            ? 1
            : Math.max(0, Number(
                Number.isFinite(Number(objMetadata.baseDelta))
                    ? objMetadata.baseDelta
                    : (Number.isFinite(vDeltaRaw) ? vDeltaRaw : 0)
            ));
        const vDisplayThetaCurrentTotal = bIsFuture
            ? 0
            : Math.abs(Number.isFinite(vThetaRaw) ? (vThetaRaw * vLotSize) * vQty : 0);
        const vBaseThetaRaw = Math.abs(Number.isFinite(Number(objMetadata.baseTheta))
            ? Number(objMetadata.baseTheta)
            : (Number.isFinite(vThetaRaw) ? vThetaRaw : 0));
        const vDisplayThetaBaseTotal = bIsFuture
            ? 0
            : Math.abs((vBaseThetaRaw * vLotSize) * vQty);
        const vCharges = estimateLivePositionCharges(
            vContractName,
            vQty,
            vLotSize,
            Number(objPosition.entryPrice || 0),
            vUnderlyingPrice
        );
        const vPnl = calculateLivePositionPnl(
            objPosition.side,
            vQty,
            vLotSize,
            Number(objPosition.entryPrice || 0),
            vMarkPrice
        );
        const objGreeks: RollingFuturesLtPositionGreeks = {
            deltaPerContract: Number((vSideMultiplier * (Number.isFinite(vDeltaRaw) ? vDeltaRaw : 0)).toFixed(6)),
            deltaTotal: Number((vSideMultiplier * (Number.isFinite(vDeltaRaw) ? vDeltaRaw : 0) * vQty).toFixed(6)),
            deltaDisplayPerContract: Number((vSideMultiplier * vDisplayDelta).toFixed(6)),
            deltaDisplayTotal: Number((vSideMultiplier * vDisplayDelta * vQty).toFixed(6)),
            gammaPerContract: Number((vSideMultiplier * (Number.isFinite(vGammaRaw) ? vGammaRaw : 0)).toFixed(6)),
            gammaTotal: Number((vSideMultiplier * (Number.isFinite(vGammaRaw) ? vGammaRaw : 0)).toFixed(6)),
            thetaPerContract: Number((vSideMultiplier * vThetaPerContractScaled).toFixed(6)),
            thetaTotal: Number((vSideMultiplier * vThetaPerContractScaled * vQty).toFixed(6)),
            thetaDisplayTotal: Number((vSideMultiplier * vDisplayThetaCurrentTotal).toFixed(6)),
            thetaBaseDisplayTotal: Number((vSideMultiplier * vDisplayThetaBaseTotal).toFixed(6)),
            vegaPerContract: Number((vSideMultiplier * (Number.isFinite(vVegaRaw) ? vVegaRaw : 0)).toFixed(6)),
            vegaTotal: Number((vSideMultiplier * (Number.isFinite(vVegaRaw) ? vVegaRaw : 0)).toFixed(6))
        };

        objTotals.totalDeltaPerContract += objGreeks.deltaPerContract;
        objTotals.totalDelta += objGreeks.deltaTotal;
        objTotals.totalDeltaDisplayPerContract += objGreeks.deltaDisplayPerContract;
        objTotals.totalDeltaDisplay += objGreeks.deltaDisplayTotal;
        objTotals.totalGammaPerContract += objGreeks.gammaPerContract;
        objTotals.totalGamma += objGreeks.gammaTotal;
        objTotals.totalThetaPerContract += objGreeks.thetaPerContract;
        objTotals.totalTheta += objGreeks.thetaTotal;
        objTotals.totalThetaDisplay += objGreeks.thetaDisplayTotal;
        objTotals.totalThetaBaseDisplay += objGreeks.thetaBaseDisplayTotal;
        objTotals.totalVegaPerContract += objGreeks.vegaPerContract;
        objTotals.totalVega += objGreeks.vegaTotal;
        objTotals.totalCharges += vCharges;
        objTotals.totalPnl += vPnl;
        objTotals.totalMargin += Number(objPosition.margin || 0);
        objTotals.positionCount += 1;

        return {
            ...objPosition,
            contractKind: bIsFuture ? "future" : "option",
            lotSize: vLotSize,
            markPrice: Number.isFinite(vMarkPrice) ? vMarkPrice : Number(objPosition.markPrice || 0),
            charges: vCharges,
            pnl: vPnl,
            greeks: objGreeks
        } satisfies RollingFuturesLtEnrichedPositionRecord;
    });

    objTotals.totalDeltaPerContract = Number(objTotals.totalDeltaPerContract.toFixed(6));
    objTotals.totalDelta = Number(objTotals.totalDelta.toFixed(6));
    objTotals.totalDeltaDisplayPerContract = Number(objTotals.totalDeltaDisplayPerContract.toFixed(6));
    objTotals.totalDeltaDisplay = Number(objTotals.totalDeltaDisplay.toFixed(6));
    objTotals.totalGammaPerContract = Number(objTotals.totalGammaPerContract.toFixed(6));
    objTotals.totalGamma = Number(objTotals.totalGamma.toFixed(6));
    objTotals.totalThetaPerContract = Number(objTotals.totalThetaPerContract.toFixed(6));
    objTotals.totalTheta = Number(objTotals.totalTheta.toFixed(6));
    objTotals.totalThetaDisplay = Number(objTotals.totalThetaDisplay.toFixed(6));
    objTotals.totalThetaBaseDisplay = Number(objTotals.totalThetaBaseDisplay.toFixed(6));
    objTotals.totalVegaPerContract = Number(objTotals.totalVegaPerContract.toFixed(6));
    objTotals.totalVega = Number(objTotals.totalVega.toFixed(6));
    objTotals.totalCharges = Number(objTotals.totalCharges.toFixed(6));
    objTotals.totalPnl = Number(objTotals.totalPnl.toFixed(6));
    objTotals.totalMargin = Number(objTotals.totalMargin.toFixed(6));

    return {
        positions: arrEnriched,
        totals: objTotals
    };
}

function buildNeutralStatus(
    pUiState: Record<string, unknown>,
    pTotals: RollingFuturesLtOpenPositionTotals,
    pAutoTraderEnabled: boolean,
    pRuntime: RollingFuturesLtRuntimeRecord | null = null
): RollingFuturesLtNeutralStatus {
    if (!pAutoTraderEnabled) {
        return {
            mode: "none",
            totalDelta: Number(Number(pTotals.totalDelta || 0).toFixed(6)),
            totalTheta: Number(Number(pTotals.totalTheta || 0).toFixed(6)),
            totalGamma: Number(Number(pTotals.totalGamma || 0).toFixed(6)),
            minDelta: null,
            maxDelta: null,
            deltaDriftPct: null,
            baseOptionDeltaAbs: null,
            gammaFactor: null,
            deltaBalanceTone: "secondary",
            deltaBalanceText: "Balance: Mode OFF"
        };
    }

    const vMode = getNeutralModeFromUiState(pUiState);
    const vMinDelta = Number.isFinite(Number(pUiState.minusDelta)) ? Number(pUiState.minusDelta) : -25;
    const vMaxDelta = Number.isFinite(Number(pUiState.plusDelta)) ? Number(pUiState.plusDelta) : 25;
    const vTotalDelta = Number(pTotals.totalDelta || 0);
    const vTotalGamma = Number(pTotals.totalGamma || 0);
    const objDeltaBaseline = getDeltaNeutralBaselineState(pRuntime);
    const vBaseOptionDeltaAbs = objDeltaBaseline.baseOptionDeltaAbs;
    const bPctDriftMode = vMode === "delta" || vMode === "gamma";
    const vDeltaDriftPct = bPctDriftMode && vBaseOptionDeltaAbs > 0
        ? Number(((vTotalDelta / vBaseOptionDeltaAbs) * 100).toFixed(6))
        : null;
    const vGammaFactorValue = vMode === "gamma"
        ? getGammaAwareCompressionFactor(vTotalGamma)
        : 0;
    const vGammaFactor = vMode === "gamma" ? vGammaFactorValue : null;
    const vGammaMinDelta = vMode === "gamma" && vGammaFactorValue > 0
        ? Number((vMinDelta / vGammaFactorValue).toFixed(6))
        : null;
    const vGammaMaxDelta = vMode === "gamma" && vGammaFactorValue > 0
        ? Number((vMaxDelta / vGammaFactorValue).toFixed(6))
        : null;

    let vDeltaBalanceTone: RollingFuturesLtNeutralStatus["deltaBalanceTone"] = "secondary";
    let vDeltaBalanceText = "Balance: Mode OFF";
    if (vMode === "delta" || vMode === "gamma") {
        if (!(vBaseOptionDeltaAbs > 0) || !Number.isFinite(Number(vDeltaDriftPct))) {
            vDeltaBalanceTone = "secondary";
            vDeltaBalanceText = "Balance: Waiting for hedge baseline";
        }
        else {
            const vSafeDriftPct = Number(vDeltaDriftPct);
            const vActiveMin = vMode === "gamma" && Number.isFinite(vGammaMinDelta) ? Number(vGammaMinDelta) : vMinDelta;
            const vActiveMax = vMode === "gamma" && Number.isFinite(vGammaMaxDelta) ? Number(vGammaMaxDelta) : vMaxDelta;
            if (vSafeDriftPct >= vActiveMin && vSafeDriftPct <= vActiveMax) {
                const vHeadroom = Math.min(vSafeDriftPct - vActiveMin, vActiveMax - vSafeDriftPct);
                vDeltaBalanceTone = "success";
                vDeltaBalanceText = vMode === "gamma"
                    ? `Balance: Gamma-safe (${vHeadroom.toFixed(2)}% left)`
                    : `Balance: Balanced (${vHeadroom.toFixed(2)}% left)`;
            }
            else {
                const vOverBy = vSafeDriftPct < vActiveMin ? (vActiveMin - vSafeDriftPct) : (vSafeDriftPct - vActiveMax);
                vDeltaBalanceTone = "danger";
                vDeltaBalanceText = vMode === "gamma"
                    ? `Balance: Gamma hedge (${Math.abs(vOverBy).toFixed(2)}% over)`
                    : `Balance: Hedge Trigger (${Math.abs(vOverBy).toFixed(2)}% over)`;
            }
        }
    }
    else if (vMode === "range") {
        if (vTotalDelta >= vMinDelta && vTotalDelta <= vMaxDelta) {
            const vHeadroom = Math.min(vTotalDelta - vMinDelta, vMaxDelta - vTotalDelta);
            vDeltaBalanceTone = "success";
            vDeltaBalanceText = `Balance: In range (${vHeadroom.toFixed(3)} left)`;
        }
        else {
            const vOverBy = vTotalDelta < vMinDelta ? (vMinDelta - vTotalDelta) : (vTotalDelta - vMaxDelta);
            vDeltaBalanceTone = "danger";
            vDeltaBalanceText = `Balance: Range hedge (${Math.abs(vOverBy).toFixed(3)} over)`;
        }
    }

    return {
        mode: vMode,
        totalDelta: Number(vTotalDelta.toFixed(6)),
        totalTheta: Number(Number(pTotals.totalTheta || 0).toFixed(6)),
        totalGamma: Number(vTotalGamma.toFixed(6)),
        minDelta: vMode === "delta"
            ? vMinDelta
            : (vMode === "range"
                ? vMinDelta
                : (vMode === "gamma" && Number.isFinite(vGammaMinDelta) ? Number(vGammaMinDelta) : null)),
        maxDelta: vMode === "delta"
            ? vMaxDelta
            : (vMode === "range"
                ? vMaxDelta
                : (vMode === "gamma" && Number.isFinite(vGammaMaxDelta) ? Number(vGammaMaxDelta) : null)),
        deltaDriftPct: bPctDriftMode && Number.isFinite(Number(vDeltaDriftPct)) ? Number(vDeltaDriftPct) : null,
        baseOptionDeltaAbs: bPctDriftMode && vBaseOptionDeltaAbs > 0 ? Number(vBaseOptionDeltaAbs.toFixed(6)) : null,
        gammaFactor: vMode === "gamma" && Number.isFinite(Number(vGammaFactor)) ? Number(vGammaFactor) : null,
        deltaBalanceTone: vDeltaBalanceTone,
        deltaBalanceText: vDeltaBalanceText
    };
}

async function buildOpenPositionsPayload(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pPositions?: RollingFuturesLtImportedPositionRecord[]
): Promise<RollingFuturesLtOpenPositionsPayload> {
    const objProfile = await readLiveProfile(pUserId, pStrategyCode);
    const objRuntime = await loadRollingFuturesLtRuntime(pUserId, pStrategyCode);
    const objUiState = getMergedUiState(objProfile);
    let arrPositions = pPositions || await listRollingFuturesLtImportedPositions(pUserId, pStrategyCode);
    if (arrPositions.some(hasMissingTrackedOptionBaseGreeks)) {
        arrPositions = await applyImportedOptionBaseGreeks(arrPositions, Number(objUiState.newD1 || 0));
        await replaceRollingFuturesLtImportedPositions(pUserId, pStrategyCode, arrPositions);
    }
    const objEnriched = await enrichTrackedOpenPositions(arrPositions);
    const bAutoTraderActive = Boolean(objRuntime?.autoTraderEnabled)
        && String(objRuntime?.status || "").trim().toLowerCase() === "running";
    const vRuntimeBrokerageTotal = getBrokerageRecoveryTotal(objRuntime);
    const vOpenPositionCharges = Number(objEnriched.totals.totalCharges || 0);
    const vEffectiveBrokerageTotal = objEnriched.positions.length > 0
        ? Math.max(vRuntimeBrokerageTotal, vOpenPositionCharges)
        : vRuntimeBrokerageTotal;
    const vRecoveredTotalPnl = getRecoveredTotalPnl(objRuntime);
    return {
        positions: objEnriched.positions,
        totals: objEnriched.totals,
        neutralStatus: buildNeutralStatus(objUiState, objEnriched.totals, bAutoTraderActive, objRuntime),
        recoveryMetrics: {
            totalBrokerageToRecover: Number(vEffectiveBrokerageTotal.toFixed(4)),
            totalPnl: Number(vRecoveredTotalPnl.toFixed(4)),
            netPnl: Number((vRecoveredTotalPnl + Number(objEnriched.totals.totalPnl || 0) - vEffectiveBrokerageTotal).toFixed(4))
        }
    };
}

function getScheduledReEntryState(pRuntime: RollingFuturesLtRuntimeRecord | null): {
    reason: "brokerage" | "blockmargin" | "";
    runAt: string;
} {
    const objState = (pRuntime?.state || {}) as Record<string, unknown>;
    const objReEntry = objState.pendingReEntry && typeof objState.pendingReEntry === "object"
        ? objState.pendingReEntry as Record<string, unknown>
        : {};
    const vReason = String(objReEntry.reason || "").trim().toLowerCase();
    return {
        reason: vReason === "brokerage" || vReason === "blockmargin" ? vReason : "",
        runAt: String(objReEntry.runAt || "").trim()
    };
}

function buildRuntimeStateWithPendingReEntry(
    pRuntime: RollingFuturesLtRuntimeRecord | null,
    pReason: "brokerage" | "blockmargin" | "",
    pRunAt = ""
): Record<string, unknown> {
    const objState = { ...((pRuntime?.state || {}) as Record<string, unknown>) };
    if (!pReason || !pRunAt) {
        delete objState.pendingReEntry;
        return objState;
    }
    objState.pendingReEntry = {
        reason: pReason,
        runAt: pRunAt
    };
    return objState;
}

function getRestartCloseProtectionUntil(pRuntime: RollingFuturesLtRuntimeRecord | null): string {
    const objState = (pRuntime?.state || {}) as Record<string, unknown>;
    const objProtection = objState.restartCloseProtection && typeof objState.restartCloseProtection === "object"
        ? objState.restartCloseProtection as Record<string, unknown>
        : {};
    return String(objProtection.until || "").trim();
}

function buildRuntimeStateWithRestartCloseProtection(
    pRuntime: RollingFuturesLtRuntimeRecord | null,
    pUntil = ""
): Record<string, unknown> {
    const objState = { ...((pRuntime?.state || {}) as Record<string, unknown>) };
    if (!pUntil) {
        delete objState.restartCloseProtection;
        return objState;
    }
    objState.restartCloseProtection = {
        until: pUntil
    };
    return objState;
}

function getProfitCloseRule(
    pUiState: Record<string, unknown>,
    pOpenPositions: RollingFuturesLtOpenPositionsPayload,
    pSummary: RollingFuturesLtAccountSummarySnapshot | null
): {
    triggered: boolean;
    reason: "brokerage" | "blockmargin" | "";
    message: string;
    thresholdValue: number;
    reEnterEnabled: boolean;
} {
    const vNetProfit = Number(pOpenPositions.recoveryMetrics?.netPnl || 0);
    if (!(vNetProfit > 0)) {
        return { triggered: false, reason: "", message: "", thresholdValue: 0, reEnterEnabled: false };
    }

    const bBrokerageEnabled = Boolean(pUiState.closeNetProfitBrokerage);
    const vBrokerageMultiplier = Math.max(0, Number(pUiState.brokerageMultiplier || 0));
    const vBrokerageBase = Math.max(0, Number(pOpenPositions.recoveryMetrics?.totalBrokerageToRecover || 0));
    const vBrokerageBaseRounded = Number(vBrokerageBase.toFixed(4));
    if (bBrokerageEnabled && vBrokerageMultiplier > 0 && vBrokerageBaseRounded >= 0.01) {
        const vThreshold = vBrokerageBaseRounded * vBrokerageMultiplier;
        if (vNetProfit >= vThreshold) {
            return {
                triggered: true,
                reason: "brokerage",
                message: `Net PnL ${vNetProfit.toFixed(2)} reached the brokerage target ${vThreshold.toFixed(2)} (${vBrokerageBaseRounded.toFixed(2)} x ${vBrokerageMultiplier.toFixed(2)}).`,
                thresholdValue: Number(vThreshold.toFixed(6)),
                reEnterEnabled: Boolean(pUiState.reEnterBrok)
            };
        }
    }

    const bBlockedMarginEnabled = Boolean(pUiState.closeBlockedMargin);
    const vBlockedMarginPct = Math.max(0, Number(pUiState.blockedMarginPct || 0));
    const vBlockedMargin = Math.max(0, Number(pSummary?.blockedMargin || 0));
    if (bBlockedMarginEnabled && vBlockedMarginPct > 0 && vBlockedMargin > 0) {
        const vThreshold = vBlockedMargin * (vBlockedMarginPct / 100);
        if (vNetProfit >= vThreshold) {
            return {
                triggered: true,
                reason: "blockmargin",
                message: `Net PnL ${vNetProfit.toFixed(2)} reached the blocked-margin target ${vThreshold.toFixed(2)}.`,
                thresholdValue: Number(vThreshold.toFixed(6)),
                reEnterEnabled: Boolean(pUiState.reEnterBlock)
            };
        }
    }

    return { triggered: false, reason: "", message: "", thresholdValue: 0, reEnterEnabled: false };
}

async function findActiveFutureOrderById(
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
    const objPayload = readResponsePayload(objResponse);
    const arrRows = Array.isArray(objPayload.result) ? objPayload.result as DeltaActiveOrderRow[] : [];
    return arrRows.find((objRow) => String(objRow.id || "").trim() === pOrderId) || null;
}

async function repriceOrReplaceLimitFutureOrder(
    pClient: any,
    pContractName: string,
    pOrderId: string,
    pSide: "buy" | "sell",
    pQty: number,
    pNextPrice: string
): Promise<{ orderId: string; orderState: string; payload: Record<string, unknown>; }> {
    try {
        if (typeof pClient?.apis?.Orders?.editOrder === "function") {
            const objResponse = await pClient.apis.Orders.editOrder({
                order: {
                    id: Number.isFinite(Number(pOrderId)) ? Number(pOrderId) : pOrderId,
                    product_symbol: pContractName,
                    size: pQty,
                    limit_price: pNextPrice
                }
            });
            const objPayload = readResponsePayload(objResponse);
            return {
                orderId: getOrderId(objPayload) || pOrderId,
                orderState: getOrderState(objPayload) || "open",
                payload: objPayload
            };
        }
    }
    catch (objError) {
        if (isRetryablePostOnlyRejection(objError)) {
            return {
                orderId: "",
                orderState: "rejected",
                payload: {}
            };
        }
        throw objError;
    }

    return {
        orderId: pOrderId,
        orderState: "open",
        payload: {}
    };
}

async function placeManagedManualFutureOrder(
    pUserId: string,
    pSelectedApiProfileId: string,
    pSymbol: "BTC" | "ETH",
    pAction: "BUY" | "SELL",
    pQty: number,
    pOrderType: "limit_order" | "market_order"
): Promise<{
    order: Record<string, unknown>;
    request: Record<string, unknown>;
    entryPrice: number;
    entryTs: string;
    orderTypeUsed: "limit_order" | "market_order";
    contractName: string;
    filled: boolean;
    outcome: "filled" | "cancelled_unfilled" | "rejected_unfilled";
}> {
    const { client } = await getDeltaClientForAccountId(pUserId, pSelectedApiProfileId);
    const vContractName = getContractNameForSymbol(pSymbol);
    const vSide = pAction === "SELL" ? "sell" : "buy";
    const vQty = Math.max(1, Math.floor(Number(pQty || 1)));
    let objSnapshot = await getLiveMarketSnapshot(buildLiveMarketSnapshotConfig(pSymbol, pOrderType));
    const objOrderPayload: Record<string, unknown> = {
        product_symbol: vContractName,
        size: vQty,
        side: vSide,
        order_type: pOrderType,
        time_in_force: "gtc",
        post_only: pOrderType === "limit_order",
        reduce_only: false
    };

    if (pOrderType !== "limit_order") {
        const objResponse = await client.apis.Orders.placeOrder({
            order: objOrderPayload
        });
        const objPayload = readResponsePayload(objResponse);
        return {
            order: (objPayload.result && typeof objPayload.result === "object") ? objPayload.result as Record<string, unknown> : objPayload,
            request: objOrderPayload,
            entryPrice: Number(objSnapshot.futuresPrice || 0),
            entryTs: String(objSnapshot.ts || new Date().toISOString()),
            orderTypeUsed: "market_order",
            contractName: vContractName,
            filled: true,
            outcome: "filled"
        };
    }

    objOrderPayload.limit_price = String(objSnapshot.futuresPrice);
    let objResponse: unknown;
    let objPayload: Record<string, unknown> = {};
    let vOrderId = "";
    let vLastOrderState = "";
    let objFinalOrder: Record<string, unknown> = {};
    try {
        objResponse = await client.apis.Orders.placeOrder({
            order: objOrderPayload
        });
        objPayload = readResponsePayload(objResponse);
        vOrderId = getOrderId(objPayload);
        vLastOrderState = getOrderState(objPayload);
        objFinalOrder = (objPayload.result && typeof objPayload.result === "object") ? objPayload.result as Record<string, unknown> : objPayload;
    }
    catch (objError) {
        if (!isRetryablePostOnlyRejection(objError)) {
            throw objError;
        }
        vLastOrderState = "rejected";
    }

    for (let vAttempt = 0; vAttempt < gFutureLimitRetryCount; vAttempt += 1) {
        if (!vOrderId && isCancelledLikeOrderState(vLastOrderState)) {
            if (vAttempt === (gFutureLimitRetryCount - 1)) {
                break;
            }
            await sleep(gFutureLimitRetryDelayMs);
            objSnapshot = await getLiveMarketSnapshot(buildLiveMarketSnapshotConfig(pSymbol, pOrderType));
            objOrderPayload.limit_price = String(objSnapshot.futuresPrice);
            try {
                objResponse = await client.apis.Orders.placeOrder({
                    order: objOrderPayload
                });
                objPayload = readResponsePayload(objResponse);
                vOrderId = getOrderId(objPayload);
                vLastOrderState = getOrderState(objPayload);
                objFinalOrder = (objPayload.result && typeof objPayload.result === "object") ? objPayload.result as Record<string, unknown> : objPayload;
            }
            catch (objError) {
                if (!isRetryablePostOnlyRejection(objError)) {
                    throw objError;
                }
                vOrderId = "";
                vLastOrderState = "rejected";
            }
            continue;
        }

        if (!vOrderId) {
            return {
                order: objFinalOrder,
                request: objOrderPayload,
                entryPrice: Number(objSnapshot.futuresPrice || 0),
                entryTs: String(objSnapshot.ts || new Date().toISOString()),
                orderTypeUsed: "limit_order",
                contractName: vContractName,
                filled: false,
                outcome: "rejected_unfilled"
            };
        }

        await sleep(gFutureLimitRetryDelayMs);
        const objActiveOrder = await findActiveFutureOrderById(client, vContractName, vOrderId);
        if (!objActiveOrder) {
            if (isCancelledLikeOrderState(vLastOrderState)) {
                if (vAttempt === (gFutureLimitRetryCount - 1)) {
                    break;
                }
                objSnapshot = await getLiveMarketSnapshot(buildLiveMarketSnapshotConfig(pSymbol, pOrderType));
                objOrderPayload.limit_price = String(objSnapshot.futuresPrice);
                try {
                    objResponse = await client.apis.Orders.placeOrder({
                        order: objOrderPayload
                    });
                    objPayload = readResponsePayload(objResponse);
                    vOrderId = getOrderId(objPayload);
                    vLastOrderState = getOrderState(objPayload);
                    objFinalOrder = (objPayload.result && typeof objPayload.result === "object") ? objPayload.result as Record<string, unknown> : objPayload;
                }
                catch (objError) {
                    if (!isRetryablePostOnlyRejection(objError)) {
                        throw objError;
                    }
                    vOrderId = "";
                    vLastOrderState = "rejected";
                }
                continue;
            }
            return {
                order: objFinalOrder,
                request: objOrderPayload,
                entryPrice: Number(objSnapshot.futuresPrice || 0),
                entryTs: String(objSnapshot.ts || new Date().toISOString()),
                orderTypeUsed: "limit_order",
                contractName: vContractName,
                filled: true,
                outcome: "filled"
            };
        }

        const vUnfilledSize = Math.max(0, Math.floor(Number(objActiveOrder.unfilled_size ?? objActiveOrder.size ?? vQty)));
        if (!(vUnfilledSize > 0)) {
            return {
                order: objFinalOrder,
                request: objOrderPayload,
                entryPrice: Number(objSnapshot.futuresPrice || 0),
                entryTs: String(objSnapshot.ts || new Date().toISOString()),
                orderTypeUsed: "limit_order",
                contractName: vContractName,
                filled: true,
                outcome: "filled"
            };
        }

        if (vAttempt === (gFutureLimitRetryCount - 1)) {
            break;
        }

        objSnapshot = await getLiveMarketSnapshot(buildLiveMarketSnapshotConfig(pSymbol, pOrderType));
        const vNextPrice = String(objSnapshot.futuresPrice);
        const objRepriced = await repriceOrReplaceLimitFutureOrder(
            client,
            vContractName,
            vOrderId,
            vSide,
            vQty,
            vNextPrice
        );
        vOrderId = objRepriced.orderId;
        vLastOrderState = objRepriced.orderState || "";
        if (!vOrderId) {
            if (isCancelledLikeOrderState(vLastOrderState)) {
                objOrderPayload.limit_price = vNextPrice;
                continue;
            }
            break;
        }
        objFinalOrder = {
            ...objFinalOrder,
            id: vOrderId || objFinalOrder.id,
            order_type: "limit_order",
            limit_price: vNextPrice,
            post_only: true
        };
        objOrderPayload.limit_price = vNextPrice;
    }

    const objActiveOrder = await findActiveFutureOrderById(client, vContractName, vOrderId);
    if (objActiveOrder) {
        if (typeof client?.apis?.Orders?.cancelOrder !== "function") {
            throw new Error("Unable to cancel unfilled future limit order safely.");
        }
        await client.apis.Orders.cancelOrder({
            order: {
                id: Number.isFinite(Number(vOrderId)) ? Number(vOrderId) : vOrderId,
                product_symbol: vContractName
            }
        });
    }

    if (!vOrderId && isCancelledLikeOrderState(vLastOrderState)) {
        return {
            order: objFinalOrder,
            request: objOrderPayload,
            entryPrice: Number(objSnapshot.futuresPrice || 0),
            entryTs: String(objSnapshot.ts || new Date().toISOString()),
            orderTypeUsed: "limit_order",
            contractName: vContractName,
            filled: false,
            outcome: "rejected_unfilled"
        };
    }

    return {
        order: objFinalOrder,
        request: objOrderPayload,
        entryPrice: Number(objSnapshot.futuresPrice || 0),
        entryTs: String(objSnapshot.ts || new Date().toISOString()),
        orderTypeUsed: "limit_order",
        contractName: vContractName,
        filled: false,
        outcome: "cancelled_unfilled"
    };
}

async function logFuturesEvent(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pEventType: string,
    pSeverity: "info" | "success" | "warning" | "error",
    pTitle: string,
    pMessage: string,
    pPayload: Record<string, unknown> = {}
): Promise<void> {
    const objEvent = {
        userId: pUserId,
        strategyCode: pStrategyCode,
        eventType: pEventType,
        severity: pSeverity,
        title: pTitle,
        message: pMessage,
        payload: pPayload
    };

    await saveRollingOptionsEvent(objEvent);
    await sendFuturesTelegramForEvent(pUserId, objEvent);
}

async function calculateTrackedNeutralTotals(
    pPositions: RollingFuturesLtImportedPositionRecord[]
): Promise<{ totalDelta: number; totalTheta: number; totalGamma: number; optionDeltaAbs: number; }> {
    const objEnriched = await enrichTrackedOpenPositions(pPositions);
    const vOptionDelta = objEnriched.positions
        .filter((objPosition) => objPosition.contractKind === "option")
        .reduce((pSum, objPosition) => pSum + Number(objPosition.greeks?.deltaTotal || 0), 0);
    return {
        totalDelta: Number(objEnriched.totals.totalDelta.toFixed(6)),
        totalTheta: Number(objEnriched.totals.totalTheta.toFixed(6)),
        totalGamma: Number(objEnriched.totals.totalGamma.toFixed(6)),
        optionDeltaAbs: Number(Math.abs(vOptionDelta).toFixed(6))
    };
}

function getNeutralModeFromUiState(
    pUiState: Record<string, unknown>
): RollingFuturesLtNeutralStatus["mode"] {
    if (Boolean(pUiState.gammaAwareNeutral)) {
        return "gamma";
    }
    if (Boolean(pUiState.rangeDeltaNeutral)) {
        return "range";
    }
    if (Boolean(pUiState.onlyDeltaNeutral)) {
        return "delta";
    }
    return "none";
}

function getGammaAwareCompressionFactor(pTotalGamma: number): number {
    const vGammaMagnitude = Math.abs(Number(pTotalGamma || 0));
    if (!(vGammaMagnitude > 0)) {
        return 1;
    }
    return Number((1 + Math.min(4, vGammaMagnitude * 10)).toFixed(6));
}

function getDeltaNeutralBaselineState(pRuntime: RollingFuturesLtRuntimeRecord | null): {
    baseOptionDeltaAbs: number;
    lastHedgeAt: string;
} {
    const objState = (pRuntime?.state || {}) as Record<string, unknown>;
    const objBaseline = objState.deltaNeutralBaseline && typeof objState.deltaNeutralBaseline === "object"
        ? objState.deltaNeutralBaseline as Record<string, unknown>
        : {};
    const vBaseOptionDeltaAbs = Math.abs(Number(objBaseline.baseOptionDeltaAbs || 0));
    const vLastHedgeAt = String(objBaseline.lastHedgeAt || "").trim();
    return {
        baseOptionDeltaAbs: Number.isFinite(vBaseOptionDeltaAbs) ? vBaseOptionDeltaAbs : 0,
        lastHedgeAt: vLastHedgeAt
    };
}

function buildRuntimeStateWithDeltaNeutralBaseline(
    pRuntime: RollingFuturesLtRuntimeRecord | null,
    pBaseOptionDeltaAbs: number | null,
    pLastHedgeAt = ""
): Record<string, unknown> {
    const objState = { ...((pRuntime?.state || {}) as Record<string, unknown>) };
    const vBaseOptionDeltaAbs = Math.abs(Number(pBaseOptionDeltaAbs || 0));
    const vLastHedgeAt = String(pLastHedgeAt || "").trim();
    if (!(vBaseOptionDeltaAbs > 0)) {
        if (!vLastHedgeAt) {
            delete objState.deltaNeutralBaseline;
            return objState;
        }
        objState.deltaNeutralBaseline = {
            lastHedgeAt: vLastHedgeAt
        };
        return objState;
    }
    objState.deltaNeutralBaseline = {
        baseOptionDeltaAbs: Number(vBaseOptionDeltaAbs.toFixed(6)),
        lastHedgeAt: vLastHedgeAt
    };
    return objState;
}

function getNeutralityHedgePendingUntil(pRuntime: RollingFuturesLtRuntimeRecord | null): string {
    const objState = (pRuntime?.state || {}) as Record<string, unknown>;
    return String(objState.neutralityHedgePendingUntil || "").trim();
}

function buildRuntimeStateWithNeutralityHedgePending(
    pRuntime: RollingFuturesLtRuntimeRecord | null,
    pPendingUntil = ""
): Record<string, unknown> {
    const objState = { ...((pRuntime?.state || {}) as Record<string, unknown>) };
    const vPendingUntil = String(pPendingUntil || "").trim();
    if (!vPendingUntil) {
        delete objState.neutralityHedgePendingUntil;
        return objState;
    }
    objState.neutralityHedgePendingUntil = vPendingUntil;
    return objState;
}

function getNeutralityHedgeSkipAuditState(pRuntime: RollingFuturesLtRuntimeRecord | null): {
    reason: string;
    loggedAt: string;
} {
    const objState = (pRuntime?.state || {}) as Record<string, unknown>;
    const objAudit = objState.neutralityHedgeSkipAudit && typeof objState.neutralityHedgeSkipAudit === "object"
        ? objState.neutralityHedgeSkipAudit as Record<string, unknown>
        : {};
    return {
        reason: String(objAudit.reason || "").trim(),
        loggedAt: String(objAudit.loggedAt || "").trim()
    };
}

function buildRuntimeStateWithNeutralityHedgeSkipAudit(
    pRuntime: RollingFuturesLtRuntimeRecord | null,
    pReason = "",
    pLoggedAt = ""
): Record<string, unknown> {
    const objState = { ...((pRuntime?.state || {}) as Record<string, unknown>) };
    const vReason = String(pReason || "").trim();
    const vLoggedAt = String(pLoggedAt || "").trim();
    if (!vReason || !vLoggedAt) {
        delete objState.neutralityHedgeSkipAudit;
        return objState;
    }
    objState.neutralityHedgeSkipAudit = {
        reason: vReason,
        loggedAt: vLoggedAt
    };
    return objState;
}

async function logNeutralityHedgeSkippedOnce(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pRuntime: RollingFuturesLtRuntimeRecord | null,
    pReason: "cooldown" | "pending" | "lock",
    pContext: {
        symbol: "BTC" | "ETH";
        qty: number;
        totalDelta: number;
        totalTheta: number;
        mode: "none" | "delta" | "range" | "gamma";
        threshold: number | null;
    }
): Promise<Record<string, unknown> | null> {
    const objRuntime = pRuntime || await loadRollingFuturesLtRuntime(pUserId, pStrategyCode)
        || getDefaultRollingFuturesLtRuntime(pUserId, pStrategyCode);
    const objAudit = getNeutralityHedgeSkipAuditState(objRuntime);
    const vLastLoggedAtMs = Number.isFinite(new Date(objAudit.loggedAt).getTime())
        ? new Date(objAudit.loggedAt).getTime()
        : 0;
    const vNowMs = Date.now();
    if (objAudit.reason === pReason && vLastLoggedAtMs > 0 && (vNowMs - vLastLoggedAtMs) < 30_000) {
        return null;
    }

    const vLoggedAt = new Date(vNowMs).toISOString();
    const objNextState = buildRuntimeStateWithNeutralityHedgeSkipAudit(objRuntime, pReason, vLoggedAt);
    await saveRollingFuturesLtRuntime({
        ...objRuntime,
        userId: pUserId,
        strategyCode: pStrategyCode,
        state: objNextState
    });
    await logFuturesEvent(
        pUserId,
        pStrategyCode,
        "manual_action",
        "info",
        "Neutral Hedge Skipped",
        pReason === "cooldown"
            ? "Delta-neutral hedge was skipped because the hedge cooldown is still active."
            : (pReason === "pending"
                ? "Delta-neutral hedge was skipped because another hedge is still being processed."
                : "Delta-neutral hedge was skipped because another hedge path already owns the hedge lock."),
        {
            ...pContext,
            reason: `delta_neutral_skip_${pReason}`
        }
    );
    return objNextState;
}

function getBrokerageRecoveryTotal(pRuntime: RollingFuturesLtRuntimeRecord | null): number {
    const objState = (pRuntime?.state || {}) as Record<string, unknown>;
    const vTotal = Number(objState.brokerageRecoveryTotal || 0);
    return Number.isFinite(vTotal) ? Math.max(0, vTotal) : 0;
}

function buildRuntimeStateWithBrokerageRecoveryTotal(
    pRuntime: RollingFuturesLtRuntimeRecord | null,
    pTotal: number
): Record<string, unknown> {
    const objState = { ...((pRuntime?.state || {}) as Record<string, unknown>) };
    objState.brokerageRecoveryTotal = Number(Math.max(0, Number(pTotal || 0)).toFixed(4));
    return objState;
}

function getRecoveredTotalPnl(pRuntime: RollingFuturesLtRuntimeRecord | null): number {
    const objState = (pRuntime?.state || {}) as Record<string, unknown>;
    const vTotal = Number(objState.recoveredTotalPnl || 0);
    return Number.isFinite(vTotal) ? vTotal : 0;
}

function buildRuntimeStateWithRecoveredTotalPnl(
    pRuntime: RollingFuturesLtRuntimeRecord | null,
    pTotal: number
): Record<string, unknown> {
    const objState = { ...((pRuntime?.state || {}) as Record<string, unknown>) };
    objState.recoveredTotalPnl = Number(Number(pTotal || 0).toFixed(4));
    return objState;
}

function normalizeRollingFuturesSelectedTelegramEventTypes(pValue: unknown): string[] {
    if (!Array.isArray(pValue)) {
        return [];
    }
    return pValue
        .map((vItem) => String(vItem || "").trim())
        .filter((vItem) => Boolean(vItem) && gRollingFuturesTelegramEventTypes.has(vItem));
}

async function shouldSendFuturesTelegram(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pEventType: string
): Promise<boolean> {
    if (!gRollingFuturesTelegramEventTypes.has(pEventType)) {
        return false;
    }
    const objProfile = await readLiveProfile(pUserId, pStrategyCode);
    const arrSelectedTypes = normalizeRollingFuturesSelectedTelegramEventTypes(objProfile.uiState?.telegramAlertTypes);
    if (!arrSelectedTypes.length) {
        return false;
    }
    return arrSelectedTypes.includes(pEventType);
}

async function sendFuturesTelegramForEvent(
    pUserId: string,
    pEvent: {
        strategyCode: RollingFuturesLtStrategyCode;
        eventType: string;
        title: string;
        message: string;
        payload: Record<string, unknown>;
    }
): Promise<void> {
    const vBotToken = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
    if (!vBotToken) {
        return;
    }

    const objAccount = await getAccountById(pUserId);
    const vTelegramChatId = String(objAccount?.telegramChatId || "").trim();
    if (!vTelegramChatId) {
        return;
    }

    if (!(await shouldSendFuturesTelegram(pUserId, pEvent.strategyCode, pEvent.eventType))) {
        return;
    }

    const arrLines = [
        `${gStrategyNames[pEvent.strategyCode] || "Rolling Futures"} - Live`,
        `Time: ${new Date().toLocaleString("en-IN")}`,
        "",
        pEvent.title,
        pEvent.message
    ];

    const vSymbol = String(pEvent.payload.symbol || "").trim();
    const vContractName = String(pEvent.payload.contractName || "").trim();
    const vQty = Number(pEvent.payload.qty || 0);
    const vReason = String(pEvent.payload.reason || "").trim();
    if (vSymbol) {
        arrLines.push(`Symbol: ${vSymbol}`);
    }
    if (vContractName) {
        arrLines.push(`Contract: ${vContractName}`);
    }
    if (Number.isFinite(vQty) && vQty > 0) {
        arrLines.push(`Qty: ${vQty}`);
    }
    if (vReason) {
        arrLines.push(`Reason: ${vReason}`);
    }

    try {
        await fetch(`https://api.telegram.org/bot${encodeURIComponent(vBotToken)}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: vTelegramChatId,
                text: arrLines.join("\n")
            })
        });
    }
    catch (_objError) {
    }
}

async function saveBrokerageRecoveryTotal(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pTotal: number
): Promise<RollingFuturesLtRuntimeRecord> {
    const objRuntime = await loadRollingFuturesLtRuntime(pUserId, pStrategyCode)
        || getDefaultRollingFuturesLtRuntime(pUserId, pStrategyCode);
    return saveRollingFuturesLtRuntime({
        ...objRuntime,
        userId: pUserId,
        strategyCode: pStrategyCode,
        state: {
            ...((objRuntime.state || {}) as Record<string, unknown>),
            ...buildRuntimeStateWithBrokerageRecoveryTotal(objRuntime, pTotal)
        }
    });
}

async function saveRecoveredTotalPnl(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pTotal: number
): Promise<RollingFuturesLtRuntimeRecord> {
    const objRuntime = await loadRollingFuturesLtRuntime(pUserId, pStrategyCode)
        || getDefaultRollingFuturesLtRuntime(pUserId, pStrategyCode);
    return saveRollingFuturesLtRuntime({
        ...objRuntime,
        userId: pUserId,
        strategyCode: pStrategyCode,
        state: {
            ...((objRuntime.state || {}) as Record<string, unknown>),
            ...buildRuntimeStateWithRecoveredTotalPnl(objRuntime, pTotal)
        }
    });
}

async function resetRecoveryMetrics(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode
): Promise<void> {
    await saveBrokerageRecoveryTotal(pUserId, pStrategyCode, 0);
    await saveRecoveredTotalPnl(pUserId, pStrategyCode, 0);
}

async function incrementBrokerageRecoveryTotal(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pDelta: number,
    pRemainingPositionCount: number
): Promise<RollingFuturesLtRuntimeRecord> {
    void pRemainingPositionCount;
    const objRuntime = await loadRollingFuturesLtRuntime(pUserId, pStrategyCode)
        || getDefaultRollingFuturesLtRuntime(pUserId, pStrategyCode);
    const vNextTotal = Number((getBrokerageRecoveryTotal(objRuntime) + Math.max(0, Number(pDelta || 0))).toFixed(4));
    return saveRollingFuturesLtRuntime({
        ...objRuntime,
        userId: pUserId,
        strategyCode: pStrategyCode,
        state: {
            ...((objRuntime.state || {}) as Record<string, unknown>),
            ...buildRuntimeStateWithBrokerageRecoveryTotal(objRuntime, vNextTotal)
        }
    });
}

async function incrementRecoveredTotalPnl(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pDelta: number,
    pRemainingPositionCount: number
): Promise<RollingFuturesLtRuntimeRecord> {
    void pRemainingPositionCount;
    const objRuntime = await loadRollingFuturesLtRuntime(pUserId, pStrategyCode)
        || getDefaultRollingFuturesLtRuntime(pUserId, pStrategyCode);
    const vNextTotal = Number((getRecoveredTotalPnl(objRuntime) + Number(pDelta || 0)).toFixed(4));
    return saveRollingFuturesLtRuntime({
        ...objRuntime,
        userId: pUserId,
        strategyCode: pStrategyCode,
        state: {
            ...((objRuntime.state || {}) as Record<string, unknown>),
            ...buildRuntimeStateWithRecoveredTotalPnl(objRuntime, vNextTotal)
        }
    });
}

async function estimateTrackedPositionCharge(
    pPosition: Pick<RollingFuturesLtImportedPositionRecord, "contractName" | "qty" | "entryPrice" | "markPrice">,
    pPriceOverride?: number
): Promise<number> {
    const vContractName = String(pPosition.contractName || "").trim();
    const vSymbol = normalizeSymbolValue(vContractName.includes("ETH") ? "ETH" : "BTC");
    const vLotSize = getLotSizeForSymbol(vSymbol);
    let vUnderlyingPrice = 0;
    if (isOptionContractSymbol(vContractName)) {
        try {
            const objSnapshot = await getLiveMarketSnapshot(buildLiveMarketSnapshotConfig(vSymbol));
            vUnderlyingPrice = Number(objSnapshot.futuresPrice || objSnapshot.spotPrice || 0);
        }
        catch (_objError) {
            vUnderlyingPrice = 0;
        }
    }
    return estimateLivePositionCharges(
        vContractName,
        Number(pPosition.qty || 0),
        vLotSize,
        Number.isFinite(Number(pPriceOverride)) ? Number(pPriceOverride) : Number(pPosition.entryPrice || pPosition.markPrice || 0),
        vUnderlyingPrice
    );
}

function estimateTrackedPositionPnl(
    pPosition: Pick<RollingFuturesLtImportedPositionRecord, "contractName" | "side" | "qty" | "entryPrice" | "markPrice">,
    pPriceOverride?: number
): number {
    const vContractName = String(pPosition.contractName || "").trim();
    const vSymbol = normalizeSymbolValue(vContractName.includes("ETH") ? "ETH" : "BTC");
    const vLotSize = getLotSizeForSymbol(vSymbol);
    return calculateLivePositionPnl(
        pPosition.side,
        Number(pPosition.qty || 0),
        vLotSize,
        Number(pPosition.entryPrice || 0),
        Number.isFinite(Number(pPriceOverride)) ? Number(pPriceOverride) : Number(pPosition.markPrice || pPosition.entryPrice || 0)
    );
}

async function applyServerSideNeutralityCheck(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pSelectedApiProfileId: string,
    pUiState: Record<string, unknown>,
    pSymbol: "BTC" | "ETH",
    pTrackedPositions: RollingFuturesLtImportedPositionRecord[],
    pRuntime: RollingFuturesLtRuntimeRecord | null = null
): Promise<{
    trackedOpenPositions: RollingFuturesLtImportedPositionRecord[];
    hedgePlaced: boolean;
    totalDelta: number;
    totalTheta: number;
    mode: "none" | "delta" | "range" | "gamma";
    threshold: number | null;
    nextRuntimeState: Record<string, unknown> | null;
}> {
    const vMode = getNeutralModeFromUiState(pUiState);
    const objRuntimeBase = pRuntime
        || await loadRollingFuturesLtRuntime(pUserId, pStrategyCode)
        || getDefaultRollingFuturesLtRuntime(pUserId, pStrategyCode);
    const objTotals = await calculateTrackedNeutralTotals(pTrackedPositions);
    const objDeltaBaseline = getDeltaNeutralBaselineState(objRuntimeBase);
    const vBaselineOptionDeltaAbs = objDeltaBaseline.baseOptionDeltaAbs > 0
        ? objDeltaBaseline.baseOptionDeltaAbs
        : objTotals.optionDeltaAbs;
    const vLastHedgeAtMs = Number.isFinite(new Date(objDeltaBaseline.lastHedgeAt).getTime())
        ? new Date(objDeltaBaseline.lastHedgeAt).getTime()
        : 0;
    const vPendingUntilMs = Number.isFinite(new Date(getNeutralityHedgePendingUntil(objRuntimeBase)).getTime())
        ? new Date(getNeutralityHedgePendingUntil(objRuntimeBase)).getTime()
        : 0;
    const vNowMs = Date.now();
    const bHedgeCooldownActive = vLastHedgeAtMs > 0 && (vNowMs - vLastHedgeAtMs) < gNeutralityHedgeCooldownMs;
    const bHedgePendingActive = vPendingUntilMs > vNowMs;

    if (vMode === "none") {
        return {
            trackedOpenPositions: pTrackedPositions,
            hedgePlaced: false,
            totalDelta: objTotals.totalDelta,
            totalTheta: objTotals.totalTheta,
            mode: vMode,
            threshold: null,
            nextRuntimeState: buildRuntimeStateWithNeutralityHedgePending({
                ...objRuntimeBase,
                state: buildRuntimeStateWithDeltaNeutralBaseline(objRuntimeBase, null)
            }, "")
        };
    }

    let bShouldHedge = false;
    let vThreshold: number | null = null;
    let objNextRuntimeState: Record<string, unknown> | null = null;
    if (vMode === "delta") {
        const vNegThresholdPct = Number.isFinite(Number(pUiState.minusDelta)) ? Number(pUiState.minusDelta) : -25;
        const vPosThresholdPct = Number.isFinite(Number(pUiState.plusDelta)) ? Number(pUiState.plusDelta) : 25;
        const vDriftPct = vBaselineOptionDeltaAbs > 0
            ? Number(((objTotals.totalDelta / vBaselineOptionDeltaAbs) * 100).toFixed(6))
            : 0;
        vThreshold = null;
        bShouldHedge = vBaselineOptionDeltaAbs > 0
            && (vDriftPct < vNegThresholdPct || vDriftPct > vPosThresholdPct);
        objNextRuntimeState = buildRuntimeStateWithDeltaNeutralBaseline(objRuntimeBase, vBaselineOptionDeltaAbs, objDeltaBaseline.lastHedgeAt);
    }
    else if (vMode === "range") {
        const vMinDelta = Number.isFinite(Number(pUiState.minusDelta)) ? Number(pUiState.minusDelta) : -25;
        const vMaxDelta = Number.isFinite(Number(pUiState.plusDelta)) ? Number(pUiState.plusDelta) : 25;
        vThreshold = null;
        bShouldHedge = objTotals.totalDelta < vMinDelta || objTotals.totalDelta > vMaxDelta;
        objNextRuntimeState = buildRuntimeStateWithDeltaNeutralBaseline(objRuntimeBase, null, objDeltaBaseline.lastHedgeAt);
    }
    else {
        const vNegThresholdPct = Number.isFinite(Number(pUiState.minusDelta)) ? Number(pUiState.minusDelta) : -25;
        const vPosThresholdPct = Number.isFinite(Number(pUiState.plusDelta)) ? Number(pUiState.plusDelta) : 25;
        const vGammaFactor = getGammaAwareCompressionFactor(objTotals.totalGamma);
        const vGammaNegThresholdPct = Number((vNegThresholdPct / vGammaFactor).toFixed(6));
        const vGammaPosThresholdPct = Number((vPosThresholdPct / vGammaFactor).toFixed(6));
        const vDriftPct = vBaselineOptionDeltaAbs > 0
            ? Number(((objTotals.totalDelta / vBaselineOptionDeltaAbs) * 100).toFixed(6))
            : 0;
        vThreshold = null;
        bShouldHedge = vBaselineOptionDeltaAbs > 0
            && (vDriftPct < vGammaNegThresholdPct || vDriftPct > vGammaPosThresholdPct);
        objNextRuntimeState = buildRuntimeStateWithDeltaNeutralBaseline(objRuntimeBase, vBaselineOptionDeltaAbs, objDeltaBaseline.lastHedgeAt);
    }

    const vHedgeQty = Math.round(Math.abs(objTotals.totalDelta));
    if (!bShouldHedge || !(vHedgeQty >= 1)) {
        return {
            trackedOpenPositions: pTrackedPositions,
            hedgePlaced: false,
            totalDelta: objTotals.totalDelta,
            totalTheta: objTotals.totalTheta,
            mode: vMode,
            threshold: vThreshold,
            nextRuntimeState: objNextRuntimeState
        };
    }

    if (bHedgeCooldownActive) {
        const objSkipState = await logNeutralityHedgeSkippedOnce(
            pUserId,
            pStrategyCode,
            objRuntimeBase,
            "cooldown",
            {
                symbol: pSymbol,
                qty: vHedgeQty,
                totalDelta: objTotals.totalDelta,
                totalTheta: objTotals.totalTheta,
                mode: vMode,
                threshold: vThreshold
            }
        );
        return {
            trackedOpenPositions: pTrackedPositions,
            hedgePlaced: false,
            totalDelta: objTotals.totalDelta,
            totalTheta: objTotals.totalTheta,
            mode: vMode,
            threshold: vThreshold,
            nextRuntimeState: objSkipState || objNextRuntimeState
        };
    }

    if (bHedgePendingActive) {
        const objSkipState = await logNeutralityHedgeSkippedOnce(
            pUserId,
            pStrategyCode,
            objRuntimeBase,
            "pending",
            {
                symbol: pSymbol,
                qty: vHedgeQty,
                totalDelta: objTotals.totalDelta,
                totalTheta: objTotals.totalTheta,
                mode: vMode,
                threshold: vThreshold
            }
        );
        return {
            trackedOpenPositions: pTrackedPositions,
            hedgePlaced: false,
            totalDelta: objTotals.totalDelta,
            totalTheta: objTotals.totalTheta,
            mode: vMode,
            threshold: vThreshold,
            nextRuntimeState: objSkipState || objNextRuntimeState
        };
    }

    const vHedgeLockKey = getNeutralityHedgeLockKey(pUserId, pStrategyCode);
    if (gNeutralityHedgeLocks.has(vHedgeLockKey)) {
        const objSkipState = await logNeutralityHedgeSkippedOnce(
            pUserId,
            pStrategyCode,
            objRuntimeBase,
            "lock",
            {
                symbol: pSymbol,
                qty: vHedgeQty,
                totalDelta: objTotals.totalDelta,
                totalTheta: objTotals.totalTheta,
                mode: vMode,
                threshold: vThreshold
            }
        );
        return {
            trackedOpenPositions: pTrackedPositions,
            hedgePlaced: false,
            totalDelta: objTotals.totalDelta,
            totalTheta: objTotals.totalTheta,
            mode: vMode,
            threshold: vThreshold,
            nextRuntimeState: objSkipState || objNextRuntimeState
        };
    }

    gNeutralityHedgeLocks.add(vHedgeLockKey);
    const vHedgeAction: "BUY" | "SELL" = objTotals.totalDelta > 0 ? "SELL" : "BUY";
    try {
        const objLatestRuntime = await loadRollingFuturesLtRuntime(pUserId, pStrategyCode)
            || objRuntimeBase;
        const vLatestPendingUntilMs = Number.isFinite(new Date(getNeutralityHedgePendingUntil(objLatestRuntime)).getTime())
            ? new Date(getNeutralityHedgePendingUntil(objLatestRuntime)).getTime()
            : 0;
        const objLatestBaseline = getDeltaNeutralBaselineState(objLatestRuntime);
        const vLatestLastHedgeAtMs = Number.isFinite(new Date(objLatestBaseline.lastHedgeAt).getTime())
            ? new Date(objLatestBaseline.lastHedgeAt).getTime()
            : 0;
        if (vLatestPendingUntilMs > Date.now() || (vLatestLastHedgeAtMs > 0 && (Date.now() - vLatestLastHedgeAtMs) < gNeutralityHedgeCooldownMs)) {
            const vSkipReason: "pending" | "cooldown" = vLatestPendingUntilMs > Date.now() ? "pending" : "cooldown";
            const objSkipState = await logNeutralityHedgeSkippedOnce(
                pUserId,
                pStrategyCode,
                objLatestRuntime,
                vSkipReason,
                {
                    symbol: pSymbol,
                    qty: vHedgeQty,
                    totalDelta: objTotals.totalDelta,
                    totalTheta: objTotals.totalTheta,
                    mode: vMode,
                    threshold: vThreshold
                }
            );
            return {
                trackedOpenPositions: pTrackedPositions,
                hedgePlaced: false,
                totalDelta: objTotals.totalDelta,
                totalTheta: objTotals.totalTheta,
                mode: vMode,
                threshold: vThreshold,
                nextRuntimeState: objSkipState || objNextRuntimeState
            };
        }

        await saveRollingFuturesLtRuntime({
            ...objLatestRuntime,
            userId: pUserId,
            strategyCode: pStrategyCode,
            state: buildRuntimeStateWithNeutralityHedgePending(
                objLatestRuntime,
                new Date(Date.now() + gNeutralityHedgePendingMs).toISOString()
            )
        });

        const objPlacedHedge = await placeManagedManualFutureOrder(
            pUserId,
            pSelectedApiProfileId,
            pSymbol,
            vHedgeAction,
            vHedgeQty,
            "market_order"
        );
        const arrSaved = await replaceRollingFuturesLtImportedPositions(pUserId, pStrategyCode, [
            ...pTrackedPositions,
            {
                userId: pUserId,
                strategyCode: pStrategyCode,
                importId: crypto.randomUUID(),
                contractName: objPlacedHedge.contractName,
                side: vHedgeAction,
                qty: vHedgeQty,
                entryPrice: Number(objPlacedHedge.entryPrice || 0),
                markPrice: Number(objPlacedHedge.entryPrice || 0),
                charges: 0,
                pnl: 0,
                margin: 0,
                liquidationPrice: 0,
                openedAt: String(objPlacedHedge.entryTs || new Date().toISOString()),
                updatedAt: String(objPlacedHedge.entryTs || new Date().toISOString())
            }
        ]);
        const vHedgeCharge = await estimateTrackedPositionCharge({
            contractName: objPlacedHedge.contractName,
            qty: vHedgeQty,
            entryPrice: Number(objPlacedHedge.entryPrice || 0),
            markPrice: Number(objPlacedHedge.entryPrice || 0)
        });
        await incrementBrokerageRecoveryTotal(pUserId, pStrategyCode, vHedgeCharge, arrSaved.length);

        await logFuturesEvent(
            pUserId,
            pStrategyCode,
            "future_opened",
            "warning",
            "Delta Neutral Hedge Executed",
            `${vHedgeAction} future hedge placed from server-side delta-neutral check.`,
            {
                symbol: pSymbol,
                qty: vHedgeQty,
                totalDelta: objTotals.totalDelta,
                totalTheta: objTotals.totalTheta,
                threshold: vThreshold,
                mode: vMode,
                reason: "delta_neutral_hedge"
            }
        );

        const vHedgePlacedAt = new Date().toISOString();
        const objPostHedgeTotals = await calculateTrackedNeutralTotals(arrSaved);
        const objRuntimeAfterHedge = await loadRollingFuturesLtRuntime(pUserId, pStrategyCode)
            || objLatestRuntime;
        const objBaselineState = vMode === "delta" || vMode === "gamma"
            ? buildRuntimeStateWithDeltaNeutralBaseline(objRuntimeAfterHedge, objPostHedgeTotals.optionDeltaAbs, vHedgePlacedAt)
            : buildRuntimeStateWithDeltaNeutralBaseline(objRuntimeAfterHedge, null, vHedgePlacedAt);
        const objNextState = buildRuntimeStateWithNeutralityHedgePending({
            ...objRuntimeAfterHedge,
            state: objBaselineState
        }, "");
        await saveRollingFuturesLtRuntime({
            ...objRuntimeAfterHedge,
            userId: pUserId,
            strategyCode: pStrategyCode,
            state: objNextState
        });

        return {
            trackedOpenPositions: arrSaved,
            hedgePlaced: true,
            totalDelta: objTotals.totalDelta,
            totalTheta: objTotals.totalTheta,
            mode: vMode,
            threshold: vThreshold,
            nextRuntimeState: objNextState
        };
    }
    catch (objError) {
        const objRuntimeAfterError = await loadRollingFuturesLtRuntime(pUserId, pStrategyCode)
            || objRuntimeBase;
        await saveRollingFuturesLtRuntime({
            ...objRuntimeAfterError,
            userId: pUserId,
            strategyCode: pStrategyCode,
            state: buildRuntimeStateWithNeutralityHedgePending(objRuntimeAfterError, "")
        });
        throw objError;
    }
    finally {
        gNeutralityHedgeLocks.delete(vHedgeLockKey);
    }
}

async function executeStrategyPlacement(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pSelectedApiProfileId: string,
    pProfile: RollingFuturesLtProfileRecord,
    pInput: {
        action: "buy" | "sell";
        symbol: "BTC" | "ETH";
        legSide: "ce" | "pe" | "both";
        expiryMode: "1" | "2" | "4" | "5" | "6" | "7";
        expiryDate: string;
        qty: number;
        targetDelta: number;
    }
): Promise<{
    profileLabel: string;
    trackedOpenPositions: RollingFuturesLtImportedPositionRecord[];
    contracts: Array<Record<string, unknown>>;
    orders: Array<Record<string, unknown>>;
    neutralCheck: {
        mode: "none" | "delta" | "range" | "gamma";
        hedgePlaced: boolean;
        totalDelta: number;
        totalTheta: number;
        threshold: number | null;
    };
}> {
    const { client, profile } = await getDeltaClientForAccountId(pUserId, pSelectedApiProfileId);
    await resetRecoveryMetrics(pUserId, pStrategyCode);
    const objUiState = getMergedUiState(pProfile);
    const arrExisting = await listRollingFuturesLtImportedPositions(pUserId, pStrategyCode);
    const arrOpenOptions = listTrackedOpenOptionPositions(arrExisting);
    if (arrOpenOptions.length > 0) {
        throw new Error(`An option position is already open (${arrOpenOptions[0].contractName}). Close the existing option before opening a new one.`);
    }
    const objOptionMetadata = getLiveOptionRuleMetadataFromUiState(objUiState, "strategy_option_open");
    const bIsDualStrategy = pStrategyCode === "rolling-futures-lt-dual";
    const arrOptionSides: Array<"CE" | "PE"> = pInput.legSide === "both"
        ? (bIsDualStrategy ? ["CE", "PE"] : [])
        : [pInput.legSide === "pe" ? "PE" : "CE"];
    if (!arrOptionSides.length) {
        throw new Error("Only one option position can be open at a time. Select either CE or PE, not both.");
    }
    const objConfig = {
        symbol: pInput.symbol,
        contractName: getContractNameForSymbol(pInput.symbol),
        lotSize: getLotSizeForSymbol(pInput.symbol),
        futureQty: 1,
        futureOrderType: "market_order" as const,
        action: pInput.action,
        legSide: pInput.legSide,
        expiryMode: pInput.expiryMode,
        expiryDate: pInput.expiryDate,
        optionQty: pInput.qty,
        redOptionQtyPct: 100,
        greenOptionQtyPct: 100,
        newDelta: pInput.targetDelta,
        reDelta: pInput.targetDelta,
        deltaTakeProfit: 0.25,
        deltaStopLoss: 0.65,
        reEnter: false,
        addOneLotFuture: false,
        renkoEnabled: false,
        renkoStepPoints: 10,
        renkoPriceSource: "spot_price" as const,
        loopSeconds: 8
    };

    const arrOrders: Array<Record<string, unknown>> = [];
    const arrContracts: Array<Record<string, unknown>> = [];

    for (const vOptionSide of arrOptionSides) {
        const objContract = await findBestLiveOptionContract(objConfig, vOptionSide, pInput.targetDelta, true);
        if (!objContract) {
            throw new Error(`No live ${vOptionSide} contract was found for ${pInput.symbol} with delta at or below ${pInput.targetDelta.toFixed(2)}.`);
        }

        const vAbsoluteDelta = Math.abs(Number(objContract.delta || 0));
        if (!(vAbsoluteDelta <= pInput.targetDelta)) {
            throw new Error(`The selected ${vOptionSide} contract delta ${vAbsoluteDelta.toFixed(2)} exceeded New D ${pInput.targetDelta.toFixed(2)}.`);
        }

        const objOrderPayload: Record<string, unknown> = {
            product_symbol: objContract.contractSymbol,
            size: pInput.qty,
            side: pInput.action,
            order_type: "market_order",
            time_in_force: "gtc",
            post_only: false,
            reduce_only: false
        };
        const objResponse = await client.apis.Orders.placeOrder({
            order: objOrderPayload
        });
        const objPayload = readResponsePayload(objResponse);
        arrOrders.push({
            order: objPayload.result || objPayload,
            request: objOrderPayload
        });
        arrContracts.push({
            contractSymbol: objContract.contractSymbol,
            optionSide: objContract.optionSide,
            strike: objContract.strike,
            delta: objContract.delta,
            theta: objContract.theta,
            markPrice: objContract.markPrice,
            requestedExpiryDate: objContract.requestedExpiryDate,
            resolvedExpiryDate: objContract.expiryDate,
            usedNextDayExpiryFallback: objContract.usedNextDayFallback
        });
    }

    const arrInitialSaved = await replaceRollingFuturesLtImportedPositions(pUserId, pStrategyCode, [
        ...arrExisting,
        ...arrContracts.map((objContract) => ({
            userId: pUserId,
            strategyCode: pStrategyCode,
            importId: crypto.randomUUID(),
            contractName: String(objContract.contractSymbol || "").trim(),
            side: pInput.action.toUpperCase(),
            qty: pInput.qty,
            entryPrice: Number(objContract.markPrice || 0),
            markPrice: Number(objContract.markPrice || 0),
            charges: 0,
            pnl: 0,
            margin: 0,
            liquidationPrice: 0,
            metadata: optionMetadataToRecord({
                ...objOptionMetadata,
                baseDelta: Math.abs(Number(objContract.delta || 0)),
                baseTheta: Math.abs(Number(objContract.theta || 0))
            }),
            openedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        } satisfies RollingFuturesLtImportedPositionRecord))
    ]);
    const arrEntryCharges = await Promise.all(arrContracts.map((objContract) => estimateTrackedPositionCharge({
        contractName: String(objContract.contractSymbol || "").trim(),
        qty: pInput.qty,
        entryPrice: Number(objContract.markPrice || 0),
        markPrice: Number(objContract.markPrice || 0)
    })));
    await incrementBrokerageRecoveryTotal(
        pUserId,
        pStrategyCode,
        arrEntryCharges.reduce((pSum, vValue) => pSum + Number(vValue || 0), 0),
        arrInitialSaved.length
    );
    const objNeutralCheck = await applyServerSideNeutralityCheck(
        pUserId,
        pStrategyCode,
            pSelectedApiProfileId,
            objUiState,
            pInput.symbol,
            arrInitialSaved,
            null
        );

    return {
        profileLabel: profile.referenceName || profile.apiKey || "",
        trackedOpenPositions: objNeutralCheck.trackedOpenPositions,
        contracts: arrContracts,
        orders: arrOrders,
        neutralCheck: {
            mode: objNeutralCheck.mode,
            hedgePlaced: objNeutralCheck.hedgePlaced,
            totalDelta: objNeutralCheck.totalDelta,
            totalTheta: objNeutralCheck.totalTheta,
            threshold: objNeutralCheck.threshold
        }
    };
}

async function closeTrackedPositionOnDelta(
    pUserId: string,
    pSelectedApiProfileId: string,
    pPosition: RollingFuturesLtImportedPositionRecord
): Promise<void> {
    const { client } = await getDeltaClientForAccountId(pUserId, pSelectedApiProfileId);
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

async function openTrackedOptionReEntry(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pSelectedApiProfileId: string,
    pProfile: RollingFuturesLtProfileRecord,
    pClosedPosition: RollingFuturesLtImportedPositionRecord,
    pMetadata: RollingFuturesLtOptionMetadata,
    pReason: "sl" | "tp"
): Promise<RollingFuturesLtImportedPositionRecord | null> {
    const { client } = await getDeltaClientForAccountId(pUserId, pSelectedApiProfileId);
    const objUiState = getMergedUiState(pProfile);
    const vSymbol = normalizeSymbolValue(objUiState.symbol);
    const vLegSide = getTrackedOptionLegSide(pClosedPosition.contractName);
    const vTargetDelta = Math.max(0, Number(pMetadata.reEntryDelta || objUiState.reD1 || 0.53));
    if (!(vTargetDelta > 0)) {
        return null;
    }

    const objConfig = {
        symbol: vSymbol,
        contractName: getContractNameForSymbol(vSymbol),
        lotSize: getLotSizeForSymbol(vSymbol),
        futureQty: 1,
        futureOrderType: "market_order" as const,
        action: String(pClosedPosition.side || "").trim().toUpperCase() === "BUY" ? "buy" as const : "sell" as const,
        legSide: vLegSide,
        expiryMode: (["1", "2", "4", "5", "6", "7"].includes(String(objUiState.expiryMode1 || "5").trim())
            ? String(objUiState.expiryMode1 || "5").trim()
            : "5") as "1" | "2" | "4" | "5" | "6" | "7",
        expiryDate: String(objUiState.expiryDate1 || "").trim(),
        optionQty: Math.max(1, Math.floor(Number(pClosedPosition.qty || 1))),
        redOptionQtyPct: 100,
        greenOptionQtyPct: 100,
        newDelta: vTargetDelta,
        reDelta: vTargetDelta,
        deltaTakeProfit: Math.max(0, Number(pMetadata.takeProfitDelta || objUiState.tpD1 || 0.25)),
        deltaStopLoss: Math.max(0, Number(pMetadata.stopLossDelta || objUiState.slD1 || 0.65)),
        reEnter: Boolean(pMetadata.reEnterEnabled),
        addOneLotFuture: false,
        renkoEnabled: false,
        renkoStepPoints: 10,
        renkoPriceSource: "spot_price" as const,
        loopSeconds: 8
    };

    const objContract = await findBestLiveOptionContract(
        objConfig,
        vLegSide === "pe" ? "PE" : "CE",
        vTargetDelta,
        true
    );
    if (!objContract) {
        return null;
    }

    const vAbsoluteDelta = Math.abs(Number(objContract.delta || 0));
    if (!(vAbsoluteDelta <= vTargetDelta)) {
        return null;
    }
    if (shouldTriggerTrackedOption(
        pClosedPosition.side,
        vAbsoluteDelta,
        Number(pMetadata.takeProfitDelta || objUiState.tpD1 || 0.25),
        Number(pMetadata.stopLossDelta || objUiState.slD1 || 0.65)
    ).shouldAct) {
        return null;
    }

    await client.apis.Orders.placeOrder({
        order: {
            product_symbol: objContract.contractSymbol,
            size: Math.max(1, Math.floor(Number(pClosedPosition.qty || 1))),
            side: String(pClosedPosition.side || "").trim().toUpperCase() === "BUY" ? "buy" : "sell",
            order_type: "market_order",
            time_in_force: "gtc",
            post_only: false,
            reduce_only: false
        }
    });

    return {
        userId: pUserId,
        strategyCode: pStrategyCode,
        importId: crypto.randomUUID(),
        contractName: String(objContract.contractSymbol || "").trim(),
        side: String(pClosedPosition.side || "").trim().toUpperCase(),
        qty: Math.max(1, Math.floor(Number(pClosedPosition.qty || 1))),
        entryPrice: Number(objContract.markPrice || 0),
        markPrice: Number(objContract.markPrice || 0),
        charges: 0,
        pnl: 0,
        margin: 0,
        liquidationPrice: 0,
        metadata: optionMetadataToRecord({
            baseDelta: vAbsoluteDelta,
            baseTheta: Math.abs(Number(objContract.theta || 0)),
            takeProfitDelta: Math.max(0, Number(pMetadata.takeProfitDelta || objUiState.tpD1 || 0.25)),
            stopLossDelta: Math.max(0, Number(pMetadata.stopLossDelta || objUiState.slD1 || 0.65)),
            reEntryDelta: vTargetDelta,
            reEnterEnabled: Boolean(pMetadata.reEnterEnabled),
            openedReason: pReason === "sl" ? "sl_reentry" : "tp_reentry"
        }),
        openedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
}

async function applyTriggeredOptionRule(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pSelectedApiProfileId: string,
    pProfile: RollingFuturesLtProfileRecord,
    pPosition: RollingFuturesLtImportedPositionRecord,
    pCurrentDelta: number,
    pReason: "sl" | "tp",
    pTrackedPositions: RollingFuturesLtImportedPositionRecord[]
): Promise<RollingFuturesLtImportedPositionRecord[]> {
    await closeTrackedPositionOnDelta(pUserId, pSelectedApiProfileId, pPosition);
    const objMetadata = getTrackedOptionMetadata(pPosition);
    const vCloseCharge = await estimateTrackedPositionCharge(
        pPosition,
        Number(pPosition.markPrice || pPosition.entryPrice || 0)
    );
    const vClosePnl = estimateTrackedPositionPnl(
        pPosition,
        Number(pPosition.markPrice || pPosition.entryPrice || 0)
    );
    let arrNextPositions = pTrackedPositions.filter((objRow) => objRow.importId !== pPosition.importId);

    await logFuturesEvent(
        pUserId,
        pStrategyCode,
        pReason === "sl" ? "sl_triggered" : "tp_triggered",
        pReason === "sl" ? "warning" : "info",
        pReason === "sl" ? "Option SL Triggered" : "Option TP Triggered",
        `Closed option ${pPosition.contractName} after ${pReason.toUpperCase()} hit at delta ${Math.abs(Number(pCurrentDelta || 0)).toFixed(3)}.`,
        {
            contractName: pPosition.contractName,
            qty: pPosition.qty,
            currentDelta: Math.abs(Number(pCurrentDelta || 0)),
            reason: pReason
        }
    );

    if (Boolean(objMetadata.reEnterEnabled)) {
        const objReEntry = await openTrackedOptionReEntry(
            pUserId,
            pStrategyCode,
            pSelectedApiProfileId,
            pProfile,
            pPosition,
            objMetadata,
            pReason
        );
        if (objReEntry) {
            arrNextPositions = [...arrNextPositions, objReEntry];
            const vReEntryCharge = await estimateTrackedPositionCharge(objReEntry);
            await incrementBrokerageRecoveryTotal(
                pUserId,
                pStrategyCode,
                vCloseCharge + vReEntryCharge,
                arrNextPositions.length
            );
            await incrementRecoveredTotalPnl(pUserId, pStrategyCode, vClosePnl, arrNextPositions.length);
            await logFuturesEvent(
                pUserId,
                pStrategyCode,
                "reentry_opened",
                "success",
                "Option Re-Entry Opened",
                `Opened replacement option ${objReEntry.contractName} after ${pReason.toUpperCase()} using Re D ${Number(objMetadata.reEntryDelta || 0).toFixed(2)}.`,
                {
                    contractName: objReEntry.contractName,
                    qty: objReEntry.qty,
                    reason: pReason
                }
            );
        }
        else {
            await incrementBrokerageRecoveryTotal(pUserId, pStrategyCode, vCloseCharge, arrNextPositions.length);
            await incrementRecoveredTotalPnl(pUserId, pStrategyCode, vClosePnl, arrNextPositions.length);
        }
    }
    else {
        await incrementBrokerageRecoveryTotal(pUserId, pStrategyCode, vCloseCharge, arrNextPositions.length);
        await incrementRecoveredTotalPnl(pUserId, pStrategyCode, vClosePnl, arrNextPositions.length);
    }

    return replaceRollingFuturesLtImportedPositions(pUserId, pStrategyCode, arrNextPositions);
}

async function findTriggeredTrackedOption(
    pTrackedPositions: RollingFuturesLtImportedPositionRecord[],
    pUiState: Record<string, unknown>
): Promise<{
    position: RollingFuturesLtImportedPositionRecord;
    currentDelta: number;
    reason: "sl" | "tp";
} | null> {
    for (const objPosition of pTrackedPositions) {
        if (!isOptionContractSymbol(objPosition.contractName)) {
            continue;
        }
        const objTicker = await getLiveOptionTicker(String(objPosition.contractName || "").trim());
        const vCurrentDelta = Math.abs(Number(objTicker?.delta || 0));
        if (!Number.isFinite(vCurrentDelta)) {
            continue;
        }
        const objMetadata = getTrackedOptionMetadata(objPosition);
        const objDecision = shouldTriggerTrackedOption(
            objPosition.side,
            vCurrentDelta,
            Number(objMetadata.takeProfitDelta || pUiState.tpD1 || 0.25),
            Number(objMetadata.stopLossDelta || pUiState.slD1 || 0.65)
        );
        if (objDecision.shouldAct && objDecision.reason) {
            return {
                position: objPosition,
                currentDelta: vCurrentDelta,
                reason: objDecision.reason
            };
        }
    }
    return null;
}

async function closeTrackedPositionsOnDelta(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pSelectedApiProfileId: string,
    pPositions: RollingFuturesLtImportedPositionRecord[]
): Promise<{
    closedPositions: Array<Record<string, unknown>>;
    profileLabel: string;
}> {
    const { client, profile } = await getDeltaClientForAccountId(pUserId, pSelectedApiProfileId);
    const arrCloseCharges = await Promise.all(pPositions.map((objPosition) => estimateTrackedPositionCharge(
        objPosition,
        Number(objPosition.markPrice || objPosition.entryPrice || 0)
    )));
    const arrClosePnls = pPositions.map((objPosition) => estimateTrackedPositionPnl(
        objPosition,
        Number(objPosition.markPrice || objPosition.entryPrice || 0)
    ));
    const arrClosed: Array<Record<string, unknown>> = [];
    for (const objPosition of pPositions) {
        const objOrderPayload: Record<string, unknown> = {
            product_symbol: objPosition.contractName,
            size: objPosition.qty,
            side: String(objPosition.side || "").trim().toUpperCase() === "BUY" ? "sell" : "buy",
            order_type: "market_order",
            time_in_force: "gtc",
            post_only: false,
            reduce_only: true
        };
        const objResponse = await client.apis.Orders.placeOrder({ order: objOrderPayload });
        const objPayload = readResponsePayload(objResponse);
        arrClosed.push({
            importId: objPosition.importId,
            contractName: objPosition.contractName,
            qty: objPosition.qty,
            order: objPayload.result || objPayload
        });
    }
    await replaceRollingFuturesLtImportedPositions(pUserId, pStrategyCode, []);
    await incrementBrokerageRecoveryTotal(
        pUserId,
        pStrategyCode,
        arrCloseCharges.reduce((pSum, vValue) => pSum + Number(vValue || 0), 0),
        0
    );
    await incrementRecoveredTotalPnl(
        pUserId,
        pStrategyCode,
        arrClosePnls.reduce((pSum, vValue) => pSum + Number(vValue || 0), 0),
        0
    );
    return {
        closedPositions: arrClosed,
        profileLabel: profile.referenceName || profile.apiKey || ""
    };
}

async function getProfileInternal(req: Request, res: Response, pStrategyCode: RollingFuturesLtStrategyCode): Promise<void> {
    const vUserId = getAccountId(req);
    const objProfile = await readLiveProfile(vUserId, pStrategyCode);
    res.json({
        status: "success",
        data: {
            ...objProfile,
            uiState: getMergedUiState(objProfile)
        }
    });
}

async function saveProfileInternal(req: Request, res: Response, pStrategyCode: RollingFuturesLtStrategyCode): Promise<void> {
    const vUserId = getAccountId(req);
    const objExisting = await readLiveProfile(vUserId, pStrategyCode);
    const objIncoming = normalizeProfileSaveInput(vUserId, pStrategyCode, {
        ...objExisting,
        selectedApiProfileId: String(req.body?.selectedApiProfileId || objExisting.selectedApiProfileId || "").trim(),
        uiState: req.body?.uiState && typeof req.body.uiState === "object" ? req.body.uiState as Record<string, unknown> : objExisting.uiState,
        connectionStatus: objExisting.connectionStatus
    });
    const objSaved = await saveRollingFuturesLtProfile(objIncoming);
    await ensureRuntimeProfileSelection(vUserId, pStrategyCode, objSaved.selectedApiProfileId);
    res.json({
        status: "success",
        message: `${gStrategyNames[pStrategyCode]} live profile saved.`,
        data: {
            ...objSaved,
            uiState: getMergedUiState(objSaved)
        }
    });
}

async function getConnectionStatusInternal(req: Request, res: Response, pStrategyCode: RollingFuturesLtStrategyCode): Promise<void> {
    const vUserId = getAccountId(req);
    const objProfile = await readLiveProfile(vUserId, pStrategyCode);
    res.json({
        status: "success",
        data: objProfile
    });
}

async function getRuntimeStatusInternal(req: Request, res: Response, pStrategyCode: RollingFuturesLtStrategyCode): Promise<void> {
    const vUserId = getAccountId(req);
    const objRuntime = await loadRollingFuturesLtRuntime(vUserId, pStrategyCode);
    const objProfile = await readLiveProfile(vUserId, pStrategyCode);
    res.json({
        status: "success",
        data: objRuntime || {
            ...getDefaultRollingFuturesLtRuntime(vUserId, pStrategyCode),
            selectedApiProfileId: String(objProfile.selectedApiProfileId || "").trim()
        }
    });
}

async function checkConnectionInternal(req: Request, res: Response, pStrategyCode: RollingFuturesLtStrategyCode): Promise<void> {
    const vUserId = getAccountId(req);
    const objResult = await performRollingFuturesLtConnectionCheck(vUserId, pStrategyCode, String(req.body?.profileId || "").trim());
    await ensureRuntimeProfileSelection(vUserId, pStrategyCode, objResult.profile.selectedApiProfileId);
    res.json({
        status: objResult.profile.connectionStatus.state === "connected" ? "success" : "warning",
        data: {
            ...objResult.profile,
            summary: objResult.summary
        }
    });
}

function getAutoTraderRuntimeKey(pUserId: string, pStrategyCode: RollingFuturesLtStrategyCode): string {
    return `${String(pUserId || "").trim()}::${pStrategyCode}`;
}

function stopAutoTraderCycle(pUserId: string, pStrategyCode: RollingFuturesLtStrategyCode): void {
    const vRuntimeKey = getAutoTraderRuntimeKey(pUserId, pStrategyCode);
    const objTimer = gAutoTraderIntervals.get(vRuntimeKey);
    if (objTimer) {
        clearInterval(objTimer);
        gAutoTraderIntervals.delete(vRuntimeKey);
    }
    gAutoTraderCycleLocks.delete(vRuntimeKey);
}

async function runAutoTraderCycle(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode
): Promise<void> {
    const vRuntimeKey = getAutoTraderRuntimeKey(pUserId, pStrategyCode);
    if (gAutoTraderCycleLocks.has(vRuntimeKey)) {
        return;
    }
    if (gExecStrategyLocks.has(vRuntimeKey)) {
        return;
    }

    gAutoTraderCycleLocks.add(vRuntimeKey);
    try {
        const objRuntime = await loadRollingFuturesLtRuntime(pUserId, pStrategyCode);
        if (!objRuntime?.autoTraderEnabled || String(objRuntime.status || "").trim().toLowerCase() !== "running") {
            stopAutoTraderCycle(pUserId, pStrategyCode);
            return;
        }

        const objProfile = await readLiveProfile(pUserId, pStrategyCode);
        const objUiState = getMergedUiState(objProfile);
        const vSelectedApiProfileId = String(objRuntime.selectedApiProfileId || objProfile.selectedApiProfileId || "").trim();
        const vSymbol = normalizeSymbolValue(objUiState.symbol);
        if (!vSelectedApiProfileId) {
            await saveRollingFuturesLtRuntime({
                ...objRuntime,
                userId: pUserId,
                strategyCode: pStrategyCode,
                status: "error",
                autoTraderEnabled: true,
                currentSymbol: vSymbol,
                lastError: "Select an API profile before enabling live auto trader."
            });
            return;
        }

        const arrLivePositions = await fetchLiveFuturePositions(pUserId, pStrategyCode, vSelectedApiProfileId, vSymbol);
        let arrSavedPositions = await replaceRollingFuturesLtImportedPositions(pUserId, pStrategyCode, arrLivePositions);
        const objScheduledReEntry = getScheduledReEntryState(objRuntime);
        const vRestartProtectionUntil = getRestartCloseProtectionUntil(objRuntime);
        const vNowMs = Date.now();
        const bRestartCloseProtectionActive = Boolean(arrSavedPositions.length)
            && !!vRestartProtectionUntil
            && Number.isFinite(new Date(vRestartProtectionUntil).getTime())
            && new Date(vRestartProtectionUntil).getTime() > vNowMs;
        if (!arrSavedPositions.length && vRestartProtectionUntil) {
            await saveRollingFuturesLtRuntime({
                ...objRuntime,
                userId: pUserId,
                strategyCode: pStrategyCode,
                state: buildRuntimeStateWithRestartCloseProtection(objRuntime, "")
            });
        }
        if (objScheduledReEntry.reason && objScheduledReEntry.runAt) {
            const vRunAtMs = new Date(objScheduledReEntry.runAt).getTime();
            if (!arrSavedPositions.length && Number.isFinite(vRunAtMs) && vRunAtMs <= vNowMs) {
                const objExecResult = await executeStrategyPlacement(
                    pUserId,
                    pStrategyCode,
                    vSelectedApiProfileId,
                    objProfile,
                    {
                        action: String(objUiState.action1 || "sell").trim().toLowerCase() === "buy" ? "buy" : "sell",
                        symbol: vSymbol,
                        legSide: String(objUiState.legs1 || "ce").trim().toLowerCase() === "pe"
                            ? "pe"
                            : (String(objUiState.legs1 || "ce").trim().toLowerCase() === "both" ? "both" : "ce"),
                        expiryMode: (["1", "2", "4", "5", "6", "7"].includes(String(objUiState.expiryMode1 || "5").trim())
                            ? String(objUiState.expiryMode1 || "5").trim()
                            : "5") as "1" | "2" | "4" | "5" | "6" | "7",
                        expiryDate: String(objUiState.expiryDate1 || "").trim(),
                        qty: Math.max(1, Math.floor(Number(objUiState.qty1 || 1))),
                        targetDelta: Math.max(0, Number(objUiState.newD1 || 0.53))
                    }
                );
                await logFuturesEvent(
                    pUserId,
                    pStrategyCode,
                    "option_opened",
                    "success",
                    objScheduledReEntry.reason === "brokerage"
                        ? "Brokerage Re-Entry Executed"
                        : "Blocked Margin Re-Entry Executed",
                    "Cooldown completed and the configured option legs were re-entered automatically.",
                    {
                        symbol: vSymbol,
                        reason: objScheduledReEntry.reason === "brokerage"
                            ? "brokerage_reentry"
                            : "blockmargin_reentry"
                    }
                );
                const objOpenPositions = await buildOpenPositionsPayload(
                    pUserId,
                    pStrategyCode,
                    objExecResult.trackedOpenPositions
                );
                const objLatestRuntimeAfterReEntry = await loadRollingFuturesLtRuntime(pUserId, pStrategyCode);
                if (objLatestRuntimeAfterReEntry?.autoTraderEnabled && String(objLatestRuntimeAfterReEntry.status || "").trim().toLowerCase() === "running") {
                    await saveRollingFuturesLtRuntime({
                        ...objLatestRuntimeAfterReEntry,
                        userId: pUserId,
                        strategyCode: pStrategyCode,
                        status: "running",
                        autoTraderEnabled: true,
                        selectedApiProfileId: vSelectedApiProfileId,
                        currentSymbol: vSymbol,
                        lastSignal: "REENTRY",
                        lastCycleAt: new Date().toISOString(),
                        lastError: "",
                        state: {
                            ...buildRuntimeStateWithPendingReEntry(objLatestRuntimeAfterReEntry, "", ""),
                            openPositions: objOpenPositions,
                            neutralCheck: objExecResult.neutralCheck
                        }
                    });
                }
                return;
            }
            if (arrSavedPositions.length > 0) {
                await saveRollingFuturesLtRuntime({
                    ...objRuntime,
                    userId: pUserId,
                    strategyCode: pStrategyCode,
                    state: buildRuntimeStateWithPendingReEntry(objRuntime, "", "")
                });
            }
        }

        const objTriggeredOption = bRestartCloseProtectionActive
            ? null
            : await findTriggeredTrackedOption(arrSavedPositions, objUiState);
        if (objTriggeredOption) {
            arrSavedPositions = await applyTriggeredOptionRule(
                pUserId,
                pStrategyCode,
                vSelectedApiProfileId,
                objProfile,
                objTriggeredOption.position,
                objTriggeredOption.currentDelta,
                objTriggeredOption.reason,
                arrSavedPositions
            );
        }

        const objOpenPositionsBeforeNeutrality = await buildOpenPositionsPayload(
            pUserId,
            pStrategyCode,
            arrSavedPositions
        );
        const objSummary = await fetchAccountSummarySnapshot(pUserId, vSelectedApiProfileId, vSymbol);
        const objProfitRule = getProfitCloseRule(objUiState, objOpenPositionsBeforeNeutrality, objSummary);
        if (!bRestartCloseProtectionActive && objProfitRule.triggered && arrSavedPositions.length) {
            const objClosed = await closeTrackedPositionsOnDelta(
                pUserId,
                pStrategyCode,
                vSelectedApiProfileId,
                arrSavedPositions
            );
            await resetRecoveryMetrics(pUserId, pStrategyCode);
            const vRunAt = objProfitRule.reEnterEnabled
                ? new Date(Date.now() + gProfitCloseReEntryCooldownMs).toISOString()
                : "";
            await logFuturesEvent(
                pUserId,
                pStrategyCode,
                "future_closed",
                "success",
                objProfitRule.reason === "brokerage"
                    ? "Brokerage Profit Target Closed All Positions"
                    : "Blocked Margin Profit Target Closed All Positions",
                objProfitRule.reEnterEnabled
                    ? `${objProfitRule.message} Re-entry scheduled after 5 minutes.`
                    : objProfitRule.message,
                {
                    qty: objClosed.closedPositions.length,
                    thresholdValue: objProfitRule.thresholdValue,
                    reason: objProfitRule.reason === "brokerage"
                        ? "brokerage_profit_close_all"
                        : "blockmargin_profit_close_all"
                }
            );
            const objLatestRuntimeAfterClose = await loadRollingFuturesLtRuntime(pUserId, pStrategyCode);
            if (objLatestRuntimeAfterClose?.autoTraderEnabled && String(objLatestRuntimeAfterClose.status || "").trim().toLowerCase() === "running") {
                await saveRollingFuturesLtRuntime({
                    ...objLatestRuntimeAfterClose,
                    userId: pUserId,
                    strategyCode: pStrategyCode,
                    status: "running",
                    autoTraderEnabled: true,
                    selectedApiProfileId: vSelectedApiProfileId,
                    currentSymbol: vSymbol,
                    lastSignal: "PROFIT_EXIT",
                    lastCycleAt: new Date().toISOString(),
                    lastError: "",
                    state: buildRuntimeStateWithPendingReEntry(
                        objLatestRuntimeAfterClose,
                        objProfitRule.reEnterEnabled ? objProfitRule.reason : "",
                        vRunAt
                    )
                });
            }
            return;
        }

        const objNeutralCheck = await applyServerSideNeutralityCheck(
            pUserId,
            pStrategyCode,
            vSelectedApiProfileId,
            objUiState,
            vSymbol,
            arrSavedPositions,
            objRuntime
        );
        const objOpenPositions = await buildOpenPositionsPayload(
            pUserId,
            pStrategyCode,
            objNeutralCheck.trackedOpenPositions
        );
        const objLatestRuntime = await loadRollingFuturesLtRuntime(pUserId, pStrategyCode);
        if (!objLatestRuntime?.autoTraderEnabled || String(objLatestRuntime.status || "").trim().toLowerCase() !== "running") {
            return;
        }
        const objLatestRuntimeStateBase = await loadRollingFuturesLtRuntime(pUserId, pStrategyCode);
        const objStateWithPendingReEntry = buildRuntimeStateWithPendingReEntry(
            objLatestRuntimeStateBase,
            objScheduledReEntry.reason,
            objScheduledReEntry.runAt
        );
        const objStateForSave = buildRuntimeStateWithRestartCloseProtection(
            {
                ...(objLatestRuntimeStateBase || getDefaultRollingFuturesLtRuntime(pUserId, pStrategyCode)),
                state: objStateWithPendingReEntry
            },
            arrSavedPositions.length && bRestartCloseProtectionActive ? vRestartProtectionUntil : ""
        );
        await saveRollingFuturesLtRuntime({
            ...(objLatestRuntimeStateBase || getDefaultRollingFuturesLtRuntime(pUserId, pStrategyCode)),
            userId: pUserId,
            strategyCode: pStrategyCode,
            status: "running",
            autoTraderEnabled: true,
            selectedApiProfileId: vSelectedApiProfileId,
            currentSymbol: vSymbol,
            lastSignal: objNeutralCheck.hedgePlaced ? "HEDGE" : "BALANCED",
            lastCycleAt: new Date().toISOString(),
            lastError: "",
            state: {
                ...objStateForSave,
                ...(objNeutralCheck.nextRuntimeState || {}),
                openPositions: objOpenPositions,
                neutralCheck: {
                    mode: objNeutralCheck.mode,
                    hedgePlaced: objNeutralCheck.hedgePlaced,
                    totalDelta: objNeutralCheck.totalDelta,
                    totalTheta: objNeutralCheck.totalTheta,
                    threshold: objNeutralCheck.threshold
                }
            }
        });
    }
    catch (objError) {
        const objRuntime = await loadRollingFuturesLtRuntime(pUserId, pStrategyCode)
            || getDefaultRollingFuturesLtRuntime(pUserId, pStrategyCode);
        const objProfile = await readLiveProfile(pUserId, pStrategyCode);
        const objFriendly = await getFriendlyDeltaConnectionError(objError);
        const vErrorMessage = objFriendly.state === "warning"
            ? getErrorMessage(objError, "Live auto trader cycle failed.")
            : objFriendly.message;
        if (objFriendly.state !== "warning") {
            await saveRollingFuturesLtProfile({
                ...objProfile,
                connectionStatus: {
                    ...objProfile.connectionStatus,
                    state: objFriendly.state,
                    message: objFriendly.message,
                    outboundIp: objFriendly.outboundIp,
                    lastCheckedAt: new Date().toISOString(),
                    consecutiveFailures: Number(objProfile.connectionStatus?.consecutiveFailures || 0) + 1
                }
            });
        }
        await saveRollingFuturesLtRuntime({
            ...objRuntime,
            userId: pUserId,
            strategyCode: pStrategyCode,
            status: "running",
            autoTraderEnabled: true,
            lastCycleAt: new Date().toISOString(),
            lastError: vErrorMessage
        });
        if (String(objRuntime.lastError || "").trim() !== vErrorMessage) {
            await logFuturesEvent(
                pUserId,
                pStrategyCode,
                "engine_error",
                "error",
                "Live Auto Trader Cycle Failed",
                vErrorMessage,
                { reason: "auto_trader_cycle_error" }
            );
        }
    }
    finally {
        gAutoTraderCycleLocks.delete(vRuntimeKey);
    }
}

function startAutoTraderCycle(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode
): void {
    const vRuntimeKey = getAutoTraderRuntimeKey(pUserId, pStrategyCode);
    stopAutoTraderCycle(pUserId, pStrategyCode);
    void runAutoTraderCycle(pUserId, pStrategyCode);
    gAutoTraderIntervals.set(vRuntimeKey, setInterval(() => {
        void runAutoTraderCycle(pUserId, pStrategyCode);
    }, 8000));
}

export async function recoverRollingFuturesLtAutoTraderCycles(): Promise<void> {
    const arrRuntimeRows = await listRollingFuturesLtRuntime();
    for (const objRuntime of arrRuntimeRows) {
        const vUserId = String(objRuntime.userId || "").trim();
        const vStrategyCode = objRuntime.strategyCode;
        const vStatus = String(objRuntime.status || "").trim().toLowerCase();
        const vSelectedApiProfileId = String(objRuntime.selectedApiProfileId || "").trim();
        const bShouldResume = Boolean(objRuntime.autoTraderEnabled)
            && vStatus === "running"
            && !!vUserId
            && !!vSelectedApiProfileId
            && (vStrategyCode === "rolling-futures-lt-long" || vStrategyCode === "rolling-futures-lt-short" || vStrategyCode === "rolling-futures-lt-dual");

        if (!bShouldResume) {
            continue;
        }

        const vProtectionUntil = new Date(Date.now() + gRestartCloseProtectionMs).toISOString();
        await saveRollingFuturesLtRuntime({
            ...objRuntime,
            userId: vUserId,
            strategyCode: vStrategyCode,
            state: buildRuntimeStateWithRestartCloseProtection(objRuntime, vProtectionUntil)
        });
        startAutoTraderCycle(vUserId, vStrategyCode);
    }
}

async function enableAutoTraderInternal(req: Request, res: Response, pStrategyCode: RollingFuturesLtStrategyCode): Promise<void> {
    const vUserId = getAccountId(req);
    const objProfile = await readLiveProfile(vUserId, pStrategyCode);
    const vSelectedApiProfileId = String(objProfile.selectedApiProfileId || "").trim();
    if (!vSelectedApiProfileId) {
        res.status(400).json({ status: "warning", message: "Select an API profile before enabling live auto trader." });
        return;
    }

    const objCheck = await performRollingFuturesLtConnectionCheck(vUserId, pStrategyCode, vSelectedApiProfileId);
    if (objCheck.profile.connectionStatus.state !== "connected") {
        res.status(400).json({
            status: "warning",
            message: objCheck.profile.connectionStatus.message || "Delta connection is not healthy.",
            data: objCheck.profile
        });
        return;
    }

    const objExistingRuntime = await loadRollingFuturesLtRuntime(vUserId, pStrategyCode);
    const objSavedRuntime = await saveRollingFuturesLtRuntime({
        ...(objExistingRuntime || getDefaultRollingFuturesLtRuntime(vUserId, pStrategyCode)),
        userId: vUserId,
        strategyCode: pStrategyCode,
        status: "running",
        autoTraderEnabled: true,
        selectedApiProfileId: vSelectedApiProfileId,
        currentSymbol: String(getMergedUiState(objProfile).symbol || ""),
        lastError: "",
        state: buildRuntimeStateWithRestartCloseProtection(objExistingRuntime || null, "")
    });

    await logFuturesEvent(
        vUserId,
        pStrategyCode,
        "engine_started",
        "success",
        "Live Auto Trader Started",
        "Server-side live auto trader marked as running.",
        {
            symbol: objSavedRuntime.currentSymbol || "",
            reason: "engine_started"
        }
    );
    startAutoTraderCycle(vUserId, pStrategyCode);

    res.json({
        status: "success",
        message: "Live auto trader enabled.",
        data: objSavedRuntime
    });
}

async function disableAutoTraderInternal(req: Request, res: Response, pStrategyCode: RollingFuturesLtStrategyCode): Promise<void> {
    const vUserId = getAccountId(req);
    const objProfile = await readLiveProfile(vUserId, pStrategyCode);
    const objExistingRuntime = await loadRollingFuturesLtRuntime(vUserId, pStrategyCode);
    const objSavedRuntime = await saveRollingFuturesLtRuntime({
        ...(objExistingRuntime || getDefaultRollingFuturesLtRuntime(vUserId, pStrategyCode)),
        userId: vUserId,
        strategyCode: pStrategyCode,
        status: "stopped",
        autoTraderEnabled: false,
        selectedApiProfileId: String(objProfile.selectedApiProfileId || "").trim(),
        currentSymbol: String(getMergedUiState(objProfile).symbol || ""),
        state: buildRuntimeStateWithRestartCloseProtection(objExistingRuntime || null, "")
    });

    await logFuturesEvent(
        vUserId,
        pStrategyCode,
        "engine_stopped",
        "info",
        "Live Auto Trader Stopped",
        "Server-side live auto trader stopped.",
        {
            symbol: objSavedRuntime.currentSymbol || "",
            reason: "engine_stopped"
        }
    );
    stopAutoTraderCycle(vUserId, pStrategyCode);

    res.json({
        status: "success",
        message: "Live auto trader disabled.",
        data: objSavedRuntime
    });
}

async function getAccountSummaryInternal(req: Request, res: Response, pStrategyCode: RollingFuturesLtStrategyCode): Promise<void> {
    const vProfileId = await resolveProfileId(req, pStrategyCode);
    if (!vProfileId) {
        res.status(400).json({ status: "warning", message: "API profile is required." });
        return;
    }
    try {
        const vUserId = getAccountId(req);
        const objProfile = await readLiveProfile(vUserId, pStrategyCode);
        const objUiState = getMergedUiState(objProfile);
        const vSelectedSymbol = normalizeSymbolValue(req.query?.symbol || req.body?.symbol || objUiState.symbol);
        const vLotSize = getLotSizeForSymbol(vSelectedSymbol);
        const { client, profile } = await getDeltaClientForAccountId(vUserId, vProfileId);
        const objPositionsApi = client.apis?.Positions as {
            getMarginedPositions?: (pParams: Record<string, unknown>) => Promise<unknown>;
            getPositions?: (pParams: Record<string, unknown>) => Promise<unknown>;
        } | undefined;
        const [objWalletResult, objMarketResult, objPositionsResult] = await Promise.allSettled([
            client.apis.Wallet.getBalances(),
            getLiveMarketSnapshot({
                symbol: vSelectedSymbol,
                contractName: getContractNameForSymbol(vSelectedSymbol),
                lotSize: vLotSize,
                futureQty: 1,
                futureOrderType: "market_order",
                action: "buy",
                legSide: "ce",
                expiryMode: "1",
                expiryDate: "",
                optionQty: 1,
                redOptionQtyPct: 100,
                greenOptionQtyPct: 100,
                newDelta: 0.53,
                reDelta: 0.53,
                deltaTakeProfit: 0.15,
                deltaStopLoss: 0.85,
                reEnter: false,
                addOneLotFuture: false,
                renkoEnabled: false,
                renkoStepPoints: 10,
                renkoPriceSource: "spot_price",
                loopSeconds: 8
            }),
            typeof objPositionsApi?.getMarginedPositions === "function"
                ? objPositionsApi.getMarginedPositions({})
                : (typeof objPositionsApi?.getPositions === "function"
                    ? objPositionsApi.getPositions({ underlying_asset_symbol: vSelectedSymbol })
                    : Promise.resolve(null))
        ]);
        if (objWalletResult.status !== "fulfilled") {
            throw objWalletResult.reason;
        }
        const objWalletPayload = readResponsePayload(objWalletResult.value);
        const arrRows = Array.isArray(objWalletPayload.result) ? objWalletPayload.result as DeltaWalletBalanceRow[] : [];
        const objUsdRow = pickUsdBalanceRow(arrRows);
        const objMarketSnapshot = objMarketResult.status === "fulfilled" ? objMarketResult.value : null;
        const objPositionsPayload = objPositionsResult.status === "fulfilled" ? readResponsePayload(objPositionsResult.value || {}) : {};
        const arrPositions = Array.isArray(objPositionsPayload.result)
            ? objPositionsPayload.result as DeltaPositionRow[]
            : (objPositionsPayload.result ? [objPositionsPayload.result as DeltaPositionRow] : []);
        const vAvailableBalance = getAvailableBalanceUsd(objUsdRow);
        const vBlockedMargin = getBlockedMarginUsd(objUsdRow);
        const vTotalBalance = getTotalBalanceUsd(objUsdRow);
        const vLivePrice = Number(objMarketSnapshot?.futuresPrice || 0);
        const vOneLotValue = Number.isFinite(vLivePrice) && vLivePrice > 0 ? vLivePrice * vLotSize : Number.NaN;
        const vSelectedFuturePositionValue = getSelectedFuturePositionValue(arrPositions, vSelectedSymbol, vLivePrice);
        const vHealthPct = vAvailableBalance > 0 && vSelectedFuturePositionValue > 0
            ? Number(((vSelectedFuturePositionValue / vAvailableBalance) * 100).toFixed(2))
            : Number.NaN;

        res.json({
            status: "success",
            data: {
                symbol: vSelectedSymbol,
                oneLotValue: Number.isFinite(vOneLotValue) ? Number(vOneLotValue.toFixed(2)) : null,
                totalBalance: Number.isFinite(vTotalBalance) ? Number(vTotalBalance.toFixed(2)) : null,
                blockedMargin: Number.isFinite(vBlockedMargin) ? Number(vBlockedMargin.toFixed(2)) : null,
                availableBalance: Number.isFinite(vAvailableBalance) ? Number(vAvailableBalance.toFixed(2)) : null,
                healthPct: Number.isFinite(vHealthPct) ? vHealthPct : null,
                profileLabel: profile.referenceName || profile.apiKey || "",
                openCount: arrPositions.filter((objRow) => {
                    const vContract = String(objRow.product_symbol || objRow.symbol || "").trim().toUpperCase();
                    const vQty = Math.abs(toFiniteNumber(objRow.net_size ?? objRow.size, 0));
                    return isFutureContractSymbol(vContract) && vContract.startsWith(vSelectedSymbol) && vQty > 0;
                }).length
            }
        });
    }
    catch (objError) {
        res.status(500).json({
            status: "danger",
            message: getErrorMessage(objError, "Unable to fetch live futures account summary.")
        });
    }
}

async function getImportableOpenPositionsInternal(req: Request, res: Response, pStrategyCode: RollingFuturesLtStrategyCode): Promise<void> {
    const vProfileId = await resolveProfileId(req, pStrategyCode);
    if (!vProfileId) {
        res.status(400).json({ status: "warning", message: "API profile is required." });
        return;
    }
    try {
        const vUserId = getAccountId(req);
        const arrPositions = await fetchLiveFuturePositions(vUserId, pStrategyCode, vProfileId);
        res.json({
            status: "success",
            data: {
                positions: arrPositions
            }
        });
    }
    catch (objError) {
        res.status(500).json({
            status: "danger",
            message: getErrorMessage(objError, "Unable to fetch Delta open futures positions.")
        });
    }
}

async function getOpenPositionsInternal(req: Request, res: Response, pStrategyCode: RollingFuturesLtStrategyCode): Promise<void> {
    const vUserId = getAccountId(req);
    const objOpenPositions = await buildOpenPositionsPayload(vUserId, pStrategyCode);
    res.json({
        status: "success",
        data: objOpenPositions
    });
}

async function saveOpenPositionsInternal(req: Request, res: Response, pStrategyCode: RollingFuturesLtStrategyCode): Promise<void> {
    const vUserId = getAccountId(req);
    const arrIncoming = Array.isArray(req.body?.positions) ? req.body.positions as Array<Record<string, unknown>> : [];
    const objProfile = await readLiveProfile(vUserId, pStrategyCode);
    const objUiState = getMergedUiState(objProfile);
    const vBaseDelta = Math.max(0, Number(objUiState.newD1 || 0.53));
    const arrPrepared = await applyImportedOptionBaseGreeks(applyImportedBaseDelta(arrIncoming.map((objRow) => ({
        userId: vUserId,
        strategyCode: pStrategyCode,
        importId: String(objRow.importId || "").trim(),
        contractName: String(objRow.contractName || "").trim(),
        side: String(objRow.side || "").trim().toUpperCase(),
        qty: Number(objRow.qty || 0),
        entryPrice: Number(objRow.entryPrice || 0),
        markPrice: Number(objRow.markPrice || 0),
        charges: Number(objRow.charges || 0),
        pnl: Number(objRow.pnl || 0),
        margin: Number(objRow.margin || 0),
        liquidationPrice: Number(objRow.liquidationPrice || 0),
        metadata: objRow.metadata && typeof objRow.metadata === "object" ? objRow.metadata as Record<string, unknown> : undefined,
        openedAt: String(objRow.openedAt || "").trim(),
        updatedAt: ""
    })), vBaseDelta), vBaseDelta);
    const arrSaved = await replaceRollingFuturesLtImportedPositions(vUserId, pStrategyCode, arrPrepared);
    const objOpenPositions = await buildOpenPositionsPayload(vUserId, pStrategyCode, arrSaved);
    const objRuntime = await loadRollingFuturesLtRuntime(vUserId, pStrategyCode);
    if (arrSaved.length > 0 && !(getBrokerageRecoveryTotal(objRuntime) > 0)) {
        await saveBrokerageRecoveryTotal(vUserId, pStrategyCode, Number(objOpenPositions.totals?.totalCharges || 0));
    }
    await logFuturesEvent(
        vUserId,
        pStrategyCode,
        "manual_action",
        "info",
        "Imported Live Futures Updated",
        arrSaved.length
            ? `Saved ${arrSaved.length} imported live futures position${arrSaved.length === 1 ? "" : "s"} in the open grid.`
            : "Cleared imported live futures positions from the open grid.",
        { qty: arrSaved.length, reason: "imported_positions_saved" }
    );
    res.json({
        status: "success",
        message: "Imported open futures positions saved.",
        data: objOpenPositions
    });
}

async function deleteOpenPositionInternal(req: Request, res: Response, pStrategyCode: RollingFuturesLtStrategyCode): Promise<void> {
    const vUserId = getAccountId(req);
    const vImportId = String(req.body?.importId || "").trim();
    if (!vImportId) {
        res.status(400).json({ status: "warning", message: "Import position id is required." });
        return;
    }
    await deleteRollingFuturesLtImportedPosition(vUserId, pStrategyCode, vImportId);
    await logFuturesEvent(
        vUserId,
        pStrategyCode,
        "manual_action",
        "info",
        "Imported Position Removed",
        "Imported open position removed from the live page only. No Delta Exchange order was placed.",
        { qty: 1, reason: "imported_position_removed" }
    );
    res.json({
        status: "success",
        message: "Imported open position removed from the live page.",
        data: { importId: vImportId }
    });
}

async function reconcileOpenPositionsInternal(req: Request, res: Response, pStrategyCode: RollingFuturesLtStrategyCode): Promise<void> {
    const vUserId = getAccountId(req);
    const vProfileId = await resolveProfileId(req, pStrategyCode);
    if (!vProfileId) {
        res.status(400).json({ status: "warning", message: "API profile is required." });
        return;
    }
    try {
        const arrPositions = await fetchLiveFuturePositions(vUserId, pStrategyCode, vProfileId);
        const objProfile = await readLiveProfile(vUserId, pStrategyCode);
        const objUiState = getMergedUiState(objProfile);
        const vBaseDelta = Math.max(0, Number(objUiState.newD1 || 0.53));
        const arrSaved = await replaceRollingFuturesLtImportedPositions(
            vUserId,
            pStrategyCode,
            await applyImportedOptionBaseGreeks(applyImportedBaseDelta(arrPositions, vBaseDelta), vBaseDelta)
        );
        const objOpenPositions = await buildOpenPositionsPayload(vUserId, pStrategyCode, arrSaved);
        const objRuntime = await loadRollingFuturesLtRuntime(vUserId, pStrategyCode);
        if (arrSaved.length > 0 && !(getBrokerageRecoveryTotal(objRuntime) > 0)) {
            await saveBrokerageRecoveryTotal(vUserId, pStrategyCode, Number(objOpenPositions.totals?.totalCharges || 0));
        }
        await logFuturesEvent(
            vUserId,
            pStrategyCode,
            "manual_action",
            "success",
            "Open Futures Reconciled",
            `Refreshed ${arrSaved.length} live futures position${arrSaved.length === 1 ? "" : "s"} from Delta Exchange.`,
            { qty: arrSaved.length, reason: "open_positions_reconciled" }
        );
        res.json({
            status: "success",
            message: `Reconciled ${arrSaved.length} live futures position${arrSaved.length === 1 ? "" : "s"} with Delta Exchange.`,
            data: objOpenPositions
        });
    }
    catch (objError) {
        res.status(500).json({
            status: "danger",
            message: getErrorMessage(objError, "Unable to refresh live futures positions.")
        });
    }
}

async function closeImportedOpenPositionInternal(req: Request, res: Response, pStrategyCode: RollingFuturesLtStrategyCode): Promise<void> {
    const vUserId = getAccountId(req);
    const objProfile = await readLiveProfile(vUserId, pStrategyCode);
    const vSelectedApiProfileId = String(objProfile.selectedApiProfileId || "").trim();
    if (!vSelectedApiProfileId) {
        res.status(400).json({ status: "warning", message: "Select an API profile before closing live positions." });
        return;
    }
    const objCheck = await performRollingFuturesLtConnectionCheck(vUserId, pStrategyCode, vSelectedApiProfileId);
    if (objCheck.profile.connectionStatus.state !== "connected") {
        res.status(400).json({
            status: "warning",
            message: objCheck.profile.connectionStatus.message || "Delta connection is not healthy.",
            data: objCheck.profile
        });
        return;
    }
    const vContractName = String(req.body?.contractName || "").trim();
    const vSide = String(req.body?.side || "").trim().toUpperCase();
    const vQty = Math.max(1, Math.floor(Number(req.body?.qty || 0)));
    const vImportId = String(req.body?.importId || "").trim();
    if (!vContractName || (vSide !== "BUY" && vSide !== "SELL") || !(vQty > 0)) {
        res.status(400).json({ status: "warning", message: "Imported live position details are incomplete." });
        return;
    }
    try {
        const arrLivePositions = await fetchLiveFuturePositions(vUserId, pStrategyCode, vSelectedApiProfileId);
        const objLivePosition = arrLivePositions.find((objRow) => String(objRow.importId || "").trim() === vImportId)
            || arrLivePositions.find((objRow) => String(objRow.contractName || "").trim() === vContractName);

        if (!objLivePosition) {
            if (vImportId) {
                await deleteRollingFuturesLtImportedPosition(vUserId, pStrategyCode, vImportId);
            }
            await logFuturesEvent(
                vUserId,
                pStrategyCode,
                "manual_action",
                "warning",
                "Imported Future Position Already Closed",
                `${vContractName} was not found in live Delta futures positions. The stale saved row was removed.`,
                { contractName: vContractName, qty: vQty, reason: "manual_imported_position_already_closed" }
            );
            res.json({
                status: "warning",
                message: `${vContractName} is no longer open on Delta Exchange. The stale saved row was removed.`,
                data: {
                    importId: vImportId,
                    trackedOpenPositions: await buildOpenPositionsPayload(vUserId, pStrategyCode, arrLivePositions)
                }
            });
            return;
        }

        const vLiveSide = String(objLivePosition.side || "").trim().toUpperCase();
        const vLiveQty = Math.max(1, Math.floor(Number(objLivePosition.qty || 0)));
        if ((vLiveSide !== "BUY" && vLiveSide !== "SELL") || !(vLiveQty > 0)) {
            throw new Error("Live Delta futures position could not be validated before close.");
        }

        const { client, profile } = await getDeltaClientForAccountId(vUserId, vSelectedApiProfileId);
        const vCloseSide = vLiveSide === "BUY" ? "sell" : "buy";
        const objOrderPayload: Record<string, unknown> = {
            product_symbol: String(objLivePosition.contractName || vContractName).trim(),
            size: vLiveQty,
            side: vCloseSide,
            order_type: "market_order",
            time_in_force: "gtc",
            post_only: false,
            reduce_only: true
        };
        const objResponse = await client.apis.Orders.placeOrder({ order: objOrderPayload });
        const objPayload = readResponsePayload(objResponse);
        if (vImportId) {
            await deleteRollingFuturesLtImportedPosition(vUserId, pStrategyCode, vImportId);
        }
        const arrLatestLivePositions = await fetchLiveFuturePositions(vUserId, pStrategyCode, vSelectedApiProfileId);
        const arrRemainingSaved = await replaceRollingFuturesLtImportedPositions(vUserId, pStrategyCode, arrLatestLivePositions);
        const vCloseCharge = await estimateTrackedPositionCharge(
            objLivePosition,
            Number(objLivePosition.markPrice || objLivePosition.entryPrice || 0)
        );
        const vClosePnl = estimateTrackedPositionPnl(
            objLivePosition,
            Number(objLivePosition.markPrice || objLivePosition.entryPrice || 0)
        );
        await incrementBrokerageRecoveryTotal(vUserId, pStrategyCode, vCloseCharge, arrRemainingSaved.length);
        await incrementRecoveredTotalPnl(vUserId, pStrategyCode, vClosePnl, arrRemainingSaved.length);
        await logFuturesEvent(
            vUserId,
            pStrategyCode,
            "future_closed",
            "warning",
            "Imported Position Closed",
            `Close order placed on Delta Exchange for ${String(objLivePosition.contractName || vContractName).trim()} using ${profile.referenceName}.`,
            { contractName: String(objLivePosition.contractName || vContractName).trim(), qty: vLiveQty, reason: "manual_imported_position_close" }
        );
        res.json({
            status: "success",
            message: `Close order placed on Delta Exchange for ${String(objLivePosition.contractName || vContractName).trim()} using ${profile.referenceName}.`,
            data: {
                order: objPayload.result || objPayload,
                request: objOrderPayload,
                trackedOpenPositions: await buildOpenPositionsPayload(vUserId, pStrategyCode, arrRemainingSaved)
            }
        });
    }
    catch (objError) {
        try {
            const arrLatestLivePositions = await fetchLiveFuturePositions(vUserId, pStrategyCode, vSelectedApiProfileId);
            const objStillLive = arrLatestLivePositions.find((objRow) => String(objRow.importId || "").trim() === vImportId)
                || arrLatestLivePositions.find((objRow) => String(objRow.contractName || "").trim() === vContractName);
            if (!objStillLive) {
                if (vImportId) {
                    await deleteRollingFuturesLtImportedPosition(vUserId, pStrategyCode, vImportId);
                }
                const arrRemainingSaved = await replaceRollingFuturesLtImportedPositions(vUserId, pStrategyCode, arrLatestLivePositions);
                await logFuturesEvent(
                    vUserId,
                    pStrategyCode,
                    "manual_action",
                    "warning",
                    "Imported Position Already Closed",
                    `${vContractName} is no longer open on Delta Exchange. The stale saved row was removed after close verification.`,
                    { contractName: vContractName, qty: vQty, reason: "manual_imported_position_close_verified_closed" }
                );
                res.json({
                    status: "warning",
                    message: `${vContractName} is no longer open on Delta Exchange. The stale saved row was removed.`,
                    data: {
                        importId: vImportId,
                        trackedOpenPositions: await buildOpenPositionsPayload(vUserId, pStrategyCode, arrRemainingSaved)
                    }
                });
                return;
            }
        }
        catch (_reconcileError) {
        }

        await logFuturesEvent(
            vUserId,
            pStrategyCode,
            "engine_error",
            "error",
            "Imported Position Close Failed",
            getErrorMessage(objError, "Unable to close imported live position on Delta Exchange."),
            { contractName: vContractName, qty: vQty, reason: "manual_imported_position_close_error" }
        );
        res.status(500).json({
            status: "danger",
            message: getErrorMessage(objError, "Unable to close imported live position on Delta Exchange.")
        });
    }
}

async function executeManualFutureInternal(req: Request, res: Response, pStrategyCode: RollingFuturesLtStrategyCode): Promise<void> {
    const vUserId = getAccountId(req);
    const objProfile = await readLiveProfile(vUserId, pStrategyCode);
    const vSelectedApiProfileId = String(objProfile.selectedApiProfileId || "").trim();
    if (!vSelectedApiProfileId) {
        res.status(400).json({ status: "warning", message: "Select an API profile before placing live future orders." });
        return;
    }

    const objCheck = await performRollingFuturesLtConnectionCheck(vUserId, pStrategyCode, vSelectedApiProfileId);
    if (objCheck.profile.connectionStatus.state !== "connected") {
        res.status(400).json({
            status: "warning",
            message: objCheck.profile.connectionStatus.message || "Delta connection is not healthy.",
            data: objCheck.profile
        });
        return;
    }

    const vAction = String(req.body?.action || "").trim().toUpperCase() === "BUY" ? "BUY" : (
        String(req.body?.action || "").trim().toUpperCase() === "SELL" ? "SELL" : ""
    );
    const vSymbol = normalizeSymbolValue(req.body?.symbol || getMergedUiState(objProfile).symbol);
    const vQty = Math.max(1, Math.floor(Number(req.body?.qty || 0)));
    const vOrderType = String(req.body?.orderType || "market_order").trim() === "limit_order"
        ? "limit_order"
        : "market_order";

    if (vAction !== "BUY" && vAction !== "SELL") {
        res.status(400).json({ status: "warning", message: "Select a valid future action before placing a live futures order." });
        return;
    }
    if (!(vQty > 0)) {
        res.status(400).json({ status: "warning", message: "Enter a valid future quantity before placing a live futures order." });
        return;
    }

    const vLockKey = getManualFutureOrderLockKey(vUserId, pStrategyCode);
    if (gManualFutureOrderLocks.has(vLockKey)) {
        res.status(409).json({
            status: "warning",
            message: "A live futures order is already being processed. Please wait for it to finish before placing another one."
        });
        return;
    }

    gManualFutureOrderLocks.add(vLockKey);
    try {
        const { profile } = await getDeltaClientForAccountId(vUserId, vSelectedApiProfileId);
        const objPlacedOrder = await placeManagedManualFutureOrder(
            vUserId,
            vSelectedApiProfileId,
            vSymbol,
            vAction,
            vQty,
            vOrderType
        );
        const arrTrackedPositions = await fetchLiveFuturePositions(vUserId, pStrategyCode, vSelectedApiProfileId, vSymbol);
        const arrExisting = await listRollingFuturesLtImportedPositions(vUserId, pStrategyCode);
        const arrPreserved = arrExisting.filter((objRow) => {
            const vContract = String(objRow.contractName || "").trim().toUpperCase();
            return !(isFutureContractSymbol(vContract) && vContract.startsWith(vSymbol));
        });
        const arrSaved = await replaceRollingFuturesLtImportedPositions(vUserId, pStrategyCode, [
            ...arrPreserved,
            ...arrTrackedPositions
        ]);
        const vEntryCharge = await estimateTrackedPositionCharge({
            contractName: objPlacedOrder.contractName,
            qty: vQty,
            entryPrice: Number(objPlacedOrder.entryPrice || 0),
            markPrice: Number(objPlacedOrder.entryPrice || 0)
        });
        const bFilled = objPlacedOrder.filled;
        if (bFilled) {
            await incrementBrokerageRecoveryTotal(vUserId, pStrategyCode, vEntryCharge, arrSaved.length);
        }
        const vOrderId = String(objPlacedOrder.order.id || objPlacedOrder.order.order_id || "").trim();
        const vResponseStatus = bFilled ? "success" : "warning";
        const vResponseMessage = bFilled
            ? `${vAction} future live order placed using ${profile.referenceName}.`
            : (objPlacedOrder.outcome === "rejected_unfilled"
                ? `${vAction} maker-only future limit order was not accepted after ${gFutureLimitRetryCount} attempts. No extra order was placed and no market fallback was used.`
                : `${vAction} maker-only future limit order was not filled after ${gFutureLimitRetryCount} attempts and was cancelled. No market fallback was used.`);
        await logFuturesEvent(
            vUserId,
            pStrategyCode,
            bFilled ? "future_opened" : "manual_action",
            bFilled ? "success" : "warning",
            bFilled ? `${vAction} Future Order Placed` : `${vAction} Future Limit Order Not Filled`,
            vResponseMessage,
            {
                symbol: vSymbol,
                contractName: objPlacedOrder.contractName,
                qty: vQty,
                requestedOrderType: vOrderType,
                finalOrderType: objPlacedOrder.orderTypeUsed,
                orderId: vOrderId,
                outcome: objPlacedOrder.outcome,
                reason: "manual_future"
            }
        );
        res.json({
            status: vResponseStatus,
            message: vResponseMessage,
            data: {
                order: objPlacedOrder.order,
                request: objPlacedOrder.request,
                trackedOpenPositions: await buildOpenPositionsPayload(vUserId, pStrategyCode, arrSaved),
                snapshot: {
                    productSymbol: objPlacedOrder.contractName,
                    futuresPrice: objPlacedOrder.entryPrice
                },
                filled: bFilled,
                outcome: objPlacedOrder.outcome
            }
        });
    }
    catch (objError) {
        await logFuturesEvent(
            vUserId,
            pStrategyCode,
            "engine_error",
            "error",
            "Future Order Failed",
            getErrorMessage(objError, "Unable to place live future order."),
            {
                symbol: vSymbol,
                qty: vQty,
                requestedOrderType: vOrderType,
                reason: "manual_future_error"
            }
        );
        res.status(500).json({
            status: "danger",
            message: getErrorMessage(objError, "Unable to place live future order.")
        });
    }
    finally {
        gManualFutureOrderLocks.delete(vLockKey);
    }
}

async function executeManualOptionInternal(req: Request, res: Response, pStrategyCode: RollingFuturesLtStrategyCode): Promise<void> {
    const vUserId = getAccountId(req);
    const objProfile = await readLiveProfile(vUserId, pStrategyCode);
    const vSelectedApiProfileId = String(objProfile.selectedApiProfileId || "").trim();
    if (!vSelectedApiProfileId) {
        res.status(400).json({ status: "warning", message: "Select an API profile before placing live option orders." });
        return;
    }

    const objCheck = await performRollingFuturesLtConnectionCheck(vUserId, pStrategyCode, vSelectedApiProfileId);
    if (objCheck.profile.connectionStatus.state !== "connected") {
        res.status(400).json({
            status: "warning",
            message: objCheck.profile.connectionStatus.message || "Delta connection is not healthy.",
            data: objCheck.profile
        });
        return;
    }

    const vAction = String(req.body?.action || "").trim().toLowerCase();
    const vSymbol = normalizeSymbolValue(req.body?.symbol || getMergedUiState(objProfile).symbol);
    const vLegSide = String(req.body?.legSide || "").trim().toLowerCase();
    const vExpiryMode = String(req.body?.expiryMode || "5").trim() as "1" | "2" | "4" | "5" | "6" | "7";
    const vExpiryDate = normalizeRollingFuturesExpiryDate(vExpiryMode, req.body?.expiryDate);
    const vQty = Math.max(1, Math.floor(Number(req.body?.qty || 1)));
    const vTargetDelta = Math.max(0, Number(req.body?.targetDelta || 0.53));

    if (vAction !== "buy" && vAction !== "sell") {
        res.status(400).json({ status: "warning", message: "Select a valid option action before placing a live option order." });
        return;
    }
    if (!["ce", "pe"].includes(vLegSide)) {
        res.status(400).json({ status: "warning", message: "Select a valid CE/PE leg before placing a live option order." });
        return;
    }
    if (!(vTargetDelta > 0)) {
        res.status(400).json({ status: "warning", message: "Enter a valid New D before placing a live option order." });
        return;
    }

    const vLockKey = getManualFutureOrderLockKey(vUserId, pStrategyCode);
    if (gManualOptionOrderLocks.has(vLockKey)) {
        res.status(409).json({
            status: "warning",
            message: "A live option order is already being processed. Please wait for it to finish before placing another one."
        });
        return;
    }

    gManualOptionOrderLocks.add(vLockKey);
    try {
        const { client, profile } = await getDeltaClientForAccountId(vUserId, vSelectedApiProfileId);
        const arrExisting = await listRollingFuturesLtImportedPositions(vUserId, pStrategyCode);
        const arrOpenOptions = listTrackedOpenOptionPositions(arrExisting);
        const bIsDualStrategy = pStrategyCode === "rolling-futures-lt-dual";
        if (!bIsDualStrategy && arrOpenOptions.length > 0) {
            throw new Error(`An option position is already open (${arrOpenOptions[0].contractName}). Close the existing option before placing another option order.`);
        }
        if (bIsDualStrategy && hasTrackedOptionLeg(arrExisting, vLegSide === "pe" ? "pe" : "ce")) {
            throw new Error(`A ${vLegSide.toUpperCase()} option is already open. Close the existing ${vLegSide.toUpperCase()} leg before placing another one.`);
        }
        const objOptionMetadata = getLiveOptionRuleMetadataFromUiState(getMergedUiState(objProfile), "manual_option_open");
        const objConfig = {
            symbol: vSymbol,
            contractName: getContractNameForSymbol(vSymbol),
            lotSize: getLotSizeForSymbol(vSymbol),
            futureQty: 1,
            futureOrderType: "market_order" as const,
            action: vAction === "buy" ? "buy" as const : "sell" as const,
            legSide: vLegSide === "pe" ? "pe" as const : "ce" as const,
            expiryMode: ["1", "2", "4", "5", "6", "7"].includes(vExpiryMode) ? vExpiryMode : "5",
            expiryDate: vExpiryDate,
            optionQty: vQty,
            redOptionQtyPct: 100,
            greenOptionQtyPct: 100,
            newDelta: vTargetDelta,
            reDelta: vTargetDelta,
            deltaTakeProfit: 0.25,
            deltaStopLoss: 0.65,
            reEnter: false,
            addOneLotFuture: false,
            renkoEnabled: false,
            renkoStepPoints: 10,
            renkoPriceSource: "spot_price" as const,
            loopSeconds: 8
        };
        const objContract = await findBestLiveOptionContract(objConfig, vLegSide === "pe" ? "PE" : "CE", vTargetDelta, true);
        if (!objContract) {
            throw new Error(`No live ${vLegSide.toUpperCase()} contract was found for ${vSymbol} with delta at or below ${vTargetDelta.toFixed(2)}.`);
        }

        const vAbsoluteDelta = Math.abs(Number(objContract.delta || 0));
        if (!(vAbsoluteDelta <= vTargetDelta)) {
            throw new Error(`The selected ${vLegSide.toUpperCase()} contract delta ${vAbsoluteDelta.toFixed(2)} exceeded New D ${vTargetDelta.toFixed(2)}.`);
        }

        const objOrderPayload: Record<string, unknown> = {
            product_symbol: objContract.contractSymbol,
            size: vQty,
            side: vAction,
            order_type: "market_order",
            time_in_force: "gtc",
            post_only: false,
            reduce_only: false
        };
        const objResponse = await client.apis.Orders.placeOrder({
            order: objOrderPayload
        });
        const objPayload = readResponsePayload(objResponse);
        const arrExistingAfterOrder = await listRollingFuturesLtImportedPositions(vUserId, pStrategyCode);
        const arrSaved = await replaceRollingFuturesLtImportedPositions(vUserId, pStrategyCode, [
            ...arrExistingAfterOrder,
            {
                userId: vUserId,
                strategyCode: pStrategyCode,
                importId: crypto.randomUUID(),
                contractName: String(objContract.contractSymbol || "").trim(),
                side: vAction.toUpperCase(),
                qty: vQty,
                entryPrice: Number(objContract.markPrice || 0),
                markPrice: Number(objContract.markPrice || 0),
                charges: 0,
                pnl: 0,
                margin: 0,
                liquidationPrice: 0,
                metadata: optionMetadataToRecord({
                    ...objOptionMetadata,
                    baseDelta: vAbsoluteDelta,
                    baseTheta: Math.abs(Number(objContract.theta || 0))
                }),
                openedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            } satisfies RollingFuturesLtImportedPositionRecord
        ]);
        const vEntryCharge = await estimateTrackedPositionCharge({
            contractName: String(objContract.contractSymbol || "").trim(),
            qty: vQty,
            entryPrice: Number(objContract.markPrice || 0),
            markPrice: Number(objContract.markPrice || 0)
        });
        await incrementBrokerageRecoveryTotal(vUserId, pStrategyCode, vEntryCharge, arrSaved.length);

        await logFuturesEvent(
            vUserId,
            pStrategyCode,
            "option_opened",
            "success",
            "Manual Option Order Placed",
            `${vAction.toUpperCase()} ${vLegSide.toUpperCase()} live option order placed using ${profile.referenceName}.`,
            {
                symbol: vSymbol,
                contractName: objContract.contractSymbol,
                qty: vQty,
                targetDelta: vTargetDelta,
                reason: "manual_option"
            }
        );

        res.json({
            status: "success",
            message: `${vAction.toUpperCase()} ${vLegSide.toUpperCase()} live option order placed using ${profile.referenceName}.`,
            data: {
                action: vAction,
                legSide: vLegSide,
                qty: vQty,
                targetDelta: vTargetDelta,
                order: objPayload.result || objPayload,
                contract: {
                    contractSymbol: objContract.contractSymbol,
                    optionSide: objContract.optionSide,
                    strike: objContract.strike,
                    delta: objContract.delta,
                    markPrice: objContract.markPrice,
                    requestedExpiryDate: objContract.requestedExpiryDate,
                    resolvedExpiryDate: objContract.expiryDate,
                    usedNextDayExpiryFallback: objContract.usedNextDayFallback
                },
                trackedOpenPositions: await buildOpenPositionsPayload(vUserId, pStrategyCode, arrSaved)
            }
        });
    }
    catch (objError) {
        await logFuturesEvent(
            vUserId,
            pStrategyCode,
            "engine_error",
            "error",
            "Manual Option Order Failed",
            getErrorMessage(objError, "Unable to place live option order."),
            {
                symbol: vSymbol,
                qty: vQty,
                targetDelta: vTargetDelta,
                reason: "manual_option_error"
            }
        );
        res.status(500).json({
            status: "danger",
            message: getErrorMessage(objError, "Unable to place live option order.")
        });
    }
    finally {
        gManualOptionOrderLocks.delete(vLockKey);
    }
}

async function executeStrategyInternal(req: Request, res: Response, pStrategyCode: RollingFuturesLtStrategyCode): Promise<void> {
    const vUserId = getAccountId(req);
    const objProfile = await readLiveProfile(vUserId, pStrategyCode);
    const vSelectedApiProfileId = String(objProfile.selectedApiProfileId || "").trim();
    if (!vSelectedApiProfileId) {
        res.status(400).json({ status: "warning", message: "Select an API profile before executing the live strategy." });
        return;
    }

    const objRuntime = await loadRollingFuturesLtRuntime(vUserId, pStrategyCode);
    if (!objRuntime?.autoTraderEnabled || String(objRuntime.status || "").trim().toLowerCase() !== "running") {
        res.status(400).json({
            status: "warning",
            message: "Turn Auto Trader ON before executing the live strategy."
        });
        return;
    }

    const objCheck = await performRollingFuturesLtConnectionCheck(vUserId, pStrategyCode, vSelectedApiProfileId);
    if (objCheck.profile.connectionStatus.state !== "connected") {
        res.status(400).json({
            status: "warning",
            message: objCheck.profile.connectionStatus.message || "Delta connection is not healthy.",
            data: objCheck.profile
        });
        return;
    }

    const vAction = String(req.body?.action || "").trim().toLowerCase();
    const vSymbol = normalizeSymbolValue(req.body?.symbol || getMergedUiState(objProfile).symbol);
    const vLegSide = String(req.body?.legSide || "").trim().toLowerCase();
    const vExpiryMode = String(req.body?.expiryMode || "5").trim() as "1" | "2" | "4" | "5" | "6" | "7";
    const vExpiryDate = normalizeRollingFuturesExpiryDate(vExpiryMode, req.body?.expiryDate);
    const vQty = Math.max(1, Math.floor(Number(req.body?.qty || 1)));
    const vTargetDelta = Math.max(0, Number(req.body?.targetDelta || 0.53));

    if (vAction !== "buy" && vAction !== "sell") {
        res.status(400).json({ status: "warning", message: "Select a valid Action before executing the live strategy." });
        return;
    }
    if (!["ce", "pe", "both"].includes(vLegSide)) {
        res.status(400).json({ status: "warning", message: "Select valid Legs before executing the live strategy." });
        return;
    }
    if (pStrategyCode !== "rolling-futures-lt-dual" && vLegSide === "both") {
        res.status(400).json({ status: "warning", message: "Select either CE or PE for this live strategy page." });
        return;
    }
    if (!(vTargetDelta > 0)) {
        res.status(400).json({ status: "warning", message: "Enter a valid New D before executing the live strategy." });
        return;
    }

    const vLockKey = getManualFutureOrderLockKey(vUserId, pStrategyCode);
    if (gAutoTraderCycleLocks.has(vLockKey)) {
        res.status(409).json({
            status: "warning",
            message: "The live auto trader is in the middle of a server cycle. Please wait a few seconds and try Exec Strategy again."
        });
        return;
    }
    if (gExecStrategyLocks.has(vLockKey)) {
        res.status(409).json({
            status: "warning",
            message: "Exec Strategy is already running for this page. Please wait for it to finish."
        });
        return;
    }

    gExecStrategyLocks.add(vLockKey);
    try {
        const objExecResult = await executeStrategyPlacement(
            vUserId,
            pStrategyCode,
            vSelectedApiProfileId,
            objProfile,
            {
                action: vAction === "buy" ? "buy" : "sell",
                symbol: vSymbol,
                legSide: vLegSide === "both" ? "both" : (vLegSide === "pe" ? "pe" : "ce"),
                expiryMode: ["1", "2", "4", "5", "6", "7"].includes(vExpiryMode) ? vExpiryMode : "5",
                expiryDate: vExpiryDate,
                qty: vQty,
                targetDelta: vTargetDelta
            }
        );

        await logFuturesEvent(
            vUserId,
            pStrategyCode,
            "option_opened",
            "success",
            "Exec Strategy Started",
            `Exec Strategy placed ${objExecResult.orders.length} option order${objExecResult.orders.length === 1 ? "" : "s"} using ${objExecResult.profileLabel}.`,
            {
                symbol: vSymbol,
                action: vAction,
                legs: vLegSide,
                qty: vQty,
                targetDelta: vTargetDelta,
                neutralMode: objExecResult.neutralCheck.mode,
                hedgePlaced: objExecResult.neutralCheck.hedgePlaced,
                reason: "exec_strategy"
            }
        );

        res.json({
            status: "success",
            message: `Exec Strategy placed ${objExecResult.orders.length} option order${objExecResult.orders.length === 1 ? "" : "s"} using ${objExecResult.profileLabel}.`,
            data: {
                action: vAction,
                legs: vLegSide,
                qty: vQty,
                targetDelta: vTargetDelta,
                orders: objExecResult.orders,
                contracts: objExecResult.contracts,
                trackedOpenPositions: await buildOpenPositionsPayload(vUserId, pStrategyCode, objExecResult.trackedOpenPositions),
                neutralCheck: objExecResult.neutralCheck
            }
        });
    }
    catch (objError) {
        await logFuturesEvent(
            vUserId,
            pStrategyCode,
            "engine_error",
            "error",
            "Exec Strategy Failed",
            getErrorMessage(objError, "Unable to execute the live strategy."),
            {
                symbol: vSymbol,
                qty: vQty,
                targetDelta: vTargetDelta,
                reason: "exec_strategy_error"
            }
        );
        res.status(500).json({
            status: "danger",
            message: getErrorMessage(objError, "Unable to execute the live strategy.")
        });
    }
    finally {
        gExecStrategyLocks.delete(vLockKey);
    }
}

async function getClosedPositionsInternal(req: Request, res: Response, pStrategyCode: RollingFuturesLtStrategyCode): Promise<void> {
    const vProfileId = await resolveProfileId(req, pStrategyCode);
    if (!vProfileId) {
        res.status(400).json({ status: "warning", message: "API profile is required." });
        return;
    }
    try {
        const objProfile = await readLiveProfile(getAccountId(req), pStrategyCode);
        const objUiState = getMergedUiState(objProfile);
        const vSelectedSymbol = normalizeSymbolValue(req.query?.symbol || req.body?.symbol || objUiState.symbol);
        const { client, profile } = await getDeltaClientForAccountId(getAccountId(req), vProfileId);
        const vPageSize = 100;
        const arrRows: DeltaOrderHistoryRow[] = [];
        let vAfterCursor = "";
        let vSafetyCounter = 0;
        const vStartTime = toEpochMicros(String(req.query?.fromDate || ""));
        const vEndTime = toEpochMicros(String(req.query?.toDate || ""), true);
        while (vSafetyCounter < 100) {
            const objParams: Record<string, string | number> = { page_size: vPageSize };
            if (vStartTime) {
                objParams.start_time = vStartTime;
            }
            if (vEndTime) {
                objParams.end_time = vEndTime;
            }
            if (vAfterCursor) {
                objParams.after = vAfterCursor;
            }
            const objResponse = await client.apis.TradeHistory.getOrderHistory(objParams);
            const objPayload = readResponsePayload(objResponse);
            const arrPageRows = Array.isArray(objPayload.result) ? objPayload.result as DeltaOrderHistoryRow[] : [];
            arrRows.push(...arrPageRows);
            const vNextAfter = String((objPayload.meta as { after?: unknown } | undefined)?.after || "").trim();
            vSafetyCounter += 1;
            if (!vNextAfter || vNextAfter === vAfterCursor || arrPageRows.length < vPageSize) {
                break;
            }
            vAfterCursor = vNextAfter;
        }
        const arrClosedPositions = arrRows
            .filter((objRow) => String(objRow.state || "").trim().toLowerCase() === "closed")
            .filter((objRow) => {
                const vContract = String(objRow.product_symbol || objRow.symbol || "").trim().toUpperCase();
                return isTrackedContractForSymbol(vContract, vSelectedSymbol);
            })
            .map(mapLiveClosedPosition);
        res.json({
            status: "success",
            data: {
                profileId: profile.profileId,
                profileName: profile.referenceName,
                totalCount: arrClosedPositions.length,
                positions: arrClosedPositions
            }
        });
    }
    catch (objError) {
        res.status(500).json({
            status: "danger",
            message: getErrorMessage(objError, "Unable to fetch Delta closed futures positions.")
        });
    }
}

async function getEventsInternal(req: Request, res: Response, pStrategyCode: RollingFuturesLtStrategyCode): Promise<void> {
    const arrEvents = await listRollingOptionsEventsByStrategy(getAccountId(req), pStrategyCode, 100);
    res.json({
        status: "success",
        data: arrEvents
    });
}

async function clearEventsInternal(req: Request, res: Response, pStrategyCode: RollingFuturesLtStrategyCode): Promise<void> {
    const vDeletedCount = await clearRollingOptionsEventsByStrategy(getAccountId(req), pStrategyCode);
    res.json({
        status: "success",
        message: `Cleared ${vDeletedCount} live activity log event${vDeletedCount === 1 ? "" : "s"}.`
    });
}

async function deleteEventInternal(req: Request, res: Response, pStrategyCode: RollingFuturesLtStrategyCode): Promise<void> {
    const vEventId = String(req.body?.eventId || "").trim();
    if (!vEventId) {
        res.status(400).json({ status: "warning", message: "Event ID is required." });
        return;
    }
    const bDeleted = await deleteRollingOptionsEventByStrategy(getAccountId(req), pStrategyCode, vEventId);
    if (!bDeleted) {
        res.status(404).json({ status: "warning", message: "Activity log entry was not found." });
        return;
    }
    res.json({
        status: "success",
        message: "Activity log entry deleted."
    });
}

async function executeKillSwitchInternal(req: Request, res: Response, pStrategyCode: RollingFuturesLtStrategyCode): Promise<void> {
    const vUserId = getAccountId(req);
    const objProfile = await readLiveProfile(vUserId, pStrategyCode);
    const vSelectedApiProfileId = String(objProfile.selectedApiProfileId || "").trim();
    if (!vSelectedApiProfileId) {
        res.status(400).json({ status: "warning", message: "Select an API profile before using the live kill switch." });
        return;
    }
    const arrPositions = await listRollingFuturesLtImportedPositions(vUserId, pStrategyCode);
    if (!arrPositions.length) {
        res.json({
            status: "success",
            message: "No saved live futures positions were open.",
            data: { closedPositions: [] }
        });
        return;
    }
    const objCheck = await performRollingFuturesLtConnectionCheck(vUserId, pStrategyCode, vSelectedApiProfileId);
    if (objCheck.profile.connectionStatus.state !== "connected") {
        res.status(400).json({
            status: "warning",
            message: objCheck.profile.connectionStatus.message || "Delta connection is not healthy.",
            data: objCheck.profile
        });
        return;
    }
    try {
        const { client, profile } = await getDeltaClientForAccountId(vUserId, vSelectedApiProfileId);
        const arrCloseCharges = await Promise.all(arrPositions.map((objPosition) => estimateTrackedPositionCharge(
            objPosition,
            Number(objPosition.markPrice || objPosition.entryPrice || 0)
        )));
        const arrClosePnls = arrPositions.map((objPosition) => estimateTrackedPositionPnl(
            objPosition,
            Number(objPosition.markPrice || objPosition.entryPrice || 0)
        ));
        const arrClosed: Array<Record<string, unknown>> = [];
        for (const objPosition of arrPositions) {
            const objOrderPayload: Record<string, unknown> = {
                product_symbol: objPosition.contractName,
                size: objPosition.qty,
                side: objPosition.side === "BUY" ? "sell" : "buy",
                order_type: "market_order",
                time_in_force: "gtc",
                post_only: false,
                reduce_only: true
            };
            const objResponse = await client.apis.Orders.placeOrder({ order: objOrderPayload });
            const objPayload = readResponsePayload(objResponse);
            arrClosed.push({
                importId: objPosition.importId,
                contractName: objPosition.contractName,
                qty: objPosition.qty,
                order: objPayload.result || objPayload
            });
        }
        await replaceRollingFuturesLtImportedPositions(vUserId, pStrategyCode, []);
        await incrementBrokerageRecoveryTotal(
            vUserId,
            pStrategyCode,
            arrCloseCharges.reduce((pSum, vValue) => pSum + Number(vValue || 0), 0),
            0
        );
        await incrementRecoveredTotalPnl(
            vUserId,
            pStrategyCode,
            arrClosePnls.reduce((pSum, vValue) => pSum + Number(vValue || 0), 0),
            0
        );
        await logFuturesEvent(
            vUserId,
            pStrategyCode,
            "engine_stopped",
            "warning",
            "Live Futures Kill Switch",
            `Kill switch placed reduce-only close orders for ${arrClosed.length} saved live futures position${arrClosed.length === 1 ? "" : "s"} using ${profile.referenceName}.`,
            { qty: arrClosed.length, reason: "kill_switch" }
        );
        res.json({
            status: "success",
            message: `Kill switch closed ${arrClosed.length} saved live futures position${arrClosed.length === 1 ? "" : "s"}.`,
            data: {
                closedPositions: arrClosed,
                trackedOpenPositions: await buildOpenPositionsPayload(vUserId, pStrategyCode, [])
            }
        });
    }
    catch (objError) {
        await logFuturesEvent(
            vUserId,
            pStrategyCode,
            "engine_error",
            "error",
            "Kill Switch Failed",
            getErrorMessage(objError, "Unable to complete live futures kill switch."),
            { reason: "kill_switch_error" }
        );
        res.status(500).json({
            status: "danger",
            message: getErrorMessage(objError, "Unable to complete live futures kill switch.")
        });
    }
}

async function updateRecoveryMetricsInternal(req: Request, res: Response, pStrategyCode: RollingFuturesLtStrategyCode): Promise<void> {
    const vUserId = getAccountId(req);
    const vBrokerageTotal = Math.max(0, Number(req.body?.totalBrokerageToRecover || 0));
    const vRecoveredPnl = Number(req.body?.totalPnl || 0);
    if (!Number.isFinite(vBrokerageTotal) || !Number.isFinite(vRecoveredPnl)) {
        res.status(400).json({
            status: "warning",
            message: "Enter valid numeric values for Total Brokerage to Recvr and Total PnL."
        });
        return;
    }

    await saveBrokerageRecoveryTotal(vUserId, pStrategyCode, vBrokerageTotal);
    await saveRecoveredTotalPnl(vUserId, pStrategyCode, vRecoveredPnl);
    await logFuturesEvent(
        vUserId,
        pStrategyCode,
        "manual_action",
        "warning",
        "Recovery Metrics Updated",
        `Manual override saved. Brokerage to recover set to ${vBrokerageTotal.toFixed(4)} and total PnL set to ${vRecoveredPnl.toFixed(4)}.`,
        {
            reason: "manual_recovery_metrics_update",
            totalBrokerageToRecover: Number(vBrokerageTotal.toFixed(4)),
            totalPnl: Number(vRecoveredPnl.toFixed(4))
        }
    );

    const objOpenPositions = await buildOpenPositionsPayload(vUserId, pStrategyCode);
    res.json({
        status: "success",
        message: "Recovery metrics updated.",
        data: objOpenPositions
    });
}

export async function getRollingFuturesLtLongProfile(req: Request, res: Response): Promise<void> {
    await getProfileInternal(req, res, "rolling-futures-lt-long");
}
export async function saveRollingFuturesLtLongProfile(req: Request, res: Response): Promise<void> {
    await saveProfileInternal(req, res, "rolling-futures-lt-long");
}
export async function getRollingFuturesLtLongConnectionStatus(req: Request, res: Response): Promise<void> {
    await getConnectionStatusInternal(req, res, "rolling-futures-lt-long");
}
export async function getRollingFuturesLtLongRuntimeStatus(req: Request, res: Response): Promise<void> {
    await getRuntimeStatusInternal(req, res, "rolling-futures-lt-long");
}
export async function checkRollingFuturesLtLongConnection(req: Request, res: Response): Promise<void> {
    await checkConnectionInternal(req, res, "rolling-futures-lt-long");
}
export async function enableRollingFuturesLtLongAutoTrader(req: Request, res: Response): Promise<void> {
    await enableAutoTraderInternal(req, res, "rolling-futures-lt-long");
}
export async function disableRollingFuturesLtLongAutoTrader(req: Request, res: Response): Promise<void> {
    await disableAutoTraderInternal(req, res, "rolling-futures-lt-long");
}
export async function getRollingFuturesLtLongAccountSummary(req: Request, res: Response): Promise<void> {
    await getAccountSummaryInternal(req, res, "rolling-futures-lt-long");
}
export async function executeRollingFuturesLtLongManualFuture(req: Request, res: Response): Promise<void> {
    await executeManualFutureInternal(req, res, "rolling-futures-lt-long");
}
export async function executeRollingFuturesLtLongManualOption(req: Request, res: Response): Promise<void> {
    await executeManualOptionInternal(req, res, "rolling-futures-lt-long");
}
export async function executeRollingFuturesLtLongStrategy(req: Request, res: Response): Promise<void> {
    await executeStrategyInternal(req, res, "rolling-futures-lt-long");
}
export async function getRollingFuturesLtLongImportableOpenPositions(req: Request, res: Response): Promise<void> {
    await getImportableOpenPositionsInternal(req, res, "rolling-futures-lt-long");
}
export async function getRollingFuturesLtLongOpenPositions(req: Request, res: Response): Promise<void> {
    await getOpenPositionsInternal(req, res, "rolling-futures-lt-long");
}
export async function saveRollingFuturesLtLongOpenPositions(req: Request, res: Response): Promise<void> {
    await saveOpenPositionsInternal(req, res, "rolling-futures-lt-long");
}
export async function deleteRollingFuturesLtLongOpenPosition(req: Request, res: Response): Promise<void> {
    await deleteOpenPositionInternal(req, res, "rolling-futures-lt-long");
}
export async function reconcileRollingFuturesLtLongOpenPositions(req: Request, res: Response): Promise<void> {
    await reconcileOpenPositionsInternal(req, res, "rolling-futures-lt-long");
}
export async function closeRollingFuturesLtLongImportedOpenPosition(req: Request, res: Response): Promise<void> {
    await closeImportedOpenPositionInternal(req, res, "rolling-futures-lt-long");
}
export async function getRollingFuturesLtLongClosedPositions(req: Request, res: Response): Promise<void> {
    await getClosedPositionsInternal(req, res, "rolling-futures-lt-long");
}
export async function getRollingFuturesLtLongEvents(req: Request, res: Response): Promise<void> {
    await getEventsInternal(req, res, "rolling-futures-lt-long");
}
export async function clearRollingFuturesLtLongEventsController(req: Request, res: Response): Promise<void> {
    await clearEventsInternal(req, res, "rolling-futures-lt-long");
}
export async function deleteRollingFuturesLtLongEventController(req: Request, res: Response): Promise<void> {
    await deleteEventInternal(req, res, "rolling-futures-lt-long");
}
export async function executeRollingFuturesLtLongKillSwitch(req: Request, res: Response): Promise<void> {
    await executeKillSwitchInternal(req, res, "rolling-futures-lt-long");
}
export async function updateRollingFuturesLtLongRecoveryMetrics(req: Request, res: Response): Promise<void> {
    await updateRecoveryMetricsInternal(req, res, "rolling-futures-lt-long");
}

export async function getRollingFuturesLtShortProfile(req: Request, res: Response): Promise<void> {
    await getProfileInternal(req, res, "rolling-futures-lt-short");
}
export async function saveRollingFuturesLtShortProfile(req: Request, res: Response): Promise<void> {
    await saveProfileInternal(req, res, "rolling-futures-lt-short");
}
export async function getRollingFuturesLtShortConnectionStatus(req: Request, res: Response): Promise<void> {
    await getConnectionStatusInternal(req, res, "rolling-futures-lt-short");
}
export async function getRollingFuturesLtShortRuntimeStatus(req: Request, res: Response): Promise<void> {
    await getRuntimeStatusInternal(req, res, "rolling-futures-lt-short");
}
export async function checkRollingFuturesLtShortConnection(req: Request, res: Response): Promise<void> {
    await checkConnectionInternal(req, res, "rolling-futures-lt-short");
}
export async function enableRollingFuturesLtShortAutoTrader(req: Request, res: Response): Promise<void> {
    await enableAutoTraderInternal(req, res, "rolling-futures-lt-short");
}
export async function disableRollingFuturesLtShortAutoTrader(req: Request, res: Response): Promise<void> {
    await disableAutoTraderInternal(req, res, "rolling-futures-lt-short");
}
export async function getRollingFuturesLtShortAccountSummary(req: Request, res: Response): Promise<void> {
    await getAccountSummaryInternal(req, res, "rolling-futures-lt-short");
}
export async function executeRollingFuturesLtShortManualFuture(req: Request, res: Response): Promise<void> {
    await executeManualFutureInternal(req, res, "rolling-futures-lt-short");
}
export async function executeRollingFuturesLtShortManualOption(req: Request, res: Response): Promise<void> {
    await executeManualOptionInternal(req, res, "rolling-futures-lt-short");
}
export async function executeRollingFuturesLtShortStrategy(req: Request, res: Response): Promise<void> {
    await executeStrategyInternal(req, res, "rolling-futures-lt-short");
}
export async function getRollingFuturesLtShortImportableOpenPositions(req: Request, res: Response): Promise<void> {
    await getImportableOpenPositionsInternal(req, res, "rolling-futures-lt-short");
}
export async function getRollingFuturesLtShortOpenPositions(req: Request, res: Response): Promise<void> {
    await getOpenPositionsInternal(req, res, "rolling-futures-lt-short");
}
export async function saveRollingFuturesLtShortOpenPositions(req: Request, res: Response): Promise<void> {
    await saveOpenPositionsInternal(req, res, "rolling-futures-lt-short");
}
export async function deleteRollingFuturesLtShortOpenPosition(req: Request, res: Response): Promise<void> {
    await deleteOpenPositionInternal(req, res, "rolling-futures-lt-short");
}
export async function reconcileRollingFuturesLtShortOpenPositions(req: Request, res: Response): Promise<void> {
    await reconcileOpenPositionsInternal(req, res, "rolling-futures-lt-short");
}
export async function closeRollingFuturesLtShortImportedOpenPosition(req: Request, res: Response): Promise<void> {
    await closeImportedOpenPositionInternal(req, res, "rolling-futures-lt-short");
}
export async function getRollingFuturesLtShortClosedPositions(req: Request, res: Response): Promise<void> {
    await getClosedPositionsInternal(req, res, "rolling-futures-lt-short");
}
export async function getRollingFuturesLtShortEvents(req: Request, res: Response): Promise<void> {
    await getEventsInternal(req, res, "rolling-futures-lt-short");
}
export async function clearRollingFuturesLtShortEventsController(req: Request, res: Response): Promise<void> {
    await clearEventsInternal(req, res, "rolling-futures-lt-short");
}
export async function deleteRollingFuturesLtShortEventController(req: Request, res: Response): Promise<void> {
    await deleteEventInternal(req, res, "rolling-futures-lt-short");
}
export async function executeRollingFuturesLtShortKillSwitch(req: Request, res: Response): Promise<void> {
    await executeKillSwitchInternal(req, res, "rolling-futures-lt-short");
}
export async function updateRollingFuturesLtShortRecoveryMetrics(req: Request, res: Response): Promise<void> {
    await updateRecoveryMetricsInternal(req, res, "rolling-futures-lt-short");
}

export async function getRollingFuturesLtDualProfile(req: Request, res: Response): Promise<void> {
    await getProfileInternal(req, res, "rolling-futures-lt-dual");
}
export async function saveRollingFuturesLtDualProfile(req: Request, res: Response): Promise<void> {
    await saveProfileInternal(req, res, "rolling-futures-lt-dual");
}
export async function getRollingFuturesLtDualConnectionStatus(req: Request, res: Response): Promise<void> {
    await getConnectionStatusInternal(req, res, "rolling-futures-lt-dual");
}
export async function getRollingFuturesLtDualRuntimeStatus(req: Request, res: Response): Promise<void> {
    await getRuntimeStatusInternal(req, res, "rolling-futures-lt-dual");
}
export async function checkRollingFuturesLtDualConnection(req: Request, res: Response): Promise<void> {
    await checkConnectionInternal(req, res, "rolling-futures-lt-dual");
}
export async function enableRollingFuturesLtDualAutoTrader(req: Request, res: Response): Promise<void> {
    await enableAutoTraderInternal(req, res, "rolling-futures-lt-dual");
}
export async function disableRollingFuturesLtDualAutoTrader(req: Request, res: Response): Promise<void> {
    await disableAutoTraderInternal(req, res, "rolling-futures-lt-dual");
}
export async function getRollingFuturesLtDualAccountSummary(req: Request, res: Response): Promise<void> {
    await getAccountSummaryInternal(req, res, "rolling-futures-lt-dual");
}
export async function executeRollingFuturesLtDualManualFuture(req: Request, res: Response): Promise<void> {
    await executeManualFutureInternal(req, res, "rolling-futures-lt-dual");
}
export async function executeRollingFuturesLtDualManualOption(req: Request, res: Response): Promise<void> {
    await executeManualOptionInternal(req, res, "rolling-futures-lt-dual");
}
export async function executeRollingFuturesLtDualStrategy(req: Request, res: Response): Promise<void> {
    await executeStrategyInternal(req, res, "rolling-futures-lt-dual");
}
export async function getRollingFuturesLtDualImportableOpenPositions(req: Request, res: Response): Promise<void> {
    await getImportableOpenPositionsInternal(req, res, "rolling-futures-lt-dual");
}
export async function getRollingFuturesLtDualOpenPositions(req: Request, res: Response): Promise<void> {
    await getOpenPositionsInternal(req, res, "rolling-futures-lt-dual");
}
export async function saveRollingFuturesLtDualOpenPositions(req: Request, res: Response): Promise<void> {
    await saveOpenPositionsInternal(req, res, "rolling-futures-lt-dual");
}
export async function deleteRollingFuturesLtDualOpenPosition(req: Request, res: Response): Promise<void> {
    await deleteOpenPositionInternal(req, res, "rolling-futures-lt-dual");
}
export async function reconcileRollingFuturesLtDualOpenPositions(req: Request, res: Response): Promise<void> {
    await reconcileOpenPositionsInternal(req, res, "rolling-futures-lt-dual");
}
export async function closeRollingFuturesLtDualImportedOpenPosition(req: Request, res: Response): Promise<void> {
    await closeImportedOpenPositionInternal(req, res, "rolling-futures-lt-dual");
}
export async function getRollingFuturesLtDualClosedPositions(req: Request, res: Response): Promise<void> {
    await getClosedPositionsInternal(req, res, "rolling-futures-lt-dual");
}
export async function getRollingFuturesLtDualEvents(req: Request, res: Response): Promise<void> {
    await getEventsInternal(req, res, "rolling-futures-lt-dual");
}
export async function clearRollingFuturesLtDualEventsController(req: Request, res: Response): Promise<void> {
    await clearEventsInternal(req, res, "rolling-futures-lt-dual");
}
export async function deleteRollingFuturesLtDualEventController(req: Request, res: Response): Promise<void> {
    await deleteEventInternal(req, res, "rolling-futures-lt-dual");
}
export async function executeRollingFuturesLtDualKillSwitch(req: Request, res: Response): Promise<void> {
    await executeKillSwitchInternal(req, res, "rolling-futures-lt-dual");
}
export async function updateRollingFuturesLtDualRecoveryMetrics(req: Request, res: Response): Promise<void> {
    await updateRecoveryMetricsInternal(req, res, "rolling-futures-lt-dual");
}
