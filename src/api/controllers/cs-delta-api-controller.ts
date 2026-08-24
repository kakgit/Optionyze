import type { Request, Response } from "express";
import {
    createCsDeltaApiProfile,
    deleteCsDeltaApiProfile,
    listCsDeltaApiProfiles,
    updateCsDeltaApiProfile
} from "../../storage/cs-delta-api-profile-store";

export async function listCsDeltaApiProfilesController(req: Request, res: Response): Promise<void> {
    const vAccountId = getAccountId(req);
    if (!vAccountId) {
        res.status(401).json({ status: "warning", message: "Please sign in to continue." });
        return;
    }

    try {
        const objProfiles = await listCsDeltaApiProfiles(vAccountId);
        res.json({ status: "success", data: objProfiles });
    }
    catch (objError) {
        res.status(500).json({ status: "danger", message: getErrorMessage(objError, "Unable to load API credentials.") });
    }
}

export async function createCsDeltaApiProfileController(req: Request, res: Response): Promise<void> {
    const vAccountId = getAccountId(req);
    if (!vAccountId) {
        res.status(401).json({ status: "warning", message: "Please sign in to continue." });
        return;
    }

    try {
        const objInput = readCreateInput(req, vAccountId);
        validateCreateInput(objInput);
        const objProfile = await createCsDeltaApiProfile(objInput);
        res.json({ status: "success", message: "API credentials saved successfully.", data: objProfile });
    }
    catch (objError) {
        res.status(400).json({ status: "warning", message: getErrorMessage(objError, "Unable to save API credentials.") });
    }
}

export async function updateCsDeltaApiProfileController(req: Request, res: Response): Promise<void> {
    const vAccountId = getAccountId(req);
    const vProfileId = String(req.params.profileId || "").trim();
    if (!vAccountId) {
        res.status(401).json({ status: "warning", message: "Please sign in to continue." });
        return;
    }

    if (!vProfileId) {
        res.status(400).json({ status: "warning", message: "Profile id is required." });
        return;
    }

    try {
        const objInput = readUpdateInput(req, vAccountId);
        validateUpdateInput(objInput);
        const objProfile = await updateCsDeltaApiProfile(vProfileId, objInput);
        res.json({ status: "success", message: "API credentials updated successfully.", data: objProfile });
    }
    catch (objError) {
        res.status(400).json({ status: "warning", message: getErrorMessage(objError, "Unable to update API credentials.") });
    }
}

export async function deleteCsDeltaApiProfileController(req: Request, res: Response): Promise<void> {
    const vAccountId = getAccountId(req);
    const vProfileId = String(req.params.profileId || "").trim();
    if (!vAccountId) {
        res.status(401).json({ status: "warning", message: "Please sign in to continue." });
        return;
    }

    if (!vProfileId) {
        res.status(400).json({ status: "warning", message: "Profile id is required." });
        return;
    }

    try {
        await deleteCsDeltaApiProfile(vAccountId, vProfileId);
        res.json({ status: "success", message: "API credentials deleted successfully." });
    }
    catch (objError) {
        res.status(400).json({ status: "warning", message: getErrorMessage(objError, "Unable to delete API credentials.") });
    }
}

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

function readCreateInput(req: Request, pAccountId: string) {
    return {
        accountId: pAccountId,
        userName: String(req.body?.userName || "").trim(),
        deltaApiKey: String(req.body?.deltaApiKey || "").trim(),
        deltaApiSecret: String(req.body?.deltaApiSecret || "").trim(),
        coinswitchApiKey: String(req.body?.coinswitchApiKey || "").trim(),
        coinswitchApiSecret: String(req.body?.coinswitchApiSecret || "").trim()
    };
}

function readUpdateInput(req: Request, pAccountId: string) {
    return {
        accountId: pAccountId,
        userName: String(req.body?.userName || "").trim(),
        deltaApiKey: String(req.body?.deltaApiKey || "").trim(),
        deltaApiSecret: String(req.body?.deltaApiSecret || "").trim(),
        coinswitchApiKey: String(req.body?.coinswitchApiKey || "").trim(),
        coinswitchApiSecret: String(req.body?.coinswitchApiSecret || "").trim()
    };
}

function validateCreateInput(pInput: {
    userName: string;
    deltaApiKey: string;
    deltaApiSecret: string;
    coinswitchApiKey: string;
    coinswitchApiSecret: string;
}): void {
    if (!pInput.userName) {
        throw new Error("User Name is required.");
    }
    if (!pInput.deltaApiKey || !pInput.deltaApiSecret) {
        throw new Error("Delta API Key and API Secret are required.");
    }
    if (!pInput.coinswitchApiKey || !pInput.coinswitchApiSecret) {
        throw new Error("CoinSwitch API Key and API Secret are required.");
    }
}

function validateUpdateInput(pInput: { userName: string }): void {
    if (!pInput.userName) {
        throw new Error("User Name is required.");
    }
}

function getErrorMessage(pError: unknown, pFallback: string): string {
    if (pError instanceof Error && pError.message) {
        return pError.message;
    }

    if (pError && typeof pError === "object") {
        const objError = pError as { message?: unknown; error?: unknown };
        const vMessage = String(objError.message || objError.error || "").trim();
        if (vMessage) {
            return vMessage;
        }
    }

    return pFallback;
}
