import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  api,
  assertStatus,
  cartLine,
  checkout,
  createCashier,
  createCategory,
  createProduct,
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

async function settings(admin) {
  const response = await api(base, 'GET', '/api/settings', { session: admin });
  assertStatus(response, 200);
  return response.body;
}

test('administrators can update shop settings and the change is audited', async () => {
  const admin = await setupAdmin(base);
  const current = await settings(admin);
  assert.equal(current.shopName, 'Auto-Track');
  assert.equal(current.currency, 'PHP');
  assert.equal(current.timezone, 'Asia/Manila');

  const updated = await api(base, 'PUT', '/api/settings', {
    session: admin,
    body: {
      ...current,
      shopName: 'Auto-Track Downtown',
      address: '88 Garage Road',
      phone: '555-0111',
      email: 'shop@example.test',
      tin: '123-456-789',
      currency: 'PHP',
      timezone: 'Asia/Manila',
      businessDayCutoff: '04:30',
      receiptHeader: 'Auto-Track Downtown',
      receiptFooter: 'Drive safe.',
      receiptWidth: '58mm',
      returnsPolicy: 'Seven days with receipt.',
      taxEnabled: true,
      taxRateBps: 1200,
      taxInclusive: false,
      cashierDiscountLimitBps: 500,
      discountReasonRequired: true,
      maxLineQuantity: 50,
    },
  });
  assertStatus(updated, 200);
  assert.equal(updated.body.shopName, 'Auto-Track Downtown');
  assert.equal(updated.body.address, '88 Garage Road');
  assert.equal(updated.body.receiptWidth, '58mm');
  assert.equal(updated.body.taxRateBps, 1200);
  assert.equal(updated.body.cashierDiscountLimitBps, 500);
  assert.equal(updated.body.maxLineQuantity, 50);

  const reread = await settings(admin);
  assert.equal(reread.shopName, 'Auto-Track Downtown');
  assert.equal(reread.receiptFooter, 'Drive safe.');

  const audit = await ctx.owner.query(
    "SELECT details FROM audit_log WHERE action = 'SETTINGS_UPDATED' ORDER BY id DESC LIMIT 1",
  );
  assert.ok(audit.rows[0]);
  assert.ok(audit.rows[0].details.changed.includes('shopName'));
  assert.equal(audit.rows[0].details.taxRateBps, 1200);
});

test('settings validation rejects unsafe or malformed values', async () => {
  const admin = await setupAdmin(base);
  const current = await settings(admin);
  const cases = [
    { ...current, shopName: '' },
    { ...current, currency: 'PHPX' },
    { ...current, timezone: 'Mars/Olympus' },
    { ...current, businessDayCutoff: '25:00' },
    { ...current, businessDayCutoff: '9:00' },
    { ...current, receiptWidth: '120mm' },
    { ...current, taxRateBps: 10001 },
    { ...current, cashierDiscountLimitBps: -1 },
    { ...current, maxLineQuantity: 0 },
    { ...current, allowNegativeStock: true },
    { ...current, email: 'not-an-email' },
  ];
  for (const body of cases) {
    const response = await api(base, 'PUT', '/api/settings', { session: admin, body });
    assertStatus(response, 400, JSON.stringify(body));
  }
  const forbidden = await api(base, 'PUT', '/api/settings', {
    session: admin,
    body: { ...current, allowNegativeStock: true },
  });
  assertStatus(forbidden, 400);
  assert.equal(forbidden.body.error.code, 'NEGATIVE_STOCK_FORBIDDEN');
});

test('cashiers cannot change settings, users, or read system status', async () => {
  const admin = await setupAdmin(base);
  const cashier = await createCashier(base, admin);
  const current = await settings(admin);

  const update = await api(base, 'PUT', '/api/settings', {
    session: cashier.session,
    body: { ...current, shopName: 'Cashier Shop' },
  });
  assertStatus(update, 403);

  const users = await api(base, 'GET', '/api/users', { session: cashier.session });
  assertStatus(users, 403);

  const create = await api(base, 'POST', '/api/users', {
    session: cashier.session,
    body: { username: 'sneaky.admin', displayName: 'Sneaky', role: 'ADMIN', active: true },
  });
  assertStatus(create, 403);

  const status = await api(base, 'GET', '/api/system/status', { session: cashier.session });
  assertStatus(status, 403);
});

