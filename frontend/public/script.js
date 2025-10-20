// Fichier: script.js

// =======================================================
// === CONFIGURATION & VARIABLES GLOBALES
// =======================================================
const GET_CIDS_URL = "https://europe-west1-monkey-face-al.cloudfunctions.net/getUserCIDs";
const GET_TOKENS_URL = "https://europe-west1-monkey-face-al.cloudfunctions.net/getNext10Tokens";

let idToken = null;
let userInfo = null;
let loadedCIDS = {}; // Stocke les tokens chargés pour chaque CID
const OPEN_HEIGHT = "60px"; // Hauteur du panneau de token ouvert

// =======================================================
// === AUTHENTIFICATION & GESTION UTILISATEUR
// =======================================================

/**
 * Décode le token JWT pour obtenir les informations de l'utilisateur.
 */
function parseJwt(token) {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(jsonPayload);
    } catch (e) {
        console.error("Impossible de décoder le JWT", e);
        return null;
    }
}

/**
 * Met à jour l'interface avec les informations de l'utilisateur connecté.
 */
function updateUserInfoUI() {
    if (!userInfo) return;
    document.getElementById('user-avatar').src = userInfo.picture || ''; // Utilise l'avatar Google
    document.getElementById('user-email').textContent = userInfo.email; // Affiche l'email
}

/**
 * Gère la déconnexion de l'utilisateur.
 */
function signOut() {
    google.accounts.id.disableAutoSelect(); // Informe Google de la déconnexion
    // Réinitialise l'état
    idToken = null;
    userInfo = null;
    loadedCIDS = {};
    document.getElementById('cid-list').innerHTML = '';
    // Affiche l'écran de connexion
    document.getElementById('app-container').style.display = 'none';
    document.getElementById('auth-container').style.display = 'block';
    console.log("Utilisateur déconnecté.");
}

/**
 * Fonction appelée par Google après une connexion réussie. Point d'entrée principal.
 */
async function handleCredentialResponse(response) {
    console.log("Connexion Google réussie. Jeton reçu.");
    idToken = response.credential;
    userInfo = parseJwt(idToken);

    if (!idToken || !userInfo) {
        console.error("Le jeton d'identification est vide ou invalide !");
        alert("Erreur lors de la connexion. Veuillez réessayer.");
        return;
    }

    // Affiche l'application principale
    document.getElementById('auth-container').style.display = 'none';
    document.getElementById('app-container').style.display = 'block';

    updateUserInfoUI(); // Met à jour le menu utilisateur
    await loadUserCids(); // Charge les CIDs de l'utilisateur
}

// =======================================================
// === CHARGEMENT & AFFICHAGE DES DONNÉES
// =======================================================

/**
 * Appelle la Cloud Function pour récupérer la liste des CIDs accessibles par l'utilisateur.
 */
async function loadUserCids() {
    if (!idToken) {
        return console.error("Impossible de charger les CIDs : idToken est manquant.");
    }

    const listElement = document.getElementById('cid-list');
    listElement.innerHTML = `<li>Chargement des CIDs...</li>`;

    console.log("Tentative d'appel à GET_CIDS_URL avec le jeton.");
    try {
        const response = await fetch(GET_CIDS_URL, {
            headers: { 'Authorization': `Bearer ${idToken}` }
        });

        if (!response.ok) {
            throw new Error(`Erreur serveur ${response.status}: ${await response.text()}`);
        }

        const cids = await response.json();
        renderCidList(cids); // Affiche la liste des CIDs reçus

    } catch (error) {
        console.error("Erreur de chargement des CIDs:", error);
        listElement.innerHTML = `<li>Erreur de chargement des CIDs. Vérifiez la console.</li>`;
    }
}

/**
 * Crée le code HTML pour la liste des CIDs.
 */
