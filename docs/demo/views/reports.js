import {
  badge,
  emptyState,
  escapeHtml,
  icon,
  loadingState,
  money,
  pageHeader,
  printPrototype,
  saleStatusLabel,
  saleStatusTone,
  statCard,
} from '../js/ui.js';
import { formatDate, formatDateTime, formatPercentFromBps } from '../js/money.js';
import { api } from '../js/api.js';
import { rerender } from '../js/router.js';

let activeTab = 'daily';
const filters = {
  from: '',
  to: '',
  category: '',
  movementProduct: '',
  movementType: '',
  poStatus: '',
};

const TABS = [
  { id: 'daily', label: 'Daily sales', adminOnly: false },
  { id: 'sales', label: 'Sales history', adminOnly: false },
  { id: 'valuation', label: 'Inventory valuation', adminOnly: true },
  { id: 'low-stock', label: 'Low stock', adminOnly: false },
  { id: 'movements', label: 'Stock movements', adminOnly: true },
  { id: 'purchasing', label: 'Purchasing', adminOnly: true },
];

function tabsHtml(state) {
  const isCashier = state.currentUser.role === 'CASHIER';
  return TABS.map((tab) => {
    const disabled = isCashier && tab.adminOnly;
    return `<button class="report-tab ${activeTab === tab.id ? 'is-active' : ''}" type="button" role="tab" aria-selected="${activeTab === tab.id ? 'true' : 'false'}" data-report-tab="${tab.id}" ${disabled ? 'disabled title="Administrator permission required"' : ''}>${escapeHtml(tab.label)}${disabled ? ` ${icon('lock', 12)}` : ''}</button>`;
  }).join('');
}

function reportSectionHead(title, copy, badgeHtml = '') {
  return `<div class="report-section-head"><div><h2>${escapeHtml(title)}</h2><p>${copy}</p></div>${badgeHtml}</div>`;
}

