# Install on a fresh machine

This is the full path from a bare machine to a working shop server. Everything runs on
one computer; PostgreSQL stays on loopback.

## 1. Prerequisites

- Node.js 24 or newer (`node --version`)
- PostgreSQL 17, installed normally so `psql`, `pg_dump`, and `pg_ctl` are available
  (on Windows the default install path is under `C:\Program Files\PostgreSQL\17\bin`)

This repository does **not** ship PostgreSQL binaries or a database cluster.

## 2. Create the roles and databases

Run as a PostgreSQL superuser (for example `psql -U postgres -p 5433`). Pick real
passwords; the app never stores them, they only live in `.env`.

```sql
CREATE ROLE autotrack_owner LOGIN PASSWORD 'replace-with-a-long-password';
CREATE ROLE autotrack_app   LOGIN PASSWORD 'replace-with-another-long-password';

CREATE DATABASE autotrack_dev  OWNER autotrack_owner;
CREATE DATABASE autotrack_test OWNER autotrack_owner;
```

Two roles on purpose:

| Role | Purpose |
|---|---|
| `autotrack_owner` | Owns the schema, runs migrations, makes backups |
| `autotrack_app` | The API's runtime login; DML only, no schema changes |

## 3. Grant the runtime role (before migrating)

Connect **to each database** as `autotrack_owner` and run this in that database. It must
run before the migrations so the tables are created with the grants already applied.

```sql
GRANT USAGE ON SCHEMA public TO autotrack_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO autotrack_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO autotrack_app;
```

Repeat the block for `autotrack_test`, which the test suite uses.

After migrations, `migrations/003_least_privilege.sql` removes the writes the API must
never perform: no `DELETE` except on draft purchase lines, and no `UPDATE` on
`audit_log`, `stock_movements`, `sale_items`, `sale_payments`, `sale_returns`,
`sale_return_items`, `sale_voids`, `refunds`, `po_receipts`, or `po_receipt_items`.
If you add tables later, re-run the revoke block in that migration.

## 4. Configure the app

```bash
npm ci
cp .env.example .env
```

Fill in `.env`:

```ini
NODE_ENV=development
PORT=3100
HOST=127.0.0.1

DATABASE_URL=postgres://autotrack_app:your-app-password@127.0.0.1:5433/autotrack_dev
MIGRATION_DATABASE_URL=postgres://autotrack_owner:your-owner-password@127.0.0.1:5433/autotrack_dev

TEST_DATABASE_URL=postgres://autotrack_app:your-app-password@127.0.0.1:5433/autotrack_test
TEST_MIGRATION_DATABASE_URL=postgres://autotrack_owner:your-owner-password@127.0.0.1:5433/autotrack_test

COOKIE_SECURE=false
ALLOW_SETUP=true
BOOTSTRAP_TOKEN=<paste a random 64-character hex string>
```

Generate the token with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Use a different port in the URLs if your PostgreSQL does not listen on 5433. If
`pg_dump`/`pg_restore` are not on `PATH`, also set `PG_BIN` to the PostgreSQL `bin`
directory — the backup and restore scripts use it.

## 5. Migrate and start

```bash
node scripts/migrate.mjs
node scripts/migrate.mjs --status     # expect 001_core, 002_immutability, 003_least_privilege
npm start
```

Open `http://127.0.0.1:3100/` and complete first-run setup with the `BOOTSTRAP_TOKEN`.
The first account created there is the administrator; cashier accounts are created from
**Users & roles** inside the app.

Then set `ALLOW_SETUP=false` in `.env`, restart, and delete the bootstrap token.

## 6. Check it

```bash
curl http://127.0.0.1:3100/api/health        # {"status":"ok","database":"ok",...}
node scripts/check-ui.mjs
node scripts/test-ui.mjs
npm test                                     # uses autotrack_test only
```

Sanity-check the runtime role's privileges (run as `autotrack_owner`):

```sql
SELECT privilege_type, count(*)
  FROM information_schema.role_table_grants
 WHERE grantee = 'autotrack_app' AND table_schema = 'public'
 GROUP BY privilege_type ORDER BY privilege_type;
```

Expected after all three migrations: `SELECT` 22 tables, `INSERT` 21, `UPDATE` 11,
`DELETE` 1 (only `purchase_order_items`).

## Notes

- `pgdata` (the cluster directory) must never be committed or copied while PostgreSQL is
  running. Use `node scripts/backup.mjs` for backups.
- The app refuses to listen on a non-loopback address unless TLS is configured.
- PostgreSQL listening on `127.0.0.1` only is intentional. Do not expose it.

This recipe was verified on 2026-10-23 by creating a scratch database from these exact
statements, running all three migrations against it, and confirming that `autotrack_app`
could read and insert, received the privilege counts above, and was refused an `UPDATE`
on `audit_log` with SQLSTATE `42501`.
