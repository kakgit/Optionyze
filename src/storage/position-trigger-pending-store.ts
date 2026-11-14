"use strict";
import crypto from "node:crypto";
import path from "node:path";
import { readJsonFile, writeJsonFileAtomic } from "./json-store";
import { getPostgresPool, isPostgresConfigured } from "./postgres";

export interface PositionTriggerPendingRecord {
    id: string;
    accountId: string;
    strategyCode: string;
    exchange: string;
    symbol: string;
    contractSymbol: string;
    side: "buy" | "sell";
    qty: number;
    strike: number;
    slPoints: number;
    tpPoints: number;
    tolerance: number;
    createdAt: string;
    updatedAt: string;
}

interface PositionTriggerPendingRow {
    id: string;
    account_id: string;
    strategy_code: string;
    exchange: string;
    symbol: string;
    contract_symbol: string;
    side: string;
    qty: number | string;
    strike: number | string;
    sl_points: number | string;
    tp_points: number | string;
    tolerance: number | string;
    created_at: string | Date;
    updated_at: string | Date;
}

const gPendingFile = path.resolve(process.cwd(), "data", "position-trigger-pending", "pending.json");

async function loadJsonPending(): Promise<PositionTriggerPendingRecord[]> {
    return readJsonFile(gPendingFile, []);
}

function mapRowToRecord(pRow: PositionTriggerPendingRow): PositionTriggerPendingRecord {
    const vSideRaw = String(pRow.side || "").trim().toLowerCase();
    return {
        id: String(pRow.id),
        accountId: String(pRow.account_id),
        strategyCode: String(pRow.strategy_code),
        exchange: String(pRow.exchange || "delta-exchange").trim().toLowerCase(),
        symbol: String(pRow.symbol || "").trim().toUpperCase(),
        contractSymbol: String(pRow.contract_symbol || "").trim().toUpperCase(),
        side: (vSideRaw === "sell" ? "sell" : "buy") as "buy" | "sell",
        qty: Math.max(1, Math.floor(Number(pRow.qty))),
        strike: Number(pRow.strike),
        slPoints: Number(pRow.sl_points),
        tpPoints: Number(pRow.tp_points),
        tolerance: Math.max(0, Number(pRow.tolerance || 0)),
        createdAt: new Date(pRow.created_at).toISOString(),
        updatedAt: new Date(pRow.updated_at).toISOString()
    };
}

