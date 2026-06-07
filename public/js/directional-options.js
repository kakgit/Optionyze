(function () {
    const presets = {
        btc_scalper: {
            symbol: "BTCUSD",
            underlying: "BTC",
            presetKey: "btc_scalper",
            loopSeconds: 8,
            targetAbsDelta: 0.28,
            entryDteMin: 1,
            entryDteMax: 5,
            baseContracts: 1,
            maxContracts: 1,
            cooldownCycles: 2,
            bullishThreshold: 5,
            bearishThreshold: 5,
            minConfidence: 70,
            slopeLookback: 3,
            emaFastPeriod: 4,
            emaSlowPeriod: 9,
            rsiPeriod: 6,
            requireEmaAlignment: true,
            requireRsiConfirmation: true,
            takeProfitPct: 8,
            stopLossPct: 5,
            maxHoldCycles: 3,
            neutralExitCycles: 1,
            preferredRegime: "any",
            minVolatilityPct: 0.2,
            maxSessionProfit: 30,
            maxSessionLoss: 15,
            maxConsecutiveLosses: 2
        },
        eth_scalper: {
            symbol: "ETHUSD",
            underlying: "ETH",
            presetKey: "eth_scalper",
            loopSeconds: 8,
            targetAbsDelta: 0.3,
            entryDteMin: 1,
            entryDteMax: 5,
            baseContracts: 1,
            maxContracts: 1,
            cooldownCycles: 2,
            bullishThreshold: 5,
            bearishThreshold: 5,
            minConfidence: 68,
            slopeLookback: 3,
            emaFastPeriod: 4,
            emaSlowPeriod: 9,
            rsiPeriod: 6,
            requireEmaAlignment: true,
            requireRsiConfirmation: true,
            takeProfitPct: 8,
            stopLossPct: 5,
            maxHoldCycles: 3,
            neutralExitCycles: 1,
            preferredRegime: "any",
            minVolatilityPct: 0.22,
            maxSessionProfit: 28,
            maxSessionLoss: 14,
            maxConsecutiveLosses: 2
        },
        breakout_hunter: {
            symbol: "BTCUSD",
            underlying: "BTC",
            presetKey: "breakout_hunter",
            loopSeconds: 6,
            targetAbsDelta: 0.25,
            entryDteMin: 1,
            entryDteMax: 4,
            baseContracts: 1,
            maxContracts: 1,
            cooldownCycles: 2,
            bullishThreshold: 6,
            bearishThreshold: 6,
            minConfidence: 74,
            slopeLookback: 2,
            emaFastPeriod: 3,
            emaSlowPeriod: 8,
            rsiPeriod: 5,
            requireEmaAlignment: true,
            requireRsiConfirmation: true,
            takeProfitPct: 9,
            stopLossPct: 4.5,
            maxHoldCycles: 3,
            neutralExitCycles: 1,
            preferredRegime: "trend",
            minVolatilityPct: 0.3,
            maxSessionProfit: 32,
            maxSessionLoss: 14,
            maxConsecutiveLosses: 2
        }
    };

    const activeUser = document.getElementById("directionalDemoActiveUser");
    const storageKey = `optionyze.directional-demo.config.v4.${String(activeUser?.textContent || "demo-paper").trim() || "demo-paper"}`;
    const ids = {
        preset: document.getElementById("directionalDemoPreset"),
        profileId: document.getElementById("directionalDemoProfileId"),
        symbol: document.getElementById("directionalDemoSymbol"),
        underlying: document.getElementById("directionalDemoUnderlying"),
        loopSeconds: document.getElementById("directionalDemoLoopSeconds"),
        targetDelta: document.getElementById("directionalDemoTargetDelta"),
        entryDteMin: document.getElementById("directionalDemoEntryDteMin"),
        entryDteMax: document.getElementById("directionalDemoEntryDteMax"),
        baseContracts: document.getElementById("directionalDemoBaseContracts"),
        maxContracts: document.getElementById("directionalDemoMaxContracts"),
        cooldownCycles: document.getElementById("directionalDemoCooldownCycles"),
        bullishThreshold: document.getElementById("directionalDemoBullishThreshold"),
        bearishThreshold: document.getElementById("directionalDemoBearishThreshold"),
        minConfidence: document.getElementById("directionalDemoMinConfidence"),
        slopeLookback: document.getElementById("directionalDemoSlopeLookback"),
        emaFast: document.getElementById("directionalDemoEmaFast"),
        emaSlow: document.getElementById("directionalDemoEmaSlow"),
        rsiPeriod: document.getElementById("directionalDemoRsiPeriod"),
        preferredRegime: document.getElementById("directionalDemoPreferredRegime"),
        minVolatilityPct: document.getElementById("directionalDemoMinVolatilityPct"),
        requireEma: document.getElementById("directionalDemoRequireEma"),
        requireRsi: document.getElementById("directionalDemoRequireRsi"),
        takeProfitPct: document.getElementById("directionalDemoTakeProfitPct"),
        stopLossPct: document.getElementById("directionalDemoStopLossPct"),
        maxHoldCycles: document.getElementById("directionalDemoMaxHoldCycles"),
        neutralExitCycles: document.getElementById("directionalDemoNeutralExitCycles"),
        maxSessionProfit: document.getElementById("directionalDemoMaxSessionProfit"),
        maxSessionLoss: document.getElementById("directionalDemoMaxSessionLoss"),
        maxConsecutiveLosses: document.getElementById("directionalDemoMaxConsecutiveLosses"),
        activeUser,
        engineState: document.getElementById("directionalDemoEngineState"),
        profileLabel: document.getElementById("directionalDemoProfileLabel"),
        spot: document.getElementById("directionalDemoSpot"),
        mark: document.getElementById("directionalDemoMark"),
        bid: document.getElementById("directionalDemoBid"),
        ask: document.getElementById("directionalDemoAsk"),
        lastTick: document.getElementById("directionalDemoLastTick"),
        status: document.getElementById("directionalDemoStatus"),
        bullishScore: document.getElementById("directionalDemoBullishScore"),
        bearishScore: document.getElementById("directionalDemoBearishScore"),
        confidence: document.getElementById("directionalDemoConfidence"),
        bias: document.getElementById("directionalDemoBias"),
        regime: document.getElementById("directionalDemoRegime"),
        action: document.getElementById("directionalDemoAction"),
        openCount: document.getElementById("directionalDemoOpenCount"),
        winRate: document.getElementById("directionalDemoWinRate"),
        avgWin: document.getElementById("directionalDemoAvgWin"),
        avgLoss: document.getElementById("directionalDemoAvgLoss"),
        bestTrade: document.getElementById("directionalDemoBestTrade"),
        worstTrade: document.getElementById("directionalDemoWorstTrade"),
        totalPnl: document.getElementById("directionalDemoTotalPnl"),
        modeLabel: document.getElementById("directionalDemoModeLabel"),
        startAdvice: document.getElementById("directionalDemoStartAdvice"),
        stopAdvice: document.getElementById("directionalDemoStopAdvice"),
        startSummary: document.getElementById("directionalDemoStartSummary"),
        stopSummary: document.getElementById("directionalDemoStopSummary"),
        checklist: document.getElementById("directionalDemoChecklist"),
        equityChart: document.getElementById("directionalDemoEquityChart"),
        emaFastValue: document.getElementById("directionalDemoEmaFastValue"),
        emaSlowValue: document.getElementById("directionalDemoEmaSlowValue"),
        rsiValue: document.getElementById("directionalDemoRsiValue"),
        slopeValue: document.getElementById("directionalDemoSlopeValue"),
        volatilityValue: document.getElementById("directionalDemoVolatilityValue"),
        trendScoreValue: document.getElementById("directionalDemoTrendScoreValue"),
        rangeScoreValue: document.getElementById("directionalDemoRangeScoreValue"),
        cycleCount: document.getElementById("directionalDemoCycleCount"),
        drivers: document.getElementById("directionalDemoDrivers"),
        blocks: document.getElementById("directionalDemoBlocks"),
        openPositionsBody: document.getElementById("directionalDemoOpenPositionsBody"),
        closedPositionsBody: document.getElementById("directionalDemoClosedPositionsBody"),
        eventsLog: document.getElementById("directionalDemoEventsLog"),
        btnStart: document.getElementById("btnDirectionalDemoStart"),
        btnCycle: document.getElementById("btnDirectionalDemoCycle"),
        btnStop: document.getElementById("btnDirectionalDemoStop"),
        btnReset: document.getElementById("btnDirectionalDemoReset"),
        btnEmergency: document.getElementById("btnDirectionalDemoEmergency"),
        btnRefresh: document.getElementById("btnDirectionalDemoRefresh")
    };

    function fmt(value, digits) {
        const numberValue = Number(value);
        return Number.isFinite(numberValue) ? numberValue.toFixed(digits) : "-";
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll("\"", "&quot;")
            .replaceAll("'", "&#39;");
    }

    function setStatus(message, tone) {
        ids.status.textContent = String(message || "").trim();
        ids.status.className = "directional-demo-status";
        if (tone) {
            ids.status.classList.add(tone);
        }
    }

    function applyPreset(presetKey, shouldPersist) {
        const preset = presets[presetKey];
        if (!preset) {
            ids.preset.value = "custom";
            if (shouldPersist) {
                saveConfigLocally();
            }
            return;
        }
        ids.preset.value = presetKey;
        ids.symbol.value = preset.symbol;
        ids.underlying.value = preset.underlying;
        ids.loopSeconds.value = String(preset.loopSeconds);
        ids.targetDelta.value = String(preset.targetAbsDelta);
        ids.entryDteMin.value = String(preset.entryDteMin);
        ids.entryDteMax.value = String(preset.entryDteMax);
        ids.baseContracts.value = String(preset.baseContracts);
        ids.maxContracts.value = String(preset.maxContracts);
        ids.cooldownCycles.value = String(preset.cooldownCycles);
        ids.bullishThreshold.value = String(preset.bullishThreshold);
        ids.bearishThreshold.value = String(preset.bearishThreshold);
        ids.minConfidence.value = String(preset.minConfidence);
        ids.slopeLookback.value = String(preset.slopeLookback);
        ids.emaFast.value = String(preset.emaFastPeriod);
        ids.emaSlow.value = String(preset.emaSlowPeriod);
        ids.rsiPeriod.value = String(preset.rsiPeriod);
        ids.preferredRegime.value = String(preset.preferredRegime);
        ids.minVolatilityPct.value = String(preset.minVolatilityPct);
        ids.requireEma.checked = Boolean(preset.requireEmaAlignment);
        ids.requireRsi.checked = Boolean(preset.requireRsiConfirmation);
        ids.takeProfitPct.value = String(preset.takeProfitPct);
        ids.stopLossPct.value = String(preset.stopLossPct);
        ids.maxHoldCycles.value = String(preset.maxHoldCycles);
        ids.neutralExitCycles.value = String(preset.neutralExitCycles);
        ids.maxSessionProfit.value = String(preset.maxSessionProfit);
        ids.maxSessionLoss.value = String(preset.maxSessionLoss);
        ids.maxConsecutiveLosses.value = String(preset.maxConsecutiveLosses);
        if (shouldPersist) {
            saveConfigLocally();
            setStatus(`Applied ${presetKey.replaceAll("_", " ")} preset.`, "success");
        }
    }

    function getConfig() {
        return {
            symbol: String(ids.symbol.value || "BTCUSD"),
            underlying: String(ids.underlying.value || "BTC"),
            presetKey: String(ids.preset.value || "custom"),
            loopSeconds: Number(ids.loopSeconds.value || 8),
            targetAbsDelta: Number(ids.targetDelta.value || 0.28),
            entryDteMin: Number(ids.entryDteMin.value || 1),
            entryDteMax: Number(ids.entryDteMax.value || 5),
            baseContracts: Number(ids.baseContracts.value || 1),
            maxContracts: Number(ids.maxContracts.value || 2),
            cooldownCycles: Number(ids.cooldownCycles.value || 1),
            bullishThreshold: Number(ids.bullishThreshold.value || 4),
            bearishThreshold: Number(ids.bearishThreshold.value || 4),
            minConfidence: Number(ids.minConfidence.value || 62),
            slopeLookback: Number(ids.slopeLookback.value || 3),
            emaFastPeriod: Number(ids.emaFast.value || 4),
            emaSlowPeriod: Number(ids.emaSlow.value || 9),
            rsiPeriod: Number(ids.rsiPeriod.value || 6),
            preferredRegime: String(ids.preferredRegime.value || "any"),
            minVolatilityPct: Number(ids.minVolatilityPct.value || 0.18),
            requireEmaAlignment: ids.requireEma.checked,
            requireRsiConfirmation: ids.requireRsi.checked,
            takeProfitPct: Number(ids.takeProfitPct.value || 10),
            stopLossPct: Number(ids.stopLossPct.value || 7),
            maxHoldCycles: Number(ids.maxHoldCycles.value || 4),
            neutralExitCycles: Number(ids.neutralExitCycles.value || 2),
            maxSessionProfit: Number(ids.maxSessionProfit.value || 40),
            maxSessionLoss: Number(ids.maxSessionLoss.value || 25),
            maxConsecutiveLosses: Number(ids.maxConsecutiveLosses.value || 3)
        };
    }

    function saveConfigLocally() {
        localStorage.setItem(storageKey, JSON.stringify({
            profileId: ids.profileId.value,
            ...getConfig()
        }));
    }

    function markPresetCustom() {
        const current = getConfig();
        const selectedPreset = presets[current.presetKey];
        if (!selectedPreset) {
            ids.preset.value = "custom";
            return;
        }
        const keys = Object.keys(selectedPreset);
        const isMatch = keys.every(function (key) {
            return String(current[key]) === String(selectedPreset[key]);
        });
        ids.preset.value = isMatch ? current.presetKey : "custom";
    }

    function loadConfigLocally() {
        try {
            const raw = localStorage.getItem(storageKey);
            if (!raw) {
                applyPreset("btc_scalper", false);
                return;
            }
            const saved = JSON.parse(raw);
            if (!saved || typeof saved !== "object") {
                applyPreset("btc_scalper", false);
                return;
            }
            if (saved.presetKey && presets[String(saved.presetKey)]) {
                applyPreset(String(saved.presetKey), false);
            }
            ids.profileId.value = String(saved.profileId || "");
            ids.symbol.value = String(saved.symbol || ids.symbol.value);
            ids.underlying.value = String(saved.underlying || ids.underlying.value);
            ids.loopSeconds.value = String(saved.loopSeconds || ids.loopSeconds.value);
            ids.targetDelta.value = String(saved.targetAbsDelta || ids.targetDelta.value);
            ids.entryDteMin.value = String(saved.entryDteMin || ids.entryDteMin.value);
            ids.entryDteMax.value = String(saved.entryDteMax || ids.entryDteMax.value);
            ids.baseContracts.value = String(saved.baseContracts || ids.baseContracts.value);
            ids.maxContracts.value = String(saved.maxContracts || ids.maxContracts.value);
            ids.cooldownCycles.value = String(saved.cooldownCycles || ids.cooldownCycles.value);
            ids.bullishThreshold.value = String(saved.bullishThreshold || ids.bullishThreshold.value);
            ids.bearishThreshold.value = String(saved.bearishThreshold || ids.bearishThreshold.value);
            ids.minConfidence.value = String(saved.minConfidence || ids.minConfidence.value);
            ids.slopeLookback.value = String(saved.slopeLookback || ids.slopeLookback.value);
            ids.emaFast.value = String(saved.emaFastPeriod || ids.emaFast.value);
            ids.emaSlow.value = String(saved.emaSlowPeriod || ids.emaSlow.value);
            ids.rsiPeriod.value = String(saved.rsiPeriod || ids.rsiPeriod.value);
            ids.preferredRegime.value = String(saved.preferredRegime || ids.preferredRegime.value);
            ids.minVolatilityPct.value = String(saved.minVolatilityPct || ids.minVolatilityPct.value);
            ids.requireEma.checked = saved.requireEmaAlignment !== false;
            ids.requireRsi.checked = Boolean(saved.requireRsiConfirmation);
            ids.takeProfitPct.value = String(saved.takeProfitPct || ids.takeProfitPct.value);
            ids.stopLossPct.value = String(saved.stopLossPct || ids.stopLossPct.value);
            ids.maxHoldCycles.value = String(saved.maxHoldCycles || ids.maxHoldCycles.value);
            ids.neutralExitCycles.value = String(saved.neutralExitCycles || ids.neutralExitCycles.value);
            ids.maxSessionProfit.value = String(saved.maxSessionProfit || ids.maxSessionProfit.value);
            ids.maxSessionLoss.value = String(saved.maxSessionLoss || ids.maxSessionLoss.value);
            ids.maxConsecutiveLosses.value = String(saved.maxConsecutiveLosses || ids.maxConsecutiveLosses.value);
            ids.preset.value = String(saved.presetKey || ids.preset.value || "btc_scalper");
            markPresetCustom();
        }
        catch (_error) {
            applyPreset("btc_scalper", false);
        }
    }

    async function getJson(url) {
        const response = await fetch(url, { credentials: "same-origin" });
        return await response.json();
    }

    async function postJson(url, body) {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify(body || {})
        });
        return await response.json();
    }

    function renderList(node, values, fallbackText) {
        if (!node) {
            return;
        }
        if (!Array.isArray(values) || !values.length) {
            node.innerHTML = `<li>${escapeHtml(fallbackText)}</li>`;
            return;
        }
        node.innerHTML = values.map(function (value) {
            return `<li>${escapeHtml(value || "")}</li>`;
        }).join("");
    }

    function renderTable(target, rows, mapper, emptyText, colspan) {
        if (!Array.isArray(rows) || !rows.length) {
            target.innerHTML = `<tr><td colspan="${colspan}" class="directional-demo-empty">${escapeHtml(emptyText)}</td></tr>`;
            return;
        }
        target.innerHTML = rows.map(mapper).join("");
    }

    function renderEquityChart(points) {
        const svg = ids.equityChart;
        if (!svg) {
            return;
        }
        const rows = Array.isArray(points) ? points : [];
        if (!rows.length) {
            svg.innerHTML = '<text x="50%" y="50%" fill="rgba(162,180,228,0.7)" text-anchor="middle" dominant-baseline="middle">No equity points yet</text>';
            return;
        }
        const values = rows.map(function (row) { return Number(row.totalPnl || 0); });
        const min = Math.min(...values, 0);
        const max = Math.max(...values, 0);
        const range = Math.max(1, max - min);
        const width = 600;
        const height = 220;
        const padX = 16;
        const padY = 20;
        const usableW = width - (padX * 2);
        const usableH = height - (padY * 2);

        const line = rows.map(function (row, index) {
            const x = padX + ((usableW * index) / Math.max(1, rows.length - 1));
            const y = padY + ((max - Number(row.totalPnl || 0)) / range) * usableH;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(" ");
        const lastValue = Number(rows[rows.length - 1]?.totalPnl || 0);
        const zeroY = padY + ((max - 0) / range) * usableH;
        const stroke = lastValue >= 0 ? "#61f0a8" : "#ff9090";

        svg.innerHTML = `
            <line x1="${padX}" y1="${zeroY.toFixed(1)}" x2="${width - padX}" y2="${zeroY.toFixed(1)}" stroke="rgba(162,180,228,0.2)" stroke-dasharray="4 6" />
            <polyline fill="none" stroke="${stroke}" stroke-width="3" points="${line}" />
            <circle cx="${line.split(" ").pop().split(",")[0]}" cy="${line.split(" ").pop().split(",")[1]}" r="4" fill="${stroke}" />
        `;
    }

    function renderStatus(payload) {
        const data = payload?.data || payload || {};
        const signal = data.lastSignal || {};
        const totals = data.totals || {};
        const latestTicker = data.latestTicker || {};
        const guidance = data.guidance || {};

        ids.engineState.textContent = data.running ? "Running" : (data.lastError ? "Stopped / Error" : "Stopped");
        ids.profileLabel.textContent = String(data.profileLabel || "Not Selected");
        ids.spot.textContent = fmt(latestTicker.spot, 2);
        ids.mark.textContent = fmt(latestTicker.mark, 2);
        ids.bid.textContent = fmt(latestTicker.bestBid, 2);
        ids.ask.textContent = fmt(latestTicker.bestAsk, 2);
        ids.lastTick.textContent = latestTicker.ts ? `Last snapshot: ${latestTicker.ts}` : "No market snapshot yet.";

        ids.bullishScore.textContent = String(signal.bullishScore ?? 0);
        ids.bearishScore.textContent = String(signal.bearishScore ?? 0);
        ids.confidence.textContent = `${Number(signal.confidence || 0).toFixed(0)}%`;
        ids.bias.textContent = String(signal.bias || "neutral").replace(/^./, function (char) { return char.toUpperCase(); });
        ids.regime.textContent = String(signal.regime || "unclear").replace(/^./, function (char) { return char.toUpperCase(); });
        ids.action.textContent = String(signal.suggestedAction || "wait").replaceAll("_", " ");
        ids.openCount.textContent = String(totals.openCount || 0);
        ids.winRate.textContent = `${fmt(totals.winRatePct, 0)}%`;
        ids.avgWin.textContent = fmt(totals.avgWin, 2);
        ids.avgLoss.textContent = fmt(totals.avgLoss, 2);
        ids.bestTrade.textContent = fmt(totals.bestTrade, 2);
        ids.worstTrade.textContent = fmt(totals.worstTrade, 2);
        ids.totalPnl.textContent = fmt(totals.totalPnl, 2);
        ids.modeLabel.textContent = String(guidance.modeLabel || "Scalper Demo");
        ids.startAdvice.textContent = guidance.shouldStart ? "Start Now" : "Wait";
        ids.stopAdvice.textContent = guidance.shouldStop ? "Stop Now" : "Keep Running";
        ids.startSummary.textContent = String(guidance.startSummary || "Wait for live rates and signal build-up before starting.");
        ids.stopSummary.textContent = String(guidance.stopSummary || "Keep running while the session guardrails stay intact.");
        ids.emaFastValue.textContent = fmt(signal.emaFast, 2);
        ids.emaSlowValue.textContent = fmt(signal.emaSlow, 2);
        ids.rsiValue.textContent = fmt(signal.rsi, 2);
        ids.slopeValue.textContent = `${fmt(signal.slopePct, 3)}%`;
        ids.volatilityValue.textContent = `${fmt(signal.volatilityPct, 3)}%`;
        ids.trendScoreValue.textContent = String(signal.trendScore ?? "-");
        ids.rangeScoreValue.textContent = String(signal.rangeScore ?? "-");
        ids.cycleCount.textContent = String(data.cycleCount || 0);

        renderList(ids.drivers, signal.drivers, "No drivers yet.");
        renderList(ids.blocks, signal.blockers, "No blockers.");
        renderList(ids.checklist, guidance.checklist, "Preset and session guardrails will appear here.");
        renderEquityChart(data.equityCurve);

        renderTable(ids.openPositionsBody, data.openPositions, function (row) {
            const rowId = escapeHtml(row.id || "");
            return `<tr>
                <td>${escapeHtml(String(row.optionType || "").toUpperCase())}</td>
                <td>${escapeHtml(String(row.side || "").toUpperCase())}</td>
                <td>${escapeHtml(row.symbol || "")}</td>
                <td>${escapeHtml(row.qty || 0)}</td>
                <td>${fmt(row.entryPrice, 2)}</td>
                <td>${fmt(row.markPrice, 2)}</td>
                <td>${fmt(row.currentDelta, 3)}</td>
                <td>${fmt(row.currentDte, 2)}</td>
                <td>${fmt(row.unrealizedPnl, 2)}</td>
                <td>${escapeHtml(row.openedAt || "")}</td>
                <td><button type="button" class="directional-demo-close-btn" data-position-id="${rowId}">Close</button></td>
            </tr>`;
        }, "No paper positions yet.", 11);

        renderTable(ids.closedPositionsBody, data.closedPositions, function (row) {
            return `<tr>
                <td>${escapeHtml(String(row.optionType || "").toUpperCase())}</td>
                <td>${escapeHtml(String(row.side || "").toUpperCase())}</td>
                <td>${escapeHtml(row.symbol || "")}</td>
                <td>${escapeHtml(row.qty || 0)}</td>
                <td>${fmt(row.entryPrice, 2)}</td>
                <td>${fmt(row.closePrice, 2)}</td>
                <td>${escapeHtml(row.closeReason || "")}</td>
                <td>${fmt(row.realizedPnl, 2)}</td>
                <td>${escapeHtml(row.closedAt || "")}</td>
            </tr>`;
        }, "No closed paper positions yet.", 9);

        const events = Array.isArray(data.events) ? data.events : [];
        ids.eventsLog.innerHTML = events.length
            ? events.map(function (event) {
                return `<div class="directional-demo-log-item"><div><strong>${escapeHtml(event.type || "EVENT")}</strong> <span>${escapeHtml(event.ts || "")}</span></div><div>${escapeHtml(event.title || "")}</div><div>${escapeHtml(event.message || "")}</div></div>`;
            }).join("")
            : '<div class="directional-demo-empty">No events yet.</div>';

        if (data.config?.presetKey) {
            ids.preset.value = String(data.config.presetKey);
        }

        if (data.lastError) {
            setStatus(data.lastError, "danger");
        }
    }

    async function loadApiProfiles() {
        const payload = await getJson("/api/account/delta-api-profiles");
        const profiles = Array.isArray(payload?.data) ? payload.data : [];
        ids.profileId.innerHTML = '<option value="">Select API profile</option>' + profiles.map(function (profile) {
            return `<option value="${escapeHtml(String(profile.profileId || ""))}">${escapeHtml(String(profile.referenceName || "Profile"))}</option>`;
        }).join("");
        loadConfigLocally();
    }

    async function refreshStatus() {
        const payload = await getJson("/api/directional-options-demo/status");
        renderStatus(payload);
    }

    function buildRequestBody(extra) {
        return {
            profileId: String(ids.profileId.value || "").trim(),
            config: getConfig(),
            ...(extra || {})
        };
    }

    async function handleAction(url, extra, successMessage) {
        saveConfigLocally();
        const payload = await postJson(url, buildRequestBody(extra));
        const tone = payload?.status === "danger" ? "danger" : (payload?.status === "warning" ? "warning" : "success");
        setStatus(String(payload?.message || successMessage || "Done."), tone);
        if (payload?.data) {
            renderStatus(payload);
            return;
        }
        await refreshStatus();
    }

    ids.preset.addEventListener("change", function () {
        const selected = String(ids.preset.value || "custom");
        if (selected !== "custom") {
            applyPreset(selected, true);
        }
        else {
            saveConfigLocally();
        }
    });

    ids.symbol.addEventListener("change", function () {
        ids.underlying.value = ids.symbol.value === "ETHUSD" ? "ETH" : "BTC";
        markPresetCustom();
        saveConfigLocally();
    });

    [
        ids.profileId,
        ids.underlying,
        ids.loopSeconds,
        ids.targetDelta,
        ids.entryDteMin,
        ids.entryDteMax,
        ids.baseContracts,
        ids.maxContracts,
        ids.cooldownCycles,
        ids.bullishThreshold,
        ids.bearishThreshold,
        ids.minConfidence,
        ids.slopeLookback,
        ids.emaFast,
        ids.emaSlow,
        ids.rsiPeriod,
        ids.preferredRegime,
        ids.minVolatilityPct,
        ids.requireEma,
        ids.requireRsi,
        ids.takeProfitPct,
        ids.stopLossPct,
        ids.maxHoldCycles,
        ids.neutralExitCycles,
        ids.maxSessionProfit,
        ids.maxSessionLoss,
        ids.maxConsecutiveLosses
    ].forEach(function (node) {
        node?.addEventListener("change", function () {
            markPresetCustom();
            saveConfigLocally();
        });
    });

    ids.btnStart.addEventListener("click", async function () {
        await handleAction("/api/directional-options-demo/start", {}, "Auto trader started. Entries and exits are now fully automated in paper mode.");
    });
    ids.btnCycle.addEventListener("click", async function () {
        await handleAction("/api/directional-options-demo/cycle", {}, "Directional demo cycle completed.");
    });
    ids.btnStop.addEventListener("click", async function () {
        await handleAction("/api/directional-options-demo/stop", { reason: "Manual stop from demo page" }, "Auto trader stopped. No new paper trades will be opened or closed automatically.");
    });
    ids.btnReset.addEventListener("click", async function () {
        await handleAction("/api/directional-options-demo/reset", {}, "Directional demo reset.");
    });
    ids.btnEmergency.addEventListener("click", async function () {
        await handleAction("/api/directional-options-demo/emergency-stop", { reason: "Manual emergency close from demo page" }, "Directional demo emergency-stopped.");
    });
    ids.btnRefresh.addEventListener("click", refreshStatus);
    ids.openPositionsBody.addEventListener("click", async function (event) {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }
        const button = target.closest("[data-position-id]");
        if (!(button instanceof HTMLElement)) {
            return;
        }
        const positionId = String(button.getAttribute("data-position-id") || "").trim();
        if (!positionId) {
            return;
        }
        setStatus("Closing paper position with current rates...", "warning");
        await handleAction(`/api/directional-options-demo/positions/${encodeURIComponent(positionId)}/close`, {}, "Paper position closed.");
    });

    loadApiProfiles().then(refreshStatus);
    setInterval(refreshStatus, 7000);
})();
