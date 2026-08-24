import type { Request, Response } from "express";
import {
    listSharkOptionsBasePairs,
    listSharkOptionsDeliveryTimes,
    listSharkOptionChainRoundedToThousand,
    listSharkPutChainRoundedToThousand,
    formatSharkOptionsExpiryLabel
} from "../../services/shark-options-client";
import { listDeltaOptionChainRoundedToThousand } from "../../services/delta-options-client";
import { filterCompareRowsToDeltaStraddle } from "../../services/compare-row-delta-straddle";

function getErrorMessage(pError: unknown, pFallback: string): string {
    if (pError instanceof Error && String(pError.message || "").trim()) {
        return pError.message;
    }
    return pFallback;
}

async function buildOptionComparePayload(
    pBaseCoin: string,
    pQuoteCoin: string,
    pDeliveryTime: number,
    pSide: "put" | "call"
) {
    const vSide = pSide === "call" ? "call" : "put";
    const vSideLabel = vSide === "call" ? "call" : "put";
    const vExpiryLabel = formatSharkOptionsExpiryLabel(pDeliveryTime);
    const [objSharkChain, objDeltaResult] = await Promise.all([
        listSharkOptionChainRoundedToThousand(pBaseCoin, pQuoteCoin, pDeliveryTime, vSide),
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

    const arrRows = objSharkChain.rows.map((objSharkRow) => {
        const objDeltaRow = mapDeltaByStrike.get(objSharkRow.strike) || null;
        return {
            strike: objSharkRow.strike,
            shark: {
                symbol: objSharkRow.symbol,
                bid: objSharkRow.bid,
                ask: objSharkRow.ask,
                delta: objSharkRow.delta
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
    let vMessage = `Loaded ${arrCompareRows.length} Shark ${vSideLabel} strikes around 0.50 delta; ${vMatchedDeltaCount} matched on Delta.`;
    if (!objDeltaResult.ok) {
        vMessage = `Loaded ${arrCompareRows.length} Shark ${vSideLabel} strikes around 0.50 delta. Delta side unavailable: ${objDeltaResult.error}`;
    }
    else if (objDeltaResult.chain.rows.length === 0) {
        vMessage = `Loaded ${arrCompareRows.length} Shark ${vSideLabel} strikes around 0.50 delta. No Delta ${vSideLabel} contracts for ${vExpiryLabel}.`;
    }

    return {
        status: objDeltaResult.ok ? "success" as const : "warning" as const,
        message: vMessage,
        data: {
            side: vSide,
            baseCoin: pBaseCoin,
            quoteCoin: pQuoteCoin,
            deliveryTime: pDeliveryTime,
            expiryCode: objSharkChain.expiryCode,
            expiryLabel: objSharkChain.expiryLabel,
            tickerTopic: objSharkChain.tickerTopic,
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

export function renderArbitragePage(req: Request, res: Response): void {
    res.render("arbitrage", {
        pageTitle: "Shark-Delta | Optionyze",
        currentAccount: req.authAccount
    });
}

export function renderCoinSwitchDeltaPage(req: Request, res: Response): void {
    res.render("coinswitch-delta", {
        pageTitle: "CoinSwitch-Delta | Optionyze",
        currentAccount: req.authAccount
    });
}

export async function getArbitrageInstruments(req: Request, res: Response): Promise<void> {
    try {
        const arrPairs = await listSharkOptionsBasePairs();
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
            message: getErrorMessage(objError, "Unable to load Shark instruments.")
        });
    }
}

export async function getArbitrageExpiries(req: Request, res: Response): Promise<void> {
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
        const arrDeliveryTimes = await listSharkOptionsDeliveryTimes(vBaseCoin, vQuoteCoin);
        res.json({
            status: "success",
            message: "Expiries loaded.",
            data: {
                baseCoin: vBaseCoin,
                quoteCoin: vQuoteCoin,
                expiries: arrDeliveryTimes.map((vDeliveryTime) => ({
                    deliveryTime: vDeliveryTime,
                    label: formatSharkOptionsExpiryLabel(vDeliveryTime)
                }))
            }
        });
    }
    catch (objError) {
        res.status(500).json({
            status: "danger",
            message: getErrorMessage(objError, "Unable to load Shark expiries.")
        });
    }
}

export async function getArbitragePutChain(req: Request, res: Response): Promise<void> {
    try {
        const vBaseCoin = String(req.query.baseCoin || "BTC").trim().toUpperCase();
        const vQuoteCoin = String(req.query.quoteCoin || "USDT").trim().toUpperCase();
        const vDeliveryTime = Math.floor(Number(req.query.deliveryTime || 0));
        if (!vBaseCoin || !vQuoteCoin) {
            res.status(400).json({
                status: "warning",
                message: "Select a valid instrument before fetching put chain data."
            });
            return;
        }
        if (!(vDeliveryTime > 0)) {
            res.status(400).json({
                status: "warning",
                message: "Select an expiry date before fetching put chain data."
            });
            return;
        }
        const objChain = await listSharkPutChainRoundedToThousand(vBaseCoin, vQuoteCoin, vDeliveryTime);
        res.json({
            status: "success",
            message: `Loaded ${objChain.rows.length} put strikes (rounded to 1000s).`,
            data: objChain
        });
    }
    catch (objError) {
        res.status(500).json({
            status: "danger",
            message: getErrorMessage(objError, "Unable to fetch Shark put chain data.")
        });
    }
}

async function handleArbitrageCompareSide(
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

        const objPayload = await buildOptionComparePayload(vBaseCoin, vQuoteCoin, vDeliveryTime, pSide);
        res.json(objPayload);
    }
    catch (objError) {
        res.status(500).json({
            status: "danger",
            message: getErrorMessage(
                objError,
                `Unable to compare Shark and Delta ${pSide === "call" ? "call" : "put"} chains.`
            )
        });
    }
}

export async function getArbitrageComparePuts(req: Request, res: Response): Promise<void> {
    await handleArbitrageCompareSide(req, res, "put");
}

export async function getArbitrageCompareCalls(req: Request, res: Response): Promise<void> {
    await handleArbitrageCompareSide(req, res, "call");
}
