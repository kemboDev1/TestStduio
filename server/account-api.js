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
  const firstName = cleanString(req.body?.firstName, 60);
  const lastName = cleanString(req.body?.lastName, 60);
  const gender = req.body?.gender;
  const usernameKey = username.toLocaleLowerCase("uz-UZ");
  const password = String(req.body?.password || "");
  const inviteCode = cleanString(req.body?.inviteCode, 32).toUpperCase();

  if (firstName.length < 2 || lastName.length < 2) return res.status(400).json({ error: "Ism va familiya kamida 2 ta belgidan iborat bo‘lsin." });
  if (!["male", "female"].includes(gender)) return res.status(400).json({ error: "Jinsni tanlang." });
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
      const groupResult = await client.query("SELECT id, gender_rule FROM groups WHERE invite_code = $1", [inviteCode]);
      group = groupResult.rows[0];
      if (!group) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Guruh kodi topilmadi yoki bekor qilingan." });
      }
      if (group.gender_rule !== "all" && group.gender_rule !== gender) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: group.gender_rule === "female" ? "Ushbu guruhga faqat ayollar qo‘shila oladi." : "Ushbu guruhga faqat erkaklar qo‘shila oladi." });
      }
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const inserted = await client.query(
      `INSERT INTO users (username, username_key, first_name, last_name, gender, password_hash, role, language)
       VALUES ($1, $2, $3, $4, $5, $6, 'tester', 'uz')
       RETURNING id, username, first_name, last_name, gender, role, avatar, theme, language, text_size, created_at, last_login_at`,
      [username, usernameKey, firstName, lastName, gender, passwordHash]
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
      `SELECT id, username, first_name, last_name, gender, role, avatar, theme, language, text_size, password_hash, is_banned, suspended_until, created_at, last_login_at
       FROM users WHERE username_key = $1`,
      [usernameKey]
    );
    const user = result.rows[0];
    if (!user || user.is_banned || (user.suspended_until && new Date(user.suspended_until) > new Date()) || !(await bcrypt.compare(password, user.password_hash))) {
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
  const gender = ["male", "female"].includes(req.body?.gender) ? req.body.gender : req.user.gender;
  const avatar = ["woman", "girl", "woman-sage", "woman-rose", "man", "boy", "man-blue", "man-olive"].includes(req.body?.avatar) ? req.body.avatar : (gender === "male" ? "man" : "woman");
  const textSize = ["small", "medium", "large"].includes(req.body?.textSize) ? req.body.textSize : (req.user.text_size || "medium");
  try {
    if (gender !== req.user.gender) {
      const incompatibleGroup = await pool.query(
        `SELECT g.name, g.gender_rule FROM group_members gm JOIN groups g ON g.id = gm.group_id
         WHERE gm.user_id = $1 AND g.gender_rule <> 'all' AND g.gender_rule <> $2 LIMIT 1`,
        [req.user.id, gender]
      );
      if (incompatibleGroup.rowCount) return res.status(409).json({ error: `Jinsingizni o‘zgartirish uchun avval “${incompatibleGroup.rows[0].name}” guruhidan chiqing yoki guruh adminidan jins qoidasini o‘zgartirishni so‘rang.` });
    }
    const result = await pool.query(
      `UPDATE users SET theme = $2, language = $3, avatar = $4, text_size = $5, gender = $6
       WHERE id = $1
       RETURNING id, username, first_name, last_name, gender, role, avatar, theme, language, text_size, created_at, last_login_at`,
      [req.user.id, theme, language, avatar, textSize, gender]
    );
    return res.json({ user: publicUser(result.rows[0]) });
  } catch (error) {
    return next(error);
  }
});

export default router;
