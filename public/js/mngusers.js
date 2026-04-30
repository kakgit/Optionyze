const gState = {
    users: [],
    filteredUsers: [],
    editingAccountId: "",
    currentAccountId: ""
};

document.addEventListener("DOMContentLoaded", () => {
    const objApp = document.getElementById("mngUsersApp");
    gState.currentAccountId = String(objApp?.dataset.currentAccountId || "");

    document.getElementById("searchInput")?.addEventListener("input", applyFilters);
    document.getElementById("btnRefresh")?.addEventListener("click", loadUsers);
    document.getElementById("btnAddUser")?.addEventListener("click", () => openModal());
    document.getElementById("btnCancelModal")?.addEventListener("click", closeModal);
    document.getElementById("btnCloseModal")?.addEventListener("click", closeModal);
    document.getElementById("userForm")?.addEventListener("submit", submitForm);
    document.getElementById("overlay")?.addEventListener("click", closeModal);

    loadUsers();
});

async function loadUsers() {
    setStatus("Loading users...", "info");
    try {
        const objResponse = await fetch("/api/admin/accounts", { credentials: "same-origin" });
        const objResult = await objResponse.json();
        if (!objResponse.ok || objResult.status !== "success") {
            throw new Error(objResult.message || "Unable to load users.");
        }

        gState.users = Array.isArray(objResult.data) ? objResult.data : [];
        applyFilters();
        setStatus(`Loaded ${gState.users.length} user accounts.`, "success");
    }
    catch (objError) {
        setStatus(getErrorMessage(objError, "Unable to load users."), "error");
    }
}

