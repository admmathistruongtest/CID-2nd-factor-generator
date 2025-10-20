// admin.js

// ===============================================
// === CONFIGURATION & VARIABLES GLOBALES
// ===============================================
const BASE_URL = "https://europe-west1-monkey-face-al.cloudfunctions.net";

// URLs des fonctions Cloud
const ADMIN_GRANT_ACCESS_URL = `${BASE_URL}/adminGrantAccess`;
const ADMIN_REVOKE_ACCESS_URL = `${BASE_URL}/adminRevokeAccess`;
const ADMIN_GET_ALL_PERMISSIONS_URL = `${BASE_URL}/adminGetAllPermissions`;
const ADMIN_GET_KNOWN_USERS_URL = `${BASE_URL}/adminGetKnownUsers`;
const ADMIN_ADD_MANAGER_URL = `${BASE_URL}/adminAddManager`;
const ADMIN_REMOVE_MANAGER_URL = `${BASE_URL}/adminRemoveManager`;

// État de l'application
let idToken = null;
let userInfo = null;
let knownUsers = [];

// ===============================================
// === AUTHENTIFICATION & FONCTIONS UTILITAIRES
// ===============================================

function parseJwt(token) {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        return JSON.parse(atob(base64));
    } catch (e) {
        console.error("Impossible de décoder le JWT", e);
        return null;
    }
}

function updateUserInfoUI() {
    if (!userInfo) return;
    document.getElementById('user-avatar').src = userInfo.picture || '';
    document.getElementById('user-email').textContent = userInfo.email;
}

function signOut() {
    google.accounts.id.disableAutoSelect();
    window.location.reload();
}

async function handleCredentialResponse(response) {
    idToken = response.credential;
    userInfo = parseJwt(idToken);

    if (!idToken || !userInfo) {
        alert("Erreur: Impossible de vérifier les informations de l'utilisateur.");
        return;
    }

    document.getElementById('auth-container').style.display = 'none';
    document.getElementById('admin-panel').style.display = 'block';

    updateUserInfoUI();
    initializeUIEventListeners();

    try {
        // Charge les permissions et les utilisateurs connus en parallèle
        await Promise.all([
            loadPermissions(),
            loadKnownUsers()
        ]);
    } catch (error) {
        console.error("Erreur lors du chargement des données initiales:", error);
    }
}

// ===============================================
// === CHARGEMENT DES DONNÉES (FETCH)
// ===============================================

async function loadKnownUsers() {
    try {
        const response = await fetch(ADMIN_GET_KNOWN_USERS_URL, {
            headers: { 'Authorization': `Bearer ${idToken}` }
        });
        if (!response.ok) throw new Error('Impossible de charger les utilisateurs connus.');
        knownUsers = await response.json();
        console.log("Utilisateurs connus chargés:", knownUsers.length);
    } catch (error) {
        console.error("Erreur lors du chargement des utilisateurs connus:", error);
        knownUsers = [];
    }
}

