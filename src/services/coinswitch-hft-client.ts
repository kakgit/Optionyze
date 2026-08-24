import crypto from "node:crypto";

const gCoinSwitchHftBase = "https://dma.coinswitch.co";

export interface CoinSwitchHftCredentials {
    apiKey: string;
    apiSecret: string;
}

export interface CoinSwitchPlaceOptionOrderInput {
    symbol: string;
    side: "Buy" | "Sell";
    orderType: "Limit" | "Market";
    qty: string;
    price?: string;
    positionIdx?: number;
    timeInForce?: "GTC" | "IOC" | "FOK";
    orderLinkId?: string;
}

export interface CoinSwitchHftOrderResult {
    ok: boolean;
    retCode: number;
    retMsg: string;
    orderId: string;
    orderLinkId: string;
    raw: unknown;
}

function normalizeHex(pValue: string): string {
    return String(pValue || "").trim().replace(/^0x/i, "");
}

function createEd25519PrivateKeyFromHexSecret(pApiSecret: string): crypto.KeyObject {
    const vHex = normalizeHex(pApiSecret);
    const objSeed = Buffer.from(vHex, "hex");
    if (objSeed.length !== 32 && objSeed.length !== 64) {
        throw new Error("CoinSwitch API secret must be a 32-byte or 64-byte hex Ed25519 key.");
    }
    const objSeed32 = objSeed.length === 64 ? objSeed.subarray(0, 32) : objSeed;
    const objPkcs8 = Buffer.concat([
        Buffer.from("302e020100300506032b657004220420", "hex"),
        objSeed32
    ]);
    return crypto.createPrivateKey({
        key: objPkcs8,
        format: "der",
        type: "pkcs8"
    });
}

export function signCoinSwitchRequest(pMethod: string, pPathWithQuery: string, pApiSecret: string): { epoch: string; signature: string } {
    const vEpoch = String(Date.now());
    const vMessage = `${String(pMethod || "").trim().toUpperCase()}${pPathWithQuery}${vEpoch}`;
    const objKey = createEd25519PrivateKeyFromHexSecret(pApiSecret);
    const vSignature = crypto.sign(null, Buffer.from(vMessage, "utf8"), objKey).toString("hex");
    return {
        epoch: vEpoch,
        signature: vSignature
    };
}

export async function placeCoinSwitchOptionOrder(
    pCredentials: CoinSwitchHftCredentials,
    pInput: CoinSwitchPlaceOptionOrderInput
): Promise<CoinSwitchHftOrderResult> {
    const vApiKey = String(pCredentials.apiKey || "").trim();
    const vApiSecret = String(pCredentials.apiSecret || "").trim();
    if (!vApiKey || !vApiSecret) {
        throw new Error("CoinSwitch API credentials are missing.");
    }

    const vPath = "/v5/order/create";
    const objPayload: Record<string, unknown> = {
        category: "option",
        symbol: String(pInput.symbol || "").trim().toUpperCase(),
        side: pInput.side,
        orderType: pInput.orderType,
        qty: String(pInput.qty || "").trim(),
        positionIdx: Number.isFinite(Number(pInput.positionIdx)) ? Number(pInput.positionIdx) : 0,
        timeInForce: pInput.timeInForce || "GTC"
    };
    if (pInput.orderType === "Limit") {
        objPayload.price = String(pInput.price || "").trim();
    }
    if (pInput.orderLinkId) {
        objPayload.orderLinkId = String(pInput.orderLinkId).trim();
    }

    const objSigned = signCoinSwitchRequest("POST", vPath, vApiSecret);
    const objResponse = await fetch(`${gCoinSwitchHftBase}${vPath}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-AUTH-APIKEY": vApiKey,
            "X-AUTH-SIGNATURE": objSigned.signature,
            "X-AUTH-EPOCH": objSigned.epoch
        },
        body: JSON.stringify(objPayload)
    });

    const vText = await objResponse.text();
    let objJson: Record<string, unknown> = {};
    try {
        objJson = vText ? JSON.parse(vText) as Record<string, unknown> : {};
    }
    catch (_objError) {
        throw new Error(`CoinSwitch order response was not JSON (HTTP ${objResponse.status}).`);
    }

    const vRetCode = Number(objJson.retCode ?? objJson.code ?? (objResponse.ok ? 0 : -1));
    const vRetMsg = String(objJson.retMsg || objJson.message || objResponse.statusText || "").trim();
    const objResult = (objJson.result && typeof objJson.result === "object")
        ? objJson.result as Record<string, unknown>
        : {};
    const vOrderId = String(objResult.orderId || objResult.order_id || "").trim();
    const vOrderLinkId = String(objResult.orderLinkId || objResult.order_link_id || pInput.orderLinkId || "").trim();

    return {
        ok: objResponse.ok && vRetCode === 0,
        retCode: Number.isFinite(vRetCode) ? vRetCode : -1,
        retMsg: vRetMsg || (objResponse.ok ? "Unknown CoinSwitch response." : `HTTP ${objResponse.status}`),
        orderId: vOrderId,
        orderLinkId: vOrderLinkId,
        raw: objJson
    };
}

export function getArbitrageLotSizing(pBaseCoin: string): { coinswitchQtyPerLot: number; deltaContractsPerLot: number } {
    const vBase = String(pBaseCoin || "").trim().toUpperCase();
    if (vBase === "ETH") {
        return {
            coinswitchQtyPerLot: 0.1,
            deltaContractsPerLot: 10
        };
    }
    return {
        coinswitchQtyPerLot: 0.01,
        deltaContractsPerLot: 10
    };
}
