import { query } from '../db.js';
import { dateString } from '../lib/dto.js';
import { expenseTotals, listExpenses } from './expenses.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseDate(value) {
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  return { year, month, day };
}

function pad(value) {
  return String(value).padStart(2, '0');
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
  return {
    from,
    to: businessDate,
    label: formatRange(from, businessDate),
    year: date.year,
    month: date.month,
    day: date.day,
  };
}

function previousMonthWindow(businessDate) {
  const current = parseDate(businessDate);
  const previous = addMonths(current.year, current.month, -1);
  const previousDay = Math.min(current.day, daysInMonth(previous.year, previous.month));
  const from = calendarDate(previous.year, previous.month, 1);
  const to = calendarDate(previous.year, previous.month, previousDay);
  return { from, to, label: formatRange(from, to) };
}

function yearWindow(businessDate) {
  const current = parseDate(businessDate);
  const from = calendarDate(current.year, 1, 1);
  return {
    from,
    to: businessDate,
    label: formatRange(from, businessDate),
    year: current.year,
    month: current.month,
    day: current.day,
  };
}

function previousYearWindow(businessDate) {
  const current = parseDate(businessDate);
  const previousYear = current.year - 1;
  const previousDay = Math.min(current.day, daysInMonth(previousYear, current.month));
  const from = calendarDate(previousYear, 1, 1);
  const to = calendarDate(previousYear, current.month, previousDay);
  return { from, to, label: formatRange(from, to) };
}

async function periodNetCents({ from, to }) {
  const { rows } = await query(
    `SELECT
       COALESCE((SELECT SUM(total_cents - tax_cents)
                   FROM sales
                  WHERE business_date >= $1 AND business_date <= $2 AND status <> 'VOIDED'), 0)
       - COALESCE((SELECT SUM(total_cents - tax_cents)
                     FROM sale_returns
                    WHERE business_date >= $1 AND business_date <= $2), 0) AS net_cents`,
    [from, to],
  );
  return Number(rows[0].net_cents);
}

function percentage(value, total) {
  if (!total) return 0;
  return Math.round((value / total) * 1000) / 10;
}

