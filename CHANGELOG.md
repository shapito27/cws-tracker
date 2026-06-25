# Changelog

All notable changes to CWS Tracker will be documented in this file.

## [0.35.1] - 2026-06-25

### Fixed
- **Reloading/updating the extension after the scheduled time now runs the missed scan.** 0.35.0 added catch-up on `chrome.runtime.onStartup`, but that event only fires on a real browser launch — **not** when you reload the extension at `chrome://extensions` or when it auto-updates. Those paths fire `onInstalled('update')`, which previously only re-armed the alarm for the *next* occurrence (tomorrow if the time had passed), so a reload at, say, 11:30 with an 11:00 scan time would silently wait until the next day. `onInstalled('update')` now runs the same catch-up as startup (`handleBrowserStartup`), so a missed scan kicks off within ~1 minute of the reload.
- **Interrupted scans now resume on startup/reload.** If the browser closes or the extension reloads mid-scan, any jobs still queued are picked back up (the processor is re-kicked) instead of stalling until the next cycle.

### Changed
- **Duplicate-cycle guard is now resilient to stale markers.** The `scanCycleStartedAt` guard added in 0.35.0 skipped a scan whenever a marker for "today" existed. A marker left behind by an interrupted/reloaded cycle could therefore block scans for the rest of the day. The guard now only suppresses a *genuinely in-flight* cycle — one stamped within the last 2 minutes (the startup double-fire window) or with jobs still pending/running — so a stale marker no longer prevents a missed scan from running.

## [0.35.0] - 2026-06-24

### Fixed
- **The daily scan now actually runs at the configured "Scan Time".** Previously the `dailyScanTime` setting (e.g. *11:00*) was purely cosmetic: the background `dailyScan` alarm was created with a fixed `delayInMinutes: 1` / `periodInMinutes: 1440`, so it fired **one minute after the extension was last installed/updated and then every 24 hours from that point** — drifting around the clock and ignoring the time you picked. The dashboard's "next scan ~11:00 AM" label read from `dailyScanTime`, so the UI promised a time the scheduler never honored. The scan now arms a one-shot alarm at the **next real occurrence** of your configured time (computed via `nextDailyScanTimestamp`) and re-arms for the following day after each run, so an 11:00 setting fires at ~11:00 (within Chrome's ~1-minute alarm granularity).
- **Changing the scan time (or toggling auto-scan) now takes effect immediately.** A `chrome.storage.onChanged` listener in the service worker re-arms (or clears) the `dailyScan` alarm whenever `dailyScanTime` or `dailyScanEnabled` changes, instead of the edit only applying after the next extension reinstall/update.

### Added
- **Catch-up on browser startup.** If the browser was closed at your scheduled scan time, opening it later now notices that today's scan was missed and runs it right away, instead of waiting until tomorrow. A new `chrome.runtime.onStartup` handler checks `isDailyScanDue` — auto-scan enabled, no scan completed today, and the scheduled time already passed — and kicks the missed scan; otherwise it just (re)arms the next alarm. Opening the browser *before* the scheduled time does not scan early; it waits for the configured time as expected.

### Notes
- No schema or settings migration: this is purely scheduling behavior in `src/background/scheduler.ts` + `src/background/index.ts`. The one-shot `dailyScan` alarm replaces the old 24h-periodic alarm; `handleDailyScanAlarm` re-arms the next day in a `finally` so the schedule survives skipped runs (already-scanned / no-proxy / no-projects) and errors. The `today()`/`daysAgo()` date helpers now share an exported `toDateString(date)` so the catch-up logic can derive "today" from an injectable clock.
- **Duplicate-cycle guard:** on browser startup the catch-up trigger and a past-due `dailyScan` alarm can both fire. The daily cycle now stamps `scanCycleStartedAt` *before* building jobs and skips if a cycle is already marked as started today, so the day's jobs are never enqueued twice (which would double CWS requests). The marker is cleared on queue drain and on `CANCEL_SCAN` so a cancelled scan never blocks the next day's run.

## [0.34.0] - 2026-06-19

### Added
- **Proxy is now required before scanning, with a one-click setup path.** A proxy is no longer "optional" — because the Chrome Web Store blocks direct extension-origin requests (CORS), scans cannot work without one. Until a proxy URL is saved, scanning is now guarded:
  - **Dashboard:** an amber *"A proxy is required to scan"* banner appears on the Projects and project pages, and every scan trigger ("Refresh All", per-project "Scan Now", keyword-positions "Scan", and the unstable-rank "Re-scan") is disabled with an explanatory tooltip. Saving a proxy URL in Settings unlocks them instantly (no reload) via a `chrome.storage.onChanged` listener.
  - **Popup:** shows a *"Proxy not configured — scanning is disabled"* warning with a **Configure Proxy** button (opens Settings), and disables **Refresh Now**.
  - **Service worker (safety net):** `triggerManualRefresh`, `triggerKeywordRescan`, and the scheduled daily scan all bail out when no proxy is configured — manual triggers broadcast a `SCAN_ERROR` so the UI can explain why; the daily alarm logs a skip and does **not** stamp `lastDailyScanDate`, so it retries automatically once a proxy is set.
- **"Deploy to Cloudflare" one-click button.** The Proxy Settings section now leads with a callout to deploy your own free proxy in one click (`github.com/shapito27/cws-tracker-proxy`), plus a link to self-host instructions. The same Deploy button appears in the setup banner.

### Notes
- "Configured" means a non-empty proxy URL is saved; the API key remains optional (a missing/incorrect key still surfaces via the existing *Test Connection* button and at scan time). Shared `isProxyConfigured()` helper in `src/shared/utils/settings.ts` is the single source of truth, consumed by the SW guard, the dashboard `useProxyStatus` composable, and the popup. No schema or settings migration required.

