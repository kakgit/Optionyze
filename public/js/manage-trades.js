(function () {
    "use strict";
    function createIvTracker(prefix, side) {
        side = side === "put" ? "put" : "call";

    const deltaUiTimezoneOffsetMinutes = 5.5 * 60;

    function getCurrentDeltaDate() {
        const dateValue = new Date(Date.now() + (deltaUiTimezoneOffsetMinutes * 60 * 1000));
        return new Date(Date.UTC(dateValue.getUTCFullYear(), dateValue.getUTCMonth(), dateValue.getUTCDate()));
    }

    function getLastFridayOfMonth(yearValue, monthIndex) {
        const dateValue = new Date(Date.UTC(yearValue, monthIndex + 1, 0));
        while (dateValue.getUTCDay() !== 5) {
            dateValue.setUTCDate(dateValue.getUTCDate() - 1);
        }
        return dateValue;
    }

    function getFutureFriday(baseDate, fridayOffset) {
        const currentDayOfWeek = baseDate.getUTCDay();
        const daysToThisFriday = (5 - currentDayOfWeek + 7) % 7;
        const dateValue = new Date(baseDate);
        dateValue.setUTCDate(baseDate.getUTCDate() + daysToThisFriday + (fridayOffset * 7));
        return dateValue;
    }

    function resolveExpiryDateByMode(expiryMode) {
        const modeValue = String(expiryMode || "").trim();
        const currentDate = getCurrentDeltaDate();

        if (modeValue === "1") {
            currentDate.setUTCDate(currentDate.getUTCDate() + 1);
            return currentDate;
        }
        if (modeValue === "2") {
            currentDate.setUTCDate(currentDate.getUTCDate() + 2);
            return currentDate;
        }
        if (modeValue === "4") {
            const weeklyFridayOffset = (currentDate.getUTCDay() >= 3 && currentDate.getUTCDay() <= 5) ? 1 : 0;
            return getFutureFriday(currentDate, weeklyFridayOffset);
        }
        if (modeValue === "5") {
            const biWeeklyCandidate = getFutureFriday(currentDate, 1);
            const msPerDay = 24 * 60 * 60 * 1000;
            const daysToCandidate = Math.floor((biWeeklyCandidate.getTime() - currentDate.getTime()) / msPerDay);
            return daysToCandidate <= 10 ? getFutureFriday(currentDate, 2) : biWeeklyCandidate;
        }
        if (modeValue === "6") {
            const lastFridayOfMonth = getLastFridayOfMonth(currentDate.getUTCFullYear(), currentDate.getUTCMonth());
            const lastFridayOfNextMonth = getLastFridayOfMonth(currentDate.getUTCFullYear(), currentDate.getUTCMonth() + 1);
            const msPerDay = 24 * 60 * 60 * 1000;
            const daysToCandidate = Math.floor((lastFridayOfMonth.getTime() - currentDate.getTime()) / msPerDay);
            return daysToCandidate <= 14 ? lastFridayOfNextMonth : lastFridayOfMonth;
        }
        if (modeValue === "7") {
            const lastFridayOfNextMonth = getLastFridayOfMonth(currentDate.getUTCFullYear(), currentDate.getUTCMonth() + 1);
            const lastFridayOfThirdMonth = getLastFridayOfMonth(currentDate.getUTCFullYear(), currentDate.getUTCMonth() + 2);
            const msPerDay = 24 * 60 * 60 * 1000;
            const daysToCandidate = Math.floor((lastFridayOfNextMonth.getTime() - currentDate.getTime()) / msPerDay);
            return daysToCandidate <= 40 ? lastFridayOfThirdMonth : lastFridayOfNextMonth;
        }

        return currentDate;
    }

    function formatDateInputValue(dateValue) {
        if (!(dateValue instanceof Date) || Number.isNaN(dateValue.getTime())) {
            return "";
        }
        const year = String(dateValue.getUTCFullYear());
        const month = String(dateValue.getUTCMonth() + 1).padStart(2, "0");
        const day = String(dateValue.getUTCDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

    const controlPairs = [
        { selectId: `${prefix}SlowIvExpiryType`, inputId: `${prefix}SlowIvExpiry` },
        { selectId: `${prefix}FastIvExpiryType`, inputId: `${prefix}FastIvExpiry` }
    ];

    function applyExpiryMode(pair, force) {
        const select = document.getElementById(pair.selectId);
        const input = document.getElementById(pair.inputId);
        if (!(select instanceof HTMLSelectElement) || !(input instanceof HTMLInputElement)) {
            return;
        }
        const resolvedDate = resolveExpiryDateByMode(select.value);
        const formattedDate = formatDateInputValue(resolvedDate);
        if ((force || !String(input.value || "").trim()) && formattedDate) {
            input.value = formattedDate;
        }
    }

    // ---- IV Tracker websocket state ----
    let ivSocket = null;
    let ivPingTimer = null;
    let ivRunning = false;
    let slowIvSymbol = "";
    let fastIvSymbol = "";
    let ivLastLoggedSignature = "";
    let ivLastLoggedAt = 0;
    let ivShiftTimer = null;
    let ivPeriodicTimer = null;
    let latestSlowIv = null;
    let latestFastIv = null;
    let prevIvState = null;
    let hasPrevIvState = false;
    let ivChartCanvas = null;
    let ivChartCtx = null;
    let ivChartPoints = [];
    let ivChartBaseWidth = 0;
    let slowIvExpiryLabel = "MONTHLY";
    let fastIvExpiryLabel = "WEEKLY";

    const IV_ATM_REFRESH_MS = {
        1: 60000,   // Daily T+1
        2: 60000,   // Daily T+2
        4: 180000,  // Weekly
        5: 180000,  // Bi-weekly
        6: 300000,  // Monthly
        7: 300000   // Bi-monthly
    };
    let ivAtmRefreshTimer = null;
    let ivAtmRefreshInProgress = false;
    let ivChartStrikeMarks = [];
    let ivSubscribedSymbols = new Set();
    let slowIvExpiryType = "";
    let slowIvExpiryDate = "";
    let slowIvStrike = null;
    let slowIvNextRefreshAt = 0;
    let fastIvExpiryType = "";
    let fastIvExpiryDate = "";
    let fastIvStrike = null;
    let fastIvNextRefreshAt = 0;

    function htmlDateToDeltaLabel(value) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
        if (!m) return "";
        return `${m[3]}-${m[2]}-${m[1]}`;
    }

    function getIvLog() {
        return document.getElementById(`${prefix}IvLog`);
    }

    function getIvChartCanvas() {
        return document.getElementById(`${prefix}IvChart`);
    }
    function initIvChart() {
        ivChartCanvas = getIvChartCanvas();
        if (!ivChartCanvas) return;
        ivChartBaseWidth = 0;
        const scrollBox = document.getElementById(`${prefix}IvChartScroll`);
        const dpr = window.devicePixelRatio || 1;
        const width = (scrollBox && scrollBox.clientWidth) ? scrollBox.clientWidth : (ivChartCanvas.width || 1000);
        const height = 320;
        ivChartCanvas.width = Math.round(width * dpr);
        ivChartCanvas.height = Math.round(height * dpr);
        ivChartCanvas.style.width = width + "px";
        ivChartCanvas.style.height = height + "px";
        const spacer0 = document.getElementById(`${prefix}IvChartSpacer`);
        if (spacer0) spacer0.style.width = width + "px";
        ivChartCtx = ivChartCanvas.getContext("2d");
        if (ivChartCtx) ivChartCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawIvChart();
    }
    function pushIvChartPoint() {
        if (latestSlowIv === null && latestFastIv === null) return;
        ivChartPoints.push({
            t: Date.now(),
            slow: latestSlowIv,
            fast: latestFastIv
        });
        if (ivChartPoints.length > 2000) ivChartPoints.shift();
        drawIvChart();
    }
    function getIvChartBounds() {
        const values = [];
        ivChartPoints.forEach(function (p) {
            if (p.fast !== null) values.push(p.fast * 100);
            if (p.slow !== null) values.push(p.slow * 100);
        });
        if (!values.length) return { min: 0, max: 100 };
        let min = Math.min.apply(null, values);
        let max = Math.max.apply(null, values);
        if (max - min < 0.1) {
            min -= 0.5;
            max += 0.5;
        } else {
            const pad = (max - min) * 0.12;
            min -= pad;
            max += pad;
        }
        return { min: min, max: max };
    }
    function drawIvAxes(ctx, cssW, cssH, pad, minY, maxY) {
        ctx.fillStyle = "rgba(8, 16, 36, 1)";
        ctx.fillRect(0, 0, cssW, cssH);
        ctx.strokeStyle = "rgba(148, 163, 184, 0.18)";
        ctx.fillStyle = "#94a3b8";
        ctx.font = "11px sans-serif";
        const tickCount = 5;
        for (let i = 0; i <= tickCount; i++) {
            const ratio = i / tickCount;
            const y = pad.top + (1 - ratio) * (cssH - pad.top - pad.bottom);
            ctx.beginPath();
            ctx.moveTo(pad.left, y);
            ctx.lineTo(cssW - pad.right, y);
            ctx.stroke();
            const value = minY + ratio * (maxY - minY);
        ctx.textAlign = "left";
        ctx.fillText(value.toFixed(2) + "%", 6, y + 4);
        ctx.textAlign = "right";
        ctx.fillText(value.toFixed(2) + "%", cssW - 6, y + 4);
        ctx.textAlign = "left";
        }
        ctx.strokeStyle = "rgba(148, 163, 184, 0.35)";
        ctx.beginPath();
        ctx.moveTo(pad.left, cssH - pad.bottom);
        ctx.lineTo(cssW - pad.right, cssH - pad.bottom);
        ctx.stroke();
    }
    function drawIvSeries(ctx, points, cssW, cssH, pad, minY, maxY, key, color, dashed) {
        const t0 = points[0].t;
        const t1 = points[points.length - 1].t;
        const span = Math.max(1, t1 - t0);
        const plotW = cssW - pad.left - pad.right;
        const plotH = cssH - pad.top - pad.bottom;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.setLineDash(dashed ? [6, 4] : []);
        ctx.beginPath();
        let started = false;
        points.forEach(function (p) {
            if (p[key] === null) return;
            const x = pad.left + ((p.t - t0) / span) * plotW;
            const pct = p[key] * 100;
            const y = pad.top + (1 - (pct - minY) / (maxY - minY)) * plotH;
            if (!started) { ctx.moveTo(x, y); started = true; }
            else { ctx.lineTo(x, y); }
        });
        ctx.stroke();
        ctx.setLineDash([]);
    }
    function drawIvAnnotations(ctx, points, cssW, cssH, pad, minY, maxY) {
        if (points.length < 2) return;
        const t0 = points[0].t;
        const t1 = points[points.length - 1].t;
        const span = Math.max(1, t1 - t0);
        const plotW = cssW - pad.left - pad.right;
        const plotH = cssH - pad.top - pad.bottom;
        for (let i = 0; i < points.length - 1; i++) {
            const a = points[i];
            const b = points[i + 1];
            if (a.fast === null || a.slow === null || b.fast === null || b.slow === null) continue;
            if (!(a.fast > a.slow && b.fast > b.slow)) continue;
            const x1 = pad.left + ((a.t - t0) / span) * plotW;
            const x2 = pad.left + ((b.t - t0) / span) * plotW;
            ctx.fillStyle = "rgba(248, 113, 113, 0.16)";
            ctx.fillRect(Math.min(x1, x2), pad.top, Math.max(1, Math.abs(x2 - x1)), plotH);
        }
        for (let i = 1; i < points.length; i++) {
            const prev = points[i - 1];
            const curr = points[i];
            if (prev.fast === null || prev.slow === null || curr.fast === null || curr.slow === null) continue;
            if (prev.fast > prev.slow && curr.fast <= curr.slow) {
                const x = pad.left + ((curr.t - t0) / span) * plotW;
                ctx.strokeStyle = "#22c55e";
                ctx.lineWidth = 1.5;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.moveTo(x, pad.top);
                ctx.lineTo(x, cssH - pad.bottom);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = "#22c55e";
                ctx.font = "bold 10px sans-serif";
                ctx.fillText("EXECUTE STRANGLE (Term Structure Normalized)", x + 4, pad.top + 12);
            }
        }
        const last = points[points.length - 1];
        if (last.fast !== null && last.slow !== null && last.fast > last.slow) {
            const x = pad.left + ((last.t - t0) / span) * plotW;
            ctx.fillStyle = "rgba(248, 113, 113, 0.9)";
            ctx.font = "bold 10px sans-serif";
            ctx.fillText("Market Panic (Backwardation)", x + 6, pad.top + 24);
        }
    }

    function drawIvStrikeMarks(ctx, points, cssW, cssH, pad) {
        if (!Array.isArray(ivChartStrikeMarks) || !ivChartStrikeMarks.length || points.length < 2) return;
        const t0 = points[0].t;
        const t1 = points[points.length - 1].t;
        const span = Math.max(1, t1 - t0);
        const plotW = cssW - pad.left - pad.right;
        ctx.save();
        ctx.setLineDash([3, 4]);
        ctx.lineWidth = 1;
        ctx.font = "bold 9px sans-serif";
        ivChartStrikeMarks.forEach(function (mark) {
            if (mark.t < t0 || mark.t > t1) return;
            const x = pad.left + ((mark.t - t0) / span) * plotW;
            ctx.strokeStyle = "rgba(250, 204, 21, 0.75)";
            ctx.beginPath();
            ctx.moveTo(x, pad.top);
            ctx.lineTo(x, cssH - pad.bottom);
            ctx.stroke();
            ctx.setLineDash([]);
            const label = mark.label || (mark.oldStrike != null && mark.newStrike != null ? `${mark.oldStrike}->${mark.newStrike}` : "");
            if (label) {
                ctx.fillStyle = "rgba(250, 204, 21, 0.95)";
                ctx.textAlign = "center";
                ctx.fillText(label, x, pad.top - 6);
                ctx.textAlign = "left";
            }
            ctx.setLineDash([3, 4]);
        });
        ctx.restore();
    }
    function drawIvXLabels(ctx, points, cssW, cssH, pad) {
        const t0 = points[0].t;
        const t1 = points[points.length - 1].t;
        const span = Math.max(1, t1 - t0);
        const plotW = cssW - pad.left - pad.right;
        ctx.fillStyle = "#94a3b8";
        ctx.font = "10px sans-serif";
        const count = points.length <= 20 ? points.length : 12;
        for (let i = 0; i < count; i++) {
            const idx = Math.round((i / (count - 1 || 1)) * (points.length - 1));
            const p = points[idx];
            const x = pad.left + ((p.t - t0) / span) * plotW;
            const d = new Date(p.t);
            const hh = String(d.getHours()).padStart(2, "0");
            const mm = String(d.getMinutes()).padStart(2, "0");
            const ss = String(d.getSeconds()).padStart(2, "0");
            ctx.fillText(hh + ":" + mm + ":" + ss, x - 18, cssH - pad.bottom + 16);
        }
    }
    function drawIvLegend(ctx, cssW, pad) {
        const y = 14;
        let x = cssW - pad.right - 260;
        ctx.strokeStyle = "#2563eb";
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 18, y);
        ctx.stroke();
        ctx.fillStyle = "#e2e8f0";
        ctx.font = "11px sans-serif";
        ctx.fillText(fastIvExpiryLabel + " IV (Fast)", x + 24, y + 4);
        x += 135;
        ctx.strokeStyle = "#7c3aed";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 18, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#e2e8f0";
        ctx.fillText(slowIvExpiryLabel + " IV (Slow)", x + 24, y + 4);
    }
    function drawIvChart() {
        const canvas = ivChartCanvas || getIvChartCanvas();
        if (!canvas) return;
        if (!ivChartCtx) {
            ivChartCtx = canvas.getContext("2d");
        }
        const ctx = ivChartCtx;
        if (!ctx) return;
        const dpr = window.devicePixelRatio || 1;
        const scrollBox = document.getElementById(`${prefix}IvChartScroll`);
        if (scrollBox && !ivChartBaseWidth) {
            ivChartBaseWidth = scrollBox.clientWidth;
        }
        const baseWidth = ivChartBaseWidth || (scrollBox && scrollBox.clientWidth) || (canvas.clientWidth || 1000);
        if (scrollBox) {
            scrollBox.style.width = baseWidth + "px";
            scrollBox.style.minWidth = baseWidth + "px";
            scrollBox.style.maxWidth = baseWidth + "px";
        }
        const desiredWidth = Math.max(baseWidth, ivChartPoints.length * 24);
        if (canvas.width !== Math.round(desiredWidth * dpr) || canvas.height !== Math.round(320 * dpr)) {
            canvas.width = Math.round(desiredWidth * dpr);
            canvas.height = Math.round(320 * dpr);
            canvas.style.width = desiredWidth + "px";
            canvas.style.height = "320px";
            canvas.style.maxWidth = "none";
            const spacer = document.getElementById(`${prefix}IvChartSpacer`);
            if (spacer) spacer.style.width = desiredWidth + "px";
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
        const cssW = canvas.width / dpr;
        const cssH = canvas.height / dpr;
        const pad = { top: 34, right: 52, bottom: 34, left: 52 };
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (ivChartPoints.length < 2) {
            ctx.fillStyle = "rgba(8, 16, 36, 1)";
            ctx.fillRect(0, 0, cssW, cssH);
            ctx.fillStyle = "#94a3b8";
            ctx.font = "13px sans-serif";
            ctx.fillText("Waiting for IV data...", 16, 24);
            drawIvLegend(ctx, cssW, pad);
            return;
        }
        const bounds = getIvChartBounds();
        drawIvAxes(ctx, cssW, cssH, pad, bounds.min, bounds.max);
        drawIvAnnotations(ctx, ivChartPoints, cssW, cssH, pad, bounds.min, bounds.max);
        drawIvStrikeMarks(ctx, ivChartPoints, cssW, cssH, pad);
        drawIvSeries(ctx, ivChartPoints, cssW, cssH, pad, bounds.min, bounds.max, "fast", "#2563eb", false);
        drawIvSeries(ctx, ivChartPoints, cssW, cssH, pad, bounds.min, bounds.max, "slow", "#7c3aed", true);
        drawIvXLabels(ctx, ivChartPoints, cssW, cssH, pad);
        drawIvLegend(ctx, cssW, pad);
    }


    function appendIvLog(line) {
        const logEl = getIvLog();
        if (!logEl) return;
        const row = document.createElement("div");
        row.textContent = `[${new Date().toLocaleTimeString()}] ${line}`;
        logEl.appendChild(row);
        logEl.scrollTop = logEl.scrollHeight;
        while (logEl.childNodes.length > 500) {
            logEl.removeChild(logEl.firstChild);
        }
    }

    function getDirectionLog() {
        return document.getElementById(`${prefix}DirectionLog`);
    }

    function appendDirectionLog(direction) {
        const logEl = getDirectionLog();
        if (!logEl) return;
        const row = document.createElement("div");
        const now = new Date();
        row.textContent = `[${now.toLocaleString()}] ${direction}`;
        row.style.color = direction === "UP" ? "#34d399" : "#f87171";
        row.style.fontWeight = "700";
        logEl.appendChild(row);
        logEl.scrollTop = logEl.scrollHeight;
        while (logEl.childNodes.length > 500) {
            logEl.removeChild(logEl.firstChild);
        }
    }

    function collectIvRows(message) {
        const rows = [];
        if (!message || typeof message !== "object") return rows;
        if (Array.isArray(message.d)) message.d.forEach((r) => rows.push(r));
        if (Array.isArray(message.result)) message.result.forEach((r) => rows.push(r));
        if (message.s || message.symbol || message.quotes || message.q) rows.push(message);
        return rows;
    }

    function getIvFromRow(row) {
        const qiv = Array.isArray(row?.qiv) ? row.qiv : [];
        const raw = qiv.length ? qiv[qiv.length - 1] : (row?.mark_iv ?? row?.mark_vol ?? row?.implied_volatility ?? row?.iv ?? row?.iv_value);
        const value = Number(raw);
        return Number.isFinite(value) ? value : null;
    }

    function getSymbolFromRow(row) {
        return String(row?.symbol || row?.s || row?.contract_symbol || "").trim();
    }

    function handleIvMessage(raw) {
        let message = null;
        try {
            message = JSON.parse(String(raw || ""));
        } catch (_error) {
            return;
        }
        const messageType = String(message?.type || "").trim().toLowerCase();
        if (messageType === "heartbeat") return;
        if (messageType === "ping") {
            try {
                if (ivSocket && ivSocket.readyState === WebSocket.OPEN) {
                    ivSocket.send(JSON.stringify({ type: "pong" }));
                }
            } catch (_error) {}
            return;
        }
        if (messageType && messageType !== "ticker" && messageType !== "v2/ticker") return;
        const rows = collectIvRows(message);
        if (!rows.length) return;
        rows.forEach((row) => {
            const symbol = getSymbolFromRow(row);
            const iv = getIvFromRow(row);
            if (!symbol || iv === null) return;
            const isSlow = symbol === slowIvSymbol;
            const isFast = symbol === fastIvSymbol;
            if (!isSlow && !isFast) return;
            let ivChanged = false;
            if (isSlow) {
                if (latestSlowIv === null || Math.abs(latestSlowIv - iv) > 0.000001) ivChanged = true;
                latestSlowIv = iv;
            }
            if (isFast) {
                if (latestFastIv === null || Math.abs(latestFastIv - iv) > 0.000001) ivChanged = true;
                latestFastIv = iv;
            }
            if (ivChanged) {
                if (latestSlowIv !== null && latestFastIv !== null) {
                    if (hasPrevIvState) {
                        const prevFastAbove = prevIvState.fast > prevIvState.slow;
                        const currFastAbove = latestFastIv > latestSlowIv;
                        if (!prevFastAbove && currFastAbove) appendDirectionLog("UP");
                        else if (prevFastAbove && !currFastAbove) appendDirectionLog("DOWN");
                    }
                    prevIvState = { slow: latestSlowIv, fast: latestFastIv };
                    hasPrevIvState = true;
                }
                scheduleIvShiftLog();
                pushIvChartPoint();
            }
        });
    }

    function clearIvPingTimer() {
        if (ivPingTimer) {
            clearInterval(ivPingTimer);
            ivPingTimer = null;
        }
    }

    function emitIvLog(force) {
        const now = Date.now();
        if (!force && (now - ivLastLoggedAt) < 5000) return;
        const slowText = latestSlowIv === null ? "--" : latestSlowIv.toFixed(4);
        const fastText = latestFastIv === null ? "--" : latestFastIv.toFixed(4);
        const signature = slowText + "|" + fastText;
        if (signature === ivLastLoggedSignature && (now - ivLastLoggedAt) < 1000) return;
        appendIvLog("Slow IV: " + slowText + " | Fast IV: " + fastText);
        ivLastLoggedSignature = signature;
        ivLastLoggedAt = now;
    }
    function scheduleIvShiftLog() {
        if (ivShiftTimer) clearTimeout(ivShiftTimer);
        ivShiftTimer = setTimeout(function () {
            ivShiftTimer = null;
            emitIvLog(true);
        }, 100);
    }
    function clearIvTimers() {
        if (ivShiftTimer) { clearTimeout(ivShiftTimer); ivShiftTimer = null; }
        if (ivPeriodicTimer) { clearInterval(ivPeriodicTimer); ivPeriodicTimer = null; }
        if (ivAtmRefreshTimer) { clearInterval(ivAtmRefreshTimer); ivAtmRefreshTimer = null; }
        ivAtmRefreshInProgress = false;
    }

    function disconnectIvSocket() {
        clearIvPingTimer();
        clearIvTimers();
        if (ivSocket) {
            try {
                if (ivSocket.readyState === WebSocket.OPEN) {
                    const symbols = [slowIvSymbol, fastIvSymbol].filter(Boolean);
                    if (symbols.length) {
                        ivSocket.send(JSON.stringify({
                            type: "unsubscribe",
                            payload: { channels: [{ name: "ticker", symbols: symbols }] }
                        }));
                    }
                }
            } catch (_error) {}
            try {
                ivSocket.onopen = null;
                ivSocket.onmessage = null;
                ivSocket.onerror = null;
                ivSocket.onclose = null;
                ivSocket.close();
            } catch (_error) {}
        }
        ivSocket = null;
        ivSubscribedSymbols = new Set();
    }

    async function fetchAtmSymbol(expiryHtmlDate, sideValue) {
        const deltaLabel = htmlDateToDeltaLabel(expiryHtmlDate);
        const query = new URLSearchParams({ symbol: "BTCUSD", expiry: deltaLabel, side: sideValue || side || "call" });
        const response = await fetch(`/api/calendar-spread/atm-option?${query.toString()}`, {
            credentials: "same-origin",
            cache: "no-store"
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || !result || result.status !== "success") {
            throw new Error((result && result.message) || `ATM option fetch failed (${response.status})`);
        }
        return result.data || {};
    }

    function resubscribeIvSocket(allSymbols) {
        const symbols = Array.from(new Set((Array.isArray(allSymbols) ? allSymbols : []).map(function (s) { return String(s || "").trim(); }).filter(Boolean)));
        if (!symbols.length) return;
        if (!ivSocket || ivSocket.readyState !== WebSocket.OPEN) {
            connectIvSocket(symbols);
            return;
        }
        const toUnsub = [...ivSubscribedSymbols].filter(function (s) { return !symbols.includes(s); });
        try {
            if (toUnsub.length) {
                ivSocket.send(JSON.stringify({
                    type: "unsubscribe",
                    payload: { channels: [{ name: "ticker", symbols: toUnsub }] }
                }));
            }
            const chunkSize = 40;
            for (let index = 0; index < symbols.length; index += chunkSize) {
                const chunk = symbols.slice(index, index + chunkSize);
                ivSocket.send(JSON.stringify({
                    type: "subscribe",
                    payload: { channels: [{ name: "ticker", symbols: chunk }] }
                }));
            }
        } catch (_error) {
            appendIvLog("WebSocket resubscribe failed; reconnecting.");
            connectIvSocket(symbols);
            return;
        }
        ivSubscribedSymbols = new Set(symbols);
    }

    function connectIvSocket(symbols) {
        disconnectIvSocket();
        clearIvTimers();
        const uniqueSymbols = Array.from(new Set((Array.isArray(symbols) ? symbols : []).map((s) => String(s || "").trim()).filter(Boolean)));
        if (!uniqueSymbols.length || typeof WebSocket === "undefined") {
            appendIvLog("No ATM option symbols available for websocket.");
            return;
        }
        slowIvSymbol = slowIvSymbol || uniqueSymbols[0];
        fastIvSymbol = fastIvSymbol || uniqueSymbols[1] || uniqueSymbols[0];
        ivSocket = new WebSocket("wss://public-socket.india.delta.exchange");
        ivSocket.onopen = function () {
            const chunkSize = 40;
            for (let index = 0; index < uniqueSymbols.length; index += chunkSize) {
                const chunk = uniqueSymbols.slice(index, index + chunkSize);
                try {
                    ivSocket.send(JSON.stringify({
                        type: "subscribe",
                        payload: { channels: [{ name: "ticker", symbols: chunk }] }
                    }));
                } catch (_error) {}
            }
            try { ivSocket.send(JSON.stringify({ type: "enable_heartbeat" })); } catch (_error) {}
            clearIvPingTimer();
            ivPingTimer = setInterval(function () {
                if (!ivSocket || ivSocket.readyState !== WebSocket.OPEN) return;
                try { ivSocket.send(JSON.stringify({ type: "ping" })); } catch (_error) {}
            }, 25000);
            ivSubscribedSymbols = new Set(uniqueSymbols);
            appendIvLog(`WebSocket connected; subscribed to ${uniqueSymbols.join(", ")}.`);
            clearIvTimers();
            ivPeriodicTimer = setInterval(function () {
                if (!ivRunning) return;
                emitIvLog(false);
            }, 5000);
        };
        ivSocket.onmessage = function (event) {
            handleIvMessage(event.data);
        };
        ivSocket.onerror = function () {
            appendIvLog("WebSocket error.");
        };
        ivSocket.onclose = function () {
            clearIvPingTimer();
            appendIvLog("WebSocket closed.");
        };
    }

    function setControlsEnabled(enabled) {
        controlPairs.forEach(function (pair) {
            const select = document.getElementById(pair.selectId);
            const input = document.getElementById(pair.inputId);
            if (select) select.disabled = !enabled;
            if (input) input.disabled = !enabled;
        });
    }

    async function refreshAtmTargets() {
        if (!ivRunning || ivAtmRefreshInProgress) return;
        ivAtmRefreshInProgress = true;
        try {
            const now = Date.now();
            let changed = false;

            async function refreshSlow() {
                if (!slowIvExpiryType) return;
                const resolvedDate = resolveExpiryDateByMode(slowIvExpiryType);
                const resolvedLabel = formatDateInputValue(resolvedDate);
                if (resolvedLabel && resolvedLabel !== slowIvExpiryDate) {
                    appendIvLog(`[Slow] Expiry rolled over: ${slowIvExpiryDate || "--"} -> ${resolvedLabel}`);
                    slowIvExpiryDate = resolvedLabel;
                    const input = document.getElementById(`${prefix}SlowIvExpiry`);
                    if (input instanceof HTMLInputElement) input.value = resolvedLabel;
                    slowIvNextRefreshAt = 0;
                }
                if (now < slowIvNextRefreshAt) return;
                slowIvNextRefreshAt = now + (IV_ATM_REFRESH_MS[slowIvExpiryType] || 60000);
                let info = null;
                try {
                    info = await fetchAtmSymbol(slowIvExpiryDate, side);
                } catch (error) {
                    appendIvLog(`[Slow] ATM refresh failed: ${error instanceof Error ? error.message : String(error)}`);
                    return;
                }
                if (!info) return;
                const newSymbol = String(info.optionSymbol || "").trim();
                const newStrike = (info.strike === null || info.strike === undefined) ? null : Number(info.strike);
                const oldStrike = slowIvStrike;
                if (newStrike !== null && Number.isFinite(newStrike)) slowIvStrike = newStrike;
                if (newSymbol && newSymbol !== slowIvSymbol) {
                    appendIvLog(`[Slow] ATM strike moved: ${oldStrike === null || oldStrike === undefined ? "--" : oldStrike} -> ${newStrike === null ? "--" : newStrike} (${newSymbol})`);
                    ivChartStrikeMarks.push({
                        t: Date.now(),
                        arm: "slow",
                        oldStrike: oldStrike,
                        newStrike: newStrike,
                        label: `${oldStrike === null || oldStrike === undefined ? "?" : oldStrike}->${newStrike === null ? "?" : newStrike}`
                    });
                    if (ivChartStrikeMarks.length > 200) ivChartStrikeMarks.shift();
                    slowIvSymbol = newSymbol;
                    const iv = (info.iv === null || info.iv === undefined) ? null : Number(info.iv);
                    if (iv !== null && Number.isFinite(iv)) latestSlowIv = iv;
                    changed = true;
                }
            }
            async function refreshFast() {
                if (!fastIvExpiryType) return;
                const resolvedDate = resolveExpiryDateByMode(fastIvExpiryType);
                const resolvedLabel = formatDateInputValue(resolvedDate);
                if (resolvedLabel && resolvedLabel !== fastIvExpiryDate) {
                    appendIvLog(`[Fast] Expiry rolled over: ${fastIvExpiryDate || "--"} -> ${resolvedLabel}`);
                    fastIvExpiryDate = resolvedLabel;
                    const input = document.getElementById(`${prefix}FastIvExpiry`);
                    if (input instanceof HTMLInputElement) input.value = resolvedLabel;
                    fastIvNextRefreshAt = 0;
                }
                if (now < fastIvNextRefreshAt) return;
                fastIvNextRefreshAt = now + (IV_ATM_REFRESH_MS[fastIvExpiryType] || 60000);
                let info = null;
                try {
                    info = await fetchAtmSymbol(fastIvExpiryDate, side);
                } catch (error) {
                    appendIvLog(`[Fast] ATM refresh failed: ${error instanceof Error ? error.message : String(error)}`);
                    return;
                }
                if (!info) return;
                const newSymbol = String(info.optionSymbol || "").trim();
                const newStrike = (info.strike === null || info.strike === undefined) ? null : Number(info.strike);
                const oldStrike = fastIvStrike;
                if (newStrike !== null && Number.isFinite(newStrike)) fastIvStrike = newStrike;
                if (newSymbol && newSymbol !== fastIvSymbol) {
                    appendIvLog(`[Fast] ATM strike moved: ${oldStrike === null || oldStrike === undefined ? "--" : oldStrike} -> ${newStrike === null ? "--" : newStrike} (${newSymbol})`);
                    ivChartStrikeMarks.push({
                        t: Date.now(),
                        arm: "fast",
                        oldStrike: oldStrike,
                        newStrike: newStrike,
                        label: `${oldStrike === null || oldStrike === undefined ? "?" : oldStrike}->${newStrike === null ? "?" : newStrike}`
                    });
                    if (ivChartStrikeMarks.length > 200) ivChartStrikeMarks.shift();
                    fastIvSymbol = newSymbol;
                    const iv = (info.iv === null || info.iv === undefined) ? null : Number(info.iv);
                    if (iv !== null && Number.isFinite(iv)) latestFastIv = iv;
                    changed = true;
                }
            }

            await refreshSlow();
            await refreshFast();

            if (changed) {
                resubscribeIvSocket([slowIvSymbol, fastIvSymbol]);
                pushIvChartPoint();
            }
        } catch (error) {
            appendIvLog(`ATM refresh error: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            ivAtmRefreshInProgress = false;
        }
    }



    async function startIvTracking() {
        if (ivRunning) return;
        const slowInput = document.getElementById(`${prefix}SlowIvExpiry`);
        const fastInput = document.getElementById(`${prefix}FastIvExpiry`);
        const slowDate = slowInput instanceof HTMLInputElement ? slowInput.value : "";
        const fastDate = fastInput instanceof HTMLInputElement ? fastInput.value : "";
        if (!slowDate || !fastDate) {
            appendIvLog("Please select both Slow and Fast IV dates.");
            return;
        }
        ivRunning = true;
        setControlsEnabled(false);
        slowIvExpiryType = String(document.getElementById(`${prefix}SlowIvExpiryType`)?.value || "").trim();
        fastIvExpiryType = String(document.getElementById(`${prefix}FastIvExpiryType`)?.value || "").trim();
        slowIvExpiryDate = slowDate;
        fastIvExpiryDate = fastDate;
        const startBtn = document.getElementById(`${prefix}IvStart`);
        const stopBtn = document.getElementById(`${prefix}IvStop`);
        if (startBtn) startBtn.disabled = true;
        if (stopBtn) stopBtn.disabled = false;
        latestSlowIv = null;
        latestFastIv = null;
        ivLastLoggedSignature = "";
        ivLastLoggedAt = 0;
        slowIvSymbol = "";
        fastIvSymbol = "";
        appendIvLog(`Starting IV tracking (slow: ${slowDate}, fast: ${fastDate})...`);
        try {
            const [slowInfo, fastInfo] = await Promise.all([
                fetchAtmSymbol(slowDate, side),
                fetchAtmSymbol(fastDate, side)
            ]);
            slowIvSymbol = String(slowInfo.optionSymbol || "").trim();
            fastIvSymbol = String(fastInfo.optionSymbol || "").trim();
            latestSlowIv = (slowInfo.iv === null || slowInfo.iv === undefined) ? null : Number(slowInfo.iv);
            latestFastIv = (fastInfo.iv === null || fastInfo.iv === undefined) ? null : Number(fastInfo.iv);
            slowIvStrike = (slowInfo.strike === null || slowInfo.strike === undefined) ? null : Number(slowInfo.strike);
            fastIvStrike = (fastInfo.strike === null || fastInfo.strike === undefined) ? null : Number(fastInfo.strike);
            slowIvNextRefreshAt = Date.now() + (IV_ATM_REFRESH_MS[slowIvExpiryType] || 60000);
            fastIvNextRefreshAt = Date.now() + (IV_ATM_REFRESH_MS[fastIvExpiryType] || 60000);
            appendIvLog(`Slow ATM strike ${slowInfo.strike || "--"} symbol ${slowIvSymbol || "--"} IV ${latestSlowIv === null ? "--" : latestSlowIv}`);
            appendIvLog(`Fast ATM strike ${fastInfo.strike || "--"} symbol ${fastIvSymbol || "--"} IV ${latestFastIv === null ? "--" : latestFastIv}`);
            pushIvChartPoint();
            connectIvSocket([slowIvSymbol, fastIvSymbol]);
            if (ivAtmRefreshTimer) { clearInterval(ivAtmRefreshTimer); ivAtmRefreshTimer = null; }
            ivAtmRefreshTimer = setInterval(function () {
                if (ivRunning) {
                    refreshAtmTargets().catch(function (error) {
                        appendIvLog(`ATM refresh error: ${error instanceof Error ? error.message : String(error)}`);
                    });
                }
            }, 1000);
        } catch (error) {
            appendIvLog(`Start failed: ${error instanceof Error ? error.message : String(error)}`);
            stopIvTracking();
        }
    }

    function stopIvTracking() {
        disconnectIvSocket();
        ivRunning = false;
        setControlsEnabled(true);
        const startBtn = document.getElementById(`${prefix}IvStart`);
        const stopBtn = document.getElementById(`${prefix}IvStop`);
        if (startBtn) startBtn.disabled = false;
        if (stopBtn) stopBtn.disabled = true;
        appendIvLog("Stopped IV tracking.");
    }

    async function resetIvTracking() {
        const resetBtn = document.getElementById(`${prefix}IvReset`);
        if (resetBtn) resetBtn.disabled = true;
        const logEl = getIvLog();
        if (logEl) logEl.innerHTML = "";
        const dirLogEl = getDirectionLog();
        if (dirLogEl) dirLogEl.innerHTML = "";
        ivChartPoints = [];
        ivChartStrikeMarks = [];
        prevIvState = null;
        hasPrevIvState = false;
        drawIvChart();
        ivLastLoggedSignature = "";
        ivLastLoggedAt = 0;
        try {
            if (ivRunning) {
                stopIvTracking();
            }
            await startIvTracking();
        } finally {
            if (resetBtn) resetBtn.disabled = false;
        }
    }

    function getSelectedExpiryLabel(selectId) {
        const select = document.getElementById(selectId);
        if (!(select instanceof HTMLSelectElement)) return "";
        const option = select.options[select.selectedIndex];
        return option ? String(option.textContent || "").trim() : "";
    }
    function updateIvChartLabels() {
        slowIvExpiryLabel = getSelectedExpiryLabel(`${prefix}SlowIvExpiryType`) || slowIvExpiryLabel;
        fastIvExpiryLabel = getSelectedExpiryLabel(`${prefix}FastIvExpiryType`) || fastIvExpiryLabel;
        const titleEl = document.getElementById(`${prefix}IvChartTitle`);
        if (titleEl) {
            titleEl.textContent = `BTCUSD Term Structure Shift: ${fastIvExpiryLabel} vs. ${slowIvExpiryLabel} IV`;
        }
        drawIvChart();
    }
    function init() {
        controlPairs.forEach(function (pair) {
            const select = document.getElementById(pair.selectId);
            const input = document.getElementById(pair.inputId);
            if (select instanceof HTMLSelectElement) {
                select.addEventListener("change", function () {
                    applyExpiryMode(pair, true);
                });
            }
            if (input instanceof HTMLInputElement) {
                input.addEventListener("change", function () {
                    // Keep user-selected date; no profile save on this page.
                });
            }
            applyExpiryMode(pair, false);
        });

        const startBtn = document.getElementById(`${prefix}IvStart`);
        const stopBtn = document.getElementById(`${prefix}IvStop`);
        if (startBtn) startBtn.addEventListener("click", startIvTracking);
        if (stopBtn) stopBtn.addEventListener("click", stopIvTracking);
        const resetBtn = document.getElementById(`${prefix}IvReset`);
        if (resetBtn) resetBtn.addEventListener("click", resetIvTracking);
        slowIvExpiryLabel = getSelectedExpiryLabel(`${prefix}SlowIvExpiryType`) || slowIvExpiryLabel;
        fastIvExpiryLabel = getSelectedExpiryLabel(`${prefix}FastIvExpiryType`) || fastIvExpiryLabel;
        const slowSelect = document.getElementById(`${prefix}SlowIvExpiryType`);
        const fastSelect = document.getElementById(`${prefix}FastIvExpiryType`);
        if (slowSelect) slowSelect.addEventListener("change", updateIvChartLabels);
        if (fastSelect) fastSelect.addEventListener("change", updateIvChartLabels);
        const titleEl = document.getElementById(`${prefix}IvChartTitle`);
        if (titleEl) titleEl.textContent = `BTCUSD ${side === "put" ? "Put" : "Call"} Mark IV Term Structure Shift: ${fastIvExpiryLabel} vs. ${slowIvExpiryLabel} IV`;
        initIvChart();
        window.addEventListener("resize", initIvChart);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
    }

    createIvTracker("manageTrades", "call");
    createIvTracker("manageTradesPut", "put");
})();
