const gBybitApiBase = "https://api.bybit.com/v5/market";
const gBybitWsUrl = "wss://stream.bybit.com/v5/public/option";

export interface BybitOptionsBasePair {
    baseCoin: string;
    quoteCoin: string;
    displayName: string;
}

export interface BybitOptionChainRow {
    symbol: string;
    strike: number;
    delta: number | null;
    bid: number | null;
    ask: number | null;
    markPrice: number | null;
    lastPrice: number | null;
}

interface BybitInstrumentRow {
    symbol?: string;
    baseCoin?: string;
    quoteCoin?: string;
    settleCoin?: string;
    optionsType?: string;
    status?: string;
    deliveryTime?: string | number;
}

interface BybitTickerRow {
    symbol?: string;
    bid1Price?: string | number;
    ask1Price?: string | number;
    lastPrice?: string | number;
    markPrice?: string | number;
    delta?: string | number;
}

interface BybitParsedSymbol {
    baseCoin: string;
    expiryCode: string;
    expiryLabel: string;
    strike: number;
    side: "put" | "call";
    settleCoin: string;
}

interface BybitTickerEntry {
    ticker: BybitTickerRow;
    parsed: BybitParsedSymbol;
}

interface BybitPage<T> {
    list?: T[];
    nextPageCursor?: string;
}

interface BybitResponse<T> {
    retCode?: number;
    retMsg?: string;
    result?: BybitPage<T>;
}

function toNumber(pValue: unknown): number | null {
    if (pValue === null || pValue === undefined || pValue === "") {
        return null;
    }
    const vNumber = Number(pValue);
    return Number.isFinite(vNumber) ? vNumber : null;
}

function isThousandStrike(pStrike: number): boolean {
    return Number.isFinite(pStrike) && pStrike > 0 && pStrike % 1000 === 0;
}

async function fetchBybitJson<T>(pPath: string, pSearchParams?: URLSearchParams): Promise<T> {
    const vUrl = `${gBybitApiBase}${pPath}${pSearchParams ? `?${pSearchParams.toString()}` : ""}`;
    const objResponse = await fetch(vUrl, {
        headers: {
            Accept: "application/json"
        }
    });
    if (!objResponse.ok) {
        throw new Error(`Bybit options request failed (${objResponse.status}) for ${pPath}`);
    }
    const objPayload = await objResponse.json() as BybitResponse<unknown>;
    if (objPayload && typeof objPayload === "object" && Number(objPayload.retCode) !== 0) {
        throw new Error(`Bybit options request rejected (${objPayload.retCode}): ${String(objPayload.retMsg || "unknown error")}`);
    }
    return objPayload as T;
}

async function fetchBybitPagedRows<T>(
    pPath: string,
    pBuildParams: (pCursor: string) => URLSearchParams,
    pPickList: (pResult: BybitPage<T>) => T[] | undefined,
    pMaxPages = 20
): Promise<T[]> {
    let vCursor = "";
    const arrRows: T[] = [];
    const seenCursors = new Set<string>([""]);
    for (let i = 0; i < Math.max(1, pMaxPages); i++) {
        const objParams = pBuildParams(vCursor);
        const objPayload = await fetchBybitJson<BybitResponse<T>>(pPath, objParams);
        const arrList = Array.isArray(pPickList(objPayload.result || {})) ? pPickList(objPayload.result || {}) : [];
        arrRows.push(...(arrList as T[]));
        // Bybit returns the next-page cursor already URL-encoded (e.g. "0%2C500");
        // decode it once because URLSearchParams encodes again.
        let vNextCursor = String(objPayload.result?.nextPageCursor || "").trim();
        if (vNextCursor.includes("%")) {
            try {
                vNextCursor = decodeURIComponent(vNextCursor);
            }
            catch (_error) {
            }
        }
        if (!vNextCursor || seenCursors.has(vNextCursor)) {
            break;
        }
        seenCursors.add(vNextCursor);
        vCursor = vNextCursor;
    }
    return arrRows;
}

/**
 * Parses a Bybit option symbol like "BTC-25JUN27-93000-C-USDT".
 * Returns null when the symbol does not follow the expected layout.
 */
