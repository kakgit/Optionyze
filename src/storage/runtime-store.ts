import path from "node:path";
import { readJsonFile, writeJsonFileAtomic } from "./json-store";
import { getPostgresPool, isPostgresConfigured } from "./postgres";
import type { RunnerState } from "../types/models";

const gRuntimeFile = path.resolve(process.cwd(), "data", "runtime", "runners.json");

interface RunnerStateRow {
    user_id: string;
    strategy_type: RunnerState["strategyType"];
    status: RunnerState["status"];
    updated_at: string | Date;
    message: string;
    state_json: Record<string, unknown> | null;
}

export async function loadRunnerStates(): Promise<RunnerState[]> {
    if (!isPostgresConfigured()) {
        return readJsonFile<RunnerState[]>(gRuntimeFile, []);
    }

    const objPool = getPostgresPool();
    const objResult = await objPool.query<RunnerStateRow>(`
        SELECT
            user_id,
            strategy_type,
            status,
            updated_at,
            message,
            state_json
        FROM optionyze_runner_states
        ORDER BY updated_at DESC, user_id ASC
    `);

    return objResult.rows.map((objRow: RunnerStateRow) => ({
        userId: String(objRow.user_id),
        strategyType: objRow.strategy_type,
        status: objRow.status,
        updatedAt: new Date(objRow.updated_at).toISOString(),
        message: String(objRow.message || ""),
        state: (objRow.state_json ?? {}) as Record<string, unknown>
    }));
}

export async function saveRunnerState(pState: RunnerState): Promise<void> {
    if (!isPostgresConfigured()) {
        const objStates = await loadRunnerStates();
        const objOtherStates = objStates.filter((objState) => objState.userId !== pState.userId);
        objOtherStates.push(pState);
        await writeJsonFileAtomic(gRuntimeFile, objOtherStates);
        return;
    }

    const objPool = getPostgresPool();
    await objPool.query(`
        INSERT INTO optionyze_runner_states (
            user_id,
            strategy_type,
            status,
            updated_at,
            message,
            state_json
        ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
        ON CONFLICT (user_id)
        DO UPDATE SET
            strategy_type = EXCLUDED.strategy_type,
            status = EXCLUDED.status,
            updated_at = EXCLUDED.updated_at,
            message = EXCLUDED.message,
            state_json = EXCLUDED.state_json
    `, [
        pState.userId,
        pState.strategyType,
        pState.status,
        pState.updatedAt,
        pState.message,
        JSON.stringify(pState.state || {})
    ]);
}
