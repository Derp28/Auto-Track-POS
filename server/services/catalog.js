import { query, withTransaction } from '../db.js';
import { categoryDto, productDto, id as toId } from '../lib/dto.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { logAudit } from '../lib/ledger.js';
import { asObject, integer, text } from '../lib/validation.js';
import { getBusinessDate } from './inventory.js';

export async function listCategories({ includeInactive = false } = {}) {
  const { rows } = await query(
    `SELECT * FROM categories WHERE ($1::boolean OR active) ORDER BY lower(name)`,
    [includeInactive],
  );
  return rows.map(categoryDto);
}

export async function createCategory(body, actor) {
  const input = asObject(body);
  const name = text(input.name, 'name', { max: 80 });
  const description = text(input.description, 'description', { optional: true, max: 300 });
  return withTransaction(async (client) => {
    const duplicate = await client.query('SELECT 1 FROM categories WHERE lower(name) = lower($1)', [name]);
    if (duplicate.rowCount) throw conflict('A category with that name already exists.', 'DUPLICATE_CATEGORY');
    const { rows } = await client.query(
      'INSERT INTO categories (name, description, created_by, updated_by) VALUES ($1, $2, $3, $3) RETURNING *',
      [name, description, actor.id],
    );
    await logAudit(client, { actorId: actor.id, action: 'CATEGORY_CREATED', entityType: 'category', entityId: rows[0].id, details: { name } });
    return categoryDto(rows[0]);
  });
}

export async function updateCategory(categoryId, body, actor) {
  const input = asObject(body);
  const name = text(input.name, 'name', { max: 80 });
  const description = text(input.description, 'description', { optional: true, max: 300 });
  return withTransaction(async (client) => {
    const current = await client.query('SELECT * FROM categories WHERE id = $1 FOR UPDATE', [categoryId]);
    if (!current.rows[0]) throw notFound('Category not found.');
    const duplicate = await client.query('SELECT 1 FROM categories WHERE lower(name) = lower($1) AND id <> $2', [name, categoryId]);
    if (duplicate.rowCount) throw conflict('A category with that name already exists.', 'DUPLICATE_CATEGORY');
    const { rows } = await client.query(
      'UPDATE categories SET name = $2, description = $3, updated_by = $4, updated_at = now() WHERE id = $1 RETURNING *',
      [categoryId, name, description, actor.id],
    );
    await logAudit(client, { actorId: actor.id, action: 'CATEGORY_UPDATED', entityType: 'category', entityId: categoryId, details: { name } });
    return categoryDto(rows[0]);
  });
}

export async function archiveCategory(categoryId, actor) {
  return withTransaction(async (client) => {
    const current = await client.query('SELECT * FROM categories WHERE id = $1 FOR UPDATE', [categoryId]);
    if (!current.rows[0]) throw notFound('Category not found.');
    const active = await client.query('SELECT count(*)::int AS n FROM products WHERE category_id = $1 AND active', [categoryId]);
    if (active.rows[0].n > 0) throw conflict('Archive or move the active products in this category first.', 'CATEGORY_IN_USE');
    const { rows } = await client.query(
      'UPDATE categories SET active = FALSE, updated_by = $2, updated_at = now() WHERE id = $1 RETURNING *',
      [categoryId, actor.id],
    );
    await logAudit(client, { actorId: actor.id, action: 'CATEGORY_ARCHIVED', entityType: 'category', entityId: categoryId, details: {} });
    return categoryDto(rows[0]);
  });
}

const PRODUCT_SELECT = `SELECT p.*, c.name AS category_name FROM products p JOIN categories c ON c.id = p.category_id`;

