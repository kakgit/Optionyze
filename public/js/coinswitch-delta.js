(function () {
    const DELTA_MIN = 0.05;
    const DELTA_MAX = 0.80;
    const CROSS_EDGE_MIN = 5;


    const sharedIds = {
        instrument: document.getElementById("ddlArbitrageInstrument"),
        expiry: document.getElementById("ddlArbitrageExpiry"),
        fetchButton: document.getElementById("btnArbitrageFetch"),
        status: document.getElementById("arbitragePageStatus"),
        statusPill: document.getElementById("arbitrageStatusPill"),
        orderUserName: document.getElementById("ddlOrderUserName"),
        orderMultiplier: document.getElementById("txtOrderMultiplier"),
        placeCallButton: document.getElementById("btnPlaceCallOrders"),
        placePutButton: document.getElementById("btnPlacePutOrders")
    };

    const ORDER_PROFILE_STORAGE_KEY = "coinswitchDeltaOrderProfileId";
    let orderProfiles = [];
    let deltaSocket = null;
    let deltaSubscribedSymbols = [];
    let deltaChainSymbol = "";
    let deltaPingTimer = null;
    let coinswitchLive = false;
    let coinswitchSocket = null;
    let coinswitchSubscribedSymbols = [];
    let coinswitchPingTimer = null;
    let coinswitchReconnectTimer = null;
    let coinswitchSocketConnected = false;
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
        if (coinswitchLive && deltaLive) {
            setPill("Live both");
            setStatus("CoinSwitch quotes and Delta tickers are live for puts and calls.", "success");
            return;
        }
        if (coinswitchLive) {
            setPill("Live CoinSwitch");
            setStatus("CoinSwitch quotes are live via websocket. Waiting for Delta...", "success");
            return;
        }
        if (deltaLive) {
            setPill("Live Delta");
            setStatus("Delta ticker is live. Waiting for CoinSwitch websocket...", "warning");
            return;
        }
        setPill("Waiting");
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

    function toFiniteNumberOrNull(value) {
        if (value === null || value === undefined || value === "") {
            return null;
        }
        const numberValue = Number(value);
        return Number.isFinite(numberValue) ? numberValue : null;
    }

    async function getJson(url) {
        const response = await fetch(url, {
            headers: { Accept: "application/json" },
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
            clearAlertsButton: document.getElementById(config.clearAlertsButtonId),
            selectAll: document.getElementById(config.selectAllId)
        };

        let compareRowsByCsSymbol = new Map();
        let compareRowsByDeltaSymbol = new Map();
        let crossActiveByStrike = new Map();
        let crossAlerts = [];
        let chainMeta = null;
        const selectedSymbols = new Set();

        function setSidePill(text) {
            if (ids.statusPill) {
                ids.statusPill.textContent = String(text || "Idle");
            }
        }

        function notifySelectionChange() {
            if (typeof config.onSelectionChange === "function") {
                config.onSelectionChange();
            }
        }

        function syncSelectAllCheckbox(filteredRows) {
            if (!(ids.selectAll instanceof HTMLInputElement)) {
                return;
            }
            const rows = Array.isArray(filteredRows) ? filteredRows : getFilteredCompareRows();
            const selectable = rows.filter(function (row) {
                return String(row?.coinswitch?.symbol || "").trim()
                    && String(row?.delta?.symbol || "").trim()
                    && Number(row?.coinswitch?.bid) > 0
                    && Number(row?.delta?.ask) > 0;
            });
            const selectedCount = selectable.filter(function (row) {
                return selectedSymbols.has(String(row.coinswitch.symbol).trim().toUpperCase());
            }).length;
            ids.selectAll.checked = selectable.length > 0 && selectedCount === selectable.length;
            ids.selectAll.indeterminate = selectedCount > 0 && selectedCount < selectable.length;
            ids.selectAll.disabled = selectable.length === 0;
        }

        function getCoinSwitchSymbols() {
            return Array.from(compareRowsByCsSymbol.keys());
        }

        function getSelectedOrderLegs() {
            return getFilteredCompareRows()
                .filter(function (row) {
                    const symbol = String(row?.coinswitch?.symbol || "").trim().toUpperCase();
                    return symbol && selectedSymbols.has(symbol);
                })
                .map(function (row) {
                    return {
                        strike: Number(row.strike),
                        coinswitchSymbol: String(row?.coinswitch?.symbol || "").trim().toUpperCase(),
                        deltaSymbol: String(row?.delta?.symbol || "").trim().toUpperCase(),
                        coinswitchLimitPrice: Number(row?.coinswitch?.bid),
                        deltaLimitPrice: Number(row?.delta?.ask)
                    };
                })
                .filter(function (leg) {
                    return leg.coinswitchSymbol
                        && leg.deltaSymbol
                        && Number.isFinite(leg.coinswitchLimitPrice)
                        && leg.coinswitchLimitPrice > 0
                        && Number.isFinite(leg.deltaLimitPrice)
                        && leg.deltaLimitPrice > 0;
                });
        }

        function getSelectedCount() {
            return getSelectedOrderLegs().length;
        }

        function clearSelection() {
            selectedSymbols.clear();
            if (ids.selectAll instanceof HTMLInputElement) {
                ids.selectAll.checked = false;
                ids.selectAll.indeterminate = false;
            }
            notifySelectionChange();
        }

        function isInDeltaRange(delta) {
            const absoluteDelta = Math.abs(Number(delta));
            return Number.isFinite(absoluteDelta) && absoluteDelta >= DELTA_MIN && absoluteDelta <= DELTA_MAX;
        }

        function getFilteredCompareRows() {
            return Array.from(compareRowsByCsSymbol.values())
                .filter(function (row) {
                    return isInDeltaRange(row?.coinswitch?.delta);
                })
                .sort(function (left, right) {
                    return Number(left.strike || 0) - Number(right.strike || 0);
                });
        }

        function getCrossEdge(row) {
            const csBid = Number(row?.coinswitch?.bid);
            const deltaAsk = Number(row?.delta?.ask);
            if (!Number.isFinite(csBid) || !Number.isFinite(deltaAsk)) {
                return NaN;
            }
            return csBid - deltaAsk;
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
            const selectedCount = getSelectedCount();
            let text = `${chainMeta.expiryLabel || "-"} · ${filteredCount}/${total} ${sideLabel}s in |Δ| ${DELTA_MIN.toFixed(2)}–${DELTA_MAX.toFixed(2)} · Delta matched ${matched}/${total}`;
            if (selectedCount > 0) {
                text += ` · selected ${selectedCount}`;
            }
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
                            CoinSwitch Bid ${escapeHtml(fmtNumber(alert.csBid, 2))}
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
            const csBid = Number(row?.coinswitch?.bid);
            const deltaAsk = Number(row?.delta?.ask);
            const now = new Date();
            crossAlerts.unshift({
                id: `${config.side}-${row.strike}-${now.getTime()}`,
                timeLabel: formatDateTime(now),
                strike: Number(row.strike),
                csBid: csBid,
                deltaAsk: deltaAsk,
                edge: csBid - deltaAsk
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
                ids.tableBody.innerHTML = `<tr><td colspan="7" class="arbitrage-empty-cell">${escapeHtml(emptyMessage || `No ${sideLabel} strikes in the selected delta range.`)}</td></tr>`;
                syncSelectAllCheckbox([]);
                return;
            }
            ids.tableBody.innerHTML = list.map(function (row) {
                const symbol = String(row?.coinswitch?.symbol || "").trim().toUpperCase();
                const crossed = shouldAlertCross(row);
                const canSelect = Boolean(symbol)
                    && Boolean(String(row?.delta?.symbol || "").trim())
                    && Number(row?.coinswitch?.bid) > 0
                    && Number(row?.delta?.ask) > 0;
                const checked = canSelect && selectedSymbols.has(symbol);
                return `
                    <tr data-symbol="${escapeHtml(symbol)}" class="${crossed ? "arbitrage-row-crossed" : ""}">
                        <td class="arbitrage-col-select">
                            <input type="checkbox" class="arbitrage-row-select" data-symbol="${escapeHtml(symbol)}" ${checked ? "checked" : ""} ${canSelect ? "" : "disabled"} aria-label="Select strike ${escapeHtml(fmtNumber(row.strike, 0))}" />
                        </td>
                        <td class="arbitrage-side-shark" data-field="cs-delta">${escapeHtml(fmtNumber(row?.coinswitch?.delta, 4))}</td>
                        <td>${escapeHtml(fmtNumber(row.strike, 0))}</td>
                        <td class="arbitrage-side-shark" data-field="cs-bid">${escapeHtml(fmtNumber(row?.coinswitch?.bid, 2))}</td>
                        <td class="arbitrage-side-shark" data-field="cs-ask">${escapeHtml(fmtNumber(row?.coinswitch?.ask, 2))}</td>
                        <td class="arbitrage-side-delta" data-field="delta-bid">${escapeHtml(fmtNumber(row?.delta?.bid, 2))}</td>
                        <td class="arbitrage-side-delta" data-field="delta-ask">${escapeHtml(fmtNumber(row?.delta?.ask, 2))}</td>
                    </tr>
                `;
            }).join("");

            ids.tableBody.querySelectorAll("input.arbitrage-row-select").forEach(function (checkbox) {
                checkbox.addEventListener("change", function (event) {
                    const target = event.currentTarget;
                    const symbol = String(target?.dataset?.symbol || "").trim().toUpperCase();
                    if (!symbol) {
                        return;
                    }
                    if (target.checked) {
                        selectedSymbols.add(symbol);
                    }
                    else {
                        selectedSymbols.delete(symbol);
                    }
                    syncSelectAllCheckbox();
                    updateChainMeta(getFilteredCompareRows().length);
                    notifySelectionChange();
                });
            });
            syncSelectAllCheckbox(list);
        }

        function refreshFilteredTable(emptyMessage) {
            const filtered = getFilteredCompareRows();
            const visibleSymbols = new Set(filtered.map(function (row) {
                return String(row?.coinswitch?.symbol || "").trim().toUpperCase();
            }).filter(Boolean));
            Array.from(selectedSymbols).forEach(function (symbol) {
                if (!visibleSymbols.has(symbol)) {
                    selectedSymbols.delete(symbol);
                }
            });
            renderCompareRows(filtered, emptyMessage);
            updateChainMeta(filtered.length);
            evaluateCrossings();
            notifySelectionChange();
            return filtered.length;
        }

        function applyCoinSwitchQuote(quote) {
            const symbol = String(quote?.symbol || "").trim().toUpperCase();
            if (!symbol || !compareRowsByCsSymbol.has(symbol)) {
                return false;
            }
            const current = compareRowsByCsSymbol.get(symbol) || {};
            const nextDelta = toFiniteNumberOrNull(quote?.delta);
            const nextBid = toFiniteNumberOrNull(quote?.bid);
            const nextAsk = toFiniteNumberOrNull(quote?.ask);
            const coinswitch = {
                ...(current.coinswitch || {}),
                symbol: String(current?.coinswitch?.symbol || symbol).trim().toUpperCase(),
                delta: nextDelta !== null ? nextDelta : current?.coinswitch?.delta,
                bid: nextBid !== null ? nextBid : current?.coinswitch?.bid,
                ask: nextAsk !== null ? nextAsk : current?.coinswitch?.ask
            };
            compareRowsByCsSymbol.set(symbol, {
                ...current,
                strike: current.strike,
                coinswitch: coinswitch,
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
            const csSymbol = compareRowsByDeltaSymbol.get(deltaSymbol);
            const current = compareRowsByCsSymbol.get(csSymbol);
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
            compareRowsByCsSymbol.set(csSymbol, {
                ...current,
                strike: current.strike,
                coinswitch: current.coinswitch || null,
                delta: nextDelta
            });
            return true;
        }

        function loadFromApiResult(result) {
            const rows = Array.isArray(result?.data?.rows) ? result.data.rows : [];
            compareRowsByCsSymbol = new Map();
            compareRowsByDeltaSymbol = new Map();
            crossActiveByStrike = new Map();
            crossAlerts = [];
            clearSelection();
            renderCrossAlerts();
            const deltaSymbols = [];
            rows.forEach(function (row) {
                const csSymbol = String(row?.coinswitch?.symbol || "").trim().toUpperCase();
                if (!csSymbol) {
                    return;
                }
                compareRowsByCsSymbol.set(csSymbol, row);
                const deltaSymbolRaw = String(row?.delta?.symbol || "").trim();
                const deltaSymbol = deltaSymbolRaw.toUpperCase();
                if (deltaSymbol) {
                    compareRowsByDeltaSymbol.set(deltaSymbol, csSymbol);
                    deltaSymbols.push(deltaSymbolRaw || deltaSymbol);
                }
            });
            chainMeta = {
                expiryLabel: String(result?.data?.expiryLabel || "-"),
                totalRows: rows.length,
                deltaMatchedCount: Number(result?.data?.deltaMatchedCount || 0),
                deltaRowCount: Number(result?.data?.deltaRowCount || 0),
                deltaError: result?.data?.deltaError ? String(result.data.deltaError) : "",
                deltaChainSymbol: String(result?.data?.deltaChainSymbol || "")
            };
            refreshFilteredTable(`Loaded x1000 ${sideLabel}s. Waiting for live CoinSwitch |Δ| in range 0.05–0.80...`);
            setSidePill(rows.length ? "Loaded" : "Empty");
            return {
                deltaChainSymbol: String(result?.data?.deltaChainSymbol || ""),
                deltaSymbols: deltaSymbols,
                message: String(result?.message || ""),
                status: String(result?.status || "success")
            };
        }

        ids.clearAlertsButton?.addEventListener("click", clearCrossAlerts);
        ids.selectAll?.addEventListener("change", function (event) {
            const checked = Boolean(event.currentTarget?.checked);
            const filtered = getFilteredCompareRows();
            filtered.forEach(function (row) {
                const symbol = String(row?.coinswitch?.symbol || "").trim().toUpperCase();
                const canSelect = Boolean(symbol)
                    && Boolean(String(row?.delta?.symbol || "").trim())
                    && Number(row?.coinswitch?.bid) > 0
                    && Number(row?.delta?.ask) > 0;
                if (!canSelect) {
                    return;
                }
                if (checked) {
                    selectedSymbols.add(symbol);
                }
                else {
                    selectedSymbols.delete(symbol);
                }
            });
            renderCompareRows(filtered);
            updateChainMeta(filtered.length);
            notifySelectionChange();
        });

        return {
            side: config.side,
            loadFromApiResult: loadFromApiResult,
            applyCoinSwitchQuote: applyCoinSwitchQuote,
            applyDeltaTicker: applyDeltaTicker,
            refreshFilteredTable: refreshFilteredTable,
            setSidePill: setSidePill,
            getSelectedOrderLegs: getSelectedOrderLegs,
            getSelectedCount: getSelectedCount,
            getCoinSwitchSymbols: getCoinSwitchSymbols,
            clearSelection: clearSelection
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
        clearAlertsButtonId: "btnPutClearAlerts",
        selectAllId: "chkSelectAllPuts",
        onSelectionChange: updateOrderControlsEnabled
    });
    const callBoard = createCompareSide({
        side: "call",
        sideLabel: "call",
        tableBodyId: "tBodyArbitrageCalls",
        metaId: "callMeta",
        statusPillId: "callStatusPill",
        alertsListId: "callAlertsList",
        alertCountId: "callAlertCount",
        clearAlertsButtonId: "btnCallClearAlerts",
        selectAllId: "chkSelectAllCalls",
        onSelectionChange: updateOrderControlsEnabled
    });
    sideBoards.push(putBoard, callBoard);

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
                board.refreshFilteredTable("Waiting for live CoinSwitch |Δ| in range 0.05–0.80...");
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

    function disconnectAllFeeds() {
        disconnectDeltaSocket();
        disconnectCoinSwitchSocket();
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
            setPill(coinswitchLive ? "CS + Delta WS" : "Delta WS");
            setStatus(
                deltaChainSymbol
                    ? `Delta subscribed to ${deltaChainSymbol}. Waiting for ticker...`
                    : `Delta subscribed to ${uniqueSymbols.length} contracts. Waiting for ticker...`,
                "warning"
            );
        };
        deltaSocket.onmessage = function (event) {
            onDeltaTickerMessage(event.data);
        };
        deltaSocket.onerror = function () {
            setStatus("Delta websocket error. CoinSwitch poll may still be live.", "warning");
        };
        deltaSocket.onclose = function () {
            clearDeltaPingTimer();
            deltaLive = false;
            updateLiveStatus();
        };
    }

    function clearCoinSwitchPingTimer() {
        if (coinswitchPingTimer) {
            clearInterval(coinswitchPingTimer);
            coinswitchPingTimer = null;
        }
    }

    function disconnectCoinSwitchSocket() {
        clearCoinSwitchPingTimer();
        if (coinswitchReconnectTimer) {
            clearTimeout(coinswitchReconnectTimer);
            coinswitchReconnectTimer = null;
        }
        coinswitchSocketConnected = false;
        coinswitchSubscribedSymbols = [];
        if (coinswitchSocket) {
            try {
                coinswitchSocket.onopen = null;
                coinswitchSocket.onmessage = null;
                coinswitchSocket.onerror = null;
                coinswitchSocket.onclose = null;
                coinswitchSocket.close();
            }
            catch (_error) {
            }
        }
        coinswitchSocket = null;
    }

    function onCoinSwitchTickerMessage(raw) {
        let message = null;
        try {
            message = JSON.parse(String(raw || ""));
        }
        catch (_error) {
            return;
        }
        const data = message?.data;
        if (!data || typeof data !== "object" || !data.symbol) {
            return;
        }
        const quote = {
            symbol: String(data.symbol || "").trim(),
            bid: toFiniteNumberOrNull(data.bidPrice),
            ask: toFiniteNumberOrNull(data.askPrice),
            delta: toFiniteNumberOrNull(data.delta)
        };
        let changed = false;
        sideBoards.forEach(function (board) {
            if (board.applyCoinSwitchQuote(quote)) {
                changed = true;
            }
        });
        if (!changed) {
            return;
        }
        if (!coinswitchLive) {
            coinswitchLive = true;
            updateLiveStatus();
        }
        sideBoards.forEach(function (board) {
            board.refreshFilteredTable("Waiting for live CoinSwitch |Δ| in range 0.05–0.80...");
        });
    }

    function connectCoinSwitchSocket(symbols) {
        disconnectCoinSwitchSocket();
        const uniqueSymbols = Array.from(new Set((Array.isArray(symbols) ? symbols : [])
            .map(function (symbol) {
                return String(symbol || "").trim().toUpperCase();
            })
            .filter(Boolean)));
        if (!uniqueSymbols.length || typeof WebSocket === "undefined") {
            return;
        }
        coinswitchSubscribedSymbols = uniqueSymbols;
        const socket = new WebSocket("wss://stream.bybit.com/v5/public/option");
        coinswitchSocket = socket;
        socket.onopen = function () {
            const chunkSize = 40;
            for (let index = 0; index < uniqueSymbols.length; index += chunkSize) {
                const chunk = uniqueSymbols.slice(index, index + chunkSize);
                try {
                    socket.send(JSON.stringify({
                        op: "subscribe",
                        args: chunk.map(function (symbol) {
                            return `tickers.${symbol}`;
                        })
                    }));
                }
                catch (_error) {
                }
            }
            coinswitchSocketConnected = true;
            setStatus(`CoinSwitch websocket connected to ${uniqueSymbols.length} symbols. Waiting for data...`, "warning");
            clearCoinSwitchPingTimer();
            coinswitchPingTimer = setInterval(function () {
                if (coinswitchSocket && coinswitchSocket.readyState === WebSocket.OPEN) {
                    try {
                        coinswitchSocket.send(JSON.stringify({ op: "ping" }));
                    }
                    catch (_error) {
                    }
                }
            }, 20000);
        };
        socket.onmessage = function (event) {
            onCoinSwitchTickerMessage(event.data);
        };
        socket.onerror = function () {
            setStatus("CoinSwitch websocket error. Reconnecting...", "warning");
        };
        socket.onclose = function () {
            clearCoinSwitchPingTimer();
            coinswitchSocketConnected = false;
            coinswitchSocket = null;
            coinswitchLive = false;
            updateLiveStatus();
            if (coinswitchReconnectTimer) {
                return;
            }
            coinswitchReconnectTimer = setTimeout(function () {
                coinswitchReconnectTimer = null;
                if (coinswitchSubscribedSymbols.length) {
                    connectCoinSwitchSocket(coinswitchSubscribedSymbols);
                }
            }, 3000);
        };
    }

    async function loadInstruments() {
        setPill("Loading");
        const result = await getJson("/api/arbitrage/coinswitch/instruments");
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
        const result = await getJson(`/api/arbitrage/coinswitch/expiries?${query.toString()}`);
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
        setStatus("Fetching CoinSwitch and Delta put & call chains...", "warning");
        putBoard.setSidePill("Fetching");
        callBoard.setSidePill("Fetching");
        disconnectAllFeeds();
        try {
            const query = new URLSearchParams({
                baseCoin: instrument.baseCoin,
                quoteCoin: instrument.quoteCoin,
                deliveryTime: String(deliveryTime)
            });
            const [putResult, callResult] = await Promise.all([
                getJson(`/api/arbitrage/coinswitch/compare-puts?${query.toString()}`),
                getJson(`/api/arbitrage/coinswitch/compare-calls?${query.toString()}`)
            ]);
            const putInfo = putBoard.loadFromApiResult(putResult);
            const callInfo = callBoard.loadFromApiResult(callResult);
            const chainSymbol = putInfo.deltaChainSymbol || callInfo.deltaChainSymbol;
            const deltaSymbols = [].concat(putInfo.deltaSymbols || [], callInfo.deltaSymbols || []);
            const coinswitchSymbols = Array.from(new Set([]
                .concat(putBoard.getCoinSwitchSymbols(), callBoard.getCoinSwitchSymbols())
                .map(function (symbol) {
                    return String(symbol || "").trim().toUpperCase();
                })
                .filter(Boolean)));
            const hasWarning = putInfo.status === "warning" || callInfo.status === "warning";
            setStatus(`${putInfo.message} | ${callInfo.message}`, hasWarning ? "warning" : "success");
            connectDeltaSocket(deltaSymbols, chainSymbol);
            connectCoinSwitchSocket(coinswitchSymbols);
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
    sharedIds.orderUserName?.addEventListener("change", function () {
        const profileId = String(sharedIds.orderUserName?.value || "").trim();
        if (profileId) {
            try {
                sessionStorage.setItem(ORDER_PROFILE_STORAGE_KEY, profileId);
            }
            catch (_error) {
            }
        }
        updateOrderControlsEnabled();
        void loadWalletBalances().catch(function () { return undefined; });
    });
    sharedIds.orderMultiplier?.addEventListener("input", updateOrderControlsEnabled);
    sharedIds.placeCallButton?.addEventListener("click", function () {
        void handlePlaceOrders("call");
    });
    sharedIds.placePutButton?.addEventListener("click", function () {
        void handlePlaceOrders("put");
    });
    document.getElementById("btnRefreshOpenPositions")?.addEventListener("click", function () {
        void loadOpenPositions();
    });
    window.addEventListener("beforeunload", disconnectAllFeeds);

    function getOrderMultiplier() {
        const value = Number(sharedIds.orderMultiplier?.value);
        if (!Number.isFinite(value) || value < 1) {
            return 0;
        }
        return Math.floor(value);
    }

    function getSelectedOrderProfile() {
        const profileId = String(sharedIds.orderUserName?.value || "").trim();
        return orderProfiles.find(function (profile) {
            return profile.profileId === profileId;
        }) || null;
    }

    function updateOrderControlsEnabled() {
        const profile = getSelectedOrderProfile();
        const multiplier = getOrderMultiplier();
        const canBase = Boolean(profile) && multiplier >= 1;
        const openSides = getOpenSidesForSelectedProfile();
        if (sharedIds.placeCallButton instanceof HTMLButtonElement) {
            sharedIds.placeCallButton.disabled = !(canBase && callBoard.getSelectedCount() === 1 && !openSides.call);
            sharedIds.placeCallButton.title = openSides.call
                ? "This username already has an open CALL position"
                : (callBoard.getSelectedCount() > 1 ? "Select only one CALL strike" : "");
        }
        if (sharedIds.placePutButton instanceof HTMLButtonElement) {
            sharedIds.placePutButton.disabled = !(canBase && putBoard.getSelectedCount() === 1 && !openSides.put);
            sharedIds.placePutButton.title = openSides.put
                ? "This username already has an open PUT position"
                : (putBoard.getSelectedCount() > 1 ? "Select only one PUT strike" : "");
        }
    }

    let openPositions = [];

    function getOpenSidesForSelectedProfile() {
        const profileId = String(sharedIds.orderUserName?.value || "").trim();
        const sides = { call: false, put: false };
        openPositions.forEach(function (position) {
            if (profileId && position.profileId !== profileId) {
                return;
            }
            if (!profileId) {
                return;
            }
            if (position.side === "call") {
                sides.call = true;
            }
            if (position.side === "put") {
                sides.put = true;
            }
        });
        return sides;
    }

    function renderOpenPositions() {
        const tableBody = document.getElementById("openPositionsTableBody");
        const countPill = document.getElementById("openPositionsCount");
        if (countPill) {
            countPill.textContent = String(openPositions.length);
        }
        if (!tableBody) {
            return;
        }
        if (!openPositions.length) {
            tableBody.innerHTML = '<tr><td colspan="7" class="cs-api-empty">No open positions yet.</td></tr>';
            return;
        }
        tableBody.innerHTML = openPositions.map(function (position) {
            const openedAt = position.openedAt ? new Date(position.openedAt).toLocaleString("en-IN") : "-";
            return `
                <tr>
                    <td>${escapeHtml(position.userName || "-")}</td>
                    <td><span class="open-pos-side ${escapeHtml(position.side)}">${escapeHtml(String(position.side || "").toUpperCase())}</span></td>
                    <td>${escapeHtml(fmtNumber(position.strike, 0))} <span style="color:var(--app-muted)">×${escapeHtml(String(position.multiplier || 1))}</span></td>
                    <td>
                        <div class="open-pos-pair">
                            <strong>Sell ${escapeHtml(position.coinswitchSymbol)}</strong>
                            <span>qty ${escapeHtml(String(position.coinswitchQty))} @ ${escapeHtml(fmtNumber(position.coinswitchEntryPrice, 2))}</span>
                        </div>
                    </td>
                    <td>
                        <div class="open-pos-pair">
                            <strong>Buy ${escapeHtml(position.deltaSymbol)}</strong>
                            <span>size ${escapeHtml(String(position.deltaSize))} @ ${escapeHtml(fmtNumber(position.deltaEntryPrice, 2))}</span>
                        </div>
                    </td>
                    <td>${escapeHtml(openedAt)}</td>
                    <td>
                        <button class="app-ghost-btn" type="button" data-action="remove-position" data-id="${escapeHtml(position.positionId)}">Remove</button>
                    </td>
                </tr>
            `;
        }).join("");

        tableBody.querySelectorAll("button[data-action='remove-position']").forEach(function (button) {
            button.addEventListener("click", function (event) {
                const positionId = String(event.currentTarget?.dataset?.id || "").trim();
                void removeOpenPosition(positionId);
            });
        });
    }

    async function loadOpenPositions() {
        const profileId = String(sharedIds.orderUserName?.value || "").trim();
        const query = new URLSearchParams();
        // Show all account positions in the section; filter buttons by selected profile.
        try {
            const response = await fetch(`/api/arbitrage/coinswitch/open-positions?${query.toString()}`, {
                credentials: "same-origin"
            });
            const result = await response.json();
            if (!response.ok || result.status !== "success") {
                throw new Error(result.message || "Unable to load open positions.");
            }
            openPositions = Array.isArray(result?.data?.positions) ? result.data.positions : [];
            renderOpenPositions();
            updateOrderControlsEnabled();
            void profileId;
        }
        catch (_error) {
            openPositions = [];
            renderOpenPositions();
            updateOrderControlsEnabled();
        }
        void loadImportedPositions().catch(function () { return undefined; });
    }

    function escapeHtmlValue(value) {
        return String(value === undefined || value === null ? "" : value)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll("\"", "&quot;")
            .replaceAll("'", "&#39;");
    }

    function renderImportedGroup(tableBody, positions) {
        if (!tableBody) {
            return;
        }
        if (!positions.length) {
            tableBody.innerHTML = `<tr><td colspan="10" class="cs-api-empty">No imported ${String(tableBody.id).indexOf("Calls") >= 0 ? "call" : "put"} positions.</td></tr>`;
            return;
        }
        tableBody.innerHTML = positions.map(function (position) {
            const importedAt = position.importedAt ? new Date(position.importedAt).toLocaleString("en-IN") : "-";
            return `
                <tr>
                    <td>${escapeHtmlValue(position.userName || "-")}</td>
                    <td><span class="imported-source ${escapeHtmlValue(position.source)}">${escapeHtmlValue(String(position.source || "").toUpperCase())}</span></td>
                    <td>${escapeHtmlValue(position.symbol)}</td>
                    <td>${escapeHtmlValue(fmtNumber(position.strike, 0))}</td>
                    <td>${escapeHtmlValue(position.size)}</td>
                    <td>${escapeHtmlValue(fmtNumber(position.entryPrice, 2))}</td>
                    <td>${escapeHtmlValue(fmtNumber(position.markPrice, 2))}</td>
                    <td>${escapeHtmlValue(String(position.positionSide || "long").toUpperCase())}</td>
                    <td>${escapeHtmlValue(importedAt)}</td>
                    <td>
                        <button class="app-ghost-btn" type="button" data-action="remove-imported" data-id="${escapeHtmlValue(position.importId)}">Remove</button>
                    </td>
                </tr>
            `;
        }).join("");

        tableBody.querySelectorAll("button[data-action='remove-imported']").forEach(function (button) {
            button.addEventListener("click", function (event) {
                const importId = String(event.currentTarget?.dataset?.id || "").trim();
                void removeImportedPosition(importId);
            });
        });
    }

    function renderImportedPositions(positions) {
        const arrCalls = positions.filter(function (position) { return position.side === "call"; });
        const arrPuts = positions.filter(function (position) { return position.side !== "call"; });
        const callsCount = document.getElementById("importedCallsCount");
        const putsCount = document.getElementById("importedPutsCount");
        if (callsCount) {
            callsCount.textContent = String(arrCalls.length);
        }
        if (putsCount) {
            putsCount.textContent = String(arrPuts.length);
        }
        renderImportedGroup(document.getElementById("importedCallsTableBody"), arrCalls);
        renderImportedGroup(document.getElementById("importedPutsTableBody"), arrPuts);
    }

    async function loadImportedPositions() {
        try {
            const response = await fetch("/api/arbitrage/coinswitch/imported-positions", {
                credentials: "same-origin"
            });
            const result = await response.json();
            if (!response.ok || result.status !== "success") {
                throw new Error(result.message || "Unable to load imported positions.");
            }
            renderImportedPositions(Array.isArray(result?.data?.positions) ? result.data.positions : []);
        }
        catch (_error) {
            renderImportedPositions([]);
        }
    }

    async function removeImportedPosition(importId) {
        if (!importId) {
            return;
        }
        const confirmed = window.confirm("Remove this imported position from the Open Positions book? (Does not close exchange orders.)");
        if (!confirmed) {
            return;
        }
        try {
            const response = await fetch(`/api/arbitrage/coinswitch/imported-positions/${encodeURIComponent(importId)}`, {
                method: "DELETE",
                credentials: "same-origin"
            });
            const result = await response.json();
            if (!response.ok || result.status !== "success") {
                throw new Error(result.message || "Unable to remove imported position.");
            }
            setStatus(result.message || "Imported position removed.", "success");
            await loadImportedPositions();
        }
        catch (error) {
            setStatus(error instanceof Error ? error.message : "Unable to remove imported position.", "danger");
        }
    }

    function setBalancePill(pillId, outcome, labelPrefix) {
        const pill = document.getElementById(pillId);
        if (!pill) {
            return;
        }
        if (outcome && outcome.ok) {
            const vAmount = Number(outcome.availableBalance || 0);
            pill.textContent = `${labelPrefix} ${vAmount.toLocaleString("en-IN", { maximumFractionDigits: 2 })} ${outcome.currency || ""}`.trim();
            pill.classList.remove("balance-pill-error");
        }
        else {
            const vError = String((outcome && outcome.error) || "unavailable").slice(0, 40);
            pill.textContent = `${labelPrefix} !`;
            pill.title = `${labelPrefix}: ${vError}`;
            pill.classList.add("balance-pill-error");
        }
    }

    async function loadWalletBalances() {
        const profileId = String(sharedIds.orderUserName?.value || "").trim();
        const deltaPill = document.getElementById("deltaBalancePill");
        const csPill = document.getElementById("csBalancePill");
        if (!profileId) {
            if (deltaPill) {
                deltaPill.textContent = "Δ –";
                deltaPill.title = "Select a username to load Delta balance";
            }
            if (csPill) {
                csPill.textContent = "CS –";
                csPill.title = "Select a username to load CoinSwitch balance";
            }
            return;
        }
        try {
            const response = await fetch(`/api/arbitrage/coinswitch/wallet-balances?profileId=${encodeURIComponent(profileId)}`, {
                credentials: "same-origin"
            });
            const result = await response.json();
            if (!response.ok || result.status !== "success") {
                throw new Error(result.message || "Unable to load balances.");
            }
            setBalancePill("deltaBalancePill", result?.data?.delta, "Δ");
            setBalancePill("csBalancePill", result?.data?.coinswitch, "CS");
        }
        catch (_error) {
            setBalancePill("deltaBalancePill", null, "Δ");
            setBalancePill("csBalancePill", null, "CS");
        }
    }

    async function removeOpenPosition(positionId) {
        if (!positionId) {
            return;
        }
        const confirmed = window.confirm("Remove this paired position from the Open Positions book? (Does not close exchange orders.)");
        if (!confirmed) {
            return;
        }
        try {
            const response = await fetch(`/api/arbitrage/coinswitch/open-positions/${encodeURIComponent(positionId)}`, {
                method: "DELETE",
                credentials: "same-origin"
            });
            const result = await response.json();
            if (!response.ok || result.status !== "success") {
                throw new Error(result.message || "Unable to remove open position.");
            }
            setStatus(result.message || "Open position removed.", "success");
            await loadOpenPositions();
        }
        catch (error) {
            setStatus(error instanceof Error ? error.message : "Unable to remove open position.", "danger");
        }
    }

    function getLotSizing(baseCoin) {
        const coin = String(baseCoin || "").trim().toUpperCase();
        if (coin === "ETH") {
            return { coinswitchQtyPerLot: 0.1, deltaContractsPerLot: 10 };
        }
        return { coinswitchQtyPerLot: 0.01, deltaContractsPerLot: 10 };
    }

    const orderConfirm = {
        pending: null,
        placing: false,
        overlay: document.getElementById("orderConfirmOverlay"),
        modal: document.getElementById("orderConfirmModal"),
        title: document.getElementById("orderConfirmTitle"),
        hint: document.getElementById("orderConfirmHint"),
        status: document.getElementById("orderConfirmStatus"),
        meta: document.getElementById("orderConfirmMeta"),
        tableBody: document.getElementById("orderConfirmTableBody"),
        closeBtn: document.getElementById("btnCloseOrderConfirm"),
        cancelBtn: document.getElementById("btnCancelOrderConfirm"),
        submitBtn: document.getElementById("btnSubmitOrderConfirm")
    };

    function setOrderConfirmStatus(message, tone) {
        if (!orderConfirm.status) {
            return;
        }
        orderConfirm.status.textContent = String(message || "");
        orderConfirm.status.className = `cs-api-status show ${String(tone || "info")}`;
    }

    function hideOrderConfirmStatus() {
        if (!orderConfirm.status) {
            return;
        }
        orderConfirm.status.textContent = "";
        orderConfirm.status.className = "cs-api-status";
    }

    function closeOrderConfirmModal() {
        if (orderConfirm.placing) {
            return;
        }
        orderConfirm.overlay?.classList.remove("show");
        orderConfirm.modal?.classList.remove("show");
        if (orderConfirm.modal) {
            orderConfirm.modal.setAttribute("aria-hidden", "true");
        }
        orderConfirm.pending = null;
        hideOrderConfirmStatus();
    }

    function openOrderConfirmModal(pending) {
        orderConfirm.pending = pending;
        hideOrderConfirmStatus();
        if (orderConfirm.title) {
            orderConfirm.title.textContent = `Confirm ${String(pending.side).toUpperCase()} Orders`;
        }
        if (orderConfirm.hint) {
            orderConfirm.hint.textContent = `Sell CoinSwitch @ bid and buy Delta @ ask for ${pending.userName}.`;
        }
        if (orderConfirm.meta) {
            orderConfirm.meta.textContent = `${pending.baseCoin} · multiplier ${pending.multiplier} · CS qty ${pending.coinswitchQty} · Delta size ${pending.deltaSize} · ${pending.legs.length} strike${pending.legs.length === 1 ? "" : "s"}`;
        }
        if (orderConfirm.tableBody) {
            orderConfirm.tableBody.innerHTML = pending.legs.map(function (leg) {
                return `
                    <tr>
                        <td>${escapeHtml(fmtNumber(leg.strike, 0))}</td>
                        <td>Sell ${escapeHtml(leg.coinswitchSymbol)} @ ${escapeHtml(fmtNumber(leg.coinswitchLimitPrice, 2))} × ${escapeHtml(String(pending.coinswitchQty))}</td>
                        <td>Buy ${escapeHtml(leg.deltaSymbol)} @ ${escapeHtml(fmtNumber(leg.deltaLimitPrice, 2))} × ${escapeHtml(String(pending.deltaSize))}</td>
                    </tr>
                `;
            }).join("");
        }
        if (orderConfirm.submitBtn instanceof HTMLButtonElement) {
            orderConfirm.submitBtn.disabled = false;
            orderConfirm.submitBtn.textContent = "Place Orders";
        }
        orderConfirm.overlay?.classList.add("show");
        orderConfirm.modal?.classList.add("show");
        if (orderConfirm.modal) {
            orderConfirm.modal.setAttribute("aria-hidden", "false");
        }
    }

    async function submitConfirmedOrders() {
        const pending = orderConfirm.pending;
        if (!pending || orderConfirm.placing) {
            return;
        }
        orderConfirm.placing = true;
        if (orderConfirm.submitBtn instanceof HTMLButtonElement) {
            orderConfirm.submitBtn.disabled = true;
            orderConfirm.submitBtn.textContent = "Placing...";
        }
        setOrderConfirmStatus(`Placing ${pending.legs.length} dual-leg ${pending.side.toUpperCase()} order${pending.legs.length === 1 ? "" : "s"}...`, "info");
        try {
            const response = await fetch("/api/arbitrage/coinswitch/place-dual-orders", {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    profileId: pending.profileId,
                    side: pending.side,
                    baseCoin: pending.baseCoin,
                    multiplier: pending.multiplier,
                    legs: pending.legs.map(function (leg) {
                        return {
                            strike: leg.strike,
                            coinswitchSymbol: leg.coinswitchSymbol,
                            deltaSymbol: leg.deltaSymbol,
                            coinswitchLimitPrice: leg.coinswitchLimitPrice,
                            deltaLimitPrice: leg.deltaLimitPrice
                        };
                    })
                })
            });
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.message || "Unable to place dual orders.");
            }
            const tone = result.status === "success" ? "success" : (result.status === "warning" ? "warning" : "danger");
            setOrderConfirmStatus(result.message || "Order placement finished.", tone === "danger" ? "error" : tone);
            setStatus(result.message || "Order placement finished.", tone);
            if (result.status === "success") {
                const board = pending.side === "call" ? callBoard : putBoard;
                board.clearSelection();
                board.refreshFilteredTable();
                await loadOpenPositions();
                updateOrderControlsEnabled();
                setTimeout(function () {
                    orderConfirm.placing = false;
                    closeOrderConfirmModal();
                }, 900);
                return;
            }
        }
        catch (error) {
            setOrderConfirmStatus(error instanceof Error ? error.message : "Unable to place dual orders.", "error");
            setStatus(error instanceof Error ? error.message : "Unable to place dual orders.", "danger");
        }
        finally {
            orderConfirm.placing = false;
            if (orderConfirm.submitBtn instanceof HTMLButtonElement) {
                orderConfirm.submitBtn.disabled = false;
                orderConfirm.submitBtn.textContent = "Place Orders";
            }
        }
    }

    function renderOrderUserNameOptions(profiles, preferredProfileId) {
        if (!(sharedIds.orderUserName instanceof HTMLSelectElement)) {
            return;
        }

        orderProfiles = Array.isArray(profiles) ? profiles.slice() : [];
        const savedId = preferredProfileId
            || (function () {
                try {
                    return sessionStorage.getItem(ORDER_PROFILE_STORAGE_KEY) || "";
                }
                catch (_error) {
                    return "";
                }
            })();

        if (!orderProfiles.length) {
            sharedIds.orderUserName.innerHTML = '<option value="">Add credentials via Manage API</option>';
            sharedIds.orderUserName.disabled = true;
            updateOrderControlsEnabled();
            return;
        }

        sharedIds.orderUserName.disabled = false;
        const options = ['<option value="">Select username</option>'].concat(
            orderProfiles.map(function (profile) {
                const selected = profile.profileId === savedId ? " selected" : "";
                return `<option value="${escapeHtmlAttr(profile.profileId)}"${selected}>${escapeHtmlAttr(profile.userName)}</option>`;
            })
        );
        sharedIds.orderUserName.innerHTML = options.join("");
        if (savedId && !orderProfiles.some(function (profile) { return profile.profileId === savedId; })) {
            sharedIds.orderUserName.value = "";
        }
        updateOrderControlsEnabled();
        void loadWalletBalances().catch(function () { return undefined; });
    }

    function escapeHtmlAttr(value) {
        return String(value || "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#39;");
    }

    async function loadOrderProfiles() {
        if (!(sharedIds.orderUserName instanceof HTMLSelectElement)) {
            return;
        }
        sharedIds.orderUserName.innerHTML = '<option value="">Loading...</option>';
        sharedIds.orderUserName.disabled = true;
        try {
            const response = await fetch("/api/account/cs-delta-api-profiles", { credentials: "same-origin" });
            const result = await response.json();
            if (!response.ok || result.status !== "success") {
                throw new Error(result.message || "Unable to load usernames.");
            }
            renderOrderUserNameOptions(Array.isArray(result.data) ? result.data : []);
        }
        catch (_error) {
            sharedIds.orderUserName.innerHTML = '<option value="">Failed to load usernames</option>';
            sharedIds.orderUserName.disabled = true;
            orderProfiles = [];
            updateOrderControlsEnabled();
        }
    }

    async function handlePlaceOrders(side) {
        const profile = getSelectedOrderProfile();
        const multiplier = getOrderMultiplier();
        const instrument = parseSelectedInstrument();
        const board = side === "call" ? callBoard : putBoard;
        const legs = board.getSelectedOrderLegs();

        if (!profile) {
            setStatus("Select a username before placing orders.", "warning");
            return;
        }
        if (multiplier < 1 || multiplier > 50) {
            setStatus("Multiplier must be a whole number between 1 and 50.", "warning");
            return;
        }
        if (!instrument) {
            setStatus("Select an instrument before placing orders.", "warning");
            return;
        }
        if (!legs.length) {
            setStatus(`Select one ${side.toUpperCase()} row before placing orders.`, "warning");
            return;
        }
        if (legs.length > 1) {
            setStatus(`Only one ${side.toUpperCase()} position is allowed per username. Select a single strike.`, "warning");
            return;
        }
        const openSides = getOpenSidesForSelectedProfile();
        if ((side === "call" && openSides.call) || (side === "put" && openSides.put)) {
            setStatus(`${profile.userName} already has an open ${side.toUpperCase()} position.`, "warning");
            return;
        }

        const lots = getLotSizing(instrument.baseCoin);
        openOrderConfirmModal({
            side: side,
            profileId: profile.profileId,
            userName: profile.userName,
            baseCoin: instrument.baseCoin,
            multiplier: multiplier,
            coinswitchQty: Number((lots.coinswitchQtyPerLot * multiplier).toFixed(8)),
            deltaSize: Math.max(1, Math.floor(lots.deltaContractsPerLot * multiplier)),
            legs: legs
        });
    }

    orderConfirm.closeBtn?.addEventListener("click", closeOrderConfirmModal);
    orderConfirm.cancelBtn?.addEventListener("click", closeOrderConfirmModal);
    orderConfirm.overlay?.addEventListener("click", closeOrderConfirmModal);
    orderConfirm.submitBtn?.addEventListener("click", function () {
        void submitConfirmedOrders();
    });

    const manageApi = (function createManageApi() {
        const EDIT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
        const DELETE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';

        const state = {
            profiles: [],
            editingProfileId: ""
        };

        const els = {
            openBtn: document.getElementById("btnManageApi"),
            overlay: document.getElementById("csApiOverlay"),
            modal: document.getElementById("csApiModal"),
            closeBtn: document.getElementById("btnCloseCsApiModal"),
            cancelBtn: document.getElementById("btnCancelCsApiForm"),
            refreshBtn: document.getElementById("btnRefreshCsApiProfiles"),
            form: document.getElementById("csApiProfileForm"),
            status: document.getElementById("csApiModalStatus"),
            tableBody: document.getElementById("csApiProfileTableBody"),
            secretHint: document.getElementById("csApiSecretHint"),
            userName: document.getElementById("csApiUserName"),
            deltaKey: document.getElementById("csApiDeltaKey"),
            deltaSecret: document.getElementById("csApiDeltaSecret"),
            coinswitchKey: document.getElementById("csApiCoinswitchKey"),
            coinswitchSecret: document.getElementById("csApiCoinswitchSecret")
        };

        function setModalStatus(message, tone) {
            if (!els.status) {
                return;
            }
            els.status.textContent = String(message || "");
            els.status.className = `cs-api-status show ${String(tone || "info")}`;
        }

        function hideModalStatus() {
            if (!els.status) {
                return;
            }
            els.status.textContent = "";
            els.status.className = "cs-api-status";
        }

        function getValue(el) {
            return String(el?.value || "").trim();
        }

        function setValue(el, value) {
            if (el) {
                el.value = String(value || "");
            }
        }

        function escapeHtml(value) {
            return String(value || "")
                .replaceAll("&", "&amp;")
                .replaceAll("<", "&lt;")
                .replaceAll(">", "&gt;")
                .replaceAll('"', "&quot;")
                .replaceAll("'", "&#39;");
        }

        function resetForm(keepEditing) {
            if (!keepEditing) {
                state.editingProfileId = "";
            }
            setValue(els.userName, "");
            setValue(els.deltaKey, "");
            setValue(els.deltaSecret, "");
            setValue(els.coinswitchKey, "");
            setValue(els.coinswitchSecret, "");
            if (els.secretHint) {
                els.secretHint.textContent = state.editingProfileId
                    ? "Leave key/secret fields blank to keep the current values."
                    : "All credential fields are required for new entries.";
            }
            if (els.deltaKey) {
                els.deltaKey.placeholder = "";
            }
            if (els.coinswitchKey) {
                els.coinswitchKey.placeholder = "";
            }
            if (els.cancelBtn) {
                els.cancelBtn.style.visibility = state.editingProfileId ? "visible" : "hidden";
            }
        }

        function openModal() {
            hideModalStatus();
            resetForm(false);
            els.overlay?.classList.add("show");
            els.modal?.classList.add("show");
            if (els.modal) {
                els.modal.setAttribute("aria-hidden", "false");
            }
            void loadProfiles();
        }

        function closeModal() {
            els.overlay?.classList.remove("show");
            els.modal?.classList.remove("show");
            if (els.modal) {
                els.modal.setAttribute("aria-hidden", "true");
            }
            resetForm(false);
            hideModalStatus();
        }

        async function loadProfiles() {
            if (els.tableBody) {
                els.tableBody.innerHTML = '<tr><td colspan="4" class="cs-api-empty">Loading...</td></tr>';
            }
            try {
                const response = await fetch("/api/account/cs-delta-api-profiles", { credentials: "same-origin" });
                const result = await response.json();
                if (!response.ok || result.status !== "success") {
                    throw new Error(result.message || "Unable to load API credentials.");
                }
                state.profiles = Array.isArray(result.data) ? result.data : [];
                renderTable();
                renderOrderUserNameOptions(state.profiles, String(sharedIds.orderUserName?.value || "").trim());
                setModalStatus(`Loaded ${state.profiles.length} credential set${state.profiles.length === 1 ? "" : "s"}.`, "success");
            }
            catch (error) {
                state.profiles = [];
                renderTable();
                renderOrderUserNameOptions([]);
                setModalStatus(error instanceof Error ? error.message : "Unable to load API credentials.", "error");
            }
        }

        function renderTable() {
            if (!els.tableBody) {
                return;
            }
            if (!state.profiles.length) {
                els.tableBody.innerHTML = '<tr><td colspan="4" class="cs-api-empty">No API credentials saved yet.</td></tr>';
                return;
            }

            els.tableBody.innerHTML = state.profiles.map(function (profile) {
                return `
                    <tr>
                        <td>${escapeHtml(profile.userName)}</td>
                        <td>${escapeHtml(profile.deltaApiKeyMasked || "-")}</td>
                        <td>${escapeHtml(profile.coinswitchApiKeyMasked || "-")}</td>
                        <td>
                            <div class="cs-api-actions">
                                <button class="cs-api-icon-btn" type="button" title="Edit" aria-label="Edit" data-action="edit" data-id="${escapeHtml(profile.profileId)}">${EDIT_ICON}</button>
                                <button class="cs-api-icon-btn danger" type="button" title="Delete" aria-label="Delete" data-action="delete" data-id="${escapeHtml(profile.profileId)}">${DELETE_ICON}</button>
                            </div>
                        </td>
                    </tr>
                `;
            }).join("");

            els.tableBody.querySelectorAll("button[data-action]").forEach(function (button) {
                button.addEventListener("click", handleRowAction);
            });
        }

        function beginEdit(profile) {
            state.editingProfileId = String(profile.profileId || "");
            setValue(els.userName, profile.userName || "");
            setValue(els.deltaKey, "");
            setValue(els.deltaSecret, "");
            setValue(els.coinswitchKey, "");
            setValue(els.coinswitchSecret, "");
            if (els.deltaKey) {
                els.deltaKey.placeholder = profile.deltaApiKeyMasked || "Leave blank to keep";
            }
            if (els.coinswitchKey) {
                els.coinswitchKey.placeholder = profile.coinswitchApiKeyMasked || "Leave blank to keep";
            }
            if (els.secretHint) {
                els.secretHint.textContent = "Leave key/secret fields blank to keep the current values.";
            }
            if (els.cancelBtn) {
                els.cancelBtn.style.visibility = "visible";
            }
            hideModalStatus();
            els.userName?.focus();
        }

        async function handleRowAction(event) {
            const button = event.currentTarget;
            const action = String(button?.dataset?.action || "");
            const profileId = String(button?.dataset?.id || "");
            const profile = state.profiles.find(function (row) {
                return row.profileId === profileId;
            });
            if (!profile) {
                return;
            }

            if (action === "edit") {
                beginEdit(profile);
                return;
            }

            if (action === "delete") {
                await deleteProfile(profile);
            }
        }

        async function deleteProfile(profile) {
            const confirmed = window.confirm(`Delete credentials for "${profile.userName}"?`);
            if (!confirmed) {
                return;
            }

            try {
                const response = await fetch(`/api/account/cs-delta-api-profiles/${encodeURIComponent(profile.profileId)}`, {
                    method: "DELETE",
                    credentials: "same-origin"
                });
                const result = await response.json();
                if (!response.ok || result.status !== "success") {
                    throw new Error(result.message || "Unable to delete API credentials.");
                }
                if (state.editingProfileId === profile.profileId) {
                    resetForm(false);
                }
                setModalStatus(result.message || "API credentials deleted successfully.", "success");
                await loadProfiles();
            }
            catch (error) {
                setModalStatus(error instanceof Error ? error.message : "Unable to delete API credentials.", "error");
            }
        }

        async function submitForm(event) {
            event.preventDefault();
            const payload = {
                userName: getValue(els.userName),
                deltaApiKey: getValue(els.deltaKey),
                deltaApiSecret: getValue(els.deltaSecret),
                coinswitchApiKey: getValue(els.coinswitchKey),
                coinswitchApiSecret: getValue(els.coinswitchSecret)
            };

            if (!payload.userName) {
                setModalStatus("User Name is required.", "error");
                return;
            }

            const duplicate = state.profiles.find(function (profile) {
                return profile.userName.trim().toLowerCase() === payload.userName.toLowerCase()
                    && profile.profileId !== state.editingProfileId;
            });
            if (duplicate) {
                setModalStatus("User Name already exists. Please use a different name.", "error");
                return;
            }

            if (!state.editingProfileId) {
                if (!payload.deltaApiKey || !payload.deltaApiSecret) {
                    setModalStatus("Delta API Key and API Secret are required.", "error");
                    return;
                }
                if (!payload.coinswitchApiKey || !payload.coinswitchApiSecret) {
                    setModalStatus("CoinSwitch API Key and API Secret are required.", "error");
                    return;
                }
            }

            const url = state.editingProfileId
                ? `/api/account/cs-delta-api-profiles/${encodeURIComponent(state.editingProfileId)}`
                : "/api/account/cs-delta-api-profiles";
            const method = state.editingProfileId ? "PUT" : "POST";

            try {
                const response = await fetch(url, {
                    method: method,
                    credentials: "same-origin",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });
                const result = await response.json();
                if (!response.ok || result.status !== "success") {
                    throw new Error(result.message || "Unable to save API credentials.");
                }
                resetForm(false);
                setModalStatus(result.message || "API credentials saved successfully.", "success");
                await loadProfiles();
            }
            catch (error) {
                setModalStatus(error instanceof Error ? error.message : "Unable to save API credentials.", "error");
            }
        }

        els.openBtn?.addEventListener("click", openModal);
        els.closeBtn?.addEventListener("click", closeModal);
        els.overlay?.addEventListener("click", closeModal);
        els.cancelBtn?.addEventListener("click", function () {
            resetForm(false);
            hideModalStatus();
        });
        els.refreshBtn?.addEventListener("click", function () {
            void loadProfiles();
        });
        els.form?.addEventListener("submit", function (event) {
            void submitForm(event);
        });

        if (els.cancelBtn) {
            els.cancelBtn.style.visibility = "hidden";
        }

        return { openModal: openModal, closeModal: closeModal };
    })();

    const positionImport = (function () {
        const els = {
            openBtn: document.getElementById("btnImportPositions"),
            overlay: document.getElementById("positionImportOverlay"),
            modal: document.getElementById("positionImportModal"),
            closeBtn: document.getElementById("btnClosePositionImport"),
            cancelBtn: document.getElementById("btnCancelPositionImport"),
            status: document.getElementById("positionImportStatus"),
            profileSelect: document.getElementById("importProfileSelect"),
            loadBtn: document.getElementById("btnLoadExchangePositions"),
            importBtn: document.getElementById("btnImportSelectedPositions"),
            deltaBody: document.getElementById("deltaImportTableBody"),
            coinswitchBody: document.getElementById("coinswitchImportTableBody"),
            chkAllDelta: document.getElementById("chkAllDeltaImport"),
            chkAllCoinswitch: document.getElementById("chkAllCoinswitchImport"),
            ipNotice: document.getElementById("positionImportIpNotice"),
            ipValue: document.getElementById("ipWhitelistValue"),
            ipCopyBtn: document.getElementById("btnCopyWhitelistIp")
        };
        const state = {
            profiles: [],
            deltaRows: [],
            coinswitchRows: [],
            selected: new Set()
        };

        function setStatusMessage(message, tone) {
            if (!els.status) {
                return;
            }
            els.status.textContent = String(message || "");
            els.status.className = `cs-api-status ${String(tone || "").trim()}`.trim();
        }

        function clearStatusMessage() {
            setStatusMessage("", "");
        }

        function hideIpNotice() {
            if (els.ipNotice) {
                els.ipNotice.hidden = true;
            }
            if (els.ipValue) {
                els.ipValue.textContent = "";
            }
        }

        function showIpNotice(clientIp) {
            if (!els.ipNotice) {
                return;
            }
            if (els.ipValue) {
                els.ipValue.textContent = String(clientIp || "").trim();
            }
            els.ipNotice.hidden = false;
        }

        function rowKey(source, index) {
            return `${source}#${index}`;
        }

        function updateImportButton() {
            if (els.importBtn) {
                els.importBtn.disabled = state.selected.size === 0;
            }
            syncSelectAllBoxes();
        }

        function syncSelectAllBoxes() {
            if (!els.chkAllDelta || !els.chkAllCoinswitch) {
                return;
            }
            const allDeltaSelected = state.deltaRows.length > 0 && state.deltaRows.every(function (_row, index) {
                return state.selected.has(rowKey("delta", index));
            });
            const allCsSelected = state.coinswitchRows.length > 0 && state.coinswitchRows.every(function (_row, index) {
                return state.selected.has(rowKey("coinswitch", index));
            });
            els.chkAllDelta.checked = allDeltaSelected;
            els.chkAllCoinswitch.checked = allCsSelected;
        }

        function renderImportRows(tableBody, source) {
            if (!tableBody) {
                return;
            }
            const arrRows = source === "delta" ? state.deltaRows : state.coinswitchRows;
            if (!arrRows.length) {
                tableBody.innerHTML = `<tr><td colspan="7" class="cs-api-empty">No ${source === "delta" ? "Delta" : "CoinSwitch"} option positions found.</td></tr>`;
                return;
            }
            tableBody.innerHTML = arrRows.map(function (row, index) {
                const checked = state.selected.has(rowKey(source, index));
                return `
                    <tr>
                        <td class="arbitrage-col-select"><input type="checkbox" data-import-row="${escapeHtmlValue(source)}#${index}" ${checked ? "checked" : ""} aria-label="Select ${escapeHtmlValue(row.symbol)}" /></td>
                        <td>${escapeHtmlValue(row.symbol)}</td>
                        <td>${escapeHtmlValue(String(row.side || "").toUpperCase())}</td>
                        <td>${escapeHtmlValue(fmtNumber(row.strike, 0))}</td>
                        <td>${escapeHtmlValue(row.size)}</td>
                        <td>${escapeHtmlValue(fmtNumber(row.entryPrice, 2))}</td>
                        <td>${escapeHtmlValue(fmtNumber(row.markPrice, 2))}</td>
                    </tr>
                `;
            }).join("");

            tableBody.querySelectorAll("input[data-import-row]").forEach(function (checkbox) {
                checkbox.addEventListener("change", function (event) {
                    const target = event.currentTarget;
                    const key = String(target?.dataset?.importRow || "");
                    if (target.checked) {
                        state.selected.add(key);
                    }
                    else {
                        state.selected.delete(key);
                    }
                    updateImportButton();
                });
            });
        }

        function renderAllImportRows() {
            renderImportRows(els.deltaBody, "delta");
            renderImportRows(els.coinswitchBody, "coinswitch");
            updateImportButton();
        }

        async function loadProfileOptions() {
            if (!els.profileSelect) {
                return;
            }
            try {
                const response = await fetch("/api/account/cs-delta-api-profiles", { credentials: "same-origin" });
                const result = await response.json();
                if (!response.ok || result.status !== "success") {
                    throw new Error(result.message || "Unable to load API profiles.");
                }
                state.profiles = Array.isArray(result.data) ? result.data : [];
                const vCurrent = String(els.profileSelect.value || "").trim();
                els.profileSelect.innerHTML = state.profiles.length
                    ? state.profiles.map(function (profile) {
                        return `<option value="${escapeHtmlValue(profile.profileId)}">${escapeHtmlValue(profile.userName)}</option>`;
                    }).join("")
                    : `<option value="">No saved profiles</option>`;
                if (!vCurrent && state.profiles.length) {
                    els.profileSelect.value = state.profiles[0].profileId;
                }
                else if (vCurrent && state.profiles.some(function (profile) { return profile.profileId === vCurrent; })) {
                    els.profileSelect.value = vCurrent;
                }
            }
            catch (error) {
                state.profiles = [];
                els.profileSelect.innerHTML = `<option value="">No saved profiles</option>`;
                setStatusMessage(error instanceof Error ? error.message : "Unable to load API profiles.", "error");
            }
        }

        async function loadExchangePositions() {
            const vProfileId = String(els.profileSelect?.value || "").trim();
            if (!vProfileId) {
                setStatusMessage("Select a username first.", "error");
                return;
            }
            setStatusMessage("Loading positions from Delta and CoinSwitch...", "");
            state.deltaRows = [];
            state.coinswitchRows = [];
            state.selected = new Set();
            hideIpNotice();
            renderAllImportRows();
            try {
                const response = await fetch(`/api/arbitrage/coinswitch/exchange-positions?profileId=${encodeURIComponent(vProfileId)}`, {
                    credentials: "same-origin"
                });
                const result = await response.json();
                if (!response.ok || result.status !== "success") {
                    throw new Error(result.message || "Unable to load exchange positions.");
                }
                state.deltaRows = Array.isArray(result?.data?.delta?.positions) ? result.data.delta.positions : [];
                state.coinswitchRows = Array.isArray(result?.data?.coinswitch?.positions) ? result.data.coinswitch.positions : [];
                renderAllImportRows();
                const arrMessages = [];
                if (result?.data?.delta?.ipWhitelistRequired) {
                    showIpNotice(result?.data?.delta?.clientIp);
                    arrMessages.push("Delta: IP whitelist required (see notice above).");
                }
                else if (!result?.data?.delta?.ok) {
                    arrMessages.push(`Delta: ${result?.data?.delta?.error || "unavailable"}`);
                }
                if (!result?.data?.coinswitch?.ok) {
                    arrMessages.push(`CoinSwitch: ${result?.data?.coinswitch?.error || "unavailable"}`);
                }
                if (arrMessages.length) {
                    setStatusMessage(arrMessages.join(" | "), "error");
                }
                else {
                    setStatusMessage(`Loaded ${state.deltaRows.length} Delta and ${state.coinswitchRows.length} CoinSwitch positions.`, "success");
                }
            }
            catch (error) {
                setStatusMessage(error instanceof Error ? error.message : "Unable to load exchange positions.", "error");
            }
        }

        async function importSelected() {
            const vProfileId = String(els.profileSelect?.value || "").trim();
            if (!vProfileId || !state.selected.size) {
                return;
            }
            const arrPayload = [];
            state.selected.forEach(function (key) {
                const arrParts = key.split("#");
                if (arrParts.length !== 2) {
                    return;
                }
                const vSource = arrParts[0];
                const vIndex = Number(arrParts[1]);
                const objRow = vSource === "delta" ? state.deltaRows[vIndex] : state.coinswitchRows[vIndex];
                if (objRow) {
                    arrPayload.push(objRow);
                }
            });
            if (!arrPayload.length) {
                return;
            }
            if (els.importBtn) {
                els.importBtn.disabled = true;
            }
            try {
                const response = await fetch("/api/arbitrage/coinswitch/import-positions", {
                    method: "POST",
                    credentials: "same-origin",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ profileId: vProfileId, positions: arrPayload })
                });
                const result = await response.json();
                if (!response.ok || result.status !== "success") {
                    throw new Error(result.message || "Unable to import positions.");
                }
                setStatusMessage(result.message || "Positions imported.", "success");
                await loadImportedPositions();
                setTimeout(function () {
                    closeModal();
                }, 900);
            }
            catch (error) {
                setStatusMessage(error instanceof Error ? error.message : "Unable to import positions.", "error");
                updateImportButton();
            }
        }

        function toggleAll(source, checked) {
            const arrRows = source === "delta" ? state.deltaRows : state.coinswitchRows;
            arrRows.forEach(function (_row, index) {
                if (checked) {
                    state.selected.add(rowKey(source, index));
                }
                else {
                    state.selected.delete(rowKey(source, index));
                }
            });
            renderAllImportRows();
        }

        function openModal() {
            clearStatusMessage();
            state.deltaRows = [];
            state.coinswitchRows = [];
            state.selected = new Set();
            hideIpNotice();
            renderAllImportRows();
            els.overlay?.classList.add("show");
            els.modal?.classList.add("show");
            if (els.modal) {
                els.modal.setAttribute("aria-hidden", "false");
            }
            void loadProfileOptions();
        }

        function closeModal() {
            els.overlay?.classList.remove("show");
            els.modal?.classList.remove("show");
            if (els.modal) {
                els.modal.setAttribute("aria-hidden", "true");
            }
            clearStatusMessage();
        }

        els.openBtn?.addEventListener("click", openModal);
        els.closeBtn?.addEventListener("click", closeModal);
        els.overlay?.addEventListener("click", closeModal);
        els.cancelBtn?.addEventListener("click", closeModal);
        els.loadBtn?.addEventListener("click", function () {
            void loadExchangePositions();
        });
        els.importBtn?.addEventListener("click", function () {
            void importSelected();
        });
        els.chkAllDelta?.addEventListener("change", function (event) {
            toggleAll("delta", Boolean(event.currentTarget?.checked));
        });
        els.chkAllCoinswitch?.addEventListener("change", function (event) {
            toggleAll("coinswitch", Boolean(event.currentTarget?.checked));
        });
        els.ipCopyBtn?.addEventListener("click", async function () {
            const vIp = String(els.ipValue?.textContent || "").trim();
            if (!vIp) {
                return;
            }
            try {
                await navigator.clipboard.writeText(vIp);
                els.ipCopyBtn.textContent = "Copied!";
            }
            catch (_error) {
                window.prompt("Copy this IP address:", vIp);
            }
            setTimeout(function () {
                if (els.ipCopyBtn) {
                    els.ipCopyBtn.textContent = "Copy IP";
                }
            }, 1500);
        });

        return { openModal: openModal, closeModal: closeModal };
    })();

    void loadOrderProfiles();
    void loadOpenPositions();
    void loadWalletBalances().catch(function () { return undefined; });
    void loadInstruments().catch(function (error) {
        setPill("Error");
        setStatus(error instanceof Error ? error.message : "Unable to load instruments.", "danger");
        if (sharedIds.instrument instanceof HTMLSelectElement) {
            sharedIds.instrument.innerHTML = `<option value="">Failed to load</option>`;
        }
    });
})();
