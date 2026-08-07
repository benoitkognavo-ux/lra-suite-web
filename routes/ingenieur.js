// API complète pour l'application Android de Maxence — même niveau d'accès
// que le logiciel de bureau (voir db.js), mais servie depuis le portail web
// déjà déployé plutôt que depuis un troisième système séparé. Monté sur
// /api/ingenieur, protégé par exigerConnexion + exigerAdmin (server.js) :
// seul le compte administrateur (Maxence) peut appeler ces routes — c'est le
// même compte que celui utilisé pour gérer les collaborateurs.
//
// Version 1 (voir tâche "Modules essentiels") : Projets, Travaux, Flux
// poteaux, Matériaux, Équipements, Catégories personnalisées, Tableau de
// bord. Les modules Commandes groupées, Béton, Gravier, Approvisionnement,
// Documents et l'assistant de Configuration arrivent dans une prochaine
// mise à jour de ce fichier (voir tâche "Modules restants").
//
// Note de portage : la logique de recalcul automatique Plateforme/Pointe de
// diamant (recalculerPlateformesEtPointesDiamant côté logiciel de bureau,
// voir db.js) n'est PAS encore reproduite ici — ces deux catégories restent
// donc, pour l'instant, saisies manuellement depuis l'appli Android comme
// n'importe quelle autre catégorie de travaux. À porter dans une prochaine
// mise à jour si Maxence utilise beaucoup l'électricité (IACM/DMT-CC/
// Transformateur) depuis l'appli.
const express = require("express");
const { pool } = require("../db/pool");

const router = express.Router();

function nombre(v, defaut = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : defaut;
}

// -------------------- Projets --------------------

router.get("/projets", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM ing_projets ORDER BY date_creation ASC");
  res.json({ projets: rows });
});

router.post("/projets", async (req, res) => {
  const { nom, description } = req.body;
  if (!nom || !nom.trim()) return res.status(400).json({ erreur: "Le nom du projet est obligatoire." });
  const { rows } = await pool.query(
    "INSERT INTO ing_projets (nom, description) VALUES ($1,$2) RETURNING *",
    [nom.trim(), (description || "").trim()]
  );
  // Premier projet créé : devient automatiquement le projet actif.
  const { rows: actifRows } = await pool.query("SELECT value FROM ing_settings WHERE key = 'projet_actif_id'");
  if (!actifRows.length) {
    await pool.query(
      "INSERT INTO ing_settings (key, value) VALUES ('projet_actif_id', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
      [String(rows[0].id)]
    );
  }
  res.json({ ok: true, projet: rows[0] });
});

router.patch("/projets/:id", async (req, res) => {
  const { nom, description } = req.body;
  const { rows } = await pool.query(
    "UPDATE ing_projets SET nom = COALESCE($1, nom), description = COALESCE($2, description) WHERE id = $3 RETURNING *",
    [nom ? nom.trim() : null, description != null ? description.trim() : null, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ erreur: "Projet introuvable." });
  res.json({ ok: true, projet: rows[0] });
});

router.delete("/projets/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { rows: tousLesProjets } = await pool.query("SELECT id FROM ing_projets");
  if (tousLesProjets.length <= 1) {
    return res.status(400).json({ erreur: "Impossible de supprimer le dernier projet restant." });
  }
  const { rows: travaux } = await pool.query("SELECT id FROM ing_travaux WHERE projet_id = $1 LIMIT 1", [id]);
  if (travaux.length) {
    return res.status(400).json({ erreur: "Ce projet contient des données (travaux enregistrés) — suppression bloquée." });
  }
  await pool.query("DELETE FROM ing_projets WHERE id = $1", [id]);

  // Si le projet supprimé était le projet actif, bascule automatiquement sur
  // un autre projet restant — sinon ing_settings.projet_actif_id pointerait
  // vers un projet inexistant et toute écriture échouerait (clé étrangère).
  const { rows: actifRows } = await pool.query("SELECT value FROM ing_settings WHERE key = 'projet_actif_id'");
  if (actifRows[0] && Number(actifRows[0].value) === id) {
    const { rows: restants } = await pool.query("SELECT id FROM ing_projets ORDER BY date_creation ASC LIMIT 1");
    await pool.query(
      "INSERT INTO ing_settings (key, value) VALUES ('projet_actif_id', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
      [String(restants[0].id)]
    );
  }
  res.json({ ok: true });
});

router.get("/projets/actif", async (req, res) => {
  const { rows } = await pool.query("SELECT value FROM ing_settings WHERE key = 'projet_actif_id'");
  res.json({ projetActifId: rows[0] ? Number(rows[0].value) : null });
});

