/**
 * Demo copy of server/lib/money.js.
 *
 * Integer-cent money helpers. Formulas mirror REQUIREMENTS.md POS-005/POS-006
 * so the in-browser demo computes exactly what the real server computes.
 * Keep this file in sync with server/lib/money.js (scripts/build-demo.mjs
 * copies the real one over this file on every build).
 */

export function divRoundHalfUp(numerator, denominator) {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0 || numerator < 0) {
    throw new Error('divRoundHalfUp requires non-negative safe integers and a positive denominator');
  }
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

export function assertCents(value, name = 'amount') {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer number of cents`);
  }
  return value;
}

export function calculateLine({ unitPriceCents, quantity, discountBps = 0, taxRateBps = 0, taxInclusive = false }) {
  assertCents(unitPriceCents, 'unitPriceCents');
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error('quantity must be a positive integer');
  if (!Number.isInteger(discountBps) || discountBps < 0 || discountBps > 10000) {
    throw new Error('discountBps must be 0..10000');
  }
  if (!Number.isInteger(taxRateBps) || taxRateBps < 0 || taxRateBps > 10000) {
    throw new Error('taxRateBps must be 0..10000');
  }
  const subtotalCents = unitPriceCents * quantity;
  if (!Number.isSafeInteger(subtotalCents)) throw new Error('line subtotal exceeds safe integer range');
  const discountCents = divRoundHalfUp(subtotalCents * discountBps, 10000);
  const netCents = subtotalCents - discountCents;
  const taxCents = taxInclusive
    ? divRoundHalfUp(netCents * taxRateBps, 10000 + taxRateBps)
    : divRoundHalfUp(netCents * taxRateBps, 10000);
  const totalCents = taxInclusive ? netCents : netCents + taxCents;
  const revenueExTaxCents = taxInclusive ? netCents - taxCents : netCents;
  return {
    unitPriceCents,
    quantity,
    discountBps,
    subtotalCents,
    discountCents,
    netCents,
    taxCents,
    totalCents,
    revenueExTaxCents,
  };
}

export function calculateTotals(lines, settings = {}) {
  const taxRateBps = settings.taxEnabled ? Number(settings.taxRateBps) || 0 : 0;
  const taxInclusive = Boolean(settings.taxInclusive);
  return lines.reduce(
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
}

/** Value removed from stock at the current weighted-average cost. */
export function costValueFor(stockValueCents, stockOnHand, quantity) {
  if (stockOnHand <= 0 || stockValueCents <= 0) return 0;
  const qty = Math.min(quantity, stockOnHand);
  if (qty >= stockOnHand) return stockValueCents;
  return Math.min(stockValueCents, divRoundHalfUp(stockValueCents * qty, stockOnHand));
}

/**
 * Deterministic cost restoration for a partial return of a sale line.
 * `previouslyReturnedQty`/`Cost` cover earlier returns of the same line.
 */
export function restoredCostValue(saleItem, previouslyReturnedQty, previouslyReturnedCost, quantity) {
  const totalQty = saleItem.quantity;
  const nextQty = previouslyReturnedQty + quantity;
  if (nextQty > totalQty) throw new Error('Return quantity exceeds the original line');
  if (nextQty === totalQty) return Math.max(0, saleItem.costValueCents - previouslyReturnedCost);
  const target = divRoundHalfUp(saleItem.costValueCents * nextQty, totalQty);
  return Math.max(0, target - previouslyReturnedCost);
}

/** Deterministic refund split for a partially returned sale line. */
export function refundFor(saleItem, previouslyReturnedQty, previouslyRefundedCents, quantity, field = 'totalCents') {
  const totalQty = saleItem.quantity;
  const nextQty = previouslyReturnedQty + quantity;
  if (nextQty > totalQty) throw new Error('Return quantity exceeds the original line');
  const original = saleItem[field];
  if (nextQty === totalQty) return Math.max(0, original - previouslyRefundedCents);
  const target = divRoundHalfUp(original * nextQty, totalQty);
  return Math.max(0, target - previouslyRefundedCents);
}

export function wacFor(product) {
  if (!product?.stockOnHand) return 0;
  return divRoundHalfUp(product.stockValueCents, product.stockOnHand);
}
