import type { Request, Response } from "express";
import { verifyPassword } from "../../security/passwords";
import { getAccountByEmail } from "../../storage/accounts-store";
import { loadManagedUsers } from "../../storage/users-store";
import { listRollingFuturesLtRuntime } from "../../storage/rolling-futures-lt-runtime-store";
import { getStrategyLease } from "../../storage/strategy-lease-store";
import { isSurvivalPostgresConfigured } from "../../storage/survival-postgres";
import { isPrimaryDatabaseUnavailableError } from "../../storage/postgres";
import {
    cleanupExpiredSurvivalAdminSessions,
    createSurvivalAdminSession,
    deleteSurvivalAdminSession,
    getSurvivalAdminByEmail,
    updateSurvivalAdminLastLogin,
    upsertSurvivalAdminFromPrimaryAccount
} from "../../storage/survival-admin-store";
import { listSurvivalAccountDirectoryEntries } from "../../storage/survival-account-directory-store";
import { listSurvivalStates } from "../../storage/survival-store";
import {
    clearSurvivalAdminSessionCookie,
    setSurvivalAdminSessionCookie
} from "../middleware/auth-middleware";
import { getServerId } from "../../runtime/server-runtime";

export function renderSurvivalAdminSignInPage(req: Request, res: Response): void {
    res.render("survival-admin-signin", {
        pageTitle: "Survival Admin Sign In | Optionyze",
        errorMessage: "",
        infoMessage: getSurvivalAdminInfoMessage(req)
    });
}

export function renderSurvivalAdminDashboardPage(req: Request, res: Response): void {
    res.render("survival-admin-dashboard", {
        pageTitle: "Survival Admin Dashboard | Optionyze",
        survivalAdminAccount: req.survivalAdminAccount,
        currentServerId: getServerId(),
        infoMessage: ""
    });
}

export function renderSurvivalAdminRunningUsersPage(req: Request, res: Response): void {
    res.render("survival-admin-running-users", {
        pageTitle: "Survival Admin Running Users | Optionyze",
        survivalAdminAccount: req.survivalAdminAccount,
        currentServerId: getServerId(),
        infoMessage: ""
    });
}

export async function signInSurvivalAdmin(req: Request, res: Response): Promise<void> {
    const vEmail = String(req.body?.email || "").trim();
    const vPassword = String(req.body?.password || "");

    if (!vEmail || !vPassword) {
        renderSurvivalAdminSignInError(res, "Email and password are required.");
        return;
    }

    if (!isSurvivalPostgresConfigured()) {
        renderSurvivalAdminSignInError(res, "SURVIVAL_DATABASE_URL is not configured on this app instance.");
        return;
    }

    try {
        await cleanupExpiredSurvivalAdminSessions();
        let objAdmin = await getSurvivalAdminByEmail(vEmail);
        const objPrimaryAccount = await getAccountByEmail(vEmail);

        if (objPrimaryAccount && !objPrimaryAccount.isActive) {
            renderSurvivalAdminSignInError(res, "This Survival Admin account is inactive or does not exist.");
            return;
        }

        if (objPrimaryAccount && !objPrimaryAccount.isSurvivalAdmin) {
            renderSurvivalAdminSignInError(res, "This account is not enabled for Survival Admin access.");
            return;
        }

        const objPasswordSource = objPrimaryAccount?.isSurvivalAdmin
            ? objPrimaryAccount
            : objAdmin;

        if (!objPasswordSource || !(objPasswordSource.isActive)) {
            renderSurvivalAdminSignInError(res, "This Survival Admin account is inactive or does not exist.");
            return;
        }

        const bValidPassword = await verifyPassword(vPassword, objPasswordSource.passwordHash);
        if (!bValidPassword) {
            renderSurvivalAdminSignInError(res, "Incorrect password. Please check and try again.");
            return;
        }

        if (objPrimaryAccount?.isSurvivalAdmin && objPrimaryAccount.isActive) {
            objAdmin = await upsertSurvivalAdminFromPrimaryAccount(objPrimaryAccount);
        }

        if (!objAdmin || !objAdmin.isActive) {
            renderSurvivalAdminSignInError(res, "Unable to prepare Survival Admin access for this account.");
            return;
        }

        const objSession = await createSurvivalAdminSession(objAdmin.adminId);
        await updateSurvivalAdminLastLogin(objAdmin.adminId);
        setSurvivalAdminSessionCookie(res, objSession.sessionId);
        res.redirect("/survival-admin/dashboard");
    }
    catch (objError) {
        renderSurvivalAdminSignInError(res, getErrorMessage(objError, "Unable to sign in to Survival Admin right now."));
    }
}

export async function signOutSurvivalAdmin(req: Request, res: Response): Promise<void> {
    if (req.survivalAdminSessionId) {
        await deleteSurvivalAdminSession(req.survivalAdminSessionId);
    }
    clearSurvivalAdminSessionCookie(res);
    res.redirect("/survival-admin/signin?message=signed-out");
}

