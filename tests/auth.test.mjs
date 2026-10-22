import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  api,
  assertStatus,
  createCashier,
  login,
  setupAdmin,
  startTestServer,
} from './helpers.mjs';

let ctx;
let base;

before(async () => {
  ctx = await startTestServer();
  base = ctx.base;
});
after(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await ctx.reset();
});

test('public health check is available without authentication', async () => {
  const response = await api(base, 'GET', '/api/health');
  assertStatus(response, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.database, 'ok');
});

test('one-time setup creates an administrator, session, and rejects a second setup', async () => {
  const admin = await setupAdmin(base);
  assert.equal(admin.user.role, 'ADMIN');
  assert.equal(admin.user.mustChangePassword, false);
  assert.ok(admin.cookie.includes('at_test_session='));
  assert.equal(admin.csrf.length, 64);

  const me = await api(base, 'GET', '/api/auth/me', { session: admin });
  assertStatus(me, 200);
  assert.equal(me.body.user.username, 'owner');

  const status = await api(base, 'GET', '/api/auth/setup-status');
  assertStatus(status, 200);
  assert.equal(status.body.setupRequired, false);

  const again = await api(base, 'POST', '/api/auth/setup', {
    body: { token: 'test-bootstrap-token-0123456789abcdef', username: 'other', displayName: 'Other', password: 'CorrectHorse9Battery' },
  });
  assertStatus(again, 409);
});

test('setup rejects an invalid token', async () => {
  const response = await api(base, 'POST', '/api/auth/setup', {
    body: { token: 'wrong-token-wrong-token', username: 'owner', displayName: 'Owner', password: 'CorrectHorse9Battery' },
  });
  assertStatus(response, 403);
});

test('login rejects a bad password and rate limits repeated failures', async () => {
  await setupAdmin(base);
  const bad = await api(base, 'POST', '/api/auth/login', { body: { username: 'owner', password: 'WrongPassword123' } });
  assertStatus(bad, 401);
  assert.equal(bad.body.error.code, 'UNAUTHENTICATED');

  for (let i = 0; i < 5; i += 1) {
    const response = await api(base, 'POST', '/api/auth/login', { body: { username: 'nobody', password: 'WrongPassword123' } });
    assertStatus(response, 401);
  }
  const limited = await api(base, 'POST', '/api/auth/login', { body: { username: 'nobody', password: 'WrongPassword123' } });
  assertStatus(limited, 429);
});

test('CSRF token is required for mutations and a cross-origin request is refused', async () => {
  const admin = await setupAdmin(base);
  const missing = await api(base, 'POST', '/api/catalog/categories', {
    session: { cookie: admin.cookie },
    body: { name: 'No CSRF' },
  });
  assertStatus(missing, 403);

  const cross = await api(base, 'POST', '/api/catalog/categories', {
    session: admin,
    headers: { origin: 'https://evil.example' },
    body: { name: 'Cross Origin' },
  });
  assertStatus(cross, 403);

  const ok = await api(base, 'POST', '/api/catalog/categories', { session: admin, body: { name: 'With CSRF' } });
  assertStatus(ok, 201);
});

test('logout revokes the session and unauthenticated routes are refused', async () => {
  const admin = await setupAdmin(base);
  const out = await api(base, 'POST', '/api/auth/logout', { session: admin });
  assertStatus(out, 204);
  const after = await api(base, 'GET', '/api/bootstrap', { session: admin });
  assertStatus(after, 401);
  const anonymous = await api(base, 'GET', '/api/bootstrap');
  assertStatus(anonymous, 401);
});

test('cashier permissions are enforced on the server', async () => {
  const admin = await setupAdmin(base);
  const cashier = await createCashier(base, admin);

  const users = await api(base, 'GET', '/api/users', { session: cashier.session });
  assertStatus(users, 403);
  const suppliers = await api(base, 'GET', '/api/suppliers', { session: cashier.session });
  assertStatus(suppliers, 403);
  const purchasing = await api(base, 'GET', '/api/purchasing/orders', { session: cashier.session });
  assertStatus(purchasing, 403);
  const settingsUpdate = await api(base, 'PUT', '/api/settings', {
    session: cashier.session,
    body: { shopName: 'Hacked' },
  });
  assertStatus(settingsUpdate, 403);
  const valuation = await api(base, 'GET', '/api/reports/inventory-valuation', { session: cashier.session });
  assertStatus(valuation, 403);
  const system = await api(base, 'GET', '/api/system/status', { session: cashier.session });
  assertStatus(system, 403);
  const productCreate = await api(base, 'POST', '/api/catalog/products', {
    session: cashier.session,
    body: { sku: 'X', name: 'X', categoryId: 1, costCents: 1, priceCents: 1 },
  });
  assertStatus(productCreate, 403);

  const settingsRead = await api(base, 'GET', '/api/settings', { session: cashier.session });
  assertStatus(settingsRead, 200);
});

test('password change revokes other sessions and the new password works', async () => {
  const admin = await setupAdmin(base);
  const second = await login(base, 'owner', 'CorrectHorse9Battery');
  const change = await api(base, 'POST', '/api/auth/change-password', {
    session: admin,
    body: { currentPassword: 'CorrectHorse9Battery', newPassword: 'DifferentPass2026' },
  });
  assertStatus(change, 204);
  const oldSecond = await api(base, 'GET', '/api/auth/me', { session: second });
  assertStatus(oldSecond, 401);
  const oldLogin = await api(base, 'POST', '/api/auth/login', {
    body: { username: 'owner', password: 'CorrectHorse9Battery' },
  });
  assertStatus(oldLogin, 401);
  const newLogin = await login(base, 'owner', 'DifferentPass2026');
  assert.equal(newLogin.user.username, 'owner');
});

test('last active administrator cannot be demoted or deactivated', async () => {
  const admin = await setupAdmin(base);
  const demote = await api(base, 'PUT', `/api/users/${admin.user.id}`, {
    session: admin,
    body: { username: 'owner', displayName: 'Owner Admin', role: 'CASHIER', active: true },
  });
  assertStatus(demote, 409);
  assert.equal(demote.body.error.code, 'LAST_ADMIN');

  const deactivate = await api(base, 'PUT', `/api/users/${admin.user.id}`, {
    session: admin,
    body: { username: 'owner', displayName: 'Owner Admin', role: 'ADMIN', active: false },
  });
  assertStatus(deactivate, 409);
});

test('new users receive a one-time temporary password and must change it', async () => {
  const admin = await setupAdmin(base);
  const cashier = await createCashier(base, admin, { username: 'temporary' });
  assert.equal(cashier.user.mustChangePassword, true);
  assert.ok(cashier.temporaryPassword.length >= 12);
  const reset = await api(base, 'POST', `/api/users/${cashier.user.id}/reset-password`, { session: admin });
  assertStatus(reset, 200);
  assert.notEqual(reset.body.temporaryPassword, cashier.temporaryPassword);
  const old = await api(base, 'GET', '/api/auth/me', { session: cashier.session });
  assertStatus(old, 401);
  await login(base, 'temporary', reset.body.temporaryPassword);
});
