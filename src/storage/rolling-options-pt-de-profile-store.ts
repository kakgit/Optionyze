import path from "node:path";
import { readJsonFile, writeJsonFileAtomic } from "./json-store";
import { getPostgresPool, isPostgresConfigured } from "./postgres";

export interface RollingOptionsPtDeProfileRecord {
    userId: string;
    uiState: Record<string, unknown>;
    updatedAt: string;
}

interface RollingOptionsPtDeProfileRow {
    user_id: string;
    ui_state: Record<string, unknown> | null;
    updated_at: string | Date;
}

const gProfilesFile = path.resolve(process.cwd(), "data", "rolling-options-pt-de", "profiles.json");

async function loadAllProfilesJson(): Promise<RollingOptionsPtDeProfileRecord[]> {
    return readJsonFile<RollingOptionsPtDeProfileRecord[]>(gProfilesFile, []);
}

export async function loadRollingOptionsPtDeProfile(pUserId: string): Promise<RollingOptionsPtDeProfileRecord | null> {
    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        const objResult = await objPool.query<RollingOptionsPtDeProfileRow>(`
            SELECT
                user_id,
                ui_state,
                updated_at
            FROM optionyze_rolling_options_pt_de_profiles
            WHERE user_id = $1
        `, [pUserId]);

        const objRow = objResult.rows[0];
        if (!objRow) {
            return null;
        }

        return {
            userId: String(objRow.user_id),
            uiState: (objRow.ui_state ?? {}) as Record<string, unknown>,
            updatedAt: new Date(objRow.updated_at).toISOString()
        };
    }

    const objProfiles = await loadAllProfilesJson();
    return objProfiles.find((objProfile) => objProfile.userId === pUserId) || null;
}

export async function saveRollingOptionsPtDeProfile(
    pProfile: RollingOptionsPtDeProfileRecord
): Promise<RollingOptionsPtDeProfileRecord> {
    const objProfile: RollingOptionsPtDeProfileRecord = {
        ...pProfile,
        updatedAt: new Date().toISOString()
    };

    if (isPostgresConfigured()) {
        const objPool = getPostgresPool();
        await objPool.query(`
            INSERT INTO optionyze_rolling_options_pt_de_profiles (
                user_id,
                ui_state,
                updated_at
            ) VALUES ($1, $2::jsonb, $3)
            ON CONFLICT (user_id)
            DO UPDATE SET
                ui_state = EXCLUDED.ui_state,
                updated_at = EXCLUDED.updated_at
        `, [
            objProfile.userId,
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
