#!/bin/sh
# Nightly PostgreSQL backup: compressed custom-format dump, copied to S3, 14 days kept locally.
# Restore: pg_restore --clean --if-exists -d stmarys <file>.dump
set -eu
STAMP=$(date -u +%Y%m%d-%H%M%S)
FILE="/backups/stmarys-${STAMP}.dump"

pg_dump --format=custom --no-owner --file="$FILE"
echo "[backup] wrote $FILE ($(du -h "$FILE" | cut -f1))"

if [ -n "${BACKUP_S3_URI:-}" ]; then
  aws s3 cp "$FILE" "${BACKUP_S3_URI%/}/$(basename "$FILE")" --only-show-errors
  echo "[backup] uploaded to ${BACKUP_S3_URI}"
else
  echo "[backup] BACKUP_S3_URI not set - kept locally only"
fi

find /backups -name 'stmarys-*.dump' -mtime +14 -delete
