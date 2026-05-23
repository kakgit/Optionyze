import crypto from "node:crypto";
import { getPostgresPool, isPostgresConfigured } from "./postgres";

export interface StrategyLeaseRecord {
    userId: string;
    strategyCode: string;
    ownerServerId: string;
    ownerInstanceId: string;
    leaseToken: string;
    leaseExpiresAt: string;
    lastHeartbeatAt: string;
    takeoverGeneration: number;
    metadata: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
}

interface StrategyLeaseRow {
    user_id: string;
    strategy_code: string;
    owner_server_id: string;
    owner_instance_id: string;
    lease_token: string;
    lease_expires_at: string | Date;
    last_heartbeat_at: string | Date;
    takeover_generation: number;
    metadata_json: Record<string, unknown> | null;
    created_at: string | Date;
    updated_at: string | Date;
}

export interface AcquireStrategyLeaseInput {
    userId: string;
    strategyCode: string;
    ownerServerId: string;
    ownerInstanceId?: string;
    leaseDurationMs: number;
    metadata?: Record<string, unknown>;
}

export interface AcquireStrategyLeaseResult {
    acquired: boolean;
    createdFresh: boolean;
    reason: "acquired" | "owned_by_other" | "postgres_not_configured";
    lease: StrategyLeaseRecord | null;
}

export interface RenewStrategyLeaseInput {
    userId: string;
    strategyCode: string;
    ownerServerId: string;
    ownerInstanceId?: string;
    leaseToken: string;
    leaseDurationMs: number;
    metadata?: Record<string, unknown>;
}

function mapStrategyLeaseRow(pRow?: StrategyLeaseRow | null): StrategyLeaseRecord | null {
    if (!pRow) {
        return null;
    }

    return {
        userId: String(pRow.user_id || "").trim(),
        strategyCode: String(pRow.strategy_code || "").trim(),
        ownerServerId: String(pRow.owner_server_id || "").trim(),
        ownerInstanceId: String(pRow.owner_instance_id || "").trim(),
        leaseToken: String(pRow.lease_token || "").trim(),
        leaseExpiresAt: new Date(pRow.lease_expires_at).toISOString(),
        lastHeartbeatAt: new Date(pRow.last_heartbeat_at).toISOString(),
        takeoverGeneration: Math.max(0, Number(pRow.takeover_generation || 0)),
        metadata: pRow.metadata_json && typeof pRow.metadata_json === "object"
            ? pRow.metadata_json as Record<string, unknown>
            : {},
        createdAt: new Date(pRow.created_at).toISOString(),
        updatedAt: new Date(pRow.updated_at).toISOString()
    };
}

export async function getStrategyLease(pUserId: string, pStrategyCode: string): Promise<StrategyLeaseRecord | null> {
    if (!isPostgresConfigured()) {
        return null;
    }

    const objPool = getPostgresPool();
    const objResult = await objPool.query<StrategyLeaseRow>(`
        SELECT
            user_id,
            strategy_code,
            owner_server_id,
            owner_instance_id,
            lease_token,
            lease_expires_at,
            last_heartbeat_at,
            takeover_generation,
            metadata_json,
            created_at,
            updated_at
        FROM optionyze_strategy_leases
        WHERE user_id = $1
          AND strategy_code = $2
    `, [String(pUserId || "").trim(), String(pStrategyCode || "").trim()]);

    return mapStrategyLeaseRow(objResult.rows[0]);
}

