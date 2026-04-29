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
        await ensureUniqueReferenceName(objPool, objProfile.accountId, objProfile.referenceName);
        await objPool.query(`
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
        return mapSummaryRecord(objProfile);
    }

    const objProfiles = await loadJsonProfiles();
    ensureUniqueReferenceNameJson(objProfiles, objProfile.accountId, objProfile.referenceName);
    objProfiles.push(objProfile);
    await writeJsonFileAtomic(gProfilesFile, objProfiles);
    return mapSummaryRecord(objProfile);
}

export async function updateDeltaApiProfile(pProfileId: string, pInput: UpdateDeltaApiProfileInput): Promise<DeltaApiProfileSummary> {
    const vProfileId = String(pProfileId || "").trim();
    const vAccountId = String(pInput.accountId || "").trim();

    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        const objExisting = await getDeltaApiProfile(vAccountId, vProfileId);
        if (!objExisting) {
            throw new Error("API credential profile not found.");
        }

        await ensureUniqueReferenceName(objPool, vAccountId, pInput.referenceName, vProfileId);
        const vApiSecret = String(pInput.apiSecret || "").trim() || objExisting.apiSecret;
        const vUpdatedAt = new Date().toISOString();

        await objPool.query(`
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
            String(pInput.apiKey || "").trim(),
            vApiSecret,
            vUpdatedAt
        ]);

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
    const objExisting = objProfiles[vIndex];
    const objUpdated: DeltaApiProfileRecord = {
        ...objExisting,
        referenceName: String(pInput.referenceName || "").trim(),
        apiKey: String(pInput.apiKey || "").trim(),
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

async function ensureUniqueReferenceName(pPool: ReturnType<typeof getPostgresPool>, pAccountId: string, pReferenceName: string, pExcludeProfileId = ""): Promise<void> {
    const objResult = await pPool.query<{ profile_id: string }>(`
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
