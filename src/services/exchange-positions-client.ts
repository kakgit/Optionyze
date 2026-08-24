import crypto from "node:crypto";
import { signCoinSwitchRequest } from "./coinswitch-hft-client";

const gDeltaIndiaApiBase = "https://api.india.delta.exchange";
const gCoinSwitchHftBase = "https://dma.coinswitch.co";

export interface ExchangeCredentials {
    deltaApiKey: string;
    deltaApiSecret: string;
    coinswitchApiKey: string;
    coinswitchApiSecret: string;
}

export interface ExchangePositionRow {
    source: "delta" | "coinswitch";
    symbol: string;
    positionSide: "long" | "short";
    side: "call" | "put";
    baseCoin: string;
    strike: number;
    size: number;
    entryPrice: number;
    markPrice: number;
}

interface ExchangeFetchOutcome {
    ok: boolean;
    positions: ExchangePositionRow[];
    error: string;
    ipWhitelistRequired: boolean;
    clientIp: string;
}

interface DeltaPositionRow {
    product_symbol?: string;
    size?: string | number;
    entry_price?: string | number;
    mark_price?: string | number;
}

interface BybitPositionListRow {
    symbol?: string;
    side?: string;
    size?: string | number;
    avgPrice?: string | number;
    markPrice?: string | number;
}

function toFiniteNumber(pValue: unknown): number {
    const vNumber = Number(pValue);
    return Number.isFinite(vNumber) ? vNumber : 0;
}

/**
 * Parses option symbols in the formats used by the two exchanges:
 * - CoinSwitch/Bybit: `BTC-25SEP26-50000-C` or `BTC-22AUG26-50000-P-USDT`
 * - Delta Exchange:   `C-BTC-77000-230826` / `P-BTC-77000-230826` (side prefix, DDMMYY date)
 * Returns null when the symbol is not a recognizable option contract.
 */
export function parseOptionSymbol(pSymbol: string): { baseCoin: string; strike: number; side: "call" | "put" } | null {
    const vClean = String(pSymbol || "").trim().toUpperCase().replace(/-USDT$/, "");
    const arrParts = vClean.split("-");
    // Delta format: C-BTC-77000-230826 (side prefix first, date last)
    if (arrParts.length === 4 && (arrParts[0] === "C" || arrParts[0] === "P")) {
        const vStrike = Number(arrParts[2]);
        if (Number.isFinite(vStrike) && vStrike > 0 && arrParts[1] && arrParts[3]) {
            return { baseCoin: arrParts[1], strike: vStrike, side: arrParts[0] === "C" ? "call" : "put" };
        }
        return null;
    }
    // CoinSwitch/Bybit format: BTC-25SEP26-50000-C (base first, side suffix last)
    if (arrParts.length === 4 && (arrParts[3] === "C" || arrParts[3] === "P")) {
        const vStrike = Number(arrParts[2]);
        if (!Number.isFinite(vStrike) || vStrike <= 0 || !arrParts[0] || !arrParts[1]) {
            return null;
        }
        return { baseCoin: arrParts[0], strike: vStrike, side: arrParts[3] === "C" ? "call" : "put" };
    }
    // Short format: BTC-50000-C
    if (arrParts.length === 3 && (arrParts[2] === "C" || arrParts[2] === "P")) {
        const vStrike = Number(arrParts[1]);
        if (Number.isFinite(vStrike) && vStrike > 0 && arrParts[0]) {
            return { baseCoin: arrParts[0], strike: vStrike, side: arrParts[2] === "C" ? "call" : "put" };
        }
    }
    return null;
}


function signDeltaGet(pApiSecret: string, pPathWithQuery: string, pTimestampSeconds: number): string {
    const vMessage = `GET${pTimestampSeconds}${pPathWithQuery}`;
    return crypto.createHmac("sha256", String(pApiSecret || "")).update(vMessage).digest("hex");
}

