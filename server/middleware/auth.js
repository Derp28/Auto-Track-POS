import { config } from '../config.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { can } from '../lib/permissions.js';
import {
  clearSessionCookie,
  findSessionByToken,
  parseCookies,
  safeEqual,
} from '../services/auth.js';

export async function attachAuth(req, res, next) {
  try {
    const cookies = parseCookies(req.headers.cookie || '');
    const token = cookies[config.sessionCookieName];
    req.user = null;
    req.session = null;
    if (token) {
      const found = await findSessionByToken(token);
      if (found) {
        req.user = found.user;
        req.session = found.session;
      } else {
        res.setHeader('Set-Cookie', clearSessionCookie());
      }
    }
    next();
  } catch (error) {
    next(error);
  }
}

export function requireAuth(req, res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'ADMIN') return next(forbidden());
  next();
}

export function requireAction(action) {
  return (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (!can(req.user, action)) return next(forbidden());
    next();
  };
}

export function requireAnyAction(actions) {
  return (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (!actions.some((action) => can(req.user, action))) return next(forbidden());
    next();
  };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) {
        return next(forbidden('Cross-origin request refused.'));
      }
    } catch {
      return next(forbidden('Invalid origin.'));
    }
  }
  if (req.path === '/api/auth/login' || req.path === '/api/auth/setup' || req.path === '/api/setup') return next();
  if (!req.user || !req.session) return next(unauthorized());
  const token = req.headers['x-csrf-token'];
  if (!token || !safeEqual(token, req.session.csrfToken)) {
    return next(forbidden('Missing or invalid CSRF token. Reload and sign in again.'));
  }
  next();
}

export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
      "font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  );
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
}

export function requestLogger(req, res, next) {
  if (!config.logRequests) return next();
  const start = process.hrtime.bigint();
  const path = req.originalUrl.split('?')[0];
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const line = {
      level: res.statusCode >= 500 ? 'error' : 'info',
      msg: 'request',
      method: req.method,
      path,
      status: res.statusCode,
      durationMs: Math.round(durationMs),
      userId: req.user?.id || null,
      ip: req.ip,
    };
    console.log(JSON.stringify(line));
  });
  next();
}
