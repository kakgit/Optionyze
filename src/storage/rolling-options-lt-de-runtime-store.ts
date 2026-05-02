import path from "node:path";
import { readJsonFile, writeJsonFileAtomic } from "./json-store";
import { getPostgresPool, isPostgresConfigured } from "./postgres";

export interface RollingOptionsLtDeRuntimeRecord {
    userId: string;
    status: "idle" | "running" | "stopped" | "error" | "paused";
    autoTraderEnabled: boolean;
    selectedApiProfileId: string;
    updatedAt: string;
}

interface RollingOptionsLtDeRuntimeRow {
    user_id: string;
    status: "idle" | "running" | "stopped" | "error" | "paused";
    auto_trader_enabled: boolean;
    selected_api_profile_id: string;
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
        updatedAt: new Date(pRow.updated_at).toISOString()
    };
}

export async function listRollingOptionsLtDeRuntime(): Promise<RollingOptionsLtDeRuntimeRecord[]> {
    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        const objResult = await objPool.query<RollingOptionsLtDeRuntimeRow>(`
            SELECT user_id, status, auto_trader_enabled, selected_api_profile_id, updated_at
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
            SELECT user_id, status, auto_trader_enabled, selected_api_profile_id, updated_at
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
                updated_at
            ) VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (user_id)
            DO UPDATE SET
                status = EXCLUDED.status,
                auto_trader_enabled = EXCLUDED.auto_trader_enabled,
                selected_api_profile_id = EXCLUDED.selected_api_profile_id,
                updated_at = EXCLUDED.updated_at
        `, [
            objRuntime.userId,
            objRuntime.status,
            objRuntime.autoTraderEnabled,
            objRuntime.selectedApiProfileId,
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
