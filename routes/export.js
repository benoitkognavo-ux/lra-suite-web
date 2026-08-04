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
  const equipements = await pool.query(
    `SELECT ej.*, u.nom AS utilisateur_nom FROM equipements_journal ej
     JOIN users u ON u.id = ej.utilisateur_id
     WHERE ej.date_creation > $1 ORDER BY ej.date_creation ASC`,
    [since]
  );

  const toutesLesDates = [...travaux.rows, ...materiaux.rows, ...documents.rows, ...equipements.rows].map((r) => new Date(r.date_creation).getTime());
  const dernierHorodatage = toutesLesDates.length ? new Date(Math.max(...toutesLesDates)).toISOString() : req.query.since || new Date(0).toISOString();

  res.json({ travaux: travaux.rows, materiaux: materiaux.rows, documents: documents.rows, equipements: equipements.rows, dernierHorodatage });
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

// Reçoit le référentiel des localités (et des départements) depuis le
// logiciel de bureau (source de vérité unique : le projet actif). Remplace
// entièrement le contenu à chaque appel — si une localité ou un département
// est retiré côté bureau, il disparaît aussi ici au prochain envoi. Sert à
// proposer des listes déroulantes aux collaborateurs plutôt qu'une saisie
// libre (voir GET /api/saisie/localites). Le champ "departements" est
// optionnel (compatibilité avec une ancienne version du logiciel de bureau
// qui n'enverrait que "localites") : à défaut, on retombe sur les
// départements déduits des localités envoyées — un département sans aucune
// localité connue ne serait alors pas proposé (ex: destination de transfert
// d'équipement dans un département qui n'a pas encore de localité saisie).
router.put("/referentiel/localites", async (req, res) => {
  const { localites, departements } = req.body;
  if (!Array.isArray(localites)) return res.status(400).json({ erreur: "Liste de localités invalide." });
  const propre = localites
    .map((l) => ({ departement: (l.departement || "").trim().toUpperCase(), localite: (l.localite || "").trim().toUpperCase() }))
    .filter((l) => l.departement && l.localite);
  const propreDepartements = [...new Set(
    (Array.isArray(departements) ? departements : propre.map((l) => l.departement))
      .map((d) => (d || "").trim().toUpperCase())
      .filter(Boolean)
  )];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM localites_referentiel");
    for (const l of propre) {
      await client.query(
        "INSERT INTO localites_referentiel (departement, localite) VALUES ($1,$2) ON CONFLICT DO NOTHING",
        [l.departement, l.localite]
      );
    }
    await client.query("DELETE FROM departements_referentiel");
    for (const d of propreDepartements) {
      await client.query("INSERT INTO departements_referentiel (departement) VALUES ($1) ON CONFLICT DO NOTHING", [d]);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  res.json({ ok: true, total: propre.length, totalDepartements: propreDepartements.length });
});

module.exports = router;
