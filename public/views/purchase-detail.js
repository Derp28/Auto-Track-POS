import { badge, emptyState, escapeHtml, icon, money, pageHeader, poStatusLabel, poStatusTone } from '../js/ui.js';
import { formatDate, formatDateTime } from '../js/money.js';
import { confirmDialog, reasonDialog } from '../components/dialog.js';
import { openReceiveDialog } from '../components/receive-dialog.js';
import { toast } from '../components/toast.js';
import { rerender } from '../js/router.js';
import { renderNotFound } from './not-found.js';

export function renderPurchaseDetail(ctx) {
  const { state, params } = ctx;
  const po = state.store.getPurchaseOrder(params.id);
  if (!po) return renderNotFound(ctx);
  const remainingValue = po.orderedTotalCents - po.receivedTotalCents;
  const progress = po.orderedTotalCents ? Math.round((po.receivedTotalCents / po.orderedTotalCents) * 100) : 0;
  const canReceive = ['ORDERED', 'PARTIALLY_RECEIVED'].includes(po.status);
  const canCancel = ['DRAFT', 'ORDERED'].includes(po.status) && !po.receipts.length;
  const canShortClose = po.status === 'PARTIALLY_RECEIVED';

  const markOrdered = async () => {
    const confirmed = await confirmDialog({
      title: `Mark ${po.number} as ordered?`,
      message: 'The draft becomes an ordered purchase order. Lines can no longer be edited.',
      confirmText: 'Mark as ordered',
      details: 'No stock moves until receiving is recorded.',
    });
    if (!confirmed) return;
    try {
      await state.store.orderPurchaseOrder(po.id);
      toast(`Purchase order ${po.number} marked as ordered.`, { tone: 'success', title: 'Order updated' });
      rerender();
    } catch (error) {
      toast(error.message, { tone: 'danger', title: 'Could not update order' });
    }
  };

  const cancelOrder = async () => {
    const reason = await reasonDialog({
      title: `Cancel ${po.number}?`,
      message: 'Cancelling keeps the order and its reason in history. An order with receipts cannot be cancelled.',
      label: 'Cancellation reason',
      confirmText: 'Cancel purchase order',
      tone: 'danger',
    });
    if (!reason) return;
    try {
      await state.store.cancelPurchaseOrder(po.id, { reason });
      toast(`Purchase order ${po.number} cancelled.`, { tone: 'success', title: 'Order cancelled' });
      rerender();
    } catch (error) {
      toast(error.message, { tone: 'danger', title: 'Could not cancel order' });
    }
  };

  const shortClose = async () => {
    const reason = await reasonDialog({
      title: `Short-close ${po.number}?`,
      message: 'The order closes with the quantities already received. Remaining quantities will not arrive.',
      label: 'Short-close reason',
      confirmText: 'Short-close order',
      tone: 'danger',
    });
    if (!reason) return;
    try {
      await state.store.shortClosePurchaseOrder(po.id, { reason });
      toast(`Purchase order ${po.number} short-closed.`, { tone: 'success', title: 'Order closed' });
      rerender();
    } catch (error) {
      toast(error.message, { tone: 'danger', title: 'Could not close order' });
    }
  };

  return {
    html: `
      ${pageHeader({
        eyebrow: 'Purchasing · purchase order',
        title: po.number,
        description: `${po.supplier?.name || 'Unknown supplier'} · expected ${formatDate(po.expectedAt)} · created by ${po.createdByName}`,
        actions: `
          <a class="btn btn--secondary" href="#/purchasing" data-nav>${icon('arrowLeft', 16)} Purchasing</a>
          ${po.status === 'DRAFT' ? `<a class="btn btn--secondary" href="#/purchasing/${escapeHtml(po.id)}/edit" data-nav>${icon('edit', 16)} Edit draft</a><button class="btn btn--primary" type="button" data-mark-ordered>${icon('check', 16)} Mark ordered</button>` : ''}
          ${canReceive ? `<button class="btn btn--primary" type="button" data-receive-order>${icon('package', 16)} Receive stock</button>` : ''}
          ${canShortClose ? `<button class="btn btn--danger" type="button" data-short-close>${icon('alert', 16)} Short-close</button>` : ''}
          ${canCancel ? `<button class="btn btn--danger" type="button" data-cancel-order>${icon('x', 16)} Cancel</button>` : ''}
        `,
      })}
      ${['CANCELLED', 'CLOSED', 'RECEIVED'].includes(po.status) ? `<div class="callout callout--muted">${icon('info', 16)} <span>This purchase order is ${poStatusLabel(po.status).toLowerCase()} and is read-only.${po.cancelReason ? ` Reason: ${escapeHtml(po.cancelReason)}` : ''}${po.shortCloseReason ? ` Short-close reason: ${escapeHtml(po.shortCloseReason)}` : ''}</span></div>` : ''}
      <div class="detail-metrics">
        <article class="metric-card"><span>Status</span><strong>${badge(poStatusLabel(po.status), poStatusTone(po.status))}</strong><small>${po.receipts.length} receipt${po.receipts.length === 1 ? '' : 's'}</small></article>
        <article class="metric-card"><span>Ordered value</span><strong>${money(po.orderedTotalCents)}</strong><small>${po.lines.length} product line${po.lines.length === 1 ? '' : 's'}</small></article>
        <article class="metric-card"><span>Received value</span><strong>${money(po.receivedTotalCents)}</strong><small>${progress}% of ordered value</small></article>
        <article class="metric-card"><span>Remaining value</span><strong>${money(remainingValue)}</strong><small>${canReceive ? 'Ready for another receipt' : 'No further receiving'}</small></article>
      </div>
      <div class="detail-grid">
        <div class="detail-main">
          <section class="card card--table">
            <div class="card__head"><div><h2>Order lines</h2><p>Receiving tracks quantities against each line. Over-receipt is blocked.</p></div>${badge(`${progress}% received`, progress === 100 ? 'success' : 'warning')}</div>
            <div class="table-wrap">
              <table class="data-table">
                <thead><tr><th>Product</th><th class="numeric">Ordered</th><th class="numeric">Received</th><th class="numeric">Remaining</th><th class="numeric">Unit cost</th><th class="numeric">Ordered total</th></tr></thead>
                <tbody>
                  ${po.lines.map((line) => `
                    <tr>
                      <td><strong>${escapeHtml(line.name)}</strong><small class="cell-sub">${escapeHtml(line.sku)}</small></td>
                      <td class="numeric">${line.orderedQty}</td>
                      <td class="numeric">${line.receivedQty}</td>
                      <td class="numeric"><strong>${line.orderedQty - line.receivedQty}</strong></td>
                      <td class="numeric">${money(line.unitCostCents)}</td>
                      <td class="numeric">${money(line.orderedTotalCents)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </section>

          <section class="card">
            <div class="card__head"><div><h2>Receipt history</h2><p>Each receipt updates stock and stock value at the PO unit cost.</p></div>${badge(`${po.receipts.length} receipt${po.receipts.length === 1 ? '' : 's'}`, po.receipts.length ? 'info' : 'muted')}</div>
            ${po.receipts.length ? po.receipts.map((receipt) => `
              <article class="receipt-record">
                <div class="return-record__head">
                  <div><strong>${escapeHtml(receipt.id)}</strong><small>${formatDateTime(receipt.createdAt)} · Received by ${escapeHtml(state.store.userName(receipt.receivedBy))}</small></div>
                  <span>${receipt.items.reduce((sum, item) => sum + item.quantity, 0)} units</span>
                </div>
                <ul class="return-record__items">
                  ${receipt.items.map((item) => {
                    const line = po.lines.find((candidate) => candidate.id === item.lineId);
                    return `<li><span>${item.quantity} × ${escapeHtml(line?.name || 'Unknown product')}</span><span>${money((line?.unitCostCents || 0) * item.quantity)}</span></li>`;
                  }).join('')}
                </ul>
              </article>
            `).join('') : emptyState({ iconName: 'package', title: 'No receipts yet', message: 'Receiving is available after the order is marked as ordered.' })}
          </section>
        </div>

        <aside class="detail-side">
          <section class="card">
            <div class="card__head"><div><h2>Supplier</h2><p>Vendor record.</p></div></div>
            <div class="detail-list">
              <div><span>Name</span><strong>${escapeHtml(po.supplier?.name || 'Unknown')}</strong></div>
              <div><span>Contact</span><strong>${escapeHtml(po.supplier?.contactName || '—')}</strong></div>
              <div><span>Phone</span><strong>${escapeHtml(po.supplier?.phone || '—')}</strong></div>
              <div><span>Email</span><strong>${escapeHtml(po.supplier?.email || '—')}</strong></div>
            </div>
          </section>
          <section class="card">
            <div class="card__head"><div><h2>Order details</h2><p>Timestamps and notes.</p></div></div>
            <dl class="detail-list">
              <div><span>Created</span><strong>${formatDateTime(po.createdAt)}</strong></div>
              <div><span>Ordered</span><strong>${po.orderedAt ? formatDateTime(po.orderedAt) : 'Not yet'}</strong></div>
              <div><span>Expected</span><strong>${formatDate(po.expectedAt)}</strong></div>
              <div><span>Fully received</span><strong>${po.receivedAt ? formatDateTime(po.receivedAt) : '—'}</strong></div>
              <div><span>Closed</span><strong>${po.closedAt ? formatDateTime(po.closedAt) : '—'}</strong></div>
            </dl>
            ${po.notes ? `<div class="sale-note-view"><span>Notes</span><p>${escapeHtml(po.notes)}</p></div>` : ''}
          </section>
          <section class="card card--subtle">
            <div class="card__head"><div><h2>Receiving rules</h2></div></div>
            <ul class="rule-list">
              <li>A receipt is recorded against a single purchase order.</li>
              <li>Received quantity cannot exceed ordered quantity.</li>
              <li>Stock value increases by quantity × PO unit cost.</li>
              <li>Weighted-average cost is recalculated for the product.</li>
              <li>Short-close is only available after a partial receipt.</li>
            </ul>
          </section>
        </aside>
      </div>
    `,
    after(container) {
      container.querySelector('[data-mark-ordered]')?.addEventListener('click', markOrdered);
      container.querySelector('[data-cancel-order]')?.addEventListener('click', cancelOrder);
      container.querySelector('[data-short-close]')?.addEventListener('click', shortClose);
      container.querySelector('[data-receive-order]')?.addEventListener('click', () => {
        openReceiveDialog({ state, po, onDone: rerender });
      });
    },
    focus: 'h1',
  };
}
