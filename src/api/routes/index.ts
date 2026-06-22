import { Router } from "express";
import { getHealth } from "../controllers/health-controller";
import {
    createManagedUserController,
    deleteManagedUserController,
    listManagedUsersController,
    listRunnerStates,
    resetManagedUserPasswordController,
    updateManagedUserController
} from "../controllers/users-controller";
import { listSurvivalAdminRunningUsers } from "../controllers/survival-admin-controller";
import {
    calculateCoveredOptionsRecommendedStartQty,
    checkRollingFuturesLtDualConnection,
    checkCoveredOptionsConnection,
    calculateRollingFuturesLtDualRecommendedStartQty,
    clearCoveredOptionsEventsController,
    clearRollingFuturesLtDualEventsController,
    closeCoveredOptionsImportedOpenPosition,
    deleteRollingFuturesLtDualEventController,
    deleteCoveredOptionsEventController,
    closeRollingFuturesLtDualImportedOpenPosition,
    deleteCoveredOptionsOpenPosition,
    deleteRollingFuturesLtDualOpenPosition,
    disableCoveredOptionsAutoTrader,
    disableRollingFuturesLtDualAutoTrader,
    enableCoveredOptionsAutoTrader,
    enableRollingFuturesLtDualAutoTrader,
    executeCoveredOptionsKillSwitch,
    confirmCoveredOptionsLiveAction,
    executeCoveredOptionsManualFuture,
    executeCoveredOptionsManualOption,
    executeCoveredOptionsStrategy,
    executeRollingFuturesLtDualKillSwitch,
    executeRollingFuturesLtDualManualFuture,
    executeRollingFuturesLtDualManualOption,
    executeRollingFuturesLtDualStrategy,
    forceRollingFuturesLtDualTakeoverHereController,
    enableRollingFuturesLtDualSimulatedPrimaryOutageController,
    getCoveredOptionsAccountSummary,
    getCoveredOptionsClosedPositions,
    getCoveredOptionsConnectionStatus,
    getCoveredOptionsEvents,
    getCoveredOptionsImportableOpenPositions,
    getCoveredOptionsOpenPositions,
    getCoveredOptionsProfile,
    getCoveredOptionsRuntimeStatus,
    listCoveredOptionsVerifierRunningUsers,
    getRollingFuturesLtDualAccountSummary,
    getRollingFuturesLtDualClosedPositions,
    getRollingFuturesLtDualConnectionStatus,
    getRollingFuturesLtDualEvents,
    getRollingFuturesLtDualImportableOpenPositions,
    getRollingFuturesLtDualOpenPositions,
    getRollingFuturesLtDualProfile,
    getRollingFuturesLtDualRuntimeStatus,
    listRollingFuturesLtDualRunningUsers,
    disableRollingFuturesLtDualSimulatedPrimaryOutageController,
    switchRollingFuturesLtDualBackToPrimaryController,
    recalculateCoveredOptionsRecoveryTotalPnl,
    recalculateRollingFuturesLtDualRecoveryTotalPnl,
    updateCoveredOptionsRecoveryMetrics,
    updateRollingFuturesLtDualRecoveryMetrics,
    reconcileCoveredOptionsOpenPositions,
    rejectCoveredOptionsLiveAction,
    reconcileRollingFuturesLtDualOpenPositions,
    saveCoveredOptionsOpenPositions,
    saveCoveredOptionsProfile,
    saveRollingFuturesLtDualOpenPositions,
    saveRollingFuturesLtDualProfile,
    clearCoveredOptionsOpenPositions,
    swapCoveredOptionsImportedOpenPosition,
    handleTelegramWebhook
} from "../controllers/rolling-futures-lt-controller";
import {
    createDeltaApiProfileController,
    deleteDeltaApiProfileController,
    listDeltaApiProfilesController,
    testDeltaApiProfileLoginController,
    updateDeltaApiProfileController
} from "../controllers/delta-api-controller";
import { registerMobilePushTokenController } from "../controllers/mobile-push-controller";
import type { RunnerManager } from "../../runners/runner-manager";
import { requireAdminApi, requireAuthApi, requireFreshPasswordApi, requireSurvivalAdminApi } from "../middleware/auth-middleware";

