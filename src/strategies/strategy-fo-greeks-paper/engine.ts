import { fetchSnapshot, selectOptionByDteDelta } from "./market-data";
import { calculatePortfolio } from "./portfolio";
import { assessRisk } from "./risk";
import { openPaperPosition, closePaperPosition } from "./execution";
import { addEvent } from "./state";
import type {
    MarketOptionSnapshot,
    MarketSnapshot,
    PaperPosition,
    PortfolioSnapshot,
    RiskActions,
    StrategyFoGreeksPaperState
} from "./types";

function sideFactor(pSide: "buy" | "sell"): number {
    return pSide === "buy" ? 1 : -1;
}

function isOpen(pPosition: PaperPosition | null | undefined): pPosition is PaperPosition {
    return !!pPosition && pPosition.status === "OPEN";
}

function getOpenByLegType(pState: StrategyFoGreeksPaperState, pLegType: string): PaperPosition | null {
    return pState.positions.find((objPosition) => isOpen(objPosition) && objPosition.legType === pLegType) || null;
}

function getOptionPriceForSide(pOption: MarketOptionSnapshot, pSide: "buy" | "sell"): number {
    if (pSide === "buy") {
        return Number.isFinite(Number(pOption.bestAsk)) ? Number(pOption.bestAsk) : Number(pOption.mark || 0);
    }
    return Number.isFinite(Number(pOption.bestBid)) ? Number(pOption.bestBid) : Number(pOption.mark || 0);
}

function getDynamicQty(pState: StrategyFoGreeksPaperState, pPortfolio: PortfolioSnapshot): number {
    const objConfig = pState.config;
    const vDeltaNeed = Math.abs(Number(pPortfolio.totalDelta) || 0);
    const vStep = Math.max(1, Math.round(vDeltaNeed / 12));
    let vQty = objConfig.minContracts + vStep;
    const vGammaUtil = Math.abs(Number(pPortfolio.totalGamma) || 0) / Math.max(0.0001, objConfig.gammaMaxAbs);
    if (vGammaUtil > 0.7) {
        vQty = Math.max(objConfig.minContracts, Math.floor(vQty * objConfig.gammaReductionFactor));
    }
    return Math.max(objConfig.minContracts, Math.min(objConfig.maxContracts, vQty));
}

function getReentryState(pState: StrategyFoGreeksPaperState, pLegType: string) {
    if (!pState.reentry[pLegType]) {
        pState.reentry[pLegType] = { count: 0, cooldownUntilCycle: 0, consecutiveSl: 0, pauseUntilCycle: 0 };
    }
    const objReentry = pState.reentry[pLegType];
    if (!Number.isFinite(Number(objReentry.count))) objReentry.count = 0;
    if (!Number.isFinite(Number(objReentry.cooldownUntilCycle))) objReentry.cooldownUntilCycle = 0;
    if (!Number.isFinite(Number(objReentry.consecutiveSl))) objReentry.consecutiveSl = 0;
    if (!Number.isFinite(Number(objReentry.pauseUntilCycle))) objReentry.pauseUntilCycle = 0;
    return objReentry;
}

function getLegEntryQty(pState: StrategyFoGreeksPaperState, pLegType: string, pBaseQty: number): number {
    const objConfig = pState.config;
    const objReentry = getReentryState(pState, pLegType);
    if (objReentry.consecutiveSl <= 0) {
        return pBaseQty;
    }
    const vFactor = Math.pow(Number(objConfig.slChurnQtyReductionFactor || 0.5), objReentry.consecutiveSl);
    const vReduced = Math.max(objConfig.minContracts, Math.floor(pBaseQty * vFactor));
    return Math.min(pBaseQty, vReduced);
}

