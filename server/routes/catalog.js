import { Router } from 'express';
import { asyncHandler, notFound } from '../lib/errors.js';
import { idParam, integer } from '../lib/validation.js';
import { requireAction } from '../middleware/auth.js';
import {
  archiveCategory,
  createCategory,
  createProduct,
  findExactProduct,
  getProduct,
  listCategories,
  listProducts,
  setProductActive,
  updateCategory,
  updateProduct,
} from '../services/catalog.js';
import { adjustStock, listMovements, lowStock } from '../services/inventory.js';

export const catalogRouter = Router();
export const inventoryRouter = Router();

const includeCost = (req) => req.user.role === 'ADMIN';

function paging(req) {
  return {
    limit: integer(req.query.limit, 'limit', { optional: true, fallback: 100, min: 1, max: 500 }),
    offset: integer(req.query.offset, 'offset', { optional: true, fallback: 0, min: 0, max: 1_000_000 }),
  };
}

catalogRouter.get('/categories', requireAction('catalog:read'), asyncHandler(async (req, res) => {
  res.json(await listCategories({ includeInactive: req.query.includeInactive === 'true' }));
}));
catalogRouter.post('/categories', requireAction('catalog:write'), asyncHandler(async (req, res) => {
  res.status(201).json(await createCategory(req.body, req.user));
}));
catalogRouter.put('/categories/:id', requireAction('catalog:write'), asyncHandler(async (req, res) => {
  res.json(await updateCategory(idParam(req.params.id), req.body, req.user));
}));
catalogRouter.post('/categories/:id/archive', requireAction('catalog:write'), asyncHandler(async (req, res) => {
  res.json(await archiveCategory(idParam(req.params.id), req.user));
}));

catalogRouter.get('/products/lookup', requireAction('catalog:read'), asyncHandler(async (req, res) => {
  const product = await findExactProduct(req.query.code, { includeCost: includeCost(req) });
  if (!product) throw notFound('No product matches that SKU or barcode.');
  res.json(product);
}));

catalogRouter.get('/products', requireAction('catalog:read'), asyncHandler(async (req, res) => {
  const { limit, offset } = paging(req);
  res.json(await listProducts({
    query: req.query.query || '',
    categoryId: req.query.categoryId ? idParam(req.query.categoryId, 'categoryId') : null,
    includeInactive: req.query.includeInactive === 'true',
    lowStock: req.query.lowStock === 'true',
    limit,
    offset,
    includeCost: includeCost(req),
  }));
}));

catalogRouter.get('/products/:id', requireAction('catalog:read'), asyncHandler(async (req, res) => {
  res.json(await getProduct(idParam(req.params.id), { includeCost: includeCost(req) }));
}));

catalogRouter.post('/products', requireAction('catalog:write'), asyncHandler(async (req, res) => {
  res.status(201).json(await createProduct(req.body, req.user));
}));
catalogRouter.put('/products/:id', requireAction('catalog:write'), asyncHandler(async (req, res) => {
  res.json(await updateProduct(idParam(req.params.id), req.body, req.user));
}));
catalogRouter.post('/products/:id/archive', requireAction('catalog:write'), asyncHandler(async (req, res) => {
  res.json(await setProductActive(idParam(req.params.id), false, req.user));
}));
catalogRouter.post('/products/:id/restore', requireAction('catalog:write'), asyncHandler(async (req, res) => {
  res.json(await setProductActive(idParam(req.params.id), true, req.user));
}));

inventoryRouter.get('/low-stock', requireAction('inventory:read'), asyncHandler(async (req, res) => {
  const rows = await lowStock({ includeInactive: req.query.includeInactive === 'true' });
  const { productDto } = await import('../lib/dto.js');
  res.json(rows.map((row) => productDto(row, { includeCost: includeCost(req), categoryName: row.category_name })));
}));

inventoryRouter.get('/valuation', requireAction('inventory:read_cost'), asyncHandler(async (req, res) => {
  const { inventoryValuation } = await import('../services/reports.js');
  res.json(await inventoryValuation({
    categoryId: req.query.categoryId ? idParam(req.query.categoryId, 'categoryId') : null,
    includeInactive: req.query.includeInactive === 'true',
  }));
}));

inventoryRouter.get('/movements', requireAction('inventory:read'), asyncHandler(async (req, res) => {
  const movements = await listMovements({
    productId: req.query.productId ? idParam(req.query.productId, 'productId') : null,
    type: req.query.type || '',
    from: req.query.from || null,
    to: req.query.to || null,
    limit: integer(req.query.limit, 'limit', { optional: true, fallback: 200, min: 1, max: 1000 }),
  });
  if (req.user.role !== 'ADMIN') {
    res.json(movements.map(({ valueDeltaCents, valueBeforeCents, valueAfterCents, ...rest }) => rest));
    return;
  }
  res.json(movements);
}));

inventoryRouter.post('/:productId/adjust', requireAction('inventory:write'), asyncHandler(async (req, res) => {
  res.status(201).json(await adjustStock(idParam(req.params.productId, 'productId'), req.body, req.user));
}));
