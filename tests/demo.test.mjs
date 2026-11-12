import test from 'node:test';
import assert from 'node:assert/strict';

import { createDemoShop } from '../demo/mock/seed.js';

test('the static demo mirrors dashboard insights, expenses, and settings', () => {
  const now = new Date(2026, 10, 12, 10, 0, 0);
  const shop = createDemoShop(now);
  const admin = shop.state.users.find((user) => user.role === 'ADMIN');
  const cashier = shop.state.users.find((user) => user.role === 'CASHIER');
  const adminDashboard = shop.dashboard(admin, now);
  const cashierDashboard = shop.dashboard(cashier, now);

  assert.equal(adminDashboard.businessDate, '2026-11-12');
  assert.ok(adminDashboard.insights);
  assert.equal(adminDashboard.insights.comparison.mode, 'monthly');
  assert.ok(adminDashboard.insights.comparison.currentCents > 0);
  assert.ok(adminDashboard.insights.comparison.previousCents > 0);
  assert.equal(adminDashboard.insights.target.isSet, true);
  assert.ok(adminDashboard.insights.target.progressPct > 0);
  assert.equal(adminDashboard.insights.trend.points.length, 6);
  assert.equal(adminDashboard.insights.trend.points.at(-1).isCurrent, true);
  assert.ok(adminDashboard.insights.topProducts.leading);
  assert.equal(adminDashboard.insights.expenses.manualCount, 4);
  assert.equal(adminDashboard.insights.expenses.purchaseCount, 2);
  assert.ok(adminDashboard.insights.expenses.purchaseCents > 0);
  assert.ok(adminDashboard.insights.expenses.purchaseReceipts.every((receipt) => receipt.receiptDate.startsWith('2026-11')));
  assert.equal(cashierDashboard.insights, null);

  const created = shop.createExpense({
    expenseDate: '2026-11-12',
    category: 'Maintenance',
    description: 'Demo expense',
    amountCents: 9900,
    paidVia: 'CASH',
  }, admin, now);
  assert.equal(created.createdByName, admin.displayName);
  assert.equal(shop.listExpenses({ from: '2026-11-01', to: '2026-11-12' }).length, 5);

  const updated = shop.updateExpense(created.id, {
    expenseDate: '2026-11-12',
    category: 'Maintenance',
    description: 'Updated demo expense',
    amountCents: 12500,
    paidVia: 'BANK_TRANSFER',
  }, admin, now);
  assert.equal(updated.amountCents, 12500);
  assert.equal(updated.paidVia, 'BANK_TRANSFER');

  shop.deleteExpense(created.id, admin, now);
  assert.equal(shop.listExpenses({ from: '2026-11-01', to: '2026-11-12' }).length, 4);

  shop.updateSettings({ monthlySalesTargetCents: 7500000, salesComparisonMode: 'yearly' }, now);
  const yearly = shop.dashboard(admin, now).insights;
  assert.equal(yearly.comparison.mode, 'yearly');
  assert.equal(yearly.trend.mode, 'yearly');
  assert.equal(yearly.trend.points.length, 5);
  assert.equal(yearly.target.targetCents, 7500000);
  assert.equal(yearly.target.monthNetCents, adminDashboard.insights.target.monthNetCents);
});
