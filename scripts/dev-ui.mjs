#!/usr/bin/env node
/**
 * Tiny static server for the Stage 1 UI prototype.
 * Node built-ins only. This is not an Express business API.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const publicRoot = resolve(here, '..', 'public');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3101);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function safePath(urlPath) {
  const decoded = decodeURIComponent((urlPath || '/').split('?')[0]);
  const relative = normalize(decoded).replace(/^([/\\])+/, '');
  const candidate = resolve(publicRoot, relative);
  if (candidate !== publicRoot && !candidate.startsWith(publicRoot + sep)) return null;
  return candidate;
}

const server = createServer(async (request, response) => {
  try {
    let target = safePath(request.url || '/');
    if (!target) {
      response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Forbidden');
      return;
    }
    let info = await stat(target).catch(() => null);
    if (info?.isDirectory()) {
      target = join(target, 'index.html');
      info = await stat(target).catch(() => null);
    }
    if (!info?.isFile()) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found. The Stage 1 prototype uses hash routes, for example /#/dashboard.');
      return;
    }
    const body = await readFile(target);
    response.writeHead(200, {
      'content-type': mimeTypes[extname(target).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    });
    response.end(body);
  } catch (error) {
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(`Static server error: ${error.message}`);
  }
});

server.listen(port, host, () => {
  console.log('Stage 1 UI prototype (mock data only)');
  console.log(`Open: http://${host}:${port}/#/dashboard`);
  console.log(`Serving: ${publicRoot}`);
  console.log('No API, database, authentication, or persistence is running.');
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
