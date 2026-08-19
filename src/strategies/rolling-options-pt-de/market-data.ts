import type { RollingOptionsPtDeConfig, RollingOptionsPtDeMarketSnapshot } from "./types";
import WebSocket from "ws";

interface DeltaTickerGreeks {
    delta?: string | number;
    gamma?: string | number;
    theta?: string | number;
    vega?: string | number;
}

interface DeltaTickerRow {
    symbol?: string;
    contract_type?: string;
    mark_price?: string | number;
    best_bid?: string | number;
    best_ask?: string | number;
    spot_price?: string | number;
    strike_price?: string | number;
    oi?: string | number;
    open_interest?: string | number;
    expiry_date?: string;
    settlement_time?: string;
    greeks?: DeltaTickerGreeks;
    quotes?: {
        best_bid?: string | number;
        best_ask?: string | number;
    };
}

interface DeltaApiResponse<T> {
    success?: boolean;
    result?: T;
}

export interface RollingOptionsPtDeLiveOptionContract {
    contractSymbol: string;
    optionSide: "CE" | "PE";
    strike: number;
    markPrice: number;
    bestBid: number | null;
    bestAsk: number | null;
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
    expiryDate: string;
    requestedExpiryDate: string;
    usedNextDayFallback: boolean;
}

function parseFiniteOrNaN(pValue: unknown): number {
    const vNum = Number(pValue);
    return Number.isFinite(vNum) ? vNum : Number.NaN;
}

function parseNumber(pValue: unknown, pFallback = 0): number {
    const vNum = Number(pValue);
    return Number.isFinite(vNum) ? vNum : pFallback;
}

function getTickerBestBid(pRow: DeltaTickerRow): number | null {
    const vBestBid = parseNumber(pRow.quotes?.best_bid ?? pRow.best_bid, NaN);
    return Number.isFinite(vBestBid) && vBestBid > 0 ? vBestBid : null;
}

function getTickerBestAsk(pRow: DeltaTickerRow): number | null {
    const vBestAsk = parseNumber(pRow.quotes?.best_ask ?? pRow.best_ask, NaN);
    return Number.isFinite(vBestAsk) && vBestAsk > 0 ? vBestAsk : null;
}

function getApiBaseUrl(): string {
    return "https://api.india.delta.exchange/v2";
}

function getPublicSocketUrl(): string {
    return "wss://public-socket.india.delta.exchange";
}

function toExpiryDateForDelta(pDateValue: string): string {
    const objDate = new Date(pDateValue);
    if (Number.isNaN(objDate.getTime())) {
        return "";
    }
    const vDay = String(objDate.getDate()).padStart(2, "0");
    const vMonth = String(objDate.getMonth() + 1).padStart(2, "0");
    const vYear = String(objDate.getFullYear());
    return `${vDay}-${vMonth}-${vYear}`;
}

function addDaysToIsoDate(pDateValue: string, pDays: number): string {
    const objDate = new Date(`${String(pDateValue || "").trim()}T00:00:00`);
    if (Number.isNaN(objDate.getTime())) {
        return String(pDateValue || "").trim();
    }
    objDate.setDate(objDate.getDate() + pDays);
    const vYear = String(objDate.getFullYear());
    const vMonth = String(objDate.getMonth() + 1).padStart(2, "0");
    const vDay = String(objDate.getDate()).padStart(2, "0");
    return `${vYear}-${vMonth}-${vDay}`;
}

async function fetchJson<T>(pPath: string, pSearchParams?: URLSearchParams): Promise<T> {
    const vUrl = `${getApiBaseUrl()}${pPath}${pSearchParams ? `?${pSearchParams.toString()}` : ""}`;
    const objResponse = await fetch(vUrl, {
        headers: {
            Accept: "application/json"
        }
    });

    if (!objResponse.ok) {
        throw new Error(`Delta public market-data request failed: ${objResponse.status}`);
    }

    return objResponse.json() as Promise<T>;
}

