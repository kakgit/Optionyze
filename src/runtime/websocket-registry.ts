// Counts the browser clients that are currently attached to this server's
// WebSocketServer.
//
// Two counters are kept because they mean different things:
// - data clients: the strategy streams (renko feeds, open-positions pushes).
// - monitor clients: the lightweight status socket that the header badge uses.
//
// Both are plain in-memory counters. Their only purpose is to give the UI an
// indication that the WebSocket tier is alive, so a restart resetting them is
// harmless.
let gDataClientCount = 0;
let gMonitorClientCount = 0;

export function trackWebSocketClient(): void {
    gDataClientCount = Math.max(0, gDataClientCount + 1);
}

export function releaseWebSocketClient(): void {
    gDataClientCount = Math.max(0, gDataClientCount - 1);
}

export function trackWebSocketMonitor(): void {
    gMonitorClientCount = Math.max(0, gMonitorClientCount + 1);
}

export function releaseWebSocketMonitor(): void {
    gMonitorClientCount = Math.max(0, gMonitorClientCount - 1);
}

export function getWebSocketClientCount(): number {
    return gDataClientCount;
}

export function getWebSocketMonitorCount(): number {
    return gMonitorClientCount;
}
