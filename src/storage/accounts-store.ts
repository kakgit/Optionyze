import crypto from "node:crypto";
import { hashPassword } from "../security/passwords";
import { getPostgresPool, isPostgresConfigured, runPostgresQueryWithReconnect } from "./postgres";
import {
    deleteSurvivalAdminByPrimaryAccountId,
    deleteSurvivalAdminSessionsByAdminId,
    upsertSurvivalAdminFromPrimaryAccount
} from "./survival-admin-store";
import {
    deleteSurvivalAccountDirectoryEntry,
    upsertSurvivalAccountDirectoryEntry
} from "./survival-account-directory-store";
import type { AccountRecord } from "../types/models";

const gBootstrapAdminDefaults = {
    fullName: process.env.BOOTSTRAP_ADMIN_NAME || "Anil Kumar K",
    email: process.env.BOOTSTRAP_ADMIN_EMAIL || "kamarthi.anil@gmail.com",
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD || "asd",
    mobileNo: process.env.BOOTSTRAP_ADMIN_MOBILE || "6301904398"
};

interface AccountRow {
    account_id: string;
    full_name: string;
    email: string;
    mobile_no: string;
    telegram_chat_id: string;
    password_hash: string;
    is_active: boolean;
    is_admin: boolean;
    is_survival_admin: boolean;
    is_verifier: boolean;
    exec_strategy: boolean;
    must_change_password: boolean;
    created_at: string | Date;
    updated_at: string | Date;
}

export interface CreateAccountInput {
    fullName: string;
    email: string;
    mobileNo: string;
    telegramChatId?: string;
    password: string;
    isAdmin?: boolean;
    isSurvivalAdmin?: boolean;
    isVerifier?: boolean;
    execStrategy?: boolean;
    isActive?: boolean;
    mustChangePassword?: boolean;
}

export interface UpdateAccountInput {
    fullName: string;
    email: string;
    mobileNo: string;
    telegramChatId?: string;
    isActive: boolean;
    isAdmin: boolean;
    isSurvivalAdmin: boolean;
    isVerifier: boolean;
    execStrategy: boolean;
    mustChangePassword: boolean;
}

export function normalizeEmail(pEmail: string): string {
    return String(pEmail || "").trim().toLowerCase();
}

export async function ensureBootstrapAdminAccount(): Promise<void> {
    if (!isPostgresConfigured()) {
        return;
    }

    const objExistingAdmin = await getAnyAdminAccount();
    if (objExistingAdmin) {
        return;
    }

    await createAccount({
        fullName: gBootstrapAdminDefaults.fullName,
        email: gBootstrapAdminDefaults.email,
        mobileNo: gBootstrapAdminDefaults.mobileNo,
        password: gBootstrapAdminDefaults.password,
        isAdmin: true,
        isActive: true,
        mustChangePassword: true
    });
}

export async function createAccount(pInput: CreateAccountInput): Promise<AccountRecord> {
    if (!isPostgresConfigured()) {
        throw new Error("PostgreSQL is required for account creation.");
    }

    const vEmail = normalizeEmail(pInput.email);
    const objPool = getPostgresPool();
    const objExisting = await objPool.query<AccountRow>(`
        SELECT account_id, full_name, email, mobile_no, telegram_chat_id, password_hash, is_active, is_admin, is_survival_admin, is_verifier, exec_strategy, must_change_password, created_at, updated_at
        FROM optionyze_accounts
        WHERE email = $1
    `, [vEmail]);

    if (objExisting.rows[0]) {
        throw new Error("An account with this email already exists.");
    }

    const vNow = new Date().toISOString();
    const vAccountId = crypto.randomUUID();
    const vPasswordHash = await hashPassword(pInput.password);

    await objPool.query(`
        INSERT INTO optionyze_accounts (
            account_id,
            full_name,
            email,
            mobile_no,
            telegram_chat_id,
            password_hash,
            is_active,
            is_admin,
            is_survival_admin,
            is_verifier,
            exec_strategy,
            must_change_password,
            created_at,
            updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    `, [
        vAccountId,
        String(pInput.fullName || "").trim(),
        vEmail,
        String(pInput.mobileNo || "").trim(),
        String(pInput.telegramChatId || "").trim(),
        vPasswordHash,
        pInput.isActive !== false,
        Boolean(pInput.isAdmin),
        Boolean(pInput.isSurvivalAdmin),
        Boolean(pInput.isVerifier),
        Boolean(pInput.execStrategy),
        Boolean(pInput.mustChangePassword),
        vNow,
        vNow
    ]);

    const objAccount = await getAccountById(vAccountId);
    if (!objAccount) {
        throw new Error("Failed to create account.");
    }
    await syncSurvivalAdminState(objAccount);

    return objAccount;
}

