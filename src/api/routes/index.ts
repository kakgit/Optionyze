import { Router } from "express";
import { getHealth } from "../controllers/health-controller";
import {
    createManagedUserController,
    deleteManagedUserController,
    listManagedUsersController,
    listRunnerStates,
    listUsers,
    resetManagedUserPasswordController,
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
    closeRollingOptionsPtDeOpenPositionController,
    clearRollingOptionsPtDeClosedPositionsController,
    clearRollingOptionsPtDeEventsController,
    deleteRollingOptionsPtDeOpenPositionController,
    executeRollingOptionsPtDeManualFuture,
    executeRollingOptionsPtDeManualOption,
    exitRollingOptionsPtDeManualPositions,
    getRollingOptionsPtDeEvents,
    getRollingOptionsPtDeClosedPositions,
    getRollingOptionsPtDeOpenPositions,
    getRollingOptionsPtDeProfile,
    getRollingOptionsPtDeStatus,
    resetRollingOptionsPtDeStrategy,
    runRollingOptionsPtDeStrategyCycle,
    runRollingOptionsPtDeStrategyExecution,
    saveRollingOptionsPtDeProfileController,
    setRollingOptionsPtDeManualRenkoSignal,
    toggleRollingOptionsPtDeAutoTrader
} from "../controllers/rolling-options-pt-de-controller";
import {
    disableRollingOptionsLtDeAutoTrader,
    enableRollingOptionsLtDeAutoTrader,
    checkRollingOptionsLtDeConnection,
    closeRollingOptionsLtDeImportedOpenPosition,
    clearRollingOptionsLtDeEventsController,
    deleteRollingOptionsLtDeOpenPosition,
    executeRollingOptionsLtDeStrategy,
    executeRollingOptionsLtDeKillSwitch,
    executeRollingOptionsLtDeManualFuture,
    executeRollingOptionsLtDeManualOption,
    getRollingOptionsLtDeAccountSummary,
    getRollingOptionsLtDeClosedPositions,
    getRollingOptionsLtDeConnectionStatus,
    getRollingOptionsLtDeEvents,
    getRollingOptionsLtDeOpenPositions,
    getRollingOptionsLtDeRuntimeStatus,
    getRollingOptionsLtDeImportableOpenPositions
    ,
    getRollingOptionsLtDeProfile,
    reconcileRollingOptionsLtDeOpenPositions,
    saveRollingOptionsLtDeOpenPositions,
    saveRollingOptionsLtDeProfileController,
    setRollingOptionsLtDeManualRenkoSignal
} from "../controllers/rolling-options-lt-de-controller";
import {
    createDeltaApiProfileController,
    deleteDeltaApiProfileController,
    listDeltaApiProfilesController,
    testDeltaApiProfileLoginController,
    updateDeltaApiProfileController
} from "../controllers/delta-api-controller";
import type { RunnerManager } from "../../runners/runner-manager";
import type { RollingOptionsLtDeService } from "../../strategies/rolling-options-lt-de/service";
import type { StrategyFoGreeksPaperService } from "../../strategies/strategy-fo-greeks-paper/service";
import type { RollingOptionsPtDeService } from "../../strategies/rolling-options-pt-de/service";
import { requireAdminApi, requireAuthApi, requireFreshPasswordApi } from "../middleware/auth-middleware";

