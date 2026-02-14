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
- **Database:** Dexie.js v4 for IndexedDB (currently schema v4, manifest v0.18.0)
- **Storage:** `chrome.storage.local` for user settings (proxy URL, API keys, scan config)
- **Testing:** Vitest + fake-indexeddb + jsdom. `@vue/test-utils` for component tests.
- **Payments:** LemonSqueezy (planned)
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
      types.ts            # ListingParser / SearchParser / AutocompleteParser interfaces
      parser-factory.ts   # Selects correct parser version
      listing-v1.ts       # Parses CWS extension detail pages
      search-v1.ts        # Parses CWS search results
      autocomplete-v1.ts  # Parses CWS search autocomplete suggestions (QcU9bc RPC)
      extract.ts          # Shared extraction utilities
  dashboard/              # Full-page Vue app - main UI
    index.html            # Dashboard SPA entry
    main.ts               # Vue app init
    App.vue               # Root component with layout
    router.ts             # Hash-based routes: /, /project/:id, /logs, /settings
    composables/          # State management (replaces Pinia)
      useProjects.ts      # Project CRUD
      useExtensions.ts    # Extension management
      useKeywords.ts      # Keyword management
      useRankings.ts      # Ranking data queries
      useAutocomplete.ts  # Autocomplete position tracking and keyword suggestions
      useExtensionSnapshots.ts  # Snapshot data
      useScanLogs.ts      # Scan log queries
      useServiceWorker.ts # SW message communication
      useSettings.ts      # Settings via chrome.storage.local
    components/
      charts/             # ApexCharts wrappers (RankChart, RankHeatmap, KeywordScatterPlot, etc.)
      comparison/         # ListingCompare, DiffView, PermissionsDiff
      project/            # Tab components (OverviewTab, RankingsTab, KeywordsTab, etc.)
      tables/             # Data tables (ExtensionsOverviewTable, KeywordPositionTable, etc.)
      ai/                 # AuditTool.vue - OpenAI integration
    pages/                # HomePage, ProjectPage, SettingsPage, LogsPage
  popup/                  # Lightweight Vue mini-app - quick status view
    composables/
      usePopupState.ts
  shared/                 # ONLY code importable by multiple contexts
    db/
      database.ts         # CWSDatabase class (extends Dexie) - schema, migrations, all queries
    types/
      index.ts            # Core types: Project, Extension, Keyword, ListingSnapshot, RankSnapshot, AutocompleteSnapshot, EventRecord, QueueJob
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
      settings.ts         # Settings retrieval helpers
tests/                    # See tests/CLAUDE.md for patterns
  mocks/chrome.ts         # Chrome API mock (storage, alarms, runtime, action, tabs, permissions)
  fixtures/               # Saved CWS HTML responses from Phase 0 spike
  unit/                   # Mirrors src/ structure
  integration/            # End-to-end scan cycle tests
