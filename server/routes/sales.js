import { Router } from 'express';
import { asyncHandler, badRequest } from '../lib/errors.js';
import { idParam, integer, oneOf } from '../lib/validation.js';
import { requireAction, requireAnyAction } from '../middleware/auth.js';
import {
  createReturn,
  createSale,
  getSaleForUser,
  listSales,
  quote,
  recordReprint,
  voidSale,
} from '../services/sales.js';

export const salesRouter = Router();

salesRouter.post('/quote', requireAction('sales:create'), asyncHandler(async (req, res) => {
  res.json(await quote(req.body));
}));

salesRouter.post('/', requireAction('sales:create'), asyncHandler(async (req, res) => {
  const result = await createSale(req.body, req.user, { ip: req.ip });
  const sale = await getSaleForUser(result.saleId, req.user);
  res.status(result.replay ? 200 : 201).json({ sale, replayed: Boolean(result.replay) });
}));

salesRouter.get('/', requireAnyAction(['sales:read:all', 'sales:read:self']), asyncHandler(async (req, res) => {
  res.json(await listSales({
    user: req.user,
    from: req.query.from || null,
    to: req.query.to || null,
    cashierId: req.query.cashierId ? idParam(req.query.cashierId, 'cashierId') : null,
    status: oneOf(req.query.status, 'status', ['', 'COMPLETED', 'PARTIALLY_RETURNED', 'RETURNED', 'VOIDED'], { optional: true, fallback: '' }),
    search: req.query.search || '',
    limit: integer(req.query.limit, 'limit', { optional: true, fallback: 100, min: 1, max: 500 }),
    offset: integer(req.query.offset, 'offset', { optional: true, fallback: 0, min: 0, max: 1_000_000 }),
  }));
}));

salesRouter.get('/:id', requireAnyAction(['sales:read:all', 'sales:read:self']), asyncHandler(async (req, res) => {
  res.json(await getSaleForUser(idParam(req.params.id), req.user));
}));

salesRouter.get('/:id/receipt', requireAnyAction(['sales:read:all', 'sales:read:self']), asyncHandler(async (req, res) => {
  res.json(await getSaleForUser(idParam(req.params.id), req.user));
}));

salesRouter.post('/:id/reprint', requireAnyAction(['sales:read:all', 'sales:read:self']), asyncHandler(async (req, res) => {
  const saleId = idParam(req.params.id);
  await getSaleForUser(saleId, req.user);
  res.json(await recordReprint(saleId, req.user, { terminal: req.body?.terminal || '' }));
}));

salesRouter.post('/:id/void', requireAction('sales:void'), asyncHandler(async (req, res) => {
  const saleId = idParam(req.params.id);
  const result = await voidSale(saleId, req.body, req.user, { ip: req.ip });
  const sale = await getSaleForUser(saleId, req.user);
  res.status(result.replay ? 200 : 201).json({ sale, voidId: result.voidId, number: result.number, replayed: Boolean(result.replay) });
}));

salesRouter.post('/:id/returns', requireAction('sales:return'), asyncHandler(async (req, res) => {
  const saleId = idParam(req.params.id);
  const result = await createReturn(saleId, req.body, req.user, { ip: req.ip });
  const sale = await getSaleForUser(saleId, req.user);
  res.status(result.replay ? 200 : 201).json({
    sale,
    returnId: result.returnId,
    number: result.number,
    replayed: Boolean(result.replay),
  });
}));
