import path from "node:path";
import { readJsonFile, writeJsonFileAtomic } from "./json-store";
import { getPostgresPool, isPostgresConfigured } from "./postgres";

export type RollingFuturesLtStrategyCode = "rolling-futures-lt-long" | "rolling-futures-lt-short" | "rolling-futures-lt-dual";

export interface RollingFuturesLtConnectionStatus {
    state: "not_selected" | "checking" | "connected" | "warning" | "disconnected" | "auth_failed" | "rate_limited";
    message: string;
    outboundIp: string;
    lastCheckedAt: string;
    lastSuccessAt: string;
    consecutiveFailures: number;
    alertState: string;
    alertMessage: string;
    alertSentAt: string;
}

export interface RollingFuturesLtProfileRecord {
    userId: string;
    strategyCode: RollingFuturesLtStrategyCode;
    selectedApiProfileId: string;
    uiState: Record<string, unknown>;
    connectionStatus: RollingFuturesLtConnectionStatus;
    updatedAt: string;
}

export interface RollingFuturesLtImportedPositionRecord {
    userId: string;
    strategyCode: RollingFuturesLtStrategyCode;
    importId: string;
    contractName: string;
    side: string;
    qty: number;
    entryPrice: number;
    markPrice: number;
    charges: number;
    pnl: number;
    margin: number;
    liquidationPrice: number;
    metadata?: Record<string, unknown>;
    openedAt: string;
    updatedAt: string;
}

interface RollingFuturesLtProfileRow {
    user_id: string;
    strategy_code: RollingFuturesLtStrategyCode;
    selected_api_profile_id: string;
    ui_state_json: Record<string, unknown> | null;
    connection_status_json: RollingFuturesLtConnectionStatus | null;
    updated_at: string | Date;
}

interface RollingFuturesLtImportedPositionRow {
    user_id: string;
    strategy_code: RollingFuturesLtStrategyCode;
    import_id: string;
    contract_name: string;
    side: string;
    qty: number;
    entry_price: number;
    mark_price: number;
    charges: number;
    pnl: number;
    margin: number;
    liquidation_price: number;
    metadata_json?: Record<string, unknown> | null;
    opened_at: string | Date;
    updated_at: string | Date;
}

const gProfilesFile = path.resolve(process.cwd(), "data", "rolling-futures-lt", "profiles.json");
const gPositionsFile = path.resolve(process.cwd(), "data", "rolling-futures-lt", "positions.json");

function getDefaultConnectionStatus(): RollingFuturesLtConnectionStatus {
    return {
        state: "not_selected",
        message: "Select an API profile to start live connection checks.",
        outboundIp: "",
        lastCheckedAt: "",
        lastSuccessAt: "",
        consecutiveFailures: 0,
        alertState: "",
        alertMessage: "",
        alertSentAt: ""
    };
}

export function getDefaultRollingFuturesLtProfile(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode
): RollingFuturesLtProfileRecord {
    return {
        userId: String(pUserId || "").trim(),
        strategyCode: pStrategyCode,
        selectedApiProfileId: "",
        uiState: {},
        connectionStatus: getDefaultConnectionStatus(),
        updatedAt: ""
    };
}

async function loadAllProfilesJson(): Promise<RollingFuturesLtProfileRecord[]> {
    return readJsonFile<RollingFuturesLtProfileRecord[]>(gProfilesFile, []);
}

async function loadAllPositionsJson(): Promise<RollingFuturesLtImportedPositionRecord[]> {
    return readJsonFile<RollingFuturesLtImportedPositionRecord[]>(gPositionsFile, []);
}

function mapProfileRow(pRow?: RollingFuturesLtProfileRow | null): RollingFuturesLtProfileRecord | null {
    if (!pRow) {
        return null;
    }

    return {
        userId: String(pRow.user_id),
        strategyCode: pRow.strategy_code,
        selectedApiProfileId: String(pRow.selected_api_profile_id || ""),
        uiState: (pRow.ui_state_json ?? {}) as Record<string, unknown>,
        connectionStatus: {
            ...getDefaultConnectionStatus(),
            ...((pRow.connection_status_json ?? {}) as RollingFuturesLtConnectionStatus)
        },
        updatedAt: new Date(pRow.updated_at).toISOString()
    };
}

