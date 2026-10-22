import { query, withTransaction } from '../db.js';
import { purchaseOrderDto, supplierDto, dateString } from '../lib/dto.js';
import { badRequest, conflict, notFound, unprocessable } from '../lib/errors.js';
import { claimIdempotency, logAudit } from '../lib/ledger.js';
import { asObject, dateOnly, integer, list, text } from '../lib/validation.js';
import { applyStockChange, getBusinessDate } from './inventory.js';
import { nextDocumentNumber } from './sales.js';

function normalizeLines(rawLines) {
  const seen = new Set();
  return list(rawLines, 'lines', { min: 1, max: 100 }).map((raw, index) => {
    const line = asObject(raw, `lines[${index}]`);
    const productId = integer(line.productId, `lines[${index}].productId`, { min: 1 });
    if (seen.has(productId)) throw badRequest('Each product may appear only once on a purchase order.', 'DUPLICATE_LINE');
    seen.add(productId);
    return {
      productId,
      orderedQty: integer(line.orderedQty, `lines[${index}].orderedQty`, { min: 1, max: 1_000_000 }),
      unitCostCents: integer(line.unitCostCents, `lines[${index}].unitCostCents`, { min: 0, max: 1_000_000_000_000 }),
    };
  });
}

async function loadPo(client, poId) {
  const runner = client || { query };
  const { rows } = await runner.query(
    `SELECT po.*, s.name AS supplier_name, u.display_name AS created_by_name
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       JOIN users u ON u.id = po.created_by
      WHERE po.id = $1`,
    [poId],
  );
  const po = rows[0];
  if (!po) throw notFound('Purchase order not found.');
  const lines = await runner.query(
    `SELECT poi.*, p.sku, p.name
       FROM purchase_order_items poi JOIN products p ON p.id = poi.product_id
      WHERE poi.purchase_order_id = $1 ORDER BY poi.id`,
    [poId],
  );
  const receipts = await runner.query(
    `SELECT r.*, u.display_name AS received_by_name
       FROM po_receipts r JOIN users u ON u.id = r.received_by
      WHERE r.purchase_order_id = $1 ORDER BY r.created_at DESC, r.id DESC`,
    [poId],
  );
  const receiptIds = receipts.rows.map((row) => row.id);
  const receiptItems = receiptIds.length
    ? await runner.query(
        `SELECT ri.*, p.sku, p.name
           FROM po_receipt_items ri JOIN products p ON p.id = ri.product_id
          WHERE ri.receipt_id = ANY($1::bigint[]) ORDER BY ri.id`,
        [receiptIds],
      )
    : { rows: [] };
  const receiptDtos = receipts.rows.map((receipt) => ({
    id: receipt.number,
    number: receipt.number,
    createdAt: new Date(receipt.created_at).toISOString(),
    receivedBy: String(receipt.received_by),
    receivedByName: receipt.received_by_name,
    totalCents: Number(receipt.total_cents),
    note: receipt.note,
    items: receiptItems.rows
      .filter((item) => Number(item.receipt_id) === Number(receipt.id))
      .map((item) => ({
        lineId: String(item.po_item_id),
        productId: String(item.product_id),
        sku: item.sku,
        name: item.name,
        quantity: Number(item.quantity),
        unitCostCents: Number(item.unit_cost_cents),
        totalCents: Number(item.total_cents),
      })),
  }));
  return purchaseOrderDto(po, {
    lines: lines.rows,
    receipts: receiptDtos,
    supplier: supplierDto(
      (await runner.query('SELECT * FROM suppliers WHERE id = $1', [po.supplier_id])).rows[0],
    ),
  });
}

export async function getPurchaseOrder(poId) {
  return loadPo(null, poId);
}

