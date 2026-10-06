import express from "express";
import rateLimit from "express-rate-limit";
import { randomBytes } from "node:crypto";
import { pool } from "./db.js";
import { cleanString, requireAdmin, requireTestAuthor, requireUser } from "./auth.js";
import { generateQuestions } from "./ai.js";

const router = express.Router();
const aiLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false });
router.use(requireUser);

const newInviteCode = () => randomBytes(6).toString("hex").toUpperCase();

async function accessibleQuiz(user, quizId) {
  const result = await pool.query(
    `SELECT q.id, q.title, q.description, q.owner_id, q.group_id, q.created_at,
            g.name AS group_name, g.owner_id AS group_owner_id, gm.member_role,
            owner.username AS owner_name
     FROM quizzes q
     JOIN users owner ON owner.id = q.owner_id
     LEFT JOIN groups g ON g.id = q.group_id
     LEFT JOIN group_members gm ON gm.group_id = q.group_id AND gm.user_id = $2
     WHERE q.id = $1 AND (q.owner_id = $2 OR g.owner_id = $2 OR gm.user_id = $2)`,
    [quizId, user.id]
  );
  return result.rows[0] || null;
}

function mayReview(user, quiz) {
  return (user.role === "admin" && quiz.group_owner_id === user.id)
    || (user.role === "creator" && quiz.member_role === "creator")
    || (quiz.owner_id === user.id && ["admin", "creator"].includes(user.role));
}

router.get("/overview", async (req, res, next) => {
  try {
    const result = await pool.query(
      `WITH accessible_groups AS (
         SELECT DISTINCT g.id FROM groups g
         LEFT JOIN group_members gm ON gm.group_id = g.id
         WHERE (g.owner_id = $1 AND $2 = 'admin') OR gm.user_id = $1
       )
       SELECT
         (SELECT COUNT(*)::int FROM accessible_groups) AS group_count,
         (SELECT COUNT(*)::int FROM group_members gm JOIN accessible_groups ag ON ag.id = gm.group_id WHERE gm.member_role = 'tester' AND $2 <> 'tester') AS client_count,
         (SELECT COUNT(*)::int FROM quizzes q JOIN accessible_groups ag ON ag.id = q.group_id) AS quiz_count,
         (SELECT COUNT(*)::int FROM attempts a JOIN quizzes q ON q.id = a.quiz_id JOIN accessible_groups ag ON ag.id = q.group_id WHERE a.is_practice = FALSE AND ($2 <> 'tester' OR a.user_id = $1)) AS response_count`,
      [req.user.id, req.user.role]
    );
    res.json({ overview: result.rows[0] });
  } catch (error) { next(error); }
});

