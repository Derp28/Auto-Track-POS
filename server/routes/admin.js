import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { idParam } from '../lib/validation.js';
import { requireAction, requireAdmin, requireAuth } from '../middleware/auth.js';
import { getSettingsDto, updateSettings } from '../services/settings.js';
import { createUser, listUsers, resetUserPassword, updateUser } from '../services/users.js';

export const adminRouter = Router();

adminRouter.get('/settings', requireAuth, asyncHandler(async (req, res) => {
  res.json(await getSettingsDto());
}));
adminRouter.put('/settings', requireAction('settings:manage'), asyncHandler(async (req, res) => {
  res.json(await updateSettings(req.body, req.user));
}));

adminRouter.get('/users', requireAction('users:manage'), asyncHandler(async (req, res) => {
  res.json(await listUsers({ includeInactive: req.query.includeInactive !== 'false' }));
}));
adminRouter.post('/users', requireAction('users:manage'), asyncHandler(async (req, res) => {
  res.status(201).json(await createUser(req.body, req.user));
}));
adminRouter.put('/users/:id', requireAction('users:manage'), asyncHandler(async (req, res) => {
  res.json(await updateUser(idParam(req.params.id), req.body, req.user));
}));
adminRouter.post('/users/:id/reset-password', requireAction('users:manage'), asyncHandler(async (req, res) => {
  res.json(await resetUserPassword(idParam(req.params.id), req.user));
}));

adminRouter.get('/system/status', requireAdmin, asyncHandler(async (req, res) => {
  const { systemStatus } = await import('../services/system.js');
  res.json(await systemStatus());
}));
