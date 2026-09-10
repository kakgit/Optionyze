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
    getArbitrageCompareCalls,
    getArbitrageComparePuts,
    getArbitrageExpiries,
    getArbitrageInstruments,
    getArbitragePutChain
} from "../controllers/arbitrage-controller";
import {
    getBybitArbitrageExpiries,
    getBybitArbitrageInstruments,
    getBybitCompareCalls,
    getBybitComparePuts
} from "../controllers/bybit-arbitrage-controller";
import {
    getCoinSwitchArbitrageExpiries,
    getCoinSwitchArbitrageInstruments,
    getCoinSwitchCompareCalls,
    getCoinSwitchComparePuts,
    getCoinSwitchLiveQuotes,
    placeCoinSwitchDualOrders,
    listCoinSwitchOpenPositions,
    deleteCoinSwitchOpenPosition
} from "../controllers/coinswitch-arbitrage-controller";
import {
    deleteImportedPositionController,
    getWalletBalancesController,
    importExchangePositionsController,
    listExchangePositionsController,
    listImportedPositionsController
} from "../controllers/cs-delta-position-import-controller";
import {
    calculateRenkoOptionsRecommendedStartQty,
    calculateStrangleOptionsRecommendedStartQty,
    calculateOptionsScalperRecommendedStartQty,
    calculateStrangleDemoRecommendedStartQty,
    calculateStraddleDemoRecommendedStartQty,
    checkRollingFuturesLtDualConnection,
    checkCoveredOptionsConnection,
    checkRenkoOptionsConnection,
    checkStrangleOptionsConnection,
    checkOptionsScalperConnection,
    checkStrangleDemoConnection,
    checkStraddleDemoConnection,
    calculateRollingFuturesLtDualRecommendedStartQty,
    clearCoveredOptionsEventsController,
    clearRenkoOptionsEventsController,
    clearStrangleOptionsEventsController,
    clearOptionsScalperEventsController,
    clearStrangleDemoEventsController,
    clearStraddleDemoEventsController,
    clearOptionsScalperClosedPositions,
    clearStrangleDemoClosedPositions,
    clearStraddleDemoClosedPositions,
    deleteOptionsScalperClosedPosition,
    deleteStrangleDemoClosedPosition,
    deleteStraddleDemoClosedPosition,
    updateOptionsScalperClosedPosition,
    updateStrangleDemoClosedPosition,
    updateStraddleDemoClosedPosition,
    clearRollingFuturesLtDualEventsController,
    closeCoveredOptionsImportedOpenPosition,
    closeRenkoOptionsImportedOpenPosition,
    closeStrangleOptionsImportedOpenPosition,
    closeOptionsScalperImportedOpenPosition,
    closeStrangleDemoImportedOpenPosition,
    closeStraddleDemoImportedOpenPosition,
    deleteRollingFuturesLtDualEventController,
    deleteCoveredOptionsEventController,
    deleteRenkoOptionsEventController,
    deleteStrangleOptionsEventController,
    deleteOptionsScalperEventController,
    deleteStrangleDemoEventController,
    deleteStraddleDemoEventController,
    closeRollingFuturesLtDualImportedOpenPosition,
    deleteCoveredOptionsOpenPosition,
    deleteRenkoOptionsOpenPosition,
    deleteStrangleOptionsOpenPosition,
    deleteOptionsScalperOpenPosition,
    deleteStrangleDemoOpenPosition,
    deleteStraddleDemoOpenPosition,
    deleteRollingFuturesLtDualOpenPosition,
    disableCoveredOptionsAutoTrader,
    disableRenkoOptionsAutoTrader,
    disableStrangleOptionsAutoTrader,
    disableOptionsScalperAutoTrader,
    disableStrangleDemoAutoTrader,
    disableStraddleDemoAutoTrader,
    disableRollingFuturesLtDualAutoTrader,
    enableCoveredOptionsAutoTrader,
    enableRenkoOptionsAutoTrader,
    enableStrangleOptionsAutoTrader,
    enableOptionsScalperAutoTrader,
    enableStrangleDemoAutoTrader,
    enableStraddleDemoAutoTrader,
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
    setCoveredOptionsRenkoManualSignal,
    executeRenkoOptionsManualFuture,
    executeRenkoOptionsManualOption,
    executeRenkoOptionsStrategy,
    executeStrangleOptionsManualFuture,
    executeStrangleOptionsManualOption,
    executeStrangleOptionsStrategy,
    executeOptionsScalperKillSwitch,
    executeStrangleDemoKillSwitch,
    executeStraddleDemoKillSwitch,
    confirmOptionsScalperLiveAction,
    confirmStrangleDemoLiveAction,
    confirmStraddleDemoLiveAction,
    executeOptionsScalperManualFuture,
    executeOptionsScalperManualOption,
    executeOptionsScalperStrategy,
    executeStrangleDemoManualFuture,
    executeStrangleDemoManualOption,
    executeStrangleDemoStrategy,
    executeStraddleDemoManualFuture,
    executeStraddleDemoManualOption,
    executeStraddleDemoStrategy,
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
    getStrangleDemoAccountSummary,
    getStraddleDemoAccountSummary,
    getOptionsScalperIndicator,
    getOptionsScalperClosedPositions,
    getStrangleDemoClosedPositions,
    getStraddleDemoClosedPositions,
    getOptionsScalperConnectionStatus,
    getStrangleDemoConnectionStatus,
    getStraddleDemoConnectionStatus,
    getOptionsScalperEvents,
    getStrangleDemoEvents,
    getStraddleDemoEvents,
    getOptionsScalperImportableOpenPositions,
    getStrangleDemoImportableOpenPositions,
    getStraddleDemoImportableOpenPositions,
    getOptionsScalperOpenPositions,
    getStrangleDemoOpenPositions,
    getStraddleDemoOpenPositions,
    getOptionsScalperProfile,
    getStrangleDemoProfile,
    getStraddleDemoProfile,
    getOptionsScalperRuntimeStatus,
    getStrangleDemoRuntimeStatus,
    getStraddleDemoRuntimeStatus,
    getOptionsScalperRsiStatus,
    setOptionsScalperRenkoManualSignal,
    executeFuturesScalperManualFuture,
    getFuturesScalperAccountSummary,
    getFuturesScalperClosedPositions,
    getFuturesScalperConnectionStatus,
    getFuturesScalperEvents,
    getFuturesScalperImportableOpenPositions,
    getFuturesScalperIndicator,
    getFuturesScalperOpenPositions,
    getFuturesScalperProfile,
    getFuturesScalperRuntimeStatus,
    setFuturesScalperRenkoManualSignal,
    checkFuturesScalperConnection,
    enableFuturesScalperAutoTrader,
    disableFuturesScalperAutoTrader,
    executeFuturesScalperKillSwitch,
    calculateFuturesScalperRecommendedStartQty,
    clearFuturesScalperOpenPositions,
    clearFuturesScalperClosedPositions,
    deleteFuturesScalperOpenPosition,
    deleteFuturesScalperClosedPosition,
    reconcileFuturesScalperOpenPositions,
    closeFuturesScalperImportedOpenPosition,
    updateFuturesScalperClosedPosition,
    saveFuturesScalperOpenPositions,
    saveFuturesScalperProfile,
    updateFuturesScalperRecoveryMetrics,
    recalculateFuturesScalperRecoveryTotalPnl,
    clearFuturesScalperEventsController,
    deleteFuturesScalperEventController,
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
    recalculateStrangleDemoRecoveryTotalPnl,
    recalculateStraddleDemoRecoveryTotalPnl,
    recalculateRollingFuturesLtDualRecoveryTotalPnl,
    updateCoveredOptionsRecoveryMetrics,
    updateRenkoOptionsRecoveryMetrics,
    updateStrangleOptionsRecoveryMetrics,
    updateOptionsScalperRecoveryMetrics,
    updateStrangleDemoRecoveryMetrics,
    updateStraddleDemoRecoveryMetrics,
    updateRollingFuturesLtDualRecoveryMetrics,
    reconcileCoveredOptionsOpenPositions,
    rejectCoveredOptionsLiveAction,
    rejectRenkoOptionsLiveAction,
    rejectStrangleOptionsLiveAction,
    reconcileRenkoOptionsOpenPositions,
    reconcileStrangleOptionsOpenPositions,
    rejectOptionsScalperLiveAction,
    rejectStrangleDemoLiveAction,
    rejectStraddleDemoLiveAction,
    reconcileOptionsScalperOpenPositions,
    reconcileStrangleDemoOpenPositions,
    reconcileStraddleDemoOpenPositions,
    reconcileRollingFuturesLtDualOpenPositions,
    saveCoveredOptionsOpenPositions,
    saveCoveredOptionsProfile,
    saveRenkoOptionsOpenPositions,
    saveRenkoOptionsProfile,
    saveStrangleOptionsOpenPositions,
    saveStrangleOptionsProfile,
    saveOptionsScalperOpenPositions,
    saveOptionsScalperProfile,
    saveStrangleDemoOpenPositions,
    saveStraddleDemoOpenPositions,
    saveStrangleDemoProfile,
    saveStraddleDemoProfile,
    saveRollingFuturesLtDualOpenPositions,
    saveRollingFuturesLtDualProfile,
    clearCoveredOptionsOpenPositions,
    clearRenkoOptionsOpenPositions,
    clearStrangleOptionsOpenPositions,
    clearOptionsScalperOpenPositions,
    clearStrangleDemoOpenPositions,
    clearStraddleDemoOpenPositions,
    listAdminPendingCoveredLikeLiveActions,
    confirmAdminPendingCoveredLikeLiveAction,
    rejectAdminPendingCoveredLikeLiveAction,
    swapCoveredOptionsImportedOpenPosition,
    swapRenkoOptionsImportedOpenPosition,
    swapStrangleOptionsImportedOpenPosition,
    handleTelegramWebhook,
    handleOptionsDemoTradeWebhook,
    handleCoveredOptionsTradeWebhook
} from "../controllers/rolling-futures-lt-controller";
import {
    createDeltaApiProfileController,
    deleteDeltaApiProfileController,
    listDeltaApiProfilesController,
    testDeltaApiProfileLoginController,
    updateDeltaApiProfileController
} from "../controllers/delta-api-controller";
import {
    createCsDeltaApiProfileController,
    deleteCsDeltaApiProfileController,
    listCsDeltaApiProfilesController,
    updateCsDeltaApiProfileController
} from "../controllers/cs-delta-api-controller";
import { getMyProfileApi } from "../controllers/account-controller";
import { registerMobilePushTokenController } from "../controllers/mobile-push-controller";
import type { RunnerManager } from "../../runners/runner-manager";
import { requireAdminApi, requireAuthApi, requireFreshPasswordApi, requireSurvivalAdminApi } from "../middleware/auth-middleware";

