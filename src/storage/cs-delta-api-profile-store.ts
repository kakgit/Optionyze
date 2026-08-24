import crypto from "node:crypto";
import path from "node:path";
import { readJsonFile, writeJsonFileAtomic } from "./json-store";
import { getPostgresPool, isPostgresConfigured } from "./postgres";

export interface CsDeltaApiProfileRecord {
    profileId: string;
    accountId: string;
    userName: string;
    deltaApiKey: string;
    deltaApiSecret: string;
    coinswitchApiKey: string;
    coinswitchApiSecret: string;
    createdAt: string;
    updatedAt: string;
}

export interface CsDeltaApiProfileSummary {
    profileId: string;
    accountId: string;
    userName: string;
    deltaApiKeyMasked: string;
    coinswitchApiKeyMasked: string;
    hasDeltaSecret: boolean;
    hasCoinswitchSecret: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface CreateCsDeltaApiProfileInput {
    accountId: string;
    userName: string;
    deltaApiKey: string;
    deltaApiSecret: string;
    coinswitchApiKey: string;
    coinswitchApiSecret: string;
}

export interface UpdateCsDeltaApiProfileInput {
    accountId: string;
    userName: string;
    deltaApiKey?: string;
    deltaApiSecret?: string;
    coinswitchApiKey?: string;
    coinswitchApiSecret?: string;
}

interface CsDeltaApiProfileRow {
    profile_id: string;
    account_id: string;
    user_name: string;
    delta_api_key: string;
    delta_api_secret: string;
    coinswitch_api_key: string;
    coinswitch_api_secret: string;
    created_at: string | Date;
    updated_at: string | Date;
}

interface CsDeltaApiProfileQueryRunner {
    query<TResult = unknown>(text: string, values?: unknown[]): Promise<{ rows: TResult[] }>;
}

const gProfilesFile = path.resolve(process.cwd(), "data", "cs-delta-api", "profiles.json");

async function loadJsonProfiles(): Promise<CsDeltaApiProfileRecord[]> {
    return readJsonFile<CsDeltaApiProfileRecord[]>(gProfilesFile, []);
}

export async function listCsDeltaApiProfiles(pAccountId: string): Promise<CsDeltaApiProfileSummary[]> {
    const vAccountId = String(pAccountId || "").trim();
    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        const objResult = await objPool.query<CsDeltaApiProfileRow>(`
            SELECT profile_id, account_id, user_name,
                   delta_api_key, delta_api_secret,
                   coinswitch_api_key, coinswitch_api_secret,
                   created_at, updated_at
            FROM optionyze_cs_delta_api_profiles
            WHERE account_id = $1
            ORDER BY updated_at DESC, user_name ASC
        `, [vAccountId]);

        return objResult.rows.map(mapSummaryRow);
    }

    const objProfiles = await loadJsonProfiles();
    return objProfiles
        .filter((objProfile) => objProfile.accountId === vAccountId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.userName.localeCompare(b.userName))
        .map(mapSummaryRecord);
}

export async function getCsDeltaApiProfile(pAccountId: string, pProfileId: string): Promise<CsDeltaApiProfileRecord | null> {
    const vAccountId = String(pAccountId || "").trim();
    const vProfileId = String(pProfileId || "").trim();

    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        const objResult = await objPool.query<CsDeltaApiProfileRow>(`
            SELECT profile_id, account_id, user_name,
                   delta_api_key, delta_api_secret,
                   coinswitch_api_key, coinswitch_api_secret,
                   created_at, updated_at
            FROM optionyze_cs_delta_api_profiles
            WHERE account_id = $1
              AND profile_id = $2
        `, [vAccountId, vProfileId]);

        return mapFullRow(objResult.rows[0]);
    }

    const objProfiles = await loadJsonProfiles();
    return objProfiles.find((objProfile) => objProfile.accountId === vAccountId && objProfile.profileId === vProfileId) || null;
}

