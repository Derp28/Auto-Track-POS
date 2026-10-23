import { badge, emptyState, escapeHtml, icon, money, pageHeader, saleStatusLabel, saleStatusTone } from '../js/ui.js';
import { formatDateTime, formatPercentFromBps } from '../js/money.js';
import { adminOverrideDialog } from '../components/dialog.js';
import { openVoidDialog } from '../components/void-dialog.js';
import { openReturnWizard } from '../components/return-wizard.js';
import { rerender } from '../js/router.js';
import { renderDenied, renderNotFound } from './not-found.js';

function actionState(sale, state) {
  const sameDay = sale.businessDate === state.store.meta.businessDate;
  const hasReturns = sale.returns.length > 0;
  const remainingQty = sale.items.reduce((total, line) => {
    const returned = sale.returnedQuantityByLine?.[line.id] || 0;
    return total + Math.max(0, line.quantity - returned);
  }, 0);
  return {
    sameDay,
    hasReturns,
    remainingQty,
    canVoid: sale.status !== 'VOIDED' && sameDay && !hasReturns,
    canReturn: sale.status !== 'VOIDED' && remainingQty > 0,
    voidBlockReason: sale.status === 'VOIDED'
      ? 'This sale is already voided.'
      : hasReturns
        ? 'A sale with a return cannot be voided.'
        : !sameDay
          ? 'Voids are limited to the current business day.'
          : '',
  };
}

