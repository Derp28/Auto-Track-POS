import { Router } from 'express';
import { query } from '../db.js';
import { asyncHandler, badRequest } from '../lib/errors.js';
import { dateOnly, idParam, integer } from '../lib/validation.js';
import { requireAction, requireAnyAction, requireAuth } from '../middleware/auth.js';
import {
  dailyReport,
  dashboard,
  inventoryValuation,
  lowStockReport,
  purchasingReport,
  stockMovementReport,
} from '../services/reports.js';

export const reportsRouter = Router();
export const bootstrapRouter = Router();

async function currentBusinessDate() {
  return (await query("SELECT to_char(current_business_date(), 'YYYY-MM-DD') AS d")).rows[0].d;
}

async function range(req) {
  const today = await currentBusinessDate();
  const from = req.query.from ? dateOnly(req.query.from, 'from') : today;
  const to = req.query.to ? dateOnly(req.query.to, 'to') : today;
  if (from > to) throw badRequest('The start date must be on or before the end date.', 'INVALID_RANGE');
  return { from, to };
}

reportsRouter.get('/daily', requireAnyAction(['reports:read']), asyncHandler(async (req, res) => {
  const { from, to } = await range(req);
  res.json(await dailyReport({ from, to, user: req.user }));
}));

reportsRouter.get('/low-stock', requireAnyAction(['reports:read']), asyncHandler(async (req, res) => {
  res.json(await lowStockReport({ includeCost: req.user.role === 'ADMIN' }));
}));

reportsRouter.get('/inventory-valuation', requireAction('reports:costs'), asyncHandler(async (req, res) => {
  res.json(await inventoryValuation({
    categoryId: req.query.categoryId ? idParam(req.query.categoryId, 'categoryId') : null,
    includeInactive: req.query.includeInactive === 'true',
  }));
}));

reportsRouter.get('/stock-movements', requireAction('reports:costs'), asyncHandler(async (req, res) => {
  const { from, to } = await range(req);
  res.json(await stockMovementReport({
    productId: req.query.productId ? idParam(req.query.productId, 'productId') : null,
    type: req.query.type || '',
    from,
    to,
    limit: integer(req.query.limit, 'limit', { optional: true, fallback: 500, min: 1, max: 1000 }),
  }));
}));

reportsRouter.get('/purchasing', requireAction('reports:costs'), asyncHandler(async (req, res) => {
  res.json(await purchasingReport({
    status: req.query.status || '',
    supplierId: req.query.supplierId ? idParam(req.query.supplierId, 'supplierId') : null,
  }));
}));

bootstrapRouter.get('/dashboard', requireAnyAction(['dashboard:all', 'dashboard:self']), asyncHandler(async (req, res) => {
  const data = await dashboard(req.user);
  res.json(data);
}));

bootstrapRouter.get('/bootstrap', requireAuth, asyncHandler(async (req, res) => {
  const { getSettingsDto } = await import('../services/settings.js');
  const { listCategories, listProducts } = await import('../services/catalog.js');
  const { listSales } = await import('../services/sales.js');
  const { listUsers } = await import('../services/users.js');
  const { listSuppliers } = await import('../services/suppliers.js');
  const { listPurchaseOrders } = await import('../services/purchasing.js');
  const { lowStockCount } = await import('../services/reports.js');
  const includeCost = req.user.role === 'ADMIN';
  const businessDate = await currentBusinessDate();
  const [settings, categories, products, stockCount, sales] = await Promise.all([
    getSettingsDto(),
    listCategories({ includeInactive: true }),
    listProducts({ includeInactive: true, limit: 1000, includeCost }),
    lowStockCount(),
    listSales({ user: req.user, limit: 200 }),
  ]);
  const [users, suppliers, purchaseOrders] = req.user.role === 'ADMIN'
    ? await Promise.all([
        listUsers({ includeInactive: true }),
        listSuppliers({ includeInactive: true }),
        listPurchaseOrders({ limit: 200 }),
      ])
    : [[req.user], [], []];
  res.json({
    user: req.user,
    settings,
    categories,
    products,
    sales,
    users,
    suppliers,
    purchaseOrders,
    lowStockCount: stockCount,
    lowStock: products.filter((product) => product.active && product.stockOnHand <= product.reorderLevel).slice(0, 6),
    meta: {
      clockIso: new Date().toISOString(),
      businessDate,
      defaultTerminal: 'Counter 1',
      appVersion: '1.0.0',
      dataSource: 'PostgreSQL via Express API',
      stageLabel: 'Stage 2 — live shop server',
    },
  });
}));
