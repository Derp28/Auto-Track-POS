import crypto from 'node:crypto';
import { query, withTransaction } from '../db.js';
import { userDto } from '../lib/dto.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { logAudit } from '../lib/ledger.js';
import { oneOf, text, asObject, boolean } from '../lib/validation.js';
import { hashPassword } from './auth.js';

const USERNAME = /^[a-z0-9._-]{3,32}$/;

function normalize(input) {
  const username = text(input.username, 'username', { min: 3, max: 32 }).toLowerCase();
  if (!USERNAME.test(username)) {
    throw badRequest(
      'Username must be 3-32 lowercase letters, numbers, dots, underscores, or hyphens.',
      'VALIDATION_ERROR',
      { username: 'Use 3-32 lowercase letters, numbers, dots, underscores, or hyphens.' },
    );
  }
  return {
    username,
    displayName: text(input.displayName, 'displayName', { max: 80 }),
    role: oneOf(input.role, 'role', ['ADMIN', 'CASHIER']),
  };
}

function temporaryPassword() {
  return `At7-${crypto.randomBytes(9).toString('base64url')}`;
}

export async function listUsers({ includeInactive = true } = {}) {
  const { rows } = await query(
    'SELECT * FROM users WHERE ($1::boolean OR active) ORDER BY lower(display_name)',
    [includeInactive],
  );
  return rows.map(userDto);
}

export async function getUser(userId) {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [userId]);
  if (!rows[0]) throw notFound('User not found.');
  return userDto(rows[0]);
}

export async function createUser(body, actor) {
  const input = asObject(body);
  const data = normalize(input);
  const active = boolean(input.active, 'active', { optional: true, fallback: true });
  const password = temporaryPassword();
  const passwordHash = hashPassword(password, data.username);
  return withTransaction(async (client) => {
    const duplicate = await client.query('SELECT 1 FROM users WHERE lower(username) = lower($1)', [data.username]);
    if (duplicate.rowCount) throw conflict('That username is already used.', 'DUPLICATE_USERNAME');
    const { rows } = await client.query(
      `INSERT INTO users (username, display_name, role, active, password_hash, must_change_password)
       VALUES ($1, $2, $3, $4, $5, TRUE) RETURNING *`,
      [data.username, data.displayName, data.role, active, passwordHash],
    );
    await logAudit(client, {
      actorId: actor.id,
      action: 'USER_CREATED',
      entityType: 'user',
      entityId: rows[0].id,
      details: { username: data.username, role: data.role },
    });
    return { user: userDto(rows[0]), temporaryPassword: password };
  });
}

async function activeAdminCount(client, excludeId = null) {
  const { rows } = await client.query(
    `SELECT count(*)::int AS n FROM users
      WHERE role = 'ADMIN' AND active AND ($1::bigint IS NULL OR id <> $1)`,
    [excludeId],
  );
  return rows[0].n;
}

export async function updateUser(userId, body, actor) {
  const input = asObject(body);
  const data = normalize(input);
  const active = boolean(input.active, 'active');
  return withTransaction(async (client) => {
    const current = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (!current.rows[0]) throw notFound('User not found.');
    if (current.rows[0].role === 'ADMIN' && (data.role !== 'ADMIN' || !active)) {
      if ((await activeAdminCount(client, userId)) === 0) {
        throw conflict('The shop must keep at least one active administrator.', 'LAST_ADMIN');
      }
    }
    const duplicate = await client.query('SELECT 1 FROM users WHERE lower(username) = lower($1) AND id <> $2', [
      data.username,
      userId,
    ]);
    if (duplicate.rowCount) throw conflict('That username is already used.', 'DUPLICATE_USERNAME');
    const { rows } = await client.query(
      `UPDATE users SET username = $2, display_name = $3, role = $4, active = $5,
         deactivated_at = CASE WHEN $5 THEN NULL ELSE COALESCE(deactivated_at, now()) END,
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [userId, data.username, data.displayName, data.role, active],
    );
    const revokeSessions = !active || data.role !== current.rows[0].role;
    if (revokeSessions) {
      await client.query(
        `UPDATE sessions SET revoked_at = now(), revoked_reason = $2
          WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId, !active ? 'deactivated' : 'role_changed'],
      );
    }
    await logAudit(client, {
      actorId: actor.id,
      action: 'USER_UPDATED',
      entityType: 'user',
      entityId: userId,
      details: {
        username: data.username,
        roleFrom: current.rows[0].role,
        roleTo: data.role,
        activeFrom: current.rows[0].active,
        activeTo: active,
      },
    });
    return userDto(rows[0]);
  });
}

export async function resetUserPassword(userId, actor) {
  const password = temporaryPassword();
  return withTransaction(async (client) => {
    const current = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (!current.rows[0]) throw notFound('User not found.');
    const passwordHash = hashPassword(password, current.rows[0].username);
    const updated = await client.query(
      'UPDATE users SET password_hash = $2, must_change_password = TRUE, updated_at = now() WHERE id = $1 RETURNING *',
      [userId, passwordHash],
    );
    await client.query(
      `UPDATE sessions SET revoked_at = now(), revoked_reason = 'password_reset'
        WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
    await logAudit(client, {
      actorId: actor.id,
      action: 'USER_PASSWORD_RESET',
      entityType: 'user',
      entityId: userId,
      details: { username: current.rows[0].username },
    });
    return { user: userDto(updated.rows[0]), temporaryPassword: password };
  });
}
