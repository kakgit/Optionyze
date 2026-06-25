const gSurvivalState = {
    runningUsers: [],
    pageSize: 5,
    page: 1,
    currentServerId: "",
    switchingPrimaryAccountId: ""
};

const sEls = {};

document.addEventListener("DOMContentLoaded", () => {
    sEls.app = document.getElementById("survivalAdminApp");
    sEls.refreshRunningUsersButton = document.getElementById("btnRefreshRunningUsers");
    sEls.runningUsersCount = document.getElementById("runningUsersCount");
    sEls.runningUsersTableBody = document.getElementById("runningUsersTableBody");
    sEls.runningUsersPager = document.getElementById("runningUsersPager");
    sEls.pageStatus = document.getElementById("pageStatus");

    gSurvivalState.currentServerId = String(sEls.app?.dataset.currentServerId || "").trim();
    sEls.refreshRunningUsersButton?.addEventListener("click", () => {
        void refreshRunningUsers();
    });
    sEls.runningUsersTableBody?.addEventListener("click", handleRunningUsersAction);

    void refreshRunningUsers();
});

async function refreshRunningUsers() {
    setButtonBusy(sEls.refreshRunningUsersButton, true);
    setPageStatus("Loading running users...", "info");
    try {
        const objResult = await requestJson("/api/survival-admin/running-users", {
            credentials: "same-origin"
        }, "Unable to load running users.");
        gSurvivalState.runningUsers = Array.isArray(objResult.data) ? objResult.data : [];
        gSurvivalState.page = 1;
        renderRunningUsers();
        setPageStatus(`Loaded ${gSurvivalState.runningUsers.length} running dual user${gSurvivalState.runningUsers.length === 1 ? "" : "s"}.`, "success");
    }
    catch (objError) {
        setPageStatus(getErrorMessage(objError, "Unable to load running users."), "error");
    }
    finally {
        restoreIconButton(sEls.refreshRunningUsersButton);
    }
}

function renderRunningUsers() {
    if (sEls.runningUsersCount) {
        sEls.runningUsersCount.textContent = `${gSurvivalState.runningUsers.length} running`;
    }

    if (!(sEls.runningUsersTableBody instanceof HTMLElement)) {
        return;
    }

    if (!gSurvivalState.runningUsers.length) {
        sEls.runningUsersTableBody.innerHTML = `<tr><td colspan="6" class="mngusers-empty">No running strategy users right now.</td></tr>`;
        renderPager(sEls.runningUsersPager, 1, 0, 0, () => undefined);
        return;
    }

    const objPaged = paginateRows(gSurvivalState.runningUsers, gSurvivalState.page, gSurvivalState.pageSize);
    gSurvivalState.page = objPaged.page;

    sEls.runningUsersTableBody.innerHTML = objPaged.rows.map((objUser) => {
        const bSwitching = gSurvivalState.switchingPrimaryAccountId === objUser.accountId;
        const vPrimaryOwner = objUser.ownerServerId || "-";
        const vSurvivalOwner = objUser.survivalOwnerServerId || "-";
        const bOwnedHere = vPrimaryOwner === gSurvivalState.currentServerId || vSurvivalOwner === gSurvivalState.currentServerId;
        const vHandbackTarget = objUser.handbackTargetServerId || "render";
        const bHandbackPending = Boolean(objUser.handbackPending);
        const bCanHandbackHere = bHandbackPending && gSurvivalState.currentServerId === vHandbackTarget;
        const vModeChip = objUser.survivalMode
            ? `<span class="mngusers-chip mngusers-chip-warn">Survival Live</span>`
            : `<span class="mngusers-chip mngusers-chip-live">Primary Live</span>`;
        const vOwnerStateChip = objUser.survivalMode
            ? `<span class="mngusers-chip mngusers-chip-warn">Owner: ${escapeHtml(vSurvivalOwner !== "-" ? vSurvivalOwner : vPrimaryOwner)}</span>`
            : `<span class="mngusers-chip mngusers-chip-info">Owner: ${escapeHtml(vPrimaryOwner)}</span>`;

        let vActionHtml = "";
        if (bCanHandbackHere) {
            vActionHtml = `
                <button class="app-link-btn" type="button" data-running-action="switch-primary" data-account-id="${escapeHtml(objUser.accountId)}" ${bSwitching ? "disabled" : ""}>
                    ${bSwitching ? "Handing Back..." : `Handback To ${escapeHtml(vHandbackTarget)}`}
                </button>
            `;
        }
        else if (!bOwnedHere) {
            vActionHtml = `
                <button class="app-link-btn" type="button" data-running-action="force-takeover-here" data-account-id="${escapeHtml(objUser.accountId)}">
                    Force Takeover Here
                </button>
            `;
        }
        else if (objUser.survivalMode && !bHandbackPending) {
            vActionHtml = `
                <button class="app-link-btn" type="button" data-running-action="switch-primary" data-account-id="${escapeHtml(objUser.accountId)}" ${bSwitching ? "disabled" : ""}>
                    ${bSwitching ? "Switching..." : "Switch To Primary DB"}
                </button>
            `;
        }
        else if (bHandbackPending) {
            vActionHtml = `<span class="mngusers-chip mngusers-chip-muted">Handback Pending: ${escapeHtml(vHandbackTarget)}</span>`;
        }
        else if (bOwnedHere) {
            vActionHtml = `<span class="mngusers-chip mngusers-chip-muted">Normal</span>`;
        }

        return `
            <tr>
                <td class="mngusers-nowrap">${escapeHtml(objUser.fullName || "-")}</td>
                <td class="mngusers-nowrap">${escapeHtml(objUser.email || "-")}</td>
                <td><div class="mngusers-status-stack"><div>${vModeChip}</div><div>${vOwnerStateChip}</div></div></td>
                <td>
                    <div class="mngusers-owner-stack">
                        <div><strong>Primary:</strong> ${escapeHtml(vPrimaryOwner)}</div>
                        <div><strong>Survival:</strong> ${escapeHtml(vSurvivalOwner)}</div>
                    </div>
                </td>
                <td class="mngusers-nowrap">${escapeHtml(formatDateTime(objUser.lastCycleAt || objUser.updatedAt))}</td>
                <td class="mngusers-nowrap">${vActionHtml}</td>
            </tr>
        `;
    }).join("");

    renderPager(sEls.runningUsersPager, objPaged.page, gSurvivalState.runningUsers.length, objPaged.totalPages, (pPage) => {
        gSurvivalState.page = pPage;
        renderRunningUsers();
    });
}

