import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import '../server/config.js';

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
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, '')) || '';
  } catch {
    return '';
  }
}

const file = path.resolve(arg('file') || '');
const target = arg('target') || process.env.MIGRATION_DATABASE_URL || '';
const appUrl = arg('app-url') || process.env.DATABASE_URL || '';
if (!arg('file')) fail('--file <backup.dump> is required.');
if (!fs.existsSync(file)) fail(`backup file not found: ${file}`);
if (!target) fail('--target <database-url> is required.');
if (/CHANGE_ME/i.test(target)) fail('The target database URL still contains a placeholder password.');

const targetName = databaseName(target);
if (['autotrack_dev', 'autotrack_prod', 'autotrack_production'].includes(targetName) && !flag('force')) {
  fail(`refusing to overwrite ${targetName} without --force`);
}
if (flag('force') && process.env.CONFIRM_RESTORE !== 'yes') {
  fail('--force also requires CONFIRM_RESTORE=yes in the environment.');
}

const check = new pg.Client({ connectionString: target, application_name: 'autotrack-restore-check' });
try {
  await check.connect();
} catch (error) {
  fail(`cannot connect to the target database: ${error.message}`);
} finally {
  await check.end().catch(() => {});
}

const restore = spawnSync(
  tool('pg_restore'),
  [
    '--clean',
    '--if-exists',
    '--no-owner',
    '--no-privileges',
    '--exit-on-error',
    '--dbname', target,
    file,
  ],
  { encoding: 'utf8', windowsHide: true },
);
if (restore.error) fail(`could not start pg_restore: ${restore.error.message}. Set PG_BIN to the PostgreSQL bin directory.`);
if (restore.status !== 0) fail(`pg_restore failed: ${(restore.stderr || restore.stdout || '').trim() || `exit ${restore.status}`}`);

const runtimeGrants = `
  DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autotrack_app') THEN
      EXECUTE 'REVOKE DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM autotrack_app';
      EXECUTE 'GRANT DELETE ON purchase_order_items TO autotrack_app';
      EXECUTE 'REVOKE UPDATE ON audit_log, stock_movements, sale_items, sale_payments,
        sale_returns, sale_return_items, sale_voids, refunds, po_receipts, po_receipt_items
        FROM autotrack_app';
      EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON schema_migrations FROM autotrack_app';
      EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO autotrack_app';
    END IF;
  END
  $$;
`;

const client = new pg.Client({ connectionString: target, application_name: 'autotrack-restore' });
let summary = {};
try {
  await client.connect();
  await client.query(runtimeGrants);
  const tables = await client.query(
    "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
  );
  const settings = await client.query('SELECT shop_name, currency FROM settings WHERE id = 1');
  const migrations = await client.query('SELECT count(*)::int AS n, max(version) AS latest FROM schema_migrations');
  const sales = await client.query("SELECT to_regclass('public.sales') IS NOT NULL AS present");
  if (!settings.rows[0]) fail('restored database has no settings row');
  summary = {
    ok: true,
    database: databaseName(target),
    tables: tables.rows[0].n,
    shopName: settings.rows[0].shop_name,
    currency: settings.rows[0].currency.trim(),
    migrations: migrations.rows[0].n,
    latestMigration: migrations.rows[0].latest,
    salesTable: sales.rows[0].present,
  };
} finally {
  await client.end().catch(() => {});
}

if (appUrl) {
  const app = new pg.Client({ connectionString: appUrl, application_name: 'autotrack-restore-verify' });
  try {
    await app.connect();
    const readable = await app.query('SELECT count(*)::int AS n FROM settings');
    summary.appRoleReadable = readable.rows[0].n === 1;
    const denied = await app.query('DELETE FROM audit_log WHERE false').then(() => false).catch(() => true);
    summary.appRoleCannotDeleteAudit = denied;
  } catch (error) {
    fail(`the application role cannot read the restored database: ${error.message}`);
  } finally {
    await app.end().catch(() => {});
  }
}

console.log(JSON.stringify(summary, null, 2));