export async function acquireStrategyLease(
    pInput: AcquireStrategyLeaseInput
): Promise<AcquireStrategyLeaseResult> {
    if (!isPostgresConfigured()) {
        return {
            acquired: false,
            createdFresh: false,
            reason: "postgres_not_configured",
            lease: null
        };
    }

    const objPool = getPostgresPool();
    const objClient = await objPool.connect();
    const vUserId = String(pInput.userId || "").trim();
    const vStrategyCode = String(pInput.strategyCode || "").trim();
    const vOwnerServerId = String(pInput.ownerServerId || "").trim();
    const vOwnerInstanceId = String(pInput.ownerInstanceId || "").trim() || vOwnerServerId;
    const vLeaseDurationMs = Math.max(10000, Math.floor(Number(pInput.leaseDurationMs || 30000)));
    const vMetadata = pInput.metadata && typeof pInput.metadata === "object"
        ? pInput.metadata
        : {};
    const vNow = new Date();
    const vExpiresAt = new Date(vNow.getTime() + vLeaseDurationMs);

    try {
        await objClient.query("BEGIN");
        const objExisting = await objClient.query<StrategyLeaseRow>(`
            SELECT
                user_id,
                strategy_code,
                owner_server_id,
                owner_instance_id,
                lease_token,
                lease_expires_at,
                last_heartbeat_at,
                takeover_generation,
                metadata_json,
                created_at,
                updated_at
            FROM optionyze_strategy_leases
            WHERE user_id = $1
              AND strategy_code = $2
            FOR UPDATE
        `, [vUserId, vStrategyCode]);

        const objCurrent = objExisting.rows[0];
        if (!objCurrent) {
            const vLeaseToken = crypto.randomUUID();
            const objInserted = await objClient.query<StrategyLeaseRow>(`
                INSERT INTO optionyze_strategy_leases (
                    user_id,
                    strategy_code,
                    owner_server_id,
                    owner_instance_id,
                    lease_token,
                    lease_expires_at,
                    last_heartbeat_at,
                    takeover_generation,
                    metadata_json,
                    created_at,
                    updated_at
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,NOW(),NOW())
                RETURNING
                    user_id,
                    strategy_code,
                    owner_server_id,
                    owner_instance_id,
                    lease_token,
                    lease_expires_at,
                    last_heartbeat_at,
                    takeover_generation,
                    metadata_json,
                    created_at,
                    updated_at
            `, [
                vUserId,
                vStrategyCode,
                vOwnerServerId,
                vOwnerInstanceId,
                vLeaseToken,
                vExpiresAt.toISOString(),
                vNow.toISOString(),
                0,
                JSON.stringify(vMetadata)
            ]);
            await objClient.query("COMMIT");
            return {
                acquired: true,
                createdFresh: true,
                reason: "acquired",
                lease: mapStrategyLeaseRow(objInserted.rows[0])
            };
        }

        const vCurrentExpiresAtMs = new Date(objCurrent.lease_expires_at).getTime();
        const bOwnedByCaller = String(objCurrent.owner_server_id || "").trim() === vOwnerServerId
            && String(objCurrent.owner_instance_id || "").trim() === vOwnerInstanceId;
        const bExpired = !Number.isFinite(vCurrentExpiresAtMs) || vCurrentExpiresAtMs <= vNow.getTime();

        if (!bOwnedByCaller && !bExpired) {
            await objClient.query("COMMIT");
            return {
                acquired: false,
                createdFresh: false,
                reason: "owned_by_other",
                lease: mapStrategyLeaseRow(objCurrent)
            };
        }

        const vLeaseToken = crypto.randomUUID();
        const vNextGeneration = bOwnedByCaller
            ? Math.max(0, Number(objCurrent.takeover_generation || 0))
            : Math.max(0, Number(objCurrent.takeover_generation || 0)) + 1;
        const objUpdated = await objClient.query<StrategyLeaseRow>(`
            UPDATE optionyze_strategy_leases
            SET owner_server_id = $3,
                owner_instance_id = $4,
                lease_token = $5,
                lease_expires_at = $6,
                last_heartbeat_at = $7,
                takeover_generation = $8,
                metadata_json = $9::jsonb,
                updated_at = NOW()
            WHERE user_id = $1
              AND strategy_code = $2
            RETURNING
                user_id,
                strategy_code,
                owner_server_id,
                owner_instance_id,
                lease_token,
                lease_expires_at,
                last_heartbeat_at,
                takeover_generation,
                metadata_json,
                created_at,
                updated_at
        `, [
            vUserId,
            vStrategyCode,
            vOwnerServerId,
            vOwnerInstanceId,
            vLeaseToken,
            vExpiresAt.toISOString(),
            vNow.toISOString(),
            vNextGeneration,
            JSON.stringify(vMetadata)
        ]);
        await objClient.query("COMMIT");
        return {
            acquired: true,
            createdFresh: !bOwnedByCaller,
            reason: "acquired",
            lease: mapStrategyLeaseRow(objUpdated.rows[0])
        };
    }
    catch (objError) {
        await objClient.query("ROLLBACK");
        throw objError;
    }
    finally {
        objClient.release();
    }
}

export async function renewStrategyLease(
    pInput: RenewStrategyLeaseInput
): Promise<StrategyLeaseRecord | null> {
    if (!isPostgresConfigured()) {
        return null;
    }

    const vLeaseDurationMs = Math.max(10000, Math.floor(Number(pInput.leaseDurationMs || 30000)));
    const vNow = new Date();
    const vExpiresAt = new Date(vNow.getTime() + vLeaseDurationMs);
    const objPool = getPostgresPool();
    const objResult = await objPool.query<StrategyLeaseRow>(`
        UPDATE optionyze_strategy_leases
        SET lease_expires_at = $6,
            last_heartbeat_at = $7,
            metadata_json = $8::jsonb,
            updated_at = NOW()
        WHERE user_id = $1
          AND strategy_code = $2
          AND owner_server_id = $3
          AND owner_instance_id = $4
          AND lease_token = $5
        RETURNING
            user_id,
            strategy_code,
            owner_server_id,
            owner_instance_id,
            lease_token,
            lease_expires_at,
            last_heartbeat_at,
            takeover_generation,
            metadata_json,
            created_at,
            updated_at
    `, [
        String(pInput.userId || "").trim(),
        String(pInput.strategyCode || "").trim(),
        String(pInput.ownerServerId || "").trim(),
        String(pInput.ownerInstanceId || "").trim() || String(pInput.ownerServerId || "").trim(),
        String(pInput.leaseToken || "").trim(),
        vExpiresAt.toISOString(),
        vNow.toISOString(),
        JSON.stringify(pInput.metadata && typeof pInput.metadata === "object" ? pInput.metadata : {})
    ]);

    return mapStrategyLeaseRow(objResult.rows[0]);
}

export async function releaseStrategyLease(
    pUserId: string,
    pStrategyCode: string,
    pOwnerServerId: string,
    pOwnerInstanceId: string,
    pLeaseToken: string
): Promise<void> {
    if (!isPostgresConfigured()) {
        return;
    }

    const objPool = getPostgresPool();
    await objPool.query(`
        DELETE FROM optionyze_strategy_leases
        WHERE user_id = $1
          AND strategy_code = $2
          AND owner_server_id = $3
          AND owner_instance_id = $4
          AND lease_token = $5
    `, [
        String(pUserId || "").trim(),
        String(pStrategyCode || "").trim(),
        String(pOwnerServerId || "").trim(),
        String(pOwnerInstanceId || "").trim(),
        String(pLeaseToken || "").trim()
    ]);
}

export async function forceReleaseStrategyLease(
    pUserId: string,
    pStrategyCode: string
): Promise<void> {
    if (!isPostgresConfigured()) {
        return;
    }

    const objPool = getPostgresPool();
    await objPool.query(`
        DELETE FROM optionyze_strategy_leases
        WHERE user_id = $1
          AND strategy_code = $2
    `, [String(pUserId || "").trim(), String(pStrategyCode || "").trim()]);
}