interface CachedLiveOptionTicker {
    ticker: RollingOptionsPtDeLiveOptionContract | null;
    expiresAtMs: number;
}

const gLiveOptionTickerCacheBySymbol = new Map<string, CachedLiveOptionTicker>();
let gLiveOptionTickerFetchQueue: Promise<void> = Promise.resolve();
let gLiveOptionTickerCooldownUntilMs = 0;
let gDeltaMarketDataAlertHandler: ((pPayload: { reason: string; symbol?: string; path?: string; status?: number }) => Promise<void> | void) | null = null;
let gDeltaMarketDataAlertCooldownUntilMs = 0;
let gDeltaMarketDataRateLimitSignal: { reason: string; symbol?: string; path?: string; status?: number } | null = null;

const gLiveOptionTickerCacheTtlMs = 5000;
const gLiveOptionTickerCooldownMs = 15000;
const gDeltaMarketDataAlertCooldownMs = 60 * 1000;

function isDeltaRateLimitError(pError: unknown): boolean {
    const vMessage = String((pError as { message?: unknown } | null)?.message || pError || "");
    return vMessage.includes("429");
}

function cacheLiveOptionTicker(pSymbol: string, pTicker: RollingOptionsPtDeLiveOptionContract | null): void {
    gLiveOptionTickerCacheBySymbol.set(pSymbol, {
        ticker: pTicker,
        expiresAtMs: Date.now() + gLiveOptionTickerCacheTtlMs
    });
}

export function setDeltaMarketDataAlertHandler(
    pHandler: ((pPayload: { reason: string; symbol?: string; path?: string; status?: number }) => Promise<void> | void) | null
): void {
    gDeltaMarketDataAlertHandler = pHandler;
}

export function consumeDeltaMarketDataRateLimitSignal(): { reason: string; symbol?: string; path?: string; status?: number } | null {
    const objSignal = gDeltaMarketDataRateLimitSignal;
    gDeltaMarketDataRateLimitSignal = null;
    return objSignal;
}

async function notifyDeltaMarketDataAlert(
    pPayload: { reason: string; symbol?: string; path?: string; status?: number }
): Promise<void> {
    gDeltaMarketDataRateLimitSignal = pPayload;
    if (!gDeltaMarketDataAlertHandler) {
        return;
    }
    if (Date.now() < gDeltaMarketDataAlertCooldownUntilMs) {
        return;
    }
    gDeltaMarketDataAlertCooldownUntilMs = Date.now() + gDeltaMarketDataAlertCooldownMs;
    try {
        await gDeltaMarketDataAlertHandler(pPayload);
    }
    catch (_objError) {
        // Logging must never break market data access.
    }
}

async function runLiveOptionTickerLookupSerial<T>(pTask: () => Promise<T>): Promise<T> {
    const vNext = gLiveOptionTickerFetchQueue.then(pTask, pTask);
    gLiveOptionTickerFetchQueue = vNext.then(() => void 0, () => void 0);
    return vNext;
}

function buildLiveOptionTickerFromRow(pRow: DeltaTickerRow, pFallbackSymbol: string): RollingOptionsPtDeLiveOptionContract | null {
    if (!pRow || !pRow.symbol) {
        return null;
    }

    const vSymbol = String(pRow.symbol || pFallbackSymbol || "").trim();
    if (!vSymbol) {
        return null;
    }

    const vOptionSide = vSymbol.startsWith("P-") || vSymbol.includes("-P-") || vSymbol.endsWith("-P") || vSymbol.includes("PUT")
        ? "PE"
        : "CE";

    return {
        contractSymbol: vSymbol,
        optionSide: vOptionSide,
        strike: parseNumber(pRow.strike_price, 0),
        markPrice: parseNumber(pRow.mark_price, 0),
        bestBid: getTickerBestBid(pRow),
        bestAsk: getTickerBestAsk(pRow),
        delta: parseFiniteOrNaN(pRow.greeks?.delta),
        gamma: parseFiniteOrNaN(pRow.greeks?.gamma),
        theta: parseFiniteOrNaN(pRow.greeks?.theta),
        vega: parseFiniteOrNaN(pRow.greeks?.vega),
        expiryDate: "",
        requestedExpiryDate: "",
        usedNextDayFallback: false
    };
}