export async function renderSaleDetail(ctx) {
  const { state, params } = ctx;
  let sale = state.store.getSale(params.id);
  if (!sale || !sale.items) {
    try {
      sale = await state.store.ensureSale(params.id);
    } catch (error) {
      if (error.status === 404) return renderNotFound(ctx);
      if (error.status === 403) {
        return renderDenied({ ...ctx, reason: 'Cashiers can only view their own sales.' });
      }
      throw error;
    }
  }
  if (!sale) return renderNotFound(ctx);
  if (state.currentUser.role === 'CASHIER' && sale.cashierId !== state.currentUser.id) {
    return renderDenied({ ...ctx, reason: 'Cashiers can only view their own sales.' });
  }
  const settings = state.store.settings;
  const isAdmin = state.currentUser.role === 'ADMIN';
  const actions = actionState(sale, state);
  const returnedQty = sale.items.reduce((total, line) => total + (sale.returnedQuantityByLine?.[line.id] || 0), 0);

  return {
    html: `
      ${pageHeader({
        eyebrow: `Sale detail · ${sale.businessDate}`,
        title: sale.number,
        description: `${formatDateTime(sale.createdAt, settings.timezone)} · ${sale.terminal} · ${sale.cashierName}`,
        actions: `
          <a class="btn btn--secondary" href="#/sales" data-nav>${icon('arrowLeft', 16)} Sales</a>
          <a class="btn btn--secondary" href="#/receipt/${escapeHtml(sale.id)}" data-nav>${icon('receipt', 16)} Receipt</a>
          ${actions.canReturn ? `<button class="btn btn--secondary" type="button" data-return-action>${icon(state.currentUser.role === 'CASHIER' ? 'lock' : 'refresh', 16)} ${state.currentUser.role === 'CASHIER' ? 'Request return' : 'Return items'}</button>` : ''}
          ${sale.status !== 'VOIDED' ? `<button class="btn btn--danger" type="button" data-void-action ${actions.canVoid ? '' : 'disabled'} title="${escapeHtml(actions.voidBlockReason)}">${icon(state.currentUser.role === 'CASHIER' ? 'lock' : 'alert', 16)} ${state.currentUser.role === 'CASHIER' ? 'Request void' : 'Void sale'}</button>` : ''}
        `,
      })}

      <div class="detail-banner">
        <div class="detail-banner__status">
          ${badge(saleStatusLabel(sale.status), saleStatusTone(sale.status))}
          ${returnedQty ? `<span>${returnedQty} item${returnedQty === 1 ? '' : 's'} returned</span>` : ''}
        </div>
        <p>${icon('info', 15)} Saved sale record. Original sale lines are immutable; returns and voids are separate history records.</p>
      </div>

      ${sale.status === 'VOIDED' && sale.void ? `
        <div class="callout callout--danger callout--large">
          ${icon('alert', 20)}
          <div>
            <strong>Voided ${formatDateTime(sale.void.createdAt, settings.timezone)}</strong>
            <p>${escapeHtml(sale.void.reason)}</p>
            <small>Voided by ${escapeHtml(state.store.userName(sale.void.voidedBy))}${sale.void.approvedBy ? ` · Approved by ${escapeHtml(state.store.userName(sale.void.approvedBy))}` : ''} · Stock restocked</small>
          </div>
        </div>
      ` : ''}

      <div class="detail-metrics">
        <article class="metric-card"><span>Total</span><strong>${money(sale.totalCents, sale.currency)}</strong><small>${sale.payments.map((payment) => payment.method === 'CASH' ? 'Cash' : 'External card').join(' + ')}</small></article>
        <article class="metric-card"><span>Subtotal</span><strong>${money(sale.subtotalCents, sale.currency)}</strong><small>Before discounts and tax</small></article>
        <article class="metric-card"><span>Discounts</span><strong>${money(sale.discountCents, sale.currency)}</strong><small>Line percentage only</small></article>
        <article class="metric-card"><span>Tax</span><strong>${money(sale.taxCents, sale.currency)}</strong><small>${sale.taxRateBps ? `${formatPercentFromBps(sale.taxRateBps)} ${sale.taxInclusive ? 'inclusive' : 'exclusive'} snapshot` : 'Tax disabled on this sale'}</small></article>
        <article class="metric-card"><span>Returned</span><strong>${money(sale.returnedCents || 0, sale.currency)}</strong><small>${sale.returns.length} return document${sale.returns.length === 1 ? '' : 's'}</small></article>
        ${isAdmin ? `<article class="metric-card"><span>Cost value sold</span><strong>${money(sale.items.reduce((total, line) => total + line.costValueCents, 0), sale.currency)}</strong><small>Admin-only cost snapshot</small></article>` : ''}
      </div>

      <div class="detail-grid">
        <div class="detail-main">
          <section class="card card--table">
            <div class="card__head"><div><h2>Original sale lines</h2><p>Returned quantity is derived from separate return documents.</p></div></div>
            <div class="table-wrap">
              <table class="data-table data-table--detail">
                <thead><tr><th>Item</th><th class="numeric">Sold</th><th class="numeric">Returned</th><th class="numeric">Remaining</th><th class="numeric">Unit price</th><th class="numeric">Line total</th>${isAdmin ? '<th class="numeric">Cost value</th>' : ''}</tr></thead>
                <tbody>
                  ${sale.items.map((line) => {
                    const returned = sale.returnedQuantityByLine?.[line.id] || 0;
                    return `
                      <tr>
                        <td><strong>${escapeHtml(line.name)}</strong><small class="cell-sub">${escapeHtml(line.sku)}${line.discountBps ? ` · ${formatPercentFromBps(line.discountBps)} discount` : ''}${line.note ? ` · ${escapeHtml(line.note)}` : ''}</small></td>
                        <td class="numeric">${line.quantity}</td>
                        <td class="numeric">${returned}</td>
                        <td class="numeric">${line.quantity - returned}</td>
                        <td class="numeric">${money(line.unitPriceCents, sale.currency)}</td>
                        <td class="numeric"><strong>${money(line.totalCents, sale.currency)}</strong>${line.discountCents ? `<small class="cell-sub text-danger">−${money(line.discountCents, sale.currency)}</small>` : ''}</td>
                        ${isAdmin ? `<td class="numeric">${money(line.costValueCents, sale.currency)}</td>` : ''}
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </section>

          <section class="card card--table">
            <div class="card__head"><div><h2>Payments</h2><p>Immutable payment snapshots. No card data is stored.</p></div></div>
            <div class="table-wrap">
              <table class="data-table">
                <thead><tr><th>Method</th><th class="numeric">Amount</th><th class="numeric">Tendered</th><th class="numeric">Change</th><th>Reference</th></tr></thead>
                <tbody>
                  ${sale.payments.map((payment) => `
                    <tr>
                      <td>${badge(payment.method === 'CASH' ? 'Cash' : 'External card', payment.method === 'CASH' ? 'success' : 'info')}</td>
                      <td class="numeric">${money(payment.amountCents, sale.currency)}</td>
                      <td class="numeric">${money(payment.tenderedCents, sale.currency)}</td>
                      <td class="numeric">${money(payment.changeCents, sale.currency)}</td>
                      <td>${payment.reference ? escapeHtml(payment.reference) : '<span class="muted">—</span>'}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </section>

          <section class="card">
            <div class="card__head"><div><h2>Return history</h2><p>Separate documents. Original line totals are never rewritten.</p></div>${badge(`${sale.returns.length} return${sale.returns.length === 1 ? '' : 's'}`, sale.returns.length ? 'warning' : 'muted')}</div>
            ${sale.returns.length ? sale.returns.map((entry) => `
              <article class="return-record">
                <div class="return-record__head">
                  <div><strong>${escapeHtml(entry.number)}</strong><small>${formatDateTime(entry.createdAt, settings.timezone)} · ${escapeHtml(entry.reason)}</small></div>
                  <strong>${money(entry.refundCents, sale.currency)}</strong>
                </div>
                <div class="return-record__meta">
                  <span>${badge(entry.refundMethod === 'CASH' ? 'Cash refund' : 'Card reversal', entry.refundMethod === 'CASH' ? 'success' : 'info')}</span>
                  <span>By ${escapeHtml(state.store.userName(entry.cashierId))}</span>
                  ${entry.approvedBy ? `<span>Approved by ${escapeHtml(state.store.userName(entry.approvedBy))}</span>` : ''}
                </div>
                <ul class="return-record__items">
                  ${entry.items.map((item) => `<li><span>${item.quantity} × ${escapeHtml(item.name)}</span><span>${money(item.refundCents, sale.currency)}${item.restock ? ' · restocked' : ' · not restocked'}</span></li>`).join('')}
                </ul>
              </article>
            `).join('') : emptyState({ iconName: 'refresh', title: 'No returns on this sale', message: 'Returns appear here as new documents. The original sale stays unchanged.' })}
          </section>
        </div>

        <aside class="detail-side">
          <section class="card">
            <div class="card__head"><div><h2>Sale controls</h2><p>Corrections require a reason and are recorded in the audit log.</p></div></div>
            <div class="stack">
              <a class="btn btn--secondary btn--block" href="#/receipt/${escapeHtml(sale.id)}" data-nav>${icon('print', 16)} Open receipt preview</a>
              ${actions.canReturn ? `<button class="btn btn--secondary btn--block" type="button" data-return-action>${icon(state.currentUser.role === 'CASHIER' ? 'lock' : 'refresh', 16)} ${state.currentUser.role === 'CASHIER' ? 'Request return with approval' : 'Return items'}</button>` : ''}
              ${sale.status !== 'VOIDED' ? `<button class="btn btn--danger btn--block" type="button" data-void-action ${actions.canVoid ? '' : 'disabled'} title="${escapeHtml(actions.voidBlockReason)}">${icon(state.currentUser.role === 'CASHIER' ? 'lock' : 'alert', 16)} ${state.currentUser.role === 'CASHIER' ? 'Request void with approval' : 'Void sale'}</button>` : ''}
            </div>
            ${!actions.canVoid && actions.voidBlockReason ? `<div class="callout callout--warning">${icon('info', 16)} <span>${escapeHtml(actions.voidBlockReason)}</span></div>` : ''}
            <div class="callout callout--muted">${icon('lock', 16)} <span>Cashiers can correct only their own sales and must have an administrator approve the correction. The server enforces both rules.</span></div>
          </section>

          <section class="card">
            <div class="card__head"><div><h2>Record details</h2><p>Saved sale snapshot.</p></div></div>
            <dl class="detail-list">
              <div><span>Sale ID</span><strong>${escapeHtml(sale.id)}</strong></div>
              <div><span>Business date</span><strong>${escapeHtml(sale.businessDate)}</strong></div>
              <div><span>Cashier</span><strong>${escapeHtml(sale.cashierName)}</strong></div>
              <div><span>Terminal</span><strong>${escapeHtml(sale.terminal)}</strong></div>
              <div><span>Currency</span><strong>${escapeHtml(sale.currency)}</strong></div>
              <div><span>Return policy</span><strong>${isAdmin ? 'Admin controls' : 'Counter policy'}</strong></div>
            </dl>
            ${sale.note ? `<div class="sale-note-view"><span>Sale note</span><p>${escapeHtml(sale.note)}</p></div>` : ''}
          </section>

          <section class="card card--subtle">
            <div class="card__head"><div><h2>Return rules</h2></div></div>
            <ul class="rule-list">
              <li>Returns are separate immutable documents with original-line snapshots.</li>
              <li>Already-returned quantities come from return lines, not sale lines.</li>
              <li>Restocking restores the original proportional cost value.</li>
              <li>A sale with a return cannot be voided.</li>
              <li>Voids are limited to the current business day.</li>
            </ul>
          </section>
        </aside>
      </div>
    `,
    after(container) {
      const requestReturn = async () => {
        let approval = null;
        if (state.currentUser.role === 'CASHIER') {
          approval = await adminOverrideDialog({
            action: 'create a return against this sale',
            details: 'The return will record the approving administrator and keep the original sale unchanged.',
          });
          if (!approval) return;
        }
        openReturnWizard({ state, sale, approval, onDone: rerender });
      };
      const requestVoid = async () => {
        let approval = null;
        if (state.currentUser.role === 'CASHIER') {
          approval = await adminOverrideDialog({
            action: 'void this sale',
            details: 'Voids restock every line and keep the original record for review. A return on this sale blocks a void.',
          });
          if (!approval) return;
        }
        openVoidDialog({ state, sale, approval, onDone: rerender });
      };
      container.querySelectorAll('[data-return-action]').forEach((button) => button.addEventListener('click', requestReturn));
      container.querySelectorAll('[data-void-action]').forEach((button) => {
        if (!button.disabled) button.addEventListener('click', requestVoid);
      });
    },
    focus: 'h1',
  };
}
