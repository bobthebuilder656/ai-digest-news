/*
 * Saved-example tests for the story pipeline (added 2026-10-22).
 *
 * The live checks in check.js run on whatever the news happens to be that
 * day, so a logic mistake can hide for weeks. These run the real functions
 * from fetch-digest.js and render.js on fixed, hand-made examples with known
 * right answers: unsafe links, broken dates, duplicate headlines, source
 * caps, the 48/72/96-hour fallback, summaries and glossary rotation.
 * No network. When a new kind of failure turns up, add an example here.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HOUR = 3600 * 1000;

function story(source, title, hoursAgo, link) {
  return {
    source,
    title,
    link: link || `https://example.com/${source}/${encodeURIComponent(title)}`,
    publishedAt: new Date(Date.now() - hoursAgo * HOUR),
    excerpt: '',
  };
}

// n fresh stories from one source, each headline made of unique words so the
// duplicate detector never treats two fillers as the same news
let fillerCount = 0;
function filler(source, n, hoursAgo = 2) {
  return Array.from({ length: n }, (_, i) => {
    const c = fillerCount++;
    return story(source, `Update kappa${c} sigma${c} delta${c}`, hoursAgo + i * 0.1);
  });
}

module.exports = function runLogicChecks(log) {
  const area = 'Saved examples';
  const lib = require(path.join(ROOT, 'fetch-digest.js'));
  const { renderDigest } = require(path.join(ROOT, 'render.js'));

  /* ---- 1. Reading a feed: unsafe links and broken dates are dropped ---- */
  const xml = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample-feed.xml'), 'utf8')
    .replace(/\{\{HOURS_AGO:(-?\d+)\}\}/g, (m, h) => new Date(Date.now() - Number(h) * HOUR).toUTCString());
  const parsed = lib.parseRss(xml, 'Example');
  const usable = parsed.filter((it) => lib.isUsableItem(it));
  const usableTitles = usable.map((it) => it.title);
  log(area, 'Feed reading: all 6 example stories are read', parsed.length === 6, `read ${parsed.length}`);
  log(area, 'Unsafe links (javascript:, plain http) never become cards',
    !usable.some((it) => /javascript|insecure/.test(it.link)), usableTitles.join(' | '));
  log(area, 'Stories dated in the future or with no real date are dropped',
    !usableTitles.some((t) => t.startsWith('Broken date')), usableTitles.join(' | '));
  log(area, 'Good stories are kept', usable.length === 2, `kept ${usable.length}, expected 2`);
  log(area, 'Special characters in headlines are decoded',
    usableTitles.includes('Entities & quotes: OpenAI’s "o5" model'), usableTitles.join(' | '));

  /* ---- 2. Choosing stories ---- */
  // Source limit: one source with 6 fresh stories gives at most 2
  {
    const picked = lib.selectStories([filler('BigSource', 6), filler('B', 2), filler('C', 2), filler('D', 2), filler('E', 2), filler('F', 2)]);
    const fromBig = picked.filter((it) => it.source === 'BigSource').length;
    log(area, `No source gets more than ${lib.PER_SOURCE_CAP} stories`, fromBig <= lib.PER_SOURCE_CAP, `BigSource got ${fromBig}`);
  }
  // Total limit: 8 sources x 2 fresh stories = 16 candidates, at most 12 shown
  {
    const pools = 'ABCDEFGH'.split('').map((s) => filler(`Src${s}`, 2));
    const picked = lib.selectStories(pools);
    log(area, `At most ${lib.TOTAL_CAP} stories in an edition`, picked.length === lib.TOTAL_CAP, `got ${picked.length}`);
    const sorted = picked.every((it, i) => i === 0 || picked[i - 1].publishedAt >= it.publishedAt);
    log(area, 'Stories are ordered newest first', sorted);
  }
  // Same story told by two outlets is shown once
  {
    const a = story('Outlet1', 'OpenAI unveils GPT-6 with much longer memory', 1);
    const b = story('Outlet2', 'GPT-6 from OpenAI arrives with longer memory', 2);
    const picked = lib.selectStories([[a], [b], ...'CDEFG'.split('').map((s) => filler(`Src${s}`, 2))]);
    const gpt = picked.filter((it) => /GPT-6/.test(it.title)).length;
    log(area, 'The same news from two outlets appears only once', gpt === 1, `GPT-6 stories shown: ${gpt}`);
  }
  // Different news about the same company is kept separately
  {
    const a = story('Outlet1', 'Nvidia earnings beat forecasts on datacenter demand', 1);
    const b = story('Outlet2', 'Nvidia unveils humanoid robotics chip', 2);
    const picked = lib.selectStories([[a], [b], ...'CDEFG'.split('').map((s) => filler(`Src${s}`, 2))]);
    const nv = picked.filter((it) => /Nvidia/.test(it.title)).length;
    log(area, 'Different news about the same company is not merged', nv === 2, `Nvidia stories shown: ${nv}`);
  }
  // The exact same link from two sources appears once
  {
    const link = 'https://example.com/shared-link';
    const picked = lib.selectStories([[story('Outlet1', 'Shared wire story about chips', 1, link)], [story('Outlet2', 'Totally different wording here', 2, link)],
      ...'CDEFG'.split('').map((s) => filler(`Src${s}`, 2))]);
    log(area, 'The same link never appears twice', picked.filter((it) => it.link === link).length === 1);
  }
  // Freshness: with plenty of fresh news, nothing older than 48 hours
  {
    const old = story('Outlet1', 'Older story from sixty hours ago about drones', 60);
    const pools = [[old], ...'ABCDEF'.split('').map((s) => filler(`Src${s}`, 2))];
    const picked = lib.selectStories(pools);
    log(area, 'With enough fresh news, stories older than 48 hours are left out', !picked.includes(old), `picked ${picked.length}`);
  }
  // Fallback: on a quiet day it widens to 72/96 hours, but never beyond
  {
    const sixty = story('Outlet1', 'Quiet day story from sixty hours ago about drones', 60);
    const ancient = story('Outlet2', 'Very old story from five days ago about phones', 120);
    const picked = lib.selectStories([[sixty], [ancient], filler('SrcA', 2), filler('SrcB', 2)]);
    log(area, 'On a quiet day, slightly older stories (up to 96 hours) fill the gap', picked.includes(sixty));
    log(area, 'Stories older than 96 hours are never shown', !picked.includes(ancient));
  }

  /* ---- 3. Summaries ---- */
  {
    const item = { title: 'T', excerpt: 'Claude got faster. Claude got faster.' };
    const s = lib.extractiveSummary(item, ['The model is 2.5 times quicker than before.', 'It costs less too.']);
    log(area, 'Summaries skip repeated sentences', (s.match(/Claude got faster/g) || []).length === 1, s);
    log(area, 'Summaries keep decimals like "2.5" intact', s.includes('2.5 times'), s);
    const fallback = lib.extractiveSummary({ title: 'Only a headline', excerpt: '' }, []);
    log(area, 'A story with no text falls back to its headline, not an empty card', fallback === 'Only a headline');
    log(area, 'Newsletter and advert lines are recognised as junk',
      lib.isBoilerplate('Subscribe to our newsletter for the latest updates') && lib.isBoilerplate('The post appeared first on Example'));
    log(area, 'Normal news sentences are not mistaken for junk', !lib.isBoilerplate('Anthropic released a new model on Tuesday.'));
  }

  /* ---- 4. Glossary rotation ---- */
  {
    const glossary = [
      { term: 'Inference', definition: 'd', wikiTitle: 'Inference' },
      { term: 'Token', definition: 'd', wikiTitle: 'Token' },
      { term: 'Fine-tuning', definition: 'd', wikiTitle: 'Fine-tuning' },
    ];
    const items = [{ title: 'A guide to fine-tuning small models', summary: '' }];
    let shown = [];
    const order = [];
    for (let day = 0; day < 4; day++) {
      const r = lib.selectGlossaryTerms(items, glossary, 1, shown);
      order.push(r.picks[0].term);
      shown = r.shownTerms;
    }
    log(area, "Glossary prefers a term that appears in the day's news", order[0] === 'Fine-tuning', order.join(', '));
    log(area, 'No glossary term repeats until all have been shown', new Set(order.slice(0, 3)).size === 3, order.join(', '));
    log(area, 'After all terms are shown, the rotation starts again', glossary.some((g) => g.term === order[3]), order.join(', '));
  }

  /* ---- 5. The page cannot be hijacked by a headline ---- */
  {
    const html = renderDigest({
      dateLabel: 'Test', generatedAt: new Date().toISOString(), sourceCount: 1, allSourceNames: ['X'], mode: 'excerpt', glossary: [],
      items: [{ title: '<script>alert("x")</script> headline', link: 'https://example.com/a"onmouseover="x', source: 'X', publishedAt: new Date(), summary: '<img src=x onerror=alert(1)>' }],
    });
    log(area, 'Code hidden in a headline or summary is shown as text, never run',
      !html.includes('<script>alert') && !html.includes('<img src=x') && !html.includes('"onmouseover="'));
  }
};
