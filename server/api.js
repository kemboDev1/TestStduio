import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { pool } from "./db.js";
import { generateQuestions } from "./ai.js";
import { publicUser, requireAdmin, requireUser } from "./auth.js";

const router = Router();
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false });
const aiLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false });
const cleanString = (value, max) => String(value || "").trim().slice(0, max);

router.get("/health", async (_req, res, next) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch (error) {
    next(error);
  }
});

router.get("/auth/me", async (req, res, next) => {
  if (!req.session.userId) return res.json({ user: null });
  try {
    const result = await pool.query("SELECT id, username, role, avatar, theme, language, created_at, last_login_at, is_banned FROM users WHERE id = $1", [req.session.userId]);
    const user = result.rows[0];
    if (!user || user.is_banned) {
      req.session.destroy(() => {});
      return res.json({ user: null });
    }
    res.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

router.post("/auth/register", authLimiter, async (req, res, next) => {
  const username = cleanString(req.body.username, 32);
  const usernameKey = username.toLocaleLowerCase();
  const password = String(req.body.password || "");
  if (username.length < 2 || !/^[\p{L}\p{N}_ -]+$/u.test(username)) {
    return res.status(400).json({ error: "Ism 2-32 belgi bo'lsin; harf, raqam, bo'sh joy va _ ishlating." });
  }
  if (password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: "Parol 8-128 belgi bo'lishi kerak." });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (username, username_key, password_hash, avatar, last_login_at)
       VALUES ($1, $2, $3, $4, NOW())
      RETURNING id, username, role, avatar, theme, language, created_at, last_login_at`,
      [username, usernameKey, passwordHash, username.charAt(0).toLocaleUpperCase()]
    );
    const user = result.rows[0];
    req.session.userId = user.id;
    res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ error: "Bu ism bilan account mavjud." });
    next(error);
  }
});

router.post("/auth/login", authLimiter, async (req, res, next) => {
  const usernameKey = cleanString(req.body.username, 32).toLocaleLowerCase();
  const password = String(req.body.password || "");
  try {
    const result = await pool.query("SELECT * FROM users WHERE username_key = $1", [usernameKey]);
    const user = result.rows[0];
    if (!user || user.is_banned || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Ism yoki parol noto'g'ri, yoxud account bloklangan." });
    }
    await pool.query("UPDATE users SET last_login_at = NOW() WHERE id = $1", [user.id]);
    req.session.regenerate(error => {
      if (error) return next(error);
      req.session.userId = user.id;
      res.json({ user: publicUser({ ...user, last_login_at: new Date() }) });
    });
  } catch (error) {
    next(error);
  }
});

router.post("/auth/logout", (req, res, next) => {
  req.session.destroy(error => {
    if (error) return next(error);
    res.clearCookie("teststudio.sid", { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production" });
    res.status(204).end();
  });
});

router.use(requireUser);

router.patch("/auth/settings", async (req, res, next) => {
  const { theme, language, avatar } = req.body;
  if (!new Set(["light", "dark"]).has(theme)) return res.status(400).json({ error: "Mavzuni tanlang." });
  if (!new Set(["en", "uz", "ru"]).has(language)) return res.status(400).json({ error: "Tilni tanlang." });
  const isPhoto = typeof avatar === "string" && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(avatar);
  const isInitial = typeof avatar === "string" && /^[\p{L}\p{N}]{1,16}$/u.test(avatar);
  if (typeof avatar !== "string" || avatar.length > 200_000 || (avatar && !isPhoto && !isInitial)) {
    return res.status(400).json({ error: "Rasm JPG, PNG yoki WebP bo'lsin va hajmi 150 KB dan oshmasin." });
  }
  try {
    const result = await pool.query(
      "UPDATE users SET theme = $2, language = $3, avatar = $4 WHERE id = $1 RETURNING id, username, role, avatar, theme, language, created_at, last_login_at",
      [req.user.id, theme, language, avatar]
    );
    res.json({ user: publicUser(result.rows[0]) });
  } catch (error) {
    next(error);
  }
});

router.get("/quizzes", async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT q.id, q.title, q.description, q.created_at, q.owner_id,
              u.username AS owner_name,
              COUNT(DISTINCT qq.id)::int AS question_count,
              COUNT(DISTINCT c.id)::int AS comment_count
       FROM quizzes q
       JOIN users u ON u.id = q.owner_id
       LEFT JOIN quiz_questions qq ON qq.quiz_id = q.id
       LEFT JOIN comments c ON c.quiz_id = q.id
       WHERE q.is_public = TRUE OR q.owner_id = $1
       GROUP BY q.id, u.username
       ORDER BY q.created_at DESC`,
      [req.user.id]
    );
    res.json({ quizzes: result.rows });
  } catch (error) {
    next(error);
  }
});