class DeltaPublicTickerFeed {
    private static readonly SYMBOL_TTL_MS = 15 * 60 * 1000;
    private ws: WebSocket | null = null;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private readonly desiredSymbols = new Set<string>();
    private readonly lastRequestedAtBySymbol = new Map<string, number>();
    private readonly symbolsByOwner = new Map<string, Set<string>>();
    private readonly tickerBySymbol = new Map<string, DeltaTickerRow>();
    private isOpen = false;
    private isConnecting = false;

    public ensureSymbols(pSymbols: string[]): void {
        this.ensureSymbolsForOwner("__shared__", pSymbols);
    }

    public ensureSymbolsForOwner(pOwnerId: string, pSymbols: string[]): void {
        this.pruneExpiredSymbols();
        const vOwnerId = String(pOwnerId || "").trim() || "__shared__";
        const arrSymbols = pSymbols
            .map((pSymbolRaw) => String(pSymbolRaw || "").trim())
            .filter(Boolean);
        const objNextSymbols = new Set(arrSymbols);
        const objPreviousSymbols = this.symbolsByOwner.get(vOwnerId) || new Set<string>();
        this.symbolsByOwner.set(vOwnerId, objNextSymbols);

        const vNowMs = Date.now();
        for (const vSymbol of objNextSymbols) {
            this.lastRequestedAtBySymbol.set(vSymbol, vNowMs);
        }

        let bChanged = false;
        for (const vSymbol of objNextSymbols) {
            if (!objPreviousSymbols.has(vSymbol) || !this.desiredSymbols.has(vSymbol)) {
                bChanged = true;
            }
        }
        for (const vSymbol of objPreviousSymbols) {
            if (!objNextSymbols.has(vSymbol)) {
                bChanged = true;
            }
        }

        this.rebuildDesiredSymbols();
        if (!bChanged && this.ws && this.isOpen) {
            return;
        }

        this.ensureConnection();
        if (this.ws && this.isOpen) {
            this.subscribeAll();
        }
    }

    public releaseOwner(pOwnerId: string): void {
        const vOwnerId = String(pOwnerId || "").trim() || "__shared__";
        if (!this.symbolsByOwner.delete(vOwnerId)) {
            return;
        }
        this.rebuildDesiredSymbols();
        this.pruneExpiredSymbols();
        if (this.ws && this.isOpen) {
            this.subscribeAll();
        }
    }

    public getTicker(pSymbol: string): DeltaTickerRow | null {
        return this.tickerBySymbol.get(String(pSymbol || "").trim()) || null;
    }

    public getOwnerSymbols(pOwnerId: string): string[] {
        return [...(this.symbolsByOwner.get(String(pOwnerId || "").trim() || "__shared__") || new Set<string>())].sort();
    }

    public getStats(): {
        connectionState: "open" | "connecting" | "closed";
        desiredSymbolCount: number;
        cachedTickerCount: number;
        ownerCount: number;
    } {
        return {
            connectionState: this.isOpen ? "open" : (this.isConnecting ? "connecting" : "closed"),
            desiredSymbolCount: this.desiredSymbols.size,
            cachedTickerCount: this.tickerBySymbol.size,
            ownerCount: this.symbolsByOwner.size
        };
    }

    private ensureConnection(): void {
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            return;
        }
        if (this.isConnecting) {
            return;
        }

        this.isConnecting = true;
        const objWs = new WebSocket(getPublicSocketUrl());
        this.ws = objWs;

