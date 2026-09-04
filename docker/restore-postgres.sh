#!/bin/sh
# Restore drill (board C-12, ALPHA_PLAN 7.4, §18.1 "backups are restored in a
# documented drill"): restores a backup made by backup-postgres.sh into the
# compose stack's Postgres. Drops and recreates the target database first --
# meant for a disaster-recovery drill or a fresh environment, never for
# restoring over a database you want to keep running.
#
#   docker/restore-postgres.sh path/to/postgres-<stamp>.dump.gz <compose-file> [--yes]
#
# Three guards (AUDIT_2026-09-05 H9). The compose file is a required
# argument: it used to default to docker-compose.prod.yml, so a local drill
# run in a shell whose Docker context happened to be production dropped the
# live database. The DROP runs only after the operator types the database
# name back -- or passes --yes, for a scripted drill. And before either, the
# archive is checked for a readable table of contents, so a corrupt backup
# is found while the old database still exists.
set -eu
DUMP="${1:-}"
COMPOSE_FILE="${2:-}"
CONFIRM="${3:-}"

usage() {
  echo "usage: docker/restore-postgres.sh path/to/postgres-<stamp>.dump.gz <compose-file> [--yes]" >&2
  exit 2
}
[ -n "$DUMP" ] && [ -f "$DUMP" ] || usage
[ -n "$COMPOSE_FILE" ] && [ -f "$COMPOSE_FILE" ] || usage
case "$CONFIRM" in
  ''|--yes) ;;
  *) usage ;;
esac

DB="${POSTGRES_DB:-moviedb}"
USER="${POSTGRES_USER:-movieapp}"
CONTEXT=$(docker context show 2>/dev/null || echo unknown)

if ! gunzip -c "$DUMP" | docker compose -f "$COMPOSE_FILE" exec -T postgres pg_restore --list > /dev/null; then
  echo "refusing to restore: $DUMP has no readable table of contents (pg_restore --list); database \"$DB\" was not touched" >&2
  exit 1
fi

if [ "$CONFIRM" != "--yes" ]; then
  echo "About to DROP and recreate database \"$DB\" through $COMPOSE_FILE (docker context: $CONTEXT), then restore $DUMP into it."
  printf 'Type the database name (%s) to continue: ' "$DB"
  if ! read -r REPLY || [ "$REPLY" != "$DB" ]; then
    echo
    echo "aborted: nothing was dropped" >&2
    exit 1
  fi
fi

docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U "$USER" -d postgres -c "DROP DATABASE IF EXISTS \"$DB\";" \
  -c "CREATE DATABASE \"$DB\" OWNER \"$USER\";"

gunzip -c "$DUMP" | docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_restore -U "$USER" -d "$DB" --no-owner

echo "restored $DUMP into database \"$DB\" (docker context: $CONTEXT)"
