import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
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

    const [xlsxDownload] = await Promise.all([
      adminPage.waitForEvent('download'),
      adminPage.locator('[data-export-report="xlsx"]').click(),
    ]);
    const xlsxPath = await xlsxDownload.path();
    assert.ok(xlsxPath, 'Excel download has a local path');
    const xlsxBytes = readFileSync(xlsxPath);
    assert.equal(xlsxBytes.subarray(0, 2).toString('ascii'), 'PK');
    assert.match(
      xlsxDownload.suggestedFilename(),
      /^autotrack-inventory-valuation_\d{4}-\d{2}-\d{2}\.xlsx$/,
    );
    await adminPage.waitForFunction(() => /Export ready/.test(document.querySelector('#toast-region')?.textContent || ''));

    const [pdfDownload] = await Promise.all([
      adminPage.waitForEvent('download'),
      adminPage.locator('[data-export-report="pdf"]').click(),
    ]);
    const pdfPath = await pdfDownload.path();
    assert.ok(pdfPath, 'PDF download has a local path');
    const pdfBytes = readFileSync(pdfPath);
    assert.equal(pdfBytes.subarray(0, 5).toString('ascii'), '%PDF-');
    assert.match(
      pdfDownload.suggestedFilename(),
      /^autotrack-inventory-valuation_\d{4}-\d{2}-\d{2}\.pdf$/,
    );

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

  await t.test('dashboard shortcuts are removed and sidebar tabs explain their purpose', async () => {
    await adminPage.setViewportSize({ width: 1280, height: 900 });
    await adminPage.goto(`${server.base}/#/dashboard`, { waitUntil: 'domcontentloaded' });
    await waitForHash(adminPage, '#/dashboard');
    await h1(adminPage);

    assert.equal(await adminPage.locator('.scope-strip, .quick-action, .quick-actions').count(), 0);
    assert.equal(await adminPage.getByText('Quick actions', { exact: true }).count(), 0);
    assert.equal(await adminPage.locator('.trend-chart__bar').count(), 0);
    assert.equal(await adminPage.locator('.trend-chart__path').count(), 1);
    assert.equal(await adminPage.locator('.trend-chart__dot').count(), 6);
    const insightPanelHeights = await adminPage.locator('.insight-panels > .insight-panel').evaluateAll((panels) => panels.map((panel) => panel.getBoundingClientRect().height));
    assert.equal(insightPanelHeights.length, 2);
    assert.ok(Math.abs(insightPanelHeights[0] - insightPanelHeights[1]) <= 1, `insight panels align: ${insightPanelHeights.join(', ')}`);
    const kpiHeaderStyles = await adminPage.locator('.insight-kpi__label').evaluateAll((labels) => labels.map((node) => {
      const style = getComputedStyle(node);
      return { fontSize: style.fontSize, fontWeight: style.fontWeight };
    }));
    assert.equal(kpiHeaderStyles.length, 4);
    assert.ok(kpiHeaderStyles.every((style) => style.fontSize === '15px' && style.fontWeight === '800'));
    const summaryHeaderStyles = await adminPage.locator('.stat-grid--six .stat-card__label').evaluateAll((labels) => labels.map((node) => {
      const style = getComputedStyle(node);
      return { fontSize: style.fontSize, fontWeight: style.fontWeight };
    }));
    assert.equal(summaryHeaderStyles.length, 6);
    assert.ok(summaryHeaderStyles.every((style) => style.fontSize === '16px' && style.fontWeight === '800'));

    const tooltip = adminPage.locator('.nav-tooltip');
    const dashboardLink = adminPage.locator('.nav-link[href="#/dashboard"]');
    await dashboardLink.hover();
    await adminPage.waitForFunction(() => {
      const node = document.querySelector('.nav-tooltip');
      return node && !node.hidden && getComputedStyle(node).visibility === 'visible';
    });
    assert.equal((await tooltip.innerText()).trim(), "See today's sales, targets, and stock health");
    const box = await tooltip.boundingBox();
    const viewport = adminPage.viewportSize();
    assert.ok(
      box
        && box.x >= 0
        && box.y >= 0
        && box.x + box.width <= viewport.width + 1
        && box.y + box.height <= viewport.height + 1,
      'sidebar help tooltip stays inside the viewport',
    );

    const expectedHelp = [
      ['#/dashboard', "See today's sales, targets, and stock health"],
      ['#/checkout', 'Search parts and take payment'],
      ['#/sales', 'Review shop sales, returns, and voids'],
      ['#/catalog', 'Prices, stock, and categories'],
      ['#/inventory', 'Check stock levels and record adjustments'],
      ['#/purchasing', 'Open purchase orders and suppliers'],
      ['#/reports', 'Daily sales, valuation, and movements'],
      ['#/users', 'Manage accounts, roles, and access'],
      ['#/settings', 'Shop details, tax, receipts, and targets'],
      ['#/system', 'Database health, backups, and versions'],
    ];
    for (const [hash, help] of expectedHelp) {
      await adminPage.locator(`.nav-link[href="${hash}"]`).hover();
      await adminPage.waitForFunction((text) => document.querySelector('.nav-tooltip')?.textContent === text, help);
      assert.equal((await tooltip.innerText()).trim(), help, `sidebar help for ${hash}`);
    }

    await adminPage.mouse.move(700, 120);
    await adminPage.waitForFunction(() => document.querySelector('.nav-tooltip')?.hidden === true);

    await dashboardLink.focus();
    await adminPage.waitForFunction(() => {
      const node = document.querySelector('.nav-tooltip');
      return node && !node.hidden && getComputedStyle(node).visibility === 'visible';
    });
    assert.equal((await tooltip.innerText()).trim(), "See today's sales, targets, and stock health");
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
    assert.equal(await cashierPage.locator('.scope-strip, .quick-action, .quick-actions').count(), 0);
    assert.equal(await cashierPage.locator('.nav-link[href="#/purchasing"]').count(), 0);
    assert.equal(await cashierPage.locator('.nav-link[href="#/users"]').count(), 0);
    assert.equal(await cashierPage.locator('.nav-link[href="#/dashboard"]').getAttribute('data-nav-help'), 'See your sales and recent counter activity');
    await cashierPage.locator('.nav-link[href="#/dashboard"]').hover();
    await cashierPage.waitForFunction(() => document.querySelector('.nav-tooltip')?.textContent === 'See your sales and recent counter activity');
    assert.equal(await cashierPage.locator('.nav-link[href="#/reports"]').getAttribute('data-nav-help'), 'Your daily sales and sales history');
    assert.equal(await cashierPage.locator('.nav-link[href="#/inventory"]').getAttribute('data-nav-help'), 'Read-only stock levels and movement history');
    await cashierPage.locator('.nav-link[href="#/reports"]').hover();
    await cashierPage.waitForFunction(() => document.querySelector('.nav-tooltip')?.textContent === 'Your daily sales and sales history');

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

    await cashierPage.goto(`${server.base}/#/reports`, { waitUntil: 'domcontentloaded' });
    await cashierPage.waitForFunction(() => document.querySelector('#report-content')?.textContent?.includes('Daily sales summary'));
    assert.equal(await cashierPage.locator('[data-export-report]').count(), 0);
    assert.equal(await cashierPage.getByRole('button', { name: /Export Excel|Export PDF/ }).count(), 0);
  });

  assert.deepEqual(errors, [], `browser runtime errors:\n${errors.join('\n')}`);
});
