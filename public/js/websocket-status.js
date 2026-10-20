(function () {
    // WebSocket health indicator.
    //
    // The badge lives in the shared app header, so this script runs on every
    // authenticated page. Two independent signals are combined:
    //
    // 1. A dedicated WebSocket to "/ws/status". While that socket is open the
    //    server's WebSocket tier is provably reachable from the browser, and
    //    the badge shows "WS Online". When the socket drops or fails to open,
    //    the badge shows "WS Offline" and the socket is retried with backoff.
    // 2. A periodic poll of "/api/system/websocket-status", which adds the
    //    upstream market-data state and the server-side counters to the
    //    tooltip.
    //
    // The script never throws into the page: a failed poll simply leaves the
    // socket-driven state visible.

    const POLL_INTERVAL_MS = 15000;
    const RECONNECT_BASE_MS = 2000;
    const RECONNECT_MAX_MS = 30000;
    const BADGE_ELEMENT_ID = "appWebSocketStatus";

    let pollTimer = null;
    let reconnectTimer = null;
    let reconnectDelayMs = RECONNECT_BASE_MS;
    let socket = null;
    let socketOpen = false;

    function getBadge() {
        return document.getElementById(BADGE_ELEMENT_ID);
    }

    function applyBadge(state, label, title) {
        const badge = getBadge();
        if (!badge) {
            return;
        }
        badge.className = "app-ws-badge app-ws-" + String(state || "unknown");
        badge.textContent = String(label || "");
        badge.title = String(title || "");
        badge.setAttribute("aria-label", String(title || label || ""));
        badge.setAttribute("data-ws-state", String(state || "unknown"));
    }

    function setSocketState(bOpen, detail) {
        socketOpen = bOpen;
        if (bOpen) {
            applyBadge("online", "WS Online", detail || "WebSocket connected.");
        }
        else {
            applyBadge("offline", "WS Offline", detail || "WebSocket disconnected.");
        }
    }

    function buildUrl() {
        const vProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        return `${vProtocol}//${window.location.host}/ws/status`;
    }

    function scheduleReconnect() {
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
        }
        reconnectDelayMs = Math.min(RECONNECT_MAX_MS, Math.max(RECONNECT_BASE_MS, reconnectDelayMs * 2));
        reconnectTimer = setTimeout(connectSocket, reconnectDelayMs);
    }

    function connectSocket() {
        if (!getBadge()) {
            return;
        }
        if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
            return;
        }
        try {
            socket = new WebSocket(buildUrl());
        }
        catch (_objError) {
            setSocketState(false, "Unable to open the WebSocket connection.");
            scheduleReconnect();
            return;
        }
        socket.onopen = function () {
            reconnectDelayMs = RECONNECT_BASE_MS;
            setSocketState(true, "WebSocket connected.");
        };
        socket.onclose = function () {
            setSocketState(false, "WebSocket disconnected. Retrying...");
            scheduleReconnect();
        };
        socket.onerror = function () {
            // "close" always follows "error"; the close handler reconnects.
        };
    }

    function describeStatus(objData) {
        const marketData = objData?.marketData || {};
        const marketState = String(marketData.connectionState || "closed");
        const monitorCount = Number(objData?.monitorClientCount || 0);
        const dataCount = Number(objData?.dataClientCount || 0);
        const lastMessageAtMs = Number(marketData.lastMessageAtMs || 0);
        const lastError = String(marketData.lastError || "").trim();

        const parts = [
            "Status socket: " + (socketOpen ? "connected" : "disconnected"),
            "Market data socket: " + marketState,
            "Monitor clients: " + String(monitorCount),
            "Data clients: " + String(dataCount)
        ];
        if (lastMessageAtMs > 0) {
            parts.push("Last market data message: " + new Date(lastMessageAtMs).toLocaleTimeString());
        }
        if (lastError) {
            parts.push("Last error: " + lastError);
        }
        return parts.join(" | ");
    }

    async function refreshStatus() {
        try {
            const response = await fetch("/api/system/websocket-status", {
                credentials: "same-origin",
                cache: "no-store"
            });
            const payload = await response.json().catch(function () { return {}; });
            if (!response.ok) {
                throw new Error(String(payload?.message || "status request failed"));
            }
            const objData = payload?.data || {};
            const title = describeStatus(objData);
            // The socket state wins: it is the live, push-based signal.
            if (socketOpen) {
                applyBadge("online", "WS Online", title);
            }
            else {
                applyBadge("offline", "WS Offline", title);
            }
        }
        catch (_objError) {
            // Keep whatever the socket state shows; the socket is the primary
            // indicator and the poll only enriches the tooltip.
            if (!socketOpen) {
                applyBadge("offline", "WS Offline", "WebSocket disconnected. Retrying...");
            }
        }
    }

    function start() {
        if (!getBadge()) {
            return;
        }
        applyBadge("checking", "WS ...", "Checking WebSocket status...");
        connectSocket();
        void refreshStatus();
        if (pollTimer) {
            clearInterval(pollTimer);
        }
        pollTimer = setInterval(refreshStatus, POLL_INTERVAL_MS);
        window.addEventListener("beforeunload", function () {
            if (socket) {
                socket.close();
            }
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start);
    }
    else {
        start();
    }
})();
