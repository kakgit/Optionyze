import { loadLocalEnv } from "./load-env";
loadLocalEnv();

import express from "express";
import dns from "node:dns";
import path from "node:path";
import { createApiRouter } from "../api/routes";
import { RunnerManager } from "../runners/runner-manager";
import { ensurePostgresSchema, isPostgresConfigured } from "../storage/postgres";
import { StrategyFoGreeksPaperService } from "../strategies/strategy-fo-greeks-paper/service";
import { startRollingOptionsLtDeConnectionMonitor, runRollingOptionsLtDeConnectionMonitorCycle } from "../strategies/rolling-options-lt-de/connection-monitor";
import { RollingOptionsLtDeService } from "../strategies/rolling-options-lt-de/service";
import { RollingOptionsPtDeService } from "../strategies/rolling-options-pt-de/service";
import {
    renderRollingFuturesLiveDualPage,
    renderRollingFuturesLiveLongPage,
    renderRollingFuturesLiveShortPage,
    renderRollingFuturesPaperDemoPage,
    renderStrategyFoPaperPage
} from "../api/controllers/strategyfo-paper-controller";
import { recoverRollingFuturesLtAutoTraderCycles } from "../api/controllers/rolling-futures-lt-controller";
import { renderRollingOptionsPaperDemoPage } from "../api/controllers/rolling-options-pt-de-controller";
import { renderRollingOptionsLivePage } from "../api/controllers/rolling-options-lt-de-controller";
import {
    changePassword,
    renderChangePasswordPage,
    renderDashboardPage,
    renderSignInPage,
    sendTelegramSignUpTest,
    renderSignUpPage,
    signInAccount,
    signOutAccount,
    signUpAccount
} from "../api/controllers/auth-controller";
import { renderMngUsersPage } from "../api/controllers/users-controller";
import { renderDeltaExchangeApiPage, renderMyProfilePage, sendTelegramProfileTest, updateMyProfile } from "../api/controllers/account-controller";
import {
    attachAuthContext,
    requireAdminPage,
    requireAuthPage,
    requireFreshPasswordPage,
    requireGuestPage
} from "../api/middleware/auth-middleware";
import { ensureBootstrapAdminAccount } from "../storage/accounts-store";
import { cleanupExpiredSessions } from "../storage/sessions-store";

dns.setDefaultResultOrder("ipv4first");

async function bootstrap(): Promise<void> {
    const app = express();
    const port = Number(process.env.PORT || 3001);
    const runnerManager = new RunnerManager();
    const strategyFoPaperService = new StrategyFoGreeksPaperService(runnerManager);
    const rollingOptionsPtDeService = new RollingOptionsPtDeService(runnerManager);
    const rollingOptionsLtDeService = new RollingOptionsLtDeService(runnerManager);

    await ensurePostgresSchema();
    await ensureBootstrapAdminAccount();
    await cleanupExpiredSessions();
    await runnerManager.hydrate();
    await rollingOptionsPtDeService.hydrate();
    await rollingOptionsLtDeService.hydrate();
    await recoverRollingFuturesLtAutoTraderCycles();
    startRollingOptionsLtDeConnectionMonitor(5 * 60 * 1000);
    void runRollingOptionsLtDeConnectionMonitorCycle();

    app.set("view engine", "ejs");
    app.set("views", path.resolve(process.cwd(), "src", "views"));
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(express.static(path.resolve(process.cwd(), "public")));
    app.use(attachAuthContext);

    app.get("/", (_req, res) => {
        res.render("home", {
            storageMode: isPostgresConfigured() ? "PostgreSQL" : "JSON MVP"
        });
    });
    app.get("/signin", requireGuestPage, renderSignInPage);
    app.get("/signup", requireGuestPage, renderSignUpPage);
    app.post("/auth/signin", signInAccount);
    app.post("/auth/signup/test-telegram", sendTelegramSignUpTest);
    app.post("/auth/signup", signUpAccount);
    app.post("/auth/signout", requireAuthPage, async (req, res) => {
        await signOutAccount(req, res);
    });
    app.get("/dashboard", requireAuthPage, requireFreshPasswordPage, renderDashboardPage);
    app.get("/rollingoptions-pt-de", requireAuthPage, requireFreshPasswordPage, renderRollingOptionsPaperDemoPage);
    app.get("/rollingfutures-pt-de", requireAuthPage, requireFreshPasswordPage, renderRollingFuturesPaperDemoPage);
    app.get("/rollingoptions-lt-de", requireAuthPage, requireFreshPasswordPage, renderRollingOptionsLivePage);
    app.get("/rollingfutures-lt-long", requireAuthPage, requireFreshPasswordPage, renderRollingFuturesLiveLongPage);
    app.get("/rollingfutures-lt-short", requireAuthPage, requireFreshPasswordPage, renderRollingFuturesLiveShortPage);
    app.get("/rollingfutures-lt-dual", requireAuthPage, requireFreshPasswordPage, renderRollingFuturesLiveDualPage);
    app.get("/mngusers", requireAuthPage, requireFreshPasswordPage, requireAdminPage, renderMngUsersPage);
    app.get("/account/profile", requireAuthPage, renderMyProfilePage);
    app.post("/account/profile", requireAuthPage, async (req, res) => {
        await updateMyProfile(req, res);
    });
    app.post("/account/profile/test-telegram", requireAuthPage, async (req, res) => {
        await sendTelegramProfileTest(req, res);
    });
    app.get("/account/delta-exchange-api", requireAuthPage, requireFreshPasswordPage, renderDeltaExchangeApiPage);
    app.get("/account/change-password", requireAuthPage, renderChangePasswordPage);
    app.post("/auth/change-password", requireAuthPage, async (req, res) => {
        await changePassword(req, res);
    });
    app.get("/strategyfogreeks", requireAuthPage, requireFreshPasswordPage, renderStrategyFoPaperPage);
    app.use("/api", createApiRouter(runnerManager, strategyFoPaperService, rollingOptionsPtDeService, rollingOptionsLtDeService));

    app.listen(port, () => {
        console.log(`Optionyze server listening on port ${port}`);
    });
}

void bootstrap().catch((objError) => {
    console.error("Failed to bootstrap Optionyze", objError);
    process.exitCode = 1;
});




