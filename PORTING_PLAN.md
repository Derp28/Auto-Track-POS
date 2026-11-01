# MySQL local-only port — plan

**Baseline:** Auto-Track POS `v1.0.0` (`cf46869`), PostgreSQL 17.11.
**Target:** same app behavior on MySQL 8.4 LTS, loopback-only.
**Status:** implemented and verified on 2026-11-01. The full backend/browser suite
passed 84/84 on MySQL 8.4.13, static UI checks passed 285/285, and client logic checks
passed 45/45. Branch `local-mysql` is the publication target; `main` and `v1.0.0` stay on
PostgreSQL.

## 1. Why this is a port, not a copy

The PostgreSQL schema and services use features MySQL does not accept unchanged:

| PostgreSQL usage | Count (current source) | MySQL impact |
|---|---:|---|
| `BIGSERIAL` columns | 18 | Replace with `BIGINT AUTO_INCREMENT` |
| `TIMESTAMPTZ` columns | 34 | Use `DATETIME(6)` in UTC; convert in app |
| `JSONB` columns | 6 | Use `JSON`; defaults differ |
| `RETURNING` clauses | 24 | Use `insertId`, `affectedRows`, or a follow-up select |
| `ON CONFLICT` | 2 | Use `INSERT ... ON DUPLICATE KEY UPDATE` or lock+select |
| `FOR UPDATE` | 20 | Mostly supported; audit `FOR UPDATE OF`/ordering |
| `ILIKE` | 5 | Use case-insensitive collation or `LOWER(...) LIKE` |
| PostgreSQL `::type` casts | 86 | Use `CAST(...)` or remove; arrays need redesign |
| `ANY($1::bigint[])` | 11 | Expand to `IN (?,?,?)` or `JSON_TABLE` |
| `to_char(...)` | 4 | Use `DATE_FORMAT` or format in JS |
| `now()` | 72 | Use `UTC_TIMESTAMP(6)` or parameterized app time |
| `current_business_date()` | 3 calls + 1 function | Compute in JS against shop timezone/cutoff |
| `pg_advisory_xact_lock` | 1 | Use a lock row `FOR UPDATE` or `GET_LOCK` |
| `pg_settings` / `pg_postmaster_start_time` | 2 | Use `SHOW VARIABLES` / `information_schema` |
| PL/pgSQL functions | ~7 | Rewrite as MySQL stored functions or move to JS |
| `CREATE TRIGGER` | 15 | Split multi-event triggers into one per event; use `SIGNAL SQLSTATE '45000'` |
| Partial unique index (`barcode IS NOT NULL`) | 1 | MySQL unique indexes allow multiple `NULL`s; use a `VARCHAR` unique index |
| Regex `CHECK` (`~`) | 1 | Use `REGEXP` |
| `lower()` unique indexes | 3 | Use case-insensitive collation or generated columns |
| `CHECK` constraints | 91 | MySQL 8.0.16+ enforces them; rewrite dialect-specific expressions |

The current schema is 3 migrations (~25 KB). The services are ~100 KB of JS and the tests
~130 KB. Full behavior parity is a multi-day engineering change, not a quick copy.

## 2. Target architecture

```text
Cashier browser (unchanged vanilla SPA)
  |  HTTPS, same-origin JSON API
  v
Express 5 (same routes/services, MySQL data layer)
  |  mysql2/promise pool
  v
MySQL 8.4 LTS on 127.0.0.1:3307
  ^
  |  mysqldump / mysql restore
Backup storage (restricted, dedicated device)
```

- The UI and API contract should remain unchanged.
- Only the data layer, schema/migrations, backup scripts, and test harness change.
- PostgreSQL version stays untouched and remains the `main` release.

## 3. Schema mapping rules

- **IDs:** `BIGINT UNSIGNED AUTO_INCREMENT` or `BIGINT AUTO_INCREMENT`; use `insertId`.
- **Money:** `BIGINT` integer cents; no floats. Keep all checks.
- **Quantities:** `INT`/`BIGINT`; keep non-negative checks.
- **Time:** store UTC in `DATETIME(6)`; never use MySQL `TIMESTAMP` (2038 range and
  session timezone surprises). Convert to/from shop timezone in JS.
- **Dates:** `DATE`; business-day cutoff computed in JS.
- **JSON:** `JSON`; provide values explicitly instead of relying on `'{}'::jsonb` defaults.
- **Text:** use `VARCHAR(n)` for indexed fields (username, SKU, barcode, document numbers,
  token hashes); `TEXT` for notes/addresses.
- **Case-insensitive uniqueness:** use `utf8mb4_0900_ai_ci` or generated normalized columns.
  Use binary collation for tokens/hashes.
- **Barcode:** `VARCHAR(80) NULL UNIQUE`; MySQL allows multiple `NULL`s, which replaces the
  PostgreSQL partial index.
- **Checks:** keep them; rewrite `length(btrim(x))` to `CHAR_LENGTH(TRIM(x))`, `~` to
  `REGEXP`, and `::int` to `CAST(... AS SIGNED)` or `IF`.
- **Immutability:** MySQL triggers must be one event each. Replace `RAISE EXCEPTION` with
  `SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '...'`.
- **Document numbers:** keep the `document_sequences` table; use a transaction row lock
  (`SELECT ... FOR UPDATE`) or `INSERT ... ON DUPLICATE KEY UPDATE` with a follow-up read.
