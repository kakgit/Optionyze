import { Pool } from "pg";

let gSurvivalPool: Pool | null = null;

export function isSurvivalPostgresConfigured(): boolean {
    return String(process.env.SURVIVAL_DATABASE_URL || "").trim().length > 0;
}

export function getSurvivalPostgresPool(): Pool {
    if (!isSurvivalPostgresConfigured()) {
        throw new Error("SURVIVAL_DATABASE_URL is not configured.");
    }

    if (gSurvivalPool) {
        return gSurvivalPool;
    }

    gSurvivalPool = new Pool({
        connectionString: process.env.SURVIVAL_DATABASE_URL,
        ssl: process.env.SURVIVAL_PGSSLMODE === "disable"
            ? false
            : { rejectUnauthorized: false }
    });
    gSurvivalPool.on("error", () => {
        if (gSurvivalPool) {
            gSurvivalPool = null;
        }
    });
    return gSurvivalPool;
}

export async function ensureSurvivalPostgresSchema(): Promise<void> {
    if (!isSurvivalPostgresConfigured()) {
        return;
    }

    const objPool = getSurvivalPostgresPool();
    await objPool.query(`
        CREATE TABLE IF NOT EXISTS optionyze_survival_state (
            user_id TEXT NOT NULL,
            strategy_code TEXT NOT NULL,
            strategy_run_id TEXT NOT NULL,
            run_tag TEXT NOT NULL DEFAULT '',
            run_status TEXT NOT NULL DEFAULT 'active',
            owner_server_id TEXT NOT NULL DEFAULT '',
            owner_instance_id TEXT NOT NULL DEFAULT '',
            lease_token TEXT NOT NULL DEFAULT '',
            lease_expires_at TIMESTAMPTZ NULL,
            last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            selected_api_profile_id TEXT NOT NULL DEFAULT '',
            profile_reference_name TEXT NOT NULL DEFAULT '',
            api_key TEXT NOT NULL DEFAULT '',
            api_secret TEXT NOT NULL DEFAULT '',
            symbol TEXT NOT NULL DEFAULT '',
            strategy_started_at TIMESTAMPTZ NULL,
            last_delta_sync_at TIMESTAMPTZ NULL,
            last_primary_db_sync_at TIMESTAMPTZ NULL,
            open_positions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
            ui_state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            runtime_state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            risk_state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            recovery_metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            last_order_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (user_id, strategy_code)
        );
    `);
}
