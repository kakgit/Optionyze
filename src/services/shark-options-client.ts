const gSharkOptionsApiBase = "https://api-options.sharkexchange.in";

export interface SharkOptionsBasePair {
    baseCoin: string;
    quoteCoin: string;
    displayName: string;
}

export interface SharkOptionsInstrumentRow {
    symbol: string;
    displayName: string;
    strikePrice: number;
    baseCoin: string;
    quoteCoin: string;
    settleCoin: string;
    optionsType: string;
    deliveryTime: number;
    lastPrice: number | null;
    markPrice: number | null;
}

export interface SharkOptionChainRow {
    symbol: string;
    strike: number;
    delta: number | null;
    bid: number | null;
    ask: number | null;
    markPrice: number | null;
    lastPrice: number | null;
}

/** @deprecated Use SharkOptionChainRow */
export type SharkPutChainRow = SharkOptionChainRow;

function toNumber(pValue: unknown): number | null {
    const vNumber = Number(pValue);
    return Number.isFinite(vNumber) ? vNumber : null;
}

function isPutOption(pType: unknown): boolean {
    const vType = String(pType || "").trim().toLowerCase();
    return vType === "put" || vType === "p";
}

function isCallOption(pType: unknown): boolean {
    const vType = String(pType || "").trim().toLowerCase();
    return vType === "call" || vType === "c";
}

function matchesOptionSide(pType: unknown, pSide: "put" | "call"): boolean {
    return pSide === "put" ? isPutOption(pType) : isCallOption(pType);
}

function isThousandStrike(pStrike: number): boolean {
    return Number.isFinite(pStrike) && pStrike > 0 && pStrike % 1000 === 0;
}

async function fetchSharkOptionsJson<T>(pPath: string): Promise<T> {
    const vUrl = `${gSharkOptionsApiBase}${pPath}`;
    const objResponse = await fetch(vUrl, {
        headers: {
            Accept: "application/json"
        }
    });
    if (!objResponse.ok) {
        throw new Error(`Shark options request failed (${objResponse.status}) for ${pPath}`);
    }
    return objResponse.json() as Promise<T>;
}

export async function listSharkOptionsBasePairs(): Promise<SharkOptionsBasePair[]> {
    const arrRows = await fetchSharkOptionsJson<Array<Record<string, unknown>>>("/v1/exchange/basePairs");
    return (Array.isArray(arrRows) ? arrRows : [])
        .map((objRow) => ({
            baseCoin: String(objRow.baseCoin || "").trim().toUpperCase(),
            quoteCoin: String(objRow.quoteCoin || "").trim().toUpperCase(),
            displayName: String(objRow.displayName || "").trim()
        }))
        .filter((objRow) => objRow.baseCoin && objRow.quoteCoin)
        .map((objRow) => ({
            ...objRow,
            displayName: objRow.displayName || `${objRow.baseCoin}-${objRow.quoteCoin}`
        }));
}

export async function listSharkOptionsDeliveryTimes(
    pBaseCoin: string,
    pQuoteCoin: string
): Promise<number[]> {
    const vBaseCoin = String(pBaseCoin || "").trim().toUpperCase();
    const vQuoteCoin = String(pQuoteCoin || "").trim().toUpperCase();
    const arrRows = await fetchSharkOptionsJson<number[]>(
        `/v1/exchange/delivery-times?baseCoin=${encodeURIComponent(vBaseCoin)}&quoteCoin=${encodeURIComponent(vQuoteCoin)}`
    );
    return (Array.isArray(arrRows) ? arrRows : [])
        .map((vValue) => Number(vValue))
        .filter((vValue) => Number.isFinite(vValue) && vValue > 0)
        .sort((pLeft, pRight) => pLeft - pRight);
}

export function formatSharkOptionsExpiryCode(pDeliveryTimeMs: number): string {
    const objDate = new Date(Number(pDeliveryTimeMs));
    if (Number.isNaN(objDate.getTime())) {
        return "";
    }
    const arrMonths = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    const vDay = String(objDate.getUTCDate());
    const vMonth = arrMonths[objDate.getUTCMonth()] || "";
    const vYear = String(objDate.getUTCFullYear()).slice(-2);
    return `${vDay}${vMonth}${vYear}`;
}

export function formatSharkOptionsExpiryLabel(pDeliveryTimeMs: number): string {
    const objDate = new Date(Number(pDeliveryTimeMs));
    if (Number.isNaN(objDate.getTime())) {
        return String(pDeliveryTimeMs || "");
    }
    const vDay = String(objDate.getUTCDate()).padStart(2, "0");
    const vMonth = String(objDate.getUTCMonth() + 1).padStart(2, "0");
    const vYear = String(objDate.getUTCFullYear());
    return `${vDay}-${vMonth}-${vYear}`;
}

