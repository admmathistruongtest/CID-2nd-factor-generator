// admin.js

// ===============================================
// === CONFIGURATION & VARIABLES GLOBALES
// ===============================================
const BASE_URL = "https://europe-west1-monkey-face-al.cloudfunctions.net";

// URLs des fonctions Cloud (Admin)
const ADMIN_GRANT_ACCESS_URL = `${BASE_URL}/adminGrantAccess`;
const ADMIN_REVOKE_ACCESS_URL = `${BASE_URL}/adminRevokeAccess`;
const ADMIN_GET_ALL_PERMISSIONS_URL = `${BASE_URL}/adminGetAllPermissions`;
const ADMIN_GET_KNOWN_USERS_URL = `${BASE_URL}/adminGetKnownUsers`;

// État de l'application
let idToken = null;
let userInfo = null;
let knownUsers = []; // Pour l'autocomplete

// ===============================================
// === AUTHENTIFICATION & FONCTIONS UTILITAIRES
// ===============================================

/**
 * Décode le token JWT pour obtenir les informations de l'utilisateur.
 */
function parseJwt(token) {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        return JSON.parse(atob(base64));
    } catch (e) { console.error("Impossible de décoder le JWT", e); return null; }
}

/**
 * Met à jour l'interface avec les informations de l'utilisateur connecté.
 */
function updateUserInfoUI() {
    if (!userInfo) return;
    const avatar = document.getElementById('user-avatar');
    const emailSpan = document.getElementById('user-email');
    if (avatar) avatar.src = userInfo.picture || '';
    if (emailSpan) emailSpan.textContent = userInfo.email;
}

/**
 * Gère la déconnexion de l'utilisateur.
 */
function signOut() {
    google.accounts.id.disableAutoSelect();
    window.location.reload();
}

/**
 * Fonction appelée par Google après une connexion réussie. Point d'entrée principal.
 */
