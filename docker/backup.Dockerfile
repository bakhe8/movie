# P0-5: the image a Railway Cron service runs backup-postgres-to-r2.sh (and,
# on its own separate schedule, restore-drill-from-r2.sh) from. The client
# version must be >= the server's: Railway's production Postgres reports
# 18.6 (verified 2026-09-05 by a failed first run against a pg16 client:
# "server version: 18.6; pg_dump version: 16.14"), so this image carries the
# PG 18 client, which also dumps the pinned PG 15 dev/CI server (ADR-98).
# aws-cli talks to R2 over its S3-compatible API (`--endpoint-url`, no AWS
# account involved).
FROM postgres:18-alpine

# The postgres image's entrypoint initialises/starts a server; this image is
# only a client toolbox for a Cron command, so it must not wrap it.
ENTRYPOINT []

RUN apk add --no-cache openssl aws-cli bash

COPY docker/backup-postgres-to-r2.sh /usr/local/bin/backup-postgres-to-r2.sh
COPY docker/restore-drill-from-r2.sh /usr/local/bin/restore-drill-from-r2.sh
RUN chmod +x /usr/local/bin/backup-postgres-to-r2.sh /usr/local/bin/restore-drill-from-r2.sh

# Railway Cron sets the command per service (one service for the daily
# backup, a second for the weekly restore drill, both pointed at this same
# image) -- no default CMD, so a service misconfigured with neither would
# fail loudly on start rather than silently doing nothing.
