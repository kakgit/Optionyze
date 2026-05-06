(function () {
    const ids = {
        symbol: document.getElementById("ddlCoveredCallSymbol"),
        lotSize: document.getElementById("txtCoveredCallLotSize"),
        manualFutQty: document.getElementById("txtManualFutQty"),
        manualFutOrderType: document.getElementById("ddlManualFutOrderType"),
        action1: document.getElementById("ddlActionCoveredCall1"),
        legSide1: document.getElementById("ddlLegSideCoveredCall1"),
        expiryMode1: document.getElementById("ddlExpiryModeCoveredCall1"),
        expiryDate1: document.getElementById("txtExpiryCoveredCall1"),
        manualOptQty1: document.getElementById("txtManualOptQtyCoveredCall1"),
        newDelta1: document.getElementById("txtNewDeltaCoveredCall1"),
        reDelta1: document.getElementById("txtReDeltaCoveredCall1"),
        deltaTp1: document.getElementById("txtDeltaTPCoveredCall1"),
        deltaSl1: document.getElementById("txtDeltaSLCoveredCall1"),
        reEnter1: document.getElementById("chkReLegCoveredCall1"),
        redOptQtyPct: document.getElementById("txtRedOptQtyPctCoveredCall"),
        greenOptQtyPct: document.getElementById("txtGreenOptQtyPctCoveredCall"),
        greenReDelta: document.getElementById("txtReGreenDCoveredCall"),
        greenTpDelta: document.getElementById("txtReGreenTPCoveredCall"),
        greenSlDelta: document.getElementById("txtReGreenSLCoveredCall"),
        addOneLotFuture: document.getElementById("chkAddOneLotFutIfNegFut"),
        renkoFeedEnabled: document.querySelector(".rolling-demo-switch input"),
        renkoFeedPts: document.getElementById("txtRenkoFeedPts"),
        renkoFeedPriceSrc: document.getElementById("ddlRenkoFeedPriceSrc"),
        optionsPnl: document.getElementById("txtRollingDemoOptionsPnl"),
        closedFromDate: document.getElementById("txtClsFromDate"),
        closedToDate: document.getElementById("txtClsToDate"),
        renkoFeedMeta: document.querySelector(".rolling-demo-feed-meta"),
        renkoFeedBadge: document.querySelector(".rolling-demo-switch")?.nextElementSibling,
        oneLotValue: document.getElementById("rollingDemoOneLotValue"),
        totalMarginValue: document.getElementById("rollingDemoTotalMarginValue"),
        engineStatus: document.getElementById("rollingDemoEngineStatus"),
        openCount: document.getElementById("rollingDemoOpenCount"),
        autoTraderButton: document.getElementById("btnRollingDemoAutoTrader"),
        lastSignal: document.getElementById("rollingDemoLastSignal"),
        openPositionsBody: document.getElementById("rollingDemoOpenPositionsBody"),
        closedPositionsBody: document.getElementById("rollingDemoClosedPositionsBody"),
        refreshOpenPositionsButton: document.getElementById("btnRollingDemoRefreshOpenPositions"),
        clearClosedFiltersButton: document.getElementById("btnRollingDemoClearClosedFilters"),
        sellFutureButton: document.getElementById("btnRollingDemoSellFuture"),
        buyFutureButton: document.getElementById("btnRollingDemoBuyFuture"),
        execStrategyButton: document.getElementById("btnRollingDemoExecStrategy"),
        openOptionButton: document.getElementById("btnRollingDemoOpenOption"),
        exitOptionButton: document.getElementById("btnRollingDemoExitOption"),
        clearOpenPositionsButton: document.getElementById("btnRollingDemoClearOpenPositions"),
        killSwitchButton: document.getElementById("btnRollingDemoKillSwitch"),
        clearClosedPositionsButton: document.getElementById("btnRollingDemoClearClosedPositions"),
        telegramAlertsEnabled: document.getElementById("chkRollingDemoTelegramAlertsEnabled"),
        telegramEventCheckboxes: Array.from(document.querySelectorAll(".rolling-demo-telegram-event")),
        eventLog: document.getElementById("rollingDemoEventLog"),
        refreshEventsButton: document.getElementById("btnRollingDemoRefreshEvents"),
        clearEventsButton: document.getElementById("btnRollingDemoClearEvents")
    };

    const symbolConfig = {
        BTC: { contractName: "BTCUSD", lotSize: "0.001" },
        ETH: { contractName: "ETHUSD", lotSize: "0.01" }
    };

    let gIsApplyingState = false;
    let gSaveTimer = null;
    let gPreviousOpenPositionLtps = new Map();
    let gLatestRuntimeState = null;
    let gLatestOpenPositions = [];
    let gHasLoadedProfile = false;

    function getSelectedConfig() {
        const selectedSymbol = String(ids.symbol?.value || "BTC").trim().toUpperCase();
        return symbolConfig[selectedSymbol] || symbolConfig.BTC;
    }

    function formatDateInputValue(dateValue) {
        if (!(dateValue instanceof Date) || Number.isNaN(dateValue.getTime())) {
            return "";
        }

        const year = String(dateValue.getFullYear());
        const month = String(dateValue.getMonth() + 1).padStart(2, "0");
        const day = String(dateValue.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

    function getLastFridayOfMonth(yearValue, monthIndex) {
        const dateValue = new Date(yearValue, monthIndex + 1, 0);
        while (dateValue.getDay() !== 5) {
            dateValue.setDate(dateValue.getDate() - 1);
        }
        return dateValue;
    }

    function resolveExpiryDateByMode(expiryMode) {
        const modeValue = String(expiryMode || "").trim();
        const currentDate = new Date();
        const currentDayOfWeek = currentDate.getDay();

        if (modeValue === "1") {
            currentDate.setDate(currentDate.getDate() + 1);
            return currentDate;
        }
        if (modeValue === "2") {
            currentDate.setDate(currentDate.getDate() + 2);
            return currentDate;
        }
        if (modeValue === "4") {
            const daysToThisFriday = (5 - currentDayOfWeek + 7) % 7;
            const daysToWeeklyFriday = currentDayOfWeek >= 2 ? (daysToThisFriday + 7) : daysToThisFriday;
            currentDate.setDate(currentDate.getDate() + daysToWeeklyFriday);
            return currentDate;
        }
        if (modeValue === "5") {
            const daysToThisFriday = (5 - currentDayOfWeek + 7) % 7;
            const daysToBiWeeklyFriday = currentDayOfWeek >= 2 ? (daysToThisFriday + 14) : (daysToThisFriday + 7);
            currentDate.setDate(currentDate.getDate() + daysToBiWeeklyFriday);
            return currentDate;
        }
        if (modeValue === "6") {
            const lastFridayOfMonth = getLastFridayOfMonth(currentDate.getFullYear(), currentDate.getMonth());
            const lastFridayOfNextMonth = getLastFridayOfMonth(currentDate.getFullYear(), currentDate.getMonth() + 1);
            return currentDate.getDate() > 15 ? lastFridayOfNextMonth : lastFridayOfMonth;
        }

        return currentDate;
    }

    function applySymbolDefaults() {
        const selectedConfig = getSelectedConfig();

        if (ids.lotSize) {
            ids.lotSize.value = selectedConfig.lotSize;
        }

        if (ids.renkoFeedMeta) {
            ids.renkoFeedMeta.textContent = `Symbol: ${selectedConfig.contractName} | Renko state is driven from the server cycle using the selected price source and point size.`;
        }
    }

    function applyExpiryModeDefaults() {
        if (!ids.expiryMode1 || !ids.expiryDate1) {
            return;
        }

        const resolvedDate = resolveExpiryDateByMode(ids.expiryMode1.value);
        const formattedDate = formatDateInputValue(resolvedDate);
        if (formattedDate) {
            ids.expiryDate1.value = formattedDate;
        }
    }

    function updateRenkoFeedVisualState() {
        const isEnabled = Boolean(ids.renkoFeedEnabled?.checked);
        if (ids.renkoFeedBadge) {
            ids.renkoFeedBadge.textContent = isEnabled ? "ON" : "OFF";
            ids.renkoFeedBadge.classList.toggle("success", isEnabled);
            ids.renkoFeedBadge.classList.toggle("secondary", !isEnabled);
        }
    }

    function applyRenkoSignalBox(colorCode) {
        if (!ids.lastSignal) {
            return;
        }

        const normalized = String(colorCode || "").trim().toUpperCase();
        ids.lastSignal.classList.remove("idle", "green", "red");

        if (normalized === "G") {
            ids.lastSignal.classList.add("green");
            ids.lastSignal.textContent = "G";
            ids.lastSignal.title = "Current Renko box: Green. Click to toggle.";
            return;
        }

        if (normalized === "R") {
            ids.lastSignal.classList.add("red");
            ids.lastSignal.textContent = "R";
            ids.lastSignal.title = "Current Renko box: Red. Click to toggle.";
            return;
        }

        ids.lastSignal.classList.add("idle");
        ids.lastSignal.textContent = "-";
        ids.lastSignal.title = "Current Renko box color. Click to toggle.";
    }

    function updateOneLotMetric(runtimeState = gLatestRuntimeState) {
        if (!ids.oneLotValue) {
            return;
        }

        const selectedSymbol = String(ids.symbol?.value || "BTC").trim().toUpperCase();
        const runtimeSymbol = String(runtimeState?.currentSymbol || "").trim().toUpperCase();
        const selectedLotSize = Number(getSelectedConfig().lotSize || 0);
        const referencePrice = runtimeSymbol === selectedSymbol
            ? Number(runtimeState?.lastSpotPrice ?? runtimeState?.lastFuturesPrice ?? NaN)
            : NaN;

        if (!Number.isFinite(selectedLotSize) || selectedLotSize <= 0 || !Number.isFinite(referencePrice) || referencePrice <= 0) {
            ids.oneLotValue.textContent = "-";
            return;
        }

        ids.oneLotValue.textContent = formatNumericValue(referencePrice * selectedLotSize, 3);
    }

    function updateTotalMarginMetric(rows = gLatestOpenPositions) {
        if (!ids.totalMarginValue) {
            return;
        }

        if (!Array.isArray(rows) || rows.length === 0) {
            ids.totalMarginValue.textContent = "-";
            return;
        }

        const totalMargin = rows
            .filter(function (row) {
                return String(row?.instrumentType || "").toUpperCase() === "FUTURE";
            })
            .reduce(function (sum, row) {
                const rate = Number(row?.entryPrice ?? 0);
                const lotSize = Number(row?.lotSize || 0);
                const qty = Number(row?.qty || 0);
                if (!Number.isFinite(rate) || !Number.isFinite(lotSize) || !Number.isFinite(qty)) {
                    return sum;
                }
                return sum + (rate * lotSize * qty);
            }, 0);

        ids.totalMarginValue.textContent = totalMargin > 0
            ? formatNumericValue(totalMargin, 3)
            : "-";
    }

    function formatDisplayDateTime(dateValue) {
        const parsedDate = dateValue ? new Date(dateValue) : null;
        if (!(parsedDate instanceof Date) || Number.isNaN(parsedDate.getTime())) {
            return "-";
        }

        return parsedDate.toLocaleString("en-IN", {
            year: "numeric",
            month: "short",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
        });
    }

    function formatNumericValue(value, fractionDigits) {
        if (value === null || value === undefined || value === "") {
            return "-";
        }

        const parsedValue = Number(value);
        if (Number.isNaN(parsedValue)) {
            return "-";
        }

        return parsedValue.toFixed(fractionDigits);
    }

    function parseNumberInput(field, fallbackValue) {
        const rawValue = field?.value;
        if (rawValue === null || rawValue === undefined || rawValue === "") {
            return fallbackValue;
        }

        const parsedValue = Number(rawValue);
        return Number.isFinite(parsedValue) ? parsedValue : fallbackValue;
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll("\"", "&quot;")
            .replaceAll("'", "&#39;");
    }

    function sumNumeric(rows, key) {
        return rows.reduce(function (sum, row) {
            const value = Number(row?.[key] || 0);
            return sum + (Number.isFinite(value) ? value : 0);
        }, 0);
    }

    function getLtpBlinkClass(positionId, markPrice) {
        const currentLtp = Number(markPrice);
        const previousLtp = gPreviousOpenPositionLtps.get(positionId);

        if (!positionId || Number.isNaN(currentLtp)) {
            return "";
        }

        gPreviousOpenPositionLtps.set(positionId, currentLtp);

        if (!Number.isFinite(previousLtp) || previousLtp === currentLtp) {
            return "";
        }

        return currentLtp > previousLtp ? "rolling-demo-ltp-up" : "rolling-demo-ltp-down";
    }

    function getUiState() {
        return {
            symbol: String(ids.symbol?.value || "BTC"),
            manualFutQty: parseNumberInput(ids.manualFutQty, 1),
            manualFutOrderType: String(ids.manualFutOrderType?.value || "market_order"),
            action1: String(ids.action1?.value || "sell"),
            legSide1: String(ids.legSide1?.value || "ce"),
            expiryMode1: String(ids.expiryMode1?.value || "1"),
            expiryDate1: String(ids.expiryDate1?.value || ""),
            manualOptQty1: parseNumberInput(ids.manualOptQty1, 1),
            newDelta1: parseNumberInput(ids.newDelta1, 0.53),
            reDelta1: parseNumberInput(ids.reDelta1, 0.53),
            deltaTp1: parseNumberInput(ids.deltaTp1, 0.15),
            deltaSl1: parseNumberInput(ids.deltaSl1, 0.85),
            reEnter1: Boolean(ids.reEnter1?.checked),
            redOptQtyPct: parseNumberInput(ids.redOptQtyPct, 100),
            greenOptQtyPct: parseNumberInput(ids.greenOptQtyPct, 100),
            greenReDelta: parseNumberInput(ids.greenReDelta, 0.53),
            greenTpDelta: parseNumberInput(ids.greenTpDelta, 0.15),
            greenSlDelta: parseNumberInput(ids.greenSlDelta, 0.85),
            addOneLotFuture: Boolean(ids.addOneLotFuture?.checked),
            renkoFeedEnabled: Boolean(ids.renkoFeedEnabled?.checked),
            renkoFeedPts: parseNumberInput(ids.renkoFeedPts, 10),
            renkoFeedPriceSrc: String(ids.renkoFeedPriceSrc?.value || "spot_price"),
            optionsPnl: parseNumberInput(ids.optionsPnl, 0),
            telegramAlertsEnabled: Boolean(ids.telegramAlertsEnabled?.checked),
            telegramAlertTypes: ids.telegramEventCheckboxes
                .filter(function (objCheckbox) { return objCheckbox.checked; })
                .map(function (objCheckbox) { return String(objCheckbox.value || "").trim(); })
                .filter(Boolean),
            closedFromDate: String(ids.closedFromDate?.value || ""),
            closedToDate: String(ids.closedToDate?.value || "")
        };
    }

    function setFieldValue(fieldId, value) {
        const objField = ids[fieldId];
        if (!objField) {
            return;
        }

        if (objField.type === "checkbox") {
            objField.checked = Boolean(value);
            return;
        }

        objField.value = String(value ?? "");
    }

    function applyUiState(uiState) {
        gIsApplyingState = true;

        setFieldValue("symbol", uiState.symbol);
        setFieldValue("manualFutQty", uiState.manualFutQty);
        setFieldValue("manualFutOrderType", uiState.manualFutOrderType);
        setFieldValue("action1", uiState.action1);
        setFieldValue("legSide1", uiState.legSide1);
        setFieldValue("expiryMode1", uiState.expiryMode1);
        setFieldValue("expiryDate1", uiState.expiryDate1);
        setFieldValue("manualOptQty1", uiState.manualOptQty1);
        setFieldValue("newDelta1", uiState.newDelta1);
        setFieldValue("reDelta1", uiState.reDelta1);
        setFieldValue("deltaTp1", uiState.deltaTp1);
        setFieldValue("deltaSl1", uiState.deltaSl1);
        setFieldValue("reEnter1", uiState.reEnter1);
        setFieldValue("redOptQtyPct", uiState.redOptQtyPct);
        setFieldValue("greenOptQtyPct", uiState.greenOptQtyPct);
        setFieldValue("greenReDelta", uiState.greenReDelta);
        setFieldValue("greenTpDelta", uiState.greenTpDelta);
        setFieldValue("greenSlDelta", uiState.greenSlDelta);
        setFieldValue("addOneLotFuture", uiState.addOneLotFuture);
        setFieldValue("renkoFeedEnabled", uiState.renkoFeedEnabled);
        setFieldValue("renkoFeedPts", uiState.renkoFeedPts);
        setFieldValue("renkoFeedPriceSrc", uiState.renkoFeedPriceSrc);
        setFieldValue("optionsPnl", uiState.optionsPnl);
        setFieldValue("telegramAlertsEnabled", uiState.telegramAlertsEnabled);
        setFieldValue("closedFromDate", uiState.closedFromDate);
        setFieldValue("closedToDate", uiState.closedToDate);
        const objSelectedTelegramTypes = Array.isArray(uiState.telegramAlertTypes)
            ? uiState.telegramAlertTypes.map(function (vType) { return String(vType || "").trim(); })
            : [];
        ids.telegramEventCheckboxes.forEach(function (objCheckbox) {
            objCheckbox.checked = objSelectedTelegramTypes.includes(String(objCheckbox.value || "").trim());
        });

        applySymbolDefaults();
        applyExpiryModeDefaults();
        updateRenkoFeedVisualState();

        gIsApplyingState = false;
    }

    function applyRuntimeStatus(runtimeState) {
        gLatestRuntimeState = runtimeState || null;
        const statusText = String(runtimeState?.status || "idle").trim() || "idle";
        const autoTraderEnabled = Boolean(runtimeState?.autoTraderEnabled);
        const lastSignal = String(runtimeState?.lastSignal || "-").trim() || "-";
        const openCount = Number(runtimeState?.counts?.openPositions || 0);
        const renkoColor = String(runtimeState?.state?.renkoLastColor || "").trim().toUpperCase();

        if (ids.engineStatus) {
            ids.engineStatus.textContent = statusText.charAt(0).toUpperCase() + statusText.slice(1);
        }

        if (ids.openCount) {
            ids.openCount.textContent = String(openCount);
        }

        if (ids.autoTraderButton) {
            ids.autoTraderButton.textContent = autoTraderEnabled ? "Auto Trader - ON" : "Auto Trader - OFF";
            ids.autoTraderButton.classList.toggle("success", autoTraderEnabled);
            ids.autoTraderButton.classList.toggle("warn", !autoTraderEnabled);
        }

        if (ids.lastSignal) {
            applyRenkoSignalBox(renkoColor);
            ids.lastSignal.dataset.lastSignalText = lastSignal;
        }

        updateOneLotMetric(runtimeState);
    }

    function renderOpenPositions(rows) {
        if (!ids.openPositionsBody) {
            return;
        }

        if (!Array.isArray(rows) || rows.length === 0) {
            gLatestOpenPositions = [];
            gPreviousOpenPositionLtps = new Map();
            ids.openPositionsBody.innerHTML = "<tr><td colspan=\"15\" class=\"rolling-demo-empty\">No open paper positions found for this user.</td></tr>";
            updateTotalMarginMetric([]);
            return;
        }

        gLatestOpenPositions = rows;
        const nextLtps = new Map();
        const openRowsHtml = rows.map(function (row) {
            const tradeType = String(row.action || "-");
            const buyPrice = String(row.action || "").toUpperCase() === "BUY" ? row.entryPrice : null;
            const sellPrice = String(row.action || "").toUpperCase() === "SELL" ? row.entryPrice : null;
            const currentDelta = String(row.instrumentType || "").toUpperCase() === "OPTION"
                ? (row.exitDelta ?? row.entryDelta)
                : null;
            const positionId = String(row.positionId || "");
            const ltpBlinkClass = getLtpBlinkClass(positionId, row.markPrice);
            const currentLtp = Number(row.markPrice);
            if (positionId && Number.isFinite(currentLtp)) {
                nextLtps.set(positionId, currentLtp);
            }
            return `
                <tr>
                    <td>${escapeHtml(formatNumericValue(row.entryDelta, 2))}</td>
                    <td>${escapeHtml(formatNumericValue(currentDelta, 2))}</td>
                    <td>${escapeHtml(row.contractName || row.symbol || "-")}</td>
                    <td>${escapeHtml(tradeType || "-")}</td>
                    <td>${escapeHtml(formatNumericValue(row.lotSize, 3))}</td>
                    <td>${escapeHtml(formatNumericValue(row.qty, 0))}</td>
                    <td>${escapeHtml(formatNumericValue(buyPrice, 2))}</td>
                    <td>${escapeHtml(formatNumericValue(sellPrice, 2))}</td>
                    <td class="${ltpBlinkClass}">${escapeHtml(formatNumericValue(row.markPrice, 2))}</td>
                    <td>${escapeHtml(formatNumericValue(row.charges, 3))}</td>
                    <td>${escapeHtml(formatNumericValue(row.pnl, 3))}</td>
                    <td>${escapeHtml(formatDisplayDateTime(row.openedAt))}</td>
                    <td>${escapeHtml(formatDisplayDateTime(row.closedAt))}</td>
                    <td>${escapeHtml(row.status || "-")}</td>
                    <td>
                        <button class="rolling-demo-icon-btn primary rolling-demo-close-open-position" type="button" data-position-id="${escapeHtml(positionId)}" title="Close this open position" aria-label="Close this open position">
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="m6 6 12 12" />
                                <path d="M18 6 6 18" />
                            </svg>
                        </button>
                        <button class="rolling-demo-icon-btn warn rolling-demo-delete-open-position" type="button" data-position-id="${escapeHtml(positionId)}" title="Delete this open position permanently" aria-label="Delete this open position permanently">
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M3 6h18" />
                                <path d="M8 6V4h8v2" />
                                <path d="M19 6l-1 14H6L5 6" />
                                <path d="M10 11v6" />
                                <path d="M14 11v6" />
                            </svg>
                        </button>
                    </td>
                </tr>
            `;
        }).join("");
        const totalCharges = sumNumeric(rows, "charges");
        const totalPnl = sumNumeric(rows, "pnl");
        ids.openPositionsBody.innerHTML = `${openRowsHtml}
            <tr class="rolling-demo-total-row">
                <td colspan="9">Total</td>
                <td class="rolling-demo-total-value">${escapeHtml(formatNumericValue(totalCharges, 3))}</td>
                <td class="rolling-demo-total-value">${escapeHtml(formatNumericValue(totalPnl, 3))}</td>
                <td colspan="4">-</td>
            </tr>
        `;
        gPreviousOpenPositionLtps = nextLtps;
        updateTotalMarginMetric(rows);
    }

    function renderClosedPositions(rows) {
        if (!ids.closedPositionsBody) {
            return;
        }

        if (!Array.isArray(rows) || rows.length === 0) {
            ids.closedPositionsBody.innerHTML = "<tr><td colspan=\"10\" class=\"rolling-demo-empty\">No closed paper positions found for this user.</td></tr>";
            return;
        }

        const closedRowsHtml = rows.map(function (row) {
            const tradeType = String(row.action || "-");
            return `
                <tr>
                    <td>${escapeHtml(formatDisplayDateTime(row.openedAt))}</td>
                    <td>${escapeHtml(formatDisplayDateTime(row.closedAt))}</td>
                    <td>${escapeHtml(row.contractName || row.symbol || "-")}</td>
                    <td>${escapeHtml(tradeType || "-")}</td>
                    <td>${escapeHtml(formatNumericValue(row.lotSize, 3))}</td>
                    <td>${escapeHtml(formatNumericValue(row.qty, 0))}</td>
                    <td>${escapeHtml(formatNumericValue(row.entryPrice, 2))}</td>
                    <td>${escapeHtml(formatNumericValue(row.exitPrice, 2))}</td>
                    <td>${escapeHtml(formatNumericValue(row.charges, 3))}</td>
                    <td>${escapeHtml(formatNumericValue(row.pnl, 3))}</td>
                </tr>
            `;
        }).join("");
        const totalCharges = sumNumeric(rows, "charges");
        const totalPnl = sumNumeric(rows, "pnl");
        ids.closedPositionsBody.innerHTML = `${closedRowsHtml}
            <tr class="rolling-demo-total-row">
                <td colspan="8">Total</td>
                <td class="rolling-demo-total-value">${escapeHtml(formatNumericValue(totalCharges, 3))}</td>
                <td class="rolling-demo-total-value">${escapeHtml(formatNumericValue(totalPnl, 3))}</td>
            </tr>
        `;
    }

    function renderEvents(rows) {
        if (!ids.eventLog) {
            return;
        }

        if (!Array.isArray(rows) || rows.length === 0) {
            ids.eventLog.innerHTML = "<div class=\"rolling-demo-event-empty\">No server activity has been logged yet.</div>";
            return;
        }

        ids.eventLog.innerHTML = rows.map(function (row) {
            const vSeverity = String(row.severity || "info").trim();
            return `
                <div class="rolling-demo-event-item ${escapeHtml(vSeverity)}">
                    <div class="rolling-demo-event-head">
                        <div class="rolling-demo-event-title">${escapeHtml(row.title || row.eventType || "Event")}</div>
                        <div class="rolling-demo-event-time">${escapeHtml(formatDisplayDateTime(row.createdAt))}</div>
                    </div>
                    <div class="rolling-demo-event-message">${escapeHtml(row.message || "")}</div>
                </div>
            `;
        }).join("");
    }

    async function saveProfile() {
        const objResponse = await fetch("/api/rollingoptions-pt-de/profile", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ uiState: getUiState() })
        });

        if (!objResponse.ok) {
            throw new Error("Unable to save Rolling Options profile.");
        }
    }

    async function flushProfileSave() {
        if (gIsApplyingState) {
            return;
        }

        if (gSaveTimer) {
            clearTimeout(gSaveTimer);
            gSaveTimer = null;
        }

        await saveProfile();
    }

    function queueProfileSave() {
        if (gIsApplyingState) {
            return;
        }

        if (gSaveTimer) {
            clearTimeout(gSaveTimer);
        }

        gSaveTimer = setTimeout(function () {
            gSaveTimer = null;
            void saveProfile();
        }, 400);
    }

    async function loadProfile() {
        const objResponse = await fetch("/api/rollingoptions-pt-de/profile", {
            credentials: "same-origin"
        });
        if (!objResponse.ok) {
            throw new Error("Unable to load Rolling Options profile.");
        }
        const objPayload = await objResponse.json().catch(() => ({}));
        const objUiState = objPayload && objPayload.data && objPayload.data.uiState
            ? objPayload.data.uiState
            : {};
        applyUiState(objUiState);
    }

    async function loadStatus() {
        const objResponse = await fetch("/api/rollingoptions-pt-de/status", {
            credentials: "same-origin"
        });
        if (!objResponse.ok) {
            throw new Error("Unable to load Rolling Options status.");
        }

        const objPayload = await objResponse.json().catch(() => ({}));
        applyRuntimeStatus(objPayload?.data || {});
    }

    async function loadOpenPositions() {
        const objResponse = await fetch("/api/rollingoptions-pt-de/open-positions", {
            credentials: "same-origin"
        });
        if (!objResponse.ok) {
            throw new Error("Unable to load open paper positions.");
        }

        const objPayload = await objResponse.json().catch(() => ({}));
        renderOpenPositions(Array.isArray(objPayload?.data) ? objPayload.data : []);
    }

    async function loadClosedPositions() {
        const objSearch = new URLSearchParams();
        if (ids.closedFromDate?.value) {
            objSearch.set("fromDate", ids.closedFromDate.value);
        }
        if (ids.closedToDate?.value) {
            objSearch.set("toDate", ids.closedToDate.value);
        }

        const vQueryString = objSearch.toString();
        const objResponse = await fetch(`/api/rollingoptions-pt-de/closed-positions${vQueryString ? `?${vQueryString}` : ""}`, {
            credentials: "same-origin"
        });
        if (!objResponse.ok) {
            throw new Error("Unable to load closed paper positions.");
        }

        const objPayload = await objResponse.json().catch(() => ({}));
        renderClosedPositions(Array.isArray(objPayload?.data) ? objPayload.data : []);
    }

    async function loadEvents() {
        const objResponse = await fetch("/api/rollingoptions-pt-de/events", {
            credentials: "same-origin"
        });
        if (!objResponse.ok) {
            throw new Error("Unable to load activity log.");
        }

        const objPayload = await objResponse.json().catch(() => ({}));
        renderEvents(Array.isArray(objPayload?.data) ? objPayload.data : []);
    }

    async function loadServerPanels() {
        await Promise.all([
            loadStatus(),
            loadOpenPositions(),
            loadClosedPositions(),
            loadEvents()
        ]);
    }

    async function postJson(url, payload) {
        const objResponse = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify(payload || {})
        });

        if (!objResponse.ok) {
            throw new Error(`Request failed for ${url}`);
        }

        return objResponse.json().catch(function () {
            return {};
        });
    }

    async function runServerAction(url, payload) {
        await flushProfileSave();
        await postJson(url, payload);
        await loadServerPanels();
    }

    async function deleteOpenPosition(positionId) {
        const normalizedPositionId = String(positionId || "").trim();
        if (!normalizedPositionId) {
            return;
        }

        await runServerAction("/api/rollingoptions-pt-de/open-positions/delete", {
            positionId: normalizedPositionId
        });
    }

    async function closeOpenPosition(positionId) {
        const normalizedPositionId = String(positionId || "").trim();
        if (!normalizedPositionId) {
            return;
        }

        await runServerAction("/api/rollingoptions-pt-de/open-positions/close", {
            positionId: normalizedPositionId
        });
    }

    async function toggleManualRenkoSignal() {
        if (!ids.renkoFeedEnabled?.checked) {
            return;
        }

        const currentColor = String(gLatestRuntimeState?.state?.renkoLastColor || "").trim().toUpperCase();
        const nextColor = currentColor === "R" ? "G" : "R";
        await runServerAction("/api/rollingoptions-pt-de/renko/signal", {
            color: nextColor
        });
    }

    ids.symbol?.addEventListener("change", function () {
        applySymbolDefaults();
        updateOneLotMetric();
        queueProfileSave();
    });

    ids.expiryMode1?.addEventListener("change", function () {
        applyExpiryModeDefaults();
        if (gHasLoadedProfile) {
            queueProfileSave();
        }
    });

    ids.renkoFeedEnabled?.addEventListener("change", function () {
        updateRenkoFeedVisualState();
        queueProfileSave();
    });

    ids.lastSignal?.addEventListener("click", function () {
        void toggleManualRenkoSignal();
    });

    ids.refreshOpenPositionsButton?.addEventListener("click", function () {
        void Promise.all([loadStatus(), loadOpenPositions()]);
    });

    ids.openPositionsBody?.addEventListener("click", function (objEvent) {
        const objTarget = objEvent.target instanceof Element ? objEvent.target : null;
        const objCloseButton = objTarget?.closest(".rolling-demo-close-open-position");
        if (objCloseButton instanceof HTMLButtonElement) {
            const vClosePositionId = String(objCloseButton.dataset.positionId || "").trim();
            if (vClosePositionId) {
                void closeOpenPosition(vClosePositionId);
            }
            return;
        }

        const objButton = objTarget?.closest(".rolling-demo-delete-open-position");
        if (!(objButton instanceof HTMLButtonElement)) {
            return;
        }

        const vPositionId = String(objButton.dataset.positionId || "").trim();
        if (!vPositionId) {
            return;
        }

        void deleteOpenPosition(vPositionId);
    });

    ids.refreshEventsButton?.addEventListener("click", function () {
        void loadEvents();
    });

    ids.clearEventsButton?.addEventListener("click", function () {
        void runServerAction("/api/rollingoptions-pt-de/events/clear");
    });

    ids.autoTraderButton?.addEventListener("click", function () {
        void runServerAction("/api/rollingoptions-pt-de/auto-trader");
    });

    ids.sellFutureButton?.addEventListener("click", function () {
        void runServerAction("/api/rollingoptions-pt-de/manual/future", {
            action: "SELL"
        });
    });

    ids.buyFutureButton?.addEventListener("click", function () {
        void runServerAction("/api/rollingoptions-pt-de/manual/future", {
            action: "BUY"
        });
    });

    ids.openOptionButton?.addEventListener("click", function () {
        void runServerAction("/api/rollingoptions-pt-de/manual/option");
    });

    ids.execStrategyButton?.addEventListener("click", function () {
        void runServerAction("/api/rollingoptions-pt-de/strategy/execute");
    });

    ids.exitOptionButton?.addEventListener("click", function () {
        void runServerAction("/api/rollingoptions-pt-de/manual/exit", {
            instrumentType: "OPTION"
        });
    });

    ids.exitFutureButton?.addEventListener("click", function () {
        void runServerAction("/api/rollingoptions-pt-de/manual/exit", {
            instrumentType: "FUTURE"
        });
    });

    ids.clearOpenPositionsButton?.addEventListener("click", function () {
        void runServerAction("/api/rollingoptions-pt-de/manual/exit", {
            instrumentType: "ALL"
        });
    });

    ids.killSwitchButton?.addEventListener("click", function () {
        void runServerAction("/api/rollingoptions-pt-de/manual/exit", {
            instrumentType: "ALL"
        });
    });

    ids.clearClosedFiltersButton?.addEventListener("click", function () {
        if (ids.closedFromDate) {
            ids.closedFromDate.value = "";
        }
        if (ids.closedToDate) {
            ids.closedToDate.value = "";
        }
        queueProfileSave();
        void loadClosedPositions();
    });

    ids.clearClosedPositionsButton?.addEventListener("click", function () {
        void runServerAction("/api/rollingoptions-pt-de/closed-positions/clear");
    });

    [
        ids.manualFutQty,
        ids.manualFutOrderType,
        ids.action1,
        ids.legSide1,
        ids.expiryDate1,
        ids.manualOptQty1,
        ids.newDelta1,
        ids.reDelta1,
        ids.deltaTp1,
        ids.deltaSl1,
        ids.reEnter1,
        ids.redOptQtyPct,
        ids.greenOptQtyPct,
        ids.greenReDelta,
        ids.greenTpDelta,
        ids.greenSlDelta,
        ids.addOneLotFuture,
        ids.renkoFeedPts,
        ids.renkoFeedPriceSrc,
        ids.optionsPnl,
        ids.closedFromDate,
        ids.closedToDate
    ].forEach(function (objField) {
        objField?.addEventListener("change", queueProfileSave);
        if (objField instanceof HTMLInputElement && objField.type !== "checkbox") {
            objField.addEventListener("input", queueProfileSave);
        }
    });

    ids.telegramAlertsEnabled?.addEventListener("change", queueProfileSave);
    ids.telegramEventCheckboxes.forEach(function (objCheckbox) {
        objCheckbox.addEventListener("change", queueProfileSave);
    });

    ids.closedFromDate?.addEventListener("change", function () {
        void loadClosedPositions();
    });
    ids.closedToDate?.addEventListener("change", function () {
        void loadClosedPositions();
    });

    loadProfile().then(function () {
        gHasLoadedProfile = true;
        queueProfileSave();
        return loadServerPanels();
    }).catch(function () {
        applySymbolDefaults();
        applyExpiryModeDefaults();
        updateRenkoFeedVisualState();
    });

    setInterval(function () {
        void Promise.all([loadStatus(), loadOpenPositions(), loadClosedPositions(), loadEvents()]);
    }, 15000);
})();