async function handleCredentialResponse(response) {
    console.log("Connexion Google réussie, vérification des droits admin...");
    idToken = response.credential; // Store token globally
    userInfo = parseJwt(idToken); // Store user info globally

    const authErrorDiv = document.getElementById('auth-error-message');
    authErrorDiv.style.display = 'none'; // Cache l'ancien message d'erreur

    if (!idToken || !userInfo) {
        console.error("Token ou userInfo invalide après connexion.");
        authErrorDiv.textContent = "Erreur lors de la vérification de l'utilisateur.";
        authErrorDiv.style.display = 'block';
        return;
    }

    // --- Vérification Admin Immédiate ---
    try {
        // On tente d'appeler une fonction réservée aux admins (comme charger les permissions)
        const checkResponse = await fetch(ADMIN_GET_ALL_PERMISSIONS_URL, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${idToken}` }
        });

        // Si l'accès est refusé par le backend
        if (checkResponse.status === 403) {
            console.warn(`Accès admin refusé pour ${userInfo.email}.`);
            authErrorDiv.textContent = "Accès refusé. Ce compte n'a pas les privilèges administrateur.";
            authErrorDiv.style.display = 'block';
            // Optionnel : Désactiver la connexion auto pour éviter boucle
            google.accounts.id.disableAutoSelect();
            // On NE montre PAS le panneau admin
            return;
        }
        // Si une autre erreur serveur survient lors du check
        if (!checkResponse.ok) {
             throw new Error(`Erreur serveur (${checkResponse.status}) lors de la vérification admin.`);
        }

        // --- Si l'accès est autorisé (status 200 OK) ---
        console.log(`Accès admin confirmé pour ${userInfo.email}.`);
        document.getElementById('auth-container').style.display = 'none';
        document.getElementById('admin-panel').style.display = 'block';

        updateUserInfoUI();
        initializeUIEventListeners(); // Initialise les listeners seulement si admin

        // Charge les données nécessaires (permissions déjà reçues lors du check)
        const permissions = await checkResponse.json(); // Réutilise la réponse du check
        renderPermissions(permissions);
        await loadKnownUsers(); // Charge les utilisateurs connus ensuite

    } catch (error) {
        console.error("Erreur lors de la vérification initiale des droits admin:", error);
        authErrorDiv.textContent = "Erreur de communication avec le serveur lors de la vérification.";
        authErrorDiv.style.display = 'block';
        google.accounts.id.disableAutoSelect();
    }
}

// ===============================================
// === CHARGEMENT DES DONNÉES (FETCH)
// ===============================================

/**
 * Charge la liste des utilisateurs connus depuis le backend pour l'autocomplete.
 */
async function loadKnownUsers() {
    try {
        const response = await fetch(ADMIN_GET_KNOWN_USERS_URL, { headers: { 'Authorization': `Bearer ${idToken}` } });
        if (!response.ok) throw new Error('Impossible de charger les utilisateurs connus.');
        knownUsers = await response.json();
        console.log("Utilisateurs connus chargés:", knownUsers.length);
    } catch (error) { console.error("Erreur chargement utilisateurs connus:", error); knownUsers = []; }
}

/**
 * Charge et affiche la liste de toutes les permissions depuis le backend.
 */
async function loadPermissions() {
    const listContainer = document.getElementById('permissions-list');
    listContainer.innerHTML = '<p>Chargement des permissions...</p>'; // Indicateur global
    try {
        const response = await fetch(ADMIN_GET_ALL_PERMISSIONS_URL, { method: 'GET', headers: { 'Authorization': `Bearer ${idToken}` } });
        if (!response.ok) throw new Error(`Erreur serveur : ${await response.text()}`);
        const permissions = await response.json();
        renderPermissions(permissions); // Appelle la fonction de rendu
    } catch (error) {
        console.error("Erreur chargement permissions:", error);
        listContainer.innerHTML = '<p style="color: red;">Impossible de charger les permissions.</p>';
    }
}

// ===============================================
// === RENDU HTML (Génération de l'interface)
// ===============================================

/**
 * Génère le HTML pour la liste des permissions (Accordion + Tabs + Search + Forms Top - Corrigé).
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
        <div class="cid-item" data-cid-name="${perm.cid.toLowerCase()}">
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
                        <input type="search" class="filter-list-input manager-filter" placeholder="Filtrer managers..." style="width: 100%; margin-bottom: 15px;">
                        <form class="grant-form manager" data-cid="${perm.cid}" style="margin-bottom: 20px;">
                            <div class="autocomplete-container">
                                <input type="email" class="grant-manager-input" placeholder="Ajouter un manager..." required autocomplete="off">
                                <ul class="suggestions-list"></ul>
                            </div>
                            <button type="submit" class="btn tiny ghost">Désigner Manager</button>
                        </form>
                        <h4>Managers Désignés :</h4>
                        <ul class="manager-list">
                            ${perm.managers && perm.managers.length > 0 ?
                                perm.managers.map(manager => `<li><span>${manager}</span><button class="btn tiny ghost remove-manager-btn" data-cid="${perm.cid}" data-manager="${manager}">Retirer</button></li>`).join('')
                                : '<li>Aucun manager désigné.</li>'
                            }
                        </ul>
                    </div>
                </div>
                <div id="users-${cidSafeId}" class="tab-panel">
                    <div class="permission-section">
                        <input type="search" class="filter-list-input user-filter" placeholder="Filtrer utilisateurs..." style="width: 100%; margin-bottom: 15px;">
                         <form class="grant-form user" data-cid="${perm.cid}" style="margin-bottom: 20px;">
                            <div class="autocomplete-container">
                                <input type="email" class="grant-user-input" placeholder="Ajouter un utilisateur..." required autocomplete="off">
                                <ul class="suggestions-list"></ul>
                            </div>
                            <button type="submit" class="btn tiny">Accorder</button>
                        </form>
                        <h4>Utilisateurs Autorisés :</h4>
                        <ul class="user-list">
                            ${perm.authorizedUsers && perm.authorizedUsers.length > 0 ?
                                perm.authorizedUsers.map(user => `<li><span>${user}</span><button class="btn tiny revoke-btn" data-cid="${perm.cid}" data-user="${user}">Révoquer</button></li>`).join('')
                                : '<li>Aucun utilisateur autorisé.</li>'
                            }
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    `}).join('');
    // Ré-attache les listeners d'autocomplete après chaque rendu complet
    attachAutocompleteListeners('.grant-user-input');
    attachAutocompleteListeners('.grant-manager-input');
}

/**
 * Attache les écouteurs d'événements pour l'autocomplete.
 */
