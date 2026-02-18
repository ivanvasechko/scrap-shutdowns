#!/usr/bin/env node

'use strict';

// Reads JSON from stdin and prints a specified field (or empty string).
// Intended for CI usage like:
//   curl ... | node scripts/extract-update-from-stdin.js
//   curl ... | node scripts/extract-update-from-stdin.js scraped_at

const fieldName = process.argv[2] || 'update';

let input = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});

process.stdin.on('end', () => {
  try {
    const json = JSON.parse(input);
    process.stdout.write(String(json?.[fieldName] ?? ''));
  } catch {
    process.stdout.write('');
  }
});

// If there is no stdin (or it closes immediately), still print empty string.
process.stdin.resume();