function normalizeProduct(input, { opening = false } = {}) {
  const data = {
    sku: text(input.sku, 'sku', { max: 40 }),
    barcode: text(input.barcode, 'barcode', { optional: true, max: 60 }),
    name: text(input.name, 'name', { max: 160 }),
    description: text(input.description, 'description', { optional: true, max: 600 }),
    categoryId: integer(input.categoryId, 'categoryId', { min: 1 }),
    costCents: integer(input.costCents, 'costCents', { min: 0, max: 1_000_000_000_000 }),
    priceCents: integer(input.priceCents, 'priceCents', { min: 0, max: 1_000_000_000_000 }),
    reorderLevel: integer(input.reorderLevel ?? 0, 'reorderLevel', { min: 0, max: 1_000_000 }),
  };
  if (opening) {
    data.stockOnHand = integer(input.stockOnHand ?? 0, 'stockOnHand', { min: 0, max: 1_000_000 });
  }
  return data;
}

async function assertProductUnique(client, data, excludeId = null) {
  const sku = await client.query('SELECT 1 FROM products WHERE lower(sku) = lower($1) AND ($2::bigint IS NULL OR id <> $2)', [data.sku, excludeId]);
  if (sku.rowCount) throw conflict('That SKU is already used.', 'DUPLICATE_SKU');
  if (data.barcode) {
    const barcode = await client.query(
      'SELECT 1 FROM products WHERE lower(barcode) = lower($1) AND ($2::bigint IS NULL OR id <> $2)',
      [data.barcode, excludeId],
    );
    if (barcode.rowCount) throw conflict('That barcode is already assigned.', 'DUPLICATE_BARCODE');
  }
}

export async function listProducts({ query: search = '', categoryId = null, includeInactive = false, lowStock = false, limit = 100, offset = 0, includeCost = true } = {}) {
  const { rows } = await query(
    `${PRODUCT_SELECT}
     WHERE ($1::text = '' OR p.name ILIKE '%' || $1 || '%' OR p.sku ILIKE '%' || $1 || '%' OR COALESCE(p.barcode, '') ILIKE '%' || $1 || '%')
       AND ($2::bigint IS NULL OR p.category_id = $2)
       AND ($3::boolean OR p.active)
       AND (NOT $4::boolean OR (p.active AND p.stock_on_hand <= p.reorder_level))
     ORDER BY lower(p.name)
     LIMIT $5 OFFSET $6`,
    [String(search).trim(), categoryId, includeInactive, lowStock, limit, offset],
  );
  return rows.map((row) => productDto(row, { includeCost, categoryName: row.category_name }));
}

export async function searchProducts(search, { limit = 20, includeCost = true } = {}) {
  return listProducts({ query: search, limit, includeCost });
}

export async function findExactProduct(code, { includeCost = true } = {}) {
  const value = String(code || '').trim();
  if (!value) return null;
  const { rows } = await query(
    `${PRODUCT_SELECT} WHERE lower(p.sku) = lower($1) OR lower(COALESCE(p.barcode, '')) = lower($1) ORDER BY p.active DESC, p.id LIMIT 1`,
    [value],
  );
  return rows[0] ? productDto(rows[0], { includeCost, categoryName: rows[0].category_name }) : null;
}

export async function getProduct(productId, { includeCost = true } = {}) {
  const { rows } = await query(`${PRODUCT_SELECT} WHERE p.id = $1`, [productId]);
  if (!rows[0]) throw notFound('Product not found.');
  return productDto(rows[0], { includeCost, categoryName: rows[0].category_name });
}