test('user creation issues a temporary password, hashes it, and forces a password change', async () => {
  const admin = await setupAdmin(base);
  const created = await api(base, 'POST', '/api/users', {
    session: admin,
    body: { username: 'Cashier.New', displayName: 'New Cashier', role: 'CASHIER', active: true },
  });
  assertStatus(created, 201);
  assert.equal(created.body.user.username, 'cashier.new');
  assert.equal(created.body.user.role, 'CASHIER');
  assert.equal(created.body.user.active, true);
  assert.equal(created.body.user.mustChangePassword, true);
  assert.ok(created.body.temporaryPassword.length >= 12);
  assert.equal(JSON.stringify(created.body.user).includes(created.body.temporaryPassword), false);

  const stored = await ctx.owner.query('SELECT password_hash, must_change_password FROM users WHERE username = $1', [
    'cashier.new',
  ]);
  assert.ok(stored.rows[0].password_hash.startsWith('scrypt$'));
  assert.equal(stored.rows[0].password_hash.includes(created.body.temporaryPassword), false);
  assert.equal(stored.rows[0].must_change_password, true);

  const session = await login(base, 'cashier.new', created.body.temporaryPassword);
  assert.equal(session.user.mustChangePassword, true);

  const changed = await api(base, 'POST', '/api/auth/change-password', {
    session,
    body: { currentPassword: created.body.temporaryPassword, newPassword: 'BrandNewPass-2026' },
  });
  assertStatus(changed, 204);

  const oldLogin = await api(base, 'POST', '/api/auth/login', {
    body: { username: 'cashier.new', password: created.body.temporaryPassword },
  });
  assertStatus(oldLogin, 401);

  const newLogin = await login(base, 'cashier.new', 'BrandNewPass-2026');
  assert.equal(newLogin.user.mustChangePassword, false);
});

test('duplicate usernames and invalid usernames are rejected', async () => {
  const admin = await setupAdmin(base);
  const created = await api(base, 'POST', '/api/users', {
    session: admin,
    body: { username: 'cashier.one', displayName: 'Cashier One', role: 'CASHIER', active: true },
  });
  assertStatus(created, 201);

  const duplicate = await api(base, 'POST', '/api/users', {
    session: admin,
    body: { username: 'CASHIER.ONE', displayName: 'Duplicate', role: 'CASHIER', active: true },
  });
  assertStatus(duplicate, 409);
  assert.equal(duplicate.body.error.code, 'DUPLICATE_USERNAME');

  const invalid = [
    { username: 'a b', displayName: 'Space', role: 'CASHIER', active: true },
    { username: 'ab', displayName: 'Short', role: 'CASHIER', active: true },
    { username: 'cashier!', displayName: 'Symbol', role: 'CASHIER', active: true },
    { username: 'cashier.ok', displayName: '', role: 'CASHIER', active: true },
    { username: 'cashier.ok', displayName: 'Role', role: 'OWNER', active: true },
  ];
  for (const body of invalid) {
    const response = await api(base, 'POST', '/api/users', { session: admin, body });
    assertStatus(response, 400, JSON.stringify(body));
  }
});

test('an administrator cannot demote or deactivate the final active administrator', async () => {
  const admin = await setupAdmin(base);
  const self = admin.user;

  const demote = await api(base, 'PUT', `/api/users/${self.id}`, {
    session: admin,
    body: { ...self, role: 'CASHIER', active: true },
  });
  assertStatus(demote, 409);
  assert.equal(demote.body.error.code, 'LAST_ADMIN');

  const deactivate = await api(base, 'PUT', `/api/users/${self.id}`, {
    session: admin,
    body: { ...self, role: 'ADMIN', active: false },
  });
  assertStatus(deactivate, 409);
  assert.equal(deactivate.body.error.code, 'LAST_ADMIN');

  const second = await api(base, 'POST', '/api/users', {
    session: admin,
    body: { username: 'owner.two', displayName: 'Second Owner', role: 'ADMIN', active: true },
  });
  assertStatus(second, 201);

  const demoted = await api(base, 'PUT', `/api/users/${self.id}`, {
    session: admin,
    body: { ...self, role: 'CASHIER', active: true },
  });
  assertStatus(demoted, 200);
  assert.equal(demoted.body.role, 'CASHIER');

  const me = await api(base, 'GET', '/api/auth/me', { session: admin });
  assertStatus(me, 401);
  const demotedSession = await login(base, 'owner', admin.password);
  assert.equal(demotedSession.user.role, 'CASHIER');
  const denied = await api(base, 'GET', '/api/users', { session: demotedSession });
  assertStatus(denied, 403);
});

