// Pool de connexions PostgreSQL. En production (Render), DATABASE_URL est
// fourni automatiquement par le service de base de données. En local, on
// retombe sur la base de développement créée par scripts/dev.
const { Pool } = require("pg");

const connectionString =
  process.env.DATABASE_URL ||
  "postgres://lra_web:lra_web_dev_pw@localhost:5432/lra_suite_web";

// Render (et la plupart des hébergeurs gérés) exigent SSL sur la connexion
// externe à la base, mais le certificat n'est pas toujours dans une chaîne de
// confiance standard depuis l'extérieur de leur réseau — rejectUnauthorized:
// false est le réglage documenté par Render pour node-postgres. En local
// (pas de "sslmode" dans l'URL, pas de variable RENDER), on désactive SSL.
const useSsl = /render\.com|sslmode=require/.test(connectionString) || process.env.PGSSL === "true";

const pool = new Pool({
  connectionString,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
});

module.exports = { pool };
