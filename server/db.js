import pg from 'pg';
import { config, requireDatabaseConfig } from './config.js';

const { Pool } = pg;

export function createPool(connectionString = requireDatabaseConfig(), { max = config.dbPoolMax } = {}) {
  const pool = new Pool({
    connectionString,
    max,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    application_name: 'autotrack-pos',
    options: `-c statement_timeout=${config.dbStatementTimeoutMs} -c lock_timeout=5000 -c idle_in_transaction_session_timeout=30000`,
  });
  pool.on('error', (error) => {
    console.error(JSON.stringify({ level: 'error', msg: 'idle PostgreSQL client error', code: error.code }));
  });
  return pool;
}

export const pool = createPool();

const RETRYABLE = new Set(['40001', '40P01']);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run work(client) inside BEGIN/COMMIT. Deadlocks and serialization failures are
 * retried a bounded number of times with jitter; every other error rolls back.
 */
export async function withTransaction(work, { pool: source = pool, retries = 3, isolation = '' } = {}) {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    const client = await source.connect();
    try {
      await client.query(isolation ? `BEGIN ISOLATION LEVEL ${isolation}` : 'BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
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