function updateOpenMarksAndGreeks(pState: StrategyFoGreeksPaperState, pSnapshot: MarketSnapshot): void {
    const objOptionsBySymbol: Record<string, MarketOptionSnapshot> = {};
    for (const objOption of pSnapshot.options) {
        objOptionsBySymbol[objOption.symbol] = objOption;
    }

    for (const objPosition of pState.positions) {
        if (!isOpen(objPosition)) {
            continue;
        }
        if (objPosition.instrumentType === "future") {
            objPosition.markPrice = Number(pSnapshot.ticker.mark || pSnapshot.ticker.spot || objPosition.markPrice || 0);
            objPosition.currentGreeks = { delta: 1, gamma: 0, theta: 0 };
            continue;
        }

        const objOption = objOptionsBySymbol[objPosition.symbol];
        if (!objOption) {
            continue;
        }

        const vBuyMark = Number.isFinite(Number(objOption.bestAsk)) ? Number(objOption.bestAsk) : Number(objOption.mark || objPosition.markPrice || 0);
        const vSellMark = Number.isFinite(Number(objOption.bestBid)) ? Number(objOption.bestBid) : Number(objOption.mark || objPosition.markPrice || 0);
        objPosition.markPrice = objPosition.side === "buy" ? vBuyMark : vSellMark;
        objPosition.currentGreeks = {
            delta: Number(objOption.delta) || 0,
            gamma: Number(objOption.gamma) || 0,
            theta: Number(objOption.theta) || 0
        };
        objPosition.meta = {
            ...(objPosition.meta || {}),
            dte: Number(objOption.dte) || 0,
            strike: Number(objOption.strike) || 0,
            expiry: objOption.expiry
        };
    }
}

function tryOpenOptionLeg(
    pState: StrategyFoGreeksPaperState,
    pSnapshot: MarketSnapshot,
    pParams: { legType: string; type: "put" | "call"; side: "buy" | "sell"; dteMin: number; dteMax: number; qty: number; reason?: string; }
): PaperPosition | null {
    const objOption = selectOptionByDteDelta(pSnapshot.options, {
        type: pParams.type,
        dteMin: pParams.dteMin,
        dteMax: pParams.dteMax,
        targetAbsDelta: pState.config.targetAbsDeltaOption
    });
    if (!objOption) {
        addEvent(pState, "SKIP", `No option found for ${pParams.legType}`, pParams);
        return null;
    }

    const vPrice = getOptionPriceForSide(objOption, pParams.side);
    if (!Number.isFinite(vPrice) || vPrice <= 0) {
        addEvent(pState, "SKIP", `Invalid price for ${pParams.legType}`, { symbol: objOption.symbol });
        return null;
    }

    return openPaperPosition(pState, {
        legType: pParams.legType,
        instrumentType: "option",
        symbol: objOption.symbol,
        expiry: objOption.expiry,
        optionType: objOption.type,
        side: pParams.side,
        qty: pParams.qty,
        price: vPrice,
        greeks: { delta: Number(objOption.delta) || 0, gamma: Number(objOption.gamma) || 0, theta: Number(objOption.theta) || 0 },
        reason: pParams.reason || "ENTRY",
        meta: { dte: objOption.dte, strike: objOption.strike ?? undefined }
    });
}

function applyShortPutLegManagement(pState: StrategyFoGreeksPaperState): void {
    const objConfig = pState.config;
    for (const vLegType of ["weekly_put_short", "biweekly_put_short"]) {
        const objLeg = getOpenByLegType(pState, vLegType);
        if (!objLeg) {
            continue;
        }
        const vAbsDelta = Math.abs(Number(objLeg.currentGreeks?.delta) || 0);
        const objReentry = getReentryState(pState, vLegType);

        if (vAbsDelta <= objConfig.shortPutTPDelta) {
            closePaperPosition(pState, objLeg, Number(objLeg.markPrice || objLeg.entryPrice || 0), "TP_DELTA");
            objReentry.consecutiveSl = 0;
            objReentry.cooldownUntilCycle = pState.cycleCount + Math.max(0, Math.floor(objConfig.reentryCooldownCycles / 2));
            pState.reentry[vLegType] = objReentry;
            continue;
        }

        if (vAbsDelta >= objConfig.shortPutSLDelta) {
            closePaperPosition(pState, objLeg, Number(objLeg.markPrice || objLeg.entryPrice || 0), "SL_DELTA");
            objReentry.count += 1;
            objReentry.consecutiveSl += 1;
            objReentry.cooldownUntilCycle = pState.cycleCount + objConfig.reentryCooldownCycles + (objReentry.consecutiveSl * objConfig.slChurnExtraCooldownPerSL);
            if (objReentry.consecutiveSl >= objConfig.slChurnPauseAfterConsecutive) {
                objReentry.pauseUntilCycle = pState.cycleCount + objConfig.slChurnPauseCycles;
                addEvent(pState, "CHURN", `${vLegType} paused after repeated SL`, {
                    consecutiveSl: objReentry.consecutiveSl,
                    pauseUntilCycle: objReentry.pauseUntilCycle
                });
            }
            pState.reentry[vLegType] = objReentry;
        }
    }
}

