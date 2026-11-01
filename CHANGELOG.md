# Changelog

All notable changes to Auto-Track POS are recorded here. Versions follow
[Semantic Versioning](https://semver.org/).

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
