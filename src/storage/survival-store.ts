import crypto from "node:crypto";
import { getSurvivalPostgresPool, isSurvivalPostgresConfigured } from "./survival-postgres";

export interface SurvivalStateRecord {
    userId: string;
    strategyCode: string;
    strategyRunId: string;
    runTag: string;
    runStatus: "active" | "ended";
    ownerServerId: string;
    ownerInstanceId: string;
    leaseToken: string;
    leaseExpiresAt: string;
    lastHeartbeatAt: string;
    selectedApiProfileId: string;
    profileReferenceName: string;
    apiKey: string;
    apiSecret: string;
    symbol: string;
    strategyStartedAt: string;
    lastDeltaSyncAt: string;
    lastPrimaryDbSyncAt: string;
    openPositions: Record<string, unknown>[];
    uiState: Record<string, unknown>;
    runtimeState: Record<string, unknown>;
    riskState: Record<string, unknown>;
    recoveryMetrics: Record<string, unknown>;
    lastOrderRefs: string[];
    createdAt: string;
    updatedAt: string;
}

interface SurvivalStateRow {
    user_id: string;
    strategy_code: string;
    strategy_run_id: string;
    run_tag: string;
    run_status: "active" | "ended";
    owner_server_id: string;
    owner_instance_id: string;
    lease_token: string;
    lease_expires_at: string | Date | null;
    last_heartbeat_at: string | Date;
    selected_api_profile_id: string;
    profile_reference_name: string;
    api_key: string;
    api_secret: string;
    symbol: string;
    strategy_started_at: string | Date | null;
    last_delta_sync_at: string | Date | null;
    last_primary_db_sync_at: string | Date | null;
    open_positions_json: Record<string, unknown>[] | null;
    ui_state_json: Record<string, unknown> | null;
    runtime_state_json: Record<string, unknown> | null;
    risk_state_json: Record<string, unknown> | null;
    recovery_metrics_json: Record<string, unknown> | null;
    last_order_refs_json: string[] | null;
    created_at: string | Date;
    updated_at: string | Date;
}

export interface UpsertSurvivalStateInput {
    userId: string;
    strategyCode: string;
    strategyRunId: string;
    runTag: string;
    runStatus: "active" | "ended";
    ownerServerId: string;
    ownerInstanceId: string;
    leaseToken?: string;
    leaseExpiresAt?: string;
    lastHeartbeatAt?: string;
    selectedApiProfileId: string;
    profileReferenceName?: string;
    apiKey?: string;
    apiSecret?: string;
    symbol: string;
    strategyStartedAt?: string;
    lastDeltaSyncAt?: string;
    lastPrimaryDbSyncAt?: string;
    openPositions?: Record<string, unknown>[];
    uiState?: Record<string, unknown>;
    runtimeState?: Record<string, unknown>;
    riskState?: Record<string, unknown>;
    recoveryMetrics?: Record<string, unknown>;
    lastOrderRefs?: string[];
}

export interface AcquireSurvivalStateLeaseInput {
    userId: string;
    strategyCode: string;
    ownerServerId: string;
    ownerInstanceId?: string;
    leaseDurationMs: number;
}

export interface AcquireSurvivalStateLeaseResult {
    acquired: boolean;
    createdFresh: boolean;
    reason: "acquired" | "owned_by_other" | "missing_state" | "survival_not_configured";
    state: SurvivalStateRecord | null;
}

export interface RenewSurvivalStateLeaseInput {
    userId: string;
    strategyCode: string;
    ownerServerId: string;
    ownerInstanceId?: string;
    leaseToken: string;
    leaseDurationMs: number;
}

