# Changelog

All notable changes to CWS Tracker will be documented in this file.

## [0.19.2] - 2026-03-02

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