        objWs.on("open", () => {
            if (this.ws !== objWs) {
                return;
            }
            this.isConnecting = false;
            this.isOpen = true;
            this.subscribeAll();
        });

        objWs.on("message", (pData) => {
            this.handleMessage(pData.toString());
        });

        objWs.on("close", () => {
            if (this.ws === objWs) {
                this.ws = null;
            }
            this.isOpen = false;
            this.isConnecting = false;
            this.scheduleReconnect();
        });

        objWs.on("error", () => {
            this.isOpen = false;
            this.isConnecting = false;
        });
    }

    private pruneExpiredSymbols(): void {
        const vNowMs = Date.now();
        for (const vSymbol of [...this.desiredSymbols]) {
            const vLastRequestedAtMs = Number(this.lastRequestedAtBySymbol.get(vSymbol) || 0);
            if ((vNowMs - vLastRequestedAtMs) <= DeltaPublicTickerFeed.SYMBOL_TTL_MS) {
                continue;
            }
            this.lastRequestedAtBySymbol.delete(vSymbol);
            this.tickerBySymbol.delete(vSymbol);
        }
        for (const [vOwnerId, objSymbols] of [...this.symbolsByOwner.entries()]) {
            const objFiltered = new Set([...objSymbols].filter((vSymbol) => this.lastRequestedAtBySymbol.has(vSymbol)));
            if (objFiltered.size > 0) {
                this.symbolsByOwner.set(vOwnerId, objFiltered);
                continue;
            }
            this.symbolsByOwner.delete(vOwnerId);
        }
        this.rebuildDesiredSymbols();
    }

    private rebuildDesiredSymbols(): void {
        this.desiredSymbols.clear();
        for (const objSymbols of this.symbolsByOwner.values()) {
            for (const vSymbol of objSymbols) {
                this.desiredSymbols.add(vSymbol);
            }
        }
    }

    private scheduleReconnect(): void {
        if (this.reconnectTimer || this.desiredSymbols.size === 0) {
            return;
        }
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.ensureConnection();
        }, 3000);
    }

    private subscribeAll(): void {
        if (!this.ws || !this.isOpen || this.desiredSymbols.size === 0) {
            return;
        }

        this.ws.send(JSON.stringify({
            type: "subscribe",
            payload: {
                channels: [{
                    name: "v2/ticker",
                    symbols: [...this.desiredSymbols]
                }]
            }
        }));
    }

    private handleMessage(pRaw: string): void {
        let objPayload: unknown = null;
        try {
            objPayload = JSON.parse(pRaw);
        }
        catch (_objError) {
            return;
        }

        const objMessage = objPayload as {
            type?: string;
            result?: DeltaTickerRow[];
            symbol?: string;
        } & DeltaTickerRow;

        if (objMessage.type !== "v2/ticker") {
            return;
        }

        if (Array.isArray(objMessage.result)) {
            for (const objRow of objMessage.result) {
                const vSymbol = String(objRow.symbol || "").trim();
                if (vSymbol) {
                    this.tickerBySymbol.set(vSymbol, objRow);
                }
            }
            return;
        }

        const vSymbol = String(objMessage.symbol || "").trim();
        if (vSymbol) {
            this.tickerBySymbol.set(vSymbol, objMessage);
        }
    }
}

const gDeltaPublicTickerFeed = new DeltaPublicTickerFeed();

export function ensureLiveTickerSymbols(pSymbols: string[]): void {
    gDeltaPublicTickerFeed.ensureSymbols(pSymbols);
}

export function ensureLiveTickerSymbolsForOwner(pOwnerId: string, pSymbols: string[]): void {
    gDeltaPublicTickerFeed.ensureSymbolsForOwner(pOwnerId, pSymbols);
}

export function releaseLiveTickerSymbolsForOwner(pOwnerId: string): void {
    gDeltaPublicTickerFeed.releaseOwner(pOwnerId);
}