function mapSurvivalStateRow(pRow?: SurvivalStateRow | null): SurvivalStateRecord | null {
    if (!pRow) {
        return null;
    }
    return {
        userId: String(pRow.user_id || "").trim(),
        strategyCode: String(pRow.strategy_code || "").trim(),
        strategyRunId: String(pRow.strategy_run_id || "").trim(),
        runTag: String(pRow.run_tag || "").trim(),
        runStatus: pRow.run_status === "ended" ? "ended" : "active",
        ownerServerId: String(pRow.owner_server_id || "").trim(),
        ownerInstanceId: String(pRow.owner_instance_id || "").trim(),
        leaseToken: String(pRow.lease_token || "").trim(),
        leaseExpiresAt: pRow.lease_expires_at ? new Date(pRow.lease_expires_at).toISOString() : "",
        lastHeartbeatAt: new Date(pRow.last_heartbeat_at).toISOString(),
        selectedApiProfileId: String(pRow.selected_api_profile_id || "").trim(),
        profileReferenceName: String(pRow.profile_reference_name || "").trim(),
        apiKey: String(pRow.api_key || "").trim(),
        apiSecret: String(pRow.api_secret || "").trim(),
        symbol: String(pRow.symbol || "").trim(),
        strategyStartedAt: pRow.strategy_started_at ? new Date(pRow.strategy_started_at).toISOString() : "",
        lastDeltaSyncAt: pRow.last_delta_sync_at ? new Date(pRow.last_delta_sync_at).toISOString() : "",
        lastPrimaryDbSyncAt: pRow.last_primary_db_sync_at ? new Date(pRow.last_primary_db_sync_at).toISOString() : "",
        openPositions: Array.isArray(pRow.open_positions_json) ? pRow.open_positions_json : [],
        uiState: pRow.ui_state_json && typeof pRow.ui_state_json === "object" ? pRow.ui_state_json : {},
        runtimeState: pRow.runtime_state_json && typeof pRow.runtime_state_json === "object" ? pRow.runtime_state_json : {},
        riskState: pRow.risk_state_json && typeof pRow.risk_state_json === "object" ? pRow.risk_state_json : {},
        recoveryMetrics: pRow.recovery_metrics_json && typeof pRow.recovery_metrics_json === "object" ? pRow.recovery_metrics_json : {},
        lastOrderRefs: Array.isArray(pRow.last_order_refs_json) ? pRow.last_order_refs_json.map((v) => String(v || "").trim()).filter(Boolean) : [],
        createdAt: new Date(pRow.created_at).toISOString(),
        updatedAt: new Date(pRow.updated_at).toISOString()
    };
}

