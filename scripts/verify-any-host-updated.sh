#!/usr/bin/env bash
set -euo pipefail

# Verifies that at least one hosting target serves the freshly deployed schedule.json.
# Uses scripts/verify-pages-updated.sh under the hood.
#
# Environment variables:
# - EXPECTED_JSON_PATH (optional): defaults to scraped-data/schedule.json
# - TARGET_JSON_URLS (required): whitespace-separated list of full schedule.json URLs
# - MAX_ATTEMPTS (optional): passed through (default in verify-pages-updated.sh is 3)
# - SLEEP_SECONDS (optional): passed through
# - REPORT_PATH (optional): write a JSON report to this path

: "${TARGET_JSON_URLS:?TARGET_JSON_URLS is required (space-separated URLs to schedule.json)}"

EXPECTED_JSON_PATH="${EXPECTED_JSON_PATH:-scraped-data/schedule.json}"

EXPECTED_UPDATE="$(node scripts/extract-update-from-file.js "$EXPECTED_JSON_PATH" update)"
EXPECTED_SCRAPED_AT="$(node scripts/extract-update-from-file.js "$EXPECTED_JSON_PATH" scraped_at)"

ok=0
failed=0

OK_URLS=""
FAILED_URLS=""

for url in $TARGET_JSON_URLS; do
  echo "---"
  echo "Verifying target: $url"
  if EXPECTED_JSON_PATH="$EXPECTED_JSON_PATH" TARGET_JSON_URL="$url" \
    bash scripts/verify-pages-updated.sh; then
    ok=$((ok + 1))
    OK_URLS+="$url\n"
  else
    failed=$((failed + 1))
    FAILED_URLS+="$url\n"
  fi

done

write_report() {
  local result="$1" # ok|fail
  local report_path="${REPORT_PATH:-}"
  [[ -z "$report_path" ]] && return 0

  OK_URLS_CSV="$(printf '%b' "$OK_URLS" | sed '/^$/d' | paste -sd',' -)"
  FAILED_URLS_CSV="$(printf '%b' "$FAILED_URLS" | sed '/^$/d' | paste -sd',' -)"
  PREFERRED_URL="$(printf '%b' "$OK_URLS" | sed '/^$/d' | head -n 1)"

  node - <<'NODE'
const fs = require('fs');

const reportPath = process.env.REPORT_PATH;
if (!reportPath) process.exit(0);

const splitCsv = (s) => {
  if (!s) return [];
  return s.split(',').map((x) => x.trim()).filter(Boolean);
};

const payload = {
  result: process.env.RESULT || 'fail',
  expected: {
    update: process.env.EXPECTED_UPDATE || '',
    scraped_at: process.env.EXPECTED_SCRAPED_AT || ''
  },
  ok_urls: splitCsv(process.env.OK_URLS_CSV || ''),
  failed_urls: splitCsv(process.env.FAILED_URLS_CSV || ''),
  preferred_url: process.env.PREFERRED_URL || ''
};

fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2));
NODE
}

echo "---"
if [[ "$ok" -ge 1 ]]; then
  echo "OK: at least one hosting target updated (ok=$ok failed=$failed)."
  RESULT="ok" REPORT_PATH="${REPORT_PATH:-}" EXPECTED_UPDATE="$EXPECTED_UPDATE" EXPECTED_SCRAPED_AT="$EXPECTED_SCRAPED_AT" \
    OK_URLS_CSV="$(printf '%b' "$OK_URLS" | sed '/^$/d' | paste -sd',' -)" \
    FAILED_URLS_CSV="$(printf '%b' "$FAILED_URLS" | sed '/^$/d' | paste -sd',' -)" \
    PREFERRED_URL="$(printf '%b' "$OK_URLS" | sed '/^$/d' | head -n 1)" \
    write_report ok || true

  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    {
      echo "## Hosting verification"
      echo
      echo "- Expected update: ${EXPECTED_UPDATE:-<empty>}"
      echo "- Expected scraped_at: ${EXPECTED_SCRAPED_AT:-<empty>}"
      echo "- Result: ok=$ok failed=$failed"
      echo
      echo "### Updated"
      if [[ -n "$OK_URLS" ]]; then
        printf '%b' "$OK_URLS" | sed '/^$/d' | sed 's/^/- /'
      else
        echo "- <none>"
      fi
      echo
      echo "### Not updated"
      if [[ -n "$FAILED_URLS" ]]; then
        printf '%b' "$FAILED_URLS" | sed '/^$/d' | sed 's/^/- /'
      else
        echo "- <none>"
      fi
      echo
    } >> "$GITHUB_STEP_SUMMARY"
  fi

  exit 0
fi

echo "ERROR: none of the hosting targets served the expected stamp." >&2

RESULT="fail" REPORT_PATH="${REPORT_PATH:-}" EXPECTED_UPDATE="$EXPECTED_UPDATE" EXPECTED_SCRAPED_AT="$EXPECTED_SCRAPED_AT" \
  OK_URLS_CSV="" \
  FAILED_URLS_CSV="$(printf '%b' "$FAILED_URLS" | sed '/^$/d' | paste -sd',' -)" \
  PREFERRED_URL="" \
  write_report fail || true

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo "## Hosting verification"
    echo
    echo "- Expected update: ${EXPECTED_UPDATE:-<empty>}"
    echo "- Expected scraped_at: ${EXPECTED_SCRAPED_AT:-<empty>}"
    echo "- Result: ok=$ok failed=$failed"
    echo
    echo "### Updated"
    echo "- <none>"
    echo
    echo "### Not updated"
    if [[ -n "$FAILED_URLS" ]]; then
      printf '%b' "$FAILED_URLS" | sed '/^$/d' | sed 's/^/- /'
    else
      echo "- <none>"
    fi
    echo
  } >> "$GITHUB_STEP_SUMMARY"
fi

exit 1