export function parseBybitOptionSymbol(pSymbol: string): BybitParsedSymbol | null {
    const vMatch = /^([A-Z0-9]{2,12})-(\d{2}[A-Z]{3}\d{2})-(\d+(?:\.\d+)?)-([CP])-([A-Z0-9]{3,8})$/.exec(
        String(pSymbol || "").trim().toUpperCase()
    );
    if (!vMatch) {
        return null;
    }
    const arrMonths = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    const vExpiryCode = vMatch[2];
    const vDay = Number(vExpiryCode.slice(0, 2));
    const vMonthIndex = arrMonths.indexOf(vExpiryCode.slice(2, 5));
    const vYear = 2000 + Number(vExpiryCode.slice(5));
    const vSideLetter = vMatch[4];
    if (!(vDay >= 1 && vDay <= 31) || vMonthIndex < 0 || !vYear || !(vSideLetter === "C" || vSideLetter === "P")) {
        return null;
    }
    return {
        baseCoin: vMatch[1],
        expiryCode: vExpiryCode,
        expiryLabel: `${String(vDay).padStart(2, "0")}-${String(vMonthIndex + 1).padStart(2, "0")}-${vYear}`,
        strike: Number(vMatch[3]),
        side: vSideLetter === "C" ? "call" : "put",
        settleCoin: vMatch[5]
    };
}

/** Formats a delivery timestamp as a Bybit expiry code, e.g. "25JUN27". */
export function formatBybitOptionsExpiryCode(pDeliveryTimeMs: number): string {
    const objDate = new Date(Number(pDeliveryTimeMs));
    if (Number.isNaN(objDate.getTime())) {
        return "";
    }
    const arrMonths = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    const vDay = String(objDate.getUTCDate()).padStart(2, "0");
    const vMonth = arrMonths[objDate.getUTCMonth()] || "";
    const vYear = String(objDate.getUTCFullYear()).slice(-2);
    return `${vDay}${vMonth}${vYear}`;
}

/** Formats a delivery timestamp as "dd-MM-yyyy" (UTC), matching the Delta expiry_date format. */
export function formatBybitOptionsExpiryLabel(pDeliveryTimeMs: number): string {
    const objDate = new Date(Number(pDeliveryTimeMs));
    if (Number.isNaN(objDate.getTime())) {
        return String(pDeliveryTimeMs || "");
    }
    const vDay = String(objDate.getUTCDate()).padStart(2, "0");
    const vMonth = String(objDate.getUTCMonth() + 1).padStart(2, "0");
    const vYear = String(objDate.getUTCFullYear());
    return `${vDay}-${vMonth}-${vYear}`;
}

async function listBybitTradingInstruments(): Promise<BybitInstrumentRow[]> {
    const arrRows = await fetchBybitPagedRows<BybitInstrumentRow>(
        "/instruments-info",
        (pCursor) => {
            const objParams = new URLSearchParams({ category: "option" });
            if (pCursor) {
                objParams.set("cursor", pCursor);
            }
            return objParams;
        },
        (pResult) => pResult.list
    );
    return arrRows.filter((objRow) => String(objRow.status || "").trim().toLowerCase() === "trading");
}

export async function listBybitOptionsBasePairs(): Promise<BybitOptionsBasePair[]> {
    const arrInstruments = await listBybitTradingInstruments();
    const mapPairs = new Map<string, BybitOptionsBasePair>();
    arrInstruments.forEach((objRow) => {
        const vBaseCoin = String(objRow.baseCoin || "").trim().toUpperCase();
        const vQuoteCoin = String(objRow.quoteCoin || String(objRow.settleCoin || "")).trim().toUpperCase();
        if (!vBaseCoin || !vQuoteCoin || mapPairs.has(`${vBaseCoin}:${vQuoteCoin}`)) {
            return;
        }
        mapPairs.set(`${vBaseCoin}:${vQuoteCoin}`, {
            baseCoin: vBaseCoin,
            quoteCoin: vQuoteCoin,
            displayName: `${vBaseCoin}-${vQuoteCoin}`
        });
    });
    return Array.from(mapPairs.values());
}


