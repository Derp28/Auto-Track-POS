import {
  badge,
  debounce,
  emptyState,
  escapeHtml,
  icon,
  money,
  pageHeader,
} from '../js/ui.js';
import { formatPercentFromBps } from '../js/money.js';
import { confirmDialog } from '../components/dialog.js';
import { openProductForm } from '../components/product-form.js';
import { openCategoryManager } from '../components/category-manager.js';
import { toast } from '../components/toast.js';
import { rerender } from '../js/router.js';

const filters = { query: '', category: '', active: 'all', page: 1 };
const PAGE_SIZE = 9;

function filteredProducts(state) {
  const query = filters.query.trim().toLowerCase();
  return state.store.products
    .filter((product) => {
      if (filters.category && product.categoryId !== filters.category) return false;
      if (filters.active === 'active' && !product.active) return false;
      if (filters.active === 'inactive' && product.active) return false;
      if (query) {
        const haystack = `${product.name} ${product.sku} ${product.barcode} ${state.store.categoryName(product.categoryId)}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
}

function stockBadge(product) {
  if (product.stockOnHand === 0) return badge('Out of stock', 'danger');
  if (product.stockOnHand <= product.reorderLevel) return badge(`${product.stockOnHand} low`, 'warning');
  return badge(String(product.stockOnHand), 'muted');
}

function productRows(state, products) {
  const isAdmin = state.currentUser.role === 'ADMIN';
  return products.map((product) => `
    <tr class="${product.active ? '' : 'row--muted'}">
      <td>
        <div class="product-cell">
          <span class="product-mark" aria-hidden="true">${escapeHtml(product.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase())}</span>
          <div><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.sku)}${product.barcode ? ` · ${escapeHtml(product.barcode)}` : ' · no barcode'}</small></div>
        </div>
      </td>
      <td>${escapeHtml(state.store.categoryName(product.categoryId))}</td>
      <td class="numeric"><strong>${money(product.priceCents)}</strong></td>
      <td class="numeric">${stockBadge(product)}</td>
      <td class="numeric">${product.reorderLevel}</td>
      <td>${product.active ? badge('Active', 'success') : badge('Archived', 'muted')}</td>
      ${isAdmin ? `<td class="numeric">${money(product.costCents)}<small class="cell-sub">${formatPercentFromBps(Math.round((product.costCents / (product.priceCents || 1)) * 10000))} of price</small></td>` : ''}
      ${isAdmin ? `<td class="numeric"><div class="row-actions"><button class="icon-button icon-button--small" type="button" data-edit-product="${escapeHtml(product.id)}" aria-label="Edit ${escapeHtml(product.name)}" title="Edit product">${icon('edit', 15)}</button>${product.active ? `<button class="icon-button icon-button--small icon-button--danger" type="button" data-archive-product="${escapeHtml(product.id)}" aria-label="Archive ${escapeHtml(product.name)}" title="Archive product">${icon('trash', 15)}</button>` : ''}</div></td>` : ''}
    </tr>
  `).join('');
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
        <table class="data-table data-table--catalog">
          <thead><tr><th>Product</th><th>Category</th><th class="numeric">Price</th><th class="numeric">Stock</th><th class="numeric">Reorder</th><th>Status</th>${isAdmin ? '<th class="numeric">Cost</th><th></th>' : ''}</tr></thead>
          <tbody>${productRows(state, pageProducts)}</tbody>
        </table>
      </div>
      <div class="table-pagination">
        <span>Showing ${start + 1}–${Math.min(start + PAGE_SIZE, products.length)} of ${products.length} products</span>
        <div class="pagination-buttons">
          <button class="btn btn--ghost btn--small" type="button" data-catalog-page="${filters.page - 1}" ${filters.page <= 1 ? 'disabled' : ''}>Previous</button>
          <span class="page-indicator">Page ${filters.page} of ${pages}</span>
          <button class="btn btn--ghost btn--small" type="button" data-catalog-page="${filters.page + 1}" ${filters.page >= pages ? 'disabled' : ''}>Next</button>
        </div>
      </div>
    ` : emptyState({
      iconName: 'box',
      title: 'No products match',
      message: 'Try a different search, category, or active-state filter.',
      action: '<button class="btn btn--secondary" type="button" data-clear-catalog-filters>Clear filters</button>',
    }),
  };
}

