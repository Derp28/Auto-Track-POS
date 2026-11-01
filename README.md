# Auto-Track POS - local MySQL edition

Self-hosted point-of-sale and inventory system for a single auto parts shop with a
service counter. Express 5 API, MySQL 8.4 LTS, server-side sessions, and a
framework-free frontend served by the same process.

This folder is the **local-only MySQL variant** of Auto-Track POS. It keeps the same API,
UI, permission matrix, money rules, inventory ledger, and document workflow as the
PostgreSQL release, but runs on MySQL 8.4 LTS and is published from the `local-mysql`
branch. The `v1.0.0` tag on `main` is unchanged.

Run it on the shop machine, open `http://127.0.0.1:3100`, and sell. There is no cloud
component, no offline mode, and no connection to any payment processor. MySQL stays on
loopback; the browser never connects to it.

## Status

- UI and backend behavior are at parity with the Stage 2 PostgreSQL release.
- MySQL port verification on 2026-10-31/11-01: **84/84 backend and browser tests pass**,
  plus **285 static UI checks** and **45 client logic checks**.
- Local self-hosted operation on `127.0.0.1` is the supported mode.
- LAN/TLS deployment, production recovery drills, and GATE-3 are **not** done.
- **Not production-ready.** Do not use it for live money or stock without an operator
  backup/restore drill and the remaining GATE-3 work.

## What it does

- **Checkout** - barcode/SKU search, per-line percentage discounts, cash and external
  card (terminal reference only), atomic sale commits, idempotent retries.
- **Inventory** - stock on hand, weighted-average cost derived from `stock_value_cents`,
  receiving, adjustments, movements history, low-stock and valuation reports.
- **Returns and voids** - separate documents, proportional or exact cost restoration,
  refund records; payments are immutable.
- **Receipts** - 80 mm browser print or an in-browser PDF download; each reprint is
  audited.
- **Purchasing** - suppliers, purchase orders, partial receipts.
- **Catalog** - categories, products, prices, costs, reorder levels.
- **Users and roles** - `ADMIN` and `CASHIER` with a server-enforced permission matrix.
  Cashiers see only their own sales and never see cost or stock value.
- **Audit** - append-only `audit_log` and `stock_movements`, MySQL triggers, and a
  least-privilege runtime role.
- **Backup/restore** - `mysqldump` backup with SHA-256 manifest and a restore script that
  reapplies the runtime grants.

## Requirements

- Node.js **24 or newer**
- MySQL **8.4 LTS** (this variant was verified with MySQL 8.4.13)
- A machine that can keep the database and the app on loopback

The development copy uses a portable MySQL 8.4.13 ZIP under `.runtime/mysql-8.4.13-winx64`
with data in `.runtime/mysql-data` and port `3307`. That runtime folder is **not** part of
the repository.

## First run

Double-click `setup.cmd`, or run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\first-run.ps1
```

The first-run dialog explains and offers two per-user options:

- **Create a desktop shortcut** - starts MySQL and the POS server, then opens
  `http://127.0.0.1:3100/`. The shortcut contains no password or setup token.
- **Start Auto-Track POS automatically when I sign in to Windows** - adds a hidden entry
  to the current user's Startup folder. It starts MySQL and the POS server in the
  background at sign-in. It does not open a browser and does not require a Windows
  service or administrator rights.

Both options are optional and can be removed later from the desktop or Startup folder.
After the dialog, the launcher applies migrations, starts MySQL if needed, starts the
server, and opens the POS.

For later launches, use the desktop shortcut or `start.cmd`.

## Configure

```bash
npm ci
cp .env.example .env
```

Fill in `.env` with the local MySQL URLs, for example:

```ini
NODE_ENV=development
PORT=3100
HOST=127.0.0.1

DATABASE_URL=mysql://autotrack_app:your-app-password@127.0.0.1:3307/autotrack_local
MIGRATION_DATABASE_URL=mysql://autotrack_migrator:your-migrator-password@127.0.0.1:3307/autotrack_local

TEST_DATABASE_URL=mysql://autotrack_app:your-app-password@127.0.0.1:3307/autotrack_test_mysql
TEST_MIGRATION_DATABASE_URL=mysql://autotrack_migrator:your-migrator-password@127.0.0.1:3307/autotrack_test_mysql

COOKIE_SECURE=false
ALLOW_SETUP=true
BOOTSTRAP_TOKEN=<paste a random 64-character hex string>
```

Apply migrations, then open the URL and complete first-run setup with the
`BOOTSTRAP_TOKEN`:

```bash
node scripts/migrate.mjs
node scripts/migrate.mjs --status
npm start
```

After the first administrator exists, set `ALLOW_SETUP=false` and remove or rotate the
token.

Database role creation and time-zone loading are covered in
[`docs/INSTALL.md`](docs/INSTALL.md).

## Verify

```bash
node scripts/check-ui.mjs      # static UI checks (285)
node scripts/test-ui.mjs       # client logic checks (45)
npm test                       # backend/browser suite (84 tests, needs autotrack_test_mysql)
```

If `mysqldump` is not on `PATH`, set `MYSQL_BIN` to the MySQL `bin` directory before
running the suite; the backup/restore test needs it.

The test suite refuses to run unless `TEST_DATABASE_URL` and
`TEST_MIGRATION_DATABASE_URL` point at an isolated `autotrack_test` database. It truncates
only that database.

## Documentation

| File | Contents |
|---|---|
| `docs/INSTALL.md` | Fresh-machine MySQL roles, database, time zones, first admin |
| `docs/OPERATIONS.md` | Start/stop, health, MySQL backup/restore, security operations |
| `docs/LAN_SETUP.md` | TLS, firewall, second client, concurrency pilot (deferred) |
| `docs/STAGE2_REPORT.md` | What is implemented, evidence, and remaining gaps |
| `INSTALLER_PLAN.md` | First-run launcher and future installer design |
| `PORTING_PLAN.md` | PostgreSQL-to-MySQL port record and compatibility layer |

## Security notes

- MySQL listens on `127.0.0.1` only; the browser never talks to it directly.
- Sessions are server-side and stored in MySQL; cookies are `HttpOnly` and
  `SameSite=Strict`, with CSRF tokens on every mutating request.
- No raw card data is ever accepted: no PAN, CVV, expiry, track data, or PIN.
  `CARD_EXTERNAL` stores an optional terminal reference only.
- Non-loopback access requires HTTPS. Do not expose this app to the public internet.
- Secrets stay in `.env`; never commit `.env`, `.runtime`, backups, or shop data.

## License

MIT - see [`LICENSE`](LICENSE). You may use, modify, and redistribute this software,
including commercially, provided the copyright notice and permission notice are kept.
