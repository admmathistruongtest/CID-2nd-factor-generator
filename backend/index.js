// index.js

const { Firestore, FieldValue } = require('@google-cloud/firestore');
const { totp } = require('otplib');
const { OAuth2Client } = require('google-auth-library');

const firestore = new Firestore();
const client = new OAuth2Client();
const ALLOWED_ORIGIN = 'https://cid-2nd-factor-generator.web.app';

// =======================================================
// === MIDDLEWARES & UTILITY FUNCTIONS
// =======================================================

/**
 * Handles CORS headers, OPTIONS requests, and basic Bearer token authentication.
 * Verifies the Google ID token and returns the user's email if valid.
 */
async function handleAuthAndCors(req, res) {
    res.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS, POST');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');

    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return null;
    }

    const authHeader = req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        // No structured log needed here, as it might be a preflight or unauthenticated request
        res.status(401).send('Accès non autorisé : Jeton manquant.');
        return null;
    }

    const idToken = authHeader.split('Bearer ')[1];
    try {
        const ticket = await client.verifyIdToken({
            idToken: idToken,
            audience: '1075661736654-kampgefcq1iiuteerqjh1fm56fdj4q93.apps.googleusercontent.com',
        });
        return ticket.getPayload().email;
    } catch (error) {
        console.error(JSON.stringify({
            severity: "ERROR",
            event: "tokenVerificationFailed",
            errorMessage: error.message
        }));
        res.status(401).send('Accès non autorisé : Jeton invalide.');
        return null;
    }
}

/**
 * Checks if a given email address belongs to an administrator
 * by looking up the '_config/admins' document in Firestore.
 */
async function verifyAdmin(email) {
    if (!email) return false;
    try {
        const adminDoc = await firestore.collection('_config').doc('admins').get();
        if (!adminDoc.exists) {
            console.warn("Le document de configuration des admins est introuvable.");
            return false;
        }
        const adminEmails = adminDoc.data().emails || [];
        return adminEmails.includes(email);
    } catch (error) {
        console.error("Erreur lors de la vérification de l'admin :", error);
        return false; // Fail securely
    }
}

/**
 * Middleware specifically for admin functions.
 * Authenticates the user and verifies admin privileges.
 * Returns the admin's email if authorized, null otherwise.
 */
async function handleAdminAuth(req, res) {
    const email = await handleAuthAndCors(req, res);
    if (!email) return null; // Authentication failed or OPTIONS request

    if (!(await verifyAdmin(email))) {
        console.warn(JSON.stringify({
            severity: "WARNING",
            event: "adminAccessAttemptDenied",
            user: email,
            reason: "User is not an administrator"
        }));
        res.status(403).send("Accès refusé : Droits administrateur requis.");
        return null;
    }
    return email; // User is authenticated and is an admin
}

// =======================================================
// === USER FUNCTIONS (index.html)
// =======================================================

/**
 * [USER] Retrieves the list of CIDs the authenticated user is authorized to access.
 */
exports.getUserCIDs = async (req, res) => {
    const userEmail = await handleAuthAndCors(req, res);
    if (!userEmail) return; // Response handled by middleware

    try {
        const snapshot = await firestore.collection('utilisateurs')
                                      .where('authorizedUsers', 'array-contains', userEmail)
                                      .get();
        const grantedCIDs = snapshot.docs.map(doc => doc.id);
        res.status(200).json(grantedCIDs);
    } catch (error) {
        console.error(`Erreur dans getUserCIDs pour ${userEmail}:`, error);
        res.status(500).send("Erreur interne du serveur.");
    }
};

/**
 * [USER] Generates the next 10 TOTP tokens for a given CID,
 * if the authenticated user has permission.
 */
