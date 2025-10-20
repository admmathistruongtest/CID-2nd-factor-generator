// manage.js

// ===============================================
// === CONFIGURATION & VARIABLES GLOBALES
// ===============================================
const BASE_URL = "https://europe-west1-monkey-face-al.cloudfunctions.net";

// URLs des fonctions Cloud (Manager)
const GET_MANAGED_CIDS_URL = `${BASE_URL}/getManagedCIDsAndUsers`;
const MANAGER_GRANT_ACCESS_URL = `${BASE_URL}/managerGrantAccess`;
const MANAGER_REVOKE_ACCESS_URL = `${BASE_URL}/managerRevokeAccess`;
// Note: Pas d'accès aux fonctions admin depuis l'interface manager

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
        // Make sure login screen stays visible
        document.getElementById('auth-container').style.display = 'block';
        document.getElementById('manage-panel').style.display = 'none';
        return;
    }
    // Hide login, show panel
    document.getElementById('auth-container').style.display = 'none';
    document.getElementById('manage-panel').style.display = 'block';

    updateUserInfoUI();
    initializeUIEventListeners(); // Attach listeners AFTER panel is visible

    // Load initial data
    await loadManagedCIDs();
}

// ===============================================
// === CHARGEMENT DES DONNÉES (FETCH)
// ===============================================

/**
 * Charge et affiche les CIDs gérés par le manager connecté.
 */
