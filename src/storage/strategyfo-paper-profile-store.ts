import path from "node:path";
import { readJsonFile, writeJsonFileAtomic } from "./json-store";
import { getPostgresPool, isPostgresConfigured } from "./postgres";

export interface StrategyFoPaperProfileRecord {
    userId: string;
    apiKey: string;
    apiSecret: string;
    referenceName: string;
    autoTraderEnabled: boolean;
    uiState: Record<string, unknown>;
    updatedAt: string;
}

interface StrategyFoPaperProfileRow {
    user_id: string;
    api_key: string;
    api_secret: string;
    reference_name: string;
    auto_trader_enabled: boolean;
    ui_state: Record<string, unknown> | null;
    updated_at: string | Date;
}

const gProfilesFile = path.resolve(process.cwd(), "data", "strategyfo", "paper-profiles.json");

async function loadAllProfilesJson(): Promise<StrategyFoPaperProfileRecord[]> {
    return readJsonFile<StrategyFoPaperProfileRecord[]>(gProfilesFile, []);
}

export async function loadStrategyFoPaperProfile(pUserId: string): Promise<StrategyFoPaperProfileRecord | null> {
    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        const objResult = await objPool.query<StrategyFoPaperProfileRow>(`
            SELECT
                user_id,
                api_key,
                api_secret,
                reference_name,
                auto_trader_enabled,
                ui_state,
                updated_at
            FROM optionyze_strategyfo_paper_profiles
            WHERE user_id = $1
        `, [pUserId]);

        const objRow = objResult.rows[0];
        if (!objRow) {
            return null;
        }

        return {
            userId: String(objRow.user_id),
            apiKey: String(objRow.api_key || ""),
            apiSecret: String(objRow.api_secret || ""),
            referenceName: String(objRow.reference_name || ""),
            autoTraderEnabled: Boolean(objRow.auto_trader_enabled),
            uiState: (objRow.ui_state ?? {}) as Record<string, unknown>,
            updatedAt: new Date(objRow.updated_at).toISOString()
        };
    }

    const objProfiles = await loadAllProfilesJson();
    return objProfiles.find((objProfile) => objProfile.userId === pUserId) || null;
}

export async function saveStrategyFoPaperProfile(
    pProfile: StrategyFoPaperProfileRecord
): Promise<StrategyFoPaperProfileRecord> {
    const objProfile: StrategyFoPaperProfileRecord = {
        ...pProfile,
        updatedAt: new Date().toISOString()
    };

    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        await objPool.query(`
            INSERT INTO optionyze_strategyfo_paper_profiles (
                user_id,
                api_key,
                api_secret,
                reference_name,
                auto_trader_enabled,
                ui_state,
                updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
            ON CONFLICT (user_id)
            DO UPDATE SET
                api_key = EXCLUDED.api_key,
                api_secret = EXCLUDED.api_secret,
                reference_name = EXCLUDED.reference_name,
                auto_trader_enabled = EXCLUDED.auto_trader_enabled,
                ui_state = EXCLUDED.ui_state,
                updated_at = EXCLUDED.updated_at
        `, [
            objProfile.userId,
            objProfile.apiKey,
            objProfile.apiSecret,
            objProfile.referenceName,
            objProfile.autoTraderEnabled,
            JSON.stringify(objProfile.uiState || {}),
            objProfile.updatedAt
        ]);
        return objProfile;
    }

    const objProfiles = await loadAllProfilesJson();
    const objOtherProfiles = objProfiles.filter((objRow) => objRow.userId !== objProfile.userId);
    objOtherProfiles.push(objProfile);
    await writeJsonFileAtomic(gProfilesFile, objOtherProfiles);
    return objProfile;
}
