import { getPostgresPool, isPostgresConfigured } from "./postgres";
import type { PendingStrategyAutoExecSettings } from "../types/models";

const gPendingStrategyAutoExecSettingsKey = "pending_strategy_auto_exec";

export function getDefaultPendingStrategyAutoExecSettings(): PendingStrategyAutoExecSettings {
    return {
        slEnabled: true,
        tpEnabled: false
    };
}

export async function getPendingStrategyAutoExecSettings(): Promise<PendingStrategyAutoExecSettings> {
    if (!isPostgresConfigured()) {
        throw new Error("PostgreSQL is required for admin settings.");
    }

    const objPool = getPostgresPool();
    const objResult = await objPool.query<{ setting_value_json: Record<string, unknown> | null }>(`
        SELECT setting_value_json
        FROM optionyze_admin_settings
        WHERE setting_key = $1
    `, [gPendingStrategyAutoExecSettingsKey]);

    const objValue = (objResult.rows[0]?.setting_value_json ?? {}) as Record<string, unknown>;
    const objDefault = getDefaultPendingStrategyAutoExecSettings();
    return {
        slEnabled: objValue.slEnabled === undefined ? objDefault.slEnabled : Boolean(objValue.slEnabled),
        tpEnabled: objValue.tpEnabled === undefined ? objDefault.tpEnabled : Boolean(objValue.tpEnabled)
    };
}

export async function savePendingStrategyAutoExecSettings(
    pSettings: PendingStrategyAutoExecSettings
): Promise<PendingStrategyAutoExecSettings> {
    if (!isPostgresConfigured()) {
        throw new Error("PostgreSQL is required for admin settings.");
    }

    const objValue = {
        slEnabled: Boolean(pSettings.slEnabled),
        tpEnabled: Boolean(pSettings.tpEnabled)
    };
    const objPool = getPostgresPool();
    await objPool.query(`
        INSERT INTO optionyze_admin_settings (
            setting_key,
            setting_value_json,
            updated_at
        ) VALUES ($1, $2::jsonb, NOW())
        ON CONFLICT (setting_key)
        DO UPDATE SET
            setting_value_json = EXCLUDED.setting_value_json,
            updated_at = NOW()
    `, [
        gPendingStrategyAutoExecSettingsKey,
        JSON.stringify(objValue)
    ]);

    return objValue;
}
