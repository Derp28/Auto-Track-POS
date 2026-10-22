import { clearFormErrors, escapeHtml, icon, pageHeader, setFormFieldError } from '../js/ui.js';
import { formatPercentFromBps } from '../js/money.js';
import { toast } from '../components/toast.js';
import { rerender } from '../js/router.js';

export function renderSettings(ctx) {
  const { state } = ctx;
  const settings = state.store.settings;
  return {
    html: `
      ${pageHeader({
        eyebrow: 'Administration · configuration',
        title: 'Settings',
        description: 'Shop identity, tax, checkout rules, and this browser’s terminal label. Shop settings are saved to the server.',
        actions: `<button class="btn btn--secondary" type="button" data-settings-refresh>${icon('refresh', 16)} Refresh from server</button>`,
      })}
      <div class="callout callout--warning">${icon('alert', 17)} <span>Shop settings apply to every cashier and are recorded in the audit log. The terminal label stays in this browser only.</span></div>
      <form id="settings-form" class="settings-layout" novalidate>
        <div class="settings-main">
          <section class="card">
            <div class="card__head"><div><h2>Shop identity</h2><p>Printed on receipts and report headers.</p></div>${icon('store', 20)}</div>
            <div class="form-grid">
              <div class="form-grid__wide field">
                <label for="settings-shop-name">Shop name <span class="required">*</span></label>
                <input id="settings-shop-name" name="shopName" maxlength="120" value="${escapeHtml(settings.shopName)}" required>
              </div>
              <div class="form-grid__wide field">
                <label for="settings-address">Address</label>
                <input id="settings-address" name="address" maxlength="180" value="${escapeHtml(settings.address)}">
              </div>
              <div class="field"><label for="settings-phone">Phone</label><input id="settings-phone" name="phone" maxlength="40" value="${escapeHtml(settings.phone)}"></div>
              <div class="field"><label for="settings-email">Email</label><input id="settings-email" name="email" type="email" maxlength="120" value="${escapeHtml(settings.email)}"></div>
              <div class="field"><label for="settings-tin">TIN / tax ID</label><input id="settings-tin" name="tin" maxlength="40" value="${escapeHtml(settings.tin)}"></div>
              <div class="form-grid__wide field"><label for="settings-receipt-header">Receipt header</label><input id="settings-receipt-header" name="receiptHeader" maxlength="120" value="${escapeHtml(settings.receiptHeader)}"></div>
              <div class="form-grid__wide field"><label for="settings-footer">Receipt footer</label><input id="settings-footer" name="receiptFooter" maxlength="180" value="${escapeHtml(settings.receiptFooter)}"></div>
              <div class="form-grid__wide field"><label for="settings-returns">Returns policy</label><textarea id="settings-returns" name="returnsPolicy" rows="2" maxlength="300">${escapeHtml(settings.returnsPolicy)}</textarea></div>
            </div>
          </section>

          <section class="card">
            <div class="card__head"><div><h2>Localization &amp; business day</h2><p>These values control timestamps, receipts, and business-day reporting.</p></div>${icon('clock', 20)}</div>
            <div class="form-grid">
              <div class="field"><label for="settings-currency">Currency code</label><input id="settings-currency" name="currency" maxlength="3" value="${escapeHtml(settings.currency)}"></div>
              <div class="field"><label for="settings-timezone">Time zone</label><input id="settings-timezone" name="timezone" maxlength="60" value="${escapeHtml(settings.timezone)}"></div>
              <div class="field"><label for="settings-cutoff">Business-day cutoff</label><input id="settings-cutoff" name="businessDayCutoff" type="time" value="${escapeHtml(settings.businessDayCutoff)}"><small class="field-hint">24-hour shop cutoff for same-day reporting and voids.</small></div>
            </div>
          </section>

          <section class="card">
            <div class="card__head"><div><h2>Tax</h2><p>Applied per line after line discounts. The sale stores its own tax snapshot.</p></div><label class="switch"><input id="settings-tax-enabled" name="taxEnabled" type="checkbox" ${settings.taxEnabled ? 'checked' : ''}><span></span><b>${settings.taxEnabled ? 'Enabled' : 'Disabled'}</b></label></div>
            <div class="form-grid" data-tax-fields>
              <div class="field"><label for="settings-tax-rate">Tax rate</label><div class="input-suffix"><input id="settings-tax-rate" name="taxRatePercent" type="number" min="0" max="100" step="0.01" value="${(settings.taxRateBps / 100).toFixed(2)}"><span>%</span></div></div>
              <div class="field"><label>Tax mode</label><label class="check-row"><input id="settings-tax-inclusive" name="taxInclusive" type="checkbox" ${settings.taxInclusive ? 'checked' : ''}> <span>Prices already include tax</span></label><small class="field-hint">When unchecked, tax is added after line discount.</small></div>
            </div>
            <div class="callout callout--muted" data-tax-preview>${settings.taxEnabled ? `Current rate: ${formatPercentFromBps(settings.taxRateBps)} ${settings.taxInclusive ? 'inclusive' : 'exclusive'}.` : 'Tax is disabled at 0% exclusive. Enable it to apply tax at checkout.'}</div>
          </section>

          <section class="card">
            <div class="card__head"><div><h2>Checkout controls</h2><p>Limits for discount approval and line quantity.</p></div>${icon('cart', 20)}</div>
            <div class="form-grid">
              <div class="field"><label for="settings-cashier-limit">Cashier discount limit</label><div class="input-suffix"><input id="settings-cashier-limit" name="cashierDiscountLimitPercent" type="number" min="0" max="100" step="0.01" value="${(settings.cashierDiscountLimitBps / 100).toFixed(2)}"><span>%</span></div><small class="field-hint">Any higher cashier discount requires administrator approval.</small></div>
              <div class="field"><label for="settings-max-line">Maximum quantity per line</label><input id="settings-max-line" name="maxLineQuantity" type="number" min="1" max="9999" step="1" value="${settings.maxLineQuantity}"><small class="field-hint">Stock limits still apply at checkout.</small></div>
              <div class="form-grid__wide check-row"><input id="settings-reason-required" name="discountReasonRequired" type="checkbox" ${settings.discountReasonRequired ? 'checked' : ''}> <label for="settings-reason-required">Require a reason for every line discount</label></div>
            </div>
          </section>
        </div>

        <aside class="settings-side">
          <section class="card">
            <div class="card__head"><div><h2>This browser</h2><p>Terminal label only. It is not a shop-wide setting.</p></div></div>
            <div class="field">
              <label for="settings-terminal">Terminal label</label>
              <input id="settings-terminal" name="terminalLabel" maxlength="40" value="${escapeHtml(state.terminalLabel)}">
              <small class="field-hint">Shown in the top bar, checkout, and receipts. It applies to this browser only.</small>
            </div>
            <div class="callout callout--muted">${icon('info', 16)} <span>The terminal label is kept in this browser session and is not a shop-wide setting.</span></div>
          </section>
          <section class="card card--sticky">
            <div class="card__head"><div><h2>Save settings</h2><p>Save shop settings to the server and update this terminal label.</p></div></div>
            <div class="settings-summary">
              <div><span>Tax</span><strong>${settings.taxEnabled ? formatPercentFromBps(settings.taxRateBps) : 'Disabled'}</strong></div>
              <div><span>Cashier limit</span><strong>${formatPercentFromBps(settings.cashierDiscountLimitBps)}</strong></div>
              <div><span>Max line</span><strong>${settings.maxLineQuantity}</strong></div>
              <div><span>Terminal</span><strong>${escapeHtml(state.terminalLabel)}</strong></div>
            </div>
            <button class="btn btn--primary btn--block" type="submit">${icon('check', 17)} Save settings</button>
            <p class="info-disclaimer">${icon('lock', 14)} Saved to PostgreSQL · administrator only</p>
          </section>
        </aside>
      </form>
    `,
    after(container) {
      const form = container.querySelector('#settings-form');
      const taxEnabled = form.querySelector('#settings-tax-enabled');
      const taxFields = form.querySelector('[data-tax-fields]');
      const taxPreview = form.querySelector('[data-tax-preview]');
      const updateTaxVisibility = () => {
        taxFields.classList.toggle('is-disabled', !taxEnabled.checked);
        taxPreview.textContent = taxEnabled.checked
          ? 'Tax will be applied to new checkout lines using the rate above and the selected mode.'
          : 'Tax is disabled at 0% exclusive. Enable it to apply tax at checkout.';
        taxEnabled.closest('.switch').querySelector('b').textContent = taxEnabled.checked ? 'Enabled' : 'Disabled';
      };
      taxEnabled.addEventListener('change', updateTaxVisibility);
      updateTaxVisibility();
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearFormErrors(form);
        const submit = form.querySelector('[type="submit"]');
        const data = new FormData(form);
        const taxRatePercent = Number(data.get('taxRatePercent'));
        const cashierLimitPercent = Number(data.get('cashierDiscountLimitPercent'));
        const maxLineQuantity = Number(data.get('maxLineQuantity'));
        let hasClientError = false;
        if (!Number.isFinite(taxRatePercent) || taxRatePercent < 0 || taxRatePercent > 100) {
          setFormFieldError(form, 'taxRatePercent', 'Enter a tax rate from 0% to 100%.');
          hasClientError = true;
        }
        if (!Number.isFinite(cashierLimitPercent) || cashierLimitPercent < 0 || cashierLimitPercent > 100) {
          setFormFieldError(form, 'cashierDiscountLimitPercent', 'Enter a limit from 0% to 100%.');
          hasClientError = true;
        }
        if (!Number.isInteger(maxLineQuantity) || maxLineQuantity < 1 || maxLineQuantity > 9999) {
          setFormFieldError(form, 'maxLineQuantity', 'Enter a whole number from 1 to 9999.');
          hasClientError = true;
        }
        const terminalLabel = String(data.get('terminalLabel') || '').trim();
        if (!terminalLabel) {
          setFormFieldError(form, 'terminalLabel', 'Terminal label is required.');
          hasClientError = true;
        }
        if (hasClientError) return;
        submit.disabled = true;
        try {
          await state.store.updateSettings({
            shopName: String(data.get('shopName') || ''),
            address: String(data.get('address') || ''),
            phone: String(data.get('phone') || ''),
            email: String(data.get('email') || ''),
            tin: String(data.get('tin') || ''),
            receiptHeader: String(data.get('receiptHeader') || ''),
            receiptFooter: String(data.get('receiptFooter') || ''),
            returnsPolicy: String(data.get('returnsPolicy') || ''),
            currency: String(data.get('currency') || 'PHP'),
            timezone: String(data.get('timezone') || 'Asia/Manila'),
            businessDayCutoff: String(data.get('businessDayCutoff') || '00:00'),
            taxEnabled: Boolean(data.get('taxEnabled')),
            taxRateBps: Math.round(taxRatePercent * 100),
            taxInclusive: Boolean(data.get('taxInclusive')),
            cashierDiscountLimitBps: Math.round(cashierLimitPercent * 100),
            discountReasonRequired: Boolean(data.get('discountReasonRequired')),
            maxLineQuantity,
          });
          state.setTerminalLabel(terminalLabel);
          document.dispatchEvent(new CustomEvent('pos:terminal-changed'));
          taxPreview.textContent = state.store.settings.taxEnabled
            ? `Tax is now ${formatPercentFromBps(state.store.settings.taxRateBps)} ${state.store.settings.taxInclusive ? 'inclusive' : 'exclusive'}. New checkout totals will reflect it.`
            : 'Tax is disabled at 0% exclusive. Enable it to apply tax at checkout.';
          toast('Shop settings saved. The terminal label was updated for this browser.', { tone: 'success', title: 'Settings saved' });
        } catch (error) {
          if (error.fieldErrors) {
            Object.entries(error.fieldErrors).forEach(([field, message]) => setFormFieldError(form, field, message));
            const firstInvalid = form.querySelector('.field--invalid input, .field--invalid select, .field--invalid textarea');
            firstInvalid?.focus();
          } else {
            toast(error.message, { tone: 'danger', title: 'Settings not saved' });
          }
        } finally {
          submit.disabled = false;
        }
      });
      container.querySelector('[data-settings-refresh]').addEventListener('click', async () => {
        try {
          await state.store.refresh();
          rerender();
          toast('Settings reloaded from the shop server.', { tone: 'info', title: 'Data refreshed' });
        } catch (error) {
          toast(error.message, { tone: 'danger', title: 'Refresh failed' });
        }
      });
    },
    focus: 'h1',
  };
}
