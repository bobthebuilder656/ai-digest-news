'use strict';

const fs = require('fs');
const path = require('path');
const { renderDigest } = require('./render.js');

const SOURCES_PATH = path.join(__dirname, 'sources.json');
const OUT_JSON = path.join(__dirname, 'digest.json');
const OUT_HTML = path.join(__dirname, 'digest.html');

const TOTAL_CAP = 12;
const PER_SOURCE_CAP = 2;
const MAX_AGE_HOURS = 48;
const REQUEST_TIMEOUT_MS = 12000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const NO_AI = process.argv.includes('--no-ai');
const ANTHROPIC_API_KEY = NO_AI ? null : process.env.ANTHROPIC_API_KEY;

// ---------- fetch helpers ----------

async function fetchText(url, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: '*/*' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// ---------- text helpers ----------

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  '#8217': '’', '#8216': '‘', '#8220': '“', '#8221': '”',
  '#8211': '–', '#8212': '—', '#8230': '…',
};

function decodeEntities(str) {
  return str.replace(/&(#?\w+);/g, (match, code) => {
    if (ENTITIES[code] !== undefined) return ENTITIES[code];
    if (code[0] === '#') {
      const num = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      if (!Number.isNaN(num)) return String.fromCodePoint(num);
    }
    return match;
  });
}

function stripTags(html) {
  return decodeEntities(
    html
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\s*\n\s*/g, '\n')
      .trim()
  );
}

// Strips trailing "Continue reading..." / "Read the full story at X" teaser
// text that some sites glue onto the end of a truncated preview paragraph.
function stripReadMoreTeaser(text) {
  return text.replace(/[…]?\s*Read the full story at [^.]*\.?\s*$/i, '').trim();
}

function cdata(str) {
  const m = str.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return m ? m[1] : str;
}

function tag(block, name) {
  const re = new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i');
  const m = block.match(re);
  return m ? cdata(m[1]).trim() : '';
}

function attr(block, name, attrName) {
  const re = new RegExp(`<${name}\\b[^>]*\\b${attrName}=["']([^"']+)["'][^>]*/?>`, 'i');
  const m = block.match(re);
  return m ? m[1] : '';
}

// ---------- feed parsing ----------

function parseRss(xml, sourceName) {
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  return items.map((block) => {
    const title = decodeEntities(stripTags(tag(block, 'title')));
    const link = tag(block, 'link').trim();
    const pubDateRaw = tag(block, 'pubDate') || tag(block, 'dc:date') || tag(block, 'published');
    const publishedAt = pubDateRaw ? new Date(pubDateRaw) : new Date();
    const rawDesc = tag(block, 'content:encoded') || tag(block, 'description');
    const excerpt = cleanBlockText(stripReadMoreTeaser(stripTags(rawDesc)));
    return { title, link, publishedAt, excerpt, source: sourceName };
  });
}

function parseAtom(xml, sourceName) {
  const entries = xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  return entries.map((block) => {
    const title = decodeEntities(stripTags(tag(block, 'title')));
    let link = attr(block, 'link', 'href');
    if (!link) link = tag(block, 'link').trim();
    const dateRaw = tag(block, 'published') || tag(block, 'updated');
    const publishedAt = dateRaw ? new Date(dateRaw) : new Date();
    const rawDesc = tag(block, 'content') || tag(block, 'summary');
    const excerpt = cleanBlockText(stripReadMoreTeaser(stripTags(rawDesc)));
    return { title, link, publishedAt, excerpt, source: sourceName };
  });
}

async function fetchSource(source) {
  try {
    const xml = await fetchText(source.feedUrl);
    const items = source.format === 'atom' ? parseAtom(xml, source.name) : parseRss(xml, source.name);
    return items
      .filter((it) => it.title && it.link && !Number.isNaN(it.publishedAt.getTime()))
      .slice(0, 8);
  } catch (err) {
    console.error(`[warn] failed to fetch ${source.name}: ${err.message}`);
    return [];
  }
}

// ---------- story selection ----------

const MIN_ACCEPTABLE = 10;
const AGE_WINDOWS_HOURS = [MAX_AGE_HOURS, 72, 96]; // widen only if we're short on fresh stories

function pickWithWindow(bySource, windowHours) {
  const now = Date.now();
  const pools = bySource.map((items) =>
    items
      .slice()
      .sort((a, b) => b.publishedAt - a.publishedAt)
      .filter((it) => now - it.publishedAt.getTime() <= windowHours * 3600 * 1000)
  );

  const selected = [];
  const seenLinks = new Set();
  const seenTitles = new Set();
  const perSourceCount = new Map();

  let round = 0;
  while (selected.length < TOTAL_CAP && round < PER_SOURCE_CAP) {
    for (const pool of pools) {
      if (selected.length >= TOTAL_CAP) break;
      const candidate = pool[round];
      if (!candidate) continue;
      const titleKey = candidate.title.toLowerCase().slice(0, 60);
      if (seenLinks.has(candidate.link) || seenTitles.has(titleKey)) continue;
      const count = perSourceCount.get(candidate.source) || 0;
      if (count >= PER_SOURCE_CAP) continue;
      selected.push(candidate);
      seenLinks.add(candidate.link);
      seenTitles.add(titleKey);
      perSourceCount.set(candidate.source, count + 1);
    }
    round += 1;
  }

  return selected;
}

