(function () {
    const DELTA_MIN = 0.05;
    const DELTA_MAX = 0.80;
    const CROSS_EDGE_MIN = 5;

    const sharedIds = {
        instrument: document.getElementById("ddlArbitrageInstrument"),
        expiry: document.getElementById("ddlArbitrageExpiry"),
        fetchButton: document.getElementById("btnArbitrageFetch"),
        status: document.getElementById("arbitragePageStatus"),
        statusPill: document.getElementById("arbitrageStatusPill")
    };

    let tickerSocket = null;
    let activeTickerTopic = "";
    let deltaSocket = null;
    let deltaSubscribedSymbols = [];
    let deltaChainSymbol = "";
    let deltaPingTimer = null;
    let sharkLive = false;
    let deltaLive = false;
    let fetchInFlight = false;
    const sideBoards = [];

    function setStatus(message, tone) {
        if (!sharedIds.status) {
            return;
        }
        sharedIds.status.textContent = String(message || "");
        sharedIds.status.className = `arbitrage-status ${String(tone || "").trim()}`;
    }

    function setPill(text) {
        if (sharedIds.statusPill) {
            sharedIds.statusPill.textContent = String(text || "Ready");
        }
    }

    function updateLiveStatus() {
        if (sharkLive && deltaLive) {
            setPill("Live both");
            setStatus("Shark and Delta tickers are live for puts and calls.", "success");
            return;
        }
        if (sharkLive) {
            setPill("Live Shark");
            setStatus("Shark ticker is live. Waiting for Delta websocket...", "warning");
            return;
        }
        if (deltaLive) {
            setPill("Live Delta");
            setStatus("Delta ticker is live. Waiting for Shark websocket...", "warning");
            return;
        }
        setPill("REST only");
    }

    function fmtNumber(value, digits) {
        const numberValue = Number(value);
        if (!Number.isFinite(numberValue)) {
            return "-";
        }
        return numberValue.toFixed(digits);
    }

    function formatDateTime(dateValue) {
        const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
        if (Number.isNaN(date.getTime())) {
            return "-";
        }
        const day = String(date.getDate()).padStart(2, "0");
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const year = String(date.getFullYear());
        const hours = String(date.getHours()).padStart(2, "0");
        const minutes = String(date.getMinutes()).padStart(2, "0");
        const seconds = String(date.getSeconds()).padStart(2, "0");
        return `${day}-${month}-${year} ${hours}:${minutes}:${seconds}`;
    }

    function escapeHtml(value) {
        return String(value || "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll("\"", "&quot;")
            .replaceAll("'", "&#39;");
    }

    async function getJson(url) {
        const response = await fetch(url, {
            headers: {
                Accept: "application/json"
            },
            credentials: "same-origin"
        });
        const payload = await response.json().catch(function () {
            return null;
        });
        if (!response.ok) {
            throw new Error(String(payload?.message || `Request failed (${response.status})`));
        }
        return payload;
    }

    function parseSelectedInstrument() {
        const raw = String(sharedIds.instrument?.value || "").trim().toUpperCase();
        if (!raw || !raw.includes(":")) {
            return null;
        }
        const parts = raw.split(":");
        return {
            baseCoin: String(parts[0] || "").trim(),
            quoteCoin: String(parts[1] || "").trim()
        };
    }

    function updateFetchEnabled() {
        const instrument = parseSelectedInstrument();
        const deliveryTime = Number(sharedIds.expiry?.value || 0);
        if (sharedIds.fetchButton instanceof HTMLButtonElement) {
            sharedIds.fetchButton.disabled = fetchInFlight || !instrument || !(deliveryTime > 0);
        }
    }

    function parseDeltaQuoteNumber(ticker, quoteKey, flatKey) {
        const fromQuotes = Number(ticker?.quotes?.[quoteKey]);
        if (Number.isFinite(fromQuotes)) {
            return fromQuotes;
        }
        const fromFlat = Number(ticker?.[flatKey]);
        return Number.isFinite(fromFlat) ? fromFlat : NaN;
    }

    function normalizeDeltaTicker(ticker) {
        if (!ticker || typeof ticker !== "object") {
            return null;
        }
        if (ticker.s || Array.isArray(ticker.q) || Array.isArray(ticker.g)) {
            const quotes = Array.isArray(ticker.q) ? ticker.q : [];
            const greeks = Array.isArray(ticker.g) ? ticker.g : [];
            return {
                symbol: String(ticker.s || ticker.sy || "").trim(),
                bid: Number(quotes[2]),
                ask: Number(quotes[0]),
                delta: Number(greeks[0])
            };
        }
        return {
            symbol: String(ticker.symbol || "").trim(),
            bid: parseDeltaQuoteNumber(ticker, "best_bid", "best_bid"),
            ask: parseDeltaQuoteNumber(ticker, "best_ask", "best_ask"),
            delta: Number(ticker?.greeks?.delta ?? ticker?.delta)
        };
    }

    function collectDeltaTickerRows(message) {
        const rows = [];
        if (!message || typeof message !== "object") {
            return rows;
        }
        if (Array.isArray(message.d)) {
            message.d.forEach(function (row) {
                rows.push(row);
            });
        }
        if (Array.isArray(message.result)) {
            message.result.forEach(function (row) {
                rows.push(row);
            });
        }
        if (message.s || message.symbol || message.quotes || message.q) {
            rows.push(message);
        }
        return rows;
    }

    function createCompareSide(config) {
        const sideLabel = String(config.sideLabel || config.side || "option");
        const ids = {
            tableBody: document.getElementById(config.tableBodyId),
            meta: document.getElementById(config.metaId),
            statusPill: document.getElementById(config.statusPillId),
            alertsList: document.getElementById(config.alertsListId),
            alertCount: document.getElementById(config.alertCountId),
            clearAlertsButton: document.getElementById(config.clearAlertsButtonId)
        };

        let compareRowsBySharkSymbol = new Map();
        let compareRowsByDeltaSymbol = new Map();
        let crossActiveByStrike = new Map();
        let crossAlerts = [];
        let chainMeta = null;

        function setSidePill(text) {
            if (ids.statusPill) {
                ids.statusPill.textContent = String(text || "Idle");
            }
        }

        function isInDeltaRange(delta) {
            const absoluteDelta = Math.abs(Number(delta));
            return Number.isFinite(absoluteDelta) && absoluteDelta >= DELTA_MIN && absoluteDelta <= DELTA_MAX;
        }

        function getFilteredCompareRows() {
            return Array.from(compareRowsBySharkSymbol.values())
                .filter(function (row) {
                    return isInDeltaRange(row?.shark?.delta);
                })
                .sort(function (left, right) {
                    return Number(left.strike || 0) - Number(right.strike || 0);
                });
        }

        function getCrossEdge(row) {
            const sharkBid = Number(row?.shark?.bid);
            const deltaAsk = Number(row?.delta?.ask);
            if (!Number.isFinite(sharkBid) || !Number.isFinite(deltaAsk)) {
                return NaN;
            }
            return sharkBid - deltaAsk;
        }

        function shouldAlertCross(row) {
            const edge = getCrossEdge(row);
            return Number.isFinite(edge) && edge >= CROSS_EDGE_MIN;
        }

        function updateChainMeta(filteredCount) {
            if (!ids.meta || !chainMeta) {
                return;
            }
            const total = Number(chainMeta.totalRows || 0);
            const matched = Number(chainMeta.deltaMatchedCount || 0);
            const deltaRows = Number(chainMeta.deltaRowCount || 0);
            let text = `${chainMeta.expiryLabel || "-"} · ${filteredCount}/${total} ${sideLabel}s in |Δ| ${DELTA_MIN.toFixed(2)}–${DELTA_MAX.toFixed(2)} · Delta matched ${matched}/${total}`;
            if (deltaRows === 0) {
                text += ` · no Delta ${sideLabel} contracts for this expiry`;
            }
            if (chainMeta.deltaError) {
                text += ` · Delta error: ${chainMeta.deltaError}`;
            }
            ids.meta.textContent = text;
        }

        function renderCrossAlerts() {
            if (ids.alertCount) {
                ids.alertCount.textContent = String(crossAlerts.length);
            }
            if (!ids.alertsList) {
                return;
            }
            if (!crossAlerts.length) {
                ids.alertsList.innerHTML = `<div class="arbitrage-alerts-empty">No ${escapeHtml(sideLabel)} crossings yet.</div>`;
                return;
            }
            ids.alertsList.innerHTML = crossAlerts.map(function (alert) {
                return `
                    <div class="arbitrage-alert-item">
                        <div class="arbitrage-alert-time">${escapeHtml(alert.timeLabel)}</div>
                        <div class="arbitrage-alert-strike">${escapeHtml(fmtNumber(alert.strike, 0))}</div>
                        <div class="arbitrage-alert-detail">
                            Shark Bid ${escapeHtml(fmtNumber(alert.sharkBid, 2))}
                            &gt; Delta Ask ${escapeHtml(fmtNumber(alert.deltaAsk, 2))}
                            · edge ${escapeHtml(fmtNumber(alert.edge, 2))}
                        </div>
                    </div>
                `;
            }).join("");
        }

        function clearCrossAlerts() {
            crossAlerts = [];
            crossActiveByStrike = new Map();
            renderCrossAlerts();
        }

        function pushCrossAlert(row) {
            const sharkBid = Number(row?.shark?.bid);
            const deltaAsk = Number(row?.delta?.ask);
            const now = new Date();
            crossAlerts.unshift({
                id: `${config.side}-${row.strike}-${now.getTime()}`,
                timeLabel: formatDateTime(now),
                strike: Number(row.strike),
                sharkBid: sharkBid,
                deltaAsk: deltaAsk,
                edge: sharkBid - deltaAsk
            });
            if (crossAlerts.length > 200) {
                crossAlerts.length = 200;
            }
            renderCrossAlerts();
        }

        function evaluateCrossings() {
            const filtered = getFilteredCompareRows();
            const seenStrikes = new Set();
            filtered.forEach(function (row) {
                const strike = Number(row.strike);
                if (!Number.isFinite(strike)) {
                    return;
                }
                seenStrikes.add(strike);
                const nowCrossed = shouldAlertCross(row);
                const wasCrossed = crossActiveByStrike.get(strike) === true;
                if (nowCrossed && !wasCrossed) {
                    pushCrossAlert(row);
                }
                crossActiveByStrike.set(strike, nowCrossed);
            });
            Array.from(crossActiveByStrike.keys()).forEach(function (strike) {
                if (!seenStrikes.has(strike)) {
                    crossActiveByStrike.set(strike, false);
                }
            });
        }

        function renderCompareRows(rows, emptyMessage) {
            if (!ids.tableBody) {
                return;
            }
            const list = Array.isArray(rows) ? rows : [];
            if (!list.length) {
                ids.tableBody.innerHTML = `<tr><td colspan="6" class="arbitrage-empty-cell">${escapeHtml(emptyMessage || `No ${sideLabel} strikes in the selected delta range.`)}</td></tr>`;
                return;
            }
            ids.tableBody.innerHTML = list.map(function (row) {
                const symbol = String(row?.shark?.symbol || "").trim().toUpperCase();
                const crossed = shouldAlertCross(row);
                return `
                    <tr data-symbol="${escapeHtml(symbol)}" class="${crossed ? "arbitrage-row-crossed" : ""}">
                        <td class="arbitrage-side-shark" data-field="shark-delta">${escapeHtml(fmtNumber(row?.shark?.delta, 4))}</td>
                        <td>${escapeHtml(fmtNumber(row.strike, 0))}</td>
                        <td class="arbitrage-side-shark" data-field="shark-bid">${escapeHtml(fmtNumber(row?.shark?.bid, 2))}</td>
                        <td class="arbitrage-side-shark" data-field="shark-ask">${escapeHtml(fmtNumber(row?.shark?.ask, 2))}</td>
                        <td class="arbitrage-side-delta" data-field="delta-bid">${escapeHtml(fmtNumber(row?.delta?.bid, 2))}</td>
                        <td class="arbitrage-side-delta" data-field="delta-ask">${escapeHtml(fmtNumber(row?.delta?.ask, 2))}</td>
                    </tr>
                `;
            }).join("");
        }

        function refreshFilteredTable(emptyMessage) {
            const filtered = getFilteredCompareRows();
            renderCompareRows(filtered, emptyMessage);
            updateChainMeta(filtered.length);
            evaluateCrossings();
            return filtered.length;
        }

        function applySharkTicker(ticker) {
            const symbol = String(ticker?.symbol || "").trim().toUpperCase();
            if (!symbol || !compareRowsBySharkSymbol.has(symbol)) {
                return false;
            }
            const current = compareRowsBySharkSymbol.get(symbol) || {};
            const shark = {
                ...(current.shark || {}),
                symbol: String(current?.shark?.symbol || symbol).trim().toUpperCase(),
                delta: Number.isFinite(Number(ticker?.delta)) ? Number(ticker.delta) : current?.shark?.delta,
                bid: Number.isFinite(Number(ticker?.bidPrice)) ? Number(ticker.bidPrice) : current?.shark?.bid,
                ask: Number.isFinite(Number(ticker?.askPrice)) ? Number(ticker.askPrice) : current?.shark?.ask
            };
            compareRowsBySharkSymbol.set(symbol, {
                ...current,
                strike: current.strike,
                shark: shark,
                delta: current.delta || null
            });
            return true;
        }

        function applyDeltaTicker(ticker) {
            const normalized = normalizeDeltaTicker(ticker);
            const deltaSymbol = String(normalized?.symbol || "").trim().toUpperCase();
            if (!deltaSymbol || !compareRowsByDeltaSymbol.has(deltaSymbol)) {
                return false;
            }
            const sharkSymbol = compareRowsByDeltaSymbol.get(deltaSymbol);
            const current = compareRowsBySharkSymbol.get(sharkSymbol);
            if (!current) {
                return false;
            }
            const nextDelta = {
                ...(current.delta || {}),
                symbol: String(current?.delta?.symbol || normalized.symbol || deltaSymbol).trim(),
                bid: Number.isFinite(normalized.bid) ? normalized.bid : current?.delta?.bid,
                ask: Number.isFinite(normalized.ask) ? normalized.ask : current?.delta?.ask,
                delta: Number.isFinite(normalized.delta) ? normalized.delta : current?.delta?.delta
            };
            compareRowsBySharkSymbol.set(sharkSymbol, {
                ...current,
                strike: current.strike,
                shark: current.shark || null,
                delta: nextDelta
            });
            return true;
        }

        function loadFromApiResult(result) {
            const rows = Array.isArray(result?.data?.rows) ? result.data.rows : [];
            compareRowsBySharkSymbol = new Map();
            compareRowsByDeltaSymbol = new Map();
            crossActiveByStrike = new Map();
            crossAlerts = [];
            renderCrossAlerts();
            const deltaSymbols = [];
            rows.forEach(function (row) {
                const sharkSymbol = String(row?.shark?.symbol || "").trim().toUpperCase();
                if (!sharkSymbol) {
                    return;
                }
                compareRowsBySharkSymbol.set(sharkSymbol, row);
                const deltaSymbolRaw = String(row?.delta?.symbol || "").trim();
                const deltaSymbol = deltaSymbolRaw.toUpperCase();
                if (deltaSymbol) {
                    compareRowsByDeltaSymbol.set(deltaSymbol, sharkSymbol);
                    deltaSymbols.push(deltaSymbolRaw || deltaSymbol);
                }
            });
            chainMeta = {
                expiryLabel: String(result?.data?.expiryLabel || "-"),
                tickerTopic: String(result?.data?.tickerTopic || "-"),
                totalRows: rows.length,
                deltaMatchedCount: Number(result?.data?.deltaMatchedCount || 0),
                deltaRowCount: Number(result?.data?.deltaRowCount || 0),
                deltaError: result?.data?.deltaError ? String(result.data.deltaError) : "",
                deltaChainSymbol: String(result?.data?.deltaChainSymbol || "")
            };
            refreshFilteredTable(`Loaded x1000 ${sideLabel}s. Waiting for live Shark deltas in range 0.05–0.80...`);
            setSidePill(rows.length ? "Loaded" : "Empty");
            return {
                tickerTopic: String(result?.data?.tickerTopic || ""),
                deltaChainSymbol: String(result?.data?.deltaChainSymbol || ""),
                deltaSymbols: deltaSymbols,
                message: String(result?.message || ""),
                status: String(result?.status || "success")
            };
        }

        function resetIdle() {
            compareRowsBySharkSymbol = new Map();
            compareRowsByDeltaSymbol = new Map();
            crossActiveByStrike = new Map();
            crossAlerts = [];
            chainMeta = null;
            renderCrossAlerts();
            if (ids.tableBody) {
                ids.tableBody.innerHTML = `<tr><td colspan="6" class="arbitrage-empty-cell">No ${escapeHtml(sideLabel)} compare loaded yet.</td></tr>`;
            }
            if (ids.meta) {
                ids.meta.textContent = "Choose instrument and expiry, then fetch.";
            }
            setSidePill("Idle");
        }

        ids.clearAlertsButton?.addEventListener("click", clearCrossAlerts);

        return {
            side: config.side,
            loadFromApiResult: loadFromApiResult,
            applySharkTicker: applySharkTicker,
            applyDeltaTicker: applyDeltaTicker,
            refreshFilteredTable: refreshFilteredTable,
            resetIdle: resetIdle,
            clearCrossAlerts: clearCrossAlerts,
            setSidePill: setSidePill
        };
    }

    const putBoard = createCompareSide({
        side: "put",
        sideLabel: "put",
        tableBodyId: "tBodyArbitragePuts",
        metaId: "putMeta",
        statusPillId: "putStatusPill",
        alertsListId: "putAlertsList",
        alertCountId: "putAlertCount",
        clearAlertsButtonId: "btnPutClearAlerts"
    });
    const callBoard = createCompareSide({
        side: "call",
        sideLabel: "call",
        tableBodyId: "tBodyArbitrageCalls",
        metaId: "callMeta",
        statusPillId: "callStatusPill",
        alertsListId: "callAlertsList",
        alertCountId: "callAlertCount",
        clearAlertsButtonId: "btnCallClearAlerts"
    });
    sideBoards.push(putBoard, callBoard);

    function onSharkTickerPayload(payload) {
        let changed = false;
        const tickers = Array.isArray(payload) ? payload : [payload];
        tickers.forEach(function (ticker) {
            sideBoards.forEach(function (board) {
                if (board.applySharkTicker(ticker)) {
                    changed = true;
                }
            });
        });
        if (changed) {
            sideBoards.forEach(function (board) {
                board.refreshFilteredTable("Waiting for live Shark deltas in range 0.05–0.80...");
            });
        }
    }

    function onDeltaTickerMessage(raw) {
        let message = null;
        try {
            message = JSON.parse(String(raw || ""));
        }
        catch (_error) {
            return;
        }
        const messageType = String(message?.type || "").trim().toLowerCase();
        if (messageType === "heartbeat") {
            return;
        }
        if (messageType === "ping") {
            try {
                if (deltaSocket && deltaSocket.readyState === WebSocket.OPEN) {
                    deltaSocket.send(JSON.stringify({ type: "pong" }));
                }
            }
            catch (_error) {
            }
            return;
        }
        if (messageType && messageType !== "ticker" && messageType !== "v2/ticker") {
            return;
        }
        const rows = collectDeltaTickerRows(message);
        if (!rows.length) {
            return;
        }
        let changed = false;
        rows.forEach(function (ticker) {
            sideBoards.forEach(function (board) {
                if (board.applyDeltaTicker(ticker)) {
                    changed = true;
                }
            });
        });
        if (changed) {
            if (!deltaLive) {
                deltaLive = true;
                updateLiveStatus();
            }
            sideBoards.forEach(function (board) {
                board.refreshFilteredTable("Waiting for live Shark deltas in range 0.05–0.80...");
            });
        }
    }

    function clearDeltaPingTimer() {
        if (deltaPingTimer) {
            clearInterval(deltaPingTimer);
            deltaPingTimer = null;
        }
    }

    function disconnectDeltaSocket() {
        clearDeltaPingTimer();
        if (deltaSocket) {
            try {
                if (deltaSocket.readyState === WebSocket.OPEN) {
                    const unsubscribeSymbols = deltaChainSymbol
                        ? [deltaChainSymbol].concat(deltaSubscribedSymbols)
                        : deltaSubscribedSymbols.slice();
                    if (unsubscribeSymbols.length) {
                        deltaSocket.send(JSON.stringify({
                            type: "unsubscribe",
                            payload: {
                                channels: [{
                                    name: "ticker",
                                    symbols: unsubscribeSymbols
                                }]
                            }
                        }));
                    }
                }
                deltaSocket.onopen = null;
                deltaSocket.onmessage = null;
                deltaSocket.onerror = null;
                deltaSocket.onclose = null;
                deltaSocket.close();
            }
            catch (_error) {
            }
        }
        deltaSocket = null;
        deltaSubscribedSymbols = [];
        deltaChainSymbol = "";
        deltaLive = false;
    }

    function disconnectSharkSocket() {
        if (tickerSocket) {
            try {
                if (activeTickerTopic) {
                    tickerSocket.emit("unsubscribe", { params: [activeTickerTopic] });
                }
                tickerSocket.removeAllListeners?.();
                tickerSocket.disconnect();
            }
            catch (_error) {
            }
        }
        tickerSocket = null;
        activeTickerTopic = "";
        sharkLive = false;
    }

    function disconnectAllSockets() {
        disconnectSharkSocket();
        disconnectDeltaSocket();
    }

    function connectSharkSocket(topic) {
        disconnectSharkSocket();
        const nextTopic = String(topic || "").trim();
        if (!nextTopic || typeof window.io !== "function") {
            updateLiveStatus();
            return;
        }
        activeTickerTopic = nextTopic;
        tickerSocket = window.io("https://fawss-options.sharkexchange.in", {
            transports: ["websocket", "polling"],
            withCredentials: false
        });
        tickerSocket.on("connect", function () {
            tickerSocket.emit("subscribe", { params: [activeTickerTopic] });
            sharkLive = true;
            updateLiveStatus();
        });
        tickerSocket.on("ticker", onSharkTickerPayload);
        tickerSocket.on("connect_error", function () {
            sharkLive = false;
            updateLiveStatus();
        });
        tickerSocket.on("disconnect", function () {
            sharkLive = false;
            updateLiveStatus();
        });
    }

    function connectDeltaSocket(symbols, chainSymbol) {
        disconnectDeltaSocket();
        const uniqueSymbols = Array.from(new Set((Array.isArray(symbols) ? symbols : [])
            .map(function (symbol) {
                return String(symbol || "").trim();
            })
            .filter(Boolean)));
        const nextChainSymbol = String(chainSymbol || "").trim().toUpperCase();
        if ((!uniqueSymbols.length && !nextChainSymbol) || typeof WebSocket === "undefined") {
            updateLiveStatus();
            return;
        }
        deltaSubscribedSymbols = uniqueSymbols;
        deltaChainSymbol = nextChainSymbol;
        deltaSocket = new WebSocket("wss://public-socket.india.delta.exchange");
        deltaSocket.onopen = function () {
            const subscribeSymbols = [];
            if (deltaChainSymbol) {
                subscribeSymbols.push(deltaChainSymbol);
            }
            uniqueSymbols.forEach(function (symbol) {
                if (subscribeSymbols.indexOf(symbol) === -1) {
                    subscribeSymbols.push(symbol);
                }
            });
            const chunkSize = 40;
            for (let index = 0; index < subscribeSymbols.length; index += chunkSize) {
                const chunk = subscribeSymbols.slice(index, index + chunkSize);
                deltaSocket.send(JSON.stringify({
                    type: "subscribe",
                    payload: {
                        channels: [{
                            name: "ticker",
                            symbols: chunk
                        }]
                    }
                }));
            }
            deltaSocket.send(JSON.stringify({ type: "enable_heartbeat" }));
            clearDeltaPingTimer();
            deltaPingTimer = setInterval(function () {
                if (!deltaSocket || deltaSocket.readyState !== WebSocket.OPEN) {
                    return;
                }
                try {
                    deltaSocket.send(JSON.stringify({ type: "ping" }));
                }
                catch (_error) {
                }
            }, 25000);
            setPill(sharkLive ? "Shark + Delta WS" : "Delta WS");
            setStatus(
                deltaChainSymbol
                    ? `Delta subscribed to ${deltaChainSymbol} (+${uniqueSymbols.length} contracts). Waiting for ticker...`
                    : `Delta subscribed to ${uniqueSymbols.length} contracts. Waiting for ticker...`,
                "warning"
            );
        };
        deltaSocket.onmessage = function (event) {
            onDeltaTickerMessage(event.data);
        };
        deltaSocket.onerror = function () {
            setStatus("Delta websocket error. Shark may still be live.", "warning");
        };
        deltaSocket.onclose = function () {
            clearDeltaPingTimer();
            deltaLive = false;
            updateLiveStatus();
        };
    }

    async function loadInstruments() {
        setPill("Loading");
        const result = await getJson("/api/arbitrage/instruments");
        const instruments = Array.isArray(result?.data?.instruments) ? result.data.instruments : [];
        if (!(sharedIds.instrument instanceof HTMLSelectElement)) {
            return;
        }
        if (!instruments.length) {
            sharedIds.instrument.innerHTML = `<option value="">No instruments found</option>`;
            updateFetchEnabled();
            return;
        }
        sharedIds.instrument.innerHTML = instruments.map(function (row) {
            const baseCoin = String(row.baseCoin || "").trim().toUpperCase();
            const quoteCoin = String(row.quoteCoin || "").trim().toUpperCase();
            const label = String(row.displayName || `${baseCoin}-${quoteCoin}`).trim();
            return `<option value="${escapeHtml(`${baseCoin}:${quoteCoin}`)}">${escapeHtml(label)}</option>`;
        }).join("");
        sharedIds.instrument.value = instruments.some(function (row) {
            return String(row.baseCoin || "").toUpperCase() === "BTC";
        }) ? "BTC:USDT" : String(sharedIds.instrument.options[0]?.value || "");
        setPill("Ready");
        await loadExpiries();
    }

    async function loadExpiries() {
        const instrument = parseSelectedInstrument();
        if (!(sharedIds.expiry instanceof HTMLSelectElement)) {
            return;
        }
        if (!instrument) {
            sharedIds.expiry.disabled = true;
            sharedIds.expiry.innerHTML = `<option value="">Select instrument first</option>`;
            updateFetchEnabled();
            return;
        }
        sharedIds.expiry.disabled = true;
        sharedIds.expiry.innerHTML = `<option value="">Loading expiries...</option>`;
        updateFetchEnabled();
        const query = new URLSearchParams({
            baseCoin: instrument.baseCoin,
            quoteCoin: instrument.quoteCoin
        });
        const result = await getJson(`/api/arbitrage/expiries?${query.toString()}`);
        const expiries = Array.isArray(result?.data?.expiries) ? result.data.expiries : [];
        if (!expiries.length) {
            sharedIds.expiry.innerHTML = `<option value="">No expiries found</option>`;
            updateFetchEnabled();
            return;
        }
        sharedIds.expiry.innerHTML = expiries.map(function (row) {
            return `<option value="${escapeHtml(String(row.deliveryTime))}">${escapeHtml(row.label)}</option>`;
        }).join("");
        sharedIds.expiry.disabled = false;
        updateFetchEnabled();
    }

    async function fetchCompareBoth() {
        const instrument = parseSelectedInstrument();
        const deliveryTime = Number(sharedIds.expiry?.value || 0);
        if (!instrument || !(deliveryTime > 0) || fetchInFlight) {
            return;
        }
        fetchInFlight = true;
        updateFetchEnabled();
        setPill("Fetching");
        setStatus("Fetching Shark and Delta put & call chains...", "warning");
        putBoard.setSidePill("Fetching");
        callBoard.setSidePill("Fetching");
        disconnectAllSockets();
        try {
            const query = new URLSearchParams({
                baseCoin: instrument.baseCoin,
                quoteCoin: instrument.quoteCoin,
                deliveryTime: String(deliveryTime)
            });
            const [putResult, callResult] = await Promise.all([
                getJson(`/api/arbitrage/compare-puts?${query.toString()}`),
                getJson(`/api/arbitrage/compare-calls?${query.toString()}`)
            ]);
            const putInfo = putBoard.loadFromApiResult(putResult);
            const callInfo = callBoard.loadFromApiResult(callResult);
            const tickerTopic = putInfo.tickerTopic || callInfo.tickerTopic;
            const chainSymbol = putInfo.deltaChainSymbol || callInfo.deltaChainSymbol;
            const deltaSymbols = [].concat(putInfo.deltaSymbols || [], callInfo.deltaSymbols || []);
            const hasWarning = putInfo.status === "warning" || callInfo.status === "warning";
            setStatus(`${putInfo.message} | ${callInfo.message}`, hasWarning ? "warning" : "success");
            connectSharkSocket(tickerTopic);
            connectDeltaSocket(deltaSymbols, chainSymbol);
        }
        catch (error) {
            setPill("Error");
            putBoard.setSidePill("Error");
            callBoard.setSidePill("Error");
            setStatus(error instanceof Error ? error.message : "Unable to fetch put/call compare.", "danger");
        }
        finally {
            fetchInFlight = false;
            updateFetchEnabled();
        }
    }

    sharedIds.instrument?.addEventListener("change", function () {
        void loadExpiries().catch(function (error) {
            setStatus(error instanceof Error ? error.message : "Unable to load expiries.", "danger");
        });
    });
    sharedIds.expiry?.addEventListener("change", updateFetchEnabled);
    sharedIds.fetchButton?.addEventListener("click", function () {
        void fetchCompareBoth();
    });
    window.addEventListener("beforeunload", disconnectAllSockets);

    void loadInstruments().catch(function (error) {
        setPill("Error");
        setStatus(error instanceof Error ? error.message : "Unable to load instruments.", "danger");
        if (sharedIds.instrument instanceof HTMLSelectElement) {
            sharedIds.instrument.innerHTML = `<option value="">Failed to load</option>`;
        }
    });
})();