proxy/                    # Cloudflare Worker - see proxy/CLAUDE.md
```

## Architecture Rules

Three isolated contexts - never cross boundaries:
- **Service Worker** (`src/background/`): All CWS fetching, queue processing, chrome.alarms scheduling. No DOM, no Vue, no `window`.
- **Dashboard** (`src/dashboard/`): Vue app, reads IndexedDB via Dexie, receives messages from SW via `chrome.runtime.onMessage`.
- **Popup** (`src/popup/`): Lightweight status view. Shares composable pattern with dashboard but separate Vue app.
- **Shared** (`src/shared/`): Types, DB wrapper, pure utilities only. No browser-specific APIs except IndexedDB.

Communication: `chrome.runtime.sendMessage` between contexts. Message types defined in `src/shared/types/messages.ts`. `sendMessage` fails silently if no listener (e.g., dashboard closed) - always wrap in try/catch.

**Import alias:** `@/` resolves to `src/`. Use `@/shared/...` for cross-context imports, `@/background/...` within SW only, etc.

**Build output:** `npm run build` builds to `dist/` AND copies to Windows desktop (`/mnt/c/Users/legio/Desktop/cws-tracker-dist/`). Use `npm run build:only` to build without copying. Chunk splitting: ApexCharts is in a separate `apexcharts` chunk.

## Critical Rules

**Queue system:**
- One job at a time. Never parallel CWS requests.
- Queue lives in IndexedDB (`queue` table), NOT memory. Service workers die anytime.
- Alarm AFTER processing completes, never before.
- On SW startup: reset `status='running'` jobs to `'pending'` via `db.resetRunningJobs()`.
- Keyword scan = 1 request per keyword (not per keyword-per-extension). One search returns positions for ALL extensions.
- Delay includes randomized jitter. Never flat delays. Base delay and jitter configured in Settings.

**IndexedDB (via Dexie.js):**
- All DB access through `CWSDatabase` class in `src/shared/db/database.ts`. Never use raw `indexedDB.open()`.
- Singleton instance exported as `db` from `@/shared/db/database`.
- Dexie handles migrations via `db.version(N).stores({...})` - define schema per version, Dexie diffs automatically.
- Currently at schema version 4: v1 = core tables, v2 = audit_cache, v3 = scan_logs, v4 = autocomplete_snapshots + autocomplete_keyword_suggestions.
- Never `await` external work (fetch, API calls) inside a `db.transaction()` - it auto-closes.
- Dates in indexes: `string` (YYYY-MM-DD). `Date` objects only for non-indexed metadata (e.g., `scannedAt`, `startedAt`).
- DB version increments only on schema changes (separate from manifest version).
- Upsert pattern: snapshot save methods delete existing records for same compound key before inserting.

**Parsers:**
- Must implement `ListingParser`, `SearchParser`, or `AutocompleteParser` interface (see `src/background/parsers/types.ts`).
- Versioned. CWS breaks a parser -> create new version, don't modify old.
- `ParserFactory` in `parser-factory.ts` selects the correct version based on settings.
- Tested against saved HTML fixtures in `tests/fixtures/`, never mock parser internals.
- Fail loudly with `ParserError` if required fields missing.

**Service Worker:**
- No `setTimeout`/`setInterval` - use `chrome.alarms` (survives SW termination). Minimum `delayInMinutes` is 1 in production.
- Never rely on in-memory state. Read from IndexedDB every time.
- `position: null` in rank snapshots = "not in top 30", NOT "unranked". Display as "30+".
- All chrome.* event listeners must be registered synchronously at top level of `index.ts`.

**MV3 constraints:**
- No `eval()`, `new Function()`, or inline scripts (CSP). Some libraries break silently - verify before adding.
- CRXJS Vite Plugin is in long-running beta. If it breaks on a Chrome update, `vite-plugin-web-extension` is the fallback.

**Settings:**
- Stored in `chrome.storage.local`, NOT IndexedDB. Type definition in `src/shared/types/settings.ts`.
- Dashboard reads via `useSettings` composable. SW reads via `@/shared/utils/settings.ts`.
- Key settings: `proxyUrl`, `proxyApiKey`, `queueDelayMs`, `queueJitterMs`, `dailyScanTime`, `parserVersion`.

## Common Commands

```bash
npm run dev            # Vite dev server with CRXJS HMR
npm run build          # Production build to dist/ + copy to Windows desktop
npm run build:only     # Production build to dist/ only
npm test               # All tests (Vitest)
npm run test:watch     # Watch mode
npm run test:coverage  # Coverage report
npm run typecheck      # Type check (vue-tsc --noEmit, NOT plain tsc)
npx tsc --noEmit       # Type check (alternative, does not check .vue files)
```

Load in Chrome: `npm run build` -> chrome://extensions -> Load unpacked -> select `dist/`

**Proxy (Cloudflare Worker) - separate package in `proxy/`:**
```bash
cd proxy && npm test              # Run proxy tests
cd proxy && npx wrangler dev      # Local dev server on port 8787
cd proxy && npx wrangler deploy   # Deploy to Cloudflare — always use npx, not bare wrangler
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
