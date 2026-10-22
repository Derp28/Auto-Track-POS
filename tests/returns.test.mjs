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
  getProduct,
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

async function seedSale(admin, { priceCents = 10000, costCents = 6000, stockOnHand = 10, quantity = 3, sku = 'RET-1', seller = admin } = {}) {
  const category = await createCategory(base, admin, 'Returns');
  const product = await createProduct(base, admin, {
    sku, categoryId: category.id, priceCents, costCents, stockOnHand,
  });
  const sale = await checkout(base, seller, {
    clientRequestId: `return-sale-${Math.random().toString(36).slice(2)}`,
    lines: [cartLine(product.id, quantity)],
    payments: [{ method: 'CASH', amountCents: priceCents * quantity }],
  });
  assertStatus(sale, 201);
  return { product, sale: sale.body.sale };
}

function returnRequest(sale, quantity, extra = {}) {
  return {
    clientRequestId: `return-${Math.random().toString(36).slice(2)}`,
    reason: 'Customer return',
    refundMethod: 'CASH',
    items: [{ saleItemId: sale.items[0].id, quantity, restock: true }],
    ...extra,
  };
}

test('partial returns refund and restore cost proportionally until the line is fully returned', async () => {
  const admin = await setupAdmin(base);
  const { product, sale } = await seedSale(admin);
  assert.equal(sale.totalCents, 30000);
  let stock = await getProduct(base, admin, product.id);
  assert.equal(stock.stockOnHand, 7);
  assert.equal(stock.stockValueCents, 42000);

  const first = await api(base, 'POST', `/api/sales/${sale.id}/returns`, {
    session: admin,
    body: returnRequest(sale, 1),
  });
  assertStatus(first, 201);
  assert.equal(first.body.sale.status, 'PARTIALLY_RETURNED');
  assert.equal(first.body.sale.returnedCents, 10000);
  assert.equal(first.body.sale.returns.length, 1);
  assert.equal(first.body.sale.returns[0].items[0].costValueCents, 6000);
  stock = await getProduct(base, admin, product.id);
  assert.equal(stock.stockOnHand, 8);
  assert.equal(stock.stockValueCents, 48000);

  const second = await api(base, 'POST', `/api/sales/${sale.id}/returns`, {
    session: admin,
    body: returnRequest(sale, 1),
  });
  assertStatus(second, 201);
  assert.equal(second.body.sale.returnedCents, 20000);
  stock = await getProduct(base, admin, product.id);
  assert.equal(stock.stockOnHand, 9);
  assert.equal(stock.stockValueCents, 54000);

  const third = await api(base, 'POST', `/api/sales/${sale.id}/returns`, {
    session: admin,
    body: returnRequest(sale, 1),
  });
  assertStatus(third, 201);
  assert.equal(third.body.sale.status, 'RETURNED');
  assert.equal(third.body.sale.returnedCents, 30000);
  stock = await getProduct(base, admin, product.id);
  assert.equal(stock.stockOnHand, 10);
  assert.equal(stock.stockValueCents, 60000);

  const over = await api(base, 'POST', `/api/sales/${sale.id}/returns`, {
    session: admin,
    body: returnRequest(sale, 1),
  });
  assertStatus(over, 422);
  assert.equal(over.body.error.code, 'OVER_RETURN');
});

test('return cost restoration uses deterministic remainder allocation', async () => {
  const admin = await setupAdmin(base);
  const { product, sale } = await seedSale(admin, {
    sku: 'RET-ROUND',
    costCents: 3333,
    stockOnHand: 3,
    quantity: 3,
  });
  const opening = 9999;
  for (let i = 0; i < 3; i += 1) {
    const response = await api(base, 'POST', `/api/sales/${sale.id}/returns`, {
      session: admin,
      body: returnRequest(sale, 1),
    });
    assertStatus(response, 201);
    const after = await getProduct(base, admin, product.id);
    assert.equal(after.stockOnHand, i + 1);
  }
  const final = await getProduct(base, admin, product.id);
  assert.equal(final.stockOnHand, 3);
  assert.equal(final.stockValueCents, opening);
});

