import { dateString } from '../lib/dto.js';
import {
  dailyReport,
  inventoryValuation,
  loadSalesRange,
  lowStockReport,
  purchasingReport,
  stockMovementReport,
} from './reports.js';
import { getSettingsDto } from './settings.js';
import { listUsers } from './users.js';

const DATASET_TITLES = {
  daily: 'Daily sales report',
  sales: 'Sales report',
  inventory: 'Inventory valuation report',
  'low-stock': 'Low-stock report',
  movements: 'Stock movements report',
  purchasing: 'Purchasing report',
};

const MOVEMENT_TYPES = ['OPENING', 'SALE', 'RECEIPT', 'ADJUSTMENT', 'RETURN', 'VOID'];
const PURCHASE_STATUSES = ['DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED'];
const MOVEMENT_EXPORT_LIMIT = 5000;
const PURCHASE_EXPORT_LIMIT = 1000;

function number(value) {
  return Number(value) || 0;
}

function formatMoney(cents, currency = 'PHP') {
  const amount = number(cents) / 100;
  const formatted = new Intl.NumberFormat('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `${currency || 'PHP'} ${formatted}`;
}

function formatCount(value) {
  return new Intl.NumberFormat('en-US').format(number(value));
}

function formatDateTime(value, timeZone) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

function rangeLabel(from, to) {
  return from === to ? `Business date: ${from}` : `Business dates: ${from} to ${to}`;
}

function moneyHeader(label, currency) {
  return `${label} (${currency})`;
}

function amount(value) {
  return number(value);
}

function summarizeSaleRange(data) {
  const completed = data.sales.filter((sale) => sale.status !== 'VOIDED');
  const voided = data.sales.filter((sale) => sale.status === 'VOIDED');
  const completedIds = new Set(completed.map((sale) => Number(sale.id)));
  const items = data.items.filter((item) => completedIds.has(Number(item.sale_id)));
  const payments = data.payments.filter((payment) => completedIds.has(Number(payment.sale_id)));
  const grossCents = completed.reduce(
    (sum, sale) => sum + number(sale.net_cents) - (sale.tax_inclusive ? number(sale.tax_cents) : 0),
    0,
  );
  const discountsCents = completed.reduce((sum, sale) => sum + number(sale.discount_cents), 0);
  const salesTaxCents = completed.reduce((sum, sale) => sum + number(sale.tax_cents), 0);
  const totalCents = completed.reduce((sum, sale) => sum + number(sale.total_cents), 0);
  const refundsCents = data.returns.reduce((sum, entry) => sum + number(entry.total_cents), 0);
  const refundTaxCents = data.returns.reduce((sum, entry) => sum + number(entry.tax_cents), 0);
  const refundRevenueCents = refundsCents - refundTaxCents;
  const collectedCents = totalCents - refundsCents;
  return {
    completed,
    voided,
    items,
    payments,
    grossCents,
    discountsCents,
    taxCents: salesTaxCents - refundTaxCents,
    refundsCents,
    collectedCents,
    netExTaxCents: grossCents - refundRevenueCents,
    averageSaleCents: completed.length ? Math.round(collectedCents / completed.length) : 0,
    refundsCount: data.returns.length,
  };
}

function saleStatus(sale, totalQty, returnedQty) {
  if (sale.status === 'VOIDED') return 'VOIDED';
  if (returnedQty >= totalQty && returnedQty > 0) return 'RETURNED';
  if (returnedQty > 0) return 'PARTIALLY_RETURNED';
  return 'COMPLETED';
}

function commonReport(settings, dataset, generatedAt, { title, subtitle, filters, filenameBase, summary, sheets, notes = [] }) {
  return {
    dataset,
    title: title || DATASET_TITLES[dataset],
    subtitle,
    filterLabels: filters,
    filenameBase,
    shopName: settings.shopName,
    currency: settings.currency,
    timezone: settings.timezone,
    generatedAt,
    generatedAtDisplay: formatDateTime(generatedAt, settings.timezone),
    summary,
    sheets,
    notes,
    rowCount: sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0),
  };
}