function handleRunningUsersAction(objEvent) {
    const objButton = objEvent.target instanceof Element ? objEvent.target.closest("button[data-running-action]") : null;
    if (!(objButton instanceof HTMLButtonElement)) {
        return;
    }
    const vAction = String(objButton.dataset.runningAction || "").trim();
    const vAccountId = String(objButton.dataset.accountId || "").trim();
    if (vAction === "force-takeover-here" && vAccountId) {
        void forceTakeoverHere(vAccountId);
        return;
    }
    if (vAction === "switch-primary" && vAccountId) {
        void switchRunningUserToPrimary(vAccountId);
    }
}

async function switchRunningUserToPrimary(pAccountId) {
    if (!pAccountId || gSurvivalState.switchingPrimaryAccountId) {
        return;
    }

    const objUser = gSurvivalState.runningUsers.find((objRow) => objRow.accountId === pAccountId);
    const vConfirmed = window.confirm(`Switch ${objUser?.fullName || "this running user"} back to Primary DB control now?`);
    if (!vConfirmed) {
        return;
    }

    gSurvivalState.switchingPrimaryAccountId = pAccountId;
    renderRunningUsers();

    try {
        const objResult = await requestJson(`/api/survival-admin/running-users/${encodeURIComponent(pAccountId)}/switch-primary`, {
            method: "POST",
            credentials: "same-origin"
        }, "Unable to switch this running strategy back to Primary DB.");
        setPageStatus(objResult.message || "Strategy switched back to Primary DB successfully.", "success");
        await refreshRunningUsers();
    }
    catch (objError) {
        setPageStatus(getErrorMessage(objError, "Unable to switch this running strategy back to Primary DB."), "error");
    }
    finally {
        gSurvivalState.switchingPrimaryAccountId = "";
        renderRunningUsers();
    }
}

async function forceTakeoverHere(pAccountId) {
    const objUser = gSurvivalState.runningUsers.find((objRow) => objRow.accountId === pAccountId);
    const vTargetServer = gSurvivalState.currentServerId || "this server";
    const vConfirmed = window.confirm(`Force takeover of ${objUser?.fullName || "this running user"} to ${vTargetServer}?`);
    if (!vConfirmed) {
        return;
    }

    try {
        const objResult = await requestJson(`/api/survival-admin/running-users/${encodeURIComponent(pAccountId)}/force-takeover-here`, {
            method: "POST",
            credentials: "same-origin"
        }, "Unable to force takeover to this server.");
        setPageStatus(objResult.message || `Strategy assigned to ${vTargetServer}.`, "success");
        await refreshRunningUsers();
    }
    catch (objError) {
        setPageStatus(getErrorMessage(objError, "Unable to force takeover to this server."), "error");
    }
}

