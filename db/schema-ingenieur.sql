-- Schéma des données "ingénieur" — miroir des tables du logiciel de bureau
-- (voir db.js, SCHEMA) exposées via routes/ingenieur.js à l'application
-- Android de Maxence (accès complet : projets, travaux, flux, matériaux,
-- équipements, tableau de bord). Fichier séparé de db/schema.sql (les
-- tables des collaborateurs) pour ne jamais toucher à ce qui fonctionne déjà
-- en production — voir db/bootstrap.js qui applique les deux fichiers.
-- Toutes les instructions sont IF NOT EXISTS : sans danger à rejouer.
-- Préfixe "ing_" pour ne jamais entrer en collision avec les tables
-- existantes (travaux_journal, materiaux_journal, equipements_journal...).

CREATE TABLE IF NOT EXISTS ing_projets (
  id SERIAL PRIMARY KEY,
  nom TEXT NOT NULL,
  description TEXT,
  date_creation TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Réglages simples clé/valeur (ex: projet actif) — équivalent de la table
-- "settings" du logiciel de bureau.
CREATE TABLE IF NOT EXISTS ing_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS ing_travaux (
  id SERIAL PRIMARY KEY,
  projet_id INTEGER REFERENCES ing_projets(id) ON DELETE CASCADE,
  departement TEXT NOT NULL,
  localite TEXT NOT NULL,
  type_poteau TEXT,
  categorie TEXT NOT NULL,
  prevu NUMERIC DEFAULT 0,
  realise NUMERIC DEFAULT 0,
  date_maj TEXT
);
CREATE INDEX IF NOT EXISTS idx_ing_travaux_projet ON ing_travaux (projet_id);

-- Catégories personnalisées ("+ Nouvelle catégorie…" côté logiciel de
-- bureau), par domaine ("electricite" / "cables") et par projet — voir
-- listerCategoriesCustom/ajouterCategorieCustom dans db.js.
CREATE TABLE IF NOT EXISTS ing_categories_custom (
  id SERIAL PRIMARY KEY,
  projet_id INTEGER REFERENCES ing_projets(id) ON DELETE CASCADE,
  domaine TEXT NOT NULL,
  categorie TEXT NOT NULL,
  label TEXT NOT NULL,
  UNIQUE (projet_id, domaine, categorie)
);

CREATE TABLE IF NOT EXISTS ing_flux_poteaux (
  id SERIAL PRIMARY KEY,
  projet_id INTEGER REFERENCES ing_projets(id) ON DELETE CASCADE,
  commande_id INTEGER,
  departement TEXT NOT NULL,
  localite TEXT,
  type_poteau TEXT,
  quantite NUMERIC NOT NULL,
  etape TEXT NOT NULL,
  date_mvt TEXT,
  reference TEXT,
  commentaire TEXT,
  motif TEXT,
  motif_detail TEXT,
  statut TEXT
);
CREATE INDEX IF NOT EXISTS idx_ing_flux_projet ON ing_flux_poteaux (projet_id);

CREATE TABLE IF NOT EXISTS ing_commandes (
  id SERIAL PRIMARY KEY,
  projet_id INTEGER REFERENCES ing_projets(id) ON DELETE CASCADE,
  etape TEXT NOT NULL,
  date_mvt TEXT,
  departement TEXT NOT NULL,
  reference TEXT,
  commentaire TEXT
);

CREATE TABLE IF NOT EXISTS ing_materiaux_mouvements (
  id SERIAL PRIMARY KEY,
  projet_id INTEGER REFERENCES ing_projets(id) ON DELETE CASCADE,
  commande_id INTEGER,
  departement TEXT NOT NULL,
  localite TEXT,
  materiau TEXT,
  unite TEXT,
  quantite NUMERIC NOT NULL,
  etape TEXT NOT NULL,
  date_mvt TEXT,
  reference TEXT,
  commentaire TEXT
);
CREATE INDEX IF NOT EXISTS idx_ing_materiaux_projet ON ing_materiaux_mouvements (projet_id);

CREATE TABLE IF NOT EXISTS ing_types_poteaux (
  id SERIAL PRIMARY KEY,
  projet_id INTEGER REFERENCES ing_projets(id) ON DELETE CASCADE,
  type_poteau TEXT NOT NULL,
  longueur_fouille NUMERIC DEFAULT 0,
  largeur_fouille NUMERIC DEFAULT 0,
  profondeur_fouille NUMERIC DEFAULT 0,
  moule_pointe_diamant TEXT
);

CREATE TABLE IF NOT EXISTS ing_parametres_beton (
  id SERIAL PRIMARY KEY,
  projet_id INTEGER REFERENCES ing_projets(id) ON DELETE CASCADE,
  dosage_ciment_kg_m3 NUMERIC DEFAULT 350,
  volume_sable_m3_par_m3 NUMERIC DEFAULT 0.4,
  volume_concasse_m3_par_m3 NUMERIC DEFAULT 0.8,
  poids_volumique_concasse NUMERIC DEFAULT 1.5,
  pourcentage_poteau_fouille NUMERIC DEFAULT 7,
  longueur_plateforme NUMERIC DEFAULT 0,
  largeur_plateforme NUMERIC DEFAULT 0,
  hauteur_plateforme NUMERIC DEFAULT 0,
  concasse_calibrage TEXT DEFAULT 'deux_calibres',
  concasse_repartition_5_15_pct NUMERIC DEFAULT 50
);

CREATE TABLE IF NOT EXISTS ing_gravier_calibres (
  id SERIAL PRIMARY KEY,
  projet_id INTEGER REFERENCES ing_projets(id) ON DELETE CASCADE,
  type_gravier TEXT NOT NULL,
  calibre TEXT NOT NULL,
  repartition_pct NUMERIC DEFAULT 0,
  ordre INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ing_demandes_approvisionnement (
  id SERIAL PRIMARY KEY,
  projet_id INTEGER REFERENCES ing_projets(id) ON DELETE CASCADE,
  date_demande TEXT,
  departement TEXT NOT NULL,
  localite TEXT,
  materiau TEXT NOT NULL,
  unite TEXT,
  quantite_demandee NUMERIC DEFAULT 0,
  statut TEXT DEFAULT 'EnAttente',
  demandeur TEXT,
  date_besoin TEXT,
  reference TEXT,
  commentaire TEXT,
  date_maj TEXT
);

CREATE TABLE IF NOT EXISTS ing_equipements (
  id SERIAL PRIMARY KEY,
  projet_id INTEGER REFERENCES ing_projets(id) ON DELETE CASCADE,
  designation TEXT NOT NULL,
  departement TEXT,
  statut TEXT DEFAULT 'EnService',
  commentaire TEXT,
  code TEXT,
  localite TEXT,
  marque_modele TEXT,
  n_serie TEXT,
  date_mise_service TEXT,
  derniere_maintenance TEXT,
  quantite NUMERIC DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_ing_equipements_projet ON ing_equipements (projet_id);

CREATE TABLE IF NOT EXISTS ing_moules_pointes_diamant (
  id SERIAL PRIMARY KEY,
  projet_id INTEGER REFERENCES ing_projets(id) ON DELETE CASCADE,
  moule TEXT NOT NULL,
  longueur NUMERIC DEFAULT 0,
  largeur NUMERIC DEFAULT 0,
  hauteur NUMERIC DEFAULT 0
);

-- Documents générés (Word) stockés en base comme documents_journal, pour la
-- même raison : le disque du service Render est effacé à chaque redémarrage
-- sur le palier gratuit.
CREATE TABLE IF NOT EXISTS ing_documents_generes (
  id SERIAL PRIMARY KEY,
  projet_id INTEGER REFERENCES ing_projets(id) ON DELETE CASCADE,
  titre TEXT,
  type TEXT,
  nom_fichier TEXT,
  contenu BYTEA,
  taille INTEGER,
  date_creation TIMESTAMPTZ NOT NULL DEFAULT now()
);
