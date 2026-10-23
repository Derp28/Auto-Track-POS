/**
 * Client-side permission matrix for navigation and controls. The API remains authoritative.
 */
export const PERMISSIONS = {
  ADMIN: {
    viewDashboard: true,
    viewCheckout: true,
    viewSales: true,
    viewAllSales: true,
    viewCatalog: true,
    editCatalog: true,
    viewInventory: true,
    adjustInventory: true,
    viewPurchasing: true,
    editPurchasing: true,
    viewReports: true,
    viewAllReports: true,
    viewUsers: true,
    editUsers: true,
    viewSettings: true,
    editSettings: true,
    viewSystem: true,
    seeCost: true,
    seeValue: true,
    voidSale: true,
    returnSale: true,
    applyDiscount: true,
  },
  CASHIER: {
    viewDashboard: true,
    viewCheckout: true,
    viewSales: true,
    viewAllSales: false,
    viewCatalog: true,
    editCatalog: false,
    viewInventory: true,
    adjustInventory: false,
    viewPurchasing: false,
    editPurchasing: false,
    viewReports: true,
    viewAllReports: false,
    viewUsers: false,
    editUsers: false,
    viewSettings: false,
    editSettings: false,
    viewSystem: false,
    seeCost: false,
    seeValue: false,
    voidSale: true,
    returnSale: true,
    applyDiscount: true,
  },
};

export function can(user, action) {
  if (!user) return false;
  return Boolean(PERMISSIONS[user.role]?.[action]);
}

export function isAdmin(user) {
  return user?.role === 'ADMIN';
}

export function roleLabel(user) {
  if (!user) return 'Signed out';
  return user.role === 'ADMIN' ? 'Administrator' : 'Cashier';
}

export function canAccessPath(user, path) {
  if (!user) return path === '/login';
  if (path === '/login' || path === '/denied') return true;
  if (path === '/dashboard') return can(user, 'viewDashboard');
  if (path === '/checkout' || path.startsWith('/receipt/')) return can(user, 'viewCheckout') || can(user, 'viewSales');
  if (path === '/sales' || path.startsWith('/sales/')) return can(user, 'viewSales');
  if (path === '/catalog') return can(user, 'viewCatalog');
  if (path === '/inventory' || path.startsWith('/inventory/')) return can(user, 'viewInventory');
  if (path === '/purchasing' || path.startsWith('/purchasing/')) return can(user, 'viewPurchasing');
  if (path === '/reports') return can(user, 'viewReports');
  if (path === '/users') return can(user, 'viewUsers');
  if (path === '/settings') return can(user, 'viewSettings');
  if (path === '/system') return can(user, 'viewSystem');
  return false;
}

export function canApplyDiscount(user, settings, discountBps) {
  if (!user || !discountBps) return false;
  if (user.role === 'ADMIN') return true;
  return discountBps <= Number(settings.cashierDiscountLimitBps || 0);
}

export function canVoidSale(user, sale) {
  if (!sale || sale.status === 'VOIDED') return false;
  if (sale.returns?.length) return false;
  return can(user, 'voidSale');
}

export function canReturnSale(user, sale) {
  if (!sale || sale.status === 'VOIDED') return false;
  return can(user, 'returnSale');
}

export function needsAdminOverride(user, action) {
  if (!user) return true;
  if (user.role === 'ADMIN') return false;
  return ['editCatalog', 'adjustInventory', 'viewPurchasing', 'viewUsers', 'viewSettings', 'viewSystem', 'voidSale', 'returnSale'].includes(action);
}
