import type { Request, Response } from "express";

// Delta Exchange publishes candle history only on the global API host. The
// India host (used elsewhere in this codebase for live tickers) answers
// /v2/history/candles with an empty result set, so every historical-data
// request from the Simulator targets the global host. Verified by live API
// probes while building this page (see the notes panel on the Simulator page).
const gDeltaApiBase = String(process.env.DELTA_API_BASE_URL || "https://api.delta.exchange").replace(/\/+$/, "");

// Resolutions accepted by GET /v2/history/candles. Anything else (2m, 12h,
// ...) is rejected with HTTP 400 by the exchange.
const gSimulatorResolutions = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "1d", "1w"] as const;
type SimulatorResolution = (typeof gSimulatorResolutions)[number];

const gResolutionSeconds: Record<SimulatorResolution, number> = {
    "1m": 60,
    "3m": 180,
    "5m": 300,
    "15m": 900,
    "30m": 1800,
    "1h": 3600,
    "2h": 7200,
    "4h": 14400,
    "6h": 21600,
    "1d": 86400,
    "1w": 604800
};

// Delta caps a single history/candles call at 4001 rows (verified live: the
// limit query parameter does not raise the cap) and returns them newest
// first, so the controller walks backwards through the window in pages.
const gMaxRowsPerHistoryCall = 4001;
const gMaxHistoryPages = 4;
const gMaxCandlesTotal = 16000;

interface DeltaCandle {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

interface DeltaApiEnvelope<T> {
    success?: boolean;
    result?: T;
    error?: unknown;
    message?: string;
}

interface DeltaProductRow {
    id?: number;
    symbol?: string;
    contract_type?: string;
    strike_price?: string | number;
    settlement_time?: string;
    state?: string;
    contract_value?: string | number;
    description?: string;
    contract_unit_currency?: string;
    underlying_asset?: { symbol?: string };
}

function getErrorMessage(pError: unknown, pFallback: string): string {
    if (pError instanceof Error && String(pError.message || "").trim()) {
        return pError.message;
    }
    return pFallback;
}

function isSimulatorResolution(pValue: string): pValue is SimulatorResolution {
    return (gSimulatorResolutions as readonly string[]).includes(pValue);
}

async function fetchDeltaJson<T>(pPath: string, pParams?: Record<string, string>): Promise<T> {
    const objUrl = new URL(`${gDeltaApiBase}/${pPath.replace(/^\/+/, "")}`);
    if (pParams) {
        for (const [strKey, strValue] of Object.entries(pParams)) {
            if (strValue !== undefined && strValue !== null && String(strValue) !== "") {
                objUrl.searchParams.set(strKey, strValue);
            }
        }
    }
    const objResponse = await fetch(objUrl, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(25000)
    });
    if (!objResponse.ok) {
        throw new Error(`Delta Exchange request failed with HTTP ${objResponse.status} for ${pPath}.`);
    }
    return objResponse.json() as Promise<T>;
}

// Accepts unix seconds, unix milliseconds, or an ISO-ish date string and
// returns unix seconds, or null when the value cannot be parsed.
function toUnixSeconds(pValue: unknown): number | null {
    if (pValue === undefined || pValue === null || pValue === "") {
        return null;
    }
    const vRaw = String(pValue).trim();
    if (/^\d+$/.test(vRaw)) {
        const vNumber = Number(vRaw);
        if (!Number.isFinite(vNumber) || vNumber <= 0) {
            return null;
        }
        // Millisecond timestamps are 13 digits; normalise them to seconds.
        return vNumber > 99999999999 ? Math.floor(vNumber / 1000) : Math.floor(vNumber);
    }
    const vParsed = Date.parse(vRaw);
    if (Number.isNaN(vParsed)) {
        return null;
    }
    return Math.floor(vParsed / 1000);
}

function formatUnixSecondsAsUtc(pSeconds: number): string {
    return new Date(pSeconds * 1000).toISOString().replace(".000Z", "Z");
}

