#!/bin/sh
# Turns every `<NAME>_FILE=/run/secrets/<name>` env var into `<NAME>=$(cat that file)`,
# then execs the real command -- the same convention the official postgres/mysql
# images use for their own secrets, applied here to the app containers too, so
# secrets are files under Compose's `secrets:` (never baked into the image,
# never sourced from a single `.env` blob) while the app code keeps reading a
# plain `process.env`/`os.environ` variable (board C-5, ALPHA_PLAN 7.3).
set -e
for var in $(env | grep '_FILE=' | cut -d= -f1); do
  name="${var%_FILE}"
  value_file=$(eval echo "\$$var")
  if [ -f "$value_file" ]; then
    export "$name"="$(cat "$value_file")"
  fi
done
exec dumb-init -- "$@"
