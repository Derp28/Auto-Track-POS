import {
  badge,
  clearFormErrors,
  emptyState,
  errorState,
  escapeHtml,
  icon,
  money,
  pageHeader,
  saleStatusLabel,
  saleStatusTone,
  setFormFieldError,
  statCard,
} from '../js/ui.js';
import { formatDate, formatDateTime, formatPercentFromBps, parseAmountToCents } from '../js/money.js';
import { confirmDialog, showDialog } from '../components/dialog.js';
import { toast } from '../components/toast.js';
import { rerender } from '../js/router.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const EXPENSE_CATEGORIES = ['Rent', 'Utilities', 'Salaries', 'Supplies', 'Maintenance', 'Transport', 'Marketing', 'Other'];
const PAID_VIA_LABELS = {
  CASH: 'Cash',
  CARD_EXTERNAL: 'External card',
  BANK_TRANSFER: 'Bank transfer',
  OTHER: 'Other',
};

function saleRows(sales, isCashier) {
  return sales.map((sale) => `
    <tr>
      <td>
        <a class="table-link" href="#/sales/${escapeHtml(sale.id)}" data-nav>${escapeHtml(sale.number)}</a>
        <small class="cell-sub">${formatDateTime(sale.createdAt)}</small>
      </td>
      ${isCashier ? '' : `<td>${escapeHtml(sale.cashierName)}</td>`}
      <td class="numeric">${money(sale.totalCents)}</td>
      <td>${badge(saleStatusLabel(sale.status), saleStatusTone(sale.status))}</td>
    </tr>
  `).join('');
}

function compactMoney(cents, currency = 'PHP') {
  const amount = Number(cents || 0) / 100;
  const absolute = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  const symbol = currency === 'PHP' ? '₱' : `${escapeHtml(currency)} `;
  if (absolute >= 1_000_000_000) return `${sign}${symbol}${(absolute / 1_000_000_000).toFixed(1)}b`;
  if (absolute >= 1_000_000) return `${sign}${symbol}${(absolute / 1_000_000).toFixed(1)}m`;
  if (absolute >= 1_000) return `${sign}${symbol}${(absolute / 1_000).toFixed(1)}k`;
  return `${sign}${symbol}${absolute.toFixed(0)}`;
}

function calendarDateLabel(value) {
  if (!value) return 'No date';
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  return `${MONTHS[month - 1] || '—'} ${day}, ${year}`;
}

