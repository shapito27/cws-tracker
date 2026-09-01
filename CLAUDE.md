# CLAUDE.md - CWS Tracker

Chrome extension (MV3) for ASO and competitive intelligence on Chrome Web Store. Tracks keyword rankings, monitors competitor listings, detects translation manipulation, and offers AI-powered optimization.

## Key Documents

Read before starting any feature:
- `CWS_Tracker_PRD_v2.md` - Full product requirements
- `CWS_Tracker_TODO.md` - Implementation plan (517 tasks with dependencies)
- `EXTENSION_DEV_GUIDE.md` - Chrome Extension MV3 best practices
- `SPIKE_RESULTS.md` - Phase 0 CWS response format findings
- `QUALITY_SCORE_THRESHOLDS.md` - Calibrated quality score thresholds

## Tech Stack

- **Framework:** Vue 3 (Composition API, `<script setup>`) + TypeScript (strict, ES2022)
- **Bundler:** Vite 5 + @crxjs/vite-plugin (MV3 HMR)
- **Styling:** Tailwind CSS v4 (uses `@tailwindcss/vite` plugin, NOT the PostCSS-based v3 setup)
- **Charts:** ApexCharts via `vue3-apexcharts`
- **Database:** Dexie.js v4 for IndexedDB (schema v5; DB version bumps only on schema change, independent of `manifest.json`)
- **Storage:** `chrome.storage.local` for user settings (proxy URL, API keys, scan config)
- **Testing:** Vitest + fake-indexeddb + jsdom. `@vue/test-utils` for component tests.
- **Payments:** none yet — LemonSqueezy/Pro-tier scaffolding was removed in 0.33.0; monetization remains a PRD roadmap item
- **AI:** OpenAI API (user-provided key) for keyword audit and optimization
- **State management:** Vue composables (`ref`/`reactive`/`computed`). No Pinia.
- **Routing:** Vue Router with hash history (`createWebHashHistory`) - required for chrome-extension:// URLs

## Project Structure

