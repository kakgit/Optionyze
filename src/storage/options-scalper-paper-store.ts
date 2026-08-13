import crypto from "node:crypto";
import path from "node:path";
import { readJsonFile, writeJsonFileAtomic } from "./json-store";
import { getPostgresPool, isPostgresConfigured } from "./postgres";
import type { RollingFuturesLtStrategyCode } from "./rolling-futures-lt-store";

export interface OptionsScalperPaperClosedPositionRecord {
    closeId: string;
    userId: string;
    strategyCode: RollingFuturesLtStrategyCode;
    contractName: string;
    side: string;
    qty: number;
    buyPrice: number | null;
    sellPrice: number | null;
    charges: number;
    pnl: number;
    startAt: string;
    endAt: string;
    metadata?: Record<string, unknown>;
    updatedAt: string;
}

interface OptionsScalperPaperClosedPositionRow {
    close_id: string;
    user_id: string;
    strategy_code: RollingFuturesLtStrategyCode;
    contract_name: string;
    side: string;
    qty: number;
    buy_price: number | null;
    sell_price: number | null;
    charges: number;
    pnl: number;
    start_at: string | Date;
    end_at: string | Date;
    metadata_json: Record<string, unknown> | null;
    updated_at: string | Date;
}

const gClosedPositionsFile = path.resolve(process.cwd(), "data", "options-scalper", "closed-positions.json");

async function loadAllClosedPositionsJson(): Promise<OptionsScalperPaperClosedPositionRecord[]> {
    return readJsonFile<OptionsScalperPaperClosedPositionRecord[]>(gClosedPositionsFile, []);
}

function normalizeClosedPositions(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pRows: OptionsScalperPaperClosedPositionRecord[]
): OptionsScalperPaperClosedPositionRecord[] {
    return (Array.isArray(pRows) ? pRows : []).map((objRow) => ({
        closeId: String(objRow.closeId || "").trim() || crypto.randomUUID(),
        userId: String(pUserId || "").trim(),
        strategyCode: pStrategyCode,
        contractName: String(objRow.contractName || "").trim(),
        side: String(objRow.side || "").trim().toUpperCase(),
        qty: Number(objRow.qty || 0),
        buyPrice: Number.isFinite(Number(objRow.buyPrice)) ? Number(objRow.buyPrice) : null,
        sellPrice: Number.isFinite(Number(objRow.sellPrice)) ? Number(objRow.sellPrice) : null,
        charges: Number(objRow.charges || 0),
        pnl: Number(objRow.pnl || 0),
        startAt: String(objRow.startAt || "").trim() || new Date().toISOString(),
        endAt: String(objRow.endAt || "").trim() || new Date().toISOString(),
        metadata: objRow.metadata && typeof objRow.metadata === "object"
            ? objRow.metadata as Record<string, unknown>
            : undefined,
        updatedAt: new Date().toISOString()
    }));
}

function mapClosedPositionRow(pRow: OptionsScalperPaperClosedPositionRow): OptionsScalperPaperClosedPositionRecord {
    return {
        closeId: String(pRow.close_id || "").trim(),
        userId: String(pRow.user_id || "").trim(),
        strategyCode: pRow.strategy_code,
        contractName: String(pRow.contract_name || "").trim(),
        side: String(pRow.side || "").trim().toUpperCase(),
        qty: Number(pRow.qty || 0),
        buyPrice: Number.isFinite(Number(pRow.buy_price)) ? Number(pRow.buy_price) : null,
        sellPrice: Number.isFinite(Number(pRow.sell_price)) ? Number(pRow.sell_price) : null,
        charges: Number(pRow.charges || 0),
        pnl: Number(pRow.pnl || 0),
        startAt: new Date(pRow.start_at).toISOString(),
        endAt: new Date(pRow.end_at).toISOString(),
        metadata: pRow.metadata_json && typeof pRow.metadata_json === "object"
            ? pRow.metadata_json as Record<string, unknown>
            : undefined,
        updatedAt: new Date(pRow.updated_at).toISOString()
    };
}

