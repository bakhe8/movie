#!/bin/sh
# O-11 (ADR-105): the one-way restore that moves the live database to a new
# Postgres server -- the same verified path as the weekly drill, but aimed
# at a real, empty target instead of a disposable sibling. It reads from R2
# and writes only to TARGET_DATABASE_URL; it never touches the source
# database, and it never drops anything.
#
#   TARGET_DATABASE_URL=postgresql://... \
#   R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
#   R2_BUCKET=... R2_S3_ENDPOINT=... BACKUP_ENCRYPTION_KEY=... \
#   docker/restore-into-target-from-r2.sh [object-key]
#
# Offline alternative when the encrypted dump is already on disk (the same
# file the drill downloads), so the cutover does not depend on R2 being
# reachable from wherever this runs:
#
#   LOCAL_ENCRYPTED_FILE=/path/postgres-….dump.enc BACKUP_ENCRYPTION_KEY=… \
#   TARGET_DATABASE_URL=… docker/restore-into-target-from-r2.sh
#
# The target must be empty: this refuses to write into a database that
# already has tables in `public`, so a mis-pasted URL cannot merge a restore
# into a live database. Set ALLOW_NONEMPTY_TARGET=yes only to deliberately
# re-run onto a half-restored target. SKIP_EXTENSIONS=vector leaves an
# extension the target's image does not ship out of the restore (see below).
set -eu

[ -n "${TARGET_DATABASE_URL:-}" ] || { echo "restore FAILED: TARGET_DATABASE_URL is not set" >&2; exit 1; }
[ -n "${BACKUP_ENCRYPTION_KEY:-}" ] || { echo "restore FAILED: BACKUP_ENCRYPTION_KEY is not set" >&2; exit 1; }

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT
ENCRYPTED="$WORKDIR/backup.dump.enc"
DUMP="$WORKDIR/backup.dump"

if [ -n "${LOCAL_ENCRYPTED_FILE:-}" ]; then
  [ -f "$LOCAL_ENCRYPTED_FILE" ] || { echo "restore FAILED: $LOCAL_ENCRYPTED_FILE does not exist" >&2; exit 1; }
  cp "$LOCAL_ENCRYPTED_FILE" "$ENCRYPTED"
  SOURCE_LABEL="$LOCAL_ENCRYPTED_FILE"
  if [ -f "$LOCAL_ENCRYPTED_FILE.sha256" ]; then
    cp "$LOCAL_ENCRYPTED_FILE.sha256" "$ENCRYPTED.sha256"
  fi
else
  for var in R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET R2_S3_ENDPOINT; do
    eval "value=\${$var:-}"
    [ -n "$value" ] || { echo "restore FAILED: $var is not set" >&2; exit 1; }
  done
  export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
  export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
  export AWS_DEFAULT_REGION=auto

  OBJECT_KEY="${1:-}"
  if [ -z "$OBJECT_KEY" ]; then
    OBJECT_KEY=$(aws s3 ls "s3://$R2_BUCKET/postgres/" --endpoint-url "$R2_S3_ENDPOINT" \
      | awk '/\.dump\.enc$/ {print $4}' | sort | tail -1)
    [ -n "$OBJECT_KEY" ] || { echo "restore FAILED: no backup found under s3://$R2_BUCKET/postgres/" >&2; exit 1; }
    OBJECT_KEY="postgres/$OBJECT_KEY"
  fi
  aws s3 cp "s3://$R2_BUCKET/$OBJECT_KEY" "$ENCRYPTED" --endpoint-url "$R2_S3_ENDPOINT" --only-show-errors
  aws s3 cp "s3://$R2_BUCKET/$OBJECT_KEY.sha256" "$ENCRYPTED.sha256" --endpoint-url "$R2_S3_ENDPOINT" --only-show-errors
  SOURCE_LABEL="s3://$R2_BUCKET/$OBJECT_KEY"
fi