export function createApiRouter(pRunnerManager: RunnerManager): Router {
    const objRouter = Router();

    objRouter.get("/health", getHealth);
    objRouter.get("/arbitrage/instruments", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getArbitrageInstruments(req, res);
    });
    objRouter.get("/arbitrage/expiries", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getArbitrageExpiries(req, res);
    });
    objRouter.get("/arbitrage/put-chain", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getArbitragePutChain(req, res);
    });
    objRouter.get("/arbitrage/compare-puts", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getArbitrageComparePuts(req, res);
    });
    objRouter.get("/arbitrage/compare-calls", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getArbitrageCompareCalls(req, res);
    });
    objRouter.get("/bybit-delta/instruments", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getBybitArbitrageInstruments(req, res);
    });
    objRouter.get("/bybit-delta/expiries", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getBybitArbitrageExpiries(req, res);
    });
    objRouter.get("/bybit-delta/compare-puts", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getBybitComparePuts(req, res);
    });
    objRouter.get("/bybit-delta/compare-calls", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getBybitCompareCalls(req, res);
    });
    objRouter.get("/arbitrage/coinswitch/instruments", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getCoinSwitchArbitrageInstruments(req, res);
    });
    objRouter.get("/arbitrage/coinswitch/expiries", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getCoinSwitchArbitrageExpiries(req, res);
    });
    objRouter.get("/arbitrage/coinswitch/compare-puts", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getCoinSwitchComparePuts(req, res);
    });
    objRouter.get("/arbitrage/coinswitch/compare-calls", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getCoinSwitchCompareCalls(req, res);
    });
    objRouter.get("/arbitrage/coinswitch/live-quotes", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getCoinSwitchLiveQuotes(req, res);
    });
    objRouter.post("/arbitrage/coinswitch/place-dual-orders", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await placeCoinSwitchDualOrders(req, res);
    });
    objRouter.get("/arbitrage/coinswitch/open-positions", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await listCoinSwitchOpenPositions(req, res);
    });
    objRouter.delete("/arbitrage/coinswitch/open-positions/:positionId", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await deleteCoinSwitchOpenPosition(req, res);
    });
    objRouter.get("/arbitrage/coinswitch/exchange-positions", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await listExchangePositionsController(req, res);
    });
    objRouter.post("/arbitrage/coinswitch/import-positions", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await importExchangePositionsController(req, res);
    });
    objRouter.get("/arbitrage/coinswitch/imported-positions", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await listImportedPositionsController(req, res);
    });
    objRouter.delete("/arbitrage/coinswitch/imported-positions/:importId", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await deleteImportedPositionController(req, res);
    });
    objRouter.get("/arbitrage/coinswitch/wallet-balances", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getWalletBalancesController(req, res);
    });
    objRouter.post("/telegram/webhook", async (req, res) => {
        await handleTelegramWebhook(req, res);
    });
    objRouter.post("/options-demo/webhook", async (req, res) => {
        await handleOptionsDemoTradeWebhook(req, res);
    });
    objRouter.post("/covered-options/webhook", async (req, res) => {
        await handleCoveredOptionsTradeWebhook(req, res);
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

    objRouter.get("/account/cs-delta-api-profiles", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await listCsDeltaApiProfilesController(req, res);
    });
    objRouter.post("/account/cs-delta-api-profiles", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await createCsDeltaApiProfileController(req, res);
    });
    objRouter.put("/account/cs-delta-api-profiles/:profileId", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await updateCsDeltaApiProfileController(req, res);
    });
    objRouter.delete("/account/cs-delta-api-profiles/:profileId", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await deleteCsDeltaApiProfileController(req, res);
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
    objRouter.post("/covered-options/renko/manual-signal", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await setCoveredOptionsRenkoManualSignal(req, res);
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
    objRouter.get("/options-demo/rsi", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getOptionsScalperRsiStatus(req, res);
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
    objRouter.post("/options-demo/closed-positions/update", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await updateOptionsScalperClosedPosition(req, res);
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

    objRouter.get("/futures-scalper/profile", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getFuturesScalperProfile(req, res);
    });
    objRouter.post("/futures-scalper/profile", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await saveFuturesScalperProfile(req, res);
    });
    objRouter.get("/futures-scalper/connection/status", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getFuturesScalperConnectionStatus(req, res);
    });
    objRouter.get("/futures-scalper/runtime", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getFuturesScalperRuntimeStatus(req, res);
    });
    objRouter.post("/futures-scalper/connection/check", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await checkFuturesScalperConnection(req, res);
    });
    objRouter.post("/futures-scalper/auto-trader/start", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await enableFuturesScalperAutoTrader(req, res);
    });
    objRouter.post("/futures-scalper/auto-trader/stop", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await disableFuturesScalperAutoTrader(req, res);
    });
    objRouter.get("/futures-scalper/account-summary", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getFuturesScalperAccountSummary(req, res);
    });
    objRouter.get("/futures-scalper/indicator", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getFuturesScalperIndicator(req, res);
    });
    objRouter.post("/futures-scalper/renko/manual-signal", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await setFuturesScalperRenkoManualSignal(req, res);
    });
    objRouter.post("/futures-scalper/start-qty/calculate", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await calculateFuturesScalperRecommendedStartQty(req, res);
    });
    objRouter.post("/futures-scalper/manual/future", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await executeFuturesScalperManualFuture(req, res);
    });
    objRouter.get("/futures-scalper/open-positions/importable", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getFuturesScalperImportableOpenPositions(req, res);
    });
    objRouter.get("/futures-scalper/open-positions", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getFuturesScalperOpenPositions(req, res);
    });
    objRouter.post("/futures-scalper/open-positions", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await saveFuturesScalperOpenPositions(req, res);
    });
    objRouter.post("/futures-scalper/open-positions/delete", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await deleteFuturesScalperOpenPosition(req, res);
    });
    objRouter.post("/futures-scalper/open-positions/clear", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await clearFuturesScalperOpenPositions(req, res);
    });
    objRouter.post("/futures-scalper/open-positions/reconcile", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await reconcileFuturesScalperOpenPositions(req, res);
    });
    objRouter.post("/futures-scalper/open-positions/close", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await closeFuturesScalperImportedOpenPosition(req, res);
    });
    objRouter.post("/futures-scalper/kill-switch", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await executeFuturesScalperKillSwitch(req, res);
    });
    objRouter.post("/futures-scalper/metrics/update", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await updateFuturesScalperRecoveryMetrics(req, res);
    });
    objRouter.post("/futures-scalper/metrics/recalculate-total-pnl", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await recalculateFuturesScalperRecoveryTotalPnl(req, res);
    });
    objRouter.get("/futures-scalper/closed-positions", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getFuturesScalperClosedPositions(req, res);
    });
    objRouter.post("/futures-scalper/closed-positions/clear", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await clearFuturesScalperClosedPositions(req, res);
    });
    objRouter.post("/futures-scalper/closed-positions/delete", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await deleteFuturesScalperClosedPosition(req, res);
    });
    objRouter.post("/futures-scalper/closed-positions/update", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await updateFuturesScalperClosedPosition(req, res);
    });
    objRouter.get("/futures-scalper/events", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getFuturesScalperEvents(req, res);
    });
    objRouter.post("/futures-scalper/events/delete", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await deleteFuturesScalperEventController(req, res);
    });
    objRouter.post("/futures-scalper/events/clear", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await clearFuturesScalperEventsController(req, res);
    });

    objRouter.get("/strangle-demo/profile", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getStrangleDemoProfile(req, res);
    });
    objRouter.post("/strangle-demo/profile", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await saveStrangleDemoProfile(req, res);
    });
    objRouter.get("/strangle-demo/connection/status", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getStrangleDemoConnectionStatus(req, res);
    });
    objRouter.get("/strangle-demo/runtime", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getStrangleDemoRuntimeStatus(req, res);
    });
    objRouter.post("/strangle-demo/connection/check", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await checkStrangleDemoConnection(req, res);
    });
    objRouter.post("/strangle-demo/auto-trader/start", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await enableStrangleDemoAutoTrader(req, res);
    });
    objRouter.post("/strangle-demo/auto-trader/stop", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await disableStrangleDemoAutoTrader(req, res);
    });
    objRouter.get("/strangle-demo/account-summary", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getStrangleDemoAccountSummary(req, res);
    });
    objRouter.post("/strangle-demo/start-qty/calculate", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await calculateStrangleDemoRecommendedStartQty(req, res);
    });
    objRouter.post("/strangle-demo/manual/future", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await executeStrangleDemoManualFuture(req, res);
    });
    objRouter.post("/strangle-demo/manual/option", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await executeStrangleDemoManualOption(req, res);
    });
    objRouter.post("/strangle-demo/strategy/execute", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await executeStrangleDemoStrategy(req, res);
    });
    objRouter.post("/strangle-demo/live-action/confirm", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await confirmStrangleDemoLiveAction(req, res);
    });
    objRouter.post("/strangle-demo/live-action/reject", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await rejectStrangleDemoLiveAction(req, res);
    });
    objRouter.get("/strangle-demo/open-positions/importable", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getStrangleDemoImportableOpenPositions(req, res);
    });
    objRouter.get("/strangle-demo/open-positions", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getStrangleDemoOpenPositions(req, res);
    });
    objRouter.post("/strangle-demo/open-positions", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await saveStrangleDemoOpenPositions(req, res);
    });
    objRouter.post("/strangle-demo/open-positions/delete", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await deleteStrangleDemoOpenPosition(req, res);
    });
    objRouter.post("/strangle-demo/open-positions/clear", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await clearStrangleDemoOpenPositions(req, res);
    });
    objRouter.post("/strangle-demo/open-positions/reconcile", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await reconcileStrangleDemoOpenPositions(req, res);
    });
    objRouter.post("/strangle-demo/open-positions/close", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await closeStrangleDemoImportedOpenPosition(req, res);
    });
    objRouter.post("/strangle-demo/kill-switch", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await executeStrangleDemoKillSwitch(req, res);
    });
    objRouter.post("/strangle-demo/metrics/update", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await updateStrangleDemoRecoveryMetrics(req, res);
    });
    objRouter.post("/strangle-demo/metrics/recalculate-total-pnl", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await recalculateStrangleDemoRecoveryTotalPnl(req, res);
    });
    objRouter.get("/strangle-demo/closed-positions", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getStrangleDemoClosedPositions(req, res);
    });
    objRouter.post("/strangle-demo/closed-positions/clear", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await clearStrangleDemoClosedPositions(req, res);
    });
    objRouter.post("/strangle-demo/closed-positions/delete", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await deleteStrangleDemoClosedPosition(req, res);
    });
    objRouter.post("/strangle-demo/closed-positions/update", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await updateStrangleDemoClosedPosition(req, res);
    });
    objRouter.get("/strangle-demo/events", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getStrangleDemoEvents(req, res);
    });
    objRouter.post("/strangle-demo/events/delete", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await deleteStrangleDemoEventController(req, res);
    });
    objRouter.post("/strangle-demo/events/clear", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await clearStrangleDemoEventsController(req, res);
    });

    // Straddle Demo routes (Delta Exchange only)
    objRouter.get("/straddle-demo/profile", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getStraddleDemoProfile(req, res);
    });
    objRouter.post("/straddle-demo/profile", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await saveStraddleDemoProfile(req, res);
    });
    objRouter.get("/straddle-demo/connection/status", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getStraddleDemoConnectionStatus(req, res);
    });
    objRouter.get("/straddle-demo/runtime", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getStraddleDemoRuntimeStatus(req, res);
    });
    objRouter.post("/straddle-demo/connection/check", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await checkStraddleDemoConnection(req, res);
    });
    objRouter.post("/straddle-demo/auto-trader/start", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await enableStraddleDemoAutoTrader(req, res);
    });
    objRouter.post("/straddle-demo/auto-trader/stop", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await disableStraddleDemoAutoTrader(req, res);
    });
    objRouter.get("/straddle-demo/account-summary", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getStraddleDemoAccountSummary(req, res);
    });
    objRouter.post("/straddle-demo/start-qty/calculate", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await calculateStraddleDemoRecommendedStartQty(req, res);
    });
    objRouter.post("/straddle-demo/manual/future", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await executeStraddleDemoManualFuture(req, res);
    });
    objRouter.post("/straddle-demo/manual/option", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await executeStraddleDemoManualOption(req, res);
    });
    objRouter.post("/straddle-demo/strategy/execute", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await executeStraddleDemoStrategy(req, res);
    });
    objRouter.post("/straddle-demo/live-action/confirm", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await confirmStraddleDemoLiveAction(req, res);
    });
    objRouter.post("/straddle-demo/live-action/reject", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await rejectStraddleDemoLiveAction(req, res);
    });
    objRouter.get("/straddle-demo/open-positions/importable", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getStraddleDemoImportableOpenPositions(req, res);
    });
    objRouter.get("/straddle-demo/open-positions", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getStraddleDemoOpenPositions(req, res);
    });
    objRouter.post("/straddle-demo/open-positions", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await saveStraddleDemoOpenPositions(req, res);
    });
    objRouter.post("/straddle-demo/open-positions/delete", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await deleteStraddleDemoOpenPosition(req, res);
    });
    objRouter.post("/straddle-demo/open-positions/clear", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await clearStraddleDemoOpenPositions(req, res);
    });
    objRouter.post("/straddle-demo/open-positions/reconcile", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await reconcileStraddleDemoOpenPositions(req, res);
    });
    objRouter.post("/straddle-demo/open-positions/close", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await closeStraddleDemoImportedOpenPosition(req, res);
    });
    objRouter.post("/straddle-demo/kill-switch", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await executeStraddleDemoKillSwitch(req, res);
    });
    objRouter.post("/straddle-demo/metrics/update", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await updateStraddleDemoRecoveryMetrics(req, res);
    });
    objRouter.post("/straddle-demo/metrics/recalculate-total-pnl", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await recalculateStraddleDemoRecoveryTotalPnl(req, res);
    });
    objRouter.get("/straddle-demo/closed-positions", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getStraddleDemoClosedPositions(req, res);
    });
    objRouter.post("/straddle-demo/closed-positions/clear", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await clearStraddleDemoClosedPositions(req, res);
    });
    objRouter.post("/straddle-demo/closed-positions/delete", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await deleteStraddleDemoClosedPosition(req, res);
    });
    objRouter.post("/straddle-demo/closed-positions/update", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await updateStraddleDemoClosedPosition(req, res);
    });
    objRouter.get("/straddle-demo/events", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getStraddleDemoEvents(req, res);
    });
    objRouter.post("/straddle-demo/events/delete", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await deleteStraddleDemoEventController(req, res);
    });
    objRouter.post("/straddle-demo/events/clear", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await clearStraddleDemoEventsController(req, res);
    });

    return objRouter;
}
