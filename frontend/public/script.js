// =======================================================
// === CONFIG & ENDPOINTS (technical-accounts) ===========
// =======================================================
const BASE_URL = "https://europe-west1-monkey-face-al.cloudfunctions.net";

const GET_TA_URL             = `${BASE_URL}/getUserTechnicalAccounts`;
const GET_TOKENS_URL         = `${BASE_URL}/getNext10Tokens`;
const USER_GET_TA_USERS_URL  = `${BASE_URL}/getTechAccountUsers`;
const USER_GRANT_ACCESS_URL  = `${BASE_URL}/userGrantAccess`;
const USER_REVOKE_ACCESS_URL = `${BASE_URL}/userRevokeAccess`;

let idToken   = null;
let userInfo  = null;
let loadedTAs = {};    // { [taId]: tokens[] }
let taUsersCache = {}; // { [taId]: string[] }
const OPEN_HEIGHT = "60px";

// =======================================================
// === AUTH ==============================================
// =======================================================
function parseJwt(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
    );
    return JSON.parse(jsonPayload);
  } catch (e) {
    console.error("Failed to decode JWT", e);
    return null;
  }
}

function updateUserInfoUI() {
  if (!userInfo) return;
  const avatar = document.getElementById('user-avatar');
  const email  = document.getElementById('user-email');
  if (avatar) avatar.src = userInfo.picture || '';
  if (email)  email.textContent = userInfo.email || '';
}

function signOut() {
  try { google?.accounts?.id?.disableAutoSelect?.(); } catch(_){}
  idToken = null;
  userInfo = null;
  loadedTAs = {};
  taUsersCache = {};
  const list = document.getElementById('cid-list');
  if (list) list.innerHTML = '';
  document.getElementById('app-container').style.display = 'none';
  document.getElementById('auth-container').style.display = 'block';
}

// Make callback global for Google GSI
window.handleCredentialResponse = async function handleCredentialResponse(response) {
  idToken = response?.credential || null;
  userInfo = idToken ? parseJwt(idToken) : null;

  if (!idToken || !userInfo) {
    alert("Sign-in error. Please try again.");
    return;
  }

  document.getElementById('auth-container').style.display = 'none';
  document.getElementById('app-container').style.display = 'block';

  updateUserInfoUI();
  await loadUserTechnicalAccounts();
};

// =======================================================
// === DATA LOAD =========================================
// =======================================================
async function loadUserTechnicalAccounts() {
  if (!idToken) { console.error("Missing idToken"); return; }
  const listElement = document.getElementById('cid-list');
  if (!listElement) return;
  listElement.innerHTML = `<li>Loading technical accounts…</li>`;

  try {
    const res = await fetch(GET_TA_URL, { headers: { 'Authorization': `Bearer ${idToken}` }});
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const tas = await res.json();
    console.log('[TA] fetched count =', tas?.length || 0);
    renderTaList(tas);
  } catch (err) {
    console.error("loadUserTechnicalAccounts:", err);
    listElement.innerHTML = `<li>Load error. See console.</li>`;
  }
}

async function loadTaUsers(taId) {
  if (taUsersCache[taId]) { renderTaUsers(taId, taUsersCache[taId]); return; }

  const statusEl = document.getElementById(`${taId}-users-status`);
  if (statusEl) statusEl.textContent = "Loading…";

  try {
    const res = await fetch(USER_GET_TA_USERS_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${idToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ technicalAccount: taId })
    });
    if (!res.ok) throw new Error(await res.text());

    const users = await res.json();
    taUsersCache[taId] = Array.isArray(users) ? users : [];
    renderTaUsers(taId, taUsersCache[taId]);
    if (statusEl) statusEl.textContent = "";
  } catch (err) {
    console.error('loadTaUsers:', err);
    const fallback = [userInfo?.email].filter(Boolean);
    taUsersCache[taId] = fallback;
    renderTaUsers(taId, fallback);
    if (statusEl) statusEl.textContent = "Read unavailable (fallback shown).";
  }
}

