import type { Request, Response } from "express";
import { registerMobilePushToken } from "../../storage/mobile-push-token-store";

export async function registerMobilePushTokenController(req: Request, res: Response): Promise<void> {
    const vAccountId = String(req.authAccount?.accountId || "").trim();
    if (!vAccountId) {
        res.status(401).json({ status: "warning", message: "Please sign in to continue." });
        return;
    }

    const vToken = String(req.body?.token || "").trim();
    const vPlatform = String(req.body?.platform || "").trim().toLowerCase();
    const vDeviceLabel = String(req.body?.deviceLabel || "").trim();

    if (!vToken) {
        res.status(400).json({ status: "warning", message: "FCM token is required." });
        return;
    }
    if (vToken.length > 4096) {
        res.status(400).json({ status: "warning", message: "FCM token is too long." });
        return;
    }
    if (vPlatform !== "android") {
        res.status(400).json({ status: "warning", message: "Only the android push platform is currently supported." });
        return;
    }
    if (vDeviceLabel.length > 160) {
        res.status(400).json({ status: "warning", message: "Device label must be 160 characters or fewer." });
        return;
    }

    try {
        const objToken = await registerMobilePushToken({
            accountId: vAccountId,
            token: vToken,
            platform: "android",
            deviceLabel: vDeviceLabel
        });
        res.json({
            status: "success",
            message: "Mobile push token registered successfully.",
            data: {
                platform: objToken.platform,
                deviceLabel: objToken.deviceLabel,
                updatedAt: objToken.updatedAt
            }
        });
    }
    catch (objError) {
        console.error("[mobile-push] failed to register token:", objError);
        res.status(500).json({ status: "danger", message: "Unable to register the mobile push token." });
    }
}
