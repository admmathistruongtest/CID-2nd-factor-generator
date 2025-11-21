# Technical Accounts Authenticator (TA Auth)

Web application used to generate 2nd-factor TOTP codes for **Technical Accounts (TA)**, and to manage who is allowed to use each TA.

The app is designed for internal usage (employees only) and relies on:

- **Frontend**: static HTML/CSS/JS hosted on **Firebase Hosting**
- **Auth**: **Google Sign-In (GSI)** – users sign in with their corporate Google account
- **Backend**: **Google Cloud Functions** (or Cloud Run) in `europe-west1`
- **Data**: **Firestore** for TA permissions and TOTP secrets
- **Monitoring**: Cloud Logging + **BigQuery sink** for audit logs

> 🔁 Legacy term `cid` is **deprecated** and replaced everywhere by **`TA` / `technicalAccount`** (code, Firestore, logs, docs).

---

## 1. Main features

1. **Google Sign-In**
   - User signs in with Google (GSI client).
   - The frontend receives an **ID token (JWT)** via `handleCredentialResponse`.
   - This `idToken` is sent as a `Bearer` token to all backend endpoints.

2. **List of Technical Accounts (TAs)**
   - Backend endpoint `/getUserTechnicalAccounts` returns the list of TAs assigned to the signed-in user.
   - Frontend renders one **card per TA** (email-like identifier: `ta-xxx@...`).

3. **TOTP code generation**
   - When user clicks **“Show code”** on a TA card:
     - Frontend calls `/getNext10Tokens` with the TA and the `idToken`.
     - Backend checks permissions in Firestore, retrieves the TOTP secret, and uses an OTP library to generate the **next 10 tokens**.
     - Frontend stores these tokens in memory and uses `setInterval` every second to:
       - pick the current token based on `timestamp`,
       - display the 6-digits code,
       - update the circular **progress ring**.

4. **Manage users for a TA**
   - On each card, button **“Manage users”** opens a full-screen overlay listing authorized users for that TA.
   - From the overlay, an owner can:
     - **Add a user** (email) → `/userGrantAccess`
     - **Revoke a user** → `/userRevokeAccess`
   - Revocation shows a **custom confirmation modal** (no `window.confirm()` → compatible with Google Sites sandbox).

5. **Request access (if TA not listed)**
   - Link **“No technical account? Send a request”** opens a dedicated overlay.
   - Flow:
     1. User enters an exact TA email.
     2. Frontend calls **lookup endpoints** to find the TA owners:
        - `/lookupTechnicalAccountUsers`
        - `/lookupTechnicalAccount`
        - fallback: `/getTechAccountUsers`
     3. Owners are listed; user chooses an owner and writes a message.
     4. Frontend calls `/sendAccessRequestEmail` to send a structured email to the chosen owner.

6. **Audit logging**
   - Each backend endpoint logs a structured JSON on `stdout` (Cloud Logging).
   - A **Log Router sink** sends `run.googleapis.com%2Fstdout` to BigQuery.
   - Logs contain fields such as:
     - `event`, `ta`, `user` (who), `targetUser` (for grant/revoke), `batch`, etc.

---

## 2. Vocabulary & domain model

- **TA / Technical Account**: a shared account used to log in to some external service; identified by an email (e.g. `example-auth@test.airliquide.com`).
- **User**: employee using the app; identified by their Google account email.
- **TA owner / authorized user**: a user who:
  - can see the TOTP codes for a given TA,
  - and optionally can manage the list of authorized users for that TA.

---

## 3. Architecture overview

High-level architecture:

- **Frontend (Firebase Hosting)**
  - `index.html` (login + cards + overlays)
  - `style.css` (layout, cards, overlays, modals)
  - `script.js` (all JS logic: auth, API calls, UI updates)
  - Custom Web Component `<progress-ring>` for the countdown ring.

- **Auth**
  - Google Identity Services (GSI):
    - GSI script: `https://accounts.google.com/gsi/client`
    - `idToken` decoded client-side only to get user info (avatar, email), and then forwarded to backend as `Authorization: Bearer <idToken>`.

