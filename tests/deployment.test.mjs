import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import https from 'node:https';
import path from 'node:path';
import { once } from 'node:events';
import { spawn, execFileSync } from 'node:child_process';
import {
  api,
  assertStatus,
  createCategory,
  setupAdmin,
  startTestServer,
  TEST_BOOTSTRAP_TOKEN,
} from './helpers.mjs';

let ctx;

before(async () => {
  ctx = await startTestServer();
});
after(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await ctx.reset();
});

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  server.close();
  await once(server, 'close');
  return port;
}

function childEnv(overrides) {
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    MIGRATION_DATABASE_URL: process.env.TEST_MIGRATION_DATABASE_URL,
    BOOTSTRAP_TOKEN: TEST_BOOTSTRAP_TOKEN,
    ALLOW_SETUP: 'true',
    COOKIE_SECURE: 'false',
    LOG_REQUESTS: 'false',
    SESSION_COOKIE_NAME: 'at_deploy_session',
    TRUST_PROXY: 'false',
    ALLOW_INSECURE_LAN: '',
    TLS_CERT_FILE: '',
    TLS_KEY_FILE: '',
    ...overrides,
  };
  return env;
}

function spawnServer(env) {
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: path.resolve('.'),
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.output = '';
  child.stdout.on('data', (chunk) => { child.output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { child.output += chunk.toString(); });
  return child;
}

async function waitFor(predicate, { timeoutMs = 20000, intervalMs = 150 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(intervalMs);
  }
  throw new Error(`timed out waiting for condition: ${lastError?.message || 'no result'}`);
}

async function waitHealth(port, { tls = false } = {}) {
  return waitFor(async () => {
    if (!tls) {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.status !== 200) return false;
      return (await response.json()).status === 'ok';
    }
    return new Promise((resolve, reject) => {
      const request = https.get(
        { hostname: '127.0.0.1', port, path: '/api/health', rejectUnauthorized: false, timeout: 1500 },
        (response) => {
          let raw = '';
          response.on('data', (chunk) => { raw += chunk.toString(); });
          response.on('end', () => {
            try {
              resolve(response.statusCode === 200 && JSON.parse(raw).status === 'ok');
            } catch {
              resolve(false);
            }
          });
        },
      );
      request.on('error', reject);
      request.on('timeout', () => request.destroy(new Error('health request timed out')));
    });
  });
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), delay(5000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function expectExit(child, { timeoutMs = 15000 } = {}) {
  if (child.exitCode === null) {
    await Promise.race([once(child, 'exit'), delay(timeoutMs)]);
  }
  if (child.exitCode === null) {
    child.kill('SIGKILL');
    throw new Error('server did not exit when expected');
  }
  return child.exitCode;
}

test('a server restart preserves database data and an active session', async () => {
  const port = await freePort();
  let child = spawnServer(childEnv({ HOST: '127.0.0.1', PORT: String(port) }));
  try {
    await waitHealth(port);
    const admin = await setupAdmin(`http://127.0.0.1:${port}`);
    const category = await createCategory(`http://127.0.0.1:${port}`, admin, 'Restart Persistence');
    await stopServer(child);

    child = spawnServer(childEnv({ HOST: '127.0.0.1', PORT: String(port) }));
    await waitHealth(port);
    const boot = await api(`http://127.0.0.1:${port}`, 'GET', '/api/bootstrap', { session: admin });
    assertStatus(boot, 200, 'bootstrap after restart');
    assert.equal(boot.body.user.username, 'owner');
    assert.ok(boot.body.categories.some((row) => row.id === category.id));
    assert.equal(boot.body.meta.dataSource, 'PostgreSQL via Express API');
  } finally {
    await stopServer(child);
  }
});

test('the server refuses to expose plain HTTP on a non-loopback address', async () => {
  const port = await freePort();
  const child = spawnServer(childEnv({ HOST: '0.0.0.0', PORT: String(port) }));
  const status = await expectExit(child);
  assert.notEqual(status, 0);
  assert.match(child.output, /Refusing to listen on a non-loopback address without HTTPS/);
});

test('TLS mode serves the API on all interfaces', async (t) => {
  let openssl;
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    openssl = true;
  } catch {
    openssl = false;
  }
  if (!openssl) {
    t.skip('openssl is not available; cannot generate a self-signed certificate');
    return;
  }

  const port = await freePort();
  const directory = path.resolve('.tmp', `tls-${port}`);
  fs.mkdirSync(directory, { recursive: true });
  const keyFile = path.join(directory, 'key.pem');
  const certFile = path.join(directory, 'cert.pem');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-nodes', '-days', '1',
    '-keyout', keyFile, '-out', certFile,
    '-subj', '/CN=127.0.0.1',
    '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost',
  ], { stdio: 'ignore' });

  const child = spawnServer(childEnv({
    HOST: '0.0.0.0',
    PORT: String(port),
    TLS_CERT_FILE: certFile,
    TLS_KEY_FILE: keyFile,
  }));
  try {
    const healthy = await waitHealth(port, { tls: true });
    assert.equal(healthy, true);
  } finally {
    await stopServer(child);
  }
});