function normalizePositions(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pPositions: RollingFuturesLtImportedPositionRecord[]
): RollingFuturesLtImportedPositionRecord[] {
    const vUserId = String(pUserId || "").trim();
    const objByImportId = new Map<string, RollingFuturesLtImportedPositionRecord>();

    for (const objPosition of Array.isArray(pPositions) ? pPositions : []) {
        const vImportId = String(objPosition.importId || "").trim();
        if (!vImportId) {
            continue;
        }

        objByImportId.set(vImportId, {
            userId: vUserId,
            strategyCode: pStrategyCode,
            importId: vImportId,
            contractName: String(objPosition.contractName || "").trim(),
            side: String(objPosition.side || "").trim().toUpperCase(),
            qty: Number(objPosition.qty || 0),
            entryPrice: Number(objPosition.entryPrice || 0),
            markPrice: Number(objPosition.markPrice || 0),
            charges: Number(objPosition.charges || 0),
            pnl: Number(objPosition.pnl || 0),
            margin: Number(objPosition.margin || 0),
            liquidationPrice: Number(objPosition.liquidationPrice || 0),
            metadata: objPosition.metadata && typeof objPosition.metadata === "object"
                ? objPosition.metadata as Record<string, unknown>
                : undefined,
            openedAt: String(objPosition.openedAt || "").trim() || new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
    }

    return Array.from(objByImportId.values());
}

function mapPositionRow(pRow: RollingFuturesLtImportedPositionRow): RollingFuturesLtImportedPositionRecord {
    return {
        userId: String(pRow.user_id),
        strategyCode: pRow.strategy_code,
        importId: String(pRow.import_id),
        contractName: String(pRow.contract_name || ""),
        side: String(pRow.side || ""),
        qty: Number(pRow.qty || 0),
        entryPrice: Number(pRow.entry_price || 0),
        markPrice: Number(pRow.mark_price || 0),
        charges: Number(pRow.charges || 0),
        pnl: Number(pRow.pnl || 0),
        margin: Number(pRow.margin || 0),
        liquidationPrice: Number(pRow.liquidation_price || 0),
        metadata: pRow.metadata_json && typeof pRow.metadata_json === "object"
            ? pRow.metadata_json as Record<string, unknown>
            : undefined,
        openedAt: new Date(pRow.opened_at).toISOString(),
        updatedAt: new Date(pRow.updated_at).toISOString()
    };
}

export async function loadRollingFuturesLtProfile(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode
): Promise<RollingFuturesLtProfileRecord | null> {
    const vUserId = String(pUserId || "").trim();
    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        const objResult = await objPool.query<RollingFuturesLtProfileRow>(`
            SELECT user_id, strategy_code, selected_api_profile_id, ui_state_json, connection_status_json, updated_at
            FROM optionyze_rolling_futures_lt_profiles
            WHERE user_id = $1
              AND strategy_code = $2
        `, [vUserId, pStrategyCode]);
        return mapProfileRow(objResult.rows[0]);
    }

    const arrRows = await loadAllProfilesJson();
    return arrRows.find((objRow) => objRow.userId === vUserId && objRow.strategyCode === pStrategyCode) || null;
}

export async function saveRollingFuturesLtProfile(
    pProfile: RollingFuturesLtProfileRecord
): Promise<RollingFuturesLtProfileRecord> {
    const objProfile: RollingFuturesLtProfileRecord = {
        ...getDefaultRollingFuturesLtProfile(pProfile.userId, pProfile.strategyCode),
        ...pProfile,
        uiState: (pProfile.uiState ?? {}) as Record<string, unknown>,
        connectionStatus: {
            ...getDefaultConnectionStatus(),
            ...(pProfile.connectionStatus || {})
        },
        updatedAt: new Date().toISOString()
    };

    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        await objPool.query(`
            INSERT INTO optionyze_rolling_futures_lt_profiles (
                user_id,
                strategy_code,
                selected_api_profile_id,
                ui_state_json,
                connection_status_json,
                updated_at
            ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
            ON CONFLICT (user_id, strategy_code)
            DO UPDATE SET
                selected_api_profile_id = EXCLUDED.selected_api_profile_id,
                ui_state_json = EXCLUDED.ui_state_json,
                connection_status_json = EXCLUDED.connection_status_json,
                updated_at = EXCLUDED.updated_at
        `, [
            objProfile.userId,
            objProfile.strategyCode,
            objProfile.selectedApiProfileId,
            JSON.stringify(objProfile.uiState || {}),
            JSON.stringify(objProfile.connectionStatus || getDefaultConnectionStatus()),
            objProfile.updatedAt
        ]);
        return objProfile;
    }

    const arrRows = await loadAllProfilesJson();
    const arrOther = arrRows.filter((objRow) => !(objRow.userId === objProfile.userId && objRow.strategyCode === objProfile.strategyCode));
    arrOther.push(objProfile);
    await writeJsonFileAtomic(gProfilesFile, arrOther);
    return objProfile;
}