export function getLiveTickerFeedStats(): {
    connectionState: "open" | "connecting" | "closed";
    desiredSymbolCount: number;
    cachedTickerCount: number;
    ownerCount: number;
} {
    return gDeltaPublicTickerFeed.getStats();
}

export function getLiveTickerSymbolsForOwner(pOwnerId: string): string[] {
    return gDeltaPublicTickerFeed.getOwnerSymbols(pOwnerId);
}

export async function getLiveMarketSnapshot(
    pConfig: RollingOptionsPtDeConfig
): Promise<RollingOptionsPtDeMarketSnapshot> {
    const objTicker = gDeltaPublicTickerFeed.getTicker(pConfig.contractName)
        || (await fetchJson<DeltaApiResponse<DeltaTickerRow>>(`/tickers/${encodeURIComponent(pConfig.contractName)}`)).result
        || {};
    const vSpotPrice = parseNumber(objTicker.spot_price);
    const vMarkPrice = parseNumber(objTicker.mark_price, vSpotPrice);
    const vBestBid = getTickerBestBid(objTicker) ?? vMarkPrice;
    const vBestAsk = getTickerBestAsk(objTicker) ?? vMarkPrice;

    if (!(vSpotPrice > 0) && !(vMarkPrice > 0)) {
        throw new Error(`No live ticker price available for ${pConfig.contractName}.`);
    }

    return {
        symbol: pConfig.symbol,
        contractName: pConfig.contractName,
        spotPrice: vSpotPrice > 0 ? vSpotPrice : vMarkPrice,
        futuresPrice: vMarkPrice > 0 ? vMarkPrice : vSpotPrice,
        bestBidPrice: vBestBid > 0 ? vBestBid : (vMarkPrice > 0 ? vMarkPrice : vSpotPrice),
        bestAskPrice: vBestAsk > 0 ? vBestAsk : (vMarkPrice > 0 ? vMarkPrice : vSpotPrice),
        priceSource: "public",
        ts: new Date().toISOString()
    };
}

export async function findBestLiveOptionContract(
    pConfig: RollingOptionsPtDeConfig,
    pOptionSide: "CE" | "PE",
    pTargetDelta: number,
    pRequireAtOrBelowTarget = false
): Promise<RollingOptionsPtDeLiveOptionContract | null> {
    const arrExpiryCandidates = [
        { expiryDate: pConfig.expiryDate, usedNextDayFallback: false },
        { expiryDate: addDaysToIsoDate(pConfig.expiryDate, 1), usedNextDayFallback: true }
    ].filter((objCandidate, vIndex, arrRows) => (
        Boolean(toExpiryDateForDelta(objCandidate.expiryDate)) &&
        arrRows.findIndex((objRow) => objRow.expiryDate === objCandidate.expiryDate) === vIndex
    ));

    for (const objCandidate of arrExpiryCandidates) {
        const vExpiryDate = toExpiryDateForDelta(objCandidate.expiryDate);
        if (!vExpiryDate) {
            continue;
        }

        const objParams = new URLSearchParams({
            contract_types: pOptionSide === "CE" ? "call_options" : "put_options",
            underlying_asset_symbols: pConfig.symbol,
            expiry_date: vExpiryDate
        });
        let objPayload: DeltaApiResponse<DeltaTickerRow[]>;
        try {
            objPayload = await runLiveOptionTickerLookupSerial(() => fetchJson<DeltaApiResponse<DeltaTickerRow[]>>("/tickers", objParams));
        }
        catch (objError) {
            if (isDeltaRateLimitError(objError)) {
                void notifyDeltaMarketDataAlert({
                    reason: "rate_limited",
                    path: "/tickers",
                    status: 429
                });
                return null;
            }
            throw objError;
        }
        const objRows = Array.isArray(objPayload.result) ? objPayload.result : [];

        let objBestMatch: RollingOptionsPtDeLiveOptionContract | null = null;
        let vBestGap = Number.POSITIVE_INFINITY;

        for (const objRow of objRows) {
            const vDelta = Math.abs(parseNumber(objRow.greeks?.delta, NaN));
            const vStrike = parseNumber(objRow.strike_price, NaN);
            const vMarkPrice = parseNumber(objRow.mark_price, NaN);
            if (!Number.isFinite(vDelta) || !Number.isFinite(vStrike) || !Number.isFinite(vMarkPrice) || !(vMarkPrice > 0)) {
                continue;
            }
            if (pRequireAtOrBelowTarget && vDelta > Math.abs(pTargetDelta)) {
                continue;
            }

            const vGap = Math.abs(vDelta - Math.abs(pTargetDelta));
            if (vGap >= vBestGap) {
                continue;
            }

            vBestGap = vGap;
            objBestMatch = {
                contractSymbol: String(objRow.symbol || "").trim(),
                optionSide: pOptionSide,
                strike: vStrike,
                markPrice: vMarkPrice,
                bestBid: getTickerBestBid(objRow),
                bestAsk: getTickerBestAsk(objRow),
                delta: parseFiniteOrNaN(objRow.greeks?.delta),
                gamma: parseFiniteOrNaN(objRow.greeks?.gamma),
                theta: parseFiniteOrNaN(objRow.greeks?.theta),
                vega: parseFiniteOrNaN(objRow.greeks?.vega),
                expiryDate: objCandidate.expiryDate,
                requestedExpiryDate: pConfig.expiryDate,
                usedNextDayFallback: objCandidate.usedNextDayFallback
            };
        }

        if (objBestMatch) {
            return objBestMatch;
        }
    }

    return null;
}

