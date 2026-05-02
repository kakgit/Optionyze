export type StrategyType = "covered-call-live" | "strategy-fo-greeks-paper" | "rolling-options-pt-de" | "rolling-options-lt-de";
export type BrokerType = "delta-exchange";

export interface CoveredCallConfig {
    underlyingSymbol: "BTC" | "ETH" | string;
    lotSize: number;
    futureQty: number;
    futureOrderType: "limit_order" | "market_order";
    action: "buy" | "sell" | "none";
    legSide: "ce" | "pe" | "both";
    expiryMode: "1" | "2" | "4" | "5" | "6";
    expiryDate: string;
    optionQty: number;
    newDelta: number;
    reDelta: number;
    deltaTakeProfit: number;
    deltaStopLoss: number;
    reEnterLeg: boolean;
    addOneLotFutureIfNegativeFuture: boolean;
    optionPnl: number;
}

export interface StrategyFoGreeksPaperConfig {
    underlyingSymbol: "BTC" | "ETH" | string;
    lotSize: number;
    optionOrderType: "limit_order" | "market_order";
    futureOrderType: "limit_order" | "market_order";
    renkoFeedEnabled: boolean;
    renkoFeedStepPoints: number;
    renkoFeedPriceSource: "mark_price" | "spot_price" | "best_bid" | "best_ask";
    renkoBuyPatterns: string[];
    renkoSellPatterns: string[];
    renkoSideSwitch: "-1" | "true" | "false";
    autoTraderEnabled: boolean;
    negativeDeltaThreshold: number;
    positiveDeltaThreshold: number;
    thetaModePercent: number;
}

export interface UserRecord {
    userId: string;
    name: string;
    email: string;
    isActive: boolean;
    strategyType: StrategyType;
    capital: number;
    exchange: BrokerType | string;
    preferredSymbol?: string;
    notes?: string;
    apiKey?: string;
    apiSecret?: string;
    telegramBotToken?: string;
    telegramChatId?: string;
    strategyConfig?: CoveredCallConfig | StrategyFoGreeksPaperConfig | Record<string, unknown>;
}

export interface AccountRecord {
    accountId: string;
    fullName: string;
    email: string;
    mobileNo: string;
    telegramChatId: string;
    passwordHash: string;
    isActive: boolean;
    isAdmin: boolean;
    mustChangePassword: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface ManagedUserRecord {
    accountId: string;
    fullName: string;
    email: string;
    mobileNo: string;
    telegramChatId: string;
    isActive: boolean;
    isAdmin: boolean;
    mustChangePassword: boolean;
    createdAt: string;
    updatedAt: string;
    strategyType: StrategyType;
    capital: number;
    exchange: BrokerType | string;
    preferredSymbol: string;
    notes: string;
}

export interface SessionRecord {
    sessionId: string;
    accountId: string;
    expiresAt: string;
    createdAt: string;
}

export interface RunnerState {
    userId: string;
    strategyType: StrategyType;
    status: "idle" | "running" | "stopped" | "error";
    updatedAt: string;
    message: string;
    state?: Record<string, unknown>;
}
