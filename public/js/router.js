import { errorState, loadingState } from './ui.js';
import { canAccessPath } from './permissions.js';
import { renderLogin } from '../views/login.js';
import { renderDashboard } from '../views/dashboard.js';
import { renderCheckout } from '../views/checkout.js';
import { renderCatalog } from '../views/catalog.js';
import { renderInventory } from '../views/inventory.js';
import { renderStockHistory } from '../views/stock-history.js';
import { renderPurchasing } from '../views/purchasing.js';
import { renderSuppliers } from '../views/suppliers.js';
import { renderPurchaseEditor } from '../views/purchase-editor.js';
import { renderPurchaseDetail } from '../views/purchase-detail.js';
import { renderSales } from '../views/sales.js';
import { renderSaleDetail } from '../views/sale-detail.js';
import { renderReceipt } from '../views/receipt.js';
import { renderReports } from '../views/reports.js';
import { renderUsers } from '../views/users.js';
import { renderSettings } from '../views/settings.js';
import { renderSystem } from '../views/system.js';
import { renderDenied, renderNotFound } from '../views/not-found.js';

const ROUTES = [
  { path: '/login', view: renderLogin, title: 'Sign in', public: true },
  { path: '/dashboard', view: renderDashboard, title: 'Dashboard' },
  { path: '/checkout', view: renderCheckout, title: 'Checkout' },
  { path: '/catalog', view: renderCatalog, title: 'Catalog' },
  { path: '/inventory', view: renderInventory, title: 'Inventory' },
  { pattern: /^\/inventory\/([^/]+)\/movements$/, view: renderStockHistory, title: 'Stock history', params: ['id'] },
  { path: '/purchasing', view: renderPurchasing, title: 'Purchase orders' },
  { path: '/purchasing/new', view: renderPurchaseEditor, title: 'New purchase order' },
  { path: '/purchasing/suppliers', view: renderSuppliers, title: 'Suppliers' },
  { pattern: /^\/purchasing\/([^/]+)\/edit$/, view: renderPurchaseEditor, title: 'Edit purchase order', params: ['id'] },
  { pattern: /^\/purchasing\/([^/]+)$/, view: renderPurchaseDetail, title: 'Purchase order', params: ['id'] },
  { path: '/sales', view: renderSales, title: 'Sales' },
  { pattern: /^\/sales\/([^/]+)$/, view: renderSaleDetail, title: 'Sale detail', params: ['id'] },
  { pattern: /^\/receipt\/([^/]+)$/, view: renderReceipt, title: 'Receipt preview', params: ['id'] },
  { path: '/reports', view: renderReports, title: 'Reports' },
  { path: '/users', view: renderUsers, title: 'Users & roles' },
  { path: '/settings', view: renderSettings, title: 'Settings' },
  { path: '/system', view: renderSystem, title: 'System status' },
  { path: '/denied', view: renderDenied, title: 'Access denied', public: true },
];

let appState = null;
let mainElement = null;
let onRender = null;
let beforeNavigate = null;
let current = { path: '/dashboard', query: {} };
let started = false;

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/dashboard';
  const [pathPart, queryPart = ''] = raw.split('?');
  let path = pathPart || '/dashboard';
  if (!path.startsWith('/')) path = `/${path}`;
  const query = Object.fromEntries(new URLSearchParams(queryPart).entries());
  return { path, query };
}

function matchRoute(path) {
  for (const route of ROUTES) {
    if (route.path && route.path === path) return { ...route, params: {} };
    if (route.pattern) {
      const match = path.match(route.pattern);
      if (match) {
        const params = {};
        route.params.forEach((name, index) => {
          params[name] = decodeURIComponent(match[index + 1]);
        });
        return { ...route, params };
      }
    }
  }
  return null;
}

function routeReason(route) {
  if (route.path === '/purchasing' || route.path?.startsWith('/purchasing')) {
    return 'Purchasing, suppliers, and receiving are administrator-only screens.';
  }
  if (route.path === '/users') return 'User and role administration is administrator-only.';
  if (route.path === '/settings') return 'Shop settings are administrator-only.';
  if (route.path === '/system') return 'System status is administrator-only.';
  return 'Your role does not have access to that screen.';
}