router.get("/groups", async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT g.id, g.name, g.description, g.gender_rule, g.created_at,
              CASE WHEN g.owner_id = $1 THEN g.invite_code ELSE NULL END AS invite_code,
              CASE WHEN g.owner_id = $1 THEN 'admin' ELSE gm.member_role END AS my_role,
              (SELECT COUNT(*)::int FROM group_members m WHERE m.group_id = g.id AND m.member_role = 'tester') AS member_count,
              (SELECT COUNT(*)::int FROM quizzes q WHERE q.group_id = g.id) AS quiz_count
       FROM groups g
       LEFT JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $1
       WHERE g.owner_id = $1 OR gm.user_id = $1
       ORDER BY g.created_at DESC`,
      [req.user.id]
    );
    res.json({ groups: result.rows });
  } catch (error) { next(error); }
});

router.post("/groups", requireAdmin, async (req, res, next) => {
  const name = cleanString(req.body?.name, 100);
  const description = cleanString(req.body?.description, 500);
  const genderRule = ["all", "female", "male"].includes(req.body?.genderRule) ? req.body.genderRule : "all";
  if (name.length < 2) return res.status(400).json({ error: "Guruh nomi kamida 2 ta belgidan iborat bo‘lsin." });
  try {
    const result = await pool.query(
      `INSERT INTO groups (owner_id, name, description, gender_rule, invite_code) VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, description, gender_rule, invite_code, created_at`,
      [req.user.id, name, description, genderRule, newInviteCode()]
    );
    res.status(201).json({ group: { ...result.rows[0], my_role: "admin", member_count: 0, quiz_count: 0 } });
  } catch (error) { next(error); }
});

router.patch("/groups/:id", requireAdmin, async (req, res, next) => {
  const name = cleanString(req.body?.name, 100);
  const description = cleanString(req.body?.description, 500);
  const genderRule = ["all", "female", "male"].includes(req.body?.genderRule) ? req.body.genderRule : "all";
  if (name.length < 2) return res.status(400).json({ error: "Guruh nomi kamida 2 ta belgidan iborat bo‘lsin." });
  try {
    if (genderRule !== "all") {
      const incompatible = await pool.query(
        "SELECT COUNT(*)::int AS count FROM group_members gm JOIN users u ON u.id = gm.user_id WHERE gm.group_id = $1 AND u.gender <> $2",
        [req.params.id, genderRule]
      );
      if (incompatible.rows[0].count > 0) return res.status(409).json({ error: "Guruh jinsini o‘zgartirishdan oldin mos kelmaydigan ishtirokchilarni guruhdan olib tashlang." });
    }
    const result = await pool.query(
      `UPDATE groups SET name = $3, description = $4, gender_rule = $5,
         invite_code = CASE WHEN $6::boolean THEN $7 ELSE invite_code END, updated_at = NOW()
       WHERE id = $1 AND owner_id = $2 RETURNING id, name, description, gender_rule, invite_code, created_at`,
      [req.params.id, req.user.id, name, description, genderRule, req.body?.rotateInvite === true, newInviteCode()]
    );
    if (!result.rowCount) return res.status(404).json({ error: "Guruh topilmadi." });
    res.json({ group: result.rows[0] });
  } catch (error) { next(error); }
});

router.post("/groups/join", async (req, res, next) => {
  if (req.user.role === "admin") return res.status(400).json({ error: "Admin hisob guruhga tester sifatida qo‘shilmaydi." });
  const code = cleanString(req.body?.inviteCode, 32).toUpperCase();
  try {
    const group = await pool.query("SELECT id, gender_rule FROM groups WHERE invite_code = $1", [code]);
    if (!group.rowCount) return res.status(404).json({ error: "Taklif kodi topilmadi yoki bekor qilingan." });
    if (group.rows[0].gender_rule !== "all" && group.rows[0].gender_rule !== req.user.gender) {
      return res.status(403).json({ error: group.rows[0].gender_rule === "female" ? "Bu guruh faqat ayollar uchun." : "Bu guruh faqat erkaklar uchun." });
    }
    await pool.query(
      `INSERT INTO group_members (group_id, user_id, member_role) VALUES ($1, $2, 'tester')
       ON CONFLICT (group_id, user_id) DO NOTHING`,
      [group.rows[0].id, req.user.id]
    );
    res.status(201).json({ ok: true, groupId: group.rows[0].id });
  } catch (error) { next(error); }
});

router.get("/groups/:id/members", requireAdmin, async (req, res, next) => {
  try {
    const group = await pool.query("SELECT id FROM groups WHERE id = $1 AND owner_id = $2", [req.params.id, req.user.id]);
    if (!group.rowCount) return res.status(404).json({ error: "Guruh topilmadi." });
    const result = await pool.query(
      `SELECT u.id, u.username, u.first_name, u.last_name, u.gender, u.avatar, u.role, gm.member_role, gm.joined_at,
              (SELECT COUNT(*)::int FROM attempts a JOIN quizzes q ON q.id = a.quiz_id WHERE q.group_id = gm.group_id AND a.user_id = u.id AND a.is_practice = FALSE) AS response_count
       FROM group_members gm JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = $1 ORDER BY gm.joined_at DESC`,
      [req.params.id]
    );
    res.json({ members: result.rows });
  } catch (error) { next(error); }
});

router.post("/groups/:id/members", requireAdmin, async (req, res, next) => {
  const usernameKey = cleanString(req.body?.username, 32).normalize("NFKC").toLocaleLowerCase("uz-UZ");
  const memberRole = req.body?.role === "creator" ? "creator" : "tester";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const group = await client.query("SELECT id, gender_rule FROM groups WHERE id = $1 AND owner_id = $2", [req.params.id, req.user.id]);
    if (!group.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Guruh topilmadi." }); }
    const user = await client.query("SELECT id, username, gender FROM users WHERE username_key = $1 AND role <> 'admin'", [usernameKey]);
    if (!user.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Shu ismli hisob topilmadi. Avval ro‘yxatdan o‘tsin." }); }
    if (group.rows[0].gender_rule !== "all" && group.rows[0].gender_rule !== user.rows[0].gender) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: group.rows[0].gender_rule === "female" ? "Bu guruhga faqat ayollarni qo‘shish mumkin." : "Bu guruhga faqat erkaklarni qo‘shish mumkin." });
    }
    await client.query(
      `INSERT INTO group_members (group_id, user_id, member_role) VALUES ($1, $2, $3)
       ON CONFLICT (group_id, user_id) DO UPDATE SET member_role = EXCLUDED.member_role`,
      [req.params.id, user.rows[0].id, memberRole]
    );
    const creatorMembership = await client.query("SELECT EXISTS (SELECT 1 FROM group_members WHERE user_id = $1 AND member_role = 'creator') AS has_creator_role", [user.rows[0].id]);
    const userRole = creatorMembership.rows[0].has_creator_role ? "creator" : "tester";
    await client.query("UPDATE users SET role = $2 WHERE id = $1", [user.rows[0].id, userRole]);
    await client.query("COMMIT");
    res.status(201).json({ member: { ...user.rows[0], role: userRole, member_role: memberRole } });
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); next(error); }
  finally { client.release(); }
});

router.delete("/groups/:id/members/:userId", requireAdmin, async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const removed = await client.query("DELETE FROM group_members WHERE group_id = $1 AND user_id = $2 AND EXISTS (SELECT 1 FROM groups WHERE id = $1 AND owner_id = $3) RETURNING user_id", [req.params.id, req.params.userId, req.user.id]);
    if (!removed.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Guruh a’zosi topilmadi." }); }
    const remaining = await client.query("SELECT EXISTS (SELECT 1 FROM group_members WHERE user_id = $1 AND member_role = 'creator') AS has_creator_role", [req.params.userId]);
    await client.query("UPDATE users SET role = $2 WHERE id = $1 AND role <> 'admin'", [req.params.userId, remaining.rows[0].has_creator_role ? "creator" : "tester"]);
    await client.query("COMMIT");
    res.status(204).end();
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); next(error); }
  finally { client.release(); }
});

router.get("/quizzes", async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT q.id, q.title, q.description, q.owner_id, q.group_id, q.created_at,
              owner.username AS owner_name, g.name AS group_name,
              (q.owner_id = $1 OR (g.owner_id = $1 AND $2 = 'admin')) AS can_delete,
              (SELECT COUNT(*)::int FROM quiz_questions qq WHERE qq.quiz_id = q.id) AS question_count,
              (SELECT COUNT(*)::int FROM attempts a WHERE a.quiz_id = q.id AND a.is_practice = FALSE) AS response_count
       FROM quizzes q JOIN users owner ON owner.id = q.owner_id
       LEFT JOIN groups g ON g.id = q.group_id
       LEFT JOIN group_members gm ON gm.group_id = q.group_id AND gm.user_id = $1
       WHERE q.owner_id = $1 OR g.owner_id = $1 OR gm.user_id = $1
       ORDER BY q.created_at DESC LIMIT 200`,
      [req.user.id, req.user.role]
    );
    res.json({ quizzes: result.rows });
  } catch (error) { next(error); }
});