test('backup and restore reproduce the shop, audit history, and least-privilege grants', async () => {
  const admin = await setupAdmin(baseUrl());
  const category = await createCategory(baseUrl(), admin, 'Backup Marker');
  const categoryCount = async () => Number((await ctx.owner.query('SELECT count(*)::int AS n FROM categories')).rows[0].n);
  assert.ok((await categoryCount()) >= 1);

  const stamp = Date.now();
  const dumpFile = path.resolve('.tmp', `backup-${stamp}.dump`);
  const pgBin = process.env.PG_BIN;
  const backup = await runScript('scripts/backup.mjs', [
    '--database-url', process.env.TEST_MIGRATION_DATABASE_URL,
    '--output', dumpFile,
  ], { PG_BIN: pgBin });
  assert.equal(backup.status, 0, backup.stderr);
  const summary = JSON.parse(backup.stdout);
  assert.equal(summary.ok, true);
  assert.ok(summary.bytes > 0);
  assert.match(summary.sha256, /^[a-f0-9]{64}$/);
  assert.equal(fs.existsSync(dumpFile), true);
  assert.equal(fs.existsSync(`${dumpFile}.json`), true);
  const manifest = JSON.parse(fs.readFileSync(`${dumpFile}.json`, 'utf8'));
  assert.equal(manifest.database.includes('autotrack_test'), true);
  assert.ok(manifest.migrations.length >= 3);

  await ctx.owner.query('DELETE FROM categories WHERE id = $1', [category.id]);
  assert.equal(await categoryCount(), 0);

  const restore = await runScript('scripts/restore.mjs', [
    '--file', dumpFile,
    '--target', process.env.TEST_MIGRATION_DATABASE_URL,
    '--app-url', process.env.TEST_DATABASE_URL,
  ], { PG_BIN: pgBin });
  assert.equal(restore.status, 0, restore.stderr);
  const restored = JSON.parse(restore.stdout);
  assert.equal(restored.ok, true);
  assert.ok(restored.tables >= 10);
  assert.equal(restored.shopName, 'Auto-Track');
  assert.equal(restored.appRoleReadable, true);
  assert.equal(restored.appRoleCannotDeleteAudit, true);

  const row = await ctx.owner.query('SELECT name FROM categories WHERE id = $1', [category.id]);
  assert.equal(row.rows[0].name, 'Backup Marker');
  const audit = await ctx.owner.query('SELECT count(*)::int AS n FROM audit_log');
  assert.ok(audit.rows[0].n >= 1);
  await ctx.reset();
});

function baseUrl() {
  return ctx.base;
}

function runScript(script, args, envOverrides = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: path.resolve('.'),
      env: { ...process.env, ...envOverrides },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('close', (code) => resolve({ status: code, stdout, stderr }));
  });
}
