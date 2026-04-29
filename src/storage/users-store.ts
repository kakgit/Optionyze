import path from "node:path";
import { readJsonFile, writeJsonFileAtomic } from "./json-store";
import { getPostgresPool, isPostgresConfigured } from "./postgres";
import type { ManagedUserRecord, StrategyType, UserRecord } from "../types/models";

const gUsersFile = path.resolve(process.cwd(), "data", "users", "users.json");
const gDefaultStrategyType: StrategyType = "strategy-fo-greeks-paper";
const gDefaultExchange = "delta-exchange";

interface UserRow {
    user_id: string;
    name: string;
    email: string;
    is_active: boolean;
    strategy_type: UserRecord["strategyType"];
    capital: string | number;
    exchange: string;
    preferred_symbol: string;
    notes: string;
    api_key: string;
    api_secret: string;
    telegram_bot_token: string;
    telegram_chat_id: string;
    strategy_config: Record<string, unknown> | null;
}

interface ManagedUserRow {
    account_id: string;
    full_name: string;
    email: string;
    mobile_no: string;
    telegram_chat_id: string;
    account_active: boolean;
    is_admin: boolean;
    must_change_password: boolean;
    created_at: string | Date;
    updated_at: string | Date;
    strategy_type: StrategyType | null;
    capital: string | number | null;
    exchange: string | null;
    preferred_symbol: string | null;
    notes: string | null;
}

export interface UpsertManagedProfileInput {
    accountId: string;
    fullName: string;
    email: string;
    isActive: boolean;
    strategyType: StrategyType;
    capital: number;
    exchange: string;
    preferredSymbol: string;
    notes: string;
}

export async function loadUsers(): Promise<UserRecord[]> {
    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        const objResult = await objPool.query<UserRow>(`
            SELECT
                user_id,
                name,
                email,
                is_active,
                strategy_type,
                capital,
                exchange,
                preferred_symbol,
                notes,
                api_key,
                api_secret,
                telegram_bot_token,
                telegram_chat_id,
                strategy_config
            FROM optionyze_users
            ORDER BY name ASC, user_id ASC
        `);

        return objResult.rows.map((objRow: UserRow) => ({
            userId: String(objRow.user_id),
            name: String(objRow.name),
            email: String(objRow.email),
            isActive: Boolean(objRow.is_active),
            strategyType: objRow.strategy_type,
            capital: Number(objRow.capital || 0),
            exchange: String(objRow.exchange || ""),
            preferredSymbol: String(objRow.preferred_symbol || ""),
            notes: String(objRow.notes || ""),
            apiKey: String(objRow.api_key || ""),
            apiSecret: String(objRow.api_secret || ""),
            telegramBotToken: String(objRow.telegram_bot_token || ""),
            telegramChatId: String(objRow.telegram_chat_id || ""),
            strategyConfig: (objRow.strategy_config ?? {}) as Record<string, unknown>
        }));
    }

    return readJsonFile<UserRecord[]>(gUsersFile, []);
}

export async function loadManagedUsers(): Promise<ManagedUserRecord[]> {
    if (!isPostgresConfigured()) {
        throw new Error("PostgreSQL is required for admin user management.");
    }

    const objPool = getPostgresPool();
    const objResult = await objPool.query<ManagedUserRow>(`
        SELECT
            a.account_id,
            a.full_name,
            a.email,
            a.mobile_no,
            a.telegram_chat_id,
            a.is_active AS account_active,
            a.is_admin,
            a.must_change_password,
            a.created_at,
            a.updated_at,
            u.strategy_type,
            u.capital,
            u.exchange,
            u.preferred_symbol,
            u.notes
        FROM optionyze_accounts a
        LEFT JOIN optionyze_users u
            ON u.user_id = a.account_id
        ORDER BY a.created_at DESC, a.full_name ASC
    `);

    return objResult.rows.map((objRow: ManagedUserRow) => ({
        accountId: String(objRow.account_id),
        fullName: String(objRow.full_name || ""),
        email: String(objRow.email || ""),
        mobileNo: String(objRow.mobile_no || ""),
        telegramChatId: String(objRow.telegram_chat_id || ""),
        isActive: Boolean(objRow.account_active),
        isAdmin: Boolean(objRow.is_admin),
        mustChangePassword: Boolean(objRow.must_change_password),
        createdAt: new Date(objRow.created_at).toISOString(),
        updatedAt: new Date(objRow.updated_at).toISOString(),
        strategyType: (objRow.strategy_type || gDefaultStrategyType) as StrategyType,
        capital: Number(objRow.capital || 0),
        exchange: String(objRow.exchange || gDefaultExchange),
        preferredSymbol: String(objRow.preferred_symbol || ""),
        notes: String(objRow.notes || "")
    }));
}

