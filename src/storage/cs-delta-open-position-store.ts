import crypto from "node:crypto";
import path from "node:path";
import { readJsonFile, writeJsonFileAtomic } from "./json-store";
import { getPostgresPool, isPostgresConfigured } from "./postgres";

export type CsDeltaPositionSide = "put" | "call";

export interface CsDeltaOpenPositionRecord {
    positionId: string;
    accountId: string;
    profileId: string;
    userName: string;
    side: CsDeltaPositionSide;
    baseCoin: string;
    strike: number;
    multiplier: number;
    coinswitchSymbol: string;
    coinswitchQty: number;
    coinswitchEntryPrice: number;
    coinswitchOrderId: string;
    deltaSymbol: string;
    deltaSize: number;
    deltaEntryPrice: number;
    deltaOrderId: string;
    status: "open";
    openedAt: string;
    updatedAt: string;
}

export interface CreateCsDeltaOpenPositionInput {
    accountId: string;
    profileId: string;
    userName: string;
    side: CsDeltaPositionSide;
    baseCoin: string;
    strike: number;
    multiplier: number;
    coinswitchSymbol: string;
    coinswitchQty: number;
    coinswitchEntryPrice: number;
    coinswitchOrderId: string;
    deltaSymbol: string;
    deltaSize: number;
    deltaEntryPrice: number;
    deltaOrderId: string;
}

interface CsDeltaOpenPositionRow {
    position_id: string;
    account_id: string;
    profile_id: string;
    user_name: string;
    side: string;
    base_coin: string;
    strike: string | number;
    multiplier: string | number;
    coinswitch_symbol: string;
    coinswitch_qty: string | number;
    coinswitch_entry_price: string | number;
    coinswitch_order_id: string;
    delta_symbol: string;
    delta_size: string | number;
    delta_entry_price: string | number;
    delta_order_id: string;
    status: string;
    opened_at: string | Date;
    updated_at: string | Date;
}

const gPositionsFile = path.resolve(process.cwd(), "data", "cs-delta-api", "open-positions.json");

async function loadJsonPositions(): Promise<CsDeltaOpenPositionRecord[]> {
    return readJsonFile<CsDeltaOpenPositionRecord[]>(gPositionsFile, []);
}

export async function listCsDeltaOpenPositions(pAccountId: string, pProfileId = ""): Promise<CsDeltaOpenPositionRecord[]> {
    const vAccountId = String(pAccountId || "").trim();
    const vProfileId = String(pProfileId || "").trim();

    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        const objResult = await objPool.query<CsDeltaOpenPositionRow>(`
            SELECT *
            FROM optionyze_cs_delta_open_positions
            WHERE account_id = $1
              AND status = 'open'
              AND ($2 = '' OR profile_id = $2)
            ORDER BY opened_at DESC, side ASC
        `, [vAccountId, vProfileId]);
        return objResult.rows.map(mapRow).filter((objRow): objRow is CsDeltaOpenPositionRecord => Boolean(objRow));
    }

    const arrRows = await loadJsonPositions();
    return arrRows
        .filter((objRow) => (
            objRow.accountId === vAccountId
            && objRow.status === "open"
            && (!vProfileId || objRow.profileId === vProfileId)
        ))
        .sort((a, b) => b.openedAt.localeCompare(a.openedAt) || a.side.localeCompare(b.side));
}

export async function getCsDeltaOpenPositionBySide(
    pAccountId: string,
    pProfileId: string,
    pSide: CsDeltaPositionSide
): Promise<CsDeltaOpenPositionRecord | null> {
    const vAccountId = String(pAccountId || "").trim();
    const vProfileId = String(pProfileId || "").trim();
    const vSide = pSide === "call" ? "call" : "put";

    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        const objResult = await objPool.query<CsDeltaOpenPositionRow>(`
            SELECT *
            FROM optionyze_cs_delta_open_positions
            WHERE account_id = $1
              AND profile_id = $2
              AND side = $3
              AND status = 'open'
            LIMIT 1
        `, [vAccountId, vProfileId, vSide]);
        return mapRow(objResult.rows[0]);
    }

    const arrRows = await loadJsonPositions();
    return arrRows.find((objRow) => (
        objRow.accountId === vAccountId
        && objRow.profileId === vProfileId
        && objRow.side === vSide
        && objRow.status === "open"
    )) || null;
}

