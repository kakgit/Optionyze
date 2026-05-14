import crypto from "node:crypto";
import type { Request, Response } from "express";
const DeltaRestClient = require("delta-rest-client");
import type { RollingOptionsLtDeService } from "../../strategies/rolling-options-lt-de/service";
import { getAccountById } from "../../storage/accounts-store";
import { getDeltaApiProfile } from "../../storage/delta-api-profile-store";
import {
    getDefaultRollingOptionsLtDeProfile,
    loadRollingOptionsLtDeProfile,
    saveRollingOptionsLtDeProfile,
    type RollingOptionsLtDeConnectionStatus
} from "../../storage/rolling-options-lt-de-profile-store";
import {
    loadRollingOptionsLtDeRuntime,
    saveRollingOptionsLtDeRuntime
} from "../../storage/rolling-options-lt-de-runtime-store";
import {
    deleteRollingOptionsLtDeImportedPosition,
    listRollingOptionsLtDeImportedPositions,
    replaceRollingOptionsLtDeImportedPositions,
    type RollingOptionsLtDeImportedPositionRecord,
    type RollingOptionsLtDePositionMetadata
} from "../../storage/rolling-options-lt-de-position-store";
import {
    clearRollingOptionsEventsByStrategy,
    listRollingOptionsEventsByStrategy
} from "../../storage/rolling-options-pt-de-event-store";
import { gRollingOptionsTelegramEventTypes, logRollingOptionsLtDeEvent } from "../../strategies/rolling-options-lt-de/event-logger";
import { findBestLiveOptionContract, getLiveMarketSnapshot, getLiveOptionTicker } from "../../strategies/rolling-options-pt-de/market-data";
import { buildConfigFromUiState } from "../../strategies/rolling-options-pt-de/engine";

interface DeltaWalletBalanceRow {
    asset_symbol?: string;
    symbol?: string;
    available_balance?: number | string | null;
    balance?: number | string | null;
    wallet_balance?: number | string | null;
    total_margin?: number | string | null;
    total_margin_inr?: number | string | null;
    available_balance_inr?: number | string | null;
    balance_inr?: number | string | null;
    wallet_balance_inr?: number | string | null;
    blocked_margin_inr?: number | string | null;
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
    product?: {
        contract_value?: number | string | null;
        [key: string]: unknown;
    } | null;
    meta_data?: {
        pnl?: number | string | null;
        cashflow?: number | string | null;
        order_type?: string;
        order_price?: number | string | null;
        [key: string]: unknown;
    } | null;
    [key: string]: unknown;
}