function attachAutocompleteListeners(inputSelector) {
    document.querySelectorAll(inputSelector).forEach(input => {
        const suggestionsList = input.parentElement?.querySelector('.suggestions-list'); // Recherche dans le parent direct
        if (!suggestionsList) return;

        input.addEventListener('input', () => {
            const query = input.value.toLowerCase();
            suggestionsList.innerHTML = ''; suggestionsList.style.display = 'none';
            if (query.length < 2 || !Array.isArray(knownUsers) || knownUsers.length === 0) return; // Vérifie aussi knownUsers
            const filteredUsers = knownUsers.filter(user => user.toLowerCase().includes(query));
            if (filteredUsers.length > 0) {
                filteredUsers.slice(0, 5).forEach(user => { // Limite à 5 suggestions
                    const li = document.createElement('li'); li.textContent = user;
                    li.addEventListener('mousedown', (e) => { // mousedown est mieux pour éviter conflit avec blur
                        e.preventDefault(); input.value = user; suggestionsList.style.display = 'none';
                    });
                    suggestionsList.appendChild(li);
                });
                suggestionsList.style.display = 'block'; // Affiche la liste
            }
        });
        // Cache la liste quand l'input perd le focus
        input.addEventListener('blur', () => { setTimeout(() => { suggestionsList.style.display = 'none'; }, 150); }); // Délai pour permettre le clic
    });
}

// ===============================================
// === GESTIONNAIRES D'ÉVÉNEMENTS (Listeners)
// ===============================================

/**
 * Initialise TOUS les écouteurs d'événements après la connexion.
 */
