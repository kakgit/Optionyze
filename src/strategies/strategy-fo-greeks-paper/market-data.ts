const DeltaRestClient = require("delta-rest-client");

import type { MarketOptionSnapshot, MarketSnapshot, StrategyFoGreeksPaperConfig } from "./types";

function toNumber(pValue: unknown, pFallback: number | null = null): number | null {
    const vNumber = Number(pValue);
    return Number.isFinite(vNumber) ? vNumber : pFallback;
}

function inferOptionType(pRow: Record<string, unknown>): "put" | "call" | "" {
    const vContractType = String(
        pRow.contract_type ||
        pRow.contractType ||
        pRow.option_type ||
        pRow.type ||
        ""
    ).toLowerCase();
    if (vContractType.includes("put")) {
        return "put";
    }
    if (vContractType.includes("call")) {
        return "call";
    }

    const vSymbol = String(pRow.symbol || pRow.product_symbol || "").toUpperCase();
    if (vSymbol.includes("PUT") || vSymbol.includes("-P-")) {
        return "put";
    }
    if (vSymbol.includes("CALL") || vSymbol.includes("-C-")) {
        return "call";
    }

    const objGreeks = (pRow.greeks || {}) as Record<string, unknown>;
    const vDelta = Number(objGreeks.delta ?? pRow.delta);
    if (Number.isFinite(vDelta)) {
        return vDelta < 0 ? "put" : "call";
    }

    return "";
}

function parseDateAny(pValue: unknown): number {
    if (pValue === null || pValue === undefined) {
        return Number.NaN;
    }
    const vString = String(pValue).trim();
    if (!vString) {
        return Number.NaN;
    }
    if (/^\d+$/.test(vString)) {
        const vRaw = Number(vString);
        if (!Number.isFinite(vRaw) || vRaw <= 0) {
            return Number.NaN;
        }
        if (vRaw > 1e14) {
            return Math.floor(vRaw / 1000);
        }
        if (vRaw > 1e11) {
            return Math.floor(vRaw);
        }
        return Math.floor(vRaw * 1000);
    }
    if (/^\d{2}-\d{2}-\d{4}$/.test(vString)) {
        const [vDay, vMonth, vYear] = vString.split("-").map((objPart) => Number(objPart));
        return new Date(vYear, vMonth - 1, vDay).getTime();
    }
    return new Date(vString).getTime();
}

function getDteDays(pExpiryDate: unknown): number | null {
    const vExpiry = parseDateAny(pExpiryDate);
    if (!Number.isFinite(vExpiry)) {
        return null;
    }
    return (vExpiry - Date.now()) / (24 * 60 * 60 * 1000);
}

function formatDDMMYYYY(pDate: Date): string {
    const vDay = String(pDate.getDate()).padStart(2, "0");
    const vMonth = String(pDate.getMonth() + 1).padStart(2, "0");
    return `${vDay}-${vMonth}-${pDate.getFullYear()}`;
}

function getUnderlyingCandidates(pUnderlying: string): string[] {
    const vBase = String(pUnderlying || "BTC").trim().toUpperCase();
    const objList = [vBase];
    if (!vBase.endsWith("USD")) {
        objList.push(`${vBase}USD`);
    }
    return [...new Set(objList)];
}

function getDefaultCandidateExpiries(): string[] {
    const vNow = new Date();
    const objDaySteps = [5, 7, 9, 10, 12, 14, 30, 37, 45, 52, 60];
    const objOutput: string[] = [];
    for (const vDays of objDaySteps) {
        const vDate = new Date(vNow);
        vDate.setDate(vDate.getDate() + vDays);
        objOutput.push(formatDDMMYYYY(vDate));
    }
    return [...new Set(objOutput)];
}

async function fetchJson(pUrl: string): Promise<Record<string, unknown>> {
    const objResponse = await fetch(pUrl);
    if (!objResponse.ok) {
        throw new Error(`${objResponse.status} ${objResponse.statusText}`);
    }
    return await objResponse.json() as Record<string, unknown>;
}