export async function getAccountByEmail(pEmail: string): Promise<AccountRecord | null> {
    if (!isPostgresConfigured()) {
        return null;
    }

    const objPool = getPostgresPool();
    const objResult = await objPool.query<AccountRow>(`
        SELECT account_id, full_name, email, mobile_no, telegram_chat_id, password_hash, is_active, is_admin, is_survival_admin, is_verifier, exec_strategy, must_change_password, created_at, updated_at
        FROM optionyze_accounts
        WHERE email = $1
    `, [normalizeEmail(pEmail)]);

    return mapAccountRow(objResult.rows[0]);
}

export async function getAccountById(pAccountId: string): Promise<AccountRecord | null> {
    if (!isPostgresConfigured()) {
        return null;
    }

    const objResult = await runPostgresQueryWithReconnect((pPool) => pPool.query<AccountRow>(`
        SELECT account_id, full_name, email, mobile_no, telegram_chat_id, password_hash, is_active, is_admin, is_survival_admin, is_verifier, exec_strategy, must_change_password, created_at, updated_at
        FROM optionyze_accounts
        WHERE account_id = $1
    `, [pAccountId]));

    return mapAccountRow(objResult.rows[0]);
}

export async function getAccountByTelegramChatId(pTelegramChatId: string): Promise<AccountRecord | null> {
    if (!isPostgresConfigured()) {
        return null;
    }

    const vTelegramChatId = String(pTelegramChatId || "").trim();
    if (!vTelegramChatId) {
        return null;
    }

    const objResult = await runPostgresQueryWithReconnect((pPool) => pPool.query<AccountRow>(`
        SELECT account_id, full_name, email, mobile_no, telegram_chat_id, password_hash, is_active, is_admin, is_survival_admin, is_verifier, exec_strategy, must_change_password, created_at, updated_at
        FROM optionyze_accounts
        WHERE telegram_chat_id = $1
        LIMIT 1
    `, [vTelegramChatId]));

    return mapAccountRow(objResult.rows[0]);
}

export async function updateAccount(pAccountId: string, pInput: UpdateAccountInput): Promise<AccountRecord> {
    if (!isPostgresConfigured()) {
        throw new Error("PostgreSQL is required for account updates.");
    }

    const objPool = getPostgresPool();
    const vEmail = normalizeEmail(pInput.email);
    const objExisting = await objPool.query<AccountRow>(`
        SELECT account_id
        FROM optionyze_accounts
        WHERE email = $1
          AND account_id <> $2
    `, [vEmail, pAccountId]);

    if (objExisting.rows[0]) {
        throw new Error("Another account is already using this email.");
    }

    await objPool.query(`
        UPDATE optionyze_accounts
        SET full_name = $2,
            email = $3,
            mobile_no = $4,
            telegram_chat_id = $5,
            is_active = $6,
            is_admin = $7,
            is_survival_admin = $8,
            is_verifier = $9,
            exec_strategy = $10,
            must_change_password = $11,
            updated_at = $12
        WHERE account_id = $1
    `, [
        pAccountId,
        String(pInput.fullName || "").trim(),
        vEmail,
        String(pInput.mobileNo || "").trim(),
        String(pInput.telegramChatId || "").trim(),
        Boolean(pInput.isActive),
        Boolean(pInput.isAdmin),
        Boolean(pInput.isSurvivalAdmin),
        Boolean(pInput.isVerifier),
        Boolean(pInput.execStrategy),
        Boolean(pInput.mustChangePassword),
        new Date().toISOString()
    ]);

    const objAccount = await getAccountById(pAccountId);
    if (!objAccount) {
        throw new Error("Account not found after update.");
    }
    await syncSurvivalAdminState(objAccount);

    return objAccount;
}

