import crypto from "node:crypto";
import path from "node:path";
import { readJsonFile, writeJsonFileAtomic } from "./json-store";
import { getPostgresPool, isPostgresConfigured } from "./postgres";

export interface DeltaApiProfileRecord {
    profileId: string;
    accountId: string;
    referenceName: string;
    apiKey: string;
    apiSecret: string;
    createdAt: string;
    updatedAt: string;
}

export interface DeltaApiProfileSummary {
    profileId: string;
    accountId: string;
    referenceName: string;
    apiKey: string;
    hasSecret: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface CreateDeltaApiProfileInput {
    accountId: string;
    referenceName: string;
    apiKey: string;
    apiSecret: string;
}

export interface UpdateDeltaApiProfileInput {
    accountId: string;
    referenceName: string;
    apiKey: string;
    apiSecret?: string;
}

interface DeltaApiProfileRow {
    profile_id: string;
    account_id: string;
    reference_name: string;
    api_key: string;
    api_secret: string;
    created_at: string | Date;
    updated_at: string | Date;
}

interface DeltaApiProfileQueryRunner {
    query<TResult = unknown>(text: string, values?: unknown[]): Promise<{ rows: TResult[] }>;
}

const gProfilesFile = path.resolve(process.cwd(), "data", "delta-api", "profiles.json");

async function loadJsonProfiles(): Promise<DeltaApiProfileRecord[]> {
    return readJsonFile<DeltaApiProfileRecord[]>(gProfilesFile, []);
}

export async function listDeltaApiProfiles(pAccountId: string): Promise<DeltaApiProfileSummary[]> {
    const vAccountId = String(pAccountId || "").trim();
    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        const objResult = await objPool.query<DeltaApiProfileRow>(`
            SELECT profile_id, account_id, reference_name, api_key, api_secret, created_at, updated_at
            FROM optionyze_delta_api_profiles
            WHERE account_id = $1
            ORDER BY updated_at DESC, reference_name ASC
        `, [vAccountId]);

        return objResult.rows.map(mapSummaryRow);
    }

    const objProfiles = await loadJsonProfiles();
    return objProfiles
        .filter((objProfile) => objProfile.accountId === vAccountId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.referenceName.localeCompare(b.referenceName))
        .map(mapSummaryRecord);
}

export async function getDeltaApiProfile(pAccountId: string, pProfileId: string): Promise<DeltaApiProfileRecord | null> {
    const vAccountId = String(pAccountId || "").trim();
    const vProfileId = String(pProfileId || "").trim();

    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        const objResult = await objPool.query<DeltaApiProfileRow>(`
            SELECT profile_id, account_id, reference_name, api_key, api_secret, created_at, updated_at
            FROM optionyze_delta_api_profiles
            WHERE account_id = $1
              AND profile_id = $2
        `, [vAccountId, vProfileId]);

        return mapFullRow(objResult.rows[0]);
    }

    const objProfiles = await loadJsonProfiles();
    return objProfiles.find((objProfile) => objProfile.accountId === vAccountId && objProfile.profileId === vProfileId) || null;
}

