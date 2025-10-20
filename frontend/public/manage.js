// manage.js

// ===============================================
// === CONFIGURATION & VARIABLES GLOBALES
// ===============================================
const BASE_URL = "https://europe-west1-monkey-face-al.cloudfunctions.net";

// URLs des fonctions Cloud (Manager)
const GET_MANAGED_CIDS_URL = `${BASE_URL}/getManagedCIDsAndUsers`;
const MANAGER_GRANT_ACCESS_URL = `${BASE_URL}/managerGrantAccess`;
const MANAGER_REVOKE_ACCESS_URL = `${BASE_URL}/managerRevokeAccess`;

// État de l'application
let idToken = null;
let userInfo = null;

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
    idToken = response.credential;
    userInfo = parseJwt(idToken);
    if (!idToken || !userInfo) {
        alert("Erreur: Impossible de vérifier les informations de l'utilisateur.");
        document.getElementById('auth-container').style.display = 'block'; // Assure que l'auth reste visible
        document.getElementById('manage-panel').style.display = 'none';
        return;
    }
    document.getElementById('auth-container').style.display = 'none';
    document.getElementById('manage-panel').style.display = 'block';
    updateUserInfoUI();
    initializeUIEventListeners(); // Attache les écouteurs
    await loadManagedCIDs(); // Charge les données
}

// ===============================================
// === CHARGEMENT DES DONNÉES (FETCH)
// ===============================================

/**
 * Charge et affiche les CIDs gérés par le manager connecté.
 */
async function loadManagedCIDs() {
    const listContainer = document.getElementById('managed-cids-list');
    if (!listContainer) return;
    listContainer.innerHTML = '<p>Chargement de vos CIDs...</p>';
    try {
        const response = await fetch(GET_MANAGED_CIDS_URL, {
            method: 'GET', headers: { 'Authorization': `Bearer ${idToken}` }
        });
        if (response.status === 200) {
            const managedData = await response.json();
            renderManagedCIDs(managedData); // Passe au rendu
        } else {
            // Gère les cas où l'utilisateur ne manage rien ou erreur serveur
            const errorText = await response.text();
            console.warn(`Statut ${response.status} lors du chargement des CIDs: ${errorText}`);
            listContainer.innerHTML = '<p>Vous ne gérez actuellement aucun CID ou une erreur est survenue.</p>';
        }
    } catch (error) {
        console.error("Erreur chargement CIDs gérés:", error);
        listContainer.innerHTML = '<p style="color: red;">Impossible de charger les CIDs que vous gérez.</p>';
    }
}

// ===============================================
// === RENDU HTML (Génération de l'interface)
// ===============================================

/**
 * Génère le HTML pour la liste des CIDs gérés (Accordion, PAS de tabs, formulaires et filtres en haut).
 */
