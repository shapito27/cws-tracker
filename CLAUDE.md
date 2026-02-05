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

Vue 3 (Composition API, `<script setup>`) + TypeScript (strict) + Vite + @crxjs/vite-plugin. Tailwind CSS for styling. ApexCharts for charts. Vitest + fake-indexeddb for testing. Dexie.js for IndexedDB. chrome.storage.local for settings. LemonSqueezy for payments. OpenAI API (user-provided key) for AI features. No Pinia - use Vue composables (`ref`/`reactive`/`computed`) for state.

## Project Structure

```
src/
  background/        # Service worker - CWS scraping, queue, alarms. NO DOM/Vue imports.
    parsers/         # Versioned CWS HTML/JSON parsers (implement ListingParser/SearchParser interfaces)
  dashboard/         # Full-page Vue app - main UI, charts, tables, settings
    composables/     # useProjects.ts, useRankings.ts, etc.
    components/
    pages/
  popup/             # Lightweight Vue mini-app - quick status view
  shared/            # ONLY code importable by multiple contexts
    db/              # CWSDatabase class (extends Dexie) - schema, versions, migrations in one file
    types/           # All TypeScript interfaces and message types
    utils/           # Pure functions: permissions, text-analysis, quality-score, diff
tests/
  mocks/             # chrome.ts (chrome API mock), fetch.ts
  fixtures/          # Saved CWS HTML responses from Phase 0 spike
  unit/              # Mirrors src/ structure
  integration/       # End-to-end scan cycle tests
```

## Architecture Rules

Three isolated contexts - never cross boundaries:
- **Service Worker** (`src/background/`): All CWS fetching, queue processing, chrome.alarms scheduling. No DOM, no Vue, no `window`.
- **Dashboard** (`src/dashboard/`): Vue app, reads IndexedDB, receives messages from SW via `chrome.runtime.onMessage`.
- **Popup** (`src/popup/`): Lightweight status view.
- **Shared** (`src/shared/`): Types, DB wrapper, pure utilities only. No browser-specific APIs except IndexedDB.

Communication: `chrome.runtime.sendMessage` between contexts. Message types in `src/shared/types/messages.ts`. `sendMessage` fails silently if no listener (e.g., dashboard closed) - wrap in try/catch.

## Critical Rules

**Queue system:**
- One job at a time. Never parallel CWS requests.
- Queue lives in IndexedDB, NOT memory. Service workers die anytime.
- Alarm AFTER processing completes, never before.
- On SW startup: reset `status='running'` jobs to `'pending'`.
- Keyword scan = 1 request per keyword (not per keyword-per-extension). One search returns positions for ALL extensions.
- Delay includes randomized jitter. Never flat delays.

**IndexedDB (via Dexie.js):**
- All DB access through the `CWSDatabase` class extending `Dexie`. Never use raw `indexedDB.open()`.
- Dexie handles migrations via `db.version(N).stores({...})` - define schema per version, Dexie diffs automatically.
- Never `await` external work (fetch, API calls) inside a `db.transaction()` - it auto-closes.
- Dates in indexes: `string` (YYYY-MM-DD). `Date` objects only for non-indexed metadata.
- DB version increments only on schema changes (separate from manifest version).

**Parsers:**
- Must implement `ListingParser` or `SearchParser` interface (see `src/background/parsers/types.ts`).
- Versioned. CWS breaks a parser -> create new version, don't modify old.
- Tested against saved HTML fixtures, never mock parser internals.
- Fail loudly with `ParserError` if required fields missing.

**Service Worker:**
- No `setTimeout`/`setInterval` - use `chrome.alarms` (survives SW termination). Minimum `delayInMinutes` is 1 in production.
- Never rely on in-memory state. Read from IndexedDB every time.
- `position: null` in rank snapshots = "not in top 30", NOT "unranked". Display as "30+".

**MV3 constraints:**
- No `eval()`, `new Function()`, or inline scripts (CSP). Some libraries break silently - verify before adding.
- CRXJS Vite Plugin is in long-running beta. If it breaks on a Chrome update, `vite-plugin-web-extension` is the fallback.

## Common Commands

```bash
npm run dev            # Vite dev server with CRXJS HMR
npm run build          # Production build to dist/
npm test               # All tests (Vitest)
npm run test:watch     # Watch mode
npm run test:coverage  # Coverage report
npx tsc --noEmit       # Type check
```

Load in Chrome: `npm run build` -> chrome://extensions -> Load unpacked -> select `dist/`

## Feature Workflow

For every feature (task group in TODO.md):

1. **Read** the task group in TODO.md + corresponding PRD section. Check dependency chain.
2. **Implement** with tests alongside (types first, then logic, then tests).
3. **Verify**: `npm test` (all pass, no regressions) + `npx tsc --noEmit` (zero errors).
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
- [ ] No context boundary violations?
- [ ] Works at scale (365 days x 10 extensions x 20 keywords)?

**Versioning:**
- [ ] `manifest.json` version bumped?
- [ ] `CHANGELOG.md` entry added?
- [ ] DB migration added if schema changed?
- [ ] Extension loads in Chrome and basic smoke test passes?

## Conventions

- Components: `PascalCase.vue`. TS modules: `kebab-case.ts`. Composables: `useXxx.ts`. Tests: `[source].test.ts`.
- Interfaces: `PascalCase` nouns. Constants: `UPPER_SNAKE_CASE`. IndexedDB stores: `snake_case` plural.
- Always `<script setup lang="ts">`. No default exports except Vue components.
- No `any`. No `@ts-ignore`. All params and returns explicitly typed.
- Tailwind only for styling - no custom CSS. Follow color scheme in PRD section 7.2.
- Parser tests use saved fixtures. No real CWS network calls in tests ever.
- See TODO.md for specific test cases per task including edge cases.
