#!/usr/bin/env bash
set -euo pipefail

# Reads the currently deployed schedule.json stamp from the hosting provider.
# Writes it to GITHUB_OUTPUT as `update=<stamp>`.
#
# Environment variables:
# - GITHUB_OUTPUT (required)
# - JSON_URL (optional): full URL to schedule.json (recommended)
# - REPO_OWNER (required if JSON_URL is empty)
# - REPO_NAME (required if JSON_URL is empty)
# - PAGES_URL (optional override; legacy alias for JSON_URL)

: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"
JSON_URL="${JSON_URL:-${PAGES_URL:-}}"
if [[ -z "$JSON_URL" ]]; then
  : "${REPO_OWNER:?REPO_OWNER is required when JSON_URL is empty}"
  : "${REPO_NAME:?REPO_NAME is required when JSON_URL is empty}"
  JSON_URL="https://${REPO_OWNER}.github.io/${REPO_NAME}/schedule.json"
fi

CB="_cb=${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-0}-$(date +%s)"
FETCH_URL="$JSON_URL"
if [[ "$FETCH_URL" == *\?* ]]; then
  FETCH_URL="$FETCH_URL&$CB"
else
  FETCH_URL="$FETCH_URL?$CB"
fi

# Do not echo PAGES_URL to keep logs minimal.
DEPLOYED_UPDATE=""
DEPLOYED_SCRAPED_AT=""
if command -v curl >/dev/null 2>&1; then
  DEPLOYED_UPDATE="$(
    curl -fsSL \
      -H 'Cache-Control: no-cache, no-store, max-age=0' \
      -H 'Pragma: no-cache' \
      "$FETCH_URL" \
    | node scripts/extract-update-from-stdin.js update
  )" || true
  DEPLOYED_SCRAPED_AT="$(
    curl -fsSL \
      -H 'Cache-Control: no-cache, no-store, max-age=0' \
      -H 'Pragma: no-cache' \
      "$FETCH_URL" \
    | node scripts/extract-update-from-stdin.js scraped_at
  )" || true
fi

echo "update=$DEPLOYED_UPDATE" >> "$GITHUB_OUTPUT"
echo "scraped_at=$DEPLOYED_SCRAPED_AT" >> "$GITHUB_OUTPUT"