export async function listPurchaseOrders({ status = '', supplierId = null, limit = 200 } = {}) {
  const { rows } = await query(
    `SELECT po.*, s.name AS supplier_name, u.display_name AS created_by_name
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       JOIN users u ON u.id = po.created_by
      WHERE ($1::text = '' OR po.status = $1)
        AND ($2::bigint IS NULL OR po.supplier_id = $2)
      ORDER BY po.created_at DESC, po.id DESC LIMIT $3`,
    [status, supplierId, limit],
  );
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const [lines, receipts] = await Promise.all([
    query(
      `SELECT poi.*, p.sku, p.name FROM purchase_order_items poi JOIN products p ON p.id = poi.product_id
        WHERE poi.purchase_order_id = ANY($1::bigint[]) ORDER BY poi.id`,
      [ids],
    ),
    query(
      `SELECT r.*, u.display_name AS received_by_name FROM po_receipts r JOIN users u ON u.id = r.received_by
        WHERE r.purchase_order_id = ANY($1::bigint[]) ORDER BY r.id`,
      [ids],
    ),
  ]);
  return rows.map((row) => {
    const poLines = lines.rows.filter((line) => Number(line.purchase_order_id) === Number(row.id));
    const poReceipts = receipts.rows
      .filter((receipt) => Number(receipt.purchase_order_id) === Number(row.id))
      .map((receipt) => ({
        id: receipt.number,
        number: receipt.number,
        createdAt: new Date(receipt.created_at).toISOString(),
        receivedBy: String(receipt.received_by),
        receivedByName: receipt.received_by_name,
        totalCents: Number(receipt.total_cents),
        note: receipt.note,
        items: [],
      }));
    return purchaseOrderDto(row, { lines: poLines, receipts: poReceipts });
  });
}

export async function createPurchaseOrder(body, actor) {
  const input = asObject(body);
  const supplierId = integer(input.supplierId, 'supplierId', { min: 1 });
  const expectedAt = dateOnly(input.expectedAt, 'expectedAt', { optional: true, fallback: null });
  const notes = text(input.notes, 'notes', { optional: true, max: 1000 });
  const lines = normalizeLines(input.lines);
  return withTransaction(async (client) => {
    const businessDate = await getBusinessDate(client);
    const supplier = await client.query('SELECT * FROM suppliers WHERE id = $1', [supplierId]);
    if (!supplier.rows[0]) throw badRequest('Choose a valid supplier.', 'VALIDATION_ERROR', { supplierId: 'Supplier not found.' });
    if (!supplier.rows[0].active) throw badRequest('Choose an active supplier.', 'VALIDATION_ERROR', { supplierId: 'Supplier is archived.' });
    const products = await client.query('SELECT id, active, name FROM products WHERE id = ANY($1::bigint[])', [lines.map((line) => line.productId)]);
    const productMap = new Map(products.rows.map((row) => [Number(row.id), row]));
    for (const line of lines) {
      const product = productMap.get(line.productId);
      if (!product) throw badRequest('A purchase product does not exist.', 'VALIDATION_ERROR');
      if (!product.active) throw badRequest(`${product.name} is archived and cannot be ordered.`, 'PRODUCT_UNAVAILABLE');
    }
    const orderedTotal = lines.reduce((sum, line) => sum + line.orderedQty * line.unitCostCents, 0);
    const number = await nextDocumentNumber(client, 'PURCHASE_ORDER', businessDate, 'PO');
    const { rows } = await client.query(
      `INSERT INTO purchase_orders (number, supplier_id, status, expected_at, notes, ordered_total_cents, created_by)
       VALUES ($1, $2, 'DRAFT', $3, $4, $5, $6) RETURNING *`,
      [number, supplierId, expectedAt, notes, orderedTotal, actor.id],
    );
    const po = rows[0];
    for (const line of lines) {
      await client.query(
        `INSERT INTO purchase_order_items (purchase_order_id, product_id, ordered_qty, unit_cost_cents, ordered_total_cents)
         VALUES ($1, $2, $3, $4, $5)`,
        [po.id, line.productId, line.orderedQty, line.unitCostCents, line.orderedQty * line.unitCostCents],
      );
    }
    await logAudit(client, {
      actorId: actor.id,
      action: 'PURCHASE_ORDER_CREATED',
      entityType: 'purchase_order',
      entityId: po.id,
      details: { number, supplierId, orderedTotalCents: orderedTotal },
    });
    return loadPo(client, po.id);
  });
}

