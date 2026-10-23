/**
 * Money helpers shared with the server's integer-cent rules.
 * All amounts are integer cents. Formulas mirror REQUIREMENTS.md POS-005/POS-006.
 * This module is pure so it can be checked in Node without a browser.
 */

export function divRoundHalfUp(numerator, denominator) {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || denominator <= 0) {
    throw new Error('divRoundHalfUp requires positive integer arguments');
  }
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

export function calculateLine({
  unitPriceCents,
  quantity,
  discountBps = 0,
  taxRateBps = 0,
  taxInclusive = false,
}) {
  const safeQty = Number.isInteger(quantity) ? quantity : 0;
  const subtotal = unitPriceCents * safeQty;
  const discount = divRoundHalfUp(subtotal * discountBps, 10000);
  const net = subtotal - discount;
  const rate = taxRateBps > 0 ? taxRateBps : 0;
  const tax = taxInclusive
    ? divRoundHalfUp(net * rate, 10000 + rate)
    : divRoundHalfUp(net * rate, 10000);
  const total = taxInclusive ? net : net + tax;
  const revenueExTax = taxInclusive ? net - tax : net;
  return {
    unitPriceCents,
    quantity: safeQty,
    discountBps,
    subtotalCents: subtotal,
    discountCents: discount,
    netCents: net,
    taxCents: tax,
    totalCents: total,
    revenueExTaxCents: revenueExTax,
  };
}

export function calculateTotals(lines, settings = {}) {
  const taxRateBps = settings.taxEnabled ? Number(settings.taxRateBps) || 0 : 0;
  const taxInclusive = Boolean(settings.taxInclusive);
  const totals = lines.reduce(
    (acc, line) => {
      const calculated = calculateLine({
        unitPriceCents: line.unitPriceCents,
        quantity: line.quantity,
        discountBps: line.discountBps || 0,
        taxRateBps,
        taxInclusive,
      });
      acc.subtotalCents += calculated.subtotalCents;
      acc.discountCents += calculated.discountCents;
      acc.netCents += calculated.netCents;
      acc.taxCents += calculated.taxCents;
      acc.totalCents += calculated.totalCents;
      acc.revenueExTaxCents += calculated.revenueExTaxCents;
      return acc;
    },
    {
      subtotalCents: 0,
      discountCents: 0,
      netCents: 0,
      taxCents: 0,
      totalCents: 0,
      revenueExTaxCents: 0,
      taxRateBps,
      taxInclusive,
    },
  );
  return totals;
}

export function parseAmountToCents(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null;
    if (Math.abs(value * 100 - Math.round(value * 100)) > 1e-7) return null;
    return Math.round(value * 100);
  }
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ''] = cleaned.split('.');
  if (fraction.length > 2) return null;
  return Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
}

export function formatMoney(cents, currency = 'PHP') {
  const amount = (Number(cents) || 0) / 100;
  try {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: currency || 'PHP',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `PHP ${amount.toFixed(2)}`;
  }
}

export function formatPercentFromBps(bps) {
  return `${((Number(bps) || 0) / 100).toFixed(2)}%`;
}

export function formatDateTime(iso, timeZone = 'Asia/Manila') {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return new Intl.DateTimeFormat('en-PH', {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatDate(iso, timeZone = 'Asia/Manila') {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return new Intl.DateTimeFormat('en-PH', {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(date);
}

export function isoDateInZone(date = new Date(), timeZone = 'Asia/Manila') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