export function createApiRouter(pRunnerManager: RunnerManager): Router {
    const objRouter = Router();

    objRouter.get("/health", getHealth);
    objRouter.post("/telegram/webhook", async (req, res) => {
        await handleTelegramWebhook(req, res);
    });
    objRouter.get("/runners", requireAdminApi, async (req, res) => {
        await listRunnerStates(req, res, pRunnerManager);
    });
    objRouter.get("/admin/accounts", requireAdminApi, async (req, res) => {
        await listManagedUsersController(req, res);
    });
    objRouter.post("/admin/accounts", requireAdminApi, async (req, res) => {
        await createManagedUserController(req, res);
    });
    objRouter.put("/admin/accounts/:accountId", requireAdminApi, async (req, res) => {
        await updateManagedUserController(req, res);
    });
    objRouter.post("/admin/accounts/:accountId/reset-password", requireAdminApi, async (req, res) => {
        await resetManagedUserPasswordController(req, res);
    });
    objRouter.delete("/admin/accounts/:accountId", requireAdminApi, async (req, res) => {
        await deleteManagedUserController(req, res);
    });

    objRouter.post("/account/mobile-push-tokens", requireAuthApi, async (req, res) => {
        await registerMobilePushTokenController(req, res);
    });

    objRouter.get("/account/delta-api-profiles", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await listDeltaApiProfilesController(req, res);
    });
    objRouter.post("/account/delta-api-profiles", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await createDeltaApiProfileController(req, res);
    });
    objRouter.put("/account/delta-api-profiles/:profileId", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await updateDeltaApiProfileController(req, res);
    });
    objRouter.delete("/account/delta-api-profiles/:profileId", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await deleteDeltaApiProfileController(req, res);
    });
    objRouter.post("/account/delta-api-profiles/:profileId/test-login", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await testDeltaApiProfileLoginController(req, res);
    });

    objRouter.get("/rollingfutures-lt-dual/profile", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getRollingFuturesLtDualProfile(req, res);
    });
    objRouter.get("/rollingfutures-lt-dual/admin/running-users", requireAdminApi, requireFreshPasswordApi, async (req, res) => {
        await listRollingFuturesLtDualRunningUsers(req, res);
    });
    objRouter.get("/covered-options/admin/running-users", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await listCoveredOptionsVerifierRunningUsers(req, res);
    });
    objRouter.get("/survival-admin/running-users", requireSurvivalAdminApi, async (req, res) => {
        await listSurvivalAdminRunningUsers(req, res);
    });
    objRouter.post("/rollingfutures-lt-dual/admin/running-users/:accountId/simulate-primary-outage", requireAdminApi, requireFreshPasswordApi, async (req, res) => {
        await enableRollingFuturesLtDualSimulatedPrimaryOutageController(req, res);
    });
    objRouter.delete("/rollingfutures-lt-dual/admin/running-users/:accountId/simulate-primary-outage", requireAdminApi, requireFreshPasswordApi, async (req, res) => {
        await disableRollingFuturesLtDualSimulatedPrimaryOutageController(req, res);
    });
    objRouter.post("/rollingfutures-lt-dual/admin/running-users/:accountId/switch-primary", requireAdminApi, requireFreshPasswordApi, async (req, res) => {
        await switchRollingFuturesLtDualBackToPrimaryController(req, res);
    });
    objRouter.post("/survival-admin/running-users/:accountId/switch-primary", requireSurvivalAdminApi, async (req, res) => {
        await switchRollingFuturesLtDualBackToPrimaryController(req, res);
    });
    objRouter.post("/rollingfutures-lt-dual/admin/running-users/:accountId/force-takeover-here", requireAdminApi, requireFreshPasswordApi, async (req, res) => {
        await forceRollingFuturesLtDualTakeoverHereController(req, res);
    });
    objRouter.post("/survival-admin/running-users/:accountId/force-takeover-here", requireSurvivalAdminApi, async (req, res) => {
        await forceRollingFuturesLtDualTakeoverHereController(req, res);
    });
    objRouter.post("/rollingfutures-lt-dual/profile", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await saveRollingFuturesLtDualProfile(req, res);
    });
    objRouter.get("/rollingfutures-lt-dual/connection/status", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getRollingFuturesLtDualConnectionStatus(req, res);
    });
    objRouter.get("/rollingfutures-lt-dual/runtime", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getRollingFuturesLtDualRuntimeStatus(req, res);
    });
    objRouter.post("/rollingfutures-lt-dual/connection/check", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await checkRollingFuturesLtDualConnection(req, res);
    });
    objRouter.post("/rollingfutures-lt-dual/auto-trader/start", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await enableRollingFuturesLtDualAutoTrader(req, res);
    });
    objRouter.post("/rollingfutures-lt-dual/auto-trader/stop", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await disableRollingFuturesLtDualAutoTrader(req, res);
    });
    objRouter.get("/rollingfutures-lt-dual/account-summary", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getRollingFuturesLtDualAccountSummary(req, res);
    });
    objRouter.post("/rollingfutures-lt-dual/start-qty/calculate", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await calculateRollingFuturesLtDualRecommendedStartQty(req, res);
    });
    objRouter.post("/rollingfutures-lt-dual/manual/future", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await executeRollingFuturesLtDualManualFuture(req, res);
    });
    objRouter.post("/rollingfutures-lt-dual/manual/option", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await executeRollingFuturesLtDualManualOption(req, res);
    });
    objRouter.post("/rollingfutures-lt-dual/strategy/execute", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await executeRollingFuturesLtDualStrategy(req, res);
    });
    objRouter.get("/rollingfutures-lt-dual/open-positions/importable", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getRollingFuturesLtDualImportableOpenPositions(req, res);
    });
    objRouter.get("/rollingfutures-lt-dual/open-positions", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getRollingFuturesLtDualOpenPositions(req, res);
    });
    objRouter.post("/rollingfutures-lt-dual/open-positions", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await saveRollingFuturesLtDualOpenPositions(req, res);
    });
    objRouter.post("/rollingfutures-lt-dual/open-positions/delete", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await deleteRollingFuturesLtDualOpenPosition(req, res);
    });
    objRouter.post("/rollingfutures-lt-dual/open-positions/reconcile", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await reconcileRollingFuturesLtDualOpenPositions(req, res);
    });
    objRouter.post("/rollingfutures-lt-dual/open-positions/close", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await closeRollingFuturesLtDualImportedOpenPosition(req, res);
    });
    objRouter.post("/rollingfutures-lt-dual/kill-switch", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await executeRollingFuturesLtDualKillSwitch(req, res);
    });
    objRouter.post("/rollingfutures-lt-dual/metrics/update", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await updateRollingFuturesLtDualRecoveryMetrics(req, res);
    });
    objRouter.post("/rollingfutures-lt-dual/metrics/recalculate-total-pnl", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await recalculateRollingFuturesLtDualRecoveryTotalPnl(req, res);
    });
    objRouter.get("/rollingfutures-lt-dual/closed-positions", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getRollingFuturesLtDualClosedPositions(req, res);
    });
    objRouter.get("/rollingfutures-lt-dual/events", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getRollingFuturesLtDualEvents(req, res);
    });
    objRouter.post("/rollingfutures-lt-dual/events/delete", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await deleteRollingFuturesLtDualEventController(req, res);
    });
    objRouter.post("/rollingfutures-lt-dual/events/clear", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await clearRollingFuturesLtDualEventsController(req, res);
    });

    objRouter.get("/covered-options/profile", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getCoveredOptionsProfile(req, res);
    });
    objRouter.post("/covered-options/profile", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await saveCoveredOptionsProfile(req, res);
    });
    objRouter.get("/covered-options/connection/status", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getCoveredOptionsConnectionStatus(req, res);
    });
    objRouter.get("/covered-options/runtime", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getCoveredOptionsRuntimeStatus(req, res);
    });
    objRouter.post("/covered-options/connection/check", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await checkCoveredOptionsConnection(req, res);
    });
    objRouter.post("/covered-options/auto-trader/start", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await enableCoveredOptionsAutoTrader(req, res);
    });
    objRouter.post("/covered-options/auto-trader/stop", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await disableCoveredOptionsAutoTrader(req, res);
    });
    objRouter.get("/covered-options/account-summary", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getCoveredOptionsAccountSummary(req, res);
    });
    objRouter.post("/covered-options/start-qty/calculate", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await calculateCoveredOptionsRecommendedStartQty(req, res);
    });
    objRouter.post("/covered-options/manual/future", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await executeCoveredOptionsManualFuture(req, res);
    });
    objRouter.post("/covered-options/manual/option", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await executeCoveredOptionsManualOption(req, res);
    });
    objRouter.post("/covered-options/strategy/execute", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await executeCoveredOptionsStrategy(req, res);
    });
    objRouter.post("/covered-options/live-action/confirm", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await confirmCoveredOptionsLiveAction(req, res);
    });
    objRouter.post("/covered-options/live-action/reject", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await rejectCoveredOptionsLiveAction(req, res);
    });
    objRouter.get("/covered-options/open-positions/importable", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getCoveredOptionsImportableOpenPositions(req, res);
    });
    objRouter.get("/covered-options/open-positions", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getCoveredOptionsOpenPositions(req, res);
    });
    objRouter.post("/covered-options/open-positions", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await saveCoveredOptionsOpenPositions(req, res);
    });
    objRouter.post("/covered-options/open-positions/delete", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await deleteCoveredOptionsOpenPosition(req, res);
    });
    objRouter.post("/covered-options/open-positions/clear", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await clearCoveredOptionsOpenPositions(req, res);
    });
    objRouter.post("/covered-options/open-positions/reconcile", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await reconcileCoveredOptionsOpenPositions(req, res);
    });
    objRouter.post("/covered-options/open-positions/close", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await closeCoveredOptionsImportedOpenPosition(req, res);
    });
    objRouter.post("/covered-options/open-positions/swap", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await swapCoveredOptionsImportedOpenPosition(req, res);
    });
    objRouter.post("/covered-options/kill-switch", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await executeCoveredOptionsKillSwitch(req, res);
    });
    objRouter.post("/covered-options/metrics/update", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await updateCoveredOptionsRecoveryMetrics(req, res);
    });
    objRouter.post("/covered-options/metrics/recalculate-total-pnl", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await recalculateCoveredOptionsRecoveryTotalPnl(req, res);
    });
    objRouter.get("/covered-options/closed-positions", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getCoveredOptionsClosedPositions(req, res);
    });
    objRouter.get("/covered-options/events", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getCoveredOptionsEvents(req, res);
    });
    objRouter.post("/covered-options/events/delete", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await deleteCoveredOptionsEventController(req, res);
    });
    objRouter.post("/covered-options/events/clear", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await clearCoveredOptionsEventsController(req, res);
    });

    return objRouter;
}
