import crypto from "node:crypto";
import { getSurvivalPostgresPool, isSurvivalPostgresConfigured } from "./survival-postgres";
import type { AccountRecord, SurvivalAdminRecord, SurvivalAdminSessionRecord } from "../types/models";

interface SurvivalAdminRow {
    admin_id: string;
    primary_account_id: string;
    full_name: string;
    email: string;
    password_hash: string;
    is_active: boolean;
    created_at: string | Date;
    updated_at: string | Date;
    last_login_at: string | Date | null;
}

interface SurvivalAdminSessionRow {
    session_id: string;
    admin_id: string;
    expires_at: string | Date;
    created_at: string | Date;
    last_seen_at: string | Date;
}

function normalizeEmail(pEmail: string): string {
    return String(pEmail || "").trim().toLowerCase();
}

function mapSurvivalAdminRow(pRow?: SurvivalAdminRow | null): SurvivalAdminRecord | null {
    if (!pRow) {
        return null;
    }

    return {
        adminId: String(pRow.admin_id || "").trim(),
        primaryAccountId: String(pRow.primary_account_id || "").trim(),
        fullName: String(pRow.full_name || "").trim(),
        email: String(pRow.email || "").trim(),
        passwordHash: String(pRow.password_hash || ""),
        isActive: Boolean(pRow.is_active),
        createdAt: new Date(pRow.created_at).toISOString(),
        updatedAt: new Date(pRow.updated_at).toISOString(),
        lastLoginAt: pRow.last_login_at ? new Date(pRow.last_login_at).toISOString() : ""
    };
}

function mapSurvivalAdminSessionRow(pRow?: SurvivalAdminSessionRow | null): SurvivalAdminSessionRecord | null {
    if (!pRow) {
        return null;
    }

    return {
        sessionId: String(pRow.session_id || "").trim(),
        adminId: String(pRow.admin_id || "").trim(),
        expiresAt: new Date(pRow.expires_at).toISOString(),
        createdAt: new Date(pRow.created_at).toISOString(),
        lastSeenAt: new Date(pRow.last_seen_at).toISOString()
    };
}

export async function upsertSurvivalAdminFromPrimaryAccount(pAccount: AccountRecord): Promise<SurvivalAdminRecord | null> {
    if (!isSurvivalPostgresConfigured()) {
        return null;
    }

    if (!pAccount.isSurvivalAdmin || !pAccount.isActive) {
        await deleteSurvivalAdminByPrimaryAccountId(pAccount.accountId);
        return null;
    }

    const objPool = getSurvivalPostgresPool();
    const vNow = new Date().toISOString();
    const objResult = await objPool.query<SurvivalAdminRow>(`
        INSERT INTO optionyze_survival_admin_accounts (
            admin_id,
            primary_account_id,
            full_name,
            email,
            password_hash,
            is_active,
            created_at,
            updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (admin_id)
        DO UPDATE SET
            primary_account_id = EXCLUDED.primary_account_id,
            full_name = EXCLUDED.full_name,
            email = EXCLUDED.email,
            password_hash = EXCLUDED.password_hash,
            is_active = EXCLUDED.is_active,
            updated_at = EXCLUDED.updated_at
        RETURNING *
    `, [
        pAccount.accountId,
        pAccount.accountId,
        String(pAccount.fullName || "").trim(),
        normalizeEmail(pAccount.email),
        String(pAccount.passwordHash || ""),
        Boolean(pAccount.isActive),
        vNow,
        vNow
    ]);

    return mapSurvivalAdminRow(objResult.rows[0]);
}

export async function deleteSurvivalAdminByPrimaryAccountId(pPrimaryAccountId: string): Promise<void> {
    if (!isSurvivalPostgresConfigured()) {
        return;
    }

    const objPool = getSurvivalPostgresPool();
    await objPool.query(`
        DELETE FROM optionyze_survival_admin_accounts
        WHERE primary_account_id = $1
    `, [String(pPrimaryAccountId || "").trim()]);
}

export async function getSurvivalAdminByEmail(pEmail: string): Promise<SurvivalAdminRecord | null> {
    if (!isSurvivalPostgresConfigured()) {
        return null;
    }

    const objPool = getSurvivalPostgresPool();
    const objResult = await objPool.query<SurvivalAdminRow>(`
        SELECT *
        FROM optionyze_survival_admin_accounts
        WHERE email = $1
    `, [normalizeEmail(pEmail)]);

    return mapSurvivalAdminRow(objResult.rows[0]);
}

