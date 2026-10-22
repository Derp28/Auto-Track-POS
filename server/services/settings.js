import { query, withTransaction } from '../db.js';
import { settingsDto } from '../lib/dto.js';
import { badRequest, notFound } from '../lib/errors.js';
import { logAudit } from '../lib/ledger.js';
import { boolean, integer, text, email, oneOf, asObject } from '../lib/validation.js';

export async function getSettings(client = null) {
  const runner = client || { query };
  const { rows } = await runner.query('SELECT * FROM settings WHERE id = 1');
  if (!rows[0]) throw notFound('Shop settings are not initialized.');
  return rows[0];
}

export async function getSettingsDto() {
  return settingsDto(await getSettings());
}

function validTimeZone(zone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export async function updateSettings(body, actor) {
  const input = asObject(body);
  const shopName = text(input.shopName, 'shopName', { max: 120 });
  const address = text(input.address, 'address', { optional: true, max: 300 });
  const phone = text(input.phone, 'phone', { optional: true, max: 40 });
  const emailAddress = email(input.email, 'email', { optional: true });
  const tin = text(input.tin, 'tin', { optional: true, max: 40 });
  const currency = text(input.currency, 'currency', { min: 3, max: 3 }).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw badRequest('Currency must be a 3-letter ISO code.', 'VALIDATION_ERROR', { currency: 'Use a 3-letter code.' });
  const timezone = text(input.timezone, 'timezone', { max: 80 });
  if (!validTimeZone(timezone)) {
    throw badRequest('Timezone must be a valid IANA name such as Asia/Manila.', 'VALIDATION_ERROR', { timezone: 'Invalid timezone.' });
  }
  const cutoff = text(input.businessDayCutoff, 'businessDayCutoff', { min: 5, max: 5 });
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(cutoff)) {
    throw badRequest('Business day cutoff must be HH:MM (24-hour).', 'VALIDATION_ERROR', { businessDayCutoff: 'Use HH:MM.' });
  }
  const receiptHeader = text(input.receiptHeader, 'receiptHeader', { optional: true, max: 200 });
  const receiptFooter = text(input.receiptFooter, 'receiptFooter', { optional: true, max: 200 });
  const receiptWidth = oneOf(input.receiptWidth, 'receiptWidth', ['58mm', '80mm']);
  const returnsPolicy = text(input.returnsPolicy, 'returnsPolicy', { optional: true, max: 500 });
  const taxEnabled = boolean(input.taxEnabled, 'taxEnabled');
  const taxRateBps = integer(input.taxRateBps, 'taxRateBps', { min: 0, max: 10000 });
  const taxInclusive = boolean(input.taxInclusive, 'taxInclusive');
  const cashierDiscountLimitBps = integer(input.cashierDiscountLimitBps, 'cashierDiscountLimitBps', { min: 0, max: 10000 });
  const discountReasonRequired = boolean(input.discountReasonRequired, 'discountReasonRequired');
  const maxLineQuantity = integer(input.maxLineQuantity, 'maxLineQuantity', { min: 1, max: 9999 });
  if (input.allowNegativeStock === true) {
    throw badRequest('Negative stock is not supported.', 'NEGATIVE_STOCK_FORBIDDEN', { allowNegativeStock: 'Not supported.' });
  }
  return withTransaction(async (client) => {
    const before = await getSettings(client);
    const { rows } = await client.query(
      `UPDATE settings SET
         shop_name = $1, address = $2, phone = $3, email = $4, tin = $5, currency = $6,
         timezone = $7, business_day_cutoff = $8::time, receipt_header = $9, receipt_footer = $10,
         receipt_width = $11, returns_policy = $12, tax_enabled = $13, tax_rate_bps = $14,
         tax_inclusive = $15, cashier_discount_limit_bps = $16, discount_reason_required = $17,
         max_line_quantity = $18, updated_at = now(), updated_by = $19
       WHERE id = 1 RETURNING *`,
      [
        shopName, address, phone, emailAddress, tin, currency, timezone, cutoff,
        receiptHeader, receiptFooter, receiptWidth, returnsPolicy, taxEnabled, taxRateBps,
        taxInclusive, cashierDiscountLimitBps, discountReasonRequired, maxLineQuantity, actor.id,
      ],
    );
    const changed = Object.keys(settingsDto(rows[0])).filter(
      (key) => JSON.stringify(settingsDto(rows[0])[key]) !== JSON.stringify(settingsDto(before)[key]),
    );
    await logAudit(client, {
      actorId: actor.id,
      action: 'SETTINGS_UPDATED',
      entityType: 'settings',
      entityId: 1,
      details: { changed, taxEnabled, taxRateBps, taxInclusive },
    });
    return settingsDto(rows[0]);
  });
}