if [ -f "$ENCRYPTED.sha256" ]; then
  EXPECTED_SUM=$(cat "$ENCRYPTED.sha256")
  ACTUAL_SUM=$(sha256sum "$ENCRYPTED" | awk '{print $1}')
  if [ "$EXPECTED_SUM" != "$ACTUAL_SUM" ]; then
    echo "restore FAILED: checksum mismatch for $SOURCE_LABEL (expected $EXPECTED_SUM, got $ACTUAL_SUM)" >&2
    exit 1
  fi
else
  echo "restore: no .sha256 alongside $SOURCE_LABEL; relying on the decryption and table-of-contents checks below"
fi

openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_ENCRYPTION_KEY -in "$ENCRYPTED" -out "$DUMP"

if ! pg_restore --list "$DUMP" > /dev/null; then
  echo "restore FAILED: $SOURCE_LABEL has no readable table of contents after decryption" >&2
  exit 1
fi

EXISTING=$(psql "$TARGET_DATABASE_URL" -t -A -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';")
if [ "$EXISTING" -gt 0 ] && [ "${ALLOW_NONEMPTY_TARGET:-no}" != "yes" ]; then
  echo "restore FAILED: the target already has $EXISTING table(s) in public; refusing to restore into a non-empty database (ALLOW_NONEMPTY_TARGET=yes to override)" >&2
  exit 1
fi

# A dump carries `CREATE EXTENSION` for every extension installed on the
# source, and those fail on a server whose image does not ship them --
# `vector` is the one that matters here (installed on the pgvector dev image,
# unused by any column since ADR-57/ADR-2). SKIP_EXTENSIONS is a
# comma-separated list of extension names to leave out of this restore by
# filtering the archive's table of contents; the dump itself is untouched,
# and nothing is skipped unless it is named.
RESTORE_ARGS=""
if [ -n "${SKIP_EXTENSIONS:-}" ]; then
  pg_restore --list "$DUMP" > "$WORKDIR/toc.list"
  cp "$WORKDIR/toc.list" "$WORKDIR/toc.filtered"
  for ext in $(printf '%s' "$SKIP_EXTENSIONS" | tr ',' ' '); do
    grep -v "EXTENSION - $ext " "$WORKDIR/toc.filtered" > "$WORKDIR/toc.next" || true
    grep -v "COMMENT - EXTENSION $ext " "$WORKDIR/toc.next" > "$WORKDIR/toc.filtered" || true
  done
  REMOVED=$(( $(wc -l < "$WORKDIR/toc.list") - $(wc -l < "$WORKDIR/toc.filtered") ))
  echo "restore: SKIP_EXTENSIONS=$SKIP_EXTENSIONS removed $REMOVED entry/entries from the table of contents"
  RESTORE_ARGS="-L $WORKDIR/toc.filtered"
fi

# shellcheck disable=SC2086 -- RESTORE_ARGS is either empty or "-L <path>"
pg_restore -d "$TARGET_DATABASE_URL" --no-owner --exit-on-error $RESTORE_ARGS "$DUMP"

TABLE_COUNT=$(psql "$TARGET_DATABASE_URL" -t -A -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';")
[ "$TABLE_COUNT" -ge 1 ] || { echo "restore FAILED: the restored database has no tables" >&2; exit 1; }

echo "restore OK: $SOURCE_LABEL -> target ($TABLE_COUNT table(s))"
echo "row counts on the restored target (compare these with the source before the cutover):"
psql "$TARGET_DATABASE_URL" -c "SELECT relname AS table, n_live_tup AS approx_rows FROM pg_stat_user_tables ORDER BY n_live_tup DESC, relname LIMIT 15;"
psql "$TARGET_DATABASE_URL" -t -A -c "SELECT 'users=' || count(*) FROM users;" 2>/dev/null || true
psql "$TARGET_DATABASE_URL" -t -A -c "SELECT 'titles=' || count(*) FROM titles;" 2>/dev/null || true
psql "$TARGET_DATABASE_URL" -t -A -c "SELECT 'migrations=' || count(*) FROM migrations;" 2>/dev/null || true
