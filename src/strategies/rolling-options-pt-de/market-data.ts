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
    spot_price?: string | number;
    strike_price?: string | number;
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
}

function parseNumber(pValue: unknown, pFallback = 0): number {
    const vNum = Number(pValue);
    return Number.isFinite(vNum) ? vNum : pFallback;
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

class DeltaPublicTickerFeed {
    private ws: WebSocket | null = null;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private readonly desiredSymbols = new Set<string>();
    private readonly tickerBySymbol = new Map<string, DeltaTickerRow>();
    private isOpen = false;
    private isConnecting = false;

    public ensureSymbols(pSymbols: string[]): void {
        let bChanged = false;
        for (const vSymbolRaw of pSymbols) {
            const vSymbol = String(vSymbolRaw || "").trim();
            if (!vSymbol) {
                continue;
            }
            if (!this.desiredSymbols.has(vSymbol)) {
                this.desiredSymbols.add(vSymbol);
                bChanged = true;
            }
        }

        if (!bChanged && this.ws && this.isOpen) {
            return;
        }

        this.ensureConnection();
        if (this.ws && this.isOpen) {
            this.subscribeAll();
        }
    }

    public getTicker(pSymbol: string): DeltaTickerRow | null {
        return this.tickerBySymbol.get(String(pSymbol || "").trim()) || null;
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

export async function getLiveMarketSnapshot(
    pConfig: RollingOptionsPtDeConfig
): Promise<RollingOptionsPtDeMarketSnapshot> {
    const objTicker = gDeltaPublicTickerFeed.getTicker(pConfig.contractName)
        || (await fetchJson<DeltaApiResponse<DeltaTickerRow>>(`/tickers/${encodeURIComponent(pConfig.contractName)}`)).result
        || {};
    const vSpotPrice = parseNumber(objTicker.spot_price);
    const vMarkPrice = parseNumber(objTicker.mark_price, vSpotPrice);

    if (!(vSpotPrice > 0) && !(vMarkPrice > 0)) {
        throw new Error(`No live ticker price available for ${pConfig.contractName}.`);
    }

    return {
        symbol: pConfig.symbol,
        contractName: pConfig.contractName,
        spotPrice: vSpotPrice > 0 ? vSpotPrice : vMarkPrice,
        futuresPrice: vMarkPrice > 0 ? vMarkPrice : vSpotPrice,
        priceSource: "public",
        ts: new Date().toISOString()
    };
}

export async function findBestLiveOptionContract(
    pConfig: RollingOptionsPtDeConfig,
    pOptionSide: "CE" | "PE",
    pTargetDelta: number
): Promise<RollingOptionsPtDeLiveOptionContract | null> {
    const vExpiryDate = toExpiryDateForDelta(pConfig.expiryDate);
    if (!vExpiryDate) {
        return null;
    }

    const objParams = new URLSearchParams({
        contract_types: pOptionSide === "CE" ? "call_options" : "put_options",
        underlying_asset_symbols: pConfig.symbol,
        expiry_date: vExpiryDate
    });
    const objPayload = await fetchJson<DeltaApiResponse<DeltaTickerRow[]>>("/tickers", objParams);
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
            bestBid: Number.isFinite(parseNumber(objRow.quotes?.best_bid, NaN)) ? parseNumber(objRow.quotes?.best_bid, NaN) : null,
            bestAsk: Number.isFinite(parseNumber(objRow.quotes?.best_ask, NaN)) ? parseNumber(objRow.quotes?.best_ask, NaN) : null,
            delta: parseNumber(objRow.greeks?.delta, 0),
            gamma: parseNumber(objRow.greeks?.gamma, 0),
            theta: parseNumber(objRow.greeks?.theta, 0),
            vega: parseNumber(objRow.greeks?.vega, 0)
        };
    }

    return objBestMatch;
}

export async function getLiveOptionTicker(pContractSymbol: string): Promise<RollingOptionsPtDeLiveOptionContract | null> {
    const objRow = gDeltaPublicTickerFeed.getTicker(pContractSymbol)
        || (await fetchJson<DeltaApiResponse<DeltaTickerRow>>(`/tickers/${encodeURIComponent(pContractSymbol)}`)).result;
    if (!objRow || !objRow.symbol) {
        return null;
    }

    const vOptionSide = String(objRow.symbol).startsWith("P-") ? "PE" : "CE";
    return {
        contractSymbol: String(objRow.symbol || "").trim(),
        optionSide: vOptionSide,
        strike: parseNumber(objRow.strike_price, 0),
        markPrice: parseNumber(objRow.mark_price, 0),
        bestBid: Number.isFinite(parseNumber(objRow.quotes?.best_bid, NaN)) ? parseNumber(objRow.quotes?.best_bid, NaN) : null,
        bestAsk: Number.isFinite(parseNumber(objRow.quotes?.best_ask, NaN)) ? parseNumber(objRow.quotes?.best_ask, NaN) : null,
        delta: parseNumber(objRow.greeks?.delta, 0),
        gamma: parseNumber(objRow.greeks?.gamma, 0),
        theta: parseNumber(objRow.greeks?.theta, 0),
        vega: parseNumber(objRow.greeks?.vega, 0)
    };
}
