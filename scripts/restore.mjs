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

function flag(name) {
  return process.argv.includes(`--${name}`);
}

function fail(message) {
  console.error(`restore: ${message}`);
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
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '')) || '',
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

const file = path.resolve(arg('file') || '');
const target = arg('target') || process.env.MIGRATION_DATABASE_URL || '';
const appUrl = arg('app-url') || process.env.DATABASE_URL || '';
if (!arg('file')) fail('--file <backup.dump> is required.');
if (!fs.existsSync(file)) fail(`backup file not found: ${file}`);
const checksumFile = `${file}.sha256`;
if (fs.existsSync(checksumFile)) {
  const expected = fs.readFileSync(checksumFile, 'utf8').trim().split(/\s+/)[0].toLowerCase();
  const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (!/^[a-f0-9]{64}$/.test(expected) || expected !== actual) {
    fail(`backup checksum mismatch: expected ${expected}, got ${actual}`);
  }
}
if (!target) fail('--target <database-url> is required.');
if (/CHANGE_ME/i.test(target)) fail('The target database URL still contains a placeholder password.');

const targetConfig = parseUrl(target);
const targetName = targetConfig.database;
if (['autotrack_dev', 'autotrack_prod', 'autotrack_production'].includes(targetName) && !flag('force')) {
  fail(`refusing to overwrite ${targetName} without --force`);
}
if (flag('force') && process.env.CONFIRM_RESTORE !== 'yes') {
  fail('--force also requires CONFIRM_RESTORE=yes in the environment.');
}

try {
  const check = await mysql.createConnection({
    host: targetConfig.host,
    port: targetConfig.port,
    user: targetConfig.user,
    password: targetConfig.password,
    database: targetConfig.database,
    timezone: 'Z',
  });
  await check.query('SELECT 1');
  await check.end();
} catch (error) {
  fail(`cannot connect to the target database: ${error.message}`);
}

const restore = spawnSync(
  tool('mysql'),
  [
    `--host=${targetConfig.host}`,
    `--port=${targetConfig.port}`,
    `--user=${targetConfig.user}`,
    '--protocol=TCP',
    '--default-character-set=utf8mb4',
    targetConfig.database,
  ],
  {
    input: fs.readFileSync(file),
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, MYSQL_PWD: targetConfig.password },
  },
);
if (restore.error) fail(`could not start mysql: ${restore.error.message}. Set MYSQL_BIN to the MySQL bin directory.`);
if (restore.status !== 0) {
  fail(`mysql restore failed: ${(restore.stderr || restore.stdout || '').trim() || `exit ${restore.status}`}`);
}

// A mysqldump does not include table-level grants. Re-apply the same least-privilege
// matrix used by the migrations so the runtime role cannot modify append-only tables.
if (appUrl) {
  const appConfig = parseUrl(appUrl);
  if (appConfig.user === 'autotrack_app') {
    const grantsFile = path.join(projectRoot, 'migrations-mysql', '003_least_privilege.sql');
    if (fs.existsSync(grantsFile)) {
      const grants = await mysql.createConnection({
        host: targetConfig.host,
        port: targetConfig.port,
        user: targetConfig.user,
        password: targetConfig.password,
        database: targetConfig.database,
        timezone: 'Z',
        multipleStatements: true,
      });
      try {
        await grants.query(fs.readFileSync(grantsFile, 'utf8'));
      } finally {
        await grants.end().catch(() => {});
      }
    }
  }
}

let summary = {};
const client = await mysql.createConnection({
  host: targetConfig.host,
  port: targetConfig.port,
  user: targetConfig.user,
  password: targetConfig.password,
  database: targetConfig.database,
  timezone: 'Z',
  decimalNumbers: true,
});
try {
  const [tables] = await client.query(
    "SELECT count(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'",
  );
  const [settings] = await client.query('SELECT shop_name, currency FROM settings WHERE id = 1');
  const [migrations] = await client.query('SELECT count(*) AS n, max(version) AS latest FROM schema_migrations');
  const [sales] = await client.query(
    "SELECT count(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'sales'",
  );
  if (!settings[0]) fail('restored database has no settings row');
  summary = {
    ok: true,
    database: targetConfig.database,
    tables: Number(tables[0].n),
    shopName: settings[0].shop_name,
    currency: String(settings[0].currency).trim(),
    migrations: Number(migrations[0].n),
    latestMigration: migrations[0].latest,
    salesTable: Number(sales[0].n) > 0,
  };
} finally {
  await client.end().catch(() => {});
}

if (appUrl) {
  const appConfig = parseUrl(appUrl);
  let app;
  try {
    app = await mysql.createConnection({
      host: appConfig.host,
      port: appConfig.port,
      user: appConfig.user,
      password: appConfig.password,
      database: appConfig.database,
      timezone: 'Z',
    });
    const [readable] = await app.query('SELECT count(*) AS n FROM settings');
    summary.appRoleReadable = Number(readable[0].n) === 1;
    summary.appRoleCannotDeleteAudit = await app.query('DELETE FROM audit_log WHERE 1 = 0')
      .then(() => false)
      .catch(() => true);
  } catch (error) {
    fail(`the application role cannot read the restored database: ${error.message}`);
  } finally {
    await app?.end().catch(() => {});
  }
}

console.log(JSON.stringify(summary, null, 2));
