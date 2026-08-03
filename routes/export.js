// Endpoint machine-à-machine utilisé par le logiciel de bureau pour récupérer
// les nouvelles saisies. Le filtre porte sur date_creation (horodatage serveur,
// jamais modifiable par le collaborateur) et non sur date_saisie (qui peut être
// une date passée si quelqu'un saisit en retard) — sinon une saisie en retard
// pourrait être ignorée si elle tombe avant le dernier "since" déjà synchronisé.
const express = require("express");
const { pool } = require("../db/pool");

const router = express.Router();

router.get("/export", async (req, res) => {
  const since = req.query.since ? new Date(req.query.since) : new Date(0);
  if (isNaN(since.getTime())) return res.status(400).json({ erreur: "Paramètre 'since' invalide (attendu : date ISO)." });

  const travaux = await pool.query(
    `SELECT tj.*, u.nom AS utilisateur_nom FROM travaux_journal tj
     JOIN users u ON u.id = tj.utilisateur_id
     WHERE tj.date_creation > $1 ORDER BY tj.date_creation ASC`,
    [since]
  );
  const materiaux = await pool.query(
    `SELECT mj.*, u.nom AS utilisateur_nom FROM materiaux_journal mj
     JOIN users u ON u.id = mj.utilisateur_id
     WHERE mj.date_creation > $1 ORDER BY mj.date_creation ASC`,
    [since]
  );

  const toutesLesDates = [...travaux.rows, ...materiaux.rows].map((r) => new Date(r.date_creation).getTime());
  const dernierHorodatage = toutesLesDates.length ? new Date(Math.max(...toutesLesDates)).toISOString() : req.query.since || new Date(0).toISOString();

  res.json({ travaux: travaux.rows, materiaux: materiaux.rows, dernierHorodatage });
});

module.exports = router;
