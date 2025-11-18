// =======================================================
// === CONFIG & ENDPOINTS (technical-accounts) ===========
// =======================================================
const BASE_URL = "https://europe-west1-monkey-face-al.cloudfunctions.net";

const GET_TA_URL             = `${BASE_URL}/getUserTechnicalAccounts`;
const GET_TOKENS_URL         = `${BASE_URL}/getNext10Tokens`;
const USER_GET_TA_USERS_URL  = `${BASE_URL}/getTechAccountUsers`;
const USER_GRANT_ACCESS_URL  = `${BASE_URL}/userGrantAccess`;
const USER_REVOKE_ACCESS_URL = `${BASE_URL}/userRevokeAccess`;

// Lookup endpoint(s)
const LOOKUP_TA_URL_PRIMARY  = `${BASE_URL}/lookupTechnicalAccountUsers`;
const LOOKUP_TA_URL_FALLBACK = `${BASE_URL}/lookupTechnicalAccount`;

// New: send real email (backend you ajouteras cette Cloud Function)
const SEND_REQUEST_URL       = `${BASE_URL}/sendAccessRequestEmail`;

let idToken   = null;
let userInfo  = null;
let loadedTAs = {};          // { [taId]: tokens[] }
let taUsersCache = {};       // { [taId]: string[] }
const OPEN_HEIGHT = "60px";

// Which TA is currently managed in the overlay
let overlayCurrentTA = null;

// Request compose state
const composeState = { taId: null, owner: null };

// =======================================================
// === AUTH ==============================================
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
    console.error("Failed to decode JWT", e);
    return null;
  }
}

function updateUserInfoUI() {
  if (!userInfo) return;
  document.getElementById('user-avatar').src = userInfo.picture || '';
  document.getElementById('user-email').textContent = userInfo.email || '';
}

function signOut() {
  google.accounts.id.disableAutoSelect();
  idToken = null;
  userInfo = null;
  loadedTAs = {};
  taUsersCache = {};
  document.getElementById('cid-list').innerHTML = '';
  document.getElementById('app-container').style.display = 'none';
  document.getElementById('auth-container').style.display = 'block';
}

async function handleCredentialResponse(response) {
  idToken = response.credential;
  userInfo = parseJwt(idToken);

  if (!idToken || !userInfo) {
    alert("Sign-in failed. Please try again.");
    return;
  }

  document.getElementById('auth-container').style.display = 'none';
  document.getElementById('app-container').style.display = 'block';

  updateUserInfoUI();
  await loadUserTechnicalAccounts();
}

// =======================================================
// === HELPERS ===========================================
// =======================================================
function withBtnLoading(btn, on, loadingLabel = 'Loading…') {
  if (!btn) return;
  if (on) {
    if (!btn.dataset._label) btn.dataset._label = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = loadingLabel;
  } else {
    btn.disabled = false;
    if (btn.dataset._label) btn.innerHTML = btn.dataset._label;
  }
}

function clearRunningInterval(container) {
  const existingIntervalId = container?.dataset?.intervalId;
  if (existingIntervalId) {
    clearInterval(existingIntervalId);
    delete container.dataset.intervalId;
  }
}

async function fetchWithTimeout(resource, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(resource, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

function buildMailto(to, taId, subject, reason) {
  const sub = subject || `Access request for ${taId} (Authenticator)`;
  const body = `Hello,

Could you please grant me access to the technical account:

${taId}

Requester: ${userInfo?.email || ''}

Reason:
${reason || ''}

Thanks!`;
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(sub)}&body=${encodeURIComponent(body)}`;
}

// =======================================================
// === DATA LOAD =========================================
// =======================================================
async function loadUserTechnicalAccounts() {
  if (!idToken) return console.error("Missing idToken");
  const listElement = document.getElementById('cid-list');
  listElement.innerHTML = `<li>Loading technical accounts...</li>`;

  try {
    const res = await fetch(GET_TA_URL, { headers: { 'Authorization': `Bearer ${idToken}` }});
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const tas = await res.json();
    renderTaList(tas);
  } catch (err) {
    console.error("Load error:", err);
    listElement.innerHTML = `<li>Failed to load. Check console.</li>`;
  }
}

async function loadTaUsers(taId) {
  if (taUsersCache[taId]) { renderUsersOverlay(taId, taUsersCache[taId]); return; }

  const statusEl = document.getElementById(`overlay-users-status`);
  if (statusEl) statusEl.textContent = "Loading...";

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
    renderUsersOverlay(taId, taUsersCache[taId]);
    if (statusEl) statusEl.textContent = "";
  } catch (err) {
    console.error('loadTaUsers:', err);
    const fallback = [userInfo?.email].filter(Boolean);
    taUsersCache[taId] = fallback;
    renderUsersOverlay(taId, fallback);
    if (statusEl) statusEl.textContent = "Read unavailable (showing fallback).";
  }
}

// =======================================================
// === RENDER (cards) ====================================
// =======================================================
function renderTaList(tas) {
  const listElement = document.getElementById('cid-list');
  if (!listElement) return;

  if (!tas || tas.length === 0) {
    listElement.innerHTML = `<li>No technical account is assigned to you.</li>`;
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

          <!-- Refresh button (hidden unless exhausted or error) -->
          <button class="icon-btn refresh-btn hidden" data-id="${taId}" title="Refresh">
            <span class="material-symbols-outlined">refresh</span>
          </button>
        </div>

        <!-- Copy button (visible only when code ok) -->
        <button class="btn tiny copy-btn" data-target-id="${taId}-counter" title="Copy code">
          <span class="material-symbols-outlined" style="font-size:16px;">content_copy</span> Copy
        </button>
      </div>
    </li>
  `).join('');
}

