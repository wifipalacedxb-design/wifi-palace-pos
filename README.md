# Palace POS

Multi-business POS platform (salon, laundry, grocery, restaurant) by WiFi Palace.

Started on 26 Sep 2026 as a copy of Salon Desk Cloud 2.0 (`wifi-palace-salon-cloud`, branch `salon-v2.0-production`, commit a392d4b). **This repo is separate from the live Salon Desk.** Nothing here is deployed to wifipalace.in, and nothing here is merged back into the salon repo. Target deployment: pos.wifipalace.in (own container and database).

The original Salon Desk README follows until the platform refactor replaces it.

---

# WiFi Palace Salon Desk Cloud — 2.0

Cloud-connected salon POS and owner dashboard, based on the existing Salon Desk Professional app.

## Delivery status

This is a runnable source release, not a live hosted service or compiled Android APK. The server and actual browser client scripts were tested together locally. No hosting resources were purchased, no domain changed, and no real customer data uploaded. No default accounts or published passwords are included.

21 automated integration checks passed before packaging. Tests include real HTTP requests, real SQLite databases, authentication, permissions, cross-salon isolation, duplicate-operation replay, offline client restart/recovery, and owner conflict review. The client tests use DOM stubs, not a rendered browser. Visual browser QA, Android compilation, Android offline caching, native export and printing still require validation on real target devices.

## What is implemented

| Area | Behaviour |
|---|---|
| Salon accounts | A distinct salon code, owner account and data boundary per salon |
| Staff logins | Owners create owner/cashier accounts, enable or disable accounts; password changes revoke sessions |
| Owner dashboard | Sales, refunds, appointments, customer counts and popular services in the shared application |
| Cashier access | Checkout, customers, appointments and the cashier's own receipt history; no catalogue, account, audit or refund administration |
| Offline queue | Saved mutations are persisted locally and pushed one at a time when connectivity returns |
| Duplicate protection | Each operation has a unique identifier; an exact replay returns its original result |
| Conflict checks | Record versions prevent silent overwrites; appointment overlaps are checked by the server |
| Billing | Server checks catalogue prices, calculates totals and tax, validates payment, snapshots receipt details |
| Branding | WiFi Palace startup identity, configurable salon logo, address, phone and TRN |
| Reports | Owner-wide reports; cashier-own reports; owner audit history |
| Recovery | Pending-change recovery export, explicit owner-approved discard and server database backup command |
| Distribution | Android cloud shell project and Docker/HTTPS deployment files |

This is one logical salon per account group, with multiple users/devices. Owners see their own salon, not all WiFi Palace customers. WiFi Palace currently provisions and suspends salons through a server-side CLI; a distributor web portal and subscription payment integration are not implemented.

## Local evaluation

Requires Node.js 24. The backend has no npm dependencies to download.

1. Open a terminal in this `salon-cloud` folder.
2. Run `node server/manage.mjs create-salon` and enter your salon code, owner name, email and a password of at least 12 characters. Password entry is hidden in an interactive terminal.
3. Run `npm start`.
4. Open `http://localhost:8080` in a current browser and sign in using the account you just created.
5. For tests, run `npm test`.

On Windows, `Create-Salon.cmd` and `Start-Local.cmd` provide shortcuts after Node.js 24 is installed. Localhost is for evaluation on that computer; it is not a public cloud URL.

Open a second browser profile or a different device against the deployed HTTPS address to test syncing. A Web Lock deliberately prevents simultaneous editable tabs in the same browser profile from corrupting the local queue.

## How the sync works

- The server is the shared source of truth. The client holds a cached state and an outbox in one localStorage record.
- A successful local write stores the new outbox before telling the operator it was saved. An unpaid cart is not durable.
- Background sync checks the online session, uploads operations sequentially and then refreshes the salon state. It polls every 30 seconds and on reconnection; operators can also choose Sync now.
- Acknowledgement updates the local base and removes the matching request atomically within a single stored cache value.
- If the server accepts a request but the reply is lost, the client can send the same request again without creating another sale.
- Other devices' updates merge with locally pending records. Conflicts pause the queue; the local pending value remains visible until review.
- Offline bills use the last known catalogue. If a price/tax changed or a service was removed before upload, the bill is flagged for reconciliation. It is never silently repriced, discarded or double-charged.
- Sync centre exports the queue for recovery. An owner may explicitly discard unresolved changes after reconciliation. A cashier must provide same-salon owner approval; this is audited. Actual money already collected must be handled separately.
- Receipts state whether the sale is pending or cloud-confirmed. Cloud-confirmed receipt identifiers are generated from the stable sale ID.

## Online sessions and offline access

Passwords are salted scrypt hashes. Browser sessions use opaque tokens in HttpOnly, SameSite=Strict cookies, with Secure enabled for HTTPS deployments. The database stores token hashes. Mutating requests require a session CSRF value, JSON content type and same-origin checks when the browser supplies Origin.

