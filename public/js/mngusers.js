const gState = {
    users: [],
    filteredUsers: [],
    runningUsers: [],
    pendingExecutionRequests: [],
    editingAccountId: "",
    resettingAccountId: "",
    currentAccountId: "",
    activeModal: "",
    isLoadingUsers: false,
    isLoadingRunningUsers: false,
    isLoadingExecutionRequests: false,
    isSavingExecutionSettings: false,
    isSavingUser: false,
    isResettingPassword: false,
    executingRequestId: "",
    switchingPrimaryAccountId: "",
    simulatingPrimaryOutageAccountId: ""
};

const els = {};

document.addEventListener("DOMContentLoaded", () => {
    cacheElements();
    gState.currentAccountId = String(els.app?.dataset.currentAccountId || "");

    els.searchInput?.addEventListener("input", applyFilters);
    els.refreshButton?.addEventListener("click", () => {
        void loadAdminData({ showSuccess: true });
    });
    els.refreshRunningUsersButton?.addEventListener("click", () => {
        void refreshRunningUsers();
    });
    els.refreshExecRequestsButton?.addEventListener("click", () => {
        void refreshExecutionRequests();
    });
    els.autoExecSl?.addEventListener("change", () => {
        void saveExecutionSettings();
    });
    els.autoExecTp?.addEventListener("change", () => {
        void saveExecutionSettings();
    });
    els.addUserButton?.addEventListener("click", () => openUserModal());
    els.cancelModalButton?.addEventListener("click", closeActiveModal);
    els.closeModalButton?.addEventListener("click", closeActiveModal);
    els.userForm?.addEventListener("submit", submitUserForm);

    els.closeResetPasswordModalButton?.addEventListener("click", closeActiveModal);
    els.cancelResetPasswordModalButton?.addEventListener("click", closeActiveModal);
    els.resetPasswordForm?.addEventListener("submit", submitResetPasswordForm);

    els.overlay?.addEventListener("click", closeActiveModal);
    els.userTableBody?.addEventListener("click", handleTableAction);
    els.runningUsersTableBody?.addEventListener("click", handleRunningUsersAction);
    els.execRequestTableBody?.addEventListener("click", handleExecRequestAction);
    document.addEventListener("keydown", handleDocumentKeydown);

    void loadAdminData({ showSuccess: true });
});

function cacheElements() {
    els.app = document.getElementById("mngUsersApp");
    els.searchInput = document.getElementById("searchInput");
    els.refreshButton = document.getElementById("btnRefresh");
    els.refreshRunningUsersButton = document.getElementById("btnRefreshRunningUsers");
    els.refreshExecRequestsButton = document.getElementById("btnRefreshExecRequests");
    els.addUserButton = document.getElementById("btnAddUser");
    els.pageStatus = document.getElementById("pageStatus");
    els.resultCount = document.getElementById("resultCount");
    els.userTableBody = document.getElementById("userTableBody");
    els.execRequestCount = document.getElementById("execRequestCount");
    els.runningUsersCount = document.getElementById("runningUsersCount");
    els.runningUsersTableBody = document.getElementById("runningUsersTableBody");
    els.execRequestTableBody = document.getElementById("execRequestTableBody");
    els.autoExecSl = document.getElementById("autoExecSl");
    els.autoExecTp = document.getElementById("autoExecTp");
    els.overlay = document.getElementById("overlay");

    els.userModal = document.getElementById("userModal");
    els.userForm = document.getElementById("userForm");
    els.modalTitle = document.getElementById("modalTitle");
    els.modalHint = document.getElementById("modalHint");
    els.modalMessage = document.getElementById("modalMessage");
    els.closeModalButton = document.getElementById("btnCloseModal");
    els.cancelModalButton = document.getElementById("btnCancelModal");
    els.saveUserButton = document.getElementById("btnSaveUser");
    els.passwordFields = document.getElementById("passwordFields");
    els.fullName = document.getElementById("fullName");
    els.email = document.getElementById("email");
    els.mobileNo = document.getElementById("mobileNo");
    els.telegramChatId = document.getElementById("telegramChatId");
    els.password = document.getElementById("password");
    els.confirmPassword = document.getElementById("confirmPassword");
    els.isActive = document.getElementById("isActive");
    els.execStrategy = document.getElementById("execStrategy");
    els.isAdmin = document.getElementById("isAdmin");
    els.mustChangePassword = document.getElementById("mustChangePassword");

    els.resetPasswordModal = document.getElementById("resetPasswordModal");
    els.resetPasswordForm = document.getElementById("resetPasswordForm");
    els.resetPasswordHint = document.getElementById("resetPasswordHint");
    els.resetPasswordMessage = document.getElementById("resetPasswordMessage");
    els.closeResetPasswordModalButton = document.getElementById("btnCloseResetPasswordModal");
    els.cancelResetPasswordModalButton = document.getElementById("btnCancelResetPasswordModal");
    els.applyResetPasswordButton = document.getElementById("btnApplyResetPassword");
    els.resetTemporaryPassword = document.getElementById("resetTemporaryPassword");
    els.resetConfirmPassword = document.getElementById("resetConfirmPassword");
    els.resetMustChangePassword = document.getElementById("resetMustChangePassword");
}