```
src/
  background/             # Service worker - CWS scraping, queue, alarms. NO DOM/Vue imports.
    index.ts              # SW entry point - registers chrome.* listeners synchronously
    scheduler.ts          # chrome.alarms scheduling with jitter
    queue-builder.ts      # Creates queue jobs from projects/keywords
    queue-processor.ts    # Main queue loop - one job at a time
    event-detector.ts     # Detects listing/ranking change events
    messaging.ts          # chrome.runtime.onMessage handler
    pagination-diagnostic.ts  # Debug tool for CWS pagination
    parsers/
      types.ts            # ListingParser / SearchParser / AutocompleteParser / ReviewsParser interfaces
      parser-factory.ts   # Selects correct parser version
      listing-v1.ts       # Parses CWS extension detail pages
      search-v1.ts        # Parses CWS search results
      autocomplete-v1.ts  # Parses CWS search autocomplete suggestions (QcU9bc RPC)
      reviews-v1.ts       # Parses CWS review lists (upserted by stable review UUID)
      extract.ts          # Shared extraction utilities
  dashboard/              # Full-page Vue app - main UI
    index.html            # Dashboard SPA entry
    main.ts               # Vue app init
    App.vue               # Root component with layout
    router.ts             # Hash routes: /, /project/:id, /project/:id/extension/:extId, /logs, /settings, /rank-changes
    composables/          # State management (replaces Pinia)
      useProjects.ts      # Project CRUD
      useExtensions.ts    # Extension management
      useKeywords.ts      # Keyword management
      useRankings.ts      # Ranking data queries
      useAutocomplete.ts  # Autocomplete position tracking and keyword suggestions
      useExtensionSnapshots.ts  # Snapshot data
      useReviews.ts       # Review queries and review-signal aggregation
      useScanLogs.ts      # Scan log queries
      useProxyStatus.ts   # Reactive proxy-configured state (gates scan UI)
      useDataTransfer.ts  # Export/import all data (backup/restore)
      useServiceWorker.ts # SW message communication
      useSettings.ts      # Settings via chrome.storage.local
    components/
      charts/             # ApexCharts wrappers (RankChart, RankHeatmap, KeywordScatterPlot, etc.)
      comparison/         # ListingCompare, DiffView, PermissionsDiff
      project/            # Tab components (OverviewTab, RankingsTab, KeywordsTab, ReviewsTab, EventsTab, etc.)
      tables/             # Data tables (ExtensionsOverviewTable, KeywordPositionTable, etc.)
      ai/                 # AuditTool.vue - OpenAI integration
    pages/                # HomePage, ProjectPage, SettingsPage, LogsPage, RankChangesPage, CompetitorExtensionPage
  popup/                  # Lightweight Vue mini-app - quick status view
    composables/
      usePopupState.ts
  shared/                 # ONLY code importable by multiple contexts
    db/
      database.ts         # CWSDatabase class (extends Dexie) - schema, migrations, all queries
    types/
      index.ts            # Core types: Project, Extension, Keyword, ListingSnapshot, RankSnapshot, AutocompleteSnapshot, Review, EventRecord, QueueJob
      messages.ts         # Chrome.runtime message types (SW <-> UI)
      settings.ts         # Settings interface for chrome.storage.local
    utils/                # Pure functions only
      permissions.ts      # Chrome permission parsing
      quality-score.ts    # Quality score calculation
      text-analysis.ts    # Sentiment, keyword extraction
      diff.ts             # Diff calculation for change detection
      comparison.ts       # Compare extension listings
      dates.ts            # Date manipulation (YYYY-MM-DD)
      keyword-analysis.ts # Keyword position analysis
      keyword-audit.ts    # AI-powered keyword audit (with caching)
      openai.ts           # OpenAI API wrapper
      event-colors.ts     # Color mapping for event types
      snapshot-dedup.ts   # Dedup logic for snapshots
      settings.ts         # Settings retrieval helpers (incl. isProxyConfigured)
      rank-history.ts     # Drop debounce (classifyDrop) + findEffectivePrevious across gap days
      scan-phase.ts       # Scan lifecycle phase labels (queued/running/waiting/completing)
      scan-slots.ts       # Slot math for scansPerDay (currentSlot, nextSlotOccurrence, slotKey)
      daily-rollup.ts     # Collapse intraday samples to one per day (rollupByDate, positionStats)
      event-window.ts     # Render an EventRecord's lastSeenOld..firstSeenNew interval
      review-analysis.ts  # Review sentiment / signal extraction
      review-hash.ts      # Stable hash for review change detection
      website.ts          # Sanitize untrusted CWS developer-website values for display/href
      chart-colors.ts     # Shared chart color palette
      data-export.ts      # Serialize/deserialize DB for backup/restore
tests/                    # See tests/CLAUDE.md for patterns
  mocks/chrome.ts         # Chrome API mock (storage, alarms, runtime, action, tabs, permissions)
  fixtures/               # Saved CWS responses (HTML detail/search + autocomplete JSON) for parser tests
  unit/                   # Mirrors src/ structure
  integration/            # End-to-end scan cycle tests
```

> **Proxy moved:** the Cloudflare Worker proxy is now its **own repository** at
> `~/Projects/cws-tracker-proxy` (public mirror: `github.com/shapito27/cws-tracker-proxy`).
> It is a standalone package that shares no code with the extension — see that repo's `CLAUDE.md`.

## Architecture Rules

Three isolated contexts - never cross boundaries:
- **Service Worker** (`src/background/`): All CWS fetching, queue processing, chrome.alarms scheduling. No DOM, no Vue, no `window`.
- **Dashboard** (`src/dashboard/`): Vue app, reads IndexedDB via Dexie, receives messages from SW via `chrome.runtime.onMessage`.
- **Popup** (`src/popup/`): Lightweight status view. Shares composable pattern with dashboard but separate Vue app.
- **Shared** (`src/shared/`): Types, DB wrapper, pure utilities only. No browser-specific APIs except IndexedDB.

