import path from "node:path";
import { readJsonFile, writeJsonFileAtomic } from "./json-store";
import { getPostgresPool, isPostgresConfigured } from "./postgres";
import type { DirectionalOptionsDemoState } from "../strategies/directional-options-demo/types";

const gStateFile = path.resolve(process.cwd(), "data", "directional-options-demo", "states.json");

interface DirectionalOptionsDemoStateRow {
    user_id: string;
    state_json: Record<string, unknown> | null;
    updated_at: string | Date;
}

type PersistedDirectionalOptionsDemoState = Omit<DirectionalOptionsDemoState, "timerRef" | "isBusy"> & {
    timerRef: null;
    isBusy: false;
};

function toPersistedState(state: DirectionalOptionsDemoState): PersistedDirectionalOptionsDemoState {
    return {
        ...state,
        timerRef: null,
        isBusy: false
    };
}

export async function loadDirectionalOptionsDemoStates(): Promise<PersistedDirectionalOptionsDemoState[]> {
    if (!isPostgresConfigured()) {
        return readJsonFile<PersistedDirectionalOptionsDemoState[]>(gStateFile, []);
    }

    const pool = getPostgresPool();
    const result = await pool.query<DirectionalOptionsDemoStateRow>(`
        SELECT user_id, state_json, updated_at
        FROM optionyze_directional_options_demo_state
        ORDER BY updated_at DESC, user_id ASC
    `);
    return result.rows.map((row) => ({
        ...(row.state_json ?? {}) as PersistedDirectionalOptionsDemoState,
        userId: String(row.user_id || "")
    }));
}

export async function loadDirectionalOptionsDemoState(userId: string): Promise<PersistedDirectionalOptionsDemoState | null> {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) {
        return null;
    }
    if (!isPostgresConfigured()) {
        const rows = await loadDirectionalOptionsDemoStates();
        return rows.find((row) => row.userId === normalizedUserId) || null;
    }

    const pool = getPostgresPool();
    const result = await pool.query<DirectionalOptionsDemoStateRow>(`
        SELECT user_id, state_json, updated_at
        FROM optionyze_directional_options_demo_state
        WHERE user_id = $1
    `, [normalizedUserId]);
    const row = result.rows[0];
    if (!row) {
        return null;
    }
    return {
        ...(row.state_json ?? {}) as PersistedDirectionalOptionsDemoState,
        userId: String(row.user_id || normalizedUserId)
    };
}

export async function saveDirectionalOptionsDemoState(state: DirectionalOptionsDemoState): Promise<void> {
    const persistedState = toPersistedState(state);
    if (!isPostgresConfigured()) {
        const rows = await loadDirectionalOptionsDemoStates();
        const otherRows = rows.filter((row) => row.userId !== persistedState.userId);
        otherRows.push(persistedState);
        await writeJsonFileAtomic(gStateFile, otherRows);
        return;
    }

    const pool = getPostgresPool();
    await pool.query(`
        INSERT INTO optionyze_directional_options_demo_state (
            user_id,
            state_json,
            updated_at
        ) VALUES ($1, $2::jsonb, NOW())
        ON CONFLICT (user_id)
        DO UPDATE SET
            state_json = EXCLUDED.state_json,
            updated_at = NOW()
    `, [
        persistedState.userId,
        JSON.stringify(persistedState)
    ]);
}

export async function deleteDirectionalOptionsDemoState(userId: string): Promise<void> {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) {
        return;
    }

    if (!isPostgresConfigured()) {
        const rows = await loadDirectionalOptionsDemoStates();
        const otherRows = rows.filter((row) => row.userId !== normalizedUserId);
        await writeJsonFileAtomic(gStateFile, otherRows);
        return;
    }

    const pool = getPostgresPool();
    await pool.query(`
        DELETE FROM optionyze_directional_options_demo_state
        WHERE user_id = $1
    `, [normalizedUserId]);
}
