import { Router } from "express";
import { getHealth } from "../controllers/health-controller";
import {
    getPendingStrategyAutoExecSettingsController,
    createManagedUserController,
    deleteManagedUserController,
    listManagedUsersController,
    listPendingStrategyExecutionRequestsController,
    listRunnerStates,
    cancelPendingStrategyExecutionRequestController,
    executePendingStrategyExecutionRequestController,
    resetManagedUserPasswordController,
    savePendingStrategyAutoExecSettingsController,
    updateManagedUserController
} from "../controllers/users-controller";
import {
    emergencyStopStrategyFoPaper,
    getStrategyFoPaperProfile,
    getStrategyFoPaperStatus,
    resetStrategyFoPaper,
    saveStrategyFoPaperProfileController,
    startStrategyFoPaper,
    stopStrategyFoPaper,
    runStrategyFoPaperCycle,
    validateStrategyFoPaperLogin
} from "../controllers/strategyfo-paper-controller";
import {
    checkRollingFuturesLtDualConnection,
    clearRollingFuturesLtDualEventsController,
    deleteRollingFuturesLtDualEventController,
    closeRollingFuturesLtDualImportedOpenPosition,
    deleteRollingFuturesLtDualOpenPosition,
    disableRollingFuturesLtDualAutoTrader,
    enableRollingFuturesLtDualAutoTrader,
    executeRollingFuturesLtDualKillSwitch,
    executeRollingFuturesLtDualManualFuture,
    executeRollingFuturesLtDualManualOption,
    executeRollingFuturesLtDualStrategy,
    enableRollingFuturesLtDualSimulatedPrimaryOutageController,
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
    recalculateRollingFuturesLtDualRecoveryTotalPnl,
    updateRollingFuturesLtDualRecoveryMetrics,
    reconcileRollingFuturesLtDualOpenPositions,
    saveRollingFuturesLtDualOpenPositions,
    saveRollingFuturesLtDualProfile
} from "../controllers/rolling-futures-lt-controller";
import {
    createDeltaApiProfileController,
    deleteDeltaApiProfileController,
    listDeltaApiProfilesController,
    testDeltaApiProfileLoginController,
    updateDeltaApiProfileController
} from "../controllers/delta-api-controller";
import type { RunnerManager } from "../../runners/runner-manager";
import type { StrategyFoGreeksPaperService } from "../../strategies/strategy-fo-greeks-paper/service";
import { requireAdminApi, requireAuthApi, requireFreshPasswordApi } from "../middleware/auth-middleware";

export function createApiRouter(
    pRunnerManager: RunnerManager,
    pStrategyFoPaperService: StrategyFoGreeksPaperService
): Router {
    const objRouter = Router();

    objRouter.get("/health", getHealth);
    objRouter.get("/runners", requireAdminApi, async (req, res) => {
        await listRunnerStates(req, res, pRunnerManager);
    });
    objRouter.get("/admin/accounts", requireAdminApi, async (req, res) => {
        await listManagedUsersController(req, res);
    });
    objRouter.get("/admin/strategy-execution-requests", requireAdminApi, async (req, res) => {
        await listPendingStrategyExecutionRequestsController(req, res);
    });
    objRouter.get("/admin/strategy-execution-requests/settings", requireAdminApi, async (req, res) => {
        await getPendingStrategyAutoExecSettingsController(req, res);
    });
    objRouter.put("/admin/strategy-execution-requests/settings", requireAdminApi, async (req, res) => {
        await savePendingStrategyAutoExecSettingsController(req, res);
    });
    objRouter.post("/admin/strategy-execution-requests/:requestId/execute", requireAdminApi, async (req, res) => {
        await executePendingStrategyExecutionRequestController(req, res);
    });
    objRouter.delete("/admin/strategy-execution-requests/:requestId", requireAdminApi, async (req, res) => {
        await cancelPendingStrategyExecutionRequestController(req, res);
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

    objRouter.get("/strategyfo/paper/status", requireAuthApi, requireFreshPasswordApi, (req, res) => {
        getStrategyFoPaperStatus(req, res, pStrategyFoPaperService);
    });
    objRouter.get("/strategyfo/paper/profile", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getStrategyFoPaperProfile(req, res);
    });
    objRouter.post("/strategyfo/paper/profile", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await saveStrategyFoPaperProfileController(req, res);
    });
    objRouter.post("/strategyfo/paper/validate-login", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await validateStrategyFoPaperLogin(req, res);
    });
    objRouter.post("/strategyfo/paper/start", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await startStrategyFoPaper(req, res, pStrategyFoPaperService);
    });
    objRouter.post("/strategyfo/paper/stop", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await stopStrategyFoPaper(req, res, pStrategyFoPaperService);
    });
    objRouter.post("/strategyfo/paper/cycle", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await runStrategyFoPaperCycle(req, res, pStrategyFoPaperService);
    });
    objRouter.post("/strategyfo/paper/reset", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await resetStrategyFoPaper(req, res, pStrategyFoPaperService);
    });
    objRouter.post("/strategyfo/paper/emergency-stop", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await emergencyStopStrategyFoPaper(req, res, pStrategyFoPaperService);
    });

    objRouter.get("/rollingfutures-lt-dual/profile", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getRollingFuturesLtDualProfile(req, res);
    });
    objRouter.get("/rollingfutures-lt-dual/admin/running-users", requireAdminApi, requireFreshPasswordApi, async (req, res) => {
        await listRollingFuturesLtDualRunningUsers(req, res);
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

    return objRouter;
}