async function loadRunningUsers() {
    if (gState.isLoadingRunningUsers) {
        return;
    }

    gState.isLoadingRunningUsers = true;
    try {
        const objResult = await requestJson("/api/rollingfutures-lt-dual/admin/running-users", {
            credentials: "same-origin"
        }, "Unable to load running dual users.");
        gState.runningUsers = Array.isArray(objResult.data) ? objResult.data : [];
        renderRunningUsers();
    }
    catch (objError) {
        setPageStatus(getErrorMessage(objError, "Unable to load running dual users."), "error");
    }
    finally {
        gState.isLoadingRunningUsers = false;
    }
}

async function refreshRunningUsers() {
    setButtonBusy(els.refreshRunningUsersButton, true, "");
    try {
        await loadRunningUsers();
        setPageStatus(`Loaded ${gState.runningUsers.length} running dual user${gState.runningUsers.length === 1 ? "" : "s"}.`, "success");
    }
    finally {
        restoreIconButton(els.refreshRunningUsersButton);
    }
}

async function loadUsers() {
    if (gState.isLoadingUsers) {
        return;
    }

    gState.isLoadingUsers = true;

    try {
        const objResult = await requestJson("/api/admin/accounts", {
            credentials: "same-origin"
        }, "Unable to load users.");

        gState.users = Array.isArray(objResult.data) ? objResult.data : [];
        applyFilters();
    }
    catch (objError) {
        setPageStatus(getErrorMessage(objError, "Unable to load users."), "error");
    }
    finally {
        gState.isLoadingUsers = false;
    }
}

async function loadExecutionRequests() {
    if (gState.isLoadingExecutionRequests) {
        return;
    }

    gState.isLoadingExecutionRequests = true;
    try {
        const objResult = await requestJson("/api/admin/strategy-execution-requests", {
            credentials: "same-origin"
        }, "Unable to load pending strategy execution requests.");
        gState.pendingExecutionRequests = Array.isArray(objResult.data) ? objResult.data : [];
        renderExecutionRequests();
    }
    catch (objError) {
        setPageStatus(getErrorMessage(objError, "Unable to load pending strategy execution requests."), "error");
    }
    finally {
        gState.isLoadingExecutionRequests = false;
    }
}

async function refreshExecutionRequests() {
    setButtonBusy(els.refreshExecRequestsButton, true, "");
    try {
        await loadExecutionRequests();
        setPageStatus(`Loaded ${gState.pendingExecutionRequests.length} pending strategy request${gState.pendingExecutionRequests.length === 1 ? "" : "s"}.`, "success");
    }
    finally {
        restoreIconButton(els.refreshExecRequestsButton);
    }
}

async function loadAdminData(pOptions) {
    const bShowSuccess = Boolean(pOptions?.showSuccess);
    setPageStatus("Loading admin data...", "info");
    setButtonBusy(els.refreshButton, true, "Refreshing...");

    try {
        await Promise.all([loadUsers(), loadRunningUsers(), loadExecutionRequests(), loadExecutionSettings()]);
        if (bShowSuccess) {
            setPageStatus(`Loaded ${gState.users.length} user account${gState.users.length === 1 ? "" : "s"}, ${gState.runningUsers.length} running dual user${gState.runningUsers.length === 1 ? "" : "s"}, and ${gState.pendingExecutionRequests.length} pending strategy request${gState.pendingExecutionRequests.length === 1 ? "" : "s"}.`, "success");
        }
    }
    finally {
        setButtonBusy(els.refreshButton, false, "Refresh");
    }
}

