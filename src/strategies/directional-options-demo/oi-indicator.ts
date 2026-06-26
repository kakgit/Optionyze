interface DeltaTickerRow {
    symbol?: string;
    contract_type?: string;
    product_symbol?: string;
    strike_price?: string | number;
    expiry_date?: string;
    expiry?: string;
    expiry_time?: string | number;
    expiry_timestamp?: string | number;
    settlement_time?: string | number;
    oi?: string | number;
    open_interest?: string | number;
    mark_price?: string | number;
    spot_price?: string | number;
    quotes?: {
        best_bid?: string | number;
        best_ask?: string | number;
        bid_size?: string | number;
        ask_size?: string | number;
    };
}

interface DeltaApiResponse<T> {
    success?: boolean;
    result?: T;
}

export interface OptionsDemoOiIndicatorWall {
    strike: number;
    oi: number;
    distanceFromSpot: number | null;
}

export interface OptionsDemoOiFlow {
    priceChange: number | null;
    oiChange: number | null;
    callOiChange: number | null;
    putOiChange: number | null;
    classification: "long_buildup" | "short_buildup" | "short_covering" | "long_unwinding" | "flat";
    bias: "bullish" | "bearish" | "neutral";
}

export interface OptionsDemoOiIndicatorBucket {
    horizon: "short_term" | "medium_term" | "long_term";
    window: "daily_plus_1" | "daily_plus_2" | "weekly" | "bi_weekly" | "monthly" | "bi_monthly";
    label: string;
    expiry: string;
    dte: number | null;
    callOi: number;
    putOi: number;
    totalOi: number;
    putCallRatio: number | null;
    score: number;
    direction: "bullish" | "bearish" | "neutral";
    support: OptionsDemoOiIndicatorWall | null;
    resistance: OptionsDemoOiIndicatorWall | null;
    flow: OptionsDemoOiFlow | null;
}

export interface OptionsDemoOiIndicatorSummary {
    symbol: string;
    spotPrice: number | null;
    markPrice: number | null;
    orderBookImbalance: number | null;
    orderBookDirection: "bullish" | "bearish" | "neutral";
    orderBookSource: "l2_orderbook" | "top_of_book" | "unavailable";
    orderBookBidSize: number | null;
    orderBookAskSize: number | null;
    overallCallOi: number;
    overallPutOi: number;
    overallTotalOi: number;
    overallPutCallRatio: number | null;
    overallScore: number;
    overallDirection: "bullish" | "bearish" | "neutral";
    overallSupport: OptionsDemoOiIndicatorWall | null;
    overallResistance: OptionsDemoOiIndicatorWall | null;
    overallFlow: OptionsDemoOiFlow | null;
    buckets: OptionsDemoOiIndicatorBucket[];
    asOf: string;
}

const gIndicatorCache = new Map<string, { expiresAt: number; data: OptionsDemoOiIndicatorSummary }>();
const gIndicatorCacheTtlMs = 45 * 1000;
const gIndicatorPreviousSnapshot = new Map<string, OptionsDemoOiIndicatorSummary>();

function getApiBaseUrl(): string {
    return "https://api.india.delta.exchange/v2";
}

function toFiniteNumber(pValue: unknown, pFallback = 0): number {
    const vNumber = Number(pValue);
    return Number.isFinite(vNumber) ? vNumber : pFallback;
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
        const [vDay, vMonth, vYear] = vString.split("-").map((vPart) => Number(vPart));
        return new Date(vYear, vMonth - 1, vDay).getTime();
    }
    return new Date(vString).getTime();
}

function formatDdMmYyyy(pDate: Date): string {
    const vDay = String(pDate.getDate()).padStart(2, "0");
    const vMonth = String(pDate.getMonth() + 1).padStart(2, "0");
    const vYear = String(pDate.getFullYear());
    return `${vDay}-${vMonth}-${vYear}`;
}