function dailyHtml(state, data) {
  if (!data) return emptyState({ iconName: 'chart', title: 'Daily report unavailable', message: 'The server did not return a daily report. Refresh to try again.' });
  const settings = state.store.settings;
  return `
    ${reportSectionHead(
      'Daily sales summary',
      `${formatDate(filters.from)} to ${formatDate(filters.to)} · ${state.currentUser.role === 'CASHIER' ? 'your own sales' : 'shop-wide sales'}`,
      badge('Saved transactions', 'success'),
    )}
    <section class="stat-grid stat-grid--six" aria-label="Report totals">
      ${statCard({ label: 'Net sales ex tax', value: money(data.netExTaxCents), hint: `${data.transactionCount} completed`, iconName: 'chart' })}
      ${statCard({ label: 'Discounts', value: money(data.discountsCents), hint: 'Line percentage only', iconName: 'minus' })}
      ${statCard({ label: 'Tax', value: money(data.taxCents), hint: `Current setting: ${settings.taxEnabled ? formatPercentFromBps(settings.taxRateBps) : 'disabled'}`, iconName: 'receipt' })}
      ${statCard({ label: 'Collected', value: money(data.collectedCents), hint: 'After refunds', tone: 'accent', iconName: 'cash' })}
      ${statCard({ label: 'Refunds', value: money(data.refundsCents), hint: `${data.returnsCount} return${data.returnsCount === 1 ? '' : 's'}`, tone: data.refundsCents ? 'warning' : '', iconName: 'refresh' })}
      ${statCard({ label: 'Voids', value: String(data.voidCount), hint: `${money(data.voidValueCents)} voided value`, tone: data.voidCount ? 'danger' : '', iconName: 'alert' })}
    </section>
    <div class="report-grid">
      <section class="card card--table">
        <div class="card__head"><div><h2>By business day</h2><p>Tax follows each sale snapshot, not the current setting.</p></div></div>
        ${data.byDay.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Business date</th><th class="numeric">Transactions</th><th class="numeric">Gross ex tax</th><th class="numeric">Discounts</th><th class="numeric">Tax</th><th class="numeric">Refunds</th><th class="numeric">Collected</th></tr></thead><tbody>${data.byDay.map((row) => `<tr><td><strong>${escapeHtml(row.businessDate)}</strong></td><td class="numeric">${row.transactions}</td><td class="numeric">${money(row.grossCents)}</td><td class="numeric">${money(row.discountsCents)}</td><td class="numeric">${money(row.taxCents)}</td><td class="numeric">${money(row.refundsCents)}</td><td class="numeric"><strong>${money(row.collectedCents)}</strong></td></tr>`).join('')}</tbody></table></div>` : emptyState({ iconName: 'chart', title: 'No sales in this range', message: 'Choose a wider date range or complete a sale from checkout.' })}
      </section>
      <section class="card">
        <div class="card__head"><div><h2>Payment mix</h2><p>Captured tender minus recorded refunds.</p></div></div>
        ${data.byPayment.length ? `<ul class="report-list">${data.byPayment.map((entry) => `<li><span>${badge(entry.method === 'CASH' ? 'Cash' : 'External card', entry.method === 'CASH' ? 'success' : 'info')}</span><strong>${money(entry.amountCents)}</strong></li>`).join('')}</ul>` : emptyState({ iconName: 'cash', title: 'No payments', message: 'No completed tender in this range.' })}
        <div class="card__head card__head--tight"><div><h2>Top products</h2><p>Net of returns.</p></div></div>
        ${data.topProducts.length ? `<ul class="report-list report-list--stacked">${data.topProducts.map((product) => `<li><span><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.sku)} · ${product.quantity} sold</small></span><span>${money(product.netCents)}</span></li>`).join('')}</ul>` : '<p class="muted">No product movement.</p>'}
      </section>
    </div>
  `;
}

function salesHtml(state, sales) {
  const list = sales || [];
  return `
    ${reportSectionHead(
      'Sales history report',
      `${list.length} sale${list.length === 1 ? '' : 's'} in the selected range.`,
      badge(state.currentUser.role === 'CASHIER' ? 'Your sales only' : 'Shop-wide', state.currentUser.role === 'CASHIER' ? 'warning' : 'accent'),
    )}
    <section class="card card--table">
      ${list.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Sale</th><th>Date</th>${state.currentUser.role === 'CASHIER' ? '' : '<th>Cashier</th>'}<th class="numeric">Total</th><th>Status</th></tr></thead><tbody>${list.map((sale) => `<tr><td><a class="table-link" href="#/sales/${escapeHtml(sale.id)}" data-nav>${escapeHtml(sale.number)}</a></td><td>${formatDateTime(sale.createdAt)}</td>${state.currentUser.role === 'CASHIER' ? '' : `<td>${escapeHtml(sale.cashierName)}</td>`}<td class="numeric">${money(sale.totalCents)}</td><td>${badge(saleStatusLabel(sale.status), saleStatusTone(sale.status))}</td></tr>`).join('')}</tbody></table></div>` : emptyState({ iconName: 'receipt', title: 'No sales in this range', message: 'Adjust the date range or complete a sale.' })}
    </section>
  `;
}

