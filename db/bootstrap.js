// Prépare la base de données au démarrage du serveur : crée les tables si
// besoin, et — si les variables d'environnement correspondantes sont
// définies sur Render (onglet "Environment") — crée/actualise le compte
// administrateur et la clé API de synchronisation.
//
// Tout est idempotent : ce module peut s'exécuter à chaque démarrage sans
// risque (aucune donnée n'est dupliquée ni écrasée par erreur). Cela évite
// d'avoir besoin d'un accès "Shell" (réservé aux offres payantes de Render)
// pour l'installation initiale.
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { pool } = require("./pool");

async function bootstrap() {
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(sql);
  console.log("Schéma de base de données vérifié.");

  const { ADMIN_IDENTIFIANT, ADMIN_MOT_DE_PASSE, ADMIN_NOM } = process.env;
  if (ADMIN_IDENTIFIANT && ADMIN_MOT_DE_PASSE) {
    const hash = await bcrypt.hash(ADMIN_MOT_DE_PASSE, 12);
    await pool.query(
      `INSERT INTO users (nom, identifiant, mot_de_passe_hash, role, departement, actif)
       VALUES ($1, $2, $3, 'admin', NULL, true)
       ON CONFLICT (identifiant) DO UPDATE SET mot_de_passe_hash = EXCLUDED.mot_de_passe_hash, role = 'admin', actif = true`,
      [ADMIN_NOM || ADMIN_IDENTIFIANT, ADMIN_IDENTIFIANT, hash]
    );
    console.log(`Compte administrateur "${ADMIN_IDENTIFIANT}" prêt.`);
  }

  const { SYNC_API_KEY, SYNC_API_KEY_DESCRIPTION } = process.env;
  if (SYNC_API_KEY) {
    await pool.query(
      `INSERT INTO api_keys (cle, description, actif) VALUES ($1, $2, true)
       ON CONFLICT (cle) DO UPDATE SET actif = true`,
      [SYNC_API_KEY, SYNC_API_KEY_DESCRIPTION || "Synchronisation logiciel de bureau"]
    );
    console.log("Clé API de synchronisation prête.");
  }
}

module.exports = { bootstrap };