export async function upsertSurvivalState(pInput: UpsertSurvivalStateInput): Promise<SurvivalStateRecord | null> {
    if (!isSurvivalPostgresConfigured()) {
        return null;
    }

    const objPool = getSurvivalPostgresPool();
    const objResult = await objPool.query<SurvivalStateRow>(`
        INSERT INTO optionyze_survival_state (
            user_id,
            strategy_code,
            strategy_run_id,
            run_tag,
            run_status,
            owner_server_id,
            owner_instance_id,
            lease_token,
            lease_expires_at,
            last_heartbeat_at,
            selected_api_profile_id,
            profile_reference_name,
            api_key,
            api_secret,
            symbol,
            strategy_started_at,
            last_delta_sync_at,
            last_primary_db_sync_at,
            open_positions_json,
            ui_state_json,
            runtime_state_json,
            risk_state_json,
            recovery_metrics_json,
            last_order_refs_json,
            updated_at
        ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20::jsonb,$21::jsonb,$22::jsonb,$23::jsonb,$24::jsonb,NOW()
        )
        ON CONFLICT (user_id, strategy_code)
        DO UPDATE SET
            strategy_run_id = EXCLUDED.strategy_run_id,
            run_tag = EXCLUDED.run_tag,
            run_status = EXCLUDED.run_status,
            owner_server_id = EXCLUDED.owner_server_id,
            owner_instance_id = EXCLUDED.owner_instance_id,
            lease_token = EXCLUDED.lease_token,
            lease_expires_at = EXCLUDED.lease_expires_at,
            last_heartbeat_at = EXCLUDED.last_heartbeat_at,
            selected_api_profile_id = EXCLUDED.selected_api_profile_id,
            profile_reference_name = EXCLUDED.profile_reference_name,
            api_key = EXCLUDED.api_key,
            api_secret = EXCLUDED.api_secret,
            symbol = EXCLUDED.symbol,
            strategy_started_at = EXCLUDED.strategy_started_at,
            last_delta_sync_at = EXCLUDED.last_delta_sync_at,
            last_primary_db_sync_at = EXCLUDED.last_primary_db_sync_at,
            open_positions_json = EXCLUDED.open_positions_json,
            ui_state_json = EXCLUDED.ui_state_json,
            runtime_state_json = EXCLUDED.runtime_state_json,
            risk_state_json = EXCLUDED.risk_state_json,
            recovery_metrics_json = EXCLUDED.recovery_metrics_json,
            last_order_refs_json = EXCLUDED.last_order_refs_json,
            updated_at = NOW()
        RETURNING *
    `, [
        String(pInput.userId || "").trim(),
        String(pInput.strategyCode || "").trim(),
        String(pInput.strategyRunId || "").trim(),
        String(pInput.runTag || "").trim(),
        pInput.runStatus === "ended" ? "ended" : "active",
        String(pInput.ownerServerId || "").trim(),
        String(pInput.ownerInstanceId || "").trim(),
        String(pInput.leaseToken || "").trim(),
        String(pInput.leaseExpiresAt || "").trim() || null,
        String(pInput.lastHeartbeatAt || new Date().toISOString()).trim(),
        String(pInput.selectedApiProfileId || "").trim(),
        String(pInput.profileReferenceName || "").trim(),
        String(pInput.apiKey || "").trim(),
        String(pInput.apiSecret || "").trim(),
        String(pInput.symbol || "").trim(),
        String(pInput.strategyStartedAt || "").trim() || null,
        String(pInput.lastDeltaSyncAt || "").trim() || null,
        String(pInput.lastPrimaryDbSyncAt || new Date().toISOString()).trim() || null,
        JSON.stringify(Array.isArray(pInput.openPositions) ? pInput.openPositions : []),
        JSON.stringify(pInput.uiState && typeof pInput.uiState === "object" ? pInput.uiState : {}),
        JSON.stringify(pInput.runtimeState && typeof pInput.runtimeState === "object" ? pInput.runtimeState : {}),
        JSON.stringify(pInput.riskState && typeof pInput.riskState === "object" ? pInput.riskState : {}),
        JSON.stringify(pInput.recoveryMetrics && typeof pInput.recoveryMetrics === "object" ? pInput.recoveryMetrics : {}),
        JSON.stringify(Array.isArray(pInput.lastOrderRefs) ? pInput.lastOrderRefs : [])
    ]);
    return mapSurvivalStateRow(objResult.rows[0]);
}

export async function getSurvivalState(
    pUserId: string,
    pStrategyCode: string
): Promise<SurvivalStateRecord | null> {
    if (!isSurvivalPostgresConfigured()) {
        return null;
    }

    const objPool = getSurvivalPostgresPool();
    const objResult = await objPool.query<SurvivalStateRow>(`
        SELECT *
        FROM optionyze_survival_state
        WHERE user_id = $1
          AND strategy_code = $2
    `, [String(pUserId || "").trim(), String(pStrategyCode || "").trim()]);

    return mapSurvivalStateRow(objResult.rows[0]);
}

export async function listSurvivalStates(
    pStrategyCode = ""
): Promise<SurvivalStateRecord[]> {
    if (!isSurvivalPostgresConfigured()) {
        return [];
    }

    const objPool = getSurvivalPostgresPool();
    const objResult = await objPool.query<SurvivalStateRow>(`
        SELECT *
        FROM optionyze_survival_state
        WHERE ($1 = '' OR strategy_code = $1)
        ORDER BY updated_at DESC
    `, [String(pStrategyCode || "").trim()]);

    return objResult.rows
        .map((objRow) => mapSurvivalStateRow(objRow))
        .filter((objRow): objRow is SurvivalStateRecord => Boolean(objRow));
}

