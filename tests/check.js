#!/usr/bin/env node
/*
 * Reusable regression/smoke suite for ai-news-digest.
 *
 * Usage:
 *   cd tests
 *   npm install                (once)
 *   npx playwright install chromium   (once)
 *   npm run check                     (static checks + live pipeline run)
 *   npm run check -- --static-only    (skip the live pipeline run — no network, no RSS fetches)
 *
 * Two kinds of checks, run in this order:
 *
 *   STATIC (no network, fast, deterministic): the workflow YAML hasn't been
 *   silently truncated again, sources.json/glossary.json are structurally
 *   sane, both scripts still parse, and — the big one — a synthetic render
 *   test that catches the exact class of bug found on 2026-09-26: a reader
 *   in a different timezone than the build server seeing the wrong date or
 *   time. This doesn't depend on the real daily cron having run; it builds
 *   a fake digest with a UTC timestamp deliberately chosen to fall in the
 *   "server's day disagrees with the reader's day" danger window, renders
 *   it, and checks the result in three simulated visitor timezones.
 *
 *   LIVE (network, slower, depends on the real world): actually runs
 *   fetch-digest.js against the real RSS feeds and sanity-checks the real
 *   output — enough stories, no empty summaries, no duplicate links, valid
 *   HTML. Skippable with --static-only when you just want a fast check
 *   after editing code, not a full pipeline run.
 *
 * What this does NOT catch: whether a summary is actually a *good* summary
 * (that's an eval question, only relevant once AI mode is turned on),
 * whether a specific source's dedup choice was the "right" one, or GitHub's
 * own scheduled-workflow queue delay (that's checked by hand against the
 * Actions tab — see the commit history around 2026-09-25 for how).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const STATIC_ONLY = process.argv.includes('--static-only');

const results = [];
function log(area, check, ok, detail) {
  results.push({ area, check, status: ok ? 'PASS' : 'FAIL', detail: detail || '' });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${area} :: ${check}${detail ? ' -- ' + detail : ''}`);
}
function info(area, msg) {
  console.log(`[INFO] ${area} :: ${msg}`);
}

/* ========================================================================
   STATIC: workflow YAML hasn't been silently truncated
   ======================================================================== */
function checkWorkflowFile() {
  const area = 'Workflow YAML';
  const p = path.join(ROOT, '.github', 'workflows', 'daily-digest.yml');
  const text = fs.readFileSync(p, 'utf8');

  let yamlOk = true, yamlErr = '';
  try {
    require('js-yaml').loadAll(text);
  } catch (e) {
    yamlOk = false; yamlErr = e.message;
  }
  log(area, 'Parses as valid YAML', yamlOk, yamlErr);

  // The exact incident from 2026-09-25: a web-UI paste truncated two shell
  // string literals mid-word, which didn't fail the YAML parse or even
  // fail the Action (bash silently merged subsequent lines into the
  // unterminated string, and git config accepted the garbled result) — so
  // check for the actual complete strings, not just "is this valid YAML."
  const mustContain = [
    'github-actions[bot]@users.noreply.github.com',
    'git commit -m "Update digest"',
    'git push origin HEAD:main',
  ];
  mustContain.forEach((needle) => {
    log(area, `Contains complete, untruncated string: "${needle}"`, text.includes(needle));
  });

  const cronMatch = text.match(/cron:\s*'([^']+)'/);
  const cronFields = cronMatch ? cronMatch[1].trim().split(/\s+/) : [];
  log(area, 'Cron expression has exactly 5 fields', cronFields.length === 5, cronMatch ? cronMatch[1] : '(not found)');

  log(area, 'permissions.contents is "write" (required for the commit-back step)', /contents:\s*write/.test(text));
}

/* ========================================================================
   STATIC: sources.json / glossary.json structural sanity
   ======================================================================== */
function checkSources() {
  const area = 'sources.json';
  const sources = JSON.parse(fs.readFileSync(path.join(ROOT, 'sources.json'), 'utf8'));
  log(area, 'Is a non-empty array', Array.isArray(sources) && sources.length > 0, `count=${sources.length}`);

  const names = new Set();
  let allValid = true;
  sources.forEach((s) => {
    if (!s.name || !s.feedUrl || !['rss', 'atom'].includes(s.format)) allValid = false;
    if (names.has(s.name)) allValid = false;
    names.add(s.name);
  });
  log(area, 'Every entry has name/feedUrl/format(rss|atom), no duplicate names', allValid);
}

