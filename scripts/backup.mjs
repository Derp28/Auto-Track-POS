import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { projectRoot } from '../server/config.js';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function fail(message) {
  console.error(`backup: ${message}`);
  process.exit(1);
}

function tool(name) {
  const bin = process.env.PG_BIN;
  if (bin) {
    for (const candidate of [path.join(bin, name), path.join(bin, `${name}.exe`)]) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return name;
}

function databaseName(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, '')) || 'database';
  } catch {
    return 'database';
  }
}

const sourceUrl = arg('database-url') || process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!sourceUrl) fail('MIGRATION_DATABASE_URL or DATABASE_URL is required.');
if (/CHANGE_ME/i.test(sourceUrl)) fail('The database URL still contains a placeholder password.');

const backupDir = path.resolve(arg('dir') || path.join(projectRoot, 'backups'));
fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
const dbName = databaseName(sourceUrl).replace(/[^A-Za-z0-9_.-]/g, '_');
const output = path.resolve(arg('output') || path.join(backupDir, `autotrack-${dbName}-${stamp}.dump`));
fs.mkdirSync(path.dirname(output), { recursive: true });

const dump = spawnSync(
  tool('pg_dump'),
  [
    '--format=custom',
    '--compress=9',
    '--no-owner',
    '--no-privileges',
    '--file', output,
    sourceUrl,
  ],
  { encoding: 'utf8', windowsHide: true },
);
if (dump.error) fail(`could not start pg_dump: ${dump.error.message}. Set PG_BIN to the PostgreSQL bin directory.`);
if (dump.status !== 0) {
  fs.rmSync(output, { force: true });
  fail(`pg_dump failed: ${(dump.stderr || dump.stdout || '').trim() || `exit ${dump.status}`}`);
}

const bytes = fs.statSync(output).size;
if (!bytes) fail('pg_dump produced an empty file.');
const hash = crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex');
fs.writeFileSync(`${output}.sha256`, `${hash}  ${path.basename(output)}\n`);

const client = new pg.Client({ connectionString: sourceUrl, application_name: 'autotrack-backup' });
let manifest = {};
try {
  await client.connect();
  const db = await client.query('SELECT current_database() AS name');
  const migrations = await client.query('SELECT version FROM schema_migrations ORDER BY version');
  const settings = await client.query('SELECT shop_name FROM settings WHERE id = 1');
  manifest = {
    createdAt: new Date().toISOString(),
    database: db.rows[0].name,
    shopName: settings.rows[0]?.shop_name || null,
    migrations: migrations.rows.map((row) => row.version),
    bytes,
    sha256: hash,
    file: path.basename(output),
    format: 'pg_dump custom',
  };
  fs.writeFileSync(`${output}.json`, `${JSON.stringify(manifest, null, 2)}\n`);
} finally {
  await client.end().catch(() => {});
}

console.log(JSON.stringify({
  ok: true,
  file: output,
  bytes,
  sha256: hash,
  manifest: `${output}.json`,
}, null, 2));
