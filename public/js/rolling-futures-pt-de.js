(function () {
    const ids = {
        userId: document.getElementById("txtRollingFuturesUserId"),
        apiKey: document.getElementById("txtRollingFuturesApiKey"),
        apiSecret: document.getElementById("txtRollingFuturesApiSecret"),
        symbol: document.getElementById("ddlRollingFuturesSymbol"),
        underlying: document.getElementById("ddlRollingFuturesUnderlying"),
        startQty: document.getElementById("txtRollingFuturesStartQty"),
        optionQty: document.getElementById("txtRollingFuturesQty1"),
        loopSeconds: document.getElementById("txtRollingFuturesLoopSeconds"),
        deltaTolerance: document.getElementById("txtRollingFuturesDeltaTolerance"),
        targetAbsDeltaOption: document.getElementById("txtRollingFuturesTargetAbsDeltaOption"),
        weeklyDteMin: document.getElementById("txtRollingFuturesWeeklyDteMin"),
        weeklyDteMax: document.getElementById("txtRollingFuturesWeeklyDteMax"),
        monthlyDteMin: document.getElementById("txtRollingFuturesMonthlyDteMin"),
        monthlyDteMax: document.getElementById("txtRollingFuturesMonthlyDteMax"),
        activeUser: document.getElementById("rollingFuturesActiveUser"),
        engineStatus: document.getElementById("rollingFuturesEngineStatus"),
        killSwitchState: document.getElementById("rollingFuturesKillSwitchState"),
        runnerHealth: document.getElementById("rollingFuturesRunnerHealth"),
        pageStatus: document.getElementById("rollingFuturesPageStatus"),
        cycleCount: document.getElementById("rollingFuturesCycleCount"),
        openCount: document.getElementById("rollingFuturesOpenCount"),
        failureCount: document.getElementById("rollingFuturesFailureCount"),
        totalPnl: document.getElementById("rollingFuturesTotalPnl"),
        totalDelta: document.getElementById("rollingFuturesTotalDelta"),
        totalGamma: document.getElementById("rollingFuturesTotalGamma"),
        totalTheta: document.getElementById("rollingFuturesTotalTheta"),
        marginUsed: document.getElementById("rollingFuturesMarginUsed"),
        lastCycleAt: document.getElementById("rollingFuturesLastCycleAt"),
        openPositionsBody: document.getElementById("rollingFuturesOpenPositionsBody"),
        closedPositionsBody: document.getElementById("rollingFuturesClosedPositionsBody"),
        eventsLog: document.getElementById("rollingFuturesEventsLog"),
        btnStart: document.getElementById("btnRollingFuturesStart"),
        btnCycle: document.getElementById("btnRollingFuturesCycle"),
        btnStop: document.getElementById("btnRollingFuturesStop"),
        btnRefresh: document.getElementById("btnRollingFuturesRefresh"),
        btnReset: document.getElementById("btnRollingFuturesReset"),
        btnEmergency: document.getElementById("btnRollingFuturesEmergency")
    };

    let saveTimer = null;

    function getUserId() {
        return String(ids.userId?.value || "demo-paper").trim() || "demo-paper";
    }

    function fmt(value) {
        const num = Number(value || 0);
        return Number.isFinite(num) ? num.toFixed(2) : "0.00";
    }

    function formatDateTime(value) {
        const dateValue = value ? new Date(value) : null;
        if (!(dateValue instanceof Date) || Number.isNaN(dateValue.getTime())) {
            return "-";
        }

        return dateValue.toLocaleString("en-IN", {
            year: "numeric",
            month: "short",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
        });
    }

    function normalizePositiveInt(value, fallback) {
        const parsed = Math.max(1, Math.floor(Number(value || fallback)));
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function getConfig() {
        return {
            symbol: String(ids.symbol?.value || "BTCUSD"),
            underlying: String(ids.underlying?.value || "BTC"),
            startQty: normalizePositiveInt(ids.startQty?.value, 1),
            manualOptQty1: normalizePositiveInt(ids.optionQty?.value, 1),
            loopSeconds: Number(ids.loopSeconds?.value || 10),
            deltaTolerance: Number(ids.deltaTolerance?.value || 20),
            targetAbsDeltaOption: Number(ids.targetAbsDeltaOption?.value || 0.33),
            weeklyDteMin: Number(ids.weeklyDteMin?.value || 5),
            weeklyDteMax: Number(ids.weeklyDteMax?.value || 10),
            monthlyDteMin: Number(ids.monthlyDteMin?.value || 30),
            monthlyDteMax: Number(ids.monthlyDteMax?.value || 60)
        };
    }

    async function postJson(url, body) {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body || {})
        });
        return response.json();
    }

    function setPageStatus(message, tone) {
        if (!ids.pageStatus) {
            return;
        }

        const text = String(message || "").trim();
        ids.pageStatus.textContent = text;
        ids.pageStatus.className = "rolling-futures-status";
        if (!text) {
            return;
        }

        ids.pageStatus.classList.add("show");
        if (tone) {
            ids.pageStatus.classList.add(tone);
        }
    }

    async function saveProfile() {
        const result = await postJson("/api/strategyfo/paper/profile", {
            userId: getUserId(),
            apiKey: String(ids.apiKey?.value || ""),
            apiSecret: String(ids.apiSecret?.value || ""),
            autoTraderEnabled: false,
            uiState: getConfig()
        });

        if (result?.status !== "success") {
            setPageStatus(result?.message || "Unable to save profile.", "warn");
            return;
        }

        setPageStatus("Profile saved on server.", "success");
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
        if (!target) {
            return;
        }

        if (!Array.isArray(rows) || rows.length === 0) {
            target.innerHTML = `<tr><td colspan="${colspan}" class="rolling-futures-empty">${emptyText}</td></tr>`;
            return;
        }

        target.innerHTML = rows.map(mapper).join("");
    }

    function renderEvents(events) {
        if (!ids.eventsLog) {
            return;
        }

        if (!Array.isArray(events) || events.length === 0) {
            ids.eventsLog.innerHTML = '<div class="rolling-futures-empty">No events yet.</div>';
            return;
        }

        ids.eventsLog.innerHTML = events.map(function (evt) {
            return [
                '<article class="rolling-futures-event">',
                `<div class="rolling-futures-event-head"><strong>${evt.type || "EVENT"}</strong><span>${formatDateTime(evt.ts)}</span></div>`,
                `<div class="rolling-futures-event-body">${evt.message || ""}</div>`,
                "</article>"
            ].join("");
        }).join("");
    }

    function setStatusPill(target, text, tone) {
        if (!target) {
            return;
        }

        target.textContent = text;
        target.className = "rolling-demo-status-pill";
        if (tone) {
            target.classList.add(tone);
        }
    }

    function renderStatus(payload) {
        const status = payload?.data || payload;
        if (!status) {
            return;
        }

        const portfolio = status.portfolio || {};
        const killSwitchEnabled = Boolean(status.killSwitch?.enabled);
        ids.activeUser.textContent = getUserId();
        ids.cycleCount.textContent = String(status.cycleCount || 0);
        ids.openCount.textContent = String(portfolio.openCount || 0);
        ids.failureCount.textContent = String(status.consecutiveFailures || 0);
        ids.totalPnl.textContent = fmt(portfolio.totalPnl);
        ids.totalDelta.textContent = fmt(portfolio.totalDelta);
        ids.totalGamma.textContent = fmt(portfolio.totalGamma);
        ids.totalTheta.textContent = fmt(portfolio.totalTheta);
        ids.marginUsed.textContent = fmt(portfolio.marginUsed);
        ids.lastCycleAt.textContent = formatDateTime(status.lastCycleAt);

        if (status.running) {
            setStatusPill(ids.engineStatus, "Running", "good");
        }
        else if (status.lastError) {
            setStatusPill(ids.engineStatus, "Stopped With Error", "warn");
        }
        else {
            setStatusPill(ids.engineStatus, "Idle", "muted");
        }

        setStatusPill(
            ids.killSwitchState,
            killSwitchEnabled ? `Kill Switch: ${status.killSwitch.reason || "Active"}` : "Kill Switch Off",
            killSwitchEnabled ? "warn" : "muted"
        );

        if (status.lastError) {
            setStatusPill(ids.runnerHealth, status.lastError, "warn");
        }
        else if (status.lastCycleAt) {
            setStatusPill(ids.runnerHealth, `Last Cycle ${formatDateTime(status.lastCycleAt)}`, "good");
        }
        else {
            setStatusPill(ids.runnerHealth, "Waiting For Cycle", "muted");
        }

        renderRows(ids.openPositionsBody, status.openPositions || [], function (row) {
            return `<tr><td>${row.legType || ""}</td><td>${row.instrumentType || ""}</td><td>${row.side || ""}</td><td>${row.symbol || ""}</td><td>${row.qty || 0}</td><td>${fmt(row.entryPrice)}</td><td>${fmt(row.markPrice)}</td><td>${fmt(row.currentGreeks?.delta)}</td><td>${fmt(row.currentGreeks?.theta)}</td><td>${row.status || ""}</td></tr>`;
        }, "No open positions yet.", 10);

        renderRows(ids.closedPositionsBody, status.closedPositions || [], function (row) {
            return `<tr><td>${row.legType || ""}</td><td>${row.symbol || ""}</td><td>${row.side || ""}</td><td>${row.qty || 0}</td><td>${fmt(row.entryPrice)}</td><td>${fmt(row.closePrice)}</td><td>${row.closeReason || ""}</td><td>${fmt(row.grossRealizedPnl)}</td><td>${fmt(row.realizedPnl)}</td><td>${formatDateTime(row.closedAt)}</td></tr>`;
        }, "No closed positions yet.", 10);

        renderEvents(status.events || []);
    }

    async function refreshStatus() {
        const response = await fetch(`/api/strategyfo/paper/status?userId=${encodeURIComponent(getUserId())}`);
        renderStatus(await response.json());
    }

    async function loadProfile() {
        const response = await fetch(`/api/strategyfo/paper/profile?userId=${encodeURIComponent(getUserId())}`);
        const payload = await response.json();
        const data = payload?.data || {};
        const uiState = data.uiState || {};

        ids.apiKey.value = data.apiKey || "";
        ids.apiSecret.value = data.apiSecret || "";
        ids.symbol.value = uiState.symbol || ids.symbol.value;
        ids.underlying.value = uiState.underlying || ids.underlying.value;
        const vStartQty = normalizePositiveInt(uiState.startQty, normalizePositiveInt(ids.startQty?.value, 1));
        const vOptionQty = normalizePositiveInt(uiState.manualOptQty1, vStartQty);
        if (ids.startQty) {
            ids.startQty.value = String(vStartQty);
        }
        if (ids.optionQty) {
            ids.optionQty.value = String(vOptionQty);
        }
        ids.loopSeconds.value = String(uiState.loopSeconds || ids.loopSeconds.value);
        ids.deltaTolerance.value = String(uiState.deltaTolerance || ids.deltaTolerance.value);
        ids.targetAbsDeltaOption.value = String(uiState.targetAbsDeltaOption || ids.targetAbsDeltaOption.value);
        ids.weeklyDteMin.value = String(uiState.weeklyDteMin || ids.weeklyDteMin.value);
        ids.weeklyDteMax.value = String(uiState.weeklyDteMax || ids.weeklyDteMax.value);
        ids.monthlyDteMin.value = String(uiState.monthlyDteMin || ids.monthlyDteMin.value);
        ids.monthlyDteMax.value = String(uiState.monthlyDteMax || ids.monthlyDteMax.value);
        ids.activeUser.textContent = getUserId();
    }

    async function validateLogin() {
        const result = await postJson("/api/strategyfo/paper/validate-login", {
            userId: getUserId(),
            apiKey: String(ids.apiKey?.value || ""),
            apiSecret: String(ids.apiSecret?.value || "")
        });

        if (result?.status === "success") {
            await saveProfile();
            return true;
        }

        setPageStatus(result?.message || "API validation failed.", "warn");
        return false;
    }

    async function startEngine() {
        const isValid = await validateLogin();
        if (!isValid) {
            return;
        }

        const result = await postJson("/api/strategyfo/paper/start", {
            userId: getUserId(),
            apiKey: String(ids.apiKey?.value || ""),
            apiSecret: String(ids.apiSecret?.value || ""),
            config: getConfig()
        });

        setPageStatus(result?.message || "Runner request submitted.", result?.status === "success" ? "success" : "warn");
        await refreshStatus();
    }

    ids.btnStart?.addEventListener("click", function () {
        void startEngine();
    });
    ids.btnStop?.addEventListener("click", async function () {
        const result = await postJson("/api/strategyfo/paper/stop", { userId: getUserId() });
        setPageStatus(result?.message || "Runner stopped.", result?.status === "success" ? "success" : "warn");
        await refreshStatus();
    });
    ids.btnCycle?.addEventListener("click", async function () {
        const result = await postJson("/api/strategyfo/paper/cycle", { userId: getUserId() });
        setPageStatus(result?.message || "Cycle triggered.", result?.status === "success" ? "success" : "warn");
        await refreshStatus();
    });
    ids.btnReset?.addEventListener("click", async function () {
        const result = await postJson("/api/strategyfo/paper/reset", { userId: getUserId() });
        setPageStatus(result?.message || "State reset.", result?.status === "success" ? "success" : "warn");
        await refreshStatus();
    });
    ids.btnEmergency?.addEventListener("click", async function () {
        const result = await postJson("/api/strategyfo/paper/emergency-stop", {
            userId: getUserId(),
            reason: "Manual emergency stop from Rolling Futures demo page"
        });
        setPageStatus(result?.message || "Emergency stop submitted.", result?.status === "success" ? "success" : "warn");
        await refreshStatus();
    });
    ids.btnRefresh?.addEventListener("click", function () {
        void refreshStatus();
    });
    ids.userId?.addEventListener("change", async function () {
        await loadProfile();
        await refreshStatus();
    });

    ids.startQty?.addEventListener("change", function () {
        const vStartQty = normalizePositiveInt(ids.startQty?.value, 1);
        ids.startQty.value = String(vStartQty);
        if (ids.optionQty) {
            ids.optionQty.value = String(vStartQty);
        }
        queueProfileSave();
    });

    [
        ids.apiKey,
        ids.apiSecret,
        ids.symbol,
        ids.underlying,
        ids.optionQty,
        ids.loopSeconds,
        ids.deltaTolerance,
        ids.targetAbsDeltaOption,
        ids.weeklyDteMin,
        ids.weeklyDteMax,
        ids.monthlyDteMin,
        ids.monthlyDteMax
    ].forEach(function (element) {
        element?.addEventListener("change", queueProfileSave);
    });

    loadProfile()
        .then(refreshStatus)
        .catch(function () {
            setPageStatus("Unable to load server profile.", "warn");
        });

    setInterval(function () {
        void refreshStatus();
    }, 8000);
})();
