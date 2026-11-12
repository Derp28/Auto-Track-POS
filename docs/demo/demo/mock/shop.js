/**
 * In-browser stand-in for the Auto-Track Express API.
 *
 * The demo keeps a small, fully in-memory shop (products, sales, purchasing,
 * users) and applies the same money, stock-value, return and void rules as
 * server/services/*.js. Nothing is persisted; a page reload restores the seed.
 */
import {
  calculateLine,
  costValueFor,
  refundFor,
  restoredCostValue,
  wacFor,
} from './money.js';

export const DEMO_VERSION = '1.0.0';
export const DEMO_PASSWORD = 'demo1234';

export class DemoError extends Error {
  constructor(status, code, message, fields = null) {
    super(message);
    this.name = 'DemoError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export function fail(status, code, message, fields = null) {
  throw new DemoError(status, code, message, fields);
}

const pad = (value, width = 2) => String(value).padStart(width, '0');

export function localDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function iso(value) {
  return new Date(value).toISOString();
}

function text(value, field, { required = true, max = 200 } = {}) {
  const raw = value === undefined || value === null ? '' : String(value).trim();
  if (required && !raw) fail(400, 'VALIDATION_ERROR', `${field} is required.`, { [field]: 'Required.' });
  if (raw.length > max) {
    fail(400, 'VALIDATION_ERROR', `${field} must be ${max} characters or fewer.`, { [field]: 'Too long.' });
  }
  return raw;
}

function whole(value, field, { min = 0, max = 9999999 } = {}) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    fail(400, 'VALIDATION_ERROR', `${field} must be a whole number between ${min} and ${max}.`, {
      [field]: 'Invalid number.',
    });
  }
  return parsed;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const EXPENSE_PAID_VIA = ['CASH', 'CARD_EXTERNAL', 'BANK_TRANSFER', 'OTHER'];

function parseDate(value) {
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  return { year, month, day };
}

function calendarDate(year, month, day) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addMonths(year, month, delta) {
  const total = year * 12 + (month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12 + 12) % 12 + 1 };
}

function formatRange(from, to) {
  const start = parseDate(from);
  const end = parseDate(to);
  if (start.year === end.year && start.month === end.month) {
    return `${MONTHS[start.month - 1]} ${start.day}–${end.day}, ${start.year}`;
  }
  if (start.year === end.year) {
    return `${MONTHS[start.month - 1]} ${start.day}–${MONTHS[end.month - 1]} ${end.day}, ${start.year}`;
  }
  return `${MONTHS[start.month - 1]} ${start.day}, ${start.year}–${MONTHS[end.month - 1]} ${end.day}, ${end.year}`;
}

function monthWindow(businessDate) {
  const date = parseDate(businessDate);
  const from = calendarDate(date.year, date.month, 1);
  return { from, to: businessDate, label: formatRange(from, businessDate), ...date };
}

function previousMonthWindow(businessDate) {
  const current = parseDate(businessDate);
  const previous = addMonths(current.year, current.month, -1);
  const day = Math.min(current.day, daysInMonth(previous.year, previous.month));
  const from = calendarDate(previous.year, previous.month, 1);
  const to = calendarDate(previous.year, previous.month, day);
  return { from, to, label: formatRange(from, to) };
}

function yearWindow(businessDate) {
  const current = parseDate(businessDate);
  const from = calendarDate(current.year, 1, 1);
  return { from, to: businessDate, label: formatRange(from, businessDate), ...current };
}

function previousYearWindow(businessDate) {
  const current = parseDate(businessDate);
  const previousYear = current.year - 1;
  const day = Math.min(current.day, daysInMonth(previousYear, current.month));
  const from = calendarDate(previousYear, 1, 1);
  const to = calendarDate(previousYear, current.month, day);
  return { from, to, label: formatRange(from, to) };
}

function percentage(value, total) {
  return total ? Math.round((value / total) * 1000) / 10 : 0;
}

function expenseDto(expense) {
  return {
    id: String(expense.id),
    expenseDate: expense.expenseDate,
    category: expense.category,
    description: expense.description,
    amountCents: expense.amountCents,
    paidVia: expense.paidVia,
    createdBy: expense.createdBy || null,
    createdByName: expense.createdByName || null,
    updatedBy: expense.updatedBy || null,
    updatedByName: expense.updatedByName || null,
    createdAt: expense.createdAt || null,
    updatedAt: expense.updatedAt || null,
    deletedBy: expense.deletedBy || null,
    deletedByName: expense.deletedByName || null,
    deletedAt: expense.deletedAt || null,
  };
}

function periodNetCents(state, from, to) {
  let total = 0;
  for (const sale of state.sales) {
    if (sale.businessDate >= from && sale.businessDate <= to && sale.status !== 'VOIDED') {
      total += sale.totalCents - sale.taxCents;
    }
  }
  for (const sale of state.sales) {
    for (const entry of sale.returns) {
      if (entry.businessDate >= from && entry.businessDate <= to) {
        total -= entry.refundCents - entry.taxCents;
      }
    }
  }
  return total;
}

function trendSeries(mode, businessDate) {
  const current = parseDate(businessDate);
  if (mode === 'yearly') {
    const points = [];
    for (let offset = -4; offset <= 0; offset += 1) {
      const year = current.year + offset;
      const from = calendarDate(year, 1, 1);
      const to = offset === 0 ? businessDate : calendarDate(year, 12, 31);
      points.push({
        key: String(year),
        label: String(year),
        periodLabel: offset === 0 ? `Jan 1–${MONTHS[current.month - 1]} ${current.day}, ${year}` : String(year),
        from,
        to,
        isCurrent: offset === 0,
      });
    }
    return points;
  }
  const points = [];
  for (let offset = -5; offset <= 0; offset += 1) {
    const { year, month } = addMonths(current.year, current.month, offset);
    const from = calendarDate(year, month, 1);
    const to = offset === 0 ? businessDate : calendarDate(year, month, daysInMonth(year, month));
    points.push({
      key: `${year}-${pad(month)}`,
      label: MONTHS[month - 1],
      periodLabel: offset === 0 ? formatRange(from, businessDate) : formatRange(from, to),
      from,
      to,
      isCurrent: offset === 0,
    });
  }
  return points;
}

function topProductInsights(state, { from, to, totalCents }) {
  if (!totalCents) {
    return { totalCents: 0, leading: null, items: [], otherCents: 0, otherSharePct: 0 };
  }
  const rows = new Map();
  const add = (productId, quantity, netCents) => {
    const row = rows.get(String(productId)) || { productId: String(productId), quantity: 0, netCents: 0 };
    row.quantity += quantity;
    row.netCents += netCents;
    rows.set(row.productId, row);
  };
  for (const sale of state.sales) {
    if (sale.businessDate < from || sale.businessDate > to || sale.status === 'VOIDED') continue;
    for (const item of sale.items) add(item.productId, item.quantity, item.totalCents - item.taxCents);
  }
  for (const sale of state.sales) {
    for (const entry of sale.returns) {
      if (entry.businessDate < from || entry.businessDate > to) continue;
      for (const item of entry.items) add(item.productId, -item.quantity, -(item.refundCents - item.taxCents));
    }
  }
  const items = [...rows.values()]
    .filter((row) => row.netCents > 0)
    .map((row) => {
      const product = state.products.find((entry) => entry.id === row.productId);
      const category = product ? state.categories.find((entry) => entry.id === product.categoryId) : null;
      return {
        productId: row.productId,
        sku: product ? product.sku : '',
        name: product ? product.name : 'Archived product',
        categoryName: category ? category.name : null,
        quantity: row.quantity,
        netCents: row.netCents,
        sharePct: percentage(row.netCents, totalCents),
      };
    })
    .sort((a, b) => b.netCents - a.netCents)
    .slice(0, 5);
  const shownCents = items.reduce((sum, item) => sum + item.netCents, 0);
  const otherCents = Math.max(0, totalCents - shownCents);
  return {
    totalCents,
    leading: items[0] || null,
    items,
    otherCents,
    otherSharePct: percentage(otherCents, totalCents),
  };
}

function purchaseOrderInsights(state, { from, to }) {
  const receipts = [];
  for (const order of state.purchaseOrders) {
    const supplier = state.suppliers.find((entry) => entry.id === order.supplierId);
    for (const receipt of order.receipts) {
      const receiptDate = receipt.businessDate || localDate(new Date(receipt.createdAt));
      if (receiptDate < from || receiptDate > to) continue;
      receipts.push({
        id: String(receipt.id || receipt.number),
        number: receipt.number,
        receiptDate,
        totalCents: receipt.totalCents,
        purchaseOrderNumber: order.number,
        supplierName: supplier ? supplier.name : 'Unknown supplier',
      });
    }
  }
  receipts.sort((a, b) => b.receiptDate.localeCompare(a.receiptDate) || b.number.localeCompare(a.number));
  return {
    totalCents: receipts.reduce((sum, receipt) => sum + receipt.totalCents, 0),
    count: receipts.length,
    receipts: receipts.slice(0, 5),
  };
}