async function buildDaily(settings, filters, generatedAt) {
  const { from, to } = filters;
  const data = await dailyReport({ from, to, user: { role: 'ADMIN', id: null } });
  const byDay = data.byDay.map((row) => ({
    businessDate: row.businessDate,
    transactions: row.transactions,
    grossCents: row.grossCents,
    discountsCents: row.discountsCents,
    taxCents: row.taxCents,
    refundsCents: row.refundsCents,
    collectedCents: row.collectedCents,
  }));
  const paymentMix = data.byPayment.map((row) => ({
    method: row.method === 'CARD_EXTERNAL' ? 'External card' : 'Cash',
    amountCents: row.amountCents,
  }));
  const topProducts = data.topProducts.map((row) => ({
    sku: row.sku,
    name: row.name,
    quantity: row.quantity,
    netCents: row.netCents,
  }));
  const sheets = [
    {
      name: 'By business day',
      columns: [
        { key: 'businessDate', header: 'Business date', width: 14 },
        { key: 'transactions', header: 'Transactions', type: 'integer', width: 12 },
        { key: 'grossCents', header: moneyHeader('Gross ex tax', settings.currency), type: 'money', width: 16 },
        { key: 'discountsCents', header: moneyHeader('Discounts', settings.currency), type: 'money', width: 14 },
        { key: 'taxCents', header: moneyHeader('Tax', settings.currency), type: 'money', width: 14 },
        { key: 'refundsCents', header: moneyHeader('Refunds', settings.currency), type: 'money', width: 14 },
        { key: 'collectedCents', header: moneyHeader('Collected', settings.currency), type: 'money', width: 16 },
      ],
      rows: byDay,
      totals: {
        businessDate: 'Total',
        transactions: byDay.reduce((sum, row) => sum + row.transactions, 0),
        grossCents: byDay.reduce((sum, row) => sum + row.grossCents, 0),
        discountsCents: byDay.reduce((sum, row) => sum + row.discountsCents, 0),
        taxCents: byDay.reduce((sum, row) => sum + row.taxCents, 0),
        refundsCents: byDay.reduce((sum, row) => sum + row.refundsCents, 0),
        collectedCents: byDay.reduce((sum, row) => sum + row.collectedCents, 0),
      },
    },
    {
      name: 'Payment mix',
      columns: [
        { key: 'method', header: 'Payment method', width: 20 },
        { key: 'amountCents', header: moneyHeader('Captured minus refunds', settings.currency), type: 'money', width: 24 },
      ],
      rows: paymentMix,
      totals: { method: 'Total', amountCents: paymentMix.reduce((sum, row) => sum + row.amountCents, 0) },
    },
    {
      name: 'Top products',
      columns: [
        { key: 'sku', header: 'SKU', width: 18 },
        { key: 'name', header: 'Product', width: 34 },
        { key: 'quantity', header: 'Quantity', type: 'integer', width: 11 },
        { key: 'netCents', header: moneyHeader('Net sales', settings.currency), type: 'money', width: 16 },
      ],
      rows: topProducts,
      totals: {
        sku: 'Total',
        quantity: topProducts.reduce((sum, row) => sum + row.quantity, 0),
        netCents: topProducts.reduce((sum, row) => sum + row.netCents, 0),
      },
    },
  ];
  return commonReport(settings, 'daily', generatedAt, {
    title: 'Daily sales report',
    subtitle: `${rangeLabel(from, to)}. Totals exclude voided sales and account for returns.`,
    filters: [rangeLabel(from, to), 'Shop-wide sales'],
    filenameBase: `autotrack-daily-sales_${from}_to_${to}`,
    summary: [
      { label: 'Completed transactions', value: formatCount(data.transactionCount) },
      { label: 'Net sales ex tax', value: formatMoney(data.netExTaxCents, settings.currency) },
      { label: 'Discounts', value: formatMoney(data.discountsCents, settings.currency) },
      { label: 'Tax', value: formatMoney(data.taxCents, settings.currency) },
      { label: 'Refunds', value: formatMoney(data.refundsCents, settings.currency) },
      { label: 'Collected after refunds', value: formatMoney(data.collectedCents, settings.currency) },
      { label: 'Voided sales', value: `${formatCount(data.voidCount)} (${formatMoney(data.voidValueCents, settings.currency)})` },
      { label: 'Average completed sale', value: formatMoney(data.averageSaleCents, settings.currency) },
    ],
    sheets,
    notes: ['Tax totals follow each sale snapshot, not the current shop tax setting.'],
  });
}

