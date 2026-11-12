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

async function dashboard(admin) {
  const response = await api(base, 'GET', '/api/dashboard', { session: admin });
  assertStatus(response, 200);
  return response.body;
}

function previousMonthFirstDay(isoDate) {
  const [year, month] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

async function insertHistoricalSale(admin, businessDate, netCents, suffix) {
  await ctx.owner.query(
    `INSERT INTO sales (number, cashier_id, cashier_name, terminal_label, subtotal_cents,
       discount_cents, net_cents, tax_cents, total_cents, tax_rate_bps, tax_inclusive,
       business_date, client_request_id, payload_hash)
     VALUES ($1, $2, 'Owner', 'Counter 1', $3, 0, $3, 0, $3, 0, FALSE,
       $4, $5, $6)`,
    [
      `HIST-${suffix}`,
      admin.user.id,
      netCents,
      businessDate,
      `hist-request-${suffix}`,
      'a'.repeat(64),
    ],
  );
}

test('administrator dashboard insights use the target, comparison mode, and expense ledger', async () => {
  const admin = await setupAdmin(base);
  const cashier = await createCashier(base, admin);
  const category = await createCategory(base, admin, 'Dashboard');
  const product = await createProduct(base, admin, {
    sku: 'DASH-1',
    name: 'Dashboard Filter',
    categoryId: category.id,
    costCents: 4000,
    priceCents: 10000,
    stockOnHand: 20,
    reorderLevel: 2,
  });
  const sale = await checkout(base, cashier.session, {
    clientRequestId: 'dashboard-sale-0001',
    lines: [cartLine(product.id, 1)],
    payments: [{ method: 'CASH', amountCents: 10000 }],
  });
  assertStatus(sale, 201);
  const currentReport = await dashboard(admin);
  const previousYearDate = `${Number(currentReport.businessDate.slice(0, 4)) - 1}-01-01`;
  await insertHistoricalSale(admin, previousMonthFirstDay(currentReport.businessDate), 5000, 'previous-month');
  await insertHistoricalSale(admin, previousYearDate, 5000, 'previous-year');

  const current = await settings(admin);
  const updated = await api(base, 'PUT', '/api/settings', {
    session: admin,
    body: {
      ...current,
      monthlySalesTargetCents: 50000,
      salesComparisonMode: 'monthly',
    },
  });
  assertStatus(updated, 200);

  const report = await dashboard(admin);
  assert.ok(report.insights);
  assert.equal(report.insights.target.targetCents, 50000);
  assert.equal(report.insights.target.isSet, true);
  assert.equal(report.insights.target.monthNetCents, 10000);
  assert.equal(report.insights.target.remainingCents, 40000);
  assert.equal(report.insights.target.progressPct, 20);
  assert.equal(report.insights.comparison.mode, 'monthly');
  assert.equal(report.insights.comparison.currentCents, 10000);
  assert.equal(report.insights.comparison.previousCents, 5000);
  assert.equal(report.insights.comparison.changePct, 100);
  assert.equal(report.insights.trend.points.length, 6);
  assert.equal(report.insights.trend.points.at(-1).valueCents, 10000);
  assert.equal(report.insights.trend.points.at(-2).valueCents, 5000);
  assert.equal(report.insights.topProducts.leading.sku, 'DASH-1');
  assert.equal(report.insights.topProducts.leading.sharePct, 100);
  assert.equal(report.insights.expenses.manualCents, 0);
  assert.equal(report.insights.expenses.purchaseCents, 0);

  const yearly = await api(base, 'PUT', '/api/settings', {
    session: admin,
    body: { ...updated.body, salesComparisonMode: 'yearly' },
  });
  assertStatus(yearly, 200);
  const yearlyReport = await dashboard(admin);
  assert.equal(yearlyReport.insights.comparison.mode, 'yearly');
  assert.equal(yearlyReport.insights.comparison.currentCents, 15000);
  assert.equal(yearlyReport.insights.comparison.previousCents, 5000);
  assert.equal(yearlyReport.insights.comparison.changePct, 200);
  assert.equal(yearlyReport.insights.trend.mode, 'yearly');
  assert.equal(yearlyReport.insights.trend.points.length, 5);
  assert.equal(yearlyReport.insights.trend.points.at(-1).valueCents, 15000);
  assert.equal(yearlyReport.insights.trend.points.at(-2).valueCents, 5000);
  assert.equal(yearlyReport.insights.target.monthNetCents, 10000);

  const expenseDate = report.businessDate;
  const created = await api(base, 'POST', '/api/expenses', {
    session: admin,
    body: {
      expenseDate,
      category: 'Utilities',
      description: 'Electric bill',
      amountCents: 1250,
      paidVia: 'BANK_TRANSFER',
    },
  });
  assertStatus(created, 201);
  assert.equal(created.body.amountCents, 1250);
  assert.equal(created.body.category, 'Utilities');
  assert.equal(created.body.expenseDate, expenseDate);
  assert.ok(created.body.createdByName);

  const listed = await api(base, 'GET', '/api/expenses', { session: admin });
  assertStatus(listed, 200);
  assert.equal(listed.body.length, 1);
  assert.equal(listed.body[0].id, created.body.id);

  const withExpense = await dashboard(admin);
  assert.equal(withExpense.insights.expenses.manualCents, 1250);
  assert.equal(withExpense.insights.expenses.manualCount, 1);
  assert.equal(withExpense.insights.expenses.totalCents, 1250);
  assert.equal(withExpense.insights.expenses.salesAfterOutflowsCents, 8750);

  const edited = await api(base, 'PUT', `/api/expenses/${created.body.id}`, {
    session: admin,
    body: {
      expenseDate,
      category: 'Utilities',
      description: 'Electric bill — corrected',
      amountCents: 2000,
      paidVia: 'CASH',
    },
  });
  assertStatus(edited, 200);
  assert.equal(edited.body.amountCents, 2000);
  assert.equal(edited.body.description, 'Electric bill — corrected');
  assert.equal((await dashboard(admin)).insights.expenses.manualCents, 2000);

  const future = await api(base, 'POST', '/api/expenses', {
    session: admin,
    body: {
      expenseDate: '2999-01-01',
      category: 'Other',
      description: 'Future expense',
      amountCents: 100,
      paidVia: 'CASH',
    },
  });
  assertStatus(future, 400);
  assert.equal(future.body.error.code, 'FUTURE_EXPENSE_DATE');

  const cashierCreate = await api(base, 'POST', '/api/expenses', {
    session: cashier.session,
    body: {
      expenseDate,
      category: 'Other',
      description: 'Cashier expense',
      amountCents: 100,
      paidVia: 'CASH',
    },
  });
  assertStatus(cashierCreate, 403);
  const cashierList = await api(base, 'GET', '/api/expenses', { session: cashier.session });
  assertStatus(cashierList, 403);
  const cashierDashboard = await api(base, 'GET', '/api/dashboard', { session: cashier.session });
  assertStatus(cashierDashboard, 200);
  assert.equal(cashierDashboard.body.insights, null);

  const deleted = await api(base, 'DELETE', `/api/expenses/${created.body.id}`, { session: admin });
  assertStatus(deleted, 200);
  assert.equal(deleted.body.deleted, true);
  const afterDelete = await api(base, 'GET', '/api/expenses', { session: admin });
  assertStatus(afterDelete, 200);
  assert.equal(afterDelete.body.length, 0);
  const withDeleted = await api(base, 'GET', '/api/expenses?includeDeleted=true', { session: admin });
  assertStatus(withDeleted, 200);
  assert.equal(withDeleted.body.length, 1);
  assert.ok(withDeleted.body[0].deletedAt);
  assert.equal((await dashboard(admin)).insights.expenses.manualCents, 0);

  const audit = await ctx.owner.query(
    "SELECT action FROM audit_log WHERE entity_type = 'expense' AND entity_id = $1 ORDER BY id",
    [created.body.id],
  );
  assert.deepEqual(audit.rows.map((row) => row.action), [
    'EXPENSE_RECORDED',
    'EXPENSE_UPDATED',
    'EXPENSE_DELETED',
  ]);
});

test('dashboard expenses include received purchase-order receipts and not draft orders', async () => {
  const admin = await setupAdmin(base);
  const category = await createCategory(base, admin, 'Receiving');
  const product = await createProduct(base, admin, {
    sku: 'DASH-PO',
    name: 'Receiving Filter',
    categoryId: category.id,
    costCents: 2500,
    priceCents: 5000,
    stockOnHand: 0,
    reorderLevel: 1,
  });
  const supplier = await api(base, 'POST', '/api/suppliers', {
    session: admin,
    body: {
      name: 'Dashboard Supply',
      contactName: 'Test Contact',
      phone: '555-0100',
      email: 'supply@example.test',
      address: '12 Supply Street',
      notes: 'Dashboard test',
    },
  });
  assertStatus(supplier, 201);
  const poResponse = await api(base, 'POST', '/api/purchasing/orders', {
    session: admin,
    body: {
      supplierId: supplier.body.id,
      expectedAt: '2026-11-12',
      notes: 'Dashboard receipt test',
      lines: [{ productId: product.id, orderedQty: 4, unitCostCents: 2500 }],
    },
  });
  assertStatus(poResponse, 201);
  const po = poResponse.body;

  const beforeOrder = await dashboard(admin);
  assert.equal(beforeOrder.insights.expenses.purchaseCents, 0);

  const ordered = await api(base, 'POST', `/api/purchasing/orders/${po.id}/order`, { session: admin });
  assertStatus(ordered, 200);
  const stillNoReceipt = await dashboard(admin);
  assert.equal(stillNoReceipt.insights.expenses.purchaseCents, 0);

  const received = await api(base, 'POST', `/api/purchasing/orders/${po.id}/receive`, {
    session: admin,
    body: {
      clientRequestId: 'dashboard-receipt-0001',
      items: [{ lineId: ordered.body.lines[0].id, quantity: 4 }],
      note: 'Dashboard delivery',
    },
  });
  assertStatus(received, 201);
  assert.equal(received.body.order.receivedTotalCents, 10000);

  const report = await dashboard(admin);
  assert.equal(report.insights.expenses.purchaseCents, 10000);
  assert.equal(report.insights.expenses.purchaseCount, 1);
  assert.equal(report.insights.expenses.totalCents, 10000);
  assert.equal(report.insights.expenses.purchaseReceipts[0].number, received.body.number);
  assert.equal(report.insights.expenses.purchaseReceipts[0].purchaseOrderNumber, po.number);
  assert.equal(report.insights.expenses.purchaseReceipts[0].supplierName, 'Dashboard Supply');

  const stored = await ctx.owner.query(
    'SELECT business_date FROM po_receipts WHERE number = $1',
    [received.body.number],
  );
  assert.equal(String(stored.rows[0].business_date).slice(0, 10), report.businessDate);
});
