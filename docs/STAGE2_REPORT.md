# Auto-Track POS - Stage 2 report (local MySQL edition)

**Date:** 2026-11-01; report export addendum 2026-11-06; GATE-3 target update 2026-11-19
**Status:** Stage 2 backend and UI implementation complete. **GATE-2 passed.**
**Variant:** local-only MySQL 8.4 LTS port on the `local-mysql` branch; this is the GATE-3 target (D-052).
**Current focus:** GATE-3 for the local-only MySQL build on `127.0.0.1:3307`.
**GATE-3:** Active (LAN deployment, production recovery, and independent signoff).
Not passed. Not production-ready.

This report separates verified implementation from remaining gaps. It does not claim
production readiness, and no unrun test is presented as passing.

## 1. Scope delivered

The Stage 1 layout, navigation, role visibility, and visual system were preserved while
the data layer moved from PostgreSQL 17 to MySQL 8.4 LTS. The API contract, money and
inventory rules, permission matrix, and UI behavior are unchanged. Administrator XLSX and
PDF report exports were added on 2026-11-06 after GATE-2 and verified independently; the
GATE-2 status is unchanged.

### Platform

- Node.js 24 + Express 5 + `mysql2/promise`; vanilla ES modules on the frontend.
- MySQL 8.4 LTS on loopback port `3307`; runtime and migration roles separated.
- Versioned migrations `migrations-mysql/001_core.sql`, `002_immutability.sql`, and
  `003_least_privilege.sql`.
- Narrow PostgreSQL compatibility layer in `server/db.js`: `$n` placeholders,
  `ANY(array)` expansion, common casts, `ILIKE`, `now()`, `to_char`, and `RETURNING *`.
- Integer-cent money, basis-point percentages, `stock_value_cents` as valuation authority,
  and derived weighted-average cost.
- Server-side sessions, scrypt password hashing, CSRF tokens, HttpOnly/SameSite cookies,
  login lockout, and forced temporary-password changes.
- Atomic checkout, receiving, returns, voids, and adjustments with row locks,
  idempotency keys, payload hashes, and no negative stock.
- TLS support; non-loopback plain HTTP is refused unless explicitly allowed for testing.
- Structured logs, security headers, CSP, JSON/session limits, and error hygiene.
- First-run PowerShell launcher with per-user desktop-shortcut and Windows-sign-in
  auto-start options.

### Shop features

| Area | Implemented |
|---|---|
| First-run setup | Bootstrap-token administrator creation; setup locking; shortcut/auto-start dialog |
| Authentication | Login/logout, session restore, idle/absolute expiry, forced password change |
| Roles | Fixed ADMIN/CASHIER matrix enforced by the API; cashier scope limited to own sales |
| Dashboard | Live totals, recent sales, low stock, role-scoped visibility |
| Checkout | Search/scan, cart editing, line discounts, notes, approvals, cash/split/card-external payment, change |
| Sales | Search/filter/pagination, sale detail, immutable lines/payments, reprint audit |
| Receipts | Live receipt data, reprint, 80 mm print CSS |
| Returns | Partial/full returns, restock control, original-line refunds, manager approval, refund tender |
| Voids | Same-day/cutoff rules, no-return guard, separate void/refund records, manager approval |
| Inventory | On-hand/value display, adjustments with reason, ledger history, low stock |
| Catalog | Categories, products, archive, SKU/barcode, price/cost controls, category manager |
| Purchasing | Suppliers, PO draft/order/receive/close/cancel, partial receiving, over-receipt guard |
| Reports | Daily sales, sales history, valuation, low stock, stock movements, purchasing; server-generated XLSX/PDF exports for administrators; cashier scope preserved |
| Users | Create/edit/deactivate/reactivate/reset, last-admin protection, session revocation |
| Settings | Shop identity, currency/timezone/cutoff, tax, receipt text, discount/quantity rules |
| System status | Schema migrations, database/server runtime, explicit operational gaps |
| Audit | Setup, auth, user, settings, catalog, stock, sale, return, void, reprint events |

### Frontend behavior

- `GET /api/bootstrap` hydrates a synchronous read snapshot; writes are awaited, then the
  server snapshot is refreshed before success is shown.
