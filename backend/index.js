// Importation des bibliothèques professionnelles
const { Firestore, FieldValue } = require('@google-cloud/firestore');
const { totp } = require('otplib');

// Initialisation de la connexion à Firestore
const firestore = new Firestore();

// ===================================================================================
// FONCTION 1 : Remplace la partie "getAccess" de votre "doGet"
// Objectif : Lister les CIDs autorisés pour l'utilisateur qui se connecte.
// ===================================================================================
exports.getUserCIDs = async (req, res) => {
  // On identifie l'utilisateur via le jeton sécurisé envoyé par le frontend
  const userEmail = req.auth?.token?.email;
  if (!userEmail) {
    console.error("Appel non authentifié.");
    return res.status(401).send("Accès non autorisé : utilisateur non identifié.");
  }

  try {
    const usersCollection = firestore.collection('utilisateurs');
    
    // Requête Firestore : "Trouve tous les documents où 'user account' est l'email de l'utilisateur"
    const snapshot = await usersCollection.where('user account', '==', userEmail).get();

    if (snapshot.empty) {
      console.log(`Aucun accès trouvé pour l'utilisateur ${userEmail}`);
      return res.status(200).json([]); // On renvoie une liste vide, ce n'est pas une erreur
    }

    // On extrait juste le champ 'CID email' de chaque document trouvé
    const grantedCIDs = snapshot.docs.map(doc => doc.data()['CID email']);
    
    // On renvoie la liste des CIDs au format JSON
    res.status(200).json(grantedCIDs);

  } catch (error) {
    console.error("Erreur lors de la récupération des CIDs :", error);
    res.status(500).send("Une erreur interne est survenue.");
  }
};


// ===================================================================================
// FONCTION 2 : Remplace votre "getNext10Tokens"
// Objectif : Générer les tokens pour un CID spécifique, après vérification des droits.
// ===================================================================================
exports.getNext10Tokens = async (req, res) => {
  // On identifie l'utilisateur
  const userEmail = req.auth?.token?.email;
  if (!userEmail) {
    console.error("Appel non authentifié.");
    return res.status(401).send("Accès non autorisé : utilisateur non identifié.");
  }

  // On récupère le CID demandé depuis le corps de la requête
  const { cid } = req.body;
  if (!cid) {
    return res.status(400).send("Erreur : le paramètre 'cid' est manquant.");
  }

  try {
    // --- Vérification des permissions ---
    const usersCollection = firestore.collection('utilisateurs');
    const accessSnapshot = await usersCollection
      .where('user account', '==', userEmail)
      .where('CID email', '==', cid)
      .limit(1)
      .get();

    // Si la recherche ne renvoie rien, l'utilisateur n'a pas le droit
    if (accessSnapshot.empty) {
      console.warn(`Accès refusé pour ${userEmail} sur le CID ${cid}`);
      await logRequest(userEmail, cid, "access DENIED");
      return res.status(403).send("Accès refusé : permission manquante pour ce CID.");
    }
    
    // --- L'accès est accordé, on continue ---
    await logRequest(userEmail, cid, "access granted");

    // --- Récupération du secret ---
    // L'ID du document est l'email du CID, encodé pour être compatible avec l'URL
    const encodedCid = encodeURIComponent(String(cid).replace(/\//g, "_"));
    const accountDoc = await firestore.collection('comptes').doc(encodedCid).get();

    if (!accountDoc.exists) {
      return res.status(404).send(`Erreur : le secret pour le CID ${cid} est introuvable.`);
    }

    const secret = accountDoc.data()['totp secret'];
    if (!secret) {
        return res.status(404).send(`Erreur : le champ 'totp secret' est manquant pour le CID ${cid}.`);
    }

    // --- Génération des tokens (remplace votre totp.gs) ---
    const cleanSecret = secret.replace(/\s/g, '');
    const tokens = [];
    const step = 30; // 30 secondes
    
    totp.options = { secret: cleanSecret, step };

    for (let i = 0; i < 10; i++) {
      const timestamp = Date.now() + (i * step * 1000);
      tokens.push({
        timestamp: timestamp,
        token: totp.generate(cleanSecret, { timestamp })
      });
    }

    // On renvoie la liste des tokens au format JSON
    res.status(200).json(tokens);

  } catch (error) {
    console.error("Erreur interne dans getNext10Tokens:", error);
    res.status(500).send("Une erreur interne est survenue.");
  }
};


/**
 * Fonction interne pour enregistrer une tentative d'accès dans la collection 'logs'.
 */
async function logRequest(userEmail, cidEmail, status) {
  try {
    await firestore.collection('logs').add({
      user: userEmail,
      account: cidEmail,
      message: status,
      date: FieldValue.serverTimestamp() // Firestore gère la date automatiquement
    });
  } catch(error) {
      console.error("Échec de l'écriture du log :", error);
  }
}