export async function updateAccountPassword(
    pAccountId: string,
    pNewPassword: string,
    pMustChangePassword: boolean
): Promise<void> {
    if (!isPostgresConfigured()) {
        throw new Error("PostgreSQL is required for password updates.");
    }

    const objPool = getPostgresPool();
    const vPasswordHash = await hashPassword(pNewPassword);
    await objPool.query(`
        UPDATE optionyze_accounts
        SET password_hash = $2,
            must_change_password = $3,
            updated_at = $4
        WHERE account_id = $1
    `, [pAccountId, vPasswordHash, pMustChangePassword, new Date().toISOString()]);
    const objAccount = await getAccountById(pAccountId);
    if (objAccount) {
        await syncSurvivalAdminState(objAccount);
    }
}

export async function deleteAccount(pAccountId: string): Promise<void> {
    if (!isPostgresConfigured()) {
        throw new Error("PostgreSQL is required for account deletion.");
    }

    await deleteSurvivalAdminByPrimaryAccountId(pAccountId);
    await deleteSurvivalAdminSessionsByAdminId(pAccountId);
    await deleteSurvivalAccountDirectoryEntry(pAccountId);
    const objPool = getPostgresPool();
    await objPool.query(`DELETE FROM optionyze_accounts WHERE account_id = $1`, [pAccountId]);
}

async function getAnyAdminAccount(): Promise<AccountRecord | null> {
    const objPool = getPostgresPool();
    const objResult = await objPool.query<AccountRow>(`
        SELECT account_id, full_name, email, mobile_no, telegram_chat_id, password_hash, is_active, is_admin, is_survival_admin, is_verifier, exec_strategy, must_change_password, created_at, updated_at
        FROM optionyze_accounts
        WHERE is_admin = true
        ORDER BY created_at ASC
        LIMIT 1
    `);

    return mapAccountRow(objResult.rows[0]);
}

function mapAccountRow(pRow?: AccountRow | null): AccountRecord | null {
    if (!pRow) {
        return null;
    }

    return {
        accountId: String(pRow.account_id),
        fullName: String(pRow.full_name || ""),
        email: String(pRow.email || ""),
        mobileNo: String(pRow.mobile_no || ""),
        telegramChatId: String(pRow.telegram_chat_id || ""),
        passwordHash: String(pRow.password_hash || ""),
        isActive: Boolean(pRow.is_active),
        isAdmin: Boolean(pRow.is_admin),
        isSurvivalAdmin: Boolean(pRow.is_survival_admin),
        isVerifier: Boolean(pRow.is_verifier),
        execStrategy: Boolean(pRow.exec_strategy),
        mustChangePassword: Boolean(pRow.must_change_password),
        createdAt: new Date(pRow.created_at).toISOString(),
        updatedAt: new Date(pRow.updated_at).toISOString()
    };
}

async function syncSurvivalAdminState(pAccount: AccountRecord): Promise<void> {
    await upsertSurvivalAccountDirectoryEntry({
        accountId: pAccount.accountId,
        fullName: pAccount.fullName,
        email: pAccount.email,
        isActive: pAccount.isActive
    });

    if (pAccount.isSurvivalAdmin && pAccount.isActive) {
        await upsertSurvivalAdminFromPrimaryAccount(pAccount);
        return;
    }

    await deleteSurvivalAdminByPrimaryAccountId(pAccount.accountId);
    await deleteSurvivalAdminSessionsByAdminId(pAccount.accountId);
}
