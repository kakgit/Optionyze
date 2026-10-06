import type { Request, Response } from "express";
import * as fs from "fs";
import * as path from "path";

const gDeltaApiBase = String(process.env.DELTA_API_BASE_URL || "https://api.delta.exchange").replace(/\/+$/, "");

type SimResolution = "1m" | "3m" | "5m" | "15m" | "30m" | "1h" | "2h" | "4h" | "6h" | "1d" | "1w";

interface DeltaCandle { time: number; open: number; high: number; low: number; close: number; volume: number; }
interface DeltaEnvelope<T> { success?: boolean; result?: T; }
interface DeltaProductsResponse { success?: boolean; result?: DeltaProductRow[]; meta?: { after?: string | null }; }
interface DeltaProductRow {
    id?: number; symbol?: string; contract_type?: string;
    strike_price?: string | number; settlement_time?: string; launch_time?: string;
}

function errMsg(pError: unknown, pFallback: string): string {
    if (pError instanceof Error && String(pError.message || "").trim()) {
        return pError.message;
    }
    return pFallback;
}

function toSecs(pValue: unknown): number | null {
    if (pValue === undefined || pValue === null || pValue === "") {
        return null;
    }
    if (typeof pValue === "number" && Number.isFinite(pValue)) {
        return pValue > 100000000000 ? Math.floor(pValue / 1000) : Math.floor(pValue);
    }
    if (typeof pValue === "string" && /^-?\d+(\.\d+)?$/.test(pValue.trim())) {
        const vNum = Number(pValue.trim());
        return vNum > 100000000000 ? Math.floor(vNum / 1000) : Math.floor(vNum);
    }
    const vParsed = Date.parse(String(pValue));
    if (!Number.isFinite(vParsed)) {
        return null;
    }
    return Math.floor(vParsed / 1000);
}

// Retries transient failures (network errors, HTTP 429/5xx) up to 3 attempts
// with a small backoff — the snapshot fans out many candle requests.
async function fetchDeltaJson<T>(pPath: string, pParams?: Record<string, string>): Promise<T> {
    const objUrl = new URL(`${gDeltaApiBase}/${pPath.replace(/^\/+/, "")}`);
    if (pParams) {
        for (const [k, v] of Object.entries(pParams)) {
            if (v !== undefined && v !== null && String(v) !== "") {
                objUrl.searchParams.set(k, String(v));
            }
        }
    }
    let vLastErr: unknown = null;
    for (let vAttempt = 0; vAttempt < 3; vAttempt += 1) {
        if (vAttempt > 0) {
            await new Promise((objR) => setTimeout(objR, 700 * vAttempt));
        }
        try {
            const objRes = await fetch(objUrl, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30000) });
            if (objRes.ok) {
                return objRes.json() as Promise<T>;
            }
            const strErr = `Delta Exchange request failed with HTTP ${objRes.status} for ${pPath}.`;
            if (objRes.status !== 429 && objRes.status < 500) {
                throw new Error(strErr);
            }
            vLastErr = new Error(strErr);
        }
        catch (objErr) {
            const strMsg = objErr instanceof Error ? objErr.message : "";
            const blnHardHttp = /HTTP \d+/.test(strMsg) && !/HTTP (429|5\d\d)/.test(strMsg);
            if (blnHardHttp) {
                throw objErr;
            }
            vLastErr = objErr;
        }
    }
    throw vLastErr instanceof Error ? vLastErr : new Error(`Delta Exchange request failed for ${pPath}.`);
}

function pickClosest(pStrikes: number[], pSpot: number): number | null {
    let vBest: number | null = null;
    let vDist = Number.POSITIVE_INFINITY;
    for (const s of pStrikes) {
        if (!Number.isFinite(s) || s <= 0) {
            continue;
        }
        const d = Math.abs(s - pSpot);
        if (d < vDist) {
            vDist = d;
            vBest = s;
        }
    }
    return vBest;
}

function normCdf(pX: number): number {
    const t = 1 / (1 + 0.2316419 * Math.abs(pX));
    const d = 0.3989423 * Math.exp(-(pX * pX) / 2);
    let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    if (pX > 0) {
        p = 1 - p;
    }
    return p;
}

