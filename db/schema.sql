-- Schéma de la base centrale du portail web LRA Suite (saisie terrain à distance).
-- Conçu pour rester simple : chaque saisie est un mouvement journalier horodaté
-- (jamais une valeur absolue écrasée), afin que deux collaborateurs qui saisissent
-- le même jour ne puissent jamais s'écraser l'un l'autre — le logiciel de bureau
-- additionne ensuite ces mouvements dans ses propres totaux (même principe que
-- l'import de base Excel déjà utilisé côté logiciel de bureau).

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  nom TEXT NOT NULL,
  identifiant TEXT NOT NULL UNIQUE,
  mot_de_passe_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'collaborateur' CHECK (role IN ('admin', 'collaborateur')),
  departement TEXT,
  actif BOOLEAN NOT NULL DEFAULT true,
  date_creation TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Saisies quotidiennes des travaux réalisés (implantation, pointes de diamant).
-- Une ligne = "aujourd'hui, X poteaux/pointes réalisés à telle localité, tel type".
CREATE TABLE IF NOT EXISTS travaux_journal (
  id SERIAL PRIMARY KEY,
  utilisateur_id INTEGER NOT NULL REFERENCES users(id),
  departement TEXT NOT NULL,
  localite TEXT NOT NULL,
  type_poteau TEXT NOT NULL DEFAULT '',
  categorie TEXT NOT NULL,
  quantite NUMERIC NOT NULL CHECK (quantite > 0),
  date_saisie DATE NOT NULL,
  commentaire TEXT NOT NULL DEFAULT '',
  date_creation TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_travaux_journal_date_creation ON travaux_journal (date_creation);

-- Contrainte des catégories tenue à jour séparément (plutôt que dans le
-- CREATE TABLE ci-dessus) pour pouvoir l'élargir plus tard sans jamais
-- toucher aux lignes déjà enregistrées : ces valeurs doivent correspondre
-- EXACTEMENT aux catégories du logiciel de bureau (table travaux).
ALTER TABLE travaux_journal DROP CONSTRAINT IF EXISTS travaux_journal_categorie_check;
ALTER TABLE travaux_journal ADD CONSTRAINT travaux_journal_categorie_check
  CHECK (categorie IN ('Implantation', 'FouillesImplantation', 'FouillesMALTTerre', 'FouillesMALTMasse', 'PointesDiamant', 'Plateforme'));

-- Saisies quotidiennes des mouvements matériaux (réception, utilisation).
CREATE TABLE IF NOT EXISTS materiaux_journal (
  id SERIAL PRIMARY KEY,
  utilisateur_id INTEGER NOT NULL REFERENCES users(id),
  departement TEXT NOT NULL,
  materiau TEXT NOT NULL CHECK (materiau IN ('Ciment', 'Sable', 'Concassé', 'Concassé 5/15', 'Concassé 15/25')),
  unite TEXT NOT NULL,
  quantite NUMERIC NOT NULL CHECK (quantite > 0),
  etape TEXT NOT NULL CHECK (etape IN ('Livraison', 'Utilisation')),
  date_saisie DATE NOT NULL,
  commentaire TEXT NOT NULL DEFAULT '',
  date_creation TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_materiaux_journal_date_creation ON materiaux_journal (date_creation);

-- Clé(s) utilisées par le logiciel de bureau pour appeler l'API de synchronisation
-- (authentification machine-à-machine, distincte des sessions utilisateur web).
CREATE TABLE IF NOT EXISTS api_keys (
  id SERIAL PRIMARY KEY,
  cle TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  actif BOOLEAN NOT NULL DEFAULT true,
  date_creation TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Départements assignés à un collaborateur (certains gèrent plusieurs
-- départements). La colonne users.departement reste renseignée en plus
-- (avec le premier département) pour compatibilité, mais l'autorisation et
-- la saisie s'appuient désormais sur cette table.
CREATE TABLE IF NOT EXISTS user_departements (
  utilisateur_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  departement TEXT NOT NULL,
  PRIMARY KEY (utilisateur_id, departement)
);

-- Reprend automatiquement les comptes créés avant l'introduction de cette
-- table (qui n'avaient qu'un seul département dans users.departement).
INSERT INTO user_departements (utilisateur_id, departement)
SELECT id, departement FROM users WHERE departement IS NOT NULL AND departement <> ''
ON CONFLICT (utilisateur_id, departement) DO NOTHING;

-- Documents scannés/photographiés envoyés par les collaborateurs (PV de
-- réception, bordereaux de livraison). Le fichier est stocké directement en
-- base (colonne contenu) plutôt que sur le disque du service web : le disque
-- de Render est effacé à chaque redémarrage sur le palier gratuit, alors que
-- la base de données, elle, persiste.
CREATE TABLE IF NOT EXISTS documents_journal (
  id SERIAL PRIMARY KEY,
  utilisateur_id INTEGER NOT NULL REFERENCES users(id),
  departement TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN (
    'PVReceptionSite', 'PVReceptionUsine',
    'BordereauLivraisonPoteaux', 'BordereauLivraisonCiment', 'BordereauLivraisonConcasse'
  )),
  nom_fichier TEXT NOT NULL,
  type_mime TEXT NOT NULL DEFAULT 'application/octet-stream',
  taille INTEGER NOT NULL,
  contenu BYTEA NOT NULL,
  commentaire TEXT NOT NULL DEFAULT '',
  date_saisie DATE NOT NULL,
  date_creation TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_documents_journal_date_creation ON documents_journal (date_creation);

-- Référentiel des localités par département, poussé automatiquement par le
-- logiciel de bureau à chaque synchronisation (à partir du projet actif) :
-- permet au portail web de proposer une liste déroulante aux collaborateurs
-- plutôt qu'une saisie libre (qui provoquait des doublons du type
-- "Boriyoure" / "BORIYOURE" ou des fautes de frappe). Remplacé entièrement à
-- chaque envoi — voir PUT /api/referentiel/localites.
CREATE TABLE IF NOT EXISTS localites_referentiel (
  departement TEXT NOT NULL,
  localite TEXT NOT NULL,
  PRIMARY KEY (departement, localite)
);