export async function createPositionTriggerPendingRecord(
    pInput: Omit<PositionTriggerPendingRecord, "id" | "createdAt" | "updatedAt">
): Promise<PositionTriggerPendingRecord> {
    const vNow = new Date().toISOString();
    const objRecord: PositionTriggerPendingRecord = {
        id: crypto.randomUUID(),
        createdAt: vNow,
        updatedAt: vNow,
        accountId: String(pInput.accountId || "").trim(),
        strategyCode: String(pInput.strategyCode || "").trim(),
        exchange: String(pInput.exchange || "delta-exchange").trim().toLowerCase(),
        symbol: String(pInput.symbol || "").trim().toUpperCase(),
        contractSymbol: String(pInput.contractSymbol || "").trim().toUpperCase(),
        side: pInput.side,
        qty: Math.max(1, Math.floor(Number(pInput.qty))),
        strike: Number(pInput.strike),
        slPoints: Number(pInput.slPoints),
        tpPoints: Number(pInput.tpPoints),
        tolerance: Math.max(0, Number(pInput.tolerance || 0))
    };
    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        await objPool.query(
            `INSERT INTO optionyze_position_trigger_pending
                (id, account_id, strategy_code, exchange, symbol, contract_symbol, side, qty, strike, sl_points, tp_points, tolerance, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
            [objRecord.id, objRecord.accountId, objRecord.strategyCode, objRecord.exchange, objRecord.symbol, objRecord.contractSymbol, objRecord.side, objRecord.qty, objRecord.strike, objRecord.slPoints, objRecord.tpPoints, objRecord.tolerance, objRecord.createdAt, objRecord.updatedAt]
        );
        return objRecord;
    }
    const arrPending = await loadJsonPending();
    arrPending.push(objRecord);
    await writeJsonFileAtomic(gPendingFile, arrPending);
    return objRecord;
}

export async function listPositionTriggerPendingRecords(
    pAccountId: string,
    pStrategyCode: string
): Promise<PositionTriggerPendingRecord[]> {
    const vAccountId = String(pAccountId || "").trim();
    const vStrategyCode = String(pStrategyCode || "").trim();
    if (!vAccountId) return [];
    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        const objResult = await objPool.query<PositionTriggerPendingRow>(
            `SELECT id, account_id, strategy_code, exchange, symbol, contract_symbol, side, qty, strike, sl_points, tp_points, tolerance, created_at, updated_at
             FROM optionyze_position_trigger_pending
             WHERE account_id = $1 AND strategy_code = $2
             ORDER BY created_at ASC`,
            [vAccountId, vStrategyCode]
        );
        return objResult.rows.map(mapRowToRecord);
    }
    const arrPending = await loadJsonPending();
    return arrPending
        .filter((pRow) => pRow.accountId === vAccountId && pRow.strategyCode === vStrategyCode)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function deletePositionTriggerPendingRecord(
    pAccountId: string,
    pId: string
): Promise<PositionTriggerPendingRecord | null> {
    const vAccountId = String(pAccountId || "").trim();
    const vId = String(pId || "").trim();
    if (!vAccountId || !vId) return null;
    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        const objSel = await objPool.query<PositionTriggerPendingRow>(
            `SELECT id, account_id, strategy_code, exchange, symbol, contract_symbol, side, qty, strike, sl_points, tp_points, tolerance, created_at, updated_at
             FROM optionyze_position_trigger_pending
             WHERE id = $1 AND account_id = $2`,
            [vId, vAccountId]
        );
        if (!objSel.rows.length) return null;
        const objRecord = mapRowToRecord(objSel.rows[0]);
        await objPool.query(`DELETE FROM optionyze_position_trigger_pending WHERE id = $1`, [vId]);
        return objRecord;
    }
    const arrPending = await loadJsonPending();
    const vIdx = arrPending.findIndex((pRow) => pRow.id === vId && pRow.accountId === vAccountId);
    if (vIdx < 0) return null;
    const [objRemoved] = arrPending.splice(vIdx, 1);
    await writeJsonFileAtomic(gPendingFile, arrPending);
    return objRemoved;
}

// Edit semantics: the save endpoint calls this when a same-side queued order
// is about to be replaced by a fresh one.
export async function deletePositionTriggerPendingByContent(
    pAccountId: string,
    pStrategyCode: string,
    pMatch: { symbol: string; side: "buy" | "sell" }
): Promise<PositionTriggerPendingRecord | null> {
    const vAccountId = String(pAccountId || "").trim();
    const vStrategyCode = String(pStrategyCode || "").trim();
    const vSymbol = String(pMatch.symbol || "").trim().toUpperCase();
    const vSide = pMatch.side;
    if (!vAccountId || !vSymbol || !vSide) return null;
    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        const objSel = await objPool.query<PositionTriggerPendingRow>(
            `SELECT id, account_id, strategy_code, exchange, symbol, contract_symbol, side, qty, strike, sl_points, tp_points, tolerance, created_at, updated_at
             FROM optionyze_position_trigger_pending
             WHERE account_id = $1 AND strategy_code = $2 AND symbol = $3 AND side = $4
             LIMIT 1`,
            [vAccountId, vStrategyCode, vSymbol, vSide]
        );
        if (!objSel.rows.length) return null;
        const objRecord = mapRowToRecord(objSel.rows[0]);
        await objPool.query(`DELETE FROM optionyze_position_trigger_pending WHERE id = $1`, [objRecord.id]);
        return objRecord;
    }
    const arrPending = await loadJsonPending();
    const vIdx = arrPending.findIndex((pRow) =>
        pRow.accountId === vAccountId &&
        pRow.strategyCode === vStrategyCode &&
        pRow.symbol === vSymbol &&
        pRow.side === vSide
    );
    if (vIdx < 0) return null;
    const [objRemoved] = arrPending.splice(vIdx, 1);
    await writeJsonFileAtomic(gPendingFile, arrPending);
    return objRemoved;
}