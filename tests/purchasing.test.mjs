import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  api,
  assertStatus,
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

async function supplier(admin, name = 'Northstar Parts') {
  const response = await api(base, 'POST', '/api/suppliers', {
    session: admin,
    body: {
      name,
      contactName: 'Elena Bautista',
      phone: '555-0100',
      email: 'sales@example.test',
      address: '12 Example St.',
      notes: 'Test supplier',
    },
  });
  assertStatus(response, 201, 'create supplier');
  return response.body;
}

async function product(admin, sku = 'PO-PRODUCT', stockOnHand = 0) {
  const category = await createCategory(base, admin, `Category ${sku}`);
  return createProduct(base, admin, {
    sku,
    categoryId: category.id,
    costCents: 5000,
    priceCents: 8000,
    stockOnHand,
    reorderLevel: 2,
  });
}

async function createPo(admin, supplierId, lines, expectedAt = '2026-11-01') {
  const response = await api(base, 'POST', '/api/purchasing/orders', {
    session: admin,
    body: { supplierId, expectedAt, notes: 'Test order', lines },
  });
  assertStatus(response, 201, 'create PO');
  return response.body;
}

async function orderPo(admin, poId) {
  const response = await api(base, 'POST', `/api/purchasing/orders/${poId}/order`, { session: admin });
  assertStatus(response, 200, 'order PO');
  return response.body;
}

async function receivePo(admin, poId, items, clientRequestId = `receive-${Math.random().toString(36).slice(2)}`) {
  return api(base, 'POST', `/api/purchasing/orders/${poId}/receive`, {
    session: admin,
    body: { clientRequestId, items, note: 'Delivery' },
  });
}

test('supplier CRUD rejects duplicate names and supports archiving', async () => {
  const admin = await setupAdmin(base);
  const created = await supplier(admin);
  assert.equal(created.name, 'Northstar Parts');
  assert.equal(created.active, true);

  const duplicate = await api(base, 'POST', '/api/suppliers', {
    session: admin,
    body: { name: 'northstar parts' },
  });
  assertStatus(duplicate, 409);
  assert.equal(duplicate.body.error.code, 'DUPLICATE_SUPPLIER');

  const updated = await api(base, 'PUT', `/api/suppliers/${created.id}`, {
    session: admin,
    body: { ...created, name: 'Northstar Parts Trading', phone: '555-0199' },
  });
  assertStatus(updated, 200);
  assert.equal(updated.body.phone, '555-0199');

  const archived = await api(base, 'POST', `/api/suppliers/${created.id}/archive`, { session: admin });
  assertStatus(archived, 200);
  assert.equal(archived.body.active, false);
  const active = await api(base, 'GET', '/api/suppliers', { session: admin });
  assertStatus(active, 200);
  assert.equal(active.body.length, 0);
  const all = await api(base, 'GET', '/api/suppliers?includeInactive=true', { session: admin });
  assertStatus(all, 200);
  assert.equal(all.body.length, 1);

  const restore = await api(base, 'POST', `/api/suppliers/${created.id}/restore`, { session: admin });
  assertStatus(restore, 200);
  assert.equal(restore.body.active, true);
});

