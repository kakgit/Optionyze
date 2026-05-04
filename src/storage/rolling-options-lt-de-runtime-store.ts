import path from "node:path";
import { readJsonFile, writeJsonFileAtomic } from "./json-store";
import { getPostgresPool, isPostgresConfigured } from "./postgres";

export interface RollingOptionsLtDeRuntimeRecord {
    userId: string;
    status: "idle" | "running" | "stopped" | "error" | "paused";
    autoTraderEnabled: boolean;
    selectedApiProfileId: string;
    currentSymbol: string;
    currentContractName: string;
    currentExpiryMode: string;
    currentExpiryDate: string;
    renkoEnabled: boolean;
    renkoPoints: number;
    renkoSource: string;
    lastSpotPrice: number | null;
    lastFuturesPrice: number | null;
    lastSignal: string;
    lastCycleAt: string;
    lastError: string;
    state: Record<string, unknown>;
    updatedAt: string;
}

interface RollingOptionsLtDeRuntimeRow {
    user_id: string;
    status: "idle" | "running" | "stopped" | "error" | "paused";
    auto_trader_enabled: boolean;
    selected_api_profile_id: string;
    current_symbol: string;
    current_contract_name: string;
    current_expiry_mode: string;
    current_expiry_date: string;
    renko_enabled: boolean;
    renko_points: number;
    renko_source: string;
    last_spot_price: number | null;
    last_futures_price: number | null;
    last_signal: string;
    last_cycle_at: string | Date | null;
    last_error: string;
    state_json: Record<string, unknown> | null;
    updated_at: string | Date;
}

const gRuntimeFile = path.resolve(process.cwd(), "data", "rolling-options-lt-de", "runtime.json");

async function loadAllJson(): Promise<RollingOptionsLtDeRuntimeRecord[]> {
    return readJsonFile<RollingOptionsLtDeRuntimeRecord[]>(gRuntimeFile, []);
}

function mapRow(pRow: RollingOptionsLtDeRuntimeRow): RollingOptionsLtDeRuntimeRecord {
    return {
        userId: String(pRow.user_id),
        status: pRow.status,
        autoTraderEnabled: Boolean(pRow.auto_trader_enabled),
        selectedApiProfileId: String(pRow.selected_api_profile_id || ""),
        currentSymbol: String(pRow.current_symbol || ""),
        currentContractName: String(pRow.current_contract_name || ""),
        currentExpiryMode: String(pRow.current_expiry_mode || ""),
        currentExpiryDate: String(pRow.current_expiry_date || ""),
        renkoEnabled: Boolean(pRow.renko_enabled),
        renkoPoints: Number(pRow.renko_points || 0),
        renkoSource: String(pRow.renko_source || ""),
        lastSpotPrice: pRow.last_spot_price === null ? null : Number(pRow.last_spot_price),
        lastFuturesPrice: pRow.last_futures_price === null ? null : Number(pRow.last_futures_price),
        lastSignal: String(pRow.last_signal || ""),
        lastCycleAt: pRow.last_cycle_at ? new Date(pRow.last_cycle_at).toISOString() : "",
        lastError: String(pRow.last_error || ""),
        state: (pRow.state_json ?? {}) as Record<string, unknown>,
        updatedAt: new Date(pRow.updated_at).toISOString()
    };
}

export async function listRollingOptionsLtDeRuntime(): Promise<RollingOptionsLtDeRuntimeRecord[]> {
    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        const objResult = await objPool.query<RollingOptionsLtDeRuntimeRow>(`
            SELECT user_id, status, auto_trader_enabled, selected_api_profile_id, current_symbol, current_contract_name,
                   current_expiry_mode, current_expiry_date, renko_enabled, renko_points, renko_source,
                   last_spot_price, last_futures_price, last_signal, last_cycle_at, last_error, state_json, updated_at
            FROM optionyze_rolling_options_lt_de_runtime
            ORDER BY updated_at DESC
        `);
        return objResult.rows.map(mapRow);
    }

    return loadAllJson();
}

