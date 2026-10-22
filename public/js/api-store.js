/**
 * API-backed store. Reads are synchronous from the last server snapshot;
 * every write awaits the Express API and then refreshes that snapshot.
 */
import { api, uuid } from './api.js';
import { ValidationError } from './validation-error.js';

const EMPTY_META = {
  clockIso: new Date().toISOString(),
  businessDate: '',
  defaultTerminal: 'Counter 1',
  appVersion: '',
  dataSource: 'PostgreSQL via Express API',
  stageLabel: 'Stage 2 — live shop server',
};

const DEFAULT_SETTINGS = {
  id: 'settings-1',
  shopName: 'Auto-Track',
  address: '',
  phone: '',
  email: '',
  tin: '',
  currency: 'PHP',
  timezone: 'Asia/Manila',
  businessDayCutoff: '00:00',
  receiptHeader: 'Auto-Track',
  receiptFooter: '',
  receiptWidth: '80mm',
  returnsPolicy: '',
  taxEnabled: false,
  taxRateBps: 0,
  taxInclusive: false,
  cashierDiscountLimitBps: 0,
  discountReasonRequired: true,
  maxLineQuantity: 999,
};

function wacFor(product) {
  const stock = Number(product?.stockOnHand || 0);
  return stock > 0 ? Math.round(Number(product.stockValueCents || 0) / stock) : 0;
}

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

