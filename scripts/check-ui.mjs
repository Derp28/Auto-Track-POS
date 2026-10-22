#!/usr/bin/env node
/**
 * Stage 2 UI checks. Verifies that the browser layer is server-backed, contains
 * no Stage 1 prototype claims, has a complete module graph, and never imports
 * a database driver or mock data module from production code.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const publicDir = join(root, 'public');
const runtimeDirs = ['js', 'views', 'components'];
const failures = [];
let checks = 0;

function check(name, condition, detail = '') {
  checks += 1;
  if (condition) {
    console.log(`PASS  ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir) {
  const files = [];
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

const requiredViews = [
  'login', 'dashboard', 'checkout', 'catalog', 'inventory', 'stock-history',
  'purchasing', 'suppliers', 'purchase-editor', 'purchase-detail', 'sales',
  'sale-detail', 'receipt', 'reports', 'users', 'settings', 'system', 'not-found',
];
for (const view of requiredViews) {
  check(`view exists: ${view}.js`, await exists(join(publicDir, 'views', `${view}.js`)));
}

const runtimeFiles = [];
for (const dir of runtimeDirs) runtimeFiles.push(...await walk(join(publicDir, dir)));
const jsFiles = runtimeFiles.filter((file) => extname(file) === '.js');

for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  check(`syntax: ${file.slice(publicDir.length + 1)}`, result.status === 0, result.stderr.trim().split('\n')[0] || '');
}

const sources = new Map();
for (const file of jsFiles) sources.set(file, await readFile(file, 'utf8'));
const indexHtml = await readFile(join(publicDir, 'index.html'), 'utf8');

check('entry page loads the app module', /<script type="module" src="\/js\/app\.js"><\/script>/.test(indexHtml));
check('entry page has the connection banner', indexHtml.includes('id="connection-banner"'));
check('entry page has no Stage 1 mock-data banner', !indexHtml.includes('Prototype - mock data only. Nothing is saved.'));
check('entry page has no external script or stylesheet', !/(?:src|href)="https?:\/\//i.test(indexHtml));

const forbiddenStorage = /\b(?:localStorage|sessionStorage|indexedDB|serviceWorker)\b/;
for (const [file, source] of sources) {
  const relative = file.slice(publicDir.length + 1);
  check(`no browser business storage: ${relative}`, !forbiddenStorage.test(source));
}

const forbiddenMockImport = /from\s+['"][^'"]*\/mock\/|from\s+['"]\.\.\/mock\//;
const forbiddenMockCopy = /\b(?:mock data only|nothing was saved|stage 1 prototype|mock sale created)\b/i;
const forbiddenDb = /from\s+['"](?:pg|postgres|mysql2?|better-sqlite3)['"]|DATABASE_URL|MIGRATION_DATABASE_URL/;
for (const [file, source] of sources) {
  const relative = file.slice(publicDir.length + 1);
  check(`no mock import: ${relative}`, !forbiddenMockImport.test(source));
  check(`no Stage 1 persistence claim: ${relative}`, !forbiddenMockCopy.test(source));
  check(`no database access: ${relative}`, !forbiddenDb.test(source));
  check(`no raw SQL in browser code: ${relative}`, !/\b(?:SELECT|INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM)\b/.test(source));
}

const importPattern = /\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
let importFailures = 0;
for (const [file, source] of sources) {
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1];
    if (!specifier.startsWith('.') && !specifier.startsWith('/')) continue;
    const base = specifier.startsWith('/')
      ? join(publicDir, specifier)
      : resolve(dirname(file), specifier);
    const candidates = [base, `${base}.js`, join(base, 'index.js')];
    const found = (await Promise.all(candidates.map(exists))).some(Boolean);
    if (!found) {
      importFailures += 1;
      failures.push(`unresolved import in ${file.slice(publicDir.length + 1)}: ${specifier}`);
      console.log(`FAIL  unresolved import in ${file.slice(publicDir.length + 1)}: ${specifier}`);
    }
  }
}
check('all local module imports resolve', importFailures === 0);

const appCss = await readFile(join(publicDir, 'css', 'app.css'), 'utf8');
check('80 mm receipt layout exists', appCss.includes('width: 80mm'));
check('print stylesheet exists', appCss.includes('@media print'));
check('receipt and report print modes are separated', appCss.includes('body.print-receipt') && appCss.includes('body.print-report'));
check('reduced-motion support exists', appCss.includes('prefers-reduced-motion'));

const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
check('test script runs files sequentially with a quoted glob', packageJson.scripts?.test === 'node --test --test-concurrency=1 "tests/*.test.mjs"');
check('verify runs UI checks and the backend suite', packageJson.scripts?.verify?.includes('check-ui.mjs') && packageJson.scripts?.verify?.includes('test-ui.mjs'));
check('playwright-core is available for browser evidence', Boolean(packageJson.devDependencies?.['playwright-core']));
check('no package script points at a missing seed file', await exists(join(root, 'scripts', 'seed-demo.mjs')) || !('seed:demo' in (packageJson.scripts || {})));

const serverIndex = await readFile(join(root, 'server', 'app.js'), 'utf8');
check('server refuses insecure non-loopback serving by default', /ALLOW_INSECURE_LAN/.test(serverIndex));
check('server supports HTTPS', /createHttpsServer|https\.createServer/.test(serverIndex));

console.log('');
if (failures.length) {
  console.error(`check-ui failed: ${failures.length} of ${checks} checks failed.`);
  process.exit(1);
}
console.log(`check-ui passed: ${checks} checks.`);