export async function listRollingFuturesLtImportedPositions(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode
): Promise<RollingFuturesLtImportedPositionRecord[]> {
    const vUserId = String(pUserId || "").trim();
    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        const objResult = await objPool.query<RollingFuturesLtImportedPositionRow>(`
            SELECT user_id, strategy_code, import_id, contract_name, side, qty, entry_price, mark_price, charges, pnl, margin, liquidation_price, metadata_json, opened_at, updated_at
            FROM optionyze_rolling_futures_lt_positions
            WHERE user_id = $1
              AND strategy_code = $2
            ORDER BY updated_at DESC, import_id ASC
        `, [vUserId, pStrategyCode]);
        return objResult.rows.map(mapPositionRow);
    }

    const arrRows = await loadAllPositionsJson();
    return arrRows
        .filter((objRow) => objRow.userId === vUserId && objRow.strategyCode === pStrategyCode)
        .sort((objA, objB) => String(objB.updatedAt).localeCompare(String(objA.updatedAt)));
}

export async function replaceRollingFuturesLtImportedPositions(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pPositions: RollingFuturesLtImportedPositionRecord[]
): Promise<RollingFuturesLtImportedPositionRecord[]> {
    const arrPositions = normalizePositions(pUserId, pStrategyCode, pPositions);

    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        const objClient = await objPool.connect();
        try {
            await objClient.query("BEGIN");
            await objClient.query(`
                DELETE FROM optionyze_rolling_futures_lt_positions
                WHERE user_id = $1
                  AND strategy_code = $2
            `, [pUserId, pStrategyCode]);
            for (const objPosition of arrPositions) {
                await objClient.query(`
                    INSERT INTO optionyze_rolling_futures_lt_positions (
                        user_id,
                        strategy_code,
                        import_id,
                        contract_name,
                        side,
                        qty,
                        entry_price,
                        mark_price,
                        charges,
                        pnl,
                        margin,
                        liquidation_price,
                        metadata_json,
                        opened_at,
                        updated_at
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15)
                    ON CONFLICT (user_id, strategy_code, import_id) DO UPDATE SET
                        contract_name = EXCLUDED.contract_name,
                        side = EXCLUDED.side,
                        qty = EXCLUDED.qty,
                        entry_price = EXCLUDED.entry_price,
                        mark_price = EXCLUDED.mark_price,
                        charges = EXCLUDED.charges,
                        pnl = EXCLUDED.pnl,
                        margin = EXCLUDED.margin,
                        liquidation_price = EXCLUDED.liquidation_price,
                        metadata_json = EXCLUDED.metadata_json,
                        opened_at = EXCLUDED.opened_at,
                        updated_at = EXCLUDED.updated_at
                `, [
                    objPosition.userId,
                    objPosition.strategyCode,
                    objPosition.importId,
                    objPosition.contractName,
                    objPosition.side,
                    objPosition.qty,
                    objPosition.entryPrice,
                    objPosition.markPrice,
                    objPosition.charges,
                    objPosition.pnl,
                    objPosition.margin,
                    objPosition.liquidationPrice,
                    JSON.stringify(objPosition.metadata || {}),
                    objPosition.openedAt,
                    objPosition.updatedAt
                ]);
            }
            await objClient.query("COMMIT");
        }
        catch (objError) {
            await objClient.query("ROLLBACK");
            throw objError;
        }
        finally {
            objClient.release();
        }
        return arrPositions;
    }

    const arrRows = await loadAllPositionsJson();
    const arrOther = arrRows.filter((objRow) => !(objRow.userId === pUserId && objRow.strategyCode === pStrategyCode));
    await writeJsonFileAtomic(gPositionsFile, [...arrOther, ...arrPositions]);
    return arrPositions;
}

export async function deleteRollingFuturesLtImportedPosition(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pImportId: string
): Promise<void> {
    const vUserId = String(pUserId || "").trim();
    const vImportId = String(pImportId || "").trim();
    if (!vUserId || !vImportId) {
        return;
    }

    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        await objPool.query(`
            DELETE FROM optionyze_rolling_futures_lt_positions
            WHERE user_id = $1
              AND strategy_code = $2
              AND import_id = $3
        `, [vUserId, pStrategyCode, vImportId]);
        return;
    }

    const arrRows = await loadAllPositionsJson();
    const arrFiltered = arrRows.filter((objRow) => !(
        objRow.userId === vUserId
        && objRow.strategyCode === pStrategyCode
        && objRow.importId === vImportId
    ));
    await writeJsonFileAtomic(gPositionsFile, arrFiltered);
}
