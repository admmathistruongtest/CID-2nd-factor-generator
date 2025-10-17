// Fichier: script.js

// =======================================================
//   PARTIE À CONFIGURER
// =======================================================
const GET_CIDS_URL = "https://europe-west1-monkey-face-al.cloudfunctions.net/getUserCIDs";
const GET_TOKENS_URL = "https://europe-west1-monkey-face-al.cloudfunctions.net/getNext10Tokens";
// =======================================================

let idToken = null;
let userInfo = null;
let loadedCIDS = {}; // This will now store tokens for ALL loaded CIDs
const OPEN_HEIGHT = "60px";

/**
 * Fonction appelée par Google après une connexion réussie.
 */
async function handleCredentialResponse(response) {
    console.log("Connexion Google réussie. Jeton reçu.");
    idToken = response.credential;
    userInfo = parseJwt(idToken);

    if (!idToken) {
        console.error("Le jeton d'identification est vide !");
        return;
    }
    
    document.getElementById('auth-container').style.display = 'none';
    document.getElementById('app-container').style.display = 'block';

    updateUserInfoUI();
    await loadUserCids(); // Ensure CIDs are loaded before attempting to load tokens
}


function updateUserInfoUI() {
    if (!userInfo) return;
    document.getElementById('user-avatar').src = userInfo.picture || '';
    document.getElementById('user-email').textContent = userInfo.email;
}


function signOut() {
    // Informe Google de la déconnexion pour désactiver la connexion automatique
    google.accounts.id.disableAutoSelect();

    // Réinitialise l'état de l'application
    idToken = null;
    userInfo = null;
    loadedCIDS = {};
    document.getElementById('cid-list').innerHTML = ''; // Vide la liste

    // Affiche l'écran de connexion et cache l'application
    document.getElementById('app-container').style.display = 'none';
    document.getElementById('auth-container').style.display = 'block';

    console.log("Utilisateur déconnecté.");
}

/**
 * Appelle la Cloud Function pour récupérer la liste des CIDs.
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
            headers: {
                'Authorization': `Bearer ${idToken}`
            }
        });

        if (!response.ok) {
            throw new Error(`Le serveur a répondu avec le statut ${response.status}: ${await response.text()}`);
        }
        
        const cids = await response.json();
        renderCidList(cids);

    } catch (error) {
        console.error("Erreur de chargement des CIDs:", error);
        listElement.innerHTML = `<li>Erreur de chargement des CIDs. Vérifiez la console pour les détails.</li>`;
    }
}


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
 * Crée le code HTML pour la liste des CIDs.
 */