function initializeUIEventListeners() {
    // --- Menu profil & déconnexion ---
    document.getElementById('user-profile-btn')?.addEventListener('click', (e) => { e.stopPropagation(); document.getElementById('logout-dropdown')?.classList.toggle('visible'); });
    document.getElementById('logout-btn')?.addEventListener('click', signOut);
    document.addEventListener('click', () => { document.getElementById('logout-dropdown')?.classList.remove('visible'); });

    // --- Recherche globale CID ---
    const cidSearchInput = document.getElementById('cid-search-input');
    const listContainer = document.getElementById('permissions-list'); // Conteneur principal

    cidSearchInput?.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase().trim();
        const items = listContainer?.querySelectorAll('.cid-item');
        items?.forEach(item => {
            const cidName = item.dataset.cidName || ''; // data-cid-name est déjà en minuscules
            item.style.display = cidName.includes(searchTerm) ? '' : 'none';
        });
    });

    // --- Délégation pour la liste des CIDs (#permissions-list) ---
    if (!listContainer) return; // Arrête si le conteneur n'existe pas

    // --- Clics (Accordion, Tabs, Boutons Révoquer/Retirer) ---
    listContainer.addEventListener('click', async (e) => {
        const header = e.target.closest('.cid-header');
        const tabButton = e.target.closest('.tab-button');
        const revokeButton = e.target.closest('.revoke-btn');
        const removeManagerButton = e.target.closest('.remove-manager-btn');
        const card = e.target.closest('.cid-item');
        const overlay = card?.querySelector('.card-loading-overlay');

        // Accordion
        if (header && card) { card.classList.toggle('expanded'); return; }

        // Tabs
        if (tabButton && card) {
            const targetTabId = tabButton.dataset.tab;
            card.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
            tabButton.classList.add('active');
            card.querySelectorAll('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === targetTabId));
            return;
        }

        // Révoquer Utilisateur
        if (revokeButton && card && overlay) {
            const { cid, user } = revokeButton.dataset;
            if (!confirm(`Révoquer l'accès de ${user} à ${cid} ?`)) return;
            revokeButton.disabled = true; overlay.classList.add('visible');
            try {
                const response = await fetch(ADMIN_REVOKE_ACCESS_URL, { method: 'POST', headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ cid, userToRevoke: user }) });
                if (!response.ok) throw new Error(await response.text());
                // Recharge après succès
                await loadPermissions();
            } catch (error) {
                alert(`Erreur révocation : ${error.message}`);
                revokeButton.disabled = false; // Réactive en cas d'erreur
            } finally {
                 // Cache l'overlay même si le rechargement échoue
                 overlay.classList.remove('visible'); 
            }
        }

        // Retirer Manager
        else if (removeManagerButton && card && overlay) {
            const { cid, manager } = removeManagerButton.dataset;
            if (!confirm(`Retirer ${manager} comme manager de ${cid} ?`)) return;
            removeManagerButton.disabled = true; overlay.classList.add('visible');
            try {
                const response = await fetch(ADMIN_REMOVE_MANAGER_URL, { method: 'POST', headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ cid, managerEmail: manager }) });
                if (!response.ok) throw new Error(await response.text());
                 // Recharge après succès
                await loadPermissions();
            } catch (error) {
                 alert(`Erreur retrait manager : ${error.message}`);
                 removeManagerButton.disabled = false; // Réactive en cas d'erreur
            } finally {
                // Cache l'overlay même si le rechargement échoue
                overlay.classList.remove('visible');
            }
        }
    });

    // --- Soumissions de Formulaires (Accorder/Désigner) ---
    listContainer.addEventListener('submit', async (e) => {
        e.preventDefault(); // Empêche soumission standard
        const grantFormUser = e.target.closest('.grant-form.user');
        const grantFormManager = e.target.closest('.grant-form.manager');
        const card = e.target.closest('.cid-item');
        const overlay = card?.querySelector('.card-loading-overlay');

        // Accorder Utilisateur
        if (grantFormUser && card && overlay) {
            const { cid } = grantFormUser.dataset;
            const input = grantFormUser.querySelector('.grant-user-input');
            const userToGrant = input.value;
            const button = grantFormUser.querySelector('button[type="submit"]');
            if (!userToGrant || !userToGrant.includes('@')) { alert("Email utilisateur invalide."); return; }
            button.disabled = true; overlay.classList.add('visible');
            try {
                const response = await fetch(ADMIN_GRANT_ACCESS_URL, { method: 'POST', headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ cid, userToGrant }) });
                if (!response.ok) throw new Error(await response.text());
                input.value = ''; // Vide l'input
                await loadPermissions(); // Recharge après succès
            } catch (error) {
                alert(`Erreur accord accès : ${error.message}`);
                button.disabled = false; // Réactive en cas d'erreur
            } finally {
                 overlay.classList.remove('visible'); // Cache l'overlay
            }
        }

        // Désigner Manager
        else if (grantFormManager && card && overlay) {
             const { cid } = grantFormManager.dataset;
             const input = grantFormManager.querySelector('.grant-manager-input');
             const managerEmail = input.value;
             const button = grantFormManager.querySelector('button[type="submit"]');
             if (!managerEmail || !managerEmail.includes('@')) { alert("Email manager invalide."); return; }
             button.disabled = true; overlay.classList.add('visible');
             try {
                 const response = await fetch(ADMIN_ADD_MANAGER_URL, { method: 'POST', headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ cid, managerEmail }) });
                 if (!response.ok) throw new Error(await response.text());
                 input.value = ''; // Vide l'input
                 await loadPermissions(); // Recharge après succès
             } catch (error) {
                 alert(`Erreur ajout manager : ${error.message}`);
                 button.disabled = false; // Réactive en cas d'erreur
            } finally {
                 overlay.classList.remove('visible'); // Cache l'overlay
             }
        }
    });

    // --- Filtres Locaux (dans les tabs) ---
    listContainer.addEventListener('input', (e) => {
        const filterInput = e.target.closest('.filter-list-input');
        if (filterInput) {
            const searchTerm = filterInput.value.toLowerCase().trim();
            const tabPanel = filterInput.closest('.tab-panel');
            const list = tabPanel?.querySelector('.user-list, .manager-list'); // Trouve la bonne liste
            list?.querySelectorAll('li').forEach(li => {
                // Ignore le 'li' indiquant une liste vide
                if (li.children.length === 0 || !li.querySelector('span')) {
                    li.style.display = ''; // Assure que 'Aucun...' reste visible
                    return;
                }
                const emailSpan = li.querySelector('span');
                const email = emailSpan?.textContent.toLowerCase() || '';
                // Cache ou affiche le 'li' basé sur la recherche
                li.style.display = email.includes(searchTerm) ? 'flex' : 'none'; // 'flex' car les li sont en flex
            });
        }
    });
} // Fin de initializeUIEventListeners