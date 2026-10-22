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
  setTax,
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

async function seed(admin, { priceCents = 10000, costCents = 6000, stockOnHand = 10, sku = 'SALE-1' } = {}) {
  const category = await createCategory(base, admin);
  return createProduct(base, admin, { sku, categoryId: category.id, priceCents, costCents, stockOnHand });
}

test('checkout computes exclusive tax after line discount and stores exact payments', async () => {
  const admin = await setupAdmin(base);
  await setTax(base, admin, { enabled: true, rateBps: 1200, inclusive: false });
  const product = await seed(admin);

  const response = await checkout(base, admin, {
    lines: [cartLine(product.id, 2, { discountBps: 1000, discountReason: 'Loyalty' })],
    payments: [{ method: 'CASH', amountCents: 20160, tenderedCents: 25000 }],
  });
  assertStatus(response, 201);
  const sale = response.body.sale;
  assert.equal(sale.subtotalCents, 20000);
  assert.equal(sale.discountCents, 2000);
  assert.equal(sale.netCents, 18000);
  assert.equal(sale.taxCents, 2160);
  assert.equal(sale.totalCents, 20160);
  assert.equal(sale.revenueExTaxCents, 18000);
  assert.equal(sale.taxRateBps, 1200);
  assert.equal(sale.taxInclusive, false);
  assert.equal(sale.payments[0].changeCents, 25000 - 20160);
  assert.equal(sale.items[0].discountReason, 'Loyalty');
  assert.equal(sale.items[0].costValueCents, 12000);

  const after = await getProduct(base, admin, product.id);
  assert.equal(after.stockOnHand, 8);
  assert.equal(after.stockValueCents, 48000);

  const report = await api(base, 'GET', '/api/reports/daily', { session: admin });
  assertStatus(report, 200);
  assert.equal(report.body.collectedCents, 20160);
  assert.equal(report.body.taxCents, 2160);
  assert.equal(report.body.netExTaxCents, 18000);
});

test('checkout computes inclusive tax without changing the shelf total', async () => {
  const admin = await setupAdmin(base);
  await setTax(base, admin, { enabled: true, rateBps: 1200, inclusive: true });
  const product = await seed(admin, { sku: 'SALE-INCL' });

  const response = await checkout(base, admin, {
    lines: [cartLine(product.id, 2)],
    payments: [{ method: 'CASH', amountCents: 20000, tenderedCents: 20000 }],
  });
  assertStatus(response, 201);
  const sale = response.body.sale;
  assert.equal(sale.subtotalCents, 20000);
  assert.equal(sale.netCents, 20000);
  assert.equal(sale.taxCents, 2143);
  assert.equal(sale.totalCents, 20000);
  assert.equal(sale.revenueExTaxCents, 17857);
});

test('cashier discounts above the limit require valid administrator approval', async () => {
  const admin = await setupAdmin(base);
  await setTax(base, admin, { enabled: false, rateBps: 0, inclusive: false, cashierLimitBps: 0 });
  const cashier = await createCashier(base, admin);
  const product = await seed(admin, { sku: 'SALE-DISC' });

  const noApproval = await checkout(base, cashier.session, {
    clientRequestId: 'approval-missing-1',
    lines: [cartLine(product.id, 1, { discountBps: 1000, discountReason: 'Customer request' })],
    payments: [{ method: 'CASH', amountCents: 9000 }],
  });
  assertStatus(noApproval, 403);

  const wrongApproval = await checkout(base, cashier.session, {
    clientRequestId: 'approval-wrong-1',
    lines: [cartLine(product.id, 1, { discountBps: 1000, discountReason: 'Customer request' })],
    payments: [{ method: 'CASH', amountCents: 9000 }],
    approval: { username: 'owner', password: 'WrongPassword123' },
  });
  assertStatus(wrongApproval, 403);

  const noReason = await checkout(base, cashier.session, {
    clientRequestId: 'discount-no-reason',
    lines: [cartLine(product.id, 1, { discountBps: 1000 })],
    payments: [{ method: 'CASH', amountCents: 9000 }],
    approval: { username: 'owner', password: 'CorrectHorse9Battery' },
  });
  assertStatus(noReason, 400);
  assert.equal(noReason.body.error.code, 'DISCOUNT_REASON_REQUIRED');

  const approved = await checkout(base, cashier.session, {
    clientRequestId: 'approval-ok-1',
    lines: [cartLine(product.id, 1, { discountBps: 1000, discountReason: 'Customer request' })],
    payments: [{ method: 'CASH', amountCents: 9000 }],
    approval: { username: 'owner', password: 'CorrectHorse9Battery' },
  });
  assertStatus(approved, 201);
  assert.equal(approved.body.sale.totalCents, 9000);
  assert.equal(approved.body.sale.items[0].discountApprovedBy, admin.user.id);
});

