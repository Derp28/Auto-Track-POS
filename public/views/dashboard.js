import { escapeHtml, icon, money, pageHeader, statCard, emptyState, errorState, badge, saleStatusLabel, saleStatusTone } from '../js/ui.js';
import { formatDate, formatDateTime, formatPercentFromBps } from '../js/money.js';
import { rerender } from '../js/router.js';

function saleRows(sales, isCashier) {
  return sales.map((sale) => `
    <tr>
      <td>
        <a class="table-link" href="#/sales/${escapeHtml(sale.id)}" data-nav>${escapeHtml(sale.number)}</a>
        <small class="cell-sub">${formatDateTime(sale.createdAt)}</small>
      </td>
      ${isCashier ? '' : `<td>${escapeHtml(sale.cashierName)}</td>`}
      <td class="numeric">${money(sale.totalCents)}</td>
      <td>${badge(saleStatusLabel(sale.status), saleStatusTone(sale.status))}</td>
    </tr>
  `).join('');
}

export function renderDashboard(ctx) {
  const { state } = ctx;
  const data = state.store.getDashboard();
  const isCashier = state.currentUser.role === 'CASHIER';
  const settings = state.store.settings;
  const dateLabel = new Intl.DateTimeFormat('en-PH', {
    timeZone: settings.timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(state.store.meta.clockIso || Date.now()));

  const header = pageHeader({
    eyebrow: dateLabel,
    title: isCashier ? `Good afternoon, ${state.currentUser.displayName.split(' ')[0]}` : 'Shop dashboard',
    description: isCashier
      ? 'Your own counter activity for the current business day. Cost and stock value are hidden for cashier roles.'
      : 'A quick read on today’s counter, stock pressure, and recent shop activity.',
    actions: `<a class="btn btn--primary" href="#/checkout" data-nav>${icon('cart', 17)} New sale</a>`,
  });

  if (!data) {
    return {
      html: `${header}${errorState({
        title: 'Dashboard data was not loaded',
        message: 'The last server snapshot did not include the dashboard. Refresh to ask the server again.',
      })}`,
      after(container) {
        container.querySelector('[data-retry-view]')?.addEventListener('click', async () => {
          await state.store.refreshQuietly();
          rerender();
        });
      },
      focus: 'h1',
    };
  }

  const taxHint = settings.taxEnabled
    ? `${formatPercentFromBps(settings.taxRateBps)} ${settings.taxInclusive ? 'inclusive' : 'exclusive'}`
    : 'Tax disabled in settings';
  const scopeChip = isCashier
    ? badge('Cashier · own sales', 'warning')
    : badge('Administrator · shop-wide', 'accent');

  return {
    html: `
      ${header}
      <section class="scope-strip" aria-label="Current data scope">
        <div class="scope-strip__main">
          <span class="scope-strip__icon">${icon(isCashier ? 'lock' : 'store', 18)}</span>
          <p><strong>${escapeHtml(data.scopeLabel)}</strong><span>${isCashier ? 'Only sales recorded under your account are shown. Cost and inventory value are hidden.' : 'All counters, users, and stock data are visible to administrators.'}</span></p>
        </div>
        <div class="scope-strip__meta">
          ${scopeChip}
          <span>Clock: ${formatDateTime(state.store.meta.clockIso, settings.timezone)}</span>
        </div>
      </section>

      <div class="quick-actions" aria-label="Quick actions">
        <a class="quick-action" href="#/checkout" data-nav><span>${icon('cart', 20)}</span><strong>Start a sale</strong><small>Search parts and take payment</small></a>
        <a class="quick-action" href="#/catalog" data-nav><span>${icon('box', 20)}</span><strong>Browse catalog</strong><small>Prices, stock, and categories</small></a>
        ${isCashier ? `
          <a class="quick-action" href="#/reports" data-nav><span>${icon('chart', 20)}</span><strong>My daily summary</strong><small>Limited cashier reporting</small></a>
          <a class="quick-action" href="#/inventory" data-nav><span>${icon('layers', 20)}</span><strong>Check stock</strong><small>Read-only inventory view</small></a>
        ` : `
          <a class="quick-action" href="#/purchasing" data-nav><span>${icon('truck', 20)}</span><strong>Receive stock</strong><small>Open purchase orders and suppliers</small></a>
          <a class="quick-action" href="#/reports" data-nav><span>${icon('chart', 20)}</span><strong>Review reports</strong><small>Daily sales, valuation, and movements</small></a>
        `}
      </div>

      <section class="stat-grid" aria-label="Today's summary">
        ${statCard({ label: isCashier ? 'My collected sales today' : 'Collected sales today', value: money(data.totalCents), hint: `${data.transactionCount} completed transaction${data.transactionCount === 1 ? '' : 's'}`, tone: 'accent', iconName: 'cash' })}
        ${statCard({ label: 'Average sale', value: money(data.averageSaleCents), hint: 'Completed sales only', iconName: 'chart' })}
        ${statCard({ label: 'Line discounts', value: money(data.discountsCents), hint: 'Discount total', iconName: 'minus' })}
        ${statCard({ label: 'Tax snapshot', value: money(data.taxCents), hint: taxHint, iconName: 'receipt' })}
        ${statCard({ label: 'Refunds', value: money(data.refundsCents), hint: `${data.returnsCount} return${data.returnsCount === 1 ? '' : 's'} today`, tone: data.refundsCents ? 'warning' : '', iconName: 'refresh' })}
        ${statCard({ label: 'Voids', value: String(data.voidCount), hint: 'Same-day voids', tone: data.voidCount ? 'danger' : '', iconName: 'alert' })}
      </section>

      <div class="dashboard-grid">
        <section class="card card--table">
          <div class="card__head">
            <div><h2>Recent sales</h2><p>Latest completed and voided transactions for this scope.</p></div>
            <a class="text-link" href="#/sales" data-nav>All sales ${icon('arrowRight', 15)}</a>
          </div>
          ${data.recentSales.length ? `
            <div class="table-wrap">
              <table class="data-table">
                <thead><tr><th>Sale</th>${isCashier ? '' : '<th>Cashier</th>'}<th class="numeric">Total</th><th>Status</th></tr></thead>
                <tbody>${saleRows(data.recentSales, isCashier)}</tbody>
              </table>
            </div>
          ` : emptyState({ iconName: 'receipt', title: 'No sales yet today', message: 'Completed checkouts appear here as soon as the server confirms them.', action: '<a class="btn btn--secondary" href="#/checkout" data-nav>Open checkout</a>' })}
        </section>

        <section class="card">
          <div class="card__head">
            <div><h2>Low-stock watch</h2><p>Active products at or below their reorder level.</p></div>
            <a class="text-link" href="#/inventory" data-nav>Inventory ${icon('arrowRight', 15)}</a>
          </div>
          ${data.lowStock.length ? `
            <ul class="stock-watch">
              ${data.lowStock.map((product) => `
                <li>
                  <span class="stock-watch__mark ${product.stockOnHand === 0 ? 'is-out' : ''}" aria-hidden="true">${product.stockOnHand === 0 ? '!' : product.stockOnHand}</span>
                  <div class="stock-watch__copy">
                    <strong>${escapeHtml(product.name)}</strong>
                    <small>${escapeHtml(product.sku)} · ${escapeHtml(product.categoryName)}</small>
                  </div>
                  <span class="stock-watch__level">${product.stockOnHand === 0 ? badge('Out', 'danger') : badge(`${product.stockOnHand} / ${product.reorderLevel}`, 'warning')}</span>
                </li>
              `).join('')}
            </ul>
            <div class="card__foot"><span>${data.lowStockCount} product${data.lowStockCount === 1 ? '' : 's'} need attention</span><a class="text-link" href="#/reports" data-nav>Low-stock report ${icon('arrowRight', 14)}</a></div>
          ` : emptyState({ iconName: 'check', title: 'Stock levels look healthy', message: 'No active products are at or below their reorder level.' })}
        </section>
      </div>

      <section class="card card--subtle">
        <div class="card__head">
          <div><h2>Today’s controls</h2><p>Live settings applied to new sales.</p></div>
          ${badge('Server settings', 'muted')}
        </div>
        <div class="control-grid">
          <div><span>Business date</span><strong>${formatDate(state.store.meta.businessDate, settings.timezone)}</strong><small>Cutoff ${escapeHtml(settings.businessDayCutoff)} · ${escapeHtml(settings.timezone)}</small></div>
          <div><span>Tax</span><strong>${settings.taxEnabled ? formatPercentFromBps(settings.taxRateBps) : 'Disabled'}</strong><small>${settings.taxEnabled ? (settings.taxInclusive ? 'Inclusive pricing' : 'Added per line') : '0% exclusive default'}</small></div>
          <div><span>Cashier discount limit</span><strong>${formatPercentFromBps(settings.cashierDiscountLimitBps)}</strong><small>Higher discounts require administrator approval</small></div>
          <div><span>Terminal</span><strong>${escapeHtml(state.terminalLabel)}</strong><small>This browser only · not a shop-wide setting</small></div>
        </div>
      </section>
    `,
    focus: 'h1',
  };
}