async function buildSales(settings, filters, generatedAt) {
  const { from, to } = filters;
  const data = await loadSalesRange({ from, to, cashierId: null });
  const users = await listUsers({ includeInactive: true });
  const userNames = new Map(users.map((user) => [String(user.id), user.displayName]));
  const saleNumbers = new Map(data.sales.map((sale) => [Number(sale.id), sale.number]));
  const returnNumbers = new Map(data.returns.map((entry) => [Number(entry.id), entry.number]));

  const returnedByItem = new Map();
  for (const entry of data.returnItems) {
    const key = Number(entry.sale_item_id);
    returnedByItem.set(key, (returnedByItem.get(key) || 0) + number(entry.quantity));
  }
  const returnedBySale = new Map();
  const itemQtyBySale = new Map();
  for (const item of data.items) {
    const key = Number(item.sale_id);
    itemQtyBySale.set(key, (itemQtyBySale.get(key) || 0) + number(item.quantity));
  }
  for (const entry of data.returnItems) {
    const key = Number(entry.sale_id);
    returnedBySale.set(key, (returnedBySale.get(key) || 0) + number(entry.quantity));
  }
  const returnedCentsBySale = new Map();
  for (const entry of data.returns) {
    const key = Number(entry.sale_id);
    returnedCentsBySale.set(key, (returnedCentsBySale.get(key) || 0) + number(entry.total_cents));
  }

  const saleRows = data.sales.map((sale) => {
    const key = Number(sale.id);
    return {
      number: sale.number,
      businessDate: dateString(sale.business_date),
      createdAt: formatDateTime(sale.created_at, settings.timezone),
      cashierName: sale.cashier_name,
      terminal: sale.terminal_label,
      status: saleStatus(sale, itemQtyBySale.get(key) || 0, returnedBySale.get(key) || 0),
      units: itemQtyBySale.get(key) || 0,
      returnedUnits: returnedBySale.get(key) || 0,
      subtotalCents: number(sale.subtotal_cents),
      discountCents: number(sale.discount_cents),
      netCents: number(sale.net_cents),
      taxCents: number(sale.tax_cents),
      totalCents: number(sale.total_cents),
      returnedCents: returnedCentsBySale.get(key) || 0,
      note: sale.note,
    };
  });
  const itemRows = data.items.map((item) => ({
    saleNumber: saleNumbers.get(Number(item.sale_id)) || '',
    sku: item.sku,
    name: item.name,
    quantity: number(item.quantity),
    returnedQuantity: returnedByItem.get(Number(item.id)) || 0,
    unitPriceCents: number(item.unit_price_cents),
    discountBps: number(item.discount_bps),
    discountCents: number(item.discount_cents),
    taxCents: number(item.tax_cents),
    totalCents: number(item.total_cents),
    unitCostCents: number(item.unit_cost_cents),
    costValueCents: number(item.cost_value_cents),
    note: item.note,
  }));
  const paymentRows = data.payments.map((payment) => ({
    saleNumber: saleNumbers.get(Number(payment.sale_id)) || '',
    createdAt: formatDateTime(payment.created_at, settings.timezone),
    method: payment.method === 'CARD_EXTERNAL' ? 'External card' : 'Cash',
    amountCents: number(payment.amount_cents),
    tenderedCents: number(payment.tendered_cents),
    changeCents: number(payment.change_cents),
    reference: payment.reference,
  }));
  const returnRows = data.returns.map((entry) => ({
    number: entry.number,
    saleNumber: saleNumbers.get(Number(entry.sale_id)) || '',
    businessDate: dateString(entry.business_date),
    createdAt: formatDateTime(entry.created_at, settings.timezone),
    reason: entry.reason,
    refundCents: number(entry.total_cents),
    taxCents: number(entry.tax_cents),
    costValueCents: number(entry.cost_value_cents),
    createdBy: userNames.get(String(entry.created_by)) || String(entry.created_by || ''),
    approvedBy: entry.approved_by ? (userNames.get(String(entry.approved_by)) || String(entry.approved_by)) : '',
  }));
  const returnItemRows = data.returnItems.map((entry) => ({
    returnNumber: returnNumbers.get(Number(entry.return_id)) || '',
    saleNumber: saleNumbers.get(Number(entry.sale_id)) || '',
    sku: entry.sku,
    name: entry.name,
    quantity: number(entry.quantity),
    refundCents: number(entry.refund_cents),
    taxCents: number(entry.tax_cents),
    costValueCents: number(entry.cost_value_cents),
    restocked: entry.restocked ? 'Yes' : 'No',
  }));

  const summaryData = summarizeSaleRange(data);
  const sheets = [
    {
      name: 'Sales',
      columns: [
        { key: 'number', header: 'Sale', width: 18 },
        { key: 'businessDate', header: 'Business date', width: 13 },
        { key: 'createdAt', header: 'Recorded at', width: 20 },
        { key: 'cashierName', header: 'Cashier', width: 18 },
        { key: 'terminal', header: 'Terminal', width: 14 },
        { key: 'status', header: 'Status', width: 18 },
        { key: 'units', header: 'Units', type: 'integer', width: 9 },
        { key: 'returnedUnits', header: 'Returned units', type: 'integer', width: 12 },
        { key: 'subtotalCents', header: moneyHeader('Subtotal', settings.currency), type: 'money', width: 14, pdf: false },
        { key: 'discountCents', header: moneyHeader('Discounts', settings.currency), type: 'money', width: 13 },
        { key: 'netCents', header: moneyHeader('Net', settings.currency), type: 'money', width: 13, pdf: false },
        { key: 'taxCents', header: moneyHeader('Tax', settings.currency), type: 'money', width: 12 },
        { key: 'totalCents', header: moneyHeader('Total', settings.currency), type: 'money', width: 14 },
        { key: 'returnedCents', header: moneyHeader('Refunded', settings.currency), type: 'money', width: 14 },
        { key: 'note', header: 'Note', width: 28, pdf: false },
      ],
      rows: saleRows,
      totals: {
        number: 'Total',
        units: saleRows.reduce((sum, row) => sum + row.units, 0),
        returnedUnits: saleRows.reduce((sum, row) => sum + row.returnedUnits, 0),
        subtotalCents: saleRows.reduce((sum, row) => sum + row.subtotalCents, 0),
        discountCents: saleRows.reduce((sum, row) => sum + row.discountCents, 0),
        netCents: saleRows.reduce((sum, row) => sum + row.netCents, 0),
        taxCents: saleRows.reduce((sum, row) => sum + row.taxCents, 0),
        totalCents: saleRows.reduce((sum, row) => sum + row.totalCents, 0),
        returnedCents: saleRows.reduce((sum, row) => sum + row.returnedCents, 0),
      },
    },
    {
      name: 'Sale lines',
      columns: [
        { key: 'saleNumber', header: 'Sale', width: 18 },
        { key: 'sku', header: 'SKU', width: 16 },
        { key: 'name', header: 'Product', width: 32 },
        { key: 'quantity', header: 'Quantity', type: 'integer', width: 9 },
        { key: 'returnedQuantity', header: 'Returned', type: 'integer', width: 9 },
        { key: 'unitPriceCents', header: moneyHeader('Unit price', settings.currency), type: 'money', width: 14 },
        { key: 'discountBps', header: 'Discount', type: 'percent', width: 10 },
        { key: 'discountCents', header: moneyHeader('Discount', settings.currency), type: 'money', width: 13 },
        { key: 'taxCents', header: moneyHeader('Tax', settings.currency), type: 'money', width: 12 },
        { key: 'totalCents', header: moneyHeader('Total', settings.currency), type: 'money', width: 14 },
        { key: 'unitCostCents', header: moneyHeader('Unit cost', settings.currency), type: 'money', width: 13, pdf: false },
        { key: 'costValueCents', header: moneyHeader('Cost value', settings.currency), type: 'money', width: 14, pdf: false },
        { key: 'note', header: 'Line note', width: 28, pdf: false },
      ],
      rows: itemRows,
      totals: {
        saleNumber: 'Total',
        quantity: itemRows.reduce((sum, row) => sum + row.quantity, 0),
        returnedQuantity: itemRows.reduce((sum, row) => sum + row.returnedQuantity, 0),
        discountCents: itemRows.reduce((sum, row) => sum + row.discountCents, 0),
        taxCents: itemRows.reduce((sum, row) => sum + row.taxCents, 0),
        totalCents: itemRows.reduce((sum, row) => sum + row.totalCents, 0),
        costValueCents: itemRows.reduce((sum, row) => sum + row.costValueCents, 0),
      },
    },
    {
      name: 'Payments',
      columns: [
        { key: 'saleNumber', header: 'Sale', width: 18 },
        { key: 'createdAt', header: 'Recorded at', width: 20 },
        { key: 'method', header: 'Method', width: 16 },
        { key: 'amountCents', header: moneyHeader('Amount', settings.currency), type: 'money', width: 14 },
        { key: 'tenderedCents', header: moneyHeader('Tendered', settings.currency), type: 'money', width: 14, pdf: false },
        { key: 'changeCents', header: moneyHeader('Change', settings.currency), type: 'money', width: 12, pdf: false },
        { key: 'reference', header: 'Terminal reference', width: 22 },
      ],
      rows: paymentRows,
      totals: {
        saleNumber: 'Total',
        amountCents: paymentRows.reduce((sum, row) => sum + row.amountCents, 0),
        tenderedCents: paymentRows.reduce((sum, row) => sum + row.tenderedCents, 0),
        changeCents: paymentRows.reduce((sum, row) => sum + row.changeCents, 0),
      },
    },
    {
      name: 'Returns',
      columns: [
        { key: 'number', header: 'Return', width: 18 },
        { key: 'saleNumber', header: 'Sale', width: 18 },
        { key: 'businessDate', header: 'Business date', width: 13 },
        { key: 'createdAt', header: 'Recorded at', width: 20 },
        { key: 'reason', header: 'Reason', width: 32 },
        { key: 'refundCents', header: moneyHeader('Refund', settings.currency), type: 'money', width: 14 },
        { key: 'taxCents', header: moneyHeader('Tax', settings.currency), type: 'money', width: 12 },
        { key: 'costValueCents', header: moneyHeader('Cost restored', settings.currency), type: 'money', width: 15, pdf: false },
        { key: 'createdBy', header: 'Created by', width: 18, pdf: false },
        { key: 'approvedBy', header: 'Approved by', width: 18, pdf: false },
      ],
      rows: returnRows,
      totals: {
        number: 'Total',
        refundCents: returnRows.reduce((sum, row) => sum + row.refundCents, 0),
        taxCents: returnRows.reduce((sum, row) => sum + row.taxCents, 0),
        costValueCents: returnRows.reduce((sum, row) => sum + row.costValueCents, 0),
      },
    },
    {
      name: 'Return lines',
      columns: [
        { key: 'returnNumber', header: 'Return', width: 18 },
        { key: 'saleNumber', header: 'Sale', width: 18 },
        { key: 'sku', header: 'SKU', width: 16 },
        { key: 'name', header: 'Product', width: 32 },
        { key: 'quantity', header: 'Quantity', type: 'integer', width: 9 },
        { key: 'refundCents', header: moneyHeader('Refund', settings.currency), type: 'money', width: 14 },
        { key: 'taxCents', header: moneyHeader('Tax', settings.currency), type: 'money', width: 12 },
        { key: 'costValueCents', header: moneyHeader('Cost restored', settings.currency), type: 'money', width: 15, pdf: false },
        { key: 'restocked', header: 'Restocked', width: 11 },
      ],
      rows: returnItemRows,
      totals: {
        returnNumber: 'Total',
        quantity: returnItemRows.reduce((sum, row) => sum + row.quantity, 0),
        refundCents: returnItemRows.reduce((sum, row) => sum + row.refundCents, 0),
        taxCents: returnItemRows.reduce((sum, row) => sum + row.taxCents, 0),
        costValueCents: returnItemRows.reduce((sum, row) => sum + row.costValueCents, 0),
      },
    },
  ];
  return commonReport(settings, 'sales', generatedAt, {
    title: 'Sales report',
    subtitle: `${rangeLabel(from, to)}. Includes sale-level totals, line detail, payments, returns, and voided sales.`,
    filters: [rangeLabel(from, to), 'Shop-wide sales', 'Voided sales included for audit; totals exclude voids'],
    filenameBase: `autotrack-sales_${from}_to_${to}`,
    summary: [
      { label: 'Completed sales', value: formatCount(summaryData.completed.length) },
      { label: 'Voided sales', value: formatCount(summaryData.voided.length) },
      { label: 'Net sales ex tax', value: formatMoney(summaryData.netExTaxCents, settings.currency) },
      { label: 'Discounts', value: formatMoney(summaryData.discountsCents, settings.currency) },
      { label: 'Tax', value: formatMoney(summaryData.taxCents, settings.currency) },
      { label: 'Refunds', value: formatMoney(summaryData.refundsCents, settings.currency) },
      { label: 'Collected after refunds', value: formatMoney(summaryData.collectedCents, settings.currency) },
      { label: 'Average completed sale', value: formatMoney(summaryData.averageSaleCents, settings.currency) },
    ],
    sheets,
    notes: ['The Sales sheet includes every sale in range. The Sale lines, Payments, Returns, and Return lines sheets contain the supporting detail.'],
  });
}

