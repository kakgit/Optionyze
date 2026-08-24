import type { Request, Response } from "express";
import { getCsDeltaApiProfile } from "../../storage/cs-delta-api-profile-store";
import {
    createCsDeltaImportedPositions,
    deleteCsDeltaImportedPosition,
    listCsDeltaImportedPositions,
    type CreateCsDeltaImportedPositionInput,
    type ImportedPositionSource
} from "../../storage/cs-delta-imported-position-store";
import {
    fetchCoinswitchExchangePositions,
    fetchCoinswitchOptionsAvailableBalance,
    fetchDeltaExchangePositions,
    fetchDeltaOptionsAvailableBalance,
    parseOptionSymbol
} from "../../services/exchange-positions-client";

function getAccountId(req: Request): string {
    const vOwnAccountId = String(req.authAccount?.accountId || "").trim();
    const vBodyTarget = typeof req.body?.targetUserId === "string" ? req.body.targetUserId : "";
    const vQueryTarget = typeof req.query?.targetUserId === "string" ? req.query.targetUserId : "";
    const vTargetAccountId = String(vBodyTarget || vQueryTarget || "").trim();
    if ((req.authAccount?.isAdmin || req.authAccount?.isVerifier) && vTargetAccountId) {
        return vTargetAccountId;
    }
    return vOwnAccountId;
}

function getErrorMessage(pError: unknown, pFallback: string): string {
    if (pError instanceof Error && String(pError.message || "").trim()) {
        return pError.message;
    }
    return pFallback;
}

export async function listExchangePositionsController(req: Request, res: Response): Promise<void> {
    const vAccountId = getAccountId(req);
    if (!vAccountId) {
        res.status(401).json({ status: "warning", message: "Please sign in to continue." });
        return;
    }

    try {
        const vProfileId = String(req.query.profileId || "").trim();
        if (!vProfileId) {
            res.status(400).json({ status: "warning", message: "Select a username/API profile first." });
            return;
        }
        const objProfile = await getCsDeltaApiProfile(vAccountId, vProfileId);
        if (!objProfile) {
            res.status(404).json({ status: "warning", message: "API credential profile not found." });
            return;
        }

        const vUnderlying = String(req.query.underlyingAssetSymbol || "").trim();
        const [objDelta, objCoinSwitch] = await Promise.all([
            fetchDeltaExchangePositions(
                { deltaApiKey: objProfile.deltaApiKey, deltaApiSecret: objProfile.deltaApiSecret },
                vUnderlying
            ),
            fetchCoinswitchExchangePositions(
                { coinswitchApiKey: objProfile.coinswitchApiKey, coinswitchApiSecret: objProfile.coinswitchApiSecret },
                "USDT"
            )
        ]);

        res.json({
            status: "success",
            message: "Exchange positions loaded.",
            data: {
                userName: objProfile.userName,
                delta: {
                    ok: objDelta.ok,
                    error: objDelta.error,
                    ipWhitelistRequired: objDelta.ipWhitelistRequired,
                    clientIp: objDelta.clientIp,
                    positions: objDelta.positions
                },
                coinswitch: {
                    ok: objCoinSwitch.ok,
                    error: objCoinSwitch.error,
                    positions: objCoinSwitch.positions
                }
            }
        });
    }
    catch (objError) {
        res.status(500).json({
            status: "danger",
            message: getErrorMessage(objError, "Unable to load exchange positions.")
        });
    }
}

interface ImportPositionBodyRow {
    source?: string;
    symbol?: string;
    side?: string;
    baseCoin?: string;
    strike?: number | string;
    size?: number | string;
    entryPrice?: number | string;
    markPrice?: number | string;
    positionSide?: string;
}