export async function listOptionsScalperPaperClosedPositions(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode
): Promise<OptionsScalperPaperClosedPositionRecord[]> {
    const vUserId = String(pUserId || "").trim();
    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        const objResult = await objPool.query<OptionsScalperPaperClosedPositionRow>(`
            SELECT
                close_id,
                user_id,
                strategy_code,
                contract_name,
                side,
                qty,
                buy_price,
                sell_price,
                charges,
                pnl,
                start_at,
                end_at,
                metadata_json,
                updated_at
            FROM optionyze_options_scalper_closed_positions
            WHERE user_id = $1
              AND strategy_code = $2
            ORDER BY end_at DESC, close_id DESC
        `, [vUserId, pStrategyCode]);
        return objResult.rows.map(mapClosedPositionRow);
    }

    const arrRows = await loadAllClosedPositionsJson();
    return arrRows
        .filter((objRow) => objRow.userId === vUserId && objRow.strategyCode === pStrategyCode)
        .sort((pLeft, pRight) => String(pRight.endAt || "").localeCompare(String(pLeft.endAt || "")));
}

export async function appendOptionsScalperPaperClosedPositions(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pRows: OptionsScalperPaperClosedPositionRecord[]
): Promise<OptionsScalperPaperClosedPositionRecord[]> {
    const arrRows = normalizeClosedPositions(pUserId, pStrategyCode, pRows);
    if (!arrRows.length) {
        return listOptionsScalperPaperClosedPositions(pUserId, pStrategyCode);
    }

    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        for (const objRow of arrRows) {
            await objPool.query(`
                INSERT INTO optionyze_options_scalper_closed_positions (
                    close_id,
                    user_id,
                    strategy_code,
                    contract_name,
                    side,
                    qty,
                    buy_price,
                    sell_price,
                    charges,
                    pnl,
                    start_at,
                    end_at,
                    metadata_json,
                    updated_at
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14)
                ON CONFLICT (close_id) DO UPDATE SET
                    user_id = EXCLUDED.user_id,
                    strategy_code = EXCLUDED.strategy_code,
                    contract_name = EXCLUDED.contract_name,
                    side = EXCLUDED.side,
                    qty = EXCLUDED.qty,
                    buy_price = EXCLUDED.buy_price,
                    sell_price = EXCLUDED.sell_price,
                    charges = EXCLUDED.charges,
                    pnl = EXCLUDED.pnl,
                    start_at = EXCLUDED.start_at,
                    end_at = EXCLUDED.end_at,
                    metadata_json = EXCLUDED.metadata_json,
                    updated_at = EXCLUDED.updated_at
            `, [
                objRow.closeId,
                objRow.userId,
                objRow.strategyCode,
                objRow.contractName,
                objRow.side,
                objRow.qty,
                objRow.buyPrice,
                objRow.sellPrice,
                objRow.charges,
                objRow.pnl,
                objRow.startAt,
                objRow.endAt,
                JSON.stringify(objRow.metadata || {}),
                objRow.updatedAt
            ]);
        }
        return listOptionsScalperPaperClosedPositions(pUserId, pStrategyCode);
    }

    const arrExisting = await loadAllClosedPositionsJson();
    await writeJsonFileAtomic(gClosedPositionsFile, [...arrExisting, ...arrRows]);
    return listOptionsScalperPaperClosedPositions(pUserId, pStrategyCode);
}

export async function clearOptionsScalperPaperClosedPositions(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode
): Promise<void> {
    const vUserId = String(pUserId || "").trim();
    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        await objPool.query(`
            DELETE FROM optionyze_options_scalper_closed_positions
            WHERE user_id = $1
              AND strategy_code = $2
        `, [vUserId, pStrategyCode]);
        return;
    }

    const arrRows = await loadAllClosedPositionsJson();
    const arrFiltered = arrRows.filter((objRow) => !(objRow.userId === vUserId && objRow.strategyCode === pStrategyCode));
    await writeJsonFileAtomic(gClosedPositionsFile, arrFiltered);
}