function getAccountId(req: Request): string {
    return String(req.authAccount?.accountId || "").trim();
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
                const objParsed = JSON.parse(vText);
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
    state: RollingOptionsLtDeConnectionStatus["state"];
    message: string;
    outboundIp: string;
}> {
    const vRawMessage = getErrorMessage(pError, "Error testing Delta connection.");
    const vNormalized = vRawMessage.toLowerCase();
    const objDeltaPayload = getDeltaErrorPayload(pError);
    const vDeltaCode = String(objDeltaPayload?.error?.code || "").trim();
    const vDeltaClientIp = String(objDeltaPayload?.error?.context?.client_ip || "").trim();
    const vOutboundIp = vDeltaClientIp || await getOutboundPublicIp();

    if (vDeltaCode === "ip_not_whitelisted_for_api_key") {
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

async function sendTelegramConnectionAlert(
    pUserId: string,
    pProfileName: string,
    pStatus: RollingOptionsLtDeConnectionStatus
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

    const arrLines = [
        "Rolling Options - Live",
        "Delta API connection warning",
        `API Name: ${pProfileName || "-"}`,
        `Status: ${pStatus.state}`,
        `Message: ${pStatus.message || "-"}`,
        `Last Checked: ${pStatus.lastCheckedAt || "-"}`
    ];
    if (pStatus.outboundIp) {
        arrLines.push(`Whitelist this server IP in Delta: ${pStatus.outboundIp}`);
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

async function readLiveProfile(pUserId: string) {
    return await loadRollingOptionsLtDeProfile(pUserId) || getDefaultRollingOptionsLtDeProfile(pUserId);
}

async function syncLiveRuntimeProfileSelection(pUserId: string, pSelectedApiProfileId: string) {
    const objExisting = await loadRollingOptionsLtDeRuntime(pUserId);
    return saveRollingOptionsLtDeRuntime({
        userId: pUserId,
        status: objExisting?.status || "idle",
        autoTraderEnabled: objExisting?.autoTraderEnabled || false,
        selectedApiProfileId: String(pSelectedApiProfileId || "").trim(),
        currentSymbol: objExisting?.currentSymbol || "",
        currentContractName: objExisting?.currentContractName || "",
        currentExpiryMode: objExisting?.currentExpiryMode || "",
        currentExpiryDate: objExisting?.currentExpiryDate || "",
        renkoEnabled: objExisting?.renkoEnabled || false,
        renkoPoints: objExisting?.renkoPoints || 0,
        renkoSource: objExisting?.renkoSource || "",
        lastSpotPrice: objExisting?.lastSpotPrice ?? null,
        lastFuturesPrice: objExisting?.lastFuturesPrice ?? null,
        lastSignal: objExisting?.lastSignal || "IDLE",
        lastCycleAt: objExisting?.lastCycleAt || "",
        lastError: objExisting?.lastError || "",
        state: objExisting?.state || {},
        updatedAt: ""
    });
}

async function getDeltaClientForAccountId(pAccountId: string, pProfileId: string) {
    const vAccountId = String(pAccountId || "").trim();
    if (!vAccountId) {
        throw new Error("Please sign in to continue.");
    }

    const objProfile = await getDeltaApiProfile(vAccountId, pProfileId);
    if (!objProfile) {
        throw new Error("Delta API profile not found.");
    }

    const objClient = await new DeltaRestClient(objProfile.apiKey, objProfile.apiSecret);
    return {
        client: objClient,
        profile: objProfile
    };
}

async function resolveProfileId(req: Request): Promise<string> {
    const vQueryProfileId = String(req.query?.profileId || req.body?.profileId || "").trim();
    if (vQueryProfileId) {
        return vQueryProfileId;
    }

    const objProfile = await readLiveProfile(getAccountId(req));
    return String(objProfile.selectedApiProfileId || "").trim();
}

async function getDeltaClientForProfile(req: Request, pProfileId: string) {
    return getDeltaClientForAccountId(getAccountId(req), pProfileId);
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

    return toFiniteNumber(
        pRow.available_balance ?? pRow.wallet_balance ?? pRow.balance,
        0
    );
}

function getTotalBalanceUsd(pRow: DeltaWalletBalanceRow | null): number {
    if (!pRow) {
        return 0;
    }

    return toFiniteNumber(
        pRow.total_margin ?? pRow.balance ?? pRow.wallet_balance,
        Number.NaN
    ) || Math.max(0, getAvailableBalanceUsd(pRow) + getBlockedMarginUsd(pRow));
}

function getBlockedMarginUsd(pRow: DeltaWalletBalanceRow | null): number {
    if (!pRow) {
        return 0;
    }

    const vExplicitBlocked = toFiniteNumber(
        pRow.blocked_margin ?? pRow.position_margin ?? pRow.order_margin,
        Number.NaN
    );
    if (Number.isFinite(vExplicitBlocked)) {
        return vExplicitBlocked;
    }

    const vBalance = toFiniteNumber(pRow.balance ?? pRow.wallet_balance, 0);
    const vAvailable = getAvailableBalanceUsd(pRow);
    return Math.max(0, vBalance - vAvailable);
}

function isFutureContractSymbol(pValue: unknown): boolean {
    const vSymbol = String(pValue || "").trim().toUpperCase();
    return Boolean(vSymbol) && !vSymbol.startsWith("C-") && !vSymbol.startsWith("P-");
}

function getSelectedFuturePositionValue(
    pRows: DeltaPositionRow[],
    pSelectedSymbol: string,
    pLivePrice: number
): number {
    const vSymbol = String(pSelectedSymbol || "").trim().toUpperCase();
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

        const vMarkPrice = toFiniteNumber(pRow.mark_price, Number.NaN);
        const vEntryPrice = toFiniteNumber(pRow.entry_price, Number.NaN);
        const vPrice = Number.isFinite(vMarkPrice) && vMarkPrice > 0
            ? vMarkPrice
            : (Number.isFinite(pLivePrice) && pLivePrice > 0 ? pLivePrice : vEntryPrice);
        if (!(Number.isFinite(vPrice) && vPrice > 0)) {
            return pSum;
        }

        return pSum + (vQty * vFallbackLotSize * vPrice);
    }, 0);
}

function mapLivePosition(pRow: DeltaPositionRow, pIndex: number) {
    const vNetSize = toFiniteNumber(pRow.net_size ?? pRow.size, 0);
    const vSide = vNetSize < 0 ? "SELL" : "BUY";

    return {
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
        openedAt: new Date().toISOString()
    };
}

function toEpochMicros(pDateValue: string, pEndOfMinute = false): number | null {
    const vValue = String(pDateValue || "").trim();
    if (!vValue) {
        return null;
    }

    const objDate = new Date(vValue);
    if (Number.isNaN(objDate.getTime())) {
        const arrParts = vValue.split(/[T\s-:]/);
        if (arrParts.length >= 5) {
            const vYear = parseInt(arrParts[0], 10);
            const vMonth = parseInt(arrParts[1], 10) - 1;
            const vDay = parseInt(arrParts[2], 10);
            const vHour = parseInt(arrParts[3], 10) || 0;
            const vMin = parseInt(arrParts[4], 10) || 0;
            const vSec = pEndOfMinute ? 59 : (parseInt(arrParts[5], 10) || 0);
            const vMs = pEndOfMinute ? 999 : 0;
            return new Date(vYear, vMonth, vDay, vHour, vMin, vSec, vMs).getTime() * 1000;
        }
        return null;
    }

    if (pEndOfMinute) {
        objDate.setSeconds(59, 999);
    }

    return objDate.getTime() * 1000;
}

function formatOrderType(pValue: unknown): string {
    const vValue = String(pValue || "").trim();
    if (!vValue) {
        return "-";
    }
    return vValue.replaceAll("_", " ");
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
        orderId: String(pRow.order_id || ""),
        symbol: String(pRow.product_symbol || "-"),
        side: vSide || "-",
        qty: vQty,
        buyPrice: vSide === "BUY" ? vPrice : null,
        sellPrice: vSide === "SELL" ? vPrice : null,
        price: vPrice,
        charges: vCommission,
        pnl: Number.isFinite(vPnl) ? vPnl : null,
        startAt: vCreatedAt,
        endAt: vUpdatedAt,
        orderType: formatOrderType(pRow.meta_data?.order_type)
    };
}

function getContractNameForSymbol(pSymbol: string): string {
    return String(pSymbol || "").trim().toUpperCase() === "ETH" ? "ETHUSD" : "BTCUSD";
}

function getLotSizeForSymbol(pSymbol: string): number {
    return String(pSymbol || "").trim().toUpperCase() === "ETH" ? 0.01 : 0.001;
}

function formatIsoDate(pDateValue: Date): string {
    const vYear = String(pDateValue.getFullYear());
    const vMonth = String(pDateValue.getMonth() + 1).padStart(2, "0");
    const vDay = String(pDateValue.getDate()).padStart(2, "0");
    return `${vYear}-${vMonth}-${vDay}`;
}

function resolveLiveExpiryDateByMode(pExpiryMode: string): string {
    const vMode = String(pExpiryMode || "1").trim();
    const objDate = new Date();
    const vDayOfWeek = objDate.getDay();

    if (vMode === "1") {
        objDate.setDate(objDate.getDate() + 1);
        return formatIsoDate(objDate);
    }
    if (vMode === "2") {
        objDate.setDate(objDate.getDate() + 2);
        return formatIsoDate(objDate);
    }
    if (vMode === "4") {
        const vDaysToFriday = (5 - vDayOfWeek + 7) % 7;
        objDate.setDate(objDate.getDate() + (vDayOfWeek >= 2 ? vDaysToFriday + 7 : vDaysToFriday));
        return formatIsoDate(objDate);
    }
    if (vMode === "5") {
        const vDaysToFriday = (5 - vDayOfWeek + 7) % 7;
        objDate.setDate(objDate.getDate() + (vDayOfWeek >= 2 ? vDaysToFriday + 14 : vDaysToFriday + 7));
        return formatIsoDate(objDate);
    }
    if (vMode === "6") {
        const getLastFridayOfMonth = (pYear: number, pMonthIndex: number): Date => {
            const objLastDay = new Date(pYear, pMonthIndex + 1, 0);
            while (objLastDay.getDay() !== 5) {
                objLastDay.setDate(objLastDay.getDate() - 1);
            }
            return objLastDay;
        };
        const objLastFriday = getLastFridayOfMonth(objDate.getFullYear(), objDate.getMonth());
        const objNextLastFriday = getLastFridayOfMonth(objDate.getFullYear(), objDate.getMonth() + 1);
        return formatIsoDate(objDate.getDate() > 15 ? objNextLastFriday : objLastFriday);
    }

    return formatIsoDate(objDate);
}

function getDefaultLiveUiState(): Record<string, unknown> {
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
        renkoFeedPts: 10,
        closedFromDate: "",
        closedToDate: "",
        telegramAlertsEnabled: false,
        telegramAlertTypes: [...gRollingOptionsTelegramEventTypes]
    };
}

function normalizeLiveNumber(pValue: unknown, pFallback: number): number {
    const vNumber = Number(pValue);
    return Number.isFinite(vNumber) ? vNumber : pFallback;
}

function sanitizeLiveUiState(pUiState?: Record<string, unknown> | null): Record<string, unknown> {
    const objUiState = pUiState && typeof pUiState === "object" ? pUiState : {};
    const {
        reDelta1: _legacyReDelta1,
        deltaTp1: _legacyDeltaTp1,
        deltaSl1: _legacyDeltaSl1,
        ...objSanitized
    } = objUiState;
    return objSanitized;
}

