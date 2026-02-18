#!/usr/bin/env bash
set -euo pipefail

# Verifies the hosting provider serves the freshly deployed schedule.json.
# Retries because the site can be behind a CDN and may briefly serve stale content.
#
# Environment variables:
# - DEPLOYMENT_PAGE_URL (optional): from actions/deploy-pages output `page_url`
# - REPO_OWNER (required if DEPLOYMENT_PAGE_URL is empty)
# - REPO_NAME  (required if DEPLOYMENT_PAGE_URL is empty)
# - TARGET_JSON_URL (optional): full URL to schedule.json (overrides PAGE_URL logic)
# - EXPECTED_JSON_PATH (optional): defaults to scraped-data/schedule.json

EXPECTED_JSON_PATH="${EXPECTED_JSON_PATH:-scraped-data/schedule.json}"

# Tuning knobs (CDN propagation / caching).
MAX_ATTEMPTS="${MAX_ATTEMPTS:-180}"     # 180 * 5s = 15 minutes
SLEEP_SECONDS="${SLEEP_SECONDS:-5}"

EXPECTED_SCRAPED_AT="$(node scripts/extract-update-from-file.js "$EXPECTED_JSON_PATH" scraped_at)"
EXPECTED_UPDATE="$(node scripts/extract-update-from-file.js "$EXPECTED_JSON_PATH" update)"

EXPECTED_KIND="scraped_at"
EXPECTED_VALUE="$EXPECTED_SCRAPED_AT"
if [[ -z "$EXPECTED_VALUE" ]]; then
  EXPECTED_KIND="update"
  EXPECTED_VALUE="$EXPECTED_UPDATE"
fi

if [[ -z "$EXPECTED_VALUE" ]]; then
  echo "ERROR: expected stamp is empty ($EXPECTED_JSON_PATH)." >&2
  exit 1
fi

TARGET_JSON_URL="${TARGET_JSON_URL:-}"
if [[ -z "$TARGET_JSON_URL" ]]; then
  PAGE_URL="${DEPLOYMENT_PAGE_URL:-}"
  if [[ -z "$PAGE_URL" ]]; then
    : "${REPO_OWNER:?REPO_OWNER is required when DEPLOYMENT_PAGE_URL is empty}"
    : "${REPO_NAME:?REPO_NAME is required when DEPLOYMENT_PAGE_URL is empty}"
    PAGE_URL="https://${REPO_OWNER}.github.io/${REPO_NAME}/"
  fi

  # Ensure trailing slash.
  [[ "$PAGE_URL" != */ ]] && PAGE_URL="$PAGE_URL/"
  TARGET_JSON_URL="${PAGE_URL}schedule.json"
fi

echo "Expected update stamp: $EXPECTED_UPDATE"
echo "Expected scraped_at stamp: ${EXPECTED_SCRAPED_AT:-<empty>}"
echo "Verifying by: $EXPECTED_KIND"
echo "Checking: $TARGET_JSON_URL"

LAST_SEEN=""
LAST_SEEN_KIND="$EXPECTED_KIND"

parse_update_to_num() {
  node - "$1" <<'NODE'
const s = process.argv[2] || '';
const m = s.match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/);
if (!m) process.exit(0);
const day = Number(m[1]);
const month = Number(m[2]);
const year = Number(m[3]);
const hour = Number(m[4]);
const minute = Number(m[5]);
if (![day, month, year, hour, minute].every(Number.isFinite)) process.exit(0);
const n = (((year * 100 + month) * 100 + day) * 100 + hour) * 100 + minute;
process.stdout.write(String(n));
NODE
}

EXPECTED_UPDATE_NUM="$(parse_update_to_num "$EXPECTED_UPDATE")"
EXPECTED_VALUE_NUM=""
if [[ "$EXPECTED_KIND" == "update" ]]; then
  EXPECTED_VALUE_NUM="$EXPECTED_UPDATE_NUM"
fi

for i in $(seq 1 "$MAX_ATTEMPTS"); do
  CB="_cb=${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-0}-${i}"
  SEEN=""
  SEEN_UPDATE=""
  SEEN_SCRAPED_AT=""

  if command -v curl >/dev/null 2>&1; then
    SEEN="$(
      curl -fsSL \
        -H 'Cache-Control: no-cache, no-store, max-age=0' \
        -H 'Pragma: no-cache' \
        "${TARGET_JSON_URL}?${CB}" \
        | node scripts/extract-update-from-stdin.js "$EXPECTED_KIND"
    )" || true

    # Also grab both stamps for debug messages (best-effort).
    SEEN_UPDATE="$(
      curl -fsSL \
        -H 'Cache-Control: no-cache, no-store, max-age=0' \
        -H 'Pragma: no-cache' \
        "${TARGET_JSON_URL}?${CB}" \
        | node scripts/extract-update-from-stdin.js update
    )" || true
    SEEN_SCRAPED_AT="$(
      curl -fsSL \
        -H 'Cache-Control: no-cache, no-store, max-age=0' \
        -H 'Pragma: no-cache' \
        "${TARGET_JSON_URL}?${CB}" \
        | node scripts/extract-update-from-stdin.js scraped_at
    )" || true
  fi

  if [[ -n "$SEEN" ]]; then
    LAST_SEEN="$SEEN"
    LAST_SEEN_KIND="$EXPECTED_KIND"
  fi

  if [[ "$SEEN" == "$EXPECTED_VALUE" ]]; then
    echo "OK: Hosting now serves the expected schedule.json ($EXPECTED_KIND) (attempt $i)."
    exit 0
  fi

  # If we were verifying by update stamp, a strictly newer update means Pages is updated
  # (likely due to another deployment). Treat as success to avoid false negatives.
  if [[ "$EXPECTED_KIND" == "update" && -n "$EXPECTED_UPDATE_NUM" && -n "$SEEN" ]]; then
    SEEN_NUM="$(parse_update_to_num "$SEEN")"
    if [[ -n "$SEEN_NUM" && "$SEEN_NUM" -gt "$EXPECTED_UPDATE_NUM" ]]; then
      echo "OK: Hosting serves a newer update stamp than expected (attempt $i)."
      echo "Expected update: $EXPECTED_UPDATE"
      echo "Seen update: $SEEN"
      exit 0
    fi
  fi

  if [[ -n "$SEEN_UPDATE" || -n "$SEEN_SCRAPED_AT" ]]; then
    echo "Not updated yet (attempt $i): seen_update='${SEEN_UPDATE:-<empty>}' seen_scraped_at='${SEEN_SCRAPED_AT:-<empty>}'"
  else
    echo "Not updated yet (attempt $i): seen='${SEEN:-<empty>}'"
  fi
  sleep "$SLEEP_SECONDS"
done

echo "ERROR: Hosting did not serve the expected update stamp in time." >&2
echo "Expected ($EXPECTED_KIND): $EXPECTED_VALUE" >&2
echo "Expected update: ${EXPECTED_UPDATE:-<empty>}" >&2
echo "Expected scraped_at: ${EXPECTED_SCRAPED_AT:-<empty>}" >&2
echo "Last seen ($LAST_SEEN_KIND): ${LAST_SEEN:-<empty>}" >&2
exit 1
