// index.js

const { Firestore, FieldValue } = require('@google-cloud/firestore');
const { OAuth2Client } = require('google-auth-library');
const crypto = require('crypto'); // HMAC-SHA1

const firestore = new Firestore();
const client = new OAuth2Client();
const ALLOWED_ORIGIN = 'https://cid-2nd-factor-generator.web.app';

/* ==============================
   HELPERS TOTP (compat GA)
============================== */
function base32ToBuffer(base32) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = (base32 || '').toUpperCase().replace(/\s+/g, '').replace(/=+$/g, '');
  if (!clean || /[^A-Z2-7]/.test(clean)) throw new Error('Secret Base32 invalide.');
  let bits = '';
  for (let i = 0; i < clean.length; i++) bits += alphabet.indexOf(clean[i]).toString(2).padStart(5, '0');
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.substring(i, i + 8), 2));
  return Buffer.from(bytes);
}
function generateTotpAt(secretBase32, epochSec, step = 30, digits = 6) {
  const key = base32ToBuffer(secretBase32);
  const counter = Math.floor(epochSec / step);
  const msg = Buffer.alloc(8);
  const big = BigInt(counter);
  for (let i = 7; i >= 0; i--) msg[i] = Number((big >> BigInt((7 - i) * 8)) & 0xffn);
  const hmac = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[offset] & 0x7f) << 24) |
              ((hmac[offset + 1] & 0xff) << 16) |
              ((hmac[offset + 2] & 0xff) << 8) |
              (hmac[offset + 3] & 0xff);
  return (bin % 10 ** digits).toString().padStart(digits, '0');
}

/* ==============================
   MIDDLEWARES & UTILS
============================== */
async function handleAuthAndCors(req, res) {
  res.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS, POST');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');

  if (req.method === 'OPTIONS') { res.status(204).send(''); return null; }

  const authHeader = req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).send('Accès non autorisé : Jeton manquant.');
    return null;
  }

  const idToken = authHeader.split('Bearer ')[1];
  try {
    const ticket = await client.verifyIdToken({
      idToken,
      audience: '1075661736654-kampgefcq1iiuteerqjh1fm56fdj4q93.apps.googleusercontent.com',
    });
    return (ticket.getPayload().email || '').toLowerCase();
  } catch (error) {
    console.error(JSON.stringify({ severity: "ERROR", event: "tokenVerificationFailed", errorMessage: error.message }));
    res.status(401).send('Accès non autorisé : Jeton invalide.');
    return null;
  }
}

async function verifyAdmin(email) {
  if (!email) return false;
  try {
    const adminDoc = await firestore.collection('_config').doc('admins').get();
    if (!adminDoc.exists) return false;
    const adminEmails = (adminDoc.data().emails || []).map(e => (e || '').toLowerCase());
    return adminEmails.includes(email.toLowerCase());
  } catch (error) {
    console.error("Erreur lors de la vérification de l'admin :", error);
    return false;
  }
}

async function handleAdminAuth(req, res) {
  const email = await handleAuthAndCors(req, res);
  if (!email) return null;
  if (!(await verifyAdmin(email))) {
    console.warn(JSON.stringify({ severity: "WARNING", event: "adminAccessAttemptDenied", user: email }));
    res.status(403).send("Accès refusé : Droits administrateur requis.");
    return null;
  }
  return email;
}

function normEmail(v) { return String(v || '').trim().toLowerCase(); }
function normCid(v)   { return String(v || '').trim(); }

/* ==============================
   USER FUNCTIONS
============================== */