// =======================================================
// === RENDER ============================================
// =======================================================
function renderTaList(tas) {
  const listElement = document.getElementById('cid-list');
  if (!listElement) return;

  if (!tas || tas.length === 0) {
    listElement.innerHTML = `<li>No technical account assigned.</li>`;
    return;
  }

  listElement.innerHTML = tas.map(taId => `
    <li class="cidElement" data-id="${taId}">
      <div class="title">
        <span class="label">${taId}</span>

        <div class="cid-actions">
          <button class="icon-btn js-users" data-id="${taId}" title="Manage users">
            <span class="material-symbols-outlined">group</span>
          </button>
          <button class="btn tiny js-toggle" data-id="${taId}" aria-expanded="false">Show code</button>
        </div>
      </div>

      <!-- TOTP panel -->
      <div class="token" id="${taId}">
        <div class="token-content">
          <progress-ring class="wheel" stroke="4" radius="20" progress="0" color="whitesmoke"></progress-ring>
          <div id="${taId}-counter" class="displayCounter">- loading -</div>
          <button class="icon-btn refresh-btn hidden" data-id="${taId}" title="Refresh">
            <span class="material-symbols-outlined">refresh</span>
          </button>
        </div>
        <button class="btn tiny copy-btn" data-target-id="${taId}-counter" title="Copy code">
          <span class="material-symbols-outlined" style="font-size:16px;">content_copy</span> Copy
        </button>
      </div>

      <!-- USERS panel -->
      <div class="user-panel" id="${taId}-users">
        <!-- Add first -->
        <div class="panel-row">
          <input type="email" class="panel-input js-user-add-input" data-id="${taId}" placeholder="Add user (email)">
          <button class="btn tiny js-user-add" data-id="${taId}">
            <span class="material-symbols-outlined">person_add</span> Add
          </button>
        </div>

        <!-- Filter line -->
        <div class="panel-row">
          <input type="search" class="panel-input js-user-filter" data-id="${taId}" placeholder="Filter users…">
          <div class="status" id="${taId}-users-status"></div>
        </div>

        <!-- List after -->
        <ul class="user-list" id="${taId}-users-list"></ul>
      </div>
    </li>
  `).join('');
}

function renderTaUsers(taId, users) {
  const ul = document.getElementById(`${taId}-users-list`);
  if (!ul) return;

  if (!Array.isArray(users) || users.length === 0) {
    ul.innerHTML = `<li><span class="email" style="color:var(--muted)">No authorized users.</span></li>`;
    return;
  }

  ul.innerHTML = users.map(u => `
    <li>
      <span class="email">${u}</span>
      <button class="revoke js-user-revoke" data-id="${taId}" data-user="${u}">Revoke</button>
    </li>
  `).join('');
}

// =======================================================
// === TOKENS (manual refresh only) ======================
// =======================================================
function clearRunningInterval(container) {
  const existingIntervalId = container?.dataset?.intervalId;
  if (existingIntervalId) {
    clearInterval(existingIntervalId);
    delete container.dataset.intervalId;
  }
}

async function fetchAndDisplayTokens(taId) {
  const tokenContainer = document.getElementById(taId);
  if (!tokenContainer) return;
  clearRunningInterval(tokenContainer);
  setUIState(tokenContainer, { state: 'loading' });

  try {
    const res = await fetch(GET_TOKENS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({ technicalAccount: taId })
    });
    if (!res.ok) throw new Error(await res.text());

    const tokens = await res.json();
    loadedTAs[taId] = tokens;

    const intervalId = setInterval(updateTokenDisplay, 1000, taId);
    tokenContainer.dataset.intervalId = intervalId;
    updateTokenDisplay(taId);
  } catch (err) {
    console.error(`Tokens failed for ${taId}:`, err);
    setUIState(tokenContainer, { state: 'error' });
  }
}

async function manualRefresh(taId, refreshBtnEl) {
  const tokenContainer = document.getElementById(taId);
  if (!tokenContainer) return;
  clearRunningInterval(tokenContainer);
  setUIState(tokenContainer, { state: 'loading' });
  withBtnLoading(refreshBtnEl, true);

  try {
    const res = await fetch(GET_TOKENS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({ technicalAccount: taId })
    });
    if (!res.ok) throw new Error(await res.text());

    loadedTAs[taId] = await res.json();
    const intervalId = setInterval(updateTokenDisplay, 1000, taId);
    tokenContainer.dataset.intervalId = intervalId;
    updateTokenDisplay(taId);
  } catch (e) {
    console.error('manualRefresh:', e);
    setUIState(tokenContainer, { state: 'error' });
  } finally {
    withBtnLoading(refreshBtnEl, false);
  }
}