async function fetchDeltaPositionsRaw(
    pApiKey: string,
    pApiSecret: string,
    pUnderlyingAssetSymbol: string
): Promise<DeltaPositionRow[]> {
    const objParams = new URLSearchParams();
    const vUnderlying = String(pUnderlyingAssetSymbol || "").trim().toUpperCase();
    if (vUnderlying) {
        objParams.set("underlying_asset_symbols", vUnderlying);
    }
    const vQuery = objParams.toString();
    const vPath = `/v2/positions/margined${vQuery ? `?${vQuery}` : ""}`;
    const vTimestamp = Math.floor(Date.now() / 1000);
    const objResponse = await fetch(`${gDeltaIndiaApiBase}${vPath}`, {
        method: "GET",
        headers: {
            Accept: "application/json",
            "api-key": pApiKey,
            timestamp: String(vTimestamp),
            signature: signDeltaGet(pApiSecret, vPath, vTimestamp),
            "User-Agent": "Optionyze/1.0"
        }
    });
    const vText = await objResponse.text();
    let objJson: {
        success?: boolean;
        result?: DeltaPositionRow[];
        error?: {
            code?: string;
            context?: { client_ip?: string };
        };
    } = {};
    try {
        objJson = vText ? JSON.parse(vText) as typeof objJson : {};
    }
    catch (_objError) {
        throw new Error(`Delta positions response was not JSON (HTTP ${objResponse.status}): ${vText.slice(0, 120)}`);
    }
    if (!objResponse.ok || objJson.success === false) {
        throw new Error(buildDeltaErrorMessage(objJson, objResponse.status));
    }
    return Array.isArray(objJson.result) ? objJson.result : [];
}

function buildDeltaErrorMessage(
    pJson: { error?: { code?: string; context?: { client_ip?: string } } },
    pStatus: number
): string {
    const vCode = String(pJson.error?.code || "").trim();
    if (vCode === "ip_not_whitelisted_for_api_key") {
        const vClientIp = String(pJson.error?.context?.client_ip || "").trim();
        return "Delta rejected this API key because the server IP is not whitelisted."
            + (vClientIp ? ` Add IP ${vClientIp} to the API key's whitelist in Delta Exchange account settings.` : "");
    }
    if (vCode === "unauthorized" || pStatus === 401) {
        return "Delta authentication failed. Check the Delta API key and secret saved for this profile.";
    }
    if (vCode) {
        return `Delta positions request failed: ${vCode} (HTTP ${pStatus}).`;
    }
    return `Delta positions request failed (HTTP ${pStatus}).`;
}

async function fetchCoinswitchPositionsRaw(
    pApiKey: string,
    pApiSecret: string,
    pSettleCoin: string
): Promise<BybitPositionListRow[]> {
    const objParams = new URLSearchParams({
        category: "option",
        settleCoin: String(pSettleCoin || "USDT").trim().toUpperCase()
    });
    const vPathWithQuery = `/v5/position/list?${objParams.toString()}`;
    const objSigned = signCoinSwitchRequest("GET", vPathWithQuery, pApiSecret);
    const objResponse = await fetch(`${gCoinSwitchHftBase}${vPathWithQuery}`, {
        method: "GET",
        headers: {
            Accept: "application/json",
            "X-AUTH-APIKEY": pApiKey,
            "X-AUTH-SIGNATURE": objSigned.signature,
            "X-AUTH-EPOCH": objSigned.epoch
        }
    });
    const vText = await objResponse.text();
    let objJson: { retCode?: number; retMsg?: string; result?: { list?: BybitPositionListRow[] } } = {};
    try {
        objJson = vText ? JSON.parse(vText) as typeof objJson : {};
    }
    catch (_objError) {
        throw new Error(`CoinSwitch positions response was not JSON (HTTP ${objResponse.status}).`);
    }
    if (!objResponse.ok || Number(objJson.retCode ?? 0) !== 0) {
        throw new Error(objJson.retMsg || `CoinSwitch positions request failed (HTTP ${objResponse.status}).`);
    }
    return Array.isArray(objJson.result?.list) ? objJson.result.list : [];
}

function mapDeltaRows(pRows: DeltaPositionRow[]): ExchangePositionRow[] {
    const arrOut: ExchangePositionRow[] = [];
    for (const objRow of pRows) {
        const vSymbol = String(objRow.product_symbol || "").trim().toUpperCase();
        const objParsed = parseOptionSymbol(vSymbol);
        if (!objParsed) {
            continue;
        }
        const vSignedSize = toFiniteNumber(objRow.size);
        if (!(Math.abs(vSignedSize) > 0)) {
            continue;
        }
        arrOut.push({
            source: "delta",
            symbol: vSymbol,
            positionSide: vSignedSize >= 0 ? "long" : "short",
            side: objParsed.side,
            baseCoin: objParsed.baseCoin,
            strike: objParsed.strike,
            size: Math.abs(vSignedSize),
            entryPrice: toFiniteNumber(objRow.entry_price),
            markPrice: toFiniteNumber(objRow.mark_price)
        });
    }
    return arrOut.sort((a, b) => a.side.localeCompare(b.side) || a.strike - b.strike);
}

