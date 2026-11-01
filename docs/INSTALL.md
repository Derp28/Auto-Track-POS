# Install Auto-Track POS on a fresh local machine (MySQL edition)

This is the path from a bare Windows machine to a working local shop server. Everything
runs on one computer; MySQL stays on loopback and the browser talks only to Express.

## 1. Prerequisites

- Node.js **24 or newer** (`node --version`)
- MySQL **8.4 LTS** (the verified build is 8.4.13)
- A local administrator account for the first install

The development copy ships a portable MySQL under `.runtime/mysql-8.4.13-winx64` with
data in `.runtime/mysql-data` and a loopback-only `my.ini` on port `3307`. That folder is
local state and must not be committed. A normal MySQL Server 8.4 installation also works;
substitute its port and binary path below.

## 2. Start MySQL on loopback

For the portable runtime in this folder:

```powershell
$ini = (Resolve-Path .runtime\my.ini).Path
$mysqld = (Resolve-Path .runtime\mysql-8.4.13-winx64\bin\mysqld.exe).Path
Start-Process -FilePath $mysqld -ArgumentList "--defaults-file=`"$ini`"" -WindowStyle Hidden
```

`my.ini` must keep `bind-address=127.0.0.1`, a non-public port (the development copy uses
`3307`), `character-set-server=utf8mb4`, and `default-time-zone=+00:00`.

Do not create a firewall rule for the MySQL port and do not bind MySQL to `0.0.0.0`.

## 3. Create the databases and roles

Connect as a MySQL administrator (for example `mysql -u root -p --port 3307`) and run the
following, replacing every password. Use different long random passwords for the two
roles and both databases.

```sql
CREATE DATABASE autotrack_local
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE autotrack_test_mysql
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE USER 'autotrack_migrator'@'localhost' IDENTIFIED BY 'replace-with-a-long-password';
CREATE USER 'autotrack_app'@'localhost' IDENTIFIED BY 'replace-with-another-long-password';

GRANT ALL PRIVILEGES ON autotrack_local.*      TO 'autotrack_migrator'@'localhost' WITH GRANT OPTION;
GRANT ALL PRIVILEGES ON autotrack_test_mysql.* TO 'autotrack_migrator'@'localhost' WITH GRANT OPTION;

-- This initial read grant lets migration 003 apply the least-privilege matrix.
GRANT SELECT ON autotrack_local.*      TO 'autotrack_app'@'localhost';
GRANT SELECT ON autotrack_test_mysql.* TO 'autotrack_app'@'localhost';
```

| Role | Purpose |
|---|---|
| `autotrack_migrator` | Owns the schema, runs migrations, creates the app grants, makes backups |
| `autotrack_app` | The API's runtime login; table-specific DML only, never schema changes |

`migrations-mysql/003_least_privilege.sql` runs as the migrator and replaces the app's
database-wide rights with table-specific grants: no `DELETE` except draft purchase lines,
and no `UPDATE` on audit, stock movement, sale payment, refund, return, void, or receipt
rows.

## 4. Load MySQL time-zone tables

`current_business_date()` converts UTC to the shop time zone with `CONVERT_TZ`. MySQL
returns `NULL` for named zones such as `Asia/Manila` until its time-zone tables are loaded.
The app then fails loudly instead of writing the wrong business date.

On Windows, the reliable path is:

1. Obtain the IANA time-zone database (`tzdata`) and compile it with `zic -b fat`.
2. Run `mysql_tzinfo_to_sql <zoneinfo-directory> | mysql -u root -p --port 3307 mysql`.

The development runtime was populated this way for all 597 IANA names. Verify before
using the shop database:

```sql
SELECT CONVERT_TZ('2026-01-01 00:00:00', '+00:00', 'Asia/Manila');
-- must return 2026-01-01 08:00:00, not NULL
```

Do not skip this step; every sale, receipt, return, and report uses the business date.

## 5. Configure the app

```bash
npm ci
cp .env.example .env
```

Fill in `.env`:

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

Generate the setup token with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Never commit `.env`, `.runtime`, backups, or shop data.

## 6. Migrate and start

```bash
node scripts/migrate.mjs
node scripts/migrate.mjs --status
```

The second command must show `001_core`, `002_immutability`, and
`003_least_privilege` as applied for the selected database.

Start the normal way, or use the first-run launcher:

```powershell
setup.cmd
```

The launcher offers the two per-user options (desktop shortcut and start at Windows
sign-in), then starts MySQL if needed, applies migrations, starts Express, and opens
`http://127.0.0.1:3100/`.

## 7. Create the first administrator

Open `http://127.0.0.1:3100/`, complete the setup form with the `BOOTSTRAP_TOKEN`, and
sign in. Then:

1. Set `ALLOW_SETUP=false` in `.env`.
2. Remove or rotate `BOOTSTRAP_TOKEN`.
3. Restart the app.
4. Record the administrator recovery process outside the app; there is no password
   recovery e-mail.

## 8. Verify the installation

```bash
node scripts/check-ui.mjs
node scripts/test-ui.mjs
npm test
```

`npm test` uses only `autotrack_test_mysql`; it truncates that database and never touches
shop data. If `mysqldump` is not on `PATH`, set `MYSQL_BIN` to the MySQL `bin` directory
first. On the verified MySQL 8.4.13 runtime the suite passed 84/84, the static UI checks
passed 285/285, and the client logic checks passed 45/45 on 2026-11-01.

## 9. Before real use

- Run `node scripts/backup.mjs` and restore into a separate database; record the evidence.
- Put the host on a UPS and confirm MySQL restarts cleanly.
- Read `docs/OPERATIONS.md` and `docs/LAN_SETUP.md`.
- GATE-3 and LAN/TLS deployment are still deferred; do not claim production readiness.