test('deactivation revokes the cashier session and blocks login', async () => {
  const admin = await setupAdmin(base);
  const cashier = await createCashier(base, admin);

  const before = await api(base, 'GET', '/api/auth/me', { session: cashier.session });
  assertStatus(before, 200);

  const deactivated = await api(base, 'PUT', `/api/users/${cashier.user.id}`, {
    session: admin,
    body: { ...cashier.user, active: false },
  });
  assertStatus(deactivated, 200);
  assert.equal(deactivated.body.active, false);

  const after = await api(base, 'GET', '/api/auth/me', { session: cashier.session });
  assertStatus(after, 401);

  const loginAttempt = await api(base, 'POST', '/api/auth/login', {
    body: { username: 'cashier1', password: cashier.temporaryPassword },
  });
  assertStatus(loginAttempt, 401);
});

test('password reset issues a new temporary password and revokes existing sessions', async () => {
  const admin = await setupAdmin(base);
  const cashier = await createCashier(base, admin);

  const reset = await api(base, 'POST', `/api/users/${cashier.user.id}/reset-password`, { session: admin });
  assertStatus(reset, 200);
  assert.ok(reset.body.temporaryPassword.length >= 12);
  assert.notEqual(reset.body.temporaryPassword, cashier.temporaryPassword);
  assert.equal(reset.body.user.mustChangePassword, true);

  const oldSession = await api(base, 'GET', '/api/auth/me', { session: cashier.session });
  assertStatus(oldSession, 401);

  const oldLogin = await api(base, 'POST', '/api/auth/login', {
    body: { username: 'cashier1', password: cashier.temporaryPassword },
  });
  assertStatus(oldLogin, 401);

  const newLogin = await login(base, 'cashier1', reset.body.temporaryPassword);
  assert.equal(newLogin.user.mustChangePassword, true);
});

test('the users and audit log never disappear when a cashier is deactivated', async () => {
  const admin = await setupAdmin(base);
  const cashier = await createCashier(base, admin);
  await api(base, 'PUT', `/api/users/${cashier.user.id}`, {
    session: admin,
    body: { ...cashier.user, active: false },
  });
  const users = await api(base, 'GET', '/api/users', { session: admin });
  assertStatus(users, 200);
  assert.equal(users.body.some((row) => row.id === cashier.user.id), true);
  await assert.rejects(
    ctx.owner.query('DELETE FROM users WHERE id = $1', [cashier.user.id]),
    /retained for audit/,
  );
  const audit = await ctx.owner.query(
    "SELECT action FROM audit_log WHERE entity_type = 'user' AND entity_id = $1 ORDER BY id",
    [cashier.user.id],
  );
  assert.ok(audit.rows.some((row) => row.action === 'USER_CREATED'));
  assert.ok(audit.rows.some((row) => row.action === 'USER_UPDATED'));
});

async function seedReports(admin, cashier1, cashier2) {
  const category = await createCategory(base, admin, 'Reports');
  const p1 = await createProduct(base, admin, {
    sku: 'REP-1', name: 'Brake Pads', categoryId: category.id,
    costCents: 6000, priceCents: 10000, stockOnHand: 20, reorderLevel: 2,
  });
  const p2 = await createProduct(base, admin, {
    sku: 'REP-2', name: 'Wiper Blade', categoryId: category.id,
    costCents: 2500, priceCents: 5000, stockOnHand: 20, reorderLevel: 2,
  });
  const p3 = await createProduct(base, admin, {
    sku: 'REP-3', name: 'Rare Filter', categoryId: category.id,
    costCents: 500, priceCents: 1000, stockOnHand: 1, reorderLevel: 5,
  });

  const sale1 = await checkout(base, cashier1.session, {
    clientRequestId: 'reports-sale-0001',
    lines: [cartLine(p1.id, 2)],
    payments: [{ method: 'CASH', amountCents: 20000 }],
  });
  assertStatus(sale1, 201);
  const sale2 = await checkout(base, cashier1.session, {
    clientRequestId: 'reports-sale-0002',
    lines: [cartLine(p2.id, 1)],
    payments: [{ method: 'CASH', amountCents: 5000 }],
  });
  assertStatus(sale2, 201);
  const sale3 = await checkout(base, cashier2.session, {
    clientRequestId: 'reports-sale-0003',
    lines: [cartLine(p1.id, 1)],
    payments: [{ method: 'CASH', amountCents: 10000 }],
  });
  assertStatus(sale3, 201);

  const returned = await api(base, 'POST', `/api/sales/${sale1.body.sale.id}/returns`, {
    session: cashier1.session,
    body: {
      clientRequestId: 'reports-return-0001',
      reason: 'Size mismatch',
      refundMethod: 'CASH',
      items: [{ saleItemId: sale1.body.sale.items[0].id, quantity: 1, restock: true }],
      approval: { username: 'owner', password: 'CorrectHorse9Battery' },
    },
  });
  assertStatus(returned, 201);

  const voided = await api(base, 'POST', `/api/sales/${sale2.body.sale.id}/void`, {
    session: cashier1.session,
    body: {
      clientRequestId: 'reports-void-0001',
      reason: 'Duplicate entry',
      approval: { username: 'owner', password: 'CorrectHorse9Battery' },
    },
  });
  assertStatus(voided, 201);
  return { p1, p2, p3, sale1: sale1.body.sale, sale2: sale2.body.sale, sale3: sale3.body.sale };
}

