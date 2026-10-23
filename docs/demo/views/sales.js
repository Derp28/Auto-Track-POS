import { badge, emptyState, escapeHtml, icon, money, pageHeader, saleStatusLabel, saleStatusTone } from '../js/ui.js';
import { formatDateTime } from '../js/money.js';
import { navigate } from '../js/router.js';

const filters = {
  query: '',
  status: '',
  cashier: '',
  from: '',
  to: '',
  page: 1,
};

const PAGE_SIZE = 6;

function rowHtml(sale, isCashier) {
  return `
    <tr>
      <td>
        <a class="table-link" href="#/sales/${escapeHtml(sale.id)}" data-nav>${escapeHtml(sale.number)}</a>
        <small class="cell-sub">${escapeHtml(sale.terminal)}</small>
      </td>
      <td>
        <span>${escapeHtml(formatDateTime(sale.createdAt))}</span>
        <small class="cell-sub">${escapeHtml(sale.businessDate)}</small>
      </td>
      ${isCashier ? '' : `<td>${escapeHtml(sale.cashierName)}</td>`}
      <td class="numeric">${sale.totalQuantity ?? sale.items.reduce((total, line) => total + line.quantity, 0)}</td>
      <td class="numeric">
        <strong>${money(sale.totalCents, sale.currency)}</strong>
        ${sale.returnedCents ? `<small class="cell-sub text-danger">−${money(sale.returnedCents, sale.currency)} returned</small>` : ''}
      </td>
      <td>${badge(saleStatusLabel(sale.status), saleStatusTone(sale.status))}</td>
      <td class="numeric"><a class="text-link" href="#/sales/${escapeHtml(sale.id)}" data-nav>View ${icon('arrowRight', 13)}</a></td>
    </tr>
  `;
}

