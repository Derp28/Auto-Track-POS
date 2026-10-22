import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  api,
  assertStatus,
  cartLine,
  checkout,
  createCategory,
  createProduct,
  setupAdmin,
  startTestServer,
} from './helpers.mjs';
import { query } from '../server/db.js';

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

async function fixture(admin) {
  const category = await createCategory(base, admin, 'Constraints');
  const product = await createProduct(base, admin, {
    sku: 'CON-1', categoryId: category.id, costCents: 6000, priceCents: 10000, stockOnHand: 5,
  });
  return { category, product };
}

test('product check, foreign-key, and unique constraints reject corrupt rows', async () => {
  const admin = await setupAdmin(base);
  const { category } = await fixture(admin);

  const baseProduct = {
    sku: 'DIRECT-1',
    name: 'Direct Product',
    category_id: category.id,
    cost_cents: 100,
    price_cents: 200,
    stock_on_hand: 1,
    stock_value_cents: 100,
  };
  const invalid = [
    { ...baseProduct, cost_cents: -1 },
    { ...baseProduct, price_cents: -1 },
    { ...baseProduct, stock_on_hand: -1 },
    { ...baseProduct, stock_value_cents: -1 },
    { ...baseProduct, stock_on_hand: 0, stock_value_cents: 100 },
    { ...baseProduct, category_id: 9999999 },
    { ...baseProduct, sku: '   ' },
  ];
  for (const row of invalid) {
    await assert.rejects(
      ctx.owner.query(
        `INSERT INTO products (sku, name, category_id, cost_cents, price_cents, stock_on_hand, stock_value_cents)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [row.sku, row.name, row.category_id, row.cost_cents, row.price_cents, row.stock_on_hand, row.stock_value_cents],
      ),
      (error) => ['23514', '23503', '23502'].includes(error.code),
      JSON.stringify(row),
    );
  }

  await assert.rejects(
    ctx.owner.query(
      `INSERT INTO products (sku, name, category_id, cost_cents, price_cents, stock_on_hand, stock_value_cents)
       VALUES ('con-1', 'Duplicate case', $1, 100, 200, 0, 0)`,
      [category.id],
    ),
    (error) => error.code === '23505',
  );
});

test('sale, payment, refund, movement, and settings constraints reject invalid financial state', async () => {
  const admin = await setupAdmin(base);
  const { product } = await fixture(admin);
  const sale = await checkout(base, admin, {
    clientRequestId: 'constraint-sale-0001',
    lines: [cartLine(product.id, 1)],
    payments: [{ method: 'CASH', amountCents: 10000, tenderedCents: 10000 }],
  });
  assertStatus(sale, 201);
  const saleId = sale.body.sale.id;
  const cashierId = admin.user.id;

  const invalidSales = [
    { subtotal: 100, discount: 0, net: 100, tax: 50, total: 100 },
    { subtotal: 100, discount: 200, net: 0, tax: 0, total: 0 },
    { subtotal: 100, discount: 0, net: 90, tax: 10, total: 100 },
    { subtotal: 100, discount: 0, net: 100, tax: 0, total: 0 },
  ];
  for (const [index, values] of invalidSales.entries()) {
    await assert.rejects(
      ctx.owner.query(
        `INSERT INTO sales (number, cashier_id, cashier_name, terminal_label, subtotal_cents,
           discount_cents, net_cents, tax_cents, total_cents, tax_rate_bps, tax_inclusive,
           business_date, client_request_id, payload_hash)
         VALUES ($1, $2, 'Owner', 'Counter 1', $3, $4, $5, $6, $7, 0, FALSE,
           current_date, $8, repeat('a', 64))`,
        [
          `BAD-${index}`, cashierId, values.subtotal, values.discount,
          values.net, values.tax, values.total, `bad-request-${index}`,
        ],
      ),
      (error) => error.code === '23514',
      JSON.stringify(values),
    );
  }

  await assert.rejects(
    ctx.owner.query(
      `INSERT INTO sale_payments (sale_id, method, amount_cents, tendered_cents, change_cents, created_by)
       VALUES ($1, 'CASH', 1000, 500, 500, $2)`,
      [saleId, cashierId],
    ),
    (error) => error.code === '23514',
  );
  await assert.rejects(
    ctx.owner.query(
      `INSERT INTO sale_payments (sale_id, method, amount_cents, tendered_cents, change_cents, created_by)
       VALUES ($1, 'BITCOIN', 1000, 1000, 0, $2)`,
      [saleId, cashierId],
    ),
    (error) => error.code === '23514',
  );
  await assert.rejects(
    ctx.owner.query(
      `INSERT INTO refunds (sale_id, method, amount_cents, created_by)
       VALUES ($1, 'CASH', 1000, $2)`,
      [saleId, cashierId],
    ),
    (error) => error.code === '23514',
  );

  await assert.rejects(
    ctx.owner.query(
      `INSERT INTO stock_movements (product_id, movement_type, quantity_delta, stock_before,
         stock_after, value_delta_cents, value_before_cents, value_after_cents, business_date, reason, actor_id)
       VALUES ($1, 'ADJUSTMENT', 0, 1, 1, 0, 100, 100, current_date, 'zero', $2)`,
      [product.id, cashierId],
    ),
    (error) => error.code === '23514',
  );
  await assert.rejects(
    ctx.owner.query(
      `INSERT INTO stock_movements (product_id, movement_type, quantity_delta, stock_before,
         stock_after, value_delta_cents, value_before_cents, value_after_cents, business_date, reason, actor_id)
       VALUES ($1, 'ADJUSTMENT', 1, 1, 5, 100, 100, 200, current_date, 'mismatch', $2)`,
      [product.id, cashierId],
    ),
    (error) => error.code === '23514',
  );

  await assert.rejects(
    ctx.owner.query('UPDATE settings SET allow_negative_stock = TRUE WHERE id = 1'),
    (error) => error.code === '23514',
  );
});

test('purchase order totals and line quantities are constrained', async () => {
  const admin = await setupAdmin(base);
  const { product } = await fixture(admin);
  const supplier = await api(base, 'POST', '/api/suppliers', {
    session: admin,
    body: { name: 'Constraint Supplier' },
  });
  assertStatus(supplier, 201);
  const po = await api(base, 'POST', '/api/purchasing/orders', {
    session: admin,
    body: {
      supplierId: supplier.body.id,
      expectedAt: null,
      notes: '',
      lines: [{ productId: product.id, orderedQty: 10, unitCostCents: 5000 }],
    },
  });
  assertStatus(po, 201);
  const lineId = po.body.lines[0].id;

  await assert.rejects(
    ctx.owner.query('UPDATE purchase_order_items SET received_qty = 11 WHERE id = $1', [lineId]),
    (error) => error.code === '23514',
  );
  await assert.rejects(
    ctx.owner.query('UPDATE purchase_order_items SET ordered_total_cents = 1 WHERE id = $1', [lineId]),
    (error) => error.code === '23514',
  );
});

test('append-only tables reject direct modification even for the owner role', async () => {
  const admin = await setupAdmin(base);
  const { product } = await fixture(admin);
  const sale = await checkout(base, admin, {
    clientRequestId: 'append-only-sale-1',
    lines: [cartLine(product.id, 1)],
    payments: [{ method: 'CASH', amountCents: 10000, tenderedCents: 10000 }],
  });
  assertStatus(sale, 201);

  await assert.rejects(
    ctx.owner.query("UPDATE audit_log SET action = 'TAMPERED' WHERE id = (SELECT min(id) FROM audit_log)"),
    /append-only/,
  );
  await assert.rejects(
    ctx.owner.query('DELETE FROM audit_log'),
    /append-only/,
  );
  await assert.rejects(
    ctx.owner.query("UPDATE stock_movements SET quantity_delta = 99 WHERE id = (SELECT min(id) FROM stock_movements)"),
    /append-only/,
  );
  await assert.rejects(
    ctx.owner.query('DELETE FROM stock_movements'),
    /append-only/,
  );
  await assert.rejects(
    ctx.owner.query('UPDATE sale_payments SET amount_cents = 1 WHERE sale_id = $1', [sale.body.sale.id]),
    /append-only/,
  );
  await assert.rejects(
    ctx.owner.query('DELETE FROM sale_payments WHERE sale_id = $1', [sale.body.sale.id]),
    /append-only/,
  );
});

test('the runtime database role cannot create objects or alter/delete audit history', async () => {
  await setupAdmin(base);
  await assert.rejects(
    query('CREATE TABLE runtime_should_not_create (id integer)'),
    /permission denied/i,
  );
  await assert.rejects(
    query("UPDATE audit_log SET action = 'tampered'"),
    /permission denied|append-only/i,
  );
  await assert.rejects(
    query('DELETE FROM audit_log'),
    /permission denied|append-only/i,
  );
  await assert.rejects(
    query('DELETE FROM sales'),
    /permission denied|cannot be deleted/i,
  );
  const readable = await query('SELECT count(*)::int AS n FROM audit_log');
  assert.ok(readable.rows[0].n >= 1);
});

test('API security headers, cookie flags, malformed JSON, and oversized payloads are safe', async () => {
  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('x-powered-by'), null);
  assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(health.headers.get('x-frame-options'), 'DENY');
  assert.equal(health.headers.get('referrer-policy'), 'no-referrer');
  assert.match(health.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(health.headers.get('cache-control'), 'no-store');

  const admin = await setupAdmin(base);
  const loginResponse = await api(base, 'POST', '/api/auth/login', {
    body: { username: 'owner', password: admin.password },
  });
  assertStatus(loginResponse, 200);
  const cookie = loginResponse.setCookies.join(';');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\//);
  assert.equal(/Secure/.test(cookie), false);

  const malformed = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"username":',
  });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, 'INVALID_JSON');

  const oversized = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'owner', password: 'x'.repeat(300 * 1024) }),
  });
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).error.code, 'PAYLOAD_TOO_LARGE');

  const unknown = await fetch(`${base}/api/does-not-exist`);
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).error.code, 'NOT_FOUND');
});

test('expired sessions are refused by the server', async () => {
  const admin = await setupAdmin(base);
  const before = await api(base, 'GET', '/api/auth/me', { session: admin });
  assertStatus(before, 200);
  await ctx.owner.query(
    `UPDATE sessions SET idle_expires_at = now() - interval '1 minute',
       absolute_expires_at = now() - interval '1 minute' WHERE user_id = $1`,
    [admin.user.id],
  );
  const after = await api(base, 'GET', '/api/auth/me', { session: admin });
  assertStatus(after, 401);
  await assert.rejects(
    query('DELETE FROM sessions WHERE user_id = $1', [admin.user.id]),
    (error) => error.code === '42501' || /permission denied/i.test(error.message),
  );
});
