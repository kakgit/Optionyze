import { loadLocalEnv } from "./load-env";
loadLocalEnv();

import express from "express";
import dns from "node:dns";
import path from "node:path";
import { createApiRouter } from "../api/routes";
import { RunnerManager } from "../runners/runner-manager";
import { getServerId } from "../runtime/server-runtime";
import { ensurePostgresSchema, isPostgresConfigured } from "../storage/postgres";
import { ensureSurvivalPostgresSchema } from "../storage/survival-postgres";
import { DirectionalOptionsDemoService } from "../strategies/directional-options-demo/service";
import {
    renderCoveredOptionsPage,
    renderOptionsScalperPage,
    renderDirectionalOptionsPage,
    renderRollingFuturesLiveDualPage
} from "../api/controllers/strategyfo-paper-controller";
import { recoverRollingFuturesLtAutoTraderCycles } from "../api/controllers/rolling-futures-lt-controller";
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
    attachSurvivalAdminContext,
    attachAuthContext,
    requireAdminPage,
    requireAuthPage,
    requireFreshPasswordPage,
    requireGuestPage,
    requireSurvivalAdminGuestPage,
    requireSurvivalAdminPage
} from "../api/middleware/auth-middleware";
import { ensureBootstrapAdminAccount } from "../storage/accounts-store";
import { cleanupExpiredSessions } from "../storage/sessions-store";
import { cleanupExpiredSurvivalAdminSessions } from "../storage/survival-admin-store";
import { ensureTelegramWebhookRegistered } from "../api/controllers/rolling-futures-lt-controller";
import {
    renderSurvivalAdminDashboardPage,
    renderSurvivalAdminRunningUsersPage,
    renderSurvivalAdminSignInPage,
    signInSurvivalAdmin,
    signOutSurvivalAdmin
} from "../api/controllers/survival-admin-controller";

dns.setDefaultResultOrder("ipv4first");

async function bootstrap(): Promise<void> {
    const app = express();
    const port = Number(process.env.PORT || 3001);
    const runnerManager = new RunnerManager();
    const directionalOptionsDemoService = new DirectionalOptionsDemoService();

    await ensurePostgresSchema();
    await ensureSurvivalPostgresSchema();
    await ensureBootstrapAdminAccount();
    await cleanupExpiredSessions();
    await cleanupExpiredSurvivalAdminSessions();
    await runnerManager.hydrate();
    await recoverRollingFuturesLtAutoTraderCycles();
    await directionalOptionsDemoService.hydrate();
    await ensureTelegramWebhookRegistered();

    app.set("view engine", "ejs");
    app.set("views", path.resolve(process.cwd(), "src", "views"));
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(express.static(path.resolve(process.cwd(), "public")));
    app.use(attachAuthContext);
    app.use(attachSurvivalAdminContext);

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
    app.get("/survival-admin/signin", requireSurvivalAdminGuestPage, renderSurvivalAdminSignInPage);
    app.post("/survival-admin/signin", signInSurvivalAdmin);
    app.post("/survival-admin/signout", requireSurvivalAdminPage, async (req, res) => {
        await signOutSurvivalAdmin(req, res);
    });
    app.get("/survival-admin/dashboard", requireSurvivalAdminPage, renderSurvivalAdminDashboardPage);
    app.get("/survival-admin/running-users", requireSurvivalAdminPage, renderSurvivalAdminRunningUsersPage);
    app.get("/dashboard", requireAuthPage, requireFreshPasswordPage, renderDashboardPage);
    app.get("/rollingfutures-lt-dual", requireAuthPage, requireFreshPasswordPage, renderRollingFuturesLiveDualPage);
    app.get("/covered-options", requireAuthPage, requireFreshPasswordPage, renderCoveredOptionsPage);
    app.get("/options-scalper", requireAuthPage, requireFreshPasswordPage, renderOptionsScalperPage);
    app.get("/directional-options", requireAuthPage, requireFreshPasswordPage, renderDirectionalOptionsPage);
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
    app.use("/api", createApiRouter(runnerManager, directionalOptionsDemoService));

    app.listen(port, () => {
        console.log(`Optionyze server listening on port ${port} as ${getServerId()}`);
    });
}

void bootstrap().catch((objError) => {
    console.error("Failed to bootstrap Optionyze", objError);
    process.exitCode = 1;
});