Communication: `chrome.runtime.sendMessage` between contexts. Message types defined in `src/shared/types/messages.ts`. `sendMessage` fails silently if no listener (e.g., dashboard closed) - always wrap in try/catch.

**Import alias:** `@/` resolves to `src/`. Use `@/shared/...` for cross-context imports, `@/background/...` within SW only, etc.

**Build output:** `npm run build` builds to `dist/` AND copies to Windows desktop (`${CWS_DIST_DIR:?}/`). Use `npm run build:only` to build without copying. Chunk splitting: ApexCharts is in a separate `apexcharts` chunk.

**`dist/` is committed to the repo**, so any verification `build:only` rewrites its content-hashed asset filenames and dirties the working tree — restore with `git checkout -- dist/ && git clean -fdq dist/` before committing source; stage `dist/` only for a deliberate release rebuild.

## Critical Rules

**Queue system:**
- One job at a time. Never parallel CWS requests.
- Queue lives in IndexedDB (`queue` table), NOT memory. Service workers die anytime.
- Alarm AFTER processing completes, never before.
- On SW startup: reset `status='running'` jobs to `'pending'` via `db.resetRunningJobs()`.
- Job types: `listing_scan`, `keyword_scan`, `translation_audit`, `autocomplete_scan`, `review_scan`.
- Keyword scan = 1 request per keyword (not per keyword-per-extension). One search returns positions for ALL extensions.
- Delay includes randomized jitter. Never flat delays. Base delay and jitter configured in Settings.

**IndexedDB (via Dexie.js):**
- All DB access through `CWSDatabase` class in `src/shared/db/database.ts`. Never use raw `indexedDB.open()`.
- Singleton instance exported as `db` from `@/shared/db/database`.
- Dexie handles migrations via `db.version(N).stores({...})` - define schema per version, Dexie diffs automatically.
- Currently at schema version 5: v1 = core tables, v2 = audit_cache, v3 = scan_logs, v4 = autocomplete_snapshots + autocomplete_keyword_suggestions, v5 = reviews.
- `reviews` is the one table keyed by a **stable CWS UUID** (`&reviewId` unique index), not by a date compound key. Reviews are upserted entities with change detection (`review-hash.ts`), not append-only snapshots.
- Never `await` external work (fetch, API calls) inside a `db.transaction()` - it auto-closes.
- Dates in indexes: `string` (YYYY-MM-DD). `Date` objects only for non-indexed metadata (e.g., `scannedAt`, `startedAt`).
- DB version increments only on schema changes (separate from manifest version).
- Upsert pattern: snapshot save methods delete existing records for same compound key before inserting.

**Events are intervals, not instants:**
- An `EventRecord` bounds *when* a change happened with `lastSeenOldAt` / `firstSeenNewAt` — the change occurred somewhere between them. `detectedAt` is when the scan noticed, which is NOT when it happened; never present it as the change time.
- Both fields are optional and absent on legacy records — always handle the missing case. Render with `event-window.ts` (`describeEventWindow` / `describeEventWindowCompact`) rather than formatting the dates ad hoc.

**Untrusted CWS input:**
- Values scraped from CWS are third-party input. Anything that reaches an `href` (developer website, and by the same argument privacy-policy / support URLs) must be sanitized first: `shared/utils/website.ts` links a value only when it parses as an `http(s)` URL with a dotted hostname and no embedded credentials, so `javascript:`/`data:` and `https://trusted.com@evil.com` shapes are dropped rather than linked. Store the raw CWS value; sanitize at render time.

**Parsers:**
- Must implement `ListingParser`, `SearchParser`, `AutocompleteParser`, or `ReviewsParser` interface (see `src/background/parsers/types.ts`).
- Versioned. CWS breaks a parser -> create new version, don't modify old.
- `ParserFactory` in `parser-factory.ts` selects the correct version based on settings.
- Tested against saved HTML fixtures in `tests/fixtures/`, never mock parser internals.
- Fail loudly with `ParserError` if required fields missing.

