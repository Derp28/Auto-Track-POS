import { amountInputValue, escapeHtml, icon, money } from '../js/ui.js';
import { formatPercentFromBps, parseAmountToCents } from '../js/money.js';
import { uuid } from '../js/api.js';
import { showDialog } from './dialog.js';

function quickTenders(totalCents) {
  const values = [totalCents, 50000, 100000, 200000, 500000, 1000000, 2000000];
  return [...new Set(values.filter((value) => value >= totalCents))].map((value) => {
    const label = value === totalCents ? 'Exact' : money(value);
    return `<button class="tender-chip" type="button" data-tender="${value}">${escapeHtml(label)}</button>`;
  }).join('');
}

export function openPaymentDialog({ state, saleNote = '', onComplete }) {
  const totals = state.cartTotals();
  const total = totals.totalCents;
  const settings = state.store.settings;
  const half = Math.floor(total / 2);
  const splitCash = half;
  const splitCard = total - half;

  let mode = 'cash';
  let processing = false;
  let control;
  const clientRequestId = uuid();

  control = showDialog({
    title: 'Take payment',
    description: 'Record cash or an external card terminal payment. No card data is collected, stored, or transmitted.',
    size: 'lg',
    body: `
      <div class="payment-dialog">
        <div class="payment-due">
          <span>Amount due</span>
          <strong>${money(total, settings.currency)}</strong>
          <small>${state.cartQuantity()} item${state.cartQuantity() === 1 ? '' : 's'} · ${escapeHtml(state.currentUser.displayName)} · ${escapeHtml(state.terminalLabel)}</small>
        </div>

        <div class="segmented segmented--wide" role="tablist" aria-label="Payment method">
          <button class="segmented__item is-active" type="button" role="tab" aria-selected="true" data-pay-tab="cash">${icon('cash', 17)} Cash</button>
          <button class="segmented__item" type="button" role="tab" aria-selected="false" data-pay-tab="card">${icon('card', 17)} External card</button>
          <button class="segmented__item" type="button" role="tab" aria-selected="false" data-pay-tab="split">${icon('split', 17)} Split</button>
        </div>

        <div class="payment-pane" data-pay-pane="cash">
          <div class="field">
            <label for="cash-tendered">Cash tendered</label>
            <div class="input-money">
              <span>₱</span>
              <input id="cash-tendered" name="cashTendered" inputmode="decimal" autocomplete="off" value="${amountInputValue(total)}" aria-describedby="cash-change-note">
            </div>
            <small class="field-hint">Use the quick amounts or type the cash received.</small>
          </div>
          <div class="tender-row" aria-label="Quick cash amounts">${quickTenders(total)}</div>
          <div class="change-box" id="cash-change-note" aria-live="polite">
            <span>Change due</span>
            <strong data-change>${money(0, settings.currency)}</strong>
          </div>
        </div>

        <div class="payment-pane" data-pay-pane="card" hidden>
          <div class="card-capture">
            <span class="card-capture__icon">${icon('card', 24)}</span>
            <div><span>Capture amount</span><strong>${money(total, settings.currency)}</strong></div>
          </div>
          <div class="field">
            <label for="card-reference">External terminal reference <span class="optional">(optional)</span></label>
            <input id="card-reference" name="cardReference" maxlength="40" autocomplete="off" placeholder="e.g. TERM-4821">
            <small class="field-hint">Record the approval code or terminal reference only.</small>
          </div>
          <div class="privacy-note">${icon('lock', 16)} <span>Never enter card numbers, expiry dates, CVV, track data, or PINs. Auto-Track stores no card data.</span></div>
        </div>

        <div class="payment-pane" data-pay-pane="split" hidden>
          <p class="payment-pane__lead">Split the payment between cash and an external card terminal. Amounts must add up to the total.</p>
          <div class="split-grid">
            <div class="field">
              <label for="split-cash">Cash amount</label>
              <div class="input-money"><span>₱</span><input id="split-cash" name="splitCash" inputmode="decimal" autocomplete="off" value="${amountInputValue(splitCash)}"></div>
            </div>
            <div class="field">
              <label for="split-card">External card amount</label>
              <div class="input-money"><span>₱</span><input id="split-card" name="splitCard" inputmode="decimal" autocomplete="off" value="${amountInputValue(splitCard)}"></div>
            </div>
          </div>
          <div class="split-summary" aria-live="polite">
            <span>Allocated <strong data-split-sum>${money(total, settings.currency)}</strong></span>
            <span data-split-status class="text-success">Matches total</span>
          </div>
          <div class="privacy-note">${icon('info', 16)} <span>Split rows are captured amounts. Change is not calculated on a split capture.</span></div>
        </div>

        <div class="payment-error" data-payment-error role="alert" hidden></div>
        <div class="payment-meta">
          <span>${settings.taxEnabled ? `Tax ${formatPercentFromBps(settings.taxRateBps)} ${settings.taxInclusive ? 'inclusive' : 'exclusive'}` : 'Tax disabled (0%)'}</span>
          <span>${icon('lock', 14)} Saved in this browser tab</span>
        </div>
      </div>
    `,
    footer: `
      <button class="btn btn--secondary" type="button" data-payment-cancel>Cancel</button>
      <button class="btn btn--accent btn--lg" type="button" data-payment-complete>${icon('check', 18)} Complete sale</button>
    `,
    initialFocus: '#cash-tendered',
  });

  const dialog = control.dialog;
  const errorBox = dialog.querySelector('[data-payment-error]');
  const completeButton = dialog.querySelector('[data-payment-complete]');
  const cancelButton = dialog.querySelector('[data-payment-cancel]');
  const cashInput = dialog.querySelector('#cash-tendered');
  const changeOutput = dialog.querySelector('[data-change]');

  function showError(message) {
    errorBox.hidden = false;
    errorBox.innerHTML = `${icon('alert', 17)} <span>${escapeHtml(message)}</span>`;
  }

  function clearError() {
    errorBox.hidden = true;
    errorBox.textContent = '';
  }

  function setMode(nextMode) {
    mode = nextMode;
    dialog.querySelectorAll('[data-pay-tab]').forEach((button) => {
      const active = button.dataset.payTab === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    dialog.querySelectorAll('[data-pay-pane]').forEach((pane) => {
      pane.hidden = pane.dataset.payPane !== mode;
    });
    clearError();
    window.setTimeout(() => {
      if (mode === 'cash') cashInput.focus();
      if (mode === 'split') dialog.querySelector('#split-cash').focus();
      if (mode === 'card') dialog.querySelector('#card-reference').focus();
    }, 20);
  }

  function updateCashChange() {
    const tendered = parseAmountToCents(cashInput.value);
    if (tendered === null) {
      changeOutput.textContent = 'Enter a valid amount';
      changeOutput.classList.remove('text-success');
      return;
    }
    const difference = tendered - total;
    if (difference < 0) {
      changeOutput.textContent = `Short ${money(Math.abs(difference), settings.currency)}`;
      changeOutput.classList.remove('text-success');
    } else {
      changeOutput.textContent = money(difference, settings.currency);
      changeOutput.classList.add('text-success');
    }
  }

  function updateSplitSummary() {
    const cash = parseAmountToCents(dialog.querySelector('#split-cash').value);
    const card = parseAmountToCents(dialog.querySelector('#split-card').value);
    const sum = (cash ?? 0) + (card ?? 0);
    dialog.querySelector('[data-split-sum]').textContent = money(sum, settings.currency);
    const status = dialog.querySelector('[data-split-status]');
    const valid = cash !== null && card !== null && sum === total;
    status.textContent = valid ? 'Matches total' : `Difference ${money(Math.abs(total - sum), settings.currency)}`;
    status.className = valid ? 'text-success' : 'text-danger';
    return { cash, card, sum, valid };
  }

  function setProcessing(next) {
    processing = next;
    cancelButton.disabled = next;
    completeButton.disabled = next;
    dialog.querySelectorAll('input, button[data-pay-tab], button[data-tender]').forEach((element) => {
      element.disabled = next;
    });
    completeButton.innerHTML = next
      ? '<span class="spinner spinner--small" aria-hidden="true"></span> Saving sale…'
      : `${icon('check', 18)} Complete sale`;
  }

  function collectPayment() {
    if (mode === 'cash') {
      const tendered = parseAmountToCents(cashInput.value);
      if (tendered === null) return { error: 'Enter a valid cash amount with up to two decimals.' };
      if (tendered < total) return { error: `Cash is short by ${money(total - tendered, settings.currency)}.` };
      return { payments: [{ method: 'CASH', amountCents: total, tenderedCents: tendered }] };
    }
    if (mode === 'card') {
      return {
        payments: [{
          method: 'CARD_EXTERNAL',
          amountCents: total,
          reference: dialog.querySelector('#card-reference').value.trim(),
        }],
      };
    }
    const split = updateSplitSummary();
    if (!split.valid) return { error: 'Split amounts must add up to the amount due.' };
    const payments = [];
    if (split.cash > 0) payments.push({ method: 'CASH', amountCents: split.cash, tenderedCents: split.cash });
    if (split.card > 0) {
      payments.push({
        method: 'CARD_EXTERNAL',
        amountCents: split.card,
        reference: 'SPLIT-CARD',
      });
    }
    if (!payments.length) return { error: 'Enter a cash or card amount.' };
    return { payments };
  }

  dialog.querySelectorAll('[data-pay-tab]').forEach((button) => {
    button.addEventListener('click', () => setMode(button.dataset.payTab));
  });
  dialog.querySelectorAll('[data-tender]').forEach((button) => {
    button.addEventListener('click', () => {
      cashInput.value = amountInputValue(Number(button.dataset.tender));
      updateCashChange();
      cashInput.focus();
    });
  });
  cashInput.addEventListener('input', updateCashChange);
  dialog.querySelector('#split-cash').addEventListener('input', updateSplitSummary);
  dialog.querySelector('#split-card').addEventListener('input', updateSplitSummary);
  cancelButton.addEventListener('click', () => control.close());
  completeButton.addEventListener('click', async () => {
    if (processing) return;
    clearError();
    const payment = collectPayment();
    if (payment.error) {
      showError(payment.error);
      return;
    }
    const approval = state.cart.map((line) => line.discountApproval).find(Boolean) || null;
    setProcessing(true);
    try {
      const sale = await state.store.createSale({
        lines: state.cart.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          discountBps: line.discountBps,
          discountReason: line.discountReason,
          note: line.note,
        })),
        payments: payment.payments,
        terminal: state.terminalLabel,
        note: saleNote,
        approval,
        clientRequestId,
      });
      state.clearCart();
      control.setSettled();
      control.close();
      onComplete?.(sale);
    } catch (error) {
      setProcessing(false);
      showError(error.message || 'The sale was not confirmed. Check the server and try again.');
      completeButton.focus();
    }
  });

  dialog.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      completeButton.click();
    }
  });

  updateCashChange();
  updateSplitSummary();
  return control;
}