export async function updatePurchaseOrder(poId, body, actor) {
  const input = asObject(body);
  const supplierId = integer(input.supplierId, 'supplierId', { min: 1 });
  const expectedAt = dateOnly(input.expectedAt, 'expectedAt', { optional: true, fallback: null });
  const notes = text(input.notes, 'notes', { optional: true, max: 1000 });
  const lines = normalizeLines(input.lines);
  return withTransaction(async (client) => {
    const current = await client.query('SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE', [poId]);
    if (!current.rows[0]) throw notFound('Purchase order not found.');
    if (current.rows[0].status !== 'DRAFT') throw conflict('Only draft purchase orders can be edited.', 'PO_NOT_DRAFT');
    const supplier = await client.query('SELECT active FROM suppliers WHERE id = $1', [supplierId]);
    if (!supplier.rows[0]) throw badRequest('Choose a valid supplier.', 'VALIDATION_ERROR');
    if (!supplier.rows[0].active) throw badRequest('Choose an active supplier.', 'VALIDATION_ERROR');
    const products = await client.query('SELECT id, active, name FROM products WHERE id = ANY($1::bigint[])', [lines.map((line) => line.productId)]);
    const productMap = new Map(products.rows.map((row) => [Number(row.id), row]));
    for (const line of lines) {
      const product = productMap.get(line.productId);
      if (!product) throw badRequest('A purchase product does not exist.', 'VALIDATION_ERROR');
      if (!product.active) throw badRequest(`${product.name} is archived and cannot be ordered.`, 'PRODUCT_UNAVAILABLE');
    }
    const orderedTotal = lines.reduce((sum, line) => sum + line.orderedQty * line.unitCostCents, 0);
    await client.query(
      'UPDATE purchase_orders SET supplier_id = $2, expected_at = $3, notes = $4, ordered_total_cents = $5, updated_at = now() WHERE id = $1',
      [poId, supplierId, expectedAt, notes, orderedTotal],
    );
    await client.query('DELETE FROM purchase_order_items WHERE purchase_order_id = $1', [poId]);
    for (const line of lines) {
      await client.query(
        `INSERT INTO purchase_order_items (purchase_order_id, product_id, ordered_qty, unit_cost_cents, ordered_total_cents)
         VALUES ($1, $2, $3, $4, $5)`,
        [poId, line.productId, line.orderedQty, line.unitCostCents, line.orderedQty * line.unitCostCents],
      );
    }
    await logAudit(client, {
      actorId: actor.id,
      action: 'PURCHASE_ORDER_UPDATED',
      entityType: 'purchase_order',
      entityId: poId,
      details: { orderedTotalCents: orderedTotal },
    });
    return loadPo(client, poId);
  });
}

export async function orderPurchaseOrder(poId, actor) {
  return withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE', [poId]);
    if (!rows[0]) throw notFound('Purchase order not found.');
    if (rows[0].status !== 'DRAFT') throw conflict('Only a draft order can be placed.', 'PO_NOT_DRAFT');
    const lineCount = await client.query('SELECT count(*)::int AS n FROM purchase_order_items WHERE purchase_order_id = $1', [poId]);
    if (lineCount.rows[0].n === 0) throw unprocessable('Add at least one line before ordering.', 'PO_EMPTY');
    await client.query(
      'UPDATE purchase_orders SET status = $2, ordered_at = now(), ordered_by = $3, updated_at = now() WHERE id = $1',
      [poId, 'ORDERED', actor.id],
    );
    await logAudit(client, {
      actorId: actor.id,
      action: 'PURCHASE_ORDER_PLACED',
      entityType: 'purchase_order',
      entityId: poId,
      details: { number: rows[0].number },
    });
    return loadPo(client, poId);
  });
}