- **Backend**
  - Deployed as Google Cloud Functions or Cloud Run HTTP services, all under a common base URL:
    - `https://europe-west1-<project-id>.cloudfunctions.net`
  - Stateless functions:
    - `getUserTechnicalAccounts`
    - `getNext10Tokens`
    - `getTechAccountUsers`
    - `userGrantAccess`
    - `userRevokeAccess`
    - `lookupTechnicalAccountUsers`
    - `lookupTechnicalAccount`
    - `sendAccessRequestEmail`

- **Data layer (Firestore)**
  - Example collections (names can be adapted to your actual schema):
    - `utilisateurs`:
      - links **user email** ↔ **TA ID**
      - used for permission checks and “Manage users”
    - `compteurs`:
      - stores **TOTP secret** for each TA
    - optional `requests` or `audit`:
      - stores access requests or long-term audit trail.

- **Monitoring & audit**
  - Cloud Logging for all requests.
  - Log Router sink → BigQuery table with JSON payload for analytics and compliance.

---

## 4. Main user flows (sequence diagrams)

> 🔎 Insert your updated **PlantUML** or **images** here.  
> Below are the four flows we currently model.

1. **Login + load TAs**  
<img width="1289" height="809" alt="diagram-login-load-ta" src="https://github.com/user-attachments/assets/8abe2bc1-0171-4a73-8d9b-24422dfd30e2" />

2. **Show TOTP code for a TA**  
<img width="1249" height="821" alt="diagram-totp" src="https://github.com/user-attachments/assets/f8557f58-a3b6-44b7-80a3-28503c5b061d" />

3. **Manage users (add / revoke with confirmation modal)**  
<img width="1242" height="1163" alt="diagram-manage-user" src="https://github.com/user-attachments/assets/1ae941a7-1809-481e-834f-41a2f6b0531b" />

4. **Request access (lookup TA + send request email)**  
<img width="1847" height="1921" alt="diagram-request-unofficial" src="https://github.com/user-attachments/assets/0c7b966f-bfc1-4a92-8c82-68ac53de137c" />

You can embed them as images in the README:







## 5. Frontend details

### 5.1 Files

- `index.html`
  - Login section (`#auth-container`) with GSI button.
  - App section (`#app-container`) with:
    - top bar: search, user profile, logout menu;
    - list of TA cards (`#cid-list` → **to be renamed** to `#ta-list`).
  - Overlays:
    - `#users-overlay` – Manage users for a TA.
    - `#request-overlay` – Request access to a TA.
    - `#confirm-modal` – confirmation dialog for revoke.

- `style.css`
  - Layout (top header, cards, wrap, etc.)
  - Cards styling.
  - Shared overlay styles: `.overlay`, `.overlay-panel`, `.overlay-backdrop`.
  - `.no-scroll` on `<body>` when an overlay is open.
  - Styles for buttons (`.btn`, `.tiny`, `.icon-btn`, etc.).

- `script.js`
  - **Config & endpoints**:
    - `BASE_URL`
    - URLs for all Cloud Functions:
      - `GET_TA_URL` (`/getUserTechnicalAccounts`)
      - `GET_TOKENS_URL` (`/getNext10Tokens`)
      - `USER_GET_TA_USERS_URL` (`/getTechAccountUsers`)
      - `USER_GRANT_ACCESS_URL` (`/userGrantAccess`)
      - `USER_REVOKE_ACCESS_URL` (`/userRevokeAccess`)
      - lookup endpoints
      - `SEND_REQUEST_URL` (`/sendAccessRequestEmail`)
  - **Auth**:
    - `handleCredentialResponse(response)`
    - `parseJwt(token)`
    - `signOut()`
  - **UI logic**:
    - `renderTaList(tas)` – renders TA cards.
    - `fetchAndDisplayTokens(taId)` / `updateTokenDisplay(taId)` – TOTP code logic.
    - `openOverlay(id)` / `closeOverlay(id)` – overlays management.
    - `openConfirmOverlay(message)` – custom confirmation modal for revoke.
    - Event delegation for:
      - search input,
      - “Show code” buttons,
      - “Manage users” buttons,
      - add user, filter users,
      - request access overlay,
      - confirm revoke.
  - **API helpers**:
    - `fetchWithTimeout(url, options, timeoutMs)`
    - `userGrant(taId, email)`
    - `userRevoke(taId, email)`
    - `loadUserTechnicalAccounts()`
    - `loadTaUsers(taId)`
    - `requestLookupExact(technicalAccount)`.
  - **Components**:
    - `<progress-ring>` web component for the circular countdown.

