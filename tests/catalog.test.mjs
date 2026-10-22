import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  api,
  assertStatus,
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

test('product CRUD records opening stock with an OPENING movement', async () => {
  const admin = await setupAdmin(base);
  const category = await createCategory(base, admin, 'Engine');
  const product = await createProduct(base, admin, {
    sku: 'OF-100',
    name: 'Oil Filter',
    categoryId: category.id,
    costCents: 6000,
    priceCents: 10000,
    stockOnHand: 12,
    reorderLevel: 3,
  });
  assert.equal(product.stockOnHand, 12);
  assert.equal(product.stockValueCents, 72000);
  assert.equal(product.wacCents, 6000);

  const movements = await api(base, 'GET', `/api/inventory/movements?productId=${product.id}`, { session: admin });
  assertStatus(movements, 200);
  assert.equal(movements.body.length, 1);
  assert.equal(movements.body[0].type, 'OPENING');
  assert.equal(movements.body[0].quantityDelta, 12);
  assert.equal(movements.body[0].stockAfter, 12);

  const updated = await api(base, 'PUT', `/api/catalog/products/${product.id}`, {
    session: admin,
    body: {
      sku: 'OF-100',
      barcode: '4801234567890',
      name: 'Oil Filter Premium',
      description: 'Updated',
      categoryId: category.id,
      costCents: 6500,
      priceCents: 11000,
      reorderLevel: 4,
    },
  });
  assertStatus(updated, 200);
  assert.equal(updated.body.name, 'Oil Filter Premium');
  assert.equal(updated.body.priceCents, 11000);
  assert.equal(updated.body.stockOnHand, 12);
  assert.equal(updated.body.stockValueCents, 72000);

  const lookupSku = await api(base, 'GET', '/api/catalog/products/lookup?code=of-100', { session: admin });
  assertStatus(lookupSku, 200);
  assert.equal(lookupSku.body.id, product.id);

  const lookupBarcode = await api(base, 'GET', '/api/catalog/products/lookup?code=4801234567890', { session: admin });
  assertStatus(lookupBarcode, 200);
  assert.equal(lookupBarcode.body.id, product.id);
});

test('duplicate SKUs and barcodes are rejected case-insensitively', async () => {
  const admin = await setupAdmin(base);
  const category = await createCategory(base, admin);
  const first = await createProduct(base, admin, { sku: 'DUP-1', categoryId: category.id });
  assert.ok(first.id);

  const duplicateSku = await api(base, 'POST', '/api/catalog/products', {
    session: admin,
    body: { sku: 'dup-1', name: 'Another', categoryId: category.id, costCents: 1, priceCents: 2, stockOnHand: 0 },
  });
  assertStatus(duplicateSku, 409);
  assert.equal(duplicateSku.body.error.code, 'DUPLICATE_SKU');

  const second = await api(base, 'POST', '/api/catalog/products', {
    session: admin,
    body: { sku: 'DUP-2', barcode: 'BC-123', name: 'Second', categoryId: category.id, costCents: 1, priceCents: 2, stockOnHand: 0 },
  });
  assertStatus(second, 201);

  const duplicateBarcode = await api(base, 'POST', '/api/catalog/products', {
    session: admin,
    body: { sku: 'DUP-3', barcode: 'bc-123', name: 'Third', categoryId: category.id, costCents: 1, priceCents: 2, stockOnHand: 0 },
  });
  assertStatus(duplicateBarcode, 409);
  assert.equal(duplicateBarcode.body.error.code, 'DUPLICATE_BARCODE');
});

test('invalid catalog input is rejected with field errors', async () => {
  const admin = await setupAdmin(base);
  const category = await createCategory(base, admin);
  const cases = [
    { sku: '', name: 'No SKU', categoryId: category.id, costCents: 1, priceCents: 2 },
    { sku: 'NEG-1', name: '', categoryId: category.id, costCents: 1, priceCents: 2 },
    { sku: 'NEG-2', name: 'Negative cost', categoryId: category.id, costCents: -1, priceCents: 2 },
    { sku: 'NEG-3', name: 'Negative stock', categoryId: category.id, costCents: 1, priceCents: 2, stockOnHand: -5 },
    { sku: 'NEG-4', name: 'Bad category', categoryId: 99999, costCents: 1, priceCents: 2 },
  ];
  for (const body of cases) {
    const response = await api(base, 'POST', '/api/catalog/products', { session: admin, body });
    assertStatus(response, 400, JSON.stringify(body));
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  }
});

test('stock adjustments change quantity and weighted value atomically', async () => {
  const admin = await setupAdmin(base);
  const category = await createCategory(base, admin);
  const product = await createProduct(base, admin, {
    sku: 'ADJ-1',
    categoryId: category.id,
    costCents: 6000,
    priceCents: 10000,
    stockOnHand: 10,
  });

  const add = await api(base, 'POST', `/api/inventory/${product.id}/adjust`, {
    session: admin,
    body: { delta: 5, unitCostCents: 7000, reason: 'Found extra stock' },
  });
  assertStatus(add, 201);
  assert.equal(add.body.product.stockOnHand, 15);
  assert.equal(add.body.product.stockValueCents, 95000);
  assert.equal(add.body.movement.type, 'ADJUSTMENT');
  assert.equal(add.body.movement.quantityDelta, 5);

  const remove = await api(base, 'POST', `/api/inventory/${product.id}/adjust`, {
    session: admin,
    body: { delta: -2, reason: 'Damaged' },
  });
  assertStatus(remove, 201);
  assert.equal(remove.body.product.stockOnHand, 13);
  assert.equal(remove.body.product.stockValueCents, 82333);

  const tooMany = await api(base, 'POST', `/api/inventory/${product.id}/adjust`, {
    session: admin,
    body: { delta: -100, reason: 'Impossible' },
  });
  assertStatus(tooMany, 422);
  assert.equal(tooMany.body.error.code, 'INSUFFICIENT_STOCK');

  const zero = await api(base, 'POST', `/api/inventory/${product.id}/adjust`, {
    session: admin,
    body: { delta: 0, reason: 'Nothing' },
  });
  assertStatus(zero, 400);

  const noReason = await api(base, 'POST', `/api/inventory/${product.id}/adjust`, {
    session: admin,
    body: { delta: 1, reason: '' },
  });
  assertStatus(noReason, 400);

  const final = await getProduct(base, admin, product.id);
  assert.equal(final.stockOnHand, 13);
});