function getUnderlyingCandidates(pSymbol: string): string[] {
    const vBase = String(pSymbol || "BTC").trim().toUpperCase();
    const arrCandidates = [vBase];
    if (!vBase.endsWith("USD")) {
        arrCandidates.push(`${vBase}USD`);
    }
    return Array.from(new Set(arrCandidates));
}

function getTickerSymbol(pSymbol: string): string {
    const vBase = String(pSymbol || "BTC").trim().toUpperCase();
    return vBase.endsWith("USD") ? vBase : `${vBase}USD`;
}

async function fetchJson<T>(pPath: string, pSearchParams?: URLSearchParams): Promise<T> {
    const vUrl = `${getApiBaseUrl()}${pPath}${pSearchParams ? `?${pSearchParams.toString()}` : ""}`;
    let objLastError: Error | null = null;
    for (let vAttempt = 0; vAttempt < 3; vAttempt += 1) {
        try {
            const objResponse = await fetch(vUrl, {
                headers: {
                    Accept: "application/json"
                }
            });
            if (!objResponse.ok) {
                throw new Error(`Delta public market-data request failed: ${objResponse.status}`);
            }
            return await objResponse.json() as T;
        }
        catch (objError) {
            objLastError = objError instanceof Error ? objError : new Error(String(objError));
            if (vAttempt < 2) {
                await new Promise((resolve) => setTimeout(resolve, 250 * (vAttempt + 1)));
            }
        }
    }
    throw objLastError || new Error("Unable to fetch Delta market data.");
}

function getDirectionFromImbalance(pImbalance: number | null): "bullish" | "bearish" | "neutral" {
    const vImbalance = Number(pImbalance);
    if (!Number.isFinite(vImbalance)) {
        return "neutral";
    }
    if (vImbalance >= 0.08) {
        return "bullish";
    }
    if (vImbalance <= -0.08) {
        return "bearish";
    }
    return "neutral";
}

function extractLevelSize(pLevel: unknown): number {
    if (Array.isArray(pLevel)) {
        return Math.max(0, toFiniteNumber(pLevel[1], 0));
    }
    if (pLevel && typeof pLevel === "object") {
        const objLevel = pLevel as Record<string, unknown>;
        return Math.max(0, toFiniteNumber(
            objLevel.size ??
            objLevel.qty ??
            objLevel.quantity ??
            objLevel.amount ??
            objLevel.volume ??
            objLevel.bid_size ??
            objLevel.ask_size,
            0
        ));
    }
    return 0;
}

function extractBookVolume(pLevels: unknown, pDepth: number): number {
    if (!Array.isArray(pLevels) || pDepth <= 0) {
        return 0;
    }
    return pLevels.slice(0, pDepth).reduce((pTotal, pLevel) => pTotal + extractLevelSize(pLevel), 0);
}

function getBookSideCandidates(pPayload: Record<string, unknown>, pSide: "bids" | "asks"): unknown[] {
    const objCandidates = pSide === "bids"
        ? [pPayload.bids, pPayload.bid, pPayload.buy, pPayload.buys, pPayload.buy_orders]
        : [pPayload.asks, pPayload.ask, pPayload.sell, pPayload.sells, pPayload.sell_orders];
    for (const vCandidate of objCandidates) {
        if (Array.isArray(vCandidate)) {
            return vCandidate;
        }
    }
    return [];
}

