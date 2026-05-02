import type { NextFunction, Request, Response } from "express";
import { getAccountById } from "../../storage/accounts-store";
import { deleteSession, getSessionById, getSessionCookieName } from "../../storage/sessions-store";

export async function attachAuthContext(req: Request, res: Response, next: NextFunction): Promise<void> {
    req.authAccount = null;
    req.authSessionId = null;

    try {
        const vSessionId = readCookie(req, getSessionCookieName());
        if (!vSessionId) {
            res.locals.currentAccount = null;
            next();
            return;
        }

        const objSession = await getSessionById(vSessionId);
        if (!objSession) {
            clearSessionCookie(res);
            res.locals.currentAccount = null;
            next();
            return;
        }

        const objAccount = await getAccountById(objSession.accountId);
        if (!objAccount || !objAccount.isActive) {
            await deleteSession(vSessionId);
            clearSessionCookie(res);
            res.locals.currentAccount = null;
            next();
            return;
        }

        req.authAccount = objAccount;
        req.authSessionId = objSession.sessionId;
        res.locals.currentAccount = objAccount;
        next();
    }
    catch (objError) {
        console.error("[auth] failed to attach auth context:", objError);
        res.locals.currentAccount = null;
        res.status(503).send("Database connection is temporarily unavailable. Please retry.");
    }
}

export function requireGuestPage(req: Request, res: Response, next: NextFunction): void {
    if (req.authAccount) {
        res.redirect(req.authAccount.mustChangePassword ? "/account/change-password" : "/dashboard");
        return;
    }

    next();
}

export function requireAuthPage(req: Request, res: Response, next: NextFunction): void {
    if (!req.authAccount) {
        res.redirect("/signin");
        return;
    }

    next();
}

export function requireAdminPage(req: Request, res: Response, next: NextFunction): void {
    if (!req.authAccount) {
        res.redirect("/signin");
        return;
    }

    if (!req.authAccount.isAdmin) {
        res.redirect("/dashboard");
        return;
    }

    next();
}

export function requireFreshPasswordPage(req: Request, res: Response, next: NextFunction): void {
    if (req.authAccount?.mustChangePassword && req.path !== "/account/change-password") {
        res.redirect("/account/change-password");
        return;
    }

    next();
}

export function requireAuthApi(req: Request, res: Response, next: NextFunction): void {
    if (!req.authAccount) {
        res.status(401).json({ status: "warning", message: "Please sign in to continue." });
        return;
    }

    next();
}

export function requireFreshPasswordApi(req: Request, res: Response, next: NextFunction): void {
    if (req.authAccount?.mustChangePassword) {
        res.status(403).json({ status: "warning", message: "Please change your password before using the app." });
        return;
    }

    next();
}

export function requireAdminApi(req: Request, res: Response, next: NextFunction): void {
    if (!req.authAccount) {
        res.status(401).json({ status: "warning", message: "Please sign in to continue." });
        return;
    }

    if (!req.authAccount.isAdmin) {
        res.status(403).json({ status: "warning", message: "Admin access is required." });
        return;
    }

    next();
}

export function setSessionCookie(res: Response, pSessionId: string): void {
    const vSecure = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    res.cookie(getSessionCookieName(), pSessionId, {
        httpOnly: true,
        sameSite: "lax",
        secure: vSecure,
        path: "/",
        expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    });
}

export function clearSessionCookie(res: Response): void {
    res.clearCookie(getSessionCookieName(), {
        httpOnly: true,
        sameSite: "lax",
        secure: String(process.env.NODE_ENV || "").toLowerCase() === "production",
        path: "/"
    });
}

function readCookie(req: Request, pCookieName: string): string {
    const vCookieHeader = String(req.headers.cookie || "");
    if (!vCookieHeader) {
        return "";
    }

    const arrPairs = vCookieHeader.split(";");
    for (const vPair of arrPairs) {
        const vIndex = vPair.indexOf("=");
        if (vIndex <= 0) {
            continue;
        }

        const vKey = decodeURIComponent(vPair.slice(0, vIndex).trim());
        if (vKey !== pCookieName) {
            continue;
        }

        return decodeURIComponent(vPair.slice(vIndex + 1).trim());
    }

    return "";
}
