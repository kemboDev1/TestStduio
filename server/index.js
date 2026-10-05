import "dotenv/config";
import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";
import api from "./api.js";

const app = express();
const port = Number(process.env.PORT || 4000);
const sessionSecret = process.env.SESSION_SECRET || "";
const isProduction = process.env.NODE_ENV === "production";
const PgSession = connectPgSimple(session);

if (sessionSecret.length < 32) {
  throw new Error("SESSION_SECRET must contain at least 32 characters. Set it in .env.");
}

app.disable("x-powered-by");
if (isProduction) app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "1mb" }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: "draft-8", legacyHeaders: false }));
app.use(session({
  name: "teststudio.sid",
  store: new PgSession({ pool, createTableIfMissing: true, tableName: "user_sessions" }),
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: "strict",
    maxAge: 1000 * 60 * 60 * 24 * 14
  }
}));

app.use("/api", (req, res, next) => {
  const origin = req.get("origin");
  const allowedOrigins = new Set((process.env.CLIENT_ORIGIN || "").split(",").map(value => value.trim()).filter(Boolean));
  if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method) && origin && allowedOrigins.size && !allowedOrigins.has(origin)) {
    return res.status(403).json({ error: "Cross-origin so'rov rad etildi." });
  }
  next();
});
app.use("/api", api);
app.use("/api", (_req, res) => res.status(404).json({ error: "API route topilmadi." }));

const root = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(root, "../dist");
app.use(express.static(distPath));
app.get(/^(?!\/api).*/, (_req, res, next) => {
  res.sendFile(path.join(distPath, "index.html"), error => error && next(error));
});

app.use((error, _req, res, _next) => {
  console.error(error);
  const status = Number(error.status) >= 400 && Number(error.status) < 600 ? Number(error.status) : 500;
  res.status(status).json({ error: status === 500 ? "Serverda kutilmagan xato yuz berdi." : error.message });
});

const server = app.listen(port, () => console.log(`TestStudio API listening on http://localhost:${port}`));

async function shutdown() {
  server.close();
  await pool.end();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);