function valuationHtml(state, valuation) {
  const products = (valuation || []).filter((product) => !filters.category || product.categoryId === filters.category);
  const totalCost = products.reduce((sum, product) => sum + product.stockValueCents, 0);
  const totalRetail = products.reduce((sum, product) => sum + product.retailValueCents, 0);
  return `
    ${reportSectionHead(
      'Inventory valuation',
      'Derived WAC = stock value ÷ on-hand quantity. Administrator-only view.',
      `<label class="filter-field"><span>Category</span><select data-report-filter="category"><option value="">All categories</option>${state.store.categories.map((category) => `<option value="${escapeHtml(category.id)}" ${filters.category === category.id ? 'selected' : ''}>${escapeHtml(category.name)}</option>`).join('')}</select></label>`,
    )}
    <section class="stat-grid stat-grid--three">
      ${statCard({ label: 'Stock value', value: money(totalCost), hint: 'Inventory-value authority', tone: 'accent', iconName: 'layers' })}
      ${statCard({ label: 'Retail value', value: money(totalRetail), hint: 'At current selling prices', iconName: 'chart' })}
      ${statCard({ label: 'SKUs in scope', value: String(products.length), hint: 'Active products', iconName: 'box' })}
    </section>
    <section class="card card--table">
      ${products.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Product</th><th class="numeric">On hand</th><th class="numeric">WAC</th><th class="numeric">Stock value</th><th class="numeric">Retail value</th></tr></thead><tbody>${products.map((product) => `<tr><td><strong>${escapeHtml(product.name)}</strong><small class="cell-sub">${escapeHtml(product.sku)}</small></td><td class="numeric">${product.stockOnHand}</td><td class="numeric">${money(product.wacCents)}</td><td class="numeric">${money(product.stockValueCents)}</td><td class="numeric">${money(product.retailValueCents)}</td></tr>`).join('')}</tbody></table></div>` : emptyState({ iconName: 'box', title: 'No stock in scope', message: 'Choose another category or add stock first.' })}
    </section>
  `;
}

function lowStockHtml(state, lowStock) {
  const products = lowStock || [];
  return `
    ${reportSectionHead(
      'Low-stock report',
      'Active products at or below their reorder level.',
      badge(`${products.length} SKU${products.length === 1 ? '' : 's'}`, products.length ? 'warning' : 'success'),
    )}
    <section class="card card--table">
      ${products.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Product</th><th>Category</th><th class="numeric">On hand</th><th class="numeric">Reorder</th><th>Status</th><th></th></tr></thead><tbody>${products.map((product) => `<tr><td><strong>${escapeHtml(product.name)}</strong><small class="cell-sub">${escapeHtml(product.sku)}</small></td><td>${escapeHtml(product.categoryName || state.store.categoryName(product.categoryId))}</td><td class="numeric">${product.stockOnHand}</td><td class="numeric">${product.reorderLevel}</td><td>${badge(product.stockOnHand === 0 ? 'Out of stock' : 'Low stock', product.stockOnHand === 0 ? 'danger' : 'warning')}</td><td class="numeric"><a class="text-link" href="#/inventory/${escapeHtml(product.id)}/movements" data-nav>History ${icon('arrowRight', 13)}</a></td></tr>`).join('')}</tbody></table></div>` : emptyState({ iconName: 'check', title: 'No low-stock products', message: 'Every active product is above its reorder level.' })}
    </section>
  `;
}

