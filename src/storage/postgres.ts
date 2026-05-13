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
        CREATE TABLE IF NOT EXISTS optionyze_rolling_options_pt_de_profiles (
            user_id TEXT PRIMARY KEY,
            ui_state JSONB NOT NULL DEFAULT '{}'::jsonb,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    await objPool.query(`
        CREATE TABLE IF NOT EXISTS optionyze_rolling_options_pt_de_runtime (
            user_id TEXT PRIMARY KEY,
            status TEXT NOT NULL DEFAULT 'idle',
            auto_trader_enabled BOOLEAN NOT NULL DEFAULT false,
            current_symbol TEXT NOT NULL DEFAULT '',
            current_contract_name TEXT NOT NULL DEFAULT '',
            current_expiry_mode TEXT NOT NULL DEFAULT '',
            current_expiry_date TEXT NOT NULL DEFAULT '',
            renko_enabled BOOLEAN NOT NULL DEFAULT false,
            renko_points NUMERIC NOT NULL DEFAULT 0,
            renko_source TEXT NOT NULL DEFAULT '',
            last_spot_price NUMERIC NULL,
            last_futures_price NUMERIC NULL,
            last_signal TEXT NOT NULL DEFAULT '',
            last_cycle_at TIMESTAMPTZ NULL,
            last_error TEXT NOT NULL DEFAULT '',
            state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    await objPool.query(`
        CREATE TABLE IF NOT EXISTS optionyze_rolling_options_lt_de_profiles (
            user_id TEXT PRIMARY KEY,
            selected_api_profile_id TEXT NOT NULL DEFAULT '',
            ui_state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            connection_status_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    await objPool.query(`
        ALTER TABLE optionyze_rolling_options_lt_de_profiles
        ADD COLUMN IF NOT EXISTS ui_state_json JSONB NOT NULL DEFAULT '{}'::jsonb;
    `);

    await objPool.query(`
        CREATE TABLE IF NOT EXISTS optionyze_rolling_options_lt_de_runtime (
            user_id TEXT PRIMARY KEY,
            status TEXT NOT NULL DEFAULT 'idle',
            auto_trader_enabled BOOLEAN NOT NULL DEFAULT false,
            selected_api_profile_id TEXT NOT NULL DEFAULT '',
            current_symbol TEXT NOT NULL DEFAULT '',
            current_contract_name TEXT NOT NULL DEFAULT '',
            current_expiry_mode TEXT NOT NULL DEFAULT '',
            current_expiry_date TEXT NOT NULL DEFAULT '',
            renko_enabled BOOLEAN NOT NULL DEFAULT false,
            renko_points NUMERIC NOT NULL DEFAULT 0,
            renko_source TEXT NOT NULL DEFAULT '',
            last_spot_price NUMERIC NULL,
            last_futures_price NUMERIC NULL,
            last_signal TEXT NOT NULL DEFAULT '',
            last_cycle_at TIMESTAMPTZ NULL,
            last_error TEXT NOT NULL DEFAULT '',
            state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    await objPool.query(`
        ALTER TABLE optionyze_rolling_options_lt_de_runtime
        ADD COLUMN IF NOT EXISTS current_symbol TEXT NOT NULL DEFAULT '';
    `);
    await objPool.query(`
        ALTER TABLE optionyze_rolling_options_lt_de_runtime
        ADD COLUMN IF NOT EXISTS current_contract_name TEXT NOT NULL DEFAULT '';
    `);
    await objPool.query(`
        ALTER TABLE optionyze_rolling_options_lt_de_runtime
        ADD COLUMN IF NOT EXISTS current_expiry_mode TEXT NOT NULL DEFAULT '';
    `);
    await objPool.query(`
        ALTER TABLE optionyze_rolling_options_lt_de_runtime
        ADD COLUMN IF NOT EXISTS current_expiry_date TEXT NOT NULL DEFAULT '';
    `);
    await objPool.query(`
        ALTER TABLE optionyze_rolling_options_lt_de_runtime
        ADD COLUMN IF NOT EXISTS renko_enabled BOOLEAN NOT NULL DEFAULT false;
    `);
    await objPool.query(`
        ALTER TABLE optionyze_rolling_options_lt_de_runtime
        ADD COLUMN IF NOT EXISTS renko_points NUMERIC NOT NULL DEFAULT 0;
    `);
    await objPool.query(`
        ALTER TABLE optionyze_rolling_options_lt_de_runtime
        ADD COLUMN IF NOT EXISTS renko_source TEXT NOT NULL DEFAULT '';
    `);
    await objPool.query(`
        ALTER TABLE optionyze_rolling_options_lt_de_runtime
        ADD COLUMN IF NOT EXISTS last_spot_price NUMERIC NULL;
    `);
    await objPool.query(`
        ALTER TABLE optionyze_rolling_options_lt_de_runtime
        ADD COLUMN IF NOT EXISTS last_futures_price NUMERIC NULL;
    `);
    await objPool.query(`
        ALTER TABLE optionyze_rolling_options_lt_de_runtime
        ADD COLUMN IF NOT EXISTS last_signal TEXT NOT NULL DEFAULT '';
    `);
    await objPool.query(`
        ALTER TABLE optionyze_rolling_options_lt_de_runtime
        ADD COLUMN IF NOT EXISTS last_cycle_at TIMESTAMPTZ NULL;
    `);
    await objPool.query(`
        ALTER TABLE optionyze_rolling_options_lt_de_runtime
        ADD COLUMN IF NOT EXISTS last_error TEXT NOT NULL DEFAULT '';
    `);
    await objPool.query(`
        ALTER TABLE optionyze_rolling_options_lt_de_runtime
        ADD COLUMN IF NOT EXISTS state_json JSONB NOT NULL DEFAULT '{}'::jsonb;
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
        CREATE TABLE IF NOT EXISTS optionyze_rolling_options_lt_de_positions (
            user_id TEXT NOT NULL REFERENCES optionyze_accounts(account_id) ON DELETE CASCADE,
            import_id TEXT NOT NULL,
            contract_name TEXT NOT NULL DEFAULT '',
            side TEXT NOT NULL DEFAULT '',
            qty NUMERIC NOT NULL DEFAULT 0,
            entry_price NUMERIC NOT NULL DEFAULT 0,
            mark_price NUMERIC NOT NULL DEFAULT 0,
            entry_delta NUMERIC NULL,
            current_delta NUMERIC NULL,
            charges NUMERIC NOT NULL DEFAULT 0,
            pnl NUMERIC NOT NULL DEFAULT 0,
            margin NUMERIC NOT NULL DEFAULT 0,
            liquidation_price NUMERIC NOT NULL DEFAULT 0,
            opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (user_id, import_id)
        );
    `);
    await objPool.query(`
        ALTER TABLE optionyze_rolling_options_lt_de_positions
        ADD COLUMN IF NOT EXISTS charges NUMERIC NOT NULL DEFAULT 0;
    `);
    await objPool.query(`
        ALTER TABLE optionyze_rolling_options_lt_de_positions
        ADD COLUMN IF NOT EXISTS entry_delta NUMERIC NULL;
    `);
    await objPool.query(`
        ALTER TABLE optionyze_rolling_options_lt_de_positions
        ADD COLUMN IF NOT EXISTS current_delta NUMERIC NULL;
    `);
    await objPool.query(`
        ALTER TABLE optionyze_rolling_options_lt_de_positions
        ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    `);
    await objPool.query(`
        ALTER TABLE optionyze_rolling_options_lt_de_positions
        ADD COLUMN IF NOT EXISTS metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb;
    `);
    await objPool.query(`
        DO $$
        DECLARE
            vConstraintName TEXT;
            vIsExpectedPk BOOLEAN;
        BEGIN
            SELECT tc.constraint_name = 'optionyze_rolling_options_lt_de_positions_pkey'
                   AND string_agg(kcu.column_name::TEXT, ',' ORDER BY kcu.ordinal_position) = 'user_id,import_id'
            INTO vIsExpectedPk
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
            WHERE tc.table_schema = 'public'
              AND tc.table_name = 'optionyze_rolling_options_lt_de_positions'
              AND tc.constraint_type = 'PRIMARY KEY'
            GROUP BY tc.constraint_name;

            IF vIsExpectedPk IS DISTINCT FROM TRUE THEN
                SELECT tc.constraint_name
                INTO vConstraintName
                FROM information_schema.table_constraints tc
                WHERE tc.table_schema = 'public'
                  AND tc.table_name = 'optionyze_rolling_options_lt_de_positions'
                  AND tc.constraint_type = 'PRIMARY KEY'
                LIMIT 1;

                IF vConstraintName IS NOT NULL THEN
                    EXECUTE format(
                        'ALTER TABLE optionyze_rolling_options_lt_de_positions DROP CONSTRAINT %I',
                        vConstraintName
                    );
                END IF;

                ALTER TABLE optionyze_rolling_options_lt_de_positions
                ADD CONSTRAINT optionyze_rolling_options_lt_de_positions_pkey PRIMARY KEY (user_id, import_id);
            END IF;
        END $$;
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
        CREATE TABLE IF NOT EXISTS optionyze_accounts (
            account_id TEXT PRIMARY KEY,
            full_name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            mobile_no TEXT NOT NULL DEFAULT '',
            telegram_chat_id TEXT NOT NULL DEFAULT '',
            password_hash TEXT NOT NULL,
            is_active BOOLEAN NOT NULL DEFAULT true,
            is_admin BOOLEAN NOT NULL DEFAULT false,
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
        CREATE TABLE IF NOT EXISTS optionyze_rolling_options_pt_de_positions (
            position_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES optionyze_accounts(account_id) ON DELETE CASCADE,
            group_id TEXT NOT NULL DEFAULT '',
            cycle_id TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL,
            symbol TEXT NOT NULL DEFAULT '',
            contract_name TEXT NOT NULL DEFAULT '',
            instrument_type TEXT NOT NULL DEFAULT 'OPTION',
            option_side TEXT NOT NULL DEFAULT '',
            action TEXT NOT NULL DEFAULT '',
            strike NUMERIC NULL,
            expiry_date TEXT NOT NULL DEFAULT '',
            qty NUMERIC NOT NULL DEFAULT 0,
            lot_size NUMERIC NOT NULL DEFAULT 0,
            entry_price NUMERIC NULL,
            exit_price NUMERIC NULL,
            mark_price NUMERIC NULL,
            entry_delta NUMERIC NULL,
            exit_delta NUMERIC NULL,
            charges NUMERIC NOT NULL DEFAULT 0,
            pnl NUMERIC NOT NULL DEFAULT 0,
            opened_reason TEXT NOT NULL DEFAULT '',
            closed_reason TEXT NOT NULL DEFAULT '',
            opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            closed_at TIMESTAMPTZ NULL,
            metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    await objPool.query(`
        CREATE INDEX IF NOT EXISTS idx_optionyze_rolling_options_pt_de_positions_user_status
        ON optionyze_rolling_options_pt_de_positions(user_id, status, opened_at DESC);
    `);

    await objPool.query(`
        CREATE INDEX IF NOT EXISTS idx_optionyze_rolling_options_pt_de_positions_user_closed_at
        ON optionyze_rolling_options_pt_de_positions(user_id, closed_at DESC);
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


