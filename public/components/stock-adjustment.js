import { escapeHtml, icon, money } from '../js/ui.js';
import { parseAmountToCents } from '../js/money.js';
import { showDialog } from './dialog.js';
import { toast } from './toast.js';

export function openStockAdjustment({ state, product, onDone }) {
  const wac = state.store.wacFor(product);
  let control;
  control = showDialog({
    title: `Adjust ${product.name}`,
    description: 'Post a stock movement to the shop server. Negative stock is blocked.',
    body: `
      <div class="dialog-copy">
        <div class="stock-summary">
          <div><span>On hand</span><strong>${product.stockOnHand}</strong></div>
          <div><span>Reorder level</span><strong>${product.reorderLevel}</strong></div>
          <div><span>Derived WAC</span><strong>${money(wac)}</strong></div>
          <div><span>Stock value</span><strong>${money(product.stockValueCents)}</strong></div>
        </div>
        <form id="stock-adjustment-form" novalidate>
          <div class="field">
            <label for="stock-delta">Quantity change <span class="required">*</span></label>
            <input id="stock-delta" name="delta" type="number" step="1" value="1" inputmode="numeric" aria-describedby="stock-after-preview">
            <small class="field-hint">Use a positive number to add stock and a negative number to remove it.</small>
          </div>
          <div class="quick-chips" aria-label="Quick adjustment amounts">
            <button class="tender-chip" type="button" data-delta="-5">−5</button>
            <button class="tender-chip" type="button" data-delta="-1">−1</button>
            <button class="tender-chip" type="button" data-delta="1">+1</button>
            <button class="tender-chip" type="button" data-delta="5">+5</button>
            <button class="tender-chip" type="button" data-delta="10">+10</button>
          </div>
          <div class="adjust-preview" id="stock-after-preview" aria-live="polite">
            <span>After adjustment</span>
            <strong data-after-stock>${product.stockOnHand + 1}</strong>
            <small data-after-hint>Positive adjustments use the current product cost for the added value.</small>
          </div>
          <div class="field">
            <label for="stock-reason">Reason <span class="required">*</span></label>
            <textarea id="stock-reason" name="reason" rows="3" maxlength="240" placeholder="Example: damaged during shelf count"></textarea>
          </div>
          <div data-adjust-error></div>
        </form>
      </div>
    `,
    footer: `
      <button class="btn btn--secondary" type="button" data-adjust-cancel>Cancel</button>
      <button class="btn btn--primary" type="submit" form="stock-adjustment-form">${icon('check', 16)} Apply adjustment</button>
    `,
    initialFocus: '#stock-delta',
  });

  const dialog = control.dialog;
  const form = dialog.querySelector('#stock-adjustment-form');
  const deltaInput = dialog.querySelector('#stock-delta');
  const afterStock = dialog.querySelector('[data-after-stock]');
  const afterHint = dialog.querySelector('[data-after-hint]');
  const errorSlot = dialog.querySelector('[data-adjust-error]');

  function updatePreview() {
    const delta = Number(deltaInput.value);
    const next = product.stockOnHand + (Number.isInteger(delta) ? delta : 0);
    afterStock.textContent = String(next);
    afterStock.classList.toggle('text-danger', next < 0);
    afterHint.textContent = next < 0
      ? 'This adjustment would make stock negative and will be blocked.'
      : delta > 0 && product.stockOnHand === 0
        ? 'Starting from zero uses the product cost as the unit value.'
        : 'Stock value changes by the server cost-value calculation.';
  }

  deltaInput.addEventListener('input', updatePreview);
  dialog.querySelectorAll('[data-delta]').forEach((button) => {
    button.addEventListener('click', () => {
      deltaInput.value = button.dataset.delta;
      updatePreview();
      deltaInput.focus();
    });
  });
  dialog.querySelector('[data-adjust-cancel]').addEventListener('click', () => control.close());
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorSlot.innerHTML = '';
    const submit = dialog.querySelector('[form="stock-adjustment-form"]');
    const delta = Number(deltaInput.value);
    const reason = dialog.querySelector('#stock-reason').value.trim();
    if (!Number.isInteger(delta) || delta === 0) {
      errorSlot.innerHTML = `<span class="field-error" role="alert">${icon('alert', 14)} Enter a non-zero whole-number quantity.</span>`;
      deltaInput.focus();
      return;
    }
    if (!reason) {
      errorSlot.innerHTML = `<span class="field-error" role="alert">${icon('alert', 14)} A reason is required for every adjustment.</span>`;
      dialog.querySelector('#stock-reason').focus();
      return;
    }
    submit.disabled = true;
    try {
      await state.store.adjustStock(product.id, { delta, reason });
      control.setSettled();
      control.close();
      toast(`Stock for ${product.name} adjusted by ${delta > 0 ? '+' : ''}${delta} and saved.`, {
        tone: 'success',
        title: 'Stock adjusted',
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
