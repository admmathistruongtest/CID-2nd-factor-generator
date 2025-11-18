# Technical Accounts Authenticator

A tiny, self-hosted tool for sharing **time-based 2FA codes (TOTP)** for internal “technical accounts”.  
Users sign in with Google, see only the accounts they’re authorized for, reveal a 30-second code with a progress ring, and (optionally) request access from current owners.

---

## TL;DR (Quick start)

1. **Create a Google OAuth Web client** (for the front-end).
2. **Enable Firestore** (Native mode) and **Cloud Functions** in your GCP project.
3. **Deploy the functions** in `/functions` (Node.js 20).
4. **Host the front-end** (any static hosting or Firebase Hosting).
5. Configure the front-end:
   - In `public/index.html`:
     ```html
     <div id="g_id_onload"
          data-client_id="YOUR_GOOGLE_OAUTH_CLIENT_ID"
          data-callback="handleCredentialResponse"></div>
     ```
   - In `public/script.js`:
     ```js
     const BASE_URL = "https://<region>-<project>.cloudfunctions.net";
     ```
6. Create Firestore docs in collection `technical_accounts`:
   ```json
   // doc id = the technical account identifier (often an email)
   {
     "totp": "BASE32SECRETWITHOUTSPACES",
     "authorizedUsers": ["owner1@yourco.com", "owner2@yourco.com"]
   }