# Changelog

All notable changes to Auto-Track POS are recorded here. Versions follow
[Semantic Versioning](https://semver.org/).

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