function summarizeOrderBookFromPayload(
    pPayload: unknown,
    pDepth: number
): { imbalance: number | null; bidSize: number | null; askSize: number | null; source: "l2_orderbook" | "top_of_book" | "unavailable"; } {
    if (!pPayload || typeof pPayload !== "object") {
        return { imbalance: null, bidSize: null, askSize: null, source: "unavailable" };
    }
    const objPayload = pPayload as Record<string, unknown>;
    const arrBids = getBookSideCandidates(objPayload, "bids");
    const arrAsks = getBookSideCandidates(objPayload, "asks");
    const vBidSize = extractBookVolume(arrBids, pDepth);
    const vAskSize = extractBookVolume(arrAsks, pDepth);
    if (vBidSize > 0 || vAskSize > 0) {
        const vTotal = vBidSize + vAskSize;
        return {
            imbalance: vTotal > 0 ? Number(((vBidSize - vAskSize) / vTotal).toFixed(4)) : null,
            bidSize: vBidSize > 0 ? Number(vBidSize.toFixed(4)) : null,
            askSize: vAskSize > 0 ? Number(vAskSize.toFixed(4)) : null,
            source: "l2_orderbook"
        };
    }

    const objBidSize = toFiniteNumber(objPayload.bid_size ?? objPayload.best_bid_size, Number.NaN);
    const objAskSize = toFiniteNumber(objPayload.ask_size ?? objPayload.best_ask_size, Number.NaN);
    if (Number.isFinite(objBidSize) || Number.isFinite(objAskSize)) {
        const vBid = Number.isFinite(objBidSize) ? Math.max(0, objBidSize) : 0;
        const vAsk = Number.isFinite(objAskSize) ? Math.max(0, objAskSize) : 0;
        const vTotal = vBid + vAsk;
        return {
            imbalance: vTotal > 0 ? Number(((vBid - vAsk) / vTotal).toFixed(4)) : null,
            bidSize: Number.isFinite(objBidSize) ? Number(vBid.toFixed(4)) : null,
            askSize: Number.isFinite(objAskSize) ? Number(vAsk.toFixed(4)) : null,
            source: "top_of_book"
        };
    }

    return { imbalance: null, bidSize: null, askSize: null, source: "unavailable" };
}

async function fetchTickerSummary(pSymbol: string): Promise<{ spotPrice: number | null; markPrice: number | null; }> {
    const objResponse = await fetchJson<DeltaApiResponse<DeltaTickerRow>>(`/tickers/${encodeURIComponent(getTickerSymbol(pSymbol))}`);
    const objTicker = (objResponse.result || {}) as DeltaTickerRow;
    const vSpotPrice = toFiniteNumber(objTicker.spot_price, Number.NaN);
    const vMarkPrice = toFiniteNumber(objTicker.mark_price, vSpotPrice);
    return {
        spotPrice: Number.isFinite(vSpotPrice) ? vSpotPrice : null,
        markPrice: Number.isFinite(vMarkPrice) ? vMarkPrice : null
    };
}

async function fetchOrderBookSummary(pSymbol: string): Promise<{ imbalance: number | null; bidSize: number | null; askSize: number | null; source: "l2_orderbook" | "top_of_book" | "unavailable"; }> {
    const vTickerSymbol = getTickerSymbol(pSymbol);
    const objDepthParams = new URLSearchParams({
        depth: "10"
    });
    try {
        const objResponse = await fetchJson<DeltaApiResponse<unknown>>(`/l2orderbook/${encodeURIComponent(vTickerSymbol)}`, objDepthParams);
        if (objResponse && Object.prototype.hasOwnProperty.call(objResponse, "result")) {
            const objSummary = summarizeOrderBookFromPayload(objResponse.result, 10);
            if (objSummary.source !== "unavailable") {
                return objSummary;
            }
        }
    }
    catch {
        // best effort fallback
    }

    try {
        const objResponse = await fetchJson<DeltaApiResponse<DeltaTickerRow>>(`/tickers/${encodeURIComponent(vTickerSymbol)}`);
        const objTicker = (objResponse.result || {}) as DeltaTickerRow;
        const objSummary = summarizeOrderBookFromPayload({
            bid_size: objTicker.quotes?.bid_size,
            ask_size: objTicker.quotes?.ask_size
        }, 1);
        if (objSummary.source !== "unavailable") {
            return objSummary;
        }
    }
    catch {
        // best effort fallback
    }

    return { imbalance: null, bidSize: null, askSize: null, source: "unavailable" };
}

async function fetchOptionProducts(pSymbol: string): Promise<Record<string, unknown>[]> {
    const arrCandidates = getUnderlyingCandidates(pSymbol);
    const arrProducts: Record<string, unknown>[] = [];
    for (const vUnderlying of arrCandidates) {
        try {
            const objParams = new URLSearchParams({
                contract_types: "call_options,put_options",
                underlying_asset_symbols: vUnderlying
            });
            const objResponse = await fetchJson<DeltaApiResponse<Record<string, unknown>[]>>("/products", objParams);
            if (Array.isArray(objResponse.result)) {
                arrProducts.push(...objResponse.result);
            }
        }
        catch {
            // best effort
        }
    }
    return arrProducts;
}

