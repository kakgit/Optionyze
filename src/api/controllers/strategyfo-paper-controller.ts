import type { Request, Response } from "express";
import type { DirectionalOptionsDemoService } from "../../strategies/directional-options-demo/service";
import type { DirectionalOptionsDemoConfig } from "../../strategies/directional-options-demo/types";

function getUserIdFromReq(pReq: Request): string {
    const vUserId = String(pReq.authAccount?.accountId || pReq.body?.userId || pReq.query?.userId || "demo-paper").trim();
    return vUserId || "demo-paper";
}

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

export function renderOptionsScalperPage(req: Request, res: Response): void {
    res.render("options-scalper", {
        pageTitle: "Options-Scalper - Paper | Optionyze",
        currentAccount: req.authAccount,
        defaultUserId: req.authAccount?.accountId || "demo-paper",
        rollingTelegramEventTypes: gRollingFuturesTelegramEventTypes
    });
}

export function renderDirectionalOptionsPage(req: Request, res: Response): void {
    res.render("directional-options", {
        pageTitle: "Directional Options - Demo | Optionyze",
        currentAccount: req.authAccount,
        defaultUserId: req.authAccount?.accountId || "demo-paper",
        rollingTelegramEventTypes: gRollingFuturesTelegramEventTypes
    });
}

function readDirectionalDemoConfig(req: Request): Partial<DirectionalOptionsDemoConfig> {
    const input = (req.body?.config || {}) as Partial<DirectionalOptionsDemoConfig>;
    return input;
}

export function getDirectionalOptionsDemoStatus(req: Request, res: Response, pService: DirectionalOptionsDemoService): void {
    res.json({
        status: "success",
        data: pService.getStatus(getUserIdFromReq(req))
    });
}

export async function startDirectionalOptionsDemo(req: Request, res: Response, pService: DirectionalOptionsDemoService): Promise<void> {
    const result = await pService.start(
        getUserIdFromReq(req),
        String(req.body?.profileId || "").trim(),
        readDirectionalDemoConfig(req)
    );
    res.json(result);
}

export async function stopDirectionalOptionsDemo(req: Request, res: Response, pService: DirectionalOptionsDemoService): Promise<void> {
    res.json(await pService.stop(getUserIdFromReq(req), String(req.body?.reason || "Manual stop")));
}

export async function runDirectionalOptionsDemoCycle(req: Request, res: Response, pService: DirectionalOptionsDemoService): Promise<void> {
    res.json(await pService.runSingleCycle(
        getUserIdFromReq(req),
        String(req.body?.profileId || "").trim(),
        readDirectionalDemoConfig(req)
    ));
}

export async function emergencyStopDirectionalOptionsDemo(req: Request, res: Response, pService: DirectionalOptionsDemoService): Promise<void> {
    res.json(await pService.emergencyStop(getUserIdFromReq(req), String(req.body?.reason || "Emergency stop")));
}

export async function resetDirectionalOptionsDemo(req: Request, res: Response, pService: DirectionalOptionsDemoService): Promise<void> {
    res.json(await pService.reset(getUserIdFromReq(req)));
}

export async function closeDirectionalOptionsDemoPosition(req: Request, res: Response, pService: DirectionalOptionsDemoService): Promise<void> {
    res.json(await pService.manualClosePosition(
        getUserIdFromReq(req),
        String(req.params?.positionId || req.body?.positionId || "").trim()
    ));
}