export function renderSimulatorPage(req: Request, res: Response): void {
    res.render("simulator", {
        pageTitle: "Simulator | Optionyze",
        currentAccount: req.authAccount,
        defaultUserId: req.authAccount?.accountId || "demo-paper",
        simulatorResolutions: gSimulatorResolutions,
        simulatorMaxCandles: gMaxCandlesTotal,
        simulatorRowsPerCall: gMaxRowsPerHistoryCall
    });
}

// GET /api/simulator/candles?symbol=BTCUSD&resolution=1h&start=...&end=...
// Proxies Delta Exchange historical OHLC candles with backwards pagination
// so a window can return more than the exchange-side 4001-row page cap.
export async function getSimulatorCandles(req: Request, res: Response): Promise<void> {
    try {
        const vSymbol = String(req.query.symbol || "").trim().toUpperCase();
        if (!/^[A-Z0-9._-]{1,48}$/.test(vSymbol)) {
            res.json({ status: "warning", message: "Choose a valid symbol to load history for.", data: null });
            return;
        }
        const vResolution = String(req.query.resolution || "1h").trim();
        if (!isSimulatorResolution(vResolution)) {
            res.json({
                status: "warning",
                message: `Unsupported timeframe. Use one of: ${gSimulatorResolutions.join(", ")}.`,
                data: null
            });
            return;
        }
        const vStart = toUnixSeconds(req.query.start);
        const vEnd = toUnixSeconds(req.query.end);
        if (vStart === null || vEnd === null) {
            res.json({ status: "warning", message: "Provide a valid start and end date/time.", data: null });
            return;
        }
        if (vEnd <= vStart) {
            res.json({ status: "warning", message: "The end date/time must be after the start date/time.", data: null });
            return;
        }

        const vResolutionSeconds = gResolutionSeconds[vResolution];
        const vExpectedCandles = Math.floor((vEnd - vStart) / vResolutionSeconds) + 1;
        if (vExpectedCandles > gMaxCandlesTotal) {
            res.json({
                status: "warning",
                message: `That window holds about ${vExpectedCandles.toLocaleString("en-US")} ${vResolution} candles. The Simulator loads up to ${gMaxCandlesTotal.toLocaleString("en-US")} per request - pick a shorter range or a coarser timeframe.`,
                data: null
            });
            return;
        }

        const arrCollected: DeltaCandle[] = [];
        const objSeen = new Map<number, DeltaCandle>();
        let vCursorEnd = vEnd;
        for (let vPage = 0; vPage < gMaxHistoryPages; vPage += 1) {
            const objBody = await fetchDeltaJson<DeltaApiEnvelope<DeltaCandle[]>>("v2/history/candles", {
                symbol: vSymbol,
                resolution: vResolution,
                start: String(vStart),
                end: String(vCursorEnd)
            });
            const arrRows = Array.isArray(objBody.result) ? objBody.result : [];
            if (arrRows.length === 0) {
                break;
            }
            let vOldest = Number.POSITIVE_INFINITY;
            for (const objRow of arrRows) {
                const vTime = Number(objRow?.time);
                if (!Number.isFinite(vTime)) {
                    continue;
                }
                vOldest = Math.min(vOldest, vTime);
                if (vTime < vStart || vTime > vEnd) {
                    continue;
                }
                if (!objSeen.has(vTime)) {
                    objSeen.set(vTime, objRow);
                    arrCollected.push(objRow);
                }
            }
            if (arrRows.length < gMaxRowsPerHistoryCall || !Number.isFinite(vOldest) || vOldest <= vStart) {
                break;
            }
            vCursorEnd = vOldest - 1;
            if (arrCollected.length >= gMaxCandlesTotal) {
                break;
            }
        }

        const arrCandles = arrCollected
            .sort((a, b) => Number(a.time) - Number(b.time))
            .slice(0, gMaxCandlesTotal);

        if (arrCandles.length === 0) {
            res.json({
                status: "warning",
                message: `No ${vResolution} candles found for ${vSymbol} between ${formatUnixSecondsAsUtc(vStart)} and ${formatUnixSecondsAsUtc(vEnd)}. Delta keeps underlying futures history from 2019-04-03 and option-contract history from the contract launch.`,
                data: { symbol: vSymbol, resolution: vResolution, start: vStart, end: vEnd, candles: [] }
            });
            return;
        }

        const vOldestCandle = Number(arrCandles[0].time);
        const vNewestCandle = Number(arrCandles[arrCandles.length - 1].time);
        let vMessage = `Loaded ${arrCandles.length.toLocaleString("en-US")} ${vResolution} candles for ${vSymbol} (${formatUnixSecondsAsUtc(vOldestCandle)} to ${formatUnixSecondsAsUtc(vNewestCandle)}).`;
        if (arrCandles.length >= gMaxCandlesTotal) {
            vMessage += ` Result trimmed to the ${gMaxCandlesTotal.toLocaleString("en-US")}-candle request ceiling.`;
        }

        res.json({
            status: "success",
            message: vMessage,
            data: {
                symbol: vSymbol,
                resolution: vResolution,
                start: vStart,
                end: vEnd,
                candles: arrCandles.map((objRow) => ({
                    time: Number(objRow.time),
                    open: Number(objRow.open),
                    high: Number(objRow.high),
                    low: Number(objRow.low),
                    close: Number(objRow.close),
                    volume: Number(objRow.volume) || 0
                }))
            }
        });
    }
    catch (objError) {
        res.json({
            status: "warning",
            message: getErrorMessage(objError, "Unable to load historical candles from Delta Exchange."),
            data: null
        });
    }
}