function mapCoinswitchRows(pRows: BybitPositionListRow[]): ExchangePositionRow[] {
    const arrOut: ExchangePositionRow[] = [];
    for (const objRow of pRows) {
        const vSymbol = String(objRow.symbol || "").trim().toUpperCase();
        const objParsed = parseOptionSymbol(vSymbol);
        if (!objParsed) {
            continue;
        }
        const vSize = Math.abs(toFiniteNumber(objRow.size));
        if (!(vSize > 0)) {
            continue;
        }
        arrOut.push({
            source: "coinswitch",
            symbol: vSymbol,
            positionSide: String(objRow.side || "").trim().toLowerCase() === "sell" ? "short" : "long",
            side: objParsed.side,
            baseCoin: objParsed.baseCoin,
            strike: objParsed.strike,
            size: vSize,
            entryPrice: toFiniteNumber(objRow.avgPrice),
            markPrice: toFiniteNumber(objRow.markPrice)
        });
    }
    return arrOut.sort((a, b) => a.side.localeCompare(b.side) || a.strike - b.strike);
}

export async function fetchDeltaExchangePositions(
    pCredentials: Pick<ExchangeCredentials, "deltaApiKey" | "deltaApiSecret">,
    pUnderlyingAssetSymbol: string
): Promise<ExchangeFetchOutcome> {
    const vApiKey = String(pCredentials.deltaApiKey || "").trim();
    const vApiSecret = String(pCredentials.deltaApiSecret || "").trim();
    if (!vApiKey || !vApiSecret) {
        return { ok: false, positions: [], error: "Delta API credentials are missing.", ipWhitelistRequired: false, clientIp: "" };
    }
    try {
        const arrRows = await fetchDeltaPositionsRaw(vApiKey, vApiSecret, pUnderlyingAssetSymbol);
        return { ok: true, positions: mapDeltaRows(arrRows), error: "", ipWhitelistRequired: false, clientIp: "" };
    }
    catch (objError) {
        const vMessage = objError instanceof Error ? objError.message : "Unable to load Delta positions.";
        const vWhitelistRequired = vMessage.includes("not whitelisted");
        const vIpMatch = vMessage.match(/IP\s+([0-9A-Fa-f:.]+)/);
        return {
            ok: false,
            positions: [],
            error: vMessage,
            ipWhitelistRequired: vWhitelistRequired,
            clientIp: vIpMatch ? vIpMatch[1] : ""
        };
    }
}

export interface WalletBalanceOutcome {
    ok: boolean;
    availableBalance: number;
    currency: string;
    error: string;
    ipWhitelistRequired: boolean;
    clientIp: string;
}

function buildWalletError(pMessage: string): WalletBalanceOutcome {
    const vWhitelistRequired = pMessage.includes("not whitelisted");
    const vIpMatch = pMessage.match(/IP\s+([0-9A-Fa-f:.]+)/);
    return {
        ok: false,
        availableBalance: 0,
        currency: "",
        error: pMessage,
        ipWhitelistRequired: vWhitelistRequired,
        clientIp: vIpMatch ? vIpMatch[1] : ""
    };
}

