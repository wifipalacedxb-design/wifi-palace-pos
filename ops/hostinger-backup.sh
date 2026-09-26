#!/bin/sh
set -eu
umask 077
# This is independent of hPanel's application environment variables.
export DATABASE_FILE=/home/u785393543/salon-data/salon.sqlite
export BACKUP_DIR=/home/u785393543/salon-backups
export BACKUP_KEEP=168
# Optional private config for offsite remote; never put credentials in GitHub.
if [ -f /home/u785393543/salon-backup.env ]; then
 . /home/u785393543/salon-backup.env
fi
exec /opt/alt/alt-nodejs24/root/usr/bin/node /home/u785393543/domains/wifipalace.in/hbuilds/current/nodejs/server/backup.mjs run
