import path from "node:path";
import { readJsonFile, writeJsonFileAtomic } from "./json-store";
import { getPostgresPool, isPostgresConfigured } from "./postgres";

export interface RollingOptionsPtDePositionRecord {
    positionId: string;
    userId: string;
    groupId: string;
    cycleId: string;
    status: "OPEN" | "CLOSED";
    symbol: string;
    contractName: string;
    instrumentType: "OPTION" | "FUTURE";
    optionSide: "CE" | "PE" | "";
    action: "BUY" | "SELL" | "";
    strike: number | null;
    expiryDate: string;
    qty: number;
    lotSize: number;
    entryPrice: number | null;
    exitPrice: number | null;
    markPrice: number | null;
    entryDelta: number | null;
    exitDelta: number | null;
    charges: number;
    pnl: number;
    openedReason: string;
    closedReason: string;
    openedAt: string;
    closedAt: string;
    metadata: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
}

interface RollingOptionsPtDePositionRow {
    position_id: string;
    user_id: string;
    group_id: string;
    cycle_id: string;
    status: "OPEN" | "CLOSED";
    symbol: string;
    contract_name: string;
    instrument_type: "OPTION" | "FUTURE";
    option_side: "CE" | "PE" | "";
    action: "BUY" | "SELL" | "";
    strike: number | null;
    expiry_date: string;
    qty: number;
    lot_size: number;
    entry_price: number | null;
    exit_price: number | null;
    mark_price: number | null;
    entry_delta: number | null;
    exit_delta: number | null;
    charges: number;
    pnl: number;
    opened_reason: string;
    closed_reason: string;
    opened_at: string | Date;
    closed_at: string | Date | null;
    metadata_json: Record<string, unknown> | null;
    created_at: string | Date;
    updated_at: string | Date;
}

const gPositionsFile = path.resolve(process.cwd(), "data", "rolling-options-pt-de", "positions.json");

async function loadAllPositionsJson(): Promise<RollingOptionsPtDePositionRecord[]> {
    return readJsonFile<RollingOptionsPtDePositionRecord[]>(gPositionsFile, []);
}

function mapRowToPosition(pRow: RollingOptionsPtDePositionRow): RollingOptionsPtDePositionRecord {
    return {
        positionId: String(pRow.position_id),
        userId: String(pRow.user_id),
        groupId: String(pRow.group_id || ""),
        cycleId: String(pRow.cycle_id || ""),
        status: pRow.status,
        symbol: String(pRow.symbol || ""),
        contractName: String(pRow.contract_name || ""),
        instrumentType: pRow.instrument_type,
        optionSide: pRow.option_side,
        action: pRow.action,
        strike: pRow.strike === null ? null : Number(pRow.strike),
        expiryDate: String(pRow.expiry_date || ""),
        qty: Number(pRow.qty || 0),
        lotSize: Number(pRow.lot_size || 0),
        entryPrice: pRow.entry_price === null ? null : Number(pRow.entry_price),
        exitPrice: pRow.exit_price === null ? null : Number(pRow.exit_price),
        markPrice: pRow.mark_price === null ? null : Number(pRow.mark_price),
        entryDelta: pRow.entry_delta === null ? null : Number(pRow.entry_delta),
        exitDelta: pRow.exit_delta === null ? null : Number(pRow.exit_delta),
        charges: Number(pRow.charges || 0),
        pnl: Number(pRow.pnl || 0),
        openedReason: String(pRow.opened_reason || ""),
        closedReason: String(pRow.closed_reason || ""),
        openedAt: new Date(pRow.opened_at).toISOString(),
        closedAt: pRow.closed_at ? new Date(pRow.closed_at).toISOString() : "",
        metadata: (pRow.metadata_json ?? {}) as Record<string, unknown>,
        createdAt: new Date(pRow.created_at).toISOString(),
        updatedAt: new Date(pRow.updated_at).toISOString()
    };
}

export async function listRollingOptionsPtDeOpenPositions(pUserId: string): Promise<RollingOptionsPtDePositionRecord[]> {
    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        const objResult = await objPool.query<RollingOptionsPtDePositionRow>(`
            SELECT *
            FROM optionyze_rolling_options_pt_de_positions
            WHERE user_id = $1
              AND status = 'OPEN'
            ORDER BY opened_at DESC, created_at DESC
        `, [pUserId]);

        return objResult.rows.map(mapRowToPosition);
    }

    const objRows = await loadAllPositionsJson();
    return objRows
        .filter((objRow) => objRow.userId === pUserId && objRow.status === "OPEN")
        .sort((objA, objB) => String(objB.openedAt).localeCompare(String(objA.openedAt)));
}

export async function listRollingOptionsPtDeClosedPositions(
    pUserId: string,
    pFilters?: { fromDate?: string; toDate?: string; }
): Promise<RollingOptionsPtDePositionRecord[]> {
    const vFromDate = String(pFilters?.fromDate || "").trim();
    const vToDate = String(pFilters?.toDate || "").trim();

    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        const objResult = await objPool.query<RollingOptionsPtDePositionRow>(`
            SELECT *
            FROM optionyze_rolling_options_pt_de_positions
            WHERE user_id = $1
              AND status = 'CLOSED'
              AND ($2 = '' OR closed_at >= $2::timestamptz)
              AND ($3 = '' OR closed_at <= $3::timestamptz)
            ORDER BY closed_at DESC, updated_at DESC
        `, [pUserId, vFromDate, vToDate]);

        return objResult.rows.map(mapRowToPosition);
    }

    const objRows = await loadAllPositionsJson();
    return objRows
        .filter((objRow) => {
            if (objRow.userId !== pUserId || objRow.status !== "CLOSED") {
                return false;
            }

            const vClosedAt = String(objRow.closedAt || "");
            if (vFromDate && vClosedAt && vClosedAt < vFromDate) {
                return false;
            }
            if (vToDate && vClosedAt && vClosedAt > vToDate) {
                return false;
            }
            return true;
        })
        .sort((objA, objB) => String(objB.closedAt).localeCompare(String(objA.closedAt)));
}