export async function getLiveOptionTicker(pContractSymbol: string): Promise<RollingOptionsPtDeLiveOptionContract | null> {
    const vContractSymbol = String(pContractSymbol || "").trim();
    if (!vContractSymbol) {
        return null;
    }

    const objCached = gLiveOptionTickerCacheBySymbol.get(vContractSymbol);
    if (objCached && objCached.expiresAtMs > Date.now()) {
        return objCached.ticker;
    }

    const objWsRow = gDeltaPublicTickerFeed.getTicker(vContractSymbol);
    if (objWsRow) {
        const objTicker = buildLiveOptionTickerFromRow(objWsRow, vContractSymbol);
        if (objTicker) {
            cacheLiveOptionTicker(vContractSymbol, objTicker);
            return objTicker;
        }
    }

    if (Date.now() < gLiveOptionTickerCooldownUntilMs) {
        return objCached?.ticker || null;
    }

    try {
        return await runLiveOptionTickerLookupSerial(async () => {
            const objCachedAfterQueue = gLiveOptionTickerCacheBySymbol.get(vContractSymbol);
            if (objCachedAfterQueue && objCachedAfterQueue.expiresAtMs > Date.now()) {
                return objCachedAfterQueue.ticker;
            }

            const objQueuedWsRow = gDeltaPublicTickerFeed.getTicker(vContractSymbol);
            if (objQueuedWsRow) {
                const objQueuedWsTicker = buildLiveOptionTickerFromRow(objQueuedWsRow, vContractSymbol);
                if (objQueuedWsTicker) {
                    cacheLiveOptionTicker(vContractSymbol, objQueuedWsTicker);
                    return objQueuedWsTicker;
                }
            }

            const objRow = (await fetchJson<DeltaApiResponse<DeltaTickerRow>>(`/tickers/${encodeURIComponent(vContractSymbol)}`)).result;
            const objTicker = objRow ? buildLiveOptionTickerFromRow(objRow, vContractSymbol) : null;
            cacheLiveOptionTicker(vContractSymbol, objTicker);
            return objTicker;
        });
    }
    catch (objError) {
        if (isDeltaRateLimitError(objError)) {
            gLiveOptionTickerCooldownUntilMs = Date.now() + gLiveOptionTickerCooldownMs;
            void notifyDeltaMarketDataAlert({
                reason: "rate_limited",
                symbol: vContractSymbol,
                path: `/tickers/${encodeURIComponent(vContractSymbol)}`,
                status: 429
            });
        }
        return objCached?.ticker || null;
    }
}