function normPdf(pX: number): number {
    return Math.exp(-(pX * pX) / 2) / Math.sqrt(2 * Math.PI);
}

function bsPrice(pSpot: number, pStrike: number, pT: number, pIv: number, pSide: "call" | "put"): number {
    if (pT <= 0 || pIv <= 0) {
        return pSide === "call" ? Math.max(0, pSpot - pStrike) : Math.max(0, pStrike - pSpot);
    }
    const sq = Math.sqrt(pT);
    const d1 = (Math.log(pSpot / pStrike) + 0.5 * pIv * pIv * pT) / (pIv * sq);
    const d2 = d1 - pIv * sq;
    if (pSide === "call") {
        return pSpot * normCdf(d1) - pStrike * normCdf(d2);
    }
    return pStrike * normCdf(-d2) - pSpot * normCdf(-d1);
}

function bsGreeks(pSpot: number, pStrike: number, pT: number, pPrem: number | null, pSide: "call" | "put"): { delta: number | null; gamma: number | null; iv: number | null } {
    if (!Number.isFinite(pSpot) || pSpot <= 0 || !Number.isFinite(pStrike) || pStrike <= 0) {
        return { delta: null, gamma: null, iv: null };
    }
    if (pPrem === null || !Number.isFinite(pPrem) || pPrem < 0 || pT <= 0) {
        if (pSide === "call") {
            return { delta: pSpot === pStrike ? 0.5 : (pSpot > pStrike ? 1 : 0), gamma: 0, iv: null };
        }
        return { delta: pSpot === pStrike ? -0.5 : (pSpot < pStrike ? -1 : 0), gamma: 0, iv: null };
    }
    const vIntr = pSide === "call" ? Math.max(0, pSpot - pStrike) : Math.max(0, pStrike - pSpot);
    const vTarget = Math.max(pPrem, vIntr);
    let lo = 0.0001;
    let hi = 5;
    while (bsPrice(pSpot, pStrike, pT, hi, pSide) < vTarget && hi < 20) {
        hi *= 2;
    }
    let iv = (lo + hi) / 2;
    for (let i = 0; i < 80; i += 1) {
        iv = (lo + hi) / 2;
        const px = bsPrice(pSpot, pStrike, pT, iv, pSide);
        if (Math.abs(px - vTarget) < 1e-6) {
            break;
        }
        if (px < vTarget) {
            lo = iv;
        }
        else {
            hi = iv;
        }
    }
    const sq = Math.sqrt(pT);
    const d1 = (Math.log(pSpot / pStrike) + 0.5 * iv * iv * pT) / (iv * sq);
    return { delta: pSide === "call" ? normCdf(d1) : normCdf(d1) - 1, gamma: normPdf(d1) / (pSpot * iv * sq), iv };
}

async function fetchCloseAtOrBefore(pSymbol: string, pTs: number): Promise<number | null> {
    const tries: Array<{ r: SimResolution; back: number }> = [
        { r: "15m", back: 86400 }, { r: "1h", back: 7 * 86400 }
    ];
    for (const t of tries) {
        try {
            const body = await fetchDeltaJson<DeltaEnvelope<DeltaCandle[]>>("v2/history/candles", {
                symbol: pSymbol, resolution: t.r,
                start: String(Math.max(0, pTs - t.back)), end: String(pTs)
            });
            const rows = Array.isArray(body.result) ? body.result : [];
            let best: number | null = null;
            let bestT = -1;
            for (const c of rows) {
                const tm = Number(c.time);
                const cl = Number(c.close);
                if (!Number.isFinite(tm) || !Number.isFinite(cl) || cl < 0) {
                    continue;
                }
                if (tm <= pTs && tm > bestT) {
                    bestT = tm;
                    best = cl;
                }
            }
            if (best !== null) {
                return best;
            }
        }
        catch {
            continue;
        }
    }
    return null;
}

interface ChainRow { symbol: string; strike: number; side: "call" | "put"; expiry: string; expiryDate: string; launchMs: number | null; }

