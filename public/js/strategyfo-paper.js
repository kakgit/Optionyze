(function () {
    const ids = {
        userId: document.getElementById("userId"),
        apiKey: document.getElementById("apiKey"),
        apiSecret: document.getElementById("apiSecret"),
        symbol: document.getElementById("symbol"),
        underlying: document.getElementById("underlying"),
        loopSeconds: document.getElementById("loopSeconds"),
        deltaTolerance: document.getElementById("deltaTolerance"),
        targetAbsDeltaOption: document.getElementById("targetAbsDeltaOption"),
        weeklyDteMin: document.getElementById("weeklyDteMin"),
        weeklyDteMax: document.getElementById("weeklyDteMax"),
        monthlyDteMin: document.getElementById("monthlyDteMin"),
        monthlyDteMax: document.getElementById("monthlyDteMax"),
        activeUserLabel: document.getElementById("activeUserLabel"),
        engineStateText: document.getElementById("engineStateText"),
        cycleCount: document.getElementById("cycleCount"),
        totalPnl: document.getElementById("totalPnl"),
        totalDelta: document.getElementById("totalDelta"),
        totalGamma: document.getElementById("totalGamma"),
        totalTheta: document.getElementById("totalTheta"),
        marginUsed: document.getElementById("marginUsed"),
        openCount: document.getElementById("openCount"),
        failureCount: document.getElementById("failureCount"),
        openPositionsBody: document.getElementById("openPositionsBody"),
        closedPositionsBody: document.getElementById("closedPositionsBody"),
        eventsLog: document.getElementById("eventsLog"),
        btnStart: document.getElementById("btnStart"),
        btnCycle: document.getElementById("btnCycle"),
        btnStop: document.getElementById("btnStop"),
        btnReset: document.getElementById("btnReset"),
        btnEmergency: document.getElementById("btnEmergency"),
        btnRefresh: document.getElementById("btnRefresh")
    };
    let saveTimer = null;

    function getUserId() { return String(ids.userId.value || "demo-paper").trim() || "demo-paper"; }
    function fmt(num) { const n = Number(num || 0); return Number.isFinite(n) ? n.toFixed(2) : "0.00"; }
    function getConfig() {
        return {
            symbol: String(ids.symbol.value || "BTCUSD"),
            underlying: String(ids.underlying.value || "BTC"),
            loopSeconds: Number(ids.loopSeconds.value || 10),
            deltaTolerance: Number(ids.deltaTolerance.value || 20),
            targetAbsDeltaOption: Number(ids.targetAbsDeltaOption.value || 0.33),
            weeklyDteMin: Number(ids.weeklyDteMin.value || 5),
            weeklyDteMax: Number(ids.weeklyDteMax.value || 10),
            monthlyDteMin: Number(ids.monthlyDteMin.value || 30),
            monthlyDteMax: Number(ids.monthlyDteMax.value || 60)
        };
    }

    async function postJson(url, body) {
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body || {})
        });
        return res.json();
    }

    async function saveProfile() {
        await postJson("/api/strategyfo/paper/profile", {
            userId: getUserId(),
            apiKey: String(ids.apiKey.value || ""),
            apiSecret: String(ids.apiSecret.value || ""),
            autoTraderEnabled: false,
            uiState: getConfig()
        });
    }

    function queueProfileSave() {
        if (saveTimer) {
            clearTimeout(saveTimer);
        }
        saveTimer = setTimeout(function () {
            saveTimer = null;
            void saveProfile();
        }, 400);
    }

    function renderRows(target, rows, mapper, emptyText, colspan) {
        if (!rows || rows.length === 0) {
            target.innerHTML = `<tr><td colspan="${colspan}" class="paper-muted">${emptyText}</td></tr>`;
            return;
        }
        target.innerHTML = rows.map(mapper).join("");
    }

    function setStateText(status) {
        if (!status) {
            ids.engineStateText.textContent = "Idle";
            ids.engineStateText.className = "paper-muted";
            return;
        }
        if (status.killSwitch && status.killSwitch.enabled) {
            ids.engineStateText.textContent = "Kill Switch Active";
            ids.engineStateText.className = "paper-bad";
            return;
        }
        if (status.running) {
            ids.engineStateText.textContent = "Running";
            ids.engineStateText.className = "paper-good";
            return;
        }
        ids.engineStateText.textContent = status.lastError ? `Stopped: ${status.lastError}` : "Stopped";
        ids.engineStateText.className = status.lastError ? "paper-warn" : "paper-muted";
    }

    function renderStatus(payload) {
        const status = payload && payload.data ? payload.data : payload;
        if (!status) { return; }
        ids.activeUserLabel.textContent = getUserId();
        ids.cycleCount.textContent = String(status.cycleCount || 0);
        ids.totalPnl.textContent = fmt(status.portfolio && status.portfolio.totalPnl);
        ids.totalDelta.textContent = fmt(status.portfolio && status.portfolio.totalDelta);
        ids.totalGamma.textContent = fmt(status.portfolio && status.portfolio.totalGamma);
        ids.totalTheta.textContent = fmt(status.portfolio && status.portfolio.totalTheta);
        ids.marginUsed.textContent = fmt(status.portfolio && status.portfolio.marginUsed);
        ids.openCount.textContent = String((status.portfolio && status.portfolio.openCount) || 0);
        ids.failureCount.textContent = String(status.consecutiveFailures || 0);
        setStateText(status);

        renderRows(ids.openPositionsBody, status.openPositions || [], function (row) {
            return `<tr><td>${row.legType || ""}</td><td>${row.instrumentType || ""}</td><td>${row.side || ""}</td><td>${row.symbol || ""}</td><td>${row.qty || 0}</td><td>${fmt(row.entryPrice)}</td><td>${fmt(row.markPrice)}</td><td>${fmt(row.currentGreeks && row.currentGreeks.delta)}</td><td>${fmt(row.currentGreeks && row.currentGreeks.theta)}</td><td>${row.status || ""}</td></tr>`;
        }, "No open positions yet.", 10);

        renderRows(ids.closedPositionsBody, status.closedPositions || [], function (row) {
            return `<tr><td>${row.legType || ""}</td><td>${row.symbol || ""}</td><td>${row.side || ""}</td><td>${row.qty || 0}</td><td>${fmt(row.entryPrice)}</td><td>${fmt(row.closePrice)}</td><td>${row.closeReason || ""}</td><td>${fmt(row.grossRealizedPnl)}</td><td>${fmt(row.realizedPnl)}</td><td>${row.closedAt || ""}</td></tr>`;
        }, "No closed positions yet.", 10);

        const events = status.events || [];
        ids.eventsLog.innerHTML = events.length === 0
            ? '<div class="paper-muted">No events yet.</div>'
            : events.map(function (evt) {
                return `<div><div><strong>${evt.type || "EVENT"}</strong> <span class="paper-muted">${evt.ts || ""}</span></div><div>${evt.message || ""}</div></div>`;
            }).join("");
    }

    async function refreshStatus() {
        const res = await fetch(`/api/strategyfo/paper/status?userId=${encodeURIComponent(getUserId())}`);
        renderStatus(await res.json());
    }

    async function loadProfile() {
        const res = await fetch(`/api/strategyfo/paper/profile?userId=${encodeURIComponent(getUserId())}`);
        const payload = await res.json();
        const data = payload && payload.data ? payload.data : {};
        const uiState = data.uiState || {};

        ids.apiKey.value = data.apiKey || "";
        ids.apiSecret.value = data.apiSecret || "";
        ids.symbol.value = uiState.symbol || ids.symbol.value;
        ids.underlying.value = uiState.underlying || ids.underlying.value;
        ids.loopSeconds.value = String(uiState.loopSeconds || ids.loopSeconds.value);
        ids.deltaTolerance.value = String(uiState.deltaTolerance || ids.deltaTolerance.value);
        ids.targetAbsDeltaOption.value = String(uiState.targetAbsDeltaOption || ids.targetAbsDeltaOption.value);
        ids.weeklyDteMin.value = String(uiState.weeklyDteMin || ids.weeklyDteMin.value);
        ids.weeklyDteMax.value = String(uiState.weeklyDteMax || ids.weeklyDteMax.value);
        ids.monthlyDteMin.value = String(uiState.monthlyDteMin || ids.monthlyDteMin.value);
        ids.monthlyDteMax.value = String(uiState.monthlyDteMax || ids.monthlyDteMax.value);
    }

    async function validateLogin() {
        const result = await postJson("/api/strategyfo/paper/validate-login", {
            userId: getUserId(),
            apiKey: String(ids.apiKey.value || ""),
            apiSecret: String(ids.apiSecret.value || "")
        });
        if (result.status === "success") {
            await saveProfile();
        }
        return result;
    }

    async function startEngine() {
        await validateLogin();
        await postJson("/api/strategyfo/paper/start", {
            userId: getUserId(),
            apiKey: String(ids.apiKey.value || ""),
            apiSecret: String(ids.apiSecret.value || ""),
            config: getConfig()
        });
        await refreshStatus();
    }

    ids.btnStart.addEventListener("click", startEngine);
    ids.btnStop.addEventListener("click", async function () { await postJson("/api/strategyfo/paper/stop", { userId: getUserId() }); await refreshStatus(); });
    ids.btnCycle.addEventListener("click", async function () { await postJson("/api/strategyfo/paper/cycle", { userId: getUserId() }); await refreshStatus(); });
    ids.btnReset.addEventListener("click", async function () { await postJson("/api/strategyfo/paper/reset", { userId: getUserId() }); await refreshStatus(); });
    ids.btnEmergency.addEventListener("click", async function () { await postJson("/api/strategyfo/paper/emergency-stop", { userId: getUserId(), reason: "Manual emergency stop from page" }); await refreshStatus(); });
    ids.btnRefresh.addEventListener("click", refreshStatus);
    ids.userId.addEventListener("change", async function () { await loadProfile(); await refreshStatus(); });
    [ids.apiKey, ids.apiSecret, ids.symbol, ids.underlying, ids.loopSeconds, ids.deltaTolerance, ids.targetAbsDeltaOption, ids.weeklyDteMin, ids.weeklyDteMax, ids.monthlyDteMin, ids.monthlyDteMax]
        .forEach(function (el) { el.addEventListener("change", queueProfileSave); });

    loadProfile().then(refreshStatus);
    setInterval(refreshStatus, 8000);
})();
