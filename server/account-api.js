import express from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import { pool } from "./db.js";
import { cleanString, publicUser, requireUser } from "./auth.js";

const router = express.Router();
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false });

function sessionLogin(req, userId) {
  return new Promise((resolve, reject) => {
    req.session.regenerate(error => {
      if (error) return reject(error);
      req.session.userId = userId;
      req.session.save(saveError => saveError ? reject(saveError) : resolve());
    });
  });
}

router.post("/register", authLimiter, async (req, res, next) => {
  const username = cleanString(req.body?.username, 32).normalize("NFKC");
  const usernameKey = username.toLocaleLowerCase("uz-UZ");
  const password = String(req.body?.password || "");
  const inviteCode = cleanString(req.body?.inviteCode, 32).toUpperCase();

  if (!/^[\p{L}\p{N}_. -]{2,32}$/u.test(username)) {
    return res.status(400).json({ error: "Ism 2–32 belgi bo‘lsin; harf, raqam, bo‘sh joy, nuqta va chiziqcha ishlating." });
  }
  if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
    return res.status(400).json({ error: "Parol 8–72 bayt oralig‘ida bo‘lishi kerak." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let group = null;
    if (inviteCode) {
      const groupResult = await client.query("SELECT id FROM groups WHERE invite_code = $1", [inviteCode]);
      group = groupResult.rows[0];
      if (!group) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Guruh kodi topilmadi yoki bekor qilingan." });
      }
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const inserted = await client.query(
      `INSERT INTO users (username, username_key, password_hash, role, language)
       VALUES ($1, $2, $3, 'tester', 'uz')
       RETURNING id, username, role, avatar, theme, language, created_at, last_login_at`,
      [username, usernameKey, passwordHash]
    );
    const user = inserted.rows[0];
    if (group) {
      await client.query("INSERT INTO group_members (group_id, user_id, member_role) VALUES ($1, $2, 'tester')", [group.id, user.id]);
    }
    await client.query("COMMIT");
    await sessionLogin(req, user.id);
    return res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505") return res.status(409).json({ error: "Bu ism oldin ro‘yxatdan o‘tgan." });
    return next(error);
  } finally {
    client.release();
  }
});

router.post("/login", authLimiter, async (req, res, next) => {
  const usernameKey = cleanString(req.body?.username, 32).normalize("NFKC").toLocaleLowerCase("uz-UZ");
  const password = String(req.body?.password || "");
  try {
    const result = await pool.query(
      `SELECT id, username, role, avatar, theme, language, password_hash, is_banned, created_at, last_login_at
       FROM users WHERE username_key = $1`,
      [usernameKey]
    );
    const user = result.rows[0];
    if (!user || user.is_banned || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Ism yoki parol noto‘g‘ri." });
    }
    await pool.query("UPDATE users SET last_login_at = NOW() WHERE id = $1", [user.id]);
    user.last_login_at = new Date();
    await sessionLogin(req, user.id);
    return res.json({ user: publicUser(user) });
  } catch (error) {
    return next(error);
  }
});

router.get("/me", requireUser, (req, res) => res.json({ user: publicUser(req.user) }));

router.post("/logout", (req, res, next) => {
  if (!req.session) return res.status(204).end();
  req.session.destroy(error => {
    if (error) return next(error);
    res.clearCookie("teststudio.sid", { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production" });
    return res.status(204).end();
  });
});

router.patch("/settings", requireUser, async (req, res, next) => {
  const theme = req.body?.theme === "dark" ? "dark" : "light";
  const language = ["uz", "ru", "en"].includes(req.body?.language) ? req.body.language : req.user.language;
  const avatar = cleanString(req.body?.avatar, 220_000);
  if (avatar && !/^data:image\/(png|jpeg|webp);base64,[a-z\d+/=]+$/i.test(avatar)) {
    return res.status(400).json({ error: "Profil rasmi noto‘g‘ri formatda." });
  }
  try {
    const result = await pool.query(
      `UPDATE users SET theme = $2, language = $3, avatar = $4
       WHERE id = $1
       RETURNING id, username, role, avatar, theme, language, created_at, last_login_at`,
      [req.user.id, theme, language, avatar]
    );
    return res.json({ user: publicUser(result.rows[0]) });
  } catch (error) {
    return next(error);
  }
});

export default router;