function selectStories(bySource) {
  let selected = [];
  for (const windowHours of AGE_WINDOWS_HOURS) {
    selected = pickWithWindow(bySource, windowHours);
    if (selected.length >= MIN_ACCEPTABLE) break;
  }
  return selected.sort((a, b) => b.publishedAt - a.publishedAt).slice(0, TOTAL_CAP);
}

// ---------- article extraction ----------

const BOILERPLATE_PATTERNS = [
  /flash sale/i, /register now/i, /save \$\d/i, /% off/i,
  /subscribe (to|now)/i, /sign up for/i, /sign up now/i, /newsletter/i,
  /added to your daily email digest/i, /homepage feed/i,
  /advertisement/i, /related stories?/i, /image credits?:/i,
  /follow us on/i, /get the latest/i, /your browser does not support/i,
  /all rights reserved/i, /terms of (service|use)/i, /privacy policy/i,
  /^share this/i, /^tags?:/i, /comments?$/i,
  /\|\s*(photo|screenshot|image|illustration)\s*:/i,
  /appeared first on/i,
];

function isBoilerplate(text) {
  return BOILERPLATE_PATTERNS.some((re) => re.test(text));
}

// Drops boilerplate/caption lines (e.g. a photo credit glued onto the front
// of an RSS excerpt by a newline) that would otherwise fuse onto real
// content as part of the same "sentence" and slip past paragraph filters.
function cleanBlockText(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && line.split(' ').length > 6 && !isBoilerplate(line))
    .join(' ');
}

async function extractArticleParagraphs(url) {
  try {
    const html = await fetchText(url);
    const articleMatch = html.match(/<article\b[\s\S]*?<\/article>/i);
    const scope = articleMatch ? articleMatch[0] : html;
    const paragraphs = scope.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) || [];
    return paragraphs
      .map((p) => stripReadMoreTeaser(stripTags(p)))
      .filter((t) => t.split(' ').length > 6 && !isBoilerplate(t));
  } catch (err) {
    return [];
  }
}

// Drop paragraphs that recur verbatim across multiple articles from the same
// source - that's site chrome (newsletter prompts, ad slots), not article text.
function dropCrossArticleBoilerplate(paragraphsByItem, sources) {
  const countBySourceAndText = new Map();
  paragraphsByItem.forEach((paragraphs, i) => {
    const key = sources[i];
    for (const p of new Set(paragraphs)) {
      const mapKey = key.concat('::', p);
      countBySourceAndText.set(mapKey, (countBySourceAndText.get(mapKey) || 0) + 1);
    }
  });
  return paragraphsByItem.map((paragraphs, i) => {
    const key = sources[i];
    return paragraphs.filter((p) => (countBySourceAndText.get(key.concat('::', p)) || 0) <= 1);
  });
}

// ---------- summarization ----------

// A period between two digits (e.g. "Seedance 2.5", "$1.5 billion") is not a
// sentence boundary. Naively splitting on it there is a correctness bug, not
// just a style nit: since the next char isn't whitespace, the sentence-ending
// regex fails to match through that point, and JS's match() silently drops
// the unmatched span rather than merging it into a neighboring sentence.
const DECIMAL_PLACEHOLDER = 'DECPTOKEN';

function splitSentences(text) {
  const protectedText = text.replace(/(\d)\.(\d)/g, function (m, a, b) {
    return a.concat(DECIMAL_PLACEHOLDER, b);
  });
  const sentences = protectedText.match(/[^.!?]+[.!?]+(\s|$)/g) || [protectedText];
  return sentences
    .map((s) => s.split(DECIMAL_PLACEHOLDER).join('.').trim())
    .filter(Boolean);
}

function extractiveSummary(item, articleParagraphs) {
  const excerptSentences = item.excerpt ? splitSentences(item.excerpt) : [];
  const articleText = articleParagraphs.join(' ');
  const articleSentences = articleText ? splitSentences(articleText) : [];

  const out = [];
  const seen = new Set();
  let wordCount = 0;

  for (const s of [...excerptSentences, ...articleSentences]) {
    const key = s.toLowerCase().slice(0, 40);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    wordCount += s.split(' ').length;
    if (out.length >= 5 || (out.length >= 4 && wordCount >= 55)) break;
  }

  if (out.length === 0) out.push(item.excerpt || item.title);
  return out.join(' ');
}

async function aiSummary(item, articleText) {
  const body = (articleText || item.excerpt || '').slice(0, 6000);
  const prompt = `Write a 4-5 sentence summary of this AI news article for a busy reader who has not seen it. Be concrete and specific (name products, companies, numbers where relevant). Neutral tone, no hype, no editorializing, no "this article discusses". Plain text only, no markdown, no headline restatement.\n\nHeadline: ${item.title}\n\nArticle text:\n${body}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic API HTTP ${res.status}`);
  const data = await res.json();
  const text = (data.content || []).map((b) => b.text || '').join('').trim();
  if (!text) throw new Error('empty AI summary');
  return text;
}