export interface CallOiResistanceSnapshot {
    symbol: "BTC" | "ETH";
    contractName: string;
    currentPrice: number;
    priceSource: "spot_price" | "mark_price";
    resistance: null | {
        strike: number;
        contractSymbol: string;
        openInterest: number;
        expiryDate: string;
        distance: number;
    };
    evaluatedAt: string;
}

function formatDdMmYyyyFromDate(pDate: Date): string {
    const vDay = String(pDate.getDate()).padStart(2, "0");
    const vMonth = String(pDate.getMonth() + 1).padStart(2, "0");
    return `${vDay}-${vMonth}-${pDate.getFullYear()}`;
}

function getNearTermExpiryCandidates(): string[] {
    const vNow = new Date();
    const arrDays = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 21, 28, 30, 37, 45, 60];
    return [...new Set(arrDays.map((vDays) => {
        const objDate = new Date(vNow);
        objDate.setDate(objDate.getDate() + vDays);
        return formatDdMmYyyyFromDate(objDate);
    }))];
}

function parseOptionExpiryFromSymbol(pSymbol: string): string {
    const vMatch = String(pSymbol || "").trim().toUpperCase().match(/-(\d{6})$/);
    if (!vMatch) {
        return "";
    }
    const vRaw = vMatch[1];
    const vDay = vRaw.slice(0, 2);
    const vMonth = vRaw.slice(2, 4);
    const vYear = `20${vRaw.slice(4, 6)}`;
    return `${vYear}-${vMonth}-${vDay}`;
}

function parseOptionExpiryMs(pExpiry: string): number {
    const vValue = String(pExpiry || "").trim();
    if (!vValue) {
        return Number.NaN;
    }
    if (/^\d{2}-\d{2}-\d{4}$/.test(vValue)) {
        const [vDay, vMonth, vYear] = vValue.split("-").map((vPart) => Number(vPart));
        return new Date(vYear, vMonth - 1, vDay).getTime();
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(vValue)) {
        return new Date(`${vValue}T00:00:00`).getTime();
    }
    return new Date(vValue).getTime();
}

function getTickerOpenInterest(pRow: DeltaTickerRow): number {
    const vOi = parseNumber(pRow.oi ?? pRow.open_interest, NaN);
    return Number.isFinite(vOi) && vOi > 0 ? vOi : 0;
}

