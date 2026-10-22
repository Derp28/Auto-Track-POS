import { query, withTransaction } from '../db.js';
import { movementDto, productDto } from '../lib/dto.js';
import { badRequest, conflict, notFound, unprocessable } from '../lib/errors.js';
import { logAudit } from '../lib/ledger.js';
import { costValueFor } from '../lib/money.js';
import { asObject, integer, text } from '../lib/validation.js';

export async function getBusinessDate(client) {
  const { rows } = await client.query("SELECT to_char(current_business_date(), 'YYYY-MM-DD') AS business_date");
  return rows[0].business_date;
}

/**
 * Atomically change stock and value, then append the movement row.
 * The caller must hold a row lock on `product`.
 */
export async function applyStockChange(client, product, {
  type,
  quantityDelta,
  valueDeltaCents,
  businessDate,
  referenceType = null,
  referenceId = null,
  referenceNumber = null,
  reason,
  actorId,
}) {
  const stockBefore = Number(product.stock_on_hand);
  const valueBefore = Number(product.stock_value_cents);
  const stockAfter = stockBefore + quantityDelta;
  if (stockAfter < 0) {
    throw unprocessable(
      `Only ${stockBefore} of ${product.name} are in stock.`,
      'INSUFFICIENT_STOCK',
    );
  }
  let valueDelta = valueDeltaCents;
  let valueAfter = valueBefore + valueDelta;
  if (stockAfter === 0 && valueAfter !== 0) {
    valueDelta = -valueBefore;
    valueAfter = 0;
  }
  if (valueAfter < 0) throw unprocessable('The stock value would become negative.', 'NEGATIVE_STOCK_VALUE');
  const { rows } = await client.query(
    `UPDATE products
        SET stock_on_hand = $2, stock_value_cents = $3, updated_at = now()
      WHERE id = $1 RETURNING *`,
    [product.id, stockAfter, valueAfter],
  );
  const movement = await client.query(
    `INSERT INTO stock_movements (product_id, movement_type, quantity_delta, stock_before, stock_after,
       value_delta_cents, value_before_cents, value_after_cents, business_date,
       reference_type, reference_id, reference_number, reason, actor_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING *`,
    [
      product.id, type, quantityDelta, stockBefore, stockAfter, valueDelta, valueBefore, valueAfter,
      businessDate, referenceType, referenceId === null ? null : String(referenceId),
      referenceNumber, reason, actorId,
    ],
  );
  return { product: rows[0], movement: movement.rows[0] };
}

export async function listMovements({ productId = null, type = '', from = null, to = null, limit = 200 } = {}) {
  const { rows } = await query(
    `SELECT m.*, p.name AS product_name, p.sku
       FROM stock_movements m
       JOIN products p ON p.id = m.product_id
      WHERE ($1::bigint IS NULL OR m.product_id = $1)
        AND ($2::text = '' OR m.movement_type = $2)
        AND ($3::date IS NULL OR m.business_date >= $3)
        AND ($4::date IS NULL OR m.business_date <= $4)
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT $5`,
    [productId, type, from, to, limit],
  );
  return rows.map(movementDto);
}

export async function adjustStock(productId, body, actor) {
  const input = asObject(body);
  const delta = integer(input.delta, 'delta', { min: -1_000_000, max: 1_000_000 });
  if (delta === 0) throw badRequest('Adjustment quantity cannot be zero.', 'VALIDATION_ERROR', { delta: 'Cannot be zero.' });
  const reason = text(input.reason, 'reason', { max: 300 });
  const unitCostCents = integer(input.unitCostCents, 'unitCostCents', {
    min: 0,
    max: 1_000_000_000_000,
    optional: true,
    fallback: null,
  });
  return withTransaction(async (client) => {
    const businessDate = await getBusinessDate(client);
    const { rows } = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [productId]);
    const product = rows[0];
    if (!product) throw notFound('Product not found.');
    const stockBefore = Number(product.stock_on_hand);
    const valueBefore = Number(product.stock_value_cents);
    let valueDelta;
    if (delta > 0) {
      const unitCost = unitCostCents ?? Number(product.cost_cents);
      valueDelta = delta * unitCost;
      await client.query('UPDATE products SET cost_cents = $2 WHERE id = $1', [productId, unitCost]);
      product.cost_cents = unitCost;
    } else {
      valueDelta = -costValueFor(valueBefore, stockBefore, Math.abs(delta));
    }
    const result = await applyStockChange(client, product, {
      type: 'ADJUSTMENT',
      quantityDelta: delta,
      valueDeltaCents: valueDelta,
      businessDate,
      referenceType: 'adjustment',
      referenceId: null,
      referenceNumber: 'Stock adjustment',
      reason,
      actorId: actor.id,
    });
    await logAudit(client, {
      actorId: actor.id,
      action: 'STOCK_ADJUSTED',
      entityType: 'product',
      entityId: productId,
      details: { delta, reason, stockBefore, stockAfter: Number(result.product.stock_on_hand) },
    });
    return {
      product: productDto(result.product),
      movement: movementDto({ ...result.movement, product_name: product.name, sku: product.sku }),
    };
  });
}

export async function lowStock({ includeInactive = false } = {}) {
  const { rows } = await query(
    `SELECT p.*, c.name AS category_name
       FROM products p JOIN categories c ON c.id = p.category_id
      WHERE p.stock_on_hand <= p.reorder_level AND ($1::boolean OR p.active)
      ORDER BY (p.stock_on_hand::numeric / GREATEST(p.reorder_level, 1)) ASC, lower(p.name)`,
    [includeInactive],
  );
  return rows;
}

export async function assertStockAvailable(client, productId, quantity) {
  const { rows } = await client.query('SELECT stock_on_hand, name FROM products WHERE id = $1', [productId]);
  if (!rows[0]) throw notFound('Product not found.');
  if (Number(rows[0].stock_on_hand) < quantity) {
    throw conflict(`Only ${rows[0].stock_on_hand} of ${rows[0].name} are in stock.`, 'INSUFFICIENT_STOCK');
  }
}
