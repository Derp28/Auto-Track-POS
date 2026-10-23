# Auto-Track POS

Self-hosted point-of-sale and inventory system for a single auto parts shop with a
service counter. Express 5 API, PostgreSQL 17, server-side sessions, and a
framework-free frontend served by the same process.

Run it on the shop machine, open `http://127.0.0.1:3100`, and sell. There is no cloud
component, no offline mode, and no connection to any payment processor.

## Interactive demo

A browser-only preview of this interface is published with GitHub Pages:

- Landing page: <https://derp28.github.io/Auto-Track-POS/>
- Built from `public/` plus an in-memory mock API in `demo/`
- Demo accounts: `admin`, `cashier`, `cashier2` — password `demo1234`
- Rebuild the published files with `npm run demo:build` (output: `docs/`)

The demo has no PostgreSQL, server, sessions, or persistence: sample data is seeded on
load and resets on reload. It demonstrates the UI and workflows only — it is not the
production system. To attach a custom domain, register it, point its DNS at GitHub
Pages, then build with `DEMO_DOMAIN=autotrackpos.com npm run demo:build` and commit
`docs/CNAME`. Pages redirects the `github.io` URL to the custom domain as soon as that
file exists, so set it only after DNS resolves.

## Status

- Stage 1 UI: approved (GATE-1).
- Stage 2 backend/UI: implemented; GATE-2 passed.
- Local self-hosted operation on `127.0.0.1` is the supported mode.
- LAN/TLS deployment, production recovery drills, and GATE-3 are **not** done.
- **Not production-ready.** Read `docs/STAGE2_REPORT.md` before trusting it with real
  money or stock.

## What it does

- **Checkout** — barcode/SKU search, per-line percentage discounts, cash and external
  card (terminal reference only), atomic sale commits, idempotent retries.
- **Inventory** — stock on hand, weighted-average cost derived from `stock_value_cents`,
  receiving, adjustments, movements history, low-stock and valuation reports.
- **Returns and voids** — separate documents, proportional or exact cost restoration,
  refund records; payments are immutable.
- **Purchasing** — suppliers, purchase orders, partial receipts.
- **Catalog** — categories, products, prices, costs, reorder levels.
- **Users and roles** — `ADMIN` and `CASHIER` with a server-enforced permission matrix.
  Cashiers see only their own sales and never see cost or stock value.
- **Audit** — append-only `audit_log` and `stock_movements`, database-level immutability
  triggers, least-privilege runtime role.

## Requirements

- Node.js **24 or newer**
- PostgreSQL **17**
- A machine that can keep the database and the app on loopback

## Quick start

Full instructions, including the SQL for the database roles, are in
[`docs/INSTALL.md`](docs/INSTALL.md).

```bash
# 1. PostgreSQL roles and databases — see docs/INSTALL.md
# 2. Install dependencies
npm ci

# 3. Configure
cp .env.example .env    # then fill in the URLs and generate BOOTSTRAP_TOKEN

# 4. Apply migrations
node scripts/migrate.mjs
node scripts/migrate.mjs --status

# 5. Run
npm start
```

Open `http://127.0.0.1:3100/`, complete first-run setup with the `BOOTSTRAP_TOKEN`, then
set `ALLOW_SETUP=false` and remove the token.

## Verify

```bash
node scripts/check-ui.mjs      # static UI checks
node scripts/test-ui.mjs       # client logic checks
npm test                       # backend/browser suite (needs autotrack_test)
```

The test suite refuses to run unless `TEST_DATABASE_URL` points at an isolated
`autotrack_test` database; it truncates only that database.

## Documentation

| File | Contents |
|---|---|
| `docs/INSTALL.md` | Fresh-machine install: roles, databases, grants, first admin |
| `docs/OPERATIONS.md` | Start/stop, health, backup/restore, security operations |
| `docs/LAN_SETUP.md` | TLS, firewall, second client, concurrency pilot |
| `docs/STAGE2_REPORT.md` | What is implemented, evidence, and remaining gaps |

## Security notes

- PostgreSQL listens on loopback only; the browser never talks to it directly.
- Sessions are server-side and stored in PostgreSQL; cookies are `HttpOnly` and
  `SameSite=Strict`, with CSRF tokens on every mutating request.
- No raw card data is ever accepted: no PAN, CVV, expiry, track data, or PIN.
  `CARD_EXTERNAL` stores an optional terminal reference only.
- Non-loopback access requires HTTPS. Do not expose this app to the public internet.

## License

MIT — see [`LICENSE`](LICENSE). You may use, modify, and redistribute this software,
including commercially, provided the copyright notice and permission notice are kept.
