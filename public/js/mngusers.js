const gState = {
    users: [],
    filteredUsers: [],
    pageSize: 5,
    userPage: 1,
    editingAccountId: "",
    resettingAccountId: "",
    currentAccountId: "",
    activeModal: "",
    isLoadingUsers: false,
    pendingLiveActions: [],
    isLoadingPendingLiveActions: false,
    pendingLiveActionBusyId: "",
    isSavingUser: false,
    isResettingPassword: false
};

const els = {};

document.addEventListener("DOMContentLoaded", () => {
    cacheElements();
    gState.currentAccountId = String(els.app?.dataset.currentAccountId || "");

    els.searchInput?.addEventListener("input", applyFilters);
    els.refreshButton?.addEventListener("click", () => {
        void loadAdminData({ showSuccess: true });
    });
    els.addUserButton?.addEventListener("click", () => openUserModal());
    els.cancelModalButton?.addEventListener("click", closeActiveModal);
    els.closeModalButton?.addEventListener("click", closeActiveModal);
    els.execStrategy?.addEventListener("change", syncVerifierExecStrategyState);
    els.isVerifier?.addEventListener("change", syncVerifierExecStrategyState);
    els.userForm?.addEventListener("submit", submitUserForm);
    els.closeResetPasswordModalButton?.addEventListener("click", closeActiveModal);
    els.cancelResetPasswordModalButton?.addEventListener("click", closeActiveModal);
    els.resetPasswordForm?.addEventListener("submit", submitResetPasswordForm);
    els.overlay?.addEventListener("click", closeActiveModal);
    els.userTableBody?.addEventListener("click", handleTableAction);
    els.pendingLiveActionsBody?.addEventListener("click", handlePendingLiveAction);
    els.refreshPendingLiveActionsButton?.addEventListener("click", () => {
        void loadPendingLiveActions({ showSuccess: true });
    });
    document.addEventListener("keydown", handleDocumentKeydown);

    void loadAdminData({ showSuccess: true });
});

