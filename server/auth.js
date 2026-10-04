import { pool } from "./db.js";

export async function requireUser(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Kirish talab qilinadi." });
  }

  try {
    const result = await pool.query(
      "SELECT id, username, role, avatar, is_banned FROM users WHERE id = $1",
      [req.session.userId]
    );
    const user = result.rows[0];
    if (!user || user.is_banned) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: "Hisob faol emas." });
    }
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Bu amal admin huquqini talab qiladi." });
  }
  next();
}

export function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    avatar: user.avatar,
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at
  };
}