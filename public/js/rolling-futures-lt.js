(function () {
    const rawMode = String(document.body?.dataset?.rollingFuturesLive || "").trim().toLowerCase();
    const pageVariant = String(document.body?.dataset?.rollingFuturesVariant || "").trim().toLowerCase();
    const isDemoVariant = pageVariant === "demo";
    const isStranglePage = pageVariant === "strangle";
    const isRenkoPage = pageVariant === "renko";
    const supportsRenkoFeed = isDemoVariant || isRenkoPage;
    const isStrangleLikePage = isStranglePage || isRenkoPage;
    const endpointBaseOverride = String(document.body?.dataset?.rollingFuturesEndpointBase || "").trim();
    const strategyLabel = String(document.body?.dataset?.rollingFuturesStrategyLabel || "").trim() || "Covered Options";
    const mode = rawMode === "short" || rawMode === "covered" ? rawMode : "long";
    const initialExecStrategyEnabled = String(document.body?.dataset?.execStrategyEnabled || "").trim().toLowerCase() === "true";
    const prefix = mode === "short"
        ? "rollingShortFutures"
        : (mode === "covered" ? "rollingDualFutures" : "rollingLongFutures");
    const idPrefix = mode === "short"
        ? "RollingShortFutures"
        : (mode === "covered" ? "RollingDualFutures" : "RollingLongFutures");
    const endpointBase = endpointBaseOverride || (mode === "short"
        ? "/api/rollingfutures-lt-short"
        : (mode === "covered" ? "/api/covered-options" : "/api/rollingfutures-lt-long"));
    const modeLabel = mode === "short"
        ? "Short Mode"
        : (mode === "covered" ? "Covered Options" : "Long Mode");
    const isCoveredMode = mode === "covered";
    const isDualLikeMode = mode === "covered";
    const supportsTelegramAlerts = isCoveredMode && !isDemoVariant;
    const openPositionsEmptyText = isDemoVariant
        ? "No demo positions are currently shown."
        : "No imported live positions are currently shown.";
    const closedPositionsEmptyText = isDemoVariant
        ? "No demo trade history found for the selected date range."
        : "No Delta fill history found for the selected date range.";
    const eventLogEmptyText = isDemoVariant
        ? "No demo activity has been logged yet."
        : "No live activity has been logged yet.";
    const importableEmptyText = isCoveredMode
        ? (isDemoVariant
            ? "No importable demo option positions are available."
            : "No live option positions are open on Delta Exchange for the selected symbol.")
        : "No live futures positions are open on Delta Exchange for the selected symbol.";
    const deltaUiTimezoneOffsetMinutes = 5.5 * 60;
    const currentAccountId = String(document.body?.dataset?.currentAccountId || "").trim();
    const currentAccountIsAdmin = String(document.body?.dataset?.currentAccountAdmin || "").trim().toLowerCase() === "true";
    const currentAccountIsVerifier = String(document.body?.dataset?.currentAccountVerifier || "").trim().toLowerCase() === "true";
    const currentAccountFullName = String(document.body?.dataset?.currentAccountFullName || "").trim();
    const currentAccountEmail = String(document.body?.dataset?.currentAccountEmail || "").trim();
    const currentAccountTelegramChatId = String(document.body?.dataset?.currentAccountTelegramChatId || "").trim();
    const requiresExplicitTargetSelection = isCoveredMode && currentAccountIsVerifier && !isDemoVariant;
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
        adminTargetUser: document.getElementById("ddlRollingDualAdminTargetUser"),
        adminTargetMeta: document.getElementById("rollingDualAdminTargetMeta"),
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
        showSavedProfileButton: document.getElementById("btnRollingFuturesShowSavedProfile"),
        startQty: document.getElementById("txtRollingFuturesStartQty"),
        calculateStartQtyButton: document.getElementById("btnRollingFuturesCalcStartQty"),
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
        sellPeButton2: document.getElementById("btnRollingFuturesSellPe2"),
        sellCeButton2: document.getElementById("btnRollingFuturesSellCe2"),
        buyCeButton2: document.getElementById("btnRollingFuturesBuyCe2"),
        buyPeButton2: document.getElementById("btnRollingFuturesBuyPe2"),
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
        action2: document.getElementById("ddlRollingFuturesAction2"),
        legs2: document.getElementById("ddlRollingFuturesLegs2"),
        optionExpiryMode2: document.getElementById("ddlRollingFuturesExpiryType2"),
        optionExpiryDate2: document.getElementById("txtRollingFuturesExpiry2"),
        qty2: document.getElementById("txtRollingFuturesQty2"),
        newD2: document.getElementById("txtRollingFuturesNewD2"),
        reD2: document.getElementById("txtRollingFuturesReD2"),
        tpD2: document.getElementById("txtRollingFuturesTpD2"),
        slD2: document.getElementById("txtRollingFuturesSlD2"),
        reEnter2: document.getElementById("chkRollingFuturesReEnter2"),
        closeNetProfitBrokerage: document.getElementById("chkRollingFuturesCloseNetProfitBrokerage"),
        brokerageMultiplier: document.getElementById("txtRollingFuturesBrokerageMultiplier"),
        brok2Rec: document.getElementById("txtRollingFuturesBrok2Rec"),
        yet2Recover: document.getElementById("txtRollingFuturesYet2Recover"),
        netPl: document.getElementById("divRollingFuturesNetPl"),
        reEnterBrok: document.getElementById("chkRollingFuturesReEnterBrok"),
        closeBlockedMargin: document.getElementById("chkRollingFuturesCloseBlockedMargin"),
        blockedMarginPct: document.getElementById("txtRollingFuturesBlockedMarginPct"),
        reEnterBlock: document.getElementById("chkRollingFuturesReEnterBlock"),
        buyHedgeSellPremiumGate: document.getElementById("chkRollingFuturesBuyHedgeSellPremiumGate"),
        buyHedgeSellPremiumPct: document.getElementById("txtRollingFuturesBuyHedgeSellPremiumPct"),
        strangleDeltaDiffReplaceEnabled: document.getElementById("chkRollingFuturesStrangleDeltaDiffReplaceEnabled"),
        strangleDeltaDiffReplacePct: document.getElementById("txtRollingFuturesStrangleDeltaDiffReplacePct"),
        buyHedgeOppositeLegOnGate: document.getElementById("chkRollingFuturesBuyHedgeOppositeLegOnGate"),
        strangleReopenAtNewD: document.getElementById("chkRollingFuturesStrangleReopenAtNewD"),
        buyQtyPercentEnabled: document.getElementById("chkRollingFuturesBuyQtyPercentEnabled"),
        buyQtyPercent: document.getElementById("txtRollingFuturesBuyQtyPercent"),
        renkoEnabled: document.getElementById("chkRollingFuturesRenkoEnabled"),
        renkoBoxSize: document.getElementById("txtRollingFuturesRenkoBoxSize"),
        renkoBaseValue: document.getElementById("txtRollingFuturesRenkoBaseValue"),
        renkoSpotPrice: document.getElementById("rollingRenkoSpotPrice"),
        renkoCurrentBoxColor: document.getElementById("rollingRenkoCurrentBoxColor"),
        renkoFeedMeta: document.getElementById("rollingRenkoFeedMeta"),
        renkoHistoryLog: document.getElementById("rollingRenkoHistoryLog"),
        renkoRefreshButton: document.getElementById("btnRollingRenkoRefresh"),
        renkoClearButton: document.getElementById("btnRollingRenkoClear"),
        autoConfirmLiveActions: document.getElementById("chkRollingFuturesAutoConfirmLiveActions"),
        indicatorCard: document.getElementById("cardRollingFuturesDeltaDirec"),
        indicatorOverall: document.getElementById("rollingFuturesIndicatorOverall"),
        indicatorPcr: document.getElementById("rollingFuturesIndicatorPcr"),
        indicatorSupport: document.getElementById("rollingFuturesIndicatorSupport"),
        indicatorResistance: document.getElementById("rollingFuturesIndicatorResistance"),
        indicatorOrderBook: document.getElementById("rollingFuturesIndicatorOrderBook"),
        indicatorFlow: document.getElementById("rollingFuturesIndicatorFlow"),
        indicatorTrend: document.getElementById("rollingFuturesIndicatorTrend"),
        indicatorStrength: document.getElementById("rollingFuturesIndicatorStrength"),
        indicatorStrengthBar: document.getElementById("rollingFuturesIndicatorStrengthBar"),
        indicatorHistoryBar: document.getElementById("rollingFuturesIndicatorHistoryBar"),
        indicatorMeta: document.getElementById("rollingFuturesIndicatorMeta"),
        indicatorConfidence: document.getElementById("rollingFuturesIndicatorConfidence"),
        indicatorHeadline: document.getElementById("rollingFuturesIndicatorHeadline"),
        indicatorRefreshInput: document.getElementById("txtRollingFuturesIndicatorRefreshMins"),
        indicatorRefreshButton: document.getElementById("btnRollingFuturesIndicatorRefresh"),
        indicatorBody: document.getElementById("tBodyRollingFuturesDeltas"),
        recalculateTotalPnlButton: document.getElementById(`btn${idPrefix}RecalculateTotalPnl`),
        importButton: document.getElementById(`btn${idPrefix}ImportPositions`),
        clearOpenPositionsButton: document.getElementById(`btn${idPrefix}ClearOpenPositions`),
        refreshOpenPositionsButton: document.getElementById(`btn${idPrefix}RefreshOpenPositions`),
        killSwitchButton: document.getElementById(`btn${idPrefix}KillSwitch`),
        openPositionsBody: document.getElementById(`${prefix}OpenPositionsBody`),
        openPrevPageButton: document.getElementById(`btn${idPrefix}OpenPrevPage`),
        openNextPageButton: document.getElementById(`btn${idPrefix}OpenNextPage`),
        openPageInfo: document.getElementById(`${prefix}OpenPositionsPageInfo`),
        openPageNumbers: document.getElementById(`${prefix}OpenPageNumbers`),
        profitCloseTimer: document.getElementById(`${prefix}ProfitCloseTimer`),
        hedgeGateSummary: document.getElementById("rollingDualFuturesHedgeGateSummary"),
        closedFromDate: document.getElementById(`txt${idPrefix}ClosedFromDate`),
        closedToDate: document.getElementById(`txt${idPrefix}ClosedToDate`),
        clearClosedFiltersButton: document.getElementById(`btn${idPrefix}ClearClosedFilters`),
        updateRecoveryTotalsCheckbox: document.getElementById(`chk${idPrefix}UpdateRecoveryTotals`),
        clearClosedPositionsButton: document.getElementById(`btn${idPrefix}ClearClosedPositions`),
        refreshClosedPositionsButton: document.getElementById(`btn${idPrefix}RefreshClosedPositions`),
        closedPositionsBody: document.getElementById(`${prefix}ClosedPositionsBody`),
        closedPrevPageButton: document.getElementById(`btn${idPrefix}ClosedPrevPage`),
        closedNextPageButton: document.getElementById(`btn${idPrefix}ClosedNextPage`),
        closedPageInfo: document.getElementById(`${prefix}ClosedPositionsPageInfo`),
        closedPageNumbers: document.getElementById(`${prefix}ClosedPageNumbers`),
        refreshEventsButton: document.getElementById(`btn${idPrefix}RefreshEvents`),
        clearEventsButton: document.getElementById(`btn${idPrefix}ClearEvents`),
        eventLog: document.getElementById(`${prefix}EventLog`),
        confirmationEmpty: document.getElementById(`${prefix}ConfirmationEmpty`),
        confirmationPanel: document.getElementById(`${prefix}ConfirmationPanel`),
        confirmationTitle: document.getElementById(`${prefix}ConfirmationTitle`),
        confirmationTime: document.getElementById(`${prefix}ConfirmationTime`),
        confirmationMessage: document.getElementById(`${prefix}ConfirmationMessage`),
        confirmationSound: document.getElementById("chkRollingFuturesConfirmationSound"),
        confirmActionButton: document.getElementById(`btn${idPrefix}ConfirmAction`),
        rejectActionButton: document.getElementById(`btn${idPrefix}RejectAction`),
        telegramNotice: document.getElementById("rollingDualFuturesTelegramNotice"),
        telegramEventCheckboxes: Array.from(document.querySelectorAll(".rolling-demo-telegram-event")),
        importOverlay: document.getElementById(`${prefix}ImportOverlay`),
        importModal: document.getElementById(`${prefix}ImportModal`),
        importList: document.getElementById(`${prefix}ImportList`),
        closeImportModalButton: document.getElementById(`btn${idPrefix}CloseImportModal`),
        applyImportedPositionsButton: document.getElementById(`btn${idPrefix}ApplyImportedPositions`)
        ,
        savedProfilePanel: document.getElementById("rollingFuturesSavedProfilePanel"),
        savedProfileBody: document.getElementById("rollingFuturesSavedProfileBody")
    };

    let selectedApiProfileId = "";
    let connectionState = "not_selected";
    let displayedPositions = [];
    let openPositionsPage = 1;
    let importablePositions = [];
    let closedPositions = [];
    let closedPositionsPage = 1;
    let connectionPollTimer = null;
    let confirmationPollTimer = null;
    let isApplyingState = false;
    let saveTimer = null;
    let previousOpenPositionLtps = new Map();
    let runtimeStatus = "idle";
    let autoTraderEnabled = false;
    let manualFutureOrderInFlight = false;
    let manualOptionOrderInFlight = false;
    let execStrategyInFlight = false;
    let confirmationInFlight = false;
    let execStrategyEnabled = isDualLikeMode ? initialExecStrategyEnabled : true;
    let closedFiltersRefreshTimer = null;
    let indicatorRefreshTimer = null;
    let profitCloseCountdownTimer = null;
    let lastClosedPositionsRefreshAt = "";
    let adminRunningUsers = [];
    let targetUserId = requiresExplicitTargetSelection ? "" : currentAccountId;
    let currentTargetAccount = requiresExplicitTargetSelection
        ? {
            accountId: "",
            fullName: "",
            email: "",
            telegramChatId: "",
            execStrategy: false
        }
        : {
            accountId: currentAccountId,
            fullName: currentAccountFullName,
            email: currentAccountEmail,
            telegramChatId: currentAccountTelegramChatId,
            execStrategy: initialExecStrategyEnabled
        };
    let lastNeutralStatus = null;
    let lastRecoveryMetrics = null;
    let pendingLiveConfirmation = null;
    let profitClosePending = null;
    let localProfitClosePending = null;
    let lastOpenPositionsPayload = null;
    let confirmationAudioContext = null;
    let queuedConfirmationSoundActionId = "";
    let lastConfirmationSoundActionId = "";
    const confirmationSoundStorageKey = "optionyze.covered.confirmation-sound";
    let confirmationSoundEnabled = readConfirmationSoundPreference();
    let lastAccountSummary = null;
    let renkoReferencePrice = Number.NaN;
    let renkoLastColor = "neutral";
    let renkoLastLivePrice = Number.NaN;
    let renkoAutoTradeInFlight = false;
    let renkoBaseValuesBySymbol = { BTC: "", ETH: "" };
    let renkoStateBySymbol = {
        BTC: { referencePrice: "", lastColor: "neutral" },
        ETH: { referencePrice: "", lastColor: "neutral" }
    };
    const profitCloseConfirmationMs = 5 * 60 * 1000;
    let renkoHistoryBySymbol = { BTC: [], ETH: [] };
    let currentRenkoBaseSymbol = "BTC";
    const openPositionsPageSize = 10;
    const closedPositionsPageSize = 10;
    const coveredMultiplierMarginPerUnit = 1.5;

    function getCoveredMultiplierMin() {
        return (isDemoVariant || isStrangleLikePage) ? 1 : 2;
    }

    function clampCoveredMultiplierValue(value) {
        const vRaw = Math.floor(Number(value || 0));
        const vMinimum = getCoveredMultiplierMin();
        if (!Number.isFinite(vRaw) || vRaw < vMinimum) {
            return vMinimum;
        }
        return Math.min(1000, vRaw);
    }

    function getCoveredMultiplierDraftValue() {
        const vRaw = Math.floor(Number(ids.startQty?.value || 0));
        if (Number.isFinite(vRaw) && vRaw >= 1) {
            return Math.min(1000, vRaw);
        }
        return getCoveredMultiplierMin();
    }

    function getCoveredMultiplierValue() {
        if (!(ids.startQty instanceof HTMLInputElement)) {
            return getCoveredMultiplierMin();
        }
        return clampCoveredMultiplierValue(ids.startQty.value);
    }

    function getCoveredRequiredBlockedMargin(multiplierValue) {
        return Number((clampCoveredMultiplierValue(multiplierValue) * coveredMultiplierMarginPerUnit).toFixed(2));
    }

    function clampCoveredBuyQtyPercentValue(value) {
        const vRaw = Math.floor(Number(value || 0));
        if (!Number.isFinite(vRaw) || vRaw < 1) {
            return 1;
        }
        return Math.min(200, vRaw);
    }

    function clampRenkoBoxSizeValue(value) {
        const vRaw = Math.floor(Number(value || 0));
        if (!Number.isFinite(vRaw) || vRaw < 1) {
            return 100;
        }
        return Math.min(1000000, vRaw);
    }

    function getRenkoBoxSizeValue() {
        if (!(ids.renkoBoxSize instanceof HTMLInputElement)) {
            return 100;
        }
        return clampRenkoBoxSizeValue(ids.renkoBoxSize.value);
    }

    function normalizeRenkoBaseValue(value) {
        const vRaw = Number(value);
        if (!Number.isFinite(vRaw) || !(vRaw > 0)) {
            return "";
        }
        return String(Number(vRaw.toFixed(2)));
    }

    function normalizeRenkoBaseValues(value) {
        const source = value && typeof value === "object" ? value : {};
        return {
            BTC: normalizeRenkoBaseValue(source.BTC),
            ETH: normalizeRenkoBaseValue(source.ETH)
        };
    }

    function normalizeRenkoColorValue(value) {
        const normalized = String(value || "").trim().toLowerCase();
        return normalized === "green" || normalized === "red" ? normalized : "neutral";
    }

    function normalizeRenkoStateValues(value) {
        const source = value && typeof value === "object" ? value : {};
        function normalizeEntry(entry) {
            const sourceEntry = entry && typeof entry === "object" ? entry : {};
            return {
                referencePrice: normalizeRenkoBaseValue(sourceEntry.referencePrice),
                lastColor: normalizeRenkoColorValue(sourceEntry.lastColor)
            };
        }
        return {
            BTC: normalizeEntry(source.BTC),
            ETH: normalizeEntry(source.ETH)
        };
    }

    function normalizeRenkoHistoryValues(value) {
        const source = value && typeof value === "object" ? value : {};
        function normalizeEntries(entries) {
            return (Array.isArray(entries) ? entries : []).map(function (entry) {
                const sourceEntry = entry && typeof entry === "object" ? entry : {};
                const color = normalizeRenkoColorValue(sourceEntry.color);
                const changedAt = String(sourceEntry.changedAt || "").trim();
                const referencePrice = normalizeRenkoBaseValue(sourceEntry.referencePrice);
                return color === "neutral" || !changedAt
                    ? null
                    : {
                        color: color,
                        changedAt: changedAt,
                        referencePrice: referencePrice
                    };
            }).filter(Boolean).slice(0, 20);
        }
        return {
            BTC: normalizeEntries(source.BTC),
            ETH: normalizeEntries(source.ETH)
        };
    }

    function getCurrentSelectedSymbol() {
        return String(ids.symbol?.value || "BTC").trim().toUpperCase() === "ETH" ? "ETH" : "BTC";
    }

    function syncRenkoBaseValueForSymbol(symbol) {
        if (!(ids.renkoBaseValue instanceof HTMLInputElement)) {
            return;
        }
        const normalizedSymbol = String(symbol || "").trim().toUpperCase() === "ETH" ? "ETH" : "BTC";
        ids.renkoBaseValue.value = String(renkoBaseValuesBySymbol[normalizedSymbol] || "");
        currentRenkoBaseSymbol = normalizedSymbol;
        renderRenkoHistory();
    }

    function captureRenkoBaseValueForCurrentSymbol() {
        if (!(ids.renkoBaseValue instanceof HTMLInputElement)) {
            return;
        }
        const normalizedSymbol = String(currentRenkoBaseSymbol || getCurrentSelectedSymbol()).trim().toUpperCase() === "ETH" ? "ETH" : "BTC";
        const normalizedValue = normalizeRenkoBaseValue(ids.renkoBaseValue.value);
        ids.renkoBaseValue.value = normalizedValue;
        renkoBaseValuesBySymbol[normalizedSymbol] = normalizedValue;
    }

    function getRenkoBaseValue() {
        captureRenkoBaseValueForCurrentSymbol();
        const normalizedSymbol = getCurrentSelectedSymbol();
        return Number(renkoBaseValuesBySymbol[normalizedSymbol] || 0);
    }

    function getRenkoStateForSymbol(symbol) {
        const normalizedSymbol = String(symbol || "").trim().toUpperCase() === "ETH" ? "ETH" : "BTC";
        if (!renkoStateBySymbol[normalizedSymbol]) {
            renkoStateBySymbol[normalizedSymbol] = { referencePrice: "", lastColor: "neutral" };
        }
        return renkoStateBySymbol[normalizedSymbol];
    }

    function setRenkoStateForSymbol(symbol, referencePrice, lastColor) {
        const normalizedSymbol = String(symbol || "").trim().toUpperCase() === "ETH" ? "ETH" : "BTC";
        const nextReferencePrice = normalizeRenkoBaseValue(referencePrice);
        const nextLastColor = normalizeRenkoColorValue(lastColor);
        renkoStateBySymbol[normalizedSymbol] = {
            referencePrice: nextReferencePrice,
            lastColor: nextLastColor
        };
        if (normalizedSymbol === getCurrentSelectedSymbol()) {
            renkoReferencePrice = Number(nextReferencePrice || 0);
            if (!Number.isFinite(renkoReferencePrice) || !(renkoReferencePrice > 0)) {
                renkoReferencePrice = Number.NaN;
            }
            renkoLastColor = nextLastColor;
        }
    }

    function renderRenkoHistory() {
        if (!ids.renkoHistoryLog) {
            return;
        }
        const currentSymbol = getCurrentSelectedSymbol();
        const history = Array.isArray(renkoHistoryBySymbol[currentSymbol]) ? renkoHistoryBySymbol[currentSymbol] : [];
        if (!history.length) {
            ids.renkoHistoryLog.innerHTML = "<div class=\"rolling-demo-event-empty\">No Renko color changes yet.</div>";
            return;
        }
        ids.renkoHistoryLog.innerHTML = history.map(function (entry, index) {
            const color = normalizeRenkoColorValue(entry.color);
            const label = color === "green" ? "Green" : "Red";
            const toneClass = color === "green" ? "success" : "danger";
            const referenceText = entry.referencePrice ? ` | Level ${escapeHtml(entry.referencePrice)}` : "";
            return `
                <article class="rolling-demo-event-item ${toneClass}">
                    <div class="rolling-demo-event-head">
                        <div class="rolling-demo-event-title-stack">
                            <strong class="rolling-demo-event-title">${escapeHtml(label)} box confirmed</strong>
                        </div>
                        <div class="rolling-demo-event-actions">
                            <span class="rolling-demo-event-time">${escapeHtml(formatDateTimeDisplay(entry.changedAt))}</span>
                            <button class="rolling-demo-icon-btn warn rolling-renko-delete-entry" type="button" data-entry-index="${escapeHtml(index)}" title="Delete this Renko feed entry" aria-label="Delete this Renko feed entry">
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M18 6 6 18" />
                                    <path d="m6 6 12 12" />
                                </svg>
                            </button>
                        </div>
                    </div>
                    <p class="rolling-demo-event-message">${escapeHtml(currentSymbol)}${referenceText}</p>
                </article>
            `;
        }).join("");
    }

    function appendRenkoHistoryEntry(symbol, color, referencePrice) {
        const normalizedSymbol = String(symbol || "").trim().toUpperCase() === "ETH" ? "ETH" : "BTC";
        const normalizedColor = normalizeRenkoColorValue(color);
        if (normalizedColor === "neutral") {
            return;
        }
        const nextEntry = {
            color: normalizedColor,
            changedAt: new Date().toISOString(),
            referencePrice: normalizeRenkoBaseValue(referencePrice)
        };
        const currentEntries = Array.isArray(renkoHistoryBySymbol[normalizedSymbol]) ? renkoHistoryBySymbol[normalizedSymbol] : [];
        renkoHistoryBySymbol[normalizedSymbol] = [nextEntry].concat(currentEntries).slice(0, 20);
        if (normalizedSymbol === getCurrentSelectedSymbol()) {
            renderRenkoHistory();
        }
    }

    function getRenkoAutoTradeConfig(color) {
        const normalizedColor = normalizeRenkoColorValue(color);
        if (normalizedColor === "green") {
            return {
                action: "sell",
                legSide: "pe",
                rowIndex: 1,
                label: "SELL PE"
            };
        }
        if (normalizedColor === "red") {
            return {
                action: "sell",
                legSide: "ce",
                rowIndex: 2,
                label: "SELL CE"
            };
        }
        return null;
    }

    function triggerRenkoAutoTrade(symbol, color) {
        if (!isDemoVariant || !supportsRenkoFeed) {
            return;
        }
        const tradeConfig = getRenkoAutoTradeConfig(color);
        if (!tradeConfig || renkoAutoTradeInFlight) {
            return;
        }
        renkoAutoTradeInFlight = true;
        void Promise.resolve().then(function () {
            if (autoTraderEnabled) {
                return null;
            }
            return loadRuntimeStatus().catch(function () { return undefined; });
        }).then(function () {
            if (!autoTraderEnabled) {
                throw new Error("Turn Auto Trader ON before Renko auto trades can place paper positions.");
            }
            applyExpiryModeDefaults(true, tradeConfig.rowIndex);
            return placeManualOption(tradeConfig.action, tradeConfig.legSide, tradeConfig.rowIndex);
        }).then(function (objResult) {
            const trackedPayload = objResult?.data?.trackedOpenPositions || null;
            const objOrder = objResult?.data?.order || {};
            const vOrderId = String(objOrder.id || objOrder.order_id || "").trim();
            const vMessage = String(objResult?.message || `${tradeConfig.label} paper option opened.`).trim();
            if (trackedPayload) {
                renderOpenPositions(trackedPayload);
            }
            setStatus(
                ids.pageStatus,
                vOrderId
                    ? `Renko ${String(color || "").trim().toUpperCase()} detected for ${symbol}. ${vMessage} Order ID: ${vOrderId}`
                    : `Renko ${String(color || "").trim().toUpperCase()} detected for ${symbol}. ${vMessage}`,
                "success"
            );
            return Promise.all([
                loadAccountSummary().catch(function () { return undefined; }),
                loadConnectionStatus().catch(function () { return undefined; }),
                loadEvents().catch(function () { return undefined; }),
                loadSavedOpenPositions().catch(function () { return undefined; })
            ]);
        }).catch(function (error) {
            setStatus(
                ids.pageStatus,
                error instanceof Error ? error.message : `Unable to place Renko ${tradeConfig.label} paper option.`,
                "danger"
            );
        }).finally(function () {
            renkoAutoTradeInFlight = false;
        });
    }

    function clearRenkoFeedForSymbol(symbol) {
        const normalizedSymbol = String(symbol || "").trim().toUpperCase() === "ETH" ? "ETH" : "BTC";
        renkoHistoryBySymbol[normalizedSymbol] = [];
        setRenkoStateForSymbol(normalizedSymbol, "", "neutral");
        if (normalizedSymbol === getCurrentSelectedSymbol()) {
            renkoLastLivePrice = Number.NaN;
            renderRenkoHistory();
            setRenkoSpotPriceDisplay(Number.NaN);
            setRenkoColorDisplay("neutral", "Waiting", "Renko feed cleared. Refresh to start tracking again.");
        }
    }

    function getRenkoFeedEnabled() {
        return supportsRenkoFeed && ids.renkoEnabled instanceof HTMLInputElement && ids.renkoEnabled.checked;
    }

    function setRenkoColorDisplay(color, label, metaText) {
        if (ids.renkoCurrentBoxColor) {
            ids.renkoCurrentBoxColor.classList.remove("green", "red", "neutral");
            ids.renkoCurrentBoxColor.classList.add(color === "green" || color === "red" ? color : "neutral");
            ids.renkoCurrentBoxColor.textContent = label;
        }
        if (ids.renkoFeedMeta) {
            ids.renkoFeedMeta.textContent = metaText;
        }
    }

    function setRenkoSpotPriceDisplay(value) {
        if (!ids.renkoSpotPrice) {
            return;
        }
        ids.renkoSpotPrice.textContent = Number.isFinite(value) ? fmt(value, 2) : "--";
    }

    function getRenkoLivePrice(summary) {
        if (!supportsRenkoFeed) {
            return Number.NaN;
        }
        const directSpotPrice = Number(summary?.spotPrice ?? summary?.futuresPrice ?? summary?.markPrice);
        if (Number.isFinite(directSpotPrice) && directSpotPrice > 0) {
            return Number(directSpotPrice.toFixed(2));
        }
        const vSymbol = String(ids.symbol?.value || "BTC").trim().toUpperCase();
        const lotSize = Number(symbolConfig[vSymbol]?.lotSize || 0);
        const oneLotValue = Number(summary?.oneLotValue);
        if (!Number.isFinite(oneLotValue) || !(oneLotValue > 0) || !Number.isFinite(lotSize) || !(lotSize > 0)) {
            return Number.NaN;
        }
        return Number((oneLotValue / lotSize).toFixed(2));
    }

    function resetRenkoFeedState(reasonText, resetPersistentState) {
        if (resetPersistentState !== false) {
            setRenkoStateForSymbol(getCurrentSelectedSymbol(), "", "neutral");
        }
        renkoLastLivePrice = Number.NaN;
        if (!supportsRenkoFeed) {
            return;
        }
        renderRenkoHistory();
        setRenkoColorDisplay("neutral", "Waiting", String(reasonText || "").trim() || "Turn the Renko feed ON to begin tracking live box color.");
    }

    function updateRenkoFeedDisplay(summary) {
        if (!supportsRenkoFeed) {
            return;
        }
        const currentSymbol = getCurrentSelectedSymbol();
        const currentState = getRenkoStateForSymbol(currentSymbol);
        const livePrice = getRenkoLivePrice(summary);
        setRenkoSpotPriceDisplay(livePrice);
        const boxSize = getRenkoBoxSizeValue();
        const baseValue = getRenkoBaseValue();
        const previousReferencePrice = currentState.referencePrice;
        const previousLastColor = currentState.lastColor;
        if (!getRenkoFeedEnabled()) {
            resetRenkoFeedState("Renko feed is OFF.");
            return;
        }
        if (!Number.isFinite(baseValue) || !(baseValue > 0)) {
            setRenkoStateForSymbol(currentSymbol, "", "neutral");
            setRenkoColorDisplay("neutral", "Waiting", `Feed ON | Box ${boxSize} | Enter a base value to start tracking.`);
            return;
        }
        if (!Number.isFinite(livePrice) || !(livePrice > 0)) {
            setRenkoStateForSymbol(currentSymbol, currentState.referencePrice || baseValue, currentState.lastColor);
            setRenkoColorDisplay("neutral", "Waiting", `Feed ON | Base ${fmt(baseValue, 2)} | Box ${boxSize} | Waiting for live price...`);
            return;
        }
        renkoLastLivePrice = livePrice;
        const currentReference = Number(currentState.referencePrice || 0);
        const hasReference = Number.isFinite(currentReference) && currentReference > 0;
        let nextReferencePrice = hasReference ? currentReference : baseValue;
        let nextLastColor = normalizeRenkoColorValue(currentState.lastColor);
        if (nextLastColor === "neutral") {
            const priceDeltaFromBase = livePrice - baseValue;
            if (priceDeltaFromBase >= boxSize) {
                nextReferencePrice = baseValue + (Math.floor(priceDeltaFromBase / boxSize) * boxSize);
                nextLastColor = "green";
            }
            else if (priceDeltaFromBase <= (-1 * boxSize)) {
                nextReferencePrice = baseValue - (Math.floor(Math.abs(priceDeltaFromBase) / boxSize) * boxSize);
                nextLastColor = "red";
            }
            else {
                nextReferencePrice = baseValue;
                nextLastColor = "neutral";
            }
        }
        else if (nextLastColor === "green") {
            if (livePrice >= nextReferencePrice + boxSize) {
                nextReferencePrice += Math.floor((livePrice - nextReferencePrice) / boxSize) * boxSize;
            }
            else if (livePrice <= nextReferencePrice - boxSize) {
                nextReferencePrice -= Math.floor((nextReferencePrice - livePrice) / boxSize) * boxSize;
                nextLastColor = "red";
            }
        }
        else if (nextLastColor === "red") {
            if (livePrice <= nextReferencePrice - boxSize) {
                nextReferencePrice -= Math.floor((nextReferencePrice - livePrice) / boxSize) * boxSize;
            }
            else if (livePrice >= nextReferencePrice + boxSize) {
                nextReferencePrice += Math.floor((livePrice - nextReferencePrice) / boxSize) * boxSize;
                nextLastColor = "green";
            }
        }
        setRenkoStateForSymbol(currentSymbol, nextReferencePrice, nextLastColor);
        if (previousLastColor !== nextLastColor && nextLastColor !== "neutral") {
            appendRenkoHistoryEntry(currentSymbol, nextLastColor, nextReferencePrice);
            triggerRenkoAutoTrade(currentSymbol, nextLastColor);
        }
        if (nextLastColor === "neutral") {
            setRenkoColorDisplay("neutral", "Waiting", `Feed ON | Base ${fmt(baseValue, 2)} | Price ${fmt(livePrice, 2)} | Waiting for first box.`);
        }
        else {
            const colorLabel = nextLastColor === "green" ? "Green" : "Red";
            setRenkoColorDisplay(
                nextLastColor,
                colorLabel,
                `Feed ON | Anchor ${fmt(baseValue, 2)} | Box ${boxSize} | Price ${fmt(livePrice, 2)} | Current ${fmt(nextReferencePrice, 2)}`
            );
        }
        if (previousReferencePrice !== renkoStateBySymbol[currentSymbol].referencePrice
            || previousLastColor !== renkoStateBySymbol[currentSymbol].lastColor) {
            queueProfileSave();
        }
    }

    function getCoveredBuyQtyPercentValue() {
        if (!(ids.buyQtyPercent instanceof HTMLInputElement)) {
            return 100;
        }
        return clampCoveredBuyQtyPercentValue(ids.buyQtyPercent.value);
    }

    function resolveCoveredBuyRowQty(multiplierValue) {
        const vMultiplier = clampCoveredMultiplierValue(multiplierValue);
        const bEnabled = ids.buyQtyPercentEnabled instanceof HTMLInputElement && ids.buyQtyPercentEnabled.checked;
        if (!bEnabled) {
            return vMultiplier;
        }
        const vPercent = getCoveredBuyQtyPercentValue();
        return Math.max(1, Math.floor((vMultiplier * vPercent) / 100));
    }

    function refreshCoveredBalanceSummaryDisplay() {
        if (!isCoveredMode) {
            return;
        }
        const vMultiplier = getCoveredMultiplierValue();
        const vRequiredMargin = getCoveredRequiredBlockedMargin(vMultiplier);
        if (ids.blockedMarginValue) {
            ids.blockedMarginValue.textContent = fmtUsd(vRequiredMargin);
            ids.blockedMarginValue.title = `Estimated blocked margin from Multiplier ${vMultiplier} x ${coveredMultiplierMarginPerUnit.toFixed(2)} USD`;
        }
        if (ids.availableBalanceValue) {
            const vTotalBalance = Number(lastAccountSummary?.totalBalance);
            const vEstimatedAvailableBalance = Number.isFinite(vTotalBalance)
                ? Math.max(0, Number((vTotalBalance - vRequiredMargin).toFixed(2)))
                : null;
            if (vEstimatedAvailableBalance === null) {
                ids.availableBalanceValue.textContent = fmtUsd(lastAccountSummary?.availableBalance);
                ids.availableBalanceValue.removeAttribute("title");
            }
            else {
                ids.availableBalanceValue.textContent = fmtUsd(vEstimatedAvailableBalance);
                ids.availableBalanceValue.title = `Estimated available balance from Total Balance ${vTotalBalance.toFixed(2)} USD - Required Margin ${vRequiredMargin.toFixed(2)} USD`;
            }
        }
        renderNetPnlValue();
    }

    function ensureCoveredExecBalance() {
        if (!isCoveredMode) {
            return;
        }
        const vAvailableBalance = Number(lastAccountSummary?.availableBalance);
        const vRequiredMargin = getCoveredRequiredBlockedMargin(getCoveredMultiplierValue());
        if (!Number.isFinite(vAvailableBalance) || vAvailableBalance <= 0) {
            throw new Error("Available Balance is not loaded yet. Refresh connection and try again.");
        }
        if (vAvailableBalance < vRequiredMargin) {
            throw new Error(`Balance insufficient for the selected qty. Required ${vRequiredMargin.toFixed(2)} USD, available ${vAvailableBalance.toFixed(2)} USD.`);
        }
    }

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

    function formatSavedProfileValue(value, fallbackValue) {
        const text = String(value ?? "").trim();
        return text || String(fallbackValue ?? "-").trim() || "-";
    }

    function renderSavedManualTraderProfile(uiState) {
        if (!ids.savedProfilePanel || !ids.savedProfileBody) {
            return;
        }
        const state = { ...getDefaultUiState(), ...(uiState || {}) };
        const rowBlocks = getSupportedOptionRowIndexes().map(function (rowIndex) {
            const keys = getOptionRowStateKeys(rowIndex);
            return `
                <div class="rolling-futures-saved-profile-card">
                    <div class="rolling-futures-saved-profile-title">Row ${rowIndex}</div>
                    <div class="rolling-futures-saved-profile-grid">
                        <span>Action: <strong>${escapeHtml(formatSavedProfileValue(state[keys.action], "-"))}</strong></span>
                        <span>Legs: <strong>${escapeHtml(formatSavedProfileValue(state[keys.legs], "-"))}</strong></span>
                        <span>Expiry: <strong>${escapeHtml(formatSavedProfileValue(state[keys.expiryDate], "-"))}</strong></span>
                        <span>Qty: <strong>${escapeHtml(formatSavedProfileValue(state[keys.qty], "-"))}</strong></span>
                        <span>New D: <strong>${escapeHtml(formatSavedProfileValue(state[keys.newD], "-"))}</strong></span>
                        <span>TP D: <strong>${escapeHtml(formatSavedProfileValue(state[keys.tpD], "-"))}</strong></span>
                        <span>SL D: <strong>${escapeHtml(formatSavedProfileValue(state[keys.slD], "-"))}</strong></span>
                    </div>
                </div>
            `;
        }).join("");
        const gateBlock = isCoveredMode ? `
            <div class="rolling-futures-saved-profile-card">
                <div class="rolling-futures-saved-profile-title">${isStrangleLikePage ? "Delta Gap Replace Rule" : "Trade Lot Increment"}</div>
                <div class="rolling-futures-saved-profile-grid">
                    ${isStrangleLikePage
                        ? `<span>Enabled: <strong>${escapeHtml(String(Boolean(state.strangleDeltaDiffReplaceEnabled)) === "true" ? "ON" : "OFF")}</strong></span>
                    <span>Threshold %: <strong>${escapeHtml(formatSavedProfileValue(state.strangleDeltaDiffReplacePct, "50"))}</strong></span>`
                        : `<span>Enabled: <strong>${escapeHtml(String(Boolean(state.buyHedgeSellPremiumGate)) === "true" ? "ON" : "OFF")}</strong></span>
                    <span>Increment Lots: <strong>${escapeHtml(formatSavedProfileValue(state.buyHedgeSellPremiumPct, "1"))}</strong></span>`}
                </div>
            </div>
            <div class="rolling-futures-saved-profile-card">
                <div class="rolling-futures-saved-profile-title">${isStrangleLikePage ? "Reopen Rule" : "Buy Qty Rule"}</div>
                <div class="rolling-futures-saved-profile-grid">
                    ${isStrangleLikePage
                        ? `<span>Reopen At New D: <strong>${escapeHtml(String(Boolean(state.strangleReopenAtNewD)) === "true" ? "ON" : "OFF")}</strong></span>`
                        : `<span>Enabled: <strong>${escapeHtml(String(Boolean(state.buyQtyPercentEnabled)) === "true" ? "ON" : "OFF")}</strong></span>
                    <span>Buy Qty %: <strong>${escapeHtml(formatSavedProfileValue(state.buyQtyPercent, "100"))}</strong></span>`}
                </div>
            </div>
        ` : "";
        const renkoBlock = supportsRenkoFeed ? `
            <div class="rolling-futures-saved-profile-card">
                <div class="rolling-futures-saved-profile-title">Renko Feed</div>
                <div class="rolling-futures-saved-profile-grid">
                    <span>Enabled: <strong>${escapeHtml(String(Boolean(state.renkoEnabled)) === "true" ? "ON" : "OFF")}</strong></span>
                    <span>Box Size: <strong>${escapeHtml(formatSavedProfileValue(state.renkoStepPoints, "100"))}</strong></span>
                    <span>BTC Base: <strong>${escapeHtml(formatSavedProfileValue(state.renkoBaseValues?.BTC || "", "-"))}</strong></span>
                    <span>ETH Base: <strong>${escapeHtml(formatSavedProfileValue(state.renkoBaseValues?.ETH || "", "-"))}</strong></span>
                </div>
            </div>
        ` : "";
        ids.savedProfileBody.innerHTML = `${rowBlocks}${gateBlock}${renkoBlock}`;
        ids.savedProfilePanel.style.display = "";
    }

    async function showSavedManualTraderProfile() {
        const objResult = await getJson(`${endpointBase}/profile`);
        renderSavedManualTraderProfile(objResult?.data?.uiState || {});
        return objResult;
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

    function formatDateTimeInputValue(dateValue) {
        if (!(dateValue instanceof Date) || Number.isNaN(dateValue.getTime())) {
            return "";
        }
        const objDeltaDate = new Date(dateValue.getTime() + (deltaUiTimezoneOffsetMinutes * 60 * 1000));
        const year = String(objDeltaDate.getUTCFullYear());
        const month = String(objDeltaDate.getUTCMonth() + 1).padStart(2, "0");
        const day = String(objDeltaDate.getUTCDate()).padStart(2, "0");
        const hour = String(objDeltaDate.getUTCHours()).padStart(2, "0");
        const minute = String(objDeltaDate.getUTCMinutes()).padStart(2, "0");
        return `${year}-${month}-${day}T${hour}:${minute}`;
    }

    function formatCountdownDuration(msRemaining) {
        const totalSeconds = Math.max(0, Math.ceil(msRemaining / 1000));
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
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

    function getSupportedOptionRowIndexes() {
        return isCoveredMode ? [1, 2] : [1];
    }

    function normalizeOptionRowIndex(rowIndex) {
        const vRowIndex = Number(rowIndex);
        return isCoveredMode && vRowIndex === 2 ? 2 : 1;
    }

    function getOptionRowNodes(rowIndex) {
        const vRowIndex = normalizeOptionRowIndex(rowIndex);
        if (vRowIndex === 2) {
            return {
                action: ids.action2,
                legs: ids.legs2,
                expiryMode: ids.optionExpiryMode2,
                expiryDate: ids.optionExpiryDate2,
                qty: ids.qty2,
                newD: ids.newD2,
                reD: ids.reD2,
                tpD: ids.tpD2,
                slD: ids.slD2,
                reEnter: ids.reEnter2,
                sellPeButton: ids.sellPeButton2,
                sellCeButton: ids.sellCeButton2,
                buyCeButton: ids.buyCeButton2,
                buyPeButton: ids.buyPeButton2
            };
        }
        return {
            action: ids.action1,
            legs: ids.legs1,
            expiryMode: ids.optionExpiryMode,
            expiryDate: ids.optionExpiryDate,
            qty: ids.qty1,
            newD: ids.newD1,
            reD: ids.reD1,
            tpD: ids.tpD1,
            slD: ids.slD1,
            reEnter: ids.reEnter1,
            sellPeButton: ids.sellPeButton,
            sellCeButton: ids.sellCeButton,
            buyCeButton: ids.buyCeButton,
            buyPeButton: ids.buyPeButton
        };
    }

    function getOptionRowStateKeys(rowIndex) {
        const vRowIndex = normalizeOptionRowIndex(rowIndex);
        return {
            action: `action${vRowIndex}`,
            legs: `legs${vRowIndex}`,
            expiryMode: `expiryMode${vRowIndex}`,
            expiryDate: `expiryDate${vRowIndex}`,
            qty: `qty${vRowIndex}`,
            newD: `newD${vRowIndex}`,
            reD: `reD${vRowIndex}`,
            tpD: `tpD${vRowIndex}`,
            slD: `slD${vRowIndex}`,
            reEnter: `reEnter${vRowIndex}`
        };
    }

    function getOptionRowDefaultState(rowIndex) {
        const vRowIndex = normalizeOptionRowIndex(rowIndex);
        const isLong = mode === "long";
        const defaultLegs = isDualLikeMode ? "both" : (mode === "short" ? "pe" : "ce");
        const optionDefaults = {
            action: "sell",
            legs: defaultLegs,
            expiryMode: isDualLikeMode ? "5" : "5",
            expiryDate: "",
            qty: "1",
            newD: isDualLikeMode ? "0.65" : (isLong ? "0.65" : "0.65"),
            reD: isDualLikeMode ? "0.65" : (isLong ? "0.65" : "0.65"),
            tpD: isDualLikeMode ? "0.30" : (isLong ? "0.30" : "0.30"),
            slD: isDualLikeMode ? "0.80" : (isLong ? "0.80" : "0.80"),
            reEnter: true
        };
        if (isCoveredMode && vRowIndex === 2) {
            const coveredBuyDefaults = {
                ...optionDefaults,
                action: "buy",
                expiryMode: "1",
                newD: "0.13",
                reD: "0.13",
                tpD: "1.00",
                slD: "0.05"
            };
            return isStrangleLikePage
                ? {
                    ...coveredBuyDefaults,
                    action: "sell",
                    legs: "pe",
                    expiryMode: "6",
                    newD: "0.33",
                    reD: "0.33",
                    tpD: "0.10",
                    slD: "0.55"
                }
                : coveredBuyDefaults;
        }
        if (isCoveredMode && vRowIndex === 1) {
            const coveredSellDefaults = {
                ...optionDefaults,
                action: "sell",
                expiryMode: "6",
                newD: "0.33",
                reD: "0.33",
                tpD: "0.10",
                slD: "0.50"
            };
            return isStrangleLikePage
                ? {
                    ...coveredSellDefaults,
                    legs: "ce",
                    slD: "0.55"
                }
                : coveredSellDefaults;
        }
        return optionDefaults;
    }

    function readOptionRowState(rowIndex) {
        const vRowIndex = normalizeOptionRowIndex(rowIndex);
        const keys = getOptionRowStateKeys(vRowIndex);
        const nodes = getOptionRowNodes(vRowIndex);
        const defaults = getOptionRowDefaultState(vRowIndex);
        const vLegs = getInputValue(nodes.legs, defaults.legs).toLowerCase();
        const rowState = {};
        rowState[keys.action] = getInputValue(nodes.action, defaults.action).toLowerCase() === "buy" ? "buy" : "sell";
        rowState[keys.legs] = isDualLikeMode && vLegs === "both"
            ? "both"
            : (vLegs === "pe" ? "pe" : "ce");
        rowState[keys.expiryMode] = String(nodes.expiryMode?.value || defaults.expiryMode).trim();
        rowState[keys.expiryDate] = String(nodes.expiryDate?.value || defaults.expiryDate).trim();
        rowState[keys.qty] = getInputValue(nodes.qty, defaults.qty);
        rowState[keys.newD] = getInputValue(nodes.newD, defaults.newD);
        rowState[keys.reD] = isStrangleLikePage
            ? rowState[keys.newD]
            : getInputValue(nodes.reD, defaults.reD);
        rowState[keys.tpD] = getInputValue(nodes.tpD, defaults.tpD);
        rowState[keys.slD] = getInputValue(nodes.slD, defaults.slD);
        rowState[keys.reEnter] = getCheckboxValue(nodes.reEnter, defaults.reEnter);
        return rowState;
    }

    function applyOptionRowState(uiState, rowIndex) {
        const vRowIndex = normalizeOptionRowIndex(rowIndex);
        const keys = getOptionRowStateKeys(vRowIndex);
        const nodes = getOptionRowNodes(vRowIndex);
        const defaults = getOptionRowDefaultState(vRowIndex);
        const defaultLegs = defaults.legs;
        const savedLegs = uiState[keys.legs];
        const finalLegs = isDualLikeMode
            ? ((savedLegs === "both" || savedLegs === "pe" || savedLegs === "ce") ? savedLegs : defaultLegs)
            : ((savedLegs === "pe" || savedLegs === "ce") ? savedLegs : defaultLegs);
        setInputValue(nodes.action, String(uiState[keys.action] || defaults.action).trim().toLowerCase() === "buy" ? "buy" : "sell");
        setInputValue(nodes.legs, finalLegs);
        setInputValue(nodes.expiryMode, String(uiState[keys.expiryMode] || defaults.expiryMode).trim() || defaults.expiryMode);
        setInputValue(nodes.expiryDate, String(uiState[keys.expiryDate] || defaults.expiryDate).trim());
        setInputValue(nodes.qty, uiState[keys.qty] ?? defaults.qty);
        setInputValue(nodes.newD, uiState[keys.newD] ?? defaults.newD);
        setInputValue(nodes.reD, isStrangleLikePage ? (uiState[keys.newD] ?? defaults.newD) : (uiState[keys.reD] ?? defaults.reD));
        setInputValue(nodes.tpD, uiState[keys.tpD] ?? defaults.tpD);
        setInputValue(nodes.slD, uiState[keys.slD] ?? defaults.slD);
        setCheckboxValue(nodes.reEnter, uiState[keys.reEnter] ?? defaults.reEnter);
    }

    function formatCurrentDateTimeLocalValue() {
        const dateValue = new Date(Date.now() + (deltaUiTimezoneOffsetMinutes * 60 * 1000));
        const yearValue = dateValue.getUTCFullYear();
        const monthValue = String(dateValue.getUTCMonth() + 1).padStart(2, "0");
        const dayValue = String(dateValue.getUTCDate()).padStart(2, "0");
        const hourValue = String(dateValue.getUTCHours()).padStart(2, "0");
        const minuteValue = String(dateValue.getUTCMinutes()).padStart(2, "0");
        return `${yearValue}-${monthValue}-${dayValue}T${hourValue}:${minuteValue}`;
    }

    function getDefaultUiState() {
        const defaultState = {
            startQty: (isDemoVariant || isStrangleLikePage) ? "1" : "2",
            symbol: "BTC",
            manualFutOrderType: "market_order",
            bsFutQty: "1",
            minusDelta: isDualLikeMode ? "-25" : "-15",
            plusDelta: isDualLikeMode ? "25" : "20",
            onlyDeltaNeutral: false,
            rangeDeltaNeutral: false,
            gammaAwareNeutral: false,
            closeNetProfitBrokerage: false,
            brokerageMultiplier: isStrangleLikePage ? "5" : "10",
            reEnterBrok: false,
            closeBlockedMargin: false,
            blockedMarginPct: isStrangleLikePage ? "10" : "20",
            reEnterBlock: false,
            buyHedgeSellPremiumGate: true,
            buyHedgeSellPremiumPct: "1",
            strangleDeltaDiffReplaceEnabled: isStrangleLikePage,
            strangleDeltaDiffReplacePct: isStrangleLikePage ? "40" : "50",
            buyHedgeOppositeLegOnGate: false,
            strangleReopenAtNewD: false,
            buyQtyPercentEnabled: false,
            buyQtyPercent: "100",
            renkoEnabled: false,
            renkoStepPoints: "100",
            renkoBaseValue: "",
            renkoBaseValues: { BTC: "", ETH: "" },
            renkoStateBySymbol: {
                BTC: { referencePrice: "", lastColor: "neutral" },
                ETH: { referencePrice: "", lastColor: "neutral" }
            },
            renkoHistoryBySymbol: { BTC: [], ETH: [] },
            autoConfirmLiveActions: true,
            onlyDeltaNeutral: !isDualLikeMode && !isCoveredMode,
            rangeDeltaNeutral: isDualLikeMode && !isCoveredMode,
            gammaAwareNeutral: false,
            telegramAlertTypes: supportsTelegramAlerts
                ? [
                    "engine_stopped",
                    "engine_error",
                    "future_opened",
                    "future_closed",
                    "option_opened",
                    "option_closed",
                    "sl_triggered"
                ]
                : [],
            closedFromDate: "",
            closedToDate: ""
        };
        getSupportedOptionRowIndexes().forEach(function (rowIndex) {
            const keys = getOptionRowStateKeys(rowIndex);
            const defaults = getOptionRowDefaultState(rowIndex);
            defaultState[keys.action] = defaults.action;
            defaultState[keys.legs] = defaults.legs;
            defaultState[keys.expiryMode] = defaults.expiryMode;
            defaultState[keys.expiryDate] = defaults.expiryDate;
            defaultState[keys.qty] = defaults.qty;
            defaultState[keys.newD] = defaults.newD;
            defaultState[keys.reD] = defaults.reD;
            defaultState[keys.tpD] = defaults.tpD;
            defaultState[keys.slD] = defaults.slD;
            defaultState[keys.reEnter] = defaults.reEnter;
        });
        return defaultState;
    }

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

    function formatRuntimeStatusDateTime(dateValue) {
        const objDate = new Date(String(dateValue || "").trim());
        if (Number.isNaN(objDate.getTime())) {
            return "";
        }
        const objDeltaDate = new Date(objDate.getTime() + (deltaUiTimezoneOffsetMinutes * 60 * 1000));
        const day = String(objDeltaDate.getUTCDate()).padStart(2, "0");
        const month = String(objDeltaDate.getUTCMonth() + 1).padStart(2, "0");
        const year = String(objDeltaDate.getUTCFullYear());
        const hour = String(objDeltaDate.getUTCHours()).padStart(2, "0");
        const minute = String(objDeltaDate.getUTCMinutes()).padStart(2, "0");
        return `${day}-${month}-${year} ${hour}:${minute}`;
    }

    function isAdminTargetModeActive() {
        return (mode === "dual" && currentAccountIsAdmin)
            || (mode === "covered" && currentAccountIsVerifier);
    }

    function getEffectiveTargetUserId() {
        if (!isAdminTargetModeActive()) {
            return "";
        }
        const vTargetUserId = String(targetUserId || currentAccountId || "").trim();
        return vTargetUserId || currentAccountId;
    }

    function withTargetUrl(url) {
        if (!isAdminTargetModeActive()) {
            return url;
        }
        const vTargetUserId = getEffectiveTargetUserId();
        if (!vTargetUserId) {
            return url;
        }
        const objUrl = new URL(url, window.location.origin);
        objUrl.searchParams.set("targetUserId", vTargetUserId);
        return `${objUrl.pathname}${objUrl.search}`;
    }

    function withTargetPayload(payload) {
        if (!isAdminTargetModeActive()) {
            return payload || {};
        }
        const vTargetUserId = getEffectiveTargetUserId();
        return {
            ...(payload || {}),
            targetUserId: vTargetUserId
        };
    }

    function updateAdminTargetMeta() {
        if (!ids.adminTargetMeta) {
            return;
        }
        const objTarget = currentTargetAccount || {};
        const vFullName = String(objTarget.fullName || "").trim();
        const vEmail = String(objTarget.email || "").trim();
        if (requiresExplicitTargetSelection && !String(objTarget.accountId || "").trim()) {
            ids.adminTargetMeta.textContent = `Select a running ${strategyLabel} user to load settings and positions.`;
            return;
        }
        ids.adminTargetMeta.textContent = vFullName
            ? `Viewing ${vFullName}${vEmail ? ` (${vEmail})` : ""}.`
            : "Choose a running Dual strategy user to view or control.";
    }

    function updateTelegramNotice() {
        if (!supportsTelegramAlerts || !ids.telegramNotice) {
            return;
        }
        const objTarget = currentTargetAccount || {};
        const vChatId = String(objTarget.telegramChatId || "").trim();
        const vFullName = String(objTarget.fullName || "").trim();
        if (requiresExplicitTargetSelection && !String(objTarget.accountId || "").trim()) {
            ids.telegramNotice.innerHTML = `Select a running ${escapeHtml(strategyLabel)} user to view Telegram details.`;
            return;
        }
        if (vChatId) {
            ids.telegramNotice.innerHTML = isAdminTargetModeActive() && vFullName
                ? `Telegram Chat ID for <strong>${escapeHtml(vFullName)}</strong>: <strong>${escapeHtml(vChatId)}</strong>`
                : `Telegram Chat ID configured: <strong>${escapeHtml(vChatId)}</strong>`;
            return;
        }
        ids.telegramNotice.innerHTML = isAdminTargetModeActive() && vFullName
            ? `Telegram Chat ID is not set for <strong>${escapeHtml(vFullName)}</strong> yet.`
            : 'Telegram Chat ID is not set on your profile yet. Add it in <a href="/account/profile">My Profile</a> to receive alerts.';
    }

    async function getJson(url) {
        const objResponse = await fetch(withTargetUrl(url), { credentials: "same-origin" });
        const objPayload = await objResponse.json().catch(function () { return {}; });
        if (!objResponse.ok) {
            throw new Error(String(objPayload?.message || `Request failed with status ${objResponse.status}`));
        }
        return objPayload;
    }

    async function postJson(url, payload) {
        const objResponse = await fetch(withTargetUrl(url), {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(withTargetPayload(payload))
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

    function applyExpiryModeDefaults(force, rowIndex) {
        const rowIndexes = typeof rowIndex === "number" ? [normalizeOptionRowIndex(rowIndex)] : getSupportedOptionRowIndexes();
        rowIndexes.forEach(function (currentRowIndex) {
            const nodes = getOptionRowNodes(currentRowIndex);
            if (!(nodes.expiryMode instanceof HTMLSelectElement) || !(nodes.expiryDate instanceof HTMLInputElement)) {
                return;
            }
            const resolvedDate = resolveExpiryDateByMode(nodes.expiryMode.value);
            const formattedDate = formatDateInputValue(resolvedDate);
            if ((force || !String(nodes.expiryDate.value || "").trim()) && formattedDate) {
                nodes.expiryDate.value = formattedDate;
            }
        });
    }

    function syncNeutralModeCheckboxes(changedKey) {
        if (isCoveredMode) {
            return;
        }
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
        if (isCoveredMode) {
            return "none";
        }
        if (ids.gammaAwareNeutral instanceof HTMLInputElement && ids.gammaAwareNeutral.checked) {
            return "gamma";
        }
        if (ids.rangeDeltaNeutral instanceof HTMLInputElement && ids.rangeDeltaNeutral.checked) {
            return "theta";
        }
        if (ids.onlyDeltaNeutral instanceof HTMLInputElement && ids.onlyDeltaNeutral.checked) {
            return "only";
        }
        return "only";
    }

    function getCurrentNeutralModeFromCheckboxes() {
        if (isCoveredMode) {
            return "none";
        }
        if (ids.gammaAwareNeutral instanceof HTMLInputElement && ids.gammaAwareNeutral.checked) {
            return "gamma";
        }
        if (ids.rangeDeltaNeutral instanceof HTMLInputElement && ids.rangeDeltaNeutral.checked) {
            return "theta";
        }
        if (ids.onlyDeltaNeutral instanceof HTMLInputElement && ids.onlyDeltaNeutral.checked) {
            return "delta";
        }
        return "none";
    }

    function getNeutralBadgeSummaryText(status) {
        if (isCoveredMode) {
            return "";
        }
        const minDelta = Number(status.minDelta);
        const maxDelta = Number(status.maxDelta);
        const driftPct = Number(status.deltaDriftPct);
        const gammaFactor = Number(status.gammaFactor);
        const totalGamma = Number(status.totalGamma || 0);
        const baseDelta = Number(status.baseOptionDeltaAbs);
        const effectiveBaseDelta = Number(status.effectiveBaseOptionDeltaAbs);
        const baselineFloorDelta = Number(status.baselineFloorDeltaAbs);
        if (status.mode === "theta") {
            return Number.isFinite(minDelta) && Number.isFinite(maxDelta)
                ? `Theta: ${fmt(Number(status.totalTheta || 0), 3)} | Trigger: ${fmt(minDelta, 3)} to ${fmt(maxDelta, 3)}`
                : `Theta: ${fmt(Number(status.totalTheta || 0), 3)} | Trigger: 0.000 to 0.000`;
        }
        if (status.mode === "gamma") {
            if (mode === "dual") {
                const bandText = Number.isFinite(minDelta) && Number.isFinite(maxDelta)
                    ? `${fmt(minDelta, 2)}% to ${fmt(maxDelta, 2)}%`
                    : "0.00% to 0.00%";
                const driftText = Number.isFinite(driftPct) ? fmt(driftPct, 2) : "0.00";
                const baseText = Number.isFinite(baseDelta) ? fmt(baseDelta, 3) : "0.000";
                const floorText = Number.isFinite(baselineFloorDelta) ? fmt(baselineFloorDelta, 3) : "0.000";
                const effectiveText = Number.isFinite(effectiveBaseDelta) ? fmt(effectiveBaseDelta, 3) : "0.000";
                return `Scaled Drift: ${driftText}% | Trigger: ${bandText} | Base: ${baseText} | Floor: ${floorText} | Eff: ${effectiveText}`;
            }
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

    function canUseExecStrategy() {
        return !isDualLikeMode || execStrategyEnabled;
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
            ids.killSwitchButton.disabled = !canUseLiveActions() || !displayedPositions.some(function (row) {
                return !isDisplayedPositionInactive(row);
            });
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
        getSupportedOptionRowIndexes().forEach(function (rowIndex) {
            const nodes = getOptionRowNodes(rowIndex);
            [nodes.sellPeButton, nodes.sellCeButton, nodes.buyCeButton, nodes.buyPeButton].forEach(function (button) {
                if (button instanceof HTMLButtonElement) {
                    button.disabled = manualOptionOrderInFlight || !canUseLiveActions();
                }
            });
        });
        if (ids.execStrategyButton instanceof HTMLButtonElement) {
            ids.execStrategyButton.disabled = true;
            ids.execStrategyButton.title = isDemoVariant
                ? "Exec Strategy is disabled on Options Demo for now."
                : (canUseExecStrategy()
                    ? "Execute the live strategy"
                    : "Not Authorised to Execute, Please Contact Admin");
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

    function isDisplayedPositionInactive(row) {
        const metadata = row && typeof row.metadata === "object" ? row.metadata : {};
        return String(metadata.positionState || "").trim().toLowerCase() === "inactive"
            || Boolean(String(metadata.inactiveAt || "").trim());
    }

    function getCoveredNetPnlReferenceMargin() {
        if (!isCoveredMode) {
            return Number.NaN;
        }
        const vBlockedMarginDisplay = Number(lastAccountSummary?.blockedMarginDisplay);
        if (Number.isFinite(vBlockedMarginDisplay) && vBlockedMarginDisplay > 0) {
            return vBlockedMarginDisplay;
        }
        const vBlockedMargin = Number(lastAccountSummary?.blockedMargin);
        if (Number.isFinite(vBlockedMargin) && vBlockedMargin > 0) {
            return vBlockedMargin;
        }
        const vRequiredMargin = getCoveredRequiredBlockedMargin(getCoveredMultiplierValue());
        return Number.isFinite(vRequiredMargin) && vRequiredMargin > 0 ? vRequiredMargin : Number.NaN;
    }

    function renderNetPnlValue() {
        if (!ids.netPl) {
            return;
        }
        const vNetPnl = Number(lastRecoveryMetrics?.netPnl);
        const vNetPnlText = fmt(vNetPnl, 4) === "-" ? "0.0000" : fmt(vNetPnl, 4);
        if (!isCoveredMode) {
            ids.netPl.textContent = vNetPnlText;
            return;
        }
        const vReferenceMargin = getCoveredNetPnlReferenceMargin();
        if (!Number.isFinite(vNetPnl) || !Number.isFinite(vReferenceMargin) || vReferenceMargin <= 0) {
            ids.netPl.textContent = vNetPnlText;
            ids.netPl.removeAttribute("title");
            return;
        }
        const vRoundedPct = Math.round((vNetPnl / vReferenceMargin) * 100);
        ids.netPl.textContent = `${vNetPnlText} (${vRoundedPct}%)`;
        ids.netPl.title = `Net PnL as percentage of blocked margin ${vReferenceMargin.toFixed(2)} USD`;
    }

    function applyRecoveryMetrics(recoveryMetrics) {
        const objMetrics = recoveryMetrics || {};
        lastRecoveryMetrics = objMetrics;
        if (ids.brok2Rec instanceof HTMLInputElement) {
            ids.brok2Rec.value = fmt(objMetrics.totalBrokerageToRecover, 4) === "-" ? "0" : fmt(objMetrics.totalBrokerageToRecover, 4);
        }
        if (ids.yet2Recover instanceof HTMLInputElement) {
            ids.yet2Recover.value = fmt(objMetrics.totalPnl, 4) === "-" ? "0" : fmt(objMetrics.totalPnl, 4);
        }
        renderNetPnlValue();
    }

    function mergeRuntimeRecoveryMetrics(runtimeState) {
        const vBrokerage = Number(runtimeState?.brokerageRecoveryTotal);
        const vRecoveredPnl = Number(runtimeState?.recoveredTotalPnl);
        if (!Number.isFinite(vBrokerage) || !Number.isFinite(vRecoveredPnl)) {
            return null;
        }
        const objCurrent = lastRecoveryMetrics && typeof lastRecoveryMetrics === "object"
            ? lastRecoveryMetrics
            : {};
        const vCurrentNet = Number(objCurrent.netPnl);
        const vCurrentRecoveredPnl = Number(objCurrent.totalPnl);
        const vCurrentBrokerage = Number(objCurrent.totalBrokerageToRecover);
        const vOpenComponent = Number.isFinite(vCurrentNet) && Number.isFinite(vCurrentRecoveredPnl) && Number.isFinite(vCurrentBrokerage)
            ? (vCurrentNet - vCurrentRecoveredPnl + vCurrentBrokerage)
            : 0;
        return {
            totalBrokerageToRecover: Number(vBrokerage.toFixed(4)),
            totalPnl: Number(vRecoveredPnl.toFixed(4)),
            netPnl: Number((vRecoveredPnl + vOpenComponent - vBrokerage).toFixed(4))
        };
    }

    function updateNeutralBadges(neutralStatus) {
        if (isCoveredMode) {
            if (ids.deltaBadgesGroup) {
                ids.deltaBadgesGroup.hidden = true;
            }
            if (ids.neutralBadgesRow) {
                ids.neutralBadgesRow.hidden = true;
            }
            return;
        }
        const objStatus = neutralStatus || {};
        const totalDelta = Number(objStatus.totalDelta || 0);
        const bRulesActive = autoTraderEnabled;
        const currentNeutralMode = getCurrentNeutralModeFromCheckboxes();
        const bShowDeltaGroup = bRulesActive && ["delta", "theta", "gamma"].includes(currentNeutralMode);
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

    function renderProfitCloseCountdown() {
        if (!ids.profitCloseTimer) {
            return;
        }
        const objPending = profitClosePending && typeof profitClosePending === "object"
            ? profitClosePending
            : (localProfitClosePending && typeof localProfitClosePending === "object"
                ? localProfitClosePending
                : null);
        const startedAtText = String(objPending?.startedAt || "").trim();
        const startedAtMs = startedAtText ? new Date(startedAtText).getTime() : Number.NaN;
        const reason = String(objPending?.reason || "").trim().toLowerCase();
        if (!objPending || !startedAtText || !Number.isFinite(startedAtMs)) {
            ids.profitCloseTimer.hidden = true;
            ids.profitCloseTimer.textContent = "";
            ids.profitCloseTimer.removeAttribute("title");
            return;
        }
        const elapsedMs = Date.now() - startedAtMs;
        const remainingMs = Math.max(0, profitCloseConfirmationMs - elapsedMs);
        const reasonLabel = reason === "brokerage"
            ? "Brokerage"
            : (reason === "blockmargin" ? "Blocked Margin" : "Profit");
        ids.profitCloseTimer.hidden = false;
        ids.profitCloseTimer.textContent = `${reasonLabel} close in ${formatCountdownDuration(remainingMs)}`;
        ids.profitCloseTimer.title = remainingMs > 0
            ? "Close All will trigger if the profit target stays satisfied for the full 5-minute confirmation window."
            : "Profit target confirmation window completed. Close All should trigger on the next runtime pass.";
    }

    function restartProfitCloseCountdown() {
        renderProfitCloseCountdown();
        if (profitCloseCountdownTimer) {
            clearInterval(profitCloseCountdownTimer);
            profitCloseCountdownTimer = null;
        }
        const objPending = profitClosePending && typeof profitClosePending === "object"
            ? profitClosePending
            : (localProfitClosePending && typeof localProfitClosePending === "object"
                ? localProfitClosePending
                : null);
        if (!objPending || !String(objPending.startedAt || "").trim()) {
            return;
        }
        profitCloseCountdownTimer = window.setInterval(function () {
            renderProfitCloseCountdown();
        }, 1000);
    }

    function syncLocalProfitClosePendingFromOpenPositions() {
        if (!isCoveredMode || !isDemoVariant) {
            localProfitClosePending = null;
            return;
        }
        if (profitClosePending && typeof profitClosePending === "object" && String(profitClosePending.startedAt || "").trim()) {
            localProfitClosePending = null;
            return;
        }
        const objPayload = lastOpenPositionsPayload && typeof lastOpenPositionsPayload === "object"
            ? lastOpenPositionsPayload
            : null;
        const arrPositions = Array.isArray(objPayload?.positions) ? objPayload.positions : [];
        const objTotals = objPayload?.totals || null;
        const bBrokerageEnabled = ids.closeNetProfitBrokerage instanceof HTMLInputElement && ids.closeNetProfitBrokerage.checked;
        const vBrokerageMultiplier = Math.max(0, Number(ids.brokerageMultiplier instanceof HTMLInputElement ? ids.brokerageMultiplier.value : 0));
        const vTotalCharges = Math.max(0, Number(objTotals?.totalCharges || 0));
        const vTotalPnl = Number(objTotals?.totalPnl || 0);
        const bRuleSatisfied = autoTraderEnabled
            && arrPositions.length > 0
            && bBrokerageEnabled
            && vBrokerageMultiplier > 0
            && vTotalCharges >= 0.01
            && vTotalPnl >= (vTotalCharges * vBrokerageMultiplier);
        if (!bRuleSatisfied) {
            localProfitClosePending = null;
            return;
        }
        if (localProfitClosePending && String(localProfitClosePending.reason || "").trim() === "brokerage") {
            return;
        }
        localProfitClosePending = {
            reason: "brokerage",
            thresholdValue: Number((vTotalCharges * vBrokerageMultiplier).toFixed(6)),
            startedAt: new Date().toISOString()
        };
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
        setButtonsEnabled();
    }

    function applyRuntimeStatus(runtime) {
        const objRuntime = runtime || {};
        runtimeStatus = String(objRuntime.status || "idle").trim() || "idle";
        autoTraderEnabled = Boolean(objRuntime.autoTraderEnabled);
        pendingLiveConfirmation = objRuntime?.state?.pendingCoveredLiveConfirmation || null;
        profitClosePending = objRuntime?.state?.profitClosePending || null;
        const strategyStartedAt = String(objRuntime?.state?.strategyStartedAt || "").trim();
        const closedPositionsRefreshAt = String(objRuntime?.state?.closedPositionsRefreshAt || "").trim();
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
        const objRuntimeRecoveryMetrics = mergeRuntimeRecoveryMetrics(objRuntime.state);
        if (objRuntimeRecoveryMetrics) {
            applyRecoveryMetrics(objRuntimeRecoveryMetrics);
        }
        else if (!lastRecoveryMetrics) {
            applyRecoveryMetrics({
                totalBrokerageToRecover: 0,
                totalPnl: 0,
                netPnl: 0
            });
        }
        if (ids.closedFromDate instanceof HTMLInputElement && !String(ids.closedFromDate.value || "").trim() && strategyStartedAt) {
            const vClosedFromDate = formatDateTimeInputValue(new Date(strategyStartedAt));
            if (vClosedFromDate) {
                ids.closedFromDate.value = vClosedFromDate;
            }
        }
        if (closedPositionsRefreshAt && closedPositionsRefreshAt !== lastClosedPositionsRefreshAt) {
            lastClosedPositionsRefreshAt = closedPositionsRefreshAt;
            queueClosedPositionsRefresh();
        }
        updateNeutralBadges(lastNeutralStatus);
        restartProfitCloseCountdown();
        renderPendingLiveConfirmation();
        setButtonsEnabled();
    }

    function renderPendingLiveConfirmation() {
        if (!isCoveredMode) {
            return;
        }
        const objPending = pendingLiveConfirmation && typeof pendingLiveConfirmation === "object"
            ? pendingLiveConfirmation
            : null;
        if (!objPending) {
            queuedConfirmationSoundActionId = "";
            if (ids.confirmationEmpty) {
                ids.confirmationEmpty.style.display = "";
            }
            if (ids.confirmationPanel) {
                ids.confirmationPanel.style.display = "none";
            }
            return;
        }
        if (ids.confirmationEmpty) {
            ids.confirmationEmpty.style.display = "none";
        }
        if (ids.confirmationPanel) {
            ids.confirmationPanel.style.display = "";
        }
        if (ids.confirmationTitle) {
            ids.confirmationTitle.textContent = String(objPending.title || "Pending Confirmation");
        }
        if (ids.confirmationTime) {
            ids.confirmationTime.textContent = formatDateTimeDisplay(objPending.createdAt);
        }
        if (ids.confirmationMessage) {
            ids.confirmationMessage.textContent = String(objPending.message || "");
        }
        if (ids.confirmActionButton instanceof HTMLButtonElement) {
            ids.confirmActionButton.disabled = confirmationInFlight;
        }
        if (ids.rejectActionButton instanceof HTMLButtonElement) {
            ids.rejectActionButton.disabled = confirmationInFlight;
        }
        maybePlayPendingLiveConfirmationSound(objPending);
    }

    function readConfirmationSoundPreference() {
        try {
            return window.localStorage.getItem(confirmationSoundStorageKey) !== "off";
        }
        catch (_error) {
            return true;
        }
    }

    function saveConfirmationSoundPreference() {
        try {
            window.localStorage.setItem(confirmationSoundStorageKey, confirmationSoundEnabled ? "on" : "off");
        }
        catch (_error) {
        }
    }

    function getConfirmationAudioContext() {
        if (confirmationAudioContext) {
            return confirmationAudioContext;
        }
        const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
        if (typeof AudioContextConstructor !== "function") {
            return null;
        }
        confirmationAudioContext = new AudioContextConstructor();
        return confirmationAudioContext;
    }

    function playConfirmationBeep(actionId) {
        const normalizedActionId = String(actionId || "").trim();
        if (!confirmationSoundEnabled || !normalizedActionId || normalizedActionId === lastConfirmationSoundActionId) {
            return false;
        }
        const audioContext = getConfirmationAudioContext();
        if (!audioContext || audioContext.state !== "running") {
            queuedConfirmationSoundActionId = normalizedActionId;
            return false;
        }
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const startAt = audioContext.currentTime;
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(880, startAt);
        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(0.16, startAt + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.22);
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start(startAt);
        oscillator.stop(startAt + 0.23);
        lastConfirmationSoundActionId = normalizedActionId;
        queuedConfirmationSoundActionId = "";
        return true;
    }

    function maybePlayPendingLiveConfirmationSound(pPending) {
        const vActionId = String(pPending?.actionId || "").trim();
        if (!vActionId || vActionId === lastConfirmationSoundActionId) {
            return;
        }
        playConfirmationBeep(vActionId);
    }

    function unlockConfirmationAudio() {
        if (!isCoveredMode) {
            return Promise.resolve();
        }
        const audioContext = getConfirmationAudioContext();
        if (!audioContext) {
            return Promise.resolve();
        }
        const objResume = audioContext.state === "running"
            ? Promise.resolve()
            : audioContext.resume();
        return objResume.then(function () {
            if (queuedConfirmationSoundActionId) {
                playConfirmationBeep(queuedConfirmationSoundActionId);
            }
        }).catch(function () {
        });
    }

    async function confirmPendingLiveAction() {
        confirmationInFlight = true;
        renderPendingLiveConfirmation();
        try {
            return await postJson(`${endpointBase}/live-action/confirm`, {});
        }
        finally {
            confirmationInFlight = false;
            renderPendingLiveConfirmation();
        }
    }

    async function rejectPendingLiveAction() {
        confirmationInFlight = true;
        renderPendingLiveConfirmation();
        try {
            return await postJson(`${endpointBase}/live-action/reject`, {});
        }
        finally {
            confirmationInFlight = false;
            renderPendingLiveConfirmation();
        }
    }

    function clearAccountSummary() {
        lastAccountSummary = null;
        clearOptionsDemoIndicator();
        resetRenkoFeedState(getRenkoFeedEnabled()
            ? "Waiting for fresh live price..."
            : "Renko feed is OFF.", false);
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

    function formatIndicatorOi(value) {
        const numberValue = Number(value);
        if (!Number.isFinite(numberValue)) {
            return "-";
        }
        const absValue = Math.abs(numberValue);
        const digits = absValue >= 1000 ? 0 : 2;
        return numberValue.toLocaleString(undefined, {
            minimumFractionDigits: 0,
            maximumFractionDigits: digits
        });
    }

    function getIndicatorDirectionText(direction) {
        const normalized = String(direction || "").trim().toLowerCase();
        if (normalized === "bullish") {
            return "Bullish";
        }
        if (normalized === "bearish") {
            return "Bearish";
        }
        return "Neutral";
    }

    function getIndicatorBadgeTone(direction) {
        const normalized = String(direction || "").trim().toLowerCase();
        if (normalized === "bullish") {
            return "success";
        }
        if (normalized === "bearish") {
            return "danger";
        }
        return "warning";
    }

    function clearOptionsDemoIndicator() {
        if (!isDemoVariant || !ids.indicatorCard || !ids.indicatorBody) {
            return;
        }
        ids.indicatorCard.classList.add("rolling-futures-hidden");
        ids.indicatorCard.classList.remove(
            "indicator-strength-weak",
            "indicator-strength-medium",
            "indicator-strength-strong",
            "indicator-strength-neutral"
        );
        ids.indicatorBody.innerHTML = "<tr class=\"rolling-futures-empty-body\"><td colspan=\"12\">No indicator data yet.</td></tr>";
        if (ids.indicatorOverall) {
            ids.indicatorOverall.className = "rolling-futures-badge";
            ids.indicatorOverall.textContent = "Overall: Waiting";
        }
        if (ids.indicatorPcr) {
            ids.indicatorPcr.className = "rolling-futures-badge";
            ids.indicatorPcr.textContent = "PCR: -";
        }
        if (ids.indicatorSupport) {
            ids.indicatorSupport.className = "rolling-futures-badge";
            ids.indicatorSupport.textContent = "Support: -";
        }
        if (ids.indicatorResistance) {
            ids.indicatorResistance.className = "rolling-futures-badge";
            ids.indicatorResistance.textContent = "Resistance: -";
        }
        if (ids.indicatorOrderBook) {
            ids.indicatorOrderBook.className = "rolling-futures-badge";
            ids.indicatorOrderBook.textContent = "Order Book: -";
        }
        if (ids.indicatorFlow) {
            ids.indicatorFlow.className = "rolling-futures-badge";
            ids.indicatorFlow.textContent = "Flow: -";
        }
        if (ids.indicatorTrend) {
            ids.indicatorTrend.className = "rolling-futures-badge";
            ids.indicatorTrend.textContent = "Trend: -";
        }
        if (ids.indicatorStrength) {
            ids.indicatorStrength.className = "rolling-futures-badge";
            ids.indicatorStrength.textContent = "Strength: -";
        }
        if (ids.indicatorStrengthBar) {
            ids.indicatorStrengthBar.querySelectorAll(".rolling-futures-strength-step").forEach(function (step) {
                step.classList.remove("active");
                step.removeAttribute("data-tone");
            });
        }
        if (ids.indicatorHistoryBar) {
            ids.indicatorHistoryBar.querySelectorAll(".rolling-futures-history-step").forEach(function (step) {
                step.classList.remove("active");
                step.removeAttribute("data-tone");
                step.style.height = "";
            });
        }
        if (ids.indicatorMeta) {
            ids.indicatorMeta.textContent = "Open interest direction will appear after the latest market snapshot loads.";
        }
        if (ids.indicatorConfidence) {
            ids.indicatorConfidence.className = "rolling-futures-indicator-confidence";
            ids.indicatorConfidence.textContent = "Confidence: -";
        }
        if (ids.indicatorHeadline) {
            ids.indicatorHeadline.className = "rolling-futures-indicator-headline";
            ids.indicatorHeadline.textContent = "Headline: -";
        }
    }

    function getIndicatorRefreshMinutes() {
        const value = Number(ids.indicatorRefreshInput?.value || 5);
        if (!Number.isFinite(value) || value < 1) {
            return 5;
        }
        return Math.min(60, Math.max(1, Math.trunc(value)));
    }

    function scheduleIndicatorAutoRefresh() {
        if (!isDemoVariant) {
            return;
        }
        if (indicatorRefreshTimer) {
            clearInterval(indicatorRefreshTimer);
            indicatorRefreshTimer = null;
        }
        const minutes = getIndicatorRefreshMinutes();
        indicatorRefreshTimer = window.setInterval(function () {
            void loadOptionsDemoIndicator().catch(function () { return undefined; });
        }, minutes * 60 * 1000);
    }

    function formatIndicatorWall(wall) {
        const strike = Number(wall?.strike);
        const oi = Number(wall?.oi);
        if (!Number.isFinite(strike) || !Number.isFinite(oi)) {
            return "-";
        }
        return `${fmt(strike, 0)} (${formatIndicatorOi(oi)})`;
    }

    function formatOrderBookImbalance(value) {
        const numberValue = Number(value);
        if (!Number.isFinite(numberValue)) {
            return "-";
        }
        return `${Math.abs(numberValue * 100).toFixed(1)}%`;
    }

    function getOrderBookTone(direction) {
        const normalized = String(direction || "").trim().toLowerCase();
        if (normalized === "bullish") {
            return "success";
        }
        if (normalized === "bearish") {
            return "danger";
        }
        return "warning";
    }

    function getOrderBookLabel(indicator) {
        const direction = getIndicatorDirectionText(indicator?.orderBookDirection);
        const imbalance = Number(indicator?.orderBookImbalance);
        const source = String(indicator?.orderBookSource || "").trim().replaceAll("_", " ");
        if (!Number.isFinite(imbalance)) {
            return `Order Book: ${direction}`;
        }
        return `Order Book: ${direction} ${formatOrderBookImbalance(imbalance)}${source ? ` (${source})` : ""}`;
    }

    function getFlowTone(flow) {
        const bias = String(flow?.bias || "").trim().toLowerCase();
        if (bias === "bullish") {
            return "success";
        }
        if (bias === "bearish") {
            return "danger";
        }
        return "warning";
    }

    function getFlowLabel(flow) {
        const classification = String(flow?.classification || "").trim().toLowerCase();
        if (classification === "long_buildup") {
            return "Long Buildup";
        }
        if (classification === "short_buildup") {
            return "Short Buildup";
        }
        if (classification === "short_covering") {
            return "Short Covering";
        }
        if (classification === "long_unwinding") {
            return "Long Unwinding";
        }
        return "Flat";
    }

    function getTrendTone(trend) {
        const normalized = String(trend || "").trim().toLowerCase();
        if (normalized === "improving") {
            return "success";
        }
        if (normalized === "weakening") {
            return "danger";
        }
        return "warning";
    }

    function getTrendLabel(trend) {
        const normalized = String(trend || "").trim().toLowerCase();
        if (normalized === "improving") {
            return "Improving";
        }
        if (normalized === "weakening") {
            return "Weakening";
        }
        return "Stable";
    }

    function getStrengthLabel(score) {
        const vScore = Number(score);
        if (!Number.isFinite(vScore)) {
            return { label: "Unknown", tone: "warning" };
        }
        if (vScore >= 5) {
            return { label: "Very Strong", tone: "success" };
        }
        if (vScore >= 4) {
            return { label: "Strong", tone: "success" };
        }
        if (vScore >= 3) {
            return { label: "Moderate", tone: "warning" };
        }
        if (vScore >= 2) {
            return { label: "Weak", tone: "warning" };
        }
        return { label: "Very Weak", tone: "danger" };
    }

    function getSummaryStrengthWord(strength) {
        const value = Number(strength);
        if (!Number.isFinite(value)) {
            return "Neutral";
        }
        if (value >= 4) {
            return "Strong";
        }
        if (value >= 3) {
            return "Moderate";
        }
        return "Weak";
    }

    function getOverallSummaryLabel(direction, strength) {
        const normalizedDirection = String(direction || "").trim().toLowerCase();
        const strengthWord = getSummaryStrengthWord(strength);
        if (normalizedDirection === "bullish") {
            return `${strengthWord} Bullish`;
        }
        if (normalizedDirection === "bearish") {
            return `${strengthWord} Bearish`;
        }
        return `${strengthWord} Neutral`;
    }

    function getTrendDelta(currentScore, previousScore, direction) {
        const current = Number(currentScore);
        const previous = Number(previousScore);
        if (!Number.isFinite(current) || !Number.isFinite(previous)) {
            return { trend: "stable", delta: 0 };
        }
        const delta = Number((current - previous).toFixed(4));
        const dir = String(direction || "").trim().toLowerCase();
        if (Math.abs(delta) < 0.03) {
            return { trend: "stable", delta };
        }
        const improving = (dir === "bullish" && delta > 0) || (dir === "bearish" && delta < 0);
        const weakening = (dir === "bullish" && delta < 0) || (dir === "bearish" && delta > 0);
        return {
            trend: improving ? "improving" : (weakening ? "weakening" : "stable"),
            delta
        };
    }

    function loadIndicatorMemory(symbol) {
        if (!isDemoVariant) {
            return null;
        }
        try {
            const key = `optionyze.options-demo.indicator.${String(symbol || "BTC").trim().toUpperCase()}`;
            const raw = window.localStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        }
        catch {
            return null;
        }
    }

    function saveIndicatorMemory(symbol, payload) {
        if (!isDemoVariant) {
            return;
        }
        try {
            const key = `optionyze.options-demo.indicator.${String(symbol || "BTC").trim().toUpperCase()}`;
            const currentHistory = Array.isArray(payload?.history) ? payload.history : [];
            const prior = loadIndicatorMemory(symbol) || {};
            const mergedHistory = Array.isArray(prior.history) ? prior.history.slice(-7) : [];
            const nextHistory = mergedHistory.concat(currentHistory).slice(-8);
            window.localStorage.setItem(key, JSON.stringify({
                ...prior,
                ...payload,
                history: nextHistory
            }));
        }
        catch {
            // best effort
        }
    }

    function calculateSignalStrength(indicator, trend, orderBookDirection) {
        const score = Math.abs(Number(indicator?.overallScore));
        let strength = 1;
        if (score >= 0.10) {
            strength += 1;
        }
        if (score >= 0.22) {
            strength += 1;
        }
        if (String(indicator?.overallFlow?.classification || "").trim().toLowerCase() !== "flat") {
            strength += 1;
        }
        if (String(trend || "").trim().toLowerCase() === "improving") {
            strength += 1;
        }
        const direction = String(indicator?.overallDirection || "").trim().toLowerCase();
        const bookDirection = String(orderBookDirection || "").trim().toLowerCase();
        if (bookDirection && bookDirection !== "neutral" && direction === bookDirection) {
            strength += 1;
        }
        return Math.max(1, Math.min(5, strength));
    }

    function getSignalStrengthTone(strength) {
        const value = Number(strength);
        if (!Number.isFinite(value)) {
            return "warning";
        }
        if (value >= 4) {
            return "success";
        }
        if (value >= 2) {
            return "warning";
        }
        return "danger";
    }

    function getSignalStrengthCardClass(strength) {
        const value = Number(strength);
        if (!Number.isFinite(value)) {
            return "indicator-strength-neutral";
        }
        if (value >= 4) {
            return "indicator-strength-strong";
        }
        if (value >= 2) {
            return "indicator-strength-medium";
        }
        return "indicator-strength-weak";
    }

    function getBucketGroupLabel(horizon) {
        const normalized = String(horizon || "").trim().toLowerCase();
        if (normalized === "short_term") {
            return "Short Term";
        }
        if (normalized === "medium_term") {
            return "Medium Term";
        }
        if (normalized === "long_term") {
            return "Long Term";
        }
        return "Other";
    }

    function updateStrengthBar(strength) {
        if (!ids.indicatorStrengthBar) {
            return;
        }
        const value = Math.max(1, Math.min(5, Math.trunc(Number(strength) || 1)));
        const tone = getSignalStrengthTone(value);
        ids.indicatorStrengthBar.querySelectorAll(".rolling-futures-strength-step").forEach(function (step) {
            const stepValue = Number(step.dataset.step || 0);
            step.classList.toggle("active", stepValue <= value);
            step.setAttribute("data-tone", tone);
        });
    }

    function updateHistoryBar(history) {
        if (!ids.indicatorHistoryBar) {
            return;
        }
        const arrHistory = Array.isArray(history) ? history.slice(-8) : [];
        const arrSteps = Array.from(ids.indicatorHistoryBar.querySelectorAll(".rolling-futures-history-step"));
        arrSteps.forEach(function (step, index) {
            const value = Number(arrHistory[index]);
            const tone = getSignalStrengthTone(value);
            const isActive = Number.isFinite(value);
            step.classList.toggle("active", isActive);
            step.setAttribute("data-tone", tone);
            step.style.height = isActive ? `${Math.max(18, Math.min(34, 8 + (value * 5)))}px` : "8px";
        });
    }

    function updateIndicatorCardTone(strength) {
        if (!ids.indicatorCard) {
            return;
        }
        ids.indicatorCard.classList.remove(
            "indicator-strength-weak",
            "indicator-strength-medium",
            "indicator-strength-strong",
            "indicator-strength-neutral"
        );
        ids.indicatorCard.classList.add(getSignalStrengthCardClass(strength));
    }

    function getConfidenceTone(level) {
        const normalized = String(level || "").trim().toLowerCase();
        if (normalized === "high") {
            return "high";
        }
        if (normalized === "medium") {
            return "medium";
        }
        return "low";
    }

    function summarizeConfidence(indicator, signalStrength, overallTrend, memory) {
        const direction = String(indicator?.overallDirection || "").trim().toLowerCase();
        const orderBookDirection = String(indicator?.orderBookDirection || "").trim().toLowerCase();
        const flowBias = String(indicator?.overallFlow?.bias || "").trim().toLowerCase();
        const flowClassification = String(indicator?.overallFlow?.classification || "").trim().toLowerCase();
        const trend = String(overallTrend || "").trim().toLowerCase();
        const support = Number(indicator?.overallSupport?.strike);
        const resistance = Number(indicator?.overallResistance?.strike);
        const spot = Number(indicator?.markPrice ?? indicator?.spotPrice);
        const wallAgreement = Number.isFinite(support) && Number.isFinite(resistance) && Number.isFinite(spot)
            ? (direction === "bullish" ? (support < spot && resistance > spot) : (direction === "bearish" ? (support < spot && resistance > spot) : true))
            : false;
        const alignments = [
            direction && flowBias && ((direction === "bullish" && (flowBias === "bullish" || flowClassification === "short_covering")) || (direction === "bearish" && (flowBias === "bearish" || flowClassification === "long_unwinding"))),
            direction && trend && ((direction === "bullish" && trend === "improving") || (direction === "bearish" && trend === "improving")),
            direction && orderBookDirection && ((direction === "bullish" && orderBookDirection === "bullish") || (direction === "bearish" && orderBookDirection === "bearish")),
            wallAgreement,
            Number(signalStrength) >= 4,
            Number(memory?.history?.length || 0) >= 3
        ].filter(Boolean).length;
        if (alignments >= 4) {
            return { level: "high", text: "Confidence: High, because trend, flow, order book, and walls agree." };
        }
        if (alignments >= 2) {
            return { level: "medium", text: "Confidence: Medium, because most signals agree." };
        }
        return { level: "low", text: "Confidence: Low, because the signals are mixed." };
    }

    function summarizeHeadline(indicator, signalStrength, overallTrend, confidence, memory) {
        const direction = String(indicator?.overallDirection || "").trim().toLowerCase();
        const orderBookDirection = String(indicator?.orderBookDirection || "").trim().toLowerCase();
        const flow = String(indicator?.overallFlow?.classification || "").trim().toLowerCase();
        const trend = String(overallTrend || "").trim().toLowerCase();
        const support = Number(indicator?.overallSupport?.strike);
        const resistance = Number(indicator?.overallResistance?.strike);
        const spot = Number(indicator?.markPrice ?? indicator?.spotPrice);
        const strengthWord = getSummaryStrengthWord(signalStrength);
        const directionWord = direction === "bullish" ? "bullish" : (direction === "bearish" ? "bearish" : "neutral");
        const trendWord = trend === "improving" ? "strengthening" : (trend === "weakening" ? "softening" : "steady");
        const flowWord = flow === "long_buildup" || flow === "short_covering"
            ? "supportive flow"
            : (flow === "short_buildup" || flow === "long_unwinding"
                ? "pressured flow"
                : "balanced flow");
        const wallWord = Number.isFinite(support) && Number.isFinite(resistance) && Number.isFinite(spot)
            ? `walls around ${fmt(spot, 0)}`
            : "key walls nearby";
        const confidenceWord = String(confidence?.level || "").trim().toLowerCase() === "high"
            ? "high confidence"
            : (String(confidence?.level || "").trim().toLowerCase() === "medium" ? "moderate confidence" : "limited confidence");
        const historyWord = Number(Array.isArray(memory?.history) ? memory.history.length : 0) >= 3 ? "with history agreeing" : "with limited history";
        const bookWord = orderBookDirection === "bullish"
            ? "order book leaning bullish"
            : (orderBookDirection === "bearish" ? "order book leaning bearish" : "order book balanced");
        if (directionWord === "neutral") {
            return `Headline: ${strengthWord} neutral bias, ${trendWord}, ${flowWord}, ${bookWord}, ${wallWord}, ${confidenceWord}, ${historyWord}.`;
        }
        return `Headline: ${strengthWord} ${directionWord} bias, ${trendWord}, ${flowWord}, ${bookWord}, ${wallWord}, ${confidenceWord}, ${historyWord}.`;
    }

    function pulseOverallBadge() {
        if (!ids.indicatorOverall) {
            return;
        }
        ids.indicatorOverall.classList.remove("badge-pulse");
        void ids.indicatorOverall.offsetWidth;
        ids.indicatorOverall.classList.add("badge-pulse");
        window.setTimeout(function () {
            ids.indicatorOverall?.classList.remove("badge-pulse");
        }, 700);
    }

    function renderOptionsDemoIndicator(indicator) {
        if (!isDemoVariant || !ids.indicatorCard || !ids.indicatorBody) {
            return;
        }
        const buckets = Array.isArray(indicator?.buckets) ? indicator.buckets : [];
        if (!buckets.length) {
            clearOptionsDemoIndicator();
            return;
        }
        const overallDirection = getIndicatorDirectionText(indicator?.overallDirection);
        const overallTone = getIndicatorBadgeTone(indicator?.overallDirection);
        const overallPcr = Number(indicator?.overallPutCallRatio);
        const asOfText = indicator?.asOf ? formatDateTimeDisplay(indicator.asOf) : "-";
        const markPrice = Number(indicator?.markPrice);
        const spotPrice = Number(indicator?.spotPrice);
        const overallSupportText = formatIndicatorWall(indicator?.overallSupport);
        const overallResistanceText = formatIndicatorWall(indicator?.overallResistance);
        const orderBookText = getOrderBookLabel(indicator);
        const overallFlowLabel = getFlowLabel(indicator?.overallFlow);
        const memory = loadIndicatorMemory(indicator?.symbol || ids.symbol?.value || "BTC");
        const overallTrend = getTrendDelta(indicator?.overallScore, memory?.overallScore, indicator?.overallDirection);
        const signalStrength = calculateSignalStrength(indicator, overallTrend.trend, indicator?.orderBookDirection);
        const strengthInfo = getStrengthLabel(signalStrength);
        const overallSummaryLabel = getOverallSummaryLabel(indicator?.overallDirection, signalStrength);
        const previousBucketByWindow = new Map(Array.isArray(memory?.buckets) ? memory.buckets.map(function (bucket) {
            return [String(bucket?.window || ""), bucket];
        }) : []);
        const history = Array.isArray(memory?.history) ? memory.history.slice(-7) : [];
        const nextHistory = history.concat(signalStrength).slice(-8);
        const confidence = summarizeConfidence(indicator, signalStrength, overallTrend.trend, memory);
        const headline = summarizeHeadline(indicator, signalStrength, overallTrend.trend, confidence, memory);
        ids.indicatorCard.classList.remove("rolling-futures-hidden");
        let lastGroupLabel = "";
        ids.indicatorBody.innerHTML = buckets.map(function (bucket) {
            const tone = getIndicatorBadgeTone(bucket?.direction);
            const horizonText = String(bucket?.horizon || "").trim().replaceAll("_", " ");
            const flowTone = getFlowTone(bucket?.flow);
            const flowLabel = getFlowLabel(bucket?.flow);
            const prevBucket = previousBucketByWindow.get(String(bucket?.window || ""));
            const bucketTrend = getTrendDelta(bucket?.score, prevBucket?.score, bucket?.direction);
            const groupLabel = getBucketGroupLabel(bucket?.horizon);
            const groupRow = groupLabel !== lastGroupLabel
                ? `<tr class="rolling-futures-section-row"><td colspan="12">${escapeHtml(groupLabel)}</td></tr>`
                : "";
            lastGroupLabel = groupLabel;
            return `
                ${groupRow}
                <tr>
                    <td>${escapeHtml(horizonText.replace(/\b\w/g, function (char) { return char.toUpperCase(); }))}</td>
                    <td>${escapeHtml(String(bucket?.label || "-"))}</td>
                    <td>${escapeHtml(String(bucket?.expiry || "-"))}</td>
                    <td>${Number.isFinite(Number(bucket?.dte)) ? escapeHtml(fmt(bucket.dte, 1)) : "-"}</td>
                    <td>${escapeHtml(formatIndicatorOi(bucket?.callOi))}</td>
                    <td>${escapeHtml(formatIndicatorOi(bucket?.putOi))}</td>
                    <td>${Number.isFinite(Number(bucket?.putCallRatio)) ? escapeHtml(Number(bucket.putCallRatio).toFixed(2)) : "-"}</td>
                    <td>${escapeHtml(formatIndicatorWall(bucket?.support))}</td>
                    <td>${escapeHtml(formatIndicatorWall(bucket?.resistance))}</td>
                    <td><span class="rolling-futures-badge ${flowTone}">${escapeHtml(flowLabel)}</span></td>
                    <td><span class="rolling-futures-badge ${getTrendTone(bucketTrend.trend)}">${escapeHtml(getTrendLabel(bucketTrend.trend))}</span></td>
                    <td><span class="rolling-futures-badge ${tone}">${escapeHtml(getIndicatorDirectionText(bucket?.direction))}</span></td>
                </tr>
            `;
        }).join("");
        if (ids.indicatorOverall) {
            ids.indicatorOverall.className = `rolling-futures-badge ${overallTone}`;
            ids.indicatorOverall.textContent = `Overall: ${overallSummaryLabel}`;
            pulseOverallBadge();
        }
        if (ids.indicatorPcr) {
            ids.indicatorPcr.className = "rolling-futures-badge";
            ids.indicatorPcr.textContent = `PCR: ${Number.isFinite(overallPcr) ? overallPcr.toFixed(2) : "-"}`;
        }
        if (ids.indicatorSupport) {
            ids.indicatorSupport.className = "rolling-futures-badge success";
            ids.indicatorSupport.textContent = `Support: ${overallSupportText}`;
        }
        if (ids.indicatorResistance) {
            ids.indicatorResistance.className = "rolling-futures-badge danger";
            ids.indicatorResistance.textContent = `Resistance: ${overallResistanceText}`;
        }
        if (ids.indicatorOrderBook) {
            ids.indicatorOrderBook.className = `rolling-futures-badge ${getOrderBookTone(indicator?.orderBookDirection)}`;
            ids.indicatorOrderBook.textContent = orderBookText;
        }
        if (ids.indicatorFlow) {
            ids.indicatorFlow.className = `rolling-futures-badge ${getFlowTone(indicator?.overallFlow)}`;
            ids.indicatorFlow.textContent = `Flow: ${overallFlowLabel}`;
        }
        if (ids.indicatorTrend) {
            ids.indicatorTrend.className = `rolling-futures-badge ${getTrendTone(overallTrend.trend)}`;
            ids.indicatorTrend.textContent = `Trend: ${getTrendLabel(overallTrend.trend)}`;
        }
        if (ids.indicatorStrength) {
            ids.indicatorStrength.className = `rolling-futures-badge ${strengthInfo.tone}`;
            ids.indicatorStrength.textContent = `Strength: ${signalStrength}/5 (${strengthInfo.label})`;
        }
        updateStrengthBar(signalStrength);
        updateIndicatorCardTone(signalStrength);
        updateHistoryBar(nextHistory);
        if (ids.indicatorMeta) {
            const priceChange = Number(indicator?.overallFlow?.priceChange);
            const oiChange = Number(indicator?.overallFlow?.oiChange);
            const parts = [
                `Symbol ${String(indicator?.symbol || ids.symbol?.value || "BTC").trim().toUpperCase()}`,
                `Mark ${Number.isFinite(markPrice) ? fmt(markPrice, 2) : "-"}`,
                `Spot ${Number.isFinite(spotPrice) ? fmt(spotPrice, 2) : "-"}`,
                `Price Chg ${Number.isFinite(priceChange) ? fmt(priceChange, 2) : "-"}`,
                `OI Chg ${Number.isFinite(oiChange) ? formatIndicatorOi(oiChange) : "-"}`,
                `Updated ${asOfText}`
            ];
            ids.indicatorMeta.textContent = parts.join(" | ");
        }
        if (ids.indicatorConfidence) {
            ids.indicatorConfidence.className = `rolling-futures-indicator-confidence ${getConfidenceTone(confidence.level)}`;
            ids.indicatorConfidence.textContent = confidence.text;
        }
        if (ids.indicatorHeadline) {
            ids.indicatorHeadline.className = `rolling-futures-indicator-headline ${getConfidenceTone(confidence.level)}`;
            ids.indicatorHeadline.textContent = headline;
        }
        saveIndicatorMemory(indicator?.symbol || ids.symbol?.value || "BTC", {
            overallScore: indicator?.overallScore,
            signalStrength: signalStrength,
            history: nextHistory,
            buckets: buckets.map(function (bucket) {
                return {
                    window: bucket?.window,
                    score: bucket?.score
                };
            })
        });
    }

    function applyAccountSummaryData(objData) {
        lastAccountSummary = objData || null;
        execStrategyEnabled = mode === "dual" ? Boolean(objData.execStrategy) : true;
        if (isDemoVariant && Object.prototype.hasOwnProperty.call(objData || {}, "indicator")) {
            renderOptionsDemoIndicator(objData.indicator || null);
        }
        updateRenkoFeedDisplay(objData);
        if (ids.oneLotValue) {
            ids.oneLotValue.textContent = fmtUsd(objData.oneLotValue);
        }
        if (ids.totalBalanceValue) {
            ids.totalBalanceValue.textContent = fmtUsd(objData.totalBalance);
        }
        if (ids.blockedMarginValue) {
            if (isCoveredMode) {
                refreshCoveredBalanceSummaryDisplay();
            }
            else {
                ids.blockedMarginValue.textContent = fmtUsd(
                    Number.isFinite(Number(objData.blockedMarginDisplay))
                        ? objData.blockedMarginDisplay
                        : objData.blockedMargin
                );
                const blockedMarginHint = String(objData.blockedMarginHint || "").trim();
                if (blockedMarginHint) {
                    ids.blockedMarginValue.title = blockedMarginHint;
                }
                else {
                    ids.blockedMarginValue.removeAttribute("title");
                }
            }
        }
        if (ids.availableBalanceValue) {
            if (!isCoveredMode) {
                ids.availableBalanceValue.textContent = fmtUsd(objData.availableBalance);
            }
        }
        if (ids.healthValue) {
            ids.healthValue.textContent = Number.isFinite(Number(objData.healthPct)) ? `${Number(objData.healthPct).toFixed(2)} %` : "-";
        }
        if (ids.profileLabel) {
            ids.profileLabel.textContent = String(objData.profileLabel || "").trim() || "-";
        }
        if (ids.openCount) {
            ids.openCount.textContent = Number.isFinite(Number(objData.openCount)) ? String(Math.max(0, Math.trunc(Number(objData.openCount)))) : "0";
        }
        setButtonsEnabled();
    }

    function getUiState() {
        const state = {
            startQty: getInputValue(ids.startQty, (isDemoVariant || isStrangleLikePage) ? "1" : "2"),
            symbol: String(ids.symbol?.value || "BTC").trim().toUpperCase(),
            manualFutOrderType: String(ids.futureOrderType?.value || "market_order").trim() === "limit_order" ? "limit_order" : "market_order",
            bsFutQty: getInputValue(ids.bsFutQty, "1"),
            minusDelta: getInputValue(ids.minusDelta, "-25"),
            plusDelta: getInputValue(ids.plusDelta, "25"),
            onlyDeltaNeutral: isCoveredMode ? false : getCheckboxValue(ids.onlyDeltaNeutral, false),
            rangeDeltaNeutral: isCoveredMode ? false : getCheckboxValue(ids.rangeDeltaNeutral, false),
            gammaAwareNeutral: getCheckboxValue(ids.gammaAwareNeutral, false),
            closeNetProfitBrokerage: getCheckboxValue(ids.closeNetProfitBrokerage, false),
            brokerageMultiplier: getInputValue(ids.brokerageMultiplier, "3"),
            reEnterBrok: false,
            closeBlockedMargin: getCheckboxValue(ids.closeBlockedMargin, false),
            blockedMarginPct: getInputValue(ids.blockedMarginPct, "20"),
            reEnterBlock: false,
            buyHedgeSellPremiumGate: isStrangleLikePage ? false : getCheckboxValue(ids.buyHedgeSellPremiumGate, false),
            buyHedgeSellPremiumPct: isStrangleLikePage ? "2" : getInputValue(ids.buyHedgeSellPremiumPct, "1"),
            strangleDeltaDiffReplaceEnabled: isStrangleLikePage ? getCheckboxValue(ids.strangleDeltaDiffReplaceEnabled, false) : false,
            strangleDeltaDiffReplacePct: isStrangleLikePage ? getInputValue(ids.strangleDeltaDiffReplacePct, "50") : "50",
            buyHedgeOppositeLegOnGate: getCheckboxValue(ids.buyHedgeOppositeLegOnGate, false),
            strangleReopenAtNewD: isStrangleLikePage ? getCheckboxValue(ids.strangleReopenAtNewD, false) : false,
            buyQtyPercentEnabled: isStrangleLikePage ? false : getCheckboxValue(ids.buyQtyPercentEnabled, false),
            buyQtyPercent: isStrangleLikePage ? "100" : getInputValue(ids.buyQtyPercent, "100"),
            renkoEnabled: supportsRenkoFeed ? getCheckboxValue(ids.renkoEnabled, false) : false,
            renkoStepPoints: supportsRenkoFeed ? String(getRenkoBoxSizeValue()) : "100",
            renkoBaseValue: supportsRenkoFeed ? normalizeRenkoBaseValue(ids.renkoBaseValue?.value || "") : "",
            renkoBaseValues: supportsRenkoFeed
                ? {
                    ...renkoBaseValuesBySymbol,
                    [getCurrentSelectedSymbol()]: normalizeRenkoBaseValue(ids.renkoBaseValue?.value || "")
                }
                : { BTC: "", ETH: "" },
            renkoStateBySymbol: supportsRenkoFeed
                ? renkoStateBySymbol
                : {
                    BTC: { referencePrice: "", lastColor: "neutral" },
                    ETH: { referencePrice: "", lastColor: "neutral" }
                },
            renkoHistoryBySymbol: supportsRenkoFeed
                ? renkoHistoryBySymbol
                : { BTC: [], ETH: [] },
            autoConfirmLiveActions: isDemoVariant ? true : getCheckboxValue(ids.autoConfirmLiveActions, false),
            telegramAlertTypes: supportsTelegramAlerts
                ? ids.telegramEventCheckboxes.filter(function (checkbox) {
                    return checkbox instanceof HTMLInputElement && checkbox.checked;
                }).map(function (checkbox) {
                    return String(checkbox.value || "").trim();
                }).filter(Boolean)
                : [],
            closedFromDate: String(ids.closedFromDate?.value || "").trim(),
            closedToDate: String(ids.closedToDate?.value || "").trim()
        };
        getSupportedOptionRowIndexes().forEach(function (rowIndex) {
            Object.assign(state, readOptionRowState(rowIndex));
        });
        return state;
    }

    function applyUiState(uiState) {
        const previousClosedFromDate = String(ids.closedFromDate?.value || "").trim();
        const previousClosedToDate = String(ids.closedToDate?.value || "").trim();
        let closedFiltersChanged = false;
        isApplyingState = true;
        try {
            const objUiState = { ...getDefaultUiState(), ...(uiState || {}) };
            renkoBaseValuesBySymbol = normalizeRenkoBaseValues(objUiState.renkoBaseValues);
            renkoStateBySymbol = normalizeRenkoStateValues(objUiState.renkoStateBySymbol);
            renkoHistoryBySymbol = normalizeRenkoHistoryValues(objUiState.renkoHistoryBySymbol);
            setInputValue(ids.startQty, objUiState.startQty);
            setInputValue(ids.symbol, String(objUiState.symbol || "BTC").trim().toUpperCase() === "ETH" ? "ETH" : "BTC");
            if (!renkoBaseValuesBySymbol[getCurrentSelectedSymbol()] && supportsRenkoFeed) {
                renkoBaseValuesBySymbol[getCurrentSelectedSymbol()] = normalizeRenkoBaseValue(objUiState.renkoBaseValue || "");
            }
            syncRenkoBaseValueForSymbol(getCurrentSelectedSymbol());
            setInputValue(ids.futureOrderType, String(objUiState.manualFutOrderType || "market_order").trim() === "limit_order" ? "limit_order" : "market_order");
            setInputValue(ids.bsFutQty, objUiState.bsFutQty);
            setInputValue(ids.minusDelta, objUiState.minusDelta);
            setInputValue(ids.plusDelta, objUiState.plusDelta);
            setCheckboxValue(ids.onlyDeltaNeutral, isCoveredMode ? false : objUiState.onlyDeltaNeutral);
            setCheckboxValue(ids.rangeDeltaNeutral, isCoveredMode ? false : objUiState.rangeDeltaNeutral);
            setCheckboxValue(ids.gammaAwareNeutral, isCoveredMode ? false : objUiState.gammaAwareNeutral);
            getSupportedOptionRowIndexes().forEach(function (rowIndex) {
                applyOptionRowState(objUiState, rowIndex);
            });
            setCheckboxValue(ids.closeNetProfitBrokerage, objUiState.closeNetProfitBrokerage);
            setInputValue(ids.brokerageMultiplier, objUiState.brokerageMultiplier);
            setCheckboxValue(ids.closeBlockedMargin, objUiState.closeBlockedMargin);
            setInputValue(ids.blockedMarginPct, objUiState.blockedMarginPct);
            setCheckboxValue(ids.buyHedgeSellPremiumGate, isStrangleLikePage ? false : objUiState.buyHedgeSellPremiumGate);
            setInputValue(ids.buyHedgeSellPremiumPct, isStrangleLikePage ? "2" : objUiState.buyHedgeSellPremiumPct);
            setCheckboxValue(ids.strangleDeltaDiffReplaceEnabled, objUiState.strangleDeltaDiffReplaceEnabled);
            setInputValue(ids.strangleDeltaDiffReplacePct, objUiState.strangleDeltaDiffReplacePct);
            setCheckboxValue(ids.buyHedgeOppositeLegOnGate, objUiState.buyHedgeOppositeLegOnGate);
            setCheckboxValue(ids.strangleReopenAtNewD, objUiState.strangleReopenAtNewD);
            setCheckboxValue(ids.buyQtyPercentEnabled, isStrangleLikePage ? false : objUiState.buyQtyPercentEnabled);
            setInputValue(ids.buyQtyPercent, isStrangleLikePage ? "100" : objUiState.buyQtyPercent);
            setCheckboxValue(ids.renkoEnabled, supportsRenkoFeed ? objUiState.renkoEnabled : false);
            setInputValue(ids.renkoBoxSize, supportsRenkoFeed ? objUiState.renkoStepPoints : "100");
            setInputValue(ids.renkoBaseValue, supportsRenkoFeed ? String(renkoBaseValuesBySymbol[getCurrentSelectedSymbol()] || "") : "");
            if (ids.renkoBoxSize instanceof HTMLInputElement) {
                ids.renkoBoxSize.value = String(clampRenkoBoxSizeValue(ids.renkoBoxSize.value));
            }
            setCheckboxValue(ids.autoConfirmLiveActions, isDemoVariant ? true : objUiState.autoConfirmLiveActions);
            setInputValue(ids.closedFromDate, String(objUiState.closedFromDate || "").trim());
            setInputValue(ids.closedToDate, String(objUiState.closedToDate || "").trim());
            closedFiltersChanged = previousClosedFromDate !== String(ids.closedFromDate?.value || "").trim()
                || previousClosedToDate !== String(ids.closedToDate?.value || "").trim();
            if (supportsTelegramAlerts) {
                const selectedTypes = new Set(Array.isArray(objUiState.telegramAlertTypes) ? objUiState.telegramAlertTypes.map(String) : []);
                ids.telegramEventCheckboxes.forEach(function (checkbox) {
                    if (checkbox instanceof HTMLInputElement) {
                        checkbox.checked = selectedTypes.has(String(checkbox.value || ""));
                    }
                });
            }
            applySymbolDefaults();
            applyExpiryModeDefaults(false);
            syncQtyFromStartQty();
            syncNeutralModeCheckboxes(getActiveNeutralModeKey());
            updateNeutralBadges(lastNeutralStatus);
            refreshCoveredBalanceSummaryDisplay();
            updateRenkoFeedDisplay(lastAccountSummary);
            syncLocalProfitClosePendingFromOpenPositions();
            restartProfitCloseCountdown();
        }
        finally {
            isApplyingState = false;
        }
        if (closedFiltersChanged && selectedApiProfileId && connectionState === "connected") {
            queueClosedPositionsRefresh();
        }
    }

    function syncQtyFromStartQty() {
        if (!(ids.startQty instanceof HTMLInputElement)) {
            return;
        }
        if (isCoveredMode && ids.buyQtyPercent instanceof HTMLInputElement) {
            ids.buyQtyPercent.value = String(clampCoveredBuyQtyPercentValue(ids.buyQtyPercent.value));
        }
        const vStartQty = String(ids.startQty.value || "").trim() || String(getCoveredMultiplierMin());
        const vCoveredMultiplierQty = isCoveredMode ? getCoveredMultiplierDraftValue() : Math.max(1, Math.floor(Number(vStartQty || 1)));
        const vCoveredBuyQty = isCoveredMode ? resolveCoveredBuyRowQty(vCoveredMultiplierQty) : vCoveredMultiplierQty;
        getSupportedOptionRowIndexes().forEach(function (rowIndex) {
            const nodes = getOptionRowNodes(rowIndex);
            if (nodes.qty instanceof HTMLInputElement) {
                if (isCoveredMode) {
                    const vAction = String(nodes.action?.value || "").trim().toLowerCase();
                    nodes.qty.value = String(vAction === "buy" ? vCoveredBuyQty : vCoveredMultiplierQty);
                }
                else {
                    nodes.qty.value = vStartQty;
                }
            }
        });
        refreshCoveredBalanceSummaryDisplay();
    }

    async function resetManualTraderDefaults() {
        const defaultState = getDefaultUiState();
        defaultState.closedFromDate = String(ids.closedFromDate?.value || "").trim();
        defaultState.closedToDate = String(ids.closedToDate?.value || "").trim();
        applyUiState(defaultState);
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

    function queueClosedPositionsRefresh() {
        if (closedFiltersRefreshTimer) {
            clearTimeout(closedFiltersRefreshTimer);
        }
        closedFiltersRefreshTimer = setTimeout(function () {
            closedFiltersRefreshTimer = null;
            void loadClosedPositions().catch(function (error) {
                setStatus(ids.pageStatus, error instanceof Error ? error.message : "Unable to refresh closed positions.", "danger");
            });
        }, 150);
    }

    async function saveProfile() {
        return postJson(`${endpointBase}/profile`, {
            selectedApiProfileId: String(ids.apiProfile?.value || selectedApiProfileId || "").trim(),
            uiState: getUiState()
        });
    }

    function renderAdminRunningUsers(users) {
        if (!(ids.adminTargetUser instanceof HTMLSelectElement)) {
            return;
        }
        const arrUsers = Array.isArray(users) ? users : [];
        if (requiresExplicitTargetSelection) {
            ids.adminTargetUser.innerHTML = [
                `<option value="">Select running user</option>`,
                ...arrUsers.map(function (user) {
                    const vAccountId = String(user.accountId || "").trim();
                    const vFullName = String(user.fullName || "User").trim();
                    const vEmail = String(user.email || "").trim();
                    const vLabel = vEmail ? `${vFullName} (${vEmail})` : vFullName;
                    return `<option value="${escapeHtml(vAccountId)}">${escapeHtml(vLabel)}</option>`;
                })
            ].join("");
            ids.adminTargetUser.disabled = false;
            ids.adminTargetUser.value = targetUserId || "";
            return;
        }
        const arrOtherRunningUsers = arrUsers.filter(function (user) {
            return String(user.accountId || "").trim() !== currentAccountId;
        });
        const vCurrentUserLabel = currentAccountEmail
            ? `${currentAccountFullName || "Current User"} (${currentAccountEmail})`
            : (currentAccountFullName || "Current User");
        ids.adminTargetUser.innerHTML = [
            `<option value="${escapeHtml(currentAccountId)}">${escapeHtml(vCurrentUserLabel)}</option>`,
            ...arrOtherRunningUsers.map(function (user) {
                const vAccountId = String(user.accountId || "").trim();
                const vFullName = String(user.fullName || "User").trim();
                const vEmail = String(user.email || "").trim();
                const vLabel = vEmail ? `${vFullName} (${vEmail})` : vFullName;
                return `<option value="${escapeHtml(vAccountId)}">${escapeHtml(vLabel)}</option>`;
            })
        ].join("");
        ids.adminTargetUser.disabled = false;
        ids.adminTargetUser.value = targetUserId || currentAccountId;
    }

    async function loadAdminRunningUsers() {
        if (!isAdminTargetModeActive()) {
            return;
        }
        const objResult = await getJson(`${endpointBase}/admin/running-users`);
        adminRunningUsers = Array.isArray(objResult?.data) ? objResult.data : [];
        if (requiresExplicitTargetSelection) {
            const bCurrentSelectionValid = adminRunningUsers.some(function (user) {
                return String(user.accountId || "").trim() === targetUserId;
            });
            if (!bCurrentSelectionValid) {
                targetUserId = "";
            }
            renderAdminRunningUsers(adminRunningUsers);
            const objSelectedUser = adminRunningUsers.find(function (user) {
                return String(user.accountId || "").trim() === targetUserId;
            });
            currentTargetAccount = objSelectedUser
                ? {
                    accountId: String(objSelectedUser.accountId || "").trim(),
                    fullName: String(objSelectedUser.fullName || "").trim(),
                    email: String(objSelectedUser.email || "").trim(),
                    telegramChatId: String(objSelectedUser.telegramChatId || "").trim(),
                    execStrategy: Boolean(objSelectedUser.execStrategy)
                }
                : {
                    accountId: "",
                    fullName: "",
                    email: "",
                    telegramChatId: "",
                    execStrategy: false
                };
            updateAdminTargetMeta();
            updateTelegramNotice();
            return;
        }
        if (!adminRunningUsers.length) {
            targetUserId = currentAccountId;
            currentTargetAccount = {
                accountId: currentAccountId,
                fullName: currentAccountFullName,
                email: currentAccountEmail,
                telegramChatId: currentAccountTelegramChatId,
                execStrategy: initialExecStrategyEnabled
            };
            renderAdminRunningUsers([]);
            updateAdminTargetMeta();
            updateTelegramNotice();
            return;
        }
        const bCurrentSelectionValid = targetUserId === currentAccountId || adminRunningUsers.some(function (user) {
            return String(user.accountId || "").trim() === targetUserId;
        });
        if (!bCurrentSelectionValid) {
            targetUserId = currentAccountId;
        }
        renderAdminRunningUsers(adminRunningUsers);
        const objSelectedUser = targetUserId === currentAccountId ? null : adminRunningUsers.find(function (user) {
            return String(user.accountId || "").trim() === targetUserId;
        });
        if (objSelectedUser) {
            currentTargetAccount = {
                accountId: String(objSelectedUser.accountId || "").trim(),
                fullName: String(objSelectedUser.fullName || "").trim(),
                email: String(objSelectedUser.email || "").trim(),
                telegramChatId: String(objSelectedUser.telegramChatId || "").trim(),
                execStrategy: Boolean(objSelectedUser.execStrategy)
            };
        }
        else {
            currentTargetAccount = {
                accountId: currentAccountId,
                fullName: currentAccountFullName,
                email: currentAccountEmail,
                telegramChatId: currentAccountTelegramChatId,
                execStrategy: initialExecStrategyEnabled
            };
        }
        updateAdminTargetMeta();
        updateTelegramNotice();
    }

    async function loadApiProfiles() {
        const objResult = await getJson(withTargetUrl("/api/account/delta-api-profiles"));
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
        if (objData.targetAccount && typeof objData.targetAccount === "object") {
            currentTargetAccount = {
                accountId: String(objData.targetAccount.accountId || getEffectiveTargetUserId() || currentAccountId).trim(),
                fullName: String(objData.targetAccount.fullName || "").trim(),
                email: String(objData.targetAccount.email || "").trim(),
                telegramChatId: String(objData.targetAccount.telegramChatId || "").trim(),
                execStrategy: Boolean(objData.targetAccount.execStrategy)
            };
            if (isAdminTargetModeActive() && ids.adminTargetUser instanceof HTMLSelectElement && currentTargetAccount.accountId) {
                targetUserId = currentTargetAccount.accountId;
                if (Array.from(ids.adminTargetUser.options).some(function (option) { return option.value === targetUserId; })) {
                    ids.adminTargetUser.value = targetUserId;
                }
            }
            updateAdminTargetMeta();
            updateTelegramNotice();
        }
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

    async function updateRecoveryMetrics(vBrokerage, vTotalPnl) {
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

    async function saveRecoveryMetricsOverride() {
        const vBrokerage = Number(ids.brok2Rec instanceof HTMLInputElement ? ids.brok2Rec.value : 0);
        const vTotalPnl = Number(ids.yet2Recover instanceof HTMLInputElement ? ids.yet2Recover.value : 0);
        return updateRecoveryMetrics(vBrokerage, vTotalPnl);
    }

    async function recalculateTotalPnlFromHistory() {
        const objResult = await postJson(`${endpointBase}/metrics/recalculate-total-pnl`, {});
        renderOpenPositions(objResult?.data);
        return objResult;
    }

    async function calculateRecommendedStartQty() {
        return postJson(`${endpointBase}/start-qty/calculate`, {});
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
        if (objData.summary && typeof objData.summary === "object") {
            applyAccountSummaryData({
                totalBalance: objData.summary.totalBalance,
                blockedMargin: objData.summary.blockedMargin,
                blockedMarginDisplay: objData.summary.blockedMarginDisplay,
                blockedMarginHint: objData.summary.blockedMarginHint,
                availableBalance: objData.summary.availableBalance
            });
        }
        return objResult;
    }

    async function refreshExchangeConnectionSection() {
        const objResult = await checkConnection();
        await Promise.all([
            loadAccountSummary().catch(function () { return undefined; }),
            loadClosedPositions().catch(function () { return undefined; }),
            loadSavedOpenPositions().catch(function () { return undefined; })
        ]);
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

    async function executeStrategy(rowIndex) {
        const optionRowIndex = normalizeOptionRowIndex(rowIndex);
        const rowNodes = getOptionRowNodes(optionRowIndex);
        if (execStrategyInFlight) {
            throw new Error("Exec Strategy is already running. Please wait for it to finish.");
        }
        if (!canUseExecStrategy()) {
            throw new Error("Not Authorised to Execute, Please Contact Admin");
        }

        await checkConnection();
        if (!canUseLiveActions()) {
            throw new Error("Delta connection is not healthy enough to execute the live strategy.");
        }
        if (!autoTraderEnabled) {
            throw new Error("Turn Auto Trader ON before executing the live strategy.");
        }
        ensureCoveredExecBalance();

        await saveProfile();

        const vAction = String(rowNodes.action?.value || "").trim().toLowerCase();
        const vLegSide = String(rowNodes.legs?.value || "").trim().toLowerCase();
        const vExpiryMode = String(rowNodes.expiryMode?.value || "5").trim();
        const vExpiryDate = String(rowNodes.expiryDate?.value || "").trim();
        const vBaseQty = Math.max(1, Math.floor(Number(rowNodes.qty?.value || 1)));
        const vTargetDelta = Math.max(0, Number(rowNodes.newD?.value || 0.53));
        const vSymbol = String(ids.symbol?.value || "BTC").trim().toUpperCase();
        const vQty = resolveCoveredTradeQty(vAction, vLegSide, vBaseQty, vSymbol);

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
                selectedApiProfileId: String(ids.apiProfile?.value || selectedApiProfileId || "").trim(),
                uiState: getUiState(),
                rowIndex: optionRowIndex,
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

    function buildCoveredStrategyRowPayload(rowIndex) {
        const optionRowIndex = normalizeOptionRowIndex(rowIndex);
        const rowNodes = getOptionRowNodes(optionRowIndex);
        const vAction = String(rowNodes.action?.value || "").trim().toLowerCase();
        const vLegSide = String(rowNodes.legs?.value || "").trim().toLowerCase();
        const vExpiryMode = String(rowNodes.expiryMode?.value || "5").trim();
        const vExpiryDate = String(rowNodes.expiryDate?.value || "").trim();
        const vBaseQty = Math.max(1, Math.floor(Number(rowNodes.qty?.value || 1)));
        const vTargetDelta = Math.max(0, Number(rowNodes.newD?.value || 0.53));
        const vSymbol = String(ids.symbol?.value || "BTC").trim().toUpperCase();
        const vQty = resolveCoveredTradeQty(vAction, vLegSide, vBaseQty, vSymbol);

        if (vAction !== "buy" && vAction !== "sell") {
            throw new Error(`Select Buy or Sell in Action for row ${optionRowIndex} before executing the live strategy.`);
        }
        if (!vExpiryDate) {
            throw new Error(`Select an expiry date for row ${optionRowIndex} before executing the live strategy.`);
        }

        return {
            rowIndex: optionRowIndex,
            action: vAction,
            symbol: vSymbol,
            legSide: vLegSide,
            expiryMode: vExpiryMode,
            expiryDate: vExpiryDate,
            qty: vQty,
            targetDelta: vTargetDelta
        };
    }

    async function executeCoveredStrategies() {
        if (!isCoveredMode) {
            return executeStrategy(1);
        }

        await checkConnection();
        if (!canUseLiveActions()) {
            throw new Error("Delta connection is not healthy enough to execute the live covered strategy.");
        }
        ensureCoveredExecBalance();

        await saveProfile();
        execStrategyInFlight = true;
        setButtonsEnabled();
        try {
            const rows = getSupportedOptionRowIndexes().map(function (rowIndex) {
                return buildCoveredStrategyRowPayload(rowIndex);
            });
            return await postJson(`${endpointBase}/strategy/execute`, {
                selectedApiProfileId: String(ids.apiProfile?.value || selectedApiProfileId || "").trim(),
                uiState: getUiState(),
                rows: rows
            });
        }
        finally {
            execStrategyInFlight = false;
            setButtonsEnabled();
        }
    }

    async function placeManualOption(action, legSide, rowIndex) {
        const optionRowIndex = normalizeOptionRowIndex(rowIndex);
        const rowNodes = getOptionRowNodes(optionRowIndex);
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
        if (isDemoVariant && !autoTraderEnabled) {
            throw new Error("Turn Auto Trader ON before placing paper option orders.");
        }

        await saveProfile();

        const vExpiryMode = String(rowNodes.expiryMode?.value || "5").trim();
        const vExpiryDate = String(rowNodes.expiryDate?.value || "").trim();
        const vBaseQty = Math.max(1, Math.floor(Number(rowNodes.qty?.value || 1)));
        const vTargetDelta = Math.max(0, Number(rowNodes.newD?.value || 0.53));
        const vSymbol = String(ids.symbol?.value || "BTC").trim().toUpperCase();
        const vQty = resolveCoveredTradeQty(vAction, vLegSide, vBaseQty, vSymbol);

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
                rowIndex: optionRowIndex,
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
        applyAccountSummaryData(objResult?.data || {});
    }

    async function loadOptionsDemoIndicator() {
        if (!isDemoVariant) {
            return;
        }
        const query = new URLSearchParams();
        query.set("symbol", String(ids.symbol?.value || "BTC").trim().toUpperCase());
        const objResult = await getJson(`${endpointBase}/indicator?${query.toString()}`);
        renderOptionsDemoIndicator(objResult?.data || null);
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
            <div class="rolling-demo-greek-value current">${escapeHtml(fmt(contractValue, digits))}</div>
            <div class="rolling-demo-greek-value reference">${escapeHtml(fmt(totalValue, digits))}</div>
        `;
    }

    function renderPositionSide(side) {
        const normalizedSide = String(side || "-").trim().toUpperCase();
        if (!isCoveredMode || (normalizedSide !== "BUY" && normalizedSide !== "SELL")) {
            return escapeHtml(normalizedSide);
        }
        const sideClass = normalizedSide.toLowerCase();
        const directionArrow = normalizedSide === "BUY" ? "↑" : "↓";
        return `<span class="rolling-covered-side-badge ${sideClass}"><span aria-hidden="true">${directionArrow}</span>${normalizedSide}</span>`;
    }

    function renderPnlValue(value, isTotal) {
        if (value === null || value === undefined || !Number.isFinite(Number(value))) {
            return "-";
        }
        const pnl = Number(value);
        if (!isCoveredMode) {
            return escapeHtml(fmt(pnl, 2));
        }
        const toneClass = pnl > 0 ? "positive" : (pnl < 0 ? "negative" : "neutral");
        const displayValue = `${pnl > 0 ? "+" : ""}${fmt(pnl, 2)}`;
        return `<span class="rolling-covered-pnl-value ${toneClass}${isTotal ? " total" : ""}">${escapeHtml(displayValue)}</span>`;
    }

    function getCoveredContractLegSide(contractName) {
        const symbol = String(contractName || "").trim().toUpperCase();
        if (symbol.startsWith("P-") || symbol.includes("-P-") || symbol.endsWith("-P") || symbol.includes("PUT")) {
            return "PE";
        }
        if (symbol.startsWith("C-") || symbol.includes("-C-") || symbol.endsWith("-C") || symbol.includes("CALL")) {
            return "CE";
        }
        return "";
    }

    function findLatestCoveredSellLeg(rows, legSide) {
        return (Array.isArray(rows) ? rows : [])
            .filter(function (row) {
                return String(row?.side || "").trim().toUpperCase() === "SELL"
                    && getCoveredContractLegSide(row?.contractName) === legSide;
            })
            .sort(function (left, right) {
                return new Date(String(right?.openedAt || right?.updatedAt || "")).getTime()
                    - new Date(String(left?.openedAt || left?.updatedAt || "")).getTime();
            })[0] || null;
    }

    function getCoveredTradeIncrementLots() {
        const bEnabled = ids.buyHedgeSellPremiumGate instanceof HTMLInputElement
            && ids.buyHedgeSellPremiumGate.checked;
        const vRawIncrement = Number(ids.buyHedgeSellPremiumPct instanceof HTMLInputElement
            ? ids.buyHedgeSellPremiumPct.value
            : 1);
        const vIncrementLots = Number.isFinite(vRawIncrement)
            ? Math.max(0, Math.floor(vRawIncrement))
            : 1;
        return {
            enabled: bEnabled,
            incrementLots: vIncrementLots
        };
    }

    function isTrackedCoveredTradeForSymbol(row, symbol) {
        const normalizedSymbol = String(symbol || "").trim().toUpperCase();
        const contractName = String(row?.contractName || "").trim().toUpperCase();
        if (!normalizedSymbol || !contractName) {
            return false;
        }
        return contractName.includes(`-${normalizedSymbol}-`)
            || contractName.startsWith(`${normalizedSymbol}-`)
            || contractName.includes(normalizedSymbol);
    }

    function countActiveCoveredTradesByLeg(symbol, legSide, action) {
        const normalizedLegSide = String(legSide || "").trim().toUpperCase() === "PE" ? "PE" : "CE";
        const normalizedAction = String(action || "").trim().toUpperCase() === "BUY" ? "BUY" : "SELL";
        return (Array.isArray(displayedPositions) ? displayedPositions : []).filter(function (row) {
            return !isDisplayedPositionInactive(row)
                && isTrackedCoveredTradeForSymbol(row, symbol)
                && String(row?.side || "").trim().toUpperCase() === normalizedAction
                && getCoveredContractLegSide(row?.contractName) === normalizedLegSide;
        }).length;
    }

    function resolveCoveredTradeQty(action, legSide, rowQty, symbol) {
        const vBaseQty = Math.max(1, Math.floor(Number(rowQty || 1)));
        if (!isCoveredMode || isStrangleLikePage) {
            return vBaseQty;
        }
        const objIncrementConfig = getCoveredTradeIncrementLots();
        if (!objIncrementConfig.enabled || !(objIncrementConfig.incrementLots > 0)) {
            return vBaseQty;
        }
        const vExistingTrades = countActiveCoveredTradesByLeg(symbol, legSide, action);
        return vBaseQty + (vExistingTrades * objIncrementConfig.incrementLots);
    }

    function renderCoveredHedgeGateSummary(rows) {
        if (!isCoveredMode || !ids.hedgeGateSummary) {
            return;
        }
        if (isStrangleLikePage) {
            const bEnabled = ids.strangleDeltaDiffReplaceEnabled instanceof HTMLInputElement
                && ids.strangleDeltaDiffReplaceEnabled.checked;
            const vThresholdPctRaw = Number(ids.strangleDeltaDiffReplacePct instanceof HTMLInputElement
                ? ids.strangleDeltaDiffReplacePct.value
                : 50);
            const vThresholdPct = Number.isFinite(vThresholdPctRaw)
                ? Math.min(100, Math.max(0, vThresholdPctRaw))
                : 50;
            if (!bEnabled) {
                ids.hedgeGateSummary.innerHTML = '<span class="rolling-covered-hedge-chip off">Replace Off</span>';
                return;
            }
            const sellRows = Array.isArray(rows) ? rows.filter(function (row) {
                const legSide = getCoveredContractLegSide(String(row?.contractName || "").trim());
                return String(row?.side || "").trim().toUpperCase() === "SELL"
                    && (legSide === "CE" || legSide === "PE");
            }) : [];
            const liveDeltas = sellRows.map(function (row) {
                const greeks = row?.greeks || {};
                const rawDelta = Number(greeks.deltaPerContract);
                return Math.abs(rawDelta);
            }).filter(function (value) {
                return Number.isFinite(value) && value > 0;
            }).sort(function (left, right) {
                return left - right;
            });
            let currentPctText = "—";
            if (liveDeltas.length >= 2) {
                const weakerDelta = liveDeltas[0];
                const strongerDelta = liveDeltas[liveDeltas.length - 1];
                const totalLiveDelta = weakerDelta + strongerDelta;
                if (totalLiveDelta > 0) {
                    currentPctText = fmt(((strongerDelta - weakerDelta) / totalLiveDelta) * 100, 0);
                }
            }
            ids.hedgeGateSummary.innerHTML = `<span class="rolling-covered-hedge-chip gate">Replace at ${escapeHtml(fmt(vThresholdPct, 0))}% Current at ${escapeHtml(currentPctText)}%</span>`;
            return;
        }
        const objIncrementConfig = getCoveredTradeIncrementLots();
        if (!objIncrementConfig.enabled) {
            ids.hedgeGateSummary.innerHTML = '<span class="rolling-covered-hedge-chip off">Increment Off</span>';
            return;
        }
        const vSymbol = String(ids.symbol?.value || "BTC").trim().toUpperCase();
        const row1Qty = Math.max(1, Math.floor(Number(getOptionRowNodes(1).qty?.value || 1)));
        const row2Qty = Math.max(1, Math.floor(Number(getOptionRowNodes(2).qty?.value || 1)));
        const nextLegChips = [
            {
                label: "PE",
                qty: resolveCoveredTradeQty("sell", "pe", row1Qty, vSymbol),
                activeCount: countActiveCoveredTradesByLeg(vSymbol, "pe", "sell")
            },
            {
                label: "CE",
                qty: resolveCoveredTradeQty("sell", "ce", row2Qty, vSymbol),
                activeCount: countActiveCoveredTradesByLeg(vSymbol, "ce", "sell")
            }
        ].map(function (entry) {
            return `<span class="rolling-covered-hedge-chip neutral">${entry.label} Next ${escapeHtml(fmt(entry.qty, 0))} (${escapeHtml(fmt(entry.activeCount, 0))} open)</span>`;
        }).join("");
        ids.hedgeGateSummary.innerHTML = `
            <span class="rolling-covered-hedge-chip gate">Increment +${escapeHtml(fmt(objIncrementConfig.incrementLots, 0))}</span>
            ${nextLegChips}
        `;
        return;
        const gateEnabled = ids.buyHedgeSellPremiumGate instanceof HTMLInputElement
            && ids.buyHedgeSellPremiumGate.checked;
        const rawThresholdPct = Number(ids.buyHedgeSellPremiumPct instanceof HTMLInputElement
            ? ids.buyHedgeSellPremiumPct.value
            : 2);
        const thresholdPct = Number.isFinite(rawThresholdPct)
            ? Math.min(100, Math.max(0, rawThresholdPct))
            : 2;
        if (!gateEnabled) {
            ids.hedgeGateSummary.innerHTML = '<span class="rolling-covered-hedge-chip off">Gate Off</span>';
            return;
        }
        const minimumRatio = Math.max(0, 1 - (thresholdPct / 100));
        const legChips = ["CE", "PE"].map(function (legSide) {
            const sellLeg = findLatestCoveredSellLeg(rows, legSide);
            const soldPremium = Number(sellLeg?.entryPrice || 0);
            const currentPremium = Number(sellLeg?.markPrice || sellLeg?.entryPrice || 0);
            if (!(soldPremium > 0)) {
                return `<span class="rolling-covered-hedge-chip neutral">${legSide} Min —</span>`;
            }
            const minimumPremium = soldPremium * minimumRatio;
            const toneClass = currentPremium < minimumPremium ? "success" : "danger";
            const title = `${legSide} current ${fmt(currentPremium, 2)} | sold ${fmt(soldPremium, 2)} | minimum ${fmt(minimumPremium, 2)}`;
            return `<span class="rolling-covered-hedge-chip ${toneClass}" title="${escapeHtml(title)}">${legSide} Min ${escapeHtml(fmt(minimumPremium, 2))}</span>`;
        }).join("");
        ids.hedgeGateSummary.innerHTML = `
            <span class="rolling-covered-hedge-chip gate">Gate ${escapeHtml(fmt(thresholdPct, 2))}%</span>
            ${legChips}
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
        lastOpenPositionsPayload = objPayload;
        const arrRows = Array.isArray(objPayload.positions)
            ? objPayload.positions.slice().sort(function (left, right) {
                return new Date(String(right?.openedAt || right?.updatedAt || "")).getTime()
                    - new Date(String(left?.openedAt || left?.updatedAt || "")).getTime();
            })
            : [];
        const objTotals = objPayload.totals || {};
        displayedPositions = arrRows;
        renderCoveredHedgeGateSummary(arrRows);
        lastNeutralStatus = objPayload.neutralStatus || null;
        applyRecoveryMetrics(objPayload.recoveryMetrics || null);
        updateNeutralBadges(lastNeutralStatus);
        syncLocalProfitClosePendingFromOpenPositions();
        restartProfitCloseCountdown();
        if (!ids.openPositionsBody) {
            return;
        }
        if (!arrRows.length) {
            previousOpenPositionLtps = new Map();
            const openPositionsColumnCount = isCoveredMode ? 13 : 14;
            ids.openPositionsBody.innerHTML = `<tr><td colspan="${openPositionsColumnCount}" class="rolling-demo-empty">${escapeHtml(openPositionsEmptyText)}</td></tr>`;
            if (ids.openCount) {
                ids.openCount.textContent = "0";
            }
            if (ids.openPageInfo) {
                ids.openPageInfo.textContent = "Page 0 of 0";
            }
            if (ids.openPageNumbers) {
                ids.openPageNumbers.innerHTML = "";
            }
            setButtonsEnabled();
            return;
        }
        const totalPages = Math.max(1, Math.ceil(arrRows.length / openPositionsPageSize));
        openPositionsPage = Math.min(openPositionsPage, totalPages);
        openPositionsPage = Math.max(openPositionsPage, 1);
        const startIndex = (openPositionsPage - 1) * openPositionsPageSize;
        const pageRows = arrRows.slice(startIndex, startIndex + openPositionsPageSize);
        const nextLtps = new Map();
        const openRowsHtml = pageRows.map(function (row) {
            const side = String(row.side || "-").trim().toUpperCase();
            const contractName = String(row.contractName || "-");
            const lotSize = contractName.includes("ETH") ? 0.01 : 0.001;
            const importId = String(row.importId || contractName || "");
            const isInactive = isDisplayedPositionInactive(row);
            const inactiveReason = String((row?.metadata && row.metadata.inactiveReason) || "").trim().toUpperCase();
            const inactiveAt = String((row?.metadata && row.metadata.inactiveAt) || "").trim();
            const currentLtp = Number(row.markPrice);
            if (importId && Number.isFinite(currentLtp)) {
                nextLtps.set(importId, currentLtp);
            }
            const ltpBlinkClass = isInactive ? "" : getLtpBlinkClass(importId, row.markPrice);
            const greeks = row.greeks || {};
            const coveredSideRowClass = isCoveredMode && (side === "BUY" || side === "SELL")
                ? `rolling-covered-side-row ${side.toLowerCase()}`
                : "";
            const inactiveRowClass = isInactive ? "rolling-demo-open-row-inactive" : "";
            const swapActionButton = isCoveredMode && !isDemoVariant
                ? `
                            <button class="rolling-demo-icon-btn rolling-live-swap-open-position" type="button" data-import-id="${escapeHtml(importId)}" title="Replace this position using Manual Trader settings" aria-label="Replace this position using Manual Trader settings" ${isInactive ? "disabled" : ""}>
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M17 1v6h-6" />
                                    <path d="M3 11a8 8 0 0 1 14-5l0 1" />
                                    <path d="M7 23v-6h6" />
                                    <path d="M21 13a8 8 0 0 1-14 5l0-1" />
                                </svg>
                            </button>
                `
                : "";
            return `
                <tr class="${coveredSideRowClass} ${inactiveRowClass}">
                    <td>${renderGreekCell(
                        isCoveredMode ? greeks.deltaPerContract : greeks.deltaTotal,
                        resolveSecondaryGreekValue(
                            isCoveredMode ? greeks.deltaDisplayPerContract : greeks.deltaDisplayTotal,
                            isCoveredMode ? greeks.deltaPerContract : greeks.deltaTotal
                        ),
                        2
                    )}</td>
                    <td>${renderGreekCell(greeks.thetaDisplayTotal ?? greeks.thetaTotal, greeks.thetaBaseDisplayTotal ?? greeks.thetaTotal, 4)}</td>
                    <td>${escapeHtml(contractName)}</td>
                    <td>${renderPositionSide(side)}</td>
                    <td>${escapeHtml(fmt(row.lotSize || lotSize, 3))}</td>
                    <td>${escapeHtml(fmt(row.qty, 0))}</td>
                    <td>${side === "BUY" ? escapeHtml(fmt(row.entryPrice, 2)) : "-"}</td>
                    <td>${side === "SELL" ? escapeHtml(fmt(row.entryPrice, 2)) : "-"}</td>
                    <td class="${escapeHtml(ltpBlinkClass)}">${escapeHtml(fmt(row.markPrice, 2))}</td>
                    <td>${escapeHtml(fmt(row.charges, 4))}</td>
                    <td>${renderPnlValue(row.pnl, false)}</td>
                    <td>${escapeHtml(formatDateTimeDisplay(row.openedAt))}</td>
                    ${isCoveredMode ? "" : `<td><span class="rolling-demo-open-state ${isInactive ? "inactive" : "active"}" title="${escapeHtml(isInactive ? `Triggered by ${inactiveReason || "RULE"}${inactiveAt ? ` at ${formatDateTimeDisplay(inactiveAt)}` : ""}` : "Active paper position")}">${isInactive ? "INACTIVE" : "LIVE"}</span></td>`}
                    <td>
                        <div class="rolling-demo-table-actions">
                            ${swapActionButton}
                            <button class="rolling-demo-icon-btn sell rolling-live-close-open-position" type="button" data-import-id="${escapeHtml(importId)}" title="${escapeHtml(isInactive ? "Inactive paper position cannot be closed again." : "Close this open position")}" aria-label="${escapeHtml(isInactive ? "Inactive paper position cannot be closed again." : "Close this open position")}" ${isInactive ? "disabled" : ""}>
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
                <td>${renderGreekCell(
                    isCoveredMode ? objTotals.totalDeltaPerContract : objTotals.totalDelta,
                    resolveSecondaryGreekValue(
                        isCoveredMode ? objTotals.totalDeltaDisplayPerContract : objTotals.totalDeltaDisplay,
                        isCoveredMode ? objTotals.totalDeltaPerContract : objTotals.totalDelta
                    ),
                    2
                )}</td>
                <td>${renderGreekCell(objTotals.totalThetaDisplay ?? objTotals.totalTheta, objTotals.totalThetaBaseDisplay ?? objTotals.totalTheta, 4)}</td>
                <td><strong>TOTAL</strong></td>
                <td>-</td>
                <td>-</td>
                <td>${escapeHtml(fmt(objTotals.positionCount, 0))}</td>
                <td>-</td>
                <td>-</td>
                <td>-</td>
                <td class="rolling-demo-total-value">${escapeHtml(fmt(objTotals.totalCharges, 4))}</td>
                <td class="rolling-demo-total-value">${renderPnlValue(objTotals.totalPnl, true)}</td>
                <td>-</td>
                ${isCoveredMode ? "" : "<td>-</td>"}
                <td>-</td>
            </tr>
        `;
        previousOpenPositionLtps = nextLtps;
        if (ids.openCount) {
            ids.openCount.textContent = String(arrRows.length);
        }
        if (ids.openPageInfo) {
            ids.openPageInfo.textContent = `Page ${openPositionsPage} of ${totalPages} | ${arrRows.length} records`;
        }
        if (ids.openPageNumbers) {
            const pageNumbers = [];
            for (let page = 1; page <= totalPages; page += 1) {
                pageNumbers.push(`<button class="rolling-demo-icon-btn ${page === openPositionsPage ? "primary" : "warn"} rolling-live-open-page-btn" type="button" data-page="${page}">${page}</button>`);
            }
            ids.openPageNumbers.innerHTML = pageNumbers.join("");
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

    async function clearSavedOpenPositions() {
        return postJson(`${endpointBase}/open-positions/clear`, {});
    }

    async function clearSavedClosedPositions() {
        return postJson(`${endpointBase}/closed-positions/clear`, {});
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

    async function swapImportedOpenPosition(row) {
        return postJson(`${endpointBase}/open-positions/swap`, {
            importId: row.importId,
            contractName: row.contractName
        });
    }

    function renderClosedPositions(rows) {
        closedPositions = Array.isArray(rows)
            ? rows.slice().sort(function (left, right) {
                return new Date(String(right?.startAt || right?.endAt || "")).getTime()
                    - new Date(String(left?.startAt || left?.endAt || "")).getTime();
            })
            : [];
        const totalPages = Math.max(1, Math.ceil(closedPositions.length / closedPositionsPageSize));
        closedPositionsPage = Math.min(closedPositionsPage, totalPages);
        closedPositionsPage = Math.max(closedPositionsPage, 1);
        if (!ids.closedPositionsBody) {
            return;
        }
        if (!closedPositions.length) {
            const closedPositionsColumnCount = isCoveredMode ? 9 : 10;
            ids.closedPositionsBody.innerHTML = `<tr><td colspan="${closedPositionsColumnCount}" class="rolling-demo-empty">${escapeHtml(closedPositionsEmptyText)}</td></tr>`;
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
            const side = String(row.side || "-").trim().toUpperCase();
            const lotSize = contractName.includes("ETH") ? 0.01 : 0.001;
            const coveredSideRowClass = isCoveredMode && (side === "BUY" || side === "SELL")
                ? `rolling-covered-side-row ${side.toLowerCase()}`
                : "";
            return `
                <tr class="${coveredSideRowClass}">
                    <td>${escapeHtml(formatDateTimeDisplay(isCoveredMode ? (row.endAt || row.startAt) : row.startAt))}</td>
                    ${isCoveredMode ? "" : `<td>${escapeHtml(formatDateTimeDisplay(row.endAt))}</td>`}
                    <td>${escapeHtml(contractName)}</td>
                    <td>${renderPositionSide(side)}</td>
                    <td>${escapeHtml(fmt(lotSize, 3))}</td>
                    <td>${escapeHtml(fmt(row.qty, 0))}</td>
                    <td>${row.buyPrice === null ? "-" : escapeHtml(fmt(row.buyPrice, 2))}</td>
                    <td>${row.sellPrice === null ? "-" : escapeHtml(fmt(row.sellPrice, 2))}</td>
                    <td>${escapeHtml(fmt(row.charges, 2))}</td>
                    <td>${renderPnlValue(row.pnl, false)}</td>
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
                <td colspan="${isCoveredMode ? 7 : 8}">Total</td>
                <td class="rolling-demo-total-value">${escapeHtml(fmt(totalCharges, 2))}</td>
                <td class="rolling-demo-total-value">${renderPnlValue(totalPnl, true)}</td>
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

    function calculateClosedPositionRecoveryTotals(rows) {
        const arrRows = Array.isArray(rows) ? rows : [];
        return arrRows.reduce(function (totals, row) {
            const vCharges = Number(row?.charges);
            const vPnl = Number(row?.pnl);
            return {
                totalBrokerageToRecover: totals.totalBrokerageToRecover + (Number.isFinite(vCharges) ? vCharges : 0),
                totalPnl: totals.totalPnl + (Number.isFinite(vPnl) ? vPnl : 0)
            };
        }, {
            totalBrokerageToRecover: 0,
            totalPnl: 0
        });
    }

    function renderEvents(rows) {
        const arrRows = Array.isArray(rows) ? rows : [];
        if (!ids.eventLog) {
            return;
        }
        if (!arrRows.length) {
            ids.eventLog.innerHTML = `<div class="rolling-demo-event-empty">${escapeHtml(eventLogEmptyText)}</div>`;
            return;
        }
        ids.eventLog.innerHTML = arrRows.map(function (row) {
            const severity = String(row.severity || "info").trim().toLowerCase();
            const title = String(row.title || "Activity").trim();
            const message = String(row.message || "").trim();
            const eventType = String(row.eventType || "").trim().toLowerCase();
            const createdAt = formatDateTimeDisplay(row.createdAt);
            const eventId = String(row.eventId || "").trim();
            const eventBadge = eventType === "delta_exchange_error"
                ? '<span class="rolling-demo-event-badge delta">Delta Exchange</span>'
                : (eventType === "engine_error"
                    ? '<span class="rolling-demo-event-badge engine">Engine</span>'
                    : "");
            return `
                <article class="rolling-demo-event-item ${escapeHtml(severity)}">
                    <div class="rolling-demo-event-head">
                        <div class="rolling-demo-event-title-stack">
                            <strong class="rolling-demo-event-title">${escapeHtml(title)}</strong>
                            ${eventBadge}
                        </div>
                        <div style="display:flex; align-items:center; gap:10px;">
                            <span class="rolling-demo-event-time">${escapeHtml(createdAt)}</span>
                            <button class="rolling-demo-icon-btn warn rolling-live-delete-event" type="button" data-event-id="${escapeHtml(eventId)}" title="Delete this activity log entry" aria-label="Delete this activity log entry">
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M18 6 6 18" />
                                    <path d="m6 6 12 12" />
                                </svg>
                            </button>
                        </div>
                    </div>
                    <p class="rolling-demo-event-message">${escapeHtml(message)}</p>
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
            ids.importList.innerHTML = `<div class="rolling-demo-event-empty">${escapeHtml(importableEmptyText)}</div>`;
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
            throw new Error(isCoveredMode
                ? "Delta connection is not healthy enough to import live option positions."
                : "Delta connection is not healthy enough to import live futures positions.");
        }
        const objResult = await getJson(`${endpointBase}/open-positions/importable`);
        const arrPositions = Array.isArray(objResult?.data?.positions) ? objResult.data.positions : [];
        renderImportablePositions(arrPositions);
        setStatus(
            ids.importStatus,
            arrPositions.length
                ? ""
                : (isCoveredMode
                    ? "No live option positions were returned for the selected symbol."
                    : "No live futures positions were returned for the selected symbol."),
            arrPositions.length ? "" : "warning"
        );
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
            throw new Error(isCoveredMode
                ? "Select at least one live option position to import."
                : "Select at least one live futures position to import.");
        }
        const oldestOpenedAt = selectedRows.reduce(function (oldest, row) {
            const currentOpenedAt = new Date(String(row?.openedAt || ""));
            if (!(currentOpenedAt instanceof Date) || Number.isNaN(currentOpenedAt.getTime())) {
                return oldest;
            }
            if (!oldest || Number.isNaN(oldest.getTime()) || currentOpenedAt.getTime() < oldest.getTime()) {
                return currentOpenedAt;
            }
            return oldest;
        }, null);
        const objResult = await saveImportedPositions(selectedRows);
        if (ids.closedFromDate instanceof HTMLInputElement) {
            const vClosedFromDate = formatDateTimeInputValue(oldestOpenedAt);
            if (vClosedFromDate) {
                const shouldApplyImportedClosedFromDate = !isCoveredMode
                    || window.confirm(`Change Closed Positions Start Date to ${vClosedFromDate.replace("T", " ")} based on the earliest imported live position?`);
                if (shouldApplyImportedClosedFromDate) {
                    ids.closedFromDate.value = vClosedFromDate;
                    await saveProfile();
                }
            }
        }
        await Promise.all([
            loadClosedPositions().catch(function () { return undefined; }),
            loadSavedOpenPositions().catch(function () { return undefined; }),
            loadRuntimeStatus().catch(function () { return undefined; }),
            loadEvents().catch(function () { return undefined; })
        ]);
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
                loadProfile().catch(function () { return undefined; }),
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

    function startConfirmationPolling() {
        if (!isCoveredMode || isDemoVariant) {
            return;
        }
        if (confirmationPollTimer) {
            clearInterval(confirmationPollTimer);
        }
        confirmationPollTimer = setInterval(function () {
            void loadRuntimeStatus().catch(function () { return undefined; });
        }, 5000);
    }

    applySymbolDefaults();
    applyExpiryModeDefaults(true);
    if (ids.engineStatus) {
        ids.engineStatus.textContent = "Idle";
    }
    if (ids.openRenkoSignal) {
        ids.openRenkoSignal.textContent = modeLabel;
    }
    resetRenkoFeedState(undefined, false);
    setButtonsEnabled();

    ids.symbol?.addEventListener("change", function () {
        captureRenkoBaseValueForCurrentSymbol();
        applySymbolDefaults();
        syncRenkoBaseValueForSymbol(getCurrentSelectedSymbol());
        resetRenkoFeedState("Symbol changed. Waiting for fresh Renko base price.", false);
        queueProfileSave();
        const refreshTasks = [
            loadAccountSummary().catch(function () { return undefined; }),
            loadClosedPositions().catch(function () { return undefined; })
        ];
        if (isDemoVariant && ids.indicatorCard) {
            refreshTasks.unshift(loadOptionsDemoIndicator().catch(function () { return undefined; }));
        }
        void Promise.all(refreshTasks);
    });
    ids.indicatorRefreshButton?.addEventListener("click", function () {
        void loadOptionsDemoIndicator().catch(function () { return undefined; });
    });
    ids.indicatorRefreshInput?.addEventListener("change", function () {
        scheduleIndicatorAutoRefresh();
        void loadOptionsDemoIndicator().catch(function () { return undefined; });
    });
    ids.indicatorRefreshInput?.addEventListener("input", function () {
        scheduleIndicatorAutoRefresh();
    });
    ids.resetDefaultsButton?.addEventListener("click", function () {
        void resetManualTraderDefaults().then(function () {
            setStatus(ids.pageStatus, "Manual trader defaults restored for this user.", "success");
        }).catch(function (error) {
            setStatus(ids.pageStatus, error instanceof Error ? error.message : "Unable to reset manual trader defaults.", "danger");
        });
    });
    ids.showSavedProfileButton?.addEventListener("click", function () {
        void showSavedManualTraderProfile().then(function () {
            setStatus(ids.pageStatus, "Saved Manual Trader values loaded from DB.", "success");
        }).catch(function (error) {
            setStatus(ids.pageStatus, error instanceof Error ? error.message : "Unable to load saved Manual Trader values.", "danger");
        });
    });
    ids.startQty?.addEventListener("blur", function () {
        if (isCoveredMode && ids.startQty instanceof HTMLInputElement) {
            ids.startQty.value = String(clampCoveredMultiplierValue(ids.startQty.value));
        }
        syncQtyFromStartQty();
        queueProfileSave();
    });
    ids.calculateStartQtyButton?.addEventListener("click", function () {
        void calculateRecommendedStartQty().then(function (objResult) {
            const objData = objResult?.data || {};
            const vQty = Math.max(0, Math.floor(Number(objData.recommendedQty || 0)));
            if (!(ids.startQty instanceof HTMLInputElement)) {
                return;
            }
            if (vQty < (isCoveredMode ? 2 : 1)) {
                setStatus(ids.pageStatus, String(objResult?.message || (isCoveredMode ? "Available Balance is too low for the selected multiplier estimate." : "Available Balance is too low for a safe Start Qty estimate.")), "warning");
                return;
            }
            ids.startQty.value = String(isCoveredMode ? clampCoveredMultiplierValue(vQty) : vQty);
            syncQtyFromStartQty();
            return saveProfile().then(function () {
                const vMessage = String(objResult?.message || (isCoveredMode ? `Estimated Multiplier ${vQty}.` : `Estimated Start Qty ${vQty}.`)).trim();
                setStatus(ids.pageStatus, `${vMessage} ${isCoveredMode ? "Multiplier" : "Start Qty"} has been updated.`, "success");
            });
        }).catch(function (error) {
            setStatus(ids.pageStatus, error instanceof Error ? error.message : `Unable to calculate ${isCoveredMode ? "Multiplier" : "Start Qty"}.`, "danger");
        });
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
        ids.closeNetProfitBrokerage,
        ids.brokerageMultiplier,
        ids.reEnterBrok,
        ids.closeBlockedMargin,
        ids.blockedMarginPct,
        ids.reEnterBlock,
        ids.buyHedgeSellPremiumGate,
        ids.buyHedgeSellPremiumPct,
        ids.strangleDeltaDiffReplaceEnabled,
        ids.strangleDeltaDiffReplacePct,
        ids.buyHedgeOppositeLegOnGate,
        ids.strangleReopenAtNewD,
        ids.buyQtyPercentEnabled,
        ids.buyQtyPercent,
        ids.renkoEnabled,
        ids.renkoBoxSize,
        ids.autoConfirmLiveActions
    ].forEach(function (node) {
        node?.addEventListener("change", queueProfileSave);
        node?.addEventListener("change", function () {
            syncLocalProfitClosePendingFromOpenPositions();
            restartProfitCloseCountdown();
        });
        if (node instanceof HTMLInputElement && node.type !== "checkbox") {
            node.addEventListener("input", queueProfileSave);
            node.addEventListener("input", function () {
                syncLocalProfitClosePendingFromOpenPositions();
                restartProfitCloseCountdown();
            });
        }
    });
    [ids.buyHedgeSellPremiumGate, ids.buyHedgeSellPremiumPct, ids.strangleDeltaDiffReplaceEnabled, ids.strangleDeltaDiffReplacePct].forEach(function (node) {
        node?.addEventListener("change", function () {
            renderCoveredHedgeGateSummary(displayedPositions);
        });
        if (node instanceof HTMLInputElement && node.type !== "checkbox") {
            node.addEventListener("input", function () {
                renderCoveredHedgeGateSummary(displayedPositions);
            });
        }
    });
    [ids.buyQtyPercentEnabled, ids.buyQtyPercent].forEach(function (node) {
        node?.addEventListener("change", function () {
            syncQtyFromStartQty();
            queueProfileSave();
        });
        if (node instanceof HTMLInputElement && node.type !== "checkbox") {
            node.addEventListener("input", function () {
                syncQtyFromStartQty();
                queueProfileSave();
            });
        }
    });
    [ids.renkoEnabled, ids.renkoBoxSize, ids.renkoBaseValue].forEach(function (node) {
        node?.addEventListener("change", function () {
            if (ids.renkoBoxSize instanceof HTMLInputElement) {
                ids.renkoBoxSize.value = String(clampRenkoBoxSizeValue(ids.renkoBoxSize.value));
            }
            captureRenkoBaseValueForCurrentSymbol();
            resetRenkoFeedState(getRenkoFeedEnabled()
                ? "Renko feed updated. Waiting for fresh box color."
                : "Renko feed is OFF.");
            updateRenkoFeedDisplay(lastAccountSummary);
            queueProfileSave();
        });
        if (node instanceof HTMLInputElement && node.type !== "checkbox") {
            if (node === ids.renkoBoxSize) {
                node.addEventListener("input", function () {
                    ids.renkoBoxSize.value = String(clampRenkoBoxSizeValue(ids.renkoBoxSize.value));
                    resetRenkoFeedState("Renko box size changed. Waiting for fresh box color.");
                    updateRenkoFeedDisplay(lastAccountSummary);
                    queueProfileSave();
                });
            }
            else if (node === ids.renkoBaseValue) {
                node.addEventListener("blur", function () {
                    captureRenkoBaseValueForCurrentSymbol();
                    resetRenkoFeedState("Renko base value changed. Waiting for fresh box color.");
                    updateRenkoFeedDisplay(lastAccountSummary);
                    queueProfileSave();
                });
            }
        }
    });
    getSupportedOptionRowIndexes().forEach(function (rowIndex) {
        const nodes = getOptionRowNodes(rowIndex);
        [
            nodes.legs,
            nodes.qty,
            nodes.newD,
            nodes.reD,
            nodes.tpD,
            nodes.slD,
            nodes.reEnter
        ].forEach(function (node) {
            node?.addEventListener("change", queueProfileSave);
            if (node instanceof HTMLInputElement && node.type !== "checkbox") {
                node.addEventListener("input", queueProfileSave);
            }
        });
        nodes.action?.addEventListener("change", function () {
            syncQtyFromStartQty();
            renderCoveredHedgeGateSummary(displayedPositions);
            queueProfileSave();
        });
        nodes.qty?.addEventListener("change", function () {
            if (!isCoveredMode) {
                return;
            }
            syncQtyFromStartQty();
            renderCoveredHedgeGateSummary(displayedPositions);
            queueProfileSave();
        });
        if (nodes.qty instanceof HTMLInputElement) {
            nodes.qty.addEventListener("input", function () {
                if (!isCoveredMode) {
                    return;
                }
                syncQtyFromStartQty();
                renderCoveredHedgeGateSummary(displayedPositions);
                queueProfileSave();
            });
        }
        nodes.expiryMode?.addEventListener("change", function () {
            applyExpiryModeDefaults(true, rowIndex);
            queueProfileSave();
        });
        nodes.expiryDate?.addEventListener("change", queueProfileSave);
    });
    ids.telegramEventCheckboxes.forEach(function (checkbox) {
        checkbox.addEventListener("change", queueProfileSave);
    });
    ids.closedFromDate?.addEventListener("change", function () {
        void saveProfile().then(function () {
            return Promise.all([
                loadClosedPositions().catch(function () { return undefined; }),
                loadSavedOpenPositions().catch(function () { return undefined; }),
                loadRuntimeStatus().catch(function () { return undefined; }),
                loadEvents().catch(function () { return undefined; })
            ]);
        }).catch(function (error) {
            setStatus(ids.pageStatus, error instanceof Error ? error.message : "Unable to update Closed Positions start date.", "danger");
        });
    });
    ids.closedToDate?.addEventListener("change", function () {
        void saveProfile().then(function () {
            return loadClosedPositions();
        }).catch(function (error) {
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
    ids.recalculateTotalPnlButton?.addEventListener("click", function () {
        void recalculateTotalPnlFromHistory().then(function (objResult) {
            setStatus(ids.pageStatus, String(objResult?.message || "Total PnL recalculated from Delta history."), "success");
            return Promise.all([
                loadRuntimeStatus().catch(function () { return undefined; }),
                loadEvents().catch(function () { return undefined; }),
                loadClosedPositions().catch(function () { return undefined; })
            ]);
        }).catch(function (error) {
            setStatus(ids.pageStatus, error instanceof Error ? error.message : "Unable to recalculate Total PnL from Delta history.", "danger");
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
        if (ids.checkConnectionButton instanceof HTMLButtonElement) {
            ids.checkConnectionButton.disabled = true;
        }
        setStatus(ids.pageStatus, "Refreshing Exchange Connection...", "info");
        void refreshExchangeConnectionSection().then(function () {
            setStatus(ids.pageStatus, "Delta connection checked.", "success");
        }).catch(function (error) {
            setStatus(ids.pageStatus, error instanceof Error ? error.message : "Unable to check Delta connection.", "danger");
        }).finally(function () {
            if (ids.checkConnectionButton instanceof HTMLButtonElement) {
                ids.checkConnectionButton.disabled = false;
            }
        });
    });
    if (ids.confirmationSound instanceof HTMLInputElement) {
        ids.confirmationSound.checked = confirmationSoundEnabled;
        const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
        if (typeof AudioContextConstructor !== "function") {
            ids.confirmationSound.checked = false;
            ids.confirmationSound.disabled = true;
            ids.confirmationSound.title = "Confirmation sounds are not supported by this browser.";
        }
        ids.confirmationSound.addEventListener("change", function () {
            confirmationSoundEnabled = ids.confirmationSound instanceof HTMLInputElement
                ? ids.confirmationSound.checked
                : true;
            saveConfirmationSoundPreference();
            if (!confirmationSoundEnabled) {
                queuedConfirmationSoundActionId = "";
                return;
            }
            const vPendingActionId = String(pendingLiveConfirmation?.actionId || "").trim();
            if (vPendingActionId && vPendingActionId !== lastConfirmationSoundActionId) {
                queuedConfirmationSoundActionId = vPendingActionId;
            }
            void unlockConfirmationAudio();
        });
    }
    document.addEventListener("pointerdown", function () {
        void unlockConfirmationAudio();
    }, { once: true, capture: true });
    document.addEventListener("keydown", function () {
        void unlockConfirmationAudio();
    }, { once: true, capture: true });
    ids.confirmActionButton?.addEventListener("click", function () {
        void confirmPendingLiveAction().then(function (objResult) {
            return Promise.all([
                loadRuntimeStatus(),
                loadAccountSummary().catch(function () { return undefined; }),
                loadSavedOpenPositions().catch(function () { return undefined; }),
                loadEvents().catch(function () { return undefined; }),
                loadProfile()
                    .then(function () { return loadClosedPositions(); })
                    .catch(function () { return undefined; })
            ]).then(function () {
                setStatus(ids.pageStatus, String(objResult?.message || "Live action confirmed."), "success");
            });
        }).catch(function (error) {
            setStatus(ids.pageStatus, error instanceof Error ? error.message : "Unable to confirm the live action.", "danger");
        });
    });
    ids.rejectActionButton?.addEventListener("click", function () {
        void rejectPendingLiveAction().then(function (objResult) {
            return Promise.all([
                loadRuntimeStatus(),
                loadEvents().catch(function () { return undefined; })
            ]).then(function () {
                setStatus(ids.pageStatus, String(objResult?.message || "Live action rejected."), "warning");
            });
        }).catch(function (error) {
            setStatus(ids.pageStatus, error instanceof Error ? error.message : "Unable to reject the live action.", "danger");
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
        void placeManualOption("sell", "pe", 1).then(function (objResult) {
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
        void placeManualOption("sell", "ce", 1).then(function (objResult) {
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
        void placeManualOption("buy", "ce", 1).then(function (objResult) {
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
        void placeManualOption("buy", "pe", 1).then(function (objResult) {
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
        if (isDemoVariant) {
            setStatus(ids.pageStatus, "Exec Strategy is disabled on Options Demo for now.", "warning");
            return;
        }
        void (isCoveredMode ? executeCoveredStrategies() : executeStrategy(1)).then(function (objResult) {
            const trackedPayload = objResult?.data?.trackedOpenPositions || null;
            const objNeutralCheck = objResult?.data?.neutralCheck || {};
            const bHedgePlaced = Boolean(objNeutralCheck?.hedgePlaced);
            if (trackedPayload) {
                renderOpenPositions(trackedPayload);
            }
            const vMessage = String(objResult?.message || "Exec Strategy placed live option order(s).").trim();
            setStatus(ids.pageStatus, bHedgePlaced ? `${vMessage} Server-side neutrality hedge also executed.` : vMessage, "success");
            return Promise.all([
                loadProfile()
                    .then(function () { return loadClosedPositions(); })
                    .catch(function () { return undefined; }),
                loadAccountSummary(),
                loadConnectionStatus(),
                loadEvents().catch(function () { return undefined; })
            ]);
        }).catch(function (error) {
            setStatus(ids.pageStatus, error instanceof Error ? error.message : "Unable to execute the live strategy.", "danger");
        });
    });
    ids.sellPeButton2?.addEventListener("click", function () {
        void placeManualOption("sell", "pe", 2).then(function (objResult) {
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
    ids.sellCeButton2?.addEventListener("click", function () {
        void placeManualOption("sell", "ce", 2).then(function (objResult) {
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
    ids.buyCeButton2?.addEventListener("click", function () {
        void placeManualOption("buy", "ce", 2).then(function (objResult) {
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
    ids.buyPeButton2?.addEventListener("click", function () {
        void placeManualOption("buy", "pe", 2).then(function (objResult) {
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
        const confirmed = window.confirm(isCoveredMode
            ? "Kill switch will place reduce-only market close orders for all saved live option positions. Continue?"
            : "Kill switch will place reduce-only market close orders for all saved live futures positions. Continue?");
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
        void loadClosedPositions().then(function (rows) {
            if (!(ids.updateRecoveryTotalsCheckbox instanceof HTMLInputElement) || !ids.updateRecoveryTotalsCheckbox.checked) {
                setStatus(ids.pageStatus, "Closed-position history refreshed.", "success");
                return null;
            }
            if (isCoveredMode) {
                return recalculateTotalPnlFromHistory();
            }
            const objTotals = calculateClosedPositionRecoveryTotals(rows);
            return updateRecoveryMetrics(objTotals.totalBrokerageToRecover, objTotals.totalPnl);
        }).then(function (objResult) {
            if (!objResult) {
                return;
            }
            if (ids.updateRecoveryTotalsCheckbox instanceof HTMLInputElement) {
                ids.updateRecoveryTotalsCheckbox.checked = false;
            }
            setStatus(ids.pageStatus, "Closed-position history refreshed and live recovery totals updated.", "success");
        }).catch(function (error) {
            setStatus(ids.pageStatus, error instanceof Error ? error.message : "Unable to load closed positions.", "danger");
        });
    });
    ids.clearClosedPositionsButton?.addEventListener("click", function () {
        const confirmed = window.confirm("Clear all Closed Positions for this demo page?");
        if (!confirmed) {
            return;
        }
        void clearSavedClosedPositions().then(function (objResult) {
            renderClosedPositions([]);
            if (ids.updateRecoveryTotalsCheckbox instanceof HTMLInputElement) {
                ids.updateRecoveryTotalsCheckbox.checked = false;
            }
            setStatus(ids.pageStatus, objResult?.message || "Closed positions cleared.", "success");
            return Promise.all([
                loadAccountSummary().catch(function () { return undefined; }),
                loadProfile().catch(function () { return undefined; })
            ]);
        }).catch(function (error) {
            setStatus(ids.pageStatus, error instanceof Error ? error.message : "Unable to clear closed positions.", "danger");
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
    ids.openPrevPageButton?.addEventListener("click", function () {
        if (openPositionsPage <= 1) {
            return;
        }
        openPositionsPage -= 1;
        renderOpenPositions(displayedPositions);
    });
    ids.openNextPageButton?.addEventListener("click", function () {
        const totalPages = Math.max(1, Math.ceil(displayedPositions.length / openPositionsPageSize));
        if (openPositionsPage >= totalPages) {
            return;
        }
        openPositionsPage += 1;
        renderOpenPositions(displayedPositions);
    });
    ids.openPageNumbers?.addEventListener("click", function (event) {
        const target = event.target instanceof Element ? event.target.closest(".rolling-live-open-page-btn") : null;
        if (!(target instanceof HTMLButtonElement)) {
            return;
        }
        const page = Number(target.dataset.page || 0);
        if (!Number.isFinite(page) || page <= 0) {
            return;
        }
        openPositionsPage = page;
        renderOpenPositions(displayedPositions);
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
    ids.renkoRefreshButton?.addEventListener("click", function () {
        void loadAccountSummary().then(function () {
            setStatus(ids.pageStatus, "Renko feed refreshed.", "success");
        }).catch(function (error) {
            setStatus(ids.pageStatus, error instanceof Error ? error.message : "Unable to refresh Renko feed.", "danger");
        });
    });
    ids.renkoClearButton?.addEventListener("click", function () {
        const currentSymbol = getCurrentSelectedSymbol();
        const confirmed = window.confirm(`Clear the Renko feed for ${currentSymbol}?`);
        if (!confirmed) {
            return;
        }
        clearRenkoFeedForSymbol(currentSymbol);
        void saveProfile().then(function () {
            setStatus(ids.pageStatus, `Renko feed cleared for ${currentSymbol}.`, "success");
        }).catch(function (error) {
            setStatus(ids.pageStatus, error instanceof Error ? error.message : "Unable to clear Renko feed.", "danger");
        });
    });
    ids.renkoHistoryLog?.addEventListener("click", function (event) {
        const target = event.target instanceof Element ? event.target : null;
        const deleteButton = target ? target.closest(".rolling-renko-delete-entry") : null;
        if (!(deleteButton instanceof HTMLButtonElement)) {
            return;
        }
        const entryIndex = Number(deleteButton.dataset.entryIndex || -1);
        const currentSymbol = getCurrentSelectedSymbol();
        const history = Array.isArray(renkoHistoryBySymbol[currentSymbol]) ? renkoHistoryBySymbol[currentSymbol].slice() : [];
        if (!Number.isInteger(entryIndex) || entryIndex < 0 || entryIndex >= history.length) {
            setStatus(ids.pageStatus, "Unable to find the selected Renko feed entry.", "danger");
            return;
        }
        history.splice(entryIndex, 1);
        renkoHistoryBySymbol[currentSymbol] = history;
        renderRenkoHistory();
        void saveProfile().then(function () {
            setStatus(ids.pageStatus, `Renko feed entry deleted for ${currentSymbol}.`, "success");
        }).catch(function (error) {
            setStatus(ids.pageStatus, error instanceof Error ? error.message : "Unable to delete Renko feed entry.", "danger");
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
            setStatus(
                ids.pageStatus,
                objResult?.message || (isCoveredMode ? "Imported live option positions saved." : "Imported live futures positions saved."),
                "success"
            );
            return Promise.all([loadAccountSummary(), loadEvents()]);
        }).catch(function (error) {
            setStatus(
                ids.importStatus,
                error instanceof Error ? error.message : (isCoveredMode ? "Unable to import live option positions." : "Unable to import live futures positions."),
                "danger"
            );
        });
    });
    ids.clearOpenPositionsButton?.addEventListener("click", function () {
        const confirmed = window.confirm("Clear all imported open positions from the Open Positions section only? No Delta Exchange close order will be placed.");
        if (!confirmed) {
            return;
        }
        void clearSavedOpenPositions().then(function (objResult) {
            setStatus(
                ids.pageStatus,
                objResult?.message || "All imported open positions were cleared locally.",
                "warning"
            );
            return Promise.all([
                loadSavedOpenPositions(),
                loadAccountSummary().catch(function () { return undefined; }),
                loadEvents().catch(function () { return undefined; })
            ]);
        }).catch(function (error) {
            setStatus(ids.pageStatus, error instanceof Error ? error.message : "Unable to clear imported open positions.", "danger");
        });
    });
    ids.openPositionsBody?.addEventListener("click", function (event) {
        const target = event.target instanceof Element ? event.target : null;
        const swapButton = target ? target.closest(".rolling-live-swap-open-position") : null;
        if (swapButton instanceof HTMLButtonElement) {
            const importId = String(swapButton.dataset.importId || "").trim();
            const row = displayedPositions.find(function (item) {
                return String(item?.importId || "").trim() === importId;
            });
            if (!row) {
                setStatus(ids.pageStatus, "Unable to find the selected imported live position.", "danger");
                return;
            }
            const confirmed = window.confirm(`Replace ${row.contractName || "this position"} on Delta Exchange now? This will close it and reopen the same leg using the current Manual Trader settings.`);
            if (!confirmed) {
                return;
            }
            void swapImportedOpenPosition(row).then(function (objResult) {
                const vTone = String(objResult?.status || "").trim() === "warning" ? "warning" : "success";
                const objData = objResult?.data || {};
                const objCloseOrder = objData.closeOrder || {};
                const objOpenOrder = objData.openOrder || {};
                const vCloseOrderId = String(objCloseOrder.id || objCloseOrder.order_id || "").trim();
                const vOpenOrderId = String(objOpenOrder.id || objOpenOrder.order_id || "").trim();
                const arrOrderBits = [];
                if (vCloseOrderId) {
                    arrOrderBits.push(`Close Order ID: ${vCloseOrderId}`);
                }
                if (vOpenOrderId) {
                    arrOrderBits.push(`Open Order ID: ${vOpenOrderId}`);
                }
                const vMessage = objResult?.message || "Live position swapped on Delta Exchange.";
                const trackedPayload = objData.trackedOpenPositions || null;
                setStatus(ids.pageStatus, arrOrderBits.length ? `${vMessage} ${arrOrderBits.join(" | ")}` : vMessage, vTone);
                if (trackedPayload) {
                    renderOpenPositions(trackedPayload);
                }
                return Promise.all([
                    loadAccountSummary(),
                    loadConnectionStatus(),
                    refreshImportablePositionsSilently().catch(function () { return undefined; }),
                    loadEvents().catch(function () { return undefined; })
                ]);
            }).catch(function (error) {
                setStatus(ids.pageStatus, error instanceof Error ? error.message : "Unable to replace imported live position.", "danger");
            });
            return;
        }
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

    async function loadPageForCurrentTarget() {
        displayedPositions = [];
        importablePositions = [];
        closedPositions = [];
        closedPositionsPage = 1;
        selectedApiProfileId = "";
        renderEvents([]);
        renderOpenPositions([]);
        renderClosedPositions([]);
        clearAccountSummary();
        applyConnectionStatus({
            state: "not_selected",
            message: requiresExplicitTargetSelection && !getEffectiveTargetUserId()
                ? `Select a running ${strategyLabel} user to load settings.`
                : ""
        });
        applyRuntimeStatus({
            status: "idle",
            autoTraderEnabled: false,
            state: {}
        });
        applyUiState({});
        if (requiresExplicitTargetSelection && !getEffectiveTargetUserId()) {
            if (ids.apiProfile instanceof HTMLSelectElement) {
                ids.apiProfile.innerHTML = "<option value=\"\">Select API profile</option>";
                ids.apiProfile.value = "";
            }
            setButtonsEnabled();
            return;
        }
        await loadApiProfiles();
        await loadProfile();
        if (isDemoVariant && ids.indicatorCard) {
            await loadOptionsDemoIndicator().catch(function () { return undefined; });
            scheduleIndicatorAutoRefresh();
        }
        await Promise.all([
            loadRuntimeStatus().catch(function () { return undefined; }),
            loadSavedOpenPositions().catch(function () { return []; }),
            loadEvents().catch(function () { return []; })
        ]);
        if (!selectedApiProfileId) {
            return;
        }
        await checkConnection();
        await Promise.all([
            loadAccountSummary().catch(function () { return undefined; }),
            loadClosedPositions().catch(function () { return undefined; })
        ]);
    }

    ids.adminTargetUser?.addEventListener("change", function () {
        const vNextTargetUserId = String(ids.adminTargetUser instanceof HTMLSelectElement ? ids.adminTargetUser.value : "").trim();
        if (vNextTargetUserId === targetUserId) {
            return;
        }
        targetUserId = vNextTargetUserId;
        if (saveTimer) {
            clearTimeout(saveTimer);
            saveTimer = null;
        }
        const objSelectedUser = adminRunningUsers.find(function (user) {
            return String(user.accountId || "").trim() === targetUserId;
        });
        if (objSelectedUser) {
            currentTargetAccount = {
                accountId: String(objSelectedUser.accountId || "").trim(),
                fullName: String(objSelectedUser.fullName || "").trim(),
                email: String(objSelectedUser.email || "").trim(),
                telegramChatId: String(objSelectedUser.telegramChatId || "").trim(),
                execStrategy: Boolean(objSelectedUser.execStrategy)
            };
        }
        else if (requiresExplicitTargetSelection) {
            currentTargetAccount = {
                accountId: "",
                fullName: "",
                email: "",
                telegramChatId: "",
                execStrategy: false
            };
        }
        updateAdminTargetMeta();
        updateTelegramNotice();
        void loadPageForCurrentTarget().then(function () {
            setStatus(
                ids.pageStatus,
                currentTargetAccount.fullName
                    ? `Loaded ${isCoveredMode ? strategyLabel : "Dual"} view for ${currentTargetAccount.fullName}.`
                    : (isCoveredMode ? "Waiting for user selection." : "Loaded strategy view."),
                currentTargetAccount.fullName ? "success" : "info"
            );
        }).catch(function (error) {
            setStatus(ids.pageStatus, error instanceof Error ? error.message : `Unable to load the selected ${isCoveredMode ? strategyLabel : "Dual"} user.`, "danger");
        });
    });

    void Promise.resolve().then(function () {
        if (!isAdminTargetModeActive()) {
            return undefined;
        }
        return loadAdminRunningUsers();
    }).then(function () {
        return loadPageForCurrentTarget();
    }).catch(function (error) {
        setStatus(
            ids.pageStatus,
            error instanceof Error ? error.message : (isCoveredMode ? "Unable to load covered options page." : "Unable to load live futures page."),
            "danger"
        );
    });

    startConnectionPolling();
    startConfirmationPolling();
})();
