import crypto from "node:crypto";
import path from "node:path";
import { readJsonFile, writeJsonFileAtomic } from "./json-store";
import { getPostgresPool, isPostgresConfigured } from "./postgres";

export interface RollingOptionsPtDeEventRecord {
    eventId: string;
    userId: string;
    strategyCode: string;
    eventType: string;
    severity: "info" | "success" | "warning" | "error";
    title: string;
    message: string;
    payload: Record<string, unknown>;
    createdAt: string;
}

interface RollingOptionsPtDeEventRow {
    event_id: string;
    user_id: string;
    strategy_code: string;
    event_type: string;
    severity: "info" | "success" | "warning" | "error";
    title: string;
    message: string;
    payload_json: Record<string, unknown> | null;
    created_at: string | Date;
}

const gEventsFile = path.resolve(process.cwd(), "data", "rolling-options-pt-de", "events.json");
const gMaxEventsPerUser = 500;
const gMaxAgeMs = 10 * 24 * 60 * 60 * 1000;
const gDefaultStrategyCode = "rolling-options-pt-de";

async function loadAllEventsJson(): Promise<RollingOptionsPtDeEventRecord[]> {
    return readJsonFile<RollingOptionsPtDeEventRecord[]>(gEventsFile, []);
}

function mapRowToEvent(pRow: RollingOptionsPtDeEventRow): RollingOptionsPtDeEventRecord {
    return {
        eventId: String(pRow.event_id),
        userId: String(pRow.user_id),
        strategyCode: String(pRow.strategy_code || "rolling-options-pt-de"),
        eventType: String(pRow.event_type || ""),
        severity: pRow.severity,
        title: String(pRow.title || ""),
        message: String(pRow.message || ""),
        payload: (pRow.payload_json ?? {}) as Record<string, unknown>,
        createdAt: new Date(pRow.created_at).toISOString()
    };
}

export async function listRollingOptionsEventsByStrategy(
    pUserId: string,
    pStrategyCode: string,
    pLimit = 100
): Promise<RollingOptionsPtDeEventRecord[]> {
    const vLimit = Math.max(1, Math.min(500, Math.floor(Number(pLimit || 100))));
    const vStrategyCode = String(pStrategyCode || gDefaultStrategyCode).trim() || gDefaultStrategyCode;
    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        const objResult = await objPool.query<RollingOptionsPtDeEventRow>(`
            SELECT
                event_id,
                user_id,
                strategy_code,
                event_type,
                severity,
                title,
                message,
                payload_json,
                created_at
            FROM optionyze_rolling_options_pt_de_events
            WHERE user_id = $1
              AND strategy_code = $2
            ORDER BY created_at DESC
            LIMIT $3
        `, [pUserId, vStrategyCode, vLimit]);

        return objResult.rows.map(mapRowToEvent);
    }

    const objRows = await loadAllEventsJson();
    return objRows
        .filter((objRow) => objRow.userId === pUserId && objRow.strategyCode === vStrategyCode)
        .sort((objA, objB) => String(objB.createdAt).localeCompare(String(objA.createdAt)))
        .slice(0, vLimit);
}

export async function listRollingOptionsPtDeEvents(
    pUserId: string,
    pLimit = 100
): Promise<RollingOptionsPtDeEventRecord[]> {
    return listRollingOptionsEventsByStrategy(pUserId, gDefaultStrategyCode, pLimit);
}

async function prunePostgresEvents(pUserId: string, pStrategyCode: string): Promise<void> {
    const objPool = getPostgresPool();
    const vCutoff = new Date(Date.now() - gMaxAgeMs).toISOString();

    await objPool.query(`
        DELETE FROM optionyze_rolling_options_pt_de_events
        WHERE user_id = $1
          AND strategy_code = $2
          AND created_at < $3::timestamptz
    `, [pUserId, pStrategyCode, vCutoff]);

    await objPool.query(`
        DELETE FROM optionyze_rolling_options_pt_de_events
        WHERE event_id IN (
            SELECT event_id
            FROM optionyze_rolling_options_pt_de_events
            WHERE user_id = $1
              AND strategy_code = $2
            ORDER BY created_at DESC
            OFFSET $3
        )
    `, [pUserId, pStrategyCode, gMaxEventsPerUser]);
}