router.post("/projets/actif", async (req, res) => {
  const { id } = req.body;
  const { rows } = await pool.query("SELECT id FROM ing_projets WHERE id = $1", [id]);
  if (!rows[0]) return res.status(404).json({ erreur: "Projet introuvable." });
  await pool.query(
    "INSERT INTO ing_settings (key, value) VALUES ('projet_actif_id', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [String(id)]
  );
  res.json({ ok: true });
});

// Résout le projet à utiliser pour une requête : ?projet_id= explicite,
// sinon le projet actif enregistré dans ing_settings.
async function projetEffectif(req) {
  if (req.query.projet_id) return Number(req.query.projet_id);
  const { rows } = await pool.query("SELECT value FROM ing_settings WHERE key = 'projet_actif_id'");
  return rows[0] ? Number(rows[0].value) : null;
}

// -------------------- Catégories personnalisées --------------------

router.get("/categories-custom", async (req, res) => {
  const projetId = await projetEffectif(req);
  const { domaine } = req.query;
  if (!projetId) return res.json({ categories: [] });
  const { rows } = await pool.query(
    "SELECT categorie, label FROM ing_categories_custom WHERE projet_id = $1 AND domaine = $2 ORDER BY id",
    [projetId, domaine || ""]
  );
  res.json({ categories: rows });
});

router.post("/categories-custom", async (req, res) => {
  const projetId = await projetEffectif(req);
  if (!projetId) return res.status(400).json({ erreur: "Aucun projet actif." });
  const { domaine, categorie, label } = req.body;
  if (!domaine || !categorie || !label) return res.status(400).json({ erreur: "domaine, categorie et label sont obligatoires." });
  const { rows } = await pool.query(
    `INSERT INTO ing_categories_custom (projet_id, domaine, categorie, label) VALUES ($1,$2,$3,$4)
     ON CONFLICT (projet_id, domaine, categorie) DO UPDATE SET label = EXCLUDED.label
     RETURNING *`,
    [projetId, domaine, categorie, label]
  );
  res.json({ ok: true, categorie: rows[0] });
});

// -------------------- Travaux (implantation, fouilles, électricité, câbles, mise à la terre) --------------------

router.get("/travaux", async (req, res) => {
  const projetId = await projetEffectif(req);
  if (!projetId) return res.json({ travaux: [] });
  const { departement, categorie } = req.query;
  const conditions = ["projet_id = $1"];
  const params = [projetId];
  if (departement) { params.push(departement); conditions.push(`departement = $${params.length}`); }
  if (categorie) { params.push(categorie); conditions.push(`categorie = $${params.length}`); }
  const { rows } = await pool.query(
    `SELECT * FROM ing_travaux WHERE ${conditions.join(" AND ")} ORDER BY departement, localite, categorie`,
    params
  );
  res.json({ travaux: rows });
});