function movementsHtml(state, movements) {
  const list = (movements || []).filter((movement) => {
    if (filters.movementProduct && movement.productId !== filters.movementProduct) return false;
    if (filters.movementType && movement.type !== filters.movementType) return false;
    return true;
  });
  return `
    ${reportSectionHead(
      'Stock movements',
      'Read-only movement ledger for the selected range.',
      `<div class="report-filters">
        <label class="filter-field"><span>Product</span><select data-report-filter="movementProduct"><option value="">All products</option>${state.store.products.map((product) => `<option value="${escapeHtml(product.id)}" ${filters.movementProduct === product.id ? 'selected' : ''}>${escapeHtml(product.name)}</option>`).join('')}</select></label>
        <label class="filter-field"><span>Type</span><select data-report-filter="movementType"><option value="">All types</option>${['OPENING', 'SALE', 'RECEIPT', 'ADJUSTMENT', 'RETURN', 'VOID'].map((type) => `<option value="${type}" ${filters.movementType === type ? 'selected' : ''}>${type === 'OPENING' ? 'Opening' : type === 'SALE' ? 'Sale' : type === 'RECEIPT' ? 'Receipt' : type === 'ADJUSTMENT' ? 'Adjustment' : type === 'RETURN' ? 'Return' : 'Void'}</option>`).join('')}</select></label>
      </div>`,
    )}
    <section class="card card--table">
      ${list.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>When</th><th>Product</th><th>Type</th><th class="numeric">Change</th><th>Reference</th><th>User</th></tr></thead><tbody>${list.map((movement) => { const product = state.store.products.find((candidate) => candidate.id === movement.productId); return `<tr><td>${formatDateTime(movement.occurredAt)}</td><td>${escapeHtml(product?.name || movement.productName || 'Unknown')}</td><td>${badge(movement.type, movement.type === 'SALE' ? 'info' : movement.type === 'RECEIPT' ? 'success' : 'muted')}</td><td class="numeric">${movement.quantityDelta > 0 ? '+' : ''}${movement.quantityDelta}</td><td>${escapeHtml(movement.reference || '—')}</td><td>${escapeHtml(state.store.userName(movement.actorId))}</td></tr>`; }).join('')}</tbody></table></div>` : emptyState({ iconName: 'clock', title: 'No movements in this range', message: 'Adjust the date range or movement filters.' })}
    </section>
  `;
}

function purchasingHtml(state, purchaseOrders) {
  const list = (purchaseOrders || []).filter((po) => !filters.poStatus || po.status === filters.poStatus);
  return `
    ${reportSectionHead(
      'Purchasing report',
      'Purchase-order status and received value.',
      `<label class="filter-field"><span>Status</span><select data-report-filter="poStatus"><option value="">All statuses</option>${['DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED'].map((status) => `<option value="${status}" ${filters.poStatus === status ? 'selected' : ''}>${status.replace(/_/g, ' ')}</option>`).join('')}</select></label>`,
    )}
    <section class="card card--table">
      ${list.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>PO</th><th>Supplier</th><th>Status</th><th>Expected</th><th class="numeric">Ordered value</th><th class="numeric">Received value</th></tr></thead><tbody>${list.map((po) => `<tr><td><a class="table-link" href="#/purchasing/${escapeHtml(po.id)}" data-nav>${escapeHtml(po.number)}</a></td><td>${escapeHtml(po.supplierName)}</td><td>${badge(po.status.replace(/_/g, ' '), 'muted')}</td><td>${formatDate(po.expectedAt)}</td><td class="numeric">${money(po.orderedTotalCents)}</td><td class="numeric">${money(po.receivedTotalCents)}</td></tr>`).join('')}</tbody></table></div>` : emptyState({ iconName: 'truck', title: 'No purchase orders match', message: 'Try another status filter.' })}
    </section>
  `;
}

function contentHtml(state, data) {
  if (activeTab === 'sales') return salesHtml(state, data.sales);
  if (activeTab === 'valuation') return valuationHtml(state, data.valuation);
  if (activeTab === 'low-stock') return lowStockHtml(state, data.lowStock);
  if (activeTab === 'movements') return movementsHtml(state, data.movements);
  if (activeTab === 'purchasing') return purchasingHtml(state, data.purchasing);
  return dailyHtml(state, data.daily);
}

async function loadReportData(state) {
  const query = `from=${encodeURIComponent(filters.from)}&to=${encodeURIComponent(filters.to)}`;
  const isAdmin = state.currentUser.role === 'ADMIN';
  const [daily, sales, lowStock, valuation, movements, purchasing] = await Promise.all([
    api.get(`/api/reports/daily?${query}`),
    api.get(`/api/sales?${query}&limit=500`),
    api.get('/api/reports/low-stock'),
    isAdmin ? api.get('/api/reports/inventory-valuation') : Promise.resolve([]),
    isAdmin ? api.get(`/api/reports/stock-movements?${query}&limit=1000`) : Promise.resolve([]),
    isAdmin ? api.get('/api/reports/purchasing') : Promise.resolve([]),
  ]);
  return { daily, sales, lowStock, valuation, movements, purchasing };
}

