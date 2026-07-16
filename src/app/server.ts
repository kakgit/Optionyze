import { loadLocalEnv } from "./load-env";
loadLocalEnv();

import express from "express";
import dns from "node:dns";
import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import path from "node:path";
import WebSocket, { WebSocketServer } from "ws";
import { createApiRouter } from "../api/routes";
import { RunnerManager } from "../runners/runner-manager";
import { getServerId } from "../runtime/server-runtime";
import { ensurePostgresSchema, isPostgresConfigured } from "../storage/postgres";
import { ensureSurvivalPostgresSchema } from "../storage/survival-postgres";
import { getAccountById } from "../storage/accounts-store";
import { getSessionById, getSessionCookieName } from "../storage/sessions-store";
import {
    renderCoveredOptionsPage,
    renderRenkoOptionsPage,
    renderStrangleOptionsPage,
    renderOptionsDemoPage
} from "../api/controllers/strategyfo-paper-controller";
import { buildOpenPositionsPayload, recoverRollingFuturesLtAutoTraderCycles, syncOptionsScalperRenkoRuntimeAndMaybeAutoTrade } from "../api/controllers/rolling-futures-lt-controller";
import { ensureLiveTickerSymbols, getLiveMarketSnapshot } from "../strategies/rolling-options-pt-de/market-data";
import type { RollingOptionsPtDeConfig } from "../strategies/rolling-options-pt-de/types";
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

function normalizeDemoRenkoSymbol(value: unknown): "BTC" | "ETH" {
    return String(value || "").trim().toUpperCase() === "ETH" ? "ETH" : "BTC";
}

function getDemoRenkoContractName(symbol: "BTC" | "ETH"): string {
    return symbol === "ETH" ? "ETHUSD" : "BTCUSD";
}

function getDemoRenkoLotSize(symbol: "BTC" | "ETH"): number {
    return symbol === "ETH" ? 0.01 : 0.001;
}

function readCookieValue(headerValue: string | undefined, cookieName: string): string {
    const source = String(headerValue || "");
    if (!source) {
        return "";
    }
    for (const cookiePart of source.split(";")) {
        const [rawName, ...rawValueParts] = cookiePart.split("=");
        if (String(rawName || "").trim() !== cookieName) {
            continue;
        }
        return decodeURIComponent(rawValueParts.join("=").trim());
    }
    return "";
}