export async function getSurvivalAdminById(pAdminId: string): Promise<SurvivalAdminRecord | null> {
    if (!isSurvivalPostgresConfigured()) {
        return null;
    }

    const objPool = getSurvivalPostgresPool();
    const objResult = await objPool.query<SurvivalAdminRow>(`
        SELECT *
        FROM optionyze_survival_admin_accounts
        WHERE admin_id = $1
    `, [String(pAdminId || "").trim()]);

    return mapSurvivalAdminRow(objResult.rows[0]);
}

export async function createSurvivalAdminSession(pAdminId: string): Promise<SurvivalAdminSessionRecord> {
    if (!isSurvivalPostgresConfigured()) {
        throw new Error("Survival DB is not configured.");
    }

    const objPool = getSurvivalPostgresPool();
    const vSessionId = crypto.randomUUID();
    const vCreatedAt = new Date();
    const vExpiresAt = new Date(vCreatedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    const objResult = await objPool.query<SurvivalAdminSessionRow>(`
        INSERT INTO optionyze_survival_admin_sessions (
            session_id,
            admin_id,
            expires_at,
            created_at,
            last_seen_at
        ) VALUES ($1,$2,$3,$4,$5)
        RETURNING *
    `, [
        vSessionId,
        String(pAdminId || "").trim(),
        vExpiresAt.toISOString(),
        vCreatedAt.toISOString(),
        vCreatedAt.toISOString()
    ]);

    const objSession = mapSurvivalAdminSessionRow(objResult.rows[0]);
    if (!objSession) {
        throw new Error("Unable to create Survival Admin session.");
    }

    return objSession;
}

export async function getSurvivalAdminSessionById(pSessionId: string): Promise<SurvivalAdminSessionRecord | null> {
    if (!isSurvivalPostgresConfigured()) {
        return null;
    }

    const objPool = getSurvivalPostgresPool();
    const objResult = await objPool.query<SurvivalAdminSessionRow>(`
        SELECT *
        FROM optionyze_survival_admin_sessions
        WHERE session_id = $1
          AND expires_at > NOW()
    `, [String(pSessionId || "").trim()]);

    const objSession = mapSurvivalAdminSessionRow(objResult.rows[0]);
    if (!objSession) {
        return null;
    }

    await objPool.query(`
        UPDATE optionyze_survival_admin_sessions
        SET last_seen_at = NOW()
        WHERE session_id = $1
    `, [objSession.sessionId]);

    return {
        ...objSession,
        lastSeenAt: new Date().toISOString()
    };
}

export async function deleteSurvivalAdminSession(pSessionId: string): Promise<void> {
    if (!isSurvivalPostgresConfigured()) {
        return;
    }

    const objPool = getSurvivalPostgresPool();
    await objPool.query(`
        DELETE FROM optionyze_survival_admin_sessions
        WHERE session_id = $1
    `, [String(pSessionId || "").trim()]);
}

export async function deleteSurvivalAdminSessionsByAdminId(pAdminId: string): Promise<void> {
    if (!isSurvivalPostgresConfigured()) {
        return;
    }

    const objPool = getSurvivalPostgresPool();
    await objPool.query(`
        DELETE FROM optionyze_survival_admin_sessions
        WHERE admin_id = $1
    `, [String(pAdminId || "").trim()]);
}

export async function cleanupExpiredSurvivalAdminSessions(): Promise<void> {
    if (!isSurvivalPostgresConfigured()) {
        return;
    }

    const objPool = getSurvivalPostgresPool();
    await objPool.query(`
        DELETE FROM optionyze_survival_admin_sessions
        WHERE expires_at <= NOW()
    `);
}

export async function updateSurvivalAdminLastLogin(pAdminId: string): Promise<void> {
    if (!isSurvivalPostgresConfigured()) {
        return;
    }

    const objPool = getSurvivalPostgresPool();
    await objPool.query(`
        UPDATE optionyze_survival_admin_accounts
        SET last_login_at = NOW(),
            updated_at = NOW()
        WHERE admin_id = $1
    `, [String(pAdminId || "").trim()]);
}
