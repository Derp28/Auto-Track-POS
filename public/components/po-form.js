import { amountInputValue, escapeHtml, icon, money } from '../js/ui.js';
import { parseAmountToCents } from '../js/money.js';

export function poLineRowHtml(line, products) {
  const activeProducts = products.filter((product) => product.active);
  if (line?.productId && !activeProducts.some((product) => product.id === line.productId)) {
    const existing = products.find((product) => product.id === line.productId);
    if (existing) activeProducts.push(existing);
  }
  return `
    <tr data-po-line>
      <td>
        <select data-po-product aria-label="Purchase-order product">
          <option value="">Choose product</option>
          ${activeProducts.map((product) => `<option value="${escapeHtml(product.id)}" data-cost="${product.costCents}" ${line?.productId === product.id ? 'selected' : ''}>${escapeHtml(product.sku)} — ${escapeHtml(product.name)}</option>`).join('')}
        </select>
      </td>
      <td><input class="qty-input" type="number" min="1" step="1" value="${line?.orderedQty || 1}" data-po-qty aria-label="Ordered quantity"></td>
      <td><div class="input-money input-money--compact"><span>₱</span><input inputmode="decimal" value="${amountInputValue(line?.unitCostCents ?? 0)}" data-po-cost aria-label="Unit cost"></div></td>
      <td class="numeric" data-po-line-total>${money((line?.orderedQty || 0) * (line?.unitCostCents || 0))}</td>
      <td><button class="icon-button icon-button--small icon-button--danger" type="button" data-po-remove-line aria-label="Remove purchase-order line">${icon('trash', 15)}</button></td>
    </tr>
  `;
}

export function poLinesHtml(lines, products) {
  return lines.map((line) => poLineRowHtml(line, products)).join('');
}

function readRow(row) {
  const qty = Number(row.querySelector('[data-po-qty]').value);
  const cost = parseAmountToCents(row.querySelector('[data-po-cost]').value);
  const productId = row.querySelector('[data-po-product]').value;
  return {
    productId,
    quantity: Number.isInteger(qty) ? qty : 0,
    unitCostCents: cost ?? 0,
  };
}

export function bindPoLines({ form, state, onChange }) {
  const tbody = form.querySelector('#po-lines-body');
  const addButton = form.querySelector('[data-add-po-line]');
  const totalOutput = form.querySelector('[data-po-total]');

  function recalc() {
    let total = 0;
    tbody.querySelectorAll('[data-po-line]').forEach((row) => {
      const line = readRow(row);
      const lineTotal = line.quantity * line.unitCostCents;
      row.querySelector('[data-po-line-total]').textContent = money(lineTotal);
      total += lineTotal;
    });
    if (totalOutput) totalOutput.textContent = money(total);
    onChange?.(total);
  }

  function addLine(line = null) {
    const row = document.createElement('tbody');
    row.innerHTML = poLineRowHtml(line, state.store.products);
    tbody.appendChild(row.firstElementChild);
    recalc();
  }

  tbody.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-po-remove-line]');
    if (!remove) return;
    if (tbody.querySelectorAll('[data-po-line]').length <= 1) {
      const row = remove.closest('[data-po-line]');
      row.querySelector('[data-po-product]').value = '';
      row.querySelector('[data-po-qty]').value = '1';
      row.querySelector('[data-po-cost]').value = '0.00';
      recalc();
      return;
    }
    remove.closest('[data-po-line]').remove();
    recalc();
  });
  tbody.addEventListener('input', recalc);
  tbody.addEventListener('change', (event) => {
    const productSelect = event.target.closest('[data-po-product]');
    if (productSelect) {
      const product = state.store.products.find((candidate) => candidate.id === productSelect.value);
      const row = productSelect.closest('[data-po-line]');
      if (product) row.querySelector('[data-po-cost]').value = amountInputValue(product.costCents);
    }
    recalc();
  });
  addButton?.addEventListener('click', () => addLine());

  function collectLines() {
    return [...tbody.querySelectorAll('[data-po-line]')].map(readRow).filter((line) => line.productId);
  }

  recalc();
  return { addLine, recalc, collectLines, rowCount: () => tbody.querySelectorAll('[data-po-line]').length };
}
