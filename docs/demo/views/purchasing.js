import { badge, debounce, emptyState, escapeHtml, icon, money, pageHeader, poStatusLabel, poStatusTone, statCard } from '../js/ui.js';
import { formatDate } from '../js/money.js';
import { openReceiveDialog } from '../components/receive-dialog.js';
import { rerender } from '../js/router.js';

const filters = { query: '', status: '', supplier: '', page: 1 };
const PAGE_SIZE = 7;

function filtered(state) {
  const query = filters.query.trim().toLowerCase();
  return state.store.getPurchaseOrders().filter((po) => {
    if (filters.status && po.status !== filters.status) return false;
    if (filters.supplier && po.supplierId !== filters.supplier) return false;
    if (query && !`${po.number} ${po.supplierName} ${po.notes}`.toLowerCase().includes(query)) return false;
    return true;
  });
}

function rows(state, pos) {
  return pos.map((po) => `
    <tr>
      <td><a class="table-link" href="#/purchasing/${escapeHtml(po.id)}" data-nav>${escapeHtml(po.number)}</a><small class="cell-sub">${escapeHtml(po.notes || 'No notes')}</small></td>
      <td>${escapeHtml(po.supplierName)}</td>
      <td>${badge(poStatusLabel(po.status), poStatusTone(po.status))}</td>
      <td>${formatDate(po.expectedAt)}</td>
      <td>
        <div class="progress-cell">
          <div class="progress-bar" role="img" aria-label="${po.progress}% received"><span style="width:${po.progress}%"></span></div>
          <small>${po.progress}% · ${money(po.receivedTotalCents)} / ${money(po.orderedTotalCents)}</small>
        </div>
      </td>
      <td class="numeric"><strong>${money(po.orderedTotalCents)}</strong></td>
      <td class="numeric">
        <div class="row-actions">
          ${['ORDERED', 'PARTIALLY_RECEIVED'].includes(po.status) ? `<button class="btn btn--ghost btn--small" type="button" data-receive-po="${escapeHtml(po.id)}">${icon('package', 14)} Receive</button>` : ''}
          <a class="text-link" href="#/purchasing/${escapeHtml(po.id)}" data-nav>View ${icon('arrowRight', 13)}</a>
        </div>
      </td>
    </tr>
  `).join('');
}

function tableHtml(state) {
  const pos = filtered(state);
  const pages = Math.max(1, Math.ceil(pos.length / PAGE_SIZE));
  filters.page = Math.min(filters.page, pages);
  const start = (filters.page - 1) * PAGE_SIZE;
  const pagePos = pos.slice(start, start + PAGE_SIZE);
  return {
    count: pos.length,
    html: pagePos.length ? `
      <div class="table-wrap">
        <table class="data-table data-table--po">
          <thead><tr><th>Purchase order</th><th>Supplier</th><th>Status</th><th>Expected</th><th>Progress</th><th class="numeric">Ordered value</th><th></th></tr></thead>
          <tbody>${rows(state, pagePos)}</tbody>
        </table>
      </div>
      <div class="table-pagination">
        <span>Showing ${start + 1}–${Math.min(start + PAGE_SIZE, pos.length)} of ${pos.length} purchase orders</span>
        <div class="pagination-buttons">
          <button class="btn btn--ghost btn--small" type="button" data-po-page="${filters.page - 1}" ${filters.page <= 1 ? 'disabled' : ''}>Previous</button>
          <span class="page-indicator">Page ${filters.page} of ${pages}</span>
          <button class="btn btn--ghost btn--small" type="button" data-po-page="${filters.page + 1}" ${filters.page >= pages ? 'disabled' : ''}>Next</button>
        </div>
      </div>
    ` : emptyState({
      iconName: 'truck',
      title: 'No purchase orders match',
      message: 'Try a different status, supplier, or search term.',
      action: '<button class="btn btn--secondary" type="button" data-clear-po-filters>Clear filters</button>',
    }),
  };
}

