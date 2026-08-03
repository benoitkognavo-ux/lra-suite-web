// Génère une nouvelle clé API pour le logiciel de bureau (utilisée pour
// appeler /api/export en toute sécurité, indépendamment des comptes utilisateurs).
// Usage : node scripts/generate-api-key.js ["description"]
const crypto = require("crypto");
const { pool } = require("../db/pool");

(async () => {
  const description = process.argv[2] || "Synchronisation logiciel de bureau";
  const cle = "lra_" + crypto.randomBytes(24).toString("hex");
  await pool.query(`INSERT INTO api_keys (cle, description, actif) VALUES ($1, $2, true)`, [cle, description]);
  console.log("Nouvelle clé API générée (à coller dans le logiciel de bureau, onglet Synchronisation) :");
  console.log(cle);
  await pool.end();
})().catch((err) => {
  console.error("Échec :", err);
  process.exit(1);
});
