#!/usr/bin/env node
/**
 * Build the GitHub Pages demo into docs/.
 *
 *   node scripts/build-demo.mjs
 *
 * The demo reuses the approved frontend exactly as shipped in public/. The
 * build copies that frontend, drops the in-browser mock backend next to it,
 * and patches a handful of strings that would otherwise claim this page is
 * talking to PostgreSQL or a shop server. Every patch is asserted, so an
 * upstream copy change fails the build instead of silently shipping wrong
 * copy.
 *
 * Output layout (GitHub Pages source: main / docs):
 *
 *   docs/index.html          landing page
 *   docs/.nojekyll           serve files as-is
 *   docs/CNAME               optional custom domain (DEMO_DOMAIN=...)
 *   docs/demo/index.html     demo shell (relative asset paths)
 *   docs/demo/css|js|views|components|favicon.svg
 *   docs/demo/demo/boot.js   installs the mock backend + demo toolbar
 *   docs/demo/demo/mock/**   in-memory shop, API, seed data, money helpers
 *
 * Nothing here reads .env, pgdata/, backups/, or node_modules.
 */
import { copyFile, cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docsDir = path.join(root, 'docs');
const outDir = path.join(docsDir, 'demo');
const sourceDir = path.join(root, 'demo');

function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first === -1) {
    throw new Error(
      `demo build: could not patch "${label}".\nExpected text was not found. Update scripts/build-demo.mjs to match public/.`,
    );
  }
  if (source.indexOf(needle, first + needle.length) !== -1) {
    throw new Error(`demo build: "${label}" appears more than once; make the patch more specific.`);
  }
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

async function patchFile(file, patches) {
  let source = await readFile(file, 'utf8');
  for (const [label, needle, replacement] of patches) {
    source = replaceOnce(source, needle, replacement, label);
  }
  await writeFile(file, source, 'utf8');
}

async function sizeOf(file) {
  const info = await stat(file);
  return info.size;
}

