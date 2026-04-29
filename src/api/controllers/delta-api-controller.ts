import type { Request, Response } from "express";
const DeltaRestClient = require("delta-rest-client");
import {
    createDeltaApiProfile,
    deleteDeltaApiProfile,
    getDeltaApiProfile,
    listDeltaApiProfiles,
    updateDeltaApiProfile
} from "../../storage/delta-api-profile-store";

export async function listDeltaApiProfilesController(req: Request, res: Response): Promise<void> {
    const vAccountId = getAccountId(req);
    if (!vAccountId) {
        res.status(401).json({ status: "warning", message: "Please sign in to continue." });
        return;
    }

    try {
        const objProfiles = await listDeltaApiProfiles(vAccountId);
        res.json({ status: "success", data: objProfiles });
    }
    catch (objError) {
        res.status(500).json({ status: "danger", message: getErrorMessage(objError, "Unable to load API credentials.") });
    }
}

export async function createDeltaApiProfileController(req: Request, res: Response): Promise<void> {
    const vAccountId = getAccountId(req);
    if (!vAccountId) {
        res.status(401).json({ status: "warning", message: "Please sign in to continue." });
        return;
    }

    try {
        const objInput = readCreateInput(req, vAccountId);
        validateCreateInput(objInput);
        const objProfile = await createDeltaApiProfile(objInput);
        res.json({ status: "success", message: "API credentials saved successfully.", data: objProfile });
    }
    catch (objError) {
        res.status(400).json({ status: "warning", message: getErrorMessage(objError, "Unable to save API credentials.") });
    }
}

export async function updateDeltaApiProfileController(req: Request, res: Response): Promise<void> {
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
        const objProfile = await updateDeltaApiProfile(vProfileId, objInput);
        res.json({ status: "success", message: "API credentials updated successfully.", data: objProfile });
    }
    catch (objError) {
        res.status(400).json({ status: "warning", message: getErrorMessage(objError, "Unable to update API credentials.") });
    }
}

export async function deleteDeltaApiProfileController(req: Request, res: Response): Promise<void> {
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
        await deleteDeltaApiProfile(vAccountId, vProfileId);
        res.json({ status: "success", message: "API credentials deleted successfully." });
    }
    catch (objError) {
        res.status(400).json({ status: "warning", message: getErrorMessage(objError, "Unable to delete API credentials.") });
    }
}