export function renderPurchasing(ctx) {
  const { state } = ctx;
  const initial = tableHtml(state);
  const all = state.store.getPurchaseOrders();
  const open = all.filter((po) => ['DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED'].includes(po.status));
  const partial = all.filter((po) => po.status === 'PARTIALLY_RECEIVED');
  const received = all.filter((po) => po.status === 'RECEIVED');
  return {
    html: `
      ${pageHeader({
        eyebrow: 'Purchasing',
        title: 'Purchase orders',
        description: 'Draft, order, receive, and short-close supplier orders. Receiving updates stock value and weighted-average cost.',
        actions: `
          <a class="btn btn--secondary" href="#/purchasing/suppliers" data-nav>${icon('users', 16)} Suppliers</a>
          <a class="btn btn--primary" href="#/purchasing/new" data-nav>${icon('plus', 17)} New purchase order</a>
        `,
      })}
      <section class="stat-grid stat-grid--four" aria-label="Purchasing summary">
        ${statCard({ label: 'Open orders', value: String(open.length), hint: 'Draft, ordered, or partial', tone: 'accent', iconName: 'truck' })}
        ${statCard({ label: 'Partially received', value: String(partial.length), hint: 'Awaiting remaining stock', tone: partial.length ? 'warning' : '', iconName: 'package' })}
        ${statCard({ label: 'Fully received', value: String(received.length), hint: 'Ready to close', tone: 'success', iconName: 'check' })}
        ${statCard({ label: 'Suppliers', value: String(state.store.getSuppliers().length), hint: 'Active suppliers', iconName: 'users' })}
      </section>
      <div class="toolbar toolbar--wrap">
        <div class="search-field search-field--compact">
          <span class="search-field__icon">${icon('search', 17)}</span>
          <input id="po-search" type="search" placeholder="Search PO number, supplier, notes…" value="${escapeHtml(filters.query)}">
        </div>
        <label class="filter-field"><span>Status</span>
          <select id="po-status">
            <option value="">All statuses</option>
            ${['DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED'].map((status) => `<option value="${status}" ${filters.status === status ? 'selected' : ''}>${poStatusLabel(status)}</option>`).join('')}
          </select>
        </label>
        <label class="filter-field"><span>Supplier</span>
          <select id="po-supplier">
            <option value="">All suppliers</option>
            ${state.store.getSuppliers({ includeInactive: true }).map((supplier) => `<option value="${escapeHtml(supplier.id)}" ${filters.supplier === supplier.id ? 'selected' : ''}>${escapeHtml(supplier.name)}</option>`).join('')}
          </select>
        </label>
        <button class="btn btn--ghost" type="button" data-clear-po-filters>${icon('refresh', 15)} Reset</button>
      </div>
      <section class="card card--table">
        <div class="card__head"><div><h2>Purchasing ledger</h2><p id="po-count">${initial.count} order${initial.count === 1 ? '' : 's'} match the current filters.</p></div>${badge('Admin only', 'accent')}</div>
        <div id="po-table-body">${initial.html}</div>
      </section>
    `,
    after(container) {
      const body = container.querySelector('#po-table-body');
      const count = container.querySelector('#po-count');
      const refresh = () => {
        const table = tableHtml(state);
        body.innerHTML = table.html;
        count.textContent = `${table.count} order${table.count === 1 ? '' : 's'} match the current filters.`;
      };
      const search = container.querySelector('#po-search');
      const delayed = debounce(() => {
        filters.query = search.value;
        filters.page = 1;
        refresh();
      }, 140);
      search.addEventListener('input', delayed);
      container.querySelector('#po-status').addEventListener('change', (event) => {
        filters.status = event.target.value;
        filters.page = 1;
        refresh();
      });
      container.querySelector('#po-supplier').addEventListener('change', (event) => {
        filters.supplier = event.target.value;
        filters.page = 1;
        refresh();
      });
      const clear = () => {
        Object.assign(filters, { query: '', status: '', supplier: '', page: 1 });
        search.value = '';
        container.querySelector('#po-status').value = '';
        container.querySelector('#po-supplier').value = '';
        refresh();
      };
      container.querySelectorAll('[data-clear-po-filters]').forEach((button) => button.addEventListener('click', clear));
      body.addEventListener('click', (event) => {
        const pageButton = event.target.closest('[data-po-page]');
        if (pageButton) {
          filters.page = Number(pageButton.dataset.poPage);
          refresh();
          return;
        }
        if (event.target.closest('[data-clear-po-filters]')) {
          clear();
          return;
        }
        const receive = event.target.closest('[data-receive-po]');
        if (receive) {
          const po = state.store.getPurchaseOrder(receive.dataset.receivePo);
          if (po) openReceiveDialog({ state, po, onDone: () => rerender() });
        }
      });
    },
    focus: 'h1',
  };
}