function filteredSales(state) {
  const isCashier = state.currentUser.role === 'CASHIER';
  const query = filters.query.trim().toLowerCase();
  return state.store
    .getSales(state.currentUser)
    .filter((sale) => {
      if (query) {
        const haystack = `${sale.number} ${sale.cashierName} ${sale.terminal}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      if (filters.status && sale.status !== filters.status) return false;
      if (!isCashier && filters.cashier && sale.cashierId !== filters.cashier) return false;
      if (filters.from && sale.businessDate < filters.from) return false;
      if (filters.to && sale.businessDate > filters.to) return false;
      return true;
    });
}

function tableHtml(state) {
  const isCashier = state.currentUser.role === 'CASHIER';
  const sales = filteredSales(state);
  const pages = Math.max(1, Math.ceil(sales.length / PAGE_SIZE));
  filters.page = Math.min(filters.page, pages);
  const start = (filters.page - 1) * PAGE_SIZE;
  const pageRows = sales.slice(start, start + PAGE_SIZE);
  return {
    count: sales.length,
    html: pageRows.length
      ? `
        <div class="table-wrap">
          <table class="data-table data-table--sales">
            <thead><tr><th>Sale</th><th>Date / time</th>${isCashier ? '' : '<th>Cashier</th>'}<th class="numeric">Items</th><th class="numeric">Total</th><th>Status</th><th></th></tr></thead>
            <tbody>${pageRows.map((sale) => rowHtml(sale, isCashier)).join('')}</tbody>
          </table>
        </div>
        <div class="table-pagination">
          <span>Showing ${start + 1}–${Math.min(start + PAGE_SIZE, sales.length)} of ${sales.length} sales</span>
          <div class="pagination-buttons">
            <button class="btn btn--ghost btn--small" type="button" data-sales-page="${filters.page - 1}" ${filters.page <= 1 ? 'disabled' : ''}>Previous</button>
            <span class="page-indicator">Page ${filters.page} of ${pages}</span>
            <button class="btn btn--ghost btn--small" type="button" data-sales-page="${filters.page + 1}" ${filters.page >= pages ? 'disabled' : ''}>Next</button>
          </div>
        </div>
      `
      : emptyState({
          iconName: 'receipt',
          title: 'No sales match these filters',
          message: 'Try clearing the search, widening the date range, or choosing another status.',
          action: '<button class="btn btn--secondary" type="button" data-clear-sales-filters>Clear filters</button>',
        }),
  };
}

export function renderSales(ctx) {
  const { state } = ctx;
  const isCashier = state.currentUser.role === 'CASHIER';
  const cashiers = state.store.users.filter((user) => user.role === 'CASHIER');
  const initial = tableHtml(state);
  return {
    html: `
      ${pageHeader({
        eyebrow: 'Sales history',
        title: isCashier ? 'My sales' : 'Sales',
        description: isCashier
          ? 'Only sales recorded under your user are shown. Cost and value are hidden.'
          : 'Review completed sales, voided records, and return activity for the shop.',
        actions: `
          <a class="btn btn--secondary" href="#/reports" data-nav>${icon('chart', 16)} Reports</a>
          <a class="btn btn--primary" href="#/checkout" data-nav>${icon('cart', 16)} New sale</a>
        `,
      })}
      <div class="toolbar toolbar--wrap">
        <div class="search-field search-field--compact">
          <span class="search-field__icon">${icon('search', 17)}</span>
          <input id="sales-search" type="search" placeholder="Search sale number, cashier, terminal…" value="${escapeHtml(filters.query)}">
        </div>
        <label class="filter-field"><span>Status</span>
          <select id="sales-status">
            <option value="">All statuses</option>
            <option value="COMPLETED" ${filters.status === 'COMPLETED' ? 'selected' : ''}>Completed</option>
            <option value="PARTIALLY_RETURNED" ${filters.status === 'PARTIALLY_RETURNED' ? 'selected' : ''}>Partially returned</option>
            <option value="RETURNED" ${filters.status === 'RETURNED' ? 'selected' : ''}>Returned</option>
            <option value="VOIDED" ${filters.status === 'VOIDED' ? 'selected' : ''}>Voided</option>
          </select>
        </label>
        ${isCashier ? '' : `
          <label class="filter-field"><span>Cashier</span>
            <select id="sales-cashier">
              <option value="">All cashiers</option>
              ${cashiers.map((user) => `<option value="${escapeHtml(user.id)}" ${filters.cashier === user.id ? 'selected' : ''}>${escapeHtml(user.displayName)}</option>`).join('')}
            </select>
          </label>
        `}
        <label class="filter-field"><span>From</span><input id="sales-from" type="date" value="${escapeHtml(filters.from)}"></label>
        <label class="filter-field"><span>To</span><input id="sales-to" type="date" value="${escapeHtml(filters.to)}"></label>
        <button class="btn btn--ghost" type="button" data-clear-sales-filters>${icon('refresh', 15)} Reset</button>
      </div>
      <section class="card card--table" aria-labelledby="sales-table-title">
        <div class="card__head">
          <div><h2 id="sales-table-title">${isCashier ? 'My sales' : 'Sales ledger'}</h2><p id="sales-result-count">${initial.count} record${initial.count === 1 ? '' : 's'} match the current filters.</p></div>
          ${badge(isCashier ? 'Cashier scope' : 'Shop-wide', isCashier ? 'warning' : 'accent')}
        </div>
        <div id="sales-table-body">${initial.html}</div>
      </section>
    `,
    after(container) {
      const body = container.querySelector('#sales-table-body');
      const count = container.querySelector('#sales-result-count');
      const rerenderTable = () => {
        const table = tableHtml(state);
        body.innerHTML = table.html;
        count.textContent = `${table.count} record${table.count === 1 ? '' : 's'} match the current filters.`;
      };
      const search = container.querySelector('#sales-search');
      let timer;
      search.addEventListener('input', () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          filters.query = search.value;
          filters.page = 1;
          rerenderTable();
        }, 140);
      });
      container.querySelector('#sales-status')?.addEventListener('change', (event) => {
        filters.status = event.target.value;
        filters.page = 1;
        rerenderTable();
      });
      container.querySelector('#sales-cashier')?.addEventListener('change', (event) => {
        filters.cashier = event.target.value;
        filters.page = 1;
        rerenderTable();
      });
      container.querySelector('#sales-from')?.addEventListener('change', (event) => {
        filters.from = event.target.value;
        filters.page = 1;
        rerenderTable();
      });
      container.querySelector('#sales-to')?.addEventListener('change', (event) => {
        filters.to = event.target.value;
        filters.page = 1;
        rerenderTable();
      });
      const clear = () => {
        Object.assign(filters, { query: '', status: '', cashier: '', from: '', to: '', page: 1 });
        search.value = '';
        container.querySelector('#sales-status').value = '';
        if (container.querySelector('#sales-cashier')) container.querySelector('#sales-cashier').value = '';
        container.querySelector('#sales-from').value = '';
        container.querySelector('#sales-to').value = '';
        rerenderTable();
      };
      container.querySelectorAll('[data-clear-sales-filters]').forEach((button) => button.addEventListener('click', clear));
      body.addEventListener('click', (event) => {
        const pageButton = event.target.closest('[data-sales-page]');
        if (pageButton) {
          filters.page = Number(pageButton.dataset.salesPage);
          rerenderTable();
          return;
        }
        if (event.target.closest('[data-clear-sales-filters]')) clear();
      });
    },
    focus: 'h1',
  };
}
