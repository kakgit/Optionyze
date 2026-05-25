import { getSurvivalPostgresPool, isSurvivalPostgresConfigured } from "./survival-postgres";

export interface SurvivalAccountDirectoryRecord {
    accountId: string;
    fullName: string;
    email: string;
    isActive: boolean;
    updatedAt: string;
}

interface SurvivalAccountDirectoryRow {
    account_id: string;
    full_name: string;
    email: string;
    is_active: boolean;
    updated_at: string | Date;
}

function mapRow(pRow?: SurvivalAccountDirectoryRow | null): SurvivalAccountDirectoryRecord | null {
    if (!pRow) {
        return null;
    }

    return {
        accountId: String(pRow.account_id || "").trim(),
        fullName: String(pRow.full_name || "").trim(),
        email: String(pRow.email || "").trim(),
        isActive: Boolean(pRow.is_active),
        updatedAt: new Date(pRow.updated_at).toISOString()
    };
}

export async function upsertSurvivalAccountDirectoryEntry(pInput: {
    accountId: string;
    fullName: string;
    email: string;
    isActive: boolean;
}): Promise<void> {
    if (!isSurvivalPostgresConfigured()) {
        return;
    }

    const objPool = getSurvivalPostgresPool();
    await objPool.query(`
        INSERT INTO optionyze_survival_account_directory (
            account_id,
            full_name,
            email,
            is_active,
            updated_at
        ) VALUES ($1,$2,$3,$4,NOW())
        ON CONFLICT (account_id)
        DO UPDATE SET
            full_name = EXCLUDED.full_name,
            email = EXCLUDED.email,
            is_active = EXCLUDED.is_active,
            updated_at = NOW()
    `, [
        String(pInput.accountId || "").trim(),
        String(pInput.fullName || "").trim(),
        String(pInput.email || "").trim().toLowerCase(),
        Boolean(pInput.isActive)
    ]);
}

export async function deleteSurvivalAccountDirectoryEntry(pAccountId: string): Promise<void> {
    if (!isSurvivalPostgresConfigured()) {
        return;
    }

    const objPool = getSurvivalPostgresPool();
    await objPool.query(`
        DELETE FROM optionyze_survival_account_directory
        WHERE account_id = $1
    `, [String(pAccountId || "").trim()]);
}

export async function listSurvivalAccountDirectoryEntries(): Promise<SurvivalAccountDirectoryRecord[]> {
    if (!isSurvivalPostgresConfigured()) {
        return [];
    }

    const objPool = getSurvivalPostgresPool();
    const objResult = await objPool.query<SurvivalAccountDirectoryRow>(`
        SELECT *
        FROM optionyze_survival_account_directory
        ORDER BY full_name ASC, email ASC
    `);

    return objResult.rows
        .map((objRow) => mapRow(objRow))
        .filter((objRow): objRow is SurvivalAccountDirectoryRecord => Boolean(objRow));
}
