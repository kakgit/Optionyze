const gCoinSwitchOptionsApiBase = "https://coinswitch.co/pro/api/v1/options";

export interface CoinSwitchOptionsBasePair {
    baseCoin: string;
    quoteCoin: string;
    displayName: string;
}

export interface CoinSwitchOptionChainRow {
    symbol: string;
    strike: number;
    delta: number | null;
    bid: number | null;
    ask: number | null;
    markPrice: number | null;
}

interface CoinSwitchAssetRow {
    id?: string;
    symbol?: string;
    exchange?: string;
    status?: string;
    base_asset?: string;
    quote_asset?: string;
    expiry_date?: string | number;
    strike_price?: string | number;
    contract_type?: string;
    delivery_time?: string | number;
    lot_size?: string | number;
}

interface CoinSwitchTickerRow {
    symbol?: string;
    bid1Price?: string | number;
    ask1Price?: string | number;
    markPrice?: string | number;
    delta?: string | number;
    gamma?: string | number;
    vega?: string | number;
    theta?: string | number;
    lastPrice?: string | number;
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

function isFiveHundredStrike(pStrike: number): boolean {
    return Number.isFinite(pStrike) && pStrike > 0 && pStrike % 1000 === 500;
}

function matchesOptionSide(pContractType: unknown, pSide: "put" | "call"): boolean {
    const vType = String(pContractType || "").trim().toUpperCase();
    if (pSide === "call") {
        return vType === "C" || vType === "CALL";
    }
    return vType === "P" || vType === "PUT";
}

async function fetchCoinSwitchJson<T>(pPath: string): Promise<T> {
    const vUrl = `${gCoinSwitchOptionsApiBase}${pPath}`;
    const objResponse = await fetch(vUrl, {
        headers: {
            Accept: "application/json"
        }
    });
    if (!objResponse.ok) {
        throw new Error(`CoinSwitch options request failed (${objResponse.status}) for ${pPath}`);
    }
    return objResponse.json() as Promise<T>;
}

export function formatCoinSwitchExpiryLabel(pDeliveryTimeMs: number): string {
    const objDate = new Date(Number(pDeliveryTimeMs));
    if (Number.isNaN(objDate.getTime())) {
        return String(pDeliveryTimeMs || "");
    }
    const vDay = String(objDate.getUTCDate()).padStart(2, "0");
    const vMonth = String(objDate.getUTCMonth() + 1).padStart(2, "0");
    const vYear = String(objDate.getUTCFullYear());
    return `${vDay}-${vMonth}-${vYear}`;
}

export function buildDeltaOptionsChainSymbolFromDelivery(
    pUnderlying: string,
    pDeliveryTimeMs: number
): string {
    return buildCoinSwitchAlignedDeltaChainSymbol(pUnderlying, formatCoinSwitchExpiryLabel(pDeliveryTimeMs));
}

export function buildCoinSwitchAlignedDeltaChainSymbol(
    pUnderlying: string,
    pExpiryLabelDdMmYyyy: string
): string {
    const vUnderlying = String(pUnderlying || "").trim().toUpperCase();
    const arrParts = String(pExpiryLabelDdMmYyyy || "").trim().split("-");
    if (!vUnderlying || arrParts.length !== 3) {
        return "";
    }
    const vDay = String(arrParts[0] || "").padStart(2, "0");
    const vMonth = String(arrParts[1] || "").padStart(2, "0");
    const vYear = String(arrParts[2] || "").slice(-2);
    if (!vDay || !vMonth || !vYear) {
        return "";
    }
    return `${vUnderlying}-${vDay}${vMonth}${vYear}`;
}

let gAssetsCache: { expiresAtMs: number; rows: CoinSwitchAssetRow[] } | null = null;
let gTickersCache: { expiresAtMs: number; bySymbol: Map<string, CoinSwitchTickerRow> } | null = null;

async function listCoinSwitchAssets(): Promise<CoinSwitchAssetRow[]> {
    const vNow = Date.now();
    if (gAssetsCache && gAssetsCache.expiresAtMs > vNow) {
        return gAssetsCache.rows;
    }
    const objPayload = await fetchCoinSwitchJson<{ data?: CoinSwitchAssetRow[] }>("/assets");
    const arrRows = Array.isArray(objPayload.data) ? objPayload.data : [];
    gAssetsCache = {
        expiresAtMs: vNow + 60_000,
        rows: arrRows
    };
    return arrRows;
}

export async function listCoinSwitchTickersBySymbol(): Promise<Map<string, CoinSwitchTickerRow>> {
    const vNow = Date.now();
    if (gTickersCache && gTickersCache.expiresAtMs > vNow) {
        return gTickersCache.bySymbol;
    }
    const objPayload = await fetchCoinSwitchJson<{ payload?: CoinSwitchTickerRow[] }>(
        "/ticker/24hr/all-pairs?exchange=BYBIT&market_type=OPTION&stale_rate_time_in_seconds=0"
    );
    const arrRows = Array.isArray(objPayload.payload) ? objPayload.payload : [];
    const mapBySymbol = new Map<string, CoinSwitchTickerRow>();
    for (const objRow of arrRows) {
        const vSymbol = String(objRow.symbol || "").trim().toUpperCase();
        if (vSymbol) {
            mapBySymbol.set(vSymbol, objRow);
        }
    }
    gTickersCache = {
        expiresAtMs: vNow + 2_000,
        bySymbol: mapBySymbol
    };
    return mapBySymbol;
}

export async function listCoinSwitchOptionsBasePairs(): Promise<CoinSwitchOptionsBasePair[]> {
    const arrAssets = await listCoinSwitchAssets();
    const mapPairs = new Map<string, CoinSwitchOptionsBasePair>();
    for (const objRow of arrAssets) {
        if (String(objRow.status || "").toUpperCase() !== "ENABLED") {
            continue;
        }
        const vBaseCoin = String(objRow.base_asset || "").trim().toUpperCase();
        const vQuoteCoin = String(objRow.quote_asset || "").trim().toUpperCase();
        if (!vBaseCoin || !vQuoteCoin) {
            continue;
        }
        const vKey = `${vBaseCoin}:${vQuoteCoin}`;
        if (!mapPairs.has(vKey)) {
            mapPairs.set(vKey, {
                baseCoin: vBaseCoin,
                quoteCoin: vQuoteCoin,
                displayName: `${vBaseCoin}-${vQuoteCoin}`
            });
        }
    }
    return Array.from(mapPairs.values()).sort((pLeft, pRight) =>
        pLeft.displayName.localeCompare(pRight.displayName)
    );
}

export async function listCoinSwitchOptionsDeliveryTimes(
    pBaseCoin: string,
    pQuoteCoin: string
): Promise<number[]> {
    const vBaseCoin = String(pBaseCoin || "").trim().toUpperCase();
    const vQuoteCoin = String(pQuoteCoin || "").trim().toUpperCase();
    const arrAssets = await listCoinSwitchAssets();
    const setTimes = new Set<number>();
    for (const objRow of arrAssets) {
        if (String(objRow.status || "").toUpperCase() !== "ENABLED") {
            continue;
        }
        if (String(objRow.base_asset || "").trim().toUpperCase() !== vBaseCoin) {
            continue;
        }
        if (String(objRow.quote_asset || "").trim().toUpperCase() !== vQuoteCoin) {
            continue;
        }
        const vDeliveryTime = Math.floor(Number(objRow.delivery_time || objRow.expiry_date || 0));
        if (vDeliveryTime > 0) {
            setTimes.add(vDeliveryTime);
        }
    }
    return Array.from(setTimes).sort((pLeft, pRight) => pLeft - pRight);
}

export async function listCoinSwitchOptionChainRoundedToThousand(
    pBaseCoin: string,
    pQuoteCoin: string,
    pDeliveryTimeMs: number,
    pSide: "put" | "call"
): Promise<{
    baseCoin: string;
    quoteCoin: string;
    deliveryTime: number;
    expiryLabel: string;
    deltaChainSymbol: string;
    side: "put" | "call";
    rows: CoinSwitchOptionChainRow[];
}> {
    const vBaseCoin = String(pBaseCoin || "").trim().toUpperCase();
    const vQuoteCoin = String(pQuoteCoin || "").trim().toUpperCase();
    const vDeliveryTime = Math.floor(Number(pDeliveryTimeMs));
    const vSide = pSide === "call" ? "call" : "put";
    const [arrAssets, mapTickers] = await Promise.all([
        listCoinSwitchAssets(),
        listCoinSwitchTickersBySymbol()
    ]);

    const arrRows = arrAssets
        .filter((objRow) => {
            if (String(objRow.status || "").toUpperCase() !== "ENABLED") {
                return false;
            }
            if (String(objRow.base_asset || "").trim().toUpperCase() !== vBaseCoin) {
                return false;
            }
            if (String(objRow.quote_asset || "").trim().toUpperCase() !== vQuoteCoin) {
                return false;
            }
            const vRowDelivery = Math.floor(Number(objRow.delivery_time || objRow.expiry_date || 0));
            if (vRowDelivery !== vDeliveryTime) {
                return false;
            }
            const vStrike = Number(objRow.strike_price);
            return matchesOptionSide(objRow.contract_type, vSide) && isThousandStrike(vStrike);
        })
        .map((objRow) => {
            const vSymbol = String(objRow.symbol || "").trim().toUpperCase();
            const objTicker = mapTickers.get(vSymbol);
            return {
                symbol: vSymbol,
                strike: Number(objRow.strike_price),
                delta: toNumber(objTicker?.delta),
                bid: toNumber(objTicker?.bid1Price),
                ask: toNumber(objTicker?.ask1Price),
                markPrice: toNumber(objTicker?.markPrice)
            };
        })
        .filter((objRow) => objRow.symbol && Number.isFinite(objRow.strike))
        .sort((pLeft, pRight) => pLeft.strike - pRight.strike);

    return {
        baseCoin: vBaseCoin,
        quoteCoin: vQuoteCoin,
        deliveryTime: vDeliveryTime,
        expiryLabel: formatCoinSwitchExpiryLabel(vDeliveryTime),
        deltaChainSymbol: buildDeltaOptionsChainSymbolFromDelivery(vBaseCoin, vDeliveryTime),
        side: vSide,
        rows: arrRows
    };
}

export async function listCoinSwitchOptionChainRoundedToFiveHundred(
    pBaseCoin: string,
    pQuoteCoin: string,
    pDeliveryTimeMs: number,
    pSide: "put" | "call"
): Promise<{
    baseCoin: string;
    quoteCoin: string;
    deliveryTime: number;
    expiryLabel: string;
    deltaChainSymbol: string;
    side: "put" | "call";
    rows: CoinSwitchOptionChainRow[];
}> {
    const vBaseCoin = String(pBaseCoin || "").trim().toUpperCase();
    const vQuoteCoin = String(pQuoteCoin || "").trim().toUpperCase();
    const vDeliveryTime = Math.floor(Number(pDeliveryTimeMs));
    const vSide = pSide === "call" ? "call" : "put";
    const [arrAssets, mapTickers] = await Promise.all([
        listCoinSwitchAssets(),
        listCoinSwitchTickersBySymbol()
    ]);

    const arrRows = arrAssets
        .filter((objRow) => {
            if (String(objRow.status || "").toUpperCase() !== "ENABLED") {
                return false;
            }
            if (String(objRow.base_asset || "").trim().toUpperCase() !== vBaseCoin) {
                return false;
            }
            if (String(objRow.quote_asset || "").trim().toUpperCase() !== vQuoteCoin) {
                return false;
            }
            const vRowDelivery = Math.floor(Number(objRow.delivery_time || objRow.expiry_date || 0));
            if (vRowDelivery !== vDeliveryTime) {
                return false;
            }
            const vStrike = Number(objRow.strike_price);
            return matchesOptionSide(objRow.contract_type, vSide) && isFiveHundredStrike(vStrike);
        })
        .map((objRow) => {
            const vSymbol = String(objRow.symbol || "").trim().toUpperCase();
            const objTicker = mapTickers.get(vSymbol);
            return {
                symbol: vSymbol,
                strike: Number(objRow.strike_price),
                delta: toNumber(objTicker?.delta),
                bid: toNumber(objTicker?.bid1Price),
                ask: toNumber(objTicker?.ask1Price),
                markPrice: toNumber(objTicker?.markPrice)
            };
        })
        .filter((objRow) => objRow.symbol && Number.isFinite(objRow.strike))
        .sort((pLeft, pRight) => pLeft.strike - pRight.strike);

    return {
        baseCoin: vBaseCoin,
        quoteCoin: vQuoteCoin,
        deliveryTime: vDeliveryTime,
        expiryLabel: formatCoinSwitchExpiryLabel(vDeliveryTime),
        deltaChainSymbol: buildDeltaOptionsChainSymbolFromDelivery(vBaseCoin, vDeliveryTime),
        side: vSide,
        rows: arrRows
    };
}

export async function listCoinSwitchLiveQuotes(
    pBaseCoin: string,
    pQuoteCoin: string,
    pDeliveryTimeMs: number,
    pSide: "put" | "call"
): Promise<CoinSwitchOptionChainRow[]> {
    const objChain = await listCoinSwitchOptionChainRoundedToThousand(
        pBaseCoin,
        pQuoteCoin,
        pDeliveryTimeMs,
        pSide
    );
    return objChain.rows;
}

export async function getCoinSwitchLotSizeForSymbol(pSymbol: string): Promise<number> {
    const vSymbol = String(pSymbol || "").trim().toUpperCase();
    if (!vSymbol) {
        return 0;
    }
    const arrAssets = await listCoinSwitchAssets();
    const objAsset = (Array.isArray(arrAssets) ? arrAssets : [])
        .find((objRow) => String(objRow.symbol || "").trim().toUpperCase() === vSymbol);
    const vLotSize = Number(objAsset?.lot_size);
    return Number.isFinite(vLotSize) && vLotSize > 0 ? vLotSize : 0;
}

export async function getCoinSwitchLotSizeForUnderlying(pUnderlying: string): Promise<number> {
    const vUnderlying = String(pUnderlying || "").trim().toUpperCase();
    if (!vUnderlying) {
        return 0;
    }
    const arrAssets = await listCoinSwitchAssets();
    const objAsset = (Array.isArray(arrAssets) ? arrAssets : [])
        .find((objRow) =>
            String(objRow.base_asset || "").trim().toUpperCase() === vUnderlying
            && String(objRow.contract_type || "").trim().toUpperCase() === "P"
            && String(objRow.status || "").toUpperCase() === "ENABLED"
        );
    const vLotSize = Number(objAsset?.lot_size);
    return Number.isFinite(vLotSize) && vLotSize > 0 ? vLotSize : 0;
}