function renderRunningUsers() {
    if (els.runningUsersCount) {
        els.runningUsersCount.textContent = `${gState.runningUsers.length} running`;
    }

    if (!els.runningUsersTableBody) {
        return;
    }

    if (!gState.runningUsers.length) {
        els.runningUsersTableBody.innerHTML = `<tr><td colspan="6" class="mngusers-empty">No running Dual live users right now.</td></tr>`;
        return;
    }

    els.runningUsersTableBody.innerHTML = gState.runningUsers.map((objUser) => {
        const bSwitching = gState.switchingPrimaryAccountId === objUser.accountId;
        const vModeChip = objUser.survivalMode
            ? `<span class="mngusers-chip mngusers-chip-warn">Survival DB</span>`
            : `<span class="mngusers-chip mngusers-chip-live">Primary DB</span>`;
        const vPrimaryOwner = objUser.ownerServerId || "-";
        const vSurvivalOwner = objUser.survivalOwnerServerId || "-";
        const vOutageChip = objUser.simulatedPrimaryDbOutage
            ? `<span class="mngusers-chip mngusers-chip-warn">Outage Test ON</span>`
            : "";
        return `
            <tr>
                <td class="mngusers-nowrap">${escapeHtml(objUser.fullName || "-")}</td>
                <td class="mngusers-nowrap">${escapeHtml(objUser.email || "-")}</td>
                <td>
                    <div class="mngusers-status-stack">
                        <div>${vModeChip}</div>
                        ${vOutageChip ? `<div>${vOutageChip}</div>` : ""}
                    </div>
                </td>
                <td>
                    <div class="mngusers-owner-stack">
                        <div><strong>Primary:</strong> ${escapeHtml(vPrimaryOwner)}</div>
                        <div><strong>Survival:</strong> ${escapeHtml(vSurvivalOwner)}</div>
                    </div>
                </td>
                <td class="mngusers-nowrap">${escapeHtml(formatDateTime(objUser.lastCycleAt || objUser.updatedAt))}</td>
                <td class="mngusers-nowrap">
                    ${objUser.survivalMode ? `
                        <button class="app-link-btn" type="button" data-running-action="switch-primary" data-account-id="${escapeHtml(objUser.accountId)}" ${bSwitching ? "disabled" : ""}>
                            ${bSwitching ? "Switching..." : "Switch To Primary DB"}
                        </button>
                    ` : `<span class="mngusers-chip mngusers-chip-muted">Normal</span>`}
                </td>
            </tr>
        `;
    }).join("");
}

async function loadExecutionSettings() {
    const objResult = await requestJson("/api/admin/strategy-execution-requests/settings", {
        credentials: "same-origin"
    }, "Unable to load auto execution settings.");
    setCheckedNode(els.autoExecSl, objResult.data?.slEnabled !== false);
    setCheckedNode(els.autoExecTp, Boolean(objResult.data?.tpEnabled));
}

async function saveExecutionSettings() {
    if (gState.isSavingExecutionSettings) {
        return;
    }

    gState.isSavingExecutionSettings = true;
    try {
        const objResult = await requestJson("/api/admin/strategy-execution-requests/settings", {
            method: "PUT",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                slEnabled: getCheckedNode(els.autoExecSl),
                tpEnabled: getCheckedNode(els.autoExecTp)
            })
        }, "Unable to save auto execution settings.");
        setPageStatus(objResult.message || "Auto execution settings saved successfully.", "success");
    }
    catch (objError) {
        setPageStatus(getErrorMessage(objError, "Unable to save auto execution settings."), "error");
        await loadExecutionSettings().catch(() => undefined);
    }
    finally {
        gState.isSavingExecutionSettings = false;
    }
}

function applyFilters() {
    const vSearch = String(els.searchInput?.value || "").trim().toLowerCase();
    gState.filteredUsers = gState.users.filter((objUser) => !vSearch || [
        objUser.fullName,
        objUser.email,
        objUser.mobileNo,
        objUser.telegramChatId
    ].join(" ").toLowerCase().includes(vSearch));
    renderStats();
    renderTable();
    renderExecutionRequests();
}

function renderStats() {
    const vTotal = gState.users.length;
    const vActive = gState.users.filter((objUser) => objUser.isActive).length;
    const vAdmins = gState.users.filter((objUser) => objUser.isAdmin).length;
    const vForced = gState.users.filter((objUser) => objUser.mustChangePassword).length;

    setText("statTotal", String(vTotal));
    setText("statActive", String(vActive));
    setText("statAdmins", String(vAdmins));
    setText("statForced", String(vForced));
    setText("resultCount", `${gState.filteredUsers.length} shown`);
}

