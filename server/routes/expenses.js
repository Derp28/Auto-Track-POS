import { Router } from 'express';
import { asyncHandler, badRequest } from '../lib/errors.js';
import { dateOnly, idParam, integer } from '../lib/validation.js';
import { requireAction } from '../middleware/auth.js';
import {
  createExpense,
  deleteExpense,
  listExpenses,
  updateExpense,
} from '../services/expenses.js';

export const expensesRouter = Router();

function optionalRange(req) {
  const from = req.query.from ? dateOnly(req.query.from, 'from') : null;
  const to = req.query.to ? dateOnly(req.query.to, 'to') : null;
  if (from && to && from > to) throw badRequest('The start date must be on or before the end date.', 'INVALID_RANGE');
  return { from, to };
}

expensesRouter.get('/', requireAction('expenses:manage'), asyncHandler(async (req, res) => {
  const { from, to } = optionalRange(req);
  res.json(await listExpenses({
    from,
    to,
    limit: integer(req.query.limit, 'limit', { optional: true, fallback: 100, min: 1, max: 500 }),
    includeDeleted: req.query.includeDeleted === 'true',
  }));
}));

expensesRouter.post('/', requireAction('expenses:manage'), asyncHandler(async (req, res) => {
  res.status(201).json(await createExpense(req.body, req.user));
}));

expensesRouter.put('/:id', requireAction('expenses:manage'), asyncHandler(async (req, res) => {
  res.json(await updateExpense(idParam(req.params.id), req.body, req.user));
}));

expensesRouter.delete('/:id', requireAction('expenses:manage'), asyncHandler(async (req, res) => {
  res.json(await deleteExpense(idParam(req.params.id), req.user));
}));