function normalizeLiveUiState(pUiState?: Record<string, unknown> | null): Record<string, unknown> {
    const objUiState = pUiState && typeof pUiState === "object" ? { ...pUiState } : {};
    if (!Number.isFinite(Number(objUiState.redOptQtyPct))) {
        objUiState.redOptQtyPct = normalizeLiveNumber(objUiState.autoOptQtyPct, 100);
    }
    if (!Number.isFinite(Number(objUiState.greenOptQtyPct))) {
        objUiState.greenOptQtyPct = 100;
    }
    if (!Number.isFinite(Number(objUiState.reRedDelta))) {
        objUiState.reRedDelta = normalizeLiveNumber(objUiState.reDelta1, 0.53);
    }
    if (!Number.isFinite(Number(objUiState.redTpDelta))) {
        objUiState.redTpDelta = normalizeLiveNumber(objUiState.deltaTp1, 0.15);
    }
    if (!Number.isFinite(Number(objUiState.redSlDelta))) {
        objUiState.redSlDelta = normalizeLiveNumber(objUiState.deltaSl1, 0.85);
    }
    if (!Number.isFinite(Number(objUiState.greenReDelta))) {
        objUiState.greenReDelta = normalizeLiveNumber(objUiState.reDelta1, 0.53);
    }
    if (!Number.isFinite(Number(objUiState.greenTpDelta))) {
        objUiState.greenTpDelta = normalizeLiveNumber(objUiState.deltaTp1, 0.15);
    }
    if (!Number.isFinite(Number(objUiState.greenSlDelta))) {
        objUiState.greenSlDelta = normalizeLiveNumber(objUiState.deltaSl1, 0.85);
    }
    return sanitizeLiveUiState(objUiState);
}

function getMergedLiveUiState(pProfile?: { uiState?: Record<string, unknown> | null } | null): Record<string, unknown> {
    const objUiState = normalizeLiveUiState({
        ...getDefaultLiveUiState(),
        ...(pProfile?.uiState || {})
    });
    return {
        ...objUiState,
        expiryDate1: String(objUiState.expiryDate1 || "").trim() || resolveLiveExpiryDateByMode(String(objUiState.expiryMode1 || "1"))
    };
}

function getLiveRuleMetadataForColor(
    pUiState: Record<string, unknown>,
    pColorCode: "R" | "G",
    pReason: string
): RollingOptionsLtDePositionMetadata {
    const objConfig = buildConfigFromUiState(pUiState);
    if (pColorCode === "G") {
        return {
            ruleColor: "G",
            takeProfitDelta: Number(objConfig.greenDeltaTakeProfit ?? objConfig.deltaTakeProfit ?? 0.15),
            stopLossDelta: Number(objConfig.greenDeltaStopLoss ?? objConfig.deltaStopLoss ?? 0.85),
            reEntryDelta: Number(objConfig.greenReDelta ?? objConfig.reDelta ?? 0.53),
            openedReason: pReason
        };
    }

    return {
        ruleColor: "R",
        takeProfitDelta: Number(objConfig.redDeltaTakeProfit ?? objConfig.deltaTakeProfit ?? 0.15),
        stopLossDelta: Number(objConfig.redDeltaStopLoss ?? objConfig.deltaStopLoss ?? 0.85),
        reEntryDelta: Number(objConfig.redReDelta ?? objConfig.reDelta ?? 0.53),
        openedReason: pReason
    };
}

const gLiveStrategyCode = "rolling-options-lt-de";

async function appendTrackedLivePositions(
    pUserId: string,
    pPositions: RollingOptionsLtDeImportedPositionRecord[]
): Promise<RollingOptionsLtDeImportedPositionRecord[]> {
    const arrExisting = await listRollingOptionsLtDeImportedPositions(pUserId);
    return replaceRollingOptionsLtDeImportedPositions(pUserId, [...arrExisting, ...pPositions]);
}

async function removeTrackedLivePositions(
    pUserId: string,
    pPredicate: (pPosition: RollingOptionsLtDeImportedPositionRecord) => boolean
): Promise<RollingOptionsLtDeImportedPositionRecord[]> {
    const arrExisting = await listRollingOptionsLtDeImportedPositions(pUserId);
    return replaceRollingOptionsLtDeImportedPositions(pUserId, arrExisting.filter((objRow) => !pPredicate(objRow)));
}

export function renderRollingOptionsLivePage(req: Request, res: Response): void {
    res.render("rolling-options-lt-de", {
        pageTitle: "Rolling Option - Live | Optionyze",
        currentAccount: req.authAccount,
        rollingTelegramEventTypes: gRollingOptionsTelegramEventTypes
    });
}

export async function getRollingOptionsLtDeProfile(req: Request, res: Response): Promise<void> {
    const vUserId = getAccountId(req);
    const objProfile = await readLiveProfile(vUserId);
    res.json({
        status: "success",
        data: {
            ...objProfile,
            uiState: getMergedLiveUiState(objProfile)
        }
    });
}

export async function saveRollingOptionsLtDeProfileController(req: Request, res: Response): Promise<void> {
    const vUserId = getAccountId(req);
    const objExisting = await readLiveProfile(vUserId);
    const vSelectedApiProfileId = String(req.body?.selectedApiProfileId || "").trim();
    const objIncomingUiState = req.body?.uiState && typeof req.body.uiState === "object"
        ? req.body.uiState as Record<string, unknown>
        : {};
    const objSaved = await saveRollingOptionsLtDeProfile({
        ...objExisting,
        userId: vUserId,
        selectedApiProfileId: vSelectedApiProfileId || String(objExisting.selectedApiProfileId || "").trim(),
        uiState: normalizeLiveUiState({
            ...getMergedLiveUiState(objExisting),
            ...objIncomingUiState
        })
    });
    await syncLiveRuntimeProfileSelection(vUserId, objSaved.selectedApiProfileId);
    res.json({
        status: "success",
        message: "Live profile saved.",
        data: {
            ...objSaved,
            uiState: getMergedLiveUiState(objSaved)
        }
    });
}

export async function getRollingOptionsLtDeConnectionStatus(req: Request, res: Response): Promise<void> {
    const vUserId = getAccountId(req);
    const objProfile = await readLiveProfile(vUserId);
    res.json({
        status: "success",
        data: {
            selectedApiProfileId: objProfile.selectedApiProfileId,
            connectionStatus: objProfile.connectionStatus
        }
    });
}

export async function getRollingOptionsLtDeRuntimeStatus(req: Request, res: Response): Promise<void> {
    const vUserId = getAccountId(req);
    const objRuntime = await loadRollingOptionsLtDeRuntime(vUserId);
    res.json({
        status: "success",
        data: objRuntime || {
            userId: vUserId,
            status: "idle",
            autoTraderEnabled: false,
            selectedApiProfileId: String((await readLiveProfile(vUserId)).selectedApiProfileId || "").trim(),
            currentSymbol: "",
            currentContractName: "",
            currentExpiryMode: "",
            currentExpiryDate: "",
            renkoEnabled: false,
            renkoPoints: 0,
            renkoSource: "",
            lastSpotPrice: null,
            lastFuturesPrice: null,
            lastSignal: "IDLE",
            lastCycleAt: "",
            lastError: "",
            state: {},
            updatedAt: ""
        }
    });
}

export async function enableRollingOptionsLtDeAutoTrader(req: Request, res: Response, pService: RollingOptionsLtDeService): Promise<void> {
    const vUserId = getAccountId(req);
    const objProfile = await readLiveProfile(vUserId);
    const vSelectedApiProfileId = String(objProfile.selectedApiProfileId || "").trim();
    if (!vSelectedApiProfileId) {
        res.status(400).json({ status: "warning", message: "Select an API profile before enabling live auto trader." });
        return;
    }

    const objCheck = await performRollingOptionsLtDeConnectionCheck(vUserId, vSelectedApiProfileId);
    if (objCheck.profile.connectionStatus.state !== "connected") {
        res.status(400).json({
            status: "warning",
            message: objCheck.profile.connectionStatus.message || "Delta connection is not healthy.",
            data: objCheck.profile
        });
        return;
    }

    const objRuntime = await pService.startUser(vUserId);
    await logRollingOptionsLtDeEvent({
        userId: vUserId,
        eventType: "engine_started",
        severity: "success",
        title: "Live Auto Trader Started",
        message: "Server-side live auto trader started.",
        payload: {
            symbol: objRuntime.currentSymbol || "",
            reason: "engine_started"
        }
    });
    res.json({
        status: "success",
        message: "Live auto trader enabled.",
        data: objRuntime
    });
}