**Service Worker:**
- No `setTimeout`/`setInterval` - use `chrome.alarms` (survives SW termination). Minimum `delayInMinutes` is 1 in production.
- Never rely on in-memory state. Read from IndexedDB every time.
- `position: null` in rank snapshots = "not in top 30", NOT "unranked". Display as "30+". A *first* drop off top-30 is "Unstable" (unconfirmed); only a 2nd consecutive null escalates to a real "Out"/`rank_change`. Debounce + gap-day logic lives in `shared/utils/rank-history.ts` (`classifyDrop`, `findEffectivePrevious`) and is shared by the SW event detector and UI loaders.
- The drop debounce is **day-based, not scan-based** — "2nd consecutive null" means a second consecutive *date*, not a second consecutive scan. With `scansPerDay > 1` the samples must be rolled up to one per day first (`daily-rollup.ts`: `rollupByDate` / `pickLatestPerDate`) or an extension flapping within a single day confirms an "Out" it should not. A gap day with no prior snapshot stays `'provisional'` — the safe choice.
- Scans are **slot-based**, not once-a-day. `scansPerDay` (1/2/4) divides the day into evenly spaced slots anchored at `dailyScanTime`; `scan-slots.ts` computes them (`currentSlot`, `nextSlotOccurrence`, `slotKey`, `slotDateFor`). At `scansPerDay: 1` this is exactly the old one-a-day behaviour.
- The `dailyScan` alarm is **one-shot** — armed at the next slot occurrence and re-armed in a `finally` after each run (NOT a periodic alarm). `chrome.runtime.onStartup` runs a missed slot via `isDailyScanDue`; a `scanCycleStartedAt` marker stops the startup catch-up and a past-due alarm double-enqueuing.
- **`lastScanSlotKey` is the single authority on whether a slot has run.** Never infer "this install predates slots" from it being `null`, and never gate a slot on `lastDailyScanDate` — that key is set by *any* drain (including a manual "Refresh Now", which deliberately claims no slot), whereas `lastScanSlotKey` is written only when a *scheduled* cycle drains. Conflating them shipped 0.38.1: every slot after the first returned early, silently, every day. Legacy state is converted once up front by `migrateLegacyScanState`, which must run before any scheduling decision.
- A missed slot is skipped when the next one is under 30 minutes away — otherwise the catch-up cycle is still draining when the real slot fires and the in-flight guard eats it, costing a scan rather than adding one.
- All chrome.* event listeners must be registered synchronously at top level of `index.ts`.

**MV3 constraints:**
- No `eval()`, `new Function()`, or inline scripts (CSP). Some libraries break silently - verify before adding.
- CRXJS Vite Plugin is in long-running beta. If it breaks on a Chrome update, `vite-plugin-web-extension` is the fallback.

**Settings:**
- Stored in `chrome.storage.local`, NOT IndexedDB. Type definition in `src/shared/types/settings.ts`.
- Dashboard reads via `useSettings` composable. SW reads via `@/shared/utils/settings.ts`.
- Key settings: `proxyUrl`, `proxyApiKey`, `queueDelayMs`, `queueJitterMs`, `dailyScanTime`, `dailyScanEnabled`, `scansPerDay`, `reviewFetchLimit`, `intradayView`, `parserVersion`.
- Some keys are **SW bookkeeping, not user preferences** — `lastDailyScanDate`, `lastScanSlotKey`, `scanCycleStartedAt`, `scanCycleSlotKey`. They live in the same store but are written by the scheduler; don't surface them in Settings UI or reset them casually (see the scan-slot rules above).
- **A non-empty `proxyUrl` is required to scan** — CWS blocks extension-origin requests (CORS). The SW guard, dashboard (`useProxyStatus`), and popup all gate scan triggers on `isProxyConfigured()` (`src/shared/utils/settings.ts`).