export async function listSurvivalAdminRunningUsers(req: Request, res: Response): Promise<void> {
    try {
        const [arrSurvivalRows, arrDirectory] = await Promise.all([
            listSurvivalStates("rolling-futures-lt-dual"),
            listSurvivalAccountDirectoryEntries()
        ]);
        const objDirectoryByAccountId = new Map(arrDirectory.map((objRow) => [objRow.accountId, objRow]));
        let arrManagedUsers: Awaited<ReturnType<typeof loadManagedUsers>> = [];
        try {
            arrManagedUsers = await loadManagedUsers();
        }
        catch (objError) {
            if (!isPrimaryDatabaseUnavailableError(objError)) {
                throw objError;
            }
        }

        const objManagedUsersById = new Map(arrManagedUsers.map((objRow) => [objRow.accountId, objRow]));
        const arrUsers = arrSurvivalRows
            .filter((objRow) => objRow.runStatus === "active")
            .filter((objRow) => !objManagedUsersById.get(objRow.userId)?.isSurvivalAdmin)
            .map((objRow) => {
                const objDirectory = objDirectoryByAccountId.get(objRow.userId);
                return {
                    accountId: objRow.userId,
                    fullName: objDirectory?.fullName || objRow.userId,
                    email: objDirectory?.email || "-",
                    status: "running",
                    autoTraderEnabled: true,
                    ownerServerId: String(objRow.ownerServerId || "").trim() || "-",
                    leaseExpiresAt: String(objRow.leaseExpiresAt || "").trim(),
                    survivalMode: Boolean(objRow.runtimeState?.primaryDbOutageLastError),
                    survivalOwnerServerId: String(objRow.ownerServerId || "").trim() || "-",
                    survivalUpdatedAt: String(objRow.updatedAt || "").trim(),
                    strategyRunId: String(objRow.strategyRunId || "").trim(),
                    simulatedPrimaryDbOutage: false,
                    simulatedPrimaryDbOutageEnabledAt: "",
                    lastCycleAt: String(objRow.lastHeartbeatAt || "").trim(),
                    updatedAt: String(objRow.updatedAt || "").trim()
                };
            })
            .sort((pLeft, pRight) => String(pLeft.fullName || "").localeCompare(String(pRight.fullName || "")));

        const objUsersByAccountId = new Map(arrUsers.map((objRow) => [objRow.accountId, objRow]));
        try {
            const arrRuntimeRows = await listRollingFuturesLtRuntime();
            const arrPrimaryRunning = arrRuntimeRows.filter((objRuntime) => {
                return objRuntime.strategyCode === "rolling-futures-lt-dual"
                    && objRuntime.autoTraderEnabled
                    && String(objRuntime.status || "").trim().toLowerCase() === "running";
            });

            for (const objRuntime of arrPrimaryRunning) {
                const objManagedUser = objManagedUsersById.get(objRuntime.userId);
                if (!objManagedUser) {
                    continue;
                }
                if (objManagedUser.isSurvivalAdmin) {
                    continue;
                }
                const objLease = await getStrategyLease(objRuntime.userId, objRuntime.strategyCode);
                const objExisting = objUsersByAccountId.get(objRuntime.userId);
                const vLeaseExpiresAtMs = objLease?.leaseExpiresAt ? new Date(objLease.leaseExpiresAt).getTime() : Number.NaN;
                const bActiveLease = Boolean(objLease && Number.isFinite(vLeaseExpiresAtMs) && vLeaseExpiresAtMs > Date.now());
                const vPrimaryOwner = bActiveLease ? String(objLease?.ownerServerId || "").trim() : "";

                if (objExisting) {
                    objExisting.ownerServerId = vPrimaryOwner || objExisting.ownerServerId;
                    objExisting.leaseExpiresAt = bActiveLease ? String(objLease?.leaseExpiresAt || "").trim() : objExisting.leaseExpiresAt;
                    objExisting.lastCycleAt = String(objRuntime.lastCycleAt || objExisting.lastCycleAt || "").trim();
                    objExisting.updatedAt = String(objRuntime.updatedAt || objExisting.updatedAt || "").trim();
                    continue;
                }

                objUsersByAccountId.set(objRuntime.userId, {
                    accountId: objRuntime.userId,
                    fullName: objManagedUser.fullName || objRuntime.userId,
                    email: objManagedUser.email || "-",
                    status: objRuntime.status,
                    autoTraderEnabled: objRuntime.autoTraderEnabled,
                    ownerServerId: vPrimaryOwner || "-",
                    leaseExpiresAt: bActiveLease ? String(objLease?.leaseExpiresAt || "").trim() : "",
                    survivalMode: false,
                    survivalOwnerServerId: "-",
                    survivalUpdatedAt: "",
                    strategyRunId: "",
                    simulatedPrimaryDbOutage: false,
                    simulatedPrimaryDbOutageEnabledAt: "",
                    lastCycleAt: String(objRuntime.lastCycleAt || "").trim(),
                    updatedAt: String(objRuntime.updatedAt || "").trim()
                });
            }
        }
        catch (objError) {
            if (!isPrimaryDatabaseUnavailableError(objError)) {
                throw objError;
            }
        }

        res.json({
            status: "success",
            data: Array.from(objUsersByAccountId.values())
                .sort((pLeft, pRight) => String(pLeft.fullName || "").localeCompare(String(pRight.fullName || "")))
        });
    }
    catch (objError) {
        res.status(500).json({
            status: "danger",
            message: getErrorMessage(objError, "Unable to load Survival Admin running users.")
        });
    }
}

function renderSurvivalAdminSignInError(res: Response, pMessage: string): void {
    res.status(400).render("survival-admin-signin", {
        pageTitle: "Survival Admin Sign In | Optionyze",
        errorMessage: pMessage,
        infoMessage: ""
    });
}

function getSurvivalAdminInfoMessage(req: Request): string {
    return req.query.message === "signed-out"
        ? "You have signed out from Survival Admin access."
        : "";
}

function getErrorMessage(pError: unknown, pFallback: string): string {
    return pError instanceof Error && pError.message ? pError.message : pFallback;
}
