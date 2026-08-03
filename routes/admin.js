// Gestion des comptes par l'administrateur : créer un collaborateur, l'assigner
// à un département, et — le besoin exprimé — autoriser/retirer l'accès (actif).
const express = require("express");
const bcrypt = require("bcryptjs");
const { pool } = require("../db/pool");

const router = express.Router();

router.get("/users", async (req, res) => {
  const { rows } = await pool.query(`
    SELECT u.id, u.nom, u.identifiant, u.role, u.actif, u.date_creation,
           COALESCE(array_agg(ud.departement ORDER BY ud.departement) FILTER (WHERE ud.departement IS NOT NULL), '{}') AS departements
    FROM users u
    LEFT JOIN user_departements ud ON ud.utilisateur_id = u.id
    GROUP BY u.id
    ORDER BY u.role DESC, u.nom
  `);
  res.json({ users: rows });
});

function normaliserDepartements(valeur) {
  const liste = Array.isArray(valeur) ? valeur : typeof valeur === "string" ? valeur.split(",") : [];
  return [...new Set(liste.map((d) => (d || "").trim().toUpperCase()).filter(Boolean))];
}

router.post("/users", async (req, res) => {
  const { nom, identifiant, motDePasse, departements } = req.body;
  if (!nom || !nom.trim()) return res.status(400).json({ erreur: "Le nom est obligatoire." });
  if (!identifiant || !identifiant.trim()) return res.status(400).json({ erreur: "L'identifiant est obligatoire." });
  if (!motDePasse || motDePasse.length < 6) return res.status(400).json({ erreur: "Le mot de passe doit faire au moins 6 caractères." });
  const deps = normaliserDepartements(departements);
  if (!deps.length) return res.status(400).json({ erreur: "Au moins un département est obligatoire pour un collaborateur." });

  const hash = await bcrypt.hash(motDePasse, 12);
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (nom, identifiant, mot_de_passe_hash, role, departement, actif)
       VALUES ($1,$2,$3,'collaborateur',$4,true)
       RETURNING id, nom, identifiant, role, actif, date_creation`,
      [nom.trim(), identifiant.trim(), hash, deps[0]]
    );
    const user = rows[0];
    for (const d of deps) {
      await pool.query(
        `INSERT INTO user_departements (utilisateur_id, departement) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [user.id, d]
      );
    }
    user.departements = deps;
    res.json({ ok: true, user });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ erreur: "Cet identifiant est déjà utilisé." });
    throw err;
  }
});

// Modifie la liste des départements d'un collaborateur existant (remplace
// l'ensemble précédent) — utile pour les collaborateurs qui gèrent plusieurs
// départements, ou dont le périmètre change.
router.patch("/users/:id/departements", async (req, res) => {
  const id = Number(req.params.id);
  const deps = normaliserDepartements(req.body.departements);
  if (!deps.length) return res.status(400).json({ erreur: "Au moins un département est obligatoire." });
  const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
  const u = rows[0];
  if (!u) return res.status(404).json({ erreur: "Utilisateur introuvable." });
  if (u.role === "admin") return res.status(400).json({ erreur: "Un compte administrateur n'est rattaché à aucun département." });
  await pool.query("DELETE FROM user_departements WHERE utilisateur_id = $1", [id]);
  for (const d of deps) {
    await pool.query("INSERT INTO user_departements (utilisateur_id, departement) VALUES ($1,$2) ON CONFLICT DO NOTHING", [id, d]);
  }
  await pool.query("UPDATE users SET departement = $1 WHERE id = $2", [deps[0], id]);
  res.json({ ok: true, departements: deps });
});

// Autoriser / retirer l'accès à un collaborateur (ne touche jamais aux comptes admin
// via cette route, pour éviter qu'un admin ne se verrouille lui-même dehors).
router.patch("/users/:id/actif", async (req, res) => {
  const id = Number(req.params.id);
  const actif = !!req.body.actif;
  const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
  const u = rows[0];
  if (!u) return res.status(404).json({ erreur: "Utilisateur introuvable." });
  if (u.role === "admin") return res.status(400).json({ erreur: "Impossible de désactiver un compte administrateur depuis cette page." });
  await pool.query("UPDATE users SET actif = $1 WHERE id = $2", [actif, id]);
  res.json({ ok: true });
});

router.patch("/users/:id/mot-de-passe", async (req, res) => {
  const id = Number(req.params.id);
  const motDePasse = req.body.motDePasse || "";
  if (motDePasse.length < 6) return res.status(400).json({ erreur: "Le mot de passe doit faire au moins 6 caractères." });
  const hash = await bcrypt.hash(motDePasse, 12);
  const { rowCount } = await pool.query("UPDATE users SET mot_de_passe_hash = $1 WHERE id = $2", [hash, id]);
  if (!rowCount) return res.status(404).json({ erreur: "Utilisateur introuvable." });
  res.json({ ok: true });
});

module.exports = router;