export async function acquireSurvivalStateLease(
    pInput: AcquireSurvivalStateLeaseInput
): Promise<AcquireSurvivalStateLeaseResult> {
    if (!isSurvivalPostgresConfigured()) {
        return {
            acquired: false,
            createdFresh: false,
            reason: "survival_not_configured",
            state: null
        };
    }

    const objPool = getSurvivalPostgresPool();
    const objClient = await objPool.connect();
    const vUserId = String(pInput.userId || "").trim();
    const vStrategyCode = String(pInput.strategyCode || "").trim();
    const vOwnerServerId = String(pInput.ownerServerId || "").trim();
    const vOwnerInstanceId = String(pInput.ownerInstanceId || "").trim() || vOwnerServerId;
    const vLeaseDurationMs = Math.max(10000, Math.floor(Number(pInput.leaseDurationMs || 30000)));
    const vNow = new Date();
    const vExpiresAt = new Date(vNow.getTime() + vLeaseDurationMs);

    try {
        await objClient.query("BEGIN");
        const objExisting = await objClient.query<SurvivalStateRow>(`
            SELECT *
            FROM optionyze_survival_state
            WHERE user_id = $1
              AND strategy_code = $2
            FOR UPDATE
        `, [vUserId, vStrategyCode]);

        const objCurrent = objExisting.rows[0];
        if (!objCurrent) {
            await objClient.query("COMMIT");
            return {
                acquired: false,
                createdFresh: false,
                reason: "missing_state",
                state: null
            };
        }

        const vCurrentExpiresAtMs = objCurrent.lease_expires_at
            ? new Date(objCurrent.lease_expires_at).getTime()
            : Number.NaN;
        const bOwnedByCaller = String(objCurrent.owner_server_id || "").trim() === vOwnerServerId
            && String(objCurrent.owner_instance_id || "").trim() === vOwnerInstanceId;
        const bExpired = !Number.isFinite(vCurrentExpiresAtMs) || vCurrentExpiresAtMs <= vNow.getTime();

        if (!bOwnedByCaller && !bExpired) {
            await objClient.query("COMMIT");
            return {
                acquired: false,
                createdFresh: false,
                reason: "owned_by_other",
                state: mapSurvivalStateRow(objCurrent)
            };
        }

        const vLeaseToken = crypto.randomUUID();
        const objUpdated = await objClient.query<SurvivalStateRow>(`
            UPDATE optionyze_survival_state
            SET owner_server_id = $3,
                owner_instance_id = $4,
                lease_token = $5,
                lease_expires_at = $6,
                last_heartbeat_at = $7,
                updated_at = NOW()
            WHERE user_id = $1
              AND strategy_code = $2
            RETURNING *
        `, [
            vUserId,
            vStrategyCode,
            vOwnerServerId,
            vOwnerInstanceId,
            vLeaseToken,
            vExpiresAt.toISOString(),
            vNow.toISOString()
        ]);
        await objClient.query("COMMIT");
        return {
            acquired: true,
            createdFresh: !bOwnedByCaller,
            reason: "acquired",
            state: mapSurvivalStateRow(objUpdated.rows[0])
        };
    }
    catch (objError) {
        await objClient.query("ROLLBACK").catch(() => undefined);
        throw objError;
    }
    finally {
        objClient.release();
    }
}

export async function renewSurvivalStateLease(
    pInput: RenewSurvivalStateLeaseInput
): Promise<SurvivalStateRecord | null> {
    if (!isSurvivalPostgresConfigured()) {
        return null;
    }

    const objPool = getSurvivalPostgresPool();
    const vNow = new Date();
    const vExpiresAt = new Date(vNow.getTime() + Math.max(10000, Math.floor(Number(pInput.leaseDurationMs || 30000))));
    const objResult = await objPool.query<SurvivalStateRow>(`
        UPDATE optionyze_survival_state
        SET lease_expires_at = $5,
            last_heartbeat_at = $6,
            updated_at = NOW()
        WHERE user_id = $1
          AND strategy_code = $2
          AND owner_server_id = $3
          AND owner_instance_id = $4
          AND lease_token = $7
        RETURNING *
    `, [
        String(pInput.userId || "").trim(),
        String(pInput.strategyCode || "").trim(),
        String(pInput.ownerServerId || "").trim(),
        String(pInput.ownerInstanceId || "").trim() || String(pInput.ownerServerId || "").trim(),
        vExpiresAt.toISOString(),
        vNow.toISOString(),
        String(pInput.leaseToken || "").trim()
    ]);

    return mapSurvivalStateRow(objResult.rows[0]);
}
