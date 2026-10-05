import express from "express";
import rateLimit from "express-rate-limit";
import { pool } from "./db.js";
import { requireUser, requireAdmin, cleanString } from "./auth.js";
import { generateQuestions } from "./ai.js";

const router = express.Router();

const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false
});

router.use(requireUser);

/* =========================================================
   QUIZZES
   ========================================================= */

router.get("/quizzes", async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT
         q.id,
         q.title,
         q.description,
         q.owner_id,
         q.is_public,
         q.created_at,
         q.updated_at,
         u.username AS owner_name,
         (
           SELECT COUNT(*)::int
           FROM quiz_questions qq
           WHERE qq.quiz_id = q.id
         ) AS question_count,
         (
           SELECT COUNT(*)::int
           FROM comments c
           WHERE c.quiz_id = q.id
         ) AS comment_count
       FROM quizzes q
       JOIN users u ON u.id = q.owner_id
       WHERE q.is_public = TRUE OR q.owner_id = $1
       ORDER BY q.created_at DESC
       LIMIT 200`,
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
  const isPublic = req.body.is_public !== false;
  const questions = Array.isArray(req.body.questions)
    ? req.body.questions
    : [];

  if (!title) {
    return res.status(400).json({
      error: "Test nomini kiriting."
    });
  }

  if (!questions.length) {
    return res.status(400).json({
      error: "Kamida bitta savol kerak."
    });
  }

  const normalized = [];

  for (let index = 0; index < questions.length; index++) {
    const question = questions[index];

    const type =
      question?.type === "text"
        ? "text"
        : "multiple";

    const prompt = cleanString(question?.prompt, 600);

    if (!prompt) {
      return res.status(400).json({
        error: `${index + 1}-savol bo'sh.`
      });
    }

    if (type === "text") {
      normalized.push({
        position: index,
        type,
        prompt,
        options: [],
        correct: null
      });
      continue;
    }

    const options = Array.isArray(question?.options)
      ? question.options
          .map(option => cleanString(option, 300))
          .filter(Boolean)
          .slice(0, 10)
      : [];

    const correct = Number(question?.correct);

    if (options.length < 2) {
      return res.status(400).json({
        error: `${index + 1}-savolda kamida 2 ta variant bo'lishi kerak.`
      });
    }

    if (
      !Number.isInteger(correct) ||
      correct < 0 ||
      correct >= options.length
    ) {
      return res.status(400).json({
        error: `${index + 1}-savolning to'g'ri javobi noto'g'ri.`
      });
    }

    normalized.push({
      position: index,
      type,
      prompt,
      options,
      correct
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const quizResult = await client.query(
      `INSERT INTO quizzes
         (owner_id, title, description, is_public)
       VALUES ($1, $2, $3, $4)
       RETURNING id, title, description, owner_id, is_public, created_at, updated_at`,
      [
        req.user.id,
        title,
        description,
        isPublic
      ]
    );

    const quiz = quizResult.rows[0];

    for (const question of normalized) {
      await client.query(
        `INSERT INTO quiz_questions
           (
             quiz_id,
             position,
             question_type,
             prompt,
             options,
             correct_option_index
           )
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
        [
          quiz.id,
          question.position,
          question.type,
          question.prompt,
          JSON.stringify(question.options),
          question.correct
        ]
      );
    }

    await client.query("COMMIT");

    res.status(201).json({
      quiz: {
        ...quiz,
        owner_id: req.user.id,
        owner_name: req.user.username,
        question_count: normalized.length
      }
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

/* =========================================================
   SINGLE QUIZ
   ========================================================= */

router.get("/quizzes/:id", async (req, res, next) => {
  try {
    const quizResult = await pool.query(
      `SELECT
         q.id,
         q.title,
         q.description,
         q.owner_id,
         q.created_at,
         u.username AS owner_name
       FROM quizzes q
       JOIN users u ON u.id = q.owner_id
       WHERE q.id = $1
         AND (q.is_public = TRUE OR q.owner_id = $2)`,
      [
        req.params.id,
        req.user.id
      ]
    );

    const quiz = quizResult.rows[0];

    if (!quiz) {
      return res.status(404).json({
        error: "Test topilmadi."
      });
    }

    const questionsResult = await pool.query(
      `SELECT
         id,
         position,
         question_type AS type,
         prompt,
         options,
         CASE
           WHEN $2::uuid = $3::uuid
           THEN correct_option_index
           ELSE NULL
         END AS correct_option_index
       FROM quiz_questions
       WHERE quiz_id = $1
       ORDER BY position`,
      [
        quiz.id,
        req.user.id,
        quiz.owner_id
      ]
    );

    res.json({
      quiz,
      questions: questionsResult.rows
    });
  } catch (error) {
    next(error);
  }
});

/* =========================================================
   SUBMIT TEST
   ========================================================= */

router.post("/quizzes/:id/attempts", async (req, res, next) => {
  const submitted = Array.isArray(req.body.answers)
    ? req.body.answers
    : [];

  try {
    const quizResult = await pool.query(
      `SELECT id, owner_id
       FROM quizzes
       WHERE id = $1
         AND (is_public = TRUE OR owner_id = $2)`,
      [
        req.params.id,
        req.user.id
      ]
    );

    if (!quizResult.rowCount) {
      return res.status(404).json({
        error: "Ochiq test topilmadi."
      });
    }

    const isPractice =
      quizResult.rows[0].owner_id === req.user.id;

    const questions = await pool.query(
      `SELECT
         id,
         prompt,
         question_type,
         options,
         correct_option_index
       FROM quiz_questions
       WHERE quiz_id = $1
       ORDER BY position`,
      [req.params.id]
    );

    const byId = new Map(
      submitted.map(answer => [
        String(answer.questionId),
        answer
      ])
    );

    let score = 0;
    let total = 0;

    const answerRecords = questions.rows.map(question => {
      const answer =
        byId.get(String(question.id)) || {};

      if (question.question_type === "text") {
        return {
          questionId: question.id,
          answer: cleanString(answer.text, 1200),
          type: "text"
        };
      }

      total++;

      const selected =
        Number(answer.selectedOptionIndex);

      const correct =
        Number.isInteger(selected) &&
        selected === question.correct_option_index;

      if (correct) {
        score++;
      }

      return {
        questionId: question.id,
        selectedOptionIndex:
          Number.isInteger(selected)
            ? selected
            : null,
        correct
      };
    });

    const result = await pool.query(
      `INSERT INTO attempts
         (
           quiz_id,
           user_id,
           score,
           total_scoreable,
           is_practice,
           answers
         )
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       RETURNING
         id,
         score,
         total_scoreable,
         is_practice,
         created_at`,
      [
        req.params.id,
        req.user.id,
        score,
        total,
        isPractice,
        JSON.stringify(answerRecords)
      ]
    );

    res.status(201).json({
      attempt: result.rows[0],
      answers: answerRecords
    });
  } catch (error) {
    next(error);
  }
});

/* =========================================================
   COMMENTS
   ========================================================= */

router.get("/quizzes/:id/comments", async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT
         c.id,
         c.body,
         c.created_at,
         c.author_id,
         u.username AS author_name
       FROM comments c
       JOIN users u ON u.id = c.author_id
       WHERE c.quiz_id = $1
       ORDER BY c.created_at DESC`,
      [req.params.id]
    );

    res.json({
      comments: result.rows
    });
  } catch (error) {
    next(error);
  }
});