// ---------------- Historical product catalogue (cursor-paged + cached) ----------------
// Delta's /v2/products ignores `page` but returns `meta.after` — an opaque
// cursor that walks newest → oldest, ~3,000 rows (≈44 expiries) per request.
// Catalogues are built incrementally per underlying and cached in memory, so
// after the first (deep) snapshot every later snapshot costs zero product
// requests. Live/upcoming products are refreshed on a short TTL.

interface SlimProduct {
    symbol: string; strike: number; side: "call" | "put";
    expiry: string; expiryDate: string; launchMs: number | null;
}

interface Catalog {
    rows: SlimProduct[];                 // expired products, newest → oldest
    bySymbol: Map<string, SlimProduct>;
    byDate: Map<string, SlimProduct[]>;
    after: string | null;
    pages: number;
    done: boolean;
    oldest: string | null;
    live: SlimProduct[];
    liveByDate: Map<string, SlimProduct[]>;
    liveAt: number;
    refreshAt: number;
    dirty: boolean;
    inflight: Promise<void> | null;
}

const gCatalogs = new Map<string, Catalog>();
const gMaxCatalogPages = 80;             // 80 × 3,000 rows covers the full history
const gLiveTtlMs = 10 * 60 * 1000;
const gRefreshTtlMs = 6 * 60 * 60 * 1000;

function dayOf(pMs: number): string {
    return new Date(pMs).toISOString().slice(0, 10);
}

function toSlim(pRow: DeltaProductRow): SlimProduct | null {
    const vSymbol = String(pRow.symbol || "").trim().toUpperCase();
    const strCt = String(pRow.contract_type || "");
    const vStrike = Number(pRow.strike_price);
    const vRaw = String(pRow.settlement_time || "");
    const m = vRaw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (!vSymbol || !m || !Number.isFinite(vStrike) || vStrike <= 0) {
        return null;
    }
    if (strCt !== "call_options" && strCt !== "put_options") {
        return null;
    }
    const vLaunch = toSecs(pRow.launch_time);
    return {
        symbol: vSymbol,
        strike: vStrike,
        side: strCt === "call_options" ? "call" : "put",
        expiry: vRaw,
        expiryDate: m[1],
        launchMs: vLaunch !== null && vLaunch > 0 ? vLaunch : null
    };
}

function getCatalog(pUnderlying: string): Catalog {
    let objC = gCatalogs.get(pUnderlying);
    if (!objC) {
        objC = {
            rows: [], bySymbol: new Map(), byDate: new Map(),
            after: null, pages: 0, done: false, oldest: null,
            live: [], liveByDate: new Map(), liveAt: 0, refreshAt: 0,
            dirty: false, inflight: null
        };
        gCatalogs.set(pUnderlying, objC);
        loadCatalogFromDisk(objC, pUnderlying);
    }
    return objC;
}

// The expired-product catalogue is immutable history, so it is persisted to
// data/state/ and reloaded on boot: the very first deep snapshot pages the
// full Delta history once (~3 minutes), every later one — including across
// restarts — is instant. Live/upcoming rows are never persisted; they are
// refetched on a short TTL.
function catalogCachePath(pUnderlying: string): string {
    return path.join(process.cwd(), "data", "state",
        `simulator-catalog-${pUnderlying.replace(/[^A-Za-z0-9_-]/g, "_")}.json`);
}

