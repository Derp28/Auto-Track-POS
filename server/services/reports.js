import { query } from '../db.js';
import { productDto, dateString } from '../lib/dto.js';
import { listMovements } from './inventory.js';
import { listPurchaseOrders } from './purchasing.js';

function saleRevenueExTax(row) {
  return Number(row.net_cents) - (row.tax_inclusive ? Number(row.tax_cents) : 0);
}

async function loadRange({ from, to, cashierId }) {
  const params = [from, to, cashierId];
  const [sales, items, payments, returns, returnItems] = await Promise.all([
    query(
      `SELECT * FROM sales
        WHERE business_date >= $1 AND business_date <= $2 AND ($3::bigint IS NULL OR cashier_id = $3)
        ORDER BY created_at, id`,
      params,
    ),
    query(
      `SELECT si.* FROM sale_items si JOIN sales s ON s.id = si.sale_id
        WHERE s.business_date >= $1 AND s.business_date <= $2 AND ($3::bigint IS NULL OR s.cashier_id = $3)
        ORDER BY si.id`,
      params,
    ),
    query(
      `SELECT p.* FROM sale_payments p JOIN sales s ON s.id = p.sale_id
        WHERE s.business_date >= $1 AND s.business_date <= $2 AND ($3::bigint IS NULL OR s.cashier_id = $3)
        ORDER BY p.id`,
      params,
    ),
    query(
      `SELECT r.* FROM sale_returns r JOIN sales s ON s.id = r.sale_id
        WHERE r.business_date >= $1 AND r.business_date <= $2 AND ($3::bigint IS NULL OR s.cashier_id = $3)
        ORDER BY r.created_at, r.id`,
      params,
    ),
    query(
      `SELECT sri.*, si.sale_id, si.sku, si.name
         FROM sale_return_items sri
         JOIN sale_items si ON si.id = sri.sale_item_id
         JOIN sale_returns r ON r.id = sri.return_id
         JOIN sales s ON s.id = r.sale_id
        WHERE r.business_date >= $1 AND r.business_date <= $2 AND ($3::bigint IS NULL OR s.cashier_id = $3)
        ORDER BY sri.id`,
      params,
    ),
  ]);
  return { sales: sales.rows, items: items.rows, payments: payments.rows, returns: returns.rows, returnItems: returnItems.rows };
}

