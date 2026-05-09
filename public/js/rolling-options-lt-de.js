(function () {
    const ids = {
        apiProfile: document.getElementById("ddlRollingLiveApiProfile"),
        checkConnectionButton: document.getElementById("btnRollingLiveCheckConnection"),
        connectionStatus: document.getElementById("rollingLiveConnectionStatus"),
        connectionStateValue: document.getElementById("rollingLiveConnectionStateValue"),
        lastCheckedValue: document.getElementById("rollingLiveLastCheckedValue"),
        whitelistIpValue: document.getElementById("rollingLiveWhitelistIpValue"),
        copyWhitelistIpButton: document.getElementById("btnRollingLiveCopyWhitelistIp"),
        symbol: document.getElementById("ddlRollingLiveSymbol"),
        lotSize: document.getElementById("txtRollingLiveLotSize"),
        futQty: document.getElementById("txtRollingLiveFutQty"),
        futureOrderType: document.getElementById("ddlRollingLiveOrderType"),
        oneLotValue: document.getElementById("rollingLiveOneLotValue"),
        totalBalanceValue: document.getElementById("rollingLiveTotalBalanceValue"),
        blockedMarginValue: document.getElementById("rollingLiveBlockedMarginValue"),
        availableBalanceValue: document.getElementById("rollingLiveAvailableBalanceValue"),
        healthValue: document.getElementById("rollingLiveHealthValue"),
        profileLabel: document.getElementById("rollingLiveProfileLabel"),
        openCount: document.getElementById("rollingLiveOpenCount"),
        openRenkoSignal: document.getElementById("rollingLiveOpenRenkoSignal"),
        engineStatus: document.getElementById("rollingLiveEngineStatus"),
        pageStatus: document.getElementById("rollingLivePageStatus"),
        importStatus: document.getElementById("rollingLiveImportStatus"),
        autoTraderButton: document.getElementById("btnRollingLiveAutoTrader"),
        sellFutureButton: document.getElementById("btnRollingLiveSellFuture"),
        buyFutureButton: document.getElementById("btnRollingLiveBuyFuture"),
        execStrategyButton: document.getElementById("btnRollingLiveExecStrategy"),
        openOptionButton: document.getElementById("btnRollingLiveOpenOption"),
        exitOptionButton: document.getElementById("btnRollingLiveExitOption"),
        optionAction: document.getElementById("ddlRollingLiveAction1"),
        optionLegSide: document.getElementById("ddlRollingLiveLegSide1"),
        optionExpiryMode: document.getElementById("ddlRollingLiveExpiryMode1"),
        optionExpiryDate: document.getElementById("txtRollingLiveExpiry1"),
        optionQty: document.getElementById("txtRollingLiveOptQty1"),
        optionNewDelta: document.getElementById("txtRollingLiveNewDelta1"),
        optionReEnter: document.getElementById("chkRollingLiveReEnter1"),
        redOptQtyPct: document.getElementById("txtRollingLiveRedOptQtyPct"),
        reRedDelta: document.getElementById("txtRollingLiveReRedD"),
        redTpDelta: document.getElementById("txtRollingLiveRedTp"),
        redSlDelta: document.getElementById("txtRollingLiveRedSl"),
        greenOptQtyPct: document.getElementById("txtRollingLiveGreenOptQtyPct"),
        greenReDelta: document.getElementById("txtRollingLiveReGreenD"),
        greenTpDelta: document.getElementById("txtRollingLiveGreenTp"),
        greenSlDelta: document.getElementById("txtRollingLiveGreenSl"),
        addOneLotFuture: document.getElementById("chkRollingLiveAddOneLotFuture"),
        renkoValue: document.getElementById("txtRollingLiveRenkoValue"),
        renkoBoxButton: document.getElementById("btnRollingLiveRenkoBox"),
        importButton: document.getElementById("btnRollingLiveImportPositions"),
        refreshOpenPositionsButton: document.getElementById("btnRollingLiveRefreshOpenPositions"),
        killSwitchButton: document.getElementById("btnRollingLiveKillSwitch"),
        openPositionsBody: document.getElementById("rollingLiveOpenPositionsBody"),
        closedFromDate: document.getElementById("txtRollingLiveClosedFromDate"),
        closedToDate: document.getElementById("txtRollingLiveClosedToDate"),
        clearClosedFiltersButton: document.getElementById("btnRollingLiveClearClosedFilters"),
        refreshClosedPositionsButton: document.getElementById("btnRollingLiveRefreshClosedPositions"),
        closedPositionsBody: document.getElementById("rollingLiveClosedPositionsBody"),
        closedPrevPageButton: document.getElementById("btnRollingLiveClosedPrevPage"),
        closedNextPageButton: document.getElementById("btnRollingLiveClosedNextPage"),
        closedPageInfo: document.getElementById("rollingLiveClosedPositionsPageInfo"),
        closedPageNumbers: document.getElementById("rollingLiveClosedPageNumbers"),
        refreshEventsButton: document.getElementById("btnRollingLiveRefreshEvents"),
        clearEventsButton: document.getElementById("btnRollingLiveClearEvents"),
        eventLog: document.getElementById("rollingLiveEventLog"),
        telegramEventCheckboxes: Array.from(document.querySelectorAll(".rolling-demo-telegram-event")),
        importOverlay: document.getElementById("rollingLiveImportOverlay"),
        importModal: document.getElementById("rollingLiveImportModal"),
        importList: document.getElementById("rollingLiveImportList"),
        closeImportModalButton: document.getElementById("btnRollingLiveCloseImportModal"),
        applyImportedPositionsButton: document.getElementById("btnRollingLiveApplyImportedPositions")
    };

    const symbolConfig = {
        BTC: { contractName: "BTCUSD", lotSize: 0.001 },
        ETH: { contractName: "ETHUSD", lotSize: 0.01 }
    };

    let gImportablePositions = [];
    let gDisplayedPositions = [];
    let gSelectedApiProfileId = "";
    let gConnectionState = "not_selected";
    let gConnectionPollTimer = null;
    let gRuntimeStatus = "idle";
    let gAutoTraderEnabled = false;
    let gIsApplyingState = false;
    let gSaveTimer = null;
    let gPreviousOpenPositionLtps = new Map();
    let gClosedPositions = [];
    let gClosedPositionsPage = 1;
    const gClosedPositionsPageSize = 10;
    const gFutureBrokeragePct = 0.05;
    const gOptionBrokeragePct = 0.01;
    const gBrokerageGstMultiplier = 1.18;

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
            currentDate.setDate(currentDate.getDate() + (currentDayOfWeek >= 2 ? daysToThisFriday + 7 : daysToThisFriday));
            return currentDate;
        }
        if (modeValue === "5") {
            const daysToThisFriday = (5 - currentDayOfWeek + 7) % 7;
            currentDate.setDate(currentDate.getDate() + (currentDayOfWeek >= 2 ? daysToThisFriday + 14 : daysToThisFriday + 7));
            return currentDate;
        }
        if (modeValue === "6") {
            const lastFridayOfMonth = getLastFridayOfMonth(currentDate.getFullYear(), currentDate.getMonth());
            const lastFridayOfNextMonth = getLastFridayOfMonth(currentDate.getFullYear(), currentDate.getMonth() + 1);
            return currentDate.getDate() > 15 ? lastFridayOfNextMonth : lastFridayOfMonth;
        }

        return currentDate;
    }

    function getSelectedConfig() {
        const vSymbol = String(ids.symbol?.value || "BTC").trim().toUpperCase();
        return symbolConfig[vSymbol] || symbolConfig.BTC;
    }

    function normalizeSymbolValue(value) {
        const vSymbol = String(value || "").trim().toUpperCase();
        if (vSymbol === "ETH" || vSymbol === "ETHUSD") {
            return "ETH";
        }
        return "BTC";
    }

    function fmt(value, fractionDigits) {
        const vNumber = Number(value);
        if (!Number.isFinite(vNumber)) {
            return "-";
        }
        return vNumber.toFixed(fractionDigits);
    }

    function fmtUsd(value) {
        const vNumber = Number(value);
        if (!Number.isFinite(vNumber)) {
            return "-";
        }
        return `${vNumber.toFixed(2)} USD`;
    }

    function getLtpBlinkClass(positionId, markPrice) {
        const currentLtp = Number(markPrice);
        if (!positionId || !Number.isFinite(currentLtp)) {
            return "";
        }
        const previousLtp = gPreviousOpenPositionLtps.get(positionId);
        if (!Number.isFinite(previousLtp)) {
            return "";
        }
        if (currentLtp > previousLtp) {
            return "rolling-demo-ltp-up";
        }
        if (currentLtp < previousLtp) {
            return "rolling-demo-ltp-down";
        }
        return "";
    }

    function sumNumeric(rows, key) {
        return (Array.isArray(rows) ? rows : []).reduce(function (sum, row) {
            const value = Number(row && row[key]);
            return Number.isFinite(value) ? sum + value : sum;
        }, 0);
    }

    function getLotSizeForContract(contractName) {
        const value = String(contractName || "").trim().toUpperCase();
        return value.includes("ETH") ? 0.01 : 0.001;
    }

    function estimateOpenPositionCharges(row) {
        const contractName = String(row?.contractName || "").trim();
        const lotSize = Math.max(0, getLotSizeForContract(contractName));
        const qty = Math.max(0, Number(row?.qty || 0));
        const entryPrice = Math.max(0, Number(row?.entryPrice || 0));
        if (!(lotSize > 0) || !(qty > 0) || !(entryPrice > 0)) {
            return 0;
        }
        const notional = qty * lotSize * entryPrice;
        const brokeragePct = isOptionContract(contractName) ? gOptionBrokeragePct : gFutureBrokeragePct;
        return Number((((notional * brokeragePct) / 100) * gBrokerageGstMultiplier).toFixed(4));
    }

    function calculateOpenPositionPnl(row) {
        const side = String(row?.side || "").trim().toUpperCase();
        const lotSize = Math.max(0, getLotSizeForContract(row?.contractName || ""));
        const qty = Math.max(0, Number(row?.qty || 0));
        const entryPrice = Number(row?.entryPrice || 0);
        const markPrice = Number(row?.markPrice || 0);
        if (!(lotSize > 0) || !(qty > 0) || !Number.isFinite(entryPrice) || !Number.isFinite(markPrice)) {
            return 0;
        }
        const signedMove = side === "BUY"
            ? (markPrice - entryPrice)
            : (entryPrice - markPrice);
        return Number((signedMove * qty * lotSize).toFixed(2));
    }

    function isOptionContract(contractName) {
        const value = String(contractName || "").trim().toUpperCase();
        return value.startsWith("C-") || value.startsWith("P-");
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll("\"", "&quot;")
            .replaceAll("'", "&#39;");
    }

    function setStatus(target, message, tone) {
        if (!target) {
            return;
        }

        target.textContent = String(message || "").trim();
        target.className = "rolling-live-status";
        if (!message) {
            return;
        }

        target.classList.add("show");
        if (tone) {
            target.classList.add(tone);
        }
    }

    function formatDateTime(value) {
        const objDate = value ? new Date(value) : null;
        if (!(objDate instanceof Date) || Number.isNaN(objDate.getTime())) {
            return "-";
        }

        return objDate.toLocaleString("en-IN", {
            year: "numeric",
            month: "short",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
        });
    }

    function parseNumberInput(field, fallbackValue) {
        const rawValue = field?.value;
        if (rawValue === null || rawValue === undefined || rawValue === "") {
            return fallbackValue;
        }

        const parsedValue = Number(rawValue);
        return Number.isFinite(parsedValue) ? parsedValue : fallbackValue;
    }

    function applySymbolDefaults() {
        const objConfig = getSelectedConfig();
        if (ids.lotSize) {
            ids.lotSize.value = String(objConfig.lotSize);
        }
        if (ids.oneLotValue) {
            ids.oneLotValue.textContent = "-";
        }
    }

    function applyExpiryModeDefaults(force) {
        if (!ids.optionExpiryMode || !ids.optionExpiryDate) {
            return;
        }

        if (!force && String(ids.optionExpiryDate.value || "").trim()) {
            return;
        }

        const resolvedDate = resolveExpiryDateByMode(ids.optionExpiryMode.value);
        const formattedDate = formatDateInputValue(resolvedDate);
        if (formattedDate) {
            ids.optionExpiryDate.value = formattedDate;
        }
    }

    function getUiState() {
        return {
            symbol: normalizeSymbolValue(ids.symbol?.value || "BTC"),
            manualFutQty: parseNumberInput(ids.futQty, 1),
            manualFutOrderType: String(ids.futureOrderType?.value || "market_order"),
            action1: String(ids.optionAction?.value || "sell"),
            legSide1: String(ids.optionLegSide?.value || "ce"),
            expiryMode1: String(ids.optionExpiryMode?.value || "1"),
            expiryDate1: String(ids.optionExpiryDate?.value || ""),
            manualOptQty1: parseNumberInput(ids.optionQty, 1),
            newDelta1: parseNumberInput(ids.optionNewDelta, 0.53),
            reEnter1: Boolean(ids.optionReEnter?.checked),
            redOptQtyPct: parseNumberInput(ids.redOptQtyPct, 100),
            reRedDelta: parseNumberInput(ids.reRedDelta, 0.53),
            redTpDelta: parseNumberInput(ids.redTpDelta, 0.15),
            redSlDelta: parseNumberInput(ids.redSlDelta, 0.85),
            greenOptQtyPct: parseNumberInput(ids.greenOptQtyPct, 100),
            greenReDelta: parseNumberInput(ids.greenReDelta, 0.53),
            greenTpDelta: parseNumberInput(ids.greenTpDelta, 0.15),
            greenSlDelta: parseNumberInput(ids.greenSlDelta, 0.85),
            addOneLotFuture: Boolean(ids.addOneLotFuture?.checked),
            renkoFeedPts: parseNumberInput(ids.renkoValue, 10),
            closedFromDate: String(ids.closedFromDate?.value || ""),
            closedToDate: String(ids.closedToDate?.value || ""),
            telegramAlertsEnabled: ids.telegramEventCheckboxes.some(function (objCheckbox) { return objCheckbox.checked; }),
            telegramAlertTypes: ids.telegramEventCheckboxes
                .filter(function (objCheckbox) { return objCheckbox.checked; })
                .map(function (objCheckbox) { return String(objCheckbox.value || "").trim(); })
                .filter(Boolean)
        };
    }

    function setFieldValue(field, value) {
        if (!(field instanceof HTMLInputElement) && !(field instanceof HTMLSelectElement) && !(field instanceof HTMLTextAreaElement)) {
            return;
        }

        if (field instanceof HTMLInputElement && field.type === "checkbox") {
            field.checked = Boolean(value);
            return;
        }

        field.value = String(value ?? "");
    }

    function applyUiState(uiState) {
        gIsApplyingState = true;

        setFieldValue(ids.symbol, normalizeSymbolValue(uiState.symbol));
        setFieldValue(ids.futQty, uiState.manualFutQty);
        setFieldValue(ids.futureOrderType, uiState.manualFutOrderType);
        setFieldValue(ids.optionAction, uiState.action1);
        setFieldValue(ids.optionLegSide, uiState.legSide1);
        setFieldValue(ids.optionExpiryMode, uiState.expiryMode1);
        setFieldValue(ids.optionExpiryDate, uiState.expiryDate1);
        setFieldValue(ids.optionQty, uiState.manualOptQty1);
        setFieldValue(ids.optionNewDelta, uiState.newDelta1);
        setFieldValue(ids.optionReEnter, uiState.reEnter1);
        setFieldValue(ids.redOptQtyPct, uiState.redOptQtyPct);
        setFieldValue(ids.reRedDelta, uiState.reRedDelta);
        setFieldValue(ids.redTpDelta, uiState.redTpDelta);
        setFieldValue(ids.redSlDelta, uiState.redSlDelta);
        setFieldValue(ids.greenOptQtyPct, uiState.greenOptQtyPct);
        setFieldValue(ids.greenReDelta, uiState.greenReDelta);
        setFieldValue(ids.greenTpDelta, uiState.greenTpDelta);
        setFieldValue(ids.greenSlDelta, uiState.greenSlDelta);
        setFieldValue(ids.addOneLotFuture, uiState.addOneLotFuture);
        setFieldValue(ids.renkoValue, uiState.renkoFeedPts);
        setFieldValue(ids.closedFromDate, uiState.closedFromDate);
        setFieldValue(ids.closedToDate, uiState.closedToDate);
        const arrSelectedTelegramTypes = Array.isArray(uiState.telegramAlertTypes)
            ? uiState.telegramAlertTypes.map(function (vType) { return String(vType || "").trim(); })
            : [];
        ids.telegramEventCheckboxes.forEach(function (objCheckbox) {
            objCheckbox.checked = arrSelectedTelegramTypes.includes(String(objCheckbox.value || "").trim());
        });

        applySymbolDefaults();
        applyExpiryModeDefaults(false);
        gIsApplyingState = false;
    }

    async function saveLiveProfile(payload) {
        const vProfileIdSource = payload && Object.prototype.hasOwnProperty.call(payload, "selectedApiProfileId")
            ? payload.selectedApiProfileId
            : ids.apiProfile?.value;
        const vProfileId = String(vProfileIdSource || "").trim();
        gSelectedApiProfileId = vProfileId;
        await postJson("/api/rollingoptions-lt-de/profile", {
            selectedApiProfileId: vProfileId,
            uiState: (payload && payload.uiState) || getUiState()
        });
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
            void saveLiveProfile({ uiState: getUiState() }).catch(function (_objError) {
            });
        }, 400);
    }

    async function getJson(url) {
        const objResponse = await fetch(url, { credentials: "same-origin" });
        const objResult = await objResponse.json().catch(function () { return {}; });
        if (!objResponse.ok) {
            throw new Error(String(objResult?.message || "Request failed."));
        }
        return objResult;
    }

    async function postJson(url, payload) {
        const objResponse = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify(payload || {})
        });
        const objResult = await objResponse.json().catch(function () { return {}; });
        if (!objResponse.ok) {
            throw new Error(String(objResult?.message || "Request failed."));
        }
        return objResult;
    }

    function canUseLiveActions() {
        return gConnectionState === "connected";
    }

    function setButtonsEnabled() {
        if (ids.autoTraderButton instanceof HTMLButtonElement) {
            ids.autoTraderButton.disabled = !gSelectedApiProfileId || gConnectionState !== "connected";
        }
        [
            ids.sellFutureButton,
            ids.buyFutureButton,
            ids.openOptionButton,
            ids.exitOptionButton,
            ids.importButton,
            ids.refreshOpenPositionsButton,
            ids.refreshClosedPositionsButton
        ].forEach(function (objButton) {
            if (!(objButton instanceof HTMLButtonElement)) {
                return;
            }
            objButton.disabled = !canUseLiveActions();
        });

        [
            ids.execStrategyButton
        ].forEach(function (objButton) {
            if (!(objButton instanceof HTMLButtonElement)) {
                return;
            }
            objButton.disabled = !canUseLiveActions() || !gAutoTraderEnabled;
        });

        if (ids.killSwitchButton instanceof HTMLButtonElement) {
            ids.killSwitchButton.disabled = !gSelectedApiProfileId;
        }

        if (ids.copyWhitelistIpButton instanceof HTMLButtonElement) {
            const vIp = String(ids.whitelistIpValue?.textContent || "").trim();
            ids.copyWhitelistIpButton.disabled = !vIp || vIp === "-";
        }
    }

    function applyConnectionStatus(connectionStatus) {
        const objStatus = connectionStatus || {};
        gConnectionState = String(objStatus.state || "not_selected").trim() || "not_selected";

        if (ids.connectionStateValue) {
            ids.connectionStateValue.textContent = gConnectionState.replaceAll("_", " ").toUpperCase();
        }
        if (ids.lastCheckedValue) {
            ids.lastCheckedValue.textContent = formatDateTime(objStatus.lastCheckedAt);
        }
        if (ids.whitelistIpValue) {
            ids.whitelistIpValue.textContent = String(objStatus.outboundIp || "-");
        }

        const vTone = gConnectionState === "connected"
            ? "success"
            : (gConnectionState === "not_selected" || gConnectionState === "checking"
                ? "warning"
                : "danger");
        setStatus(ids.connectionStatus, objStatus.message || "", vTone);
        setButtonsEnabled();
    }

    function applyRuntimeStatus(runtime) {
        const objRuntime = runtime || {};
        gRuntimeStatus = String(objRuntime.status || "idle").trim() || "idle";
        gAutoTraderEnabled = Boolean(objRuntime.autoTraderEnabled);
        const vRenkoRaw = String(objRuntime?.state?.renkoLastColor || "").trim().toUpperCase();
        const vRenkoColor = vRenkoRaw === "G" ? "G" : (vRenkoRaw === "R" ? "R" : "");

        if (ids.engineStatus) {
            ids.engineStatus.textContent = gRuntimeStatus.charAt(0).toUpperCase() + gRuntimeStatus.slice(1);
        }
        if (ids.renkoBoxButton instanceof HTMLButtonElement) {
            ids.renkoBoxButton.textContent = vRenkoColor || "R";
            ids.renkoBoxButton.classList.toggle("renko-red", vRenkoColor !== "G");
            ids.renkoBoxButton.classList.toggle("renko-green", vRenkoColor === "G");
        }
        if (ids.openRenkoSignal) {
            ids.openRenkoSignal.textContent = vRenkoColor ? "Renko Change Detected" : "-";
        }
        if (ids.autoTraderButton instanceof HTMLButtonElement) {
            ids.autoTraderButton.textContent = gAutoTraderEnabled ? "Auto Trader - ON" : "Auto Trader - OFF";
            ids.autoTraderButton.classList.toggle("success", gAutoTraderEnabled);
            ids.autoTraderButton.classList.toggle("warn", !gAutoTraderEnabled);
        }
        setButtonsEnabled();
    }

    async function loadApiProfiles() {
        const objResult = await getJson("/api/account/delta-api-profiles");
        const arrProfiles = Array.isArray(objResult?.data) ? objResult.data : [];
        if (!ids.apiProfile) {
            return;
        }

        ids.apiProfile.innerHTML = "<option value=\"\">Select API profile</option>" + arrProfiles.map(function (objProfile) {
            return `<option value="${escapeHtml(objProfile.profileId)}">${escapeHtml(objProfile.referenceName || objProfile.apiKey || "API Profile")}</option>`;
        }).join("");

        if (!arrProfiles.length) {
            setStatus(ids.pageStatus, "No Delta API profiles found. Add one in Delta API Settings before using this page.", "warning");
        }
    }

    async function loadLiveProfile() {
        const objResult = await getJson("/api/rollingoptions-lt-de/profile");
        const objData = objResult?.data || {};
        gSelectedApiProfileId = String(objData.selectedApiProfileId || "").trim();
        if (ids.apiProfile) {
            ids.apiProfile.value = gSelectedApiProfileId;
        }
        applyUiState(objData.uiState || {});
        applyConnectionStatus(objData.connectionStatus || {});
    }

    async function loadConnectionStatus() {
        const objResult = await getJson("/api/rollingoptions-lt-de/connection/status");
        const objData = objResult?.data || {};
        if (objData.selectedApiProfileId) {
            gSelectedApiProfileId = String(objData.selectedApiProfileId || "").trim();
            if (ids.apiProfile) {
                ids.apiProfile.value = gSelectedApiProfileId;
            }
        }
        applyConnectionStatus(objData.connectionStatus || {});
    }

    async function loadRuntimeStatus() {
        const objResult = await getJson("/api/rollingoptions-lt-de/runtime");
        applyRuntimeStatus(objResult?.data || {});
    }

    async function checkConnection() {
        const vProfileId = String(ids.apiProfile?.value || "").trim();
        gSelectedApiProfileId = vProfileId;
        const objResult = await postJson("/api/rollingoptions-lt-de/connection/check", {
            profileId: vProfileId
        });
        const objData = objResult?.data || {};
        applyConnectionStatus(objData.connectionStatus || {});
        if (objData.selectedApiProfileId) {
            gSelectedApiProfileId = String(objData.selectedApiProfileId || "").trim();
        }
        return objResult;
    }

    async function toggleAutoTrader() {
        const vUrl = gAutoTraderEnabled
            ? "/api/rollingoptions-lt-de/auto-trader/stop"
            : "/api/rollingoptions-lt-de/auto-trader/start";
        const objResult = await postJson(vUrl, {});
        applyRuntimeStatus(objResult?.data || {});
        return objResult;
    }

    function getCurrentRenkoColor() {
        return String(ids.renkoBoxButton?.textContent || "").trim().toUpperCase() === "G" ? "G" : "R";
    }

    async function executeStrategy() {
        await checkConnection();
        if (!canUseLiveActions()) {
            throw new Error("Delta connection is not healthy enough to execute the live strategy.");
        }

        const objResult = await postJson("/api/rollingoptions-lt-de/strategy/execute", {
            renkoColor: getCurrentRenkoColor()
        });
        if (objResult?.data?.runtime) {
            applyRuntimeStatus(objResult.data.runtime);
        }
        return objResult;
    }

    async function toggleRenkoBox() {
        const vCurrentColor = String(ids.renkoBoxButton?.textContent || "R").trim().toUpperCase() === "G" ? "G" : "R";
        const vNextColor = vCurrentColor === "R" ? "G" : "R";
        const objResult = await postJson("/api/rollingoptions-lt-de/renko/signal", {
            color: vNextColor
        });
        applyRuntimeStatus(objResult?.data || {});
        return objResult;
    }

    async function copyWhitelistIp() {
        const vIp = String(ids.whitelistIpValue?.textContent || "").trim();
        if (!vIp || vIp === "-") {
            throw new Error("Whitelist IP is not available yet. Run connection check first.");
        }

        if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
            await navigator.clipboard.writeText(vIp);
            return vIp;
        }

        const objInput = document.createElement("input");
        objInput.value = vIp;
        document.body.appendChild(objInput);
        objInput.select();
        objInput.setSelectionRange(0, objInput.value.length);
        const bCopied = document.execCommand("copy");
        document.body.removeChild(objInput);
        if (!bCopied) {
            throw new Error("Unable to copy whitelist IP.");
        }

        return vIp;
    }

    async function placeManualFuture(action) {
        const vAction = String(action || "").trim().toUpperCase();
        if (vAction !== "BUY" && vAction !== "SELL") {
            throw new Error("Future action must be BUY or SELL.");
        }

        await checkConnection();
        if (!canUseLiveActions()) {
            throw new Error("Delta connection is not healthy enough to place a live future order.");
        }

        const vQty = Math.max(1, Math.floor(Number(ids.futQty?.value || 1)));
        const vOrderType = String(ids.futureOrderType?.value || "market_order").trim() === "limit_order"
            ? "limit_order"
            : "market_order";
        const vSymbol = String(ids.symbol?.value || "BTC").trim().toUpperCase();

        return postJson("/api/rollingoptions-lt-de/manual/future", {
            action: vAction,
            symbol: vSymbol,
            qty: vQty,
            orderType: vOrderType
        });
    }

    async function placeManualOption(operation) {
        const vOperation = String(operation || "").trim().toLowerCase() === "exit" ? "exit" : "open";
        await checkConnection();
        if (!canUseLiveActions()) {
            throw new Error("Delta connection is not healthy enough to place a live option order.");
        }

        const vAction = String(ids.optionAction?.value || "").trim().toLowerCase();
        const vQty = Math.max(1, Math.floor(Number(ids.optionQty?.value || 1)));
        const vExpiryDate = String(ids.optionExpiryDate?.value || "").trim();
        const vLegSide = String(ids.optionLegSide?.value || "ce").trim().toLowerCase();
        const vExpiryMode = String(ids.optionExpiryMode?.value || "1").trim();
        const vTargetDelta = Math.max(0, Number(ids.optionNewDelta?.value || 0.53));
        const vSymbol = String(ids.symbol?.value || "BTC").trim().toUpperCase();

        if (vAction !== "buy" && vAction !== "sell") {
            throw new Error("Select Buy or Sell in the option row before placing a live option order.");
        }
        if (!vExpiryDate) {
            throw new Error("Select an expiry date in the option row before placing a live option order.");
        }

        return postJson("/api/rollingoptions-lt-de/manual/option", {
            operation: vOperation,
            action: vAction,
            symbol: vSymbol,
            legSide: vLegSide,
            expiryMode: vExpiryMode,
            expiryDate: vExpiryDate,
            qty: vQty,
            targetDelta: vTargetDelta
        });
    }

    async function closeImportedOpenPosition(row) {
        const objRow = row || {};
        const vImportId = String(objRow.importId || "").trim();
        const vContractName = String(objRow.contractName || "").trim();
        const vSide = String(objRow.side || "").trim().toUpperCase();
        const vQty = Math.max(1, Math.floor(Number(objRow.qty || 0)));
        if (!vImportId || !vContractName || !vSide || !(vQty > 0)) {
            throw new Error("Imported live position details are incomplete.");
        }

        await checkConnection();
        if (!canUseLiveActions()) {
            throw new Error("Delta connection is not healthy enough to close this live position.");
        }

        return postJson("/api/rollingoptions-lt-de/open-positions/close", {
            importId: vImportId,
            contractName: vContractName,
            side: vSide,
            qty: vQty
        });
    }

    function startConnectionPolling() {
        if (gConnectionPollTimer) {
            clearInterval(gConnectionPollTimer);
        }

        gConnectionPollTimer = setInterval(function () {
            if (!gSelectedApiProfileId) {
                return;
            }
            void Promise.all([
                loadConnectionStatus(),
                loadRuntimeStatus()
            ]).then(function () {
                if (!gAutoTraderEnabled) {
                    return;
                }
                return Promise.all([
                    loadSavedOpenPositions(),
                    loadAccountSummary().catch(function () { return undefined; }),
                    loadEvents().catch(function () { return undefined; })
                ]);
            }).catch(function (objError) {
                setStatus(ids.connectionStatus, objError instanceof Error ? objError.message : "Unable to load Delta connection status.", "danger");
            });
        }, 30000);
    }

    async function loadAccountSummary(symbolOverride) {
        if (!canUseLiveActions()) {
            if (ids.totalBalanceValue) {
                ids.totalBalanceValue.textContent = "-";
            }
            if (ids.blockedMarginValue) {
                ids.blockedMarginValue.textContent = "-";
            }
            if (ids.availableBalanceValue) {
                ids.availableBalanceValue.textContent = "-";
            }
            if (ids.healthValue) {
                ids.healthValue.textContent = "-";
                ids.healthValue.style.color = "";
            }
            if (ids.oneLotValue) {
                ids.oneLotValue.textContent = "-";
            }
            if (ids.profileLabel) {
                ids.profileLabel.textContent = "-";
            }
            return;
        }

        const vSymbol = String(symbolOverride || ids.symbol?.value || "").trim().toUpperCase();
        const objSearch = new URLSearchParams();
        if (vSymbol) {
            objSearch.set("symbol", vSymbol);
        }
        const objResult = await getJson(`/api/rollingoptions-lt-de/account-summary${objSearch.toString() ? `?${objSearch.toString()}` : ""}`);
        const objData = objResult?.data || {};

        if (ids.totalBalanceValue) {
            ids.totalBalanceValue.textContent = fmtUsd(objData.totalBalance);
        }
        if (ids.blockedMarginValue) {
            ids.blockedMarginValue.textContent = fmtUsd(objData.blockedMargin);
        }
        if (ids.availableBalanceValue) {
            ids.availableBalanceValue.textContent = fmtUsd(objData.availableBalance);
        }
        if (ids.oneLotValue) {
            ids.oneLotValue.textContent = Number.isFinite(Number(objData.oneLotValue))
                ? fmtUsd(objData.oneLotValue)
                : "-";
        }
        if (ids.healthValue) {
            const vHealthPct = Number(objData.healthPct);
            ids.healthValue.textContent = Number.isFinite(vHealthPct)
                ? `${fmt(objData.healthPct, 2)}%`
                : "-";
            if (Number.isFinite(vHealthPct)) {
                ids.healthValue.style.color = vHealthPct <= 100
                    ? "#198754"
                    : (vHealthPct <= 150 ? "#fd7e14" : "#dc3545");
            }
            else {
                ids.healthValue.style.color = "";
            }
        }
        if (ids.profileLabel) {
            ids.profileLabel.textContent = String(objData.profileName || "-");
        }
    }

    function renderOpenPositions(rows) {
        const arrRows = Array.isArray(rows) ? rows : [];
        gDisplayedPositions = arrRows;

        if (!ids.openPositionsBody) {
            return;
        }

        if (!arrRows.length) {
            gPreviousOpenPositionLtps = new Map();
            ids.openPositionsBody.innerHTML = "<tr><td colspan=\"14\" class=\"rolling-demo-empty\">No imported live positions are currently shown.</td></tr>";
            if (ids.openCount) {
                ids.openCount.textContent = "0";
            }
            return;
        }

        const nextLtps = new Map();
        const openRowsHtml = arrRows.map(function (row) {
            const vSide = String(row.side || "-").trim().toUpperCase();
            const vContractName = String(row.contractName || "-");
            const vLotSize = getLotSizeForContract(vContractName);
            const vImportId = String(row.importId || vContractName || "");
            const vEntryDelta = Number.isFinite(Number(row.entryDelta)) ? fmt(row.entryDelta, 2) : "-";
            const vCurrentDelta = Number.isFinite(Number(row.currentDelta)) ? fmt(row.currentDelta, 2) : "-";
            const vCharges = estimateOpenPositionCharges(row);
            const vPnl = calculateOpenPositionPnl(row);
            const vLtpBlinkClass = getLtpBlinkClass(vImportId, row.markPrice);
            const vCurrentLtp = Number(row.markPrice);
            if (vImportId && Number.isFinite(vCurrentLtp)) {
                nextLtps.set(vImportId, vCurrentLtp);
            }
            return `
                <tr>
                    <td>${escapeHtml(vEntryDelta)}</td>
                    <td>${escapeHtml(vCurrentDelta)}</td>
                    <td>${escapeHtml(vContractName)}</td>
                    <td>${escapeHtml(vSide || "-")}</td>
                    <td>${escapeHtml(fmt(vLotSize, 3))}</td>
                    <td>${escapeHtml(fmt(row.qty, 0))}</td>
                    <td>${escapeHtml(vSide === "BUY" ? fmt(row.entryPrice, 2) : "-")}</td>
                    <td>${escapeHtml(vSide === "SELL" ? fmt(row.entryPrice, 2) : "-")}</td>
                    <td class="${vLtpBlinkClass}">${escapeHtml(fmt(row.markPrice, 2))}</td>
                    <td>${escapeHtml(fmt(vCharges, 3))}</td>
                    <td>${escapeHtml(fmt(vPnl, 2))}</td>
                    <td>${escapeHtml(formatDateTime(row.openedAt))}</td>
                    <td>OPEN</td>
                    <td>
                        <button class="rolling-demo-icon-btn primary rolling-live-close-open-position" type="button" data-import-id="${escapeHtml(vImportId)}" title="Close this open position" aria-label="Close this open position">
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="m6 6 12 12" />
                                <path d="M18 6 6 18" />
                            </svg>
                        </button>
                        <button class="rolling-demo-icon-btn warn rolling-live-delete-open-position" type="button" data-import-id="${escapeHtml(vImportId)}" title="Delete this open position permanently" aria-label="Delete this open position permanently">
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
        const totalCharges = arrRows.reduce(function (sum, row) {
            return sum + estimateOpenPositionCharges(row);
        }, 0);
        const totalPnl = arrRows.reduce(function (sum, row) {
            return sum + calculateOpenPositionPnl(row);
        }, 0);
        ids.openPositionsBody.innerHTML = `${openRowsHtml}
            <tr class="rolling-demo-total-row">
                <td colspan="9">Total</td>
                <td class="rolling-demo-total-value">${escapeHtml(fmt(totalCharges, 3))}</td>
                <td class="rolling-demo-total-value">${escapeHtml(fmt(totalPnl, 3))}</td>
                <td colspan="3">-</td>
            </tr>
        `;
        gPreviousOpenPositionLtps = nextLtps;

        if (ids.openCount) {
            ids.openCount.textContent = String(arrRows.length);
        }
    }

    function renderClosedPositions(rows) {
        const arrRows = Array.isArray(rows) ? rows : [];
        const vTotalRows = arrRows.length;
        const vTotalPages = Math.max(1, Math.ceil(vTotalRows / gClosedPositionsPageSize));
        gClosedPositionsPage = Math.min(Math.max(1, gClosedPositionsPage), vTotalPages);
        const vStartIndex = (gClosedPositionsPage - 1) * gClosedPositionsPageSize;
        const arrPageRows = arrRows.slice(vStartIndex, vStartIndex + gClosedPositionsPageSize);
        if (!ids.closedPositionsBody) {
            return;
        }

        if (!arrRows.length) {
            ids.closedPositionsBody.innerHTML = "<tr><td colspan=\"10\" class=\"rolling-demo-empty\">No Delta order history found for the selected date range.</td></tr>";
            if (ids.closedPageInfo) {
                ids.closedPageInfo.textContent = "Page 0 of 0";
            }
            if (ids.closedPrevPageButton instanceof HTMLButtonElement) {
                ids.closedPrevPageButton.disabled = true;
            }
            if (ids.closedNextPageButton instanceof HTMLButtonElement) {
                ids.closedNextPageButton.disabled = true;
            }
            if (ids.closedPageNumbers) {
                ids.closedPageNumbers.innerHTML = "";
            }
            return;
        }

        const closedRowsHtml = arrPageRows.map(function (row) {
            const vContractName = String(row.symbol || "-");
            return `
                <tr>
                    <td>${escapeHtml(formatDateTime(row.startAt))}</td>
                    <td>${escapeHtml(formatDateTime(row.endAt))}</td>
                    <td>${escapeHtml(vContractName)}</td>
                    <td>${escapeHtml(row.side || row.orderType || "-")}</td>
                    <td>${escapeHtml(fmt(getLotSizeForContract(vContractName), 3))}</td>
                    <td>${escapeHtml(fmt(row.qty, 0))}</td>
                    <td>${escapeHtml(row.buyPrice === null ? "-" : fmt(row.buyPrice, 2))}</td>
                    <td>${escapeHtml(row.sellPrice === null ? "-" : fmt(row.sellPrice, 2))}</td>
                    <td>${escapeHtml(fmt(row.charges, 3))}</td>
                    <td>${escapeHtml(row.pnl === null ? "-" : fmt(row.pnl, 3))}</td>
                </tr>
            `;
        }).join("");
        const totalCharges = sumNumeric(arrRows, "charges");
        const totalPnl = arrRows.some(function (row) { return Number.isFinite(Number(row && row.pnl)); })
            ? sumNumeric(arrRows, "pnl")
            : null;
        ids.closedPositionsBody.innerHTML = `${closedRowsHtml}
            <tr class="rolling-demo-total-row">
                <td colspan="8">Total</td>
                <td class="rolling-demo-total-value">${escapeHtml(fmt(totalCharges, 3))}</td>
                <td class="rolling-demo-total-value">${escapeHtml(totalPnl === null ? "-" : fmt(totalPnl, 3))}</td>
            </tr>
        `;
        if (ids.closedPageInfo) {
            ids.closedPageInfo.textContent = `Page ${gClosedPositionsPage} of ${vTotalPages} | ${vTotalRows} records`;
        }
        if (ids.closedPrevPageButton instanceof HTMLButtonElement) {
            ids.closedPrevPageButton.disabled = gClosedPositionsPage <= 1;
        }
        if (ids.closedNextPageButton instanceof HTMLButtonElement) {
            ids.closedNextPageButton.disabled = gClosedPositionsPage >= vTotalPages;
        }
        if (ids.closedPageNumbers) {
            const vStartPage = Math.max(1, gClosedPositionsPage - 2);
            const vEndPage = Math.min(vTotalPages, vStartPage + 4);
            const vNormalizedStartPage = Math.max(1, vEndPage - 4);
            let vHtml = "";
            for (let vPage = vNormalizedStartPage; vPage <= vEndPage; vPage += 1) {
                vHtml += `<button class="rolling-demo-icon-btn ${vPage === gClosedPositionsPage ? "primary" : "warn"} rolling-live-closed-page-btn" type="button" data-page="${vPage}" title="Go to closed-positions page ${vPage}" aria-label="Go to closed-positions page ${vPage}">${escapeHtml(String(vPage))}</button>`;
            }
            ids.closedPageNumbers.innerHTML = vHtml;
        }
    }

    function renderEvents(rows) {
        if (!ids.eventLog) {
            return;
        }

        if (!Array.isArray(rows) || rows.length === 0) {
            ids.eventLog.innerHTML = "<div class=\"rolling-demo-event-empty\">No live activity has been logged yet.</div>";
            return;
        }

        ids.eventLog.innerHTML = rows.map(function (row) {
            const vSeverity = String(row.severity || "info").trim();
            return `
                <div class="rolling-demo-event-item ${escapeHtml(vSeverity)}">
                    <div class="rolling-demo-event-head">
                        <div class="rolling-demo-event-title">${escapeHtml(row.title || row.eventType || "Event")}</div>
                        <div class="rolling-demo-event-time">${escapeHtml(formatDateTime(row.createdAt))}</div>
                    </div>
                    <div class="rolling-demo-event-message">${escapeHtml(row.message || "")}</div>
                </div>
            `;
        }).join("");
    }

    function openImportModal() {
        ids.importOverlay?.classList.add("show");
        ids.importModal?.classList.add("show");
    }

    function closeImportModal() {
        ids.importOverlay?.classList.remove("show");
        ids.importModal?.classList.remove("show");
    }

    function renderImportablePositions(rows) {
        const arrRows = Array.isArray(rows) ? rows : [];
        gImportablePositions = arrRows;

        if (!ids.importList) {
            return;
        }

        if (!arrRows.length) {
            ids.importList.innerHTML = "<div class=\"rolling-demo-event-empty\">No open live positions were returned for the selected API profile.</div>";
            return;
        }

        ids.importList.innerHTML = arrRows.map(function (row, index) {
            return `
                <label class="rolling-live-import-item" for="rolling-live-import-${index}">
                    <input type="checkbox" id="rolling-live-import-${index}" value="${escapeHtml(row.importId)}" />
                    <div>
                        <div class="rolling-live-import-head">
                            <div class="rolling-live-import-title">${escapeHtml(row.contractName || "-")}</div>
                            <div>${escapeHtml(row.side || "-")}</div>
                        </div>
                        <div class="rolling-live-import-metrics">
                            <div>Qty: <strong>${escapeHtml(fmt(row.qty, 0))}</strong></div>
                            <div>Entry: <strong>${escapeHtml(fmt(row.entryPrice, 2))}</strong></div>
                            <div>Mark: <strong>${escapeHtml(fmt(row.markPrice, 2))}</strong></div>
                            <div>Margin: <strong>${escapeHtml(fmtUsd(row.margin))}</strong></div>
                            <div>PnL: <strong>${escapeHtml(fmtUsd(row.pnl))}</strong></div>
                            <div>Liq: <strong>${escapeHtml(fmt(row.liquidationPrice, 2))}</strong></div>
                        </div>
                    </div>
                </label>
            `;
        }).join("");
    }

    async function loadImportablePositions() {
        if (!canUseLiveActions()) {
            setStatus(ids.importStatus, "Delta connection is not healthy. Fix the API connection before loading live positions.", "warning");
            openImportModal();
            renderImportablePositions([]);
            return;
        }

        openImportModal();
        setStatus(ids.importStatus, "Loading open positions from Delta Exchange...", "");
        const objResult = await getJson("/api/rollingoptions-lt-de/open-positions/importable");
        const arrPositions = Array.isArray(objResult?.data?.positions) ? objResult.data.positions : [];
        renderImportablePositions(arrPositions);
        setStatus(ids.importStatus, `Loaded ${arrPositions.length} open position${arrPositions.length === 1 ? "" : "s"} from Delta Exchange.`, "success");
    }

    async function refreshImportablePositionsSilently() {
        if (!canUseLiveActions()) {
            gImportablePositions = [];
            return [];
        }

        const objResult = await getJson("/api/rollingoptions-lt-de/open-positions/importable");
        const arrPositions = Array.isArray(objResult?.data?.positions) ? objResult.data.positions : [];
        gImportablePositions = arrPositions;
        return arrPositions;
    }

    async function loadSavedOpenPositions() {
        const objResult = await getJson("/api/rollingoptions-lt-de/open-positions");
        const arrPositions = Array.isArray(objResult?.data) ? objResult.data : [];
        renderOpenPositions(arrPositions);
        return arrPositions;
    }

    async function saveOpenPositions(rows) {
        const arrRows = Array.isArray(rows) ? rows : [];
        const objResult = await postJson("/api/rollingoptions-lt-de/open-positions", {
            positions: arrRows
        });
        const arrSaved = Array.isArray(objResult?.data) ? objResult.data : [];
        renderOpenPositions(arrSaved);
        return arrSaved;
    }

    async function deleteSavedOpenPosition(importId) {
        return postJson("/api/rollingoptions-lt-de/open-positions/delete", {
            importId: String(importId || "").trim()
        });
    }

    async function reconcileOpenPositions() {
        return postJson("/api/rollingoptions-lt-de/open-positions/reconcile", {
            symbol: String(ids.symbol?.value || "BTC").trim().toUpperCase()
        });
    }

    async function runKillSwitch() {
        await checkConnection();
        if (!canUseLiveActions()) {
            throw new Error("Delta connection is not healthy enough to execute the live kill switch.");
        }
        return postJson("/api/rollingoptions-lt-de/kill-switch", {});
    }

    async function loadClosedPositions() {
        if (!canUseLiveActions()) {
            gClosedPositions = [];
            gClosedPositionsPage = 1;
            renderClosedPositions([]);
            return;
        }

        const objSearch = new URLSearchParams();
        if (ids.closedFromDate?.value) {
            objSearch.set("fromDate", ids.closedFromDate.value);
        }
        if (ids.closedToDate?.value) {
            objSearch.set("toDate", ids.closedToDate.value);
        }

        const vQuery = objSearch.toString();
        const objResult = await getJson(`/api/rollingoptions-lt-de/closed-positions${vQuery ? `?${vQuery}` : ""}`);
        gClosedPositions = Array.isArray(objResult?.data?.positions) ? objResult.data.positions : [];
        gClosedPositionsPage = 1;
        renderClosedPositions(gClosedPositions);
    }

    async function loadEvents() {
        const objResult = await getJson("/api/rollingoptions-lt-de/events");
        renderEvents(Array.isArray(objResult?.data) ? objResult.data : []);
    }

    function applyImportedPositions() {
        const arrCheckedIds = Array.from(document.querySelectorAll(".rolling-live-import-list input[type='checkbox']:checked"))
            .map(function (objNode) {
                return String(objNode instanceof HTMLInputElement ? objNode.value : "").trim();
            })
            .filter(Boolean);

        const arrSelected = gImportablePositions.filter(function (row) {
            return arrCheckedIds.includes(String(row.importId || "").trim());
        });

        void saveOpenPositions(arrSelected).then(function (arrSaved) {
            setStatus(ids.pageStatus, arrSaved.length
                ? `Imported ${arrSaved.length} live position${arrSaved.length === 1 ? "" : "s"} into the open grid.`
                : "No positions were selected for import.", arrSaved.length ? "success" : "warning");
            void loadEvents().catch(function () { return undefined; });
            closeImportModal();
        }).catch(function (objError) {
            setStatus(ids.pageStatus, objError instanceof Error ? objError.message : "Unable to save imported open positions.", "danger");
        });
    }

    ids.symbol?.addEventListener("change", function () {
        applySymbolDefaults();
        const vSymbol = String(ids.symbol?.value || "BTC").trim().toUpperCase();
        void saveLiveProfile({
            uiState: getUiState()
        }).then(function () {
            return loadAccountSummary(vSymbol).catch(function () {
                return undefined;
            });
        }).then(function () {
            return checkConnection();
        }).then(function () {
            if (!canUseLiveActions()) {
                return;
            }
            return loadAccountSummary(vSymbol);
        }).catch(function (_objError) {
        });
    });
    ids.futQty?.addEventListener("input", queueProfileSave);
    ids.futureOrderType?.addEventListener("change", queueProfileSave);
    ids.optionAction?.addEventListener("change", queueProfileSave);
    ids.optionLegSide?.addEventListener("change", queueProfileSave);
    ids.optionExpiryMode?.addEventListener("change", function () {
        applyExpiryModeDefaults(true);
        queueProfileSave();
    });
    ids.optionExpiryDate?.addEventListener("change", queueProfileSave);
    ids.optionQty?.addEventListener("input", queueProfileSave);
    ids.optionNewDelta?.addEventListener("input", queueProfileSave);
    ids.optionReEnter?.addEventListener("change", queueProfileSave);
    ids.redOptQtyPct?.addEventListener("input", queueProfileSave);
    ids.reRedDelta?.addEventListener("input", queueProfileSave);
    ids.redTpDelta?.addEventListener("input", queueProfileSave);
    ids.redSlDelta?.addEventListener("input", queueProfileSave);
    ids.greenOptQtyPct?.addEventListener("input", queueProfileSave);
    ids.greenReDelta?.addEventListener("input", queueProfileSave);
    ids.greenTpDelta?.addEventListener("input", queueProfileSave);
    ids.greenSlDelta?.addEventListener("input", queueProfileSave);
    ids.addOneLotFuture?.addEventListener("change", queueProfileSave);
    ids.renkoValue?.addEventListener("input", queueProfileSave);
    ids.apiProfile?.addEventListener("change", function () {
        void saveLiveProfile({
            selectedApiProfileId: String(ids.apiProfile?.value || "").trim(),
            uiState: getUiState()
        }).then(function () {
            return checkConnection();
        }).then(function () {
            if (!canUseLiveActions()) {
                renderClosedPositions([]);
                renderOpenPositions([]);
                return;
            }
            return Promise.all([loadAccountSummary(), loadClosedPositions()]);
        }).catch(function (objError) {
            setStatus(ids.pageStatus, objError instanceof Error ? objError.message : "Unable to load live account data.", "danger");
        });
    });
    ids.checkConnectionButton?.addEventListener("click", function () {
        void checkConnection().then(function () {
            if (!canUseLiveActions()) {
                renderClosedPositions([]);
                renderOpenPositions([]);
                return;
            }
            return Promise.all([loadAccountSummary(), loadClosedPositions()]);
        }).catch(function (objError) {
            setStatus(ids.connectionStatus, objError instanceof Error ? objError.message : "Unable to check Delta connection.", "danger");
        });
    });
    ids.autoTraderButton?.addEventListener("click", function () {
        void checkConnection().then(function () {
            if (!canUseLiveActions()) {
                throw new Error("Delta connection is not healthy enough to change live auto trader state.");
            }
            return toggleAutoTrader();
        }).then(function () {
            return Promise.all([loadRuntimeStatus(), loadAccountSummary(), loadClosedPositions()]);
        }).then(function () {
            setStatus(ids.pageStatus, gAutoTraderEnabled ? "Live auto trader enabled." : "Live auto trader disabled.", "success");
        }).catch(function (objError) {
            setStatus(ids.pageStatus, objError instanceof Error ? objError.message : "Unable to change live auto trader state.", "danger");
        });
    });
    ids.sellFutureButton?.addEventListener("click", function () {
        void placeManualFuture("SELL").then(function (objResult) {
            const objData = objResult?.data || {};
            const objOrder = objData.order || {};
            const arrTracked = Array.isArray(objData.trackedOpenPositions) ? objData.trackedOpenPositions : null;
            const vOrderId = String(objOrder.id || objOrder.order_id || "").trim();
            const vMessage = objResult?.message || "SELL future live order placed.";
            if (arrTracked) {
                renderOpenPositions(arrTracked);
            }
            setStatus(ids.pageStatus, vOrderId ? `${vMessage} Order ID: ${vOrderId}` : vMessage, "success");
            return Promise.all([loadAccountSummary(), loadConnectionStatus(), loadEvents().catch(function () { return undefined; })]);
        }).catch(function (objError) {
            setStatus(ids.pageStatus, objError instanceof Error ? objError.message : "Unable to place SELL FUT order.", "danger");
        });
    });
    ids.buyFutureButton?.addEventListener("click", function () {
        void placeManualFuture("BUY").then(function (objResult) {
            const objData = objResult?.data || {};
            const objOrder = objData.order || {};
            const arrTracked = Array.isArray(objData.trackedOpenPositions) ? objData.trackedOpenPositions : null;
            const vOrderId = String(objOrder.id || objOrder.order_id || "").trim();
            const vMessage = objResult?.message || "BUY future live order placed.";
            if (arrTracked) {
                renderOpenPositions(arrTracked);
            }
            setStatus(ids.pageStatus, vOrderId ? `${vMessage} Order ID: ${vOrderId}` : vMessage, "success");
            return Promise.all([loadAccountSummary(), loadConnectionStatus(), loadEvents().catch(function () { return undefined; })]);
        }).catch(function (objError) {
            setStatus(ids.pageStatus, objError instanceof Error ? objError.message : "Unable to place BUY FUT order.", "danger");
        });
    });
    ids.openOptionButton?.addEventListener("click", function () {
        void placeManualOption("open").then(function (objResult) {
            const arrContracts = Array.isArray(objResult?.data?.contracts) ? objResult.data.contracts : [];
            const arrTracked = Array.isArray(objResult?.data?.trackedOpenPositions) ? objResult.data.trackedOpenPositions : null;
            const vContracts = arrContracts.map(function (objRow) {
                return String(objRow?.contractSymbol || "").trim();
            }).filter(Boolean).join(", ");
            const vMessage = objResult?.message || "Open option live order placed.";
            if (arrTracked) {
                renderOpenPositions(arrTracked);
            }
            setStatus(ids.pageStatus, vContracts ? `${vMessage} ${vContracts}` : vMessage, "success");
            return Promise.all([loadAccountSummary(), loadConnectionStatus(), loadEvents().catch(function () { return undefined; })]);
        }).catch(function (objError) {
            setStatus(ids.pageStatus, objError instanceof Error ? objError.message : "Unable to place OPEN OPTION order.", "danger");
        });
    });
    ids.exitOptionButton?.addEventListener("click", function () {
        void placeManualOption("exit").then(function (objResult) {
            const arrContracts = Array.isArray(objResult?.data?.contracts) ? objResult.data.contracts : [];
            const arrTracked = Array.isArray(objResult?.data?.trackedOpenPositions) ? objResult.data.trackedOpenPositions : null;
            const vContracts = arrContracts.map(function (objRow) {
                return String(objRow?.contractSymbol || "").trim();
            }).filter(Boolean).join(", ");
            const vMessage = objResult?.message || "Exit option live order placed.";
            if (arrTracked) {
                renderOpenPositions(arrTracked);
            }
            setStatus(ids.pageStatus, vContracts ? `${vMessage} ${vContracts}` : vMessage, "success");
            return Promise.all([loadAccountSummary(), loadConnectionStatus(), loadEvents().catch(function () { return undefined; })]);
        }).catch(function (objError) {
            setStatus(ids.pageStatus, objError instanceof Error ? objError.message : "Unable to place EXIT OPTION order.", "danger");
        });
    });
    ids.importButton?.addEventListener("click", function () {
        void loadImportablePositions().catch(function (objError) {
            setStatus(ids.importStatus, objError instanceof Error ? objError.message : "Unable to load open positions.", "danger");
        });
    });
    ids.refreshOpenPositionsButton?.addEventListener("click", function () {
        void reconcileOpenPositions().then(function (objResult) {
            const arrPositions = Array.isArray(objResult?.data) ? objResult.data : [];
            renderOpenPositions(arrPositions);
            void loadEvents().catch(function () { return undefined; });
            setStatus(ids.pageStatus, objResult?.message || "Open positions reconciled with Delta Exchange.", "success");
        }).catch(function (objError) {
            setStatus(ids.pageStatus, objError instanceof Error ? objError.message : "Unable to refresh open positions.", "danger");
        });
    });
    ids.refreshClosedPositionsButton?.addEventListener("click", function () {
        void loadClosedPositions().then(function () {
            setStatus(ids.pageStatus, "Closed-position history refreshed.", "success");
        }).catch(function (objError) {
            setStatus(ids.pageStatus, objError instanceof Error ? objError.message : "Unable to load closed positions.", "danger");
        });
    });
    ids.closedPrevPageButton?.addEventListener("click", function () {
        if (gClosedPositionsPage <= 1) {
            return;
        }
        gClosedPositionsPage -= 1;
        renderClosedPositions(gClosedPositions);
    });
    ids.closedNextPageButton?.addEventListener("click", function () {
        const vTotalPages = Math.max(1, Math.ceil(gClosedPositions.length / gClosedPositionsPageSize));
        if (gClosedPositionsPage >= vTotalPages) {
            return;
        }
        gClosedPositionsPage += 1;
        renderClosedPositions(gClosedPositions);
    });
    ids.closedPageNumbers?.addEventListener("click", function (objEvent) {
        const objTarget = objEvent.target instanceof Element
            ? objEvent.target.closest(".rolling-live-closed-page-btn")
            : null;
        if (!(objTarget instanceof HTMLButtonElement)) {
            return;
        }
        const vPage = Number(objTarget.dataset.page || 0);
        if (!Number.isFinite(vPage) || vPage <= 0) {
            return;
        }
        gClosedPositionsPage = vPage;
        renderClosedPositions(gClosedPositions);
    });
    ids.clearClosedFiltersButton?.addEventListener("click", function () {
        if (ids.closedFromDate) {
            ids.closedFromDate.value = "";
        }
        if (ids.closedToDate) {
            ids.closedToDate.value = "";
        }
        queueProfileSave();
        void loadClosedPositions().then(function () {
            setStatus(ids.pageStatus, "Closed-position filters cleared.", "success");
        }).catch(function (objError) {
            setStatus(ids.pageStatus, objError instanceof Error ? objError.message : "Unable to clear closed-position filters.", "danger");
        });
    });
    ids.closedFromDate?.addEventListener("change", function () {
        queueProfileSave();
        void loadClosedPositions().catch(function (objError) {
            setStatus(ids.pageStatus, objError instanceof Error ? objError.message : "Unable to filter closed positions.", "danger");
        });
    });
    ids.closedToDate?.addEventListener("change", function () {
        queueProfileSave();
        void loadClosedPositions().catch(function (objError) {
            setStatus(ids.pageStatus, objError instanceof Error ? objError.message : "Unable to filter closed positions.", "danger");
        });
    });
    ids.refreshEventsButton?.addEventListener("click", function () {
        void loadEvents().catch(function (objError) {
            setStatus(ids.pageStatus, objError instanceof Error ? objError.message : "Unable to refresh activity log.", "danger");
        });
    });
    ids.clearEventsButton?.addEventListener("click", function () {
        void postJson("/api/rollingoptions-lt-de/events/clear", {}).then(function (objResult) {
            renderEvents([]);
            setStatus(ids.pageStatus, objResult?.message || "Live activity log cleared.", "success");
        }).catch(function (objError) {
            setStatus(ids.pageStatus, objError instanceof Error ? objError.message : "Unable to clear activity log.", "danger");
        });
    });
    ids.renkoBoxButton?.addEventListener("click", function () {
        void toggleRenkoBox().then(function (objResult) {
            setStatus(ids.pageStatus, objResult?.message || "Renko box color toggled.", "success");
            return loadEvents().catch(function () { return undefined; });
        }).catch(function (objError) {
            setStatus(ids.pageStatus, objError instanceof Error ? objError.message : "Unable to toggle Renko box.", "danger");
        });
    });
    ids.copyWhitelistIpButton?.addEventListener("click", function () {
        void copyWhitelistIp().then(function (vIp) {
            setStatus(ids.pageStatus, `Whitelist IP copied: ${vIp}`, "success");
        }).catch(function (objError) {
            setStatus(ids.pageStatus, objError instanceof Error ? objError.message : "Unable to copy whitelist IP.", "warning");
        });
    });
    ids.importOverlay?.addEventListener("click", closeImportModal);
    ids.closeImportModalButton?.addEventListener("click", closeImportModal);
    ids.applyImportedPositionsButton?.addEventListener("click", applyImportedPositions);
    ids.telegramEventCheckboxes.forEach(function (objCheckbox) {
        objCheckbox.addEventListener("change", queueProfileSave);
    });
    ids.openPositionsBody?.addEventListener("click", function (event) {
        const objTarget = event.target instanceof Element ? event.target : null;
        const objCloseButton = objTarget ? objTarget.closest(".rolling-live-close-open-position") : null;
        if (objCloseButton instanceof HTMLButtonElement) {
            const vImportId = String(objCloseButton.dataset.importId || "").trim();
            const objRow = gDisplayedPositions.find(function (row) {
                return String(row?.importId || "").trim() === vImportId;
            });
            if (!objRow) {
                setStatus(ids.pageStatus, "Unable to find the selected imported live position.", "danger");
                return;
            }

            const bConfirmed = window.confirm(`Close ${objRow.contractName || "this position"} on Delta Exchange now?`);
            if (!bConfirmed) {
                return;
            }

            void closeImportedOpenPosition(objRow).then(function (objResult) {
                const objData = objResult?.data || {};
                const objOrder = objData.order || {};
                const vOrderId = String(objOrder.id || objOrder.order_id || "").trim();
                const vMessage = objResult?.message || "Live close order placed on Delta Exchange.";
                setStatus(ids.pageStatus, vOrderId ? `${vMessage} Order ID: ${vOrderId}` : vMessage, "success");
                const arrRemaining = gDisplayedPositions.filter(function (row) {
                    return String(row?.importId || "").trim() !== vImportId;
                });
                renderOpenPositions(arrRemaining);
                return Promise.all([loadAccountSummary(), loadConnectionStatus(), refreshImportablePositionsSilently().catch(function () { return undefined; }), loadEvents().catch(function () { return undefined; })]);
            }).catch(function (objError) {
                setStatus(ids.pageStatus, objError instanceof Error ? objError.message : "Unable to close imported live position.", "danger");
            });
            return;
        }

        const objDeleteButton = objTarget ? objTarget.closest(".rolling-live-delete-open-position") : null;
        if (objDeleteButton instanceof HTMLButtonElement) {
            const vImportId = String(objDeleteButton.dataset.importId || "").trim();
            const arrRemaining = gDisplayedPositions.filter(function (row) {
                return String(row?.importId || "").trim() !== vImportId;
            });
            void deleteSavedOpenPosition(vImportId).then(function () {
                renderOpenPositions(arrRemaining);
                void loadEvents().catch(function () { return undefined; });
                setStatus(ids.pageStatus, "Position removed from the Open Positions section only. No Delta Exchange order was placed.", "success");
            }).catch(function (objError) {
                setStatus(ids.pageStatus, objError instanceof Error ? objError.message : "Unable to remove imported open position.", "danger");
            });
        }
    });

    ids.execStrategyButton?.addEventListener("click", function () {
        void executeStrategy().then(function (objResult) {
            const objData = objResult?.data || {};
            const arrTracked = Array.isArray(objData.trackedOpenPositions) ? objData.trackedOpenPositions : null;
            if (arrTracked) {
                renderOpenPositions(arrTracked);
            }
            setStatus(ids.pageStatus, objResult?.message || "Live strategy executed.", "success");
            return Promise.all([
                loadRuntimeStatus(),
                loadSavedOpenPositions(),
                loadAccountSummary().catch(function () { return undefined; }),
                loadConnectionStatus(),
                loadEvents().catch(function () { return undefined; })
            ]);
        }).catch(function (objError) {
            setStatus(ids.pageStatus, objError instanceof Error ? objError.message : "Unable to execute live strategy.", "danger");
        });
    });
    ids.killSwitchButton?.addEventListener("click", function () {
        const bConfirmed = window.confirm("Kill switch will stop auto trader and place reduce-only market close orders for all saved live open positions. Continue?");
        if (!bConfirmed) {
            return;
        }

        void runKillSwitch().then(function (objResult) {
            const objData = objResult?.data || {};
            if (objData.runtime) {
                applyRuntimeStatus(objData.runtime);
            }
            renderOpenPositions([]);
            setStatus(ids.pageStatus, objResult?.message || "Live kill switch completed.", "success");
            return Promise.all([
                loadRuntimeStatus(),
                loadAccountSummary().catch(function () { return undefined; }),
                loadConnectionStatus(),
                loadEvents().catch(function () { return undefined; }),
                loadClosedPositions().catch(function () { return undefined; })
            ]);
        }).catch(function (objError) {
            setStatus(ids.pageStatus, objError instanceof Error ? objError.message : "Unable to execute live kill switch.", "danger");
        });
    });

    applySymbolDefaults();
    applyExpiryModeDefaults(true);
    setButtonsEnabled();
    if (ids.engineStatus) {
        ids.engineStatus.textContent = "Idle";
    }

    void loadApiProfiles().then(function () {
        return loadLiveProfile();
    }).then(function () {
        return loadRuntimeStatus();
    }).then(function () {
        return loadSavedOpenPositions().catch(function () { return []; });
    }).then(function () {
        return loadEvents().catch(function () { return []; });
    }).then(function () {
        if (!gSelectedApiProfileId) {
            return;
        }
        return checkConnection().then(function () {
            if (!canUseLiveActions()) {
                return;
            }
            return Promise.all([loadAccountSummary(), loadClosedPositions(), loadEvents()]);
        });
    }).catch(function (objError) {
        setStatus(ids.pageStatus, objError instanceof Error ? objError.message : "Unable to load Delta API profiles.", "danger");
    });

    startConnectionPolling();
})();
