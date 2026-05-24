import type { Request, Response } from "express";
import {
    createAccount,
    deleteAccount,
    updateAccount,
    updateAccountPassword,
    type CreateAccountInput,
    type UpdateAccountInput
} from "../../storage/accounts-store";
import {
    deleteManagedUserProfile,
    loadManagedUsers,
    upsertManagedUserProfile
} from "../../storage/users-store";
import {
    deletePendingStrategyExecutionRequest,
    listPendingStrategyExecutionRequests
} from "../../storage/strategy-execution-request-store";
import {
    getPendingStrategyAutoExecSettings,
    savePendingStrategyAutoExecSettings
} from "../../storage/admin-settings-store";
import { executePendingRollingFuturesLtDualStrategyRequest } from "./rolling-futures-lt-controller";
import type { RunnerManager } from "../../runners/runner-manager";
import { getServerId } from "../../runtime/server-runtime";

export function renderMngUsersPage(req: Request, res: Response): void {
    res.render("mngusers", {
        pageTitle: "MngUsers | Optionyze",
        currentAccount: req.authAccount,
        currentServerId: getServerId()
    });
}

export async function listRunnerStates(_req: Request, res: Response, pRunnerManager: RunnerManager): Promise<void> {
    res.json({ status: "success", data: pRunnerManager.listStates() });
}

export async function listManagedUsersController(_req: Request, res: Response): Promise<void> {
    try {
        const objUsers = await loadManagedUsers();
        res.json({ status: "success", data: objUsers });
    }
    catch (objError) {
        res.status(500).json({ status: "danger", message: getErrorMessage(objError, "Unable to load managed users.") });
    }
}

export async function listPendingStrategyExecutionRequestsController(_req: Request, res: Response): Promise<void> {
    try {
        const arrRequests = await listPendingStrategyExecutionRequests();
        res.json({ status: "success", data: arrRequests });
    }
    catch (objError) {
        res.status(500).json({ status: "danger", message: getErrorMessage(objError, "Unable to load pending strategy execution requests.") });
    }
}

export async function executePendingStrategyExecutionRequestController(req: Request, res: Response): Promise<void> {
    await executePendingRollingFuturesLtDualStrategyRequest(req, res);
}

export async function cancelPendingStrategyExecutionRequestController(req: Request, res: Response): Promise<void> {
    const vRequestId = String(req.params.requestId || "").trim();
    if (!vRequestId) {
        res.status(400).json({ status: "warning", message: "Execution request id is required." });
        return;
    }

    try {
        await deletePendingStrategyExecutionRequest(vRequestId);
        res.json({ status: "success", message: "Pending strategy execution request cancelled successfully." });
    }
    catch (objError) {
        res.status(500).json({ status: "danger", message: getErrorMessage(objError, "Unable to cancel pending strategy execution request.") });
    }
}

export async function getPendingStrategyAutoExecSettingsController(_req: Request, res: Response): Promise<void> {
    try {
        const objSettings = await getPendingStrategyAutoExecSettings();
        res.json({ status: "success", data: objSettings });
    }
    catch (objError) {
        res.status(500).json({ status: "danger", message: getErrorMessage(objError, "Unable to load pending strategy auto-exec settings.") });
    }
}

export async function savePendingStrategyAutoExecSettingsController(req: Request, res: Response): Promise<void> {
    try {
        const objSettings = await savePendingStrategyAutoExecSettings({
            slEnabled: req.body?.slEnabled !== false,
            tpEnabled: Boolean(req.body?.tpEnabled)
        });
        res.json({ status: "success", message: "Auto execution settings saved successfully.", data: objSettings });
    }
    catch (objError) {
        res.status(500).json({ status: "danger", message: getErrorMessage(objError, "Unable to save pending strategy auto-exec settings.") });
    }
}

export async function createManagedUserController(req: Request, res: Response): Promise<void> {
    try {
        const objAccountInput = readCreateAccountInput(req);
        validateCreateManagedUser(objAccountInput, String(req.body?.confirmPassword || ""));

        const objAccount = await createAccount(objAccountInput);
        await upsertManagedUserProfile({
            accountId: objAccount.accountId,
            fullName: objAccount.fullName,
            email: objAccount.email,
            isActive: objAccount.isActive,
            strategyType: "strategy-fo-greeks-paper",
            capital: 0,
            exchange: "delta-exchange",
            preferredSymbol: "",
            notes: ""
        });

        res.json({ status: "success", message: "User account created successfully." });
    }
    catch (objError) {
        res.status(400).json({ status: "warning", message: getErrorMessage(objError, "Unable to create user account.") });
    }
}

export async function updateManagedUserController(req: Request, res: Response): Promise<void> {
    const vAccountId = String(req.params.accountId || "").trim();
    if (!vAccountId) {
        res.status(400).json({ status: "warning", message: "Account id is required." });
        return;
    }

    try {
        const objAccountInput = readUpdateAccountInput(req);
        validateManagedUserUpdate(objAccountInput);
        assertAdminSelfProtection(req, vAccountId, objAccountInput.isAdmin, objAccountInput.isActive);

        const objAccount = await updateAccount(vAccountId, objAccountInput);
        await upsertManagedUserProfile({
            accountId: vAccountId,
            fullName: objAccount.fullName,
            email: objAccount.email,
            isActive: objAccount.isActive,
            strategyType: "strategy-fo-greeks-paper",
            capital: 0,
            exchange: "delta-exchange",
            preferredSymbol: "",
            notes: ""
        });

        res.json({ status: "success", message: "User account updated successfully." });
    }
    catch (objError) {
        res.status(400).json({ status: "warning", message: getErrorMessage(objError, "Unable to update user account.") });
    }
}

