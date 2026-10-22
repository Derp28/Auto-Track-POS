import crypto from 'node:crypto';

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

export function hashPayload(payload) {
  return crypto.createHash('sha256').update(stableStringify(payload)).digest('hex');
}

export async function logAudit(client, { actorId = null, action, entityType, entityId = null, details = {}, source = 'api' }) {
  await client.query(
    `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, details, source)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [actorId, action, entityType, entityId === null ? null : String(entityId), JSON.stringify(details), source],
  );
}

/**
 * Atomically reserve an idempotency key. Returns { replay: true, response } when the
 * exact same request already committed, or { replay: false, hash, complete }.
 * A key reused with a different user, endpoint, or payload is rejected.
 */
export async function claimIdempotency(client, { key, userId, endpoint, payload }) {
  if (typeof key !== 'string' || key.trim().length < 8 || key.length > 100) {
    const { badRequest } = await import('./errors.js');
    throw badRequest('clientRequestId must be 8-100 characters.', 'IDEMPOTENCY_KEY_INVALID');
  }
  const hash = hashPayload(payload);
  const inserted = await client.query(
    `INSERT INTO idempotency_keys (client_request_id, user_id, endpoint, payload_hash)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (client_request_id) DO NOTHING
     RETURNING client_request_id`,
    [key, userId, endpoint, hash],
  );
  if (inserted.rowCount === 0) {
    const { rows } = await client.query(
      'SELECT user_id, endpoint, payload_hash, response FROM idempotency_keys WHERE client_request_id = $1',
      [key],
    );
    const row = rows[0];
    if (!row || Number(row.user_id) !== Number(userId) || row.endpoint !== endpoint || row.payload_hash !== hash) {
      const { conflict } = await import('./errors.js');
      throw conflict('This request ID was already used for a different request.', 'IDEMPOTENCY_CONFLICT');
    }
    if (!row.response) {
      const { conflict } = await import('./errors.js');
      throw conflict('This request is already being processed.', 'IDEMPOTENCY_IN_PROGRESS');
    }
    return { replay: true, response: row.response };
  }
  return {
    replay: false,
    hash,
    complete: async (response) => {
      await client.query('UPDATE idempotency_keys SET response = $2::jsonb WHERE client_request_id = $1', [
        key,
        JSON.stringify(response),
      ]);
    },
  };
}
