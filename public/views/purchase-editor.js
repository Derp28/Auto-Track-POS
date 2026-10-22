import { escapeHtml, icon, pageHeader } from '../js/ui.js';
import { bindPoLines, poLinesHtml } from '../components/po-form.js';
import { toast } from '../components/toast.js';
import { navigate } from '../js/router.js';

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function renderPurchaseEditor(ctx) {
  const { state, params } = ctx;
  const editing = Boolean(params.id);
  const po = editing ? state.store.getPurchaseOrder(params.id) : null;
  if (editing && !po) {
    return {
      html: `${pageHeader({ eyebrow: 'Purchasing', title: 'Purchase order not found' })}<div class="state-card"><h3>That draft does not exist.</h3><p>Check the link or return to the purchasing ledger.</p><a class="btn btn--primary" href="#/purchasing" data-nav>Back to purchasing</a></div>`,
      focus: 'h1',
    };
  }
  if (editing && po.status !== 'DRAFT') {
    return {
      html: `${pageHeader({ eyebrow: 'Purchasing', title: 'Draft is locked' })}<div class="callout callout--warning">${icon('lock', 18)} <span>Only draft purchase orders can be edited. This order is ${escapeHtml(po.status.replace(/_/g, ' ').toLowerCase())}.</span></div><a class="btn btn--secondary" href="#/purchasing/${escapeHtml(po.id)}" data-nav>Back to purchase order</a>`,
      focus: 'h1',
    };
  }
  const activeSuppliers = state.store.getSuppliers();
  const initialLines = editing
    ? po.lines.map((line) => ({ productId: line.productId, orderedQty: line.orderedQty, unitCostCents: line.unitCostCents }))
    : [{ productId: '', orderedQty: 1, unitCostCents: 0 }];
  const expectedAt = po?.expectedAt || addDays(state.store.meta.businessDate, 3);
  return {
    html: `
      ${pageHeader({
        eyebrow: 'Purchasing · draft',
        title: editing ? `Edit ${po.number}` : 'New purchase order',
        description: 'A draft does not move stock. Ordering and receiving are separate server actions.',
        actions: `<a class="btn btn--secondary" href="#${editing ? `/purchasing/${po.id}` : '/purchasing'}" data-nav>${icon('arrowLeft', 16)} Cancel</a>`,
      })}
      <form id="po-editor-form" class="card po-editor" novalidate>
        <div class="po-editor__head">
          <div>
            <h2>Order details</h2>
            <p>Only active suppliers and products can be added to a new draft.</p>
          </div>
          <span class="badge badge--muted">Draft · not yet ordered</span>
        </div>
        <div class="form-grid">
          <div class="field">
            <label for="po-supplier">Supplier <span class="required">*</span></label>
            <select id="po-supplier" name="supplierId" required>
              <option value="">Choose a supplier</option>
              ${activeSuppliers.map((supplier) => `<option value="${escapeHtml(supplier.id)}" ${po?.supplierId === supplier.id ? 'selected' : ''}>${escapeHtml(supplier.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="po-expected">Expected date <span class="required">*</span></label>
            <input id="po-expected" name="expectedAt" type="date" value="${escapeHtml(expectedAt)}" required>
          </div>
          <div class="form-grid__wide field">
            <label for="po-notes">Notes</label>
            <textarea id="po-notes" name="notes" rows="2" maxlength="240" placeholder="Delivery instructions or internal notes">${escapeHtml(po?.notes || '')}</textarea>
          </div>
        </div>
        <div class="po-lines-head">
          <div><h2>Order lines</h2><p>Enter quantity and unit cost. Totals update as you type.</p></div>
          <button class="btn btn--secondary btn--small" type="button" data-add-po-line>${icon('plus', 15)} Add line</button>
        </div>
        <div class="table-wrap">
          <table class="data-table data-table--po-editor">
            <thead><tr><th>Product</th><th>Qty</th><th>Unit cost</th><th class="numeric">Line total</th><th></th></tr></thead>
            <tbody id="po-lines-body">${poLinesHtml(initialLines, state.store.products)}</tbody>
          </table>
        </div>
        <div class="po-editor__foot">
          <div class="po-total"><span>Draft total</span><strong data-po-total>₱0.00</strong></div>
          <div class="po-editor__actions">
            <span class="muted">No stock moves until receiving.</span>
            <button class="btn btn--primary" type="submit">${icon('check', 16)} ${editing ? 'Save draft changes' : 'Create draft'}</button>
          </div>
        </div>
        <div data-po-error></div>
      </form>
    `,
    after(container) {
      const form = container.querySelector('#po-editor-form');
      const errorSlot = form.querySelector('[data-po-error]');
      const lines = bindPoLines({ form, state });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        errorSlot.innerHTML = '';
        const submit = form.querySelector('[type="submit"]');
        const supplierId = form.querySelector('#po-supplier').value;
        const expected = form.querySelector('#po-expected').value;
        const notes = form.querySelector('#po-notes').value;
        const collected = lines.collectLines().filter((line) => line.productId);
        if (!supplierId) {
          errorSlot.innerHTML = `<div class="form-error" role="alert">${icon('alert', 16)} Choose a supplier.</div>`;
          form.querySelector('#po-supplier').focus();
          return;
        }
        if (!expected) {
          errorSlot.innerHTML = `<div class="form-error" role="alert">${icon('alert', 16)} Choose an expected date.</div>`;
          form.querySelector('#po-expected').focus();
          return;
        }
        if (!collected.length) {
          errorSlot.innerHTML = `<div class="form-error" role="alert">${icon('alert', 16)} Add at least one product line.</div>`;
          return;
        }
        submit.disabled = true;
        try {
          const saved = editing
            ? await state.store.updatePurchaseOrder(po.id, { supplierId, expectedAt: expected, notes, lines: collected })
            : await state.store.createPurchaseOrder({ supplierId, expectedAt: expected, notes, lines: collected });
          toast(`Purchase order ${saved.number} ${editing ? 'updated' : 'created'}.`, {
            tone: 'success',
            title: editing ? 'Draft updated' : 'Draft created',
          });
          navigate(`/purchasing/${saved.id}`);
        } catch (error) {
          errorSlot.innerHTML = `<div class="form-error" role="alert">${icon('alert', 16)} ${escapeHtml(error.message)}</div>`;
        } finally {
          submit.disabled = false;
        }
      });
    },
    focus: '#po-supplier',
  };
}
