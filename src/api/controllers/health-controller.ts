import type { Request, Response } from "express";
import { getServerId } from "../../runtime/server-runtime";
import { getWebSocketClientCount, getWebSocketMonitorCount } from "../../runtime/websocket-registry";
import { getLiveTickerFeedStats } from "../../strategies/rolling-options-pt-de/market-data";

export function getHealth(_req: Request, res: Response): void {
    res.json({
        status: "ok",
        service: "optionyze",
        serverId: getServerId(),
        pid: process.pid,
        timestamp: new Date().toISOString()
    });
}

/**
 * Reports whether the WebSocket tier is healthy.
 *
 * Two independent layers are reported:
 * - "server": this process' own WebSocketServer. The browser badge keeps a
 *   dedicated "/ws/status" socket open, so a non-zero monitor count proves the
 *   server's WebSocket tier is reachable from the browser.
 * - "marketData": the upstream Delta public ticker socket that feeds live
 *   prices. It is a separate socket that lives in the market-data module and
 *   is only opened while symbols are actually subscribed, so "closed" there
 *   simply means "no strategy is streaming right now" - not a failure.
 *
 * The overall state is "online" when the server tier is confirmed reachable.
 * The upstream feed is reported alongside it but is never allowed to
 * misrepresent an idle-but-healthy server as broken.
 */
export function getWebSocketStatus(_req: Request, res: Response): void {
    const objFeedStats = getLiveTickerFeedStats();
    const vDataClientCount = getWebSocketClientCount();
    const vMonitorClientCount = getWebSocketMonitorCount();
    const bServerReachable = vMonitorClientCount > 0;
    const bMarketDataOpen = objFeedStats.connectionState === "open";
    const vState = bServerReachable ? "online" : "offline";

    res.json({
        status: "success",
        data: {
            state: vState,
            serverId: getServerId(),
            monitorClientCount: vMonitorClientCount,
            dataClientCount: vDataClientCount,
            marketData: {
                connectionState: objFeedStats.connectionState,
                endpointUrl: objFeedStats.endpointUrl,
                channel: objFeedStats.channel,
                lastError: objFeedStats.lastError,
                lastMessageAtMs: objFeedStats.lastMessageAtMs,
                desiredSymbolCount: objFeedStats.desiredSymbolCount,
                cachedTickerCount: objFeedStats.cachedTickerCount,
                streaming: bMarketDataOpen
            },
            checkedAt: new Date().toISOString()
        }
    });
}
