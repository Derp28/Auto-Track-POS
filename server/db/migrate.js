import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { projectRoot, config } from '../config.js';

const { Pool } = pg;

const MIGRATIONS_DIR = path.join(projectRoot, 'migrations');

export async function runMigrations({ connectionString, log = console.log } = {}) {
  const url = connectionString || config.migrationDatabaseUrl || config.databaseUrl;
  if (!url) throw new Error('Set MIGRATION_DATABASE_URL (owner role) before migrating.');
  const pool = new Pool({
    connectionString: url,
    max: 1,
    application_name: 'autotrack-migrator',
    options: '-c statement_timeout=60000 -c lock_timeout=15000',
  });
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(728912345)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    const applied = new Set(
      (await client.query('SELECT version FROM schema_migrations')).rows.map((row) => row.version),
    );
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.sql')).sort();
    let count = 0;
    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      if (applied.has(version)) {
        log(`= ${version} (already applied)`);
        continue;
      }
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      log(`> applying ${version}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
        await client.query('COMMIT');
        count += 1;
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${version} failed: ${error.message}`);
      }
    }
    log(`Migrations complete. ${count} applied; ${files.length} total.`);
    return { applied: count, total: files.length };
  } finally {
    await client.query('SELECT pg_advisory_unlock(728912345)').catch(() => {});
    client.release();
    await pool.end();
  }
}

export async function migrationStatus({ connectionString } = {}) {
  const url = connectionString || config.migrationDatabaseUrl || config.databaseUrl;
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const table = await pool.query("SELECT to_regclass('public.schema_migrations') AS name");
    const applied = table.rows[0].name
      ? new Set((await pool.query('SELECT version FROM schema_migrations')).rows.map((row) => row.version))
      : new Set();
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.sql')).sort();
    return files.map((file) => {
      const version = file.replace(/\.sql$/, '');
      return { version, applied: applied.has(version) };
    });
  } finally {
    await pool.end();
  }
}
