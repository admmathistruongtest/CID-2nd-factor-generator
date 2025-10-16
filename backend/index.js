const { Firestore, FieldValue } = require('@google-cloud/firestore');
const { totp } = require('otplib');
const { OAuth2Client } = require('google-auth-library');

const firestore = new Firestore();
const client = new OAuth2Client();

const ALLOWED_ORIGIN = 'https://cid-2nd-factor-generator.web.app';

// Middleware pour gérer CORS et l'authentification
async function handleAuthAndCors(req, res) {
  res.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS, POST');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return null; // Stoppe l'exécution pour la requête OPTIONS
  }

  const authHeader = req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).send('Accès non autorisé : Jeton manquant.');
    return null;
  }

  const idToken = authHeader.split('Bearer ')[1];
  try {
    const ticket = await client.verifyIdToken({
        idToken: idToken,
        audience: '1075661736654-kampgefcq1iiuteerqjh1fm56fdj4q93.apps.googleusercontent.com', // TRÈS IMPORTANT
    });
    const payload = ticket.getPayload();
    return payload.email; // Renvoie l'email de l'utilisateur si le jeton est valide
  } catch (error) {
    console.error("Échec de la vérification du jeton :", error.message);
    res.status(401).send('Accès non autorisé : Jeton invalide.');
    return null;
  }
}

exports.getUserCIDs = async (req, res) => {
  const userEmail = await handleAuthAndCors(req, res);
  if (!userEmail) return; // Stoppe si l'authentification ou CORS a échoué

  try {
    const snapshot = await firestore.collection('utilisateurs').where('user account', '==', userEmail).get();
    const grantedCIDs = snapshot.docs.map(doc => doc.data()['CID email']);
    res.status(200).json(grantedCIDs);
  } catch (error) {
    console.error("Erreur dans getUserCIDs :", error);
    res.status(500).send("Erreur interne du serveur.");
  }
};

exports.getNext10Tokens = async (req, res) => {
  const userEmail = await handleAuthAndCors(req, res);
  if (!userEmail) return; // Stoppe si l'authentification ou CORS a échoué

  const { cid } = req.body;
  if (!cid) {
    return res.status(400).send("Erreur : le paramètre 'cid' est manquant.");
  }

  try {
    const accessSnapshot = await firestore.collection('utilisateurs')
      .where('user account', '==', userEmail)
      .where('CID email', '==', cid)
      .limit(1)
      .get();

    if (accessSnapshot.empty) {
      await logRequest(userEmail, cid, "access DENIED");
      return res.status(403).send("Accès refusé.");
    }
    
    await logRequest(userEmail, cid, "access granted");

    const encodedCid = encodeURIComponent(String(cid).replace(/\//g, "_"));
    const accountDoc = await firestore.collection('comptes').doc(encodedCid).get();

    if (!accountDoc.exists) {
      return res.status(404).send(`Secret introuvable pour le CID ${cid}.`);
    }

    const secret = accountDoc.data()['totp secret'];
    if (!secret) {
        return res.status(404).send(`Champ 'totp secret' manquant pour le CID ${cid}.`);
    }

    const cleanSecret = secret.replace(/\s/g, '');
    const tokens = [];
    const step = 30;
    
    totp.options = { secret: cleanSecret, step };

    for (let i = 0; i < 10; i++) {
      const timestamp = Date.now() + (i * step * 1000);
      tokens.push({
        timestamp: timestamp,
        token: totp.generate(cleanSecret, { timestamp })
      });
    }

    res.status(200).json(tokens);
  } catch (error) {
    console.error("Erreur dans getNext10Tokens:", error);
    res.status(500).send("Erreur interne du serveur.");
  }
};

/**
 * Fonction interne pour logger les requêtes.
 */
async function logRequest(userEmail, cidEmail, status) {
  try {
    await firestore.collection('logs').add({
      user: userEmail,
      account: cidEmail,
      message: status,
      date: FieldValue.serverTimestamp()
    });
  } catch(error) {
      console.error("Échec de l'écriture du log :", error);
  }
}