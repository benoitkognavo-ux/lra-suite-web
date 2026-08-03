const { pool } = require("../db/pool");

// Charge l'utilisateur courant depuis la session (id stocké dans req.session.userId).
// Recharge à chaque requête (plutôt que de faire confiance à la session) afin
// qu'une désactivation par l'admin ("retirer l'utilisation à quelqu'un")
// prenne effet immédiatement, sans attendre l'expiration de la session.
async function chargerUtilisateur(req, res, next) {
  req.utilisateur = null;
  if (req.session && req.session.userId) {
    const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
    const u = rows[0];
    if (u && u.actif) {
      const dep = await pool.query(
        "SELECT departement FROM user_departements WHERE utilisateur_id = $1 ORDER BY departement",
        [u.id]
      );
      u.departements = dep.rows.map((r) => r.departement);
      req.utilisateur = u;
    }
  }
  next();
}

function exigerConnexion(req, res, next) {
  if (!req.utilisateur) return res.status(401).json({ erreur: "Non connecté, ou compte désactivé." });
  next();
}

function exigerAdmin(req, res, next) {
  if (!req.utilisateur || req.utilisateur.role !== "admin") return res.status(403).json({ erreur: "Réservé aux administrateurs." });
  next();
}

function exigerCollaborateur(req, res, next) {
  if (!req.utilisateur) return res.status(401).json({ erreur: "Non connecté, ou compte désactivé." });
  if (req.utilisateur.role !== "collaborateur" || !req.utilisateur.departements || !req.utilisateur.departements.length) {
    return res.status(403).json({ erreur: "Ce compte n'est rattaché à aucun département." });
  }
  next();
}

// Authentification machine-à-machine pour le logiciel de bureau (indépendante
// des sessions utilisateur) : en-tête "X-Api-Key".
async function exigerCleApi(req, res, next) {
  const cle = req.header("X-Api-Key");
  if (!cle) return res.status(401).json({ erreur: "Clé API manquante (en-tête X-Api-Key)." });
  const { rows } = await pool.query("SELECT * FROM api_keys WHERE cle = $1 AND actif = true", [cle]);
  if (!rows[0]) return res.status(401).json({ erreur: "Clé API invalide ou désactivée." });
  next();
}

module.exports = { chargerUtilisateur, exigerConnexion, exigerAdmin, exigerCollaborateur, exigerCleApi };
