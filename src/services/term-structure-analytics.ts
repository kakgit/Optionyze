/**
 * Optionyze — Signal B: Term Structure Normalization
 * Backend analytics module for the Calendar Spread page.
 */

const DELTA_BASE = "https://api.india.delta.exchange/v2";

interface DeltaTickerRow {
    symbol?: string;
    contract_type?: string;
    underlying_asset_symbol?: string;
    expiry_date?: string;
    strike_price?: string | number;
    best_bid?: string | number;
    best_ask?: string | number;
    mark_price?: string | number;
    spot_price?: string | number;
    implied_volatility?: string | number;
    mark_vol?: string | number;
    greeks?: { delta?: string | number; gamma?: string | number; vega?: string | number; theta?: string | number };
}

interface DeltaApiResponse<T> { success?: boolean; result?: T; message?: string; }

export interface TermStructureSnapshot {
    symbol: string;
    spot: number | null;
    weekly: { iv: number | null; expiry: string | null; dte: number | null; strike: number | null; delta: number | null };
    monthly: { iv: number | null; expiry: string | null; dte: number | null; strike: number | null; delta: number | null };
    updatedAt: string;
}

export interface TermStructureState {
    symbol: string;
    weeklyIv: number | null;
    monthlyIv: number | null;
    peakWeeklyIv: number | null;
    spread: number | null;
    coolingPoints: number | null;
    condition1: boolean;
    condition2: boolean;
    condition3: boolean;
    tradeTriggered: boolean;
    state: "idle" | "panic" | "cooling" | "normalized" | "executed";
    snapshot: TermStructureSnapshot | null;
    updatedAt: string;
}

const gTermStructureStateByUser = new Map<string, TermStructureState>();
const COOLING_THRESHOLD_POINTS = 5.0;
const TARGET_WEEKLY_DTE = 7;
const TARGET_MONTHLY_DTE = 30;
const STRANGLE_TARGET_DELTA = 0.15;

function toFiniteNumber(pValue: unknown, pFallback: number = Number.NaN): number {
    const v = Number(pValue);
    return Number.isFinite(v) ? v : pFallback;
}

async function fetchDeltaJson<T>(pPath: string, pParams?: URLSearchParams): Promise<T> {
    const vUrl = `${DELTA_BASE}${pPath}${pParams ? `?${pParams.toString()}` : ""}`;
    const objResponse = await fetch(vUrl, { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!objResponse.ok) {
        throw new Error(`Delta Exchange request failed (${objResponse.status}) for ${pPath}`);
    }
    return (await objResponse.json()) as Promise<T>;
}

function normalizeExpiryLabel(pRaw: string | undefined): string | null {
    if (!pRaw) return null;
    const v = String(pRaw).trim();
    return v || null;
}

function parseExpiryDate(pLabel: string): Date | null {
    const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(pLabel));
    if (!m) return null;
    const vDate = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 0, 0, 0));
    return Number.isFinite(vDate.getTime()) ? vDate : null;
}

