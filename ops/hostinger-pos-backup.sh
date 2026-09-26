#!/bin/sh
set -eu
umask 077
# WiFi Palace POS backups. Separate from the salon: different database, backup folder and env file.
export DATABASE_FILE=/home/u785393543/pos-data/pos.sqlite
export BACKUP_DIR=/home/u785393543/pos-backups
export BACKUP_KEEP=168
# Optional private config for the offsite remote; never put credentials in GitHub.
if [ -f /home/u785393543/pos-backup.env ]; then
 . /home/u785393543/pos-backup.env
fi
exec /opt/alt/alt-nodejs24/root/usr/bin/node /home/u785393543/domains/pos.wifipalace.in/hbuilds/current/nodejs/server/backup.mjs run