export function createApiRouter(
    pRunnerManager: RunnerManager,
    pStrategyFoPaperService: StrategyFoGreeksPaperService,
    pRollingOptionsPtDeService: RollingOptionsPtDeService,
    pRollingOptionsLtDeService: RollingOptionsLtDeService
): Router {
    const objRouter = Router();

    objRouter.get("/health", getHealth);
    objRouter.get("/users", requireAdminApi, async (req, res) => {
        await listUsers(req, res);
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

    objRouter.get("/rollingoptions-pt-de/profile", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getRollingOptionsPtDeProfile(req, res);
    });
    objRouter.post("/rollingoptions-pt-de/profile", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await saveRollingOptionsPtDeProfileController(req, res);
    });
    objRouter.get("/rollingoptions-pt-de/status", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getRollingOptionsPtDeStatus(req, res);
    });
    objRouter.get("/rollingoptions-pt-de/open-positions", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getRollingOptionsPtDeOpenPositions(req, res);
    });
    objRouter.post("/rollingoptions-pt-de/open-positions/delete", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await deleteRollingOptionsPtDeOpenPositionController(req, res);
    });
    objRouter.post("/rollingoptions-pt-de/open-positions/close", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await closeRollingOptionsPtDeOpenPositionController(req, res);
    });
    objRouter.get("/rollingoptions-pt-de/closed-positions", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getRollingOptionsPtDeClosedPositions(req, res);
    });
    objRouter.get("/rollingoptions-pt-de/events", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getRollingOptionsPtDeEvents(req, res);
    });
    objRouter.post("/rollingoptions-pt-de/auto-trader", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await toggleRollingOptionsPtDeAutoTrader(req, res, pRollingOptionsPtDeService);
    });
    objRouter.post("/rollingoptions-pt-de/manual/future", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await executeRollingOptionsPtDeManualFuture(req, res);
    });
    objRouter.post("/rollingoptions-pt-de/manual/option", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await executeRollingOptionsPtDeManualOption(req, res);
    });
    objRouter.post("/rollingoptions-pt-de/manual/exit", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await exitRollingOptionsPtDeManualPositions(req, res);
    });
    objRouter.post("/rollingoptions-pt-de/strategy/execute", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await runRollingOptionsPtDeStrategyExecution(req, res, pRollingOptionsPtDeService);
    });
    objRouter.post("/rollingoptions-pt-de/strategy/cycle", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await runRollingOptionsPtDeStrategyCycle(req, res, pRollingOptionsPtDeService);
    });
    objRouter.post("/rollingoptions-pt-de/renko/signal", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await setRollingOptionsPtDeManualRenkoSignal(req, res, pRollingOptionsPtDeService);
    });
    objRouter.post("/rollingoptions-pt-de/strategy/reset", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await resetRollingOptionsPtDeStrategy(req, res, pRollingOptionsPtDeService);
    });
    objRouter.post("/rollingoptions-pt-de/closed-positions/clear", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await clearRollingOptionsPtDeClosedPositionsController(req, res);
    });
    objRouter.post("/rollingoptions-pt-de/events/clear", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await clearRollingOptionsPtDeEventsController(req, res);
    });
    objRouter.get("/rollingoptions-lt-de/account-summary", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getRollingOptionsLtDeAccountSummary(req, res);
    });
    objRouter.get("/rollingoptions-lt-de/profile", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getRollingOptionsLtDeProfile(req, res);
    });
    objRouter.post("/rollingoptions-lt-de/profile", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await saveRollingOptionsLtDeProfileController(req, res);
    });
    objRouter.get("/rollingoptions-lt-de/connection/status", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getRollingOptionsLtDeConnectionStatus(req, res);
    });
    objRouter.get("/rollingoptions-lt-de/runtime", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getRollingOptionsLtDeRuntimeStatus(req, res);
    });
    objRouter.post("/rollingoptions-lt-de/connection/check", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await checkRollingOptionsLtDeConnection(req, res);
    });
    objRouter.post("/rollingoptions-lt-de/auto-trader/start", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await enableRollingOptionsLtDeAutoTrader(req, res, pRollingOptionsLtDeService);
    });
    objRouter.post("/rollingoptions-lt-de/auto-trader/stop", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await disableRollingOptionsLtDeAutoTrader(req, res, pRollingOptionsLtDeService);
    });
    objRouter.post("/rollingoptions-lt-de/strategy/execute", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await executeRollingOptionsLtDeStrategy(req, res, pRollingOptionsLtDeService);
    });
    objRouter.post("/rollingoptions-lt-de/kill-switch", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await executeRollingOptionsLtDeKillSwitch(req, res, pRollingOptionsLtDeService);
    });
    objRouter.post("/rollingoptions-lt-de/manual/future", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await executeRollingOptionsLtDeManualFuture(req, res);
    });
    objRouter.post("/rollingoptions-lt-de/manual/option", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await executeRollingOptionsLtDeManualOption(req, res);
    });
    objRouter.post("/rollingoptions-lt-de/open-positions/close", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await closeRollingOptionsLtDeImportedOpenPosition(req, res);
    });
    objRouter.get("/rollingoptions-lt-de/open-positions", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getRollingOptionsLtDeOpenPositions(req, res);
    });
    objRouter.post("/rollingoptions-lt-de/open-positions/reconcile", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await reconcileRollingOptionsLtDeOpenPositions(req, res, pRollingOptionsLtDeService);
    });
    objRouter.post("/rollingoptions-lt-de/renko/signal", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await setRollingOptionsLtDeManualRenkoSignal(req, res, pRollingOptionsLtDeService);
    });
    objRouter.post("/rollingoptions-lt-de/open-positions", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await saveRollingOptionsLtDeOpenPositions(req, res);
    });
    objRouter.post("/rollingoptions-lt-de/open-positions/delete", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await deleteRollingOptionsLtDeOpenPosition(req, res);
    });
    objRouter.get("/rollingoptions-lt-de/open-positions/importable", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getRollingOptionsLtDeImportableOpenPositions(req, res);
    });
    objRouter.get("/rollingoptions-lt-de/closed-positions", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getRollingOptionsLtDeClosedPositions(req, res);
    });
    objRouter.get("/rollingoptions-lt-de/events", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await getRollingOptionsLtDeEvents(req, res);
    });
    objRouter.post("/rollingoptions-lt-de/events/clear", requireAuthApi, requireFreshPasswordApi, async (req, res) => {
        await clearRollingOptionsLtDeEventsController(req, res);
    });

    return objRouter;
}