router.post("/quizzes", async (req, res, next) => {
  const title = cleanString(req.body.title, 120);
  const description = cleanString(req.body.description, 600);
  const questions = req.body.questions;
  if (title.length < 2 || !Array.isArray(questions) || questions.length < 1 || questions.length > 40) {
    return res.status(400).json({ error: "Test nomi va 1-40 ta savol talab qilinadi." });
  }

  const normalized = [];
  for (const [position, question] of questions.entries()) {
    const prompt = cleanString(question.prompt, 600);
    if (!prompt) return res.status(400).json({ error: `${position + 1}-savol matni bo'sh.` });
    if (question.type === "text") {
      normalized.push({ position, prompt, type: "text", options: [], correct: null });
      continue;
    }
    const options = Array.isArray(question.options) ? question.options.map(option => cleanString(option, 300)).filter(Boolean) : [];
    const correct = Number(question.correctOptionIndex);
    if (options.length < 2 || options.length > 6 || !Number.isInteger(correct) || correct < 0 || correct >= options.length) {
      return res.status(400).json({ error: `${position + 1}-savol variantlari yoki to'g'ri javobi noto'g'ri.` });
    }
    normalized.push({ position, prompt, type: "multiple", options, correct });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const quizResult = await client.query(
      "INSERT INTO quizzes (owner_id, title, description) VALUES ($1, $2, $3) RETURNING id, title, description, created_at",
      [req.user.id, title, description]
    );
    const quiz = quizResult.rows[0];
    for (const question of normalized) {
      await client.query(
        `INSERT INTO quiz_questions (quiz_id, position, question_type, prompt, options, correct_option_index)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
        [quiz.id, question.position, question.type, question.prompt, JSON.stringify(question.options), question.correct]
      );
    }
    await client.query("COMMIT");
    res.status(201).json({ quiz: { ...quiz, owner_id: req.user.id, owner_name: req.user.username, question_count: normalized.length } });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

router.get("/quizzes/:id", async (req, res, next) => {
  try {
    const quizResult = await pool.query(
      `SELECT q.id, q.title, q.description, q.owner_id, q.created_at, u.username AS owner_name
       FROM quizzes q JOIN users u ON u.id = q.owner_id
       WHERE q.id = $1 AND (q.is_public = TRUE OR q.owner_id = $2)`,
      [req.params.id, req.user.id]
    );
    const quiz = quizResult.rows[0];
    if (!quiz) return res.status(404).json({ error: "Test topilmadi." });
    const questionsResult = await pool.query(
      `SELECT id, position, question_type AS type, prompt,
              options,
              CASE WHEN $2::uuid = $3::uuid THEN correct_option_index ELSE NULL END AS correct_option_index
       FROM quiz_questions WHERE quiz_id = $1 ORDER BY position`,
      [quiz.id, req.user.id, quiz.owner_id]
    );
    res.json({ quiz, questions: questionsResult.rows });
  } catch (error) {
    next(error);
  }
});

router.post("/quizzes/:id/attempts", async (req, res, next) => {
  const submitted = Array.isArray(req.body.answers) ? req.body.answers : [];
  try {
    const quizResult = await pool.query("SELECT id, owner_id FROM quizzes WHERE id = $1 AND (is_public = TRUE OR owner_id = $2)", [req.params.id, req.user.id]);
    if (!quizResult.rowCount) return res.status(404).json({ error: "Ochiq test topilmadi." });
    const isPractice = quizResult.rows[0].owner_id === req.user.id;
    const questions = await pool.query(
      "SELECT id, prompt, question_type, options, correct_option_index FROM quiz_questions WHERE quiz_id = $1 ORDER BY position",
      [req.params.id]
    );
    const byId = new Map(submitted.map(answer => [String(answer.questionId), answer]));
    let score = 0;
    let total = 0;
    const answerRecords = questions.rows.map(question => {
      const answer = byId.get(question.id) || {};
      if (question.question_type === "text") {
        return { questionId: question.id, answer: cleanString(answer.text, 1200), type: "text" };
      }
      total++;
      const selected = Number(answer.selectedOptionIndex);
      const correct = Number.isInteger(selected) && selected === question.correct_option_index;
      if (correct) score++;
      return { questionId: question.id, selectedOptionIndex: Number.isInteger(selected) ? selected : null, correct };
    });
    const result = await pool.query(
      `INSERT INTO attempts (quiz_id, user_id, score, total_scoreable, is_practice, answers)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      RETURNING id, score, total_scoreable, is_practice, created_at`,
      [req.params.id, req.user.id, score, total, isPractice, JSON.stringify(answerRecords)]
    );
    res.status(201).json({ attempt: result.rows[0], answers: answerRecords });
  } catch (error) {
    next(error);
  }
});

router.get("/quizzes/:id/comments", async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT c.id, c.body, c.created_at, c.author_id, u.username AS author_name
       FROM comments c JOIN users u ON u.id = c.author_id
       WHERE c.quiz_id = $1 ORDER BY c.created_at DESC LIMIT 100`,
      [req.params.id]
    );
    res.json({ comments: result.rows });
  } catch (error) {
    next(error);
  }
});

router.post("/quizzes/:id/comments", async (req, res, next) => {
  const body = cleanString(req.body.body, 1200);
  if (body.length < 2) return res.status(400).json({ error: "Feedback kamida 2 belgidan iborat bo'lsin." });
  try {
    const quiz = await pool.query("SELECT owner_id FROM quizzes WHERE id = $1 AND is_public = TRUE", [req.params.id]);
    if (!quiz.rowCount) return res.status(404).json({ error: "Ochiq test topilmadi." });
    if (quiz.rows[0].owner_id === req.user.id) return res.status(403).json({ error: "O'z testingizga feedback qoldira olmaysiz." });
    const attempted = await pool.query("SELECT 1 FROM attempts WHERE quiz_id = $1 AND user_id = $2 LIMIT 1", [req.params.id, req.user.id]);
    if (!attempted.rowCount) return res.status(403).json({ error: "Feedback uchun avval testni yeching." });
    const result = await pool.query(
      `INSERT INTO comments (quiz_id, author_id, body) VALUES ($1, $2, $3)
       RETURNING id, quiz_id, author_id, body, created_at`,
      [req.params.id, req.user.id, body]
    );
    res.status(201).json({ comment: { ...result.rows[0], author_name: req.user.username } });
  } catch (error) {
    next(error);
  }
});

router.get("/leaderboard", async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.avatar, COUNT(DISTINCT a.quiz_id)::int AS plays
       FROM users u JOIN attempts a ON a.user_id = u.id AND a.is_practice = FALSE
       WHERE u.is_banned = FALSE
       GROUP BY u.id ORDER BY plays DESC, u.username ASC LIMIT 100`
    );
    res.json({ users: result.rows });
  } catch (error) {
    next(error);
  }
});

router.post("/ai/questions", aiLimiter, async (req, res, next) => {
  const topic = cleanString(req.body.topic, 500);
  const count = Math.max(2, Math.min(10, Number.parseInt(req.body.count, 10) || 5));
  if (topic.length < 2) return res.status(400).json({ error: "AI uchun mavzuni kiriting." });
  try {
    res.json(await generateQuestions(topic, count));
  } catch (error) {
    next(error);
  }
});

router.get("/admin/users", requireAdmin, async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.role, u.avatar, u.is_banned, u.warning_count, u.created_at, u.last_login_at,
              COUNT(DISTINCT q.id)::int AS quiz_count,
              COUNT(DISTINCT a.id) FILTER (WHERE a.is_practice = FALSE)::int AS attempt_count
       FROM users u
       LEFT JOIN quizzes q ON q.owner_id = u.id
       LEFT JOIN attempts a ON a.user_id = u.id
       GROUP BY u.id ORDER BY u.created_at DESC`
    );
    res.json({ users: result.rows });
  } catch (error) {
    next(error);
  }
});

router.patch("/admin/users/:id", requireAdmin, async (req, res, next) => {
  const action = req.body.action;
  if (!new Set(["warn", "ban", "unban"]).has(action)) return res.status(400).json({ error: "Noma'lum moderation amali." });
  if (req.params.id === req.user.id) return res.status(400).json({ error: "O'z accountingizga bu amalni bajara olmaysiz." });
  try {
    const result = action === "warn"
      ? await pool.query("UPDATE users SET warning_count = warning_count + 1 WHERE id = $1 AND role <> 'admin' RETURNING id, warning_count, is_banned", [req.params.id])
      : await pool.query("UPDATE users SET is_banned = $2 WHERE id = $1 AND role <> 'admin' RETURNING id, warning_count, is_banned", [req.params.id, action === "ban"]);
    if (!result.rowCount) return res.status(404).json({ error: "Oddiy user topilmadi." });
    res.json({ user: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

export default router;