function extractFutureExpiries(pProducts: Record<string, unknown>[]): Array<{ expiry: string; dte: number; }> {
    const vNow = Date.now();
    const objMap = new Map<string, number>();
    for (const objProduct of pProducts) {
        const arrCandidates = [
            objProduct.expiry_date,
            objProduct.expiry,
            objProduct.settlement_time,
            objProduct.expiry_time,
            objProduct.expiry_timestamp
        ];
        for (const vCandidate of arrCandidates) {
            const vTimestamp = parseDateAny(vCandidate);
            if (!Number.isFinite(vTimestamp) || vTimestamp <= vNow) {
                continue;
            }
            const vDate = new Date(vTimestamp);
            const vLabel = formatDdMmYyyy(vDate);
            const vDte = (vTimestamp - vNow) / (24 * 60 * 60 * 1000);
            if (!objMap.has(vLabel) || vDte < Number(objMap.get(vLabel))) {
                objMap.set(vLabel, vDte);
            }
        }
    }
    return Array.from(objMap.entries())
        .map(([vExpiry, vDte]) => ({ expiry: vExpiry, dte: vDte }))
        .sort((pLeft, pRight) => pLeft.dte - pRight.dte);
}

async function fetchOptionOiRows(pSymbol: string, pExpiry: string): Promise<DeltaTickerRow[]> {
    const arrCandidates = getUnderlyingCandidates(pSymbol);
    for (const vUnderlying of arrCandidates) {
        const objParams = new URLSearchParams({
            contract_types: "call_options,put_options",
            underlying_asset_symbols: vUnderlying,
            expiry_date: pExpiry
        });
        const objResponse = await fetchJson<DeltaApiResponse<DeltaTickerRow[]>>("/tickers", objParams);
        if (Array.isArray(objResponse.result) && objResponse.result.length) {
            return objResponse.result;
        }
    }
    return [];
}

function getDirectionFromScore(pScore: number): "bullish" | "bearish" | "neutral" {
    if (pScore >= 0.08) {
        return "bullish";
    }
    if (pScore <= -0.08) {
        return "bearish";
    }
    return "neutral";
}

function buildOiFlow(
    pCurrentPrice: number | null,
    pPreviousPrice: number | null,
    pCurrentCallOi: number,
    pPreviousCallOi: number | null,
    pCurrentPutOi: number,
    pPreviousPutOi: number | null
): OptionsDemoOiFlow | null {
    const vCurrentPrice = Number(pCurrentPrice);
    const vPreviousPrice = Number(pPreviousPrice);
    const vPreviousCallOi = Number(pPreviousCallOi);
    const vPreviousPutOi = Number(pPreviousPutOi);
    if (!Number.isFinite(vPreviousCallOi) || !Number.isFinite(vPreviousPutOi)) {
        return null;
    }
    const vCallOiChange = Number((pCurrentCallOi - vPreviousCallOi).toFixed(2));
    const vPutOiChange = Number((pCurrentPutOi - vPreviousPutOi).toFixed(2));
    const vOiChange = Number((vCallOiChange + vPutOiChange).toFixed(2));
    const vPriceChange = Number.isFinite(vCurrentPrice) && Number.isFinite(vPreviousPrice)
        ? Number((vCurrentPrice - vPreviousPrice).toFixed(2))
        : null;
    const bPriceFlat = !Number.isFinite(Number(vPriceChange)) || Math.abs(Number(vPriceChange || 0)) < 0.01;
    const bOiFlat = Math.abs(vOiChange) < 1;
    if (bPriceFlat || bOiFlat) {
        return {
            priceChange: vPriceChange,
            oiChange: vOiChange,
            callOiChange: vCallOiChange,
            putOiChange: vPutOiChange,
            classification: "flat",
            bias: "neutral"
        };
    }
    if (Number(vPriceChange) > 0 && vOiChange > 0) {
        return {
            priceChange: vPriceChange,
            oiChange: vOiChange,
            callOiChange: vCallOiChange,
            putOiChange: vPutOiChange,
            classification: "long_buildup",
            bias: "bullish"
        };
    }
    if (Number(vPriceChange) < 0 && vOiChange > 0) {
        return {
            priceChange: vPriceChange,
            oiChange: vOiChange,
            callOiChange: vCallOiChange,
            putOiChange: vPutOiChange,
            classification: "short_buildup",
            bias: "bearish"
        };
    }
    if (Number(vPriceChange) > 0 && vOiChange < 0) {
        return {
            priceChange: vPriceChange,
            oiChange: vOiChange,
            callOiChange: vCallOiChange,
            putOiChange: vPutOiChange,
            classification: "short_covering",
            bias: "bullish"
        };
    }
    return {
        priceChange: vPriceChange,
        oiChange: vOiChange,
        callOiChange: vCallOiChange,
        putOiChange: vPutOiChange,
        classification: "long_unwinding",
        bias: "bearish"
    };
}

