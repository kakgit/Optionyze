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

// Compact "ticker" payload used by the public socket (wss://public-socket...).
// Field keys are documented as: g = [delta, gamma, rho, theta, vega],
// m = mark_price, q = [best_ask, ask_size, best_bid, bid_size, impact_mid],
// qiv = [ask_iv, bid_iv, mark_iv], ohlc = [open, high, low, close],
// s = symbol, i = product_id, oi = [oi_contracts, oi_change_usd_6h].
interface DeltaCompactTickerRow {
    s?: string;
    i?: number;
    m?: string | number;
    g?: (string | number | null)[] | null;
    q?: (string | number | null)[] | null;
    qiv?: (string | number | null)[] | null;
    ohlc?: (number | null)[] | null;
    oi?: (string | number | null)[] | null;
}

interface DeltaCompactTickerMessage {
    type?: string;
    d?: DeltaCompactTickerRow[];
    sp?: string | number;
    sy?: string;
    ts?: number;
}

function buildTickerRowFromCompact(
    pSymbol: string,
    pRow: DeltaCompactTickerRow,
    pSpotPrice: string | number | undefined
): DeltaTickerRow {
    const arrGreeks = Array.isArray(pRow.g) ? pRow.g : [];
    const arrQuotes = Array.isArray(pRow.q) ? pRow.q : [];
    const vMarkPrice = parseNumber(pRow.m, 0);
    const vBestAsk = parseNumber(arrQuotes[0], NaN);
    const vBestBid = parseNumber(arrQuotes[2], NaN);
    const vSpot = parseNumber(pSpotPrice, 0);

    return {
        symbol: pSymbol,
        mark_price: vMarkPrice,
        spot_price: vSpot,
        best_bid: Number.isFinite(vBestBid) ? vBestBid : undefined,
        best_ask: Number.isFinite(vBestAsk) ? vBestAsk : undefined,
        quotes: {
            best_bid: Number.isFinite(vBestBid) ? vBestBid : undefined,
            best_ask: Number.isFinite(vBestAsk) ? vBestAsk : undefined
        },
        greeks: {
            delta: arrGreeks[0] ?? undefined,
            gamma: arrGreeks[1] ?? undefined,
            // Compact greeks order is [delta, gamma, rho, theta, vega].
            theta: arrGreeks[3] ?? undefined,
            vega: arrGreeks[4] ?? undefined
        }
    };
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

interface DeltaSocketEndpoint {
    url: string;
    channel: string;
}

// Delta exposes its public market-data feed on two endpoints, and each one
// only accepts its own channel name:
//   - wss://socket.india.delta.exchange       -> "v2/ticker" (verbose JSON payload)
//   - wss://public-socket.india.delta.exchange -> "ticker"     (compact payload)
// Subscribing to the wrong channel is answered with
// "subscription forbidden on this invalid channel" and the feed then stays
// open but silent, so we try the endpoints in order and remember the one that
// accepted the subscription.
const gDeltaSocketEndpoints: DeltaSocketEndpoint[] = [
    { url: "wss://socket.india.delta.exchange", channel: "v2/ticker" },
    { url: "wss://public-socket.india.delta.exchange", channel: "ticker" }
];

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
    // If we are in a global rate-limit cooldown, do not hit Delta at all.
    if (Date.now() < gDeltaMarketDataRateLimitCooldownUntilMs) {
        throw new Error("Delta public market-data request failed: 429 (rate-limit cooldown active)");
    }
    const vUrl = `${getApiBaseUrl()}${pPath}${pSearchParams ? `?${pSearchParams.toString()}` : ""}`;
    const objResponse = await fetch(vUrl, {
        headers: {
            Accept: "application/json"
        }
    });

    if (!objResponse.ok) {
        if (objResponse.status === 429) {
            const vRetryAfter = objResponse.headers.get("retry-after");
            const vRetryAfterMs = vRetryAfter ? Number.parseInt(vRetryAfter, 10) * 1000 : gDeltaMarketDataRateLimitCooldownMs;
            gDeltaMarketDataRateLimitCooldownUntilMs = Date.now() + Math.min(vRetryAfterMs, gDeltaMarketDataRateLimitCooldownMs);
            void notifyDeltaMarketDataAlert({
                reason: "rate_limited",
                path: pPath,
                status: 429
            });
        }
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

let gDeltaMarketDataRateLimitCooldownUntilMs = 0;

const gLiveOptionTickerCacheTtlMs = 5000;
const gLiveOptionTickerCooldownMs = 15000;
const gDeltaMarketDataRateLimitCooldownMs = 180 * 1000;
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

export function getDeltaMarketDataRateLimitStatus(): {
    rateLimited: boolean;
    cooldownUntilMs: number;
    cooldownRemainingMs: number;
    cooldownMs: number;
    lastSignal: { reason: string; symbol?: string; path?: string; status?: number } | null;
    cachedTickerCount: number;
    connectionState: string;
    socketEndpoint: string;
    socketChannel: string;
    socketError: string;
    socketLastMessageAtMs: number;
    socketDesiredSymbolCount: number;
} {
    const vNow = Date.now();
    const bRateLimited = vNow < gDeltaMarketDataRateLimitCooldownUntilMs;
    const objStats = gDeltaPublicTickerFeed.getStats();
    return {
        rateLimited: bRateLimited,
        cooldownUntilMs: gDeltaMarketDataRateLimitCooldownUntilMs,
        cooldownRemainingMs: bRateLimited
            ? Math.max(0, gDeltaMarketDataRateLimitCooldownUntilMs - vNow)
            : 0,
        cooldownMs: gDeltaMarketDataRateLimitCooldownMs,
        lastSignal: gDeltaMarketDataRateLimitSignal,
        cachedTickerCount: gLiveOptionTickerCacheBySymbol.size,
        connectionState: objStats.connectionState,
        socketEndpoint: objStats.endpointUrl,
        socketChannel: objStats.channel,
        socketError: objStats.lastError,
        socketLastMessageAtMs: objStats.lastMessageAtMs,
        socketDesiredSymbolCount: objStats.desiredSymbolCount
    };
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
    // Delta disconnects a socket that has been silent for 60 seconds. The
    // documented keepalive is a raw {"type":"ping"} roughly every 30 seconds
    // with a pong expected within 5 seconds.
    private static readonly PING_INTERVAL_MS = 30 * 1000;
    private static readonly PONG_TIMEOUT_MS = 5 * 1000;
    // Delta allows 150 connections per 5 minutes per IP; a 429 on connect
    // means we must back off for 5-10 minutes before retrying.
    private static readonly RECONNECT_DELAY_MS = 60 * 1000;
    private static readonly RATE_LIMIT_RECONNECT_DELAY_MS = 5 * 60 * 1000;
    private ws: WebSocket | null = null;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private pingTimer: NodeJS.Timeout | null = null;
    private pongTimer: NodeJS.Timeout | null = null;
    private endpointIndex = 0;
    private awaitingPong = false;
    private lastError = "";
    private lastMessageAtMs = 0;
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

    /**
     * Resolves once the socket has delivered a ticker for every requested
     * symbol, or when the timeout expires. Callers use this to avoid falling
     * back to the REST /tickers endpoint right after subscribing, which is
     * what produced the HTTP 429 rate-limit errors.
     */
    public waitForTickers(pSymbols: string[], pTimeoutMs = 6000): Promise<void> {
        const arrSymbols = pSymbols
            .map((pSymbol) => String(pSymbol || "").trim())
            .filter(Boolean);
        if (!arrSymbols.length) {
            return Promise.resolve();
        }

        return new Promise<void>((pResolve) => {
            let bDone = false;
            const vFinish = (): void => {
                if (bDone) {
                    return;
                }
                bDone = true;
                clearInterval(objPollTimer);
                clearTimeout(objTimeoutTimer);
                pResolve();
            };
            const objPollTimer = setInterval(() => {
                const bAllPresent = arrSymbols.every((vSymbol) => this.tickerBySymbol.has(vSymbol));
                if (bAllPresent) {
                    vFinish();
                }
            }, 250);
            const objTimeoutTimer = setTimeout(vFinish, pTimeoutMs);
        });
    }

    public getOwnerSymbols(pOwnerId: string): string[] {
        return [...(this.symbolsByOwner.get(String(pOwnerId || "").trim() || "__shared__") || new Set<string>())].sort();
    }

    public getAllTickers(): DeltaTickerRow[] {
        return [...this.tickerBySymbol.values()];
    }

    public getStats(): {
        connectionState: "open" | "connecting" | "closed";
        desiredSymbolCount: number;
        cachedTickerCount: number;
        ownerCount: number;
        endpointUrl: string;
        channel: string;
        lastError: string;
        lastMessageAtMs: number;
    } {
        const objEndpoint = this.getCurrentEndpoint();
        return {
            connectionState: this.isOpen ? "open" : (this.isConnecting ? "connecting" : "closed"),
            desiredSymbolCount: this.desiredSymbols.size,
            cachedTickerCount: this.tickerBySymbol.size,
            ownerCount: this.symbolsByOwner.size,
            endpointUrl: objEndpoint.url,
            channel: objEndpoint.channel,
            lastError: this.lastError,
            lastMessageAtMs: this.lastMessageAtMs
        };
    }

    private getCurrentEndpoint(): DeltaSocketEndpoint {
        return gDeltaSocketEndpoints[this.endpointIndex % gDeltaSocketEndpoints.length];
    }

    private ensureConnection(): void {
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            return;
        }
        if (this.isConnecting) {
            return;
        }

        this.isConnecting = true;
        const objEndpoint = this.getCurrentEndpoint();
        const objWs = new WebSocket(objEndpoint.url);
        this.ws = objWs;

        objWs.on("open", () => {
            if (this.ws !== objWs) {
                return;
            }
            this.isConnecting = false;
            this.isOpen = true;
            this.lastError = "";
            this.startKeepalive();
            this.subscribeAll();
        });

        objWs.on("message", (pData) => {
            this.handleMessage(pData.toString());
        });

        objWs.on("close", (pCode, pReason) => {
            this.stopKeepalive();
            if (this.ws === objWs) {
                this.ws = null;
            }
            this.isOpen = false;
            this.isConnecting = false;
            this.lastError = `socket closed (code ${pCode}${pReason?.length ? `: ${pReason.toString()}` : ""})`;
            this.scheduleReconnect();
        });

        objWs.on("error", (pError) => {
            this.isOpen = false;
            this.isConnecting = false;
            this.lastError = pError instanceof Error ? pError.message : String(pError);
            // A 429 during the WebSocket handshake means the per-IP connection
            // budget (150 per 5 minutes) is exhausted. Reconnect on error too,
            // not just on close, and back off harder in that case.
            this.scheduleReconnect(pError instanceof Error && pError.message.includes("429"));
        });
    }

    private startKeepalive(): void {
        this.stopKeepalive();
        this.pingTimer = setInterval(() => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                return;
            }
            try {
                this.ws.send(JSON.stringify({ type: "ping" }));
            }
            catch (_objError) {
                return;
            }
            this.awaitingPong = true;
            this.pongTimer = setTimeout(() => {
                // No pong within 5 seconds: the socket is considered dead.
                this.awaitingPong = false;
                this.lastError = "no pong received within 5s";
                this.handleConnectionLost();
            }, DeltaPublicTickerFeed.PONG_TIMEOUT_MS);
        }, DeltaPublicTickerFeed.PING_INTERVAL_MS);
    }

    private stopKeepalive(): void {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }
        if (this.pongTimer) {
            clearTimeout(this.pongTimer);
            this.pongTimer = null;
        }
        this.awaitingPong = false;
    }

    private handleConnectionLost(pImmediateReconnect = false): void {
        this.stopKeepalive();
        const objWs = this.ws;
        this.ws = null;
        this.isOpen = false;
        this.isConnecting = false;
        if (objWs) {
            try {
                objWs.terminate();
            }
            catch (_objError) {
                // ignore
            }
        }
        if (pImmediateReconnect) {
            // Rotating to another endpoint should not wait for the backoff.
            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
            }
            this.ensureConnection();
            return;
        }
        this.scheduleReconnect();
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

    private scheduleReconnect(pRateLimited = false): void {
        if (this.reconnectTimer || this.desiredSymbols.size === 0) {
            return;
        }
        const vDelayMs = pRateLimited
            ? DeltaPublicTickerFeed.RATE_LIMIT_RECONNECT_DELAY_MS
            : DeltaPublicTickerFeed.RECONNECT_DELAY_MS;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.ensureConnection();
        }, vDelayMs);
    }

    private subscribeAll(): void {
        if (!this.ws || !this.isOpen || this.desiredSymbols.size === 0) {
            return;
        }

        const objEndpoint = this.getCurrentEndpoint();
        try {
            this.ws.send(JSON.stringify({
                type: "subscribe",
                payload: {
                    channels: [{
                        name: objEndpoint.channel,
                        symbols: [...this.desiredSymbols]
                    }]
                }
            }));
        }
        catch (pError) {
            this.lastError = pError instanceof Error ? pError.message : String(pError);
            this.handleConnectionLost();
        }
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
            channels?: { name?: string; error?: string; symbols?: string[] }[];
        } & DeltaTickerRow;

        // Keepalive response: the server answers our {"type":"ping"} with
        // {"type":"pong"}.
        if (objMessage.type === "pong") {
            this.awaitingPong = false;
            if (this.pongTimer) {
                clearTimeout(this.pongTimer);
                this.pongTimer = null;
            }
            this.lastMessageAtMs = Date.now();
            return;
        }

        // Subscription acknowledgement. A rejected channel means we picked the
        // wrong endpoint, so rotate to the next one and reconnect there.
        if (objMessage.type === "subscriptions") {
            this.lastMessageAtMs = Date.now();
            const arrChannels = Array.isArray(objMessage.channels) ? objMessage.channels : [];
            for (const objChannel of arrChannels) {
                if (!objChannel?.error) {
                    continue;
                }
                this.lastError = `subscription rejected on ${objChannel.name || "?"}: ${objChannel.error}`;
                // "subscription forbidden on this invalid channel" / "...on this
                // channel" => wrong channel for this endpoint. Try the next one.
                this.endpointIndex = (this.endpointIndex + 1) % gDeltaSocketEndpoints.length;
                this.handleConnectionLost(true);
                return;
            }
            return;
        }

        this.lastMessageAtMs = Date.now();

        // "v2/ticker" -> verbose payload with the full ticker row.
        if (objMessage.type === "v2/ticker") {
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
            return;
        }

        // "ticker" -> compact payload (public socket). Normalise it into the
        // same DeltaTickerRow shape the rest of the code expects.
        if (objMessage.type === "ticker") {
            const objCompact = objPayload as DeltaCompactTickerMessage;
            const arrRows = Array.isArray(objCompact.d) ? objCompact.d : [];
            for (const objRow of arrRows) {
                const vSymbol = String(objRow.s || "").trim();
                if (!vSymbol) {
                    continue;
                }
                this.tickerBySymbol.set(vSymbol, buildTickerRowFromCompact(vSymbol, objRow, objCompact.sp));
            }
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

export async function waitForLiveTickerSymbols(pSymbols: string[], pTimeoutMs = 6000): Promise<void> {
    await gDeltaPublicTickerFeed.waitForTickers(pSymbols, pTimeoutMs);
}

export function getLiveTickerFeedStats(): {
    connectionState: "open" | "connecting" | "closed";
    desiredSymbolCount: number;
    cachedTickerCount: number;
    ownerCount: number;
    endpointUrl: string;
    channel: string;
    lastError: string;
    lastMessageAtMs: number;
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
            // If we're in global rate-limit cooldown, fetchJson threw before
            // reaching Delta. Return null silently without alerting.
            if (Date.now() < gDeltaMarketDataRateLimitCooldownUntilMs) {
                return null;
            }
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

// Delta's /tickers/{symbol} endpoint accepts up to 10 comma-separated symbols
// in one call. Batching keeps the REST fallback to one request per 10
// contracts instead of one request per contract, which is what caused the
// HTTP 429 rate-limit errors.
const gDeltaTickerBatchMaxSymbols = 10;

async function fetchTickerRowsForSymbols(pSymbols: string[]): Promise<Map<string, DeltaTickerRow>> {
    const objRowsBySymbol = new Map<string, DeltaTickerRow>();
    const arrSymbols = Array.from(new Set(
        pSymbols
            .map((pSymbol) => String(pSymbol || "").trim())
            .filter(Boolean)
    ));
    if (!arrSymbols.length) {
        return objRowsBySymbol;
    }

    for (let vIndex = 0; vIndex < arrSymbols.length; vIndex += gDeltaTickerBatchMaxSymbols) {
        const arrBatch = arrSymbols.slice(vIndex, vIndex + gDeltaTickerBatchMaxSymbols);
        const objPayload = await fetchJson<DeltaApiResponse<DeltaTickerRow | DeltaTickerRow[]>>(
            `/tickers/${arrBatch.map((pSymbol) => encodeURIComponent(pSymbol)).join(",")}`
        );
        const arrRows = Array.isArray(objPayload?.result)
            ? objPayload.result
            : (objPayload?.result ? [objPayload.result] : []);
        for (const objRow of arrRows) {
            const vSymbol = String(objRow?.symbol || "").trim();
            if (vSymbol) {
                objRowsBySymbol.set(vSymbol, objRow);
            }
        }
    }

    return objRowsBySymbol;
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

            // Batch this symbol with any other symbol that is also missing from
            // the cache and the socket, so we spend one request per 10 symbols
            // instead of one request per symbol.
            const arrBatchSymbols = [vContractSymbol];
            for (const [vSymbol, objEntry] of gLiveOptionTickerCacheBySymbol.entries()) {
                if (arrBatchSymbols.length >= gDeltaTickerBatchMaxSymbols) {
                    break;
                }
                if (vSymbol === vContractSymbol) {
                    continue;
                }
                if (objEntry.expiresAtMs > Date.now()) {
                    continue;
                }
                if (gDeltaPublicTickerFeed.getTicker(vSymbol)) {
                    continue;
                }
                arrBatchSymbols.push(vSymbol);
            }

            const objRowsBySymbol = await fetchTickerRowsForSymbols(arrBatchSymbols);
            for (const [vSymbol, objRow] of objRowsBySymbol.entries()) {
                cacheLiveOptionTicker(vSymbol, buildLiveOptionTickerFromRow(objRow, vSymbol));
            }

            const objTicker = objRowsBySymbol.has(vContractSymbol)
                ? buildLiveOptionTickerFromRow(objRowsBySymbol.get(vContractSymbol) as DeltaTickerRow, vContractSymbol)
                : null;
            cacheLiveOptionTicker(vContractSymbol, objTicker);
            return objTicker;
        });
    }
    catch (objError) {
        // If we're in global rate-limit cooldown, fetchJson threw before
        // reaching Delta. Return cached silently without alerting.
        if (Date.now() < gDeltaMarketDataRateLimitCooldownUntilMs) {
            return objCached?.ticker || null;
        }
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
