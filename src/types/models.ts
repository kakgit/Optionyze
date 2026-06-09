export type StrategyType = "covered-call-live" | "rolling-options-pt-de" | "rolling-options-lt-de";
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
    strategyConfig?: CoveredCallConfig | Record<string, unknown>;
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
    isSurvivalAdmin: boolean;
    execStrategy: boolean;
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
    isSurvivalAdmin: boolean;
    execStrategy: boolean;
    mustChangePassword: boolean;
    createdAt: string;
    updatedAt: string;
    strategyType: StrategyType;
    capital: number;
    exchange: BrokerType | string;
    preferredSymbol: string;
    notes: string;
}

export interface PendingStrategyExecutionRecord {
    requestId: string;
    accountId: string;
    fullName: string;
    email: string;
    execStrategy: boolean;
    strategyCode: string;
    triggerSource: string;
    requestPayload: Record<string, unknown>;
    ownerServerId?: string;
    primaryOwnerServerId?: string;
    survivalOwnerServerId?: string;
    canExecuteHere?: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface PendingStrategyAutoExecSettings {
    slEnabled: boolean;
    tpEnabled: boolean;
}

export interface SessionRecord {
    sessionId: string;
    accountId: string;
    expiresAt: string;
    createdAt: string;
}

export interface SurvivalAdminRecord {
    adminId: string;
    primaryAccountId: string;
    fullName: string;
    email: string;
    passwordHash: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
    lastLoginAt: string;
}

export interface SurvivalAdminSessionRecord {
    sessionId: string;
    adminId: string;
    expiresAt: string;
    createdAt: string;
    lastSeenAt: string;
}

export interface RunnerState {
    userId: string;
    strategyType: StrategyType;
    status: "idle" | "running" | "stopped" | "error";
    updatedAt: string;
    message: string;
    state?: Record<string, unknown>;
}
