// Fichier existant, modifié uniquement pour appliquer aussi le nouveau
// schéma "ingénieur" (db/schema-ingenieur.sql) au démarrage, exactement de
// la même façon idempotente que schema.sql. Aucune autre ligne n'a changé.
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { pool } = require("./pool");

async function bootstrap() {
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(sql);
  console.log("Schéma de base de données vérifié.");

  // AJOUT — nouvelles tables pour l'application Android de Maxence (accès
  // complet aux données, comme le logiciel de bureau). Fichier séparé pour
  // ne jamais toucher aux tables des collaborateurs déjà en production.
  const sqlIngenieur = fs.readFileSync(path.join(__dirname, "schema-ingenieur.sql"), "utf8");
  await pool.query(sqlIngenieur);
  console.log("Schéma de base de données (ingénieur) vérifié.");

  const { ADMIN_IDENTIFIANT, ADMIN_MOT_DE_PASSE, ADMIN_NOM } = process.env;
  if (ADMIN_IDENTIFIANT && ADMIN_MOT_DE_PASSE) {
    const hash = await bcrypt.hash(ADMIN_MOT_DE_PASSE, 12);
    await pool.query(
      `INSERT INTO users (nom, identifiant, mot_de_passe_hash, role, departement, actif)
       VALUES ($1, $2, $3, 'admin', NULL, true)
       ON CONFLICT (identifiant) DO UPDATE SET mot_de_passe_hash = EXCLUDED.mot_de_passe_hash, role = 'admin', actif = true`,
      [ADMIN_NOM || ADMIN_IDENTIFIANT, ADMIN_IDENTIFIANT, hash]
    );
  }

  const { SYNC_API_KEY, SYNC_API_KEY_DESCRIPTION } = process.env;
  if (SYNC_API_KEY) {
    await pool.query(
      `INSERT INTO api_keys (cle, description, actif) VALUES ($1, $2, true)
       ON CONFLICT (cle) DO UPDATE SET actif = true`,
      [SYNC_API_KEY, SYNC_API_KEY_DESCRIPTION || "Synchronisation logiciel de bureau"]
    );
  }
}

module.exports = { bootstrap };
