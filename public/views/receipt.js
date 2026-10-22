import { badge, escapeHtml, icon, money, pageHeader, printPrototype, saleStatusLabel, saleStatusTone } from '../js/ui.js';
import { receiptHtml } from '../components/receipt.js';
import { toast } from '../components/toast.js';
import { renderDenied, renderNotFound } from './not-found.js';

export async function renderReceipt(ctx) {
  const { state, params } = ctx;
  let sale = state.store.getSale(params.id);
  if (!sale || !sale.items) {
    try {
      sale = await state.store.ensureSale(params.id);
    } catch (error) {
      if (error.status === 404) return renderNotFound(ctx);
      if (error.status === 403) {
        return renderDenied({ ...ctx, reason: 'Cashiers can only view receipts for their own sales.' });
      }
      throw error;
    }
  }
  if (!sale) return renderNotFound(ctx);
  if (state.currentUser.role === 'CASHIER' && sale.cashierId !== state.currentUser.id) {
    return renderDenied({ ...ctx, reason: 'Cashiers can only view receipts for their own sales.' });
  }
  const settings = state.store.settings;
  return {
    html: `
      ${pageHeader({
        eyebrow: 'Receipt · saved sale',
        title: `Receipt ${sale.number}`,
        description: 'An 80 mm browser-print view of the saved sale. Printing uses the browser print dialog.',
        actions: `
          <a class="btn btn--secondary" href="#/sales/${escapeHtml(sale.id)}" data-nav>${icon('arrowLeft', 16)} Sale detail</a>
          <button class="btn btn--primary" type="button" data-print-receipt>${icon('print', 17)} Print preview</button>
        `,
      })}
      <div class="receipt-layout">
        <div class="receipt-stage">
          <div class="receipt-stage__label">${badge('80 mm receipt', 'muted')} ${badge(saleStatusLabel(sale.status), saleStatusTone(sale.status))}</div>
          ${receiptHtml(sale, { settings, cashierName: sale.cashierName, returnedCents: sale.returnedCents })}
        </div>
        <aside class="receipt-side">
          <section class="card">
            <div class="card__head"><div><h2>Receipt controls</h2><p>Printing records a reprint audit entry.</p></div></div>
            <div class="stack">
              <button class="btn btn--primary btn--block" type="button" data-print-receipt>${icon('print', 17)} Browser print preview</button>
              <a class="btn btn--secondary btn--block" href="#/checkout" data-nav>${icon('cart', 17)} Start another sale</a>
              <a class="btn btn--ghost btn--block" href="#/sales" data-nav>${icon('receipt', 17)} Back to sales history</a>
            </div>
            <div class="callout callout--muted">${icon('info', 16)} <span>The layout is sized for 80 mm paper. Use the browser print dialog to choose the printer and paper size.</span></div>
          </section>
          <section class="card">
            <div class="card__head"><div><h2>Sale summary</h2><p>Saved transaction snapshot.</p></div></div>
            <div class="detail-list">
              <div><span>Total</span><strong>${money(sale.totalCents, sale.currency)}</strong></div>
              <div><span>Tax</span><strong>${sale.taxRateBps ? `${(sale.taxRateBps / 100).toFixed(2)}%` : 'Disabled'}</strong></div>
              <div><span>Payments</span><strong>${sale.payments.map((payment) => payment.method === 'CASH' ? 'Cash' : 'Card').join(' + ')}</strong></div>
              <div><span>Returns</span><strong>${sale.returns.length || 'None'}</strong></div>
              <div><span>Status</span><strong>${saleStatusLabel(sale.status)}</strong></div>
            </div>
            ${sale.note ? `<div class="sale-note-view"><span>Sale note</span><p>${escapeHtml(sale.note)}</p></div>` : ''}
          </section>
        </aside>
      </div>
    `,
    after(container) {
      container.querySelectorAll('[data-print-receipt]').forEach((button) => {
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            await state.store.recordReprint(sale.id, state.terminalLabel);
            printPrototype('receipt');
          } catch (error) {
            toast(error.message, { tone: 'danger', title: 'Print blocked' });
          } finally {
            button.disabled = false;
          }
        });
      });
    },
    focus: 'h1',
  };
}