// Liste des CIDs accessibles par l'utilisateur
exports.getUserCIDs = async (req, res) => {
  const userEmail = await handleAuthAndCors(req, res);
  if (!userEmail) return;

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

// Génère 10 codes TOTP (GA compatible) pour un CID si l'user y a accès
exports.getNext10Tokens = async (req, res) => {
  console.log("--- RUNNING CODE VERSION 11.0 (Admin+User model) ---");

  const userEmail = await handleAuthAndCors(req, res);
  if (!userEmail) return;

  const cid = normCid(req.body?.cid);
  if (!cid) return res.status(400).send("Erreur : le paramètre 'cid' est manquant.");

  try {
    const uDoc = await firestore.collection('utilisateurs').doc(cid).get();
    const authz = (uDoc.exists && Array.isArray(uDoc.data().authorizedUsers)) ? uDoc.data().authorizedUsers.map(normEmail) : [];
    if (!uDoc.exists || !authz.includes(userEmail)) {
      console.warn(JSON.stringify({ severity: "WARNING", event: "tokenAccessDenied", user: userEmail, requestedCID: cid }));
      // Message générique pour éviter l'énumération
      return res.status(403).send("Accès refusé.");
    }

    const accountDoc = await firestore.collection('comptes').doc(cid).get();
    if (!accountDoc.exists) return res.status(404).send(`Secret introuvable pour le CID ${cid}.`);
    const secret = accountDoc.data()['totp secret'];
    if (!secret) return res.status(404).send(`Champ 'totp secret' manquant pour le CID ${cid}.`);

    const cleanSecret = secret.replace(/\s+/g, '').toUpperCase();
    const step = 30;
    const nowSec = Math.floor(Date.now() / 1000);
    const startSec = Math.floor(nowSec / step) * step;

    const tokens = [];
    for (let i = 0; i < 10; i++) {
      const epochSec = startSec + i * step;
      tokens.push({ timestamp: epochSec * 1000, token: generateTotpAt(cleanSecret, epochSec, step, 6) });
    }
    return res.status(200).json(tokens);
  } catch (error) {
    console.error(`Erreur dans getNext10Tokens pour ${userEmail} (${cid}):`, error?.stack || error);
    return res.status(500).send("Erreur interne du serveur.");
  }
};

/* === NOUVELLES ROUTES USER (plus de managers) ===========================
   - userGrantAccess: un user déjà autorisé sur <cid> peut ajouter d'autres users à CE <cid>.
   - userRevokeAccess: (optionnel) un user déjà autorisé peut aussi retirer un user de CE <cid>.
   ===================================================================== */

// [USER] Ajoute un utilisateur sur un CID si l'appelant est déjà autorisé sur ce CID
exports.userGrantAccess = async (req, res) => {
  const caller = await handleAuthAndCors(req, res);
  if (!caller) return;

  const cid = normCid(req.body?.cid);
  const userToGrant = normEmail(req.body?.userToGrant);
  if (!cid || !userToGrant) return res.status(400).send("Les champs 'cid' et 'userToGrant' sont requis.");

  try {
    const ref = firestore.collection('utilisateurs').doc(cid);
    const doc = await ref.get();

    const currentAuthz = (doc.exists && Array.isArray(doc.data().authorizedUsers)) ? doc.data().authorizedUsers.map(normEmail) : [];
    if (!doc.exists || !currentAuthz.includes(caller)) {
      console.warn(JSON.stringify({ severity: "WARNING", event: "userGrantDenied", caller, cid }));
      return res.status(403).send("Accès refusé.");
    }

    await ref.set({ authorizedUsers: FieldValue.arrayUnion(userToGrant) }, { merge: true });

    console.log(JSON.stringify({ severity: "INFO", event: "userGrantAccess", caller, cid, target: userToGrant }));
    return res.status(200).send(`Accès accordé à "${userToGrant}" pour "${cid}".`);
  } catch (error) {
    console.error(`Erreur userGrantAccess par ${caller} pour ${cid}:`, error);
    return res.status(500).send("Erreur interne du serveur.");
  }
};

// [USER] Retire un utilisateur d'un CID si l'appelant est déjà autorisé sur ce CID
exports.userRevokeAccess = async (req, res) => {
  const caller = await handleAuthAndCors(req, res);
  if (!caller) return;

  const cid = normCid(req.body?.cid);
  const userToRevoke = normEmail(req.body?.userToRevoke);
  if (!cid || !userToRevoke) return res.status(400).send("Les champs 'cid' et 'userToRevoke' sont requis.");

  try {
    const ref = firestore.collection('utilisateurs').doc(cid);
    const doc = await ref.get();

    const currentAuthz = (doc.exists && Array.isArray(doc.data().authorizedUsers)) ? doc.data().authorizedUsers.map(normEmail) : [];
    if (!doc.exists || !currentAuthz.includes(caller)) {
      console.warn(JSON.stringify({ severity: "WARNING", event: "userRevokeDenied", caller, cid }));
      return res.status(403).send("Accès refusé.");
    }

    await ref.update({ authorizedUsers: FieldValue.arrayRemove(userToRevoke) });
    console.log(JSON.stringify({ severity: "INFO", event: "userRevokeAccess", caller, cid, target: userToRevoke }));
    return res.status(200).send(`Accès révoqué pour "${userToRevoke}" sur "${cid}".`);
  } catch (error) {
    if (error.code === 5) return res.status(404).send("CID introuvable.");
    console.error(`Erreur userRevokeAccess par ${caller} pour ${cid}:`, error);
    return res.status(500).send("Erreur interne du serveur.");
  }
};

exports.getCidUsers = async (req, res) => {
  const email = await handleAuthAndCors(req, res);
  if (!email) return;

  const cid = String(req.query.cid || req.body?.cid || '').trim();
  if (!cid) return res.status(400).send("Paramètre 'cid' manquant.");

  try {
    const ref = firestore.collection('utilisateurs').doc(cid);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).send("CID introuvable.");

    const authorized = (doc.data().authorizedUsers || []).map(v => String(v || '').toLowerCase());
    if (!authorized.includes(email.toLowerCase())) return res.status(403).send("Accès refusé.");

    return res.status(200).json(authorized);
  } catch (e) {
    console.error("getCidUsers:", e);
    return res.status(500).send("Erreur interne du serveur.");
  }
};