export async function receivePurchaseOrder(poId, body, actor) {
  const input = asObject(body);
  const clientRequestId = text(input.clientRequestId, 'clientRequestId', { min: 8, max: 100 });
  const note = text(input.note, 'note', { optional: true, max: 500 });
  const rawItems = list(input.items, 'items', { min: 1, max: 100 });
  const seen = new Set();
  const items = rawItems.map((raw, index) => {
    const item = asObject(raw, `items[${index}]`);
    const lineId = integer(item.lineId, `items[${index}].lineId`, { min: 1 });
    if (seen.has(lineId)) throw badRequest('Each purchase line may be received once per receipt.', 'DUPLICATE_RECEIPT_LINE');
    seen.add(lineId);
    return { lineId, quantity: integer(item.quantity, `items[${index}].quantity`, { min: 1, max: 1_000_000 }) };
  });
  return withTransaction(async (client) => {
    const claim = await claimIdempotency(client, {
      key: clientRequestId,
      userId: actor.id,
      endpoint: `POST /api/purchasing/orders/${poId}/receive`,
      payload: { items, note },
    });
    if (claim.replay) return { replay: true, ...claim.response };
    const businessDate = await getBusinessDate(client);
    const poResult = await client.query('SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE', [poId]);
    const po = poResult.rows[0];
    if (!po) throw notFound('Purchase order not found.');
    if (!['ORDERED', 'PARTIALLY_RECEIVED'].includes(po.status)) {
      throw conflict('Only ordered or partially received purchase orders can be received.', 'PO_NOT_RECEIVABLE');
    }
    const lineResult = await client.query(
      'SELECT * FROM purchase_order_items WHERE purchase_order_id = $1 ORDER BY id',
      [poId],
    );
    const lines = new Map(lineResult.rows.map((row) => [Number(row.id), row]));
    const computed = [];
    for (const item of items) {
      const line = lines.get(item.lineId);
      if (!line) throw badRequest('Receipt line does not belong to this purchase order.', 'LINE_NOT_FOUND');
      const remaining = Number(line.ordered_qty) - Number(line.received_qty);
      if (item.quantity > remaining) {
        throw unprocessable(`Only ${remaining} units remain to receive on this line.`, 'OVER_RECEIVE');
      }
      computed.push({ item, line, totalCents: item.quantity * Number(line.unit_cost_cents) });
    }
    const totalCents = computed.reduce((sum, entry) => sum + entry.totalCents, 0);
    const number = await nextDocumentNumber(client, 'GOODS_RECEIPT', businessDate, 'GR');
    const receiptInsert = await client.query(
      `INSERT INTO po_receipts (number, purchase_order_id, received_by, total_cents, note, client_request_id, payload_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [number, poId, actor.id, totalCents, note, clientRequestId, claim.hash],
    );
    const receipt = receiptInsert.rows[0];
    const productIds = [...new Set(computed.map((entry) => Number(entry.line.product_id)))].sort((a, b) => a - b);
    const products = await client.query('SELECT * FROM products WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE', [productIds]);
    const productsById = new Map(products.rows.map((row) => [Number(row.id), row]));
    for (const entry of computed) {
      const product = productsById.get(Number(entry.line.product_id));
      if (!product) throw conflict('A purchase product no longer exists.', 'PRODUCT_MISSING');
      await client.query(
        `INSERT INTO po_receipt_items (receipt_id, po_item_id, product_id, quantity, unit_cost_cents, total_cents)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [receipt.id, entry.line.id, entry.line.product_id, entry.item.quantity, entry.line.unit_cost_cents, entry.totalCents],
      );
      await client.query(
        `UPDATE purchase_order_items SET received_qty = received_qty + $2,
           received_total_cents = received_total_cents + $2 * unit_cost_cents WHERE id = $1`,
        [entry.line.id, entry.item.quantity],
      );
      await client.query('UPDATE products SET cost_cents = $2 WHERE id = $1', [product.id, entry.line.unit_cost_cents]);
      product.cost_cents = entry.line.unit_cost_cents;
      await applyStockChange(client, product, {
        type: 'RECEIPT',
        quantityDelta: entry.item.quantity,
        valueDeltaCents: entry.totalCents,
        businessDate,
        referenceType: 'po_receipt',
        referenceId: receipt.id,
        referenceNumber: number,
        reason: `Received ${po.number}`,
        actorId: actor.id,
      });
    }
    const totals = await client.query(
      `SELECT COALESCE(sum(received_qty), 0)::bigint AS received,
              COALESCE(sum(ordered_qty), 0)::bigint AS ordered,
              COALESCE(sum(received_total_cents), 0)::bigint AS received_value
         FROM purchase_order_items WHERE purchase_order_id = $1`,
      [poId],
    );
    const fullyReceived = Number(totals.rows[0].received) >= Number(totals.rows[0].ordered);
    await client.query(
      `UPDATE purchase_orders SET received_total_cents = $2,
         status = $3, received_at = now(), updated_at = now() WHERE id = $1`,
      [poId, totals.rows[0].received_value, fullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED'],
    );
    await logAudit(client, {
      actorId: actor.id,
      action: 'PURCHASE_ORDER_RECEIVED',
      entityType: 'purchase_order',
      entityId: poId,
      details: { receiptNumber: number, totalCents, fullyReceived },
    });
    const response = { receiptId: String(receipt.id), number };
    await claim.complete(response);
    return { replay: false, ...response };
  });
}

