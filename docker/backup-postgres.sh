#!/bin/sh
# Daily backup (board C-12, ALPHA_PLAN 7.4): a full pg_dump of the compose
# stack's Postgres, custom format (pg_restore-compatible), timestamped and
# gzip-compressed, written to ./backups/ (gitignored -- these are real data).
#
#   docker/backup-postgres.sh [compose-file] [backups-dir]
#
# Meant to be invoked by whatever scheduler the deploy pipeline uses (cron,
# a systemd timer, the platform's own job scheduler) once a day; run here by
# hand to prove the restore drill below is real. Managed PITR (continuous
# archiving) is a property of the managed Postgres ADR-24 chooses, not of
# this compose file -- this script is the staging/self-hosted equivalent of
# the daily full backup half of "daily backup + PITR" (7.4).
#
# A pipeline's exit status under POSIX sh is its last command's -- gzip's,
# never pg_dump's -- so a failed dump used to leave a small, well-formed,
# empty .gz behind and report success (AUDIT_2026-09-05 H8). Now pg_dump's
# own status is carried out of the pipe, the archive is written under a
# .partial name, checked for a readable table of contents with
# `pg_restore --list` (a truncated or empty archive has none), and only then
# renamed into place: a file named like a backup is one that restores.
set -eu
COMPOSE_FILE="${1:-docker/docker-compose.prod.yml}"
BACKUPS_DIR="${2:-docker/backups}"
mkdir -p "$BACKUPS_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$BACKUPS_DIR/postgres-$STAMP.dump.gz"
PARTIAL="$OUT.partial"
STATUS_FILE=$(mktemp)
trap 'rm -f "$PARTIAL" "$STATUS_FILE"' EXIT

{
  docker compose -f "$COMPOSE_FILE" exec -T postgres \
    pg_dump -U "${POSTGRES_USER:-movieapp}" -d "${POSTGRES_DB:-moviedb}" --format=custom \
    && echo 0 > "$STATUS_FILE" || echo $? > "$STATUS_FILE"
} | gzip > "$PARTIAL"

DUMP_STATUS=$(cat "$STATUS_FILE")
if [ "$DUMP_STATUS" != "0" ]; then
  echo "backup FAILED: pg_dump exited with status ${DUMP_STATUS:-unknown}; nothing was written to $OUT" >&2
  exit 1
fi

if ! gunzip -c "$PARTIAL" | docker compose -f "$COMPOSE_FILE" exec -T postgres pg_restore --list > /dev/null; then
  echo "backup FAILED: the archive has no readable table of contents (pg_restore --list); nothing was written to $OUT" >&2
  exit 1
fi

mv "$PARTIAL" "$OUT"
echo "backup written: $OUT ($(du -h "$OUT" | cut -f1))"