export async function upsertManagedUserProfile(pInput: UpsertManagedProfileInput): Promise<void> {
    if (!isPostgresConfigured()) {
        throw new Error("PostgreSQL is required for managed profile updates.");
    }

    const objPool = getPostgresPool();
    const objExisting = await objPool.query<{ api_key: string; api_secret: string; telegram_bot_token: string; telegram_chat_id: string; strategy_config: Record<string, unknown> | null }>(`
        SELECT api_key, api_secret, telegram_bot_token, telegram_chat_id, strategy_config
        FROM optionyze_users
        WHERE user_id = $1
    `, [pInput.accountId]);
    const objRow = objExisting.rows[0];

    await objPool.query(`
        INSERT INTO optionyze_users (
            user_id,
            name,
            email,
            is_active,
            strategy_type,
            capital,
            exchange,
            preferred_symbol,
            notes,
            api_key,
            api_secret,
            telegram_bot_token,
            telegram_chat_id,
            strategy_config,
            created_at,
            updated_at
        ) VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9, $10,
            $11, $12, $13, $14::jsonb, NOW(), NOW()
        )
        ON CONFLICT (user_id)
        DO UPDATE SET
            name = EXCLUDED.name,
            email = EXCLUDED.email,
            is_active = EXCLUDED.is_active,
            strategy_type = EXCLUDED.strategy_type,
            capital = EXCLUDED.capital,
            exchange = EXCLUDED.exchange,
            preferred_symbol = EXCLUDED.preferred_symbol,
            notes = EXCLUDED.notes,
            updated_at = NOW()
    `, [
        pInput.accountId,
        String(pInput.fullName || "").trim(),
        String(pInput.email || "").trim().toLowerCase(),
        Boolean(pInput.isActive),
        pInput.strategyType || gDefaultStrategyType,
        Number(pInput.capital || 0),
        String(pInput.exchange || gDefaultExchange),
        String(pInput.preferredSymbol || ""),
        String(pInput.notes || ""),
        String(objRow?.api_key || ""),
        String(objRow?.api_secret || ""),
        String(objRow?.telegram_bot_token || ""),
        String(objRow?.telegram_chat_id || ""),
        JSON.stringify(objRow?.strategy_config || {})
    ]);
}

export async function deleteManagedUserProfile(pAccountId: string): Promise<void> {
    if (!isPostgresConfigured()) {
        throw new Error("PostgreSQL is required for managed profile deletion.");
    }

    const objPool = getPostgresPool();
    await objPool.query(`DELETE FROM optionyze_strategyfo_paper_profiles WHERE user_id = $1`, [pAccountId]);
    await objPool.query(`DELETE FROM optionyze_runner_states WHERE user_id = $1`, [pAccountId]);
    await objPool.query(`DELETE FROM optionyze_users WHERE user_id = $1`, [pAccountId]);
}

export async function saveUsers(pUsers: UserRecord[]): Promise<void> {
    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        await objPool.query("BEGIN");
        try {
            await objPool.query("DELETE FROM optionyze_users");
            for (const objUser of pUsers) {
                await objPool.query(`
                    INSERT INTO optionyze_users (
                        user_id,
                        name,
                        email,
                        is_active,
                        strategy_type,
                        capital,
                        exchange,
                        preferred_symbol,
                        notes,
                        api_key,
                        api_secret,
                        telegram_bot_token,
                        telegram_chat_id,
                        strategy_config
                    ) VALUES (
                        $1, $2, $3, $4, $5,
                        $6, $7, $8, $9, $10,
                        $11, $12, $13, $14::jsonb
                    )
                `, [
                    objUser.userId,
                    objUser.name,
                    objUser.email,
                    objUser.isActive,
                    objUser.strategyType,
                    objUser.capital,
                    objUser.exchange,
                    objUser.preferredSymbol || "",
                    objUser.notes || "",
                    objUser.apiKey || "",
                    objUser.apiSecret || "",
                    objUser.telegramBotToken || "",
                    objUser.telegramChatId || "",
                    JSON.stringify(objUser.strategyConfig || {})
                ]);
            }
            await objPool.query("COMMIT");
            return;
        }
        catch (objError) {
            await objPool.query("ROLLBACK");
            throw objError;
        }
    }

    await writeJsonFileAtomic(gUsersFile, pUsers);
}