function renderManagedCIDs(managedData) {
    const listContainer = document.getElementById('managed-cids-list');
    if (!listContainer) return;

    if (!managedData || managedData.length === 0) {
        listContainer.innerHTML = '<p>Vous ne gérez actuellement aucun CID.</p>';
        return;
    }
    managedData.sort((a, b) => a.cid.localeCompare(b.cid)); // Trie par nom de CID
    listContainer.innerHTML = managedData.map(data => {
        const cidSafeId = data.cid.replace(/[^a-zA-Z0-9]/g, ''); // ID sûr pour éléments HTML
        return `
        <div class="cid-item" data-cid-name="${data.cid.toLowerCase()}">
            <div class="card-loading-overlay"></div>
            <div class="cid-header">
                <strong class="cid-name">${data.cid}</strong>
                <span class="expand-icon"></span>
            </div>
            <div class="cid-content">
                <div id="users-${cidSafeId}" class="tab-panel active">
                    <div class="permission-section">
                        <input type="search" class="filter-list-input user-filter" placeholder="Filtrer utilisateurs..." style="width: 100%; margin-bottom: 15px;">
                        <form class="grant-form user" data-cid="${data.cid}" style="margin-bottom: 20px;">
                            <input type="email" class="grant-user-input" placeholder="Ajouter un utilisateur..." required>
                            <button type="submit" class="btn tiny">Accorder</button>
                        </form>
                        <h4>Utilisateurs Autorisés :</h4>
                        <ul class="user-list">
                            ${data.authorizedUsers && data.authorizedUsers.length > 0 ?
                                data.authorizedUsers.map(user => `<li><span>${user}</span><button class="btn tiny revoke-btn" data-cid="${data.cid}" data-user="${user}">Révoquer</button></li>`).join('')
                                : '<li>Aucun utilisateur autorisé.</li>'
                            }
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    `}).join('');
    // Note: Pas d'appel à attachAutocompleteListeners ici
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
    const listContainer = document.getElementById('managed-cids-list'); // Conteneur principal
    cidSearchInput?.addEventListener('input', (e) => {
         const searchTerm = e.target.value.toLowerCase().trim();
         const items = listContainer?.querySelectorAll('.cid-item');
         items?.forEach(item => {
             const cidName = item.dataset.cidName || ''; // data-cid-name est déjà en minuscules
             item.style.display = cidName.includes(searchTerm) ? '' : 'none';
         });
    });

    // --- Délégation pour la liste des CIDs gérés (#managed-cids-list) ---
    if (!listContainer) return; // Sécurité

    // --- Clics (Accordion, Boutons Révoquer) ---
    listContainer.addEventListener('click', async (e) => {
        const header = e.target.closest('.cid-header');
        const revokeButton = e.target.closest('.revoke-btn');
        const card = e.target.closest('.cid-item');
        const overlay = card?.querySelector('.card-loading-overlay');

        // Accordion toggle
        if (header && card) { card.classList.toggle('expanded'); return; }

        // Révoquer Utilisateur (utilise les fonctions MANAGER)
        if (revokeButton && card && overlay) {
            const { cid, user } = revokeButton.dataset;
            if (!confirm(`Révoquer l'accès de ${user} à ${cid} ?`)) return;
            revokeButton.disabled = true; overlay.classList.add('visible');
            try {
                const response = await fetch(MANAGER_REVOKE_ACCESS_URL, { // <<< URL MANAGER
                    method: 'POST', headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ cid, userToRevoke: user })
                });
                if (!response.ok) throw new Error(`Erreur ${response.status}: ${await response.text()}`);
                await loadManagedCIDs(); // Recharge la liste après succès
            } catch (error) {
                alert(`Erreur révocation : ${error.message}`);
                revokeButton.disabled = false; // Réactive en cas d'erreur
            } finally {
                 overlay.classList.remove('visible'); // Cache l'overlay
            }
        }
    });

    // --- Soumissions de Formulaires (Accorder) ---
    listContainer.addEventListener('submit', async (e) => {
        e.preventDefault();
        const grantFormUser = e.target.closest('.grant-form.user');
        const card = e.target.closest('.cid-item');
        const overlay = card?.querySelector('.card-loading-overlay');

        // Accorder Utilisateur (utilise les fonctions MANAGER)
        if (grantFormUser && card && overlay) {
            const { cid } = grantFormUser.dataset;
            const input = grantFormUser.querySelector('.grant-user-input');
            const userToGrant = input.value;
            const button = grantFormUser.querySelector('button[type="submit"]');
            if (!userToGrant || !userToGrant.includes('@')) { alert("Email utilisateur invalide."); return; }
            button.disabled = true; overlay.classList.add('visible');
            try {
                const response = await fetch(MANAGER_GRANT_ACCESS_URL, { // <<< URL MANAGER
                     method: 'POST', headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ cid, userToGrant })
                });
                if (!response.ok) throw new Error(`Erreur ${response.status}: ${await response.text()}`);
                input.value = ''; // Vide l'input
                await loadManagedCIDs(); // Recharge après succès
            } catch (error) {
                 alert(`Erreur accord accès : ${error.message}`);
                 button.disabled = false; // Réactive en cas d'erreur
            } finally {
                 overlay.classList.remove('visible'); // Cache l'overlay
            }
        }
    });

    // --- Filtres Locaux ---
    listContainer.addEventListener('input', (e) => {
        const filterInput = e.target.closest('.filter-list-input');
        if (filterInput) {
            const searchTerm = filterInput.value.toLowerCase().trim();
            const tabPanel = filterInput.closest('.tab-panel'); // Même si pas de tabs, structure conservée
            const list = tabPanel?.querySelector('.user-list'); // Manager n'a que la user-list
            list?.querySelectorAll('li').forEach(li => {
                if (li.children.length === 0 || !li.querySelector('span')) { li.style.display = ''; return; }
                const emailSpan = li.querySelector('span');
                const email = emailSpan?.textContent.toLowerCase() || '';
                li.style.display = email.includes(searchTerm) ? 'flex' : 'none'; // Utilise flex
            });
        }
    });
} // Fin initializeUIEventListeners