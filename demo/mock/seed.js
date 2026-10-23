/**
 * Sample shop used by the GitHub Pages demo.
 *
 * Times are generated relative to the visitor's clock so the dashboard always
 * has today's activity. Everything lives in memory: no database, no storage,
 * no network calls.
 */
import { createShop, localDate, DEMO_PASSWORD } from './shop.js';
import { calculateLine } from './money.js';

const DAY = 86_400_000;
const MINUTE = 60_000;

function atTime(base, hours, minutes = 0) {
  const value = new Date(base);
  value.setHours(hours, minutes, 0, 0);
  return value;
}

function dateString(value) {
  return localDate(value);
}

const SETTINGS = {
  id: 'settings-1',
  shopName: 'Auto-Track Auto Supply & Service',
  address: '88 Rizal Avenue, Brgy. Sto. Rosario, San Fernando, Pampanga',
  phone: '+63 45 961 4488',
  email: 'counter@autotrack-demo.ph',
  tin: '009-482-115-000',
  currency: 'PHP',
  timezone: 'Asia/Manila',
  businessDayCutoff: '00:00',
  receiptHeader: 'Auto-Track Auto Supply & Service',
  receiptFooter: 'Thank you! Keep this receipt for warranty and returns.',
  receiptWidth: '80mm',
  returnsPolicy: 'Returns within 7 days with the original receipt. Electrical parts are final sale once installed.',
  taxEnabled: true,
  taxRateBps: 1200,
  taxInclusive: true,
  cashierDiscountLimitBps: 500,
  discountReasonRequired: true,
  maxLineQuantity: 999,
  allowNegativeStock: false,
  lowStockOnlyActive: true,
  updatedAt: new Date(Date.now() - 30 * DAY).toISOString(),
};

const USERS = [
  { username: 'admin', displayName: 'Maria Santos', role: 'ADMIN' },
  { username: 'cashier', displayName: 'Jomar Dela Cruz', role: 'CASHIER' },
  { username: 'cashier2', displayName: 'Aileen Reyes', role: 'CASHIER' },
];

const CATEGORIES = [
  { name: 'Engine Parts', description: 'Belts, timing kits, and internal engine parts' },
  { name: 'Filters', description: 'Oil, air, cabin, and fuel filters' },
  { name: 'Brakes & Suspension', description: 'Pads, shoes, shocks, and bearings' },
  { name: 'Electrical', description: 'Batteries, bulbs, and charging parts' },
  { name: 'Fluids & Lubricants', description: 'Engine oil, coolant, and transmission fluid' },
  { name: 'Belts & Hoses', description: 'Drive belts and cooling hoses' },
  { name: 'Body & Accessories', description: 'Wipers and counter accessories' },
];