function checkGlossary() {
  const area = 'glossary.json';
  const glossary = JSON.parse(fs.readFileSync(path.join(ROOT, 'glossary.json'), 'utf8'));
  log(area, 'Is a non-empty array', Array.isArray(glossary) && glossary.length > 0, `count=${glossary.length}`);
  const allValid = glossary.every((g) => g.term && g.definition && g.wikiTitle);
  log(area, 'Every entry has term/definition/wikiTitle', allValid);

  const historyPath = path.join(ROOT, 'glossary-history.json');
  let historyOk = true, historyDetail = '';
  try {
    const h = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    historyOk = Array.isArray(h.shownTerms);
    historyDetail = `shownTerms.length=${h.shownTerms ? h.shownTerms.length : 'n/a'}`;
  } catch (e) {
    historyOk = false; historyDetail = e.message;
  }
  log('glossary-history.json', 'Is valid JSON with a shownTerms array', historyOk, historyDetail);
}

/* ========================================================================
   STATIC: both scripts still parse
   ======================================================================== */
function checkSyntax() {
  ['fetch-digest.js', 'render.js'].forEach((f) => {
    let ok = true, err = '';
    try {
      execFileSync(process.execPath, ['-c', path.join(ROOT, f)], { stdio: 'pipe' });
    } catch (e) {
      ok = false; err = e.message;
    }
    log('Syntax', `${f} parses without error`, ok, err);
  });
}

/* ========================================================================
   STATIC: the actual regression test for the 2026-09-26 timezone bug.
   Builds a synthetic digest with a UTC timestamp in the "server's day !=
   reader's day" danger window, renders it, and checks three simulated
   visitor timezones each see their OWN correct local date/time — not a
   date/time hardcoded to the build server or to India specifically.
   ======================================================================== */
async function checkTimezoneRendering() {
  const area = 'Timezone rendering';
  const { renderDigest } = require(path.join(ROOT, 'render.js'));

  // 23:56 UTC is deliberately in the "UTC still says today, IST already
  // says tomorrow" danger window — this is the exact kind of instant that
  // silently produced the wrong date before the 2026-09-26 fix.
  const DANGER_TS = '2026-01-15T23:56:00.000Z';

  const digest = {
    dateLabel: new Date(DANGER_TS).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Kolkata' }),
    generatedAt: DANGER_TS,
    sourceCount: 1,
    allSourceNames: ['Test Source'],
    mode: 'excerpt',
    glossary: [],
    items: [{
      title: 'Test story for timezone regression check',
      link: 'https://example.com/test-story',
      source: 'Test Source',
      publishedAt: new Date(DANGER_TS),
      summary: 'This is a synthetic story used only to verify timezone rendering.',
    }],
  };

  const html = renderDigest(digest);
  log(area, 'renderDigest() runs without throwing on a danger-window timestamp', typeof html === 'string' && html.length > 0);
  log(area, 'Output HTML embeds the raw ISO timestamp as data-ts (not just server-formatted text)', html.includes(`data-ts="${DANGER_TS}"`));

  if (STATIC_ONLY) {
    info(area, 'Skipping the multi-timezone browser check (needs playwright) — pass without --static-only to run it.');
    return;
  }

  const tmpHtmlPath = path.join(__dirname, '.tz-check-tmp.html');
  fs.writeFileSync(tmpHtmlPath, html);

  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (e) {
    log(area, 'playwright is installed (run npm install + npx playwright install chromium)', false, e.message);
    fs.unlinkSync(tmpHtmlPath);
    return;
  }

  const { pathToFileURL } = require('url');
  const url = pathToFileURL(tmpHtmlPath).href;
  const browser = await chromium.launch();

  const TIMEZONES = ['Asia/Kolkata', 'America/Los_Angeles', 'Asia/Tokyo'];
  for (const tz of TIMEZONES) {
    const ctx = await browser.newContext({ timezoneId: tz });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(150);

    const shownDate = await page.locator('.masthead-date').textContent();
    const shownTime = await page.locator('.time').first().textContent();

    const expectedDate = new Date(DANGER_TS).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: tz });
    const expectedTime = new Date(DANGER_TS).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });

    log(area, `[${tz}] shows that visitor's own correct local date`, shownDate === expectedDate, `got "${shownDate}", expected "${expectedDate}"`);
    log(area, `[${tz}] shows that visitor's own correct local time`, shownTime === expectedTime, `got "${shownTime}", expected "${expectedTime}"`);

    await ctx.close();
  }

  await browser.close();
  fs.unlinkSync(tmpHtmlPath);
}