export async function createProduct(body, actor) {
  const data = normalizeProduct(asObject(body), { opening: true });
  return withTransaction(async (client) => {
    const category = await client.query('SELECT active FROM categories WHERE id = $1', [data.categoryId]);
    if (!category.rows[0]) throw badRequest('Choose a valid category.', 'VALIDATION_ERROR', { categoryId: 'Category not found.' });
    if (!category.rows[0].active) throw badRequest('Choose an active category.', 'VALIDATION_ERROR', { categoryId: 'Category is archived.' });
    await assertProductUnique(client, data);
    const stockValue = data.stockOnHand * data.costCents;
    const { rows } = await client.query(
      `INSERT INTO products (sku, barcode, name, description, category_id, cost_cents, price_cents,
         stock_on_hand, stock_value_cents, reorder_level, created_by, updated_by)
       VALUES ($1, NULLIF($2, ''), $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
       RETURNING *`,
      [data.sku, data.barcode, data.name, data.description, data.categoryId, data.costCents, data.priceCents, data.stockOnHand, stockValue, data.reorderLevel, actor.id],
    );
    const product = rows[0];
    if (data.stockOnHand > 0) {
      const businessDate = await getBusinessDate(client);
      await client.query(
        `INSERT INTO stock_movements (product_id, movement_type, quantity_delta, stock_before, stock_after,
           value_delta_cents, value_before_cents, value_after_cents, business_date, reference_type, reference_number, reason, actor_id)
         VALUES ($1, 'OPENING', $2, 0, $2, $3, 0, $3, $4, 'product', $5, $6, $7)`,
        [product.id, data.stockOnHand, stockValue, businessDate, data.sku, 'Opening stock', actor.id],
      );
    }
    await logAudit(client, {
      actorId: actor.id,
      action: 'PRODUCT_CREATED',
      entityType: 'product',
      entityId: product.id,
      details: { sku: data.sku, name: data.name, openingQty: data.stockOnHand },
    });
    const categoryName = (await client.query('SELECT name FROM categories WHERE id = $1', [data.categoryId])).rows[0].name;
    return productDto(product, { categoryName });
  });
}

export async function updateProduct(productId, body, actor) {
  const data = normalizeProduct(asObject(body));
  return withTransaction(async (client) => {
    const current = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [productId]);
    if (!current.rows[0]) throw notFound('Product not found.');
    const category = await client.query('SELECT active, name FROM categories WHERE id = $1', [data.categoryId]);
    if (!category.rows[0]) throw badRequest('Choose a valid category.', 'VALIDATION_ERROR', { categoryId: 'Category not found.' });
    if (!category.rows[0].active && Number(current.rows[0].category_id) !== data.categoryId) {
      throw badRequest('Choose an active category.', 'VALIDATION_ERROR', { categoryId: 'Category is archived.' });
    }
    await assertProductUnique(client, data, productId);
    const { rows } = await client.query(
      `UPDATE products SET sku = $2, barcode = NULLIF($3, ''), name = $4, description = $5, category_id = $6,
         cost_cents = $7, price_cents = $8, reorder_level = $9, updated_by = $10, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [productId, data.sku, data.barcode, data.name, data.description, data.categoryId, data.costCents, data.priceCents, data.reorderLevel, actor.id],
    );
    await logAudit(client, {
      actorId: actor.id,
      action: 'PRODUCT_UPDATED',
      entityType: 'product',
      entityId: productId,
      details: { sku: data.sku, priceCents: data.priceCents, costCents: data.costCents },
    });
    return productDto(rows[0], { categoryName: category.rows[0].name });
  });
}

export async function setProductActive(productId, active, actor) {
  return withTransaction(async (client) => {
    const current = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [productId]);
    if (!current.rows[0]) throw notFound('Product not found.');
    if (current.rows[0].active === active) return productDto(current.rows[0]);
    const { rows } = await client.query(
      'UPDATE products SET active = $2, updated_by = $3, updated_at = now() WHERE id = $1 RETURNING *',
      [productId, active, actor.id],
    );
    await logAudit(client, {
      actorId: actor.id,
      action: active ? 'PRODUCT_RESTORED' : 'PRODUCT_ARCHIVED',
      entityType: 'product',
      entityId: productId,
      details: { sku: current.rows[0].sku },
    });
    return productDto(rows[0]);
  });
}

export async function assertActiveCategory(client, categoryId) {
  const { rows } = await client.query('SELECT active FROM categories WHERE id = $1', [categoryId]);
  if (!rows[0] || !rows[0].active) throw badRequest('Choose an active category.');
  return true;
}

export { toId };