// =======================================================
// === RENDER (overlay users) ============================
// =======================================================
function renderUsersOverlay(taId, users) {
  const ul = document.getElementById('overlay-users-list');
  if (!ul) return;

  overlayCurrentTA = taId;

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

  let wheel = tokenContainer.querySelector('.wheel');
  if (!wheel) {
    wheel = document.createElement('progress-ring');
    wheel.className = 'wheel';
    wheel.setAttribute('stroke', '4');
    wheel.setAttribute('radius', '20');
    wheel.setAttribute('progress', '0');
    wheel.setAttribute('color', 'whitesmoke');
    const content = tokenContainer.querySelector('.token-content');
    if (content) content.insertBefore(wheel, content.firstChild);
  }

  if (currentToken) {
    const timeElapsed = now - currentToken.timestamp;
    const percentLeft = Math.max(0, 100 - (timeElapsed / step * 100));
    setUIState(tokenContainer, { state: 'ok', value: currentToken.token });
    if (wheel?.setProgress) wheel.setProgress(percentLeft);
  } else {
    setUIState(tokenContainer, { state: 'exhausted' });
    if (wheel?.setProgress) wheel.setProgress(0);
    clearRunningInterval(tokenContainer);
  }
}

// =======================================================
// === USER ACTIONS (grant / revoke) =====================
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
  if (!res.ok) {
    const text = await res.text().catch(()=> '');
    throw new Error(text || `HTTP ${res.status}`);
  }
}

// =======================================================
// === UI HELPERS (open/close/copy) ======================
// =======================================================
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
      const originalText = button.innerHTML;
      button.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;">done</span> Copied!';
      button.classList.add('copied');
      setTimeout(() => {
        button.innerHTML = originalText;
        button.classList.remove('copied');
      }, 1200);
    })
    .catch(err => {
      console.error('Copy failed:', err);
      alert("Unable to copy. Check your browser permissions.");
    });
}

// =======================================================
// === REQUEST ACCESS (lookup + render + compose) =========
// =======================================================
async function requestLookupExact(technicalAccount) {
  const headers = { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' };

  const pickOwners = (data) => {
    if (!data) return null;
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.authorizedUsers)) return data.authorizedUsers;
    if (Array.isArray(data.users)) return data.users;
    if (Array.isArray(data.owners)) return data.owners;
    if (typeof data.authorizedUsers === 'string') return data.authorizedUsers.split(/[,\s;]+/).filter(Boolean);
    return null;
  };

  const tryEndpoint = async (url, method = 'GET') => {
    try {
      const res = await fetchWithTimeout(
        method === 'GET'
          ? `${url}?technicalAccount=${encodeURIComponent(technicalAccount)}`
          : url,
        { method, headers, body: method === 'POST' ? JSON.stringify({ technicalAccount }) : undefined },
        8000
      );
      if (res.status === 404) return { notFound: true };
      if (res.status === 403) return { forbidden: true };
      if (!res.ok) return null;
      const json = await res.json().catch(() => null);
      const owners = pickOwners(json);
      if (owners) return { owners };
      return { raw: json };
    } catch { return null; }
  };

  let out = await tryEndpoint(LOOKUP_TA_URL_PRIMARY, 'GET');
  if (out?.owners || out?.notFound || out?.forbidden) return out;

  out = await tryEndpoint(LOOKUP_TA_URL_FALLBACK, 'GET');
  if (out?.owners || out?.notFound || out?.forbidden) return out;

  out = await tryEndpoint(USER_GET_TA_USERS_URL, 'POST');
  return out || null;
}