test('daily reports reconcile completed sales, returns, and voids', async () => {
  const admin = await setupAdmin(base);
  const cashier1 = await createCashier(base, admin, { username: 'cashier1' });
  const cashier2 = await createCashier(base, admin, { username: 'cashier2' });
  await seedReports(admin, cashier1, cashier2);

  const report = await api(base, 'GET', '/api/reports/daily', { session: admin });
  assertStatus(report, 200);
  assert.equal(report.body.transactionCount, 2);
  assert.equal(report.body.grossCents, 30000);
  assert.equal(report.body.taxCents, 0);
  assert.equal(report.body.discountsCents, 0);
  assert.equal(report.body.refundsCents, 10000);
  assert.equal(report.body.collectedCents, 20000);
  assert.equal(report.body.netExTaxCents, 20000);
  assert.equal(report.body.averageSaleCents, 10000);
  assert.equal(report.body.returnsCount, 1);
  assert.equal(report.body.voidCount, 1);
  assert.equal(report.body.voidValueCents, 5000);
  assert.equal(report.body.byPayment.length, 1);
  assert.deepEqual(report.body.byPayment[0], { method: 'CASH', amountCents: 20000 });
  assert.equal(report.body.topProducts.length, 1);
  assert.equal(report.body.topProducts[0].sku, 'REP-1');
  assert.equal(report.body.topProducts[0].quantity, 2);
  assert.equal(report.body.topProducts[0].netCents, 20000);
  assert.equal(report.body.byDay[0].transactions, 2);
  assert.equal(report.body.byDay[0].refundsCents, 10000);
  assert.equal(report.body.byDay[0].collectedCents, 20000);
});

test('cashier reports are restricted to their own sales', async () => {
  const admin = await setupAdmin(base);
  const cashier1 = await createCashier(base, admin, { username: 'cashier1' });
  const cashier2 = await createCashier(base, admin, { username: 'cashier2' });
  await seedReports(admin, cashier1, cashier2);

  const report1 = await api(base, 'GET', '/api/reports/daily', { session: cashier1.session });
  assertStatus(report1, 200);
  assert.equal(report1.body.transactionCount, 1);
  assert.equal(report1.body.grossCents, 20000);
  assert.equal(report1.body.refundsCents, 10000);
  assert.equal(report1.body.collectedCents, 10000);
  assert.equal(report1.body.voidCount, 1);
  assert.equal(report1.body.topProducts[0].quantity, 1);

  const report2 = await api(base, 'GET', '/api/reports/daily', { session: cashier2.session });
  assertStatus(report2, 200);
  assert.equal(report2.body.transactionCount, 1);
  assert.equal(report2.body.collectedCents, 10000);
  assert.equal(report2.body.voidCount, 0);
  assert.equal(report2.body.returnsCount, 0);

  const costs = await api(base, 'GET', '/api/reports/inventory-valuation', { session: cashier1.session });
  assertStatus(costs, 403);
  const movements = await api(base, 'GET', '/api/reports/stock-movements', { session: cashier1.session });
  assertStatus(movements, 403);
  const purchasing = await api(base, 'GET', '/api/reports/purchasing', { session: cashier1.session });
  assertStatus(purchasing, 403);
});

