# Changelog

All notable changes to Auto-Track POS are recorded here. Versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Administrator-only XLSX and PDF exports for daily sales, sales history, inventory
  valuation, low stock, stock movements, and purchasing. Files are generated on the
  server; the browser never receives database credentials or a direct database
  connection. XLSX workbooks include summary and supporting detail sheets; PDFs use the
  same report data with numbered pages and repeated table headers.
- `GET /api/exports/:dataset/:format` with the `reports:export` permission. Every
  successful export writes a `REPORT_EXPORTED` audit row containing the dataset, format,
  filters, row count, filename, and source IP.
- Report-screen **Export Excel** and **Export PDF** buttons for administrators. Cashiers
  continue to see only their limited reports and no export controls.
- KPI-first administrator dashboard with a monthly sales target, target pace,
  same-period month/year comparisons, a six-month or five-year net-sales trend, and a
  top-product revenue donut. Cashiers keep the own-sales dashboard and never receive the
  shop-wide insight payload.
- Administrator-only operating-expense ledger with create, edit, soft delete, audit
  history, and a `expenses:manage` permission. Received purchase-order receipts are shown
  separately as inventory purchases, not conflated with operating expenses.
- `004_dashboard_insights.sql` adds the target/comparison settings and the soft-deletable
  `expenses` table; new PO receipts store their shop business date.

### Changed

- Shop settings now include the monthly sales target and the monthly/yearly dashboard
  comparison mode. The default is monthly.
- The public static browser demo now mirrors the administrator dashboard with in-browser
  insights, a sample monthly target, historical comparison sales, received-stock totals,
  and an operating-expense ledger. It also hides export controls because it has no server
  and cannot generate server-side files.
- Added `exceljs` and `pdfkit`, plus an `overrides.uuid` pin to `^11.1.1` so the
  transitive ExcelJS dependency has no moderate audit finding.

### Verification

- Full suite: 91 tests, 91 pass, 0 fail with `MYSQL_BIN` set to the portable MySQL `bin`
  directory. Without `MYSQL_BIN`, the deployment test fails only because `mysqldump` is
  not on `PATH`; see `TEST_PLAN.md` section 23.
- Dashboard/expense tests: `tests/dashboard-expenses.test.mjs` 2/2, covering target pace,
  same-period month and year comparisons, monthly/yearly trends, top-product totals,
  expense CRUD/audit, cashier denial, and received PO purchase totals.
- Static demo regression: `tests/demo.test.mjs` 1/1, covering administrator insights,
  cashier `insights: null`, expense create/update/soft-delete, and monthly/yearly target
  settings. A Playwright check of `docs/demo` rendered the KPI cards, donut, trend,
  expenses, saved an expense, updated the target in Settings, hid insights from the
  cashier, and reported no page or console errors.
- `node scripts/check-ui.mjs`: 285/285; `node scripts/test-ui.mjs`: 47/47; browser smoke
  5/5.
- Visual browser check at 1440px and 900px widths: dashboard, expense dialog, Settings
  target card, and the static demo dashboard rendered without page or console errors.
- `npm audit`: 0 vulnerabilities. `npm run demo:build`: success and `docs/demo`
  regenerated from the demo sources and patched public views.

## [1.0.1] - 2026-11-01

Release name: **Auto-POS Version 1.0.1 - local MySQL edition**

### Added

- Local-only MySQL 8.4 LTS data layer (`mysql2`, `migrations-mysql/`, MySQL
  compatibility adapter) with the same API, UI, roles, money rules, and document
  workflow as the PostgreSQL release.
- First-run PowerShell launcher with per-user desktop-shortcut and Windows sign-in
  auto-start options, plus `setup.cmd` and `start.cmd` wrappers.
- MySQL `mysqldump` backup and `mysql` restore scripts with SHA-256 verification,
  JSON manifests, and least-privilege grant reapplication.

### Fixed

- Duplicate idempotency submissions now replay the stored response instead of returning
  a duplicate-key error.
- Document numbering uses MySQL upserts plus a same-transaction read.
- Session expiry, search, status, purchasing, and returns queries use MySQL syntax.
- Backup/restore tests and test-only failure triggers no longer require PostgreSQL.

### Notes

- Verified on MySQL 8.4.13: 84/84 backend/browser tests, 285 static UI checks, and
  45 client-logic checks passed on 2026-11-01.
- `v1.0.0` and `main` remain the PostgreSQL release and are unchanged.
- GATE-3, LAN/TLS deployment, and production recovery drills remain deferred. This is
  still **not** a production-readiness claim.

## [1.0.0] — 2026-10-29

Release name: **Auto-POS Version 1.0.0**

### Added

- Browser-only GitHub Pages demo built from `public/` plus an in-memory mock
  API (`docs/demo/`), with sample data seeded on load and no database.
- Receipt output options: print to a printer through the browser print dialog,
  or download an 80 mm PDF generated entirely in the browser.
- Reprint audit entries for both receipt output options.

### Fixed

- Receipt printing no longer shows the browser's page URL, date, or page
  numbers around the receipt.
- Receipt print output uses a zero page margin with internal padding, so the
  receipt details are the only visible content.

### Notes

- This is the release baseline for local self-hosted use on `127.0.0.1` with
  PostgreSQL on the same machine.
- LAN/TLS deployment, production recovery drills, and GATE-3 remain deferred.
  This release is **not** a production-readiness claim.
- The browser demo is a preview only. It resets on reload and must not be
  treated as the shop system.
