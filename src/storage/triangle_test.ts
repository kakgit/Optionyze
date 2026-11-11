import crypto from "node:crypto";
import path from "node:path";
import { readJsonFile, writeJsonFileAtomic } from "./json-store";
import { getPostgresPool, isPostgresConfigured } from "./postgres";

export interface DeltaApiProfileRecord {
    profileId: string;
    accountId: string;
    exchange: string;
    referenceName: string;
    apiKey: string;
    apiSecret: string;
    createdAt: string;
    updatedAt: string;
}

export interface DeltaApiProfileSummary {
    profileId: string;
    accountId: string;
    exchange: string;
    referenceName: string;
    apiKey: string;
    hasSecret: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface CreateDeltaApiProfileInput {
    accountId: string;
    exchange: string;
    referenceName: string;
    apiKey: string;
    apiSecret: string;
}

export interface UpdateDeltaApiProfileInput {
    accountId: string;
    exchange?: string;
    referenceName: string;
    apiKey: string;
    apiSecret?: string;
}

interface DeltaApiProfileRow {
    profile_id: string;
    account_id: string;
    exchange: string;
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