### 5.2 Google Sites integration

When embedded in **Google Sites**:

- The app is loaded inside a sandboxed `<iframe>` with restricted features.
- Native dialogs (`alert`, `confirm`, `prompt`) may be **blocked**:
  - calling `window.confirm()` logs a warning:
    - *"Ignored call to confirm(). The document is sandboxed and the allow-modals keyword is not set."*
- To support revoke confirmation, the app uses a **custom modal overlay** (`#confirm-modal`) instead of `window.confirm()`:
  - `openConfirmOverlay(message)`:
    - shows the overlay,
    - returns a `Promise<boolean>` that resolves to `true` or `false` depending on user action.

This makes the revoke flow compatible both **standalone** (Firebase Hosting) and **embedded** (Google Sites).

---

## 6. Backend API (Cloud Functions)

All endpoints expect a **valid Google ID token** in the `Authorization` header:

- `Authorization: Bearer <idToken>`

The backend must:

1. Verify the ID token (signature, audience, expiry).
2. Extract the user email (subject) for:
   - authorization checks,
   - logging / audit.

Below are the main endpoints.

### 6.1 `GET /getUserTechnicalAccounts`

Returns the list of TAs the current user is allowed to use.

- **Method**: `GET`
- **Headers**:
  - `Authorization: Bearer <idToken>`

**Response 200 example**:

```json
[
  "ta-example@test.airliquide.com",
  "ta-other@test.airliquide.com"
]
```

Error :

401/403 if iD token invalid or user not allowed.


## 6.2 POST /getNext10Tokens

Returns the next 10 TOTP tokens for a TA.

* **Request:** POST
* **Body:**

```json
{
  "technicalAccount": "ta-example@test.airliquide.com"
}
```

**Response 200 example:**

```json
[
  { "token": "123456", "timestamp": 1732195200000 },
  { "token": "789012", "timestamp": 1732195230000 }
]
```

* `timestamp` is the start time (ms epoch) of the 30s window for the token.

**Errors:**
* **403 Forbidden** – user not authorized for this TA.
* **404 Not Found** – TA or secret does not exist.
* **5xx** – internal errors (Firestore, OTP library, etc.).

---

## 6.3 POST /getTechAccountUsers

Returns the list of authorized users for a given TA (used by Manage Users).

* **Request:** POST
* **Body:**

```json
{
  "technicalAccount": "ta-example@test.airliquide.com"
}
```

**Response 200 example:**

```json
[
  "owner1@test.airliquide.com",
  "user2@test.airliquide.com"
]
```

---

## 6.4 POST /userGrantAccess

Grants a user access to a TA.

* **Request:** POST
* **Body:**

```json
{
  "technicalAccount": "ta-example@test.airliquide.com",
  "userToGrant": "userX@test.airliquide.com"
}
```

**Behavior:**
* Validates that current user has rights to manage this TA (owner / admin).
* Adds or updates Firestore documents to link `userToGrant` with the TA.
* Logs a structured event to stdout.

---

## 6.5 POST /userRevokeAccess

Revokes a user’s access to a TA.

* **Request:** POST
* **Body:**

```json
{
  "technicalAccount": "ta-example@test.airliquide.com",
  "userToRevoke": "userY@test.airliquide.com"
}
```

**Behavior:**
* Validates that current user can manage this TA.
* Removes or updates Firestore document(s) to revoke `userToRevoke`.
* Logs a structured event to stdout.

