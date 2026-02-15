#!/usr/bin/env bash
set -euo pipefail

# Reads the currently deployed schedule.json update stamp from GitHub Pages.
# Writes it to GITHUB_OUTPUT as `update=<stamp>`.
#
# Environment variables:
# - GITHUB_OUTPUT (required)
# - REPO_OWNER (required)
# - REPO_NAME (required)
# - PAGES_URL (optional override)

: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"
: "${REPO_OWNER:?REPO_OWNER is required}"
: "${REPO_NAME:?REPO_NAME is required}"

PAGES_URL="${PAGES_URL:-https://${REPO_OWNER}.github.io/${REPO_NAME}/schedule.json}"

# Do not echo PAGES_URL to keep logs minimal.
DEPLOYED_UPDATE=""
if command -v curl >/dev/null 2>&1; then
  DEPLOYED_UPDATE="$(curl -fsSL "$PAGES_URL" | node scripts/extract-update-from-stdin.js)" || true
fi

echo "update=$DEPLOYED_UPDATE" >> "$GITHUB_OUTPUT"