function dashboardInsights(state, businessDate) {
  const currentMonth = monthWindow(businessDate);
  const previousMonth = previousMonthWindow(businessDate);
  const currentYear = yearWindow(businessDate);
  const previousYear = previousYearWindow(businessDate);
  const mode = state.settings.salesComparisonMode === 'yearly' ? 'yearly' : 'monthly';
  const targetCents = Number(state.settings.monthlySalesTargetCents || 0);
  const currentWindow = mode === 'yearly' ? currentYear : currentMonth;
  const previousWindow = mode === 'yearly' ? previousYear : previousMonth;
  const monthNet = periodNetCents(state, currentMonth.from, currentMonth.to);
  const currentNet = mode === 'yearly' ? periodNetCents(state, currentYear.from, currentYear.to) : monthNet;
  const previousNet = mode === 'yearly'
    ? periodNetCents(state, previousYear.from, previousYear.to)
    : periodNetCents(state, previousMonth.from, previousMonth.to);
  const trendPoints = trendSeries(mode, businessDate).map((point) => ({
    ...point,
    valueCents: periodNetCents(state, point.from, point.to),
    sharePct: 0,
  }));
  const manualRows = state.expenses
    .filter((expense) => !expense.deletedAt
      && expense.expenseDate >= currentMonth.from
      && expense.expenseDate <= currentMonth.to)
    .sort((a, b) => b.expenseDate.localeCompare(a.expenseDate) || Number(b.id) - Number(a.id));
  const manualTotals = {
    totalCents: manualRows.reduce((sum, expense) => sum + expense.amountCents, 0),
    count: manualRows.length,
  };
  const topProducts = topProductInsights(state, {
    from: currentMonth.from,
    to: currentMonth.to,
    totalCents: monthNet,
  });
  const purchaseOrders = purchaseOrderInsights(state, { from: currentMonth.from, to: currentMonth.to });
  const elapsedDays = currentMonth.day;
  const totalDays = daysInMonth(currentMonth.year, currentMonth.month);
  const expectedProgressPct = Math.round((elapsedDays / totalDays) * 1000) / 10;
  const rawProgressPct = targetCents ? Math.round((monthNet / targetCents) * 1000) / 10 : null;
  const progressPct = rawProgressPct === null ? null : Math.max(0, rawProgressPct);
  const targetSet = targetCents > 0;
  const paceDeltaPct = targetSet ? Math.round((progressPct - expectedProgressPct) * 10) / 10 : null;
  const changePct = previousNet === 0
    ? (currentNet === 0 ? 0 : null)
    : Math.round(((currentNet - previousNet) / previousNet) * 1000) / 10;
  const totalOutflowsCents = manualTotals.totalCents + purchaseOrders.totalCents;

  return {
    target: {
      targetCents,
      isSet: targetSet,
      monthNetCents: monthNet,
      remainingCents: targetSet ? Math.max(0, targetCents - monthNet) : 0,
      progressPct,
      rawProgressPct,
      expectedProgressPct,
      paceDeltaPct,
      onPace: targetSet ? progressPct >= expectedProgressPct : null,
      monthLabel: `${MONTHS[currentMonth.month - 1]} ${currentMonth.year}`,
      rangeLabel: currentMonth.label,
      daysElapsed: elapsedDays,
      daysInMonth: totalDays,
    },
    comparison: {
      mode,
      currentCents: currentNet,
      previousCents: previousNet,
      changeCents: currentNet - previousNet,
      changePct,
      currentLabel: currentWindow.label,
      previousLabel: previousWindow.label,
      periodLabel: mode === 'yearly' ? 'vs same period last year' : 'vs same period last month',
    },
    trend: {
      mode,
      points: trendPoints,
    },
    topProducts,
    expenses: {
      rangeLabel: currentMonth.label,
      manualCents: manualTotals.totalCents,
      manualCount: manualTotals.count,
      purchaseCents: purchaseOrders.totalCents,
      purchaseCount: purchaseOrders.count,
      totalCents: totalOutflowsCents,
      salesAfterOutflowsCents: monthNet - totalOutflowsCents,
      manual: manualRows.slice(0, 5).map(expenseDto),
      purchaseReceipts: purchaseOrders.receipts,
    },
  };
}