if (!outDir.startsWith(docsDir + path.sep)) {
  throw new Error('demo build: refusing to write outside docs/');
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

// 1. Approved frontend, unchanged except for the copy patches below.
for (const folder of ['css', 'js', 'components', 'views']) {
  await cp(path.join(root, 'public', folder), path.join(outDir, folder), { recursive: true });
}
await copyFile(path.join(root, 'public', 'favicon.svg'), path.join(outDir, 'favicon.svg'));

// 2. Demo shell + in-browser backend.
const demoTarget = path.join(outDir, 'demo');
await mkdir(demoTarget, { recursive: true });
await copyFile(path.join(sourceDir, 'boot.js'), path.join(demoTarget, 'boot.js'));
await copyFile(path.join(sourceDir, 'demo.css'), path.join(demoTarget, 'demo.css'));
await cp(path.join(sourceDir, 'mock'), path.join(demoTarget, 'mock'), { recursive: true });
await copyFile(path.join(sourceDir, 'index.html'), path.join(outDir, 'index.html'));

// 3. Money math is copied from the server so demo totals can never drift.
await copyFile(path.join(root, 'server', 'lib', 'money.js'), path.join(demoTarget, 'mock', 'money.js'));

// 4. Copy patches: this page is a browser demo, not a shop server.
await patchFile(path.join(outDir, 'js', 'app.js'), [
  [
    'app.js connection banner',
    'setConnectionBanner(`Live shop server · ${store.meta.dataSource} · ${store.meta.businessDate}`);',
    'setConnectionBanner(`Demo · ${store.meta.dataSource} · ${store.meta.businessDate}`);',
  ],
  [
    'app.js connecting banner',
    "setConnectionBanner('Connecting to the shop server…');",
    "setConnectionBanner('Loading the demo shop…');",
  ],
  ['app.js login note', 'Secure shop server sign-in', 'In-browser demo sign-in'],
]);

await patchFile(path.join(outDir, 'views', 'login.js'), [
  [
    'login live banner',
    "setBanner(`Live shop server · ${state.store.meta.dataSource || 'PostgreSQL'} · ${state.store.meta.businessDate || 'connected'}`);",
    "setBanner(`Demo · ${state.store.meta.dataSource || 'sample data'} · ${state.store.meta.businessDate || 'ready'}`);",
  ],
  [
    'login intro',
    "let intro = 'Use the account issued by your shop administrator. Sessions are stored on the shop server.';",
    "let intro = 'Demo accounts are listed below — pick a role to explore the shop. Nothing you do is saved.';",
  ],
  [
    'login hero eyebrow',
    '<p class="eyebrow">Auto Supply &amp; Service · Live shop server</p>',
    '<p class="eyebrow">Auto Supply &amp; Service · Interactive demo</p>',
  ],
  [
    'login stock claim',
    '<small>Every checkout and receiving record updates inventory in PostgreSQL.</small>',
    '<small>Every checkout and receiving record updates the stock ledger.</small>',
  ],
  [
    'login role claim',
    '<small>Administrators and cashiers sign in with their own server-side account.</small>',
    '<small>Administrators and cashiers sign in with their own demo account.</small>',
  ],
  [
    'login info note',
    '<p><strong>Shop-server access only.</strong> This browser talks to the Express API. It never connects to PostgreSQL directly, and it does not store a database password.</p>',
    '<p><strong>Demo mode.</strong> This page runs entirely in your browser with sample data. Nothing is saved, and no database or shop server is involved.</p>',
  ],
  [
    'login session footer',
    "<span>${icon('lock', 15)} Server-side sessions</span>",
    "<span>${icon('lock', 15)} In-browser demo session</span>",
  ],
  [
    'login system footer',
    "<span>${state.setupRequired ? 'First-run setup' : 'PostgreSQL system of record'}</span>",
    "<span>${state.setupRequired ? 'First-run setup' : 'Sample data · nothing saved'}</span>",
  ],
]);

await patchFile(path.join(outDir, 'components', 'nav.js'), [
  ['nav stage label', 'Stage 2 live shop', 'Interactive demo'],
]);

await patchFile(path.join(outDir, 'components', 'payment-dialog.js'), [
  ['payment dialog footer', 'Saved atomically to the shop server', 'Saved in this browser tab'],
]);

await patchFile(path.join(outDir, 'components', 'stock-adjustment.js'), [
  ['stock adjustment copy', 'Post a stock movement to the shop server.', 'Post a stock movement to the demo ledger.'],
]);

await patchFile(path.join(outDir, 'components', 'user-form.js'), [
  ['user form toast', 'on the shop server.', 'in the demo shop.'],
]);

await patchFile(path.join(outDir, 'components', 'product-form.js'), [
  ['product form toast', 'and saved to the shop server.', 'and saved to the demo shop.'],
]);

await patchFile(path.join(outDir, 'components', 'supplier-form.js'), [
  ['supplier form toast', 'and saved to the shop server.', 'and saved to the demo shop.'],
]);

await patchFile(path.join(outDir, 'components', 'category-manager.js'), [
  ['category archive copy', 'This change is saved to the shop server.', 'This change is saved to the demo shop.'],
]);

await patchFile(path.join(outDir, 'views', 'settings.js'), [
  ['settings footer', 'Saved to PostgreSQL · administrator only', 'Saved to demo fixtures · administrator only'],
  ['settings refresh toast', 'Settings reloaded from the shop server.', 'Settings reloaded from the demo shop.'],
]);

await patchFile(path.join(outDir, 'views', 'reports.js'), [
  ['reports description', 'reports from the shop server.', 'reports from the demo fixtures.'],
]);

await patchFile(path.join(outDir, 'views', 'not-found.js'), [
  [
    'access denied copy',
    'The shop server enforces role permissions for API reads and writes.',
    'The demo enforces role permissions for reads and writes in this tab.',
  ],
]);

await patchFile(path.join(outDir, 'views', 'suppliers.js'), [
  ['supplier archive copy', 'This change is saved to the shop server.', 'This change is saved to the demo shop.'],
]);

await patchFile(path.join(outDir, 'views', 'catalog.js'), [
  ['catalog cashier callout', 'The server enforces this role boundary.', 'The demo API enforces this role boundary.'],
]);

await patchFile(path.join(outDir, 'views', 'inventory.js'), [
  ['inventory cashier callout', 'The server enforces this role boundary.', 'The demo API enforces this role boundary.'],
]);

await patchFile(path.join(outDir, 'views', 'system.js'), [
  [
    'system description',
    'Live server, database, and migration information. This screen does not verify backup or recovery readiness.',
    'Runtime information for this in-browser demo. Nothing here is a real server, database, or deployment.',
  ],
  ['system status badge', 'Shop server connected', 'Browser demo running'],
  [
    'system warning callout',
    '<strong>Verify operations before production use.</strong> Backups are available through <code>scripts/backup.mjs</code>, but no backup schedule, off-site copy, restore drill, firewall review, or production deployment has been verified from this screen.',
    '<strong>Demo only.</strong> This page reports the sample shop held in this tab. The real application ships a PostgreSQL-backed server, backup scripts, and deployment checks; none of them are running here.',
  ],
  ['system app hint', 'hint: `Node ${status.app.node} · ${status.app.environment}`', 'hint: `Demo · ${status.app.environment}`'],
  ['system runtime heading', 'What is running for this shop server.', 'What is running in this tab.'],
  ['system web server label', '<dt>Web server</dt>', '<dt>Page runtime</dt>'],
  ['system web server badge', 'Express API + static UI', 'Static files + mock API'],
  ['system database label', '<dt>PostgreSQL</dt>', '<dt>Database</dt>'],
  ['system database badge', "badge('Connected', 'success')", "badge('None', 'warning')"],
  [
    'system database detail',
    '${escapeHtml(status.database.name)} · server ${escapeHtml(status.database.version)}',
    'Fixture data in memory · nothing is persisted',
  ],
  ['system auth badge', "badge('Session authentication', 'success')", "badge('Demo sign-in', 'success')"],
  [
    'system auth detail',
    'ADMIN and CASHIER roles enforced by the API',
    'ADMIN and CASHIER role rules enforced by the mock API',
  ],
  ['system inventory badge', "badge('PostgreSQL', 'success')", "badge('In-memory ledger', 'warning')"],
  [
    'system inventory detail',
    'Stock value and movement ledger are server-side',
    'Stock value and movements live in this tab',
  ],
  ['system backup badge', "badge('Not scheduled', 'warning')", "badge('Not applicable', 'warning')"],
  [
    'system backup detail',
    'Manual scripts and restore steps require operator verification',
    'Reload the page to reset the sample shop',
  ],
  [
    'system migrations heading',
    '<h2>Schema migrations</h2><p>Applied migrations in this database.</p>',
    '<h2>Schema versions</h2><p>Demo schema versions loaded in this tab.</p>',
  ],
  [
    'system migrations badge',
    '${status.database.migrations.length} applied',
    '${status.database.migrations.length} loaded',
  ],
  [
    'system migrations row badge',
    "badge('Applied', 'success')",
    "badge('Loaded', 'success')",
  ],
  [
    'system browser time label',
    '<span>Server time</span>',
    '<span>Browser time</span>',
  ],
  [
    'system database callout',
    'Database started ${formatDateTime(status.database.startedAt)}. The runtime role is restricted by the least-privilege migration.',
    'Demo fixtures created ${formatDateTime(status.database.startedAt)}. No database or privilege model is involved.',
  ],
  [
    'system config heading',
    'Current shop settings from PostgreSQL.',
    'Current shop settings from the demo fixtures.',
  ],
  ['system data source', '<strong>PostgreSQL via Express API</strong>', '<strong>Sample fixtures in your browser</strong>'],
  [
    'system limits heading',
    'Known gaps that require action before production.',
    'Known gaps in the production system, not in this demo.',
  ],
  [
    'system limits bullet',
    'PostgreSQL should remain bound to loopback. This screen cannot inspect firewall or network rules.',
    'The production deployment keeps PostgreSQL bound to loopback and requires TLS for LAN access; neither is part of this demo.',
  ],
]);

// 5. Landing page + Pages switch.
await mkdir(docsDir, { recursive: true });
await copyFile(path.join(sourceDir, 'landing.html'), path.join(docsDir, 'index.html'));
await writeFile(path.join(docsDir, '.nojekyll'), '');

// Custom domain is opt-in: a CNAME file makes GitHub Pages redirect the
// github.io URL to that domain, so only set DEMO_DOMAIN once DNS is live:
//   DEMO_DOMAIN=autotrackpos.com node scripts/build-demo.mjs
const customDomain = (process.env.DEMO_DOMAIN || '').trim();
if (customDomain) {
  await writeFile(path.join(docsDir, 'CNAME'), `${customDomain}\n`);
}

const files = [
  path.join(outDir, 'index.html'),
  path.join(outDir, 'js', 'app.js'),
  path.join(outDir, 'views', 'login.js'),
  path.join(demoTarget, 'boot.js'),
  path.join(demoTarget, 'mock', 'api.js'),
  path.join(demoTarget, 'mock', 'shop.js'),
  path.join(demoTarget, 'mock', 'seed.js'),
];

console.log('Demo built into docs/demo');
for (const file of files) {
  console.log(`  ${path.relative(root, file).padEnd(42)} ${(await sizeOf(file)).toLocaleString('en-US').padStart(9)} bytes`);
}
console.log('  docs/index.html (landing page) and docs/.nojekyll written');