export async function importExchangePositionsController(req: Request, res: Response): Promise<void> {
    const vAccountId = getAccountId(req);
    if (!vAccountId) {
        res.status(401).json({ status: "warning", message: "Please sign in to continue." });
        return;
    }

    try {
        const vProfileId = String(req.body?.profileId || "").trim();
        const arrRaw = Array.isArray(req.body?.positions) ? req.body.positions as ImportPositionBodyRow[] : [];
        if (!vProfileId) {
            res.status(400).json({ status: "warning", message: "Select a username/API profile first." });
            return;
        }
        if (!arrRaw.length) {
            res.status(400).json({ status: "warning", message: "Select at least one exchange position to import." });
            return;
        }

        const objProfile = await getCsDeltaApiProfile(vAccountId, vProfileId);
        if (!objProfile) {
            res.status(404).json({ status: "warning", message: "API credential profile not found." });
            return;
        }

        const arrInputs: CreateCsDeltaImportedPositionInput[] = [];
        for (const objRaw of arrRaw) {
            const vSourceRaw = String(objRaw.source || "").trim().toLowerCase();
            if (vSourceRaw !== "delta" && vSourceRaw !== "coinswitch") {
                continue;
            }
            const vSource: ImportedPositionSource = vSourceRaw === "coinswitch" ? "coinswitch" : "delta";
            const vSymbol = String(objRaw.symbol || "").trim().toUpperCase();
            const objParsed = parseOptionSymbol(vSymbol);
            if (!objParsed) {
                continue;
            }
            const vSideRaw = String(objRaw.side || "").trim().toLowerCase();
            const vSide = vSideRaw === "call" ? "call" : (vSideRaw === "put" ? "put" : objParsed.side);
            const vSize = Number(objRaw.size);
            if (!(Number.isFinite(vSize) && vSize > 0)) {
                continue;
            }
            arrInputs.push({
                accountId: vAccountId,
                profileId: objProfile.profileId,
                userName: objProfile.userName,
                source: vSource,
                side: vSide,
                baseCoin: String(objRaw.baseCoin || objParsed.baseCoin).toUpperCase(),
                symbol: vSymbol,
                strike: Number.isFinite(Number(objRaw.strike)) ? Number(objRaw.strike) : objParsed.strike,
                size: vSize,
                entryPrice: Number(objRaw.entryPrice || 0),
                markPrice: Number(objRaw.markPrice || 0),
                positionSide: String(objRaw.positionSide || "long").trim().toLowerCase() === "short" ? "short" as const : "long" as const
            });
        }

        if (!arrInputs.length) {
            res.status(400).json({ status: "warning", message: "No valid option positions found in the selection." });
            return;
        }

        const objResult = await createCsDeltaImportedPositions(arrInputs);
        res.json({
            status: "success",
            message: `Imported ${objResult.saved.length} position${objResult.saved.length === 1 ? "" : "s"}`
                + (objResult.skipped > 0 ? `; ${objResult.skipped} duplicate${objResult.skipped === 1 ? "" : "s"} skipped.` : "."),
            data: {
                saved: objResult.saved.length,
                skipped: objResult.skipped
            }
        });
    }
    catch (objError) {
        res.status(500).json({
            status: "danger",
            message: getErrorMessage(objError, "Unable to import positions.")
        });
    }
}

export async function listImportedPositionsController(req: Request, res: Response): Promise<void> {
    const vAccountId = getAccountId(req);
    if (!vAccountId) {
        res.status(401).json({ status: "warning", message: "Please sign in to continue." });
        return;
    }

    try {
        const vProfileId = String(req.query.profileId || "").trim();
        const arrPositions = await listCsDeltaImportedPositions(vAccountId, vProfileId);
        res.json({
            status: "success",
            message: `Loaded ${arrPositions.length} imported position${arrPositions.length === 1 ? "" : "s"}.`,
            data: {
                positions: arrPositions
            }
        });
    }
    catch (objError) {
        res.status(500).json({
            status: "danger",
            message: getErrorMessage(objError, "Unable to load imported positions.")
        });
    }
}

export async function deleteImportedPositionController(req: Request, res: Response): Promise<void> {
    const vAccountId = getAccountId(req);
    if (!vAccountId) {
        res.status(401).json({ status: "warning", message: "Please sign in to continue." });
        return;
    }

    const vImportId = String(req.params.importId || "").trim();
    if (!vImportId) {
        res.status(400).json({ status: "warning", message: "Import id is required." });
        return;
    }

    try {
        await deleteCsDeltaImportedPosition(vAccountId, vImportId);
        res.json({
            status: "success",
            message: "Imported position removed."
        });
    }
    catch (objError) {
        res.status(500).json({
            status: "danger",
            message: getErrorMessage(objError, "Unable to remove imported position.")
        });
    }
}

export async function getWalletBalancesController(req: Request, res: Response): Promise<void> {
    const vAccountId = getAccountId(req);
    if (!vAccountId) {
        res.status(401).json({ status: "warning", message: "Please sign in to continue." });
        return;
    }

    try {
        const vProfileId = String(req.query.profileId || "").trim();
        if (!vProfileId) {
            res.status(400).json({ status: "warning", message: "Select a username/API profile first." });
            return;
        }
        const objProfile = await getCsDeltaApiProfile(vAccountId, vProfileId);
        if (!objProfile) {
            res.status(404).json({ status: "warning", message: "API credential profile not found." });
            return;
        }

        const [objDelta, objCoinSwitch] = await Promise.all([
            fetchDeltaOptionsAvailableBalance({ deltaApiKey: objProfile.deltaApiKey, deltaApiSecret: objProfile.deltaApiSecret }),
            fetchCoinswitchOptionsAvailableBalance({ coinswitchApiKey: objProfile.coinswitchApiKey, coinswitchApiSecret: objProfile.coinswitchApiSecret })
        ]);

        res.json({
            status: "success",
            message: "Wallet balances loaded.",
            data: {
                userName: objProfile.userName,
                delta: {
                    ok: objDelta.ok,
                    error: objDelta.error,
                    ipWhitelistRequired: objDelta.ipWhitelistRequired,
                    clientIp: objDelta.clientIp,
                    availableBalance: objDelta.availableBalance,
                    currency: objDelta.currency
                },
                coinswitch: {
                    ok: objCoinSwitch.ok,
                    error: objCoinSwitch.error,
                    availableBalance: objCoinSwitch.availableBalance,
                    currency: objCoinSwitch.currency
                }
            }
        });
    }
    catch (objError) {
        res.status(500).json({
            status: "danger",
            message: getErrorMessage(objError, "Unable to load wallet balances.")
        });
    }
}