function renderCidList(cids) {
    const listElement = document.getElementById('cid-list');
    if (!listElement) return;

    if (cids.length === 0) {
        listElement.innerHTML = `<li>Aucun CID ne vous est attribué.</li>`;
        return;
    }

    listElement.innerHTML = cids.map(email => `
        <li class="cidElement" data-id="${email}">
            <div class="title">
                <span class="label">${email}</span>
                <button class="btn tiny js-toggle" data-id="${email}" aria-expanded="false">Show code</button>
            </div>
            <div class="token" id="${email}">
                <div class="token-content">
                    <div id="${email}-counter" class="displayCounter"></div>
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
 * Appelle la Cloud Function pour obtenir les tokens pour un CID.
 */
async function fetchAndDisplayTokens(cidAccount) {
    // We remove the 'if (loadedCIDS[cidAccount]) return;' check here
    // because we want to initiate the fetch, and the setInterval will handle updates.
    // If it's already in loadedCIDS, it just means we're fetching it again
    // which shouldn't happen right after load. The setInterval will keep running.

    if (loadedCIDS[cidAccount]) {
        return;
    }

    const tokenContainer = document.getElementById(cidAccount);
    const counterDisplay = tokenContainer.querySelector('.displayCounter');
    
    // Set a temporary loading state for this specific CID
    if (!loadedCIDS[cidAccount]) { // Only show loading text if not already loaded/loading
        counterDisplay.textContent = "- loading -";
    }
    
    // We don't necessarily openToken here, only if the user clicks
    // openToken(cidAccount); // Remove this to keep it closed initially

    try {
        const response = await fetch(GET_TOKENS_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({ cid: cidAccount })
        });

        if (!response.ok) throw new Error(await response.text());

        const tokens = await response.json();
        loadedCIDS[cidAccount] = tokens;
        
        // Start interval immediately after loading tokens, for this CID
        // Ensure no duplicate intervals are created if this function is called multiple times for the same CID
        if (!tokenContainer.dataset.intervalId) { // Use a dataset attribute to store interval ID
            const intervalId = setInterval(updateTokenDisplay, 1000, cidAccount);
            tokenContainer.dataset.intervalId = intervalId;
        }
        
        // Update display immediately after fetching for the first time
        updateTokenDisplay(cidAccount);

    } catch (error) {
        console.error(`Échec de la récupération des tokens pour ${cidAccount}:`, error);
        counterDisplay.textContent = "- error -";
        // Also clear any potential interval if error, to prevent indefinite "- error -"
        const existingIntervalId = tokenContainer.dataset.intervalId;
        if(existingIntervalId) {
            clearInterval(existingIntervalId);
            delete tokenContainer.dataset.intervalId;
        }
    }
}

/**
 * Met à jour l'affichage du token et de l'anneau de progression.
 */
function updateTokenDisplay(cidAccount) {
    const tokens = loadedCIDS[cidAccount];
    // If tokens are not yet loaded (e.g., fetch is still in progress), do nothing or show loading
    if (!tokens) {
        const tokenContainer = document.getElementById(cidAccount);
        const counterDisplay = tokenContainer.querySelector('.displayCounter');
        counterDisplay.textContent = "- loading -"; // Keep showing loading if tokens not yet available
        return;
    }

    const tokenContainer = document.getElementById(cidAccount);
    const counterDisplay = tokenContainer.querySelector('.displayCounter');
    const wheel = tokenContainer.querySelector('.wheel');
    
    const now = Date.now();
    const step = 30000; // 30 seconds in milliseconds
    
    const currentToken = tokens.find(t => now >= t.timestamp && now < t.timestamp + step);

    if (currentToken) {
        counterDisplay.textContent = currentToken.token;
        const timeElapsed = now - currentToken.timestamp;
        const percentLeft = 100 - (timeElapsed / step * 100);
        wheel.setProgress(percentLeft);
    } else {
        // If current token is exhausted and we're near the end of the last one,
        // it might be time to refetch.
        // For simplicity, for now, we'll just show "exhausted" and recommend refresh.
        // A more advanced solution would refetch tokens in the background.
        counterDisplay.textContent = "- exhausted -";
        wheel.setProgress(0);
        
        // Optional: If you want to automatically refetch when tokens are exhausted:
        // You'd need a mechanism to only refetch once per exhaustion cycle.
        // For simplicity, the current note says "rechargez la page".
    }
}

// --- Fonctions d'UI ---
function openToken(email) {
    const el = document.getElementById(email);
    el.style.height = OPEN_HEIGHT;
    const btn = document.querySelector(`.js-toggle[data-id="${CSS.escape(email)}"]`);
    if (btn) { btn.setAttribute('aria-expanded', 'true'); btn.textContent = 'Hide'; }
}
function closeToken(email) {
    const el = document.getElementById(email);
    el.style.height = "0px";
    const btn = document.querySelector(`.js-toggle[data-id="${CSS.escape(email)}"]`);
    if (btn) { btn.setAttribute('aria-expanded', 'false'); btn.textContent = 'Show code'; }
}

function copyTokenToClipboard(targetId, button) {
const targetElement = document.getElementById(targetId);
if (!targetElement) return;

// Utilise l'API moderne du presse-papiers
navigator.clipboard.writeText(targetElement.textContent.trim())
    .then(() => {
         // Feedback visuel temporaire
        const originalText = button.innerHTML;
        button.innerHTML = '<span class="material-symbols-outlined" style="font-size: 16px;">done</span> Copied!';
        button.classList.add('copied');

        setTimeout(() => {
            button.innerHTML = originalText;
            button.classList.remove('copied');
        }, 2000);
    })
    .catch(err => {
      console.error('Erreur lors de la copie:', err);
      alert("Impossible de copier. Veuillez copier manuellement ou vérifier les permissions du navigateur.");
    });
}

/**
 * Initialise les écouteurs d'événements.
 */
function initializeUI() {
    document.getElementById('search').addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase().trim();
        document.querySelectorAll('.cidElement').forEach(li => {
            const email = li.dataset.id.toLowerCase();
            li.style.display = email.includes(term) ? '' : 'none';
        });
    });

    const profileBtn = document.getElementById('user-profile-btn');
    const dropdown = document.getElementById('logout-dropdown');
        
    profileBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // Empêche le clic de se propager au document
        dropdown.classList.toggle('visible');
    });

    // NOUVEAU : Gestion du clic sur le bouton de déconnexion
    document.getElementById('logout-btn').addEventListener('click', signOut);
    
    // NOUVEAU : Ferme le menu si on clique n'importe où ailleurs
    document.addEventListener('click', () => {
        if (dropdown.classList.contains('visible')) {
            dropdown.classList.remove('visible');
        }
    });

    document.getElementById('cid-list').addEventListener('click', (e) => {
        const btn = e.target.closest('.js-toggle');
        const copyBtn = e.target.closest('.copy-btn'); // NOUVEAU

        if (btn) {
            const email = btn.dataset.id;
            const isOpen = btn.getAttribute('aria-expanded') === 'true';

            if (isOpen) {
                closeToken(email);
                } else {
                    openToken(email);
                    fetchAndDisplayTokens(email);
                }
                return; // Évite de continuer si c'est le bouton "Show/Hide code"
            }

        // Gère le clic sur le bouton Copier
        if (copyBtn) { // NOUVEAU
            const targetId = copyBtn.dataset.targetId;
            copyTokenToClipboard(targetId, copyBtn);
            return;
        }
    });
}

document.addEventListener('DOMContentLoaded', initializeUI);

// ===================================================================
// === COMPOSANT ProgressRing (VERSION COMPLÈTE ET CORRIGÉE)
// ===================================================================
class ProgressRing extends HTMLElement {
    constructor() {
        super(); // Ligne obligatoire pour commencer

        // 1. Récupérer les attributs de la balise HTML
        const stroke = this.getAttribute('stroke');
        const radius = this.getAttribute('radius');
        const color = this.getAttribute('color');
        const normalizedRadius = radius - stroke * 2;
        this._circumference = normalizedRadius * 2 * Math.PI;

        // 2. Créer un "Shadow DOM" pour encapsuler le style et la structure
        this._root = this.attachShadow({ mode: 'open' });

        // 3. Injecter le code SVG et CSS à l'intérieur du composant
        this._root.innerHTML = `
            <svg
                height="${radius * 2}"
                width="${radius * 2}"
            >
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
                    transition: stroke-dashoffset 0.35s;
                    transform: rotate(-90deg) scaleX(1);
                    transform-origin: 50% 50%;
                }
            </style>
        `;
    }

    /**
     * Méthode pour mettre à jour la progression de l'anneau.
     * @param {number} percent - Le pourcentage de progression (0-100).
     */
    setProgress(percent) {
        const offset = this._circumference - (percent / 100 * this._circumference);
        const circle = this._root.querySelector('circle');
        circle.style.strokeDashoffset = offset;
    }

    /**
     * Indique au navigateur quel attribut HTML "surveiller".
     */
    static get observedAttributes() {
        return ['progress'];
    }

    /**
     * Fonction appelée automatiquement quand un attribut surveillé change.
     */
    attributeChangedCallback(name, oldValue, newValue) {
        if (name === 'progress') {
            this.setProgress(newValue);
        }
    }
}

// On enregistre le nouvel élément HTML 'progress-ring'
window.customElements.define('progress-ring', ProgressRing);