test('payment mismatch and invalid payment data are rejected before any sale is written', async () => {
  const admin = await setupAdmin(base);
  const product = await seed(admin, { sku: 'SALE-PAY' });

  const mismatch = await checkout(base, admin, {
    clientRequestId: 'payment-mismatch-1',
    lines: [cartLine(product.id, 1)],
    payments: [{ method: 'CASH', amountCents: 9999 }],
  });
  assertStatus(mismatch, 400);
  assert.equal(mismatch.body.error.code, 'PAYMENT_MISMATCH');

  const overTender = await checkout(base, admin, {
    clientRequestId: 'payment-tender-1',
    lines: [cartLine(product.id, 1)],
    payments: [{ method: 'CASH', amountCents: 10000, tenderedCents: 5000 }],
  });
  assertStatus(overTender, 400);

  const noPayments = await checkout(base, admin, {
    clientRequestId: 'payment-none-1',
    lines: [cartLine(product.id, 1)],
    payments: [],
  });
  assertStatus(noPayments, 400);

  const cardNumber = await checkout(base, admin, {
    clientRequestId: 'payment-card-1',
    lines: [cartLine(product.id, 1)],
    payments: [{ method: 'CARD_EXTERNAL', amountCents: 10000, reference: '4111 1111 1111 1111' }],
  });
  assertStatus(cardNumber, 400);
  assert.equal(cardNumber.body.error.code, 'CARD_DATA_REJECTED');

  const validCard = await checkout(base, admin, {
    clientRequestId: 'payment-card-2',
    lines: [cartLine(product.id, 1)],
    payments: [{ method: 'CARD_EXTERNAL', amountCents: 10000, reference: 'TERM-778' }],
  });
  assertStatus(validCard, 201);
  assert.equal(validCard.body.sale.payments[0].reference, 'TERM-778');

  const after = await getProduct(base, admin, product.id);
  assert.equal(after.stockOnHand, 9);
});

test('duplicate cart lines, too-large quantities, and insufficient stock are rejected', async () => {
  const admin = await setupAdmin(base);
  const product = await seed(admin, { sku: 'SALE-STOCK', stockOnHand: 1 });

  const duplicate = await checkout(base, admin, {
    clientRequestId: 'duplicate-line-1',
    lines: [cartLine(product.id, 1), cartLine(product.id, 1)],
    payments: [{ method: 'CASH', amountCents: 20000 }],
  });
  assertStatus(duplicate, 400);
  assert.equal(duplicate.body.error.code, 'DUPLICATE_LINE');

  const tooMany = await checkout(base, admin, {
    clientRequestId: 'too-many-1',
    lines: [cartLine(product.id, 1000)],
    payments: [{ method: 'CASH', amountCents: 10000000 }],
  });
  assertStatus(tooMany, 400);
  assert.equal(tooMany.body.error.code, 'MAX_QUANTITY');

  const short = await checkout(base, admin, {
    clientRequestId: 'short-stock-1',
    lines: [cartLine(product.id, 2)],
    payments: [{ method: 'CASH', amountCents: 20000 }],
  });
  assertStatus(short, 409);
  assert.equal(short.body.error.code, 'INSUFFICIENT_STOCK');

  const after = await getProduct(base, admin, product.id);
  assert.equal(after.stockOnHand, 1);
});

