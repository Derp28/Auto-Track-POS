import { forbidden } from './errors.js';

const MATRIX = {
  ADMIN: new Set([
    'dashboard:all',
    'checkout',
    'catalog:read',
    'catalog:write',
    'inventory:read',
    'inventory:read_cost',
    'inventory:write',
    'sales:read:all',
    'sales:create',
    'sales:void',
    'sales:return',
    'suppliers:read',
    'suppliers:write',
    'purchasing:read',
    'purchasing:write',
    'reports:read',
    'reports:costs',
    'users:manage',
    'settings:manage',
    'system:read',
    'audit:read',
  ]),
  CASHIER: new Set([
    'dashboard:self',
    'checkout',
    'catalog:read',
    'inventory:read',
    'sales:read:self',
    'sales:create',
    'sales:void',
    'sales:return',
    'reports:read',
  ]),
};

export function can(user, action) {
  if (!user || !user.active) return false;
  return MATRIX[user.role]?.has(action) === true;
}

export function requirePermission(user, action) {
  if (!can(user, action)) throw forbidden();
  return true;
}

export function isAdmin(user) {
  return user?.role === 'ADMIN' && user.active === true;
}