export async function createDeltaApiProfile(pInput: CreateDeltaApiProfileInput): Promise<DeltaApiProfileSummary> {
    const vNow = new Date().toISOString();
    const objProfile: DeltaApiProfileRecord = {
        profileId: crypto.randomUUID(),
        accountId: String(pInput.accountId || "").trim(),
        referenceName: String(pInput.referenceName || "").trim(),
        apiKey: String(pInput.apiKey || "").trim(),
        apiSecret: String(pInput.apiSecret || "").trim(),
        createdAt: vNow,
        updatedAt: vNow
    };

    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        const objClient = await objPool.connect();
        try {
            await objClient.query("BEGIN");
            await acquireDeltaApiKeyGuard(objClient, objProfile.apiKey);
            await ensureUniqueReferenceName(objClient, objProfile.accountId, objProfile.referenceName);
            await ensureUniqueApiKey(objClient, objProfile.apiKey);
            await objClient.query(`
                INSERT INTO optionyze_delta_api_profiles (
                    profile_id,
                    account_id,
                    reference_name,
                    api_key,
                    api_secret,
                    created_at,
                    updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [
                objProfile.profileId,
                objProfile.accountId,
                objProfile.referenceName,
                objProfile.apiKey,
                objProfile.apiSecret,
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
    ensureUniqueReferenceNameJson(objProfiles, objProfile.accountId, objProfile.referenceName);
    ensureUniqueApiKeyJson(objProfiles, objProfile.apiKey);
    objProfiles.push(objProfile);
    await writeJsonFileAtomic(gProfilesFile, objProfiles);
    return mapSummaryRecord(objProfile);
}

export async function updateDeltaApiProfile(pProfileId: string, pInput: UpdateDeltaApiProfileInput): Promise<DeltaApiProfileSummary> {
    const vProfileId = String(pProfileId || "").trim();
    const vAccountId = String(pInput.accountId || "").trim();

    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        const objClient = await objPool.connect();
        try {
            await objClient.query("BEGIN");
            const objExisting = await getDeltaApiProfile(vAccountId, vProfileId);
            if (!objExisting) {
                throw new Error("API credential profile not found.");
            }

            const vApiKey = normalizeDeltaApiKey(pInput.apiKey);
            await acquireDeltaApiKeyGuard(objClient, vApiKey);
            await ensureUniqueReferenceName(objClient, vAccountId, pInput.referenceName, vProfileId);
            await ensureUniqueApiKey(objClient, vApiKey, vProfileId);
            const vApiSecret = String(pInput.apiSecret || "").trim() || objExisting.apiSecret;
            const vUpdatedAt = new Date().toISOString();

            await objClient.query(`
                UPDATE optionyze_delta_api_profiles
                SET reference_name = $3,
                    api_key = $4,
                    api_secret = $5,
                    updated_at = $6
                WHERE account_id = $1
                  AND profile_id = $2
            `, [
                vAccountId,
                vProfileId,
                String(pInput.referenceName || "").trim(),
                vApiKey,
                vApiSecret,
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

        const objUpdated = await getDeltaApiProfile(vAccountId, vProfileId);
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

    ensureUniqueReferenceNameJson(objProfiles, vAccountId, pInput.referenceName, vProfileId);
    ensureUniqueApiKeyJson(objProfiles, pInput.apiKey, vProfileId);
    const objExisting = objProfiles[vIndex];
    const objUpdated: DeltaApiProfileRecord = {
        ...objExisting,
        referenceName: String(pInput.referenceName || "").trim(),
        apiKey: normalizeDeltaApiKey(pInput.apiKey),
        apiSecret: String(pInput.apiSecret || "").trim() || objExisting.apiSecret,
        updatedAt: new Date().toISOString()
    };
    objProfiles[vIndex] = objUpdated;
    await writeJsonFileAtomic(gProfilesFile, objProfiles);
    return mapSummaryRecord(objUpdated);
}

export async function deleteDeltaApiProfile(pAccountId: string, pProfileId: string): Promise<void> {
    const vAccountId = String(pAccountId || "").trim();
    const vProfileId = String(pProfileId || "").trim();

    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        await objPool.query(`
            DELETE FROM optionyze_delta_api_profiles
            WHERE account_id = $1
              AND profile_id = $2
        `, [vAccountId, vProfileId]);
        return;
    }

    const objProfiles = await loadJsonProfiles();
    const objFiltered = objProfiles.filter((objProfile) => !(objProfile.accountId === vAccountId && objProfile.profileId === vProfileId));
    await writeJsonFileAtomic(gProfilesFile, objFiltered);
}

function mapFullRow(pRow?: DeltaApiProfileRow | null): DeltaApiProfileRecord | null {
    if (!pRow) {
        return null;
    }

    return {
        profileId: String(pRow.profile_id),
        accountId: String(pRow.account_id),
        referenceName: String(pRow.reference_name || ""),
        apiKey: String(pRow.api_key || ""),
        apiSecret: String(pRow.api_secret || ""),
        createdAt: new Date(pRow.created_at).toISOString(),
        updatedAt: new Date(pRow.updated_at).toISOString()
    };
}

function mapSummaryRow(pRow: DeltaApiProfileRow): DeltaApiProfileSummary {
    return {
        profileId: String(pRow.profile_id),
        accountId: String(pRow.account_id),
        referenceName: String(pRow.reference_name || ""),
        apiKey: String(pRow.api_key || ""),
        hasSecret: String(pRow.api_secret || "").trim().length > 0,
        createdAt: new Date(pRow.created_at).toISOString(),
        updatedAt: new Date(pRow.updated_at).toISOString()
    };
}

function mapSummaryRecord(pRecord: DeltaApiProfileRecord): DeltaApiProfileSummary {
    return {
        profileId: pRecord.profileId,
        accountId: pRecord.accountId,
        referenceName: pRecord.referenceName,
        apiKey: pRecord.apiKey,
        hasSecret: String(pRecord.apiSecret || "").trim().length > 0,
        createdAt: pRecord.createdAt,
        updatedAt: pRecord.updatedAt
    };
}

function normalizeDeltaApiKey(pApiKey: string): string {
    return String(pApiKey || "").trim();
}

async function acquireDeltaApiKeyGuard(pRunner: DeltaApiProfileQueryRunner, pApiKey: string): Promise<void> {
    const vApiKey = normalizeDeltaApiKey(pApiKey);
    if (!vApiKey) {
        return;
    }

    await pRunner.query("SELECT pg_advisory_xact_lock(hashtext($1))", [vApiKey]);
}

async function ensureUniqueReferenceName(pRunner: DeltaApiProfileQueryRunner, pAccountId: string, pReferenceName: string, pExcludeProfileId = ""): Promise<void> {
    const objResult = await pRunner.query<{ profile_id: string }>(`
        SELECT profile_id
        FROM optionyze_delta_api_profiles
        WHERE account_id = $1
          AND LOWER(reference_name) = LOWER($2)
          AND ($3 = '' OR profile_id <> $3)
        LIMIT 1
    `, [String(pAccountId || "").trim(), String(pReferenceName || "").trim(), String(pExcludeProfileId || "").trim()]);

    if (objResult.rows[0]) {
        throw new Error("Reference Name already exists for this account.");
    }
}

async function ensureUniqueApiKey(pRunner: DeltaApiProfileQueryRunner, pApiKey: string, pExcludeProfileId = ""): Promise<void> {
    const vApiKey = normalizeDeltaApiKey(pApiKey);
    const objResult = await pRunner.query<{ profile_id: string; account_id: string }>(`
        SELECT profile_id, account_id
        FROM optionyze_delta_api_profiles
        WHERE BTRIM(api_key) = BTRIM($1)
          AND ($2 = '' OR profile_id <> $2)
        LIMIT 1
    `, [vApiKey, String(pExcludeProfileId || "").trim()]);

    if (objResult.rows[0]) {
        throw new Error("API Key already exists for another user profile.");
    }
}

function ensureUniqueReferenceNameJson(pProfiles: DeltaApiProfileRecord[], pAccountId: string, pReferenceName: string, pExcludeProfileId = ""): void {
    const vAccountId = String(pAccountId || "").trim();
    const vReferenceName = String(pReferenceName || "").trim().toLowerCase();
    const vExcludeProfileId = String(pExcludeProfileId || "").trim();
    const objExisting = pProfiles.find((objProfile) => (
        objProfile.accountId === vAccountId &&
        objProfile.referenceName.trim().toLowerCase() === vReferenceName &&
        objProfile.profileId !== vExcludeProfileId
    ));

    if (objExisting) {
        throw new Error("Reference Name already exists for this account.");
    }
}

function ensureUniqueApiKeyJson(pProfiles: DeltaApiProfileRecord[], pApiKey: string, pExcludeProfileId = ""): void {
    const vApiKey = normalizeDeltaApiKey(pApiKey);
    const vExcludeProfileId = String(pExcludeProfileId || "").trim();
    const objExisting = pProfiles.find((objProfile) => (
        normalizeDeltaApiKey(objProfile.apiKey) === vApiKey
        && objProfile.profileId !== vExcludeProfileId
    ));

    if (objExisting) {
        throw new Error("API Key already exists for another user profile.");
    }
}