router.post("/quizzes", requireTestAuthor, async (req, res, next) => {
  const title = cleanString(req.body?.title, 120);
  const description = cleanString(req.body?.description, 600);
  const groupId = cleanString(req.body?.groupId, 64);
  const questions = Array.isArray(req.body?.questions) ? req.body.questions : [];
  if (title.length < 2) return res.status(400).json({ error: "Test nomi kamida 2 ta belgidan iborat bo‘lsin." });
  if (!groupId) return res.status(400).json({ error: "Testni joylashtirish uchun guruhni tanlang." });
  if (!questions.length || questions.length > 40) return res.status(400).json({ error: "Test 1–40 ta savoldan iborat bo‘lsin." });

  const normalized = [];
  for (let index = 0; index < questions.length; index++) {
    const question = questions[index];
    const type = ["text", "scale", "yes_no"].includes(question?.type) ? question.type : "multiple";
    const prompt = cleanString(question?.prompt, 600);
    if (!prompt) return res.status(400).json({ error: `${index + 1}-savolni to‘ldiring.` });
    if (type === "text") { normalized.push({ position: index, type, prompt, options: [], correct: null }); continue; }
    if (type === "yes_no") { normalized.push({ position: index, type, prompt, options: ["Ha", "Yo‘q"], correct: null }); continue; }
    const options = Array.isArray(question.options) ? question.options.map(option => cleanString(option, 300)).filter(Boolean).slice(0, 8) : [];
    const correct = null;
    if (options.length < 2) {
      return res.status(400).json({ error: `${index + 1}-savol javob variantlarini tekshiring.` });
    }
    normalized.push({ position: index, type, prompt, options, correct });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const group = await client.query(
      `SELECT g.id FROM groups g LEFT JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $2
       WHERE g.id = $1 AND ((g.owner_id = $2 AND $3 = 'admin') OR (gm.user_id = $2 AND gm.member_role = 'creator'))`,
      [groupId, req.user.id, req.user.role]
    );
    if (!group.rowCount) { await client.query("ROLLBACK"); return res.status(403).json({ error: "Siz bu guruhga test joylay olmaysiz." }); }
    const inserted = await client.query(
      `INSERT INTO quizzes (owner_id, group_id, title, description, is_public)
       VALUES ($1, $2, $3, $4, FALSE)
       RETURNING id, title, description, owner_id, group_id, created_at`,
      [req.user.id, groupId, title, description]
    );
    const quiz = inserted.rows[0];
    for (const question of normalized) {
      await client.query(
        `INSERT INTO quiz_questions (quiz_id, position, question_type, prompt, options, correct_option_index)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
        [quiz.id, question.position, question.type, question.prompt, JSON.stringify(question.options), question.correct]
      );
    }
    await client.query("COMMIT");
    res.status(201).json({ quiz: { ...quiz, owner_name: req.user.username, group_name: "", question_count: normalized.length, response_count: 0 } });
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); next(error); }
  finally { client.release(); }
});

router.get("/quizzes/:id/results", async (req, res, next) => {
  try {
    const quiz = await accessibleQuiz(req.user, req.params.id);
    if (!quiz) return res.status(404).json({ error: "Test topilmadi." });
    if (!mayReview(req.user, quiz)) return res.status(403).json({ error: "Natijalarni ko‘rish uchun Creator yoki Admin roli kerak." });
    const [questions, attempts] = await Promise.all([
      pool.query("SELECT id, position, prompt, question_type AS type, options FROM quiz_questions WHERE quiz_id = $1 ORDER BY position", [quiz.id]),
      pool.query(
        `SELECT a.id, a.answers, a.created_at, u.id AS user_id, u.username, u.first_name, u.last_name, u.avatar, u.gender
         FROM attempts a JOIN users u ON u.id = a.user_id
         WHERE a.quiz_id = $1 AND a.is_practice = FALSE ORDER BY a.created_at DESC LIMIT 500`,
        [quiz.id]
      )
    ]);
    res.json({ quiz, questions: questions.rows, results: attempts.rows });
  } catch (error) { next(error); }
});

router.get("/quizzes/:id", async (req, res, next) => {
  try {
    const quiz = await accessibleQuiz(req.user, req.params.id);
    if (!quiz) return res.status(404).json({ error: "Test topilmadi yoki bu guruhga ruxsatingiz yo‘q." });
    const questions = await pool.query(
      "SELECT id, position, question_type AS type, prompt, options FROM quiz_questions WHERE quiz_id = $1 ORDER BY position",
      [quiz.id]
    );
    res.json({ quiz, questions: questions.rows });
  } catch (error) { next(error); }
});

router.post("/quizzes/:id/attempts", async (req, res, next) => {
  const submitted = Array.isArray(req.body?.answers) ? req.body.answers : [];
  const client = await pool.connect();
  try {
    const quiz = await accessibleQuiz(req.user, req.params.id);
    if (!quiz) return res.status(404).json({ error: "Test topilmadi yoki bu guruhga ruxsatingiz yo‘q." });
    const isPractice = quiz.owner_id === req.user.id && ["admin", "creator"].includes(req.user.role);
    const questions = await client.query(
      "SELECT id, prompt, question_type, options FROM quiz_questions WHERE quiz_id = $1 ORDER BY position",
      [quiz.id]
    );
    const answersById = new Map(submitted.map(answer => [String(answer.questionId), answer]));
    const answerRecords = [];
    for (const question of questions.rows) {
      const answer = answersById.get(String(question.id));
      if (question.question_type === "text") {
        const text = cleanString(answer?.text, 1200);
        if (!text) return res.status(400).json({ error: "Har bir savolga javob bering." });
        answerRecords.push({ questionId: question.id, type: "text", answer: text });
      } else {
        const selected = Number(answer?.selectedOptionIndex);
        if (!Number.isInteger(selected) || selected < 0 || selected >= question.options.length) {
          return res.status(400).json({ error: "Har bir savol uchun javob tanlang." });
        }
        const optionText = question.options[selected];
        if (question.question_type === "scale") {
          answerRecords.push({ questionId: question.id, type: "scale", answer: optionText, selectedOptionIndex: selected });
        } else {
          answerRecords.push({ questionId: question.id, type: question.question_type, answer: optionText, selectedOptionIndex: selected });
        }
      }
    }
    const result = await client.query(
      `INSERT INTO attempts (quiz_id, user_id, score, total_scoreable, is_practice, answers)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       RETURNING id, is_practice, created_at`,
      [quiz.id, req.user.id, 0, 0, isPractice, JSON.stringify(answerRecords)]
    );
    res.status(201).json({ attempt: result.rows[0], answers: answerRecords });
  } catch (error) { next(error); }
  finally { client.release(); }
});

router.post("/ai/questions", requireTestAuthor, aiLimiter, async (req, res, next) => {
  const topic = cleanString(req.body?.topic, 500);
  const count = Math.max(2, Math.min(10, Number.parseInt(req.body?.count, 10) || 5));
  const groupId = cleanString(req.body?.groupId, 64);
  if (topic.length < 2) return res.status(400).json({ error: "Mavzuni kiriting." });
  try {
    const group = await pool.query(
      `SELECT g.id FROM groups g LEFT JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $2
       WHERE g.id = $1 AND ((g.owner_id = $2 AND $3 = 'admin') OR (gm.user_id = $2 AND gm.member_role = 'creator'))`,
      [groupId, req.user.id, req.user.role]
    );
    if (!group.rowCount) return res.status(403).json({ error: "Guruhni tanlang; unga test tuzish huquqingiz bo‘lsin." });
    res.json(await generateQuestions(topic, count));
  } catch (error) { next(error); }
});

router.get("/admin/users", requireAdmin, async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.first_name, u.last_name, u.gender, u.role, u.avatar, u.is_banned, u.suspended_until, u.warning_count, u.created_at, u.last_login_at,
              (SELECT COUNT(*)::int FROM quizzes q WHERE q.owner_id = u.id) AS quiz_count,
              (SELECT COUNT(*)::int FROM attempts a WHERE a.user_id = u.id AND a.is_practice = FALSE) AS attempt_count
       FROM users u ORDER BY u.created_at DESC`
    );
    res.json({ users: result.rows });
  } catch (error) { next(error); }
});

router.patch("/admin/users/:id", requireAdmin, async (req, res, next) => {
  const action = req.body?.action;
  try {
    const user = await pool.query("SELECT id, role FROM users WHERE id = $1", [req.params.id]);
    if (!user.rowCount) return res.status(404).json({ error: "Foydalanuvchi topilmadi." });
    if (user.rows[0].role === "admin") return res.status(403).json({ error: "Admin hisobini bu paneldan o‘zgartirib bo‘lmaydi." });
    let query;
    if (action === "warn") query = "UPDATE users SET warning_count = warning_count + 1 WHERE id = $1";
    else if (action === "ban") query = "UPDATE users SET is_banned = TRUE WHERE id = $1";
    else if (action === "suspend") {
      const days = Math.min(365, Math.max(1, Number.parseInt(req.body?.days, 10) || 7));
      await pool.query("UPDATE users SET suspended_until = NOW() + ($2 * INTERVAL '1 day') WHERE id = $1", [req.params.id, days]);
      return res.json({ ok: true });
    }
    else if (action === "role") {
      const role = req.body?.role;
      if (!["creator", "tester"].includes(role)) return res.status(400).json({ error: "Rol noto‘g‘ri." });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("UPDATE users SET role = $2 WHERE id = $1", [req.params.id, role]);
        await client.query("UPDATE group_members SET member_role = $2 WHERE user_id = $1", [req.params.id, role]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
      return res.json({ ok: true });
    }
    else if (action === "unban") query = "UPDATE users SET is_banned = FALSE, suspended_until = NULL WHERE id = $1";
    else return res.status(400).json({ error: "Admin amali noto‘g‘ri." });
    await pool.query(query, [req.params.id]);
    const result = await pool.query("SELECT id, username, role, is_banned, warning_count FROM users WHERE id = $1", [req.params.id]);
    res.json({ user: result.rows[0] });
  } catch (error) { next(error); }
});

router.delete("/admin/users/:id", requireAdmin, async (req, res, next) => {
  try {
    const deleted = await pool.query("DELETE FROM users WHERE id = $1 AND role <> 'admin' RETURNING id", [req.params.id]);
    if (!deleted.rowCount) return res.status(404).json({ error: "Hisob topilmadi yoki uni o‘chirish mumkin emas." });
    res.status(204).end();
  } catch (error) { next(error); }
});

router.delete("/quizzes/:id", async (req, res, next) => {
  try {
    const removed = await pool.query(
      `DELETE FROM quizzes q WHERE q.id = $1 AND (
        q.owner_id = $2 OR EXISTS (SELECT 1 FROM groups g WHERE g.id = q.group_id AND g.owner_id = $2 AND $3 = 'admin')
      ) RETURNING q.id`,
      [req.params.id, req.user.id, req.user.role]
    );
    if (!removed.rowCount) return res.status(404).json({ error: "Test topilmadi yoki o‘chirish huquqingiz yo‘q." });
    res.status(204).end();
  } catch (error) { next(error); }
});

export default router;
