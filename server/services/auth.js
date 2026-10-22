import crypto from 'node:crypto';
import { config } from '../config.js';
import { query, withTransaction } from '../db.js';
import { ApiError, badRequest, conflict, forbidden, unauthorized } from '../lib/errors.js';
import { hashPayload, logAudit } from '../lib/ledger.js';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
const loginFailures = new Map();

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function validatePassword(password, username = '') {
  if (typeof password !== 'string' || password.length < 12 || password.length > 200) {
    throw badRequest('Password must be 12-200 characters.', 'WEAK_PASSWORD', {
      password: 'Use at least 12 characters.',
    });
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw badRequest('Password must include at least one letter and one number.', 'WEAK_PASSWORD', {
      password: 'Include at least one letter and one number.',
    });
  }
  if (username && password.toLowerCase().includes(username.toLowerCase())) {
    throw badRequest('Password must not contain the username.', 'WEAK_PASSWORD', {
      password: 'Do not reuse the username in the password.',
    });
  }
  return password;
}

export function hashPassword(password, username = '') {
  validatePassword(password, username);
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 96 * 1024 * 1024,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  try {
    const parts = String(stored).split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, n, r, p, saltHex, hashHex] = parts;
    const expected = Buffer.from(hashHex, 'hex');
    const derived = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 96 * 1024 * 1024,
    });
    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

function rateKey(scope, username, ip) {
  return `${scope}:${String(username || '').toLowerCase()}:${ip || 'unknown'}`;
}

function assertNotRateLimited(scope, username, ip) {
  const entry = loginFailures.get(rateKey(scope, username, ip));
  if (!entry) return;
  if (Date.now() - entry.first > LOGIN_WINDOW_MS) {
    loginFailures.delete(rateKey(scope, username, ip));
    return;
  }
  if (entry.count >= LOGIN_MAX_FAILURES) {
    throw new ApiError(429, 'TOO_MANY_ATTEMPTS', 'Too many failed attempts. Wait 15 minutes and try again.');
  }
}

function recordFailure(scope, username, ip) {
  const key = rateKey(scope, username, ip);
  const existing = loginFailures.get(key);
  if (!existing || Date.now() - existing.first > LOGIN_WINDOW_MS) {
    loginFailures.set(key, { count: 1, first: Date.now() });
  } else {
    existing.count += 1;
  }
}

function clearFailures(scope, username, ip) {
  loginFailures.delete(rateKey(scope, username, ip));
}

export function publicUser(row) {
  return {
    id: String(row.id),
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    active: row.active,
    mustChangePassword: row.must_change_password,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function setupStatus() {
  const { rows } = await query('SELECT count(*)::int AS admins FROM users WHERE role = $1 AND active', ['ADMIN']);
  return {
    setupRequired: rows[0].admins === 0,
    setupEnabled: config.allowSetup,
    shopName: (await query('SELECT shop_name FROM settings WHERE id = 1')).rows[0]?.shop_name || 'Auto-Track',
  };
}

export async function setup({ token, username, displayName, password, ip, userAgent }) {
  if (!config.allowSetup) throw forbidden('Initial setup is disabled. Use the bootstrap command.');
  if (!config.bootstrapToken) {
    throw new ApiError(503, 'SETUP_UNAVAILABLE', 'BOOTSTRAP_TOKEN is not configured on the server.');
  }
  if (!safeEqual(token || '', config.bootstrapToken)) {
    throw forbidden('The setup token is not valid.');
  }
  validatePassword(password, username);
  const passwordHash = hashPassword(password, username);
  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(918273645)');
    const { rows } = await client.query('SELECT count(*)::int AS admins FROM users WHERE role = $1 AND active', ['ADMIN']);
    if (rows[0].admins > 0) throw conflict('An administrator already exists. Sign in instead.', 'SETUP_COMPLETE');
    const inserted = await client.query(
      `INSERT INTO users (username, display_name, role, password_hash)
       VALUES ($1, $2, 'ADMIN', $3)
       RETURNING *`,
      [username.trim(), displayName.trim(), passwordHash],
    );
    const user = inserted.rows[0];
    await logAudit(client, {
      actorId: user.id,
      action: 'USER_BOOTSTRAPPED',
      entityType: 'user',
      entityId: user.id,
      details: { username: user.username },
    });
    const session = await createSession(client, user.id, { ip, userAgent });
    return { user: publicUser(user), session };
  });
}