router.post("/travaux", async (req, res) => {
  const projetId = await projetEffectif(req);
  if (!projetId) return res.status(400).json({ erreur: "Aucun projet actif." });
  const { id, departement, localite, type_poteau, categorie, prevu, realise } = req.body;
  if (!departement || !localite || !categorie) {
    return res.status(400).json({ erreur: "Département, localité et catégorie sont obligatoires." });
  }
  const dep = departement.trim().toUpperCase();
  const loc = localite.trim().toUpperCase();
  const maintenant = new Date().toISOString();

  if (id) {
    const { rows } = await pool.query(
      `UPDATE ing_travaux SET departement=$1, localite=$2, type_poteau=$3, categorie=$4, prevu=$5, realise=$6, date_maj=$7
       WHERE id = $8 AND projet_id = $9 RETURNING *`,
      [dep, loc, type_poteau || "", categorie, nombre(prevu), nombre(realise), maintenant, id, projetId]
    );
    if (!rows[0]) return res.status(404).json({ erreur: "Ligne de travaux introuvable." });
    return res.json({ ok: true, travaux: rows[0] });
  }

  const { rows } = await pool.query(
    `INSERT INTO ing_travaux (projet_id, departement, localite, type_poteau, categorie, prevu, realise, date_maj)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [projetId, dep, loc, type_poteau || "", categorie, nombre(prevu), nombre(realise), maintenant]
  );
  res.json({ ok: true, travaux: rows[0] });
});

router.delete("/travaux/:id", async (req, res) => {
  await pool.query("DELETE FROM ing_travaux WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

router.get("/travaux/departements", async (req, res) => {
  const projetId = await projetEffectif(req);
  if (!projetId) return res.json({ departements: [] });
  const { rows } = await pool.query(
    "SELECT DISTINCT departement FROM ing_travaux WHERE projet_id = $1 ORDER BY departement",
    [projetId]
  );
  res.json({ departements: rows.map((r) => r.departement) });
});

// -------------------- Flux poteaux --------------------

router.get("/flux", async (req, res) => {
  const projetId = await projetEffectif(req);
  if (!projetId) return res.json({ flux: [] });
  const { rows } = await pool.query(
    "SELECT * FROM ing_flux_poteaux WHERE projet_id = $1 ORDER BY date_mvt DESC NULLS LAST, id DESC",
    [projetId]
  );
  res.json({ flux: rows });
});

router.post("/flux", async (req, res) => {
  const projetId = await projetEffectif(req);
  if (!projetId) return res.status(400).json({ erreur: "Aucun projet actif." });
  const { id, commande_id, departement, localite, type_poteau, quantite, etape, date_mvt, reference, commentaire, motif, motif_detail, statut } = req.body;
  if (!departement || !etape || !nombre(quantite)) {
    return res.status(400).json({ erreur: "Département, étape et quantité sont obligatoires." });
  }
  if (id) {
    const { rows } = await pool.query(
      `UPDATE ing_flux_poteaux SET commande_id=$1, departement=$2, localite=$3, type_poteau=$4, quantite=$5, etape=$6,
         date_mvt=$7, reference=$8, commentaire=$9, motif=$10, motif_detail=$11, statut=$12
       WHERE id=$13 AND projet_id=$14 RETURNING *`,
      [commande_id || null, departement.trim().toUpperCase(), localite || "", type_poteau || "", nombre(quantite), etape,
        date_mvt || null, reference || "", commentaire || "", motif || "", motif_detail || "", statut || "", id, projetId]
    );
    if (!rows[0]) return res.status(404).json({ erreur: "Mouvement introuvable." });
    return res.json({ ok: true, flux: rows[0] });
  }
  const { rows } = await pool.query(
    `INSERT INTO ing_flux_poteaux (projet_id, commande_id, departement, localite, type_poteau, quantite, etape, date_mvt, reference, commentaire, motif, motif_detail, statut)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [projetId, commande_id || null, departement.trim().toUpperCase(), localite || "", type_poteau || "", nombre(quantite), etape,
      date_mvt || null, reference || "", commentaire || "", motif || "", motif_detail || "", statut || ""]
  );
  res.json({ ok: true, flux: rows[0] });
});

