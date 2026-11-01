import mysql from 'mysql2/promise';
import { config, requireDatabaseConfig } from './config.js';

const RETRYABLE = new Set(['40P01', '40001']);

function parseMysqlUrl(connectionString) {
  const url = new URL(connectionString);
  if (!['mysql:', 'mysql2:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL must use mysql:// (this is the local MySQL variant).');
  }
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, '')),
  };
}

function serverOptions(connectionString, { max = config.dbPoolMax, multipleStatements = false } = {}) {
  const target = parseMysqlUrl(connectionString);
  return {
    ...target,
    waitForConnections: true,
    connectionLimit: max,
    queueLimit: 0,
    charset: 'utf8mb4',
    timezone: 'Z',
    dateStrings: ['DATE'],
    decimalNumbers: true,
    supportBigNumbers: true,
    bigNumberStrings: false,
    multipleStatements,
    connectTimeout: 5000,
    // mysql2 returns TINYINT(1) as 1/0. The API contract uses booleans.
    typeCast(field, next) {
      if (field.type === 'TINY' && field.length === 1) return field.string() === '1';
      return next();
    },
  };
}

function mapError(error) {
  if (!error || typeof error !== 'object') return error;
  const errno = Number(error.errno);
  if (errno === 3819) error.code = '23514'; // CHECK constraint violated
  else if (errno === 1451 || errno === 1452) error.code = '23503'; // foreign key
  else if (errno === 1364 || errno === 1048) error.code = '23502'; // not-null
  else if (errno === 1062) error.code = '23505'; // duplicate key
  else if (errno === 1213) error.code = '40P01'; // deadlock
  else if (errno === 1205) error.code = '40001'; // lock wait timeout
  else if (errno === 1142 || errno === 1143 || errno === 1044 || errno === 1045) {
    error.code = '42501';
    error.message = `permission denied: ${error.message}`;
  } else if (errno === 1644) error.code = '23514'; // SIGNAL from an immutability trigger
  else if (errno === 1146) error.code = '42P01';
  else if (errno === 1054) error.code = '42703';
  else if (errno === 1064) error.code = '42601';
  else if (errno === 1265 || errno === 1366) error.code = '22P02';
  else if (errno === 1406) error.code = '22001';
  else if (errno === 1690) error.code = '22003';
  return error;
}

function normalizeValue(value) {
  if (value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'object' && value !== null && !Buffer.isBuffer(value)) {
    // mysql2 accepts JSON strings; the services already stringify JSON columns, but
    // this keeps object parameters safe if a future call forgets.
    return JSON.stringify(value);
  }
  return value;
}

/**
 * Translate the small PostgreSQL surface used by the shared services into MySQL 8.4:
 *   $n placeholders, ANY($n::bigint[]), ::casts, ILIKE, now(), to_char(date),
 *   COUNT(*)::int and RETURNING * on INSERT/UPDATE.
 *
 * This is intentionally narrow. New SQL should be written in MySQL syntax directly;
 * see the notes in PORTING_PLAN.md.
 */
function prepare(sql, params, { returning = null } = {}) {
  let text = String(sql);
  let values = [];

  // Expand ANY(array) first; its cast must be removed by this pass, not the generic one.
  text = text.replace(/ANY\s*\(\s*\$(\d+)\s*::\s*(?:bigint|int|integer|text|uuid)\s*\[\s*\]\s*\)/gi, (_, n) => `__ANY_${n}__`);

  text = text
    .replace(/\bnow\s*\(\s*\)/gi, 'UTC_TIMESTAMP(6)')
    .replace(/to_char\s*\(\s*([^,]+?)\s*,\s*'YYYY-MM-DD'\s*\)/gi, "DATE_FORMAT($1, '%Y-%m-%d')")
    .replace(/\bILIKE\b/gi, 'LIKE')
    .replace(/::\s*(?:int|integer|bigint|smallint|numeric|decimal|text|varchar|date|time|timestamptz|timestamp|boolean|bool|jsonb|json|uuid)(?:\[\])?/gi, '');

  // PostgreSQL uses `column = ANY(array)`; the MySQL form is `column IN (...)`.
  // Drop the equality operator and let the array expansion below add IN (...).
  text = text.replace(/=\s*__ANY_(\d+)__/g, '__ANY_$1__');

  text = text.replace(/\$(\d+)|__ANY_(\d+)__/g, (match, dollar, any) => {
    const index = Number(dollar || any) - 1;
    const value = params[index];
    if (any) {
      if (!Array.isArray(value) || value.length === 0) return 'IN (NULL)';
      values.push(...value.map(normalizeValue));
      return `IN (${value.map(() => '?').join(', ')})`;
    }
    values.push(normalizeValue(value));
    return '?';
  });

  if (returning) {
    // A RETURNING clause was removed by the caller; SELECT it back through the same
    // connection so LAST_INSERT_ID()/the update are visible.
  }
  return { text, values, returning };
}