### Distribution
- **Prebuilt extension now committed to the repo** ([`dist/`](./dist), this 0.34.0 build). Users can install without Node/npm: clone or **Download ZIP** → unzip → `chrome://extensions` → Developer mode → **Load unpacked** → select `dist/`. See the new [Install](./README.md#install) section. `.gitignore` now tracks `dist/` (only Vite's `dist/.vite/` build-metadata folder stays ignored); refresh it with `npm run build:only` before committing a new release.

## [0.33.0] - 2026-06-19

### Removed
- **LemonSqueezy license key / Pro tier scaffolding.** Removed the non-functional "License Key" input and subscription-status badge from Settings, along with the entire `subscriptionStatus` / Pro-tier concept that depended on it. This deletes the `lemonSqueezyLicense` and `subscriptionStatus` settings fields (and the `SubscriptionStatus` type), the validation for them, the popup header **Pro** badge, and the subscription gate in the popup's scan-nudge logic (the nudge now keys solely on whether a scan has run in the last 7 days). No data migration is required: any `lemonSqueezyLicense` / `subscriptionStatus` values already in `chrome.storage.local` are simply ignored. Monetization remains a future roadmap item in the PRD/TODO — only the dead UI/scaffolding was removed.

## [0.32.0] - 2026-06-19

### Added
- **"Test Connection" button for Proxy Settings.** Next to *Save Proxy Settings* there is now a **Test Connection** button that probes the currently-entered proxy URL + API key (before saving) and reports the result inline, mirroring the existing OpenAI *Test Connection* UX. It fetches a stable extension's `/detail` page through the proxy — the exact path scans use — and maps the HTTP status to a plain-language message so a URL problem is distinguishable from a key problem at a glance: success, **401** ("no API key — add your Proxy API Key"), **403** ("API key was rejected"), **429** ("rate limited"), **502/504** ("proxy + key OK, but couldn't reach the Chrome Web Store"), **404** ("not a CWS Tracker proxy"), and timeout / network / invalid-URL cases. Implemented as `testProxyConnection(url, apiKey)` in the `useSettings` composable (a direct dashboard fetch with a 12s `AbortController` timeout); no service-worker or proxy changes.

## [0.31.0] - 2026-06-08

### Changed
- **Scan Logs page redesigned around scan jobs.** Previously a paginated keyword scan wrote *two* near-identical rows per page — the real HTTP fetch (`Search: "kw"`, with timing + response body) and a synthetic per-page diagnostic (`Page N for "kw": X results, Y/Z tracked found, …`, hard-coded `0ms`, empty body) — interleaved in reverse-chronological order with no visual link between rows belonging to the same job. The two were impossible to tell apart and the `0ms` rows looked broken. The page now groups consecutive logs from the same queue job into a single titled card (e.g. a keyword scan and its 1–3 page requests), and **folds each per-page diagnostic into its request row** — the success result (`30 results · 4/5 tracked · continuing`) or a page-2+ failure note (fetch/HTTP/parse) — so there is exactly **one row per page**, never two. One-request jobs (listing / autocomplete scans) render as a single compact row. The misleading `0ms` is shown as `—`.
- **Stats now count real requests only.** The request total, warning/error counts, average-duration figure in the stats bar, and the 7-day Request Stats chart previously counted the synthetic `0ms` summary rows as requests — roughly doubling the keyword-scan request count and dragging the average duration toward zero. They now exclude summary entries, so the numbers reflect actual CWS requests.

### Added
- **Verbose Advanced view.** Expanding a request in Advanced mode now shows the full ISO timestamp (with milliseconds), level, job type, job ID, page, status, and duration in a field grid, the folded per-page result, the request method + URL, the query-parameter table, and the response body. The stored response preview was raised from **300 → 2000 characters** and is now rendered in a scrollable, wrapped, monospace block instead of a single truncated line. **Copy** buttons were added for the request URL and the response body.

### Notes
- New optional `kind: 'request' | 'summary'` discriminator on `ScanLog` distinguishes real requests from the synthetic per-page diagnostics so the UI can fold them robustly. It is **not indexed**, so no Dexie schema bump is required; pre-0.31.0 logs (no `kind`) fall back to a body-pattern heuristic and fold correctly until they age out of the 7-day retention window.

## [0.30.0] - 2026-06-03

### Added
- **Unstable-rank detection + one-click Re-scan.** CWS search rankings fluctuate between identical queries (verified: an extension oscillating between #10, #20, and >29 within minutes), so a single scan that misses a borderline extension previously surfaced a misleading red **"Out"** badge and fired a "dropped out of top 30" event. A drop off the captured top-30 is now treated as **unconfirmed ("Unstable")** on its first occurrence and only escalates to a real "Out" / `rank_change` event once a **second consecutive null** scan confirms it — mirroring the existing entering-side debounce. Implemented via a shared pure helper `classifyDrop` in `src/shared/utils/rank-history.ts`, consumed by the SW event detector (`detectRankChanges`) and the UI loaders (`loadRecentRankChanges`, `loadAllChanges`, `loadKeywordPositionTable`).
- The "Your Rank Changes" widget and the Rank Changes page now render an amber **"Unstable"** badge (instead of "Out") for unconfirmed drops, with a **"Re-scan"** button to immediately re-check that keyword. The project Keyword Positions table flags the latest unstable cell with an amber marker + per-row "Re-scan".
- New `RESCAN_KEYWORD` service-worker message + `triggerKeywordRescan(keywordId)` enqueue a single `keyword_scan` job **without** clearing the rest of the pending queue (non-destructive). Exposed in the dashboard via `useServiceWorker().requestKeywordRescan(keywordId)`. Note: MV3's 1-minute alarm floor means a re-scan runs within ~1 minute.

### Notes
- Scope is search rank. The recorded `position: null` snapshot is unchanged (data is preserved); only the event/badge presentation is debounced. A sustained 2-day absence still produces a real "Out". Autocomplete "disappeared" debouncing is a possible follow-up.

## [0.29.1] - 2026-04-30

### Fixed
- Rank Changes page (`#/changes`), the popup's recent-changes list, the project Overview tab's rank widgets, and the SW-side `rank_change` event detector no longer emit a spurious "New" pill when an extension rebounds across a gap day. Previously, if a scan ran on day D, did not run (or ran partially) on D+1, then ran again on D+2, every keyword whose tracked extensions weren't found on D+1 wrote `position: null` snapshots — and the next day's comparison treated those nulls as "extension was below top 30 yesterday," surfacing a misleading `change=31` (rank) or `change=AC_APPEARED_SENTINEL` (autocomplete) for every pair, even when the extension had been at #1 two days prior. The four call sites (`loadRecentRankChanges`, `loadRecentAutocompleteChanges`, `loadAllChanges`, `detectRankChanges`) now share a new `findEffectivePrevious` helper in `src/shared/utils/rank-history.ts` that, when the immediately-prior snapshot is `position: null`, walks back through the same pair's history for the most recent non-null snapshot within a 14-day window and uses it as the basis for change calculation. First-time appearances (no non-null history at all) and genuine re-entries after long absences (>14 days) still emit the correct "New" sentinel; "Out" detection (curr=null, prev=non-null) is unchanged. Historical `rank_change` events already in the events table from prior scans are not rewritten — they age out naturally.

## [0.29.0] - 2026-04-28

### Added
- Project page extension cards now display three additional listing facts next to the version: **last updated date**, **package size**, and **developer email** (rendered as a `mailto:` link). All three are guarded behind `v-if`, so older snapshots that pre-date the field render cleanly with no empty separators.
- New `size_change` event type fires when an extension's package size changes between scans (e.g. `1.5MiB` → `2.1MiB`). Rendered with the existing gray neutral-metadata styling, included in chart annotations on the Rankings tab, and filterable in the Events tab.
- `developerEmail` is now persisted on `ListingSnapshot`. The parser already extracted this field from CWS detail pages, but it was previously dropped during the parser-to-snapshot mapping. No schema bump required (no new index).



### Fixed
- Logs page no longer throws `Uncaught (in promise) Error: Element not found` from ApexCharts on first load. The daily stats chart was wrapped in `v-if="!loading"`, so when the initial `loadLogs()` promise resolved and `loading` flipped to `false`, Vue mounted the chart container and ApexCharts initialized in parallel, occasionally racing to find its mount node. The `v-if` gate is dropped — `weeklyStats` is always a full 7-bucket array (empty or populated) and `RequestStatsChart` already handles the empty case via its built-in `noData: "No requests in the last 7 days"` text. A separate "Loading logs…" block above the log list still shows during the initial fetch.

## [0.28.1] - 2026-04-21

### Changed
- Removed the "Scan in progress" banner from the Projects (home) page. It was the third duplicate surface for scan status (alongside the sidebar footer and the per-project counter, both removed in 0.28.0) and is now fully covered by the global `ScanProgressStrip`. The unused `formatTime` helper on `HomePage.vue` is also removed. The "Refresh All" button behaviour is unchanged.

## [0.28.0] - 2026-04-21

### Changed
- Scan progress indicator relocated to a global sticky strip at the top of the dashboard's main content area. Previously, scan status was shown in three places — a footer block at the bottom of the sidebar, a bare `X/Y` counter on every project's Overview tab, and a "Next job at HH:MM:SS" line. The counter and "Next job" line on the Overview tab and the entire sidebar scan footer (including the idle "Last scan: …" line) are now removed. The new `ScanProgressStrip` component shows the phase label, current job description, progress bar, `completed/total` counter (hidden when total ≤ 1), and a live "next in Ns" countdown during the `waiting` phase. The strip is `sticky top-0` so it stays visible while scrolling long project pages, and is not rendered at all when no scan is running — zero visual footprint in the idle state. The per-project "Scan Now" button on the Overview tab and the "Refresh All" button on Home are unchanged. The 1Hz countdown ticker moved from `App.vue` into the new component.

## [0.27.3] - 2026-04-20

### Fixed
- Competitor extension overview page (`#/project/:id/extension/:extId`) now correctly displays the user count in the "Users" status tile instead of `--`. The previous template expression only rendered a value when `userCountNumeric >= 1000`, so every competitor was falling through to `--`. Template now matches the three-branch logic used by `OverviewTab.vue` and `ExtensionsTab.vue`: `null` → `--`, `>= 1000` → formatted bucketed value (e.g. `1,000,000+`), `< 1000` → raw number via `toLocaleString()`. Data pipeline was already parsing and persisting both `userCount` and `userCountNumeric` correctly — this was a display-only bug.

## [0.27.2] - 2026-04-20

### Fixed
- Scan progress counts no longer include jobs from prior scan cycles. Completed jobs are retained in the queue table for 7 days, so a fresh 2-keyword scan could previously display misleading totals like "360/361 jobs" while the sidebar said "Waiting for next job". Each scan cycle now records its start time (new `scanCycleStartedAt` runtime setting), and `db.getQueueStats()` accepts an optional `cycleStartedAt` filter so `completed`/`failed` counts include only jobs that finished within the current cycle. `pending`/`running` counts stay global since those are always current-cycle by construction. Both the pre-execute and post-completion `SCAN_PROGRESS` broadcasts now use the filtered stats, and the final `SCAN_COMPLETE` message reports cycle-scoped totals before clearing the marker.

## [0.27.1] - 2026-04-20

### Fixed
- Scan progress UI in the dashboard sidebar and popup is no longer confusing during small scans (previously showed a static "Scanning... 0/1 jobs" even for single-job scans that were either still queued or actively fetching):
  - A `SCAN_PROGRESS` broadcast is now emitted the moment a job *starts* (not only after it completes), so single-job scans no longer appear frozen at "0/1 jobs".
  - The UI now distinguishes four lifecycle phases — "Queued", "Scanning", "Waiting for next job", and "Finishing up" — each with its own label and animation (pulsing dot during active CWS fetch, spinner while waiting for the next alarm).
  - The `currentJob` description (e.g. `Listing: uBlock Origin (id)`) is now shown in the dashboard sidebar, matching the popup.
  - During the inter-job delay, a live countdown ("Next in Ns") is shown when the next processing time is known.
  - Single-job scans now show "Single job" instead of the confusing "0/1 jobs", and the progress bar advances to 50% while the job is in flight (0% → 50% → 100%) so users always see visible movement.

### Changed
- `ScanProgressMessage` gains an optional `phase: 'queued' | 'running' | 'waiting' | 'completing'` field. Older messages without `phase` default to `'running'` in all consumers, so any in-flight service worker during an upgrade continues to work.

## [0.27.0] - 2026-04-20

### Added
- Competitor extension overview page at `#/project/:id/extension/:extId`. Competitor extension names are now clickable in Recent Events (Overview tab), the Events tab, the Competitors tab, and rank change lists — clicking a competitor opens a dedicated overview scoped to that competitor with its listing details, users/reviews chart, keyword rank history, autocomplete history, position tables, and recent events. Own-extension names remain static (their data is already on the main project page). Routing to the own extension id is guarded and redirects back to the project page.

### Changed
- Renamed composables for clarity now that they support any extension id, not only the user's own: `loadOwnExtensionRankHistory` → `loadExtensionRankHistory`, `loadOwnExtensionAutocompleteHistory` → `loadExtensionAutocompleteHistory`. `KeywordPositionTable` and `AcPositionTable` prop `ownExtensionId` renamed to `extensionId`.
- Extracted a shared `ExtensionListingCard` component so the Overview tab and the new Competitor overview page render the listing header (icon, title, rating, version, badges, CWS link) from a single template.

## [0.26.2] - 2026-04-20

### Changed
- Project page "Users" display now drops the `+` suffix for sub-1,000 counts. CWS returns exact numbers below 1,000 and bucketed values (`1,000+`, `10,000+`, …) at or above that threshold, so the `+` was misleading for small values — e.g. an extension with exactly 317 users previously rendered as `317+`, now renders as `317`. Bucketed values (`1,000+` and up) still display with the `+`. Applies to the Overview tab status bar, Extensions tab Users column, and Listing Compare Users row. Parser output, historical snapshots, and the trend chart are unchanged.

## [0.26.1] - 2026-04-20

### Fixed
- Logs page daily stats chart:
  - Error and warning columns were visually swamped by the info column on busy days. A compact text label (e.g., `2 err · 5 warn`) now appears above each day's bar whenever errors or warnings are non-zero, so small counts are readable regardless of scale.
  - The avg-duration line no longer dips to 0ms on zero-request days — it emits a gap instead.
  - Legend items (Info, Warnings, Errors, Avg duration) now render on a single row instead of wrapping to two lines, via tighter item spacing and a `nowrap` rule on the legend container.

## [0.26.0] - 2026-04-20

### Added
- Section-scoped `Scan` buttons next to the `Keyword Positions` and `AC Positions` tables on the project Overview tab. Clicking `Scan` next to `Keyword Positions` enqueues only `keyword_scan` jobs for the project's keywords; clicking `Scan` next to `AC Positions` enqueues only `autocomplete_scan` jobs. Useful for targeted rescans without paying the cost of a full listing + keyword + autocomplete scan. Buttons are disabled while any scan is running to preserve the single-queue model.
- `TRIGGER_REFRESH` message accepts an optional `scanType: 'full' | 'keywords' | 'autocomplete'` field (default `'full'`, backward compatible).

## [0.25.0] - 2026-04-20

### Added
- Logs page: daily request stats chart at the top of the page. A stacked-column + line mixed chart summarizes the last 7 days — per-day counts of info/warnings/errors alongside the average request duration on a secondary axis — so day-over-day trends and latency/error correlations are visible at a glance before drilling into individual log rows.

## [0.24.0] - 2026-04-19

### Added
- Extensions Overview table now has a Daily/Weekly step toggle. In Weekly mode, columns are spaced 7 days apart and deltas show week-over-week change. The range options swap from `7d / 14d / 30d` to `4w / 12w / 26w` to match. Toggling Daily↔Weekly preserves the range "position" (e.g., 30d ↔ 26w).

## [0.23.1] - 2026-04-16

### Fixed
- Featured badge no longer appears for non-featured extensions on the Overview tab. The listing and search parsers now require both card[12] and card[13] to be `1` before flagging an extension as Featured — previously card[12] alone was trusted, which produced false positives for newly published or low-traffic extensions. On the next scheduled scan, each affected extension will emit one corrective `badge_change` event reflecting the flag transitioning from true to false.

## [0.23.0] - 2026-03-31

### Improved
- Chart Y-axis labels now rotate properly instead of stacking characters vertically
- Rank chart event annotations consolidated: overlapping labels replaced with dots and counts to reduce clutter
- Rank Changes page title simplified from "All Rank & AC Changes" to "All Rank Changes" for consistency with sidebar
- "AC" badge in RankChangeItem now has tooltip "Autocomplete" for clarity
- Autocomplete chart Y-axis label spelled out as "Autocomplete Position"
- Events tab: rank change badges now color-coded green for improvements, red for drops (was all violet)
- Extension IDs truncated to 8 chars with tooltip in Compare view and Extensions tab (was showing full 32-char ID)
- Scan Logs page: added Simple/Advanced toggle — hides raw URLs, query params, and response previews by default
- Project cards show "No keywords yet" instead of "0 keywords" to guide new users
- Extensions Overview table dashes now show "No scan data for this date" tooltip
- Translation audit locale buttons: unselected state uses hover highlight instead of looking disabled
- Settings page: warns before navigating away with unsaved changes

## [0.22.0] - 2026-03-31

### Added
- Autocomplete position history chart on Overview tab ("My Autocomplete Positions" last 30 days)
- Autocomplete position history table on Overview tab with 7d/14d/30d date range, deltas, and color-coded positions

## [0.21.3] - 2026-03-31

### Fixed
- Autocomplete keywords no longer falsely show as "Out" during active crawls — only report disappeared when the keyword has actually been scanned today
- Autocomplete positions now match CWS visual dropdown order (extensions first, then text suggestions) instead of raw API array order

## [0.21.2] - 2026-03-24

### Fixed
- Scan logs now save 300-char response previews (up from 100) for better debugging
- Scan log job descriptions enriched: listing scans show extension name, keyword/AC scans show keyword ID
- Autocomplete scan logs now show "Autocomplete" label instead of raw `autocomplete_scan`
- Autocomplete scans now save "not found" snapshots (position: null) for tracked extensions not in AC results, enabling proper appeared/disappeared change detection on rank-changes page

### Added
- Type filter (All / Rank / Autocomplete) on rank-changes page with counts

## [0.21.1] - 2026-03-24

### Fixed
- Autocomplete parser now handles CWS format changes: relaxed strict `entry[0] === null` check to detect extensions by valid 32-char ID instead, and added per-entry array unwrapping for new wrapped response format (`[[null, [...]]]` → `[null, [...]]`)
- Added diagnostic logging for unrecognized autocomplete entry formats

## [0.21.0] - 2026-03-11

### Added
- Import/export data feature in Settings > Data Management
  - Export all projects, extensions, keywords, snapshots, events, and settings as JSON
  - Import from previously exported JSON file with full data replacement
  - Validation summary with record counts before import confirmation
  - Progress indicator during import showing current table
  - Date fields properly serialized/deserialized for round-trip fidelity
  - Excludes transient tables (queue, scan_logs) from export
  - Atomic import via single Dexie transaction — rolls back on any failure

## [0.20.0] - 2026-03-03

### Added
- A/B test variants for keyword audit prompts
  - **Chain-of-Thought (CoT)** variant: adds `scratchpad` reasoning field, few-shot example, reordered data layout (positions/trends first), temperature 0.4
  - **Rubric-Scored** variant: quantitative 1-5 scoring rubric with explicit weights, pre-computed comparison deltas, keyword occurrence counts, temperature 0.3
  - Variant selector dropdown in Settings > AI Audit Prompts section
  - 14 new pre-computed delta placeholders: `positionGap`, `userRatio`, `ratingDelta`, `reviewRatio`, `qualityDelta`, `screenshotDelta`, `translationDelta`, `permissionDelta`, keyword occurrence counts
  - `countKeywordOccurrences()` helper for case-insensitive whole-word matching
  - Variant-specific cache keys to prevent cross-variant cache hits
  - `auditPromptVariant` setting (`default` | `cot` | `rubric`)
  - Variant-aware model parameters (temperature, maxTokens) per variant
  - Changing variant in Settings auto-updates displayed prompt to variant defaults

### Fixed
- Rubric template Reviews row was showing rating data instead of review counts — added `ownReviewCount`/`compReviewCount` placeholders
- `positionGap` sign inversion: now embeds direction text ("6 positions behind", "3 positions ahead", "Same position") instead of raw signed number with hardcoded "positions behind" suffix. Also distinguishes "own ranked, comp not" from "both unranked" cases.
- `resetAuditPrompts` now persists `auditPromptVariant` and calls `syncLocalState()` to prevent state desync between UI and storage
- Removed unused `DEFAULT_AUDIT_SYSTEM_PROMPT` and `DEFAULT_AUDIT_USER_PROMPT_TEMPLATE` imports from SettingsPage.vue
- `ratingDelta` returns 'N/A' when either extension has no rating instead of treating null as 0 (which produced misleading deltas like +4.7)
- Deduplicated `calculateQualityScore()` calls in `buildPlaceholderValues` — now computed once per listing and reused
- Strengthened tests: pinned cache key format for backward compatibility, added missing edge cases (own ranked/comp null for positionGap, comp null rating for ratingDelta, comp zero users for userRatio), exact keyword occurrence counts, rubric placeholder substitution verification
- Version bump to 0.20.0 (MINOR) per project convention for new feature

## [0.18.0] - 2026-02-14

### Added
- Search autocomplete tracking (Phase 5.1): track whether CWS recommends extensions in search suggestions
  - New `autocomplete-v1` parser for CWS `QcU9bc` batchexecute RPC responses
  - Two suggestion types: extension suggestions (with ID, name, icon, position) and text suggestions (keyword discovery)
  - `autocomplete_scan` job type in queue builder (priority 40, runs after keyword scans)
  - Proxy `/autocomplete?q={query}&hl={locale}` endpoint (no auth required from CWS)
  - DB schema v4: `autocomplete_snapshots` and `autocomplete_keyword_suggestions` tables
  - `useAutocomplete.ts` dashboard composable with position tracking, history, and coverage data
  - Spike results documented in `SPIKE_RESULTS.md`

## [0.17.0] - 2026-02-11

### Enhanced
- Scan Logs page: richer request details and clearer pagination UX
  - HTTP method badge (GET) displayed in each log row header
  - Page number tracking for paginated keyword scan requests (page 1/2/3)
  - Pagination requests visually indented with "Page N" pill badge in indigo
  - Request parameters shown in structured key-value table in expanded details
  - New optional `httpMethod` and `pageNumber` fields on `ScanLog` (non-indexed, backwards compatible)

## [0.16.0] - 2026-02-08

### Added
- Scan logging: persist request/response details for every CWS fetch during scanning
  - New `scan_logs` IndexedDB table (schema v3) with `timestamp` and `jobId` indexes
  - `ScanLog` type captures: timestamp, request URL, HTTP status, 100-char response preview, duration, job type/detail, error info
  - Log levels: `info` (success), `warn` (HTTP 4xx), `error` (failures/network errors)
  - Proxy API keys automatically redacted (`[REDACTED]`) in logged URLs
  - DB methods: `saveScanLog()`, `getRecentScanLogs()`, `getScanLogsByJob()`, `cleanupOldScanLogs()`
  - Automated 7-day retention cleanup in daily scan alarm
  - 21 new tests (895 total passing, zero type errors)

## [0.15.2] - 2026-02-07

### Fixed
- Listing parser crash when CWS returns `null` for rating/ratingCount fields on extensions with no ratings yet. Parser now gracefully handles `null` values, setting `rating` to `null` and `ratingCount` to `0`.
- Duplicate scan data when scanning multiple times per day: same-day rescans now overwrite previous snapshots instead of accumulating duplicates
  - `saveRankSnapshots()` deletes existing records for same `keywordId+extensionId+date` before inserting
  - `saveListingSnapshot()` deletes existing record for same `extensionId+date` before inserting
  - Defensive read-time dedup in `transformSnapshots()`, `getLatestRankForKeyword()`, `loadRankDeltas()`, and `getLatestListingSnapshot()` handles pre-existing duplicate data
  - Extracted `deduplicateByDate()` shared utility to `src/shared/utils/snapshot-dedup.ts`
- 858 total tests passing, zero type errors

## [0.15.1] - 2026-02-07

### Fixed
- Rank chart not drawing lines between data points: switched x-axis from `category` to `datetime` type and converted date strings to UTC timestamps so ApexCharts properly connects points with lines and spaces dates correctly on the time axis

## [0.15.0] - 2026-02-06

### Added
- Phase 3.1: OpenAI API Client
  - `src/shared/utils/openai.ts`: OpenAI API client wrapper
    - `OpenAIClient` class with constructor accepting API key
    - `chat(messages, options)` method wrapping `/v1/chat/completions` endpoint, defaults to GPT-4o model
    - `estimateTokens(text)` static method: approximates token count (~4 chars per token)
    - `estimateCost(inputTokens, outputTokens)` static method: calculates cost using GPT-4o pricing ($2.50/1M input, $10.00/1M output)
    - `OpenAIError` class with typed error codes: `invalid_api_key`, `rate_limited`, `no_credits`, `connection_failed`, `api_error`
  - Error handling for HTTP 401 (invalid API key), 429 (rate limited), 402 (insufficient credits), `insufficient_quota` error code, and network failures
  - `optional_host_permissions` added to manifest for `https://api.openai.com/*` (requested at runtime when user enters API key)
  - `chrome.permissions` mock added to test infrastructure
  - 23 new tests: successful completion, custom options, missing usage data, empty choices, 401/429/402/quota/network/generic errors, token estimation (empty/short/long/rounding), cost calculation (zero/typical/1M tokens)
- Phase 3.2: Keyword Audit - "Why Is Competitor Higher?"
  - `src/shared/utils/keyword-audit.ts`: Audit logic and prompt construction
    - `buildAuditPrompt(input)`: Constructs system + user messages including both listings' data, keyword, positions, metrics, quality scores, permission risk
    - `estimateAuditTokens(input)`: Pre-execution cost estimate shown to user
    - `parseAuditResponse(raw)`: Parses structured JSON response with relevance analysis, metric comparison, and prioritized recommendations; graceful fallback for non-JSON responses
    - `buildCacheKey(keyword, ownExtId, compExtId, date)`: Deterministic daily cache key
    - `runKeywordAudit(client, input)`: Orchestrates prompt building, API call, response parsing, and cost calculation
  - `src/dashboard/components/ai/AuditTool.vue`: Full audit UI component
    - Keyword selector dropdown showing current positions
    - Competitor selector dropdown
    - Cost estimate display before execution
    - "Run Audit" button with loading state
    - Results display: relevance analysis, metric comparison, color-coded prioritized recommendations (high/medium/low)
    - Cache indicator for previously-run audits
    - Error handling: no API key, API errors, missing listing data
  - Updated `RankingsTab.vue`: Current positions table with contextual "Why higher?" button
    - Shows all extensions' current positions for selected keyword
    - Purple "Why higher?" button appears next to competitors ranked higher than user's extension
    - Opens AuditTool pre-populated with selected keyword and competitor
  - Database v2 migration: `audit_cache` table with `cacheKey` index for storing audit results
    - `getCachedAudit(cacheKey)`, `saveAuditResult(result)`, `clearAuditCache()` methods
    - Daily cache key prevents redundant API calls for same inputs on same day
  - 23 new keyword audit tests: prompt field inclusion (both listings, keyword, positions, metrics, quality scores), null positions/rating/quality score handling, description truncation, JSON format, token estimation, response parsing (valid JSON, markdown fences, invalid JSON fallback, empty response, missing fields, invalid priority, malformed recommendations), cache key determinism/uniqueness, audit execution, DB cache CRUD
  - 809 total tests passing, zero type errors

## [0.14.0] - 2026-02-05

### Added
- Phase 2.6: Database Migration v2 Assessment
  - Verified no v2 database migration is needed: all Phase 2 features (quality score, comparison view, keyword analysis, diff view, event annotations) compute data on-the-fly from existing v1 schema
  - `listingQualityScore` field was forward-declared in v1 types to avoid migration
  - No new stores, indexes, or schema changes required
  - `tests/unit/db/migration-v2.test.ts`: 13 new verification tests confirming v1 schema supports all Phase 2 query patterns
    - Quality score queries: `listingQualityScore` field stored and retrievable, `getLatestListingSnapshot` returns all fields needed for calculation
    - Comparison view queries: multiple extension snapshots retrievable in parallel, permissions/descriptions available without new indexes
    - Event annotation queries: `getEvents` returns events with dates/types/notes for chart annotations, multi-extension parallel loading
    - Keyword analysis queries: listing snapshots provide text data for frequency matrix, rank snapshots provide position data for difficulty estimation
    - Diff view queries: events store old/new values for text diff, permission change events store JSON arrays
    - Schema validation: all 8 v1 stores present, version is 1, populated data fully usable for all Phase 2 features
  - 763 total tests passing, zero type errors

## [0.13.0] - 2026-02-05

### Added
- Phase 2.5: Change Diff View
  - `src/shared/utils/diff.ts`: Word-level text diff algorithm
    - `computeTextDiff(oldText, newText)`: Computes word-level diff using LCS (Longest Common Subsequence) algorithm
    - `DiffSegment` interface with `type: 'equal' | 'added' | 'removed'` and `text` fields
    - Tokenizes text preserving whitespace, merges consecutive same-type segments
    - Reconstruction invariant: removed + equal = old text, added + equal = new text
    - Handles edge cases: both empty (empty array), one empty (all added/removed), identical (all equal)
  - `src/dashboard/components/comparison/DiffView.vue` (2.5.2): Text diff display component
    - Props: `oldText` and `newText`
    - Color-coded rendering: green background for added text, red background with strikethrough for removed text, normal text for equal segments
    - "No differences found" message when texts are identical
  - `src/dashboard/components/comparison/PermissionsDiff.vue` (2.5.3): Permission change display component
    - Props: `oldPermissions` and `newPermissions` string arrays
    - Added permissions shown in green with `+` prefix and install warning text
    - Removed permissions shown in red with `-` prefix and install warning text
    - Unchanged permissions shown in gray badges
    - Uses `getPermissionWarning()` from permissions utility
  - Updated `EventsTab.vue`: Expandable event detail with diff views
    - Click-to-expand on events that have old/new values
    - Chevron indicator rotates when expanded
    - Permission change events: shows `PermissionsDiff` component (parses JSON arrays)
    - Title/description change events: shows `DiffView` component with word-level diff
    - Other event types: shows generic old/new value display with colored backgrounds
  - 23 new diff tests: identical strings, completely different strings, single word change, empty inputs (both/old/new), multi-paragraph text, word additions/removals, segment merging, whitespace preservation, special characters, long identical prefix, newline handling, reconstruction invariant
  - 722 total tests passing, zero type errors
- Phase 2.4: Keyword Analysis
  - `src/shared/utils/keyword-analysis.ts`: Keyword analysis utility functions
    - `buildKeywordFrequencyMatrix(keywords, snapshots)`: Builds a matrix showing how often each tracked keyword appears in each extension's title, short description, and full description
    - `hasLowerDensity(row, ownExtensionId)`: Checks if the user's extension has lower keyword density than any competitor for a given keyword
    - `analyzeKeywordGaps(ownSnapshot, competitorSnapshots, trackedKeywords, maxResults?)`: Identifies keywords competitors use that the user's extension doesn't, with filtering of already-tracked and already-used keywords, sorted by competitor count and frequency
    - `estimateKeywordDifficulty(keywordRankings, snapshots, topN?)`: Estimates keyword difficulty based on average rating (40%), user count log-scaled (40%), and quality score (20%) of top-ranking extensions, producing a 0-100 difficulty score per keyword
  - `src/dashboard/components/tables/KeywordAnalysis.vue`: Keyword analysis component with three sections:
    - **Frequency Matrix** (2.4.2): Table with rows = tracked keywords, columns = extensions (sub-columns: Title/Short/Full), cells = occurrence counts with green highlighting for non-zero, yellow row highlight when user's extension has lower density than competitors
    - **Gap Analysis** (2.4.3): Table of suggested keywords from competitor descriptions not used by the user's extension, showing competitor count and total frequency, sorted by relevance
    - **Difficulty** (2.4.4): Table of tracked keywords with difficulty score (0-100, color-coded Easy/Medium/Hard), average rating, average user count, average quality score, and sample size from top-ranking extensions
  - Added "Analysis" tab to ProjectPage.vue tab navigation
  - 27 new tests: 6 frequency matrix (counts, multiple keywords/extensions, empty snapshots, edge cases), 4 hasLowerDensity, 7 gap analysis (competitor identification, tracked keyword filtering, own keyword filtering, sorting, maxResults, null own snapshot), 10 difficulty estimation (zero difficulty, null positions, metric averaging, topN limit, missing snapshots, null rating/quality, popular vs niche comparison, multiple keywords, score clamping)
  - 732 total tests passing, zero type errors

## [0.12.0] - 2026-02-05

### Added
- Phase 2.3: Event Detection Enhancement
  - `src/shared/utils/event-colors.ts`: Event type color scheme constants
    - `EVENT_TYPE_COLORS`: Hex color for each of the 9 event types (red: permission_change, blue: version_change, green: milestones, orange: title/description changes, gray: screenshot/translation/badge changes)
    - `EVENT_TYPE_LABELS`: Human-readable labels for each event type
    - `ALL_EVENT_TYPES`: Complete list of event types in display order
  - Updated `RankChart.vue` (2.3.1): Added event annotation support
    - New props: `events` (EventRecord[]) and `visibleEventTypes` (Set<string>)
    - Builds ApexCharts `xaxis.annotations` as color-coded vertical lines at event dates
    - Labels show event type name with matching background color
    - Only shows annotations for dates present in chart data
  - Updated `RankingsTab.vue` (2.3.2): Event type filter toggles
    - Loads events for all project extensions in parallel with rank data
    - Toggle pill buttons for each event type, styled with the event's color when active
    - Toggling a type shows/hides its annotations on the chart
    - All types visible by default
  - Refactored `EventsTab.vue` to use shared `EVENT_TYPE_LABELS` and `ALL_EVENT_TYPES` from event-colors utility (DRY)
  - 23 new tests: 11 event-colors constants, 12 rank chart annotation logic (correct dates, color per type, filter toggle, multiple events same date, empty events, empty series, multi-series dates)
- Task 4.5: Settings Page
  - `src/dashboard/composables/useSettings.ts`: Settings management composable
    - `loadSettings()`: Loads all settings from chrome.storage.local with defaults
    - `saveSetting(key, value)`: Saves individual setting with validation, returns boolean success
    - `saveMultipleSettings(partial)`: Batch save with validation
    - `testOpenAIConnection()`: Tests OpenAI API key by calling /v1/models endpoint, reports success/failure/network error
    - Reactive state: settings, loading, saving, error, successMessage, testingOpenAI, openAITestResult
  - `src/dashboard/pages/SettingsPage.vue`: Full settings page replacing placeholder
    - **Scan Settings section** (4.5.1): Daily auto-scan toggle, scan time picker (HH:MM), request delay slider (30s-5m with display), jitter slider (0-60s)
    - **API Keys section** (4.5.1, 4.5.3): OpenAI API key input with Save and Test Connection buttons, LemonSqueezy license key input, subscription status badge (Free/Pro/Expired)
    - **Data Management section** (4.5.1): Data retention slider (7-730 days) with save button
    - **Proxy Settings section**: Proxy URL and API key inputs with save button
    - **Translation Audit section** (4.5.1): 20 locale toggle buttons with visual selection state, save button
    - **About section** (4.5.1): Extension version (from manifest), parser version, last daily scan date
    - All settings validated on change via SettingsManager (4.5.2): delay >= 30s, retention >= 7 days, scan time HH:MM format, API key sk- prefix, locales non-empty
    - Success/error toast messages with auto-dismiss
  - 21 new tests: load defaults, load stored settings, save valid/invalid individual settings (queueDelayMs, dailyScanTime, dataRetentionDays, openaiApiKey, translationLocales), batch save, OpenAI connection test (no key, HTTP 200, HTTP 401, network error)
- 699 total tests passing, zero type errors

## [0.11.0] - 2026-02-05

### Added
- Phase 2.2: Listing Comparison View
  - `src/shared/utils/comparison.ts`: Comparison utility functions for side-by-side listing analysis
    - `highlightKeywords(text, keywords)`: Split text into segments with whole-word, case-insensitive keyword highlighting with merged overlapping ranges
    - `computePermissionDiff(extensionPermissions)`: Diff permissions across 2-4 extensions, identifying shared and unique-per-extension permissions
    - `computeKeywordDensityMatrix(keywords, snapshots)`: Keyword occurrence counts (title, short desc, full desc) and density per keyword per extension
    - `fleschReadingEase(text)`: Flesch Reading Ease readability score (0-100) with syllable counting heuristic
    - `readabilityLabel(score)`: Human-readable labels (Very Easy to Very Difficult)
    - `computeTextMetrics(text)`: Character count, word count, and readability score in one call
    - `countSyllables(word)` / `countSentences(text)`: Helper functions for readability calculation
  - `src/dashboard/components/comparison/ListingCompare.vue`: Full comparison view component
    - Extension selector: pick 2-4 extensions from project with color-coded indicators
    - **Title comparison** (2.2.2): Side-by-side with character count and keyword highlighting (yellow marks)
    - **Short description comparison** (2.2.2): Side-by-side with character count out of 132 limit and keyword highlighting
    - **Full description comparison** (2.2.3): Word count, character count, Flesch Reading Ease readability score with label, keyword density per tracked keyword, truncated preview
    - **Permissions comparison** (2.2.4): Risk score horizontal bar chart with color coding (green/yellow/red), shared permissions list, unique permissions per extension with warning indicators
    - **Metrics comparison** (2.2.5): Horizontal bar charts for rating (out of 5), review count, user count, screenshot count, and translation count with relative scaling
    - **Keyword density matrix** (2.2.6): Table with rows = tracked keywords, columns = extensions, cells = occurrence count in title/short desc/full desc with green highlighting for non-zero values
  - Added "Compare" tab to ProjectPage.vue tab navigation
  - 47 new tests covering keyword highlighting, permission diff, keyword density matrix, syllable/sentence counting, Flesch readability, text metrics, and integration scenarios (compare 2 extensions, self-comparison, missing data)
  - 655 total tests passing, zero type errors

## [0.10.0] - 2026-02-05

### Added
- Phase 0.3: Quality Score Calibration
  - `QUALITY_SCORE_THRESHOLDS.md`: Calibrated thresholds for all quality score components based on CWS extension analysis across productivity, developer tools, ad blockers, and VPN/security categories. Documents P25/Median/P75/P90 for title length, short description length, full description word count, screenshot count, translation count, rating, review count, and update freshness.
- Phase 2.1: Listing Quality Score
  - `src/shared/utils/quality-score.ts`: Composite 0-100 listing quality score calculator with 9 weighted components
  - **Title optimization (15%)**: Scores based on character length in optimal range (20-60 chars), penalizes empty, too short, or keyword-stuffed titles
  - **Short description (10%)**: Scores utilization of the 132-char CWS limit, optimal at 80+ chars
  - **Full description (15%)**: 70% word count scoring (optimal 150-1000 words) + 30% structure detection (paragraphs, bullet points, sections)
  - **Visual assets (15%)**: 80% screenshot count (optimal 3-5) + 20% promo video bonus
  - **Ratings & reviews (15%)**: 60% star rating quality (excellent >= 4.5, good >= 4.0) + 40% review quantity (excellent >= 100, good >= 50)
  - **Translations (10%)**: 60% locale count (excellent >= 20, good >= 10) + 40% major market coverage (16 key locales)
  - **Update freshness (10%)**: Tiered scoring from fresh (<=30d, 100pts) to abandoned (>365d, 0pts)
  - **Permissions (5%)**: Inverse of permission risk score (low risk = high quality)
  - **Developer profile (5%)**: Verified developer = 100, unverified = 40, missing = 0
  - `QualityThresholds` interface with `DEFAULT_THRESHOLDS` constant for configurable calibration
  - `QualityScoreResult` with total score, per-component breakdown (score, weight, weightedScore), and actionable recommendations
  - Recommendations generated for components scoring below 80, with priority levels (high/medium/low) and specific actionable messages (e.g., "Add 2 more screenshots to reach the optimal count of 3-5")
  - 72 new tests covering all 9 components individually, integration tests for perfect/empty listings, edge cases (null rating, unparseable dates, custom thresholds), recommendation generation and priority
  - 584 total tests passing, zero type errors

## [0.9.0] - 2026-02-05

### Added
- Phase 1.10: Integration Testing
  - `tests/integration/scan-cycle.test.ts`: 12 end-to-end integration tests covering the complete scan pipeline with mock fetch responses
  - **1.10.1** Full scan cycle: create project, add extensions/keywords, trigger scan, verify listing_snapshots saved, rank_snapshots saved, no events on first scan
  - **1.10.2** Second scan cycle: trigger second scan with changed data, verify new snapshots saved, change events detected (title_change, version_change, user_milestone)
  - **1.10.3** Queue resilience: simulate service worker restart mid-scan, verify running jobs reset to pending, scan resumes and completes
  - **1.10.4** Error handling: simulate fetch failures with retry and exponential backoff, verify terminal failure after max retries (3), SCAN_ERROR messages sent
  - **1.10.5** Extension removal: simulate 404 response, verify extension marked 'removed', job completed (not failed), historical data preserved
  - **1.10.6** Data retention: insert old snapshots, run pruning, verify old data deleted and recent data preserved; cleanup old completed/failed jobs
  - **1.10.7** Multiple projects: 2 projects sharing a competitor, verify only 1 listing_scan for shared extension (deduplication), all jobs complete
  - **1.10.8** Manual refresh: trigger refresh while scan running, verify old pending jobs cleared and new fresh jobs enqueued; project-specific refresh
  - 12 new tests, 512 total passing

## [0.8.0] - 2026-02-05

### Added
- Phase 1.7: Service Worker Entry Point
  - `src/background/index.ts`: Full service worker wiring with `chrome.runtime.onInstalled` (sets up alarms on install/update, triggers initial scan on install), `chrome.alarms.onAlarm` (dispatches `dailyScan` to `handleDailyScanAlarm()` and `processQueue` to `handleProcessQueueAlarm()`), `chrome.runtime.onMessage` (handles `TRIGGER_REFRESH`, `PAUSE_SCAN`, `RESUME_SCAN`, `CANCEL_SCAN` from Dashboard/Popup)
  - `src/background/messaging.ts`: `sendToUI(message)` wraps `chrome.runtime.sendMessage` with try/catch for silent failure when no Dashboard or Popup is listening
  - `CANCEL_SCAN` handler: deletes all pending queue jobs and clears the `processQueue` alarm
  - Unknown alarm names and unknown message types ignored gracefully
  - Async error handling with `.catch()` for all alarm dispatch calls
  - 16 new tests (11 service worker entry point, 5 messaging), 500 total passing

## [0.7.0] - 2026-02-05

### Added
- Phase 1.9: Popup
  - `usePopupState()` composable: reactive scan status, rank changes, badge management, and quick actions
  - `loadRecentRankChanges(limit)`: compares two most recent scan dates, returns top rank changes sorted by magnitude
  - `updateBadgeCount(count)` / `clearBadge()`: extension icon badge management via `chrome.action` API
  - `openDashboard()`: opens dashboard in new tab via `chrome.tabs.create`
  - `requestRefresh()` / `requestPause()` / `requestResume()`: sends messages to service worker (fail silently if no listener)
  - Full popup UI: scan status indicator (idle/running with progress bar), top 5 rank changes with up/down arrows, "30+" display for position: null, "Open Dashboard" / "Refresh Now" / "Pause/Resume" action buttons
  - Tier-aware nudge: free tier shows prominent refresh prompt when last scan > 7 days ago or no scan yet
  - Badge clears automatically when popup opens
  - 37 new tests (rank changes, badge, actions, message validation)
- Phase 1.8: Dashboard - Project Management
  - `useProjects` composable: create/delete projects, add/remove competitors with CWS URL and raw ID parsing, extension projectRef tracking, cleanup on delete
  - `useExtensions` composable: get extensions by project, get latest listing snapshot
  - `useKeywords` composable: add/remove keywords with duplicate detection (case-insensitive), project keywordIds sync
  - `useServiceWorker` composable: reactive scan progress/status/queue stats, message listening, requestRefresh/pause/resume/cancel commands
  - `useRankings` composable: load rank history and transform to ApexCharts series format with date filtering
  - `parseExtensionId()` utility: extracts 32-char IDs from CWS URLs (old and new format) or raw IDs
  - App.vue with sidebar navigation (Projects, Settings) and scan progress indicator
  - HomePage: project card grid, empty state, create project modal with URL/ID input
  - ProjectPage: tab navigation (Overview, Rankings, Extensions, Keywords, Events) with breadcrumb
  - Overview Tab: metric cards (extensions, keywords, last scan, status), recent events list, scan trigger
  - Extensions Tab: extension table with rating/users/version/updated/risk score, add/remove competitor modals
  - Keywords Tab: keyword table with rank positions per extension (color-coded), add/remove with inline form
  - Events Tab: chronological event timeline with type/extension filters, color-coded event type badges
  - Rankings Tab: keyword selector, date range picker (7/30/90/365d), ApexCharts line chart integration
  - RankChart component: inverted Y-axis (position 1 at top), multi-extension series with colors, null positions as 30+, smooth curves
  - 41 new tests (useProjects, useKeywords, useRankings)
- Phase 1.6: Queue System — persistent job queue for CWS data collection
  - **Queue Builder** (`src/background/queue-builder.ts`): `buildDailyScanJobs(projects, extensions, keywords)` creates `listing_scan` (1 per unique extension, deduplicated across projects) and `keyword_scan` (1 per keyword) jobs. Priority ordering: own extension listing (10) < competitor listing (20) < keyword scan (30). Cross-project deduplication for shared competitor extensions.
  - **Queue Processor** (`src/background/queue-processor.ts`): `processNextJob()` dequeues and executes the highest-priority pending job. Listing scans fetch CWS detail pages, parse with versioned parsers, calculate permission risk scores, save snapshots, detect events via snapshot comparison, and update extension metadata. Keyword scans fetch search results and save rank snapshots (position or null) for all tracked extensions in a single transaction. Injectable dependencies for testability.
  - **Event Detection** (`src/background/event-detector.ts`): `detectChanges(previous, current)` compares consecutive listing snapshots and generates EventRecord entries for title, description, version, permission, translation count, screenshot count, badge, rating milestone (floor change), and user milestone (1K/5K/10K/50K/100K/500K/1M thresholds) changes. Ignores whitespace-only description changes and permission reordering.
  - **Scheduler** (`src/background/scheduler.ts`): `setupAlarms()` creates recurring dailyScan alarm (24h). `handleDailyScanAlarm()` checks conditions (enabled, not scanned today), cleans up old jobs (completed >7d, failed >30d), builds and enqueues jobs. `handleProcessQueueAlarm()` resets interrupted running jobs, processes one job, schedules next alarm with delay. `triggerManualRefresh(projectId?)` clears pending jobs and starts fresh scan. `pauseScanning()`/`resumeScanning()` toggle daily scan setting.
  - Error handling: HTTP 429/5xx/network/parser errors → retriable with exponential backoff (2min, 4min, 8min, max 10min). HTTP 404 on listing → marks extension 'removed', job completed. Max retries (3) exceeded → terminal failure. Delay between jobs: configurable base (60s) +/- random jitter (10s).
  - 67 new tests (10 queue builder, 23 event detector, 21 queue processor, 13 scheduler)

## [0.6.0] - 2026-02-05

### Added
- Phase 1.5: Utility Functions
  - `calculatePermissionRiskScore(permissions, hostPermissions)`: 0-100 risk score using PRD-defined weights (all_urls: 30, history: 25, tabs: 20, bookmarks/webRequest/cookies: 15, activeTab: 5, storage/alarms/notifications: 0). Broad host permissions treated as all_urls, narrow hosts get low weight (5). Score clamped to 100.
  - `getPermissionWarning(permission)`: returns install warning text for a permission, or null
  - `categorizePermissions(permissions)`: groups permissions by risk level (high/medium/low/none)
  - `levenshteinDistance(a, b)` and `levenshteinSimilarity(a, b)`: edit distance and 0-1 normalized similarity
  - `countKeywordOccurrences(text, keyword)`: whole-word, case-insensitive occurrence count
  - `keywordDensity(text, keyword)`: keyword occurrences divided by total word count
  - `extractKeywords(text, minLength?)`: extract word frequencies excluding English stop words
  - `today()`, `daysAgo(n)`, `isToday(dateStr)`, `daysBetween(dateA, dateB)`: YYYY-MM-DD date helpers
  - 86 new tests (30 permissions, 36 text-analysis, 20 dates), 339 total passing

## [0.5.0] - 2026-02-05

### Changed
- Phase 1.4: CWS Parsers formalized with full ListingData interface and factory
  - `ListingData` interface updated to align with `ListingSnapshot`: added `fullDescription`, `rating` nullable for no-review extensions, `userCount` (formatted string) + `userCountNumeric`, `lastUpdated` as YYYY-MM-DD string, `permissions`/`hostPermissions` (extracted from manifest JSON), `screenshotCount`, `translationCount`, `availableLocales`, `developerName`, `developerVerified`, `badgeFlags`, `hasPromoVideo`, `reviewCount`
  - `parseUserCount()` helper: converts display strings ("9,000+", "1K+", "5M+") to numeric values
  - `parseManifestPermissions()`: extracts `permissions` and `host_permissions` arrays from manifest JSON
  - Parser factory (`getListingParser()`, `getSearchParser()`): selects correct parser version by string, with `getAvailableListingParsers()`/`getAvailableSearchParsers()` discovery
  - Updated `ListingSnapshot` field mapping table in types/index.ts to reflect direct field alignment
  - 40 new tests (parseUserCount, permissions extraction, badge flags, factory, edge cases), 253 total passing

## [0.4.0] - 2026-02-05

### Added
- Phase 1.3: Settings Manager
  - `SettingsManager` class wrapping `chrome.storage.local` with `get`, `set`, `setMultiple`, `getAll`, `getWithDefaults`
  - `DEFAULT_SETTINGS` constant with all defaults from PRD Section 4.2 / 5.3.6
  - Settings validation: `queueDelayMs` >= 30000, `dataRetentionDays` >= 7, `queueJitterMs` >= 0, `dailyScanTime` HH:MM format, `translationLocales` array check
  - `SettingsValidationError` for clear error reporting
  - 15 default translation locales (en, es, fr, de, pt_BR, ja, zh_CN, ko, ru, ar, hi, it, nl, pl, tr)
  - 25 new tests covering defaults, get/set, setMultiple, validation edge cases

## [0.3.0] - 2026-02-05

### Added
- Phase 1.2: Dexie.js Database Layer
  - `CWSDatabase` class extending Dexie with typed tables for all 8 stores
  - Version 1 schema with compound indexes: `[extensionId+date]`, `[keywordId+extensionId+date]`, `[status+scheduledAt]`
  - Project CRUD: `getProject`, `getAllProjects`, `saveProject`, `deleteProject`
  - Extension CRUD: `getExtension`, `saveExtension`, `deleteExtension`, `getOrphanedExtensions`
  - Keyword methods: `getKeywordsByProject`, `saveKeyword`, `deleteKeyword`
  - Listing snapshot methods: `getListingSnapshots` (date range), `getLatestListingSnapshot`, `saveListingSnapshot`
  - Rank snapshot methods: `getRankSnapshots` (date range), `getLatestRankForKeyword`, `saveRankSnapshots` (atomic batch)
  - Event methods: `getEvents` (date range), `getRecentEvents` (limit), `saveEvent`
  - Queue methods: `enqueueJobs`, `dequeueNext` (priority + scheduledAt), `updateJobStatus`, `getRunningJobs`, `resetRunningJobs`, `getPendingCount`, `getQueueStats`, `cleanupOldJobs`
  - Bulk data management: `deleteExtensionData` (transactional), `pruneOldSnapshots`
  - Singleton `db` export for app-wide use
  - 69 new tests (schema, CRUD verification, domain queries, edge cases)

## [0.2.0] - 2026-02-05

### Added
- Phase 1.1: TypeScript types and interfaces
  - Core data models: Project, Extension, Keyword, ListingSnapshot, RankSnapshot, EventRecord, QueueJob, TranslationSnapshot
  - ManipulationFlags interface for translation audit detection (8 trick types)
  - Service Worker ↔ Dashboard message types with discriminated unions
  - Settings interface for chrome.storage.local configuration
  - Queue job payload types (ListingScanPayload, KeywordScanPayload, TranslationAuditPayload)
  - String literal union types for EventType, QueueJobType, QueueJobStatus, ExtensionStatus, SubscriptionStatus

## [0.1.0] - 2026-02-05

### Added
- Phase 0.1: CWS response format investigation - documented parsing strategy in SPIKE_RESULTS.md
- Phase 0.2: Prototype parsers for CWS listing detail and search results pages
- Phase 0.4: Project scaffolding and test infrastructure
  - Vue 3 + Vite + CRXJS v2.3.0 build pipeline
  - Chrome MV3 manifest with popup and service worker entry points
  - Dashboard Vue app with Vue Router (Home, Project, Settings pages)
  - Popup Vue app with placeholder status UI
  - Tailwind CSS v4 for styling
  - Vitest + fake-indexeddb test infrastructure
  - Chrome API mocks (storage, alarms, runtime, action, tabs) with call recording
  - Dexie.js integration verified with fake-indexeddb
  - ApexCharts + vue3-apexcharts installed
  - 103 tests passing, zero type errors
