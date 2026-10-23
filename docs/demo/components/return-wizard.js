import { badge, escapeHtml, icon, money } from '../js/ui.js';
import { divRoundHalfUp } from '../js/money.js';
import { uuid } from '../js/api.js';
import { showDialog } from './dialog.js';
import { toast } from './toast.js';

function quoteRefund(line, alreadyQty, alreadyRefunded, quantity) {
  if (!Number.isInteger(quantity) || quantity <= 0) return 0;
  const target = divRoundHalfUp(line.totalCents * (alreadyQty + quantity), line.quantity);
  return Math.max(0, target - alreadyRefunded);
}

export function openReturnWizard({ state, sale, approval = null, onDone }) {
  const clientRequestId = uuid();
  const available = sale.items
    .map((line) => ({
      line,
      alreadyQty: sale.returnedQuantityByLine?.[line.id] || 0,
      alreadyRefunded: sale.refundedByLine?.[line.id] || 0,
    }))
    .filter((entry) => entry.alreadyQty < entry.line.quantity);

  if (!available.length) {
    toast('Every line on this sale has already been returned.', { tone: 'info', title: 'Nothing to return' });
    return;
  }

  let control;
  control = showDialog({
    title: `Return items from ${sale.number}`,
    description: 'Create a separate return document. The original sale totals stay unchanged.',
    size: 'lg',
    body: `
      <div class="dialog-copy">
        <div class="return-summary">
          <div><span>Sale</span><strong>${escapeHtml(sale.number)}</strong></div>
          <div><span>Original total</span><strong>${money(sale.totalCents, sale.currency)}</strong></div>
          <div><span>Already refunded</span><strong>${money(sale.returnedCents || 0, sale.currency)}</strong></div>
          <div><span>Approval</span><strong>${approval ? 'Administrator credentials supplied' : 'Administrator account'}</strong></div>
        </div>
        <div class="table-wrap return-table-wrap">
          <table class="data-table data-table--return">
            <thead><tr><th>Original line</th><th>Sold / returned / left</th><th>Return qty</th><th>Refund</th><th>Restock</th></tr></thead>
            <tbody>
              ${available.map(({ line, alreadyQty }) => {
                const remaining = line.quantity - alreadyQty;
                return `
                  <tr data-return-row data-line-id="${escapeHtml(line.id)}" data-already-qty="${alreadyQty}" data-already-refunded="${sale.refundedByLine?.[line.id] || 0}" data-line-total="${line.totalCents}" data-line-qty="${line.quantity}">
                    <td><strong>${escapeHtml(line.name)}</strong><small class="cell-sub">${escapeHtml(line.sku)} · ${money(line.unitPriceCents, sale.currency)}</small></td>
                    <td>${line.quantity} / ${alreadyQty} / <strong>${remaining}</strong></td>
                    <td><input class="qty-input qty-input--return" type="number" min="0" max="${remaining}" step="1" value="0" data-return-qty aria-label="Return quantity for ${escapeHtml(line.name)}"></td>
                    <td class="numeric" data-line-refund>${money(0, sale.currency)}</td>
                    <td><label class="check-inline"><input type="checkbox" data-return-restock checked> <span>Restock</span></label></td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
        <div class="return-options">
          <div class="field">
            <label for="return-method">Refund tender</label>
            <select id="return-method" name="refundMethod">
              <option value="CASH">Cash refund</option>
              <option value="CARD_EXTERNAL">External card reversal</option>
            </select>
            <small class="field-hint">No card data is captured. A card reversal records the refund method only.</small>
          </div>
          <div class="field">
            <label for="return-reason">Return reason <span class="required">*</span></label>
            <textarea id="return-reason" name="returnReason" rows="3" maxlength="240" placeholder="Example: wrong pad size; customer returned with receipt"></textarea>
          </div>
        </div>
        <div class="return-preview" aria-live="polite">
          <div><span>Selected items</span><strong data-return-count>0</strong></div>
          <div><span>Refund total</span><strong data-return-total>${money(0, sale.currency)}</strong></div>
        </div>
        <div class="callout callout--muted">${icon('info', 16)} <span>Restocked lines increase stock and inventory value by the original line cost. The return is saved immediately.</span></div>
        <div data-return-error></div>
      </div>
    `,
    footer: `
      <button class="btn btn--secondary" type="button" data-return-cancel>Cancel</button>
      <button class="btn btn--danger" type="button" data-return-save>${icon('refresh', 16)} Create return</button>
    `,
    initialFocus: '[data-return-qty]',
  });

  const dialog = control.dialog;
  const rows = [...dialog.querySelectorAll('[data-return-row]')];
  const errorSlot = dialog.querySelector('[data-return-error]');

  function currentSelection() {
    return rows
      .map((row) => {
        const input = row.querySelector('[data-return-qty]');
        const qty = Number(input.value);
        const max = Number(input.max);
        return {
          row,
          lineId: row.dataset.lineId,
          quantity: qty,
          max,
          restock: row.querySelector('[data-return-restock]').checked,
          input,
        };
      })
      .filter((entry) => Number.isFinite(entry.quantity) && entry.quantity > 0);
  }

  function updatePreview() {
    let total = 0;
    let count = 0;
    for (const row of rows) {
      const input = row.querySelector('[data-return-qty]');
      const qty = Number(input.value);
      const lineTotal = Number(row.dataset.lineTotal);
      const lineQty = Number(row.dataset.lineQty);
      const alreadyQty = Number(row.dataset.alreadyQty);
      const alreadyRefunded = Number(row.dataset.alreadyRefunded);
      const refund = quoteRefund({ totalCents: lineTotal, quantity: lineQty }, alreadyQty, alreadyRefunded, qty);
      row.querySelector('[data-line-refund]').textContent = money(refund, sale.currency);
      total += refund;
      if (Number.isInteger(qty) && qty > 0) count += qty;
    }
    dialog.querySelector('[data-return-count]').textContent = String(count);
    dialog.querySelector('[data-return-total]').textContent = money(total, sale.currency);
  }

  rows.forEach((row) => {
    row.querySelector('[data-return-qty]').addEventListener('input', updatePreview);
    row.querySelector('[data-return-restock]').addEventListener('change', updatePreview);
  });

  dialog.querySelector('[data-return-cancel]').addEventListener('click', () => control.close());
  dialog.querySelector('[data-return-save]').addEventListener('click', async () => {
    errorSlot.innerHTML = '';
    const submit = dialog.querySelector('[data-return-save]');
    const selection = currentSelection();
    if (!selection.length) {
      errorSlot.innerHTML = `<span class="field-error" role="alert">${icon('alert', 14)} Choose at least one quantity to return.</span>`;
      return;
    }
    for (const entry of selection) {
      if (!Number.isInteger(entry.quantity) || entry.quantity < 1 || entry.quantity > entry.max) {
        errorSlot.innerHTML = `<span class="field-error" role="alert">${icon('alert', 14)} Return quantities must be whole numbers within the remaining quantity.</span>`;
        entry.input.focus();
        return;
      }
    }
    const reason = dialog.querySelector('#return-reason').value.trim();
    if (!reason) {
      errorSlot.innerHTML = `<span class="field-error" role="alert">${icon('alert', 14)} A return reason is required.</span>`;
      dialog.querySelector('#return-reason').focus();
      return;
    }
    const refundMethod = dialog.querySelector('#return-method').value;
    submit.disabled = true;
    try {
      const record = await state.store.createReturn(sale.id, {
        items: selection.map((entry) => ({
          saleItemId: entry.lineId,
          quantity: entry.quantity,
          restock: entry.restock,
        })),
        reason,
        refundMethod,
        approval,
        clientRequestId,
      });
      control.setSettled();
      control.close();
      toast(`Return ${record.number} saved for ${money(record.refundCents, sale.currency)}.`, {
        tone: 'success',
        title: 'Return recorded',
      });
      onDone?.();
    } catch (error) {
      errorSlot.innerHTML = `<span class="field-error" role="alert">${icon('alert', 14)} ${escapeHtml(error.message)}</span>`;
    } finally {
      submit.disabled = false;
    }
  });

  updatePreview();
}
