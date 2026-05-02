(function () {
    const ids = {
        apiProfile: document.getElementById("ddlRollingLiveApiProfile"),
        checkConnectionButton: document.getElementById("btnRollingLiveCheckConnection"),
        connectionStatus: document.getElementById("rollingLiveConnectionStatus"),
        connectionStateValue: document.getElementById("rollingLiveConnectionStateValue"),
        lastCheckedValue: document.getElementById("rollingLiveLastCheckedValue"),
        whitelistIpValue: document.getElementById("rollingLiveWhitelistIpValue"),
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
        importButton: document.getElementById("btnRollingLiveImportPositions"),
        refreshOpenPositionsButton: document.getElementById("btnRollingLiveRefreshOpenPositions"),
        killSwitchButton: document.getElementById("btnRollingLiveKillSwitch"),
        openPositionsBody: document.getElementById("rollingLiveOpenPositionsBody"),
        closedFromDate: document.getElementById("txtRollingLiveClosedFromDate"),
        closedToDate: document.getElementById("txtRollingLiveClosedToDate"),
        refreshClosedPositionsButton: document.getElementById("btnRollingLiveRefreshClosedPositions"),
        closedPositionsBody: document.getElementById("rollingLiveClosedPositionsBody"),
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

    function getSelectedConfig() {
        const vSymbol = String(ids.symbol?.value || "BTC").trim().toUpperCase();
        return symbolConfig[vSymbol] || symbolConfig.BTC;
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

    function applySymbolDefaults() {
        const objConfig = getSelectedConfig();
        if (ids.lotSize) {
            ids.lotSize.value = String(objConfig.lotSize);
        }
        if (ids.oneLotValue) {
            ids.oneLotValue.textContent = `${objConfig.lotSize} ${objConfig.contractName}`;
        }
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

        if (ids.engineStatus) {
            ids.engineStatus.textContent = gRuntimeStatus.charAt(0).toUpperCase() + gRuntimeStatus.slice(1);
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
        applyConnectionStatus(objData.connectionStatus || {});
    }

    async function saveLiveProfile() {
        const vProfileId = String(ids.apiProfile?.value || "").trim();
        gSelectedApiProfileId = vProfileId;
        await postJson("/api/rollingoptions-lt-de/profile", {
            selectedApiProfileId: vProfileId
        });
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

    function startConnectionPolling() {
        if (gConnectionPollTimer) {
            clearInterval(gConnectionPollTimer);
        }

        gConnectionPollTimer = setInterval(function () {
            if (!gSelectedApiProfileId) {
                return;
            }
            void loadConnectionStatus().catch(function (objError) {
                setStatus(ids.connectionStatus, objError instanceof Error ? objError.message : "Unable to load Delta connection status.", "danger");
            });
        }, 30000);
    }

    async function loadAccountSummary() {
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
            }
            if (ids.profileLabel) {
                ids.profileLabel.textContent = "-";
            }
            return;
        }

        const objResult = await getJson("/api/rollingoptions-lt-de/account-summary");
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
        if (ids.healthValue) {
            ids.healthValue.textContent = Number.isFinite(Number(objData.healthPct))
                ? `${fmt(objData.healthPct, 2)}%`
                : "-";
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
            ids.openPositionsBody.innerHTML = "<tr><td colspan=\"8\" class=\"rolling-demo-empty\">No imported live positions are currently shown.</td></tr>";
            if (ids.openCount) {
                ids.openCount.textContent = "0";
            }
            return;
        }

        ids.openPositionsBody.innerHTML = arrRows.map(function (row) {
            return `
                <tr>
                    <td>${escapeHtml(row.contractName || "-")}</td>
                    <td>${escapeHtml(row.side || "-")}</td>
                    <td>${escapeHtml(fmt(row.qty, 0))}</td>
                    <td>${escapeHtml(fmt(row.entryPrice, 2))}</td>
                    <td>${escapeHtml(fmt(row.markPrice, 2))}</td>
                    <td>${escapeHtml(fmtUsd(row.margin))}</td>
                    <td>${escapeHtml(fmtUsd(row.pnl))}</td>
                    <td>${escapeHtml(fmt(row.liquidationPrice, 2))}</td>
                </tr>
            `;
        }).join("");

        if (ids.openCount) {
            ids.openCount.textContent = String(arrRows.length);
        }
    }

    function renderClosedPositions(rows) {
        const arrRows = Array.isArray(rows) ? rows : [];
        if (!ids.closedPositionsBody) {
            return;
        }

        if (!arrRows.length) {
            ids.closedPositionsBody.innerHTML = "<tr><td colspan=\"8\" class=\"rolling-demo-empty\">No Delta fill history found for the selected date range.</td></tr>";
            return;
        }

        ids.closedPositionsBody.innerHTML = arrRows.map(function (row) {
            return `
                <tr>
                    <td>${escapeHtml(formatDateTime(row.startAt))}</td>
                    <td>${escapeHtml(formatDateTime(row.endAt))}</td>
                    <td>${escapeHtml(row.symbol || "-")}</td>
                    <td>${escapeHtml(row.side || row.orderType || "-")}</td>
                    <td>${escapeHtml(fmt(row.qty, 0))}</td>
                    <td>${escapeHtml(row.buyPrice === null ? "-" : fmt(row.buyPrice, 2))}</td>
                    <td>${escapeHtml(row.sellPrice === null ? "-" : fmt(row.sellPrice, 2))}</td>
                    <td>${escapeHtml(row.pnl === null ? "-" : fmtUsd(row.pnl))}</td>
                </tr>
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

    async function loadClosedPositions() {
        if (!canUseLiveActions()) {
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
        const arrPositions = Array.isArray(objResult?.data?.positions) ? objResult.data.positions : [];
        renderClosedPositions(arrPositions);
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

        renderOpenPositions(arrSelected);
        setStatus(ids.pageStatus, arrSelected.length
            ? `Imported ${arrSelected.length} live position${arrSelected.length === 1 ? "" : "s"} into the open grid.`
            : "No positions were selected for import.", arrSelected.length ? "success" : "warning");
        closeImportModal();
    }

    ids.symbol?.addEventListener("change", applySymbolDefaults);
    ids.apiProfile?.addEventListener("change", function () {
        void saveLiveProfile().then(function () {
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
            const vOrderId = String(objOrder.id || objOrder.order_id || "").trim();
            const vMessage = objResult?.message || "SELL future live order placed.";
            setStatus(ids.pageStatus, vOrderId ? `${vMessage} Order ID: ${vOrderId}` : vMessage, "success");
            return Promise.all([loadAccountSummary(), loadConnectionStatus()]);
        }).catch(function (objError) {
            setStatus(ids.pageStatus, objError instanceof Error ? objError.message : "Unable to place SELL FUT order.", "danger");
        });
    });
    ids.buyFutureButton?.addEventListener("click", function () {
        void placeManualFuture("BUY").then(function (objResult) {
            const objData = objResult?.data || {};
            const objOrder = objData.order || {};
            const vOrderId = String(objOrder.id || objOrder.order_id || "").trim();
            const vMessage = objResult?.message || "BUY future live order placed.";
            setStatus(ids.pageStatus, vOrderId ? `${vMessage} Order ID: ${vOrderId}` : vMessage, "success");
            return Promise.all([loadAccountSummary(), loadConnectionStatus()]);
        }).catch(function (objError) {
            setStatus(ids.pageStatus, objError instanceof Error ? objError.message : "Unable to place BUY FUT order.", "danger");
        });
    });
    ids.openOptionButton?.addEventListener("click", function () {
        void placeManualOption("open").then(function (objResult) {
            const arrContracts = Array.isArray(objResult?.data?.contracts) ? objResult.data.contracts : [];
            const vContracts = arrContracts.map(function (objRow) {
                return String(objRow?.contractSymbol || "").trim();
            }).filter(Boolean).join(", ");
            const vMessage = objResult?.message || "Open option live order placed.";
            setStatus(ids.pageStatus, vContracts ? `${vMessage} ${vContracts}` : vMessage, "success");
            return Promise.all([loadAccountSummary(), loadConnectionStatus()]);
        }).catch(function (objError) {
            setStatus(ids.pageStatus, objError instanceof Error ? objError.message : "Unable to place OPEN OPTION order.", "danger");
        });
    });
    ids.exitOptionButton?.addEventListener("click", function () {
        void placeManualOption("exit").then(function (objResult) {
            const arrContracts = Array.isArray(objResult?.data?.contracts) ? objResult.data.contracts : [];
            const vContracts = arrContracts.map(function (objRow) {
                return String(objRow?.contractSymbol || "").trim();
            }).filter(Boolean).join(", ");
            const vMessage = objResult?.message || "Exit option live order placed.";
            setStatus(ids.pageStatus, vContracts ? `${vMessage} ${vContracts}` : vMessage, "success");
            return Promise.all([loadAccountSummary(), loadConnectionStatus()]);
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
        if (!gDisplayedPositions.length) {
            void loadImportablePositions().catch(function (objError) {
                setStatus(ids.importStatus, objError instanceof Error ? objError.message : "Unable to refresh open positions.", "danger");
            });
            return;
        }

        renderOpenPositions(gDisplayedPositions);
        setStatus(ids.pageStatus, "Open-position grid refreshed.", "success");
    });
    ids.refreshClosedPositionsButton?.addEventListener("click", function () {
        void loadClosedPositions().then(function () {
            setStatus(ids.pageStatus, "Closed-position history refreshed.", "success");
        }).catch(function (objError) {
            setStatus(ids.pageStatus, objError instanceof Error ? objError.message : "Unable to load closed positions.", "danger");
        });
    });
    ids.closedFromDate?.addEventListener("change", function () {
        void loadClosedPositions().catch(function (objError) {
            setStatus(ids.pageStatus, objError instanceof Error ? objError.message : "Unable to filter closed positions.", "danger");
        });
    });
    ids.closedToDate?.addEventListener("change", function () {
        void loadClosedPositions().catch(function (objError) {
            setStatus(ids.pageStatus, objError instanceof Error ? objError.message : "Unable to filter closed positions.", "danger");
        });
    });
    ids.importOverlay?.addEventListener("click", closeImportModal);
    ids.closeImportModalButton?.addEventListener("click", closeImportModal);
    ids.applyImportedPositionsButton?.addEventListener("click", applyImportedPositions);

    [
        ids.execStrategyButton,
        ids.killSwitchButton
    ].forEach(function (objButton) {
        objButton?.addEventListener("click", function () {
            setStatus(ids.pageStatus, "This live action will be wired next. Connection safety checks are now in place first.", "warning");
        });
    });

    applySymbolDefaults();
    setButtonsEnabled();
    if (ids.engineStatus) {
        ids.engineStatus.textContent = "Idle";
    }

    void loadApiProfiles().then(function () {
        return loadLiveProfile();
    }).then(function () {
        return loadRuntimeStatus();
    }).then(function () {
        if (!gSelectedApiProfileId) {
            return;
        }
        return checkConnection().then(function () {
            if (!canUseLiveActions()) {
                return;
            }
            return Promise.all([loadAccountSummary(), loadClosedPositions()]);
        });
    }).catch(function (objError) {
        setStatus(ids.pageStatus, objError instanceof Error ? objError.message : "Unable to load Delta API profiles.", "danger");
    });

    startConnectionPolling();
})();