function loadCatalogFromDisk(pCatalog: Catalog, pUnderlying: string): void {
    try {
        const strRaw = fs.readFileSync(catalogCachePath(pUnderlying), "utf8");
        const objData = JSON.parse(strRaw) as {
            savedAt?: number; rows?: SlimProduct[]; after?: string | null;
            pages?: number; done?: boolean; oldest?: string | null;
        };
        if (!Array.isArray(objData.rows) || objData.rows.length === 0) {
            return;
        }
        const arrRows: SlimProduct[] = [];
        const objBySymbol = new Map<string, SlimProduct>();
        const objByDate = new Map<string, SlimProduct[]>();
        let strOldest: string | null = null;
        for (const p of objData.rows) {
            if (!p || typeof p.symbol !== "string" || !p.symbol || !Number.isFinite(p.strike)) {
                continue;
            }
            arrRows.push(p);
            objBySymbol.set(p.symbol, p);
            const arrD = objByDate.get(p.expiryDate);
            if (arrD) {
                arrD.push(p);
            }
            else {
                objByDate.set(p.expiryDate, [p]);
            }
            if (strOldest === null || p.expiryDate < strOldest) {
                strOldest = p.expiryDate;
            }
        }
        if (arrRows.length === 0) {
            return;
        }
        pCatalog.rows = arrRows;
        pCatalog.bySymbol = objBySymbol;
        pCatalog.byDate = objByDate;
        pCatalog.after = typeof objData.after === "string" && objData.after ? objData.after : null;
        pCatalog.pages = Number.isFinite(objData.pages) ? Number(objData.pages) : 0;
        pCatalog.done = Boolean(objData.done);
        pCatalog.oldest = strOldest;
        pCatalog.refreshAt = Number.isFinite(objData.savedAt) ? Number(objData.savedAt) : 0;
        pCatalog.dirty = false;
    }
    catch {
        // Missing or corrupt cache — start fresh and page from Delta.
    }
}

function saveCatalogToDisk(pCatalog: Catalog, pUnderlying: string): void {
    try {
        const strPath = catalogCachePath(pUnderlying);
        fs.mkdirSync(path.dirname(strPath), { recursive: true });
        fs.writeFileSync(strPath, JSON.stringify({
            savedAt: Date.now(),
            rows: pCatalog.rows,
            after: pCatalog.after,
            pages: pCatalog.pages,
            done: pCatalog.done,
            oldest: pCatalog.oldest
        }));
        pCatalog.dirty = false;
    }
    catch {
        // Non-fatal: a failed cache write only means the next run re-pages.
    }
}

function mergeRows(pCatalog: Catalog, pRows: SlimProduct[]): void {
    for (const p of pRows) {
        if (pCatalog.bySymbol.has(p.symbol)) {
            // Expired products are immutable — keep the first-seen object,
            // which also avoids an O(rows) index scan on every refresh.
            continue;
        }
        pCatalog.rows.push(p);
        pCatalog.bySymbol.set(p.symbol, p);
        const arrByDate = pCatalog.byDate.get(p.expiryDate);
        if (arrByDate) {
            arrByDate.push(p);
        }
        else {
            pCatalog.byDate.set(p.expiryDate, [p]);
        }
        if (pCatalog.oldest === null || p.expiryDate < pCatalog.oldest) {
            pCatalog.oldest = p.expiryDate;
        }
    }
}
async function pageExpired(pCatalog: Catalog, pUnderlying: string, pReset: boolean): Promise<void> {
    const objParams: Record<string, string> = {
        contract_types: "call_options,put_options",
        underlying_asset_symbols: pUnderlying,
        states: "expired",
        page_size: "3000"
    };
    if (!pReset && pCatalog.after) {
        objParams.after = pCatalog.after;
    }
    const objBody = await fetchDeltaJson<DeltaProductsResponse>("v2/products", objParams);
    const arrRows = Array.isArray(objBody.result) ? objBody.result : [];
    const arrSlim: SlimProduct[] = [];
    for (const r of arrRows) {
        const objS = toSlim(r);
        if (objS) {
            arrSlim.push(objS);
        }
    }
    mergeRows(pCatalog, arrSlim);
    pCatalog.dirty = true;
    const strAfter = objBody.meta && typeof objBody.meta.after === "string" ? objBody.meta.after : "";
    if (!pReset) {
        pCatalog.pages += 1;
    }
    if (!strAfter || arrRows.length === 0) {
        pCatalog.done = true;
        pCatalog.after = null;
    }
    else {
        pCatalog.after = strAfter;
        pCatalog.done = false;
    }
    pCatalog.refreshAt = Date.now();
}