export async function deleteOptionsScalperPaperClosedPosition(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pCloseId: string
): Promise<boolean> {
    const vUserId = String(pUserId || "").trim();
    const vCloseId = String(pCloseId || "").trim();
    if (!vCloseId) {
        return false;
    }
    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        const objResult = await objPool.query(
            `
                DELETE FROM optionyze_options_scalper_closed_positions
                WHERE user_id = $1
                  AND strategy_code = $2
                  AND close_id = $3
            `,
            [vUserId, pStrategyCode, vCloseId]
        );
        return Number(objResult.rowCount || 0) > 0;
    }

    const arrRows = await loadAllClosedPositionsJson();
    const arrFiltered = arrRows.filter((objRow) => !(objRow.userId === vUserId && objRow.strategyCode === pStrategyCode && String(objRow.closeId || "").trim() === vCloseId));
    const bDeleted = arrFiltered.length !== arrRows.length;
    if (bDeleted) {
        await writeJsonFileAtomic(gClosedPositionsFile, arrFiltered);
    }
    return bDeleted;
}

export async function updateOptionsScalperPaperClosedPositionQty(
    pUserId: string,
    pStrategyCode: RollingFuturesLtStrategyCode,
    pCloseId: string,
    pQty: number
): Promise<OptionsScalperPaperClosedPositionRecord | null> {
    const vUserId = String(pUserId || "").trim();
    const vCloseId = String(pCloseId || "").trim();
    const vQty = Math.max(0, Math.floor(Number(pQty || 0)));
    const vUpdatedAt = new Date().toISOString();
    if (!vCloseId || !(vQty > 0)) {
        return null;
    }
    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        const objResult = await objPool.query<OptionsScalperPaperClosedPositionRow>(
            `
                WITH selected_closed_position AS (
                    SELECT
                        qty AS old_qty,
                        charges AS old_charges,
                        pnl AS old_pnl
                    FROM optionyze_options_scalper_closed_positions
                    WHERE user_id = $1
                      AND strategy_code = $2
                      AND close_id = $3
                )
                UPDATE optionyze_options_scalper_closed_positions target
                SET qty = $4,
                    charges = CASE
                        WHEN selected_closed_position.old_qty > 0
                            THEN ROUND((selected_closed_position.old_charges * ($4 / selected_closed_position.old_qty))::numeric, 6)
                        ELSE target.charges
                    END,
                    pnl = CASE
                        WHEN selected_closed_position.old_qty > 0
                            THEN ROUND((selected_closed_position.old_pnl * ($4 / selected_closed_position.old_qty))::numeric, 6)
                        ELSE target.pnl
                    END,
                    updated_at = $5
                FROM selected_closed_position
                WHERE user_id = $1
                  AND strategy_code = $2
                  AND close_id = $3
                RETURNING
                    target.close_id,
                    target.user_id,
                    target.strategy_code,
                    target.contract_name,
                    target.side,
                    target.qty,
                    target.buy_price,
                    target.sell_price,
                    target.charges,
                    target.pnl,
                    target.start_at,
                    target.end_at,
                    target.metadata_json,
                    target.updated_at
            `,
            [vUserId, pStrategyCode, vCloseId, vQty, vUpdatedAt]
        );
        return objResult.rows[0] ? mapClosedPositionRow(objResult.rows[0]) : null;
    }

    const arrRows = await loadAllClosedPositionsJson();
    let objUpdated: OptionsScalperPaperClosedPositionRecord | null = null;
    const arrNext = arrRows.map((objRow) => {
        if (objRow.userId === vUserId && objRow.strategyCode === pStrategyCode && String(objRow.closeId || "").trim() === vCloseId) {
            const vOldQty = Number(objRow.qty || 0);
            const vScale = vOldQty > 0 ? vQty / vOldQty : 1;
            objUpdated = {
                ...objRow,
                qty: vQty,
                charges: Number((Number(objRow.charges || 0) * vScale).toFixed(6)),
                pnl: Number((Number(objRow.pnl || 0) * vScale).toFixed(6)),
                updatedAt: vUpdatedAt
            };
            return objUpdated;
        }
        return objRow;
    });
    if (objUpdated) {
        await writeJsonFileAtomic(gClosedPositionsFile, arrNext);
    }
    return objUpdated;
}