function renderRequestOwners(taId, owners) {
  const ul = document.getElementById('req-owners-list');
  const filterRow = document.getElementById('req-owner-filter-row');
  if (!ul) return;

  if (!owners || owners.length === 0) {
    filterRow.style.display = 'none';
    ul.innerHTML = `<li><span class="email" style="color:var(--muted)">No owners found for this account.</span></li>`;
    return;
  }

  // Show filter
  filterRow.style.display = '';

  ul.innerHTML = owners.map(email => `
    <li class="req-owner-row">
      <span class="email">${email}</span>
      <button class="btn tiny ghost js-open-compose" data-id="${taId}" data-owner="${email}">
        <span class="material-symbols-outlined">send</span> Send request
      </button>
    </li>
  `).join('');
}

// =======================================================
// === INIT LISTENERS ====================================
// =======================================================
function openOverlay(id) {
  const root = document.getElementById(id);
  if (!root) return;
  root.setAttribute('aria-hidden', 'false');
  document.body.classList.add('no-scroll');
}
function closeOverlay(id) {
  const root = document.getElementById(id);
  if (!root) return;
  root.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('no-scroll');
}

function initializeUI() {
  // Global search on cards
  document.getElementById('search-input')?.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase().trim();
    document.querySelectorAll('.cidElement').forEach(li => {
      const taId = li.dataset.id.toLowerCase();
      li.style.display = taId.includes(term) ? '' : 'none';
    });
  });

  // Profile / logout
  document.getElementById('user-profile-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('logout-dropdown')?.classList.toggle('visible');
  });
  document.getElementById('logout-btn')?.addEventListener('click', signOut);
  document.addEventListener('click', () => {
    document.getElementById('logout-dropdown')?.classList.remove('visible');
  });

  // Card delegation
  document.getElementById('cid-list')?.addEventListener('click', async (e) => {
    const toggleBtn  = e.target.closest('.js-toggle');
    const copyBtn    = e.target.closest('.copy-btn');
    const usersBtn   = e.target.closest('.js-users');
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
      overlayCurrentTA = taId;
      await loadTaUsers(taId);
      document.getElementById('overlay-users-status').textContent = '';
      document.getElementById('overlay-user-add-input').value = '';
      document.getElementById('overlay-user-filter').value = '';
      openOverlay('users-overlay');
      return;
    }
  });

  // Global revoke delegation
  document.addEventListener('click', async (e) => {
    const revokeBtn = e.target.closest('.js-user-revoke');
    if (!revokeBtn) return;

    const taId  = revokeBtn.dataset.id;
    const email = revokeBtn.dataset.user;
    if (!taId || !email) return;

    if (!confirm(`Revoke access for ${email} on ${taId}?`)) return;

    try {
      withBtnLoading(revokeBtn, true, '…');
      await userRevoke(taId, email);
      taUsersCache[taId] = (taUsersCache[taId] || []).filter(u => u !== email);
      const row = revokeBtn.closest('li');
      if (row) row.remove();
      const listEl = document.getElementById('overlay-users-list');
      if (listEl && listEl.children.length === 0) {
        listEl.innerHTML = `<li><span class="email" style="color:var(--muted)">No authorized users.</span></li>`;
      }
    } catch (err) {
      alert(`Revoke failed: ${err?.message || err}`);
    } finally {
      withBtnLoading(revokeBtn, false);
    }
  });

  // Overlay: add user
  document.getElementById('overlay-user-add-btn')?.addEventListener('click', async () => {
    const taId = overlayCurrentTA;
    const input = document.getElementById('overlay-user-add-input');
    const email = input?.value.trim();
    if (!taId || !email || !email.includes('@')) { alert("Invalid email."); return; }

    const btn = document.getElementById('overlay-user-add-btn');
    withBtnLoading(btn, true);
    try {
      await userGrant(taId, email);
      input.value = '';
      const set = new Set([...(taUsersCache[taId] || []), email]);
      taUsersCache[taId] = Array.from(set).sort((a,b)=>a.localeCompare(b));
      renderUsersOverlay(taId, taUsersCache[taId]);
      document.getElementById('overlay-users-status').textContent = 'User added.';
    } catch (err) {
      alert(`Add failed: ${err.message || err}`);
    } finally {
      withBtnLoading(btn, false);
    }
  });

  // Overlay: filter users
  document.getElementById('overlay-user-filter')?.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase().trim();
    const ul = document.getElementById('overlay-users-list');
    if (!ul) return;
    ul.querySelectorAll('li').forEach(li => {
      const emailSpan = li.querySelector('.email');
      if (!emailSpan) { li.style.display = ''; return; }
      const txt = emailSpan.textContent.toLowerCase();
      li.style.display = txt.includes(term) ? 'grid' : 'none';
    });
  });

  // Users overlay close
  document.getElementById('users-overlay-close')?.addEventListener('click', () => closeOverlay('users-overlay'));
  document.getElementById('users-overlay-close-footer')?.addEventListener('click', () => closeOverlay('users-overlay'));
  document.querySelector('#users-overlay .overlay-backdrop')?.addEventListener('click', () => closeOverlay('users-overlay'));

  // Request overlay open/close (link only)
  document.getElementById('open-request-overlay-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('req-ta-input').value = '';
    document.getElementById('req-ta-status').textContent = '';
    document.getElementById('req-owners-list').innerHTML = '';
    document.getElementById('req-owner-filter-row').style.display = 'none';
    document.getElementById('req-compose').classList.remove('show');
    document.getElementById('req-compose').setAttribute('aria-hidden','true');
    openOverlay('request-overlay');
  });
  document.getElementById('request-overlay-close')?.addEventListener('click', () => closeOverlay('request-overlay'));
  document.getElementById('request-overlay-close-footer')?.addEventListener('click', () => closeOverlay('request-overlay'));
  document.querySelector('#request-overlay .overlay-backdrop')?.addEventListener('click', () => closeOverlay('request-overlay'));

  // Request overlay: exact check
  document.getElementById('req-ta-check-btn')?.addEventListener('click', async () => {
    const input = document.getElementById('req-ta-input');
    const taId = input?.value.trim();
    const status = document.getElementById('req-ta-status');
    const ownersList = document.getElementById('req-owners-list');
    if (!taId) { status.textContent = 'Please enter an exact technical account id.'; return; }

    const btn = document.getElementById('req-ta-check-btn');
    withBtnLoading(btn, true, 'Checking…');
    status.textContent = 'Checking...';
    ownersList.innerHTML = '';
    document.getElementById('req-compose').classList.remove('show');
    document.getElementById('req-compose').setAttribute('aria-hidden','true');

    try {
      const info = await requestLookupExact(taId);
      if (!info) { status.textContent = 'Lookup feature is not available on this backend. Please contact an administrator.'; return; }
      if (info.notFound) { status.textContent = `No technical account found for "${taId}".`; return; }
      if (info.forbidden) { status.textContent = `This technical account exists, but you are not authorized to view its owners.`; return; }
      if (Array.isArray(info.owners) && info.owners.length) {
        status.textContent = `Found "${taId}". Select an owner and send a request:`;
        renderRequestOwners(taId, info.owners);
        // Save TA in state for compose later
        composeState.taId = taId;
        return;
      }
      status.textContent = 'No owners returned by the server.';
    } catch (e) {
      status.textContent = `Lookup failed: ${e?.message || e}`;
    } finally {
      withBtnLoading(btn, false);
    }
  });

  // Filter owners in Request overlay
  document.getElementById('req-owner-filter')?.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase().trim();
    document.querySelectorAll('#req-owners-list .req-owner-row').forEach(li => {
      const emailSpan = li.querySelector('.email');
      if (!emailSpan) { li.style.display = ''; return; }
      const txt = emailSpan.textContent.toLowerCase();
      li.style.display = txt.includes(term) ? 'grid' : 'none';
    });
  });

  // Open compose panel (Send request)
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.js-open-compose');
    if (!btn) return;

    const owner = btn.dataset.owner;
    const taId  = btn.dataset.id;
    composeState.owner = owner;
    composeState.taId  = taId;

    document.getElementById('req-to-email').textContent = owner;
    document.getElementById('req-subject').value = `Access request for ${taId} (Authenticator)`;
    document.getElementById('req-reason').value = '';
    document.getElementById('req-send-status').textContent = '';

    const compose = document.getElementById('req-compose');
    compose.classList.add('show');
    compose.setAttribute('aria-hidden','false');
    document.getElementById('req-reason').focus();
  });

  // Send request (real email if backend exists, else mailto fallback)
  document.getElementById('req-send-btn')?.addEventListener('click', async () => {
    const taId  = composeState.taId;
    const owner = composeState.owner;
    if (!taId || !owner) return;

    const subject = (document.getElementById('req-subject').value || '').trim() || `Access request for ${taId} (Authenticator)`;
    const reason  = (document.getElementById('req-reason').value || '').trim();
    const status  = document.getElementById('req-send-status');
    const btn     = document.getElementById('req-send-btn');

    withBtnLoading(btn, true, 'Sending…');
    status.textContent = 'Sending...';

    try {
      const res = await fetchWithTimeout(SEND_REQUEST_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          technicalAccount: taId,
          to: owner,
          subject,
          reason,
          requester: userInfo?.email || ''
        })
      }, 10000);

      if (res && res.ok) {
        status.textContent = 'Request sent ✅';
        return;
      }

      // Fallback mailto
      window.location.href = buildMailto(owner, taId, subject, reason);
      status.textContent = 'Opened your email client to send the request.';
    } catch {
      // Fallback mailto
      window.location.href = buildMailto(owner, taId, subject, reason);
      status.textContent = 'Opened your email client to send the request.';
    } finally {
      withBtnLoading(btn, false);
    }
  });
}

document.addEventListener('DOMContentLoaded', initializeUI);

// =======================================================
// === ProgressRing (SVG web component) ==================
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
