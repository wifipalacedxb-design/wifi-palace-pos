# Deploy WiFi Palace POS to pos.wifipalace.in (Hostinger hPanel)

WiFi Palace POS runs as its **own** hPanel Node.js application, next to the live Salon Desk at wifipalace.in. The two never share code, database, backups or settings.

| | Salon Desk (live, do not touch) | WiFi Palace POS (new) |
| --- | --- | --- |
| Domain | wifipalace.in | pos.wifipalace.in |
| GitHub repo | wifi-palace-salon-cloud | wifi-palace-pos (branch `main`) |
| Database | /home/u785393543/salon-data/salon.sqlite | /home/u785393543/pos-data/pos.sqlite |
| Backups | /home/u785393543/salon-backups | /home/u785393543/pos-backups |
| Backup cron | ops/hostinger-backup.sh | ops/hostinger-pos-backup.sh |

## 1. Before you start
1. Confirm the current date and that the salon at wifipalace.in is working (sign in once).
2. Take a manual salon backup (BACKUP-RECOVERY.md, section 1). Nothing below touches the salon, but a fresh backup is the rule before any hosting change.

## 2. Subdomain
hPanel → Domains → Subdomains → create `pos.wifipalace.in`. Wait for SSL to be issued (hPanel → Security → SSL).

## 3. Node.js application
hPanel → Websites → Add website → Node.js app (the same way wifipalace.in was set up):

| Setting | Value |
| --- | --- |
| Domain | pos.wifipalace.in |
| Source | GitHub → wifipalacedxb-design/wifi-palace-pos, branch `main` |
| Node.js version | 24 |
| Entry file | server/hostinger.mjs |
| Build / install command | none needed (no npm dependencies) |

Environment variables (copy any others the salon app uses, except these):

| Variable | Value |
| --- | --- |
| PUBLIC_ORIGIN | https://pos.wifipalace.in |
| DATABASE_FILE | /home/u785393543/pos-data/pos.sqlite |
| SIGNUP_ENABLED | false (turn on later, with RESEND_API_KEY and MAIL_FROM) |

Create the data folder once over SSH: `mkdir -p /home/u785393543/pos-data /home/u785393543/pos-backups && chmod 700 /home/u785393543/pos-data /home/u785393543/pos-backups`

## 4. Check
1. Open https://pos.wifipalace.in/health → `{"ok":true}`.
2. Open https://pos.wifipalace.in/ → WiFi Palace POS sign-in page.
3. Open https://wifipalace.in/ → the salon still works exactly as before.

## 5. Provider account and first business
Over SSH, in the POS app folder, with `DATABASE_FILE=/home/u785393543/pos-data/pos.sqlite` set: create the provider admin (PROVIDER-SETUP.md), then add a test laundry from https://pos.wifipalace.in/admin (type Laundry). Sign in, take a test order, print, pay, hand over.

## 6. Backups
Run once: `/bin/sh /home/u785393543/domains/pos.wifipalace.in/hbuilds/current/nodejs/ops/hostinger-pos-backup.sh` (check the real app path in hPanel first; adjust the script if it differs). Expect `ok:true` and `restoreTest:passed`. Then add an hourly cron (minute 45, so it does not overlap the salon's minute 15).

## 7. Android app
Build the release APK/AAB (android/README.md). The app ID `com.wifipalace.pos` installs alongside Salon Desk.

## Rollback
The salon is never changed, so rollback is only: stop the pos.wifipalace.in app in hPanel. Its database and backups stay in their own folders.
