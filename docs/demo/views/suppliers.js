import { badge, emptyState, escapeHtml, icon, pageHeader } from '../js/ui.js';
import { confirmDialog } from '../components/dialog.js';
import { openSupplierForm } from '../components/supplier-form.js';
import { toast } from '../components/toast.js';

let supplierQuery = '';
let supplierActive = 'active';

function filtered(state) {
  const query = supplierQuery.trim().toLowerCase();
  return state.store.getSuppliers({ includeInactive: true })
    .filter((supplier) => {
      if (supplierActive === 'active' && !supplier.active) return false;
      if (supplierActive === 'inactive' && supplier.active) return false;
      if (query) {
        const haystack = `${supplier.name} ${supplier.contactName} ${supplier.phone} ${supplier.email}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
}

function rows(state) {
  return filtered(state).map((supplier) => `
    <tr class="${supplier.active ? '' : 'row--muted'}">
      <td>
        <strong>${escapeHtml(supplier.name)}</strong>
        <small class="cell-sub">${escapeHtml(supplier.contactName || 'No contact')}</small>
      </td>
      <td>${escapeHtml(supplier.phone || '—')}</td>
      <td>${supplier.email ? `<a class="text-link" href="mailto:${escapeHtml(supplier.email)}">${escapeHtml(supplier.email)}</a>` : '<span class="muted">—</span>'}</td>
      <td>${supplier.notes ? escapeHtml(supplier.notes) : '<span class="muted">—</span>'}</td>
      <td>${supplier.active ? badge('Active', 'success') : badge('Archived', 'muted')}</td>
      <td class="numeric"><div class="row-actions">
        <button class="icon-button icon-button--small" type="button" data-edit-supplier="${escapeHtml(supplier.id)}" aria-label="Edit ${escapeHtml(supplier.name)}">${icon('edit', 15)}</button>
        ${supplier.active ? `<button class="icon-button icon-button--small icon-button--danger" type="button" data-archive-supplier="${escapeHtml(supplier.id)}" aria-label="Archive ${escapeHtml(supplier.name)}">${icon('trash', 15)}</button>` : ''}
      </div></td>
    </tr>
  `).join('');
}

export function renderSuppliers(ctx) {
  const { state } = ctx;
  return {
    html: `
      ${pageHeader({
        eyebrow: 'Purchasing',
        title: 'Suppliers',
        description: 'Supplier records used by purchase orders. Archived suppliers stay in history.',
        actions: `
          <a class="btn btn--secondary" href="#/purchasing" data-nav>${icon('truck', 16)} Purchase orders</a>
          <button class="btn btn--primary" type="button" data-new-supplier>${icon('plus', 17)} New supplier</button>
        `,
      })}
      <div class="toolbar toolbar--wrap">
        <div class="search-field search-field--compact">
          <span class="search-field__icon">${icon('search', 17)}</span>
          <input id="supplier-search" type="search" placeholder="Search supplier, contact, phone…" value="${escapeHtml(supplierQuery)}">
        </div>
        <label class="filter-field"><span>Status</span>
          <select id="supplier-active">
            <option value="active" ${supplierActive === 'active' ? 'selected' : ''}>Active only</option>
            <option value="all" ${supplierActive === 'all' ? 'selected' : ''}>All suppliers</option>
            <option value="inactive" ${supplierActive === 'inactive' ? 'selected' : ''}>Archived only</option>
          </select>
        </label>
      </div>
      <section class="card card--table">
        <div class="card__head"><div><h2>Suppliers</h2><p id="supplier-count">${filtered(state).length} supplier${filtered(state).length === 1 ? '' : 's'} shown.</p></div>${badge('Admin only', 'accent')}</div>
        <div id="supplier-table-body">${filtered(state).length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Supplier</th><th>Phone</th><th>Email</th><th>Notes</th><th>Status</th><th></th></tr></thead><tbody>${rows(state)}</tbody></table></div>` : emptyState({ iconName: 'users', title: 'No suppliers match', message: 'Try another search or status filter.' })}</div>
      </section>
    `,
    after(container) {
      const body = container.querySelector('#supplier-table-body');
      const count = container.querySelector('#supplier-count');
      const refresh = () => {
        const list = filtered(state);
        count.textContent = `${list.length} supplier${list.length === 1 ? '' : 's'} shown.`;
        body.innerHTML = list.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Supplier</th><th>Phone</th><th>Email</th><th>Notes</th><th>Status</th><th></th></tr></thead><tbody>${rows(state)}</tbody></table></div>` : emptyState({ iconName: 'users', title: 'No suppliers match', message: 'Try another search or status filter.' });
      };
      let timer;
      container.querySelector('#supplier-search').addEventListener('input', (event) => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          supplierQuery = event.target.value;
          refresh();
        }, 140);
      });
      container.querySelector('#supplier-active').addEventListener('change', (event) => {
        supplierActive = event.target.value;
        refresh();
      });
      container.querySelector('[data-new-supplier]').addEventListener('click', () => openSupplierForm({ state, onSaved: refresh }));
      body.addEventListener('click', async (event) => {
        const edit = event.target.closest('[data-edit-supplier]');
        if (edit) {
          const supplier = state.store.getSupplier(edit.dataset.editSupplier);
          if (supplier) openSupplierForm({ state, supplier, onSaved: refresh });
          return;
        }
        const archive = event.target.closest('[data-archive-supplier]');
        if (archive) {
          const supplier = state.store.getSupplier(archive.dataset.archiveSupplier);
          if (!supplier) return;
          const confirmed = await confirmDialog({
            title: 'Archive this supplier?',
            message: `${supplier.name} will be hidden from new purchase orders but remains in existing PO history.`,
            confirmText: 'Archive supplier',
            tone: 'danger',
            details: 'This change is saved to the demo shop. Existing purchase orders keep their supplier record.',
          });
          if (!confirmed) return;
          archive.disabled = true;
          try {
            await state.store.archiveSupplier(supplier.id);
            refresh();
            toast(`${supplier.name} archived.`, { tone: 'success', title: 'Supplier archived' });
          } catch (error) {
            toast(error.message, { tone: 'danger', title: 'Supplier not archived' });
          } finally {
            archive.disabled = false;
          }
        }
      });
    },
    focus: 'h1',
  };
}
