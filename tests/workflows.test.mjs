import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import {
  api,
  assertStatus,
  cartLine,
  checkout,
  getProduct,
  login,
  setupAdmin,
  startTestServer,
} from './helpers.mjs';

const EDGE_PATHS = [
  process.env.BROWSER_EXECUTABLE,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);

const executablePath = EDGE_PATHS.find((candidate) => existsSync(candidate));
const hasBrowser = Boolean(executablePath);

const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

async function waitForHash(page, expected) {
  await page.waitForFunction((hash) => location.hash === hash, expected, { timeout: 15_000 });
}

async function waitForDialogClosed(page) {
  await page.waitForFunction(() => !document.querySelector('#app-dialog')?.open, null, { timeout: 15_000 });
}

async function waitForText(page, selector, text) {
  await page.waitForFunction(
    ([target, expectedText]) => document.querySelector(target)?.textContent?.includes(expectedText),
    [selector, text],
    { timeout: 15_000 },
  );
}

test('local workflow: admin catalog, stock, purchasing, settings, users, and void through the website', { skip: !hasBrowser && 'No Chromium-based browser executable found.' }, async (t) => {
  const server = await startTestServer();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--no-first-run', '--no-default-browser-check'],
  });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (/Failed to load resource.*401 \(Unauthorized\)/.test(message.text())) return;
    errors.push(`console: ${message.text()}`);
  });

  t.after(async () => {
    await browser.close();
    await server.close();
  });

  const admin = await setupAdmin(server.base);
  let category;
  let product;
  let supplier;
  let purchaseOrder;

  await t.test('administrator signs in through the login form', async () => {
    await page.goto(`${server.base}/#/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#login-form');
    await page.fill('#login-username', admin.username);
    await page.fill('#login-password', admin.password);
    await page.getByRole('button', { name: /^Sign in/ }).click();
    await waitForHash(page, '#/dashboard');
    await waitForText(page, '#main-content', 'Shop dashboard');
  });

  await t.test('category and product forms create and update catalog records', async () => {
    await page.goto(`${server.base}/#/catalog`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-manage-categories]');
    await page.locator('[data-manage-categories]').click();
    await page.waitForSelector('#category-add-form');
    await page.fill('#category-name', 'Local UI Parts');
    await page.fill('#category-description', 'Created through the local website');
    await page.getByRole('button', { name: /Add category/ }).click();
    await page.waitForFunction(
      () => [...document.querySelectorAll('[data-category-name]')].some((input) => input.value === 'Local UI Parts'),
      null,
      { timeout: 15_000 },
    );

    const categories = await api(server.base, 'GET', '/api/catalog/categories', { session: admin });
    assertStatus(categories, 200, 'categories after UI create');
    category = categories.body.find((candidate) => candidate.name === 'Local UI Parts');
    assert.ok(category, 'category created through the UI is returned by the API');

    await page.locator('#app-dialog [data-dialog-close]').last().click();
    await waitForDialogClosed(page);

    await page.locator('[data-new-product]').click();
    await page.waitForSelector('#product-form');
    await page.fill('#product-name', 'Local UI Oil Filter');
    await page.fill('#product-sku', 'LOCAL-UI-1');
    await page.fill('#product-barcode', '4800000000011');
    await page.selectOption('#product-category', category.id);
    await page.fill('#product-cost', '45.00');
    await page.fill('#product-price', '90.00');
    await page.fill('#product-reorder', '2');
    await page.getByRole('button', { name: /Create product/ }).click();
    await waitForDialogClosed(page);
    await waitForText(page, '#catalog-table-body', 'Local UI Oil Filter');

    const products = await api(server.base, 'GET', '/api/catalog/products?query=LOCAL-UI-1', { session: admin });
    assertStatus(products, 200, 'products after UI create');
    product = products.body.find((candidate) => candidate.sku === 'LOCAL-UI-1');
    assert.ok(product, 'product created through the UI is returned by the API');
    assert.equal(product.priceCents, 9000);
    assert.equal(product.stockOnHand, 0);

    await page.locator(`[data-edit-product="${product.id}"]`).click();
    await page.waitForSelector('#product-form');
    await page.fill('#product-price', '95.00');
    await page.getByRole('button', { name: /Update product/ }).click();
    await waitForDialogClosed(page);

    const updated = await getProduct(server.base, admin, product.id);
    assert.equal(updated.priceCents, 9500);
    assert.equal(updated.categoryId, category.id);
    product = updated;
  });

  await t.test('inventory adjustment posts a stock movement and changes on-hand quantity', async () => {
    await page.goto(`${server.base}/#/inventory`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#inventory-search');
    await page.fill('#inventory-search', 'LOCAL-UI-1');
    await page.waitForSelector(`[data-adjust-product="${product.id}"]`);
    await page.locator(`[data-adjust-product="${product.id}"]`).click();
    await page.waitForSelector('#stock-adjustment-form');
    await page.fill('#stock-delta', '5');
    await page.fill('#stock-reason', 'Local website opening stock');
    await page.getByRole('button', { name: /Apply adjustment/ }).click();
    await waitForDialogClosed(page);

    const adjusted = await getProduct(server.base, admin, product.id);
    assert.equal(adjusted.stockOnHand, 5);
    assert.equal(adjusted.stockValueCents, 5 * 4500);
  });

  await t.test('supplier form creates a supplier', async () => {
    await page.goto(`${server.base}/#/purchasing/suppliers`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-new-supplier]');
    await page.locator('[data-new-supplier]').click();
    await page.waitForSelector('#supplier-form');
    await page.fill('#supplier-name', 'Local UI Supplier');
    await page.fill('#supplier-contact', 'Nora Parts');
    await page.fill('#supplier-phone', '0917 555 0100');
    await page.fill('#supplier-email', 'nora@example.test');
    await page.getByRole('button', { name: /Create supplier/ }).click();
    await waitForDialogClosed(page);
    await waitForText(page, '#supplier-table-body', 'Local UI Supplier');

    const suppliers = await api(server.base, 'GET', '/api/suppliers', { session: admin });
    assertStatus(suppliers, 200, 'suppliers after UI create');
    supplier = suppliers.body.find((candidate) => candidate.name === 'Local UI Supplier');
    assert.ok(supplier, 'supplier created through the UI is returned by the API');
  });

  await t.test('purchase order form creates, orders, and receives stock', async () => {
    await page.goto(`${server.base}/#/purchasing/new`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#po-editor-form');
    await page.selectOption('#po-supplier', supplier.id);
    await page.fill('#po-expected', tomorrow);
    await page.fill('#po-notes', 'Local website receiving flow');
    await page.selectOption('[data-po-product]', product.id);
    await page.fill('[data-po-qty]', '3');
    await page.fill('[data-po-cost]', '40.00');
    await page.getByRole('button', { name: /Create draft/ }).click();
    await page.waitForFunction(() => /^#\/purchasing\/\d+$/.test(location.hash), null, { timeout: 15_000 });
    const poId = await page.evaluate(() => location.hash.split('/').pop());
    await page.waitForSelector('[data-mark-ordered]');

    const draft = await api(server.base, 'GET', `/api/purchasing/orders/${poId}`, { session: admin });
    assertStatus(draft, 200, 'draft purchase order');
    purchaseOrder = draft.body;
    assert.equal(purchaseOrder.status, 'DRAFT');
    assert.equal(purchaseOrder.lines[0].orderedQty, 3);
    assert.equal(purchaseOrder.lines[0].unitCostCents, 4000);

    await page.locator('[data-mark-ordered]').click();
    await page.waitForSelector('[data-confirm-ok]');
    await page.locator('[data-confirm-ok]').click();
    await page.waitForSelector('[data-receive-order]');

    await page.locator('[data-receive-order]').click();
    await page.waitForSelector('[data-receive-qty]');
    await page.fill('[data-receive-qty]', '1');
    await page.locator('[data-receive-save]').click();
    await waitForDialogClosed(page);

    const partial = await api(server.base, 'GET', `/api/purchasing/orders/${poId}`, { session: admin });
    assertStatus(partial, 200, 'partially received purchase order');
    assert.equal(partial.body.status, 'PARTIALLY_RECEIVED');
    assert.equal(partial.body.receipts.length, 1);
    assert.equal(partial.body.receipts[0].items[0].quantity, 1);
    assert.equal((await getProduct(server.base, admin, product.id)).stockOnHand, 6);

    await page.locator('[data-receive-order]').click();
    await page.waitForSelector('[data-receive-qty]');
    await page.fill('[data-receive-qty]', '2');
    await page.locator('[data-receive-save]').click();
    await waitForDialogClosed(page);
    await page.waitForFunction(() => !document.querySelector('[data-receive-order]'), null, { timeout: 15_000 });

    const received = await api(server.base, 'GET', `/api/purchasing/orders/${poId}`, { session: admin });
    assertStatus(received, 200, 'received purchase order');
    assert.equal(received.body.status, 'RECEIVED');
    assert.equal(received.body.receipts.length, 2);
    assert.deepEqual(received.body.receipts.map((receipt) => receipt.items[0].quantity).sort(), [1, 2]);

    const stocked = await getProduct(server.base, admin, product.id);
    assert.equal(stocked.stockOnHand, 8);
    assert.equal(stocked.stockValueCents, 5 * 4500 + 3 * 4000);
  });

  await t.test('settings form persists the receipt footer across a reload', async () => {
    const footer = 'Local UI footer saved at the counter';
    await page.goto(`${server.base}/#/settings`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#settings-form');
    await page.fill('#settings-footer', footer);
    await page.getByRole('button', { name: /Save settings/ }).click();
    await page.waitForFunction(() => /Shop settings saved/.test(document.querySelector('#toast-region')?.textContent || ''), null, { timeout: 15_000 });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#settings-footer');
    assert.equal(await page.inputValue('#settings-footer'), footer);

    const settings = await api(server.base, 'GET', '/api/settings', { session: admin });
    assertStatus(settings, 200, 'settings after UI save');
    assert.equal(settings.body.receiptFooter, footer);
  });

  await t.test('user form creates a cashier and returns a usable temporary password', async () => {
    await page.goto(`${server.base}/#/users`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-new-user]');
    await page.locator('[data-new-user]').click();
    await page.waitForSelector('#user-form');
    await page.fill('#user-display-name', 'Local UI Cashier');
    await page.fill('#user-username', 'localcashier');
    await page.selectOption('#user-role', 'CASHIER');
    await page.getByRole('button', { name: /Create user/ }).click();
    await page.waitForSelector('#temporary-password');
    const temporaryPassword = await page.inputValue('#temporary-password');
    assert.ok(temporaryPassword.length >= 12);
    await page.locator('#app-dialog [data-dialog-close]').last().click();
    await waitForDialogClosed(page);
    await waitForText(page, '#user-table-body', 'Local UI Cashier');

    const cashierSession = await login(server.base, 'localcashier', temporaryPassword);
    assert.equal(cashierSession.user.role, 'CASHIER');
    assert.equal(cashierSession.user.mustChangePassword, true);
  });

  await t.test('administrator voids a sale through the website and stock is restored', async () => {
    const beforeVoid = await getProduct(server.base, admin, product.id);
    const saleResponse = await checkout(server.base, admin, {
      lines: [cartLine(product.id, 1)],
      payments: [{ method: 'CASH', amountCents: product.priceCents, tenderedCents: product.priceCents }],
    });
    assertStatus(saleResponse, 201, 'sale for UI void');
    const sale = saleResponse.body.sale;
    assert.equal((await getProduct(server.base, admin, product.id)).stockOnHand, beforeVoid.stockOnHand - 1);

    await page.goto(`${server.base}/#/sales/${sale.id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-void-action]:not([disabled])');
    await page.locator('[data-void-action]').first().click();
    await page.waitForSelector('#dialog-reason');
    await page.fill('#dialog-reason', 'Local UI void test');
    await page.locator('[data-reason-ok]').click();
    await page.waitForFunction(
      () => /was voided and stock was restored/.test(document.querySelector('#toast-region')?.textContent || ''),
      null,
      { timeout: 15_000 },
    );
    await page.waitForFunction(() => /voided/i.test(document.querySelector('#main-content')?.textContent || ''), null, { timeout: 15_000 });

    const voided = await api(server.base, 'GET', `/api/sales/${sale.id}`, { session: admin });
    assertStatus(voided, 200, 'voided sale');
    assert.equal(voided.body.status, 'VOIDED');
    assert.equal((await getProduct(server.base, admin, product.id)).stockOnHand, beforeVoid.stockOnHand);
  });

  assert.deepEqual(errors, [], `browser runtime errors:\n${errors.join('\n')}`);
  assert.equal(purchaseOrder.status, 'DRAFT');
});
