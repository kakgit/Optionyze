import crypto from "node:crypto";
import { getPostgresPool, isPostgresConfigured, runPostgresQueryWithReconnect } from "./postgres";
import type { SessionRecord } from "../types/models";

interface SessionRow {
    session_id: string;
    account_id: string;
    expires_at: string | Date;
    created_at: string | Date;
}

const gSessionTtlDays = 30;

export function getSessionCookieName(): string {
    return "optionyze_session";
}

export async function createSession(pAccountId: string): Promise<SessionRecord> {
    if (!isPostgresConfigured()) {
        throw new Error("PostgreSQL is required for session creation.");
    }

    const objPool = getPostgresPool();
    const vSessionId = crypto.randomBytes(32).toString("hex");
    const objNow = new Date();
    const objExpires = new Date(objNow.getTime() + gSessionTtlDays * 24 * 60 * 60 * 1000);

    await objPool.query(`
        INSERT INTO optionyze_sessions (session_id, account_id, expires_at, created_at)
        VALUES ($1, $2, $3, $4)
    `, [vSessionId, pAccountId, objExpires.toISOString(), objNow.toISOString()]);

    return {
        sessionId: vSessionId,
        accountId: pAccountId,
        expiresAt: objExpires.toISOString(),
        createdAt: objNow.toISOString()
    };
}

export async function getSessionById(pSessionId: string): Promise<SessionRecord | null> {
    if (!isPostgresConfigured() || !pSessionId) {
        return null;
    }

    const objResult = await runPostgresQueryWithReconnect((pPool) => pPool.query<SessionRow>(`
        SELECT session_id, account_id, expires_at, created_at
        FROM optionyze_sessions
        WHERE session_id = $1
    `, [pSessionId]));

    const objRow = objResult.rows[0];
    if (!objRow) {
        return null;
    }

    const objSession = mapSessionRow(objRow);
    if (!objSession) {
        return null;
    }

    if (new Date(objSession.expiresAt).getTime() <= Date.now()) {
        await deleteSession(pSessionId);
        return null;
    }

    return objSession;
}

export async function deleteSession(pSessionId: string): Promise<void> {
    if (!isPostgresConfigured() || !pSessionId) {
        return;
    }

    const objPool = getPostgresPool();
    await objPool.query(`DELETE FROM optionyze_sessions WHERE session_id = $1`, [pSessionId]);
}

export async function cleanupExpiredSessions(): Promise<void> {
    if (!isPostgresConfigured()) {
        return;
    }

    const objPool = getPostgresPool();
    await objPool.query(`DELETE FROM optionyze_sessions WHERE expires_at <= NOW()`);
}

function mapSessionRow(pRow?: SessionRow | null): SessionRecord | null {
    if (!pRow) {
        return null;
    }

    return {
        sessionId: String(pRow.session_id),
        accountId: String(pRow.account_id),
        expiresAt: new Date(pRow.expires_at).toISOString(),
        createdAt: new Date(pRow.created_at).toISOString()
    };
}
