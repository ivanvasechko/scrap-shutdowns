#!/usr/bin/env node

'use strict';

// Prints the `update` field from a JSON file (or empty string).
// Intended for CI usage like: node scripts/extract-update-from-file.js scraped-data/schedule.json

const fs = require('fs');

const filePath = process.argv[2];
if (!filePath) {
  process.stderr.write('Usage: extract-update-from-file.js <path-to-json>\n');
  process.exit(2);
}

try {
  const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  process.stdout.write(String(json?.update ?? ''));
} catch {
  process.stdout.write('');
}