async function buildInventory(settings, filters, generatedAt) {
  const categoryId = filters.categoryId || null;
  const [valuation, lowStock] = await Promise.all([
    inventoryValuation({ categoryId, includeInactive: false }),
    lowStockReport({ includeCost: true }),
  ]);
  const lowStockInScope = categoryId
    ? lowStock.filter((product) => String(product.categoryId) === String(categoryId))
    : lowStock;
  const totalStockValue = valuation.reduce((sum, product) => sum + number(product.stockValueCents), 0);
  const totalRetailValue = valuation.reduce((sum, product) => sum + number(product.retailValueCents), 0);
  const totalUnits = valuation.reduce((sum, product) => sum + number(product.stockOnHand), 0);
  const valuationRows = valuation.map((product) => ({
    sku: product.sku,
    name: product.name,
    category: product.categoryName,
    onHand: number(product.stockOnHand),
    reorder: number(product.reorderLevel),
    wacCents: number(product.wacCents),
    stockValueCents: number(product.stockValueCents),
    retailValueCents: number(product.retailValueCents),
    retailPriceCents: number(product.priceCents),
    costCents: number(product.costCents),
    active: product.active ? 'Yes' : 'No',
  }));
  const lowRows = lowStockInScope.map((product) => ({
    sku: product.sku,
    name: product.name,
    category: product.categoryName,
    onHand: number(product.stockOnHand),
    reorder: number(product.reorderLevel),
    gap: Math.max(0, number(product.reorderLevel) - number(product.stockOnHand)),
    stockValueCents: number(product.stockValueCents),
    retailValueCents: number(product.retailValueCents),
  }));
  const sheets = [
    {
      name: 'Inventory valuation',
      columns: [
        { key: 'sku', header: 'SKU', width: 18 },
        { key: 'name', header: 'Product', width: 34 },
        { key: 'category', header: 'Category', width: 22 },
        { key: 'onHand', header: 'On hand', type: 'integer', width: 10 },
        { key: 'reorder', header: 'Reorder', type: 'integer', width: 10 },
        { key: 'wacCents', header: moneyHeader('WAC', settings.currency), type: 'money', width: 13 },
        { key: 'stockValueCents', header: moneyHeader('Stock value', settings.currency), type: 'money', width: 15 },
        { key: 'retailValueCents', header: moneyHeader('Retail value', settings.currency), type: 'money', width: 15 },
        { key: 'retailPriceCents', header: moneyHeader('Retail price', settings.currency), type: 'money', width: 14, pdf: false },
        { key: 'costCents', header: moneyHeader('Unit cost', settings.currency), type: 'money', width: 13, pdf: false },
        { key: 'active', header: 'Active', width: 9, pdf: false },
      ],
      rows: valuationRows,
      totals: {
        sku: 'Total',
        onHand: totalUnits,
        stockValueCents: totalStockValue,
        retailValueCents: totalRetailValue,
      },
    },
    {
      name: 'Low stock',
      columns: [
        { key: 'sku', header: 'SKU', width: 18 },
        { key: 'name', header: 'Product', width: 34 },
        { key: 'category', header: 'Category', width: 22 },
        { key: 'onHand', header: 'On hand', type: 'integer', width: 10 },
        { key: 'reorder', header: 'Reorder', type: 'integer', width: 10 },
        { key: 'gap', header: 'Below reorder', type: 'integer', width: 12 },
        { key: 'stockValueCents', header: moneyHeader('Stock value', settings.currency), type: 'money', width: 15 },
        { key: 'retailValueCents', header: moneyHeader('Retail value', settings.currency), type: 'money', width: 15 },
      ],
      rows: lowRows,
      totals: {
        sku: 'Total',
        onHand: lowRows.reduce((sum, row) => sum + row.onHand, 0),
        gap: lowRows.reduce((sum, row) => sum + row.gap, 0),
        stockValueCents: lowRows.reduce((sum, row) => sum + row.stockValueCents, 0),
        retailValueCents: lowRows.reduce((sum, row) => sum + row.retailValueCents, 0),
      },
    },
  ];
  return commonReport(settings, 'inventory', generatedAt, {
    title: 'Inventory valuation report',
    subtitle: `Current stock valuation as of ${filters.asOf}. WAC is derived from stock value divided by on-hand quantity.`,
    filters: [categoryId ? `Category filter: ${categoryId}` : 'All categories', 'Active products only'],
    filenameBase: `autotrack-inventory-valuation_${filters.asOf}`,
    summary: [
      { label: 'SKUs in scope', value: formatCount(valuation.length) },
      { label: 'Units on hand', value: formatCount(totalUnits) },
      { label: 'Stock value', value: formatMoney(totalStockValue, settings.currency) },
      { label: 'Retail value', value: formatMoney(totalRetailValue, settings.currency) },
      { label: 'Low-stock SKUs', value: formatCount(lowStockInScope.length) },
    ],
    sheets,
    notes: ['Stock value is the inventory-value source of truth. WAC is derived and is not a stored money value.'],
  });
}

