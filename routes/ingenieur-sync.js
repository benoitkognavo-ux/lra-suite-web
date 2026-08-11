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

// Contrepartie en lecture du PUT ci-dessous — permet à un logiciel de
// bureau qui n'a JAMAIS eu ce projet en local (typiquement : une nouvelle
// installation sur l'ordinateur d'un second utilisateur) de le télécharger
// intégralement au lieu de partir d'une base vide. Renvoie le projet actif
// (celui désigné par ing_settings.projet_actif_id) exactement dans le même
// format que celui envoyé par le PUT, pour pouvoir être réappliqué tel quel
// côté logiciel de bureau (voir pull-portail-web.js).
router.get("/projet-actif", async (req, res) => {
  try {
    const { rows: settingsRows } = await pool.query(
      "SELECT value FROM ing_settings WHERE key = 'projet_actif_id'"
    );
    const projetId = settingsRows[0] ? parseInt(settingsRows[0].value, 10) : null;
    if (!projetId) {
      return res.status(404).json({ erreur: "Aucun projet n'a encore été envoyé au portail web depuis le logiciel de bureau." });
    }

    const { rows: projetRows } = await pool.query(
      "SELECT id, nom, description FROM ing_projets WHERE id = $1",
      [projetId]
    );
    if (!projetRows.length) {
      return res.status(404).json({ erreur: "Projet introuvable sur le portail web." });
    }

    const [travaux, flux, materiaux, equipements, categoriesCustom, commandesRows] = await Promise.all([
      pool.query(
        "SELECT departement, localite, type_poteau, categorie, prevu, realise, date_maj FROM ing_travaux WHERE projet_id = $1",
        [projetId]
      ),
      // commande_id IS NULL : n'inclut jamais ici les lignes rattachées à une
      // commande groupée de poteaux (voir ci-dessous, "commandes") — sinon
      // elles seraient transmises deux fois (à plat ET imbriquées), ce qui
      // doublerait le total "poteaux commandés" une fois réappliqué côté
      // logiciel de bureau (voir remplacerProjetDepuisWeb).
      pool.query(
        "SELECT departement, localite, type_poteau, quantite, etape, date_mvt, reference, commentaire, motif, motif_detail, statut FROM ing_flux_poteaux WHERE projet_id = $1 AND commande_id IS NULL",
        [projetId]
      ),
      pool.query(
        "SELECT departement, localite, materiau, unite, quantite, etape, date_mvt, reference, commentaire FROM ing_materiaux_mouvements WHERE projet_id = $1",
        [projetId]
      ),
      pool.query(
        "SELECT designation, departement, statut, commentaire, code, localite, marque_modele, n_serie, date_mise_service, derniere_maintenance, quantite FROM ing_equipements WHERE projet_id = $1",
        [projetId]
      ),
      pool.query(
        "SELECT domaine, categorie, label FROM ing_categories_custom WHERE projet_id = $1",
        [projetId]
      ),
      pool.query(
        "SELECT id, etape, date_mvt, departement, reference, commentaire FROM ing_commandes WHERE projet_id = $1",
        [projetId]
      ),
    ]);

    // Commandes groupées de poteaux : chaque commande avec ses lignes
    // imbriquées (voir listCommandesAvecLignes côté logiciel de bureau) —
    // jamais transmises via leur id brut (sans signification sur la machine
    // qui les recevra), toujours comme un bloc autonome.
    const commandeIds = commandesRows.rows.map((c) => c.id);
    const lignesParCommande = new Map();
    if (commandeIds.length) {
      const { rows: lignesRows } = await pool.query(
        "SELECT commande_id, type_poteau, quantite, etape, date_mvt, reference, commentaire, motif, motif_detail, statut FROM ing_flux_poteaux WHERE commande_id = ANY($1::int[])",
        [commandeIds]
      );
      for (const l of lignesRows) {
        if (!lignesParCommande.has(l.commande_id)) lignesParCommande.set(l.commande_id, []);
        const { commande_id, ...ligne } = l;
        lignesParCommande.get(l.commande_id).push(ligne);
      }
    }
    const commandes = commandesRows.rows.map((c) => ({
      etape: c.etape,
      date_mvt: c.date_mvt,
      departement: c.departement,
      reference: c.reference,
      commentaire: c.commentaire,
      lignes: lignesParCommande.get(c.id) || [],
    }));

    res.json({
      projet: projetRows[0],
      travaux: travaux.rows,
      flux: flux.rows,
      materiaux: materiaux.rows,
      equipements: equipements.rows,
      categoriesCustom: categoriesCustom.rows,
      commandes,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erreur: "Échec de la récupération du projet : " + (err.message || String(err)) });
  }
});

router.put("/projet-actif", async (req, res) => {
  const { projet, travaux, flux, materiaux, equipements, categoriesCustom, commandes } = req.body || {};
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

    // Commandes groupées de poteaux (voir listCommandesAvecLignes côté
    // logiciel de bureau) : jamais incluses dans "flux" ci-dessus
    // (flux_poteaux.commande_id y est toujours NULL), donc supprimées et
    // recréées à part ici, avec leurs lignes réinsérées dans
    // ing_flux_poteaux en pointant vers le nouvel id généré par Postgres.
    await client.query("DELETE FROM ing_commandes WHERE projet_id = $1", [projet.id]);
    for (const c of commandes || []) {
      const { rows: cRows } = await client.query(
        `INSERT INTO ing_commandes (projet_id, etape, date_mvt, departement, reference, commentaire)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [projet.id, c.etape, c.date_mvt || "", c.departement, c.reference || "", c.commentaire || ""]
      );
      const commandeId = cRows[0].id;
      for (const l of c.lignes || []) {
        await client.query(
          `INSERT INTO ing_flux_poteaux (projet_id, commande_id, departement, localite, type_poteau, quantite, etape, date_mvt, reference, commentaire, motif, motif_detail, statut)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [projet.id, commandeId, c.departement, "", l.type_poteau || "", l.quantite || 0, l.etape || c.etape, l.date_mvt || c.date_mvt || "", l.reference || c.reference || "", l.commentaire || "", l.motif || "", l.motif_detail || "", l.statut || ""]
        );
      }
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
        commandes: (commandes || []).length,
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
