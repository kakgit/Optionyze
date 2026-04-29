import { normalizeConfig } from "./config";
import { runStrategyCycle, closeAllPositions } from "./engine";
import { calculatePortfolio } from "./portfolio";
import { addEvent, createInitialState, resetRuntime } from "./state";
import type { RunnerManager } from "../../runners/runner-manager";
import type { StartPaperEngineInput, StrategyFoGreeksPaperState, StrategyFoGreeksPaperStatus } from "./types";

export class StrategyFoGreeksPaperService {
    private readonly stateByUserId = new Map<string, StrategyFoGreeksPaperState>();

    public constructor(private readonly runnerManager: RunnerManager) {}

    private getOrCreateState(pUserId: string): StrategyFoGreeksPaperState {
        const vUserId = String(pUserId || "").trim() || "demo-paper";
        let objState = this.stateByUserId.get(vUserId);
        if (!objState) {
            objState = createInitialState(vUserId);
            this.stateByUserId.set(vUserId, objState);
        }
        return objState;
    }

    private async syncRunnerState(pState: StrategyFoGreeksPaperState, pMessage: string): Promise<void> {
        await this.runnerManager.setState({
            userId: pState.userId,
            strategyType: "strategy-fo-greeks-paper",
            status: pState.running ? "running" : "stopped",
            updatedAt: new Date().toISOString(),
            message: pMessage,
            state: {
                cycleCount: pState.cycleCount,
                consecutiveFailures: pState.consecutiveFailures,
                lastError: pState.lastError,
                killSwitch: pState.killSwitch,
                config: pState.config,
                portfolio: calculatePortfolio(pState)
            }
        });
    }

    private async runTick(pState: StrategyFoGreeksPaperState): Promise<void> {
        if (!pState.running || pState.isBusy) {
            return;
        }
        pState.isBusy = true;
        try {
            await runStrategyCycle(pState);
            pState.cycleCount += 1;
            pState.lastCycleAt = new Date().toISOString();
            pState.consecutiveFailures = 0;
            await this.syncRunnerState(pState, "Paper cycle completed.");
        }
        catch (objError) {
            pState.consecutiveFailures += 1;
            pState.lastError = objError instanceof Error ? objError.message : String(objError);
            addEvent(pState, "ERROR", "paper_cycle_error", {
                error: pState.lastError,
                consecutiveFailures: pState.consecutiveFailures
            });
            if (pState.consecutiveFailures >= pState.config.maxConsecutiveFailures) {
                pState.killSwitch.enabled = true;
                pState.killSwitch.reason = "Consecutive failures threshold breached";
            }
            await this.syncRunnerState(pState, pState.lastError || "Paper cycle failed.");
        }
        finally {
            pState.isBusy = false;
        }
    }

    public async start(pInput: StartPaperEngineInput): Promise<{ status: string; message: string }> {
        const objState = this.getOrCreateState(pInput.userId);
        if (objState.running) {
            return { status: "warning", message: "Paper engine already running." };
        }
        const vApiKey = String(pInput.apiKey || "").trim();
        const vApiSecret = String(pInput.apiSecret || "").trim();
        if (!vApiKey || !vApiSecret) {
            return { status: "warning", message: "API key/secret are required." };
        }

        resetRuntime(objState);
        objState.credentials.apiKey = vApiKey;
        objState.credentials.apiSecret = vApiSecret;
        objState.config = normalizeConfig(pInput.config || {});
        objState.startedAt = new Date().toISOString();
        objState.stoppedAt = null;
        objState.running = true;
        objState.timerRef = setInterval(() => {
            void this.runTick(objState);
        }, objState.config.loopSeconds * 1000);

        addEvent(objState, "ENGINE", "Paper engine started", { loopSeconds: objState.config.loopSeconds });
        await this.syncRunnerState(objState, "Paper engine started.");
        void this.runTick(objState);
        return { status: "success", message: "Paper engine started." };
    }

    public async stop(pUserId: string, pReason = "Manual stop"): Promise<{ status: string; message: string }> {
        const objState = this.getOrCreateState(pUserId);
        if (objState.timerRef) {
            clearInterval(objState.timerRef);
            objState.timerRef = null;
        }
        if (objState.running) {
            objState.running = false;
            objState.stoppedAt = new Date().toISOString();
            addEvent(objState, "ENGINE", "Paper engine stopped", { reason: pReason });
        }
        await this.syncRunnerState(objState, "Paper engine stopped.");
        return { status: "success", message: "Paper engine stopped." };
    }

    public async emergencyStop(pUserId: string, pReason: string): Promise<{ status: string; message: string }> {
        const objState = this.getOrCreateState(pUserId);
        await this.stop(pUserId, pReason || "Emergency stop");
        closeAllPositions(objState, pReason || "EMERGENCY_STOP");
        await this.syncRunnerState(objState, "Paper engine emergency-stopped.");
        return { status: "success", message: "Paper engine emergency-stopped." };
    }

    public getStatus(pUserId: string): StrategyFoGreeksPaperStatus {
        const objState = this.getOrCreateState(pUserId);
        return {
            running: objState.running,
            startedAt: objState.startedAt,
            stoppedAt: objState.stoppedAt,
            cycleCount: objState.cycleCount,
            consecutiveFailures: objState.consecutiveFailures,
            lastError: objState.lastError,
            lastCycleAt: objState.lastCycleAt,
            killSwitch: objState.killSwitch,
            config: objState.config,
            portfolio: calculatePortfolio(objState),
            openPositions: objState.positions,
            closedPositions: objState.closedPositions.slice(-100),
            events: objState.events.slice(0, 50)
        };
    }

    public async runSingleCycle(pUserId: string): Promise<{ status: string; message: string; data?: StrategyFoGreeksPaperStatus }> {
        const objState = this.getOrCreateState(pUserId);
        if (!objState.credentials.apiKey || !objState.credentials.apiSecret) {
            return { status: "warning", message: "No credentials. Start engine first." };
        }
        if (objState.isBusy) {
            return { status: "warning", message: "Cycle already in progress." };
        }
        objState.isBusy = true;
        try {
            await runStrategyCycle(objState);
            objState.cycleCount += 1;
            objState.lastCycleAt = new Date().toISOString();
            objState.consecutiveFailures = 0;
            await this.syncRunnerState(objState, "Manual paper cycle completed.");
            return { status: "success", message: "Cycle completed.", data: this.getStatus(pUserId) };
        }
        catch (objError) {
            objState.consecutiveFailures += 1;
            objState.lastError = objError instanceof Error ? objError.message : String(objError);
            await this.syncRunnerState(objState, objState.lastError || "Manual paper cycle failed.");
            return { status: "danger", message: objState.lastError };
        }
        finally {
            objState.isBusy = false;
        }
    }

    public async resetPaperState(pUserId: string): Promise<{ status: string; message: string }> {
        const objState = this.getOrCreateState(pUserId);
        await this.stop(pUserId, "Reset state");
        resetRuntime(objState);
        objState.credentials = { apiKey: "", apiSecret: "" };
        objState.config = normalizeConfig({});
        objState.startedAt = null;
        objState.stoppedAt = null;
        await this.syncRunnerState(objState, "Paper state reset.");
        return { status: "success", message: "Paper state reset." };
    }
}