**Post-implementation (every feature/fix):**
- Always bump `manifest.json` version (MINOR for features, PATCH for fixes) and add a `CHANGELOG.md` entry. Never skip this step.

## Common Commands

```bash
npm run dev            # Vite dev server with CRXJS HMR
npm run build          # Production build to dist/ + copy to Windows desktop
npm run build:only     # Production build to dist/ only
npm run build:dev      # Unminified + sourcemaps to dist/ + copy (for debugging)
npm test               # All tests (Vitest)
npm run test:watch     # Watch mode
npm run test:coverage  # Coverage report
npm run typecheck      # Type check (vue-tsc --noEmit, NOT plain tsc)
npx tsc --noEmit       # Type check (alternative, does not check .vue files)
```

Load in Chrome: `npm run build` -> chrome://extensions -> Load unpacked -> select `dist/`

**Proxy (Cloudflare Worker) — now its own repo at `~/Projects/cws-tracker-proxy`** (push directly; no monorepo sync needed):
```bash
cd ~/Projects/cws-tracker-proxy && npm test            # Run proxy tests
cd ~/Projects/cws-tracker-proxy && npx wrangler dev    # Local dev server on port 8787
cd ~/Projects/cws-tracker-proxy && npx wrangler deploy # Deploy to Cloudflare — always use npx, not bare wrangler
```

## Feature Workflow

For every feature (task group in TODO.md):

1. **Read** the task group in TODO.md + corresponding PRD section. Check dependency chain.
2. **Implement** with tests alongside (types first, then logic, then tests).
3. **Verify**: `npm test` (all pass, no regressions) + `npm run typecheck` (zero errors).
4. **Version bump**: increment `manifest.json` version (MINOR for features, PATCH for fixes). Add `CHANGELOG.md` entry.
5. **Update TODO**: mark all completed checkboxes in `CWS_Tracker_TODO.md` as done (`- [x]`). Commit the TODO update.
6. **Review agent**: run the checklist below. ALL must be "yes" before moving on.

### Review Agent Checklist

**Correctness:**
- [ ] All new + existing tests pass?
- [ ] Feature matches PRD spec? All TODO checkboxes checked?

**Edge cases:**
- [ ] Empty/null inputs handled?
- [ ] SW killed mid-operation - recovers?
- [ ] CWS returns 404/429/malformed response?
- [ ] Empty states for no projects/no data?

**Quality:**
- [ ] No `any` types or `@ts-ignore`?
- [ ] Async ops in try/catch? Errors human-readable?
- [ ] No context boundary violations (SW importing Vue, dashboard importing background)?
- [ ] Works at scale (365 days x 10 extensions x 20 keywords)?

**Versioning:**
- [ ] `manifest.json` version bumped?
- [ ] `CHANGELOG.md` entry added?
- [ ] DB migration added if schema changed? Version incremented?
- [ ] Extension loads in Chrome and basic smoke test passes?

## Conventions

- Components: `PascalCase.vue`. TS modules: `kebab-case.ts`. Composables: `useXxx.ts`. Tests: `[source].test.ts`.
- Interfaces: `PascalCase` nouns. Constants: `UPPER_SNAKE_CASE`. IndexedDB stores: `snake_case` plural.
- Always `<script setup lang="ts">`. No default exports except Vue components.
- No `any`. No `@ts-ignore`. All params and returns explicitly typed.
- Tailwind only for styling - no custom CSS. Follow color scheme in PRD section 7.2.
- Parser tests use saved fixtures. No real CWS network calls in tests ever.
- See TODO.md for specific test cases per task including edge cases.
- String literal unions preferred over enums (e.g., `EventType`, `QueueJobStatus`).
- Auto-increment IDs are `number`, optional when creating (`id?: number`). Extension IDs are `string` (CWS 32-char).
