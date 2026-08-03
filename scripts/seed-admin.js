// Crée (ou met à jour le mot de passe d') un compte administrateur.
// Usage : node scripts/seed-admin.js <identifiant> <mot_de_passe> ["Nom complet"]
// Le mot de passe n'est jamais stocké en clair ni écrit dans un fichier du
// dépôt : il est fourni en argument de commande au moment de l'exécution.
const bcrypt = require("bcryptjs");
const { pool } = require("../db/pool");

(async () => {
  const [, , identifiant, motDePasse, nom] = process.argv;
  if (!identifiant || !motDePasse) {
    console.error("Usage : node scripts/seed-admin.js <identifiant> <mot_de_passe> [\"Nom complet\"]");
    process.exit(1);
  }
  const hash = await bcrypt.hash(motDePasse, 12);
  const res = await pool.query(
    `INSERT INTO users (nom, identifiant, mot_de_passe_hash, role, departement, actif)
     VALUES ($1, $2, $3, 'admin', NULL, true)
     ON CONFLICT (identifiant) DO UPDATE SET mot_de_passe_hash = EXCLUDED.mot_de_passe_hash, role = 'admin', actif = true
     RETURNING id, identifiant`,
    [nom || identifiant, identifiant, hash]
  );
  console.log("Compte admin prêt :", res.rows[0]);
  await pool.end();
})().catch((err) => {
  console.error("Échec :", err);
  process.exit(1);
});