export async function disableRollingOptionsLtDeAutoTrader(req: Request, res: Response, pService: RollingOptionsLtDeService): Promise<void> {
    const vUserId = getAccountId(req);
    const objRuntime = await pService.stopUser(vUserId);
    await logRollingOptionsLtDeEvent({
        userId: vUserId,
        eventType: "engine_stopped",
        severity: "info",
        title: "Live Auto Trader Stopped",
        message: "Server-side live auto trader stopped.",
        payload: {
            symbol: objRuntime.currentSymbol || "",
            reason: "engine_stopped"
        }
    });
    res.json({
        status: "success",
        message: "Live auto trader disabled.",
        data: objRuntime
    });
}

export async function executeRollingOptionsLtDeStrategy(
    req: Request,
    res: Response,
    pService: RollingOptionsLtDeService
): Promise<void> {
    const vUserId = getAccountId(req);
    const objProfile = await readLiveProfile(vUserId);
    const vSelectedApiProfileId = String(objProfile.selectedApiProfileId || "").trim();
    if (!vSelectedApiProfileId) {
        res.status(400).json({ status: "warning", message: "Select an API profile before executing the live strategy." });
        return;
    }

    const objCheck = await performRollingOptionsLtDeConnectionCheck(vUserId, vSelectedApiProfileId);
    if (objCheck.profile.connectionStatus.state !== "connected") {
        res.status(400).json({
            status: "warning",
            message: objCheck.profile.connectionStatus.message || "Delta connection is not healthy.",
            data: objCheck.profile
        });
        return;
    }

    const vRenkoColor = String(req.body?.renkoColor || "").trim().toUpperCase() === "G" ? "G" : "R";
    const objResult = await pService.executeStrategy(vUserId, vRenkoColor);
    const [objRuntime, arrPositions] = await Promise.all([
        loadRollingOptionsLtDeRuntime(vUserId),
        listRollingOptionsLtDeImportedPositions(vUserId)
    ]);

    res.json({
        status: objResult.status,
        message: objResult.message,
        data: {
            runtime: objRuntime,
            trackedOpenPositions: arrPositions
        }
    });
}

export async function executeRollingOptionsLtDeKillSwitch(req: Request, res: Response, pService: RollingOptionsLtDeService): Promise<void> {
    const vUserId = getAccountId(req);
    const objProfile = await readLiveProfile(vUserId);
    const vSelectedApiProfileId = String(objProfile.selectedApiProfileId || "").trim();
    if (!vSelectedApiProfileId) {
        res.status(400).json({ status: "warning", message: "Select an API profile before using the live kill switch." });
        return;
    }

    const objCheck = await performRollingOptionsLtDeConnectionCheck(vUserId, vSelectedApiProfileId);
    if (objCheck.profile.connectionStatus.state !== "connected") {
        res.status(400).json({
            status: "warning",
            message: objCheck.profile.connectionStatus.message || "Delta connection is not healthy.",
            data: objCheck.profile
        });
        return;
    }

    try {
        const objResult = await pService.emergencyStopUser(vUserId);
        res.json({
            status: "success",
            message: objResult.closedPositions.length > 0
                ? `Kill switch closed ${objResult.closedPositions.length} live position${objResult.closedPositions.length === 1 ? "" : "s"} and stopped auto trader.`
                : "Kill switch stopped auto trader. No saved imported live positions were open.",
            data: {
                runtime: objResult.runtime,
                closedPositions: objResult.closedPositions
            }
        });
    }
    catch (objError) {
        await logRollingOptionsLtDeEvent({
            userId: vUserId,
            eventType: "engine_error",
            severity: "error",
            title: "Kill Switch Failed",
            message: getErrorMessage(objError, "Unable to complete live kill switch."),
            payload: {
                reason: "kill_switch_error"
            }
        });
        res.status(500).json({
            status: "danger",
            message: getErrorMessage(objError, "Unable to complete live kill switch.")
        });
    }
}

export async function executeRollingOptionsLtDeManualFuture(req: Request, res: Response): Promise<void> {
    const vUserId = getAccountId(req);
    const objProfile = await readLiveProfile(vUserId);
    const vSelectedApiProfileId = String(objProfile.selectedApiProfileId || "").trim();
    if (!vSelectedApiProfileId) {
        res.status(400).json({ status: "warning", message: "Select an API profile before placing live future orders." });
        return;
    }

    const objCheck = await performRollingOptionsLtDeConnectionCheck(vUserId, vSelectedApiProfileId);
    if (objCheck.profile.connectionStatus.state !== "connected") {
        res.status(400).json({
            status: "warning",
            message: objCheck.profile.connectionStatus.message || "Delta connection is not healthy.",
            data: objCheck.profile
        });
        return;
    }

    const vAction = String(req.body?.action || "").trim().toUpperCase();
    const vSide = vAction === "SELL" ? "sell" : (vAction === "BUY" ? "buy" : "");
    const vSymbol = String(req.body?.symbol || "BTC").trim().toUpperCase();
    const vQty = Math.max(1, Math.floor(Number(req.body?.qty || 1)));
    const vOrderType = String(req.body?.orderType || "market_order").trim() === "limit_order"
        ? "limit_order"
        : "market_order";

    if (!vSide) {
        res.status(400).json({ status: "warning", message: "Future action must be BUY or SELL." });
        return;
    }

    try {
        const { client, profile } = await getDeltaClientForAccountId(vUserId, vSelectedApiProfileId);
        const vProductSymbol = getContractNameForSymbol(vSymbol);
        const objSnapshot = await getLiveMarketSnapshot({
            symbol: vSymbol,
            contractName: vProductSymbol,
            lotSize: getLotSizeForSymbol(vSymbol),
            futureQty: vQty,
            futureOrderType: vOrderType,
            action: vSide,
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
        });

        const objOrderPayload: Record<string, unknown> = {
            product_symbol: vProductSymbol,
            size: vQty,
            side: vSide,
            order_type: vOrderType,
            time_in_force: "gtc",
            post_only: false,
            reduce_only: false
        };
        if (vOrderType === "limit_order") {
            objOrderPayload.limit_price = String(objSnapshot.futuresPrice);
        }

        const objResponse = await client.apis.Orders.placeOrder({
            order: objOrderPayload
        });
        const objPayload = readResponsePayload(objResponse);
        await logRollingOptionsLtDeEvent({
            userId: vUserId,
            eventType: "future_opened",
            severity: "success",
            title: `${vAction} Future Order Placed`,
            message: `${vAction} future live order placed using ${profile.referenceName}.`,
            payload: {
                symbol: vSymbol,
                contractName: vProductSymbol,
                qty: vQty,
                reason: "manual_future"
            }
        });
        const arrTrackedPositions = await appendTrackedLivePositions(vUserId, [{
            userId: vUserId,
            importId: crypto.randomUUID(),
            contractName: vProductSymbol,
            side: vAction,
            qty: vQty,
            entryPrice: Number(objSnapshot.futuresPrice || 0),
            markPrice: Number(objSnapshot.futuresPrice || 0),
            entryDelta: null,
            currentDelta: null,
            charges: 0,
            pnl: 0,
            margin: 0,
            liquidationPrice: 0,
            openedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        }]);

        res.json({
            status: "success",
            message: `${vAction} future live order placed using ${profile.referenceName}.`,
            data: {
                order: objPayload.result || objPayload,
                request: objOrderPayload,
                trackedOpenPositions: arrTrackedPositions,
                snapshot: {
                    productSymbol: vProductSymbol,
                    futuresPrice: objSnapshot.futuresPrice,
                    spotPrice: objSnapshot.spotPrice
                }
            }
        });
    }
    catch (objError) {
        await logRollingOptionsLtDeEvent({
            userId: vUserId,
            eventType: "engine_error",
            severity: "error",
            title: "Future Order Failed",
            message: getErrorMessage(objError, "Unable to place live future order."),
            payload: {
                symbol: vSymbol,
                qty: vQty,
                reason: "manual_future_error"
            }
        });
        res.status(500).json({
            status: "danger",
            message: getErrorMessage(objError, "Unable to place live future order.")
        });
    }
}

