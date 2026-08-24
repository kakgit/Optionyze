import type { Request, Response } from "express";
import crypto from "node:crypto";
const DeltaRestClient = require("delta-rest-client");
import {
    listCoinSwitchOptionsBasePairs,
    listCoinSwitchOptionsDeliveryTimes,
    listCoinSwitchOptionChainRoundedToThousand,
    listCoinSwitchLiveQuotes,
    formatCoinSwitchExpiryLabel
} from "../../services/coinswitch-options-client";
import { listDeltaOptionChainRoundedToThousand } from "../../services/delta-options-client";
import { filterCompareRowsToDeltaStraddle } from "../../services/compare-row-delta-straddle";
import { getCsDeltaApiProfile } from "../../storage/cs-delta-api-profile-store";
import {
    createCsDeltaOpenPosition,
    deleteCsDeltaOpenPosition,
    getCsDeltaOpenPositionBySide,
    listCsDeltaOpenPositions
} from "../../storage/cs-delta-open-position-store";
import {
    getArbitrageLotSizing,
    placeCoinSwitchOptionOrder
} from "../../services/coinswitch-hft-client";

function getErrorMessage(pError: unknown, pFallback: string): string {
    if (pError instanceof Error && String(pError.message || "").trim()) {
        return pError.message;
    }
    return pFallback;
}

