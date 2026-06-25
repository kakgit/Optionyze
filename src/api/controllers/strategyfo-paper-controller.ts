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

export function renderOptionsDemoPage(req: Request, res: Response): void {
    res.render("covered-options", {
        pageTitle: "Options Demo | Optionyze",
        pageVariant: "demo",
        currentAccount: req.authAccount,
        defaultUserId: req.authAccount?.accountId || "demo-paper",
        rollingTelegramEventTypes: gRollingFuturesTelegramEventTypes
    });
}
