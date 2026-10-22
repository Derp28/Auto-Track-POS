import { query, withTransaction } from '../db.js';
import { saleDto, returnDto, voidDto, saleItemDto, dateString } from '../lib/dto.js';
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  unprocessable,
} from '../lib/errors.js';
import { claimIdempotency, logAudit } from '../lib/ledger.js';
import {
  calculateLine,
  costValueFor,
  refundFor,
  restoredCostValue,
} from '../lib/money.js';
import { asObject, integer, list, oneOf, text } from '../lib/validation.js';
import { verifyAdminCredentials } from './auth.js';
import { applyStockChange, getBusinessDate } from './inventory.js';
import { getSettings } from './settings.js';

const MAX_TENDERED = 1_000_000_000_000;

async function nextDocumentNumber(client, docType, businessDate, prefix) {
  const { rows } = await client.query(
    `INSERT INTO document_sequences (doc_type, business_date, next_value)
     VALUES ($1, $2, 1)
     ON CONFLICT (doc_type, business_date)
     DO UPDATE SET next_value = document_sequences.next_value + 1
     RETURNING next_value`,
    [docType, businessDate],
  );
  const sequence = rows[0].next_value;
  return `${prefix}-${businessDate.replaceAll('-', '')}-${String(sequence).padStart(4, '0')}`;
}

function assertSafeCardReference(reference) {
  if (!reference) return '';
  const compact = String(reference).replace(/[\s-]/g, '');
  if (/\d{12,19}/.test(compact)) {
    throw badRequest(
      'Card references must not contain card numbers. Record only the external terminal reference.',
      'CARD_DATA_REJECTED',
      { reference: 'Do not enter card numbers or security codes.' },
    );
  }
  return String(reference);
}

function normalizeCheckout(body, { requireRequestId = true } = {}) {
  const input = asObject(body);
  const clientRequestId = requireRequestId
    ? text(input.clientRequestId, 'clientRequestId', { min: 8, max: 100 })
    : text(input.clientRequestId, 'clientRequestId', { optional: true, fallback: 'quote-preview', min: 1, max: 100 });
  const terminalLabel = text(input.terminalLabel, 'terminalLabel', { max: 40 });
  const note = text(input.note, 'note', { optional: true, max: 500 });
  const rawLines = list(input.lines, 'lines', { min: 1, max: 100 });
  const seen = new Set();
  const lines = rawLines.map((raw, index) => {
    const line = asObject(raw, `lines[${index}]`);
    const productId = integer(line.productId, `lines[${index}].productId`, { min: 1 });
    if (seen.has(productId)) throw badRequest('Each product may appear only once in the cart.', 'DUPLICATE_LINE');
    seen.add(productId);
    return {
      productId,
      quantity: integer(line.quantity, `lines[${index}].quantity`, { min: 1, max: 9999 }),
      discountBps: integer(line.discountBps ?? 0, `lines[${index}].discountBps`, { min: 0, max: 10000 }),
      discountReason: text(line.discountReason, `lines[${index}].discountReason`, { optional: true, max: 200 }),
      note: text(line.note, `lines[${index}].note`, { optional: true, max: 200 }),
    };
  });
  const rawPayments = input.payments === undefined ? [] : list(input.payments, 'payments', { min: 0, max: 10 });
  const payments = rawPayments.map((raw, index) => {
    const payment = asObject(raw, `payments[${index}]`);
    const method = oneOf(payment.method, `payments[${index}].method`, ['CASH', 'CARD_EXTERNAL']);
    const amountCents = integer(payment.amountCents, `payments[${index}].amountCents`, { min: 1, max: MAX_TENDERED });
    const tenderedCents = integer(payment.tenderedCents, `payments[${index}].tenderedCents`, {
      optional: true,
      fallback: amountCents,
      min: 1,
      max: MAX_TENDERED,
    });
    const reference = text(payment.reference, `payments[${index}].reference`, { optional: true, max: 40 });
    if (method === 'CASH' && tenderedCents < amountCents) {
      throw badRequest('Cash tendered must be at least the cash amount.', 'CASH_SHORT', {
        [`payments[${index}].tenderedCents`]: 'Tendered is below the amount.',
      });
    }
    return {
      method,
      amountCents,
      tenderedCents: method === 'CASH' ? tenderedCents : amountCents,
      reference: method === 'CARD_EXTERNAL' ? assertSafeCardReference(reference) : '',
    };
  });
  return { clientRequestId, terminalLabel, note, lines, payments, approval: input.approval };
}

