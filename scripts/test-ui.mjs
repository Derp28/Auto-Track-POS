#!/usr/bin/env node
/**
 * Stage 2 client-logic checks. Browser rendering and API integration are covered
 * by tests/browser.test.mjs; this script checks the pure money, permission,
 * cart, and validation rules without touching the database.
 */
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const publicDir = join(root, 'public');

globalThis.document = {
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  removeEventListener() {},
};
globalThis.location = { hash: '#/login', href: 'http://127.0.0.1/', pathname: '/', search: '' };
globalThis.window = globalThis;
globalThis.history = { state: null, pushState() {}, replaceState() {} };

const load = (relativePath) => import(pathToFileURL(join(publicDir, relativePath)).href);

const failures = [];
let assertionCount = 0;
function check(name, condition, detail = '') {
  assertionCount += 1;
  if (!condition) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${!condition && detail ? ` — ${detail}` : ''}`);
}
function equal(name, actual, expected) {
  check(name, actual === expected, `expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
}
function throwsWithCode(name, fn, code) {
  try {
    fn();
    check(name, false, 'no error was thrown');
  } catch (error) {
    check(name, error.code === code, `expected code ${code}, received ${error.code || error.message}`);
  }
}

const money = await load('js/money.js');
const { calculateLine, calculateTotals, divRoundHalfUp, parseAmountToCents, formatMoney } = money;
const { createAppState } = await load('js/state.js');
const { can, canAccessPath, roleLabel, canApplyDiscount } = await load('js/permissions.js');
const { renderLogin } = await load('views/login.js');

console.log('--- money helpers ---');
equal('divRoundHalfUp rounds 5/2 up to 3', divRoundHalfUp(5, 2), 3);
equal('divRoundHalfUp rounds 1/2 up to 1', divRoundHalfUp(1, 2), 1);
equal('parseAmountToCents parses 123.45', parseAmountToCents('123.45'), 12345);
equal('parseAmountToCents parses grouped 1,234.5', parseAmountToCents('1,234.5'), 123450);
equal('parseAmountToCents rejects three decimals', parseAmountToCents('1.234'), null);
equal('parseAmountToCents rejects text', parseAmountToCents('abc'), null);
equal('parseAmountToCents rejects negatives', parseAmountToCents(-1), null);
check('formatMoney renders a PHP amount', formatMoney(12345).includes('123.45'), formatMoney(12345));

const line = calculateLine({ unitPriceCents: 10000, quantity: 3, discountBps: 1000 });
equal('line discount is 10% of subtotal', line.discountCents, 3000);
equal('line net is subtotal minus discount', line.netCents, 27000);
equal('tax-disabled line total equals net', line.totalCents, 27000);
const exclusive = calculateLine({ unitPriceCents: 10000, quantity: 3, discountBps: 1000, taxRateBps: 1200, taxInclusive: false });
equal('exclusive tax is added to net', exclusive.taxCents, 3240);
equal('exclusive total includes tax', exclusive.totalCents, 30240);
const inclusive = calculateLine({ unitPriceCents: 10000, quantity: 3, discountBps: 1000, taxRateBps: 1200, taxInclusive: true });
equal('inclusive tax is extracted from net', inclusive.taxCents, divRoundHalfUp(27000 * 1200, 11200));
equal('inclusive total equals net', inclusive.totalCents, 27000);
equal('inclusive revenue excludes tax', inclusive.revenueExTaxCents, inclusive.netCents - inclusive.taxCents);
const totals = calculateTotals([{ unitPriceCents: 10000, quantity: 3, discountBps: 1000 }], { taxEnabled: false, taxRateBps: 0 });
equal('totals roll up integer cents', totals.totalCents, 27000);
check('totals are integers', Number.isInteger(totals.totalCents) && Number.isInteger(totals.discountCents));

const admin = { id: '1', username: 'owner', displayName: 'Owner Admin', role: 'ADMIN', active: true };
const cashier = { id: '2', username: 'cashier', displayName: 'Cashier One', role: 'CASHIER', active: true };
const product = {
  id: 'p1', sku: 'FILTER-1', name: 'Oil Filter', categoryId: 'c1', active: true,
  priceCents: 10000, costCents: 6000, stockOnHand: 5, stockValueCents: 30000,
  reorderLevel: 1, barcode: '',
};
const store = {
  meta: { defaultTerminal: 'Counter 1' },
  settings: {
    currency: 'PHP', taxEnabled: false, taxRateBps: 0, taxInclusive: false,
    cashierDiscountLimitBps: 500, discountReasonRequired: true, maxLineQuantity: 999,
  },
  categories: [{ id: 'c1', name: 'Engine Parts', active: true }],
  products: [product],
  users: [admin, cashier],
};

