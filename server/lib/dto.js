import { wacFor } from './money.js';

export function num(value) {
  return value === null || value === undefined ? 0 : Number(value);
}

export function id(value) {
  return value === null || value === undefined ? null : String(value);
}

export function ts(value) {
  return value ? new Date(value).toISOString() : null;
}

export function dateString(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function settingsDto(row) {
  return {
    id: 'settings-1',
    shopName: row.shop_name,
    address: row.address,
    phone: row.phone,
    email: row.email,
    tin: row.tin,
    currency: row.currency.trim(),
    timezone: row.timezone,
    businessDayCutoff: String(row.business_day_cutoff).slice(0, 5),
    receiptHeader: row.receipt_header,
    receiptFooter: row.receipt_footer,
    receiptWidth: row.receipt_width,
    returnsPolicy: row.returns_policy,
    taxEnabled: row.tax_enabled,
    taxRateBps: num(row.tax_rate_bps),
    taxInclusive: row.tax_inclusive,
    cashierDiscountLimitBps: num(row.cashier_discount_limit_bps),
    discountReasonRequired: row.discount_reason_required,
    maxLineQuantity: num(row.max_line_quantity),
    allowNegativeStock: false,
    lowStockOnlyActive: true,
    updatedAt: ts(row.updated_at),
  };
}

export function userDto(row) {
  return {
    id: id(row.id),
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    active: row.active,
    mustChangePassword: row.must_change_password,
    lastLoginAt: ts(row.last_login_at),
    createdAt: ts(row.created_at),
    updatedAt: ts(row.updated_at),
    deactivatedAt: ts(row.deactivated_at),
  };
}

export function categoryDto(row) {
  return {
    id: id(row.id),
    name: row.name,
    description: row.description,
    active: row.active,
    createdAt: ts(row.created_at),
    updatedAt: ts(row.updated_at),
  };
}

export function supplierDto(row) {
  return {
    id: id(row.id),
    name: row.name,
    contactName: row.contact_name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    notes: row.notes,
    active: row.active,
    createdAt: ts(row.created_at),
    updatedAt: ts(row.updated_at),
  };
}

export function productDto(row, { includeCost = true, categoryName = null } = {}) {
  const base = {
    id: id(row.id),
    sku: row.sku,
    barcode: row.barcode || '',
    name: row.name,
    description: row.description,
    categoryId: id(row.category_id),
    categoryName: categoryName ?? row.category_name ?? null,
    priceCents: num(row.price_cents),
    stockOnHand: num(row.stock_on_hand),
    reorderLevel: num(row.reorder_level),
    active: row.active,
    lowStock: row.stock_on_hand <= row.reorder_level,
    createdAt: ts(row.created_at),
    updatedAt: ts(row.updated_at),
  };
  if (includeCost) {
    base.costCents = num(row.cost_cents);
    base.stockValueCents = num(row.stock_value_cents);
    base.wacCents = wacFor({ stockOnHand: num(row.stock_on_hand), stockValueCents: num(row.stock_value_cents) });
  }
  return base;
}

export function movementDto(row) {
  return {
    id: id(row.id),
    productId: id(row.product_id),
    productName: row.product_name || null,
    sku: row.sku || null,
    type: row.movement_type,
    quantityDelta: num(row.quantity_delta),
    stockBefore: num(row.stock_before),
    stockAfter: num(row.stock_after),
    valueDeltaCents: num(row.value_delta_cents),
    valueBeforeCents: num(row.value_before_cents),
    valueAfterCents: num(row.value_after_cents),
    businessDate: dateString(row.business_date),
    reference: row.reference_number || row.reference_id || '',
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    reason: row.reason,
    actorId: id(row.actor_id),
    occurredAt: ts(row.created_at),
  };
}

export function paymentDto(row) {
  return {
    id: id(row.id),
    method: row.method,
    amountCents: num(row.amount_cents),
    tenderedCents: num(row.tendered_cents),
    changeCents: num(row.change_cents),
    reference: row.reference,
    createdAt: ts(row.created_at),
  };
}

export function returnDto(row, items) {
  return {
    id: id(row.id),
    number: row.number,
    saleId: id(row.sale_id),
    saleNumber: row.sale_number,
    createdAt: ts(row.created_at),
    businessDate: dateString(row.business_date),
    reason: row.reason,
    refundMethod: row.refund_method || 'CASH',
    cashierId: id(row.created_by),
    approvedBy: id(row.approved_by),
    items,
    refundCents: num(row.total_cents),
    taxCents: num(row.tax_cents),
    revenueExTaxCents: num(row.total_cents) - num(row.tax_cents),
    costValueCents: num(row.cost_value_cents),
  };
}

export function voidDto(row) {
  if (!row) return null;
  return {
    id: id(row.id),
    number: row.number,
    reason: row.reason,
    createdAt: ts(row.created_at),
    voidedBy: id(row.created_by),
    approvedBy: id(row.approved_by),
    restocked: true,
    totalCents: num(row.total_cents),
  };
}

export function saleDto(row, { items = [], payments = [], returns = [], void: voidRow = null, includeCost = true } = {}) {
  const itemDtos = items.map((item) => {
    const returnedQuantity = num(item.returned_quantity);
    return {
      id: id(item.id),
      productId: id(item.product_id),
      sku: item.sku,
      barcode: item.barcode || '',
      name: item.name,
      unitPriceCents: num(item.unit_price_cents),
      ...(includeCost ? { unitCostCents: num(item.unit_cost_cents), costValueCents: num(item.cost_value_cents) } : {}),
      quantity: num(item.quantity),
      discountBps: num(item.discount_bps),
      discountReason: item.discount_reason,
      discountApprovedBy: id(item.discount_approved_by),
      note: item.note,
      subtotalCents: num(item.subtotal_cents),
      discountCents: num(item.discount_cents),
      netCents: num(item.net_cents),
      taxCents: num(item.tax_cents),
      totalCents: num(item.total_cents),
      revenueExTaxCents: row.tax_inclusive
        ? num(item.net_cents) - num(item.tax_cents)
        : num(item.net_cents),
      returnedQuantity,
    };
  });
  const totalQty = itemDtos.reduce((sum, item) => sum + item.quantity, 0);
  const returnedQty = itemDtos.reduce((sum, item) => sum + item.returnedQuantity, 0);
  let status = row.status;
  if (row.status !== 'VOIDED' && returns.length > 0) {
    status = returnedQty >= totalQty ? 'RETURNED' : 'PARTIALLY_RETURNED';
  }
  const refundedCents = returns.reduce((sum, entry) => sum + entry.refundCents, 0);
  return {
    id: id(row.id),
    number: row.number,
    createdAt: ts(row.created_at),
    businessDate: dateString(row.business_date),
    cashierId: id(row.cashier_id),
    cashierName: row.cashier_name,
    terminal: row.terminal_label,
    status,
    note: row.note,
    subtotalCents: num(row.subtotal_cents),
    discountCents: num(row.discount_cents),
    netCents: num(row.net_cents),
    taxCents: num(row.tax_cents),
    totalCents: num(row.total_cents),
    grossCents: num(row.net_cents),
    revenueExTaxCents: num(row.net_cents) - (row.tax_inclusive ? num(row.tax_cents) : 0),
    taxRateBps: num(row.tax_rate_bps),
    taxInclusive: row.tax_inclusive,
    currency: row.currency ? row.currency.trim() : 'PHP',
    items: itemDtos,
    payments: payments.map(paymentDto),
    returns,
    void: voidDto(voidRow),
    returnedCents: refundedCents,
    returnedQuantityByLine: Object.fromEntries(itemDtos.map((item) => [item.id, item.returnedQuantity])),
    refundedByLine: Object.fromEntries(
      itemDtos.map((item) => [
        item.id,
        returns.flatMap((entry) => entry.items).filter((line) => line.saleItemId === item.id).reduce((sum, line) => sum + line.refundCents, 0),
      ]),
    ),
  };
}

export function saleItemDto(row) {
  return {
    id: id(row.id),
    productId: id(row.product_id),
    sku: row.sku,
    name: row.name,
    quantity: num(row.quantity),
    unitCostCents: num(row.unit_cost_cents),
  };
}

export function purchaseOrderDto(row, { lines = [], receipts = [], supplier = null } = {}) {
  const lineDtos = lines.map((line) => ({
    id: id(line.id),
    productId: id(line.product_id),
    sku: line.sku,
    name: line.name,
    unit: 'pc',
    orderedQty: num(line.ordered_qty),
    receivedQty: num(line.received_qty),
    unitCostCents: num(line.unit_cost_cents),
    orderedTotalCents: num(line.ordered_total_cents),
    receivedTotalCents: num(line.received_total_cents),
  }));
  return {
    id: id(row.id),
    number: row.number,
    supplierId: id(row.supplier_id),
    supplierName: supplier?.name || row.supplier_name || 'Unknown supplier',
    supplier,
    status: row.status,
    createdAt: ts(row.created_at),
    updatedAt: ts(row.updated_at),
    orderedAt: ts(row.ordered_at),
    expectedAt: dateString(row.expected_at),
    receivedAt: ts(row.received_at),
    closedAt: ts(row.closed_at),
    createdBy: id(row.created_by),
    createdByName: row.created_by_name || null,
    lines: lineDtos,
    notes: row.notes,
    receipts,
    cancelReason: row.cancel_reason || '',
    shortCloseReason: row.close_reason || '',
    orderedTotalCents: num(row.ordered_total_cents),
    receivedTotalCents: num(row.received_total_cents),
    progress: num(row.ordered_total_cents)
      ? Math.round((num(row.received_total_cents) / num(row.ordered_total_cents)) * 100)
      : 0,
  };
}