async function approvalForDiscounts({ actor, lines, settings, approval, ip }) {
  if (actor.role === 'ADMIN') return null;
  const needsApproval = lines.some((line) => line.discountBps > Number(settings.cashier_discount_limit_bps));
  if (!needsApproval) return null;
  if (!approval?.username || !approval?.password) {
    throw forbidden(
      `Cashier discount limit is ${Number(settings.cashier_discount_limit_bps) / 100}%. Administrator approval is required.`,
    );
  }
  const admin = await verifyAdminCredentials({ username: approval.username, password: approval.password, ip });
  return admin.id;
}

async function approvalForCorrection({ actor, approval, ip, action }) {
  if (actor.role === 'ADMIN') return null;
  if (!approval?.username || !approval?.password) {
    throw forbidden(`Administrator approval is required to ${action}.`);
  }
  const admin = await verifyAdminCredentials({ username: approval.username, password: approval.password, ip });
  return admin.id;
}

function sanitizedCheckoutPayload(normalized) {
  return {
    lines: normalized.lines,
    payments: normalized.payments,
    terminalLabel: normalized.terminalLabel,
    note: normalized.note,
  };
}

export async function quote(body) {
  const normalized = normalizeCheckout(body, { requireRequestId: false });
  const settings = await getSettings();
  const productIds = normalized.lines.map((line) => line.productId);
  const { rows } = await query('SELECT * FROM products WHERE id = ANY($1::bigint[])', [productIds]);
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  const taxRateBps = settings.tax_enabled ? Number(settings.tax_rate_bps) : 0;
  const taxInclusive = settings.tax_inclusive;
  const computed = normalized.lines.map((line) => {
    const product = byId.get(line.productId);
    if (!product) throw badRequest('One of the cart products no longer exists.', 'PRODUCT_UNAVAILABLE');
    if (!product.active) throw badRequest(`${product.name} is archived.`, 'PRODUCT_UNAVAILABLE');
    const calc = calculateLine({
      unitPriceCents: Number(product.price_cents),
      quantity: line.quantity,
      discountBps: line.discountBps,
      taxRateBps,
      taxInclusive,
    });
    return {
      productId: String(product.id),
      name: product.name,
      sku: product.sku,
      unitPriceCents: Number(product.price_cents),
      stockOnHand: Number(product.stock_on_hand),
      ...calc,
      stockWarning: line.quantity > Number(product.stock_on_hand),
    };
  });
  const totals = computed.reduce(
    (acc, line) => {
      acc.subtotalCents += line.subtotalCents;
      acc.discountCents += line.discountCents;
      acc.netCents += line.netCents;
      acc.taxCents += line.taxCents;
      acc.totalCents += line.totalCents;
      acc.revenueExTaxCents += line.revenueExTaxCents;
      return acc;
    },
    { subtotalCents: 0, discountCents: 0, netCents: 0, taxCents: 0, totalCents: 0, revenueExTaxCents: 0, taxRateBps, taxInclusive },
  );
  return { lines: computed, totals };
}