function computeDteDays(pExpiryLabel: string): number | null {
    const vExpiry = parseExpiryDate(pExpiryLabel);
    if (!vExpiry) return null;
    return (vExpiry.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
}

async function getSpotPrice(pSymbol: string): Promise<number | null> {
    const vTickerSymbol = String(pSymbol || "BTC").toUpperCase().endsWith("USD")
        ? String(pSymbol).toUpperCase()
        : `${String(pSymbol).toUpperCase()}USD`;
    try {
        const objResponse = await fetchDeltaJson<DeltaApiResponse<DeltaTickerRow>>(
            `/tickers/${encodeURIComponent(vTickerSymbol)}`
        );
        const objRow = (objResponse?.result || {}) as DeltaTickerRow;
        const vMark = toFiniteNumber(objRow.mark_price, NaN);
        const vSpot = toFiniteNumber(objRow.spot_price, NaN);
        const vResolved = Number.isFinite(vSpot) ? vSpot : (Number.isFinite(vMark) ? vMark : null);
        return vResolved;
    } catch {
        return null;
    }
}

async function discoverExpiries(pUnderlying: string): Promise<string[]> {
    const vUnderlying = String(pUnderlying || "BTC").toUpperCase();
    const vParams = new URLSearchParams({
        contract_types: "call_options,put_options",
        underlying_asset_symbols: vUnderlying
    });
    try {
        const objResponse = await fetchDeltaJson<DeltaApiResponse<DeltaTickerRow[]>>("/tickers", vParams);
        const arrRows = Array.isArray(objResponse?.result) ? objResponse.result : [];
        const vSet = new Set<string>();
        for (const objRow of arrRows) {
            const vLabel = normalizeExpiryLabel(objRow.expiry_date);
            if (vLabel) vSet.add(vLabel);
        }
        return Array.from(vSet).sort();
    } catch {
        return [];
    }
}

function findClosestExpiry(pExpiries: string[], pTargetDte: number): string | null {
    if (!pExpiries.length) return null;
    let vBest: string | null = null;
    let vBestDiff = Infinity;
    let vBestFuture = false;
    for (const vLabel of pExpiries) {
        const vDte = computeDteDays(vLabel);
        if (vDte === null) continue;
        const vIsFuture = vDte > 0;
        const vDiff = Math.abs(vDte - pTargetDte);
        const vBetter = vIsFuture && !vBestFuture
            ? true
            : (vIsFuture === vBestFuture && vDiff < vBestDiff);
        if (vBetter) {
            vBest = vLabel;
            vBestDiff = vDiff;
            vBestFuture = vIsFuture;
        }
    }
    return vBest;
}

async function fetchOptionChainRows(
    pUnderlying: string,
    pExpiryDate: string,
    pSide: "call" | "put"
): Promise<{ strike: number; delta: number | null; iv: number | null; symbol: string }[]> {
    const vUnderlying = String(pUnderlying || "BTC").toUpperCase();
    const vContractType = pSide === "call" ? "call_options" : "put_options";
    const vParams = new URLSearchParams({
        contract_types: vContractType,
        underlying_asset_symbols: vUnderlying,
        expiry_date: pExpiryDate
    });
    try {
        const objResponse = await fetchDeltaJson<DeltaApiResponse<DeltaTickerRow[]>>("/tickers", vParams);
        const arrRows = Array.isArray(objResponse?.result) ? objResponse.result : [];
        return arrRows
            .map((objRow) => ({
                strike: toFiniteNumber(objRow.strike_price, NaN),
                delta: toFiniteNumber(objRow.greeks?.delta, NaN),
                iv: toFiniteNumber(objRow.mark_vol ?? objRow.implied_volatility, NaN),
                symbol: String(objRow.symbol || "").trim()
            }))
            .filter((objRow) => Number.isFinite(objRow.strike) && objRow.strike > 0)
            .sort((pA, pB) => pA.strike - pB.strike);
    } catch {
        return [];
    }
}

async function getAtmImpliedVolatility(
    pUnderlying: string,
    pSpot: number | null,
    pExpiryDate: string,
    pSide: "call" | "put"
): Promise<{ iv: number | null; strike: number | null; delta: number | null; symbol: string }> {
    const vEmpty = { iv: null, strike: null, delta: null, symbol: "" };
    if (pSpot === null || !(pSpot > 0)) return vEmpty;
    const arrRows = await fetchOptionChainRows(pUnderlying, pExpiryDate, pSide);
    if (!arrRows.length) return vEmpty;
    const vFirst = arrRows[0];
    if (!vFirst) return vEmpty;
    let vBest = vFirst;
    let vBestDiff = Math.abs(vBest.strike - pSpot);
    for (const objRow of arrRows.slice(1)) {
        const vDiff = Math.abs(objRow.strike - pSpot);
        if (vDiff < vBestDiff) {
            vBest = objRow;
            vBestDiff = vDiff;
        }
    }
    return {
        iv: (vBest.iv != null && Number.isFinite(vBest.iv) && vBest.iv > 0 ? vBest.iv : null),
        strike: vBest.strike,
        delta: Number.isFinite(vBest.delta) ? vBest.delta : null,
        symbol: vBest.symbol
    };
}

export async function fetchTermStructureSnapshot(pSymbol: string): Promise<TermStructureSnapshot> {
    const vSymbol = String(pSymbol || "BTC").toUpperCase();
    const vUnderlying = vSymbol.endsWith("USD") ? vSymbol.slice(0, -3) : vSymbol;
    const vSpot = await getSpotPrice(vSymbol);
    const arrExpiries = await discoverExpiries(vUnderlying);
    const vWeeklyExpiry = findClosestExpiry(arrExpiries, TARGET_WEEKLY_DTE);
    const vMonthlyExpiry = findClosestExpiry(arrExpiries, TARGET_MONTHLY_DTE);
    const [objWeekly, objMonthly] = await Promise.all([
        vWeeklyExpiry ? getAtmImpliedVolatility(vUnderlying, vSpot, vWeeklyExpiry, "call")
            : Promise.resolve({ iv: null, strike: null, delta: null, symbol: "" }),
        vMonthlyExpiry ? getAtmImpliedVolatility(vUnderlying, vSpot, vMonthlyExpiry, "call")
            : Promise.resolve({ iv: null, strike: null, delta: null, symbol: "" })
    ]);
    return {
        symbol: vSymbol,
        spot: vSpot,
        weekly: { iv: objWeekly.iv, expiry: vWeeklyExpiry ?? null,
            dte: vWeeklyExpiry ? computeDteDays(vWeeklyExpiry) : null, strike: objWeekly.strike, delta: objWeekly.delta },
        monthly: { iv: objMonthly.iv, expiry: vMonthlyExpiry ?? null,
            dte: vMonthlyExpiry ? computeDteDays(vMonthlyExpiry) : null, strike: objMonthly.strike, delta: objMonthly.delta },
        updatedAt: new Date().toISOString()
    };
}


export async function fetchAtmOptionForExpiry(
    pSymbol: string,
    pExpiryDate: string,
    pSide: "call" | "put" = "call"
): Promise<{ symbol: string; underlying: string; spot: number | null; expiry: string; iv: number | null; strike: number | null; delta: number | null; optionSymbol: string; side: "call" | "put" }> {
    const vSymbol = String(pSymbol || "BTC").toUpperCase();
    const vUnderlying = vSymbol.endsWith("USD") ? vSymbol.slice(0, -3) : vSymbol;
    const vExpiry = String(pExpiryDate || "").trim();
    const vSide: "call" | "put" = pSide === "put" ? "put" : "call";
    const vSpot = await getSpotPrice(vSymbol);
    const objAtm = vExpiry
        ? await getAtmImpliedVolatility(vUnderlying, vSpot, vExpiry, vSide)
        : { iv: null, strike: null, delta: null, symbol: "" };
    return {
        symbol: vSymbol,
        underlying: vUnderlying,
        spot: vSpot,
        expiry: vExpiry,
        iv: objAtm.iv,
        strike: objAtm.strike,
        delta: objAtm.delta,
        optionSymbol: String(objAtm.symbol || "").trim(),
        side: vSide
    };
}
export function evaluateTermStructureState(
    pUserId: string,
    pSymbol: string,
    pSnapshot: TermStructureSnapshot
): TermStructureState {
    const vKey = `${String(pUserId || "demo")}:${String(pSymbol || "BTC").toUpperCase()}`;
    const vNow = new Date().toISOString();
    const vPrior = gTermStructureStateByUser.get(vKey) || {
        symbol: pSymbol, weeklyIv: null, monthlyIv: null, peakWeeklyIv: null,
        spread: null, coolingPoints: null, condition1: false, condition2: false,
        condition3: false, tradeTriggered: false, state: "idle" as const,
        snapshot: null, updatedAt: vNow
    };
    const vWeeklyIv = pSnapshot.weekly.iv ?? null;
    const vMonthlyIv = pSnapshot.monthly.iv ?? null;
    const vCondition1Now = vWeeklyIv !== null && vMonthlyIv !== null && vWeeklyIv > vMonthlyIv;
    const vCondition3Now = vWeeklyIv !== null && vMonthlyIv !== null && vWeeklyIv <= vMonthlyIv;
    let vState = vPrior.state;
    let vCondition1 = vPrior.condition1;
    let vPeak = vPrior.peakWeeklyIv;
    if (vState === "executed") {
        // Stay executed until explicitly reset.
    } else if (vCondition1Now) {
        vCondition1 = true;
        vPeak = vPeak === null || vWeeklyIv > vPeak ? vWeeklyIv : vPeak;
        vState = vPrior.state === "idle" || vPrior.state === "normalized" ? "panic" : "cooling";
    } else if (vCondition1) {
        if (vWeeklyIv !== null) {
            vPeak = vPeak === null || vWeeklyIv > vPeak ? vWeeklyIv : vPeak;
        }
        vState = "cooling";
    } else {
        vState = "idle";
        vCondition1 = false;
        vPeak = null;
    }
    const vCoolingPoints = vPeak !== null && vWeeklyIv !== null ? Math.max(0, vPeak - vWeeklyIv) : null;
    const vCondition2 = vPeak !== null && vWeeklyIv !== null ? vCoolingPoints! >= COOLING_THRESHOLD_POINTS : false;
    const vTradeTriggered = vCondition1 && vCondition2 && vCondition3Now;
    if (vTradeTriggered && vState !== "executed") {
        vState = "normalized";
    }
    const vNext: TermStructureState = {
        symbol: pSymbol, weeklyIv: vWeeklyIv, monthlyIv: vMonthlyIv, peakWeeklyIv: vPeak,
        spread: vWeeklyIv !== null && vMonthlyIv !== null ? vWeeklyIv - vMonthlyIv : null,
        coolingPoints: vCoolingPoints, condition1: vCondition1, condition2: vCondition2,
        condition3: vCondition3Now, tradeTriggered: vTradeTriggered, state: vState,
        snapshot: pSnapshot, updatedAt: vNow
    };
    gTermStructureStateByUser.set(vKey, vNext);
    return vNext;
}

export function resetTermStructureState(pUserId: string, pSymbol: string): void {
    const vKey = `${String(pUserId || "demo")}:${String(pSymbol || "BTC").toUpperCase()}`;
    gTermStructureStateByUser.delete(vKey);
}

export function getTermStructureState(pUserId: string, pSymbol: string): TermStructureState | null {
    const vKey = `${String(pUserId || "demo")}:${String(pSymbol || "BTC").toUpperCase()}`;
    return gTermStructureStateByUser.has(vKey) ? gTermStructureStateByUser.get(vKey)! : null;
}

interface StrangleTarget {
    side: "call" | "put";
    strike: number;
    delta: number | null;
    symbol: string;
}

async function findNearestDeltaStrike(
    pUnderlying: string,
    pExpiryDate: string,
    pSide: "call" | "put",
    pTargetDelta: number
): Promise<StrangleTarget | null> {
    const arrRows = await fetchOptionChainRows(pUnderlying, pExpiryDate, pSide);
    const arrCandidates = arrRows.filter((objRow) => objRow.delta !== null);
    if (!arrCandidates.length) return null;
    let vBest: StrangleTarget | null = null;
    let vBestDiff = Infinity;
    for (const objRow of arrCandidates) {
        const vDelta = objRow.delta!;
        const vTarget = pSide === "call" ? pTargetDelta : -pTargetDelta;
        const vSigned = pSide === "call" ? vDelta : -Math.abs(vDelta);
        const vDiff = Math.abs(vSigned - vTarget);
        if (vDiff < vBestDiff) {
            vBestDiff = vDiff;
            vBest = { side: pSide, strike: objRow.strike, delta: vDelta, symbol: objRow.symbol };
        }
    }
    return vBest;
}

export async function executeTermStructureStrangle(
    pUserId: string,
    pSymbol: string,
    pSelectedApiProfileId: string
): Promise<{ ok: boolean; message: string; targets: StrangleTarget[]; orders: unknown[] }> {
    const vSymbol = String(pSymbol || "BTC").toUpperCase();
    const vUnderlying = vSymbol.endsWith("USD") ? vSymbol.slice(0, -3) : vSymbol;
    const vTargets: StrangleTarget[] = [];
    const vOrders: unknown[] = [];
    const arrExpiries = await discoverExpiries(vUnderlying);
    const vWeeklyExpiry = findClosestExpiry(arrExpiries, TARGET_WEEKLY_DTE);
    if (!vWeeklyExpiry) {
        return { ok: false, message: "No weekly (7-DTE) expiry found on Delta Exchange.", targets: [], orders: [] };
    }
    const [objCallTarget, objPutTarget] = await Promise.all([
        findNearestDeltaStrike(vUnderlying, vWeeklyExpiry, "call", STRANGLE_TARGET_DELTA),
        findNearestDeltaStrike(vUnderlying, vWeeklyExpiry, "put", STRANGLE_TARGET_DELTA)
    ]);
    if (objCallTarget) vTargets.push(objCallTarget);
    if (objPutTarget) vTargets.push(objPutTarget);
    if (vTargets.length !== 2) {
        return {
            ok: false,
            message: `Could not resolve both 0.15-delta strangle legs for ${vWeeklyExpiry} (found ${vTargets.length}/2).`,
            targets: vTargets,
            orders: []
        };
    }
    const DeltaRestClient = require("delta-rest-client");
    const { getDeltaApiProfile } = require("../../storage/delta-api-profile-store");
    let objProfile: any = null;
    try {
        objProfile = await getDeltaApiProfile(pUserId, pSelectedApiProfileId);
    } catch {
        // fall through to error below
    }
    if (!objProfile) {
        return {
            ok: false,
            message: "No connected Delta API profile. Connect an API profile on the Calendar Spread page before executing.",
            targets: vTargets,
            orders: []
        };
    }
    const objClient = await new DeltaRestClient(objProfile.apiKey, objProfile.apiSecret);
    for (const objTarget of vTargets) {
        const vOrderPayload = {
            product_symbol: objTarget.symbol || `${vUnderlying}-${vWeeklyExpiry}-${objTarget.strike}-${objTarget.side === "call" ? "call_options" : "put_options"}`,
            size: 1,
            side: "sell",
            order_type: "market_order",
            time_in_force: "gtc",
            reduce_only: false
        };
        try {
            const objResponse = await objClient.apis.Orders.placeOrder({ order: vOrderPayload });
            const objPayload = (objResponse && typeof objResponse === "object")
                ? (objResponse as Record<string, unknown>)
                : {};
            const objData = (objPayload.data || objPayload.result || {}) as Record<string, unknown>;
            vOrders.push({
                symbol: objTarget.symbol,
                side: objTarget.side,
                strike: objTarget.strike,
                delta: objTarget.delta,
                orderId: objData.id || objData.order_id || "",
                success: objPayload.success === true || Boolean(objData.id || objData.order_id)
            });
        } catch (objError) {
            vOrders.push({
                symbol: objTarget.symbol,
                side: objTarget.side,
                strike: objTarget.strike,
                delta: objTarget.delta,
                orderId: "",
                success: false,
                error: (objError && typeof objError === "object" && "message" in objError)
                    ? String((objError as { message?: unknown }).message)
                    : String(objError)
            });
        }
    }
    const vAllOk = vOrders.every((objOrder) => (objOrder as { success: boolean }).success === true);
    return {
        ok: vAllOk,
        message: vAllOk
            ? `Short strangle executed on ${vWeeklyExpiry} (0.15-delta CE/PE).`
            : "Short strangle placement partially failed. Review order results.",
        targets: vTargets,
        orders: vOrders
    };
}

