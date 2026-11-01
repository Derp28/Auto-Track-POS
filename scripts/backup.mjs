import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import mysql from 'mysql2/promise';
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

function parseUrl(url) {
  const parsed = new URL(url);
  if (!['mysql:', 'mysql2:'].includes(parsed.protocol)) {
    fail('The database URL must use mysql:// (this is the local MySQL variant).');
  }
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '')) || 'database',
  };
}

function tool(name) {
  const bin = process.env.MYSQL_BIN
    || path.join(projectRoot, '.runtime', 'mysql-8.4.13-winx64', 'bin');
  for (const candidate of [path.join(bin, name), path.join(bin, `${name}.exe`)]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return name;
}

const sourceUrl = arg('database-url') || process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!sourceUrl) fail('MIGRATION_DATABASE_URL or DATABASE_URL is required.');
if (/CHANGE_ME/i.test(sourceUrl)) fail('The database URL still contains a placeholder password.');

const source = parseUrl(sourceUrl);
const backupDir = path.resolve(arg('dir') || path.join(projectRoot, 'backups'));
fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
const dbName = source.database.replace(/[^A-Za-z0-9_.-]/g, '_');
const output = path.resolve(arg('output') || path.join(backupDir, `autotrack-${dbName}-${stamp}.dump`));
fs.mkdirSync(path.dirname(output), { recursive: true });

const dump = spawnSync(
  tool('mysqldump'),
  [
    `--host=${source.host}`,
    `--port=${source.port}`,
    `--user=${source.user}`,
    '--protocol=TCP',
    '--single-transaction',
    '--quick',
    '--routines',
    '--triggers',
    '--events',
    '--no-tablespaces',
    '--no-data=0',
    '--set-gtid-purged=OFF',
    '--default-character-set=utf8mb4',
    `--result-file=${output}`,
    source.database,
  ],
  {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, MYSQL_PWD: source.password },
  },
);
if (dump.error) fail(`could not start mysqldump: ${dump.error.message}. Set MYSQL_BIN to the MySQL bin directory.`);
if (dump.status !== 0) {
  fs.rmSync(output, { force: true });
  fail(`mysqldump failed: ${(dump.stderr || dump.stdout || '').trim() || `exit ${dump.status}`}`);
}

const bytes = fs.statSync(output).size;
if (!bytes) fail('mysqldump produced an empty file.');
const hash = crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex');
fs.writeFileSync(`${output}.sha256`, `${hash}  ${path.basename(output)}\n`);

let manifest = {};
const client = await mysql.createConnection({
  host: source.host,
  port: source.port,
  user: source.user,
  password: source.password,
  database: source.database,
  timezone: 'Z',
});
try {
  const [dbRows] = await client.query('SELECT DATABASE() AS name');
  const [migrations] = await client.query('SELECT version FROM schema_migrations ORDER BY version');
  const [settings] = await client.query('SELECT shop_name FROM settings WHERE id = 1');
  manifest = {
    createdAt: new Date().toISOString(),
    database: dbRows[0]?.name || source.database,
    shopName: settings[0]?.shop_name || null,
    migrations: migrations.map((row) => row.version),
    bytes,
    sha256: hash,
    file: path.basename(output),
    format: 'mysqldump SQL',
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