export async function resetManagedUserPasswordController(req: Request, res: Response): Promise<void> {
    const vAccountId = String(req.params.accountId || "").trim();
    const vTemporaryPassword = String(req.body?.temporaryPassword || "");
    const bMustChangePassword = req.body?.mustChangePassword !== false;

    if (!vAccountId) {
        res.status(400).json({ status: "warning", message: "Account id is required." });
        return;
    }

    try {
        if (vTemporaryPassword.length < 3) {
            throw new Error("Temporary password must be at least 3 characters long.");
        }

        await updateAccountPassword(vAccountId, vTemporaryPassword, bMustChangePassword);
        res.json({
            status: "success",
            message: bMustChangePassword
                ? "Temporary password set. User must change it on next login."
                : "Temporary password updated successfully."
        });
    }
    catch (objError) {
        res.status(400).json({ status: "warning", message: getErrorMessage(objError, "Unable to reset password.") });
    }
}

export async function deleteManagedUserController(req: Request, res: Response): Promise<void> {
    const vAccountId = String(req.params.accountId || "").trim();
    if (!vAccountId) {
        res.status(400).json({ status: "warning", message: "Account id is required." });
        return;
    }

    try {
        if (req.authAccount?.accountId === vAccountId) {
            throw new Error("You cannot delete your own admin account.");
        }

        await deleteManagedUserProfile(vAccountId);
        await deleteAccount(vAccountId);
        res.json({ status: "success", message: "User account deleted successfully." });
    }
    catch (objError) {
        res.status(400).json({ status: "warning", message: getErrorMessage(objError, "Unable to delete user account.") });
    }
}

function readCreateAccountInput(req: Request): CreateAccountInput {
    return {
        fullName: String(req.body?.fullName || "").trim(),
        email: String(req.body?.email || "").trim(),
        mobileNo: String(req.body?.mobileNo || "").trim(),
        telegramChatId: String(req.body?.telegramChatId || "").trim(),
        password: String(req.body?.password || ""),
        isAdmin: Boolean(req.body?.isAdmin),
        execStrategy: Boolean(req.body?.execStrategy),
        isActive: req.body?.isActive !== false,
        mustChangePassword: Boolean(req.body?.mustChangePassword)
    };
}

function readUpdateAccountInput(req: Request): UpdateAccountInput {
    return {
        fullName: String(req.body?.fullName || "").trim(),
        email: String(req.body?.email || "").trim(),
        mobileNo: String(req.body?.mobileNo || "").trim(),
        telegramChatId: String(req.body?.telegramChatId || "").trim(),
        isActive: Boolean(req.body?.isActive),
        isAdmin: Boolean(req.body?.isAdmin),
        execStrategy: Boolean(req.body?.execStrategy),
        mustChangePassword: Boolean(req.body?.mustChangePassword)
    };
}

function validateCreateManagedUser(pInput: CreateAccountInput, pConfirmPassword: string): void {
    validateManagedUserBasics(pInput.fullName, pInput.email, pInput.mobileNo, pInput.telegramChatId);

    if (pInput.password.length < 3) {
        throw new Error("Password must be at least 3 characters long.");
    }

    if (pInput.password !== pConfirmPassword) {
        throw new Error("Password and confirm password do not match.");
    }
}

function validateManagedUserUpdate(pInput: UpdateAccountInput): void {
    validateManagedUserBasics(pInput.fullName, pInput.email, pInput.mobileNo, pInput.telegramChatId);
}

function validateManagedUserBasics(
    pFullName: string,
    pEmail: string,
    pMobileNo: string,
    pTelegramChatId?: string
): void {
    if (!pFullName || !pEmail || !pMobileNo) {
        throw new Error("Full name, email, and mobile number are required.");
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pEmail)) {
        throw new Error("Please enter a valid email address.");
    }

    if (!/^\d{10,15}$/.test(pMobileNo)) {
        throw new Error("Please enter a valid mobile number using 10 to 15 digits.");
    }

    if (String(pTelegramChatId || "").trim() && !/^-?\d{5,20}$/.test(String(pTelegramChatId || ""))) {
        throw new Error("Please enter a valid Telegram Chat ID.");
    }
}

function assertAdminSelfProtection(req: Request, pTargetAccountId: string, pIsAdmin: boolean, pIsActive: boolean): void {
    if (req.authAccount?.accountId !== pTargetAccountId) {
        return;
    }

    if (!pIsAdmin) {
        throw new Error("You cannot remove your own admin access.");
    }

    if (!pIsActive) {
        throw new Error("You cannot deactivate your own account.");
    }
}

function getErrorMessage(pError: unknown, pFallback: string): string {
    if (pError instanceof Error && pError.message) {
        return pError.message;
    }

    return pFallback;
}
