// manage.js

// ===============================================
// === CONFIGURATION
// ===============================================
const BASE_URL = "https://europe-west1-monkey-face-al.cloudfunctions.net";

const GET_MANAGED_CIDS_URL = `${BASE_URL}/getManagedCIDsAndUsers`;
const MANAGER_GRANT_ACCESS_URL = `${BASE_URL}/managerGrantAccess`;
const MANAGER_REVOKE_ACCESS_URL = `${BASE_URL}/managerRevokeAccess`;

// Global state
let idToken = null;
let userInfo = null;

// ===============================================
// === AUTHENTICATION & UTILS
// ===============================================

/**
 * Decodes the JWT token.
 */
function parseJwt(token) {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        return JSON.parse(atob(base64));
    } catch (e) {
        console.error("Failed to decode JWT", e);
        return null;
    }
}

/**
 * Updates the UI with logged-in user info.
 */
function updateUserInfoUI() {
    if (!userInfo) return;
    document.getElementById('user-avatar').src = userInfo.picture || '';
    document.getElementById('user-email').textContent = userInfo.email;
}

/**
 * Handles user sign out.
 */
function signOut() {
    google.accounts.id.disableAutoSelect();
    window.location.reload();
}

/**
 * Callback function after successful Google Sign-In.
 */
async function handleCredentialResponse(response) {
    idToken = response.credential;
    userInfo = parseJwt(idToken);

    if (!idToken || !userInfo) {
        alert("Error: Could not verify user information.");
        return;
    }

    document.getElementById('auth-container').style.display = 'none';
    document.getElementById('manage-panel').style.display = 'block';

    updateUserInfoUI();
    initializeUIEventListeners();

    // Load the CIDs managed by this user
    loadManagedCIDs();
}

// ===============================================
// === MANAGEMENT INTERFACE LOGIC
// ===============================================

/**
 * Fetches and displays the CIDs managed by the current user.
 */
async function loadManagedCIDs() {
    const listContainer = document.getElementById('managed-cids-list');
    listContainer.innerHTML = '<p>Chargement de vos CIDs...</p>';

    try {
        const response = await fetch(GET_MANAGED_CIDS_URL, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${idToken}` }
        });

        if (!response.ok) {
             // Handle case where user manages no CIDs gracefully
            if (response.status === 403 || response.status === 404) {
                 listContainer.innerHTML = '<p>Vous ne gérez actuellement aucun CID.</p>';
                 return;
            }
            throw new Error(`Server error: ${await response.text()}`);
        }

        const managedData = await response.json();
        renderManagedCIDs(managedData);

    } catch (error) {
        console.error("Error loading managed CIDs:", error);
        listContainer.innerHTML = '<p style="color: red;">Impossible de charger les CIDs que vous gérez.</p>';
    }
}

/**
 * Renders the list of managed CIDs and their users.
 */
function renderManagedCIDs(managedData) {
    const listContainer = document.getElementById('managed-cids-list');
    if (!managedData || managedData.length === 0) {
        listContainer.innerHTML = '<p>Vous ne gérez actuellement aucun CID.</p>';
        return;
    }

    // Sort CIDs alphabetically for consistency
    managedData.sort((a, b) => a.cid.localeCompare(b.cid));

    listContainer.innerHTML = managedData.map(data => `
        <div class="permission-item"> <div class="permission-header"><strong class="cid-name">${data.cid}</strong></div>
            <div class="permission-body">
                <ul class="user-list">
                    ${data.authorizedUsers.length > 0 ?
                        data.authorizedUsers.map(user => `
                            <li>
                                <span>${user}</span>
                                <button class="btn tiny revoke-btn" data-cid="${data.cid}" data-user="${user}">Révoquer</button>
                            </li>`).join('')
                        : '<li>Aucun utilisateur autorisé pour ce CID.</li>'
                    }
                </ul>
                <form class="grant-form" data-cid="${data.cid}">
                    <input type="email" class="grant-user-input" placeholder="email.utilisateur@domaine.com" required>
                    <button type="submit" class="btn tiny">Accorder</button>
                </form>
            </div>
        </div>
    `).join('');
    // Note: Autocomplete is not added here for simplicity, but could be added later
}

/**
 * Initializes all UI event listeners once after login.
 */
function initializeUIEventListeners() {
    // Profile menu and sign out
    const profileBtn = document.getElementById('user-profile-btn');
    const dropdown = document.getElementById('logout-dropdown');
    profileBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('visible');
    });
    document.getElementById('logout-btn').addEventListener('click', signOut);
    document.addEventListener('click', () => {
        if (dropdown.classList.contains('visible')) {
            dropdown.classList.remove('visible');
        }
    });

    // Event delegation for the managed CIDs list
    const managedList = document.getElementById('managed-cids-list');

    // Handle "Revoke" button clicks
    managedList.addEventListener('click', async (e) => {
        const revokeButton = e.target.closest('.revoke-btn');
        if (revokeButton) {
            const { cid, user } = revokeButton.dataset;
            if (!confirm(`Voulez-vous vraiment révoquer l'accès de ${user} au CID ${cid} ?`)) return;

            revokeButton.disabled = true;
            try {
                const response = await fetch(MANAGER_REVOKE_ACCESS_URL, { // Use MANAGER URL
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cid: cid, userToRevoke: user })
                });
                if (!response.ok) throw new Error(await response.text());
                await loadManagedCIDs(); // Refresh the list of managed CIDs
            } catch (error) {
                alert(`Erreur lors de la révocation : ${error.message}`);
                revokeButton.disabled = false;
            }
        }
    });

    // Handle "Grant" form submissions
    managedList.addEventListener('submit', async (e) => {
        const grantForm = e.target.closest('.grant-form');
        if (grantForm) {
            e.preventDefault();
            const { cid } = grantForm.dataset;
            const input = grantForm.querySelector('.grant-user-input');
            const userToGrant = input.value;
            const button = grantForm.querySelector('button[type="submit"]');

            if (!userToGrant || !userToGrant.includes('@')) {
                alert("Veuillez entrer une adresse e-mail valide.");
                return;
            }

            button.disabled = true;
            try {
                const response = await fetch(MANAGER_GRANT_ACCESS_URL, { // Use MANAGER URL
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cid: cid, userToGrant: userToGrant })
                });
                if (!response.ok) throw new Error(await response.text());
                input.value = '';
                await loadManagedCIDs(); // Refresh the list of managed CIDs
            } catch (error) {
                alert(`Erreur pour accorder l'accès : ${error.message}`);
            } finally {
                button.disabled = false;
            }
        }
    });
}