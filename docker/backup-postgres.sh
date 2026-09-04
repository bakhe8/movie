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
set -e
COMPOSE_FILE="${1:-docker/docker-compose.prod.yml}"
BACKUPS_DIR="${2:-docker/backups}"
mkdir -p "$BACKUPS_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$BACKUPS_DIR/postgres-$STAMP.dump.gz"

docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-movieapp}" -d "${POSTGRES_DB:-moviedb}" --format=custom \
  | gzip > "$OUT"

echo "backup written: $OUT ($(du -h "$OUT" | cut -f1))"
