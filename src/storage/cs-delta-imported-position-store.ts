import crypto from "node:crypto";
import path from "node:path";
import { readJsonFile, writeJsonFileAtomic } from "./json-store";
import { getPostgresPool, isPostgresConfigured } from "./postgres";

export type ImportedPositionSource = "delta" | "coinswitch";

export interface CsDeltaImportedPositionRecord {
    importId: string;
    accountId: string;
    profileId: string;
    userName: string;
    source: ImportedPositionSource;
    side: "put" | "call";
    baseCoin: string;
    symbol: string;
    strike: number;
    size: number;
    entryPrice: number;
    markPrice: number;
    positionSide: "long" | "short";
    status: "open";
    importedAt: string;
    updatedAt: string;
}

export interface CreateCsDeltaImportedPositionInput {
    accountId: string;
    profileId: string;
    userName: string;
    source: ImportedPositionSource;
    side: "put" | "call";
    baseCoin: string;
    symbol: string;
    strike: number;
    size: number;
    entryPrice: number;
    markPrice: number;
    positionSide: "long" | "short";
}

interface CsDeltaImportedPositionRow {
    import_id: string;
    account_id: string;
    profile_id: string;
    user_name: string;
    source: string;
    side: string;
    base_coin: string;
    symbol: string;
    strike: string | number;
    size: string | number;
    entry_price: string | number;
    mark_price: string | number;
    position_side: string;
    status: string;
    imported_at: string | Date;
    updated_at: string | Date;
}

const gImportedFile = path.resolve(process.cwd(), "data", "cs-delta-api", "imported-positions.json");

async function loadJsonImported(): Promise<CsDeltaImportedPositionRecord[]> {
    return readJsonFile<CsDeltaImportedPositionRecord[]>(gImportedFile, []);
}

function mapRow(pRow?: CsDeltaImportedPositionRow | null): CsDeltaImportedPositionRecord | null {
    if (!pRow) {
        return null;
    }
    const vSide = String(pRow.side || "").trim().toLowerCase() === "call" ? "call" : "put";
    const vSource = String(pRow.source || "").trim().toLowerCase() === "coinswitch" ? "coinswitch" : "delta";
    return {
        importId: String(pRow.import_id),
        accountId: String(pRow.account_id),
        profileId: String(pRow.profile_id),
        userName: String(pRow.user_name || ""),
        source: vSource,
        side: vSide,
        baseCoin: String(pRow.base_coin || "").toUpperCase(),
        symbol: String(pRow.symbol || "").toUpperCase(),
        strike: Number(pRow.strike),
        size: Number(pRow.size),
        entryPrice: Number(pRow.entry_price),
        markPrice: Number(pRow.mark_price),
        positionSide: String(pRow.position_side || "").trim().toLowerCase() === "short" ? "short" : "long",
        status: "open",
        importedAt: new Date(pRow.imported_at).toISOString(),
        updatedAt: new Date(pRow.updated_at).toISOString()
    };
}

export async function listCsDeltaImportedPositions(pAccountId: string, pProfileId = ""): Promise<CsDeltaImportedPositionRecord[]> {
    const vAccountId = String(pAccountId || "").trim();
    const vProfileId = String(pProfileId || "").trim();

    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        const objResult = await objPool.query<CsDeltaImportedPositionRow>(`
            SELECT *
            FROM optionyze_cs_delta_imported_positions
            WHERE account_id = $1
              AND status = 'open'
              AND ($2 = '' OR profile_id = $2)
            ORDER BY side ASC, strike ASC
        `, [vAccountId, vProfileId]);
        return objResult.rows.map(mapRow).filter((objRow): objRow is CsDeltaImportedPositionRecord => Boolean(objRow));
    }

    const arrRows = await loadJsonImported();
    return arrRows
        .filter((objRow) => (
            objRow.accountId === vAccountId
            && objRow.status === "open"
            && (!vProfileId || objRow.profileId === vProfileId)
        ))
        .sort((a, b) => a.side.localeCompare(b.side) || a.strike - b.strike);
}

export async function createCsDeltaImportedPositions(
    pInputs: CreateCsDeltaImportedPositionInput[]
): Promise<{ saved: CsDeltaImportedPositionRecord[]; skipped: number }> {
    const arrSaved: CsDeltaImportedPositionRecord[] = [];
    let vSkipped = 0;

    for (const objInput of pInputs) {
        const vNow = new Date().toISOString();
        const objRecord: CsDeltaImportedPositionRecord = {
            importId: crypto.randomUUID(),
            accountId: objInput.accountId,
            profileId: objInput.profileId,
            userName: objInput.userName,
            source: objInput.source,
            side: objInput.side,
            baseCoin: String(objInput.baseCoin || "").toUpperCase(),
            symbol: String(objInput.symbol || "").toUpperCase(),
            strike: Number(objInput.strike),
            size: Number(objInput.size),
            entryPrice: Number(objInput.entryPrice || 0),
            markPrice: Number(objInput.markPrice || 0),
            positionSide: objInput.positionSide === "short" ? "short" : "long",
            status: "open",
            importedAt: vNow,
            updatedAt: vNow
        };

        if (isPostgresConfigured()) {
            const objPool = getPostgresPool();
            try {
                await objPool.query(`
                    INSERT INTO optionyze_cs_delta_imported_positions (
                        import_id, account_id, profile_id, user_name, source, side,
                        base_coin, symbol, strike, size, entry_price, mark_price,
                        position_side, status, imported_at, updated_at
                    ) VALUES (
                        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
                    )
                `, [
                    objRecord.importId,
                    objRecord.accountId,
                    objRecord.profileId,
                    objRecord.userName,
                    objRecord.source,
                    objRecord.side,
                    objRecord.baseCoin,
                    objRecord.symbol,
                    objRecord.strike,
                    objRecord.size,
                    objRecord.entryPrice,
                    objRecord.markPrice,
                    objRecord.positionSide,
                    objRecord.status,
                    objRecord.importedAt,
                    objRecord.updatedAt
                ]);
                arrSaved.push(objRecord);
            }
            catch (objError) {
                const vMessage = objError instanceof Error ? objError.message : String(objError || "");
                if (/unique|duplicate/i.test(vMessage)) {
                    vSkipped += 1;
                    continue;
                }
                throw objError;
            }
            continue;
        }

        const arrRows = await loadJsonImported();
        const vDuplicate = arrRows.some((objRow) => (
            objRow.accountId === objRecord.accountId
            && objRow.profileId === objRecord.profileId
            && objRow.source === objRecord.source
            && objRow.symbol === objRecord.symbol
            && objRow.status === "open"
        ));
        if (vDuplicate) {
            vSkipped += 1;
            continue;
        }
        arrRows.push(objRecord);
        await writeJsonFileAtomic(gImportedFile, arrRows);
        arrSaved.push(objRecord);
    }

    return { saved: arrSaved, skipped: vSkipped };
}

export async function deleteCsDeltaImportedPosition(pAccountId: string, pImportId: string): Promise<void> {
    const vAccountId = String(pAccountId || "").trim();
    const vImportId = String(pImportId || "").trim();

    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        await objPool.query(`
            DELETE FROM optionyze_cs_delta_imported_positions
            WHERE account_id = $1
              AND import_id = $2
        `, [vAccountId, vImportId]);
        return;
    }

    const arrRows = await loadJsonImported();
    await writeJsonFileAtomic(
        gImportedFile,
        arrRows.filter((objRow) => !(objRow.accountId === vAccountId && objRow.importId === vImportId))
    );
}