export async function saveRollingOptionsPtDePosition(
    pPosition: RollingOptionsPtDePositionRecord
): Promise<RollingOptionsPtDePositionRecord> {
    const vNow = new Date().toISOString();
    const objPosition: RollingOptionsPtDePositionRecord = {
        ...pPosition,
        createdAt: pPosition.createdAt || vNow,
        updatedAt: vNow
    };

    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        await objPool.query(`
            INSERT INTO optionyze_rolling_options_pt_de_positions (
                position_id,
                user_id,
                group_id,
                cycle_id,
                status,
                symbol,
                contract_name,
                instrument_type,
                option_side,
                action,
                strike,
                expiry_date,
                qty,
                lot_size,
                entry_price,
                exit_price,
                mark_price,
                entry_delta,
                exit_delta,
                charges,
                pnl,
                opened_reason,
                closed_reason,
                opened_at,
                closed_at,
                metadata_json,
                created_at,
                updated_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26::jsonb, $27, $28
            )
            ON CONFLICT (position_id)
            DO UPDATE SET
                group_id = EXCLUDED.group_id,
                cycle_id = EXCLUDED.cycle_id,
                status = EXCLUDED.status,
                symbol = EXCLUDED.symbol,
                contract_name = EXCLUDED.contract_name,
                instrument_type = EXCLUDED.instrument_type,
                option_side = EXCLUDED.option_side,
                action = EXCLUDED.action,
                strike = EXCLUDED.strike,
                expiry_date = EXCLUDED.expiry_date,
                qty = EXCLUDED.qty,
                lot_size = EXCLUDED.lot_size,
                entry_price = EXCLUDED.entry_price,
                exit_price = EXCLUDED.exit_price,
                mark_price = EXCLUDED.mark_price,
                entry_delta = EXCLUDED.entry_delta,
                exit_delta = EXCLUDED.exit_delta,
                charges = EXCLUDED.charges,
                pnl = EXCLUDED.pnl,
                opened_reason = EXCLUDED.opened_reason,
                closed_reason = EXCLUDED.closed_reason,
                opened_at = EXCLUDED.opened_at,
                closed_at = EXCLUDED.closed_at,
                metadata_json = EXCLUDED.metadata_json,
                updated_at = EXCLUDED.updated_at
        `, [
            objPosition.positionId,
            objPosition.userId,
            objPosition.groupId,
            objPosition.cycleId,
            objPosition.status,
            objPosition.symbol,
            objPosition.contractName,
            objPosition.instrumentType,
            objPosition.optionSide,
            objPosition.action,
            objPosition.strike,
            objPosition.expiryDate,
            objPosition.qty,
            objPosition.lotSize,
            objPosition.entryPrice,
            objPosition.exitPrice,
            objPosition.markPrice,
            objPosition.entryDelta,
            objPosition.exitDelta,
            objPosition.charges,
            objPosition.pnl,
            objPosition.openedReason,
            objPosition.closedReason,
            objPosition.openedAt,
            objPosition.closedAt || null,
            JSON.stringify(objPosition.metadata || {}),
            objPosition.createdAt,
            objPosition.updatedAt
        ]);

        return objPosition;
    }

    const objRows = await loadAllPositionsJson();
    const objOtherRows = objRows.filter((objRow) => objRow.positionId !== objPosition.positionId);
    objOtherRows.push(objPosition);
    await writeJsonFileAtomic(gPositionsFile, objOtherRows);
    return objPosition;
}

export async function clearRollingOptionsPtDeClosedPositions(pUserId: string): Promise<number> {
    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        const objResult = await objPool.query(`
            DELETE FROM optionyze_rolling_options_pt_de_positions
            WHERE user_id = $1
              AND status = 'CLOSED'
        `, [pUserId]);
        return Number(objResult.rowCount || 0);
    }

    const objRows = await loadAllPositionsJson();
    const vBeforeCount = objRows.length;
    const objRemainingRows = objRows.filter((objRow) => !(objRow.userId === pUserId && objRow.status === "CLOSED"));
    await writeJsonFileAtomic(gPositionsFile, objRemainingRows);
    return vBeforeCount - objRemainingRows.length;
}

export async function deleteRollingOptionsPtDeOpenPosition(
    pUserId: string,
    pPositionId: string
): Promise<boolean> {
    const vPositionId = String(pPositionId || "").trim();
    if (!vPositionId) {
        return false;
    }

    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        const objResult = await objPool.query(`
            DELETE FROM optionyze_rolling_options_pt_de_positions
            WHERE user_id = $1
              AND position_id = $2
              AND status = 'OPEN'
        `, [pUserId, vPositionId]);
        return Number(objResult.rowCount || 0) > 0;
    }

    const objRows = await loadAllPositionsJson();
    const objRemainingRows = objRows.filter((objRow) => {
        return !(objRow.userId === pUserId && objRow.positionId === vPositionId && objRow.status === "OPEN");
    });

    if (objRemainingRows.length === objRows.length) {
        return false;
    }

    await writeJsonFileAtomic(gPositionsFile, objRemainingRows);
    return true;
}
