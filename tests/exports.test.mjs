import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  api,
  apiBuffer,
  assertStatus,
  cartLine,
  checkout,
  createCashier,
  createCategory,
  createProduct,
  setupAdmin,
  startTestServer,
} from './helpers.mjs';

let ctx;
let base;

before(async () => {
  ctx = await startTestServer();
  base = ctx.base;
});
after(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await ctx.reset();
});

async function currentDay() {
  return (await ctx.owner.query("SELECT to_char(current_business_date(), 'YYYY-MM-DD') AS d")).rows[0].d;
}

function nextDay(day) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

async function seedExports() {
  const admin = await setupAdmin(base);
  const cashier = await createCashier(base, admin, { username: 'exportcashier' });
  const category = await createCategory(base, admin, 'Export Category');
  const product = await createProduct(base, admin, {
    sku: 'EXPORT-1',
    name: 'Export Oil Filter',
    categoryId: category.id,
    costCents: 6000,
    priceCents: 10000,
    stockOnHand: 10,
    reorderLevel: 5,
  });
  const lowProduct = await createProduct(base, admin, {
    sku: 'EXPORT-LOW',
    name: 'Export Low Stock Item',
    categoryId: category.id,
    costCents: 2500,
    priceCents: 5000,
    stockOnHand: 1,
    reorderLevel: 3,
  });

  const sale = await checkout(base, admin, {
    clientRequestId: `export-sale-${Math.random().toString(36).slice(2)}`,
    lines: [cartLine(product.id, 2)],
    payments: [{ method: 'CASH', amountCents: 20000 }],
    terminalLabel: 'Export Counter',
    note: 'Export dataset test',
  });
  assertStatus(sale, 201, 'seed sale');
  const saleId = sale.body.sale.id;
  const saleItemId = sale.body.sale.items[0].id;

  const returned = await api(base, 'POST', `/api/sales/${saleId}/returns`, {
    session: admin,
    body: {
      clientRequestId: `export-return-${Math.random().toString(36).slice(2)}`,
      reason: 'Customer return',
      refundMethod: 'CASH',
      items: [{ saleItemId, quantity: 1, restock: true }],
    },
  });
  assertStatus(returned, 201, 'seed return');

  const supplier = await api(base, 'POST', '/api/suppliers', {
    session: admin,
    body: {
      name: 'Export Supplier',
      contactName: 'Export Contact',
      phone: '555-0100',
      email: 'export@example.test',
      address: '12 Export Street',
      notes: 'Export test supplier',
    },
  });
  assertStatus(supplier, 201, 'seed supplier');

  const day = await currentDay();
  const purchaseOrder = await api(base, 'POST', '/api/purchasing/orders', {
    session: admin,
    body: {
      supplierId: supplier.body.id,
      expectedAt: day,
      notes: 'Export purchase order',
      lines: [{ productId: product.id, orderedQty: 3, unitCostCents: 5500 }],
    },
  });
  assertStatus(purchaseOrder, 201, 'seed purchase order');

  return { admin, cashier, category, product, lowProduct, sale: sale.body.sale, day };
}

test('admin sales XLSX contains the ledger, supporting sheets, and an audit record', async () => {
  const seed = await seedExports();
  const response = await apiBuffer(
    base,
    'GET',
    `/api/exports/sales/xlsx?from=${seed.day}&to=${seed.day}`,
    { session: seed.admin },
  );
  assertStatus(response, 200, 'sales xlsx');
  assert.match(response.headers.get('content-type') || '', /spreadsheetml\.sheet/);
  assert.match(
    response.headers.get('content-disposition') || '',
    new RegExp(`attachment; filename="autotrack-sales_${seed.day}_to_${seed.day}\\.xlsx"`),
  );
  assert.equal(response.body.subarray(0, 2).toString('ascii'), 'PK');
  assert.ok(response.body.length > 4000, 'workbook should contain a non-trivial file');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(response.body);
  assert.deepEqual(
    workbook.worksheets.map((sheet) => sheet.name),
    ['Summary', 'Sales', 'Sale lines', 'Payments', 'Returns', 'Return lines'],
  );

  const sales = workbook.getWorksheet('Sales');
  assert.equal(sales.rowCount, 3, 'header, one sale row, and the total row');
  assert.equal(sales.getRow(2).getCell(1).value, seed.sale.number);
  assert.equal(sales.getRow(2).getCell(7).value, 2, 'units sold');
  assert.equal(sales.getRow(2).getCell(13).value, 200, 'sale total is exported in currency units');

  const lines = workbook.getWorksheet('Sale lines');
  assert.equal(lines.getRow(2).getCell(2).value, 'EXPORT-1');
  assert.equal(lines.getRow(2).getCell(4).value, 2);
  assert.equal(lines.getRow(2).getCell(10).value, 200);

  const payments = workbook.getWorksheet('Payments');
  assert.equal(payments.getRow(2).getCell(3).value, 'Cash');
  assert.equal(payments.getRow(2).getCell(4).value, 200);

  const returns = workbook.getWorksheet('Returns');
  assert.equal(returns.rowCount, 3, 'header, one return row, and the total row');
  assert.equal(returns.getRow(2).getCell(6).value, 100);

  const audit = await ctx.owner.query(
    "SELECT details FROM audit_log WHERE action = 'REPORT_EXPORTED' ORDER BY id DESC LIMIT 1",
  );
  assert.equal(audit.rows.length, 1);
  const details = typeof audit.rows[0].details === 'string'
    ? JSON.parse(audit.rows[0].details)
    : audit.rows[0].details;
  assert.equal(details.dataset, 'sales');
  assert.equal(details.format, 'xlsx');
  assert.equal(details.filters.from, seed.day);
  assert.equal(details.rowCount, 5);
});

