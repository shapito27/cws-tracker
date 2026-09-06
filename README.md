<div align="center">

<img src="src/assets/icon-128.png" alt="CWS Tracker" width="96" height="96" />

# CWS Tracker

**App Store Optimization (ASO) & competitive intelligence for the Chrome Web Store — as a Chrome extension.**

Track keyword rankings, watch every competitor's listing for changes, score your own
listing quality, and ask an LLM *"why is this competitor ranking above me?"* — all
running locally in your browser, with your data never leaving the machine.

[![Manifest V3](https://img.shields.io/badge/Chrome-Manifest_V3-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Vue 3](https://img.shields.io/badge/Vue-3_·_script_setup-42b883?logo=vuedotjs&logoColor=white)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-5_+_CRXJS-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Tests](https://img.shields.io/badge/tests-1%2C656_passing-success?logo=vitest&logoColor=white)](#testing)
[![License: PolyForm NC](https://img.shields.io/badge/license-PolyForm_Noncommercial-blue)](./LICENSE)
[![Version](https://img.shields.io/badge/version-0.40.2-informational)](./CHANGELOG.md)

<br/>

<img src="docs/screenshots/overview-dashboard.png" alt="CWS Tracker dashboard — extension overview with stat cards (users, reviews, keywords, last & next scan) and a 30-day users & reviews trend chart" width="900" />

</div>

---

## Table of contents

- [What it does](#what-it-does)
- [How it works](#how-it-works)
- [Feature tour](#feature-tour)
  - [Competitor intelligence](#-competitor-intelligence)
  - [Keyword & ranking analytics](#-keyword--ranking-analytics)
  - [Autocomplete / search-suggestion tracking](#-autocomplete--search-suggestion-tracking)
  - [Listing quality & optimization](#-listing-quality--optimization)
  - [Reviews & reputation](#-reviews--reputation)
  - [Translation manipulation audit](#-translation-manipulation-audit)
  - [AI-powered keyword audit](#-ai-powered-keyword-audit)
  - [Change detection & event timeline](#-change-detection--event-timeline)
  - [Scan scheduling & sampling](#-scan-scheduling--sampling)
  - [Your data stays yours](#-your-data-stays-yours)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Install](#install)
- [Getting started](#getting-started)
- [Project structure](#project-structure)
- [Testing](#testing)
- [License](#license)
- [Contributing](#contributing)

---

## What it does

CWS Tracker turns the public Chrome Web Store into a queryable, historical dataset for
**your extensions and your competitors'**. It runs entirely as an MV3 extension: a
background service worker scrapes the store on a schedule through a thin proxy, parses
the responses with versioned parsers, and stores every snapshot in IndexedDB. A Vue 3
dashboard then renders the history as charts, diffs, comparison tables, and AI audits.

| You want to… | CWS Tracker gives you… |
| --- | --- |
| **Know where you rank** for every target keyword, every day | Daily keyword-position tracking with inverted-axis rank charts, heatmaps, and per-keyword history |
| **Catch a competitor's every move** | Field-level change detection (title, description, version, permissions, screenshots, translations, badges, size) with a chronological event timeline |
| **See *what* changed, not just *that* it changed** | Word-level text diffs and permission diffs with install-warning context |
| **Benchmark your listing** against rivals | A composite 0–100 quality score with per-component breakdown and prioritized fix recommendations |
| **Understand *why* you're losing** a keyword | An LLM-powered audit that compares both listings and explains the gap |
| **Find keywords you're missing** | Gap analysis, keyword-difficulty estimation, density matrices, and autocomplete-suggestion mining |
| **Catch a rival gaming store search through translations** | A manual translation audit that fetches a listing in up to 20 locales and scores eight documented manipulation tricks, with the flagged text quoted verbatim |
| **Own your data** | Everything lives in your browser's IndexedDB; full JSON import/export; no accounts, no servers |

---

## How it works

Every scan is a sequence of **single** CWS requests issued from a persistent IndexedDB
queue — never in parallel, always with randomized jitter — so the workload looks like a
human, survives service-worker death, and resumes exactly where it stopped.

```mermaid
flowchart LR
    A["chrome.alarms<br/>(scan slot · queue tick<br/>· 5-min watchdog)"] --> B["Queue Builder<br/>1 job / extension<br/>1 job / keyword"]
    B --> C[("IndexedDB queue<br/>(Dexie)")]
    C --> D["Queue Processor<br/>one job at a time"]
    D -->|fetch via| P["Cloudflare Worker<br/>proxy (own repo)"]
    P -->|HTML / RPC| W(("Chrome<br/>Web Store"))
    W --> P --> D
    D --> E["Versioned parsers<br/>listing · search<br/>autocomplete · reviews"]
    E --> F["Event detector<br/>(snapshot diff)"]
    F --> G[("IndexedDB<br/>snapshots · events")]
    G --> H["Vue 3 Dashboard<br/>charts · diffs · AI audit"]
    G --> I["Popup<br/>quick status"]
    D -.->|"schedule next<br/>(delay + jitter)"| A
```

**The scan loop, step by step:**

1. A `dailyScan` **alarm** fires for the next *scan slot* (or you hit *Refresh*). The
   **queue builder** creates one `listing_scan` job per unique extension (deduplicated
   across projects), one `keyword_scan` and one `autocomplete_scan` per keyword, and — on
   the day's first slot only — one `review_scan` per extension.
2. Jobs are persisted to an IndexedDB **queue**, tagged with the `cycleDate` and `slot`
   they belong to, and **shuffled** within the cycle so the gap between sampling a
   listing and sampling its rank varies in size and sign instead of being a fixed
   scheduling artifact.
3. The **queue processor** dequeues exactly one job, fetches the page through the
   **proxy** (required — the store blocks direct extension-origin requests via CORS),
   and parses it with a **versioned parser**.
4. The **event detector** diffs the new snapshot against the previous one and writes
   change events. Snapshots and events land in IndexedDB.
5. The processor schedules the next queue tick with a base delay **plus jitter**, then
   the loop repeats. One keyword search returns positions for *all* tracked extensions
   at once, so a scan is `1 request per keyword`, not per keyword-per-extension. Every
   CWS request is paced by the same configured delay — including the 2nd and 3rd
   **pagination** pages of a keyword search.

> **Resilience by design.** The queue lives in IndexedDB, not memory. On service-worker
> startup any `running` jobs are reset to `pending`, so a scan interrupted by SW
> termination simply continues. The next alarm is always scheduled *after* a job
> completes, never before.
>
> Because every alarm here is a one-shot re-armed by the handler that consumes it — and
> MV3 kills workers mid-fetch — a periodic **watchdog** (every 5 minutes) is the thing
> that reconnects a broken chain: it re-queues jobs a dead worker abandoned in `running`,
> re-arms the processing alarm when work is pending and nothing is in flight, runs a
> **missed slot** it finds due, and re-arms a missing `dailyScan` alarm. Jobs stranded
> past their own slot are discarded rather than drained days late, which would have
> written today's measurements into a past date.

---

## Feature tour

### 🔎 Competitor intelligence

Add any competitor by Chrome Web Store URL or raw 32-char ID and CWS Tracker starts
building a daily history of their listing.

<p align="center">
  <img src="docs/screenshots/competitors-risk-scores.png" alt="Competitors tab showing a Tracked Extensions table with rating, users, version, last-updated date, and a color-coded permission risk score per extension" width="820" />
</p>

- **Per-competitor overview page** — a dedicated dashboard scoped to one competitor:
  listing details, users/reviews trend, keyword rank history, autocomplete history,
  position tables, and that competitor's recent events.
- **Side-by-side listing comparison** — pick 2–4 extensions and compare titles, short
  and full descriptions, permissions, ratings, reviews, users, screenshot/translation
  counts, and a keyword-density matrix — with your tracked keywords highlighted in-line.
- **Permission risk scoring** — a 0–100 risk score per extension from weighted Chrome
  permissions, surfaced as color-coded bars so you can see who is over-asking.
- **Developer website** — the domain behind each listing, shown on the listing card.
  It is untrusted third-party text on its way into an `href`, so it is linked only when
  it parses as an `http(s)` URL with a dotted hostname and no embedded credentials.
- **Extensions overview table** — every tracked extension's metrics over time, with a
  **Daily/Weekly step toggle** and day-over-day / week-over-week deltas.

### 📈 Keyword & ranking analytics

- **Daily keyword-position tracking** for every tracked extension across all target
  keywords — one search request captures positions for everyone you track.
- **Rank charts** with an inverted Y-axis (position #1 at the top), multi-extension
  series, smooth curves, and **event annotations** drawn as color-coded vertical lines
  at the dates listings changed.
- **Rank heatmap** and **keyword scatter plot** for spotting patterns across many
  keyword/extension pairs at a glance.

<p align="center">
  <img src="docs/screenshots/rank-heatmap.png" alt="Rank Position Heatmap — latest rank for each keyword across every tracked extension, color-coded by rank quality from Top 3 to 30+" width="820" />
</p>
- **Unstable-rank detection** — CWS search results are genuinely noisy (an extension can
  oscillate between #10, #20, and out-of-top-30 within minutes), so a single dropped
  scan is flagged as a debounced amber **"Unstable"** with a one-click **Re-scan**, and
  only escalates to a real **"Out"** after a second consecutive confirming miss. The
  debounce counts **days, not scans**: raising the scan cadence must not quietly redefine
  what an "Out" means, so multi-sample days are rolled up before it is applied.
- **Keyword analysis** — a frequency matrix (how often each keyword appears in each
  rival's title/short/full text), **gap analysis** (keywords competitors use that you
  don't), and **difficulty estimation** (0–100, derived from the rating, user count, and
  quality of the top-ranking extensions).

### 💡 Autocomplete / search-suggestion tracking

The store's search box is its own ranking surface. CWS Tracker tracks the
`QcU9bc` autocomplete RPC to answer *"does the store recommend my extension as you
type?"*

- **Autocomplete position history** — chart and table of where your extension appears in
  the suggestion dropdown over the last 7/14/30 days, with color-coded positions and
  deltas.
- **Keyword discovery** — text suggestions surfaced by the store become candidate
  keywords you may not be tracking yet.
- **Coverage chart** — how much of the suggestion surface you (and rivals) occupy.

<p align="center">
  <img src="docs/screenshots/keyword-positions.png" alt="Keyword Positions and Autocomplete (AC) Positions tables showing day-by-day ranks per keyword with up/down deltas and a 7d/14d/30d range toggle" width="820" />
</p>

### 🏆 Listing quality & optimization

A composite **0–100 quality score** computed from nine weighted components, each with an
actionable recommendation when it scores below par:

| Component | Weight | What it rewards |
| --- | :---: | --- |
| Title optimization | 15% | Length in the 20–60 char sweet spot, no stuffing |
| Full description | 15% | 150–1000 words + real structure (paragraphs, bullets) |
| Visual assets | 15% | 3–5 screenshots + promo video |
| Ratings & reviews | 15% | Star quality + review volume |
| Short description | 10% | Use of the 132-char limit |
| Translations | 10% | Locale count + major-market coverage |
| Update freshness | 10% | Recently updated beats abandoned |
| Permissions | 5% | Lower permission risk = higher quality |
| Developer profile | 5% | Verified publisher |

Plus **Flesch reading-ease** readability scoring and per-keyword **density matrices** so
you can tune copy, not guess at it.

### ⭐ Reviews & reputation

Capture each extension's reviews (star rating, text, developer reply, version reviewed,
language) and keep them current as they change:

- **Reviews tab** — rating distribution, text-vs-rating-only split, and a sortable,
  filterable review list for your extension and any competitor.
- **Voice-of-customer keywords** — the terms users actually use, mined from review text.
- **Review events** — new/edited reviews and developer replies land on the event timeline.

### 🌍 Translation manipulation audit

A listing can be honest in English and something else entirely in Japanese. The
**Translations** tab fetches an extension's store page in each selected locale
(`?hl=<locale>`, 20 available, 15 on by default) and checks the localized title, short
description, and full description for the tricks used to game store search through
translations:

| # | Trick | Severity |
| :---: | --- | :---: |
| 1 | **Different extension name** — brand words dropped, or a competitor's name in the title | High |
| 2 | **Different short description** — empty, a keyword list, left in English, or padded far beyond the English one | Medium |
| 3 | **Competitor names in text** — whole-phrase and one-edit fuzzy matches against the other extensions in the project | High |
| 4 | **Considerably longer description** — more than 2× the median length of the *other* locales | High |
| 5 | **Keyword list at end of description** — a block of short non-bullet lines, or a trailing comma-separated line | High |
| 6 | **Keyword stuffing inside description** — runs of comma-separated short phrases, or one sentence repeated with a keyword swapped | Medium |
| 7 | **Unrelated description** — cognate-aware overlap with the English listing's Latin-script terms | High |
| 8 | **Untranslated English** — Latin-letter share, or English vs. target-language function words, above 70% | Medium |

- Each locale gets a weighted **0–100 manipulation score**; the extension's score is its
  worst locale plus 5 per further flagged locale.
- Every finding says **why it fired** and quotes the offending text **verbatim**, which
  the comparison table then highlights inside the full description.
- **Locale-vs-locale comparison table** (title, short description, description length,
  detected language, flags — click a row for the full text), a date picker for past
  audits, and **Export JSON** for evidence.
- **Locales the extension doesn't ship are not audited.** CWS serves the default listing
  for an unsupported locale, so it is marked "default listing" rather than flagged as
  untranslated English — otherwise every single-language developer would score as a
  manipulator.
- **Manual only, never scheduled.** Pick extensions and locales, see the request count
  and time estimate, and run. One request per extension × locale at the normal queue
  delay (15 locales × 10 extensions ≈ 150 requests, ~2.5 h at the default 60 s), appended
  to the queue without cancelling a scan in progress and never claiming a scan slot.

> These are **text heuristics, not semantic judgements**, and deliberately conservative —
> the tab says so. An honest translation shares only ~30% of its characters with the
> English source, so a naive edit-distance cutoff flags everything; the name check
> therefore infers which words are the brand from evidence across the other locales and
> flags **brand loss**, never wording.

### 🤖 AI-powered keyword audit

For any keyword where a competitor outranks you, click **"Why higher?"** to run a
keyword audit through your own OpenAI key:

- Feeds **both** listings, current positions, metrics, quality scores, and permission
  risk into a structured prompt.
- Returns a relevance analysis, a metric-by-metric comparison, and **prioritized
  (high/medium/low) recommendations**.
- Folds in a **review-signals** block — rating trend, review velocity, developer-reply
  rate, and keyword mentions in reviews — as *diagnostic* context (hedged: reviews track
  ranking mostly via popularity, not causally).
- **Cost shown before you run it**, results **cached per day** so re-opens are free, and
  prompt variants (default / chain-of-thought / rubric-scored) are switchable in
  Settings.

> The OpenAI host permission is **optional** and only requested at runtime when you enter
> a key. No key, no network calls to OpenAI — every other feature works without it.

### 🛎️ Change detection & event timeline

Every scan diffs the new snapshot against the last and records typed events you can
filter and color-code on a chronological timeline — and annotate directly onto rank
charts:

<p align="center">
  <img src="docs/screenshots/events-timeline.png" alt="Recent Events timeline mixing rank-change events with typed listing changes — title, description, version, permission, and size changes — each tagged and dated" width="820" />
</p>

`title_change` · `description_change` · `version_change` · `permission_change` ·
`rating_milestone` · `user_milestone` · `translation_change` · `screenshot_change` ·
`badge_change` · `rank_change` · `size_change` · `review_new` · `review_edited` ·
`review_reply`

**Changes are intervals, not instants.** A change found by polling is never observed
happening — all you know is that it had not happened at one scan and had at the next. So
every event carries the last observation where the old value still held and the first
carrying the new one, and is rendered as that window and its width
("Jul 10 11:47 → Jul 13 14:49, somewhere in ~75h"). Rank-chart annotations are shaded
bands spanning the window rather than a line at midnight. Records written before this
have no window and are marked imprecise instead of being drawn as if they were bounded.

Expand any text or permission event to see a **word-level diff** (additions in green,
removals struck through in red) or a **permission diff** with the matching Chrome install
warnings — so a "permissions changed" event tells you *exactly* what new access a rival
just requested.

### ⏱️ Scan scheduling & sampling

- **1–4 scans a day.** `scansPerDay` divides the day into evenly spaced *slots* anchored
  at your scan time, each with up to 20 minutes of jitter so the sampling times are not
  themselves perfectly regular. More samples narrow the change intervals above — three
  scans a day bound a change to about 8 hours instead of 24.
- **The schedule is visible.** Settings lists the computed slot times with the next one
  highlighted, and says plainly when auto-scan is off and the setting is therefore inert.
  A **"Scans Today"** stat (`2 of 4`) counts the slots that actually produced data.
- **Intraday view.** Charts and tables still show **one point per day — the day's last
  sample**, so multi-sample days stay comparable with existing history. Where a day's
  samples disagreed, the chart adds faint best/worst markers, the tooltip lists each
  sample with its time, and table cells carry a sample-count superscript. An "Intraday"
  toggle switches cells to the day's range, and appears only when the visible range
  actually contains a multi-sample day.
- **Request budget.** Settings estimates requests per day (counting search pagination)
  and warns when a single round cannot finish before the next slot is due.
- **Scan Logs page** — every request with its method, URL, query-parameter table, and
  full response body, plus slot lifecycle entries: which slots ran, which were skipped,
  and why. API keys are redacted.

### 🔒 Your data stays yours

- **Local-first.** Every snapshot, event, and setting lives in your browser
  (`IndexedDB` + `chrome.storage.local`). No account, no backend, no telemetry.
- **Full JSON import/export** of all projects, extensions, keywords, snapshots, reviews,
  events, and settings — atomic, transactional, round-trip-safe. Restoring the backup's
  *settings* (proxy URL, API keys, schedule) is a separate opt-in checkbox, **off by
  default**, so a restore cannot quietly overwrite working credentials with stale ones.
  Import replaces all data wholesale, so it warns first when the file is over 7 days old
  or contains no projects.
- **`unlimitedStorage`.** Without it the database sits in Chrome's best-effort bucket,
  which Chrome may evict wholesale under disk pressure — taking every snapshot with it
  while `chrome.storage.local` survives, so settings look intact and the tracking history
  is simply gone. A failed database *read* is also shown as an explicit error with a
  retry, never as an empty "no projects" state that reads like data loss.
- **Bring-your-own-proxy.** The scanning proxy is a free, one-click-deployable Cloudflare
  Worker in its own repo ([`shapito27/cws-tracker-proxy`](https://github.com/shapito27/cws-tracker-proxy))
  that you host. API keys are redacted from all scan logs.

---

## Architecture

Three **isolated contexts** that never import across their boundaries, plus a shared
core:

```
┌────────────────────────┐   chrome.runtime   ┌────────────────────────┐
│  Service Worker        │  ◄──────────────►  │  Dashboard (Vue 3)     │
│  src/background/        │     messages       │  src/dashboard/        │
│  • scrape + queue       │                    │  • charts / diffs       │
│  • chrome.alarms        │                    │  • AI audit             │
│  • versioned parsers    │                    │  • reads IndexedDB      │
│  NO DOM / NO Vue        │                    │                        │
└───────────┬────────────┘                    └───────────┬────────────┘
            │                                              │
            │            ┌────────────────────┐            │
            └──────────► │  Shared             │ ◄──────────┘
                         │  src/shared/        │
                         │  • Dexie DB wrapper │
                         │  • types · utils    │
                         │  (pure / IndexedDB) │
                         └────────────────────┘
                                    ▲
                         ┌──────────┴─────────┐
                         │  Popup (Vue 3)      │  quick status view
                         │  src/popup/         │
                         └────────────────────┘
```

- **Service Worker** (`src/background/`) — all CWS fetching, the IndexedDB-backed queue,
  `chrome.alarms` scheduling, and versioned parsers. No DOM, no Vue, no `window`. All
  `chrome.*` listeners are registered synchronously at the top level so MV3 can wake the
  worker into them.
- **Dashboard** (`src/dashboard/`) — the Vue 3 SPA (hash routing for `chrome-extension://`
  URLs). Reads IndexedDB through Dexie and receives push updates from the SW via
  `chrome.runtime.onMessage`. State is plain Vue composables — **no Pinia**.
- **Popup** (`src/popup/`) — a lightweight status view sharing the composable pattern.
- **Shared** (`src/shared/`) — types, the `CWSDatabase` Dexie wrapper (the *only* path to
  IndexedDB), and pure utilities. No browser-specific APIs beyond IndexedDB.

**Parsers are versioned and fixture-tested.** Each implements a `ListingParser`,
`SearchParser`, `AutocompleteParser`, or `ReviewsParser` interface; a `ParserFactory`
selects the version from settings. When the store changes its markup, a *new* version is added rather than
mutating the old one, and parsers are tested against saved CWS HTML fixtures — never
mocked internally, never hitting the live network in tests.

---

## Tech stack

| Layer | Choice |
| --- | --- |
| **Framework** | Vue 3 (Composition API, `<script setup>`) + TypeScript (strict, ES2022) |
| **Bundler** | Vite 5 + `@crxjs/vite-plugin` (MV3 HMR) |
| **Styling** | Tailwind CSS v4 (`@tailwindcss/vite` plugin) |
| **Charts** | ApexCharts via `vue3-apexcharts` (split into its own chunk) |
| **Database** | Dexie.js v4 over IndexedDB (schema v5) |
| **Settings** | `chrome.storage.local` |
| **AI** | OpenAI API (user-provided key, optional runtime permission) |
| **Proxy** | Cloudflare Worker ([separate repo](https://github.com/shapito27/cws-tracker-proxy)) |
| **State** | Vue composables (`ref`/`reactive`/`computed`) — no Pinia |
| **Routing** | Vue Router with `createWebHashHistory` |
| **Testing** | Vitest + `fake-indexeddb` + jsdom + `@vue/test-utils` |

---

## Install

A **prebuilt copy of the extension is committed to this repo** ([`dist/`](./dist)), so you
can install it without Node, npm, or a build step. It's an unpacked Manifest V3 extension —
point Chrome straight at the folder:

1. **Get the files** — either:
   - **Clone:** `git clone https://github.com/shapito27/cws-tracker.git`, or
   - **Download:** click the green **Code → Download ZIP** button on GitHub and unzip it.
2. Open **`chrome://extensions`** in Chrome (or any Chromium browser — Edge, Brave, Opera…).
3. Turn on **Developer mode** (toggle, top-right).
4. Click **Load unpacked** and select the **`dist/`** folder inside the project.
5. Pin the CWS Tracker icon, open the dashboard, then set up scanning under
   **Settings → Proxy** (see [Getting started](#getting-started) for the proxy step).

> **Why "Load unpacked" and not a `.crx`?** Chrome only auto-installs packaged extensions
> from the Web Store; for a self-distributed build, *Load unpacked* on a folder is the
> supported path. A downloaded ZIP must be **unzipped first** — `chrome://extensions` loads
> a folder, not a `.zip`.

> **Updating.** `git pull` (or re-download the ZIP) to refresh `dist/`, then click the
> **↻ reload** icon on the CWS Tracker card in `chrome://extensions`.

Prefer to build it yourself instead of trusting the committed `dist/`? See
[Getting started](#getting-started).

---

## Getting started

For building from source (and the dev workflow):

```bash
npm install
npm run dev          # Vite dev server with CRXJS HMR
npm run build:only   # Production build to dist/
npm test             # Run the full Vitest suite
npm run typecheck    # Type-check with vue-tsc (also checks .vue files)
```

**Load the freshly built extension:**

```bash
npm run build:only
```

→ open `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the
`dist/` folder.

**Configure scanning (required).** Because the Chrome Web Store blocks direct
extension-origin requests, you must point CWS Tracker at a proxy before it can scan. Open
**Settings → Proxy** and either:

- click **Deploy to Cloudflare** to spin up your own free proxy from
  [`shapito27/cws-tracker-proxy`](https://github.com/shapito27/cws-tracker-proxy) in one
  click, then paste the URL (and optional API key) and hit **Test Connection**; or
- point it at an existing CWS Tracker proxy you already host.

To use the AI audit, also add your OpenAI key under **Settings → API Keys** (this is the
only feature that needs it).

---

## Project structure

```
src/
  background/    # Service worker: scraping, queue, alarms, versioned parsers (no DOM/Vue)
  dashboard/     # Full-page Vue app: pages, composables (state), charts, diffs, AI audit
  popup/         # Lightweight Vue status view
  shared/        # Types, Dexie DB wrapper, pure utils — the only cross-context code
tests/
  unit/          # Mirrors src/ structure
  integration/   # End-to-end scan-cycle tests
  fixtures/      # Saved CWS HTML/RPC responses (parser tests run against these)
  mocks/         # Chrome API mock (storage, alarms, runtime, action, tabs, permissions)
```

See [`CLAUDE.md`](./CLAUDE.md) for the full architecture rules, conventions, and command
reference.

---

## Testing

**1,656 tests across 65 files**, run with Vitest against `fake-indexeddb` and jsdom — no
real Chrome Web Store network calls, ever. Parser tests run against saved HTML/RPC
fixtures, and an integration suite exercises the complete scan cycle, including
service-worker restart mid-scan, fetch retries with exponential backoff, 404 handling,
cross-project deduplication, and data-retention pruning.

```bash
npm test               # all tests
npm run test:watch     # watch mode
npm run test:coverage  # coverage report
```

---

## License

**Source-available, not open source.** CWS Tracker is licensed under the
[PolyForm Noncommercial License 1.0.0](./LICENSE).

- ✅ **Free** for any noncommercial purpose — personal projects, study, research,
  evaluation, and use by nonprofit / educational / government organizations.
- ❌ **Commercial use requires a paid license.** Using CWS Tracker in or for a business,
  or to generate revenue, is not covered by the free license.
- 🚫 You may **not** sell, host, or redistribute it as a commercial product or service.

The source is public so you can read it, audit it, self-host it, and contribute fixes —
but it does **not** grant the freedoms of an OSI-approved open source license.

**Commercial licensing.** Want to use CWS Tracker commercially? A separate commercial
license is available — contact **benmakartni@gmail.com**.

## Contributing

Contributions are welcome under the Developer Certificate of Origin (DCO). See
[CONTRIBUTING.md](./CONTRIBUTING.md) for how to sign off your commits, and
[`CLAUDE.md`](./CLAUDE.md) for architecture and conventions to follow.
