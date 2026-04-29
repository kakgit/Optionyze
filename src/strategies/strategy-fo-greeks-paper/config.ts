import type { StrategyFoGreeksPaperConfig } from "./types";

export const DEFAULT_CONFIG: StrategyFoGreeksPaperConfig = {
    symbol: "BTCUSD",
    underlying: "BTC",
    loopSeconds: 10,
    targetDelta: 0,
    deltaTolerance: 20,
    targetAbsDeltaOption: 0.33,
    shortPutTPDelta: 0.15,
    shortPutSLDelta: 0.50,
    weeklyDteMin: 5,
    weeklyDteMax: 10,
    biWeeklyDteMin: 9,
    biWeeklyDteMax: 14,
    monthlyDteMin: 30,
    monthlyDteMax: 60,
    gammaMaxAbs: 25,
    requirePositiveTheta: true,
    profitExitPct: 0.35,
    maxLossPct: 0.20,
    maxOpenPositions: 12,
    maxConsecutiveFailures: 5,
    maxReentriesPerLeg: 3,
    reentryCooldownCycles: 2,
    slChurnPauseAfterConsecutive: 2,
    slChurnPauseCycles: 6,
    slChurnExtraCooldownPerSL: 2,
    slChurnQtyReductionFactor: 0.5,
    minContracts: 1,
    maxContracts: 8,
    maxFuturesAdjustPerCycle: 15,
    futuresDeltaPerContract: 1,
    optionShortMarginFactor: 1.25,
    futuresMarginRate: 0.12,
    optionBrokerageRate: 0.0005,
    futuresBrokerageRate: 0.0004,
    minBrokeragePerOrder: 0,
    entrySlippageBps: 2,
    exitSlippageBps: 2,
    gammaReductionFactor: 0.6
};

function toNumber(pValue: unknown, pFallback: number): number {
    const vNumber = Number(pValue);
    return Number.isFinite(vNumber) ? vNumber : pFallback;
}

export function normalizeConfig(pInput: Partial<StrategyFoGreeksPaperConfig> = {}): StrategyFoGreeksPaperConfig {
    return {
        ...DEFAULT_CONFIG,
        ...pInput,
        loopSeconds: Math.max(5, toNumber(pInput.loopSeconds, DEFAULT_CONFIG.loopSeconds)),
        deltaTolerance: Math.max(1, toNumber(pInput.deltaTolerance, DEFAULT_CONFIG.deltaTolerance)),
        gammaMaxAbs: Math.max(0.01, toNumber(pInput.gammaMaxAbs, DEFAULT_CONFIG.gammaMaxAbs)),
        profitExitPct: Math.max(0.05, Math.min(0.95, toNumber(pInput.profitExitPct, DEFAULT_CONFIG.profitExitPct))),
        maxLossPct: Math.max(0.01, Math.min(0.95, toNumber(pInput.maxLossPct, DEFAULT_CONFIG.maxLossPct))),
        minContracts: Math.max(1, Math.floor(toNumber(pInput.minContracts, DEFAULT_CONFIG.minContracts))),
        maxContracts: Math.max(1, Math.floor(toNumber(pInput.maxContracts, DEFAULT_CONFIG.maxContracts))),
        maxOpenPositions: Math.max(1, Math.floor(toNumber(pInput.maxOpenPositions, DEFAULT_CONFIG.maxOpenPositions))),
        maxConsecutiveFailures: Math.max(1, Math.floor(toNumber(pInput.maxConsecutiveFailures, DEFAULT_CONFIG.maxConsecutiveFailures))),
        maxReentriesPerLeg: Math.max(0, Math.floor(toNumber(pInput.maxReentriesPerLeg, DEFAULT_CONFIG.maxReentriesPerLeg))),
        reentryCooldownCycles: Math.max(0, Math.floor(toNumber(pInput.reentryCooldownCycles, DEFAULT_CONFIG.reentryCooldownCycles))),
        slChurnPauseAfterConsecutive: Math.max(1, Math.floor(toNumber(pInput.slChurnPauseAfterConsecutive, DEFAULT_CONFIG.slChurnPauseAfterConsecutive))),
        slChurnPauseCycles: Math.max(1, Math.floor(toNumber(pInput.slChurnPauseCycles, DEFAULT_CONFIG.slChurnPauseCycles))),
        slChurnExtraCooldownPerSL: Math.max(0, Math.floor(toNumber(pInput.slChurnExtraCooldownPerSL, DEFAULT_CONFIG.slChurnExtraCooldownPerSL))),
        slChurnQtyReductionFactor: Math.max(0.1, Math.min(1, toNumber(pInput.slChurnQtyReductionFactor, DEFAULT_CONFIG.slChurnQtyReductionFactor))),
        maxFuturesAdjustPerCycle: Math.max(1, Math.floor(toNumber(pInput.maxFuturesAdjustPerCycle, DEFAULT_CONFIG.maxFuturesAdjustPerCycle))),
        optionBrokerageRate: Math.max(0, toNumber(pInput.optionBrokerageRate, DEFAULT_CONFIG.optionBrokerageRate)),
        futuresBrokerageRate: Math.max(0, toNumber(pInput.futuresBrokerageRate, DEFAULT_CONFIG.futuresBrokerageRate)),
        minBrokeragePerOrder: Math.max(0, toNumber(pInput.minBrokeragePerOrder, DEFAULT_CONFIG.minBrokeragePerOrder)),
        entrySlippageBps: Math.max(0, toNumber(pInput.entrySlippageBps, DEFAULT_CONFIG.entrySlippageBps)),
        exitSlippageBps: Math.max(0, toNumber(pInput.exitSlippageBps, DEFAULT_CONFIG.exitSlippageBps))
    };
}