async function fetchOptionProducts(pUnderlying: string): Promise<Record<string, unknown>[]> {
    const objUnderlyings = getUnderlyingCandidates(pUnderlying);
    const objAll: Record<string, unknown>[] = [];

    for (const vUnderlying of objUnderlyings) {
        try {
            const vUrl = `https://api.india.delta.exchange/v2/products?contract_types=call_options,put_options&underlying_asset_symbols=${encodeURIComponent(vUnderlying)}`;
            const objResponse = await fetchJson(vUrl);
            if (objResponse.success && Array.isArray(objResponse.result)) {
                objAll.push(...(objResponse.result as Record<string, unknown>[]));
            }
        }
        catch {
            // best effort
        }
    }

    return objAll;
}

function getCandidateExpiriesFromProducts(pProducts: Record<string, unknown>[]): string[] {
    const vNow = Date.now();
    const objSet = new Set<string>();
    for (const objProduct of pProducts) {
        const objCandidates = [
            objProduct.expiry_date,
            objProduct.expiry,
            objProduct.settlement_time,
            objProduct.expiry_time,
            objProduct.expiry_timestamp
        ];
        for (const vCandidate of objCandidates) {
            if (!vCandidate) {
                continue;
            }
            const vTimestamp = parseDateAny(vCandidate);
            if (!Number.isFinite(vTimestamp) || vTimestamp <= vNow) {
                continue;
            }
            objSet.add(formatDDMMYYYY(new Date(vTimestamp)));
        }
    }
    return Array.from(objSet).sort((pLeft, pRight) => parseDateAny(pLeft) - parseDateAny(pRight));
}

async function fetchTicker(pSymbol: string): Promise<MarketSnapshot["ticker"]> {
    try {
        const objResponse = await fetchJson(`https://api.india.delta.exchange/v2/tickers/${pSymbol}`);
        const objResult = (objResponse.result || {}) as Record<string, unknown>;
        const objQuotes = (objResult.quotes || {}) as Record<string, unknown>;
        return {
            symbol: pSymbol,
            spot: Number(toNumber(objResult.spot_price, 0) || 0),
            mark: Number(toNumber(objResult.mark_price, toNumber(objResult.spot_price, 0)) || 0),
            bestBid: toNumber(objQuotes.best_bid, null),
            bestAsk: toNumber(objQuotes.best_ask, null)
        };
    }
    catch (objError) {
        const vMessage = objError instanceof Error ? objError.message : "Ticker fetch failed";
        throw new Error(`ticker_fetch_failed: ${vMessage}`);
    }
}

async function fetchOptionChain(
    pApiKey: string,
    pApiSecret: string,
    pUnderlying: string
): Promise<MarketOptionSnapshot[]> {
    const objClient = await new DeltaRestClient(pApiKey, pApiSecret);
    const objProducts = await fetchOptionProducts(pUnderlying);
    let objExpiries = getCandidateExpiriesFromProducts(objProducts);
    if (objExpiries.length === 0) {
        objExpiries = getDefaultCandidateExpiries();
    }

    const objUnderlyings = getUnderlyingCandidates(pUnderlying);
    const objRows: Record<string, unknown>[] = [];
    const objErrors: string[] = [];

    for (const vUnderlying of objUnderlyings) {
        for (const vExpiry of objExpiries) {
            const objQueries = [
                { contract_types: "", underlying_asset_symbols: vUnderlying, expiry_date: vExpiry },
                { underlying_asset_symbols: vUnderlying, expiry_date: vExpiry }
            ];

            for (const objQuery of objQueries) {
                try {
                    const objResponse = await objClient.apis.Products.getOptionChain(objQuery);
                    const objParsed = JSON.parse(objResponse.data || "{}");
                    if (objParsed.success && Array.isArray(objParsed.result) && objParsed.result.length > 0) {
                        objRows.push(...(objParsed.result as Record<string, unknown>[]).map((objRow) => ({
                            ...objRow,
                            __req_expiry: vExpiry
                        })));
                        break;
                    }
                }
                catch (objError) {
                    objErrors.push(objError instanceof Error ? objError.message : "Bad Request");
                }
            }
        }
    }

    if (objRows.length === 0) {
        throw new Error(`option_chain_fetch_failed: ${objErrors[0] || "Failed to fetch option chain"}`);
    }

    return objRows
        .map((objRow) => {
            const vExpiry = objRow.expiry_date || objRow.expiry || objRow.settlement_time || objRow.expiry_time || objRow.expiry_timestamp || objRow.__req_expiry;
            const vDte = getDteDays(vExpiry);
            const vType = inferOptionType(objRow);
            if (!vType || vDte === null) {
                return null;
            }
            const objGreeks = (objRow.greeks || {}) as Record<string, unknown>;
            const objQuotes = (objRow.quotes || {}) as Record<string, unknown>;
            return {
                productId: (objRow.product_id as string | number | null) || null,
                symbol: String(objRow.symbol || objRow.product_symbol || ""),
                type: vType,
                expiry: String(vExpiry || ""),
                dte: vDte,
                strike: toNumber(objRow.strike_price ?? objRow.strike, null),
                delta: toNumber(objGreeks.delta ?? objRow.delta, null),
                gamma: Number(toNumber(objGreeks.gamma ?? objRow.gamma, 0) || 0),
                theta: Number(toNumber(objGreeks.theta ?? objRow.theta, 0) || 0),
                vega: Number(toNumber(objGreeks.vega ?? objRow.vega, 0) || 0),
                bestBid: toNumber(objQuotes.best_bid ?? objRow.best_bid, null),
                bestAsk: toNumber(objQuotes.best_ask ?? objRow.best_ask, null),
                mark: toNumber(objRow.close ?? objQuotes.mark_price ?? objRow.mark_price, null)
            } as MarketOptionSnapshot;
        })
        .filter((objRow): objRow is MarketOptionSnapshot => !!objRow)
        .filter((objRow) => Number.isFinite(objRow.dte) && objRow.dte > 0 && !!objRow.symbol);
}

