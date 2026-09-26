'use strict';

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTime(date) {
  // This HTML is generated once, server-side, on GitHub's UTC runner, and
  // never re-rendered in the reader's own browser/timezone — so without an
  // explicit timeZone, every story's displayed time is silently off by
  // 5:30 (IST's offset from UTC) for every reader, every day, not just an
  // edge case.
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

// 8 fixed, deliberately dark/saturated "folder tab" colors. They're solid
// opaque fills with white text, so unlike body-text tokens they don't need
// separate light/dark variants to stay legible against either page theme.
const TAB_COLORS = [
  '#9c3b2e', // brick red
  '#8a5a1f', // ochre brown
  '#3f6b42', // forest green
  '#22636b', // deep teal
  '#35496a', // steel indigo
  '#5c3f78', // plum
  '#79451f', // rust
  '#45566b', // slate blue-grey
];

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function tabColorFor(source) {
  return TAB_COLORS[hashString(source) % TAB_COLORS.length];
}

function itemCard(item, storyNumber) {
  const n = String(storyNumber).padStart(2, '0');
  const summaryLines = item.summary
    .split('\n')
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('\n            ');

  return `
      <li class="card">
        <span class="hole hole-left" aria-hidden="true"></span>
        <span class="hole hole-right" aria-hidden="true"></span>
        <span class="tab" style="background:${tabColorFor(item.source)}">${n} &middot; ${escapeHtml(item.source)}</span>
        <h2 class="headline">${escapeHtml(item.title)}</h2>
        <div class="summary">
            ${summaryLines}
        </div>
        <div class="card-footer">
          <a class="read-link" href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">
            Read the full story
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M2 9L9 2M9 2H3.5M9 2V7.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </a>
          <span class="time">${escapeHtml(formatTime(item.publishedAt))}</span>
        </div>
      </li>`;
}

function glossaryCard(entry) {
  return `
      <li class="card glossary-card">
        <span class="tab glossary-tab">Today&#39;s Term</span>
        <p class="glossary-intro">One new AI word a day, explained simply &mdash; it adds up.</p>
        <h2 class="headline">${escapeHtml(entry.term)}</h2>
        <div class="summary">
            <p>${escapeHtml(entry.definition)}</p>
        </div>
        <div class="card-footer">
          <a class="read-link" href="${escapeHtml(entry.wikiUrl)}" target="_blank" rel="noopener noreferrer">
            Go deeper on Wikipedia
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M2 9L9 2M9 2H3.5M9 2V7.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </a>
          <span class="time">That&#39;s today&#39;s digest</span>
        </div>
      </li>`;
}

// The glossary term always renders last, after every story, so it never
// interrupts news-scanning and its position is predictable every day.
function buildSlides(items, glossaryPicks) {
  const slides = items.map((item, i) => itemCard(item, i + 1));
  glossaryPicks.forEach((pick) => slides.push(glossaryCard(pick)));
  return slides;
}

function renderDigest(digest) {
  const { dateLabel, items, sourceCount, mode, allSourceNames, glossary } = digest;

  const slides = buildSlides(items, glossary || []);
  const slideMarkup = slides.join('\n');
  const modeNote =
    mode === 'ai'
      ? 'Summaries written by Claude from each full article.'
      : 'Summaries excerpted directly from each source.';
  const rosterNote = `Monitors ${allSourceNames.length} sources: ${allSourceNames.join(', ')}.`;

  return `<!doctype html>
<title>AI Digest News</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Zilla+Slab:wght@400;600;700&family=Work+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #d9dedc;
    --card: #f7faf8;
    --ink: #1d2624;
    --ink-muted: #4d5852;
    --ink-faint: #7c8983;
    --border: #b6c0bb;
    --accent: #9c3b2e;
    --font-display: 'Zilla Slab', Georgia, 'Times New Roman', serif;
    --font-body: 'Work Sans', -apple-system, Segoe UI, sans-serif;
    --font-mono: 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace;
  }

  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #151a18;
      --card: #1f2624;
      --ink: #e7ece8;
      --ink-muted: #a8b3ac;
      --ink-faint: #78827c;
      --border: #333d38;
      --accent: #e0604c;
    }
  }

  :root[data-theme="dark"] {
    --bg: #151a18;
    --card: #1f2624;
    --ink: #e7ece8;
    --ink-muted: #a8b3ac;
    --ink-faint: #78827c;
    --border: #333d38;
    --accent: #e0604c;
  }

  * { box-sizing: border-box; }

  html, body {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font-family: var(--font-body);
    -webkit-font-smoothing: antialiased;
  }

  a { color: inherit; }
  a:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .page {
    max-width: 980px;
    margin: 0 auto;
    padding: 3rem 1.5rem 5rem;
  }

  .masthead {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    padding-bottom: 1.75rem;
    margin-bottom: 2.25rem;
    border-bottom: 3px double var(--border);
  }

  .eyebrow {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--accent);
  }

  .masthead h1 {
    font-family: var(--font-display);
    font-weight: 700;
    font-size: clamp(2.2rem, 5vw, 3rem);
    line-height: 1.05;
    margin: 0;
    text-wrap: balance;
  }

  .masthead-sub {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.4rem 0.9rem;
    color: var(--ink-muted);
    font-family: var(--font-mono);
    font-size: 0.88rem;
  }

  .masthead-date { color: var(--ink); font-weight: 500; }

  .stat { font-variant-numeric: tabular-nums; }

  .dot { color: var(--ink-faint); }

  .swipe-hint { display: none; }

  .stack {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
    gap: 1.5rem 1.25rem;
  }

  .card {
    position: relative;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 1.9rem 1.5rem 1.4rem;
    display: flex;
    flex-direction: column;
    box-shadow: 0 1px 0 var(--border);
  }

  .glossary-card {
    grid-column: 1 / -1;
    border-color: var(--accent);
    border-style: dashed;
    background: color-mix(in srgb, var(--accent) 6%, var(--card));
    max-width: 620px;
    margin: 0.5rem auto 0;
  }

  .glossary-intro {
    margin: 0 0 0.9rem;
    font-family: var(--font-mono);
    font-size: 0.76rem;
    color: var(--ink-faint);
  }

  .hole {
    position: absolute;
    top: -7px;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: var(--bg);
    border: 1px solid var(--border);
  }

  .hole-left { left: 28px; }
  .hole-right { right: 28px; }

  .tab {
    align-self: flex-start;
    margin: -0.55rem 0 0.95rem -0.05rem;
    padding: 0.32rem 0.65rem;
    border-radius: 2px;
    font-family: var(--font-mono);
    font-size: 0.68rem;
    font-weight: 500;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: #fdf9f0;
  }

  .glossary-tab { background: var(--accent); }

  .headline {
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 1.28rem;
    line-height: 1.3;
    margin: 0 0 0.7rem;
    text-wrap: balance;
  }

  .summary {
    flex: 1;
    color: var(--ink-muted);
    font-size: 0.95rem;
    line-height: 1.62;
  }

  .summary p { margin: 0 0 0.5rem; }
  .summary p:last-child { margin-bottom: 0; }

  .card-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-top: 1.1rem;
    padding-top: 0.9rem;
    border-top: 1px dashed var(--border);
  }

  .read-link {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.86rem;
    font-weight: 500;
    color: var(--accent);
    text-decoration: none;
    border-bottom: 1px solid transparent;
    transition: border-color 0.15s ease;
  }

  .read-link:hover { border-color: currentColor; }
  .read-link svg { transition: transform 0.15s ease; }
  .read-link:hover svg { transform: translate(1px, -1px); }

  .time {
    font-family: var(--font-mono);
    font-size: 0.76rem;
    color: var(--ink-faint);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  footer.colophon {
    margin-top: 3rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--border);
    color: var(--ink-faint);
    font-family: var(--font-mono);
    font-size: 0.78rem;
    line-height: 1.6;
  }

  .progress-bar { display: none; }

  @media (prefers-reduced-motion: reduce) {
    .read-link, .read-link svg { transition: none; }
  }

  /* --- Mobile: swipe-through reading mode --- */
  @media (max-width: 720px) {
    html, body { height: 100%; overflow: hidden; }

    body {
      display: flex;
      flex-direction: column;
    }

    .page {
      padding: 0;
      max-width: none;
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
    }

    .masthead {
      flex-shrink: 0;
      margin: 0;
      padding: 1.1rem 1.25rem 0.9rem;
      border-bottom: 1px solid var(--border);
      gap: 0.3rem;
    }

    .masthead h1 { font-size: 1.5rem; }
    .masthead-sub { font-size: 0.78rem; }
    .swipe-hint {
      display: block;
      font-family: var(--font-mono);
      font-size: 0.72rem;
      color: var(--ink-faint);
      margin-top: 0.15rem;
    }

    .stack {
      flex: 1;
      min-height: 0;
      display: block;
      overflow-y: auto;
      scroll-snap-type: y mandatory;
      scroll-behavior: smooth;
      padding: 0;
      gap: 0;
    }

    .stack .card {
      min-height: 100%;
      scroll-snap-align: start;
      scroll-snap-stop: always;
      border-radius: 0;
      border-left: none;
      border-right: none;
      border-top: none;
      justify-content: center;
      padding: 2rem 1.5rem;
    }

    .hole { display: none; }

    footer.colophon { display: none; }

    .progress-bar {
      display: flex;
      align-items: center;
      gap: 0.7rem;
      flex-shrink: 0;
      padding: 0.6rem 1.25rem;
      border-top: 1px solid var(--border);
      background: var(--bg);
      font-family: var(--font-mono);
      font-size: 0.74rem;
      color: var(--ink-faint);
    }

    .progress-track {
      flex: 1;
      height: 4px;
      background: var(--border);
      border-radius: 2px;
      overflow: hidden;
    }

    .progress-fill {
      height: 100%;
      width: 0%;
      background: var(--accent);
      transition: width 0.2s ease;
    }

    .progress-count { white-space: nowrap; font-variant-numeric: tabular-nums; }
  }
</style>

<div class="page">
  <header class="masthead">
    <span class="eyebrow">AI Digest News</span>
    <h1>Today in AI</h1>
    <div class="masthead-sub">
      <span class="masthead-date">${escapeHtml(dateLabel)}</span>
      <span class="dot">&middot;</span>
      <span class="stat">${items.length} stories</span>
      <span class="dot">&middot;</span>
      <span class="stat">${sourceCount} sources</span>
      <span class="dot">&middot;</span>
      <span class="stat">1 term to learn</span>
    </div>
    <span class="swipe-hint">Swipe up for the next story &mdash; today's term closes it out</span>
  </header>

  <ol class="stack" id="stack">
${slideMarkup}
  </ol>

  <div class="progress-bar">
    <div class="progress-track"><div class="progress-fill" id="progressFill"></div></div>
    <span class="progress-count" id="progressCount">1 / ${slides.length}</span>
  </div>

  <footer class="colophon">
    ${escapeHtml(modeNote)} ${escapeHtml(rosterNote)} Generated ${escapeHtml(dateLabel)}.
  </footer>
</div>

<script>
(function () {
  var stack = document.getElementById('stack');
  var fill = document.getElementById('progressFill');
  var count = document.getElementById('progressCount');
  if (!stack || !fill || !count) return;
  var total = stack.children.length;
  var ticking = false;

  function update() {
    ticking = false;
    var h = stack.clientHeight;
    if (!h) return;
    var index = Math.round(stack.scrollTop / h);
    index = Math.max(0, Math.min(total - 1, index));
    fill.style.width = ((index + 1) / total * 100) + '%';
    count.textContent = (index + 1) + ' / ' + total;
  }

  stack.addEventListener('scroll', function () {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  });

  update();
})();
</script>
`;
}

module.exports = { renderDigest, escapeHtml };