function formatPercent(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return `${Number(value) > 0 ? '+' : ''}${Number(value).toFixed(1)}%`;
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function changeTone(value) {
  if (value === null || value === undefined) return 'muted';
  if (value > 0) return 'success';
  if (value < 0) return 'danger';
  return 'muted';
}

function comparisonDirection(currentCents, previousCents) {
  const current = Number(currentCents) || 0;
  const previous = Number(previousCents) || 0;
  if (current > previous) return 'up';
  if (current < previous) return 'down';
  return 'flat';
}

function comparisonTone(direction, inverse = false) {
  if (direction === 'flat') return '';
  return (direction === 'up') !== inverse ? 'success' : 'danger';
}

function trendIndicator({
  currentCents,
  previousCents,
  changePct,
  inverse = false,
  periodLabel = 'vs last month',
}) {
  const direction = comparisonDirection(currentCents, previousCents);
  const tone = comparisonTone(direction, inverse) || 'muted';
  const iconName = direction === 'up' ? 'arrowUp' : direction === 'down' ? 'arrowDown' : 'minus';
  const changeLabel = changePct === null || changePct === undefined
    ? (direction === 'up' ? 'New' : direction === 'down' ? 'Lower' : 'No change')
    : formatPercent(changePct);
  return `
    <span class="insight-kpi__trend insight-kpi__trend--${tone}" title="${escapeHtml(`${changeLabel} ${periodLabel}`)}">
      ${icon(iconName, 13)}
      <strong>${escapeHtml(changeLabel)}</strong>
      <small>${escapeHtml(periodLabel)}</small>
    </span>
  `;
}

function kpiCard({ label, value, hint = '', iconName = '', tone = '', trend = null, extra = '' }) {
  return `
    <article class="insight-kpi ${tone ? `insight-kpi--${tone}` : ''}">
      <div class="insight-kpi__top">
        <span class="insight-kpi__label">${escapeHtml(label)}</span>
        ${iconName ? `<span class="insight-kpi__icon">${icon(iconName, 17)}</span>` : ''}
      </div>
      <strong class="insight-kpi__value">${escapeHtml(value)}</strong>
      ${trend ? trendIndicator(trend) : ''}
      ${hint ? `<span class="insight-kpi__hint">${escapeHtml(hint)}</span>` : ''}
      ${extra}
    </article>
  `;
}

function targetKpi(target) {
  if (!target.isSet) {
    return kpiCard({
      label: 'Monthly sales target',
      value: 'Not set',
      hint: 'Set a target in Settings to track pace.',
      iconName: 'chart',
      extra: '<a class="text-link insight-kpi__link" href="#/settings" data-nav>Open settings ' + icon('arrowRight', 14) + '</a>',
    });
  }
  const progress = clampPercent(target.progressPct);
  return `
    <article class="insight-kpi insight-kpi--target">
      <div class="insight-kpi__top">
        <span class="insight-kpi__label">Monthly target</span>
        <span class="insight-kpi__icon">${icon('chart', 17)}</span>
      </div>
      <strong class="insight-kpi__value">${progress.toFixed(1)}%</strong>
      <span class="insight-kpi__hint">${money(target.monthNetCents)} of ${money(target.targetCents)}</span>
      <div class="target-progress">
        <div class="target-progress__track" role="progressbar" aria-label="Monthly sales target progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}">
          <span style="width: ${progress}%"></span>
        </div>
        <div class="target-progress__meta">
          <span>${target.onPace ? 'On pace' : 'Behind pace'} · ${target.daysElapsed}/${target.daysInMonth} days</span>
          <strong>${money(target.remainingCents)} left</strong>
        </div>
      </div>
    </article>
  `;
}

function kpiRow(insights) {
  const comparison = insights.comparison;
  const expenses = insights.expenses;
  const monthComparison = insights.monthComparison
    || (comparison.mode === 'monthly' ? comparison : null);
  const netTrend = monthComparison ? {
    currentCents: monthComparison.currentCents,
    previousCents: monthComparison.previousCents,
    changePct: monthComparison.changePct,
    periodLabel: 'vs last month',
  } : null;
  const netTone = netTrend
    ? comparisonTone(comparisonDirection(netTrend.currentCents, netTrend.previousCents)) || 'accent'
    : 'accent';
  const hasExpenseComparison = expenses.previousTotalCents !== null && expenses.previousTotalCents !== undefined;
  const expenseTrend = hasExpenseComparison ? {
    currentCents: expenses.totalCents,
    previousCents: expenses.previousTotalCents,
    changePct: expenses.changePct,
    inverse: true,
    periodLabel: 'vs last month',
  } : null;
  const expenseTone = expenseTrend
    ? comparisonTone(comparisonDirection(expenseTrend.currentCents, expenseTrend.previousCents), true) || 'warning'
    : (expenses.totalCents ? 'warning' : '');
  const comparisonValue = comparison.changePct === null ? 'No prior sales' : formatPercent(comparison.changePct);
  const comparisonHint = comparison.previousCents
    ? `${money(comparison.previousCents)} previous period`
    : 'No sales in the comparison period';
  return `
    <section class="insight-kpis" aria-label="Shop performance insights">
      ${kpiCard({
        label: 'Net sales this month',
        value: money(insights.target.monthNetCents),
        hint: insights.target.rangeLabel,
        iconName: 'cash',
        tone: netTone,
        trend: netTrend,
      })}
      ${targetKpi(insights.target)}
      ${kpiCard({
        label: comparison.mode === 'yearly' ? 'Year-to-date vs last year' : 'Month-to-date vs last month',
        value: comparisonValue,
        hint: comparisonHint,
        iconName: 'refresh',
        tone: changeTone(comparison.changePct),
        extra: `<span class="insight-kpi__badge">${badge(comparison.periodLabel, changeTone(comparison.changePct))}</span>`,
      })}
      ${kpiCard({
        label: 'Expenses this month',
        value: money(expenses.totalCents),
        hint: `${money(expenses.manualCents)} operating · ${money(expenses.purchaseCents)} inventory`,
        iconName: 'receipt',
        tone: expenseTone,
        trend: expenseTrend,
      })}
    </section>
  `;
}

function trendChart(trend, currency) {
  const points = trend.points || [];
  if (!points.length) {
    return emptyState({ iconName: 'chart', title: 'No trend data', message: 'Sales history will appear after the first recorded sale.' });
  }
  const values = points.map((point) => Math.max(0, Number(point.valueCents) || 0));
  const max = Math.max(...values, 1);
  const label = trend.mode === 'yearly' ? 'Yearly net sales trend' : 'Monthly net sales trend';
  const summary = points
    .map((point) => `${point.label}: ${money(point.valueCents, currency)}`)
    .join(', ');
  const count = points.length;
  const top = 14;
  const baseline = 90;
  const coordinates = points.map((point, index) => ({
    point,
    value: values[index],
    x: ((index + 0.5) / count) * 100,
    y: baseline - (values[index] / max) * (baseline - top),
  }));
  const linePath = coordinates
    .map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(' ');
  const areaPath = `M ${coordinates[0].x.toFixed(2)} ${baseline} ${coordinates
    .map(({ x, y }) => `L ${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(' ')} L ${coordinates[coordinates.length - 1].x.toFixed(2)} ${baseline} Z`;
  return `
    <div class="trend-chart" role="img" aria-label="${escapeHtml(`${label}. ${summary}`)}">
      <div class="trend-chart__plot">
        <svg class="trend-chart__svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id="trend-area-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#2aa79b" stop-opacity="0.28"></stop>
              <stop offset="100%" stop-color="#2aa79b" stop-opacity="0"></stop>
            </linearGradient>
          </defs>
          <path class="trend-chart__area" d="${areaPath}"></path>
          <path class="trend-chart__path" d="${linePath}"></path>
        </svg>
        <div class="trend-chart__points">
          ${coordinates.map(({ point, value, x, y }) => `
            <div class="trend-chart__point ${point.isCurrent ? 'is-current' : ''}" style="left: ${x.toFixed(2)}%; top: ${y.toFixed(2)}%">
              <span class="trend-chart__value">${escapeHtml(compactMoney(value, currency))}</span>
              <span class="trend-chart__dot" title="${escapeHtml(money(point.valueCents, currency))}"></span>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="trend-chart__axis" style="grid-template-columns: repeat(${count}, minmax(0, 1fr));">
        ${points.map((point) => `
          <span class="trend-chart__label ${point.isCurrent ? 'is-current' : ''}">${escapeHtml(point.label)}${point.isCurrent ? '<small>MTD</small>' : ''}</span>
        `).join('')}
      </div>
    </div>
  `;
}

function donutChart(topProducts, currency) {
  const totalCents = Number(topProducts?.totalCents) || 0;
  if (!totalCents || !topProducts.items?.length) {
    return emptyState({
      iconName: 'box',
      title: 'No product sales yet',
      message: 'The product mix appears after net sales are recorded for this month.',
    });
  }
  const entries = [...topProducts.items];
  if (topProducts.otherCents > 0) {
    entries.push({
      name: 'Other products',
      sku: '',
      categoryName: 'Remaining net sales',
      netCents: topProducts.otherCents,
      sharePct: topProducts.otherSharePct,
      isOther: true,
    });
  }
  const circumference = 2 * Math.PI * 42;
  let offset = 0;
  const segments = entries.map((entry, index) => {
    const fraction = Math.max(0, Math.min(1, Number(entry.netCents) / totalCents));
    const length = fraction * circumference;
    const segment = `<circle class="donut-chart__segment donut-chart__segment--${index + 1}" cx="60" cy="60" r="42" fill="none" stroke-width="14" stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}"><title>${escapeHtml(`${entry.name}: ${money(entry.netCents, currency)} (${Number(entry.sharePct).toFixed(1)}%)`)}</title></circle>`;
    offset += length;
    return segment;
  }).join('');
  return `
    <div class="donut-layout">
      <div class="donut-chart" role="img" aria-label="${escapeHtml(`Product sales mix. ${entries.map((entry) => `${entry.name} ${Number(entry.sharePct).toFixed(1)}%`).join(', ')}`)}">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle class="donut-chart__track" cx="60" cy="60" r="42" fill="none" stroke-width="14"></circle>
          ${segments}
        </svg>
        <div class="donut-chart__center">
          <span>Net sales</span>
          <strong>${escapeHtml(compactMoney(totalCents, currency))}</strong>
        </div>
      </div>
      <ul class="donut-legend">
        ${entries.map((entry, index) => `
          <li class="donut-legend__item">
            <span class="donut-legend__dot donut-legend__dot--${index + 1}" aria-hidden="true"></span>
            <div class="donut-legend__copy">
              <strong title="${escapeHtml(entry.name)}">${escapeHtml(entry.name)}</strong>
              <small>${entry.isOther ? 'Combined remaining items' : escapeHtml(entry.categoryName || entry.sku || 'Product')}</small>
            </div>
            <span class="donut-legend__share">${Number(entry.sharePct).toFixed(1)}%</span>
          </li>
        `).join('')}
      </ul>
    </div>
    ${topProducts.leading ? `
      <div class="insight-note">
        ${icon('chart', 16)}
        <span><strong>${escapeHtml(topProducts.leading.name)}</strong> is the leading sales item with ${Number(topProducts.leading.sharePct).toFixed(1)}% of net revenue.</span>
      </div>
    ` : ''}
  `;
}

function performanceSection(insights, settings) {
  const modeLabel = insights.trend.mode === 'yearly' ? 'Yearly view' : 'Monthly view';
  return `
    <div class="insight-panels">
      <section class="card insight-panel insight-panel--trend">
        <div class="card__head">
          <div>
            <h2>${insights.trend.mode === 'yearly' ? 'Yearly sales trend' : 'Monthly sales trend'}</h2>
            <p>${insights.trend.mode === 'yearly' ? 'Net sales for the last five years.' : 'Net sales for the last six months.'} ${insights.trend.points.some((point) => point.isCurrent) ? 'The current period is month-to-date or year-to-date.' : ''}</p>
          </div>
          ${badge(modeLabel, 'accent')}
        </div>
        ${trendChart(insights.trend, settings.currency)}
      </section>
      <section class="card insight-panel insight-panel--donut">
        <div class="card__head">
          <div><h2>Top products</h2><p>Ranked by net sales revenue this month, after refunds.</p></div>
          ${badge('Net revenue', 'muted')}
        </div>
        ${donutChart(insights.topProducts, settings.currency)}
      </section>
    </div>
  `;
}

function expenseRows(expenses) {
  return expenses.map((expense) => `
    <li class="expense-row">
      <div class="expense-row__copy">
        <strong>${escapeHtml(expense.category)}</strong>
        <small>${calendarDateLabel(expense.expenseDate)} · ${escapeHtml(expense.description)} · ${escapeHtml(PAID_VIA_LABELS[expense.paidVia] || expense.paidVia)}${expense.createdByName ? ` · ${escapeHtml(expense.createdByName)}` : ''}</small>
      </div>
      <span class="expense-row__amount">${money(expense.amountCents)}</span>
      <div class="row-actions">
        <button class="icon-button icon-button--small" type="button" data-edit-expense="${escapeHtml(expense.id)}" aria-label="Edit ${escapeHtml(expense.category)} expense" title="Edit expense">${icon('edit', 15)}</button>
        <button class="icon-button icon-button--small icon-button--danger" type="button" data-delete-expense="${escapeHtml(expense.id)}" aria-label="Delete ${escapeHtml(expense.category)} expense" title="Delete expense">${icon('trash', 15)}</button>
      </div>
    </li>
  `).join('');
}

function purchaseRows(receipts) {
  return receipts.map((receipt) => `
    <li class="expense-row expense-row--purchase">
      <div class="expense-row__copy">
        <strong>${escapeHtml(receipt.number)}</strong>
        <small>${calendarDateLabel(receipt.receiptDate)} · PO ${escapeHtml(receipt.purchaseOrderNumber)} · ${escapeHtml(receipt.supplierName)}</small>
      </div>
      <span class="expense-row__amount">${money(receipt.totalCents)}</span>
      <span class="badge badge--info">Inventory</span>
    </li>
  `).join('');
}

function expensesSection(insights) {
  const expenses = insights.expenses;
  return `
    <section class="card expense-panel">
      <div class="card__head">
        <div><h2>Expenses &amp; stock purchases</h2><p>Operating expenses are recorded manually. Inventory purchases come from received purchase-order receipts and are kept separate.</p></div>
        <button class="btn btn--secondary btn--small" type="button" data-new-expense>${icon('plus', 15)} Record expense</button>
      </div>
      <div class="expense-summary">
        <div><span>Operating expenses</span><strong>${money(expenses.manualCents)}</strong><small>${expenses.manualCount} recorded expense${expenses.manualCount === 1 ? '' : 's'}</small></div>
        <div><span>Inventory purchases</span><strong>${money(expenses.purchaseCents)}</strong><small>${expenses.purchaseCount} received receipt${expenses.purchaseCount === 1 ? '' : 's'}</small></div>
        <div><span>Total outflows</span><strong>${money(expenses.totalCents)}</strong><small>${expenses.rangeLabel}</small></div>
        <div><span>Sales after outflows</span><strong class="${expenses.salesAfterOutflowsCents < 0 ? 'is-negative' : ''}">${money(expenses.salesAfterOutflowsCents)}</strong><small>Net sales minus recorded outflows</small></div>
      </div>
      <div class="expense-columns">
        <div>
          <div class="expense-columns__head"><h3>Recent operating expenses</h3><span>Latest ${expenses.manual.length} of ${expenses.manualCount}</span></div>
          ${expenses.manual.length ? `<ul class="expense-list">${expenseRows(expenses.manual)}</ul>` : `
            <div class="expense-empty">
              ${icon('receipt', 20)}
              <p>No operating expenses recorded this month.</p>
              <button class="text-link" type="button" data-new-expense>Record the first expense ${icon('arrowRight', 14)}</button>
            </div>
          `}
        </div>
        <div>
          <div class="expense-columns__head"><h3>Recent stock receipts</h3><span>Latest ${expenses.purchaseReceipts.length} of ${expenses.purchaseCount}</span></div>
          ${expenses.purchaseReceipts.length ? `<ul class="expense-list">${purchaseRows(expenses.purchaseReceipts)}</ul>` : `<div class="expense-empty">${icon('truck', 20)}<p>No purchase-order receipts this month.</p></div>`}
        </div>
      </div>
      <div class="expense-panel__note">${icon('info', 15)} <span>Stock purchases add inventory, not operating profit. This view shows cash outflows side by side; it is not a full accounting profit statement.</span></div>
    </section>
  `;
}

function openExpenseDialog(state, expense = null) {
  const isEdit = Boolean(expense);
  const businessDate = state.store.meta.businessDate || new Date().toISOString().slice(0, 10);
  const control = showDialog({
    title: isEdit ? 'Edit expense' : 'Record operating expense',
    description: isEdit
      ? 'Changes are kept in this browser tab for the demo.'
      : 'Record a shop expense for this month. Inventory purchases belong in purchasing, not here.',
    size: 'md',
    initialFocus: '#expense-amount',
    body: `
      <form id="expense-form" novalidate>
        <div class="form-grid">
          <div class="field">
            <label for="expense-date">Date</label>
            <input id="expense-date" name="expenseDate" type="date" max="${escapeHtml(businessDate)}" value="${escapeHtml(expense?.expenseDate || businessDate)}" required>
          </div>
          <div class="field">
            <label for="expense-category">Category</label>
            <input id="expense-category" name="category" type="text" list="expense-categories" maxlength="60" value="${isEdit ? escapeHtml(expense.category) : ''}" placeholder="e.g. Utilities" required>
            <datalist id="expense-categories">
              ${EXPENSE_CATEGORIES.map((category) => `<option value="${escapeHtml(category)}"></option>`).join('')}
            </datalist>
          </div>
          <div class="field field--full">
            <label for="expense-description">Description</label>
            <input id="expense-description" name="description" type="text" maxlength="200" value="${isEdit ? escapeHtml(expense.description) : ''}" placeholder="What was paid for?" required>
          </div>
          <div class="field">
            <label for="expense-amount">Amount</label>
            <div class="input-suffix">
              <input id="expense-amount" name="amount" type="number" min="0.01" step="0.01" value="${isEdit ? (Number(expense.amountCents) / 100).toFixed(2) : ''}" placeholder="0.00" required>
              <span>PHP</span>
            </div>
          </div>
          <div class="field">
            <label for="expense-paid-via">Paid via</label>
            <select id="expense-paid-via" name="paidVia">
              ${Object.entries(PAID_VIA_LABELS).map(([value, label]) => `<option value="${value}" ${isEdit && expense.paidVia === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="callout callout--muted">${icon('lock', 16)} <span>Do not enter card numbers, expiry dates, or other raw payment data. External card payments use a reference only.</span></div>
      </form>
    `,
    footer: `
      <button class="btn btn--secondary" type="button" data-dialog-close>Cancel</button>
      <button class="btn btn--primary" type="submit" form="expense-form" data-expense-save>${isEdit ? 'Save changes' : 'Record expense'}</button>
    `,
  });
  const form = control.dialog.querySelector('#expense-form');
  const saveButton = control.dialog.querySelector('[data-expense-save]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormErrors(form);
    const data = new FormData(form);
    const rawAmount = String(data.get('amount') || '').trim();
    const amountCents = parseAmountToCents(rawAmount);
    const payload = {
      expenseDate: String(data.get('expenseDate') || '').trim(),
      category: String(data.get('category') || '').trim(),
      description: String(data.get('description') || '').trim(),
      amountCents,
      paidVia: String(data.get('paidVia') || 'CASH'),
    };
    let hasError = false;
    if (!payload.expenseDate) {
      setFormFieldError(form, 'expenseDate', 'Choose a date.');
      hasError = true;
    }
    if (!payload.category) {
      setFormFieldError(form, 'category', 'Enter a category.');
      hasError = true;
    }
    if (!payload.description) {
      setFormFieldError(form, 'description', 'Describe the expense.');
      hasError = true;
    }
    if (amountCents === null || amountCents <= 0) {
      setFormFieldError(form, 'amount', 'Enter an amount greater than zero with at most two decimals.');
      hasError = true;
    }
    if (hasError) return;
    saveButton.disabled = true;
    saveButton.textContent = 'Saving…';
    try {
      if (isEdit) {
        await state.store.updateExpense(expense.id, payload);
        toast('Expense updated.', { tone: 'success', title: 'Expense saved' });
      } else {
        await state.store.createExpense(payload);
        toast('Expense recorded.', { tone: 'success', title: 'Expense saved' });
      }
      control.close();
      rerender();
    } catch (error) {
      const fields = error.fieldErrors || error.fields || null;
      if (fields && typeof fields === 'object') {
        for (const [field, message] of Object.entries(fields)) {
          setFormFieldError(form, field === 'amountCents' ? 'amount' : field, String(message));
        }
      }
      toast(error.message || 'The expense could not be saved.', { tone: 'danger', title: 'Expense not saved' });
      saveButton.disabled = false;
      saveButton.textContent = isEdit ? 'Save changes' : 'Record expense';
    }
  });
}

async function deleteExpense(state, expense) {
  const confirmed = await confirmDialog({
    title: 'Delete this expense?',
    message: `Remove the ${expense.category.toLowerCase()} expense of ${money(expense.amountCents)}?`,
    details: 'The expense will be removed from dashboard totals, but the audit log keeps a record of the deletion.',
    confirmText: 'Delete expense',
    tone: 'danger',
  });
  if (!confirmed) return;
  try {
    await state.store.deleteExpense(expense.id);
    toast('Expense removed from active totals.', { tone: 'success', title: 'Expense deleted' });
    rerender();
  } catch (error) {
    toast(error.message || 'The expense could not be deleted.', { tone: 'danger', title: 'Expense not deleted' });
  }
}

function recentSalesSection(data, isCashier) {
  return `
    <section class="card card--table">
      <div class="card__head">
        <div><h2>Recent sales</h2><p>Latest completed and voided transactions for this scope.</p></div>
        <a class="text-link" href="#/sales" data-nav>All sales ${icon('arrowRight', 15)}</a>
      </div>
      ${data.recentSales.length ? `
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Sale</th>${isCashier ? '' : '<th>Cashier</th>'}<th class="numeric">Total</th><th>Status</th></tr></thead>
            <tbody>${saleRows(data.recentSales, isCashier)}</tbody>
          </table>
        </div>
      ` : emptyState({ iconName: 'receipt', title: 'No sales yet today', message: 'Completed checkouts appear here as soon as the demo confirms them.', action: '<a class="btn btn--secondary" href="#/checkout" data-nav>Open checkout</a>' })}
    </section>
  `;
}

function lowStockSection(data) {
  return `
    <section class="card">
      <div class="card__head">
        <div><h2>Low-stock watch</h2><p>Active products at or below their reorder level.</p></div>
        <a class="text-link" href="#/inventory" data-nav>Inventory ${icon('arrowRight', 15)}</a>
      </div>
      ${data.lowStock.length ? `
        <ul class="stock-watch">
          ${data.lowStock.map((product) => `
            <li>
              <span class="stock-watch__mark ${product.stockOnHand === 0 ? 'is-out' : ''}" aria-hidden="true">${product.stockOnHand === 0 ? '!' : product.stockOnHand}</span>
              <div class="stock-watch__copy">
                <strong>${escapeHtml(product.name)}</strong>
                <small>${escapeHtml(product.sku)} · ${escapeHtml(product.categoryName)}</small>
              </div>
              <span class="stock-watch__level">${product.stockOnHand === 0 ? badge('Out', 'danger') : badge(`${product.stockOnHand} / ${product.reorderLevel}`, 'warning')}</span>
            </li>
          `).join('')}
        </ul>
        <div class="card__foot"><span>${data.lowStockCount} product${data.lowStockCount === 1 ? '' : 's'} need attention</span><a class="text-link" href="#/reports" data-nav>Low-stock report ${icon('arrowRight', 14)}</a></div>
      ` : emptyState({ iconName: 'check', title: 'Stock levels look healthy', message: 'No active products are at or below their reorder level.' })}
    </section>
  `;
}

function controlsSection(settings, state) {
  return `
    <section class="card card--subtle">
      <div class="card__head">
        <div><h2>Today’s controls</h2><p>Live settings applied to new sales.</p></div>
        ${badge('Demo settings', 'muted')}
      </div>
      <div class="control-grid">
        <div><span>Business date</span><strong>${formatDate(state.store.meta.businessDate, settings.timezone)}</strong><small>Cutoff ${escapeHtml(settings.businessDayCutoff)} · ${escapeHtml(settings.timezone)}</small></div>
        <div><span>Tax</span><strong>${settings.taxEnabled ? formatPercentFromBps(settings.taxRateBps) : 'Disabled'}</strong><small>${settings.taxEnabled ? (settings.taxInclusive ? 'Inclusive pricing' : 'Added per line') : '0% exclusive default'}</small></div>
        <div><span>Cashier discount limit</span><strong>${formatPercentFromBps(settings.cashierDiscountLimitBps)}</strong><small>Higher discounts require administrator approval</small></div>
        <div><span>Terminal</span><strong>${escapeHtml(state.terminalLabel)}</strong><small>This browser only · not a shop-wide setting</small></div>
      </div>
    </section>
  `;
}

export function renderDashboard(ctx) {
  const { state } = ctx;
  const data = state.store.getDashboard();
  const isCashier = state.currentUser.role === 'CASHIER';
  const settings = state.store.settings;
  const insights = data?.insights || null;
  const dateLabel = new Intl.DateTimeFormat('en-PH', {
    timeZone: settings.timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(state.store.meta.clockIso || Date.now()));

  const header = pageHeader({
    eyebrow: dateLabel,
    title: isCashier ? `Good afternoon, ${state.currentUser.displayName.split(' ')[0]}` : 'Shop dashboard',
    description: isCashier
      ? 'Your own counter activity for the current business day. Cost and stock value are hidden for cashier roles.'
      : 'A KPI-first view of today’s counter, monthly target pace, product mix, expenses, and stock pressure.',
    actions: `<a class="btn btn--primary" href="#/checkout" data-nav>${icon('cart', 17)} New sale</a>`,
  });

  if (!data) {
    return {
      html: `${header}${errorState({
        title: 'Dashboard data was not loaded',
        message: 'The last demo snapshot did not include the dashboard. Reload the demo to try again.',
      })}`,
      after(container) {
        container.querySelector('[data-retry-view]')?.addEventListener('click', async () => {
          await state.store.refreshQuietly();
          rerender();
        });
      },
      focus: 'h1',
    };
  }

  const taxHint = settings.taxEnabled
    ? `${formatPercentFromBps(settings.taxRateBps)} ${settings.taxInclusive ? 'inclusive' : 'exclusive'}`
    : 'Tax disabled in settings';
  return {
    html: `
      ${header}

      ${!isCashier && insights ? kpiRow(insights) : ''}
      ${!isCashier && !insights ? `<div class="callout callout--warning">${icon('alert', 17)} <span>Performance insights were not included in the demo response. Reload the demo to try again.</span></div>` : ''}

      ${!isCashier && insights ? performanceSection(insights, settings) : ''}

      <section class="stat-grid stat-grid--six" aria-label="Today's summary">
        ${statCard({ label: isCashier ? 'My collected sales today' : 'Collected sales today', value: money(data.totalCents), hint: `${data.transactionCount} completed transaction${data.transactionCount === 1 ? '' : 's'}`, tone: 'accent', iconName: 'cash' })}
        ${statCard({ label: 'Average sale', value: money(data.averageSaleCents), hint: 'Completed sales only', iconName: 'chart' })}
        ${statCard({ label: 'Line discounts', value: money(data.discountsCents), hint: 'Discount total', iconName: 'minus' })}
        ${statCard({ label: 'Tax snapshot', value: money(data.taxCents), hint: taxHint, iconName: 'receipt' })}
        ${statCard({ label: 'Refunds', value: money(data.refundsCents), hint: `${data.returnsCount} return${data.returnsCount === 1 ? '' : 's'} today`, tone: data.refundsCents ? 'warning' : '', iconName: 'refresh' })}
        ${statCard({ label: 'Voids', value: String(data.voidCount), hint: 'Same-day voids', tone: data.voidCount ? 'danger' : '', iconName: 'alert' })}
      </section>

      <div class="dashboard-grid">
        ${recentSalesSection(data, isCashier)}
        ${lowStockSection(data)}
      </div>

      ${!isCashier && insights ? `
        <div class="dashboard-lower">
          ${expensesSection(insights)}
          ${controlsSection(settings, state)}
        </div>
      ` : controlsSection(settings, state)}
    `,
    after(container) {
      if (isCashier || !insights) return;
      const manualExpenses = insights.expenses.manual || [];
      const openNew = () => openExpenseDialog(state);
      container.querySelectorAll('[data-new-expense]').forEach((button) => {
        button.addEventListener('click', openNew);
      });
      container.querySelectorAll('[data-edit-expense]').forEach((button) => {
        button.addEventListener('click', () => {
          const expense = manualExpenses.find((entry) => String(entry.id) === String(button.dataset.editExpense));
          if (expense) openExpenseDialog(state, expense);
        });
      });
      container.querySelectorAll('[data-delete-expense]').forEach((button) => {
        button.addEventListener('click', () => {
          const expense = manualExpenses.find((entry) => String(entry.id) === String(button.dataset.deleteExpense));
          if (expense) deleteExpense(state, expense);
        });
      });
    },
    focus: 'h1',
  };
}
