const { Firestore, FieldValue } = require('@google-cloud/firestore');
const { totp } = require('otplib');
const firestore = new Firestore();

const ALLOWED_ORIGIN = 'https://cid-2nd-factor-generator.web.app';

/**
 * Cloud Function pour lister les CIDs de l'utilisateur.
 */
exports.getUserCIDs = async (req, res) => {
  // === DÉBUT DU BLOC CORS CORRIGÉ ===
  res.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS, POST');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  // La ligne la plus importante : répondre à l'appel de vérification
  if (req.method === 'OPTIONS') {
    return res.status(204).send('');
  }
  // === FIN DU BLOC CORS ===

  const userEmail = req.auth?.token?.email;
  if (!userEmail) {
    return res.status(401).send("Accès non autorisé : utilisateur non identifié.");
  }

  try {
    const snapshot = await firestore.collection('utilisateurs').where('user account', '==', userEmail).get();
    const grantedCIDs = snapshot.docs.map(doc => doc.data()['CID email']);
    res.status(200).json(grantedCIDs);
  } catch (error) {
    console.error("Erreur dans getUserCIDs :", error);
    res.status(500).send("Erreur interne du serveur.");
  }
};

/**
 * Cloud Function pour générer les tokens TOTP.
 */
exports.getNext10Tokens = async (req, res) => {
  // === DÉBUT DU BLOC CORS CORRIGÉ (identique) ===
  res.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS, POST');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).send('');
  }
  // === FIN DU BLOC CORS ===

  const userEmail = req.auth?.token?.email;
  if (!userEmail) {
    return res.status(401).send("Accès non autorisé : utilisateur non identifié.");
  }
  
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