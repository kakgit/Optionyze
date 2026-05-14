import type { Request, Response } from "express";
const DeltaRestClient = require("delta-rest-client");
import type { StrategyFoGreeksPaperService } from "../../strategies/strategy-fo-greeks-paper/service";
import type { StrategyFoGreeksPaperConfig } from "../../strategies/strategy-fo-greeks-paper/types";
import { gRollingOptionsTelegramEventTypes } from "../../strategies/rolling-options-lt-de/event-logger";
import {
    loadStrategyFoPaperProfile,
    saveStrategyFoPaperProfile,
    type StrategyFoPaperProfileRecord
} from "../../storage/strategyfo-paper-profile-store";

function getUserIdFromReq(pReq: Request): string {
    const vUserId = String(pReq.authAccount?.accountId || pReq.body?.userId || pReq.query?.userId || "demo-paper").trim();
    return vUserId || "demo-paper";
}

const gRollingFuturesTelegramEventTypes = gRollingOptionsTelegramEventTypes.filter((vEventType) => ![
    "renko_change_detected",
    "reentry_opened",
    "extra_future_added",
    "manual_action"
].includes(vEventType));

export function renderStrategyFoPaperPage(req: Request, res: Response): void {
    res.render("strategyfo-paper", {
        pageTitle: "StrategyFOGreeks Paper | Optionyze",
        currentAccount: req.authAccount,
        defaultUserId: req.authAccount?.accountId || "demo-paper"
    });
}

export function renderRollingFuturesPaperDemoPage(req: Request, res: Response): void {
    res.render("rolling-futures-pt-de", {
        pageTitle: "Rolling Futures Demo | Optionyze",
        currentAccount: req.authAccount,
        defaultUserId: req.authAccount?.accountId || "demo-paper"
    });
}

export function renderRollingFuturesLiveLongPage(req: Request, res: Response): void {
    res.render("rolling-futures-lt-long", {
        pageTitle: "Long Rolling Futures - Live | Optionyze",
        currentAccount: req.authAccount,
        defaultUserId: req.authAccount?.accountId || "demo-paper",
        rollingTelegramEventTypes: gRollingFuturesTelegramEventTypes
    });
}

export function renderRollingFuturesLiveShortPage(req: Request, res: Response): void {
    res.render("rolling-futures-lt-short", {
        pageTitle: "Short Rolling Futures - Live | Optionyze",
        currentAccount: req.authAccount,
        defaultUserId: req.authAccount?.accountId || "demo-paper",
        rollingTelegramEventTypes: gRollingFuturesTelegramEventTypes
    });
}

export function renderRollingFuturesLiveDualPage(req: Request, res: Response): void {
    res.render("rolling-futures-lt-dual", {
        pageTitle: "Dual Rolling Futures - Live | Optionyze",
        currentAccount: req.authAccount,
        defaultUserId: req.authAccount?.accountId || "demo-paper",
        rollingTelegramEventTypes: gRollingFuturesTelegramEventTypes
    });
}

export async function startStrategyFoPaper(req: Request, res: Response, pService: StrategyFoGreeksPaperService): Promise<void> {
    const objConfig = (req.body?.config || {}) as Partial<StrategyFoGreeksPaperConfig>;
    res.json(await pService.start({
        userId: getUserIdFromReq(req),
        apiKey: String(req.body?.apiKey || ""),
        apiSecret: String(req.body?.apiSecret || ""),
        config: objConfig
    }));
}

export async function stopStrategyFoPaper(req: Request, res: Response, pService: StrategyFoGreeksPaperService): Promise<void> {
    res.json(await pService.stop(getUserIdFromReq(req)));
}

export async function emergencyStopStrategyFoPaper(req: Request, res: Response, pService: StrategyFoGreeksPaperService): Promise<void> {
    res.json(await pService.emergencyStop(getUserIdFromReq(req), String(req.body?.reason || "Emergency stop")));
}

export function getStrategyFoPaperStatus(req: Request, res: Response, pService: StrategyFoGreeksPaperService): void {
    res.json({
        status: "success",
        data: pService.getStatus(getUserIdFromReq(req))
    });
}

export async function runStrategyFoPaperCycle(req: Request, res: Response, pService: StrategyFoGreeksPaperService): Promise<void> {
    res.json(await pService.runSingleCycle(getUserIdFromReq(req)));
}

export async function resetStrategyFoPaper(req: Request, res: Response, pService: StrategyFoGreeksPaperService): Promise<void> {
    res.json(await pService.resetPaperState(getUserIdFromReq(req)));
}

export async function getStrategyFoPaperProfile(req: Request, res: Response): Promise<void> {
    const vUserId = getUserIdFromReq(req);
    const objProfile = await loadStrategyFoPaperProfile(vUserId);
    res.json({
        status: "success",
        data: objProfile || {
            userId: vUserId,
            apiKey: "",
            apiSecret: "",
            referenceName: "",
            autoTraderEnabled: false,
            uiState: {},
            updatedAt: ""
        }
    });
}

export async function saveStrategyFoPaperProfileController(req: Request, res: Response): Promise<void> {
    const vUserId = getUserIdFromReq(req);
    const objExisting = await loadStrategyFoPaperProfile(vUserId);
    const objProfile: StrategyFoPaperProfileRecord = {
        userId: vUserId,
        apiKey: String(req.body?.apiKey ?? objExisting?.apiKey ?? ""),
        apiSecret: String(req.body?.apiSecret ?? objExisting?.apiSecret ?? ""),
        referenceName: String(req.body?.referenceName ?? objExisting?.referenceName ?? ""),
        autoTraderEnabled: Boolean(req.body?.autoTraderEnabled ?? objExisting?.autoTraderEnabled ?? false),
        uiState: (req.body?.uiState ?? objExisting?.uiState ?? {}) as Record<string, unknown>,
        updatedAt: ""
    };
    const objSaved = await saveStrategyFoPaperProfile(objProfile);
    res.json({ status: "success", data: objSaved });
}

export async function validateStrategyFoPaperLogin(req: Request, res: Response): Promise<void> {
    const vApiKey = String(req.body?.apiKey || "").trim();
    const vApiSecret = String(req.body?.apiSecret || "").trim();
    if (!vApiKey || !vApiSecret) {
        res.json({ status: "warning", message: "API key/secret are required.", data: [] });
        return;
    }

    try {
        const objClient = await new DeltaRestClient(vApiKey, vApiSecret);
        const objResponse = await objClient.apis.Wallet.getBalances();
        const objResult = JSON.parse(objResponse.data?.toString?.() || objResponse.data || "{}");
        if (objResult.success) {
            res.json({
                status: "success",
                message: "Valid login, balance fetched!",
                data: Array.isArray(objResult.result) ? objResult.result : []
            });
            return;
        }
        res.json({
            status: "warning",
            message: objResult.message || "Wallet fetch failed.",
            data: objResult
        });
    }
    catch (objError) {
        res.json({
            status: "danger",
            message: "Error at user login.",
            data: objError
        });
    }
}
