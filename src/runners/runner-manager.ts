import type { RunnerState, UserRecord } from "../types/models";
import { loadRunnerStates, saveRunnerState } from "../storage/runtime-store";

export class RunnerManager {
    private readonly runnerStates = new Map<string, RunnerState>();

    public async hydrate(): Promise<void> {
        const objStates = await loadRunnerStates();
        this.runnerStates.clear();
        for (const objState of objStates) {
            this.runnerStates.set(objState.userId, objState);
        }
    }

    public listStates(): RunnerState[] {
        return [...this.runnerStates.values()];
    }

    public async setState(pState: RunnerState): Promise<void> {
        this.runnerStates.set(pState.userId, pState);
        await saveRunnerState(pState);
    }

    public async startUser(pUser: UserRecord): Promise<RunnerState> {
        const vState: RunnerState = {
            userId: pUser.userId,
            strategyType: pUser.strategyType,
            status: "running",
            updatedAt: new Date().toISOString(),
            message: `Runner started for ${pUser.name}`,
            state: {
                preferredSymbol: pUser.preferredSymbol || "",
                capital: pUser.capital,
                exchange: pUser.exchange,
                strategyConfig: pUser.strategyConfig || {}
            }
        };
        await this.setState(vState);
        return vState;
    }

    public async stopUser(pUserId: string): Promise<RunnerState> {
        const vExisting = this.runnerStates.get(pUserId);
        const vState: RunnerState = {
            userId: pUserId,
            strategyType: vExisting?.strategyType || "covered-call-live",
            status: "stopped",
            updatedAt: new Date().toISOString(),
            message: "Runner stopped",
            state: vExisting?.state || {}
        };
        await this.setState(vState);
        return vState;
    }
}