export function selectOptionByDteDelta(
    pOptions: MarketOptionSnapshot[],
    pCriteria: {
        type: "put" | "call";
        dteMin: number;
        dteMax: number;
        targetAbsDelta: number;
    }
): MarketOptionSnapshot | null {
    const { type: vType, dteMin: vDteMin, dteMax: vDteMax, targetAbsDelta: vTargetAbsDelta } = pCriteria;
    let objCandidates = pOptions.filter((objOption) =>
        objOption.type === vType &&
        objOption.dte >= vDteMin &&
        objOption.dte <= vDteMax
    );

    if (objCandidates.length === 0) {
        objCandidates = pOptions.filter((objOption) => objOption.type === vType && Number.isFinite(objOption.dte) && objOption.dte > 0);
        if (objCandidates.length === 0) {
            return null;
        }
    }

    const vTargetDteMid = (Number(vDteMin) + Number(vDteMax)) / 2;
    objCandidates.sort((objLeft, objRight) => {
        const vLeftDeltaDiff = Number.isFinite(Number(objLeft.delta)) ? Math.abs(Math.abs(Number(objLeft.delta)) - vTargetAbsDelta) : 999;
        const vRightDeltaDiff = Number.isFinite(Number(objRight.delta)) ? Math.abs(Math.abs(Number(objRight.delta)) - vTargetAbsDelta) : 999;
        const vLeftDteDiff = Math.abs(objLeft.dte - vTargetDteMid);
        const vRightDteDiff = Math.abs(objRight.dte - vTargetDteMid);
        if (vLeftDteDiff !== vRightDteDiff) {
            return vLeftDteDiff - vRightDteDiff;
        }
        if (vLeftDeltaDiff !== vRightDeltaDiff) {
            return vLeftDeltaDiff - vRightDeltaDiff;
        }
        return Math.abs(Number(objLeft.strike || 0)) - Math.abs(Number(objRight.strike || 0));
    });

    return objCandidates[0] || null;
}

export async function fetchSnapshot(
    pApiKey: string,
    pApiSecret: string,
    pConfig: StrategyFoGreeksPaperConfig
): Promise<MarketSnapshot> {
    const [objTicker, objOptions] = await Promise.all([
        fetchTicker(pConfig.symbol),
        fetchOptionChain(pApiKey, pApiSecret, pConfig.underlying)
    ]);
    return {
        ticker: objTicker,
        options: objOptions,
        ts: new Date().toISOString()
    };
}
