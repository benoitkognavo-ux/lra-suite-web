const path = require("path");
const express = require("express");
require("express-async-errors"); // permet aux handlers async de propager leurs erreurs au middleware d'erreurs Express (Express 4 ne le fait pas nativement)
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);

const { pool } = require("./db/pool");
const { chargerUtilisateur, exigerConnexion, exigerAdmin, exigerCollaborateur, exigerCleApi } = require("./middleware/auth");

const app = express();
app.set("trust proxy", 1); // nécessaire derrière le proxy de Render pour que les cookies "secure" fonctionnent

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
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 jours : usage terrain, on évite de reconnecter sans arrêt
    },
  })
);

app.use(chargerUtilisateur);

// ---------- Routes API ----------
app.use("/api", require("./routes/auth"));
app.use("/api/saisie", exigerConnexion, exigerCollaborateur, require("./routes/saisie"));
app.use("/api/admin", exigerConnexion, exigerAdmin, require("./routes/admin"));
app.use("/api", exigerCleApi, require("./routes/export"));

// ---------- Frontend statique ----------
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => {
  if (req.path.startsWith("/api")) return res.status(404).json({ erreur: "Route API inconnue." });
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Gestionnaire d'erreurs générique : évite qu'une exception async non
// interceptée fasse planter le processus (Express 4 ne catch pas les rejets
// de promesse dans les handlers par défaut).
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ erreur: "Erreur interne du serveur." });
});

const { bootstrap } = require("./db/bootstrap");

const port = process.env.PORT || 3000;
bootstrap()
  .then(() => {
    app.listen(port, () => console.log(`LRA Suite Web à l'écoute sur le port ${port}`));
  })
  .catch((err) => {
    console.error("Échec de l'initialisation de la base de données :", err);
    process.exit(1);
  });
