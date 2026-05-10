import path from "node:path";
import { readJsonFile, writeJsonFileAtomic } from "./json-store";
import { getPostgresPool, isPostgresConfigured } from "./postgres";
import type { RollingFuturesLtStrategyCode } from "./rolling-futures-lt-store";

export interface RollingFuturesLtRuntimeRecord {
    userId: string;
    strategyCode: RollingFuturesLtStrategyCode;
    status: "idle" | "running" | "stopped" | "error" | "paused";
    autoTraderEnabled: boolean;
    selectedApiProfileId: string;
    currentSymbol: string;
    lastSignal: string;
    lastCycleAt: string;
    lastError: string;
    state: Record<string, unknown>;
    updatedAt: string;
}

interface RollingFuturesLtRuntimeRow {
    user_id: string;
    strategy_code: RollingFuturesLtStrategyCode;
    status: "idle" | "running" | "stopped" | "error" | "paused";
    auto_trader_enabled: boolean;
    selected_api_profile_id: string;
    current_symbol: string;
    last_signal: string;
    last_cycle_at: string | Date | null;
    last_error: string;
    state_json: Record<string, unknown> | null;
    updated_at: string | Date;
}

const gRuntimeFile = path.resolve(process.cwd(), "data", "rolling-futures-lt", "runtime.json");

export function getDefaultRollingFuturesLtRuntime(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode
): RollingFuturesLtRuntimeRecord {
    return {
        userId: String(pUserId || "").trim(),
        strategyCode: pStrategyCode,
        status: "idle",
        autoTraderEnabled: false,
        selectedApiProfileId: "",
        currentSymbol: "",
        lastSignal: "IDLE",
        lastCycleAt: "",
        lastError: "",
        state: {},
        updatedAt: ""
    };
}

async function loadAllJson(): Promise<RollingFuturesLtRuntimeRecord[]> {
    return readJsonFile<RollingFuturesLtRuntimeRecord[]>(gRuntimeFile, []);
}

function mapRow(pRow: RollingFuturesLtRuntimeRow): RollingFuturesLtRuntimeRecord {
    return {
        userId: String(pRow.user_id),
        strategyCode: pRow.strategy_code,
        status: pRow.status,
        autoTraderEnabled: Boolean(pRow.auto_trader_enabled),
        selectedApiProfileId: String(pRow.selected_api_profile_id || ""),
        currentSymbol: String(pRow.current_symbol || ""),
        lastSignal: String(pRow.last_signal || ""),
        lastCycleAt: pRow.last_cycle_at ? new Date(pRow.last_cycle_at).toISOString() : "",
        lastError: String(pRow.last_error || ""),
        state: (pRow.state_json ?? {}) as Record<string, unknown>,
        updatedAt: new Date(pRow.updated_at).toISOString()
    };
}

export async function listRollingFuturesLtRuntime(): Promise<RollingFuturesLtRuntimeRecord[]> {
    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        const objResult = await objPool.query<RollingFuturesLtRuntimeRow>(`
            SELECT user_id, strategy_code, status, auto_trader_enabled, selected_api_profile_id, current_symbol,
                   last_signal, last_cycle_at, last_error, state_json, updated_at
            FROM optionyze_rolling_futures_lt_runtime
            ORDER BY updated_at DESC
        `);
        return objResult.rows.map(mapRow);
    }

    return loadAllJson();
}

export async function loadRollingFuturesLtRuntime(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode
): Promise<RollingFuturesLtRuntimeRecord | null> {
    const vUserId = String(pUserId || "").trim();
    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        const objResult = await objPool.query<RollingFuturesLtRuntimeRow>(`
            SELECT user_id, strategy_code, status, auto_trader_enabled, selected_api_profile_id, current_symbol,
                   last_signal, last_cycle_at, last_error, state_json, updated_at
            FROM optionyze_rolling_futures_lt_runtime
            WHERE user_id = $1
              AND strategy_code = $2
        `, [vUserId, pStrategyCode]);
        const objRow = objResult.rows[0];
        return objRow ? mapRow(objRow) : null;
    }

    const arrRows = await loadAllJson();
    return arrRows.find((objRow) => objRow.userId === vUserId && objRow.strategyCode === pStrategyCode) || null;
}

export async function saveRollingFuturesLtRuntime(
    pRuntime: RollingFuturesLtRuntimeRecord
): Promise<RollingFuturesLtRuntimeRecord> {
    const objRuntime: RollingFuturesLtRuntimeRecord = {
        ...getDefaultRollingFuturesLtRuntime(pRuntime.userId, pRuntime.strategyCode),
        ...pRuntime,
        currentSymbol: String(pRuntime.currentSymbol || ""),
        lastSignal: String(pRuntime.lastSignal || ""),
        lastCycleAt: String(pRuntime.lastCycleAt || ""),
        lastError: String(pRuntime.lastError || ""),
        state: (pRuntime.state ?? {}) as Record<string, unknown>,
        updatedAt: new Date().toISOString()
    };

    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        await objPool.query(`
            INSERT INTO optionyze_rolling_futures_lt_runtime (
                user_id,
                strategy_code,
                status,
                auto_trader_enabled,
                selected_api_profile_id,
                current_symbol,
                last_signal,
                last_cycle_at,
                last_error,
                state_json,
                updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
            ON CONFLICT (user_id, strategy_code)
            DO UPDATE SET
                status = EXCLUDED.status,
                auto_trader_enabled = EXCLUDED.auto_trader_enabled,
                selected_api_profile_id = EXCLUDED.selected_api_profile_id,
                current_symbol = EXCLUDED.current_symbol,
                last_signal = EXCLUDED.last_signal,
                last_cycle_at = EXCLUDED.last_cycle_at,
                last_error = EXCLUDED.last_error,
                state_json = EXCLUDED.state_json,
                updated_at = EXCLUDED.updated_at
        `, [
            objRuntime.userId,
            objRuntime.strategyCode,
            objRuntime.status,
            objRuntime.autoTraderEnabled,
            objRuntime.selectedApiProfileId,
            objRuntime.currentSymbol,
            objRuntime.lastSignal,
            objRuntime.lastCycleAt || null,
            objRuntime.lastError,
            JSON.stringify(objRuntime.state || {}),
            objRuntime.updatedAt
        ]);
        return objRuntime;
    }

    const arrRows = await loadAllJson();
    const arrOther = arrRows.filter((objRow) => !(objRow.userId === objRuntime.userId && objRow.strategyCode === objRuntime.strategyCode));
    arrOther.push(objRuntime);
    await writeJsonFileAtomic(gRuntimeFile, arrOther);
    return objRuntime;
}
