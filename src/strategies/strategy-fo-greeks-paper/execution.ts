import { addEvent, nextPositionId } from "./state";
import type { PaperPosition, StrategyFoGreeksPaperState } from "./types";

function applySlippage(pPrice: number, pSide: "buy" | "sell", pBps: number): number {
    const vPrice = Number(pPrice) || 0;
    const vSlippage = (Number(pBps) || 0) / 10000;
    if (pSide === "buy") {
        return vPrice * (1 + vSlippage);
    }
    return vPrice * (1 - vSlippage);
}

function calcOrderCharges(
    pState: StrategyFoGreeksPaperState,
    pInstrumentType: "option" | "future",
    pPrice: number,
    pQty: number
): number {
    const vPrice = Math.abs(Number(pPrice) || 0);
    const vQty = Math.abs(Number(pQty) || 0);
    const objConfig = pState.config;
    const vRate = pInstrumentType === "future"
        ? Number(objConfig.futuresBrokerageRate || 0)
        : Number(objConfig.optionBrokerageRate || 0);
    const vMinCharge = Number(objConfig.minBrokeragePerOrder || 0);
    const vRaw = vPrice * vQty * vRate;
    return Math.max(vMinCharge, vRaw);
}

export function openPaperPosition(
    pState: StrategyFoGreeksPaperState,
    pInput: {
        legType: string;
        instrumentType: "option" | "future";
        symbol: string;
        expiry?: string;
        optionType?: string;
        side: "buy" | "sell";
        qty: number;
        price: number;
        greeks?: { delta?: number; gamma?: number; theta?: number };
        reason?: string;
        meta?: Record<string, unknown>;
    }
): PaperPosition {
    const vQty = Math.max(1, Math.floor(Number(pInput.qty) || 0));
    const vRawPrice = Number(pInput.price) || 0;
    const vEntryPrice = applySlippage(vRawPrice, pInput.side, pState.config.entrySlippageBps);
    const vOpenCharges = calcOrderCharges(pState, pInput.instrumentType, vEntryPrice, vQty);

    const objPosition: PaperPosition = {
        id: nextPositionId(),
        legType: pInput.legType,
        instrumentType: pInput.instrumentType,
        symbol: pInput.symbol,
        expiry: pInput.expiry || "",
        optionType: pInput.optionType || "",
        side: pInput.side,
        qty: vQty,
        entryPrice: vEntryPrice,
        markPrice: vEntryPrice,
        entryGreeks: {
            delta: Number(pInput.greeks?.delta) || 0,
            gamma: Number(pInput.greeks?.gamma) || 0,
            theta: Number(pInput.greeks?.theta) || 0
        },
        currentGreeks: {
            delta: Number(pInput.greeks?.delta) || 0,
            gamma: Number(pInput.greeks?.gamma) || 0,
            theta: Number(pInput.greeks?.theta) || 0
        },
        openCharges: vOpenCharges,
        estimatedCloseCharges: 0,
        totalCharges: vOpenCharges,
        meta: pInput.meta || {},
        status: "OPEN",
        openedAt: new Date().toISOString(),
        closedAt: "",
        closeReason: "",
        grossRealizedPnl: 0,
        realizedPnl: 0
    };

    pState.positions.push(objPosition);
    addEvent(pState, "OPEN", `${pInput.legType} ${pInput.side} ${vQty} ${pInput.symbol}`, {
        reason: pInput.reason || "",
        openCharges: Number(vOpenCharges.toFixed(6))
    });
    return objPosition;
}

export function closePaperPosition(
    pState: StrategyFoGreeksPaperState,
    pPosition: PaperPosition,
    pClosePrice: number,
    pReason: string
): PaperPosition {
    const vPrice = applySlippage(pClosePrice, pPosition.side === "buy" ? "sell" : "buy", pState.config.exitSlippageBps);
    const vQty = Number(pPosition.qty) || 0;
    const vEntry = Number(pPosition.entryPrice) || 0;
    const vGross = pPosition.side === "buy"
        ? (vPrice - vEntry) * vQty
        : (vEntry - vPrice) * vQty;

    const vCloseCharges = calcOrderCharges(pState, pPosition.instrumentType, vPrice, vQty);
    const vOpenCharges = Number(pPosition.openCharges || 0);
    const vTotalCharges = vOpenCharges + vCloseCharges;
    const vNet = vGross - vTotalCharges;

    pPosition.status = "CLOSED";
    pPosition.closedAt = new Date().toISOString();
    pPosition.closePrice = vPrice;
    pPosition.closeReason = pReason || "CLOSE";
    pPosition.closeCharges = vCloseCharges;
    pPosition.totalCharges = vTotalCharges;
    pPosition.grossRealizedPnl = vGross;
    pPosition.realizedPnl = vNet;

    pState.closedPositions.push(pPosition);
    pState.positions = pState.positions.filter((objPosition) => objPosition.id !== pPosition.id);

    addEvent(pState, "CLOSE", `${pPosition.legType} ${pPosition.side} ${pPosition.qty} ${pPosition.symbol}`, {
        reason: pPosition.closeReason,
        grossPnl: Number(vGross.toFixed(6)),
        charges: Number(vTotalCharges.toFixed(6)),
        netPnl: Number(vNet.toFixed(6))
    });

    return pPosition;
}