function renderCidList(cids) {
    const listElement = document.getElementById('cid-list');
    if (!listElement) return;

    if (!cids || cids.length === 0) {
        listElement.innerHTML = `<li>Aucun CID ne vous est attribué.</li>`;
        return;
    }

    // Génère un élément <li> pour chaque CID
    listElement.innerHTML = cids.map(email => `
        <li class="cidElement" data-id="${email}">
            <div class="title">
                <span class="label">${email}</span>
                <button class="btn tiny js-toggle" data-id="${email}" aria-expanded="false">Show code</button>
            </div>
            <div class="token" id="${email}">
                <div class="token-content">
                    <div id="${email}-counter" class="displayCounter">- loading -</div>
                    <progress-ring id="${email}-wheel" class="wheel" stroke="4" radius="20" progress="0" color="whitesmoke"></progress-ring>
                </div>
                <button class="btn tiny copy-btn" data-target-id="${email}-counter" title="Copier le code">
                    <span class="material-symbols-outlined" style="font-size: 16px;">content_copy</span> Copy
                </button>
            </div>
        </li>
    `).join('');
}

/**
 * Appelle la Cloud Function pour obtenir les tokens pour un CID spécifique (chargement à la demande).
 */
async function fetchAndDisplayTokens(cidAccount) {
    // Si les tokens sont déjà chargés, on met juste à jour l'affichage
    if (loadedCIDS[cidAccount]) {
        updateTokenDisplay(cidAccount); // Assure que l'affichage est correct
        return;
    }

    const tokenContainer = document.getElementById(cidAccount);
    if (!tokenContainer) return;
    const counterDisplay = tokenContainer.querySelector('.displayCounter');
    counterDisplay.textContent = "- loading -"; // Affiche pendant le chargement

    try {
        const response = await fetch(GET_TOKENS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
            body: JSON.stringify({ cid: cidAccount })
        });

        if (!response.ok) throw new Error(await response.text());

        const tokens = await response.json();
        loadedCIDS[cidAccount] = tokens; // Stocke les tokens chargés

        // Lance la mise à jour de l'affichage toutes les secondes
        if (!tokenContainer.dataset.intervalId) {
            const intervalId = setInterval(updateTokenDisplay, 1000, cidAccount);
            tokenContainer.dataset.intervalId = intervalId;
        }

        updateTokenDisplay(cidAccount); // Affiche le token immédiatement

    } catch (error) {
        console.error(`Échec de la récupération des tokens pour ${cidAccount}:`, error);
        if (counterDisplay) counterDisplay.textContent = "- error -";
        // Nettoie l'intervalle en cas d'erreur
        const existingIntervalId = tokenContainer.dataset.intervalId;
        if (existingIntervalId) {
            clearInterval(existingIntervalId);
            delete tokenContainer.dataset.intervalId;
        }
    }
}

/**
 * Met à jour l'affichage du token et de l'anneau de progression toutes les secondes.
 */
function updateTokenDisplay(cidAccount) {
    const tokens = loadedCIDS[cidAccount];
    const tokenContainer = document.getElementById(cidAccount);
    if (!tokens || !tokenContainer) return; // Ne fait rien si les tokens ne sont pas chargés

    const counterDisplay = tokenContainer.querySelector('.displayCounter');
    const wheel = tokenContainer.querySelector('.wheel');
    if (!counterDisplay || !wheel) return;

    const now = Date.now();
    const step = 30000; // 30 secondes en millisecondes

    // Trouve le token valide pour le moment actuel
    const currentToken = tokens.find(t => now >= t.timestamp && now < t.timestamp + step);

    if (currentToken) {
        counterDisplay.textContent = currentToken.token;
        const timeElapsed = now - currentToken.timestamp;
        const percentLeft = 100 - (timeElapsed / step * 100);
        wheel.setProgress(percentLeft); // Met à jour le cercle
    } else {
        counterDisplay.textContent = "- exhausted -"; // Affiche si aucun token n'est valide
        wheel.setProgress(0);
        // On pourrait ajouter une logique pour recharger les tokens ici si nécessaire
    }
}

// =======================================================
// === FONCTIONS D'INTERACTION UI (helpers)
// =======================================================

/**
 * Ouvre le panneau d'affichage du token pour un CID.
 */
function openToken(email) {
    const el = document.getElementById(email);
    if (el) el.style.height = OPEN_HEIGHT;
    const btn = document.querySelector(`.js-toggle[data-id="${CSS.escape(email)}"]`);
    if (btn) { btn.setAttribute('aria-expanded', 'true'); btn.textContent = 'Hide'; }
}