function changePercentage(current, previous) {
  if (!previous) return current ? null : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
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

async function trendValues(points, mode) {
  if (!points.length) return [];
  const from = points[0].from;
  const to = points[points.length - 1].to;
  const bucket = mode === 'yearly' ? '%Y' : '%Y-%m';
  const { rows } = await query(
    `SELECT bucket, SUM(net_cents) AS net_cents
       FROM (
         SELECT DATE_FORMAT(business_date, '${bucket}') AS bucket,
                total_cents - tax_cents AS net_cents
           FROM sales
          WHERE business_date >= $1 AND business_date <= $2 AND status <> 'VOIDED'
         UNION ALL
         SELECT DATE_FORMAT(business_date, '${bucket}') AS bucket,
                -(total_cents - tax_cents) AS net_cents
           FROM sale_returns
          WHERE business_date >= $1 AND business_date <= $2
       ) AS buckets
      GROUP BY bucket`,
    [from, to],
  );
  const values = new Map(rows.map((row) => [String(row.bucket), Number(row.net_cents)]));
  return points.map((point) => ({
    ...point,
    valueCents: values.get(point.key) || 0,
    sharePct: 0,
  }));
}

async function topProductInsights({ from, to, totalCents }) {
  if (!totalCents) {
    return { totalCents: 0, leading: null, items: [], otherCents: 0, otherSharePct: 0 };
  }
  const { rows } = await query(
    `SELECT p.id AS product_id, p.sku, p.name, c.name AS category_name,
            SUM(line_data.quantity) AS quantity, SUM(line_data.net_cents) AS net_cents
       FROM (
         SELECT si.product_id, si.quantity, si.total_cents - si.tax_cents AS net_cents
           FROM sale_items si
           JOIN sales s ON s.id = si.sale_id
          WHERE s.business_date >= $1 AND s.business_date <= $2 AND s.status <> 'VOIDED'
         UNION ALL
         SELECT si.product_id, -sri.quantity, -(sri.refund_cents - sri.tax_cents) AS net_cents
           FROM sale_return_items sri
           JOIN sale_returns r ON r.id = sri.return_id
           JOIN sale_items si ON si.id = sri.sale_item_id
          WHERE r.business_date >= $1 AND r.business_date <= $2
       ) AS line_data
       JOIN products p ON p.id = line_data.product_id
       JOIN categories c ON c.id = p.category_id
      GROUP BY p.id, p.sku, p.name, c.name
     HAVING SUM(line_data.net_cents) > 0
      ORDER BY net_cents DESC
      LIMIT 5`,
    [from, to],
  );
  const items = rows.map((row) => {
    const netCents = Number(row.net_cents);
    return {
      productId: String(row.product_id),
      sku: row.sku,
      name: row.name,
      categoryName: row.category_name,
      quantity: Number(row.quantity),
      netCents,
      sharePct: percentage(netCents, totalCents),
    };
  });
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

async function purchaseOrderInsights({ from, to }) {
  const [summary, receipts] = await Promise.all([
    query(
      `SELECT COALESCE(SUM(total_cents), 0) AS total_cents, COUNT(*) AS receipt_count
         FROM po_receipts
        WHERE COALESCE(business_date, DATE(created_at)) >= $1
          AND COALESCE(business_date, DATE(created_at)) <= $2`,
      [from, to],
    ),
    query(
      `SELECT r.id, r.number, COALESCE(r.business_date, DATE(r.created_at)) AS receipt_date,
              r.total_cents, po.number AS po_number, s.name AS supplier_name
         FROM po_receipts r
         JOIN purchase_orders po ON po.id = r.purchase_order_id
         JOIN suppliers s ON s.id = po.supplier_id
        WHERE COALESCE(r.business_date, DATE(r.created_at)) >= $1
          AND COALESCE(r.business_date, DATE(r.created_at)) <= $2
        ORDER BY receipt_date DESC, r.id DESC
        LIMIT 5`,
      [from, to],
    ),
  ]);
  return {
    totalCents: Number(summary.rows[0].total_cents),
    count: Number(summary.rows[0].receipt_count),
    receipts: receipts.rows.map((row) => ({
      id: String(row.id),
      number: row.number,
      receiptDate: dateString(row.receipt_date),
      totalCents: Number(row.total_cents),
      purchaseOrderNumber: row.po_number,
      supplierName: row.supplier_name,
    })),
  };
}

export async function buildDashboardInsights({ businessDate }) {
  const currentMonth = monthWindow(businessDate);
  const previousMonth = previousMonthWindow(businessDate);
  const currentYear = yearWindow(businessDate);
  const previousYear = previousYearWindow(businessDate);

  const [settings, monthNet, previousMonthNet, yearNet, previousYearNet] = await Promise.all([
    query('SELECT monthly_sales_target_cents, sales_comparison_mode FROM settings WHERE id = 1'),
    periodNetCents(currentMonth),
    periodNetCents(previousMonth),
    periodNetCents(currentYear),
    periodNetCents(previousYear),
  ]);
  const mode = settings.rows[0]?.sales_comparison_mode === 'yearly' ? 'yearly' : 'monthly';
  const targetCents = Number(settings.rows[0]?.monthly_sales_target_cents || 0);
  const currentWindow = mode === 'yearly' ? currentYear : currentMonth;
  const previousWindow = mode === 'yearly' ? previousYear : previousMonth;
  const currentNet = mode === 'yearly' ? yearNet : monthNet;
  const previousNet = mode === 'yearly' ? previousYearNet : previousMonthNet;

  const series = trendSeries(mode, businessDate);
  const [
    trendPoints,
    topProducts,
    manualTotals,
    manualExpenses,
    purchaseOrders,
    previousManualTotals,
    previousPurchaseOrders,
  ] = await Promise.all([
    trendValues(series, mode),
    topProductInsights({ from: currentMonth.from, to: currentMonth.to, totalCents: monthNet }),
    expenseTotals({ from: currentMonth.from, to: currentMonth.to }),
    listExpenses({ from: currentMonth.from, to: currentMonth.to, limit: 5 }),
    purchaseOrderInsights({ from: currentMonth.from, to: currentMonth.to }),
    expenseTotals({ from: previousMonth.from, to: previousMonth.to }),
    purchaseOrderInsights({ from: previousMonth.from, to: previousMonth.to }),
  ]);

  const elapsedDays = currentMonth.day;
  const totalDays = daysInMonth(currentMonth.year, currentMonth.month);
  const expectedProgressPct = Math.round((elapsedDays / totalDays) * 1000) / 10;
  const rawProgressPct = targetCents ? Math.round((monthNet / targetCents) * 1000) / 10 : null;
  const progressPct = rawProgressPct === null ? null : Math.max(0, rawProgressPct);
  const targetSet = targetCents > 0;
  const paceDeltaPct = targetSet ? Math.round((progressPct - expectedProgressPct) * 10) / 10 : null;
  const changePct = changePercentage(currentNet, previousNet);
  const totalOutflowsCents = manualTotals.totalCents + purchaseOrders.totalCents;
  const previousTotalOutflowsCents = previousManualTotals.totalCents + previousPurchaseOrders.totalCents;
  const expenseChangePct = changePercentage(totalOutflowsCents, previousTotalOutflowsCents);

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
    monthComparison: {
      currentCents: monthNet,
      previousCents: previousMonthNet,
      changeCents: monthNet - previousMonthNet,
      changePct: changePercentage(monthNet, previousMonthNet),
      periodLabel: 'vs same period last month',
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
      previousTotalCents: previousTotalOutflowsCents,
      changeCents: totalOutflowsCents - previousTotalOutflowsCents,
      changePct: expenseChangePct,
      comparisonLabel: 'vs same period last month',
      salesAfterOutflowsCents: monthNet - totalOutflowsCents,
      manual: manualExpenses,
      purchaseReceipts: purchaseOrders.receipts,
    },
  };
}