function selectWallCandidate(
    pRows: DeltaTickerRow[],
    pContractType: "call" | "put",
    pSpotPrice: number | null
): OptionsDemoOiIndicatorWall | null {
    const vSpot = Number(pSpotPrice);
    const arrCandidates = pRows
        .filter((objRow) => String(objRow.contract_type || "").toLowerCase().includes(pContractType))
        .map((objRow) => {
            const vStrike = toFiniteNumber(objRow.strike_price, Number.NaN);
            const vOi = Math.max(0, toFiniteNumber(objRow.oi ?? objRow.open_interest, 0));
            const vDistance = Number.isFinite(vSpot) && Number.isFinite(vStrike)
                ? Math.abs(vStrike - vSpot)
                : Number.NaN;
            return {
                strike: vStrike,
                oi: vOi,
                distanceFromSpot: Number.isFinite(vDistance) ? vDistance : null
            };
        })
        .filter((objRow) => Number.isFinite(objRow.strike) && objRow.oi > 0)
        .filter((objRow) => {
            if (!Number.isFinite(vSpot)) {
                return true;
            }
            return pContractType === "put"
                ? objRow.strike <= vSpot
                : objRow.strike >= vSpot;
        })
        .sort((pLeft, pRight) => {
            if (pRight.oi !== pLeft.oi) {
                return pRight.oi - pLeft.oi;
            }
            return Number(pLeft.distanceFromSpot || Number.POSITIVE_INFINITY) - Number(pRight.distanceFromSpot || Number.POSITIVE_INFINITY);
        });
    return arrCandidates[0] || null;
}