test('idempotency keys make duplicate submissions safe and reject payload changes', async () => {
  const admin = await setupAdmin(base);
  const product = await seed(admin, { sku: 'SALE-IDEMP', stockOnHand: 10 });
  const payload = {
    clientRequestId: 'idempotent-sale-1234',
    lines: [cartLine(product.id, 2)],
    payments: [{ method: 'CASH', amountCents: 20000, tenderedCents: 20000 }],
  };
  const first = await checkout(base, admin, payload);
  assertStatus(first, 201);
  const replay = await checkout(base, admin, payload);
  assertStatus(replay, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.sale.id, first.body.sale.id);
  assert.equal(replay.body.sale.number, first.body.sale.number);

  const changed = await checkout(base, admin, {
    ...payload,
    lines: [cartLine(product.id, 3)],
    payments: [{ method: 'CASH', amountCents: 30000 }],
  });
  assertStatus(changed, 409);
  assert.equal(changed.body.error.code, 'IDEMPOTENCY_CONFLICT');

  const after = await getProduct(base, admin, product.id);
  assert.equal(after.stockOnHand, 8);
  const sales = await api(base, 'GET', '/api/sales', { session: admin });
  assertStatus(sales, 200);
  assert.equal(sales.body.length, 1);
});

test('concurrent cashiers cannot oversell the last unit', async () => {
  const admin = await setupAdmin(base);
  const cashier1 = await createCashier(base, admin, { username: 'cashier1' });
  const cashier2 = await createCashier(base, admin, { username: 'cashier2' });
  const product = await seed(admin, { sku: 'SALE-RACE', stockOnHand: 1 });

  const [a, b] = await Promise.all([
    checkout(base, cashier1.session, {
      clientRequestId: 'race-request-1',
      lines: [cartLine(product.id, 1)],
      payments: [{ method: 'CASH', amountCents: 10000 }],
    }),
    checkout(base, cashier2.session, {
      clientRequestId: 'race-request-2',
      lines: [cartLine(product.id, 1)],
      payments: [{ method: 'CASH', amountCents: 10000 }],
    }),
  ]);
  const statuses = [a.status, b.status].sort((x, y) => x - y);
  assert.deepEqual(statuses, [201, 409]);
  const conflict = a.status === 409 ? a.body : b.body;
  assert.equal(conflict.error.code, 'INSUFFICIENT_STOCK');

  const after = await getProduct(base, admin, product.id);
  assert.equal(after.stockOnHand, 0);
  assert.equal(after.stockValueCents, 0);
  const sales = await api(base, 'GET', '/api/sales', { session: admin });
  assertStatus(sales, 200);
  assert.equal(sales.body.length, 1);
});