function enforceGammaProtection(pState: StrategyFoGreeksPaperState, pSnapshot: MarketSnapshot, pPortfolio: PortfolioSnapshot): void {
    const objConfig = pState.config;
    if (Math.abs(pPortfolio.totalGamma) <= objConfig.gammaMaxAbs) {
        return;
    }
    const objShorts = pState.positions
        .filter((objPosition) => isOpen(objPosition) && (objPosition.legType === "weekly_put_short" || objPosition.legType === "biweekly_put_short"))
        .map((objPosition) => ({ pos: objPosition, absGamma: Math.abs((Number(objPosition.currentGreeks?.gamma) || 0) * (Number(objPosition.qty) || 0)) }))
        .sort((objLeft, objRight) => objRight.absGamma - objLeft.absGamma);
    if (objShorts.length > 0) {
        closePaperPosition(pState, objShorts[0].pos, Number(objShorts[0].pos.markPrice || objShorts[0].pos.entryPrice || 0), "GAMMA_SPIKE_REDUCTION");
    }
    if (!getOpenByLegType(pState, "monthly_call_long")) {
        tryOpenOptionLeg(pState, pSnapshot, {
            legType: "monthly_call_long",
            type: "call",
            side: "buy",
            dteMin: objConfig.monthlyDteMin,
            dteMax: objConfig.monthlyDteMax,
            qty: objConfig.minContracts,
            reason: "GAMMA_HEDGE"
        });
    }
}

function getNetFuturesContracts(pState: StrategyFoGreeksPaperState): number {
    return pState.positions
        .filter((objPosition) => isOpen(objPosition) && objPosition.instrumentType === "future")
        .reduce((pAcc, objPosition) => pAcc + ((Number(objPosition.qty) || 0) * sideFactor(objPosition.side)), 0);
}

function closeAllFutures(pState: StrategyFoGreeksPaperState, pReason: string): void {
    for (const objFuture of pState.positions.filter((objPosition) => isOpen(objPosition) && objPosition.instrumentType === "future")) {
        closePaperPosition(pState, objFuture, Number(objFuture.markPrice || objFuture.entryPrice || 0), pReason);
    }
}

function rebalanceDeltaWithFutures(pState: StrategyFoGreeksPaperState, pPortfolio: PortfolioSnapshot, pSnapshot: MarketSnapshot): void {
    const objConfig = pState.config;
    let vTargetContracts = 0;
    if (Math.abs(pPortfolio.totalDelta) > objConfig.deltaTolerance) {
        vTargetContracts = Math.round((-1 * pPortfolio.totalDelta) / objConfig.futuresDeltaPerContract);
    }
    const vCurrentContracts = getNetFuturesContracts(pState);
    let vDiff = vTargetContracts - vCurrentContracts;
    if (vDiff === 0) {
        return;
    }
    if (Math.abs(vDiff) > objConfig.maxFuturesAdjustPerCycle) {
        vDiff = vDiff > 0 ? objConfig.maxFuturesAdjustPerCycle : -objConfig.maxFuturesAdjustPerCycle;
    }
    if (vTargetContracts === 0) {
        closeAllFutures(pState, "DELTA_BACK_IN_RANGE");
        return;
    }
    openPaperPosition(pState, {
        legType: "futures_hedge",
        instrumentType: "future",
        symbol: objConfig.symbol,
        optionType: "future",
        side: vDiff > 0 ? "buy" : "sell",
        qty: Math.abs(vDiff),
        price: Number(pSnapshot.ticker.mark || pSnapshot.ticker.spot || 0),
        greeks: { delta: 1, gamma: 0, theta: 0 },
        reason: "DELTA_REBALANCE"
    });
}

