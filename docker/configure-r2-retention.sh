#!/bin/sh
# P0-5, one-time setup (not run by any Cron job): applies
# r2-lifecycle-policy.json to the backups bucket, so R2 itself expires
# objects under postgres/ after 30 days -- retention lives in the bucket's
# own config, not in a script that has to remember to run and could forget.
# Run by hand, once, whenever the real R2 credentials are available (they
# are never in this repository); safe to re-run -- it replaces the whole
# lifecycle configuration with this file's contents.
#
#   R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET=... \
#   R2_S3_ENDPOINT=... docker/configure-r2-retention.sh
set -eu

for var in R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET R2_S3_ENDPOINT; do
  eval "value=\${$var:-}"
  [ -n "$value" ] || { echo "FAILED: $var is not set" >&2; exit 1; }
done

export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION=auto

SCRIPT_DIR=$(dirname "$0")
aws s3api put-bucket-lifecycle-configuration \
  --bucket "$R2_BUCKET" \
  --lifecycle-configuration "file://$SCRIPT_DIR/r2-lifecycle-policy.json" \
  --endpoint-url "$R2_S3_ENDPOINT"

echo "lifecycle policy applied to s3://$R2_BUCKET (postgres/ objects expire after 30 days)"
