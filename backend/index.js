// Technical Accounts API (Cloud Functions, Node.js 20)
const { Firestore, FieldValue } = require('@google-cloud/firestore');
const { OAuth2Client } = require('google-auth-library');
const crypto = require('crypto');

const firestore = new Firestore();
const client = new OAuth2Client();

// ---- Logging helper (structured JSON) -----------------
function logEvt(severity, event, fields = {}) {
  const payload = { severity, event, ...fields };
  if (severity === 'ERROR') console.error(JSON.stringify(payload));
  else if (severity === 'WARNING') console.warn(JSON.stringify(payload));
  else console.log(JSON.stringify(payload));
}

// ---- CORS: allow prod + localhost for dev -------------
const ALLOWED_ORIGINS = new Set([
  'https://cid-2nd-factor-generator.web.app', // keep your current Firebase Hosting origin
  'http://localhost:5000',
  'http://localhost:5173',
  'http://127.0.0.1:5000',
  'http://127.0.0.1:5173',
]);

const sgMail = require('@sendgrid/mail');
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || '';
const SENDER_EMAIL     = process.env.SENDER_EMAIL     || 'no-reply@your-domain.tld';
if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
} else {
  console.warn('[sendAccessRequestEmail] SENDGRID_API_KEY not configured; will return 501 so the front falls back to mailto:');
}

// Single collection for the new model
const COL = 'technical_accounts';

// ---------------- TOTP helpers -------------------------
function base32ToBuffer(base32) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = (base32 || '').toUpperCase().replace(/\s+/g, '').replace(/=+$/g, '');
  if (!clean || /[^A-Z2-7]/.test(clean)) throw new Error('Invalid Base32 secret.');
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

// ---------------- Auth & CORS --------------------------
async function handleAuthAndCors(req, res) {
  const origin = req.get('Origin');
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
  } else {
    // default to prod to avoid blocking deployed site
    res.set('Access-Control-Allow-Origin', 'https://cid-2nd-factor-generator.web.app');
  }
  res.set('Vary', 'Origin');
  res.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS, POST');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');

  if (req.method === 'OPTIONS') { res.status(204).send(''); return null; }

  const hdr = req.header('Authorization');
  if (!hdr || !hdr.startsWith('Bearer ')) {
    res.status(401).send('Unauthorized: missing bearer token.');
    return null;
  }

  const idToken = hdr.slice('Bearer '.length);
  try {
    const ticket = await client.verifyIdToken({
      idToken,
      audience: '1075661736654-kampgefcq1iiuteerqjh1fm56fdj4q93.apps.googleusercontent.com',
    });
    const email = (ticket.getPayload().email || '').toLowerCase();
    return email;
  } catch (e) {
    logEvt('ERROR', 'tokenVerificationFailed', { message: e.message });
    res.status(401).send('Unauthorized: invalid token.');
    return null;
  }
}

const normEmail = v => String(v || '').trim().toLowerCase();
const normId    = v => String(v || '').trim();

/** Read a technical account id from body or query (supports legacy "cid"). */
function getTechnicalAccountId(req) {
  // new param name
  const taNewBody  = req.body?.technicalAccount;
  const taNewQuery = req.query?.technicalAccount;
  // legacy param name still accepted
  const legacyBody  = req.body?.cid;
  const legacyQuery = req.query?.cid;
  return normId(taNewBody || taNewQuery || legacyBody || legacyQuery || '');
}

/** Ensure caller is authorized to a technical account. */
async function ensureAuthorized(taId, userEmail) {
  const ref = firestore.collection(COL).doc(taId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, reason: 'not_found' };
  const data = snap.data() || {};
  // normalize all stored emails to avoid case mismatch
  const authz = Array.isArray(data.authorizedUsers)
    ? data.authorizedUsers.map(normEmail)
    : [];
  if (!authz.includes(normEmail(userEmail))) return { ok: false, reason: 'forbidden' };
  return { ok: true, data, ref };
}