export async function executeRollingOptionsLtDeManualOption(req: Request, res: Response): Promise<void> {
    const vUserId = getAccountId(req);
    const objProfile = await readLiveProfile(vUserId);
    const vSelectedApiProfileId = String(objProfile.selectedApiProfileId || "").trim();
    if (!vSelectedApiProfileId) {
        res.status(400).json({ status: "warning", message: "Select an API profile before placing live option orders." });
        return;
    }

    const objCheck = await performRollingOptionsLtDeConnectionCheck(vUserId, vSelectedApiProfileId);
    if (objCheck.profile.connectionStatus.state !== "connected") {
        res.status(400).json({
            status: "warning",
            message: objCheck.profile.connectionStatus.message || "Delta connection is not healthy.",
            data: objCheck.profile
        });
        return;
    }

    const vOperation = String(req.body?.operation || "open").trim().toLowerCase() === "exit" ? "exit" : "open";
    const vAction = String(req.body?.action || "").trim().toLowerCase();
    const vSymbol = String(req.body?.symbol || "BTC").trim().toUpperCase();
    const vLegSide = String(req.body?.legSide || "ce").trim().toLowerCase();
    const vExpiryMode = String(req.body?.expiryMode || "1").trim() as "1" | "2" | "4" | "5" | "6";
    const vExpiryDate = String(req.body?.expiryDate || "").trim();
    const vQty = Math.max(1, Math.floor(Number(req.body?.qty || 1)));
    const vTargetDelta = Math.max(0, Number(req.body?.targetDelta || 0.53));

    if (vAction !== "buy" && vAction !== "sell") {
        res.status(400).json({ status: "warning", message: "Select a valid option action before placing a live option order." });
        return;
    }
    if (!vExpiryDate) {
        res.status(400).json({ status: "warning", message: "Select an expiry date before placing a live option order." });
        return;
    }

    const arrOptionSides: Array<"CE" | "PE"> = vLegSide === "both"
        ? ["CE", "PE"]
        : [vLegSide === "pe" ? "PE" : "CE"];
    const objConfig = {
        symbol: vSymbol,
        contractName: getContractNameForSymbol(vSymbol),
        lotSize: getLotSizeForSymbol(vSymbol),
        futureQty: 1,
        futureOrderType: "market_order" as const,
        action: vAction === "buy" ? "buy" as const : "sell" as const,
        legSide: vLegSide === "both" ? "both" as const : (vLegSide === "pe" ? "pe" as const : "ce" as const),
        expiryMode: ["1", "2", "4", "5", "6"].includes(vExpiryMode) ? vExpiryMode : "1",
        expiryDate: vExpiryDate,
        optionQty: vQty,
        redOptionQtyPct: 100,
        greenOptionQtyPct: 100,
        newDelta: vTargetDelta,
        reDelta: vTargetDelta,
        deltaTakeProfit: 0.15,
        deltaStopLoss: 0.85,
        reEnter: false,
        addOneLotFuture: false,
        renkoEnabled: false,
        renkoStepPoints: 10,
        renkoPriceSource: "spot_price" as const,
        loopSeconds: 8
    };

    try {
        const { client, profile } = await getDeltaClientForAccountId(vUserId, vSelectedApiProfileId);
        const arrOrders: Array<Record<string, unknown>> = [];
        const arrContracts: Array<Record<string, unknown>> = [];

        for (const vOptionSide of arrOptionSides) {
            const objContract = await findBestLiveOptionContract(objConfig, vOptionSide, vTargetDelta);
            if (!objContract) {
                throw new Error(`No live ${vOptionSide} contract was found for ${vSymbol} near delta ${vTargetDelta.toFixed(2)}.`);
            }

            const vOrderSide = vOperation === "exit"
                ? (vAction === "sell" ? "buy" : "sell")
                : vAction;
            const objOrderPayload: Record<string, unknown> = {
                product_symbol: objContract.contractSymbol,
                size: vQty,
                side: vOrderSide,
                order_type: "market_order",
                time_in_force: "gtc",
                post_only: false,
                reduce_only: vOperation === "exit"
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
                markPrice: objContract.markPrice,
                requestedExpiryDate: objContract.requestedExpiryDate,
                resolvedExpiryDate: objContract.expiryDate,
                usedNextDayExpiryFallback: objContract.usedNextDayFallback
            });
        }

        await logRollingOptionsLtDeEvent({
            userId: vUserId,
            eventType: vOperation === "exit" ? "option_closed" : "option_opened",
            severity: "success",
            title: vOperation === "exit" ? "Manual Option Exit Placed" : "Manual Option Opened",
            message: `${vOperation === "exit" ? "Exit" : "Open"} option live order${arrOrders.length === 1 ? "" : "s"} placed using ${profile.referenceName}.`,
            payload: {
                symbol: vSymbol,
                qty: vQty,
                reason: vOperation === "exit" ? "manual_option_exit" : "manual_option_open"
            }
        });
        let arrTrackedPositions = await listRollingOptionsLtDeImportedPositions(vUserId);
        if (vOperation === "open") {
            const objProfileState = await readLiveProfile(vUserId);
            const objRuntime = await loadRollingOptionsLtDeRuntime(vUserId);
            const objUiState = getMergedLiveUiState(objProfileState);
            const vRuleColor: "R" | "G" = String(objRuntime?.state?.renkoLastColor || "").trim().toUpperCase() === "G" ? "G" : "R";
            arrTrackedPositions = await appendTrackedLivePositions(vUserId, arrContracts.map((objContract) => ({
                userId: vUserId,
                importId: crypto.randomUUID(),
                contractName: String(objContract.contractSymbol || "").trim(),
                side: vAction.toUpperCase(),
                qty: vQty,
                entryPrice: Number(objContract.markPrice || 0),
                markPrice: Number(objContract.markPrice || 0),
                entryDelta: Number.isFinite(Number(objContract.delta)) ? Math.abs(Number(objContract.delta)) : null,
                currentDelta: Number.isFinite(Number(objContract.delta)) ? Math.abs(Number(objContract.delta)) : null,
                charges: 0,
                pnl: 0,
                margin: 0,
                liquidationPrice: 0,
                metadata: getLiveRuleMetadataForColor(objUiState, vRuleColor, "manual_option_open"),
                openedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            } satisfies RollingOptionsLtDeImportedPositionRecord)));
        }
        else {
            const arrClosedContractNames = arrContracts
                .map((objContract) => String(objContract.contractSymbol || "").trim())
                .filter(Boolean);
            const vOriginalSide = vAction.toUpperCase();
            arrTrackedPositions = await removeTrackedLivePositions(vUserId, (objRow) => {
                return arrClosedContractNames.includes(String(objRow.contractName || "").trim())
                    && String(objRow.side || "").trim().toUpperCase() === vOriginalSide;
            });
        }

        res.json({
            status: "success",
            message: `${vOperation === "exit" ? "Exit" : "Open"} option live order${arrOrders.length === 1 ? "" : "s"} placed using ${profile.referenceName}.`,
            data: {
                operation: vOperation,
                action: vAction,
                qty: vQty,
                orders: arrOrders,
                contracts: arrContracts,
                trackedOpenPositions: arrTrackedPositions
            }
        });
    }
    catch (objError) {
        await logRollingOptionsLtDeEvent({
            userId: vUserId,
            eventType: "engine_error",
            severity: "error",
            title: "Option Order Failed",
            message: getErrorMessage(objError, "Unable to place live option order."),
            payload: {
                symbol: vSymbol,
                qty: vQty,
                reason: "manual_option_error"
            }
        });
        res.status(500).json({
            status: "danger",
            message: getErrorMessage(objError, "Unable to place live option order.")
        });
    }
}