test('a failure after partial writes rolls back the entire checkout and releases the idempotency key', async () => {
  const admin = await setupAdmin(base);
  const product = await seed(admin, { sku: 'SALE-ROLLBACK', stockOnHand: 5 });
  await ctx.owner.query(`
    CREATE OR REPLACE FUNCTION test_fail_movement() RETURNS trigger AS $$
    BEGIN
      IF NEW.product_id = ${Number(product.id)} THEN
        RAISE EXCEPTION 'injected movement failure';
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;
  `);
  await ctx.owner.query('CREATE TRIGGER test_fail_movement BEFORE INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION test_fail_movement()');
  try {
    const failed = await checkout(base, admin, {
      clientRequestId: 'rollback-request-1',
      lines: [cartLine(product.id, 2)],
      payments: [{ method: 'CASH', amountCents: 20000 }],
    });
    assertStatus(failed, 500);

    const sales = await api(base, 'GET', '/api/sales', { session: admin });
    assertStatus(sales, 200);
    assert.equal(sales.body.length, 0);
    const after = await getProduct(base, admin, product.id);
    assert.equal(after.stockOnHand, 5);
    assert.equal(after.stockValueCents, 30000);
    const keys = await ctx.owner.query("SELECT count(*)::int AS n FROM idempotency_keys WHERE client_request_id = 'rollback-request-1'");
    assert.equal(keys.rows[0].n, 0);
  } finally {
    await ctx.owner.query('DROP TRIGGER IF EXISTS test_fail_movement ON stock_movements');
    await ctx.owner.query('DROP FUNCTION IF EXISTS test_fail_movement()');
  }

  const retry = await checkout(base, admin, {
    clientRequestId: 'rollback-request-1',
    lines: [cartLine(product.id, 2)],
    payments: [{ method: 'CASH', amountCents: 20000 }],
  });
  assertStatus(retry, 201);
  const after = await getProduct(base, admin, product.id);
  assert.equal(after.stockOnHand, 3);
});

test('zero-total sales are allowed without payments and still deduct stock', async () => {
  const admin = await setupAdmin(base);
  const product = await seed(admin, {
    sku: 'SALE-FREE',
    priceCents: 0,
    costCents: 0,
    stockOnHand: 3,
  });
  const response = await checkout(base, admin, {
    clientRequestId: 'free-sale-0001',
    lines: [cartLine(product.id, 1, { discountBps: 10000, discountReason: 'Promo' })],
    payments: [],
  });
  assertStatus(response, 201);
  assert.equal(response.body.sale.totalCents, 0);
  assert.equal(response.body.sale.payments.length, 0);
  const after = await getProduct(base, admin, product.id);
  assert.equal(after.stockOnHand, 2);
});

test('cashiers see only their own sales and never see cost snapshots', async () => {
  const admin = await setupAdmin(base);
  const cashier1 = await createCashier(base, admin, { username: 'cashier1' });
  const cashier2 = await createCashier(base, admin, { username: 'cashier2' });
  const product = await seed(admin, { sku: 'SALE-SCOPE', stockOnHand: 10 });

  const sale1 = await checkout(base, cashier1.session, {
    clientRequestId: 'scope-sale-0001',
    lines: [cartLine(product.id, 1)],
    payments: [{ method: 'CASH', amountCents: 10000 }],
  });
  assertStatus(sale1, 201);
  const sale2 = await checkout(base, cashier2.session, {
    clientRequestId: 'scope-sale-0002',
    lines: [cartLine(product.id, 1)],
    payments: [{ method: 'CASH', amountCents: 10000 }],
  });
  assertStatus(sale2, 201);

  const own = await api(base, 'GET', '/api/sales', { session: cashier1.session });
  assertStatus(own, 200);
  assert.equal(own.body.length, 1);
  assert.equal(own.body[0].id, sale1.body.sale.id);

  const other = await api(base, 'GET', `/api/sales/${sale2.body.sale.id}`, { session: cashier1.session });
  assertStatus(other, 404);

  const detail = await api(base, 'GET', `/api/sales/${sale1.body.sale.id}`, { session: cashier1.session });
  assertStatus(detail, 200);
  assert.equal(detail.body.cashierId, cashier1.user.id);
  assert.equal(detail.body.items[0].unitCostCents, undefined);
  assert.equal(detail.body.items[0].costValueCents, undefined);

  const adminDetail = await api(base, 'GET', `/api/sales/${sale1.body.sale.id}`, { session: admin });
  assertStatus(adminDetail, 200);
  assert.equal(adminDetail.body.items[0].unitCostCents, 6000);
  assert.equal(adminDetail.body.items[0].costValueCents, 6000);

  const adminAll = await api(base, 'GET', '/api/sales', { session: admin });
  assertStatus(adminAll, 200);
  assert.equal(adminAll.body.length, 2);
});
