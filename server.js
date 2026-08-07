// Fichier existant, modifié pour brancher les nouvelles routes "ingénieur"
// (app Android de Maxence) — voir les lignes marquées AJOUT ci-dessous.
// Deux changements supplémentaires, nécessaires pour que l'appli Android
// (page web chargée depuis https://localhost dans le téléphone, donc une
// origine DIFFÉRENTE du serveur Render) puisse s'authentifier :
//  1. CORS : autorise explicitement l'origine de l'appli, avec les
//     identifiants (cookie de session) transmis.
//  2. cookie.sameSite passe de "lax" à "none" : un cookie "lax" n'est
//     JAMAIS envoyé sur une requête fetch() vers une origine différente
//     (seulement sur une navigation complète) — indispensable en HTTPS
//     (déjà le cas en production) pour que la session survive d'un appel à
//     l'autre depuis l'appli.
const path = require("path");
const express = require("express");
require("express-async-errors");
const cors = require("cors");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);

const { pool } = require("./db/pool");
const { chargerUtilisateur, exigerConnexion, exigerAdmin, exigerCollaborateur, exigerCleApi } = require("./middleware/auth");

const app = express();
app.set("trust proxy", 1); // nécessaire derrière le proxy de Render

// AJOUT — origines autorisées à appeler l'API avec cookies (CORS). Les
// origines par défaut de Capacitor sur Android/iOS ; ORIGINES_SUPPLEMENTAIRES
// permet d'en ajouter d'autres (ex: variante iOS ou domaine de test) via une
// variable d'environnement Render, sans toucher au code.
const ORIGINES_AUTORISEES = [
  "https://localhost",
  "capacitor://localhost",
  ...String(process.env.ORIGINES_SUPPLEMENTAIRES || "").split(",").map((o) => o.trim()).filter(Boolean),
];
app.use(cors({
  origin(origin, callback) {
    // "origin" est absent pour les requêtes same-origin (navigateur du
    // portail web classique) ou les appels machine-à-machine — toujours
    // autorisés, comme avant l'ajout de CORS.
    if (!origin || ORIGINES_AUTORISEES.includes(origin)) return callback(null, true);
    callback(new Error("Origine non autorisée."));
  },
  credentials: true,
}));

app.use(express.json());

const enProduction = process.env.NODE_ENV === "production";
app.use(
  session({
    store: new pgSession({ pool, tableName: "session", createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET || "dev-secret-changez-moi-en-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: enProduction,
      sameSite: "none", // AJOUT (était "lax") — voir explication en tête de fichier
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 jours
    },
  })
);

app.use(chargerUtilisateur);

app.use("/api", require("./routes/auth"));
app.use("/api/saisie", exigerConnexion, exigerCollaborateur, require("./routes/saisie"));
app.use("/api/admin", exigerConnexion, exigerAdmin, require("./routes/admin"));
// AJOUT — API complète pour l'application Android de Maxence (mêmes droits
// que le compte administrateur : c'est le même compte qui se connecte).
app.use("/api/ingenieur", exigerConnexion, exigerAdmin, require("./routes/ingenieur"));
// AJOUT — reçoit du logiciel de bureau une photographie complète du projet
// actif (voir routes/ingenieur-sync.js), pour que l'appli Android affiche
// les vraies données existantes et pas seulement ce qui est saisi depuis le
// téléphone. Authentification par clé API (comme /api/export), pas par
// session : c'est le logiciel de bureau qui appelle, pas un navigateur.
app.use("/api/ingenieur-sync", exigerCleApi, require("./routes/ingenieur-sync"));
app.use("/api", exigerCleApi, require("./routes/export"));

app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => {
  if (req.path.startsWith("/api")) return res.status(404).json({ erreur: "Route API inconnue." });
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((err, req, res, next) => {
  if (err && err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ erreur: "Ce fichier dépasse la taille maximale autorisée (15 Mo)." });
  }
  console.error(err);
  res.status(500).json({ erreur: "Erreur interne du serveur." });
});

const { bootstrap } = require("./db/bootstrap");
const port = process.env.PORT || 3000;
bootstrap()
  .then(() => app.listen(port, () => console.log(`LRA Suite Web à l'écoute sur le port ${port}`)))
  .catch((err) => { console.error("Échec de l'initialisation de la base de données :", err); process.exit(1); });
