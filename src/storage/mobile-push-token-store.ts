import { getPostgresPool } from "./postgres";

export type MobilePushPlatform = "android";

export interface MobilePushTokenRecord {
    token: string;
    accountId: string;
    platform: MobilePushPlatform;
    deviceLabel: string;
    createdAt: string;
    updatedAt: string;
}

interface MobilePushTokenRow {
    token: string;
    account_id: string;
    platform: string;
    device_label: string;
    created_at: string | Date;
    updated_at: string | Date;
}

export async function registerMobilePushToken(pInput: {
    token: string;
    accountId: string;
    platform: MobilePushPlatform;
    deviceLabel: string;
}): Promise<MobilePushTokenRecord> {
    const objPool = getPostgresPool();
    const objResult = await objPool.query<MobilePushTokenRow>(`
        INSERT INTO optionyze_mobile_push_tokens (
            token,
            account_id,
            platform,
            device_label,
            created_at,
            updated_at
        ) VALUES ($1, $2, $3, $4, NOW(), NOW())
        ON CONFLICT (token) DO UPDATE
        SET account_id = EXCLUDED.account_id,
            platform = EXCLUDED.platform,
            device_label = EXCLUDED.device_label,
            updated_at = NOW()
        RETURNING token, account_id, platform, device_label, created_at, updated_at
    `, [
        String(pInput.token || "").trim(),
        String(pInput.accountId || "").trim(),
        pInput.platform,
        String(pInput.deviceLabel || "").trim()
    ]);

    return mapRow(objResult.rows[0]);
}

export async function listMobilePushTokens(pAccountId: string): Promise<MobilePushTokenRecord[]> {
    const objPool = getPostgresPool();
    const objResult = await objPool.query<MobilePushTokenRow>(`
        SELECT token, account_id, platform, device_label, created_at, updated_at
        FROM optionyze_mobile_push_tokens
        WHERE account_id = $1
        ORDER BY updated_at DESC
    `, [String(pAccountId || "").trim()]);

    return objResult.rows.map(mapRow);
}

export async function deleteMobilePushToken(pToken: string): Promise<void> {
    const objPool = getPostgresPool();
    await objPool.query(`
        DELETE FROM optionyze_mobile_push_tokens
        WHERE token = $1
    `, [String(pToken || "").trim()]);
}

function mapRow(pRow: MobilePushTokenRow): MobilePushTokenRecord {
    return {
        token: String(pRow.token || ""),
        accountId: String(pRow.account_id || ""),
        platform: String(pRow.platform || "android") as MobilePushPlatform,
        deviceLabel: String(pRow.device_label || ""),
        createdAt: new Date(pRow.created_at).toISOString(),
        updatedAt: new Date(pRow.updated_at).toISOString()
    };
}