export function renderCatalog(ctx) {
  const { state } = ctx;
  const isAdmin = state.currentUser.role === 'ADMIN';
  const initial = tableHtml(state);
  return {
    html: `
      ${pageHeader({
        eyebrow: 'Product catalog',
        title: 'Catalog',
        description: isAdmin
          ? 'Search and maintain the auto-parts catalog. Product cost is visible to administrators only.'
          : 'Read-only parts catalog for checkout support. Cost and stock value are hidden for cashier roles.',
        actions: isAdmin ? `<button class="btn btn--secondary" type="button" data-manage-categories>${icon('package', 17)} Categories</button><button class="btn btn--primary" type="button" data-new-product>${icon('plus', 17)} New product</button>` : badge('Read-only cashier view', 'warning'),
      })}
      ${isAdmin ? '' : `<div class="callout callout--warning">${icon('lock', 17)} <span>Cashiers can search the catalog but cannot create, edit, archive, or see cost. The demo API enforces this role boundary.</span></div>`}
      <div class="toolbar toolbar--wrap">
        <div class="search-field search-field--compact">
          <span class="search-field__icon">${icon('search', 17)}</span>
          <input id="catalog-search" type="search" placeholder="Search name, SKU, barcode…" value="${escapeHtml(filters.query)}">
        </div>
        <label class="filter-field"><span>Category</span>
          <select id="catalog-category">
            <option value="">All categories</option>
            ${state.store.categories.map((category) => `<option value="${escapeHtml(category.id)}" ${filters.category === category.id ? 'selected' : ''}>${escapeHtml(category.name)}</option>`).join('')}
          </select>
        </label>
        <label class="filter-field"><span>Status</span>
          <select id="catalog-active">
            <option value="all" ${filters.active === 'all' ? 'selected' : ''}>All products</option>
            <option value="active" ${filters.active === 'active' ? 'selected' : ''}>Active only</option>
            <option value="inactive" ${filters.active === 'inactive' ? 'selected' : ''}>Archived only</option>
          </select>
        </label>
        <button class="btn btn--ghost" type="button" data-clear-catalog-filters>${icon('refresh', 15)} Reset</button>
      </div>
      <section class="card card--table">
        <div class="card__head">
          <div><h2>Products</h2><p id="catalog-count">${initial.count} product${initial.count === 1 ? '' : 's'} match the current filters.</p></div>
          <span class="badge badge--muted">Opening stock changed via adjustments</span>
        </div>
        <div id="catalog-table-body">${initial.html}</div>
      </section>
    `,
    after(container) {
      const body = container.querySelector('#catalog-table-body');
      const count = container.querySelector('#catalog-count');
      const refresh = () => {
        const table = tableHtml(state);
        body.innerHTML = table.html;
        count.textContent = `${table.count} product${table.count === 1 ? '' : 's'} match the current filters.`;
      };
      const search = container.querySelector('#catalog-search');
      const delayed = debounce(() => {
        filters.query = search.value;
        filters.page = 1;
        refresh();
      }, 140);
      search.addEventListener('input', delayed);
      container.querySelector('#catalog-category').addEventListener('change', (event) => {
        filters.category = event.target.value;
        filters.page = 1;
        refresh();
      });
      container.querySelector('#catalog-active').addEventListener('change', (event) => {
        filters.active = event.target.value;
        filters.page = 1;
        refresh();
      });
      const clear = () => {
        Object.assign(filters, { query: '', category: '', active: 'all', page: 1 });
        search.value = '';
        container.querySelector('#catalog-category').value = '';
        container.querySelector('#catalog-active').value = 'all';
        refresh();
      };
      container.querySelectorAll('[data-clear-catalog-filters]').forEach((button) => button.addEventListener('click', clear));
      container.querySelector('[data-manage-categories]')?.addEventListener('click', () => {
        openCategoryManager({ state, onChanged: () => rerender() });
      });
      container.querySelector('[data-new-product]')?.addEventListener('click', () => {
        openProductForm({
          state,
          onSaved: (product) => {
            // Show the new record immediately instead of leaving it on a later page.
            if (product?.sku) {
              filters.query = product.sku;
              filters.page = 1;
              if (search) search.value = product.sku;
            }
            refresh();
          },
        });
      });
      body.addEventListener('click', async (event) => {
        const pageButton = event.target.closest('[data-catalog-page]');
        if (pageButton) {
          filters.page = Number(pageButton.dataset.catalogPage);
          refresh();
          return;
        }
        if (event.target.closest('[data-clear-catalog-filters]')) {
          clear();
          return;
        }
        const edit = event.target.closest('[data-edit-product]');
        if (edit) {
          const product = state.store.products.find((candidate) => candidate.id === edit.dataset.editProduct);
          if (product) openProductForm({ state, product, onSaved: refresh });
          return;
        }
        const archive = event.target.closest('[data-archive-product]');
        if (archive) {
          const product = state.store.products.find((candidate) => candidate.id === archive.dataset.archiveProduct);
          if (!product) return;
          const confirmed = await confirmDialog({
            title: 'Archive this product?',
            message: `${product.name} will be hidden from checkout and new purchase orders. It remains in sales history.`,
            confirmText: 'Archive product',
            tone: 'danger',
            details: 'There is no hard delete. The product and its movement history stay saved.',
          });
          if (!confirmed) return;
          archive.disabled = true;
          try {
            await state.store.archiveProduct(product.id);
            refresh();
            toast(`${product.name} archived.`, { tone: 'success', title: 'Product archived' });
          } catch (error) {
            toast(error.message, { tone: 'danger', title: 'Product not archived' });
          } finally {
            archive.disabled = false;
          }
        }
      });
    },
    focus: 'h1',
  };
}
