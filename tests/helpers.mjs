import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import pg from 'pg';

// Load .env before the server config module is imported.
const envPath = path.resolve('.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
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

export const TEST_BOOTSTRAP_TOKEN = 'test-bootstrap-token-0123456789abcdef';
process.env.NODE_ENV = 'test';
process.env.TEST_DATABASE_URL ||= process.env.DATABASE_URL;
process.env.TEST_MIGRATION_DATABASE_URL ||= process.env.MIGRATION_DATABASE_URL;
if (!process.env.TEST_DATABASE_URL || !process.env.TEST_MIGRATION_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL and TEST_MIGRATION_DATABASE_URL are required for tests.');
}
if (!/autotrack_test/.test(process.env.TEST_DATABASE_URL)) {
  throw new Error('Refusing to run tests unless TEST_DATABASE_URL points at an autotrack_test database.');
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.MIGRATION_DATABASE_URL = process.env.TEST_MIGRATION_DATABASE_URL;
process.env.BOOTSTRAP_TOKEN = TEST_BOOTSTRAP_TOKEN;
process.env.ALLOW_SETUP = 'true';
process.env.LOG_REQUESTS = 'false';
process.env.SESSION_COOKIE_NAME = 'at_test_session';
process.env.COOKIE_SECURE = 'false';

const { runMigrations } = await import('../server/db/migrate.js');
const { createApp } = await import('../server/app.js');
const { pool } = await import('../server/db.js');

const { Pool } = pg;

const RESET_SQL = `
TRUNCATE TABLE idempotency_keys, audit_log, stock_movements, refunds, sale_voids,
  sale_return_items, sale_returns, sale_payments, sale_items, sales,
  po_receipt_items, po_receipts, purchase_order_items, purchase_orders,
  products, suppliers, categories, sessions, users, document_sequences, settings
  RESTART IDENTITY CASCADE;
INSERT INTO settings (id, shop_name, currency, timezone, receipt_header, receipt_footer, returns_policy)
VALUES (1, 'Auto-Track', 'PHP', 'Asia/Manila', 'Auto-Track Auto Supply & Service', 'Thank you.', 'Returns with receipt.');
`;

export async function startTestServer() {
  await runMigrations({ connectionString: process.env.TEST_MIGRATION_DATABASE_URL, log: () => {} });
  const owner = new Pool({ connectionString: process.env.TEST_MIGRATION_DATABASE_URL, max: 2 });
  await owner.query(RESET_SQL);
  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  return {
    base,
    owner,
    async reset() {
      await owner.query(RESET_SQL);
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await pool.end().catch(() => {});
      await owner.end().catch(() => {});
    },
  };
}

export async function api(base, method, route, { body, session, headers = {} } = {}) {
  const requestHeaders = { ...headers };
  if (body !== undefined) requestHeaders['content-type'] = 'application/json';
  if (session?.cookie) requestHeaders.cookie = session.cookie;
  if (session?.csrf && !['GET', 'HEAD'].includes(method.toUpperCase())) {
    requestHeaders['x-csrf-token'] = session.csrf;
  }
  const response = await fetch(`${base}${route}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await response.text();
  let parsed = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw;
    }
  }
  const setCookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  const cookie = setCookies
    .map((value) => value.split(';')[0])
    .filter((value) => value && !value.endsWith('='))
    .join('; ');
  return { status: response.status, body: parsed, headers: response.headers, cookie, setCookies };
}

export function assertStatus(response, status, message = '') {
  assert.equal(
    response.status,
    status,
    `${message} expected ${status}, got ${response.status}: ${JSON.stringify(response.body)}`,
  );
}

export async function setupAdmin(base, {
  username = 'owner',
  displayName = 'Owner Admin',
  password = 'CorrectHorse9Battery',
} = {}) {
  const response = await api(base, 'POST', '/api/auth/setup', {
    body: { token: TEST_BOOTSTRAP_TOKEN, username, displayName, password },
  });
  assertStatus(response, 201, 'setup');
  return { cookie: response.cookie, csrf: response.body.csrfToken, user: response.body.user, password, username };
}

export async function login(base, username, password) {
  const response = await api(base, 'POST', '/api/auth/login', { body: { username, password } });
  assertStatus(response, 200, 'login');
  return { cookie: response.cookie, csrf: response.body.csrfToken, user: response.body.user };
}

export async function createCashier(base, admin, { username = 'cashier1', password = null } = {}) {
  const response = await api(base, 'POST', '/api/users', {
    session: admin,
    body: { username, displayName: 'Cashier One', role: 'CASHIER', active: true },
  });
  assertStatus(response, 201, 'create cashier');
  const session = await login(base, username, password || response.body.temporaryPassword);
  return { session, temporaryPassword: response.body.temporaryPassword, user: response.body.user };
}

export async function createCategory(base, admin, name = 'Engine Parts') {
  const response = await api(base, 'POST', '/api/catalog/categories', {
    session: admin,
    body: { name, description: 'Test category' },
  });
  assertStatus(response, 201, 'create category');
  return response.body;
}

export async function createProduct(base, admin, {
  sku = 'SKU-001',
  name = 'Oil Filter',
  categoryId,
  costCents = 6000,
  priceCents = 10000,
  stockOnHand = 10,
  reorderLevel = 2,
} = {}) {
  const response = await api(base, 'POST', '/api/catalog/products', {
    session: admin,
    body: {
      sku, name, description: 'Test product', categoryId, costCents, priceCents,
      stockOnHand, reorderLevel, barcode: '',
    },
  });
  assertStatus(response, 201, 'create product');
  return response.body;
}

export async function setTax(base, admin, { enabled, rateBps, inclusive, cashierLimitBps = 0, reasonRequired = true }) {
  const current = await api(base, 'GET', '/api/settings', { session: admin });
  assertStatus(current, 200, 'settings read');
  const payload = {
    ...current.body,
    taxEnabled: enabled,
    taxRateBps: rateBps,
    taxInclusive: inclusive,
    cashierDiscountLimitBps: cashierLimitBps,
    discountReasonRequired: reasonRequired,
  };
  const response = await api(base, 'PUT', '/api/settings', { session: admin, body: payload });
  assertStatus(response, 200, 'settings update');
  return response.body;
}

export function cartLine(productId, quantity = 1, extra = {}) {
  return { productId, quantity, discountBps: 0, ...extra };
}

export async function checkout(base, session, {
  clientRequestId = `test-sale-${Math.random().toString(36).slice(2)}`,
  lines,
  payments,
  terminalLabel = 'Counter 1',
  note = '',
  approval,
} = {}) {
  return api(base, 'POST', '/api/sales', {
    session,
    body: { clientRequestId, terminalLabel, lines, payments, note, ...(approval ? { approval } : {}) },
  });
}

export async function getProduct(base, session, productId) {
  const response = await api(base, 'GET', `/api/catalog/products/${productId}`, { session });
  assertStatus(response, 200, 'get product');
  return response.body;
}
