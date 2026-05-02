import type { Request, Response } from "express";
const DeltaRestClient = require("delta-rest-client");
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
import { gRollingOptionsTelegramEventTypes } from "../../strategies/rolling-options-pt-de/event-logger";
import { findBestLiveOptionContract, getLiveMarketSnapshot } from "../../strategies/rolling-options-pt-de/market-data";

interface DeltaWalletBalanceRow {
    asset_symbol?: string;
    symbol?: string;
    available_balance?: number | string | null;
    balance?: number | string | null;
    wallet_balance?: number | string | null;
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

interface DeltaFillRow {
    id?: number | string | null;
    size?: number | string | null;
    side?: string | null;
    price?: number | string | null;
    commission?: number | string | null;
    created_at?: string | number | null;
    product_id?: number | string | null;
    product_symbol?: string | null;
    order_id?: string | number | null;
    meta_data?: {
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
        pnl: Number((toFiniteNumber(pRow.realized_pnl, 0) + toFiniteNumber(pRow.unrealized_pnl, 0)).toFixed(2)),
        margin: toFiniteNumber(pRow.margin, 0),
        liquidationPrice: toFiniteNumber(pRow.liquidation_price, 0)
    };
}

function toEpochMicros(pDateValue: string, pEndOfMinute = false): number | null {
    const vValue = String(pDateValue || "").trim();
    if (!vValue) {
        return null;
    }

    const objDate = new Date(vValue);
    if (Number.isNaN(objDate.getTime())) {
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

function mapLiveClosedPosition(pRow: DeltaFillRow, pIndex: number) {
    const vSide = String(pRow.side || "").trim().toUpperCase();
    const vPrice = toFiniteNumber(pRow.price, 0);
    const vQty = Math.abs(toFiniteNumber(pRow.size, 0));
    const vCommission = toFiniteNumber(pRow.commission, 0);
    const vCreatedAt = String(pRow.created_at || "").trim();

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
        pnl: null,
        startAt: vCreatedAt,
        endAt: vCreatedAt,
        orderType: formatOrderType(pRow.meta_data?.order_type)
    };
}

function getContractNameForSymbol(pSymbol: string): string {
    return String(pSymbol || "").trim().toUpperCase() === "ETH" ? "ETHUSD" : "BTCUSD";
}

function getLotSizeForSymbol(pSymbol: string): number {
    return String(pSymbol || "").trim().toUpperCase() === "ETH" ? 0.01 : 0.001;
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
        data: objProfile
    });
}

export async function saveRollingOptionsLtDeProfileController(req: Request, res: Response): Promise<void> {
    const vUserId = getAccountId(req);
    const objExisting = await readLiveProfile(vUserId);
    const vSelectedApiProfileId = String(req.body?.selectedApiProfileId || "").trim();
    const objSaved = await saveRollingOptionsLtDeProfile({
        ...objExisting,
        userId: vUserId,
        selectedApiProfileId: vSelectedApiProfileId
    });
    await syncLiveRuntimeProfileSelection(vUserId, vSelectedApiProfileId);
    res.json({
        status: "success",
        message: "Live profile saved.",
        data: objSaved
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
            updatedAt: ""
        }
    });
}

export async function enableRollingOptionsLtDeAutoTrader(req: Request, res: Response): Promise<void> {
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

    const objRuntime = await saveRollingOptionsLtDeRuntime({
        userId: vUserId,
        status: "running",
        autoTraderEnabled: true,
        selectedApiProfileId: vSelectedApiProfileId,
        updatedAt: ""
    });
    res.json({
        status: "success",
        message: "Live auto trader enabled.",
        data: objRuntime
    });
}

export async function disableRollingOptionsLtDeAutoTrader(req: Request, res: Response): Promise<void> {
    const vUserId = getAccountId(req);
    const objRuntime = await saveRollingOptionsLtDeRuntime({
        userId: vUserId,
        status: "stopped",
        autoTraderEnabled: false,
        selectedApiProfileId: String((await readLiveProfile(vUserId)).selectedApiProfileId || "").trim(),
        updatedAt: ""
    });
    res.json({
        status: "success",
        message: "Live auto trader disabled.",
        data: objRuntime
    });
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

        res.json({
            status: "success",
            message: `${vAction} future live order placed using ${profile.referenceName}.`,
            data: {
                order: objPayload.result || objPayload,
                request: objOrderPayload,
                snapshot: {
                    productSymbol: vProductSymbol,
                    futuresPrice: objSnapshot.futuresPrice,
                    spotPrice: objSnapshot.spotPrice
                }
            }
        });
    }
    catch (objError) {
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

        res.json({
            status: "success",
            message: `${vOperation === "exit" ? "Exit" : "Open"} option live order${arrOrders.length === 1 ? "" : "s"} placed using ${profile.referenceName}.`,
            data: {
                operation: vOperation,
                action: vAction,
                qty: vQty,
                orders: arrOrders,
                contracts: arrContracts
            }
        });
    }
    catch (objError) {
        res.status(500).json({
            status: "danger",
            message: getErrorMessage(objError, "Unable to place live option order.")
        });
    }
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
        const { client, profile } = await getDeltaClientForProfile(req, vProfileId);
        const objResponse = await client.apis.Wallet.getBalances();
        const objPayload = readResponsePayload(objResponse);
        const arrRows = Array.isArray(objPayload.result) ? objPayload.result as DeltaWalletBalanceRow[] : [];
        const objUsdRow = pickUsdBalanceRow(arrRows);
        const vAvailableBalance = getAvailableBalanceUsd(objUsdRow);
        const vBlockedMargin = getBlockedMarginUsd(objUsdRow);
        const vTotalBalance = vAvailableBalance + vBlockedMargin;
        const vHealthPct = vTotalBalance > 0 ? Number(((vAvailableBalance / vTotalBalance) * 100).toFixed(2)) : 0;

        res.json({
            status: "success",
            data: {
                profileId: profile.profileId,
                profileName: profile.referenceName,
                currency: String(objUsdRow?.asset_symbol || objUsdRow?.symbol || "USD").toUpperCase(),
                availableBalance: Number(vAvailableBalance.toFixed(2)),
                blockedMargin: Number(vBlockedMargin.toFixed(2)),
                totalBalance: Number(vTotalBalance.toFixed(2)),
                healthPct: vHealthPct,
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
        const objResponse = await client.apis.Positions.getPositions({});
        const objPayload = readResponsePayload(objResponse);
        const arrRows = Array.isArray(objPayload.result) ? objPayload.result as DeltaPositionRow[] : [];
        const arrPositions = arrRows
            .map(mapLivePosition)
            .filter((objRow) => objRow.qty > 0);

        res.json({
            status: "success",
            data: {
                profileId: profile.profileId,
                profileName: profile.referenceName,
                positions: arrPositions
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
        const objParams: Record<string, string | number> = {
            page_size: 50
        };
        const vStartTime = toEpochMicros(String(req.query?.fromDate || ""));
        const vEndTime = toEpochMicros(String(req.query?.toDate || ""), true);
        if (vStartTime) {
            objParams.start_time = vStartTime;
        }
        if (vEndTime) {
            objParams.end_time = vEndTime;
        }

        const objResponse = await client.apis.TradeHistory.getUserfills(objParams);
        const objPayload = readResponsePayload(objResponse);
        const arrRows = Array.isArray(objPayload.result) ? objPayload.result as DeltaFillRow[] : [];
        const arrClosedPositions = arrRows.map(mapLiveClosedPosition);

        res.json({
            status: "success",
            data: {
                profileId: profile.profileId,
                profileName: profile.referenceName,
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
