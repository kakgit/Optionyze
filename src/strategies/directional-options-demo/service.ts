import crypto from "node:crypto";
import { getDeltaApiProfile } from "../../storage/delta-api-profile-store";
import {
    deleteDirectionalOptionsDemoState,
    loadDirectionalOptionsDemoStates,
    saveDirectionalOptionsDemoState
} from "../../storage/directional-options-demo-store";
import { fetchSnapshot, selectOptionByDteDelta } from "./market-data";
import type { DirectionalMarketOptionSnapshot as MarketOptionSnapshot, DirectionalMarketSnapshot as MarketSnapshot } from "./market-data";
import type {
    DirectionalOptionsDemoConfig,
    DirectionalOptionsDemoEvent,
    DirectionalOptionsDemoPosition,
    DirectionalOptionsDemoState,
    DirectionalOptionsDemoStatus,
    DirectionalSignalMetrics
} from "./types";

function clampNumber(value: unknown, min: number, max: number, fallbackValue: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return fallbackValue;
    }
    return Math.max(min, Math.min(max, parsed));
}

function average(values: number[]): number {
    if (!values.length) {
        return 0;
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function calcEma(values: number[], period: number): number {
    if (!values.length) {
        return 0;
    }
    const alpha = 2 / (Math.max(1, period) + 1);
    let ema = values[0];
    for (let index = 1; index < values.length; index += 1) {
        ema = (values[index] * alpha) + (ema * (1 - alpha));
    }
    return ema;
}

function calcRsi(values: number[], period: number): number {
    if (values.length < period + 1) {
        return 50;
    }
    let gains = 0;
    let losses = 0;
    const startIndex = values.length - period;
    for (let index = startIndex; index < values.length; index += 1) {
        const change = values[index] - values[index - 1];
        if (change >= 0) {
            gains += change;
        }
        else {
            losses += Math.abs(change);
        }
    }
    if (losses === 0) {
        return gains === 0 ? 50 : 100;
    }
    const rs = gains / losses;
    return 100 - (100 / (1 + rs));
}

function addEvent(state: DirectionalOptionsDemoState, type: string, title: string, message: string): void {
    const event: DirectionalOptionsDemoEvent = {
        ts: new Date().toISOString(),
        type,
        title,
        message
    };
    state.events.unshift(event);
    state.events = state.events.slice(0, 100);
}

function buildDefaultConfig(): DirectionalOptionsDemoConfig {
    return {
        symbol: "BTCUSD",
        underlying: "BTC",
        presetKey: "btc_scalper",
        loopSeconds: 8,
        targetAbsDelta: 0.28,
        entryDteMin: 1,
        entryDteMax: 5,
        baseContracts: 1,
        maxContracts: 1,
        bullishThreshold: 5,
        bearishThreshold: 5,
        minConfidence: 70,
        takeProfitPct: 8,
        stopLossPct: 5,
        maxHoldCycles: 3,
        cooldownCycles: 2,
        emaFastPeriod: 4,
        emaSlowPeriod: 9,
        rsiPeriod: 6,
        slopeLookback: 3,
        neutralExitCycles: 1,
        requireEmaAlignment: true,
        requireRsiConfirmation: true,
        preferredRegime: "any",
        minVolatilityPct: 0.2,
        maxSessionProfit: 60,
        maxSessionLoss: 35,
        maxConsecutiveLosses: 3
    };
}

function normalizeConfig(input?: Partial<DirectionalOptionsDemoConfig>): DirectionalOptionsDemoConfig {
    const defaults = buildDefaultConfig();
    const symbol = String(input?.symbol || defaults.symbol).trim().toUpperCase() === "ETHUSD" ? "ETHUSD" : "BTCUSD";
    const preferredRegime = String(input?.preferredRegime || defaults.preferredRegime).trim().toLowerCase();
    return {
        symbol,
        underlying: symbol === "ETHUSD" ? "ETH" : "BTC",
        presetKey: String(input?.presetKey || defaults.presetKey || "custom").trim() || "custom",
        loopSeconds: clampNumber(input?.loopSeconds, 5, 300, defaults.loopSeconds),
        targetAbsDelta: clampNumber(input?.targetAbsDelta, 0.05, 0.9, defaults.targetAbsDelta),
        entryDteMin: clampNumber(input?.entryDteMin, 1, 60, defaults.entryDteMin),
        entryDteMax: clampNumber(input?.entryDteMax, 1, 90, defaults.entryDteMax),
        baseContracts: clampNumber(input?.baseContracts, 1, 20, defaults.baseContracts),
        maxContracts: clampNumber(input?.maxContracts, 1, 50, defaults.maxContracts),
        bullishThreshold: clampNumber(input?.bullishThreshold, 1, 10, defaults.bullishThreshold),
        bearishThreshold: clampNumber(input?.bearishThreshold, 1, 10, defaults.bearishThreshold),
        minConfidence: clampNumber(input?.minConfidence, 1, 100, defaults.minConfidence),
        takeProfitPct: clampNumber(input?.takeProfitPct, 1, 200, defaults.takeProfitPct),
        stopLossPct: clampNumber(input?.stopLossPct, 1, 100, defaults.stopLossPct),
        maxHoldCycles: clampNumber(input?.maxHoldCycles, 1, 100, defaults.maxHoldCycles),
        cooldownCycles: clampNumber(input?.cooldownCycles, 0, 50, defaults.cooldownCycles),
        emaFastPeriod: clampNumber(input?.emaFastPeriod, 2, 50, defaults.emaFastPeriod),
        emaSlowPeriod: clampNumber(input?.emaSlowPeriod, 3, 100, defaults.emaSlowPeriod),
        rsiPeriod: clampNumber(input?.rsiPeriod, 2, 50, defaults.rsiPeriod),
        slopeLookback: clampNumber(input?.slopeLookback, 1, 30, defaults.slopeLookback),
        neutralExitCycles: clampNumber(input?.neutralExitCycles, 1, 50, defaults.neutralExitCycles),
        requireEmaAlignment: input?.requireEmaAlignment !== false,
        requireRsiConfirmation: Boolean(input?.requireRsiConfirmation),
        preferredRegime: preferredRegime === "trend" || preferredRegime === "range" ? preferredRegime : "any",
        minVolatilityPct: clampNumber(input?.minVolatilityPct, 0, 10, defaults.minVolatilityPct),
        maxSessionProfit: clampNumber(input?.maxSessionProfit, 1, 1000000, defaults.maxSessionProfit),
        maxSessionLoss: clampNumber(input?.maxSessionLoss, 1, 1000000, defaults.maxSessionLoss),
        maxConsecutiveLosses: clampNumber(input?.maxConsecutiveLosses, 1, 20, defaults.maxConsecutiveLosses)
    };
}

function createInitialState(userId: string): DirectionalOptionsDemoState {
    return {
        userId,
        selectedApiProfileId: "",
        profileLabel: "",
        running: false,
        isBusy: false,
        timerRef: null,
        cycleCount: 0,
        startedAt: null,
        stoppedAt: null,
        lastCycleAt: null,
        lastError: "",
        apiKey: "",
        apiSecret: "",
        config: buildDefaultConfig(),
        priceHistory: [],
        openPositions: [],
        closedPositions: [],
        events: [],
        lastSignal: null,
        latestTicker: null,
        cooldownUntilCycle: 0,
        equityCurve: []
    };
}

function toFetchSnapshotConfig(config: DirectionalOptionsDemoConfig): DirectionalOptionsDemoConfig {
    return config;
}

function getLongEntryPrice(option: MarketOptionSnapshot): number {
    return Number.isFinite(Number(option.bestAsk)) && Number(option.bestAsk) > 0
        ? Number(option.bestAsk)
        : Number(option.mark || 0);
}

function getLongExitPrice(option: MarketOptionSnapshot): number {
    return Number.isFinite(Number(option.bestBid)) && Number(option.bestBid) > 0
        ? Number(option.bestBid)
        : Number(option.mark || 0);
}

function getShortEntryPrice(option: MarketOptionSnapshot): number {
    return Number.isFinite(Number(option.bestBid)) && Number(option.bestBid) > 0
        ? Number(option.bestBid)
        : Number(option.mark || 0);
}

function getShortExitPrice(option: MarketOptionSnapshot): number {
    return Number.isFinite(Number(option.bestAsk)) && Number(option.bestAsk) > 0
        ? Number(option.bestAsk)
        : Number(option.mark || 0);
}

function getEntryPrice(option: MarketOptionSnapshot, side: "buy" | "sell"): number {
    return side === "sell" ? getShortEntryPrice(option) : getLongEntryPrice(option);
}

function getExitPrice(option: MarketOptionSnapshot, side: "buy" | "sell"): number {
    return side === "sell" ? getShortExitPrice(option) : getLongExitPrice(option);
}

function calculatePositionPnl(side: "buy" | "sell", entryPrice: number, exitPrice: number, qty: number): number {
    const signedMove = side === "sell"
        ? (entryPrice - exitPrice)
        : (exitPrice - entryPrice);
    return signedMove * qty;
}

function getPositionActionKey(position: Pick<DirectionalOptionsDemoPosition, "side" | "optionType">): string {
    return `${position.side}_${position.optionType}`;
}

function getSignalActionKey(signal: Pick<DirectionalSignalMetrics, "suggestedAction">): string {
    return String(signal.suggestedAction || "wait");
}

function updateOpenMarks(state: DirectionalOptionsDemoState, snapshot: MarketSnapshot): void {
    const optionsBySymbol = new Map<string, MarketOptionSnapshot>();
    snapshot.options.forEach((option) => {
        optionsBySymbol.set(option.symbol, option);
    });
    state.openPositions.forEach((position) => {
        if (position.status !== "OPEN") {
            return;
        }
        const option = optionsBySymbol.get(position.symbol);
        if (!option) {
            return;
        }
        position.markPrice = getExitPrice(option, position.side);
        position.currentDelta = Number(option.delta || 0);
        position.currentDte = Number(option.dte || position.currentDte || 0);
        position.unrealizedPnl = calculatePositionPnl(position.side, position.entryPrice, position.markPrice, position.qty);
    });
}

function computeSignal(history: number[], snapshot: MarketSnapshot, config: DirectionalOptionsDemoConfig): DirectionalSignalMetrics {
    const latest = Number(snapshot.ticker.mark || snapshot.ticker.spot || 0);
    const fastEma = calcEma(history, config.emaFastPeriod);
    const slowEma = calcEma(history, config.emaSlowPeriod);
    const rsi = calcRsi(history, config.rsiPeriod);
    const slopeBase = history.length > config.slopeLookback
        ? history[Math.max(0, history.length - 1 - config.slopeLookback)]
        : latest;
    const slopePct = slopeBase > 0 ? ((latest - slopeBase) / slopeBase) * 100 : 0;
    const changes: number[] = [];
    for (let index = 1; index < history.length; index += 1) {
        const previous = history[index - 1];
        const current = history[index];
        if (previous > 0) {
            changes.push(((current - previous) / previous) * 100);
        }
    }
    const volatilityPct = average(changes.slice(-10).map((value) => Math.abs(value)));

    let bullishScore = 0;
    let bearishScore = 0;
    const drivers: string[] = [];
    const blockers: string[] = [];

    if (fastEma > slowEma) {
        bullishScore += 2;
        drivers.push("Fast EMA is above slow EMA.");
    }
    else if (fastEma < slowEma) {
        bearishScore += 2;
        drivers.push("Fast EMA is below slow EMA.");
    }

    if (latest > fastEma) {
        bullishScore += 1;
    }
    else if (latest < fastEma) {
        bearishScore += 1;
    }

    if (slopePct >= 0.35) {
        bullishScore += 2;
        drivers.push(`Short-term slope is positive at ${slopePct.toFixed(2)}%.`);
    }
    else if (slopePct <= -0.35) {
        bearishScore += 2;
        drivers.push(`Short-term slope is negative at ${slopePct.toFixed(2)}%.`);
    }

    if (rsi >= 58) {
        bullishScore += rsi >= 66 ? 2 : 1;
        drivers.push(`RSI supports upside at ${rsi.toFixed(1)}.`);
    }
    else if (rsi <= 42) {
        bearishScore += rsi <= 34 ? 2 : 1;
        drivers.push(`RSI supports downside at ${rsi.toFixed(1)}.`);
    }

    let trendScore = 0;
    let rangeScore = 0;
    const emaSpreadPct = latest > 0 ? (Math.abs(fastEma - slowEma) / latest) * 100 : 0;
    const absSlopePct = Math.abs(slopePct);

    if (emaSpreadPct >= 0.18) {
        trendScore += emaSpreadPct >= 0.32 ? 2 : 1;
    }
    else {
        rangeScore += 1;
    }
    if (absSlopePct >= 0.24) {
        trendScore += absSlopePct >= 0.42 ? 2 : 1;
    }
    else {
        rangeScore += 1;
    }
    if (volatilityPct >= Math.max(config.minVolatilityPct, 0.2)) {
        trendScore += volatilityPct >= 0.38 ? 2 : 1;
    }
    else if (volatilityPct <= Math.max(0.08, config.minVolatilityPct * 0.9)) {
        rangeScore += 2;
    }
    else {
        rangeScore += 1;
    }
    if (rsi >= 65 || rsi <= 35) {
        rangeScore += 1;
    }

    let regime: "trend" | "range" | "unclear" = "unclear";
    if (trendScore >= rangeScore + 2) {
        regime = "trend";
    }
    else if (rangeScore >= trendScore + 3) {
        regime = "range";
    }

    if (regime === "trend") {
        if (slopePct > 0) {
            bullishScore += 1;
        }
        else if (slopePct < 0) {
            bearishScore += 1;
        }
    }
    else if (regime === "range") {
        if (rsi <= 35) {
            bullishScore += rsi <= 30 ? 3 : 2;
            drivers.push(`Range bounce setup forming with RSI ${rsi.toFixed(1)} near the lower edge.`);
        }
        else if (rsi >= 65) {
            bearishScore += rsi >= 70 ? 3 : 2;
            drivers.push(`Range fade setup forming with RSI ${rsi.toFixed(1)} near the upper edge.`);
        }
        else {
            blockers.push("Range regime detected, but price is not stretched enough for a clean fade.");
        }
    }

    const edge = Math.abs(bullishScore - bearishScore);
    const totalScore = bullishScore + bearishScore;
    const confidence = totalScore > 0 ? Math.min(100, Math.round((edge / Math.max(1, totalScore + 2)) * 100)) : 0;
    let bias: "bullish" | "bearish" | "neutral" = "neutral";
    if (bullishScore >= config.bullishThreshold && bullishScore > bearishScore) {
        bias = "bullish";
    }
    else if (bearishScore >= config.bearishThreshold && bearishScore > bullishScore) {
        bias = "bearish";
    }

    if (config.requireEmaAlignment && regime === "trend") {
        if (bias === "bullish" && fastEma <= slowEma) {
            blockers.push("Bullish setup blocked because EMA alignment is missing.");
        }
        if (bias === "bearish" && fastEma >= slowEma) {
            blockers.push("Bearish setup blocked because EMA alignment is missing.");
        }
    }
    if (config.requireRsiConfirmation && regime === "trend") {
        if (bias === "bullish" && rsi < 55) {
            blockers.push("Bullish setup blocked because RSI confirmation is missing.");
        }
        if (bias === "bearish" && rsi > 45) {
            blockers.push("Bearish setup blocked because RSI confirmation is missing.");
        }
    }
    if (config.preferredRegime !== "any" && bias !== "neutral" && regime !== config.preferredRegime) {
        blockers.push(`Preferred regime is ${config.preferredRegime}, but market is ${regime}.`);
    }
    if (regime === "trend" && volatilityPct < config.minVolatilityPct) {
        blockers.push(`Volatility ${volatilityPct.toFixed(3)}% is below the scalper floor ${config.minVolatilityPct.toFixed(3)}%.`);
    }
    if (confidence < config.minConfidence) {
        blockers.push(`Confidence ${confidence}% is below required ${config.minConfidence}%.`);
    }
    if (bias === "neutral") {
        blockers.push("No directional edge yet.");
    }
    if (regime === "unclear") {
        blockers.push("Regime is unclear. Wait for either trend expansion or a cleaner range edge.");
    }
    if (regime === "range" && confidence < Math.max(config.minConfidence, 72)) {
        blockers.push(`Range confidence ${confidence}% is below the stricter range requirement ${Math.max(config.minConfidence, 72)}%.`);
    }

    let suggestedAction: DirectionalSignalMetrics["suggestedAction"] = "wait";
    let tradeStyle: DirectionalSignalMetrics["tradeStyle"] = "wait";
    if (regime === "trend") {
        if (bias === "bullish") {
            suggestedAction = "buy_call";
            tradeStyle = "buy_option";
        }
        else if (bias === "bearish") {
            suggestedAction = "buy_put";
            tradeStyle = "buy_option";
        }
    }
    else if (regime === "range") {
        if (bias === "bullish") {
            suggestedAction = "sell_put";
            tradeStyle = "sell_option";
        }
        else if (bias === "bearish") {
            suggestedAction = "sell_call";
            tradeStyle = "sell_option";
        }
    }

    return {
        emaFast: Number(fastEma.toFixed(2)),
        emaSlow: Number(slowEma.toFixed(2)),
        rsi: Number(rsi.toFixed(2)),
        slopePct: Number(slopePct.toFixed(3)),
        volatilityPct: Number(volatilityPct.toFixed(3)),
        bullishScore,
        bearishScore,
        trendScore,
        rangeScore,
        confidence,
        bias,
        regime,
        drivers,
        blockers,
        suggestedAction,
        tradeStyle
    };
}

function closePosition(state: DirectionalOptionsDemoState, position: DirectionalOptionsDemoPosition, exitPrice: number, reason: string): void {
    position.status = "CLOSED";
    position.closePrice = exitPrice;
    position.closedAt = new Date().toISOString();
    position.closedCycle = state.cycleCount;
    position.closeReason = reason;
    position.realizedPnl = calculatePositionPnl(position.side, position.entryPrice, exitPrice, position.qty);
    position.unrealizedPnl = 0;
    state.closedPositions.unshift({ ...position });
    state.closedPositions = state.closedPositions.slice(0, 200);
    addEvent(state, "EXIT", position.symbol, `Closed ${position.side.toUpperCase()} ${position.optionType.toUpperCase()} paper trade because ${reason}.`);
}

function canEnterTrade(state: DirectionalOptionsDemoState, signal: DirectionalSignalMetrics): boolean {
    if (signal.bias === "neutral" || signal.confidence < state.config.minConfidence || signal.regime === "unclear") {
        return false;
    }
    if (state.config.preferredRegime !== "any" && signal.regime !== state.config.preferredRegime) {
        return false;
    }
    if (signal.regime === "trend" && signal.volatilityPct < state.config.minVolatilityPct) {
        return false;
    }
    if (state.config.requireEmaAlignment && signal.regime === "trend") {
        if (signal.bias === "bullish" && signal.emaFast <= signal.emaSlow) {
            return false;
        }
        if (signal.bias === "bearish" && signal.emaFast >= signal.emaSlow) {
            return false;
        }
    }
    if (state.config.requireRsiConfirmation && signal.regime === "trend") {
        if (signal.bias === "bullish" && signal.rsi < 55) {
            return false;
        }
        if (signal.bias === "bearish" && signal.rsi > 45) {
            return false;
        }
    }
    if (signal.regime === "range") {
        if (signal.rangeScore < signal.trendScore + 3) {
            return false;
        }
        if (signal.confidence < Math.max(state.config.minConfidence, 72)) {
            return false;
        }
        if (!(signal.rsi <= 35 || signal.rsi >= 65)) {
            return false;
        }
    }
    return true;
}

function shouldBlockRecentRangeReentry(state: DirectionalOptionsDemoState, signal: DirectionalSignalMetrics): boolean {
    if (signal.regime !== "range") {
        return false;
    }
    const lastClosed = state.closedPositions[0];
    if (!lastClosed) {
        return false;
    }
    const isChurnExit = lastClosed.closeReason === "signal turned neutral" || lastClosed.closeReason === "max hold cycles reached";
    if (!isChurnExit) {
        return false;
    }
    const sameAction = getPositionActionKey(lastClosed) === getSignalActionKey(signal);
    if (!sameAction) {
        return false;
    }
    const cyclesSinceClose = state.cycleCount - Number(lastClosed.closedCycle || 0);
    if (cyclesSinceClose > Math.max(3, state.config.cooldownCycles + 1)) {
        return false;
    }
    return signal.confidence < Math.max(state.config.minConfidence + 6, Number(lastClosed.confidenceAtEntry || 0) + 4);
}

function maybeClosePositions(state: DirectionalOptionsDemoState, signal: DirectionalSignalMetrics, snapshot: MarketSnapshot): void {
    const optionsBySymbol = new Map<string, MarketOptionSnapshot>();
    snapshot.options.forEach((option) => optionsBySymbol.set(option.symbol, option));
    const remainingOpen: DirectionalOptionsDemoPosition[] = [];
    for (const position of state.openPositions) {
        if (position.status !== "OPEN") {
            continue;
        }
        const option = optionsBySymbol.get(position.symbol);
        const exitPrice = option ? getExitPrice(option, position.side) : position.markPrice;
        const realizedMove = calculatePositionPnl(position.side, position.entryPrice, exitPrice, 1);
        const pnlPct = position.entryPrice > 0 ? (realizedMove / position.entryPrice) * 100 : 0;
        const heldCycles = state.cycleCount - position.openedCycle;

        if (pnlPct >= position.takeProfitPct) {
            closePosition(state, position, exitPrice, `take profit ${pnlPct.toFixed(2)}%`);
            state.cooldownUntilCycle = state.cycleCount + state.config.cooldownCycles;
            continue;
        }
        if (pnlPct <= -position.stopLossPct) {
            closePosition(state, position, exitPrice, `stop loss ${pnlPct.toFixed(2)}%`);
            state.cooldownUntilCycle = state.cycleCount + state.config.cooldownCycles;
            continue;
        }
        if (heldCycles >= state.config.maxHoldCycles) {
            closePosition(state, position, exitPrice, "max hold cycles reached");
            state.cooldownUntilCycle = state.cycleCount + (position.side === "sell" ? Math.max(2, state.config.cooldownCycles + 1) : 1);
            continue;
        }
        if (signal.bias === "neutral" && heldCycles >= state.config.neutralExitCycles) {
            closePosition(state, position, exitPrice, "signal turned neutral");
            state.cooldownUntilCycle = state.cycleCount + (position.side === "sell" ? Math.max(2, state.config.cooldownCycles + 2) : 1);
            continue;
        }
        const currentAction = signal.suggestedAction;
        const desiredAction = getPositionActionKey(position) as DirectionalSignalMetrics["suggestedAction"];
        if (signal.confidence >= state.config.minConfidence && currentAction !== "wait" && desiredAction !== currentAction) {
            closePosition(state, position, exitPrice, "signal rotated to a different trade style");
            state.cooldownUntilCycle = state.cycleCount + 1;
            continue;
        }
        if (signal.regime !== "unclear" && position.regimeAtEntry !== signal.regime && heldCycles >= 1) {
            closePosition(state, position, exitPrice, "market regime changed");
            state.cooldownUntilCycle = state.cycleCount + 1;
            continue;
        }
        position.markPrice = exitPrice;
        position.unrealizedPnl = calculatePositionPnl(position.side, position.entryPrice, position.markPrice, position.qty);
        remainingOpen.push(position);
    }
    state.openPositions = remainingOpen;
}

function maybeOpenPosition(state: DirectionalOptionsDemoState, signal: DirectionalSignalMetrics, snapshot: MarketSnapshot): void {
    if (!canEnterTrade(state, signal)) {
        return;
    }
    if (state.openPositions.some((position) => position.status === "OPEN")) {
        return;
    }
    if (state.cycleCount < state.cooldownUntilCycle) {
        return;
    }

    const suggestedAction = signal.suggestedAction;
    if (suggestedAction === "wait") {
        return;
    }
    if (shouldBlockRecentRangeReentry(state, signal)) {
        addEvent(state, "SKIP", "Range re-entry blocked", `Skipped ${suggestedAction.replaceAll("_", " ").toUpperCase()} because the last similar range trade exited too recently without stronger signal improvement.`);
        return;
    }
    const optionType = suggestedAction.endsWith("put") ? "put" : "call";
    const side = suggestedAction.startsWith("sell") ? "sell" : "buy";
    const selected = selectOptionByDteDelta(snapshot.options, {
        type: optionType,
        dteMin: state.config.entryDteMin,
        dteMax: state.config.entryDteMax,
        targetAbsDelta: state.config.targetAbsDelta
    });
    if (!selected) {
        addEvent(state, "SKIP", "No contract", `No ${optionType.toUpperCase()} option matched the configured delta and DTE window.`);
        return;
    }
    const entryPrice = getEntryPrice(selected, side);
    if (!(entryPrice > 0)) {
        addEvent(state, "SKIP", "Bad price", `Selected ${selected.symbol} has no valid entry price.`);
        return;
    }
    const qtyBoost = signal.confidence >= 80 ? 1 : 0;
    const qty = Math.max(state.config.baseContracts, Math.min(state.config.maxContracts, state.config.baseContracts + qtyBoost));
    const position: DirectionalOptionsDemoPosition = {
        id: crypto.randomUUID(),
        symbol: selected.symbol,
        optionType,
        side,
        qty,
        entryPrice,
        markPrice: getExitPrice(selected, side),
        closePrice: null,
        takeProfitPct: state.config.takeProfitPct,
        stopLossPct: state.config.stopLossPct,
        confidenceAtEntry: signal.confidence,
        biasAtEntry: optionType === "call" ? "bullish" : "bearish",
        regimeAtEntry: signal.regime,
        entryDelta: Number(selected.delta || 0),
        currentDelta: Number(selected.delta || 0),
        entryDte: Number(selected.dte || 0),
        currentDte: Number(selected.dte || 0),
        realizedPnl: 0,
        unrealizedPnl: 0,
        status: "OPEN",
        openedAt: new Date().toISOString(),
        closedAt: null,
        openedCycle: state.cycleCount,
        closedCycle: null,
        closeReason: ""
    };
    position.unrealizedPnl = calculatePositionPnl(position.side, position.entryPrice, position.markPrice, position.qty);
    state.openPositions.push(position);
    addEvent(state, "ENTRY", position.symbol, `Opened ${side.toUpperCase()} ${optionType.toUpperCase()} paper scalp at ${entryPrice.toFixed(2)} with confidence ${signal.confidence}% in ${signal.regime} regime.`);
}

function flattenOpenPositionsForGuardrail(state: DirectionalOptionsDemoState, reason: string): void {
    if (!state.openPositions.length) {
        return;
    }
    const currentOpen = [...state.openPositions];
    state.openPositions = [];
    currentOpen.forEach((position) => {
        if (position.status !== "OPEN") {
            return;
        }
        closePosition(state, position, Number(position.markPrice || position.entryPrice || 0), reason);
    });
}

function calculateTotals(state: DirectionalOptionsDemoState): DirectionalOptionsDemoStatus["totals"] {
    const unrealizedPnl = state.openPositions.reduce((sum, position) => sum + Number(position.unrealizedPnl || 0), 0);
    const realizedPnl = state.closedPositions.reduce((sum, position) => sum + Number(position.realizedPnl || 0), 0);
    const winningTrades = state.closedPositions.filter((position) => Number(position.realizedPnl || 0) > 0).length;
    const losingTrades = state.closedPositions.filter((position) => Number(position.realizedPnl || 0) < 0).length;
    const closedTrades = winningTrades + losingTrades;
    const bestTrade = state.closedPositions.length
        ? Math.max(...state.closedPositions.map((position) => Number(position.realizedPnl || 0)))
        : 0;
    const worstTrade = state.closedPositions.length
        ? Math.min(...state.closedPositions.map((position) => Number(position.realizedPnl || 0)))
        : 0;
    const avgWin = winningTrades
        ? state.closedPositions
            .filter((position) => Number(position.realizedPnl || 0) > 0)
            .reduce((sum, position) => sum + Number(position.realizedPnl || 0), 0) / winningTrades
        : 0;
    const avgLoss = losingTrades
        ? state.closedPositions
            .filter((position) => Number(position.realizedPnl || 0) < 0)
            .reduce((sum, position) => sum + Number(position.realizedPnl || 0), 0) / losingTrades
        : 0;

    return {
        openCount: state.openPositions.length,
        closedCount: state.closedPositions.length,
        unrealizedPnl: Number(unrealizedPnl.toFixed(2)),
        realizedPnl: Number(realizedPnl.toFixed(2)),
        totalPnl: Number((unrealizedPnl + realizedPnl).toFixed(2)),
        winningTrades,
        losingTrades,
        winRatePct: Number((closedTrades > 0 ? (winningTrades / closedTrades) * 100 : 0).toFixed(2)),
        avgWin: Number(avgWin.toFixed(2)),
        avgLoss: Number(avgLoss.toFixed(2)),
        bestTrade: Number(bestTrade.toFixed(2)),
        worstTrade: Number(worstTrade.toFixed(2))
    };
}

function countConsecutiveLosses(state: DirectionalOptionsDemoState): number {
    let losses = 0;
    for (const position of state.closedPositions) {
        if (Number(position.realizedPnl || 0) < 0) {
            losses += 1;
            continue;
        }
        break;
    }
    return losses;
}

function appendEquityPoint(state: DirectionalOptionsDemoState): void {
    const totals = calculateTotals(state);
    state.equityCurve.push({
        ts: new Date().toISOString(),
        totalPnl: totals.totalPnl,
        realizedPnl: totals.realizedPnl,
        unrealizedPnl: totals.unrealizedPnl
    });
    state.equityCurve = state.equityCurve.slice(-160);
}

function buildGuidance(state: DirectionalOptionsDemoState): DirectionalOptionsDemoStatus["guidance"] {
    const signal = state.lastSignal;
    const totals = calculateTotals(state);
    const consecutiveLosses = countConsecutiveLosses(state);
    const realizedPnl = Number(totals.realizedPnl || 0);
    const guardrailReason = realizedPnl >= state.config.maxSessionProfit
        ? `Session target hit at realized PnL ${realizedPnl.toFixed(2)}.`
        : (realizedPnl <= (-1 * state.config.maxSessionLoss)
            ? `Session loss limit hit at realized PnL ${realizedPnl.toFixed(2)}.`
            : (consecutiveLosses >= state.config.maxConsecutiveLosses
                ? `${consecutiveLosses} consecutive losing scalps reached.`
                : ""));
    const shouldStop = Boolean(guardrailReason) || Boolean(state.lastError);
    const shouldStart = Boolean(signal)
        && !shouldStop
        && (signal ? canEnterTrade(state, signal) : false)
        && state.openPositions.length === 0
        && state.cycleCount >= state.cooldownUntilCycle;

    const checklist: string[] = [];
    checklist.push(`Preset: ${state.config.presetKey.replaceAll("_", " ").toUpperCase()}`);
    checklist.push(`Confidence gate: ${state.config.minConfidence}%`);
    checklist.push(`Regime gate: ${state.config.preferredRegime === "any" ? "trend or range accepted" : state.config.preferredRegime}`);
    checklist.push(`Volatility floor: ${state.config.minVolatilityPct.toFixed(3)}%`);
    checklist.push(`Session stop rules use realized PnL: +${state.config.maxSessionProfit} / -${state.config.maxSessionLoss} / ${state.config.maxConsecutiveLosses} losses`);
    checklist.push("Trend regime buys options. Range regime sells options. Unclear regime waits.");

    return {
        shouldStart,
        shouldStop,
        modeLabel: "Regime-Aware Scalper",
        startSummary: shouldStart && signal
            ? `Start now. ${signal.bias.toUpperCase()} bias with ${signal.confidence}% confidence in ${signal.regime} regime using ${signal.tradeStyle.replaceAll("_", " ")} flow.`
            : (signal
                ? `Wait. ${signal.regime === "unclear" ? "Regime is unclear." : (signal.bias === "neutral" ? "Bias is neutral." : `Need cleaner ${signal.bias} follow-through before starting.`)}`
                : "Wait for live rates and signal build-up before starting."),
        stopSummary: shouldStop
            ? (state.lastError ? `Stop now. Engine error: ${state.lastError}` : `Stop now. ${guardrailReason}`)
            : "Keep running while the session guardrails stay intact.",
        checklist
    };
}

export class DirectionalOptionsDemoService {
    private readonly stateByUserId = new Map<string, DirectionalOptionsDemoState>();

    private getOrCreateState(userId: string): DirectionalOptionsDemoState {
        const finalUserId = String(userId || "").trim() || "demo-paper";
        let state = this.stateByUserId.get(finalUserId);
        if (!state) {
            state = createInitialState(finalUserId);
            this.stateByUserId.set(finalUserId, state);
        }
        return state;
    }

    private startInterval(state: DirectionalOptionsDemoState): void {
        if (state.timerRef) {
            clearInterval(state.timerRef);
        }
        state.timerRef = setInterval(() => {
            void this.runTick(state);
        }, state.config.loopSeconds * 1000);
    }

    private async stopState(state: DirectionalOptionsDemoState, reason: string): Promise<void> {
        if (state.timerRef) {
            clearInterval(state.timerRef);
            state.timerRef = null;
        }
        if (state.running) {
            state.running = false;
            state.stoppedAt = new Date().toISOString();
            addEvent(state, "ENGINE", "Stopped", reason);
        }
    }

    private async persistState(state: DirectionalOptionsDemoState): Promise<void> {
        await saveDirectionalOptionsDemoState(state);
    }

    private async applySessionGuardrails(state: DirectionalOptionsDemoState): Promise<void> {
        const totals = calculateTotals(state);
        const consecutiveLosses = countConsecutiveLosses(state);
        const realizedPnl = Number(totals.realizedPnl || 0);
        if (realizedPnl >= state.config.maxSessionProfit) {
            flattenOpenPositionsForGuardrail(state, "session profit guardrail stop");
            await this.stopState(state, `Auto-stopped after hitting realized profit target ${realizedPnl.toFixed(2)}.`);
            return;
        }
        if (realizedPnl <= (-1 * state.config.maxSessionLoss)) {
            flattenOpenPositionsForGuardrail(state, "session loss guardrail stop");
            await this.stopState(state, `Auto-stopped after hitting realized loss limit ${realizedPnl.toFixed(2)}.`);
            return;
        }
        if (consecutiveLosses >= state.config.maxConsecutiveLosses) {
            flattenOpenPositionsForGuardrail(state, "consecutive loss guardrail stop");
            await this.stopState(state, `Auto-stopped after ${consecutiveLosses} consecutive losing scalps.`);
        }
    }

    public async hydrate(): Promise<void> {
        const states = await loadDirectionalOptionsDemoStates();
        for (const persistedState of states) {
            const userId = String(persistedState.userId || "").trim();
            if (!userId) {
                continue;
            }
            const hydratedState: DirectionalOptionsDemoState = {
                ...createInitialState(userId),
                ...persistedState,
                userId,
                config: normalizeConfig(persistedState.config),
                timerRef: null,
                isBusy: false,
                equityCurve: Array.isArray(persistedState.equityCurve) ? persistedState.equityCurve.slice(-160) : []
            };
            this.stateByUserId.set(userId, hydratedState);
            if (hydratedState.running && hydratedState.apiKey && hydratedState.apiSecret) {
                this.startInterval(hydratedState);
                void this.runTick(hydratedState);
            }
        }
    }

    public getStatus(userId: string): DirectionalOptionsDemoStatus {
        const state = this.getOrCreateState(userId);
        return {
            running: state.running,
            selectedApiProfileId: state.selectedApiProfileId,
            profileLabel: state.profileLabel,
            cycleCount: state.cycleCount,
            startedAt: state.startedAt,
            stoppedAt: state.stoppedAt,
            lastCycleAt: state.lastCycleAt,
            lastError: state.lastError,
            config: state.config,
            latestTicker: state.latestTicker,
            lastSignal: state.lastSignal,
            openPositions: state.openPositions,
            closedPositions: state.closedPositions.slice(0, 100),
            events: state.events.slice(0, 60),
            equityCurve: state.equityCurve.slice(-120),
            guidance: buildGuidance(state),
            totals: calculateTotals(state)
        };
    }

    private async runTick(state: DirectionalOptionsDemoState): Promise<void> {
        if (!state.running || state.isBusy) {
            return;
        }
        state.isBusy = true;
        try {
            await this.executeCycle(state);
            state.lastError = "";
            await this.applySessionGuardrails(state);
        }
        catch (error) {
            state.lastError = error instanceof Error ? error.message : String(error);
            addEvent(state, "ERROR", "Cycle failed", state.lastError || "Directional paper cycle failed.");
        }
        finally {
            appendEquityPoint(state);
            state.isBusy = false;
            await this.persistState(state);
        }
    }

    private async executeCycle(state: DirectionalOptionsDemoState): Promise<void> {
        const snapshot = await fetchSnapshot(state.apiKey, state.apiSecret, toFetchSnapshotConfig(state.config) as never);
        const tickerMark = Number(snapshot.ticker.mark || snapshot.ticker.spot || 0);
        if (!(tickerMark > 0)) {
            throw new Error("Unable to read the latest ticker mark price.");
        }
        state.latestTicker = {
            symbol: snapshot.ticker.symbol,
            spot: Number(snapshot.ticker.spot || 0),
            mark: tickerMark,
            bestBid: snapshot.ticker.bestBid,
            bestAsk: snapshot.ticker.bestAsk,
            ts: snapshot.ts
        };
        state.priceHistory.push(tickerMark);
        state.priceHistory = state.priceHistory.slice(-200);
        updateOpenMarks(state, snapshot);
        const signal = computeSignal(state.priceHistory, snapshot, state.config);
        state.lastSignal = signal;
        maybeClosePositions(state, signal, snapshot);
        maybeOpenPosition(state, signal, snapshot);
        state.cycleCount += 1;
        state.lastCycleAt = new Date().toISOString();
    }

    public async start(userId: string, selectedApiProfileId: string, configInput?: Partial<DirectionalOptionsDemoConfig>): Promise<{ status: string; message: string }> {
        const state = this.getOrCreateState(userId);
        if (state.running) {
            return { status: "warning", message: "Directional demo engine is already running." };
        }
        const profile = await getDeltaApiProfile(userId, selectedApiProfileId);
        if (!profile) {
            return { status: "warning", message: "Select a valid Delta API profile before starting the demo." };
        }
        state.selectedApiProfileId = profile.profileId;
        state.profileLabel = profile.referenceName;
        state.apiKey = profile.apiKey;
        state.apiSecret = profile.apiSecret;
        state.config = normalizeConfig(configInput);
        state.running = true;
        state.startedAt = state.startedAt || new Date().toISOString();
        state.stoppedAt = null;
        state.lastError = "";
        addEvent(state, "ENGINE", "Started", `Directional scalper paper demo started with ${profile.referenceName}.`);
        this.startInterval(state);
        await this.persistState(state);
        void this.runTick(state);
        return { status: "success", message: "Directional options demo started." };
    }

    public async stop(userId: string, reason = "Manual stop"): Promise<{ status: string; message: string }> {
        const state = this.getOrCreateState(userId);
        await this.stopState(state, reason);
        appendEquityPoint(state);
        await this.persistState(state);
        return { status: "success", message: "Directional options demo stopped." };
    }

    public async runSingleCycle(userId: string, selectedApiProfileId: string, configInput?: Partial<DirectionalOptionsDemoConfig>): Promise<{ status: string; message: string; data?: DirectionalOptionsDemoStatus }> {
        const state = this.getOrCreateState(userId);
        if (selectedApiProfileId) {
            const profile = await getDeltaApiProfile(userId, selectedApiProfileId);
            if (!profile) {
                return { status: "warning", message: "Select a valid Delta API profile before running the demo cycle." };
            }
            state.selectedApiProfileId = profile.profileId;
            state.profileLabel = profile.referenceName;
            state.apiKey = profile.apiKey;
            state.apiSecret = profile.apiSecret;
        }
        if (!state.apiKey || !state.apiSecret) {
            return { status: "warning", message: "No market-data credentials are available for this demo user." };
        }
        state.config = normalizeConfig(configInput || state.config);
        if (state.isBusy) {
            return { status: "warning", message: "Directional demo cycle is already running." };
        }
        state.isBusy = true;
        try {
            await this.executeCycle(state);
            state.lastError = "";
            await this.applySessionGuardrails(state);
            appendEquityPoint(state);
            await this.persistState(state);
            return { status: "success", message: "Directional demo cycle completed.", data: this.getStatus(userId) };
        }
        catch (error) {
            state.lastError = error instanceof Error ? error.message : String(error);
            addEvent(state, "ERROR", "Cycle failed", state.lastError || "Directional paper cycle failed.");
            appendEquityPoint(state);
            await this.persistState(state);
            return { status: "danger", message: state.lastError };
        }
        finally {
            state.isBusy = false;
        }
    }

    public async emergencyStop(userId: string, reason: string): Promise<{ status: string; message: string }> {
        const state = this.getOrCreateState(userId);
        await this.stopState(state, reason || "Emergency stop");
        const latestExitPrice = state.latestTicker?.mark || 0;
        state.openPositions.forEach((position) => {
            if (position.status === "OPEN") {
                closePosition(state, position, position.markPrice || latestExitPrice, reason || "Emergency stop");
            }
        });
        state.openPositions = state.openPositions.filter((position) => position.status === "OPEN");
        appendEquityPoint(state);
        await this.persistState(state);
        return { status: "success", message: "Directional options demo emergency-stopped." };
    }

    public async manualClosePosition(userId: string, positionId: string): Promise<{ status: string; message: string; data?: DirectionalOptionsDemoStatus }> {
        const state = this.getOrCreateState(userId);
        const targetPosition = state.openPositions.find((position) => position.id === positionId && position.status === "OPEN");
        if (!targetPosition) {
            return { status: "warning", message: "Paper position not found or already closed.", data: this.getStatus(userId) };
        }

        let exitPrice = Number(targetPosition.markPrice || 0);
        if (state.apiKey && state.apiSecret) {
            const snapshot = await fetchSnapshot(state.apiKey, state.apiSecret, toFetchSnapshotConfig(state.config) as never);
            const option = snapshot.options.find((row) => row.symbol === targetPosition.symbol);
            if (option) {
                exitPrice = getLongExitPrice(option);
            }
            state.latestTicker = {
                symbol: snapshot.ticker.symbol,
                spot: Number(snapshot.ticker.spot || 0),
                mark: Number(snapshot.ticker.mark || snapshot.ticker.spot || 0),
                bestBid: snapshot.ticker.bestBid,
                bestAsk: snapshot.ticker.bestAsk,
                ts: snapshot.ts
            };
        }

        closePosition(state, targetPosition, exitPrice, "manual close from directional demo page");
        state.openPositions = state.openPositions.filter((position) => position.id !== positionId);
        state.cooldownUntilCycle = state.cycleCount + state.config.cooldownCycles;
        await this.applySessionGuardrails(state);
        appendEquityPoint(state);
        await this.persistState(state);
        return { status: "success", message: "Paper position closed.", data: this.getStatus(userId) };
    }

    public async reset(userId: string): Promise<{ status: string; message: string }> {
        const state = this.getOrCreateState(userId);
        if (state.timerRef) {
            clearInterval(state.timerRef);
        }
        this.stateByUserId.set(userId, createInitialState(userId));
        await deleteDirectionalOptionsDemoState(userId);
        return { status: "success", message: "Directional options demo reset." };
    }
}