export async function renderReports(ctx) {
  const { state } = ctx;
  const today = state.store.meta.businessDate || new Date().toISOString().slice(0, 10);
  if (!filters.from) filters.from = today;
  if (!filters.to) filters.to = today;
  if (filters.from > filters.to) filters.from = filters.to;
  if (state.currentUser.role === 'CASHIER' && TABS.find((tab) => tab.id === activeTab)?.adminOnly) {
    activeTab = 'daily';
  }
  const data = await loadReportData(state);
  return {
    html: `
      ${pageHeader({
        eyebrow: 'Insights · saved ledger',
        title: 'Reports',
        description: state.currentUser.role === 'CASHIER'
          ? 'Limited cashier reporting: your own daily sales and sales history. Cost and valuation reports are administrator-only.'
          : 'Daily sales, history, inventory valuation, low stock, movements, and purchasing reports from the demo fixtures.',
        actions: `<button class="btn btn--secondary" type="button" data-print-report>${icon('print', 16)} Print report</button>`,
      })}
      <div class="toolbar toolbar--wrap">
        <label class="filter-field"><span>From</span><input id="report-from" type="date" value="${escapeHtml(filters.from)}"></label>
        <label class="filter-field"><span>To</span><input id="report-to" type="date" value="${escapeHtml(filters.to)}"></label>
        <span class="toolbar__note">${icon('info', 15)} Tax totals follow each sale snapshot. Current setting: ${state.store.settings.taxEnabled ? formatPercentFromBps(state.store.settings.taxRateBps) : 'disabled'}.</span>
      </div>
      <div class="report-tabs" role="tablist" aria-label="Report type">${tabsHtml(state)}</div>
      <div class="report-print" id="report-content" data-print-area>${contentHtml(state, data)}</div>
    `,
    after(container) {
      const content = container.querySelector('#report-content');
      let currentData = data;
      container.querySelectorAll('[data-report-tab]').forEach((button) => {
        button.addEventListener('click', () => {
          activeTab = button.dataset.reportTab;
          container.querySelectorAll('[data-report-tab]').forEach((candidate) => {
            const active = candidate.dataset.reportTab === activeTab;
            candidate.classList.toggle('is-active', active);
            candidate.setAttribute('aria-selected', active ? 'true' : 'false');
          });
          content.innerHTML = contentHtml(state, currentData);
        });
      });
      const reload = async (event) => {
        filters.from = container.querySelector('#report-from').value;
        filters.to = container.querySelector('#report-to').value;
        if (!filters.from || !filters.to || filters.from > filters.to) {
          filters.from = today;
          filters.to = today;
          container.querySelector('#report-from').value = today;
          container.querySelector('#report-to').value = today;
          return;
        }
        content.innerHTML = loadingState('Loading report data…');
        try {
          currentData = await loadReportData(state);
          content.innerHTML = contentHtml(state, currentData);
        } catch (error) {
          content.innerHTML = `<div class="state-card"><h3>Report unavailable</h3><p>${escapeHtml(error.message)}</p><button class="btn btn--secondary" type="button" data-report-retry>Retry</button></div>`;
          content.querySelector('[data-report-retry]')?.addEventListener('click', reload);
        }
      };
      container.querySelector('#report-from').addEventListener('change', reload);
      container.querySelector('#report-to').addEventListener('change', reload);
      content.addEventListener('change', (event) => {
        const filter = event.target.closest('[data-report-filter]');
        if (!filter) return;
        filters[filter.dataset.reportFilter] = filter.value;
        content.innerHTML = contentHtml(state, currentData);
      });
      container.querySelector('[data-print-report]').addEventListener('click', () => printPrototype('report'));
    },
    focus: 'h1',
  };
}