// sku, name, category, cost, price, opening stock, reorder level, barcode, description
const PRODUCTS = [
  ['FLT-OIL-450', 'Oil Filter — Toyota Genuine', 'Filters', 28500, 45000, 30, 8, '4801234500011', 'Fits 1NZ/2NZ engines. Genuine Toyota element.'],
  ['FLT-AIR-680', 'Air Filter — Honda City 2009-2017', 'Filters', 41000, 68000, 20, 6, '4801234500028', 'Panel air filter with pre-cut frame.'],
  ['BRK-PAD-FRT', 'Brake Pad Set — Front', 'Brakes & Suspension', 118000, 185000, 12, 4, '4801234500035', 'Ceramic front pads with shims and clips.'],
  ['BRK-SHOE-RR', 'Brake Shoe Set — Rear', 'Brakes & Suspension', 102000, 165000, 6, 4, '4801234500042', 'Drum brake shoes with return springs.'],
  ['FLD-ENG-4L', 'Engine Oil 4L — 10W-30 Semi-Synthetic', 'Fluids & Lubricants', 96000, 145000, 40, 10, '4801234500059', 'API SN/CF 10W-30 in a 4-liter jug.'],
  ['FLD-COOL-1L', 'Coolant 1L — Green Concentrate', 'Fluids & Lubricants', 22000, 38000, 24, 6, '4801234500066', 'Mix 50/50 with distilled water.'],
  ['IGN-PLG-IR', 'Spark Plug — Iridium', 'Engine Parts', 31000, 52000, 48, 12, '4801234500073', 'Long-life iridium plug, resistor type.'],
  ['ENG-TB-KIT', 'Timing Belt Kit', 'Engine Parts', 205000, 320000, 6, 3, '4801234500080', 'Belt, tensioner, and idler pulley set.'],
  ['BLT-4PK825', 'V-Belt 4PK-825', 'Belts & Hoses', 42000, 75000, 14, 5, '4801234500097', 'Four-rib serpentine belt, 825 mm.'],
  ['HSE-RAD-UP', 'Radiator Hose — Upper', 'Belts & Hoses', 31000, 56000, 5, 5, '4801234500103', 'Reinforced upper hose with clamps.'],
  ['BAT-60AH', 'Battery 12V 60Ah — Maintenance Free', 'Electrical', 470000, 620000, 8, 2, '4801234500110', 'Sealed maintenance-free battery with 1-year warranty.'],
  ['ELE-H4-12V', 'Headlight Bulb H4 12V 60/55W', 'Electrical', 17000, 32000, 30, 10, '4801234500127', 'Halogen H4 bulb, standard socket.'],
  ['ELE-ALT-90A', 'Alternator Assembly 90A', 'Electrical', 920000, 1250000, 3, 1, '4801234500134', 'Remanufactured alternator with test sheet.'],
  ['SUS-SHK-FRT', 'Shock Absorber — Front Pair', 'Brakes & Suspension', 182000, 285000, 9, 3, '4801234500141', 'Gas-charged front struts, sold per pair.'],
  ['ACC-WIP-18', 'Wiper Blade 18"', 'Body & Accessories', 24000, 42000, 26, 8, '4801234500158', 'Flat-beam wiper blade with hook adapter.'],
  ['FLT-CAB-AC', 'Cabin Filter — Activated Carbon', 'Filters', 44000, 72000, 3, 5, '4801234500165', 'Carbon cabin filter for dust and odor control.'],
  ['FLD-ATF-1L', 'Transmission Fluid 1L — ATF', 'Fluids & Lubricants', 29000, 48000, 18, 6, '4801234500172', 'Automatic transmission fluid, Dexron III.'],
  ['BRG-WHL-FRT', 'Wheel Bearing — Front', 'Brakes & Suspension', 84000, 135000, 8, 3, '4801234500189', 'Sealed front wheel bearing hub assembly.'],
];

const SUPPLIERS = [
  {
    name: 'Northline Auto Parts Trading',
    contactName: 'Rina Bautista',
    phone: '+63 45 861 2244',
    email: 'sales@northline-parts.ph',
    address: 'Lot 4, MacArthur Highway, Angeles City',
    notes: 'Weekly delivery every Tuesday. Accepts returns for wrong part numbers within 5 days.',
  },
  {
    name: 'Delta Lubricants Distributors',
    contactName: 'Marco Lim',
    phone: '+63 2 8842 5590',
    email: 'orders@deltalub.ph',
    address: 'Unit 12, Dagupan St., Caloocan City',
    notes: 'Free delivery for orders above ₱15,000. Oil promos every quarter.',
  },
  {
    name: 'Volta Electrical Supply',
    contactName: 'Grace Tan',
    phone: '+63 45 322 7710',
    email: 'grace@voltaelectrical.ph',
    address: 'G/F Prime Square, San Fernando, Pampanga',
    notes: 'Batteries carry serial numbers; record them on receiving.',
  },
  {
    name: 'Sakura Filters Philippines',
    contactName: 'Kenji Nakamura',
    phone: '+63 2 8551 3388',
    email: 'ph.orders@sakurafilters.example',
    address: 'Laguna Technopark, Biñan, Laguna',
    notes: 'Minimum of 12 pieces per filter SKU.',
  },
];

function buildUsers(base) {
  return USERS.map((user, index) => ({
    id: String(index + 1),
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    active: true,
    mustChangePassword: false,
    demoPassword: DEMO_PASSWORD,
    lastLoginAt: new Date(base.getTime() - (index + 1) * 3_600_000).toISOString(),
    createdAt: new Date(base.getTime() - 60 * DAY).toISOString(),
    updatedAt: new Date(base.getTime() - 60 * DAY).toISOString(),
    deactivatedAt: null,
  }));
}

