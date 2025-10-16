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
    return null;
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
        audience: '1075661736654-kampgefcq1iiuteerqjh1fm56fdj4q93.apps.googleusercontent.com',
    });
    const payload = ticket.getPayload();
    return payload.email;
  } catch (error) {
    console.error("Échec de la vérification du jeton :", error.message);
    res.status(401).send('Accès non autorisé : Jeton invalide.');
    return null;
  }
}

exports.getUserCIDs = async (req, res) => {
  const userEmail = await handleAuthAndCors(req, res);
  if (!userEmail) return;

  try {
    const usersCollection = firestore.collection('utilisateurs');
    const snapshot = await usersCollection.where('authorizedUsers', 'array-contains', userEmail).get();

    if (snapshot.empty) {
      return res.status(200).json([]);
    }

    const grantedCIDs = snapshot.docs.map(doc => decodeURIComponent(doc.id));
    res.status(200).json(grantedCIDs);

  } catch (error) {
    console.error("Erreur dans getUserCIDs :", error);
    res.status(500).send("Erreur interne du serveur.");
  }
};

exports.getNext10Tokens = async (req, res) => {
  const userEmail = await handleAuthAndCors(req, res);
  if (!userEmail) return;

  const { cid } = req.body;
  if (!cid) {
    return res.status(400).send("Erreur : le paramètre 'cid' est manquant.");
  }

  try {
    // **CORRECTION IMPORTANTE : VÉRIFICATION DES PERMISSIONS**
    const encodedCidForPermission = encodeURIComponent(String(cid).trim().replace(/\//g, "_"));
    const userPermissionDocRef = firestore.collection('utilisateurs').doc(encodedCidForPermission);
    const userPermissionDoc = await userPermissionDocRef.get();

    // On vérifie si le document existe ET si l'utilisateur est dans le tableau
    if (!userPermissionDoc.exists || !userPermissionDoc.data().authorizedUsers.includes(userEmail)) {
      await logRequest(userEmail, cid, "access DENIED");
      return res.status(403).send("Accès refusé : permission non accordée pour ce CID.");
    }
    // **FIN DE LA CORRECTION**
    
    await logRequest(userEmail, cid, "access granted");

    const encodedCidForAccount = encodeURIComponent(String(cid).trim().replace(/\//g, "_"));
    const accountDoc = await firestore.collection('comptes').doc(encodedCidForAccount).get();

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