export async function listBybitOptionsDeliveryTimes(
    pBaseCoin: string,
    pQuoteCoin: string
): Promise<number[]> {
    const vBaseCoin = String(pBaseCoin || "").trim().toUpperCase();
    const vQuoteCoin = String(pQuoteCoin || "").trim().toUpperCase();
    if (!vBaseCoin || !vQuoteCoin) {
        return [];
    }
    const arrInstruments = await listBybitTradingInstruments();
    const setDeliveryTimes = new Set<number>();
    arrInstruments.forEach((objRow) => {
        if (String(objRow.baseCoin || "").trim().toUpperCase() !== vBaseCoin) {
            return;
        }
        const vRowQuote = String(objRow.quoteCoin || objRow.settleCoin || "").trim().toUpperCase();
        if (vRowQuote && vRowQuote !== vQuoteCoin) {
            return;
        }
        const vDeliveryTime = Number(objRow.deliveryTime);
        if (Number.isFinite(vDeliveryTime) && vDeliveryTime > 0) {
            setDeliveryTimes.add(Math.floor(vDeliveryTime));
        }
    });
    return Array.from(setDeliveryTimes).sort((pLeft, pRight) => pLeft - pRight);
}

async function listBybitTickers(pBaseCoin: string): Promise<BybitTickerRow[]> {
    const vBaseCoin = String(pBaseCoin || "").trim().toUpperCase();
    if (!vBaseCoin) {
        return [];
    }
    return fetchBybitPagedRows<BybitTickerRow>(
        "/tickers",
        (pCursor) => {
            const objParams = new URLSearchParams({ category: "option" });
            if (pCursor) {
                objParams.set("cursor", pCursor);
            }
            else {
                objParams.set("baseCoin", vBaseCoin);
            }
            return objParams;
        },
        (pResult) => pResult.list
    );
}

export async function listBybitOptionChainRoundedToThousand(
    pBaseCoin: string,
    pQuoteCoin: string,
    pDeliveryTimeMs: number,
    pSide: "put" | "call"
): Promise<{
    baseCoin: string;
    quoteCoin: string;
    deliveryTime: number;
    expiryCode: string;
    expiryLabel: string;
    side: "put" | "call";
    rows: BybitOptionChainRow[];
}> {
    const vBaseCoin = String(pBaseCoin || "").trim().toUpperCase();
    const vQuoteCoin = String(pQuoteCoin || "").trim().toUpperCase();
    const vDeliveryTime = Math.floor(Number(pDeliveryTimeMs));
    const vSide = pSide === "call" ? "call" : "put";
    const vTargetLabel = formatBybitOptionsExpiryLabel(vDeliveryTime);
    const arrTickers = await listBybitTickers(vBaseCoin);
    const arrRows = arrTickers
        .map((objTicker) => {
            const objParsed = parseBybitOptionSymbol(String(objTicker.symbol || ""));
            if (!objParsed) {
                return null;
            }
            return { ticker: objTicker, parsed: objParsed };
        })
        .filter((objEntry): objEntry is BybitTickerEntry =>
            objEntry !== null
            && objEntry.parsed.baseCoin === vBaseCoin
            && (!vQuoteCoin || objEntry.parsed.settleCoin === vQuoteCoin)
            && objEntry.parsed.expiryLabel === vTargetLabel
            && objEntry.parsed.side === vSide
            && isThousandStrike(objEntry.parsed.strike)
        )
        .map((objEntry) => ({
            symbol: String(objEntry.ticker.symbol || ""),
            strike: objEntry.parsed.strike,
            delta: toNumber(objEntry.ticker.delta),
            bid: toNumber(objEntry.ticker.bid1Price),
            ask: toNumber(objEntry.ticker.ask1Price),
            markPrice: toNumber(objEntry.ticker.markPrice),
            lastPrice: toNumber(objEntry.ticker.lastPrice)
        }))
        .sort((pLeft, pRight) => pLeft.strike - pRight.strike);

    return {
        baseCoin: vBaseCoin,
        quoteCoin: vQuoteCoin,
        deliveryTime: vDeliveryTime,
        expiryCode: formatBybitOptionsExpiryCode(vDeliveryTime),
        expiryLabel: vTargetLabel,
        side: vSide,
        rows: arrRows
    };
}

