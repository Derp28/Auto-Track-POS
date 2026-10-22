import { migrationStatus, runMigrations } from '../server/db/migrate.js';

const status = process.argv.includes('--status');
try {
  if (status) {
    const rows = await migrationStatus();
    for (const row of rows) console.log(`${row.applied ? 'applied' : 'pending'}  ${row.version}`);
  } else {
    await runMigrations();
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
