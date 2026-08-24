const gDeltaIndiaApiBase = "https://api.india.delta.exchange/v2";

export interface DeltaOptionChainRow {
    symbol: string;
    strike: number;
    delta: number | null;
    bid: number | null;
    ask: number | null;
}

/** @deprecated Use DeltaOptionChainRow */
export type DeltaPutChainRow = DeltaOptionChainRow;

interface DeltaTickerGreeks {
    delta?: string | number;
}

interface DeltaTickerRow {
    symbol?: string;
    contract_type?: string;
    best_bid?: string | number;
    best_ask?: string | number;
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

function matchesOptionSide(pContractType: unknown, pSide: "put" | "call"): boolean {
    const vType = String(pContractType || "").trim().toLowerCase();
    if (pSide === "call") {
        return vType === "call_options" || vType === "call" || vType === "c";
    }
    return vType === "put_options" || vType === "put" || vType === "p";
}

function getTickerBestBid(pRow: DeltaTickerRow): number | null {
    return toNumber(pRow.quotes?.best_bid ?? pRow.best_bid);
}

function getTickerBestAsk(pRow: DeltaTickerRow): number | null {
    return toNumber(pRow.quotes?.best_ask ?? pRow.best_ask);
}

async function fetchDeltaJson<T>(pPath: string, pSearchParams?: URLSearchParams): Promise<T> {
    const vUrl = `${gDeltaIndiaApiBase}${pPath}${pSearchParams ? `?${pSearchParams.toString()}` : ""}`;
    const objResponse = await fetch(vUrl, {
        headers: {
            Accept: "application/json"
        }
    });
    if (!objResponse.ok) {
        throw new Error(`Delta options request failed (${objResponse.status}) for ${pPath}`);
    }
    return objResponse.json() as Promise<T>;
}

export function buildDeltaOptionsChainSymbol(pUnderlying: string, pExpiryLabelDdMmYyyy: string): string {
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

export async function listDeltaOptionChainRoundedToThousand(
    pUnderlying: string,
    pExpiryLabelDdMmYyyy: string,
    pSide: "put" | "call"
): Promise<{
    underlying: string;
    expiryLabel: string;
    chainSymbol: string;
    side: "put" | "call";
    rows: DeltaOptionChainRow[];
}> {
    const vUnderlying = String(pUnderlying || "").trim().toUpperCase();
    const vExpiryLabel = String(pExpiryLabelDdMmYyyy || "").trim();
    const vSide = pSide === "call" ? "call" : "put";
    const vChainSymbol = buildDeltaOptionsChainSymbol(vUnderlying, vExpiryLabel);
    if (!vUnderlying || !vExpiryLabel) {
        return {
            underlying: vUnderlying,
            expiryLabel: vExpiryLabel,
            chainSymbol: vChainSymbol,
            side: vSide,
            rows: []
        };
    }

    const objParams = new URLSearchParams({
        contract_types: vSide === "call" ? "call_options" : "put_options",
        underlying_asset_symbols: vUnderlying,
        expiry_date: vExpiryLabel
    });
    const objPayload = await fetchDeltaJson<DeltaApiResponse<DeltaTickerRow[]>>("/tickers", objParams);
    const arrRaw = Array.isArray(objPayload.result) ? objPayload.result : [];
    const arrRows = arrRaw
        .map((objRow) => {
            const vStrike = Number(objRow.strike_price);
            return {
                symbol: String(objRow.symbol || "").trim(),
                strike: vStrike,
                delta: toNumber(objRow.greeks?.delta),
                bid: getTickerBestBid(objRow),
                ask: getTickerBestAsk(objRow),
                contractType: String(objRow.contract_type || "").trim()
            };
        })
        .filter((objRow) =>
            objRow.symbol
            && Number.isFinite(objRow.strike)
            && isThousandStrike(objRow.strike)
            && (matchesOptionSide(objRow.contractType, vSide) || !objRow.contractType)
        )
        .sort((pLeft, pRight) => pLeft.strike - pRight.strike)
        .map((objRow) => ({
            symbol: objRow.symbol,
            strike: objRow.strike,
            delta: objRow.delta,
            bid: objRow.bid,
            ask: objRow.ask
        }));

    return {
        underlying: vUnderlying,
        expiryLabel: vExpiryLabel,
        chainSymbol: vChainSymbol,
        side: vSide,
        rows: arrRows
    };
}

export async function listDeltaPutChainRoundedToThousand(
    pUnderlying: string,
    pExpiryLabelDdMmYyyy: string
): Promise<{
    underlying: string;
    expiryLabel: string;
    chainSymbol: string;
    rows: DeltaOptionChainRow[];
}> {
    const objChain = await listDeltaOptionChainRoundedToThousand(pUnderlying, pExpiryLabelDdMmYyyy, "put");
    return {
        underlying: objChain.underlying,
        expiryLabel: objChain.expiryLabel,
        chainSymbol: objChain.chainSymbol,
        rows: objChain.rows
    };
}
