import {
    loadRollingOptionsPtDeProfile,
    saveRollingOptionsPtDeProfile
} from "../../storage/rolling-options-pt-de-profile-store";
import type { RollingOptionsPtDePositionRecord } from "../../storage/rolling-options-pt-de-position-store";

export async function applyClosedOptionPnlToProfile(
    pUserId: string,
    pPositions: RollingOptionsPtDePositionRecord[]
): Promise<number> {
    const vOptionPnlDelta = pPositions.reduce((pSum, objPosition) => {
        if (objPosition.instrumentType !== "OPTION") {
            return pSum;
        }

        const vPnl = Number(objPosition.pnl || 0);
        return pSum + (Number.isFinite(vPnl) ? vPnl : 0);
    }, 0);

    if (!Number.isFinite(vOptionPnlDelta) || vOptionPnlDelta === 0) {
        return 0;
    }

    const objProfile = await loadRollingOptionsPtDeProfile(pUserId);
    const objUiState = {
        ...(objProfile?.uiState || {})
    };
    const vCurrentOptionsPnl = Number(objUiState.optionsPnl || 0);
    const vNextOptionsPnl = Number(((Number.isFinite(vCurrentOptionsPnl) ? vCurrentOptionsPnl : 0) + vOptionPnlDelta).toFixed(3));

    await saveRollingOptionsPtDeProfile({
        userId: pUserId,
        uiState: {
            ...objUiState,
            optionsPnl: vNextOptionsPnl
        },
        updatedAt: ""
    });

    return vOptionPnlDelta;
}
