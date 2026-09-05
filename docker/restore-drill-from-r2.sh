#!/bin/sh
# P0-5 restore drill (ALPHA_PLAN 7.4 "backups are restored in a documented
# drill", ADR-98's precedent: a backup that has never been restored is a
# hope, not a backup). Downloads the newest object under postgres/ in the R2
# bucket (or one named explicitly), verifies its checksum, decrypts it,
# checks its table of contents, and restores it into RESTORE_DRILL_DB -- a
# disposable database this script drops and recreates every run. It never
# touches the database DATABASE_URL itself points at; that connection is
# used only to reach the same Postgres *server* so a sibling database can be
# created there.
#
#   DATABASE_URL=... RESTORE_DRILL_DB=postgres_restore_drill \
#   R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
#   R2_BUCKET=... R2_S3_ENDPOINT=... BACKUP_ENCRYPTION_KEY=... \
#   docker/restore-drill-from-r2.sh [object-key]
#
# Meant to run on its own schedule (weekly is plenty -- this proves the
# pipeline, not the data), separate from the backup job so a broken restore
# path is caught even on a day nothing was backed up.
set -eu

for var in DATABASE_URL RESTORE_DRILL_DB R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET R2_S3_ENDPOINT BACKUP_ENCRYPTION_KEY; do
  eval "value=\${$var:-}"
  if [ -z "$value" ]; then
    echo "restore drill FAILED: $var is not set" >&2
    exit 1
  fi
done

# Refuse to drill into anything that looks like a real database name, so a
# copy-pasted DATABASE_URL from production config cannot turn this into a
# live drop. This is a disposable-database guard, not a full name validator.
case "$RESTORE_DRILL_DB" in
  moviedb|moviedb_test|postgres|template0|template1)
    echo "restore drill FAILED: RESTORE_DRILL_DB=$RESTORE_DRILL_DB looks like a real database, not a disposable one" >&2
    exit 1
    ;;
esac

export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION=auto

OBJECT_KEY="${1:-}"
if [ -z "$OBJECT_KEY" ]; then
  OBJECT_KEY=$(aws s3 ls "s3://$R2_BUCKET/postgres/" --endpoint-url "$R2_S3_ENDPOINT" \
    | awk '/\.dump\.enc$/ {print $4}' | sort | tail -1)
  [ -n "$OBJECT_KEY" ] || { echo "restore drill FAILED: no backup found under s3://$R2_BUCKET/postgres/" >&2; exit 1; }
  OBJECT_KEY="postgres/$OBJECT_KEY"
fi

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT
ENCRYPTED="$WORKDIR/backup.dump.enc"
DUMP="$WORKDIR/backup.dump"

aws s3 cp "s3://$R2_BUCKET/$OBJECT_KEY" "$ENCRYPTED" --endpoint-url "$R2_S3_ENDPOINT" --only-show-errors
aws s3 cp "s3://$R2_BUCKET/$OBJECT_KEY.sha256" "$ENCRYPTED.sha256" --endpoint-url "$R2_S3_ENDPOINT" --only-show-errors

EXPECTED_SUM=$(cat "$ENCRYPTED.sha256")
ACTUAL_SUM=$(sha256sum "$ENCRYPTED" | awk '{print $1}')
if [ "$EXPECTED_SUM" != "$ACTUAL_SUM" ]; then
  echo "restore drill FAILED: checksum mismatch for $OBJECT_KEY (expected $EXPECTED_SUM, got $ACTUAL_SUM)" >&2
  exit 1
fi

openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_ENCRYPTION_KEY -in "$ENCRYPTED" -out "$DUMP"

if ! pg_restore --list "$DUMP" > /dev/null; then
  echo "restore drill FAILED: $OBJECT_KEY has no readable table of contents after decryption" >&2
  exit 1
fi

# Everything past here talks to the server DATABASE_URL names, substituting
# only the final path segment (the database name) for RESTORE_DRILL_DB --
# same host, port and credentials, a disposable sibling database.
DRILL_URL=$(printf '%s' "$DATABASE_URL" | sed -E 's#(/[^/?]+)(\?.*)?$#/'"$RESTORE_DRILL_DB"'\2#')

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$RESTORE_DRILL_DB\";" -c "CREATE DATABASE \"$RESTORE_DRILL_DB\";"
pg_restore -d "$DRILL_URL" --no-owner "$DUMP"

TABLE_COUNT=$(psql "$DRILL_URL" -t -A -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';")
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE \"$RESTORE_DRILL_DB\";"

if [ "$TABLE_COUNT" -lt 1 ]; then
  echo "restore drill FAILED: restored database has no tables" >&2
  exit 1
fi

echo "restore drill OK: $OBJECT_KEY restored and queried ($TABLE_COUNT table(s)), drill database dropped"