export async function createCsDeltaOpenPosition(pInput: CreateCsDeltaOpenPositionInput): Promise<CsDeltaOpenPositionRecord> {
    const vNow = new Date().toISOString();
    const vSide = pInput.side === "call" ? "call" : "put";
    const objExisting = await getCsDeltaOpenPositionBySide(pInput.accountId, pInput.profileId, vSide);
    if (objExisting) {
        throw new Error(`An open ${vSide.toUpperCase()} position already exists for ${pInput.userName}.`);
    }

    const objPosition: CsDeltaOpenPositionRecord = {
        positionId: crypto.randomUUID(),
        accountId: String(pInput.accountId || "").trim(),
        profileId: String(pInput.profileId || "").trim(),
        userName: String(pInput.userName || "").trim(),
        side: vSide,
        baseCoin: String(pInput.baseCoin || "").trim().toUpperCase(),
        strike: Number(pInput.strike),
        multiplier: Math.max(1, Math.floor(Number(pInput.multiplier || 1))),
        coinswitchSymbol: String(pInput.coinswitchSymbol || "").trim().toUpperCase(),
        coinswitchQty: Number(pInput.coinswitchQty),
        coinswitchEntryPrice: Number(pInput.coinswitchEntryPrice),
        coinswitchOrderId: String(pInput.coinswitchOrderId || "").trim(),
        deltaSymbol: String(pInput.deltaSymbol || "").trim().toUpperCase(),
        deltaSize: Math.max(1, Math.floor(Number(pInput.deltaSize || 1))),
        deltaEntryPrice: Number(pInput.deltaEntryPrice),
        deltaOrderId: String(pInput.deltaOrderId || "").trim(),
        status: "open",
        openedAt: vNow,
        updatedAt: vNow
    };

    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        try {
            await objPool.query(`
                INSERT INTO optionyze_cs_delta_open_positions (
                    position_id, account_id, profile_id, user_name, side, base_coin, strike, multiplier,
                    coinswitch_symbol, coinswitch_qty, coinswitch_entry_price, coinswitch_order_id,
                    delta_symbol, delta_size, delta_entry_price, delta_order_id,
                    status, opened_at, updated_at
                ) VALUES (
                    $1,$2,$3,$4,$5,$6,$7,$8,
                    $9,$10,$11,$12,
                    $13,$14,$15,$16,
                    $17,$18,$19
                )
            `, [
                objPosition.positionId,
                objPosition.accountId,
                objPosition.profileId,
                objPosition.userName,
                objPosition.side,
                objPosition.baseCoin,
                objPosition.strike,
                objPosition.multiplier,
                objPosition.coinswitchSymbol,
                objPosition.coinswitchQty,
                objPosition.coinswitchEntryPrice,
                objPosition.coinswitchOrderId,
                objPosition.deltaSymbol,
                objPosition.deltaSize,
                objPosition.deltaEntryPrice,
                objPosition.deltaOrderId,
                objPosition.status,
                objPosition.openedAt,
                objPosition.updatedAt
            ]);
        }
        catch (objError) {
            const vMessage = objError instanceof Error ? objError.message : String(objError || "");
            if (/unique|duplicate/i.test(vMessage)) {
                throw new Error(`An open ${vSide.toUpperCase()} position already exists for ${objPosition.userName}.`);
            }
            throw objError;
        }
        return objPosition;
    }

    const arrRows = await loadJsonPositions();
    arrRows.push(objPosition);
    await writeJsonFileAtomic(gPositionsFile, arrRows);
    return objPosition;
}

export async function deleteCsDeltaOpenPosition(pAccountId: string, pPositionId: string): Promise<void> {
    const vAccountId = String(pAccountId || "").trim();
    const vPositionId = String(pPositionId || "").trim();

    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        await objPool.query(`
            DELETE FROM optionyze_cs_delta_open_positions
            WHERE account_id = $1
              AND position_id = $2
        `, [vAccountId, vPositionId]);
        return;
    }

    const arrRows = await loadJsonPositions();
    await writeJsonFileAtomic(
        gPositionsFile,
        arrRows.filter((objRow) => !(objRow.accountId === vAccountId && objRow.positionId === vPositionId))
    );
}

function mapRow(pRow?: CsDeltaOpenPositionRow | null): CsDeltaOpenPositionRecord | null {
    if (!pRow) {
        return null;
    }
    const vSide = String(pRow.side || "").trim().toLowerCase() === "call" ? "call" : "put";
    return {
        positionId: String(pRow.position_id),
        accountId: String(pRow.account_id),
        profileId: String(pRow.profile_id),
        userName: String(pRow.user_name || ""),
        side: vSide,
        baseCoin: String(pRow.base_coin || "").toUpperCase(),
        strike: Number(pRow.strike),
        multiplier: Math.max(1, Math.floor(Number(pRow.multiplier || 1))),
        coinswitchSymbol: String(pRow.coinswitch_symbol || "").toUpperCase(),
        coinswitchQty: Number(pRow.coinswitch_qty),
        coinswitchEntryPrice: Number(pRow.coinswitch_entry_price),
        coinswitchOrderId: String(pRow.coinswitch_order_id || ""),
        deltaSymbol: String(pRow.delta_symbol || "").toUpperCase(),
        deltaSize: Math.max(1, Math.floor(Number(pRow.delta_size || 1))),
        deltaEntryPrice: Number(pRow.delta_entry_price),
        deltaOrderId: String(pRow.delta_order_id || ""),
        status: "open",
        openedAt: new Date(pRow.opened_at).toISOString(),
        updatedAt: new Date(pRow.updated_at).toISOString()
    };
}