/* ========================================================================
   LIVE: run the real pipeline against real RSS feeds and sanity-check it
   ======================================================================== */
async function checkLivePipeline() {
  const area = 'Live pipeline';

  const gitDirty = execFileSync('git', ['status', '--porcelain', 'digest.json', 'digest.html', 'glossary-history.json'], { cwd: ROOT }).toString().trim();
  if (gitDirty) {
    info(area, 'digest.json/digest.html/glossary-history.json already have uncommitted changes — skipping the live run so this test doesn\'t clobber real work. Commit or stash first, then re-run.');
    return;
  }

  let stderr = '';
  try {
    execFileSync(process.execPath, ['fetch-digest.js', '--no-ai'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    log(area, 'fetch-digest.js --no-ai runs to completion', false, (e.stderr || e.message || '').toString().slice(0, 300));
    execFileSync('git', ['checkout', '--', 'digest.json', 'digest.html', 'glossary-history.json'], { cwd: ROOT });
    return;
  }
  log(area, 'fetch-digest.js --no-ai runs to completion', true);

  const digest = JSON.parse(fs.readFileSync(path.join(ROOT, 'digest.json'), 'utf8'));
  log(area, 'Produced at least 8 stories', digest.items.length >= 8, `got ${digest.items.length}`);

  const allFieldsPresent = digest.items.every((it) => it.title && it.link && it.source && it.publishedAt && it.summary);
  log(area, 'Every story has title/link/source/publishedAt/summary', allFieldsPresent);

  const links = digest.items.map((it) => it.link);
  log(area, 'No duplicate story links', new Set(links).size === links.length);

  const allDatesValid = digest.items.every((it) => !isNaN(new Date(it.publishedAt).getTime()));
  log(area, 'Every story has a valid publishedAt date', allDatesValid);

  const html = fs.readFileSync(path.join(ROOT, 'digest.html'), 'utf8');
  const cardCount = (html.match(/<li class="card/g) || []).length;
  log(area, 'digest.html card count matches stories + glossary picks', cardCount === digest.items.length + digest.glossary.length, `cards=${cardCount}, expected=${digest.items.length + digest.glossary.length}`);

  // Sources that failed to fetch this run aren't a hard failure (transient
  // upstream blocking/rate-limiting is normal and already handled
  // gracefully by the pipeline) but are worth surfacing, since a source
  // that's *permanently* broken would otherwise go unnoticed indefinitely.
  const usedSources = new Set(digest.items.map((it) => it.source));
  const allSources = digest.allSourceNames || [];
  const missing = allSources.filter((s) => !usedSources.has(s));
  if (missing.length) {
    info(area, `Sources with zero stories in this run (may just be quiet or rate-limited today, or may be worth checking if this persists): ${missing.join(', ')}`);
  }

  // Restore the real committed files — this test run's output was only for
  // verification, not something that should overwrite the live digest.
  execFileSync('git', ['checkout', '--', 'digest.json', 'digest.html', 'glossary-history.json'], { cwd: ROOT });
  info(area, 'Restored digest.json/digest.html/glossary-history.json to their committed state (this test run\'s output was for verification only).');
}

(async () => {
  console.log(`Running checks against: ${ROOT}${STATIC_ONLY ? ' (static-only, no network)' : ''}\n`);

  checkWorkflowFile();
  checkSources();
  checkGlossary();
  checkSyntax();
  await checkTimezoneRendering();

  if (!STATIC_ONLY) {
    await checkLivePipeline();
  } else {
    info('Live pipeline', 'Skipped (--static-only).');
  }

  const fails = results.filter((r) => r.status === 'FAIL');
  console.log('\n=== SUMMARY ===');
  console.log(`${results.length - fails.length}/${results.length} checks passed`);
  if (fails.length) {
    console.log('FAILURES:');
    fails.forEach((f) => console.log(` - [${f.area}] ${f.check} :: ${f.detail}`));
  }
  fs.writeFileSync(path.join(__dirname, 'last-run.json'), JSON.stringify(results, null, 2));
  process.exit(fails.length ? 1 : 0);
})();