exports.getNext10Tokens = async (req, res) => {
    const userEmail = await handleAuthAndCors(req, res);
    if (!userEmail) return; // Response handled by middleware

    const { cid } = req.body;
    if (!cid) {
        return res.status(400).send("Erreur : le paramètre 'cid' est manquant.");
    }

    try {
        const docId = String(cid).trim();
        const userPermissionDoc = await firestore.collection('utilisateurs').doc(docId).get();

        if (!userPermissionDoc.exists || !userPermissionDoc.data().authorizedUsers?.includes(userEmail)) {
            console.warn(JSON.stringify({
                severity: "WARNING",
                event: "tokenAccessDenied",
                user: userEmail,
                requestedCID: cid,
                reason: "Permission not granted or CID does not exist"
            }));
            return res.status(403).send("Accès refusé : permission non accordée pour ce CID ou CID inexistant.");
        }

        const accountDoc = await firestore.collection('comptes').doc(docId).get();
        if (!accountDoc.exists) {
            console.error(`Erreur critique: Permission accordée pour ${cid} mais compte introuvable.`);
            return res.status(404).send(`Secret introuvable pour le CID ${cid}.`);
        }
        const secret = accountDoc.data()['totp secret'];
        if (!secret) {
             console.error(`Erreur critique: Compte ${cid} trouvé mais champ 'totp secret' manquant.`);
            return res.status(404).send(`Champ 'totp secret' manquant pour le CID ${cid}.`);
        }

        // Log successful access *before* generating tokens
        console.log(JSON.stringify({
            severity: "INFO",
            event: "tokenAccessGranted",
            user: userEmail,
            requestedCID: cid
        }));

        const tokens = [];
        const step = 30;
        const cleanSecret = secret.replace(/\s/g, ''); // Ensure secret has no spaces
        for (let i = 0; i < 10; i++) {
            const timestamp = Date.now() + (i * step * 1000);
            tokens.push({
                timestamp: timestamp,
                token: totp.generate(cleanSecret, { timestamp, step })
            });
        }
        res.status(200).json(tokens);

    } catch (error) {
        console.error(`Erreur dans getNext10Tokens pour l'utilisateur ${userEmail} et le CID ${cid}:`, error);
        res.status(500).send("Erreur interne du serveur.");
    }
};

// =======================================================
// === MANAGER FUNCTIONS (manage.html)
// =======================================================

/**
 * [MANAGER] Retrieves the CIDs managed by the authenticated user
 * and the list of authorized users for each.
 */
exports.getManagedCIDsAndUsers = async (req, res) => {
    const managerEmail = await handleAuthAndCors(req, res); // Standard authentication
    if (!managerEmail) return;

    try {
        const snapshot = await firestore.collection('utilisateurs')
                                      .where('managers', 'array-contains', managerEmail)
                                      .get();

        if (snapshot.empty) {
            return res.status(200).json([]); // Return empty array if user manages no CIDs
        }

        const managedData = snapshot.docs.map(doc => ({
            cid: doc.id,
            authorizedUsers: doc.data().authorizedUsers || [],
        }));

        res.status(200).json(managedData);

    } catch (error) {
        console.error(`Erreur dans getManagedCIDsAndUsers pour ${managerEmail}:`, error);
        res.status(500).send("Erreur interne du serveur.");
    }
};

/**
 * [MANAGER] Grants access to a user for a managed CID.
 * Verifies that the caller is a manager for the specific CID.
 */
exports.managerGrantAccess = async (req, res) => {
    const managerEmail = await handleAuthAndCors(req, res); // Standard authentication
    if (!managerEmail) return;

    const { cid, userToGrant } = req.body;
    if (!cid || !userToGrant) {
        return res.status(400).send("Les champs 'cid' et 'userToGrant' sont requis.");
    }

    const cidDocId = String(cid).trim();
    const utilisateurRef = firestore.collection('utilisateurs').doc(cidDocId);

    try {
        const doc = await utilisateurRef.get();
        if (!doc.exists) {
            return res.status(404).send("CID introuvable.");
        }
        const managers = doc.data().managers || [];

        // === MANAGER VERIFICATION ===
        if (!managers.includes(managerEmail)) {
            console.warn(JSON.stringify({
                severity: "WARNING",
                event: "managerActionDenied",
                user: managerEmail,
                action: "GRANT_ACCESS",
                targetCID: cid,
                targetUser: userToGrant,
                reason: "User is not a manager for this CID"
            }));
            return res.status(403).send("Accès refusé : Vous n'êtes pas manager de ce CID.");
        }
        // ===========================

        await utilisateurRef.update({ authorizedUsers: FieldValue.arrayUnion(userToGrant) });

        console.log(JSON.stringify({
            severity: "INFO",
            event: "managerAction",
            action: "ACCESS_GRANTED",
            managerUser: managerEmail,
            targetCID: cid,
            targetUser: userToGrant
        }));
        res.status(200).send(`Accès accordé à "${userToGrant}" pour "${cid}".`);

    } catch (error) {
        console.error(`Erreur dans managerGrantAccess par ${managerEmail} pour ${cid}:`, error);
        res.status(500).send("Erreur interne du serveur.");
    }
};