export function createShop(seed) {
  const state = {
    settings: { ...seed.settings },
    users: [],
    categories: [],
    products: [],
    suppliers: [],
    purchaseOrders: [],
    sales: [],
    expenses: [],
    movements: [],
    sequences: new Map(),
    idempotency: new Map(),
    counters: {
      user: 0,
      category: 0,
      product: 0,
      supplier: 0,
      sale: 0,
      saleItem: 0,
      payment: 0,
      returnDoc: 0,
      returnItem: 0,
      void: 0,
      movement: 0,
      purchaseOrder: 0,
      poLine: 0,
      receipt: 0,
      receiptItem: 0,
      expense: 0,
    },
    startedAt: new Date().toISOString(),
  };

  const nextId = (kind) => {
    state.counters[kind] += 1;
    return String(state.counters[kind]);
  };

  const nextNumber = (prefix, businessDate, width = 4) => {
    const key = `${prefix}:${businessDate}`;
    const current = (state.sequences.get(key) || 0) + 1;
    state.sequences.set(key, current);
    return `${prefix}-${businessDate.replace(/-/g, '')}-${pad(current, width)}`;
  };

  // Directory lookups -------------------------------------------------------
  const userById = new Map();
  const categoryById = new Map();
  const productById = new Map();
  const supplierById = new Map();
  const saleById = new Map();
  const poById = new Map();

  function indexAll() {
    userById.clear();
    for (const user of state.users) userById.set(user.id, user);
    categoryById.clear();
    for (const category of state.categories) categoryById.set(category.id, category);
    productById.clear();
    for (const product of state.products) productById.set(product.id, product);
    supplierById.clear();
    for (const supplier of state.suppliers) supplierById.set(supplier.id, supplier);
    saleById.clear();
    for (const sale of state.sales) saleById.set(sale.id, sale);
    poById.clear();
    for (const order of state.purchaseOrders) poById.set(order.id, order);
  }

  // DTOs -------------------------------------------------------------------
  const userDto = (user) => ({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    active: user.active,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    deactivatedAt: user.deactivatedAt,
  });

  const categoryDto = (category) => ({
    id: category.id,
    name: category.name,
    description: category.description,
    active: category.active,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  });

  const supplierDto = (supplier) => ({
    id: supplier.id,
    name: supplier.name,
    contactName: supplier.contactName,
    phone: supplier.phone,
    email: supplier.email,
    address: supplier.address,
    notes: supplier.notes,
    active: supplier.active,
    createdAt: supplier.createdAt,
    updatedAt: supplier.updatedAt,
  });

  const productDto = (product, { includeCost = true } = {}) => {
    const category = categoryById.get(product.categoryId);
    const base = {
      id: product.id,
      sku: product.sku,
      barcode: product.barcode,
      name: product.name,
      description: product.description,
      categoryId: product.categoryId,
      categoryName: category ? category.name : null,
      priceCents: product.priceCents,
      stockOnHand: product.stockOnHand,
      reorderLevel: product.reorderLevel,
      active: product.active,
      lowStock: product.stockOnHand <= product.reorderLevel,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
    if (includeCost) {
      base.costCents = product.costCents;
      base.stockValueCents = product.stockValueCents;
      base.wacCents = wacFor(product);
    }
    return base;
  };

  const movementDto = (movement) => ({
    id: movement.id,
    productId: movement.productId,
    productName: movement.productName,
    sku: movement.sku,
    type: movement.type,
    quantityDelta: movement.quantityDelta,
    stockBefore: movement.stockBefore,
    stockAfter: movement.stockAfter,
    valueDeltaCents: movement.valueDeltaCents,
    valueBeforeCents: movement.valueBeforeCents,
    valueAfterCents: movement.valueAfterCents,
    businessDate: movement.businessDate,
    reference: movement.reference,
    referenceType: movement.referenceType,
    referenceId: movement.referenceId,
    reason: movement.reason,
    actorId: movement.actorId,
    occurredAt: movement.occurredAt,
  });

  const saleStatus = (sale) => {
    if (sale.status === 'VOIDED') return 'VOIDED';
    const totalQty = sale.items.reduce((sum, item) => sum + item.quantity, 0);
    const returnedQty = sale.items.reduce((sum, item) => sum + item.returnedQuantity, 0);
    if (returnedQty > 0 && returnedQty >= totalQty) return 'RETURNED';
    if (returnedQty > 0) return 'PARTIALLY_RETURNED';
    return 'COMPLETED';
  };

  const saleRow = (sale) => ({
    id: sale.id,
    number: sale.number,
    createdAt: sale.createdAt,
    businessDate: sale.businessDate,
    cashierId: sale.cashierId,
    cashierName: sale.cashierName,
    terminal: sale.terminal,
    status: saleStatus(sale),
    totalQuantity: sale.items.reduce((sum, item) => sum + item.quantity, 0),
    subtotalCents: sale.subtotalCents,
    discountCents: sale.discountCents,
    netCents: sale.netCents,
    taxCents: sale.taxCents,
    totalCents: sale.totalCents,
    revenueExTaxCents: sale.netCents - (sale.taxInclusive ? sale.taxCents : 0),
    returnedCents: sale.returns.reduce((sum, entry) => sum + entry.refundCents, 0),
    returnedQuantity: sale.items.reduce((sum, item) => sum + item.returnedQuantity, 0),
    taxRateBps: sale.taxRateBps,
    taxInclusive: sale.taxInclusive,
    currency: sale.currency,
  });

  const saleDetail = (sale, { includeCost = true } = {}) => {
    const items = sale.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      sku: item.sku,
      barcode: item.barcode,
      name: item.name,
      unitPriceCents: item.unitPriceCents,
      ...(includeCost ? { unitCostCents: item.unitCostCents, costValueCents: item.costValueCents } : {}),
      quantity: item.quantity,
      discountBps: item.discountBps,
      discountReason: item.discountReason,
      discountApprovedBy: item.discountApprovedBy,
      note: item.note,
      subtotalCents: item.subtotalCents,
      discountCents: item.discountCents,
      netCents: item.netCents,
      taxCents: item.taxCents,
      totalCents: item.totalCents,
      revenueExTaxCents: sale.taxInclusive ? item.netCents - item.taxCents : item.netCents,
      returnedQuantity: item.returnedQuantity,
    }));
    return {
      id: sale.id,
      number: sale.number,
      createdAt: sale.createdAt,
      businessDate: sale.businessDate,
      cashierId: sale.cashierId,
      cashierName: sale.cashierName,
      terminal: sale.terminal,
      status: saleStatus(sale),
      note: sale.note,
      subtotalCents: sale.subtotalCents,
      discountCents: sale.discountCents,
      netCents: sale.netCents,
      taxCents: sale.taxCents,
      totalCents: sale.totalCents,
      grossCents: sale.netCents,
      revenueExTaxCents: sale.netCents - (sale.taxInclusive ? sale.taxCents : 0),
      taxRateBps: sale.taxRateBps,
      taxInclusive: sale.taxInclusive,
      currency: sale.currency,
      items,
      payments: sale.payments.map((payment) => ({ ...payment })),
      returns: sale.returns.map((entry) => ({ ...entry, items: entry.items.map((item) => ({ ...item })) })),
      void: sale.void ? { ...sale.void } : null,
      returnedCents: sale.returns.reduce((sum, entry) => sum + entry.refundCents, 0),
      returnedQuantityByLine: Object.fromEntries(items.map((item) => [item.id, item.returnedQuantity])),
      refundedByLine: Object.fromEntries(items.map((item) => [
        item.id,
        sale.returns
          .flatMap((entry) => entry.items)
          .filter((line) => line.saleItemId === item.id)
          .reduce((sum, line) => sum + line.refundCents, 0),
      ])),
    };
  };

  const poDto = (order) => {
    const supplier = supplierById.get(order.supplierId);
    const lines = order.lines.map((line) => {
      const product = productById.get(line.productId);
      return {
        id: line.id,
        productId: line.productId,
        sku: product ? product.sku : '',
        name: product ? product.name : 'Archived product',
        unit: 'pc',
        orderedQty: line.orderedQty,
        receivedQty: line.receivedQty,
        unitCostCents: line.unitCostCents,
        orderedTotalCents: line.orderedTotalCents,
        receivedTotalCents: line.receivedTotalCents,
      };
    });
    return {
      id: order.id,
      number: order.number,
      supplierId: order.supplierId,
      supplierName: supplier ? supplier.name : 'Unknown supplier',
      supplier: supplier ? supplierDto(supplier) : null,
      status: order.status,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      orderedAt: order.orderedAt,
      expectedAt: order.expectedAt,
      receivedAt: order.receivedAt,
      closedAt: order.closedAt,
      createdBy: order.createdBy,
      createdByName: order.createdByName,
      lines,
      notes: order.notes,
      receipts: order.receipts.map((receipt) => ({
        id: receipt.number,
        number: receipt.number,
        createdAt: receipt.createdAt,
        businessDate: receipt.businessDate || localDate(new Date(receipt.createdAt)),
        receivedBy: receipt.receivedBy,
        receivedByName: receipt.receivedByName,
        totalCents: receipt.totalCents,
        note: receipt.note,
        items: receipt.items.map((item) => ({ ...item })),
      })),
      cancelReason: order.cancelReason,
      shortCloseReason: order.shortCloseReason,
      orderedTotalCents: order.lines.reduce((sum, line) => sum + line.orderedTotalCents, 0),
      receivedTotalCents: order.lines.reduce((sum, line) => sum + line.receivedTotalCents, 0),
      progress: order.lines.reduce((sum, line) => sum + line.orderedTotalCents, 0)
        ? Math.round((order.lines.reduce((sum, line) => sum + line.receivedTotalCents, 0)
          / order.lines.reduce((sum, line) => sum + line.orderedTotalCents, 0)) * 100)
        : 0,
    };
  };

  // Stock ledger -----------------------------------------------------------
  function applyStockChange(product, change) {
    const stockBefore = product.stockOnHand;
    const valueBefore = product.stockValueCents;
    product.stockOnHand = Math.max(0, stockBefore + change.quantityDelta);
    product.stockValueCents = Math.max(0, valueBefore + change.valueDeltaCents);
    product.updatedAt = iso(change.occurredAt);
    const movement = {
      id: nextId('movement'),
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      type: change.type,
      quantityDelta: change.quantityDelta,
      stockBefore,
      stockAfter: product.stockOnHand,
      valueDeltaCents: change.valueDeltaCents,
      valueBeforeCents: valueBefore,
      valueAfterCents: product.stockValueCents,
      businessDate: change.businessDate,
      reference: change.reference || '',
      referenceType: change.referenceType,
      referenceId: change.referenceId,
      reason: change.reason,
      actorId: change.actorId,
      occurredAt: iso(change.occurredAt),
    };
    state.movements.push(movement);
    return movement;
  }

  // Directory writes -------------------------------------------------------
  function addUser(input, at) {
    const username = text(input.username, 'username', { max: 40 }).toLowerCase();
    if (!/^[a-z0-9._-]+$/.test(username)) {
      fail(400, 'VALIDATION_ERROR', 'Username may contain letters, numbers, dot, dash and underscore only.', {
        username: 'Invalid username.',
      });
    }
    if (state.users.some((user) => user.username === username)) {
      fail(409, 'USERNAME_TAKEN', 'That username is already in use.', { username: 'Already in use.' });
    }
    const role = String(input.role || 'CASHIER').toUpperCase();
    if (!['ADMIN', 'CASHIER'].includes(role)) {
      fail(400, 'VALIDATION_ERROR', 'Role must be ADMIN or CASHIER.', { role: 'Invalid role.' });
    }
    const user = {
      id: nextId('user'),
      username,
      displayName: text(input.displayName, 'displayName', { max: 80 }),
      role,
      active: true,
      mustChangePassword: Boolean(input.mustChangePassword),
      demoPassword: String(input.demoPassword || DEMO_PASSWORD),
      lastLoginAt: null,
      createdAt: iso(at || new Date()),
      updatedAt: iso(at || new Date()),
      deactivatedAt: null,
    };
    state.users.push(user);
    userById.set(user.id, user);
    return user;
  }

  function addCategory(input, at) {
    const name = text(input.name, 'name', { max: 80 });
    if (state.categories.some((category) => category.name.toLowerCase() === name.toLowerCase())) {
      fail(409, 'CATEGORY_EXISTS', 'A category with that name already exists.', { name: 'Already exists.' });
    }
    const category = {
      id: nextId('category'),
      name,
      description: text(input.description, 'description', { required: false, max: 200 }),
      active: true,
      createdAt: iso(at || new Date()),
      updatedAt: iso(at || new Date()),
    };
    state.categories.push(category);
    categoryById.set(category.id, category);
    return category;
  }

  function addProduct(input, { at = new Date(), openingStock = 0 } = {}) {
    const sku = text(input.sku, 'sku', { max: 40 }).toUpperCase();
    if (state.products.some((product) => product.sku.toLowerCase() === sku.toLowerCase())) {
      fail(409, 'SKU_TAKEN', 'That SKU is already in use.', { sku: 'Already in use.' });
    }
    const category = categoryById.get(String(input.categoryId));
    if (!category || !category.active) {
      fail(400, 'VALIDATION_ERROR', 'Choose an active category.', { categoryId: 'Category not found.' });
    }
    const costCents = whole(input.costCents ?? 0, 'costCents', { min: 0 });
    const product = {
      id: nextId('product'),
      sku,
      barcode: text(input.barcode, 'barcode', { required: false, max: 40 }),
      name: text(input.name, 'name', { max: 120 }),
      description: text(input.description, 'description', { required: false, max: 240 }),
      categoryId: category.id,
      costCents,
      priceCents: whole(input.priceCents, 'priceCents', { min: 0 }),
      stockOnHand: 0,
      stockValueCents: 0,
      reorderLevel: whole(input.reorderLevel ?? 0, 'reorderLevel', { min: 0, max: 100000 }),
      active: input.active !== false,
      createdAt: iso(at),
      updatedAt: iso(at),
    };
    state.products.push(product);
    productById.set(product.id, product);
    const qty = whole(openingStock, 'openingStock', { min: 0, max: 1000000 });
    if (qty > 0) {
      applyStockChange(product, {
        type: 'OPENING',
        quantityDelta: qty,
        valueDeltaCents: qty * costCents,
        businessDate: localDate(at),
        referenceType: 'product',
        reference: sku,
        referenceId: product.id,
        reason: 'Opening stock',
        actorId: input.actorId || '1',
        occurredAt: at,
      });
    }
    return product;
  }

  function addSupplier(input, at) {
    const supplier = {
      id: nextId('supplier'),
      name: text(input.name, 'name', { max: 120 }),
      contactName: text(input.contactName, 'contactName', { required: false, max: 80 }),
      phone: text(input.phone, 'phone', { required: false, max: 40 }),
      email: text(input.email, 'email', { required: false, max: 120 }),
      address: text(input.address, 'address', { required: false, max: 180 }),
      notes: text(input.notes, 'notes', { required: false, max: 300 }),
      active: true,
      createdAt: iso(at || new Date()),
      updatedAt: iso(at || new Date()),
    };
    state.suppliers.push(supplier);
    supplierById.set(supplier.id, supplier);
    return supplier;
  }

  // Sales ------------------------------------------------------------------
  function verifyAdminCredentials(approval) {
    if (!approval || !approval.username || !approval.password) {
      fail(403, 'APPROVAL_REQUIRED', 'Administrator approval is required.');
    }
    const admin = state.users.find(
      (user) => user.role === 'ADMIN' && user.active && user.username === String(approval.username).trim().toLowerCase(),
    );
    if (!admin || admin.demoPassword !== String(approval.password)) {
      fail(403, 'APPROVAL_FAILED', 'Administrator credentials were not accepted.');
    }
    return admin;
  }

  function recordSale({
    at = new Date(),
    actor,
    terminal = 'Counter 1',
    note = '',
    lines = [],
    payments = [],
    approval = null,
    clientRequestId = null,
  }) {
    if (!actor) fail(401, 'UNAUTHENTICATED', 'Sign in to continue.');
    if (!Array.isArray(lines) || !lines.length) {
      fail(400, 'VALIDATION_ERROR', 'Add at least one product to the cart.', { lines: 'Required.' });
    }
    const settings = state.settings;
    const requestKey = clientRequestId ? `${actor.id}:${clientRequestId}` : null;
    if (requestKey && state.idempotency.has(requestKey)) {
      return { sale: saleById.get(state.idempotency.get(requestKey)), replayed: true };
    }
    const businessDate = localDate(at);
    const taxRateBps = settings.taxEnabled ? settings.taxRateBps : 0;
    const taxInclusive = settings.taxInclusive;

    const prepared = lines.map((line) => {
      const product = productById.get(String(line.productId));
      if (!product) fail(400, 'PRODUCT_UNAVAILABLE', 'One of the cart products no longer exists.');
      if (!product.active) {
        fail(422, 'PRODUCT_UNAVAILABLE', `${product.name} is archived and cannot be sold.`);
      }
      const quantity = whole(line.quantity, 'quantity', { min: 1, max: 9999 });
      if (quantity > settings.maxLineQuantity) {
        fail(400, 'MAX_QUANTITY', `Maximum quantity per line is ${settings.maxLineQuantity}.`);
      }
      if (quantity > product.stockOnHand) {
        fail(
          409,
          'INSUFFICIENT_STOCK',
          product.stockOnHand === 0
            ? `${product.name} is out of stock.`
            : `Only ${product.stockOnHand} of ${product.name} are in stock.`,
        );
      }
      const discountBps = whole(line.discountBps ?? 0, 'discountBps', { min: 0, max: 10000 });
      const discountReason = text(line.discountReason, 'discountReason', { required: false, max: 200 });
      if (discountBps > 0 && settings.discountReasonRequired && !discountReason) {
        fail(400, 'DISCOUNT_REASON_REQUIRED', 'A reason is required for a line discount.');
      }
      const calc = calculateLine({
        unitPriceCents: product.priceCents,
        quantity,
        discountBps,
        taxRateBps,
        taxInclusive,
      });
      const costValueCents = costValueFor(product.stockValueCents, product.stockOnHand, quantity);
      return {
        product,
        quantity,
        discountBps,
        discountReason,
        note: text(line.note, 'note', { required: false, max: 200 }),
        calc,
        costValueCents,
      };
    });

    const totals = prepared.reduce(
      (acc, entry) => {
        acc.subtotalCents += entry.calc.subtotalCents;
        acc.discountCents += entry.calc.discountCents;
        acc.netCents += entry.calc.netCents;
        acc.taxCents += entry.calc.taxCents;
        acc.totalCents += entry.calc.totalCents;
        return acc;
      },
      { subtotalCents: 0, discountCents: 0, netCents: 0, taxCents: 0, totalCents: 0 },
    );

    const cashierLimit = settings.cashierDiscountLimitBps;
    const needsApproval = actor.role === 'CASHIER'
      && prepared.some((entry) => entry.discountBps > cashierLimit);
    let approvedBy = null;
    if (needsApproval) {
      const admin = verifyAdminCredentials(approval);
      approvedBy = admin.id;
    }

    const cleanPayments = (payments || []).map((payment) => {
      const method = String(payment.method || '').toUpperCase();
      if (!['CASH', 'CARD_EXTERNAL'].includes(method)) {
        fail(400, 'VALIDATION_ERROR', 'Payment method must be CASH or CARD_EXTERNAL.');
      }
      const amountCents = whole(payment.amountCents, 'amountCents', { min: 1 });
      const tenderedCents = method === 'CASH'
        ? whole(payment.tenderedCents ?? amountCents, 'tenderedCents', { min: 1 })
        : amountCents;
      if (method === 'CASH' && tenderedCents < amountCents) {
        fail(400, 'CASH_SHORT', 'Cash tendered must be at least the cash amount.');
      }
      return {
        method,
        amountCents,
        tenderedCents,
        reference: method === 'CARD_EXTERNAL' ? text(payment.reference, 'reference', { required: false, max: 40 }) : '',
      };
    });
    const paymentTotal = cleanPayments.reduce((sum, payment) => sum + payment.amountCents, 0);
    if (paymentTotal !== totals.totalCents) {
      fail(400, 'PAYMENT_MISMATCH', 'Payment amounts must equal the sale total.', {
        payments: `Payments total ${paymentTotal} cents but the sale total is ${totals.totalCents} cents.`,
      });
    }

    const sale = {
      id: nextId('sale'),
      number: nextNumber('S', businessDate),
      createdAt: iso(at),
      businessDate,
      cashierId: actor.id,
      cashierName: actor.displayName,
      terminal: text(terminal, 'terminalLabel', { required: false, max: 40 }) || 'Counter 1',
      note: text(note, 'note', { required: false, max: 500 }),
      status: 'COMPLETED',
      subtotalCents: totals.subtotalCents,
      discountCents: totals.discountCents,
      netCents: totals.netCents,
      taxCents: totals.taxCents,
      totalCents: totals.totalCents,
      taxRateBps,
      taxInclusive,
      currency: settings.currency,
      items: [],
      payments: [],
      returns: [],
      void: null,
    };

    for (const entry of prepared) {
      const item = {
        id: nextId('saleItem'),
        productId: entry.product.id,
        sku: entry.product.sku,
        barcode: entry.product.barcode,
        name: entry.product.name,
        unitPriceCents: entry.product.priceCents,
        unitCostCents: entry.quantity ? Math.round(entry.costValueCents / entry.quantity) : 0,
        costValueCents: entry.costValueCents,
        quantity: entry.quantity,
        discountBps: entry.discountBps,
        discountReason: entry.discountReason,
        discountApprovedBy: entry.discountBps > cashierLimit ? approvedBy : null,
        note: entry.note,
        subtotalCents: entry.calc.subtotalCents,
        discountCents: entry.calc.discountCents,
        netCents: entry.calc.netCents,
        taxCents: entry.calc.taxCents,
        totalCents: entry.calc.totalCents,
        returnedQuantity: 0,
      };
      sale.items.push(item);
    }

    for (const payment of cleanPayments) {
      sale.payments.push({
        id: nextId('payment'),
        method: payment.method,
        amountCents: payment.amountCents,
        tenderedCents: payment.tenderedCents,
        changeCents: payment.tenderedCents - payment.amountCents,
        reference: payment.reference,
        createdAt: iso(at),
      });
    }

    state.sales.push(sale);
    saleById.set(sale.id, sale);

    for (const item of sale.items) {
      const product = productById.get(item.productId);
      applyStockChange(product, {
        type: 'SALE',
        quantityDelta: -item.quantity,
        valueDeltaCents: -item.costValueCents,
        businessDate,
        referenceType: 'sale',
        reference: sale.number,
        referenceId: sale.id,
        reason: 'Counter sale',
        actorId: actor.id,
        occurredAt: at,
      });
    }

    if (requestKey) state.idempotency.set(requestKey, sale.id);
    return { sale, replayed: false };
  }

  function recordReturn(saleId, { at = new Date(), actor, reason, refundMethod, items = [], approval = null }) {
    if (!actor) fail(401, 'UNAUTHENTICATED', 'Sign in to continue.');
    const sale = saleById.get(String(saleId));
    if (!sale) fail(404, 'NOT_FOUND', 'Sale not found.');
    if (actor.role === 'CASHIER' && sale.cashierId !== actor.id) fail(404, 'NOT_FOUND', 'Sale not found.');
    if (sale.status === 'VOIDED') fail(409, 'SALE_VOIDED', 'A voided sale cannot be returned.');
    let approvedBy = null;
    if (actor.role === 'CASHIER') {
      approvedBy = verifyAdminCredentials(approval).id;
    }
    const method = String(refundMethod || '').toUpperCase();
    if (!['CASH', 'CARD_EXTERNAL'].includes(method)) {
      fail(400, 'VALIDATION_ERROR', 'Refund method must be CASH or CARD_EXTERNAL.');
    }
    if (!Array.isArray(items) || !items.length) {
      fail(400, 'VALIDATION_ERROR', 'Choose at least one quantity to return.');
    }
    const businessDate = localDate(at);
    const computed = items.map((item) => {
      const line = sale.items.find((entry) => entry.id === String(item.saleItemId));
      if (!line) fail(400, 'LINE_NOT_FOUND', 'Return line not found on the original sale.');
      const quantity = whole(item.quantity, 'quantity', { min: 1, max: line.quantity });
      const already = line.returnedQuantity;
      const remaining = line.quantity - already;
      if (quantity > remaining) {
        fail(422, 'OVER_RETURN', `Only ${remaining} of ${line.name} can still be returned.`);
      }
      const priorItems = sale.returns.flatMap((entry) => entry.items).filter((entry) => entry.saleItemId === line.id);
      const refunded = priorItems.reduce((sum, entry) => sum + entry.refundCents, 0);
      const refundedTax = priorItems.reduce((sum, entry) => sum + entry.taxCents, 0);
      const returnedCost = priorItems.reduce((sum, entry) => sum + entry.costValueCents, 0);
      const refundCents = refundFor(line, already, refunded, quantity, 'totalCents');
      const taxCents = refundFor(line, already, refundedTax, quantity, 'taxCents');
      const costValueCents = restoredCostValue(line, already, returnedCost, quantity);
      return {
        line,
        quantity,
        restock: item.restock !== false,
        refundCents,
        taxCents,
        costValueCents,
      };
    });

    const refundCents = computed.reduce((sum, entry) => sum + entry.refundCents, 0);
    const taxCents = computed.reduce((sum, entry) => sum + entry.taxCents, 0);
    const costValueCents = computed.reduce((sum, entry) => sum + entry.costValueCents, 0);

    const doc = {
      id: nextId('returnDoc'),
      number: nextNumber('R', businessDate),
      saleId: sale.id,
      saleNumber: sale.number,
      createdAt: iso(at),
      businessDate,
      reason: text(reason, 'reason', { max: 500 }),
      refundMethod: method,
      cashierId: actor.id,
      approvedBy,
      items: [],
      refundCents,
      taxCents,
      revenueExTaxCents: refundCents - taxCents,
      costValueCents,
    };

    for (const entry of computed) {
      doc.items.push({
        id: nextId('returnItem'),
        saleItemId: entry.line.id,
        productId: entry.line.productId,
        sku: entry.line.sku,
        name: entry.line.name,
        quantity: entry.quantity,
        restock: entry.restock,
        refundCents: entry.refundCents,
        taxCents: entry.taxCents,
        revenueExTaxCents: entry.refundCents - entry.taxCents,
        costValueCents: entry.costValueCents,
      });
      entry.line.returnedQuantity += entry.quantity;
    }
    sale.returns.push(doc);

    for (const entry of computed) {
      if (!entry.restock) continue;
      const product = productById.get(entry.line.productId);
      applyStockChange(product, {
        type: 'RETURN',
        quantityDelta: entry.quantity,
        valueDeltaCents: entry.costValueCents,
        businessDate,
        referenceType: 'sale_return',
        reference: doc.number,
        referenceId: doc.id,
        reason: `Return: ${doc.reason}`,
        actorId: actor.id,
        occurredAt: at,
      });
    }
    return { sale, return: doc };
  }

  function recordVoid(saleId, { at = new Date(), actor, reason, approval = null }) {
    if (!actor) fail(401, 'UNAUTHENTICATED', 'Sign in to continue.');
    const sale = saleById.get(String(saleId));
    if (!sale) fail(404, 'NOT_FOUND', 'Sale not found.');
    if (actor.role === 'CASHIER' && sale.cashierId !== actor.id) fail(404, 'NOT_FOUND', 'Sale not found.');
    if (sale.status === 'VOIDED') fail(409, 'ALREADY_VOIDED', 'This sale is already voided.');
    const businessDate = localDate(at);
    if (sale.businessDate !== businessDate) {
      fail(422, 'CUTOFF', 'Voids are limited to the current business day.');
    }
    if (sale.returns.length) fail(409, 'HAS_RETURNS', 'A sale with a return cannot be voided.');
    let approvedBy = null;
    if (actor.role === 'CASHIER') {
      approvedBy = verifyAdminCredentials(approval).id;
    }
    const doc = {
      id: nextId('void'),
      number: nextNumber('VOID', businessDate),
      reason: text(reason, 'reason', { max: 500 }),
      createdAt: iso(at),
      voidedBy: actor.id,
      approvedBy,
      restocked: true,
      totalCents: sale.totalCents,
    };
    sale.status = 'VOIDED';
    sale.void = doc;
    for (const item of sale.items) {
      const product = productById.get(item.productId);
      applyStockChange(product, {
        type: 'VOID',
        quantityDelta: item.quantity,
        valueDeltaCents: item.costValueCents,
        businessDate,
        referenceType: 'sale_void',
        reference: doc.number,
        referenceId: doc.id,
        reason: `Void: ${doc.reason}`,
        actorId: actor.id,
        occurredAt: at,
      });
    }
    return { sale, void: doc };
  }

  // Purchasing -------------------------------------------------------------
  function createPurchaseOrder(input, actor, at = new Date()) {
    const supplier = supplierById.get(String(input.supplierId));
    if (!supplier || !supplier.active) fail(400, 'VALIDATION_ERROR', 'Choose an active supplier.', { supplierId: 'Invalid supplier.' });
    const rawLines = Array.isArray(input.lines) ? input.lines : [];
    if (!rawLines.length) fail(400, 'VALIDATION_ERROR', 'Add at least one line to the order.', { lines: 'Required.' });
    const order = {
      id: nextId('purchaseOrder'),
      number: nextNumber('PO', localDate(at)),
      supplierId: supplier.id,
      status: 'DRAFT',
      createdAt: iso(at),
      updatedAt: iso(at),
      orderedAt: null,
      expectedAt: input.expectedAt || null,
      receivedAt: null,
      closedAt: null,
      createdBy: actor.id,
      createdByName: actor.displayName,
      notes: text(input.notes, 'notes', { required: false, max: 500 }),
      cancelReason: '',
      shortCloseReason: '',
      lines: [],
      receipts: [],
    };
    for (const raw of rawLines) {
      const product = productById.get(String(raw.productId));
      if (!product) fail(400, 'VALIDATION_ERROR', 'Choose a valid product for every line.');
      const orderedQty = whole(raw.orderedQty ?? raw.quantity, 'orderedQty', { min: 1, max: 100000 });
      const unitCostCents = whole(raw.unitCostCents, 'unitCostCents', { min: 0 });
      order.lines.push({
        id: nextId('poLine'),
        productId: product.id,
        orderedQty,
        receivedQty: 0,
        unitCostCents,
        orderedTotalCents: orderedQty * unitCostCents,
        receivedTotalCents: 0,
      });
    }
    state.purchaseOrders.push(order);
    poById.set(order.id, order);
    return order;
  }

  function updatePurchaseOrder(orderId, input, at = new Date()) {
    const order = poById.get(String(orderId));
    if (!order) fail(404, 'NOT_FOUND', 'Purchase order not found.');
    if (order.status !== 'DRAFT') fail(409, 'PO_NOT_DRAFT', 'Only draft purchase orders can be edited.');
    const supplier = supplierById.get(String(input.supplierId));
    if (!supplier) fail(400, 'VALIDATION_ERROR', 'Choose an active supplier.', { supplierId: 'Invalid supplier.' });
    const rawLines = Array.isArray(input.lines) ? input.lines : [];
    if (!rawLines.length) fail(400, 'VALIDATION_ERROR', 'Add at least one line to the order.', { lines: 'Required.' });
    order.supplierId = supplier.id;
    order.expectedAt = input.expectedAt || null;
    order.notes = text(input.notes, 'notes', { required: false, max: 500 });
    order.updatedAt = iso(at);
    order.lines = rawLines.map((raw) => {
      const product = productById.get(String(raw.productId));
      if (!product) fail(400, 'VALIDATION_ERROR', 'Choose a valid product for every line.');
      const orderedQty = whole(raw.orderedQty ?? raw.quantity, 'orderedQty', { min: 1, max: 100000 });
      const unitCostCents = whole(raw.unitCostCents, 'unitCostCents', { min: 0 });
      return {
        id: nextId('poLine'),
        productId: product.id,
        orderedQty,
        receivedQty: 0,
        unitCostCents,
        orderedTotalCents: orderedQty * unitCostCents,
        receivedTotalCents: 0,
      };
    });
    return order;
  }

  function placePurchaseOrder(orderId, at = new Date()) {
    const order = poById.get(String(orderId));
    if (!order) fail(404, 'NOT_FOUND', 'Purchase order not found.');
    if (order.status !== 'DRAFT') fail(409, 'PO_NOT_DRAFT', 'Only a draft order can be placed.');
    order.status = 'ORDERED';
    order.orderedAt = iso(at);
    order.updatedAt = iso(at);
    return order;
  }

  function receivePurchaseOrder(orderId, { items = [], note = '', actor, at = new Date() }) {
    const order = poById.get(String(orderId));
    if (!order) fail(404, 'NOT_FOUND', 'Purchase order not found.');
    if (!['ORDERED', 'PARTIALLY_RECEIVED'].includes(order.status)) {
      fail(409, 'PO_NOT_RECEIVABLE', 'Only ordered or partially received purchase orders can be received.');
    }
    const businessDate = localDate(at);
    const receipt = {
      id: null,
      number: nextNumber('RCV', businessDate),
      createdAt: iso(at),
      businessDate,
      receivedBy: actor.id,
      receivedByName: actor.displayName,
      totalCents: 0,
      note: text(note, 'note', { required: false, max: 300 }),
      items: [],
    };
    const accepted = [];
    for (const raw of items) {
      const line = order.lines.find((entry) => entry.id === String(raw.lineId));
      if (!line) fail(400, 'VALIDATION_ERROR', 'Receipt line not found on this order.');
      const quantity = whole(raw.quantity, 'quantity', { min: 0, max: 100000 });
      if (quantity === 0) continue;
      const remaining = line.orderedQty - line.receivedQty;
      if (quantity > remaining) {
        const product = productById.get(line.productId);
        fail(422, 'OVER_RECEIPT', `Only ${remaining} of ${product ? product.name : 'this line'} are still outstanding.`);
      }
      accepted.push({ line, quantity });
    }
    if (!accepted.length) fail(400, 'VALIDATION_ERROR', 'Enter at least one received quantity.');

    for (const entry of accepted) {
      const product = productById.get(entry.line.productId);
      const value = entry.quantity * entry.line.unitCostCents;
      applyStockChange(product, {
        type: 'RECEIPT',
        quantityDelta: entry.quantity,
        valueDeltaCents: value,
        businessDate,
        referenceType: 'po_receipt',
        reference: receipt.number,
        referenceId: receipt.number,
        reason: `Received on ${order.number}`,
        actorId: actor.id,
        occurredAt: at,
      });
      product.costCents = entry.line.unitCostCents;
      entry.line.receivedQty += entry.quantity;
      entry.line.receivedTotalCents += value;
      receipt.items.push({
        lineId: entry.line.id,
        productId: product.id,
        sku: product.sku,
        name: product.name,
        quantity: entry.quantity,
        unitCostCents: entry.line.unitCostCents,
        totalCents: value,
      });
      receipt.totalCents += value;
    }

    order.receipts.push(receipt);
    order.receivedAt = order.receivedAt || iso(at);
    order.updatedAt = iso(at);
    const complete = order.lines.every((line) => line.receivedQty >= line.orderedQty);
    order.status = complete ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
    return { order, receipt };
  }

  function shortClosePurchaseOrder(orderId, { reason, actor, at = new Date() }) {
    const order = poById.get(String(orderId));
    if (!order) fail(404, 'NOT_FOUND', 'Purchase order not found.');
    if (!['ORDERED', 'PARTIALLY_RECEIVED'].includes(order.status)) {
      fail(409, 'PO_NOT_OPEN', 'Only an open order can be short-closed.');
    }
    order.status = 'CLOSED';
    order.shortCloseReason = text(reason, 'reason', { max: 300 });
    order.closedAt = iso(at);
    order.updatedAt = iso(at);
    return order;
  }

  function cancelPurchaseOrder(orderId, { reason, at = new Date() }) {
    const order = poById.get(String(orderId));
    if (!order) fail(404, 'NOT_FOUND', 'Purchase order not found.');
    if (order.receipts.length) {
      fail(409, 'PO_HAS_RECEIPTS', 'A received purchase order cannot be cancelled; short-close it instead.');
    }
    if (!['DRAFT', 'ORDERED'].includes(order.status)) {
      fail(409, 'PO_NOT_CANCELLABLE', 'This purchase order cannot be cancelled.');
    }
    order.status = 'CANCELLED';
    order.cancelReason = text(reason, 'reason', { max: 300 });
    order.closedAt = iso(at);
    order.updatedAt = iso(at);
    return order;
  }

  // Reports ----------------------------------------------------------------
  function returnsInRange({ from, to, cashierId = null }) {
    const rows = [];
    for (const sale of state.sales) {
      if (cashierId && sale.cashierId !== cashierId) continue;
      for (const entry of sale.returns) {
        if (entry.businessDate >= from && entry.businessDate <= to) rows.push(entry);
      }
    }
    return rows;
  }

  function dailyReport({ from, to, user }) {
    const cashierId = user.role === 'CASHIER' ? user.id : null;
    const sales = state.sales.filter((sale) => sale.businessDate >= from && sale.businessDate <= to
      && (!cashierId || sale.cashierId === cashierId));
    const completed = sales.filter((sale) => sale.status !== 'VOIDED');
    const voided = sales.filter((sale) => sale.status === 'VOIDED');
    const returns = returnsInRange({ from, to, cashierId });

    const grossCents = completed.reduce((sum, sale) => sum + sale.netCents - (sale.taxInclusive ? sale.taxCents : 0), 0);
    const discountsCents = completed.reduce((sum, sale) => sum + sale.discountCents, 0);
    const salesTaxCents = completed.reduce((sum, sale) => sum + sale.taxCents, 0);
    const totalCents = completed.reduce((sum, sale) => sum + sale.totalCents, 0);
    const refundsCents = returns.reduce((sum, entry) => sum + entry.refundCents, 0);
    const refundTaxCents = returns.reduce((sum, entry) => sum + entry.taxCents, 0);
    const refundRevenueCents = refundsCents - refundTaxCents;
    const collectedCents = totalCents - refundsCents;

    const byDay = new Map();
    const ensureDay = (day) => {
      if (!byDay.has(day)) {
        byDay.set(day, {
          businessDate: day,
          transactions: 0,
          grossCents: 0,
          discountsCents: 0,
          taxCents: 0,
          refundsCents: 0,
          collectedCents: 0,
        });
      }
      return byDay.get(day);
    };
    for (const sale of completed) {
      const row = ensureDay(sale.businessDate);
      row.transactions += 1;
      row.grossCents += sale.netCents - (sale.taxInclusive ? sale.taxCents : 0);
      row.discountsCents += sale.discountCents;
      row.taxCents += sale.taxCents;
      row.collectedCents += sale.totalCents;
    }
    for (const entry of returns) {
      const row = ensureDay(entry.businessDate);
      row.refundsCents += entry.refundCents;
      row.taxCents -= entry.taxCents;
      row.collectedCents -= entry.refundCents;
    }

    const paymentMap = new Map();
    for (const sale of completed) {
      for (const payment of sale.payments) {
        paymentMap.set(payment.method, (paymentMap.get(payment.method) || 0) + payment.amountCents);
      }
    }
    for (const entry of returns) {
      paymentMap.set(entry.refundMethod, (paymentMap.get(entry.refundMethod) || 0) - entry.refundCents);
    }

    const productMap = new Map();
    for (const sale of completed) {
      for (const item of sale.items) {
        if (!productMap.has(item.productId)) {
          productMap.set(item.productId, {
            productId: item.productId,
            sku: item.sku,
            name: item.name,
            quantity: 0,
            netCents: 0,
          });
        }
        const row = productMap.get(item.productId);
        row.quantity += item.quantity;
        row.netCents += item.netCents - (sale.taxInclusive ? item.taxCents : 0);
      }
    }
    for (const entry of returns) {
      for (const item of entry.items) {
        const row = productMap.get(item.productId);
        if (!row) continue;
        row.quantity -= item.quantity;
        row.netCents -= item.refundCents - item.taxCents;
      }
    }

    return {
      from,
      to,
      transactionCount: completed.length,
      averageSaleCents: completed.length ? Math.round(collectedCents / completed.length) : 0,
      grossCents,
      discountsCents,
      taxCents: salesTaxCents - refundTaxCents,
      netExTaxCents: grossCents - refundRevenueCents,
      refundsCents,
      collectedCents,
      returnsCount: returns.length,
      voidCount: voided.length,
      voidValueCents: voided.reduce((sum, sale) => sum + sale.totalCents, 0),
      byDay: [...byDay.values()].sort((a, b) => b.businessDate.localeCompare(a.businessDate)),
      byPayment: [...paymentMap.entries()]
        .map(([method, amountCents]) => ({ method, amountCents }))
        .filter((entry) => entry.amountCents !== 0),
      topProducts: [...productMap.values()]
        .filter((entry) => entry.quantity !== 0)
        .sort((a, b) => b.netCents - a.netCents)
        .slice(0, 8),
    };
  }

  function lowStockProducts(includeCost) {
    return state.products
      .filter((product) => product.active && product.stockOnHand <= product.reorderLevel)
      .sort((a, b) => (a.stockOnHand / Math.max(a.reorderLevel, 1)) - (b.stockOnHand / Math.max(b.reorderLevel, 1)))
      .map((product) => productDto(product, { includeCost }));
  }

  // Operating expenses -----------------------------------------------------
  function expenseInput(input) {
    const value = input || {};
    const expenseDate = String(value.expenseDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)) {
      fail(400, 'VALIDATION_ERROR', 'Choose a valid expense date.', { expenseDate: 'Required.' });
    }
    if (expenseDate > localDate(new Date())) {
      fail(400, 'FUTURE_EXPENSE_DATE', 'Expense date cannot be in the future.', {
        expenseDate: 'Use today or an earlier date.',
      });
    }
    const paidVia = String(value.paidVia || '').toUpperCase();
    if (!EXPENSE_PAID_VIA.includes(paidVia)) {
      fail(400, 'VALIDATION_ERROR', 'Choose a valid payment method.', { paidVia: 'Invalid payment method.' });
    }
    return {
      expenseDate,
      category: text(value.category, 'category', { max: 60 }),
      description: text(value.description, 'description', { max: 200 }),
      amountCents: whole(value.amountCents, 'amountCents', { min: 1, max: 1_000_000_000_000_000 }),
      paidVia,
    };
  }

  function listExpenses({ from = null, to = null, limit = 100, includeDeleted = false } = {}) {
    return state.expenses
      .filter((expense) => (!from || expense.expenseDate >= from)
        && (!to || expense.expenseDate <= to)
        && (includeDeleted || !expense.deletedAt))
      .slice()
      .sort((a, b) => b.expenseDate.localeCompare(a.expenseDate) || Number(b.id) - Number(a.id))
      .slice(0, limit)
      .map(expenseDto);
  }

  function expenseTotals({ from, to }) {
    const rows = state.expenses.filter((expense) => !expense.deletedAt
      && expense.expenseDate >= from
      && expense.expenseDate <= to);
    return {
      totalCents: rows.reduce((sum, expense) => sum + expense.amountCents, 0),
      count: rows.length,
    };
  }

  function createExpense(input, actor, at = new Date()) {
    if (!actor) fail(401, 'UNAUTHENTICATED', 'Sign in to continue.');
    const parsed = expenseInput(input);
    const stamp = iso(at);
    const expense = {
      id: nextId('expense'),
      ...parsed,
      createdBy: actor.id,
      createdByName: actor.displayName,
      updatedBy: null,
      updatedByName: null,
      createdAt: stamp,
      updatedAt: stamp,
      deletedBy: null,
      deletedByName: null,
      deletedAt: null,
    };
    state.expenses.push(expense);
    return expenseDto(expense);
  }

  function updateExpense(id, input, actor, at = new Date()) {
    if (!actor) fail(401, 'UNAUTHENTICATED', 'Sign in to continue.');
    const expense = state.expenses.find((entry) => entry.id === String(id) && !entry.deletedAt);
    if (!expense) fail(404, 'NOT_FOUND', 'Expense not found.');
    Object.assign(expense, expenseInput(input), {
      updatedBy: actor.id,
      updatedByName: actor.displayName,
      updatedAt: iso(at),
    });
    return expenseDto(expense);
  }

  function deleteExpense(id, actor, at = new Date()) {
    if (!actor) fail(401, 'UNAUTHENTICATED', 'Sign in to continue.');
    const expense = state.expenses.find((entry) => entry.id === String(id) && !entry.deletedAt);
    if (!expense) fail(404, 'NOT_FOUND', 'Expense not found.');
    expense.deletedBy = actor.id;
    expense.deletedByName = actor.displayName;
    expense.deletedAt = iso(at);
    expense.updatedAt = expense.deletedAt;
    return { id: String(id), deleted: true };
  }

  function dashboard(user, now = new Date()) {
    const businessDate = localDate(now);
    const report = dailyReport({ from: businessDate, to: businessDate, user });
    const cashierId = user.role === 'CASHIER' ? user.id : null;
    const recentSales = state.sales
      .filter((sale) => sale.businessDate === businessDate && (!cashierId || sale.cashierId === cashierId))
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 6)
      .map((sale) => ({
        id: sale.id,
        number: sale.number,
        createdAt: sale.createdAt,
        cashierName: sale.cashierName,
        totalCents: sale.totalCents,
        status: saleStatus(sale),
      }));
    const low = lowStockProducts(user.role !== 'CASHIER');
    return {
      businessDate,
      scopeLabel: user.role === 'CASHIER' ? `My sales — ${user.displayName}` : 'Shop-wide view',
      transactionCount: report.transactionCount,
      totalCents: report.collectedCents,
      salesCents: report.netExTaxCents,
      discountsCents: report.discountsCents,
      taxCents: report.taxCents,
      refundsCents: report.refundsCents,
      returnsCount: report.returnsCount,
      voidCount: report.voidCount,
      averageSaleCents: report.averageSaleCents,
      recentSales,
      lowStock: low.slice(0, 6),
      lowStockCount: low.length,
      insights: user.role === 'ADMIN' ? dashboardInsights(state, businessDate) : null,
    };
  }

  function valuation({ categoryId = null, includeInactive = false } = {}) {
    return state.products
      .filter((product) => (includeInactive || product.active) && (!categoryId || product.categoryId === categoryId))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((product) => ({
        ...productDto(product, { includeCost: true }),
        wacCents: wacFor(product),
        retailValueCents: product.priceCents * product.stockOnHand,
      }));
  }

  function movements({ productId = null, type = '', from = null, to = null, limit = 500 } = {}) {
    return state.movements
      .filter((movement) => (!productId || movement.productId === String(productId))
        && (!type || movement.type === type)
        && (!from || movement.businessDate >= from)
        && (!to || movement.businessDate <= to))
      .slice()
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || Number(b.id) - Number(a.id))
      .slice(0, limit)
      .map(movementDto);
  }

  function listSales({ user, from = null, to = null, cashierId = null, status = '', search = '', limit = 100, offset = 0 }) {
    const effectiveCashier = user.role === 'CASHIER' ? user.id : cashierId;
    const needle = String(search || '').trim().toLowerCase();
    return state.sales
      .filter((sale) => (!from || sale.businessDate >= from)
        && (!to || sale.businessDate <= to)
        && (!effectiveCashier || sale.cashierId === String(effectiveCashier))
        && (!status || saleStatus(sale) === status)
        && (!needle
          || sale.number.toLowerCase().includes(needle)
          || sale.cashierName.toLowerCase().includes(needle)
          || sale.terminal.toLowerCase().includes(needle)))
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || Number(b.id) - Number(a.id))
      .slice(offset, offset + limit)
      .map(saleRow);
  }

  // Auth -------------------------------------------------------------------
  function authenticate(username, password) {
    const user = state.users.find(
      (entry) => entry.username === String(username || '').trim().toLowerCase() && entry.active,
    );
    if (!user || user.demoPassword !== String(password || '')) {
      fail(401, 'INVALID_CREDENTIALS', 'That username and password did not match.', {
        username: 'Check the username.',
        password: 'Check the password.',
      });
    }
    user.lastLoginAt = new Date().toISOString();
    user.updatedAt = user.lastLoginAt;
    return user;
  }

  function updateSettings(input) {
    const current = state.settings;
    const taxRateBps = whole(input.taxRateBps ?? current.taxRateBps, 'taxRateBps', { min: 0, max: 10000 });
    const cashierDiscountLimitBps = whole(
      input.cashierDiscountLimitBps ?? current.cashierDiscountLimitBps,
      'cashierDiscountLimitBps',
      { min: 0, max: 10000 },
    );
    const maxLineQuantity = whole(input.maxLineQuantity ?? current.maxLineQuantity, 'maxLineQuantity', { min: 1, max: 9999 });
    const monthlySalesTargetCents = whole(
      input.monthlySalesTargetCents ?? current.monthlySalesTargetCents ?? 0,
      'monthlySalesTargetCents',
      { min: 0, max: 1_000_000_000_000_000 },
    );
    const salesComparisonMode = String(input.salesComparisonMode ?? current.salesComparisonMode ?? 'monthly');
    if (!['monthly', 'yearly'].includes(salesComparisonMode)) {
      fail(400, 'VALIDATION_ERROR', 'Comparison mode must be monthly or yearly.', {
        salesComparisonMode: 'Choose monthly or yearly.',
      });
    }
    state.settings = {
      ...current,
      shopName: text(input.shopName ?? current.shopName, 'shopName', { max: 120 }),
      address: text(input.address ?? current.address, 'address', { required: false, max: 180 }),
      phone: text(input.phone ?? current.phone, 'phone', { required: false, max: 40 }),
      email: text(input.email ?? current.email, 'email', { required: false, max: 120 }),
      tin: text(input.tin ?? current.tin, 'tin', { required: false, max: 40 }),
      currency: text(input.currency ?? current.currency, 'currency', { max: 3 }).toUpperCase(),
      timezone: text(input.timezone ?? current.timezone, 'timezone', { max: 60 }),
      businessDayCutoff: String(input.businessDayCutoff ?? current.businessDayCutoff).slice(0, 5),
      receiptHeader: text(input.receiptHeader ?? current.receiptHeader, 'receiptHeader', { required: false, max: 120 }),
      receiptFooter: text(input.receiptFooter ?? current.receiptFooter, 'receiptFooter', { required: false, max: 180 }),
      returnsPolicy: text(input.returnsPolicy ?? current.returnsPolicy, 'returnsPolicy', { required: false, max: 300 }),
      taxEnabled: Boolean(input.taxEnabled ?? current.taxEnabled),
      taxRateBps,
      taxInclusive: Boolean(input.taxInclusive ?? current.taxInclusive),
      cashierDiscountLimitBps,
      discountReasonRequired: Boolean(input.discountReasonRequired ?? current.discountReasonRequired),
      maxLineQuantity,
      monthlySalesTargetCents,
      salesComparisonMode,
      updatedAt: new Date().toISOString(),
    };
    return state.settings;
  }

  function systemStatus(user) {
    const businessDate = localDate(new Date());
    const counts = {
      products: state.products.filter((product) => product.active).length,
      sales: state.sales.length,
      suppliers: state.suppliers.filter((supplier) => supplier.active).length,
      purchase_orders: state.purchaseOrders.length,
      active_users: state.users.filter((entry) => entry.active).length,
      stock_movements: state.movements.length,
      expenses: state.expenses.filter((entry) => !entry.deletedAt).length,
      audit_records: state.sales.length + state.movements.length + state.expenses.length,
      active_sessions: user ? 1 : 0,
    };
    return {
      app: {
        name: 'Auto-Track POS',
        version: DEMO_VERSION,
        environment: 'GitHub Pages demo (no database)',
        node: 'browser',
        uptimeSeconds: Math.max(1, Math.round((Date.now() - new Date(state.startedAt).getTime()) / 1000)),
        startedAt: state.startedAt,
        host: location.hostname || 'localhost',
        port: location.port || (location.protocol === 'https:' ? 443 : 80),
        tls: location.protocol === 'https:',
      },
      database: {
        version: '—',
        mysql: 'No MySQL in the demo · fixture data in memory',
        name: 'demo-fixtures',
        startedAt: state.startedAt,
        migrations: [
          { version: '001_core', appliedAt: state.startedAt },
          { version: '002_immutability', appliedAt: state.startedAt },
          { version: '003_least_privilege', appliedAt: state.startedAt },
          { version: '004_dashboard_insights', appliedAt: state.startedAt },
        ],
      },
      counts,
      shop: {
        name: state.settings.shopName,
        timezone: state.settings.timezone,
        currency: state.settings.currency,
        businessDayCutoff: state.settings.businessDayCutoff,
        businessDate,
      },
      serverTime: new Date().toISOString(),
      projectRoot: 'browser demo · no filesystem',
    };
  }

  // Public surface ---------------------------------------------------------
  const shop = {
    state,
    DEMO_PASSWORD,
    localDate,
    userDto,
    categoryDto,
    supplierDto,
    productDto,
    movementDto,
    saleRow,
    saleDetail,
    saleStatus,
    poDto,
    nextId,
    applyStockChange,
    addUser,
    addCategory,
    addProduct,
    addSupplier,
    recordSale,
    recordReturn,
    recordVoid,
    createPurchaseOrder,
    updatePurchaseOrder,
    placePurchaseOrder,
    receivePurchaseOrder,
    shortClosePurchaseOrder,
    cancelPurchaseOrder,
    dailyReport,
    lowStockProducts,
    dashboard,
    expenseDto,
    listExpenses,
    expenseTotals,
    createExpense,
    updateExpense,
    deleteExpense,
    valuation,
    movements,
    listSales,
    authenticate,
    verifyAdminCredentials,
    updateSettings,
    systemStatus,
    userById,
    categoryById,
    productById,
    supplierById,
    saleById,
    poById,
    reindex: indexAll,
  };

  // Seed directories (ids must be assigned in the same order as the seed file).
  for (const user of seed.users) {
    userById.set(user.id, user);
    state.users.push(user);
    state.counters.user = Math.max(state.counters.user, Number(user.id));
  }
  for (const category of seed.categories) {
    categoryById.set(category.id, category);
    state.categories.push(category);
    state.counters.category = Math.max(state.counters.category, Number(category.id));
  }

  return shop;
}
