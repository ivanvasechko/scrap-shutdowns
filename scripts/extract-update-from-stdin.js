#!/usr/bin/env node

'use strict';

// Reads JSON from stdin and prints the `update` field (or empty string).
// Intended for CI usage like: curl ... | node scripts/extract-update-from-stdin.js

let input = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});

process.stdin.on('end', () => {
  try {
    const json = JSON.parse(input);
    process.stdout.write(String(json?.update ?? ''));
  } catch {
    process.stdout.write('');
  }
});

// If there is no stdin (or it closes immediately), still print empty string.
process.stdin.resume();
