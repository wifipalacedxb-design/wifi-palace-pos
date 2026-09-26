# Automatic backups and recovery — activation required

The deployed code alone does NOT schedule backups. Enable the Hostinger cron job below, run it once and check output. Offsite backup also needs a separate storage account and rclone configuration. Until configured, status explicitly says offsite: not-configured. This work has been tested on a temporary database, not restored over production.

## What is protected

The complete SQLite database: all salons, sales, users/password hashes, appointments, subscriptions, finance and audit records, and signup state. Synced database records only: unsynced device sales are not on the server and cannot be backed up here. Code remains in GitHub. Hosting environment secrets, rclone credentials and encryption passwords require separate secure recovery records.

Each run uses SQLite online backup (including committed WAL data), checks integrity and foreign keys, writes a SHA-256 manifest, restores into a separate file and reopens/checks that copy. The source is opened read-only and must already exist. Files are private (0600), directory 0700, outside the deployed application and web root. There is no public download endpoint. All-tenant backups must be accessible only to WiFi Palace administrators.

Default retention is the latest 168 valid snapshots. At one successful run per hour this is about seven days; extra manual runs reduce time coverage. Older snapshots are removed only after a verified successful run; unrelated files and failed/incomplete snapshots are left alone. Monitor disk space. A run requires extra temporary disk space for restore and offsite read-back copies. No automatic remote deletion is performed: set appropriate remote storage retention/lifecycle separately, preserving backup/manifest pairs. A checksum detects corruption, not malicious tampering by someone who can replace both files.

## 1. First manual run on Hostinger (after deployment)

Use the existing SSH session. Paste this single command:

```sh
/bin/sh /home/u785393543/domains/wifipalace.in/hbuilds/current/nodejs/ops/hostinger-backup.sh
```

Expected JSON: ok:true and restoreTest:passed. Offsite remains not-configured until section 3. Backup files and status.json are in /home/u785393543/salon-backups. Do not put this directory in public_html. The launcher uses the confirmed persistent database /home/u785393543/salon-data/salon.sqlite and Node24 binary. It does not rely on hPanel Node app environment variables being inherited by cron.

## 2. Schedule hourly

In Hostinger hPanel, select wifipalace.in → Advanced → Cron Jobs → Custom. Command:

```sh
/bin/sh /home/u785393543/domains/wifipalace.in/hbuilds/current/nodejs/ops/hostinger-backup.sh
```

Choose minute 15, every hour, every day/month/weekday (cron expression `15 * * * *`). This runs hourly at :15 regardless of the hosting timezone. Check cron output after the next scheduled run; a saved cron entry is not proof that it ran. Keep error output visible. Set up external failure/stale-job monitoring before depending on this for production. This release provides status and exit codes, not automatic email alerts.

Status check from SSH:

```sh
BACKUP_DIR=/home/u785393543/salon-backups /opt/alt/alt-nodejs24/root/usr/bin/node /home/u785393543/domains/wifipalace.in/hbuilds/current/nodejs/server/backup.mjs status
```

Nonzero exit when last run failed or last success is over two hours old. A missing status file is also failure. Check cron output for failures before the status file could be written (permissions/missing source/lock). The atomic lock prevents concurrent jobs. After an interrupted process, inspect .backup-lock/owner.json and verify no backup process is running before removing that lock; never remove it during an active backup.

## 3. Separate offsite copy

Choose a private storage account independent of Hostinger (for example your business Google Drive or S3-compatible storage). Install rclone in your user account if the host permits it; configure the remote securely through SSH. Prefer a crypt remote on top of the destination so remote files are encrypted. Preserve its encryption password and configuration separately or recovery is impossible. Do not paste credentials into chat or commit them to GitHub. A same-server directory does not count as offsite protection.

Create the private file /home/u785393543/salon-backup.env, mode 0600, with the following settings adjusted to the actual configured executable and remote (these are templates, not credentials):

```sh
export RCLONE_BIN='/absolute/path/to/rclone'
export RCLONE_CONFIG='/home/u785393543/.config/rclone/rclone.conf'
export BACKUP_REMOTE='saloncrypt:hourly'
```

The launcher loads this file. A run uploads the database and manifest using copyto, downloads the database again and compares its hash. Offsite success means download-verified. On offsite error, exit is nonzero, local backup is retained and pruning is skipped. No automatic retry of older failed remote uploads: subsequent runs produce fresh snapshots. No real remote has been configured or tested by development. Verify a remote download and restore after setup and periodically thereafter.

## 4. Restore drill — always to a NEW file

Keep both a chosen .sqlite file and its matching .sqlite.json manifest together. Download both through the configured crypt remote when testing disaster recovery; this decrypts them. Use the backup filename shown by the successful job, not a placeholder typed literally.

The tool supports `verify <backup-file>` and `restore-test <backup-file> <new-destination-file>`. Invoke using the full Node24 and server/backup.mjs paths above. restore-test refuses to overwrite any existing destination. It checks checksum, schema, counts, integrity and foreign keys, then checks the independently copied file. The automated integration test also starts the application against a restored fixture and verifies owner login and salon state.

## 5. Production recovery (operator procedure, not automated)

1. Stop salon use and preserve every device's pending queue; do not clear browser data. Record the backup timestamp and potential sales lost since it.
2. Stop all app processes and pause the cron job. Hostinger must confirm the application is stopped, not just a tab closed. Never overwrite a live SQLite file or mix old WAL/SHM files with a restored database.
3. Preserve the existing database and sidecar files for investigation. Restore-test into a NEW filename inside salon-data; do not replace the original.
4. Test the restored copy in an isolated staging app with email/signup integrations disabled. Check salon counts, several receipts, refunds, owner login, expenses and totals. Restoring all-tenant data affects every customer; do not use a single-salon issue as reason to roll everyone back.
5. Before making the restored database live, revoke restored salon and provider sessions in that restored copy. Used invitation/signup tokens can reappear after rollback; invalidate pending invitations and signup requests. Have a qualified operator do this transaction while stopped; do not run unreviewed SQL against production.
6. Point Hostinger DATABASE_FILE and the backup launcher's DATABASE_FILE (via the private env override) to the exact restored filename. Restart and verify health plus sign-in and reports. Resume hourly cron and make a new verified backup.
7. Reconcile receipts and offline queues carefully: a device may have acknowledged sales newer than the backup. Automatic sync cannot reconstruct all acknowledged data lost in rollback, and restoring revisions can cause conflicts. Reopen customer access after reconciliation.

Hourly backups target at most about one hour of synced-data loss only while jobs are succeeding. This is not a guaranteed recovery SLA. A full hosting-account loss also needs code, environment configuration, offsite data and separately secured encryption credentials. Practice recovery before promising it to customers.

References: https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html ; https://www.hostinger.com/support/1583465-how-to-set-up-a-cron-job-at-hostinger/ ; https://rclone.org/commands/rclone_copyto/ ; https://rclone.org/crypt/
