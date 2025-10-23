// =======================================================
// === CONFIGURATION & VARIABLES GLOBALES
// =======================================================
const GET_CIDS_URL = "https://europe-west1-monkey-face-al.cloudfunctions.net/getUserCIDs";
const GET_TOKENS_URL = "https://europe-west1-monkey-face-al.cloudfunctions.net/getNext10Tokens";
const USER_GRANT_URL = "https://europe-west1-monkey-face-al.cloudfunctions.net/userGrantAccess";
const USER_REVOKE_URL = "https://europe-west1-monkey-face-al.cloudfunctions.net/userRevokeAccess";
const GET_CID_USERS_URL = "https://europe-west1-monkey-face-al.cloudfunctions.net/getCidUsers"; // mini backend en bas

let idToken = null;
let userInfo = null;
let loadedCIDS = {};
const OPEN_HEIGHT = "60px";

// =======================================================
// === AUTHENTIFICATION
// =======================================================
function parseJwt(token) {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(c =>
            '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
        ).join(''));
        return JSON.parse(jsonPayload);
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
    idToken = null;
    userInfo = null;
    loadedCIDS = {};
    document.getElementById('cid-list').innerHTML = '';
    document.getElementById('app-container').style.display = 'none';
    document.getElementById('auth-container').style.display = 'block';
    console.log("Utilisateur déconnecté.");
}

async function handleCredentialResponse(response) {
    console.log("Connexion Google réussie. Jeton reçu.");
    idToken = response.credential;
    userInfo = parseJwt(idToken);

    if (!idToken || !userInfo) {
        console.error("Le jeton est vide ou invalide !");
        alert("Erreur de connexion. Réessayez.");
        return;
    }

    document.getElementById('auth-container').style.display = 'none';
    document.getElementById('app-container').style.display = 'block';

    updateUserInfoUI();
    await loadUserCids();
}

// =======================================================
// === CHARGEMENT DES CIDs
// =======================================================
async function loadUserCids() {
    if (!idToken) return console.error("idToken manquant.");

    const listElement = document.getElementById('cid-list');
    listElement.innerHTML = `<li>Chargement des CIDs...</li>`;

    try {
        const response = await fetch(GET_CIDS_URL, {
            headers: { 'Authorization': `Bearer ${idToken}` }
        });

        if (!response.ok) throw new Error(await response.text());

        const cids = await response.json();
        renderCidList(cids);
    } catch (error) {
        console.error("Erreur de chargement des CIDs:", error);
        listElement.innerHTML = `<li>Erreur de chargement.</li>`;
    }
}

// =======================================================
// === AFFICHAGE DES CARTES CID
// =======================================================
function renderCidList(cids) {
    const listElement = document.getElementById('cid-list');
    if (!listElement) return;

    if (!cids || cids.length === 0) {
        listElement.innerHTML = `<li>Aucun CID ne vous est attribué.</li>`;
        return;
    }

    listElement.innerHTML = cids.map(cid => `
        <li class="cidElement" data-id="${cid}">
            <div class="title">
                <span class="label">${cid}</span>

                <div class="cid-actions">
                    <button class="icon-btn js-users" title="Utilisateurs" data-id="${cid}">
                        <span class="material-symbols-outlined">group</span>
                    </button>

                    <button class="btn tiny js-toggle" data-id="${cid}" aria-expanded="false">Show code</button>
                </div>
            </div>

            <!-- panneau code -->
            <div class="token" id="${cid}">
                <div class="token-content">
                    <div id="${cid}-counter" class="displayCounter">- loading -</div>
                    <progress-ring id="${cid}-wheel" class="wheel" stroke="4" radius="20" progress="0" color="whitesmoke"></progress-ring>
                </div>
                <button class="btn tiny copy-btn" data-target-id="${cid}-counter" title="Copier le code">
                    <span class="material-symbols-outlined" style="font-size: 16px;">content_copy</span> Copy
                </button>
            </div>

            <!-- panneau utilisateurs -->
            <div class="user-panel" id="users-${cid}">
                <div class="panel-row">
                    <input id="add-${cid}" type="email" class="panel-input" placeholder="Ajouter un utilisateur (email)" />
                    <button class="btn tiny ghost js-add" data-id="${cid}">
                        <span class="material-symbols-outlined" style="font-size:16px;">person_add</span> Ajouter
                    </button>
                </div>

                <div class="status" id="status-${cid}"></div>
                <ul class="user-list" id="list-${cid}">
                    <li><span class="email" style="color:var(--muted)">Chargement...</span></li>
                </ul>
            </div>
        </li>
    `).join('');
}