test('duplicate return submissions replay without double-refunding or double-restocking', async () => {
  const admin = await setupAdmin(base);
  const { product, sale } = await seedSale(admin, { sku: 'RET-DUP' });
  const body = returnRequest(sale, 1, { clientRequestId: 'return-idem-0001' });
  const first = await api(base, 'POST', `/api/sales/${sale.id}/returns`, { session: admin, body });
  assertStatus(first, 201);
  const replay = await api(base, 'POST', `/api/sales/${sale.id}/returns`, { session: admin, body });
  assertStatus(replay, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.number, first.body.number);
  assert.equal(replay.body.sale.returnedCents, 10000);
  assert.equal(replay.body.sale.returns.length, 1);
  const after = await getProduct(base, admin, product.id);
  assert.equal(after.stockOnHand, 8);
  assert.equal(after.stockValueCents, 48000);
});

test('non-restocked returns refund the customer without changing stock', async () => {
  const admin = await setupAdmin(base);
  const { product, sale } = await seedSale(admin, { sku: 'RET-NOSTOCK' });
  const response = await api(base, 'POST', `/api/sales/${sale.id}/returns`, {
    session: admin,
    body: returnRequest(sale, 1, {
      items: [{ saleItemId: sale.items[0].id, quantity: 1, restock: false }],
    }),
  });
  assertStatus(response, 201);
  assert.equal(response.body.sale.returns[0].items[0].restock, false);
  const after = await getProduct(base, admin, product.id);
  assert.equal(after.stockOnHand, 7);
  assert.equal(after.stockValueCents, 42000);
  const movements = await api(base, 'GET', `/api/inventory/movements?productId=${product.id}`, { session: admin });
  assertStatus(movements, 200);
  assert.equal(movements.body.filter((row) => row.type === 'RETURN').length, 0);
});

test('cashier returns require a valid administrator override', async () => {
  const admin = await setupAdmin(base);
  const cashier = await createCashier(base, admin);
  const { sale } = await seedSale(admin, { sku: 'RET-AUTH', seller: cashier.session });

  const missing = await api(base, 'POST', `/api/sales/${sale.id}/returns`, {
    session: cashier.session,
    body: returnRequest(sale, 1),
  });
  assertStatus(missing, 403);

  const wrong = await api(base, 'POST', `/api/sales/${sale.id}/returns`, {
    session: cashier.session,
    body: returnRequest(sale, 1, { approval: { username: 'owner', password: 'WrongPassword123' } }),
  });
  assertStatus(wrong, 403);

  const ok = await api(base, 'POST', `/api/sales/${sale.id}/returns`, {
    session: cashier.session,
    body: returnRequest(sale, 1, { approval: { username: 'owner', password: 'CorrectHorse9Battery' } }),
  });
  assertStatus(ok, 201);
  assert.equal(ok.body.sale.returns[0].approvedBy, admin.user.id);
});

test('void restores stock, refunds each payment method, and is final', async () => {
  const admin = await setupAdmin(base);
  const category = await createCategory(base, admin, 'Voids');
  const product = await createProduct(base, admin, {
    sku: 'VOID-1', categoryId: category.id, priceCents: 10000, costCents: 6000, stockOnHand: 10,
  });
  const saleResponse = await checkout(base, admin, {
    clientRequestId: 'void-sale-0001',
    lines: [cartLine(product.id, 3)],
    payments: [
      { method: 'CASH', amountCents: 15000 },
      { method: 'CARD_EXTERNAL', amountCents: 15000, reference: 'TERM-1' },
    ],
  });
  assertStatus(saleResponse, 201);
  const sale = saleResponse.body.sale;

  const voided = await api(base, 'POST', `/api/sales/${sale.id}/void`, {
    session: admin,
    body: { clientRequestId: 'void-request-0001', reason: 'Wrong item' },
  });
  assertStatus(voided, 201);
  assert.equal(voided.body.sale.status, 'VOIDED');
  assert.equal(voided.body.sale.void.reason, 'Wrong item');
  assert.equal(voided.body.sale.void.totalCents, 30000);
  assert.equal(voided.body.sale.void.voidedBy, admin.user.id);
  assert.equal(voided.body.sale.void.approvedBy, null);

  const stock = await getProduct(base, admin, product.id);
  assert.equal(stock.stockOnHand, 10);
  assert.equal(stock.stockValueCents, 60000);

  const refunds = await ctx.owner.query(
    'SELECT method, amount_cents FROM refunds WHERE sale_id = $1 ORDER BY id',
    [sale.id],
  );
  assert.deepEqual(
    refunds.rows.map((row) => [row.method, Number(row.amount_cents)]),
    [['CASH', 15000], ['CARD_EXTERNAL', 15000]],
  );

  const again = await api(base, 'POST', `/api/sales/${sale.id}/void`, {
    session: admin,
    body: { clientRequestId: 'void-request-0002', reason: 'Again' },
  });
  assertStatus(again, 409);
  assert.equal(again.body.error.code, 'ALREADY_VOIDED');

  const returned = await api(base, 'POST', `/api/sales/${sale.id}/returns`, {
    session: admin,
    body: returnRequest(sale, 1),
  });
  assertStatus(returned, 409);
  assert.equal(returned.body.error.code, 'SALE_VOIDED');
});

