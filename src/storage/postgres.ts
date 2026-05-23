import { Pool } from "pg";

let gPool: Pool | null = null;

function shouldRecyclePoolForError(pError: unknown): boolean {
    const vMessage = pError instanceof Error
        ? String(pError.message || "").toLowerCase()
        : String((pError as { message?: unknown } | null)?.message || "").toLowerCase();

    return vMessage.includes("connection terminated unexpectedly")
        || vMessage.includes("connection ended unexpectedly")
        || vMessage.includes("client has encountered a connection error")
        || vMessage.includes("terminating connection due to administrator command")
        || vMessage.includes("server closed the connection unexpectedly");
}

export function isPrimaryDatabaseUnavailableError(pError: unknown): boolean {
    const vMessage = pError instanceof Error
        ? String(pError.message || "").toLowerCase()
        : String((pError as { message?: unknown } | null)?.message || "").toLowerCase();
    const vCode = String((pError as { code?: unknown } | null)?.code || "").trim().toLowerCase();

    return shouldRecyclePoolForError(pError)
        || vCode === "enotfound"
        || vCode === "econnrefused"
        || vCode === "econnreset"
        || vCode === "57p01"
        || vCode === "57p03"
        || vMessage.includes("database_url is not configured")
        || vMessage.includes("connection refused")
        || vMessage.includes("could not connect")
        || vMessage.includes("timeout expired")
        || vMessage.includes("econnreset")
        || vMessage.includes("enotfound")
        || vMessage.includes("the database system is starting up")
        || vMessage.includes("the database system is shutting down");
}

function attachPoolLifecycleHandlers(pPool: Pool): void {
    pPool.on("error", (objError: Error) => {
        console.error("[postgres] pool error:", objError.message);
        if (gPool === pPool) {
            gPool = null;
        }
    });
}

export async function resetPostgresPool(): Promise<void> {
    const objPool = gPool;
    gPool = null;
    if (!objPool) {
        return;
    }

    try {
        await objPool.end();
    }
    catch (_objError) {
    }
}

export function isPostgresConfigured(): boolean {
    return String(process.env.DATABASE_URL || "").trim().length > 0;
}

export function getPostgresPool(): Pool {
    if (!isPostgresConfigured()) {
        throw new Error("DATABASE_URL is not configured.");
    }

    if (gPool) {
        return gPool;
    }

    gPool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.PGSSLMODE === "disable"
            ? false
            : { rejectUnauthorized: false }
    });
    attachPoolLifecycleHandlers(gPool);

    return gPool;
}

export async function runPostgresQueryWithReconnect<TResult>(
    pRunner: (pPool: Pool) => Promise<TResult>
): Promise<TResult> {
    try {
        return await pRunner(getPostgresPool());
    }
    catch (objError) {
        if (!shouldRecyclePoolForError(objError)) {
            throw objError;
        }

        await resetPostgresPool();
        return await pRunner(getPostgresPool());
    }
}

