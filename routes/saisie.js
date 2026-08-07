// Saisies quotidiennes des collaborateurs. Le département soumis est TOUJOURS
// vérifié contre la liste des départements rattachés au compte de
// l'utilisateur connecté (chargée par chargerUtilisateur) : un collaborateur
// ne peut jamais saisir — volontairement ou par erreur — dans un département
// qui ne lui a pas été explicitement autorisé par l'administrateur, même s'il
// gère plusieurs départements.
const express = require("express");
const multer = require("multer");
const { pool } = require("../db/pool");

const router = express.Router();

// Fichiers gardés en mémoire (pas écrits sur le disque du service, qui est
// effacé à chaque redémarrage sur le palier gratuit de Render) puis stockés
// directement dans la base de données. 15 Mo est largement suffisant pour
// une photo ou un PDF scanné, et évite qu'un envoi accidentel trop lourd
// remplisse la base gratuite.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const TYPES_DOCUMENTS = [
  "PVReceptionSite",
  "PVReceptionUsine",
  "BordereauLivraisonPoteaux",
  "BordereauLivraisonCiment",
  "BordereauLivraisonConcasse",
];

// Ces valeurs doivent correspondre EXACTEMENT aux catégories utilisées dans
// le logiciel de bureau (table travaux, colonne categorie), pour que la
// synchronisation incrémente les bonnes lignes. Les 5 catégories Électricité
// et les 9 catégories Câbles reprennent telles quelles les clés fixes
// définies côté bureau (voir renderer/modules/electricite.js et cables.js) —
// les catégories personnalisées que Maxence ajoute lui-même à la volée dans
// le logiciel de bureau (« + Nouvelle catégorie… ») ne sont PAS incluses ici
// et restent donc saisissables uniquement depuis le logiciel de bureau.
const CATEGORIES_TRAVAUX = [
  "Implantation",
  "FouillesImplantation",
  "FouillesMALTTerre",
  "FouillesMALTMasse",
  "PointesDiamant",
  "Plateforme",
  // Électricité
  "IACM",
  "DMT_CC",
  "Transformateur",
  "MiseTerreNeutreBT",
  "MiseTerreMassesMetalliques",
  // Câbles
  "CableBTRehab50",
  "CableBTRenforce70",
  "LigneHTA75Aerienne",
  "LigneHTA546Aerienne",
  "LigneBT3x70",
  "LigneBT3x50",
  "LigneMixteHTA755BT3x70",
  "LigneMixteHTA546BT3x70",
  "LigneMixteHTA546BT3x50",
];
// Étapes autorisées par matériau : le ciment peut être reçu OU utilisé, les
// autres (sable, concassés) ne sont demandés qu'à la réception pour l'instant.
const MATERIAUX_ETAPES = {
  Ciment: ["Livraison", "Utilisation"],
  Sable: ["Livraison"],
  "Concassé": ["Livraison"],
  "Concassé 5/15": ["Livraison"],
  "Concassé 15/25": ["Livraison"],
};
// Le ciment est géré au niveau du département (pas besoin de préciser la
// localité) — le sable et les concassés, eux, sont livrés directement à
// chaque localité, donc la localité est obligatoire pour ces matériaux.
const MATERIAUX_LOCALITE_REQUISE = {
  Ciment: false,
  Sable: true,
  "Concassé": true,
  "Concassé 5/15": true,
  "Concassé 15/25": true,
};

