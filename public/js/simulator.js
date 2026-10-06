(function () {
    "use strict";

    // Strategy Simulator — read-only backtester over Delta Exchange historical
    // data. Loads candles through /api/simulator, draws them, then marks each
    // strategy leg through the window to produce a combined P&L curve.

    const bodyEl = document.body;
    const endpointBase = String(bodyEl && bodyEl.dataset ? bodyEl.dataset.simulatorEndpointBase : "").replace(/\/+$/, "") || "/api/simulator";
    const maxCandles = Number(bodyEl && bodyEl.dataset ? bodyEl.dataset.simulatorMaxCandles : 0) || 16000;

    const resolutionSeconds = {
        "1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1800,
        "1h": 3600, "2h": 7200, "4h": 14400, "6h": 21600, "1d": 86400, "1w": 604800
    };

    function byId(pId) {
        return document.getElementById(pId);
    }

    const els = {
        underlying: byId("simUnderlying"),
        instrument: byId("simInstrument"),
        expiryField: byId("simExpiryField"),
        expiry: byId("simExpiry"),
        expiryPrev: byId("simExpiryPrev"),
        expiryNext: byId("simExpiryNext"),
        symbol: byId("simSymbol"),
        resolution: byId("simResolution"),
        from: byId("simFrom"),
        to: byId("simTo"),
        loadBtn: byId("btnLoadHistory"),
        rangeHint: byId("simRangeHint"),
        dataStatus: byId("simDataStatus"),
        chartStats: byId("simChartStats"),
        priceChart: byId("simPriceChart"),
        chartEmpty: byId("simChartEmpty"),
        addFuturesLeg: byId("btnAddFuturesLeg"),
        addOptionLeg: byId("btnAddOptionLeg"),
        runBacktest: byId("btnRunBacktest"),
        legsBody: byId("simLegsBody"),
        legsStatus: byId("simLegsStatus"),
        resultStatus: byId("simResultStatus"),
        resultsBody: byId("simResultsBody"),
        pnlChart: byId("simPnlChart"),
        pnlEmpty: byId("simPnlEmpty"),
        tileNet: byId("simTileNet"),
        tileReturn: byId("simTileReturn"),
        tileRange: byId("simTileRange"),
        tileCandles: byId("simTileCandles")
    };

    const state = {
        instrument: "futures",
        underlying: "BTC",
        futuresRows: [],
        optionRows: [],
        baseCandles: [],
        legs: [],
        legCounter: 0
    };

    function setStatus(pEl, pMessage, pKind) {
        if (!pEl) {
            return;
        }
        const strKind = pKind === "success" ? "success" : (pKind === "error" ? "error" : (pKind === "warning" ? "warning" : ""));
        pEl.className = "sim-status" + (strKind ? ` ${strKind}` : "");
        pEl.textContent = String(pMessage || "").trim();
    }

    async function apiGet(pPath, pParams) {
        const objUrl = new URL(endpointBase + pPath, window.location.origin);
        Object.entries(pParams || {}).forEach(([strKey, strValue]) => {
            if (strValue !== undefined && strValue !== null && String(strValue) !== "") {
                objUrl.searchParams.set(strKey, String(strValue));
            }
        });
        const objRes = await fetch(objUrl, { headers: { Accept: "application/json" } });
        let objBody = null;
        try {
            objBody = await objRes.json();
        }
        catch (objErr) {
            objBody = null;
        }
        if (!objRes.ok) {
            throw new Error((objBody && objBody.message) || `Request failed (HTTP ${objRes.status}).`);
        }
        return objBody;
    }

    function pad2(pValue) {
        return String(pValue).padStart(2, "0");
    }

    function toLocalInputValue(pDate) {
        return `${pDate.getFullYear()}-${pad2(pDate.getMonth() + 1)}-${pad2(pDate.getDate())}T${pad2(pDate.getHours())}:${pad2(pDate.getMinutes())}`;
    }

    function toLocalDateValue(pDate) {
        return `${pDate.getFullYear()}-${pad2(pDate.getMonth() + 1)}-${pad2(pDate.getDate())}`;
    }

    function localInputToUnix(pValue) {
        const vMs = Date.parse(String(pValue || ""));
        return Number.isFinite(vMs) ? Math.floor(vMs / 1000) : null;
    }

    function formatUtc(pSeconds, pWithTime) {
        if (!Number.isFinite(Number(pSeconds))) {
            return "—";
        }
        const objDate = new Date(Number(pSeconds) * 1000);
        const strDate = `${pad2(objDate.getUTCDate())} ${objDate.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${objDate.getUTCFullYear()}`;
        if (!pWithTime) {
            return strDate;
        }
        return `${strDate} ${pad2(objDate.getUTCHours())}:${pad2(objDate.getUTCMinutes())}`;
    }

    function formatPrice(pValue) {
        if (!Number.isFinite(Number(pValue))) {
            return "—";
        }
        const vAbs = Math.abs(Number(pValue));
        const vDigits = vAbs >= 1000 ? 1 : (vAbs >= 1 ? 3 : 5);
        return Number(pValue).toLocaleString("en-US", { maximumFractionDigits: vDigits, minimumFractionDigits: 0 });
    }

    function formatMoney(pValue) {
        if (!Number.isFinite(Number(pValue))) {
            return "—";
        }
        return Number(pValue).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
    }

    function fillSymbolSelect(pRows) {
        const arrRows = Array.isArray(pRows) ? pRows : [];
        els.symbol.innerHTML = "";
        if (arrRows.length === 0) {
            const objOption = document.createElement("option");
            objOption.value = "";
            objOption.textContent = "No symbols found";
            els.symbol.appendChild(objOption);
            return;
        }
        arrRows.forEach((objRow) => {
            const objOption = document.createElement("option");
            objOption.value = objRow.value;
            objOption.textContent = objRow.label;
            els.symbol.appendChild(objOption);
        });
    }

    function preferredFuturesSymbol() {
        const strPreferred = `${state.underlying}USD`;
        const objHit = state.futuresRows.find((objRow) => objRow.symbol === strPreferred);
        if (objHit) {
            return objHit.symbol;
        }
        return state.futuresRows.length ? state.futuresRows[0].symbol : "";
    }

    async function loadSymbolOptions() {
        state.instrument = els.instrument.value === "options" ? "options" : "futures";
        state.underlying = String(els.underlying.value || "BTC").trim().toUpperCase();
        els.expiryField.hidden = state.instrument !== "options";
        fillSymbolSelect([]);
        setStatus(els.dataStatus, "Loading symbols from Delta Exchange…", "");
        try {
            if (state.instrument === "futures") {
                const objBody = await apiGet("/futures", { underlying: state.underlying });
                state.futuresRows = (objBody && objBody.data && Array.isArray(objBody.data.rows)) ? objBody.data.rows : [];
                fillSymbolSelect(state.futuresRows.map((objRow) => ({
                    value: objRow.symbol,
                    label: `${objRow.symbol} · ${objRow.contractType}`
                })));
                if (state.futuresRows.length) {
                    els.symbol.value = preferredFuturesSymbol();
                }
                setStatus(els.dataStatus, objBody ? objBody.message : "No response.", objBody ? objBody.status : "warning");
            }
            else {
                const objBody = await apiGet("/chain", { underlying: state.underlying, expiry: els.expiry.value });
                state.optionRows = (objBody && objBody.data && Array.isArray(objBody.data.rows)) ? objBody.data.rows : [];
                fillSymbolSelect(state.optionRows.map((objRow) => ({
                    value: objRow.symbol,
                    label: `${(objRow.contractType || "").toUpperCase()} ${objRow.strikePrice !== null ? objRow.strikePrice : ""} · ${objRow.symbol}`
                })));
                setStatus(els.dataStatus, objBody ? objBody.message : "No response.", objBody ? objBody.status : "warning");
            }
        }
        catch (objError) {
            state.futuresRows = [];
            state.optionRows = [];
            fillSymbolSelect([]);
            setStatus(els.dataStatus, objError && objError.message ? objError.message : "Unable to load symbols.", "error");
        }
    }

    function shiftExpiry(pDays) {
        const vBase = Date.parse(`${els.expiry.value}T00:00:00Z`);
        if (!Number.isFinite(vBase)) {
            return;
        }
        const objNext = new Date(vBase + pDays * 86400000);
        els.expiry.value = objNext.toISOString().slice(0, 10);
        void loadSymbolOptions();
    }

    function updateRangeHint() {
        const vResolution = els.resolution.value;
        const vSeconds = resolutionSeconds[vResolution] || 3600;
        const vStart = localInputToUnix(els.from.value);
        const vEnd = localInputToUnix(els.to.value);
        const vMaxSpanDays = Math.floor((maxCandles * vSeconds) / 86400);
        let vHint = `Up to ${maxCandles.toLocaleString("en-US")} ${vResolution} candles fit in one load (~${vMaxSpanDays.toLocaleString("en-US")} day span).`;
        if (vStart !== null && vEnd !== null && vEnd > vStart) {
            const vExpected = Math.floor((vEnd - vStart) / vSeconds) + 1;
            vHint += ` Current window: ~${vExpected.toLocaleString("en-US")} candles.`;
            if (vExpected > maxCandles) {
                vHint += " That exceeds the ceiling - shorten the range or use a coarser timeframe.";
            }
        }
        else {
            vHint += " Set a valid From/To range.";
        }
        els.rangeHint.textContent = vHint;
    }

    async function loadHistory() {
        const vSymbol = String(els.symbol.value || "").trim();
        if (!vSymbol) {
            setStatus(els.dataStatus, "Choose a symbol before loading history.", "warning");
            return;
        }
        const vStart = localInputToUnix(els.from.value);
        const vEnd = localInputToUnix(els.to.value);
        if (vStart === null || vEnd === null || vEnd <= vStart) {
            setStatus(els.dataStatus, "Pick a valid From/To range (end must be after start).", "warning");
            return;
        }
        els.loadBtn.disabled = true;
        setStatus(els.dataStatus, "Loading candles from Delta Exchange…", "");
        try {
            const objBody = await apiGet("/candles", {
                symbol: vSymbol,
                resolution: els.resolution.value,
                start: vStart,
                end: vEnd
            });
            setStatus(els.dataStatus, objBody ? objBody.message : "No response.", objBody ? objBody.status : "warning");
            state.baseCandles = (objBody && objBody.data && Array.isArray(objBody.data.candles)) ? objBody.data.candles : [];
            renderChartStats();
            drawPriceChart();
        }
        catch (objError) {
            state.baseCandles = [];
            renderChartStats();
            drawPriceChart();
            setStatus(els.dataStatus, objError && objError.message ? objError.message : "Unable to load candles.", "error");
        }
        finally {
            els.loadBtn.disabled = false;
        }
    }

    function renderChartStats() {
        const arrCandles = state.baseCandles;
        if (!arrCandles.length) {
            els.chartStats.innerHTML = "";
            return;
        }
        let vHigh = Number.NEGATIVE_INFINITY;
        let vLow = Number.POSITIVE_INFINITY;
        let vVolume = 0;
        arrCandles.forEach((objRow) => {
            vHigh = Math.max(vHigh, Number(objRow.high));
            vLow = Math.min(vLow, Number(objRow.low));
            vVolume += Number(objRow.volume) || 0;
        });
        const vFirst = arrCandles[0];
        const vLast = arrCandles[arrCandles.length - 1];
        els.chartStats.innerHTML = "";
        const arrStats = [
            ["Candles", arrCandles.length.toLocaleString("en-US")],
            ["Window", `${formatUtc(vFirst.time, true)} -> ${formatUtc(vLast.time, true)} UTC`],
            ["High", formatPrice(vHigh)],
            ["Low", formatPrice(vLow)],
            ["Volume", formatPrice(vVolume)]
        ];
        arrStats.forEach(([strLabel, strValue]) => {
            const objSpan = document.createElement("span");
            objSpan.innerHTML = `${strLabel}: <strong></strong>`;
            objSpan.querySelector("strong").textContent = strValue;
            els.chartStats.appendChild(objSpan);
        });
    }

    function prepareCanvas(pCanvas, pCssHeight) {
        const objWrap = pCanvas.parentElement;
        const vDpr = window.devicePixelRatio || 1;
        const vCssWidth = Math.max(320, objWrap.clientWidth || 640);
        pCanvas.width = Math.floor(vCssWidth * vDpr);
        pCanvas.height = Math.floor(pCssHeight * vDpr);
        pCanvas.style.width = `${vCssWidth}px`;
        pCanvas.style.height = `${pCssHeight}px`;
        const objCtx = pCanvas.getContext("2d");
        objCtx.setTransform(vDpr, 0, 0, vDpr, 0, 0);
        objCtx.clearRect(0, 0, vCssWidth, pCssHeight);
        return { ctx: objCtx, width: vCssWidth, height: pCssHeight };
    }

    function drawAxisLabel(pCtx, pText, pX, pY, pAlign) {
        pCtx.fillStyle = "rgba(167,178,212,.85)";
        pCtx.font = "11px 'Segoe UI', sans-serif";
        pCtx.textAlign = pAlign || "left";
        pCtx.textBaseline = "middle";
        pCtx.fillText(pText, pX, pY);
    }

    function formatAxisTime(pSeconds, pResolution) {
        const objDate = new Date(Number(pSeconds) * 1000);
        const strDay = `${pad2(objDate.getUTCDate())} ${objDate.toLocaleString("en-US", { month: "short", timeZone: "UTC" })}`;
        if (pResolution === "1d" || pResolution === "1w") {
            return `${strDay} ${objDate.getUTCFullYear()}`;
        }
        return `${strDay} ${pad2(objDate.getUTCHours())}:${pad2(objDate.getUTCMinutes())}`;
    }

    function drawPriceChart() {
        const arrCandles = state.baseCandles;
        if (!arrCandles.length) {
            els.priceChart.parentElement.style.display = "none";
            els.chartEmpty.hidden = false;
            return;
        }
        els.priceChart.parentElement.style.display = "";
        els.chartEmpty.hidden = true;
        const objCanvas = prepareCanvas(els.priceChart, 360);
        const objCtx = objCanvas.ctx;
        const vPadLeft = 70;
        const vPadRight = 16;
        const vPadTop = 14;
        const vPadBottom = 30;
        const vVolumeHeight = 44;
        const vPlotWidth = objCanvas.width - vPadLeft - vPadRight;
        const vPlotHeight = objCanvas.height - vPadTop - vPadBottom - vVolumeHeight;
        let vHigh = Number.NEGATIVE_INFINITY;
        let vLow = Number.POSITIVE_INFINITY;
        let vMaxVolume = 0;
        arrCandles.forEach((objRow) => {
            vHigh = Math.max(vHigh, Number(objRow.high));
            vLow = Math.min(vLow, Number(objRow.low));
            vMaxVolume = Math.max(vMaxVolume, Number(objRow.volume) || 0);
        });
        if (!Number.isFinite(vHigh) || !Number.isFinite(vLow) || vHigh === vLow) {
            vHigh = (Number.isFinite(vHigh) ? vHigh : 1) + 1;
            vLow = Math.max(0, (Number.isFinite(vLow) ? vLow : 1) - 1);
        }
        const vPadding = (vHigh - vLow) * 0.05 || 1;
        const vMax = vHigh + vPadding;
        const vMin = vLow - vPadding;
        const yFor = (pPrice) => vPadTop + ((vMax - pPrice) / (vMax - vMin)) * vPlotHeight;
        const vSlot = vPlotWidth / arrCandles.length;
        const vBodyWidth = Math.max(1, Math.min(14, vSlot * 0.62));
        for (let vStep = 0; vStep <= 4; vStep += 1) {
            const vPrice = vMin + ((vMax - vMin) * vStep) / 4;
            const vY = yFor(vPrice);
            objCtx.strokeStyle = "rgba(162,180,228,.12)";
            objCtx.lineWidth = 1;
            objCtx.beginPath();
            objCtx.moveTo(vPadLeft, vY);
            objCtx.lineTo(objCanvas.width - vPadRight, vY);
            objCtx.stroke();
            drawAxisLabel(objCtx, formatPrice(vPrice), vPadLeft - 8, vY, "right");
        }
        arrCandles.forEach((objRow, pIndex) => {
            const vX = vPadLeft + pIndex * vSlot + vSlot / 2;
            const vOpen = Number(objRow.open);
            const vClose = Number(objRow.close);
            const vIsUp = vClose >= vOpen;
            objCtx.strokeStyle = vIsUp ? "#86efac" : "#ffb5b5";
            objCtx.fillStyle = vIsUp ? "rgba(134,239,172,.9)" : "rgba(255,181,181,.9)";
            objCtx.beginPath();
            objCtx.moveTo(vX, yFor(Number(objRow.high)));
            objCtx.lineTo(vX, yFor(Number(objRow.low)));
            objCtx.stroke();
            const vBodyTop = yFor(Math.max(vOpen, vClose));
            const vBodyBottom = yFor(Math.min(vOpen, vClose));
            objCtx.fillRect(vX - vBodyWidth / 2, vBodyTop, vBodyWidth, Math.max(1, vBodyBottom - vBodyTop));
        });
        const vVolumeTop = vPadTop + vPlotHeight + 10;
        arrCandles.forEach((objRow, pIndex) => {
            const vX = vPadLeft + pIndex * vSlot + vSlot / 2;
            const vValue = Number(objRow.volume) || 0;
            const vBarHeight = vMaxVolume > 0 ? (vValue / vMaxVolume) * (vVolumeHeight - 8) : 0;
            const vIsUp = Number(objRow.close) >= Number(objRow.open);
            objCtx.fillStyle = vIsUp ? "rgba(134,239,172,.35)" : "rgba(255,181,181,.35)";
            objCtx.fillRect(vX - vBodyWidth / 2, vVolumeTop + (vVolumeHeight - 8 - vBarHeight), vBodyWidth, Math.max(1, vBarHeight));
        });
        drawAxisLabel(objCtx, "vol", vPadLeft - 8, vVolumeTop + vVolumeHeight / 2, "right");
        const vTickCount = Math.min(6, arrCandles.length);
        for (let vTick = 0; vTick < vTickCount; vTick += 1) {
            const vIndex = Math.round((vTick * (arrCandles.length - 1)) / Math.max(1, vTickCount - 1));
            const vX = vPadLeft + vIndex * vSlot + vSlot / 2;
            drawAxisLabel(objCtx, formatAxisTime(arrCandles[vIndex].time, els.resolution.value), vX, objCanvas.height - 14, "center");
        }
    }

    function escapeHtml(pValue) {
        return String(pValue).replace(/[&<>"']/g, (strChar) => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
        })[strChar]);
    }

    function symbolRowsForKind(pKind) {
        return pKind === "futures" ? state.futuresRows : state.optionRows;
    }

    function addLeg(pKind) {
        const arrRows = symbolRowsForKind(pKind);
        if (!arrRows.length) {
            setStatus(
                els.legsStatus,
                pKind === "futures"
                    ? "No futures symbols loaded yet — check the Underlying selection."
                    : "No option contracts loaded yet — switch Market to Options and pick an expiry date.",
                "warning"
            );
            return;
        }
        state.legCounter += 1;
        state.legs.push({
            id: state.legCounter,
            kind: pKind,
            symbol: pKind === "futures" ? preferredFuturesSymbol() : arrRows[0].symbol,
            side: "buy",
            qty: 1,
            multiplier: 1,
            entryOverride: ""
        });
        renderLegs();
        setStatus(els.legsStatus, `${state.legs.length} leg${state.legs.length === 1 ? "" : "s"} in the strategy.`, "success");
    }

    function removeLeg(pId) {
        state.legs = state.legs.filter((objLeg) => objLeg.id !== pId);
        renderLegs();
        setStatus(els.legsStatus, state.legs.length ? `${state.legs.length} leg(s) in the strategy.` : "All legs removed.", state.legs.length ? "success" : "");
    }

    function renderLegs() {
        els.legsBody.innerHTML = "";
        if (!state.legs.length) {
            els.legsBody.innerHTML = '<tr class="sim-empty-row"><td colspan="7">No legs yet. Add a futures or option leg to build the strategy.</td></tr>';
            return;
        }
        state.legs.forEach((objLeg, pIndex) => {
            const arrRows = symbolRowsForKind(objLeg.kind);
            const strOptions = arrRows.map((objRow) =>
                `<option value="${escapeHtml(objRow.symbol)}" ${objRow.symbol === objLeg.symbol ? "selected" : ""}>${escapeHtml(objRow.symbol)}</option>`
            ).join("");
            const objTr = document.createElement("tr");
            objTr.innerHTML = `
                <td>${pIndex + 1}</td>
                <td><select data-id="${objLeg.id}" data-field="symbol">${strOptions}</select></td>
                <td>
                    <select data-id="${objLeg.id}" data-field="side">
                        <option value="buy" ${objLeg.side === "buy" ? "selected" : ""}>Buy (long)</option>
                        <option value="sell" ${objLeg.side === "sell" ? "selected" : ""}>Sell (short)</option>
                    </select>
                </td>
                <td><input type="number" min="1" step="1" data-id="${objLeg.id}" data-field="qty" value="${escapeHtml(objLeg.qty)}" /></td>
                <td><input type="number" min="0" step="any" data-id="${objLeg.id}" data-field="multiplier" value="${escapeHtml(objLeg.multiplier)}" /></td>
                <td><input type="number" step="any" placeholder="first open" data-id="${objLeg.id}" data-field="entryOverride" value="${escapeHtml(objLeg.entryOverride)}" /></td>
                <td><button class="sim-remove-btn" type="button" data-remove-id="${objLeg.id}">Remove</button></td>`;
            els.legsBody.appendChild(objTr);
        });
    }

    function onLegFieldChange(pEvent) {
        const objTarget = pEvent.target;
        const vId = Number(objTarget && objTarget.dataset ? objTarget.dataset.id : 0);
        const strField = objTarget && objTarget.dataset ? objTarget.dataset.field : "";
        if (!vId || !strField) {
            return;
        }
        const objLeg = state.legs.find((objRow) => objRow.id === vId);
        if (!objLeg) {
            return;
        }
        if (strField === "qty" || strField === "multiplier") {
            const vValue = Number(objTarget.value);
            objLeg[strField] = Number.isFinite(vValue) && vValue > 0 ? vValue : 1;
        }
        else if (strField === "entryOverride") {
            objLeg.entryOverride = String(objTarget.value || "").trim();
        }
        else {
            objLeg[strField] = String(objTarget.value || "");
        }
    }

    function onLegClick(pEvent) {
        const objButton = pEvent.target.closest("[data-remove-id]");
        if (!objButton) {
            return;
        }
        removeLeg(Number(objButton.getAttribute("data-remove-id")));
    }

    function resetResults() {
        els.tileNet.textContent = "—";
        els.tileNet.className = "";
        els.tileReturn.textContent = "—";
        els.tileReturn.className = "";
        els.tileRange.textContent = "—";
        els.tileRange.className = "";
        els.tileCandles.textContent = "—";
        els.resultsBody.innerHTML = '<tr class="sim-empty-row"><td colspan="9">Run the backtest to see per-leg results.</td></tr>';
        state.lastCurve = [];
        els.pnlChart.parentElement.style.display = "none";
        els.pnlEmpty.hidden = false;
    }

    function renderResultRows(pLegResults) {
        els.resultsBody.innerHTML = "";
        pLegResults.forEach((objResult, pIndex) => {
            const objTr = document.createElement("tr");
            const strPnlClass = objResult.pnl >= 0 ? "sim-pnl-good" : "sim-pnl-bad";
            objTr.innerHTML = `
                <td>${pIndex + 1}</td>
                <td>${escapeHtml(objResult.leg.symbol)}</td>
                <td>${objResult.leg.side === "sell" ? "Sell" : "Buy"}</td>
                <td>${objResult.qty} × ${objResult.mult}</td>
                <td>${formatPrice(objResult.entryPrice)}</td>
                <td>${formatUtc(objResult.entryTime, true)}</td>
                <td>${formatPrice(objResult.exitPrice)}</td>
                <td>${formatUtc(objResult.exitTime, true)}</td>
                <td class="${strPnlClass}">${formatMoney(objResult.pnl)}</td>`;
            els.resultsBody.appendChild(objTr);
        });
    }

    async function runBacktest() {
        if (!state.legs.length) {
            setStatus(els.resultStatus, "Add at least one strategy leg first.", "warning");
            return;
        }
        const vStart = localInputToUnix(els.from.value);
        const vEnd = localInputToUnix(els.to.value);
        if (vStart === null || vEnd === null || vEnd <= vStart) {
            setStatus(els.resultStatus, "Pick a valid From/To range before running the backtest.", "warning");
            return;
        }
        const vResolution = els.resolution.value;
        els.runBacktest.disabled = true;
        setStatus(els.resultStatus, "Fetching candle history for every leg…", "");
        try {
            const arrSeries = await Promise.all(state.legs.map(async (objLeg) => {
                const objBody = await apiGet("/candles", {
                    symbol: objLeg.symbol,
                    resolution: vResolution,
                    start: vStart,
                    end: vEnd
                });
                const arrCandles = (objBody && objBody.data && Array.isArray(objBody.data.candles)) ? objBody.data.candles : [];
                return { leg: objLeg, candles: arrCandles };
            }));
            const arrValid = arrSeries.filter((objSeries) => objSeries.candles.length > 0);
            if (!arrValid.length) {
                resetResults();
                setStatus(els.resultStatus, "None of the leg symbols returned candles for this window — check symbols and dates.", "warning");
                return;
            }

            const arrLegResults = arrValid.map((objSeries) => {
                const arrCandles = objSeries.candles;
                const objFirst = arrCandles[0];
                const objLast = arrCandles[arrCandles.length - 1];
                const vOverride = Number(objSeries.leg.entryOverride);
                const vEntryPrice = Number.isFinite(vOverride) && vOverride > 0 ? vOverride : Number(objFirst.open);
                const vSign = objSeries.leg.side === "sell" ? -1 : 1;
                const vQty = Math.max(1, Number(objSeries.leg.qty) || 1);
                const vMult = Number(objSeries.leg.multiplier) || 1;
                const vExitPrice = Number(objLast.close);
                return {
                    leg: objSeries.leg,
                    candles: arrCandles,
                    entryPrice: vEntryPrice,
                    entryTime: Number(objFirst.time),
                    exitPrice: vExitPrice,
                    exitTime: Number(objLast.time),
                    sign: vSign,
                    qty: vQty,
                    mult: vMult,
                    pnl: vSign * vQty * vMult * (vExitPrice - vEntryPrice),
                    notional: Math.abs(vEntryPrice * vQty * vMult)
                };
            });

            const objTimeSet = new Set();
            arrLegResults.forEach((objResult) => {
                objResult.candles.forEach((objRow) => objTimeSet.add(Number(objRow.time)));
            });
            const arrTimes = [...objTimeSet].sort((a, b) => a - b);
            const arrPointers = arrLegResults.map(() => ({ index: 0, price: null }));
            const arrCurve = [];
            for (const vTime of arrTimes) {
                let vTotal = 0;
                arrLegResults.forEach((objResult, pIdx) => {
                    const objPointer = arrPointers[pIdx];
                    while (objPointer.index < objResult.candles.length && Number(objResult.candles[objPointer.index].time) <= vTime) {
                        objPointer.price = Number(objResult.candles[objPointer.index].close);
                        objPointer.index += 1;
                    }
                    if (objPointer.price === null || vTime < objResult.entryTime) {
                        return;
                    }
                    vTotal += objResult.sign * objResult.qty * objResult.mult * (objPointer.price - objResult.entryPrice);
                });
                arrCurve.push({ time: vTime, value: vTotal });
            }

            const vNet = arrLegResults.reduce((vSum, objResult) => vSum + objResult.pnl, 0);
            const vNotional = arrLegResults.reduce((vSum, objResult) => vSum + objResult.notional, 0);
            const arrCurveValues = arrCurve.map((p) => p.value);
            const vBest = arrCurveValues.length ? Math.max(...arrCurveValues) : vNet;
            const vWorst = arrCurveValues.length ? Math.min(...arrCurveValues) : vNet;
            const vCandleCount = arrLegResults.reduce((vSum, objResult) => vSum + objResult.candles.length, 0);

            renderResultRows(arrLegResults);
            els.tileNet.textContent = formatMoney(vNet);
            els.tileNet.className = vNet >= 0 ? "sim-pnl-good" : "sim-pnl-bad";
            const vReturn = vNotional > 0 ? (vNet / vNotional) * 100 : 0;
            els.tileReturn.textContent = vNotional > 0 ? `${vReturn >= 0 ? "+" : ""}${vReturn.toFixed(2)}%` : "—";
            els.tileReturn.className = vReturn >= 0 ? "sim-pnl-good" : "sim-pnl-bad";
            els.tileRange.textContent = `${formatMoney(vWorst)} / +${formatMoney(vBest)}`;
            els.tileCandles.textContent = vCandleCount.toLocaleString("en-US");

            state.lastCurve = arrCurve;
            drawPnlChart(arrCurve);
            setStatus(
                els.resultStatus,
                `Backtest complete: ${arrLegResults.length} leg${arrLegResults.length === 1 ? "" : "s"} marked across ${arrTimes.length.toLocaleString("en-US")} timeline points.`,
                "success"
            );
        }
        catch (objError) {
            setStatus(els.resultStatus, objError && objError.message ? objError.message : "Backtest failed.", "error");
        }
        finally {
            els.runBacktest.disabled = false;
        }
    }

    function drawPnlChart(pCurve) {
        const arrCurve = Array.isArray(pCurve) ? pCurve : [];
        if (arrCurve.length < 2) {
            els.pnlChart.parentElement.style.display = "none";
            els.pnlEmpty.hidden = false;
            return;
        }
        els.pnlChart.parentElement.style.display = "";
        els.pnlEmpty.hidden = true;
        const objCanvas = prepareCanvas(els.pnlChart, 260);
        const objCtx = objCanvas.ctx;
        const vPadLeft = 78;
        const vPadRight = 16;
        const vPadTop = 16;
        const vPadBottom = 30;
        const vPlotWidth = objCanvas.width - vPadLeft - vPadRight;
        const vPlotHeight = objCanvas.height - vPadTop - vPadBottom;
        let vMax = Number.NEGATIVE_INFINITY;
        let vMin = Number.POSITIVE_INFINITY;
        arrCurve.forEach((pPoint) => {
            vMax = Math.max(vMax, pPoint.value);
            vMin = Math.min(vMin, pPoint.value);
        });
        vMax = Math.max(vMax, 0);
        vMin = Math.min(vMin, 0);
        if (vMax === vMin) {
            vMax += 1;
            vMin -= 1;
        }
        const vPadding = (vMax - vMin) * 0.08;
        vMax += vPadding;
        vMin -= vPadding;
        const xFor = (pIndex) => vPadLeft + (pIndex / (arrCurve.length - 1)) * vPlotWidth;
        const yFor = (pValue) => vPadTop + ((vMax - pValue) / (vMax - vMin)) * vPlotHeight;

        for (let vStep = 0; vStep <= 4; vStep += 1) {
            const vValue = vMin + ((vMax - vMin) * vStep) / 4;
            const vY = yFor(vValue);
            objCtx.strokeStyle = "rgba(162,180,228,.12)";
            objCtx.lineWidth = 1;
            objCtx.beginPath();
            objCtx.moveTo(vPadLeft, vY);
            objCtx.lineTo(objCanvas.width - vPadRight, vY);
            objCtx.stroke();
            drawAxisLabel(objCtx, formatMoney(vValue), vPadLeft - 8, vY, "right");
        }

        const vZeroY = yFor(0);
        objCtx.strokeStyle = "rgba(242,182,90,.55)";
        objCtx.setLineDash([5, 4]);
        objCtx.beginPath();
        objCtx.moveTo(vPadLeft, vZeroY);
        objCtx.lineTo(objCanvas.width - vPadRight, vZeroY);
        objCtx.stroke();
        objCtx.setLineDash([]);

        const vPositive = vMax > Math.abs(vMin);
        const strTone = vPositive ? "134,239,172" : "255,181,181";
        const objGradient = objCtx.createLinearGradient(0, vPadTop, 0, vPadTop + vPlotHeight);
        objGradient.addColorStop(0, `rgba(${strTone},.28)`);
        objGradient.addColorStop(1, `rgba(${strTone},.02)`);
        objCtx.beginPath();
        arrCurve.forEach((pPoint, pIndex) => {
            const vX = xFor(pIndex);
            const vY = yFor(pPoint.value);
            if (pIndex === 0) {
                objCtx.moveTo(vX, vY);
            }
            else {
                objCtx.lineTo(vX, vY);
            }
        });
        objCtx.lineTo(xFor(arrCurve.length - 1), vZeroY);
        objCtx.lineTo(xFor(0), vZeroY);
        objCtx.closePath();
        objCtx.fillStyle = objGradient;
        objCtx.fill();

        objCtx.beginPath();
        arrCurve.forEach((pPoint, pIndex) => {
            const vX = xFor(pIndex);
            const vY = yFor(pPoint.value);
            if (pIndex === 0) {
                objCtx.moveTo(vX, vY);
            }
            else {
                objCtx.lineTo(vX, vY);
            }
        });
        objCtx.strokeStyle = `rgb(${strTone})`;
        objCtx.lineWidth = 2;
        objCtx.stroke();

        const vTickCount = Math.min(6, arrCurve.length);
        for (let vTick = 0; vTick < vTickCount; vTick += 1) {
            const vIndex = Math.round((vTick * (arrCurve.length - 1)) / Math.max(1, vTickCount - 1));
            drawAxisLabel(objCtx, formatAxisTime(arrCurve[vIndex].time, els.resolution.value), xFor(vIndex), objCanvas.height - 14, "center");
        }
    }

    // ------------- Manual Bi-Directional Lab (time-travel state machine) -------------
    const labEls = {
        date: byId("labDate"),
        time: byId("labTime"),
        underlying: byId("labUnderlying"),
        jump: byId("labJump"),
        reset: byId("labReset"),
        slDelta: byId("labSlDelta"),
        marginMode: byId("labMarginMode"),
        status: byId("labStatus"),
        meta: byId("labMeta"),
        chainBody: byId("labChainBody"),
        positionsBody: byId("labPositionsBody"),
        logBody: byId("labLogBody"),
        tileTime: byId("labTileTime"),
        tileSpot: byId("labTileSpot"),
        tileEquity: byId("labTileEquity"),
        tileAvailable: byId("labTileAvailable"),
        tileLocked: byId("labTileLocked"),
        tileNet: byId("labTileNet"),
        tileMode: byId("labTileMode")
    };

    // Wallet / strategy constants (spec): $5,000 start, 1 lot = 0.001 BTC,
    // short cross margin 1.7% of notional, portfolio mode offsets 1,000 long
    // lots against 2,000 short lots with a ~$2,200 floor while shorts are
    // open, fee = 0.01% of notional + 18% GST, 0.02% slippage on SL exits.
    const LAB = {
        START: 5000,
        LOT: 0.001,
        MARGIN_RATE: 0.017,
        FEE_RATE: 0.0001,
        GST_RATE: 0.18,
        SLIP_RATE: 0.0002,
        PORT_FLOOR: 2200,
        MONTHLY_LOTS: 2000,
        DAILY_LOTS: 1000,
        MONTHLY_ENTRY_DELTA: 0.4,
        MONTHLY_SL_DELTA: 0.7,
        MONTHLY_TP_DELTA: 0.1,
        DAILY_ENTRY_DELTA: 0.7,
        DAILY_TP_DELTA: 0.995, // spec target Δ≥1.00; BS delta asymptotes below 1
        MONTHLY_MIN_DTE: 15,
        WINDOW: 10,
        KEY: "optionyze-sim-lab-v1",
        MAX_CHECKPOINTS: 400
    };

    const lab = {
        ts: null,           // cursor (unix seconds, UTC)
        snapshot: null,     // last successful /manual-snapshot payload
        positions: [],      // open positions as of the cursor
        trades: [],         // trade log as of the cursor
        tradeEvents: [],    // append-only master log (checkpoint restore)
        realized: 0,        // realised P&L net of fees/slippage, start $5,000
        seq: 0,             // id counter for positions/trades
        checkpoints: {},    // ts -> { positions, realized, seq, tradeCount }
        busy: false
    };

    function labSigned(pValue) {
        const v = Number(pValue);
        if (!Number.isFinite(v)) { return "—"; }
        return `${v >= 0 ? "+" : "−"}$${formatMoney(Math.abs(v))}`;
    }

    function labStrategyLabel(pStrategy) {
        return pStrategy === "monthly" ? "Monthly short CE" : "Daily long CE";
    }

    function labFee(pNotional) {
        return Number(pNotional) * LAB.FEE_RATE * (1 + LAB.GST_RATE);
    }

    function labCursorTs() {
        const strDate = labEls.date ? labEls.date.value : "";
        const strTimeRaw = labEls.time ? labEls.time.value : "";
        if (!strDate || !strTimeRaw) { return null; }
        const strTime = strTimeRaw.length === 5 ? `${strTimeRaw}:00` : strTimeRaw;
        const vMs = Date.parse(`${strDate}T${strTime}Z`);
        return Number.isFinite(vMs) ? Math.floor(vMs / 1000) : null;
    }

    function labSetCursor(pTs) {
        if (!Number.isFinite(Number(pTs)) || !labEls.date || !labEls.time) { return; }
        const objDate = new Date(Number(pTs) * 1000);
        labEls.date.value = `${objDate.getUTCFullYear()}-${pad2(objDate.getUTCMonth() + 1)}-${pad2(objDate.getUTCDate())}`;
        labEls.time.value = `${pad2(objDate.getUTCHours())}:${pad2(objDate.getUTCMinutes())}`;
    }
    function labSave() {
        try {
            const arrKeys = Object.keys(lab.checkpoints).map(Number).sort((a, b) => b - a);
            const objTrimmed = {};
            for (const vKey of arrKeys.slice(0, LAB.MAX_CHECKPOINTS)) {
                objTrimmed[vKey] = lab.checkpoints[vKey];
            }
            lab.checkpoints = objTrimmed;
            window.localStorage.setItem(LAB.KEY, JSON.stringify({
                ts: lab.ts,
                settings: {
                    underlying: labEls.underlying.value,
                    slDelta: labEls.slDelta.value,
                    marginMode: labEls.marginMode.value
                },
                tradeEvents: lab.tradeEvents,
                checkpoints: lab.checkpoints
            }));
        }
        catch (objErr) {
            // Storage full or unavailable — the lab keeps running in memory.
        }
    }

    function labCheckpoint(pTs) {
        lab.checkpoints[pTs] = {
            positions: JSON.parse(JSON.stringify(lab.positions)),
            realized: lab.realized,
            seq: lab.seq,
            tradeCount: lab.tradeEvents.length
        };
    }

    // Restore the portfolio/wallet/trade-log as it was at (or before) pTs so
    // backward stepping never loses history.
    function labRestore(pTs) {
        const vKey = Object.keys(lab.checkpoints).map(Number)
            .filter((vK) => vK <= Number(pTs))
            .sort((a, b) => b - a)[0];
        if (vKey === undefined) { return false; }
        const objCp = lab.checkpoints[vKey];
        lab.positions = JSON.parse(JSON.stringify(objCp.positions || []));
        lab.realized = Number(objCp.realized) || 0;
        lab.seq = Number(objCp.seq) || 0;
        lab.trades = (lab.tradeEvents || []).slice(0, Number(objCp.tradeCount) || 0);
        return true;
    }

    function labLegs() {
        const objS = lab.snapshot;
        if (!objS) { return []; }
        if (Array.isArray(objS.legs) && objS.legs.length) { return objS.legs; }
        const arrOut = [];
        for (const objRow of (objS.strikes || [])) {
            if (objRow.call) { arrOut.push(objRow.call); }
            if (objRow.put) { arrOut.push(objRow.put); }
        }
        return arrOut;
    }

    function labFindLeg(pSymbol) {
        return labLegs().find((objL) => objL.symbol === pSymbol) || null;
    }

    function labMarkPositions() {
        for (const objPos of lab.positions) {
            const objLeg = labFindLeg(objPos.symbol);
            if (objLeg) {
                objPos.markPremium = Number(objLeg.premium);
                objPos.markDelta = Number.isFinite(Number(objLeg.delta)) ? Number(objLeg.delta) : null;
            }
        }
    }
    // Equity = $5,000 + realised + unrealised. Locked = long prepaid premium +
    // short margin. Available = equity − locked.
    function labWallet() {
        const vSpot = lab.snapshot ? Number(lab.snapshot.spot) : NaN;
        let vUnrealized = 0;
        let vLongPremium = 0;
        let vShortNotional = 0;
        let vShortLots = 0;
        let vLongLots = 0;
        for (const objPos of lab.positions) {
            const vMark = Number.isFinite(Number(objPos.markPremium)) ? Number(objPos.markPremium) : objPos.entryPremium;
            vUnrealized += (objPos.direction === "short"
                ? objPos.entryPremium - vMark
                : vMark - objPos.entryPremium) * objPos.lots * LAB.LOT;
            if (objPos.direction === "long") {
                vLongPremium += objPos.entryPremium * objPos.lots * LAB.LOT;
                vLongLots += objPos.lots;
            }
            else {
                vShortLots += objPos.lots;
                if (Number.isFinite(vSpot)) { vShortNotional += objPos.lots * LAB.LOT * vSpot; }
            }
        }
        let vMargin = 0;
        if (vShortLots > 0) {
            if (labEls.marginMode.value === "cross") {
                vMargin = vShortNotional * LAB.MARGIN_RATE;
            }
            else {
                // Portfolio mode: each long lot offsets two short lots
                // (1,000 long vs 2,000 short), with a floor while shorts stay open.
                const vOffsetLots = Math.min(vShortLots, vLongLots * 2);
                const vNetLots = vShortLots - vOffsetLots;
                const vNetNotional = Number.isFinite(vSpot) ? vNetLots * LAB.LOT * vSpot : 0;
                vMargin = Math.max(vNetNotional * LAB.MARGIN_RATE, LAB.PORT_FLOOR);
            }
        }
        const vEquity = LAB.START + lab.realized + vUnrealized;
        const vLocked = vMargin + vLongPremium;
        return {
            equity: vEquity,
            unrealized: vUnrealized,
            margin: vMargin,
            longPremium: vLongPremium,
            locked: vLocked,
            available: vEquity - vLocked,
            netPnl: lab.realized + vUnrealized
        };
    }

    // Close a position: realise gross P&L, charge exit fee (+ slippage on stop
    // losses) and append to the trade log. pForcedPremium settles at intrinsic.
    function labClose(pPos, pReason, pSl, pForcedPremium) {
        const vSpot = lab.snapshot ? Number(lab.snapshot.spot) : NaN;
        const vSettled = Number.isFinite(pForcedPremium);
        const vMark = vSettled ? pForcedPremium
            : (Number.isFinite(Number(pPos.markPremium)) ? Number(pPos.markPremium) : pPos.entryPremium);
        const vDelta = vSettled ? null
            : (Number.isFinite(Number(pPos.markDelta)) ? Number(pPos.markDelta) : null);
        const vGross = (pPos.direction === "short" ? pPos.entryPremium - vMark : vMark - pPos.entryPremium)
            * pPos.lots * LAB.LOT;
        const vExitNotional = pPos.lots * LAB.LOT * (Number.isFinite(vSpot) ? vSpot : 0);
        const vFee = vSettled ? 0 : labFee(vExitNotional);
        const vSlip = pSl && !vSettled ? vExitNotional * LAB.SLIP_RATE : 0;
        lab.realized += vGross - vFee - vSlip;
        lab.seq += 1;
        const objTrade = {
            id: lab.seq,
            strategy: pPos.strategy,
            direction: pPos.direction,
            symbol: pPos.symbol,
            expiry: pPos.expiryDate,
            strike: pPos.strike,
            lots: pPos.lots,
            entryTs: pPos.entryTs,
            entryPremium: pPos.entryPremium,
            entryDelta: pPos.entryDelta,
            exitTs: lab.ts,
            exitPremium: vMark,
            exitDelta: vDelta,
            reason: pReason,
            gross: vGross,
            fees: pPos.entryFee + vFee,
            slippage: vSlip,
            net: vGross - pPos.entryFee - vFee - vSlip
        };
        lab.trades.push(objTrade);
        lab.tradeEvents.push(objTrade);
        lab.positions = lab.positions.filter((vP) => vP.id !== pPos.id);
        return objTrade;
    }
    // Evaluate exits for every open position at the current snapshot.
    // Rules: monthly short — SL Δ≥0.70, TP Δ≤0.10, rollover when <15d to
    // expiry; daily long — SL Δ≤0.50/0.60 (toggle), TP Δ≥1.00. Midnight never
    // force-liquidates; only settlement at expiry does.
    function labRunExits() {
        const arrOut = [];
        const vSpot = lab.snapshot ? Number(lab.snapshot.spot) : NaN;
        for (const objPos of [...lab.positions]) {
            const vExpiryMs = Number(objPos.expiryMs) || 0;
            const vExpired = vExpiryMs > 0 && lab.ts * 1000 >= vExpiryMs;
            if (vExpired) {
                const vIntr = Number.isFinite(vSpot)
                    ? (objPos.direction === "long"
                        ? Math.max(0, vSpot - objPos.strike)
                        : Math.max(0, objPos.strike - vSpot))
                    : NaN;
                const objT = labClose(objPos, "Expired — settled at intrinsic", false, vIntr);
                arrOut.push(`closed ${labStrategyLabel(objPos.strategy)} @${formatPrice(objPos.strike)} on expiry ${labSigned(objT.net)}`);
                continue;
            }
            if (objPos.strategy === "monthly") {
                const vDte = (vExpiryMs - lab.ts * 1000) / 86400000;
                if (vDte < LAB.MONTHLY_MIN_DTE) {
                    const objT = labClose(objPos, `Rollover — ${vDte.toFixed(1)}d (<15d) to expiry`, false);
                    arrOut.push(`rolled ${labStrategyLabel(objPos.strategy)} @${formatPrice(objPos.strike)} ${labSigned(objT.net)}`);
                    continue;
                }
            }
            const vDelta = Number(objPos.markDelta);
            if (!Number.isFinite(vDelta)) { continue; }
            if (objPos.strategy === "monthly") {
                if (vDelta >= LAB.MONTHLY_SL_DELTA) {
                    const objT = labClose(objPos, "SL — Δ≥0.70", true);
                    arrOut.push(`SL ${labStrategyLabel(objPos.strategy)} @${formatPrice(objPos.strike)} Δ${vDelta.toFixed(2)} ${labSigned(objT.net)}`);
                }
                else if (vDelta <= LAB.MONTHLY_TP_DELTA) {
                    const objT = labClose(objPos, "TP — Δ≤0.10", false);
                    arrOut.push(`TP ${labStrategyLabel(objPos.strategy)} @${formatPrice(objPos.strike)} Δ${vDelta.toFixed(2)} ${labSigned(objT.net)}`);
                }
            }
            else {
                const vSl = Number(labEls.slDelta.value) || 0.5;
                if (vDelta <= vSl) {
                    const objT = labClose(objPos, `SL — Δ≤${vSl.toFixed(2)}`, true);
                    arrOut.push(`SL ${labStrategyLabel(objPos.strategy)} @${formatPrice(objPos.strike)} Δ${vDelta.toFixed(2)} ${labSigned(objT.net)}`);
                }
                else if (vDelta >= LAB.DAILY_TP_DELTA) {
                    const objT = labClose(objPos, "TP — Δ≥1.00", false);
                    arrOut.push(`TP ${labStrategyLabel(objPos.strategy)} @${formatPrice(objPos.strike)} Δ${vDelta.toFixed(2)} ${labSigned(objT.net)}`);
                }
            }
        }
        return arrOut;
    }
    function labPickLeg(pExpiryDate, pTargetDelta) {
        const arr = labLegs().filter((objL) =>
            objL.side === "call"
            && objL.expiryDate === pExpiryDate
            && Number(objL.premium) > 0
            && Number.isFinite(Number(objL.delta)));
        if (!arr.length) { return null; }
        let objBest = arr[0];
        let vBestDist = Math.abs(Number(arr[0].delta) - pTargetDelta);
        for (const objL of arr.slice(1)) {
            const vDist = Math.abs(Number(objL.delta) - pTargetDelta);
            if (vDist < vBestDist) {
                objBest = objL;
                vBestDist = vDist;
            }
        }
        return objBest;
    }

    function labOpen(pStrategy, pLeg) {
        const vLots = pStrategy === "monthly" ? LAB.MONTHLY_LOTS : LAB.DAILY_LOTS;
        const vDirection = pStrategy === "monthly" ? "short" : "long";
        const vSpot = lab.snapshot ? Number(lab.snapshot.spot) : NaN;
        const vEntryNotional = vLots * LAB.LOT * (Number.isFinite(vSpot) ? vSpot : 0);
        const vEntryFee = labFee(vEntryNotional);
        lab.realized -= vEntryFee;
        lab.seq += 1;
        const vExpMs = Date.parse(pLeg.expiry);
        lab.positions.push({
            id: lab.seq,
            strategy: pStrategy,
            direction: vDirection,
            symbol: pLeg.symbol,
            strike: pLeg.strike,
            expiryDate: pLeg.expiryDate,
            expiryMs: Number.isFinite(vExpMs) ? vExpMs : 0,
            lots: vLots,
            entryTs: lab.ts,
            entryPremium: Number(pLeg.premium),
            entryDelta: Number.isFinite(Number(pLeg.delta)) ? Number(pLeg.delta) : null,
            entryFee: vEntryFee,
            markPremium: Number(pLeg.premium),
            markDelta: Number.isFinite(Number(pLeg.delta)) ? Number(pLeg.delta) : null
        });
        return vEntryFee;
    }

    // Evaluate entries: flat monthly → short 2,000 lots CE at ≈0.40Δ on the
    // monthly expiry (discovered ≥15d out); flat daily → long 1,000 lots CE
    // at ≈0.70Δ on the T+2 daily expiry. Midnight only affects which T+2 a
    // *new* entry picks — it never liquidates existing positions.
    function labRunEntries() {
        const arrOut = [];
        const objS = lab.snapshot;
        if (!objS) { return arrOut; }
        if (!lab.positions.some((p) => p.strategy === "monthly")) {
            const vExpMs = Date.parse(objS.monthlyExpiryFull || `${objS.monthlyExpiry}T12:00:00Z`);
            const vDte = Number.isFinite(vExpMs) ? (vExpMs - lab.ts * 1000) / 86400000 : -1;
            if (vDte >= LAB.MONTHLY_MIN_DTE) {
                const objLeg = labPickLeg(objS.monthlyExpiry, LAB.MONTHLY_ENTRY_DELTA);
                if (objLeg) {
                    labOpen("monthly", objLeg);
                    arrOut.push(`opened monthly short 2,000 lots CE @${formatPrice(objLeg.strike)} Δ${Number(objLeg.delta).toFixed(2)}`);
                }
            }
        }
        if (!lab.positions.some((p) => p.strategy === "daily")) {
            const objLeg = labPickLeg(objS.dailyExpiry, LAB.DAILY_ENTRY_DELTA);
            if (objLeg) {
                labOpen("daily", objLeg);
                arrOut.push(`opened daily long 1,000 lots CE @${formatPrice(objLeg.strike)} Δ${Number(objLeg.delta).toFixed(2)}`);
            }
        }
        return arrOut;
    }
    function labRenderChain() {
        const objBody = labEls.chainBody;
        if (!objBody) { return; }
        const objS = lab.snapshot;
        if (!objS || !Array.isArray(objS.strikes) || !objS.strikes.length) {
            objBody.innerHTML = '<tr class="sim-empty-row"><td colspan="9">No chain available for this timestamp.</td></tr>';
            return;
        }
        const objHeld = new Set(lab.positions.map((p) => p.symbol));
        const fmtVal = (pLeg, pKey) => {
            if (!pLeg) { return "—"; }
            if (pKey === "oi") { return "n/a"; }
            const vN = Number(pLeg[pKey]);
            if (!Number.isFinite(vN)) { return "—"; }
            if (pKey === "premium") { return formatPrice(vN); }
            if (pKey === "gamma") { return vN >= 0.001 ? vN.toFixed(4) : vN.toExponential(1); }
            return vN.toFixed(3);
        };
        const titleOf = (pLeg) => pLeg
            ? `${pLeg.symbol} · ${pLeg.expiryDate} expiry · IV ${Number.isFinite(Number(pLeg.iv)) ? `${(Number(pLeg.iv) * 100).toFixed(1)}%` : "n/a"}`
            : "";
        const clsOf = (pLeg) => {
            let str = "lab-cell";
            if (pLeg && objHeld.has(pLeg.symbol)) { str += " is-held"; }
            if (pLeg && pLeg.expiryDate && pLeg.expiryDate !== objS.monthlyExpiry) { str += " is-daily"; }
            return str;
        };
        const cellOf = (pLeg, pKey) => `<td class="${clsOf(pLeg)}" title="${escapeHtml(titleOf(pLeg))}">${fmtVal(pLeg, pKey)}</td>`;
        const oiOf = (pLeg) => pLeg
            ? '<td class="lab-cell lab-oi" title="Open interest is not available for historical expiries.">n/a</td>'
            : '<td class="lab-cell">—</td>';
        objBody.innerHTML = objS.strikes.map((objRow) => {
            const arrCells = [
                cellOf(objRow.call, "premium"),
                cellOf(objRow.call, "delta"),
                cellOf(objRow.call, "gamma"),
                oiOf(objRow.call),
                `<td class="lab-strike-cell">${formatPrice(objRow.strike)}${objRow.isAtm ? ' <span class="lab-atm-tag">ATM</span>' : ""}</td>`,
                oiOf(objRow.put),
                cellOf(objRow.put, "gamma"),
                cellOf(objRow.put, "delta"),
                cellOf(objRow.put, "premium")
            ];
            return `<tr class="${objRow.isAtm ? "is-atm" : ""}">${arrCells.join("")}</tr>`;
        }).join("");
    }

    function labRenderTiles() {
        if (!labEls.tileTime) { return; }
        const objW = labWallet();
        labEls.tileTime.textContent = lab.ts ? formatUtc(lab.ts, true) : "—";
        labEls.tileSpot.textContent = lab.snapshot ? `$${formatPrice(lab.snapshot.spot)}` : "—";
        labEls.tileEquity.textContent = `$${formatMoney(objW.equity)}`;
        labEls.tileAvailable.textContent = `$${formatMoney(objW.available)}`;
        labEls.tileLocked.textContent = `$${formatMoney(objW.locked)}`;
        labEls.tileNet.textContent = labSigned(objW.netPnl);
        labEls.tileNet.className = objW.netPnl >= 0 ? "sim-pnl-good" : "sim-pnl-bad";
        labEls.tileMode.textContent = labEls.marginMode.value === "portfolio" ? "Portfolio offset" : "Cross 1.7%";
    }

    function labDteLabel(pExpiryDate, pFull) {
        const vMs = Date.parse(pFull || `${pExpiryDate}T12:00:00Z`);
        if (!Number.isFinite(vMs) || !lab.ts) { return "?"; }
        return Math.max(0, (vMs - lab.ts * 1000) / 86400000).toFixed(1);
    }

    function labRenderMeta() {
        const objBody = labEls.meta;
        if (!objBody) { return; }
        const objS = lab.snapshot;
        if (!objS) {
            objBody.textContent = "No snapshot loaded yet — pick a time and press Jump, or take a forward step.";
            return;
        }
        const strMonthly = objS.monthlyExpiry || "?";
        const strDaily = objS.dailyExpiry || "?";
        objBody.innerHTML = [
            `<span>Monthly ${strMonthly} (${labDteLabel(strMonthly, objS.monthlyExpiryFull)}d)</span>`,
            `<span>Daily T+2 ${strDaily} (${labDteLabel(strDaily, objS.dailyExpiryFull)}d)</span>`,
            `<span>ATM ${formatPrice(objS.atmStrike)}</span>`,
            `<span>Spot ${escapeHtml(String(objS.spotSymbol || ""))}</span>`,
            `<span>Window ±${objS.window} strikes</span>`,
            "<span>$5,000 start · 1 lot = 0.001 BTC · fee 0.01% + 18% GST · slippage 0.02% on SL exits</span>",
            "<span>Greeks computed via Black-Scholes IV inversion · historical OI = n/a</span>"
        ].join("");
    }
    function labRenderPositions() {
        const objBody = labEls.positionsBody;
        if (!objBody) { return; }
        if (!lab.positions.length) {
            objBody.innerHTML = '<tr class="sim-empty-row"><td colspan="14">No open positions yet — take a forward step to let the state machine enter.</td></tr>';
            return;
        }
        objBody.innerHTML = lab.positions.map((objPos) => {
            const vMark = Number.isFinite(Number(objPos.markPremium)) ? Number(objPos.markPremium) : null;
            const vMarkDelta = Number.isFinite(Number(objPos.markDelta)) ? Number(objPos.markDelta) : null;
            const vGross = vMark === null ? null
                : (objPos.direction === "short" ? objPos.entryPremium - vMark : vMark - objPos.entryPremium)
                    * objPos.lots * LAB.LOT;
            const vDte = objPos.expiryMs ? (objPos.expiryMs - (lab.ts || 0)) / 86400000 : null;
            const vSpot = lab.snapshot ? Number(lab.snapshot.spot) : NaN;
            const vLocked = objPos.direction === "long"
                ? { v: objPos.entryPremium * objPos.lots * LAB.LOT, t: "Prepaid long premium (USD)" }
                : {
                    v: Number.isFinite(vSpot) ? objPos.lots * LAB.LOT * vSpot * LAB.MARGIN_RATE : null,
                    t: "Indicative individual short margin (1.7% of notional); portfolio mode offsets this."
                };
            const strGrossCls = vGross === null ? "" : (vGross >= 0 ? "sim-pnl-good" : "sim-pnl-bad");
            return `<tr>
                <td>${objPos.id}</td>
                <td>${labStrategyLabel(objPos.strategy)}</td>
                <td>${objPos.direction === "short" ? "Short CE" : "Long CE"}</td>
                <td title="${escapeHtml(objPos.symbol)}">${escapeHtml(String(objPos.symbol || "").slice(0, 26))}</td>
                <td>${escapeHtml(String(objPos.expiryDate || ""))}</td>
                <td>${formatPrice(objPos.strike)}</td>
                <td>${objPos.lots}</td>
                <td>${objPos.entryDelta === null || objPos.entryDelta === undefined ? "—" : Number(objPos.entryDelta).toFixed(3)}</td>
                <td>${formatPrice(objPos.entryPremium)}</td>
                <td>${vMarkDelta === null ? "—" : vMarkDelta.toFixed(3)}</td>
                <td>${vMark === null ? "—" : formatPrice(vMark)}</td>
                <td>${vDte === null ? "—" : vDte.toFixed(1)}</td>
                <td title="${escapeHtml(vLocked.t)}">${vLocked.v === null || vLocked.v === undefined ? "—" : `$${formatMoney(vLocked.v)}`}</td>
                <td class="${strGrossCls}">${vGross === null ? "—" : labSigned(vGross)}</td>
            </tr>`;
        }).join("");
    }

    function labRenderLog() {
        const objBody = labEls.logBody;
        if (!objBody) { return; }
        const arrTrades = [...lab.trades].sort((a, b) => (a.exitTs || 0) - (b.exitTs || 0));
        if (!arrTrades.length) {
            objBody.innerHTML = '<tr class="sim-empty-row"><td colspan="15">Closed trades appear here with their exit reason.</td></tr>';
            return;
        }
        objBody.innerHTML = arrTrades.map((objT) => `<tr>
            <td>${objT.id}</td>
            <td>${labStrategyLabel(objT.strategy)}</td>
            <td>${objT.direction === "short" ? "Short CE" : "Long CE"}</td>
            <td>${formatPrice(objT.strike)}</td>
            <td>${objT.lots}</td>
            <td>${formatUtc(objT.entryTs, true)}</td>
            <td>${objT.entryDelta === null || objT.entryDelta === undefined ? "—" : Number(objT.entryDelta).toFixed(3)}</td>
            <td>${formatPrice(objT.entryPremium)}</td>
            <td>${formatUtc(objT.exitTs, true)}</td>
            <td>${objT.exitDelta === null || objT.exitDelta === undefined ? "—" : Number(objT.exitDelta).toFixed(3)}</td>
            <td>${formatPrice(objT.exitPremium)}</td>
            <td>${escapeHtml(String(objT.reason || ""))}</td>
            <td>${formatMoney(objT.fees)}</td>
            <td>${formatMoney(objT.slippage)}</td>
            <td class="${objT.net >= 0 ? "sim-pnl-good" : "sim-pnl-bad"}">${labSigned(objT.net)}</td>
        </tr>`).join("");
    }

    function labRenderAll() {
        labRenderChain();
        labRenderTiles();
        labRenderMeta();
        labRenderPositions();
        labRenderLog();
    }
    // Core time-travel routine. Fetches the snapshot at pTargetTs, then:
    //   init  → restore the newest checkpoint ≤ target (display only)
    //   step/jump forward to an unseen ts → run the state machine
    //   backward (or repeat) → restore the checkpoint so nothing is lost
    async function labGoto(pTargetTs, pMode) {
        if (lab.busy) { return; }
        const vTarget = Math.floor(Number(pTargetTs));
        if (!Number.isFinite(vTarget) || vTarget <= 0) {
            setStatus(labEls.status, "Pick a valid date/time first.", "warning");
            return;
        }
        lab.busy = true;
        const vPrevTs = lab.ts;
        const vForward = vPrevTs === null ? pMode !== "init" : vTarget > vPrevTs;
        setStatus(labEls.status, "Loading historical snapshot…", "");
        try {
            const strHeld = lab.positions
                .map((p) => `${p.symbol}:${p.expiryDate}`)
                .join("|");
            const objBody = await apiGet("/manual-snapshot", {
                underlying: labEls.underlying.value,
                timestamp: vTarget,
                window: LAB.WINDOW,
                held: strHeld
            });
            if (!objBody || objBody.status !== "success" || !objBody.data) {
                throw new Error((objBody && objBody.message) || "Snapshot unavailable for that timestamp.");
            }
            lab.ts = Number(objBody.data.timestamp) || vTarget;
            lab.snapshot = objBody.data;
            let strActions = "";
            const blnExact = Object.prototype.hasOwnProperty.call(lab.checkpoints, String(lab.ts));
            if (pMode === "init") {
                labRestore(lab.ts);
                strActions = "Lab state loaded.";
            }
            else if (blnExact) {
                labRestore(lab.ts);
                strActions = "Checkpoint restored.";
            }
            else if (vForward) {
                labMarkPositions();
                const arrClosed = labRunExits();
                const arrOpened = labRunEntries();
                const arrBits = [...arrClosed, ...arrOpened];
                strActions = arrBits.length ? arrBits.join(" · ") : "No strategy changes.";
            }
            else {
                strActions = labRestore(lab.ts) ? "Checkpoint restored." : "No checkpoint at/before that time — showing current state.";
            }
            labMarkPositions();
            labCheckpoint(lab.ts);
            labSetCursor(lab.ts);
            labSave();
            labRenderAll();
            setStatus(labEls.status, `${strActions} ${objBody.message || ""}`.trim(), "success");
        }
        catch (objErr) {
            if (vPrevTs !== null) { labSetCursor(vPrevTs); }
            setStatus(labEls.status, objErr.message || "Snapshot failed.", "error");
            labRenderAll();
        }
        finally {
            lab.busy = false;
        }
    }
    function labHardReset() {
        lab.positions = [];
        lab.trades = [];
        lab.tradeEvents = [];
        lab.realized = 0;
        lab.seq = 0;
        lab.checkpoints = {};
        labSave();
    }

    function initLab() {
        if (!labEls.date || !labEls.jump) { return; }
        let objPersisted = null;
        try {
            objPersisted = JSON.parse(window.localStorage.getItem(LAB.KEY) || "null");
        }
        catch (objErr) {
            objPersisted = null;
        }
        if (objPersisted && objPersisted.settings) {
            const objSet = objPersisted.settings;
            if (objSet.underlying) { labEls.underlying.value = objSet.underlying; }
            if (objSet.slDelta) { labEls.slDelta.value = objSet.slDelta; }
            if (objSet.marginMode) { labEls.marginMode.value = objSet.marginMode; }
        }
        if (objPersisted && objPersisted.tradeEvents && Array.isArray(objPersisted.tradeEvents)) {
            lab.tradeEvents = objPersisted.tradeEvents;
        }
        if (objPersisted && objPersisted.checkpoints && typeof objPersisted.checkpoints === "object") {
            lab.checkpoints = objPersisted.checkpoints;
        }
        const vStartTs = objPersisted && Number.isFinite(Number(objPersisted.ts)) && Number(objPersisted.ts) > 0
            ? Math.floor(Number(objPersisted.ts))
            : Math.floor(Date.now() / 1000 / 300) * 300;
        labSetCursor(vStartTs);
        labRenderAll();

        labEls.jump.addEventListener("click", () => {
            const vTs = labCursorTs();
            if (vTs === null) {
                setStatus(labEls.status, "Pick a valid date/time first.", "warning");
                return;
            }
            const blnSame = vTs === lab.ts;
            void labGoto(vTs, blnSame ? "init" : "jump");
        });
        labEls.reset.addEventListener("click", async () => {
            labHardReset();
            const vTs = labCursorTs() || Math.floor(Date.now() / 1000);
            await labGoto(vTs, "init");
            setStatus(labEls.status, "Lab wallet reset to $5,000 — all checkpoints cleared.", "success");
        });
        labEls.underlying.addEventListener("change", () => {
            labHardReset();
            void labGoto(labCursorTs() || Math.floor(Date.now() / 1000), "init");
        });
        labEls.slDelta.addEventListener("change", () => {
            labSave();
            labRenderAll();
        });
        labEls.marginMode.addEventListener("change", () => {
            labSave();
            labRenderAll();
        });
        const objSteps = document.querySelector(".sim-lab-steps");
        if (objSteps) {
            objSteps.addEventListener("click", (objEvent) => {
                const objBtn = objEvent.target instanceof Element ? objEvent.target.closest("[data-lab-step]") : null;
                if (!objBtn) { return; }
                const vDelta = Number(objBtn.getAttribute("data-lab-step"));
                const vBase = lab.ts !== null ? lab.ts : labCursorTs();
                if (vBase === null || !Number.isFinite(vDelta)) { return; }
                void labGoto(vBase + vDelta, "step");
            });
        }

        void labGoto(vStartTs, "init");
    }


    function initDefaults() {
        const objNow = new Date();
        const objFrom = new Date(objNow.getTime() - 7 * 86400000);
        els.from.value = toLocalInputValue(objFrom);
        els.to.value = toLocalInputValue(objNow);
        els.expiry.value = toLocalDateValue(objNow);
        els.instrument.value = "futures";
        state.lastCurve = [];
        updateRangeHint();
    }

    function bindEvents() {
        els.instrument.addEventListener("change", () => void loadSymbolOptions());
        els.underlying.addEventListener("change", () => void loadSymbolOptions());
        els.expiry.addEventListener("change", () => void loadSymbolOptions());
        els.expiryPrev.addEventListener("click", () => shiftExpiry(-1));
        els.expiryNext.addEventListener("click", () => shiftExpiry(1));
        els.resolution.addEventListener("change", updateRangeHint);
        els.from.addEventListener("change", updateRangeHint);
        els.to.addEventListener("change", updateRangeHint);
        els.loadBtn.addEventListener("click", () => void loadHistory());
        els.addFuturesLeg.addEventListener("click", () => addLeg("futures"));
        els.addOptionLeg.addEventListener("click", () => addLeg("options"));
        els.runBacktest.addEventListener("click", () => void runBacktest());
        els.legsBody.addEventListener("change", onLegFieldChange);
        els.legsBody.addEventListener("click", onLegClick);
        window.addEventListener("resize", () => {
            drawPriceChart();
            drawPnlChart(state.lastCurve || []);
        });
    }

    initDefaults();
    bindEvents();
    drawPriceChart();
    resetResults();
    void loadSymbolOptions();
    initLab();
})();