function buildCategories(base) {
  return CATEGORIES.map((category, index) => ({
    id: String(index + 1),
    name: category.name,
    description: category.description,
    active: true,
    createdAt: new Date(base.getTime() - 60 * DAY).toISOString(),
    updatedAt: new Date(base.getTime() - 60 * DAY).toISOString(),
  }));
}

export function createDemoShop(now = new Date()) {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const elapsed = Math.max(45 * MINUTE, now - todayStart);
  const todayAt = (fraction) => new Date(todayStart.getTime() + Math.round(elapsed * fraction));
  const yesterdayAt = (hours, minutes = 0) => atTime(new Date(todayStart.getTime() - DAY), hours, minutes);
  const daysAgo = (days, hours, minutes = 0) => atTime(new Date(todayStart.getTime() - days * DAY), hours, minutes);

  const shop = createShop({
    settings: SETTINGS,
    users: buildUsers(now),
    categories: buildCategories(now),
  });
  const { state } = shop;

  const openAt = daysAgo(4, 8, 30);
  for (const [sku, name, categoryName, costCents, priceCents, openingStock, reorderLevel, barcode, description] of PRODUCTS) {
    const category = state.categories.find((entry) => entry.name === categoryName);
    shop.addProduct(
      {
        sku,
        name,
        barcode,
        description,
        categoryId: category.id,
        costCents,
        priceCents,
        reorderLevel,
        actorId: '1',
      },
      { at: openAt, openingStock },
    );
  }
  const productBySku = new Map(state.products.map((product) => [product.sku, product]));

  for (const supplier of SUPPLIERS) {
    shop.addSupplier(supplier, daysAgo(45, 9, 0));
  }
  const supplierByName = new Map(state.suppliers.map((supplier) => [supplier.name, supplier]));
  const admin = state.users.find((user) => user.username === 'admin');

  // Purchase orders --------------------------------------------------------
  const draft = shop.createPurchaseOrder(
    {
      supplierId: supplierByName.get('Sakura Filters Philippines').id,
      expectedAt: dateString(new Date(todayStart.getTime() + 3 * DAY)),
      notes: 'Restock timing kits and belts before the weekend rush.',
      lines: [
        { productId: productBySku.get('ENG-TB-KIT').id, orderedQty: 4, unitCostCents: 198000 },
        { productId: productBySku.get('BLT-4PK825').id, orderedQty: 10, unitCostCents: 40000 },
      ],
    },
    admin,
    daysAgo(1, 16, 10),
  );

  const ordered = shop.createPurchaseOrder(
    {
      supplierId: supplierByName.get('Northline Auto Parts Trading').id,
      expectedAt: dateString(new Date(todayStart.getTime() + 2 * DAY)),
      notes: 'Customer reservations for brake pads and shocks.',
      lines: [
        { productId: productBySku.get('BRK-PAD-FRT').id, orderedQty: 8, unitCostCents: 115000 },
        { productId: productBySku.get('SUS-SHK-FRT').id, orderedQty: 6, unitCostCents: 178000 },
        { productId: productBySku.get('BRG-WHL-FRT').id, orderedQty: 6, unitCostCents: 82000 },
      ],
    },
    admin,
    daysAgo(1, 9, 45),
  );
  shop.placePurchaseOrder(ordered.id, daysAgo(1, 10, 5));

  const partial = shop.createPurchaseOrder(
    {
      supplierId: supplierByName.get('Delta Lubricants Distributors').id,
      expectedAt: dateString(new Date(todayStart.getTime() - 1 * DAY)),
      notes: 'Half delivery accepted; balance arriving with the next truck.',
      lines: [
        { productId: productBySku.get('FLD-COOL-1L').id, orderedQty: 12, unitCostCents: 21000 },
        { productId: productBySku.get('FLD-ATF-1L').id, orderedQty: 12, unitCostCents: 27500 },
      ],
    },
    admin,
    daysAgo(4, 14, 0),
  );
  shop.placePurchaseOrder(partial.id, daysAgo(4, 14, 20));
  shop.receivePurchaseOrder(partial.id, {
    actor: admin,
    at: daysAgo(2, 10, 15),
    note: 'Partial delivery from Delta Lubricants.',
    items: partial.lines.map((line) => ({ lineId: line.id, quantity: 6 })),
  });

  const received = shop.createPurchaseOrder(
    {
      supplierId: supplierByName.get('Volta Electrical Supply').id,
      expectedAt: dateString(new Date(todayStart.getTime() - 2 * DAY)),
      notes: 'Batteries and bulbs for the October stock build.',
      lines: [
        { productId: productBySku.get('BAT-60AH').id, orderedQty: 4, unitCostCents: 465000 },
        { productId: productBySku.get('ELE-H4-12V').id, orderedQty: 40, unitCostCents: 16500 },
      ],
    },
    admin,
    daysAgo(5, 11, 30),
  );
  shop.placePurchaseOrder(received.id, daysAgo(5, 11, 50));
  shop.receivePurchaseOrder(received.id, {
    actor: admin,
    at: daysAgo(2, 14, 40),
    note: 'Complete delivery, serials recorded.',
    items: received.lines.map((line) => ({ lineId: line.id, quantity: line.orderedQty })),
  });

  // Historical sales -------------------------------------------------------
  const taxRateBps = state.settings.taxEnabled ? state.settings.taxRateBps : 0;
  const taxInclusive = state.settings.taxInclusive;

  function lineTotal(lines) {
    return lines.reduce(
      (sum, line) => sum + calculateLine({
        unitPriceCents: productBySku.get(line.sku).priceCents,
        quantity: line.qty,
        discountBps: line.discountBps || 0,
        taxRateBps,
        taxInclusive,
      }).totalCents,
      0,
    );
  }

  const cash = (total) => [{
    method: 'CASH',
    amountCents: total,
    tenderedCents: Math.ceil(total / 10000) * 10000 || total,
  }];
  const card = (total, reference) => [{ method: 'CARD_EXTERNAL', amountCents: total, reference }];
  const split = (total) => {
    const half = Math.floor(total / 2);
    return [
      { method: 'CASH', amountCents: half, tenderedCents: half },
      { method: 'CARD_EXTERNAL', amountCents: total - half, reference: 'SPLIT-CARD' },
    ];
  };

  function sell({ at, username, lines, payment, note = '' }) {
    const actor = state.users.find((user) => user.username === username);
    const total = lineTotal(lines);
    return shop.recordSale({
      at,
      actor,
      terminal: 'Counter 1',
      note,
      lines: lines.map((line) => ({
        productId: productBySku.get(line.sku).id,
        quantity: line.qty,
        discountBps: line.discountBps || 0,
        discountReason: line.reason || '',
        note: line.note || '',
      })),
      payments: payment(total),
    }).sale;
  }

  const sales = [];

  sales.push(sell({
    at: yesterdayAt(9, 10),
    username: 'cashier',
    lines: [{ sku: 'FLT-OIL-450', qty: 1 }, { sku: 'FLT-AIR-680', qty: 1 }, { sku: 'IGN-PLG-IR', qty: 2 }],
    payment: cash,
    note: 'Tune-up package for a Vios.',
  }));
  sales.push(sell({
    at: yesterdayAt(11, 25),
    username: 'cashier2',
    lines: [{ sku: 'BAT-60AH', qty: 1 }, { sku: 'BRK-PAD-FRT', qty: 1 }],
    payment: (total) => card(total, 'TERM-4821'),
  }));
  sales.push(sell({
    at: yesterdayAt(15, 40),
    username: 'cashier2',
    lines: [{ sku: 'FLD-ENG-4L', qty: 3 }],
    payment: cash,
    note: 'Fleet maintenance — three company vans.',
  }));
  sales.push(sell({
    at: yesterdayAt(17, 5),
    username: 'cashier',
    lines: [{ sku: 'HSE-RAD-UP', qty: 1 }, { sku: 'FLD-COOL-1L', qty: 1 }, { sku: 'FLD-ATF-1L', qty: 1 }],
    payment: cash,
  }));

  sales.push(sell({
    at: todayAt(0.12),
    username: 'cashier',
    lines: [{ sku: 'FLT-OIL-450', qty: 2 }, { sku: 'FLD-ENG-4L', qty: 1 }, { sku: 'ACC-WIP-18', qty: 1 }],
    payment: (total) => card(total, 'TERM-4821'),
  }));
  sales.push(sell({
    at: todayAt(0.22),
    username: 'cashier2',
    lines: [{ sku: 'FLT-AIR-680', qty: 1 }, { sku: 'FLT-CAB-AC', qty: 3 }],
    payment: cash,
    note: 'Last three cabin filters on the shelf.',
  }));
  sales.push(sell({
    at: todayAt(0.33),
    username: 'admin',
    lines: [{ sku: 'BRK-PAD-FRT', qty: 1 }, { sku: 'BAT-60AH', qty: 1 }],
    payment: (total) => card(total, 'TERM-7730'),
  }));
  sales.push(sell({
    at: todayAt(0.44),
    username: 'cashier2',
    lines: [{ sku: 'IGN-PLG-IR', qty: 4 }, { sku: 'FLD-COOL-1L', qty: 1 }],
    payment: cash,
  }));
  sales.push(sell({
    at: todayAt(0.54),
    username: 'admin',
    lines: [{ sku: 'FLD-ENG-4L', qty: 2 }, { sku: 'FLD-ATF-1L', qty: 1 }],
    payment: split,
    note: 'Split between cash and the BPI terminal.',
  }));
  sales.push(sell({
    at: todayAt(0.63),
    username: 'cashier',
    lines: [{ sku: 'BLT-4PK825', qty: 1 }, { sku: 'HSE-RAD-UP', qty: 2 }],
    payment: cash,
  }));
  sales.push(sell({
    at: todayAt(0.72),
    username: 'cashier2',
    lines: [
      { sku: 'ELE-H4-12V', qty: 2, discountBps: 500, reason: 'Repeat customer discount' },
      { sku: 'ACC-WIP-18', qty: 2 },
    ],
    payment: (total) => card(total, 'TERM-4821'),
  }));
  const returnedSale = sell({
    at: todayAt(0.82),
    username: 'admin',
    lines: [{ sku: 'BRK-SHOE-RR', qty: 3 }, { sku: 'ENG-TB-KIT', qty: 1 }],
    payment: cash,
    note: 'Rear brake job for a delivery van.',
  });
  sales.push(returnedSale);
  const voidedSale = sell({
    at: todayAt(0.9),
    username: 'cashier',
    lines: [{ sku: 'ELE-ALT-90A', qty: 1 }],
    payment: (total) => card(total, 'TERM-4821'),
  });
  sales.push(voidedSale);

  const after = (sale, minutes) => {
    const time = new Date(Math.min(now.getTime() - 1500, new Date(sale.createdAt).getTime() + minutes * MINUTE));
    return time.getTime() > new Date(sale.createdAt).getTime()
      ? time
      : new Date(new Date(sale.createdAt).getTime() + 1500);
  };

  const returnedLine = returnedSale.items.find((item) => item.sku === 'BRK-SHOE-RR');
  shop.recordReturn(returnedSale.id, {
    at: after(returnedSale, 14),
    actor: admin,
    reason: 'Customer ordered the wrong shoe size.',
    refundMethod: 'CASH',
    items: [{ saleItemId: returnedLine.id, quantity: 1, restock: false }],
  });

  shop.recordVoid(voidedSale.id, {
    at: after(voidedSale, 6),
    actor: admin,
    reason: 'Wrong item keyed at the counter — replaced with the correct part.',
  });

  // A stock count correction so the movement ledger shows an adjustment.
  const bulbs = productBySku.get('ELE-H4-12V');
  shop.applyStockChange(bulbs, {
    type: 'ADJUSTMENT',
    quantityDelta: -1,
    valueDeltaCents: -bulbs.costCents,
    businessDate: localDate(now),
    referenceType: 'adjustment',
    reference: 'Stock adjustment',
    referenceId: null,
    reason: 'Broken bulb found during the morning cycle count.',
    actorId: '1',
    occurredAt: new Date(now.getTime() - MINUTE),
  });

  shop.reindex();
  return shop;
}