function setUIState(tokenContainer, { state, value }) {
  const counterDisplay = tokenContainer.querySelector('.displayCounter');
  const copyBtn = tokenContainer.querySelector('.copy-btn');
  const refreshBtn = tokenContainer.querySelector('.refresh-btn');
  if (!counterDisplay || !copyBtn || !refreshBtn) return;

  if (state === 'ok') {
    counterDisplay.textContent = value || '';
    copyBtn.classList.remove('hidden');
    refreshBtn.classList.add('hidden');
  } else if (state === 'exhausted') {
    counterDisplay.textContent = "- exhausted -";
    copyBtn.classList.add('hidden');
    refreshBtn.classList.remove('hidden');
  } else if (state === 'error') {
    counterDisplay.textContent = "- error -";
    copyBtn.classList.add('hidden');
    refreshBtn.classList.remove('hidden');
  } else { // loading
    counterDisplay.textContent = "- loading -";
    copyBtn.classList.add('hidden');
    refreshBtn.classList.add('hidden');
  }
}

function updateTokenDisplay(taId) {
  const tokens = loadedTAs[taId];
  const tokenContainer = document.getElementById(taId);
  if (!tokens || !tokenContainer) return;

  const now = Date.now();
  const step = 30000;
  const currentToken = tokens.find(t => now >= t.timestamp && now < t.timestamp + step);

  const wheel = tokenContainer.querySelector('.wheel');
  if (currentToken) {
    const timeElapsed = now - currentToken.timestamp;
    const percentLeft = 100 - (timeElapsed / step * 100);
    setUIState(tokenContainer, { state: 'ok', value: currentToken.token });
    if (wheel?.setProgress) wheel.setProgress(percentLeft);
  } else {
    setUIState(tokenContainer, { state: 'exhausted' });
    if (wheel?.setProgress) wheel.setProgress(0);
    clearRunningInterval(tokenContainer);
  }
}

// =======================================================
// === USER ACTIONS (add / revoke) =======================
// =======================================================
async function userGrant(taId, email) {
  const res = await fetch(USER_GRANT_ACCESS_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${idToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ technicalAccount: taId, userToGrant: email })
  });
  if (!res.ok) throw new Error(await res.text());
}

async function userRevoke(taId, email) {
  const res = await fetch(USER_REVOKE_ACCESS_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${idToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ technicalAccount: taId, userToRevoke: email })
  });
  if (!res.ok) throw new Error(await res.text());
}

// =======================================================
// === UI HELPERS ========================================
function withBtnLoading(btn, on, label = 'Loading…') {
  if (!btn) return;
  if (on) {
    if (!btn.dataset._label) btn.dataset._label = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = label;
  } else {
    btn.disabled = false;
    if (btn.dataset._label) btn.innerHTML = btn.dataset._label;
  }
}

function openToken(taId) {
  const el = document.getElementById(taId);
  if (el) el.style.height = OPEN_HEIGHT;
  const btn = document.querySelector(`.js-toggle[data-id="${CSS.escape(taId)}"]`);
  if (btn) { btn.setAttribute('aria-expanded', 'true'); btn.textContent = 'Hide'; }
}

function closeToken(taId) {
  const el = document.getElementById(taId);
  if (el) el.style.height = "0px";
  const btn = document.querySelector(`.js-toggle[data-id="${CSS.escape(taId)}"]`);
  if (btn) { btn.setAttribute('aria-expanded', 'false'); btn.textContent = 'Show code'; }
}

function copyTokenToClipboard(targetId, button) {
  const targetElement = document.getElementById(targetId);
  if (!targetElement || !targetElement.textContent || targetElement.textContent.startsWith('-')) return;

  navigator.clipboard.writeText(targetElement.textContent.trim())
    .then(() => {
      const original = button.innerHTML;
      button.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;">done</span> Copied!';
      button.classList.add('copied');
      setTimeout(() => {
        button.innerHTML = original;
        button.classList.remove('copied');
      }, 1200);
    })
    .catch(err => {
      console.error('Copy failed:', err);
      alert("Copy not allowed. Check browser permissions.");
    });
}

