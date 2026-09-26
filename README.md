# AI Digest News

A free, self-updating daily digest of AI news, published as a single web page.

**Live site:** https://bobthebuilder656.github.io/ai-digest-news/

Built this because keeping up with AI news felt overwhelming — either too much noise or too many platforms to check. Every morning it gathers the latest AI stories from 12 well-known tech publications, picks the most important ones, writes a short summary of each, and publishes them as an easy-to-swipe set of cards. Each day also ends with one plain-English explanation of an AI term that appeared in the news, so readers learn a little as they go.

Ideal for anyone who feels overwhelmed by AI news or has to jump across multiple sites just to stay updated.

## Features

- **12 trusted sources** — TechCrunch, VentureBeat, The Verge, Ars Technica, Wired, MIT Technology Review, AI News, AI Business, The Decoder, SiliconANGLE, The Register and Unite.AI.
- **Balanced and fresh** — only stories from the last 48 hours, at most 2 per source, 12 in total, so no single outlet dominates.
- **No duplicates** — when several outlets cover the same story, it appears only once.
- **Short summaries** — each card has a few-sentence summary and a link to the original article.
- **Daily AI glossary** — one beginner-friendly term per day, chosen to match that day's news, never repeated until the whole glossary has been shown.
- **Works worldwide** — every reader sees their own local date, and story times in their own time zone.
- **Fully automatic and free** — runs on GitHub Actions and GitHub Pages; no server, database or paid service needed.

## How it works

```
12 news feeds ──► fetch-digest.js ──► digest.json ──► render.js ──► digest.html ──► GitHub Pages
                  (collect, filter,                  (build the
                   de-duplicate,                      web page)
                   summarize, glossary)
```

1. A scheduled GitHub Actions workflow (`.github/workflows/daily-digest.yml`) runs once a day, aiming for about 8:00 AM India time.
2. `fetch-digest.js` reads each outlet's RSS/Atom feed (listed in `sources.json`), selects the stories, opens each article and builds a summary from its opening sentences.
3. It picks a glossary term from `glossary.json` and records it in `glossary-history.json` to avoid repeats.
4. `render.js` turns the result into `digest.html`, which the workflow commits and publishes to GitHub Pages.

Readers get the newest edition whenever they open or refresh the page.

### Optional: AI-written summaries

By default the summaries are taken from each article's own text, which costs nothing. If an `ANTHROPIC_API_KEY` secret is added to the repository, the tool instead asks Claude to write each summary, and falls back to the free method if that fails.

## Run it yourself

Requires [Node.js](https://nodejs.org/) 22 or newer. There are no dependencies to install.

```bash
node fetch-digest.js --no-ai   # builds digest.json and digest.html
```

Then open `digest.html` in a browser.

To host your own copy: fork this repository, enable workflows in your fork's **Actions** tab (GitHub turns them off for forks by default), enable **GitHub Pages** (Settings → Pages → Source: GitHub Actions), and run the **Daily AI Digest** workflow from the **Actions** tab. To change the news sources, edit `sources.json`.

## Tests

```bash
cd tests
npm install
npx playwright install chromium
npm run check
```

The checks validate the configuration files, confirm dates and times render correctly for readers in several time zones, and run the real pipeline against live feeds.

## Project files

| File | Purpose |
|---|---|
| `fetch-digest.js` | Collects, filters and summarizes the news |
| `render.js` | Builds the web page |
| `sources.json` | The list of news feeds |
| `glossary.json` | The AI terms and their explanations |
| `glossary-history.json` | Which terms have already been shown |
| `.github/workflows/daily-digest.yml` | The daily schedule and publishing steps |
| `tests/` | Automated checks |

## Credits

All news content belongs to the original publishers. Each card links back to the full article on the publisher's site.