export function createApiStore() {
  const byId = (rows) => new Map(rows.map((row) => [String(row.id), row]));
  let productsById = new Map();
  let categoriesById = new Map();
  let usersById = new Map();
  let suppliersById = new Map();
  const saleCache = new Map();

  const store = {
    meta: { ...EMPTY_META },
    categories: [],
    products: [],
    suppliers: [],
    purchaseOrders: [],
    users: [],
    settings: { ...DEFAULT_SETTINGS },
    sales: [],
    stockMovements: [],
    audit: [],
    revision: 0,
    dashboard: null,
    refreshError: '',
    lastSyncedAt: null,

    getCategory(id) {
      return categoriesById.get(String(id)) || null;
    },
    getCategories() {
      return [...store.categories];
    },
    categoryName(id) {
      return categoriesById.get(String(id))?.name || 'Uncategorized';
    },
    getUser(id) {
      return usersById.get(String(id)) || null;
    },
    userName(id) {
      return usersById.get(String(id))?.displayName || 'System';
    },
    getUsers() {
      return [...store.users];
    },
    getSupplier(id) {
      return suppliersById.get(String(id)) || null;
    },
    getSuppliers({ includeInactive = false } = {}) {
      return store.suppliers.filter((supplier) => includeInactive || supplier.active);
    },
    getProduct(id) {
      return productsById.get(String(id)) || null;
    },
    getProducts(options = {}) {
      return store.getProductsSearch('', options);
    },
    searchProducts(query = '', { limit = 100, includeInactive = false } = {}) {
      const needle = lower(query);
      return store.products
        .filter((product) => includeInactive || product.active)
        .filter((product) => {
          if (!needle) return true;
          return [product.name, product.sku, product.barcode, store.categoryName(product.categoryId)]
            .some((value) => lower(value).includes(needle));
        })
        .slice(0, limit);
    },
    getProductsSearch(query, options) {
      return store.searchProducts(query, options);
    },
    findExactProduct(query) {
      const needle = lower(query);
      if (!needle) return null;
      return store.products.find(
        (product) => product.active && (lower(product.sku) === needle || lower(product.barcode) === needle),
      ) || null;
    },
    getProductMovements(productId) {
      return store.stockMovements
        .filter((movement) => String(movement.productId) === String(productId))
        .sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)));
    },
    getSale(id) {
      return saleCache.get(String(id)) || store.sales.find((sale) => String(sale.id) === String(id)) || null;
    },
    getSales() {
      return [...store.sales];
    },
    getPurchaseOrder(id) {
      return store.purchaseOrders.find((order) => String(order.id) === String(id)) || null;
    },
    getPurchaseOrders() {
      return [...store.purchaseOrders];
    },
    getDashboard() {
      return store.dashboard;
    },
    getPublicStoreSnapshot() {
      return {
        meta: store.meta,
        settings: store.settings,
        categories: store.categories,
        products: store.products,
        sales: store.sales,
        suppliers: store.suppliers,
        purchaseOrders: store.purchaseOrders,
        users: store.users,
        stockMovements: store.stockMovements,
      };
    },
    wacFor,
    statusForSale(sale) {
      return sale?.status || 'COMPLETED';
    },
    returnedQuantity(sale, saleItemId) {
      return sale?.returnedQuantityByLine?.[saleItemId] || 0;
    },
    refundedAmount(sale, saleItemId) {
      return sale?.refundedByLine?.[saleItemId] || 0;
    },

    async ensureSale(id) {
      const key = String(id);
      const cached = saleCache.get(key);
      if (cached?.items) return cached;
      const sale = await api.get(`/api/sales/${encodeURIComponent(key)}`);
      saleCache.set(key, sale);
      return sale;
    },

    async ensurePurchaseOrder(id) {
      const key = String(id);
      const cached = store.getPurchaseOrder(key);
      if (cached) return cached;
      const order = await api.get(`/api/purchasing/orders/${encodeURIComponent(key)}`);
      const index = store.purchaseOrders.findIndex((entry) => String(entry.id) === key);
      if (index === -1) store.purchaseOrders.push(order);
      else store.purchaseOrders[index] = order;
      return order;
    },

    async refresh() {
      try {
        const [boot, movements, dashboard] = await Promise.all([
          api.get('/api/bootstrap'),
          api.get('/api/inventory/movements?limit=1000').catch(() => []),
          api.get('/api/dashboard').catch(() => null),
        ]);
        store.meta = { ...EMPTY_META, ...boot.meta };
        store.settings = boot.settings;
        store.categories = boot.categories;
        store.products = boot.products;
        store.sales = boot.sales;
        store.users = boot.users;
        store.suppliers = boot.suppliers;
        store.purchaseOrders = boot.purchaseOrders;
        store.stockMovements = Array.isArray(movements) ? movements : [];
        store.dashboard = dashboard;
        store.lowStockCount = boot.lowStockCount;
        store.lowStock = boot.lowStock;
        productsById = byId(store.products);
        categoriesById = byId(store.categories);
        usersById = byId(store.users);
        suppliersById = byId(store.suppliers);
        store.revision += 1;
        store.refreshError = '';
        store.lastSyncedAt = new Date().toISOString();
        return store;
      } catch (error) {
        store.refreshError = error.message;
        document.dispatchEvent(new CustomEvent('pos:refresh-error', { detail: error }));
        throw error;
      }
    },

    async refreshQuietly() {
      try {
        await store.refresh();
      } catch (error) {
        console.error('The screen could not refresh its server snapshot.', error);
      }
    },

    // Administrator writes -------------------------------------------------
    async createProduct(input) {
      const product = await api.post('/api/catalog/products', input);
      await store.refreshQuietly();
      return { product, warnings: {} };
    },
    async updateProduct(id, input) {
      const product = await api.put(`/api/catalog/products/${encodeURIComponent(id)}`, input);
      await store.refreshQuietly();
      return { product, warnings: {} };
    },
    async archiveProduct(id) {
      const product = await api.post(`/api/catalog/products/${encodeURIComponent(id)}/archive`);
      await store.refreshQuietly();
      return product;
    },
    async restoreProduct(id) {
      const product = await api.post(`/api/catalog/products/${encodeURIComponent(id)}/restore`);
      await store.refreshQuietly();
      return product;
    },
    async adjustStock(productId, { delta, reason, unitCostCents = null }) {
      const result = await api.post(`/api/inventory/${encodeURIComponent(productId)}/adjust`, {
        delta,
        reason,
        ...(unitCostCents === null ? {} : { unitCostCents }),
      });
      await store.refreshQuietly();
      return result;
    },
    async createCategory(input) {
      const category = await api.post('/api/catalog/categories', typeof input === 'string' ? { name: input } : input);
      await store.refreshQuietly();
      return category;
    },
    async updateCategory(id, input) {
      const category = await api.put(`/api/catalog/categories/${encodeURIComponent(id)}`, input);
      await store.refreshQuietly();
      return category;
    },
    async archiveCategory(id) {
      const category = await api.post(`/api/catalog/categories/${encodeURIComponent(id)}/archive`);
      await store.refreshQuietly();
      return category;
    },
    async createSupplier(input) {
      const supplier = await api.post('/api/suppliers', input);
      await store.refreshQuietly();
      return supplier;
    },
    async updateSupplier(id, input) {
      const supplier = await api.put(`/api/suppliers/${encodeURIComponent(id)}`, input);
      await store.refreshQuietly();
      return supplier;
    },
    async archiveSupplier(id) {
      const supplier = await api.post(`/api/suppliers/${encodeURIComponent(id)}/archive`);
      await store.refreshQuietly();
      return supplier;
    },
    async createPurchaseOrder({ supplierId, expectedAt, notes = '', lines }) {
      const order = await api.post('/api/purchasing/orders', {
        supplierId,
        expectedAt: expectedAt || null,
        notes,
        lines: lines.map((line) => ({
          productId: line.productId,
          orderedQty: line.quantity ?? line.orderedQty,
          unitCostCents: line.unitCostCents,
        })),
      });
      await store.refreshQuietly();
      return order;
    },
    async updatePurchaseOrder(id, { supplierId, expectedAt, notes = '', lines }) {
      const order = await api.put(`/api/purchasing/orders/${encodeURIComponent(id)}`, {
        supplierId,
        expectedAt: expectedAt || null,
        notes,
        lines: lines.map((line) => ({
          productId: line.productId,
          orderedQty: line.quantity ?? line.orderedQty,
          unitCostCents: line.unitCostCents,
        })),
      });
      await store.refreshQuietly();
      return order;
    },
    async orderPurchaseOrder(id) {
      const order = await api.post(`/api/purchasing/orders/${encodeURIComponent(id)}/order`);
      await store.refreshQuietly();
      return order;
    },
    async receivePurchaseOrder(id, { items, note = '', clientRequestId = null }) {
      const result = await api.post(`/api/purchasing/orders/${encodeURIComponent(id)}/receive`, {
        clientRequestId: clientRequestId || uuid(),
        note,
        items: items.map((item) => ({ lineId: item.lineId, quantity: item.quantity })),
      });
      await store.refreshQuietly();
      return { po: result.order, receipt: { id: result.receiptId, number: result.number } };
    },
    async shortClosePurchaseOrder(id, { reason }) {
      const order = await api.post(`/api/purchasing/orders/${encodeURIComponent(id)}/short-close`, { reason });
      await store.refreshQuietly();
      return order;
    },
    async cancelPurchaseOrder(id, { reason }) {
      const order = await api.post(`/api/purchasing/orders/${encodeURIComponent(id)}/cancel`, { reason });
      await store.refreshQuietly();
      return order;
    },
    async createUser(input) {
      const result = await api.post('/api/users', input);
      await store.refreshQuietly();
      return result;
    },
    async updateUser(id, input) {
      const user = await api.put(`/api/users/${encodeURIComponent(id)}`, input);
      await store.refreshQuietly();
      return user;
    },
    async resetUserPassword(id) {
      const result = await api.post(`/api/users/${encodeURIComponent(id)}/reset-password`);
      await store.refreshQuietly();
      return result;
    },
    async updateSettings(input) {
      const settings = await api.put('/api/settings', {
        ...store.settings,
        ...input,
      });
      await store.refreshQuietly();
      return settings;
    },

    // Sales ----------------------------------------------------------------
    async createSale({ lines, payments, terminal, note = '', approval = null, clientRequestId = null }) {
      const result = await api.post('/api/sales', {
        clientRequestId: clientRequestId || uuid(),
        terminalLabel: terminal || store.meta.defaultTerminal,
        note,
        lines: lines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          discountBps: line.discountBps || 0,
          discountReason: line.discountReason || '',
          note: line.note || '',
        })),
        payments: payments.map((payment) => ({
          method: payment.method,
          amountCents: payment.amountCents,
          ...(payment.method === 'CASH' ? { tenderedCents: payment.tenderedCents ?? payment.amountCents } : {}),
          ...(payment.reference ? { reference: payment.reference } : {}),
        })),
        ...(approval ? { approval } : {}),
      });
      saleCache.set(String(result.sale.id), result.sale);
      await store.refreshQuietly();
      return result.sale;
    },
    async voidSale(id, { reason, approval = null, clientRequestId = null }) {
      const result = await api.post(`/api/sales/${encodeURIComponent(id)}/void`, {
        clientRequestId: clientRequestId || uuid(),
        reason,
        ...(approval ? { approval } : {}),
      });
      saleCache.set(String(result.sale.id), result.sale);
      await store.refreshQuietly();
      return result.sale;
    },
    async recordReprint(id, terminal = store.meta.defaultTerminal) {
      return api.post(`/api/sales/${encodeURIComponent(id)}/reprint`, { terminal });
    },
    async createReturn(id, { items, reason, refundMethod, approval = null, clientRequestId = null }) {
      const result = await api.post(`/api/sales/${encodeURIComponent(id)}/returns`, {
        clientRequestId: clientRequestId || uuid(),
        reason,
        refundMethod,
        items,
        ...(approval ? { approval } : {}),
      });
      saleCache.set(String(result.sale.id), result.sale);
      await store.refreshQuietly();
      return result.sale.returns.find((entry) => entry.number === result.number) || result.sale.returns.at(-1);
    },
  };

  store.getProducts = (options = {}) => store.searchProducts('', options);
  return store;
}

export { wacFor };
