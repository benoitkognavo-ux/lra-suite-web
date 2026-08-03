// Gestion des comptes par l'administrateur : créer un collaborateur, l'assigner
// à un département, et — le besoin exprimé — autoriser/retirer l'accès (actif).
const express = require("express");
const bcrypt = require("bcryptjs");
const { pool } = require("../db/pool");

const router = express.Router();

router.get("/users", async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, nom, identifiant, role, departement, actif, date_creation FROM users ORDER BY role DESC, departement, nom"
  );
  res.json({ users: rows });
});

router.post("/users", async (req, res) => {
  const { nom, identifiant, motDePasse, departement } = req.body;
  if (!nom || !nom.trim()) return res.status(400).json({ erreur: "Le nom est obligatoire." });
  if (!identifiant || !identifiant.trim()) return res.status(400).json({ erreur: "L'identifiant est obligatoire." });
  if (!motDePasse || motDePasse.length < 6) return res.status(400).json({ erreur: "Le mot de passe doit faire au moins 6 caractères." });
  if (!departement || !departement.trim()) return res.status(400).json({ erreur: "Le département est obligatoire pour un collaborateur." });

  const hash = await bcrypt.hash(motDePasse, 12);
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (nom, identifiant, mot_de_passe_hash, role, departement, actif)
       VALUES ($1,$2,$3,'collaborateur',$4,true)
       RETURNING id, nom, identifiant, role, departement, actif, date_creation`,
      [nom.trim(), identifiant.trim(), hash, departement.trim().toUpperCase()]
    );
    res.json({ ok: true, user: rows[0] });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ erreur: "Cet identifiant est déjà utilisé." });
    throw err;
  }
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
