# Auto-Track POS — LAN and TLS setup

This guide describes the intended shop-LAN deployment. It is **deferred** while the
user focuses on the self-hosted local website on `127.0.0.1`. The current implementation
has been tested on one host only: TLS served on `0.0.0.0` and plain HTTP on a non-loopback
address was refused. A second-machine client and the shop firewall have **not** been
verified, so treat this as a setup procedure, not completed acceptance evidence.

## Network rules

- PostgreSQL listens on `127.0.0.1:5433` only.
- The browser uses the Express API only; never expose PostgreSQL to the LAN.
- Serve the POS over HTTPS on the LAN.
- Do not port-forward, tunnel, or expose the POS to the public internet.
- Keep the shop router isolated from guest/public networks where possible.
- Use a static LAN address or a DHCP reservation for the shop server.

## 1. Prepare the server address

Choose a static address such as `192.168.1.20`. Confirm the shop server and client
machines are on the same trusted subnet.

## 2. Create a TLS certificate

Use a certificate issued by a shop-local CA if available. For a controlled pilot, a
self-signed certificate can be used, but every client must trust it.

PowerShell with OpenSSL available:

```powershell
New-Item -ItemType Directory -Force C:\AutoTrack\certs
openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 365 `
  -keyout C:\AutoTrack\certs\server.key `
  -out C:\AutoTrack\certs\server.crt `
  -subj "/CN=autotrack-shop.local" `
  -addext "subjectAltName=IP:192.168.1.20,DNS:autotrack-shop.local"
```

Protect the private key file. Do not commit it or copy it to client machines.

## 3. Configure `.env`

```dotenv
NODE_ENV=production
HOST=0.0.0.0
PORT=3100
TLS_CERT_FILE=C:\AutoTrack\certs\server.crt
TLS_KEY_FILE=C:\AutoTrack\certs\server.key
COOKIE_SECURE=true
TRUST_PROXY=false
ALLOW_INSECURE_LAN=false
ALLOW_SETUP=false
```

Keep the database URLs pointed at loopback:

```dotenv
DATABASE_URL=postgres://autotrack_app:...@127.0.0.1:5433/autotrack_dev
MIGRATION_DATABASE_URL=postgres://autotrack_owner:...@127.0.0.1:5433/autotrack_dev
```

If an HTTPS reverse proxy is used instead, set `TRUST_PROXY=true` only when the proxy is
trusted and configured to set the client address correctly. Do not trust arbitrary
`X-Forwarded-*` headers from the LAN.

## 4. Apply migrations and start

```bash
node scripts/migrate.mjs
node scripts/migrate.mjs --status
node server/index.js
```

Expected startup log includes:

```json
{"msg":"Auto-Track POS server listening","host":"0.0.0.0","tls":true}
```

If TLS files are missing while `HOST=0.0.0.0`, the server must refuse to start. That
refusal is intentional and is covered by the deployment tests.

## 5. Windows firewall

Allow inbound TCP `3100` only from the shop subnet, for example:

```powershell
New-NetFirewallRule -DisplayName "Auto-Track POS HTTPS" `
  -Direction Inbound -Protocol TCP -LocalPort 3100 `
  -RemoteAddress 192.168.1.0/24 -Action Allow
```

Do not create an inbound rule for `5433`. Verify:

```powershell
Get-NetFirewallRule -DisplayName "Auto-Track POS HTTPS"
Test-NetConnection 192.168.1.20 -Port 3100
```

## 6. Client verification

On a second shop machine:

1. Install/trust the shop CA certificate, or import the self-signed certificate into the
   trusted store.
2. Open `https://192.168.1.20:3100/`.
3. Confirm the certificate warning does not appear.
4. Sign in as a cashier and complete a sale.
5. Sign in as an administrator on another machine and confirm the sale, stock movement,
   and report appear.
6. Confirm one machine cannot open the PostgreSQL port:
   ```powershell
   Test-NetConnection 192.168.1.20 -Port 5433
   ```
   `TcpTestSucceeded` must be `False`.

## 7. Concurrency pilot

Use at least three client browsers and one low-stock product:

- Add the last unit to two carts.
- Complete both sales.
- One must succeed; the other must receive a clear stock error and must not show a
  receipt.
- Confirm stock never goes negative.
- Confirm reports reconcile the successful sale and the rejected attempt created no sale.

Repeat with receiving and returns to confirm stock and audit history remain consistent.

## 8. Restart and recovery

- Restart the server and confirm sessions/data survive.
- Take a backup and restore it into a disposable database; follow `OPERATIONS.md`.
- Confirm the restored shop, users, catalog, stock, sales, returns, voids, and audit
  counts match.
- Record restore time and any errors.

## Known limitations

- Only local-host TLS and non-loopback refusal have been tested.
- No second physical client, firewall rule, or certificate trust test has been recorded.
- No Windows service wrapper, automatic restart, or uptime monitor is configured.
- No automated backup or off-site retention exists.
- No offline mode or multi-server sync exists.
- Production readiness requires the full LAN pilot, recovery drill, and final signoff.
