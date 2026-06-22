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

export function renderRollingFuturesLiveDualPage(req: Request, res: Response): void {
    res.render("rolling-futures-lt-dual", {
        pageTitle: "Delta Neutral - Live | Optionyze",
        currentAccount: req.authAccount,
        defaultUserId: req.authAccount?.accountId || "demo-paper",
        rollingTelegramEventTypes: gRollingFuturesTelegramEventTypes
    });
}

export function renderCoveredOptionsPage(req: Request, res: Response): void {
    res.render("covered-options", {
        pageTitle: "Covered Options - Live | Optionyze",
        currentAccount: req.authAccount,
        defaultUserId: req.authAccount?.accountId || "demo-paper",
        rollingTelegramEventTypes: gRollingFuturesTelegramEventTypes
    });
}