- **Bootstrap lock:** replace the PostgreSQL advisory lock with a dedicated lock row
  selected `FOR UPDATE`, or `GET_LOCK`/`RELEASE_LOCK` on a dedicated connection.

## 4. Query/service rewrite inventory

Files with the most work:

- `server/services/sales.js` — checkout, returns, voids, document numbers, product locks.
- `server/services/purchasing.js` — PO lines, receipts, `ANY(array)` lookups, locks.
- `server/services/catalog.js` — search (`ILIKE`), `RETURNING`, locks.
- `server/services/reports.js` — date formatting, business date, aggregates.
- `server/services/auth.js` — sessions, advisory lock, interval arithmetic.
- `server/services/system.js` — health/version queries.
- `server/db.js` — `pg.Pool` → `mysql2/promise` pool; transaction/retry error codes.
- `server/db/migrate.js` — migration runner and checksums.
- `scripts/backup.mjs`, `scripts/restore.mjs`, `scripts/migrate.mjs`.
- `tests/helpers.mjs` — test DB create/drop/migrate.
- `tests/deployment.test.mjs` - restart/TLS/backup tests use MySQL binaries.
- `tests/checkout.test.mjs` — PL/pgSQL trigger assertion.

## 5. Test and acceptance plan

A MySQL variant is not "the same" until:

1. Schema migration runs cleanly on MySQL 8.4 from an empty database.
2. The full backend suite passes against `autotrack_test_mysql`.
3. Browser/workflow tests pass unchanged (they use the API).
4. Money, tax, discount, stock value, returns, voids, and report invariants hold.
5. Last-unit contention and duplicate-retry concurrency tests pass.
6. `mysqldump` backup restores into a new database and passes count/invariant checks.
7. MySQL listens on loopback only; remote connection attempts fail.
8. The app runs as a Windows service with MySQL auto-start.
9. No shop data or secrets are committed or distributed.

Any test that is skipped or rewritten to be weaker must be recorded as a limitation, not
reported as a pass.

## 6. Phases

| Phase | Work | Exit condition |
|---|---|---|
| M0 Scaffold | Folder, package metadata, config, MySQL installer plan | Empty app starts and reaches MySQL health |
| M1 Schema | Rewrite migrations, triggers, indexes, seed settings | Fresh migration + schema checks pass |
| M2 Core data | Pool, transactions, auth/sessions, settings, catalog | Auth/catalog integration tests pass |
| M3 Inventory | Products, stock movements, adjustments, WAC | Inventory/concurrency tests pass |
| M4 Sales | Checkout, payments, receipts, voids, returns, refunds | Checkout/return/void tests pass |
| M5 Purchasing/reports | POs, receipts, reports, users, system | Remaining integration/E2E tests pass |
| M6 Operations | Backup/restore, service, firewall, loopback proof | Recovery drill passes |
| M7 Release | Docs, version, branch/push, evidence | Review and tag |

## 7. Branch / GitHub strategy

**Can it be uploaded as a branch?** Yes. A Git branch is a snapshot of files, not a folder
upload. Options:

1. **Branch `local-mysql` in `github/` with the variant at repo root** — cleanest pure
   MySQL variant; `main` stays PostgreSQL.
2. **Branch with `for-local-host-only/` as a subfolder** — keeps both apps in one branch,
   but duplicates the tree and is harder to maintain.
3. **Separate repository** (for example `Auto-Track-POS-MySQL`) — cleanest long-lived fork,
   but not a branch of the existing repo.

Recommended: a separate repository or a `local-mysql` branch with the MySQL app at the
root. Do **not** move the `v1.0.0` tag; create a new version for this variant.

To publish a branch later:

```bash
cd github
git checkout -b local-mysql
# add the ported source (no data, backups, .env, node_modules)
git add .
git commit -m "Add local-only MySQL variant"
git push -u origin local-mysql
```

The branch ZIP is then downloadable from:

```text
https://github.com/Derp28/Auto-Track-POS/archive/refs/heads/local-mysql.zip
```

## 8. Confirmed decisions and remaining open items

Confirmed 2026-10-31:

1. **Scope:** full parity with the main project.
2. **Data:** fresh test data.
3. **Repository:** branch `local-mysql` in the existing `github/` repository.
4. **Tests:** the full backend/browser suite must pass before calling it done.
5. **Startup:** first-run per-user desktop shortcut and Windows sign-in auto-start; Windows
   service promotion is optional later.

Resolved during implementation:

1. **MySQL version:** dedicated MySQL 8.4 LTS (verified 8.4.13), not XAMPP MariaDB 10.4.
2. **Setup form:** first-run PowerShell/launcher first; full installer later. See
   `INSTALLER_PLAN.md`.
3. **Prerequisites:** require Node 24 and MySQL 8.4; do not bundle either yet.
4. **Shortcut scope:** per-user.
5. **Uninstall/data retention:** keep the database by default; deletion requires explicit
   operator action.

## 9. Risks

- **Behavior drift:** two codebases will diverge; fixes must be applied twice.
- **Silent money/stock bugs:** MySQL transaction/isolation and trigger differences can
  change concurrency behavior. The invariant tests are mandatory.
- **Old MariaDB:** XAMPP 10.4 lacks modern MySQL behavior; do not use it as the production
  target.
- **Licensing:** if you distribute a bundled MySQL server with the app, review the MySQL
  Community GPL terms; source-only distribution avoids bundling.
- **Operational security:** MySQL must bind loopback only; never expose 3307.
