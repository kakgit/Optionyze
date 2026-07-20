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
    calculateRenkoOptionsRecommendedStartQty,
    calculateStrangleOptionsRecommendedStartQty,
    calculateOptionsScalperRecommendedStartQty,
    checkRollingFuturesLtDualConnection,
    checkCoveredOptionsConnection,
    checkRenkoOptionsConnection,
    checkStrangleOptionsConnection,
    checkOptionsScalperConnection,
    calculateRollingFuturesLtDualRecommendedStartQty,
    clearCoveredOptionsEventsController,
    clearRenkoOptionsEventsController,
    clearStrangleOptionsEventsController,
    clearOptionsScalperEventsController,
    clearOptionsScalperClosedPositions,
    deleteOptionsScalperClosedPosition,
    clearRollingFuturesLtDualEventsController,
    closeCoveredOptionsImportedOpenPosition,
    closeRenkoOptionsImportedOpenPosition,
    closeStrangleOptionsImportedOpenPosition,
    closeOptionsScalperImportedOpenPosition,
    deleteRollingFuturesLtDualEventController,
    deleteCoveredOptionsEventController,
    deleteRenkoOptionsEventController,
    deleteStrangleOptionsEventController,
    deleteOptionsScalperEventController,
    closeRollingFuturesLtDualImportedOpenPosition,
    deleteCoveredOptionsOpenPosition,
    deleteRenkoOptionsOpenPosition,
    deleteStrangleOptionsOpenPosition,
    deleteOptionsScalperOpenPosition,
    deleteRollingFuturesLtDualOpenPosition,
    disableCoveredOptionsAutoTrader,
    disableRenkoOptionsAutoTrader,
    disableStrangleOptionsAutoTrader,
    disableOptionsScalperAutoTrader,
    disableRollingFuturesLtDualAutoTrader,
    enableCoveredOptionsAutoTrader,
    enableRenkoOptionsAutoTrader,
    enableStrangleOptionsAutoTrader,
    enableOptionsScalperAutoTrader,
    enableRollingFuturesLtDualAutoTrader,
    executeCoveredOptionsKillSwitch,
    executeRenkoOptionsKillSwitch,
    executeStrangleOptionsKillSwitch,
    confirmCoveredOptionsLiveAction,
    confirmRenkoOptionsLiveAction,
    confirmStrangleOptionsLiveAction,
    executeCoveredOptionsManualFuture,
    executeCoveredOptionsManualOption,
    executeCoveredOptionsStrategy,
    executeRenkoOptionsManualFuture,
    executeRenkoOptionsManualOption,
    executeRenkoOptionsStrategy,
    executeStrangleOptionsManualFuture,
    executeStrangleOptionsManualOption,
    executeStrangleOptionsStrategy,
    executeOptionsScalperKillSwitch,
    confirmOptionsScalperLiveAction,
    executeOptionsScalperManualFuture,
    executeOptionsScalperManualOption,
    executeOptionsScalperStrategy,
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
    getRenkoOptionsAccountSummary,
    getRenkoOptionsClosedPositions,
    getRenkoOptionsConnectionStatus,
    getRenkoOptionsEvents,
    getRenkoOptionsImportableOpenPositions,
    getRenkoOptionsOpenPositions,
    getRenkoOptionsProfile,
    getRenkoOptionsRuntimeStatus,
    getStrangleOptionsAccountSummary,
    getStrangleOptionsClosedPositions,
    getStrangleOptionsConnectionStatus,
    getStrangleOptionsEvents,
    getStrangleOptionsImportableOpenPositions,
    getStrangleOptionsOpenPositions,
    getStrangleOptionsProfile,
    getStrangleOptionsRuntimeStatus,
    getOptionsScalperAccountSummary,
    getOptionsScalperIndicator,
    getOptionsScalperClosedPositions,
    getOptionsScalperConnectionStatus,
    getOptionsScalperEvents,
    getOptionsScalperImportableOpenPositions,
    getOptionsScalperOpenPositions,
    getOptionsScalperProfile,
    getOptionsScalperRuntimeStatus,
    setOptionsScalperRenkoManualSignal,
    listCoveredOptionsVerifierRunningUsers,
    listRenkoOptionsVerifierRunningUsers,
    listStrangleOptionsVerifierRunningUsers,
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
    recalculateRenkoOptionsRecoveryTotalPnl,
    recalculateStrangleOptionsRecoveryTotalPnl,
    recalculateOptionsScalperRecoveryTotalPnl,
    recalculateRollingFuturesLtDualRecoveryTotalPnl,
    updateCoveredOptionsRecoveryMetrics,
    updateRenkoOptionsRecoveryMetrics,
    updateStrangleOptionsRecoveryMetrics,
    updateOptionsScalperRecoveryMetrics,
    updateRollingFuturesLtDualRecoveryMetrics,
    reconcileCoveredOptionsOpenPositions,
    rejectCoveredOptionsLiveAction,
    rejectRenkoOptionsLiveAction,
    rejectStrangleOptionsLiveAction,
    reconcileRenkoOptionsOpenPositions,
    reconcileStrangleOptionsOpenPositions,
    rejectOptionsScalperLiveAction,
    reconcileOptionsScalperOpenPositions,
    reconcileRollingFuturesLtDualOpenPositions,
    saveCoveredOptionsOpenPositions,
    saveCoveredOptionsProfile,
    saveRenkoOptionsOpenPositions,
    saveRenkoOptionsProfile,
    saveStrangleOptionsOpenPositions,
    saveStrangleOptionsProfile,
    saveOptionsScalperOpenPositions,
    saveOptionsScalperProfile,
    saveRollingFuturesLtDualOpenPositions,
    saveRollingFuturesLtDualProfile,
    clearCoveredOptionsOpenPositions,
    clearRenkoOptionsOpenPositions,
    clearStrangleOptionsOpenPositions,
    clearOptionsScalperOpenPositions,
    listAdminPendingCoveredLikeLiveActions,
    confirmAdminPendingCoveredLikeLiveAction,
    rejectAdminPendingCoveredLikeLiveAction,
    swapCoveredOptionsImportedOpenPosition,
    swapRenkoOptionsImportedOpenPosition,
    swapStrangleOptionsImportedOpenPosition,
    handleTelegramWebhook
} from "../controllers/rolling-futures-lt-controller";
import {
    createDeltaApiProfileController,
    deleteDeltaApiProfileController,
    listDeltaApiProfilesController,
    testDeltaApiProfileLoginController,
    updateDeltaApiProfileController
} from "../controllers/delta-api-controller";
import { getMyProfileApi } from "../controllers/account-controller";
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
    objRouter.get("/admin/live-actions/pending", requireAdminApi, async (req, res) => {
        await listAdminPendingCoveredLikeLiveActions(req, res);
    });
    objRouter.post("/admin/live-actions/confirm", requireAdminApi, async (req, res) => {
        await confirmAdminPendingCoveredLikeLiveAction(req, res);
    });
    objRouter.post("/admin/live-actions/reject", requireAdminApi, async (req, res) => {
        await rejectAdminPendingCoveredLikeLiveAction(req, res);
    });

    objRouter.post("/account/mobile-push-tokens", requireAuthApi, async (req, res) => {
        await registerMobilePushTokenController(req, res);
    });

    objRouter.get("/account/profile", requireAuthApi, async (req, res) => {
        getMyProfileApi(req, res);
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

    objRouter.get("/covered-options/admin/running-users", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await listCoveredOptionsVerifierRunningUsers(req, res);
    });
    objRouter.get("/strangle-options/admin/running-users", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await listStrangleOptionsVerifierRunningUsers(req, res);
    });
    objRouter.get("/renko-options/admin/running-users", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await listRenkoOptionsVerifierRunningUsers(req, res);
    });
    objRouter.get("/survival-admin/running-users", requireSurvivalAdminApi, async (req, res) => {
        await listSurvivalAdminRunningUsers(req, res);
    });
    objRouter.post("/survival-admin/running-users/:accountId/switch-primary", requireSurvivalAdminApi, async (req, res) => {
        await switchRollingFuturesLtDualBackToPrimaryController(req, res);
    });
    objRouter.post("/survival-admin/running-users/:accountId/force-takeover-here", requireSurvivalAdminApi, async (req, res) => {
        await forceRollingFuturesLtDualTakeoverHereController(req, res);
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

    objRouter.get("/strangle-options/profile", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getStrangleOptionsProfile(req, res);
    });
    objRouter.post("/strangle-options/profile", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await saveStrangleOptionsProfile(req, res);
    });
    objRouter.get("/strangle-options/connection/status", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getStrangleOptionsConnectionStatus(req, res);
    });
    objRouter.get("/strangle-options/runtime", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getStrangleOptionsRuntimeStatus(req, res);
    });
    objRouter.post("/strangle-options/connection/check", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await checkStrangleOptionsConnection(req, res);
    });
    objRouter.post("/strangle-options/auto-trader/start", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await enableStrangleOptionsAutoTrader(req, res);
    });
    objRouter.post("/strangle-options/auto-trader/stop", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await disableStrangleOptionsAutoTrader(req, res);
    });
    objRouter.get("/strangle-options/account-summary", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getStrangleOptionsAccountSummary(req, res);
    });
    objRouter.post("/strangle-options/start-qty/calculate", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await calculateStrangleOptionsRecommendedStartQty(req, res);
    });
    objRouter.post("/strangle-options/manual/future", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await executeStrangleOptionsManualFuture(req, res);
    });
    objRouter.post("/strangle-options/manual/option", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await executeStrangleOptionsManualOption(req, res);
    });
    objRouter.post("/strangle-options/strategy/execute", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await executeStrangleOptionsStrategy(req, res);
    });
    objRouter.post("/strangle-options/live-action/confirm", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await confirmStrangleOptionsLiveAction(req, res);
    });
    objRouter.post("/strangle-options/live-action/reject", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await rejectStrangleOptionsLiveAction(req, res);
    });
    objRouter.get("/strangle-options/open-positions/importable", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getStrangleOptionsImportableOpenPositions(req, res);
    });
    objRouter.get("/strangle-options/open-positions", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getStrangleOptionsOpenPositions(req, res);
    });
    objRouter.post("/strangle-options/open-positions", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await saveStrangleOptionsOpenPositions(req, res);
    });
    objRouter.post("/strangle-options/open-positions/delete", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await deleteStrangleOptionsOpenPosition(req, res);
    });
    objRouter.post("/strangle-options/open-positions/clear", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await clearStrangleOptionsOpenPositions(req, res);
    });
    objRouter.post("/strangle-options/open-positions/reconcile", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await reconcileStrangleOptionsOpenPositions(req, res);
    });
    objRouter.post("/strangle-options/open-positions/close", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await closeStrangleOptionsImportedOpenPosition(req, res);
    });
    objRouter.post("/strangle-options/open-positions/swap", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await swapStrangleOptionsImportedOpenPosition(req, res);
    });
    objRouter.post("/strangle-options/kill-switch", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await executeStrangleOptionsKillSwitch(req, res);
    });
    objRouter.post("/strangle-options/metrics/update", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await updateStrangleOptionsRecoveryMetrics(req, res);
    });
    objRouter.post("/strangle-options/metrics/recalculate-total-pnl", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await recalculateStrangleOptionsRecoveryTotalPnl(req, res);
    });
    objRouter.get("/strangle-options/closed-positions", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getStrangleOptionsClosedPositions(req, res);
    });
    objRouter.get("/strangle-options/events", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getStrangleOptionsEvents(req, res);
    });
    objRouter.post("/strangle-options/events/delete", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await deleteStrangleOptionsEventController(req, res);
    });
    objRouter.post("/strangle-options/events/clear", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await clearStrangleOptionsEventsController(req, res);
    });

    objRouter.get("/renko-options/profile", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getRenkoOptionsProfile(req, res);
    });
    objRouter.post("/renko-options/profile", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await saveRenkoOptionsProfile(req, res);
    });
    objRouter.get("/renko-options/connection/status", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getRenkoOptionsConnectionStatus(req, res);
    });
    objRouter.get("/renko-options/runtime", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getRenkoOptionsRuntimeStatus(req, res);
    });
    objRouter.post("/renko-options/connection/check", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await checkRenkoOptionsConnection(req, res);
    });
    objRouter.post("/renko-options/auto-trader/start", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await enableRenkoOptionsAutoTrader(req, res);
    });
    objRouter.post("/renko-options/auto-trader/stop", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await disableRenkoOptionsAutoTrader(req, res);
    });
    objRouter.get("/renko-options/account-summary", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getRenkoOptionsAccountSummary(req, res);
    });
    objRouter.post("/renko-options/start-qty/calculate", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await calculateRenkoOptionsRecommendedStartQty(req, res);
    });
    objRouter.post("/renko-options/manual/future", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await executeRenkoOptionsManualFuture(req, res);
    });
    objRouter.post("/renko-options/manual/option", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await executeRenkoOptionsManualOption(req, res);
    });
    objRouter.post("/renko-options/strategy/execute", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await executeRenkoOptionsStrategy(req, res);
    });
    objRouter.post("/renko-options/live-action/confirm", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await confirmRenkoOptionsLiveAction(req, res);
    });
    objRouter.post("/renko-options/live-action/reject", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await rejectRenkoOptionsLiveAction(req, res);
    });
    objRouter.get("/renko-options/open-positions/importable", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getRenkoOptionsImportableOpenPositions(req, res);
    });
    objRouter.get("/renko-options/open-positions", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getRenkoOptionsOpenPositions(req, res);
    });
    objRouter.post("/renko-options/open-positions", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await saveRenkoOptionsOpenPositions(req, res);
    });
    objRouter.post("/renko-options/open-positions/delete", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await deleteRenkoOptionsOpenPosition(req, res);
    });
    objRouter.post("/renko-options/open-positions/clear", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await clearRenkoOptionsOpenPositions(req, res);
    });
    objRouter.post("/renko-options/open-positions/reconcile", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await reconcileRenkoOptionsOpenPositions(req, res);
    });
    objRouter.post("/renko-options/open-positions/close", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await closeRenkoOptionsImportedOpenPosition(req, res);
    });
    objRouter.post("/renko-options/open-positions/swap", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await swapRenkoOptionsImportedOpenPosition(req, res);
    });
    objRouter.post("/renko-options/kill-switch", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await executeRenkoOptionsKillSwitch(req, res);
    });
    objRouter.post("/renko-options/metrics/update", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await updateRenkoOptionsRecoveryMetrics(req, res);
    });
    objRouter.post("/renko-options/metrics/recalculate-total-pnl", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await recalculateRenkoOptionsRecoveryTotalPnl(req, res);
    });
    objRouter.get("/renko-options/closed-positions", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getRenkoOptionsClosedPositions(req, res);
    });
    objRouter.get("/renko-options/events", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getRenkoOptionsEvents(req, res);
    });
    objRouter.post("/renko-options/events/delete", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await deleteRenkoOptionsEventController(req, res);
    });
    objRouter.post("/renko-options/events/clear", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await clearRenkoOptionsEventsController(req, res);
    });

    objRouter.get("/options-demo/profile", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getOptionsScalperProfile(req, res);
    });
    objRouter.post("/options-demo/profile", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await saveOptionsScalperProfile(req, res);
    });
    objRouter.get("/options-demo/connection/status", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getOptionsScalperConnectionStatus(req, res);
    });
    objRouter.get("/options-demo/runtime", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getOptionsScalperRuntimeStatus(req, res);
    });
    objRouter.post("/options-demo/connection/check", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await checkOptionsScalperConnection(req, res);
    });
    objRouter.post("/options-demo/auto-trader/start", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await enableOptionsScalperAutoTrader(req, res);
    });
    objRouter.post("/options-demo/auto-trader/stop", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await disableOptionsScalperAutoTrader(req, res);
    });
    objRouter.get("/options-demo/account-summary", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getOptionsScalperAccountSummary(req, res);
    });
    objRouter.get("/options-demo/indicator", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getOptionsScalperIndicator(req, res);
    });
    objRouter.post("/options-demo/renko/manual-signal", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await setOptionsScalperRenkoManualSignal(req, res);
    });
    objRouter.post("/options-demo/start-qty/calculate", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await calculateOptionsScalperRecommendedStartQty(req, res);
    });
    objRouter.post("/options-demo/manual/future", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await executeOptionsScalperManualFuture(req, res);
    });
    objRouter.post("/options-demo/manual/option", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await executeOptionsScalperManualOption(req, res);
    });
    objRouter.post("/options-demo/strategy/execute", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await executeOptionsScalperStrategy(req, res);
    });
    objRouter.post("/options-demo/live-action/confirm", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await confirmOptionsScalperLiveAction(req, res);
    });
    objRouter.post("/options-demo/live-action/reject", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await rejectOptionsScalperLiveAction(req, res);
    });
    objRouter.get("/options-demo/open-positions/importable", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getOptionsScalperImportableOpenPositions(req, res);
    });
    objRouter.get("/options-demo/open-positions", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getOptionsScalperOpenPositions(req, res);
    });
    objRouter.post("/options-demo/open-positions", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await saveOptionsScalperOpenPositions(req, res);
    });
    objRouter.post("/options-demo/open-positions/delete", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await deleteOptionsScalperOpenPosition(req, res);
    });
    objRouter.post("/options-demo/open-positions/clear", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await clearOptionsScalperOpenPositions(req, res);
    });
    objRouter.post("/options-demo/open-positions/reconcile", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await reconcileOptionsScalperOpenPositions(req, res);
    });
    objRouter.post("/options-demo/open-positions/close", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await closeOptionsScalperImportedOpenPosition(req, res);
    });
    objRouter.post("/options-demo/kill-switch", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await executeOptionsScalperKillSwitch(req, res);
    });
    objRouter.post("/options-demo/metrics/update", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await updateOptionsScalperRecoveryMetrics(req, res);
    });
    objRouter.post("/options-demo/metrics/recalculate-total-pnl", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await recalculateOptionsScalperRecoveryTotalPnl(req, res);
    });
    objRouter.get("/options-demo/closed-positions", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getOptionsScalperClosedPositions(req, res);
    });
    objRouter.post("/options-demo/closed-positions/clear", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await clearOptionsScalperClosedPositions(req, res);
    });
    objRouter.post("/options-demo/closed-positions/delete", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await deleteOptionsScalperClosedPosition(req, res);
    });
    objRouter.get("/options-demo/events", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getOptionsScalperEvents(req, res);
    });
    objRouter.post("/options-demo/events/delete", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await deleteOptionsScalperEventController(req, res);
    });
    objRouter.post("/options-demo/events/clear", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await clearOptionsScalperEventsController(req, res);
    });

    return objRouter;
}