function setHash(path, { replace = false } = {}) {
  const target = `#${path}`;
  if (replace) history.replaceState(null, '', target);
  else history.pushState(null, '', target);
}

function focusMain(result) {
  window.scrollTo({ top: 0, behavior: 'auto' });
  const selector = result?.focus || 'h1';
  const target = mainElement.querySelector(selector) || mainElement.querySelector('h1');
  if (target) {
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  }
}

let renderToken = 0;

function mountResult(result, context) {
  mainElement.innerHTML = result.html;
  result.after?.(mainElement, context);
  focusMain(result);
}

async function render(routeInfo) {
  if (!appState || !mainElement) return;
  const token = ++renderToken;
  current = routeInfo;
  let route = matchRoute(routeInfo.path);
  if (!route) {
    const context = { state: appState, route: routeInfo, query: routeInfo.query, params: {} };
    const result = renderNotFound(context);
    mountResult(result, context);
    document.title = 'Not found · Auto-Track POS';
    onRender?.({ ...routeInfo, route: null, result });
    return;
  }

  if (!appState.currentUser && !route.public) {
    setHash('/login', { replace: true });
    routeInfo = { ...routeInfo, path: '/login', query: {} };
    current = routeInfo;
    route = matchRoute('/login');
  }

  if (appState.currentUser?.mustChangePassword && route.path !== '/login') {
    setHash('/login', { replace: true });
    routeInfo = { ...routeInfo, path: '/login', query: {} };
    current = routeInfo;
    route = matchRoute('/login');
  }

  const effectivePath = route.path || routeInfo.path;
  if (!canAccessPath(appState.currentUser, effectivePath)) {
    const context = { state: appState, route: routeInfo, query: routeInfo.query, params: route.params || {} };
    const denied = renderDenied({ ...context, reason: routeReason(route) });
    mountResult(denied, context);
    document.title = 'Access denied · Auto-Track POS';
    onRender?.({ ...routeInfo, route, result: denied });
    return;
  }

  const context = {
    state: appState,
    route: routeInfo.path,
    query: routeInfo.query,
    params: route.params || {},
  };
  let result;
  try {
    result = route.view(context);
    if (result && typeof result.then === 'function') {
      mainElement.innerHTML = loadingState(`Loading ${route.title || 'screen'}…`);
      result = await result;
      if (token !== renderToken) return;
    }
  } catch (error) {
    if (token !== renderToken) return;
    console.error(error);
    result = {
      html: errorState({
        title: 'This screen could not load',
        message: error?.message || 'The server did not return the requested data.',
        retry: true,
      }),
      after(container) {
        container.querySelector('[data-retry-view]')?.addEventListener('click', () => rerender());
      },
      focus: 'h1',
    };
  }
  if (token !== renderToken) return;
  mountResult(result, context);
  document.title = `${route.title || 'Auto-Track'} · Auto-Track POS`;
  onRender?.({ ...routeInfo, route, result });
}

async function guardNavigation(targetPath) {
  if (!beforeNavigate) return true;
  try {
    return await beforeNavigate(targetPath, current.path);
  } catch {
    return true;
  }
}

export function navigate(path, { replace = false } = {}) {
  const target = String(path || '/dashboard');
  const parsed = target.includes('?') ? target : target;
  if (parsed === current.path) return;
  guardNavigation(parsed.split('?')[0]).then((allowed) => {
    if (!allowed) return;
    setHash(parsed, { replace });
    render(parseHash());
  });
}

export function rerender() {
  render({ ...current });
}

export function currentPath() {
  return current.path;
}

export function setBeforeNavigate(callback) {
  beforeNavigate = callback;
}

export function startRouter({ state, main, onRoute }) {
  if (started) return;
  started = true;
  appState = state;
  mainElement = main;
  onRender = onRoute;
  const initial = parseHash();
  current = initial;
  if (!location.hash) setHash(initial.path, { replace: true });
  render(initial);
  window.addEventListener('popstate', handleLocationChange);
  window.addEventListener('hashchange', handleLocationChange);
}

async function handleLocationChange() {
  if (!appState || !mainElement) return;
  const next = parseHash();
  if (next.path === current.path) return;
  const allowed = await guardNavigation(next.path);
  if (!allowed) {
    setHash(current.path, { replace: true });
    return;
  }
  render(next);
}