async function loadPermissions() {
    const listContainer = document.getElementById('permissions-list');
    listContainer.innerHTML = '<p>Chargement des permissions...</p>';

    try {
        const response = await fetch(ADMIN_GET_ALL_PERMISSIONS_URL, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${idToken}` }
        });
        if (!response.ok) throw new Error(`Erreur serveur : ${await response.text()}`);
        const permissions = await response.json();
        renderPermissions(permissions);
    } catch (error) {
        console.error("Erreur lors du chargement des permissions:", error);
        listContainer.innerHTML = '<p style="color: red;">Impossible de charger les permissions.</p>';
    }
}


// ===============================================
// === RENDU HTML (Génération de l'interface)
// ===============================================

/**
 * Génère le HTML pour la liste des permissions (VERSION Accordéon + Tabs).
 */
function renderPermissions(permissions) {
    const listContainer = document.getElementById('permissions-list');
    if (!permissions || permissions.length === 0) {
        listContainer.innerHTML = '<p>Aucun CID n\'a été trouvé.</p>';
        return;
    }

    permissions.sort((a, b) => a.cid.localeCompare(b.cid));
    listContainer.innerHTML = permissions.map(perm => {
        const cidSafeId = perm.cid.replace(/[^a-zA-Z0-9]/g, ''); // ID sûr pour HTML

        return `
        <div class="cid-item" data-cid="${perm.cid}">
            <div class="card-loading-overlay"></div>

            <div class="cid-header">
                <strong class="cid-name">${perm.cid}</strong>
                <span class="expand-icon"></span>
            </div>

            <div class="cid-content">
                <div class="tabs">
                    <button class="tab-button active" data-tab="managers-${cidSafeId}">Managers</button>
                    <button class="tab-button" data-tab="users-${cidSafeId}">Utilisateurs</button>
                </div>

                <div id="managers-${cidSafeId}" class="tab-panel active">
                    <div class="permission-section">
                        <h4>Managers Désignés :</h4>
                        <ul class="manager-list">
                            ${perm.managers && perm.managers.length > 0 ?
                                perm.managers.map(manager => `
                                    <li>
                                        <span>${manager}</span>
                                        <button class="btn tiny ghost remove-manager-btn" data-cid="${perm.cid}" data-manager="${manager}">Retirer</button>
                                    </li>`).join('')
                                : '<li>Aucun manager désigné.</li>'
                            }
                        </ul>
                        <form class="grant-form manager" data-cid="${perm.cid}">
                            <div class="autocomplete-container">
                                <input type="email" class="grant-manager-input" placeholder="Ajouter un manager..." required autocomplete="off">
                                <ul class="suggestions-list"></ul>
                            </div>
                            <button type="submit" class="btn tiny ghost">Désigner Manager</button>
                        </form>
                    </div>
                </div>

                <div id="users-${cidSafeId}" class="tab-panel">
                    <div class="permission-section">
                        <h4>Utilisateurs Autorisés :</h4>
                        <ul class="user-list">
                            ${perm.authorizedUsers && perm.authorizedUsers.length > 0 ?
                                perm.authorizedUsers.map(user => `
                                    <li>
                                        <span>${user}</span>
                                        <button class="btn tiny revoke-btn" data-cid="${perm.cid}" data-user="${user}">Révoquer</button>
                                    </li>`).join('')
                                : '<li>Aucun utilisateur autorisé.</li>'
                            }
                        </ul>
                        <form class="grant-form user" data-cid="${perm.cid}">
                            <div class="autocomplete-container">
                                <input type="email" class="grant-user-input" placeholder="Ajouter un utilisateur..." required autocomplete="off">
                                <ul class="suggestions-list"></ul>
                            </div>
                            <button type="submit" class="btn tiny">Accorder</button>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    `}).join('');

    attachAutocompleteListeners('.grant-user-input');
    attachAutocompleteListeners('.grant-manager-input');
}


/**
 * Attache les écouteurs d'événements pour l'autocomplete.
 */
function attachAutocompleteListeners(inputSelector) {
    document.querySelectorAll(inputSelector).forEach(input => {
        const suggestionsList = input.parentElement.querySelector('.suggestions-list');
        if (!suggestionsList) return;

        input.addEventListener('input', () => {
            const query = input.value.toLowerCase();
            suggestionsList.innerHTML = '';
            suggestionsList.style.display = 'none';
            if (query.length < 2 || knownUsers.length === 0) return;
            const filteredUsers = knownUsers.filter(user => user.toLowerCase().includes(query));
            if (filteredUsers.length > 0) {
                filteredUsers.slice(0, 5).forEach(user => {
                    const li = document.createElement('li');
                    li.textContent = user;
                    li.addEventListener('mousedown', (e) => {
                        e.preventDefault(); input.value = user; suggestionsList.style.display = 'none';
                    });
                    suggestionsList.appendChild(li);
                });
                suggestionsList.style.display = 'block';
            }
        });
        input.addEventListener('blur', () => { setTimeout(() => { suggestionsList.style.display = 'none'; }, 150); });
    });
}

// ===============================================
// === GESTIONNAIRES D'ÉVÉNEMENTS (Listeners)
// ===============================================

/**
 * Initialise TOUS les écouteurs d'événements de l'interface après la connexion.
 */
function initializeUIEventListeners() {
    // Menu de profil et déconnexion
    document.getElementById('user-profile-btn')?.addEventListener('click', (e) => {
        e.stopPropagation(); document.getElementById('logout-dropdown')?.classList.toggle('visible');
    });
    document.getElementById('logout-btn')?.addEventListener('click', signOut);
    document.addEventListener('click', () => { document.getElementById('logout-dropdown')?.classList.remove('visible'); });

    // --- Délégation d'événements pour la liste des permissions (Clics) ---
    const permissionsList = document.getElementById('permissions-list');
    if (!permissionsList) return; // Quitte si l'élément n'existe pas

    permissionsList.addEventListener('click', async (e) => {
        const header = e.target.closest('.cid-header');
        const tabButton = e.target.closest('.tab-button');
        const revokeButton = e.target.closest('.revoke-btn');
        const removeManagerButton = e.target.closest('.remove-manager-btn');
        const card = e.target.closest('.cid-item');
        const overlay = card?.querySelector('.card-loading-overlay');

        // === Clic sur le Header pour déplier/replier ===
        if (header && card) {
            card.classList.toggle('expanded');
            return;
        }

        // === Clic sur un bouton d'onglet ===
        if (tabButton && card) {
            const targetTabId = tabButton.dataset.tab;
            card.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
            tabButton.classList.add('active');
            card.querySelectorAll('.tab-panel').forEach(panel => {
                panel.classList.toggle('active', panel.id === targetTabId);
            });
            return;
        }

        // === Clic sur "Révoquer" utilisateur ===
        if (revokeButton && card && overlay) {
            const { cid, user } = revokeButton.dataset;
            if (!confirm(`Voulez-vous vraiment révoquer l'accès de ${user} au CID ${cid} ?`)) return;
            revokeButton.disabled = true; overlay.classList.add('visible');
            try {
                const response = await fetch(ADMIN_REVOKE_ACCESS_URL, {
                    method: 'POST', headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ cid, userToRevoke: user })
                });
                if (!response.ok) throw new Error(await response.text());
            } catch (error) { alert(`Erreur révocation : ${error.message}`); }
            finally { revokeButton.disabled = false; overlay.classList.remove('visible'); await loadPermissions(); }
        }

        // === Clic sur "Retirer Manager" ===
        else if (removeManagerButton && card && overlay) {
            const { cid, manager } = removeManagerButton.dataset;
            if (!confirm(`Voulez-vous vraiment retirer ${manager} comme manager de ${cid} ?`)) return;
            removeManagerButton.disabled = true; overlay.classList.add('visible');
            try {
                const response = await fetch(ADMIN_REMOVE_MANAGER_URL, {
                    method: 'POST', headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ cid, managerEmail: manager })
                });
                if (!response.ok) throw new Error(await response.text());
            } catch (error) { alert(`Erreur retrait manager : ${error.message}`); }
            finally { removeManagerButton.disabled = false; overlay.classList.remove('visible'); await loadPermissions(); }
        }
    });

    // --- Délégation pour les soumissions de formulaire ---
    permissionsList.addEventListener('submit', async (e) => {
        e.preventDefault();
        const grantFormUser = e.target.closest('.grant-form.user');
        const grantFormManager = e.target.closest('.grant-form.manager');
        const card = e.target.closest('.cid-item');
        const overlay = card?.querySelector('.card-loading-overlay');

        // === Soumission "Accorder" utilisateur ===
        if (grantFormUser && card && overlay) {
            const { cid } = grantFormUser.dataset;
            const input = grantFormUser.querySelector('.grant-user-input');
            const userToGrant = input.value;
            const button = grantFormUser.querySelector('button[type="submit"]');
            if (!userToGrant || !userToGrant.includes('@')) { alert("Email utilisateur invalide."); return; }
            button.disabled = true; overlay.classList.add('visible');
            try {
                const response = await fetch(ADMIN_GRANT_ACCESS_URL, {
                     method: 'POST', headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ cid, userToGrant })
                });
                if (!response.ok) throw new Error(await response.text());
                input.value = '';
            } catch (error) { alert(`Erreur accord accès : ${error.message}`); }
            finally { button.disabled = false; overlay.classList.remove('visible'); await loadPermissions(); }
        }

        // === Soumission "Désigner Manager" ===
        else if (grantFormManager && card && overlay) {
             const { cid } = grantFormManager.dataset;
             const input = grantFormManager.querySelector('.grant-manager-input');
             const managerEmail = input.value;
             const button = grantFormManager.querySelector('button[type="submit"]');
             if (!managerEmail || !managerEmail.includes('@')) { alert("Email manager invalide."); return; }
             button.disabled = true; overlay.classList.add('visible');
             try {
                 const response = await fetch(ADMIN_ADD_MANAGER_URL, {
                     method: 'POST', headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ cid, managerEmail })
                 });
                 if (!response.ok) throw new Error(await response.text());
                 input.value = '';
             } catch (error) { alert(`Erreur ajout manager : ${error.message}`); }
             finally { button.disabled = false; overlay.classList.remove('visible'); await loadPermissions(); }
        }
    });

    
}

