# Auto-Track POS — Operations

This runbook covers the current Stage 2 shop server. The active mode is local
self-hosted operation on `127.0.0.1` with the database on the same machine. LAN/TLS
deployment and the production recovery drill are deferred by user direction. Do not use
the LAN procedure or claim production readiness until those steps are re-authorized and
verified.

## Runtime layout

- Node.js 24 or newer.
- PostgreSQL 17 on `127.0.0.1:5433` (loopback only).
- Express serves the API and the static frontend on port `3100` by default.
- PostgreSQL is the only system of record. The browser never connects to it directly.
- The migration role owns the schema. The runtime role is restricted by
  `003_least_privilege.sql`.
- Secrets live in `.env`; `.env` is ignored by Git.

### Where PostgreSQL runs

The app and PostgreSQL normally run on the same machine with PostgreSQL bound to
`127.0.0.1`. If Node runs in WSL while PostgreSQL runs on Windows (or the reverse), both
sides must share loopback access — for example WSL mirrored networking
(`networkingMode=mirrored` in `%USERPROFILE%\.wslconfig`). NAT mode cannot reach a
loopback-only database on the other side.

The server starts even when PostgreSQL is down, but `/api/health` reports the database as
unavailable until it is reachable.

### Database files

This repository does not ship a PostgreSQL cluster or PostgreSQL binaries. Create the
roles, databases, and grants as described in `docs/INSTALL.md`, and keep the data
directory outside the repository. Never commit a `pgdata` directory, copy one while
PostgreSQL is running, or hand one to another machine — use `pg_dump`
(`node scripts/backup.mjs`) instead.

## First-time setup

1. Copy `.env.example` to `.env` and replace every `CHANGE_ME` value.
2. Keep `HOST=127.0.0.1` for a single-machine install.
3. Apply migrations:
   ```bash
   node scripts/migrate.mjs
   node scripts/migrate.mjs --status
   ```
4. Start the server:
   ```bash
   node server/index.js
   ```
5. Open `http://127.0.0.1:3100/`.
6. Create the first administrator with the `BOOTSTRAP_TOKEN` from `.env`.
7. Set `ALLOW_SETUP=false` and remove/rotate `BOOTSTRAP_TOKEN` after setup.

The setup screen reports "Setup is locked" when no bootstrap token is configured.

## Normal start and stop

```bash
node server/index.js
```

Send `Ctrl+C` once. The server stops accepting requests, closes the HTTP server, and
closes the PostgreSQL pool. Do not kill the process repeatedly during an active checkout.

Health check:

```bash
curl http://127.0.0.1:3100/api/health
```

Expected response contains `"status":"ok"` and `"database":"ok"`.

## Verification commands

```bash
node scripts/check-ui.mjs
node scripts/test-ui.mjs
node --test --test-concurrency=1 "tests/*.test.mjs"
npm audit --audit-level=high
```

The backend suite uses `autotrack_test` and resets only that database. It refuses to run
unless `TEST_DATABASE_URL` contains `autotrack_test`.

Latest recorded result: **75 backend/browser tests passing**, 275 UI static checks,
45 client-logic checks, and 0 high-severity npm audit findings.

## Backup

Backups use `pg_dump` custom format plus a SHA-256 file and JSON manifest.

```bash
node scripts/backup.mjs --dir C:\AutoTrack\backups
```

Optional explicit source and file name:

```bash
node scripts/backup.mjs \
  --database-url "$MIGRATION_DATABASE_URL" \
  --output C:\AutoTrack\backups\shop-2026-10-21.dump
```

`PG_BIN` may point at the PostgreSQL `bin` directory when `pg_dump` is not on `PATH`.
Each backup creates:

- `*.dump` — custom-format database backup
- `*.dump.sha256` — checksum
- `*.dump.json` — timestamp, database, shop, migration versions, bytes, checksum

Verified on 2026-10-21 against `autotrack_dev`: 109,535 bytes, three migrations,
SHA-256 `587d0a47a780a32fcc02fa121fe1fd7038685c2929ce0a6275fa4538e2a6bb0a`.

**Gap:** there is no scheduled backup job, retention policy, off-site copy, encryption
step, or alerting. Store backups outside the application host and protect them as
sensitive data.

## Restore

Restore is destructive to the target database. Stop the shop server first.

```bash
node scripts/restore.mjs \
  --file C:\AutoTrack\backups\shop-2026-10-21.dump \
  --target "$MIGRATION_DATABASE_URL" \
  --app-url "$DATABASE_URL"
```

The script verifies the checksum and manifest, recreates the schema with `pg_restore
--clean --if-exists`, and reapplies runtime grants. Then:

1. Run `node scripts/migrate.mjs --status`.
2. Start the server and check `/api/health`.
3. Sign in and compare product, stock, sale, return, void, and audit counts.
4. Verify a backup created after the restore.

The automated suite verifies backup/restore against the isolated `autotrack_test`
database, including restored categories, audit history, readable app role, and denial of
audit deletion. No production restore drill has been completed yet.

## Security operations

- PostgreSQL must listen on loopback only. Confirm with:
  ```bash
  psql "postgres://...@127.0.0.1:5433/postgres" -c "SHOW listen_addresses;"
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

- No Windows service/daemon installer or automatic restart policy.
- No multi-client LAN pilot on a second physical machine.
- No scheduled or off-site backup, retention automation, or production recovery drill.
- No printer-specific validation; printing depends on the browser and OS driver.
- No offline checkout or sync. If the server is unreachable, checkout must stop.
- No accounting/AP integration; deferred by requirement.
- No production readiness claim. Follow `LAN_SETUP.md` and complete the recovery drill.