router.post("/quizzes/:id/comments", async (req, res, next) => {
  const body = cleanString(req.body.body, 1200);

  if (body.length < 2) {
    return res.status(400).json({
      error: "Feedback kamida 2 belgidan iborat bo'lsin."
    });
  }

  try {
    const quiz = await pool.query(
      `SELECT owner_id
       FROM quizzes
       WHERE id = $1
         AND is_public = TRUE`,
      [req.params.id]
    );

    if (!quiz.rowCount) {
      return res.status(404).json({
        error: "Ochiq test topilmadi."
      });
    }

    if (quiz.rows[0].owner_id === req.user.id) {
      return res.status(403).json({
        error: "O'z testingizga feedback qoldira olmaysiz."
      });
    }

    const attempted = await pool.query(
      `SELECT 1
       FROM attempts
       WHERE quiz_id = $1
         AND user_id = $2
         AND is_practice = FALSE
       LIMIT 1`,
      [
        req.params.id,
        req.user.id
      ]
    );

    if (!attempted.rowCount) {
      return res.status(403).json({
        error: "Feedback uchun avval testni yeching."
      });
    }

    const result = await pool.query(
      `INSERT INTO comments
         (quiz_id, author_id, body)
       VALUES ($1, $2, $3)
       RETURNING
         id,
         quiz_id,
         author_id,
         body,
         created_at`,
      [
        req.params.id,
        req.user.id,
        body
      ]
    );

    res.status(201).json({
      comment: {
        ...result.rows[0],
        author_name: req.user.username
      }
    });
  } catch (error) {
    next(error);
  }
});

/* =========================================================
   LEADERBOARD
   =========================================================
   
   POINTS:
   - Har bir to'g'ri javob = 1 point.
   - Barcha non-practice attempt'lardagi score yig'indisi.

   TESTS ANSWERED:
   - Haqiqatan nechta test attempt qilinganini ko'rsatadi.
   - Har bir yechilgan test alohida hisoblanadi.
   - Bir testni qayta yechsa, yana bitta test sifatida hisoblanadi.
   ========================================================= */

router.get("/leaderboard", async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT
         u.id,
         u.username,
         u.avatar,

         COALESCE(SUM(a.score), 0)::int AS points,

         COUNT(a.id)::int AS tests_answered

       FROM users u

       JOIN attempts a
         ON a.user_id = u.id
        AND a.is_practice = FALSE

       WHERE u.is_banned = FALSE

       GROUP BY
         u.id,
         u.username,
         u.avatar

       ORDER BY
         points DESC,
         tests_answered DESC,
         u.username ASC

       LIMIT 100`
    );

    res.json({
      users: result.rows
    });
  } catch (error) {
    next(error);
  }
});

/* =========================================================
   AI QUESTIONS
   ========================================================= */

router.post("/ai/questions", aiLimiter, async (req, res, next) => {
  const topic = cleanString(
    req.body.topic,
    500
  );

  const count = Math.max(
    2,
    Math.min(
      10,
      Number.parseInt(req.body.count, 10) || 5
    )
  );

  if (topic.length < 2) {
    return res.status(400).json({
      error: "AI uchun mavzuni kiriting."
    });
  }

  try {
    res.json(
      await generateQuestions(topic, count)
    );
  } catch (error) {
    next(error);
  }
});

/* =========================================================
   ADMIN
   ========================================================= */

router.get("/admin/users", requireAdmin, async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT
         u.id,
         u.username,
         u.role,
         u.avatar,
         u.is_banned,
         u.warning_count,
         u.created_at,
         u.last_login_at,

         (
           SELECT COUNT(*)::int
           FROM quizzes q
           WHERE q.owner_id = u.id
         ) AS quiz_count,

         (
           SELECT COUNT(*)::int
           FROM attempts a
           WHERE a.user_id = u.id
             AND a.is_practice = FALSE
         ) AS attempt_count

       FROM users u

       ORDER BY u.created_at DESC`
    );

    res.json({
      users: result.rows
    });
  } catch (error) {
    next(error);
  }
});

export default router;