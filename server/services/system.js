import fs from 'node:fs';
import { query } from '../db.js';
import { config, projectRoot } from '../config.js';

export async function systemStatus() {
  const [db, counts, migrations, settings, businessDate] = await Promise.all([
    query(`SELECT version() AS version, current_database() AS database,
                  (SELECT setting FROM pg_settings WHERE name = 'server_version') AS server_version,
                  pg_postmaster_start_time() AS started_at`),
    query(`SELECT
      (SELECT count(*)::int FROM products) AS products,
      (SELECT count(*)::int FROM sales) AS sales,
      (SELECT count(*)::int FROM suppliers) AS suppliers,
      (SELECT count(*)::int FROM purchase_orders) AS purchase_orders,
      (SELECT count(*)::int FROM users WHERE active) AS active_users,
      (SELECT count(*)::int FROM stock_movements) AS stock_movements,
      (SELECT count(*)::int FROM audit_log) AS audit_records,
      (SELECT count(*)::int FROM sessions WHERE revoked_at IS NULL AND idle_expires_at > now()) AS active_sessions`),
    query('SELECT version, applied_at FROM schema_migrations ORDER BY version'),
    query('SELECT shop_name, timezone, currency, business_day_cutoff FROM settings WHERE id = 1'),
    query("SELECT to_char(current_business_date(), 'YYYY-MM-DD') AS d"),
  ]);
  const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  return {
    app: {
      name: 'Auto-Track POS',
      version: pkg.version,
      environment: config.env,
      node: process.version,
      uptimeSeconds: Math.round(process.uptime()),
      startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      host: config.host,
      port: config.port,
      tls: Boolean(config.tlsCertFile && config.tlsKeyFile),
    },
    database: {
      version: db.rows[0].server_version,
      postgres: db.rows[0].version.split(',')[0],
      name: db.rows[0].database,
      startedAt: new Date(db.rows[0].started_at).toISOString(),
      migrations: migrations.rows.map((row) => ({ version: row.version, appliedAt: new Date(row.applied_at).toISOString() })),
    },
    counts: counts.rows[0],
    shop: {
      name: settings.rows[0].shop_name,
      timezone: settings.rows[0].timezone,
      currency: settings.rows[0].currency.trim(),
      businessDayCutoff: String(settings.rows[0].business_day_cutoff).slice(0, 5),
      businessDate: businessDate.rows[0].d,
    },
    serverTime: new Date().toISOString(),
    projectRoot,
  };
}
