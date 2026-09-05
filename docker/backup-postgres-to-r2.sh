#!/bin/sh
# P0-5: automated, encrypted, off-box backup (ALPHA_PLAN 7.4's "daily backup"
# half; PITR is a property of the managed Postgres ADR-24 leaves open). The
# existing backup-postgres.sh runs `docker compose exec`, which has no
# equivalent on Railway -- there is no host to exec into, and Railway Cron
# runs a job as its own short-lived container. This script instead connects
# straight to Postgres over the network and uploads to an object-storage
# bucket the app's own database credentials cannot reach (O-8: Cloudflare
# R2, S3-compatible), so a compromised `DATABASE_URL` cannot also delete the
# backups that would recover from it.
#
#   DATABASE_URL=... R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... \
#   R2_SECRET_ACCESS_KEY=... R2_BUCKET=... R2_S3_ENDPOINT=... \
#   BACKUP_ENCRYPTION_KEY=... docker/backup-postgres-to-r2.sh
#
# Meant to run as a Railway Cron service (docker/backup.Dockerfile), on the
# schedule the owner sets in Railway; run here by hand only to prove the
# pipeline against a disposable database (see restore-drill-from-r2.sh for
# the other half -- a backup nobody has restored is a hope, not a backup).
#
# Same non-destructive pg_dump + pg_restore --list verification as
# backup-postgres.sh (AUDIT_2026-09-05 H8: a corrupt/empty archive is caught
# here, before it is uploaded, not discovered during a real recovery), plus
# what an object-storage destination adds: encryption at rest
# (BACKUP_ENCRYPTION_KEY, never committed, never logged), a checksum
# uploaded alongside the archive so a download can be verified byte-for-byte
# before anyone tries to restore it, and an object key that sorts
# chronologically so "the newest backup" is a plain `aws s3 ls | tail -1`.
set -eu

for var in DATABASE_URL R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET R2_S3_ENDPOINT BACKUP_ENCRYPTION_KEY; do
  eval "value=\${$var:-}"
  if [ -z "$value" ]; then
    echo "backup FAILED: $var is not set" >&2
    exit 1
  fi
done

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DUMP="$WORKDIR/postgres-$STAMP.dump"
ENCRYPTED="$DUMP.enc"

pg_dump "$DATABASE_URL" --format=custom --file="$DUMP"

if ! pg_restore --list "$DUMP" > /dev/null; then
  echo "backup FAILED: the dump has no readable table of contents (pg_restore --list); nothing was uploaded" >&2
  exit 1
fi

# -pbkdf2: openssl's legacy KDF (EVP_BytesToKey) is not something to derive
# a key from in 2026; -pbkdf2 has been the documented safe default since
# OpenSSL 1.1.1. `-pass env:...` reads the passphrase from the environment,
# never argv, so it never appears in `ps` output on a shared host.
openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_ENCRYPTION_KEY -in "$DUMP" -out "$ENCRYPTED"
sha256sum "$ENCRYPTED" | awk '{print $1}' > "$ENCRYPTED.sha256"

export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION=auto

KEY="postgres/postgres-$STAMP.dump.enc"
aws s3 cp "$ENCRYPTED" "s3://$R2_BUCKET/$KEY" --endpoint-url "$R2_S3_ENDPOINT" --only-show-errors
aws s3 cp "$ENCRYPTED.sha256" "s3://$R2_BUCKET/$KEY.sha256" --endpoint-url "$R2_S3_ENDPOINT" --only-show-errors

echo "backup written: s3://$R2_BUCKET/$KEY ($(du -h "$ENCRYPTED" | cut -f1))"
