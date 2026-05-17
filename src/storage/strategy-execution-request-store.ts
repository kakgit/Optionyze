import crypto from "node:crypto";
import { getPostgresPool, isPostgresConfigured } from "./postgres";
import type { PendingStrategyExecutionRecord } from "../types/models";

interface PendingStrategyExecutionRow {
    request_id: string;
    account_id: string;
    full_name: string;
    email: string;
    exec_strategy: boolean;
    strategy_code: string;
    trigger_source: string;
    request_payload_json: Record<string, unknown> | null;
    created_at: string | Date;
    updated_at: string | Date;
}

export interface CreatePendingStrategyExecutionInput {
    accountId: string;
    strategyCode: string;
    triggerSource: string;
    requestPayload: Record<string, unknown>;
}

export async function listPendingStrategyExecutionRequests(): Promise<PendingStrategyExecutionRecord[]> {
    if (!isPostgresConfigured()) {
        throw new Error("PostgreSQL is required for pending strategy execution requests.");
    }

    const objPool = getPostgresPool();
    const objResult = await objPool.query<PendingStrategyExecutionRow>(`
        SELECT
            r.request_id,
            r.account_id,
            a.full_name,
            a.email,
            a.exec_strategy,
            r.strategy_code,
            r.trigger_source,
            r.request_payload_json,
            r.created_at,
            r.updated_at
        FROM optionyze_strategy_execution_requests r
        INNER JOIN optionyze_accounts a
            ON a.account_id = r.account_id
        ORDER BY r.created_at DESC, a.full_name ASC
    `);

    return objResult.rows.map(mapPendingStrategyExecutionRow);
}

export async function getNextAutoExecutablePendingStrategyRequest(): Promise<PendingStrategyExecutionRecord | null> {
    if (!isPostgresConfigured()) {
        throw new Error("PostgreSQL is required for pending strategy execution requests.");
    }

    const objPool = getPostgresPool();
    const objResult = await objPool.query<PendingStrategyExecutionRow>(`
        SELECT
            r.request_id,
            r.account_id,
            a.full_name,
            a.email,
            a.exec_strategy,
            r.strategy_code,
            r.trigger_source,
            r.request_payload_json,
            r.created_at,
            r.updated_at
        FROM optionyze_strategy_execution_requests r
        INNER JOIN optionyze_accounts a
            ON a.account_id = r.account_id
        WHERE a.exec_strategy = true
        ORDER BY r.created_at ASC, a.full_name ASC
        LIMIT 1
    `);

    return objResult.rows[0] ? mapPendingStrategyExecutionRow(objResult.rows[0]) : null;
}

export async function getPendingStrategyExecutionRequestById(pRequestId: string): Promise<PendingStrategyExecutionRecord | null> {
    if (!isPostgresConfigured()) {
        throw new Error("PostgreSQL is required for pending strategy execution requests.");
    }

    const objPool = getPostgresPool();
    const objResult = await objPool.query<PendingStrategyExecutionRow>(`
        SELECT
            r.request_id,
            r.account_id,
            a.full_name,
            a.email,
            a.exec_strategy,
            r.strategy_code,
            r.trigger_source,
            r.request_payload_json,
            r.created_at,
            r.updated_at
        FROM optionyze_strategy_execution_requests r
        INNER JOIN optionyze_accounts a
            ON a.account_id = r.account_id
        WHERE r.request_id = $1
    `, [pRequestId]);

    return objResult.rows[0] ? mapPendingStrategyExecutionRow(objResult.rows[0]) : null;
}

export async function createPendingStrategyExecutionRequest(
    pInput: CreatePendingStrategyExecutionInput
): Promise<PendingStrategyExecutionRecord> {
    if (!isPostgresConfigured()) {
        throw new Error("PostgreSQL is required for pending strategy execution requests.");
    }

    const objPool = getPostgresPool();
    const objExisting = await objPool.query<{ request_id: string }>(`
        SELECT request_id
        FROM optionyze_strategy_execution_requests
        WHERE account_id = $1
        LIMIT 1
    `, [pInput.accountId]);

    if (objExisting.rows[0]) {
        throw new Error("Strategy Execution is already active.");
    }

    const vRequestId = crypto.randomUUID();
    await objPool.query(`
        INSERT INTO optionyze_strategy_execution_requests (
            request_id,
            account_id,
            strategy_code,
            trigger_source,
            request_payload_json,
            created_at,
            updated_at
        ) VALUES ($1, $2, $3, $4, $5::jsonb, NOW(), NOW())
    `, [
        vRequestId,
        pInput.accountId,
        String(pInput.strategyCode || "").trim(),
        String(pInput.triggerSource || "").trim(),
        JSON.stringify(pInput.requestPayload || {})
    ]);

    const objRecord = await getPendingStrategyExecutionRequestById(vRequestId);
    if (!objRecord) {
        throw new Error("Unable to create pending strategy execution request.");
    }

    return objRecord;
}

export async function deletePendingStrategyExecutionRequest(pRequestId: string): Promise<void> {
    if (!isPostgresConfigured()) {
        throw new Error("PostgreSQL is required for pending strategy execution requests.");
    }

    const objPool = getPostgresPool();
    await objPool.query(`
        DELETE FROM optionyze_strategy_execution_requests
        WHERE request_id = $1
    `, [pRequestId]);
}

function mapPendingStrategyExecutionRow(pRow: PendingStrategyExecutionRow): PendingStrategyExecutionRecord {
    return {
        requestId: String(pRow.request_id || ""),
        accountId: String(pRow.account_id || ""),
        fullName: String(pRow.full_name || ""),
        email: String(pRow.email || ""),
        execStrategy: Boolean(pRow.exec_strategy),
        strategyCode: String(pRow.strategy_code || ""),
        triggerSource: String(pRow.trigger_source || ""),
        requestPayload: (pRow.request_payload_json ?? {}) as Record<string, unknown>,
        createdAt: new Date(pRow.created_at).toISOString(),
        updatedAt: new Date(pRow.updated_at).toISOString()
    };
}
