import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { idParam, integer } from '../lib/validation.js';
import { requireAction } from '../middleware/auth.js';
import {
  cancelPurchaseOrder,
  createPurchaseOrder,
  getPurchaseOrder,
  listPurchaseOrders,
  listReceipts,
  orderPurchaseOrder,
  receivePurchaseOrder,
  shortClosePurchaseOrder,
  updatePurchaseOrder,
} from '../services/purchasing.js';
import {
  createSupplier,
  getSupplier,
  listSuppliers,
  setSupplierActive,
  updateSupplier,
} from '../services/suppliers.js';

export const suppliersRouter = Router();
export const purchasingRouter = Router();

suppliersRouter.get('/', requireAction('suppliers:read'), asyncHandler(async (req, res) => {
  res.json(await listSuppliers({ includeInactive: req.query.includeInactive === 'true' }));
}));
suppliersRouter.get('/:id', requireAction('suppliers:read'), asyncHandler(async (req, res) => {
  res.json(await getSupplier(idParam(req.params.id)));
}));
suppliersRouter.post('/', requireAction('suppliers:write'), asyncHandler(async (req, res) => {
  res.status(201).json(await createSupplier(req.body, req.user));
}));
suppliersRouter.put('/:id', requireAction('suppliers:write'), asyncHandler(async (req, res) => {
  res.json(await updateSupplier(idParam(req.params.id), req.body, req.user));
}));
suppliersRouter.post('/:id/archive', requireAction('suppliers:write'), asyncHandler(async (req, res) => {
  res.json(await setSupplierActive(idParam(req.params.id), false, req.user));
}));
suppliersRouter.post('/:id/restore', requireAction('suppliers:write'), asyncHandler(async (req, res) => {
  res.json(await setSupplierActive(idParam(req.params.id), true, req.user));
}));

purchasingRouter.get('/orders', requireAction('purchasing:read'), asyncHandler(async (req, res) => {
  res.json(await listPurchaseOrders({
    status: req.query.status || '',
    supplierId: req.query.supplierId ? idParam(req.query.supplierId, 'supplierId') : null,
    limit: integer(req.query.limit, 'limit', { optional: true, fallback: 200, min: 1, max: 500 }),
  }));
}));
purchasingRouter.post('/orders', requireAction('purchasing:write'), asyncHandler(async (req, res) => {
  res.status(201).json(await createPurchaseOrder(req.body, req.user));
}));
purchasingRouter.get('/orders/:id', requireAction('purchasing:read'), asyncHandler(async (req, res) => {
  res.json(await getPurchaseOrder(idParam(req.params.id)));
}));
purchasingRouter.put('/orders/:id', requireAction('purchasing:write'), asyncHandler(async (req, res) => {
  res.json(await updatePurchaseOrder(idParam(req.params.id), req.body, req.user));
}));
purchasingRouter.post('/orders/:id/order', requireAction('purchasing:write'), asyncHandler(async (req, res) => {
  res.json(await orderPurchaseOrder(idParam(req.params.id), req.user));
}));
purchasingRouter.post('/orders/:id/receive', requireAction('purchasing:write'), asyncHandler(async (req, res) => {
  const result = await receivePurchaseOrder(idParam(req.params.id), req.body, req.user);
  const order = await getPurchaseOrder(idParam(req.params.id));
  res.status(result.replay ? 200 : 201).json({
    order,
    receiptId: result.receiptId,
    number: result.number,
    replayed: Boolean(result.replay),
  });
}));
purchasingRouter.post('/orders/:id/short-close', requireAction('purchasing:write'), asyncHandler(async (req, res) => {
  res.json(await shortClosePurchaseOrder(idParam(req.params.id), req.body, req.user));
}));
purchasingRouter.post('/orders/:id/cancel', requireAction('purchasing:write'), asyncHandler(async (req, res) => {
  res.json(await cancelPurchaseOrder(idParam(req.params.id), req.body, req.user));
}));
purchasingRouter.get('/receipts', requireAction('purchasing:read'), asyncHandler(async (req, res) => {
  res.json(await listReceipts({
    poId: req.query.poId ? idParam(req.query.poId, 'poId') : null,
    limit: integer(req.query.limit, 'limit', { optional: true, fallback: 100, min: 1, max: 500 }),
  }));
}));
