#!/usr/bin/env bash
set -euo pipefail

# Verifies GitHub Pages serves the freshly deployed schedule.json.
# Retries because Pages is behind a CDN and may briefly serve stale content.
#
# Environment variables:
# - DEPLOYMENT_PAGE_URL (optional): from actions/deploy-pages output `page_url`
# - REPO_OWNER (required if DEPLOYMENT_PAGE_URL is empty)
# - REPO_NAME  (required if DEPLOYMENT_PAGE_URL is empty)
# - EXPECTED_JSON_PATH (optional): defaults to scraped-data/schedule.json

EXPECTED_JSON_PATH="${EXPECTED_JSON_PATH:-scraped-data/schedule.json}"

EXPECTED_UPDATE="$(node scripts/extract-update-from-file.js "$EXPECTED_JSON_PATH")"
if [[ -z "$EXPECTED_UPDATE" ]]; then
  echo "ERROR: expected update stamp is empty ($EXPECTED_JSON_PATH)." >&2
  exit 1
fi

PAGE_URL="${DEPLOYMENT_PAGE_URL:-}"
if [[ -z "$PAGE_URL" ]]; then
  : "${REPO_OWNER:?REPO_OWNER is required when DEPLOYMENT_PAGE_URL is empty}"
  : "${REPO_NAME:?REPO_NAME is required when DEPLOYMENT_PAGE_URL is empty}"
  PAGE_URL="https://${REPO_OWNER}.github.io/${REPO_NAME}/"
fi

# Ensure trailing slash.
[[ "$PAGE_URL" != */ ]] && PAGE_URL="$PAGE_URL/"
TARGET_JSON_URL="${PAGE_URL}schedule.json"

echo "Expected update stamp: $EXPECTED_UPDATE"
echo "Checking: $TARGET_JSON_URL"

LAST_SEEN=""
for i in $(seq 1 60); do
  CB="_cb=${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-0}-${i}"
  SEEN=""

  if command -v curl >/dev/null 2>&1; then
    SEEN="$(
      curl -fsSL \
        -H 'Cache-Control: no-cache' \
        -H 'Pragma: no-cache' \
        "${TARGET_JSON_URL}?${CB}" \
        | node scripts/extract-update-from-stdin.js
    )" || true
  fi

  if [[ -n "$SEEN" ]]; then
    LAST_SEEN="$SEEN"
  fi

  if [[ "$SEEN" == "$EXPECTED_UPDATE" ]]; then
    echo "OK: GitHub Pages now serves the new schedule.json (attempt $i)."
    exit 0
  fi

  echo "Not updated yet (attempt $i): seen='${SEEN:-<empty>}'"
  sleep 5
done

echo "ERROR: GitHub Pages did not serve the expected update stamp in time." >&2
echo "Expected: $EXPECTED_UPDATE" >&2
echo "Last seen: ${LAST_SEEN:-<empty>}" >&2
exit 1
