#!/usr/bin/env node
/*
 * Weekly quality report (added 2026-10-22). This is the "eval" layer: the
 * other checks prove the digest WORKS; this estimates whether it is GOOD.
 *
 * It reads the past week's editions from git history and measures:
 *   - AI relevance: stories whose headline and summary mention no AI term
 *   - Junk summaries: too short, just the headline, or advert/cookie text
 *   - Freshness: share of stories from the last 48 hours vs the 72/96h fallback
 *   - Possible repeats: two headlines in one edition that look alike but were
 *     not merged (below the merge threshold, so a person should look)
 *   - Source mix: how many stories each source contributed
 * Then it picks 4 stories from the latest edition for a person to open and
 * compare with the summary (the Monday check).
 *
 * These are rough, rule-based signals, not proof: a flagged story may be fine.
 * Warnings only; it never blocks publishing. Writes the report as Markdown to
 * stdout. Usage: node tests/quality-report.js > report.md
 */
'use strict';

const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const lib = require(path.join(ROOT, 'fetch-digest.js'));

const AI_TERMS = /\b(ai|a\.i\.|artificial intelligence|machine learning|deep learning|neural|llms?|language models?|chatbots?|generative|genai|gpt[-\w]*|openai|anthropic|claude|gemini|deepmind|copilot|chatgpt|mistral|llama|grok|xai|perplexity|hugging ?face|nvidia|gpus?|inference|training data|agents?|agentic|automation|robots?|robotics|humanoid|data ?centers?|algorithms?|models?)\b/i;
const JUNK = /(cookie|enable javascript|sign in to|log in to|paywall|subscribe|subscriber|newsletter|advertisement|all rights reserved)/i;

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
}

// One edition per day, newest first, for the last 7 days
function loadEditions() {
  const hashes = git(['log', '-n', '30', '--format=%H', '--', 'digest.json']).trim().split('\n').filter(Boolean);
  const byDay = new Map();
  for (const h of hashes) {
    try {
      const d = JSON.parse(git(['show', `${h}:digest.json`]));
      if (!byDay.has(d.dateLabel)) byDay.set(d.dateLabel, d);
    } catch { /* skip unreadable old versions */ }
    if (byDay.size >= 7) break;
  }
  return [...byDay.values()];
}

function pct(n, total) {
  return total ? `${Math.round((n / total) * 100)}%` : 'n/a';
}

function main() {
  const editions = loadEditions();
  const stories = editions.flatMap((e) => e.items.map((it) => ({ ...it, edition: e.dateLabel, builtAt: e.generatedAt })));
  const total = stories.length;

  const offTopic = stories.filter((s) => !AI_TERMS.test(`${s.title} ${s.summary}`));
  const junk = stories.filter((s) => {
    const words = (s.summary || '').split(/\s+/).filter(Boolean).length;
    return words < 20 || s.summary.trim() === s.title.trim() || JUNK.test(s.summary) ||
      lib.isBoilerplate(s.summary);
  });
  const hoursOld = (s) => (new Date(s.builtAt) - new Date(s.publishedAt)) / 3600000;
  const fresh = stories.filter((s) => hoursOld(s) <= 48).length;
  const fallback = stories.filter((s) => hoursOld(s) > 48 && hoursOld(s) <= 96).length;

  const repeats = [];
  for (const e of editions) {
    for (let i = 0; i < e.items.length; i++) {
      for (let j = i + 1; j < e.items.length; j++) {
        const sim = lib.jaccardSimilarity(lib.significantWords(e.items[i].title), lib.significantWords(e.items[j].title));
        if (sim >= 0.2) repeats.push({ edition: e.dateLabel, a: e.items[i], b: e.items[j], sim });
      }
    }
  }

  const perSource = new Map();
  for (const s of stories) perSource.set(s.source, (perSource.get(s.source) || 0) + 1);
  const allSources = (editions[0] && editions[0].allSourceNames) || [];
  const silent = allSources.filter((n) => !perSource.has(n));

  // 4 stories from the latest edition, spread across it, for the human check
  const latest = editions[0] ? editions[0].items : [];
  const step = Math.max(1, Math.floor(latest.length / 4));
  const sample = [0, 1, 2, 3].map((k) => latest[k * step]).filter(Boolean);

  const flag = (n, okIfZero = true) => (n === 0 === okIfZero ? 'OK' : 'Look');
  const lines = [];
  lines.push(`Covers **${editions.length} editions** (${editions.length ? `${editions[editions.length - 1].dateLabel} to ${editions[0].dateLabel}` : 'none'}), **${total} stories**.`);
  lines.push('');
  lines.push('| Measure | Result | Status |');
  lines.push('|---|---|---|');
  lines.push(`| Stories that may not be about AI | ${offTopic.length} of ${total} (${pct(offTopic.length, total)}) | ${flag(offTopic.length)} |`);
  lines.push(`| Summaries that look like junk | ${junk.length} of ${total} (${pct(junk.length, total)}) | ${flag(junk.length)} |`);
  lines.push(`| Stories from the last 48 hours | ${fresh} of ${total} (${pct(fresh, total)}); ${fallback} from the 48-96h fallback | ${fresh / (total || 1) >= 0.8 ? 'OK' : 'Look'} |`);
  lines.push(`| Possible repeated news in one edition | ${repeats.length} pair(s) | ${flag(repeats.length)} |`);
  lines.push(`| Sources with no story all week | ${silent.length ? silent.join(', ') : 'none'} | ${flag(silent.length)} |`);
  lines.push('');
  lines.push('"Look" means a rule flagged something for a person to check. It is not proof of a problem.');

  const listOf = (title, arr, fmt) => {
    if (!arr.length) return;
    lines.push('', `### ${title}`, '');
    arr.slice(0, 10).forEach((x) => lines.push(`- ${fmt(x)}`));
    if (arr.length > 10) lines.push(`- ...and ${arr.length - 10} more`);
  };
  listOf('Stories that may not be about AI', offTopic, (s) => `[${s.title}](${s.link}) (${s.source}, ${s.edition})`);
  listOf('Summaries that look like junk', junk, (s) => `[${s.title}](${s.link}) (${s.source}): "${s.summary.slice(0, 120)}..."`);
  listOf('Possible repeated news', repeats, (r) => `${r.edition}: "${r.a.title}" (${r.a.source}) and "${r.b.title}" (${r.b.source})`);

  lines.push('', '### Stories per source this week', '');
  [...perSource.entries()].sort((a, b) => b[1] - a[1]).forEach(([n, c]) => lines.push(`- ${n}: ${c}`));

  lines.push('', '## Your 10-minute check', '');
  lines.push('Open each article, read its first few paragraphs, and compare with the summary on the card. Ask: is the summary accurate? Is it about AI? Is it worth a reader\'s time?', '');
  sample.forEach((s, i) => {
    lines.push(`${i + 1}. **[${s.title}](${s.link})** (${s.source})`);
    lines.push(`   > ${s.summary}`);
  });
  lines.push('', 'If anything looks wrong, tell Claude which story and what is wrong. Otherwise close this issue.');

  console.log(lines.join('\n'));
}

main();
