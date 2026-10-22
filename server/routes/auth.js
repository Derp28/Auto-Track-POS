import { Router } from 'express';
import { asyncHandler, badRequest, unauthorized } from '../lib/errors.js';
import {
  changePassword,
  clearSessionCookie,
  login,
  logout,
  sessionCookie,
  setup,
  setupStatus,
} from '../services/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { asObject, text } from '../lib/validation.js';

export const authRouter = Router();

authRouter.get('/setup-status', asyncHandler(async (req, res) => {
  res.json(await setupStatus());
}));

authRouter.post('/setup', asyncHandler(async (req, res) => {
  const input = asObject(req.body);
  const result = await setup({
    token: text(input.token, 'token', { min: 8, max: 200 }),
    username: text(input.username, 'username', { min: 3, max: 32 }),
    displayName: text(input.displayName, 'displayName', { min: 1, max: 80 }),
    password: text(input.password, 'password', { min: 12, max: 200, trim: false }),
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });
  res.setHeader('Set-Cookie', sessionCookie(result.session.token, result.session.absoluteExpires));
  res.status(201).json({ user: result.user, csrfToken: result.session.csrfToken, setup: true });
}));

authRouter.post('/login', asyncHandler(async (req, res) => {
  const input = asObject(req.body);
  const result = await login({
    username: text(input.username, 'username', { min: 1, max: 40 }),
    password: text(input.password, 'password', { min: 1, max: 200, trim: false }),
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });
  res.setHeader('Set-Cookie', sessionCookie(result.session.token, result.session.absoluteExpires));
  res.json({ user: result.user, csrfToken: result.session.csrfToken });
}));

authRouter.post('/logout', requireAuth, asyncHandler(async (req, res) => {
  await logout({ sessionId: req.session?.id, userId: req.user?.id, ip: req.ip });
  res.setHeader('Set-Cookie', clearSessionCookie());
  res.status(204).end();
}));

authRouter.get('/me', requireAuth, asyncHandler(async (req, res) => {
  res.json({ user: req.user, csrfToken: req.session.csrfToken });
}));

authRouter.post('/change-password', requireAuth, asyncHandler(async (req, res) => {
  const input = asObject(req.body);
  const currentPassword = text(input.currentPassword, 'currentPassword', { min: 1, max: 200, trim: false });
  const newPassword = text(input.newPassword, 'newPassword', { min: 12, max: 200, trim: false });
  await changePassword({
    user: req.user,
    currentPassword,
    newPassword,
    sessionId: req.session.id,
    ip: req.ip,
  });
  res.status(204).end();
}));

authRouter.post('/check', requireAuth, (req, res) => {
  res.json({ ok: true, user: req.user });
});

authRouter.get('/denied', requireAuth, (req, res) => {
  throw unauthorized('This endpoint is only for testing denial.');
});

export { badRequest };