async function loadLive(pCatalog: Catalog, pUnderlying: string): Promise<void> {
    if (pCatalog.live.length > 0 && Date.now() - pCatalog.liveAt < gLiveTtlMs) {
        return;
    }
    const objBody = await fetchDeltaJson<DeltaProductsResponse>("v2/products", {
        contract_types: "call_options,put_options",
        underlying_asset_symbols: pUnderlying,
        states: "live,upcoming",
        page_size: "500"
    });
    const arrRows = Array.isArray(objBody.result) ? objBody.result : [];
    const arrSlim: SlimProduct[] = [];
    for (const r of arrRows) {
        const objS = toSlim(r);
        if (objS) {
            arrSlim.push(objS);
        }
    }
    pCatalog.live = arrSlim;
    pCatalog.liveByDate = new Map();
    for (const p of arrSlim) {
        const arr = pCatalog.liveByDate.get(p.expiryDate);
        if (arr) {
            arr.push(p);
        }
        else {
            pCatalog.liveByDate.set(p.expiryDate, [p]);
        }
    }
    pCatalog.liveAt = Date.now();
}

// Page the expired catalogue newest → oldest until it reaches back to
// pFloorDate (so every expiry ≥ floor is resolvable) or it is exhausted.
async function ensureCoverage(pUnderlying: string, pFloorDate: string): Promise<void> {
    const objC = getCatalog(pUnderlying);
    await loadLive(objC, pUnderlying);
    if (Date.now() - objC.refreshAt >= gRefreshTtlMs) {
        await pageExpired(objC, pUnderlying, true);
    }
    let vGuard = 0;
    while (!objC.done
        && (objC.oldest === null || objC.oldest > pFloorDate)
        && objC.pages < gMaxCatalogPages
        && vGuard < 200) {
        vGuard += 1;
        if (objC.inflight) {
            await objC.inflight;
            continue;
        }
        const objP = pageExpired(objC, pUnderlying, false);
        objC.inflight = objP;
        try {
            await objP;
        }
        finally {
            objC.inflight = null;
        }
    }
    if (objC.dirty) {
        saveCatalogToDisk(objC, pUnderlying);
    }
}
function findProduct(pCatalog: Catalog, pSymbol: string): SlimProduct | null {
    const objExpired = pCatalog.bySymbol.get(pSymbol);
    if (objExpired) {
        return objExpired;
    }
    return pCatalog.live.find((x) => x.symbol === pSymbol) || null;
}

function slimToChainRow(p: SlimProduct): ChainRow {
    return {
        symbol: p.symbol, strike: p.strike, side: p.side,
        expiry: p.expiry, expiryDate: p.expiryDate, launchMs: p.launchMs
    };
}

async function fetchChainRows(pUnderlying: string, pExpiry: string): Promise<ChainRow[]> {
    await ensureCoverage(pUnderlying, pExpiry);
    const objC = getCatalog(pUnderlying);
    const out: ChainRow[] = [];
    const seen = new Set<string>();
    for (const p of [...(objC.byDate.get(pExpiry) || []), ...(objC.liveByDate.get(pExpiry) || [])]) {
        if (seen.has(p.symbol)) {
            continue;
        }
        seen.add(p.symbol);
        out.push(slimToChainRow(p));
    }
    return out;
}

// Held positions can drift outside the ATM strike window; resolve their
// contracts directly so their marks stay fresh on every snapshot.
async function fetchHeldRows(pUnderlying: string, pHeld: Array<{ symbol: string; expiryDate: string }>): Promise<ChainRow[]> {
    const out: ChainRow[] = [];
    for (const h of pHeld) {
        await ensureCoverage(pUnderlying, h.expiryDate);
        const objP = findProduct(getCatalog(pUnderlying), h.symbol);
        if (objP) {
            out.push(slimToChainRow(objP));
        }
    }
    return out;
}