async function summarizeAll(items) {
  const concurrency = 4;
  const rawParagraphs = new Array(items.length);
  let cursor = 0;

  async function fetchWorker() {
    while (cursor < items.length) {
      const i = cursor++;
      rawParagraphs[i] = await extractArticleParagraphs(items[i].link);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, fetchWorker));

  const cleanedParagraphs = dropCrossArticleBoilerplate(
    rawParagraphs,
    items.map((it) => it.source)
  );

  const results = new Array(items.length);
  cursor = 0;

  async function summaryWorker() {
    while (cursor < items.length) {
      const i = cursor++;
      const item = items[i];
      const paragraphs = cleanedParagraphs[i];
      let summary;
      let mode = 'excerpt';
      if (ANTHROPIC_API_KEY) {
        try {
          summary = await aiSummary(item, paragraphs.join(' '));
          mode = 'ai';
        } catch (err) {
          console.error(`[warn] AI summary failed for "${item.title}": ${err.message}`);
        }
      }
      if (!summary) summary = extractiveSummary(item, paragraphs);
      results[i] = { ...item, summary, summaryMode: mode };
    }
  }
  await Promise.all(Array.from({ length: concurrency }, summaryWorker));

  return results;
}

// ---------- glossary ----------

const GLOSSARY_PATH = path.join(__dirname, 'glossary.json');
const GLOSSARY_EVERY = 3;

function glossarySearchVariants(term) {
  const m = term.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (m) return { primary: m[1].trim(), abbr: m[2].trim() };
  return { primary: term.trim(), abbr: null };
}

function glossaryTermMatches(term, text) {
  const { primary, abbr } = glossarySearchVariants(term);
  if (primary && text.toLowerCase().includes(primary.toLowerCase())) return true;
  if (abbr) {
    const escaped = abbr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${escaped}\\b`).test(text)) return true;
  }
  return false;
}

function selectGlossaryTerms(items, glossary, count) {
  if (count <= 0) return [];
  const corpus = items.map((it) => `${it.title} ${it.summary}`).join(' \n ');
  const relevant = glossary.filter((g) => glossaryTermMatches(g.term, corpus));

  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000
  );
  const offset = dayOfYear % glossary.length;
  const rotated = glossary.slice(offset).concat(glossary.slice(0, offset));

  const picked = [];
  const used = new Set();
  for (const g of [...relevant, ...rotated]) {
    if (picked.length >= count) break;
    if (used.has(g.term)) continue;
    used.add(g.term);
    picked.push(g);
  }
  return picked.map((g) => ({
    term: g.term,
    definition: g.definition,
    wikiUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(g.wikiTitle.replace(/ /g, '_'))}`,
  }));
}

// ---------- main ----------

async function main() {
  const sources = JSON.parse(fs.readFileSync(SOURCES_PATH, 'utf8'));

  console.error(`Fetching ${sources.length} sources...`);
  const bySource = await Promise.all(sources.map(fetchSource));

  const totalFetched = bySource.reduce((sum, arr) => sum + arr.length, 0);
  console.error(`Fetched ${totalFetched} raw items.`);

  const selected = selectStories(bySource);
  console.error(`Selected ${selected.length} stories. Writing summaries${ANTHROPIC_API_KEY ? ' (AI mode)' : ' (excerpt mode)'}...`);

  const withSummaries = await summarizeAll(selected);
  withSummaries.sort((a, b) => b.publishedAt - a.publishedAt);

  const usedSources = new Set(withSummaries.map((it) => it.source));
  const overallMode = withSummaries.some((it) => it.summaryMode === 'ai') ? 'ai' : 'excerpt';

  const now = new Date();
  const dateLabel = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const glossary = JSON.parse(fs.readFileSync(GLOSSARY_PATH, 'utf8'));
  const glossarySlotCount = Math.floor(withSummaries.length / GLOSSARY_EVERY);
  const glossaryPicks = selectGlossaryTerms(withSummaries, glossary, glossarySlotCount);

  const digest = {
    generatedAt: now.toISOString(),
    dateLabel,
    sourceCount: usedSources.size,
    allSourceNames: sources.map((s) => s.name),
    mode: overallMode,
    glossaryEvery: GLOSSARY_EVERY,
    glossary: glossaryPicks,
    items: withSummaries.map((it) => ({
      title: it.title,
      link: it.link,
      source: it.source,
      publishedAt: it.publishedAt.toISOString(),
      summary: it.summary,
    })),
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(digest, null, 2));

  const htmlDigest = {
    ...digest,
    items: digest.items.map((it) => ({ ...it, publishedAt: new Date(it.publishedAt) })),
  };
  fs.writeFileSync(OUT_HTML, renderDigest(htmlDigest));

  console.error(`Done. Wrote ${OUT_JSON} and ${OUT_HTML}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