/** [GET] Lookup exact technical account and return its approvers (authorizedUsers). */
exports.lookupTechnicalAccountUsers = async (req, res) => {
  const callerEmail = await handleAuthAndCors(req, res);
  if (!callerEmail) return; // CORS / auth already handled

  if (req.method !== 'GET') {
    return res.status(405).send('Method Not Allowed');
  }

  const technicalAccount = getTechnicalAccountId(req); // supports technicalAccount OR legacy cid
  if (!technicalAccount) {
    return res.status(400).send("Param 'technicalAccount' is required.");
  }

  try {
    const doc = await firestore.collection(COL).doc(technicalAccount).get();

    // Exact match only
    if (!doc.exists) {
      logEvt('WARNING', 'lookupTechnicalAccountUsers.not_found', {
        ta: technicalAccount,
        requestedBy: callerEmail
      });
      return res.status(404).send('Technical account not found.');
    }

    const data = doc.data() || {};
    const users = Array.isArray(data.authorizedUsers) ? data.authorizedUsers.map(normEmail) : [];

    users.sort((a, b) => a.localeCompare(b)); // for UI

    logEvt('INFO', 'lookupTechnicalAccountUsers.success', {
      ta: technicalAccount,
      approversCount: users.length,
      requestedBy: callerEmail
    });

    return res.status(200).json(users);
  } catch (e) {
    logEvt('ERROR', 'lookupTechnicalAccountUsers.error', { ta: technicalAccount, requestedBy: callerEmail, message: e.message });
    return res.status(500).send('Internal server error.');
  }
};

// =======================================================
// USER API (Technical Accounts only)
// =======================================================

/** [GET] List technical accounts accessible by the caller. */
exports.getUserTechnicalAccounts = async (req, res) => {
  const userEmail = await handleAuthAndCors(req, res);
  if (!userEmail) return;

  try {
    const snapshot = await firestore
      .collection(COL)
      .where('authorizedUsers', 'array-contains', userEmail)
      .get();

    const ids = snapshot.docs.map(d => d.id);
    logEvt('INFO', 'getUserTechnicalAccounts.success', {
      user: userEmail,
      count: ids.length
    });
    res.status(200).json(ids);
  } catch (e) {
    logEvt('ERROR', 'getUserTechnicalAccounts.error', { user: userEmail, message: e.message });
    res.status(500).send('Internal server error.');
  }
};

/** [POST] Generate 10 TOTP codes if caller is authorized. */
exports.getNext10Tokens = async (req, res) => {
  const userEmail = await handleAuthAndCors(req, res);
  if (!userEmail) return;

  const technicalAccount = getTechnicalAccountId(req);
  if (!technicalAccount) {
    logEvt('WARNING', 'getNext10Tokens.bad_request', { user: userEmail, reason: "missing technicalAccount" });
    return res.status(400).send("Field 'technicalAccount' is required.");
  }

  try {
    const check = await ensureAuthorized(technicalAccount, userEmail);
    if (!check.ok) {
      logEvt('WARNING', 'getNext10Tokens.denied', {
        user: userEmail,
        ta: technicalAccount,
        reason: check.reason
      });
      return res.status(403).send('Access denied.');
    }

    const secret = check.data.totp;
    if (!secret) {
      logEvt('WARNING', 'getNext10Tokens.missing_secret', { user: userEmail, ta: technicalAccount });
      return res.status(404).send(`Missing 'totp' for '${technicalAccount}'.`);
    }

    const cleanSecret = secret.replace(/\s+/g, '').toUpperCase();
    const step = 30;
    const nowSec = Math.floor(Date.now() / 1000);
    const startSec = Math.floor(nowSec / step) * step;

    const tokens = [];
    for (let i = 0; i < 10; i++) {
      const epochSec = startSec + i * step;
      tokens.push({
        timestamp: epochSec * 1000,
        token: generateTotpAt(cleanSecret, epochSec, step, 6)
      });
    }

    logEvt('INFO', 'getNext10Tokens.success', { user: userEmail, ta: technicalAccount, batch: 10 });
    res.status(200).json(tokens);
  } catch (e) {
    logEvt('ERROR', 'getNext10Tokens.error', { user: userEmail, ta: technicalAccount, message: e.message });
    res.status(500).send('Internal server error.');
  }
};

