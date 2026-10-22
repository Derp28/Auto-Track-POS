import { query, pool } from '../server/db.js';
import { hashPassword } from '../server/services/auth.js';

function arg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

const username = (arg('username', process.env.ADMIN_USERNAME || '')).trim().toLowerCase();
const displayName = (arg('display-name', process.env.ADMIN_DISPLAY_NAME || 'Shop Administrator')).trim();
const password = arg('password', process.env.ADMIN_PASSWORD || '');

try {
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    throw new Error('Provide --username (3-32 lowercase letters, numbers, dots, underscores, hyphens).');
  }
  if (password.length < 12) {
    throw new Error('Provide --password (at least 12 characters) or set ADMIN_PASSWORD.');
  }
  const admins = await query("SELECT count(*)::int AS n FROM users WHERE role = 'ADMIN'");
  if (admins.rows[0].n > 0) throw new Error('An administrator already exists. Use the app to manage users.');
  const hash = hashPassword(password, username);
  const { rows } = await query(
    `INSERT INTO users (username, display_name, role, password_hash, must_change_password)
     VALUES ($1, $2, 'ADMIN', $3, TRUE) RETURNING id, username`,
    [username, displayName, hash],
  );
  console.log(`Administrator "${rows[0].username}" created (id ${rows[0].id}). Change the password at first sign-in.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => {});
}