function buildBucket(
    pHorizon: OptionsDemoOiIndicatorBucket["horizon"],
    pWindow: OptionsDemoOiIndicatorBucket["window"],
    pLabel: string,
    pExpiryInfo: { expiry: string; dte: number; } | null,
    pRows: DeltaTickerRow[],
    pSpotPrice: number | null,
    pPreviousBucket: OptionsDemoOiIndicatorBucket | null,
    pCurrentPrice: number | null,
    pPreviousPrice: number | null
): OptionsDemoOiIndicatorBucket {
    const vCallOi = pRows
        .filter((objRow) => String(objRow.contract_type || "").toLowerCase().includes("call"))
        .reduce((pTotal, objRow) => pTotal + Math.max(0, toFiniteNumber(objRow.oi ?? objRow.open_interest, 0)), 0);
    const vPutOi = pRows
        .filter((objRow) => String(objRow.contract_type || "").toLowerCase().includes("put"))
        .reduce((pTotal, objRow) => pTotal + Math.max(0, toFiniteNumber(objRow.oi ?? objRow.open_interest, 0)), 0);
    const vTotalOi = vCallOi + vPutOi;
    const vScore = vTotalOi > 0 ? Number(((vPutOi - vCallOi) / vTotalOi).toFixed(4)) : 0;
    const objSupport = selectWallCandidate(pRows, "put", pSpotPrice);
    const objResistance = selectWallCandidate(pRows, "call", pSpotPrice);
    return {
        horizon: pHorizon,
        window: pWindow,
        label: pLabel,
        expiry: String(pExpiryInfo?.expiry || "").trim(),
        dte: pExpiryInfo && Number.isFinite(pExpiryInfo.dte) ? Number(pExpiryInfo.dte.toFixed(2)) : null,
        callOi: Number(vCallOi.toFixed(2)),
        putOi: Number(vPutOi.toFixed(2)),
        totalOi: Number(vTotalOi.toFixed(2)),
        putCallRatio: vCallOi > 0 ? Number((vPutOi / vCallOi).toFixed(4)) : null,
        score: vScore,
        direction: getDirectionFromScore(vScore),
        support: objSupport,
        resistance: objResistance,
        flow: buildOiFlow(
            pCurrentPrice,
            pPreviousPrice,
            Number(vCallOi.toFixed(2)),
            pPreviousBucket?.callOi ?? null,
            Number(vPutOi.toFixed(2)),
            pPreviousBucket?.putOi ?? null
        )
    };
}

function pickExpiry(
    pExpiries: Array<{ expiry: string; dte: number; }>,
    pUsed: Set<string>,
    pMinDte: number,
    pMaxDte?: number
): { expiry: string; dte: number; } | null {
    const objPreferred = pExpiries.find((objExpiry) => (
        !pUsed.has(objExpiry.expiry)
        && objExpiry.dte >= pMinDte
        && (pMaxDte === undefined || objExpiry.dte <= pMaxDte)
    ));
    if (objPreferred) {
        pUsed.add(objPreferred.expiry);
        return objPreferred;
    }
    const objFallback = pExpiries.find((objExpiry) => !pUsed.has(objExpiry.expiry));
    if (objFallback) {
        pUsed.add(objFallback.expiry);
        return objFallback;
    }
    return null;
}