export async function closeRollingOptionsLtDeImportedOpenPosition(req: Request, res: Response): Promise<void> {
    const vUserId = getAccountId(req);
    const objProfile = await readLiveProfile(vUserId);
    const vSelectedApiProfileId = String(objProfile.selectedApiProfileId || "").trim();
    if (!vSelectedApiProfileId) {
        res.status(400).json({ status: "warning", message: "Select an API profile before closing live positions." });
        return;
    }

    const objCheck = await performRollingOptionsLtDeConnectionCheck(vUserId, vSelectedApiProfileId);
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
    if (!vContractName) {
        res.status(400).json({ status: "warning", message: "Contract name is required to close an imported live position." });
        return;
    }
    if (vSide !== "BUY" && vSide !== "SELL") {
        res.status(400).json({ status: "warning", message: "Imported live position side must be BUY or SELL." });
        return;
    }
    if (!(vQty > 0)) {
        res.status(400).json({ status: "warning", message: "Imported live position quantity must be greater than zero." });
        return;
    }

    try {
        const { client, profile } = await getDeltaClientForAccountId(vUserId, vSelectedApiProfileId);
        const vCloseSide = vSide === "BUY" ? "sell" : "buy";
        const objOrderPayload: Record<string, unknown> = {
            product_symbol: vContractName,
            size: vQty,
            side: vCloseSide,
            order_type: "market_order",
            time_in_force: "gtc",
            post_only: false,
            reduce_only: true
        };
        const objResponse = await client.apis.Orders.placeOrder({
            order: objOrderPayload
        });
        const objPayload = readResponsePayload(objResponse);

        if (vImportId) {
            await deleteRollingOptionsLtDeImportedPosition(vUserId, vImportId);
        }
        await logRollingOptionsLtDeEvent({
            userId: vUserId,
            eventType: "option_closed",
            severity: "warning",
            title: "Imported Position Closed",
            message: `Close order placed on Delta Exchange for ${vContractName} using ${profile.referenceName}.`,
            payload: {
                contractName: vContractName,
                qty: vQty,
                reason: "manual_imported_position_close"
            }
        });
        res.json({
            status: "success",
            message: `Close order placed on Delta Exchange for ${vContractName} using ${profile.referenceName}.`,
            data: {
                order: objPayload.result || objPayload,
                request: objOrderPayload
            }
        });
    }
    catch (objError) {
        await logRollingOptionsLtDeEvent({
            userId: vUserId,
            eventType: "engine_error",
            severity: "error",
            title: "Imported Position Close Failed",
            message: getErrorMessage(objError, "Unable to close imported live position on Delta Exchange."),
            payload: {
                contractName: vContractName,
                qty: vQty,
                reason: "manual_imported_position_close_error"
            }
        });
        res.status(500).json({
            status: "danger",
            message: getErrorMessage(objError, "Unable to close imported live position on Delta Exchange.")
        });
    }
}

export async function getRollingOptionsLtDeOpenPositions(req: Request, res: Response): Promise<void> {
    const vUserId = getAccountId(req);
    const arrPositions = await listRollingOptionsLtDeImportedPositions(vUserId);
    res.json({
        status: "success",
        data: arrPositions
    });
}

export async function reconcileRollingOptionsLtDeOpenPositions(
    req: Request,
    res: Response,
    pService: RollingOptionsLtDeService
): Promise<void> {
    const vUserId = getAccountId(req);
    const objProfile = await readLiveProfile(vUserId);
    const vSelectedApiProfileId = String(objProfile.selectedApiProfileId || "").trim();
    if (!vSelectedApiProfileId) {
        res.status(400).json({ status: "warning", message: "Select an API profile before reconciling live positions." });
        return;
    }

    const objCheck = await performRollingOptionsLtDeConnectionCheck(vUserId, vSelectedApiProfileId);
    if (objCheck.profile.connectionStatus.state !== "connected") {
        res.status(400).json({
            status: "warning",
            message: objCheck.profile.connectionStatus.message || "Delta connection is not healthy.",
            data: objCheck.profile
        });
        return;
    }

    const arrPositions = await pService.reconcileUserPositions(vUserId, String(req.body?.symbol || req.query?.symbol || "").trim().toUpperCase());
    res.json({
        status: "success",
        message: `Reconciled ${arrPositions.length} live position${arrPositions.length === 1 ? "" : "s"} with Delta Exchange.`,
        data: arrPositions
    });
}

export async function setRollingOptionsLtDeManualRenkoSignal(
    req: Request,
    res: Response,
    pService: RollingOptionsLtDeService
): Promise<void> {
    const vUserId = getAccountId(req);
    const vColor = String(req.body?.color || "").trim().toUpperCase() === "G" ? "G" : "R";
    const objRuntime = await pService.setManualRenkoSignal(vUserId, vColor);
    res.json({
        status: "success",
        message: `Renko box changed to ${vColor}.`,
        data: objRuntime
    });
}

export async function getRollingOptionsLtDeEvents(req: Request, res: Response): Promise<void> {
    const vUserId = getAccountId(req);
    const arrEvents = await listRollingOptionsEventsByStrategy(vUserId, gLiveStrategyCode, 100);
    res.json({
        status: "success",
        data: arrEvents
    });
}

export async function clearRollingOptionsLtDeEventsController(req: Request, res: Response): Promise<void> {
    const vUserId = getAccountId(req);
    const vDeletedCount = await clearRollingOptionsEventsByStrategy(vUserId, gLiveStrategyCode);
    res.json({
        status: "success",
        message: `Cleared ${vDeletedCount} live activity log event${vDeletedCount === 1 ? "" : "s"}.`
    });
}