function nombrePositif(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function departementAutorise(req, departementSoumis) {
  const dep = (departementSoumis || "").trim().toUpperCase();
  if (!dep || !req.utilisateur.departements.includes(dep)) return null;
  return dep;
}

router.post("/travaux", async (req, res) => {
  const { departement, localite, type_poteau, categorie, quantite, date_saisie, commentaire } = req.body;
  const dep = departementAutorise(req, departement);
  if (!dep) return res.status(403).json({ erreur: "Département invalide ou non autorisé pour ce compte." });
  const loc = (localite || "").trim().toUpperCase();
  if (!loc) return res.status(400).json({ erreur: "La localité est obligatoire." });
  if (!CATEGORIES_TRAVAUX.includes(categorie)) return res.status(400).json({ erreur: "Catégorie invalide." });
  const q = nombrePositif(quantite);
  if (!q) return res.status(400).json({ erreur: "La quantité doit être un nombre positif." });
  const date = date_saisie || new Date().toISOString().slice(0, 10);

  const { rows } = await pool.query(
    `INSERT INTO travaux_journal (utilisateur_id, departement, localite, type_poteau, categorie, quantite, date_saisie, commentaire)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.utilisateur.id, dep, loc, (type_poteau || "").trim(), categorie, q, date, (commentaire || "").trim()]
  );
  res.json({ ok: true, saisie: rows[0] });
});

router.post("/materiaux", async (req, res) => {
  const { departement, materiau, unite, etape, quantite, date_saisie, commentaire, localite } = req.body;
  const dep = departementAutorise(req, departement);
  if (!dep) return res.status(403).json({ erreur: "Département invalide ou non autorisé pour ce compte." });
  const etapesAutorisees = MATERIAUX_ETAPES[materiau];
  if (!etapesAutorisees) return res.status(400).json({ erreur: "Matériau invalide." });
  if (!etapesAutorisees.includes(etape)) return res.status(400).json({ erreur: `Pour ${materiau}, seule(s) l'étape(s) ${etapesAutorisees.join(", ")} est/sont autorisée(s).` });
  const q = nombrePositif(quantite);
  if (!q) return res.status(400).json({ erreur: "La quantité doit être un nombre positif." });
  if (!unite || !unite.trim()) return res.status(400).json({ erreur: "L'unité est obligatoire." });
  const loc = (localite || "").trim().toUpperCase();
  if (MATERIAUX_LOCALITE_REQUISE[materiau] && !loc) {
    return res.status(400).json({ erreur: `La localité est obligatoire pour ${materiau} (livré directement sur site).` });
  }
  const date = date_saisie || new Date().toISOString().slice(0, 10);

  const { rows } = await pool.query(
    `INSERT INTO materiaux_journal (utilisateur_id, departement, localite, materiau, unite, quantite, etape, date_saisie, commentaire)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [req.utilisateur.id, dep, loc, materiau, unite.trim(), q, etape, date, (commentaire || "").trim()]
  );
  res.json({ ok: true, saisie: rows[0] });
});

// Mouvements d'équipements / matériel : ARRIVÉE (reçu dans un département) ou
// TRANSFERT (envoyé d'un département vers un autre). Pour une arrivée, le
// département soumis doit être autorisé pour ce compte (c'est là que le
// matériel se trouve). Pour un transfert, c'est le département D'ORIGINE qui
// doit être autorisé (c'est de là que le collaborateur l'envoie) — la
// destination, elle, peut être n'importe quel autre département du projet.
router.post("/equipements", async (req, res) => {
  const { departement, departement_origine, designation, quantite, type_mouvement, date_saisie, commentaire } = req.body;
  if (!["Arrivee", "Transfert"].includes(type_mouvement)) {
    return res.status(400).json({ erreur: "Type de mouvement invalide." });
  }
  const desig = (designation || "").trim();
  if (!desig) return res.status(400).json({ erreur: "La désignation est obligatoire." });
  const q = nombrePositif(quantite);
  if (!q) return res.status(400).json({ erreur: "La quantité doit être un nombre positif." });
  const date = date_saisie || new Date().toISOString().slice(0, 10);
  const com = (commentaire || "").trim();

  if (type_mouvement === "Arrivee") {
    const dep = departementAutorise(req, departement);
    if (!dep) return res.status(403).json({ erreur: "Département invalide ou non autorisé pour ce compte." });
    const { rows } = await pool.query(
      `INSERT INTO equipements_journal (utilisateur_id, departement, departement_origine, designation, quantite, type_mouvement, date_saisie, commentaire)
       VALUES ($1,$2,NULL,$3,$4,'Arrivee',$5,$6) RETURNING *`,
      [req.utilisateur.id, dep, desig, q, date, com]
    );
    return res.json({ ok: true, saisie: rows[0] });
  }

  const origine = departementAutorise(req, departement_origine);
  if (!origine) return res.status(403).json({ erreur: "Département d'origine invalide ou non autorisé pour ce compte." });
  const dest = (departement || "").trim().toUpperCase();
  if (!dest) return res.status(400).json({ erreur: "Le département de destination est obligatoire." });
  if (dest === origine) return res.status(400).json({ erreur: "Le département de destination doit être différent du département d'origine." });
  const { rows } = await pool.query(
    `INSERT INTO equipements_journal (utilisateur_id, departement, departement_origine, designation, quantite, type_mouvement, date_saisie, commentaire)
     VALUES ($1,$2,$3,$4,$5,'Transfert',$6,$7) RETURNING *`,
    [req.utilisateur.id, dest, origine, desig, q, date, com]
  );
  res.json({ ok: true, saisie: rows[0] });
});

// Envoi d'un document scanné/photographié (PV de réception, bordereau de
// livraison). multer place le fichier dans req.file (mémoire), avec les
// autres champs du formulaire dans req.body comme d'habitude.
router.post("/documents", upload.single("fichier"), async (req, res) => {
  const { departement, type, commentaire, date_saisie } = req.body;
  const dep = departementAutorise(req, departement);
  if (!dep) return res.status(403).json({ erreur: "Département invalide ou non autorisé pour ce compte." });
  if (!TYPES_DOCUMENTS.includes(type)) return res.status(400).json({ erreur: "Type de document invalide." });
  if (!req.file) return res.status(400).json({ erreur: "Aucun fichier reçu." });
  const date = date_saisie || new Date().toISOString().slice(0, 10);

  const { rows } = await pool.query(
    `INSERT INTO documents_journal (utilisateur_id, departement, type, nom_fichier, type_mime, taille, contenu, commentaire, date_saisie)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, departement, type, nom_fichier, type_mime, taille, commentaire, date_saisie, date_creation`,
    [req.utilisateur.id, dep, type, req.file.originalname.slice(0, 200), req.file.mimetype, req.file.size, req.file.buffer, (commentaire || "").trim(), date]
  );
  res.json({ ok: true, document: rows[0] });
});

// Référentiel des localités et des départements (poussé par le logiciel de
// bureau à chaque synchronisation) — sert à proposer des listes déroulantes
// aux collaborateurs plutôt qu'une saisie libre. Renvoyé en entier (pas
// seulement ce qui concerne le collaborateur) : le frontend filtre localement
// selon le département choisi pour cette saisie. "departements" contient
// TOUS les départements du projet (même sans localité connue) — utilisé
// notamment pour la destination d'un transfert d'équipement.
router.get("/localites", async (req, res) => {
  const localites = await pool.query("SELECT departement, localite FROM localites_referentiel ORDER BY departement, localite");
  const departements = await pool.query("SELECT departement FROM departements_referentiel ORDER BY departement");
  res.json({ localites: localites.rows, departements: departements.rows.map((r) => r.departement) });
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
  const documents = await pool.query(
    `SELECT id, departement, type, nom_fichier, type_mime, taille, commentaire, date_saisie, date_creation
     FROM documents_journal WHERE utilisateur_id = $1 AND date_creation > now() - interval '30 days' ORDER BY date_creation DESC LIMIT 100`,
    [req.utilisateur.id]
  );
  const equipements = await pool.query(
    `SELECT * FROM equipements_journal WHERE utilisateur_id = $1 AND date_creation > now() - interval '30 days' ORDER BY date_creation DESC LIMIT 100`,
    [req.utilisateur.id]
  );
  res.json({ travaux: travaux.rows, materiaux: materiaux.rows, documents: documents.rows, equipements: equipements.rows });
});

module.exports = router;