In the frontend, this call is only made after user confirmation via the custom `#confirm-modal`.

---

## 6.6 Lookup endpoints (Request Access)

Used by the Request access flow to discover TA owners.

### 6.6.1 GET /lookupTechnicalAccountUsers
Looks up owners or authorized users for a given TA.

* **Request:** GET
* **Query:** `?technicalAccount=ta-example@test.airliquide.com`

**Response 200 example:**

```json
{
  "owners": [
    "owner1@test.airliquide.com",
    "owner2@test.airliquide.com"
  ]
}
```

If the backend returns only an array, the frontend adapts owners from that.

---

### 6.6.2 GET /lookupTechnicalAccount
Alternate lookup endpoint with more flexible response.

* **Request:** GET
* **Query:** `?technicalAccount=ta-example@test.airliquide.com`

**Possible response example:**

```json
{
  "owners": ["owner1@test.airliquide.com"],
  "authorizedUsers": ["user1@test.airliquide.com", "user2@test.airliquide.com"],
  "meta": { "source": "directory" }
}
```

The frontend extracts owners using a helper that understands different shapes.

---

### 6.6.3 Fallback: POST /getTechAccountUsers
If both lookup endpoints fail (404 / 5xx / not implemented), the frontend falls back to `getTechAccountUsers` to at least list current authorized users.

---

## 6.7 POST /sendAccessRequestEmail

Sends a structured access request email to a TA owner.

* **Request:** POST
* **Body example:**

```json
{
  "technicalAccount": "ta-example@test.airliquide.com",
  "owner": "owner1@test.airliquide.com",
  "requester": "user@test.airliquide.com",
  "subject": "Access request for ta-example@test.airliquide.com (Authenticator)",
  "reason": "Short explanation of why access is needed"
}
```

**Behavior:**
1.  Optionally stores the request in Firestore (for audit / tracking).
2.  Sends an email via a mail provider / SMTP / internal email service.
3.  Logs a structured event `accessRequest.sent` to stdout.

---

## 7. Data model (Firestore)

This section describes a possible schema; adjust names to match your actual collections / fields.

### 7.1 Collection `utilisateurs`

Represents authorized users per TA.

**Document example:**

```json
{
  "user": "user@test.airliquide.com",
  "ta": "ta-example@test.airliquide.com",
  "role": "owner",          // or "user"
  "createdAt": "2025-11-19T09:56:00Z"
}
```

**Usage:**
* `getUserTechnicalAccounts` – query by user → list TAs.
* `getTechAccountUsers` – query by ta → list users.
* `userGrantAccess` / `userRevokeAccess` – create / delete / update documents.

---

### 7.2 Collection `compteurs` (or `technicalAccounts`)

Stores TOTP secret and metadata for each TA.
Document id can be an encoded TA email.

**Example:**

```json
{
  "ta": "ta-example@test.airliquide.com",
  "secret": "BASE32_TOTP_SECRET",
  "createdAt": "2025-11-19T09:00:00Z"
}
```

**Usage:**
* `getNext10Tokens`:
    * find the document by TA or encoded TA,
    * read secret,
    * generate tokens.

---

### 7.3 Optional: collection `requests` / `audit`

If you need long-term tracking of access requests or admin actions, you can maintain a dedicated collection:

```json
{
  "type": "accessRequest",
  "ta": "ta-example@test.airliquide.com",
  "owner": "owner1@test.airliquide.com",
  "requester": "user@test.airliquide.com",
  "subject": "Access request for ta-example@test.airliquide.com (Authenticator)",
  "reason": "Some reason",
  "createdAt": "2025-11-19T10:00:00Z",
  "status": "sent"
}
```

---

## 8. Auth & security

* Only authenticated Google accounts can access the app.
* **Backend never trusts the frontend:**
    * Always verifies ID token with Google public keys.
    * Always uses backend permission checks (Firestore) to decide:
        * which TAs a user can see,
        * whether they can see tokens,
        * whether they can grant/revoke access.
