import type { Request, Response } from "express";
import {
    listBybitOptionsBasePairs,
    listBybitOptionsDeliveryTimes,
    listBybitOptionChainRoundedToThousand,
    formatBybitOptionsExpiryLabel
} from "../../services/bybit-options-client";
import { listDeltaOptionChainRoundedToThousand } from "../../services/delta-options-client";
import { filterCompareRowsToDeltaStraddle } from "../../services/compare-row-delta-straddle";

function getErrorMessage(pError: unknown, pFallback: string): string {
    if (pError instanceof Error && String(pError.message || "").trim()) {
        return pError.message;
    }
    return pFallback;
}

async function buildBybitComparePayload(
    pBaseCoin: string,
    pQuoteCoin: string,
    pDeliveryTime: number,
    pSide: "put" | "call"
) {
    const vSide = pSide === "call" ? "call" : "put";
    const vSideLabel = vSide === "call" ? "call" : "put";
    const vExpiryLabel = formatBybitOptionsExpiryLabel(pDeliveryTime);
    const [objBybitChain, objDeltaResult] = await Promise.all([
        listBybitOptionChainRoundedToThousand(pBaseCoin, pQuoteCoin, pDeliveryTime, vSide),
        listDeltaOptionChainRoundedToThousand(pBaseCoin, vExpiryLabel, vSide).then(
            (objChain) => ({ ok: true as const, chain: objChain, error: "" }),
            (objError) => ({
                ok: false as const,
                chain: {
                    underlying: pBaseCoin,
                    expiryLabel: vExpiryLabel,
                    chainSymbol: "",
                    side: vSide,
                    rows: []
                },
                error: getErrorMessage(objError, `Unable to load Delta ${vSideLabel} chain.`)
            })
        )
    ]);

    const mapDeltaByStrike = new Map(
        objDeltaResult.chain.rows.map((objRow) => [objRow.strike, objRow])
    );

    const arrRows = objBybitChain.rows.map((objBybitRow) => {
        const objDeltaRow = mapDeltaByStrike.get(objBybitRow.strike) || null;
        return {
            strike: objBybitRow.strike,
            bybit: {
                symbol: objBybitRow.symbol,
                bid: objBybitRow.bid,
                ask: objBybitRow.ask,
                delta: objBybitRow.delta
            },
            delta: objDeltaRow
                ? {
                    symbol: objDeltaRow.symbol,
                    bid: objDeltaRow.bid,
                    ask: objDeltaRow.ask,
                    delta: objDeltaRow.delta
                }
                : null
        };
    });

    const arrCompareRows = filterCompareRowsToDeltaStraddle(arrRows);
    const vMatchedDeltaCount = arrCompareRows.filter((objRow) => objRow.delta).length;
    let vMessage = `Loaded ${arrCompareRows.length} Bybit ${vSideLabel} strikes around 0.50 delta; ${vMatchedDeltaCount} matched on Delta.`;
    if (!objDeltaResult.ok) {
        vMessage = `Loaded ${arrCompareRows.length} Bybit ${vSideLabel} strikes around 0.50 delta. Delta side unavailable: ${objDeltaResult.error}`;
    }
    else if (objDeltaResult.chain.rows.length === 0) {
        vMessage = `Loaded ${arrCompareRows.length} Bybit ${vSideLabel} strikes around 0.50 delta. No Delta ${vSideLabel} contracts for ${vExpiryLabel}.`;
    }

    return {
        status: objDeltaResult.ok ? "success" as const : "warning" as const,
        message: vMessage,
        data: {
            side: vSide,
            baseCoin: pBaseCoin,
            quoteCoin: pQuoteCoin,
            deliveryTime: pDeliveryTime,
            expiryCode: objBybitChain.expiryCode,
            expiryLabel: objBybitChain.expiryLabel,
            tickerTopic: "",
            deltaUnderlying: objDeltaResult.chain.underlying,
            deltaExpiryLabel: objDeltaResult.chain.expiryLabel,
            deltaChainSymbol: objDeltaResult.chain.chainSymbol,
            deltaRowCount: objDeltaResult.chain.rows.length,
            deltaMatchedCount: vMatchedDeltaCount,
            deltaError: objDeltaResult.ok ? null : objDeltaResult.error,
            rows: arrCompareRows
        }
    };
}

export function renderBybitDeltaPage(req: Request, res: Response): void {
    res.render("bybit-delta", {
        pageTitle: "Bybit-Delta | Optionyze",
        currentAccount: req.authAccount
    });
}


export async function getBybitArbitrageInstruments(req: Request, res: Response): Promise<void> {
    try {
        const arrPairs = await listBybitOptionsBasePairs();
        res.json({
            status: "success",
            message: "Instruments loaded.",
            data: {
                instruments: arrPairs
            }
        });
    }
    catch (objError) {
        res.status(500).json({
            status: "danger",
            message: getErrorMessage(objError, "Unable to load Bybit instruments.")
        });
    }
}

export async function getBybitArbitrageExpiries(req: Request, res: Response): Promise<void> {
    try {
        const vBaseCoin = String(req.query.baseCoin || "BTC").trim().toUpperCase();
        const vQuoteCoin = String(req.query.quoteCoin || "USDT").trim().toUpperCase();
        if (!vBaseCoin || !vQuoteCoin) {
            res.status(400).json({
                status: "warning",
                message: "Select a valid instrument before loading expiries."
            });
            return;
        }
        const arrDeliveryTimes = await listBybitOptionsDeliveryTimes(vBaseCoin, vQuoteCoin);
        res.json({
            status: "success",
            message: "Expiries loaded.",
            data: {
                baseCoin: vBaseCoin,
                quoteCoin: vQuoteCoin,
                expiries: arrDeliveryTimes.map((vDeliveryTime) => ({
                    deliveryTime: vDeliveryTime,
                    label: formatBybitOptionsExpiryLabel(vDeliveryTime)
                }))
            }
        });
    }
    catch (objError) {
        res.status(500).json({
            status: "danger",
            message: getErrorMessage(objError, "Unable to load Bybit expiries.")
        });
    }
}

async function handleBybitCompareSide(
    req: Request,
    res: Response,
    pSide: "put" | "call"
): Promise<void> {
    try {
        const vBaseCoin = String(req.query.baseCoin || "BTC").trim().toUpperCase();
        const vQuoteCoin = String(req.query.quoteCoin || "USDT").trim().toUpperCase();
        const vDeliveryTime = Math.floor(Number(req.query.deliveryTime || 0));
        const vSideLabel = pSide === "call" ? "call" : "put";
        if (!vBaseCoin || !vQuoteCoin) {
            res.status(400).json({
                status: "warning",
                message: `Select a valid instrument before comparing ${vSideLabel} chains.`
            });
            return;
        }
        if (!(vDeliveryTime > 0)) {
            res.status(400).json({
                status: "warning",
                message: `Select an expiry date before comparing ${vSideLabel} chains.`
            });
            return;
        }

        const objPayload = await buildBybitComparePayload(vBaseCoin, vQuoteCoin, vDeliveryTime, pSide);
        res.json(objPayload);
    }
    catch (objError) {
        res.status(500).json({
            status: "danger",
            message: getErrorMessage(
                objError,
                `Unable to compare Bybit and Delta ${pSide === "call" ? "call" : "put"} chains.`
            )
        });
    }
}

export async function getBybitComparePuts(req: Request, res: Response): Promise<void> {
    await handleBybitCompareSide(req, res, "put");
}

export async function getBybitCompareCalls(req: Request, res: Response): Promise<void> {
    await handleBybitCompareSide(req, res, "call");
}
