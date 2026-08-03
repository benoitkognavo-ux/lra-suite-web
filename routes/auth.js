const express = require("express");
const bcrypt = require("bcryptjs");
const { pool } = require("../db/pool");

const router = express.Router();

router.post("/login", async (req, res) => {
  const identifiant = (req.body.identifiant || "").trim();
  const motDePasse = req.body.motDePasse || "";
  if (!identifiant || !motDePasse) return res.status(400).json({ erreur: "Identifiant et mot de passe requis." });

  const { rows } = await pool.query("SELECT * FROM users WHERE identifiant = $1", [identifiant]);
  const u = rows[0];
  // Message volontairement générique (ne pas révéler si l'identifiant existe),
  // et même pour un compte désactivé — pour ne pas confirmer son existence.
  if (!u || !u.actif) return res.status(401).json({ erreur: "Identifiant ou mot de passe incorrect." });

  const ok = await bcrypt.compare(motDePasse, u.mot_de_passe_hash);
  if (!ok) return res.status(401).json({ erreur: "Identifiant ou mot de passe incorrect." });

  req.session.userId = u.id;
  const dep = await pool.query("SELECT departement FROM user_departements WHERE utilisateur_id = $1 ORDER BY departement", [u.id]);
  res.json({ ok: true, utilisateur: { id: u.id, nom: u.nom, role: u.role, departements: dep.rows.map((r) => r.departement) } });
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get("/me", (req, res) => {
  if (!req.utilisateur) return res.json({ connecte: false });
  const u = req.utilisateur;
  res.json({ connecte: true, utilisateur: { id: u.id, nom: u.nom, role: u.role, departements: u.departements } });
});

module.exports = router;
