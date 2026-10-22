import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import {
  createCashier,
  createCategory,
  createProduct,
  login,
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

async function waitForHash(page, hash) {
  await page.waitForFunction((expected) => location.hash === expected, hash, { timeout: 15_000 });
}

async function h1(page) {
  await page.waitForFunction(() => document.querySelector('#main-content h1')?.textContent?.trim(), null, { timeout: 15_000 });
  return (await page.locator('#main-content h1').first().textContent()).trim();
}

test('browser smoke: setup, forced password change, routing, and checkout', { skip: !hasBrowser && 'No Chromium-based browser executable found.' }, async (t) => {
  const server = await startTestServer();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--no-first-run', '--no-default-browser-check'],
  });
  const errors = [];
  const watch = (page, label) => {
    page.on('pageerror', (error) => errors.push(`${label} pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      // A fresh logged-out session intentionally probes /api/auth/me once.
      if (/Failed to load resource.*401 \(Unauthorized\)/.test(message.text())) return;
      errors.push(`${label} console: ${message.text()}`);
    });
  };

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  watch(adminPage, 'admin');
  const cashierContext = await browser.newContext();
  const cashierPage = await cashierContext.newPage();
  watch(cashierPage, 'cashier');

  t.after(async () => {
    await browser.close();
    await server.close();
  });

  await t.test('first-run setup creates the administrator and opens the dashboard', async () => {
    await adminPage.goto(server.base, { waitUntil: 'domcontentloaded' });
    await adminPage.waitForSelector('#setup-form');
    await adminPage.fill('#setup-token', 'test-bootstrap-token-0123456789abcdef');
    await adminPage.fill('#setup-username', 'owner');
    await adminPage.fill('#setup-name', 'Owner Admin');
    await adminPage.fill('#setup-password', 'CorrectHorse9Battery');
    await adminPage.fill('#setup-confirm', 'CorrectHorse9Battery');
    await adminPage.getByRole('button', { name: /Create administrator/ }).click();
    await waitForHash(adminPage, '#/dashboard');
    assert.equal(await h1(adminPage), 'Shop dashboard');
    await adminPage.waitForFunction(() => document.querySelector('#connection-banner')?.textContent?.includes('Live shop server'));
  });

  const adminApi = await login(server.base, 'owner', 'CorrectHorse9Battery');
  const category = await createCategory(server.base, adminApi, 'Engine Parts');
  const product = await createProduct(server.base, adminApi, {
    sku: 'BROWSER-FILTER-1',
    name: 'Browser Oil Filter',
    categoryId: category.id,
    costCents: 6000,
    priceCents: 10000,
    stockOnHand: 10,
  });
  const cashier = await createCashier(server.base, adminApi, { username: 'browsercashier' });

  await t.test('administrator can open every primary screen without a runtime error', async () => {
    // Re-hydrate after the API-created category, product, and cashier.
    await adminPage.reload({ waitUntil: 'domcontentloaded' });
    await adminPage.waitForFunction(() => document.querySelector('#connection-banner')?.textContent?.includes('Live shop server'));
    const routes = [
      ['#/dashboard', 'Shop dashboard'],
      ['#/checkout', 'Checkout'],
      ['#/catalog', 'Catalog'],
      ['#/inventory', 'Inventory'],
      ['#/purchasing', 'Purchase orders'],
      ['#/purchasing/suppliers', 'Suppliers'],
      ['#/purchasing/new', 'New purchase order'],
      ['#/sales', 'Sales'],
      ['#/reports', 'Reports'],
      ['#/users', 'Users & roles'],
      ['#/settings', 'Settings'],
      ['#/system', 'System status'],
    ];
    for (const [hash, heading] of routes) {
      await adminPage.goto(`${server.base}/${hash}`, { waitUntil: 'domcontentloaded' });
      await waitForHash(adminPage, hash);
      assert.equal(await h1(adminPage), heading, `route ${hash}`);
    }
    await adminPage.goto(`${server.base}/#/catalog`, { waitUntil: 'domcontentloaded' });
    await adminPage.waitForSelector('#catalog-search');
    await adminPage.fill('#catalog-search', 'BROWSER-FILTER-1');
    await adminPage.waitForFunction(() => document.querySelector('#catalog-table-body')?.textContent?.includes('Browser Oil Filter'));
    assert.equal(await adminPage.getByRole('button', { name: /Categories/ }).count(), 1);

    await adminPage.goto(`${server.base}/#/reports`, { waitUntil: 'domcontentloaded' });
    await adminPage.waitForFunction(() => document.querySelector('#report-content')?.textContent?.includes('Daily sales summary'));
    await adminPage.getByRole('tab', { name: 'Inventory valuation' }).click();
    await adminPage.waitForFunction(() => document.querySelector('#report-content')?.textContent?.includes('Stock value'));

    await adminPage.goto(`${server.base}/#/system`, { waitUntil: 'domcontentloaded' });
    await adminPage.waitForFunction(() => document.querySelector('#main-content')?.textContent?.includes('Schema migrations'));
    assert.match(await adminPage.locator('#main-content').innerText(), /003_least_privilege/);

    await adminPage.setViewportSize({ width: 1024, height: 768 });
    for (const hash of ['#/dashboard', '#/checkout', '#/reports']) {
      await adminPage.goto(`${server.base}/${hash}`, { waitUntil: 'domcontentloaded' });
      await waitForHash(adminPage, hash);
      const overflow = await adminPage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 1, `${hash} overflows the 1024px viewport by ${overflow}px`);
    }
  });

  await t.test('cashier login forces a password change and completes a confirmed sale', async () => {
    await cashierPage.goto(`${server.base}/#/login`, { waitUntil: 'domcontentloaded' });
    try {
      await cashierPage.waitForSelector('#login-form', { timeout: 15_000 });
    } catch (error) {
      const body = await cashierPage.locator('body').innerText().catch(() => '(no body)');
      throw new Error(`${error.message}\nURL: ${cashierPage.url()}\nBODY: ${body.slice(0, 1000)}`);
    }
    await cashierPage.fill('#login-username', 'browsercashier');
    await cashierPage.fill('#login-password', cashier.temporaryPassword);
    await cashierPage.getByRole('button', { name: /^Sign in/ }).click();
    await cashierPage.waitForSelector('#change-password-form');
    await cashierPage.fill('#current-password', cashier.temporaryPassword);
    await cashierPage.fill('#new-password', 'Cashier-Browser-2026!');
    await cashierPage.fill('#new-password-confirm', 'Cashier-Browser-2026!');
    await cashierPage.getByRole('button', { name: /Save password/ }).click();
    await waitForHash(cashierPage, '#/dashboard');
    assert.match(await h1(cashierPage), /Good (morning|afternoon|evening), Cashier|Shop dashboard/);

    await cashierPage.goto(`${server.base}/#/checkout`, { waitUntil: 'domcontentloaded' });
    await cashierPage.waitForSelector('#product-search');
    await cashierPage.fill('#product-search', product.sku);
    await cashierPage.press('#product-search', 'Enter');
    await cashierPage.waitForSelector('[data-pay-button]:not([disabled])');
    await cashierPage.locator('[data-pay-button]').click();
    await cashierPage.waitForSelector('[data-payment-complete]');
    await cashierPage.locator('[data-payment-complete]').click();
    await cashierPage.waitForFunction(() => location.hash.startsWith('#/receipt/'), null, { timeout: 15_000 });
    await cashierPage.waitForFunction(() => document.querySelector('#main-content')?.textContent?.includes('Browser Oil Filter'));
    const receiptText = await cashierPage.locator('#main-content').innerText();
    assert.match(receiptText, /SAVED TRANSACTION/);
    assert.match(receiptText, /Browser Oil Filter/);

    const saleId = (await cashierPage.evaluate(() => location.hash)).split('/').pop();
    await cashierPage.goto(`${server.base}/#/sales/${saleId}`, { waitUntil: 'domcontentloaded' });
    await cashierPage.waitForSelector('[data-return-action]');
    await cashierPage.locator('[data-return-action]').first().click();
    await cashierPage.waitForSelector('#override-username');
    assert.equal(await cashierPage.evaluate(() => document.activeElement?.id), 'override-username');
    await cashierPage.fill('#override-username', 'owner');
    await cashierPage.fill('#override-password', 'CorrectHorse9Battery');
    await cashierPage.locator('[data-override-ok]').click();
    await cashierPage.waitForSelector('[data-return-qty]');
    await cashierPage.fill('[data-return-qty]', '1');
    await cashierPage.fill('#return-reason', 'Browser return smoke test');
    await cashierPage.locator('[data-return-save]').click();
    try {
      await cashierPage.waitForFunction(() => /1 return(?:s)?/i.test(document.querySelector('#main-content')?.textContent || '') && /RETURNED/i.test(document.querySelector('#main-content')?.textContent || ''), null, { timeout: 15_000 });
    } catch (error) {
      const diagnostics = await cashierPage.evaluate(() => {
        const dialog = document.querySelector('#app-dialog');
        return {
          hash: location.hash,
          dialogOpen: Boolean(dialog?.open),
          dialogText: dialog?.innerText || '',
          toast: document.querySelector('#toast-region')?.innerText || '',
          saleStatus: document.querySelector('.sale-status, .badge')?.textContent || '',
        };
      }).catch(() => ({}));
      throw new Error(`${error.message}\nURL: ${cashierPage.url()}\nDIAG: ${JSON.stringify(diagnostics)}\nERRORS: ${JSON.stringify(errors)}`);
    }
    assert.match(await cashierPage.locator('#main-content').innerText(), /Browser Oil Filter/);
  });

  await t.test('cashier cannot open administrator screens', async () => {
    await cashierPage.goto(`${server.base}/#/users`, { waitUntil: 'domcontentloaded' });
    await cashierPage.waitForFunction(() => /Access denied/i.test(document.querySelector('#main-content')?.textContent || ''));
    assert.match(await cashierPage.locator('#main-content').innerText(), /Access denied/i);
  });

  assert.deepEqual(errors, [], `browser runtime errors:\n${errors.join('\n')}`);
});