// =======================================================
// === INIT LISTENERS ====================================
function initializeUI() {
  // global search
  document.getElementById('search-input')?.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase().trim();
    document.querySelectorAll('.cidElement').forEach(li => {
      const taId = (li.dataset.id || '').toLowerCase();
      li.style.display = taId.includes(term) ? '' : 'none';
    });
  });

  // profile/logout
  document.getElementById('user-profile-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('logout-dropdown')?.classList.toggle('visible');
  });
  document.getElementById('logout-btn')?.addEventListener('click', signOut);
  document.addEventListener('click', () => {
    document.getElementById('logout-dropdown')?.classList.remove('visible');
  });

  // delegate on the list
  document.getElementById('cid-list')?.addEventListener('click', async (e) => {
    const toggleBtn  = e.target.closest('.js-toggle');
    const copyBtn    = e.target.closest('.copy-btn');
    const usersBtn   = e.target.closest('.js-users');
    const revokeBtn  = e.target.closest('.js-user-revoke');
    const refreshBtn = e.target.closest('.refresh-btn');

    if (toggleBtn) {
      const taId = toggleBtn.dataset.id;
      const isOpen = toggleBtn.getAttribute('aria-expanded') === 'true';
      if (isOpen) closeToken(taId);
      else { openToken(taId); fetchAndDisplayTokens(taId); }
      return;
    }

    if (refreshBtn) {
      const taId = refreshBtn.dataset.id;
      await manualRefresh(taId, refreshBtn);
      return;
    }

    if (copyBtn) {
      const targetId = copyBtn.dataset.targetId;
      copyTokenToClipboard(targetId, copyBtn);
      return;
    }

    if (usersBtn) {
      const taId = usersBtn.dataset.id;
      const panel = document.getElementById(`${taId}-users`); // IDs may contain '@' -> getElementById is safe
      if (!panel) return;
      const open = panel.classList.contains('open');
      panel.classList.toggle('open', !open);
      if (!open && !taUsersCache[taId]) await loadTaUsers(taId);
      return;
    }

    if (revokeBtn) {
      const taId = revokeBtn.dataset.id;
      const email = revokeBtn.dataset.user;
      if (!confirm(`Revoke ${email} from ${taId}?`)) return;
      try {
        withBtnLoading(revokeBtn, true, '…');
        await userRevoke(taId, email);
        taUsersCache[taId] = (taUsersCache[taId] || []).filter(u => u !== email);
        renderTaUsers(taId, taUsersCache[taId]);
      } catch (err) {
        alert(`Revoke error: ${err.message || err}`);
      } finally {
        withBtnLoading(revokeBtn, false);
      }
      return;
    }
  });

  // add + filter
  document.getElementById('cid-list')?.addEventListener('click', async (e) => {
    const addBtn = e.target.closest('.js-user-add');
    if (!addBtn) return;

    const taId = addBtn.dataset.id;
    const input = document.querySelector(`.js-user-add-input[data-id="${CSS.escape(taId)}"]`);
    const email = input?.value.trim();
    if (!email || !email.includes('@')) { alert("Invalid email."); return; }

    withBtnLoading(addBtn, true);
    try {
      await userGrant(taId, email);
      input.value = '';
      const set = new Set([...(taUsersCache[taId] || []), email]);
      taUsersCache[taId] = Array.from(set).sort((a,b)=>a.localeCompare(b));
      renderTaUsers(taId, taUsersCache[taId]);
    } catch (err) {
      alert(`Add error: ${err.message || err}`);
    } finally {
      withBtnLoading(addBtn, false);
    }
  });

  document.getElementById('cid-list')?.addEventListener('input', (e) => {
    const filter = e.target.closest('.js-user-filter');
    if (!filter) return;
    const taId = filter.dataset.id;
    const term = filter.value.toLowerCase().trim();

    const ul = document.getElementById(`${taId}-users-list`);
    if (!ul) return;
    ul.querySelectorAll('li').forEach(li => {
      const emailSpan = li.querySelector('.email');
      if (!emailSpan) { li.style.display = ''; return; }
      const txt = (emailSpan.textContent || '').toLowerCase();
      li.style.display = txt.includes(term) ? 'grid' : 'none';
    });
  });
}

document.addEventListener('DOMContentLoaded', initializeUI);

// =======================================================
// === ProgressRing (SVG Web Component) ==================
class ProgressRing extends HTMLElement {
  constructor() {
    super();
    const stroke = Number(this.getAttribute('stroke') || 4);
    const radius = Number(this.getAttribute('radius') || 20);
    const color  = this.getAttribute('color') || 'whitesmoke';
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
        :host{ display:inline-block; }
        circle{
          transition: stroke-dashoffset 0.35s linear;
          transform: rotate(-90deg) scaleX(-1);
          transform-origin: 50% 50%;
        }
      </style>
    `;
  }
  setProgress(percent) {
    const p = Math.max(0, Math.min(100, Number(percent)));
    const offset = this._circumference - (p / 100 * this._circumference);
    const circle = this._root.querySelector('circle');
    if (circle) circle.style.strokeDashoffset = offset;
  }
  static get observedAttributes() { return ['progress']; }
  attributeChangedCallback(name, _old, val) {
    if (name === 'progress') this.setProgress(val);
  }
}
window.customElements.define('progress-ring', ProgressRing);