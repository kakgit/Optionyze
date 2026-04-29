import type { Request, Response } from "express";
import { createAccount, getAccountByEmail, updateAccountPassword } from "../../storage/accounts-store";
import { createSession, deleteSession } from "../../storage/sessions-store";
import { verifyPassword } from "../../security/passwords";
import { isPostgresConfigured } from "../../storage/postgres";
import { clearSessionCookie, setSessionCookie } from "../middleware/auth-middleware";

interface AuthPageValues {
    fullName?: string;
    email?: string;
    mobileNo?: string;
    telegramChatId?: string;
}

export function renderSignInPage(req: Request, res: Response): void {
    res.render("signin", {
        pageTitle: "Sign In | Optionyze",
        errorMessage: "",
        infoMessage: getInfoMessage(req),
        values: { email: "" }
    });
}

export function renderSignUpPage(_req: Request, res: Response): void {
    res.render("signup", {
        pageTitle: "Sign Up | Optionyze",
        errorMessage: "",
        infoMessage: "",
        values: {}
    });
}

export function renderDashboardPage(req: Request, res: Response): void {
    res.render("dashboard", {
        pageTitle: "Dashboard | Optionyze",
        currentAccount: req.authAccount,
        infoMessage: req.query.message === "password-changed" ? "Password updated successfully." : ""
    });
}

export function renderChangePasswordPage(req: Request, res: Response): void {
    res.render("change-password", {
        pageTitle: "Change Password | Optionyze",
        errorMessage: "",
        infoMessage: req.authAccount?.mustChangePassword
            ? "Please change the temporary password before continuing."
            : "",
        currentAccount: req.authAccount
    });
}

export async function signUpAccount(req: Request, res: Response): Promise<void> {
    const objValues: AuthPageValues = {
        fullName: String(req.body?.fullName || "").trim(),
        email: String(req.body?.email || "").trim(),
        mobileNo: String(req.body?.mobileNo || "").trim(),
        telegramChatId: String(req.body?.telegramChatId || "").trim()
    };
    const vPassword = String(req.body?.password || "");
    const vConfirmPassword = String(req.body?.confirmPassword || "");
    const vValidationMessage = validateSignUp(objValues, vPassword, vConfirmPassword);

    if (!isPostgresConfigured()) {
        renderSignUpWithError(res, objValues, "DATABASE_URL is required before signup can be used.");
        return;
    }

    if (vValidationMessage) {
        renderSignUpWithError(res, objValues, vValidationMessage);
        return;
    }

    try {
        const objAccount = await createAccount({
            fullName: objValues.fullName || "",
            email: objValues.email || "",
            mobileNo: objValues.mobileNo || "",
            telegramChatId: objValues.telegramChatId || "",
            password: vPassword,
            isAdmin: false,
            isActive: true,
            mustChangePassword: false
        });

        const objSession = await createSession(objAccount.accountId);
        setSessionCookie(res, objSession.sessionId);
        res.redirect("/dashboard");
    }
    catch (objError) {
        renderSignUpWithError(res, objValues, getErrorMessage(objError, "Unable to create account right now."));
    }
}

export async function sendTelegramSignUpTest(req: Request, res: Response): Promise<void> {
    const vTelegramChatId = String(req.body?.telegramChatId || "").trim();
    if (!vTelegramChatId) {
        res.json({ status: "warning", message: "Telegram Chat ID is required." });
        return;
    }

    if (!/^-?\d{5,20}$/.test(vTelegramChatId)) {
        res.json({ status: "warning", message: "Please enter a valid Telegram Chat ID." });
        return;
    }

    const vBotToken = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
    if (!vBotToken) {
        res.json({ status: "warning", message: "App Telegram bot token is not configured." });
        return;
    }

    try {
        const objResponse = await fetch("https://api.telegram.org/bot" + encodeURIComponent(vBotToken) + "/sendMessage", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: vTelegramChatId,
                text: "Hi, This is a test Message, pls ignore."
            })
        });

        const objResult = await objResponse.json().catch(() => ({}));
        if (!objResponse.ok || objResult?.ok === false) {
            const vMessage = String(objResult?.description || "Unable to send Telegram test message.");
            res.json({ status: "warning", message: vMessage });
            return;
        }

        res.json({ status: "success", message: "Telegram test message sent successfully." });
    }
    catch (objError) {
        res.status(500).json({ status: "error", message: getErrorMessage(objError, "Unable to send Telegram test message right now.") });
    }
}