export function buildSharkOptionsTickerTopic(
    pBaseCoin: string,
    pQuoteCoin: string,
    pDeliveryTimeMs: number
): string {
    const vCode = formatSharkOptionsExpiryCode(pDeliveryTimeMs);
    const vBaseCoin = String(pBaseCoin || "").trim().toUpperCase();
    const vQuoteCoin = String(pQuoteCoin || "").trim().toUpperCase();
    if (!vBaseCoin || !vQuoteCoin || !vCode) {
        return "";
    }
    return `${vBaseCoin}_${vQuoteCoin}_${vCode}@ticker`;
}

export async function listSharkOptionsInstruments(
    pBaseCoin: string,
    pQuoteCoin: string,
    pDeliveryTimeMs: number
): Promise<SharkOptionsInstrumentRow[]> {
    const vBaseCoin = String(pBaseCoin || "").trim().toUpperCase();
    const vQuoteCoin = String(pQuoteCoin || "").trim().toUpperCase();
    const vDeliveryTime = Math.floor(Number(pDeliveryTimeMs));
    const arrRows = await fetchSharkOptionsJson<Array<Record<string, unknown>>>(
        `/v1/exchange/instrument-info?baseCoin=${encodeURIComponent(vBaseCoin)}&quoteCoin=${encodeURIComponent(vQuoteCoin)}&deliveryTime=${encodeURIComponent(String(vDeliveryTime))}`
    );
    return (Array.isArray(arrRows) ? arrRows : [])
        .map((objRow) => ({
            symbol: String(objRow.symbol || "").trim().toUpperCase(),
            displayName: String(objRow.displayName || "").trim(),
            strikePrice: Number(objRow.strikePrice),
            baseCoin: String(objRow.baseCoin || vBaseCoin).trim().toUpperCase(),
            quoteCoin: String(objRow.quoteCoin || vQuoteCoin).trim().toUpperCase(),
            settleCoin: String(objRow.settleCoin || "").trim().toUpperCase(),
            optionsType: String(objRow.optionsType || "").trim(),
            deliveryTime: Number(objRow.deliveryTime || vDeliveryTime),
            lastPrice: toNumber(objRow.lastPrice),
            markPrice: toNumber(objRow.markPrice)
        }))
        .filter((objRow) => objRow.symbol && Number.isFinite(objRow.strikePrice));
}

export async function listSharkOptionChainRoundedToThousand(
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
    tickerTopic: string;
    side: "put" | "call";
    rows: SharkOptionChainRow[];
}> {
    const vBaseCoin = String(pBaseCoin || "").trim().toUpperCase();
    const vQuoteCoin = String(pQuoteCoin || "").trim().toUpperCase();
    const vDeliveryTime = Math.floor(Number(pDeliveryTimeMs));
    const vSide = pSide === "call" ? "call" : "put";
    const arrInstruments = await listSharkOptionsInstruments(vBaseCoin, vQuoteCoin, vDeliveryTime);
    const arrRows = arrInstruments
        .filter((objRow) => matchesOptionSide(objRow.optionsType, vSide) && isThousandStrike(objRow.strikePrice))
        .sort((pLeft, pRight) => pLeft.strikePrice - pRight.strikePrice)
        .map((objRow) => ({
            symbol: objRow.symbol,
            strike: objRow.strikePrice,
            delta: null,
            bid: null,
            ask: null,
            markPrice: objRow.markPrice,
            lastPrice: objRow.lastPrice
        }));

    return {
        baseCoin: vBaseCoin,
        quoteCoin: vQuoteCoin,
        deliveryTime: vDeliveryTime,
        expiryCode: formatSharkOptionsExpiryCode(vDeliveryTime),
        expiryLabel: formatSharkOptionsExpiryLabel(vDeliveryTime),
        tickerTopic: buildSharkOptionsTickerTopic(vBaseCoin, vQuoteCoin, vDeliveryTime),
        side: vSide,
        rows: arrRows
    };
}

export async function listSharkPutChainRoundedToThousand(
    pBaseCoin: string,
    pQuoteCoin: string,
    pDeliveryTimeMs: number
): Promise<{
    baseCoin: string;
    quoteCoin: string;
    deliveryTime: number;
    expiryCode: string;
    expiryLabel: string;
    tickerTopic: string;
    rows: SharkOptionChainRow[];
}> {
    const objChain = await listSharkOptionChainRoundedToThousand(pBaseCoin, pQuoteCoin, pDeliveryTimeMs, "put");
    return {
        baseCoin: objChain.baseCoin,
        quoteCoin: objChain.quoteCoin,
        deliveryTime: objChain.deliveryTime,
        expiryCode: objChain.expiryCode,
        expiryLabel: objChain.expiryLabel,
        tickerTopic: objChain.tickerTopic,
        rows: objChain.rows
    };
}
