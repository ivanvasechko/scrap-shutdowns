#!/usr/bin/env node

'use strict';

// Prints a JSON field from a JSON file (or empty string).
// Intended for CI usage like:
//   node scripts/extract-update-from-file.js scraped-data/schedule.json
//   node scripts/extract-update-from-file.js scraped-data/schedule.json scraped_at

const fs = require('fs');

const filePath = process.argv[2];
const fieldName = process.argv[3] || 'update';
if (!filePath) {
  process.stderr.write('Usage: extract-update-from-file.js <path-to-json>\n');
  process.exit(2);
}

try {
  const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  process.stdout.write(String(json?.[fieldName] ?? ''));
} catch {
  process.stdout.write('');
}
