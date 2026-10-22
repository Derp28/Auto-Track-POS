import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import express from 'express';
import { config, projectRoot } from './config.js';
import { pool } from './db.js';
import { attachAuth, csrfProtection, requestLogger, securityHeaders } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';
import { catalogRouter, inventoryRouter } from './routes/catalog.js';
import { purchasingRouter, suppliersRouter } from './routes/purchasing.js';
import { salesRouter } from './routes/sales.js';
import { bootstrapRouter, reportsRouter } from './routes/reports.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(securityHeaders);
  app.use(requestLogger);
  app.use(express.json({ limit: '256kb' }));
  app.use(attachAuth);
  app.use(csrfProtection);

  app.get('/api/health', async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', database: 'ok', time: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'degraded', database: 'unavailable', time: new Date().toISOString() });
    }
  });

  app.use('/api/auth', authRouter);
  app.use('/api', adminRouter);
  app.use('/api/catalog', catalogRouter);
  app.use('/api/inventory', inventoryRouter);
  app.use('/api/suppliers', suppliersRouter);
  app.use('/api/purchasing', purchasingRouter);
  app.use('/api/sales', salesRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api', bootstrapRouter);

  app.use('/api', (req, res) => notFoundHandler(req, res));

  const publicDir = path.join(projectRoot, 'public');
  app.use(express.static(publicDir, {
    index: false,
    etag: true,
    setHeaders(res, filePath) {
      res.setHeader('Cache-Control', filePath.endsWith('index.html') ? 'no-store' : 'no-cache');
    },
  }));
  app.get('/', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(publicDir, 'index.html'));
  });
  app.use((req, res, next) => {
    if (req.method === 'GET' && req.accepts('html')) {
      res.setHeader('Cache-Control', 'no-store');
      res.sendFile(path.join(publicDir, 'index.html'));
      return;
    }
    next();
  });
  app.use((req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
  });
  app.use(errorHandler);
  return app;
}

export function startServer() {
  const app = createApp();
  const hasTls = Boolean(config.tlsCertFile && config.tlsKeyFile);
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(config.host);
  if (!loopback && !hasTls && !config.allowInsecureLan) {
    throw new Error(
      'Refusing to listen on a non-loopback address without HTTPS. Provide TLS_CERT_FILE and TLS_KEY_FILE, ' +
        'or set ALLOW_INSECURE_LAN=true only for an isolated test network.',
    );
  }
  let server;
  if (hasTls) {
    server = https.createServer(
      {
        cert: fs.readFileSync(config.tlsCertFile),
        key: fs.readFileSync(config.tlsKeyFile),
        minVersion: 'TLSv1.2',
      },
      app,
    );
  } else {
    server = http.createServer(app);
  }
  server.requestTimeout = 30000;
  server.headersTimeout = 20000;
  server.on('clientError', (error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });
  server.listen(config.port, config.host, () => {
    const scheme = hasTls ? 'https' : 'http';
    console.log(JSON.stringify({
      level: 'info',
      msg: 'Auto-Track POS server listening',
      url: `${scheme}://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${config.port}`,
      host: config.host,
      tls: hasTls,
      env: config.env,
    }));
  });
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(JSON.stringify({ level: 'info', msg: 'shutting down', signal }));
    server.close(async () => {
      await pool.end().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  return server;
}

export async function assertReady() {
  const result = await pool.query('SELECT count(*)::int AS n FROM schema_migrations');
  if (!result.rows[0] || result.rows[0].n === 0) {
    throw new Error('Database is not migrated. Run: npm run migrate');
  }
  const admins = await pool.query("SELECT count(*)::int AS n FROM users WHERE role = 'ADMIN' AND active");
  if (admins.rows[0].n === 0) {
    console.warn(JSON.stringify({ level: 'warn', msg: 'No active administrator. Complete /#/setup or run npm run bootstrap.' }));
  }
}
