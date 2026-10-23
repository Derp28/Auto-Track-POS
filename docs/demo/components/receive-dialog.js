import { escapeHtml, icon, money } from '../js/ui.js';
import { uuid } from '../js/api.js';
import { showDialog } from './dialog.js';
import { toast } from './toast.js';

export function openReceiveDialog({ state, po, onDone }) {
  const clientRequestId = uuid();
  const receivable = po.lines.filter((line) => line.receivedQty < line.orderedQty);
  if (!receivable.length) {
    toast('Every line on this purchase order is already received.', { tone: 'info', title: 'Nothing to receive' });
    return;
  }
  let control;
  control = showDialog({
    title: `Receive stock · ${po.number}`,
    description: 'Enter received quantities. Over-receipt and negative stock are blocked.',
    size: 'lg',
    body: `
      <div class="dialog-copy">
        <div class="return-summary">
          <div><span>Supplier</span><strong>${escapeHtml(po.supplier?.name || po.supplierName || 'Unknown')}</strong></div>
          <div><span>Expected</span><strong>${escapeHtml(po.expectedAt)}</strong></div>
          <div><span>Ordered value</span><strong>${money(po.orderedTotalCents)}</strong></div>
          <div><span>Status</span><strong>${escapeHtml(po.status.replace(/_/g, ' '))}</strong></div>
        </div>
        <div class="table-wrap return-table-wrap">
          <table class="data-table data-table--return">
            <thead><tr><th>Product</th><th class="numeric">Ordered</th><th class="numeric">Received</th><th class="numeric">Remaining</th><th>Receive now</th></tr></thead>
            <tbody>
              ${receivable.map((line) => {
                const remaining = line.orderedQty - line.receivedQty;
                return `
                  <tr data-receive-row data-line-id="${escapeHtml(line.id)}" data-remaining="${remaining}">
                    <td><strong>${escapeHtml(line.name)}</strong><small class="cell-sub">${escapeHtml(line.sku)} · ${money(line.unitCostCents)} each</small></td>
                    <td class="numeric">${line.orderedQty}</td>
                    <td class="numeric">${line.receivedQty}</td>
                    <td class="numeric">${remaining}</td>
                    <td><input class="qty-input" type="number" min="0" max="${remaining}" step="1" value="${remaining}" data-receive-qty aria-label="Receive now for ${escapeHtml(line.name)}"></td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
        <div class="callout callout--muted">${icon('info', 16)} <span>Receiving increases stock and stock value at the PO unit cost. The weighted-average cost is updated for the product.</span></div>
        <div class="receive-preview"><span>Selected receipt value</span><strong data-receive-total>${money(0)}</strong></div>
        <div data-receive-error></div>
      </div>
    `,
    footer: `
      <button class="btn btn--secondary" type="button" data-receive-cancel>Cancel</button>
      <button class="btn btn--primary" type="button" data-receive-save>${icon('check', 16)} Receive stock</button>
    `,
    initialFocus: '[data-receive-qty]',
  });
  const dialog = control.dialog;
  const rows = [...dialog.querySelectorAll('[data-receive-row]')];
  const errorSlot = dialog.querySelector('[data-receive-error]');

  function updateTotal() {
    let total = 0;
    rows.forEach((row) => {
      const line = po.lines.find((candidate) => candidate.id === row.dataset.lineId);
      const qty = Number(row.querySelector('[data-receive-qty]').value);
      if (line && Number.isInteger(qty) && qty > 0) total += qty * line.unitCostCents;
    });
    dialog.querySelector('[data-receive-total]').textContent = money(total);
  }

  rows.forEach((row) => row.querySelector('[data-receive-qty]').addEventListener('input', updateTotal));
  dialog.querySelector('[data-receive-cancel]').addEventListener('click', () => control.close());
  dialog.querySelector('[data-receive-save]').addEventListener('click', async () => {
    errorSlot.innerHTML = '';
    const submit = dialog.querySelector('[data-receive-save]');
    const items = [];
    for (const row of rows) {
      const qty = Number(row.querySelector('[data-receive-qty]').value);
      const remaining = Number(row.dataset.remaining);
      if (!Number.isInteger(qty) || qty < 0 || qty > remaining) {
        errorSlot.innerHTML = `<span class="field-error" role="alert">${icon('alert', 14)} Received quantities must be whole numbers within the remaining quantity.</span>`;
        row.querySelector('[data-receive-qty]').focus();
        return;
      }
      if (qty > 0) items.push({ lineId: row.dataset.lineId, quantity: qty });
    }
    if (!items.length) {
      errorSlot.innerHTML = `<span class="field-error" role="alert">${icon('alert', 14)} Enter at least one quantity to receive.</span>`;
      return;
    }
    submit.disabled = true;
    try {
      const result = await state.store.receivePurchaseOrder(po.id, {
        items,
        note: dialog.querySelector('#receive-note')?.value || '',
        clientRequestId,
      });
      control.setSettled();
      control.close();
      toast(`Receipt ${result.receipt.number || result.receipt.id} recorded and stock updated.`, {
        tone: 'success',
        title: 'Stock received',
      });
      onDone?.(result.po);
    } catch (error) {
      errorSlot.innerHTML = `<span class="field-error" role="alert">${icon('alert', 14)} ${escapeHtml(error.message)}</span>`;
    } finally {
      submit.disabled = false;
    }
  });
  updateTotal();
}