test('purchase order lifecycle: draft, order, partial receipt, full receipt, and stock valuation', async () => {
  const admin = await setupAdmin(base);
  const vendor = await supplier(admin);
  const item = await product(admin, 'PO-LIFECYCLE');

  const po = await createPo(admin, vendor.id, [
    { productId: item.id, orderedQty: 10, unitCostCents: 5500 },
  ]);
  assert.equal(po.status, 'DRAFT');
  assert.equal(po.number.startsWith('PO-'), true);
  assert.equal(po.orderedTotalCents, 55000);
  assert.equal(po.lines[0].orderedQty, 10);
  assert.equal(po.supplierName, 'Northstar Parts');

  const placed = await orderPo(admin, po.id);
  assert.equal(placed.status, 'ORDERED');
  assert.equal(placed.lines[0].receivedQty, 0);

  const body = {
    clientRequestId: 'receive-idempotent-0001',
    items: [{ lineId: placed.lines[0].id, quantity: 4 }],
    note: 'First delivery',
  };
  const first = await api(base, 'POST', `/api/purchasing/orders/${po.id}/receive`, {
    session: admin,
    body,
  });
  assertStatus(first, 201);
  assert.equal(first.body.number.startsWith('GR-'), true);
  assert.equal(first.body.order.status, 'PARTIALLY_RECEIVED');
  assert.equal(first.body.order.receivedTotalCents, 22000);
  assert.equal(first.body.order.progress, 40);

  const stockAfterFirst = await getProduct(base, admin, item.id);
  assert.equal(stockAfterFirst.stockOnHand, 4);
  assert.equal(stockAfterFirst.stockValueCents, 22000);
  assert.equal(stockAfterFirst.wacCents, 5500);

  const replay = await api(base, 'POST', `/api/purchasing/orders/${po.id}/receive`, {
    session: admin,
    body,
  });
  assertStatus(replay, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.number, first.body.number);
  assert.equal((await getProduct(base, admin, item.id)).stockOnHand, 4);

  const over = await receivePo(admin, po.id, [{ lineId: placed.lines[0].id, quantity: 7 }], 'receive-over-0001');
  assertStatus(over, 422);
  assert.equal(over.body.error.code, 'OVER_RECEIVE');

  const final = await receivePo(admin, po.id, [{ lineId: placed.lines[0].id, quantity: 6 }], 'receive-final-0001');
  assertStatus(final, 201);
  assert.equal(final.body.order.status, 'RECEIVED');
  assert.equal(final.body.order.receivedTotalCents, 55000);
  assert.equal(final.body.order.progress, 100);

  const stockAfterAll = await getProduct(base, admin, item.id);
  assert.equal(stockAfterAll.stockOnHand, 10);
  assert.equal(stockAfterAll.stockValueCents, 55000);
  assert.equal(stockAfterAll.wacCents, 5500);

  const again = await receivePo(admin, po.id, [{ lineId: placed.lines[0].id, quantity: 1 }], 'receive-again-0001');
  assertStatus(again, 409);
  assert.equal(again.body.error.code, 'PO_NOT_RECEIVABLE');

  const movements = await api(base, 'GET', `/api/inventory/movements?productId=${item.id}`, { session: admin });
  assertStatus(movements, 200);
  const receipts = movements.body.filter((row) => row.type === 'RECEIPT');
  assert.equal(receipts.length, 2);
  assert.equal(receipts[0].reference.startsWith('GR-'), true);

  const audit = await ctx.owner.query(
    "SELECT action FROM audit_log WHERE entity_type = 'purchase_order' AND entity_id = $1 ORDER BY id",
    [po.id],
  );
  assert.ok(audit.rows.some((row) => row.action === 'PURCHASE_ORDER_CREATED'));
  assert.ok(audit.rows.some((row) => row.action === 'PURCHASE_ORDER_PLACED'));
  assert.ok(audit.rows.some((row) => row.action === 'PURCHASE_ORDER_RECEIVED'));
});

test('ordered purchase lines are immutable and drafts can be edited', async () => {
  const admin = await setupAdmin(base);
  const vendor = await supplier(admin);
  const item = await product(admin, 'PO-EDIT');
  const po = await createPo(admin, vendor.id, [{ productId: item.id, orderedQty: 5, unitCostCents: 5000 }]);

  const editDraft = await api(base, 'PUT', `/api/purchasing/orders/${po.id}`, {
    session: admin,
    body: {
      ...po,
      lines: [{ productId: item.id, orderedQty: 8, unitCostCents: 4500 }],
    },
  });
  assertStatus(editDraft, 200);
  assert.equal(editDraft.body.orderedTotalCents, 36000);

  await orderPo(admin, po.id);
  const editOrdered = await api(base, 'PUT', `/api/purchasing/orders/${po.id}`, {
    session: admin,
    body: { ...po, lines: [{ productId: item.id, orderedQty: 9, unitCostCents: 4500 }] },
  });
  assertStatus(editOrdered, 409);
  assert.equal(editOrdered.body.error.code, 'PO_NOT_DRAFT');

  await assert.rejects(
    ctx.owner.query('UPDATE purchase_order_items SET ordered_qty = 99 WHERE purchase_order_id = $1', [po.id]),
    /Ordered quantities and costs cannot change/,
  );
  await assert.rejects(
    ctx.owner.query('DELETE FROM purchase_orders WHERE id = $1', [po.id]),
    /retained for audit/,
  );
});

