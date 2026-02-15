#!/usr/bin/env bash
set -euo pipefail

# Resolves the latest Playwright version from npm and writes it to GITHUB_OUTPUT.
# Output name: version

: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"

PW_VERSION="$(npm view playwright version)"

echo "version=$PW_VERSION" >> "$GITHUB_OUTPUT"