- Checkout, receiving, returns, and voids keep one idempotency key across retries inside
  their dialog.
- If the server does not confirm a sale, the UI shows an error and no receipt.
- No offline mode or sync claim exists.
- Runtime code has no mock imports, database driver, SQL, `localStorage`,
  `sessionStorage`, IndexedDB, or service workers.

## 2. Verification evidence

Environment: Windows 11, Node 24, portable MySQL 8.4.13 on `127.0.0.1:3307`,
isolated `autotrack_test_mysql` database, headless Microsoft Edge through
`playwright-core`.

| Check | Command | Result |
|---|---|---|
| Full backend/browser suite | `node --test --test-concurrency=1 "tests/*.test.mjs"` | **88 tests, 88 pass, 0 fail, 0 skipped** |
| Static UI boundary | `node scripts/check-ui.mjs` | **285 checks pass** |
| Client logic | `node scripts/test-ui.mjs` | **47 checks pass** |
| Report exports | `node --test --test-concurrency=1 tests/exports.test.mjs` | **4 export tests pass**: XLSX/PDF content, admin-only access, filter handling, and `REPORT_EXPORTED` audit |
| Dependency audit | `npm audit` | **0 vulnerabilities** |
| Isolated backup | `node scripts/backup.mjs --database-url ... --output ...` | SQL dump with tables, triggers, function, SHA-256 file, and JSON manifest |
| Isolated restore | `node scripts/restore.mjs --file ... --target ... --app-url ...` | 22 tables, 3 migrations, shop `Auto-Track`, app role readable, audit delete denied |
| TLS deployment test | `tests/deployment.test.mjs` | HTTPS on `0.0.0.0`; non-loopback HTTP refused |
| Restart persistence test | `tests/deployment.test.mjs` | Session and category survive a server restart |
| First-run launcher | `scripts/first-run.ps1`, `scripts/launch.ps1` | PowerShell parser clean; background launch started MySQL and Express and `/api/health` returned `ok` |

The full suite includes the browser and local-workflow tests. They wait on real API
responses and assert the same role and UI boundaries as the PostgreSQL baseline.

### Browser and workflow coverage

- First-run setup creates the administrator and opens the dashboard.
- Administrator can open every primary screen without a page error.
- Catalog search and category entry point render live data.
- Reports load daily sales and switch to valuation.
- Administrator downloads an XLSX and a PDF from the reports screen; the browser test
  verifies both downloads are non-empty and correctly named.
- Cashier reports hide the export controls and the cashier export request is denied.
- System status shows the applied MySQL migrations.
- Cashier login forces a new password.
- Cashier completes a checkout and receives a confirmed receipt.
- Cashier is denied administrator screens.
- Cashier returns an item with administrator credentials; dialog focus is verified.
- 1024x768 dashboard, checkout, and reports have no page-level horizontal overflow.
- `tests/workflows.test.mjs` signs in through the website and creates a category,
  product, inventory adjustment, supplier, purchase order and receipt, settings value,
  cashier, and void, verifying server state after each mutation.

### API/database test coverage

The suite includes auth/lockout/session revocation, role and report scoping, invalid input,
CRUD, totals, tax/discount/refund arithmetic, idempotency conflicts, duplicate submission,
last-unit concurrency, receiving concurrency, negative-stock rejection, returns/voids,
audit retention, database constraint/immutability checks, environment validation, restart
persistence, TLS refusal, MySQL backup/restore, and report export content/access/audit.

### Port-specific fixes verified by the suite

- `= ANY($n::bigint[])` is expanded to MySQL `IN (...)` without leaving the equality
  operator.
- Duplicate idempotency submissions are detected with `INSERT IGNORE` affected-row count,
  so a replay returns the stored response instead of surfacing a duplicate-key error.
- Session expiry uses `TIMESTAMPDIFF` and `DATE_ADD(... INTERVAL ? MINUTE)`.
- Document numbers use `INSERT ... ON DUPLICATE KEY UPDATE` plus a same-transaction read.
- Test-only triggers use MySQL `SIGNAL SQLSTATE '45000'`.
- Backup/restore use `mysqldump` and the `mysql` client, then reapply least-privilege
  grants.