test('dashboards show scoped totals, recent sales, and low stock without leaking costs', async () => {
  const admin = await setupAdmin(base);
  const cashier1 = await createCashier(base, admin, { username: 'cashier1' });
  const cashier2 = await createCashier(base, admin, { username: 'cashier2' });
  const { p3 } = await seedReports(admin, cashier1, cashier2);

  const adminDash = await api(base, 'GET', '/api/dashboard', { session: admin });
  assertStatus(adminDash, 200);
  assert.equal(adminDash.body.scopeLabel, 'Shop-wide view');
  assert.equal(adminDash.body.transactionCount, 2);
  assert.equal(adminDash.body.totalCents, 20000);
  assert.equal(adminDash.body.voidCount, 1);
  assert.equal(adminDash.body.lowStockCount, 1);
  assert.equal(adminDash.body.lowStock[0].id, p3.id);
  assert.equal(adminDash.body.lowStock[0].costCents, 500);
  assert.equal(adminDash.body.recentSales.length, 3);
  const statuses = new Set(adminDash.body.recentSales.map((row) => row.status));
  assert.ok(statuses.has('VOIDED'));
  assert.ok(statuses.has('PARTIALLY_RETURNED'));
  assert.ok(statuses.has('COMPLETED'));

  const cashierDash = await api(base, 'GET', '/api/dashboard', { session: cashier1.session });
  assertStatus(cashierDash, 200);
  assert.match(cashierDash.body.scopeLabel, /^My sales/);
  assert.equal(cashierDash.body.transactionCount, 1);
  assert.equal(cashierDash.body.totalCents, 10000);
  assert.equal(cashierDash.body.recentSales.length, 2);
  assert.equal(cashierDash.body.lowStock[0].costCents, undefined);
  assert.equal(cashierDash.body.lowStockCount, 1);
});

test('valuation and low-stock reports expose cost only to administrators', async () => {
  const admin = await setupAdmin(base);
  const cashier = await createCashier(base, admin);
  const category = await createCategory(base, admin);
  const product = await createProduct(base, admin, {
    sku: 'VAL-1', categoryId: category.id, costCents: 6000, priceCents: 10000, stockOnHand: 10, reorderLevel: 2,
  });
  await createProduct(base, admin, {
    sku: 'VAL-LOW', categoryId: category.id, costCents: 500, priceCents: 1000, stockOnHand: 1, reorderLevel: 5,
  });

  const valuation = await api(base, 'GET', '/api/reports/inventory-valuation', { session: admin });
  assertStatus(valuation, 200);
  const row = valuation.body.find((entry) => entry.id === product.id);
  assert.equal(row.wacCents, 6000);
  assert.equal(row.retailValueCents, 100000);
  assert.equal(row.stockValueCents, 60000);

  const low = await api(base, 'GET', '/api/reports/low-stock', { session: admin });
  assertStatus(low, 200);
  assert.equal(low.body.length, 1);
  assert.equal(low.body[0].sku, 'VAL-LOW');
  assert.equal(low.body[0].costCents, 500);

  const lowCashier = await api(base, 'GET', '/api/reports/low-stock', { session: cashier.session });
  assertStatus(lowCashier, 200);
  assert.equal(lowCashier.body.length, 1);
  assert.equal(lowCashier.body[0].costCents, undefined);

  const movements = await api(base, 'GET', '/api/reports/stock-movements', { session: admin });
  assertStatus(movements, 200);
  assert.ok(movements.body.length >= 1);
  assert.ok(movements.body.some((entry) => entry.type === 'OPENING'));
});

test('system status is administrator-only and reports database migration state', async () => {
  const admin = await setupAdmin(base);
  const response = await api(base, 'GET', '/api/system/status', { session: admin });
  assertStatus(response, 200);
  assert.equal(response.body.app.name, 'Auto-Track POS');
  assert.equal(response.body.database.name.includes('autotrack_test'), true);
  assert.ok(response.body.database.migrations.length >= 2);
  assert.equal(response.body.counts.active_users, 1);
  assert.equal(response.body.shop.name, 'Auto-Track');
  assert.equal(response.body.shop.currency, 'PHP');

  const health = await api(base, 'GET', '/api/health');
  assertStatus(health, 200);
  assert.equal(health.body.status, 'ok');
  assert.equal(health.body.database, 'ok');
});
