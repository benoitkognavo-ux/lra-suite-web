# Déployer le portail web LRA Suite sur Render (gratuit)

Ce guide ne demande aucune ligne de commande sur votre ordinateur : tout se
fait par le site web de GitHub et de Render.

## 1. Mettre le code sur GitHub

1. Allez sur [github.com](https://github.com) et créez un compte gratuit si
   vous n'en avez pas (bouton "Sign up").
2. Une fois connecté, cliquez sur le **"+"** en haut à droite → **"New
   repository"**.
3. Donnez-lui un nom (ex: `lra-suite-web`), laissez-le **Public** ou
   **Private** (les deux fonctionnent), ne cochez rien d'autre, cliquez
   **"Create repository"**.
4. Sur la page du dépôt vide, cliquez **"uploading an existing file"** (lien
   dans le texte, ou bouton "Add file" → "Upload files").
5. Ouvrez le dossier `lra-suite-web` que je vous ai envoyé sur votre
   ordinateur, sélectionnez **tous les fichiers et dossiers À L'INTÉRIEUR**
   (pas le dossier lui-même) — **sauf le dossier `node_modules` s'il
   existe** — et glissez-les dans la zone de dépôt de GitHub.
6. En bas de page, cliquez **"Commit changes"**.

## 2. Déployer sur Render

1. Allez sur [render.com](https://render.com) et créez un compte gratuit
   (le plus simple : bouton "Sign up with GitHub", ça relie directement les
   deux).
2. Cliquez **"New +"** (en haut) → **"Blueprint"**.
3. Choisissez le dépôt `lra-suite-web` que vous venez de créer.
4. Render détecte automatiquement le fichier `render.yaml` inclus et vous
   propose de créer **un service web** + **une base de données** ensemble.
   Cliquez **"Apply"** / **"Deploy"**.
5. Patientez quelques minutes (le premier déploiement prend un peu de
   temps). Une fois terminé, le service web affiche une adresse du type
   `https://lra-suite-web-xxxx.onrender.com` — **c'est l'adresse à partager
   avec vos collaborateurs**.

## 3. Créer le schéma et votre compte administrateur

Dans le tableau de bord Render, ouvrez le service **lra-suite-web** (pas la
base de données), puis l'onglet **"Shell"** (une fenêtre de commande dans le
navigateur, rien à installer). Tapez ces 3 commandes, une par une, en
appuyant sur Entrée après chacune :

```
node scripts/migrate.js
node scripts/seed-admin.js maxence VOTRE_MOT_DE_PASSE "Maxence"
node scripts/generate-api-key.js "Synchronisation logiciel de bureau"
```

Remplacez `VOTRE_MOT_DE_PASSE` par le mot de passe que vous voulez utiliser
pour vous connecter au portail (au moins 6 caractères). Choisissez-en un que
vous ne réutilisez nulle part ailleurs.

**Notez la clé API affichée par la 3ᵉ commande** (elle commence par `lra_`)
— vous en aurez besoin dans le logiciel de bureau, onglet Projets, carte
"Synchronisation avec le portail web collaborateurs".

## 4. Se connecter

Ouvrez l'adresse `https://lra-suite-web-xxxx.onrender.com` dans un
navigateur (ordinateur ou téléphone), connectez-vous avec `maxence` et le
mot de passe choisi à l'étape 3, puis créez les comptes de vos
collaborateurs depuis le panneau qui s'affiche.

## Important : le palier gratuit expire

La base de données gratuite de Render est automatiquement supprimée
**30 jours après sa création** (+14 jours de grâce pour passer en payant).
Si l'essai vous convient, passez en payant (~13 $/mois : 7 $ le service web
+ 6 $ la base de données) **avant le 30ᵉ jour** depuis le tableau de bord
Render (bouton "Upgrade" sur chaque service), pour ne pas perdre les
données.
