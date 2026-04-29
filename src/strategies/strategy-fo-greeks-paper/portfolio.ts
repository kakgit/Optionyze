import type { PaperPosition, PortfolioSnapshot, StrategyFoGreeksPaperConfig, StrategyFoGreeksPaperState } from "./types";

function sideFactor(pSide: "buy" | "sell"): number {
    return pSide === "buy" ? 1 : -1;
}

function getMarkToUse(pPosition: PaperPosition): number {
    const vMark = Number(pPosition.markPrice);
    if (Number.isFinite(vMark) && vMark > 0) {
        return vMark;
    }
    return Number(pPosition.entryPrice) || 0;
}

function getBrokerageRate(pConfig: StrategyFoGreeksPaperConfig, pPosition: PaperPosition): number {
    return pPosition.instrumentType === "future"
        ? Number(pConfig.futuresBrokerageRate || 0)
        : Number(pConfig.optionBrokerageRate || 0);
}

export function estimateCloseCharges(pConfig: StrategyFoGreeksPaperConfig, pPosition: PaperPosition): number {
    const vQty = Math.abs(Number(pPosition.qty) || 0);
    const vMark = Math.abs(getMarkToUse(pPosition));
    const vRate = getBrokerageRate(pConfig, pPosition);
    const vMinCharge = Number(pConfig.minBrokeragePerOrder || 0);
    const vRaw = vMark * vQty * vRate;
    return Math.max(vMinCharge, vRaw);
}

export function calcUnrealizedPnlGross(pPosition: PaperPosition): number {
    const vQty = Number(pPosition.qty) || 0;
    const vEntry = Number(pPosition.entryPrice) || 0;
    const vMark = getMarkToUse(pPosition);
    if (pPosition.side === "buy") {
        return (vMark - vEntry) * vQty;
    }
    return (vEntry - vMark) * vQty;
}

export function calcUnrealizedPnlNet(pConfig: StrategyFoGreeksPaperConfig, pPosition: PaperPosition): number {
    const vGross = calcUnrealizedPnlGross(pPosition);
    const vOpenCharges = Number(pPosition.openCharges || 0);
    const vCloseCharges = estimateCloseCharges(pConfig, pPosition);
    return vGross - vOpenCharges - vCloseCharges;
}

function calcGreeksContribution(pPosition: PaperPosition): { delta: number; gamma: number; theta: number } {
    const vQty = Number(pPosition.qty) || 0;
    const vSide = sideFactor(pPosition.side);
    const objGreeks = pPosition.currentGreeks || pPosition.entryGreeks;

    return {
        delta: (Number(objGreeks.delta) || 0) * vQty * vSide,
        gamma: (Number(objGreeks.gamma) || 0) * vQty * vSide,
        theta: (Number(objGreeks.theta) || 0) * vQty * vSide
    };
}

function calcMarginUsed(pPositions: PaperPosition[], pConfig: StrategyFoGreeksPaperConfig): number {
    let vTotal = 0;
    for (const objPosition of pPositions) {
        const vQty = Number(objPosition.qty) || 0;
        const vRefPx = getMarkToUse(objPosition);
        if (objPosition.instrumentType === "future") {
            vTotal += Math.abs(vRefPx * vQty * Number(pConfig.futuresMarginRate || 0.12));
            continue;
        }

        if (objPosition.side === "sell") {
            vTotal += Math.abs(vRefPx * vQty * Number(pConfig.optionShortMarginFactor || 1.25));
        }
        else {
            vTotal += Math.abs(vRefPx * vQty);
        }
    }
    return vTotal;
}

export function calculatePortfolio(pState: StrategyFoGreeksPaperState): PortfolioSnapshot {
    const objConfig = pState.config;
    const objOpenPositions = pState.positions.filter((objPosition) => objPosition.status === "OPEN");
    const objClosedPositions = pState.closedPositions;

    let vTotalDelta = 0;
    let vTotalGamma = 0;
    let vTotalTheta = 0;
    let vGrossUnrealizedPnl = 0;
    let vUnrealizedPnl = 0;
    let vGrossRealizedPnl = 0;
    let vRealizedPnl = 0;
    let vTotalCharges = 0;

    for (const objPosition of objOpenPositions) {
        const objGreeks = calcGreeksContribution(objPosition);
        vTotalDelta += objGreeks.delta;
        vTotalGamma += objGreeks.gamma;
        vTotalTheta += objGreeks.theta;

        const vGross = calcUnrealizedPnlGross(objPosition);
        const vNet = calcUnrealizedPnlNet(objConfig, objPosition);
        const vOpenCharges = Number(objPosition.openCharges || 0);
        const vEstClose = estimateCloseCharges(objConfig, objPosition);

        vGrossUnrealizedPnl += vGross;
        vUnrealizedPnl += vNet;
        vTotalCharges += vOpenCharges + vEstClose;
    }

    for (const objPosition of objClosedPositions) {
        vGrossRealizedPnl += Number(objPosition.grossRealizedPnl) || 0;
        vRealizedPnl += Number(objPosition.realizedPnl) || 0;
        vTotalCharges += Number(objPosition.totalCharges) || 0;
    }

    const vMarginUsed = calcMarginUsed(objOpenPositions, objConfig);
    const vTotalPnl = vRealizedPnl + vUnrealizedPnl;

    return {
        openCount: objOpenPositions.length,
        closedCount: objClosedPositions.length,
        totalDelta: vTotalDelta,
        totalGamma: vTotalGamma,
        totalTheta: vTotalTheta,
        grossUnrealizedPnl: vGrossUnrealizedPnl,
        unrealizedPnl: vUnrealizedPnl,
        grossRealizedPnl: vGrossRealizedPnl,
        realizedPnl: vRealizedPnl,
        totalCharges: vTotalCharges,
        totalPnl: vTotalPnl,
        marginUsed: vMarginUsed,
        pnlOnMarginPct: vMarginUsed > 0 ? (vTotalPnl / vMarginUsed) : 0
    };
}
