export interface StrategyFoGreeksPaperConfig {
    symbol: string;
    underlying: string;
    loopSeconds: number;
    targetDelta: number;
    deltaTolerance: number;
    targetAbsDeltaOption: number;
    shortPutTPDelta: number;
    shortPutSLDelta: number;
    weeklyDteMin: number;
    weeklyDteMax: number;
    biWeeklyDteMin: number;
    biWeeklyDteMax: number;
    monthlyDteMin: number;
    monthlyDteMax: number;
    gammaMaxAbs: number;
    requirePositiveTheta: boolean;
    profitExitPct: number;
    maxLossPct: number;
    maxOpenPositions: number;
    maxConsecutiveFailures: number;
    maxReentriesPerLeg: number;
    reentryCooldownCycles: number;
    slChurnPauseAfterConsecutive: number;
    slChurnPauseCycles: number;
    slChurnExtraCooldownPerSL: number;
    slChurnQtyReductionFactor: number;
    minContracts: number;
    maxContracts: number;
    maxFuturesAdjustPerCycle: number;
    futuresDeltaPerContract: number;
    optionShortMarginFactor: number;
    futuresMarginRate: number;
    optionBrokerageRate: number;
    futuresBrokerageRate: number;
    minBrokeragePerOrder: number;
    entrySlippageBps: number;
    exitSlippageBps: number;
    gammaReductionFactor: number;
}

export interface PaperPositionGreeks {
    delta: number;
    gamma: number;
    theta: number;
}

export interface PaperPosition {
    id: string;
    legType: string;
    instrumentType: "option" | "future";
    symbol: string;
    expiry: string;
    optionType: string;
    side: "buy" | "sell";
    qty: number;
    entryPrice: number;
    markPrice: number;
    entryGreeks: PaperPositionGreeks;
    currentGreeks: PaperPositionGreeks;
    openCharges: number;
    estimatedCloseCharges: number;
    totalCharges: number;
    meta: Record<string, unknown>;
    status: "OPEN" | "CLOSED";
    openedAt: string;
    closedAt: string;
    closeReason: string;
    grossRealizedPnl: number;
    realizedPnl: number;
    closePrice?: number;
    closeCharges?: number;
}

export interface StrategyFoGreeksPaperEvent {
    ts: string;
    type: string;
    message: string;
    meta: Record<string, unknown>;
}

export interface LegReentryState {
    count: number;
    cooldownUntilCycle: number;
    consecutiveSl: number;
    pauseUntilCycle: number;
}

export interface StrategyFoGreeksPaperState {
    userId: string;
    running: boolean;
    startedAt: string | null;
    stoppedAt: string | null;
    isBusy: boolean;
    timerRef: NodeJS.Timeout | null;
    cycleCount: number;
    consecutiveFailures: number;
    lastError: string;
    lastCycleAt: string | null;
    credentials: {
        apiKey: string;
        apiSecret: string;
    };
    config: StrategyFoGreeksPaperConfig;
    positions: PaperPosition[];
    closedPositions: PaperPosition[];
    reentry: Record<string, LegReentryState>;
    killSwitch: {
        enabled: boolean;
        reason: string;
    };
    events: StrategyFoGreeksPaperEvent[];
}

export interface MarketTickerSnapshot {
    symbol: string;
    spot: number;
    mark: number;
    bestBid: number | null;
    bestAsk: number | null;
}

export interface MarketOptionSnapshot {
    productId: string | number | null;
    symbol: string;
    type: "put" | "call";
    expiry: string;
    dte: number;
    strike: number | null;
    delta: number | null;
    gamma: number;
    theta: number;
    vega: number;
    bestBid: number | null;
    bestAsk: number | null;
    mark: number | null;
}

export interface MarketSnapshot {
    ticker: MarketTickerSnapshot;
    options: MarketOptionSnapshot[];
    ts: string;
}

export interface PortfolioSnapshot {
    openCount: number;
    closedCount: number;
    totalDelta: number;
    totalGamma: number;
    totalTheta: number;
    grossUnrealizedPnl: number;
    unrealizedPnl: number;
    grossRealizedPnl: number;
    realizedPnl: number;
    totalCharges: number;
    totalPnl: number;
    marginUsed: number;
    pnlOnMarginPct: number;
}

export interface RiskActions {
    closeAll: boolean;
    closeAllReason: string;
    blockNewEntries: boolean;
    gammaProtection: boolean;
    needsThetaRepair: boolean;
}

export interface StrategyFoGreeksPaperStatus {
    running: boolean;
    startedAt: string | null;
    stoppedAt: string | null;
    cycleCount: number;
    consecutiveFailures: number;
    lastError: string;
    lastCycleAt: string | null;
    killSwitch: {
        enabled: boolean;
        reason: string;
    };
    config: StrategyFoGreeksPaperConfig;
    portfolio: PortfolioSnapshot;
    openPositions: PaperPosition[];
    closedPositions: PaperPosition[];
    events: StrategyFoGreeksPaperEvent[];
}

export interface StartPaperEngineInput {
    userId: string;
    apiKey: string;
    apiSecret: string;
    config?: Partial<StrategyFoGreeksPaperConfig>;
}
