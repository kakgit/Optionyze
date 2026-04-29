import type { Request, Response } from "express";
import { getAccountById, updateAccount } from "../../storage/accounts-store";

export function renderMyProfilePage(req: Request, res: Response): void {
    res.render("account-profile", {
        pageTitle: "My Profile | Optionyze",
        currentAccount: req.authAccount,
        errorMessage: "",
        infoMessage: req.query.message === "profile-saved" ? "Profile updated successfully." : ""
    });
}

export async function updateMyProfile(req: Request, res: Response): Promise<void> {
    const objAccount = req.authAccount;
    if (!objAccount) {
        res.redirect("/signin");
        return;
    }

    const vFullName = String(req.body?.fullName || "").trim();
    const vMobileNo = String(req.body?.mobileNo || "").trim();
    const vTelegramChatId = String(req.body?.telegramChatId || "").trim();

    if (!vFullName || !vMobileNo) {
        renderProfileError(res, objAccount, "Full name and mobile number are required.");
        return;
    }

    if (!/^\d{10,15}$/.test(vMobileNo)) {
        renderProfileError(res, objAccount, "Please enter a valid mobile number using 10 to 15 digits.");
        return;
    }

    if (vTelegramChatId && !/^-?\d{5,20}$/.test(vTelegramChatId)) {
        renderProfileError(res, objAccount, "Please enter a valid Telegram Chat ID.");
        return;
    }

    try {
        await updateAccount(objAccount.accountId, {
            fullName: vFullName,
            email: objAccount.email,
            mobileNo: vMobileNo,
            telegramChatId: vTelegramChatId,
            isActive: objAccount.isActive,
            isAdmin: objAccount.isAdmin,
            mustChangePassword: objAccount.mustChangePassword
        });

        res.redirect("/account/profile?message=profile-saved");
    }
    catch (objError) {
        renderProfileError(res, objAccount, getErrorMessage(objError, "Unable to update profile right now."));
    }
}

export async function sendTelegramProfileTest(req: Request, res: Response): Promise<void> {
    const objAccount = req.authAccount;
    if (!objAccount) {
        res.status(401).json({ status: "warning", message: "Please sign in to continue." });
        return;
    }

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

export function renderDeltaExchangeApiPage(req: Request, res: Response): void {
    res.render("account-delta-api", {
        pageTitle: "Delta Exchange API | Optionyze",
        currentAccount: req.authAccount,
        defaultUserId: req.authAccount?.accountId || ""
    });
}

async function renderProfileError(res: Response, pAccount: NonNullable<Request["authAccount"]>, pMessage: string): Promise<void> {
    const objFreshAccount = await getAccountById(pAccount.accountId);
    res.status(400).render("account-profile", {
        pageTitle: "My Profile | Optionyze",
        currentAccount: objFreshAccount || pAccount,
        errorMessage: pMessage,
        infoMessage: ""
    });
}

function getErrorMessage(pError: unknown, pFallback: string): string {
    if (pError instanceof Error && pError.message) {
        return pError.message;
    }

    return pFallback;
}