async function bootstrap(): Promise<void> {
    const app = express();
    const port = Number(process.env.PORT || 3001);
    const runnerManager = new RunnerManager();

    await ensurePostgresSchema();
    await ensureSurvivalPostgresSchema();
    await ensureBootstrapAdminAccount();
    await cleanupExpiredSessions();
    await cleanupExpiredSurvivalAdminSessions();
    await runnerManager.hydrate();
    await recoverRollingFuturesLtAutoTraderCycles();
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
    app.get("/covered-options", requireAuthPage, requireFreshPasswordPage, renderCoveredOptionsPage);
    app.get("/strangle-options", requireAuthPage, requireFreshPasswordPage, renderStrangleOptionsPage);
    app.get("/renko-options", requireAuthPage, requireFreshPasswordPage, renderRenkoOptionsPage);
    app.get("/options-demo", requireAuthPage, requireFreshPasswordPage, renderOptionsDemoPage);
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
    app.use("/api", createApiRouter(runnerManager));

    const server = createServer(app);
    const websocketServer = new WebSocketServer({ noServer: true });

    server.on("upgrade", async (req, socket, head) => {
        try {
            const objUrl = new URL(String(req.url || ""), "http://localhost");
            if (objUrl.pathname !== "/ws/options-demo/renko") {
                socket.destroy();
                return;
            }
            const vSessionId = readCookieValue(req.headers.cookie, getSessionCookieName());
            if (!vSessionId) {
                socket.destroy();
                return;
            }
            const objSession = await getSessionById(vSessionId);
            if (!objSession) {
                socket.destroy();
                return;
            }
            const objAccount = await getAccountById(objSession.accountId);
            if (!objAccount || !objAccount.isActive) {
                socket.destroy();
                return;
            }
            websocketServer.handleUpgrade(req, socket, head, (ws) => {
                websocketServer.emit("connection", ws, req, objAccount.accountId);
            });
        }
        catch (objError) {
            console.error("[renko-ws] upgrade failed:", objError);
            socket.destroy();
        }
    });

    websocketServer.on("connection", (ws: WebSocket, req: IncomingMessage, userId: string) => {
        const objUrl = new URL(String(req.url || ""), "http://localhost");
        const symbol = normalizeDemoRenkoSymbol(objUrl.searchParams.get("symbol"));
        const contractName = getDemoRenkoContractName(symbol);
        const lotSize = getDemoRenkoLotSize(symbol);
        let closed = false;
        let timerRef: NodeJS.Timeout | null = null;
        let tickInFlight = false;
        let tickPending = false;

        ensureLiveTickerSymbols([contractName]);

        const sendTick = async (): Promise<void> => {
            if (closed || ws.readyState !== WebSocket.OPEN) {
                return;
            }
            try {
                const objSnapshot = await getLiveMarketSnapshot({
                    symbol,
                    contractName,
                    lotSize,
                    futureQty: 1,
                    futureOrderType: "market_order",
                    action: "buy",
                    legSide: "ce",
                    expiryMode: "1",
                    expiryDate: "",
                    optionQty: 1,
                    redOptionQtyPct: 100,
                    greenOptionQtyPct: 100,
                    newDelta: 0.53,
                    reDelta: 0.53,
                    deltaTakeProfit: 0.15,
                    deltaStopLoss: 0.85,
                    reEnter: false,
                    addOneLotFuture: false,
                    renkoEnabled: true,
                    renkoStepPoints: 10,
                    renkoPriceSource: "spot_price",
                    loopSeconds: 1
                });
                const objSync = await syncOptionsScalperRenkoRuntimeAndMaybeAutoTrade(userId, {
                    spotPrice: objSnapshot.spotPrice,
                    futuresPrice: objSnapshot.futuresPrice,
                    bestBidPrice: objSnapshot.bestBidPrice,
                    bestAskPrice: objSnapshot.bestAskPrice
                });
                const objTrackedOpenPositions = objSync.autoTrade?.trackedOpenPositions
                    || await buildOpenPositionsPayload(userId, "options-scalper");
                if (closed || ws.readyState !== WebSocket.OPEN) {
                    return;
                }
                ws.send(JSON.stringify({
                    type: "renko_state",
                    userId,
                    symbol,
                    contractName,
                    spotPrice: objSnapshot.spotPrice,
                    futuresPrice: objSnapshot.futuresPrice,
                    bestBidPrice: objSnapshot.bestBidPrice,
                    bestAskPrice: objSnapshot.bestAskPrice,
                    ts: objSnapshot.ts,
                    renko: objSync.renko,
                    renkoHistoryBySymbol: objSync.profile?.uiState?.renkoHistoryBySymbol || null,
                    autoTrade: objSync.autoTrade || null,
                    trackedOpenPositions: objTrackedOpenPositions
                }));
            }
            catch (objError) {
                if (!closed && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: "renko_error",
                        message: objError instanceof Error ? objError.message : "Unable to load live Renko price."
                    }));
                }
            }
        };

        const queueSendTick = (): void => {
            if (closed || ws.readyState !== WebSocket.OPEN) {
                return;
            }
            if (tickInFlight) {
                tickPending = true;
                return;
            }
            tickInFlight = true;
            void (async () => {
                try {
                    do {
                        tickPending = false;
                        await sendTick();
                    } while (!closed && ws.readyState === WebSocket.OPEN && tickPending);
                }
                finally {
                    tickInFlight = false;
                    if (!closed && ws.readyState === WebSocket.OPEN && tickPending) {
                        queueSendTick();
                    }
                }
            })();
        };

        queueSendTick();
        timerRef = setInterval(() => {
            queueSendTick();
        }, 1000);

        ws.on("close", () => {
            closed = true;
            if (timerRef) {
                clearInterval(timerRef);
            }
        });
        ws.on("error", () => {
            closed = true;
            if (timerRef) {
                clearInterval(timerRef);
            }
        });
    });

    server.listen(port, () => {
        console.log(`Optionyze server listening on port ${port} as ${getServerId()}`);
    });
}

void bootstrap().catch((objError) => {
    console.error("Failed to bootstrap Optionyze", objError);
    process.exitCode = 1;
});




