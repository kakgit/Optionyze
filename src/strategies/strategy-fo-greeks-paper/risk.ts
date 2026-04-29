import type { PortfolioSnapshot, RiskActions, StrategyFoGreeksPaperState } from "./types";

export function assessRisk(pState: StrategyFoGreeksPaperState, pPortfolio: PortfolioSnapshot): RiskActions {
    const objConfig = pState.config;
    const objActions: RiskActions = {
        closeAll: false,
        closeAllReason: "",
        blockNewEntries: false,
        gammaProtection: false,
        needsThetaRepair: false
    };

    if (pState.killSwitch.enabled) {
        objActions.closeAll = true;
        objActions.closeAllReason = `Kill switch: ${pState.killSwitch.reason || "Triggered"}`;
        objActions.blockNewEntries = true;
        return objActions;
    }

    if (pState.consecutiveFailures >= objConfig.maxConsecutiveFailures) {
        objActions.closeAll = true;
        objActions.closeAllReason = "API failure threshold reached";
        objActions.blockNewEntries = true;
        return objActions;
    }

    if (pPortfolio.marginUsed > 0 && pPortfolio.pnlOnMarginPct >= objConfig.profitExitPct) {
        objActions.closeAll = true;
        objActions.closeAllReason = "Profit target reached";
    }

    if (pPortfolio.marginUsed > 0 && pPortfolio.pnlOnMarginPct <= (-1 * objConfig.maxLossPct)) {
        objActions.closeAll = true;
        objActions.closeAllReason = "Max loss cutoff reached";
    }

    if (Math.abs(pPortfolio.totalGamma) > objConfig.gammaMaxAbs) {
        objActions.gammaProtection = true;
        objActions.blockNewEntries = true;
    }

    if (objConfig.requirePositiveTheta && pPortfolio.totalTheta <= 0) {
        objActions.needsThetaRepair = true;
    }

    if (pPortfolio.openCount >= objConfig.maxOpenPositions) {
        objActions.blockNewEntries = true;
    }

    return objActions;
}
