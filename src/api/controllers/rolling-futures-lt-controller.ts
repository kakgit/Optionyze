import type { Request, Response } from "express";
import crypto from "node:crypto";
const DeltaRestClient = require("delta-rest-client");
import { getAccountById, getAccountByTelegramChatId } from "../../storage/accounts-store";
import { sendMobilePushToAccount } from "../../services/firebase-push-service";
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
    hasRecentRollingOptionsEventMatch,
    deleteRollingOptionsEventByStrategy,
    listRollingOptionsEventsByStrategy,
    saveRollingOptionsEvent
} from "../../storage/rolling-options-pt-de-event-store";
import {
    appendOptionsScalperPaperClosedPositions,
    listOptionsScalperPaperClosedPositions,
    type OptionsScalperPaperClosedPositionRecord
} from "../../storage/options-scalper-paper-store";
import { getOptionsDemoOiIndicatorSummary } from "../../strategies/directional-options-demo/oi-indicator";
import {
    createPendingStrategyExecutionRequest,
    deletePendingStrategyExecutionRequest,
    getPendingStrategyExecutionRequestById,
    listPendingStrategyExecutionRequests
} from "../../storage/strategy-execution-request-store";
import { getPendingStrategyAutoExecSettings } from "../../storage/admin-settings-store";
import { findBestLiveOptionContract, getLiveMarketSnapshot, getLiveOptionTicker } from "../../strategies/rolling-options-pt-de/market-data";
import { getServerId, getStrategyLeaseDurationMs } from "../../runtime/server-runtime";
import {
    acquireStrategyLease,
    forceReleaseStrategyLease,
    getStrategyLease,
    releaseStrategyLease,
    renewStrategyLease,
    type StrategyLeaseRecord
} from "../../storage/strategy-lease-store";
import {
    acquireSurvivalStateLease,
    forceAcquireSurvivalStateLease,
    getSurvivalState,
    listSurvivalStates,
    renewSurvivalStateLease,
    upsertSurvivalState
} from "../../storage/survival-store";
import { isPostgresConfigured, isPrimaryDatabaseUnavailableError } from "../../storage/postgres";

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
    unrealized_cashflow?: number | string | null;
    unrealised_cashflow?: number | string | null;
    unrealized_pnl?: number | string | null;
    unrealised_pnl?: number | string | null;
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
    unrealised_pnl?: number | string | null;
    unrealized_cashflow?: number | string | null;
    unrealised_cashflow?: number | string | null;
    margin?: number | string | null;
    position_margin?: number | string | null;
    initial_margin?: number | string | null;
    maintenance_margin?: number | string | null;
    order_margin?: number | string | null;
    product_id?: number | string | null;
    created_at?: string | number | null;
    updated_at?: string | number | null;
    opened_at?: string | number | null;
    createdAt?: string | number | null;
    updatedAt?: string | number | null;
    openedAt?: string | number | null;
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
    client_order_id?: string | null;
    meta_data?: {
        pnl?: number | string | null;
        order_type?: string | null;
        client_order_id?: string | null;
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
    side?: string | null;
    reduce_only?: boolean | null;
    [key: string]: unknown;
}

const gStrategyNames: Record<RollingFuturesLtStrategyCode, string> = {
    "rolling-futures-lt-long": "Long Rolling Futures",
    "rolling-futures-lt-short": "Short Rolling Futures",
    "rolling-futures-lt-dual": "Dual Rolling Futures",
    "covered-options": "Covered Options",
    "strangle-options": "Strangle Options",
    "options-scalper": "Options Demo"
};
const gFutureLimitRetryDelayMs = 5000;
const gFutureLimitRetryCount = 5;
const gOptionReentryPendingMs = 5000;
const gCoveredOptionReEntryRetryMs = 60 * 1000;
const gProfitClosePauseAfterOptionRuleMs = 15000;
const gProfitCloseReEntryCooldownMs = 5 * 60 * 1000;
const gProfitCloseConfirmationMs = 5 * 60 * 1000;
const gRestartCloseProtectionMs = 5 * 60 * 1000;
const gOptionRecoveryRefreshDelayMs = 5 * 60 * 1000;
const gNeutralityHedgeCooldownMs = 2 * 60 * 1000;
const gSurvivalDebugPrefix = "[dual-survival]";
const gLocalSurvivalLeaseTokens = new Map<string, string>();
let gSurvivalTakeoverInterval: NodeJS.Timeout | null = null;
const gSimulatedPrimaryOutageUsers = new Map<string, {
    strategyCode: RollingFuturesLtStrategyCode;
    enabledAt: string;
    enabledByAccountId: string;
}>();

function logDualSurvivalDebug(
    pStage: string,
    pDetails: Record<string, unknown> = {}
): void {
    const objPayload = {
        stage: pStage,
        serverId: gServerId,
        serverInstanceId: gServerInstanceId,
        ...pDetails
    };
    console.warn(`${gSurvivalDebugPrefix} ${JSON.stringify(objPayload)}`);
}

function shouldForceDualSurvivalTest(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode
): boolean {
    if (!isDualServerManagedStrategy(pStrategyCode)) {
        return false;
    }
    const vEnabled = String(process.env.FORCE_DUAL_SURVIVAL_TEST || "").trim().toLowerCase();
    if (!["1", "true", "yes", "on"].includes(vEnabled)) {
        return false;
    }
    const arrAllowedUserIds = String(process.env.FORCE_DUAL_SURVIVAL_TEST_USER_IDS || "")
        .split(",")
        .map((vValue) => String(vValue || "").trim())
        .filter(Boolean);
    return !arrAllowedUserIds.length || arrAllowedUserIds.includes(String(pUserId || "").trim());
}

function buildSimulatedPrimaryOutageError(): Error & {
    code: string;
    syscall: string;
    hostname: string;
} {
    const objError = new Error("Simulated primary database outage for live-cycle testing.") as Error & {
        code: string;
        syscall: string;
        hostname: string;
    };
    objError.code = "ENOTFOUND";
    objError.syscall = "getaddrinfo";
    objError.hostname = "simulated-primary-db-outage";
    return objError;
}

function getSimulatedPrimaryOutageState(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode
): {
    strategyCode: RollingFuturesLtStrategyCode;
    enabledAt: string;
    enabledByAccountId: string;
} | null {
    const objState = gSimulatedPrimaryOutageUsers.get(String(pUserId || "").trim());
    if (!objState || objState.strategyCode !== pStrategyCode) {
        return null;
    }
    return objState;
}

function shouldSimulatePrimaryDbOutage(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode
): boolean {
    return Boolean(getSimulatedPrimaryOutageState(pUserId, pStrategyCode));
}
const gExecStrategyUnauthorizedMessage = "Not Authorised to Execute, Please Contact Admin";
const gDualScaledBaselineFloorRatio = 0.25;
const gDeltaUiTimezoneOffsetMinutes = 5.5 * 60;
const gManualFutureOrderLocks = new Set<string>();
const gManualOptionOrderLocks = new Set<string>();
const gExecStrategyLocks = new Set<string>();
const gNeutralityHedgeLocks = new Set<string>();
const gAutoTraderIntervals = new Map<string, NodeJS.Timeout>();
const gAutoTraderCycleLocks = new Set<string>();
const gLocalStrategyLeaseTokens = new Map<string, string>();
const gNeutralityHedgePendingMs = 45 * 1000;
const gDuplicateLiveEventCooldownMs = 60 * 1000;
const gServerId = getServerId();
const gServerInstanceId = `${gServerId}:${process.pid}:${crypto.randomUUID()}`;
const gRollingFuturesTelegramEventTypes = new Set([
    "engine_started",
    "engine_stopped",
    "engine_error",
    "strategy_executed",
    "future_opened",
    "future_closed",
    "option_opened",
    "reentry_opened",
    "option_closed",
    "sl_triggered",
    "tp_triggered",
    "kill_switch"
]);

function getDefaultTelegramAlertTypesForStrategy(pStrategyCode: RollingFuturesLtStrategyCode): string[] {
    if (!isCoveredOptionsStrategy(pStrategyCode)) {
        return [];
    }
    return [
        "engine_stopped",
        "engine_error",
        "future_opened",
        "future_closed",
        "option_opened",
        "option_closed",
        "sl_triggered"
    ];
}

function normalizeTelegramAlertTypesForStrategy(
    pStrategyCode: RollingFuturesLtStrategyCode,
    pUiState: Record<string, unknown>
): string[] {
    if (!isCoveredOptionsStrategy(pStrategyCode)) {
        return [];
    }
    return Array.isArray(pUiState.telegramAlertTypes)
        ? pUiState.telegramAlertTypes
            .map((pValue) => String(pValue || "").trim())
            .filter((pValue) => Boolean(pValue) && gRollingFuturesTelegramEventTypes.has(pValue))
        : [];
}

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
    mode: "none" | "delta" | "theta" | "gamma";
    totalDelta: number;
    totalTheta: number;
    totalGamma: number;
    minDelta: number | null;
    maxDelta: number | null;
    deltaDriftPct: number | null;
    baseOptionDeltaAbs: number | null;
    effectiveBaseOptionDeltaAbs: number | null;
    baselineFloorDeltaAbs: number | null;
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

interface RollingFuturesLtRecalculatedTotalPnl {
    strategyStartedAt: string;
    closedRealizedPnl: number;
    openFuturesRealizedPnl: number;
    totalPnl: number;
}

interface RollingFuturesLtRecommendedStartQty {
    recommendedQty: number;
    rawQty: number;
    roundedQty: number;
    basketAdjustedQty: number;
    availableBalance: number;
    usableBalance: number;
    hedgeReserve: number;
    optionReservePerQty: number;
    safetyFactor: number;
    optionReserveMultiplier: number;
    hedgeMarginRatio: number;
    basketUpliftFactor: number;
    contracts: Array<{
        contractSymbol: string;
        optionSide: "CE" | "PE";
        markPrice: number;
        delta: number;
        expiryDate: string;
    }>;
}

interface RollingFuturesLtOptionMetadata {
    rowIndex?: number;
    baseDelta?: number;
    baseTheta?: number;
    manualTraderDelta?: number;
    takeProfitDelta?: number;
    stopLossDelta?: number;
    reEntryDelta?: number;
    reEnterEnabled?: boolean;
    openedReason?: string;
    requestedExpiryDate?: string;
    resolvedExpiryDate?: string;
    importedObservationOnly?: boolean;
    importedAt?: string;
}

type CoveredLiveConfirmationKind =
    | "exec_batch"
    | "option_rule_close"
    | "covered_reentry"
    | "manual_swap";

type CoveredLiveConfirmationState = {
    actionId: string;
    kind: CoveredLiveConfirmationKind;
    title: string;
    message: string;
    createdAt: string;
    payload: Record<string, unknown>;
};

interface RollingFuturesLtAccountSummarySnapshot {
    symbol: "BTC" | "ETH";
    oneLotValue: number | null;
    totalBalance: number | null;
    blockedMargin: number | null;
    blockedMarginDisplay: number | null;
    blockedMarginHint: string;
    availableBalance: number | null;
    healthPct: number | null;
    profileLabel: string;
    openCount: number;
}

const gCoveredMultiplierMarginUsd = 1.5;
const gCoveredMultiplierMax = 1000;

function getAccountId(req: Request): string {
    const vOwnAccountId = String(req.authAccount?.accountId || "").trim();
    const vBodyTarget = typeof req.body?.targetUserId === "string" ? req.body.targetUserId : "";
    const vQueryTarget = typeof req.query?.targetUserId === "string" ? req.query.targetUserId : "";
    const vTargetAccountId = String(vBodyTarget || vQueryTarget || "").trim();
    const bCoveredVerifierTarget = Boolean(
        req.authAccount?.isVerifier
        && (req.originalUrl.includes("/covered-options") || req.originalUrl.includes("/strangle-options"))
    );
    if ((req.authAccount?.isAdmin || bCoveredVerifierTarget) && vTargetAccountId) {
        return vTargetAccountId;
    }
    return vOwnAccountId;
}

function isDualRollingFuturesStrategy(pStrategyCode: RollingFuturesLtStrategyCode): boolean {
    return pStrategyCode === "rolling-futures-lt-dual"
        || pStrategyCode === "covered-options"
        || pStrategyCode === "strangle-options";
}

function isCoveredLikeStrategy(pStrategyCode: RollingFuturesLtStrategyCode): boolean {
    return pStrategyCode === "covered-options"
        || pStrategyCode === "strangle-options"
        || pStrategyCode === "options-scalper";
}

function isOptionsScalperStrategy(pStrategyCode: RollingFuturesLtStrategyCode): boolean {
    return pStrategyCode === "options-scalper";
}

function isStrangleOptionsStrategy(pStrategyCode: RollingFuturesLtStrategyCode): boolean {
    return pStrategyCode === "strangle-options";
}

function isCoveredOptionsStrategy(pStrategyCode: RollingFuturesLtStrategyCode): boolean {
    return pStrategyCode === "covered-options" || pStrategyCode === "strangle-options";
}

function isDualServerManagedStrategy(pStrategyCode: RollingFuturesLtStrategyCode): boolean {
    return pStrategyCode === "rolling-futures-lt-dual";
}

function getCoveredLikeStrategyLabel(pStrategyCode: RollingFuturesLtStrategyCode): string {
    return isStrangleOptionsStrategy(pStrategyCode) ? "Strangle Options" : "Covered Options";
}

function getCoveredLikeLowerLabel(pStrategyCode: RollingFuturesLtStrategyCode): string {
    return isStrangleOptionsStrategy(pStrategyCode) ? "strangle" : "covered";
}

function getCoveredLikeLegText(pStrategyCode: RollingFuturesLtStrategyCode): string {
    return isStrangleOptionsStrategy(pStrategyCode) ? "strangle leg" : "covered leg";
}

function getCoveredLikePositionText(pStrategyCode: RollingFuturesLtStrategyCode): string {
    return isStrangleOptionsStrategy(pStrategyCode) ? "strangle position" : "covered position";
}

function normalizeOptionRowIndex(
    pStrategyCode: RollingFuturesLtStrategyCode,
    pValue: unknown
): 1 | 2 {
    return isCoveredLikeStrategy(pStrategyCode) && Number(pValue) === 2 ? 2 : 1;
}

function isDualExecStrategyAllowed(pStrategyCode: RollingFuturesLtStrategyCode, pExecStrategy: boolean | null | undefined): boolean {
    if (!isDualRollingFuturesStrategy(pStrategyCode)) {
        return true;
    }
    return Boolean(pExecStrategy);
}

function normalizeExecStrategyInput(
    pAction: string,
    pSymbol: unknown,
    pLegSide: string,
    pExpiryMode: string,
    pExpiryDate: unknown,
    pQty: unknown,
    pTargetDelta: unknown
): {
    action: "buy" | "sell";
    symbol: "BTC" | "ETH";
    legSide: "ce" | "pe" | "both";
    expiryMode: "1" | "2" | "4" | "5" | "6" | "7";
    expiryDate: string;
    qty: number;
    targetDelta: number;
    rowIndex?: 1 | 2;
} {
    const vAction = String(pAction || "").trim().toLowerCase();
    const vSymbol = normalizeSymbolValue(pSymbol);
    const vLegSide = String(pLegSide || "").trim().toLowerCase();
    const vExpiryMode = String(pExpiryMode || "5").trim() as "1" | "2" | "4" | "5" | "6" | "7";
    const vExpiryDate = normalizeRollingFuturesExpiryDate(vExpiryMode, pExpiryDate);
    const vQty = Math.max(1, Math.floor(Number(pQty || 1)));
    const vTargetDelta = Math.max(0, Number(pTargetDelta || 0.53));

    return {
        action: vAction === "buy" ? "buy" : "sell",
        symbol: vSymbol,
        legSide: vLegSide === "both" ? "both" : (vLegSide === "pe" ? "pe" : "ce"),
        expiryMode: ["1", "2", "4", "5", "6", "7"].includes(vExpiryMode) ? vExpiryMode : "5",
        expiryDate: vExpiryDate,
        qty: vQty,
        targetDelta: vTargetDelta
    };
}

function getCoveredMultiplierMin(pStrategyCode: RollingFuturesLtStrategyCode): number {
    return isStrangleOptionsStrategy(pStrategyCode) ? 1 : 2;
}

function normalizeCoveredMultiplierValue(
    pValue: unknown,
    pStrategyCode: RollingFuturesLtStrategyCode = "covered-options"
): number {
    const vRaw = Math.floor(Number(pValue || 0));
    const vMinimum = getCoveredMultiplierMin(pStrategyCode);
    if (!Number.isFinite(vRaw) || vRaw < vMinimum) {
        return vMinimum;
    }
    return Math.min(gCoveredMultiplierMax, vRaw);
}

function normalizeCoveredMultiplierString(
    pValue: unknown,
    pStrategyCode: RollingFuturesLtStrategyCode = "covered-options"
): string {
    return String(normalizeCoveredMultiplierValue(pValue, pStrategyCode));
}

function normalizeCoveredBuyQtyPercentValue(pValue: unknown): number {
    const vRaw = Math.floor(Number(pValue || 0));
    if (!Number.isFinite(vRaw) || vRaw < 1) {
        return 1;
    }
    return Math.min(200, vRaw);
}

function normalizeCoveredBuyQtyPercentString(pValue: unknown): string {
    return String(normalizeCoveredBuyQtyPercentValue(pValue));
}

function getCoveredRequiredMarginForMultiplier(
    pMultiplier: unknown,
    pStrategyCode: RollingFuturesLtStrategyCode = "covered-options"
): number {
    return Number((normalizeCoveredMultiplierValue(pMultiplier, pStrategyCode) * gCoveredMultiplierMarginUsd).toFixed(2));
}

async function runExecStrategyPlacement(
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
        rowIndex?: 1 | 2;
    },
    pReason: "exec_strategy" | "admin_exec_strategy"
): Promise<{
    profileLabel: string;
    trackedOpenPositions: RollingFuturesLtImportedPositionRecord[];
    contracts: Array<Record<string, unknown>>;
    orders: Array<Record<string, unknown>>;
    neutralCheck: {
        mode: "none" | "delta" | "theta" | "gamma";
        hedgePlaced: boolean;
        totalDelta: number;
        totalTheta: number;
        threshold: number | null;
    };
}> {
    const vLockKey = getManualFutureOrderLockKey(pUserId, pStrategyCode);
    if (gAutoTraderCycleLocks.has(vLockKey)) {
        throw new Error("The live auto trader is in the middle of a server cycle. Please wait a few seconds and try Exec Strategy again.");
    }
    if (gExecStrategyLocks.has(vLockKey)) {
        throw new Error("Exec Strategy is already running for this page. Please wait for it to finish.");
    }

    gExecStrategyLocks.add(vLockKey);
    try {
        const objExecResult = await executeStrategyPlacement(
            pUserId,
            pStrategyCode,
            pSelectedApiProfileId,
            pProfile,
            pInput
        );

        await logFuturesEvent(
            pUserId,
            pStrategyCode,
            "option_opened",
            "success",
            pReason === "admin_exec_strategy" ? "Admin Exec Strategy Started" : "Exec Strategy Started",
            `Exec Strategy placed ${objExecResult.orders.length} option order${objExecResult.orders.length === 1 ? "" : "s"} using ${objExecResult.profileLabel}.`,
            {
                symbol: pInput.symbol,
                action: pInput.action,
                legs: pInput.legSide,
                qty: pInput.qty,
                targetDelta: pInput.targetDelta,
                neutralMode: objExecResult.neutralCheck.mode,
                hedgePlaced: objExecResult.neutralCheck.hedgePlaced,
                reason: pReason
            }
        );

        return objExecResult;
    }
    catch (objError) {
        await logFuturesEvent(
            pUserId,
            pStrategyCode,
            "engine_error",
            "error",
            pReason === "admin_exec_strategy" ? "Admin Exec Strategy Failed" : "Exec Strategy Failed",
            getErrorMessage(objError, "Unable to execute the live strategy."),
            {
                symbol: pInput.symbol,
                qty: pInput.qty,
                targetDelta: pInput.targetDelta,
                reason: pReason === "admin_exec_strategy" ? "admin_exec_strategy_error" : "exec_strategy_error"
            }
        );
        throw objError;
    }
    finally {
        gExecStrategyLocks.delete(vLockKey);
    }
}

async function runCoveredExecStrategyBatchPlacement(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pSelectedApiProfileId: string,
    pProfile: RollingFuturesLtProfileRecord,
    pInputs: Array<{
        action: "buy" | "sell";
        symbol: "BTC" | "ETH";
        legSide: "ce" | "pe" | "both";
        expiryMode: "1" | "2" | "4" | "5" | "6" | "7";
        expiryDate: string;
        qty: number;
        targetDelta: number;
        rowIndex?: 1 | 2;
    }>,
    pReason: "exec_strategy" | "admin_exec_strategy"
): Promise<{
    profileLabel: string;
    trackedOpenPositions: RollingFuturesLtImportedPositionRecord[];
    contracts: Array<Record<string, unknown>>;
    orders: Array<Record<string, unknown>>;
    neutralCheck: {
        mode: "none" | "delta" | "theta" | "gamma";
        hedgePlaced: boolean;
        totalDelta: number;
        totalTheta: number;
        threshold: number | null;
    };
}> {
    const vLockKey = getManualFutureOrderLockKey(pUserId, pStrategyCode);
    if (gAutoTraderCycleLocks.has(vLockKey)) {
        throw new Error("The live auto trader is in the middle of a server cycle. Please wait a few seconds and try Exec Strategy again.");
    }
    if (gExecStrategyLocks.has(vLockKey)) {
        throw new Error("Exec Strategy is already running for this page. Please wait for it to finish.");
    }

    gExecStrategyLocks.add(vLockKey);
    try {
        let objLastResult: Awaited<ReturnType<typeof executeStrategyPlacement>> | null = null;
        const arrOrders: Array<Record<string, unknown>> = [];
        const arrContracts: Array<Record<string, unknown>> = [];
        const vStrategyStartedAt = new Date().toISOString();
        const objUiState = getMergedUiState(pProfile);
        await logFuturesEvent(
            pUserId,
            pStrategyCode,
            "manual_action",
            "info",
            "Exec Strategy Settings Snapshot",
            `Server will execute Covered strategy with Row 1 ${String(objUiState.action1 || "").toUpperCase()} ${String(objUiState.legs1 || "").toUpperCase()} TP ${Number(objUiState.tpD1 || 0).toFixed(2)} SL ${Number(objUiState.slD1 || 0).toFixed(2)}, Row 2 ${String(objUiState.action2 || "").toUpperCase()} ${String(objUiState.legs2 || "").toUpperCase()} TP ${Number(objUiState.tpD2 || 0).toFixed(2)} SL ${Number(objUiState.slD2 || 0).toFixed(2)}.`,
            {
                reason: "exec_strategy_settings_snapshot",
                row1: {
                    action: String(objUiState.action1 || "").trim().toLowerCase(),
                    legs: String(objUiState.legs1 || "").trim().toLowerCase(),
                    tpD: Number(objUiState.tpD1 || 0),
                    slD: Number(objUiState.slD1 || 0),
                    reD: Number(objUiState.reD1 || 0),
                    expiryDate: String(objUiState.expiryDate1 || "").trim()
                },
                row2: {
                    action: String(objUiState.action2 || "").trim().toLowerCase(),
                    legs: String(objUiState.legs2 || "").trim().toLowerCase(),
                    tpD: Number(objUiState.tpD2 || 0),
                    slD: Number(objUiState.slD2 || 0),
                    reD: Number(objUiState.reD2 || 0),
                    expiryDate: String(objUiState.expiryDate2 || "").trim()
                }
            }
        );
        const objBuyHedgeGateConfig = getCoveredBuyHedgeSellPremiumGateConfig(objUiState);
        const arrInputsToExecute = isCoveredOptionsStrategy(pStrategyCode) && objBuyHedgeGateConfig.enabled
            ? [...pInputs].sort((pLeft, pRight) => {
                if (pLeft.action === pRight.action) {
                    return 0;
                }
                return pLeft.action === "sell" ? -1 : 1;
            })
            : [...pInputs];
        await resetRecoveryMetrics(pUserId, pStrategyCode);
        for (const objInput of arrInputsToExecute) {
            objLastResult = await executeStrategyPlacement(
                pUserId,
                pStrategyCode,
                pSelectedApiProfileId,
                pProfile,
                objInput,
                {
                    strategyStartedAt: vStrategyStartedAt,
                    skipRecoveryReset: true,
                    skipNeutralityCheck: true
                }
            );
            arrOrders.push(...objLastResult.orders);
            arrContracts.push(...objLastResult.contracts);
        }
        if (!objLastResult) {
            throw new Error("No covered strategy rows were supplied for execution.");
        }

        const objNeutralCheck = await applyServerSideNeutralityCheck(
            pUserId,
            pStrategyCode,
            pSelectedApiProfileId,
            objUiState,
            arrInputsToExecute[0]?.symbol || normalizeSymbolValue(objUiState.symbol),
            objLastResult.trackedOpenPositions,
            null
        );
        if (objNeutralCheck.nextRuntimeState) {
            const objRuntimeAfterExec = await loadRollingFuturesLtRuntime(pUserId, pStrategyCode)
                || getDefaultRollingFuturesLtRuntime(pUserId, pStrategyCode);
            await saveRollingFuturesLtRuntime({
                ...objRuntimeAfterExec,
                userId: pUserId,
                strategyCode: pStrategyCode,
                selectedApiProfileId: pSelectedApiProfileId,
                currentSymbol: arrInputsToExecute[0]?.symbol || normalizeSymbolValue(objUiState.symbol),
                state: {
                    ...((objRuntimeAfterExec.state || {}) as Record<string, unknown>),
                    ...objNeutralCheck.nextRuntimeState
                }
            });
        }
        await syncDualStrategySurvivalState(
            pUserId,
            pStrategyCode,
            pSelectedApiProfileId,
            objNeutralCheck.trackedOpenPositions,
            "active"
        );

        await logFuturesEvent(
            pUserId,
            pStrategyCode,
            "option_opened",
            "success",
            pReason === "admin_exec_strategy" ? "Admin Exec Strategy Started" : "Exec Strategy Started",
            `Exec Strategy placed ${arrOrders.length} option order${arrOrders.length === 1 ? "" : "s"} across ${arrInputsToExecute.length} covered row${arrInputsToExecute.length === 1 ? "" : "s"} using ${objLastResult.profileLabel}.`,
            {
                symbol: arrInputsToExecute[0]?.symbol || "",
                qty: arrInputsToExecute.reduce((pSum, objInput) => pSum + Math.max(0, Number(objInput.qty || 0)), 0),
                rowCount: arrInputsToExecute.length,
                reason: pReason
            }
        );

        return {
            ...objLastResult,
            trackedOpenPositions: objNeutralCheck.trackedOpenPositions,
            orders: arrOrders,
            contracts: arrContracts,
            neutralCheck: {
                mode: objNeutralCheck.mode,
                hedgePlaced: objNeutralCheck.hedgePlaced,
                totalDelta: objNeutralCheck.totalDelta,
                totalTheta: objNeutralCheck.totalTheta,
                threshold: objNeutralCheck.threshold
            }
        };
    }
    catch (objError) {
        await logFuturesEvent(
            pUserId,
            pStrategyCode,
            "engine_error",
            "error",
            pReason === "admin_exec_strategy" ? "Admin Exec Strategy Failed" : "Exec Strategy Failed",
            getErrorMessage(objError, "Unable to execute the live covered strategy."),
            {
                symbol: pInputs[0]?.symbol || "",
                rowCount: pInputs.length,
                reason: pReason === "admin_exec_strategy" ? "admin_exec_strategy_error" : "exec_strategy_error"
            }
        );
        throw objError;
    }
    finally {
        gExecStrategyLocks.delete(vLockKey);
    }
}

async function executePendingDualStrategyRequestByRecord(
    pRequest: {
        requestId: string;
        accountId: string;
        strategyCode: string;
        fullName: string;
        email: string;
        execStrategy: boolean;
        requestPayload: Record<string, unknown>;
    }
): Promise<{
    profileLabel: string;
    trackedOpenPositions: RollingFuturesLtImportedPositionRecord[];
    contracts: Array<Record<string, unknown>>;
    orders: Array<Record<string, unknown>>;
    neutralCheck: {
        mode: "none" | "delta" | "theta" | "gamma";
        hedgePlaced: boolean;
        totalDelta: number;
        totalTheta: number;
        threshold: number | null;
    };
}> {
    const vStrategyCode: RollingFuturesLtStrategyCode = pRequest.strategyCode === "covered-options"
        ? "covered-options"
        : (pRequest.strategyCode === "strangle-options" ? "strangle-options" : "rolling-futures-lt-dual");
    if (!isDualExecStrategyAllowed(vStrategyCode, pRequest.execStrategy)) {
        throw new Error(gExecStrategyUnauthorizedMessage);
    }

    await clearRollingOptionsEventsByStrategy(pRequest.accountId, vStrategyCode);

    const objProfile = await readLiveProfile(pRequest.accountId, vStrategyCode);
    const vSelectedApiProfileId = String(pRequest.requestPayload.selectedApiProfileId || objProfile.selectedApiProfileId || "").trim();
    if (!vSelectedApiProfileId) {
        throw new Error("Select an API profile before executing the live strategy.");
    }

    const objRuntime = await loadRollingFuturesLtRuntime(pRequest.accountId, vStrategyCode);
    if (!objRuntime?.autoTraderEnabled || String(objRuntime.status || "").trim().toLowerCase() !== "running") {
        throw new Error("Turn Auto Trader ON before executing the live strategy.");
    }

    const objLeaseAcquire = await acquireDualStrategyLease(
        pRequest.accountId,
        vStrategyCode,
        objRuntime,
        objProfile,
        vSelectedApiProfileId
    );
    if (!objLeaseAcquire.acquired) {
        const vOwnerLabel = String(objLeaseAcquire.lease?.ownerServerId || "").trim();
        if (vOwnerLabel) {
            throw new Error(`This live strategy is currently owned by ${vOwnerLabel}. Open Pending Strategy Executions on ${vOwnerLabel} to execute it there.`);
        }
        throw new Error(objLeaseAcquire.message || "This live strategy is currently owned by another server.");
    }

    const objCheck = await performRollingFuturesLtConnectionCheck(pRequest.accountId, vStrategyCode, vSelectedApiProfileId);
    if (objCheck.profile.connectionStatus.state !== "connected") {
        throw new Error(objCheck.profile.connectionStatus.message || "Delta connection is not healthy.");
    }

    const objExecInput = normalizeExecStrategyInput(
        String(pRequest.requestPayload.action || ""),
        pRequest.requestPayload.symbol,
        String(pRequest.requestPayload.legSide || ""),
        String(pRequest.requestPayload.expiryMode || "5"),
        pRequest.requestPayload.expiryDate,
        pRequest.requestPayload.qty,
        pRequest.requestPayload.targetDelta
    );
    objExecInput.rowIndex = normalizeOptionRowIndex(vStrategyCode, pRequest.requestPayload.rowIndex);

    const objExecResult = await runExecStrategyPlacement(
        pRequest.accountId,
        vStrategyCode,
        vSelectedApiProfileId,
        objProfile,
        objExecInput,
        "admin_exec_strategy"
    );
    return objExecResult;
}

async function attemptAutoExecuteNextPendingDualStrategyRequest(
    pTriggerReason: "sl" | "tp",
    pSourceUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode
): Promise<void> {
    const objSettings = await getPendingStrategyAutoExecSettings();
    if ((pTriggerReason === "sl" && !objSettings.slEnabled) || (pTriggerReason === "tp" && !objSettings.tpEnabled)) {
        return;
    }

    const arrPendingRequests = (await listPendingStrategyExecutionRequests())
        .filter((objRequest) => objRequest.execStrategy)
        .sort((pLeft, pRight) => {
            return new Date(String(pLeft.createdAt || 0)).getTime() - new Date(String(pRight.createdAt || 0)).getTime();
        });

    let objRequest: (typeof arrPendingRequests)[number] | null = null;
    for (const objCandidate of arrPendingRequests) {
        const [objRuntime, objLease, objSurvival] = await Promise.all([
            loadRollingFuturesLtRuntime(objCandidate.accountId, pStrategyCode),
            getStrategyLease(objCandidate.accountId, pStrategyCode),
            getSurvivalState(objCandidate.accountId, pStrategyCode)
        ]);

        const vLeaseExpiresAtMs = objLease?.leaseExpiresAt ? new Date(objLease.leaseExpiresAt).getTime() : Number.NaN;
        const bRuntimeRunning = Boolean(
            objRuntime?.autoTraderEnabled
            && String(objRuntime.status || "").trim().toLowerCase() === "running"
        );
        const bActiveLease = Boolean(objLease && bRuntimeRunning && Number.isFinite(vLeaseExpiresAtMs) && vLeaseExpiresAtMs > Date.now());
        const vPrimaryOwnerServerId = bActiveLease ? String(objLease?.ownerServerId || "").trim().toLowerCase() : "";
        const bActiveSurvival = String(objSurvival?.runStatus || "").trim().toLowerCase() === "active";
        const vSurvivalOwnerServerId = bActiveSurvival
            ? String(objSurvival?.ownerServerId || "").trim().toLowerCase()
            : "";
        const vEffectiveOwnerServerId = vPrimaryOwnerServerId || vSurvivalOwnerServerId;
        if (!vEffectiveOwnerServerId || vEffectiveOwnerServerId === gServerId) {
            objRequest = objCandidate;
            break;
        }
    }

    if (!objRequest) {
        return;
    }

    try {
        const objExecResult = await executePendingDualStrategyRequestByRecord(objRequest);
        await deletePendingStrategyExecutionRequest(objRequest.requestId);
        await logFuturesEvent(
            objRequest.accountId,
            pStrategyCode,
            "option_opened",
            "success",
            "Auto Executed Pending Strategy",
            `Pending strategy request was auto executed after ${pTriggerReason.toUpperCase()} trigger.`,
            {
                sourceUserId: pSourceUserId,
                requestId: objRequest.requestId,
                triggerReason: pTriggerReason,
                orders: objExecResult.orders.length
            }
        );
    }
    catch (objError) {
        await logFuturesEvent(
            objRequest.accountId,
            pStrategyCode,
            "engine_error",
            "error",
            "Pending Strategy Auto Execution Failed",
            getErrorMessage(objError, "Unable to auto execute pending strategy request."),
            {
                sourceUserId: pSourceUserId,
                requestId: objRequest.requestId,
                triggerReason: pTriggerReason
            }
        );
    }
}

async function queueDualPendingExecStrategyRequest(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pSelectedApiProfileId: string,
    pUiState: Record<string, unknown>,
    pTriggerSource: string,
    pReason: string,
    pAvailableBalance: number | null = null
): Promise<{ created: boolean; message: string; }> {
    const objAccount = await getAccountById(pUserId);
    if (!isDualExecStrategyAllowed(pStrategyCode, objAccount?.execStrategy)) {
        await logFuturesEvent(
            pUserId,
            pStrategyCode,
            "manual_action",
            "warning",
            "Exec Strategy Not Authorised",
            gExecStrategyUnauthorizedMessage,
            { reason: pReason }
        );
        return {
            created: false,
            message: gExecStrategyUnauthorizedMessage
        };
    }

    const objExecInput = normalizeExecStrategyInput(
        String(pUiState.action1 || "sell"),
        pUiState.symbol,
        String(pUiState.legs1 || "ce"),
        String(pUiState.expiryMode1 || "5"),
        pUiState.expiryDate1,
        pUiState.qty1 || 1,
        pUiState.newD1 || 0.53
    );

    try {
        await createPendingStrategyExecutionRequest({
            accountId: pUserId,
            strategyCode: pStrategyCode,
            triggerSource: pTriggerSource,
            requestPayload: {
                selectedApiProfileId: pSelectedApiProfileId,
                action: objExecInput.action,
                symbol: objExecInput.symbol,
                legSide: objExecInput.legSide,
                expiryMode: objExecInput.expiryMode,
                expiryDate: objExecInput.expiryDate,
                qty: objExecInput.qty,
                targetDelta: objExecInput.targetDelta,
                startQty: objExecInput.qty,
                availableBalance: pAvailableBalance
            }
        });

        await logFuturesEvent(
            pUserId,
            pStrategyCode,
            "manual_action",
            "success",
            "Exec Strategy Request Submitted",
            "Exec Strategy request was saved successfully. It will Auto Execute at the right time.",
            {
                symbol: objExecInput.symbol,
                action: objExecInput.action,
                legs: objExecInput.legSide,
                qty: objExecInput.qty,
                targetDelta: objExecInput.targetDelta,
                reason: pReason
            }
        );

        return {
            created: true,
            message: "Exec Strategy request submitted successfully. It will Auto Execute at the right time."
        };
    }
    catch (objError) {
        const vMessage = getErrorMessage(objError, "Unable to queue the live strategy request.");
        if (vMessage === "Strategy Execution is already active.") {
            await logFuturesEvent(
                pUserId,
                pStrategyCode,
                "manual_action",
                "warning",
                "Exec Strategy Request Already Active",
                vMessage,
                { reason: pReason }
            );
            return {
                created: false,
                message: vMessage
            };
        }
        throw objError;
    }
}

function isDualScaledNeutralMode(
    pStrategyCode: RollingFuturesLtStrategyCode,
    pMode: "none" | "delta" | "theta" | "gamma"
): boolean {
    return isDualRollingFuturesStrategy(pStrategyCode) && pMode === "gamma";
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

function getOrderLikeAverageFillPrice(pPayload: Record<string, unknown>): number | null {
    const objResult = (pPayload.result && typeof pPayload.result === "object")
        ? pPayload.result as Record<string, unknown>
        : pPayload;
    const vPrice = toFiniteNumber(objResult.average_fill_price ?? objResult.avg_fill_price ?? objResult.fill_price, Number.NaN);
    return Number.isFinite(vPrice) ? vPrice : null;
}

function getOrderLikeRealizedPnl(pPayload: Record<string, unknown>): number | null {
    const objResult = (pPayload.result && typeof pPayload.result === "object")
        ? pPayload.result as Record<string, unknown>
        : pPayload;
    const objMeta = objResult.meta_data && typeof objResult.meta_data === "object"
        ? objResult.meta_data as Record<string, unknown>
        : {};
    const vPnl = toFiniteNumber(objMeta.pnl ?? objResult.pnl, Number.NaN);
    return Number.isFinite(vPnl) ? vPnl : null;
}

function getOrderLikePaidCommission(pPayload: Record<string, unknown>): number | null {
    const objResult = (pPayload.result && typeof pPayload.result === "object")
        ? pPayload.result as Record<string, unknown>
        : pPayload;
    if (Object.prototype.hasOwnProperty.call(objResult, "paid_commission")) {
        const vCommission = Number(objResult.paid_commission);
        return Number.isFinite(vCommission) ? vCommission : null;
    }
    if (Object.prototype.hasOwnProperty.call(objResult, "commission")) {
        const vCommission = Number(objResult.commission);
        return Number.isFinite(vCommission) ? vCommission : null;
    }
    return null;
}

function getHistoryOrderId(pRow: DeltaOrderHistoryRow): string {
    return String(pRow.order_id ?? pRow.id ?? "").trim();
}

function isCancelledLikeOrderState(pState: string): boolean {
    return ["cancelled", "canceled", "rejected", "expired", "failed"].includes(String(pState || "").trim().toLowerCase());
}

function toFiniteNumber(pValue: unknown, pFallback = 0): number {
    const vNumber = Number(pValue);
    return Number.isFinite(vNumber) ? vNumber : pFallback;
}

function getWalletBalanceRowScore(pRow: DeltaWalletBalanceRow | null): number {
    if (!pRow) {
        return 0;
    }
    const arrValues: unknown[] = [
        pRow.balance,
        pRow.wallet_balance,
        pRow.available_balance,
        pRow.total_margin,
        pRow.blocked_margin,
        pRow.position_margin,
        pRow.order_margin,
        pRow.unrealized_cashflow,
        pRow.unrealised_cashflow,
        pRow.unrealized_pnl,
        pRow.unrealised_pnl
    ];
    return arrValues.reduce<number>((pSum, pValue) => pSum + Math.abs(toFiniteNumber(pValue, 0)), 0);
}

function pickUsdBalanceRow(pRows: DeltaWalletBalanceRow[]): DeltaWalletBalanceRow | null {
    const arrPriority = ["USD", "USDT"];
    const arrPreferred = pRows.filter((pRow) => arrPriority.includes(String(pRow.asset_symbol || pRow.symbol || "").trim().toUpperCase()));
    const arrCandidates = arrPreferred.length ? arrPreferred : pRows;
    return arrCandidates.reduce<DeltaWalletBalanceRow | null>((pBest, pRow) => {
        if (!pBest) {
            return pRow;
        }
        return getWalletBalanceRowScore(pRow) > getWalletBalanceRowScore(pBest) ? pRow : pBest;
    }, null);
}

function getAvailableBalanceUsd(pRow: DeltaWalletBalanceRow | null): number {
    if (!pRow) {
        return 0;
    }
    return toFiniteNumber(pRow.available_balance ?? pRow.wallet_balance ?? pRow.balance, 0);
}

function getUnrealizedCashflowUsd(pRow: DeltaWalletBalanceRow | null): number {
    if (!pRow) {
        return 0;
    }
    return toFiniteNumber(
        pRow.unrealized_cashflow
        ?? pRow.unrealised_cashflow
        ?? pRow.unrealized_pnl
        ?? pRow.unrealised_pnl,
        0
    );
}

function getBlockedMarginUsd(pRow: DeltaWalletBalanceRow | null): number {
    if (!pRow) {
        return 0;
    }
    const vExplicitBlocked = toFiniteNumber(
        pRow.blocked_margin
        ?? pRow.portfolio_margin
        ?? pRow.position_margin
        ?? pRow.order_margin,
        Number.NaN
    );
    if (Number.isFinite(vExplicitBlocked)) {
        return Math.abs(vExplicitBlocked);
    }
    const vBalance = toFiniteNumber(pRow.balance ?? pRow.wallet_balance, 0);
    const vAvailableBalance = getAvailableBalanceUsd(pRow);
    const vUnrealizedCashflow = getUnrealizedCashflowUsd(pRow);
    const vBalanceMinusAvailable = Math.max(0, vBalance - vAvailableBalance);
    const vBalancePlusCashflowMinusAvailable = Math.max(0, (vBalance + vUnrealizedCashflow) - vAvailableBalance);
    return vAvailableBalance > vBalance
        ? vBalancePlusCashflowMinusAvailable
        : vBalanceMinusAvailable;
}

function getBlockedMarginDisplayDetails(pRow: DeltaWalletBalanceRow | null): {
    blockedMargin: number;
    displayBlockedMargin: number;
    hint: string;
} {
    const vBlockedMargin = getBlockedMarginUsd(pRow);
    if (!pRow) {
        return {
            blockedMargin: vBlockedMargin,
            displayBlockedMargin: vBlockedMargin,
            hint: ""
        };
    }

    const vUnrealizedCashflow = Math.max(0, getUnrealizedCashflowUsd(pRow));
    if (vUnrealizedCashflow > 0) {
        return {
            blockedMargin: vBlockedMargin,
            displayBlockedMargin: vBlockedMargin + vUnrealizedCashflow,
            hint: `Blocked ${vBlockedMargin.toFixed(2)} + Unrealized Cashflow ${vUnrealizedCashflow.toFixed(2)}`
        };
    }

    return {
        blockedMargin: vBlockedMargin,
        displayBlockedMargin: vBlockedMargin,
        hint: vBlockedMargin > 0 ? `Blocked ${vBlockedMargin.toFixed(2)}` : ""
    };
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

function normalizeIsoDateOnly(pValue: unknown): string {
    const vValue = String(pValue || "").trim();
    const objMatch = vValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!objMatch) {
        return "";
    }
    const vYear = Number(objMatch[1]);
    const vMonth = Number(objMatch[2]);
    const vDay = Number(objMatch[3]);
    const objDate = new Date(Date.UTC(vYear, vMonth - 1, vDay));
    if (
        objDate.getUTCFullYear() !== vYear
        || (objDate.getUTCMonth() + 1) !== vMonth
        || objDate.getUTCDate() !== vDay
    ) {
        return "";
    }
    return `${String(vYear).padStart(4, "0")}-${String(vMonth).padStart(2, "0")}-${String(vDay).padStart(2, "0")}`;
}

function addDaysToIsoDateValue(pDateValue: string, pDays: number): string {
    const vDateValue = normalizeIsoDateOnly(pDateValue);
    if (!vDateValue) {
        return "";
    }
    const objDate = new Date(`${vDateValue}T00:00:00Z`);
    if (Number.isNaN(objDate.getTime())) {
        return "";
    }
    objDate.setUTCDate(objDate.getUTCDate() + Math.trunc(Number(pDays || 0)));
    return formatIsoDateFromParts(objDate.getUTCFullYear(), objDate.getUTCMonth(), objDate.getUTCDate());
}

function resolveRollingFuturesExpiryDateByModeFromBaseDate(pExpiryMode: string, pBaseDate?: unknown): string {
    const vMode = String(pExpiryMode || "").trim();
    const vBaseDate = normalizeIsoDateOnly(pBaseDate);
    const objDate = vBaseDate
        ? new Date(`${vBaseDate}T00:00:00Z`)
        : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));

    if (vMode === "1") {
        objDate.setUTCDate(objDate.getUTCDate() + 1);
        return formatIsoDateFromParts(objDate.getUTCFullYear(), objDate.getUTCMonth(), objDate.getUTCDate());
    }
    if (vMode === "2") {
        objDate.setUTCDate(objDate.getUTCDate() + 2);
        return formatIsoDateFromParts(objDate.getUTCFullYear(), objDate.getUTCMonth(), objDate.getUTCDate());
    }
    if (vMode === "4") {
        const vWeeklyFridayOffset = (objDate.getUTCDay() >= 3 && objDate.getUTCDay() <= 5) ? 1 : 0;
        const objWeekly = getFutureFridayUtc(objDate, vWeeklyFridayOffset);
        return formatIsoDateFromParts(objWeekly.getUTCFullYear(), objWeekly.getUTCMonth(), objWeekly.getUTCDate());
    }
    if (vMode === "5") {
        const objBiWeeklyCandidate = getFutureFridayUtc(objDate, 1);
        const vDaysToCandidate = getDaysBetweenUtcDates(objDate, objBiWeeklyCandidate);
        const objBiWeekly = vDaysToCandidate <= 10 ? getFutureFridayUtc(objDate, 2) : objBiWeeklyCandidate;
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
        const objSelected = getDaysBetweenUtcDates(objDate, objLastFridayNextMonth) <= 40
            ? objLastFridayThirdMonth
            : objLastFridayNextMonth;
        return formatIsoDateFromParts(objSelected.getUTCFullYear(), objSelected.getUTCMonth(), objSelected.getUTCDate());
    }

    return formatIsoDateFromParts(objDate.getUTCFullYear(), objDate.getUTCMonth(), objDate.getUTCDate());
}

function resolveRollingFuturesExpiryDateByMode(pExpiryMode: string): string {
    return resolveRollingFuturesExpiryDateByModeFromBaseDate(
        pExpiryMode,
        getCurrentDeltaUiDateTimeParts().date
    );
}

function normalizeRollingFuturesExpiryDate(pExpiryMode: string, pExpiryDate: unknown): string {
    const vExplicitExpiryDate = normalizeIsoDateOnly(pExpiryDate);
    return vExplicitExpiryDate || resolveRollingFuturesExpiryDateByMode(pExpiryMode);
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

function getCurrentDeltaUiDateTimeLocalString(): string {
    const vNowUtcMs = Date.now();
    const objUiDate = new Date(vNowUtcMs + (gDeltaUiTimezoneOffsetMinutes * 60 * 1000));
    const vYear = objUiDate.getUTCFullYear();
    const vMonth = String(objUiDate.getUTCMonth() + 1).padStart(2, "0");
    const vDay = String(objUiDate.getUTCDate()).padStart(2, "0");
    const vHour = String(objUiDate.getUTCHours()).padStart(2, "0");
    const vMinute = String(objUiDate.getUTCMinutes()).padStart(2, "0");
    return `${vYear}-${vMonth}-${vDay}T${vHour}:${vMinute}`;
}

function getOptionRowStateKeys(
    pStrategyCode: RollingFuturesLtStrategyCode,
    pRowIndex: unknown
): {
    action: string;
    legs: string;
    expiryMode: string;
    expiryDate: string;
    qty: string;
    newD: string;
    reD: string;
    tpD: string;
    slD: string;
    reEnter: string;
} {
    const vRowIndex = normalizeOptionRowIndex(pStrategyCode, pRowIndex);
    return {
        action: `action${vRowIndex}`,
        legs: `legs${vRowIndex}`,
        expiryMode: `expiryMode${vRowIndex}`,
        expiryDate: `expiryDate${vRowIndex}`,
        qty: `qty${vRowIndex}`,
        newD: `newD${vRowIndex}`,
        reD: `reD${vRowIndex}`,
        tpD: `tpD${vRowIndex}`,
        slD: `slD${vRowIndex}`,
        reEnter: `reEnter${vRowIndex}`
    };
}

function getDefaultOptionRowUiState(
    pStrategyCode: RollingFuturesLtStrategyCode,
    pRowIndex: unknown
): Record<string, unknown> {
    const bIsShort = pStrategyCode === "rolling-futures-lt-short";
    const bIsDual = isDualRollingFuturesStrategy(pStrategyCode);
    const vRowIndex = normalizeOptionRowIndex(pStrategyCode, pRowIndex);
    const objDefaults: Record<string, unknown> = {
        action: "sell",
        legs: bIsDual ? "both" : (bIsShort ? "pe" : "ce"),
        expiryMode: bIsDual ? "6" : "5",
        expiryDate: "",
        qty: "1",
        newD: bIsDual ? "0.25" : "0.53",
        reD: bIsDual ? "0.25" : "0.53",
        tpD: bIsDual ? "0.12" : "0.25",
        slD: bIsDual ? "0.50" : "0.65",
        reEnter: true
    };
    if (isCoveredLikeStrategy(pStrategyCode) && vRowIndex === 1) {
        objDefaults.action = "sell";
        objDefaults.expiryMode = "6";
        objDefaults.newD = "0.33";
        objDefaults.reD = "0.33";
        objDefaults.tpD = "0.10";
        objDefaults.slD = "0.50";
    }
    if (isCoveredLikeStrategy(pStrategyCode) && vRowIndex === 2) {
        objDefaults.action = "buy";
        objDefaults.expiryMode = "1";
        objDefaults.newD = "0.13";
        objDefaults.reD = "0.13";
        objDefaults.tpD = "1.00";
        objDefaults.slD = "0.05";
    }
    if (isStrangleOptionsStrategy(pStrategyCode)) {
        objDefaults.action = "sell";
        objDefaults.legs = vRowIndex === 1 ? "ce" : "pe";
        objDefaults.expiryMode = "6";
        objDefaults.newD = "0.33";
        objDefaults.tpD = "0.10";
        objDefaults.slD = "0.55";
        objDefaults.reD = objDefaults.newD;
    }
    return objDefaults;
}

function getNormalizedOptionRowUiState(
    pUiState: Record<string, unknown>,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pRowIndex: unknown
): {
    rowIndex: 1 | 2;
    action: "buy" | "sell";
    legs: "ce" | "pe" | "both";
    expiryMode: string;
    expiryDate: string;
    qty: string;
    newD: string;
    reD: string;
    tpD: string;
    slD: string;
    reEnter: boolean;
} {
    const vRowIndex = normalizeOptionRowIndex(pStrategyCode, pRowIndex);
    const objKeys = getOptionRowStateKeys(pStrategyCode, vRowIndex);
    const objDefaults = getDefaultOptionRowUiState(pStrategyCode, vRowIndex);
    const vExpiryMode = normalizeStringValue(pUiState[objKeys.expiryMode], String(objDefaults.expiryMode));
    return {
        rowIndex: vRowIndex,
        action: String(pUiState[objKeys.action] || objDefaults.action).trim().toLowerCase() === "buy" ? "buy" : "sell",
        legs: normalizeRollingFuturesLegSelection(pUiState[objKeys.legs], String(objDefaults.legs || "ce")),
        expiryMode: vExpiryMode,
        expiryDate: normalizeRollingFuturesExpiryDate(vExpiryMode, pUiState[objKeys.expiryDate]),
        qty: normalizeStringValue(pUiState[objKeys.qty], String(objDefaults.qty)),
        newD: normalizeStringValue(pUiState[objKeys.newD], String(objDefaults.newD)),
        reD: isStrangleOptionsStrategy(pStrategyCode)
            ? normalizeStringValue(pUiState[objKeys.newD], String(objDefaults.newD))
            : normalizeStringValue(pUiState[objKeys.reD], String(objDefaults.reD)),
        tpD: normalizeStringValue(pUiState[objKeys.tpD], String(objDefaults.tpD)),
        slD: normalizeStringValue(pUiState[objKeys.slD], String(objDefaults.slD)),
        reEnter: normalizeBooleanValue(pUiState[objKeys.reEnter], Boolean(objDefaults.reEnter))
    };
}

function resolveCoveredTrackedPositionRowIndex(
    pUiState: Record<string, unknown>,
    pPosition: Pick<RollingFuturesLtImportedPositionRecord, "side">,
    pPreferredRowIndex?: unknown
): 1 | 2 {
    const vPositionAction = String(pPosition.side || "").trim().toLowerCase() === "buy" ? "buy" : "sell";
    const arrActionMatchedRows = ([1, 2] as const).filter((vRowIndex) => {
        return getNormalizedOptionRowUiState(pUiState, "covered-options", vRowIndex).action === vPositionAction;
    });
    if (arrActionMatchedRows.length === 1) {
        return arrActionMatchedRows[0];
    }
    if (pPreferredRowIndex === 1 || pPreferredRowIndex === 2) {
        return pPreferredRowIndex;
    }
    return vPositionAction === "sell" ? 2 : 1;
}

function formatDeltaUiDateTimeLocalString(pValue: string): string {
    const vEpochMs = new Date(String(pValue || "")).getTime();
    if (!Number.isFinite(vEpochMs)) {
        return getCurrentDeltaUiDateTimeLocalString();
    }
    const objUiDate = new Date(vEpochMs + (gDeltaUiTimezoneOffsetMinutes * 60 * 1000));
    const vYear = objUiDate.getUTCFullYear();
    const vMonth = String(objUiDate.getUTCMonth() + 1).padStart(2, "0");
    const vDay = String(objUiDate.getUTCDate()).padStart(2, "0");
    const vHour = String(objUiDate.getUTCHours()).padStart(2, "0");
    const vMinute = String(objUiDate.getUTCMinutes()).padStart(2, "0");
    return `${vYear}-${vMonth}-${vDay}T${vHour}:${vMinute}`;
}

function parseDeltaUiDateTimeLocalToIsoString(pValue: string): string {
    const vEpochMicros = toEpochMicros(String(pValue || "").trim());
    if (!vEpochMicros) {
        return "";
    }
    const vEpochMs = Math.floor(vEpochMicros / 1000);
    const objDate = new Date(vEpochMs);
    return Number.isFinite(objDate.getTime()) ? objDate.toISOString() : "";
}

function getDefaultManualTraderUiState(
    pStrategyCode: RollingFuturesLtStrategyCode
): Record<string, unknown> {
    const bIsShort = pStrategyCode === "rolling-futures-lt-short";
    const bIsDual = isDualRollingFuturesStrategy(pStrategyCode);
    const objState: Record<string, unknown> = {
        startQty: isStrangleOptionsStrategy(pStrategyCode) ? "1" : "2",
        symbol: "BTC",
        manualFutOrderType: "market_order",
        bsFutQty: "1",
        minusDelta: bIsDual ? "-10" : "-25",
        plusDelta: bIsDual ? "10" : "25",
        onlyDeltaNeutral: false,
        rangeDeltaNeutral: false,
        gammaAwareNeutral: false,
        closeNetProfitBrokerage: false,
        brokerageMultiplier: isStrangleOptionsStrategy(pStrategyCode) ? "5" : "10",
        reEnterBrok: bIsDual,
        closeBlockedMargin: false,
        blockedMarginPct: isStrangleOptionsStrategy(pStrategyCode) ? "10" : "20",
        reEnterBlock: bIsDual,
        buyHedgeSellPremiumGate: isCoveredLikeStrategy(pStrategyCode),
        buyHedgeSellPremiumPct: "2",
        strangleDeltaDiffReplaceEnabled: isStrangleOptionsStrategy(pStrategyCode),
        strangleDeltaDiffReplacePct: isStrangleOptionsStrategy(pStrategyCode) ? "40" : "50",
        buyHedgeOppositeLegOnGate: false,
        buyQtyPercentEnabled: false,
        buyQtyPercent: "100",
        strangleReopenAtNewD: false,
        autoConfirmLiveActions: isCoveredLikeStrategy(pStrategyCode),
        telegramAlertTypes: getDefaultTelegramAlertTypesForStrategy(pStrategyCode),
        closedFromDate: "",
        closedToDate: ""
    };
    [1, ...(isCoveredLikeStrategy(pStrategyCode) ? [2] : [])].forEach((vRowIndex) => {
        const objKeys = getOptionRowStateKeys(pStrategyCode, vRowIndex);
        const objDefaults = getDefaultOptionRowUiState(pStrategyCode, vRowIndex);
        objState[objKeys.action] = objDefaults.action;
        objState[objKeys.legs] = objDefaults.legs;
        objState[objKeys.expiryMode] = objDefaults.expiryMode;
        objState[objKeys.expiryDate] = objDefaults.expiryDate;
        objState[objKeys.qty] = objDefaults.qty;
        objState[objKeys.newD] = objDefaults.newD;
        objState[objKeys.reD] = objDefaults.reD;
        objState[objKeys.tpD] = objDefaults.tpD;
        objState[objKeys.slD] = objDefaults.slD;
        objState[objKeys.reEnter] = objDefaults.reEnter;
    });
    return objState;
}

function isFutureContractSymbol(pValue: unknown): boolean {
    const vSymbol = String(pValue || "").trim().toUpperCase();
    return Boolean(vSymbol) && !inferTrackedOptionLegSide(vSymbol);
}

function isOptionContractSymbol(pValue: unknown): boolean {
    return Boolean(inferTrackedOptionLegSide(pValue));
}

function inferTrackedOptionLegSide(pContractName: unknown): "ce" | "pe" | "" {
    const vSymbol = String(pContractName || "").trim().toUpperCase();
    if (!vSymbol) {
        return "";
    }
    if (vSymbol.startsWith("P-") || vSymbol.includes("-P-") || vSymbol.endsWith("-P") || vSymbol.includes("PUT")) {
        return "pe";
    }
    if (vSymbol.startsWith("C-") || vSymbol.includes("-C-") || vSymbol.endsWith("-C") || vSymbol.includes("CALL")) {
        return "ce";
    }
    return "";
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
        || (isOptionContractSymbol(vContract) && (
            vContract.startsWith(`C-${vSymbol}-`)
            || vContract.startsWith(`P-${vSymbol}-`)
            || vContract.startsWith(`${vSymbol}-`)
        ));
}

function getTrackedOptionMetadata(pPosition: RollingFuturesLtImportedPositionRecord): RollingFuturesLtOptionMetadata {
    return pPosition.metadata && typeof pPosition.metadata === "object"
        ? pPosition.metadata as RollingFuturesLtOptionMetadata
        : {};
}

function inferCoveredOptionRowIndexFromUiState(
    pUiState: Record<string, unknown>,
    pSide: unknown,
    pLegSide: "ce" | "pe"
): 1 | 2 {
    const vAction = String(pSide || "").trim().toLowerCase() === "buy" ? "buy" : "sell";
    const arrRows = ([1, 2] as const).map((pRowIndex) => {
        const objRowState = getNormalizedOptionRowUiState(pUiState, "covered-options", pRowIndex);
        return {
            rowIndex: pRowIndex,
            matchesAction: objRowState.action === vAction,
            matchesLeg: objRowState.legs === "both" || objRowState.legs === pLegSide
        };
    });
    const objActionAndLegMatch = arrRows.find((objRow) => objRow.matchesAction && objRow.matchesLeg);
    if (objActionAndLegMatch) {
        return objActionAndLegMatch.rowIndex;
    }
    const arrActionMatches = arrRows.filter((objRow) => objRow.matchesAction);
    if (arrActionMatches.length === 1) {
        return arrActionMatches[0].rowIndex;
    }
    const arrLegMatches = arrRows.filter((objRow) => objRow.matchesLeg);
    if (arrLegMatches.length === 1) {
        return arrLegMatches[0].rowIndex;
    }
    return 1;
}

function getTrackedOptionRowIndexForUi(
    pPosition: RollingFuturesLtImportedPositionRecord,
    pUiState?: Record<string, unknown> | null
): 1 | 2 {
    const objMetadata = getTrackedOptionMetadata(pPosition);
    const vStoredRowIndex = normalizeOptionRowIndex(pPosition.strategyCode, objMetadata.rowIndex);
    if (!isCoveredLikeStrategy(pPosition.strategyCode)) {
        return vStoredRowIndex;
    }
    if (!Boolean(objMetadata.importedObservationOnly) && (Number(objMetadata.rowIndex) === 1 || Number(objMetadata.rowIndex) === 2)) {
        return vStoredRowIndex;
    }
    if (pUiState && typeof pUiState === "object") {
        return inferCoveredOptionRowIndexFromUiState(
            pUiState,
            pPosition.side,
            getTrackedOptionLegSide(pPosition.contractName)
        );
    }
    return vStoredRowIndex;
}

function hasTrackedOptionRowLeg(
    pTrackedPositions: RollingFuturesLtImportedPositionRecord[],
    pRowIndex: 1 | 2,
    pLegSide: "ce" | "pe",
    pUiState?: Record<string, unknown> | null
): boolean {
    return listTrackedOpenOptionPositions(pTrackedPositions).some((objPosition) => {
        return getTrackedOptionRowIndexForUi(objPosition, pUiState) === pRowIndex
            && getTrackedOptionLegSide(objPosition.contractName) === pLegSide;
    });
}

function getTrackedOptionRowLegTotalQty(
    pTrackedPositions: RollingFuturesLtImportedPositionRecord[],
    pRowIndex: 1 | 2,
    pLegSide: "ce" | "pe",
    pUiState?: Record<string, unknown> | null
): number {
    return listTrackedOpenOptionPositions(pTrackedPositions).reduce((pSum, objPosition) => {
        const bMatchesRowLeg = getTrackedOptionRowIndexForUi(objPosition, pUiState) === pRowIndex
            && getTrackedOptionLegSide(objPosition.contractName) === pLegSide;
        if (!bMatchesRowLeg) {
            return pSum;
        }
        return pSum + Math.max(0, Math.floor(Number(objPosition.qty || 0)));
    }, 0);
}

function getCoveredBuyHedgeSellPremiumGateConfig(
    pUiState: Record<string, unknown>
): {
    enabled: boolean;
    thresholdPct: number;
    minimumSellPremiumRatio: number;
} {
    const vThresholdPctRaw = Number(pUiState.buyHedgeSellPremiumPct ?? 2);
    const vThresholdPct = Number.isFinite(vThresholdPctRaw)
        ? Math.min(100, Math.max(0, vThresholdPctRaw))
        : 2;
    return {
        enabled: normalizeBooleanValue(pUiState.buyHedgeSellPremiumGate, false),
        thresholdPct: vThresholdPct,
        minimumSellPremiumRatio: Math.max(0, 1 - (vThresholdPct / 100))
    };
}

function isCoveredBuyHedgeOppositeLegEnabled(
    pStrategyCode: RollingFuturesLtStrategyCode,
    pUiState: Record<string, unknown>
): boolean {
    if (pStrategyCode !== "covered-options") {
        return false;
    }
    return normalizeBooleanValue(pUiState.buyHedgeOppositeLegOnGate, false);
}

function resolveCoveredBuyHedgeTargetLegSide(
    pStrategyCode: RollingFuturesLtStrategyCode,
    pTrackedPositions: RollingFuturesLtImportedPositionRecord[],
    pUiState: Record<string, unknown>,
    pRowIndex: 1 | 2,
    pRequestedLegSide: "ce" | "pe"
): "ce" | "pe" | null {
    if (!isCoveredBuyHedgeOppositeLegEnabled(pStrategyCode, pUiState)) {
        return pRequestedLegSide;
    }
    const vOppositeLegSide = pRequestedLegSide === "ce" ? "pe" : "ce";
    if (hasTrackedOptionRowLeg(pTrackedPositions, pRowIndex, vOppositeLegSide, pUiState)) {
        return null;
    }
    return vOppositeLegSide;
}

function isStrangleReopenAtNewDEnabled(
    pStrategyCode: RollingFuturesLtStrategyCode,
    pUiState: Record<string, unknown>
): boolean {
    if (!isStrangleOptionsStrategy(pStrategyCode)) {
        return false;
    }
    return normalizeBooleanValue(pUiState.strangleReopenAtNewD, false);
}

function getStrangleDeltaDiffReplaceConfig(
    pStrategyCode: RollingFuturesLtStrategyCode,
    pUiState: Record<string, unknown>
): {
    enabled: boolean;
    thresholdPct: number;
} {
    if (!isStrangleOptionsStrategy(pStrategyCode)) {
        return {
            enabled: false,
            thresholdPct: 50
        };
    }
    const vThresholdPctRaw = Number(pUiState.strangleDeltaDiffReplacePct ?? 50);
    return {
        enabled: normalizeBooleanValue(pUiState.strangleDeltaDiffReplaceEnabled, false),
        thresholdPct: Number.isFinite(vThresholdPctRaw)
            ? Math.min(100, Math.max(0, vThresholdPctRaw))
            : 50
    };
}

async function resolveStrangleReEntryTargetDelta(
    pStrategyCode: RollingFuturesLtStrategyCode,
    pUiState: Record<string, unknown>,
    pClosedPosition: RollingFuturesLtImportedPositionRecord,
    pRemainingTrackedPositions: RollingFuturesLtImportedPositionRecord[],
    pRowIndex: 1 | 2
): Promise<number | null> {
    const objRowState = getNormalizedOptionRowUiState(pUiState, pStrategyCode, pRowIndex);
    if (isStrangleReopenAtNewDEnabled(pStrategyCode, pUiState)) {
        const vNewD = Math.max(0, Number(objRowState.newD || 0));
        return vNewD > 0 ? vNewD : null;
    }

    const vClosedLegSide = getTrackedOptionLegSide(pClosedPosition.contractName);
    const objOtherOpenLeg = pRemainingTrackedPositions.find((objPosition) => {
        return objPosition.importId !== pClosedPosition.importId
            && isOptionContractSymbol(objPosition.contractName)
            && getTrackedOptionLegSide(objPosition.contractName) !== vClosedLegSide;
    });
    if (!objOtherOpenLeg) {
        return null;
    }

    const objTicker = await getLiveOptionTicker(String(objOtherOpenLeg.contractName || "").trim());
    const vCurrentDelta = Math.abs(Number(objTicker?.delta || 0));
    return Number.isFinite(vCurrentDelta) && vCurrentDelta > 0 ? vCurrentDelta : null;
}

async function findStrangleDeltaDiffReplacementTrigger(
    pStrategyCode: RollingFuturesLtStrategyCode,
    pTrackedPositions: RollingFuturesLtImportedPositionRecord[],
    pUiState: Record<string, unknown>
): Promise<null | {
    position: RollingFuturesLtImportedPositionRecord;
    currentDelta: number;
    currentMarkPrice: number | null;
    replacementTargetDelta: number;
    strongerContractName: string;
    strongerDelta: number;
    weakerDelta: number;
    deltaDiffPct: number;
    thresholdPct: number;
}> {
    const objConfig = getStrangleDeltaDiffReplaceConfig(pStrategyCode, pUiState);
    if (!objConfig.enabled) {
        return null;
    }
    const arrSellOptions = (Array.isArray(pTrackedPositions) ? pTrackedPositions : []).filter((objPosition) => {
        return isOptionContractSymbol(objPosition.contractName)
            && String(objPosition.side || "").trim().toUpperCase() === "SELL";
    });
    if (arrSellOptions.length !== 2) {
        return null;
    }
    const vFirstLegSide = getTrackedOptionLegSide(arrSellOptions[0].contractName);
    const vSecondLegSide = getTrackedOptionLegSide(arrSellOptions[1].contractName);
    if (vFirstLegSide === vSecondLegSide) {
        return null;
    }
    const arrLiveLegs = await Promise.all(arrSellOptions.map(async (objPosition) => {
        const objTicker = await getLiveOptionTicker(String(objPosition.contractName || "").trim());
        const vCurrentDelta = Math.abs(Number(objTicker?.delta));
        return {
            position: objPosition,
            currentDelta: vCurrentDelta,
            currentMarkPrice: Number.isFinite(Number(objTicker?.markPrice)) ? Number(objTicker?.markPrice) : null
        };
    }));
    const arrValidLiveLegs = arrLiveLegs.filter((objLeg) => Number.isFinite(objLeg.currentDelta) && objLeg.currentDelta > 0);
    if (arrValidLiveLegs.length !== 2) {
        return null;
    }
    const [objWeakerLeg, objStrongerLeg] = arrValidLiveLegs.sort((pLeft, pRight) => pLeft.currentDelta - pRight.currentDelta);
    const vTotalLiveDelta = objWeakerLeg.currentDelta + objStrongerLeg.currentDelta;
    if (!(vTotalLiveDelta > 0)) {
        return null;
    }
    const vDeltaDiffPct = ((objStrongerLeg.currentDelta - objWeakerLeg.currentDelta) / vTotalLiveDelta) * 100;
    if (!(vDeltaDiffPct > objConfig.thresholdPct)) {
        return null;
    }
    return {
        position: objWeakerLeg.position,
        currentDelta: objWeakerLeg.currentDelta,
        currentMarkPrice: objWeakerLeg.currentMarkPrice,
        replacementTargetDelta: objStrongerLeg.currentDelta,
        strongerContractName: objStrongerLeg.position.contractName,
        strongerDelta: objStrongerLeg.currentDelta,
        weakerDelta: objWeakerLeg.currentDelta,
        deltaDiffPct: Number(vDeltaDiffPct.toFixed(4)),
        thresholdPct: objConfig.thresholdPct
    };
}

function getMatchingCoveredSellLegForBuyHedge(
    pTrackedPositions: RollingFuturesLtImportedPositionRecord[],
    pLegSide: "ce" | "pe"
): RollingFuturesLtImportedPositionRecord | null {
    const arrMatching = listTrackedOpenOptionPositions(pTrackedPositions).filter((objPosition) => {
        return String(objPosition.side || "").trim().toUpperCase() === "SELL"
            && getTrackedOptionLegSide(objPosition.contractName) === pLegSide;
    });
    if (!arrMatching.length) {
        return null;
    }
    return [...arrMatching].sort((pLeft, pRight) => {
        return new Date(String(pRight.openedAt || pRight.updatedAt || "")).getTime()
            - new Date(String(pLeft.openedAt || pLeft.updatedAt || "")).getTime();
    })[0] || null;
}

function isCoveredSellLegNegativeForBuyHedge(
    pTrackedPositions: RollingFuturesLtImportedPositionRecord[],
    pLegSide: "ce" | "pe"
): {
    negative: boolean;
    matchingSellPosition: RollingFuturesLtImportedPositionRecord | null;
    message: string;
} {
    const objSellPosition = getMatchingCoveredSellLegForBuyHedge(pTrackedPositions, pLegSide);
    if (!objSellPosition) {
        return {
            negative: false,
            matchingSellPosition: null,
            message: `No matching ${pLegSide.toUpperCase()} sell leg is open for buy hedge trigger.`
        };
    }
    const vPnl = Number(objSellPosition.pnl || 0);
    const bNegative = Number.isFinite(vPnl) && vPnl < 0;
    return {
        negative: bNegative,
        matchingSellPosition: objSellPosition,
        message: bNegative
            ? ""
            : `Matching ${pLegSide.toUpperCase()} sell leg is not in loss yet, so the buy hedge trigger stays idle.`
    };
}

function evaluateCoveredBuyHedgeSellPremiumGate(
    pTrackedPositions: RollingFuturesLtImportedPositionRecord[],
    pUiState: Record<string, unknown>,
    pLegSide: "ce" | "pe"
): {
    enabled: boolean;
    allowed: boolean;
    thresholdPct: number;
    currentSellPremium: number;
    soldSellPremium: number;
    minimumRequiredPremium: number;
    matchingSellPosition: RollingFuturesLtImportedPositionRecord | null;
    message: string;
} {
    const objConfig = getCoveredBuyHedgeSellPremiumGateConfig(pUiState);
    if (!objConfig.enabled) {
        return {
            enabled: false,
            allowed: true,
            thresholdPct: objConfig.thresholdPct,
            currentSellPremium: 0,
            soldSellPremium: 0,
            minimumRequiredPremium: 0,
            matchingSellPosition: null,
            message: ""
        };
    }
    const objSellPosition = getMatchingCoveredSellLegForBuyHedge(pTrackedPositions, pLegSide);
    if (!objSellPosition) {
        return {
            enabled: true,
            allowed: false,
            thresholdPct: objConfig.thresholdPct,
            currentSellPremium: 0,
            soldSellPremium: 0,
            minimumRequiredPremium: 0,
            matchingSellPosition: null,
            message: `No matching ${pLegSide.toUpperCase()} sell leg is open for premium-gated buy hedge entry.`
        };
    }
    const vSoldSellPremium = Number(objSellPosition.entryPrice || 0);
    const vCurrentSellPremium = Number(objSellPosition.markPrice || objSellPosition.entryPrice || 0);
    const vMinimumRequiredPremium = Number((vSoldSellPremium * objConfig.minimumSellPremiumRatio).toFixed(8));
    if (!(vSoldSellPremium > 0) || !(vCurrentSellPremium > 0)) {
        return {
            enabled: true,
            allowed: false,
            thresholdPct: objConfig.thresholdPct,
            currentSellPremium: vCurrentSellPremium,
            soldSellPremium: vSoldSellPremium,
            minimumRequiredPremium: vMinimumRequiredPremium,
            matchingSellPosition: objSellPosition,
            message: `Matching ${pLegSide.toUpperCase()} sell premium is unavailable for premium-gated buy hedge entry.`
        };
    }
    const bAllowed = vCurrentSellPremium >= vMinimumRequiredPremium;
    return {
        enabled: true,
        allowed: bAllowed,
        thresholdPct: objConfig.thresholdPct,
        currentSellPremium: vCurrentSellPremium,
        soldSellPremium: vSoldSellPremium,
        minimumRequiredPremium: vMinimumRequiredPremium,
        matchingSellPosition: objSellPosition,
        message: bAllowed
            ? ""
            : `Matching ${pLegSide.toUpperCase()} sell premium ${vCurrentSellPremium.toFixed(2)} is below the ${objConfig.thresholdPct.toFixed(2)}% threshold of sold premium ${vSoldSellPremium.toFixed(2)}. Minimum required is ${vMinimumRequiredPremium.toFixed(2)}.`
    };
}

function getCoveredBuyHedgeOpenReasonText(
    pOpenedReason: RollingFuturesLtOptionMetadata["openedReason"] | string,
    pLegSide: "ce" | "pe",
    pOptions?: {
        thresholdPct?: number;
    }
): string {
    const vThresholdText = Number.isFinite(Number(pOptions?.thresholdPct))
        ? ` Matching ${pLegSide.toUpperCase()} sell premium stayed within the configured ${Number(pOptions?.thresholdPct).toFixed(2)}% threshold.`
        : "";
    const vReason = String(pOpenedReason || "").trim().toLowerCase();
    if (vReason === "strategy_option_open") {
        return `Buy hedge opened during Exec Strategy for ${pLegSide.toUpperCase()}.${vThresholdText}`;
    }
    if (vReason === "manual_option_open") {
        return `Buy hedge opened manually for ${pLegSide.toUpperCase()}.${vThresholdText}`;
    }
    if (vReason === "sl_reentry") {
        return `Buy hedge reopened for ${pLegSide.toUpperCase()} after SL recovery.${vThresholdText}`;
    }
    if (vReason === "tp_reentry") {
        return `Buy hedge reopened for ${pLegSide.toUpperCase()} after TP recovery.${vThresholdText}`;
    }
    if (vReason === "expiry_cutoff_reentry") {
        return `Buy hedge reopened for ${pLegSide.toUpperCase()} after expiry-day replacement.${vThresholdText}`;
    }
    if (vReason === "missing_leg") {
        return `Buy hedge reopened for missing ${pLegSide.toUpperCase()} leg.${vThresholdText}`;
    }
    return `Buy hedge opened for ${pLegSide.toUpperCase()}.${vThresholdText}`;
}

function getTrackedFutureRealizedPnl(pPosition: RollingFuturesLtImportedPositionRecord): number {
    if (!isFutureContractSymbol(pPosition.contractName)) {
        return 0;
    }
    const objMetadata = pPosition.metadata && typeof pPosition.metadata === "object"
        ? pPosition.metadata as Record<string, unknown>
        : {};
    const vRealizedPnl = Number(objMetadata.realizedPnl || 0);
    return Number.isFinite(vRealizedPnl) ? Number(vRealizedPnl.toFixed(4)) : 0;
}

function getTrackedFutureUnrealizedPnl(pPosition: RollingFuturesLtImportedPositionRecord): number {
    if (!isFutureContractSymbol(pPosition.contractName)) {
        return 0;
    }
    const objMetadata = pPosition.metadata && typeof pPosition.metadata === "object"
        ? pPosition.metadata as Record<string, unknown>
        : {};
    const vUnrealizedPnl = Number(objMetadata.unrealizedPnl || 0);
    return Number.isFinite(vUnrealizedPnl) ? Number(vUnrealizedPnl.toFixed(4)) : 0;
}

function getSignedOptionBaseDelta(pContractName: unknown, pDeltaValue: unknown): number {
    const vMagnitude = Math.abs(Number(pDeltaValue || 0));
    if (!Number.isFinite(vMagnitude) || !(vMagnitude > 0)) {
        return 0;
    }
    return inferTrackedOptionLegSide(pContractName) === "pe" ? -vMagnitude : vMagnitude;
}

function optionMetadataToRecord(pMetadata: RollingFuturesLtOptionMetadata): Record<string, unknown> {
    return {
        rowIndex: pMetadata.rowIndex,
        baseDelta: pMetadata.baseDelta,
        baseTheta: pMetadata.baseTheta,
        manualTraderDelta: pMetadata.manualTraderDelta,
        takeProfitDelta: pMetadata.takeProfitDelta,
        stopLossDelta: pMetadata.stopLossDelta,
        reEntryDelta: pMetadata.reEntryDelta,
        reEnterEnabled: pMetadata.reEnterEnabled,
        openedReason: pMetadata.openedReason,
        requestedExpiryDate: normalizeIsoDateOnly(pMetadata.requestedExpiryDate),
        resolvedExpiryDate: normalizeIsoDateOnly(pMetadata.resolvedExpiryDate),
        importedObservationOnly: Boolean(pMetadata.importedObservationOnly),
        importedAt: String(pMetadata.importedAt || "").trim()
    };
}

function markPositionsAsImportedObservationOnly(
    pPositions: RollingFuturesLtImportedPositionRecord[],
    pUiState: Record<string, unknown>
): RollingFuturesLtImportedPositionRecord[] {
    const vImportedAtIso = new Date().toISOString();
    return pPositions.map((objPosition) => {
        const objMetadata = objPosition.metadata && typeof objPosition.metadata === "object"
            ? objPosition.metadata as Record<string, unknown>
            : {};
        if (isOptionContractSymbol(objPosition.contractName)) {
            const vRowIndex = isCoveredLikeStrategy(objPosition.strategyCode)
                ? getTrackedOptionRowIndexForUi(objPosition, pUiState)
                : normalizeOptionRowIndex(objPosition.strategyCode, objMetadata.rowIndex);
            const objRowState = getNormalizedOptionRowUiState(pUiState, objPosition.strategyCode, vRowIndex);
            return {
                ...objPosition,
                metadata: optionMetadataToRecord({
                    ...getTrackedOptionMetadata(objPosition),
                    rowIndex: vRowIndex,
                    manualTraderDelta: getSignedOptionBaseDelta(objPosition.contractName, Number(objRowState.newD || 0)),
                    takeProfitDelta: Number(objRowState.tpD || 0),
                    stopLossDelta: Number(objRowState.slD || 0),
                    reEntryDelta: Number(objRowState.reD || 0),
                    reEnterEnabled: Boolean(objRowState.reEnter),
                    importedObservationOnly: true,
                    importedAt: String(objMetadata.importedAt || vImportedAtIso).trim() || vImportedAtIso
                })
            };
        }
        return {
            ...objPosition,
            metadata: {
                ...objMetadata,
                importedObservationOnly: true,
                importedAt: String(objMetadata.importedAt || vImportedAtIso).trim() || vImportedAtIso
            }
        };
    });
}

function parseOptionExpiryDateFromContractName(pContractName: unknown): string {
    const vContractName = String(pContractName || "").trim().toUpperCase();
    const objMatch = vContractName.match(/-(\d{2})(\d{2})(\d{2})$/);
    if (!objMatch) {
        return "";
    }
    const vDay = Number(objMatch[1]);
    const vMonth = Number(objMatch[2]);
    const vYear = 2000 + Number(objMatch[3]);
    const objDate = new Date(Date.UTC(vYear, vMonth - 1, vDay));
    if (
        objDate.getUTCFullYear() !== vYear
        || (objDate.getUTCMonth() + 1) !== vMonth
        || objDate.getUTCDate() !== vDay
    ) {
        return "";
    }
    return formatIsoDateFromParts(objDate.getUTCFullYear(), objDate.getUTCMonth(), objDate.getUTCDate());
}

function getTrackedOptionResolvedExpiryDate(pPosition: RollingFuturesLtImportedPositionRecord): string {
    const objMetadata = getTrackedOptionMetadata(pPosition);
    const vResolvedExpiryDate = normalizeIsoDateOnly(objMetadata.resolvedExpiryDate || objMetadata.requestedExpiryDate);
    if (vResolvedExpiryDate) {
        return vResolvedExpiryDate;
    }
    return parseOptionExpiryDateFromContractName(pPosition.contractName);
}

function getCurrentDeltaUiDateTimeParts(): { date: string; hour: number; minute: number; } {
    const vNowUtcMs = Date.now();
    const objUiDate = new Date(vNowUtcMs + (gDeltaUiTimezoneOffsetMinutes * 60 * 1000));
    return {
        date: formatIsoDateFromParts(objUiDate.getUTCFullYear(), objUiDate.getUTCMonth(), objUiDate.getUTCDate()),
        hour: objUiDate.getUTCHours(),
        minute: objUiDate.getUTCMinutes()
    };
}

function isDeltaUiTimeAtOrAfter(pHour: number, pMinute = 0): boolean {
    const objCurrent = getCurrentDeltaUiDateTimeParts();
    return objCurrent.hour > pHour || (objCurrent.hour === pHour && objCurrent.minute >= pMinute);
}

function resolveCoveredCutoffReEntryExpiryDate(pExpiryMode: string, pCurrentExpiryDate: string): string {
    const vCurrentExpiryDate = normalizeIsoDateOnly(pCurrentExpiryDate);
    if (!vCurrentExpiryDate) {
        return resolveRollingFuturesExpiryDateByMode(pExpiryMode);
    }
    let vNextExpiryDate = resolveRollingFuturesExpiryDateByModeFromBaseDate(pExpiryMode, vCurrentExpiryDate);
    if (!vNextExpiryDate || vNextExpiryDate <= vCurrentExpiryDate) {
        vNextExpiryDate = resolveRollingFuturesExpiryDateByModeFromBaseDate(
            pExpiryMode,
            addDaysToIsoDateValue(vCurrentExpiryDate, 1)
        );
    }
    return vNextExpiryDate || addDaysToIsoDateValue(vCurrentExpiryDate, 1) || vCurrentExpiryDate;
}

function hasMissingTrackedOptionBaseGreeks(pPosition: RollingFuturesLtImportedPositionRecord): boolean {
    if (!isOptionContractSymbol(pPosition.contractName)) {
        return false;
    }
    const objMetadata = getTrackedOptionMetadata(pPosition);
    return !(Math.abs(Number(objMetadata.baseDelta)) > 0) || !Number.isFinite(Number(objMetadata.baseTheta));
}

function normalizeTrackedOptionBaseDeltaSigns(
    pPositions: RollingFuturesLtImportedPositionRecord[]
): {
    positions: RollingFuturesLtImportedPositionRecord[];
    changed: boolean;
} {
    let bChanged = false;
    const arrNormalized = pPositions.map((objPosition) => {
        if (!isOptionContractSymbol(objPosition.contractName)) {
            return objPosition;
        }
        const objMetadata = getTrackedOptionMetadata(objPosition);
        const vCurrentBaseDelta = Number(objMetadata.baseDelta || 0);
        if (!Number.isFinite(vCurrentBaseDelta) || !(Math.abs(vCurrentBaseDelta) > 0)) {
            return objPosition;
        }
        const vSignedBaseDelta = getSignedOptionBaseDelta(objPosition.contractName, vCurrentBaseDelta);
        if (vSignedBaseDelta === vCurrentBaseDelta) {
            return objPosition;
        }
        bChanged = true;
        return {
            ...objPosition,
            metadata: optionMetadataToRecord({
                ...objMetadata,
                baseDelta: vSignedBaseDelta
            })
        };
    });
    return {
        positions: arrNormalized,
        changed: bChanged
    };
}

function applyImportedBaseDelta(
    pPositions: RollingFuturesLtImportedPositionRecord[],
    pBaseDelta: number
): RollingFuturesLtImportedPositionRecord[] {
    return pPositions.map((objPosition) => {
        if (!isOptionContractSymbol(objPosition.contractName)) {
            return objPosition;
        }
        const objMetadata = getTrackedOptionMetadata(objPosition);
        return {
            ...objPosition,
            metadata: optionMetadataToRecord({
                ...objMetadata,
                baseDelta: getSignedOptionBaseDelta(objPosition.contractName, pBaseDelta)
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
        const vBaseDelta = getSignedOptionBaseDelta(
            vContractName,
            Number.isFinite(Number(objTicker?.delta)) ? Number(objTicker?.delta) : vFallbackDelta
        );
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
    pReason: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pRowIndex: unknown = 1
): RollingFuturesLtOptionMetadata {
    const objRowState = getNormalizedOptionRowUiState(pUiState, pStrategyCode, pRowIndex);
    return {
        rowIndex: objRowState.rowIndex,
        takeProfitDelta: Math.max(0, Number(objRowState.tpD || 0.25)),
        stopLossDelta: Math.max(0, Number(objRowState.slD || 0.65)),
        reEntryDelta: Math.max(0, Number(objRowState.reD || 0.53)),
        reEnterEnabled: Boolean(objRowState.reEnter),
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
    return inferTrackedOptionLegSide(pContractName) === "pe" ? "pe" : "ce";
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

function getTrackedPositionMarginTotal(
    pRows: DeltaPositionRow[],
    pSelectedSymbol: string
): number {
    const vSymbol = normalizeSymbolValue(pSelectedSymbol);
    return pRows.reduce((pSum, pRow) => {
        const vContractSymbol = String(pRow.product_symbol || pRow.symbol || "").trim().toUpperCase();
        const vQty = Math.abs(toFiniteNumber(pRow.net_size ?? pRow.size, 0));
        if (!(vQty > 0) || !isTrackedContractForSymbol(vContractSymbol, vSymbol)) {
            return pSum;
        }
        return pSum + Math.max(0, getDeltaPositionMarginValue(pRow));
    }, 0);
}

function getTrackedPositionPositiveUnrealizedPnlTotal(
    pRows: DeltaPositionRow[],
    pSelectedSymbol: string
): number {
    const vSymbol = normalizeSymbolValue(pSelectedSymbol);
    return pRows.reduce((pSum, pRow) => {
        const vContractSymbol = String(pRow.product_symbol || pRow.symbol || "").trim().toUpperCase();
        const vQty = Math.abs(toFiniteNumber(pRow.net_size ?? pRow.size, 0));
        if (!(vQty > 0) || !isTrackedContractForSymbol(vContractSymbol, vSymbol)) {
            return pSum;
        }
        return pSum + Math.max(0, getDeltaPositionPositiveUnrealizedValue(pRow));
    }, 0);
}

function getDeltaPositionMarginValue(pRow: DeltaPositionRow): number {
    const arrCandidates: unknown[] = [
        pRow.margin,
        pRow.position_margin,
        pRow.initial_margin,
        pRow.maintenance_margin,
        pRow.order_margin,
        (pRow as Record<string, unknown>).total_margin,
        (pRow as Record<string, unknown>).premium_margin,
        (pRow as Record<string, unknown>).span_margin,
        (pRow as Record<string, unknown>).exposure_margin,
        (pRow as Record<string, unknown>).blocked_margin
    ];
    for (const pValue of arrCandidates) {
        const vNumber = toFiniteNumber(pValue, Number.NaN);
        if (Number.isFinite(vNumber) && vNumber > 0) {
            return vNumber;
        }
    }
    return 0;
}

function getDeltaPositionPositiveUnrealizedValue(pRow: DeltaPositionRow): number {
    return Math.max(0, getDeltaPositionUnrealizedValue(pRow));
}

function getDeltaPositionUnrealizedValue(pRow: DeltaPositionRow): number {
    const arrCandidates: unknown[] = [
        pRow.unrealized_cashflow,
        pRow.unrealised_cashflow,
        pRow.unrealized_pnl,
        pRow.unrealised_pnl,
        (pRow as Record<string, unknown>).pnl
    ];
    for (const pValue of arrCandidates) {
        const vNumber = toFiniteNumber(pValue, Number.NaN);
        if (Number.isFinite(vNumber)) {
            return vNumber;
        }
    }
    return 0;
}

function mapLivePosition(
    pRow: DeltaPositionRow,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pUserId: string,
    pIndex: number
): RollingFuturesLtImportedPositionRecord {
    const vNetSize = toFiniteNumber(pRow.net_size ?? pRow.size, 0);
    const vSide = vNetSize < 0 ? "SELL" : "BUY";
    const vOpenedAt = normalizeDeltaTimestampToIso(
        pRow.opened_at
        ?? pRow.openedAt
        ?? pRow.created_at
        ?? pRow.createdAt
        ?? pRow.updated_at
        ?? pRow.updatedAt
    ) || new Date().toISOString();
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
        pnl: Number((toFiniteNumber(pRow.realized_pnl, 0) + getDeltaPositionUnrealizedValue(pRow)).toFixed(2)),
        margin: getDeltaPositionMarginValue(pRow),
        liquidationPrice: toFiniteNumber(pRow.liquidation_price, 0),
        metadata: {
            realizedPnl: Number(toFiniteNumber(pRow.realized_pnl, 0).toFixed(4)),
            unrealizedPnl: Number(getDeltaPositionUnrealizedValue(pRow).toFixed(4))
        },
        openedAt: vOpenedAt,
        updatedAt: new Date().toISOString()
    };
}

function normalizeDeltaTimestampToIso(pValue: unknown): string {
    if (pValue === null || pValue === undefined) {
        return "";
    }

    if (pValue instanceof Date) {
        return Number.isNaN(pValue.getTime()) ? "" : pValue.toISOString();
    }

    if (typeof pValue === "number") {
        if (!Number.isFinite(pValue) || pValue <= 0) {
            return "";
        }
        const vEpochMs = pValue >= 1_000_000_000_000_000
            ? Math.floor(pValue / 1000)
            : (pValue >= 1_000_000_000_000 ? pValue : pValue * 1000);
        const objDate = new Date(vEpochMs);
        return Number.isNaN(objDate.getTime()) ? "" : objDate.toISOString();
    }

    const vRaw = String(pValue || "").trim();
    if (!vRaw) {
        return "";
    }

    if (/^\d+$/.test(vRaw)) {
        const vNumeric = Number(vRaw);
        if (Number.isFinite(vNumeric) && vNumeric > 0) {
            return normalizeDeltaTimestampToIso(vNumeric);
        }
    }

    const vEpochMs = Date.parse(vRaw);
    if (Number.isNaN(vEpochMs)) {
        return "";
    }

    return new Date(vEpochMs).toISOString();
}

function toEpochMicros(pDateValue: string, pEndOfMinute = false): number | null {
    const vValue = String(pDateValue || "").trim();
    if (!vValue) {
        return null;
    }

    const objDdMmYyyyTimeMatch = vValue.match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})$/);
    if (objDdMmYyyyTimeMatch) {
        const vDay = Number(objDdMmYyyyTimeMatch[1]);
        const vMonth = Number(objDdMmYyyyTimeMatch[2]);
        const vYear = Number(objDdMmYyyyTimeMatch[3]);
        const vHour = Number(objDdMmYyyyTimeMatch[4]);
        const vMinute = Number(objDdMmYyyyTimeMatch[5]);
        const objDate = new Date(Date.UTC(
            vYear,
            vMonth - 1,
            vDay,
            vHour,
            vMinute,
            pEndOfMinute ? 59 : 0,
            pEndOfMinute ? 999 : 0
        ));
        if (
            objDate.getUTCFullYear() === vYear
            && objDate.getUTCMonth() === (vMonth - 1)
            && objDate.getUTCDate() === vDay
            && objDate.getUTCHours() === vHour
            && objDate.getUTCMinutes() === vMinute
        ) {
            return objDate.getTime() * 1000;
        }
    }

    const objDdMmYyyyMatch = vValue.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (objDdMmYyyyMatch) {
        const vDay = Number(objDdMmYyyyMatch[1]);
        const vMonth = Number(objDdMmYyyyMatch[2]);
        const vYear = Number(objDdMmYyyyMatch[3]);
        const objDate = new Date(Date.UTC(
            vYear,
            vMonth - 1,
            vDay,
            pEndOfMinute ? 23 : 0,
            pEndOfMinute ? 59 : 0,
            pEndOfMinute ? 59 : 0,
            pEndOfMinute ? 999 : 0
        ));
        if (
            objDate.getUTCFullYear() === vYear
            && objDate.getUTCMonth() === (vMonth - 1)
            && objDate.getUTCDate() === vDay
        ) {
            return objDate.getTime() * 1000;
        }
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

function mapOptionsScalperPaperClosedPosition(
    pRow: OptionsScalperPaperClosedPositionRecord,
    pIndex: number
) {
    return {
        rowId: String(pRow.closeId || `paper-close-${pIndex}`),
        symbol: String(pRow.contractName || "-"),
        side: String(pRow.side || "-").trim().toUpperCase(),
        qty: Number(pRow.qty || 0),
        buyPrice: Number.isFinite(Number(pRow.buyPrice)) ? Number(pRow.buyPrice) : null,
        sellPrice: Number.isFinite(Number(pRow.sellPrice)) ? Number(pRow.sellPrice) : null,
        charges: Number(pRow.charges || 0),
        pnl: Number(pRow.pnl || 0),
        startAt: String(pRow.startAt || "").trim(),
        endAt: String(pRow.endAt || "").trim(),
        orderType: "paper"
    };
}

function filterPaperClosedPositionsByRange(
    pRows: OptionsScalperPaperClosedPositionRecord[],
    pFromDateValue: string,
    pToDateValue: string
): OptionsScalperPaperClosedPositionRecord[] {
    const vFromMs = pFromDateValue ? new Date(parseDeltaUiDateTimeLocalToIsoString(pFromDateValue)).getTime() : Number.NaN;
    const vToMs = pToDateValue ? new Date(parseDeltaUiDateTimeLocalToIsoString(pToDateValue)).getTime() : Number.NaN;
    return (Array.isArray(pRows) ? pRows : []).filter((objRow) => {
        const vEndMs = new Date(String(objRow.endAt || objRow.startAt || "")).getTime();
        if (!Number.isFinite(vEndMs)) {
            return false;
        }
        if (Number.isFinite(vFromMs) && vEndMs < vFromMs) {
            return false;
        }
        if (Number.isFinite(vToMs) && vEndMs > (vToMs + (59 * 1000) + 999)) {
            return false;
        }
        return true;
    });
}

async function syncOptionsScalperRecoveryMetricsFromPaperClosedPositions(
    pUserId: string,
    pProfile: RollingFuturesLtProfileRecord
): Promise<RollingFuturesLtProfileRecord> {
    const objUiState = getMergedUiState(pProfile);
    const vSelectedSymbol = normalizeSymbolValue(objUiState.symbol);
    const arrRows = await listOptionsScalperPaperClosedPositions(pUserId, pProfile.strategyCode);
    const arrFiltered = filterPaperClosedPositionsByRange(
        arrRows.filter((objRow) => isTrackedContractForSymbol(objRow.contractName, vSelectedSymbol)),
        String(objUiState.closedFromDate || "").trim(),
        String(objUiState.closedToDate || "").trim()
    );
    const vBrokerageTotal = Number(arrFiltered.reduce((pSum, objRow) => pSum + Number(objRow.charges || 0), 0).toFixed(4));
    const vTotalPnl = Number(arrFiltered.reduce((pSum, objRow) => pSum + Number(objRow.pnl || 0), 0).toFixed(4));
    await saveBrokerageRecoveryTotal(pUserId, pProfile.strategyCode, vBrokerageTotal);
    await saveRecoveredTotalPnl(pUserId, pProfile.strategyCode, vTotalPnl);
    return pProfile;
}

async function refreshOptionsScalperPaperOpenPositions(
    pPositions: RollingFuturesLtImportedPositionRecord[]
): Promise<RollingFuturesLtImportedPositionRecord[]> {
    const arrNext: RollingFuturesLtImportedPositionRecord[] = [];
    for (const objPosition of Array.isArray(pPositions) ? pPositions : []) {
        const objTicker = await getLiveOptionTicker(objPosition.contractName);
        const vMarkPrice = Number(objTicker?.markPrice || objPosition.markPrice || objPosition.entryPrice || 0);
        arrNext.push({
            ...objPosition,
            markPrice: vMarkPrice,
            pnl: Number(estimateTrackedPositionPnl(objPosition, vMarkPrice).toFixed(4)),
            updatedAt: new Date().toISOString(),
            metadata: objPosition.metadata && typeof objPosition.metadata === "object"
                ? {
                    ...objPosition.metadata,
                    liveDelta: Number.isFinite(Number(objTicker?.delta)) ? Number(objTicker?.delta) : objPosition.metadata.delta,
                    liveTheta: Number.isFinite(Number(objTicker?.theta)) ? Number(objTicker?.theta) : objPosition.metadata.theta
                }
                : objPosition.metadata
        });
    }
    return arrNext;
}

async function closeOptionsScalperPaperPosition(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pPosition: RollingFuturesLtImportedPositionRecord,
    pExitPrice?: number,
    pClosedAtIso?: string
): Promise<OptionsScalperPaperClosedPositionRecord> {
    const vClosedAtIso = String(pClosedAtIso || "").trim() || new Date().toISOString();
    const vExitPrice = Number.isFinite(Number(pExitPrice))
        ? Number(pExitPrice)
        : Number((await getLiveOptionTicker(pPosition.contractName))?.markPrice || pPosition.markPrice || pPosition.entryPrice || 0);
    const vCloseCharge = await estimateTrackedPositionCharge(pPosition, vExitPrice);
    const vPnl = Number(estimateTrackedPositionPnl(pPosition, vExitPrice).toFixed(4));
    const vTotalCharges = Number((Number(pPosition.charges || 0) + vCloseCharge).toFixed(4));
    const vSide = String(pPosition.side || "").trim().toUpperCase();
    return {
        closeId: crypto.randomUUID(),
        userId: pUserId,
        strategyCode: pStrategyCode,
        contractName: pPosition.contractName,
        side: vSide,
        qty: Number(pPosition.qty || 0),
        buyPrice: vSide === "BUY" ? Number(pPosition.entryPrice || 0) : vExitPrice,
        sellPrice: vSide === "SELL" ? Number(pPosition.entryPrice || 0) : vExitPrice,
        charges: vTotalCharges,
        pnl: vPnl,
        startAt: String(pPosition.openedAt || "").trim() || vClosedAtIso,
        endAt: vClosedAtIso,
        metadata: pPosition.metadata && typeof pPosition.metadata === "object"
            ? {
                ...pPosition.metadata,
                closePrice: vExitPrice,
                closeCharge: vCloseCharge
            }
            : {
                closePrice: vExitPrice,
                closeCharge: vCloseCharge
            },
        updatedAt: vClosedAtIso
    };
}

async function findRecentOrderHistoryRow(
    pClient: any,
    pContractName: string,
    pOrderId: string,
    pSide: string,
    pQty: number,
    pPlacedAtIso: string
): Promise<DeltaOrderHistoryRow | null> {
    if (typeof pClient?.apis?.TradeHistory?.getOrderHistory !== "function") {
        return null;
    }

    const vPlacedAtMs = Number.isFinite(Date.parse(pPlacedAtIso)) ? Date.parse(pPlacedAtIso) : Date.now();
    const vStartMicros = Math.max(0, (vPlacedAtMs - (10 * 60 * 1000)) * 1000);
    const vQtyAbs = Math.abs(Math.floor(Number(pQty || 0)));
    const vSideUpper = String(pSide || "").trim().toUpperCase();
    const vContractUpper = String(pContractName || "").trim().toUpperCase();

    for (let vAttempt = 0; vAttempt < 4; vAttempt += 1) {
        const arrRows: DeltaOrderHistoryRow[] = [];
        let vAfterCursor = "";
        let vSafetyCounter = 0;
        while (vSafetyCounter < 3) {
            const objParams: Record<string, string | number> = {
                page_size: 100,
                start_time: vStartMicros,
                end_time: Date.now() * 1000
            };
            if (vAfterCursor) {
                objParams.after = vAfterCursor;
            }
            const objResponse = await pClient.apis.TradeHistory.getOrderHistory(objParams);
            const objPayload = readResponsePayload(objResponse);
            const arrPageRows = Array.isArray(objPayload.result) ? objPayload.result as DeltaOrderHistoryRow[] : [];
            arrRows.push(...arrPageRows);
            const vNextAfter = String((objPayload.meta as { after?: unknown } | undefined)?.after || "").trim();
            vSafetyCounter += 1;
            if (!vNextAfter || vNextAfter === vAfterCursor || arrPageRows.length < 100) {
                break;
            }
            vAfterCursor = vNextAfter;
        }

        const arrCandidates = arrRows
            .filter((objRow) => {
                const vState = String(objRow.state || "").trim().toLowerCase();
                return !vState || vState === "closed";
            })
            .filter((objRow) => String(objRow.product_symbol || "").trim().toUpperCase() === vContractUpper)
            .filter((objRow) => {
                const vRowOrderId = getHistoryOrderId(objRow);
                if (pOrderId && vRowOrderId === pOrderId) {
                    return true;
                }
                return String(objRow.side || "").trim().toUpperCase() === vSideUpper
                    && Math.abs(Math.floor(toFiniteNumber(objRow.size, 0))) === vQtyAbs;
            })
            .sort((pLeft, pRight) => {
                const vLeftTs = Number.isFinite(Date.parse(String(pLeft.updated_at || pLeft.created_at || "")))
                    ? Date.parse(String(pLeft.updated_at || pLeft.created_at || ""))
                    : 0;
                const vRightTs = Number.isFinite(Date.parse(String(pRight.updated_at || pRight.created_at || "")))
                    ? Date.parse(String(pRight.updated_at || pRight.created_at || ""))
                    : 0;
                return vRightTs - vLeftTs;
            });
        if (arrCandidates.length > 0) {
            return arrCandidates[0];
        }
        await sleep(1500);
    }

    return null;
}

async function resolveOrderChargeFromDelta(
    pClient: any,
    pContractName: string,
    pOrderPayload: Record<string, unknown>,
    pSide: string,
    pQty: number,
    pPlacedAtIso: string
): Promise<number | null> {
    const vPayloadCommission = getOrderLikePaidCommission(pOrderPayload);
    if (vPayloadCommission !== null) {
        return vPayloadCommission;
    }

    const objHistoryRow = await findRecentOrderHistoryRow(
        pClient,
        pContractName,
        getOrderId(pOrderPayload),
        pSide,
        pQty,
        pPlacedAtIso
    );
    if (!objHistoryRow) {
        return null;
    }

    const vHistoryCommission = Number(objHistoryRow.paid_commission);
    return Number.isFinite(vHistoryCommission) ? vHistoryCommission : null;
}

async function resolveOrderRealizedPnlFromDelta(
    pClient: any,
    pContractName: string,
    pOrderPayload: Record<string, unknown>,
    pSide: string,
    pQty: number,
    pPlacedAtIso: string
): Promise<number | null> {
    const vPayloadPnl = getOrderLikeRealizedPnl(pOrderPayload);
    if (Number.isFinite(vPayloadPnl)) {
        return Number(vPayloadPnl);
    }

    const objHistoryRow = await findRecentOrderHistoryRow(
        pClient,
        pContractName,
        getOrderId(pOrderPayload),
        pSide,
        pQty,
        pPlacedAtIso
    );
    if (!objHistoryRow) {
        return null;
    }

    const vHistoryPnl = toFiniteNumber(objHistoryRow.meta_data?.pnl, Number.NaN);
    return Number.isFinite(vHistoryPnl) ? Number(vHistoryPnl) : null;
}

async function resolveTrackedPositionClosePnl(
    pClient: any,
    pPosition: RollingFuturesLtImportedPositionRecord,
    pClosePayload: Record<string, unknown>,
    pPlacedAtIso: string
): Promise<number | null> {
    const vPayloadPnl = getOrderLikeRealizedPnl(pClosePayload);
    if (Number.isFinite(vPayloadPnl)) {
        return Number(vPayloadPnl);
    }

    const bFutureContract = isFutureContractSymbol(pPosition.contractName);

    const vPayloadFillPrice = getOrderLikeAverageFillPrice(pClosePayload);
    if (!bFutureContract && Number.isFinite(vPayloadFillPrice)) {
        return estimateTrackedPositionPnl(pPosition, Number(vPayloadFillPrice));
    }

    const objHistoryRow = await findRecentOrderHistoryRow(
        pClient,
        pPosition.contractName,
        getOrderId(pClosePayload),
        String(pPosition.side || "").trim().toUpperCase() === "BUY" ? "SELL" : "BUY",
        Number(pPosition.qty || 0),
        pPlacedAtIso
    );
    if (!objHistoryRow) {
        return null;
    }

    const vHistoryPnl = toFiniteNumber(objHistoryRow.meta_data?.pnl, Number.NaN);
    if (Number.isFinite(vHistoryPnl)) {
        return Number(vHistoryPnl);
    }

    const vHistoryFillPrice = toFiniteNumber(objHistoryRow.average_fill_price, Number.NaN);
    if (!bFutureContract && Number.isFinite(vHistoryFillPrice)) {
        return estimateTrackedPositionPnl(pPosition, Number(vHistoryFillPrice));
    }

    return null;
}

async function getDeltaClientForAccountId(pAccountId: string, pProfileId: string) {
    const vAccountId = String(pAccountId || "").trim();
    if (!vAccountId) {
        throw new Error("Please sign in to continue.");
    }
    try {
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
    catch (objError) {
        if (!isPrimaryDatabaseUnavailableError(objError)) {
            throw objError;
        }

        logDualSurvivalDebug("delta_client_primary_db_unavailable", {
            userId: vAccountId,
            strategyCode: "rolling-futures-lt-dual",
            profileId: String(pProfileId || "").trim(),
            error: getErrorMessage(objError, "Primary DB unavailable while loading Delta client.")
        });

        const objSurvival = await getSurvivalState(vAccountId, "rolling-futures-lt-dual");
        if (!objSurvival || objSurvival.selectedApiProfileId !== String(pProfileId || "").trim()) {
            logDualSurvivalDebug("delta_client_survival_state_missing", {
                userId: vAccountId,
                strategyCode: "rolling-futures-lt-dual",
                requestedProfileId: String(pProfileId || "").trim(),
                hasSurvivalState: Boolean(objSurvival),
                survivalProfileId: String(objSurvival?.selectedApiProfileId || "").trim()
            });
            throw objError;
        }
        if (!objSurvival.apiKey || !objSurvival.apiSecret) {
            logDualSurvivalDebug("delta_client_survival_credentials_missing", {
                userId: vAccountId,
                strategyCode: "rolling-futures-lt-dual",
                requestedProfileId: String(pProfileId || "").trim(),
                hasApiKey: Boolean(objSurvival.apiKey),
                hasApiSecret: Boolean(objSurvival.apiSecret)
            });
            throw objError;
        }

        logDualSurvivalDebug("delta_client_survival_fallback_ready", {
            userId: vAccountId,
            strategyCode: "rolling-futures-lt-dual",
            requestedProfileId: String(pProfileId || "").trim(),
            profileReferenceName: String(objSurvival.profileReferenceName || "").trim()
        });
        const objClient = await new DeltaRestClient(objSurvival.apiKey, objSurvival.apiSecret);
        return {
            account: {
                accountId: vAccountId,
                fullName: "",
                email: "",
                mobileNo: "",
                telegramChatId: "",
                passwordHash: "",
                isActive: true,
                isAdmin: false,
                isSurvivalAdmin: false,
                execStrategy: true,
                mustChangePassword: false,
                createdAt: "",
                updatedAt: ""
            },
            client: objClient,
            profile: {
                profileId: objSurvival.selectedApiProfileId,
                accountId: vAccountId,
                referenceName: objSurvival.profileReferenceName || "Survival Snapshot",
                apiKey: objSurvival.apiKey,
                apiSecret: objSurvival.apiSecret,
                createdAt: objSurvival.createdAt,
                updatedAt: objSurvival.updatedAt
            }
        };
    }
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

async function getDeltaErrorLogDescriptor(pError: unknown): Promise<{
    isDeltaError: boolean;
    eventType: string;
    severity: "warning" | "error";
    title: string;
    message: string;
    payload: Record<string, unknown>;
}> {
    const objFriendly = await getFriendlyDeltaConnectionError(pError);
    const vRawMessage = getErrorMessage(pError, "Live auto trader cycle failed.");
    const vNormalized = vRawMessage.toLowerCase();
    const objPayload = getDeltaErrorPayload(pError);
    const vDeltaCode = String(objPayload?.error?.code || "").trim();
    const bLooksDeltaError = objFriendly.state !== "warning"
        || Boolean(vDeltaCode)
        || vNormalized.includes("delta")
        || vNormalized.includes("unauthorized")
        || vNormalized.includes("forbidden")
        || vNormalized.includes("rate limit")
        || vNormalized.includes("timeout")
        || vNormalized.includes("fetch failed")
        || vNormalized.includes("network");

    if (!bLooksDeltaError) {
        return {
            isDeltaError: false,
            eventType: "engine_error",
            severity: "error",
            title: "Live Auto Trader Cycle Failed",
            message: vRawMessage,
            payload: { reason: "auto_trader_cycle_error" }
        };
    }

    if (objFriendly.state === "auth_failed") {
        return {
            isDeltaError: true,
            eventType: "delta_exchange_error",
            severity: "error",
            title: "Delta Exchange Authentication Error",
            message: objFriendly.message,
            payload: {
                reason: "delta_auth_error",
                connectionState: objFriendly.state,
                deltaCode: vDeltaCode
            }
        };
    }

    if (objFriendly.state === "rate_limited") {
        return {
            isDeltaError: true,
            eventType: "delta_exchange_error",
            severity: "warning",
            title: "Delta Exchange Rate Limit",
            message: objFriendly.message,
            payload: {
                reason: "delta_rate_limit",
                connectionState: objFriendly.state,
                deltaCode: vDeltaCode
            }
        };
    }

    if (objFriendly.state === "disconnected") {
        return {
            isDeltaError: true,
            eventType: "delta_exchange_error",
            severity: "error",
            title: "Delta Exchange Connection Lost",
            message: objFriendly.message,
            payload: {
                reason: "delta_connection_error",
                connectionState: objFriendly.state,
                deltaCode: vDeltaCode
            }
        };
    }

    return {
        isDeltaError: true,
        eventType: "delta_exchange_error",
        severity: "error",
        title: "Delta Exchange Error",
        message: objFriendly.state === "warning" ? vRawMessage : objFriendly.message,
        payload: {
            reason: "delta_exchange_error",
            connectionState: objFriendly.state,
            deltaCode: vDeltaCode
        }
    };
}

async function classifyCoveredOptionReEntryFailure(pError: unknown): Promise<{
    type: "connection" | "insufficient_margin" | "other";
    message: string;
}> {
    const objFriendly = await getFriendlyDeltaConnectionError(pError);
    const vMessage = getErrorMessage(pError, "Unable to open covered option re-entry.");
    const vNormalized = vMessage.toLowerCase();
    if (objFriendly.state === "disconnected") {
        return {
            type: "connection",
            message: objFriendly.message
        };
    }
    if ((vNormalized.includes("insufficient") && vNormalized.includes("margin"))
        || (vNormalized.includes("insufficient") && vNormalized.includes("balance"))
        || vNormalized.includes("not enough balance")
        || vNormalized.includes("not sufficient balance")) {
        return {
            type: "insufficient_margin",
            message: vMessage
        };
    }
    return {
        type: "other",
        message: vMessage
    };
}

async function listOpenDeltaOrders(
    pClient: any
): Promise<DeltaActiveOrderRow[]> {
    if (typeof pClient?.apis?.Orders?.getOrders !== "function") {
        return [];
    }
    const objResponse = await pClient.apis.Orders.getOrders({
        state: "open",
        page_size: 100
    });
    const objPayload = readResponsePayload(objResponse);
    return Array.isArray(objPayload.result) ? objPayload.result as DeltaActiveOrderRow[] : [];
}

async function cancelOpenCoveredOptionEntryOrdersForLeg(
    pClient: any,
    pSymbol: "BTC" | "ETH",
    pLegSide: "ce" | "pe",
    pAction: "buy" | "sell"
): Promise<number> {
    if (typeof pClient?.apis?.Orders?.cancelOrder !== "function") {
        return 0;
    }
    const arrOpenOrders = await listOpenDeltaOrders(pClient);
    const arrMatching = arrOpenOrders.filter((objOrder) => {
        const vContract = String(objOrder.product_symbol || "").trim().toUpperCase();
        const vOrderSide = String(objOrder.side || "").trim().toLowerCase();
        return isTrackedContractForSymbol(vContract, pSymbol)
            && inferTrackedOptionLegSide(vContract) === pLegSide
            && vOrderSide === pAction
            && !Boolean(objOrder.reduce_only)
            && Math.max(0, Math.floor(Number(objOrder.unfilled_size ?? objOrder.size ?? 0))) > 0;
    });
    for (const objOrder of arrMatching) {
        await pClient.apis.Orders.cancelOrder({
            order: {
                id: Number.isFinite(Number(objOrder.id)) ? Number(objOrder.id) : objOrder.id,
                product_symbol: String(objOrder.product_symbol || "").trim()
            }
        });
    }
    return arrMatching.length;
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
    const arrTelegramPrefs = normalizeTelegramAlertTypesForStrategy(pProfile.strategyCode, objUiState);
    const objMergedUiState: Record<string, unknown> = {
        startQty: isCoveredOptionsStrategy(pProfile.strategyCode)
            ? normalizeCoveredMultiplierString(objUiState.startQty ?? objDefaults.startQty, pProfile.strategyCode)
            : normalizeStringValue(objUiState.startQty, String(objDefaults.startQty)),
        symbol: normalizeSymbolValue(objUiState.symbol),
        manualFutOrderType: String(objUiState.manualFutOrderType || "market_order").trim() === "limit_order" ? "limit_order" : "market_order",
        bsFutQty: normalizeStringValue(objUiState.bsFutQty, String(objDefaults.bsFutQty)),
        minusDelta: normalizeStringValue(objUiState.minusDelta, String(objDefaults.minusDelta)),
        plusDelta: normalizeStringValue(objUiState.plusDelta, String(objDefaults.plusDelta)),
        onlyDeltaNeutral: normalizeBooleanValue(objUiState.onlyDeltaNeutral, Boolean(objDefaults.onlyDeltaNeutral)),
        rangeDeltaNeutral: normalizeBooleanValue(objUiState.rangeDeltaNeutral, Boolean(objDefaults.rangeDeltaNeutral)),
        gammaAwareNeutral: normalizeBooleanValue(objUiState.gammaAwareNeutral, Boolean(objDefaults.gammaAwareNeutral)),
        closeNetProfitBrokerage: normalizeBooleanValue(objUiState.closeNetProfitBrokerage, Boolean(objDefaults.closeNetProfitBrokerage)),
        brokerageMultiplier: normalizeStringValue(objUiState.brokerageMultiplier, String(objDefaults.brokerageMultiplier)),
        reEnterBrok: normalizeBooleanValue(objUiState.reEnterBrok, Boolean(objDefaults.reEnterBrok)),
        closeBlockedMargin: normalizeBooleanValue(objUiState.closeBlockedMargin, Boolean(objDefaults.closeBlockedMargin)),
        blockedMarginPct: normalizeStringValue(objUiState.blockedMarginPct, String(objDefaults.blockedMarginPct)),
        reEnterBlock: normalizeBooleanValue(objUiState.reEnterBlock, Boolean(objDefaults.reEnterBlock)),
        buyHedgeSellPremiumGate: isStrangleOptionsStrategy(pProfile.strategyCode)
            ? false
            : normalizeBooleanValue(objUiState.buyHedgeSellPremiumGate, Boolean(objDefaults.buyHedgeSellPremiumGate)),
        buyHedgeSellPremiumPct: isStrangleOptionsStrategy(pProfile.strategyCode)
            ? "2"
            : normalizeStringValue(objUiState.buyHedgeSellPremiumPct, String(objDefaults.buyHedgeSellPremiumPct)),
        strangleDeltaDiffReplaceEnabled: isStrangleOptionsStrategy(pProfile.strategyCode)
            ? normalizeBooleanValue(objUiState.strangleDeltaDiffReplaceEnabled, Boolean(objDefaults.strangleDeltaDiffReplaceEnabled))
            : false,
        strangleDeltaDiffReplacePct: isStrangleOptionsStrategy(pProfile.strategyCode)
            ? normalizeStringValue(objUiState.strangleDeltaDiffReplacePct, String(objDefaults.strangleDeltaDiffReplacePct))
            : "50",
        buyHedgeOppositeLegOnGate: pProfile.strategyCode === "covered-options"
            ? normalizeBooleanValue(objUiState.buyHedgeOppositeLegOnGate, Boolean(objDefaults.buyHedgeOppositeLegOnGate))
            : false,
        buyQtyPercentEnabled: isStrangleOptionsStrategy(pProfile.strategyCode)
            ? false
            : normalizeBooleanValue(objUiState.buyQtyPercentEnabled, Boolean(objDefaults.buyQtyPercentEnabled)),
        buyQtyPercent: isStrangleOptionsStrategy(pProfile.strategyCode)
            ? "100"
            : normalizeCoveredBuyQtyPercentString(objUiState.buyQtyPercent ?? objDefaults.buyQtyPercent),
        strangleReopenAtNewD: isStrangleOptionsStrategy(pProfile.strategyCode)
            ? normalizeBooleanValue(objUiState.strangleReopenAtNewD, Boolean(objDefaults.strangleReopenAtNewD))
            : false,
        autoConfirmLiveActions: normalizeBooleanValue(objUiState.autoConfirmLiveActions, Boolean(objDefaults.autoConfirmLiveActions)),
        telegramAlertTypes: Array.from(new Set(arrTelegramPrefs)),
        closedFromDate: String(objUiState.closedFromDate || "").trim(),
        closedToDate: String(objUiState.closedToDate || "").trim()
    };
    [1, ...(isCoveredLikeStrategy(pProfile.strategyCode) ? [2] : [])].forEach((vRowIndex) => {
        const objRowState = getNormalizedOptionRowUiState(objUiState, pProfile.strategyCode, vRowIndex);
        const objKeys = getOptionRowStateKeys(pProfile.strategyCode, vRowIndex);
        objMergedUiState[objKeys.action] = objRowState.action;
        objMergedUiState[objKeys.legs] = objRowState.legs;
        objMergedUiState[objKeys.expiryMode] = objRowState.expiryMode;
        objMergedUiState[objKeys.expiryDate] = objRowState.expiryDate;
        objMergedUiState[objKeys.qty] = objRowState.qty;
        objMergedUiState[objKeys.newD] = objRowState.newD;
        objMergedUiState[objKeys.reD] = objRowState.reD;
        objMergedUiState[objKeys.tpD] = objRowState.tpD;
        objMergedUiState[objKeys.slD] = objRowState.slD;
        objMergedUiState[objKeys.reEnter] = objRowState.reEnter;
    });
    return objMergedUiState;
}

async function refreshModeDrivenExpiryDatesInProfile(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pProfile?: RollingFuturesLtProfileRecord | null
): Promise<RollingFuturesLtProfileRecord> {
    let objProfile = pProfile || await readLiveProfile(pUserId, pStrategyCode);
    if (!isCoveredLikeStrategy(pStrategyCode)) {
        return objProfile;
    }
    const objUiState = getMergedUiState(objProfile);
    const vDeltaDate = getCurrentDeltaUiDateTimeParts().date;
    let bChanged = false;
    const objNextUiState: Record<string, unknown> = {
        ...objUiState
    };
    for (const vRowIndex of [1, 2] as const) {
        const objKeys = getOptionRowStateKeys(pStrategyCode, vRowIndex);
        const vExpiryMode = String(objUiState[objKeys.expiryMode] || "").trim();
        if (!["1", "2", "4", "5", "6", "7"].includes(vExpiryMode)) {
            continue;
        }
        const vResolvedExpiryDate = resolveRollingFuturesExpiryDateByModeFromBaseDate(vExpiryMode, vDeltaDate);
        if (!vResolvedExpiryDate) {
            continue;
        }
        if (String(objUiState[objKeys.expiryDate] || "").trim() === vResolvedExpiryDate) {
            continue;
        }
        objNextUiState[objKeys.expiryDate] = vResolvedExpiryDate;
        bChanged = true;
    }
    if (!bChanged) {
        return objProfile;
    }
    objProfile = await saveRollingFuturesLtProfile(normalizeProfileSaveInput(pUserId, pStrategyCode, {
        ...objProfile,
        uiState: objNextUiState,
        connectionStatus: objProfile.connectionStatus
    }));
    return objProfile;
}

function buildCoveredQueuedExecBatchInputsFromPayload(
    pProfile: RollingFuturesLtProfileRecord,
    pPayload: Record<string, unknown>
): Array<{
    action: "buy" | "sell";
    symbol: "BTC" | "ETH";
    legSide: "ce" | "pe" | "both";
    expiryMode: "1" | "2" | "4" | "5" | "6" | "7";
    expiryDate: string;
    qty: number;
    targetDelta: number;
    rowIndex: 1 | 2;
}> {
    const arrRows = Array.isArray(pPayload.inputs)
        ? pPayload.inputs as Array<Record<string, unknown>>
        : [];
    const objMergedUiState = getMergedUiState(pProfile);
    return arrRows.map((objRow) => {
        const vRowIndex = normalizeOptionRowIndex(pProfile.strategyCode, objRow.rowIndex);
        const objRowState = getNormalizedOptionRowUiState(objMergedUiState, pProfile.strategyCode, vRowIndex);
        const objInput = normalizeExecStrategyInput(
            objRowState.action,
            objMergedUiState.symbol,
            objRowState.legs,
            objRowState.expiryMode,
            objRowState.expiryDate,
            objRowState.qty || 1,
            objRowState.newD || 0.53
        );
        return {
            ...objInput,
            rowIndex: vRowIndex
        };
    }).filter((objInput) => Boolean(objInput.expiryDate));
}

async function queueCoveredTriggeredAction(
    pUserId: string,
    pProfile: RollingFuturesLtProfileRecord,
    pPosition: RollingFuturesLtImportedPositionRecord,
    pReason: "sl" | "tp" | "expiry_cutoff",
    pCurrentDelta: number,
    pCurrentMarkPrice: number | null
): Promise<{ created: boolean; message: string; }> {
    const pStrategyCode = isCoveredOptionsStrategy(pProfile.strategyCode) ? pProfile.strategyCode : "covered-options";
    const vStrategyLabel = getCoveredLikeStrategyLabel(pStrategyCode);
    const vConfirmationResult = await requestCoveredLiveConfirmation(pUserId, pProfile, {
        kind: "option_rule_close",
        title: pReason === "sl" ? "Confirm SL Close" : (pReason === "tp" ? "Confirm TP Close" : "Confirm Expiry Close"),
        message: pReason === "expiry_cutoff"
            ? `${vStrategyLabel} option ${pPosition.contractName} is on its expiry date. Confirm to swap it into the next expiry.`
            : `${vStrategyLabel} option ${String(pPosition.side || "").trim().toUpperCase()} ${pPosition.contractName} hit ${pReason.toUpperCase()}. Confirm to execute the action now.`,
        payload: {
            importId: pPosition.importId,
            contractName: pPosition.contractName,
            reason: pReason,
            currentDelta: pCurrentDelta,
            currentMarkPrice: pCurrentMarkPrice
        }
    });
    if (vConfirmationResult === "queued" || vConfirmationResult === "suppressed") {
        return {
            created: false,
            message: vConfirmationResult === "queued"
                ? "The action is waiting for confirmation."
                : "Another live action confirmation is already pending."
        };
    }
    const vSelectedApiProfileId = String(pProfile.selectedApiProfileId || "").trim();
    if (!vSelectedApiProfileId) {
        return {
            created: false,
            message: "Select an API profile before executing the action."
        };
    }
    const arrSavedPositions = await listRollingFuturesLtImportedPositions(pUserId, pStrategyCode);
    const objCurrentPosition = arrSavedPositions.find((objRow) => String(objRow.importId || "").trim() === String(pPosition.importId || "").trim())
        || arrSavedPositions.find((objRow) => String(objRow.contractName || "").trim() === String(pPosition.contractName || "").trim());
    if (!objCurrentPosition) {
        return {
            created: false,
            message: "The position is no longer open."
        };
    }
    await applyTriggeredOptionRule(
        pUserId,
        pStrategyCode,
        vSelectedApiProfileId,
        pProfile,
        objCurrentPosition,
        pCurrentDelta,
        pCurrentMarkPrice,
        pReason,
        arrSavedPositions,
        true
    );
    return {
        created: true,
        message: "The action was executed."
    };
}

async function queueCoveredExecBatchAction(
    pUserId: string,
    pProfile: RollingFuturesLtProfileRecord,
    pInputs: Array<Record<string, unknown>>,
    pSuppressClosedFromDateUpdate: boolean
): Promise<{ created: boolean; message: string; }> {
    const vStrategyLabel = getCoveredLikeStrategyLabel(pProfile.strategyCode);
    const vConfirmationResult = await requestCoveredLiveConfirmation(pUserId, pProfile, {
        kind: "exec_batch",
        title: "Confirm Exec Strategy",
        message: `${vStrategyLabel} Exec Strategy is ready to place ${pInputs.length} row${pInputs.length === 1 ? "" : "s"}. Confirm to execute now.`,
        payload: {
            inputs: pInputs,
            suppressClosedFromDateUpdate: pSuppressClosedFromDateUpdate
        }
    });
    if (vConfirmationResult === "queued" || vConfirmationResult === "suppressed") {
        return {
            created: false,
            message: vConfirmationResult === "queued"
                ? "Exec Strategy is waiting for confirmation."
                : "Another live action confirmation is already pending."
        };
    }
    const pStrategyCode = isCoveredOptionsStrategy(pProfile.strategyCode) ? pProfile.strategyCode : "covered-options";
    const vSelectedApiProfileId = String(pProfile.selectedApiProfileId || "").trim();
    if (!vSelectedApiProfileId) {
        return {
            created: false,
            message: "Select an API profile before executing the strategy."
        };
    }
    const objExecResult = await runCoveredExecStrategyBatchPlacement(
        pUserId,
        pStrategyCode,
        vSelectedApiProfileId,
        pProfile,
        pInputs as Array<{
            action: "buy" | "sell";
            symbol: "BTC" | "ETH";
            legSide: "ce" | "pe" | "both";
            expiryMode: "1" | "2" | "4" | "5" | "6" | "7";
            expiryDate: string;
            qty: number;
            targetDelta: number;
            rowIndex: 1 | 2;
        }>,
        "exec_strategy"
    );
    if (!pSuppressClosedFromDateUpdate) {
        await syncCoveredRecoveryMetricsFromClosedHistory(
            pUserId,
            pStrategyCode,
            vSelectedApiProfileId,
            pProfile,
            objExecResult.trackedOpenPositions
        );
    }
    return {
        created: true,
        message: "Exec Strategy executed successfully."
    };
}

async function queueCoveredReEntryAction(
    pUserId: string,
    pProfile: RollingFuturesLtProfileRecord,
    pPending: CoveredPendingOptionReEntryState
): Promise<{ created: boolean; message: string; }> {
    const vStrategyLabel = getCoveredLikeStrategyLabel(pProfile.strategyCode);
    const vConfirmationResult = await requestCoveredLiveConfirmation(pUserId, pProfile, {
        kind: "covered_reentry",
        title: `Confirm ${vStrategyLabel} Re-Entry`,
        message: `Row ${pPending.rowIndex} ${pPending.legSide.toUpperCase()} is ready to re-enter after ${pPending.reason.replaceAll("_", " ")}. Confirm to place the replacement option order now.`,
        payload: {
            dedupeKey: pPending.dedupeKey,
            rowIndex: pPending.rowIndex,
            legSide: pPending.legSide,
            action: pPending.action,
            qty: pPending.qty,
            reason: pPending.reason,
            targetDelta: pPending.targetDelta,
            expiryMode: pPending.expiryMode,
            expiryDate: pPending.expiryDate,
            closedContractName: pPending.closedContractName
        }
    });
    if (vConfirmationResult === "queued" || vConfirmationResult === "suppressed") {
        return {
            created: false,
            message: vConfirmationResult === "queued"
                ? `${vStrategyLabel} re-entry is waiting for confirmation.`
                : "Another live action confirmation is already pending."
        };
    }
    const pStrategyCode = isCoveredOptionsStrategy(pProfile.strategyCode) ? pProfile.strategyCode : "covered-options";
    const vSelectedApiProfileId = String(pProfile.selectedApiProfileId || "").trim();
    if (!vSelectedApiProfileId) {
        return {
            created: false,
            message: "Select an API profile before placing the re-entry."
        };
    }
    const bOpened = await executeCoveredPendingReEntryNow(
        pUserId,
        vSelectedApiProfileId,
        pProfile,
        pPending
    );
    return {
        created: bOpened,
        message: bOpened
            ? `${vStrategyLabel} re-entry executed successfully.`
            : `${vStrategyLabel} re-entry was no longer needed.`
    };
}

function normalizeProfileSaveInput(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pIncoming: Partial<RollingFuturesLtProfileRecord>
): RollingFuturesLtProfileRecord {
    const objUiState = (pIncoming.uiState && typeof pIncoming.uiState === "object") ? pIncoming.uiState : {};
    const objDefaults = getDefaultManualTraderUiState(pStrategyCode);
    const arrTelegramPrefs = normalizeTelegramAlertTypesForStrategy(pStrategyCode, objUiState);
    const objNormalizedUiState: Record<string, unknown> = {
        startQty: isCoveredOptionsStrategy(pStrategyCode)
            ? normalizeCoveredMultiplierString(objUiState.startQty ?? objDefaults.startQty, pStrategyCode)
            : normalizeStringValue(objUiState.startQty, String(objDefaults.startQty)),
        symbol: normalizeSymbolValue(objUiState.symbol),
        manualFutOrderType: String(objUiState.manualFutOrderType || "market_order").trim() === "limit_order" ? "limit_order" : "market_order",
        bsFutQty: normalizeStringValue(objUiState.bsFutQty, String(objDefaults.bsFutQty)),
        minusDelta: normalizeStringValue(objUiState.minusDelta, String(objDefaults.minusDelta)),
        plusDelta: normalizeStringValue(objUiState.plusDelta, String(objDefaults.plusDelta)),
        onlyDeltaNeutral: normalizeBooleanValue(objUiState.onlyDeltaNeutral, Boolean(objDefaults.onlyDeltaNeutral)),
        rangeDeltaNeutral: normalizeBooleanValue(objUiState.rangeDeltaNeutral, Boolean(objDefaults.rangeDeltaNeutral)),
        gammaAwareNeutral: normalizeBooleanValue(objUiState.gammaAwareNeutral, Boolean(objDefaults.gammaAwareNeutral)),
        closeNetProfitBrokerage: normalizeBooleanValue(objUiState.closeNetProfitBrokerage, Boolean(objDefaults.closeNetProfitBrokerage)),
        brokerageMultiplier: normalizeStringValue(objUiState.brokerageMultiplier, String(objDefaults.brokerageMultiplier)),
        reEnterBrok: normalizeBooleanValue(objUiState.reEnterBrok, Boolean(objDefaults.reEnterBrok)),
        closeBlockedMargin: normalizeBooleanValue(objUiState.closeBlockedMargin, Boolean(objDefaults.closeBlockedMargin)),
        blockedMarginPct: normalizeStringValue(objUiState.blockedMarginPct, String(objDefaults.blockedMarginPct)),
        reEnterBlock: normalizeBooleanValue(objUiState.reEnterBlock, Boolean(objDefaults.reEnterBlock)),
        buyHedgeSellPremiumGate: isStrangleOptionsStrategy(pStrategyCode)
            ? false
            : normalizeBooleanValue(objUiState.buyHedgeSellPremiumGate, Boolean(objDefaults.buyHedgeSellPremiumGate)),
        buyHedgeSellPremiumPct: isStrangleOptionsStrategy(pStrategyCode)
            ? "2"
            : normalizeStringValue(objUiState.buyHedgeSellPremiumPct, String(objDefaults.buyHedgeSellPremiumPct)),
        strangleDeltaDiffReplaceEnabled: isStrangleOptionsStrategy(pStrategyCode)
            ? normalizeBooleanValue(objUiState.strangleDeltaDiffReplaceEnabled, Boolean(objDefaults.strangleDeltaDiffReplaceEnabled))
            : false,
        strangleDeltaDiffReplacePct: isStrangleOptionsStrategy(pStrategyCode)
            ? normalizeStringValue(objUiState.strangleDeltaDiffReplacePct, String(objDefaults.strangleDeltaDiffReplacePct))
            : "50",
        buyHedgeOppositeLegOnGate: pStrategyCode === "covered-options"
            ? normalizeBooleanValue(objUiState.buyHedgeOppositeLegOnGate, Boolean(objDefaults.buyHedgeOppositeLegOnGate))
            : false,
        buyQtyPercentEnabled: isStrangleOptionsStrategy(pStrategyCode)
            ? false
            : normalizeBooleanValue(objUiState.buyQtyPercentEnabled, Boolean(objDefaults.buyQtyPercentEnabled)),
        buyQtyPercent: isStrangleOptionsStrategy(pStrategyCode)
            ? "100"
            : normalizeCoveredBuyQtyPercentString(objUiState.buyQtyPercent ?? objDefaults.buyQtyPercent),
        strangleReopenAtNewD: isStrangleOptionsStrategy(pStrategyCode)
            ? normalizeBooleanValue(objUiState.strangleReopenAtNewD, Boolean(objDefaults.strangleReopenAtNewD))
            : false,
        autoConfirmLiveActions: normalizeBooleanValue(objUiState.autoConfirmLiveActions, Boolean(objDefaults.autoConfirmLiveActions)),
        telegramAlertTypes: Array.from(new Set(arrTelegramPrefs)),
        closedFromDate: String(objUiState.closedFromDate || "").trim(),
        closedToDate: String(objUiState.closedToDate || "").trim()
    };
    [1, ...(isCoveredLikeStrategy(pStrategyCode) ? [2] : [])].forEach((vRowIndex) => {
        const objRowState = getNormalizedOptionRowUiState(objUiState, pStrategyCode, vRowIndex);
        const objKeys = getOptionRowStateKeys(pStrategyCode, vRowIndex);
        objNormalizedUiState[objKeys.action] = objRowState.action;
        objNormalizedUiState[objKeys.legs] = objRowState.legs;
        objNormalizedUiState[objKeys.expiryMode] = objRowState.expiryMode;
        objNormalizedUiState[objKeys.expiryDate] = objRowState.expiryDate;
        objNormalizedUiState[objKeys.qty] = objRowState.qty;
        objNormalizedUiState[objKeys.newD] = objRowState.newD;
        objNormalizedUiState[objKeys.reD] = objRowState.reD;
        objNormalizedUiState[objKeys.tpD] = objRowState.tpD;
        objNormalizedUiState[objKeys.slD] = objRowState.slD;
        objNormalizedUiState[objKeys.reEnter] = objRowState.reEnter;
    });
    return {
        ...getDefaultRollingFuturesLtProfile(pUserId, pStrategyCode),
        ...pIncoming,
        userId: pUserId,
        strategyCode: pStrategyCode,
        selectedApiProfileId: String(pIncoming.selectedApiProfileId || "").trim(),
        uiState: objNormalizedUiState,
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
        totalBalance: number;
        availableBalance: number;
        blockedMargin: number;
        blockedMarginDisplay: number;
        blockedMarginHint: string;
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
        const objPositionsApi = client.apis.Positions;
        const [objWalletResponse, objPositionsResponse] = await Promise.all([
            client.apis.Wallet.getBalances(),
            typeof objPositionsApi?.getMarginedPositions === "function"
                ? objPositionsApi.getMarginedPositions({})
                : (typeof objPositionsApi?.getPositions === "function"
                    ? objPositionsApi.getPositions({})
                    : Promise.resolve(null))
        ]);
        const objPayload = readResponsePayload(objWalletResponse);
        const arrRows = Array.isArray(objPayload.result) ? objPayload.result as DeltaWalletBalanceRow[] : [];
        const objUsdRow = pickUsdBalanceRow(arrRows);
        const objPositionsPayload = objPositionsResponse ? readResponsePayload(objPositionsResponse) : {};
        const arrPositions = Array.isArray(objPositionsPayload.result)
            ? objPositionsPayload.result as DeltaPositionRow[]
            : (objPositionsPayload.result ? [objPositionsPayload.result as DeltaPositionRow] : []);
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
        const objBlockedMarginDetails = getBlockedMarginDisplayDetails(objUsdRow);
        const vTrackedPositionMargin = getTrackedPositionMarginTotal(arrPositions, "BTC")
            + getTrackedPositionMarginTotal(arrPositions, "ETH");
        const vTrackedPositiveUnrealizedPnl = getTrackedPositionPositiveUnrealizedPnlTotal(arrPositions, "BTC")
            + getTrackedPositionPositiveUnrealizedPnlTotal(arrPositions, "ETH");
        const vBaseBlockedMargin = Math.max(objBlockedMarginDetails.blockedMargin, vTrackedPositionMargin);
        const vBlockedMarginDisplay = vBaseBlockedMargin + vTrackedPositiveUnrealizedPnl;
        const vBlockedMarginHint = vTrackedPositiveUnrealizedPnl > 0
            ? `Blocked ${vBaseBlockedMargin.toFixed(2)} + Unrealized PnL ${vTrackedPositiveUnrealizedPnl.toFixed(2)}`
            : (vBaseBlockedMargin > 0 ? `Blocked ${vBaseBlockedMargin.toFixed(2)}` : objBlockedMarginDetails.hint);
        return {
            profile: await saveRollingFuturesLtProfile({
                ...objProfile,
                selectedApiProfileId: vProfileId,
                connectionStatus: objStatus
            }),
            summary: {
                currency: String(objUsdRow?.asset_symbol || objUsdRow?.symbol || "USD").toUpperCase(),
                totalBalance: Number(getTotalBalanceUsd(objUsdRow).toFixed(2)),
                availableBalance: Number(getAvailableBalanceUsd(objUsdRow).toFixed(2)),
                blockedMargin: Number(vBlockedMarginDisplay.toFixed(2)),
                blockedMarginDisplay: Number(vBlockedMarginDisplay.toFixed(2)),
                blockedMarginHint: vBlockedMarginHint
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
    pSymbolOverride?: string,
    pIncludeAllCoveredLikePositions = false
): Promise<RollingFuturesLtImportedPositionRecord[]> {
    let vSymbol: "BTC" | "ETH" = "BTC";
    let arrSavedPositions: RollingFuturesLtImportedPositionRecord[] = [];
    try {
        let objProfile = await readLiveProfile(pUserId, pStrategyCode);
        let objUiState = getMergedUiState(objProfile);
        vSymbol = normalizeSymbolValue(pSymbolOverride || objUiState.symbol);
        arrSavedPositions = await listRollingFuturesLtImportedPositions(pUserId, pStrategyCode);
    }
    catch (objError) {
        if (!isPrimaryDatabaseUnavailableError(objError)) {
            throw objError;
        }
        const objSurvival = await getSurvivalState(pUserId, pStrategyCode);
        vSymbol = normalizeSymbolValue(pSymbolOverride || objSurvival?.symbol || objSurvival?.uiState?.symbol);
        arrSavedPositions = Array.isArray(objSurvival?.openPositions)
            ? objSurvival!.openPositions.map((objPosition, pIndex) => mapLivePosition({
                product_symbol: String(objPosition.contractName || ""),
                size: Number(objPosition.qty || 0),
                entry_price: Number(objPosition.entryPrice || 0),
                mark_price: Number(objPosition.markPrice || 0),
                margin: Number(objPosition.margin || 0),
                liquidation_price: Number(objPosition.liquidationPrice || 0),
                realized_pnl: 0,
                unrealized_pnl: Number(objPosition.pnl || 0)
            }, pStrategyCode, pUserId, pIndex))
            : [];
    }
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
    const arrLivePositions = arrRows
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

    if (!isCoveredLikeStrategy(pStrategyCode) || pIncludeAllCoveredLikePositions) {
        return arrLivePositions;
    }

    const arrTrackedPositions = arrSavedPositions.filter((objRow) => {
        const vContract = String(objRow.contractName || "").trim().toUpperCase();
        const vSide = String(objRow.side || "").trim().toUpperCase();
        return !!vContract && (vSide === "BUY" || vSide === "SELL");
    });
    if (!arrTrackedPositions.length) {
        return [];
    }

    const objTrackedKeys = new Set(arrTrackedPositions.map((objRow) =>
        `${String(objRow.contractName || "").trim().toUpperCase()}::${String(objRow.side || "").trim().toUpperCase()}`
    ));
    return arrLivePositions.filter((objRow) =>
        objTrackedKeys.has(`${String(objRow.contractName || "").trim().toUpperCase()}::${String(objRow.side || "").trim().toUpperCase()}`)
    );
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
    const vWalletBlockedMargin = getBlockedMarginUsd(objUsdRow);
    const objBlockedMarginDetails = getBlockedMarginDisplayDetails(objUsdRow);
    const vTrackedPositionMargin = getTrackedPositionMarginTotal(arrPositions, pSymbol);
    const vTrackedPositiveUnrealizedPnl = getTrackedPositionPositiveUnrealizedPnlTotal(arrPositions, pSymbol);
    const vBaseBlockedMargin = Math.max(vWalletBlockedMargin, vTrackedPositionMargin);
    const vBlockedMarginDisplay = vBaseBlockedMargin + vTrackedPositiveUnrealizedPnl;
    const vBlockedMarginHint = vTrackedPositiveUnrealizedPnl > 0
        ? `Blocked ${vBaseBlockedMargin.toFixed(2)} + Unrealized PnL ${vTrackedPositiveUnrealizedPnl.toFixed(2)}`
        : (vBaseBlockedMargin > 0 ? `Blocked ${vBaseBlockedMargin.toFixed(2)}` : objBlockedMarginDetails.hint);
    const vBlockedMargin = vBlockedMarginDisplay;
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
        blockedMarginDisplay: Number.isFinite(vBlockedMarginDisplay) ? Number(vBlockedMarginDisplay.toFixed(2)) : null,
        blockedMarginHint: vBlockedMarginHint,
        availableBalance: Number.isFinite(vAvailableBalance) ? Number(vAvailableBalance.toFixed(2)) : null,
        healthPct: Number.isFinite(vHealthPct) ? vHealthPct : null,
        profileLabel: profile.referenceName || profile.apiKey || "",
        openCount: arrPositions.filter((objRow) => {
            const vContract = String(objRow.product_symbol || objRow.symbol || "").trim().toUpperCase();
            const vQty = Math.abs(toFiniteNumber(objRow.net_size ?? objRow.size, 0));
            return isTrackedContractForSymbol(vContract, pSymbol) && vQty > 0;
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
        const vDeltaRaw = bIsFuture
            ? 1
            : getSignedOptionBaseDelta(vContractName, Number(objTicker?.delta || 0));
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
        const vDisplayDeltaSigned = bIsFuture
            ? 1
            : (
                Number.isFinite(Number(objMetadata.manualTraderDelta))
                    ? Number(objMetadata.manualTraderDelta)
                    : (Number.isFinite(Number(objMetadata.baseDelta))
                        ? Number(objMetadata.baseDelta)
                        : (inferTrackedOptionLegSide(vContractName) === "pe" ? -Math.abs(vDeltaRaw) : Math.abs(vDeltaRaw)))
            );
        const vDisplayThetaCurrentTotal = bIsFuture
            ? 0
            : Math.abs(Number.isFinite(vThetaRaw) ? vThetaRaw : 0);
        const vBaseThetaRaw = Math.abs(Number.isFinite(Number(objMetadata.baseTheta))
            ? Number(objMetadata.baseTheta)
            : (Number.isFinite(vThetaRaw) ? vThetaRaw : 0));
        const vDisplayThetaBaseTotal = bIsFuture
            ? 0
            : Math.abs(vBaseThetaRaw);
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
            deltaDisplayPerContract: Number((vSideMultiplier * vDisplayDeltaSigned).toFixed(6)),
            deltaDisplayTotal: Number((vSideMultiplier * vDisplayDeltaSigned * vQty).toFixed(6)),
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
    pStrategyCode: RollingFuturesLtStrategyCode,
    pUiState: Record<string, unknown>,
    pTotals: RollingFuturesLtOpenPositionTotals,
    pAutoTraderEnabled: boolean,
    pRuntime: RollingFuturesLtRuntimeRecord | null = null
): RollingFuturesLtNeutralStatus {
    if (isCoveredLikeStrategy(pStrategyCode)) {
        return {
            mode: "none",
            totalDelta: Number(Number(pTotals.totalDelta || 0).toFixed(6)),
            totalTheta: Number(Number(pTotals.totalTheta || 0).toFixed(6)),
            totalGamma: Number(Number(pTotals.totalGamma || 0).toFixed(6)),
            minDelta: null,
            maxDelta: null,
            deltaDriftPct: null,
            baseOptionDeltaAbs: null,
            effectiveBaseOptionDeltaAbs: null,
            baselineFloorDeltaAbs: null,
            gammaFactor: null,
            deltaBalanceTone: "secondary",
            deltaBalanceText: "Balance: Mode OFF"
        };
    }
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
            effectiveBaseOptionDeltaAbs: null,
            baselineFloorDeltaAbs: null,
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
    const bDualScaledMode = isDualScaledNeutralMode(pStrategyCode, vMode);
    const vBaselineFloorDeltaAbs = bDualScaledMode && objDeltaBaseline.entryOptionDeltaAbs > 0
        ? Number((objDeltaBaseline.entryOptionDeltaAbs * gDualScaledBaselineFloorRatio).toFixed(6))
        : null;
    const vEffectiveBaseOptionDeltaAbs = bDualScaledMode
        ? Number(Math.max(vBaseOptionDeltaAbs, Number(vBaselineFloorDeltaAbs || 0)).toFixed(6))
        : vBaseOptionDeltaAbs;
    const bPctDriftMode = vMode === "delta" || vMode === "gamma";
    const vDeltaDriftPct = bPctDriftMode && vEffectiveBaseOptionDeltaAbs > 0
        ? Number(((vTotalDelta / vEffectiveBaseOptionDeltaAbs) * 100).toFixed(6))
        : null;
    const vGammaFactorValue = vMode === "gamma" && !bDualScaledMode
        ? getGammaAwareCompressionFactor(vTotalGamma)
        : 0;
    const vGammaFactor = vMode === "gamma" && !bDualScaledMode ? vGammaFactorValue : null;
    const vGammaMinDelta = vMode === "gamma" && !bDualScaledMode && vGammaFactorValue > 0
        ? Number((vMinDelta / vGammaFactorValue).toFixed(6))
        : null;
    const vGammaMaxDelta = vMode === "gamma" && !bDualScaledMode && vGammaFactorValue > 0
        ? Number((vMaxDelta / vGammaFactorValue).toFixed(6))
        : null;

    let vDeltaBalanceTone: RollingFuturesLtNeutralStatus["deltaBalanceTone"] = "secondary";
    let vDeltaBalanceText = "Balance: Mode OFF";
    if (vMode === "delta" || vMode === "gamma") {
        if (!(vEffectiveBaseOptionDeltaAbs > 0) || !Number.isFinite(Number(vDeltaDriftPct))) {
            vDeltaBalanceTone = "secondary";
            vDeltaBalanceText = bDualScaledMode
                ? "Balance: Waiting for scaled baseline"
                : "Balance: Waiting for hedge baseline";
        }
        else {
            const vSafeDriftPct = Number(vDeltaDriftPct);
            const vActiveMin = vMode === "gamma" && !bDualScaledMode && Number.isFinite(vGammaMinDelta) ? Number(vGammaMinDelta) : vMinDelta;
            const vActiveMax = vMode === "gamma" && !bDualScaledMode && Number.isFinite(vGammaMaxDelta) ? Number(vGammaMaxDelta) : vMaxDelta;
            if (vSafeDriftPct >= vActiveMin && vSafeDriftPct <= vActiveMax) {
                const vHeadroom = Math.min(vSafeDriftPct - vActiveMin, vActiveMax - vSafeDriftPct);
                vDeltaBalanceTone = "success";
                vDeltaBalanceText = bDualScaledMode
                    ? `Balance: Scaled-safe (${vHeadroom.toFixed(2)}% left)`
                    : (vMode === "gamma"
                    ? `Balance: Gamma-safe (${vHeadroom.toFixed(2)}% left)`
                    : `Balance: Balanced (${vHeadroom.toFixed(2)}% left)`);
            }
            else {
                const vOverBy = vSafeDriftPct < vActiveMin ? (vActiveMin - vSafeDriftPct) : (vSafeDriftPct - vActiveMax);
                vDeltaBalanceTone = "danger";
                vDeltaBalanceText = bDualScaledMode
                    ? `Balance: Scaled hedge (${Math.abs(vOverBy).toFixed(2)}% over)`
                    : (vMode === "gamma"
                    ? `Balance: Gamma hedge (${Math.abs(vOverBy).toFixed(2)}% over)`
                    : `Balance: Hedge Trigger (${Math.abs(vOverBy).toFixed(2)}% over)`);
            }
        }
    }
    else if (vMode === "theta") {
        const vThetaAbs = Math.abs(Number(pTotals.totalTheta || 0));
        const vThetaMinDelta = Number((vThetaAbs * Math.abs(vMinDelta) / 100 * -1).toFixed(6));
        const vThetaMaxDelta = Number((vThetaAbs * Math.abs(vMaxDelta) / 100).toFixed(6));
        if (!(vThetaAbs > 0)) {
            vDeltaBalanceTone = "secondary";
            vDeltaBalanceText = "Balance: Waiting for theta";
        }
        else if (vTotalDelta >= vThetaMinDelta && vTotalDelta <= vThetaMaxDelta) {
            const vHeadroom = Math.min(vTotalDelta - vThetaMinDelta, vThetaMaxDelta - vTotalDelta);
            vDeltaBalanceTone = "success";
            vDeltaBalanceText = `Balance: Theta-safe (${vHeadroom.toFixed(3)} left)`;
        }
        else {
            const vOverBy = vTotalDelta < vThetaMinDelta ? (vThetaMinDelta - vTotalDelta) : (vTotalDelta - vThetaMaxDelta);
            vDeltaBalanceTone = "danger";
            vDeltaBalanceText = `Balance: Theta hedge (${Math.abs(vOverBy).toFixed(3)} over)`;
        }
    }

    return {
        mode: vMode,
        totalDelta: Number(vTotalDelta.toFixed(6)),
        totalTheta: Number(Number(pTotals.totalTheta || 0).toFixed(6)),
        totalGamma: Number(vTotalGamma.toFixed(6)),
        minDelta: vMode === "delta"
            ? vMinDelta
            : (vMode === "theta"
                ? Number((Math.abs(Number(pTotals.totalTheta || 0)) * Math.abs(vMinDelta) / 100 * -1).toFixed(6))
                : (vMode === "gamma" && !bDualScaledMode && Number.isFinite(vGammaMinDelta) ? Number(vGammaMinDelta) : vMinDelta)),
        maxDelta: vMode === "delta"
            ? vMaxDelta
            : (vMode === "theta"
                ? Number((Math.abs(Number(pTotals.totalTheta || 0)) * Math.abs(vMaxDelta) / 100).toFixed(6))
                : (vMode === "gamma" && !bDualScaledMode && Number.isFinite(vGammaMaxDelta) ? Number(vGammaMaxDelta) : vMaxDelta)),
        deltaDriftPct: bPctDriftMode && Number.isFinite(Number(vDeltaDriftPct)) ? Number(vDeltaDriftPct) : null,
        baseOptionDeltaAbs: bPctDriftMode && vBaseOptionDeltaAbs > 0 ? Number(vBaseOptionDeltaAbs.toFixed(6)) : null,
        effectiveBaseOptionDeltaAbs: bPctDriftMode && vEffectiveBaseOptionDeltaAbs > 0 ? Number(vEffectiveBaseOptionDeltaAbs.toFixed(6)) : null,
        baselineFloorDeltaAbs: bDualScaledMode && Number(vBaselineFloorDeltaAbs || 0) > 0 ? Number(vBaselineFloorDeltaAbs) : null,
        gammaFactor: vMode === "gamma" && !bDualScaledMode && Number.isFinite(Number(vGammaFactor)) ? Number(vGammaFactor) : null,
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
    const bCoveredOptionsRecoveryBaseline = isCoveredLikeStrategy(pStrategyCode);
    let arrPositions = pPositions || await listRollingFuturesLtImportedPositions(pUserId, pStrategyCode);
    const objNormalizedBaseDeltaSigns = normalizeTrackedOptionBaseDeltaSigns(arrPositions);
    if (objNormalizedBaseDeltaSigns.changed) {
        arrPositions = objNormalizedBaseDeltaSigns.positions;
        await replaceRollingFuturesLtImportedPositions(pUserId, pStrategyCode, arrPositions);
    }
    if (arrPositions.some(hasMissingTrackedOptionBaseGreeks)) {
        arrPositions = await applyImportedOptionBaseGreeks(arrPositions, Number(objUiState.newD1 || 0));
        await replaceRollingFuturesLtImportedPositions(pUserId, pStrategyCode, arrPositions);
    }
    const objEnriched = await enrichTrackedOpenPositions(arrPositions);
    const bAutoTraderActive = Boolean(objRuntime?.autoTraderEnabled)
        && String(objRuntime?.status || "").trim().toLowerCase() === "running";
    const vRuntimeBrokerageTotal = getBrokerageRecoveryTotal(objRuntime);
    const vOpenPositionCharges = Number(objEnriched.totals.totalCharges || 0);
    const vEffectiveBrokerageTotal = bCoveredOptionsRecoveryBaseline
        ? Number(vRuntimeBrokerageTotal.toFixed(4))
        : (objEnriched.positions.length > 0
        ? Math.max(vRuntimeBrokerageTotal, vOpenPositionCharges)
        : vRuntimeBrokerageTotal);
    const vRecoveredTotalPnl = getRecoveredTotalPnl(objRuntime);
    const objOpenPnlSnapshot = getOpenPnlSnapshotState(objRuntime);
    const arrCurrentPositionKeys = arrPositions.map((pPosition) => getTrackedPositionIdentityKey(pPosition));
    const vCurrentOpenPnl = Number(Number(objEnriched.totals.totalPnl || 0).toFixed(4));
    const bAllOpenPositionPnlsZero = objEnriched.positions.length > 0
        && objEnriched.positions.every((pPosition) => {
            const vDynamicPnl = pPosition.contractKind === "future"
                ? getTrackedFutureUnrealizedPnl(pPosition)
                : Number(pPosition.pnl || 0);
            return Math.abs(Number(vDynamicPnl || 0)) < 0.000001;
        });
    const bSameSnapshotPositions = areSameTrackedPositionKeys(arrCurrentPositionKeys, objOpenPnlSnapshot.positionKeys);
    const vSnapshotAgeMs = Number.isFinite(new Date(objOpenPnlSnapshot.capturedAt).getTime())
        ? (Date.now() - new Date(objOpenPnlSnapshot.capturedAt).getTime())
        : Number.POSITIVE_INFINITY;
    const bRecentNonZeroSnapshot = Math.abs(Number(objOpenPnlSnapshot.totalPnl || 0)) >= 0.0001
        && vSnapshotAgeMs >= 0
        && vSnapshotAgeMs <= 2 * 60 * 1000;
    const bSuspiciousOpenPnlZero = objEnriched.positions.length > 0
        && bAllOpenPositionPnlsZero
        && bSameSnapshotPositions
        && bRecentNonZeroSnapshot;
    const vEffectiveOpenPnl = bSuspiciousOpenPnlZero
        ? Number(objOpenPnlSnapshot.totalPnl || 0)
        : vCurrentOpenPnl;
    const vCoveredNetBrokerageBase = Number((vRuntimeBrokerageTotal + vOpenPositionCharges).toFixed(4));
    const vCoveredNetPnl = Number((vRecoveredTotalPnl + vEffectiveOpenPnl - vCoveredNetBrokerageBase).toFixed(4));
    if (!arrCurrentPositionKeys.length) {
        if (objOpenPnlSnapshot.positionKeys.length) {
            await saveRollingFuturesLtRuntime({
                ...(objRuntime || getDefaultRollingFuturesLtRuntime(pUserId, pStrategyCode)),
                userId: pUserId,
                strategyCode: pStrategyCode,
                state: buildRuntimeStateWithOpenPnlSnapshot(objRuntime, null)
            });
        }
    }
    else if (Number.isFinite(vCurrentOpenPnl) && !bSuspiciousOpenPnlZero) {
        const vRoundedCurrentOpenPnl = Number(vCurrentOpenPnl.toFixed(4));
        const bSnapshotChanged = Number(objOpenPnlSnapshot.totalPnl || 0) !== vRoundedCurrentOpenPnl
            || !bSameSnapshotPositions;
        if (bSnapshotChanged) {
            await saveRollingFuturesLtRuntime({
                ...(objRuntime || getDefaultRollingFuturesLtRuntime(pUserId, pStrategyCode)),
                userId: pUserId,
                strategyCode: pStrategyCode,
                state: buildRuntimeStateWithOpenPnlSnapshot(
                    objRuntime,
                    vRoundedCurrentOpenPnl,
                    arrCurrentPositionKeys,
                    new Date().toISOString()
                )
            });
        }
    }
    return {
        positions: objEnriched.positions,
        totals: objEnriched.totals,
        neutralStatus: buildNeutralStatus(pStrategyCode, objUiState, objEnriched.totals, bAutoTraderActive, objRuntime),
        recoveryMetrics: {
            totalBrokerageToRecover: Number(vEffectiveBrokerageTotal.toFixed(4)),
            totalPnl: Number(vRecoveredTotalPnl.toFixed(4)),
            netPnl: bCoveredOptionsRecoveryBaseline
                ? vCoveredNetPnl
                : Number((vRecoveredTotalPnl + vEffectiveOpenPnl - vEffectiveBrokerageTotal).toFixed(4))
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

function getCoveredLiveConfirmationState(
    pRuntime: RollingFuturesLtRuntimeRecord | null
): CoveredLiveConfirmationState | null {
    const objState = (pRuntime?.state || {}) as Record<string, unknown>;
    const objEntry = objState.pendingCoveredLiveConfirmation && typeof objState.pendingCoveredLiveConfirmation === "object"
        ? objState.pendingCoveredLiveConfirmation as Record<string, unknown>
        : null;
    if (!objEntry) {
        return null;
    }
    const vKind = String(objEntry.kind || "").trim();
    if (vKind !== "exec_batch" && vKind !== "option_rule_close" && vKind !== "covered_reentry" && vKind !== "manual_swap") {
        return null;
    }
    return {
        actionId: String(objEntry.actionId || "").trim(),
        kind: vKind,
        title: String(objEntry.title || "").trim(),
        message: String(objEntry.message || "").trim(),
        createdAt: String(objEntry.createdAt || "").trim(),
        payload: objEntry.payload && typeof objEntry.payload === "object"
            ? objEntry.payload as Record<string, unknown>
            : {}
    };
}

function buildRuntimeStateWithCoveredLiveConfirmation(
    pRuntime: RollingFuturesLtRuntimeRecord | null,
    pAction: CoveredLiveConfirmationState | null
): Record<string, unknown> {
    const objState = { ...((pRuntime?.state || {}) as Record<string, unknown>) };
    if (!pAction) {
        delete objState.pendingCoveredLiveConfirmation;
        return objState;
    }
    objState.pendingCoveredLiveConfirmation = {
        actionId: String(pAction.actionId || "").trim() || crypto.randomUUID(),
        kind: pAction.kind,
        title: String(pAction.title || "").trim(),
        message: String(pAction.message || "").trim(),
        createdAt: String(pAction.createdAt || "").trim() || new Date().toISOString(),
        payload: pAction.payload && typeof pAction.payload === "object" ? pAction.payload : {}
    };
    return objState;
}

type CoveredPendingOptionReEntryState = {
    dedupeKey: string;
    rowIndex: 1 | 2;
    legSide: "ce" | "pe";
    action: "buy" | "sell";
    qty: number;
    reason: "sl" | "tp" | "expiry_cutoff" | "missing_leg";
    targetDelta: number;
    expiryMode: string;
    expiryDate: string;
    runAt: string;
    scheduledAt: string;
    attemptCount: number;
    closedContractName: string;
    lastError: string;
};

function getCoveredPendingOptionReEntriesState(
    pRuntime: RollingFuturesLtRuntimeRecord | null
): CoveredPendingOptionReEntryState[] {
    const objState = (pRuntime?.state || {}) as Record<string, unknown>;
    const arrPending = Array.isArray(objState.pendingCoveredOptionReEntries)
        ? objState.pendingCoveredOptionReEntries as Array<Record<string, unknown>>
        : [];
    return arrPending.map((objEntry) => {
        const vRowIndex = normalizeOptionRowIndex("covered-options", objEntry.rowIndex);
        const vLegSide = String(objEntry.legSide || "").trim().toLowerCase() === "pe" ? "pe" : "ce";
        const vAction = String(objEntry.action || "").trim().toLowerCase() === "buy" ? "buy" : "sell";
        const vReason = String(objEntry.reason || "").trim().toLowerCase();
        return {
            dedupeKey: String(objEntry.dedupeKey || `${vRowIndex}:${vLegSide}`).trim() || `${vRowIndex}:${vLegSide}`,
            rowIndex: vRowIndex,
            legSide: vLegSide,
            action: vAction,
            qty: Math.max(1, Math.floor(Number(objEntry.qty || 1))),
            reason: vReason === "sl" || vReason === "tp" || vReason === "expiry_cutoff" || vReason === "missing_leg"
                ? vReason
                : "missing_leg",
            targetDelta: Math.max(0, Number(objEntry.targetDelta || 0)),
            expiryMode: String(objEntry.expiryMode || "").trim(),
            expiryDate: String(objEntry.expiryDate || "").trim(),
            runAt: String(objEntry.runAt || "").trim(),
            scheduledAt: String(objEntry.scheduledAt || "").trim(),
            attemptCount: Math.max(0, Math.floor(Number(objEntry.attemptCount || 0))),
            closedContractName: String(objEntry.closedContractName || "").trim(),
            lastError: String(objEntry.lastError || "").trim()
        } satisfies CoveredPendingOptionReEntryState;
    }).filter((objEntry) => Boolean(objEntry.runAt) && Boolean(objEntry.scheduledAt));
}

function buildRuntimeStateWithCoveredPendingOptionReEntries(
    pRuntime: RollingFuturesLtRuntimeRecord | null,
    pEntries: CoveredPendingOptionReEntryState[]
): Record<string, unknown> {
    const objState = { ...((pRuntime?.state || {}) as Record<string, unknown>) };
    if (!Array.isArray(pEntries) || !pEntries.length) {
        delete objState.pendingCoveredOptionReEntries;
        return objState;
    }
    objState.pendingCoveredOptionReEntries = pEntries.map((objEntry) => ({
        dedupeKey: objEntry.dedupeKey,
        rowIndex: normalizeOptionRowIndex("covered-options", objEntry.rowIndex),
        legSide: objEntry.legSide === "pe" ? "pe" : "ce",
        action: objEntry.action === "buy" ? "buy" : "sell",
        qty: Math.max(1, Math.floor(Number(objEntry.qty || 1))),
        reason: objEntry.reason,
        targetDelta: Math.max(0, Number(objEntry.targetDelta || 0)),
        expiryMode: String(objEntry.expiryMode || "").trim(),
        expiryDate: String(objEntry.expiryDate || "").trim(),
        runAt: String(objEntry.runAt || "").trim(),
        scheduledAt: String(objEntry.scheduledAt || "").trim(),
        attemptCount: Math.max(0, Math.floor(Number(objEntry.attemptCount || 0))),
        closedContractName: String(objEntry.closedContractName || "").trim(),
        lastError: String(objEntry.lastError || "").trim()
    }));
    return objState;
}

function getPendingOptionRecoveryRefreshState(pRuntime: RollingFuturesLtRuntimeRecord | null): {
    reason: "sl" | "tp" | "";
    runAt: string;
    scheduledAt: string;
} {
    const objState = (pRuntime?.state || {}) as Record<string, unknown>;
    const objPending = objState.pendingOptionRecoveryRefresh && typeof objState.pendingOptionRecoveryRefresh === "object"
        ? objState.pendingOptionRecoveryRefresh as Record<string, unknown>
        : {};
    const vReason = String(objPending.reason || "").trim().toLowerCase();
    return {
        reason: vReason === "sl" || vReason === "tp" ? vReason : "",
        runAt: String(objPending.runAt || "").trim(),
        scheduledAt: String(objPending.scheduledAt || "").trim()
    };
}

function buildRuntimeStateWithPendingOptionRecoveryRefresh(
    pRuntime: RollingFuturesLtRuntimeRecord | null,
    pReason: "sl" | "tp" | "" = "",
    pRunAt = "",
    pScheduledAt = ""
): Record<string, unknown> {
    const objState = { ...((pRuntime?.state || {}) as Record<string, unknown>) };
    const vReason = String(pReason || "").trim().toLowerCase();
    const vRunAt = String(pRunAt || "").trim();
    const vScheduledAt = String(pScheduledAt || "").trim();
    if (!(vReason === "sl" || vReason === "tp") || !vRunAt || !vScheduledAt) {
        delete objState.pendingOptionRecoveryRefresh;
        return objState;
    }
    objState.pendingOptionRecoveryRefresh = {
        reason: vReason,
        runAt: vRunAt,
        scheduledAt: vScheduledAt
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
    pStrategyCode: RollingFuturesLtStrategyCode,
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
    const vBlockedMargin = isCoveredOptionsStrategy(pStrategyCode)
        ? getCoveredRequiredMarginForMultiplier(pUiState.startQty, pStrategyCode)
        : Math.max(0, Number(pSummary?.blockedMargin || 0));
    if (bBlockedMarginEnabled && vBlockedMarginPct > 0 && vBlockedMargin > 0) {
        const vThreshold = vBlockedMargin * (vBlockedMarginPct / 100);
        if (vNetProfit >= vThreshold) {
            return {
                triggered: true,
                reason: "blockmargin",
                message: `Net PnL ${vNetProfit.toFixed(2)} reached the blocked-margin target ${vThreshold.toFixed(2)}${isCoveredOptionsStrategy(pStrategyCode) ? ` using configured blocked margin ${vBlockedMargin.toFixed(2)}` : ""}.`,
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
    pStrategyCode: RollingFuturesLtStrategyCode,
    pSelectedApiProfileId: string,
    pSymbol: "BTC" | "ETH",
    pAction: "BUY" | "SELL",
    pQty: number,
    pOrderType: "limit_order" | "market_order",
    pOrderKind: "HG" | "CL" = "HG"
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
    const vClientOrderId = await allocateStrategyClientOrderId(pUserId, pStrategyCode, pOrderKind);
    const objOrderPayload: Record<string, unknown> = {
        product_symbol: vContractName,
        size: vQty,
        side: vSide,
        order_type: pOrderType,
        time_in_force: "gtc",
        post_only: pOrderType === "limit_order",
        reduce_only: false,
        ...(vClientOrderId ? { client_order_id: vClientOrderId } : {})
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

    const bDuplicateWithinCooldown = await hasRecentRollingOptionsEventMatch(
        pUserId,
        pStrategyCode,
        pEventType,
        pTitle,
        pMessage,
        gDuplicateLiveEventCooldownMs
    );
    if (bDuplicateWithinCooldown) {
        return;
    }

    await saveRollingOptionsEvent(objEvent);
    await sendFuturesTelegramForEvent(pUserId, objEvent);
}

function isCoveredLiveAutoConfirmEnabled(pProfile: RollingFuturesLtProfileRecord): boolean {
    return Boolean(getMergedUiState(pProfile).autoConfirmLiveActions);
}

function buildCoveredLiveConfirmationTelegramText(
    pPending: CoveredLiveConfirmationState
): string {
    const arrLines = [
        "Optionyze Live Confirmation",
        "",
        String(pPending.title || "Pending Confirmation"),
        String(pPending.message || ""),
        "",
        "Reply with Confirm or Cancel, or tap the buttons below."
    ];
    return arrLines.join("\n");
}

function buildCoveredLiveConfirmationPushCopy(
    pPending: CoveredLiveConfirmationState,
    pStrategyCode: RollingFuturesLtStrategyCode
): {
    title: string;
    message: string;
} {
    const objPayload = pPending.payload && typeof pPending.payload === "object"
        ? pPending.payload
        : {};
    const vReason = String(objPayload.reason || "").trim().toLowerCase();
    const vContractName = String(
        objPayload.contractName
        || objPayload.closedContractName
        || ""
    ).trim();
    const arrInputs = Array.isArray(objPayload.inputs)
        ? objPayload.inputs as Array<Record<string, unknown>>
        : [];
    const vExecSymbol = String(
        objPayload.symbol
        || arrInputs[0]?.symbol
        || ""
    ).trim().toUpperCase();
    const vExecRowCount = arrInputs.length;
    const vTitleContext = (pBaseTitle: string, pContext: string): string => {
        const vContext = String(pContext || "").trim();
        return vContext ? `${pBaseTitle} | ${vContext}` : pBaseTitle;
    };
    const vLegText = getCoveredLikeLegText(pStrategyCode);
    const vPositionText = getCoveredLikePositionText(pStrategyCode);
    const vStrategyLabel = getCoveredLikeStrategyLabel(pStrategyCode);

    if (pPending.kind === "option_rule_close") {
        if (vReason === "sl") {
            return {
                title: vTitleContext("SL Trigger", vContractName),
                message: `Stop-loss trigger hit. Confirm to close this ${vLegText}.`
            };
        }
        if (vReason === "tp") {
            return {
                title: vTitleContext("TP Trigger", vContractName),
                message: `Take-profit trigger hit. Confirm to close this ${vLegText}.`
            };
        }
        if (vReason === "expiry_cutoff") {
            return {
                title: vTitleContext("Replacement Ready", vContractName),
                message: `Expiry replacement is ready. Confirm to reopen this ${vLegText}.`
            };
        }
    }

    if (pPending.kind === "exec_batch") {
        return {
            title: vTitleContext("Exec Strategy", vExecSymbol),
            message: `${vStrategyLabel} Exec Strategy is ready. Confirm to place ${Math.max(1, vExecRowCount)} row${Math.max(1, vExecRowCount) === 1 ? "" : "s"}${vExecSymbol ? ` for ${vExecSymbol}` : ""}.`
        };
    }

    if (pPending.kind === "covered_reentry") {
        return {
            title: vTitleContext("Re-entry Ready", vContractName),
            message: `Replacement leg is ready. Confirm to reopen the ${vPositionText}.`
        };
    }

    if (pPending.kind === "manual_swap") {
        return {
            title: vTitleContext("Replacement Ready", vContractName),
            message: `${vStrategyLabel} swap is ready. Confirm to replace this ${vLegText}.`
        };
    }

    return {
        title: String(pPending.title || "Optionyze Live Confirmation").trim() || "Optionyze Live Confirmation",
        message: String(pPending.message || `Confirm the ${getCoveredLikeLowerLabel(pStrategyCode)} action.`).trim() || `Confirm the ${getCoveredLikeLowerLabel(pStrategyCode)} action.`
    };
}

async function sendCoveredLiveConfirmationTelegramPrompt(
    pUserId: string,
    pPending: CoveredLiveConfirmationState
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

    const vActionId = String(pPending.actionId || "").trim();
    const objReplyMarkup: TelegramInlineKeyboardMarkup = {
        inline_keyboard: [[
            { text: "Confirm", callback_data: `coa:c:${vActionId}` },
            { text: "Cancel", callback_data: `coa:r:${vActionId}` }
        ]]
    };
    await sendTelegramBotMessage(vBotToken, vTelegramChatId, buildCoveredLiveConfirmationTelegramText(pPending), objReplyMarkup);
}

async function requestCoveredLiveConfirmation(
    pUserId: string,
    pProfile: RollingFuturesLtProfileRecord,
    pAction: Omit<CoveredLiveConfirmationState, "actionId" | "createdAt">
): Promise<"auto_confirm" | "queued" | "suppressed"> {
    if (!isCoveredOptionsStrategy(pProfile.strategyCode)) {
        return "auto_confirm";
    }
    if (isCoveredLiveAutoConfirmEnabled(pProfile)) {
        return "auto_confirm";
    }
    const objRuntime = await loadRollingFuturesLtRuntime(pUserId, pProfile.strategyCode)
        || getDefaultRollingFuturesLtRuntime(pUserId, pProfile.strategyCode);
    const objExisting = getCoveredLiveConfirmationState(objRuntime);
    if (objExisting) {
        await logFuturesEvent(
            pUserId,
            pProfile.strategyCode,
            "manual_action",
            "info",
            "Live Action Confirmation Suppressed",
            `Another confirmation is already pending (${objExisting.title}). ${pAction.title} was not queued.`,
            {
                reason: "covered_confirmation_suppressed",
                pendingActionId: objExisting.actionId,
                pendingKind: objExisting.kind
            }
        );
        return "suppressed";
    }
    const objPending: CoveredLiveConfirmationState = {
        actionId: crypto.randomUUID(),
        kind: pAction.kind,
        title: pAction.title,
        message: pAction.message,
        createdAt: new Date().toISOString(),
        payload: pAction.payload
    };
    await saveRollingFuturesLtRuntime({
        ...objRuntime,
        userId: pUserId,
        strategyCode: pProfile.strategyCode,
        state: buildRuntimeStateWithCoveredLiveConfirmation(objRuntime, objPending)
    });
    await logFuturesEvent(
        pUserId,
        pProfile.strategyCode,
        "manual_action",
        "warning",
        "Live Action Confirmation Requested",
        pAction.message,
        {
            reason: "covered_confirmation_requested",
            actionId: objPending.actionId,
            kind: objPending.kind
        }
    );
    const objPushCopy = buildCoveredLiveConfirmationPushCopy(objPending, pProfile.strategyCode);
    void sendMobilePushToAccount(pUserId, {
        title: objPushCopy.title,
        message: objPushCopy.message,
        data: {
            type: "covered_live_confirmation",
            actionId: objPending.actionId,
            kind: objPending.kind,
            strategyCode: pProfile.strategyCode
        }
    }).then((objResult) => {
        if (objResult.failedCount > 0) {
            console.warn(
                `[mobile-push] ${objResult.failedCount}/${objResult.tokenCount} covered confirmation deliveries failed for account ${pUserId}.`
            );
        }
    }).catch((objError) => {
        console.error(`[mobile-push] covered confirmation delivery failed for account ${pUserId}:`, objError);
    });
    void sendCoveredLiveConfirmationTelegramPrompt(pUserId, objPending).catch(() => undefined);
    return "queued";
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
        return "theta";
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
    entryOptionDeltaAbs: number;
    lastHedgeAt: string;
} {
    const objState = (pRuntime?.state || {}) as Record<string, unknown>;
    const objBaseline = objState.deltaNeutralBaseline && typeof objState.deltaNeutralBaseline === "object"
        ? objState.deltaNeutralBaseline as Record<string, unknown>
        : {};
    const vBaseOptionDeltaAbs = Math.abs(Number(objBaseline.baseOptionDeltaAbs || 0));
    const vEntryOptionDeltaAbs = Math.abs(Number(objBaseline.entryOptionDeltaAbs || 0));
    const vLastHedgeAt = String(objBaseline.lastHedgeAt || "").trim();
    return {
        baseOptionDeltaAbs: Number.isFinite(vBaseOptionDeltaAbs) ? vBaseOptionDeltaAbs : 0,
        entryOptionDeltaAbs: Number.isFinite(vEntryOptionDeltaAbs) ? vEntryOptionDeltaAbs : 0,
        lastHedgeAt: vLastHedgeAt
    };
}

function buildRuntimeStateWithDeltaNeutralBaseline(
    pRuntime: RollingFuturesLtRuntimeRecord | null,
    pBaseOptionDeltaAbs: number | null,
    pLastHedgeAt = "",
    pEntryOptionDeltaAbs: number | null = null
): Record<string, unknown> {
    const objState = { ...((pRuntime?.state || {}) as Record<string, unknown>) };
    const objExistingBaseline = getDeltaNeutralBaselineState(pRuntime);
    const vBaseOptionDeltaAbs = Math.abs(Number(pBaseOptionDeltaAbs || 0));
    const vEntryOptionDeltaAbs = Math.abs(Number(
        pEntryOptionDeltaAbs === null
            ? objExistingBaseline.entryOptionDeltaAbs
            : pEntryOptionDeltaAbs || 0
    ));
    const vLastHedgeAt = String(pLastHedgeAt || "").trim();
    if (!(vBaseOptionDeltaAbs > 0) && !(vEntryOptionDeltaAbs > 0)) {
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
        ...(vBaseOptionDeltaAbs > 0
            ? { baseOptionDeltaAbs: Number(vBaseOptionDeltaAbs.toFixed(6)) }
            : {}),
        ...(vEntryOptionDeltaAbs > 0
            ? { entryOptionDeltaAbs: Number(vEntryOptionDeltaAbs.toFixed(6)) }
            : {}),
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

function getOptionReentryPendingUntil(pRuntime: RollingFuturesLtRuntimeRecord | null): string {
    const objState = (pRuntime?.state || {}) as Record<string, unknown>;
    return String(objState.optionReentryPendingUntil || "").trim();
}

function buildRuntimeStateWithOptionReentryPending(
    pRuntime: RollingFuturesLtRuntimeRecord | null,
    pPendingUntil = ""
): Record<string, unknown> {
    const objState = { ...((pRuntime?.state || {}) as Record<string, unknown>) };
    const vPendingUntil = String(pPendingUntil || "").trim();
    if (!vPendingUntil) {
        delete objState.optionReentryPendingUntil;
        return objState;
    }
    objState.optionReentryPendingUntil = vPendingUntil;
    return objState;
}

function getProfitClosePauseUntil(pRuntime: RollingFuturesLtRuntimeRecord | null): string {
    const objState = (pRuntime?.state || {}) as Record<string, unknown>;
    return String(objState.profitClosePauseUntil || "").trim();
}

function buildRuntimeStateWithProfitClosePause(
    pRuntime: RollingFuturesLtRuntimeRecord | null,
    pPauseUntil = ""
): Record<string, unknown> {
    const objState = { ...((pRuntime?.state || {}) as Record<string, unknown>) };
    const vPauseUntil = String(pPauseUntil || "").trim();
    if (!vPauseUntil) {
        delete objState.profitClosePauseUntil;
        return objState;
    }
    objState.profitClosePauseUntil = vPauseUntil;
    return objState;
}

function getStrategyStartedAtState(pRuntime: RollingFuturesLtRuntimeRecord | null): string {
    const objState = (pRuntime?.state || {}) as Record<string, unknown>;
    return String(objState.strategyStartedAt || "").trim();
}

function buildRuntimeStateWithStrategyStartedAt(
    pRuntime: RollingFuturesLtRuntimeRecord | null,
    pStartedAt = ""
): Record<string, unknown> {
    const objState = { ...((pRuntime?.state || {}) as Record<string, unknown>) };
    const vStartedAt = String(pStartedAt || "").trim();
    if (!vStartedAt) {
        delete objState.strategyStartedAt;
        return objState;
    }
    objState.strategyStartedAt = vStartedAt;
    return objState;
}

function getClosedFromDateManualLockState(pRuntime: RollingFuturesLtRuntimeRecord | null): boolean {
    const objState = (pRuntime?.state || {}) as Record<string, unknown>;
    return Boolean(objState.closedFromDateManualLock);
}

function buildRuntimeStateWithClosedFromDateManualLock(
    pRuntime: RollingFuturesLtRuntimeRecord | null,
    pLocked: boolean
): Record<string, unknown> {
    const objState = { ...((pRuntime?.state || {}) as Record<string, unknown>) };
    if (!pLocked) {
        delete objState.closedFromDateManualLock;
        return objState;
    }
    objState.closedFromDateManualLock = true;
    return objState;
}

function getEarliestOpenedAtFromTrackedPositions(
    pPositions: RollingFuturesLtImportedPositionRecord[]
): string {
    const arrCandidates = (Array.isArray(pPositions) ? pPositions : [])
        .map((objPosition) => normalizeDeltaTimestampToIso(objPosition.openedAt))
        .filter(Boolean)
        .sort();
    return arrCandidates[0] || "";
}

function getStrategyRunIdState(pRuntime: RollingFuturesLtRuntimeRecord | null): string {
    const objState = (pRuntime?.state || {}) as Record<string, unknown>;
    return String(objState.strategyRunId || "").trim();
}

function getStrategyRunTagState(pRuntime: RollingFuturesLtRuntimeRecord | null): string {
    const objState = (pRuntime?.state || {}) as Record<string, unknown>;
    return String(objState.strategyRunTag || "").trim().toUpperCase();
}

function getStrategyOrderSequenceState(pRuntime: RollingFuturesLtRuntimeRecord | null): number {
    const objState = (pRuntime?.state || {}) as Record<string, unknown>;
    const vSequence = Math.max(1, Math.floor(Number(objState.strategyOrderSequence || 1)));
    return Number.isFinite(vSequence) ? vSequence : 1;
}

function createCompactStrategyRunTag(): string {
    return crypto.randomBytes(5).toString("hex").toUpperCase();
}

function buildRuntimeStateWithStrategyRun(
    pRuntime: RollingFuturesLtRuntimeRecord | null,
    pInput: {
        strategyRunId?: string;
        strategyRunTag?: string;
        nextOrderSequence?: number;
    }
): Record<string, unknown> {
    const objState = { ...((pRuntime?.state || {}) as Record<string, unknown>) };
    const vRunId = String(pInput.strategyRunId || "").trim();
    const vRunTag = String(pInput.strategyRunTag || "").trim().toUpperCase();
    const vNextSequence = Math.max(1, Math.floor(Number(pInput.nextOrderSequence || 1)));
    if (!vRunId || !vRunTag) {
        delete objState.strategyRunId;
        delete objState.strategyRunTag;
        delete objState.strategyOrderSequence;
        return objState;
    }
    objState.strategyRunId = vRunId;
    objState.strategyRunTag = vRunTag;
    objState.strategyOrderSequence = vNextSequence;
    return objState;
}

function buildDeltaClientOrderId(
    pStrategyCode: RollingFuturesLtStrategyCode,
    pRunTag: string,
    pOrderKind: "EN" | "HG" | "SL" | "TP" | "RE" | "CL",
    pSequence: number
): string {
    const vPrefix = pStrategyCode === "covered-options"
        ? "COV"
        : (pStrategyCode === "strangle-options" ? "STG" : "RFD");
    const vRunTag = String(pRunTag || "").trim().toUpperCase().slice(0, 10);
    const vSequence = Math.max(1, Math.floor(Number(pSequence || 1))).toString(36).toUpperCase().padStart(2, "0").slice(-2);
    return `${vPrefix}-${vRunTag}-${pOrderKind}${vSequence}`.slice(0, 32);
}

function getStrategyClientOrderIdPrefix(pStrategyCode: RollingFuturesLtStrategyCode): string {
    if (pStrategyCode === "covered-options") {
        return "COV-";
    }
    if (pStrategyCode === "strangle-options") {
        return "STG-";
    }
    return "RFD-";
}

function getDeltaOrderHistoryClientOrderId(pRow: DeltaOrderHistoryRow): string {
    const objMeta = pRow.meta_data && typeof pRow.meta_data === "object"
        ? pRow.meta_data as Record<string, unknown>
        : {};
    const arrCandidates: unknown[] = [
        pRow.client_order_id,
        objMeta.client_order_id,
        (pRow as Record<string, unknown>).clientOrderId,
        objMeta.clientOrderId,
        (pRow as Record<string, unknown>).cl_order_id,
        objMeta.cl_order_id
    ];
    for (const pCandidate of arrCandidates) {
        const vValue = String(pCandidate || "").trim().toUpperCase();
        if (vValue) {
            return vValue;
        }
    }
    return "";
}

function doesClosedOrderHistoryRowBelongToStrategy(
    pRow: DeltaOrderHistoryRow,
    pStrategyCode: RollingFuturesLtStrategyCode
): boolean {
    if (!isCoveredLikeStrategy(pStrategyCode)) {
        return true;
    }
    const vClientOrderId = getDeltaOrderHistoryClientOrderId(pRow);
    if (!vClientOrderId) {
        return pStrategyCode === "covered-options";
    }
    if (pStrategyCode === "covered-options" && vClientOrderId.startsWith("RFD-")) {
        return true;
    }
    return vClientOrderId.startsWith(getStrategyClientOrderIdPrefix(pStrategyCode));
}

async function ensureActiveStrategyRun(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pStartedAt = ""
): Promise<{
    runtime: RollingFuturesLtRuntimeRecord;
    strategyRunId: string;
    strategyRunTag: string;
}> {
    const objRuntime = await loadRollingFuturesLtRuntime(pUserId, pStrategyCode)
        || getDefaultRollingFuturesLtRuntime(pUserId, pStrategyCode);
    let vRunId = getStrategyRunIdState(objRuntime);
    let vRunTag = getStrategyRunTagState(objRuntime);
    if (!vRunId) {
        vRunId = crypto.randomUUID();
    }
    if (!vRunTag) {
        vRunTag = createCompactStrategyRunTag();
    }
    const objSavedRuntime = await saveRollingFuturesLtRuntime({
        ...objRuntime,
        userId: pUserId,
        strategyCode: pStrategyCode,
        state: {
            ...((objRuntime.state || {}) as Record<string, unknown>),
            ...buildRuntimeStateWithStrategyStartedAt(objRuntime, pStartedAt || getStrategyStartedAtState(objRuntime)),
            ...buildRuntimeStateWithStrategyRun(objRuntime, {
                strategyRunId: vRunId,
                strategyRunTag: vRunTag,
                nextOrderSequence: getStrategyOrderSequenceState(objRuntime)
            })
        }
    });
    return {
        runtime: objSavedRuntime,
        strategyRunId: vRunId,
        strategyRunTag: vRunTag
    };
}

async function allocateStrategyClientOrderId(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pOrderKind: "EN" | "HG" | "SL" | "TP" | "RE" | "CL"
): Promise<string> {
    try {
        const objRuntime = await loadRollingFuturesLtRuntime(pUserId, pStrategyCode);
        const vRunId = getStrategyRunIdState(objRuntime);
        const vRunTag = getStrategyRunTagState(objRuntime);
        if (!vRunId || !vRunTag || !objRuntime) {
            return "";
        }
        const vSequence = getStrategyOrderSequenceState(objRuntime);
        const vClientOrderId = buildDeltaClientOrderId(pStrategyCode, vRunTag, pOrderKind, vSequence);
        await saveRollingFuturesLtRuntime({
            ...objRuntime,
            userId: pUserId,
            strategyCode: pStrategyCode,
            state: {
                ...((objRuntime.state || {}) as Record<string, unknown>),
                ...buildRuntimeStateWithStrategyRun(objRuntime, {
                    strategyRunId: vRunId,
                    strategyRunTag: vRunTag,
                    nextOrderSequence: vSequence + 1
                })
            }
        });
        return vClientOrderId;
    }
    catch (objError) {
        if (!isPrimaryDatabaseUnavailableError(objError)) {
            throw objError;
        }
        const objSurvival = await getSurvivalState(pUserId, pStrategyCode);
        if (!objSurvival?.strategyRunId || !objSurvival.runTag) {
            return "";
        }
        const vSequence = Math.max(1, Math.floor(Number(objSurvival.runtimeState?.strategyOrderSequence || 1)));
        const vClientOrderId = buildDeltaClientOrderId(pStrategyCode, objSurvival.runTag, pOrderKind, vSequence);
        await upsertSurvivalState({
            userId: objSurvival.userId,
            strategyCode: objSurvival.strategyCode,
            strategyRunId: objSurvival.strategyRunId,
            runTag: objSurvival.runTag,
            runStatus: objSurvival.runStatus,
            ownerServerId: objSurvival.ownerServerId,
            ownerInstanceId: objSurvival.ownerInstanceId,
            leaseToken: objSurvival.leaseToken,
            leaseExpiresAt: objSurvival.leaseExpiresAt,
            lastHeartbeatAt: new Date().toISOString(),
            selectedApiProfileId: objSurvival.selectedApiProfileId,
            profileReferenceName: objSurvival.profileReferenceName,
            apiKey: objSurvival.apiKey,
            apiSecret: objSurvival.apiSecret,
            symbol: objSurvival.symbol,
            strategyStartedAt: objSurvival.strategyStartedAt,
            lastDeltaSyncAt: objSurvival.lastDeltaSyncAt,
            lastPrimaryDbSyncAt: objSurvival.lastPrimaryDbSyncAt,
            openPositions: objSurvival.openPositions,
            uiState: objSurvival.uiState,
            runtimeState: {
                ...(objSurvival.runtimeState || {}),
                strategyRunId: objSurvival.strategyRunId,
                strategyRunTag: objSurvival.runTag,
                strategyOrderSequence: vSequence + 1
            },
            riskState: objSurvival.riskState,
            recoveryMetrics: objSurvival.recoveryMetrics,
            lastOrderRefs: [...(objSurvival.lastOrderRefs || []), vClientOrderId].slice(-50)
        });
        return vClientOrderId;
    }
}

async function clearActiveStrategyRun(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode
): Promise<void> {
    const objRuntime = await loadRollingFuturesLtRuntime(pUserId, pStrategyCode);
    if (!objRuntime) {
        return;
    }
    await saveRollingFuturesLtRuntime({
        ...objRuntime,
        userId: pUserId,
        strategyCode: pStrategyCode,
        state: {
            ...buildRuntimeStateWithStrategyStartedAt(objRuntime, ""),
            ...buildRuntimeStateWithStrategyRun(objRuntime, {}),
            ...buildRuntimeStateWithClosedFromDateManualLock(objRuntime, false)
        }
    });
}

function getProfitClosePendingState(pRuntime: RollingFuturesLtRuntimeRecord | null): {
    reason: "brokerage" | "blockmargin" | "";
    thresholdValue: number;
    startedAt: string;
} {
    const objState = (pRuntime?.state || {}) as Record<string, unknown>;
    const objPending = objState.profitClosePending && typeof objState.profitClosePending === "object"
        ? objState.profitClosePending as Record<string, unknown>
        : {};
    const vReason = String(objPending.reason || "").trim();
    const vThresholdValue = Number(objPending.thresholdValue || 0);
    return {
        reason: vReason === "brokerage" || vReason === "blockmargin" ? vReason : "",
        thresholdValue: Number.isFinite(vThresholdValue) ? Number(vThresholdValue.toFixed(6)) : 0,
        startedAt: String(objPending.startedAt || "").trim()
    };
}

function buildRuntimeStateWithProfitClosePending(
    pRuntime: RollingFuturesLtRuntimeRecord | null,
    pReason: "brokerage" | "blockmargin" | "" = "",
    pThresholdValue = 0,
    pStartedAt = ""
): Record<string, unknown> {
    const objState = { ...((pRuntime?.state || {}) as Record<string, unknown>) };
    const vReason = String(pReason || "").trim();
    const vStartedAt = String(pStartedAt || "").trim();
    const vThresholdValue = Number(pThresholdValue || 0);
    if (!(vReason === "brokerage" || vReason === "blockmargin") || !vStartedAt || !(vThresholdValue > 0)) {
        delete objState.profitClosePending;
        return objState;
    }
    objState.profitClosePending = {
        reason: vReason,
        thresholdValue: Number(vThresholdValue.toFixed(6)),
        startedAt: vStartedAt
    };
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
    pReason: "cooldown" | "pending" | "lock" | "option_reentry",
    pContext: {
        symbol: "BTC" | "ETH";
        qty: number;
        totalDelta: number;
        totalTheta: number;
        mode: "none" | "delta" | "theta" | "gamma";
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
                : (pReason === "option_reentry"
                    ? "Delta-neutral hedge was skipped because an option re-entry grace window is active."
                    : "Delta-neutral hedge was skipped because another hedge path already owns the hedge lock.")),
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

function buildRuntimeStateWithClosedPositionsRefreshAt(
    pRuntime: RollingFuturesLtRuntimeRecord | null,
    pTriggeredAt: string
): Record<string, unknown> {
    const objState = { ...((pRuntime?.state || {}) as Record<string, unknown>) };
    const vTriggeredAt = String(pTriggeredAt || "").trim();
    if (!vTriggeredAt) {
        delete objState.closedPositionsRefreshAt;
        return objState;
    }
    objState.closedPositionsRefreshAt = vTriggeredAt;
    return objState;
}

function getOpenPnlSnapshotState(pRuntime: RollingFuturesLtRuntimeRecord | null): {
    totalPnl: number;
    capturedAt: string;
    positionKeys: string[];
} {
    const objState = (pRuntime?.state || {}) as Record<string, unknown>;
    const vTotalPnl = Number(objState.lastOpenPnlSnapshotTotal || 0);
    const vCapturedAt = String(objState.lastOpenPnlSnapshotAt || "").trim();
    const arrPositionKeys = Array.isArray(objState.lastOpenPnlSnapshotKeys)
        ? objState.lastOpenPnlSnapshotKeys
            .map((pValue) => String(pValue || "").trim())
            .filter((pValue) => Boolean(pValue))
        : [];
    return {
        totalPnl: Number.isFinite(vTotalPnl) ? Number(vTotalPnl.toFixed(4)) : 0,
        capturedAt: vCapturedAt,
        positionKeys: arrPositionKeys
    };
}

function buildRuntimeStateWithOpenPnlSnapshot(
    pRuntime: RollingFuturesLtRuntimeRecord | null,
    pTotalPnl: number | null,
    pPositionKeys: string[] = [],
    pCapturedAt = ""
): Record<string, unknown> {
    const objState = { ...((pRuntime?.state || {}) as Record<string, unknown>) };
    const vTotalPnl = Number(pTotalPnl || 0);
    const arrPositionKeys = Array.isArray(pPositionKeys)
        ? pPositionKeys
            .map((pValue) => String(pValue || "").trim())
            .filter((pValue) => Boolean(pValue))
        : [];
    const vCapturedAt = String(pCapturedAt || "").trim();
    if (!Number.isFinite(vTotalPnl) || !arrPositionKeys.length || !vCapturedAt) {
        delete objState.lastOpenPnlSnapshotTotal;
        delete objState.lastOpenPnlSnapshotAt;
        delete objState.lastOpenPnlSnapshotKeys;
        return objState;
    }
    objState.lastOpenPnlSnapshotTotal = Number(vTotalPnl.toFixed(4));
    objState.lastOpenPnlSnapshotAt = vCapturedAt;
    objState.lastOpenPnlSnapshotKeys = arrPositionKeys;
    return objState;
}

function areSameTrackedPositionKeys(pLeft: string[], pRight: string[]): boolean {
    if (pLeft.length !== pRight.length) {
        return false;
    }
    const arrLeft = [...pLeft].sort();
    const arrRight = [...pRight].sort();
    return arrLeft.every((pValue, pIndex) => pValue === arrRight[pIndex]);
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
    if (!isCoveredOptionsStrategy(pStrategyCode)) {
        return false;
    }
    if (!gRollingFuturesTelegramEventTypes.has(pEventType)) {
        return false;
    }
    const objProfile = await readLiveProfile(pUserId, pStrategyCode);
    const arrSelectedTypes = normalizeRollingFuturesSelectedTelegramEventTypes(objProfile.uiState?.telegramAlertTypes);
    if (!arrSelectedTypes.length) {
        return false;
    }
    if (pEventType === "reentry_opened" && arrSelectedTypes.includes("option_opened")) {
        return true;
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

type TelegramInlineKeyboardButton = {
    text: string;
    callback_data: string;
};

type TelegramInlineKeyboardMarkup = {
    inline_keyboard: TelegramInlineKeyboardButton[][];
};

type TelegramChatMessage = {
    chat: { id?: number | string | null };
    message_id?: number | null;
    text?: string | null;
};

type TelegramCallbackQuery = {
    id?: string;
    from?: { id?: number | string | null };
    data?: string | null;
    message?: TelegramChatMessage | null;
};

type TelegramUpdate = {
    update_id?: number;
    message?: TelegramChatMessage | null;
    edited_message?: TelegramChatMessage | null;
    callback_query?: TelegramCallbackQuery | null;
};

async function sendTelegramBotMessage(
    pBotToken: string,
    pChatId: string,
    pText: string,
    pReplyMarkup?: TelegramInlineKeyboardMarkup
): Promise<boolean> {
    if (!pBotToken || !pChatId || !pText) {
        return false;
    }

    try {
        const objResponse = await fetch(`https://api.telegram.org/bot${encodeURIComponent(pBotToken)}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: pChatId,
                text: pText,
                ...(pReplyMarkup ? { reply_markup: pReplyMarkup } : {})
            })
        });
        return objResponse.ok;
    }
    catch (_objError) {
        return false;
    }
}

async function answerTelegramCallbackQuery(
    pBotToken: string,
    pCallbackQueryId: string,
    pText: string
): Promise<void> {
    if (!pBotToken || !pCallbackQueryId) {
        return;
    }

    try {
        await fetch(`https://api.telegram.org/bot${encodeURIComponent(pBotToken)}/answerCallbackQuery`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                callback_query_id: pCallbackQueryId,
                text: pText
            })
        });
    }
    catch (_objError) {
    }
}

async function editTelegramMessageText(
    pBotToken: string,
    pChatId: string,
    pMessageId: number,
    pText: string
): Promise<void> {
    if (!pBotToken || !pChatId || !(pMessageId > 0) || !pText) {
        return;
    }

    try {
        await fetch(`https://api.telegram.org/bot${encodeURIComponent(pBotToken)}/editMessageText`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: pChatId,
                message_id: pMessageId,
                text: pText
            })
        });
    }
    catch (_objError) {
    }
}

function getTelegramWebhookSecret(): string {
    return String(process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
}

function getTelegramWebhookUrl(): string {
    return String(process.env.TELEGRAM_WEBHOOK_URL || "").trim();
}

export async function ensureTelegramWebhookRegistered(): Promise<void> {
    const vBotToken = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
    const vWebhookUrl = getTelegramWebhookUrl();
    if (!vBotToken || !vWebhookUrl) {
        return;
    }

    const objBody: Record<string, unknown> = {
        url: vWebhookUrl
    };
    const vSecret = getTelegramWebhookSecret();
    if (vSecret) {
        objBody.secret_token = vSecret;
    }

    try {
        await fetch(`https://api.telegram.org/bot${encodeURIComponent(vBotToken)}/setWebhook`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(objBody)
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

function getTrackedPositionMatchKey(
    pPosition: Pick<RollingFuturesLtImportedPositionRecord, "importId" | "contractName" | "side" | "qty">
): string {
    const vImportId = String(pPosition.importId || "").trim();
    if (vImportId) {
        return `id::${vImportId}`;
    }
    return [
        String(pPosition.contractName || "").trim().toUpperCase(),
        String(pPosition.side || "").trim().toUpperCase(),
        String(Math.max(0, Number(pPosition.qty || 0)))
    ].join("::");
}

function getTrackedPositionIdentityKey(
    pPosition: Pick<RollingFuturesLtImportedPositionRecord, "importId" | "contractName" | "side">
): string {
    const vImportId = String(pPosition.importId || "").trim();
    if (vImportId) {
        return `id::${vImportId}`;
    }
    return [
        String(pPosition.contractName || "").trim().toUpperCase(),
        String(pPosition.side || "").trim().toUpperCase()
    ].join("::");
}

async function reconcileRemovedTrackedPositionsPnl(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pSavedPositions: RollingFuturesLtImportedPositionRecord[],
    pLivePositions: RollingFuturesLtImportedPositionRecord[],
    pReason: string,
    pRealizedPnlOverride?: number | null
): Promise<number> {
    const arrSaved = Array.isArray(pSavedPositions) ? pSavedPositions : [];
    const arrLive = Array.isArray(pLivePositions) ? pLivePositions : [];
    if (!arrSaved.length) {
        return 0;
    }

    const objLiveKeys = new Set(arrLive.map((objPosition) => getTrackedPositionMatchKey(objPosition)));
    const arrRemoved = arrSaved.filter((objPosition) => !objLiveKeys.has(getTrackedPositionMatchKey(objPosition)));
    const objLiveByIdentity = new Map<string, RollingFuturesLtImportedPositionRecord>();
    arrLive.forEach((objPosition) => {
        objLiveByIdentity.set(getTrackedPositionIdentityKey(objPosition), objPosition);
    });
    const arrRealizedSlices: Array<{
        position: RollingFuturesLtImportedPositionRecord;
        originalQty: number;
    }> = [];
    arrRemoved.forEach((objPosition) => {
        arrRealizedSlices.push({
            position: objPosition,
            originalQty: Math.max(0, Number(objPosition.qty || 0))
        });
    });
    arrSaved.forEach((objPosition) => {
        const objLiveMatch = objLiveByIdentity.get(getTrackedPositionIdentityKey(objPosition));
        if (!objLiveMatch) {
            return;
        }
        const vSavedQty = Math.max(0, Number(objPosition.qty || 0));
        const vLiveQty = Math.max(0, Number(objLiveMatch.qty || 0));
        if (!(vSavedQty > vLiveQty)) {
            return;
        }
        arrRealizedSlices.push({
            position: {
                ...objPosition,
                qty: Number((vSavedQty - vLiveQty).toFixed(8)),
                markPrice: Number(objLiveMatch.markPrice || objPosition.markPrice || objPosition.entryPrice || 0)
            } satisfies RollingFuturesLtImportedPositionRecord,
            originalQty: vSavedQty
        });
    });
    if (!arrRealizedSlices.length) {
        return 0;
    }

    const arrRemovedContracts = arrRealizedSlices.map((objSlice) => String(objSlice.position.contractName || "").trim()).filter(Boolean);
        const vEstimatedRecoveredPnlDelta = Number(arrRealizedSlices.reduce((pSum, objSlice) => {
        const objPosition = objSlice.position;
        const vOriginalQty = Math.max(0, Number(objSlice.originalQty || 0));
        const vSliceQty = Math.max(0, Number(objPosition.qty || 0));
        const vDeltaReportedPnl = Number(objPosition.pnl || 0);
        const vCanUseDeltaPositionPnl = isFutureContractSymbol(objPosition.contractName)
            && Number.isFinite(vDeltaReportedPnl)
            && vOriginalQty > 0
            && vSliceQty > 0;
        const vFallbackPnl = isFutureContractSymbol(objPosition.contractName)
            ? 0
            : estimateTrackedPositionPnl(
                objPosition,
                Number(objPosition.markPrice || objPosition.entryPrice || 0)
            );
        return pSum + (vCanUseDeltaPositionPnl
            ? Number((vDeltaReportedPnl * (vSliceQty / vOriginalQty)).toFixed(4))
            : vFallbackPnl);
    }, 0).toFixed(4));
    const vRecoveredPnlDelta = Number.isFinite(Number(pRealizedPnlOverride))
        ? Number(Number(pRealizedPnlOverride || 0).toFixed(4))
        : vEstimatedRecoveredPnlDelta;

    if (vRecoveredPnlDelta !== 0) {
        await incrementRecoveredTotalPnl(pUserId, pStrategyCode, vRecoveredPnlDelta, arrLive.length);
    }

    const vSliceLabel = isCoveredLikeStrategy(pStrategyCode) ? "tracked position slice" : "tracked futures slice";
    const vTitle = isCoveredLikeStrategy(pStrategyCode)
        ? "Tracked Positions Realized During Reconciliation"
        : "Tracked Futures Realized During Reconciliation";

    await logFuturesEvent(
        pUserId,
        pStrategyCode,
        "future_closed",
        "info",
        vTitle,
        `Captured realized PnL ${vRecoveredPnlDelta.toFixed(2)} for ${arrRealizedSlices.length} ${vSliceLabel}${arrRealizedSlices.length === 1 ? "" : "s"} removed or reduced during live reconciliation.${Number.isFinite(Number(pRealizedPnlOverride)) ? " Used Delta realized PnL from the hedge/close order." : ""}`,
        {
            qty: arrRealizedSlices.length,
            removedCount: arrRemoved.length,
            reducedCount: arrRealizedSlices.length - arrRemoved.length,
            contractName: arrRemovedContracts.join(", "),
            pnlDelta: vRecoveredPnlDelta,
            estimatedPnlDelta: vEstimatedRecoveredPnlDelta,
            reason: pReason
        }
    );

    return vRecoveredPnlDelta;
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
    mode: "none" | "delta" | "theta" | "gamma";
    threshold: number | null;
    nextRuntimeState: Record<string, unknown> | null;
}> {
    if (isCoveredLikeStrategy(pStrategyCode)) {
        const objTotals = await calculateTrackedNeutralTotals(pTrackedPositions);
        return {
            trackedOpenPositions: pTrackedPositions,
            hedgePlaced: false,
            totalDelta: objTotals.totalDelta,
            totalTheta: objTotals.totalTheta,
            mode: "none",
            threshold: null,
            nextRuntimeState: null
        };
    }
    const vMode = getNeutralModeFromUiState(pUiState);
    const objRuntimeBase = pRuntime
        || await loadRollingFuturesLtRuntime(pUserId, pStrategyCode)
        || getDefaultRollingFuturesLtRuntime(pUserId, pStrategyCode);
    const objTotals = await calculateTrackedNeutralTotals(pTrackedPositions);
    const objDeltaBaseline = getDeltaNeutralBaselineState(objRuntimeBase);
    const bDualScaledMode = isDualScaledNeutralMode(pStrategyCode, vMode);
    const vBaselineOptionDeltaAbs = objDeltaBaseline.baseOptionDeltaAbs > 0
        ? objDeltaBaseline.baseOptionDeltaAbs
        : objTotals.optionDeltaAbs;
    const vEntryOptionDeltaAbs = objDeltaBaseline.entryOptionDeltaAbs > 0
        ? objDeltaBaseline.entryOptionDeltaAbs
        : objTotals.optionDeltaAbs;
    const vScaledBaselineFloorAbs = bDualScaledMode && vEntryOptionDeltaAbs > 0
        ? Number((vEntryOptionDeltaAbs * gDualScaledBaselineFloorRatio).toFixed(6))
        : 0;
    const vEffectiveBaselineOptionDeltaAbs = bDualScaledMode
        ? Number(Math.max(vBaselineOptionDeltaAbs, vScaledBaselineFloorAbs).toFixed(6))
        : vBaselineOptionDeltaAbs;
    const vLastHedgeAtMs = Number.isFinite(new Date(objDeltaBaseline.lastHedgeAt).getTime())
        ? new Date(objDeltaBaseline.lastHedgeAt).getTime()
        : 0;
    const vPendingUntilMs = Number.isFinite(new Date(getNeutralityHedgePendingUntil(objRuntimeBase)).getTime())
        ? new Date(getNeutralityHedgePendingUntil(objRuntimeBase)).getTime()
        : 0;
    const vOptionReentryPendingUntilMs = Number.isFinite(new Date(getOptionReentryPendingUntil(objRuntimeBase)).getTime())
        ? new Date(getOptionReentryPendingUntil(objRuntimeBase)).getTime()
        : 0;
    const vNowMs = Date.now();
    const bHedgeCooldownActive = vLastHedgeAtMs > 0 && (vNowMs - vLastHedgeAtMs) < gNeutralityHedgeCooldownMs;
    const bHedgePendingActive = vPendingUntilMs > vNowMs;
    const bOptionReentryPendingActive = vOptionReentryPendingUntilMs > vNowMs;

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
        const vDriftPct = vEffectiveBaselineOptionDeltaAbs > 0
            ? Number(((objTotals.totalDelta / vEffectiveBaselineOptionDeltaAbs) * 100).toFixed(6))
            : 0;
        vThreshold = null;
        bShouldHedge = vEffectiveBaselineOptionDeltaAbs > 0
            && (vDriftPct < vNegThresholdPct || vDriftPct > vPosThresholdPct);
        objNextRuntimeState = buildRuntimeStateWithDeltaNeutralBaseline(
            objRuntimeBase,
            vBaselineOptionDeltaAbs,
            objDeltaBaseline.lastHedgeAt,
            vEntryOptionDeltaAbs
        );
    }
    else if (vMode === "theta") {
        const vThetaAbs = Math.abs(objTotals.totalTheta);
        const vMinDeltaPct = Math.abs(Number.isFinite(Number(pUiState.minusDelta)) ? Number(pUiState.minusDelta) : -25);
        const vMaxDeltaPct = Math.abs(Number.isFinite(Number(pUiState.plusDelta)) ? Number(pUiState.plusDelta) : 25);
        const vThetaMinDelta = Number((vThetaAbs * vMinDeltaPct / 100 * -1).toFixed(6));
        const vThetaMaxDelta = Number((vThetaAbs * vMaxDeltaPct / 100).toFixed(6));
        vThreshold = null;
        bShouldHedge = vThetaAbs > 0 && (objTotals.totalDelta < vThetaMinDelta || objTotals.totalDelta > vThetaMaxDelta);
        objNextRuntimeState = buildRuntimeStateWithDeltaNeutralBaseline(objRuntimeBase, null, objDeltaBaseline.lastHedgeAt);
    }
    else {
        const vNegThresholdPct = Number.isFinite(Number(pUiState.minusDelta)) ? Number(pUiState.minusDelta) : -25;
        const vPosThresholdPct = Number.isFinite(Number(pUiState.plusDelta)) ? Number(pUiState.plusDelta) : 25;
        const vGammaFactor = bDualScaledMode ? 1 : getGammaAwareCompressionFactor(objTotals.totalGamma);
        const vGammaNegThresholdPct = Number((vNegThresholdPct / vGammaFactor).toFixed(6));
        const vGammaPosThresholdPct = Number((vPosThresholdPct / vGammaFactor).toFixed(6));
        const vDriftPct = vEffectiveBaselineOptionDeltaAbs > 0
            ? Number(((objTotals.totalDelta / vEffectiveBaselineOptionDeltaAbs) * 100).toFixed(6))
            : 0;
        vThreshold = null;
        bShouldHedge = vEffectiveBaselineOptionDeltaAbs > 0
            && (vDriftPct < vGammaNegThresholdPct || vDriftPct > vGammaPosThresholdPct);
        objNextRuntimeState = buildRuntimeStateWithDeltaNeutralBaseline(
            objRuntimeBase,
            vBaselineOptionDeltaAbs,
            objDeltaBaseline.lastHedgeAt,
            vEntryOptionDeltaAbs
        );
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

    if (bOptionReentryPendingActive) {
        const objSkipState = await logNeutralityHedgeSkippedOnce(
            pUserId,
            pStrategyCode,
            objRuntimeBase,
            "option_reentry",
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
        const vLatestOptionReentryPendingUntilMs = Number.isFinite(new Date(getOptionReentryPendingUntil(objLatestRuntime)).getTime())
            ? new Date(getOptionReentryPendingUntil(objLatestRuntime)).getTime()
            : 0;
        const objLatestBaseline = getDeltaNeutralBaselineState(objLatestRuntime);
        const vLatestLastHedgeAtMs = Number.isFinite(new Date(objLatestBaseline.lastHedgeAt).getTime())
            ? new Date(objLatestBaseline.lastHedgeAt).getTime()
            : 0;
        if (vLatestOptionReentryPendingUntilMs > Date.now()) {
            const objSkipState = await logNeutralityHedgeSkippedOnce(
                pUserId,
                pStrategyCode,
                objLatestRuntime,
                "option_reentry",
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
            pStrategyCode,
            pSelectedApiProfileId,
            pSymbol,
            vHedgeAction,
            vHedgeQty,
            "market_order",
            "HG"
        );
        const { client: objOrderHistoryClient } = await getDeltaClientForAccountId(pUserId, pSelectedApiProfileId);
        const vResolvedHedgeRealizedPnl = await resolveOrderRealizedPnlFromDelta(
            objOrderHistoryClient,
            objPlacedHedge.contractName,
            objPlacedHedge.order,
            vHedgeAction,
            vHedgeQty,
            String(objPlacedHedge.entryTs || new Date().toISOString())
        );
        const arrLiveAfterHedge = await fetchLiveFuturePositions(
            pUserId,
            pStrategyCode,
            pSelectedApiProfileId,
            pSymbol
        );
        await reconcileRemovedTrackedPositionsPnl(
            pUserId,
            pStrategyCode,
            pTrackedPositions,
            arrLiveAfterHedge,
            "neutrality_hedge",
            vResolvedHedgeRealizedPnl
        );
        const arrSaved = await replaceRollingFuturesLtImportedPositions(
            pUserId,
            pStrategyCode,
            arrLiveAfterHedge
        );
        const vResolvedHedgeCharge = await resolveOrderChargeFromDelta(
            objOrderHistoryClient,
            objPlacedHedge.contractName,
            objPlacedHedge.order,
            vHedgeAction,
            vHedgeQty,
            String(objPlacedHedge.entryTs || new Date().toISOString())
        );
        const vHedgeCharge = vResolvedHedgeCharge !== null
            ? vResolvedHedgeCharge
            : await estimateTrackedPositionCharge({
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
            "Live Hedge Executed",
            `${vHedgeAction} future hedge placed from the server-side hedge check.`,
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
        const objRuntimeBaselineAfterHedge = getDeltaNeutralBaselineState(objRuntimeAfterHedge);
        const objBaselineState = vMode === "delta" || vMode === "gamma"
            ? buildRuntimeStateWithDeltaNeutralBaseline(
                objRuntimeAfterHedge,
                objPostHedgeTotals.optionDeltaAbs,
                vHedgePlacedAt,
                objRuntimeBaselineAfterHedge.entryOptionDeltaAbs > 0
                    ? objRuntimeBaselineAfterHedge.entryOptionDeltaAbs
                    : objPostHedgeTotals.optionDeltaAbs
            )
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
        rowIndex?: 1 | 2;
    },
    pOptions?: {
        strategyStartedAt?: string;
        skipRecoveryReset?: boolean;
        skipNeutralityCheck?: boolean;
    }
): Promise<{
    profileLabel: string;
    trackedOpenPositions: RollingFuturesLtImportedPositionRecord[];
    contracts: Array<Record<string, unknown>>;
    orders: Array<Record<string, unknown>>;
    neutralCheck: {
        mode: "none" | "delta" | "theta" | "gamma";
        hedgePlaced: boolean;
        totalDelta: number;
        totalTheta: number;
        threshold: number | null;
    };
}> {
    const vStrategyStartedAt = String(pOptions?.strategyStartedAt || new Date().toISOString()).trim() || new Date().toISOString();
    if (!pOptions?.skipRecoveryReset) {
        await resetRecoveryMetrics(pUserId, pStrategyCode);
    }
    const objRuntimeBeforeExec = await loadRollingFuturesLtRuntime(pUserId, pStrategyCode);
    const objRunState = await ensureActiveStrategyRun(pUserId, pStrategyCode, vStrategyStartedAt);
    await saveRollingFuturesLtRuntime({
        ...(objRunState.runtime || getDefaultRollingFuturesLtRuntime(pUserId, pStrategyCode)),
        userId: pUserId,
        strategyCode: pStrategyCode,
        state: {
            ...buildRuntimeStateWithProfitClosePending(objRuntimeBeforeExec, "", 0, ""),
            ...buildRuntimeStateWithClosedFromDateManualLock(objRunState.runtime, false),
            ...buildRuntimeStateWithStrategyStartedAt(objRunState.runtime, vStrategyStartedAt),
            ...buildRuntimeStateWithStrategyRun(objRunState.runtime, {
                strategyRunId: objRunState.strategyRunId,
                strategyRunTag: objRunState.strategyRunTag,
                nextOrderSequence: getStrategyOrderSequenceState(objRunState.runtime)
            })
        }
    });
    const objUiState = getMergedUiState(pProfile);
    const arrExisting = await listRollingFuturesLtImportedPositions(pUserId, pStrategyCode);
    const vRowIndex = normalizeOptionRowIndex(pStrategyCode, pInput.rowIndex);
    const arrOpenOptions = listTrackedOpenOptionPositions(arrExisting);
    if (!isCoveredLikeStrategy(pStrategyCode) && arrOpenOptions.length > 0) {
        throw new Error(`An option position is already open (${arrOpenOptions[0].contractName}). Close the existing option before opening a new one.`);
    }
    if (isOptionsScalperStrategy(pStrategyCode)) {
        const arrOptionSides: Array<"ce" | "pe"> = pInput.legSide === "both"
            ? ["ce", "pe"]
            : [pInput.legSide === "pe" ? "pe" : "ce"];
        const arrContracts: Array<Record<string, unknown>> = [];
        const arrOrders: Array<Record<string, unknown>> = [];
        const arrNewPositions: RollingFuturesLtImportedPositionRecord[] = [];
        for (const vLegSide of arrOptionSides) {
            if (hasTrackedOptionRowLeg(arrExisting, vRowIndex, vLegSide)) {
                throw new Error(`Row ${vRowIndex} ${vLegSide.toUpperCase()} paper option is already open. Close it before executing again.`);
            }
            const objPaperOpen = await buildOptionsScalperPaperOptionOpen(
                pUserId,
                pStrategyCode,
                pProfile,
                {
                    action: pInput.action,
                    symbol: pInput.symbol,
                    legSide: vLegSide,
                    expiryMode: pInput.expiryMode,
                    expiryDate: pInput.expiryDate,
                    qty: pInput.qty,
                    targetDelta: pInput.targetDelta,
                    rowIndex: vRowIndex,
                    openedReason: "strategy_option_open"
                }
            );
            arrNewPositions.push(objPaperOpen.position);
            arrContracts.push(objPaperOpen.contract);
            arrOrders.push({
                order: objPaperOpen.order,
                request: {
                    product_symbol: objPaperOpen.position.contractName,
                    size: pInput.qty,
                    side: pInput.action,
                    order_type: "paper_market_order"
                }
            });
        }
        const arrInitialSaved = await replaceRollingFuturesLtImportedPositions(pUserId, pStrategyCode, [
            ...arrExisting,
            ...arrNewPositions
        ]);
        const objNeutralCheck = pOptions?.skipNeutralityCheck
            ? {
                trackedOpenPositions: arrInitialSaved,
                hedgePlaced: false,
                totalDelta: 0,
                totalTheta: 0,
                mode: "none" as const,
                threshold: null,
                nextRuntimeState: null
            }
            : await applyServerSideNeutralityCheck(
                pUserId,
                pStrategyCode,
                pSelectedApiProfileId,
                objUiState,
                pInput.symbol,
                arrInitialSaved,
                null
            );
        return {
            profileLabel: "Paper",
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
    const { client, profile } = await getDeltaClientForAccountId(pUserId, pSelectedApiProfileId);
    const objOptionMetadata = getLiveOptionRuleMetadataFromUiState(objUiState, "strategy_option_open", pStrategyCode, vRowIndex);
    const bIsDualStrategy = isDualRollingFuturesStrategy(pStrategyCode);
    let arrOptionSides: Array<"CE" | "PE"> = pInput.legSide === "both"
        ? (bIsDualStrategy ? ["CE", "PE"] : [])
        : [pInput.legSide === "pe" ? "PE" : "CE"];
    if (!arrOptionSides.length) {
        throw new Error("Only one option position can be open at a time. Select either CE or PE, not both.");
    }
    if (isCoveredOptionsStrategy(pStrategyCode) && pInput.action === "buy") {
        const arrEligibleOptionSides = arrOptionSides.filter((pOptionSide) => {
            const objGate = evaluateCoveredBuyHedgeSellPremiumGate(
                arrExisting,
                objUiState,
                pOptionSide === "PE" ? "pe" : "ce"
            );
            return objGate.allowed;
        });
        if (!arrEligibleOptionSides.length) {
            const objBlockedLeg = evaluateCoveredBuyHedgeSellPremiumGate(
                arrExisting,
                objUiState,
                arrOptionSides[0] === "PE" ? "pe" : "ce"
            );
            await logFuturesEvent(
                pUserId,
                pStrategyCode,
                "manual_action",
                "info",
                "Covered Buy Hedge Entry Skipped",
                objBlockedLeg.message || "Matching sell premium gate blocked the covered buy hedge entry.",
                {
                    rowIndex: vRowIndex,
                    reason: "covered_buy_hedge_premium_gate"
                }
            );
            return {
                profileLabel: profile.referenceName || profile.apiKey || "",
                trackedOpenPositions: arrExisting,
                contracts: [],
                orders: [],
                neutralCheck: {
                    mode: "none",
                    hedgePlaced: false,
                    totalDelta: 0,
                    totalTheta: 0,
                    threshold: null
                }
            };
        }
        const arrResolvedOptionSides = Array.from(new Set(
            arrEligibleOptionSides.map((pOptionSide) => {
                const vRequestedLegSide = pOptionSide === "PE" ? "pe" : "ce";
                const vResolvedLegSide = resolveCoveredBuyHedgeTargetLegSide(pStrategyCode, arrExisting, objUiState, vRowIndex, vRequestedLegSide);
                if (!vResolvedLegSide) {
                    return "";
                }
                return vResolvedLegSide === "pe" ? "PE" : "CE";
            }).filter(Boolean)
        )) as Array<"CE" | "PE">;
        if (!arrResolvedOptionSides.length) {
            return {
                profileLabel: profile.referenceName || profile.apiKey || "",
                trackedOpenPositions: arrExisting,
                contracts: [],
                orders: [],
                neutralCheck: {
                    mode: "none",
                    hedgePlaced: false,
                    totalDelta: 0,
                    totalTheta: 0,
                    threshold: null
                }
            };
        }
        arrOptionSides = arrResolvedOptionSides;
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
        try {
        for (const vOptionSide of arrOptionSides) {
            const objContract = await findBestLiveOptionContractWithNearestFallback(objConfig, vOptionSide, pInput.targetDelta);
            if (!objContract) {
                throw new Error(`No live ${vOptionSide} contract was found for ${pInput.symbol} near target delta ${pInput.targetDelta.toFixed(2)}.`);
            }

            const vAbsoluteDelta = Math.abs(Number(objContract.delta || 0));
            const objImmediateRuleDecision = shouldTriggerTrackedOption(
                pInput.action.toUpperCase(),
                vAbsoluteDelta,
                Number(objOptionMetadata.takeProfitDelta || 0.25),
                Number(objOptionMetadata.stopLossDelta || 0.65)
            );
            if (objImmediateRuleDecision.shouldAct) {
                throw new Error(`The selected ${vOptionSide} contract delta ${vAbsoluteDelta.toFixed(2)} already violates the configured ${objImmediateRuleDecision.reason.toUpperCase()} rule for row ${vRowIndex}. Adjust New D / SL / TP before executing.`);
            }

            const vClientOrderId = await allocateStrategyClientOrderId(pUserId, pStrategyCode, "EN");
            const objOrderPayload: Record<string, unknown> = {
                product_symbol: objContract.contractSymbol,
                size: pInput.qty,
                side: pInput.action,
                order_type: "market_order",
                time_in_force: "gtc",
                post_only: false,
                reduce_only: false,
                ...(vClientOrderId ? { client_order_id: vClientOrderId } : {})
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
                    baseDelta: getSignedOptionBaseDelta(String(objContract.contractSymbol || "").trim(), Number(objContract.delta || 0)),
                    baseTheta: Math.abs(Number(objContract.theta || 0)),
                    requestedExpiryDate: String(objContract.requestedExpiryDate || "").trim(),
                    resolvedExpiryDate: String(objContract.expiryDate || "").trim()
                }),
                openedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            } satisfies RollingFuturesLtImportedPositionRecord))
        ]);
        const arrEntryCharges = await Promise.all(arrOrders.map(async (objOrder, pIndex) => {
            const objContract = arrContracts[pIndex] || {};
            const vContractName = String(objContract.contractSymbol || "").trim();
            const vSide = String(pInput.action || "").trim().toUpperCase();
            const vResolvedCharge = await resolveOrderChargeFromDelta(
                client,
                vContractName,
                (objOrder.order && typeof objOrder.order === "object") ? objOrder.order as Record<string, unknown> : {},
                vSide,
                pInput.qty,
                new Date().toISOString()
            );
            if (vResolvedCharge !== null) {
                return vResolvedCharge;
            }
            return estimateTrackedPositionCharge({
                contractName: vContractName,
                qty: pInput.qty,
                entryPrice: Number(objContract.markPrice || 0),
                markPrice: Number(objContract.markPrice || 0)
            });
        }));
        await incrementBrokerageRecoveryTotal(
            pUserId,
            pStrategyCode,
            arrEntryCharges.reduce((pSum, vValue) => pSum + Number(vValue || 0), 0),
            arrInitialSaved.length
        );
        const objNeutralCheck = pOptions?.skipNeutralityCheck
            ? {
                trackedOpenPositions: arrInitialSaved,
                hedgePlaced: false,
                totalDelta: 0,
                totalTheta: 0,
                mode: "none" as const,
                threshold: null,
                nextRuntimeState: null
            }
            : await applyServerSideNeutralityCheck(
                pUserId,
                pStrategyCode,
                    pSelectedApiProfileId,
                    objUiState,
                    pInput.symbol,
                    arrInitialSaved,
                    null
                );
        if (objNeutralCheck.nextRuntimeState) {
            const objRuntimeAfterExec = await loadRollingFuturesLtRuntime(pUserId, pStrategyCode)
                || getDefaultRollingFuturesLtRuntime(pUserId, pStrategyCode);
            await saveRollingFuturesLtRuntime({
                ...objRuntimeAfterExec,
                userId: pUserId,
                strategyCode: pStrategyCode,
                selectedApiProfileId: pSelectedApiProfileId,
                currentSymbol: pInput.symbol,
                state: {
                    ...((objRuntimeAfterExec.state || {}) as Record<string, unknown>),
                    ...objNeutralCheck.nextRuntimeState
                }
            });
        }
        await syncDualStrategySurvivalState(
            pUserId,
            pStrategyCode,
            pSelectedApiProfileId,
            objNeutralCheck.trackedOpenPositions,
            "active"
        );
        if (isCoveredOptionsStrategy(pStrategyCode) && pInput.action === "buy") {
            const objGateConfig = getCoveredBuyHedgeSellPremiumGateConfig(objUiState);
            for (const objContract of arrContracts) {
                const vLegSide = String(objContract.optionSide || "").trim().toUpperCase() === "PE" ? "pe" : "ce";
                await logFuturesEvent(
                    pUserId,
                    pStrategyCode,
                    "option_opened",
                    "success",
                    "Covered Buy Hedge Opened",
                    `${String(objContract.contractSymbol || "").trim()} opened from row ${vRowIndex}. ${getCoveredBuyHedgeOpenReasonText("strategy_option_open", vLegSide, { thresholdPct: objGateConfig.enabled ? objGateConfig.thresholdPct : Number.NaN })}`,
                    {
                        symbol: pInput.symbol,
                        contractName: objContract.contractSymbol,
                        qty: pInput.qty,
                        rowIndex: vRowIndex,
                        legSide: vLegSide,
                        reason: "covered_buy_hedge_exec_opened"
                    }
                );
            }
        }

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
    catch (objError) {
        const arrLatestSaved = await listRollingFuturesLtImportedPositions(pUserId, pStrategyCode);
        if (!arrLatestSaved.length) {
            await clearActiveStrategyRun(pUserId, pStrategyCode);
        }
        throw objError;
    }
}

async function updateStrategyClosedFromDateAfterExec(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pProfile: RollingFuturesLtProfileRecord,
    pTrackedOpenPositions: RollingFuturesLtImportedPositionRecord[]
): Promise<RollingFuturesLtProfileRecord> {
    const objFirstOpenedOption = pTrackedOpenPositions
        .filter((objPosition) => isOptionContractSymbol(objPosition.contractName))
        .sort((pLeft, pRight) => new Date(String(pLeft.openedAt || "")).getTime() - new Date(String(pRight.openedAt || "")).getTime())[0];
    if (!objFirstOpenedOption?.openedAt) {
        return pProfile;
    }
    return saveRollingFuturesLtProfile({
        ...pProfile,
        userId: pUserId,
        strategyCode: pStrategyCode,
        uiState: {
            ...getMergedUiState(pProfile),
            closedFromDate: formatDeltaUiDateTimeLocalString(objFirstOpenedOption.openedAt)
        }
    });
}

async function findBestLiveOptionContractWithNearestFallback(
    pConfig: Parameters<typeof findBestLiveOptionContract>[0],
    pOptionSide: "CE" | "PE",
    pTargetDelta: number
): Promise<Awaited<ReturnType<typeof findBestLiveOptionContract>>> {
    const objStrictMatch = await findBestLiveOptionContract(pConfig, pOptionSide, pTargetDelta, true);
    if (objStrictMatch) {
        return objStrictMatch;
    }
    return findBestLiveOptionContract(pConfig, pOptionSide, pTargetDelta, false);
}

async function updateCoveredRowExpiryDateInProfile(
    pUserId: string,
    pProfile: RollingFuturesLtProfileRecord,
    pRowIndex: 1 | 2,
    pExpiryDate: string
): Promise<RollingFuturesLtProfileRecord> {
    if (!isCoveredLikeStrategy(pProfile.strategyCode)) {
        return pProfile;
    }
    const vExpiryDate = normalizeIsoDateOnly(pExpiryDate);
    if (!vExpiryDate) {
        return pProfile;
    }
    const objUiState = getMergedUiState(pProfile);
    const objKeys = getOptionRowStateKeys(pProfile.strategyCode, pRowIndex);
    if (String(objUiState[objKeys.expiryDate] || "").trim() === vExpiryDate) {
        return pProfile;
    }
    return saveRollingFuturesLtProfile({
        ...pProfile,
        userId: pUserId,
        strategyCode: pProfile.strategyCode,
        uiState: {
            ...objUiState,
            [objKeys.expiryDate]: vExpiryDate
        }
    });
}

async function buildOptionsScalperPaperOptionOpen(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pProfile: RollingFuturesLtProfileRecord,
    pInput: {
        action: "buy" | "sell";
        symbol: "BTC" | "ETH";
        legSide: "ce" | "pe";
        expiryMode: "1" | "2" | "4" | "5" | "6" | "7";
        expiryDate: string;
        qty: number;
        targetDelta: number;
        rowIndex?: 1 | 2;
        openedReason: RollingFuturesLtOptionMetadata["openedReason"];
        takeProfitDelta?: number;
        stopLossDelta?: number;
        reEntryDelta?: number;
        reEnterEnabled?: boolean;
    }
): Promise<{
    position: RollingFuturesLtImportedPositionRecord;
    contract: Record<string, unknown>;
    order: Record<string, unknown>;
}> {
    const objUiState = getMergedUiState(pProfile);
    const vRowIndex = normalizeOptionRowIndex(pStrategyCode, pInput.rowIndex);
    const objRowState = getNormalizedOptionRowUiState(objUiState, pStrategyCode, vRowIndex);
    const objOptionMetadata = getLiveOptionRuleMetadataFromUiState(objUiState, String(pInput.openedReason || "strategy_option_open"), pStrategyCode, vRowIndex);
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
        reDelta: pInput.reEntryDelta ?? pInput.targetDelta,
        deltaTakeProfit: Math.max(0, Number(pInput.takeProfitDelta ?? objOptionMetadata.takeProfitDelta ?? objRowState.tpD ?? 0.25)),
        deltaStopLoss: Math.max(0, Number(pInput.stopLossDelta ?? objOptionMetadata.stopLossDelta ?? objRowState.slD ?? 0.65)),
        reEnter: Boolean(pInput.reEnterEnabled ?? objOptionMetadata.reEnterEnabled),
        addOneLotFuture: false,
        renkoEnabled: false,
        renkoStepPoints: 10,
        renkoPriceSource: "spot_price" as const,
        loopSeconds: 8
    };
    const objContract = await findBestLiveOptionContractWithNearestFallback(
        objConfig,
        pInput.legSide === "pe" ? "PE" : "CE",
        pInput.targetDelta
    );
    if (!objContract) {
        throw new Error(`No live ${pInput.legSide.toUpperCase()} contract was found for ${pInput.symbol} near target delta ${pInput.targetDelta.toFixed(2)}.`);
    }

    const vAbsoluteDelta = Math.abs(Number(objContract.delta || 0));
    const vTakeProfitDelta = Math.max(0, Number(pInput.takeProfitDelta ?? objOptionMetadata.takeProfitDelta ?? objRowState.tpD ?? 0.25));
    const vStopLossDelta = Math.max(0, Number(pInput.stopLossDelta ?? objOptionMetadata.stopLossDelta ?? objRowState.slD ?? 0.65));
    const objImmediateRuleDecision = shouldTriggerTrackedOption(
        pInput.action.toUpperCase(),
        vAbsoluteDelta,
        vTakeProfitDelta,
        vStopLossDelta
    );
    if (objImmediateRuleDecision.shouldAct) {
        throw new Error(`The selected ${pInput.legSide.toUpperCase()} contract delta ${vAbsoluteDelta.toFixed(2)} already violates the configured ${objImmediateRuleDecision.reason.toUpperCase()} rule for row ${vRowIndex}. Adjust New D / SL / TP before executing.`);
    }

    const vOpenedAtIso = new Date().toISOString();
    const vEntryCharge = await estimateTrackedPositionCharge({
        contractName: String(objContract.contractSymbol || "").trim(),
        qty: pInput.qty,
        entryPrice: Number(objContract.markPrice || 0),
        markPrice: Number(objContract.markPrice || 0)
    });
    return {
        position: {
            userId: pUserId,
            strategyCode: pStrategyCode,
            importId: crypto.randomUUID(),
            contractName: String(objContract.contractSymbol || "").trim(),
            side: pInput.action.toUpperCase(),
            qty: pInput.qty,
            entryPrice: Number(objContract.markPrice || 0),
            markPrice: Number(objContract.markPrice || 0),
            charges: Number(vEntryCharge.toFixed(4)),
            pnl: 0,
            margin: 0,
            liquidationPrice: 0,
            metadata: optionMetadataToRecord({
                ...objOptionMetadata,
                rowIndex: vRowIndex,
                takeProfitDelta: vTakeProfitDelta,
                stopLossDelta: vStopLossDelta,
                reEntryDelta: Math.max(0, Number(pInput.reEntryDelta ?? objOptionMetadata.reEntryDelta ?? objRowState.reD ?? pInput.targetDelta)),
                reEnterEnabled: Boolean(pInput.reEnterEnabled ?? objOptionMetadata.reEnterEnabled),
                openedReason: pInput.openedReason,
                baseDelta: getSignedOptionBaseDelta(String(objContract.contractSymbol || "").trim(), vAbsoluteDelta),
                baseTheta: Math.abs(Number(objContract.theta || 0)),
                requestedExpiryDate: String(objContract.requestedExpiryDate || "").trim(),
                resolvedExpiryDate: String(objContract.expiryDate || "").trim()
            }),
            openedAt: vOpenedAtIso,
            updatedAt: vOpenedAtIso
        },
        contract: {
            contractSymbol: objContract.contractSymbol,
            optionSide: objContract.optionSide,
            strike: objContract.strike,
            delta: objContract.delta,
            theta: objContract.theta,
            markPrice: objContract.markPrice,
            requestedExpiryDate: objContract.requestedExpiryDate,
            resolvedExpiryDate: objContract.expiryDate,
            usedNextDayExpiryFallback: objContract.usedNextDayFallback
        },
        order: {
            id: crypto.randomUUID(),
            product_symbol: objContract.contractSymbol,
            size: pInput.qty,
            side: pInput.action,
            order_type: "paper_market_order",
            average_fill_price: Number(objContract.markPrice || 0),
            status: "filled",
            isPaperTrade: true,
            filled_at: vOpenedAtIso
        }
    };
}

async function syncCoveredRecoveryMetricsFromClosedHistory(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pSelectedApiProfileId: string,
    pProfile: RollingFuturesLtProfileRecord,
    pTrackedOpenPositions: RollingFuturesLtImportedPositionRecord[],
    pOptions?: {
        preserveClosedFromDate?: boolean;
    }
): Promise<RollingFuturesLtProfileRecord> {
    if (!isCoveredOptionsStrategy(pStrategyCode)) {
        return pProfile;
    }

    const objRuntime = await loadRollingFuturesLtRuntime(pUserId, pStrategyCode);
    const bPreserveClosedFromDate = Boolean(pOptions?.preserveClosedFromDate)
        || getClosedFromDateManualLockState(objRuntime);
    const objProfileWithClosedFromDate = bPreserveClosedFromDate
        ? pProfile
        : await updateStrategyClosedFromDateAfterExec(
            pUserId,
            pStrategyCode,
            pProfile,
            pTrackedOpenPositions
        );
    const objUiState = getMergedUiState(objProfileWithClosedFromDate);
    const vClosedFromDate = String(objUiState.closedFromDate || "").trim();
    const vClosedFromDateIso = parseDeltaUiDateTimeLocalToIsoString(vClosedFromDate);
    const vSelectedSymbol = normalizeSymbolValue(objUiState.symbol);
    let vClosedBrokerageTotal = 0;
    let vClosedTotalPnl = 0;

    if (vClosedFromDateIso && pSelectedApiProfileId) {
        const { client } = await getDeltaClientForAccountId(pUserId, pSelectedApiProfileId);
        const arrClosedRows = await fetchTrackedClosedOrderHistoryRows(client, pStrategyCode, vSelectedSymbol, vClosedFromDateIso);
        vClosedBrokerageTotal = Number(arrClosedRows.reduce((pSum, pRow) => {
            return pSum + toFiniteNumber(pRow.paid_commission, 0);
        }, 0).toFixed(4));
        vClosedTotalPnl = Number(arrClosedRows.reduce((pSum, pRow) => {
            return pSum + toFiniteNumber(pRow.meta_data?.pnl, 0);
        }, 0).toFixed(4));
    }

    await saveBrokerageRecoveryTotal(
        pUserId,
        pStrategyCode,
        Number(vClosedBrokerageTotal.toFixed(4))
    );
    await saveRecoveredTotalPnl(pUserId, pStrategyCode, vClosedTotalPnl);
    return objProfileWithClosedFromDate;
}

async function closeTrackedPositionOnDelta(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pSelectedApiProfileId: string,
    pPosition: RollingFuturesLtImportedPositionRecord,
    pOrderKind: "SL" | "TP" | "CL" = "CL"
) : Promise<{ payload: Record<string, unknown>; placedAt: string; realizedPnl: number | null; }> {
    if (isOptionsScalperStrategy(pStrategyCode)) {
        const objClosed = await closeOptionsScalperPaperPosition(pUserId, pStrategyCode, pPosition);
        const vClosedAtIso = objClosed.endAt;
        await appendOptionsScalperPaperClosedPositions(pUserId, pStrategyCode, [objClosed]);
        await syncOptionsScalperRecoveryMetricsFromPaperClosedPositions(
            pUserId,
            await readLiveProfile(pUserId, pStrategyCode)
        );
        return {
            payload: {
                id: crypto.randomUUID(),
                product_symbol: pPosition.contractName,
                average_fill_price: vClosedAtIso ? (objClosed.sellPrice ?? objClosed.buyPrice ?? 0) : 0,
                order_type: "paper_market_order",
                isPaperTrade: true
            },
            placedAt: vClosedAtIso,
            realizedPnl: objClosed.pnl
        };
    }
    const { client } = await getDeltaClientForAccountId(pUserId, pSelectedApiProfileId);
    const vPlacedAtIso = new Date().toISOString();
    const vClientOrderId = await allocateStrategyClientOrderId(pUserId, pStrategyCode, pOrderKind);
    const objResponse = await client.apis.Orders.placeOrder({
        order: {
            product_symbol: pPosition.contractName,
            size: Math.max(1, Math.floor(Number(pPosition.qty || 0))),
            side: String(pPosition.side || "").trim().toUpperCase() === "BUY" ? "sell" : "buy",
            order_type: "market_order",
            time_in_force: "gtc",
            post_only: false,
            reduce_only: true,
            ...(vClientOrderId ? { client_order_id: vClientOrderId } : {})
        }
    });
    const objPayload = readResponsePayload(objResponse);
    return {
        payload: objPayload,
        placedAt: vPlacedAtIso,
        realizedPnl: await resolveTrackedPositionClosePnl(client, pPosition, objPayload, vPlacedAtIso)
    };
}

async function openTrackedOptionReEntry(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pSelectedApiProfileId: string,
    pProfile: RollingFuturesLtProfileRecord,
    pClosedPosition: RollingFuturesLtImportedPositionRecord,
    pMetadata: RollingFuturesLtOptionMetadata,
    pReason: "sl" | "tp" | "expiry_cutoff" | "delta_diff_replace",
    pOptions?: {
        forceExpiryDate?: string;
        useRowAction?: boolean;
        useRowQty?: boolean;
        useRowReEntryDelta?: boolean;
        forceLegSide?: "ce" | "pe";
        forceTargetDelta?: number;
    }
): Promise<{
    position: RollingFuturesLtImportedPositionRecord;
    orderPayload: Record<string, unknown>;
    placedAt: string;
} | null> {
    const objUiState = getMergedUiState(pProfile);
    const bCoveredRowDriven = isCoveredOptionsStrategy(pStrategyCode);
    const vRowIndex = isCoveredOptionsStrategy(pStrategyCode)
        ? resolveCoveredTrackedPositionRowIndex(objUiState, pClosedPosition, pMetadata.rowIndex)
        : normalizeOptionRowIndex(pStrategyCode, pMetadata.rowIndex);
    const objRowState = getNormalizedOptionRowUiState(objUiState, pStrategyCode, vRowIndex);
    const vSymbol = normalizeSymbolValue(objUiState.symbol);
    const vRequestedLegSide = pOptions?.forceLegSide === "pe"
        ? "pe"
        : (pOptions?.forceLegSide === "ce" ? "ce" : getTrackedOptionLegSide(pClosedPosition.contractName));
    let vLegSide = vRequestedLegSide;
    const bUseRowReEntryDelta = Boolean(pOptions?.useRowReEntryDelta) || bCoveredRowDriven;
    const vTargetDelta = Math.max(
        0,
        Number(
            pOptions?.forceTargetDelta
            ?? (bUseRowReEntryDelta ? objRowState.reD : undefined)
            ?? pMetadata.reEntryDelta
            ?? objRowState.reD
            ?? 0.53
        )
    );
    const vExpiryDate = normalizeIsoDateOnly(pOptions?.forceExpiryDate) || String(objRowState.expiryDate || "").trim();
    const vOrderAction = (pOptions?.useRowAction || bCoveredRowDriven)
        ? (String(objRowState.action || "sell").trim().toLowerCase() === "buy" ? "buy" as const : "sell" as const)
        : (String(pClosedPosition.side || "").trim().toUpperCase() === "BUY" ? "buy" as const : "sell" as const);
    const vOptionQty = (pOptions?.useRowQty || bCoveredRowDriven)
        ? Math.max(1, Math.floor(Number(objRowState.qty || pClosedPosition.qty || 1)))
        : Math.max(1, Math.floor(Number(pClosedPosition.qty || 1)));
    const vTakeProfitDelta = Math.max(
        0,
        Number(
            bCoveredRowDriven
                ? (objRowState.tpD ?? pMetadata.takeProfitDelta ?? 0.25)
                : (pMetadata.takeProfitDelta ?? objRowState.tpD ?? 0.25)
        )
    );
    const vStopLossDelta = Math.max(
        0,
        Number(
            bCoveredRowDriven
                ? (objRowState.slD ?? pMetadata.stopLossDelta ?? 0.65)
                : (pMetadata.stopLossDelta ?? objRowState.slD ?? 0.65)
        )
    );
    if (!(vTargetDelta > 0)) {
        return null;
    }
    if (isCoveredOptionsStrategy(pStrategyCode) && vOrderAction === "buy") {
        const arrTrackedPositions = await listRollingFuturesLtImportedPositions(pUserId, pStrategyCode);
        const objGate = evaluateCoveredBuyHedgeSellPremiumGate(arrTrackedPositions, objUiState, vRequestedLegSide);
        if (!objGate.allowed) {
            await logFuturesEvent(
                pUserId,
                pStrategyCode,
                "manual_action",
                "info",
                "Covered Buy Hedge Re-Entry Skipped",
                objGate.message || `Matching ${vLegSide.toUpperCase()} sell premium gate blocked buy hedge re-entry.`,
                {
                    contractName: pClosedPosition.contractName,
                    legSide: vLegSide,
                    rowIndex: vRowIndex,
                    reason: "covered_buy_hedge_premium_gate"
                }
            );
            return null;
        }
        const vResolvedTargetLegSide = resolveCoveredBuyHedgeTargetLegSide(pStrategyCode, arrTrackedPositions, objUiState, vRowIndex, vRequestedLegSide);
        if (!vResolvedTargetLegSide) {
            return null;
        }
        vLegSide = vResolvedTargetLegSide;
    }

    if (isOptionsScalperStrategy(pStrategyCode)) {
        const objPaperOpen = await buildOptionsScalperPaperOptionOpen(
            pUserId,
            pStrategyCode,
            pProfile,
            {
                action: vOrderAction,
                symbol: vSymbol,
                legSide: vLegSide,
                expiryMode: (["1", "2", "4", "5", "6", "7"].includes(String(objRowState.expiryMode || "5").trim())
                    ? String(objRowState.expiryMode || "5").trim()
                    : "5") as "1" | "2" | "4" | "5" | "6" | "7",
                expiryDate: vExpiryDate,
                qty: vOptionQty,
                targetDelta: vTargetDelta,
                rowIndex: vRowIndex,
                openedReason: pReason === "sl"
                    ? "sl_reentry"
                    : (pReason === "tp"
                        ? "tp_reentry"
                        : (pReason === "delta_diff_replace" ? "delta_diff_reentry" : "expiry_cutoff_reentry")),
                takeProfitDelta: vTakeProfitDelta,
                stopLossDelta: vStopLossDelta,
                reEntryDelta: vTargetDelta,
                reEnterEnabled: Boolean(pMetadata.reEnterEnabled)
            }
        );
        return {
            position: objPaperOpen.position,
            orderPayload: objPaperOpen.order,
            placedAt: String(objPaperOpen.order.filled_at || new Date().toISOString())
        };
    }
    const { client } = await getDeltaClientForAccountId(pUserId, pSelectedApiProfileId);

    const objConfig = {
        symbol: vSymbol,
        contractName: getContractNameForSymbol(vSymbol),
        lotSize: getLotSizeForSymbol(vSymbol),
        futureQty: 1,
        futureOrderType: "market_order" as const,
        action: vOrderAction,
        legSide: vLegSide,
        expiryMode: (["1", "2", "4", "5", "6", "7"].includes(String(objRowState.expiryMode || "5").trim())
            ? String(objRowState.expiryMode || "5").trim()
            : "5") as "1" | "2" | "4" | "5" | "6" | "7",
        expiryDate: vExpiryDate,
        optionQty: vOptionQty,
        redOptionQtyPct: 100,
        greenOptionQtyPct: 100,
        newDelta: vTargetDelta,
        reDelta: vTargetDelta,
        deltaTakeProfit: vTakeProfitDelta,
        deltaStopLoss: vStopLossDelta,
        reEnter: pReason === "delta_diff_replace" ? true : Boolean(pMetadata.reEnterEnabled),
        addOneLotFuture: false,
        renkoEnabled: false,
        renkoStepPoints: 10,
        renkoPriceSource: "spot_price" as const,
        loopSeconds: 8
    };

    const objContract = await findBestLiveOptionContractWithNearestFallback(
        objConfig,
        vLegSide === "pe" ? "PE" : "CE",
        vTargetDelta
    );
    if (!objContract) {
        return null;
    }
    if (isCoveredOptionsStrategy(pStrategyCode) && vOrderAction === "buy") {
        const vResolvedContractExpiryDate = normalizeIsoDateOnly(objContract.expiryDate);
        const objCurrentDeltaTime = getCurrentDeltaUiDateTimeParts();
        if (vResolvedContractExpiryDate && vResolvedContractExpiryDate <= objCurrentDeltaTime.date) {
            await logFuturesEvent(
                pUserId,
                pStrategyCode,
                "manual_action",
                "info",
                "Covered Buy Hedge Re-Entry Skipped",
                `Skipped ${vLegSide.toUpperCase()} buy hedge re-entry because the selected contract ${String(objContract.contractSymbol || "").trim()} is already on the expiry cutoff date ${vResolvedContractExpiryDate}.`,
                {
                    contractName: String(objContract.contractSymbol || "").trim(),
                    legSide: vLegSide,
                    rowIndex: vRowIndex,
                    resolvedExpiryDate: vResolvedContractExpiryDate,
                    reason: "covered_buy_hedge_expiry_cutoff_blocked"
                }
            );
            return null;
        }
    }

    const vAbsoluteDelta = Math.abs(Number(objContract.delta || 0));
    if (shouldTriggerTrackedOption(
        vOrderAction.toUpperCase(),
        vAbsoluteDelta,
        Number(pMetadata.takeProfitDelta || objRowState.tpD || 0.25),
        Number(pMetadata.stopLossDelta || objRowState.slD || 0.65)
    ).shouldAct) {
        return null;
    }

    const vPlacedAtIso = new Date().toISOString();
    const vClientOrderId = await allocateStrategyClientOrderId(pUserId, pStrategyCode, "RE");
    const objReEntryResponse = await client.apis.Orders.placeOrder({
        order: {
            product_symbol: objContract.contractSymbol,
            size: vOptionQty,
            side: vOrderAction,
            order_type: "market_order",
            time_in_force: "gtc",
            post_only: false,
            reduce_only: false,
            ...(vClientOrderId ? { client_order_id: vClientOrderId } : {})
        }
    });
    const objReEntryPayload = readResponsePayload(objReEntryResponse);

    return {
        position: {
            userId: pUserId,
            strategyCode: pStrategyCode,
            importId: crypto.randomUUID(),
            contractName: String(objContract.contractSymbol || "").trim(),
            side: vOrderAction.toUpperCase(),
            qty: vOptionQty,
            entryPrice: Number(objContract.markPrice || 0),
            markPrice: Number(objContract.markPrice || 0),
            charges: 0,
            pnl: 0,
            margin: 0,
            liquidationPrice: 0,
            metadata: optionMetadataToRecord({
                rowIndex: vRowIndex,
                baseDelta: getSignedOptionBaseDelta(String(objContract.contractSymbol || "").trim(), vAbsoluteDelta),
                baseTheta: Math.abs(Number(objContract.theta || 0)),
                takeProfitDelta: vTakeProfitDelta,
                stopLossDelta: vStopLossDelta,
                reEntryDelta: vTargetDelta,
                reEnterEnabled: Boolean(pMetadata.reEnterEnabled),
        openedReason: pReason === "sl"
            ? "sl_reentry"
            : (pReason === "tp"
                ? "tp_reentry"
                : (pReason === "delta_diff_replace" ? "delta_diff_reentry" : "expiry_cutoff_reentry")),
                requestedExpiryDate: objContract.requestedExpiryDate,
                resolvedExpiryDate: objContract.expiryDate
            }),
            openedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        },
        orderPayload: objReEntryPayload,
        placedAt: vPlacedAtIso
    };
}

async function executeCoveredPendingReEntryNow(
    pUserId: string,
    pSelectedApiProfileId: string,
    pProfile: RollingFuturesLtProfileRecord,
    pPending: CoveredPendingOptionReEntryState
): Promise<boolean> {
    const pStrategyCode = isCoveredOptionsStrategy(pProfile.strategyCode) ? pProfile.strategyCode : "covered-options";
    const objProfile = await refreshModeDrivenExpiryDatesInProfile(pUserId, pStrategyCode, pProfile);
    let arrSavedPositions = await listRollingFuturesLtImportedPositions(pUserId, pStrategyCode);
    if (hasTrackedOptionRowLeg(arrSavedPositions, pPending.rowIndex, pPending.legSide, getMergedUiState(objProfile))) {
        return false;
    }
    const objPlaceholderPosition = buildCoveredReEntryPlaceholderPosition(
        pUserId,
        pStrategyCode,
        pPending.rowIndex,
        pPending.legSide,
        pPending.action,
        pPending.qty
    );
    const objMetadata: RollingFuturesLtOptionMetadata = {
        rowIndex: pPending.rowIndex,
        takeProfitDelta: Math.max(0, Number(getNormalizedOptionRowUiState(getMergedUiState(objProfile), pStrategyCode, pPending.rowIndex).tpD || 0)),
        stopLossDelta: Math.max(0, Number(getNormalizedOptionRowUiState(getMergedUiState(objProfile), pStrategyCode, pPending.rowIndex).slD || 0)),
        reEntryDelta: Math.max(0, Number(pPending.targetDelta || 0)),
        reEnterEnabled: true,
        openedReason: pPending.reason
    };
    const objPendingRowState = getNormalizedOptionRowUiState(getMergedUiState(objProfile), pStrategyCode, pPending.rowIndex);
    const vResolvedPendingExpiryDate = pPending.reason === "expiry_cutoff"
        ? String(pPending.expiryDate || "").trim()
        : String(objPendingRowState.expiryDate || "").trim();
    const objReEntry = await openTrackedOptionReEntry(
        pUserId,
        pStrategyCode,
        pSelectedApiProfileId,
        objProfile,
        objPlaceholderPosition,
        objMetadata,
        pPending.reason === "tp" || pPending.reason === "expiry_cutoff" ? pPending.reason : "sl",
        {
            useRowAction: true,
            useRowQty: true,
            useRowReEntryDelta: true,
            forceLegSide: pPending.legSide,
            forceTargetDelta: pPending.targetDelta,
            forceExpiryDate: vResolvedPendingExpiryDate,
        }
    );
    if (!objReEntry) {
        return false;
    }
    arrSavedPositions = await replaceRollingFuturesLtImportedPositions(pUserId, pStrategyCode, [
        ...arrSavedPositions,
        objReEntry.position
    ]);
    if (String(objReEntry.position.side || "").trim().toUpperCase() === "BUY") {
        const objGateConfig = getCoveredBuyHedgeSellPremiumGateConfig(getMergedUiState(objProfile));
        await logFuturesEvent(
            pUserId,
            pStrategyCode,
            "reentry_opened",
            "success",
            "Covered Buy Hedge Reopened",
            `${String(objReEntry.position.contractName || "").trim()} reopened for row ${pPending.rowIndex}. ${getCoveredBuyHedgeOpenReasonText(pPending.reason, pPending.legSide, { thresholdPct: objGateConfig.enabled ? objGateConfig.thresholdPct : Number.NaN })}`,
            {
                contractName: objReEntry.position.contractName,
                rowIndex: pPending.rowIndex,
                legSide: pPending.legSide,
                reason: "covered_buy_hedge_reentry_opened"
            }
        );
    }
    const objRuntime = await loadRollingFuturesLtRuntime(pUserId, pStrategyCode)
        || getDefaultRollingFuturesLtRuntime(pUserId, pStrategyCode);
    const arrPending = getCoveredPendingOptionReEntriesState(objRuntime)
        .filter((objEntry) => objEntry.dedupeKey !== pPending.dedupeKey);
    await saveRollingFuturesLtRuntime({
        ...objRuntime,
        userId: pUserId,
        strategyCode: pStrategyCode,
        state: buildRuntimeStateWithCoveredPendingOptionReEntries(
            {
                ...objRuntime,
                state: buildRuntimeStateWithCoveredLiveConfirmation(objRuntime, null)
            },
            arrPending
        )
    });
    await logFuturesEvent(
        pUserId,
        pStrategyCode,
        "reentry_opened",
        "success",
        "Covered Leg Re-Entry Opened",
        `Recovered missing row ${pPending.rowIndex} ${pPending.legSide.toUpperCase()} leg after confirmation.`,
        {
            contractName: objReEntry.position.contractName,
            rowIndex: pPending.rowIndex,
            legSide: pPending.legSide,
            reason: "covered_option_reentry_confirmed"
        }
    );
    return true;
}

async function upsertCoveredPendingOptionReEntry(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pEntry: CoveredPendingOptionReEntryState
): Promise<void> {
    const objRuntime = await loadRollingFuturesLtRuntime(pUserId, pStrategyCode)
        || getDefaultRollingFuturesLtRuntime(pUserId, pStrategyCode);
    const arrExisting = getCoveredPendingOptionReEntriesState(objRuntime);
    const arrNext = [
        ...arrExisting.filter((objExisting) => objExisting.dedupeKey !== pEntry.dedupeKey),
        pEntry
    ].sort((pLeft, pRight) => pLeft.dedupeKey.localeCompare(pRight.dedupeKey));
    await saveRollingFuturesLtRuntime({
        ...objRuntime,
        userId: pUserId,
        strategyCode: pStrategyCode,
        state: buildRuntimeStateWithCoveredPendingOptionReEntries(objRuntime, arrNext)
    });
}

async function scheduleCoveredPendingOptionReEntry(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pProfile: RollingFuturesLtProfileRecord,
    pRowIndex: 1 | 2,
    pLegSide: "ce" | "pe",
    pReason: "sl" | "tp" | "expiry_cutoff" | "missing_leg",
    pOptions?: {
        qty?: number;
        action?: "buy" | "sell";
        targetDelta?: number;
        expiryMode?: string;
        expiryDate?: string;
        closedContractName?: string;
        lastError?: string;
        attemptCount?: number;
    }
): Promise<void> {
    const objUiState = getMergedUiState(pProfile);
    const objRowState = getNormalizedOptionRowUiState(objUiState, pStrategyCode, pRowIndex);
    const objEntry: CoveredPendingOptionReEntryState = {
        dedupeKey: `${pRowIndex}:${pLegSide}`,
        rowIndex: pRowIndex,
        legSide: pLegSide,
        action: pOptions?.action || objRowState.action,
        qty: Math.max(1, Math.floor(Number(pOptions?.qty || objRowState.qty || 1))),
        reason: pReason,
        targetDelta: Math.max(0, Number(pOptions?.targetDelta ?? objRowState.reD ?? 0.53)),
        expiryMode: String(pOptions?.expiryMode || objRowState.expiryMode || "").trim(),
        expiryDate: String(pOptions?.expiryDate || objRowState.expiryDate || "").trim(),
        runAt: new Date(Date.now() + gCoveredOptionReEntryRetryMs).toISOString(),
        scheduledAt: new Date().toISOString(),
        attemptCount: Math.max(0, Math.floor(Number(pOptions?.attemptCount || 0))),
        closedContractName: String(pOptions?.closedContractName || "").trim(),
        lastError: String(pOptions?.lastError || "").trim()
    };
    await upsertCoveredPendingOptionReEntry(pUserId, pStrategyCode, objEntry);
}

function buildCoveredReEntryPlaceholderPosition(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pRowIndex: 1 | 2,
    pLegSide: "ce" | "pe",
    pAction: "buy" | "sell",
    pQty: number
): RollingFuturesLtImportedPositionRecord {
    return {
        userId: pUserId,
        strategyCode: pStrategyCode,
        importId: `pending-${pRowIndex}-${pLegSide}`,
        contractName: `${pLegSide === "pe" ? "P" : "C"}-PENDING`,
        side: pAction.toUpperCase(),
        qty: Math.max(1, Math.floor(Number(pQty || 1))),
        entryPrice: 0,
        markPrice: 0,
        charges: 0,
        pnl: 0,
        margin: 0,
        liquidationPrice: 0,
        metadata: optionMetadataToRecord({
            rowIndex: pRowIndex,
            reEnterEnabled: true
        }),
        openedAt: "",
        updatedAt: ""
    };
}

async function processCoveredPendingOptionReEntries(
    pUserId: string,
    pSelectedApiProfileId: string,
    pProfile: RollingFuturesLtProfileRecord,
    pTrackedPositions: RollingFuturesLtImportedPositionRecord[]
): Promise<RollingFuturesLtImportedPositionRecord[]> {
    const pStrategyCode = isCoveredOptionsStrategy(pProfile.strategyCode) ? pProfile.strategyCode : "covered-options";
    let arrSavedPositions = [...pTrackedPositions];
    const objRuntime = await loadRollingFuturesLtRuntime(pUserId, pStrategyCode)
        || getDefaultRollingFuturesLtRuntime(pUserId, pStrategyCode);
    const arrPending = getCoveredPendingOptionReEntriesState(objRuntime);
    if (!arrPending.length) {
        return arrSavedPositions;
    }
    const vNowMs = Date.now();
    let arrNextPending = [...arrPending];
    const { client } = await getDeltaClientForAccountId(pUserId, pSelectedApiProfileId);
    const objUiState = getMergedUiState(pProfile);
    const vSymbol = normalizeSymbolValue(objUiState.symbol);
    for (const objPending of arrPending) {
        const objRowState = getNormalizedOptionRowUiState(objUiState, pStrategyCode, objPending.rowIndex);
        const vConfiguredQty = Math.max(1, Math.floor(Number(objRowState.qty || 1)));
        const vCurrentOpenQty = getTrackedOptionRowLegTotalQty(arrSavedPositions, objPending.rowIndex, objPending.legSide, objUiState);
        if (vCurrentOpenQty > vConfiguredQty) {
            arrNextPending = arrNextPending.filter((objEntry) => objEntry.dedupeKey !== objPending.dedupeKey);
            await logFuturesEvent(
                pUserId,
                pStrategyCode,
                "engine_error",
                "warning",
                "Covered Leg Re-Entry Blocked",
                `Row ${objPending.rowIndex} ${objPending.legSide.toUpperCase()} already has open quantity ${vCurrentOpenQty}, above configured Qty ${vConfiguredQty}. Pending re-entry was blocked.`,
                {
                    rowIndex: objPending.rowIndex,
                    legSide: objPending.legSide,
                    openQty: vCurrentOpenQty,
                    configuredQty: vConfiguredQty,
                    reason: "covered_option_reentry_blocked_qty_exceeded"
                }
            );
            continue;
        }
        if (hasTrackedOptionRowLeg(arrSavedPositions, objPending.rowIndex, objPending.legSide, objUiState)) {
            arrNextPending = arrNextPending.filter((objEntry) => objEntry.dedupeKey !== objPending.dedupeKey);
            continue;
        }
        const vRunAtMs = new Date(objPending.runAt).getTime();
        if (!Number.isFinite(vRunAtMs) || vRunAtMs > vNowMs) {
            continue;
        }
        if (String(objPending.action || "").trim().toLowerCase() === "buy") {
            const objGate = evaluateCoveredBuyHedgeSellPremiumGate(
                arrSavedPositions,
                objUiState,
                objPending.legSide
            );
            if (objGate.enabled && !objGate.allowed) {
                continue;
            }
        }
        const objMetadata: RollingFuturesLtOptionMetadata = {
            rowIndex: objPending.rowIndex,
            reEntryDelta: Math.max(0, Number(objPending.targetDelta || objRowState.reD || 0.53)),
            takeProfitDelta: Math.max(0, Number(objRowState.tpD || 0)),
            stopLossDelta: Math.max(0, Number(objRowState.slD || 0)),
            reEnterEnabled: Boolean(objRowState.reEnter)
        };
        try {
            const vCancelledCount = await cancelOpenCoveredOptionEntryOrdersForLeg(
                client,
                vSymbol,
                objPending.legSide,
                objPending.action
            );
            if (vCancelledCount > 0) {
                await logFuturesEvent(
                    pUserId,
                    pStrategyCode,
                    "manual_action",
                    "info",
                    "Pending Re-Entry Orders Cancelled",
                    `Cancelled ${vCancelledCount} pending order${vCancelledCount === 1 ? "" : "s"} for row ${objPending.rowIndex} ${objPending.legSide.toUpperCase()} before retrying the missing covered leg.`,
                    {
                        rowIndex: objPending.rowIndex,
                        legSide: objPending.legSide,
                        reason: "covered_option_reentry_cancelled_pending"
                    }
                );
            }
            const objQueueResult = await queueCoveredReEntryAction(
                pUserId,
                pProfile,
                objPending
            );
            if (!objQueueResult.created) {
                continue;
            }
            arrNextPending = arrNextPending.filter((objEntry) => objEntry.dedupeKey !== objPending.dedupeKey);
        }
        catch (objError) {
            const objFailure = await classifyCoveredOptionReEntryFailure(objError);
            if (objFailure.type === "connection") {
                arrNextPending = arrNextPending.map((objEntry) => objEntry.dedupeKey !== objPending.dedupeKey
                    ? objEntry
                    : {
                        ...objEntry,
                        runAt: new Date(Date.now() + gCoveredOptionReEntryRetryMs).toISOString(),
                        attemptCount: objEntry.attemptCount + 1,
                        lastError: objFailure.message
                    });
                await logFuturesEvent(
                    pUserId,
                    pStrategyCode,
                    "delta_exchange_error",
                    "warning",
                    "Covered Leg Re-Entry Deferred",
                    `${objFailure.message} Retry for row ${objPending.rowIndex} ${objPending.legSide.toUpperCase()} is scheduled after 1 minute.`,
                    {
                        rowIndex: objPending.rowIndex,
                        legSide: objPending.legSide,
                        retryAt: new Date(Date.now() + gCoveredOptionReEntryRetryMs).toISOString(),
                        reason: "covered_option_reentry_connection_retry"
                    }
                );
                continue;
            }
            arrNextPending = arrNextPending.filter((objEntry) => objEntry.dedupeKey !== objPending.dedupeKey);
            await logFuturesEvent(
                pUserId,
                pStrategyCode,
                objFailure.type === "insufficient_margin" ? "engine_error" : "delta_exchange_error",
                objFailure.type === "insufficient_margin" ? "warning" : "error",
                objFailure.type === "insufficient_margin"
                    ? "Covered Leg Re-Entry Skipped"
                    : "Covered Leg Re-Entry Failed",
                objFailure.type === "insufficient_margin"
                    ? `${objFailure.message} No retry will be attempted for row ${objPending.rowIndex} ${objPending.legSide.toUpperCase()}.`
                    : objFailure.message,
                {
                    rowIndex: objPending.rowIndex,
                    legSide: objPending.legSide,
                    reason: objFailure.type === "insufficient_margin"
                        ? "covered_option_reentry_insufficient_margin"
                        : "covered_option_reentry_failed"
                }
            );
        }
    }
    const objLatestRuntime = await loadRollingFuturesLtRuntime(pUserId, pStrategyCode)
        || getDefaultRollingFuturesLtRuntime(pUserId, pStrategyCode);
    await saveRollingFuturesLtRuntime({
        ...objLatestRuntime,
        userId: pUserId,
        strategyCode: pStrategyCode,
        state: buildRuntimeStateWithCoveredPendingOptionReEntries(objLatestRuntime, arrNextPending)
    });
    return arrSavedPositions;
}

async function ensureCoveredConfiguredLegPresence(
    pUserId: string,
    pProfile: RollingFuturesLtProfileRecord,
    pTrackedPositions: RollingFuturesLtImportedPositionRecord[]
): Promise<void> {
    const pStrategyCode = isCoveredOptionsStrategy(pProfile.strategyCode) ? pProfile.strategyCode : "covered-options";
    const objUiState = getMergedUiState(pProfile);
    const objRuntime = await loadRollingFuturesLtRuntime(pUserId, pStrategyCode)
        || getDefaultRollingFuturesLtRuntime(pUserId, pStrategyCode);
    const arrPending = getCoveredPendingOptionReEntriesState(objRuntime);
    let bScheduledAny = false;
    for (const vRowIndex of [1, 2] as const) {
        const objRowState = getNormalizedOptionRowUiState(objUiState, pStrategyCode, vRowIndex);
        const arrRequiredLegs = objRowState.legs === "both"
            ? ["ce", "pe"] as Array<"ce" | "pe">
            : [objRowState.legs];
        const vExistingCount = arrRequiredLegs.filter((vLegSide) => hasTrackedOptionRowLeg(pTrackedPositions, vRowIndex, vLegSide, objUiState)).length;
        const arrMissingLegs = arrRequiredLegs.filter((vLegSide) => !hasTrackedOptionRowLeg(pTrackedPositions, vRowIndex, vLegSide, objUiState));
        const arrPendingForRow = arrPending.filter((objEntry) => objEntry.rowIndex === vRowIndex);
        const arrPendingLegSides = Array.from(new Set(arrPendingForRow.map((objEntry) => objEntry.legSide)));
        const bAlternatingMissingLegDetected = arrMissingLegs.some((vLegSide) => !arrPendingLegSides.includes(vLegSide));
        if (vExistingCount > 0
            && arrMissingLegs.length > 0
            && (arrPendingLegSides.length > 1 || (arrPendingLegSides.length > 0 && bAlternatingMissingLegDetected))) {
            const objSavedRuntime = await saveRollingFuturesLtRuntime({
                ...objRuntime,
                userId: pUserId,
                strategyCode: pStrategyCode,
                status: "stopped",
                autoTraderEnabled: false,
                selectedApiProfileId: String(objRuntime.selectedApiProfileId || pProfile.selectedApiProfileId || "").trim(),
                currentSymbol: String(objUiState.symbol || "")
            });
            await logFuturesEvent(
                pUserId,
                pStrategyCode,
                "engine_stopped",
                "error",
                "Covered Re-Entry Churn Protection Triggered",
                `Auto trader stopped because row ${vRowIndex} started alternating missing covered legs (${arrMissingLegs.map((vLegSide) => vLegSide.toUpperCase()).join(", ")}) while pending re-entry already existed for ${arrPendingLegSides.map((vLegSide) => vLegSide.toUpperCase()).join(", ")}. Review live positions before restarting.`,
                {
                    rowIndex: vRowIndex,
                    missingLegs: arrMissingLegs,
                    pendingLegs: arrPendingLegSides,
                    symbol: objSavedRuntime.currentSymbol || "",
                    reason: "covered_option_reentry_churn_protection"
                }
            );
            stopAutoTraderCycle(pUserId, pStrategyCode);
            await releaseDualStrategyLease(pUserId, pStrategyCode, true);
            return;
        }
        if (objRowState.action !== "buy") {
            continue;
        }
        for (const vLegSide of arrMissingLegs) {
            const vResolvedLegSide = resolveCoveredBuyHedgeTargetLegSide(pStrategyCode, pTrackedPositions, objUiState, vRowIndex, vLegSide);
            if (!vResolvedLegSide) {
                continue;
            }
            const bAlreadyPending = arrPending.some((objEntry) => objEntry.rowIndex === vRowIndex && objEntry.legSide === vResolvedLegSide);
            if (bAlreadyPending) {
                continue;
            }
            const objNegativeSellCheck = isCoveredSellLegNegativeForBuyHedge(pTrackedPositions, vLegSide);
            if (!objNegativeSellCheck.negative) {
                continue;
            }
            const objGate = evaluateCoveredBuyHedgeSellPremiumGate(pTrackedPositions, objUiState, vLegSide);
            if (objGate.enabled && !objGate.allowed) {
                continue;
            }
            await scheduleCoveredPendingOptionReEntry(
                pUserId,
                pStrategyCode,
                pProfile,
                vRowIndex,
                vResolvedLegSide,
                "missing_leg"
            );
            bScheduledAny = true;
            await logFuturesEvent(
                pUserId,
                pStrategyCode,
                "manual_action",
                "info",
                "Covered Buy Hedge Re-Entry Scheduled",
                `Row ${vRowIndex} ${vLegSide.toUpperCase()} buy hedge is missing and the matching sell leg is now in loss. A re-entry will be checked by the engine.`,
                {
                    rowIndex: vRowIndex,
                    legSide: vLegSide,
                    reason: "covered_buy_hedge_missing_leg_scheduled"
                }
            );
        }
    }
    if (!bScheduledAny) {
        return;
    }
    await processCoveredPendingOptionReEntries(
        pUserId,
        String(objRuntime.selectedApiProfileId || pProfile.selectedApiProfileId || "").trim(),
        pProfile,
        pTrackedPositions
    );
}

async function restoreCoveredMissingBuyHedgesAfterImport(
    pUserId: string,
    pSelectedApiProfileId: string,
    pProfile: RollingFuturesLtProfileRecord,
    pTrackedPositions: RollingFuturesLtImportedPositionRecord[]
): Promise<RollingFuturesLtImportedPositionRecord[]> {
    const pStrategyCode = isCoveredOptionsStrategy(pProfile.strategyCode) ? pProfile.strategyCode : "covered-options";
    const objUiState = getMergedUiState(pProfile);
    const objGateConfig = getCoveredBuyHedgeSellPremiumGateConfig(objUiState);
    if (!objGateConfig.enabled) {
        return pTrackedPositions;
    }
    const objRuntime = await loadRollingFuturesLtRuntime(pUserId, pStrategyCode);
    const bAutoTraderOn = Boolean(objRuntime?.autoTraderEnabled)
        && String(objRuntime?.status || "").trim().toLowerCase() === "running";
    if (!bAutoTraderOn) {
        return pTrackedPositions;
    }

    let arrSavedPositions = [...pTrackedPositions];
    let bScheduledAny = false;
    for (const vRowIndex of [1, 2] as const) {
        const objRowState = getNormalizedOptionRowUiState(objUiState, pStrategyCode, vRowIndex);
        if (objRowState.action !== "buy") {
            continue;
        }
        const arrRequiredLegs = objRowState.legs === "both"
            ? ["ce", "pe"] as Array<"ce" | "pe">
            : [objRowState.legs];
        for (const vLegSide of arrRequiredLegs) {
            if (hasTrackedOptionRowLeg(arrSavedPositions, vRowIndex, vLegSide, objUiState)) {
                continue;
            }
            const vResolvedLegSide = resolveCoveredBuyHedgeTargetLegSide(pStrategyCode, arrSavedPositions, objUiState, vRowIndex, vLegSide);
            if (!vResolvedLegSide) {
                continue;
            }
            const objNegativeSellCheck = isCoveredSellLegNegativeForBuyHedge(arrSavedPositions, vLegSide);
            if (!objNegativeSellCheck.negative) {
                continue;
            }
            const objGate = evaluateCoveredBuyHedgeSellPremiumGate(arrSavedPositions, objUiState, vLegSide);
            if (!objGate.allowed) {
                continue;
            }
            await scheduleCoveredPendingOptionReEntry(
                pUserId,
                pStrategyCode,
                pProfile,
                vRowIndex,
                vResolvedLegSide,
                "missing_leg"
            );
            bScheduledAny = true;
            await logFuturesEvent(
                pUserId,
                pStrategyCode,
                "manual_action",
                "info",
                "Covered Buy Hedge Import Restore Scheduled",
                `Imported ${vLegSide.toUpperCase()} sell leg is in loss and still satisfies the ${objGateConfig.thresholdPct.toFixed(2)}% threshold, so the missing buy hedge for row ${vRowIndex} was scheduled for restore.`,
                {
                    rowIndex: vRowIndex,
                    legSide: vLegSide,
                    thresholdPct: objGateConfig.thresholdPct,
                    reason: "covered_buy_hedge_import_restore_scheduled"
                }
            );
        }
    }

    if (!bScheduledAny) {
        return arrSavedPositions;
    }
    arrSavedPositions = await processCoveredPendingOptionReEntries(
        pUserId,
        pSelectedApiProfileId,
        pProfile,
        arrSavedPositions
    );
    return arrSavedPositions;
}

async function applyTriggeredOptionRule(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pSelectedApiProfileId: string,
    pProfile: RollingFuturesLtProfileRecord,
    pPosition: RollingFuturesLtImportedPositionRecord,
    pCurrentDelta: number,
    pCurrentMarkPrice: number | null,
    pReason: "sl" | "tp" | "expiry_cutoff" | "delta_diff_replace",
    pTrackedPositions: RollingFuturesLtImportedPositionRecord[],
    pSkipConfirmation = false,
    pOptions?: {
        forceReEntryTargetDelta?: number;
        deltaDiffPct?: number;
        deltaDiffThresholdPct?: number;
        strongerContractName?: string;
        strongerDelta?: number;
    }
): Promise<RollingFuturesLtImportedPositionRecord[]> {
    let objProfile = pProfile;
    if (isCoveredLikeStrategy(pStrategyCode)) {
        objProfile = await refreshModeDrivenExpiryDatesInProfile(pUserId, pStrategyCode, objProfile);
    }
    const vStrategyLabel = getCoveredLikeStrategyLabel(pStrategyCode);
    const objRuleRowState = getNormalizedOptionRowUiState(
        getMergedUiState(objProfile),
        pStrategyCode,
        getTrackedOptionMetadata(pPosition).rowIndex
    );
    const vAppliedTakeProfitDelta = Math.max(0, Number(objRuleRowState.tpD || getTrackedOptionMetadata(pPosition).takeProfitDelta || 0.25));
    const vAppliedStopLossDelta = Math.max(0, Number(objRuleRowState.slD || getTrackedOptionMetadata(pPosition).stopLossDelta || 0.65));
    if (isCoveredOptionsStrategy(pStrategyCode) && !pSkipConfirmation) {
        const vConfirmationResult = await requestCoveredLiveConfirmation(pUserId, objProfile, {
            kind: "option_rule_close",
            title: pReason === "sl"
                ? "Confirm SL Close"
                : (pReason === "tp"
                    ? "Confirm TP Close"
                    : "Confirm Expiry Close"),
            message: pReason === "expiry_cutoff"
                ? `${vStrategyLabel} option ${pPosition.contractName} is on its expiry date. Confirm to swap it into the next expiry.`
                : `${vStrategyLabel} option ${String(pPosition.side || "").trim().toUpperCase()} ${pPosition.contractName} on row ${objRuleRowState.rowIndex} hit ${pReason.toUpperCase()} at delta ${Math.abs(Number(pCurrentDelta || 0)).toFixed(3)} (TP ${vAppliedTakeProfitDelta.toFixed(3)}, SL ${vAppliedStopLossDelta.toFixed(3)}). Confirm to close it.`,
            payload: {
                importId: pPosition.importId,
                contractName: pPosition.contractName,
                reason: pReason
            }
        });
        if (vConfirmationResult === "queued" || vConfirmationResult === "suppressed") {
            return pTrackedPositions;
        }
    }
    const objCloseResult = await closeTrackedPositionOnDelta(
        pUserId,
        pStrategyCode,
        pSelectedApiProfileId,
        pPosition,
        pReason === "sl" ? "SL" : (pReason === "tp" ? "TP" : "CL")
    );
    const { client } = await getDeltaClientForAccountId(pUserId, pSelectedApiProfileId);
    const objMetadata = getTrackedOptionMetadata(pPosition);
    const vResolvedCloseCharge = await resolveOrderChargeFromDelta(
        client,
        pPosition.contractName,
        objCloseResult.payload,
        String(pPosition.side || "").trim().toUpperCase() === "BUY" ? "SELL" : "BUY",
        Number(pPosition.qty || 0),
        objCloseResult.placedAt
    );
    const vCloseCharge = vResolvedCloseCharge !== null
        ? vResolvedCloseCharge
        : await estimateTrackedPositionCharge(
            pPosition,
            Number(pPosition.markPrice || pPosition.entryPrice || 0)
        );
    const vClosePnl = Number.isFinite(Number(objCloseResult.realizedPnl))
        ? Number(objCloseResult.realizedPnl)
        : estimateTrackedPositionPnl(
            pPosition,
            Number.isFinite(Number(pCurrentMarkPrice))
                ? Number(pCurrentMarkPrice)
                : Number(pPosition.markPrice || pPosition.entryPrice || 0)
        );
    let arrNextPositions = pTrackedPositions.filter((objRow) => objRow.importId !== pPosition.importId);

    if (pReason === "expiry_cutoff") {
        await logFuturesEvent(
            pUserId,
            pStrategyCode,
            "option_closed",
            "info",
            "Expiry-Day Swap Closed",
            `Closed expiry-day option ${pPosition.contractName} after midnight so it can be swapped into the next expiry before Delta's own expiry close.`,
            {
                contractName: pPosition.contractName,
                qty: pPosition.qty,
                resolvedExpiryDate: getTrackedOptionResolvedExpiryDate(pPosition),
                reason: pReason
            }
        );
    }
    else if (pReason === "delta_diff_replace") {
        await logFuturesEvent(
            pUserId,
            pStrategyCode,
            "manual_action",
            "info",
            "Strangle Delta Diff Replace Triggered",
            `Closed weaker leg ${pPosition.contractName} because its live delta ${Math.abs(Number(pCurrentDelta || 0)).toFixed(3)} lagged stronger leg ${String(pOptions?.strongerContractName || "").trim() || "-" } at ${Math.abs(Number(pOptions?.strongerDelta || 0)).toFixed(3)} and the delta gap ${Number(pOptions?.deltaDiffPct || 0).toFixed(2)}% exceeded ${Number(pOptions?.deltaDiffThresholdPct || 0).toFixed(2)}%.`,
            {
                contractName: pPosition.contractName,
                qty: pPosition.qty,
                currentDelta: Math.abs(Number(pCurrentDelta || 0)),
                strongerContractName: String(pOptions?.strongerContractName || "").trim(),
                strongerDelta: Number(Number(pOptions?.strongerDelta || 0).toFixed(4)),
                deltaDiffPct: Number(Number(pOptions?.deltaDiffPct || 0).toFixed(4)),
                thresholdPct: Number(Number(pOptions?.deltaDiffThresholdPct || 0).toFixed(4)),
                reason: pReason,
                rowIndex: objRuleRowState.rowIndex
            }
        );
    }
    else {
        await logFuturesEvent(
            pUserId,
            pStrategyCode,
            pReason === "sl" ? "sl_triggered" : "tp_triggered",
            pReason === "sl" ? "warning" : "info",
            pReason === "sl" ? "Option SL Triggered" : "Option TP Triggered",
            `Closed option ${pPosition.contractName} after ${pReason.toUpperCase()} hit at delta ${Math.abs(Number(pCurrentDelta || 0)).toFixed(3)} using row ${objRuleRowState.rowIndex} TP ${vAppliedTakeProfitDelta.toFixed(3)} and SL ${vAppliedStopLossDelta.toFixed(3)}.`,
            {
                contractName: pPosition.contractName,
                qty: pPosition.qty,
                currentDelta: Math.abs(Number(pCurrentDelta || 0)),
                reason: pReason,
                rowIndex: objRuleRowState.rowIndex,
                takeProfitDelta: Number(vAppliedTakeProfitDelta.toFixed(4)),
                stopLossDelta: Number(vAppliedStopLossDelta.toFixed(4))
            }
        );
    }
    await logFuturesEvent(
        pUserId,
        pStrategyCode,
        "future_closed",
        vClosePnl < 0 ? "warning" : "info",
        pReason === "sl"
            ? "Option SL Realized PnL"
            : (pReason === "tp"
                ? "Option TP Realized PnL"
                : (pReason === "expiry_cutoff" ? "Expiry Cutoff Realized PnL" : "Strangle Replace Realized PnL")),
        `Captured realized PnL ${vClosePnl.toFixed(2)} and close charge ${vCloseCharge.toFixed(2)} for ${pPosition.contractName}.`,
        {
            contractName: pPosition.contractName,
            qty: pPosition.qty,
            pnlDelta: Number(vClosePnl.toFixed(4)),
            closeCharge: Number(vCloseCharge.toFixed(4)),
            reason: pReason
        }
    );
    if (pReason === "sl" || pReason === "tp") {
        await schedulePendingOptionRecoveryRefresh(pUserId, pStrategyCode, pReason);
    }

    if (isOptionsScalperStrategy(pStrategyCode)) {
        const vProfitClosePauseUntil = new Date(Date.now() + gProfitClosePauseAfterOptionRuleMs).toISOString();
        const objRuntimeBeforeProfitPause = await loadRollingFuturesLtRuntime(pUserId, pStrategyCode)
            || getDefaultRollingFuturesLtRuntime(pUserId, pStrategyCode);
        await saveRollingFuturesLtRuntime({
            ...objRuntimeBeforeProfitPause,
            userId: pUserId,
            strategyCode: pStrategyCode,
            state: buildRuntimeStateWithProfitClosePause(
                objRuntimeBeforeProfitPause,
                vProfitClosePauseUntil
            )
        });
        if (Boolean(objMetadata.reEnterEnabled) || pReason === "delta_diff_replace") {
            try {
                const objPaperRowState = getNormalizedOptionRowUiState(
                    getMergedUiState(objProfile),
                    pStrategyCode,
                    objMetadata.rowIndex
                );
                const objReEntry = await openTrackedOptionReEntry(
                    pUserId,
                    pStrategyCode,
                    pSelectedApiProfileId,
                    objProfile,
                    pPosition,
                    objMetadata,
                    pReason,
                    {
                        ...(pReason === "expiry_cutoff"
                            ? {
                                forceExpiryDate: resolveCoveredCutoffReEntryExpiryDate(
                                    objPaperRowState.expiryMode,
                                    getTrackedOptionResolvedExpiryDate(pPosition)
                                )
                            }
                            : {}),
                        useRowAction: true,
                        useRowQty: true,
                        useRowReEntryDelta: true
                    }
                );
                if (objReEntry) {
                    arrNextPositions = [...arrNextPositions, objReEntry.position];
                    if (pReason === "expiry_cutoff" && isCoveredOptionsStrategy(pStrategyCode)) {
                        await updateCoveredRowExpiryDateInProfile(
                            pUserId,
                            objProfile,
                            objPaperRowState.rowIndex,
                            getTrackedOptionResolvedExpiryDate(objReEntry.position)
                        );
                    }
                    await logFuturesEvent(
                        pUserId,
                        pStrategyCode,
                        pReason === "expiry_cutoff" ? "option_opened" : "reentry_opened",
                        "success",
                        pReason === "expiry_cutoff" ? "Expiry Cutoff Paper Re-Entry Opened" : "Paper Option Re-Entry Opened",
                        `Opened replacement paper option ${objReEntry.position.contractName} after ${pReason.toUpperCase()}.`,
                        {
                            contractName: objReEntry.position.contractName,
                            qty: objReEntry.position.qty,
                            reason: pReason
                        }
                    );
                }
            }
            catch (objError) {
                await logFuturesEvent(
                    pUserId,
                    pStrategyCode,
                    "engine_error",
                    "warning",
                    "Paper Re-Entry Skipped",
                    getErrorMessage(objError, "Unable to open the paper re-entry option."),
                    {
                        contractName: pPosition.contractName,
                        reason: "paper_reentry_error"
                    }
                );
            }
        }
        const arrSaved = await replaceRollingFuturesLtImportedPositions(pUserId, pStrategyCode, arrNextPositions);
        await syncOptionsScalperRecoveryMetricsFromPaperClosedPositions(
            pUserId,
            await readLiveProfile(pUserId, pStrategyCode)
        );
        if (!arrSaved.length) {
            await clearActiveStrategyRun(pUserId, pStrategyCode);
        }
        return arrSaved;
    }

    const vProfitClosePauseUntil = new Date(Date.now() + gProfitClosePauseAfterOptionRuleMs).toISOString();
    const objRuntimeBeforeProfitPause = await loadRollingFuturesLtRuntime(pUserId, pStrategyCode)
        || getDefaultRollingFuturesLtRuntime(pUserId, pStrategyCode);
    await saveRollingFuturesLtRuntime({
        ...objRuntimeBeforeProfitPause,
        userId: pUserId,
        strategyCode: pStrategyCode,
        state: buildRuntimeStateWithProfitClosePause(
            objRuntimeBeforeProfitPause,
            vProfitClosePauseUntil
        )
    });

    if (Boolean(objMetadata.reEnterEnabled)) {
        const vOptionReentryPendingUntil = new Date(Date.now() + gOptionReentryPendingMs).toISOString();
        const objRuntimeBeforeReEntry = await loadRollingFuturesLtRuntime(pUserId, pStrategyCode)
            || getDefaultRollingFuturesLtRuntime(pUserId, pStrategyCode);
        await saveRollingFuturesLtRuntime({
            ...objRuntimeBeforeReEntry,
            userId: pUserId,
            strategyCode: pStrategyCode,
            state: buildRuntimeStateWithOptionReentryPending(
                objRuntimeBeforeReEntry,
                vOptionReentryPendingUntil
            )
        });
        const objRowState = getNormalizedOptionRowUiState(getMergedUiState(objProfile), pStrategyCode, objMetadata.rowIndex);
        const objMergedUiState = getMergedUiState(objProfile);
        let vForcedReEntryTargetDelta: number | null = null;
        if (Number(pOptions?.forceReEntryTargetDelta) > 0) {
            vForcedReEntryTargetDelta = Number(pOptions?.forceReEntryTargetDelta);
        }
        else if (isStrangleOptionsStrategy(pStrategyCode) && (pReason === "sl" || pReason === "tp")) {
            vForcedReEntryTargetDelta = await resolveStrangleReEntryTargetDelta(
                pStrategyCode,
                objMergedUiState,
                pPosition,
                arrNextPositions,
                objRowState.rowIndex
            );
            if (!(Number(vForcedReEntryTargetDelta) > 0)) {
                await incrementBrokerageRecoveryTotal(pUserId, pStrategyCode, vCloseCharge, arrNextPositions.length);
                await incrementRecoveredTotalPnl(pUserId, pStrategyCode, vClosePnl, arrNextPositions.length);
                await logFuturesEvent(
                    pUserId,
                    pStrategyCode,
                    "engine_error",
                    "warning",
                    "Strangle Re-Entry Skipped",
                    "The triggered leg was closed, but no valid target delta was available for re-entry from New D or the other open leg live delta.",
                    {
                        contractName: pPosition.contractName,
                        rowIndex: objRowState.rowIndex,
                        reason: "strangle_reentry_target_delta_unavailable"
                    }
                );
                const arrSavedWithoutReEntry = await replaceRollingFuturesLtImportedPositions(pUserId, pStrategyCode, arrNextPositions);
                if (!arrSavedWithoutReEntry.length) {
                    await clearActiveStrategyRun(pUserId, pStrategyCode);
                }
                return arrSavedWithoutReEntry;
            }
        }
        try {
            const objReEntry = await openTrackedOptionReEntry(
                pUserId,
                pStrategyCode,
                pSelectedApiProfileId,
                objProfile,
                pPosition,
                objMetadata,
                pReason,
                {
                    ...(pReason === "expiry_cutoff" && isCoveredOptionsStrategy(pStrategyCode)
                        ? {
                            forceExpiryDate: resolveCoveredCutoffReEntryExpiryDate(
                                objRowState.expiryMode,
                                getTrackedOptionResolvedExpiryDate(pPosition)
                            )
                        }
                        : {}),
                    useRowAction: true,
                    useRowQty: true,
                    useRowReEntryDelta: !isStrangleOptionsStrategy(pStrategyCode),
                    ...(Number(vForcedReEntryTargetDelta) > 0
                        ? { forceTargetDelta: Number(vForcedReEntryTargetDelta) }
                        : {})
                }
            );
            if (objReEntry) {
                arrNextPositions = [...arrNextPositions, objReEntry.position];
                const vResolvedReEntryCharge = await resolveOrderChargeFromDelta(
                    client,
                    objReEntry.position.contractName,
                    objReEntry.orderPayload,
                    objReEntry.position.side,
                    Number(objReEntry.position.qty || 0),
                    objReEntry.placedAt
                );
                const vReEntryCharge = vResolvedReEntryCharge !== null
                    ? vResolvedReEntryCharge
                    : await estimateTrackedPositionCharge(objReEntry.position);
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
                    pReason === "expiry_cutoff" ? "option_opened" : "reentry_opened",
                    "success",
                    pReason === "expiry_cutoff"
                        ? "Expiry Cutoff Re-Entry Opened"
                        : (pReason === "delta_diff_replace" ? "Strangle Delta Diff Replacement Opened" : "Option Re-Entry Opened"),
                    pReason === "expiry_cutoff"
                        ? `Opened replacement option ${objReEntry.position.contractName} after expiry-day swap using row ${objRowState.rowIndex} settings.`
                        : (pReason === "delta_diff_replace"
                            ? `Opened replacement option ${objReEntry.position.contractName} using stronger live leg delta ${Number(vForcedReEntryTargetDelta || pOptions?.strongerDelta || 0).toFixed(2)} after the weaker leg exceeded the allowed delta gap.`
                        : (isStrangleOptionsStrategy(pStrategyCode)
                            ? getStrangleReEntryOpenMessage(objMergedUiState, objReEntry.position.contractName, Number(vForcedReEntryTargetDelta || objMetadata.reEntryDelta || objRowState.newD || 0))
                            : `Opened replacement option ${objReEntry.position.contractName} after ${pReason.toUpperCase()} using Re D ${Number(objMetadata.reEntryDelta || 0).toFixed(2)}.`)),
                        {
                            contractName: objReEntry.position.contractName,
                            qty: objReEntry.position.qty,
                            reason: pReason
                        }
                    );
                    if (String(objReEntry.position.side || "").trim().toUpperCase() === "BUY") {
                        const objGateConfig = getCoveredBuyHedgeSellPremiumGateConfig(getMergedUiState(objProfile));
                        await logFuturesEvent(
                            pUserId,
                            pStrategyCode,
                            pReason === "expiry_cutoff" ? "option_opened" : "reentry_opened",
                            "success",
                            "Covered Buy Hedge Reopened",
                            `${String(objReEntry.position.contractName || "").trim()} reopened for row ${objRowState.rowIndex}. ${getCoveredBuyHedgeOpenReasonText(String(getTrackedOptionMetadata(objReEntry.position).openedReason || ""), getTrackedOptionLegSide(objReEntry.position.contractName), { thresholdPct: objGateConfig.enabled ? objGateConfig.thresholdPct : Number.NaN })}`,
                            {
                                contractName: objReEntry.position.contractName,
                                qty: objReEntry.position.qty,
                                rowIndex: objRowState.rowIndex,
                                legSide: getTrackedOptionLegSide(objReEntry.position.contractName),
                                reason: "covered_buy_hedge_reentry_opened"
                            }
                        );
                    }
                }
            else {
                await incrementBrokerageRecoveryTotal(pUserId, pStrategyCode, vCloseCharge, arrNextPositions.length);
                await incrementRecoveredTotalPnl(pUserId, pStrategyCode, vClosePnl, arrNextPositions.length);
            }
        }
        catch (objError) {
            if (isCoveredOptionsStrategy(pStrategyCode)) {
                const objFailure = await classifyCoveredOptionReEntryFailure(objError);
                if (objFailure.type === "connection") {
                    await scheduleCoveredPendingOptionReEntry(
                        pUserId,
                        pStrategyCode,
                        pProfile,
                        normalizeOptionRowIndex(pStrategyCode, objMetadata.rowIndex),
                        getTrackedOptionLegSide(pPosition.contractName),
                        pReason === "tp" || pReason === "expiry_cutoff" ? pReason : "sl",
                        {
                            qty: Math.max(1, Math.floor(Number(pPosition.qty || 1))),
                            action: String(pPosition.side || "").trim().toUpperCase() === "BUY" ? "buy" : "sell",
                            targetDelta: Math.max(0, Number(objMetadata.reEntryDelta || objRowState.reD || 0.53)),
                            expiryMode: String(objRowState.expiryMode || "").trim(),
                            expiryDate: pReason === "expiry_cutoff"
                                ? resolveCoveredCutoffReEntryExpiryDate(
                                    objRowState.expiryMode,
                                    getTrackedOptionResolvedExpiryDate(pPosition)
                                )
                                : String(objRowState.expiryDate || "").trim(),
                            closedContractName: pPosition.contractName,
                            lastError: objFailure.message
                        }
                    );
                    await incrementBrokerageRecoveryTotal(pUserId, pStrategyCode, vCloseCharge, arrNextPositions.length);
                    await incrementRecoveredTotalPnl(pUserId, pStrategyCode, vClosePnl, arrNextPositions.length);
                    await logFuturesEvent(
                        pUserId,
                        pStrategyCode,
                        "delta_exchange_error",
                        "warning",
                        "Covered Leg Re-Entry Deferred",
                        `${objFailure.message} Re-entry for row ${objRowState.rowIndex} ${getTrackedOptionLegSide(pPosition.contractName).toUpperCase()} will retry every 1 minute after connectivity recovers.`,
                        {
                            contractName: pPosition.contractName,
                            rowIndex: objRowState.rowIndex,
                            legSide: getTrackedOptionLegSide(pPosition.contractName),
                            retryAt: new Date(Date.now() + gCoveredOptionReEntryRetryMs).toISOString(),
                            reason: "covered_option_reentry_connection_retry"
                        }
                    );
                }
                else if (objFailure.type === "insufficient_margin") {
                    await incrementBrokerageRecoveryTotal(pUserId, pStrategyCode, vCloseCharge, arrNextPositions.length);
                    await incrementRecoveredTotalPnl(pUserId, pStrategyCode, vClosePnl, arrNextPositions.length);
                    await logFuturesEvent(
                        pUserId,
                        pStrategyCode,
                        "engine_error",
                        "warning",
                        "Covered Leg Re-Entry Skipped",
                        `${objFailure.message} No retry will be attempted for ${pPosition.contractName}.`,
                        {
                            contractName: pPosition.contractName,
                            rowIndex: objRowState.rowIndex,
                            legSide: getTrackedOptionLegSide(pPosition.contractName),
                            reason: "covered_option_reentry_insufficient_margin"
                        }
                    );
                }
                else {
                    throw objError;
                }
            }
            else {
                throw objError;
            }
        }
        finally {
            const objRuntimeAfterReEntry = await loadRollingFuturesLtRuntime(pUserId, pStrategyCode)
                || getDefaultRollingFuturesLtRuntime(pUserId, pStrategyCode);
            await saveRollingFuturesLtRuntime({
                ...objRuntimeAfterReEntry,
                userId: pUserId,
                strategyCode: pStrategyCode,
                state: buildRuntimeStateWithOptionReentryPending(objRuntimeAfterReEntry, "")
            });
        }
    }
    else {
        await incrementBrokerageRecoveryTotal(pUserId, pStrategyCode, vCloseCharge, arrNextPositions.length);
        await incrementRecoveredTotalPnl(pUserId, pStrategyCode, vClosePnl, arrNextPositions.length);
    }

    const arrSaved = await replaceRollingFuturesLtImportedPositions(pUserId, pStrategyCode, arrNextPositions);
    await syncDualStrategySurvivalState(
        pUserId,
        pStrategyCode,
        pSelectedApiProfileId,
        arrSaved,
        arrSaved.length ? "active" : "ended"
    );
    if (!arrSaved.length) {
        await clearActiveStrategyRun(pUserId, pStrategyCode);
    }
    if (isDualRollingFuturesStrategy(pStrategyCode) && (pReason === "sl" || pReason === "tp")) {
        await attemptAutoExecuteNextPendingDualStrategyRequest(pReason, pUserId, pStrategyCode);
    }
    if (isCoveredOptionsStrategy(pStrategyCode) && (pReason === "sl" || pReason === "tp")) {
        const objRuntimeAfterClose = await loadRollingFuturesLtRuntime(pUserId, pStrategyCode)
            || getDefaultRollingFuturesLtRuntime(pUserId, pStrategyCode);
        await saveRollingFuturesLtRuntime({
            ...objRuntimeAfterClose,
            userId: pUserId,
            strategyCode: pStrategyCode,
            state: buildRuntimeStateWithClosedPositionsRefreshAt(
                objRuntimeAfterClose,
                new Date().toISOString()
            )
        });
    }
    return arrSaved;
}

async function findTriggeredTrackedOptions(
    pTrackedPositions: RollingFuturesLtImportedPositionRecord[],
    pUiState: Record<string, unknown>
): Promise<Array<{
    position: RollingFuturesLtImportedPositionRecord;
    currentDelta: number;
    currentMarkPrice: number | null;
    reason: "sl" | "tp" | "expiry_cutoff";
    ruleAudit?: {
        rowIndex: 1 | 2;
        takeProfitDelta: number;
        stopLossDelta: number;
    };
}>> {
    const arrTriggered: Array<{
        position: RollingFuturesLtImportedPositionRecord;
        currentDelta: number;
        currentMarkPrice: number | null;
        reason: "sl" | "tp" | "expiry_cutoff";
        ruleAudit?: {
            rowIndex: 1 | 2;
            takeProfitDelta: number;
            stopLossDelta: number;
        };
    }> = [];
    const objCurrentDeltaTime = getCurrentDeltaUiDateTimeParts();
    for (const objPosition of pTrackedPositions) {
        if (!isOptionContractSymbol(objPosition.contractName)) {
            continue;
        }
        const vResolvedExpiryDate = getTrackedOptionResolvedExpiryDate(objPosition);
        if (
            objPosition.strategyCode === "covered-options"
            && vResolvedExpiryDate
            && vResolvedExpiryDate === objCurrentDeltaTime.date
        ) {
            arrTriggered.push({
                position: objPosition,
                currentDelta: 0,
                currentMarkPrice: null,
                reason: "expiry_cutoff"
            });
            continue;
        }
        const objTicker = await getLiveOptionTicker(String(objPosition.contractName || "").trim());
        const vRawCurrentDelta = Number(objTicker?.delta);
        const vCurrentDelta = Math.abs(vRawCurrentDelta);
        if (!Number.isFinite(vCurrentDelta) || !(vCurrentDelta > 0)) {
            continue;
        }
        const objMetadata = getTrackedOptionMetadata(objPosition);
        const vRowIndex = getTrackedOptionRowIndexForUi(objPosition, pUiState);
        const objRowState = getNormalizedOptionRowUiState(pUiState, objPosition.strategyCode, vRowIndex);
        const vLiveTakeProfitDelta = Number(objRowState.tpD);
        const vLiveStopLossDelta = Number(objRowState.slD);
        const objDecision = shouldTriggerTrackedOption(
            objPosition.side,
            vCurrentDelta,
            Number.isFinite(vLiveTakeProfitDelta) && vLiveTakeProfitDelta > 0
                ? vLiveTakeProfitDelta
                : Number(objMetadata.takeProfitDelta || 0.25),
            Number.isFinite(vLiveStopLossDelta) && vLiveStopLossDelta > 0
                ? vLiveStopLossDelta
                : Number(objMetadata.stopLossDelta || 0.65)
        );
        if (objDecision.shouldAct && objDecision.reason) {
            if (isCoveredOptionsStrategy(objPosition.strategyCode)
                && String(objPosition.side || "").trim().toUpperCase() === "BUY") {
                const objGate = evaluateCoveredBuyHedgeSellPremiumGate(
                    pTrackedPositions,
                    pUiState,
                    getTrackedOptionLegSide(objPosition.contractName)
                );
                if (objGate.enabled && objGate.allowed) {
                    continue;
                }
            }
            arrTriggered.push({
                position: objPosition,
                currentDelta: vCurrentDelta,
                currentMarkPrice: Number.isFinite(Number(objTicker?.markPrice)) ? Number(objTicker?.markPrice) : null,
                reason: objDecision.reason,
                ruleAudit: {
                    rowIndex: vRowIndex,
                    takeProfitDelta: Number.isFinite(vLiveTakeProfitDelta) && vLiveTakeProfitDelta > 0
                        ? vLiveTakeProfitDelta
                        : Number(objMetadata.takeProfitDelta || 0.25),
                    stopLossDelta: Number.isFinite(vLiveStopLossDelta) && vLiveStopLossDelta > 0
                        ? vLiveStopLossDelta
                        : Number(objMetadata.stopLossDelta || 0.65)
                }
            });
        }
    }
    return arrTriggered.sort((pLeft, pRight) => {
        const vLeftPriority = pLeft.reason === "expiry_cutoff" ? 0 : (pLeft.reason === "sl" ? 1 : 2);
        const vRightPriority = pRight.reason === "expiry_cutoff" ? 0 : (pRight.reason === "sl" ? 1 : 2);
        return vLeftPriority - vRightPriority;
    });
}

function getStrangleReEntryOpenMessage(
    pUiState: Record<string, unknown>,
    pContractName: string,
    pTargetDelta: number
): string {
    if (normalizeBooleanValue(pUiState.strangleReopenAtNewD, false)) {
        return `Opened replacement option ${pContractName} after SL/TP using New D ${Number(pTargetDelta || 0).toFixed(2)}.`;
    }
    return `Opened replacement option ${pContractName} after SL/TP using the other open leg current live delta ${Number(pTargetDelta || 0).toFixed(2)}.`;
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
    if (isOptionsScalperStrategy(pStrategyCode)) {
        const arrClosedRows = await Promise.all((Array.isArray(pPositions) ? pPositions : []).map((objPosition) => {
            return closeOptionsScalperPaperPosition(pUserId, pStrategyCode, objPosition);
        }));
        await appendOptionsScalperPaperClosedPositions(pUserId, pStrategyCode, arrClosedRows);
        await replaceRollingFuturesLtImportedPositions(pUserId, pStrategyCode, []);
        await syncOptionsScalperRecoveryMetricsFromPaperClosedPositions(
            pUserId,
            await readLiveProfile(pUserId, pStrategyCode)
        );
        await clearActiveStrategyRun(pUserId, pStrategyCode);
        return {
            closedPositions: arrClosedRows.map((objRow) => ({
                closeId: objRow.closeId,
                contractName: objRow.contractName,
                qty: objRow.qty,
                order: {
                    order_type: "paper_market_order",
                    average_fill_price: objRow.sellPrice ?? objRow.buyPrice ?? 0,
                    isPaperTrade: true
                }
            })),
            profileLabel: "Paper"
        };
    }
    const { client, profile } = await getDeltaClientForAccountId(pUserId, pSelectedApiProfileId);
    const arrCloseCharges: number[] = [];
    const arrClosePnls: number[] = [];
    const arrClosed: Array<Record<string, unknown>> = [];
    for (const objPosition of pPositions) {
        const vClientOrderId = await allocateStrategyClientOrderId(pUserId, pStrategyCode, "CL");
        const objOrderPayload: Record<string, unknown> = {
            product_symbol: objPosition.contractName,
            size: objPosition.qty,
            side: String(objPosition.side || "").trim().toUpperCase() === "BUY" ? "sell" : "buy",
            order_type: "market_order",
            time_in_force: "gtc",
            post_only: false,
            reduce_only: true,
            ...(vClientOrderId ? { client_order_id: vClientOrderId } : {})
        };
        const vPlacedAtIso = new Date().toISOString();
        const objResponse = await client.apis.Orders.placeOrder({ order: objOrderPayload });
        const objPayload = readResponsePayload(objResponse);
        const vResolvedCharge = await resolveOrderChargeFromDelta(
            client,
            objPosition.contractName,
            objPayload,
            String(objPosition.side || "").trim().toUpperCase() === "BUY" ? "SELL" : "BUY",
            Number(objPosition.qty || 0),
            vPlacedAtIso
        );
        arrCloseCharges.push(vResolvedCharge !== null
            ? vResolvedCharge
            : await estimateTrackedPositionCharge(
                objPosition,
                Number(objPosition.markPrice || objPosition.entryPrice || 0)
            ));
        const vResolvedPnl = await resolveTrackedPositionClosePnl(client, objPosition, objPayload, vPlacedAtIso);
        arrClosePnls.push(Number.isFinite(Number(vResolvedPnl))
            ? Number(vResolvedPnl)
            : estimateTrackedPositionPnl(
                objPosition,
                Number(objPosition.markPrice || objPosition.entryPrice || 0)
            ));
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
    await syncDualStrategySurvivalState(pUserId, pStrategyCode, pSelectedApiProfileId, [], "ended");
    await clearActiveStrategyRun(pUserId, pStrategyCode);
    return {
        closedPositions: arrClosed,
        profileLabel: profile.referenceName || profile.apiKey || ""
    };
}

async function clearCoveredLiveConfirmation(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode
): Promise<void> {
    const objRuntime = await loadRollingFuturesLtRuntime(pUserId, pStrategyCode)
        || getDefaultRollingFuturesLtRuntime(pUserId, pStrategyCode);
    await saveRollingFuturesLtRuntime({
        ...objRuntime,
        userId: pUserId,
        strategyCode: pStrategyCode,
        state: buildRuntimeStateWithCoveredLiveConfirmation(objRuntime, null)
    });
}

type CoveredLiveActionDecision = "confirm" | "reject";

type CoveredLiveActionResult = {
    status: "success" | "warning" | "danger";
    message: string;
    data?: Record<string, unknown>;
};

async function processCoveredLiveActionDecision(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pDecision: CoveredLiveActionDecision,
    pActionId = ""
): Promise<CoveredLiveActionResult> {
    const objRuntime = await loadRollingFuturesLtRuntime(pUserId, pStrategyCode)
        || getDefaultRollingFuturesLtRuntime(pUserId, pStrategyCode);
    const objPending = getCoveredLiveConfirmationState(objRuntime);
    if (!objPending) {
        return { status: "warning", message: "No pending live confirmation was found." };
    }
    const vExpectedActionId = String(pActionId || "").trim();
    if (vExpectedActionId && String(objPending.actionId || "").trim() !== vExpectedActionId) {
        return { status: "warning", message: "The live confirmation is no longer valid." };
    }

    if (pDecision === "reject") {
        await clearCoveredLiveConfirmation(pUserId, pStrategyCode);
        await logFuturesEvent(
            pUserId,
            pStrategyCode,
            "manual_action",
            "warning",
            "Live Action Rejected",
            `${objPending.title} was rejected by the user. No order was placed.`,
            {
                actionId: objPending.actionId,
                kind: objPending.kind,
                reason: "covered_confirmation_rejected"
            }
        );
        return { status: "success", message: "Pending live action was rejected." };
    }

    let objProfile = await readLiveProfile(pUserId, pStrategyCode);
    objProfile = await refreshModeDrivenExpiryDatesInProfile(pUserId, pStrategyCode, objProfile);
    const vSelectedApiProfileId = String(objProfile.selectedApiProfileId || "").trim();
    if (!vSelectedApiProfileId) {
        return { status: "warning", message: "Select an API profile before confirming live actions." };
    }

    await clearCoveredLiveConfirmation(pUserId, pStrategyCode);

    try {
        const vStrategyLabel = getCoveredLikeStrategyLabel(pStrategyCode);
        if (objPending.kind === "exec_batch") {
            const arrInputs = buildCoveredQueuedExecBatchInputsFromPayload(objProfile, objPending.payload);
            if (!arrInputs.length) {
                throw new Error("The pending Exec Strategy confirmation no longer has valid rows.");
            }
            const objExecResult = await runCoveredExecStrategyBatchPlacement(
                pUserId,
                pStrategyCode,
                vSelectedApiProfileId,
                objProfile,
                arrInputs,
                "exec_strategy"
            );
            if (!Boolean(objPending.payload.suppressClosedFromDateUpdate)) {
                await syncCoveredRecoveryMetricsFromClosedHistory(
                    pUserId,
                    pStrategyCode,
                    vSelectedApiProfileId,
                    objProfile,
                    objExecResult.trackedOpenPositions
                );
            }
            return {
                status: "success",
                message: `${vStrategyLabel} Exec Strategy confirmed and executed.`
            };
        }

        if (objPending.kind === "option_rule_close") {
            const arrSavedPositions = await listRollingFuturesLtImportedPositions(pUserId, pStrategyCode);
            const vImportId = String(objPending.payload.importId || "").trim();
            const vContractName = String(objPending.payload.contractName || "").trim();
            const vReason = String(objPending.payload.reason || "").trim().toLowerCase();
            const objPosition = arrSavedPositions.find((objRow) => String(objRow.importId || "").trim() === vImportId)
                || arrSavedPositions.find((objRow) => String(objRow.contractName || "").trim() === vContractName);
            if (!objPosition) {
                await logFuturesEvent(pUserId, pStrategyCode, "manual_action", "warning", "Live Confirmation Invalidated", `${vContractName} is no longer in open positions. No order was placed.`, { reason: "covered_confirmation_position_missing" });
                return { status: "warning", message: "The position is no longer open. No order was placed." };
            }
            const arrTriggered = await findTriggeredTrackedOptions([objPosition], getMergedUiState(objProfile));
            const objTriggered = arrTriggered.find((objEntry) => objEntry.reason === vReason);
            if (!objTriggered) {
                await logFuturesEvent(pUserId, pStrategyCode, "manual_action", "warning", "Live Confirmation Invalidated", `The trigger for ${objPosition.contractName} no longer holds. No order was placed.`, { contractName: objPosition.contractName, reason: "covered_confirmation_trigger_cleared" });
                return { status: "warning", message: "The trigger is no longer valid. No order was placed." };
            }
            await applyTriggeredOptionRule(
                pUserId,
                pStrategyCode,
                vSelectedApiProfileId,
                objProfile,
                objPosition,
                objTriggered.currentDelta,
                objTriggered.currentMarkPrice,
                objTriggered.reason,
                arrSavedPositions,
                true
            );
            return {
                status: "success",
                message: `${objTriggered.reason.toUpperCase()} action confirmed and executed.`
            };
        }

        if (objPending.kind === "covered_reentry") {
            const objRuntimeLatest = await loadRollingFuturesLtRuntime(pUserId, pStrategyCode)
                || getDefaultRollingFuturesLtRuntime(pUserId, pStrategyCode);
            const arrPending = getCoveredPendingOptionReEntriesState(objRuntimeLatest);
            const vDedupeKey = String(objPending.payload.dedupeKey || "").trim();
            const objReEntry = arrPending.find((objEntry) => objEntry.dedupeKey === vDedupeKey);
            if (!objReEntry) {
                await logFuturesEvent(pUserId, pStrategyCode, "manual_action", "warning", "Live Confirmation Invalidated", `The ${getCoveredLikeLowerLabel(pStrategyCode)} re-entry request is no longer pending. No order was placed.`, { reason: "covered_confirmation_reentry_missing" });
                return { status: "warning", message: `The ${getCoveredLikeLowerLabel(pStrategyCode)} re-entry is no longer pending.` };
            }
            const bOpened = await executeCoveredPendingReEntryNow(
                pUserId,
                vSelectedApiProfileId,
                objProfile,
                objReEntry
            );
            if (!bOpened) {
                return {
                    status: "warning",
                    message: `${vStrategyLabel} re-entry was no longer needed.`
                };
            }
            return {
                status: "success",
                message: `${vStrategyLabel} re-entry confirmed and executed.`
            };
        }

        if (objPending.kind === "manual_swap") {
            const arrSavedPositions = await listRollingFuturesLtImportedPositions(pUserId, pStrategyCode);
            const vImportId = String(objPending.payload.importId || "").trim();
            const vContractName = String(objPending.payload.contractName || "").trim();
            const objPosition = arrSavedPositions.find((objRow) => String(objRow.importId || "").trim() === vImportId)
                || arrSavedPositions.find((objRow) => String(objRow.contractName || "").trim() === vContractName);
            if (!objPosition) {
                await logFuturesEvent(
                    pUserId,
                    pStrategyCode,
                    "manual_action",
                    "warning",
                    "Live Confirmation Invalidated",
                    `${vContractName || "The selected position"} is no longer in open positions. No order was placed.`,
                    { reason: "covered_confirmation_swap_missing" }
                );
                return { status: "warning", message: "The position is no longer open. No swap was placed." };
            }
            const objSwapResult = await executeCoveredOpenPositionSwap(
                pUserId,
                vSelectedApiProfileId,
                objProfile,
                objPosition
            );
            return {
                status: "success",
                message: `Swap confirmed and executed for ${objSwapResult.reopenedContractName}.`,
                data: {
                    closeOrder: objSwapResult.closeOrder,
                    openOrder: objSwapResult.openOrder,
                    trackedOpenPositions: objSwapResult.trackedOpenPositions
                }
            };
        }

        return { status: "warning", message: "Unsupported live confirmation type." };
    }
    catch (objError) {
        return {
            status: "danger",
            message: getErrorMessage(objError, "Unable to confirm the live action.")
        };
    }
}

async function handleTelegramWebhookInternal(req: Request, res: Response): Promise<void> {
    const vExpectedSecret = getTelegramWebhookSecret();
    if (vExpectedSecret) {
        const vProvidedSecret = String(req.header("x-telegram-bot-api-secret-token") || "").trim();
        if (vProvidedSecret !== vExpectedSecret) {
            res.status(403).json({ ok: false });
            return;
        }
    }

    const objUpdate = (req.body || {}) as TelegramUpdate;
    const vBotToken = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
    const objCallbackQuery = objUpdate.callback_query || null;
    const objMessage = objUpdate.message || objUpdate.edited_message || null;
    const objChatId = String(
        objCallbackQuery?.message?.chat?.id
        || objMessage?.chat?.id
        || ""
    ).trim();

    if (!objChatId) {
        res.json({ ok: true });
        return;
    }

    const objAccount = await getAccountByTelegramChatId(objChatId);
    if (!objAccount?.accountId) {
        if (objCallbackQuery?.id && vBotToken) {
            await answerTelegramCallbackQuery(vBotToken, objCallbackQuery.id, "No account is linked to this Telegram chat.");
        }
        res.json({ ok: true });
        return;
    }

    const pUserId = objAccount.accountId;
    const pStrategyCode: RollingFuturesLtStrategyCode = "covered-options";
    const objPendingBefore = getCoveredLiveConfirmationState(
        await loadRollingFuturesLtRuntime(pUserId, pStrategyCode)
            || getDefaultRollingFuturesLtRuntime(pUserId, pStrategyCode)
    );

    const objHandleAction = async (pDecision: CoveredLiveActionDecision, pActionId = ""): Promise<CoveredLiveActionResult> => {
        return processCoveredLiveActionDecision(pUserId, pStrategyCode, pDecision, pActionId);
    };

    if (objCallbackQuery?.data) {
        const vData = String(objCallbackQuery.data || "").trim();
        const arrParts = vData.split(":");
        if (arrParts.length >= 3 && arrParts[0] === "coa") {
            const vDecision = arrParts[1] === "c" ? "confirm" : arrParts[1] === "r" ? "reject" : "";
            const vActionId = String(arrParts[2] || "").trim();
            if (vDecision) {
                const objResult = await objHandleAction(vDecision, vActionId);
                if (objCallbackQuery.id && vBotToken) {
                    await answerTelegramCallbackQuery(vBotToken, objCallbackQuery.id, objResult.message);
                }
                const vTelegramMessageId = Number(objCallbackQuery.message?.message_id || 0);
                if (vBotToken && objCallbackQuery.message?.chat?.id !== undefined && vTelegramMessageId > 0) {
                    const arrReplyLines = [
                        objPendingBefore ? buildCoveredLiveConfirmationTelegramText(objPendingBefore) : "Optionyze Live Confirmation",
                        "",
                        `Result: ${objResult.message}`
                    ];
                    await editTelegramMessageText(
                        vBotToken,
                        String(objCallbackQuery.message.chat.id),
                        vTelegramMessageId,
                        arrReplyLines.join("\n")
                    );
                }
                res.json({ ok: true });
                return;
            }
        }
    }

    const vText = String(objMessage?.text || "").trim().toLowerCase();
    if (vText) {
        if (["confirm", "confirmed", "yes", "y", "ok", "approve"].includes(vText)) {
            const objResult = await objHandleAction("confirm");
            if (vBotToken) {
                await sendTelegramBotMessage(
                    vBotToken,
                    objChatId,
                    `${objPendingBefore ? buildCoveredLiveConfirmationTelegramText(objPendingBefore) : "Optionyze Live Confirmation"}\n\nResult: ${objResult.message}`
                );
            }
            res.json({ ok: true });
            return;
        }
        if (["cancel", "cancelled", "canceled", "reject", "rejected", "no", "n", "stop"].includes(vText)) {
            const objResult = await objHandleAction("reject");
            if (vBotToken) {
                await sendTelegramBotMessage(
                    vBotToken,
                    objChatId,
                    `${objPendingBefore ? buildCoveredLiveConfirmationTelegramText(objPendingBefore) : "Optionyze Live Confirmation"}\n\nResult: ${objResult.message}`
                );
            }
            res.json({ ok: true });
            return;
        }
    }

    res.json({ ok: true });
}

async function confirmCoveredLiveActionInternal(req: Request, res: Response, pStrategyCode: RollingFuturesLtStrategyCode): Promise<void> {
    const objResult = await processCoveredLiveActionDecision(getAccountId(req), pStrategyCode, "confirm");
    res.status(objResult.status === "danger" ? 500 : (objResult.status === "warning" ? 400 : 200)).json(objResult);
}

async function rejectCoveredLiveActionInternal(req: Request, res: Response, pStrategyCode: RollingFuturesLtStrategyCode): Promise<void> {
    const objResult = await processCoveredLiveActionDecision(getAccountId(req), pStrategyCode, "reject");
    res.status(objResult.status === "danger" ? 500 : (objResult.status === "warning" ? 400 : 200)).json(objResult);
}

async function getProfileInternal(req: Request, res: Response, pStrategyCode: RollingFuturesLtStrategyCode): Promise<void> {
    const vUserId = getAccountId(req);
    const objProfile = await refreshModeDrivenExpiryDatesInProfile(vUserId, pStrategyCode);
    const objTargetAccount = await getAccountById(vUserId);
    res.json({
        status: "success",
        data: {
            ...objProfile,
            uiState: getMergedUiState(objProfile),
            targetAccount: objTargetAccount
                ? {
                    accountId: objTargetAccount.accountId,
                    fullName: objTargetAccount.fullName,
                    email: objTargetAccount.email,
                    telegramChatId: objTargetAccount.telegramChatId,
                    execStrategy: objTargetAccount.execStrategy,
                    isAdmin: objTargetAccount.isAdmin,
                    isActive: objTargetAccount.isActive
                }
                : null
        }
    });
}

async function saveProfileInternal(req: Request, res: Response, pStrategyCode: RollingFuturesLtStrategyCode): Promise<void> {
    const vUserId = getAccountId(req);
    const objExisting = await readLiveProfile(vUserId, pStrategyCode);
    const objExistingUiState = getMergedUiState(objExisting);
    const objRuntime = await loadRollingFuturesLtRuntime(vUserId, pStrategyCode);
    const objIncoming = normalizeProfileSaveInput(vUserId, pStrategyCode, {
        ...objExisting,
        selectedApiProfileId: String(req.body?.selectedApiProfileId || objExisting.selectedApiProfileId || "").trim(),
        uiState: req.body?.uiState && typeof req.body.uiState === "object" ? req.body.uiState as Record<string, unknown> : objExisting.uiState,
        connectionStatus: objExisting.connectionStatus
    });
    let objSaved = await saveRollingFuturesLtProfile(objIncoming);
    objSaved = await refreshModeDrivenExpiryDatesInProfile(vUserId, pStrategyCode, objSaved);
    await ensureRuntimeProfileSelection(vUserId, pStrategyCode, objSaved.selectedApiProfileId);
    const objSavedUiState = getMergedUiState(objSaved);
    const vClosedFromDateChanged = String(objExistingUiState.closedFromDate || "").trim() !== String(objSavedUiState.closedFromDate || "").trim();
    if (vClosedFromDateChanged && String(objSaved.selectedApiProfileId || "").trim()) {
        if (objRuntime && getStrategyStartedAtState(objRuntime)) {
            await saveRollingFuturesLtRuntime({
                ...objRuntime,
                userId: vUserId,
                strategyCode: pStrategyCode,
                state: buildRuntimeStateWithClosedFromDateManualLock(objRuntime, true)
            });
        }
        if (isCoveredOptionsStrategy(pStrategyCode)) {
            const arrTrackedOpenPositions = await listRollingFuturesLtImportedPositions(vUserId, pStrategyCode);
            objSaved = await syncCoveredRecoveryMetricsFromClosedHistory(
                vUserId,
                pStrategyCode,
                String(objSaved.selectedApiProfileId || "").trim(),
                objSaved,
                arrTrackedOpenPositions,
                {
                    preserveClosedFromDate: true
                }
            );
        }
        else if (isOptionsScalperStrategy(pStrategyCode)) {
            objSaved = await syncOptionsScalperRecoveryMetricsFromPaperClosedPositions(vUserId, objSaved);
        }
    }
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
    const objLease = isDualLeaseManagedStrategy(pStrategyCode)
        ? await getStrategyLease(vUserId, pStrategyCode)
        : null;
    res.json({
        status: "success",
        data: {
            ...(objRuntime || {
                ...getDefaultRollingFuturesLtRuntime(vUserId, pStrategyCode),
                selectedApiProfileId: String(objProfile.selectedApiProfileId || "").trim()
            }),
            lease: objLease && isLeaseActive(objLease) ? objLease : null,
            currentServerId: gServerId
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


function getLocalSurvivalLeaseToken(pUserId: string, pStrategyCode: RollingFuturesLtStrategyCode): string {
    return String(gLocalSurvivalLeaseTokens.get(getAutoTraderRuntimeKey(pUserId, pStrategyCode)) || "").trim();
}

function setLocalSurvivalLeaseToken(pUserId: string, pStrategyCode: RollingFuturesLtStrategyCode, pLeaseToken: string): void {
    const vRuntimeKey = getAutoTraderRuntimeKey(pUserId, pStrategyCode);
    const vLeaseToken = String(pLeaseToken || "").trim();
    if (!vLeaseToken) {
        gLocalSurvivalLeaseTokens.delete(vRuntimeKey);
        return;
    }
    gLocalSurvivalLeaseTokens.set(vRuntimeKey, vLeaseToken);
}

function isDualLeaseManagedStrategy(pStrategyCode: RollingFuturesLtStrategyCode): boolean {
    return isDualServerManagedStrategy(pStrategyCode);
}

function getLocalStrategyLeaseToken(pUserId: string, pStrategyCode: RollingFuturesLtStrategyCode): string {
    return String(gLocalStrategyLeaseTokens.get(getAutoTraderRuntimeKey(pUserId, pStrategyCode)) || "").trim();
}

function setLocalStrategyLeaseToken(pUserId: string, pStrategyCode: RollingFuturesLtStrategyCode, pLeaseToken: string): void {
    const vRuntimeKey = getAutoTraderRuntimeKey(pUserId, pStrategyCode);
    const vLeaseToken = String(pLeaseToken || "").trim();
    if (!vLeaseToken) {
        gLocalStrategyLeaseTokens.delete(vRuntimeKey);
        return;
    }
    gLocalStrategyLeaseTokens.set(vRuntimeKey, vLeaseToken);
}

function isLeaseActive(pLease: StrategyLeaseRecord | null): boolean {
    if (!pLease?.leaseExpiresAt) {
        return false;
    }
    const vExpiresAtMs = new Date(pLease.leaseExpiresAt).getTime();
    return Number.isFinite(vExpiresAtMs) && vExpiresAtMs > Date.now();
}

function isSurvivalLeaseActive(pState: Awaited<ReturnType<typeof getSurvivalState>> | null): boolean {
    if (!pState?.leaseExpiresAt) {
        return false;
    }
    const vExpiresAtMs = new Date(pState.leaseExpiresAt).getTime();
    return Number.isFinite(vExpiresAtMs) && vExpiresAtMs > Date.now();
}

function buildStrategyLeaseMetadata(
    pRuntime: RollingFuturesLtRuntimeRecord | null,
    pProfile: RollingFuturesLtProfileRecord | null,
    pSelectedApiProfileId = ""
): Record<string, unknown> {
    const vProfileUiState = pProfile ? getMergedUiState(pProfile) : {};
    const vSelectedProfileId = String(
        pSelectedApiProfileId
        || pRuntime?.selectedApiProfileId
        || pProfile?.selectedApiProfileId
        || ""
    ).trim();

    return {
        serverId: gServerId,
        currentSymbol: String(pRuntime?.currentSymbol || vProfileUiState.symbol || "").trim(),
        runtimeStatus: String(pRuntime?.status || "").trim().toLowerCase(),
        selectedApiProfileId: vSelectedProfileId,
        strategyStartedAt: getStrategyStartedAtState(pRuntime || null)
    };
}

function getPrimaryOriginServerIdFromState(pState: Record<string, unknown> | null | undefined): string {
    const vOrigin = String(pState?.primaryOriginServerId || "").trim().toLowerCase();
    return vOrigin || "render";
}

function isPrimaryHandbackPendingState(pState: Record<string, unknown> | null | undefined): boolean {
    return Boolean(pState?.pendingPrimaryHandback);
}

async function acquireDualStrategyLease(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pRuntime: RollingFuturesLtRuntimeRecord | null,
    pProfile: RollingFuturesLtProfileRecord | null,
    pSelectedApiProfileId = ""
): Promise<{ acquired: boolean; lease: StrategyLeaseRecord | null; message: string; }> {
    if (!isDualLeaseManagedStrategy(pStrategyCode)) {
        return { acquired: true, lease: null, message: "" };
    }

    const objResult = await acquireStrategyLease({
        userId: pUserId,
        strategyCode: pStrategyCode,
        ownerServerId: gServerId,
        ownerInstanceId: gServerInstanceId,
        leaseDurationMs: getStrategyLeaseDurationMs(),
        metadata: buildStrategyLeaseMetadata(pRuntime, pProfile, pSelectedApiProfileId)
    });

    if (!objResult.acquired || !objResult.lease) {
        const vOwnerLabel = String(objResult.lease?.ownerServerId || "another server").trim() || "another server";
        return {
            acquired: false,
            lease: objResult.lease,
            message: `This live strategy is currently owned by ${vOwnerLabel}.`
        };
    }

    setLocalStrategyLeaseToken(pUserId, pStrategyCode, objResult.lease.leaseToken);
    return {
        acquired: true,
        lease: objResult.lease,
        message: ""
    };
}

async function renewDualStrategyLease(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pRuntime: RollingFuturesLtRuntimeRecord | null,
    pProfile: RollingFuturesLtProfileRecord | null
): Promise<boolean> {
    if (!isDualLeaseManagedStrategy(pStrategyCode)) {
        return true;
    }

    const vLeaseToken = getLocalStrategyLeaseToken(pUserId, pStrategyCode);
    if (!vLeaseToken) {
        const objAcquire = await acquireDualStrategyLease(pUserId, pStrategyCode, pRuntime, pProfile);
        return objAcquire.acquired;
    }

    const objLease = await renewStrategyLease({
        userId: pUserId,
        strategyCode: pStrategyCode,
        ownerServerId: gServerId,
        ownerInstanceId: gServerInstanceId,
        leaseToken: vLeaseToken,
        leaseDurationMs: getStrategyLeaseDurationMs(),
        metadata: buildStrategyLeaseMetadata(pRuntime, pProfile)
    });

    if (!objLease) {
        setLocalStrategyLeaseToken(pUserId, pStrategyCode, "");
        return false;
    }

    setLocalStrategyLeaseToken(pUserId, pStrategyCode, objLease.leaseToken);
    return true;
}

async function releaseDualStrategyLease(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pForce = false
): Promise<void> {
    if (!isDualLeaseManagedStrategy(pStrategyCode)) {
        return;
    }

    const vLeaseToken = getLocalStrategyLeaseToken(pUserId, pStrategyCode);
    setLocalStrategyLeaseToken(pUserId, pStrategyCode, "");

    if (pForce || !vLeaseToken) {
        if (pForce) {
            await forceReleaseStrategyLease(pUserId, pStrategyCode);
        }
        return;
    }

    await releaseStrategyLease(
        pUserId,
        pStrategyCode,
        gServerId,
        gServerInstanceId,
        vLeaseToken
    );
}

async function syncDualStrategySurvivalState(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pSelectedApiProfileId: string,
    pPositions: RollingFuturesLtImportedPositionRecord[],
    pStatus: "active" | "ended" = "active"
): Promise<void> {
    if (!isDualServerManagedStrategy(pStrategyCode)) {
        return;
    }

    let objProfile: Awaited<ReturnType<typeof getDeltaApiProfile>> | null = null;
    try {
        objProfile = await getDeltaApiProfile(pUserId, pSelectedApiProfileId);
    }
    catch (_objError) {
    }
    const objLiveProfile = await readLiveProfile(pUserId, pStrategyCode).catch(() => null);
    const objRuntime = await loadRollingFuturesLtRuntime(pUserId, pStrategyCode);
    const vRunId = getStrategyRunIdState(objRuntime);
    const vRunTag = getStrategyRunTagState(objRuntime);
    if (!vRunId || !vRunTag) {
        return;
    }

    const objLease = await getStrategyLease(pUserId, pStrategyCode);
    const objOpenPositions = await buildOpenPositionsPayload(pUserId, pStrategyCode, pPositions);
    await upsertSurvivalState({
        userId: pUserId,
        strategyCode: pStrategyCode,
        strategyRunId: vRunId,
        runTag: vRunTag,
        runStatus: pStatus,
        ownerServerId: String(objLease?.ownerServerId || gServerId).trim(),
        ownerInstanceId: String(objLease?.ownerInstanceId || gServerInstanceId).trim(),
        leaseToken: String(objLease?.leaseToken || "").trim(),
        leaseExpiresAt: String(objLease?.leaseExpiresAt || "").trim(),
        lastHeartbeatAt: new Date().toISOString(),
        selectedApiProfileId: pSelectedApiProfileId,
        profileReferenceName: String(objProfile?.referenceName || "").trim(),
        apiKey: String(objProfile?.apiKey || "").trim(),
        apiSecret: String(objProfile?.apiSecret || "").trim(),
        symbol: String(objRuntime?.currentSymbol || "").trim(),
        strategyStartedAt: getStrategyStartedAtState(objRuntime),
        lastDeltaSyncAt: new Date().toISOString(),
        lastPrimaryDbSyncAt: new Date().toISOString(),
        openPositions: pPositions.map((objPosition) => ({
            importId: objPosition.importId,
            contractName: objPosition.contractName,
            side: objPosition.side,
            qty: objPosition.qty,
            entryPrice: objPosition.entryPrice,
            markPrice: objPosition.markPrice,
            charges: objPosition.charges,
            pnl: objPosition.pnl,
            margin: objPosition.margin,
            liquidationPrice: objPosition.liquidationPrice,
            metadata: objPosition.metadata || {},
            openedAt: objPosition.openedAt,
            updatedAt: objPosition.updatedAt
        })),
        uiState: objLiveProfile ? getMergedUiState(objLiveProfile) : {},
        runtimeState: {
            ...((objRuntime?.state || {}) as Record<string, unknown>),
            primaryOriginServerId: String(objLease?.ownerServerId || gServerId).trim().toLowerCase() || "render",
            pendingPrimaryHandback: false,
            pendingPrimaryHandbackSince: ""
        },
        riskState: {
            uiState: objLiveProfile ? getMergedUiState(objLiveProfile) : {},
            neutralStatus: objOpenPositions.neutralStatus,
            totals: objOpenPositions.totals
        },
        recoveryMetrics: objOpenPositions.recoveryMetrics,
        lastOrderRefs: []
    });
}

async function syncSurvivalStateDuringPrimaryOutage(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pPositions: RollingFuturesLtImportedPositionRecord[],
    pLastError = "",
    pOwnedSurvival: Awaited<ReturnType<typeof getSurvivalState>> | null = null
): Promise<void> {
    if (!isDualServerManagedStrategy(pStrategyCode)) {
        return;
    }
    const objSurvival = pOwnedSurvival || await getSurvivalState(pUserId, pStrategyCode);
    if (!objSurvival) {
        logDualSurvivalDebug("outage_sync_skipped_missing_state", {
            userId: pUserId,
            strategyCode: pStrategyCode,
            positionCount: pPositions.length
        });
        return;
    }
    await upsertSurvivalState({
        userId: objSurvival.userId,
        strategyCode: objSurvival.strategyCode,
        strategyRunId: objSurvival.strategyRunId,
        runTag: objSurvival.runTag,
        runStatus: pPositions.length ? "active" : "ended",
        ownerServerId: gServerId,
        ownerInstanceId: gServerInstanceId,
        leaseToken: getLocalSurvivalLeaseToken(pUserId, pStrategyCode) || objSurvival.leaseToken,
        leaseExpiresAt: new Date(Date.now() + getStrategyLeaseDurationMs()).toISOString(),
        lastHeartbeatAt: new Date().toISOString(),
        selectedApiProfileId: objSurvival.selectedApiProfileId,
        profileReferenceName: objSurvival.profileReferenceName,
        apiKey: objSurvival.apiKey,
        apiSecret: objSurvival.apiSecret,
        symbol: objSurvival.symbol,
        strategyStartedAt: objSurvival.strategyStartedAt,
        lastDeltaSyncAt: new Date().toISOString(),
        lastPrimaryDbSyncAt: objSurvival.lastPrimaryDbSyncAt,
        openPositions: pPositions.map((objPosition) => ({
            importId: objPosition.importId,
            contractName: objPosition.contractName,
            side: objPosition.side,
            qty: objPosition.qty,
            entryPrice: objPosition.entryPrice,
            markPrice: objPosition.markPrice,
            charges: objPosition.charges,
            pnl: objPosition.pnl,
            margin: objPosition.margin,
            liquidationPrice: objPosition.liquidationPrice,
            metadata: objPosition.metadata || {},
            openedAt: objPosition.openedAt,
            updatedAt: objPosition.updatedAt
        })),
        uiState: objSurvival.uiState,
        runtimeState: {
            ...(objSurvival.runtimeState || {}),
            primaryOriginServerId: getPrimaryOriginServerIdFromState(objSurvival.runtimeState),
            pendingPrimaryHandback: true,
            pendingPrimaryHandbackSince: String(objSurvival.runtimeState?.pendingPrimaryHandbackSince || new Date().toISOString()).trim(),
            ...(pLastError ? { primaryDbOutageLastError: pLastError } : {})
        },
        riskState: objSurvival.riskState,
        recoveryMetrics: objSurvival.recoveryMetrics,
        lastOrderRefs: objSurvival.lastOrderRefs
    });
    logDualSurvivalDebug("outage_sync_saved", {
        userId: pUserId,
        strategyCode: pStrategyCode,
        runStatus: pPositions.length ? "active" : "ended",
        positionCount: pPositions.length,
        lastError: pLastError ? "present" : ""
    });
}

function buildSyntheticProfileFromSurvival(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pSurvival: Awaited<ReturnType<typeof getSurvivalState>>
): RollingFuturesLtProfileRecord {
    return {
        ...getDefaultRollingFuturesLtProfile(pUserId, pStrategyCode),
        userId: pUserId,
        strategyCode: pStrategyCode,
        selectedApiProfileId: String(pSurvival?.selectedApiProfileId || "").trim(),
        uiState: pSurvival?.uiState && typeof pSurvival.uiState === "object" ? pSurvival.uiState : {},
        updatedAt: String(pSurvival?.updatedAt || "").trim()
    };
}

async function ensureSurvivalOwnershipForOutage(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pSurvival: Awaited<ReturnType<typeof getSurvivalState>>
): Promise<Awaited<ReturnType<typeof getSurvivalState>> | null> {
    if (!pSurvival) {
        return null;
    }

    const vLocalLeaseToken = getLocalSurvivalLeaseToken(pUserId, pStrategyCode);
    if (vLocalLeaseToken) {
        const objRenewed = await renewSurvivalStateLease({
            userId: pUserId,
            strategyCode: pStrategyCode,
            ownerServerId: gServerId,
            ownerInstanceId: gServerInstanceId,
            leaseToken: vLocalLeaseToken,
            leaseDurationMs: getStrategyLeaseDurationMs()
        });
        if (objRenewed) {
            return objRenewed;
        }
        setLocalSurvivalLeaseToken(pUserId, pStrategyCode, "");
    }

    const objAcquire = await acquireSurvivalStateLease({
        userId: pUserId,
        strategyCode: pStrategyCode,
        ownerServerId: gServerId,
        ownerInstanceId: gServerInstanceId,
        leaseDurationMs: getStrategyLeaseDurationMs()
    });
    if (!objAcquire.acquired || !objAcquire.state) {
        logDualSurvivalDebug("cycle_exit_survival_owned_by_other", {
            userId: pUserId,
            strategyCode: pStrategyCode,
            currentOwnerServerId: String(objAcquire.state?.ownerServerId || pSurvival.ownerServerId || "").trim(),
            currentOwnerInstanceId: String(objAcquire.state?.ownerInstanceId || pSurvival.ownerInstanceId || "").trim(),
            leaseExpiresAt: String(objAcquire.state?.leaseExpiresAt || pSurvival.leaseExpiresAt || "").trim(),
            reason: objAcquire.reason
        });
        return null;
    }

    setLocalSurvivalLeaseToken(pUserId, pStrategyCode, objAcquire.state.leaseToken);
    return objAcquire.state;
}

async function applyTriggeredOptionRuleSurvivalOnly(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pSelectedApiProfileId: string,
    pProfile: RollingFuturesLtProfileRecord,
    pPosition: RollingFuturesLtImportedPositionRecord,
    pReason: "sl" | "tp" | "expiry_cutoff" | "delta_diff_replace",
    pTrackedPositions: RollingFuturesLtImportedPositionRecord[],
    pOptions?: {
        forceReEntryTargetDelta?: number;
    }
): Promise<RollingFuturesLtImportedPositionRecord[]> {
    await closeTrackedPositionOnDelta(
        pUserId,
        pStrategyCode,
        pSelectedApiProfileId,
        pPosition,
        pReason === "sl" ? "SL" : (pReason === "tp" ? "TP" : "CL")
    );
    let arrNextPositions = pTrackedPositions.filter((objRow) => objRow.importId !== pPosition.importId);
    const objMetadata = getTrackedOptionMetadata(pPosition);
    if (Boolean(objMetadata.reEnterEnabled) || pReason === "delta_diff_replace") {
        const objReEntry = await openTrackedOptionReEntry(
            pUserId,
            pStrategyCode,
            pSelectedApiProfileId,
            pProfile,
            pPosition,
            objMetadata,
            pReason,
            {
                ...(pReason === "expiry_cutoff" && isCoveredOptionsStrategy(pStrategyCode)
                    ? {
                        forceExpiryDate: resolveCoveredCutoffReEntryExpiryDate(
                            getNormalizedOptionRowUiState(getMergedUiState(pProfile), pStrategyCode, objMetadata.rowIndex).expiryMode,
                            getTrackedOptionResolvedExpiryDate(pPosition)
                        )
                    }
                    : {}),
                useRowAction: true,
                useRowQty: true,
                useRowReEntryDelta: pReason !== "delta_diff_replace",
                ...(Number(pOptions?.forceReEntryTargetDelta) > 0
                    ? { forceTargetDelta: Number(pOptions?.forceReEntryTargetDelta) }
                    : {})
            }
        );
        if (objReEntry) {
            arrNextPositions = [...arrNextPositions, objReEntry.position];
        }
    }
    return arrNextPositions;
}

async function applySurvivalOnlyNeutralityHedge(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pSelectedApiProfileId: string,
    pSymbol: "BTC" | "ETH",
    pUiState: Record<string, unknown>,
    pTrackedPositions: RollingFuturesLtImportedPositionRecord[],
    pRuntimeState: Record<string, unknown>
): Promise<{ positions: RollingFuturesLtImportedPositionRecord[]; hedgePlaced: boolean; }> {
    if (isCoveredOptionsStrategy(pStrategyCode)) {
        return { positions: pTrackedPositions, hedgePlaced: false };
    }
    const vMode = getNeutralModeFromUiState(pUiState);
    if (vMode === "none") {
        return { positions: pTrackedPositions, hedgePlaced: false };
    }
    const objTotals = await calculateTrackedNeutralTotals(pTrackedPositions);
    const vCurrentOptionDeltaAbs = Math.max(0, Number(objTotals.optionDeltaAbs || 0));
    const objBaseline = pRuntimeState?.deltaNeutralBaseline && typeof pRuntimeState.deltaNeutralBaseline === "object"
        ? pRuntimeState.deltaNeutralBaseline as Record<string, unknown>
        : {};
    const vBaseOptionDeltaAbs = Math.max(
        0,
        Number(objBaseline.baseOptionDeltaAbs || objBaseline.entryOptionDeltaAbs || vCurrentOptionDeltaAbs || 0)
    );
    const vLastHedgeAtMs = Number.isFinite(new Date(String(objBaseline.lastHedgeAt || "")).getTime())
        ? new Date(String(objBaseline.lastHedgeAt || "")).getTime()
        : 0;
    if (vLastHedgeAtMs > 0 && (Date.now() - vLastHedgeAtMs) < gNeutralityHedgeCooldownMs) {
        return { positions: pTrackedPositions, hedgePlaced: false };
    }

    let bShouldHedge = false;
    if (vMode === "theta") {
        const vThetaAbs = Math.abs(objTotals.totalTheta);
        const vThetaMinDelta = Number((vThetaAbs * Math.abs(Number(pUiState.minusDelta || -25)) / 100 * -1).toFixed(6));
        const vThetaMaxDelta = Number((vThetaAbs * Math.abs(Number(pUiState.plusDelta || 25)) / 100).toFixed(6));
        bShouldHedge = vThetaAbs > 0 && (objTotals.totalDelta < vThetaMinDelta || objTotals.totalDelta > vThetaMaxDelta);
    }
    else {
        const vNegThresholdPct = Number.isFinite(Number(pUiState.minusDelta)) ? Number(pUiState.minusDelta) : -25;
        const vPosThresholdPct = Number.isFinite(Number(pUiState.plusDelta)) ? Number(pUiState.plusDelta) : 25;
        const vGammaFactor = vMode === "gamma" ? getGammaAwareCompressionFactor(objTotals.totalGamma) : 1;
        const vDriftPct = vBaseOptionDeltaAbs > 0
            ? Number(((objTotals.totalDelta / vBaseOptionDeltaAbs) * 100).toFixed(6))
            : 0;
        bShouldHedge = vBaseOptionDeltaAbs > 0
            && (vDriftPct < (vNegThresholdPct / vGammaFactor) || vDriftPct > (vPosThresholdPct / vGammaFactor));
    }
    const vHedgeQty = Math.round(Math.abs(objTotals.totalDelta));
    if (!bShouldHedge || !(vHedgeQty >= 1)) {
        return { positions: pTrackedPositions, hedgePlaced: false };
    }
    const vHedgeAction: "BUY" | "SELL" = objTotals.totalDelta > 0 ? "SELL" : "BUY";
    await placeManagedManualFutureOrder(
        pUserId,
        pStrategyCode,
        pSelectedApiProfileId,
        pSymbol,
        vHedgeAction,
        vHedgeQty,
        "market_order",
        "HG"
    );
    const arrLivePositions = await fetchLiveFuturePositions(pUserId, pStrategyCode, pSelectedApiProfileId, pSymbol);
    return { positions: arrLivePositions, hedgePlaced: true };
}

async function runDualSurvivalOnlyCycle(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode
): Promise<void> {
    logDualSurvivalDebug("cycle_enter", {
        userId: pUserId,
        strategyCode: pStrategyCode
    });
    const objSurvival = await getSurvivalState(pUserId, pStrategyCode);
    if (!objSurvival || !objSurvival.selectedApiProfileId) {
        logDualSurvivalDebug("cycle_exit_invalid_state", {
            userId: pUserId,
            strategyCode: pStrategyCode,
            hasSurvivalState: Boolean(objSurvival),
            runStatus: String(objSurvival?.runStatus || "").trim(),
            hasSelectedApiProfileId: Boolean(objSurvival?.selectedApiProfileId)
        });
        return;
    }
    const objOwnedSurvival = await ensureSurvivalOwnershipForOutage(pUserId, pStrategyCode, objSurvival);
    if (!objOwnedSurvival) {
        return;
    }
    const vSymbol = normalizeSymbolValue(objSurvival.symbol || objSurvival.uiState?.symbol);
    let arrPositions = await fetchLiveFuturePositions(pUserId, pStrategyCode, objOwnedSurvival.selectedApiProfileId, vSymbol);
    if (objOwnedSurvival.runStatus !== "active" && !arrPositions.length) {
        logDualSurvivalDebug("cycle_exit_invalid_state", {
            userId: pUserId,
            strategyCode: pStrategyCode,
            hasSurvivalState: true,
            runStatus: String(objOwnedSurvival.runStatus || "").trim(),
            hasSelectedApiProfileId: true,
            livePositionCount: 0
        });
        return;
    }
    if (objOwnedSurvival.runStatus !== "active" && arrPositions.length) {
        logDualSurvivalDebug("cycle_reactivating_from_live_positions", {
            userId: pUserId,
            strategyCode: pStrategyCode,
            previousRunStatus: String(objOwnedSurvival.runStatus || "").trim(),
            livePositionCount: arrPositions.length
        });
    }
    logDualSurvivalDebug("cycle_state_loaded", {
        userId: pUserId,
        strategyCode: pStrategyCode,
        runTag: String(objOwnedSurvival.runTag || "").trim(),
        selectedApiProfileId: String(objOwnedSurvival.selectedApiProfileId || "").trim(),
        symbol: String(objOwnedSurvival.symbol || objOwnedSurvival.uiState?.symbol || "").trim(),
        trackedPositionCount: Array.isArray(objOwnedSurvival.openPositions) ? objOwnedSurvival.openPositions.length : 0,
        livePositionCount: arrPositions.length
    });
    const objProfile = buildSyntheticProfileFromSurvival(pUserId, pStrategyCode, objOwnedSurvival);
    logDualSurvivalDebug("cycle_profile_built", {
        userId: pUserId,
        strategyCode: pStrategyCode,
        symbol: vSymbol,
        selectedApiProfileId: String(objProfile.selectedApiProfileId || "").trim()
    });
    logDualSurvivalDebug("cycle_live_positions_loaded", {
        userId: pUserId,
        strategyCode: pStrategyCode,
        positionCount: arrPositions.length
    });
    const arrTriggeredOptions = await findTriggeredTrackedOptions(arrPositions, objOwnedSurvival.uiState || {});
    logDualSurvivalDebug("cycle_trigger_scan_complete", {
        userId: pUserId,
        strategyCode: pStrategyCode,
        triggeredCount: arrTriggeredOptions.length
    });
    for (const objTriggeredOption of arrTriggeredOptions) {
        const objCurrentTrackedPosition = arrPositions.find((objRow) => objRow.importId === objTriggeredOption.position.importId);
        if (!objCurrentTrackedPosition) {
            logDualSurvivalDebug("cycle_trigger_position_missing", {
                userId: pUserId,
                strategyCode: pStrategyCode,
                importId: String(objTriggeredOption.position.importId || "").trim(),
                reason: objTriggeredOption.reason
            });
            continue;
        }
        logDualSurvivalDebug("cycle_trigger_apply_start", {
            userId: pUserId,
            strategyCode: pStrategyCode,
            importId: String(objCurrentTrackedPosition.importId || "").trim(),
            reason: objTriggeredOption.reason
        });
        arrPositions = await applyTriggeredOptionRuleSurvivalOnly(
            pUserId,
            pStrategyCode,
            objOwnedSurvival.selectedApiProfileId,
            objProfile,
            objCurrentTrackedPosition,
            objTriggeredOption.reason,
            arrPositions
        );
        logDualSurvivalDebug("cycle_trigger_apply_done", {
            userId: pUserId,
            strategyCode: pStrategyCode,
            importId: String(objCurrentTrackedPosition.importId || "").trim(),
            reason: objTriggeredOption.reason,
            positionCount: arrPositions.length
        });
    }
    if (isStrangleOptionsStrategy(pStrategyCode)) {
        const objDeltaDiffTrigger = await findStrangleDeltaDiffReplacementTrigger(
            pStrategyCode,
            arrPositions,
            objOwnedSurvival.uiState || {}
        );
        if (objDeltaDiffTrigger) {
            const objCurrentTrackedPosition = arrPositions.find((objRow) => objRow.importId === objDeltaDiffTrigger.position.importId);
            if (objCurrentTrackedPosition) {
                arrPositions = await applyTriggeredOptionRuleSurvivalOnly(
                    pUserId,
                    pStrategyCode,
                    objOwnedSurvival.selectedApiProfileId,
                    objProfile,
                    objCurrentTrackedPosition,
                    "delta_diff_replace",
                    arrPositions,
                    {
                        forceReEntryTargetDelta: objDeltaDiffTrigger.replacementTargetDelta
                    }
                );
            }
        }
    }
    const objHedgeResult = await applySurvivalOnlyNeutralityHedge(
        pUserId,
        pStrategyCode,
        objOwnedSurvival.selectedApiProfileId,
        vSymbol,
        objOwnedSurvival.uiState || {},
        arrPositions,
        objOwnedSurvival.runtimeState || {}
    );
    logDualSurvivalDebug("cycle_hedge_complete", {
        userId: pUserId,
        strategyCode: pStrategyCode,
        hedgePlaced: objHedgeResult.hedgePlaced,
        positionCount: objHedgeResult.positions.length
    });
    await syncSurvivalStateDuringPrimaryOutage(
        pUserId,
        pStrategyCode,
        objHedgeResult.positions,
        objHedgeResult.hedgePlaced ? "Primary DB unavailable; survival-only hedge cycle applied." : "",
        objOwnedSurvival
    );
    logDualSurvivalDebug("cycle_complete", {
        userId: pUserId,
        strategyCode: pStrategyCode,
        positionCount: objHedgeResult.positions.length
    });
}

function stopAutoTraderCycle(pUserId: string, pStrategyCode: RollingFuturesLtStrategyCode): void {
    const vRuntimeKey = getAutoTraderRuntimeKey(pUserId, pStrategyCode);
    const objTimer = gAutoTraderIntervals.get(vRuntimeKey);
    if (objTimer) {
        clearInterval(objTimer);
        gAutoTraderIntervals.delete(vRuntimeKey);
    }
    gAutoTraderCycleLocks.delete(vRuntimeKey);
    setLocalSurvivalLeaseToken(pUserId, pStrategyCode, "");
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
        let objRuntime = await loadRollingFuturesLtRuntime(pUserId, pStrategyCode);
        if (!objRuntime?.autoTraderEnabled || String(objRuntime.status || "").trim().toLowerCase() !== "running") {
            stopAutoTraderCycle(pUserId, pStrategyCode);
            return;
        }

        let objProfile = await readLiveProfile(pUserId, pStrategyCode);
        if (isCoveredLikeStrategy(pStrategyCode)) {
            objProfile = await refreshModeDrivenExpiryDatesInProfile(pUserId, pStrategyCode, objProfile);
        }
        if (!await renewDualStrategyLease(pUserId, pStrategyCode, objRuntime, objProfile)) {
            stopAutoTraderCycle(pUserId, pStrategyCode);
            return;
        }
        let objUiState = getMergedUiState(objProfile);
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

        if (shouldForceDualSurvivalTest(pUserId, pStrategyCode)) {
            logDualSurvivalDebug("forced_test_cycle_requested", {
                userId: pUserId,
                strategyCode: pStrategyCode,
                selectedApiProfileId: vSelectedApiProfileId
            });
            await runDualSurvivalOnlyCycle(pUserId, pStrategyCode);
            return;
        }

        if (shouldSimulatePrimaryDbOutage(pUserId, pStrategyCode)) {
            const objSimulatedOutage = getSimulatedPrimaryOutageState(pUserId, pStrategyCode);
            logDualSurvivalDebug("simulated_primary_db_outage_requested", {
                userId: pUserId,
                strategyCode: pStrategyCode,
                enabledAt: String(objSimulatedOutage?.enabledAt || "").trim(),
                enabledByAccountId: String(objSimulatedOutage?.enabledByAccountId || "").trim()
            });
            throw buildSimulatedPrimaryOutageError();
        }

        let arrSavedPositions: RollingFuturesLtImportedPositionRecord[] = [];
        if (isOptionsScalperStrategy(pStrategyCode)) {
            arrSavedPositions = await replaceRollingFuturesLtImportedPositions(
                pUserId,
                pStrategyCode,
                await refreshOptionsScalperPaperOpenPositions(
                    await listRollingFuturesLtImportedPositions(pUserId, pStrategyCode)
                )
            );
            await syncOptionsScalperRecoveryMetricsFromPaperClosedPositions(
                pUserId,
                objProfile
            );
        }
        else {
            const arrPreviouslySavedPositions = await listRollingFuturesLtImportedPositions(pUserId, pStrategyCode);
            const arrLivePositions = await fetchLiveFuturePositions(pUserId, pStrategyCode, vSelectedApiProfileId, vSymbol);
            await reconcileRemovedTrackedPositionsPnl(
                pUserId,
                pStrategyCode,
                arrPreviouslySavedPositions,
                arrLivePositions,
                "auto_trader_live_reconcile"
            );
            arrSavedPositions = await replaceRollingFuturesLtImportedPositions(pUserId, pStrategyCode, arrLivePositions);
        }
        if (isCoveredOptionsStrategy(pStrategyCode)) {
            arrSavedPositions = await processCoveredPendingOptionReEntries(
                pUserId,
                vSelectedApiProfileId,
                objProfile,
                arrSavedPositions
            );
            await ensureCoveredConfiguredLegPresence(
                pUserId,
                objProfile,
                arrSavedPositions
            );
        }
        await processPendingOptionRecoveryRefresh(
            pUserId,
            pStrategyCode,
            vSelectedApiProfileId,
            objRuntime
        );
        objRuntime = await loadRollingFuturesLtRuntime(pUserId, pStrategyCode) || objRuntime;
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
            if (isDualRollingFuturesStrategy(pStrategyCode) && !arrSavedPositions.length) {
                const objQueueResult = await queueDualPendingExecStrategyRequest(
                    pUserId,
                    pStrategyCode,
                    vSelectedApiProfileId,
                    objUiState as Record<string, unknown>,
                    objScheduledReEntry.reason === "brokerage"
                        ? "brokerage_profit_reentry"
                        : "blocked_margin_profit_reentry",
                    objScheduledReEntry.reason === "brokerage"
                        ? "brokerage_reentry_request"
                        : "blockmargin_reentry_request",
                    null
                );
                await saveRollingFuturesLtRuntime({
                    ...objRuntime,
                    userId: pUserId,
                    strategyCode: pStrategyCode,
                    lastError: objQueueResult.created ? "" : objQueueResult.message,
                    state: buildRuntimeStateWithPendingReEntry(objRuntime, "", "")
                });
                return;
            }
            if (!arrSavedPositions.length && Number.isFinite(vRunAtMs) && vRunAtMs <= vNowMs) {
                const objAccount = isDualRollingFuturesStrategy(pStrategyCode)
                    ? await getAccountById(pUserId)
                    : null;
                if (!isDualExecStrategyAllowed(pStrategyCode, objAccount?.execStrategy)) {
                    const vNextRunAt = new Date(Date.now() + gProfitCloseReEntryCooldownMs).toISOString();
                    await logFuturesEvent(
                        pUserId,
                        pStrategyCode,
                        "engine_error",
                        "warning",
                        "Exec Strategy Not Authorised",
                        gExecStrategyUnauthorizedMessage,
                        {
                            symbol: vSymbol,
                            reason: objScheduledReEntry.reason === "brokerage"
                                ? "brokerage_reentry_blocked"
                                : "blockmargin_reentry_blocked",
                            retryAt: vNextRunAt
                        }
                    );
                    await saveRollingFuturesLtRuntime({
                        ...objRuntime,
                        userId: pUserId,
                        strategyCode: pStrategyCode,
                        lastError: gExecStrategyUnauthorizedMessage,
                        state: buildRuntimeStateWithPendingReEntry(
                            objRuntime,
                            objScheduledReEntry.reason,
                            vNextRunAt
                        )
                    });
                    return;
                }
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

        const arrTriggeredOptions = bRestartCloseProtectionActive
            ? []
            : await findTriggeredTrackedOptions(arrSavedPositions, objUiState);
        for (const objTriggeredOption of arrTriggeredOptions) {
            const objCurrentTrackedPosition = arrSavedPositions.find((objRow) => objRow.importId === objTriggeredOption.position.importId);
            if (!objCurrentTrackedPosition) {
                continue;
            }
            if (isCoveredOptionsStrategy(pStrategyCode)) {
                await queueCoveredTriggeredAction(
                    pUserId,
                    objProfile,
                    objCurrentTrackedPosition,
                    objTriggeredOption.reason,
                    objTriggeredOption.currentDelta,
                    objTriggeredOption.currentMarkPrice
                );
            }
            else {
                arrSavedPositions = await applyTriggeredOptionRule(
                    pUserId,
                    pStrategyCode,
                    vSelectedApiProfileId,
                    objProfile,
                    objCurrentTrackedPosition,
                    objTriggeredOption.currentDelta,
                    objTriggeredOption.currentMarkPrice,
                    objTriggeredOption.reason,
                    arrSavedPositions
                );
            }
            // Covered expiry-day swaps are processed one per cycle so margin release,
            // re-entry and optional confirmations can settle before the next leg swaps.
            if (isCoveredOptionsStrategy(pStrategyCode) && objTriggeredOption.reason === "expiry_cutoff") {
                break;
            }
        }
        if (!bRestartCloseProtectionActive && isStrangleOptionsStrategy(pStrategyCode)) {
            const objDeltaDiffTrigger = await findStrangleDeltaDiffReplacementTrigger(
                pStrategyCode,
                arrSavedPositions,
                objUiState
            );
            if (objDeltaDiffTrigger) {
                const objCurrentTrackedPosition = arrSavedPositions.find((objRow) => objRow.importId === objDeltaDiffTrigger.position.importId);
                if (objCurrentTrackedPosition) {
                    arrSavedPositions = await applyTriggeredOptionRule(
                        pUserId,
                        pStrategyCode,
                        vSelectedApiProfileId,
                        objProfile,
                        objCurrentTrackedPosition,
                        objDeltaDiffTrigger.currentDelta,
                        objDeltaDiffTrigger.currentMarkPrice,
                        "delta_diff_replace",
                        arrSavedPositions,
                        false,
                        {
                            forceReEntryTargetDelta: objDeltaDiffTrigger.replacementTargetDelta,
                            deltaDiffPct: objDeltaDiffTrigger.deltaDiffPct,
                            deltaDiffThresholdPct: objDeltaDiffTrigger.thresholdPct,
                            strongerContractName: objDeltaDiffTrigger.strongerContractName,
                            strongerDelta: objDeltaDiffTrigger.strongerDelta
                        }
                    );
                }
            }
        }

        const objRuntimeBeforeProfitRule = await loadRollingFuturesLtRuntime(pUserId, pStrategyCode)
            || objRuntime;
        const vProfitClosePauseUntil = getProfitClosePauseUntil(objRuntimeBeforeProfitRule);
        const bProfitClosePauseActive = Boolean(arrSavedPositions.length)
            && !!vProfitClosePauseUntil
            && Number.isFinite(new Date(vProfitClosePauseUntil).getTime())
            && new Date(vProfitClosePauseUntil).getTime() > Date.now();
        if (!arrSavedPositions.length && vProfitClosePauseUntil) {
            await saveRollingFuturesLtRuntime({
                ...objRuntimeBeforeProfitRule,
                userId: pUserId,
                strategyCode: pStrategyCode,
                state: buildRuntimeStateWithProfitClosePause(objRuntimeBeforeProfitRule, "")
            });
        }
        const objProfitClosePending = getProfitClosePendingState(objRuntimeBeforeProfitRule);
        if (!arrSavedPositions.length && objProfitClosePending.reason) {
            await saveRollingFuturesLtRuntime({
                ...objRuntimeBeforeProfitRule,
                userId: pUserId,
                strategyCode: pStrategyCode,
                state: buildRuntimeStateWithProfitClosePending(objRuntimeBeforeProfitRule, "", 0, "")
            });
        }

        const objOpenPositionsBeforeNeutrality = await buildOpenPositionsPayload(
            pUserId,
            pStrategyCode,
            arrSavedPositions
        );
        const objSummary = await fetchAccountSummarySnapshot(pUserId, vSelectedApiProfileId, vSymbol);
        const objProfitRule = getProfitCloseRule(pStrategyCode, objUiState, objOpenPositionsBeforeNeutrality, objSummary);
        const bProfitCloseRuleEnabled = Boolean(objUiState.closeNetProfitBrokerage) || Boolean(objUiState.closeBlockedMargin);
        if (!bProfitCloseRuleEnabled && objProfitClosePending.reason) {
            await saveRollingFuturesLtRuntime({
                ...objRuntimeBeforeProfitRule,
                userId: pUserId,
                strategyCode: pStrategyCode,
                state: buildRuntimeStateWithProfitClosePending(objRuntimeBeforeProfitRule, "", 0, "")
            });
        }

        let bProfitCloseConfirmed = false;
        if (!bRestartCloseProtectionActive && !bProfitClosePauseActive && arrSavedPositions.length && bProfitCloseRuleEnabled) {
            if (objProfitRule.triggered) {
                const vPendingStartedAtMs = Number.isFinite(new Date(objProfitClosePending.startedAt).getTime())
                    ? new Date(objProfitClosePending.startedAt).getTime()
                    : 0;
                const bSamePendingRule = objProfitClosePending.reason === objProfitRule.reason
                    && Math.abs(Number(objProfitClosePending.thresholdValue || 0) - Number(objProfitRule.thresholdValue || 0)) < 0.000001;
                if (bSamePendingRule && vPendingStartedAtMs > 0) {
                    bProfitCloseConfirmed = (Date.now() - vPendingStartedAtMs) >= gProfitCloseConfirmationMs;
                }
                else {
                    const vStartedAtIso = new Date().toISOString();
                    await saveRollingFuturesLtRuntime({
                        ...objRuntimeBeforeProfitRule,
                        userId: pUserId,
                        strategyCode: pStrategyCode,
                        state: buildRuntimeStateWithProfitClosePending(
                            objRuntimeBeforeProfitRule,
                            objProfitRule.reason,
                            objProfitRule.thresholdValue,
                            vStartedAtIso
                        )
                    });
                    await logFuturesEvent(
                        pUserId,
                        pStrategyCode,
                        "manual_action",
                        "info",
                        objProfitRule.reason === "brokerage"
                            ? "Brokerage Profit Close Timer Started"
                            : "Blocked Margin Profit Close Timer Started",
                        `${objProfitRule.message} Closing all positions will only happen if this Net PnL stays above the target for 5 minutes continuously.`,
                        {
                            thresholdValue: objProfitRule.thresholdValue,
                            reason: objProfitRule.reason === "brokerage"
                                ? "brokerage_profit_close_timer_started"
                                : "blockmargin_profit_close_timer_started"
                        }
                    );
                }
            }
            else if (objProfitClosePending.reason) {
                await saveRollingFuturesLtRuntime({
                    ...objRuntimeBeforeProfitRule,
                    userId: pUserId,
                    strategyCode: pStrategyCode,
                    state: buildRuntimeStateWithProfitClosePending(objRuntimeBeforeProfitRule, "", 0, "")
                });
                await logFuturesEvent(
                    pUserId,
                    pStrategyCode,
                    "manual_action",
                    "info",
                    "Profit Close Timer Reset",
                    "Net PnL slipped below the active profit-close target, so the 5-minute close timer was reset.",
                    { reason: "profit_close_timer_reset" }
                );
            }
        }

        if (!bRestartCloseProtectionActive && !bProfitClosePauseActive && bProfitCloseConfirmed && objProfitRule.triggered && arrSavedPositions.length) {
            const objClosed = await closeTrackedPositionsOnDelta(
                pUserId,
                pStrategyCode,
                vSelectedApiProfileId,
                arrSavedPositions
            );
            const bQueueDualReEntry = isDualRollingFuturesStrategy(pStrategyCode) && objProfitRule.reEnterEnabled;
            let vQueuedReEntryMessage = "";
            if (bQueueDualReEntry) {
                const objPostCloseSummary = await fetchAccountSummarySnapshot(pUserId, vSelectedApiProfileId, vSymbol);
                const objQueueResult = await queueDualPendingExecStrategyRequest(
                    pUserId,
                    pStrategyCode,
                    vSelectedApiProfileId,
                    objUiState as Record<string, unknown>,
                    objProfitRule.reason === "brokerage"
                        ? "brokerage_profit_reentry"
                        : "blocked_margin_profit_reentry",
                    objProfitRule.reason === "brokerage"
                        ? "brokerage_profit_trigger_request"
                        : "blockmargin_profit_trigger_request",
                    objPostCloseSummary.availableBalance
                );
                vQueuedReEntryMessage = objQueueResult.message;
            }
            const vRunAt = objProfitRule.reEnterEnabled && !isDualRollingFuturesStrategy(pStrategyCode)
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
                bQueueDualReEntry
                    ? `${objProfitRule.message} ${vQueuedReEntryMessage}`
                    : (objProfitRule.reEnterEnabled
                        ? `${objProfitRule.message} Re-entry scheduled after 5 minutes.`
                        : objProfitRule.message),
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
                        {
                            ...objLatestRuntimeAfterClose,
                            state: buildRuntimeStateWithProfitClosePending(objLatestRuntimeAfterClose, "", 0, "")
                        },
                        objProfitRule.reEnterEnabled && !isDualRollingFuturesStrategy(pStrategyCode) ? objProfitRule.reason : "",
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
        await syncDualStrategySurvivalState(
            pUserId,
            pStrategyCode,
            vSelectedApiProfileId,
            objNeutralCheck.trackedOpenPositions,
            objNeutralCheck.trackedOpenPositions.length ? "active" : "ended"
        );
    }
    catch (objError) {
        if (isPrimaryDatabaseUnavailableError(objError)) {
            logDualSurvivalDebug("primary_db_outage_detected", {
                userId: pUserId,
                strategyCode: pStrategyCode,
                error: getErrorMessage(objError, "Primary DB unavailable during live cycle.")
            });
            try {
                await runDualSurvivalOnlyCycle(pUserId, pStrategyCode);
            }
            catch (objSurvivalError) {
                logDualSurvivalDebug("cycle_failed", {
                    userId: pUserId,
                    strategyCode: pStrategyCode,
                    error: getErrorMessage(objSurvivalError, "Survival-only cycle failed.")
                });
                try {
                    const objSurvival = await getSurvivalState(pUserId, pStrategyCode);
                    if (objSurvival?.selectedApiProfileId) {
                        const vSurvivalSymbol = normalizeSymbolValue(objSurvival.symbol || objSurvival.uiState?.symbol);
                        const arrLivePositions = await fetchLiveFuturePositions(
                            pUserId,
                            pStrategyCode,
                            objSurvival.selectedApiProfileId,
                            vSurvivalSymbol
                        );
                        await syncSurvivalStateDuringPrimaryOutage(
                            pUserId,
                            pStrategyCode,
                            arrLivePositions,
                            getErrorMessage(objError, "Primary DB unavailable during live cycle.")
                        );
                        logDualSurvivalDebug("snapshot_refresh_after_failure_saved", {
                            userId: pUserId,
                            strategyCode: pStrategyCode,
                            positionCount: arrLivePositions.length
                        });
                    }
                }
                catch (objSnapshotError) {
                    logDualSurvivalDebug("snapshot_refresh_after_failure_failed", {
                        userId: pUserId,
                        strategyCode: pStrategyCode,
                        error: getErrorMessage(objSnapshotError, "Survival snapshot refresh failed.")
                    });
                }
            }
            return;
        }
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
            const objErrorLog = await getDeltaErrorLogDescriptor(objError);
            await logFuturesEvent(
                pUserId,
                pStrategyCode,
                objErrorLog.eventType,
                objErrorLog.severity,
                objErrorLog.title,
                objErrorLog.message,
                objErrorLog.payload
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

async function recoverDualSurvivalTakeoverCandidates(): Promise<void> {
    const arrSurvivalRows = await listSurvivalStates("rolling-futures-lt-dual");
    for (const objSurvival of arrSurvivalRows) {
        const vUserId = String(objSurvival.userId || "").trim();
        if (!vUserId || !objSurvival.selectedApiProfileId) {
            continue;
        }
        const bHasOpenState = objSurvival.runStatus === "active"
            || (Array.isArray(objSurvival.openPositions) && objSurvival.openPositions.length > 0);
        if (!bHasOpenState) {
            continue;
        }

        const vRuntimeKey = getAutoTraderRuntimeKey(vUserId, "rolling-futures-lt-dual");
        if (gAutoTraderIntervals.has(vRuntimeKey) || gAutoTraderCycleLocks.has(vRuntimeKey)) {
            continue;
        }

        const bOwnedLocally = objSurvival.ownerServerId === gServerId
            && objSurvival.ownerInstanceId === gServerInstanceId
            && isSurvivalLeaseActive(objSurvival);
        if (bOwnedLocally) {
            logDualSurvivalDebug("takeover_resume_existing_owner", {
                userId: vUserId,
                strategyCode: "rolling-futures-lt-dual",
                runTag: objSurvival.runTag
            });
            startAutoTraderCycle(vUserId, "rolling-futures-lt-dual");
            continue;
        }

        if (isSurvivalLeaseActive(objSurvival)) {
            continue;
        }

        const objAcquire = await acquireSurvivalStateLease({
            userId: vUserId,
            strategyCode: "rolling-futures-lt-dual",
            ownerServerId: gServerId,
            ownerInstanceId: gServerInstanceId,
            leaseDurationMs: getStrategyLeaseDurationMs()
        });
        if (!objAcquire.acquired || !objAcquire.state) {
            continue;
        }

        setLocalSurvivalLeaseToken(vUserId, "rolling-futures-lt-dual", objAcquire.state.leaseToken);
        logDualSurvivalDebug("takeover_acquired_from_survival_db", {
            userId: vUserId,
            strategyCode: "rolling-futures-lt-dual",
            runTag: objAcquire.state.runTag,
            previousOwnerServerId: objSurvival.ownerServerId,
            previousOwnerInstanceId: objSurvival.ownerInstanceId
        });
        startAutoTraderCycle(vUserId, "rolling-futures-lt-dual");
    }
}

function startDualSurvivalTakeoverWatcher(): void {
    if (gSurvivalTakeoverInterval) {
        return;
    }
    void recoverDualSurvivalTakeoverCandidates();
    gSurvivalTakeoverInterval = setInterval(() => {
        void recoverDualSurvivalTakeoverCandidates();
    }, 12000);
}

export async function recoverRollingFuturesLtAutoTraderCycles(): Promise<void> {
    startDualSurvivalTakeoverWatcher();
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
            && (vStrategyCode === "rolling-futures-lt-long" || vStrategyCode === "rolling-futures-lt-short" || isDualRollingFuturesStrategy(vStrategyCode));

        if (!bShouldResume) {
            continue;
        }

        if (isDualLeaseManagedStrategy(vStrategyCode)) {
            const objProfile = await readLiveProfile(vUserId, vStrategyCode);
            const objLeaseAcquire = await acquireDualStrategyLease(vUserId, vStrategyCode, objRuntime, objProfile, vSelectedApiProfileId);
            if (!objLeaseAcquire.acquired) {
                continue;
            }
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
    if (isDualLeaseManagedStrategy(pStrategyCode)) {
        const objLeaseAcquire = await acquireDualStrategyLease(vUserId, pStrategyCode, objExistingRuntime, objProfile, vSelectedApiProfileId);
        if (!objLeaseAcquire.acquired) {
            res.status(409).json({
                status: "warning",
                message: objLeaseAcquire.message,
                data: {
                    lease: objLeaseAcquire.lease,
                    currentServerId: gServerId
                }
            });
            return;
        }
    }

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
    await releaseDualStrategyLease(vUserId, pStrategyCode, true);

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
        const objTargetAccount = await getAccountById(vUserId);
        const objProfile = await readLiveProfile(vUserId, pStrategyCode);
        const objUiState = getMergedUiState(objProfile);
        const vSelectedSymbol = normalizeSymbolValue(req.query?.symbol || req.body?.symbol || objUiState.symbol);
        const vLotSize = getLotSizeForSymbol(vSelectedSymbol);
        const { client, profile } = await getDeltaClientForAccountId(vUserId, vProfileId);
        const objPositionsApi = client.apis?.Positions as {
            getMarginedPositions?: (pParams: Record<string, unknown>) => Promise<unknown>;
            getPositions?: (pParams: Record<string, unknown>) => Promise<unknown>;
        } | undefined;
        const [objWalletResult, objMarketResult, objPositionsResult, objIndicatorResult] = await Promise.allSettled([
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
                    : Promise.resolve(null)),
            pStrategyCode === "options-scalper"
                ? getOptionsDemoOiIndicatorSummary(vSelectedSymbol)
                : Promise.resolve(null)
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
        const objBlockedMarginDetails = getBlockedMarginDisplayDetails(objUsdRow);
        const vTrackedPositionMargin = getTrackedPositionMarginTotal(arrPositions, vSelectedSymbol);
        const vTrackedPositiveUnrealizedPnl = getTrackedPositionPositiveUnrealizedPnlTotal(arrPositions, vSelectedSymbol);
        const vBaseBlockedMargin = Math.max(objBlockedMarginDetails.blockedMargin, vTrackedPositionMargin);
        const vBlockedMarginDisplay = vBaseBlockedMargin + vTrackedPositiveUnrealizedPnl;
        const vBlockedMarginHint = vTrackedPositiveUnrealizedPnl > 0
            ? `Blocked ${vBaseBlockedMargin.toFixed(2)} + Unrealized PnL ${vTrackedPositiveUnrealizedPnl.toFixed(2)}`
            : (vBaseBlockedMargin > 0 ? `Blocked ${vBaseBlockedMargin.toFixed(2)}` : objBlockedMarginDetails.hint);
        const vBlockedMargin = vBlockedMarginDisplay;
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
                execStrategy: isDualExecStrategyAllowed(pStrategyCode, objTargetAccount?.execStrategy),
                symbol: vSelectedSymbol,
                oneLotValue: Number.isFinite(vOneLotValue) ? Number(vOneLotValue.toFixed(2)) : null,
                totalBalance: Number.isFinite(vTotalBalance) ? Number(vTotalBalance.toFixed(2)) : null,
                blockedMargin: Number.isFinite(vBlockedMargin) ? Number(vBlockedMargin.toFixed(2)) : null,
                blockedMarginDisplay: Number.isFinite(vBlockedMarginDisplay) ? Number(vBlockedMarginDisplay.toFixed(2)) : null,
                blockedMarginHint: vBlockedMarginHint,
                availableBalance: Number.isFinite(vAvailableBalance) ? Number(vAvailableBalance.toFixed(2)) : null,
                healthPct: Number.isFinite(vHealthPct) ? vHealthPct : null,
                profileLabel: profile.referenceName || profile.apiKey || "",
                openCount: arrPositions.filter((objRow) => {
                    const vContract = String(objRow.product_symbol || objRow.symbol || "").trim().toUpperCase();
                    const vQty = Math.abs(toFiniteNumber(objRow.net_size ?? objRow.size, 0));
                    return isTrackedContractForSymbol(vContract, vSelectedSymbol) && vQty > 0;
                }).length,
                indicator: pStrategyCode === "options-scalper" && objIndicatorResult.status === "fulfilled"
                    ? objIndicatorResult.value
                    : null
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

async function calculateRecommendedStartQtyInternal(req: Request, res: Response, pStrategyCode: RollingFuturesLtStrategyCode): Promise<void> {
    const vUserId = getAccountId(req);
    const objProfile = await readLiveProfile(vUserId, pStrategyCode);
    const vSelectedApiProfileId = String(objProfile.selectedApiProfileId || "").trim();
    if (!vSelectedApiProfileId) {
        res.status(400).json({
            status: "warning",
            message: "Select an API profile before calculating Start Qty."
        });
        return;
    }

    try {
        const objUiState = getMergedUiState(objProfile);
        const objExecInput = normalizeExecStrategyInput(
            String(objUiState.action1 || "sell"),
            objUiState.symbol,
            String(objUiState.legs1 || "ce"),
            String(objUiState.expiryMode1 || "5"),
            objUiState.expiryDate1,
            1,
            objUiState.newD1 || 0.53
        );
        const { client } = await getDeltaClientForAccountId(vUserId, vSelectedApiProfileId);
        const objWalletResponse = await client.apis.Wallet.getBalances();
        const objWalletPayload = readResponsePayload(objWalletResponse);
        const arrWalletRows = Array.isArray(objWalletPayload.result) ? objWalletPayload.result as DeltaWalletBalanceRow[] : [];
        const objUsdRow = pickUsdBalanceRow(arrWalletRows);
        const vAvailableBalance = Number(getAvailableBalanceUsd(objUsdRow).toFixed(2));
        if (!(vAvailableBalance > 0)) {
            throw new Error(`Available Balance is not sufficient to calculate ${isCoveredOptionsStrategy(pStrategyCode) ? "Multiplier" : "Start Qty"}.`);
        }

        if (isCoveredOptionsStrategy(pStrategyCode)) {
            const vRecommendedQty = normalizeCoveredMultiplierValue(
                Math.min(
                    gCoveredMultiplierMax,
                    Math.max(0, Math.floor(vAvailableBalance / gCoveredMultiplierMarginUsd))
                ),
                pStrategyCode
            );
            const objEstimate: RollingFuturesLtRecommendedStartQty = {
                recommendedQty: vRecommendedQty,
                rawQty: vRecommendedQty,
                roundedQty: vRecommendedQty,
                basketAdjustedQty: vRecommendedQty,
                availableBalance: vAvailableBalance,
                usableBalance: vAvailableBalance,
                hedgeReserve: 0,
                optionReservePerQty: gCoveredMultiplierMarginUsd,
                safetyFactor: 1,
                optionReserveMultiplier: 1,
                hedgeMarginRatio: 0,
                basketUpliftFactor: 1,
                contracts: []
            };
            if (vRecommendedQty < getCoveredMultiplierMin(pStrategyCode)) {
                res.json({
                    status: "warning",
                    message: `Available Balance ${vAvailableBalance.toFixed(2)} is below the required ${(gCoveredMultiplierMarginUsd * getCoveredMultiplierMin(pStrategyCode)).toFixed(2)} USD for Multiplier ${getCoveredMultiplierMin(pStrategyCode)}.`,
                    data: objEstimate
                });
                return;
            }
            res.json({
                status: "success",
                message: `Estimated Multiplier ${vRecommendedQty} from Available Balance ${vAvailableBalance.toFixed(2)} using ${gCoveredMultiplierMarginUsd.toFixed(2)} USD per multiplier.`,
                data: objEstimate
            });
            return;
        }

        const arrOptionSides: Array<"CE" | "PE"> = objExecInput.legSide === "both"
            ? (isDualRollingFuturesStrategy(pStrategyCode) ? ["CE", "PE"] : [])
            : [objExecInput.legSide === "pe" ? "PE" : "CE"];
        if (!arrOptionSides.length) {
            throw new Error("Select a valid option leg before calculating Start Qty.");
        }

        const objConfig = {
            symbol: objExecInput.symbol,
            contractName: getContractNameForSymbol(objExecInput.symbol),
            lotSize: getLotSizeForSymbol(objExecInput.symbol),
            futureQty: 1,
            futureOrderType: "market_order" as const,
            action: objExecInput.action,
            legSide: objExecInput.legSide,
            expiryMode: objExecInput.expiryMode,
            expiryDate: objExecInput.expiryDate,
            optionQty: 1,
            redOptionQtyPct: 100,
            greenOptionQtyPct: 100,
            newDelta: objExecInput.targetDelta,
            reDelta: objExecInput.targetDelta,
            deltaTakeProfit: Math.max(0, Number(objUiState.tpD1 || 0.25)),
            deltaStopLoss: Math.max(0, Number(objUiState.slD1 || 0.65)),
            reEnter: normalizeBooleanValue(objUiState.reEnter1, false),
            addOneLotFuture: false,
            renkoEnabled: false,
            renkoStepPoints: 10,
            renkoPriceSource: "spot_price" as const,
            loopSeconds: 8
        };

        const arrContracts = (await Promise.all(arrOptionSides.map(async (vOptionSide) => {
            return await findBestLiveOptionContractWithNearestFallback(objConfig, vOptionSide, objExecInput.targetDelta);
        }))).filter((objContract): objContract is NonNullable<typeof objContract> => Boolean(objContract));

        if (arrContracts.length !== arrOptionSides.length) {
            throw new Error("Unable to find live option contract(s) for the current strategy setup.");
        }

        const objMarketSnapshot = await getLiveMarketSnapshot({
            symbol: objExecInput.symbol,
            contractName: getContractNameForSymbol(objExecInput.symbol),
            lotSize: getLotSizeForSymbol(objExecInput.symbol),
            futureQty: 1,
            futureOrderType: "market_order",
            action: objExecInput.action,
            legSide: objExecInput.legSide,
            expiryMode: objExecInput.expiryMode,
            expiryDate: objExecInput.expiryDate,
            optionQty: 1,
            redOptionQtyPct: 100,
            greenOptionQtyPct: 100,
            newDelta: objExecInput.targetDelta,
            reDelta: objExecInput.targetDelta,
            deltaTakeProfit: Math.max(0, Number(objUiState.tpD1 || 0.25)),
            deltaStopLoss: Math.max(0, Number(objUiState.slD1 || 0.65)),
            reEnter: normalizeBooleanValue(objUiState.reEnter1, false),
            addOneLotFuture: false,
            renkoEnabled: false,
            renkoStepPoints: 10,
            renkoPriceSource: "spot_price",
            loopSeconds: 8
        });
        const vLotSize = getLotSizeForSymbol(objExecInput.symbol);
        const vOneLotValue = Number(objMarketSnapshot.futuresPrice || 0) * vLotSize;
        const vSafetyFactor = 0.98;
        const vOptionReserveMultiplier = objExecInput.action === "sell" ? 1 : 1;
        const vHedgeMarginRatio = 0.01;
        const vOptionNotionalReserveRatio = objExecInput.action === "sell" ? 0.006 : 0.003;
        const vHedgeQty = Math.max(0, Math.floor(Number(objUiState.bsFutQty || 0)));
        const vUsableBalance = Number((vAvailableBalance * vSafetyFactor).toFixed(2));
        const vHedgeReserve = Number((Math.max(0, vOneLotValue) * vHedgeQty * vHedgeMarginRatio).toFixed(2));
        const vPremiumReservePerQty = Number((arrContracts.reduce((pSum, objContract) => {
            return pSum + (Math.max(0, Number(objContract.markPrice || 0)) * vLotSize);
        }, 0) * vOptionReserveMultiplier).toFixed(2));
        const vNotionalReservePerQty = Number((Math.max(0, vOneLotValue) * arrContracts.length * vOptionNotionalReserveRatio).toFixed(2));
        const vOptionReservePerQty = Number(Math.max(vPremiumReservePerQty, vNotionalReservePerQty).toFixed(2));
        if (!(vOptionReservePerQty > 0)) {
            throw new Error("Unable to estimate option reserve for the selected strategy setup.");
        }

        const vRemainingForOptions = Math.max(0, vUsableBalance - vHedgeReserve);
        const vRawQty = Math.max(0, Math.floor(vRemainingForOptions / vOptionReservePerQty));
        const vBasketUpliftFactor = objExecInput.action === "sell" && objExecInput.legSide === "both" ? 2.25 : 1;
        const vBasketAdjustedQty = Math.max(0, Math.floor(vRawQty * vBasketUpliftFactor));
        const vRoundedQty = vBasketAdjustedQty >= 10
            ? Math.floor(vBasketAdjustedQty / 10) * 10
            : vBasketAdjustedQty;
        const vRecommendedQty = Math.max(0, vRoundedQty);

        const objEstimate: RollingFuturesLtRecommendedStartQty = {
            recommendedQty: vRecommendedQty,
            rawQty: vRawQty,
            roundedQty: vRoundedQty,
            basketAdjustedQty: vBasketAdjustedQty,
            availableBalance: vAvailableBalance,
            usableBalance: vUsableBalance,
            hedgeReserve: vHedgeReserve,
            optionReservePerQty: vOptionReservePerQty,
            safetyFactor: vSafetyFactor,
            optionReserveMultiplier: vOptionReserveMultiplier,
            hedgeMarginRatio: vHedgeMarginRatio,
            basketUpliftFactor: vBasketUpliftFactor,
            contracts: arrContracts.map((objContract) => ({
                contractSymbol: objContract.contractSymbol,
                optionSide: objContract.optionSide,
                markPrice: Number(Number(objContract.markPrice || 0).toFixed(2)),
                delta: Number(Number(objContract.delta || 0).toFixed(4)),
                expiryDate: objContract.expiryDate
            }))
        };

        if (vRecommendedQty < 1) {
            res.json({
                status: "warning",
                message: `Available Balance ${vAvailableBalance.toFixed(2)} is below the estimated reserve ${Number((vOptionReservePerQty + vHedgeReserve).toFixed(2)).toFixed(2)} for 1 safe Start Qty with the current strategy setup.`,
                data: objEstimate
            });
            return;
        }

        res.json({
            status: "success",
            message: `Estimated Start Qty ${vRecommendedQty} from Available Balance ${vAvailableBalance.toFixed(2)} using current CE/PE setup.`,
            data: objEstimate
        });
    }
    catch (objError) {
        res.status(500).json({
            status: "danger",
            message: getErrorMessage(objError, "Unable to calculate Start Qty.")
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
        const arrPositions = await fetchLiveFuturePositions(vUserId, pStrategyCode, vProfileId, undefined, true);
        res.json({
            status: "success",
            data: {
                positions: arrPositions
            }
        });
    }
    catch (objError) {
        const vSubjectLabel = isCoveredLikeStrategy(pStrategyCode) ? "positions" : "futures positions";
        res.status(500).json({
            status: "danger",
            message: getErrorMessage(objError, `Unable to fetch Delta open ${vSubjectLabel}.`)
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
    const arrPrepared = markPositionsAsImportedObservationOnly(await applyImportedOptionBaseGreeks(applyImportedBaseDelta(arrIncoming.map((objRow) => ({
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
    })), vBaseDelta), vBaseDelta), objUiState);
    let arrSaved = await replaceRollingFuturesLtImportedPositions(vUserId, pStrategyCode, arrPrepared);
    if (arrSaved.length && isCoveredOptionsStrategy(pStrategyCode) && objProfile.selectedApiProfileId) {
        arrSaved = await restoreCoveredMissingBuyHedgesAfterImport(
            vUserId,
            String(objProfile.selectedApiProfileId || "").trim(),
            objProfile,
            arrSaved
        );
    }
    let objProfileForResponse = objProfile;
    if (arrSaved.length && isCoveredOptionsStrategy(pStrategyCode) && objProfile.selectedApiProfileId) {
        objProfileForResponse = await syncCoveredRecoveryMetricsFromClosedHistory(
            vUserId,
            pStrategyCode,
            String(objProfile.selectedApiProfileId || "").trim(),
            objProfile,
            arrSaved,
            {
                preserveClosedFromDate: true
            }
        );
    }
    const objOpenPositions = await buildOpenPositionsPayload(vUserId, pStrategyCode, arrSaved);
    const objRuntime = await loadRollingFuturesLtRuntime(vUserId, pStrategyCode);
    if (
        arrSaved.length > 0
        && !isCoveredLikeStrategy(pStrategyCode)
        && !(getBrokerageRecoveryTotal(objRuntime) > 0)
    ) {
        await saveBrokerageRecoveryTotal(vUserId, pStrategyCode, Number(objOpenPositions.totals?.totalCharges || 0));
    }
    await logFuturesEvent(
        vUserId,
        pStrategyCode,
        "manual_action",
        "info",
        isCoveredLikeStrategy(pStrategyCode) ? "Imported Positions Updated" : "Imported Live Futures Updated",
        arrSaved.length
            ? (isCoveredLikeStrategy(pStrategyCode)
                ? `Saved ${arrSaved.length} imported position${arrSaved.length === 1 ? "" : "s"} in the open grid.`
                : `Saved ${arrSaved.length} imported live futures position${arrSaved.length === 1 ? "" : "s"} in the open grid.`)
            : (isCoveredLikeStrategy(pStrategyCode)
                ? "Cleared imported positions from the open grid."
                : "Cleared imported live futures positions from the open grid."),
        {
            qty: arrSaved.length,
            reason: "imported_positions_saved",
            closedFromDate: String(getMergedUiState(objProfileForResponse).closedFromDate || "").trim()
        }
    );
    res.json({
        status: "success",
        message: isCoveredLikeStrategy(pStrategyCode)
            ? "Imported positions saved."
            : "Imported open futures positions saved.",
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

async function clearOpenPositionsInternal(req: Request, res: Response, pStrategyCode: RollingFuturesLtStrategyCode): Promise<void> {
    const vUserId = getAccountId(req);
    const objProfile = await readLiveProfile(vUserId, pStrategyCode);
    await replaceRollingFuturesLtImportedPositions(vUserId, pStrategyCode, []);
    await clearActiveStrategyRun(vUserId, pStrategyCode);
    const vSelectedApiProfileId = String(objProfile.selectedApiProfileId || "").trim();
    if (vSelectedApiProfileId && isDualRollingFuturesStrategy(pStrategyCode)) {
        await syncDualStrategySurvivalState(vUserId, pStrategyCode, vSelectedApiProfileId, [], "ended");
    }
    await logFuturesEvent(
        vUserId,
        pStrategyCode,
        "manual_action",
        "warning",
        "Imported Open Positions Cleared",
        "All imported open positions were removed from the Open Positions section only. No Delta Exchange close order was placed.",
        { qty: 0, reason: "imported_positions_cleared_local_only" }
    );
    res.json({
        status: "success",
        message: "All imported open positions were cleared locally.",
        data: {
            trackedOpenPositions: await buildOpenPositionsPayload(vUserId, pStrategyCode)
        }
    });
}

async function reconcileOpenPositionsInternal(req: Request, res: Response, pStrategyCode: RollingFuturesLtStrategyCode): Promise<void> {
    const vUserId = getAccountId(req);
    if (isOptionsScalperStrategy(pStrategyCode)) {
        try {
            const arrExisting = await listRollingFuturesLtImportedPositions(vUserId, pStrategyCode);
            const arrRefreshed = await refreshOptionsScalperPaperOpenPositions(arrExisting);
            const arrSaved = await replaceRollingFuturesLtImportedPositions(vUserId, pStrategyCode, arrRefreshed);
            const objOpenPositions = await buildOpenPositionsPayload(vUserId, pStrategyCode, arrSaved);
            await logFuturesEvent(
                vUserId,
                pStrategyCode,
                "manual_action",
                "success",
                "Paper Open Positions Refreshed",
                `Refreshed ${arrSaved.length} paper option position${arrSaved.length === 1 ? "" : "s"} using live Delta market prices.`,
                { qty: arrSaved.length, reason: "paper_open_positions_reconciled" }
            );
            res.json({
                status: "success",
                message: `Refreshed ${arrSaved.length} paper position${arrSaved.length === 1 ? "" : "s"}.`,
                data: objOpenPositions
            });
            return;
        }
        catch (objError) {
            res.status(500).json({
                status: "danger",
                message: getErrorMessage(objError, "Unable to refresh paper positions.")
            });
            return;
        }
    }
    const vProfileId = await resolveProfileId(req, pStrategyCode);
    if (!vProfileId) {
        res.status(400).json({ status: "warning", message: "API profile is required." });
        return;
    }
    try {
        const arrPreviouslySaved = await listRollingFuturesLtImportedPositions(vUserId, pStrategyCode);
        const arrPositions = await fetchLiveFuturePositions(vUserId, pStrategyCode, vProfileId);
        await reconcileRemovedTrackedPositionsPnl(
            vUserId,
            pStrategyCode,
            arrPreviouslySaved,
            arrPositions,
            "manual_open_positions_reconcile"
        );
        const objProfile = await readLiveProfile(vUserId, pStrategyCode);
        const objUiState = getMergedUiState(objProfile);
        const vBaseDelta = Math.max(0, Number(objUiState.newD1 || 0.53));
        const arrSaved = await replaceRollingFuturesLtImportedPositions(
            vUserId,
            pStrategyCode,
            markPositionsAsImportedObservationOnly(
                await applyImportedOptionBaseGreeks(applyImportedBaseDelta(arrPositions, vBaseDelta), vBaseDelta),
                objUiState
            )
        );
        await syncDualStrategySurvivalState(
            vUserId,
            pStrategyCode,
            vProfileId,
            arrSaved,
            arrSaved.length ? "active" : "ended"
        );
        if (!arrSaved.length) {
            await clearActiveStrategyRun(vUserId, pStrategyCode);
        }
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
            isCoveredLikeStrategy(pStrategyCode) ? "Open Positions Reconciled" : "Open Futures Reconciled",
            isCoveredLikeStrategy(pStrategyCode)
                ? `Refreshed ${arrSaved.length} live position${arrSaved.length === 1 ? "" : "s"} from Delta Exchange.`
                : `Refreshed ${arrSaved.length} live futures position${arrSaved.length === 1 ? "" : "s"} from Delta Exchange.`,
            { qty: arrSaved.length, reason: "open_positions_reconciled" }
        );
        res.json({
            status: "success",
            message: isCoveredLikeStrategy(pStrategyCode)
                ? `Reconciled ${arrSaved.length} live position${arrSaved.length === 1 ? "" : "s"} with Delta Exchange.`
                : `Reconciled ${arrSaved.length} live futures position${arrSaved.length === 1 ? "" : "s"} with Delta Exchange.`,
            data: objOpenPositions
        });
    }
    catch (objError) {
        const vSubjectLabel = isCoveredLikeStrategy(pStrategyCode) ? "live positions" : "live futures positions";
        res.status(500).json({
            status: "danger",
            message: getErrorMessage(objError, `Unable to refresh ${vSubjectLabel}.`)
        });
    }
}

async function closeImportedOpenPositionInternal(req: Request, res: Response, pStrategyCode: RollingFuturesLtStrategyCode): Promise<void> {
    const vUserId = getAccountId(req);
    if (isOptionsScalperStrategy(pStrategyCode)) {
        const vImportId = String(req.body?.importId || "").trim();
        const arrSaved = await listRollingFuturesLtImportedPositions(vUserId, pStrategyCode);
        const objPosition = arrSaved.find((objRow) => String(objRow.importId || "").trim() === vImportId);
        if (!objPosition) {
            res.status(404).json({
                status: "warning",
                message: "Paper open position was not found."
            });
            return;
        }
        const objClosed = await closeOptionsScalperPaperPosition(vUserId, pStrategyCode, objPosition);
        const arrRemaining = arrSaved.filter((objRow) => String(objRow.importId || "").trim() !== vImportId);
        await appendOptionsScalperPaperClosedPositions(vUserId, pStrategyCode, [objClosed]);
        await replaceRollingFuturesLtImportedPositions(vUserId, pStrategyCode, arrRemaining);
        await syncOptionsScalperRecoveryMetricsFromPaperClosedPositions(
            vUserId,
            await readLiveProfile(vUserId, pStrategyCode)
        );
        if (!arrRemaining.length) {
            await clearActiveStrategyRun(vUserId, pStrategyCode);
        }
        await logFuturesEvent(
            vUserId,
            pStrategyCode,
            "option_closed",
            "success",
            "Paper Position Closed",
            `${objPosition.contractName} was moved from paper open positions to paper closed positions using live Delta exit price.`,
            {
                contractName: objPosition.contractName,
                qty: objPosition.qty,
                pnl: objClosed.pnl,
                reason: "manual_paper_close"
            }
        );
        res.json({
            status: "success",
            message: `${objPosition.contractName} paper position closed.`,
            data: {
                importId: vImportId,
                trackedOpenPositions: await buildOpenPositionsPayload(vUserId, pStrategyCode, arrRemaining)
            }
        });
        return;
    }
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
        const arrPreviouslySaved = await listRollingFuturesLtImportedPositions(vUserId, pStrategyCode);
        const arrLivePositions = await fetchLiveFuturePositions(vUserId, pStrategyCode, vSelectedApiProfileId);
        const objLivePosition = arrLivePositions.find((objRow) => String(objRow.importId || "").trim() === vImportId)
            || arrLivePositions.find((objRow) => String(objRow.contractName || "").trim() === vContractName);

        if (!objLivePosition) {
            await reconcileRemovedTrackedPositionsPnl(
                vUserId,
                pStrategyCode,
                arrPreviouslySaved,
                arrLivePositions,
                "manual_imported_position_missing_before_close"
            );
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
        const vClientOrderId = await allocateStrategyClientOrderId(vUserId, pStrategyCode, "CL");
        const objOrderPayload: Record<string, unknown> = {
            product_symbol: String(objLivePosition.contractName || vContractName).trim(),
            size: vLiveQty,
            side: vCloseSide,
            order_type: "market_order",
            time_in_force: "gtc",
            post_only: false,
            reduce_only: true,
            ...(vClientOrderId ? { client_order_id: vClientOrderId } : {})
        };
        const vPlacedAtIso = new Date().toISOString();
        const objResponse = await client.apis.Orders.placeOrder({ order: objOrderPayload });
        const objPayload = readResponsePayload(objResponse);
        if (vImportId) {
            await deleteRollingFuturesLtImportedPosition(vUserId, pStrategyCode, vImportId);
        }
        const arrLatestLivePositions = await fetchLiveFuturePositions(vUserId, pStrategyCode, vSelectedApiProfileId);
        const arrRemainingSaved = await replaceRollingFuturesLtImportedPositions(vUserId, pStrategyCode, arrLatestLivePositions);
        const vResolvedCloseCharge = await resolveOrderChargeFromDelta(
            client,
            String(objLivePosition.contractName || vContractName).trim(),
            objPayload,
            vCloseSide.toUpperCase(),
            vLiveQty,
            vPlacedAtIso
        );
        const vCloseCharge = vResolvedCloseCharge !== null
            ? vResolvedCloseCharge
            : await estimateTrackedPositionCharge(
                objLivePosition,
                Number(objLivePosition.markPrice || objLivePosition.entryPrice || 0)
            );
        const vResolvedClosePnl = await resolveTrackedPositionClosePnl(client, objLivePosition, objPayload, vPlacedAtIso);
        const vClosePnl = Number.isFinite(Number(vResolvedClosePnl))
            ? Number(vResolvedClosePnl)
            : (isFutureContractSymbol(objLivePosition.contractName) ? 0 : estimateTrackedPositionPnl(
                objLivePosition,
                Number(objLivePosition.markPrice || objLivePosition.entryPrice || 0)
            ));
        await incrementBrokerageRecoveryTotal(vUserId, pStrategyCode, vCloseCharge, arrRemainingSaved.length);
        await incrementRecoveredTotalPnl(vUserId, pStrategyCode, vClosePnl, arrRemainingSaved.length);
        await syncDualStrategySurvivalState(
            vUserId,
            pStrategyCode,
            vSelectedApiProfileId,
            arrRemainingSaved,
            arrRemainingSaved.length ? "active" : "ended"
        );
        if (!arrRemainingSaved.length) {
            await clearActiveStrategyRun(vUserId, pStrategyCode);
        }
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
            const arrPreviouslySaved = await listRollingFuturesLtImportedPositions(vUserId, pStrategyCode);
            const arrLatestLivePositions = await fetchLiveFuturePositions(vUserId, pStrategyCode, vSelectedApiProfileId);
            const objStillLive = arrLatestLivePositions.find((objRow) => String(objRow.importId || "").trim() === vImportId)
                || arrLatestLivePositions.find((objRow) => String(objRow.contractName || "").trim() === vContractName);
            if (!objStillLive) {
                await reconcileRemovedTrackedPositionsPnl(
                    vUserId,
                    pStrategyCode,
                    arrPreviouslySaved,
                    arrLatestLivePositions,
                    "manual_imported_position_close_verified_closed"
                );
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

async function executeCoveredOpenPositionSwap(
    pUserId: string,
    pSelectedApiProfileId: string,
    pProfile: RollingFuturesLtProfileRecord,
    pPosition: RollingFuturesLtImportedPositionRecord
): Promise<{
    trackedOpenPositions: RollingFuturesLtOpenPositionsPayload;
    closedContractName: string;
    reopenedContractName: string;
    closeOrder: Record<string, unknown>;
    openOrder: Record<string, unknown>;
}> {
    const pStrategyCode = isCoveredOptionsStrategy(pProfile.strategyCode) ? pProfile.strategyCode : "covered-options";
    const vStrategyLabel = getCoveredLikeStrategyLabel(pStrategyCode);
    const objProfile = await refreshModeDrivenExpiryDatesInProfile(pUserId, pStrategyCode, pProfile);
    const { client } = await getDeltaClientForAccountId(pUserId, pSelectedApiProfileId);
    const objMetadata = getTrackedOptionMetadata(pPosition);
    const objUiState = getMergedUiState(objProfile);
    const vRowIndex = resolveCoveredTrackedPositionRowIndex(
        objUiState,
        pPosition,
        objMetadata.rowIndex
    );
    const objRowState = getNormalizedOptionRowUiState(objUiState, pStrategyCode, vRowIndex);
    const vLegSide = getTrackedOptionLegSide(pPosition.contractName);
    const vTargetDelta = Math.max(0, Number(objRowState.newD || 0.53));
    if (!(vTargetDelta > 0)) {
        throw new Error(`Row ${vRowIndex} New D must be greater than 0 before swapping ${pPosition.contractName}.`);
    }

    const arrSavedPositions = await listRollingFuturesLtImportedPositions(pUserId, pStrategyCode);
    const objCurrentPosition = arrSavedPositions.find((objRow) => String(objRow.importId || "").trim() === String(pPosition.importId || "").trim())
        || arrSavedPositions.find((objRow) => String(objRow.contractName || "").trim() === String(pPosition.contractName || "").trim());
    if (!objCurrentPosition) {
        throw new Error(`${pPosition.contractName} is no longer open in ${getCoveredLikeLowerLabel(pStrategyCode)} positions.`);
    }

    const objCloseResult = await closeTrackedPositionOnDelta(
        pUserId,
        pStrategyCode,
        pSelectedApiProfileId,
        objCurrentPosition,
        "CL"
    );
    const vResolvedCloseCharge = await resolveOrderChargeFromDelta(
        client,
        objCurrentPosition.contractName,
        objCloseResult.payload,
        String(objCurrentPosition.side || "").trim().toUpperCase() === "BUY" ? "SELL" : "BUY",
        Number(objCurrentPosition.qty || 0),
        objCloseResult.placedAt
    );
    const vCloseCharge = vResolvedCloseCharge !== null
        ? vResolvedCloseCharge
        : await estimateTrackedPositionCharge(
            objCurrentPosition,
            Number(objCurrentPosition.markPrice || objCurrentPosition.entryPrice || 0)
        );
    const vClosePnl = Number.isFinite(Number(objCloseResult.realizedPnl))
        ? Number(objCloseResult.realizedPnl)
        : estimateTrackedPositionPnl(
            objCurrentPosition,
            Number(objCurrentPosition.markPrice || objCurrentPosition.entryPrice || 0)
        );

    const objReEntry = await openTrackedOptionReEntry(
        pUserId,
        pStrategyCode,
        pSelectedApiProfileId,
        objProfile,
        objCurrentPosition,
        {
            ...objMetadata,
            rowIndex: vRowIndex,
            reEntryDelta: vTargetDelta,
            reEnterEnabled: Boolean(objRowState.reEnter),
            openedReason: "manual_option_open"
        },
        "tp",
        {
            useRowAction: true,
            useRowQty: true,
            forceLegSide: vLegSide,
            forceTargetDelta: vTargetDelta,
            forceExpiryDate: String(objRowState.expiryDate || "").trim()
        }
    );
    if (!objReEntry) {
        throw new Error(`No replacement ${vLegSide.toUpperCase()} contract was found from row ${vRowIndex} Manual Trader settings.`);
    }

    const vResolvedReEntryCharge = await resolveOrderChargeFromDelta(
        client,
        objReEntry.position.contractName,
        objReEntry.orderPayload,
        objReEntry.position.side,
        Number(objReEntry.position.qty || 0),
        objReEntry.placedAt
    );
    const vReEntryCharge = vResolvedReEntryCharge !== null
        ? vResolvedReEntryCharge
        : await estimateTrackedPositionCharge(objReEntry.position);

    const arrNextPositions = [
        ...arrSavedPositions.filter((objRow) => String(objRow.importId || "").trim() !== String(objCurrentPosition.importId || "").trim()),
        objReEntry.position
    ];
    const arrSaved = await replaceRollingFuturesLtImportedPositions(pUserId, pStrategyCode, arrNextPositions);
    await incrementBrokerageRecoveryTotal(
        pUserId,
        pStrategyCode,
        vCloseCharge + vReEntryCharge,
        arrSaved.length
    );
    await incrementRecoveredTotalPnl(pUserId, pStrategyCode, vClosePnl, arrSaved.length);
    await syncDualStrategySurvivalState(
        pUserId,
        pStrategyCode,
        pSelectedApiProfileId,
        arrSaved,
        arrSaved.length ? "active" : "ended"
    );
    if (!arrSaved.length) {
        await clearActiveStrategyRun(pUserId, pStrategyCode);
    }

    await logFuturesEvent(
        pUserId,
        pStrategyCode,
        "future_closed",
        "info",
        `${vStrategyLabel} Position Swapped`,
        `Swapped ${objCurrentPosition.contractName} into ${objReEntry.position.contractName} using row ${vRowIndex} Manual Trader settings.`,
        {
            closedContractName: objCurrentPosition.contractName,
            reopenedContractName: objReEntry.position.contractName,
            rowIndex: vRowIndex,
            legSide: vLegSide,
            pnlDelta: Number(vClosePnl.toFixed(4)),
            closeCharge: Number(vCloseCharge.toFixed(4)),
            reopenCharge: Number(vReEntryCharge.toFixed(4)),
            reason: "covered_manual_swap"
        }
    );

    return {
        trackedOpenPositions: await buildOpenPositionsPayload(pUserId, pStrategyCode, arrSaved),
        closedContractName: objCurrentPosition.contractName,
        reopenedContractName: objReEntry.position.contractName,
        closeOrder: objCloseResult.payload,
        openOrder: objReEntry.orderPayload
    };
}

async function swapCoveredOpenPositionInternal(req: Request, res: Response): Promise<void> {
    const pStrategyCode: RollingFuturesLtStrategyCode = req.originalUrl.includes("/strangle-options")
        ? "strangle-options"
        : "covered-options";
    const vStrategyLabel = getCoveredLikeStrategyLabel(pStrategyCode);
    const vLowerLabel = getCoveredLikeLowerLabel(pStrategyCode);
    const vUserId = getAccountId(req);
    const objProfile = await readLiveProfile(vUserId, pStrategyCode);
    const vSelectedApiProfileId = String(objProfile.selectedApiProfileId || "").trim();
    if (!vSelectedApiProfileId) {
        res.status(400).json({ status: "warning", message: `Select an API profile before swapping ${vLowerLabel} positions.` });
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

    const vImportId = String(req.body?.importId || "").trim();
    const arrSavedPositions = await listRollingFuturesLtImportedPositions(vUserId, pStrategyCode);
    const objPosition = arrSavedPositions.find((objRow) => String(objRow.importId || "").trim() === vImportId);
    if (!objPosition) {
        res.status(404).json({
            status: "warning",
            message: `${vStrategyLabel} open position was not found.`
        });
        return;
    }
    if (!isOptionContractSymbol(objPosition.contractName)) {
        res.status(400).json({
            status: "warning",
            message: `Only ${vLowerLabel} option positions can be swapped.`
        });
        return;
    }

    const objMetadata = getTrackedOptionMetadata(objPosition);
    const vRowIndex = resolveCoveredTrackedPositionRowIndex(
        getMergedUiState(objProfile),
        objPosition,
        objMetadata.rowIndex
    );
    const vLegSide = getTrackedOptionLegSide(objPosition.contractName).toUpperCase();
    const objPendingResult = await requestCoveredLiveConfirmation(vUserId, objProfile, {
        kind: "manual_swap",
        title: `Confirm ${vStrategyLabel} Swap`,
        message: `Swap ${objPosition.contractName} now? This will close the live ${vLegSide} leg and reopen it using row ${vRowIndex} Manual Trader settings.`,
        payload: {
            importId: objPosition.importId,
            contractName: objPosition.contractName
        }
    });
    if (objPendingResult === "queued" || objPendingResult === "suppressed") {
        res.json({
            status: "warning",
            message: objPendingResult === "queued"
                ? `${vStrategyLabel} swap is waiting for confirmation.`
                : "Another live action confirmation is already pending."
        });
        return;
    }

    try {
        const objResult = await executeCoveredOpenPositionSwap(vUserId, vSelectedApiProfileId, objProfile, objPosition);
        res.json({
            status: "success",
            message: `Swapped ${objResult.closedContractName} into ${objResult.reopenedContractName}.`,
            data: {
                closeOrder: objResult.closeOrder,
                openOrder: objResult.openOrder,
                trackedOpenPositions: objResult.trackedOpenPositions
            }
        });
    }
    catch (objError) {
        res.status(500).json({
            status: "danger",
            message: getErrorMessage(objError, `Unable to swap the ${vLowerLabel} position.`)
        });
    }
}

async function executeManualFutureInternal(req: Request, res: Response, pStrategyCode: RollingFuturesLtStrategyCode): Promise<void> {
    if (isCoveredLikeStrategy(pStrategyCode)) {
        res.status(400).json({
            status: "warning",
            message: isOptionsScalperStrategy(pStrategyCode)
                ? "Manual futures are disabled for Options Demo paper mode."
                : "Manual futures are disabled for Covered Options."
        });
        return;
    }
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
        const { client, profile } = await getDeltaClientForAccountId(vUserId, vSelectedApiProfileId);
        const objPlacedOrder = await placeManagedManualFutureOrder(
            vUserId,
            pStrategyCode,
            vSelectedApiProfileId,
            vSymbol,
            vAction,
            vQty,
            vOrderType,
            "HG"
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
        await syncDualStrategySurvivalState(
            vUserId,
            pStrategyCode,
            vSelectedApiProfileId,
            arrSaved,
            arrSaved.length ? "active" : "ended"
        );
        const vResolvedEntryCharge = await resolveOrderChargeFromDelta(
            client,
            objPlacedOrder.contractName,
            objPlacedOrder.order,
            vAction,
            vQty,
            String(objPlacedOrder.entryTs || new Date().toISOString())
        );
        const vEntryCharge = vResolvedEntryCharge !== null
            ? vResolvedEntryCharge
            : await estimateTrackedPositionCharge({
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
    let objProfile = await readLiveProfile(vUserId, pStrategyCode);
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
    let vLegSide = String(req.body?.legSide || "").trim().toLowerCase();
    const vRowIndex = normalizeOptionRowIndex(pStrategyCode, req.body?.rowIndex);
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
        if (isOptionsScalperStrategy(pStrategyCode)) {
            const arrExisting = await listRollingFuturesLtImportedPositions(vUserId, pStrategyCode);
            const arrOpenOptions = listTrackedOpenOptionPositions(arrExisting);
            if (arrOpenOptions.length > 0 && !hasTrackedOptionRowLeg(arrExisting, vRowIndex, vLegSide === "pe" ? "pe" : "ce")) {
                throw new Error(`A paper option position is already open (${arrOpenOptions[0].contractName}). Close the existing option before placing another paper option.`);
            }
            if (hasTrackedOptionRowLeg(arrExisting, vRowIndex, vLegSide === "pe" ? "pe" : "ce")) {
                throw new Error(`Row ${vRowIndex} ${vLegSide.toUpperCase()} paper option is already open. Close it before placing another one.`);
            }
            const objPaperOpen = await buildOptionsScalperPaperOptionOpen(
                vUserId,
                pStrategyCode,
                objProfile,
                {
                    action: vAction === "buy" ? "buy" : "sell",
                    symbol: vSymbol,
                    legSide: vLegSide === "pe" ? "pe" : "ce",
                    expiryMode: ["1", "2", "4", "5", "6", "7"].includes(vExpiryMode) ? vExpiryMode : "5",
                    expiryDate: vExpiryDate,
                    qty: vQty,
                    targetDelta: vTargetDelta,
                    rowIndex: vRowIndex,
                    openedReason: "manual_option_open"
                }
            );
            const arrSaved = await replaceRollingFuturesLtImportedPositions(vUserId, pStrategyCode, [
                ...arrExisting,
                objPaperOpen.position
            ]);
            await logFuturesEvent(
                vUserId,
                pStrategyCode,
                "option_opened",
                "success",
                "Manual Paper Option Opened",
                `${vAction.toUpperCase()} ${vLegSide.toUpperCase()} paper option opened using live Delta price feed.`,
                {
                    symbol: vSymbol,
                    contractName: objPaperOpen.position.contractName,
                    qty: vQty,
                    targetDelta: vTargetDelta,
                    rowIndex: vRowIndex,
                    reason: "manual_paper_option"
                }
            );
            res.json({
                status: "success",
                message: `${vAction.toUpperCase()} ${vLegSide.toUpperCase()} paper option opened.`,
                data: {
                    action: vAction,
                    legSide: vLegSide,
                    rowIndex: vRowIndex,
                    qty: vQty,
                    targetDelta: vTargetDelta,
                    order: objPaperOpen.order,
                    contract: objPaperOpen.contract,
                    trackedOpenPositions: await buildOpenPositionsPayload(vUserId, pStrategyCode, arrSaved)
                }
            });
            return;
        }
        const { client, profile } = await getDeltaClientForAccountId(vUserId, vSelectedApiProfileId);
        const arrExisting = await listRollingFuturesLtImportedPositions(vUserId, pStrategyCode);
        const arrOpenOptions = listTrackedOpenOptionPositions(arrExisting);
        const bIsDualStrategy = isDualRollingFuturesStrategy(pStrategyCode);
        if (!bIsDualStrategy && arrOpenOptions.length > 0) {
            throw new Error(`An option position is already open (${arrOpenOptions[0].contractName}). Close the existing option before placing another option order.`);
        }
        if (bIsDualStrategy && !isCoveredLikeStrategy(pStrategyCode) && hasTrackedOptionLeg(arrExisting, vLegSide === "pe" ? "pe" : "ce")) {
            throw new Error(`A ${vLegSide.toUpperCase()} option is already open. Close the existing ${vLegSide.toUpperCase()} leg before placing another one.`);
        }
        const objUiState = getMergedUiState(objProfile);
        if (isCoveredOptionsStrategy(pStrategyCode) && vAction === "buy") {
            const objGate = evaluateCoveredBuyHedgeSellPremiumGate(
                arrExisting,
                objUiState,
                vLegSide === "pe" ? "pe" : "ce"
            );
            if (!objGate.allowed) {
                throw new Error(objGate.message || `Matching ${vLegSide.toUpperCase()} sell premium gate blocked buy hedge entry.`);
            }
            const vResolvedLegSide = resolveCoveredBuyHedgeTargetLegSide(
                pStrategyCode,
                arrExisting,
                objUiState,
                vRowIndex,
                vLegSide === "pe" ? "pe" : "ce"
            );
            if (!vResolvedLegSide) {
                res.json({
                    status: "success",
                    message: "Covered buy hedge was already open. No duplicate order was placed.",
                    data: {
                        action: vAction,
                        legSide: vLegSide,
                        rowIndex: vRowIndex,
                        qty: vQty,
                        targetDelta: vTargetDelta,
                        trackedOpenPositions: await buildOpenPositionsPayload(vUserId, pStrategyCode, arrExisting)
                    }
                });
                return;
            }
            vLegSide = vResolvedLegSide;
        }
        const objOptionMetadata = getLiveOptionRuleMetadataFromUiState(objUiState, "manual_option_open", pStrategyCode, vRowIndex);
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
        const objContract = await findBestLiveOptionContractWithNearestFallback(objConfig, vLegSide === "pe" ? "PE" : "CE", vTargetDelta);
        if (!objContract) {
            throw new Error(`No live ${vLegSide.toUpperCase()} contract was found for ${vSymbol} near target delta ${vTargetDelta.toFixed(2)}.`);
        }

        const vAbsoluteDelta = Math.abs(Number(objContract.delta || 0));
        const vClientOrderId = await allocateStrategyClientOrderId(vUserId, pStrategyCode, "EN");
        const objOrderPayload: Record<string, unknown> = {
            product_symbol: objContract.contractSymbol,
            size: vQty,
            side: vAction,
            order_type: "market_order",
            time_in_force: "gtc",
            post_only: false,
            reduce_only: false,
            ...(vClientOrderId ? { client_order_id: vClientOrderId } : {})
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
                    baseDelta: getSignedOptionBaseDelta(String(objContract.contractSymbol || "").trim(), vAbsoluteDelta),
                    baseTheta: Math.abs(Number(objContract.theta || 0)),
                    requestedExpiryDate: objContract.requestedExpiryDate,
                    resolvedExpiryDate: objContract.expiryDate
                }),
                openedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            } satisfies RollingFuturesLtImportedPositionRecord
        ]);
        await syncDualStrategySurvivalState(
            vUserId,
            pStrategyCode,
            vSelectedApiProfileId,
            arrSaved,
            arrSaved.length ? "active" : "ended"
        );
        const vResolvedEntryCharge = await resolveOrderChargeFromDelta(
            client,
            String(objContract.contractSymbol || "").trim(),
            objPayload.result && typeof objPayload.result === "object" ? objPayload.result as Record<string, unknown> : objPayload,
            vAction.toUpperCase(),
            vQty,
            new Date().toISOString()
        );
        const vEntryCharge = vResolvedEntryCharge !== null
            ? vResolvedEntryCharge
            : await estimateTrackedPositionCharge({
                contractName: String(objContract.contractSymbol || "").trim(),
                qty: vQty,
                entryPrice: Number(objContract.markPrice || 0),
                markPrice: Number(objContract.markPrice || 0)
            });
        await incrementBrokerageRecoveryTotal(vUserId, pStrategyCode, vEntryCharge, arrSaved.length);
        if (isCoveredOptionsStrategy(pStrategyCode)) {
            objProfile = await syncCoveredRecoveryMetricsFromClosedHistory(
                vUserId,
                pStrategyCode,
                vSelectedApiProfileId,
                objProfile,
                arrSaved
            );
        }

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
                rowIndex: vRowIndex,
                reason: "manual_option"
            }
        );
        if (isCoveredOptionsStrategy(pStrategyCode) && vAction === "buy") {
            const objGateConfig = getCoveredBuyHedgeSellPremiumGateConfig(objUiState);
            await logFuturesEvent(
                vUserId,
                pStrategyCode,
                "option_opened",
                "success",
                "Covered Buy Hedge Opened",
                `${String(objContract.contractSymbol || "").trim()} opened manually from row ${vRowIndex}. ${getCoveredBuyHedgeOpenReasonText("manual_option_open", vLegSide === "pe" ? "pe" : "ce", { thresholdPct: objGateConfig.enabled ? objGateConfig.thresholdPct : Number.NaN })}`,
                {
                    symbol: vSymbol,
                    contractName: objContract.contractSymbol,
                    qty: vQty,
                    rowIndex: vRowIndex,
                    legSide: vLegSide === "pe" ? "pe" : "ce",
                    reason: "covered_buy_hedge_manual_opened"
                }
            );
        }

        res.json({
            status: "success",
            message: `${vAction.toUpperCase()} ${vLegSide.toUpperCase()} live option order placed using ${profile.referenceName}.`,
            data: {
                action: vAction,
                legSide: vLegSide,
                rowIndex: vRowIndex,
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
    const objTargetAccount = await getAccountById(vUserId);
    if (!isDualExecStrategyAllowed(pStrategyCode, objTargetAccount?.execStrategy)) {
        res.status(403).json({
            status: "warning",
            message: gExecStrategyUnauthorizedMessage
        });
        return;
    }
    let objProfile = await readLiveProfile(vUserId, pStrategyCode);
    if (req.body?.uiState && typeof req.body.uiState === "object") {
        objProfile = await saveRollingFuturesLtProfile(normalizeProfileSaveInput(vUserId, pStrategyCode, {
            ...objProfile,
            selectedApiProfileId: String(req.body?.selectedApiProfileId || objProfile.selectedApiProfileId || "").trim(),
            uiState: req.body.uiState as Record<string, unknown>,
            connectionStatus: objProfile.connectionStatus
        }));
        await ensureRuntimeProfileSelection(vUserId, pStrategyCode, objProfile.selectedApiProfileId);
    }
    objProfile = await refreshModeDrivenExpiryDatesInProfile(vUserId, pStrategyCode, objProfile);
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

    if (isCoveredOptionsStrategy(pStrategyCode)) {
        const objUiState = getMergedUiState(objProfile);
        const vMultiplier = normalizeCoveredMultiplierValue(objUiState.startQty, pStrategyCode);
        const vRequiredMargin = getCoveredRequiredMarginForMultiplier(vMultiplier, pStrategyCode);
        const vSummarySymbol = normalizeSymbolValue(objUiState.symbol);
        const objSummary = await fetchAccountSummarySnapshot(vUserId, vSelectedApiProfileId, vSummarySymbol);
        const vAvailableBalance = Number(objSummary.availableBalance || 0);
        if (!(vAvailableBalance >= vRequiredMargin)) {
            res.status(400).json({
                status: "warning",
                message: `Balance insufficient for the selected qty. Required ${vRequiredMargin.toFixed(2)} USD, available ${vAvailableBalance.toFixed(2)} USD.`
            });
            return;
        }
    }

    if (isCoveredLikeStrategy(pStrategyCode) && Array.isArray(req.body?.rows)) {
        const objMergedUiState = getMergedUiState(objProfile);
        const arrInputs = (req.body.rows as Array<Record<string, unknown>>).map((objRow) => {
            const vRowIndex = normalizeOptionRowIndex(pStrategyCode, objRow.rowIndex);
            const objRowState = getNormalizedOptionRowUiState(objMergedUiState, pStrategyCode, vRowIndex);
            const objInput = normalizeExecStrategyInput(
                objRowState.action,
                objMergedUiState.symbol,
                objRowState.legs,
                objRowState.expiryMode,
                objRowState.expiryDate,
                objRowState.qty || 1,
                objRowState.newD || 0.53
            );
            objInput.rowIndex = vRowIndex;
            return objInput;
        }).filter((objInput) => Boolean(objInput.expiryDate));

        if (!arrInputs.length) {
            res.status(400).json({
                status: "warning",
                message: "At least one valid covered strategy row is required."
            });
            return;
        }

        const objQueueResult = await queueCoveredExecBatchAction(
            vUserId,
            objProfile,
            arrInputs,
            Boolean(req.body?.suppressClosedFromDateUpdate)
        );
        if (!objQueueResult.created) {
            res.json({
                status: "warning",
                message: objQueueResult.message
            });
            return;
        }
        res.json({
            status: "success",
            message: objQueueResult.message
        });
        return;
    }

    const vAction = String(req.body?.action || "").trim().toLowerCase();
    const vLegSide = String(req.body?.legSide || "").trim().toLowerCase();
    const objExecInput = normalizeExecStrategyInput(
        vAction,
        req.body?.symbol || getMergedUiState(objProfile).symbol,
        vLegSide,
        req.body?.expiryMode || "5",
        req.body?.expiryDate,
        req.body?.qty || 1,
        req.body?.targetDelta || 0.53
    );
    objExecInput.rowIndex = normalizeOptionRowIndex(pStrategyCode, req.body?.rowIndex);

    if (vAction !== "buy" && vAction !== "sell") {
        res.status(400).json({ status: "warning", message: "Select a valid Action before executing the live strategy." });
        return;
    }
    if (!["ce", "pe", "both"].includes(vLegSide)) {
        res.status(400).json({ status: "warning", message: "Select valid Legs before executing the live strategy." });
        return;
    }
    if (!isDualRollingFuturesStrategy(pStrategyCode) && vLegSide === "both") {
        res.status(400).json({ status: "warning", message: "Select either CE or PE for this live strategy page." });
        return;
    }
    if (!(objExecInput.targetDelta > 0)) {
        res.status(400).json({ status: "warning", message: "Enter a valid New D before executing the live strategy." });
        return;
    }

    try {
        if (isDualRollingFuturesStrategy(pStrategyCode) && !isCoveredOptionsStrategy(pStrategyCode)) {
            const arrExistingOpenPositions = await fetchLiveFuturePositions(
                vUserId,
                pStrategyCode,
                vSelectedApiProfileId,
                objExecInput.symbol
            );
            if (arrExistingOpenPositions.length) {
                res.status(400).json({
                    status: "warning",
                    message: "Please Closed Existing Open Positions and try again"
                });
                return;
            }
            const objSummary = await fetchAccountSummarySnapshot(vUserId, vSelectedApiProfileId, objExecInput.symbol);
            await createPendingStrategyExecutionRequest({
                accountId: vUserId,
                strategyCode: pStrategyCode,
                triggerSource: "manual_exec_strategy",
                requestPayload: {
                    selectedApiProfileId: vSelectedApiProfileId,
                    action: objExecInput.action,
                    symbol: objExecInput.symbol,
                    legSide: objExecInput.legSide,
                    expiryMode: objExecInput.expiryMode,
                    expiryDate: objExecInput.expiryDate,
                    qty: objExecInput.qty,
                    targetDelta: objExecInput.targetDelta,
                    rowIndex: objExecInput.rowIndex,
                    startQty: objExecInput.qty,
                    availableBalance: objSummary.availableBalance
                }
            });
            await logFuturesEvent(
                vUserId,
                pStrategyCode,
                "manual_action",
                "success",
                "Exec Strategy Request Submitted",
                "Exec Strategy request was saved successfully. It will Auto Execute at the right time.",
                {
                    symbol: objExecInput.symbol,
                    action: objExecInput.action,
                    legs: objExecInput.legSide,
                    qty: objExecInput.qty,
                    targetDelta: objExecInput.targetDelta,
                    reason: "manual_exec_strategy_request"
                }
            );
            res.json({
                status: "success",
                message: "Exec Strategy request submitted successfully. It will Auto Execute at the right time."
            });
            return;
        }

        const objExecResult = await runExecStrategyPlacement(
            vUserId,
            pStrategyCode,
            vSelectedApiProfileId,
            objProfile,
            objExecInput,
            "exec_strategy"
        );
        if (!Boolean(req.body?.suppressClosedFromDateUpdate)) {
            if (isCoveredOptionsStrategy(pStrategyCode)) {
                objProfile = await syncCoveredRecoveryMetricsFromClosedHistory(
                    vUserId,
                    pStrategyCode,
                    vSelectedApiProfileId,
                    objProfile,
                    objExecResult.trackedOpenPositions
                );
            }
            else if (isOptionsScalperStrategy(pStrategyCode)) {
                objProfile = await updateStrategyClosedFromDateAfterExec(
                    vUserId,
                    pStrategyCode,
                    objProfile,
                    objExecResult.trackedOpenPositions
                );
                await syncOptionsScalperRecoveryMetricsFromPaperClosedPositions(vUserId, objProfile);
            }
            else {
                objProfile = await updateStrategyClosedFromDateAfterExec(
                    vUserId,
                    pStrategyCode,
                    objProfile,
                    objExecResult.trackedOpenPositions
                );
            }
        }

        res.json({
            status: "success",
            message: `Exec Strategy placed ${objExecResult.orders.length} option order${objExecResult.orders.length === 1 ? "" : "s"} using ${objExecResult.profileLabel}.`,
            data: {
                action: objExecInput.action,
                legs: objExecInput.legSide,
                qty: objExecInput.qty,
                targetDelta: objExecInput.targetDelta,
                orders: objExecResult.orders,
                contracts: objExecResult.contracts,
                trackedOpenPositions: await buildOpenPositionsPayload(vUserId, pStrategyCode, objExecResult.trackedOpenPositions),
                neutralCheck: objExecResult.neutralCheck
            }
        });
    }
    catch (objError) {
        const vMessage = getErrorMessage(objError, "Unable to execute the live strategy.");
        const vStatusCode = vMessage.includes("already active")
            ? 409
            : 500;
        res.status(vStatusCode).json({
            status: vStatusCode === 409 ? "warning" : "danger",
            message: vMessage
        });
    }
}

async function getClosedPositionsInternal(req: Request, res: Response, pStrategyCode: RollingFuturesLtStrategyCode): Promise<void> {
    if (isOptionsScalperStrategy(pStrategyCode)) {
        const vUserId = getAccountId(req);
        const objProfile = await readLiveProfile(vUserId, pStrategyCode);
        const objUiState = getMergedUiState(objProfile);
        const vSelectedSymbol = normalizeSymbolValue(req.query?.symbol || req.body?.symbol || objUiState.symbol);
        const vFromDate = String(req.query?.fromDate || req.body?.fromDate || "").trim();
        const vToDate = String(req.query?.toDate || req.body?.toDate || "").trim();
        const arrRows = filterPaperClosedPositionsByRange(
            (await listOptionsScalperPaperClosedPositions(vUserId, pStrategyCode))
                .filter((objRow) => isTrackedContractForSymbol(objRow.contractName, vSelectedSymbol)),
            vFromDate,
            vToDate
        ).map(mapOptionsScalperPaperClosedPosition);
        res.json({
            status: "success",
            data: {
                profileLabel: "Paper",
                positions: arrRows
            }
        });
        return;
    }
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
                return isTrackedContractForSymbol(vContract, vSelectedSymbol)
                    && doesClosedOrderHistoryRowBelongToStrategy(objRow, pStrategyCode);
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

async function calculateRecalculatedTotalPnl(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pSelectedApiProfileId: string,
    pStrategyStartedAt: string
): Promise<RollingFuturesLtRecalculatedTotalPnl> {
    const objProfile = await readLiveProfile(pUserId, pStrategyCode);
    const objUiState = getMergedUiState(objProfile);
    const vSelectedSymbol = normalizeSymbolValue(objUiState.symbol);
    const { client } = await getDeltaClientForAccountId(pUserId, pSelectedApiProfileId);
    const vPageSize = 100;
    const arrRows: DeltaOrderHistoryRow[] = [];
    let vAfterCursor = "";
    let vSafetyCounter = 0;
    const vStartTime = toEpochMicros(pStrategyStartedAt);
    while (vSafetyCounter < 100) {
        const objParams: Record<string, string | number> = { page_size: vPageSize };
        if (vStartTime) {
            objParams.start_time = vStartTime;
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

    const vClosedRealizedPnl = Number(arrRows
        .filter((objRow) => String(objRow.state || "").trim().toLowerCase() === "closed")
        .filter((objRow) => {
            const vContract = String(objRow.product_symbol || objRow.symbol || "").trim().toUpperCase();
            return isTrackedContractForSymbol(vContract, vSelectedSymbol)
                && doesClosedOrderHistoryRowBelongToStrategy(objRow, pStrategyCode);
        })
        .reduce((pSum, objRow) => pSum + toFiniteNumber(objRow.meta_data?.pnl, 0), 0).toFixed(4));

    const arrLivePositions = await fetchLiveFuturePositions(pUserId, pStrategyCode, pSelectedApiProfileId, vSelectedSymbol);
    const vOpenFuturesRealizedPnl = Number(arrLivePositions.reduce((pSum, objPosition) => {
        return pSum + getTrackedFutureRealizedPnl(objPosition);
    }, 0).toFixed(4));

    return {
        strategyStartedAt: pStrategyStartedAt,
        closedRealizedPnl: vClosedRealizedPnl,
        openFuturesRealizedPnl: vOpenFuturesRealizedPnl,
        totalPnl: Number((vClosedRealizedPnl + vOpenFuturesRealizedPnl).toFixed(4))
    };
}

async function recalculateAndPersistTotalPnl(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pSelectedApiProfileId: string
): Promise<{
    openPositions: RollingFuturesLtOpenPositionsPayload;
    recalculated: RollingFuturesLtRecalculatedTotalPnl;
}> {
    const vStrategyStartedAt = await resolveStableStrategyStartedAt(pUserId, pStrategyCode);
    if (!vStrategyStartedAt) {
        throw new Error("Strategy start date was not found. Start the strategy first, then recalculate Total PnL.");
    }

    const objRecalculated = await calculateRecalculatedTotalPnl(
        pUserId,
        pStrategyCode,
        pSelectedApiProfileId,
        vStrategyStartedAt
    );
    await saveRecoveredTotalPnl(pUserId, pStrategyCode, objRecalculated.totalPnl);
    const objOpenPositions = await buildOpenPositionsPayload(pUserId, pStrategyCode);
    return {
        openPositions: objOpenPositions,
        recalculated: objRecalculated
    };
}

async function resolveStableStrategyStartedAt(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode
): Promise<string> {
    const objRuntime = await loadRollingFuturesLtRuntime(pUserId, pStrategyCode)
        || getDefaultRollingFuturesLtRuntime(pUserId, pStrategyCode);
    let vStrategyStartedAt = getStrategyStartedAtState(objRuntime);
    if (vStrategyStartedAt) {
        return vStrategyStartedAt;
    }

    const objSurvival = await getSurvivalState(pUserId, pStrategyCode).catch(() => null);
    vStrategyStartedAt = String(objSurvival?.strategyStartedAt || "").trim();
    if (vStrategyStartedAt) {
        await saveRollingFuturesLtRuntime({
            ...objRuntime,
            userId: pUserId,
            strategyCode: pStrategyCode,
            state: buildRuntimeStateWithStrategyStartedAt(objRuntime, vStrategyStartedAt)
        });
        return vStrategyStartedAt;
    }

    const arrTrackedPositions = await listRollingFuturesLtImportedPositions(pUserId, pStrategyCode);
    vStrategyStartedAt = getEarliestOpenedAtFromTrackedPositions(arrTrackedPositions);
    if (vStrategyStartedAt) {
        await saveRollingFuturesLtRuntime({
            ...objRuntime,
            userId: pUserId,
            strategyCode: pStrategyCode,
            state: buildRuntimeStateWithStrategyStartedAt(objRuntime, vStrategyStartedAt)
        });
    }
    return vStrategyStartedAt;
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
    if (isOptionsScalperStrategy(pStrategyCode)) {
        const arrPositions = await listRollingFuturesLtImportedPositions(vUserId, pStrategyCode);
        if (!arrPositions.length) {
            res.json({
                status: "success",
                message: "No saved paper positions were open.",
                data: {
                    closedPositions: [],
                    trackedOpenPositions: await buildOpenPositionsPayload(vUserId, pStrategyCode, [])
                }
            });
            return;
        }
        const objClosed = await closeTrackedPositionsOnDelta(vUserId, pStrategyCode, "", arrPositions);
        await logFuturesEvent(
            vUserId,
            pStrategyCode,
            "engine_stopped",
            "warning",
            "Paper Kill Switch",
            `Kill switch closed ${objClosed.closedPositions.length} paper position${objClosed.closedPositions.length === 1 ? "" : "s"} using live Delta prices.`,
            { qty: objClosed.closedPositions.length, reason: "paper_kill_switch" }
        );
        res.json({
            status: "success",
            message: `Kill switch closed ${objClosed.closedPositions.length} paper position${objClosed.closedPositions.length === 1 ? "" : "s"}.`,
            data: {
                closedPositions: objClosed.closedPositions,
                trackedOpenPositions: await buildOpenPositionsPayload(vUserId, pStrategyCode, [])
            }
        });
        return;
    }
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
        const arrCloseCharges: number[] = [];
        const arrClosePnls: number[] = [];
        const arrClosed: Array<Record<string, unknown>> = [];
        for (const objPosition of arrPositions) {
            const vClientOrderId = await allocateStrategyClientOrderId(vUserId, pStrategyCode, "CL");
            const objOrderPayload: Record<string, unknown> = {
                product_symbol: objPosition.contractName,
                size: objPosition.qty,
                side: objPosition.side === "BUY" ? "sell" : "buy",
                order_type: "market_order",
                time_in_force: "gtc",
                post_only: false,
                reduce_only: true,
                ...(vClientOrderId ? { client_order_id: vClientOrderId } : {})
            };
            const vPlacedAtIso = new Date().toISOString();
            const objResponse = await client.apis.Orders.placeOrder({ order: objOrderPayload });
            const objPayload = readResponsePayload(objResponse);
            const vResolvedCharge = await resolveOrderChargeFromDelta(
                client,
                objPosition.contractName,
                objPayload,
                String(objPosition.side || "").trim().toUpperCase() === "BUY" ? "SELL" : "BUY",
                Number(objPosition.qty || 0),
                vPlacedAtIso
            );
            arrCloseCharges.push(vResolvedCharge !== null
                ? vResolvedCharge
                : await estimateTrackedPositionCharge(
                    objPosition,
                    Number(objPosition.markPrice || objPosition.entryPrice || 0)
                ));
            const vResolvedPnl = await resolveTrackedPositionClosePnl(client, objPosition, objPayload, vPlacedAtIso);
            arrClosePnls.push(Number.isFinite(Number(vResolvedPnl))
                ? Number(vResolvedPnl)
                : (isFutureContractSymbol(objPosition.contractName) ? 0 : estimateTrackedPositionPnl(
                    objPosition,
                    Number(objPosition.markPrice || objPosition.entryPrice || 0)
                )));
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
        await syncDualStrategySurvivalState(vUserId, pStrategyCode, vSelectedApiProfileId, [], "ended");
        await clearActiveStrategyRun(vUserId, pStrategyCode);
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

async function fetchTrackedClosedOrderHistoryRows(
    pClient: any,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pSelectedSymbol: "BTC" | "ETH",
    pStartTimeIso = "",
    pEndTimeIso = ""
): Promise<DeltaOrderHistoryRow[]> {
    const vPageSize = 100;
    const arrRows: DeltaOrderHistoryRow[] = [];
    let vAfterCursor = "";
    let vSafetyCounter = 0;
    const vStartTime = toEpochMicros(pStartTimeIso);
    const vEndTime = toEpochMicros(pEndTimeIso, true);
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
        const objResponse = await pClient.apis.TradeHistory.getOrderHistory(objParams);
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

    return arrRows
        .filter((objRow) => String(objRow.state || "").trim().toLowerCase() === "closed")
        .filter((objRow) => {
            const vContract = String(objRow.product_symbol || objRow.symbol || "").trim().toUpperCase();
            return isTrackedContractForSymbol(vContract, pSelectedSymbol)
                && doesClosedOrderHistoryRowBelongToStrategy(objRow, pStrategyCode);
        });
}

async function resolveStrategyStartedAtForRecoveryRefresh(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode
): Promise<string> {
    return resolveStableStrategyStartedAt(pUserId, pStrategyCode);
}

async function recalculateAndPersistRecoveryMetricsFromClosedHistory(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pSelectedApiProfileId: string
): Promise<{
    openPositions: RollingFuturesLtOpenPositionsPayload;
    recalculated: {
        strategyStartedAt: string;
        totalBrokerageToRecover: number;
        totalPnl: number;
        closedCount: number;
    };
}> {
    if (isOptionsScalperStrategy(pStrategyCode)) {
        const objProfile = await readLiveProfile(pUserId, pStrategyCode);
        const objUiState = getMergedUiState(objProfile);
        const vSelectedSymbol = normalizeSymbolValue(objUiState.symbol);
        const arrRows = filterPaperClosedPositionsByRange(
            (await listOptionsScalperPaperClosedPositions(pUserId, pStrategyCode))
                .filter((objRow) => isTrackedContractForSymbol(objRow.contractName, vSelectedSymbol)),
            String(objUiState.closedFromDate || "").trim(),
            String(objUiState.closedToDate || "").trim()
        );
        const vBrokerageTotal = Number(arrRows.reduce((pSum, objRow) => pSum + Number(objRow.charges || 0), 0).toFixed(4));
        const vTotalPnl = Number(arrRows.reduce((pSum, objRow) => pSum + Number(objRow.pnl || 0), 0).toFixed(4));
        await saveBrokerageRecoveryTotal(pUserId, pStrategyCode, vBrokerageTotal);
        await saveRecoveredTotalPnl(pUserId, pStrategyCode, vTotalPnl);
        return {
            openPositions: await buildOpenPositionsPayload(pUserId, pStrategyCode),
            recalculated: {
                strategyStartedAt: String(objUiState.closedFromDate || "").trim(),
                totalBrokerageToRecover: vBrokerageTotal,
                totalPnl: vTotalPnl,
                closedCount: arrRows.length
            }
        };
    }
    if (isCoveredOptionsStrategy(pStrategyCode)) {
        const objProfile = await readLiveProfile(pUserId, pStrategyCode);
        const objUiState = getMergedUiState(objProfile);
        const vSelectedSymbol = normalizeSymbolValue(objUiState.symbol);
        const vClosedFromDate = String(objUiState.closedFromDate || "").trim();
        const vClosedToDate = String(objUiState.closedToDate || "").trim();
        const vClosedFromDateIso = parseDeltaUiDateTimeLocalToIsoString(vClosedFromDate);
        const vClosedToDateIso = parseDeltaUiDateTimeLocalToIsoString(vClosedToDate);
        const { client } = await getDeltaClientForAccountId(pUserId, pSelectedApiProfileId);
        const arrRows = await fetchTrackedClosedOrderHistoryRows(
            client,
            pStrategyCode,
            vSelectedSymbol,
            vClosedFromDateIso,
            vClosedToDateIso
        );
        const vBrokerageTotal = Number(arrRows.reduce((pSum, pRow) => {
            return pSum + toFiniteNumber(pRow.paid_commission, 0);
        }, 0).toFixed(4));
        const vTotalPnl = Number(arrRows.reduce((pSum, pRow) => {
            return pSum + toFiniteNumber(pRow.meta_data?.pnl, 0);
        }, 0).toFixed(4));
        await saveBrokerageRecoveryTotal(pUserId, pStrategyCode, vBrokerageTotal);
        await saveRecoveredTotalPnl(pUserId, pStrategyCode, vTotalPnl);
        return {
            openPositions: await buildOpenPositionsPayload(pUserId, pStrategyCode),
            recalculated: {
                strategyStartedAt: vClosedFromDate,
                totalBrokerageToRecover: vBrokerageTotal,
                totalPnl: vTotalPnl,
                closedCount: arrRows.length
            }
        };
    }
    type RecoveryRefreshTotals = {
        strategyStartedAt: string;
        totalBrokerageToRecover: number;
        totalPnl: number;
        closedCount: number;
    };
    const vStrategyStartedAt = await resolveStrategyStartedAtForRecoveryRefresh(pUserId, pStrategyCode);
    if (!vStrategyStartedAt) {
        throw new Error("Strategy start date was not found. Start the strategy first, then refresh recovery totals automatically.");
    }

    const objProfile = await readLiveProfile(pUserId, pStrategyCode);
    const objUiState = getMergedUiState(objProfile);
    const vSelectedSymbol = normalizeSymbolValue(objUiState.symbol);
    const { client } = await getDeltaClientForAccountId(pUserId, pSelectedApiProfileId);
    const arrRows = await fetchTrackedClosedOrderHistoryRows(client, pStrategyCode, vSelectedSymbol, vStrategyStartedAt);
    const objRecalculated = arrRows.reduce<RecoveryRefreshTotals>((pTotals, pRow) => {
        return {
            strategyStartedAt: vStrategyStartedAt,
            totalBrokerageToRecover: pTotals.totalBrokerageToRecover + toFiniteNumber(pRow.paid_commission, 0),
            totalPnl: pTotals.totalPnl + toFiniteNumber(pRow.meta_data?.pnl, 0),
            closedCount: pTotals.closedCount + 1
        };
    }, {
        strategyStartedAt: vStrategyStartedAt,
        totalBrokerageToRecover: 0,
        totalPnl: 0,
        closedCount: 0
    } satisfies RecoveryRefreshTotals);

    await saveBrokerageRecoveryTotal(pUserId, pStrategyCode, objRecalculated.totalBrokerageToRecover);
    await saveRecoveredTotalPnl(pUserId, pStrategyCode, objRecalculated.totalPnl);
    const objOpenPositions = await buildOpenPositionsPayload(pUserId, pStrategyCode);
    return {
        openPositions: objOpenPositions,
        recalculated: {
            strategyStartedAt: objRecalculated.strategyStartedAt,
            totalBrokerageToRecover: Number(objRecalculated.totalBrokerageToRecover.toFixed(4)),
            totalPnl: Number(objRecalculated.totalPnl.toFixed(4)),
            closedCount: objRecalculated.closedCount
        }
    };
}

async function schedulePendingOptionRecoveryRefresh(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pReason: "sl" | "tp"
): Promise<void> {
    if (isCoveredOptionsStrategy(pStrategyCode)) {
        return;
    }
    if (isOptionsScalperStrategy(pStrategyCode)) {
        await syncOptionsScalperRecoveryMetricsFromPaperClosedPositions(
            pUserId,
            await readLiveProfile(pUserId, pStrategyCode)
        );
        return;
    }
    const objRuntime = await loadRollingFuturesLtRuntime(pUserId, pStrategyCode)
        || getDefaultRollingFuturesLtRuntime(pUserId, pStrategyCode);
    const objPending = getPendingOptionRecoveryRefreshState(objRuntime);
    const vExistingRunAtMs = new Date(String(objPending.runAt || "")).getTime();
    if (objPending.reason && Number.isFinite(vExistingRunAtMs) && vExistingRunAtMs > Date.now()) {
        return;
    }
    const vScheduledAt = new Date().toISOString();
    const vRunAt = new Date(Date.now() + gOptionRecoveryRefreshDelayMs).toISOString();
    await saveRollingFuturesLtRuntime({
        ...objRuntime,
        userId: pUserId,
        strategyCode: pStrategyCode,
        state: buildRuntimeStateWithPendingOptionRecoveryRefresh(
            objRuntime,
            pReason,
            vRunAt,
            vScheduledAt
        )
    });
    await logFuturesEvent(
        pUserId,
        pStrategyCode,
        "manual_action",
        "info",
        pReason === "sl" ? "Option SL Recovery Refresh Scheduled" : "Option TP Recovery Refresh Scheduled",
        `Closed-position charges and realized PnL will be refreshed automatically after 5 minutes for this ${pReason.toUpperCase()} option exit.`,
        {
            reason: pReason === "sl" ? "option_sl_recovery_refresh_scheduled" : "option_tp_recovery_refresh_scheduled",
            runAt: vRunAt
        }
    );
}

async function processPendingOptionRecoveryRefresh(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pSelectedApiProfileId: string,
    pRuntime: RollingFuturesLtRuntimeRecord | null
): Promise<void> {
    if (isCoveredOptionsStrategy(pStrategyCode)) {
        return;
    }
    const objRuntime = pRuntime || await loadRollingFuturesLtRuntime(pUserId, pStrategyCode);
    const objPending = getPendingOptionRecoveryRefreshState(objRuntime);
    if (!objPending.reason || !objPending.runAt) {
        return;
    }
    const vRunAtMs = new Date(objPending.runAt).getTime();
    if (!Number.isFinite(vRunAtMs) || vRunAtMs > Date.now()) {
        return;
    }

    try {
        const objResult = await recalculateAndPersistRecoveryMetricsFromClosedHistory(
            pUserId,
            pStrategyCode,
            pSelectedApiProfileId
        );
        const objLatestRuntime = await loadRollingFuturesLtRuntime(pUserId, pStrategyCode)
            || getDefaultRollingFuturesLtRuntime(pUserId, pStrategyCode);
        await saveRollingFuturesLtRuntime({
            ...objLatestRuntime,
            userId: pUserId,
            strategyCode: pStrategyCode,
            state: buildRuntimeStateWithPendingOptionRecoveryRefresh(objLatestRuntime, "", "", "")
        });
        await logFuturesEvent(
            pUserId,
            pStrategyCode,
            "manual_action",
            "success",
            "Option Recovery Refresh Completed",
            `Closed-position totals were refreshed automatically from Delta history. Brokerage ${objResult.recalculated.totalBrokerageToRecover.toFixed(4)}, Total PnL ${objResult.recalculated.totalPnl.toFixed(4)}.`,
            {
                reason: objPending.reason === "sl" ? "option_sl_recovery_refresh_completed" : "option_tp_recovery_refresh_completed",
                totalBrokerageToRecover: objResult.recalculated.totalBrokerageToRecover,
                totalPnl: objResult.recalculated.totalPnl,
                closedCount: objResult.recalculated.closedCount
            }
        );
    }
    catch (objError) {
        const objLatestRuntime = await loadRollingFuturesLtRuntime(pUserId, pStrategyCode)
            || getDefaultRollingFuturesLtRuntime(pUserId, pStrategyCode);
        await saveRollingFuturesLtRuntime({
            ...objLatestRuntime,
            userId: pUserId,
            strategyCode: pStrategyCode,
            state: buildRuntimeStateWithPendingOptionRecoveryRefresh(objLatestRuntime, "", "", "")
        });
        await logFuturesEvent(
            pUserId,
            pStrategyCode,
            "engine_error",
            "warning",
            "Option Recovery Refresh Failed",
            getErrorMessage(objError, "Automatic recovery refresh failed."),
            {
                reason: objPending.reason === "sl" ? "option_sl_recovery_refresh_failed" : "option_tp_recovery_refresh_failed"
            }
        );
    }
}

async function recalculateRecoveryTotalPnlInternal(req: Request, res: Response, pStrategyCode: RollingFuturesLtStrategyCode): Promise<void> {
    const vUserId = getAccountId(req);
    if (isOptionsScalperStrategy(pStrategyCode)) {
        try {
            const objProfile = await readLiveProfile(vUserId, pStrategyCode);
            await syncOptionsScalperRecoveryMetricsFromPaperClosedPositions(vUserId, objProfile);
            res.json({
                status: "success",
                message: "Total PnL recalculated from paper closed positions.",
                data: await buildOpenPositionsPayload(vUserId, pStrategyCode)
            });
        }
        catch (objError) {
            res.status(500).json({
                status: "danger",
                message: getErrorMessage(objError, "Unable to recalculate Total PnL from paper closed positions.")
            });
        }
        return;
    }
    const objProfile = await readLiveProfile(vUserId, pStrategyCode);
    const vSelectedApiProfileId = String(objProfile.selectedApiProfileId || "").trim();
    if (!vSelectedApiProfileId) {
        res.status(400).json({
            status: "warning",
            message: "Select an API profile before recalculating Total PnL."
        });
        return;
    }

    try {
        if (isCoveredOptionsStrategy(pStrategyCode)) {
            const objResult = await recalculateAndPersistRecoveryMetricsFromClosedHistory(
                vUserId,
                pStrategyCode,
                vSelectedApiProfileId
            );
            await logFuturesEvent(
                vUserId,
                pStrategyCode,
                "manual_action",
                "success",
                "Covered Recovery Metrics Recalculated",
                `Recalculated Total Brokerage to ${objResult.recalculated.totalBrokerageToRecover.toFixed(4)} and Total PnL to ${objResult.recalculated.totalPnl.toFixed(4)} from Delta history.`,
                {
                    reason: "covered_recovery_metrics_recalc",
                    totalBrokerageToRecover: objResult.recalculated.totalBrokerageToRecover,
                    totalPnl: objResult.recalculated.totalPnl,
                    closedCount: objResult.recalculated.closedCount
                }
            );
            res.json({
                status: "success",
                message: "Covered recovery metrics recalculated from Delta history.",
                data: objResult.openPositions
            });
            return;
        }
        const objResult = await recalculateAndPersistTotalPnl(vUserId, pStrategyCode, vSelectedApiProfileId);
        await logFuturesEvent(
            vUserId,
            pStrategyCode,
            "manual_action",
            "success",
            "Total PnL Recalculated",
            `Recalculated Total PnL to ${objResult.recalculated.totalPnl.toFixed(4)} from Delta history since ${formatDeltaUiDateTimeLocalString(objResult.recalculated.strategyStartedAt)}.`,
            {
                reason: "manual_total_pnl_recalc",
                totalPnl: objResult.recalculated.totalPnl,
                closedRealizedPnl: objResult.recalculated.closedRealizedPnl,
                openFuturesRealizedPnl: objResult.recalculated.openFuturesRealizedPnl
            }
        );
        res.json({
            status: "success",
            message: "Total PnL recalculated from Delta history.",
            data: objResult.openPositions
        });
    }
    catch (objError) {
        res.status(500).json({
            status: "danger",
            message: getErrorMessage(objError, "Unable to recalculate Total PnL from Delta history.")
        });
    }
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
export async function recalculateRollingFuturesLtLongRecoveryTotalPnl(req: Request, res: Response): Promise<void> {
    await recalculateRecoveryTotalPnlInternal(req, res, "rolling-futures-lt-long");
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
export async function recalculateRollingFuturesLtShortRecoveryTotalPnl(req: Request, res: Response): Promise<void> {
    await recalculateRecoveryTotalPnlInternal(req, res, "rolling-futures-lt-short");
}

export async function listRollingFuturesLtDualRunningUsers(req: Request, res: Response): Promise<void> {
    try {
        const arrRuntimeRows = await listRollingFuturesLtRuntime();
        const arrSurvivalRows = await listSurvivalStates("rolling-futures-lt-dual");
        const objSurvivalByUserId = new Map(arrSurvivalRows.map((objRow) => [objRow.userId, objRow]));
        const arrDualRunning = arrRuntimeRows.filter((objRuntime) => {
            return objRuntime.strategyCode === "rolling-futures-lt-dual"
                && objRuntime.autoTraderEnabled
                && String(objRuntime.status || "").trim().toLowerCase() === "running";
        });

        const arrUsers = [];
        for (const objRuntime of arrDualRunning) {
            const objAccount = await getAccountById(objRuntime.userId);
            if (!objAccount) {
                continue;
            }
            const objLease = await getStrategyLease(objRuntime.userId, objRuntime.strategyCode);
            const objSurvival = objSurvivalByUserId.get(objRuntime.userId) || null;
            const arrImportedPositions = await listRollingFuturesLtImportedPositions(objRuntime.userId, objRuntime.strategyCode);
            const bHasImportedPositions = arrImportedPositions.some((objPosition) => Number(objPosition.qty || 0) > 0);
            const bHasSurvivalPositions = Array.isArray(objSurvival?.openPositions)
                && objSurvival!.openPositions.some((objPosition) => Number((objPosition as Record<string, unknown>)?.qty || 0) > 0);
            if (!bHasImportedPositions && !bHasSurvivalPositions) {
                continue;
            }
            const vPrimaryLeaseOwnerServerId = isLeaseActive(objLease) ? String(objLease?.ownerServerId || "").trim() : "";
            const vSurvivalOwnerServerId = String(objSurvival?.ownerServerId || "").trim();
            const bSurvivalMode = Boolean(objSurvival?.runtimeState?.primaryDbOutageLastError)
                || isPrimaryHandbackPendingState(objSurvival?.runtimeState as Record<string, unknown>)
                || (!!vSurvivalOwnerServerId && vSurvivalOwnerServerId !== vPrimaryLeaseOwnerServerId);
            const vDisplayOwnerServerId = vPrimaryLeaseOwnerServerId || vSurvivalOwnerServerId;
            arrUsers.push({
                accountId: objAccount.accountId,
                fullName: objAccount.fullName,
                email: objAccount.email,
                telegramChatId: objAccount.telegramChatId,
                execStrategy: objAccount.execStrategy,
                isActive: objAccount.isActive,
                status: objRuntime.status,
                autoTraderEnabled: objRuntime.autoTraderEnabled,
                ownerServerId: vDisplayOwnerServerId,
                leaseExpiresAt: isLeaseActive(objLease) ? objLease?.leaseExpiresAt || "" : "",
                survivalMode: bSurvivalMode,
                handbackPending: isPrimaryHandbackPendingState(objSurvival?.runtimeState as Record<string, unknown>),
                handbackTargetServerId: getPrimaryOriginServerIdFromState(objSurvival?.runtimeState as Record<string, unknown>),
                survivalOwnerServerId: vSurvivalOwnerServerId,
                survivalUpdatedAt: String(objSurvival?.updatedAt || "").trim(),
                strategyRunId: String(objSurvival?.strategyRunId || getStrategyRunIdState(objRuntime) || "").trim(),
                simulatedPrimaryDbOutage: shouldSimulatePrimaryDbOutage(objRuntime.userId, "rolling-futures-lt-dual"),
                simulatedPrimaryDbOutageEnabledAt: String(getSimulatedPrimaryOutageState(objRuntime.userId, "rolling-futures-lt-dual")?.enabledAt || "").trim(),
                lastCycleAt: objRuntime.lastCycleAt,
                updatedAt: objRuntime.updatedAt
            });
        }

        res.json({
            status: "success",
            data: arrUsers
                .sort((pLeft, pRight) => String(pLeft.fullName || "").localeCompare(String(pRight.fullName || "")))
        });
    }
    catch (objError) {
        res.status(500).json({
            status: "danger",
            message: getErrorMessage(objError, "Unable to load running Dual users.")
        });
    }
}

async function listCoveredLikeVerifierRunningUsers(
    req: Request,
    res: Response,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pStrategyLabel: string
): Promise<void> {
    if (!req.authAccount?.isVerifier) {
        res.status(403).json({
            status: "warning",
            message: "Verifier access is required."
        });
        return;
    }

    try {
        const arrRuntimeRows = await listRollingFuturesLtRuntime();
        const arrCoveredRunning = arrRuntimeRows.filter((objRuntime) => {
            return objRuntime.strategyCode === pStrategyCode
                && objRuntime.autoTraderEnabled
                && String(objRuntime.status || "").trim().toLowerCase() === "running";
        });

        const arrUsers = [];
        for (const objRuntime of arrCoveredRunning) {
            const objAccount = await getAccountById(objRuntime.userId);
            if (!objAccount || objAccount.isVerifier || !objAccount.isActive) {
                continue;
            }
            const arrImportedPositions = await listRollingFuturesLtImportedPositions(objRuntime.userId, objRuntime.strategyCode);
            const vOpenPositionCount = arrImportedPositions.filter((objPosition) => Number(objPosition.qty || 0) > 0).length;
            if (!vOpenPositionCount) {
                continue;
            }
            arrUsers.push({
                accountId: objAccount.accountId,
                fullName: objAccount.fullName,
                email: objAccount.email,
                telegramChatId: objAccount.telegramChatId,
                execStrategy: objAccount.execStrategy,
                isActive: objAccount.isActive,
                openPositionCount: vOpenPositionCount,
                lastCycleAt: objRuntime.lastCycleAt,
                updatedAt: objRuntime.updatedAt
            });
        }

        res.json({
            status: "success",
            data: arrUsers
                .filter((objUser) => String(objUser.accountId || "").trim() !== String(req.authAccount?.accountId || "").trim())
                .sort((pLeft, pRight) => String(pLeft.fullName || "").localeCompare(String(pRight.fullName || "")))
        });
    }
    catch (objError) {
        res.status(500).json({
            status: "danger",
            message: getErrorMessage(objError, `Unable to load running ${pStrategyLabel} users.`)
        });
    }
}

export async function listCoveredOptionsVerifierRunningUsers(req: Request, res: Response): Promise<void> {
    await listCoveredLikeVerifierRunningUsers(req, res, "covered-options", "Covered Options");
}

export async function listStrangleOptionsVerifierRunningUsers(req: Request, res: Response): Promise<void> {
    await listCoveredLikeVerifierRunningUsers(req, res, "strangle-options", "Strangle Options");
}

export async function enableRollingFuturesLtDualSimulatedPrimaryOutageController(req: Request, res: Response): Promise<void> {
    const vUserId = String(req.params.accountId || "").trim();
    const vEnabledByAccountId = String(getAccountId(req) || "").trim();
    if (!vUserId) {
        res.status(400).json({
            status: "warning",
            message: "Account id is required."
        });
        return;
    }

    gSimulatedPrimaryOutageUsers.set(vUserId, {
        strategyCode: "rolling-futures-lt-dual",
        enabledAt: new Date().toISOString(),
        enabledByAccountId: vEnabledByAccountId
    });
    logDualSurvivalDebug("simulated_primary_db_outage_enabled", {
        userId: vUserId,
        strategyCode: "rolling-futures-lt-dual",
        enabledByAccountId: vEnabledByAccountId
    });
    res.json({
        status: "success",
        message: "Simulated Primary DB outage enabled for this running dual strategy."
    });
}

export async function disableRollingFuturesLtDualSimulatedPrimaryOutageController(req: Request, res: Response): Promise<void> {
    const vUserId = String(req.params.accountId || "").trim();
    if (!vUserId) {
        res.status(400).json({
            status: "warning",
            message: "Account id is required."
        });
        return;
    }

    gSimulatedPrimaryOutageUsers.delete(vUserId);
    logDualSurvivalDebug("simulated_primary_db_outage_disabled", {
        userId: vUserId,
        strategyCode: "rolling-futures-lt-dual"
    });
    res.json({
        status: "success",
        message: "Simulated Primary DB outage disabled for this running dual strategy."
    });
}

export async function switchRollingFuturesLtDualBackToPrimaryController(req: Request, res: Response): Promise<void> {
    const vUserId = String(req.params.accountId || "").trim();
    if (!vUserId) {
        res.status(400).json({
            status: "warning",
            message: "Account id is required."
        });
        return;
    }

    try {
        const objSurvival = await getSurvivalState(vUserId, "rolling-futures-lt-dual");
        if (!objSurvival) {
            throw new Error("No Survival DB state was found for this running strategy.");
        }
        if (!objSurvival.selectedApiProfileId) {
            throw new Error("Survival DB does not have the selected API profile id for this strategy.");
        }
        const vHandbackTargetServerId = getPrimaryOriginServerIdFromState(objSurvival.runtimeState);
        const bHandbackPending = isPrimaryHandbackPendingState(objSurvival.runtimeState);
        let objEffectiveSurvival = objSurvival;
        if (isSurvivalLeaseActive(objSurvival)
            && (objSurvival.ownerServerId !== gServerId || objSurvival.ownerInstanceId !== gServerInstanceId)
            && bHandbackPending
            && vHandbackTargetServerId === gServerId) {
            const objForcedLease = await forceAcquireSurvivalStateLease({
                userId: vUserId,
                strategyCode: "rolling-futures-lt-dual",
                ownerServerId: gServerId,
                ownerInstanceId: gServerInstanceId,
                leaseDurationMs: getStrategyLeaseDurationMs()
            });
            if (!objForcedLease) {
                throw new Error("Unable to claim Survival DB ownership for handback on this server.");
            }
            setLocalSurvivalLeaseToken(vUserId, "rolling-futures-lt-dual", objForcedLease.leaseToken);
            objEffectiveSurvival = objForcedLease;
        }
        if (isSurvivalLeaseActive(objEffectiveSurvival)
            && (objEffectiveSurvival.ownerServerId !== gServerId || objEffectiveSurvival.ownerInstanceId !== gServerInstanceId)
            && !(bHandbackPending && vHandbackTargetServerId === gServerId)) {
            const vOwnerLabel = String(objEffectiveSurvival.ownerServerId || "another server").trim() || "another server";
            throw new Error(`This strategy is currently owned by ${vOwnerLabel}. Use Force Takeover Here on this server first.`);
        }

        const objRuntime = await loadRollingFuturesLtRuntime(vUserId, "rolling-futures-lt-dual")
            || getDefaultRollingFuturesLtRuntime(vUserId, "rolling-futures-lt-dual");
        const objProfile = await readLiveProfile(vUserId, "rolling-futures-lt-dual");
        const arrLivePositions = await fetchLiveFuturePositions(
            vUserId,
            "rolling-futures-lt-dual",
            objEffectiveSurvival.selectedApiProfileId,
            normalizeSymbolValue(objEffectiveSurvival.symbol || objEffectiveSurvival.uiState?.symbol)
        );
        const arrSaved = await replaceRollingFuturesLtImportedPositions(vUserId, "rolling-futures-lt-dual", arrLivePositions);
        const objRuntimeToSave: RollingFuturesLtRuntimeRecord = {
            ...objRuntime,
            userId: vUserId,
            strategyCode: "rolling-futures-lt-dual",
            status: "running",
            autoTraderEnabled: true,
            selectedApiProfileId: objEffectiveSurvival.selectedApiProfileId,
            currentSymbol: normalizeSymbolValue(objEffectiveSurvival.symbol || objEffectiveSurvival.uiState?.symbol),
            lastCycleAt: new Date().toISOString(),
            lastError: "",
            state: {
                ...(objEffectiveSurvival.runtimeState || {}),
                primaryDbOutageLastError: "",
                openPositions: await buildOpenPositionsPayload(vUserId, "rolling-futures-lt-dual", arrSaved)
            }
        };
        const objProfileToSave: RollingFuturesLtProfileRecord = {
            ...objProfile,
            userId: vUserId,
            strategyCode: "rolling-futures-lt-dual",
            selectedApiProfileId: objEffectiveSurvival.selectedApiProfileId,
            uiState: {
                ...getMergedUiState(objProfile),
                ...(objEffectiveSurvival.uiState || {})
            }
        };
        await saveRollingFuturesLtRuntime(objRuntimeToSave);
        await saveRollingFuturesLtProfile(objProfileToSave);

        await forceReleaseStrategyLease(vUserId, "rolling-futures-lt-dual");
        setLocalStrategyLeaseToken(vUserId, "rolling-futures-lt-dual", "");
        const objLeaseAcquire = await acquireDualStrategyLease(
            vUserId,
            "rolling-futures-lt-dual",
            objRuntimeToSave,
            objProfileToSave,
            objSurvival.selectedApiProfileId
        );
        if (!objLeaseAcquire.acquired) {
            throw new Error(objLeaseAcquire.message || `Unable to restore Primary DB ownership on ${gServerId}.`);
        }

        await upsertSurvivalState({
            userId: objEffectiveSurvival.userId,
            strategyCode: objEffectiveSurvival.strategyCode,
            strategyRunId: objEffectiveSurvival.strategyRunId,
            runTag: objEffectiveSurvival.runTag || getStrategyRunTagState(objRuntimeToSave) || "",
            runStatus: arrSaved.length ? "active" : "ended",
            ownerServerId: gServerId,
            ownerInstanceId: gServerInstanceId,
            leaseToken: getLocalSurvivalLeaseToken(vUserId, "rolling-futures-lt-dual") || objEffectiveSurvival.leaseToken,
            leaseExpiresAt: new Date(Date.now() + getStrategyLeaseDurationMs()).toISOString(),
            lastHeartbeatAt: new Date().toISOString(),
            selectedApiProfileId: objEffectiveSurvival.selectedApiProfileId,
            profileReferenceName: objEffectiveSurvival.profileReferenceName,
            apiKey: objEffectiveSurvival.apiKey,
            apiSecret: objEffectiveSurvival.apiSecret,
            symbol: objEffectiveSurvival.symbol,
            strategyStartedAt: objEffectiveSurvival.strategyStartedAt,
            lastDeltaSyncAt: objEffectiveSurvival.lastDeltaSyncAt,
            lastPrimaryDbSyncAt: new Date().toISOString(),
            openPositions: arrSaved.map((objPosition) => ({
                importId: objPosition.importId,
                contractName: objPosition.contractName,
                side: objPosition.side,
                qty: objPosition.qty,
                entryPrice: objPosition.entryPrice,
                markPrice: objPosition.markPrice,
                charges: objPosition.charges,
                pnl: objPosition.pnl,
                margin: objPosition.margin,
                liquidationPrice: objPosition.liquidationPrice,
                metadata: objPosition.metadata || {},
                openedAt: objPosition.openedAt,
                updatedAt: objPosition.updatedAt
            })),
            uiState: objEffectiveSurvival.uiState,
            runtimeState: {
                ...(objEffectiveSurvival.runtimeState || {}),
                primaryDbOutageLastError: "",
                pendingPrimaryHandback: false,
                pendingPrimaryHandbackSince: ""
            },
            riskState: objEffectiveSurvival.riskState,
            recoveryMetrics: objEffectiveSurvival.recoveryMetrics,
            lastOrderRefs: objEffectiveSurvival.lastOrderRefs
        });
        await logFuturesEvent(
            vUserId,
            "rolling-futures-lt-dual",
            "manual_action",
            "success",
            "Returned To Primary DB",
            "Admin switched this running dual strategy back to Primary DB control.",
            { reason: "admin_switch_to_primary_db" }
        );
        startAutoTraderCycle(vUserId, "rolling-futures-lt-dual");
        res.json({
            status: "success",
            message: "Strategy switched back to Primary DB control successfully."
        });
    }
    catch (objError) {
        if (isPrimaryDatabaseUnavailableError(objError)) {
            res.status(503).json({
                status: "warning",
                message: "Primary DB is still unavailable. Keep this strategy in Survival DB mode until Primary DB is restored."
            });
            return;
        }
        res.status(500).json({
            status: "danger",
            message: getErrorMessage(objError, "Unable to switch this strategy back to Primary DB.")
        });
    }
}

export async function forceRollingFuturesLtDualTakeoverHereController(req: Request, res: Response): Promise<void> {
    const vUserId = String(req.params.accountId || "").trim();
    if (!vUserId) {
        res.status(400).json({
            status: "warning",
            message: "Account id is required."
        });
        return;
    }

    try {
        let objRuntime: RollingFuturesLtRuntimeRecord | null = null;
        let objProfile: RollingFuturesLtProfileRecord | null = null;
        let vSelectedApiProfileId = "";

        try {
            objRuntime = await loadRollingFuturesLtRuntime(vUserId, "rolling-futures-lt-dual")
                || getDefaultRollingFuturesLtRuntime(vUserId, "rolling-futures-lt-dual");
            objProfile = await readLiveProfile(vUserId, "rolling-futures-lt-dual");
            vSelectedApiProfileId = String(objRuntime.selectedApiProfileId || objProfile.selectedApiProfileId || "").trim();
        }
        catch (objError) {
            if (!isPrimaryDatabaseUnavailableError(objError)) {
                throw objError;
            }

            const objSurvival = await getSurvivalState(vUserId, "rolling-futures-lt-dual");
            if (!objSurvival) {
                throw new Error("No Survival DB state was found for this running strategy.");
            }
            if (!objSurvival.selectedApiProfileId) {
                throw new Error("Survival DB does not have the selected API profile id for this strategy.");
            }
            if (isSurvivalLeaseActive(objSurvival)
                && objSurvival.ownerServerId === gServerId
                && objSurvival.ownerInstanceId === gServerInstanceId) {
                setLocalSurvivalLeaseToken(vUserId, "rolling-futures-lt-dual", objSurvival.leaseToken);
                startAutoTraderCycle(vUserId, "rolling-futures-lt-dual");
                res.json({
                    status: "success",
                    message: `This running strategy is already owned by ${gServerId} through Survival DB control.`
                });
                return;
            }

            const objAcquire = await acquireSurvivalStateLease({
                userId: vUserId,
                strategyCode: "rolling-futures-lt-dual",
                ownerServerId: gServerId,
                ownerInstanceId: gServerInstanceId,
                leaseDurationMs: getStrategyLeaseDurationMs()
            });
            if (!objAcquire.acquired || !objAcquire.state) {
                const vOwnerLabel = String(objAcquire.state?.ownerServerId || objSurvival.ownerServerId || "another server").trim() || "another server";
                throw new Error(`This running strategy is currently owned by ${vOwnerLabel}.`);
            }

            setLocalStrategyLeaseToken(vUserId, "rolling-futures-lt-dual", "");
            setLocalSurvivalLeaseToken(vUserId, "rolling-futures-lt-dual", objAcquire.state.leaseToken);
            startAutoTraderCycle(vUserId, "rolling-futures-lt-dual");
            res.json({
                status: "success",
                message: `This running strategy is now assigned to ${gServerId} through Survival DB control.`
            });
            return;
        }

        if (!vSelectedApiProfileId) {
            throw new Error("No API profile is selected for this running strategy.");
        }

        const objExistingLease = await getStrategyLease(vUserId, "rolling-futures-lt-dual");
        if (isLeaseActive(objExistingLease)
            && objExistingLease?.ownerServerId === gServerId
            && objExistingLease?.ownerInstanceId === gServerInstanceId) {
            res.json({
                status: "success",
                message: `This running strategy is already owned by ${gServerId}.`
            });
            return;
        }

        await forceReleaseStrategyLease(vUserId, "rolling-futures-lt-dual");
        setLocalStrategyLeaseToken(vUserId, "rolling-futures-lt-dual", "");
        setLocalSurvivalLeaseToken(vUserId, "rolling-futures-lt-dual", "");

        const objLeaseAcquire = await acquireDualStrategyLease(
            vUserId,
            "rolling-futures-lt-dual",
            objRuntime,
            objProfile,
            vSelectedApiProfileId
        );
        if (!objLeaseAcquire.acquired) {
            throw new Error(objLeaseAcquire.message || `Unable to assign this strategy to ${gServerId}.`);
        }

        const objSurvival = await getSurvivalState(vUserId, "rolling-futures-lt-dual");
        if (objSurvival) {
            await upsertSurvivalState({
                userId: objSurvival.userId,
                strategyCode: objSurvival.strategyCode,
                strategyRunId: objSurvival.strategyRunId,
                runTag: objSurvival.runTag,
                runStatus: objSurvival.runStatus,
                ownerServerId: gServerId,
                ownerInstanceId: gServerInstanceId,
                leaseToken: objSurvival.leaseToken,
                leaseExpiresAt: new Date(Date.now() + getStrategyLeaseDurationMs()).toISOString(),
                lastHeartbeatAt: new Date().toISOString(),
                selectedApiProfileId: objSurvival.selectedApiProfileId,
                profileReferenceName: objSurvival.profileReferenceName,
                apiKey: objSurvival.apiKey,
                apiSecret: objSurvival.apiSecret,
                symbol: objSurvival.symbol,
                strategyStartedAt: objSurvival.strategyStartedAt,
                lastDeltaSyncAt: objSurvival.lastDeltaSyncAt,
                lastPrimaryDbSyncAt: new Date().toISOString(),
                openPositions: objSurvival.openPositions,
                uiState: objSurvival.uiState,
                runtimeState: {
                    ...(objSurvival.runtimeState || {}),
                    primaryOriginServerId: getPrimaryOriginServerIdFromState(objSurvival.runtimeState),
                    pendingPrimaryHandback: isPrimaryHandbackPendingState(objSurvival.runtimeState),
                    pendingPrimaryHandbackSince: String(objSurvival.runtimeState?.pendingPrimaryHandbackSince || "").trim()
                },
                riskState: objSurvival.riskState,
                recoveryMetrics: objSurvival.recoveryMetrics,
                lastOrderRefs: objSurvival.lastOrderRefs
            });
        }

        await saveRollingFuturesLtRuntime({
            ...objRuntime,
            userId: vUserId,
            strategyCode: "rolling-futures-lt-dual",
            status: "running",
            autoTraderEnabled: true,
            selectedApiProfileId: vSelectedApiProfileId,
            currentSymbol: String(objRuntime?.currentSymbol || getMergedUiState(objProfile || getDefaultRollingFuturesLtProfile(vUserId, "rolling-futures-lt-dual")).symbol || "").trim(),
            lastError: ""
        });
        startAutoTraderCycle(vUserId, "rolling-futures-lt-dual");
        await logFuturesEvent(
            vUserId,
            "rolling-futures-lt-dual",
            "manual_action",
            "warning",
            "Forced Takeover Assigned",
            `Admin assigned this running dual strategy to ${gServerId}.`,
            {
                reason: "admin_force_takeover_here",
                targetServerId: gServerId
            }
        );
        res.json({
            status: "success",
            message: `This running strategy is now assigned to ${gServerId}.`
        });
    }
    catch (objError) {
        res.status(500).json({
            status: "danger",
            message: getErrorMessage(objError, `Unable to assign this strategy to ${gServerId}.`)
        });
    }
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
export async function calculateRollingFuturesLtDualRecommendedStartQty(req: Request, res: Response): Promise<void> {
    await calculateRecommendedStartQtyInternal(req, res, "rolling-futures-lt-dual");
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

export async function executePendingRollingFuturesLtDualStrategyRequest(req: Request, res: Response): Promise<void> {
    const vRequestId = String(req.params.requestId || "").trim();
    if (!vRequestId) {
        res.status(400).json({ status: "warning", message: "Execution request id is required." });
        return;
    }

    try {
        const objRequest = await getPendingStrategyExecutionRequestById(vRequestId);
        if (!objRequest) {
            res.status(404).json({ status: "warning", message: "Execution request was not found." });
            return;
        }

        if (objRequest.strategyCode !== "rolling-futures-lt-dual") {
            res.status(400).json({ status: "warning", message: "Only Dual live strategy requests can be executed here." });
            return;
        }
        const objExecResult = await executePendingDualStrategyRequestByRecord(objRequest);

        await deletePendingStrategyExecutionRequest(vRequestId);
        res.json({
            status: "success",
            message: `Exec Strategy placed ${objExecResult.orders.length} option order${objExecResult.orders.length === 1 ? "" : "s"} using ${objExecResult.profileLabel}.`,
            data: {
                requestId: vRequestId,
                accountId: objRequest.accountId,
                fullName: objRequest.fullName,
                email: objRequest.email
            }
        });
    }
    catch (objError) {
        const vMessage = getErrorMessage(objError, "Unable to execute the pending live strategy request.");
        const vStatusCode = /currently owned by/i.test(vMessage) ? 409 : 500;
        res.status(vStatusCode).json({
            status: "danger",
            message: vMessage
        });
    }
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
export async function recalculateRollingFuturesLtDualRecoveryTotalPnl(req: Request, res: Response): Promise<void> {
    await recalculateRecoveryTotalPnlInternal(req, res, "rolling-futures-lt-dual");
}

async function respondOptionsScalperPaperActionNotReady(
    req: Request,
    res: Response,
    pMessage: string
): Promise<void> {
    const vUserId = getAccountId(req);
    await logFuturesEvent(
        vUserId,
        "options-scalper",
        "manual_action",
        "warning",
        "Paper Action Not Wired Yet",
        pMessage,
        {
            reason: "options_scalper_paper_action_not_wired"
        }
    );
    res.status(400).json({
        status: "warning",
        message: pMessage
    });
}

export async function getCoveredOptionsProfile(req: Request, res: Response): Promise<void> {
    await getProfileInternal(req, res, "covered-options");
}
export async function saveCoveredOptionsProfile(req: Request, res: Response): Promise<void> {
    await saveProfileInternal(req, res, "covered-options");
}
export async function getCoveredOptionsConnectionStatus(req: Request, res: Response): Promise<void> {
    await getConnectionStatusInternal(req, res, "covered-options");
}
export async function getCoveredOptionsRuntimeStatus(req: Request, res: Response): Promise<void> {
    await getRuntimeStatusInternal(req, res, "covered-options");
}
export async function checkCoveredOptionsConnection(req: Request, res: Response): Promise<void> {
    await checkConnectionInternal(req, res, "covered-options");
}
export async function enableCoveredOptionsAutoTrader(req: Request, res: Response): Promise<void> {
    await enableAutoTraderInternal(req, res, "covered-options");
}
export async function disableCoveredOptionsAutoTrader(req: Request, res: Response): Promise<void> {
    await disableAutoTraderInternal(req, res, "covered-options");
}
export async function getCoveredOptionsAccountSummary(req: Request, res: Response): Promise<void> {
    await getAccountSummaryInternal(req, res, "covered-options");
}
export async function calculateCoveredOptionsRecommendedStartQty(req: Request, res: Response): Promise<void> {
    await calculateRecommendedStartQtyInternal(req, res, "covered-options");
}
export async function executeCoveredOptionsManualFuture(req: Request, res: Response): Promise<void> {
    await executeManualFutureInternal(req, res, "covered-options");
}
export async function executeCoveredOptionsManualOption(req: Request, res: Response): Promise<void> {
    await executeManualOptionInternal(req, res, "covered-options");
}
export async function executeCoveredOptionsStrategy(req: Request, res: Response): Promise<void> {
    await executeStrategyInternal(req, res, "covered-options");
}
export async function confirmCoveredOptionsLiveAction(req: Request, res: Response): Promise<void> {
    await confirmCoveredLiveActionInternal(req, res, "covered-options");
}
export async function rejectCoveredOptionsLiveAction(req: Request, res: Response): Promise<void> {
    await rejectCoveredLiveActionInternal(req, res, "covered-options");
}
export async function getStrangleOptionsProfile(req: Request, res: Response): Promise<void> {
    await getProfileInternal(req, res, "strangle-options");
}
export async function saveStrangleOptionsProfile(req: Request, res: Response): Promise<void> {
    await saveProfileInternal(req, res, "strangle-options");
}
export async function getStrangleOptionsConnectionStatus(req: Request, res: Response): Promise<void> {
    await getConnectionStatusInternal(req, res, "strangle-options");
}
export async function getStrangleOptionsRuntimeStatus(req: Request, res: Response): Promise<void> {
    await getRuntimeStatusInternal(req, res, "strangle-options");
}
export async function checkStrangleOptionsConnection(req: Request, res: Response): Promise<void> {
    await checkConnectionInternal(req, res, "strangle-options");
}
export async function enableStrangleOptionsAutoTrader(req: Request, res: Response): Promise<void> {
    await enableAutoTraderInternal(req, res, "strangle-options");
}
export async function disableStrangleOptionsAutoTrader(req: Request, res: Response): Promise<void> {
    await disableAutoTraderInternal(req, res, "strangle-options");
}
export async function getStrangleOptionsAccountSummary(req: Request, res: Response): Promise<void> {
    await getAccountSummaryInternal(req, res, "strangle-options");
}
export async function calculateStrangleOptionsRecommendedStartQty(req: Request, res: Response): Promise<void> {
    await calculateRecommendedStartQtyInternal(req, res, "strangle-options");
}
export async function executeStrangleOptionsManualFuture(req: Request, res: Response): Promise<void> {
    await executeManualFutureInternal(req, res, "strangle-options");
}
export async function executeStrangleOptionsManualOption(req: Request, res: Response): Promise<void> {
    await executeManualOptionInternal(req, res, "strangle-options");
}
export async function executeStrangleOptionsStrategy(req: Request, res: Response): Promise<void> {
    await executeStrategyInternal(req, res, "strangle-options");
}
export async function confirmStrangleOptionsLiveAction(req: Request, res: Response): Promise<void> {
    await confirmCoveredLiveActionInternal(req, res, "strangle-options");
}
export async function rejectStrangleOptionsLiveAction(req: Request, res: Response): Promise<void> {
    await rejectCoveredLiveActionInternal(req, res, "strangle-options");
}
export async function listAdminPendingCoveredLikeLiveActions(req: Request, res: Response): Promise<void> {
    const arrRuntimeRows = await listRollingFuturesLtRuntime();
    const arrPending = await Promise.all(arrRuntimeRows
        .filter((objRuntime) => objRuntime.strategyCode === "covered-options" || objRuntime.strategyCode === "strangle-options")
        .map(async (objRuntime) => {
            const objPending = getCoveredLiveConfirmationState(objRuntime);
            if (!objPending) {
                return null;
            }
            const objAccount = await getAccountById(objRuntime.userId);
            if (!objAccount) {
                return null;
            }
            const objPayload = objPending.payload && typeof objPending.payload === "object"
                ? objPending.payload
                : {};
            const arrInputs = Array.isArray(objPayload.inputs)
                ? objPayload.inputs as Array<Record<string, unknown>>
                : [];
            const vContractName = String(
                objPayload.contractName
                || objPayload.closedContractName
                || ""
            ).trim();
            const vSymbol = String(
                objPayload.symbol
                || arrInputs[0]?.symbol
                || objRuntime.currentSymbol
                || ""
            ).trim().toUpperCase();
            const vReason = String(objPayload.reason || "").trim().toLowerCase();
            const vTypeLabel = objPending.kind === "option_rule_close"
                ? (vReason === "sl"
                    ? "SL Trigger"
                    : (vReason === "tp"
                        ? "TP Trigger"
                        : (vReason === "expiry_cutoff" ? "Replacement Ready" : "Close Trigger")))
                : (objPending.kind === "exec_batch"
                    ? "Exec Strategy"
                    : (objPending.kind === "covered_reentry"
                        ? "Re-entry Ready"
                        : (objPending.kind === "manual_swap" ? "Replacement Ready" : "Live Action")));
            const vDetails = objPending.kind === "exec_batch"
                ? `Ready to place ${Math.max(1, arrInputs.length)} row${Math.max(1, arrInputs.length) === 1 ? "" : "s"}${vSymbol ? ` for ${vSymbol}` : ""}.`
                : objPending.message;
            return {
                actionId: objPending.actionId,
                accountId: objAccount.accountId,
                fullName: objAccount.fullName,
                email: objAccount.email,
                mobileNo: objAccount.mobileNo,
                telegramChatId: objAccount.telegramChatId,
                strategyCode: objRuntime.strategyCode,
                strategyLabel: getCoveredLikeStrategyLabel(objRuntime.strategyCode),
                kind: objPending.kind,
                typeLabel: vTypeLabel,
                title: objPending.title,
                message: objPending.message,
                details: vDetails,
                contractName: vContractName,
                symbol: vSymbol,
                rowIndex: Number(objPayload.rowIndex || 0) || null,
                legSide: String(objPayload.legSide || "").trim().toUpperCase(),
                reason: vReason,
                createdAt: objPending.createdAt,
                autoTraderEnabled: Boolean(objRuntime.autoTraderEnabled),
                runtimeStatus: String(objRuntime.status || "").trim().toLowerCase()
            };
        }));

    res.json({
        status: "success",
        data: arrPending
            .filter(Boolean)
            .sort((left, right) => new Date(String(left?.createdAt || "")).getTime() - new Date(String(right?.createdAt || "")).getTime())
    });
}
export async function confirmAdminPendingCoveredLikeLiveAction(req: Request, res: Response): Promise<void> {
    const vAccountId = String(req.body?.accountId || "").trim();
    const vStrategyCode = String(req.body?.strategyCode || "").trim() as RollingFuturesLtStrategyCode;
    const vActionId = String(req.body?.actionId || "").trim();
    if (!vAccountId || (vStrategyCode !== "covered-options" && vStrategyCode !== "strangle-options")) {
        res.status(400).json({ status: "warning", message: "Valid account and strategy are required." });
        return;
    }
    const objResult = await processCoveredLiveActionDecision(vAccountId, vStrategyCode, "confirm", vActionId);
    res.status(objResult.status === "danger" ? 500 : (objResult.status === "warning" ? 400 : 200)).json(objResult);
}
export async function rejectAdminPendingCoveredLikeLiveAction(req: Request, res: Response): Promise<void> {
    const vAccountId = String(req.body?.accountId || "").trim();
    const vStrategyCode = String(req.body?.strategyCode || "").trim() as RollingFuturesLtStrategyCode;
    const vActionId = String(req.body?.actionId || "").trim();
    if (!vAccountId || (vStrategyCode !== "covered-options" && vStrategyCode !== "strangle-options")) {
        res.status(400).json({ status: "warning", message: "Valid account and strategy are required." });
        return;
    }
    const objResult = await processCoveredLiveActionDecision(vAccountId, vStrategyCode, "reject", vActionId);
    res.status(objResult.status === "danger" ? 500 : (objResult.status === "warning" ? 400 : 200)).json(objResult);
}
export async function handleTelegramWebhook(req: Request, res: Response): Promise<void> {
    await handleTelegramWebhookInternal(req, res);
}
export async function getCoveredOptionsImportableOpenPositions(req: Request, res: Response): Promise<void> {
    await getImportableOpenPositionsInternal(req, res, "covered-options");
}
export async function getCoveredOptionsOpenPositions(req: Request, res: Response): Promise<void> {
    await getOpenPositionsInternal(req, res, "covered-options");
}
export async function saveCoveredOptionsOpenPositions(req: Request, res: Response): Promise<void> {
    await saveOpenPositionsInternal(req, res, "covered-options");
}
export async function deleteCoveredOptionsOpenPosition(req: Request, res: Response): Promise<void> {
    await deleteOpenPositionInternal(req, res, "covered-options");
}
export async function clearCoveredOptionsOpenPositions(req: Request, res: Response): Promise<void> {
    await clearOpenPositionsInternal(req, res, "covered-options");
}
export async function reconcileCoveredOptionsOpenPositions(req: Request, res: Response): Promise<void> {
    await reconcileOpenPositionsInternal(req, res, "covered-options");
}
export async function closeCoveredOptionsImportedOpenPosition(req: Request, res: Response): Promise<void> {
    await closeImportedOpenPositionInternal(req, res, "covered-options");
}
export async function swapCoveredOptionsImportedOpenPosition(req: Request, res: Response): Promise<void> {
    await swapCoveredOpenPositionInternal(req, res);
}
export async function getCoveredOptionsClosedPositions(req: Request, res: Response): Promise<void> {
    await getClosedPositionsInternal(req, res, "covered-options");
}
export async function getStrangleOptionsImportableOpenPositions(req: Request, res: Response): Promise<void> {
    await getImportableOpenPositionsInternal(req, res, "strangle-options");
}
export async function getStrangleOptionsOpenPositions(req: Request, res: Response): Promise<void> {
    await getOpenPositionsInternal(req, res, "strangle-options");
}
export async function saveStrangleOptionsOpenPositions(req: Request, res: Response): Promise<void> {
    await saveOpenPositionsInternal(req, res, "strangle-options");
}
export async function deleteStrangleOptionsOpenPosition(req: Request, res: Response): Promise<void> {
    await deleteOpenPositionInternal(req, res, "strangle-options");
}
export async function clearStrangleOptionsOpenPositions(req: Request, res: Response): Promise<void> {
    await clearOpenPositionsInternal(req, res, "strangle-options");
}
export async function reconcileStrangleOptionsOpenPositions(req: Request, res: Response): Promise<void> {
    await reconcileOpenPositionsInternal(req, res, "strangle-options");
}
export async function closeStrangleOptionsImportedOpenPosition(req: Request, res: Response): Promise<void> {
    await closeImportedOpenPositionInternal(req, res, "strangle-options");
}
export async function swapStrangleOptionsImportedOpenPosition(req: Request, res: Response): Promise<void> {
    await swapCoveredOpenPositionInternal(req, res);
}
export async function getStrangleOptionsClosedPositions(req: Request, res: Response): Promise<void> {
    await getClosedPositionsInternal(req, res, "strangle-options");
}
export async function getCoveredOptionsEvents(req: Request, res: Response): Promise<void> {
    await getEventsInternal(req, res, "covered-options");
}
export async function getStrangleOptionsEvents(req: Request, res: Response): Promise<void> {
    await getEventsInternal(req, res, "strangle-options");
}
export async function clearCoveredOptionsEventsController(req: Request, res: Response): Promise<void> {
    await clearEventsInternal(req, res, "covered-options");
}
export async function clearStrangleOptionsEventsController(req: Request, res: Response): Promise<void> {
    await clearEventsInternal(req, res, "strangle-options");
}
export async function deleteCoveredOptionsEventController(req: Request, res: Response): Promise<void> {
    await deleteEventInternal(req, res, "covered-options");
}
export async function deleteStrangleOptionsEventController(req: Request, res: Response): Promise<void> {
    await deleteEventInternal(req, res, "strangle-options");
}
export async function executeCoveredOptionsKillSwitch(req: Request, res: Response): Promise<void> {
    await executeKillSwitchInternal(req, res, "covered-options");
}
export async function executeStrangleOptionsKillSwitch(req: Request, res: Response): Promise<void> {
    await executeKillSwitchInternal(req, res, "strangle-options");
}
export async function updateCoveredOptionsRecoveryMetrics(req: Request, res: Response): Promise<void> {
    await updateRecoveryMetricsInternal(req, res, "covered-options");
}
export async function updateStrangleOptionsRecoveryMetrics(req: Request, res: Response): Promise<void> {
    await updateRecoveryMetricsInternal(req, res, "strangle-options");
}
export async function recalculateCoveredOptionsRecoveryTotalPnl(req: Request, res: Response): Promise<void> {
    await recalculateRecoveryTotalPnlInternal(req, res, "covered-options");
}
export async function recalculateStrangleOptionsRecoveryTotalPnl(req: Request, res: Response): Promise<void> {
    await recalculateRecoveryTotalPnlInternal(req, res, "strangle-options");
}

export async function getOptionsScalperProfile(req: Request, res: Response): Promise<void> {
    await getProfileInternal(req, res, "options-scalper");
}
export async function saveOptionsScalperProfile(req: Request, res: Response): Promise<void> {
    await saveProfileInternal(req, res, "options-scalper");
}
export async function getOptionsScalperConnectionStatus(req: Request, res: Response): Promise<void> {
    await getConnectionStatusInternal(req, res, "options-scalper");
}
export async function getOptionsScalperRuntimeStatus(req: Request, res: Response): Promise<void> {
    await getRuntimeStatusInternal(req, res, "options-scalper");
}
export async function checkOptionsScalperConnection(req: Request, res: Response): Promise<void> {
    await checkConnectionInternal(req, res, "options-scalper");
}
export async function enableOptionsScalperAutoTrader(req: Request, res: Response): Promise<void> {
    await enableAutoTraderInternal(req, res, "options-scalper");
}
export async function disableOptionsScalperAutoTrader(req: Request, res: Response): Promise<void> {
    await disableAutoTraderInternal(req, res, "options-scalper");
}
export async function getOptionsScalperAccountSummary(req: Request, res: Response): Promise<void> {
    await getAccountSummaryInternal(req, res, "options-scalper");
}
export async function getOptionsScalperIndicator(req: Request, res: Response): Promise<void> {
    try {
        const vUserId = getAccountId(req);
        const objProfile = await readLiveProfile(vUserId, "options-scalper");
        const objUiState = getMergedUiState(objProfile);
        const vSelectedSymbol = normalizeSymbolValue(req.query?.symbol || req.body?.symbol || objUiState.symbol);
        const objIndicator = await getOptionsDemoOiIndicatorSummary(vSelectedSymbol);
        res.json({
            status: "success",
            data: objIndicator
        });
    }
    catch (objError) {
        res.status(500).json({
            status: "danger",
            message: getErrorMessage(objError, "Unable to fetch options demo indicator.")
        });
    }
}
export async function calculateOptionsScalperRecommendedStartQty(req: Request, res: Response): Promise<void> {
    await calculateRecommendedStartQtyInternal(req, res, "options-scalper");
}
export async function executeOptionsScalperManualFuture(req: Request, res: Response): Promise<void> {
    await respondOptionsScalperPaperActionNotReady(req, res, "Options Demo paper future entries are not wired yet.");
}
export async function executeOptionsScalperManualOption(req: Request, res: Response): Promise<void> {
    await executeManualOptionInternal(req, res, "options-scalper");
}
export async function executeOptionsScalperStrategy(req: Request, res: Response): Promise<void> {
    await executeStrategyInternal(req, res, "options-scalper");
}
export async function confirmOptionsScalperLiveAction(req: Request, res: Response): Promise<void> {
    res.status(400).json({
        status: "warning",
        message: "Paper actions do not need confirmation on Options Demo."
    });
}
export async function rejectOptionsScalperLiveAction(req: Request, res: Response): Promise<void> {
    res.status(400).json({
        status: "warning",
        message: "Paper actions do not need confirmation on Options Demo."
    });
}
export async function getOptionsScalperImportableOpenPositions(req: Request, res: Response): Promise<void> {
    await getImportableOpenPositionsInternal(req, res, "options-scalper");
}
export async function getOptionsScalperOpenPositions(req: Request, res: Response): Promise<void> {
    await getOpenPositionsInternal(req, res, "options-scalper");
}
export async function saveOptionsScalperOpenPositions(req: Request, res: Response): Promise<void> {
    await saveOpenPositionsInternal(req, res, "options-scalper");
}
export async function deleteOptionsScalperOpenPosition(req: Request, res: Response): Promise<void> {
    await deleteOpenPositionInternal(req, res, "options-scalper");
}
export async function clearOptionsScalperOpenPositions(req: Request, res: Response): Promise<void> {
    await clearOpenPositionsInternal(req, res, "options-scalper");
}
export async function reconcileOptionsScalperOpenPositions(req: Request, res: Response): Promise<void> {
    await reconcileOpenPositionsInternal(req, res, "options-scalper");
}
export async function closeOptionsScalperImportedOpenPosition(req: Request, res: Response): Promise<void> {
    await closeImportedOpenPositionInternal(req, res, "options-scalper");
}
export async function getOptionsScalperClosedPositions(req: Request, res: Response): Promise<void> {
    await getClosedPositionsInternal(req, res, "options-scalper");
}
export async function getOptionsScalperEvents(req: Request, res: Response): Promise<void> {
    await getEventsInternal(req, res, "options-scalper");
}
export async function clearOptionsScalperEventsController(req: Request, res: Response): Promise<void> {
    await clearEventsInternal(req, res, "options-scalper");
}
export async function deleteOptionsScalperEventController(req: Request, res: Response): Promise<void> {
    await deleteEventInternal(req, res, "options-scalper");
}
export async function executeOptionsScalperKillSwitch(req: Request, res: Response): Promise<void> {
    await executeKillSwitchInternal(req, res, "options-scalper");
}
export async function updateOptionsScalperRecoveryMetrics(req: Request, res: Response): Promise<void> {
    await updateRecoveryMetricsInternal(req, res, "options-scalper");
}
export async function recalculateOptionsScalperRecoveryTotalPnl(req: Request, res: Response): Promise<void> {
    await recalculateRecoveryTotalPnlInternal(req, res, "options-scalper");
}
