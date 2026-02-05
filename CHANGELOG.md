# Changelog

All notable changes to CWS Tracker will be documented in this file.

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
