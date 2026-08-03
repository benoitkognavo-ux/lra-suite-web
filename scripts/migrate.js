// Applique db/schema.sql à la base configurée (idempotent : toutes les
// instructions utilisent IF NOT EXISTS). À lancer une fois après la création
// de la base sur Render (ou en local pour le développement).
const fs = require("fs");
const path = require("path");
const { pool } = require("../db/pool");

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, "..", "db", "schema.sql"), "utf8");
  await pool.query(sql);
  console.log("Schéma appliqué avec succès.");
  await pool.end();
})().catch((err) => {
  console.error("Échec de la migration :", err);
  process.exit(1);
});