export async function saveRollingOptionsLtDeOpenPositions(req: Request, res: Response): Promise<void> {
    const vUserId = getAccountId(req);
    const arrIncoming = Array.isArray(req.body?.positions) ? req.body.positions as Array<Record<string, unknown>> : [];
    const arrSaved = await replaceRollingOptionsLtDeImportedPositions(vUserId, arrIncoming.map((objRow) => ({
        userId: vUserId,
        importId: String(objRow.importId || "").trim(),
        contractName: String(objRow.contractName || "").trim(),
        side: String(objRow.side || "").trim().toUpperCase(),
        qty: Number(objRow.qty || 0),
        entryPrice: Number(objRow.entryPrice || 0),
        markPrice: Number(objRow.markPrice || 0),
        entryDelta: objRow.entryDelta === null || objRow.entryDelta === undefined ? null : Number(objRow.entryDelta),
        currentDelta: objRow.currentDelta === null || objRow.currentDelta === undefined ? null : Number(objRow.currentDelta),
        charges: Number(objRow.charges || 0),
        pnl: Number(objRow.pnl || 0),
        margin: Number(objRow.margin || 0),
        liquidationPrice: Number(objRow.liquidationPrice || 0),
        metadata: objRow.metadata && typeof objRow.metadata === "object" ? objRow.metadata as RollingOptionsLtDePositionMetadata : undefined,
        openedAt: String(objRow.openedAt || "").trim(),
        updatedAt: ""
    }) satisfies RollingOptionsLtDeImportedPositionRecord));
    await logRollingOptionsLtDeEvent({
        userId: vUserId,
        eventType: "manual_action",
        severity: "info",
        title: "Imported Live Positions Updated",
        message: arrSaved.length
            ? `Saved ${arrSaved.length} imported live position${arrSaved.length === 1 ? "" : "s"} in the open grid.`
            : "Cleared imported live positions from the open grid.",
        payload: {
            qty: arrSaved.length,
            reason: "imported_positions_saved"
        }
    });

    res.json({
        status: "success",
        message: "Imported open positions saved.",
        data: arrSaved
    });
}

export async function deleteRollingOptionsLtDeOpenPosition(req: Request, res: Response): Promise<void> {
    const vUserId = getAccountId(req);
    const vImportId = String(req.body?.importId || "").trim();
    if (!vImportId) {
        res.status(400).json({ status: "warning", message: "Import position id is required." });
        return;
    }

    await deleteRollingOptionsLtDeImportedPosition(vUserId, vImportId);
    await logRollingOptionsLtDeEvent({
        userId: vUserId,
        eventType: "manual_action",
        severity: "info",
        title: "Imported Position Removed",
        message: "Imported open position removed from the live page only. No Delta Exchange order was placed.",
        payload: {
            qty: 1,
            reason: "imported_position_removed"
        }
    });
    res.json({
        status: "success",
        message: "Imported open position removed from the live page.",
        data: { importId: vImportId }
    });
}