export async function createCsDeltaApiProfile(pInput: CreateCsDeltaApiProfileInput): Promise<CsDeltaApiProfileSummary> {
    const vNow = new Date().toISOString();
    const objProfile: CsDeltaApiProfileRecord = {
        profileId: crypto.randomUUID(),
        accountId: String(pInput.accountId || "").trim(),
        userName: String(pInput.userName || "").trim(),
        deltaApiKey: normalizeKey(pInput.deltaApiKey),
        deltaApiSecret: String(pInput.deltaApiSecret || "").trim(),
        coinswitchApiKey: normalizeKey(pInput.coinswitchApiKey),
        coinswitchApiSecret: String(pInput.coinswitchApiSecret || "").trim(),
        createdAt: vNow,
        updatedAt: vNow
    };

    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        const objClient = await objPool.connect();
        try {
            await objClient.query("BEGIN");
            await ensureUniqueUserName(objClient, objProfile.accountId, objProfile.userName);
            await objClient.query(`
                INSERT INTO optionyze_cs_delta_api_profiles (
                    profile_id,
                    account_id,
                    user_name,
                    delta_api_key,
                    delta_api_secret,
                    coinswitch_api_key,
                    coinswitch_api_secret,
                    created_at,
                    updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `, [
                objProfile.profileId,
                objProfile.accountId,
                objProfile.userName,
                objProfile.deltaApiKey,
                objProfile.deltaApiSecret,
                objProfile.coinswitchApiKey,
                objProfile.coinswitchApiSecret,
                objProfile.createdAt,
                objProfile.updatedAt
            ]);
            await objClient.query("COMMIT");
        }
        catch (objError) {
            await objClient.query("ROLLBACK");
            throw objError;
        }
        finally {
            objClient.release();
        }
        return mapSummaryRecord(objProfile);
    }

    const objProfiles = await loadJsonProfiles();
    ensureUniqueUserNameJson(objProfiles, objProfile.accountId, objProfile.userName);
    objProfiles.push(objProfile);
    await writeJsonFileAtomic(gProfilesFile, objProfiles);
    return mapSummaryRecord(objProfile);
}

export async function updateCsDeltaApiProfile(pProfileId: string, pInput: UpdateCsDeltaApiProfileInput): Promise<CsDeltaApiProfileSummary> {
    const vProfileId = String(pProfileId || "").trim();
    const vAccountId = String(pInput.accountId || "").trim();

    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        const objClient = await objPool.connect();
        try {
            await objClient.query("BEGIN");
            const objExisting = await getCsDeltaApiProfile(vAccountId, vProfileId);
            if (!objExisting) {
                throw new Error("API credential profile not found.");
            }

            const vUserName = String(pInput.userName || "").trim();
            await ensureUniqueUserName(objClient, vAccountId, vUserName, vProfileId);
            const vDeltaApiKey = normalizeKey(pInput.deltaApiKey) || objExisting.deltaApiKey;
            const vDeltaApiSecret = String(pInput.deltaApiSecret || "").trim() || objExisting.deltaApiSecret;
            const vCoinswitchApiKey = normalizeKey(pInput.coinswitchApiKey) || objExisting.coinswitchApiKey;
            const vCoinswitchApiSecret = String(pInput.coinswitchApiSecret || "").trim() || objExisting.coinswitchApiSecret;
            const vUpdatedAt = new Date().toISOString();

            await objClient.query(`
                UPDATE optionyze_cs_delta_api_profiles
                SET user_name = $3,
                    delta_api_key = $4,
                    delta_api_secret = $5,
                    coinswitch_api_key = $6,
                    coinswitch_api_secret = $7,
                    updated_at = $8
                WHERE account_id = $1
                  AND profile_id = $2
            `, [
                vAccountId,
                vProfileId,
                vUserName,
                vDeltaApiKey,
                vDeltaApiSecret,
                vCoinswitchApiKey,
                vCoinswitchApiSecret,
                vUpdatedAt
            ]);
            await objClient.query("COMMIT");
        }
        catch (objError) {
            await objClient.query("ROLLBACK");
            throw objError;
        }
        finally {
            objClient.release();
        }

        const objUpdated = await getCsDeltaApiProfile(vAccountId, vProfileId);
        if (!objUpdated) {
            throw new Error("API credential profile not found after update.");
        }
        return mapSummaryRecord(objUpdated);
    }

    const objProfiles = await loadJsonProfiles();
    const vIndex = objProfiles.findIndex((objProfile) => objProfile.accountId === vAccountId && objProfile.profileId === vProfileId);
    if (vIndex < 0) {
        throw new Error("API credential profile not found.");
    }

    ensureUniqueUserNameJson(objProfiles, vAccountId, pInput.userName, vProfileId);
    const objExisting = objProfiles[vIndex];
    const objUpdated: CsDeltaApiProfileRecord = {
        ...objExisting,
        userName: String(pInput.userName || "").trim(),
        deltaApiKey: normalizeKey(pInput.deltaApiKey) || objExisting.deltaApiKey,
        deltaApiSecret: String(pInput.deltaApiSecret || "").trim() || objExisting.deltaApiSecret,
        coinswitchApiKey: normalizeKey(pInput.coinswitchApiKey) || objExisting.coinswitchApiKey,
        coinswitchApiSecret: String(pInput.coinswitchApiSecret || "").trim() || objExisting.coinswitchApiSecret,
        updatedAt: new Date().toISOString()
    };
    objProfiles[vIndex] = objUpdated;
    await writeJsonFileAtomic(gProfilesFile, objProfiles);
    return mapSummaryRecord(objUpdated);
}

