import "dotenv/config";
import { pool } from "./db.js";

const usernameKey = String(process.argv[2] || "").trim().toLocaleLowerCase();
if (!usernameKey) {
  console.error("Usage: npm run admin:promote -- <username>");
  process.exitCode = 1;
} else {
  try {
    const result = await pool.query(
      "UPDATE users SET role = 'admin' WHERE username_key = $1 RETURNING username",
      [usernameKey]
    );
    if (!result.rowCount) {
      console.error("User not found. Register the account first.");
      process.exitCode = 1;
    } else {
      console.log(`${result.rows[0].username} is now an admin.`);
    }
  } catch (error) {
    console.error("Could not promote user:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}