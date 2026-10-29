/**
 * Fetch interceptor that answers `/api/*` from the in-browser demo shop.
 *
 * The real UI (public/js/api.js) keeps calling the same endpoints; only the
 * transport is replaced. No network request leaves the page and nothing is
 * persisted.
 */
import { createDemoShop } from './seed.js';
import { DemoError, fail, localDate } from './shop.js';

const JSON_HEADERS = { 'content-type': 'application/json' };
const CSRF_TOKEN = 'demo-csrf-token';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function intParam(search, name, fallback) {
  const raw = search.get(name);
  if (raw === null || raw === '') return fallback;
  const value = Number(raw);
  return Number.isInteger(value) ? value : fallback;
}

function errorResponse(error) {
  if (error instanceof DemoError) {
    return {
      status: error.status,
      body: { error: { message: error.message, code: error.code, fields: error.fields || null } },
    };
  }
  console.error('[demo] unexpected error', error);
  return {
    status: 500,
    body: { error: { message: 'The demo shop hit an unexpected error.', code: 'DEMO_ERROR', fields: null } },
  };
}

export function installDemoBackend() {
  const shop = createDemoShop();
  const session = { user: null };
  const store = shop.state;

  const currentUser = () => {
    if (!session.user) fail(401, 'UNAUTHENTICATED', 'Sign in to continue.');
    const fresh = shop.userById.get(session.user.id);
    if (!fresh || !fresh.active) fail(401, 'UNAUTHENTICATED', 'Your demo session has ended.');
    session.user = fresh;
    return fresh;
  };
  const requireAdmin = () => {
    const user = currentUser();
    if (user.role !== 'ADMIN') fail(403, 'FORBIDDEN', 'Administrator access is required for that screen.');
    return user;
  };
  const includeCost = () => session.user?.role === 'ADMIN';

  const listPurchaseOrders = ({ status = '', supplierId = null, limit = 200 } = {}) => store.purchaseOrders
    .filter((order) => (!status || order.status === status) && (!supplierId || order.supplierId === String(supplierId)))
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || Number(b.id) - Number(a.id))
    .slice(0, limit)
    .map((order) => shop.poDto(order));

  const bootstrap = () => {
    const user = currentUser();
    const isAdmin = user.role === 'ADMIN';
    const products = store.products.map((product) => shop.productDto(product, { includeCost: isAdmin }));
    const low = store.products
      .filter((product) => product.active && product.stockOnHand <= product.reorderLevel)
      .sort((a, b) => (a.stockOnHand / Math.max(a.reorderLevel, 1)) - (b.stockOnHand / Math.max(b.reorderLevel, 1)));
    return {
      user: shop.userDto(user),
      settings: { ...store.settings },
      categories: store.categories.map(shop.categoryDto),
      products,
      sales: shop.listSales({ user, limit: 200 }),
      users: isAdmin ? store.users.map(shop.userDto) : [shop.userDto(user)],
      suppliers: isAdmin ? store.suppliers.map(shop.supplierDto) : [],
      purchaseOrders: isAdmin ? listPurchaseOrders({ limit: 200 }) : [],
      lowStockCount: low.length,
      lowStock: low.slice(0, 6).map((product) => shop.productDto(product, { includeCost: isAdmin })),
      meta: {
        clockIso: new Date().toISOString(),
        businessDate: localDate(new Date()),
        defaultTerminal: 'Counter 1',
        appVersion: '1.0.0',
        dataSource: 'Sample data in your browser — nothing is saved',
        stageLabel: 'Interactive demo',
      },
    };
  };

  const findSale = (id) => {
    const sale = shop.saleById.get(String(id));
    if (!sale) fail(404, 'NOT_FOUND', 'Sale not found.');
    const user = currentUser();
    if (user.role === 'CASHIER' && sale.cashierId !== user.id) fail(404, 'NOT_FOUND', 'Sale not found.');
    return { sale, user };
  };

  const productList = (search) => {
    const query = String(search.get('query') || search.get('search') || '').trim().toLowerCase();
    const categoryId = search.get('categoryId');
    const includeInactive = search.get('includeInactive') === 'true';
    const lowStock = search.get('lowStock') === 'true';
    const limit = intParam(search, 'limit', 200);
    return store.products
      .filter((product) => (includeInactive || product.active)
        && (!categoryId || product.categoryId === String(categoryId))
        && (!lowStock || product.stockOnHand <= product.reorderLevel)
        && (!query
          || product.name.toLowerCase().includes(query)
          || product.sku.toLowerCase().includes(query)
          || product.barcode.toLowerCase().includes(query)))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, limit)
      .map((product) => shop.productDto(product, { includeCost: includeCost() }));
  };

  async function route(method, path, search, body) {
    // Auth ----------------------------------------------------------------
    if (method === 'GET' && path === '/api/auth/setup-status') {
      return {
        setupRequired: false,
        setupEnabled: false,
        shopName: store.settings.shopName,
      };
    }
    if (method === 'POST' && path === '/api/auth/login') {
      const user = shop.authenticate(body?.username, body?.password);
      session.user = user;
      return { user: shop.userDto(user), csrfToken: CSRF_TOKEN };
    }
    if (method === 'GET' && path === '/api/auth/me') {
      const user = currentUser();
      return { user: shop.userDto(user), csrfToken: CSRF_TOKEN };
    }
    if (method === 'POST' && path === '/api/auth/logout') {
      session.user = null;
      return null;
    }
    if (method === 'POST' && path === '/api/auth/setup') {
      fail(400, 'SETUP_DISABLED', 'The demo already has sample accounts. Sign in to explore.');
    }
    if (method === 'POST' && path === '/api/auth/change-password') {
      const user = currentUser();
      const next = String(body?.newPassword || '');
      if (next.length < 12) {
        fail(400, 'VALIDATION_ERROR', 'Use at least 12 characters.', { newPassword: 'At least 12 characters.' });
      }
      if (String(body?.currentPassword || '') !== user.demoPassword) {
        fail(400, 'VALIDATION_ERROR', 'The current password is not correct.', { currentPassword: 'Wrong password.' });
      }
      user.demoPassword = next;
      user.mustChangePassword = false;
      return { ok: true, user: shop.userDto(user) };
    }

    // Bootstrap / dashboard ------------------------------------------------
    if (method === 'GET' && path === '/api/bootstrap') return bootstrap();
    if (method === 'GET' && path === '/api/dashboard') {
      return shop.dashboard(currentUser());
    }
    if (method === 'GET' && path === '/api/system/status') {
      return shop.systemStatus(requireAdmin());
    }

    // Inventory ------------------------------------------------------------
    if (method === 'GET' && path === '/api/inventory/movements') {
      currentUser();
      const rows = shop.movements({
        productId: search.get('productId') || null,
        type: search.get('type') || '',
        from: search.get('from') || null,
        to: search.get('to') || null,
        limit: intParam(search, 'limit', 200),
      });
      if (includeCost()) return rows;
      return rows.map(({ valueDeltaCents, valueBeforeCents, valueAfterCents, ...rest }) => rest);
    }
    const adjustMatch = path.match(/^\/api\/inventory\/([^/]+)\/adjust$/);
    if (method === 'POST' && adjustMatch) {
      const user = requireAdmin();
      const product = shop.productById.get(String(adjustMatch[1]));
      if (!product) fail(404, 'NOT_FOUND', 'Product not found.');
      const delta = Number(body?.delta);
      if (!Number.isInteger(delta) || delta === 0) {
        fail(400, 'VALIDATION_ERROR', 'Enter a non-zero whole-number change.', { delta: 'Required.' });
      }
      if (product.stockOnHand + delta < 0) {
        fail(409, 'NEGATIVE_STOCK', `Only ${product.stockOnHand} on hand — the adjustment would go negative.`);
      }
      const reason = String(body?.reason || '').trim();
      if (!reason) fail(400, 'VALIDATION_ERROR', 'A reason is required for a stock adjustment.', { reason: 'Required.' });
      const unitCostCents = body?.unitCostCents === null || body?.unitCostCents === undefined
        ? null
        : Number(body.unitCostCents);
      if (unitCostCents !== null && (!Number.isInteger(unitCostCents) || unitCostCents < 0)) {
        fail(400, 'VALIDATION_ERROR', 'Unit cost must be a non-negative amount.', { unitCostCents: 'Invalid.' });
      }
      const cost = unitCostCents === null ? product.costCents : unitCostCents;
      const movement = shop.applyStockChange(product, {
        type: 'ADJUSTMENT',
        quantityDelta: delta,
        valueDeltaCents: delta > 0 ? delta * cost : Math.min(-delta * cost, product.stockValueCents),
        businessDate: localDate(new Date()),
        referenceType: 'adjustment',
        reference: 'Stock adjustment',
        referenceId: null,
        reason,
        actorId: user.id,
        occurredAt: new Date(),
      });
      if (delta > 0 && unitCostCents !== null) product.costCents = unitCostCents;
      return { product: shop.productDto(product), movement: shop.movementDto(movement) };
    }

    // Sales ----------------------------------------------------------------
    if (method === 'GET' && path === '/api/sales') {
      const user = currentUser();
      const limit = intParam(search, 'limit', 100);
      return shop.listSales({
        user,
        from: search.get('from') || null,
        to: search.get('to') || null,
        cashierId: search.get('cashierId') || null,
        status: search.get('status') || '',
        search: search.get('search') || '',
        limit,
        offset: intParam(search, 'offset', 0),
      });
    }
    const saleDetailMatch = path.match(/^\/api\/sales\/([^/]+)$/);
    if (method === 'GET' && saleDetailMatch) {
      const { sale, user } = findSale(saleDetailMatch[1]);
      return shop.saleDetail(sale, { includeCost: user.role === 'ADMIN' });
    }
    const receiptMatch = path.match(/^\/api\/sales\/([^/]+)\/receipt$/);
    if (method === 'GET' && receiptMatch) {
      const { sale, user } = findSale(receiptMatch[1]);
      return shop.saleDetail(sale, { includeCost: user.role === 'ADMIN' });
    }
    if (method === 'POST' && path === '/api/sales') {
      const user = currentUser();
      const result = shop.recordSale({
        at: new Date(),
        actor: user,
        terminal: body?.terminalLabel,
        note: body?.note,
        lines: body?.lines || [],
        payments: body?.payments || [],
        approval: body?.approval || null,
        clientRequestId: body?.clientRequestId || null,
      });
      return {
        sale: shop.saleDetail(result.sale, { includeCost: user.role === 'ADMIN' }),
        replayed: result.replayed,
      };
    }
    const reprintMatch = path.match(/^\/api\/sales\/([^/]+)\/reprint$/);
    if (method === 'POST' && reprintMatch) {
      findSale(reprintMatch[1]);
      return { ok: true };
    }
    const voidMatch = path.match(/^\/api\/sales\/([^/]+)\/void$/);
    if (method === 'POST' && voidMatch) {
      const user = currentUser();
      const result = shop.recordVoid(voidMatch[1], {
        at: new Date(),
        actor: user,
        reason: body?.reason,
        approval: body?.approval || null,
      });
      return {
        sale: shop.saleDetail(result.sale, { includeCost: user.role === 'ADMIN' }),
        voidId: result.void.id,
        number: result.void.number,
        replayed: false,
      };
    }
    const returnMatch = path.match(/^\/api\/sales\/([^/]+)\/returns$/);
    if (method === 'POST' && returnMatch) {
      const user = currentUser();
      const result = shop.recordReturn(returnMatch[1], {
        at: new Date(),
        actor: user,
        reason: body?.reason,
        refundMethod: body?.refundMethod,
        items: body?.items || [],
        approval: body?.approval || null,
      });
      return {
        sale: shop.saleDetail(result.sale, { includeCost: user.role === 'ADMIN' }),
        returnId: result.return.id,
        number: result.return.number,
        replayed: false,
      };
    }

    // Catalog --------------------------------------------------------------
    if (method === 'GET' && path === '/api/catalog/categories') {
      currentUser();
      const includeInactive = search.get('includeInactive') === 'true';
      return store.categories
        .filter((category) => includeInactive || category.active)
        .map(shop.categoryDto);
    }
    if (method === 'POST' && path === '/api/catalog/categories') {
      requireAdmin();
      const category = shop.addCategory(body || {});
      return shop.categoryDto(category);
    }
    const categoryMatch = path.match(/^\/api\/catalog\/categories\/([^/]+)$/);
    if (method === 'PUT' && categoryMatch) {
      requireAdmin();
      const category = shop.categoryById.get(String(categoryMatch[1]));
      if (!category) fail(404, 'NOT_FOUND', 'Category not found.');
      if (body?.name !== undefined) {
        const name = String(body.name).trim();
        if (!name) fail(400, 'VALIDATION_ERROR', 'Category name is required.', { name: 'Required.' });
        if (store.categories.some((entry) => entry.id !== category.id && entry.name.toLowerCase() === name.toLowerCase())) {
          fail(409, 'CATEGORY_EXISTS', 'A category with that name already exists.', { name: 'Already exists.' });
        }
        category.name = name;
      }
      if (body?.description !== undefined) category.description = String(body.description).trim().slice(0, 200);
      category.updatedAt = new Date().toISOString();
      return shop.categoryDto(category);
    }
    const archiveCategoryMatch = path.match(/^\/api\/catalog\/categories\/([^/]+)\/archive$/);
    if (method === 'POST' && archiveCategoryMatch) {
      requireAdmin();
      const category = shop.categoryById.get(String(archiveCategoryMatch[1]));
      if (!category) fail(404, 'NOT_FOUND', 'Category not found.');
      category.active = false;
      category.updatedAt = new Date().toISOString();
      return shop.categoryDto(category);
    }

    if (method === 'GET' && path === '/api/catalog/products') {
      currentUser();
      return productList(search);
    }
    if (method === 'POST' && path === '/api/catalog/products') {
      const user = requireAdmin();
      const product = shop.addProduct({ ...(body || {}), actorId: user.id }, { at: new Date() });
      return shop.productDto(product);
    }
    const productMatch = path.match(/^\/api\/catalog\/products\/([^/]+)$/);
    if (method === 'GET' && productMatch) {
      currentUser();
      const product = shop.productById.get(String(productMatch[1]));
      if (!product) fail(404, 'NOT_FOUND', 'Product not found.');
      return shop.productDto(product, { includeCost: includeCost() });
    }
    if (method === 'PUT' && productMatch) {
      requireAdmin();
      const product = shop.productById.get(String(productMatch[1]));
      if (!product) fail(404, 'NOT_FOUND', 'Product not found.');
      const sku = String(body?.sku ?? product.sku).trim().toUpperCase();
      if (store.products.some((entry) => entry.id !== product.id && entry.sku.toLowerCase() === sku.toLowerCase())) {
        fail(409, 'SKU_TAKEN', 'That SKU is already in use.', { sku: 'Already in use.' });
      }
      const category = shop.categoryById.get(String(body?.categoryId ?? product.categoryId));
      if (!category) fail(400, 'VALIDATION_ERROR', 'Choose an active category.', { categoryId: 'Category not found.' });
      product.sku = sku;
      product.barcode = String(body?.barcode ?? product.barcode).trim().slice(0, 40);
      product.name = String(body?.name ?? product.name).trim().slice(0, 120);
      product.description = String(body?.description ?? product.description).trim().slice(0, 240);
      product.categoryId = category.id;
      product.costCents = Number.isInteger(Number(body?.costCents)) ? Number(body.costCents) : product.costCents;
      product.priceCents = Number.isInteger(Number(body?.priceCents)) ? Number(body.priceCents) : product.priceCents;
      product.reorderLevel = Number.isInteger(Number(body?.reorderLevel)) ? Number(body.reorderLevel) : product.reorderLevel;
      if (body?.active !== undefined) product.active = Boolean(body.active);
      product.updatedAt = new Date().toISOString();
      return shop.productDto(product);
    }
    const productActionMatch = path.match(/^\/api\/catalog\/products\/([^/]+)\/(archive|restore)$/);
    if (method === 'POST' && productActionMatch) {
      requireAdmin();
      const product = shop.productById.get(String(productActionMatch[1]));
      if (!product) fail(404, 'NOT_FOUND', 'Product not found.');
      product.active = productActionMatch[2] === 'restore';
      product.updatedAt = new Date().toISOString();
      return shop.productDto(product);
    }
    const productMovementsMatch = path.match(/^\/api\/catalog\/products\/([^/]+)\/movements$/);
    if (method === 'GET' && productMovementsMatch) {
      const user = currentUser();
      const rows = shop.movements({ productId: productMovementsMatch[1], limit: intParam(search, 'limit', 200) });
      if (user.role === 'ADMIN') return rows;
      return rows.map(({ valueDeltaCents, valueBeforeCents, valueAfterCents, ...rest }) => rest);
    }

    // Suppliers ------------------------------------------------------------
    if (method === 'GET' && path === '/api/suppliers') {
      requireAdmin();
      const includeInactive = search.get('includeInactive') === 'true';
      return store.suppliers.filter((supplier) => includeInactive || supplier.active).map(shop.supplierDto);
    }
    if (method === 'POST' && path === '/api/suppliers') {
      requireAdmin();
      return shop.supplierDto(shop.addSupplier(body || {}));
    }
    const supplierMatch = path.match(/^\/api\/suppliers\/([^/]+)$/);
    if (method === 'GET' && supplierMatch) {
      requireAdmin();
      const supplier = shop.supplierById.get(String(supplierMatch[1]));
      if (!supplier) fail(404, 'NOT_FOUND', 'Supplier not found.');
      return shop.supplierDto(supplier);
    }
    if (method === 'PUT' && supplierMatch) {
      requireAdmin();
      const supplier = shop.supplierById.get(String(supplierMatch[1]));
      if (!supplier) fail(404, 'NOT_FOUND', 'Supplier not found.');
      for (const field of ['name', 'contactName', 'phone', 'email', 'address', 'notes']) {
        if (body?.[field] !== undefined) supplier[field] = String(body[field]).trim();
      }
      supplier.updatedAt = new Date().toISOString();
      return shop.supplierDto(supplier);
    }
    const supplierActionMatch = path.match(/^\/api\/suppliers\/([^/]+)\/(archive|restore)$/);
    if (method === 'POST' && supplierActionMatch) {
      requireAdmin();
      const supplier = shop.supplierById.get(String(supplierActionMatch[1]));
      if (!supplier) fail(404, 'NOT_FOUND', 'Supplier not found.');
      supplier.active = supplierActionMatch[2] === 'restore';
      supplier.updatedAt = new Date().toISOString();
      return shop.supplierDto(supplier);
    }

    // Purchasing -----------------------------------------------------------
    if (method === 'GET' && path === '/api/purchasing/orders') {
      requireAdmin();
      return listPurchaseOrders({
        status: search.get('status') || '',
        supplierId: search.get('supplierId') || null,
        limit: intParam(search, 'limit', 200),
      });
    }
    if (method === 'POST' && path === '/api/purchasing/orders') {
      const user = requireAdmin();
      const order = shop.createPurchaseOrder(body || {}, user);
      return shop.poDto(order);
    }
    const poMatch = path.match(/^\/api\/purchasing\/orders\/([^/]+)$/);
    if (method === 'GET' && poMatch) {
      requireAdmin();
      const order = shop.poById.get(String(poMatch[1]));
      if (!order) fail(404, 'NOT_FOUND', 'Purchase order not found.');
      return shop.poDto(order);
    }
    if (method === 'PUT' && poMatch) {
      requireAdmin();
      const order = shop.updatePurchaseOrder(poMatch[1], body || {});
      return shop.poDto(order);
    }
    const poActionMatch = path.match(/^\/api\/purchasing\/orders\/([^/]+)\/(order|receive|short-close|cancel)$/);
    if (method === 'POST' && poActionMatch) {
      const user = requireAdmin();
      const [, id, action] = poActionMatch;
      if (action === 'order') return shop.poDto(shop.placePurchaseOrder(id));
      if (action === 'receive') {
        const result = shop.receivePurchaseOrder(id, {
          items: body?.items || [],
          note: body?.note || '',
          actor: user,
          at: new Date(),
        });
        return {
          order: shop.poDto(result.order),
          receiptId: result.receipt.number,
          number: result.receipt.number,
        };
      }
      if (action === 'short-close') {
        return shop.poDto(shop.shortClosePurchaseOrder(id, { reason: body?.reason, actor: user }));
      }
      return shop.poDto(shop.cancelPurchaseOrder(id, { reason: body?.reason }));
    }
    if (method === 'GET' && path === '/api/purchasing/receipts') {
      requireAdmin();
      return store.purchaseOrders.flatMap((order) => shop.poDto(order).receipts);
    }

    // Users ----------------------------------------------------------------
    if (method === 'GET' && path === '/api/users') {
      requireAdmin();
      return store.users.map(shop.userDto);
    }
    if (method === 'POST' && path === '/api/users') {
      requireAdmin();
      const temporaryPassword = `At7-${Math.random().toString(36).slice(2, 12)}`;
      const user = shop.addUser({ ...(body || {}), demoPassword: temporaryPassword, mustChangePassword: true });
      return { user: shop.userDto(user), temporaryPassword };
    }
    const userMatch = path.match(/^\/api\/users\/([^/]+)$/);
    if (method === 'PUT' && userMatch) {
      const actor = requireAdmin();
      const user = shop.userById.get(String(userMatch[1]));
      if (!user) fail(404, 'NOT_FOUND', 'User not found.');
      const role = String(body?.role ?? user.role).toUpperCase();
      if (!['ADMIN', 'CASHIER'].includes(role)) fail(400, 'VALIDATION_ERROR', 'Role must be ADMIN or CASHIER.', { role: 'Invalid.' });
      const active = body?.active === undefined ? user.active : Boolean(body.active);
      if (user.id === actor.id && (!active || role !== 'ADMIN')) {
        fail(409, 'SELF_LOCKOUT', 'You cannot remove your own administrator access.');
      }
      const remainingAdmins = store.users.filter(
        (entry) => entry.id !== user.id && entry.active && entry.role === 'ADMIN',
      ).length;
      if (user.role === 'ADMIN' && (!active || role !== 'ADMIN') && remainingAdmins === 0) {
        fail(409, 'LAST_ADMIN', 'At least one active administrator must remain.');
      }
      if (body?.displayName !== undefined) {
        const displayName = String(body.displayName).trim();
        if (!displayName) fail(400, 'VALIDATION_ERROR', 'Display name is required.', { displayName: 'Required.' });
        user.displayName = displayName;
      }
      user.role = role;
      user.active = active;
      user.deactivatedAt = active ? null : new Date().toISOString();
      user.updatedAt = new Date().toISOString();
      return shop.userDto(user);
    }
    const resetMatch = path.match(/^\/api\/users\/([^/]+)\/reset-password$/);
    if (method === 'POST' && resetMatch) {
      requireAdmin();
      const user = shop.userById.get(String(resetMatch[1]));
      if (!user) fail(404, 'NOT_FOUND', 'User not found.');
      const temporaryPassword = `At7-${Math.random().toString(36).slice(2, 12)}`;
      user.demoPassword = temporaryPassword;
      user.mustChangePassword = true;
      user.updatedAt = new Date().toISOString();
      return { user: shop.userDto(user), temporaryPassword };
    }

    // Settings -------------------------------------------------------------
    if (method === 'GET' && path === '/api/settings') {
      requireAdmin();
      return { ...store.settings };
    }
    if (method === 'PUT' && path === '/api/settings') {
      requireAdmin();
      return { ...shop.updateSettings(body || {}) };
    }

    // Reports --------------------------------------------------------------
    if (method === 'GET' && path === '/api/reports/daily') {
      const user = currentUser();
      const today = localDate(new Date());
      const from = search.get('from') || today;
      const to = search.get('to') || today;
      return shop.dailyReport({ from, to, user });
    }
    if (method === 'GET' && path === '/api/reports/low-stock') {
      currentUser();
      return shop.lowStockProducts(includeCost());
    }
    if (method === 'GET' && path === '/api/reports/inventory-valuation') {
      requireAdmin();
      return shop.valuation({
        categoryId: search.get('categoryId') || null,
        includeInactive: search.get('includeInactive') === 'true',
      });
    }
    if (method === 'GET' && path === '/api/reports/stock-movements') {
      requireAdmin();
      const today = localDate(new Date());
      return shop.movements({
        productId: search.get('productId') || null,
        type: search.get('type') || '',
        from: search.get('from') || today,
        to: search.get('to') || today,
        limit: intParam(search, 'limit', 500),
      });
    }
    if (method === 'GET' && path === '/api/reports/purchasing') {
      requireAdmin();
      return listPurchaseOrders({
        status: search.get('status') || '',
        supplierId: search.get('supplierId') || null,
        limit: 500,
      });
    }

    fail(404, 'NOT_FOUND', `The demo does not implement ${method} ${path}.`);
    return null;
  }

  const realFetch = window.fetch ? window.fetch.bind(window) : null;

  window.fetch = async (input, init = {}) => {
    const rawUrl = typeof input === 'string' ? input : input?.url;
    let url;
    try {
      url = new URL(rawUrl, location.href);
    } catch {
      return realFetch ? realFetch(input, init) : Promise.reject(new Error('Invalid URL'));
    }
    const isApi = url.pathname.startsWith('/api/') && url.origin === location.origin;
    if (!isApi) {
      if (realFetch) return realFetch(input, init);
      throw new Error('The demo does not load remote resources.');
    }
    const method = String(init.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase();
    let body = null;
    const rawBody = init.body ?? (typeof input === 'object' ? input?.body : undefined);
    if (typeof rawBody === 'string' && rawBody) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        body = null;
      }
    }
    await delay(70 + Math.random() * 120);
    try {
      const payload = await route(method, url.pathname.replace(/\/+$/, '') || '/', url.searchParams, body);
      if (method === 'POST' && url.pathname === '/api/auth/logout') {
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify(payload), { status: 200, headers: JSON_HEADERS });
    } catch (error) {
      const { status, body: errorBody } = errorResponse(error);
      return new Response(JSON.stringify(errorBody), { status, headers: JSON_HEADERS });
    }
  };

  return { shop, session };
}
