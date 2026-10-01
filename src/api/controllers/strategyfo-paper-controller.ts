import type { Request, Response } from "express";

const gRollingFuturesTelegramEventTypes = [
    "engine_started",
    "engine_stopped",
    "engine_error",
    "strategy_executed",
    "future_opened",
    "future_closed",
    "option_opened",
    "reentry_opened",
    "option_closed",
    "sl_triggered",
    "tp_triggered",
    "kill_switch"
] as const;

export function renderCoveredOptionsPage(req: Request, res: Response): void {
    res.render("covered-options", {
        pageTitle: "Covered Options - Live | Optionyze",
        pageVariant: "live",
        currentAccount: req.authAccount,
        defaultUserId: req.authAccount?.accountId || "demo-paper",
        rollingTelegramEventTypes: gRollingFuturesTelegramEventTypes
    });
}

export function renderStrangleOptionsPage(req: Request, res: Response): void {
    res.render("covered-options", {
        pageTitle: "Strangle Options - Live | Optionyze",
        pageVariant: "strangle",
        currentAccount: req.authAccount,
        defaultUserId: req.authAccount?.accountId || "demo-paper",
        rollingTelegramEventTypes: gRollingFuturesTelegramEventTypes
    });
}

export function renderStrangleDemoPage(req: Request, res: Response): void {
    res.render("covered-options", {
        pageTitle: "Strangle Demo | Optionyze",
        pageVariant: "strangle-demo",
        currentAccount: req.authAccount,
        defaultUserId: req.authAccount?.accountId || "demo-paper",
        rollingTelegramEventTypes: gRollingFuturesTelegramEventTypes
    });
}

export function renderRenkoOptionsPage(req: Request, res: Response): void {
    res.render("covered-options", {
        pageTitle: "Renko Options - Live | Optionyze",
        pageVariant: "renko",
        currentAccount: req.authAccount,
        defaultUserId: req.authAccount?.accountId || "demo-paper",
        rollingTelegramEventTypes: gRollingFuturesTelegramEventTypes
    });
}

export function renderOptionsDemoPage(req: Request, res: Response): void {
    res.render("covered-options", {
        pageTitle: "Options Demo | Optionyze",
        pageVariant: "demo",
        currentAccount: req.authAccount,
        defaultUserId: req.authAccount?.accountId || "demo-paper"
    });
}

export function renderFuturesScalperPage(req: Request, res: Response): void {
    res.render("futures-scalper", {
        pageTitle: "Futures Scalper | Optionyze",
        pageVariant: "demo",
        currentAccount: req.authAccount,
        defaultUserId: req.authAccount?.accountId || "demo-paper"
    });
}

// Calendar Spread renders its own dedicated view (src/views/calendar-spread.ejs)
// rather than the shared covered-options template, so the Calendar Spread markup
// is fully independent from every other page.
export function renderCalendarSpreadPage(req: Request, res: Response): void {
    res.render("calendar-spread", {
        pageTitle: "Calendar Spread | Optionyze",
        pageVariant: "demo",
        currentAccount: req.authAccount,
        defaultUserId: req.authAccount?.accountId || "demo-paper"
    });
}