test('sales with returns cannot be voided', async () => {
  const admin = await setupAdmin(base);
  const { sale } = await seedSale(admin, { sku: 'VOID-RET' });
  const returned = await api(base, 'POST', `/api/sales/${sale.id}/returns`, {
    session: admin,
    body: returnRequest(sale, 1),
  });
  assertStatus(returned, 201);
  const blocked = await api(base, 'POST', `/api/sales/${sale.id}/void`, {
    session: admin,
    body: { clientRequestId: 'void-has-return-1', reason: 'Too late' },
  });
  assertStatus(blocked, 409);
  assert.equal(blocked.body.error.code, 'HAS_RETURNS');
});

test('voids are limited to the current business day', async () => {
  const admin = await setupAdmin(base);
  const { sale } = await seedSale(admin, { sku: 'VOID-CUTOFF' });
  const settings = await api(base, 'GET', '/api/settings', { session: admin });
  assertStatus(settings, 200);
  const updated = await api(base, 'PUT', '/api/settings', {
    session: admin,
    body: { ...settings.body, businessDayCutoff: '23:59' },
  });
  assertStatus(updated, 200);
  const blocked = await api(base, 'POST', `/api/sales/${sale.id}/void`, {
    session: admin,
    body: { clientRequestId: 'void-cutoff-0001', reason: 'Yesterday' },
  });
  assertStatus(blocked, 422);
  assert.equal(blocked.body.error.code, 'CUTOFF');
});

test('cashier voids require administrator approval and record both users', async () => {
  const admin = await setupAdmin(base);
  const cashier = await createCashier(base, admin);
  const { sale } = await seedSale(admin, { sku: 'VOID-AUTH', seller: cashier.session });

  const missing = await api(base, 'POST', `/api/sales/${sale.id}/void`, {
    session: cashier.session,
    body: { clientRequestId: 'void-cashier-0001', reason: 'Mistake' },
  });
  assertStatus(missing, 403);

  const ok = await api(base, 'POST', `/api/sales/${sale.id}/void`, {
    session: cashier.session,
    body: {
      clientRequestId: 'void-cashier-0002',
      reason: 'Mistake',
      approval: { username: 'owner', password: 'CorrectHorse9Battery' },
    },
  });
  assertStatus(ok, 201);
  assert.equal(ok.body.sale.void.voidedBy, cashier.user.id);
  assert.equal(ok.body.sale.void.approvedBy, admin.user.id);
});

test('returns and voids retain audit history and completed sales are immutable at the database layer', async () => {
  const admin = await setupAdmin(base);
  const { sale } = await seedSale(admin, { sku: 'AUDIT-1' });
  const returned = await api(base, 'POST', `/api/sales/${sale.id}/returns`, {
    session: admin,
    body: returnRequest(sale, 1),
  });
  assertStatus(returned, 201);

  const audit = await ctx.owner.query(
    'SELECT action FROM audit_log WHERE entity_type = $1 AND entity_id = $2 ORDER BY id',
    ['sale', sale.id],
  );
  assert.ok(audit.rows.some((row) => row.action === 'SALE_CREATED'));
  assert.ok(audit.rows.some((row) => row.action === 'SALE_RETURNED'));

  await assert.rejects(
    ctx.owner.query('UPDATE sale_items SET quantity = 99 WHERE sale_id = $1', [sale.id]),
    /append-only/,
  );
  await assert.rejects(
    ctx.owner.query('UPDATE sales SET total_cents = 1 WHERE id = $1', [sale.id]),
    /immutable/,
  );
  await assert.rejects(
    ctx.owner.query('DELETE FROM sales WHERE id = $1', [sale.id]),
    /cannot be deleted/i,
  );
  await assert.rejects(
    ctx.owner.query('UPDATE sale_returns SET total_cents = 0 WHERE sale_id = $1', [sale.id]),
    /append-only/,
  );
});