/**
 * [MANAGER] Revokes access for a user from a managed CID.
 * Verifies that the caller is a manager for the specific CID.
 */
exports.managerRevokeAccess = async (req, res) => {
    const managerEmail = await handleAuthAndCors(req, res); // Standard authentication
    if (!managerEmail) return;

    const { cid, userToRevoke } = req.body;
    if (!cid || !userToRevoke) {
        return res.status(400).send("Les champs 'cid' et 'userToRevoke' sont requis.");
    }

    const cidDocId = String(cid).trim();
    const utilisateurRef = firestore.collection('utilisateurs').doc(cidDocId);

    try {
        const doc = await utilisateurRef.get();
        if (!doc.exists) {
            return res.status(404).send("CID introuvable.");
        }
        const managers = doc.data().managers || [];

        // === MANAGER VERIFICATION ===
        if (!managers.includes(managerEmail)) {
            console.warn(JSON.stringify({
                severity: "WARNING",
                event: "managerActionDenied",
                user: managerEmail,
                action: "REVOKE_ACCESS",
                targetCID: cid,
                targetUser: userToRevoke,
                reason: "User is not a manager for this CID"
            }));
            return res.status(403).send("Accès refusé : Vous n'êtes pas manager de ce CID.");
        }
        // ===========================

        await utilisateurRef.update({ authorizedUsers: FieldValue.arrayRemove(userToRevoke) });

        console.log(JSON.stringify({
            severity: "INFO",
            event: "managerAction",
            action: "ACCESS_REVOKED",
            managerUser: managerEmail,
            targetCID: cid,
            targetUser: userToRevoke
        }));
        res.status(200).send(`Accès révoqué pour "${userToRevoke}" sur "${cid}".`);

    } catch (error) {
        console.error(`Erreur dans managerRevokeAccess par ${managerEmail} pour ${cid}:`, error);
        res.status(500).send("Erreur interne du serveur.");
    }
};


// =======================================================
// === ADMIN FUNCTIONS (admin.html)
// =======================================================

/**
 * [ADMIN] Grants access to a user for any CID.
 */
exports.adminGrantAccess = async (req, res) => {
    const adminEmail = await handleAdminAuth(req, res); // Verifies admin
    if (!adminEmail) return;

    const { cid, userToGrant } = req.body;
    if (!cid || !userToGrant) {
        return res.status(400).send("Les champs 'cid' et 'userToGrant' sont requis.");
    }

    const utilisateurRef = firestore.collection('utilisateurs').doc(String(cid).trim());
    try {
        // Use set with merge:true to create the doc if it doesn't exist
        await utilisateurRef.set({
            authorizedUsers: FieldValue.arrayUnion(userToGrant)
        }, { merge: true });

        console.log(JSON.stringify({
            severity: "INFO",
            event: "adminAction",
            action: "ACCESS_GRANTED",
            adminUser: adminEmail,
            targetCID: cid,
            targetUser: userToGrant
        }));
        res.status(200).send("Permission accordée avec succès.");
    } catch (error) {
        console.error(`Erreur dans adminGrantAccess par ${adminEmail} pour ${cid}:`, error);
        res.status(500).send("Erreur interne du serveur.");
    }
};

/**
 * [ADMIN] Revokes access for a user from any CID.
 */
exports.adminRevokeAccess = async (req, res) => {
    const adminEmail = await handleAdminAuth(req, res); // Verifies admin
    if (!adminEmail) return;

    const { cid, userToRevoke } = req.body;
    if (!cid || !userToRevoke) {
        return res.status(400).send("Les champs 'cid' et 'userToRevoke' sont requis.");
    }

    const utilisateurRef = firestore.collection('utilisateurs').doc(String(cid).trim());
    try {
        // Use update, will fail if doc doesn't exist (which is okay)
        await utilisateurRef.update({
            authorizedUsers: FieldValue.arrayRemove(userToRevoke)
        });

        console.log(JSON.stringify({
            severity: "INFO",
            event: "adminAction",
            action: "ACCESS_REVOKED",
            adminUser: adminEmail,
            targetCID: cid,
            targetUser: userToRevoke
        }));
        res.status(200).send("Permission révoquée avec succès.");
    } catch (error) {
        // Handle cases where the document might not exist gracefully
        if (error.code === 5) { // Firestore code for NOT_FOUND
             console.warn(`Tentative par ${adminEmail} de révoquer l'accès pour ${userToRevoke} sur ${cid} inexistant.`);
             res.status(404).send("CID introuvable.");
        } else {
            console.error(`Erreur dans adminRevokeAccess par ${adminEmail} pour ${cid}:`, error);
            res.status(500).send("Erreur interne du serveur.");
        }
    }
};

