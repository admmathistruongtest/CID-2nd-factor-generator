<img width="6647" height="4115" alt="Untitled diagram-2025-10-16-151022" src="https://github.com/user-attachments/assets/77b2994f-7910-4c74-bb1f-dc9fdd618a6b" />

# CID 2nd Factor Authenticator

## 🎯 Introduction

This web application provides Time-based One-Time Passwords (TOTP) for shared accounts (identified by CID emails), acting as a second-factor authentication mechanism. It features distinct interfaces for regular users, managers, and administrators, with permissions managed via Google Cloud Firestore. Authentication is handled using Google Sign-In.

## ✨ Features

* **User View (`index.html`):**
    * Login via Google Sign-In.
    * View only the CIDs they are assigned to manage.
    * Add/revoke user access *only* for their CIDs.
    * Display current TOTP code and validity countdown for each assigned CID.
    * Copy TOTP code to clipboard.
    * Search/filter assigned CIDs and Users.
* **Admin View (`admin.html`):**
    * Login via Google Sign-In (restricted to designated admin emails).
    * View *all* CIDs.
    * Add/revoke user access for *any* CID.
    * Assign/remove Managers for *any* CID.
    * Search/filter all CIDs, users, and managers.
    * Autocomplete suggestions for known users when adding permissions.
* **Backend (Google Cloud Functions):**
    * Securely verifies user identity via Google ID Tokens.
    * Fetches permissions from Firestore based on user roles (User, Manager, Admin).
    * Generates TOTP codes based on secrets stored in Firestore.
    * Handles permission updates (grant/revoke users, add/remove managers).
    * Logs access and administrative actions to Cloud Logging (configured to sink to BigQuery).

## 🛠️ Tech Stack

* **Frontend:** HTML5, CSS3, Vanilla JavaScript (ES6+)
* **Authentication:** Google Identity Services (Sign In With Google)
* **Backend:** Google Cloud Functions (Node.js)
* **Database:** Google Cloud Firestore
* **TOTP Generation:** `otplib` library
* **Logging:** Google Cloud Logging (with Sink to BigQuery)
* **Hosting:** Firebase Hosting

## 🚀 Setup & Installation

### Prerequisites

* Node.js (for backend development/deployment)
* Google Cloud SDK (`gcloud` CLI) installed and configured
* Firebase CLI (`firebase`) installed and configured (for hosting)
* A Google Cloud Project with Firestore, Cloud Functions, and necessary APIs enabled (IAM, Cloud Build, etc.).

### Backend Setup

1.  **Clone the Repository:** `git clone <your-repo-url>`
2.  **Navigate to Backend Directory:** `cd path/to/backend` (where `index.js` and `package.json` are)
3.  **Install Dependencies:** `npm install`
4.  **Firestore Setup:**
    * Ensure Firestore is in Native mode.
    * Create the following collections:
        * `comptes`: Stores CID details (`id cid`, `totp secret`). Document ID should be the CID email.
        * `utilisateurs`: Stores permissions. Document ID should be the CID email. Each document needs `authorizedUsers` (Array) and `managers` (Array) fields.
        * `_config`: Create a document named `admins` with a field `emails` (Array) listing the Google emails of administrators.
5.  **Google Authentication:**
    * Create OAuth 2.0 Client ID credentials (Type: Web Application) in the Google Cloud Console -> APIs & Services -> Credentials.
    * Note the **Client ID**.
    * Configure the OAuth Consent Screen.
6.  **Deploy Functions:** Deploy each function using the `gcloud functions deploy ...` commands (ensure correct runtime, region, and entry point). See previous deployment commands for reference.

### Frontend Setup

1.  **Navigate to Frontend Directory:** `cd path/to/frontend` (where `index.html`, `admin.html`, etc. are)
2.  **Configure Client ID:** Update the `data-client_id` attribute in `index.html`, `admin.html`, and `manage.html` with your Google OAuth Client ID.
3.  **Configure Cloud Function URLs:** Update the `BASE_URL` and specific function URL constants at the top of `script.js`, `admin.js`, and `manage.js`.
4.  **Firebase Hosting:**
    * Initialize Firebase if not done: `firebase init hosting` (choose your project, set public directory usually to `.`).
    * Deploy: `firebase deploy --only hosting`

## ⚙️ Configuration

* **Backend (`index.js`):**
    * `ALLOWED_ORIGIN`: Set to your Firebase Hosting URL.
    * `audience` in `client.verifyIdToken`: Must match your Google OAuth Client ID.
* **Frontend (`.js` files):**
    * `BASE_URL` constants must point to your Cloud Functions region URL.
* **Firestore (`_config/admins`):**
    * The `emails` array controls who can access `admin.html`.

## 📦 Deployment

* **Backend:** Use `gcloud functions deploy <FUNCTION_NAME> --runtime nodejs20 --trigger-http ...` for each function in `index.js`.
* **Frontend:** Use `firebase deploy --only hosting` from your frontend directory.
