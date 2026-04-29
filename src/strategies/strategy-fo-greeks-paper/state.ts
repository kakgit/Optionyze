import { DEFAULT_CONFIG, normalizeConfig } from "./config";
import type { LegReentryState, StrategyFoGreeksPaperState } from "./types";

export function createLegReentryState(): LegReentryState {
    return {
        count: 0,
        cooldownUntilCycle: 0,
        consecutiveSl: 0,
        pauseUntilCycle: 0
    };
}

export function createInitialState(pUserId: string): StrategyFoGreeksPaperState {
    return {
        userId: pUserId,
        running: false,
        startedAt: null,
        stoppedAt: null,
        isBusy: false,
        timerRef: null,
        cycleCount: 0,
        consecutiveFailures: 0,
        lastError: "",
        lastCycleAt: null,
        credentials: {
            apiKey: "",
            apiSecret: ""
        },
        config: normalizeConfig(DEFAULT_CONFIG),
        positions: [],
        closedPositions: [],
        reentry: {
            weekly_put_short: createLegReentryState(),
            biweekly_put_short: createLegReentryState()
        },
        killSwitch: {
            enabled: false,
            reason: ""
        },
        events: []
    };
}

export function addEvent(
    pState: StrategyFoGreeksPaperState,
    pType: string,
    pMessage: string,
    pMeta: Record<string, unknown> = {}
): void {
    pState.events.unshift({
        ts: new Date().toISOString(),
        type: pType,
        message: pMessage,
        meta: pMeta
    });
    if (pState.events.length > 250) {
        pState.events.length = 250;
    }
}

export function nextPositionId(): string {
    return `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

export function resetRuntime(pState: StrategyFoGreeksPaperState): void {
    pState.cycleCount = 0;
    pState.consecutiveFailures = 0;
    pState.lastError = "";
    pState.lastCycleAt = null;
    pState.positions = [];
    pState.closedPositions = [];
    pState.events = [];
    pState.reentry = {
        weekly_put_short: createLegReentryState(),
        biweekly_put_short: createLegReentryState()
    };
    pState.killSwitch = { enabled: false, reason: "" };
}