function paginateRows(pRows, pPage, pPageSize) {
    const vTotalItems = Array.isArray(pRows) ? pRows.length : 0;
    const vTotalPages = Math.max(1, Math.ceil(vTotalItems / pPageSize));
    const vPage = Math.min(Math.max(1, Number(pPage) || 1), vTotalPages);
    const vStart = (vPage - 1) * pPageSize;
    return {
        rows: pRows.slice(vStart, vStart + pPageSize),
        page: vPage,
        totalPages: vTotalItems ? vTotalPages : 0
    };
}

function renderPager(pNode, pPage, pTotalItems, pTotalPages, pOnPageChange) {
    if (!(pNode instanceof HTMLElement)) {
        return;
    }

    const vTotalItems = Math.max(0, Number(pTotalItems) || 0);
    const vTotalPages = Math.max(0, Number(pTotalPages) || 0);
    const vPage = Math.max(1, Number(pPage) || 1);

    if (!vTotalItems || vTotalPages <= 1) {
        pNode.innerHTML = vTotalItems ? `<div class="mngusers-pager-info">Showing ${vTotalItems} row${vTotalItems === 1 ? "" : "s"}</div>` : "";
        return;
    }

    pNode.innerHTML = `
        <div class="mngusers-pager-info">Showing ${vTotalItems} row${vTotalItems === 1 ? "" : "s"}</div>
        <div class="mngusers-pager-controls">
            <button class="mngusers-pager-btn" type="button" data-page-nav="prev" ${vPage <= 1 ? "disabled" : ""}>&lt;</button>
            <div class="mngusers-pager-page">Page ${vPage} / ${vTotalPages}</div>
            <button class="mngusers-pager-btn" type="button" data-page-nav="next" ${vPage >= vTotalPages ? "disabled" : ""}>&gt;</button>
        </div>
    `;

    pNode.querySelector("button[data-page-nav='prev']")?.addEventListener("click", () => pOnPageChange(Math.max(1, vPage - 1)));
    pNode.querySelector("button[data-page-nav='next']")?.addEventListener("click", () => pOnPageChange(Math.min(vTotalPages, vPage + 1)));
}

async function requestJson(pUrl, pOptions, pFallbackMessage) {
    const objResponse = await fetch(pUrl, pOptions);
    const objResult = await objResponse.json().catch(() => ({
        status: "error",
        message: pFallbackMessage
    }));

    if (!objResponse.ok || objResult.status !== "success") {
        throw new Error(String(objResult.message || pFallbackMessage));
    }

    return objResult;
}

function setPageStatus(pMessage, pTone) {
    if (!(sEls.pageStatus instanceof HTMLElement)) {
        return;
    }

    const vMessage = String(pMessage || "").trim();
    sEls.pageStatus.textContent = vMessage;
    sEls.pageStatus.className = "mngusers-page-status";
    if (!vMessage) {
        return;
    }
    sEls.pageStatus.classList.add("show");
    if (pTone) {
        sEls.pageStatus.classList.add(pTone);
    }
}

function setButtonBusy(pButton, pBusy) {
    if (!(pButton instanceof HTMLButtonElement)) {
        return;
    }
    if (!pButton.dataset.defaultLabel) {
        pButton.dataset.defaultLabel = pButton.innerHTML || "";
    }
    pButton.disabled = pBusy;
}

function restoreIconButton(pButton) {
    if (!(pButton instanceof HTMLButtonElement)) {
        return;
    }
    pButton.disabled = false;
    if (pButton.dataset.defaultLabel) {
        pButton.innerHTML = pButton.dataset.defaultLabel;
    }
}

function formatDateTime(pValue) {
    const objDate = new Date(pValue);
    return Number.isNaN(objDate.getTime()) ? "-" : objDate.toLocaleString("en-IN");
}

function escapeHtml(pValue) {
    return String(pValue || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function getErrorMessage(pError, pFallback) {
    return pError instanceof Error && pError.message ? pError.message : pFallback;
}