function canReenter(pState: StrategyFoGreeksPaperState, pLegType: string): boolean {
    const objConfig = pState.config;
    const objReentry = getReentryState(pState, pLegType);
    if (objReentry.count >= objConfig.maxReentriesPerLeg && objConfig.maxReentriesPerLeg >= 0) {
        return false;
    }
    if (pState.cycleCount < objReentry.cooldownUntilCycle || pState.cycleCount < objReentry.pauseUntilCycle) {
        return false;
    }
    if (pState.cycleCount >= objReentry.pauseUntilCycle && objReentry.pauseUntilCycle > 0) {
        objReentry.pauseUntilCycle = 0;
        objReentry.consecutiveSl = 0;
        pState.reentry[pLegType] = objReentry;
    }
    return true;
}

function runEntries(pState: StrategyFoGreeksPaperState, pSnapshot: MarketSnapshot, pPortfolio: PortfolioSnapshot, pRisk: RiskActions): void {
    const objConfig = pState.config;
    if (pRisk.blockNewEntries) {
        return;
    }
    const vBaseQty = getDynamicQty(pState, pPortfolio);
    if (!getOpenByLegType(pState, "weekly_put_short") && canReenter(pState, "weekly_put_short")) {
        tryOpenOptionLeg(pState, pSnapshot, {
            legType: "weekly_put_short",
            type: "put",
            side: "sell",
            dteMin: objConfig.weeklyDteMin,
            dteMax: objConfig.weeklyDteMax,
            qty: getLegEntryQty(pState, "weekly_put_short", vBaseQty),
            reason: "ENTRY_WEEKLY_PUT"
        });
    }
    if (!getOpenByLegType(pState, "biweekly_put_short") && canReenter(pState, "biweekly_put_short")) {
        tryOpenOptionLeg(pState, pSnapshot, {
            legType: "biweekly_put_short",
            type: "put",
            side: "sell",
            dteMin: objConfig.biWeeklyDteMin,
            dteMax: objConfig.biWeeklyDteMax,
            qty: getLegEntryQty(pState, "biweekly_put_short", vBaseQty),
            reason: "ENTRY_BIWEEKLY_PUT"
        });
    }
    if (!getOpenByLegType(pState, "monthly_call_long")) {
        tryOpenOptionLeg(pState, pSnapshot, {
            legType: "monthly_call_long",
            type: "call",
            side: "buy",
            dteMin: objConfig.monthlyDteMin,
            dteMax: objConfig.monthlyDteMax,
            qty: Math.max(objConfig.minContracts, Math.floor(vBaseQty * 0.6)),
            reason: "ENTRY_MONTHLY_HEDGE"
        });
    }
}

export function closeAllPositions(pState: StrategyFoGreeksPaperState, pReason: string): void {
    for (const objPosition of pState.positions.filter((objPosition) => isOpen(objPosition))) {
        closePaperPosition(pState, objPosition, Number(objPosition.markPrice || objPosition.entryPrice || 0), pReason);
    }
}

export async function runStrategyCycle(pState: StrategyFoGreeksPaperState): Promise<{ snapshot: MarketSnapshot; portfolio: PortfolioSnapshot; risk: RiskActions }> {
    const objSnapshot = await fetchSnapshot(pState.credentials.apiKey, pState.credentials.apiSecret, pState.config);
    updateOpenMarksAndGreeks(pState, objSnapshot);

    let objPortfolio = calculatePortfolio(pState);
    let objRisk = assessRisk(pState, objPortfolio);
    if (objRisk.closeAll) {
        closeAllPositions(pState, objRisk.closeAllReason || "GLOBAL_EXIT");
        return { snapshot: objSnapshot, portfolio: calculatePortfolio(pState), risk: objRisk };
    }

    applyShortPutLegManagement(pState);
    objPortfolio = calculatePortfolio(pState);
    objRisk = assessRisk(pState, objPortfolio);
    if (objRisk.gammaProtection) {
        enforceGammaProtection(pState, objSnapshot, objPortfolio);
        objPortfolio = calculatePortfolio(pState);
    }

    runEntries(pState, objSnapshot, objPortfolio, objRisk);
    objPortfolio = calculatePortfolio(pState);
    rebalanceDeltaWithFutures(pState, objPortfolio, objSnapshot);
    objPortfolio = calculatePortfolio(pState);

    if (pState.config.requirePositiveTheta && objPortfolio.totalTheta <= 0) {
        addEvent(pState, "WARN", "Theta is non-positive after cycle", { totalTheta: Number(objPortfolio.totalTheta.toFixed(6)) });
    }
    return { snapshot: objSnapshot, portfolio: objPortfolio, risk: objRisk };
}