export async function performRollingOptionsLtDeConnectionCheck(
    pUserId: string,
    pProfileId = ""
): Promise<{
    profile: Awaited<ReturnType<typeof readLiveProfile>>;
    summary: {
        currency: string;
        availableBalance: number;
        blockedMargin: number;
    } | null;
}> {
    const objProfile = await readLiveProfile(pUserId);
    const vProfileId = String(pProfileId || objProfile.selectedApiProfileId || "").trim();
    const vNow = new Date().toISOString();

    if (!vProfileId) {
        const objStatus: RollingOptionsLtDeConnectionStatus = {
            ...objProfile.connectionStatus,
            state: "not_selected",
            message: "Select an API profile to start live connection checks.",
            lastCheckedAt: vNow
        };
        return {
            profile: await saveRollingOptionsLtDeProfile({
                ...objProfile,
                userId: pUserId,
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
        const objStatus: RollingOptionsLtDeConnectionStatus = {
            ...objProfile.connectionStatus,
            state: "connected",
            message: `Connected to Delta API profile ${profile.referenceName}.`,
            outboundIp: vOutboundIp,
            lastCheckedAt: vNow,
            lastSuccessAt: vNow,
            consecutiveFailures: 0
        };
        return {
            profile: await saveRollingOptionsLtDeProfile({
                ...objProfile,
                userId: pUserId,
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
        const vFailures = Number(objProfile.connectionStatus?.consecutiveFailures || 0) + 1;
        const objStatus: RollingOptionsLtDeConnectionStatus = {
            ...objProfile.connectionStatus,
            state: objFriendly.state,
            message: objFriendly.message,
            outboundIp: objFriendly.outboundIp,
            lastCheckedAt: vNow,
            consecutiveFailures: vFailures
        };
        const objSaved = await saveRollingOptionsLtDeProfile({
            ...objProfile,
            userId: pUserId,
            selectedApiProfileId: vProfileId,
            connectionStatus: objStatus
        });

        const vPreviousAlertKey = `${objProfile.connectionStatus?.alertState || ""}|${objProfile.connectionStatus?.alertMessage || ""}`;
        const vCurrentAlertKey = `${objStatus.state}|${objStatus.message}`;
        const vLastAlertAt = String(objProfile.connectionStatus?.alertSentAt || "").trim();
        const vCanResend = !vLastAlertAt || ((Date.now() - new Date(vLastAlertAt).getTime()) > (30 * 60 * 1000));

        if (vCurrentAlertKey !== vPreviousAlertKey || vCanResend) {
            const objDeltaProfile = await getDeltaApiProfile(pUserId, vProfileId);
            await sendTelegramConnectionAlert(pUserId, String(objDeltaProfile?.referenceName || ""), objStatus);
            return {
                profile: await saveRollingOptionsLtDeProfile({
                    ...objSaved,
                    connectionStatus: {
                        ...objStatus,
                        alertState: objStatus.state,
                        alertMessage: objStatus.message,
                        alertSentAt: vNow
                    }
                }),
                summary: null
            };
        }

        return {
            profile: objSaved,
            summary: null
        };
    }
}

export async function checkRollingOptionsLtDeConnection(req: Request, res: Response): Promise<void> {
    const vUserId = getAccountId(req);
    const objResult = await performRollingOptionsLtDeConnectionCheck(vUserId, String(req.body?.profileId || "").trim());
    res.json({
        status: objResult.profile.connectionStatus.state === "connected" ? "success" : "warning",
        data: {
            ...objResult.profile,
            summary: objResult.summary
        }
    });
}

export async function getRollingOptionsLtDeAccountSummary(req: Request, res: Response): Promise<void> {
    const vProfileId = await resolveProfileId(req);
    if (!vProfileId) {
        res.status(400).json({ status: "warning", message: "API profile is required." });
        return;
    }

    try {
        const vUserId = getAccountId(req);
        const objProfileState = await readLiveProfile(vUserId);
        const objUiState = getMergedLiveUiState(objProfileState);
        const vRequestedSymbol = String(req.query?.symbol || req.body?.symbol || "").trim().toUpperCase();
        const vSelectedSymbol = vRequestedSymbol || (String(objUiState.symbol || "BTC").trim().toUpperCase() || "BTC");
        const vLotSize = getLotSizeForSymbol(vSelectedSymbol);
        const { client, profile } = await getDeltaClientForProfile(req, vProfileId);
        const objMarketConfig = {
            symbol: vSelectedSymbol,
            contractName: getContractNameForSymbol(vSelectedSymbol),
            lotSize: vLotSize,
            futureQty: 1,
            futureOrderType: "market_order" as const,
            action: "sell" as const,
            legSide: "ce" as const,
            expiryMode: "1" as const,
            expiryDate: String(objUiState.expiryDate1 || ""),
            optionQty: 1,
            redOptionQtyPct: 100,
            greenOptionQtyPct: 100,
            newDelta: Number(objUiState.newDelta1 || 0.53),
            reDelta: Number(objUiState.reRedDelta || 0.53),
            deltaTakeProfit: Number(objUiState.redTpDelta || 0.15),
            deltaStopLoss: Number(objUiState.redSlDelta || 0.85),
            reEnter: Boolean(objUiState.reEnter1),
            addOneLotFuture: Boolean(objUiState.addOneLotFuture),
            renkoEnabled: false,
            renkoStepPoints: 10,
            renkoPriceSource: "spot_price" as const,
            loopSeconds: 8
        };
        const objPositionsApi = client.apis?.Positions as {
            getMarginedPositions?: (pParams: Record<string, unknown>) => Promise<unknown>;
            getPositions?: (pParams: Record<string, unknown>) => Promise<unknown>;
        } | undefined;
        const [objWalletResult, objMarketResult, objPositionsResult] = await Promise.allSettled([
            client.apis.Wallet.getBalances(),
            getLiveMarketSnapshot(objMarketConfig),
            typeof objPositionsApi?.getMarginedPositions === "function"
                ? objPositionsApi.getMarginedPositions({})
                : (typeof objPositionsApi?.getPositions === "function"
                    ? objPositionsApi.getPositions({
                        underlying_asset_symbol: vSelectedSymbol
                    }).catch(async () => objPositionsApi.getPositions!({
                        underlying_asset_symbol: getContractNameForSymbol(vSelectedSymbol)
                    }))
                    : Promise.resolve(null))
        ]);
        if (objWalletResult.status !== "fulfilled") {
            throw objWalletResult.reason;
        }
        const objWalletResponse = objWalletResult.value;
        const objMarketSnapshot = objMarketResult.status === "fulfilled" ? objMarketResult.value : null;
        const objPositionsResponse = objPositionsResult.status === "fulfilled" ? objPositionsResult.value : null;

        const objPayload = readResponsePayload(objWalletResponse);
        const arrRows = Array.isArray(objPayload.result) ? objPayload.result as DeltaWalletBalanceRow[] : [];
        const objUsdRow = pickUsdBalanceRow(arrRows);
        const vAvailableBalance = getAvailableBalanceUsd(objUsdRow);
        const vBlockedMargin = getBlockedMarginUsd(objUsdRow);
        const vTotalBalance = getTotalBalanceUsd(objUsdRow);
        const objPositionsPayload = readResponsePayload(objPositionsResponse || {});
        const arrPositions = Array.isArray(objPositionsPayload.result)
            ? objPositionsPayload.result as DeltaPositionRow[]
            : (objPositionsPayload.result ? [objPositionsPayload.result as DeltaPositionRow] : []);
        const vLivePrice = Number(objMarketSnapshot?.futuresPrice || 0);
        const vOneLotValue = Number.isFinite(vLivePrice) && vLivePrice > 0 ? vLivePrice * vLotSize : Number.NaN;
        const vSelectedFuturePositionValue = getSelectedFuturePositionValue(arrPositions, vSelectedSymbol, vLivePrice);
        const vHealthPct = vAvailableBalance > 0 && vSelectedFuturePositionValue > 0
            ? Number(((vSelectedFuturePositionValue / vAvailableBalance) * 100).toFixed(2))
            : Number.NaN;

        res.json({
            status: "success",
            data: {
                profileId: profile.profileId,
                profileName: profile.referenceName,
                selectedSymbol: vSelectedSymbol,
                lotSize: vLotSize,
                currency: String(objUsdRow?.asset_symbol || objUsdRow?.symbol || "USD").toUpperCase(),
                availableBalance: Number(vAvailableBalance.toFixed(2)),
                blockedMargin: Number(vBlockedMargin.toFixed(2)),
                totalBalance: Number(vTotalBalance.toFixed(2)),
                healthPct: Number.isFinite(vHealthPct) ? vHealthPct : null,
                oneLotValue: Number.isFinite(vOneLotValue) ? Number(vOneLotValue.toFixed(2)) : null,
                livePrice: Number.isFinite(vLivePrice) ? Number(vLivePrice.toFixed(2)) : null,
                selectedFuturePositionValue: Number.isFinite(vSelectedFuturePositionValue) ? Number(vSelectedFuturePositionValue.toFixed(2)) : null,
                balances: arrRows
            }
        });
    }
    catch (objError) {
        res.status(500).json({
            status: "danger",
            message: objError instanceof Error ? objError.message : "Unable to fetch Delta wallet balance."
        });
    }
}

export async function getRollingOptionsLtDeImportableOpenPositions(req: Request, res: Response): Promise<void> {
    const vProfileId = await resolveProfileId(req);
    if (!vProfileId) {
        res.status(400).json({ status: "warning", message: "API profile is required." });
        return;
    }

    try {
        const { client, profile } = await getDeltaClientForProfile(req, vProfileId);
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
                underlying_asset_symbol: String((await readLiveProfile(getAccountId(req))).uiState?.symbol || "BTC").trim().toUpperCase() || "BTC"
            });
        const objPayload = readResponsePayload(objResponse);
        const arrRows = Array.isArray(objPayload.result) ? objPayload.result as DeltaPositionRow[] : [];
        const arrPositions = arrRows
            .map(mapLivePosition)
            .filter((objRow) => objRow.qty > 0);
        const arrOptionContracts = arrPositions
            .filter((objRow) => String(objRow.contractName || "").trim().toUpperCase().startsWith("C-") || String(objRow.contractName || "").trim().toUpperCase().startsWith("P-"))
            .map((objRow) => String(objRow.contractName || "").trim())
            .filter(Boolean);
        const objTickerByContract = new Map<string, Awaited<ReturnType<typeof getLiveOptionTicker>>>();
        await Promise.all(arrOptionContracts.map(async (pContractName) => {
            objTickerByContract.set(pContractName, await getLiveOptionTicker(pContractName));
        }));
        const arrEnrichedPositions = arrPositions.map((objRow) => {
            const objTicker = objTickerByContract.get(String(objRow.contractName || "").trim()) || null;
            const vDelta = objTicker && Number.isFinite(Number(objTicker.delta))
                ? Math.abs(Number(objTicker.delta))
                : null;
            if (vDelta === null) {
                return objRow;
            }
            return {
                ...objRow,
                entryDelta: vDelta,
                currentDelta: vDelta
            };
        });

        res.json({
            status: "success",
            data: {
                profileId: profile.profileId,
                profileName: profile.referenceName,
                positions: arrEnrichedPositions
            }
        });
    }
    catch (objError) {
        res.status(500).json({
            status: "danger",
            message: objError instanceof Error ? objError.message : "Unable to fetch Delta open positions."
        });
    }
}

export async function getRollingOptionsLtDeClosedPositions(req: Request, res: Response): Promise<void> {
    const vProfileId = await resolveProfileId(req);
    if (!vProfileId) {
        res.status(400).json({ status: "warning", message: "API profile is required." });
        return;
    }

    try {
        const { client, profile } = await getDeltaClientForProfile(req, vProfileId);
        const vPageSize = 100;
        const arrRows: DeltaOrderHistoryRow[] = [];
        let vAfterCursor = "";
        let vSafetyCounter = 0;
        const vStartTime = toEpochMicros(String(req.query?.fromDate || ""));
        const vEndTime = toEpochMicros(String(req.query?.toDate || ""), true);

        while (vSafetyCounter < 100) {
            const objParams: Record<string, string | number> = {
                page_size: vPageSize
            };
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
            message: objError instanceof Error ? objError.message : "Unable to fetch Delta closed positions."
        });
    }
}