function compactProduct(pRow: DeltaProductRow, pKind: "option" | "future") {
    const vContractType = String(pRow.contract_type || "").trim();
    return {
        id: Number(pRow.id) || 0,
        symbol: String(pRow.symbol || "").trim(),
        kind: pKind,
        contractType: vContractType === "call_options" ? "call" : (vContractType === "put_options" ? "put" : vContractType),
        strikePrice: pRow.strike_price === undefined || pRow.strike_price === null ? null : Number(pRow.strike_price),
        settlementTime: String(pRow.settlement_time || "").trim(),
        state: String(pRow.state || "").trim(),
        contractValue: pRow.contract_value === undefined || pRow.contract_value === null ? 1 : Number(pRow.contract_value),
        underlying: String(pRow.underlying_asset?.symbol || pRow.contract_unit_currency || "").trim(),
        description: String(pRow.description || "").trim()
    };
}

// GET /api/simulator/chain?underlying=BTC&expiry=2021-01-29
// Delta's /v2/tickers option-chain endpoint only serves current and future
// expiries, so historical chains are rebuilt from the product catalogue:
// expired products are listed by expiry date and each contract's candles are
// then fetched individually through /api/simulator/candles.
export async function getSimulatorChain(req: Request, res: Response): Promise<void> {
    try {
        const vUnderlying = String(req.query.underlying || "").trim().toUpperCase();
        if (!/^[A-Z]{1,10}$/.test(vUnderlying)) {
            res.json({ status: "warning", message: "Choose a valid underlying asset (for example BTC).", data: null });
            return;
        }
        const vExpiry = String(req.query.expiry || "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(vExpiry) || Number.isNaN(Date.parse(`${vExpiry}T00:00:00Z`))) {
            res.json({ status: "warning", message: "Expiry must be a valid date in YYYY-MM-DD format.", data: null });
            return;
        }

        // The exchange only returns expired products when states=expired is
        // passed explicitly, and live/upcoming products otherwise; both are
        // requested and merged so a date near expiry resolves either way.
        const objBaseParams = {
            contract_types: "call_options,put_options",
            underlying_asset_symbols: vUnderlying,
            expiry: vExpiry,
            page_size: "500"
        };
        const [objExpiredBody, objLiveBody] = await Promise.all([
            fetchDeltaJson<DeltaApiEnvelope<DeltaProductRow[]>>("v2/products", { ...objBaseParams, states: "expired" }),
            fetchDeltaJson<DeltaApiEnvelope<DeltaProductRow[]>>("v2/products", { ...objBaseParams, states: "live,upcoming" })
        ]);

        const objById = new Map<number, ReturnType<typeof compactProduct>>();
        for (const objRow of [...(objExpiredBody.result || []), ...(objLiveBody.result || [])]) {
            const objCompact = compactProduct(objRow, "option");
            if (objCompact.symbol && !objById.has(objCompact.id)) {
                objById.set(objCompact.id, objCompact);
            }
        }
        const arrRows = [...objById.values()].sort((a, b) => {
            const vStrikeDiff = (a.strikePrice ?? 0) - (b.strikePrice ?? 0);
            if (vStrikeDiff !== 0) {
                return vStrikeDiff;
            }
            return a.symbol.localeCompare(b.symbol);
        });

        if (arrRows.length === 0) {
            res.json({
                status: "warning",
                message: `No ${vUnderlying} option contracts listed for expiry ${vExpiry}. Delta's earliest option expiries start 2020-09-25 (BTC: 2020-10-02) - try a later date, or a nearby Friday for the early weekly era.`,
                data: { underlying: vUnderlying, expiry: vExpiry, rows: [] }
            });
            return;
        }

        res.json({
            status: "success",
            message: `Loaded ${arrRows.length} ${vUnderlying} option contracts for expiry ${vExpiry}.`,
            data: { underlying: vUnderlying, expiry: vExpiry, rows: arrRows }
        });
    }
    catch (objError) {
        res.json({
            status: "warning",
            message: getErrorMessage(objError, "Unable to load the option chain from Delta Exchange."),
            data: null
        });
    }
}