router.delete("/flux/:id", async (req, res) => {
  await pool.query("DELETE FROM ing_flux_poteaux WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

// -------------------- Matériaux --------------------

router.get("/materiaux", async (req, res) => {
  const projetId = await projetEffectif(req);
  if (!projetId) return res.json({ materiaux: [] });
  const { rows } = await pool.query(
    "SELECT * FROM ing_materiaux_mouvements WHERE projet_id = $1 ORDER BY date_mvt DESC NULLS LAST, id DESC",
    [projetId]
  );
  res.json({ materiaux: rows });
});

router.post("/materiaux", async (req, res) => {
  const projetId = await projetEffectif(req);
  if (!projetId) return res.status(400).json({ erreur: "Aucun projet actif." });
  const { id, commande_id, departement, localite, materiau, unite, quantite, etape, date_mvt, reference, commentaire } = req.body;
  if (!departement || !materiau || !etape || !nombre(quantite)) {
    return res.status(400).json({ erreur: "Département, matériau, étape et quantité sont obligatoires." });
  }
  if (id) {
    const { rows } = await pool.query(
      `UPDATE ing_materiaux_mouvements SET commande_id=$1, departement=$2, localite=$3, materiau=$4, unite=$5, quantite=$6, etape=$7, date_mvt=$8, reference=$9, commentaire=$10
       WHERE id=$11 AND projet_id=$12 RETURNING *`,
      [commande_id || null, departement.trim().toUpperCase(), localite || "", materiau, unite || "", nombre(quantite), etape, date_mvt || null, reference || "", commentaire || "", id, projetId]
    );
    if (!rows[0]) return res.status(404).json({ erreur: "Mouvement introuvable." });
    return res.json({ ok: true, materiau: rows[0] });
  }
  const { rows } = await pool.query(
    `INSERT INTO ing_materiaux_mouvements (projet_id, commande_id, departement, localite, materiau, unite, quantite, etape, date_mvt, reference, commentaire)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [projetId, commande_id || null, departement.trim().toUpperCase(), localite || "", materiau, unite || "", nombre(quantite), etape, date_mvt || null, reference || "", commentaire || ""]
  );
  res.json({ ok: true, materiau: rows[0] });
});

router.delete("/materiaux/:id", async (req, res) => {
  await pool.query("DELETE FROM ing_materiaux_mouvements WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

// Stock = somme des Livraison − somme des Utilisation/Perte, par matériau.
router.get("/materiaux/stock", async (req, res) => {
  const projetId = await projetEffectif(req);
  if (!projetId) return res.json({ stock: [] });
  const { rows } = await pool.query(
    `SELECT materiau, unite,
       SUM(CASE WHEN etape = 'Livraison' THEN quantite ELSE 0 END) AS livre,
       SUM(CASE WHEN etape IN ('Utilisation','Perte') THEN quantite ELSE 0 END) AS sorti
     FROM ing_materiaux_mouvements WHERE projet_id = $1 GROUP BY materiau, unite ORDER BY materiau`,
    [projetId]
  );
  res.json({ stock: rows.map((r) => ({ materiau: r.materiau, unite: r.unite, stock: Number(r.livre) - Number(r.sorti) })) });
});

// -------------------- Équipements --------------------

router.get("/equipements", async (req, res) => {
  const projetId = await projetEffectif(req);
  if (!projetId) return res.json({ equipements: [] });
  const { rows } = await pool.query("SELECT * FROM ing_equipements WHERE projet_id = $1 ORDER BY designation", [projetId]);
  res.json({ equipements: rows });
});

router.post("/equipements", async (req, res) => {
  const projetId = await projetEffectif(req);
  if (!projetId) return res.status(400).json({ erreur: "Aucun projet actif." });
  const { id, designation, departement, statut, commentaire, code, localite, marque_modele, n_serie, date_mise_service, derniere_maintenance, quantite } = req.body;
  if (!designation || !designation.trim()) return res.status(400).json({ erreur: "La désignation est obligatoire." });
  if (id) {
    const { rows } = await pool.query(
      `UPDATE ing_equipements SET designation=$1, departement=$2, statut=$3, commentaire=$4, code=$5, localite=$6, marque_modele=$7, n_serie=$8, date_mise_service=$9, derniere_maintenance=$10, quantite=$11
       WHERE id=$12 AND projet_id=$13 RETURNING *`,
      [designation.trim(), departement || "", statut || "EnService", commentaire || "", code || "", localite || "", marque_modele || "", n_serie || "", date_mise_service || null, derniere_maintenance || null, nombre(quantite, 1), id, projetId]
    );
    if (!rows[0]) return res.status(404).json({ erreur: "Équipement introuvable." });
    return res.json({ ok: true, equipement: rows[0] });
  }
  const { rows } = await pool.query(
    `INSERT INTO ing_equipements (projet_id, designation, departement, statut, commentaire, code, localite, marque_modele, n_serie, date_mise_service, derniere_maintenance, quantite)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [projetId, designation.trim(), departement || "", statut || "EnService", commentaire || "", code || "", localite || "", marque_modele || "", n_serie || "", date_mise_service || null, derniere_maintenance || null, nombre(quantite, 1)]
  );
  res.json({ ok: true, equipement: rows[0] });
});

router.delete("/equipements/:id", async (req, res) => {
  await pool.query("DELETE FROM ing_equipements WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

// -------------------- Tableau de bord --------------------

router.get("/dashboard/kpis", async (req, res) => {
  const projetId = await projetEffectif(req);
  if (!projetId) return res.json({ kpis: null });

  const implantation = await pool.query(
    "SELECT COALESCE(SUM(prevu),0) AS prevu, COALESCE(SUM(realise),0) AS realise FROM ing_travaux WHERE projet_id = $1 AND categorie = 'Implantation'",
    [projetId]
  );
  const parDepartement = await pool.query(
    `SELECT departement, COALESCE(SUM(prevu),0) AS prevu, COALESCE(SUM(realise),0) AS realise
     FROM ing_travaux WHERE projet_id = $1 AND categorie = 'Implantation' GROUP BY departement ORDER BY departement`,
    [projetId]
  );
  const equipementsCount = await pool.query("SELECT COUNT(*) AS n FROM ing_equipements WHERE projet_id = $1", [projetId]);
  const stock = await pool.query(
    `SELECT materiau, COALESCE(SUM(CASE WHEN etape='Livraison' THEN quantite ELSE -quantite END),0) AS stock
     FROM ing_materiaux_mouvements WHERE projet_id = $1 GROUP BY materiau`,
    [projetId]
  );

  res.json({
    kpis: {
      implantation: { prevu: Number(implantation.rows[0].prevu), realise: Number(implantation.rows[0].realise) },
      parDepartement: parDepartement.rows.map((r) => ({ departement: r.departement, prevu: Number(r.prevu), realise: Number(r.realise) })),
      equipements: Number(equipementsCount.rows[0].n),
      stockMateriaux: stock.rows.map((r) => ({ materiau: r.materiau, stock: Number(r.stock) })),
    },
  });
});

module.exports = router;