async function buildLowStock(settings, filters, generatedAt) {
  const products = await lowStockReport({ includeCost: true });
  const rows = products.map((product) => ({
    sku: product.sku,
    name: product.name,
    category: product.categoryName,
    onHand: number(product.stockOnHand),
    reorder: number(product.reorderLevel),
    gap: Math.max(0, number(product.reorderLevel) - number(product.stockOnHand)),
    stockValueCents: number(product.stockValueCents),
    retailValueCents: number(product.retailValueCents),
  }));
  const outOfStock = products.filter((product) => number(product.stockOnHand) === 0).length;
  const stockValue = products.reduce((sum, product) => sum + number(product.stockValueCents), 0);
  const retailValue = products.reduce((sum, product) => sum + number(product.retailValueCents), 0);
  return commonReport(settings, 'low-stock', generatedAt, {
    title: 'Low-stock report',
    subtitle: `Active products at or below their reorder level as of ${filters.asOf}.`,
    filters: ['Active products at or below reorder level'],
    filenameBase: `autotrack-low-stock_${filters.asOf}`,
    summary: [
      { label: 'Low-stock SKUs', value: formatCount(products.length) },
      { label: 'Out of stock', value: formatCount(outOfStock) },
      { label: 'Stock value', value: formatMoney(stockValue, settings.currency) },
      { label: 'Retail value', value: formatMoney(retailValue, settings.currency) },
    ],
    sheets: [
      {
        name: 'Low stock',
        columns: [
          { key: 'sku', header: 'SKU', width: 18 },
          { key: 'name', header: 'Product', width: 34 },
          { key: 'category', header: 'Category', width: 22 },
          { key: 'onHand', header: 'On hand', type: 'integer', width: 10 },
          { key: 'reorder', header: 'Reorder', type: 'integer', width: 10 },
          { key: 'gap', header: 'Below reorder', type: 'integer', width: 12 },
          { key: 'stockValueCents', header: moneyHeader('Stock value', settings.currency), type: 'money', width: 15 },
          { key: 'retailValueCents', header: moneyHeader('Retail value', settings.currency), type: 'money', width: 15 },
        ],
        rows,
        totals: {
          sku: 'Total',
          onHand: rows.reduce((sum, row) => sum + row.onHand, 0),
          gap: rows.reduce((sum, row) => sum + row.gap, 0),
          stockValueCents: stockValue,
          retailValueCents: retailValue,
        },
      },
    ],
    notes: ['Includes active products only.'],
  });
}