* CORS & preflight are handled by each Cloud Function (OPTIONS) to allow:
    * direct use from Firebase Hosting,
    * optional embed in Google Sites.

---

## 9. Logging & BigQuery

### 9.1 Logging pattern

Each Cloud Function logs a structured JSON to stdout, for example:

```javascript
console.log(JSON.stringify({
  event: "getNext10Tokens.success",
  ta: technicalAccount,
  user: userEmail,
  batch: tokens.length,
  timestamp: new Date().toISOString()
}));
```

For revoke:

```javascript
console.log(JSON.stringify({
  event: "userRevokeAccess.success",
  ta: technicalAccount,
  user: currentUser,
  targetUser: userToRevoke,
  timestamp: new Date().toISOString()
}));
```

Error example:

```javascript
console.error(JSON.stringify({
  event: "userRevokeAccess.error",
  ta: technicalAccount,
  user: currentUser,
  targetUser: userToRevoke,
  error: err.message,
  timestamp: new Date().toISOString()
}));
```

These logs appear under:
* `logName = projects/<project-id>/logs/run.googleapis.com%2Fstdout` (or similar for Cloud Functions).

---

### 9.2 Log Router sink → BigQuery

* **Source:** `resource.type="cloud_run_revision"` (or `cloud_function`).
* **logName filter (example):**

```text
logName = (
  "projects/<project-id>/logs/run.googleapis.com%2Fstdout"
)
```

All logs from stdout go to a BigQuery table, for example:
* `project.dataset.ta_auth_logs`

**Query example:**

```sql
SELECT
  timestamp,
  jsonPayload.event,
  jsonPayload.ta,
  jsonPayload.user,
  jsonPayload.targetUser
FROM `project.dataset.ta_auth_logs`
WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
ORDER BY timestamp DESC;
```

---

## 10. Local development

1.  **Clone the repo:**

    ```bash
    git clone <repo-url>
    cd <repo>
    ```

2.  **Install tools:**
    * Node.js (LTS)
    * Firebase CLI (if using Firebase Functions / Hosting)
    * gcloud CLI (if using Cloud Functions / Cloud Run directly)

3.  **Frontend:**
    * Serve the static files from a local HTTP server or via Firebase:

    ```bash
    firebase serve --only hosting
    # or
    npx serve .
    ```

4.  **Backend:**
    * If using Firebase Functions:
        ```bash
        firebase emulators:start --only functions
        ```
    * If using Cloud Run / Google Cloud Functions:
        * use local emulators,
        * or deploy to a dev project and point `BASE_URL` to that project.

5.  **Config:**
    * Ensure `BASE_URL` in `script.js` points to the correct dev backend.
    * Set the correct Google Sign-In client ID in `index.html`.

---

## 11. Deployment

### 11.1 Frontend (Firebase Hosting)

```bash
firebase deploy --only hosting
```

This uploads:
* `index.html`
* `style.css`
* `script.js`
* and all static assets (favicon, etc.).

### 11.2 Backend (Cloud Functions / Cloud Run)

Depending on your stack:

* **Firebase Functions:**

    ```bash
    firebase deploy --only functions
    ```

* **Google Cloud Functions or Cloud Run using gcloud:**

    ```bash
    gcloud functions deploy getUserTechnicalAccounts ...
    gcloud functions deploy getNext10Tokens ...
    # etc.
    ```

**After deployment:**
* Check that:
    * `BASE_URL` in `script.js` points to the correct region and project.
    * CORS origin includes your Firebase Hosting domain and (optionally) Google Sites iframe origin.

---

## 12. Migration note: cid → ta

This repo historically used the term `cid` for Technical Accounts.

The current version:
* Uses `ta` / `technicalAccount` in all new code and docs.
* Any remaining `cid` identifiers in code are considered legacy and should be progressively renamed:
    * frontend DOM IDs: `cid-list` → `ta-list`
    * Firestore fields: `cid` → `ta`
    * logs: `cid` → `ta`
    * diagrams: already updated to TA.