// Bounded-concurrency map (the premium fan-out stays under rate limits).
async function poolMap<T, R>(pItems: T[], pSize: number, pFn: (pItem: T) => Promise<R | null>): Promise<R[]> {
    const out: R[] = [];
    let vIdx = 0;
    const worker = async (): Promise<void> => {
        while (vIdx < pItems.length) {
            const vCur = vIdx;
            vIdx += 1;
            const vR = await pFn(pItems[vCur]);
            if (vR !== null && vR !== undefined) {
                out.push(vR);
            }
        }
    };
    const vWorkers = Math.max(1, Math.min(pSize, pItems.length));
    await Promise.all(Array.from({ length: vWorkers }, () => worker()));
    return out;
}
// Expiry discovery for the Lab: daily = first expiry ≥ T+2, monthly = first
// expiry ≥ T+15 (matches the strategy's entry floors). Pages the catalogue
// back far enough to resolve both floors, then reads dates from the cache.
async function discoverExpiries(pUnderlying: string, pTs: number): Promise<{ monthly: string; daily: string }> {
    const vDailyFloor = dayOf((pTs + 2 * 86400) * 1000);
    const vMonthlyFloor = dayOf((pTs + 15 * 86400) * 1000);
    await ensureCoverage(pUnderlying, vDailyFloor);
    const objC = getCatalog(pUnderlying);
    const set = new Set<string>([...objC.byDate.keys(), ...objC.liveByDate.keys()]);
    const sorted = [...set].sort();
    // Only contracts already listed at pTs are tradable in the Lab (Delta
    // lists dailies E-3d, weeklies ~20d, monthlies ~40-60d ahead), so prefer
    // the first date ≥ floor whose products have launched by pTs; fall back
    // to the plain floor date when nothing qualifies yet.
    const strPick = (pFloor: string): string => {
        let strFallback = "";
        for (const d of sorted) {
            if (d < pFloor) {
                continue;
            }
            const arrRows = [...(objC.byDate.get(d) || []), ...(objC.liveByDate.get(d) || [])];
            if (arrRows.length === 0) {
                continue;
            }
            if (!strFallback) {
                strFallback = d;
            }
            for (const r of arrRows) {
                if (r.launchMs === null || r.launchMs <= pTs) {
                    return d;
                }
            }
        }
        return strFallback;
    };
    const daily = strPick(vDailyFloor);
    const monthly = strPick(vMonthlyFloor);
    return { monthly, daily };
}

