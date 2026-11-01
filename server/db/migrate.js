import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { projectRoot, config } from '../config.js';

const MIGRATIONS_DIR = path.join(projectRoot, 'migrations-mysql');
const LOCK_NAME = 'autotrack_migrate';

function connectionOptions(connectionString) {
  const url = new URL(connectionString);
  if (!['mysql:', 'mysql2:'].includes(url.protocol)) {
    throw new Error('Migration URL must use mysql://.');
  }
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, '')),
    charset: 'utf8mb4',
    timezone: 'Z',
    multipleStatements: false,
  };
}

/**
 * Split a migration file into statements. MySQL's DELIMITER is a client feature, so
 * the runner honors DELIMITER lines and sends compound trigger/function bodies as one
 * statement. This keeps 002_immutability.sql readable without a CLI dependency.
 */
function stripLineComment(line) {
  let single = false;
  let double = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "'" && !double && line[index - 1] !== '\\') single = !single;
    else if (char === '"' && !single && line[index - 1] !== '\\') double = !double;
    else if (char === '-' && line[index + 1] === '-' && !single && !double) return line.slice(0, index);
  }
  return line;
}

export function splitStatements(sql) {
  // Semicolons inside -- comments must not split a statement. Strip line comments
  // before looking for delimiters; the SQL that reaches MySQL is otherwise unchanged.
  const lines = String(sql).split(/\r?\n/).map(stripLineComment);
  let delimiter = ';';
  let buffer = '';
  const statements = [];
  const flush = () => {
    const statement = buffer.trim();
    buffer = '';
    if (!statement) return;
    const withoutComments = statement
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .trim();
    if (withoutComments) statements.push(statement);
  };
  for (const line of lines) {
    const delimiterMatch = line.match(/^\s*DELIMITER\s+(\S+)\s*$/i);
    if (delimiterMatch) {
      flush();
      delimiter = delimiterMatch[1];
      continue;
    }
    buffer += `${line}\n`;
    while (buffer.includes(delimiter)) {
      const index = buffer.indexOf(delimiter);
      const statement = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + delimiter.length);
      if (statement) statements.push(statement);
    }
  }
  flush();
  return statements;
}

export async function runMigrations({ connectionString, log = console.log } = {}) {
  const url = connectionString || config.migrationDatabaseUrl || config.databaseUrl;
  if (!url) throw new Error('Set MIGRATION_DATABASE_URL (owner role) before migrating.');
  const connection = await mysql.createConnection(connectionOptions(url));
  try {
    const [[lock]] = await connection.query('SELECT GET_LOCK(?, 60) AS locked', [LOCK_NAME]);
    if (!lock || Number(lock.locked) !== 1) throw new Error('Could not acquire the migration lock.');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        applied_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6))
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
    const [appliedRows] = await connection.query('SELECT version FROM schema_migrations');
    const applied = new Set(appliedRows.map((row) => row.version));
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
      try {
        for (const statement of splitStatements(sql)) {
          await connection.query(statement);
        }
        await connection.query('INSERT INTO schema_migrations (version) VALUES (?)', [version]);
        count += 1;
      } catch (error) {
        throw new Error(`Migration ${version} failed: ${error.message}`);
      }
    }
    log(`Migrations complete. ${count} applied; ${files.length} total.`);
    return { applied: count, total: files.length };
  } finally {
    await connection.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]).catch(() => {});
    await connection.end().catch(() => {});
  }
}

export async function migrationStatus({ connectionString } = {}) {
  const url = connectionString || config.migrationDatabaseUrl || config.databaseUrl;
  const connection = await mysql.createConnection(connectionOptions(url));
  try {
    const [tables] = await connection.query("SHOW TABLES LIKE 'schema_migrations'");
    const applied = tables.length
      ? new Set((await connection.query('SELECT version FROM schema_migrations'))[0].map((row) => row.version))
      : new Set();
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.sql')).sort();
    return files.map((file) => {
      const version = file.replace(/\.sql$/, '');
      return { version, applied: applied.has(version) };
    });
  } finally {
    await connection.end().catch(() => {});
  }
}
