import { assertReady, startServer } from './app.js';
import { pool } from './db.js';

try {
  await pool.query('SELECT 1');
  await assertReady();
  startServer();
} catch (error) {
  console.error(JSON.stringify({ level: 'error', msg: 'startup failed', error: error.message }));
  await pool.end().catch(() => {});
  process.exit(1);
}