/** [POST] Grant a user on a technical account (caller must be authorized). */
exports.userGrantAccess = async (req, res) => {
  const caller = await handleAuthAndCors(req, res);
  if (!caller) return;

  const technicalAccount = getTechnicalAccountId(req);
  const userToGrant = normEmail(req.body?.userToGrant);
  if (!technicalAccount || !userToGrant) {
    logEvt('WARNING', 'userGrantAccess.bad_request', {
      caller,
      ta: technicalAccount || '(missing)',
      userToGrant: userToGrant || '(missing)'
    });
    return res.status(400).send("Fields 'technicalAccount' and 'userToGrant' are required.");
  }

  try {
    const check = await ensureAuthorized(technicalAccount, caller);
    if (!check.ok) {
      logEvt('WARNING', 'userGrantAccess.denied', {
        caller, ta: technicalAccount, target: userToGrant, reason: check.reason
      });
      return res.status(403).send('Access denied.');
    }

    await check.ref.set(
      { authorizedUsers: FieldValue.arrayUnion(userToGrant) },
      { merge: true }
    );

    logEvt('INFO', 'userGrantAccess.granted', {
      caller, ta: technicalAccount, granted: userToGrant
    });

    res.status(200).send(`Granted '${userToGrant}' on '${technicalAccount}'.`);
  } catch (e) {
    logEvt('ERROR', 'userGrantAccess.error', {
      caller, ta: technicalAccount, target: userToGrant, message: e.message
    });
    res.status(500).send('Internal server error.');
  }
};

/** [POST] Revoke a user (caller must be authorized). */
exports.userRevokeAccess = async (req, res) => {
  const caller = await handleAuthAndCors(req, res);
  if (!caller) return;

  const technicalAccount = getTechnicalAccountId(req);
  const userToRevoke = normEmail(req.body?.userToRevoke);
  if (!technicalAccount || !userToRevoke) {
    logEvt('WARNING', 'userRevokeAccess.bad_request', {
      caller,
      ta: technicalAccount || '(missing)',
      userToRevoke: userToRevoke || '(missing)'
    });
    return res.status(400).send("Fields 'technicalAccount' and 'userToRevoke' are required.");
  }

  try {
    const ref = firestore.collection(COL).doc(technicalAccount);
    const doc = await ref.get();
    const currentAuthz = doc.exists && Array.isArray(doc.data().authorizedUsers)
      ? doc.data().authorizedUsers.map(normEmail) : [];
    if (!doc.exists) {
      logEvt('WARNING', 'userRevokeAccess.not_found', { caller, ta: technicalAccount, target: userToRevoke });
      return res.status(404).send('Technical account not found.');
    }
    if (!currentAuthz.includes(normEmail(caller))) {
      logEvt('WARNING', 'userRevokeAccess.denied', { caller, ta: technicalAccount, target: userToRevoke, reason: 'forbidden' });
      return res.status(403).send('Access denied.');
    }

    await ref.update({ authorizedUsers: FieldValue.arrayRemove(userToRevoke) });

    logEvt('INFO', 'userRevokeAccess.revoked', {
      caller, ta: technicalAccount, revoked: userToRevoke
    });

    res.status(200).send(`Revoked '${userToRevoke}' on '${technicalAccount}'.`);
  } catch (e) {
    if (e.code === 5) {
      logEvt('WARNING', 'userRevokeAccess.not_found', { caller, ta: technicalAccount, target: userToRevoke, code: e.code });
      return res.status(404).send('Technical account not found.');
    }
    logEvt('ERROR', 'userRevokeAccess.error', { caller, ta: technicalAccount, target: userToRevoke, message: e.message });
    res.status(500).send('Internal server error.');
  }
};

/** [GET/POST] List authorized users for a technical account (must be authorized). */
exports.getTechAccountUsers = async (req, res) => {
  const email = await handleAuthAndCors(req, res);
  if (!email) return;

  const technicalAccount = getTechnicalAccountId(req);
  if (!technicalAccount) {
    logEvt('WARNING', 'getTechAccountUsers.bad_request', { caller: email, reason: 'missing technicalAccount' });
    return res.status(400).send("Param 'technicalAccount' is required.");
  }

  try {
    const doc = await firestore.collection(COL).doc(technicalAccount).get();
    if (!doc.exists) {
      logEvt('WARNING', 'getTechAccountUsers.not_found', { caller: email, ta: technicalAccount });
      return res.status(404).send('Technical account not found.');
    }
    const authorized = (doc.data().authorizedUsers || []).map(normEmail);
    if (!authorized.includes(normEmail(email))) {
      logEvt('WARNING', 'getTechAccountUsers.denied', { caller: email, ta: technicalAccount, reason: 'forbidden' });
      return res.status(403).send('Access denied.');
    }

    logEvt('INFO', 'getTechAccountUsers.success', {
      caller: email, ta: technicalAccount, count: authorized.length
    });

    res.status(200).json(authorized);
  } catch (e) {
    logEvt('ERROR', 'getTechAccountUsers.error', { caller: email, ta: technicalAccount, message: e.message });
    res.status(500).send('Internal server error.');
  }
};