console.log('\n--- cart and permission rules ---');
const state = createAppState(store);
state.hydrate(admin);
equal('admin hydrates from the server user list', state.currentUser.id, '1');
state.addProduct(product.id, 2);
equal('cart quantity tracks the added line', state.cartQuantity(), 2);
equal('cart totals use the line helper', state.cartTotals().totalCents, 20000);
state.setLineNote(product.id, 'Customer will collect later');
equal('line note is kept for the sale request', state.cart[0].note, 'Customer will collect later');
throwsWithCode('line quantity cannot exceed available stock', () => state.setQuantity(product.id, 6), 'INSUFFICIENT_STOCK');
throwsWithCode('quantity must be a whole number', () => state.setQuantity(product.id, 1.5), 'INVALID_QUANTITY');
state.setLineDiscount(product.id, 1000, 'Promotional discount');
equal('admin discount above the cashier limit is allowed', state.cart[0].discountBps, 1000);
throwsWithCode('discount requires a reason when configured', () => state.setLineDiscount(product.id, 500, ''), 'DISCOUNT_REASON_REQUIRED');
throwsWithCode('discount above 100 percent is rejected', () => state.setLineDiscount(product.id, 10001, 'invalid'), 'INVALID_DISCOUNT');
throwsWithCode('blank terminal label is rejected', () => state.setTerminalLabel('   '), 'TERMINAL_LABEL');
state.clearCart();
state.hydrate(cashier);
state.addProduct(product.id, 1);
throwsWithCode(
  'cashier discount above the limit needs administrator credentials',
  () => state.setLineDiscount(product.id, 1000, 'Needs approval'),
  'DISCOUNT_LIMIT',
);
state.setLineDiscount(product.id, 1000, 'Approved promotion', { approval: { username: 'owner', password: 'secret' } });
equal('approved cashier discount is stored on the line', state.cart[0].discountApproval.username, 'owner');
state.signOut();
equal('sign-out clears the user and cart', state.currentUser, null);
equal('sign-out clears cart lines', state.cart.length, 0);

console.log('\n--- permission matrix ---');
check('admin may access purchasing and users', canAccessPath(admin, '/purchasing') && canAccessPath(admin, '/users'));
check('admin may access settings and system', canAccessPath(admin, '/settings') && canAccessPath(admin, '/system'));
check('cashier may access checkout, catalog, and own sales', canAccessPath(cashier, '/checkout') && canAccessPath(cashier, '/catalog') && canAccessPath(cashier, '/sales'));
check('cashier may not access purchasing', !canAccessPath(cashier, '/purchasing'));
check('cashier may not access users, settings, or system', !canAccessPath(cashier, '/users') && !canAccessPath(cashier, '/settings') && !canAccessPath(cashier, '/system'));
check('cashier cannot see product cost or stock value', !can(cashier, 'seeCost') && !can(cashier, 'seeValue'));
check('cashier cannot edit the catalog or adjust inventory', !can(cashier, 'editCatalog') && !can(cashier, 'adjustInventory'));
check('cashier can request returns, voids, and discounts', can(cashier, 'returnSale') && can(cashier, 'voidSale') && can(cashier, 'applyDiscount'));
equal('role labels are explicit', `${roleLabel(admin)} / ${roleLabel(cashier)} / ${roleLabel(null)}`, 'Administrator / Cashier / Signed out');
check('cashier discount helper respects the server-configured limit', !canApplyDiscount(cashier, store.settings, 1000) && canApplyDiscount(cashier, store.settings, 500));

console.log('\n--- login shell ---');
const loginState = createAppState(store);
loginState.setSetupStatus({ setupRequired: false, setupEnabled: true });
const loginHtml = renderLogin({ state: loginState, route: '/login', query: {}, params: {} }).html;
check('login renders the server sign-in form', loginHtml.includes('id="login-form"'));
check('login does not claim mock or offline behaviour', !/mock|offline|nothing was saved/i.test(loginHtml));
check('login names the shop server boundary', /shop server/i.test(loginHtml));

console.log('');
if (failures.length) {
  console.error(`test-ui failed: ${failures.length} of ${assertionCount} checks failed.`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log(`test-ui passed: ${assertionCount} checks.`);
