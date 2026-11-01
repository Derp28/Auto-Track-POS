# Auto-Track POS - Operations (local MySQL edition)

This runbook covers the current local shop server. The active mode is self-hosted
operation on `127.0.0.1` with MySQL on the same machine. LAN/TLS deployment and the
production recovery drill are deferred by user direction. Do not use the LAN procedure or
claim production readiness until those steps are re-authorized and verified.

## Runtime layout

- Node.js 24 or newer.
- MySQL 8.4 LTS on `127.0.0.1:3307` (loopback only; the development copy uses a portable
  ZIP under `.runtime`).
- Express serves the API and the static frontend on port `3100` by default.
- MySQL is the only system of record. The browser never connects to it directly.
- `autotrack_migrator` owns the schema. `autotrack_app` is restricted by
  `migrations-mysql/003_least_privilege.sql`.
- Secrets live in `.env`; `.env`, `.runtime`, backups, and shop data are ignored by Git.

### Where MySQL runs

The app and MySQL normally run on the same Windows machine with MySQL bound to
`127.0.0.1`. Do not bind MySQL to `0.0.0.0`; do not create a firewall rule for the MySQL
port. The server starts even when MySQL is down, but `/api/health` reports the database as
unavailable until it is reachable.

### Start and stop

```powershell
# Start MySQL (portable runtime)
$ini = (Resolve-Path .runtime\my.ini).Path
$mysqld = (Resolve-Path .runtime\mysql-8.4.13-winx64\bin\mysqld.exe).Path
Start-Process -FilePath $mysqld -ArgumentList "--defaults-file=`"$ini`"" -WindowStyle Hidden

# Start the app (normal way)
npm start

# Or use the launcher, which starts both and opens the browser
start.cmd
```

Send `Ctrl+C` once to stop Express. MySQL stops when the host stops; for the portable
runtime, stop it with `mysqladmin --port 3307 -u root -p shutdown`. Do not kill a process
during an active checkout.

Health check:

```bash
curl http://127.0.0.1:3100/api/health
```

Expected response contains `"status":"ok"` and `"database":"ok"`.

## First-time setup

1. Copy `.env.example` to `.env` and replace every `CHANGE_ME` value.
2. Keep `HOST=127.0.0.1` for a single-machine install.
3. Load MySQL time-zone tables and verify `CONVERT_TZ(..., 'Asia/Manila')` is not `NULL`
   (see `docs/INSTALL.md`).
4. Apply migrations:
   ```bash
   node scripts/migrate.mjs
   node scripts/migrate.mjs --status
   ```
5. Use `setup.cmd` for the first-run desktop/auto-start options, or run
   `node server/index.js` and open `http://127.0.0.1:3100/`.
6. Create the first administrator with the `BOOTSTRAP_TOKEN` from `.env`.
7. Set `ALLOW_SETUP=false` and remove or rotate `BOOTSTRAP_TOKEN` after setup.

The setup screen reports "Setup is locked" when no bootstrap token is configured.

### First-run launcher

`setup.cmd` opens a native first-run dialog with two optional per-user choices:

- **Create a desktop shortcut** - starts MySQL and Express, then opens the POS.
- **Start Auto-Track POS automatically when I sign in** - adds a hidden entry to the
  current user's Startup folder that starts MySQL and Express in the background.

Both are per-user, require no administrator rights, and can be removed from the desktop or
Startup folder. They are not Windows services and do not open a browser at sign-in. The
marker and logs live in `.runtime`.

## Verification commands

```bash
node scripts/check-ui.mjs
node scripts/test-ui.mjs
node --test --test-concurrency=1 "tests/*.test.mjs"
npm audit --audit-level=high
```

The backend suite uses `autotrack_test_mysql` and resets only that database. It refuses to
run unless `TEST_DATABASE_URL` contains `autotrack_test`.

Latest recorded result (2026-11-01, MySQL 8.4.13): **84/84 backend/browser tests
passing**, 285 static UI checks, 45 client-logic checks. Re-run the commands above before
trusting this record after any change.

## Backup

Backups use `mysqldump` SQL format plus a SHA-256 file and JSON manifest.

```bash
node scripts/backup.mjs --dir C:\AutoTrack\backups
```

Optional explicit source and file name:

```bash
node scripts/backup.mjs \
  --database-url "$MIGRATION_DATABASE_URL" \
  --output C:\AutoTrack\backups\shop-2026-11-01.dump
```

`MYSQL_BIN` may point at the MySQL `bin` directory. If unset, the script looks in
`.runtime/mysql-8.4.13-winx64/bin` and then `PATH`. Each backup creates:

- `*.dump` - SQL dump with tables, data, triggers, and the business-date function
- `*.dump.sha256` - checksum
- `*.dump.json` - timestamp, database, shop, migration versions, bytes, checksum

The automated deployment test verifies backup and restore against
`autotrack_test_mysql`, including restored categories, audit history, readable app role,
and denial of audit deletion. Verified on 2026-11-01: restore produced 22 tables, 3
migrations, shop `Auto-Track`, and both app-role checks true.

**Gap:** there is no scheduled backup job, retention policy, off-site copy, encryption
step, or alerting. Store backups outside the application host and protect them as
sensitive data.

## Restore

Restore is destructive to the target database. Stop the shop server first.

```bash
node scripts/restore.mjs \
  --file C:\AutoTrack\backups\shop-2026-11-01.dump \
  --target "$MIGRATION_DATABASE_URL" \
  --app-url "$DATABASE_URL"
```

The script checks the SHA-256 file, restores with the MySQL client, and reapplies the
least-privilege runtime grants. Then:

1. Run `node scripts/migrate.mjs --status`.
2. Start the server and check `/api/health`.
3. Sign in and compare product, stock, sale, return, void, and audit counts.
4. Verify a backup created after the restore.

No production restore drill has been completed. The automated suite covers only the
isolated test database.

## Security operations

- MySQL must listen on loopback only. Confirm with:
  ```sql
  SHOW VARIABLES LIKE 'bind_address';
  SHOW VARIABLES LIKE 'port';
  ```
- Do not enable `ALLOW_INSECURE_LAN` on a shop network. It exists only for isolated tests.
- Use TLS for non-loopback access and set `COOKIE_SECURE=true`.
- Restrict the firewall to the shop subnet and only the application port.
- Never expose the POS to the public internet or use tunnels/port forwarding.
- Never store PAN, CVV, expiry, track data, or PINs. `CARD_EXTERNAL` accepts only an
  optional terminal reference.
- Review audit records for setup, user, settings, stock, sale, return, void, and reprint
  actions.
- Rotate passwords after any suspicion of compromise; password resets revoke sessions.

## Known operational gaps

- No Windows service installer or automatic restart policy. Auto-start is a per-user
  Startup-folder entry.
- No multi-client LAN pilot on a second physical machine.
- No scheduled or off-site backup, retention automation, or production recovery drill.
- No printer-specific validation; printing depends on the browser and OS driver.
- No offline checkout or sync. If the server is unreachable, checkout must stop.
- No accounting/AP integration; deferred by requirement.
- No production readiness claim. GATE-3 remains deferred.