/**
 * [ADMIN] Retrieves a list of all CIDs and their authorized users/managers.
 */
exports.adminGetAllPermissions = async (req, res) => {
    const adminEmail = await handleAdminAuth(req, res); // Verifies admin
    if (!adminEmail) return;

    try {
        const snapshot = await firestore.collection('utilisateurs').get();
        const permissions = snapshot.docs.map(doc => ({
            cid: doc.id,
            authorizedUsers: doc.data().authorizedUsers || [],
            managers: doc.data().managers || [] // Include managers for the admin view
        }));
        res.status(200).json(permissions);
    } catch (error) {
        console.error(`Erreur dans adminGetAllPermissions pour ${adminEmail}:`, error);
        res.status(500).send("Erreur interne du serveur.");
    }
};

/**
 * [ADMIN] Retrieves a unique list of all known users (users authorized for at least one CID).
 */
exports.adminGetKnownUsers = async (req, res) => {
    const adminEmail = await handleAdminAuth(req, res); // Verifies admin
    if (!adminEmail) return;

    try {
        const snapshot = await firestore.collection('utilisateurs').get();
        const allUsers = new Set();
        snapshot.docs.forEach(doc => {
            const users = doc.data().authorizedUsers || [];
            users.forEach(user => allUsers.add(user));
        });
        res.status(200).json(Array.from(allUsers).sort());
    } catch (error) {
        console.error(`Erreur dans adminGetKnownUsers pour ${adminEmail}:`, error);
        res.status(500).send("Erreur interne du serveur.");
    }
};

/**
 * [ADMIN] Designates a user as a Manager for a specific CID.
 */
exports.adminAddManager = async (req, res) => {
    const adminEmail = await handleAdminAuth(req, res); // Verifies admin
    if (!adminEmail) return;

    const { cid, managerEmail } = req.body;
    if (!cid || !managerEmail) {
        return res.status(400).send("Les champs 'cid' et 'managerEmail' sont requis.");
    }

    const utilisateurRef = firestore.collection('utilisateurs').doc(String(cid).trim());
    try {
        // Use set with merge:true to create the 'managers' field if it doesn't exist
        await utilisateurRef.set({ managers: FieldValue.arrayUnion(managerEmail) }, { merge: true });

        console.log(JSON.stringify({
            severity: "INFO",
            event: "adminAction",
            action: "MANAGER_ADDED",
            adminUser: adminEmail,
            targetCID: cid,
            targetManager: managerEmail
        }));
        res.status(200).send(`"${managerEmail}" est maintenant manager de "${cid}".`);
    } catch (error) {
        console.error(`Erreur dans adminAddManager par ${adminEmail} pour ${cid}:`, error);
        res.status(500).send("Erreur interne du serveur.");
    }
};

/**
 * [ADMIN] Removes the Manager role from a user for a specific CID.
 */
exports.adminRemoveManager = async (req, res) => {
    const adminEmail = await handleAdminAuth(req, res); // Verifies admin
    if (!adminEmail) return;

    const { cid, managerEmail } = req.body;
    if (!cid || !managerEmail) {
        return res.status(400).send("Les champs 'cid' et 'managerEmail' sont requis.");
    }

    const utilisateurRef = firestore.collection('utilisateurs').doc(String(cid).trim());
    try {
        // Use update, will fail if doc doesn't exist (okay) or field doesn't exist (okay)
        await utilisateurRef.update({ managers: FieldValue.arrayRemove(managerEmail) });

        console.log(JSON.stringify({
            severity: "INFO",
            event: "adminAction",
            action: "MANAGER_REMOVED",
            adminUser: adminEmail,
            targetCID: cid,
            targetManager: managerEmail
        }));
        res.status(200).send(`"${managerEmail}" n'est plus manager de "${cid}".`);
    } catch (error) {
         if (error.code === 5) { // Firestore code for NOT_FOUND
             console.warn(`Tentative par ${adminEmail} de retirer ${managerEmail} comme manager sur ${cid} inexistant.`);
             res.status(404).send("CID introuvable.");
        } else {
            console.error(`Erreur dans adminRemoveManager par ${adminEmail} pour ${cid}:`, error);
            res.status(500).send("Erreur interne du serveur.");
        }
    }
};