import { clearFormErrors, escapeHtml, icon, setFormFieldError } from '../js/ui.js';
import { showDialog } from './dialog.js';
import { toast } from './toast.js';

export function openSupplierForm({ state, supplier = null, onSaved }) {
  const creating = !supplier;
  let control;
  control = showDialog({
    title: creating ? 'New supplier' : 'Edit supplier',
    description: creating ? 'Add a supplier for purchase orders.' : `Update ${supplier.name}.`,
    size: 'lg',
    body: `
      <form id="supplier-form" class="form-grid" novalidate>
        <div class="form-grid__wide field">
          <label for="supplier-name">Supplier name <span class="required">*</span></label>
          <input id="supplier-name" name="name" maxlength="120" value="${escapeHtml(supplier?.name || '')}" required>
        </div>
        <div class="field">
          <label for="supplier-contact">Contact person</label>
          <input id="supplier-contact" name="contactName" maxlength="80" value="${escapeHtml(supplier?.contactName || '')}">
        </div>
        <div class="field">
          <label for="supplier-phone">Phone</label>
          <input id="supplier-phone" name="phone" maxlength="40" value="${escapeHtml(supplier?.phone || '')}">
        </div>
        <div class="form-grid__wide field">
          <label for="supplier-email">Email</label>
          <input id="supplier-email" name="email" type="email" maxlength="120" value="${escapeHtml(supplier?.email || '')}">
        </div>
        <div class="form-grid__wide field">
          <label for="supplier-address">Address</label>
          <input id="supplier-address" name="address" maxlength="180" value="${escapeHtml(supplier?.address || '')}">
        </div>
        <div class="form-grid__wide field">
          <label for="supplier-notes">Notes</label>
          <textarea id="supplier-notes" name="notes" rows="2" maxlength="240">${escapeHtml(supplier?.notes || '')}</textarea>
        </div>
        <div class="form-grid__wide check-row">
          <input id="supplier-active" name="active" type="checkbox" ${supplier?.active !== false ? 'checked' : ''}>
          <label for="supplier-active">Active supplier</label>
        </div>
        <div class="form-grid__wide" data-supplier-error></div>
      </form>
    `,
    footer: `
      <button class="btn btn--secondary" type="button" data-supplier-cancel>Cancel</button>
      <button class="btn btn--primary" type="submit" form="supplier-form">${creating ? 'Create supplier' : 'Update supplier'}</button>
    `,
    initialFocus: '#supplier-name',
  });
  const form = control.dialog.querySelector('#supplier-form');
  control.dialog.querySelector('[data-supplier-cancel]').addEventListener('click', () => control.close());
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormErrors(form);
    const submit = control.dialog.querySelector('[form="supplier-form"]');
    submit.disabled = true;
    const data = new FormData(form);
    const input = {
      name: String(data.get('name') || ''),
      contactName: String(data.get('contactName') || ''),
      phone: String(data.get('phone') || ''),
      email: String(data.get('email') || ''),
      address: String(data.get('address') || ''),
      notes: String(data.get('notes') || ''),
      active: Boolean(data.get('active')),
    };
    try {
      const saved = creating
        ? await state.store.createSupplier(input)
        : await state.store.updateSupplier(supplier.id, input);
      control.setSettled();
      control.close();
      toast(`Supplier ${creating ? 'created' : 'updated'} and saved to the shop server.`, {
        tone: 'success',
        title: creating ? 'Supplier created' : 'Supplier updated',
      });
      onSaved?.(saved);
    } catch (error) {
      if (error.fieldErrors) {
        Object.entries(error.fieldErrors).forEach(([field, message]) => setFormFieldError(form, field, message));
      } else {
        control.dialog.querySelector('[data-supplier-error]').innerHTML = `<div class="form-error" role="alert">${icon('alert', 16)} ${escapeHtml(error.message)}</div>`;
      }
    } finally {
      submit.disabled = false;
    }
  });
}
