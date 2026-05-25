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

    await objPool.query(`
        CREATE TABLE IF NOT EXISTS optionyze_survival_admin_accounts (
            admin_id TEXT PRIMARY KEY,
            primary_account_id TEXT NOT NULL UNIQUE,
            full_name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            is_active BOOLEAN NOT NULL DEFAULT true,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_login_at TIMESTAMPTZ NULL
        );
    `);

    await objPool.query(`
        CREATE TABLE IF NOT EXISTS optionyze_survival_account_directory (
            account_id TEXT PRIMARY KEY,
            full_name TEXT NOT NULL,
            email TEXT NOT NULL,
            is_active BOOLEAN NOT NULL DEFAULT true,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    await objPool.query(`
        CREATE TABLE IF NOT EXISTS optionyze_survival_admin_sessions (
            session_id TEXT PRIMARY KEY,
            admin_id TEXT NOT NULL REFERENCES optionyze_survival_admin_accounts(admin_id) ON DELETE CASCADE,
            expires_at TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    await objPool.query(`
        CREATE INDEX IF NOT EXISTS idx_optionyze_survival_admin_sessions_admin_id
        ON optionyze_survival_admin_sessions(admin_id);
    `);

    await objPool.query(`
        CREATE INDEX IF NOT EXISTS idx_optionyze_survival_admin_sessions_expires_at
        ON optionyze_survival_admin_sessions(expires_at);
    `);
}