async function pruneJsonEvents(pUserId: string, pStrategyCode: string): Promise<void> {
    const vCutoffMs = Date.now() - gMaxAgeMs;
    const objRows = await loadAllEventsJson();
    const objKeptRows = objRows.filter((objRow) => {
        if (objRow.userId !== pUserId || objRow.strategyCode !== pStrategyCode) {
            return true;
        }
        return new Date(objRow.createdAt).getTime() >= vCutoffMs;
    });

    const objUserRows = objKeptRows
        .filter((objRow) => objRow.userId === pUserId && objRow.strategyCode === pStrategyCode)
        .sort((objA, objB) => String(objB.createdAt).localeCompare(String(objA.createdAt)));
    const objAllowedEventIds = new Set(objUserRows.slice(0, gMaxEventsPerUser).map((objRow) => objRow.eventId));
    const objFinalRows = objKeptRows.filter((objRow) => {
        if (objRow.userId !== pUserId || objRow.strategyCode !== pStrategyCode) {
            return true;
        }
        return objAllowedEventIds.has(objRow.eventId);
    });

    await writeJsonFileAtomic(gEventsFile, objFinalRows);
}

export async function saveRollingOptionsEvent(
    pEvent: Omit<RollingOptionsPtDeEventRecord, "eventId" | "createdAt">
): Promise<RollingOptionsPtDeEventRecord> {
    const objEvent: RollingOptionsPtDeEventRecord = {
        eventId: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        ...pEvent
    };

    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        await objPool.query(`
            INSERT INTO optionyze_rolling_options_pt_de_events (
                event_id,
                user_id,
                strategy_code,
                event_type,
                severity,
                title,
                message,
                payload_json,
                created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
        `, [
            objEvent.eventId,
            objEvent.userId,
            objEvent.strategyCode,
            objEvent.eventType,
            objEvent.severity,
            objEvent.title,
            objEvent.message,
            JSON.stringify(objEvent.payload || {}),
            objEvent.createdAt
        ]);

        await prunePostgresEvents(objEvent.userId, objEvent.strategyCode);
        return objEvent;
    }

    const objRows = await loadAllEventsJson();
    objRows.push(objEvent);
    await writeJsonFileAtomic(gEventsFile, objRows);
    await pruneJsonEvents(objEvent.userId, objEvent.strategyCode);
    return objEvent;
}

export async function saveRollingOptionsPtDeEvent(
    pEvent: Omit<RollingOptionsPtDeEventRecord, "eventId" | "createdAt">
): Promise<RollingOptionsPtDeEventRecord> {
    return saveRollingOptionsEvent(pEvent);
}

export async function clearRollingOptionsEventsByStrategy(pUserId: string, pStrategyCode: string): Promise<number> {
    const vStrategyCode = String(pStrategyCode || gDefaultStrategyCode).trim() || gDefaultStrategyCode;
    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        const objResult = await objPool.query(`
            DELETE FROM optionyze_rolling_options_pt_de_events
            WHERE user_id = $1
              AND strategy_code = $2
        `, [pUserId, vStrategyCode]);
        return Number(objResult.rowCount || 0);
    }

    const objRows = await loadAllEventsJson();
    const vBeforeCount = objRows.length;
    const objRemainingRows = objRows.filter((objRow) => !(objRow.userId === pUserId && objRow.strategyCode === vStrategyCode));
    await writeJsonFileAtomic(gEventsFile, objRemainingRows);
    return vBeforeCount - objRemainingRows.length;
}

export async function clearRollingOptionsPtDeEvents(pUserId: string): Promise<number> {
    return clearRollingOptionsEventsByStrategy(pUserId, gDefaultStrategyCode);
}

export async function deleteRollingOptionsEventByStrategy(
    pUserId: string,
    pStrategyCode: string,
    pEventId: string
): Promise<boolean> {
    const vStrategyCode = String(pStrategyCode || gDefaultStrategyCode).trim() || gDefaultStrategyCode;
    const vEventId = String(pEventId || "").trim();
    if (!vEventId) {
        return false;
    }

    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        const objResult = await objPool.query(`
            DELETE FROM optionyze_rolling_options_pt_de_events
            WHERE user_id = $1
              AND strategy_code = $2
              AND event_id = $3
        `, [pUserId, vStrategyCode, vEventId]);
        return Number(objResult.rowCount || 0) > 0;
    }

    const objRows = await loadAllEventsJson();
    const objRemainingRows = objRows.filter((objRow) => !(
        objRow.userId === pUserId
        && objRow.strategyCode === vStrategyCode
        && objRow.eventId === vEventId
    ));
    const bDeleted = objRemainingRows.length !== objRows.length;
    if (bDeleted) {
        await writeJsonFileAtomic(gEventsFile, objRemainingRows);
    }
    return bDeleted;
}
