// Reçoit, depuis le logiciel de bureau (authentification par clé API, comme
// /api/export — PAS une session utilisateur), une "photographie" complète du
// projet actif du logiciel de bureau, et la stocke dans les tables "ing_*"
// (celles qui alimentent l'application Android de Maxence — voir
// routes/ingenieur.js). Avant l'ajout de ce fichier, ces tables restaient
// vides tant que personne ne créait rien directement depuis le téléphone :
// le logiciel de bureau n'envoyait jamais ses données, il ne faisait que
// recevoir celles des collaborateurs (voir routes/export.js). Ce fichier
// comble ce manque, dans l'autre sens.
//
// Remplacement complet (delete + insert) des données du projet à chaque
// appel, pas une fusion ligne à ligne : le logiciel de bureau reste la seule
// source de vérité pour ces données. Limitation connue de cette première
// version : une donnée créée ou modifiée depuis l'appli Android entre deux
// synchronisations du logiciel de bureau sera écrasée par l'envoi suivant.
// Appelé automatiquement à chaque clic sur "Synchroniser" côté logiciel de
// bureau (voir sync-portail-web.js, à la suite de la synchronisation déjà
// existante qui va dans l'autre sens).
const express = require("express");
const { pool } = require("../db/pool");

const router = express.Router();

router.put("/projet-actif", async (req, res) => {
  const { projet, travaux, flux, materiaux, equipements, categoriesCustom } = req.body || {};
  if (!projet || !projet.id || !projet.nom) {
    return res.status(400).json({ erreur: "Projet manquant ou incomplet (id et nom requis)." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO ing_projets (id, nom, description) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET nom = EXCLUDED.nom, description = EXCLUDED.description`,
      [projet.id, projet.nom, projet.description || ""]
    );
    // Empêche qu'une future création de projet depuis l'appli Android (qui,
    // elle, laisse Postgres attribuer l'id automatiquement) ne réutilise par
    // hasard un id déjà pris par un projet poussé ici depuis le bureau.
    await client.query(
      "SELECT setval('ing_projets_id_seq', (SELECT GREATEST(MAX(id), 1) FROM ing_projets))"
    );

    await client.query(
      `INSERT INTO ing_settings (key, value) VALUES ('projet_actif_id', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [String(projet.id)]
    );

    await client.query("DELETE FROM ing_travaux WHERE projet_id = $1", [projet.id]);
    for (const t of travaux || []) {
      await client.query(
        `INSERT INTO ing_travaux (projet_id, departement, localite, type_poteau, categorie, prevu, realise, date_maj)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [projet.id, t.departement, t.localite, t.type_poteau || "", t.categorie, t.prevu || 0, t.realise || 0, t.date_maj || ""]
      );
    }

    await client.query("DELETE FROM ing_flux_poteaux WHERE projet_id = $1", [projet.id]);
    for (const f of flux || []) {
      await client.query(
        `INSERT INTO ing_flux_poteaux (projet_id, departement, localite, type_poteau, quantite, etape, date_mvt, reference, commentaire, motif, motif_detail, statut)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [projet.id, f.departement, f.localite || "", f.type_poteau || "", f.quantite || 0, f.etape, f.date_mvt || "", f.reference || "", f.commentaire || "", f.motif || "", f.motif_detail || "", f.statut || ""]
      );
    }

    await client.query("DELETE FROM ing_materiaux_mouvements WHERE projet_id = $1", [projet.id]);
    for (const m of materiaux || []) {
      await client.query(
        `INSERT INTO ing_materiaux_mouvements (projet_id, departement, localite, materiau, unite, quantite, etape, date_mvt, reference, commentaire)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [projet.id, m.departement, m.localite || "", m.materiau, m.unite, m.quantite || 0, m.etape, m.date_mvt || "", m.reference || "", m.commentaire || ""]
      );
    }

    await client.query("DELETE FROM ing_equipements WHERE projet_id = $1", [projet.id]);
    for (const e of equipements || []) {
      await client.query(
        `INSERT INTO ing_equipements (projet_id, designation, departement, statut, commentaire, code, localite, marque_modele, n_serie, date_mise_service, derniere_maintenance, quantite)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [projet.id, e.designation, e.departement || "", e.statut || "EnService", e.commentaire || "", e.code || "", e.localite || "", e.marque_modele || "", e.n_serie || "", e.date_mise_service || "", e.derniere_maintenance || "", e.quantite ?? 1]
      );
    }

    await client.query("DELETE FROM ing_categories_custom WHERE projet_id = $1", [projet.id]);
    for (const c of categoriesCustom || []) {
      await client.query(
        `INSERT INTO ing_categories_custom (projet_id, domaine, categorie, label) VALUES ($1,$2,$3,$4)
         ON CONFLICT (projet_id, domaine, categorie) DO UPDATE SET label = EXCLUDED.label`,
        [projet.id, c.domaine, c.categorie, c.label || c.categorie]
      );
    }

    await client.query("COMMIT");
    res.json({
      ok: true,
      resume: {
        travaux: (travaux || []).length,
        flux: (flux || []).length,
        materiaux: (materiaux || []).length,
        equipements: (equipements || []).length,
        categoriesCustom: (categoriesCustom || []).length,
      },
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ erreur: "Échec de l'envoi vers l'application Android : " + (err.message || String(err)) });
  } finally {
    client.release();
  }
});

module.exports = router;
