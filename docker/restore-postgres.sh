#!/bin/sh
# Restore drill (board C-12, ALPHA_PLAN 7.4, §18.1 "backups are restored in a
# documented drill"): restores a backup made by backup-postgres.sh into the
# compose stack's Postgres. Drops and recreates the target database first --
# meant for a disaster-recovery drill or a fresh environment, never for
# restoring over a database you want to keep running.
#
#   docker/restore-postgres.sh path/to/postgres-<stamp>.dump.gz [compose-file]
set -e
DUMP="$1"
COMPOSE_FILE="${2:-docker/docker-compose.prod.yml}"
if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
  echo "usage: docker/restore-postgres.sh path/to/postgres-<stamp>.dump.gz [compose-file]" >&2
  exit 2
fi

DB="${POSTGRES_DB:-moviedb}"
USER="${POSTGRES_USER:-movieapp}"

docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U "$USER" -d postgres -c "DROP DATABASE IF EXISTS \"$DB\";" \
  -c "CREATE DATABASE \"$DB\" OWNER \"$USER\";"

gunzip -c "$DUMP" | docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_restore -U "$USER" -d "$DB" --no-owner

echo "restored $DUMP into database \"$DB\""