// === SEND ACCESS REQUEST EMAIL ==============================================
exports.sendAccessRequestEmail = async (req, res) => {
  const caller = await handleAuthAndCors(req, res);
  if (!caller) return; // OPTIONS / auth KO déjà traités

  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed. Use POST.');
    return;
  }

  const taId      = normId(req.body?.technicalAccount);
  const toEmail   = normEmail(req.body?.to);
  const subjectIn = String(req.body?.subject || '').trim();
  const reason    = String(req.body?.reason || '').trim();
  const requester = normEmail(req.body?.requester || caller);

  if (!taId || !toEmail) {
    logEvt('WARNING', 'sendAccessRequestEmail.bad_request', {
      caller, ta: taId || '(missing)', to: toEmail || '(missing)'
    });
    res.status(400).send("Fields 'technicalAccount' and 'to' are required.");
    return;
  }

  try {
    const ref  = firestore.collection(COL).doc(taId);
    const snap = await ref.get();
    if (!snap.exists) {
      logEvt('WARNING', 'sendAccessRequestEmail.not_found', { caller, ta: taId, to: toEmail });
      res.status(404).send('Technical account not found.');
      return;
    }

    const authz = Array.isArray(snap.data().authorizedUsers)
      ? snap.data().authorizedUsers.map(normEmail)
      : [];
    if (!authz.includes(toEmail)) {
      logEvt('WARNING', 'sendAccessRequestEmail.invalid_recipient', { caller, ta: taId, to: toEmail });
      res.status(400).send('Recipient is not an authorized owner for this technical account.');
      return;
    }

    const subject = subjectIn || `Access request for ${taId} (Authenticator)`;
    const textBody =
`Hello,

Could you please grant me access to the technical account:

${taId}

Requester: ${requester}

Reason:
${reason || '(not provided)'}

Thanks!`;

    const fromEmail = process.env.MAIL_FROM || `no-reply@${(requester.split('@')[1] || 'example.com')}`;

    if (process.env.SENDGRID_API_KEY) {
      let sgMail;
      try { sgMail = require('@sendgrid/mail'); } catch { sgMail = null; }
      if (sgMail) {
        sgMail.setApiKey(process.env.SENDGRID_API_KEY);
        await sgMail.send({ to: toEmail, from: fromEmail, subject, text: textBody });

        logEvt('INFO', 'sendAccessRequestEmail.sent', {
          transport: 'sendgrid', ta: taId, to: toEmail, requester, caller
        });

        res.status(200).json({ ok: true, transport: 'sendgrid' });
        return;
      }
    }

    if (process.env.SMTP_HOST) {
      let nodemailer;
      try { nodemailer = require('nodemailer'); } catch { nodemailer = null; }
      if (!nodemailer) {
        logEvt('ERROR', 'sendAccessRequestEmail.smtp_missing_module', { ta: taId, to: toEmail, caller });
        res.status(500).send('SMTP transport configured but "nodemailer" is not installed.');
        return;
      }

      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: String(process.env.SMTP_SECURE || 'false') === 'true', // true = 465
        auth: (process.env.SMTP_USER && process.env.SMTP_PASS) ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        } : undefined,
      });

      await transporter.sendMail({ from: fromEmail, to: toEmail, subject, text: textBody });

      logEvt('INFO', 'sendAccessRequestEmail.sent', {
        transport: 'smtp', ta: taId, to: toEmail, requester, caller
      });

      res.status(200).json({ ok: true, transport: 'smtp' });
      return;
    }

    logEvt('WARNING', 'sendAccessRequestEmail.transport_unconfigured', { ta: taId, to: toEmail, caller });
    res.status(501).send('Email transport not configured on server.');
  } catch (e) {
    logEvt('ERROR', 'sendAccessRequestEmail.error', { ta: taId, to: toEmail, caller, message: e.message });
    res.status(500).send('Internal server error.');
  }
};