export async function getOptionsDemoOiIndicatorSummary(pSymbol: string): Promise<OptionsDemoOiIndicatorSummary> {
    const vSymbol = String(pSymbol || "BTC").trim().toUpperCase();
    const vCacheKey = vSymbol;
    const objCached = gIndicatorCache.get(vCacheKey);
    if (objCached && objCached.expiresAt > Date.now()) {
        return objCached.data;
    }
    const objPreviousSummary = gIndicatorPreviousSnapshot.get(vCacheKey) || null;

    const [objTicker, arrProducts, objOrderBook] = await Promise.all([
        fetchTickerSummary(vSymbol),
        fetchOptionProducts(vSymbol),
        fetchOrderBookSummary(vSymbol)
    ]);
    const arrExpiries = extractFutureExpiries(arrProducts).filter((objExpiry) => objExpiry.dte <= 80);
    if (!arrExpiries.length) {
        throw new Error(`No future option expiries found for ${vSymbol}.`);
    }

    const objUsed = new Set<string>();
    const arrDefinitions: Array<{
        horizon: OptionsDemoOiIndicatorBucket["horizon"];
        window: OptionsDemoOiIndicatorBucket["window"];
        label: string;
        minDte: number;
        maxDte?: number;
    }> = [
        { horizon: "short_term", window: "daily_plus_1", label: "Daily +1", minDte: 0, maxDte: 4 },
        { horizon: "short_term", window: "daily_plus_2", label: "Daily +2", minDte: 1, maxDte: 7 },
        { horizon: "medium_term", window: "weekly", label: "Weekly", minDte: 5, maxDte: 12 },
        { horizon: "medium_term", window: "bi_weekly", label: "Bi-Weekly", minDte: 12, maxDte: 24 },
        { horizon: "long_term", window: "monthly", label: "Monthly", minDte: 24, maxDte: 45 },
        { horizon: "long_term", window: "bi_monthly", label: "Bi-Monthly", minDte: 45, maxDte: 80 }
    ];

    const arrSelections = arrDefinitions.map((objDefinition) => ({
        ...objDefinition,
        expiryInfo: pickExpiry(arrExpiries, objUsed, objDefinition.minDte, objDefinition.maxDte)
    }));

    const objRowsByExpiry = new Map<string, DeltaTickerRow[]>();
    await Promise.all(arrSelections.map(async (objSelection) => {
        const vExpiry = String(objSelection.expiryInfo?.expiry || "").trim();
        if (!vExpiry || objRowsByExpiry.has(vExpiry)) {
            return;
        }
        objRowsByExpiry.set(vExpiry, await fetchOptionOiRows(vSymbol, vExpiry));
    }));

    const arrBuckets = arrSelections.map((objSelection) => buildBucket(
        objSelection.horizon,
        objSelection.window,
        objSelection.label,
        objSelection.expiryInfo,
        objRowsByExpiry.get(String(objSelection.expiryInfo?.expiry || "").trim()) || [],
        objTicker.markPrice ?? objTicker.spotPrice,
        (objPreviousSummary?.buckets || []).find((objBucket) => objBucket.window === objSelection.window) || null,
        objTicker.markPrice ?? objTicker.spotPrice,
        objPreviousSummary?.markPrice ?? objPreviousSummary?.spotPrice ?? null
    ));

    const vOverallCallOi = arrBuckets.reduce((pTotal, objBucket) => pTotal + objBucket.callOi, 0);
    const vOverallPutOi = arrBuckets.reduce((pTotal, objBucket) => pTotal + objBucket.putOi, 0);
    const vOverallTotalOi = vOverallCallOi + vOverallPutOi;
    const vOverallScore = vOverallTotalOi > 0 ? Number(((vOverallPutOi - vOverallCallOi) / vOverallTotalOi).toFixed(4)) : 0;
    const vReferenceSpot = objTicker.markPrice ?? objTicker.spotPrice;
    const arrAllRows = Array.from(objRowsByExpiry.values()).flat();
    const objOverallSupport = selectWallCandidate(arrAllRows, "put", vReferenceSpot);
    const objOverallResistance = selectWallCandidate(arrAllRows, "call", vReferenceSpot);

    const objSummary: OptionsDemoOiIndicatorSummary = {
        symbol: vSymbol,
        spotPrice: objTicker.spotPrice,
        markPrice: objTicker.markPrice,
        orderBookImbalance: objOrderBook.imbalance,
        orderBookDirection: getDirectionFromImbalance(objOrderBook.imbalance),
        orderBookSource: objOrderBook.source,
        orderBookBidSize: objOrderBook.bidSize,
        orderBookAskSize: objOrderBook.askSize,
        overallCallOi: Number(vOverallCallOi.toFixed(2)),
        overallPutOi: Number(vOverallPutOi.toFixed(2)),
        overallTotalOi: Number(vOverallTotalOi.toFixed(2)),
        overallPutCallRatio: vOverallCallOi > 0 ? Number((vOverallPutOi / vOverallCallOi).toFixed(4)) : null,
        overallScore: vOverallScore,
        overallDirection: getDirectionFromScore(vOverallScore),
        overallSupport: objOverallSupport,
        overallResistance: objOverallResistance,
        overallFlow: buildOiFlow(
            objTicker.markPrice ?? objTicker.spotPrice,
            objPreviousSummary?.markPrice ?? objPreviousSummary?.spotPrice ?? null,
            Number(vOverallCallOi.toFixed(2)),
            objPreviousSummary?.overallCallOi ?? null,
            Number(vOverallPutOi.toFixed(2)),
            objPreviousSummary?.overallPutOi ?? null
        ),
        buckets: arrBuckets,
        asOf: new Date().toISOString()
    };

    gIndicatorPreviousSnapshot.set(vCacheKey, objSummary);
    gIndicatorCache.set(vCacheKey, {
        expiresAt: Date.now() + gIndicatorCacheTtlMs,
        data: objSummary
    });
    return objSummary;
}