function applyFilters() {
    const vSearch = String(document.getElementById("searchInput")?.value || "").trim().toLowerCase();

    gState.filteredUsers = gState.users.filter((objUser) => {
        return !vSearch || [
            objUser.fullName,
            objUser.email,
            objUser.mobileNo
        ].join(" ").toLowerCase().includes(vSearch);
    });

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
    const objTableBody = document.getElementById("userTableBody");
    if (!objTableBody) {
        return;
    }

    if (!gState.filteredUsers.length) {
        objTableBody.innerHTML = `<tr><td colspan="5" class="mngusers-empty">No users match the current search.</td></tr>`;
        return;
    }

    objTableBody.innerHTML = gState.filteredUsers.map((objUser) => {
        const vCreated = new Date(objUser.createdAt).toLocaleString("en-IN");
        const vBadges = [
            objUser.isAdmin ? `<span class="mngusers-chip mngusers-chip-admin">Admin</span>` : `<span class="mngusers-chip mngusers-chip-muted">User</span>`,
            objUser.isActive ? `<span class="mngusers-chip mngusers-chip-live">Active</span>` : `<span class="mngusers-chip mngusers-chip-off">Inactive</span>`,
            objUser.mustChangePassword ? `<span class="mngusers-chip mngusers-chip-warn">Pwd Reset</span>` : ``
        ].join(" ");

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
                <td>${objUser.mustChangePassword ? "Temporary password pending" : "Ready"}</td>
                <td>
                    <button class="app-link-btn" type="button" data-action="edit" data-id="${objUser.accountId}" title="Edit user" aria-label="Edit user">
                        Edit
                    </button>
                    <button class="app-link-btn" type="button" data-action="reset" data-id="${objUser.accountId}" title="Reset password" aria-label="Reset password">
                        Reset Password
                    </button>
                    <button class="app-link-btn" type="button" data-action="delete" data-id="${objUser.accountId}" title="Delete user" aria-label="Delete user" ${objUser.accountId === gState.currentAccountId ? "disabled" : ""}>
                        Delete
                    </button>
                </td>
            </tr>
        `;
    }).join("");

    objTableBody.querySelectorAll("button[data-action]").forEach((objButton) => {
        objButton.addEventListener("click", handleTableAction);
    });
}

function handleTableAction(objEvent) {
    const objButton = objEvent.currentTarget;
    const vAction = String(objButton.dataset.action || "");
    const vAccountId = String(objButton.dataset.id || "");
    const objUser = gState.users.find((objRow) => objRow.accountId === vAccountId);
    if (!objUser) {
        return;
    }

    if (vAction === "edit") {
        openModal(objUser);
        return;
    }

    if (vAction === "reset") {
        void resetPassword(objUser);
        return;
    }

    if (vAction === "delete") {
        void deleteUser(objUser);
    }
}

function openModal(pUser) {
    gState.editingAccountId = pUser?.accountId || "";
    setText("modalTitle", gState.editingAccountId ? "Edit User" : "Add User");
    setText("modalHint", gState.editingAccountId
        ? "Update account access settings here."
        : "Create a new account with only the essential login details.");

    setValue("fullName", pUser?.fullName || "");
    setValue("email", pUser?.email || "");
    setValue("mobileNo", pUser?.mobileNo || "");
    setValue("telegramChatId", pUser?.telegramChatId || "");
    setValue("password", "");
    setValue("confirmPassword", "");
    setChecked("isActive", pUser ? Boolean(pUser.isActive) : true);
    setChecked("isAdmin", pUser ? Boolean(pUser.isAdmin) : false);
    setChecked("mustChangePassword", pUser ? Boolean(pUser.mustChangePassword) : false);

    const objPasswordWrap = document.getElementById("passwordFields");
    if (objPasswordWrap) {
        objPasswordWrap.style.display = gState.editingAccountId ? "none" : "grid";
    }

    document.getElementById("modalMessage")?.classList.remove("show", "error", "success");
    document.getElementById("overlay")?.classList.add("show");
    document.getElementById("userModal")?.classList.add("show");
}

function closeModal() {
    document.getElementById("overlay")?.classList.remove("show");
    document.getElementById("userModal")?.classList.remove("show");
}

async function submitForm(objEvent) {
    objEvent.preventDefault();

    const objPayload = {
        fullName: getValue("fullName"),
        email: getValue("email"),
        mobileNo: getValue("mobileNo"),
        telegramChatId: getValue("telegramChatId"),
        password: getValue("password"),
        confirmPassword: getValue("confirmPassword"),
        isActive: getChecked("isActive"),
        isAdmin: getChecked("isAdmin"),
        mustChangePassword: getChecked("mustChangePassword")
    };

    if (!objPayload.fullName || !objPayload.email || !objPayload.mobileNo || !objPayload.telegramChatId) {
        setModalMessage("Full name, email, mobile number, and Telegram Chat ID are required.", "error");
        return;
    }

    if (!/^-?\d{5,20}$/.test(objPayload.telegramChatId)) {
        setModalMessage("Please enter a valid Telegram Chat ID.", "error");
        return;
    }

    if (!gState.editingAccountId && (!objPayload.password || objPayload.password !== objPayload.confirmPassword)) {
        setModalMessage("Password and confirm password are required and must match.", "error");
        return;
    }

    const vUrl = gState.editingAccountId ? `/api/admin/accounts/${gState.editingAccountId}` : "/api/admin/accounts";
    const vMethod = gState.editingAccountId ? "PUT" : "POST";

    try {
        const objResponse = await fetch(vUrl, {
            method: vMethod,
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(objPayload)
        });
        const objResult = await objResponse.json();
        if (!objResponse.ok || objResult.status !== "success") {
            throw new Error(objResult.message || "Unable to save user.");
        }

        setStatus(objResult.message || "User saved successfully.", "success");
        closeModal();
        await loadUsers();
    }
    catch (objError) {
        setModalMessage(getErrorMessage(objError, "Unable to save user."), "error");
    }
}

async function resetPassword(pUser) {
    const vTempPassword = window.prompt(`Set a temporary password for ${pUser.fullName}:`, "asd");
    if (!vTempPassword) {
        return;
    }

    try {
        const objResponse = await fetch(`/api/admin/accounts/${pUser.accountId}/reset-password`, {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ temporaryPassword: vTempPassword })
        });
        const objResult = await objResponse.json();
        if (!objResponse.ok || objResult.status !== "success") {
            throw new Error(objResult.message || "Unable to reset password.");
        }

        setStatus(objResult.message, "success");
        await loadUsers();
    }
    catch (objError) {
        setStatus(getErrorMessage(objError, "Unable to reset password."), "error");
    }
}

async function deleteUser(pUser) {
    if (pUser.accountId === gState.currentAccountId) {
        setStatus("You cannot delete your own admin account.", "error");
        return;
    }

    const vConfirmed = window.confirm(`Delete ${pUser.fullName} and the linked user profile?`);
    if (!vConfirmed) {
        return;
    }

    try {
        const objResponse = await fetch(`/api/admin/accounts/${pUser.accountId}`, {
            method: "DELETE",
            credentials: "same-origin"
        });
        const objResult = await objResponse.json();
        if (!objResponse.ok || objResult.status !== "success") {
            throw new Error(objResult.message || "Unable to delete user.");
        }

        setStatus(objResult.message, "success");
        await loadUsers();
    }
    catch (objError) {
        setStatus(getErrorMessage(objError, "Unable to delete user."), "error");
    }
}

function setStatus(pMessage, pTone) {
    const objStatus = document.getElementById("pageStatus");
    if (!objStatus) {
        return;
    }

    objStatus.textContent = pMessage;
    objStatus.className = `mngusers-page-status show ${pTone}`;
}

function setModalMessage(pMessage, pTone) {
    const objMessage = document.getElementById("modalMessage");
    if (!objMessage) {
        return;
    }

    objMessage.textContent = pMessage;
    objMessage.className = `mngusers-form-message show ${pTone}`;
}

function setText(pId, pValue) {
    const objNode = document.getElementById(pId);
    if (objNode) {
        objNode.textContent = pValue;
    }
}

function setValue(pId, pValue) {
    const objNode = document.getElementById(pId);
    if (objNode) {
        objNode.value = pValue;
    }
}

function getValue(pId) {
    return String(document.getElementById(pId)?.value || "").trim();
}

function setChecked(pId, pValue) {
    const objNode = document.getElementById(pId);
    if (objNode) {
        objNode.checked = Boolean(pValue);
    }
}

function getChecked(pId) {
    return Boolean(document.getElementById(pId)?.checked);
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
    if (pError instanceof Error && pError.message) {
        return pError.message;
    }

    return pFallback;
}
