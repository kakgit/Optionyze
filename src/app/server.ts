import { loadLocalEnv } from "./load-env";
loadLocalEnv();
dns.setDefaultResultOrder("ipv4first");

import express from "express";
import dns from "node:dns";
import path from "node:path";
import { createApiRouter } from "../api/routes";
import { RunnerManager } from "../runners/runner-manager";
import { ensurePostgresSchema, isPostgresConfigured } from "../storage/postgres";
import { StrategyFoGreeksPaperService } from "../strategies/strategy-fo-greeks-paper/service";
import { renderStrategyFoPaperPage } from "../api/controllers/strategyfo-paper-controller";
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

async function bootstrap(): Promise<void> {
    const app = express();
    const port = Number(process.env.PORT || 3001);
    const runnerManager = new RunnerManager();
    const strategyFoPaperService = new StrategyFoGreeksPaperService(runnerManager);

    await ensurePostgresSchema();
    await ensureBootstrapAdminAccount();
    await cleanupExpiredSessions();
    await runnerManager.hydrate();

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
    app.use("/api", createApiRouter(runnerManager, strategyFoPaperService));

    app.listen(port, () => {
        console.log(`Optionyze server listening on port ${port}`);
    });
}

void bootstrap().catch((objError) => {
    console.error("Failed to bootstrap Optionyze", objError);
    process.exitCode = 1;
});