async function loadManagedCIDs() {
    const listContainer = document.getElementById('managed-cids-list');
    if (!listContainer) return; // Safety check
    listContainer.innerHTML = '<p>Chargement de vos CIDs...</p>';
    try {
        const response = await fetch(GET_MANAGED_CIDS_URL, {
            method: 'GET', headers: { 'Authorization': `Bearer ${idToken}` }
        });
        // Handle empty list/errors more robustly
        if (response.status === 200) {
            const managedData = await response.json();
            renderManagedCIDs(managedData); // Pass data to render function
        } else if (response.status === 403 || response.status === 404) {
             listContainer.innerHTML = '<p>Vous ne gérez actuellement aucun CID ou une erreur est survenue lors de la vérification.</p>';
        } else {
             throw new Error(`Erreur serveur (${response.status}): ${await response.text()}`);
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
 * Génère le HTML pour la liste des CIDs gérés (Accordion, PAS de tabs, formulaires en haut).
 */
function renderManagedCIDs(managedData) {
    const listContainer = document.getElementById('managed-cids-list');
    if (!listContainer) return; // Safety check

    if (!managedData || managedData.length === 0) {
        listContainer.innerHTML = '<p>Vous ne gérez actuellement aucun CID.</p>';
        return;
    }
    managedData.sort((a, b) => a.cid.localeCompare(b.cid));
    listContainer.innerHTML = managedData.map(data => {
        const cidSafeId = data.cid.replace(/[^a-zA-Z0-9]/g, ''); // Safe ID for HTML elements
        return `
        <div class="cid-item" data-cid-name="${data.cid.toLowerCase()}"> {/* data-cid-name for global search */}
            <div class="card-loading-overlay"></div>
            <div class="cid-header">
                <strong class="cid-name">${data.cid}</strong>
                <span class="expand-icon"></span>
            </div>
            <div class="cid-content">
                {/* Manager only sees the Users section */}
                <div id="users-${cidSafeId}" class="tab-panel active"> {/* Use tab-panel class for styling, active by default */}
                    <div class="permission-section">
                        {/* Grant form moved to the top */}
                        <form class="grant-form user" data-cid="${data.cid}" style="margin-bottom: 20px;">
                            {/* No autocomplete for manager for simplicity */}
                            <input type="email" class="grant-user-input" placeholder="Ajouter un utilisateur..." required>
                            <button type="submit" class="btn tiny">Accorder</button>
                        </form>
                        {/* Local filter input */}
                        <input type="search" class="filter-list-input" placeholder="Filtrer utilisateurs..." style="width: 100%; margin-bottom: 10px;">
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
}

// ===============================================
// === GESTIONNAIRES D'ÉVÉNEMENTS (Listeners)
// ===============================================

/**
 * Initialise TOUS les écouteurs d'événements après la connexion.
 */
function initializeUIEventListeners() {
    // --- Menu profil & déconnexion ---
    document.getElementById('user-profile-btn')?.addEventListener('click', (e) => {
        e.stopPropagation(); document.getElementById('logout-dropdown')?.classList.toggle('visible');
    });
    document.getElementById('logout-btn')?.addEventListener('click', signOut);
    document.addEventListener('click', () => { // Close dropdown on click outside
        document.getElementById('logout-dropdown')?.classList.remove('visible');
    });

    // --- Recherche globale CID ---
    const cidSearchInput = document.getElementById('cid-search-input'); // Ensure this ID exists in manage.html
    const listContainer = document.getElementById('managed-cids-list');
    cidSearchInput?.addEventListener('input', (e) => {
         const searchTerm = e.target.value.toLowerCase().trim();
         const items = listContainer?.querySelectorAll('.cid-item');
         items?.forEach(item => {
             const cidName = item.dataset.cidName || '';
             item.style.display = cidName.includes(searchTerm) ? '' : 'none';
         });
    });

    // --- Délégation pour la liste des CIDs gérés ---
    if (!listContainer) {
        console.error("Element #managed-cids-list not found!");
        return; // Stop if the main container isn't found
    }

    // --- Clics (Accordion, Boutons Révoquer) ---
    listContainer.addEventListener('click', async (e) => {
        const header = e.target.closest('.cid-header');
        const revokeButton = e.target.closest('.revoke-btn');
        const card = e.target.closest('.cid-item');
        const overlay = card?.querySelector('.card-loading-overlay');

        // Accordion toggle
        if (header && card) { card.classList.toggle('expanded'); return; }

        // Révoquer Utilisateur (uses MANAGER functions)
        if (revokeButton && card && overlay) {
            const { cid, user } = revokeButton.dataset;
            if (!confirm(`Révoquer l'accès de ${user} à ${cid} ?`)) return;
            revokeButton.disabled = true; overlay.classList.add('visible');
            try {
                const response = await fetch(MANAGER_REVOKE_ACCESS_URL, { // <<< MANAGER URL
                    method: 'POST', headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ cid, userToRevoke: user })
                });
                if (!response.ok) throw new Error(`Erreur ${response.status}: ${await response.text()}`);
                // Refresh list only on success
                await loadManagedCIDs();
            } catch (error) {
                alert(`Erreur révocation : ${error.message}`);
                revokeButton.disabled = false; // Re-enable button on error
                overlay.classList.remove('visible'); // Hide overlay on error
            }
            // No finally needed here as loadManagedCIDs refreshes the whole list anyway
        }
    });

    // --- Soumissions de Formulaires (Accorder) ---
    listContainer.addEventListener('submit', async (e) => {
        e.preventDefault(); // Prevent default form submission for ALL forms in the list
        const grantFormUser = e.target.closest('.grant-form.user');
        const card = e.target.closest('.cid-item');
        const overlay = card?.querySelector('.card-loading-overlay');

        // Accorder Utilisateur (uses MANAGER functions)
        if (grantFormUser && card && overlay) {
            const { cid } = grantFormUser.dataset;
            const input = grantFormUser.querySelector('.grant-user-input');
            const userToGrant = input.value;
            const button = grantFormUser.querySelector('button[type="submit"]');
            if (!userToGrant || !userToGrant.includes('@')) { alert("Email utilisateur invalide."); return; }

            button.disabled = true; overlay.classList.add('visible');
            try {
                const response = await fetch(MANAGER_GRANT_ACCESS_URL, { // <<< MANAGER URL
                     method: 'POST', headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ cid, userToGrant })
                });
                if (!response.ok) throw new Error(`Erreur ${response.status}: ${await response.text()}`);
                input.value = ''; // Clear input on success
                // Refresh list only on success
                 await loadManagedCIDs();
            } catch (error) {
                 alert(`Erreur accord accès : ${error.message}`);
                 button.disabled = false; // Re-enable button on error
                 overlay.classList.remove('visible'); // Hide overlay on error
            }
            // No finally needed here
        }
    });

    // --- Filtres Locaux ---
    listContainer.addEventListener('input', (e) => {
        const filterInput = e.target.closest('.filter-list-input');
        if (filterInput) {
            const searchTerm = filterInput.value.toLowerCase().trim();
            const tabPanel = filterInput.closest('.tab-panel');
            const list = tabPanel?.querySelector('.user-list'); // Manager only has user-list
            list?.querySelectorAll('li').forEach(li => {
                if (li.children.length === 0 || !li.querySelector('span')) { li.style.display = ''; return; }
                const emailSpan = li.querySelector('span');
                const email = emailSpan?.textContent.toLowerCase() || '';
                li.style.display = email.includes(searchTerm) ? 'flex' : 'none';
            });
        }
    });
}