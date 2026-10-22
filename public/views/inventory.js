import {
  badge,
  debounce,
  emptyState,
  escapeHtml,
  icon,
  money,
  pageHeader,
  statCard,
} from '../js/ui.js';
import { formatDateTime } from '../js/money.js';
import { openStockAdjustment } from '../components/stock-adjustment.js';

const filters = { query: '', category: '', lowOnly: false, page: 1 };
const PAGE_SIZE = 9;

const movementLabel = {
  OPENING: 'Opening',
  SALE: 'Sale',
  RETURN: 'Return',
  VOID: 'Void',
  RECEIPT: 'Receipt',
  ADJUSTMENT: 'Adjustment',
};

function filteredProducts(state) {
  const query = filters.query.trim().toLowerCase();
  return state.store.products
    .filter((product) => {
      if (filters.category && product.categoryId !== filters.category) return false;
      if (filters.lowOnly && !(product.active && product.stockOnHand <= product.reorderLevel)) return false;
      if (query) {
        const haystack = `${product.name} ${product.sku} ${product.barcode}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
}

function statusFor(product) {
  if (!product.active) return badge('Archived', 'muted');
  if (product.stockOnHand === 0) return badge('Out of stock', 'danger');
  if (product.stockOnHand <= product.reorderLevel) return badge('Low stock', 'warning');
  return badge('Healthy', 'success');
}

function tableHtml(state) {
  const isAdmin = state.currentUser.role === 'ADMIN';
  const products = filteredProducts(state);
  const pages = Math.max(1, Math.ceil(products.length / PAGE_SIZE));
  filters.page = Math.min(filters.page, pages);
  const start = (filters.page - 1) * PAGE_SIZE;
  const pageProducts = products.slice(start, start + PAGE_SIZE);
  return {
    count: products.length,
    html: pageProducts.length ? `
      <div class="table-wrap">
        <table class="data-table data-table--inventory">
          <thead><tr><th>Product</th><th>Category</th><th class="numeric">On hand</th><th class="numeric">Reorder</th><th>Status</th>${isAdmin ? '<th class="numeric">Stock value</th>' : ''}<th>Last movement</th><th></th></tr></thead>
          <tbody>
            ${pageProducts.map((product) => {
              const movements = state.store.getProductMovements(product.id);
              const last = movements[0];
              return `
                <tr class="${product.active ? '' : 'row--muted'}">
                  <td>
                    <a class="table-link" href="#/inventory/${escapeHtml(product.id)}/movements" data-nav>${escapeHtml(product.name)}</a>
                    <small class="cell-sub">${escapeHtml(product.sku)} · ${escapeHtml(state.store.categoryName(product.categoryId))}</small>
                  </td>
                  <td>${escapeHtml(state.store.categoryName(product.categoryId))}</td>
                  <td class="numeric"><strong>${product.stockOnHand}</strong></td>
                  <td class="numeric">${product.reorderLevel}</td>
                  <td>${statusFor(product)}</td>
                  ${isAdmin ? `<td class="numeric">${money(product.stockValueCents)}<small class="cell-sub">WAC ${money(state.store.wacFor(product))}</small></td>` : ''}
                  <td>${last ? `${badge(movementLabel[last.type] || last.type, last.type === 'SALE' ? 'info' : last.type === 'RECEIPT' ? 'success' : 'muted')}<small class="cell-sub">${formatDateTime(last.occurredAt)}</small>` : '<span class="muted">No movements</span>'}</td>
                  <td class="numeric">
                    <div class="row-actions">
                      ${isAdmin ? `<button class="btn btn--ghost btn--small" type="button" data-adjust-product="${escapeHtml(product.id)}">${icon('plus', 14)} Adjust</button>` : ''}
                      <a class="icon-button icon-button--small" href="#/inventory/${escapeHtml(product.id)}/movements" data-nav aria-label="View stock history for ${escapeHtml(product.name)}" title="Stock history">${icon('clock', 15)}</a>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
      <div class="table-pagination">
        <span>Showing ${start + 1}–${Math.min(start + PAGE_SIZE, products.length)} of ${products.length} stock records</span>
        <div class="pagination-buttons">
          <button class="btn btn--ghost btn--small" type="button" data-inventory-page="${filters.page - 1}" ${filters.page <= 1 ? 'disabled' : ''}>Previous</button>
          <span class="page-indicator">Page ${filters.page} of ${pages}</span>
          <button class="btn btn--ghost btn--small" type="button" data-inventory-page="${filters.page + 1}" ${filters.page >= pages ? 'disabled' : ''}>Next</button>
        </div>
      </div>
    ` : emptyState({
      iconName: 'layers',
      title: 'No stock records match',
      message: 'Try another category or search term, or turn off the low-stock filter.',
      action: '<button class="btn btn--secondary" type="button" data-clear-inventory-filters>Clear filters</button>',
    }),
  };
}

export function renderInventory(ctx) {
  const { state } = ctx;
  const isAdmin = state.currentUser.role === 'ADMIN';
  const initial = tableHtml(state);
  const active = state.store.products.filter((product) => product.active);
  const low = active.filter((product) => product.stockOnHand <= product.reorderLevel);
  const out = active.filter((product) => product.stockOnHand === 0);
  const totalValue = active.reduce((sum, product) => sum + product.stockValueCents, 0);
  return {
    html: `
      ${pageHeader({
        eyebrow: 'Stock control',
        title: 'Inventory',
        description: isAdmin
          ? 'Review on-hand quantities, reorder levels, stock value, and movement history.'
          : 'Read-only stock visibility for cashier support. Cost, value, and adjustments are hidden.',
        actions: isAdmin ? `<a class="btn btn--secondary" href="#/reports" data-nav>${icon('chart', 16)} Stock reports</a>` : badge('Read-only cashier view', 'warning'),
      })}
      ${isAdmin ? '' : `<div class="callout callout--warning">${icon('lock', 17)} <span>Cashiers cannot adjust stock or see inventory value or derived WAC. The server enforces this role boundary.</span></div>`}
      <section class="stat-grid stat-grid--four" aria-label="Inventory summary">
        ${statCard({ label: 'Active SKUs', value: String(active.length), hint: `${state.store.products.length - active.length} archived`, iconName: 'box' })}
        ${statCard({ label: 'Low-stock SKUs', value: String(low.length), hint: 'At or below reorder level', tone: low.length ? 'warning' : '', iconName: 'alert' })}
        ${statCard({ label: 'Out of stock', value: String(out.length), hint: 'Blocked from checkout', tone: out.length ? 'danger' : '', iconName: 'minus' })}
        ${isAdmin
          ? statCard({ label: 'Stock value', value: money(totalValue), hint: 'Derived from stock-value snapshots', tone: 'accent', iconName: 'layers' })
          : statCard({ label: 'Stock access', value: 'Read-only', hint: 'Value hidden for cashiers', iconName: 'lock' })}
      </section>
      <div class="toolbar toolbar--wrap">
        <div class="search-field search-field--compact">
          <span class="search-field__icon">${icon('search', 17)}</span>
          <input id="inventory-search" type="search" placeholder="Search product or SKU…" value="${escapeHtml(filters.query)}">
        </div>
        <label class="filter-field"><span>Category</span>
          <select id="inventory-category">
            <option value="">All categories</option>
            ${state.store.categories.map((category) => `<option value="${escapeHtml(category.id)}" ${filters.category === category.id ? 'selected' : ''}>${escapeHtml(category.name)}</option>`).join('')}
          </select>
        </label>
        <label class="check-filter"><input id="inventory-low" type="checkbox" ${filters.lowOnly ? 'checked' : ''}> <span>Low stock only</span></label>
        <button class="btn btn--ghost" type="button" data-clear-inventory-filters>${icon('refresh', 15)} Reset</button>
      </div>
      <section class="card card--table">
        <div class="card__head">
          <div><h2>Stock ledger</h2><p id="inventory-count">${initial.count} stock record${initial.count === 1 ? '' : 's'} match the current filters.</p></div>
          <span class="badge badge--muted">No negative stock</span>
        </div>
        <div id="inventory-table-body">${initial.html}</div>
      </section>
    `,
    after(container) {
      const body = container.querySelector('#inventory-table-body');
      const count = container.querySelector('#inventory-count');
      const refresh = () => {
        const table = tableHtml(state);
        body.innerHTML = table.html;
        count.textContent = `${table.count} stock record${table.count === 1 ? '' : 's'} match the current filters.`;
      };
      const search = container.querySelector('#inventory-search');
      const delayed = debounce(() => {
        filters.query = search.value;
        filters.page = 1;
        refresh();
      }, 140);
      search.addEventListener('input', delayed);
      container.querySelector('#inventory-category').addEventListener('change', (event) => {
        filters.category = event.target.value;
        filters.page = 1;
        refresh();
      });
      container.querySelector('#inventory-low').addEventListener('change', (event) => {
        filters.lowOnly = event.target.checked;
        filters.page = 1;
        refresh();
      });
      const clear = () => {
        Object.assign(filters, { query: '', category: '', lowOnly: false, page: 1 });
        search.value = '';
        container.querySelector('#inventory-category').value = '';
        container.querySelector('#inventory-low').checked = false;
        refresh();
      };
      container.querySelectorAll('[data-clear-inventory-filters]').forEach((button) => button.addEventListener('click', clear));
      body.addEventListener('click', (event) => {
        const pageButton = event.target.closest('[data-inventory-page]');
        if (pageButton) {
          filters.page = Number(pageButton.dataset.inventoryPage);
          refresh();
          return;
        }
        if (event.target.closest('[data-clear-inventory-filters]')) {
          clear();
          return;
        }
        const adjust = event.target.closest('[data-adjust-product]');
        if (adjust) {
          const product = state.store.products.find((candidate) => candidate.id === adjust.dataset.adjustProduct);
          if (product) openStockAdjustment({ state, product, onDone: refresh });
        }
      });
    },
    focus: 'h1',
  };
}
