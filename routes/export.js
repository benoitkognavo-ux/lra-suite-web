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
  // Sans la colonne "contenu" (le fichier binaire) : elle alourdirait inutilement
  // cette réponse. Le logiciel de bureau la récupère à part, document par
  // document, via GET /api/documents/:id/fichier — seulement pour les documents
  // vraiment nouveaux.
  const documents = await pool.query(
    `SELECT dj.id, dj.departement, dj.type, dj.nom_fichier, dj.type_mime, dj.taille, dj.commentaire, dj.date_saisie, dj.date_creation, u.nom AS utilisateur_nom
     FROM documents_journal dj
     JOIN users u ON u.id = dj.utilisateur_id
     WHERE dj.date_creation > $1 ORDER BY dj.date_creation ASC`,
    [since]
  );

  const toutesLesDates = [...travaux.rows, ...materiaux.rows, ...documents.rows].map((r) => new Date(r.date_creation).getTime());
  const dernierHorodatage = toutesLesDates.length ? new Date(Math.max(...toutesLesDates)).toISOString() : req.query.since || new Date(0).toISOString();

  res.json({ travaux: travaux.rows, materiaux: materiaux.rows, documents: documents.rows, dernierHorodatage });
});

// Télécharge le contenu binaire d'un document précis — appelé par le logiciel
// de bureau pour chaque document nouvellement vu dans /export, jamais par le
// navigateur (pas de session utilisateur ici, seulement la clé API machine).
router.get("/documents/:id/fichier", async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await pool.query(
    "SELECT nom_fichier, type_mime, contenu FROM documents_journal WHERE id = $1",
    [id]
  );
  const doc = rows[0];
  if (!doc) return res.status(404).json({ erreur: "Document introuvable." });
  res.setHeader("Content-Type", doc.type_mime || "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${doc.nom_fichier.replace(/"/g, "")}"`);
  res.send(doc.contenu);
});

module.exports = router;
