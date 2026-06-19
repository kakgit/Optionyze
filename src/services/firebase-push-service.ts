import crypto from "node:crypto";
import {
    deleteMobilePushToken,
    listMobilePushTokens,
    type MobilePushTokenRecord
} from "../storage/mobile-push-token-store";

interface FirebaseCredentials {
    projectId: string;
    clientEmail: string;
    privateKey: string;
}

interface CachedAccessToken {
    value: string;
    expiresAtMs: number;
}

export interface MobilePushDeliverySummary {
    configured: boolean;
    tokenCount: number;
    sentCount: number;
    failedCount: number;
    removedTokenCount: number;
}

let gCachedAccessToken: CachedAccessToken | null = null;

export async function sendMobilePushToAccount(
    pAccountId: string,
    pNotification: { title: string; message: string; data?: Record<string, string> }
): Promise<MobilePushDeliverySummary> {
    const objCredentials = readFirebaseCredentials();
    if (!objCredentials) {
        return {
            configured: false,
            tokenCount: 0,
            sentCount: 0,
            failedCount: 0,
            removedTokenCount: 0
        };
    }

    const arrTokens = await listMobilePushTokens(pAccountId);
    if (arrTokens.length === 0) {
        return {
            configured: true,
            tokenCount: 0,
            sentCount: 0,
            failedCount: 0,
            removedTokenCount: 0
        };
    }

    const vAccessToken = await getFirebaseAccessToken(objCredentials);
    const arrResults = await Promise.all(arrTokens.map((objToken) => sendToToken(
        objCredentials,
        vAccessToken,
        objToken,
        pNotification
    )));

    return {
        configured: true,
        tokenCount: arrTokens.length,
        sentCount: arrResults.filter((objResult) => objResult.sent).length,
        failedCount: arrResults.filter((objResult) => !objResult.sent).length,
        removedTokenCount: arrResults.filter((objResult) => objResult.removed).length
    };
}

function readFirebaseCredentials(): FirebaseCredentials | null {
    const vProjectId = String(process.env.FIREBASE_PROJECT_ID || "").trim();
    const vClientEmail = String(process.env.FIREBASE_CLIENT_EMAIL || "").trim();
    const vPrivateKey = String(process.env.FIREBASE_PRIVATE_KEY || "").trim().replace(/\\n/g, "\n");
    const arrConfiguredValues = [vProjectId, vClientEmail, vPrivateKey].filter(Boolean);

    if (arrConfiguredValues.length === 0) {
        return null;
    }
    if (arrConfiguredValues.length !== 3) {
        throw new Error("FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY must all be configured.");
    }

    return {
        projectId: vProjectId,
        clientEmail: vClientEmail,
        privateKey: vPrivateKey
    };
}

async function getFirebaseAccessToken(pCredentials: FirebaseCredentials): Promise<string> {
    const vNowMs = Date.now();
    if (gCachedAccessToken && gCachedAccessToken.expiresAtMs > vNowMs + 60_000) {
        return gCachedAccessToken.value;
    }

    const vIssuedAt = Math.floor(vNowMs / 1000);
    const vAssertion = createServiceAccountAssertion(pCredentials, vIssuedAt);
    const objResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
            assertion: vAssertion
        })
    });
    const objPayload = await readJsonResponse(objResponse);
    const vAccessToken = String(objPayload.access_token || "").trim();
    if (!objResponse.ok || !vAccessToken) {
        throw new Error(`Firebase OAuth token request failed (${objResponse.status}): ${getFirebaseErrorMessage(objPayload)}`);
    }

    const vExpiresInSeconds = Math.max(60, Number(objPayload.expires_in) || 3600);
    gCachedAccessToken = {
        value: vAccessToken,
        expiresAtMs: vNowMs + (vExpiresInSeconds * 1000)
    };
    return vAccessToken;
}

function createServiceAccountAssertion(pCredentials: FirebaseCredentials, pIssuedAt: number): string {
    const vHeader = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const vClaims = Buffer.from(JSON.stringify({
        iss: pCredentials.clientEmail,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: "https://oauth2.googleapis.com/token",
        iat: pIssuedAt,
        exp: pIssuedAt + 3600
    })).toString("base64url");
    const vUnsignedAssertion = `${vHeader}.${vClaims}`;
    const vSignature = crypto.sign("RSA-SHA256", Buffer.from(vUnsignedAssertion), pCredentials.privateKey).toString("base64url");
    return `${vUnsignedAssertion}.${vSignature}`;
}

async function sendToToken(
    pCredentials: FirebaseCredentials,
    pAccessToken: string,
    pToken: MobilePushTokenRecord,
    pNotification: { title: string; message: string; data?: Record<string, string> }
): Promise<{ sent: boolean; removed: boolean }> {
    const objResponse = await fetch(
        `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(pCredentials.projectId)}/messages:send`,
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${pAccessToken}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                message: {
                    token: pToken.token,
                    notification: {
                        title: String(pNotification.title || "Optionyze"),
                        body: String(pNotification.message || "")
                    },
                    data: pNotification.data || {},
                    android: {
                        priority: "HIGH",
                        notification: { sound: "default" }
                    }
                }
            })
        }
    );

    if (objResponse.ok) {
        return { sent: true, removed: false };
    }

    const objPayload = await readJsonResponse(objResponse);
    const vUnregistered = isUnregisteredTokenError(objPayload);
    if (vUnregistered) {
        await deleteMobilePushToken(pToken.token);
    }
    console.warn(
        `[mobile-push] Firebase delivery failed for account ${pToken.accountId} (${objResponse.status}): ${getFirebaseErrorMessage(objPayload)}`
    );
    return { sent: false, removed: vUnregistered };
}

async function readJsonResponse(pResponse: Response): Promise<Record<string, unknown>> {
    try {
        const objPayload: unknown = await pResponse.json();
        return objPayload && typeof objPayload === "object" ? objPayload as Record<string, unknown> : {};
    }
    catch (_objError) {
        return {};
    }
}

function getFirebaseErrorMessage(pPayload: Record<string, unknown>): string {
    const objError = pPayload.error && typeof pPayload.error === "object"
        ? pPayload.error as Record<string, unknown>
        : null;
    return String(objError?.message || pPayload.error_description || "Unknown Firebase error");
}

function isUnregisteredTokenError(pPayload: Record<string, unknown>): boolean {
    return JSON.stringify(pPayload).toUpperCase().includes("UNREGISTERED");
}
