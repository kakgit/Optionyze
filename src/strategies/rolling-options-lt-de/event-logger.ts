import { getAccountById } from "../../storage/accounts-store";
import { loadRollingOptionsLtDeProfile } from "../../storage/rolling-options-lt-de-profile-store";
import {
    saveRollingOptionsEvent,
    type RollingOptionsPtDeEventRecord
} from "../../storage/rolling-options-pt-de-event-store";
import { gRollingOptionsTelegramEventTypes } from "../rolling-options-pt-de/event-logger";

const gStrategyCode = "rolling-options-lt-de";

function normalizeSelectedEventTypes(pValue: unknown): string[] {
    if (!Array.isArray(pValue)) {
        return [];
    }
    return pValue
        .map((vItem) => String(vItem || "").trim())
        .map((vItem) => vItem === "renko_red_detected" ? "renko_change_detected" : vItem)
        .filter(Boolean);
}

async function shouldSendTelegram(pUserId: string, pEventType: string): Promise<boolean> {
    const objProfile = await loadRollingOptionsLtDeProfile(pUserId);
    const objUiState = objProfile?.uiState || {};
    const bEnabled = Boolean(objUiState.telegramAlertsEnabled);
    const arrSelectedTypes = normalizeSelectedEventTypes(objUiState.telegramAlertTypes);
    if (!bEnabled || arrSelectedTypes.length === 0) {
        return false;
    }
    return arrSelectedTypes.includes(pEventType);
}

async function sendTelegramForEvent(
    pUserId: string,
    pEvent: Omit<RollingOptionsPtDeEventRecord, "eventId" | "createdAt">
): Promise<void> {
    const vBotToken = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
    if (!vBotToken) {
        return;
    }

    const objAccount = await getAccountById(pUserId);
    const vTelegramChatId = String(objAccount?.telegramChatId || "").trim();
    if (!vTelegramChatId) {
        return;
    }

    if (!(await shouldSendTelegram(pUserId, pEvent.eventType))) {
        return;
    }

    const arrLines = [
        "Rolling Options - Live",
        `Time: ${new Date().toLocaleString("en-IN")}`,
        "",
        pEvent.title,
        pEvent.message
    ];

    const vSymbol = String(pEvent.payload.symbol || "").trim();
    const vContractName = String(pEvent.payload.contractName || "").trim();
    const vQty = Number(pEvent.payload.qty || 0);
    const vReason = String(pEvent.payload.reason || "").trim();
    if (vSymbol) {
        arrLines.push(`Symbol: ${vSymbol}`);
    }
    if (vContractName) {
        arrLines.push(`Contract: ${vContractName}`);
    }
    if (Number.isFinite(vQty) && vQty > 0) {
        arrLines.push(`Qty: ${vQty}`);
    }
    if (vReason) {
        arrLines.push(`Reason: ${vReason}`);
    }

    try {
        await fetch(`https://api.telegram.org/bot${encodeURIComponent(vBotToken)}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: vTelegramChatId,
                text: arrLines.join("\n")
            })
        });
    }
    catch (_objError) {
    }
}

export async function logRollingOptionsLtDeEvent(
    pEvent: Omit<RollingOptionsPtDeEventRecord, "eventId" | "createdAt" | "strategyCode">
): Promise<RollingOptionsPtDeEventRecord> {
    const objEvent = await saveRollingOptionsEvent({
        ...pEvent,
        strategyCode: gStrategyCode
    });

    await sendTelegramForEvent(pEvent.userId, {
        ...pEvent,
        strategyCode: gStrategyCode
    });

    return objEvent;
}

export { gRollingOptionsTelegramEventTypes };
