import { amountInputValue, categoryOptions, clearFormErrors, escapeHtml, icon, setFormFieldError } from '../js/ui.js';
import { parseAmountToCents } from '../js/money.js';
import { showDialog } from './dialog.js';
import { toast } from './toast.js';

export function openProductForm({ state, product = null, onSaved }) {
  const creating = !product;
  const settings = state.store.settings;
  let control;
  control = showDialog({
    title: creating ? 'New product' : 'Edit product',
    description: creating ? 'Add a catalog item. Opening stock starts at zero and is changed through an adjustment.' : `Update ${product.name}. Cost is administrator-only.`,
    size: 'lg',
    body: `
      <form id="product-form" class="form-grid" novalidate>
        <div class="form-grid__wide field">
          <label for="product-name">Product name <span class="required">*</span></label>
          <input id="product-name" name="name" maxlength="120" autocomplete="off" value="${escapeHtml(product?.name || '')}" required>
        </div>
        <div class="field">
          <label for="product-sku">SKU <span class="required">*</span></label>
          <input id="product-sku" name="sku" maxlength="40" autocomplete="off" value="${escapeHtml(product?.sku || '')}" required>
        </div>
        <div class="field">
          <label for="product-barcode">Barcode <span class="optional">(optional)</span></label>
          <input id="product-barcode" name="barcode" maxlength="40" autocomplete="off" value="${escapeHtml(product?.barcode || '')}">
        </div>
        <div class="field">
          <label for="product-category">Category <span class="required">*</span></label>
          <select id="product-category" name="categoryId" required>
            <option value="">Choose a category</option>
            ${categoryOptions(state.store.categories.filter((category) => category.active || category.id === product?.categoryId), product?.categoryId || '')}
          </select>
        </div>
        <div class="field">
          <label for="product-reorder">Reorder level <span class="required">*</span></label>
          <input id="product-reorder" name="reorderLevel" type="number" min="0" step="1" value="${product?.reorderLevel ?? 0}" required>
          <small class="field-hint">Low-stock alerts trigger at or below this quantity.</small>
        </div>
        <div class="field">
          <label for="product-cost">Unit cost <span class="required">*</span></label>
          <div class="input-money"><span>₱</span><input id="product-cost" name="costCents" inputmode="decimal" value="${amountInputValue(product?.costCents ?? 0)}" required></div>
          <small class="field-hint">Administrator-only. Changing cost does not rewrite the value of stock already on hand.</small>
        </div>
        <div class="field">
          <label for="product-price">Selling price <span class="required">*</span></label>
          <div class="input-money"><span>₱</span><input id="product-price" name="priceCents" inputmode="decimal" value="${amountInputValue(product?.priceCents ?? 0)}" required></div>
          <small class="field-hint">A price below cost is allowed for administrators with a warning.</small>
        </div>
        <div class="form-grid__wide field">
          <label for="product-description">Description <span class="optional">(optional)</span></label>
          <textarea id="product-description" name="description" rows="2" maxlength="240">${escapeHtml(product?.description || '')}</textarea>
        </div>
        <div class="form-grid__wide check-row">
          <input id="product-active" name="active" type="checkbox" ${product?.active !== false ? 'checked' : ''}>
          <label for="product-active">Active for checkout and new purchase orders</label>
        </div>
        <div class="form-grid__wide" data-product-error></div>
      </form>
    `,
    footer: `
      <button class="btn btn--secondary" type="button" data-product-cancel>Cancel</button>
      <button class="btn btn--primary" type="submit" form="product-form">${creating ? 'Create product' : 'Update product'}</button>
    `,
    initialFocus: '#product-name',
  });

  const dialog = control.dialog;
  const form = dialog.querySelector('#product-form');
  dialog.querySelector('[data-product-cancel]').addEventListener('click', () => control.close());
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormErrors(form);
    const submit = dialog.querySelector(`[form="product-form"]`);
    const formData = new FormData(form);
    const costCents = parseAmountToCents(String(formData.get('costCents') || ''));
    const priceCents = parseAmountToCents(String(formData.get('priceCents') || ''));
    const reorderLevel = Number(formData.get('reorderLevel'));
    if (costCents === null) {
      setFormFieldError(form, 'costCents', 'Enter a valid amount with up to two decimals.');
      return;
    }
    if (priceCents === null) {
      setFormFieldError(form, 'priceCents', 'Enter a valid amount with up to two decimals.');
      return;
    }
    if (!Number.isInteger(reorderLevel) || reorderLevel < 0) {
      setFormFieldError(form, 'reorderLevel', 'Enter a whole number of zero or more.');
      return;
    }
    const input = {
      name: String(formData.get('name') || ''),
      sku: String(formData.get('sku') || ''),
      barcode: String(formData.get('barcode') || ''),
      categoryId: String(formData.get('categoryId') || ''),
      description: String(formData.get('description') || ''),
      costCents,
      priceCents,
      reorderLevel,
      active: Boolean(formData.get('active')),
    };
    submit.disabled = true;
    try {
      const result = creating
        ? await state.store.createProduct(input)
        : await state.store.updateProduct(product.id, input);
      control.setSettled();
      control.close();
      const warning = Object.values(result.warnings || {})[0];
      toast(
        warning
          ? `Product ${creating ? 'created' : 'updated'}. Warning: ${warning}`
          : `Product ${creating ? 'created' : 'updated'} and saved to the shop server.`,
        { tone: warning ? 'warning' : 'success', title: warning ? 'Saved with warning' : (creating ? 'Product created' : 'Product updated') },
      );
      onSaved?.(result.product);
    } catch (error) {
      if (error.fieldErrors) {
        Object.entries(error.fieldErrors).forEach(([field, message]) => setFormFieldError(form, field, message));
        const firstInvalid = form.querySelector('.field--invalid input, .field--invalid select, .field--invalid textarea');
        firstInvalid?.focus();
      } else {
        dialog.querySelector('[data-product-error]').innerHTML = `<div class="form-error" role="alert">${icon('alert', 16)} ${escapeHtml(error.message)}</div>`;
      }
    } finally {
      submit.disabled = false;
    }
  });
}