async function createSession(client, userId, { ip, userAgent }) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrfToken = crypto.randomBytes(32).toString('hex');
  const idleExpires = new Date(Date.now() + config.sessionIdleMinutes * 60 * 1000);
  const absoluteExpires = new Date(Date.now() + config.sessionAbsoluteHours * 60 * 60 * 1000);
  await client.query(
    `INSERT INTO sessions (token_hash, csrf_token, user_id, idle_expires_at, absolute_expires_at, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [sha256(token), csrfToken, userId, idleExpires, absoluteExpires, ip || null, String(userAgent || '').slice(0, 300)],
  );
  await client.query(
    'UPDATE sessions SET revoked_at = now(), revoked_reason = $2 WHERE user_id = $1 AND revoked_at IS NULL AND absolute_expires_at < now()',
    [userId, 'expired'],
  );
  return { token, csrfToken, absoluteExpires };
}

export async function login({ username, password, ip, userAgent }) {
  assertNotRateLimited('login', username, ip);
  const result = await query('SELECT * FROM users WHERE lower(username) = lower($1)', [username]);
  const row = result.rows[0];
  const ok = row ? verifyPassword(password, row.password_hash) : false;
  if (!row || !ok || !row.active) {
    recordFailure('login', username, ip);
    await query(
      `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, details)
       VALUES (NULL, 'AUTH_LOGIN_FAILED', 'user', $1, $2::jsonb)`,
      [String(username).slice(0, 80), JSON.stringify({ username: String(username).slice(0, 80), ip: ip || null })],
    ).catch(() => {});
    throw unauthorized('Invalid username or password.');
  }
  clearFailures('login', username, ip);
  const session = await withTransaction(async (client) => {
    await client.query('UPDATE users SET last_login_at = now() WHERE id = $1', [row.id]);
    const created = await createSession(client, row.id, { ip, userAgent });
    await logAudit(client, {
      actorId: row.id,
      action: 'AUTH_LOGIN',
      entityType: 'user',
      entityId: row.id,
      details: { username: row.username, role: row.role },
    });
    return created;
  });
  return { user: publicUser({ ...row, last_login_at: new Date() }), session };
}

export async function logout({ sessionId, userId, ip }) {
  if (!sessionId) return;
  await withTransaction(async (client) => {
    await client.query(
      "UPDATE sessions SET revoked_at = now(), revoked_reason = 'logout' WHERE id = $1 AND revoked_at IS NULL",
      [sessionId],
    );
    await logAudit(client, {
      actorId: userId || null,
      action: 'AUTH_LOGOUT',
      entityType: 'session',
      entityId: sessionId,
      details: { ip: ip || null },
    });
  });
}

export async function changePassword({ user, currentPassword, newPassword, sessionId, ip }) {
  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [user.id]);
  if (!rows[0] || !verifyPassword(currentPassword, rows[0].password_hash)) {
    throw badRequest('The current password is incorrect.', 'CURRENT_PASSWORD_INVALID', {
      currentPassword: 'Incorrect password.',
    });
  }
  const newHash = hashPassword(newPassword, user.username);
  await withTransaction(async (client) => {
    await client.query(
      'UPDATE users SET password_hash = $2, must_change_password = FALSE, updated_at = now() WHERE id = $1',
      [user.id, newHash],
    );
    await client.query(
      `UPDATE sessions SET revoked_at = now(), revoked_reason = 'password_changed'
       WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL`,
      [user.id, sessionId],
    );
    await logAudit(client, {
      actorId: user.id,
      action: 'PASSWORD_CHANGED',
      entityType: 'user',
      entityId: user.id,
      details: { ip: ip || null },
    });
  });
}

export async function verifyAdminCredentials({ username, password, ip }) {
  assertNotRateLimited('override', username, ip);
  const { rows } = await query('SELECT * FROM users WHERE lower(username) = lower($1) AND role = $2 AND active', [
    username,
    'ADMIN',
  ]);
  const row = rows[0];
  if (!row || !verifyPassword(password, row.password_hash)) {
    recordFailure('override', username, ip);
    throw forbidden('Administrator approval failed.');
  }
  clearFailures('override', username, ip);
  return { id: String(row.id), username: row.username, displayName: row.display_name, role: row.role };
}

export async function findSessionByToken(token) {
  if (!token || typeof token !== 'string') return null;
  const { rows } = await query(
    `SELECT s.*, u.username, u.display_name, u.role, u.active, u.must_change_password, u.last_login_at,
            u.created_at AS user_created_at, u.updated_at AS user_updated_at,
            (s.revoked_at IS NOT NULL OR s.absolute_expires_at <= now() OR s.idle_expires_at <= now()) AS expired,
            EXTRACT(EPOCH FROM (now() - s.last_seen_at)) AS idle_seconds
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1`,
    [sha256(token)],
  );
  const row = rows[0];
  if (!row || row.expired || !row.active) return null;
  if (Number(row.idle_seconds) > 60) {
    await query(
      `UPDATE sessions
          SET last_seen_at = now(),
              idle_expires_at = LEAST(absolute_expires_at, now() + ($2 || ' minutes')::interval)
        WHERE id = $1 AND revoked_at IS NULL`,
      [row.id, String(config.sessionIdleMinutes)],
    );
  }
  return {
    session: { id: String(row.id), csrfToken: row.csrf_token },
    user: {
      id: String(row.user_id),
      username: row.username,
      displayName: row.display_name,
      role: row.role,
      active: row.active,
      mustChangePassword: row.must_change_password,
      lastLoginAt: row.last_login_at,
    },
  };
}

export function sessionCookie(token, expires) {
  const parts = [
    `${config.sessionCookieName}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Expires=${expires.toUTCString()}`,
  ];
  if (config.cookieSecure) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie() {
  const parts = [`${config.sessionCookieName}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (config.cookieSecure) parts.push('Secure');
  return parts.join('; ');
}

export function parseCookies(header = '') {
  const result = {};
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) {
      try {
        result[key] = decodeURIComponent(value);
      } catch {
        result[key] = value;
      }
    }
  }
  return result;
}

export { sha256, safeEqual, hashPayload };