## 3. Security controls verified

- Runtime role cannot delete audit history or bypass append-only triggers.
- MySQL listens on loopback; the browser never receives database credentials.
- Mutations require same-origin checks plus `x-csrf-token`.
- Sessions are server-side and revoked on deactivation/reset.
- Cashier over-limit discounts, returns, and voids require an active administrator's
  credentials verified by the server.
- Card fields are absent. `CARD_EXTERNAL` stores only amount and optional terminal reference.
- Security headers, CSP, JSON body limit, login rate limit/lockout, and generic API errors
  are implemented and tested.
- Production non-loopback serving requires TLS unless the explicit test-only override is set.
- The first-run shortcuts contain no database password or bootstrap token.
- Report exports require the administrator `reports:export` permission; cashiers receive
  `403` and see no export controls. Files are generated on the server, and every successful
  export writes a `REPORT_EXPORTED` audit row. The public demo omits export controls.

## 4. Gaps and limitations

### Open GATE-3 deployment and recovery gaps

These are active GATE-3 work, not completed evidence:

1. **No physical LAN pilot.** TLS was served on `0.0.0.0` and localhost was tested, but no
   second machine, trusted certificate, static address, or firewall rule has been verified.
2. **No three-client concurrency pilot on the shop LAN.** Last-unit contention is covered by
   the automated test suite, not by three real clients.
3. **No production-data restore drill.** Restore is verified only against
   `autotrack_test_mysql`; restore time, production row counts, and post-restore reporting
   are not recorded.
4. **No independent final audit/signoff.** GATE-2 evidence is self-produced and tested.
   GATE-3 requires the independent signoff package.

### Operational gaps

- No scheduled backup, retention policy, off-site copy, encryption step, or backup alerting.
- No Windows service wrapper or automatic restart. Auto-start is a per-user Startup-folder
  entry, not a service.
- MySQL named time zones must be loaded before first use; the development runtime has all
  597 IANA names. A fresh machine must repeat that step.
- No screenshots were captured in this pass; browser assertions are textual/runtime evidence.
- No physical 80 mm printer validation; print depends on browser and OS driver.
- No full axe/screen-reader accessibility audit. Targeted focus/dialog and viewport checks pass.
- No load/performance test beyond the concurrency cases.
- No offline checkout, queued sales, or synchronization.
- No accounting/AP integration, integrated card processing, custom roles, or multi-warehouse
  support; these remain out of scope.

### Deferred by requirement

Loyalty/customer accounts, exchanges as a single document (implemented as return + new sale),
purchase tax/freight allocation, multi-currency, serialized/lot inventory, and mobile-native
apps are not part of this Stage 2 scope.

## 5. Current task/gate state

- GATE-1: passed.
- GATE-2: passed.
- T-201 through T-218: done with evidence on PostgreSQL.
- T-225 MySQL local variant: implementation, full suite, first-run launcher, and demo rebuild verified; published on `local-mysql` at commit `89defa3`.
- T-226 administrator report exports: implemented and verified on 2026-11-06; XLSX/PDF,
  admin-only access, audit logging, and demo control hiding are covered by tests.
- Local self-hosted website workflows: verified on loopback with the isolated MySQL test
  database.
- T-219 LAN pilot: pending (GATE-3 active).
- T-220 production restore drill: pending; isolated MySQL test restore passed.
- T-221 final signoff: pending with GATE-3.
- GATE-3: active for the MySQL build and not passed.

## 6. Required work to close GATE-3

1. Run `docs/LAN_SETUP.md` on the physical shop host with a trusted certificate and firewall rule.
2. Test two or three real clients, including last-unit contention and cross-client report visibility.
3. Perform a timed `mysqldump` restore drill using a production-like backup; reconcile users, catalog, stock,
   sales, returns, voids, payments, and audit counts.
4. Record screenshots for 1024, 1366, and 1920 widths plus 80 mm print preview.
5. Review backup retention/off-site storage and service restart policy.
6. Repeat the full regression suite and obtain independent signoff.

Until those steps pass, Auto-Track is a verified Stage 2 implementation for local
self-hosted use, not a production-ready multi-client shop deployment.