export async function deleteCsDeltaApiProfile(pAccountId: string, pProfileId: string): Promise<void> {
    const vAccountId = String(pAccountId || "").trim();
    const vProfileId = String(pProfileId || "").trim();

    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        await objPool.query(`
            DELETE FROM optionyze_cs_delta_api_profiles
            WHERE account_id = $1
              AND profile_id = $2
        `, [vAccountId, vProfileId]);
        return;
    }

    const objProfiles = await loadJsonProfiles();
    const objFiltered = objProfiles.filter((objProfile) => !(objProfile.accountId === vAccountId && objProfile.profileId === vProfileId));
    await writeJsonFileAtomic(gProfilesFile, objFiltered);
}

function mapFullRow(pRow?: CsDeltaApiProfileRow | null): CsDeltaApiProfileRecord | null {
    if (!pRow) {
        return null;
    }

    return {
        profileId: String(pRow.profile_id),
        accountId: String(pRow.account_id),
        userName: String(pRow.user_name || ""),
        deltaApiKey: String(pRow.delta_api_key || ""),
        deltaApiSecret: String(pRow.delta_api_secret || ""),
        coinswitchApiKey: String(pRow.coinswitch_api_key || ""),
        coinswitchApiSecret: String(pRow.coinswitch_api_secret || ""),
        createdAt: new Date(pRow.created_at).toISOString(),
        updatedAt: new Date(pRow.updated_at).toISOString()
    };
}

function mapSummaryRow(pRow: CsDeltaApiProfileRow): CsDeltaApiProfileSummary {
    return mapSummaryRecord({
        profileId: String(pRow.profile_id),
        accountId: String(pRow.account_id),
        userName: String(pRow.user_name || ""),
        deltaApiKey: String(pRow.delta_api_key || ""),
        deltaApiSecret: String(pRow.delta_api_secret || ""),
        coinswitchApiKey: String(pRow.coinswitch_api_key || ""),
        coinswitchApiSecret: String(pRow.coinswitch_api_secret || ""),
        createdAt: new Date(pRow.created_at).toISOString(),
        updatedAt: new Date(pRow.updated_at).toISOString()
    });
}

function mapSummaryRecord(pRecord: CsDeltaApiProfileRecord): CsDeltaApiProfileSummary {
    return {
        profileId: pRecord.profileId,
        accountId: pRecord.accountId,
        userName: pRecord.userName,
        deltaApiKeyMasked: maskApiKey(pRecord.deltaApiKey),
        coinswitchApiKeyMasked: maskApiKey(pRecord.coinswitchApiKey),
        hasDeltaSecret: String(pRecord.deltaApiSecret || "").trim().length > 0,
        hasCoinswitchSecret: String(pRecord.coinswitchApiSecret || "").trim().length > 0,
        createdAt: pRecord.createdAt,
        updatedAt: pRecord.updatedAt
    };
}

function maskApiKey(pApiKey: string): string {
    const vApiKey = String(pApiKey || "").trim();
    if (!vApiKey) {
        return "-";
    }
    if (vApiKey.length <= 8) {
        return `${vApiKey.slice(0, 2)}***${vApiKey.slice(-2)}`;
    }
    return `${vApiKey.slice(0, 4)}...${vApiKey.slice(-4)}`;
}

function normalizeKey(pApiKey?: string): string {
    return String(pApiKey || "").trim();
}

async function ensureUniqueUserName(pRunner: CsDeltaApiProfileQueryRunner, pAccountId: string, pUserName: string, pExcludeProfileId = ""): Promise<void> {
    const objResult = await pRunner.query<{ profile_id: string }>(`
        SELECT profile_id
        FROM optionyze_cs_delta_api_profiles
        WHERE account_id = $1
          AND LOWER(user_name) = LOWER($2)
          AND ($3 = '' OR profile_id <> $3)
        LIMIT 1
    `, [String(pAccountId || "").trim(), String(pUserName || "").trim(), String(pExcludeProfileId || "").trim()]);

    if (objResult.rows[0]) {
        throw new Error("User Name already exists for this account.");
    }
}

function ensureUniqueUserNameJson(pProfiles: CsDeltaApiProfileRecord[], pAccountId: string, pUserName: string, pExcludeProfileId = ""): void {
    const vAccountId = String(pAccountId || "").trim();
    const vUserName = String(pUserName || "").trim().toLowerCase();
    const vExcludeProfileId = String(pExcludeProfileId || "").trim();
    const objExisting = pProfiles.find((objProfile) => (
        objProfile.accountId === vAccountId &&
        objProfile.userName.trim().toLowerCase() === vUserName &&
        objProfile.profileId !== vExcludeProfileId
    ));

    if (objExisting) {
        throw new Error("User Name already exists for this account.");
    }
}
