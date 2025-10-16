// Fichier: script.js

// =======================================================
//   PARTIE À CONFIGURER
// =======================================================
const GET_CIDS_URL = "https://europe-west1-monkey-face-al.cloudfunctions.net/getUserCIDs";
const GET_TOKENS_URL = "https://europe-west1-monkey-face-al.cloudfunctions.net/getNext10Tokens";
// =======================================================

let idToken = null;
let loadedCIDS = {};
const OPEN_HEIGHT = "60px";

/**
 * Fonction appelée par Google après une connexion réussie.
 */
async function handleCredentialResponse(response) {
    console.log("Connexion Google réussie. Jeton reçu.");
    idToken = response.credential;

    if (!idToken) {
        console.error("Le jeton d'identification est vide !");
        return;
    }
    
    document.getElementById('auth-container').style.display = 'none';
    document.getElementById('app-container').style.display = 'block';

    loadUserCids();
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
                <div id="${email}-counter" class="displayCounter"></div>
                <progress-ring id="${email}-wheel" class="wheel" stroke="4" radius="20" progress="0" color="whitesmoke"></progress-ring>
            </div>
        </li>`
    ).join('');
}


/**
 * Appelle la Cloud Function pour obtenir les tokens pour un CID.
 */
async function fetchAndDisplayTokens(cidAccount) {
    if (loadedCIDS[cidAccount]) return;

    const tokenContainer = document.getElementById(cidAccount);
    const counterDisplay = tokenContainer.querySelector('.displayCounter');
    counterDisplay.textContent = "- loading -";
    openToken(cidAccount);

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
        
        setInterval(updateTokenDisplay, 1000, cidAccount);

    } catch (error) {
        console.error(`Échec de la récupération des tokens pour ${cidAccount}:`, error);
        counterDisplay.textContent = "- error -";
    }
}

/**
 * Met à jour l'affichage du token et de l'anneau de progression.
 */
function updateTokenDisplay(cidAccount) {
    const tokens = loadedCIDS[cidAccount];
    if (!tokens) return;

    const tokenContainer = document.getElementById(cidAccount);
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

    document.getElementById('zoomToggle').addEventListener('click', (e) => {
        document.body.classList.toggle('zoom');
        e.currentTarget.innerHTML = document.body.classList.contains('zoom') ?
            '<span class="material-symbols-outlined">zoom_out</span> Zoom out' :
            '<span class="material-symbols-outlined">zoom_in</span> Zoom in';
    });

    document.getElementById('cid-list').addEventListener('click', (e) => {
        const btn = e.target.closest('.js-toggle');
        if (!btn) return;

        const email = btn.dataset.id;
        const isOpen = btn.getAttribute('aria-expanded') === 'true';

        if (isOpen) {
            closeToken(email);
        } else {
            if (!loadedCIDS[email]) {
                fetchAndDisplayTokens(email);
            } else {
                openToken(email);
            }
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
                    transform: rotate(-90deg);
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