// GET /api/simulator/futures?underlying=BTC
// Lists futures/perpetual products (live and upcoming) for the underlying so
// the page can offer real Delta symbols such as BTCUSD / ETHUSD.
export async function getSimulatorFutures(req: Request, res: Response): Promise<void> {
    try {
        const vUnderlying = String(req.query.underlying || "").trim().toUpperCase();
        if (!/^[A-Z]{1,10}$/.test(vUnderlying)) {
            res.json({ status: "warning", message: "Choose a valid underlying asset (for example BTC).", data: null });
            return;
        }

        let objBody = await fetchDeltaJson<DeltaApiEnvelope<DeltaProductRow[]>>("v2/products", {
            contract_types: "futures,perpetual_futures",
            underlying_asset_symbols: vUnderlying,
            states: "live,upcoming",
            page_size: "500"
        });
        let arrRows = (objBody.result || []).map((objRow) => compactProduct(objRow, "future")).filter((objRow) => objRow.symbol);

        if (arrRows.length === 0) {
            // Older catalogue entries do not always resolve through the
            // underlying filter, so fall back to a full futures listing and
            // filter on the contract unit currency / symbol prefix.
            objBody = await fetchDeltaJson<DeltaApiEnvelope<DeltaProductRow[]>>("v2/products", {
                contract_types: "futures,perpetual_futures",
                states: "live,upcoming",
                page_size: "500"
            });
            arrRows = (objBody.result || [])
                .map((objRow) => compactProduct(objRow, "future"))
                .filter((objRow) => objRow.symbol && (objRow.underlying === vUnderlying || objRow.symbol.startsWith(vUnderlying)));
        }

        arrRows = arrRows.sort((a, b) => a.symbol.localeCompare(b.symbol));
        if (arrRows.length === 0) {
            res.json({
                status: "warning",
                message: `No futures products found for ${vUnderlying}.`,
                data: { underlying: vUnderlying, rows: [] }
            });
            return;
        }

        res.json({
            status: "success",
            message: `Loaded ${arrRows.length} ${vUnderlying} futures products.`,
            data: { underlying: vUnderlying, rows: arrRows }
        });
    }
    catch (objError) {
        res.json({
            status: "warning",
            message: getErrorMessage(objError, "Unable to load futures products from Delta Exchange."),
            data: null
        });
    }
}

