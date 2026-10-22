import { badge, escapeHtml, icon } from '../js/ui.js';
import { confirmDialog, showDialog } from './dialog.js';
import { toast } from './toast.js';

export function openCategoryManager({ state, onChanged }) {
  let control;
  control = showDialog({
    title: 'Product categories',
    description: 'Categories group products for filtering and reports. Archived categories stay on existing products but cannot be selected for new products.',
    size: 'lg',
    body: `
      <div class="dialog-copy">
        <form id="category-add-form" class="form-grid" novalidate>
          <div class="form-grid__wide field">
            <label for="category-name">New category name</label>
            <input id="category-name" name="name" maxlength="80" autocomplete="off" required>
          </div>
          <div class="form-grid__wide field">
            <label for="category-description">Description <span class="optional">(optional)</span></label>
            <input id="category-description" name="description" maxlength="300" autocomplete="off">
          </div>
          <div class="form-grid__wide" data-category-error></div>
          <div class="form-grid__wide">
            <button class="btn btn--primary" type="submit">${icon('plus', 16)} Add category</button>
          </div>
        </form>
        <div class="card__head"><div><h2>Category list</h2><p data-category-count></p></div></div>
        <div data-category-list></div>
      </div>
    `,
    footer: `<button class="btn btn--secondary" type="button" data-dialog-close>Close</button>`,
    initialFocus: '#category-name',
  });

  const dialog = control.dialog;
  const form = dialog.querySelector('#category-add-form');
  const errorSlot = dialog.querySelector('[data-category-error]');
  const list = dialog.querySelector('[data-category-list]');
  const count = dialog.querySelector('[data-category-count]');

  function renderList() {
    const categories = state.store.categories;
    count.textContent = `${categories.length} categor${categories.length === 1 ? 'y' : 'ies'}.`;
    list.innerHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Category</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${categories.map((category) => `
              <tr class="${category.active ? '' : 'row--muted'}">
                <td>
                  <input class="category-name-input" data-category-name="${escapeHtml(category.id)}" value="${escapeHtml(category.name)}" maxlength="80" aria-label="Category name">
                  <small class="cell-sub">${escapeHtml(category.description || 'No description')}</small>
                </td>
                <td>${category.active ? badge('Active', 'success') : badge('Archived', 'muted')}</td>
                <td class="numeric">
                  <div class="row-actions">
                    ${category.active ? `
                      <button class="icon-button icon-button--small" type="button" data-save-category="${escapeHtml(category.id)}" aria-label="Save ${escapeHtml(category.name)}" title="Save name">${icon('check', 15)}</button>
                      <button class="icon-button icon-button--small" type="button" data-archive-category="${escapeHtml(category.id)}" aria-label="Archive ${escapeHtml(category.name)}" title="Archive category">${icon('package', 15)}</button>
                    ` : ''}
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  renderList();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorSlot.innerHTML = '';
    const name = form.name.value.trim();
    const description = form.description.value.trim();
    if (!name) {
      errorSlot.innerHTML = '<div class="form-error" role="alert">Enter a category name.</div>';
      form.name.focus();
      return;
    }
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await state.store.createCategory({ name, description });
      form.reset();
      renderList();
      toast(`Category “${name}” created.`, { tone: 'success', title: 'Category created' });
      onChanged?.();
    } catch (error) {
      errorSlot.innerHTML = `<div class="form-error" role="alert">${icon('alert', 16)} ${escapeHtml(error.message)}</div>`;
    } finally {
      submit.disabled = false;
    }
  });

  list.addEventListener('click', async (event) => {
    const save = event.target.closest('[data-save-category]');
    if (save) {
      const id = save.dataset.saveCategory;
      const input = list.querySelector(`[data-category-name="${CSS.escape(id)}"]`);
      const name = input?.value.trim() || '';
      if (!name) {
        toast('Category name is required.', { tone: 'danger', title: 'Not saved' });
        input?.focus();
        return;
      }
      const existing = state.store.getCategory(id);
      save.disabled = true;
      try {
        await state.store.updateCategory(id, { name, description: existing?.description || '' });
        renderList();
        toast('Category renamed.', { tone: 'success', title: 'Category saved' });
        onChanged?.();
      } catch (error) {
        toast(error.message, { tone: 'danger', title: 'Category not saved' });
      } finally {
        save.disabled = false;
      }
      return;
    }
    const archive = event.target.closest('[data-archive-category]');
    if (archive) {
      const category = state.store.getCategory(archive.dataset.archiveCategory);
      if (!category) return;
      const confirmed = await confirmDialog({
        title: `Archive ${category.name}?`,
        message: 'The category will be hidden from new products. Existing products keep their category name.',
        confirmText: 'Archive category',
        tone: 'danger',
        details: 'Active products must be moved or archived first. This change is saved to the shop server.',
      });
      if (!confirmed) return;
      try {
        await state.store.archiveCategory(category.id);
        toast(`Category “${category.name}” archived.`, { tone: 'success', title: 'Category archived' });
        openCategoryManager({ state, onChanged });
        onChanged?.();
      } catch (error) {
        toast(error.message, { tone: 'danger', title: 'Category not archived' });
      }
    }
  });
}