/* ==============================
   ADMIN FUNCTIONS
============================== */

// Admin: ajoute un user sur n'importe quel CID
exports.adminGrantAccess = async (req, res) => {
  const adminEmail = await handleAdminAuth(req, res);
  if (!adminEmail) return;

  const cid = normCid(req.body?.cid);
  const userToGrant = normEmail(req.body?.userToGrant);
  if (!cid || !userToGrant) return res.status(400).send("Les champs 'cid' et 'userToGrant' sont requis.");

  try {
    const ref = firestore.collection('utilisateurs').doc(cid);
    await ref.set({ authorizedUsers: FieldValue.arrayUnion(userToGrant) }, { merge: true });
    console.log(JSON.stringify({ severity: "INFO", event: "adminGrantAccess", adminUser: adminEmail, cid, target: userToGrant }));
    res.status(200).send("Permission accordée avec succès.");
  } catch (error) {
    console.error(`Erreur adminGrantAccess par ${adminEmail} pour ${cid}:`, error);
    res.status(500).send("Erreur interne du serveur.");
  }
};

// Admin: retire un user de n'importe quel CID
exports.adminRevokeAccess = async (req, res) => {
  const adminEmail = await handleAdminAuth(req, res);
  if (!adminEmail) return;

  const cid = normCid(req.body?.cid);
  const userToRevoke = normEmail(req.body?.userToRevoke);
  if (!cid || !userToRevoke) return res.status(400).send("Les champs 'cid' et 'userToRevoke' sont requis.");

  try {
    const ref = firestore.collection('utilisateurs').doc(cid);
    await ref.update({ authorizedUsers: FieldValue.arrayRemove(userToRevoke) });
    console.log(JSON.stringify({ severity: "INFO", event: "adminRevokeAccess", adminUser: adminEmail, cid, target: userToRevoke }));
    res.status(200).send("Permission révoquée avec succès.");
  } catch (error) {
    if (error.code === 5) res.status(404).send("CID introuvable.");
    else res.status(500).send("Erreur interne du serveur.");
  }
};

// Admin: liste tous les CIDs et leurs utilisateurs
exports.adminGetAllPermissions = async (req, res) => {
  const adminEmail = await handleAdminAuth(req, res);
  if (!adminEmail) return;

  try {
    const snapshot = await firestore.collection('utilisateurs').get();
    const permissions = snapshot.docs.map(doc => ({
      cid: doc.id,
      authorizedUsers: (doc.data().authorizedUsers || []).map(normEmail),
    }));
    res.status(200).json(permissions);
  } catch (error) {
    console.error(`Erreur adminGetAllPermissions pour ${adminEmail}:`, error);
    res.status(500).send("Erreur interne du serveur.");
  }
};

// Admin: liste des emails connus
exports.adminGetKnownUsers = async (req, res) => {
  const adminEmail = await handleAdminAuth(req, res);
  if (!adminEmail) return;

  try {
    const snapshot = await firestore.collection('utilisateurs').get();
    const all = new Set();
    snapshot.docs.forEach(doc => (doc.data().authorizedUsers || []).forEach(u => all.add(normEmail(u))));
    res.status(200).json(Array.from(all).sort());
  } catch (error) {
    console.error(`Erreur adminGetKnownUsers pour ${adminEmail}:`, error);
    res.status(500).send("Erreur interne du serveur.");
  }
};