export async function testDeltaApiProfileLoginController(req: Request, res: Response): Promise<void> {
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
        const objProfile = await getDeltaApiProfile(vAccountId, vProfileId);
        if (!objProfile) {
            throw new Error("API credential profile not found.");
        }

        const objClient = await new DeltaRestClient(objProfile.apiKey, objProfile.apiSecret);
        const objResponse = await objClient.apis.Wallet.getBalances();
        const objResult = JSON.parse(objResponse.data?.toString?.() || objResponse.data || "{}");
        if (objResult.success) {
            res.json({
                status: "success",
                message: `Delta login test succeeded for ${objProfile.referenceName}.`,
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
        const objFriendly = await getFriendlyDeltaLoginError(objError);
        res.json({
            status: objFriendly.status,
            message: objFriendly.message,
            data: objFriendly.data
        });
    }
}

function getAccountId(req: Request): string {
    return String(req.authAccount?.accountId || "").trim();
}

function readCreateInput(req: Request, pAccountId: string) {
    return {
        accountId: pAccountId,
        referenceName: String(req.body?.referenceName || "").trim(),
        apiKey: String(req.body?.apiKey || "").trim(),
        apiSecret: String(req.body?.apiSecret || "").trim()
    };
}

function readUpdateInput(req: Request, pAccountId: string) {
    return {
        accountId: pAccountId,
        referenceName: String(req.body?.referenceName || "").trim(),
        apiKey: String(req.body?.apiKey || "").trim(),
        apiSecret: String(req.body?.apiSecret || "").trim()
    };
}

function validateCreateInput(pInput: { referenceName: string; apiKey: string; apiSecret: string }): void {
    if (!pInput.referenceName || !pInput.apiKey || !pInput.apiSecret) {
        throw new Error("Reference Name, API Key, and API Secret are required.");
    }
}

function validateUpdateInput(pInput: { referenceName: string; apiKey: string }): void {
    if (!pInput.referenceName || !pInput.apiKey) {
        throw new Error("Reference Name and API Key are required.");
    }
}

async function getFriendlyDeltaLoginError(pError: unknown): Promise<{ status: string; message: string; data: unknown }> {
    const vRawMessage = getErrorMessage(pError, "Error testing Delta login.");
    const vNormalized = vRawMessage.toLowerCase();
    const objDeltaPayload = getDeltaErrorPayload(pError);
    const vDeltaCode = String(objDeltaPayload?.error?.code || "").trim();
    const vDeltaClientIp = String(objDeltaPayload?.error?.context?.client_ip || "").trim();

    if (vDeltaCode === "ip_not_whitelisted_for_api_key") {
        return {
            status: "warning",
            message: vDeltaClientIp
                ? `Delta rejected this login because the API key is not whitelisted for client IP ${vDeltaClientIp}.`
                : "Delta rejected this login because the API key is not whitelisted for the current client IP.",
            data: pError
        };
    }

    if (vNormalized.includes("unauthorized") || vNormalized.includes("forbidden") || vNormalized.includes("ip")) {
        const vOutboundIp = await getOutboundPublicIp();
        const vIpSuffix = vOutboundIp
            ? ` Server public IP: ${vOutboundIp}. If you use Delta IP whitelisting, confirm this exact IP is allowed.`
            : " Check the Delta API whitelist / IP restriction settings if you use IP whitelisting.";

        return {
            status: "warning",
            message: "Delta rejected this login request. This can happen because of an invalid API key/secret, missing API permission, or IP restriction mismatch." + vIpSuffix,
            data: pError
        };
    }

    return {
        status: "danger",
        message: vRawMessage,
        data: pError
    };
}

function getDeltaErrorPayload(pError: unknown): { error?: { code?: string; context?: { client_ip?: string } } } | null {
    const vRawData = (pError as { response?: { data?: unknown } } | null)?.response?.data;
    if (!vRawData) {
        return null;
    }

    if (typeof vRawData === "string") {
        try {
            return JSON.parse(vRawData);
        }
        catch (_objError) {
            return null;
        }
    }

    if (typeof vRawData === "object") {
        return vRawData as { error?: { code?: string; context?: { client_ip?: string } } };
    }

    return null;
}

async function getOutboundPublicIp(): Promise<string> {
    const arrUrls = [
        "https://api.ipify.org?format=json",
        "https://ifconfig.me/all.json",
        "https://checkip.amazonaws.com/"
    ];

    for (const vUrl of arrUrls) {
        try {
            const objResponse = await fetch(vUrl, { method: "GET" });
            if (!objResponse.ok) {
                continue;
            }

            const vText = String(await objResponse.text() || "").trim();
            if (!vText) {
                continue;
            }

            if (vText.startsWith("{")) {
                const objParsed = JSON.parse(vText);
                const vIp = String(objParsed.ip || objParsed.ip_addr || "").trim();
                if (vIp) {
                    return vIp;
                }
                continue;
            }

            return vText;
        }
        catch (_objError) {
        }
    }

    return "";
}

function getErrorMessage(pError: unknown, pFallback: string): string {
    if (pError instanceof Error && pError.message) {
        return pError.message;
    }

    if (pError && typeof pError === "object") {
        const objError = pError as { message?: unknown; error?: unknown; response?: { data?: { message?: unknown } } };
        const vMessage = String(objError.message || objError.error || objError.response?.data?.message || "").trim();
        if (vMessage) {
            return vMessage;
        }
    }

    return pFallback;
}