test('short closing an open order prevents further receipts without changing stock', async () => {
  const admin = await setupAdmin(base);
  const vendor = await supplier(admin);
  const item = await product(admin, 'PO-SHORT');
  const po = await createPo(admin, vendor.id, [{ productId: item.id, orderedQty: 5, unitCostCents: 5000 }]);
  const placed = await orderPo(admin, po.id);
  const partial = await receivePo(admin, po.id, [{ lineId: placed.lines[0].id, quantity: 2 }], 'receive-short-0001');
  assertStatus(partial, 201);
  assert.equal((await getProduct(base, admin, item.id)).stockOnHand, 2);

  const closed = await api(base, 'POST', `/api/purchasing/orders/${po.id}/short-close`, {
    session: admin,
    body: { reason: 'Supplier can only supply two' },
  });
  assertStatus(closed, 200);
  assert.equal(closed.body.status, 'CLOSED');
  assert.equal(closed.body.shortCloseReason, 'Supplier can only supply two');
  assert.equal((await getProduct(base, admin, item.id)).stockOnHand, 2);

  const after = await receivePo(admin, po.id, [{ lineId: placed.lines[0].id, quantity: 1 }], 'receive-after-close');
  assertStatus(after, 409);
});

test('cancelling is limited to orders without receipts', async () => {
  const admin = await setupAdmin(base);
  const vendor = await supplier(admin);
  const item = await product(admin, 'PO-CANCEL');
  const po = await createPo(admin, vendor.id, [{ productId: item.id, orderedQty: 3, unitCostCents: 5000 }]);

  const cancelled = await api(base, 'POST', `/api/purchasing/orders/${po.id}/cancel`, {
    session: admin,
    body: { reason: 'Ordered by mistake' },
  });
  assertStatus(cancelled, 200);
  assert.equal(cancelled.body.status, 'CANCELLED');

  const again = await api(base, 'POST', `/api/purchasing/orders/${po.id}/cancel`, {
    session: admin,
    body: { reason: 'Again' },
  });
  assertStatus(again, 409);

  const second = await createPo(admin, vendor.id, [{ productId: item.id, orderedQty: 2, unitCostCents: 5000 }]);
  const placed = await orderPo(admin, second.id);
  const received = await receivePo(admin, second.id, [{ lineId: placed.lines[0].id, quantity: 1 }], 'cancel-receipt-1');
  assertStatus(received, 201);
  const blocked = await api(base, 'POST', `/api/purchasing/orders/${second.id}/cancel`, {
    session: admin,
    body: { reason: 'Too late' },
  });
  assertStatus(blocked, 409);
  assert.equal(blocked.body.error.code, 'PO_HAS_RECEIPTS');
});

test('archived suppliers cannot receive new purchase orders', async () => {
  const admin = await setupAdmin(base);
  const vendor = await supplier(admin);
  const item = await product(admin, 'PO-ARCHIVED');
  const archived = await api(base, 'POST', `/api/suppliers/${vendor.id}/archive`, { session: admin });
  assertStatus(archived, 200);
  const response = await api(base, 'POST', '/api/purchasing/orders', {
    session: admin,
    body: {
      supplierId: vendor.id,
      expectedAt: null,
      notes: '',
      lines: [{ productId: item.id, orderedQty: 1, unitCostCents: 5000 }],
    },
  });
  assertStatus(response, 400);
  assert.match(response.body.error.message, /active supplier/i);
});

test('purchase receipts are listed and appear in the purchasing report', async () => {
  const admin = await setupAdmin(base);
  const vendor = await supplier(admin);
  const item = await product(admin, 'PO-REPORT');
  const po = await createPo(admin, vendor.id, [{ productId: item.id, orderedQty: 2, unitCostCents: 5000 }]);
  const placed = await orderPo(admin, po.id);
  const received = await receivePo(admin, po.id, [{ lineId: placed.lines[0].id, quantity: 2 }], 'report-receipt-1');
  assertStatus(received, 201);

  const receipts = await api(base, 'GET', `/api/purchasing/receipts?poId=${po.id}`, { session: admin });
  assertStatus(receipts, 200);
  assert.equal(receipts.body.length, 1);
  assert.equal(receipts.body[0].purchaseOrderNumber, po.number);
  assert.equal(receipts.body[0].totalCents, 10000);

  const report = await api(base, 'GET', '/api/reports/purchasing', { session: admin });
  assertStatus(report, 200);
  assert.equal(report.body.length, 1);
  assert.equal(report.body[0].number, po.number);
  assert.equal(report.body[0].status, 'RECEIVED');
});