function returningClause(sql) {
  const match = sql.match(/\s+RETURNING\s+([\s\S]+?)\s*;?\s*$/i);
  if (!match) return { sql, returning: null };
  return { sql: sql.slice(0, match.index), returning: match[1].trim() };
}

function tableForInsert(sql) {
  const match = sql.match(/\bINSERT\s+(?:IGNORE\s+)?INTO\s+`?([a-zA-Z0-9_]+)`?/i);
  return match ? match[1] : null;
}

function tableForUpdate(sql) {
  const match = sql.match(/\bUPDATE\s+`?([a-zA-Z0-9_]+)`?/i);
  return match ? match[1] : null;
}

function idForUpdate(sql, params) {
  const parameter = sql.match(/\bWHERE\s+`?id`?\s*=\s*\$(\d+)/i);
  if (parameter) return params[Number(parameter[1]) - 1];
  const literal = sql.match(/\bWHERE\s+`?id`?\s*=\s*(\d+)/i);
  if (literal) return Number(literal[1]);
  return undefined;
}

async function selectReturning(conn, table, columns, id) {
  if (!table || id === undefined || id === null) return [];
  const safeTable = table.replace(/[^a-zA-Z0-9_]/g, '');
  const safeColumns = columns === '*' ? '*' : columns.replace(/[^a-zA-Z0-9_,.\s*]/g, '');
  const [rows] = await conn.query(`SELECT ${safeColumns} FROM \`${safeTable}\` WHERE id = ?`, [id]);
  return rows;
}

async function runQuery(conn, sql, params = []) {
  const { sql: withoutReturning, returning } = returningClause(String(sql));
  const updateId = idForUpdate(withoutReturning, params);
  const prepared = prepare(withoutReturning, params, { returning });
  try {
    const [result] = await conn.query(prepared.text, prepared.values);
    if (Array.isArray(result)) {
      return { rows: result, rowCount: result.length, insertId: 0, affectedRows: result.length };
    }
    const affectedRows = Number(result.affectedRows || 0);
    let rows = [];
    if (returning) {
      if (returning !== '*') {
        // The only non-* RETURNING in the original code was document_sequences.next_value;
        // that query is rewritten in sales.js. Fail loudly if a new one appears.
        throw new Error(`Unsupported RETURNING expression in MySQL variant: ${returning}`);
      }
      const table = tableForInsert(prepared.text) || tableForUpdate(prepared.text);
      if (tableForInsert(prepared.text)) {
        rows = await selectReturning(conn, table, '*', result.insertId);
      } else {
        rows = await selectReturning(conn, table, '*', updateId);
      }
    }
    return { rows, rowCount: affectedRows, insertId: Number(result.insertId || 0), affectedRows };
  } catch (error) {
    throw mapError(error);
  }
}

function wrapConnection(conn) {
  return {
    query: (sql, params) => runQuery(conn, sql, params),
    beginTransaction: () => conn.beginTransaction(),
    commit: () => conn.commit(),
    rollback: () => conn.rollback(),
    release: () => conn.release(),
    raw: conn,
  };
}

export function createPool(connectionString = requireDatabaseConfig(), { max = config.dbPoolMax } = {}) {
  const raw = mysql.createPool(serverOptions(connectionString, { max }));
  return {
    async query(sql, params = []) {
      const conn = await raw.getConnection();
      try {
        return await runQuery(conn, sql, params);
      } finally {
        conn.release();
      }
    },
    async getConnection() {
      return wrapConnection(await raw.getConnection());
    },
    end: () => raw.end(),
    raw,
  };
}

export const pool = createPool();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run work(client) inside a MySQL transaction. Deadlocks are retried a bounded number
 * of times with jitter; every other error rolls back.
 */
export async function withTransaction(work, { pool: source = pool, retries = 3 } = {}) {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    const client = await source.getConnection();
    try {
      await client.beginTransaction();
      const result = await work(client);
      await client.commit();
      return result;
    } catch (error) {
      try {
        await client.rollback();
      } catch {
        // The connection may already be gone; the original error is more useful.
      }
      if (RETRYABLE.has(error.code) && attempt < retries) {
        await sleep(25 * attempt + Math.floor(Math.random() * 25));
        continue;
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

export async function query(text, params = []) {
  return pool.query(text, params);
}

export { mapError };
