// Saisies quotidiennes des collaborateurs. Le département n'est JAMAIS pris
// depuis le corps de la requête : il est toujours celui rattaché au compte de
// l'utilisateur connecté (exigerCollaborateur l'a déjà vérifié), pour qu'un
// collaborateur ne puisse jamais saisir — volontairement ou par erreur — dans
// le département d'un autre.
const express = require("express");
const { pool } = require("../db/pool");

const router = express.Router();

const CATEGORIES_TRAVAUX = ["Implantation", "PointesDiamant"];
// Étapes autorisées par matériau : le ciment peut être reçu OU utilisé, les
// autres (sable, concassés) ne sont demandés qu'à la réception pour l'instant.
const MATERIAUX_ETAPES = {
  Ciment: ["Livraison", "Utilisation"],
  Sable: ["Livraison"],
  "Concassé": ["Livraison"],
  "Concassé 5/15": ["Livraison"],
  "Concassé 15/25": ["Livraison"],
};

function nombrePositif(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

router.post("/travaux", async (req, res) => {
  const { localite, type_poteau, categorie, quantite, date_saisie, commentaire } = req.body;
  const loc = (localite || "").trim().toUpperCase();
  if (!loc) return res.status(400).json({ erreur: "La localité est obligatoire." });
  if (!CATEGORIES_TRAVAUX.includes(categorie)) return res.status(400).json({ erreur: "Catégorie invalide." });
  const q = nombrePositif(quantite);
  if (!q) return res.status(400).json({ erreur: "La quantité doit être un nombre positif." });
  const date = date_saisie || new Date().toISOString().slice(0, 10);

  const { rows } = await pool.query(
    `INSERT INTO travaux_journal (utilisateur_id, departement, localite, type_poteau, categorie, quantite, date_saisie, commentaire)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.utilisateur.id, req.utilisateur.departement, loc, (type_poteau || "").trim(), categorie, q, date, (commentaire || "").trim()]
  );
  res.json({ ok: true, saisie: rows[0] });
});

router.post("/materiaux", async (req, res) => {
  const { materiau, unite, etape, quantite, date_saisie, commentaire } = req.body;
  const etapesAutorisees = MATERIAUX_ETAPES[materiau];
  if (!etapesAutorisees) return res.status(400).json({ erreur: "Matériau invalide." });
  if (!etapesAutorisees.includes(etape)) return res.status(400).json({ erreur: `Pour ${materiau}, seule(s) l'étape(s) ${etapesAutorisees.join(", ")} est/sont autorisée(s).` });
  const q = nombrePositif(quantite);
  if (!q) return res.status(400).json({ erreur: "La quantité doit être un nombre positif." });
  if (!unite || !unite.trim()) return res.status(400).json({ erreur: "L'unité est obligatoire." });
  const date = date_saisie || new Date().toISOString().slice(0, 10);

  const { rows } = await pool.query(
    `INSERT INTO materiaux_journal (utilisateur_id, departement, materiau, unite, quantite, etape, date_saisie, commentaire)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.utilisateur.id, req.utilisateur.departement, materiau, unite.trim(), q, etape, date, (commentaire || "").trim()]
  );
  res.json({ ok: true, saisie: rows[0] });
});

// Historique personnel (30 derniers jours) — pour que le collaborateur puisse
// vérifier ce qu'il a déjà saisi, mais uniquement ses propres saisies.
router.get("/mes-saisies", async (req, res) => {
  const travaux = await pool.query(
    `SELECT * FROM travaux_journal WHERE utilisateur_id = $1 AND date_creation > now() - interval '30 days' ORDER BY date_creation DESC LIMIT 100`,
    [req.utilisateur.id]
  );
  const materiaux = await pool.query(
    `SELECT * FROM materiaux_journal WHERE utilisateur_id = $1 AND date_creation > now() - interval '30 days' ORDER BY date_creation DESC LIMIT 100`,
    [req.utilisateur.id]
  );
  res.json({ travaux: travaux.rows, materiaux: materiaux.rows });
});

module.exports = router;