/**
 * Ferme le panneau d'affichage du token pour un CID.
 */
function closeToken(email) {
    const el = document.getElementById(email);
    if (el) el.style.height = "0px";
    const btn = document.querySelector(`.js-toggle[data-id="${CSS.escape(email)}"]`);
    if (btn) { btn.setAttribute('aria-expanded', 'false'); btn.textContent = 'Show code'; }
}

/**
 * Copie le contenu d'un élément dans le presse-papiers.
 */
function copyTokenToClipboard(targetId, button) {
    const targetElement = document.getElementById(targetId);
    if (!targetElement || !targetElement.textContent || targetElement.textContent.startsWith('-')) return; // Ne copie pas les états "loading", "error", "exhausted"

    navigator.clipboard.writeText(targetElement.textContent.trim())
        .then(() => {
            const originalText = button.innerHTML;
            button.innerHTML = '<span class="material-symbols-outlined" style="font-size: 16px;">done</span> Copied!';
            button.classList.add('copied'); // Pour un style CSS optionnel
            setTimeout(() => {
                button.innerHTML = originalText;
                button.classList.remove('copied');
            }, 2000);
        })
        .catch(err => {
            console.error('Erreur lors de la copie:', err);
            // Utiliser une notification non bloquante au lieu d'alert() si possible
            alert("Impossible de copier. Vérifiez les permissions du navigateur.");
        });
}

// =======================================================
// === INITIALISATION DES ÉCOUTEURS D'ÉVÉNEMENTS
// =======================================================

/**
 * Initialise tous les écouteurs d'événements après le chargement du DOM.
 */
function initializeUI() {
    // Barre de recherche
    document.getElementById('search')?.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase().trim();
        document.querySelectorAll('.cidElement').forEach(li => {
            const email = li.dataset.id.toLowerCase();
            li.style.display = email.includes(term) ? '' : 'none';
        });
    });

    // Menu profil et déconnexion
    document.getElementById('user-profile-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('logout-dropdown')?.classList.toggle('visible');
    });
    document.getElementById('logout-btn')?.addEventListener('click', signOut);
    document.addEventListener('click', () => { // Ferme le dropdown si clic ailleurs
        document.getElementById('logout-dropdown')?.classList.remove('visible');
    });

    // Clics dans la liste des CIDs (Show/Hide/Copy)
    document.getElementById('cid-list')?.addEventListener('click', (e) => {
        const toggleBtn = e.target.closest('.js-toggle');
        const copyBtn = e.target.closest('.copy-btn');

        // Clic sur "Show code" / "Hide"
        if (toggleBtn) {
            const email = toggleBtn.dataset.id;
            const isOpen = toggleBtn.getAttribute('aria-expanded') === 'true';
            if (isOpen) {
                closeToken(email);
            } else {
                openToken(email);
                fetchAndDisplayTokens(email); // Charge les tokens seulement à l'ouverture
            }
            return;
        }

        // Clic sur "Copy"
        if (copyBtn) {
            const targetId = copyBtn.dataset.targetId;
            copyTokenToClipboard(targetId, copyBtn);
            return;
        }
    });
}

// Lance l'initialisation quand le DOM est prêt
document.addEventListener('DOMContentLoaded', initializeUI);

// =======================================================
// === COMPOSANT WEB ProgressRing (pour le cercle)
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
                    transition: stroke-dashoffset 0.35s linear; /* Utiliser linear pour une transition fluide */
                    transform: rotate(-90deg) scaleX(-1); /* Rotation horaire */
                    transform-origin: 50% 50%;
                }
            </style>
        `;
    }

    setProgress(percent) {
        // Assure que le pourcentage est entre 0 et 100
        const clampedPercent = Math.max(0, Math.min(100, percent));
        const offset = this._circumference - (clampedPercent / 100 * this._circumference);
        const circle = this._root.querySelector('circle');
        if (circle) circle.style.strokeDashoffset = offset;
    }

    static get observedAttributes() {
        return ['progress'];
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (name === 'progress') {
            this.setProgress(newValue);
        }
    }
}
window.customElements.define('progress-ring', ProgressRing); // Enregistre le composant