export async function ensurePostgresSchema(): Promise<void> {
    if (!isPostgresConfigured()) {
        return;
    }

    const objPool = getPostgresPool();
    await objPool.query(`
        CREATE TABLE IF NOT EXISTS optionyze_users (
            user_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            is_active BOOLEAN NOT NULL DEFAULT true,
            strategy_type TEXT NOT NULL,
            capital NUMERIC NOT NULL DEFAULT 0,
            exchange TEXT NOT NULL,
            preferred_symbol TEXT NOT NULL DEFAULT '',
            notes TEXT NOT NULL DEFAULT '',
            api_key TEXT NOT NULL DEFAULT '',
            api_secret TEXT NOT NULL DEFAULT '',
            telegram_bot_token TEXT NOT NULL DEFAULT '',
            telegram_chat_id TEXT NOT NULL DEFAULT '',
            strategy_config JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    await objPool.query(`
        CREATE TABLE IF NOT EXISTS optionyze_runner_states (
            user_id TEXT PRIMARY KEY,
            strategy_type TEXT NOT NULL,
            status TEXT NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL,
            message TEXT NOT NULL DEFAULT '',
            state_json JSONB NOT NULL DEFAULT '{}'::jsonb
        );
    `);

    await objPool.query(`
        CREATE TABLE IF NOT EXISTS optionyze_strategyfo_paper_profiles (
            user_id TEXT PRIMARY KEY,
            api_key TEXT NOT NULL DEFAULT '',
            api_secret TEXT NOT NULL DEFAULT '',
            telegram_bot_token TEXT NOT NULL DEFAULT '',
            telegram_chat_id TEXT NOT NULL DEFAULT '',
            reference_name TEXT NOT NULL DEFAULT '',
            auto_trader_enabled BOOLEAN NOT NULL DEFAULT false,
            ui_state JSONB NOT NULL DEFAULT '{}'::jsonb,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    await objPool.query(`
        ALTER TABLE optionyze_strategyfo_paper_profiles
        ADD COLUMN IF NOT EXISTS reference_name TEXT NOT NULL DEFAULT '';
    `);

    await objPool.query(`
        CREATE TABLE IF NOT EXISTS optionyze_accounts (
            account_id TEXT PRIMARY KEY,
            full_name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            mobile_no TEXT NOT NULL DEFAULT '',
            telegram_chat_id TEXT NOT NULL DEFAULT '',
            password_hash TEXT NOT NULL,
            is_active BOOLEAN NOT NULL DEFAULT true,
            is_admin BOOLEAN NOT NULL DEFAULT false,
            exec_strategy BOOLEAN NOT NULL DEFAULT false,
            must_change_password BOOLEAN NOT NULL DEFAULT false,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    await objPool.query(`
        ALTER TABLE optionyze_accounts
        ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT NOT NULL DEFAULT '';
    `);
    await objPool.query(`
        ALTER TABLE optionyze_accounts
        ADD COLUMN IF NOT EXISTS exec_strategy BOOLEAN NOT NULL DEFAULT false;
    `);

    await objPool.query(`
        CREATE TABLE IF NOT EXISTS optionyze_strategy_execution_requests (
            request_id TEXT PRIMARY KEY,
            account_id TEXT NOT NULL REFERENCES optionyze_accounts(account_id) ON DELETE CASCADE,
            strategy_code TEXT NOT NULL,
            trigger_source TEXT NOT NULL,
            request_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);
    await objPool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_optionyze_strategy_execution_requests_account_unique
        ON optionyze_strategy_execution_requests(account_id);
    `);
    await objPool.query(`
        CREATE TABLE IF NOT EXISTS optionyze_admin_settings (
            setting_key TEXT PRIMARY KEY,
            setting_value_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    await objPool.query(`
        CREATE TABLE IF NOT EXISTS optionyze_rolling_futures_lt_profiles (
            user_id TEXT NOT NULL REFERENCES optionyze_accounts(account_id) ON DELETE CASCADE,
            strategy_code TEXT NOT NULL,
            selected_api_profile_id TEXT NOT NULL DEFAULT '',
            ui_state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            connection_status_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (user_id, strategy_code)
        );
    `);

    await objPool.query(`
        CREATE TABLE IF NOT EXISTS optionyze_rolling_futures_lt_positions (
            user_id TEXT NOT NULL REFERENCES optionyze_accounts(account_id) ON DELETE CASCADE,
            strategy_code TEXT NOT NULL,
            import_id TEXT NOT NULL,
            contract_name TEXT NOT NULL DEFAULT '',
            side TEXT NOT NULL DEFAULT '',
            qty NUMERIC NOT NULL DEFAULT 0,
            entry_price NUMERIC NOT NULL DEFAULT 0,
            mark_price NUMERIC NOT NULL DEFAULT 0,
            charges NUMERIC NOT NULL DEFAULT 0,
            pnl NUMERIC NOT NULL DEFAULT 0,
            margin NUMERIC NOT NULL DEFAULT 0,
            liquidation_price NUMERIC NOT NULL DEFAULT 0,
            metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (user_id, strategy_code, import_id)
        );
    `);

    await objPool.query(`
        ALTER TABLE optionyze_rolling_futures_lt_positions
        ADD COLUMN IF NOT EXISTS metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb;
    `);

    await objPool.query(`
        CREATE TABLE IF NOT EXISTS optionyze_rolling_futures_lt_runtime (
            user_id TEXT NOT NULL REFERENCES optionyze_accounts(account_id) ON DELETE CASCADE,
            strategy_code TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'idle',
            auto_trader_enabled BOOLEAN NOT NULL DEFAULT false,
            selected_api_profile_id TEXT NOT NULL DEFAULT '',
            current_symbol TEXT NOT NULL DEFAULT '',
            last_signal TEXT NOT NULL DEFAULT 'IDLE',
            last_cycle_at TIMESTAMPTZ NULL,
            last_error TEXT NOT NULL DEFAULT '',
            state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (user_id, strategy_code)
        );
    `);

    await objPool.query(`
        CREATE TABLE IF NOT EXISTS optionyze_strategy_leases (
            user_id TEXT NOT NULL REFERENCES optionyze_accounts(account_id) ON DELETE CASCADE,
            strategy_code TEXT NOT NULL,
            owner_server_id TEXT NOT NULL,
            owner_instance_id TEXT NOT NULL DEFAULT '',
            lease_token TEXT NOT NULL,
            lease_expires_at TIMESTAMPTZ NOT NULL,
            last_heartbeat_at TIMESTAMPTZ NOT NULL,
            takeover_generation INTEGER NOT NULL DEFAULT 0,
            metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (user_id, strategy_code)
        );
    `);

    await objPool.query(`
        CREATE TABLE IF NOT EXISTS optionyze_accounts (
            account_id TEXT PRIMARY KEY,
            full_name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            mobile_no TEXT NOT NULL DEFAULT '',
            telegram_chat_id TEXT NOT NULL DEFAULT '',
            password_hash TEXT NOT NULL,
            is_active BOOLEAN NOT NULL DEFAULT true,
            is_admin BOOLEAN NOT NULL DEFAULT false,
            exec_strategy BOOLEAN NOT NULL DEFAULT false,
            must_change_password BOOLEAN NOT NULL DEFAULT false,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    await objPool.query(`
        ALTER TABLE optionyze_accounts
        ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT NOT NULL DEFAULT '';
    `);
    await objPool.query(`
        ALTER TABLE optionyze_accounts
        ADD COLUMN IF NOT EXISTS exec_strategy BOOLEAN NOT NULL DEFAULT false;
    `);

    await objPool.query(`
        CREATE TABLE IF NOT EXISTS optionyze_strategy_execution_requests (
            request_id TEXT PRIMARY KEY,
            account_id TEXT NOT NULL REFERENCES optionyze_accounts(account_id) ON DELETE CASCADE,
            strategy_code TEXT NOT NULL,
            trigger_source TEXT NOT NULL,
            request_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);
    await objPool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_optionyze_strategy_execution_requests_account_unique
        ON optionyze_strategy_execution_requests(account_id);
    `);
    await objPool.query(`
        CREATE TABLE IF NOT EXISTS optionyze_admin_settings (
            setting_key TEXT PRIMARY KEY,
            setting_value_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    await objPool.query(`
        CREATE TABLE IF NOT EXISTS optionyze_delta_api_profiles (
            profile_id TEXT PRIMARY KEY,
            account_id TEXT NOT NULL REFERENCES optionyze_accounts(account_id) ON DELETE CASCADE,
            reference_name TEXT NOT NULL,
            api_key TEXT NOT NULL DEFAULT '',
            api_secret TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    await objPool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_optionyze_delta_api_profiles_account_reference
        ON optionyze_delta_api_profiles(account_id, LOWER(reference_name));
    `);

    await objPool.query(`
        CREATE INDEX IF NOT EXISTS idx_optionyze_delta_api_profiles_account_id
        ON optionyze_delta_api_profiles(account_id);
    `);

    await objPool.query(`
        CREATE TABLE IF NOT EXISTS optionyze_rolling_options_pt_de_events (
            event_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES optionyze_accounts(account_id) ON DELETE CASCADE,
            strategy_code TEXT NOT NULL,
            event_type TEXT NOT NULL,
            severity TEXT NOT NULL DEFAULT 'info',
            title TEXT NOT NULL DEFAULT '',
            message TEXT NOT NULL DEFAULT '',
            payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    await objPool.query(`
        CREATE INDEX IF NOT EXISTS idx_optionyze_rolling_options_pt_de_events_user_created
        ON optionyze_rolling_options_pt_de_events(user_id, strategy_code, created_at DESC);
    `);

    await objPool.query(`
        CREATE TABLE IF NOT EXISTS optionyze_sessions (
            session_id TEXT PRIMARY KEY,
            account_id TEXT NOT NULL REFERENCES optionyze_accounts(account_id) ON DELETE CASCADE,
            expires_at TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    await objPool.query(`
        CREATE INDEX IF NOT EXISTS idx_optionyze_sessions_account_id
        ON optionyze_sessions(account_id);
    `);

    await objPool.query(`
        CREATE INDEX IF NOT EXISTS idx_optionyze_sessions_expires_at
        ON optionyze_sessions(expires_at);
    `);
}