export async function loadRollingOptionsLtDeRuntime(pUserId: string): Promise<RollingOptionsLtDeRuntimeRecord | null> {
    const vUserId = String(pUserId || "").trim();
    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        const objResult = await objPool.query<RollingOptionsLtDeRuntimeRow>(`
            SELECT user_id, status, auto_trader_enabled, selected_api_profile_id, current_symbol, current_contract_name,
                   current_expiry_mode, current_expiry_date, renko_enabled, renko_points, renko_source,
                   last_spot_price, last_futures_price, last_signal, last_cycle_at, last_error, state_json, updated_at
            FROM optionyze_rolling_options_lt_de_runtime
            WHERE user_id = $1
        `, [vUserId]);

        const objRow = objResult.rows[0];
        return objRow ? mapRow(objRow) : null;
    }

    const arrRows = await loadAllJson();
    return arrRows.find((objRow) => objRow.userId === vUserId) || null;
}

export async function saveRollingOptionsLtDeRuntime(
    pRuntime: RollingOptionsLtDeRuntimeRecord
): Promise<RollingOptionsLtDeRuntimeRecord> {
    const objRuntime: RollingOptionsLtDeRuntimeRecord = {
        ...pRuntime,
        currentSymbol: String(pRuntime.currentSymbol || ""),
        currentContractName: String(pRuntime.currentContractName || ""),
        currentExpiryMode: String(pRuntime.currentExpiryMode || ""),
        currentExpiryDate: String(pRuntime.currentExpiryDate || ""),
        renkoEnabled: Boolean(pRuntime.renkoEnabled),
        renkoPoints: Number(pRuntime.renkoPoints || 0),
        renkoSource: String(pRuntime.renkoSource || ""),
        lastSpotPrice: pRuntime.lastSpotPrice === null || pRuntime.lastSpotPrice === undefined ? null : Number(pRuntime.lastSpotPrice),
        lastFuturesPrice: pRuntime.lastFuturesPrice === null || pRuntime.lastFuturesPrice === undefined ? null : Number(pRuntime.lastFuturesPrice),
        lastSignal: String(pRuntime.lastSignal || ""),
        lastCycleAt: String(pRuntime.lastCycleAt || ""),
        lastError: String(pRuntime.lastError || ""),
        state: (pRuntime.state ?? {}) as Record<string, unknown>,
        updatedAt: new Date().toISOString()
    };

    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        await objPool.query(`
            INSERT INTO optionyze_rolling_options_lt_de_runtime (
                user_id,
                status,
                auto_trader_enabled,
                selected_api_profile_id,
                current_symbol,
                current_contract_name,
                current_expiry_mode,
                current_expiry_date,
                renko_enabled,
                renko_points,
                renko_source,
                last_spot_price,
                last_futures_price,
                last_signal,
                last_cycle_at,
                last_error,
                state_json,
                updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18)
            ON CONFLICT (user_id)
            DO UPDATE SET
                status = EXCLUDED.status,
                auto_trader_enabled = EXCLUDED.auto_trader_enabled,
                selected_api_profile_id = EXCLUDED.selected_api_profile_id,
                current_symbol = EXCLUDED.current_symbol,
                current_contract_name = EXCLUDED.current_contract_name,
                current_expiry_mode = EXCLUDED.current_expiry_mode,
                current_expiry_date = EXCLUDED.current_expiry_date,
                renko_enabled = EXCLUDED.renko_enabled,
                renko_points = EXCLUDED.renko_points,
                renko_source = EXCLUDED.renko_source,
                last_spot_price = EXCLUDED.last_spot_price,
                last_futures_price = EXCLUDED.last_futures_price,
                last_signal = EXCLUDED.last_signal,
                last_cycle_at = EXCLUDED.last_cycle_at,
                last_error = EXCLUDED.last_error,
                state_json = EXCLUDED.state_json,
                updated_at = EXCLUDED.updated_at
        `, [
            objRuntime.userId,
            objRuntime.status,
            objRuntime.autoTraderEnabled,
            objRuntime.selectedApiProfileId,
            objRuntime.currentSymbol,
            objRuntime.currentContractName,
            objRuntime.currentExpiryMode,
            objRuntime.currentExpiryDate,
            objRuntime.renkoEnabled,
            objRuntime.renkoPoints,
            objRuntime.renkoSource,
            objRuntime.lastSpotPrice,
            objRuntime.lastFuturesPrice,
            objRuntime.lastSignal,
            objRuntime.lastCycleAt || null,
            objRuntime.lastError,
            JSON.stringify(objRuntime.state || {}),
            objRuntime.updatedAt
        ]);
        return objRuntime;
    }

    const arrRows = await loadAllJson();
    const arrOther = arrRows.filter((objRow) => objRow.userId !== objRuntime.userId);
    arrOther.push(objRuntime);
    await writeJsonFileAtomic(gRuntimeFile, arrOther);
    return objRuntime;
}