test('admin can download every dataset as XLSX and PDF', async () => {
  const seed = await seedExports();
  const datasets = ['daily', 'sales', 'inventory', 'low-stock', 'movements', 'purchasing'];

  for (const dataset of datasets) {
    for (const format of ['xlsx', 'pdf']) {
      const response = await apiBuffer(
        base,
        'GET',
        `/api/exports/${dataset}/${format}?from=${seed.day}&to=${seed.day}`,
        { session: seed.admin },
      );
      assertStatus(response, 200, `${dataset} ${format}`);
      assert.match(
        response.headers.get('content-type') || '',
        format === 'xlsx' ? /spreadsheetml\.sheet/ : /application\/pdf/,
      );
      assert.match(response.headers.get('content-disposition') || '', /attachment; filename="/);
      if (format === 'xlsx') {
        assert.equal(response.body.subarray(0, 2).toString('ascii'), 'PK', `${dataset} xlsx signature`);
      } else {
        assert.equal(response.body.subarray(0, 5).toString('ascii'), '%PDF-', `${dataset} pdf signature`);
      }
      assert.ok(response.body.length > 1000, `${dataset} ${format} should not be empty`);
    }
  }

  const audit = await ctx.owner.query(
    "SELECT COUNT(*) AS count FROM audit_log WHERE action = 'REPORT_EXPORTED'",
  );
  assert.equal(Number(audit.rows[0].count), datasets.length * 2);
});

test('exports are administrator-only and reject invalid requests', async () => {
  const seed = await seedExports();
  const day = seed.day;

  const anonymous = await apiBuffer(base, 'GET', `/api/exports/sales/xlsx?from=${day}&to=${day}`);
  assertStatus(anonymous, 401, 'anonymous export');

  const cashierXlsx = await apiBuffer(
    base,
    'GET',
    `/api/exports/sales/xlsx?from=${day}&to=${day}`,
    { session: seed.cashier.session },
  );
  assertStatus(cashierXlsx, 403, 'cashier sales export');
  const cashierPdf = await apiBuffer(
    base,
    'GET',
    `/api/exports/inventory/pdf?asOf=${day}`,
    { session: seed.cashier.session },
  );
  assertStatus(cashierPdf, 403, 'cashier inventory export');

  const badDataset = await apiBuffer(
    base,
    'GET',
    `/api/exports/nope/xlsx?from=${day}&to=${day}`,
    { session: seed.admin },
  );
  assertStatus(badDataset, 400, 'invalid dataset');
  const badFormat = await apiBuffer(
    base,
    'GET',
    `/api/exports/sales/docx?from=${day}&to=${day}`,
    { session: seed.admin },
  );
  assertStatus(badFormat, 400, 'invalid format');
  const badDate = await apiBuffer(
    base,
    'GET',
    `/api/exports/sales/xlsx?from=not-a-date&to=${day}`,
    { session: seed.admin },
  );
  assertStatus(badDate, 400, 'invalid date');

  const reversedRange = await apiBuffer(
    base,
    'GET',
    `/api/exports/sales/xlsx?from=${nextDay(day)}&to=${day}`,
    { session: seed.admin },
  );
  assertStatus(reversedRange, 400, 'reversed range');

  const badStatus = await apiBuffer(
    base,
    'GET',
    `/api/exports/purchasing/xlsx?status=NOPE`,
    { session: seed.admin },
  );
  assertStatus(badStatus, 400, 'invalid purchase status');

  const audit = await ctx.owner.query(
    "SELECT COUNT(*) AS count FROM audit_log WHERE action = 'REPORT_EXPORTED'",
  );
  assert.equal(Number(audit.rows[0].count), 0);
});

test('date and category filters constrain export rows', async () => {
  const seed = await seedExports();
  const otherDay = nextDay(seed.day);

  const empty = await apiBuffer(
    base,
    'GET',
    `/api/exports/sales/xlsx?from=${otherDay}&to=${otherDay}`,
    { session: seed.admin },
  );
  assertStatus(empty, 200, 'empty sales range');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(empty.body);
  assert.equal(workbook.getWorksheet('Sales').rowCount, 1);
  assert.equal(workbook.getWorksheet('Sale lines').rowCount, 1);

  const category = await createCategory(base, seed.admin, 'Empty Export Category');
  const filtered = await apiBuffer(
    base,
    'GET',
    `/api/exports/inventory/xlsx?categoryId=${category.id}&asOf=${seed.day}`,
    { session: seed.admin },
  );
  assertStatus(filtered, 200, 'empty category valuation');
  const filteredWorkbook = new ExcelJS.Workbook();
  await filteredWorkbook.xlsx.load(filtered.body);
  assert.equal(filteredWorkbook.getWorksheet('Inventory valuation').rowCount, 1);
  assert.equal(filteredWorkbook.getWorksheet('Low stock').rowCount, 1);

  const selected = await apiBuffer(
    base,
    'GET',
    `/api/exports/movements/xlsx?productId=${seed.lowProduct.id}&from=${seed.day}&to=${seed.day}`,
    { session: seed.admin },
  );
  assertStatus(selected, 200, 'product movement export');
  const movementWorkbook = new ExcelJS.Workbook();
  await movementWorkbook.xlsx.load(selected.body);
  assert.equal(movementWorkbook.getWorksheet('Stock movements').rowCount, 3);
});
