#!/usr/bin/env node
/*
 * After-publish check (added 2026-10-22): opens the public page and confirms
 * it shows the edition this run just built, with the right number of cards.
 * A build can succeed while GitHub Pages keeps serving yesterday's page, so
 * this is the only check that looks at what readers actually get.
 *
 * Usage: node tests/verify-live.js [url]   (run after the deploy finishes)
 * GitHub Pages can take a few minutes to refresh, so it retries for ~10 min.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const URL_LIVE = process.argv[2] || 'https://bobthebuilder656.github.io/ai-digest-news/';
const digest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'digest.json'), 'utf8'));
const expectedCards = digest.items.length + digest.glossary.length;

const ATTEMPTS = 10;
const WAIT_MS = 60 * 1000;

async function check() {
  const res = await fetch(`${URL_LIVE}?nocache=${Date.now()}`, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) return `the page answered HTTP ${res.status}`;
  const html = await res.text();
  if (!html.includes(`data-ts="${digest.generatedAt}"`)) return 'the page still shows an older edition';
  const cards = (html.match(/<li class="card/g) || []).length;
  if (cards !== expectedCards) return `the page has ${cards} cards, expected ${expectedCards}`;
  return null;
}

(async () => {
  let problem = 'not checked';
  for (let i = 1; i <= ATTEMPTS; i++) {
    try {
      problem = await check();
    } catch (e) {
      problem = e.message;
    }
    if (!problem) {
      console.log(`[PASS] Live page :: ${URL_LIVE} shows today's edition (${digest.dateLabel}, ${expectedCards} cards)`);
      process.exit(0);
    }
    console.log(`[wait] attempt ${i}/${ATTEMPTS}: ${problem}`);
    if (i < ATTEMPTS) await new Promise((r) => setTimeout(r, WAIT_MS));
  }
  console.log(`[FAIL] Live page :: after ${ATTEMPTS} attempts, ${problem}`);
  process.exit(1);
})();