export async function createSale(body, actor, { ip } = {}) {
  const normalized = normalizeCheckout(body);
  const initialSettings = await getSettings();
  if (normalized.lines.some((line) => line.quantity > Number(initialSettings.max_line_quantity))) {
    throw badRequest(`Maximum quantity per line is ${initialSettings.max_line_quantity}.`, 'MAX_QUANTITY');
  }
  if (initialSettings.discount_reason_required) {
    for (const line of normalized.lines) {
      if (line.discountBps > 0 && !line.discountReason) {
        throw badRequest('A reason is required for a line discount.', 'DISCOUNT_REASON_REQUIRED');
      }
    }
  }
  const approvedBy = await approvalForDiscounts({
    actor,
    lines: normalized.lines,
    settings: initialSettings,
    approval: normalized.approval,
    ip,
  });

  const result = await withTransaction(async (client) => {
    const claim = await claimIdempotency(client, {
      key: normalized.clientRequestId,
      userId: actor.id,
      endpoint: 'POST /api/sales',
      payload: sanitizedCheckoutPayload(normalized),
    });
    if (claim.replay) return { replay: true, ...claim.response };

    const settings = await getSettings(client);
    const businessDate = await getBusinessDate(client);
    const taxRateBps = settings.tax_enabled ? Number(settings.tax_rate_bps) : 0;
    const taxInclusive = settings.tax_inclusive;
    if (actor.role === 'CASHIER' && normalized.lines.some(
      (line) => line.discountBps > Number(settings.cashier_discount_limit_bps),
    ) && !approvedBy) {
      throw forbidden('Administrator approval is required for this discount.');
    }

    const productIds = normalized.lines.map((line) => line.productId).sort((a, b) => a - b);
    const { rows: productRows } = await client.query(
      'SELECT * FROM products WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE',
      [productIds],
    );
    const products = new Map(productRows.map((row) => [Number(row.id), row]));
    const computed = [];
    for (const line of normalized.lines) {
      const product = products.get(line.productId);
      if (!product) throw badRequest('One of the cart products no longer exists.', 'PRODUCT_UNAVAILABLE');
      if (!product.active) throw unprocessable(`${product.name} is archived and cannot be sold.`, 'PRODUCT_UNAVAILABLE');
      if (line.quantity > Number(settings.max_line_quantity)) {
        throw badRequest(`Maximum quantity per line is ${settings.max_line_quantity}.`, 'MAX_QUANTITY');
      }
      if (line.quantity > Number(product.stock_on_hand)) {
        throw conflict(
          Number(product.stock_on_hand) === 0
            ? `${product.name} is out of stock.`
            : `Only ${product.stock_on_hand} of ${product.name} are in stock.`,
          'INSUFFICIENT_STOCK',
        );
      }
      const calc = calculateLine({
        unitPriceCents: Number(product.price_cents),
        quantity: line.quantity,
        discountBps: line.discountBps,
        taxRateBps,
        taxInclusive,
      });
      const costValue = costValueFor(Number(product.stock_value_cents), Number(product.stock_on_hand), line.quantity);
      computed.push({
        line,
        product,
        calc,
        costValue,
        unitCostCents: line.quantity ? Math.round(costValue / line.quantity) : 0,
        approvedBy: line.discountBps > Number(settings.cashier_discount_limit_bps) ? approvedBy : null,
      });
    }
    const totals = computed.reduce(
      (acc, entry) => {
        acc.subtotalCents += entry.calc.subtotalCents;
        acc.discountCents += entry.calc.discountCents;
        acc.netCents += entry.calc.netCents;
        acc.taxCents += entry.calc.taxCents;
        acc.totalCents += entry.calc.totalCents;
        return acc;
      },
      { subtotalCents: 0, discountCents: 0, netCents: 0, taxCents: 0, totalCents: 0 },
    );
    const paymentTotal = normalized.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
    if (paymentTotal !== totals.totalCents) {
      throw badRequest('Payment amounts must equal the sale total.', 'PAYMENT_MISMATCH', {
        payments: `Payments total ${paymentTotal} cents but the sale total is ${totals.totalCents} cents.`,
      });
    }
    if (totals.totalCents === 0 && normalized.payments.length > 0) {
      throw badRequest('A zero-total sale cannot take a payment.', 'PAYMENT_MISMATCH');
    }
    const number = await nextDocumentNumber(client, 'SALE', businessDate, 'S');
    const saleInsert = await client.query(
      `INSERT INTO sales (number, cashier_id, cashier_name, terminal_label, note,
         subtotal_cents, discount_cents, net_cents, tax_cents, total_cents,
         tax_rate_bps, tax_inclusive, currency, business_date, client_request_id, payload_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING *`,
      [
        number, actor.id, actor.displayName, normalized.terminalLabel, normalized.note,
        totals.subtotalCents, totals.discountCents, totals.netCents, totals.taxCents, totals.totalCents,
        taxRateBps, taxInclusive, settings.currency.trim(), businessDate,
        normalized.clientRequestId, claim.hash,
      ],
    );
    const sale = saleInsert.rows[0];
    for (const entry of computed) {
      await client.query(
        `INSERT INTO sale_items (sale_id, product_id, sku, barcode, name, quantity, unit_price_cents,
           unit_cost_cents, discount_bps, discount_reason, discount_approved_by, note,
           subtotal_cents, discount_cents, net_cents, tax_cents, total_cents, cost_value_cents,
           tax_rate_bps, tax_inclusive)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
        [
          sale.id, entry.product.id, entry.product.sku, entry.product.barcode || '', entry.product.name,
          entry.line.quantity, entry.product.price_cents, entry.unitCostCents,
          entry.line.discountBps, entry.line.discountReason, entry.approvedBy, entry.line.note,
          entry.calc.subtotalCents, entry.calc.discountCents, entry.calc.netCents, entry.calc.taxCents,
          entry.calc.totalCents, entry.costValue, taxRateBps, taxInclusive,
        ],
      );
    }
    for (const payment of normalized.payments) {
      const change = payment.tenderedCents - payment.amountCents;
      await client.query(
        `INSERT INTO sale_payments (sale_id, method, amount_cents, tendered_cents, change_cents, reference, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [sale.id, payment.method, payment.amountCents, payment.tenderedCents, change, payment.reference, actor.id],
      );
    }
    for (const entry of computed) {
      await applyStockChange(client, entry.product, {
        type: 'SALE',
        quantityDelta: -entry.line.quantity,
        valueDeltaCents: -entry.costValue,
        businessDate,
        referenceType: 'sale',
        referenceId: sale.id,
        referenceNumber: number,
        reason: 'Counter sale',
        actorId: actor.id,
      });
    }
    await logAudit(client, {
      actorId: actor.id,
      action: 'SALE_CREATED',
      entityType: 'sale',
      entityId: sale.id,
      details: {
        number,
        totalCents: totals.totalCents,
        lines: computed.length,
        paymentMethods: normalized.payments.map((payment) => payment.method),
        discountApprovedBy: approvedBy,
      },
    });
    const response = { saleId: String(sale.id), number };
    await claim.complete(response);
    return { replay: false, ...response };
  });
  return result;
}

export async function loadSale(saleId, { includeCost = true } = {}) {
  const saleResult = await query('SELECT * FROM sales WHERE id = $1', [saleId]);
  const row = saleResult.rows[0];
  if (!row) throw notFound('Sale not found.');
  const [items, payments, returns, voidResult] = await Promise.all([
    query(
      `SELECT si.*,
              COALESCE((SELECT sum(sri.quantity) FROM sale_return_items sri WHERE sri.sale_item_id = si.id), 0) AS returned_quantity
         FROM sale_items si WHERE si.sale_id = $1 ORDER BY si.id`,
      [saleId],
    ),
    query('SELECT * FROM sale_payments WHERE sale_id = $1 ORDER BY id', [saleId]),
    query(
      `SELECT r.*, s.number AS sale_number,
              (SELECT method FROM refunds rf WHERE rf.return_id = r.id ORDER BY rf.id LIMIT 1) AS refund_method
         FROM sale_returns r JOIN sales s ON s.id = r.sale_id
        WHERE r.sale_id = $1 ORDER BY r.created_at, r.id`,
      [saleId],
    ),
    query('SELECT * FROM sale_voids WHERE sale_id = $1', [saleId]),
  ]);
  const returnIds = returns.rows.map((entry) => entry.id);
  const returnItems = returnIds.length
    ? await query(
        `SELECT sri.*, si.sku, si.name
           FROM sale_return_items sri JOIN sale_items si ON si.id = sri.sale_item_id
          WHERE sri.return_id = ANY($1::bigint[]) ORDER BY sri.id`,
        [returnIds],
      )
    : { rows: [] };
  const returnsDto = returns.rows.map((entry) =>
    returnDto(
      entry,
      returnItems.rows
        .filter((item) => Number(item.return_id) === Number(entry.id))
        .map((item) => ({
          id: String(item.id),
          saleItemId: String(item.sale_item_id),
          productId: String(item.product_id),
          sku: item.sku,
          name: item.name,
          quantity: Number(item.quantity),
          restock: item.restocked,
          refundCents: Number(item.refund_cents),
          taxCents: Number(item.tax_cents),
          revenueExTaxCents: Number(item.refund_cents) - Number(item.tax_cents),
          costValueCents: Number(item.cost_value_cents),
        })),
    ),
  );
  return saleDto(row, {
    items: items.rows,
    payments: payments.rows,
    returns: returnsDto,
    void: voidResult.rows[0] || null,
    includeCost,
  });
}

export async function getSaleForUser(saleId, user) {
  const { rows } = await query('SELECT cashier_id FROM sales WHERE id = $1', [saleId]);
  if (!rows[0]) throw notFound('Sale not found.');
  if (user.role === 'CASHIER' && Number(rows[0].cashier_id) !== Number(user.id)) {
    throw notFound('Sale not found.');
  }
  return loadSale(saleId, { includeCost: user.role === 'ADMIN' });
}

export async function listSales({
  user,
  from = null,
  to = null,
  cashierId = null,
  status = '',
  search = '',
  limit = 50,
  offset = 0,
}) {
  const effectiveCashier = user.role === 'CASHIER' ? user.id : cashierId;
  const { rows } = await query(
    `WITH agg AS (
       SELECT s.*,
         (SELECT COALESCE(sum(quantity), 0) FROM sale_items si WHERE si.sale_id = s.id) AS total_qty,
         (SELECT COALESCE(sum(sri.quantity), 0)
            FROM sale_return_items sri JOIN sale_items si ON si.id = sri.sale_item_id
           WHERE si.sale_id = s.id) AS returned_qty,
         (SELECT COALESCE(sum(total_cents), 0) FROM sale_returns r WHERE r.sale_id = s.id) AS returned_cents
       FROM sales s
       WHERE ($1::date IS NULL OR s.business_date >= $1)
         AND ($2::date IS NULL OR s.business_date <= $2)
         AND ($3::bigint IS NULL OR s.cashier_id = $3)
         AND ($4::text = '' OR s.number ILIKE '%' || $4 || '%' OR s.cashier_name ILIKE '%' || $4 || '%')
     )
     SELECT *, CASE
         WHEN status = 'VOIDED' THEN 'VOIDED'
         WHEN returned_qty >= total_qty AND returned_qty > 0 THEN 'RETURNED'
         WHEN returned_qty > 0 THEN 'PARTIALLY_RETURNED'
         ELSE 'COMPLETED'
       END AS derived_status
     FROM agg
     WHERE ($5::text = '' OR CASE
         WHEN status = 'VOIDED' THEN 'VOIDED'
         WHEN returned_qty >= total_qty AND returned_qty > 0 THEN 'RETURNED'
         WHEN returned_qty > 0 THEN 'PARTIALLY_RETURNED'
         ELSE 'COMPLETED'
       END = $5)
     ORDER BY created_at DESC, id DESC
     LIMIT $6 OFFSET $7`,
    [from, to, effectiveCashier, search.trim(), status, limit, offset],
  );
  return rows.map((row) => ({
    id: String(row.id),
    number: row.number,
    createdAt: new Date(row.created_at).toISOString(),
    businessDate: dateString(row.business_date),
    cashierId: String(row.cashier_id),
    cashierName: row.cashier_name,
    terminal: row.terminal_label,
    status: row.derived_status,
    totalQuantity: Number(row.total_qty),
    subtotalCents: Number(row.subtotal_cents),
    discountCents: Number(row.discount_cents),
    netCents: Number(row.net_cents),
    taxCents: Number(row.tax_cents),
    totalCents: Number(row.total_cents),
    revenueExTaxCents: Number(row.net_cents) - (row.tax_inclusive ? Number(row.tax_cents) : 0),
    returnedCents: Number(row.returned_cents),
    returnedQuantity: Number(row.returned_qty),
    taxRateBps: Number(row.tax_rate_bps),
    taxInclusive: row.tax_inclusive,
    currency: row.currency.trim(),
  }));
}

export async function voidSale(saleId, body, actor, { ip } = {}) {
  const input = asObject(body);
  const reason = text(input.reason, 'reason', { max: 500 });
  const clientRequestId = text(input.clientRequestId, 'clientRequestId', { min: 8, max: 100 });
  const approvedBy = await approvalForCorrection({ actor, approval: input.approval, ip, action: 'void a sale' });

  return withTransaction(async (client) => {
    const claim = await claimIdempotency(client, {
      key: clientRequestId,
      userId: actor.id,
      endpoint: `POST /api/sales/${saleId}/void`,
      payload: { reason },
    });
    if (claim.replay) return { replay: true, ...claim.response };
    const businessDate = await getBusinessDate(client);
    const { rows } = await client.query('SELECT * FROM sales WHERE id = $1 FOR UPDATE', [saleId]);
    const sale = rows[0];
    if (!sale) throw notFound('Sale not found.');
    if (actor.role === 'CASHIER' && Number(sale.cashier_id) !== Number(actor.id)) {
      throw notFound('Sale not found.');
    }
    if (sale.status === 'VOIDED') throw conflict('This sale is already voided.', 'ALREADY_VOIDED');
    if (dateString(sale.business_date) !== businessDate) {
      throw unprocessable('Voids are limited to the current business day.', 'CUTOFF');
    }
    const returned = await client.query('SELECT 1 FROM sale_returns WHERE sale_id = $1 LIMIT 1', [saleId]);
    if (returned.rowCount) throw conflict('A sale with a return cannot be voided.', 'HAS_RETURNS');
    const items = await client.query('SELECT * FROM sale_items WHERE sale_id = $1 ORDER BY product_id, id', [saleId]);
    const productIds = items.rows.map((item) => Number(item.product_id)).sort((a, b) => a - b);
    const products = await client.query('SELECT * FROM products WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE', [productIds]);
    const productsById = new Map(products.rows.map((row) => [Number(row.id), row]));
    const number = await nextDocumentNumber(client, 'VOID', businessDate, 'VOID');
    const voidInsert = await client.query(
      `INSERT INTO sale_voids (number, sale_id, reason, created_by, approved_by, total_cents, business_date,
         client_request_id, payload_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [number, saleId, reason, actor.id, approvedBy, sale.total_cents, businessDate, clientRequestId, claim.hash],
    );
    await client.query(
      `UPDATE sales SET status = 'VOIDED', voided_at = now(), voided_by = $2, void_approved_by = $3, void_reason = $4
        WHERE id = $1`,
      [saleId, actor.id, approvedBy, reason],
    );
    for (const item of items.rows) {
      const product = productsById.get(Number(item.product_id));
      if (!product) throw conflict('A product on this sale no longer exists.', 'PRODUCT_MISSING');
      await applyStockChange(client, product, {
        type: 'VOID',
        quantityDelta: Number(item.quantity),
        valueDeltaCents: Number(item.cost_value_cents),
        businessDate,
        referenceType: 'sale_void',
        referenceId: voidInsert.rows[0].id,
        referenceNumber: number,
        reason: `Void: ${reason}`,
        actorId: actor.id,
      });
    }
    const payments = await client.query('SELECT * FROM sale_payments WHERE sale_id = $1 ORDER BY id', [saleId]);
    let remaining = Number(sale.total_cents);
    for (const payment of payments.rows) {
      if (remaining <= 0) break;
      const amount = Math.min(remaining, Number(payment.amount_cents));
      if (amount > 0) {
        await client.query(
          `INSERT INTO refunds (sale_id, void_id, method, amount_cents, reference, created_by)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [saleId, voidInsert.rows[0].id, payment.method, amount, '', actor.id],
        );
        remaining -= amount;
      }
    }
    await logAudit(client, {
      actorId: actor.id,
      action: 'SALE_VOIDED',
      entityType: 'sale',
      entityId: saleId,
      details: { number: sale.number, reason, approvedBy, totalCents: Number(sale.total_cents) },
    });
    const response = { voidId: String(voidInsert.rows[0].id), number };
    await claim.complete(response);
    return { replay: false, ...response };
  });
}

