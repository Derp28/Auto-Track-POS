import { escapeHtml, money } from '../js/ui.js';
import { formatDateTime, formatPercentFromBps } from '../js/money.js';

export function receiptHtml(sale, { settings, cashierName, returnedCents = 0 } = {}) {
  const isVoided = sale.status === 'VOIDED';
  return `
    <article class="receipt-print" data-print-area aria-label="Receipt preview for ${escapeHtml(sale.number)}">
      <div class="receipt-print__label">SALE RECEIPT · SAVED TRANSACTION</div>
      <header class="receipt-print__head">
        <h2>${escapeHtml(settings.receiptHeader || settings.shopName)}</h2>
        <p>${escapeHtml(settings.address)}</p>
        <p>${escapeHtml(settings.phone)} · TIN ${escapeHtml(settings.tin)}</p>
      </header>
      <div class="receipt-print__rule"></div>
      ${isVoided ? '<div class="receipt-print__stamp">VOID</div>' : ''}
      <dl class="receipt-print__meta">
        <div><dt>Sale</dt><dd>${escapeHtml(sale.number)}</dd></div>
        <div><dt>Date</dt><dd>${escapeHtml(formatDateTime(sale.createdAt, settings.timezone))}</dd></div>
        <div><dt>Cashier</dt><dd>${escapeHtml(cashierName || 'Cashier')}</dd></div>
        <div><dt>Terminal</dt><dd>${escapeHtml(sale.terminal)}</dd></div>
      </dl>
      <div class="receipt-print__rule"></div>
      <table class="receipt-print__items">
        <thead><tr><th>Qty</th><th>Item</th><th class="numeric">Amount</th></tr></thead>
        <tbody>
          ${sale.items.map((line) => `
            <tr>
              <td>${line.quantity}</td>
              <td>
                <span>${escapeHtml(line.name)}</span>
                <small>${escapeHtml(line.sku)} · ${money(line.unitPriceCents, sale.currency)}</small>
                ${line.discountBps ? `<small class="receipt-print__discount">Discount ${formatPercentFromBps(line.discountBps)}${line.discountReason ? ` · ${escapeHtml(line.discountReason)}` : ''}</small>` : ''}
                ${line.note ? `<small>Note: ${escapeHtml(line.note)}</small>` : ''}
              </td>
              <td class="numeric">${money(line.totalCents, sale.currency)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div class="receipt-print__rule"></div>
      <div class="receipt-print__totals">
        <div><span>Subtotal</span><span>${money(sale.subtotalCents, sale.currency)}</span></div>
        <div><span>Discounts</span><span>${sale.discountCents ? `−${money(sale.discountCents, sale.currency)}` : money(0, sale.currency)}</span></div>
        <div><span>Tax ${sale.taxRateBps ? `(${formatPercentFromBps(sale.taxRateBps)} ${sale.taxInclusive ? 'incl.' : 'excl.'})` : '(disabled)'}</span><span>${money(sale.taxCents, sale.currency)}</span></div>
        <div class="receipt-print__grand"><span>Total</span><span>${money(sale.totalCents, sale.currency)}</span></div>
      </div>
      <div class="receipt-print__rule"></div>
      <div class="receipt-print__payments">
        ${sale.payments.map((payment) => `
          <div><span>${payment.method === 'CASH' ? 'Cash' : 'External card'}${payment.reference ? ` · ${escapeHtml(payment.reference)}` : ''}</span><span>${money(payment.amountCents, sale.currency)}</span></div>
          ${payment.method === 'CASH' && payment.changeCents ? `<div><span>Cash tendered</span><span>${money(payment.tenderedCents, sale.currency)}</span></div><div><span>Change</span><span>${money(payment.changeCents, sale.currency)}</span></div>` : ''}
        `).join('')}
        ${returnedCents ? `<div class="receipt-print__refund"><span>Returned on this sale</span><span>−${money(returnedCents, sale.currency)}</span></div>` : ''}
      </div>
      ${sale.returns?.length ? `<p class="receipt-print__note">This sale has a separate return document. Original sale totals remain unchanged.</p>` : ''}
      <div class="receipt-print__rule"></div>
      <p class="receipt-print__policy">${escapeHtml(settings.returnsPolicy)}</p>
      <p class="receipt-print__thanks">${escapeHtml(settings.receiptFooter)}</p>
      <p class="receipt-print__foot">Auto-Track · ${escapeHtml(sale.number)} · Reproduced from saved sale data</p>
    </article>
  `;
}