async function buildCoinSwitchComparePayload(
    pBaseCoin: string,
    pQuoteCoin: string,
    pDeliveryTime: number,
    pSide: "put" | "call"
) {
    const vSide = pSide === "call" ? "call" : "put";
    const vSideLabel = vSide === "call" ? "call" : "put";
    const vExpiryLabel = formatCoinSwitchExpiryLabel(pDeliveryTime);
    const [objCoinSwitchChain, objDeltaResult] = await Promise.all([
        listCoinSwitchOptionChainRoundedToThousand(pBaseCoin, pQuoteCoin, pDeliveryTime, vSide),
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

    const arrRows = objCoinSwitchChain.rows.map((objCoinSwitchRow) => {
        const objDeltaRow = mapDeltaByStrike.get(objCoinSwitchRow.strike) || null;
        return {
            strike: objCoinSwitchRow.strike,
            coinswitch: {
                symbol: objCoinSwitchRow.symbol,
                bid: objCoinSwitchRow.bid,
                ask: objCoinSwitchRow.ask,
                delta: objCoinSwitchRow.delta
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
    let vMessage = `Loaded ${arrCompareRows.length} CoinSwitch ${vSideLabel} strikes around 0.50 delta; ${vMatchedDeltaCount} matched on Delta.`;
    if (!objDeltaResult.ok) {
        vMessage = `Loaded ${arrCompareRows.length} CoinSwitch ${vSideLabel} strikes around 0.50 delta. Delta side unavailable: ${objDeltaResult.error}`;
    }
    else if (objDeltaResult.chain.rows.length === 0) {
        vMessage = `Loaded ${arrCompareRows.length} CoinSwitch ${vSideLabel} strikes around 0.50 delta. No Delta ${vSideLabel} contracts for ${vExpiryLabel}.`;
    }

    return {
        status: objDeltaResult.ok ? "success" as const : "warning" as const,
        message: vMessage,
        data: {
            side: vSide,
            baseCoin: pBaseCoin,
            quoteCoin: pQuoteCoin,
            deliveryTime: pDeliveryTime,
            expiryLabel: objCoinSwitchChain.expiryLabel,
            deltaChainSymbol: objCoinSwitchChain.deltaChainSymbol || objDeltaResult.chain.chainSymbol,
            deltaUnderlying: objDeltaResult.chain.underlying,
            deltaExpiryLabel: objDeltaResult.chain.expiryLabel,
            deltaRowCount: objDeltaResult.chain.rows.length,
            deltaMatchedCount: vMatchedDeltaCount,
            deltaError: objDeltaResult.ok ? null : objDeltaResult.error,
            rows: arrCompareRows
        }
    };
}

export async function getCoinSwitchArbitrageInstruments(req: Request, res: Response): Promise<void> {
    try {
        const arrPairs = await listCoinSwitchOptionsBasePairs();
        res.json({
            status: "success",
            message: "CoinSwitch instruments loaded.",
            data: {
                instruments: arrPairs
            }
        });
    }
    catch (objError) {
        res.status(500).json({
            status: "danger",
            message: getErrorMessage(objError, "Unable to load CoinSwitch instruments.")
        });
    }
}

export async function getCoinSwitchArbitrageExpiries(req: Request, res: Response): Promise<void> {
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
        const arrDeliveryTimes = await listCoinSwitchOptionsDeliveryTimes(vBaseCoin, vQuoteCoin);
        res.json({
            status: "success",
            message: "CoinSwitch expiries loaded.",
            data: {
                baseCoin: vBaseCoin,
                quoteCoin: vQuoteCoin,
                expiries: arrDeliveryTimes.map((vDeliveryTime) => ({
                    deliveryTime: vDeliveryTime,
                    label: formatCoinSwitchExpiryLabel(vDeliveryTime)
                }))
            }
        });
    }
    catch (objError) {
        res.status(500).json({
            status: "danger",
            message: getErrorMessage(objError, "Unable to load CoinSwitch expiries.")
        });
    }
}

async function handleCoinSwitchCompareSide(
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
        const objPayload = await buildCoinSwitchComparePayload(vBaseCoin, vQuoteCoin, vDeliveryTime, pSide);
        res.json(objPayload);
    }
    catch (objError) {
        res.status(500).json({
            status: "danger",
            message: getErrorMessage(
                objError,
                `Unable to compare CoinSwitch and Delta ${pSide === "call" ? "call" : "put"} chains.`
            )
        });
    }
}

export async function getCoinSwitchComparePuts(req: Request, res: Response): Promise<void> {
    await handleCoinSwitchCompareSide(req, res, "put");
}

export async function getCoinSwitchCompareCalls(req: Request, res: Response): Promise<void> {
    await handleCoinSwitchCompareSide(req, res, "call");
}

export async function getCoinSwitchLiveQuotes(req: Request, res: Response): Promise<void> {
    try {
        const vBaseCoin = String(req.query.baseCoin || "BTC").trim().toUpperCase();
        const vQuoteCoin = String(req.query.quoteCoin || "USDT").trim().toUpperCase();
        const vDeliveryTime = Math.floor(Number(req.query.deliveryTime || 0));
        const vSideRaw = String(req.query.side || "put").trim().toLowerCase();
        const vSide = vSideRaw === "call" ? "call" : "put";
        if (!vBaseCoin || !vQuoteCoin || !(vDeliveryTime > 0)) {
            res.status(400).json({
                status: "warning",
                message: "baseCoin, quoteCoin, and deliveryTime are required for live quotes."
            });
            return;
        }
        const arrRows = await listCoinSwitchLiveQuotes(vBaseCoin, vQuoteCoin, vDeliveryTime, vSide);
        res.json({
            status: "success",
            message: `Loaded ${arrRows.length} CoinSwitch live quotes.`,
            data: {
                side: vSide,
                rows: arrRows
            }
        });
    }
    catch (objError) {
        res.status(500).json({
            status: "danger",
            message: getErrorMessage(objError, "Unable to load CoinSwitch live quotes.")
        });
    }
}

interface DualOrderLegInput {
    strike?: unknown;
    coinswitchSymbol?: unknown;
    deltaSymbol?: unknown;
    coinswitchLimitPrice?: unknown;
    deltaLimitPrice?: unknown;
}

function getAccountId(req: Request): string {
    const vOwnAccountId = String(req.authAccount?.accountId || "").trim();
    const vBodyTarget = typeof req.body?.targetUserId === "string" ? req.body.targetUserId : "";
    const vQueryTarget = typeof req.query?.targetUserId === "string" ? req.query.targetUserId : "";
    const vTargetAccountId = String(vBodyTarget || vQueryTarget || "").trim();
    if ((req.authAccount?.isAdmin || req.authAccount?.isVerifier) && vTargetAccountId) {
        return vTargetAccountId;
    }
    return vOwnAccountId;
}

function parseDeltaPayload(pRaw: unknown): Record<string, unknown> {
    if (typeof pRaw === "string") {
        try {
            return JSON.parse(pRaw) as Record<string, unknown>;
        }
        catch (_objError) {
            return { message: pRaw };
        }
    }
    if (pRaw && typeof pRaw === "object") {
        return pRaw as Record<string, unknown>;
    }
    return {};
}

function readDeltaResponsePayload(pResponse: { data?: unknown; body?: unknown } | unknown): Record<string, unknown> {
    const objResponse = (pResponse || {}) as { data?: unknown; body?: unknown };
    return parseDeltaPayload(objResponse.data ?? objResponse.body ?? {});
}

async function placeDeltaOptionLimitOrder(
    pApiKey: string,
    pApiSecret: string,
    pSymbol: string,
    pSide: "buy" | "sell",
    pSize: number,
    pLimitPrice: number
): Promise<{ ok: boolean; message: string; orderId: string; raw: unknown }> {
    const objClient = await new DeltaRestClient(pApiKey, pApiSecret);
    const objOrderPayload = {
        product_symbol: String(pSymbol || "").trim().toUpperCase(),
        size: Math.max(1, Math.floor(pSize)),
        side: pSide,
        order_type: "limit_order",
        limit_price: String(pLimitPrice),
        time_in_force: "gtc",
        post_only: false,
        reduce_only: false
    };

    try {
        const objResponse = await objClient.apis.Orders.placeOrder({ order: objOrderPayload });
        const objPayload = readDeltaResponsePayload(objResponse);
        const objResult = (objPayload.result && typeof objPayload.result === "object")
            ? objPayload.result as Record<string, unknown>
            : {};
        const vOrderId = String(objResult.id || objResult.order_id || "").trim();
        const bOk = objPayload.success === true || Boolean(vOrderId);
        return {
            ok: bOk,
            message: bOk
                ? `Delta ${pSide} order placed.`
                : String(objPayload.message || "Delta order failed."),
            orderId: vOrderId,
            raw: objPayload
        };
    }
    catch (objError) {
        return {
            ok: false,
            message: getErrorMessage(objError, "Delta order failed."),
            orderId: "",
            raw: objError
        };
    }
}

export async function placeCoinSwitchDualOrders(req: Request, res: Response): Promise<void> {
    const vAccountId = getAccountId(req);
    if (!vAccountId) {
        res.status(401).json({ status: "warning", message: "Please sign in to continue." });
        return;
    }

    try {
        const vProfileId = String(req.body?.profileId || "").trim();
        const vSideRaw = String(req.body?.side || "").trim().toLowerCase();
        const vSide = vSideRaw === "call" ? "call" : (vSideRaw === "put" ? "put" : "");
        const vBaseCoin = String(req.body?.baseCoin || "BTC").trim().toUpperCase();
        const vMultiplier = Math.floor(Number(req.body?.multiplier || 0));
        const arrLegs = Array.isArray(req.body?.legs) ? req.body.legs as DualOrderLegInput[] : [];

        if (!vProfileId) {
            res.status(400).json({ status: "warning", message: "Select a username/API profile before placing orders." });
            return;
        }
        if (!vSide) {
            res.status(400).json({ status: "warning", message: "Order side must be put or call." });
            return;
        }
        if (!(vMultiplier >= 1 && vMultiplier <= 50)) {
            res.status(400).json({ status: "warning", message: "Multiplier must be a whole number between 1 and 50." });
            return;
        }
        if (!arrLegs.length) {
            res.status(400).json({ status: "warning", message: "Select at least one strike row before placing orders." });
            return;
        }
        if (arrLegs.length > 1) {
            res.status(400).json({
                status: "warning",
                message: `Only one ${vSide.toUpperCase()} position is allowed per username. Select a single strike.`
            });
            return;
        }

        const objProfile = await getCsDeltaApiProfile(vAccountId, vProfileId);
        if (!objProfile) {
            res.status(404).json({ status: "warning", message: "API credential profile not found." });
            return;
        }

        const objExisting = await getCsDeltaOpenPositionBySide(vAccountId, vProfileId, vSide);
        if (objExisting) {
            res.status(400).json({
                status: "warning",
                message: `${objProfile.userName} already has an open ${vSide.toUpperCase()} position at strike ${objExisting.strike}.`
            });
            return;
        }

        const objLots = getArbitrageLotSizing(vBaseCoin);
        const vCoinswitchQty = Number((objLots.coinswitchQtyPerLot * vMultiplier).toFixed(8));
        const vDeltaSize = Math.max(1, Math.floor(objLots.deltaContractsPerLot * vMultiplier));
        const arrResults: Array<Record<string, unknown>> = [];

        for (const objLeg of arrLegs) {
            const vStrike = Number(objLeg.strike);
            const vCsSymbol = String(objLeg.coinswitchSymbol || "").trim().toUpperCase();
            const vDeltaSymbol = String(objLeg.deltaSymbol || "").trim().toUpperCase();
            const vCsPrice = Number(objLeg.coinswitchLimitPrice);
            const vDeltaPrice = Number(objLeg.deltaLimitPrice);

            const objLegResult: Record<string, unknown> = {
                strike: Number.isFinite(vStrike) ? vStrike : null,
                coinswitchSymbol: vCsSymbol,
                deltaSymbol: vDeltaSymbol,
                coinswitchQty: vCoinswitchQty,
                deltaSize: vDeltaSize,
                coinswitchLimitPrice: vCsPrice,
                deltaLimitPrice: vDeltaPrice,
                coinswitch: null,
                delta: null
            };

            if (!vCsSymbol || !Number.isFinite(vCsPrice) || vCsPrice <= 0) {
                objLegResult.coinswitch = { ok: false, message: "Invalid CoinSwitch symbol or bid price." };
            }
            else {
                try {
                    const objCs = await placeCoinSwitchOptionOrder(
                        {
                            apiKey: objProfile.coinswitchApiKey,
                            apiSecret: objProfile.coinswitchApiSecret
                        },
                        {
                            symbol: vCsSymbol,
                            side: "Sell",
                            orderType: "Limit",
                            qty: String(vCoinswitchQty),
                            price: String(vCsPrice),
                            positionIdx: 0,
                            timeInForce: "GTC",
                            orderLinkId: crypto.randomUUID().replace(/-/g, "").slice(0, 36)
                        }
                    );
                    objLegResult.coinswitch = {
                        ok: objCs.ok,
                        message: objCs.retMsg,
                        orderId: objCs.orderId,
                        orderLinkId: objCs.orderLinkId,
                        retCode: objCs.retCode
                    };
                }
                catch (objError) {
                    objLegResult.coinswitch = {
                        ok: false,
                        message: getErrorMessage(objError, "CoinSwitch order failed.")
                    };
                }
            }

            if (!vDeltaSymbol || !Number.isFinite(vDeltaPrice) || vDeltaPrice <= 0) {
                objLegResult.delta = { ok: false, message: "Invalid Delta symbol or ask price." };
            }
            else {
                objLegResult.delta = await placeDeltaOptionLimitOrder(
                    objProfile.deltaApiKey,
                    objProfile.deltaApiSecret,
                    vDeltaSymbol,
                    "buy",
                    vDeltaSize,
                    vDeltaPrice
                );
            }

            arrResults.push(objLegResult);
        }

        const objSuccessLeg = arrResults.find((objRow) => {
            const objCs = objRow.coinswitch as { ok?: boolean; orderId?: string } | null;
            const objDelta = objRow.delta as { ok?: boolean; orderId?: string } | null;
            return Boolean(objCs?.ok) && Boolean(objDelta?.ok);
        }) || null;

        let objSavedPosition = null;
        if (objSuccessLeg) {
            const objCs = objSuccessLeg.coinswitch as { orderId?: string };
            const objDelta = objSuccessLeg.delta as { orderId?: string };
            objSavedPosition = await createCsDeltaOpenPosition({
                accountId: vAccountId,
                profileId: objProfile.profileId,
                userName: objProfile.userName,
                side: vSide,
                baseCoin: vBaseCoin,
                strike: Number(objSuccessLeg.strike),
                multiplier: vMultiplier,
                coinswitchSymbol: String(objSuccessLeg.coinswitchSymbol || ""),
                coinswitchQty: vCoinswitchQty,
                coinswitchEntryPrice: Number(objSuccessLeg.coinswitchLimitPrice),
                coinswitchOrderId: String(objCs?.orderId || ""),
                deltaSymbol: String(objSuccessLeg.deltaSymbol || ""),
                deltaSize: vDeltaSize,
                deltaEntryPrice: Number(objSuccessLeg.deltaLimitPrice),
                deltaOrderId: String(objDelta?.orderId || "")
            });
        }

        const vOkCount = objSuccessLeg ? 1 : 0;
        const vAllFailed = vOkCount === 0;

        res.json({
            status: vAllFailed ? "danger" : "success",
            message: vAllFailed
                ? "Order placement failed for the selected strike."
                : `Placed dual ${vSide.toUpperCase()} orders and opened the position for ${objProfile.userName}.`,
            data: {
                side: vSide,
                baseCoin: vBaseCoin,
                multiplier: vMultiplier,
                coinswitchQty: vCoinswitchQty,
                deltaSize: vDeltaSize,
                profileId: objProfile.profileId,
                userName: objProfile.userName,
                results: arrResults,
                position: objSavedPosition
            }
        });
    }
    catch (objError) {
        res.status(500).json({
            status: "danger",
            message: getErrorMessage(objError, "Unable to place dual orders.")
        });
    }
}

export async function listCoinSwitchOpenPositions(req: Request, res: Response): Promise<void> {
    const vAccountId = getAccountId(req);
    if (!vAccountId) {
        res.status(401).json({ status: "warning", message: "Please sign in to continue." });
        return;
    }

    try {
        const vProfileId = String(req.query.profileId || "").trim();
        const arrPositions = await listCsDeltaOpenPositions(vAccountId, vProfileId);
        res.json({
            status: "success",
            message: `Loaded ${arrPositions.length} open position${arrPositions.length === 1 ? "" : "s"}.`,
            data: {
                positions: arrPositions
            }
        });
    }
    catch (objError) {
        res.status(500).json({
            status: "danger",
            message: getErrorMessage(objError, "Unable to load open positions.")
        });
    }
}

export async function deleteCoinSwitchOpenPosition(req: Request, res: Response): Promise<void> {
    const vAccountId = getAccountId(req);
    if (!vAccountId) {
        res.status(401).json({ status: "warning", message: "Please sign in to continue." });
        return;
    }

    const vPositionId = String(req.params.positionId || "").trim();
    if (!vPositionId) {
        res.status(400).json({ status: "warning", message: "Position id is required." });
        return;
    }

    try {
        await deleteCsDeltaOpenPosition(vAccountId, vPositionId);
        res.json({
            status: "success",
            message: "Open position removed from the book."
        });
    }
    catch (objError) {
        res.status(400).json({
            status: "warning",
            message: getErrorMessage(objError, "Unable to remove open position.")
        });
    }
}