export async function signInAccount(req: Request, res: Response): Promise<void> {
    const vEmail = String(req.body?.email || "").trim();
    const vPassword = String(req.body?.password || "");

    if (!isPostgresConfigured()) {
        renderSignInWithError(res, { email: vEmail }, "DATABASE_URL is required before signin can be used.");
        return;
    }

    if (!vEmail || !vPassword) {
        renderSignInWithError(res, { email: vEmail }, "Email and password are required.");
        return;
    }

    try {
        const objAccount = await getAccountByEmail(vEmail);
        if (!objAccount || !objAccount.isActive) {
            renderSignInWithError(res, { email: vEmail }, "This account is inactive or does not exist.");
            return;
        }

        const vIsValidPassword = await verifyPassword(vPassword, objAccount.passwordHash);
        if (!vIsValidPassword) {
            renderSignInWithError(res, { email: vEmail }, "Incorrect password. Please check and try again.");
            return;
        }

        const objSession = await createSession(objAccount.accountId);
        setSessionCookie(res, objSession.sessionId);
        res.redirect(objAccount.mustChangePassword ? "/account/change-password" : "/dashboard");
    }
    catch (objError) {
        renderSignInWithError(res, { email: vEmail }, getErrorMessage(objError, "Unable to sign in right now."));
    }
}

export async function changePassword(req: Request, res: Response): Promise<void> {
    const objAccount = req.authAccount;
    if (!objAccount) {
        res.redirect("/signin");
        return;
    }

    const vCurrentPassword = String(req.body?.currentPassword || "");
    const vNewPassword = String(req.body?.newPassword || "");
    const vConfirmPassword = String(req.body?.confirmPassword || "");

    if (!vCurrentPassword || !vNewPassword || !vConfirmPassword) {
        renderChangePasswordWithError(res, req, "All password fields are required.");
        return;
    }

    const vIsCurrentPasswordValid = await verifyPassword(vCurrentPassword, objAccount.passwordHash);
    if (!vIsCurrentPasswordValid) {
        renderChangePasswordWithError(res, req, "Current password is incorrect.");
        return;
    }

    if (vNewPassword.length < 6) {
        renderChangePasswordWithError(res, req, "New password must be at least 6 characters long.");
        return;
    }

    if (vNewPassword !== vConfirmPassword) {
        renderChangePasswordWithError(res, req, "New password and confirm password do not match.");
        return;
    }

    if (vNewPassword === vCurrentPassword) {
        renderChangePasswordWithError(res, req, "Please choose a different new password.");
        return;
    }

    try {
        await updateAccountPassword(objAccount.accountId, vNewPassword, false);
        res.redirect("/dashboard?message=password-changed");
    }
    catch (objError) {
        renderChangePasswordWithError(res, req, getErrorMessage(objError, "Unable to update your password right now."));
    }
}

export async function signOutAccount(req: Request, res: Response): Promise<void> {
    if (req.authSessionId) {
        await deleteSession(req.authSessionId);
    }

    clearSessionCookie(res);
    res.redirect("/signin?message=signed-out");
}

function renderSignInWithError(res: Response, pValues: AuthPageValues, pErrorMessage: string): void {
    res.status(400).render("signin", {
        pageTitle: "Sign In | Optionyze",
        errorMessage: pErrorMessage,
        infoMessage: "",
        values: pValues
    });
}

function renderSignUpWithError(res: Response, pValues: AuthPageValues, pErrorMessage: string): void {
    res.status(400).render("signup", {
        pageTitle: "Sign Up | Optionyze",
        errorMessage: pErrorMessage,
        infoMessage: "",
        values: pValues
    });
}

function renderChangePasswordWithError(res: Response, req: Request, pErrorMessage: string): void {
    res.status(400).render("change-password", {
        pageTitle: "Change Password | Optionyze",
        errorMessage: pErrorMessage,
        infoMessage: req.authAccount?.mustChangePassword
            ? "Please change the temporary password before continuing."
            : "",
        currentAccount: req.authAccount
    });
}

function validateSignUp(pValues: AuthPageValues, pPassword: string, pConfirmPassword: string): string {
    if (!pValues.fullName || !pValues.email || !pValues.mobileNo || !pValues.telegramChatId || !pPassword || !pConfirmPassword) {
        return "All fields are required.";
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pValues.email)) {
        return "Please enter a valid email address.";
    }

    if (!/^\d{10,15}$/.test(pValues.mobileNo)) {
        return "Please enter a valid mobile number using 10 to 15 digits.";
    }

    if (!/^-?\d{5,20}$/.test(pValues.telegramChatId)) {
        return "Please enter a valid Telegram Chat ID.";
    }

    if (pPassword.length < 6) {
        return "Password must be at least 6 characters long.";
    }

    if (pPassword !== pConfirmPassword) {
        return "Password and confirm password do not match.";
    }

    return "";
}

function getErrorMessage(pError: unknown, pFallback: string): string {
    if (pError instanceof Error && pError.message) {
        return pError.message;
    }

    return pFallback;
}

function getInfoMessage(req: Request): string {
    if (req.query.message === "signed-out") {
        return "You have been signed out successfully.";
    }

    return "";
}

