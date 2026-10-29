import { badge, escapeHtml, icon, money, pageHeader, printPrototype, saleStatusLabel, saleStatusTone } from '../js/ui.js';
import { receiptHtml } from '../components/receipt.js';
import { showDialog } from '../components/dialog.js';
import { downloadReceiptPdf } from '../js/receipt-pdf.js';
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
        description: 'An 80 mm receipt for this saved sale. Print it or save it as a PDF.',
        actions: `
          <a class="btn btn--secondary" href="#/sales/${escapeHtml(sale.id)}" data-nav>${icon('arrowLeft', 16)} Sale detail</a>
          <button class="btn btn--primary" type="button" data-print-receipt>${icon('print', 17)} Print or save PDF</button>
        `,
      })}
      <div class="receipt-layout">
        <div class="receipt-stage">
          <div class="receipt-stage__label">${badge('80 mm receipt', 'muted')} ${badge(saleStatusLabel(sale.status), saleStatusTone(sale.status))}</div>
          ${receiptHtml(sale, { settings, cashierName: sale.cashierName, returnedCents: sale.returnedCents })}
        </div>
        <aside class="receipt-side">
          <section class="card">
            <div class="card__head"><div><h2>Receipt output</h2><p>Printing or saving a PDF records a reprint audit entry.</p></div></div>
            <div class="stack">
              <button class="btn btn--primary btn--block" type="button" data-print-receipt>${icon('print', 17)} Print or save PDF</button>
              <a class="btn btn--secondary btn--block" href="#/checkout" data-nav>${icon('cart', 17)} Start another sale</a>
              <a class="btn btn--ghost btn--block" href="#/sales" data-nav>${icon('receipt', 17)} Back to sales history</a>
            </div>
            <div class="callout callout--muted">${icon('info', 16)} <span>The layout is sized for 80 mm paper. Print opens the browser dialog for a printer; Save as PDF downloads an 80 mm PDF file.</span></div>
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
      const receipt = container.querySelector('.receipt-print');
      container.querySelectorAll('[data-print-receipt]').forEach((button) => {
        button.addEventListener('click', () => openOutputDialog(sale, state, receipt));
      });
    },
    focus: 'h1',
  };
}

function openOutputDialog(sale, state, receipt) {
  let cancelled = false;
  const control = showDialog({
    title: 'Print or save this receipt',
    description: `${sale.number} · ${money(sale.totalCents, sale.currency)}`,
    body: `
      <div class="stack">
        <button class="btn btn--primary btn--block" type="button" data-receipt-output="print">${icon('print', 17)} Print to a printer</button>
        <button class="btn btn--secondary btn--block" type="button" data-receipt-output="pdf">${icon('download', 17)} Save as PDF (80 mm)</button>
      </div>
      <div class="callout callout--muted">${icon('info', 16)} <span>Print opens the browser dialog to choose the printer and paper size. Save as PDF downloads an 80 mm receipt file. Both actions record a reprint audit entry.</span></div>
    `,
    footer: '<button class="btn btn--ghost" type="button" data-dialog-close>Cancel</button>',
    initialFocus: '[data-receipt-output="print"]',
    onClose: (settled) => {
      if (!settled) cancelled = true;
    },
  });
  const buttons = [...control.dialog.querySelectorAll('[data-receipt-output]')];
  const run = async (mode) => {
    buttons.forEach((button) => {
      button.disabled = true;
    });
    try {
      await state.store.recordReprint(sale.id, state.terminalLabel);
      if (cancelled) return;
      if (mode === 'pdf') {
        await downloadReceiptPdf(receipt, `receipt-${sale.number}.pdf`);
        if (cancelled) return;
        control.setSettled();
        control.close();
        toast('Receipt PDF downloaded.', { tone: 'success', title: 'Saved as PDF' });
        return;
      }
      control.setSettled();
      control.close();
      window.setTimeout(() => printPrototype('receipt'), 120);
    } catch (error) {
      buttons.forEach((button) => {
        button.disabled = false;
      });
      toast(
        mode === 'pdf'
          ? `${error.message} Use Print to a printer and choose "Save as PDF" as the destination.`
          : error.message,
        { tone: 'danger', title: mode === 'pdf' ? 'PDF not created' : 'Print blocked' },
      );
    }
  };
  control.dialog.querySelector('[data-receipt-output="print"]').addEventListener('click', () => run('print'));
  control.dialog.querySelector('[data-receipt-output="pdf"]').addEventListener('click', () => run('pdf'));
}