// =======================================================
// === TOTP / TOKENS
// =======================================================
async function fetchAndDisplayTokens(cid) {
    if (loadedCIDS[cid]) return updateTokenDisplay(cid);

    const tokenContainer = document.getElementById(cid);
    if (!tokenContainer) return;
    const counterDisplay = tokenContainer.querySelector('.displayCounter');
    counterDisplay.textContent = "- loading -";

    try {
        const response = await fetch(GET_TOKENS_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({ cid })
        });

        if (!response.ok) throw new Error(await response.text());
        const tokens = await response.json();
        loadedCIDS[cid] = tokens;

        if (!tokenContainer.dataset.intervalId) {
            const intervalId = setInterval(updateTokenDisplay, 1000, cid);
            tokenContainer.dataset.intervalId = intervalId;
        }

        updateTokenDisplay(cid);

    } catch (error) {
        console.error(`Erreur pour ${cid}:`, error);
        counterDisplay.textContent = "- error -";
    }
}

function updateTokenDisplay(cid) {
    const tokens = loadedCIDS[cid];
    const tokenContainer = document.getElementById(cid);
    if (!tokens || !tokenContainer) return;

    const counterDisplay = tokenContainer.querySelector('.displayCounter');
    const wheel = tokenContainer.querySelector('.wheel');
    const now = Date.now();
    const step = 30000;
    const currentToken = tokens.find(t => now >= t.timestamp && now < t.timestamp + step);

    if (currentToken) {
        counterDisplay.textContent = currentToken.token;
        const timeElapsed = now - currentToken.timestamp;
        const percentLeft = 100 - (timeElapsed / step * 100);
        wheel.setProgress(percentLeft);
    } else {
        counterDisplay.textContent = "- exhausted -";
        wheel.setProgress(0);
    }
}

async function loadCidUsers(cid) {
    const list = document.getElementById(`list-${cid}`);
    const status = document.getElementById(`status-${cid}`);
    if (!list || !status) return;

    list.innerHTML = `<li><span class="email" style="color:var(--muted)">Chargement...</span></li>`;
    status.textContent = "";

    try {
        const url = `${GET_CID_USERS_URL}?cid=${encodeURIComponent(cid)}`;
        const resp = await fetch(url, {
            headers: { 'Authorization': `Bearer ${idToken}` }
        });
        if (!resp.ok) throw new Error(await resp.text());

        const users = await resp.json(); // ex: ["a@x", "b@y"]
        if (!Array.isArray(users) || users.length === 0) {
            list.innerHTML = `<li><span class="email" style="color:var(--muted)">Aucun utilisateur.</span></li>`;
            return;
        }

        list.innerHTML = users.map(u => `
            <li>
                <span class="email">${u}</span>
                <button class="revoke js-revoke" data-id="${cid}" data-user="${u}">
                    Retirer
                </button>
            </li>
        `).join('');

    } catch (e) {
        list.innerHTML = `<li><span class="email" style="color:var(--red-error)">Erreur chargement utilisateurs.</span></li>`;
        console.error("loadCidUsers:", e);
    }
}

async function addUserToCid(cid) {
    const input = document.getElementById(`add-${cid}`);
    const status = document.getElementById(`status-${cid}`);
    if (!input || !status) return;

    const email = input.value.trim();
    if (!email || !email.includes('@')) {
        status.textContent = "Email invalide.";
        return;
    }
    status.textContent = "Ajout en cours...";

    try {
        const resp = await fetch(USER_GRANT_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${idToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ cid, userToGrant: email })
        });
        if (!resp.ok) throw new Error(await resp.text());

        status.textContent = `✅ ${email} ajouté.`;
        input.value = "";
        await loadCidUsers(cid);

    } catch (e) {
        status.textContent = `❌ ${e.message || 'Erreur'}`;
        console.error("addUserToCid:", e);
    }
}

async function revokeUserFromCid(cid, email) {
    const status = document.getElementById(`status-${cid}`);
    if (!status) return;
    status.textContent = "Révocation en cours...";

    try {
        const resp = await fetch(USER_REVOKE_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${idToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ cid, userToRevoke: email })
        });
        if (!resp.ok) throw new Error(await resp.text());

        status.textContent = `✅ ${email} retiré.`;
        await loadCidUsers(cid);

    } catch (e) {
        status.textContent = `❌ ${e.message || 'Erreur'}`;
        console.error("revokeUserFromCid:", e);
    }
}


// =======================================================
// === AJOUT D'UTILISATEUR SUR UN CID
// =======================================================
async function handleAddUser(cid) {
    const emailInput = document.getElementById(`add-user-${cid}`);
    const resultElement = document.getElementById(`add-result-${cid}`);
    const newUserEmail = emailInput.value.trim();

    if (!newUserEmail) return alert("Veuillez entrer un email.");
    resultElement.textContent = "Ajout en cours...";

    try {
        const response = await fetch(USER_GRANT_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({ cid, userToGrant: newUserEmail })
        });

        if (response.ok) {
            resultElement.textContent = `✅ ${newUserEmail} ajouté à ${cid}`;
            emailInput.value = "";
        } else {
            const errText = await response.text();
            resultElement.textContent = `❌ Erreur : ${errText}`;
        }
    } catch (error) {
        console.error("Erreur d’ajout utilisateur:", error);
        resultElement.textContent = "❌ Erreur réseau.";
    }
}