export async function dailyReport({ from, to, user }) {
  const data = await loadRange({ from, to, cashierId: user.role === 'CASHIER' ? user.id : null });
  const completed = data.sales.filter((sale) => sale.status !== 'VOIDED');
  const voided = data.sales.filter((sale) => sale.status === 'VOIDED');
  const completedIds = new Set(completed.map((sale) => Number(sale.id)));
  const items = data.items.filter((item) => completedIds.has(Number(item.sale_id)));
  const payments = data.payments.filter((payment) => completedIds.has(Number(payment.sale_id)));
  const grossCents = completed.reduce((sum, sale) => sum + saleRevenueExTax(sale), 0);
  const discountsCents = completed.reduce((sum, sale) => sum + Number(sale.discount_cents), 0);
  const salesTaxCents = completed.reduce((sum, sale) => sum + Number(sale.tax_cents), 0);
  const totalCents = completed.reduce((sum, sale) => sum + Number(sale.total_cents), 0);
  const refundsCents = data.returns.reduce((sum, entry) => sum + Number(entry.total_cents), 0);
  const refundTaxCents = data.returns.reduce((sum, entry) => sum + Number(entry.tax_cents), 0);
  const refundRevenueCents = refundsCents - refundTaxCents;
  const collectedCents = totalCents - refundsCents;

  const byDay = new Map();
  const ensureDay = (day) => {
    if (!byDay.has(day)) {
      byDay.set(day, { businessDate: day, transactions: 0, grossCents: 0, discountsCents: 0, taxCents: 0, refundsCents: 0, collectedCents: 0 });
    }
    return byDay.get(day);
  };
  for (const sale of completed) {
    const row = ensureDay(dateString(sale.business_date));
    row.transactions += 1;
    row.grossCents += saleRevenueExTax(sale);
    row.discountsCents += Number(sale.discount_cents);
    row.taxCents += Number(sale.tax_cents);
    row.collectedCents += Number(sale.total_cents);
  }
  for (const entry of data.returns) {
    const row = ensureDay(dateString(entry.business_date));
    row.refundsCents += Number(entry.total_cents);
    row.taxCents -= Number(entry.tax_cents);
    row.collectedCents -= Number(entry.total_cents);
  }

  const paymentMap = new Map();
  for (const payment of payments) {
    paymentMap.set(payment.method, (paymentMap.get(payment.method) || 0) + Number(payment.amount_cents));
  }
  const refundsByMethod = await query(
    `SELECT rf.method, COALESCE(sum(rf.amount_cents), 0)::bigint AS amount
       FROM refunds rf
       JOIN sale_returns r ON r.id = rf.return_id
       JOIN sales s ON s.id = r.sale_id
      WHERE r.business_date >= $1 AND r.business_date <= $2 AND ($3::bigint IS NULL OR s.cashier_id = $3)
      GROUP BY rf.method`,
    [from, to, user.role === 'CASHIER' ? user.id : null],
  );
  for (const row of refundsByMethod.rows) {
    paymentMap.set(row.method, (paymentMap.get(row.method) || 0) - Number(row.amount));
  }

  const productMap = new Map();
  for (const item of items) {
    if (!productMap.has(Number(item.product_id))) {
      productMap.set(Number(item.product_id), { productId: String(item.product_id), sku: item.sku, name: item.name, quantity: 0, netCents: 0 });
    }
    const row = productMap.get(Number(item.product_id));
    row.quantity += Number(item.quantity);
    row.netCents += Number(item.net_cents) - (item.tax_inclusive ? Number(item.tax_cents) : 0);
  }
  for (const item of data.returnItems) {
    const row = productMap.get(Number(item.product_id));
    if (!row) continue;
    row.quantity -= Number(item.quantity);
    row.netCents -= Number(item.refund_cents) - Number(item.tax_cents);
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
    returnsCount: data.returns.length,
    voidCount: voided.length,
    voidValueCents: voided.reduce((sum, sale) => sum + Number(sale.total_cents), 0),
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

export async function inventoryValuation({ categoryId = null, includeInactive = false } = {}) {
  const { rows } = await query(
    `SELECT p.*, c.name AS category_name FROM products p JOIN categories c ON c.id = p.category_id
      WHERE ($1::boolean OR p.active) AND ($2::bigint IS NULL OR p.category_id = $2)
      ORDER BY lower(p.name)`,
    [includeInactive, categoryId],
  );
  return rows.map((row) => ({
    ...productDto(row, { includeCost: true, categoryName: row.category_name }),
    wacCents: Number(row.stock_on_hand)
      ? Math.round(Number(row.stock_value_cents) / Number(row.stock_on_hand))
      : 0,
    retailValueCents: Number(row.price_cents) * Number(row.stock_on_hand),
  }));
}

export async function lowStockReport({ includeCost = true } = {}) {
  const { rows } = await query(
    `SELECT p.*, c.name AS category_name FROM products p JOIN categories c ON c.id = p.category_id
      WHERE p.active AND p.stock_on_hand <= p.reorder_level
      ORDER BY (p.stock_on_hand::numeric / GREATEST(p.reorder_level, 1)) ASC, lower(p.name)`,
  );
  return rows.map((row) => productDto(row, { includeCost, categoryName: row.category_name }));
}

export async function stockMovementReport({ productId = null, type = '', from = null, to = null, limit = 500 } = {}) {
  return listMovements({ productId, type, from, to, limit });
}

export async function purchasingReport({ status = '', supplierId = null } = {}) {
  return listPurchaseOrders({ status, supplierId, limit: 500 });
}

export async function dashboard(user) {
  const businessDate = (
    await query("SELECT to_char(current_business_date(), 'YYYY-MM-DD') AS d")
  ).rows[0].d;
  const cashierOnly = user.role === 'CASHIER';
  const report = await dailyReport({ from: businessDate, to: businessDate, user });
  const recent = await query(
    `WITH agg AS (
       SELECT s.*,
         (SELECT COALESCE(sum(quantity), 0) FROM sale_items si WHERE si.sale_id = s.id) AS total_qty,
         (SELECT COALESCE(sum(sri.quantity), 0)
            FROM sale_return_items sri JOIN sale_items si ON si.id = sri.sale_item_id
           WHERE si.sale_id = s.id) AS returned_qty
       FROM sales s
       WHERE s.business_date = $1 AND ($2::bigint IS NULL OR s.cashier_id = $2)
     )
     SELECT *, CASE
         WHEN status = 'VOIDED' THEN 'VOIDED'
         WHEN returned_qty >= total_qty AND returned_qty > 0 THEN 'RETURNED'
         WHEN returned_qty > 0 THEN 'PARTIALLY_RETURNED'
         ELSE 'COMPLETED'
       END AS derived_status
     FROM agg ORDER BY created_at DESC, id DESC LIMIT 6`,
    [businessDate, cashierOnly ? user.id : null],
  );
  const low = await query(
    `SELECT p.*, c.name AS category_name FROM products p JOIN categories c ON c.id = p.category_id
      WHERE p.active AND p.stock_on_hand <= p.reorder_level
      ORDER BY (p.stock_on_hand::numeric / GREATEST(p.reorder_level, 1)) ASC, lower(p.name) LIMIT 6`,
  );
  const lowTotal = await query(
    'SELECT count(*)::int AS n FROM products WHERE active AND stock_on_hand <= reorder_level',
  );
  return {
    businessDate,
    scopeLabel: cashierOnly ? `My sales — ${user.displayName}` : 'Shop-wide view',
    transactionCount: report.transactionCount,
    totalCents: report.collectedCents,
    salesCents: report.netExTaxCents,
    discountsCents: report.discountsCents,
    taxCents: report.taxCents,
    refundsCents: report.refundsCents,
    returnsCount: report.returnsCount,
    voidCount: report.voidCount,
    averageSaleCents: report.averageSaleCents,
    recentSales: recent.rows.map((row) => ({
      id: String(row.id),
      number: row.number,
      createdAt: new Date(row.created_at).toISOString(),
      cashierName: row.cashier_name,
      totalCents: Number(row.total_cents),
      status: row.derived_status,
    })),
    lowStock: low.rows.map((row) =>
      productDto(row, { includeCost: !cashierOnly, categoryName: row.category_name }),
    ),
    lowStockCount: lowTotal.rows[0].n,
  };
}

export async function lowStockCount() {
  const { rows } = await query(
    'SELECT count(*)::int AS n FROM products WHERE active AND stock_on_hand <= reorder_level',
  );
  return rows[0].n;
}