export async function createReturn(saleId, body, actor, { ip } = {}) {
  const input = asObject(body);
  const reason = text(input.reason, 'reason', { max: 500 });
  const clientRequestId = text(input.clientRequestId, 'clientRequestId', { min: 8, max: 100 });
  const refundMethod = oneOf(input.refundMethod, 'refundMethod', ['CASH', 'CARD_EXTERNAL']);
  const items = list(input.items, 'items', { min: 1, max: 100 }).map((raw, index) => {
    const item = asObject(raw, `items[${index}]`);
    return {
      saleItemId: integer(item.saleItemId, `items[${index}].saleItemId`, { min: 1 }),
      quantity: integer(item.quantity, `items[${index}].quantity`, { min: 1, max: 9999 }),
      restock: item.restock !== false,
    };
  });
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.saleItemId)) throw badRequest('Each sale line may appear only once in a return.', 'DUPLICATE_RETURN_LINE');
    seen.add(item.saleItemId);
  }
  const approvedBy = await approvalForCorrection({ actor, approval: input.approval, ip, action: 'process a return' });

  return withTransaction(async (client) => {
    const claim = await claimIdempotency(client, {
      key: clientRequestId,
      userId: actor.id,
      endpoint: `POST /api/sales/${saleId}/returns`,
      payload: { reason, refundMethod, items: items.map((item) => ({ saleItemId: item.saleItemId, quantity: item.quantity, restock: item.restock })) },
    });
    if (claim.replay) return { replay: true, ...claim.response };
    const businessDate = await getBusinessDate(client);
    const saleResult = await client.query('SELECT * FROM sales WHERE id = $1 FOR UPDATE', [saleId]);
    const sale = saleResult.rows[0];
    if (!sale) throw notFound('Sale not found.');
    if (actor.role === 'CASHIER' && Number(sale.cashier_id) !== Number(actor.id)) {
      throw notFound('Sale not found.');
    }
    if (sale.status === 'VOIDED') throw conflict('A voided sale cannot be returned.', 'SALE_VOIDED');
    const { rows: lineRows } = await client.query(
      `SELECT si.*,
         COALESCE((SELECT sum(sri.quantity) FROM sale_return_items sri WHERE sri.sale_item_id = si.id), 0) AS returned_qty,
         COALESCE((SELECT sum(sri.refund_cents) FROM sale_return_items sri WHERE sri.sale_item_id = si.id), 0) AS refunded_cents,
         COALESCE((SELECT sum(sri.tax_cents) FROM sale_return_items sri WHERE sri.sale_item_id = si.id), 0) AS refunded_tax_cents,
         COALESCE((SELECT sum(sri.cost_value_cents) FROM sale_return_items sri WHERE sri.sale_item_id = si.id), 0) AS returned_cost_cents
       FROM sale_items si WHERE si.sale_id = $1 ORDER BY si.id`,
      [saleId],
    );
    const linesById = new Map(lineRows.map((row) => [Number(row.id), row]));
    const computed = [];
    for (const item of items) {
      const line = linesById.get(item.saleItemId);
      if (!line) throw badRequest('Return line not found on the original sale.', 'LINE_NOT_FOUND');
      const already = Number(line.returned_qty);
      const remaining = Number(line.quantity) - already;
      if (item.quantity > remaining) {
        throw unprocessable(`Only ${remaining} of ${line.name} can still be returned.`, 'OVER_RETURN');
      }
      const refundCents = refundFor(
        { quantity: Number(line.quantity), totalCents: Number(line.total_cents) },
        already,
        Number(line.refunded_cents),
        item.quantity,
      );
      const taxCents = refundFor(
        { quantity: Number(line.quantity), totalCents: Number(line.tax_cents) },
        already,
        Number(line.refunded_tax_cents),
        item.quantity,
      );
      const costValueCents = restoredCostValue(
        { quantity: Number(line.quantity), costValueCents: Number(line.cost_value_cents) },
        already,
        Number(line.returned_cost_cents),
        item.quantity,
      );
      computed.push({ item, line, refundCents, taxCents, costValueCents });
    }
    const totalCents = computed.reduce((sum, entry) => sum + entry.refundCents, 0);
    const taxCents = computed.reduce((sum, entry) => sum + entry.taxCents, 0);
    const costValueCents = computed.reduce((sum, entry) => sum + entry.costValueCents, 0);
    const number = await nextDocumentNumber(client, 'RETURN', businessDate, 'R');
    const returnInsert = await client.query(
      `INSERT INTO sale_returns (number, sale_id, reason, created_by, approved_by, total_cents, tax_cents,
         cost_value_cents, business_date, client_request_id, payload_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [number, saleId, reason, actor.id, approvedBy, totalCents, taxCents, costValueCents, businessDate, clientRequestId, claim.hash],
    );
    const returnRow = returnInsert.rows[0];
    for (const entry of computed) {
      await client.query(
        `INSERT INTO sale_return_items (return_id, sale_item_id, product_id, quantity, refund_cents, tax_cents, cost_value_cents, restocked)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [returnRow.id, entry.line.id, entry.line.product_id, entry.item.quantity, entry.refundCents, entry.taxCents, entry.costValueCents, entry.item.restock],
      );
    }
    if (totalCents > 0) {
      await client.query(
        `INSERT INTO refunds (sale_id, return_id, method, amount_cents, reference, created_by)
         VALUES ($1, $2, $3, $4, '', $5)`,
        [saleId, returnRow.id, refundMethod, totalCents, actor.id],
      );
    }
    const productIds = [...new Set(computed.map((entry) => Number(entry.line.product_id)))].sort((a, b) => a - b);
    const products = await client.query('SELECT * FROM products WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE', [productIds]);
    const productsById = new Map(products.rows.map((row) => [Number(row.id), row]));
    for (const entry of computed) {
      if (!entry.item.restock) continue;
      const product = productsById.get(Number(entry.line.product_id));
      if (!product) throw conflict('A returned product no longer exists.', 'PRODUCT_MISSING');
      await applyStockChange(client, product, {
        type: 'RETURN',
        quantityDelta: entry.item.quantity,
        valueDeltaCents: entry.costValueCents,
        businessDate,
        referenceType: 'sale_return',
        referenceId: returnRow.id,
        referenceNumber: number,
        reason: `Return: ${reason}`,
        actorId: actor.id,
      });
    }
    await logAudit(client, {
      actorId: actor.id,
      action: 'SALE_RETURNED',
      entityType: 'sale',
      entityId: saleId,
      details: { returnNumber: number, refundCents: totalCents, approvedBy, lines: computed.length },
    });
    const response = { returnId: String(returnRow.id), number };
    await claim.complete(response);
    return { replay: false, ...response };
  });
}

export async function recordReprint(saleId, actor, { terminal = '' } = {}) {
  const sale = await query('SELECT number FROM sales WHERE id = $1', [saleId]);
  if (!sale.rows[0]) throw notFound('Sale not found.');
  await withTransaction(async (client) => {
    await logAudit(client, {
      actorId: actor.id,
      action: 'RECEIPT_REPRINTED',
      entityType: 'sale',
      entityId: saleId,
      details: { number: sale.rows[0].number, terminal },
    });
  });
  return { ok: true };
}

export { nextDocumentNumber };
