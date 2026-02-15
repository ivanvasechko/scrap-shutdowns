#!/usr/bin/env node

'use strict';

// Prints a small, non-sensitive summary from scraped output.
// Keeps GitHub Actions logs readable and consistent.

const fs = require('fs');
const path = require('path');

const repoRoot = process.cwd();
const metaPath = path.join(repoRoot, 'scraped-data', 'latest-metadata.json');
const schedPath = path.join(repoRoot, 'scraped-data', 'schedule.json');

const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
const schedule = JSON.parse(fs.readFileSync(schedPath, 'utf8'));

const todayKey = schedule && schedule.today ? String(schedule.today) : '';
const groups =
  schedule && schedule.data && todayKey && schedule.data[todayKey]
    ? Object.keys(schedule.data[todayKey])
    : [];

console.log('Scrape OK:', Boolean(meta.success));
console.log('Schedule update stamp:', schedule.update || '');
console.log('Scraped at:', schedule.scraped_at || '');
console.log('Today key:', todayKey);
console.log('Group count (today):', groups.length);