// =======================================================
// === UI INTERACTIONS
// =======================================================
function openToken(cid) {
    const el = document.getElementById(cid);
    if (el) el.style.height = OPEN_HEIGHT;
    const btn = document.querySelector(`.js-toggle[data-id="${CSS.escape(cid)}"]`);
    if (btn) { btn.setAttribute('aria-expanded', 'true'); btn.textContent = 'Hide'; }
}

function closeToken(cid) {
    const el = document.getElementById(cid);
    if (el) el.style.height = "0px";
    const btn = document.querySelector(`.js-toggle[data-id="${CSS.escape(cid)}"]`);
    if (btn) { btn.setAttribute('aria-expanded', 'false'); btn.textContent = 'Show code'; }
}

// =======================================================
// === INIT EVENT LISTENERS
// =======================================================
function initializeUI() {
    // Recherche
    document.getElementById('search-input')?.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase().trim();
        document.querySelectorAll('.cidElement').forEach(li => {
            const email = li.dataset.id.toLowerCase();
            li.style.display = email.includes(term) ? '' : 'none';
        });
    });

    // Profil / logout
    document.getElementById('user-profile-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('logout-dropdown')?.classList.toggle('visible');
    });
    document.getElementById('logout-btn')?.addEventListener('click', signOut);
    document.addEventListener('click', () => {
        document.getElementById('logout-dropdown')?.classList.remove('visible');
    });

    // Délégation sur la liste
    document.getElementById('cid-list')?.addEventListener('click', (e) => {
        const toggleBtn = e.target.closest('.js-toggle');
        const copyBtn = e.target.closest('.copy-btn');
        const usersBtn = e.target.closest('.js-users');
        const addBtn = e.target.closest('.js-add');
        const revokeBtn = e.target.closest('.js-revoke');

        // Code TOTP : open/close
        if (toggleBtn) {
            const cid = toggleBtn.dataset.id;
            const isOpen = toggleBtn.getAttribute('aria-expanded') === 'true';
            if (isOpen) closeToken(cid);
            else { openToken(cid); fetchAndDisplayTokens(cid); }
            return;
        }

        // Copier code
        if (copyBtn) {
            const targetId = copyBtn.dataset.targetId;
            copyTokenToClipboard(targetId, copyBtn);
            return;
        }

        // Ouvrir/fermer panneau utilisateurs + charger la liste
        if (usersBtn) {
            const cid = usersBtn.dataset.id;
            const panel = document.getElementById(`users-${cid}`);
            if (!panel) return;
            const isOpen = panel.classList.contains('open');
            document.querySelectorAll('.user-panel').forEach(p => p.classList.remove('open'));
            if (!isOpen) {
                panel.classList.add('open');
                loadCidUsers(cid);
            }
            return;
        }

        // Ajouter un utilisateur
        if (addBtn) {
            const cid = addBtn.dataset.id;
            addUserToCid(cid);
            return;
        }

        // Révoquer un utilisateur
        if (revokeBtn) {
            const cid = revokeBtn.dataset.id;
            const email = revokeBtn.dataset.user;
            if (confirm(`Retirer ${email} de ${cid} ?`)) {
                revokeUserFromCid(cid, email);
            }
            return;
        }
    });
}

document.addEventListener('DOMContentLoaded', initializeUI);

// =======================================================
// === PROGRESS RING COMPONENT
// =======================================================
class ProgressRing extends HTMLElement {
    constructor() {
        super();
        const stroke = this.getAttribute('stroke') || 4;
        const radius = this.getAttribute('radius') || 20;
        const color = this.getAttribute('color') || 'whitesmoke';
        const normalizedRadius = radius - stroke * 2;
        this._circumference = normalizedRadius * 2 * Math.PI;

        this._root = this.attachShadow({ mode: 'open' });
        this._root.innerHTML = `
            <svg height="${radius * 2}" width="${radius * 2}">
                <circle
                    stroke="${color}"
                    stroke-dasharray="${this._circumference} ${this._circumference}"
                    style="stroke-dashoffset:${this._circumference}"
                    stroke-width="${stroke}"
                    fill="transparent"
                    r="${normalizedRadius}"
                    cx="${radius}"
                    cy="${radius}"
                />
            </svg>
            <style>
                circle {
                    transition: stroke-dashoffset 0.35s linear;
                    transform: rotate(-90deg) scaleX(-1);
                    transform-origin: 50% 50%;
                }
            </style>
        `;
    }

    setProgress(percent) {
        const clamped = Math.max(0, Math.min(100, percent));
        const offset = this._circumference - (clamped / 100 * this._circumference);
        const circle = this._root.querySelector('circle');
        if (circle) circle.style.strokeDashoffset = offset;
    }
}
window.customElements.define('progress-ring', ProgressRing);