test('cashiers can read stock but never receive cost or stock value', async () => {
  const admin = await setupAdmin(base);
  const cashier = await createCashier(base, admin);
  const category = await createCategory(base, admin);
  const product = await createProduct(base, admin, { sku: 'HIDE-1', categoryId: category.id });

  const list = await api(base, 'GET', '/api/catalog/products', { session: cashier.session });
  assertStatus(list, 200);
  const found = list.body.find((row) => row.id === product.id);
  assert.ok(found);
  assert.equal(found.costCents, undefined);
  assert.equal(found.stockValueCents, undefined);
  assert.equal(found.wacCents, undefined);
  assert.equal(found.stockOnHand, 10);

  const detail = await api(base, 'GET', `/api/catalog/products/${product.id}`, { session: cashier.session });
  assertStatus(detail, 200);
  assert.equal(detail.body.costCents, undefined);

  const adminList = await api(base, 'GET', '/api/catalog/products', { session: admin });
  assertStatus(adminList, 200);
  assert.equal(adminList.body.find((row) => row.id === product.id).costCents, 6000);
});

test('categories with active products cannot be archived; archived products can be restored', async () => {
  const admin = await setupAdmin(base);
  const category = await createCategory(base, admin, 'Filters');
  const product = await createProduct(base, admin, { sku: 'ARCH-1', categoryId: category.id });

  const blocked = await api(base, 'POST', `/api/catalog/categories/${category.id}/archive`, { session: admin });
  assertStatus(blocked, 409);
  assert.equal(blocked.body.error.code, 'CATEGORY_IN_USE');

  const archived = await api(base, 'POST', `/api/catalog/products/${product.id}/archive`, { session: admin });
  assertStatus(archived, 200);
  assert.equal(archived.body.active, false);

  const hidden = await api(base, 'GET', '/api/catalog/products', { session: admin });
  assertStatus(hidden, 200);
  assert.equal(hidden.body.some((row) => row.id === product.id), false);
  const visible = await api(base, 'GET', '/api/catalog/products?includeInactive=true', { session: admin });
  assertStatus(visible, 200);
  assert.equal(visible.body.some((row) => row.id === product.id), true);

  const categoryArchive = await api(base, 'POST', `/api/catalog/categories/${category.id}/archive`, { session: admin });
  assertStatus(categoryArchive, 200);

  const restore = await api(base, 'POST', `/api/catalog/products/${product.id}/restore`, { session: admin });
  assertStatus(restore, 200);
  assert.equal(restore.body.active, true);
});

test('low-stock list includes low products and hides cost from cashiers', async () => {
  const admin = await setupAdmin(base);
  const cashier = await createCashier(base, admin);
  const category = await createCategory(base, admin);
  const low = await createProduct(base, admin, {
    sku: 'LOW-1',
    categoryId: category.id,
    stockOnHand: 1,
    reorderLevel: 3,
  });
  await createProduct(base, admin, {
    sku: 'HIGH-1',
    categoryId: category.id,
    stockOnHand: 20,
    reorderLevel: 3,
  });

  const adminList = await api(base, 'GET', '/api/inventory/low-stock', { session: admin });
  assertStatus(adminList, 200);
  assert.equal(adminList.body.length, 1);
  assert.equal(adminList.body[0].id, low.id);
  assert.equal(adminList.body[0].costCents, 6000);

  const cashierList = await api(base, 'GET', '/api/inventory/low-stock', { session: cashier.session });
  assertStatus(cashierList, 200);
  assert.equal(cashierList.body.length, 1);
  assert.equal(cashierList.body[0].costCents, undefined);

  const dashboard = await api(base, 'GET', '/api/dashboard', { session: cashier.session });
  assertStatus(dashboard, 200);
  assert.equal(dashboard.body.lowStock[0].costCents, undefined);
});

test('bootstrap returns the approved shop state without leaking costs to cashiers', async () => {
  const admin = await setupAdmin(base);
  const cashier = await createCashier(base, admin);
  const category = await createCategory(base, admin);
  await createProduct(base, admin, { sku: 'BOOT-1', categoryId: category.id });

  const adminBoot = await api(base, 'GET', '/api/bootstrap', { session: admin });
  assertStatus(adminBoot, 200);
  assert.equal(adminBoot.body.user.role, 'ADMIN');
  assert.equal(adminBoot.body.products[0].costCents, 6000);
  assert.equal(adminBoot.body.users.length, 2);
  assert.equal(adminBoot.body.meta.dataSource, 'PostgreSQL via Express API');

  const cashierBoot = await api(base, 'GET', '/api/bootstrap', { session: cashier.session });
  assertStatus(cashierBoot, 200);
  assert.equal(cashierBoot.body.user.role, 'CASHIER');
  assert.equal(cashierBoot.body.products[0].costCents, undefined);
  assert.equal(cashierBoot.body.users.length, 1);
  assert.deepEqual(cashierBoot.body.suppliers, []);
  assert.deepEqual(cashierBoot.body.purchaseOrders, []);
});
