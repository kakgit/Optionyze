(function () {
    const rawMode = String(document.body?.dataset?.rollingFuturesLive || "").trim().toLowerCase();
    const mode = rawMode === "short" || rawMode === "dual" ? rawMode : "long";
    const prefix = mode === "short"
        ? "rollingShortFutures"
        : (mode === "dual" ? "rollingDualFutures" : "rollingLongFutures");
    const idPrefix = mode === "short"
        ? "RollingShortFutures"
        : (mode === "dual" ? "RollingDualFutures" : "RollingLongFutures");
    const endpointBase = mode === "short"
        ? "/api/rollingfutures-lt-short"
        : (mode === "dual" ? "/api/rollingfutures-lt-dual" : "/api/rollingfutures-lt-long");
    const modeLabel = mode === "short" ? "Short Mode" : (mode === "dual" ? "Dual Mode" : "Long Mode");
    const symbolConfig = {
        BTC: { contractName: "BTCUSD", lotSize: 0.001 },
        ETH: { contractName: "ETHUSD", lotSize: 0.01 }
    };

    const ids = {
        apiProfile: document.getElementById(`ddl${idPrefix}ApiProfile`),
        checkConnectionButton: document.getElementById(`btn${idPrefix}CheckConnection`),
        connectionStatus: document.getElementById(`${prefix}ConnectionStatus`),
        connectionStateValue: document.getElementById(`${prefix}ConnectionStateValue`),
        lastCheckedValue: document.getElementById(`${prefix}LastCheckedValue`),
        whitelistIpValue: document.getElementById(`${prefix}WhitelistIpValue`),
        copyWhitelistIpButton: document.getElementById(`btn${idPrefix}CopyWhitelistIp`),
        oneLotValue: document.getElementById(`${prefix}OneLotValue`),
        totalBalanceValue: document.getElementById(`${prefix}TotalBalanceValue`),
        blockedMarginValue: document.getElementById(`${prefix}BlockedMarginValue`),
        availableBalanceValue: document.getElementById(`${prefix}AvailableBalanceValue`),
        healthValue: document.getElementById(`${prefix}HealthValue`),
        profileLabel: document.getElementById(`${prefix}ProfileLabel`),
        openCount: document.getElementById(`${prefix}OpenCount`),
        engineStatus: document.getElementById(`${prefix}EngineStatus`),
        openRenkoSignal: document.getElementById(`${prefix}OpenRenkoSignal`),
        autoTraderButton: document.getElementById("btnRollingFuturesDemoAutoTrader"),
        pageStatus: document.getElementById(`${prefix}PageStatus`),
        importStatus: document.getElementById(`${prefix}ImportStatus`),
        resetDefaultsButton: document.getElementById("btnRollingFuturesResetDefaults"),
        startQty: document.getElementById("txtRollingFuturesStartQty"),
        symbol: document.getElementById("ddlRollingFuturesSymbol"),
        lotSize: document.getElementById("txtRollingFuturesLotSize"),
        futureOrderType: document.getElementById("ddlRollingFuturesOrderType"),
        sellFutureButton: document.getElementById("btnRollingFuturesSellFuture"),
        buyFutureButton: document.getElementById("btnRollingFuturesBuyFuture"),
        sellPeButton: document.getElementById("btnRollingFuturesSellPe"),
        sellCeButton: document.getElementById("btnRollingFuturesSellCe"),
        buyCeButton: document.getElementById("btnRollingFuturesBuyCe"),
        buyPeButton: document.getElementById("btnRollingFuturesBuyPe"),
        execStrategyButton: document.getElementById("btnRollingFuturesExecAllLegs"),
        bsFutQty: document.getElementById("txtRollingFuturesBsQty"),
        minusDelta: document.getElementById("txtRollingFuturesMinusDelta"),
        plusDelta: document.getElementById("txtRollingFuturesPlusDelta"),
        action1: document.getElementById("ddlRollingFuturesAction1"),
        legs1: document.getElementById("ddlRollingFuturesLegs1"),
        onlyDeltaNeutral: document.getElementById("chkRollingFuturesOnlyDeltaNeutral"),
        rangeDeltaNeutral: document.getElementById("chkRollingFuturesRangeDeltaNeutral"),
        gammaAwareNeutral: document.getElementById("chkRollingFuturesGammaAwareNeutral"),
        deltaNeutralTotalDelta: document.getElementById("spnRollingFuturesDeltaNeutralTotalDelta"),
        deltaNeutralRange: document.getElementById("spnRollingFuturesDeltaNeutralRange"),
        deltaNeutralBalance: document.getElementById("spnRollingFuturesDeltaNeutralBalance"),
        deltaBadgesGroup: document.getElementById("rollingFuturesDeltaBadgesGroup"),
        neutralBadgesRow: document.getElementById(`${prefix}NeutralBadges`),
        optionExpiryMode: document.getElementById("ddlRollingFuturesExpiryType1"),
        optionExpiryDate: document.getElementById("txtRollingFuturesExpiry1"),
        qty1: document.getElementById("txtRollingFuturesQty1"),
        newD1: document.getElementById("txtRollingFuturesNewD1"),
        reD1: document.getElementById("txtRollingFuturesReD1"),
        tpD1: document.getElementById("txtRollingFuturesTpD1"),
        slD1: document.getElementById("txtRollingFuturesSlD1"),
        reEnter1: document.getElementById("chkRollingFuturesReEnter1"),
        closeNetProfitBrokerage: document.getElementById("chkRollingFuturesCloseNetProfitBrokerage"),
        brokerageMultiplier: document.getElementById("txtRollingFuturesBrokerageMultiplier"),
        brok2Rec: document.getElementById("txtRollingFuturesBrok2Rec"),
        yet2Recover: document.getElementById("txtRollingFuturesYet2Recover"),
        netPl: document.getElementById("divRollingFuturesNetPl"),
        reEnterBrok: document.getElementById("chkRollingFuturesReEnterBrok"),
        closeBlockedMargin: document.getElementById("chkRollingFuturesCloseBlockedMargin"),
        blockedMarginPct: document.getElementById("txtRollingFuturesBlockedMarginPct"),
        reEnterBlock: document.getElementById("chkRollingFuturesReEnterBlock"),
        importButton: document.getElementById(`btn${idPrefix}ImportPositions`),
        refreshOpenPositionsButton: document.getElementById(`btn${idPrefix}RefreshOpenPositions`),
        killSwitchButton: document.getElementById(`btn${idPrefix}KillSwitch`),
        openPositionsBody: document.getElementById(`${prefix}OpenPositionsBody`),
        closedFromDate: document.getElementById(`txt${idPrefix}ClosedFromDate`),
        closedToDate: document.getElementById(`txt${idPrefix}ClosedToDate`),
        clearClosedFiltersButton: document.getElementById(`btn${idPrefix}ClearClosedFilters`),
        refreshClosedPositionsButton: document.getElementById(`btn${idPrefix}RefreshClosedPositions`),
        closedPositionsBody: document.getElementById(`${prefix}ClosedPositionsBody`),
        closedPrevPageButton: document.getElementById(`btn${idPrefix}ClosedPrevPage`),
        closedNextPageButton: document.getElementById(`btn${idPrefix}ClosedNextPage`),
        closedPageInfo: document.getElementById(`${prefix}ClosedPositionsPageInfo`),
        closedPageNumbers: document.getElementById(`${prefix}ClosedPageNumbers`),
        refreshEventsButton: document.getElementById(`btn${idPrefix}RefreshEvents`),
        clearEventsButton: document.getElementById(`btn${idPrefix}ClearEvents`),
        eventLog: document.getElementById(`${prefix}EventLog`),
        telegramEventCheckboxes: Array.from(document.querySelectorAll(".rolling-demo-telegram-event")),
        importOverlay: document.getElementById(`${prefix}ImportOverlay`),
        importModal: document.getElementById(`${prefix}ImportModal`),
        importList: document.getElementById(`${prefix}ImportList`),
        closeImportModalButton: document.getElementById(`btn${idPrefix}CloseImportModal`),
        applyImportedPositionsButton: document.getElementById(`btn${idPrefix}ApplyImportedPositions`)
    };

    let selectedApiProfileId = "";
    let connectionState = "not_selected";
    let displayedPositions = [];
    let importablePositions = [];
    let closedPositions = [];
    let closedPositionsPage = 1;
    let connectionPollTimer = null;
    let isApplyingState = false;
    let saveTimer = null;
    let previousOpenPositionLtps = new Map();
    let runtimeStatus = "idle";
    let autoTraderEnabled = false;
    let manualFutureOrderInFlight = false;
    let manualOptionOrderInFlight = false;
    let execStrategyInFlight = false;
    let lastNeutralStatus = null;
    const closedPositionsPageSize = 10;

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll("\"", "&quot;")
            .replaceAll("'", "&#39;");
    }

    function fmt(value, digits) {
        const vNumber = Number(value);
        return Number.isFinite(vNumber) ? vNumber.toFixed(digits) : "-";
    }

    function fmtUsd(value) {
        const vNumber = Number(value);
        return Number.isFinite(vNumber) ? `${vNumber.toFixed(2)} USD` : "-";
    }

    function formatDateDisplay(value) {
        const objDate = new Date(String(value || ""));
        if (Number.isNaN(objDate.getTime())) {
            return "-";
        }
        const day = String(objDate.getDate()).padStart(2, "0");
        const month = String(objDate.getMonth() + 1).padStart(2, "0");
        const year = String(objDate.getFullYear());
        return `${day}-${month}-${year}`;
    }

    function formatDateTimeDisplay(value) {
        const objDate = new Date(String(value || ""));
        if (Number.isNaN(objDate.getTime())) {
            return "-";
        }
        const dateValue = formatDateDisplay(value);
        const timeValue = objDate.toLocaleTimeString();
        return `${dateValue} ${timeValue}`;
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

    function applyBadgeTone(node, tone) {
        if (!node) {
            return;
        }
        node.className = "rolling-futures-badge";
        if (tone === "success" || tone === "danger" || tone === "warning") {
            node.classList.add(tone);
        }
    }

    function getInputValue(node, fallbackValue) {
        return node instanceof HTMLInputElement || node instanceof HTMLSelectElement
            ? String(node.value || "").trim()
            : String(fallbackValue || "").trim();
    }

    function getCheckboxValue(node, fallbackValue) {
        return node instanceof HTMLInputElement ? node.checked : Boolean(fallbackValue);
    }

    function setInputValue(node, value) {
        if (node instanceof HTMLInputElement || node instanceof HTMLSelectElement) {
            node.value = String(value ?? "");
        }
    }

    function setCheckboxValue(node, value) {
        if (node instanceof HTMLInputElement) {
            node.checked = Boolean(value);
        }
    }

    function getDefaultUiState() {
        const isLong = mode === "long";
        const isDual = mode === "dual";
        return {
            startQty: "1",
            symbol: "BTC",
            manualFutOrderType: "market_order",
            bsFutQty: "1",
            minusDelta: isDual ? "-10" : "-15",
            plusDelta: isDual ? "10" : "20",
            action1: "sell",
            legs1: mode === "dual" ? "both" : (mode === "short" ? "pe" : "ce"),
            onlyDeltaNeutral: false,
            rangeDeltaNeutral: false,
            gammaAwareNeutral: false,
            expiryMode1: isDual ? "6" : "5",
            expiryDate1: "",
            qty1: "1",
            newD1: isDual ? "0.25" : (isLong ? "0.65" : "0.65"),
            reD1: isDual ? "0.25" : (isLong ? "0.65" : "0.65"),
            tpD1: isDual ? "0.12" : (isLong ? "0.30" : "0.30"),
            slD1: isDual ? "0.50" : (isLong ? "0.80" : "0.80"),
            reEnter1: true,
            closeNetProfitBrokerage: true,
            brokerageMultiplier: isDual ? "10" : "10",
            reEnterBrok: true,
            closeBlockedMargin: true,
            blockedMarginPct: "10",
            reEnterBlock: true,
            onlyDeltaNeutral: true,
            rangeDeltaNeutral: false,
            gammaAwareNeutral: false,
            telegramAlertTypes: [],
            closedFromDate: "",
            closedToDate: ""
        };
    }

    function getLastFridayOfMonth(yearValue, monthIndex) {
        const dateValue = new Date(yearValue, monthIndex + 1, 0);
        while (dateValue.getDay() !== 5) {
            dateValue.setDate(dateValue.getDate() - 1);
        }
        return dateValue;
    }

    function getFutureFriday(baseDate, fridayOffset) {
        const currentDayOfWeek = baseDate.getDay();
        const daysToThisFriday = (5 - currentDayOfWeek + 7) % 7;
        const dateValue = new Date(baseDate);
        dateValue.setDate(baseDate.getDate() + daysToThisFriday + (fridayOffset * 7));
        return dateValue;
    }

    function resolveExpiryDateByMode(expiryMode) {
        const modeValue = String(expiryMode || "").trim();
        const currentDate = new Date();

        if (modeValue === "1") {
            currentDate.setDate(currentDate.getDate() + 1);
            return currentDate;
        }
        if (modeValue === "2") {
            currentDate.setDate(currentDate.getDate() + 2);
            return currentDate;
        }
        if (modeValue === "4") {
            return getFutureFriday(currentDate, currentDate.getDay() >= 1 ? 1 : 0);
        }
        if (modeValue === "5") {
            const biWeeklyCandidate = getFutureFriday(currentDate, 1);
            const msPerDay = 24 * 60 * 60 * 1000;
            const daysToCandidate = Math.floor((biWeeklyCandidate.getTime() - currentDate.getTime()) / msPerDay);
            return daysToCandidate <= 7 ? getFutureFriday(currentDate, 2) : biWeeklyCandidate;
        }
        if (modeValue === "6") {
            const lastFridayOfMonth = getLastFridayOfMonth(currentDate.getFullYear(), currentDate.getMonth());
            const lastFridayOfNextMonth = getLastFridayOfMonth(currentDate.getFullYear(), currentDate.getMonth() + 1);
            const msPerDay = 24 * 60 * 60 * 1000;
            const daysToCandidate = Math.floor((lastFridayOfMonth.getTime() - currentDate.getTime()) / msPerDay);
            return daysToCandidate <= 14 ? lastFridayOfNextMonth : lastFridayOfMonth;
        }
        if (modeValue === "7") {
            const lastFridayOfNextMonth = getLastFridayOfMonth(currentDate.getFullYear(), currentDate.getMonth() + 1);
            const lastFridayOfThirdMonth = getLastFridayOfMonth(currentDate.getFullYear(), currentDate.getMonth() + 2);
            const msPerDay = 24 * 60 * 60 * 1000;
            const daysToCandidate = Math.floor((lastFridayOfNextMonth.getTime() - currentDate.getTime()) / msPerDay);
            return daysToCandidate <= 30 ? lastFridayOfThirdMonth : lastFridayOfNextMonth;
        }

        return currentDate;
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

    async function getJson(url) {
        const objResponse = await fetch(url, { credentials: "same-origin" });
        const objPayload = await objResponse.json().catch(function () { return {}; });
        if (!objResponse.ok) {
            throw new Error(String(objPayload?.message || `Request failed with status ${objResponse.status}`));
        }
        return objPayload;
    }

    async function postJson(url, payload) {
        const objResponse = await fetch(url, {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload || {})
        });
        const objPayload = await objResponse.json().catch(function () { return {}; });
        if (!objResponse.ok) {
            throw new Error(String(objPayload?.message || `Request failed with status ${objResponse.status}`));
        }
        return objPayload;
    }

    function getSelectedConfig() {
        const symbol = String(ids.symbol?.value || "BTC").trim().toUpperCase();
        return symbolConfig[symbol] || symbolConfig.BTC;
    }

    function applySymbolDefaults() {
        const objConfig = getSelectedConfig();
        if (ids.lotSize instanceof HTMLInputElement) {
            ids.lotSize.value = String(objConfig.lotSize);
        }
    }

    function applyExpiryModeDefaults(force) {
        if (!(ids.optionExpiryMode instanceof HTMLSelectElement) || !(ids.optionExpiryDate instanceof HTMLInputElement)) {
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

    function syncNeutralModeCheckboxes(changedKey) {
        const onlyDeltaNeutral = ids.onlyDeltaNeutral instanceof HTMLInputElement ? ids.onlyDeltaNeutral : null;
        const rangeDeltaNeutral = ids.rangeDeltaNeutral instanceof HTMLInputElement ? ids.rangeDeltaNeutral : null;
        const gammaAwareNeutral = ids.gammaAwareNeutral instanceof HTMLInputElement ? ids.gammaAwareNeutral : null;
        if (!onlyDeltaNeutral || !rangeDeltaNeutral || !gammaAwareNeutral) {
            return;
        }

        const checkboxMap = {
            only: onlyDeltaNeutral,
            range: rangeDeltaNeutral,
            gamma: gammaAwareNeutral
        };
        const changedNode = checkboxMap[changedKey];
        if (!changedNode) {
            return;
        }

        if (changedNode.checked) {
            Object.entries(checkboxMap).forEach(function ([key, checkbox]) {
                if (key !== changedKey) {
                    checkbox.checked = false;
                }
            });
            return;
        }
    }

    function getActiveNeutralModeKey() {
        if (ids.gammaAwareNeutral instanceof HTMLInputElement && ids.gammaAwareNeutral.checked) {
            return "gamma";
        }
        if (ids.rangeDeltaNeutral instanceof HTMLInputElement && ids.rangeDeltaNeutral.checked) {
            return "range";
        }
        if (ids.onlyDeltaNeutral instanceof HTMLInputElement && ids.onlyDeltaNeutral.checked) {
            return "only";
        }
        return "only";
    }

    function getCurrentNeutralModeFromCheckboxes() {
        if (ids.gammaAwareNeutral instanceof HTMLInputElement && ids.gammaAwareNeutral.checked) {
            return "gamma";
        }
        if (ids.rangeDeltaNeutral instanceof HTMLInputElement && ids.rangeDeltaNeutral.checked) {
            return "range";
        }
        if (ids.onlyDeltaNeutral instanceof HTMLInputElement && ids.onlyDeltaNeutral.checked) {
            return "delta";
        }
        return "none";
    }

    function getNeutralBadgeSummaryText(status) {
        const minDelta = Number(status.minDelta);
        const maxDelta = Number(status.maxDelta);
        const driftPct = Number(status.deltaDriftPct);
        const gammaFactor = Number(status.gammaFactor);
        const totalGamma = Number(status.totalGamma || 0);
        if (status.mode === "range") {
            return Number.isFinite(minDelta) && Number.isFinite(maxDelta)
                ? `Range: ${fmt(minDelta, 3)} to ${fmt(maxDelta, 3)}`
                : "Range: 0.000 to 0.000";
        }
        if (status.mode === "gamma") {
            const bandText = Number.isFinite(minDelta) && Number.isFinite(maxDelta)
                ? `${fmt(minDelta, 2)}% to ${fmt(maxDelta, 2)}%`
                : "0.00% to 0.00%";
            const gammaText = Number.isFinite(totalGamma) ? fmt(totalGamma, 4) : "0.0000";
            const factorText = Number.isFinite(gammaFactor) ? fmt(gammaFactor, 2) : "1.00";
            const driftText = Number.isFinite(driftPct) ? fmt(driftPct, 2) : "0.00";
            return `Gamma: ${gammaText} | Drift: ${driftText}% | Band: ${bandText} | x${factorText}`;
        }
        return Number.isFinite(minDelta) && Number.isFinite(maxDelta)
            ? `Drift: ${Number.isFinite(driftPct) ? fmt(driftPct, 2) : "0.00"}% | Trigger: ${fmt(minDelta, 2)}% to ${fmt(maxDelta, 2)}%`
            : "Drift: 0.00% | Trigger: 0.00% to 0.00%";
    }

    function canUseLiveActions() {
        return selectedApiProfileId && connectionState === "connected";
    }

    function setButtonsEnabled() {
        [
            ids.importButton,
            ids.refreshOpenPositionsButton,
            ids.refreshClosedPositionsButton
        ].forEach(function (button) {
            if (button instanceof HTMLButtonElement) {
                button.disabled = !canUseLiveActions();
            }
        });
        if (ids.killSwitchButton instanceof HTMLButtonElement) {
            ids.killSwitchButton.disabled = !canUseLiveActions() || !displayedPositions.length;
        }
        if (ids.copyWhitelistIpButton instanceof HTMLButtonElement) {
            const ip = String(ids.whitelistIpValue?.textContent || "").trim();
            ids.copyWhitelistIpButton.disabled = !ip || ip === "-";
        }
        [ids.sellFutureButton, ids.buyFutureButton].forEach(function (button) {
            if (button instanceof HTMLButtonElement) {
                button.disabled = manualFutureOrderInFlight || !canUseLiveActions();
            }
        });
        [ids.sellPeButton, ids.sellCeButton, ids.buyCeButton, ids.buyPeButton].forEach(function (button) {
            if (button instanceof HTMLButtonElement) {
                button.disabled = manualOptionOrderInFlight || !canUseLiveActions();
            }
        });
        if (ids.execStrategyButton instanceof HTMLButtonElement) {
            ids.execStrategyButton.disabled = execStrategyInFlight || !canUseLiveActions();
        }
    }

    function extractOpenPositionsPayload(payload) {
        if (Array.isArray(payload)) {
            return {
                positions: payload,
                totals: null,
                neutralStatus: null,
                recoveryMetrics: null
            };
        }
        const objPayload = payload && typeof payload === "object" ? payload : {};
        return {
            positions: Array.isArray(objPayload.positions) ? objPayload.positions : [],
            totals: objPayload.totals || null,
            neutralStatus: objPayload.neutralStatus || null,
            recoveryMetrics: objPayload.recoveryMetrics || null
        };
    }

    function applyRecoveryMetrics(recoveryMetrics) {
        const objMetrics = recoveryMetrics || {};
        if (ids.brok2Rec instanceof HTMLInputElement) {
            ids.brok2Rec.value = fmt(objMetrics.totalBrokerageToRecover, 4) === "-" ? "0" : fmt(objMetrics.totalBrokerageToRecover, 4);
        }
        if (ids.yet2Recover instanceof HTMLInputElement) {
            ids.yet2Recover.value = fmt(objMetrics.totalPnl, 4) === "-" ? "0" : fmt(objMetrics.totalPnl, 4);
        }
        if (ids.netPl) {
            ids.netPl.textContent = fmt(objMetrics.netPnl, 4) === "-" ? "0.0000" : fmt(objMetrics.netPnl, 4);
        }
    }

    function updateNeutralBadges(neutralStatus) {
        const objStatus = neutralStatus || {};
        const totalDelta = Number(objStatus.totalDelta || 0);
        const bRulesActive = autoTraderEnabled;
        const currentNeutralMode = getCurrentNeutralModeFromCheckboxes();
        const bShowDeltaGroup = bRulesActive && ["delta", "range", "gamma"].includes(currentNeutralMode);
        if (ids.deltaBadgesGroup) {
            ids.deltaBadgesGroup.hidden = !bShowDeltaGroup;
        }
        if (ids.neutralBadgesRow) {
            ids.neutralBadgesRow.hidden = !bShowDeltaGroup;
        }
        if (ids.deltaNeutralTotalDelta) {
            ids.deltaNeutralTotalDelta.textContent = `Delta: ${fmt(totalDelta, 3)}`;
        }
        if (ids.deltaNeutralRange) {
            ids.deltaNeutralRange.textContent = getNeutralBadgeSummaryText(objStatus);
        }
        if (ids.deltaNeutralBalance) {
            ids.deltaNeutralBalance.textContent = bRulesActive
                ? String(objStatus.deltaBalanceText || "Balance: Mode OFF")
                : "Balance: Mode OFF";
            applyBadgeTone(ids.deltaNeutralBalance, bRulesActive ? String(objStatus.deltaBalanceTone || "secondary") : "secondary");
        }
    }

    function applyConnectionStatus(connectionStatus) {
        const objStatus = connectionStatus || {};
        connectionState = String(objStatus.state || "not_selected").trim();
        if (ids.connectionStateValue) {
            ids.connectionStateValue.textContent = connectionState.replaceAll("_", " ").toUpperCase();
        }
        if (ids.lastCheckedValue) {
            ids.lastCheckedValue.textContent = objStatus.lastCheckedAt ? formatDateTimeDisplay(objStatus.lastCheckedAt) : "-";
        }
        if (ids.whitelistIpValue) {
            ids.whitelistIpValue.textContent = String(objStatus.outboundIp || "").trim() || "-";
        }
        const tone = connectionState === "connected"
            ? "success"
            : (connectionState === "not_selected" || connectionState === "checking" ? "warning" : "danger");
        setStatus(ids.connectionStatus, objStatus.message || "", tone);
        if ((connectionState === "auth_failed" || connectionState === "disconnected" || connectionState === "rate_limited") && ids.pageStatus) {
            setStatus(ids.pageStatus, objStatus.message || "", tone);
        }
        setButtonsEnabled();
    }

    function applyRuntimeStatus(runtime) {
        const objRuntime = runtime || {};
        runtimeStatus = String(objRuntime.status || "idle").trim() || "idle";
        autoTraderEnabled = Boolean(objRuntime.autoTraderEnabled);
        if (ids.engineStatus) {
            ids.engineStatus.textContent = runtimeStatus.charAt(0).toUpperCase() + runtimeStatus.slice(1);
        }
        if (ids.openRenkoSignal) {
            ids.openRenkoSignal.textContent = modeLabel;
        }
        if (ids.autoTraderButton instanceof HTMLButtonElement) {
            ids.autoTraderButton.textContent = autoTraderEnabled ? "Auto Trader - ON" : "Auto Trader - OFF";
            ids.autoTraderButton.classList.toggle("success", autoTraderEnabled);
            ids.autoTraderButton.classList.toggle("warn", !autoTraderEnabled);
        }
        applyRecoveryMetrics({
            totalBrokerageToRecover: Number(objRuntime.state?.brokerageRecoveryTotal || 0),
            totalPnl: Number(objRuntime.state?.recoveredTotalPnl || 0),
            netPnl: Number(objRuntime.state?.recoveredTotalPnl || 0) - Number(objRuntime.state?.brokerageRecoveryTotal || 0)
        });
        updateNeutralBadges(lastNeutralStatus);
        setButtonsEnabled();
    }

    function clearAccountSummary() {
        [
            ids.oneLotValue,
            ids.totalBalanceValue,
            ids.blockedMarginValue,
            ids.availableBalanceValue,
            ids.healthValue,
            ids.profileLabel
        ].forEach(function (node) {
            if (node) {
                node.textContent = "-";
            }
        });
    }

    function getUiState() {
        return {
            startQty: getInputValue(ids.startQty, "1"),
            symbol: String(ids.symbol?.value || "BTC").trim().toUpperCase(),
            manualFutOrderType: String(ids.futureOrderType?.value || "market_order").trim() === "limit_order" ? "limit_order" : "market_order",
            bsFutQty: getInputValue(ids.bsFutQty, "1"),
            minusDelta: getInputValue(ids.minusDelta, "-25"),
            plusDelta: getInputValue(ids.plusDelta, "25"),
            action1: getInputValue(ids.action1, "sell").toLowerCase() === "buy" ? "buy" : "sell",
            legs1: (function () {
                const vLegs = getInputValue(ids.legs1, mode === "dual" ? "both" : (mode === "short" ? "pe" : "ce")).toLowerCase();
                if (mode === "dual" && vLegs === "both") {
                    return "both";
                }
                return vLegs === "pe" ? "pe" : "ce";
            }()),
            onlyDeltaNeutral: getCheckboxValue(ids.onlyDeltaNeutral, false),
            rangeDeltaNeutral: getCheckboxValue(ids.rangeDeltaNeutral, false),
            gammaAwareNeutral: getCheckboxValue(ids.gammaAwareNeutral, false),
            expiryMode1: String(ids.optionExpiryMode?.value || "5").trim(),
            expiryDate1: String(ids.optionExpiryDate?.value || "").trim(),
            qty1: getInputValue(ids.qty1, "1"),
            newD1: getInputValue(ids.newD1, "0.53"),
            reD1: getInputValue(ids.reD1, "0.53"),
            tpD1: getInputValue(ids.tpD1, "0.25"),
            slD1: getInputValue(ids.slD1, "0.65"),
            reEnter1: getCheckboxValue(ids.reEnter1, true),
            closeNetProfitBrokerage: getCheckboxValue(ids.closeNetProfitBrokerage, false),
            brokerageMultiplier: getInputValue(ids.brokerageMultiplier, "3"),
            reEnterBrok: getCheckboxValue(ids.reEnterBrok, false),
            closeBlockedMargin: getCheckboxValue(ids.closeBlockedMargin, false),
            blockedMarginPct: getInputValue(ids.blockedMarginPct, "20"),
            reEnterBlock: getCheckboxValue(ids.reEnterBlock, false),
            telegramAlertTypes: ids.telegramEventCheckboxes.filter(function (checkbox) {
                return checkbox instanceof HTMLInputElement && checkbox.checked;
            }).map(function (checkbox) {
                return String(checkbox.value || "").trim();
            }).filter(Boolean),
            closedFromDate: String(ids.closedFromDate?.value || "").trim(),
            closedToDate: String(ids.closedToDate?.value || "").trim()
        };
    }

    function applyUiState(uiState) {
        isApplyingState = true;
        try {
            const objUiState = { ...getDefaultUiState(), ...(uiState || {}) };
            setInputValue(ids.startQty, objUiState.startQty);
            setInputValue(ids.symbol, String(objUiState.symbol || "BTC").trim().toUpperCase() === "ETH" ? "ETH" : "BTC");
            setInputValue(ids.futureOrderType, String(objUiState.manualFutOrderType || "market_order").trim() === "limit_order" ? "limit_order" : "market_order");
            setInputValue(ids.bsFutQty, objUiState.bsFutQty);
            setInputValue(ids.minusDelta, objUiState.minusDelta);
            setInputValue(ids.plusDelta, objUiState.plusDelta);
            setInputValue(ids.action1, String(objUiState.action1 || "sell").trim().toLowerCase() === "buy" ? "buy" : "sell");
            const defaultLegs = mode === "dual" ? "both" : (mode === "short" ? "pe" : "ce");
            const savedLegs = objUiState.legs1;
            const finalLegs = mode === "dual"
                ? ((savedLegs === "both" || savedLegs === "pe" || savedLegs === "ce") ? savedLegs : defaultLegs)
                : ((savedLegs === "pe" || savedLegs === "ce") ? savedLegs : defaultLegs);
            setInputValue(ids.legs1, finalLegs);
            setCheckboxValue(ids.onlyDeltaNeutral, objUiState.onlyDeltaNeutral);
            setCheckboxValue(ids.rangeDeltaNeutral, objUiState.rangeDeltaNeutral);
            setCheckboxValue(ids.gammaAwareNeutral, objUiState.gammaAwareNeutral);
            setInputValue(ids.optionExpiryMode, String(objUiState.expiryMode1 || "5").trim() || "5");
            setInputValue(ids.optionExpiryDate, String(objUiState.expiryDate1 || "").trim());
            setInputValue(ids.qty1, objUiState.qty1);
            setInputValue(ids.newD1, objUiState.newD1);
            setInputValue(ids.reD1, objUiState.reD1);
            setInputValue(ids.tpD1, objUiState.tpD1);
            setInputValue(ids.slD1, objUiState.slD1);
            setCheckboxValue(ids.reEnter1, objUiState.reEnter1);
            setCheckboxValue(ids.closeNetProfitBrokerage, objUiState.closeNetProfitBrokerage);
            setInputValue(ids.brokerageMultiplier, objUiState.brokerageMultiplier);
            setCheckboxValue(ids.reEnterBrok, objUiState.reEnterBrok);
            setCheckboxValue(ids.closeBlockedMargin, objUiState.closeBlockedMargin);
            setInputValue(ids.blockedMarginPct, objUiState.blockedMarginPct);
            setCheckboxValue(ids.reEnterBlock, objUiState.reEnterBlock);
            setInputValue(ids.closedFromDate, String(objUiState.closedFromDate || "").trim());
            setInputValue(ids.closedToDate, String(objUiState.closedToDate || "").trim());
            const selectedTypes = new Set(Array.isArray(objUiState.telegramAlertTypes) ? objUiState.telegramAlertTypes.map(String) : []);
            ids.telegramEventCheckboxes.forEach(function (checkbox) {
                if (checkbox instanceof HTMLInputElement) {
                    checkbox.checked = selectedTypes.has(String(checkbox.value || ""));
                }
            });
            applySymbolDefaults();
            applyExpiryModeDefaults(false);
            syncNeutralModeCheckboxes(getActiveNeutralModeKey());
            updateNeutralBadges(lastNeutralStatus);
        }
        finally {
            isApplyingState = false;
        }
    }

    function syncQtyFromStartQty() {
        if (!(ids.startQty instanceof HTMLInputElement) || !(ids.qty1 instanceof HTMLInputElement)) {
            return;
        }
        const vStartQty = String(ids.startQty.value || "").trim() || "1";
        ids.qty1.value = vStartQty;
    }

    async function resetManualTraderDefaults() {
        applyUiState(getDefaultUiState());
        applySymbolDefaults();
        applyExpiryModeDefaults(true);
        await saveProfile();
    }

    function queueProfileSave() {
        if (isApplyingState) {
            return;
        }
        if (saveTimer) {
            clearTimeout(saveTimer);
        }
        saveTimer = setTimeout(function () {
            saveTimer = null;
            void saveProfile().catch(function (_error) {
            });
        }, 300);
    }

    async function saveProfile() {
        return postJson(`${endpointBase}/profile`, {
            selectedApiProfileId: String(ids.apiProfile?.value || selectedApiProfileId || "").trim(),
            uiState: getUiState()
        });
    }

    async function loadApiProfiles() {
        const objResult = await getJson("/api/account/delta-api-profiles");
        const arrProfiles = Array.isArray(objResult?.data) ? objResult.data : [];
        if (!(ids.apiProfile instanceof HTMLSelectElement)) {
            return;
        }
        ids.apiProfile.innerHTML = "<option value=\"\">Select API profile</option>" + arrProfiles.map(function (profile) {
            return `<option value="${escapeHtml(profile.profileId)}">${escapeHtml(profile.referenceName || profile.apiKey || "API Profile")}</option>`;
        }).join("");
        if (!arrProfiles.length) {
            setStatus(ids.pageStatus, "No Delta API profiles found. Add one in Delta API Settings before using this page.", "warning");
        }
    }

    async function loadProfile() {
        const objResult = await getJson(`${endpointBase}/profile`);
        const objData = objResult?.data || {};
        selectedApiProfileId = String(objData.selectedApiProfileId || "").trim();
        if (ids.apiProfile instanceof HTMLSelectElement) {
            ids.apiProfile.value = selectedApiProfileId;
        }
        applyUiState(objData.uiState || {});
        applyConnectionStatus(objData.connectionStatus || {});
    }

    async function loadConnectionStatus() {
        const objResult = await getJson(`${endpointBase}/connection/status`);
        const objData = objResult?.data || {};
        selectedApiProfileId = String(objData.selectedApiProfileId || selectedApiProfileId || "").trim();
        applyConnectionStatus(objData.connectionStatus || {});
    }

    async function loadRuntimeStatus() {
        const objResult = await getJson(`${endpointBase}/runtime`);
        applyRuntimeStatus(objResult?.data || {});
    }

    async function saveRecoveryMetricsOverride() {
        const vBrokerage = Number(ids.brok2Rec instanceof HTMLInputElement ? ids.brok2Rec.value : 0);
        const vTotalPnl = Number(ids.yet2Recover instanceof HTMLInputElement ? ids.yet2Recover.value : 0);
        if (!Number.isFinite(vBrokerage) || !Number.isFinite(vTotalPnl)) {
            throw new Error("Enter valid numeric values for Total Brokerage to Recvr and Total PnL.");
        }
        const objResult = await postJson(`${endpointBase}/metrics/update`, {
            totalBrokerageToRecover: vBrokerage,
            totalPnl: vTotalPnl
        });
        renderOpenPositions(objResult?.data);
        return objResult;
    }

    async function checkConnection() {
        const profileId = String(ids.apiProfile?.value || "").trim();
        selectedApiProfileId = profileId;
        const objResult = await postJson(`${endpointBase}/connection/check`, { profileId: profileId });
        const objData = objResult?.data || {};
        if (objData.selectedApiProfileId) {
            selectedApiProfileId = String(objData.selectedApiProfileId || "").trim();
        }
        applyConnectionStatus(objData.connectionStatus || {});
        return objResult;
    }

    async function toggleAutoTrader() {
        const url = autoTraderEnabled
            ? `${endpointBase}/auto-trader/stop`
            : `${endpointBase}/auto-trader/start`;
        const objResult = await postJson(url, {});
        applyRuntimeStatus(objResult?.data || {});
        return objResult;
    }

    async function placeManualFuture(action) {
        const vAction = String(action || "").trim().toUpperCase();
        if (vAction !== "BUY" && vAction !== "SELL") {
            throw new Error("Future action must be BUY or SELL.");
        }
        if (manualFutureOrderInFlight) {
            throw new Error("A live futures order is already being processed. Please wait for it to finish.");
        }

        await checkConnection();
        if (!canUseLiveActions()) {
            throw new Error("Delta connection is not healthy enough to place a live futures order.");
        }

        const vQty = Math.max(1, Math.floor(Number(ids.bsFutQty?.value || 1)));
        const vOrderType = String(ids.futureOrderType?.value || "market_order").trim() === "limit_order"
            ? "limit_order"
            : "market_order";
        const vSymbol = String(ids.symbol?.value || "BTC").trim().toUpperCase();

        manualFutureOrderInFlight = true;
        setButtonsEnabled();
        try {
            return await postJson(`${endpointBase}/manual/future`, {
                action: vAction,
                symbol: vSymbol,
                qty: vQty,
                orderType: vOrderType
            });
        }
        finally {
            manualFutureOrderInFlight = false;
            setButtonsEnabled();
        }
    }

    async function executeStrategy() {
        if (execStrategyInFlight) {
            throw new Error("Exec Strategy is already running. Please wait for it to finish.");
        }

        await checkConnection();
        if (!canUseLiveActions()) {
            throw new Error("Delta connection is not healthy enough to execute the live strategy.");
        }
        if (!autoTraderEnabled) {
            throw new Error("Turn Auto Trader ON before executing the live strategy.");
        }

        const vAction = String(ids.action1?.value || "").trim().toLowerCase();
        const vLegSide = String(ids.legs1?.value || "").trim().toLowerCase();
        const vExpiryMode = String(ids.optionExpiryMode?.value || "5").trim();
        const vExpiryDate = String(ids.optionExpiryDate?.value || "").trim();
        const vQty = Math.max(1, Math.floor(Number(ids.qty1?.value || 1)));
        const vTargetDelta = Math.max(0, Number(ids.newD1?.value || 0.53));
        const vSymbol = String(ids.symbol?.value || "BTC").trim().toUpperCase();

        if (vAction !== "buy" && vAction !== "sell") {
            throw new Error("Select Buy or Sell in Action before executing the live strategy.");
        }
        if (!vExpiryDate) {
            throw new Error("Select an expiry date before executing the live strategy.");
        }

        execStrategyInFlight = true;
        setButtonsEnabled();
        try {
            return await postJson(`${endpointBase}/strategy/execute`, {
                action: vAction,
                symbol: vSymbol,
                legSide: vLegSide,
                expiryMode: vExpiryMode,
                expiryDate: vExpiryDate,
                qty: vQty,
                targetDelta: vTargetDelta
            });
        }
        finally {
            execStrategyInFlight = false;
            setButtonsEnabled();
        }
    }

    async function placeManualOption(action, legSide) {
        const vAction = String(action || "").trim().toLowerCase();
        const vLegSide = String(legSide || "").trim().toLowerCase();
        if ((vAction !== "buy" && vAction !== "sell") || (vLegSide !== "ce" && vLegSide !== "pe")) {
            throw new Error("Option action and leg must be valid before placing a live option order.");
        }
        if (manualOptionOrderInFlight) {
            throw new Error("A live option order is already being processed. Please wait for it to finish.");
        }

        await checkConnection();
        if (!canUseLiveActions()) {
            throw new Error("Delta connection is not healthy enough to place a live option order.");
        }

        const vExpiryMode = String(ids.optionExpiryMode?.value || "5").trim();
        const vExpiryDate = String(ids.optionExpiryDate?.value || "").trim();
        const vQty = Math.max(1, Math.floor(Number(ids.qty1?.value || 1)));
        const vTargetDelta = Math.max(0, Number(ids.newD1?.value || 0.53));
        const vSymbol = String(ids.symbol?.value || "BTC").trim().toUpperCase();

        if (!vExpiryDate) {
            throw new Error("Select an expiry date before placing a live option order.");
        }
        if (!(vTargetDelta > 0)) {
            throw new Error("Enter a valid New D before placing a live option order.");
        }

        manualOptionOrderInFlight = true;
        setButtonsEnabled();
        try {
            return await postJson(`${endpointBase}/manual/option`, {
                action: vAction,
                symbol: vSymbol,
                legSide: vLegSide,
                expiryMode: vExpiryMode,
                expiryDate: vExpiryDate,
                qty: vQty,
                targetDelta: vTargetDelta
            });
        }
        finally {
            manualOptionOrderInFlight = false;
            setButtonsEnabled();
        }
    }

    async function loadAccountSummary() {
        if (!canUseLiveActions()) {
            clearAccountSummary();
            return;
        }
        const query = new URLSearchParams();
        query.set("symbol", String(ids.symbol?.value || "BTC").trim().toUpperCase());
        const objResult = await getJson(`${endpointBase}/account-summary?${query.toString()}`);
        const objData = objResult?.data || {};
        if (ids.oneLotValue) {
            ids.oneLotValue.textContent = fmtUsd(objData.oneLotValue);
        }
        if (ids.totalBalanceValue) {
            ids.totalBalanceValue.textContent = fmtUsd(objData.totalBalance);
        }
        if (ids.blockedMarginValue) {
            ids.blockedMarginValue.textContent = fmtUsd(objData.blockedMargin);
        }
        if (ids.availableBalanceValue) {
            ids.availableBalanceValue.textContent = fmtUsd(objData.availableBalance);
        }
        if (ids.healthValue) {
            ids.healthValue.textContent = Number.isFinite(Number(objData.healthPct)) ? `${Number(objData.healthPct).toFixed(2)} %` : "-";
        }
        if (ids.profileLabel) {
            ids.profileLabel.textContent = String(objData.profileLabel || "").trim() || "-";
        }
    }

    function getLtpBlinkClass(positionId, markPrice) {
        const currentLtp = Number(markPrice);
        if (!positionId || !Number.isFinite(currentLtp)) {
            return "";
        }
        const previousLtp = previousOpenPositionLtps.get(positionId);
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

    function renderGreekCell(contractValue, totalValue, digits) {
        return `
            <div style="text-wrap: nowrap; text-align:right; font-weight:bold; color:orange;">${escapeHtml(fmt(contractValue, digits))}</div>
            <div style="text-wrap: nowrap; text-align:right; font-weight:bold; color:grey;">${escapeHtml(fmt(totalValue, digits))}</div>
        `;
    }

    function resolveSecondaryGreekValue(displayValue, fallbackValue) {
        const vDisplayValue = Number(displayValue);
        const vFallbackValue = Number(fallbackValue);
        if (Number.isFinite(vDisplayValue) && (vDisplayValue !== 0 || !Number.isFinite(vFallbackValue) || vFallbackValue === 0)) {
            return vDisplayValue;
        }
        return vFallbackValue;
    }

    function renderOpenPositions(payload) {
        const objPayload = extractOpenPositionsPayload(payload);
        const arrRows = objPayload.positions;
        const objTotals = objPayload.totals || {};
        displayedPositions = arrRows;
        lastNeutralStatus = objPayload.neutralStatus || null;
        applyRecoveryMetrics(objPayload.recoveryMetrics || null);
        updateNeutralBadges(lastNeutralStatus);
        if (!ids.openPositionsBody) {
            return;
        }
        if (!arrRows.length) {
            previousOpenPositionLtps = new Map();
            ids.openPositionsBody.innerHTML = "<tr><td colspan=\"16\" class=\"rolling-demo-empty\">No imported live positions are currently shown.</td></tr>";
            if (ids.openCount) {
                ids.openCount.textContent = "0";
            }
            setButtonsEnabled();
            return;
        }
        const nextLtps = new Map();
        const openRowsHtml = arrRows.map(function (row) {
            const side = String(row.side || "-").trim().toUpperCase();
            const contractName = String(row.contractName || "-");
            const lotSize = contractName.includes("ETH") ? 0.01 : 0.001;
            const importId = String(row.importId || contractName || "");
            const currentLtp = Number(row.markPrice);
            if (importId && Number.isFinite(currentLtp)) {
                nextLtps.set(importId, currentLtp);
            }
            const ltpBlinkClass = getLtpBlinkClass(importId, row.markPrice);
            const greeks = row.greeks || {};
            return `
                <tr>
                    <td>${renderGreekCell(greeks.deltaTotal, resolveSecondaryGreekValue(greeks.deltaDisplayTotal, greeks.deltaTotal), 2)}</td>
                    <td>${renderGreekCell(greeks.thetaDisplayTotal ?? greeks.thetaTotal, greeks.thetaBaseDisplayTotal ?? greeks.thetaTotal, 4)}</td>
                    <td>${escapeHtml(contractName)}</td>
                    <td>${escapeHtml(side)}</td>
                    <td>${escapeHtml(fmt(row.lotSize || lotSize, 3))}</td>
                    <td>${escapeHtml(fmt(row.qty, 0))}</td>
                    <td>${side === "BUY" ? escapeHtml(fmt(row.entryPrice, 2)) : "-"}</td>
                    <td>${side === "SELL" ? escapeHtml(fmt(row.entryPrice, 2)) : "-"}</td>
                    <td class="${escapeHtml(ltpBlinkClass)}">${escapeHtml(fmt(row.markPrice, 2))}</td>
                    <td>${escapeHtml(fmt(row.charges, 4))}</td>
                    <td>${escapeHtml(fmt(row.pnl, 2))}</td>
                    <td>${escapeHtml(formatDateTimeDisplay(row.openedAt))}</td>
                    <td>LIVE</td>
                    <td>
                        <div class="rolling-demo-table-actions">
                            <button class="rolling-demo-icon-btn sell rolling-live-close-open-position" type="button" data-import-id="${escapeHtml(importId)}" title="Close this open position" aria-label="Close this open position">
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M12 2v10" />
                                    <path d="M6.2 6.2a8 8 0 1 0 11.3 0" />
                                </svg>
                            </button>
                            <button class="rolling-demo-icon-btn warn rolling-live-delete-open-position" type="button" data-import-id="${escapeHtml(importId)}" title="Delete this open position permanently" aria-label="Delete this open position permanently">
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M18 6 6 18" />
                                    <path d="m6 6 12 12" />
                                </svg>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join("");
        ids.openPositionsBody.innerHTML = `${openRowsHtml}
            <tr class="rolling-demo-total-row">
                <td>${renderGreekCell(objTotals.totalDelta, resolveSecondaryGreekValue(objTotals.totalDeltaDisplay, objTotals.totalDelta), 2)}</td>
                <td>${renderGreekCell(objTotals.totalThetaDisplay ?? objTotals.totalTheta, objTotals.totalThetaBaseDisplay ?? objTotals.totalTheta, 4)}</td>
                <td><strong>TOTAL</strong></td>
                <td>-</td>
                <td>-</td>
                <td>${escapeHtml(fmt(objTotals.positionCount, 0))}</td>
                <td>-</td>
                <td>-</td>
                <td>-</td>
                <td class="rolling-demo-total-value">${escapeHtml(fmt(objTotals.totalCharges, 4))}</td>
                <td class="rolling-demo-total-value">${escapeHtml(fmt(objTotals.totalPnl, 2))}</td>
                <td>-</td>
                <td>-</td>
                <td>-</td>
            </tr>
        `;
        previousOpenPositionLtps = nextLtps;
        if (ids.openCount) {
            ids.openCount.textContent = String(arrRows.length);
        }
        setButtonsEnabled();
    }

    async function loadSavedOpenPositions() {
        const objResult = await getJson(`${endpointBase}/open-positions`);
        const objOpenPositions = extractOpenPositionsPayload(objResult?.data);
        renderOpenPositions(objOpenPositions);
        return objOpenPositions.positions;
    }

    async function saveImportedPositions(positions) {
        const objResult = await postJson(`${endpointBase}/open-positions`, { positions: positions });
        renderOpenPositions(objResult?.data);
        return objResult;
    }

    async function deleteSavedOpenPosition(importId) {
        return postJson(`${endpointBase}/open-positions/delete`, { importId: importId });
    }

    async function reconcileOpenPositions() {
        const objResult = await postJson(`${endpointBase}/open-positions/reconcile`, {});
        renderOpenPositions(objResult?.data);
        return objResult;
    }

    async function closeImportedOpenPosition(row) {
        return postJson(`${endpointBase}/open-positions/close`, {
            importId: row.importId,
            contractName: row.contractName,
            side: row.side,
            qty: row.qty
        });
    }

    function renderClosedPositions(rows) {
        closedPositions = Array.isArray(rows) ? rows : [];
        const totalPages = Math.max(1, Math.ceil(closedPositions.length / closedPositionsPageSize));
        closedPositionsPage = Math.min(closedPositionsPage, totalPages);
        closedPositionsPage = Math.max(closedPositionsPage, 1);
        if (!ids.closedPositionsBody) {
            return;
        }
        if (!closedPositions.length) {
            ids.closedPositionsBody.innerHTML = "<tr><td colspan=\"10\" class=\"rolling-demo-empty\">No Delta fill history found for the selected date range.</td></tr>";
            if (ids.closedPageInfo) {
                ids.closedPageInfo.textContent = "Page 0 of 0";
            }
            if (ids.closedPageNumbers) {
                ids.closedPageNumbers.innerHTML = "";
            }
            return;
        }
        const startIndex = (closedPositionsPage - 1) * closedPositionsPageSize;
        const pageRows = closedPositions.slice(startIndex, startIndex + closedPositionsPageSize);
        const closedRowsHtml = pageRows.map(function (row) {
            const contractName = String(row.symbol || "-");
            const lotSize = contractName.includes("ETH") ? 0.01 : 0.001;
            return `
                <tr>
                    <td>${escapeHtml(formatDateTimeDisplay(row.startAt))}</td>
                    <td>${escapeHtml(formatDateTimeDisplay(row.endAt))}</td>
                    <td>${escapeHtml(contractName)}</td>
                    <td>${escapeHtml(String(row.side || "-"))}</td>
                    <td>${escapeHtml(fmt(lotSize, 3))}</td>
                    <td>${escapeHtml(fmt(row.qty, 0))}</td>
                    <td>${row.buyPrice === null ? "-" : escapeHtml(fmt(row.buyPrice, 2))}</td>
                    <td>${row.sellPrice === null ? "-" : escapeHtml(fmt(row.sellPrice, 2))}</td>
                    <td>${escapeHtml(fmt(row.charges, 2))}</td>
                    <td>${row.pnl === null ? "-" : escapeHtml(fmt(row.pnl, 2))}</td>
                </tr>
            `;
        }).join("");
        const totalCharges = closedPositions.reduce(function (sum, row) {
            return sum + Number(row?.charges || 0);
        }, 0);
        const hasPnl = closedPositions.some(function (row) {
            return Number.isFinite(Number(row?.pnl));
        });
        const totalPnl = hasPnl ? closedPositions.reduce(function (sum, row) {
            return sum + Number(row?.pnl || 0);
        }, 0) : null;
        ids.closedPositionsBody.innerHTML = `${closedRowsHtml}
            <tr class="rolling-demo-total-row">
                <td colspan="8">Total</td>
                <td class="rolling-demo-total-value">${escapeHtml(fmt(totalCharges, 2))}</td>
                <td class="rolling-demo-total-value">${escapeHtml(totalPnl === null ? "-" : fmt(totalPnl, 2))}</td>
            </tr>
        `;
        if (ids.closedPageInfo) {
            ids.closedPageInfo.textContent = `Page ${closedPositionsPage} of ${totalPages} | ${closedPositions.length} records`;
        }
        if (ids.closedPageNumbers) {
            const pageNumbers = [];
            for (let page = 1; page <= totalPages; page += 1) {
                pageNumbers.push(`<button class="rolling-demo-icon-btn ${page === closedPositionsPage ? "primary" : "warn"} rolling-live-closed-page-btn" type="button" data-page="${page}">${page}</button>`);
            }
            ids.closedPageNumbers.innerHTML = pageNumbers.join("");
        }
    }

    async function loadClosedPositions() {
        if (!canUseLiveActions()) {
            renderClosedPositions([]);
            return [];
        }
        const query = new URLSearchParams();
        query.set("symbol", String(ids.symbol?.value || "BTC").trim().toUpperCase());
        if (ids.closedFromDate instanceof HTMLInputElement && ids.closedFromDate.value) {
            query.set("fromDate", ids.closedFromDate.value);
        }
        if (ids.closedToDate instanceof HTMLInputElement && ids.closedToDate.value) {
            query.set("toDate", ids.closedToDate.value);
        }
        const objResult = await getJson(`${endpointBase}/closed-positions?${query.toString()}`);
        const arrRows = Array.isArray(objResult?.data?.positions) ? objResult.data.positions : [];
        closedPositionsPage = 1;
        renderClosedPositions(arrRows);
        return arrRows;
    }

    function renderEvents(rows) {
        const arrRows = Array.isArray(rows) ? rows : [];
        if (!ids.eventLog) {
            return;
        }
        if (!arrRows.length) {
            ids.eventLog.innerHTML = "<div class=\"rolling-demo-event-empty\">No live activity has been logged yet.</div>";
            return;
        }
        ids.eventLog.innerHTML = arrRows.map(function (row) {
            const severity = String(row.severity || "info").trim().toLowerCase();
            const title = String(row.title || "Activity").trim();
            const message = String(row.message || "").trim();
            const createdAt = formatDateTimeDisplay(row.createdAt);
            const eventId = String(row.eventId || "").trim();
            return `
                <article class="rolling-demo-event-item ${escapeHtml(severity)}">
                    <div class="rolling-demo-event-head">
                        <strong>${escapeHtml(title)}</strong>
                        <div style="display:flex; align-items:center; gap:10px;">
                            <span>${escapeHtml(createdAt)}</span>
                            <button class="rolling-demo-icon-btn warn rolling-live-delete-event" type="button" data-event-id="${escapeHtml(eventId)}" title="Delete this activity log entry" aria-label="Delete this activity log entry">
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M18 6 6 18" />
                                    <path d="m6 6 12 12" />
                                </svg>
                            </button>
                        </div>
                    </div>
                    <p>${escapeHtml(message)}</p>
                </article>
            `;
        }).join("");
    }

    async function deleteEvent(eventId) {
        return postJson(`${endpointBase}/events/delete`, { eventId: eventId });
    }

    async function loadEvents() {
        const objResult = await getJson(`${endpointBase}/events`);
        renderEvents(Array.isArray(objResult?.data) ? objResult.data : []);
    }

    function openImportModal() {
        ids.importOverlay?.classList.add("show");
        ids.importModal?.classList.add("show");
        ids.importModal?.setAttribute("aria-hidden", "false");
    }

    function closeImportModal() {
        ids.importOverlay?.classList.remove("show");
        ids.importModal?.classList.remove("show");
        ids.importModal?.setAttribute("aria-hidden", "true");
    }

    function renderImportablePositions(rows) {
        importablePositions = Array.isArray(rows) ? rows : [];
        if (!ids.importList) {
            return;
        }
        if (!importablePositions.length) {
            ids.importList.innerHTML = "<div class=\"rolling-demo-event-empty\">No live futures positions are open on Delta Exchange for the selected symbol.</div>";
            return;
        }
        ids.importList.innerHTML = importablePositions.map(function (row) {
            return `
                <label class="rolling-live-import-item">
                    <input type="checkbox" class="rolling-live-import-checkbox" value="${escapeHtml(String(row.importId || ""))}" />
                    <div>
                        <div class="rolling-live-import-head">
                            <strong>${escapeHtml(String(row.contractName || "-"))}</strong>
                            <span>${escapeHtml(String(row.side || "-"))}</span>
                        </div>
                        <div class="rolling-live-import-metrics">
                            <span>Qty: ${escapeHtml(fmt(row.qty, 0))}</span>
                            <span>Entry: ${escapeHtml(fmt(row.entryPrice, 2))}</span>
                            <span>LTP: ${escapeHtml(fmt(row.markPrice, 2))}</span>
                        </div>
                    </div>
                </label>
            `;
        }).join("");
    }

    async function loadImportablePositions() {
        await checkConnection();
        if (!canUseLiveActions()) {
            throw new Error("Delta connection is not healthy enough to import live futures positions.");
        }
        const objResult = await getJson(`${endpointBase}/open-positions/importable`);
        const arrPositions = Array.isArray(objResult?.data?.positions) ? objResult.data.positions : [];
        renderImportablePositions(arrPositions);
        setStatus(ids.importStatus, arrPositions.length ? "" : "No live futures positions were returned for the selected symbol.", arrPositions.length ? "" : "warning");
        openImportModal();
    }

    async function refreshImportablePositionsSilently() {
        if (!canUseLiveActions()) {
            return [];
        }
        const objResult = await getJson(`${endpointBase}/open-positions/importable`);
        const arrPositions = Array.isArray(objResult?.data?.positions) ? objResult.data.positions : [];
        renderImportablePositions(arrPositions);
        return arrPositions;
    }

    async function applyImportedPositions() {
        const selectedIds = Array.from(document.querySelectorAll(".rolling-live-import-checkbox"))
            .filter(function (node) {
                return node instanceof HTMLInputElement && node.checked;
            })
            .map(function (node) {
                return String(node.value || "").trim();
            });
        const selectedRows = importablePositions.filter(function (row) {
            return selectedIds.includes(String(row.importId || "").trim());
        });
        if (!selectedRows.length) {
            throw new Error("Select at least one live futures position to import.");
        }
        const objResult = await saveImportedPositions(selectedRows);
        closeImportModal();
        return objResult;
    }

    async function runKillSwitch() {
        return postJson(`${endpointBase}/kill-switch`, {});
    }

    async function copyWhitelistIp() {
        const ip = String(ids.whitelistIpValue?.textContent || "").trim();
        if (!ip || ip === "-") {
            throw new Error("Whitelist IP is not available yet. Run connection check first.");
        }
        await navigator.clipboard.writeText(ip);
        return ip;
    }

    function startConnectionPolling() {
        if (connectionPollTimer) {
            clearInterval(connectionPollTimer);
        }
        connectionPollTimer = setInterval(function () {
            if (!selectedApiProfileId) {
                return;
            }
            void Promise.all([
                loadConnectionStatus(),
                loadRuntimeStatus(),
                loadAccountSummary().catch(function () { return undefined; }),
                loadSavedOpenPositions().catch(function () { return undefined; })
            ]).then(function () {
                if (!autoTraderEnabled) {
                    return;
                }
                return Promise.all([
                    loadAccountSummary().catch(function () { return undefined; }),
                    loadEvents().catch(function () { return undefined; })
                ]);
            }).catch(function (_error) {
            });
        }, 30000);
    }

    applySymbolDefaults();
    applyExpiryModeDefaults(true);
    if (ids.engineStatus) {
        ids.engineStatus.textContent = "Idle";
    }
    if (ids.openRenkoSignal) {
        ids.openRenkoSignal.textContent = modeLabel;
    }
    setButtonsEnabled();

    ids.symbol?.addEventListener("change", function () {
        applySymbolDefaults();
        queueProfileSave();
        void Promise.all([
            loadAccountSummary().catch(function () { return undefined; }),
            loadClosedPositions().catch(function () { return undefined; })
        ]);
    });
    ids.resetDefaultsButton?.addEventListener("click", function () {
        void resetManualTraderDefaults().then(function () {
            setStatus(ids.pageStatus, "Manual trader defaults restored for this user.", "success");
        }).catch(function (error) {
            setStatus(ids.pageStatus, error instanceof Error ? error.message : "Unable to reset manual trader defaults.", "danger");
        });
    });
    ids.startQty?.addEventListener("input", function () {
        syncQtyFromStartQty();
        queueProfileSave();
    });
    ids.startQty?.addEventListener("change", function () {
        syncQtyFromStartQty();
        queueProfileSave();
    });
    ids.futureOrderType?.addEventListener("change", queueProfileSave);
    ids.onlyDeltaNeutral?.addEventListener("change", function () {
        syncNeutralModeCheckboxes("only");
        updateNeutralBadges(lastNeutralStatus);
        queueProfileSave();
    });
    ids.rangeDeltaNeutral?.addEventListener("change", function () {
        syncNeutralModeCheckboxes("range");
        updateNeutralBadges(lastNeutralStatus);
        queueProfileSave();
    });
    ids.gammaAwareNeutral?.addEventListener("change", function () {
        syncNeutralModeCheckboxes("gamma");
        updateNeutralBadges(lastNeutralStatus);
        queueProfileSave();
    });
    [
        ids.bsFutQty,
        ids.minusDelta,
        ids.plusDelta,
        ids.action1,
        ids.legs1,
        ids.qty1,
        ids.newD1,
        ids.reD1,
        ids.tpD1,
        ids.slD1,
        ids.reEnter1,
        ids.closeNetProfitBrokerage,
        ids.brokerageMultiplier,
        ids.reEnterBrok,
        ids.closeBlockedMargin,
        ids.blockedMarginPct,
        ids.reEnterBlock
    ].forEach(function (node) {
        node?.addEventListener("change", queueProfileSave);
        if (node instanceof HTMLInputElement && node.type !== "checkbox") {
            node.addEventListener("input", queueProfileSave);
        }
    });
    ids.optionExpiryMode?.addEventListener("change", function () {
        applyExpiryModeDefaults(true);
        queueProfileSave();
    });
    ids.optionExpiryDate?.addEventListener("change", queueProfileSave);
    ids.telegramEventCheckboxes.forEach(function (checkbox) {
        checkbox.addEventListener("change", queueProfileSave);
    });
    ids.closedFromDate?.addEventListener("change", function () {
        queueProfileSave();
        void loadClosedPositions().catch(function (error) {
            setStatus(ids.pageStatus, error instanceof Error ? error.message : "Unable to filter closed positions.", "danger");
        });
    });
    ids.closedToDate?.addEventListener("change", function () {
        queueProfileSave();
        void loadClosedPositions().catch(function (error) {
            setStatus(ids.pageStatus, error instanceof Error ? error.message : "Unable to filter closed positions.", "danger");
        });
    });
    [ids.brok2Rec, ids.yet2Recover].forEach(function (node) {
        node?.addEventListener("change", function () {
            void saveRecoveryMetricsOverride().then(function (objResult) {
                setStatus(ids.pageStatus, String(objResult?.message || "Recovery metrics updated."), "success");
                return Promise.all([
                    loadRuntimeStatus().catch(function () { return undefined; }),
                    loadEvents().catch(function () { return undefined; })
                ]);
            }).catch(function (error) {
                setStatus(ids.pageStatus, error instanceof Error ? error.message : "Unable to update recovery metrics.", "danger");
            });
        });
    });
    ids.apiProfile?.addEventListener("change", function () {
        void saveProfile().then(function () {
            return checkConnection();
        }).then(function () {
            return Promise.all([
                loadAccountSummary().catch(function () { return undefined; }),
                loadClosedPositions().catch(function () { return undefined; }),
                loadSavedOpenPositions().catch(function () { return undefined; })
            ]);
        }).catch(function (error) {
            setStatus(ids.pageStatus, error instanceof Error ? error.message : "Unable to load live account data.", "danger");
        });
    });
    ids.checkConnectionButton?.addEventListener("click", function () {
        void checkConnection().then(function () {
            return Promise.all([
                loadAccountSummary().catch(function () { return undefined; }),
                loadClosedPositions().catch(function () { return undefined; }),
                loadSavedOpenPositions().catch(function () { return undefined; })
            ]);
        }).then(function () {
            setStatus(ids.pageStatus, "Delta connection checked.", "success");
        }).catch(function (error) {
            setStatus(ids.pageStatus, error instanceof Error ? error.message : "Unable to check Delta connection.", "danger");
        });
    });
    ids.autoTraderButton?.addEventListener("click", function () {
        void checkConnection().then(function () {
            if (!canUseLiveActions()) {
                throw new Error("Delta connection is not healthy enough to change live auto trader state.");
            }
            return toggleAutoTrader();
        }).then(function () {
            return Promise.all([
                loadRuntimeStatus(),
                loadAccountSummary().catch(function () { return undefined; }),
                loadEvents().catch(function () { return undefined; })
            ]);
        }).then(function () {
            setStatus(ids.pageStatus, autoTraderEnabled ? "Live auto trader enabled." : "Live auto trader disabled.", "success");
        }).catch(function (error) {
            setStatus(ids.pageStatus, error instanceof Error ? error.message : "Unable to change live auto trader state.", "danger");
        });
    });
    ids.sellFutureButton?.addEventListener("click", function () {
        void placeManualFuture("SELL").then(function (objResult) {
            const objData = objResult?.data || {};
            const objOrder = objData.order || {};
            const trackedPayload = objData.trackedOpenPositions || null;
            const vOrderId = String(objOrder.id || objOrder.order_id || "").trim();
            const vMessage = objResult?.message || "SELL future live order placed.";
            const vTone = String(objResult?.status || "").trim() === "warning" ? "warning" : "success";
            if (trackedPayload) {
                renderOpenPositions(trackedPayload);
            }
            setStatus(ids.pageStatus, vOrderId ? `${vMessage} Order ID: ${vOrderId}` : vMessage, vTone);
            return Promise.all([
                loadAccountSummary(),
                loadConnectionStatus(),
                loadEvents().catch(function () { return undefined; })
            ]);
        }).catch(function (error) {
            setStatus(ids.pageStatus, error instanceof Error ? error.message : "Unable to place SELL FUT order.", "danger");
        });
    });
    ids.buyFutureButton?.addEventListener("click", function () {
        void placeManualFuture("BUY").then(function (objResult) {
            const objData = objResult?.data || {};
            const objOrder = objData.order || {};
            const trackedPayload = objData.trackedOpenPositions || null;
            const vOrderId = String(objOrder.id || objOrder.order_id || "").trim();
            const vMessage = objResult?.message || "BUY future live order placed.";
            const vTone = String(objResult?.status || "").trim() === "warning" ? "warning" : "success";
            if (trackedPayload) {
                renderOpenPositions(trackedPayload);
            }
            setStatus(ids.pageStatus, vOrderId ? `${vMessage} Order ID: ${vOrderId}` : vMessage, vTone);
            return Promise.all([
                loadAccountSummary(),
                loadConnectionStatus(),
                loadEvents().catch(function () { return undefined; })
            ]);
        }).catch(function (error) {
            setStatus(ids.pageStatus, error instanceof Error ? error.message : "Unable to place BUY FUT order.", "danger");
        });
    });
    ids.sellPeButton?.addEventListener("click", function () {
        void placeManualOption("sell", "pe").then(function (objResult) {
            const trackedPayload = objResult?.data?.trackedOpenPositions || null;
            const objOrder = objResult?.data?.order || {};
            const vOrderId = String(objOrder.id || objOrder.order_id || "").trim();
            const vMessage = String(objResult?.message || "SELL PE live option order placed.").trim();
            if (trackedPayload) {
                renderOpenPositions(trackedPayload);
            }
            setStatus(ids.pageStatus, vOrderId ? `${vMessage} Order ID: ${vOrderId}` : vMessage, "success");
            return Promise.all([
                loadAccountSummary(),
                loadConnectionStatus(),
                loadEvents().catch(function () { return undefined; })
            ]);
        }).catch(function (error) {
            setStatus(ids.pageStatus, error instanceof Error ? error.message : "Unable to place SELL PE order.", "danger");
        });
    });
    ids.sellCeButton?.addEventListener("click", function () {
        void placeManualOption("sell", "ce").then(function (objResult) {
            const trackedPayload = objResult?.data?.trackedOpenPositions || null;
            const objOrder = objResult?.data?.order || {};
            const vOrderId = String(objOrder.id || objOrder.order_id || "").trim();
            const vMessage = String(objResult?.message || "SELL CE live option order placed.").trim();
            if (trackedPayload) {
                renderOpenPositions(trackedPayload);
            }
            setStatus(ids.pageStatus, vOrderId ? `${vMessage} Order ID: ${vOrderId}` : vMessage, "success");
            return Promise.all([
                loadAccountSummary(),
                loadConnectionStatus(),
                loadEvents().catch(function () { return undefined; })
            ]);
        }).catch(function (error) {
            setStatus(ids.pageStatus, error instanceof Error ? error.message : "Unable to place SELL CE order.", "danger");
        });
    });
    ids.buyCeButton?.addEventListener("click", function () {
        void placeManualOption("buy", "ce").then(function (objResult) {
            const trackedPayload = objResult?.data?.trackedOpenPositions || null;
            const objOrder = objResult?.data?.order || {};
            const vOrderId = String(objOrder.id || objOrder.order_id || "").trim();
            const vMessage = String(objResult?.message || "BUY CE live option order placed.").trim();
            if (trackedPayload) {
                renderOpenPositions(trackedPayload);
            }
            setStatus(ids.pageStatus, vOrderId ? `${vMessage} Order ID: ${vOrderId}` : vMessage, "success");
            return Promise.all([
                loadAccountSummary(),
                loadConnectionStatus(),
                loadEvents().catch(function () { return undefined; })
            ]);
        }).catch(function (error) {
            setStatus(ids.pageStatus, error instanceof Error ? error.message : "Unable to place BUY CE order.", "danger");
        });
    });
    ids.buyPeButton?.addEventListener("click", function () {
        void placeManualOption("buy", "pe").then(function (objResult) {
            const trackedPayload = objResult?.data?.trackedOpenPositions || null;
            const objOrder = objResult?.data?.order || {};
            const vOrderId = String(objOrder.id || objOrder.order_id || "").trim();
            const vMessage = String(objResult?.message || "BUY PE live option order placed.").trim();
            if (trackedPayload) {
                renderOpenPositions(trackedPayload);
            }
            setStatus(ids.pageStatus, vOrderId ? `${vMessage} Order ID: ${vOrderId}` : vMessage, "success");
            return Promise.all([
                loadAccountSummary(),
                loadConnectionStatus(),
                loadEvents().catch(function () { return undefined; })
            ]);
        }).catch(function (error) {
            setStatus(ids.pageStatus, error instanceof Error ? error.message : "Unable to place BUY PE order.", "danger");
        });
    });
    ids.execStrategyButton?.addEventListener("click", function () {
        void executeStrategy().then(function (objResult) {
            const trackedPayload = objResult?.data?.trackedOpenPositions || null;
            const objNeutralCheck = objResult?.data?.neutralCheck || {};
            const bHedgePlaced = Boolean(objNeutralCheck?.hedgePlaced);
            if (trackedPayload) {
                renderOpenPositions(trackedPayload);
            }
            const vMessage = String(objResult?.message || "Exec Strategy placed live option order(s).").trim();
            setStatus(ids.pageStatus, bHedgePlaced ? `${vMessage} Server-side neutrality hedge also executed.` : vMessage, "success");
            return Promise.all([
                loadAccountSummary(),
                loadConnectionStatus(),
                loadEvents().catch(function () { return undefined; })
            ]);
        }).catch(function (error) {
            setStatus(ids.pageStatus, error instanceof Error ? error.message : "Unable to execute the live strategy.", "danger");
        });
    });
    ids.importButton?.addEventListener("click", function () {
        void loadImportablePositions().catch(function (error) {
            setStatus(ids.importStatus, error instanceof Error ? error.message : "Unable to load open positions.", "danger");
        });
    });
    ids.refreshOpenPositionsButton?.addEventListener("click", function () {
        void reconcileOpenPositions().then(function (objResult) {
            setStatus(ids.pageStatus, objResult?.message || "Open positions reconciled with Delta Exchange.", "success");
            return Promise.all([loadAccountSummary(), loadEvents()]);
        }).catch(function (error) {
            setStatus(ids.pageStatus, error instanceof Error ? error.message : "Unable to refresh open positions.", "danger");
        });
    });
    ids.killSwitchButton?.addEventListener("click", function () {
        const confirmed = window.confirm("Kill switch will place reduce-only market close orders for all saved live futures positions. Continue?");
        if (!confirmed) {
            return;
        }
        void runKillSwitch().then(function (objResult) {
            const trackedPayload = objResult?.data?.trackedOpenPositions || null;
            if (trackedPayload) {
                renderOpenPositions(trackedPayload);
            }
            else {
                renderOpenPositions([]);
            }
            setStatus(ids.pageStatus, objResult?.message || "Live kill switch completed.", "success");
            return Promise.all([
                loadRuntimeStatus().catch(function () { return undefined; }),
                loadAccountSummary().catch(function () { return undefined; }),
                loadEvents().catch(function () { return undefined; }),
                loadClosedPositions().catch(function () { return undefined; })
            ]);
        }).catch(function (error) {
            setStatus(ids.pageStatus, error instanceof Error ? error.message : "Unable to execute live kill switch.", "danger");
        });
    });
    ids.refreshClosedPositionsButton?.addEventListener("click", function () {
        void loadClosedPositions().then(function () {
            setStatus(ids.pageStatus, "Closed-position history refreshed.", "success");
        }).catch(function (error) {
            setStatus(ids.pageStatus, error instanceof Error ? error.message : "Unable to load closed positions.", "danger");
        });
    });
    ids.clearClosedFiltersButton?.addEventListener("click", function () {
        if (ids.closedFromDate instanceof HTMLInputElement) {
            ids.closedFromDate.value = "";
        }
        if (ids.closedToDate instanceof HTMLInputElement) {
            ids.closedToDate.value = "";
        }
        queueProfileSave();
        void loadClosedPositions().then(function () {
            setStatus(ids.pageStatus, "Closed-position filters cleared.", "success");
        }).catch(function (error) {
            setStatus(ids.pageStatus, error instanceof Error ? error.message : "Unable to clear closed-position filters.", "danger");
        });
    });
    ids.closedPrevPageButton?.addEventListener("click", function () {
        if (closedPositionsPage <= 1) {
            return;
        }
        closedPositionsPage -= 1;
        renderClosedPositions(closedPositions);
    });
    ids.closedNextPageButton?.addEventListener("click", function () {
        const totalPages = Math.max(1, Math.ceil(closedPositions.length / closedPositionsPageSize));
        if (closedPositionsPage >= totalPages) {
            return;
        }
        closedPositionsPage += 1;
        renderClosedPositions(closedPositions);
    });
    ids.closedPageNumbers?.addEventListener("click", function (event) {
        const target = event.target instanceof Element ? event.target.closest(".rolling-live-closed-page-btn") : null;
        if (!(target instanceof HTMLButtonElement)) {
            return;
        }
        const page = Number(target.dataset.page || 0);
        if (!Number.isFinite(page) || page <= 0) {
            return;
        }
        closedPositionsPage = page;
        renderClosedPositions(closedPositions);
    });
    ids.refreshEventsButton?.addEventListener("click", function () {
        void loadEvents().catch(function (error) {
            setStatus(ids.pageStatus, error instanceof Error ? error.message : "Unable to refresh activity log.", "danger");
        });
    });
    ids.clearEventsButton?.addEventListener("click", function () {
        const confirmed = window.confirm("Clear all messages from the Activity Log?");
        if (!confirmed) {
            return;
        }
        void postJson(`${endpointBase}/events/clear`, {}).then(function (objResult) {
            renderEvents([]);
            setStatus(ids.pageStatus, objResult?.message || "Live activity log cleared.", "success");
        }).catch(function (error) {
            setStatus(ids.pageStatus, error instanceof Error ? error.message : "Unable to clear activity log.", "danger");
        });
    });
    ids.eventLog?.addEventListener("click", function (event) {
        const target = event.target instanceof Element ? event.target : null;
        const deleteButton = target ? target.closest(".rolling-live-delete-event") : null;
        if (!(deleteButton instanceof HTMLButtonElement)) {
            return;
        }
        const eventId = String(deleteButton.dataset.eventId || "").trim();
        if (!eventId) {
            setStatus(ids.pageStatus, "Unable to find the selected activity log entry.", "danger");
            return;
        }
        void deleteEvent(eventId).then(function (objResult) {
            setStatus(ids.pageStatus, objResult?.message || "Activity log entry deleted.", "success");
            return loadEvents();
        }).catch(function (error) {
            setStatus(ids.pageStatus, error instanceof Error ? error.message : "Unable to delete activity log entry.", "danger");
        });
    });
    ids.copyWhitelistIpButton?.addEventListener("click", function () {
        void copyWhitelistIp().then(function (ip) {
            setStatus(ids.pageStatus, `Whitelist IP copied: ${ip}`, "success");
        }).catch(function (error) {
            setStatus(ids.pageStatus, error instanceof Error ? error.message : "Unable to copy whitelist IP.", "warning");
        });
    });
    ids.importOverlay?.addEventListener("click", closeImportModal);
    ids.closeImportModalButton?.addEventListener("click", closeImportModal);
    ids.applyImportedPositionsButton?.addEventListener("click", function () {
        void applyImportedPositions().then(function (objResult) {
            setStatus(ids.pageStatus, objResult?.message || "Imported live futures positions saved.", "success");
            return Promise.all([loadAccountSummary(), loadEvents()]);
        }).catch(function (error) {
            setStatus(ids.importStatus, error instanceof Error ? error.message : "Unable to import live futures positions.", "danger");
        });
    });
    ids.openPositionsBody?.addEventListener("click", function (event) {
        const target = event.target instanceof Element ? event.target : null;
        const closeButton = target ? target.closest(".rolling-live-close-open-position") : null;
        if (closeButton instanceof HTMLButtonElement) {
            const importId = String(closeButton.dataset.importId || "").trim();
            const row = displayedPositions.find(function (item) {
                return String(item?.importId || "").trim() === importId;
            });
            if (!row) {
                setStatus(ids.pageStatus, "Unable to find the selected imported live position.", "danger");
                return;
            }
            const confirmed = window.confirm(`Close ${row.contractName || "this position"} on Delta Exchange now?`);
            if (!confirmed) {
                return;
            }
            void closeImportedOpenPosition(row).then(function (objResult) {
                const vTone = String(objResult?.status || "").trim() === "warning" ? "warning" : "success";
                const objData = objResult?.data || {};
                const objOrder = objData.order || {};
                const vOrderId = String(objOrder.id || objOrder.order_id || "").trim();
                const vMessage = objResult?.message || "Live close order placed on Delta Exchange.";
                const trackedPayload = objResult?.data?.trackedOpenPositions || null;
                setStatus(ids.pageStatus, vOrderId ? `${vMessage} Order ID: ${vOrderId}` : vMessage, vTone);
                if (trackedPayload) {
                    renderOpenPositions(trackedPayload);
                }
                else {
                    const remaining = displayedPositions.filter(function (item) {
                        return String(item?.importId || "").trim() !== importId;
                    });
                    renderOpenPositions(remaining);
                }
                return Promise.all([
                    loadAccountSummary(),
                    loadConnectionStatus(),
                    refreshImportablePositionsSilently().catch(function () { return undefined; }),
                    loadEvents().catch(function () { return undefined; })
                ]);
            }).catch(function (error) {
                setStatus(ids.pageStatus, error instanceof Error ? error.message : "Unable to close imported live position.", "danger");
            });
            return;
        }
        const deleteButton = target ? target.closest(".rolling-live-delete-open-position") : null;
        if (deleteButton instanceof HTMLButtonElement) {
            const importId = String(deleteButton.dataset.importId || "").trim();
            void deleteSavedOpenPosition(importId).then(function () {
                void loadSavedOpenPositions().catch(function () { return undefined; });
                void loadEvents().catch(function () { return undefined; });
                setStatus(ids.pageStatus, "Position removed from the Open Positions section only. No Delta Exchange order was placed.", "success");
            }).catch(function (error) {
                setStatus(ids.pageStatus, error instanceof Error ? error.message : "Unable to remove imported open position.", "danger");
            });
        }
    });

    void loadApiProfiles().then(function () {
        return loadProfile();
    }).then(function () {
        return Promise.all([
            loadRuntimeStatus().catch(function () { return undefined; }),
            loadSavedOpenPositions().catch(function () { return []; }),
            loadEvents().catch(function () { return []; })
        ]);
    }).then(function () {
        if (!selectedApiProfileId) {
            return;
        }
        return checkConnection().then(function () {
            return Promise.all([
                loadAccountSummary().catch(function () { return undefined; }),
                loadClosedPositions().catch(function () { return undefined; })
            ]);
        });
    }).catch(function (error) {
        setStatus(ids.pageStatus, error instanceof Error ? error.message : "Unable to load live futures page.", "danger");
    });

    startConnectionPolling();
})();
