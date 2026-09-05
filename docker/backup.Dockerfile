# P0-5: the image a Railway Cron service runs backup-postgres-to-r2.sh (and,
# on its own separate schedule, restore-drill-from-r2.sh) from. Alpine's
# postgresql16-client matches the pgvector/pgvector:...-pg15 server closely
# enough for pg_dump/pg_restore's custom format (ADR-98); aws-cli talks to
# R2 over its S3-compatible API (`--endpoint-url`, no AWS account involved).
FROM alpine:3.20

RUN apk add --no-cache postgresql16-client openssl aws-cli bash

COPY docker/backup-postgres-to-r2.sh /usr/local/bin/backup-postgres-to-r2.sh
COPY docker/restore-drill-from-r2.sh /usr/local/bin/restore-drill-from-r2.sh
RUN chmod +x /usr/local/bin/backup-postgres-to-r2.sh /usr/local/bin/restore-drill-from-r2.sh

# Railway Cron sets the command per service (one service for the daily
# backup, a second for the weekly restore drill, both pointed at this same
# image) -- no default CMD, so a service misconfigured with neither would
# fail loudly on start rather than silently doing nothing.
