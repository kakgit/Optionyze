export interface RollingOptionsPtDeConfig {
    symbol: string;
    contractName: string;
    lotSize: number;
    futureQty: number;
    futureOrderType: "limit_order" | "market_order";
    action: "buy" | "sell";
    legSide: "ce" | "pe" | "both";
    expiryMode: "1" | "2" | "4" | "5" | "6";
    expiryDate: string;
    optionQty: number;
    autoOptionQtyPct: number;
    newDelta: number;
    reDelta: number;
    deltaTakeProfit: number;
    deltaStopLoss: number;
    reEnter: boolean;
    addOneLotFuture: boolean;
    renkoEnabled: boolean;
    renkoStepPoints: number;
    renkoPriceSource: "mark_price" | "spot_price" | "best_bid" | "best_ask";
    loopSeconds: number;
}

export interface RollingOptionsPtDeRenkoState {
    anchor: number | null;
    lastDir: -1 | 0 | 1;
    lastColor: "" | "R" | "G";
}

export interface RollingOptionsPtDeMarketSnapshot {
    symbol: string;
    contractName: string;
    spotPrice: number;
    futuresPrice: number;
    priceSource: "public" | "simulated";
    ts: string;
}

export interface RollingOptionsPtDeEngineState {
    userId: string;
    running: boolean;
    isBusy: boolean;
    timerRef: NodeJS.Timeout | null;
    cycleCount: number;
    consecutiveFailures: number;
    lastError: string;
    lastCycleAt: string | null;
    renko: RollingOptionsPtDeRenkoState;
    market: {
        lastSpotPrice: number | null;
        lastFuturesPrice: number | null;
        lastSource: "public" | "simulated";
    };
}
