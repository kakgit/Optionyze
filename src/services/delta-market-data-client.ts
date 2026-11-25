const gDeltaIndiaApiBase = "https://api.india.delta.exchange/v2";

// Delta's /history/candles endpoint returns at most 4000 candles per request.
// At 30m resolution that is ~83 days of data. We page in smaller 75-day
// chunks (~3600 candles) to stay safely under the cap on every page.
const gMaxCandlesPerRequest = 4000;
const gChunkDays = 75;
const gRequestDelayMs = 1000;

interface DeltaApiResponse<T> {
    success?: boolean;
    result?: T;
    error?: { code?: string; message?: string } | string;
}

export interface DeltaCandleRow {
    time: number; // unix seconds, candle open time
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

interface DeltaCandleRaw {
    time?: string | number;
    open?: string | number;
    high?: string | number;
    low?: string | number;
    close?: string | number;
    volume?: string | number;
}

function toFiniteNumber(pValue: unknown, pFallback = 0): number {
    const vNumber = Number(pValue);
    return Number.isFinite(vNumber) ? vNumber : pFallback;
}

async function sleep(pMs: number): Promise<void> {
    return new Promise((pResolve) => setTimeout(pResolve, pMs));
}

async function fetchDeltaJson<T>(pPath: string, pSearchParams?: URLSearchParams): Promise<T> {
    const vUrl = `${gDeltaIndiaApiBase}${pPath}${pSearchParams ? `?${pSearchParams.toString()}` : ""}`;
    const objResponse = await fetch(vUrl, {
        headers: {
            Accept: "application/json",
            "User-Agent": "Optionyze/1.0"
        }
    });
    const vText = await objResponse.text();
    let objJson: DeltaApiResponse<unknown> = {};
    try {
        objJson = vText ? JSON.parse(vText) as DeltaApiResponse<unknown> : {};
    }
    catch (_objError) {
        throw new Error(`Delta market-data response was not JSON (${objResponse.status}) for ${pPath}: ${vText.slice(0, 120)}`);
    }
    if (!objResponse.ok) {
        throw new Error(`Delta market-data request failed (${objResponse.status}) for ${pPath}`);
    }
    if (objJson.success === false) {
        const vCode = objJson.error && typeof objJson.error === "object" ? String(objJson.error.code || "") : "";
        const vMsg = objJson.error && typeof objJson.error === "object" ? String(objJson.error.message || "") : String(objJson.error || "");
        throw new Error(`Delta market-data request failed${vCode ? `: ${vCode}` : ""}${vMsg ? ` - ${vMsg}` : ""} for ${pPath}`);
    }
    return objJson.result as T;
}

function mapRawCandles(pRows: DeltaCandleRaw[]): DeltaCandleRow[] {
    const arrOut: DeltaCandleRow[] = [];
    for (const objRow of pRows) {
        const vTime = Math.floor(toFiniteNumber(objRow.time, NaN));
        if (!Number.isFinite(vTime)) {
            continue;
        }
        arrOut.push({
            time: vTime,
            open: toFiniteNumber(objRow.open),
            high: toFiniteNumber(objRow.high),
            low: toFiniteNumber(objRow.low),
            close: toFiniteNumber(objRow.close),
            volume: toFiniteNumber(objRow.volume)
        });
    }
    return arrOut;
}

/**
 * Fetches a single page of historical candles from Delta Exchange.
 * Public endpoint: no authentication required.
 * Resolution examples: "1m", "5m", "15m", "30m", "1h", "1d".
 * start/end are unix timestamps in seconds (inclusive window).
 */
export async function fetchDeltaCandlesPage(
    pSymbol: string,
    pResolution: string,
    pStart: number,
    pEnd: number
): Promise<DeltaCandleRow[]> {
    const vSymbol = String(pSymbol || "").trim().toUpperCase();
    const vResolution = String(pResolution || "30m").trim();
    if (!vSymbol) {
        throw new Error("Symbol is required for Delta candle fetch.");
    }
    if (!Number.isFinite(pStart) || !Number.isFinite(pEnd) || pEnd <= pStart) {
        throw new Error("Invalid start/end range for Delta candle fetch.");
    }
    const objParams = new URLSearchParams({
        symbol: vSymbol,
        resolution: vResolution,
        start: Math.floor(pStart).toString(),
        end: Math.floor(pEnd).toString()
    });
    const arrRaw = (await fetchDeltaJson<DeltaCandleRaw[]>(`/history/candles`, objParams)) || [];
    return mapRawCandles(Array.isArray(arrRaw) ? arrRaw : []);
}

/**
 * Fetches historical candles across the full [pStart, pEnd] range by paging
 * backward through Delta's per-request cap (4000 candles). Returns candles
 * sorted ascending by time with duplicates removed.
 */
export async function fetchDeltaCandles(
    pSymbol: string,
    pResolution: string,
    pStart: number,
    pEnd: number
): Promise<DeltaCandleRow[]> {
    const vSymbol = String(pSymbol || "").trim().toUpperCase();
    const vResolution = String(pResolution || "30m").trim();
    const vStart = Math.floor(pStart);
    const vEnd = Math.floor(pEnd);
    if (!vSymbol) {
        throw new Error("Symbol is required for Delta candle fetch.");
    }
    if (!Number.isFinite(vStart) || !Number.isFinite(vEnd) || vEnd <= vStart) {
        throw new Error("Invalid start/end range for Delta candle fetch.");
    }

    const arrAll: DeltaCandleRow[] = [];
    const vSeenTimes = new Set<number>();
    let vCursorEnd = vEnd;
    const gIntervalSeconds = 30 * 60; // 30m candles align to 1800-second boundaries

    while (vCursorEnd > vStart) {
        const vChunkStart = Math.max(vStart, vCursorEnd - gChunkDays * 24 * 60 * 60);
        const arrPage = await fetchDeltaCandlesPage(vSymbol, vResolution, vChunkStart, vCursorEnd);
        if (arrPage.length === 0) {
            break;
        }
        let vOldest = Number.POSITIVE_INFINITY;
        for (const objCandle of arrPage) {
            if (!vSeenTimes.has(objCandle.time)) {
                vSeenTimes.add(objCandle.time);
                arrAll.push(objCandle);
            }
            if (objCandle.time < vOldest) {
                vOldest = objCandle.time;
            }
        }
        // Step back one interval beyond the oldest candle so the next page
        // does not re-fetch it and does not leave a gap.
        vCursorEnd = Math.floor(vOldest) - gIntervalSeconds;
        if (vCursorEnd <= vStart) {
            break;
        }
        await sleep(gRequestDelayMs);
    }

    arrAll.sort((pLeft, pRight) => pLeft.time - pRight.time);
    return arrAll;
}

/**
 * Downloads approximately one year of 30-minute candles for a symbol.
 * Convenience wrapper around fetchDeltaCandles.
 */
export async function downloadYearOf30mCandles(
    pSymbol: string,
    pLookbackDays = 365
): Promise<DeltaCandleRow[]> {
    const vEnd = Math.floor(Date.now() / 1000);
    const vStart = vEnd - pLookbackDays * 24 * 60 * 60;
    return fetchDeltaCandles(pSymbol, "30m", vStart, vEnd);
}
