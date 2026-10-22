import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(path.join(projectRoot, '.env'));

function int(name, fallback, { min = -Infinity, max = Infinity } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function bool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return /^(1|true|yes|on)$/i.test(raw);
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: int('PORT', 3100, { min: 1, max: 65535 }),
  host: process.env.HOST || '127.0.0.1',
  databaseUrl: process.env.DATABASE_URL || '',
  migrationDatabaseUrl: process.env.MIGRATION_DATABASE_URL || '',
  testDatabaseUrl: process.env.TEST_DATABASE_URL || '',
  testMigrationDatabaseUrl: process.env.TEST_MIGRATION_DATABASE_URL || '',
  dbPoolMax: int('DB_POOL_MAX', 10, { min: 1, max: 50 }),
  dbStatementTimeoutMs: int('DB_STATEMENT_TIMEOUT_MS', 20000, { min: 1000, max: 300000 }),
  sessionCookieName: process.env.SESSION_COOKIE_NAME || 'at_session',
  cookieSecure: bool('COOKIE_SECURE', false),
  sessionIdleMinutes: int('SESSION_IDLE_MINUTES', 30, { min: 5, max: 1440 }),
  sessionAbsoluteHours: int('SESSION_ABSOLUTE_HOURS', 12, { min: 1, max: 168 }),
  trustProxy: bool('TRUST_PROXY', false),
  bootstrapToken: process.env.BOOTSTRAP_TOKEN || '',
  tlsCertFile: process.env.TLS_CERT_FILE || '',
  tlsKeyFile: process.env.TLS_KEY_FILE || '',
  logRequests: bool('LOG_REQUESTS', true),
  allowSetup: bool('ALLOW_SETUP', true),
  allowInsecureLan: bool('ALLOW_INSECURE_LAN', false),
};

export function requireDatabaseConfig({ migration = false } = {}) {
  const url = migration
    ? config.migrationDatabaseUrl || config.databaseUrl
    : config.databaseUrl;
  if (!url) {
    throw new Error(
      migration
        ? 'MIGRATION_DATABASE_URL (or DATABASE_URL) is required to run migrations.'
        : 'DATABASE_URL is required. Copy .env.example to .env and configure PostgreSQL.',
    );
  }
  if (/CHANGE_ME|password@/i.test(url)) {
    throw new Error('The database URL still contains a placeholder password.');
  }
  return url;
}