function cacheElements() {
    els.app = document.getElementById("mngUsersApp");
    els.searchInput = document.getElementById("searchInput");
    els.refreshButton = document.getElementById("btnRefresh");
    els.addUserButton = document.getElementById("btnAddUser");
    els.pageStatus = document.getElementById("pageStatus");
    els.resultCount = document.getElementById("resultCount");
    els.userPager = document.getElementById("userPager");
    els.userTableBody = document.getElementById("userTableBody");
    els.pendingLiveActionsBody = document.getElementById("pendingLiveActionsBody");
    els.pendingLiveActionsCount = document.getElementById("pendingLiveActionsCount");
    els.refreshPendingLiveActionsButton = document.getElementById("btnRefreshPendingLiveActions");
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
    els.isVerifier = document.getElementById("isVerifier");
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

async function loadPendingLiveActions(pOptions) {
    if (gState.isLoadingPendingLiveActions) {
        return;
    }

    gState.isLoadingPendingLiveActions = true;
    setButtonBusy(els.refreshPendingLiveActionsButton, true, "");
    try {
        const objResult = await requestJson("/api/admin/live-actions/pending", {
            credentials: "same-origin"
        }, "Unable to load pending live confirmations.");
        gState.pendingLiveActions = Array.isArray(objResult.data) ? objResult.data : [];
        renderPendingLiveActions();
        if (pOptions?.showSuccess) {
            setPageStatus(`${gState.pendingLiveActions.length} pending live confirmation${gState.pendingLiveActions.length === 1 ? "" : "s"} loaded.`, "success");
        }
    }
    catch (objError) {
        gState.pendingLiveActions = [];
        renderPendingLiveActions();
        setPageStatus(getErrorMessage(objError, "Unable to load pending live confirmations."), "error");
    }
    finally {
        gState.isLoadingPendingLiveActions = false;
        restoreIconButton(els.refreshPendingLiveActionsButton);
    }
}

async function loadAdminData(pOptions) {
    const bShowSuccess = Boolean(pOptions?.showSuccess);
    setPageStatus("Loading admin data...", "info");
    setButtonBusy(els.refreshButton, true, "");

    try {
        await Promise.all([
            loadUsers(),
            loadPendingLiveActions()
        ]);
        if (bShowSuccess) {
            setPageStatus(`Loaded ${gState.users.length} user account${gState.users.length === 1 ? "" : "s"} and ${gState.pendingLiveActions.length} pending live confirmation${gState.pendingLiveActions.length === 1 ? "" : "s"}.`, "success");
        }
    }
    finally {
        restoreIconButton(els.refreshButton);
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
    gState.userPage = 1;
    renderStats();
    renderTable();
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
        renderPager(els.userPager, {
            page: 1,
            totalItems: 0,
            totalPages: 0,
            onPageChange: () => undefined
        });
        return;
    }

    const objPaged = paginateRows(gState.filteredUsers, gState.userPage, gState.pageSize);
    gState.userPage = objPaged.page;

    els.userTableBody.innerHTML = objPaged.rows.map((objUser) => {
        const vCreated = formatDateTime(objUser.createdAt);
        const vBadges = [
            objUser.isAdmin ? `<span class="mngusers-chip mngusers-chip-admin">Admin</span>` : `<span class="mngusers-chip mngusers-chip-muted">User</span>`,
            objUser.isVerifier ? `<span class="mngusers-chip mngusers-chip-info">Verifier</span>` : "",
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
                        <button class="mngusers-icon-btn" type="button" data-action="edit" data-id="${escapeHtml(objUser.accountId)}" title="Edit user" aria-label="Edit user">
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M4 20h4l10-10-4-4L4 16v4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"></path>
                                <path d="M13 7l4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
                            </svg>
                        </button>
                        <button class="mngusers-icon-btn" type="button" data-action="reset" data-id="${escapeHtml(objUser.accountId)}" title="Reset password" aria-label="Reset password">
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M12 3a4 4 0 0 1 4 4v2h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1V7a4 4 0 0 1 4-4z" fill="none" stroke="currentColor" stroke-width="2"></path>
                                <path d="M9 9V7a3 3 0 1 1 6 0v2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
                            </svg>
                        </button>
                        <button class="mngusers-icon-btn cancel" type="button" data-action="delete" data-id="${escapeHtml(objUser.accountId)}" title="Delete user" aria-label="Delete user" ${objUser.accountId === gState.currentAccountId ? "disabled" : ""}>
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M4 7h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
                                <path d="M9 7V5h6v2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
                                <path d="M8 7l1 12h6l1-12" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"></path>
                            </svg>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join("");

    renderPager(els.userPager, {
        page: objPaged.page,
        totalItems: gState.filteredUsers.length,
        totalPages: objPaged.totalPages,
        onPageChange: (pPage) => {
            gState.userPage = pPage;
            renderTable();
        }
    });
}

function renderPendingLiveActions() {
    if (!(els.pendingLiveActionsBody instanceof HTMLElement)) {
        return;
    }
    const arrRows = Array.isArray(gState.pendingLiveActions) ? gState.pendingLiveActions : [];
    setTextNode(els.pendingLiveActionsCount, `${arrRows.length} pending`);
    if (!arrRows.length) {
        els.pendingLiveActionsBody.innerHTML = `<tr><td colspan="8" class="mngusers-empty">No pending live confirmations.</td></tr>`;
        return;
    }

    els.pendingLiveActionsBody.innerHTML = arrRows.map((objRow) => {
        const vActionId = String(objRow.actionId || "").trim();
        const vBusy = gState.pendingLiveActionBusyId === vActionId;
        const vContractText = String(objRow.contractName || objRow.symbol || "-").trim() || "-";
        const vQueuedAt = formatDateTime(objRow.createdAt);
        const vAge = formatAge(objRow.createdAt);
        const vStrategy = String(objRow.strategyLabel || objRow.strategyCode || "-").trim();
        const vType = String(objRow.typeLabel || objRow.kind || "Live Action").trim();
        const vDetails = String(objRow.details || objRow.message || "-").trim() || "-";
        const vUserSub = [objRow.email, objRow.mobileNo].filter(Boolean).join(" | ");
        return `
            <tr>
                <td class="mngusers-nowrap">${escapeHtml(vQueuedAt)}</td>
                <td class="mngusers-nowrap">${escapeHtml(vAge)}</td>
                <td>
                    <div class="mngusers-cell-title">${escapeHtml(String(objRow.fullName || "-"))}</div>
                    <div class="mngusers-cell-sub">${escapeHtml(vUserSub || "-")}</div>
                </td>
                <td>${escapeHtml(vStrategy)}</td>
                <td>${escapeHtml(vType)}</td>
                <td>
                    <div class="mngusers-cell-title">${escapeHtml(vContractText)}</div>
                    <div class="mngusers-cell-sub">${escapeHtml(String(objRow.legSide || "").trim() || "-")}</div>
                </td>
                <td>${escapeHtml(vDetails)}</td>
                <td>
                    <div class="mngusers-actions">
                        <button class="mngusers-icon-btn execute" type="button" data-live-action="confirm" data-action-id="${escapeHtml(vActionId)}" title="Confirm live action" aria-label="Confirm live action" ${vBusy ? "disabled" : ""}>
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                            </svg>
                        </button>
                        <button class="mngusers-icon-btn cancel" type="button" data-live-action="reject" data-action-id="${escapeHtml(vActionId)}" title="Cancel live action" aria-label="Cancel live action" ${vBusy ? "disabled" : ""}>
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
                                <path d="m6 6 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
                            </svg>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join("");
}

function paginateRows(pRows, pPage, pPageSize) {
    const vTotalItems = Array.isArray(pRows) ? pRows.length : 0;
    const vTotalPages = Math.max(1, Math.ceil(vTotalItems / pPageSize));
    const vPage = Math.min(Math.max(1, Number(pPage) || 1), vTotalPages);
    const vStart = (vPage - 1) * pPageSize;
    return {
        rows: pRows.slice(vStart, vStart + pPageSize),
        page: vPage,
        totalPages: vTotalItems ? vTotalPages : 0,
        totalItems: vTotalItems
    };
}

function renderPager(pNode, pOptions) {
    if (!(pNode instanceof HTMLElement)) {
        return;
    }

    const vTotalItems = Math.max(0, Number(pOptions?.totalItems) || 0);
    const vTotalPages = Math.max(0, Number(pOptions?.totalPages) || 0);
    const vPage = Math.max(1, Number(pOptions?.page) || 1);
    const fnOnPageChange = typeof pOptions?.onPageChange === "function" ? pOptions.onPageChange : null;

    if (!vTotalItems || vTotalPages <= 1 || !fnOnPageChange) {
        pNode.innerHTML = vTotalItems
            ? `<div class="mngusers-pager-info">Showing ${vTotalItems} row${vTotalItems === 1 ? "" : "s"}</div>`
            : "";
        return;
    }

    pNode.innerHTML = `
        <div class="mngusers-pager-info">Showing ${vTotalItems} row${vTotalItems === 1 ? "" : "s"}</div>
        <div class="mngusers-pager-controls">
            <button class="mngusers-pager-btn" type="button" data-page-nav="prev" ${vPage <= 1 ? "disabled" : ""}>‹</button>
            <div class="mngusers-pager-page">Page ${vPage} / ${vTotalPages}</div>
            <button class="mngusers-pager-btn" type="button" data-page-nav="next" ${vPage >= vTotalPages ? "disabled" : ""}>›</button>
        </div>
    `;

    const objPrev = pNode.querySelector("button[data-page-nav='prev']");
    const objNext = pNode.querySelector("button[data-page-nav='next']");
    objPrev?.addEventListener("click", () => fnOnPageChange(Math.max(1, vPage - 1)));
    objNext?.addEventListener("click", () => fnOnPageChange(Math.min(vTotalPages, vPage + 1)));
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

function handlePendingLiveAction(objEvent) {
    const objButton = objEvent.target instanceof Element ? objEvent.target.closest("button[data-live-action]") : null;
    if (!(objButton instanceof HTMLButtonElement)) {
        return;
    }
    const vAction = String(objButton.dataset.liveAction || "").trim();
    const vActionId = String(objButton.dataset.actionId || "").trim();
    const objPending = gState.pendingLiveActions.find((objRow) => String(objRow.actionId || "").trim() === vActionId);
    if (!objPending || (vAction !== "confirm" && vAction !== "reject")) {
        return;
    }
    void submitPendingLiveAction(objPending, vAction);
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
    setCheckedNode(els.isVerifier, pUser ? Boolean(pUser.isVerifier) : false);
    setCheckedNode(els.isAdmin, pUser ? Boolean(pUser.isAdmin) : false);
    setCheckedNode(els.mustChangePassword, pUser ? Boolean(pUser.mustChangePassword) : false);
    syncVerifierExecStrategyState();

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
        isVerifier: getCheckedNode(els.isVerifier),
        isAdmin: getCheckedNode(els.isAdmin),
        isSurvivalAdmin: false,
        mustChangePassword: getCheckedNode(els.mustChangePassword)
    };

    if (!objPayload.fullName || !objPayload.email || !objPayload.mobileNo) {
        setFormMessage(els.modalMessage, "Full name, email, and mobile number are required.", "error");
        return;
    }

    if (objPayload.isVerifier && objPayload.execStrategy) {
        setFormMessage(els.modalMessage, "Verifier and Exec Strategy cannot both be enabled.", "error");
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

async function submitPendingLiveAction(pPending, pDecision) {
    const vActionId = String(pPending?.actionId || "").trim();
    const vUrl = pDecision === "confirm" ? "/api/admin/live-actions/confirm" : "/api/admin/live-actions/reject";
    if (!vActionId || gState.pendingLiveActionBusyId) {
        return;
    }
    gState.pendingLiveActionBusyId = vActionId;
    renderPendingLiveActions();
    try {
        const objResult = await requestJson(vUrl, {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                accountId: String(pPending.accountId || "").trim(),
                strategyCode: String(pPending.strategyCode || "").trim(),
                actionId: vActionId
            })
        }, `Unable to ${pDecision === "confirm" ? "confirm" : "cancel"} the live action.`);
        setPageStatus(String(objResult.message || `Live action ${pDecision === "confirm" ? "confirmed" : "cancelled"}.`), "success");
        await loadPendingLiveActions();
    }
    catch (objError) {
        setPageStatus(getErrorMessage(objError, `Unable to ${pDecision === "confirm" ? "confirm" : "cancel"} the live action.`), "error");
        await loadPendingLiveActions();
    }
    finally {
        gState.pendingLiveActionBusyId = "";
        renderPendingLiveActions();
    }
}

function syncVerifierExecStrategyState(objEvent) {
    const objTarget = objEvent?.target;
    if (objTarget === els.execStrategy && getCheckedNode(els.execStrategy)) {
        setCheckedNode(els.isVerifier, false);
        return;
    }

    if (objTarget === els.isVerifier && getCheckedNode(els.isVerifier)) {
        setCheckedNode(els.execStrategy, false);
        return;
    }

    if (getCheckedNode(els.isVerifier) && getCheckedNode(els.execStrategy)) {
        setCheckedNode(els.execStrategy, false);
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

function formatAge(pValue) {
    const vEpochMs = new Date(String(pValue || "")).getTime();
    if (!Number.isFinite(vEpochMs)) {
        return "-";
    }
    const vDiffMs = Math.max(0, Date.now() - vEpochMs);
    const vMinutes = Math.floor(vDiffMs / 60000);
    if (vMinutes < 1) {
        return "Just now";
    }
    if (vMinutes < 60) {
        return `${vMinutes}m`;
    }
    const vHours = Math.floor(vMinutes / 60);
    if (vHours < 24) {
        return `${vHours}h ${vMinutes % 60}m`;
    }
    const vDays = Math.floor(vHours / 24);
    return `${vDays}d ${vHours % 24}h`;
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