export async function shortClosePurchaseOrder(poId, body, actor) {
  const input = asObject(body);
  const reason = text(input.reason, 'reason', { max: 500 });
  return withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE', [poId]);
    if (!rows[0]) throw notFound('Purchase order not found.');
    if (!['ORDERED', 'PARTIALLY_RECEIVED'].includes(rows[0].status)) {
      throw conflict('Only an open purchase order can be short-closed.', 'PO_NOT_OPEN');
    }
    const totals = await client.query(
      `SELECT COALESCE(sum(ordered_qty - received_qty), 0)::bigint AS remaining
         FROM purchase_order_items WHERE purchase_order_id = $1`,
      [poId],
    );
    if (Number(totals.rows[0].remaining) === 0) throw conflict('Everything has already been received.', 'PO_COMPLETE');
    await client.query(
      `UPDATE purchase_orders SET status = 'CLOSED', closed_at = now(), closed_by = $2, close_reason = $3, updated_at = now()
        WHERE id = $1`,
      [poId, actor.id, reason],
    );
    await logAudit(client, {
      actorId: actor.id,
      action: 'PURCHASE_ORDER_SHORT_CLOSED',
      entityType: 'purchase_order',
      entityId: poId,
      details: { reason, remaining: Number(totals.rows[0].remaining) },
    });
    return loadPo(client, poId);
  });
}

export async function cancelPurchaseOrder(poId, body, actor) {
  const input = asObject(body);
  const reason = text(input.reason, 'reason', { max: 500 });
  return withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE', [poId]);
    if (!rows[0]) throw notFound('Purchase order not found.');
    const received = await client.query('SELECT 1 FROM po_receipts WHERE purchase_order_id = $1 LIMIT 1', [poId]);
    if (received.rowCount) {
      throw conflict('A received purchase order cannot be cancelled; short-close it instead.', 'PO_HAS_RECEIPTS');
    }
    if (!['DRAFT', 'ORDERED'].includes(rows[0].status)) {
      throw conflict('This purchase order can no longer be cancelled.', 'PO_NOT_CANCELLABLE');
    }
    await client.query(
      `UPDATE purchase_orders SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = $2,
         cancel_reason = $3, updated_at = now() WHERE id = $1`,
      [poId, actor.id, reason],
    );
    await logAudit(client, {
      actorId: actor.id,
      action: 'PURCHASE_ORDER_CANCELLED',
      entityType: 'purchase_order',
      entityId: poId,
      details: { reason },
    });
    return loadPo(client, poId);
  });
}

export async function listReceipts({ poId = null, limit = 100 } = {}) {
  const { rows } = await query(
    `SELECT r.*, po.number AS po_number, u.display_name AS received_by_name
       FROM po_receipts r
       JOIN purchase_orders po ON po.id = r.purchase_order_id
       JOIN users u ON u.id = r.received_by
      WHERE ($1::bigint IS NULL OR r.purchase_order_id = $1)
      ORDER BY r.created_at DESC, r.id DESC LIMIT $2`,
    [poId, limit],
  );
  return rows.map((row) => ({
    id: row.number,
    number: row.number,
    purchaseOrderId: String(row.purchase_order_id),
    purchaseOrderNumber: row.po_number,
    createdAt: new Date(row.created_at).toISOString(),
    receivedBy: String(row.received_by),
    receivedByName: row.received_by_name,
    totalCents: Number(row.total_cents),
    note: row.note,
  }));
}