function renderTable() {
    if (!els.userTableBody) {
        return;
    }

    if (!gState.filteredUsers.length) {
        els.userTableBody.innerHTML = `<tr><td colspan="6" class="mngusers-empty">No users match the current search.</td></tr>`;
        return;
    }

    els.userTableBody.innerHTML = gState.filteredUsers.map((objUser) => {
        const vCreated = formatDateTime(objUser.createdAt);
        const vBadges = [
            objUser.isAdmin ? `<span class="mngusers-chip mngusers-chip-admin">Admin</span>` : `<span class="mngusers-chip mngusers-chip-muted">User</span>`,
            objUser.isActive ? `<span class="mngusers-chip mngusers-chip-live">Active</span>` : `<span class="mngusers-chip mngusers-chip-off">Inactive</span>`,
            objUser.mustChangePassword ? `<span class="mngusers-chip mngusers-chip-warn">Pwd Reset</span>` : ""
        ].filter(Boolean).join(" ");

        return `
            <tr>
                <td>
                    <div class="mngusers-cell-title">${escapeHtml(objUser.fullName)}</div>
                    <div class="mngusers-cell-sub">${escapeHtml(objUser.mobileNo || "-")}</div>
                </td>
                <td>
                    <div class="mngusers-cell-title">${escapeHtml(objUser.email)}</div>
                    <div class="mngusers-cell-sub">Created ${escapeHtml(vCreated)}</div>
                </td>
                <td>${vBadges}</td>
                <td>${objUser.execStrategy ? `<span class="mngusers-chip mngusers-chip-info">Enabled</span>` : `<span class="mngusers-chip mngusers-chip-muted">Disabled</span>`}</td>
                <td>${objUser.mustChangePassword ? "Temporary password pending" : "Ready"}</td>
                <td>
                    <div class="mngusers-actions">
                        <button class="app-link-btn" type="button" data-action="edit" data-id="${escapeHtml(objUser.accountId)}" title="Edit user" aria-label="Edit user">
                            Edit
                        </button>
                        <button class="app-link-btn" type="button" data-action="reset" data-id="${escapeHtml(objUser.accountId)}" title="Reset password" aria-label="Reset password">
                            Reset Password
                        </button>
                        <button class="app-link-btn" type="button" data-action="delete" data-id="${escapeHtml(objUser.accountId)}" title="Delete user" aria-label="Delete user" ${objUser.accountId === gState.currentAccountId ? "disabled" : ""}>
                            Delete
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join("");
}

function renderExecutionRequests() {
    if (!els.execRequestTableBody) {
        return;
    }

    const vSearch = String(els.searchInput?.value || "").trim().toLowerCase();
    const arrRequests = gState.pendingExecutionRequests.filter((objRequest) => !vSearch || [
        objRequest.fullName,
        objRequest.email
    ].join(" ").toLowerCase().includes(vSearch));

    if (els.execRequestCount) {
        els.execRequestCount.textContent = `${arrRequests.length} pending`;
    }

    if (!arrRequests.length) {
        els.execRequestTableBody.innerHTML = `<tr><td colspan="8" class="mngusers-empty">No pending strategy execution requests.</td></tr>`;
        return;
    }

    els.execRequestTableBody.innerHTML = arrRequests.map((objRequest) => {
        const bExecuting = gState.executingRequestId === objRequest.requestId;
        const vStartQty = Number(objRequest.requestPayload?.startQty ?? objRequest.requestPayload?.qty);
        const vAvailableBalance = Number(objRequest.requestPayload?.availableBalance);
        return `
            <tr>
                <td class="mngusers-nowrap">${escapeHtml(formatDateTime(objRequest.createdAt))}</td>
                <td class="mngusers-nowrap">${escapeHtml(objRequest.fullName)}</td>
                <td class="mngusers-nowrap">${escapeHtml(objRequest.email)}</td>
                <td>${escapeHtml(getExecutionTriggerLabel(objRequest.triggerSource))}</td>
                <td>${Number.isFinite(vStartQty) ? escapeHtml(String(vStartQty)) : "-"}</td>
                <td>${Number.isFinite(vAvailableBalance) ? escapeHtml(`${vAvailableBalance.toFixed(2)} USD`) : "-"}</td>
                <td>${objRequest.execStrategy ? `<span class="mngusers-chip mngusers-chip-info">Enabled</span>` : `<span class="mngusers-chip mngusers-chip-muted">Disabled</span>`}</td>
                <td class="mngusers-nowrap">
                    <button class="mngusers-icon-btn execute" type="button" data-request-action="execute" data-request-id="${escapeHtml(objRequest.requestId)}" title="${bExecuting ? "Executing..." : "Execute"}" aria-label="${bExecuting ? "Executing..." : "Execute"}" ${bExecuting ? "disabled" : ""}>
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M8 5v14l11-7z" fill="currentColor"></path>
                        </svg>
                    </button>
                    <button class="mngusers-icon-btn cancel" type="button" data-request-action="cancel" data-request-id="${escapeHtml(objRequest.requestId)}" title="Cancel" aria-label="Cancel" ${bExecuting ? "disabled" : ""}>
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
                        </svg>
                    </button>
                </td>
            </tr>
        `;
    }).join("");
}

function handleTableAction(objEvent) {
    const objButton = objEvent.target instanceof Element ? objEvent.target.closest("button[data-action]") : null;
    if (!(objButton instanceof HTMLButtonElement)) {
        return;
    }

    const vAction = String(objButton.dataset.action || "").trim();
    const vAccountId = String(objButton.dataset.id || "").trim();
    const objUser = gState.users.find((objRow) => objRow.accountId === vAccountId);
    if (!objUser) {
        return;
    }

    if (vAction === "edit") {
        openUserModal(objUser);
        return;
    }

    if (vAction === "reset") {
        openResetPasswordModal(objUser);
        return;
    }

    if (vAction === "delete") {
        void deleteUser(objUser);
    }
}

function handleExecRequestAction(objEvent) {
    const objButton = objEvent.target instanceof Element ? objEvent.target.closest("button[data-request-action]") : null;
    if (!(objButton instanceof HTMLButtonElement)) {
        return;
    }

    const vAction = String(objButton.dataset.requestAction || "").trim();
    const vRequestId = String(objButton.dataset.requestId || "").trim();
    if (vAction === "execute" && vRequestId) {
        void executePendingRequest(vRequestId);
        return;
    }
    if (vAction === "cancel" && vRequestId) {
        void cancelPendingRequest(vRequestId);
    }
}

function handleRunningUsersAction(objEvent) {
    const objButton = objEvent.target instanceof Element ? objEvent.target.closest("button[data-running-action]") : null;
    if (!(objButton instanceof HTMLButtonElement)) {
        return;
    }
    const vAction = String(objButton.dataset.runningAction || "").trim();
    const vAccountId = String(objButton.dataset.accountId || "").trim();
    if (vAction === "switch-primary" && vAccountId) {
        void switchRunningUserToPrimary(vAccountId);
    }
}

function openUserModal(pUser) {
    gState.editingAccountId = String(pUser?.accountId || "");
    setTextNode(els.modalTitle, gState.editingAccountId ? "Edit User" : "Add User");
    setTextNode(
        els.modalHint,
        gState.editingAccountId
            ? "Update account access settings here."
            : "Create a new account with only the essential login details."
    );

    setInputValue(els.fullName, pUser?.fullName || "");
    setInputValue(els.email, pUser?.email || "");
    setInputValue(els.mobileNo, pUser?.mobileNo || "");
    setInputValue(els.telegramChatId, pUser?.telegramChatId || "");
    setInputValue(els.password, "");
    setInputValue(els.confirmPassword, "");
    setCheckedNode(els.isActive, pUser ? Boolean(pUser.isActive) : true);
    setCheckedNode(els.execStrategy, pUser ? Boolean(pUser.execStrategy) : false);
    setCheckedNode(els.isAdmin, pUser ? Boolean(pUser.isAdmin) : false);
    setCheckedNode(els.mustChangePassword, pUser ? Boolean(pUser.mustChangePassword) : false);

    if (els.passwordFields instanceof HTMLElement) {
        els.passwordFields.hidden = Boolean(gState.editingAccountId);
    }

    setFormMessage(els.modalMessage, "", "");
    openModal("user");
    els.fullName?.focus();
}

function openResetPasswordModal(pUser) {
    gState.resettingAccountId = String(pUser?.accountId || "");
    setTextNode(els.resetPasswordHint, `Set a temporary password for ${pUser?.fullName || "the selected account"}.`);
    setInputValue(els.resetTemporaryPassword, "");
    setInputValue(els.resetConfirmPassword, "");
    setCheckedNode(els.resetMustChangePassword, true);
    setFormMessage(els.resetPasswordMessage, "", "");
    openModal("resetPassword");
    els.resetTemporaryPassword?.focus();
}

function openModal(pModalKey) {
    gState.activeModal = pModalKey;
    els.overlay?.classList.add("show");

    if (pModalKey === "user") {
        els.userModal?.classList.add("show");
        els.userModal?.setAttribute("aria-hidden", "false");
        els.resetPasswordModal?.classList.remove("show");
        els.resetPasswordModal?.setAttribute("aria-hidden", "true");
        return;
    }

    if (pModalKey === "resetPassword") {
        els.resetPasswordModal?.classList.add("show");
        els.resetPasswordModal?.setAttribute("aria-hidden", "false");
        els.userModal?.classList.remove("show");
        els.userModal?.setAttribute("aria-hidden", "true");
    }
}

function closeActiveModal() {
    gState.activeModal = "";
    els.overlay?.classList.remove("show");
    els.userModal?.classList.remove("show");
    els.userModal?.setAttribute("aria-hidden", "true");
    els.resetPasswordModal?.classList.remove("show");
    els.resetPasswordModal?.setAttribute("aria-hidden", "true");
    gState.editingAccountId = "";
    gState.resettingAccountId = "";
}

function handleDocumentKeydown(objEvent) {
    if (objEvent.key === "Escape" && gState.activeModal) {
        closeActiveModal();
    }
}

async function submitUserForm(objEvent) {
    objEvent.preventDefault();
    if (gState.isSavingUser) {
        return;
    }

    const objPayload = {
        fullName: getInputValue(els.fullName),
        email: getInputValue(els.email),
        mobileNo: getInputValue(els.mobileNo),
        telegramChatId: getInputValue(els.telegramChatId),
        password: getInputValue(els.password),
        confirmPassword: getInputValue(els.confirmPassword),
        isActive: getCheckedNode(els.isActive),
        execStrategy: getCheckedNode(els.execStrategy),
        isAdmin: getCheckedNode(els.isAdmin),
        mustChangePassword: getCheckedNode(els.mustChangePassword)
    };

    if (!objPayload.fullName || !objPayload.email || !objPayload.mobileNo) {
        setFormMessage(els.modalMessage, "Full name, email, and mobile number are required.", "error");
        return;
    }

    if (!gState.editingAccountId && (!objPayload.password || objPayload.password !== objPayload.confirmPassword)) {
        setFormMessage(els.modalMessage, "Password and confirm password are required and must match.", "error");
        return;
    }

    const vNormalizedEmail = objPayload.email.toLowerCase();
    const bEmailExists = gState.users.some((objUser) => {
        const vUserEmail = String(objUser.email || "").trim().toLowerCase();
        if (!vUserEmail || vUserEmail !== vNormalizedEmail) {
            return false;
        }

        return !gState.editingAccountId || objUser.accountId !== gState.editingAccountId;
    });
    if (bEmailExists) {
        setFormMessage(els.modalMessage, "An account with this email already exists.", "error");
        els.email?.focus();
        return;
    }

    const vUrl = gState.editingAccountId ? `/api/admin/accounts/${gState.editingAccountId}` : "/api/admin/accounts";
    const vMethod = gState.editingAccountId ? "PUT" : "POST";
    gState.isSavingUser = true;
    setButtonBusy(els.saveUserButton, true, "Saving...");

    try {
        const objResult = await requestJson(vUrl, {
            method: vMethod,
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(objPayload)
        }, "Unable to save user.");

        setPageStatus(objResult.message || "User saved successfully.", "success");
        closeActiveModal();
        await loadAdminData();
    }
    catch (objError) {
        setFormMessage(els.modalMessage, getErrorMessage(objError, "Unable to save user."), "error");
    }
    finally {
        gState.isSavingUser = false;
        setButtonBusy(els.saveUserButton, false, "Save User");
    }
}

async function submitResetPasswordForm(objEvent) {
    objEvent.preventDefault();
    if (gState.isResettingPassword || !gState.resettingAccountId) {
        return;
    }

    const vTemporaryPassword = getInputValue(els.resetTemporaryPassword);
    const vConfirmPassword = getInputValue(els.resetConfirmPassword);
    const bMustChangePassword = getCheckedNode(els.resetMustChangePassword);

    if (!vTemporaryPassword || vTemporaryPassword.length < 3) {
        setFormMessage(els.resetPasswordMessage, "Temporary password must be at least 3 characters long.", "error");
        return;
    }

    if (vTemporaryPassword !== vConfirmPassword) {
        setFormMessage(els.resetPasswordMessage, "Temporary password and confirm password must match.", "error");
        return;
    }

    gState.isResettingPassword = true;
    setButtonBusy(els.applyResetPasswordButton, true, "Applying...");

    try {
        const objResult = await requestJson(`/api/admin/accounts/${gState.resettingAccountId}/reset-password`, {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                temporaryPassword: vTemporaryPassword,
                mustChangePassword: bMustChangePassword
            })
        }, "Unable to reset password.");

        setPageStatus(objResult.message || "Temporary password updated.", "success");
        closeActiveModal();
        await loadAdminData();
    }
    catch (objError) {
        setFormMessage(els.resetPasswordMessage, getErrorMessage(objError, "Unable to reset password."), "error");
    }
    finally {
        gState.isResettingPassword = false;
        setButtonBusy(els.applyResetPasswordButton, false, "Apply Reset");
    }
}

async function deleteUser(pUser) {
    if (pUser.accountId === gState.currentAccountId) {
        setPageStatus("You cannot delete your own admin account.", "error");
        return;
    }

    const vConfirmed = window.confirm(`Delete ${pUser.fullName} and the linked user profile?`);
    if (!vConfirmed) {
        return;
    }

    try {
        const objResult = await requestJson(`/api/admin/accounts/${pUser.accountId}`, {
            method: "DELETE",
            credentials: "same-origin"
        }, "Unable to delete user.");

        setPageStatus(objResult.message || "User account deleted successfully.", "success");
        await loadAdminData();
    }
    catch (objError) {
        setPageStatus(getErrorMessage(objError, "Unable to delete user."), "error");
    }
}

async function executePendingRequest(pRequestId) {
    if (!pRequestId || gState.executingRequestId) {
        return;
    }

    gState.executingRequestId = pRequestId;
    renderExecutionRequests();

    try {
        const objResult = await requestJson(`/api/admin/strategy-execution-requests/${encodeURIComponent(pRequestId)}/execute`, {
            method: "POST",
            credentials: "same-origin"
        }, "Unable to execute the pending strategy request.");

        setPageStatus(objResult.message || "Strategy executed successfully.", "success");
        await loadAdminData();
    }
    catch (objError) {
        setPageStatus(getErrorMessage(objError, "Unable to execute the pending strategy request."), "error");
        await loadExecutionRequests().catch(() => undefined);
    }
    finally {
        gState.executingRequestId = "";
        renderExecutionRequests();
    }
}

async function cancelPendingRequest(pRequestId) {
    if (!pRequestId || gState.executingRequestId) {
        return;
    }

    const objRequest = gState.pendingExecutionRequests.find((objRow) => objRow.requestId === pRequestId);
    const vConfirmed = window.confirm(`Cancel the pending strategy execution request for ${objRequest?.fullName || "this user"}?`);
    if (!vConfirmed) {
        return;
    }

    gState.executingRequestId = pRequestId;
    renderExecutionRequests();

    try {
        const objResult = await requestJson(`/api/admin/strategy-execution-requests/${encodeURIComponent(pRequestId)}`, {
            method: "DELETE",
            credentials: "same-origin"
        }, "Unable to cancel the pending strategy request.");

        setPageStatus(objResult.message || "Pending strategy request cancelled successfully.", "success");
        await loadAdminData();
    }
    catch (objError) {
        setPageStatus(getErrorMessage(objError, "Unable to cancel the pending strategy request."), "error");
        await loadExecutionRequests().catch(() => undefined);
    }
    finally {
        gState.executingRequestId = "";
        renderExecutionRequests();
    }
}

async function switchRunningUserToPrimary(pAccountId) {
    if (!pAccountId || gState.switchingPrimaryAccountId) {
        return;
    }

    const objUser = gState.runningUsers.find((objRow) => objRow.accountId === pAccountId);
    const vConfirmed = window.confirm(`Switch ${objUser?.fullName || "this running user"} back to Primary DB control now?`);
    if (!vConfirmed) {
        return;
    }

    gState.switchingPrimaryAccountId = pAccountId;
    renderRunningUsers();

    try {
        const objResult = await requestJson(`/api/rollingfutures-lt-dual/admin/running-users/${encodeURIComponent(pAccountId)}/switch-primary`, {
            method: "POST",
            credentials: "same-origin"
        }, "Unable to switch this running strategy back to Primary DB.");
        setPageStatus(objResult.message || "Strategy switched back to Primary DB successfully.", "success");
        await loadAdminData();
    }
    catch (objError) {
        setPageStatus(getErrorMessage(objError, "Unable to switch this running strategy back to Primary DB."), "error");
        await loadRunningUsers().catch(() => undefined);
    }
    finally {
        gState.switchingPrimaryAccountId = "";
        renderRunningUsers();
    }
}

async function setSimulatedPrimaryOutage(pAccountId, pEnabled) {
    if (!pAccountId || gState.simulatingPrimaryOutageAccountId) {
        return;
    }

    const objUser = gState.runningUsers.find((objRow) => objRow.accountId === pAccountId);
    const vConfirmed = window.confirm(
        pEnabled
            ? `Simulate Primary DB outage now for ${objUser?.fullName || "this running user"}?`
            : `Clear the simulated Primary DB outage for ${objUser?.fullName || "this running user"}?`
    );
    if (!vConfirmed) {
        return;
    }

    gState.simulatingPrimaryOutageAccountId = pAccountId;
    renderRunningUsers();

    try {
        const objResult = await requestJson(`/api/rollingfutures-lt-dual/admin/running-users/${encodeURIComponent(pAccountId)}/simulate-primary-outage`, {
            method: pEnabled ? "POST" : "DELETE",
            credentials: "same-origin"
        }, pEnabled
            ? "Unable to enable simulated Primary DB outage."
            : "Unable to clear simulated Primary DB outage.");
        setPageStatus(
            objResult.message || (pEnabled
                ? "Simulated Primary DB outage enabled."
                : "Simulated Primary DB outage cleared."),
            "success"
        );
        await loadAdminData();
    }
    catch (objError) {
        setPageStatus(getErrorMessage(objError, pEnabled
            ? "Unable to enable simulated Primary DB outage."
            : "Unable to clear simulated Primary DB outage."), "error");
        await loadRunningUsers().catch(() => undefined);
    }
    finally {
        gState.simulatingPrimaryOutageAccountId = "";
        renderRunningUsers();
    }
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
    setFormMessage(els.pageStatus, pMessage, pTone);
}

function setFormMessage(pNode, pMessage, pTone) {
    if (!(pNode instanceof HTMLElement)) {
        return;
    }

    const vMessage = String(pMessage || "").trim();
    pNode.textContent = vMessage;
    pNode.className = pNode.id === "pageStatus" ? "mngusers-page-status" : "mngusers-form-message";
    if (!vMessage) {
        return;
    }

    pNode.classList.add("show");
    if (pTone) {
        pNode.classList.add(pTone);
    }
}

function setButtonBusy(pButton, pBusy, pBusyText) {
    if (!(pButton instanceof HTMLButtonElement)) {
        return;
    }

    if (!pButton.dataset.defaultLabel) {
        pButton.dataset.defaultLabel = pButton.innerHTML || "";
    }

    pButton.disabled = pBusy;
    if (pButton.classList.contains("mngusers-icon-btn")) {
        return;
    }
    pButton.textContent = pBusy ? pBusyText : String(pButton.dataset.defaultLabel || "");
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

function setText(pId, pValue) {
    const objNode = document.getElementById(pId);
    if (objNode) {
        objNode.textContent = pValue;
    }
}

function setTextNode(pNode, pValue) {
    if (pNode) {
        pNode.textContent = String(pValue || "");
    }
}

function setInputValue(pNode, pValue) {
    if (pNode instanceof HTMLInputElement) {
        pNode.value = String(pValue || "");
    }
}

function getInputValue(pNode) {
    return pNode instanceof HTMLInputElement ? String(pNode.value || "").trim() : "";
}

function setCheckedNode(pNode, pValue) {
    if (pNode instanceof HTMLInputElement) {
        pNode.checked = Boolean(pValue);
    }
}

function getCheckedNode(pNode) {
    return pNode instanceof HTMLInputElement ? Boolean(pNode.checked) : false;
}

function formatDateTime(pValue) {
    const objDate = new Date(pValue);
    return Number.isNaN(objDate.getTime()) ? "-" : objDate.toLocaleString("en-IN");
}

function getExecutionTriggerLabel(pTriggerSource) {
    const vTriggerSource = String(pTriggerSource || "").trim().toLowerCase();
    if (vTriggerSource === "manual_exec_strategy") {
        return "Manual Exec Strategy";
    }
    if (vTriggerSource === "brokerage_profit_reentry") {
        return "Brokerage Profit Trigger";
    }
    if (vTriggerSource === "blocked_margin_profit_reentry") {
        return "Blocked Margin Trigger";
    }
    return vTriggerSource ? vTriggerSource.replaceAll("_", " ") : "-";
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