async function buildMovements(settings, filters, generatedAt) {
  const { from, to } = filters;
  const movements = await stockMovementReport({
    productId: filters.productId || null,
    type: filters.type || '',
    from,
    to,
    limit: MOVEMENT_EXPORT_LIMIT,
  });
  const users = await listUsers({ includeInactive: true });
  const userNames = new Map(users.map((user) => [String(user.id), user.displayName]));
  const rows = movements.map((movement) => ({
    occurredAt: formatDateTime(movement.occurredAt, settings.timezone),
    businessDate: movement.businessDate,
    productName: movement.productName || '',
    sku: movement.sku || '',
    type: movement.type,
    quantityDelta: number(movement.quantityDelta),
    stockBefore: number(movement.stockBefore),
    stockAfter: number(movement.stockAfter),
    valueDeltaCents: number(movement.valueDeltaCents),
    reference: movement.reference || '',
    reason: movement.reason || '',
    actorName: userNames.get(String(movement.actorId)) || String(movement.actorId || ''),
  }));
  const netQty = rows.reduce((sum, row) => sum + row.quantityDelta, 0);
  const netValue = rows.reduce((sum, row) => sum + row.valueDeltaCents, 0);
  const productCount = new Set(rows.map((row) => row.sku)).size;
  return commonReport(settings, 'movements', generatedAt, {
    title: 'Stock movements report',
    subtitle: `${rangeLabel(from, to)}. Movement ledger for stock quantity and value changes.`,
    filters: [
      rangeLabel(from, to),
      filters.type ? `Movement type: ${filters.type}` : 'All movement types',
      filters.productId ? `Product filter: ${filters.productId}` : 'All products',
    ],
    filenameBase: `autotrack-stock-movements_${from}_to_${to}`,
    summary: [
      { label: 'Movements', value: formatCount(rows.length) },
      { label: 'Products affected', value: formatCount(productCount) },
      { label: 'Net quantity change', value: formatCount(netQty) },
      { label: 'Net value change', value: formatMoney(netValue, settings.currency) },
    ],
    sheets: [
      {
        name: 'Stock movements',
        columns: [
          { key: 'occurredAt', header: 'Recorded at', width: 20 },
          { key: 'businessDate', header: 'Business date', width: 13 },
          { key: 'sku', header: 'SKU', width: 16 },
          { key: 'productName', header: 'Product', width: 28 },
          { key: 'type', header: 'Type', width: 12 },
          { key: 'quantityDelta', header: 'Qty change', type: 'integer', width: 10 },
          { key: 'stockBefore', header: 'Stock before', type: 'integer', width: 11 },
          { key: 'stockAfter', header: 'Stock after', type: 'integer', width: 10 },
          { key: 'valueDeltaCents', header: moneyHeader('Value change', settings.currency), type: 'money', width: 14 },
          { key: 'reference', header: 'Reference', width: 20 },
          { key: 'reason', header: 'Reason', width: 28 },
          { key: 'actorName', header: 'User', width: 18 },
        ],
        rows,
        totals: {
          occurredAt: 'Total',
          quantityDelta: netQty,
          valueDeltaCents: netValue,
        },
      },
    ],
    notes: movements.length >= MOVEMENT_EXPORT_LIMIT
      ? [`Export limited to the most recent ${formatCount(MOVEMENT_EXPORT_LIMIT)} movements. Narrow the date range for a complete list.`]
      : [],
  });
}

