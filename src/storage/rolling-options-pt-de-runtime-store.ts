import path from "node:path";
import { readJsonFile, writeJsonFileAtomic } from "./json-store";
import { getPostgresPool, isPostgresConfigured } from "./postgres";

export interface RollingOptionsPtDeRuntimeRecord {
    userId: string;
    status: "idle" | "running" | "stopped" | "error";
    autoTraderEnabled: boolean;
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

interface RollingOptionsPtDeRuntimeRow {
    user_id: string;
    status: "idle" | "running" | "stopped" | "error";
    auto_trader_enabled: boolean;
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

const gRuntimeFile = path.resolve(process.cwd(), "data", "rolling-options-pt-de", "runtime.json");

async function loadAllRuntimeJson(): Promise<RollingOptionsPtDeRuntimeRecord[]> {
    return readJsonFile<RollingOptionsPtDeRuntimeRecord[]>(gRuntimeFile, []);
}

export async function listRollingOptionsPtDeRuntime(): Promise<RollingOptionsPtDeRuntimeRecord[]> {
    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        const objResult = await objPool.query<RollingOptionsPtDeRuntimeRow>(`
            SELECT
                user_id,
                status,
                auto_trader_enabled,
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
            FROM optionyze_rolling_options_pt_de_runtime
            ORDER BY updated_at DESC
        `);

        return objResult.rows.map((objRow) => ({
            userId: String(objRow.user_id),
            status: objRow.status,
            autoTraderEnabled: Boolean(objRow.auto_trader_enabled),
            currentSymbol: String(objRow.current_symbol || ""),
            currentContractName: String(objRow.current_contract_name || ""),
            currentExpiryMode: String(objRow.current_expiry_mode || ""),
            currentExpiryDate: String(objRow.current_expiry_date || ""),
            renkoEnabled: Boolean(objRow.renko_enabled),
            renkoPoints: Number(objRow.renko_points || 0),
            renkoSource: String(objRow.renko_source || ""),
            lastSpotPrice: objRow.last_spot_price === null ? null : Number(objRow.last_spot_price),
            lastFuturesPrice: objRow.last_futures_price === null ? null : Number(objRow.last_futures_price),
            lastSignal: String(objRow.last_signal || ""),
            lastCycleAt: objRow.last_cycle_at ? new Date(objRow.last_cycle_at).toISOString() : "",
            lastError: String(objRow.last_error || ""),
            state: (objRow.state_json ?? {}) as Record<string, unknown>,
            updatedAt: new Date(objRow.updated_at).toISOString()
        }));
    }

    return loadAllRuntimeJson();
}

export async function loadRollingOptionsPtDeRuntime(pUserId: string): Promise<RollingOptionsPtDeRuntimeRecord | null> {
    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        const objResult = await objPool.query<RollingOptionsPtDeRuntimeRow>(`
            SELECT
                user_id,
                status,
                auto_trader_enabled,
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
            FROM optionyze_rolling_options_pt_de_runtime
            WHERE user_id = $1
        `, [pUserId]);

        const objRow = objResult.rows[0];
        if (!objRow) {
            return null;
        }

        return {
            userId: String(objRow.user_id),
            status: objRow.status,
            autoTraderEnabled: Boolean(objRow.auto_trader_enabled),
            currentSymbol: String(objRow.current_symbol || ""),
            currentContractName: String(objRow.current_contract_name || ""),
            currentExpiryMode: String(objRow.current_expiry_mode || ""),
            currentExpiryDate: String(objRow.current_expiry_date || ""),
            renkoEnabled: Boolean(objRow.renko_enabled),
            renkoPoints: Number(objRow.renko_points || 0),
            renkoSource: String(objRow.renko_source || ""),
            lastSpotPrice: objRow.last_spot_price === null ? null : Number(objRow.last_spot_price),
            lastFuturesPrice: objRow.last_futures_price === null ? null : Number(objRow.last_futures_price),
            lastSignal: String(objRow.last_signal || ""),
            lastCycleAt: objRow.last_cycle_at ? new Date(objRow.last_cycle_at).toISOString() : "",
            lastError: String(objRow.last_error || ""),
            state: (objRow.state_json ?? {}) as Record<string, unknown>,
            updatedAt: new Date(objRow.updated_at).toISOString()
        };
    }

    const objRows = await loadAllRuntimeJson();
    return objRows.find((objRow) => objRow.userId === pUserId) || null;
}

export async function saveRollingOptionsPtDeRuntime(
    pRuntime: RollingOptionsPtDeRuntimeRecord
): Promise<RollingOptionsPtDeRuntimeRecord> {
    const objRuntime: RollingOptionsPtDeRuntimeRecord = {
        ...pRuntime,
        updatedAt: new Date().toISOString()
    };

    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        await objPool.query(`
            INSERT INTO optionyze_rolling_options_pt_de_runtime (
                user_id,
                status,
                auto_trader_enabled,
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
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17)
            ON CONFLICT (user_id)
            DO UPDATE SET
                status = EXCLUDED.status,
                auto_trader_enabled = EXCLUDED.auto_trader_enabled,
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

    const objRows = await loadAllRuntimeJson();
    const objOtherRows = objRows.filter((objRow) => objRow.userId !== objRuntime.userId);
    objOtherRows.push(objRuntime);
    await writeJsonFileAtomic(gRuntimeFile, objOtherRows);
    return objRuntime;
}