export async function getCallOiResistanceSnapshot(
    pSymbol: "BTC" | "ETH"
): Promise<CallOiResistanceSnapshot> {
    const vSymbol = pSymbol === "ETH" ? "ETH" : "BTC";
    const vContractName = `${vSymbol}USD`;
    const objTicker = gDeltaPublicTickerFeed.getTicker(vContractName)
        || (await fetchJson<DeltaApiResponse<DeltaTickerRow>>(`/tickers/${encodeURIComponent(vContractName)}`)).result
        || {};
    const vSpotPrice = parseNumber(objTicker.spot_price);
    const vMarkPrice = parseNumber(objTicker.mark_price, vSpotPrice);
    const vCurrentPrice = vSpotPrice > 0 ? vSpotPrice : vMarkPrice;
    const vPriceSource: "spot_price" | "mark_price" = vSpotPrice > 0 ? "spot_price" : "mark_price";
    const vEvaluatedAt = new Date().toISOString();

    if (!(vCurrentPrice > 0)) {
        return {
            symbol: vSymbol,
            contractName: vContractName,
            currentPrice: 0,
            priceSource: vPriceSource,
            resistance: null,
            evaluatedAt: vEvaluatedAt
        };
    }

    const arrCallRows: DeltaTickerRow[] = [];
    try {
        const objAllParams = new URLSearchParams({
            contract_types: "call_options",
            underlying_asset_symbols: vSymbol
        });
        const objAllPayload = await runLiveOptionTickerLookupSerial(() => (
            fetchJson<DeltaApiResponse<DeltaTickerRow[]>>("/tickers", objAllParams)
        ));
        if (Array.isArray(objAllPayload.result) && objAllPayload.result.length) {
            arrCallRows.push(...objAllPayload.result);
        }
    }
    catch (_error) {
    }

    if (!arrCallRows.length) {
        for (const vExpiryDate of getNearTermExpiryCandidates()) {
            const objParams = new URLSearchParams({
                contract_types: "call_options",
                underlying_asset_symbols: vSymbol,
                expiry_date: vExpiryDate
            });
            try {
                const objPayload = await runLiveOptionTickerLookupSerial(() => (
                    fetchJson<DeltaApiResponse<DeltaTickerRow[]>>("/tickers", objParams)
                ));
                const arrRows = Array.isArray(objPayload.result) ? objPayload.result : [];
                if (arrRows.length) {
                    arrCallRows.push(...arrRows);
                }
            }
            catch (objError) {
                if (isDeltaRateLimitError(objError)) {
                    break;
                }
            }
            if (arrCallRows.length >= 40) {
                break;
            }
        }
    }

    const arrCandidates = arrCallRows
        .map((objRow) => {
            const vContractSymbol = String(objRow.symbol || "").trim().toUpperCase();
            const vStrike = parseNumber(objRow.strike_price, NaN);
            const vOpenInterest = getTickerOpenInterest(objRow);
            const vExpiryDate = String(objRow.expiry_date || objRow.settlement_time || "").trim()
                || parseOptionExpiryFromSymbol(vContractSymbol);
            const vExpiryMs = parseOptionExpiryMs(vExpiryDate);
            return {
                contractSymbol: vContractSymbol,
                strike: vStrike,
                openInterest: vOpenInterest,
                expiryDate: vExpiryDate,
                expiryMs: vExpiryMs
            };
        })
        .filter((objRow) => (
            objRow.contractSymbol.startsWith("C-")
            && Number.isFinite(objRow.strike)
            && objRow.strike > vCurrentPrice
            && objRow.openInterest > 0
            && Number.isFinite(objRow.expiryMs)
            && objRow.expiryMs >= Date.now() - (6 * 60 * 60 * 1000)
        ));

    if (!arrCandidates.length) {
        return {
            symbol: vSymbol,
            contractName: vContractName,
            currentPrice: Number(vCurrentPrice.toFixed(2)),
            priceSource: vPriceSource,
            resistance: null,
            evaluatedAt: vEvaluatedAt
        };
    }

    const vNearestExpiryMs = Math.min(...arrCandidates.map((objRow) => objRow.expiryMs));
    const arrNearestExpiry = arrCandidates.filter((objRow) => objRow.expiryMs === vNearestExpiryMs);
    arrNearestExpiry.sort((pLeft, pRight) => {
        if (pRight.openInterest !== pLeft.openInterest) {
            return pRight.openInterest - pLeft.openInterest;
        }
        return pLeft.strike - pRight.strike;
    });
    const objBest = arrNearestExpiry[0];
    return {
        symbol: vSymbol,
        contractName: vContractName,
        currentPrice: Number(vCurrentPrice.toFixed(2)),
        priceSource: vPriceSource,
        resistance: {
            strike: Number(objBest.strike.toFixed(2)),
            contractSymbol: objBest.contractSymbol,
            openInterest: Number(objBest.openInterest.toFixed(4)),
            expiryDate: objBest.expiryDate,
            distance: Number((objBest.strike - vCurrentPrice).toFixed(2))
        },
        evaluatedAt: vEvaluatedAt
    };
}