Online sessions expire after 12 hours. A previously signed-in device may use its cache for up to 12 hours after its last successful online verification. A revoked account can therefore retain offline access during that grace period but cannot upload after revocation. This tradeoff is explicit; instant remote revocation cannot work while the device is disconnected.

Offline access is trusted-device access, not a separate offline password/PIN lock. Cached data and recovery files contain customer information and are not application-encrypted. Use device encryption and screen locks; log out before transferring the device. Logout requires syncing and an online server response before local data is cleared. Passwords and session cookies are not included in recovery exports.

The single local cache is tied to a specific user and salon. Switching accounts with unsynced changes is blocked. Do not clear browser/app data to resolve a sync problem.

## Hosting using Docker

1. Provide a Linux server with Docker Compose, persistent storage and a domain that points to it.
2. Copy `.env.example` to `.env`, set `SALON_DOMAIN` to the actual hostname, and keep `.env` out of source control.
3. Run `docker compose up -d --build` from this folder.
4. Run `docker compose exec app node server/manage.mjs create-salon` to create the first salon account.
5. Open the configured HTTPS address and test logins, receipts and another-device syncing.

Caddy handles HTTPS using the supplied domain. The app container is not directly published; only Caddy exposes ports 80/443. Do not publicly expose an insecure development instance.

The database is `/app/data/salon.sqlite` on a persistent Docker volume. Keep a single app instance for this release. This SQLite architecture is appropriate for a controlled single-server pilot; multi-region/high-availability operation and heavy traffic require further design and testing. Do not deploy the database on ephemeral serverless storage.

For a managed host, use the Dockerfile, persist `/app/data`, set `PUBLIC_ORIGIN` to the exact HTTPS origin, and allow the platform's port routing. Confirm volume support, volume permissions, backups and one-instance operation before deploying. The Dockerfile uses Node's unprivileged `node` user (UID 1000); mounted data must be writable by that user. No managed-host deployment was performed here.

## Operations and backups

Server commands (run in this folder or the app container):

- `node server/manage.mjs create-salon`: provision a salon and owner.
- `node server/manage.mjs list`: list salon codes and active state.
- `node server/manage.mjs set-active SALON-CODE`: activate/suspend the salon. Suspending removes online sessions.
- `node server/manage.mjs reset-password SALON-CODE`: recover an account and revoke its sessions.
- `node server/manage.mjs backup /path/to/new-backup.sqlite`: create a consistent SQLite backup via SQLite's backup API.

For Docker, a backup can be written to `/app/data/backup-YYYY-MM-DD.sqlite`, then copied to protected external storage. Do not treat a second file on the same server as a disaster-recovery backup. A backup schedule, off-server destination, monitoring and retention are deployment tasks and are not automatically active in this package.

Restore procedure: stop the app, retain the current database for rollback, restore a verified database backup in the data volume, remove stale WAL/SHM companions only while stopped, restore ownership, and start the app. Test restored salon logins and receipt counts. Avoid copying a live SQLite main file without its journal; use the supplied backup command.

## Android build

See `android/README.md`. The cloud Android application uses a separate application ID so it does not overwrite the older offline app. Its server address is a placeholder that must be configured after hosting.

Browser and Android cloud clients use the same hosted frontend. A service worker caches the application shell; localStorage retains queued data. Initial login and shell installation require connectivity. A modern Android System WebView with Web Locks and service worker support is required, even though the native minimum SDK is Android 8.0. Cold-start offline behaviour must be tested on the intended POS model.

Native receipt exports, logo selection and system printing remain in the Android shell. Direct thermal printers and integrated card processing still require the hardware/provider integration.

## Migration from the older offline edition

The older app and its saved deliverables are unchanged. Do not overwrite cloud data with a v1 backup. Cloud backup replacement is intentionally disabled. Importing historical customer/sale data requires a reviewed migration process so records retain their provenance and cannot overwrite another device's work. This migration tool is not included.

## Before charging customers

Hosting, domain configuration, real accounts and on-device validation must be completed first. Also needed for a broader commercial launch: security review, rendered UI testing, restore drills, account recovery procedures, support policies, error monitoring, audited operator workflows, licensing/subscription collection, and any printer/payment integrations promised to buyers. The current inline-event-handler frontend uses an inline-compatible CSP; a stricter external-script migration is recommended before broad deployment.

No store listing, APK signing, recurring notification/SMS service, email delivery, automatic cloud backup schedule, POS terminal charge, paid licence enforcement or external deployment is claimed by this release.

## Primary references

- Node SQLite: https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html
- Caddy HTTPS: https://caddyserver.com/docs/automatic-https
- Android HTML printing: https://developer.android.com/training/printing/html-docs
