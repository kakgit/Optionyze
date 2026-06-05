export interface DirectionalOptionsDemoConfig {
    symbol: "BTCUSD" | "ETHUSD";
    underlying: "BTC" | "ETH";
    presetKey: string;
    loopSeconds: number;
    targetAbsDelta: number;
    entryDteMin: number;
    entryDteMax: number;
    baseContracts: number;
    maxContracts: number;
    bullishThreshold: number;
    bearishThreshold: number;
    minConfidence: number;
    takeProfitPct: number;
    stopLossPct: number;
    maxHoldCycles: number;
    cooldownCycles: number;
    emaFastPeriod: number;
    emaSlowPeriod: number;
    rsiPeriod: number;
    slopeLookback: number;
    neutralExitCycles: number;
    requireEmaAlignment: boolean;
    requireRsiConfirmation: boolean;
    preferredRegime: "trend" | "breakout" | "any";
    minVolatilityPct: number;
    maxSessionProfit: number;
    maxSessionLoss: number;
    maxConsecutiveLosses: number;
}

export interface DirectionalSignalMetrics {
    emaFast: number;
    emaSlow: number;
    rsi: number;
    slopePct: number;
    volatilityPct: number;
    bullishScore: number;
    bearishScore: number;
    confidence: number;
    bias: "bullish" | "bearish" | "neutral";
    regime: "trend" | "breakout" | "balanced" | "fade";
    drivers: string[];
    blockers: string[];
    suggestedAction: "buy_call" | "buy_put" | "wait";
}

export interface DirectionalOptionsDemoPosition {
    id: string;
    symbol: string;
    optionType: "call" | "put";
    side: "buy";
    qty: number;
    entryPrice: number;
    markPrice: number;
    closePrice: number | null;
    takeProfitPct: number;
    stopLossPct: number;
    confidenceAtEntry: number;
    biasAtEntry: "bullish" | "bearish";
    regimeAtEntry: string;
    entryDelta: number;
    currentDelta: number;
    entryDte: number;
    currentDte: number;
    realizedPnl: number;
    unrealizedPnl: number;
    status: "OPEN" | "CLOSED";
    openedAt: string;
    closedAt: string | null;
    openedCycle: number;
    closedCycle: number | null;
    closeReason: string;
}

export interface DirectionalOptionsDemoEvent {
    ts: string;
    type: string;
    title: string;
    message: string;
}

export interface DirectionalOptionsDemoState {
    userId: string;
    selectedApiProfileId: string;
    profileLabel: string;
    running: boolean;
    isBusy: boolean;
    timerRef: NodeJS.Timeout | null;
    cycleCount: number;
    startedAt: string | null;
    stoppedAt: string | null;
    lastCycleAt: string | null;
    lastError: string;
    apiKey: string;
    apiSecret: string;
    config: DirectionalOptionsDemoConfig;
    priceHistory: number[];
    openPositions: DirectionalOptionsDemoPosition[];
    closedPositions: DirectionalOptionsDemoPosition[];
    events: DirectionalOptionsDemoEvent[];
    lastSignal: DirectionalSignalMetrics | null;
    latestTicker: {
        symbol: string;
        spot: number;
        mark: number;
        bestBid: number | null;
        bestAsk: number | null;
        ts: string;
    } | null;
    cooldownUntilCycle: number;
    equityCurve: Array<{
        ts: string;
        totalPnl: number;
        realizedPnl: number;
        unrealizedPnl: number;
    }>;
}

export interface DirectionalOptionsDemoStatus {
    running: boolean;
    selectedApiProfileId: string;
    profileLabel: string;
    cycleCount: number;
    startedAt: string | null;
    stoppedAt: string | null;
    lastCycleAt: string | null;
    lastError: string;
    config: DirectionalOptionsDemoConfig;
    latestTicker: DirectionalOptionsDemoState["latestTicker"];
    lastSignal: DirectionalSignalMetrics | null;
    openPositions: DirectionalOptionsDemoPosition[];
    closedPositions: DirectionalOptionsDemoPosition[];
    events: DirectionalOptionsDemoEvent[];
    equityCurve: DirectionalOptionsDemoState["equityCurve"];
    guidance: {
        shouldStart: boolean;
        shouldStop: boolean;
        modeLabel: string;
        startSummary: string;
        stopSummary: string;
        checklist: string[];
    };
    totals: {
        openCount: number;
        closedCount: number;
        unrealizedPnl: number;
        realizedPnl: number;
        totalPnl: number;
        winningTrades: number;
        losingTrades: number;
        winRatePct: number;
        avgWin: number;
        avgLoss: number;
        bestTrade: number;
        worstTrade: number;
    };
}