export async function fetchDeltaOptionsAvailableBalance(
    pCredentials: Pick<ExchangeCredentials, "deltaApiKey" | "deltaApiSecret">
): Promise<WalletBalanceOutcome> {
    const vApiKey = String(pCredentials.deltaApiKey || "").trim();
    const vApiSecret = String(pCredentials.deltaApiSecret || "").trim();
    if (!vApiKey || !vApiSecret) {
        return buildWalletError("Delta API credentials are missing.");
    }
    try {
        const vPath = "/v2/wallet/balances";
        const vTimestamp = Math.floor(Date.now() / 1000);
        const objResponse = await fetch(`${gDeltaIndiaApiBase}${vPath}`, {
            method: "GET",
            headers: {
                Accept: "application/json",
                "api-key": vApiKey,
                timestamp: String(vTimestamp),
                signature: signDeltaGet(vApiSecret, vPath, vTimestamp),
                "User-Agent": "Optionyze/1.0"
            }
        });
        const vText = await objResponse.text();
        let objJson: {
            success?: boolean;
            result?: Array<{ asset_symbol?: string; available_balance?: string | number }>;
            error?: { code?: string; context?: { client_ip?: string } };
        } = {};
        try {
            objJson = vText ? JSON.parse(vText) as typeof objJson : {};
        }
        catch (_objError) {
            throw new Error(`Delta balance response was not JSON (HTTP ${objResponse.status}).`);
        }
        if (!objResponse.ok || objJson.success === false) {
            throw new Error(buildDeltaErrorMessage(objJson, objResponse.status));
        }
        const arrRows = Array.isArray(objJson.result) ? objJson.result : [];
        const objUsd = arrRows.find((objRow) => String(objRow.asset_symbol || "").trim().toUpperCase() === "USD");
        return {
            ok: true,
            availableBalance: toFiniteNumber(objUsd?.available_balance),
            currency: "USD",
            error: "",
            ipWhitelistRequired: false,
            clientIp: ""
        };
    }
    catch (objError) {
        return buildWalletError(objError instanceof Error ? objError.message : "Unable to load Delta balance.");
    }
}

export async function fetchCoinswitchOptionsAvailableBalance(
    pCredentials: Pick<ExchangeCredentials, "coinswitchApiKey" | "coinswitchApiSecret">
): Promise<WalletBalanceOutcome> {
    const vApiKey = String(pCredentials.coinswitchApiKey || "").trim();
    const vApiSecret = String(pCredentials.coinswitchApiSecret || "").trim();
    if (!vApiKey || !vApiSecret) {
        return buildWalletError("CoinSwitch API credentials are missing.");
    }
    try {
        const vPathWithQuery = "/v5/account/wallet-balance?accountType=UNIFIED";
        const objSigned = signCoinSwitchRequest("GET", vPathWithQuery, vApiSecret);
        const objResponse = await fetch(`${gCoinSwitchHftBase}${vPathWithQuery}`, {
            method: "GET",
            headers: {
                Accept: "application/json",
                "X-AUTH-APIKEY": vApiKey,
                "X-AUTH-SIGNATURE": objSigned.signature,
                "X-AUTH-EPOCH": objSigned.epoch
            }
        });
        const vText = await objResponse.text();
        let objJson: {
            retCode?: number;
            retMsg?: string;
            result?: { list?: Array<{ totalAvailableBalance?: string | number }> };
        } = {};
        try {
            objJson = vText ? JSON.parse(vText) as typeof objJson : {};
        }
        catch (_objError) {
            throw new Error(`CoinSwitch balance response was not JSON (HTTP ${objResponse.status}).`);
        }
        if (!objResponse.ok || Number(objJson.retCode ?? 0) !== 0) {
            throw new Error(objJson.retMsg || `CoinSwitch balance request failed (HTTP ${objResponse.status}).`);
        }
        const objAccount = Array.isArray(objJson.result?.list) ? objJson.result.list[0] : null;
        return {
            ok: true,
            availableBalance: toFiniteNumber(objAccount?.totalAvailableBalance),
            currency: "USDT",
            error: "",
            ipWhitelistRequired: false,
            clientIp: ""
        };
    }
    catch (objError) {
        return buildWalletError(objError instanceof Error ? objError.message : "Unable to load CoinSwitch balance.");
    }
}

export async function fetchCoinswitchExchangePositions(
    pCredentials: Pick<ExchangeCredentials, "coinswitchApiKey" | "coinswitchApiSecret">,
    pSettleCoin: string
): Promise<ExchangeFetchOutcome> {
    const vApiKey = String(pCredentials.coinswitchApiKey || "").trim();
    const vApiSecret = String(pCredentials.coinswitchApiSecret || "").trim();
    if (!vApiKey || !vApiSecret) {
        return { ok: false, positions: [], error: "CoinSwitch API credentials are missing.", ipWhitelistRequired: false, clientIp: "" };
    }
    try {
        const arrRows = await fetchCoinswitchPositionsRaw(vApiKey, vApiSecret, pSettleCoin);
        return { ok: true, positions: mapCoinswitchRows(arrRows), error: "", ipWhitelistRequired: false, clientIp: "" };
    }
    catch (objError) {
        return {
            ok: false,
            positions: [],
            error: objError instanceof Error ? objError.message : "Unable to load CoinSwitch positions.",
            ipWhitelistRequired: false,
            clientIp: ""
        };
    }
}


