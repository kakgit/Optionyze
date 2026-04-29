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

    return objRouter;
}