// Time-travel snapshot for the Manual Bi-Directional Lab. Delta Exchange has
// no historical greeks / OI endpoint for expired contracts, so premiums come
// from each contract's own historical candles and delta/gamma are derived via
// Black-Scholes IV inversion. OI is returned as null and labelled unavailable.
export async function getSimulatorManualSnapshot(req: Request, res: Response): Promise<void> {
    try {
        const vUnder = String(req.query.underlying || "").trim().toUpperCase();
        if (!/^[A-Z]{1,10}$/.test(vUnder)) {
            res.json({ status: "warning", message: "Choose a valid underlying (e.g. BTC).", data: null });
            return;
        }
        const vTs = toSecs(req.query.timestamp);
        if (vTs === null || vTs <= 0) {
            res.json({ status: "warning", message: "Pass a valid timestamp (unix seconds or ISO date).", data: null });
            return;
        }
        let vWin = Math.floor(Number(req.query.window));
        if (!Number.isFinite(vWin)) {
            vWin = 10;
        }
        vWin = Math.max(5, Math.min(20, vWin));

        // Optional held contracts: "SYMBOL:YYYY-MM-DD|SYMBOL:YYYY-MM-DD" so
        // open positions keep fresh marks even outside the ATM strike window.
        const arrHeld: Array<{ symbol: string; expiryDate: string }> = [];
        const strHeld = String(req.query.held || "").trim();
        if (strHeld && strHeld.length <= 600) {
            for (const strPart of strHeld.split("|")) {
                const arrBits = strPart.split(":");
                const strSym = String(arrBits[0] || "").trim().toUpperCase();
                const strDate = String(arrBits[1] || "").trim();
                if (/^[A-Z0-9._-]{1,40}$/.test(strSym) && /^\d{4}-\d{2}-\d{2}$/.test(strDate)) {
                    arrHeld.push({ symbol: strSym, expiryDate: strDate });
                }
            }
        }

        // Warm the product catalogue while the spot candle loads — first ever
        // snapshot for a deep timestamp pages the catalogue once, then it is
        // cached in memory for all later steps.
        void ensureCoverage(vUnder, dayOf((vTs + 2 * 86400) * 1000)).catch(() => undefined);
        const vSpotSym = `${vUnder}USD`;
        const vSpot = await fetchCloseAtOrBefore(vSpotSym, vTs);
        if (vSpot === null) {
            res.json({
                status: "warning",
                message: `No ${vSpotSym} history at or before ${new Date(vTs * 1000).toISOString()}. Futures history starts 2019-04-03 06:00 UTC.`,
                data: null
            });
            return;
        }

        let vMonthly = String(req.query.monthlyExpiry || "").trim();
        let vDaily = String(req.query.dailyExpiry || "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(vMonthly) || !/^\d{4}-\d{2}-\d{2}$/.test(vDaily)) {
            const auto = await discoverExpiries(vUnder, vTs);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(vMonthly)) {
                vMonthly = auto.monthly;
            }
            if (!/^\d{4}-\d{2}-\d{2}$/.test(vDaily)) {
                vDaily = auto.daily;
            }
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(vMonthly) || !/^\d{4}-\d{2}-\d{2}$/.test(vDaily)) {
            res.json({
                status: "warning",
                message: "No option expiries found near that timestamp. First BTC option expiry is 2020-10-02.",
                data: null
            });
            return;
        }

        const mRows = await fetchChainRows(vUnder, vMonthly);
        const dRows = vDaily === vMonthly ? mRows : await fetchChainRows(vUnder, vDaily);
        if (mRows.length === 0 && dRows.length === 0) {
            res.json({
                status: "warning",
                message: `No ${vUnder} contracts listed for ${vMonthly} / ${vDaily}.`,
                data: null
            });
            return;
        }

        const set = new Set<number>();
        for (const r of [...mRows, ...dRows]) {
            if (Number.isFinite(r.strike) && r.strike > 0) {
                set.add(r.strike);
            }
        }
        const sorted = [...set].sort((a, b) => a - b);
        const vAtm = pickClosest(sorted, vSpot);
        if (vAtm === null) {
            res.json({ status: "warning", message: "No strikes listed for those expiries.", data: null });
            return;
        }
        const vAtmIdx = sorted.indexOf(vAtm);
        const winStrikes = sorted.slice(Math.max(0, vAtmIdx - vWin), vAtmIdx + vWin + 1);
        const legs: Array<{ row: ChainRow; side: "call" | "put" }> = [];
        const seenSymbols = new Set<string>();
        const pushLeg = (row: ChainRow | undefined, side: "call" | "put"): void => {
            if (row && !seenSymbols.has(row.symbol)) {
                seenSymbols.add(row.symbol);
                legs.push({ row, side });
            }
        };
        for (const st of winStrikes) {
            // Push monthly AND daily contracts separately (deduped by symbol):
            // the Lab state machine trades both expiries, while the display
            // grid prefers the monthly leg when a strike exists in each.
            const objMc = mRows.find((r) => r.strike === st && r.side === "call");
            const objMp = mRows.find((r) => r.strike === st && r.side === "put");
            const objDc = dRows.find((r) => r.strike === st && r.side === "call");
            const objDp = dRows.find((r) => r.strike === st && r.side === "put");
            pushLeg(objMc, "call");
            pushLeg(objMp, "put");
            pushLeg(objDc, "call");
            if (!objMp) {
                pushLeg(objDp, "put");
            }
        }
        const arrHeldRows = arrHeld.length > 0 ? await fetchHeldRows(vUnder, arrHeld) : [];
        for (const objRow of arrHeldRows) {
            pushLeg(objRow, objRow.side);
        }

        interface EnrichedLeg {
            strike: number; side: "call" | "put"; symbol: string;
            expiry: string; expiryDate: string; premium: number;
            delta: number | null; gamma: number | null; iv: number | null; oi: null;
        }
        interface FetchedLeg { leg: { row: ChainRow; side: "call" | "put" }; prem: number | null; }
        const fetched = await poolMap(legs, 6, async (leg): Promise<FetchedLeg | null> => {
            if (leg.row.launchMs !== null && leg.row.launchMs > vTs) {
                return null; // contract not listed yet at that timestamp
            }
            const prem = await fetchCloseAtOrBefore(leg.row.symbol, vTs);
            return { leg, prem: prem !== null && Number.isFinite(prem) && prem >= 0 ? prem : null };
        });
        // Put-call parity fill: illiquid contracts often have candle gaps on
        // one side only — with BTC's carry ≈ 0, P = C + K − S and C = P + S − K.
        const objCallPrem = new Map<string, number>();
        const objPutPrem = new Map<string, number>();
        for (const f of fetched) {
            if (f.prem === null) {
                continue;
            }
            const strKey = `${f.leg.row.expiryDate}|${f.leg.row.strike}`;
            if (f.leg.side === "call") {
                if (!objCallPrem.has(strKey)) {
                    objCallPrem.set(strKey, f.prem);
                }
            }
            else if (!objPutPrem.has(strKey)) {
                objPutPrem.set(strKey, f.prem);
            }
        }
        const enriched: EnrichedLeg[] = [];
        for (const f of fetched) {
            let vPrem = f.prem;
            const strKey = `${f.leg.row.expiryDate}|${f.leg.row.strike}`;
            if (vPrem === null) {
                if (f.leg.side === "put") {
                    const vC = objCallPrem.get(strKey);
                    if (vC !== undefined) {
                        vPrem = vC + f.leg.row.strike - vSpot;
                    }
                }
                else {
                    const vP = objPutPrem.get(strKey);
                    if (vP !== undefined) {
                        vPrem = vP + vSpot - f.leg.row.strike;
                    }
                }
            }
            if (vPrem === null || !Number.isFinite(vPrem) || vPrem < 0) {
                continue; // neither side traded/marked at or before that timestamp
            }
            const expMs = Date.parse(f.leg.row.expiry);
            const yrs = Number.isFinite(expMs) ? Math.max(0, (expMs - vTs * 1000) / 31557600000) : 0;
            const g = bsGreeks(vSpot, f.leg.row.strike, yrs, vPrem, f.leg.side);
            enriched.push({
                strike: f.leg.row.strike, side: f.leg.side, symbol: f.leg.row.symbol,
                expiry: f.leg.row.expiry, expiryDate: f.leg.row.expiryDate, premium: vPrem,
                delta: g.delta, gamma: g.gamma, iv: g.iv, oi: null
            });
        }

        // Only strikes with at least one priced contract become grid rows, and
        // ATM is recomputed against those (unpriced/unlisted strikes drop out).
        const pricedStrikes = winStrikes.filter((st) => enriched.some((e) => e.strike === st));
        if (pricedStrikes.length === 0) {
            res.json({
                status: "warning",
                message: `No priced ${vUnder} option contracts at that timestamp (first BTC option expiry is 2020-10-02).`,
                data: null
            });
            return;
        }
        const vAtmFinal = pickClosest(pricedStrikes, vSpot);
        // Display grid: prefer the monthly leg when a strike exists in both
        // expiries; the flat `legs` list below still carries every contract.
        const pickCell = (st: number, side: "call" | "put") =>
            enriched.find((e) => e.strike === st && e.side === side && e.expiryDate === vMonthly)
            || enriched.find((e) => e.strike === st && e.side === side)
            || null;
        const grid = pricedStrikes.map((st) => ({
            strike: st,
            isAtm: st === vAtmFinal,
            call: pickCell(st, "call"),
            put: pickCell(st, "put")
        }));

        const mMs = Date.parse(`${vMonthly}T12:00:00Z`);
        const dMs = Date.parse(`${vDaily}T12:00:00Z`);

        res.json({
            status: "success",
            message: `Snapshot ${new Date(vTs * 1000).toISOString()}: ${vUnder} ${vSpot}, ATM ${vAtmFinal}.`,
            data: {
                underlying: vUnder, timestamp: vTs,
                isoTime: new Date(vTs * 1000).toISOString(),
                spot: vSpot, spotSymbol: vSpotSym,
                monthlyExpiry: vMonthly, dailyExpiry: vDaily,
                monthlyExpiryFull: Number.isFinite(mMs) ? new Date(mMs).toISOString() : null,
                dailyExpiryFull: Number.isFinite(dMs) ? new Date(dMs).toISOString() : null,
                atmStrike: vAtmFinal, window: vWin, strikes: grid, legs: enriched,
                greeksNote: "delta/gamma via Black-Scholes IV inversion from historical premiums; OI unavailable historically (null)."
            }
        });
    }
    catch (objError) {
        res.json({
            status: "warning",
            message: errMsg(objError, "Unable to build the manual-lab snapshot."),
            data: null
        });
    }
}