async function buildPurchasing(settings, filters, generatedAt) {
  const orders = await purchasingReport({
    status: filters.status || '',
    supplierId: filters.supplierId || null,
    limit: PURCHASE_EXPORT_LIMIT,
  });
  const orderRows = [];
  const lineRows = [];
  const receiptRows = [];
  for (const order of orders) {
    orderRows.push({
      number: order.number,
      supplierName: order.supplierName,
      status: order.status,
      createdAt: formatDateTime(order.createdAt, settings.timezone),
      expectedAt: order.expectedAt || '',
      orderedTotalCents: number(order.orderedTotalCents),
      receivedTotalCents: number(order.receivedTotalCents),
      progress: number(order.progress),
      createdByName: order.createdByName || '',
      notes: order.notes || '',
    });
    for (const line of order.lines) {
      lineRows.push({
        number: order.number,
        supplierName: order.supplierName,
        sku: line.sku,
        name: line.name,
        orderedQty: number(line.orderedQty),
        receivedQty: number(line.receivedQty),
        unitCostCents: number(line.unitCostCents),
        orderedTotalCents: number(line.orderedTotalCents),
        receivedTotalCents: number(line.receivedTotalCents),
      });
    }
    for (const receipt of order.receipts) {
      receiptRows.push({
        number: receipt.number,
        orderNumber: order.number,
        supplierName: order.supplierName,
        receivedAt: formatDateTime(receipt.createdAt, settings.timezone),
        receivedByName: receipt.receivedByName || '',
        totalCents: number(receipt.totalCents),
        note: receipt.note || '',
      });
    }
  }
  const orderedValue = orderRows.reduce((sum, row) => sum + row.orderedTotalCents, 0);
  const receivedValue = orderRows.reduce((sum, row) => sum + row.receivedTotalCents, 0);
  const summarySheets = [
    {
      name: 'Purchase orders',
      columns: [
        { key: 'number', header: 'PO', width: 18 },
        { key: 'supplierName', header: 'Supplier', width: 24 },
        { key: 'status', header: 'Status', width: 18 },
        { key: 'createdAt', header: 'Created at', width: 20 },
        { key: 'expectedAt', header: 'Expected', width: 12 },
        { key: 'orderedTotalCents', header: moneyHeader('Ordered value', settings.currency), type: 'money', width: 15 },
        { key: 'receivedTotalCents', header: moneyHeader('Received value', settings.currency), type: 'money', width: 15 },
        { key: 'progress', header: 'Progress %', type: 'integer', width: 11 },
        { key: 'createdByName', header: 'Created by', width: 18 },
        { key: 'notes', header: 'Notes', width: 30, pdf: false },
      ],
      rows: orderRows,
      totals: {
        number: 'Total',
        orderedTotalCents: orderedValue,
        receivedTotalCents: receivedValue,
      },
    },
    {
      name: 'PO lines',
      columns: [
        { key: 'number', header: 'PO', width: 18 },
        { key: 'supplierName', header: 'Supplier', width: 24 },
        { key: 'sku', header: 'SKU', width: 16 },
        { key: 'name', header: 'Product', width: 30 },
        { key: 'orderedQty', header: 'Ordered qty', type: 'integer', width: 11 },
        { key: 'receivedQty', header: 'Received qty', type: 'integer', width: 11 },
        { key: 'unitCostCents', header: moneyHeader('Unit cost', settings.currency), type: 'money', width: 13 },
        { key: 'orderedTotalCents', header: moneyHeader('Ordered total', settings.currency), type: 'money', width: 15 },
        { key: 'receivedTotalCents', header: moneyHeader('Received total', settings.currency), type: 'money', width: 15 },
      ],
      rows: lineRows,
      totals: {
        number: 'Total',
        orderedQty: lineRows.reduce((sum, row) => sum + row.orderedQty, 0),
        receivedQty: lineRows.reduce((sum, row) => sum + row.receivedQty, 0),
        orderedTotalCents: lineRows.reduce((sum, row) => sum + row.orderedTotalCents, 0),
        receivedTotalCents: lineRows.reduce((sum, row) => sum + row.receivedTotalCents, 0),
      },
    },
    {
      name: 'Receipts',
      columns: [
        { key: 'number', header: 'Receipt', width: 18 },
        { key: 'orderNumber', header: 'PO', width: 18 },
        { key: 'supplierName', header: 'Supplier', width: 24 },
        { key: 'receivedAt', header: 'Received at', width: 20 },
        { key: 'receivedByName', header: 'Received by', width: 18 },
        { key: 'totalCents', header: moneyHeader('Value', settings.currency), type: 'money', width: 14 },
        { key: 'note', header: 'Note', width: 30 },
      ],
      rows: receiptRows,
      totals: {
        number: 'Total',
        totalCents: receiptRows.reduce((sum, row) => sum + row.totalCents, 0),
      },
    },
  ];
  return commonReport(settings, 'purchasing', generatedAt, {
    title: 'Purchasing report',
    subtitle: `Purchase-order status and received value as of ${filters.asOf}.`,
    filters: [
      filters.status ? `Status: ${filters.status}` : 'All purchase-order statuses',
      filters.supplierId ? `Supplier filter: ${filters.supplierId}` : 'All suppliers',
    ],
    filenameBase: `autotrack-purchasing_${filters.asOf}`,
    summary: [
      { label: 'Purchase orders', value: formatCount(orderRows.length) },
      { label: 'Ordered value', value: formatMoney(orderedValue, settings.currency) },
      { label: 'Received value', value: formatMoney(receivedValue, settings.currency) },
      { label: 'Open value', value: formatMoney(Math.max(0, orderedValue - receivedValue), settings.currency) },
      { label: 'Receipts', value: formatCount(receiptRows.length) },
    ],
    sheets: summarySheets,
    notes: orders.length >= PURCHASE_EXPORT_LIMIT
      ? [`Export limited to the most recent ${formatCount(PURCHASE_EXPORT_LIMIT)} purchase orders. Narrow the filters for a complete list.`]
      : [],
  });
}

export async function buildExportReport({ dataset, filters }) {
  const settings = await getSettingsDto();
  const generatedAt = new Date().toISOString();
  if (dataset === 'daily') return buildDaily(settings, filters, generatedAt);
  if (dataset === 'sales') return buildSales(settings, filters, generatedAt);
  if (dataset === 'inventory') return buildInventory(settings, filters, generatedAt);
  if (dataset === 'low-stock') return buildLowStock(settings, filters, generatedAt);
  if (dataset === 'movements') return buildMovements(settings, filters, generatedAt);
  if (dataset === 'purchasing') return buildPurchasing(settings, filters, generatedAt);
  throw new Error(`Unknown export dataset: ${dataset}`);
}

export const EXPORT_DATASETS = Object.keys(DATASET_TITLES);
export const EXPORT_FORMATS = ['xlsx', 'pdf'];
export const EXPORT_MOVEMENT_TYPES = MOVEMENT_TYPES;
export const EXPORT_PURCHASE_STATUSES = PURCHASE_STATUSES;
