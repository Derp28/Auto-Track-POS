# Auto-Track POS — Stage 2 report

**Date:** 2026-10-21
**Status:** Stage 2 backend and UI implementation complete. **GATE-2 passed.**
**Current focus:** self-hosted local website with PostgreSQL on the same machine.
**GATE-3:** Deferred by user direction (LAN deployment, production recovery, and independent
signoff). Not passed. Not production-ready.

This report separates verified implementation from remaining gaps. It does not claim
production readiness, and no unrun test is presented as passing.

## 1. Scope delivered

The Stage 1 layout, navigation, role visibility, and visual system were preserved while
the mock data source was replaced with an Express 5 API and PostgreSQL 17.11 database.

### Platform

- Node.js 24 + Express 5 + `pg`; vanilla ES modules on the frontend.
- PostgreSQL on loopback port `5433`; runtime and migration roles separated.
- Versioned migrations `001_core`, `002_immutability`, and `003_least_privilege`.
- Integer-cent money, basis-point percentages, `stock_value_cents` as valuation authority,
  and derived weighted-average cost.
- Server-side sessions, scrypt password hashing, CSRF tokens, HttpOnly/SameSite cookies,
  login lockout, and forced temporary-password changes.
- Atomic checkout, receiving, returns, voids, and adjustments with row locks,
  idempotency keys, payload hashes, and no negative stock.
- TLS support; non-loopback plain HTTP is refused unless explicitly allowed for testing.
- Structured logs, security headers, CSP, JSON/session limits, and error hygiene.

### Shop features

| Area | Implemented |
|---|---|
| First-run setup | Bootstrap-token administrator creation; setup locking |
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
| Reports | Daily sales, sales history, valuation, low stock, stock movements, purchasing |
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

Environment: Windows workspace over UNC, Node 24, portable PostgreSQL 17.11 on
`127.0.0.1:5433`, isolated `autotrack_test` database, headless Microsoft Edge through
`playwright-core`.

| Check | Command | Result |
|---|---|---|
| Full backend/browser suite | `node --test --test-concurrency=1 "tests/*.test.mjs"` | **84 tests, 84 pass, 0 fail, 0 skipped** |
| Browser E2E | `node --test --test-concurrency=1 tests/browser.test.mjs` | **5/5 subtests pass** |
| Local website workflow | `node --test --test-concurrency=1 tests/workflows.test.mjs` | **9/9 subtests pass** |
| Static UI boundary | `node scripts/check-ui.mjs` | **279 checks pass** |
| Client logic | `node scripts/test-ui.mjs` | **45 checks pass** |
| Dependency audit | `npm audit --audit-level=high` | **0 vulnerabilities** |
| Live dev smoke | `http://127.0.0.1:3100` | Login, bootstrap, dashboard, daily reports, system status returned live dev data |
| Dev backup | `node scripts/backup.mjs --output ...` | 109,535-byte custom dump; SHA-256 `587d0a47a780a32fcc02fa121fe1fd7038685c2929ce0a6275fa4538e2a6bb0a`; 3 migrations in manifest |
| TLS deployment test | `tests/deployment.test.mjs` | HTTPS on `0.0.0.0`; non-loopback HTTP refused |
| Isolated restore test | `tests/deployment.test.mjs` | Restore, grants, audit history, app-role access verified on `autotrack_test` |

### Browser test coverage

- First-run setup creates the administrator and opens the dashboard.
- Administrator can open every primary screen without a page error.
- Catalog search and category entry point render live data.
- Reports load daily sales and switch to valuation.
- System status shows the three applied migrations.
- Cashier login forces a new password.
- Cashier completes a checkout and receives a confirmed receipt.
- Cashier is denied administrator screens.
- Cashier returns an item with administrator credentials; dialog focus is verified.
- 1024×768 dashboard, checkout, and reports have no page-level horizontal overflow.

### Local website workflow coverage

`tests/workflows.test.mjs` signs in through the website and exercises the normal shop
forms end to end against the isolated database:

- Create a category and product, then edit the product price.
- Post an inventory adjustment and verify on-hand and stock value.
- Create a supplier.
- Create a purchase order, mark it ordered, receive one unit, verify partial status,
  receive the remaining two, and verify full status and stock.
- Save settings, reload the settings page, and verify the value persisted.
- Create a cashier and verify the returned temporary password works.
- Void a sale as administrator, verify the audit record, and verify stock restoration.

This pass found and fixed a dialog lifecycle defect: when one dialog closed and another
opened immediately (for example, the one-time temporary-password dialog after user
creation), the queued close event could remove the new dialog's click handler. Dialog
generations now prevent a prior close event from settling a newly opened dialog.

### API/database test coverage

The suite includes auth/lockout/session revocation, role and report scoping, invalid input,
CRUD, totals, tax/discount/refund arithmetic, idempotency conflicts, duplicate submission,
last-unit concurrency, receiving concurrency, negative-stock rejection, returns/voids,
audit retention, database constraint/immutability checks, environment validation, restart
persistence, TLS refusal, and backup/restore.

## 3. Security controls verified

- Runtime role cannot delete audit history or bypass append-only triggers.
- PostgreSQL listens on loopback; the browser never receives database credentials.
- Mutations require same-origin checks plus `x-csrf-token`.
- Sessions are server-side and revoked on deactivation/reset.
- Cashier over-limit discounts, returns, and voids require an active administrator's
  credentials verified by the server.
- Card fields are absent. `CARD_EXTERNAL` stores only amount and optional terminal reference.
- Security headers, CSP, JSON body limit, login rate limit/lockout, and generic API errors
  are implemented and tested.
- Production non-loopback serving requires TLS unless the explicit test-only override is set.

## 4. Gaps and limitations

### Deferred deployment and recovery gaps

These are not active work while the user focuses on the local self-hosted website:

1. **No physical LAN pilot.** TLS was served on `0.0.0.0` and localhost was tested, but no
   second machine, trusted certificate, static address, or firewall rule has been verified.
2. **No three-client concurrency pilot on the shop LAN.** Last-unit contention is covered by
   the automated test suite, not by three real clients.
3. **No production-data restore drill.** Restore is verified only against `autotrack_test`;
   restore time, production row counts, and post-restore reporting are not recorded.
4. **No independent final audit/signoff.** GATE-2 evidence is self-produced and tested.
   GATE-3 requires the independent signoff package.

### Operational gaps

- No scheduled backup, retention policy, off-site copy, encryption step, or backup alerting.
- No Windows service/daemon wrapper, automatic restart, or uptime monitor.
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
- T-201 through T-218: done with evidence.
- Local self-hosted website workflows: verified on loopback with the isolated test database.
- T-219 LAN pilot: deferred by user direction.
- T-220 production restore drill: deferred; isolated test restore passed.
- T-221 final signoff: deferred with GATE-3.
- GATE-3: deferred and not passed.

## 6. Required work when deployment is re-authorized

1. Run `docs/LAN_SETUP.md` on the physical shop host with a trusted certificate and firewall rule.
2. Test two or three real clients, including last-unit contention and cross-client report visibility.
3. Perform a timed restore drill using a production-like backup; reconcile users, catalog, stock,
   sales, returns, voids, payments, and audit counts.
4. Record screenshots for 1024, 1366, and 1920 widths plus 80 mm print preview.
5. Review backup retention/off-site storage and service restart policy.
6. Repeat the full regression suite and obtain independent signoff.

Until those steps pass, Auto-Track is a verified Stage 2 implementation for local
self-hosted use, not a production-ready multi-client shop deployment.
