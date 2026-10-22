import { badge, emptyState, escapeHtml, icon, money, pageHeader, statCard } from '../js/ui.js';
import { formatDateTime } from '../js/money.js';
import { openStockAdjustment } from '../components/stock-adjustment.js';
import { rerender } from '../js/router.js';
import { renderDenied, renderNotFound } from './not-found.js';

const typeMeta = {
  OPENING: { label: 'Opening', tone: 'muted' },
  SALE: { label: 'Sale', tone: 'info' },
  RETURN: { label: 'Return', tone: 'warning' },
  VOID: { label: 'Void', tone: 'danger' },
  RECEIPT: { label: 'Receipt', tone: 'success' },
  ADJUSTMENT: { label: 'Adjustment', tone: 'accent' },
};

function movementsHtml(state, product, type = '') {
  const movements = state.store.getProductMovements(product.id).filter((movement) => !type || movement.type === type);
  if (!movements.length) {
    return emptyState({ iconName: 'clock', title: 'No movements match', message: 'Try another movement type. Opening balances are shown as history too.' });
  }
  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>When</th><th>Type</th><th class="numeric">Change</th><th class="numeric">Before</th><th class="numeric">After</th><th>Reference</th><th>Reason</th><th>User</th></tr></thead>
        <tbody>
          ${movements.map((movement) => `
            <tr>
              <td>${formatDateTime(movement.occurredAt)}</td>
              <td>${badge(typeMeta[movement.type]?.label || movement.type, typeMeta[movement.type]?.tone || 'muted')}</td>
              <td class="numeric ${movement.quantityDelta > 0 ? 'text-success' : movement.quantityDelta < 0 ? 'text-danger' : ''}">${movement.quantityDelta > 0 ? '+' : ''}${movement.quantityDelta}</td>
              <td class="numeric">${movement.stockBefore}</td>
              <td class="numeric"><strong>${movement.stockAfter}</strong></td>
              <td>${escapeHtml(movement.reference || '—')}</td>
              <td>${escapeHtml(movement.reason || '—')}</td>
              <td>${escapeHtml(state.store.userName(movement.actorId))}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

export function renderStockHistory(ctx) {
  const { state, params } = ctx;
  const product = state.store.getProduct(params.id);
  if (!product) return renderNotFound(ctx);
  if (state.currentUser.role === 'CASHIER' && !state.can('viewInventory')) {
    return renderDenied({ ...ctx, reason: 'Cashiers can view inventory but cannot access restricted stock data.' });
  }
  const isAdmin = state.currentUser.role === 'ADMIN';
  let activeType = '';
  return {
    html: `
      ${pageHeader({
        eyebrow: 'Inventory · movement history',
        title: product.name,
        description: `${product.sku} · ${product.categoryName}`,
        actions: `
          <a class="btn btn--secondary" href="#/inventory" data-nav>${icon('arrowLeft', 16)} Inventory</a>
          ${isAdmin ? `<button class="btn btn--primary" type="button" data-history-adjust>${icon('plus', 16)} Adjust stock</button>` : ''}
        `,
      })}
      <section class="stat-grid stat-grid--four" aria-label="Stock snapshot">
        ${statCard({ label: 'On hand', value: String(product.stockOnHand), hint: `Reorder at ${product.reorderLevel}`, tone: product.stockOnHand <= product.reorderLevel ? 'warning' : '', iconName: 'layers' })}
        ${statCard({ label: 'Status', value: product.active ? (product.stockOnHand === 0 ? 'Out of stock' : product.stockOnHand <= product.reorderLevel ? 'Low stock' : 'Healthy') : 'Archived', hint: product.active ? 'Active product' : 'Hidden from checkout', iconName: 'box' })}
        ${isAdmin ? statCard({ label: 'Stock value', value: money(product.stockValueCents), hint: 'Inventory-value authority', iconName: 'cash' }) : statCard({ label: 'Cost visibility', value: 'Hidden', hint: 'Cashier role', iconName: 'lock' })}
        ${isAdmin ? statCard({ label: 'Derived WAC', value: money(product.wacCents), hint: 'Stock value ÷ quantity', iconName: 'chart' }) : statCard({ label: 'Adjustments', value: 'Read-only', hint: 'Admin permission required', iconName: 'lock' })}
      </section>
      <div class="callout callout--muted">${icon('info', 16)} <span>Every change below is a saved stock movement. Movements are append-only and cannot be edited or deleted.</span></div>
      <section class="card card--table">
        <div class="card__head">
          <div><h2>Movement history</h2><p>Opening balances, sales, receiving, adjustments, returns, and voids.</p></div>
          <label class="filter-field"><span>Movement type</span>
            <select id="history-type">
              <option value="">All movements</option>
              <option value="OPENING">Opening</option>
              <option value="SALE">Sale</option>
              <option value="RECEIPT">Receipt</option>
              <option value="ADJUSTMENT">Adjustment</option>
              <option value="RETURN">Return</option>
              <option value="VOID">Void</option>
            </select>
          </label>
        </div>
        <div id="history-table-body">${movementsHtml(state, product, activeType)}</div>
        <div class="card__foot"><span>Last movement: ${product.stockOnHand >= 0 ? 'stock is not negative' : 'check stock'}</span>${badge(product.stockValueCents ? 'Value snapshot present' : 'Zero stock value', product.stockValueCents ? 'success' : 'muted')}</div>
      </section>
    `,
    after(container) {
      container.querySelector('#history-type').addEventListener('change', (event) => {
        activeType = event.target.value;
        container.querySelector('#history-table-body').innerHTML = movementsHtml(state, product, activeType);
      });
      container.querySelector('[data-history-adjust]')?.addEventListener('click', () => {
        openStockAdjustment({ state, product, onDone: rerender });
      });
    },
    focus: 'h1',
  };
}
