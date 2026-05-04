import path from "node:path";
import { readJsonFile, writeJsonFileAtomic } from "./json-store";
import { getPostgresPool, isPostgresConfigured } from "./postgres";

export interface RollingOptionsLtDeImportedPositionRecord {
    userId: string;
    importId: string;
    contractName: string;
    side: string;
    qty: number;
    entryPrice: number;
    markPrice: number;
    entryDelta: number | null;
    currentDelta: number | null;
    charges: number;
    pnl: number;
    margin: number;
    liquidationPrice: number;
    openedAt: string;
    updatedAt: string;
}

interface RollingOptionsLtDeImportedPositionRow {
    user_id: string;
    import_id: string;
    contract_name: string;
    side: string;
    qty: number;
    entry_price: number;
    mark_price: number;
    entry_delta: number | null;
    current_delta: number | null;
    charges: number;
    pnl: number;
    margin: number;
    liquidation_price: number;
    opened_at: string | Date;
    updated_at: string | Date;
}

const gPositionsFile = path.resolve(process.cwd(), "data", "rolling-options-lt-de", "positions.json");

async function loadAllJson(): Promise<RollingOptionsLtDeImportedPositionRecord[]> {
    return readJsonFile<RollingOptionsLtDeImportedPositionRecord[]>(gPositionsFile, []);
}

function mapRow(pRow: RollingOptionsLtDeImportedPositionRow): RollingOptionsLtDeImportedPositionRecord {
    const vOpenedAt = pRow.opened_at ? new Date(pRow.opened_at) : new Date(pRow.updated_at);
    return {
        userId: String(pRow.user_id),
        importId: String(pRow.import_id),
        contractName: String(pRow.contract_name || ""),
        side: String(pRow.side || ""),
        qty: Number(pRow.qty || 0),
        entryPrice: Number(pRow.entry_price || 0),
        markPrice: Number(pRow.mark_price || 0),
        entryDelta: pRow.entry_delta === null || pRow.entry_delta === undefined ? null : Number(pRow.entry_delta),
        currentDelta: pRow.current_delta === null || pRow.current_delta === undefined ? null : Number(pRow.current_delta),
        charges: Number(pRow.charges || 0),
        pnl: Number(pRow.pnl || 0),
        margin: Number(pRow.margin || 0),
        liquidationPrice: Number(pRow.liquidation_price || 0),
        openedAt: Number.isNaN(vOpenedAt.getTime()) ? new Date(pRow.updated_at).toISOString() : vOpenedAt.toISOString(),
        updatedAt: new Date(pRow.updated_at).toISOString()
    };
}

export async function listRollingOptionsLtDeImportedPositions(pUserId: string): Promise<RollingOptionsLtDeImportedPositionRecord[]> {
    const vUserId = String(pUserId || "").trim();
    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        const objResult = await objPool.query<RollingOptionsLtDeImportedPositionRow>(`
            SELECT user_id, import_id, contract_name, side, qty, entry_price, mark_price, entry_delta, current_delta, charges, pnl, margin, liquidation_price, opened_at, updated_at
            FROM optionyze_rolling_options_lt_de_positions
            WHERE user_id = $1
            ORDER BY updated_at DESC, import_id ASC
        `, [vUserId]);
        return objResult.rows.map(mapRow);
    }

    const arrRows = await loadAllJson();
    return arrRows
        .filter((objRow) => objRow.userId === vUserId)
        .sort((objA, objB) => String(objB.updatedAt).localeCompare(String(objA.updatedAt)));
}

export async function replaceRollingOptionsLtDeImportedPositions(
    pUserId: string,
    pPositions: RollingOptionsLtDeImportedPositionRecord[]
): Promise<RollingOptionsLtDeImportedPositionRecord[]> {
    const vUserId = String(pUserId || "").trim();
    const arrPositions = (Array.isArray(pPositions) ? pPositions : []).map((pPosition) => ({
        userId: vUserId,
        importId: String(pPosition.importId || "").trim(),
        contractName: String(pPosition.contractName || "").trim(),
        side: String(pPosition.side || "").trim().toUpperCase(),
        qty: Number(pPosition.qty || 0),
        entryPrice: Number(pPosition.entryPrice || 0),
        markPrice: Number(pPosition.markPrice || 0),
        entryDelta: pPosition.entryDelta === null || pPosition.entryDelta === undefined ? null : Number(pPosition.entryDelta),
        currentDelta: pPosition.currentDelta === null || pPosition.currentDelta === undefined ? null : Number(pPosition.currentDelta),
        charges: Number(pPosition.charges || 0),
        pnl: Number(pPosition.pnl || 0),
        margin: Number(pPosition.margin || 0),
        liquidationPrice: Number(pPosition.liquidationPrice || 0),
        openedAt: String(pPosition.openedAt || "").trim() || new Date().toISOString(),
        updatedAt: new Date().toISOString()
    })).filter((objRow) => Boolean(objRow.importId));

    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        await objPool.query(`DELETE FROM optionyze_rolling_options_lt_de_positions WHERE user_id = $1`, [vUserId]);
        for (const objPosition of arrPositions) {
            await objPool.query(`
                INSERT INTO optionyze_rolling_options_lt_de_positions (
                    user_id,
                    import_id,
                    contract_name,
                    side,
                    qty,
                    entry_price,
                    mark_price,
                    entry_delta,
                    current_delta,
                    charges,
                    pnl,
                    margin,
                    liquidation_price,
                    opened_at,
                    updated_at
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
            `, [
                objPosition.userId,
                objPosition.importId,
                objPosition.contractName,
                objPosition.side,
                objPosition.qty,
                objPosition.entryPrice,
                objPosition.markPrice,
                objPosition.entryDelta,
                objPosition.currentDelta,
                objPosition.charges,
                objPosition.pnl,
                objPosition.margin,
                objPosition.liquidationPrice,
                objPosition.openedAt,
                objPosition.updatedAt
            ]);
        }
        return arrPositions;
    }

    const arrRows = await loadAllJson();
    const arrOther = arrRows.filter((objRow) => objRow.userId !== vUserId);
    await writeJsonFileAtomic(gPositionsFile, [...arrOther, ...arrPositions]);
    return arrPositions;
}

export async function deleteRollingOptionsLtDeImportedPosition(pUserId: string, pImportId: string): Promise<void> {
    const vUserId = String(pUserId || "").trim();
    const vImportId = String(pImportId || "").trim();
    if (!vUserId || !vImportId) {
        return;
    }

    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        await objPool.query(`
            DELETE FROM optionyze_rolling_options_lt_de_positions
            WHERE user_id = $1
              AND import_id = $2
        `, [vUserId, vImportId]);
        return;
    }

    const arrRows = await loadAllJson();
    await writeJsonFileAtomic(gPositionsFile, arrRows.filter((objRow) => !(objRow.userId === vUserId && objRow.importId === vImportId)));
}
