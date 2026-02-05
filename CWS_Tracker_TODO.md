# CWS Tracker - Detailed Implementation Plan

## Implementation Principles

**Testing Strategy:**
- Use **Vitest** as the test runner (native Vite integration, fast, TypeScript-native)
- Use **fake-indexeddb** (`fake-indexeddb/auto`) for IndexedDB tests - no browser required
- Mock all `chrome.*` APIs using a shared mock module (`tests/mocks/chrome.ts`)
- Save real CWS HTML responses as fixtures during Phase 0 for deterministic parser tests
- Every task group below includes specific test requirements with edge cases
- Tests should be written BEFORE or ALONGSIDE implementation, not after
- Aim for high coverage on critical paths (parsers, queue, DB) and reasonable coverage on UI

**Dependency Notation:** Tasks marked with `[depends: X.Y]` cannot start until that task is complete.

**Estimation:** Hours are rough estimates for a single developer familiar with the stack.

---

## Phase 0 - Technical Spike (1-2 days)

### 0.1 CWS Response Format Investigation

- [x] **0.1.1** Create a minimal MV3 extension with just a service worker and `host_permissions` for `chrome.google.com/webstore/*`
- [x] **0.1.2** From the service worker, `fetch()` a CWS extension detail page (use a known extension like uBlock Origin). Save the raw response to inspect.
- [x] **0.1.3** Inspect the response: Is it server-rendered HTML? Is data in `<script>` tags as JSON? Is it an empty shell requiring JS execution?
- [x] **0.1.4** From the service worker, `fetch()` a CWS search results page (`chrome.google.com/webstore/search/ad%20blocker`). Save the raw response.
- [x] **0.1.5** Inspect the search response: same questions as above.
- [x] **0.1.6** Test with different `Accept-Language` headers (en-US, ja, es). Does the response structure change? Does content language change?
- [x] **0.1.7** Test with `?hl=ja` parameter on a detail page. Is the localized content returned?
- [x] **0.1.8** Test fetching a non-existent extension ID. What HTTP status and body are returned?
- [x] **0.1.9** Test fetching with rapid requests (5 requests, 10s apart). Does CWS return 429 or block?
- [x] **0.1.10** Document findings in a `SPIKE_RESULTS.md` file: response format per page type, parsing strategy decision, locale behavior, rate limit observations.
- [x] **0.1.11** Save 5+ real CWS response files as test fixtures: detail page (en), detail page (ja), detail page (404), search results page, search results page (no results). These become the foundation for all parser tests.

**Decision Gate:** If CWS requires JS execution to render (Scenario C), STOP and revise architecture to content-script approach before proceeding.

### 0.2 Prototype Parsers

- [x] **0.2.1** Write a minimal listing parser function that extracts title from a saved CWS response fixture. Validate the approach works.
- [x] **0.2.2** Extend to extract all listing fields (description, rating, users, etc.). Note any fields that are difficult or impossible to extract.
- [x] **0.2.3** Write a minimal search parser that extracts extension IDs and their order from a search results fixture.
- [x] **0.2.4** Document any fields that cannot be reliably extracted. Update PRD if features depend on unobtainable data.

### 0.3 Quality Score Calibration

- [ ] **0.3.1** Select 30 extensions across 3-4 categories (e.g., productivity, developer tools, ad blockers, VPN). Mix of top-ranked and mid-ranked.
- [ ] **0.3.2** For each extension, record: title length (chars), short description length (chars), full description word count, screenshot count, translation count, rating, review count, user count, last updated date.
- [ ] **0.3.3** Calculate median, P25, P75, and P90 for each metric.
- [ ] **0.3.4** Define quality score thresholds based on actual data. Document in `QUALITY_SCORE_THRESHOLDS.md`.
- [ ] **0.3.5** Verify CWS short description max character limit (check CWS developer docs and actual listings).

### 0.4 Test Infrastructure Setup

- [x] **0.4.1** Initialize the project: `npm create vite@latest cws-tracker -- --template vue-ts`
- [x] **0.4.2** Install and configure CRXJS Vite Plugin (`@crxjs/vite-plugin`). Verify dev build + HMR works for popup and dashboard.
- [x] **0.4.3** Install and configure Vitest. Create `vitest.config.ts`.
- [x] **0.4.4** Install `dexie` and `fake-indexeddb`. Verify Dexie works with fake-indexeddb: open a database, define a table, write and read a record.
- [x] **0.4.5** Create `tests/mocks/chrome.ts` - mock module for `chrome.storage.local`, `chrome.alarms`, `chrome.runtime.sendMessage`, `chrome.runtime.onMessage`, `chrome.runtime.onInstalled`. Each mock should record calls and allow assertions.
- [x] **0.4.6** Create `tests/fixtures/` directory. Move saved CWS HTML responses here.
- [x] **0.4.7** Install Tailwind CSS v4. Configure via `@tailwindcss/vite` plugin and CSS imports.
- [x] **0.4.8** Install Vue Router. Create minimal router setup. (No Pinia - use composables with `ref`/`reactive` for state.)
- [x] **0.4.9** Install ApexCharts + vue3-apexcharts. Verify a basic chart renders in dashboard.
- [x] **0.4.10** Create the manifest.json source template. Verify CRXJS builds a loadable extension.
- [x] **0.4.11** Verify the extension loads in Chrome, popup opens, dashboard page opens.

**Phase 0 Exit Criteria:**
- [x] Parsing strategy confirmed and documented
- [x] Test fixtures saved
- [ ] Quality score thresholds calibrated
- [x] Project scaffolding complete and building
- [x] Test infrastructure working (Vitest + fake-indexeddb + chrome mocks)
- [x] Extension loads in Chrome with blank popup + blank dashboard

---

## Phase 1 - Core MVP (4-6 weeks)

### 1.1 TypeScript Types & Interfaces (~2h)

- [x] **1.1.1** Create `src/shared/types/index.ts` - define all TypeScript interfaces:
  - `Project`
  - `Extension`
  - `Keyword`
  - `ListingSnapshot`
  - `RankSnapshot`
  - `EventRecord` (avoid name collision with DOM `Event`)
  - `QueueJob`
  - `ManipulationFlags` (define now even though used in Phase 3 - prevents migration headaches)
  - `TranslationSnapshot`
- [x] **1.1.2** Create `src/shared/types/messages.ts` - define message types:
  - `ScanProgressMessage`
  - `ScanCompleteMessage`
  - `NewEventMessage`
  - `ScanErrorMessage`
  - `QueueStatusMessage`
  - `TriggerRefreshMessage`
  - `PauseScanMessage`
  - `ResumeScanMessage`
  - `CancelScanMessage`
  - Union type `ServiceWorkerMessage` and `DashboardMessage`
- [x] **1.1.3** Create `src/shared/types/settings.ts` - define `Settings` interface matching Section 4.2 of PRD.

**Tests: None needed (type-only, compiler validates).**

---

### 1.2 Dexie.js Database Layer (~6-8h) [depends: 1.1]

This is the foundation. Everything else depends on it. Build it carefully and test thoroughly.

#### 1.2.1 Schema & Database Class

- [x] **1.2.1.1** Install Dexie: `npm install dexie`
- [x] **1.2.1.2** Create `src/shared/db/database.ts` - `CWSDatabase` class extending `Dexie`:
  - Typed table properties: `projects!: Table<Project>`, `extensions!: Table<Extension>`, etc.
  - Version 1 schema in constructor via `this.version(1).stores({...})` defining all stores with their indexed fields
  - Stores: `projects`, `extensions`, `keywords`, `listing_snapshots`, `rank_snapshots`, `events`, `translation_snapshots`, `queue`
  - Compound indexes use `[field1+field2]` Dexie syntax (e.g., `[extensionId+date]`)
  - Auto-increment primary keys use `++id` prefix
- [x] **1.2.1.3** Export a singleton `db` instance for import across the app

**Tests (schema) - use fake-indexeddb:**
- [x] DB opens successfully, all tables accessible
- [x] Verify each table exists with correct primary key
- [x] Verify compound indexes work (e.g., query `listing_snapshots` by `[extensionId+date]`)
- [x] Future migration (simulate): v1 -> v2 adds new index, existing data preserved
- [x] Edge case: v1 -> v3 upgrade applies both v2 and v3 changes

#### 1.2.2 CRUD & Query Verification

Dexie provides CRUD out of the box (`table.add()`, `.get()`, `.put()`, `.delete()`, `.toArray()`, `.where()`, `.between()`). No wrapper methods needed - just verify Dexie's API works correctly with our schema and types.

**Tests (CRUD via Dexie API) - use fake-indexeddb:**
- [x] `table.add()`: insert a record, verify via `table.get()`
- [x] `table.add()`: inserting duplicate key throws `ConstraintError`
- [x] `table.get()`: returns `undefined` for non-existent key
- [x] `table.put()`: updates existing record (upsert)
- [x] `table.delete()`: removes record
- [x] `table.delete()`: deleting non-existent key does not throw
- [x] `table.toArray()`: returns all records
- [x] `table.toArray()`: returns empty array for empty table
- [x] `table.where(index).equals(value)`: returns correct records
- [x] `table.where(index).between(lower, upper)`: range query works with compound index
- [x] `table.where(index).between()`: returns empty array when no records in range
- [x] `table.count()`: returns correct count
- [x] `table.clear()`: removes all records
- [x] `db.transaction('rw', [table1, table2], async () => {...})`: commits on success
- [x] `db.transaction()`: aborts on error, no partial writes
- [x] Concurrent reads from different tables don't deadlock

#### 1.2.3 Domain-Specific Query Methods

- [x] **1.2.3.1** `getProject(id)`, `getAllProjects()`, `saveProject(project)`, `deleteProject(id)`
- [x] **1.2.3.2** `getExtension(id)`, `saveExtension(extension)`, `deleteExtension(id)`, `getOrphanedExtensions()` (where projectRefs is empty)
- [x] **1.2.3.3** `getKeywordsByProject(projectId)`, `saveKeyword(keyword)`, `deleteKeyword(id)`
- [x] **1.2.3.4** `getListingSnapshots(extensionId, startDate, endDate)`, `getLatestListingSnapshot(extensionId)`, `saveListingSnapshot(snapshot)`
- [x] **1.2.3.5** `getRankSnapshots(keywordId, extensionId, startDate, endDate)`, `getLatestRankForKeyword(keywordId)`, `saveRankSnapshots(snapshots[])` - note: saves multiple in one transaction (one search yields multiple rank records)
- [x] **1.2.3.6** `getEvents(extensionId, startDate, endDate)`, `getRecentEvents(limit)`, `saveEvent(event)`
- [x] **1.2.3.7** Queue methods: `enqueueJobs(jobs[])`, `dequeueNext()` (highest priority pending job), `updateJobStatus(id, status, error?)`, `getRunningJobs()`, `resetRunningJobs()`, `getPendingCount()`, `getQueueStats()` (counts by status), `cleanupOldJobs(completedBeforeDate, failedBeforeDate)`
- [x] **1.2.3.8** `deleteExtensionData(extensionId)` - deletes all listing_snapshots, rank_snapshots, events, translation_snapshots for an extension in a single `db.transaction()`
- [x] **1.2.3.9** `pruneOldSnapshots(beforeDate)` - data retention cleanup

**Tests (domain queries):**
- [x] `getListingSnapshots()`: returns snapshots in date range, excludes out-of-range
- [x] `getLatestListingSnapshot()`: returns most recent snapshot, returns `undefined` if none
- [x] `saveRankSnapshots()`: saves multiple records atomically
- [x] `dequeueNext()`: returns highest priority (lowest number) pending job
- [x] `dequeueNext()`: returns `null` when no pending jobs
- [x] `dequeueNext()`: skips jobs where `scheduledAt` is in the future
- [x] `resetRunningJobs()`: sets all 'running' jobs back to 'pending'
- [x] `cleanupOldJobs()`: deletes completed jobs older than threshold, keeps recent ones
- [x] `cleanupOldJobs()`: deletes failed terminal jobs older than threshold
- [x] `deleteExtensionData()`: removes all related data across all tables in one transaction
- [x] `pruneOldSnapshots()`: removes snapshots older than date, keeps newer ones
- [x] Edge case: queries on empty tables return empty arrays, not errors
- [x] Edge case: date range where start === end returns records from that exact date

---

### 1.3 Settings Manager (~3h) [depends: 1.1]

- [x] **1.3.1** Create `src/shared/utils/settings.ts` - `SettingsManager` class wrapping `chrome.storage.local`:
  - `get(key)` - get single setting
  - `getAll()` - get all settings
  - `set(key, value)` - set single setting
  - `setMultiple(partial)` - set multiple settings
  - `getWithDefaults()` - returns all settings with defaults applied for missing values
- [x] **1.3.2** Define `DEFAULT_SETTINGS` constant with all default values from PRD Section 4.2.
- [x] **1.3.3** Implement settings validation: `queueDelayMs` must be >= 30000, `dataRetentionDays` must be >= 7, etc.

**Tests (use chrome.storage.local mock):**
- [x] `getAll()`: returns defaults when storage is empty
- [x] `set()` then `get()`: returns the set value
- [x] `setMultiple()`: sets multiple keys atomically
- [x] `getWithDefaults()`: merges stored values with defaults (stored values win)
- [x] Validation: setting `queueDelayMs` to 5000 throws/rejects
- [x] Validation: setting `dataRetentionDays` to 0 throws/rejects
- [x] Edge case: `get()` for non-existent key returns default value

---

### 1.4 CWS Parsers (~8-10h) [depends: 0.1, 0.2, 1.1]

These operate on saved HTML/JSON fixtures from Phase 0. Parser interface ensures swappability.

#### 1.4.1 Parser Interface & Factory

- [x] **1.4.1.1** Create `src/background/parsers/types.ts`:

```typescript
interface ListingData {
  title: string;
  shortDescription: string;
  fullDescription: string;
  rating: number | null;
  ratingCount: number;
  reviewCount: number;
  userCount: string;
  userCountNumeric: number;
  version: string;
  lastUpdated: string;
  size: string;
  permissions: string[];
  hostPermissions: string[];
  screenshotCount: number;
  hasPromoVideo: boolean;
  translationCount: number;
  availableLocales: string[];
  category: string;
  developerName: string;
  developerVerified: boolean;
  badgeFlags: Record<string, boolean>;
}

interface SearchResultData {
  extensionIds: string[];   // Ordered list of extension IDs in search results
  totalResults: number;
}

interface ListingParser {
  parse(response: string): ListingData;
  version: string;
}

interface SearchParser {
  parse(response: string): SearchResultData;
  version: string;
}

// Errors
class ParserError extends Error {
  constructor(
    message: string,
    public parserVersion: string,
    public field?: string
  ) { super(message); }
}
```

- [x] **1.4.1.2** Create parser factory that returns the correct parser version based on settings.

#### 1.4.2 Listing Parser Implementation

- [x] **1.4.2.1** Implement `ListingParserV1` based on Phase 0 spike findings. If CWS returns HTML, use DOMParser. If JSON in script tags, use regex + JSON.parse.
- [x] **1.4.2.2** Implement `parseUserCount(text: string): number` helper. Handles "9,000+", "10,000,000+", "1K+", "0 users", etc.
- [x] **1.4.2.3** Implement extraction for each field. For fields that might be missing, return sensible defaults (null for rating if no reviews, 0 for counts, empty arrays for lists).
- [x] **1.4.2.4** Add validation: after parsing, check for required fields (title, extensionId). If missing, throw `ParserError` indicating possible CWS format change.

**Tests (listing parser) - use fixtures from Phase 0:**
- [x] Parse a normal extension listing: all fields extracted correctly
- [x] Parse an extension with no reviews: `rating` is null, `ratingCount` is 0
- [x] Parse an extension with no screenshots: `screenshotCount` is 0
- [x] Parse an extension with no translations: `translationCount` is 0 or 1 (English only)
- [x] Parse a 404 response: throws `ParserError` with descriptive message
- [x] Parse a truncated/malformed response: throws `ParserError`, doesn't crash
- [x] Parse an empty string: throws `ParserError`
- [x] `parseUserCount("9,000+")` returns 9000
- [x] `parseUserCount("10,000,000+")` returns 10000000
- [x] `parseUserCount("0")` returns 0
- [x] `parseUserCount("")` returns 0
- [x] `parseUserCount("1K+")` returns 1000 (if CWS uses this format)
- [x] Parse extension with broad host permissions `<all_urls>`: correctly in `hostPermissions`
- [x] Parse extension with Featured badge: `badgeFlags.featured` is true
- [x] Parse extension with no badges: all `badgeFlags` are false

#### 1.4.3 Search Parser Implementation

- [x] **1.4.3.1** Implement `SearchParserV1` - extracts ordered list of extension IDs from search results.
- [x] **1.4.3.2** Extract total result count if available.

**Tests (search parser):**
- [x] Parse search results page: returns correct ordered list of extension IDs
- [x] Position is 1-based (first result = position 1)
- [x] Parse search with no results: returns empty array, totalResults = 0
- [x] Parse search with single result: returns array of 1
- [x] Parse truncated search response: throws `ParserError`
- [x] Extension IDs are correctly extracted (no URL fragments, no whitespace)

---

### 1.5 Utility Functions (~4-6h) [depends: 1.1]

#### 1.5.1 Permission Risk Scoring

- [x] **1.5.1.1** Create `src/shared/utils/permissions.ts`:
  - `calculatePermissionRiskScore(permissions: string[], hostPermissions: string[]): number`
  - `getPermissionWarning(permission: string): string | null` - returns the install warning text
  - `categorizePermissions(permissions: string[]): { high: string[], medium: string[], low: string[], none: string[] }`

**Tests:**
- [x] No permissions: score = 0
- [x] Only `storage` and `alarms`: score = 0
- [x] `<all_urls>`: score includes weight 30
- [x] `tabs` + `history`: scores are additive
- [x] Score never exceeds 100 (clamped)
- [x] Broad host permission (`*://*/*`): treated same as `<all_urls>`
- [x] Narrow host permission (`https://example.com/*`): low weight
- [x] Unknown permission: weight = 0, doesn't crash
- [x] `categorizePermissions()`: correctly groups by risk level
- [x] Empty arrays: returns score 0, empty categories

#### 1.5.2 Text Analysis Utilities

- [x] **1.5.2.1** Create `src/shared/utils/text-analysis.ts`:
  - `levenshteinDistance(a: string, b: string): number`
  - `levenshteinSimilarity(a: string, b: string): number` - returns 0-1 normalized similarity
  - `countKeywordOccurrences(text: string, keyword: string): number` - case-insensitive, whole-word
  - `extractKeywords(text: string, minLength?: number): Map<string, number>` - extract words with frequencies
  - `keywordDensity(text: string, keyword: string): number` - occurrences / total words

**Tests:**
- [x] `levenshteinDistance("kitten", "sitting")` = 3
- [x] `levenshteinDistance("", "abc")` = 3
- [x] `levenshteinDistance("abc", "abc")` = 0
- [x] `levenshteinSimilarity("abc", "abc")` = 1.0
- [x] `levenshteinSimilarity("", "")` = 1.0 (edge case: both empty)
- [x] `countKeywordOccurrences("ad blocker blocks ads", "ad")` = 1 (whole word only, not "ads")
- [x] `countKeywordOccurrences("", "test")` = 0
- [x] `countKeywordOccurrences("test test TEST", "test")` = 3 (case insensitive)
- [x] `keywordDensity()`: correct ratio for known text
- [x] `keywordDensity()` of empty text: returns 0, no division by zero
- [x] `extractKeywords()`: returns correct frequency map
- [x] `extractKeywords()`: ignores common stop words (the, a, is, etc.)

#### 1.5.3 Date Utilities

- [x] **1.5.3.1** Create `src/shared/utils/dates.ts`:
  - `today(): string` - returns YYYY-MM-DD
  - `daysAgo(n: number): string` - returns YYYY-MM-DD for n days ago
  - `isToday(dateStr: string): boolean`
  - `daysBetween(dateA: string, dateB: string): number`

**Tests:**
- [x] `today()` returns correct format
- [x] `daysAgo(0)` equals `today()`
- [x] `daysAgo(1)` returns yesterday
- [x] `isToday()` returns true for today, false for yesterday
- [x] `daysBetween("2026-01-01", "2026-01-10")` = 9
- [x] `daysBetween()` works across month/year boundaries

---

### 1.6 Queue System (~10-14h) [depends: 1.2, 1.3, 1.4, 1.5]

This is the most complex and critical subsystem. Test exhaustively.

#### 1.6.1 Queue Builder

- [x] **1.6.1.1** Create `src/background/queue-builder.ts`:
  - `buildDailyScanJobs(projects: Project[], extensions: Extension[]): QueueJob[]`
  - Creates `listing_scan` jobs: 1 per unique extension across all projects
  - Creates `keyword_scan` jobs: 1 per unique keyword across all projects
  - Assigns priorities: listing scans before keyword scans; own extensions before competitors
  - Deduplicates: if same extension appears in multiple projects, only one listing_scan
  - Sets `scheduledAt` to now, `status` to 'pending', `retryCount` to 0

**Tests:**
- [x] Single project, 1 extension, 2 keywords: creates 3 jobs (1 listing + 2 keyword)
- [x] Single project, 5 extensions (1 own + 4 competitors), 10 keywords: creates 15 jobs
- [x] Two projects sharing the same competitor extension: only 1 listing_scan for that extension (deduplication)
- [x] Two projects with the same keyword text: creates 2 keyword_scan jobs (no dedup - different keywordIds, see PRD note)
- [x] Priority ordering: own extension listing_scan < competitor listing_scan < keyword_scan
- [x] Empty project (no extensions, no keywords): creates 0 jobs
- [x] Project with extensions but no keywords: creates only listing_scan jobs
- [x] All jobs have correct initial status, retryCount, scheduledAt

#### 1.6.2 Queue Processor

- [x] **1.6.2.1** Create `src/background/queue-processor.ts`:
  - `processNextJob(): Promise<{ hasMore: boolean; delayMs: number }>`
  - Dequeues next pending job from DB
  - If no job, returns `{ hasMore: false, delayMs: 0 }`
  - Executes the job based on type (calls appropriate fetcher + parser)
  - On success: marks completed, sends progress message
  - On failure: increments retry, calculates backoff, or marks terminal failure
  - Returns `{ hasMore: true, delayMs: calculatedDelay }` for the next alarm
- [x] **1.6.2.2** Implement `processListingScan(job)`:
  - Fetch CWS detail page for `job.payload.extensionId`
  - Parse response with listing parser
  - Calculate permission risk score
  - Save `listing_snapshot`
  - Compare with previous snapshot, create `events` if changes detected
  - Update `extension.lastScannedAt`
- [x] **1.6.2.3** Implement `processKeywordScan(job)`:
  - Fetch CWS search page for `job.payload.keyword`
  - Parse response with search parser
  - For each tracked extension in the project: create a `rank_snapshot` with position (or null)
  - Save all rank_snapshots in a single transaction
- [x] **1.6.2.4** Implement delay calculation:
  - Normal: `queueDelayMs + randomJitter(-jitterMs, +jitterMs)`
  - Retry: `min(baseDelay * 2^retryCount, 600000)` (max 10 min)
- [x] **1.6.2.5** Implement error classification:
  - HTTP 429: retriable (rate limited)
  - HTTP 404: for listing_scan, mark extension as 'removed', job completed (not an error)
  - HTTP 5xx: retriable (server error)
  - Network error: retriable
  - ParserError: retriable (CWS may have changed temporarily)
  - Unknown error: retriable

**Tests (queue processor) - mock fetch + parsers:**
- [x] Happy path: listing_scan job fetches, parses, saves snapshot, returns hasMore=true
- [x] Happy path: keyword_scan job fetches, parses, saves rank_snapshots for all tracked extensions
- [x] keyword_scan: extension found at position 5 - rank_snapshot has position=5
- [x] keyword_scan: extension NOT found in results - rank_snapshot has position=null
- [x] keyword_scan: 3 tracked extensions, 1 found at pos 3, 1 at pos 15, 1 not found - all 3 snapshots saved correctly
- [x] HTTP 429: job retried, retryCount incremented, delay is 2x
- [x] HTTP 404 on listing_scan: extension marked 'removed', job completed (not failed)
- [x] HTTP 500: job retried with backoff
- [x] Network error (fetch throws): job retried
- [x] ParserError: job retried
- [x] Max retries exceeded: job marked 'failed' terminal, error message saved
- [x] Backoff delays: retry 1 = 2min, retry 2 = 4min, retry 3 = 8min
- [x] Delay never exceeds 10 minutes (600000ms)
- [x] No pending jobs: returns hasMore=false
- [x] Job with `scheduledAt` in the future: skipped (not yet ready)
- [x] Random jitter: delay varies between calls (test with seed or just verify range)
- [x] Edge case: job payload is malformed - handled gracefully, marked failed

#### 1.6.3 Event Detection

- [x] **1.6.3.1** Create `src/background/event-detector.ts`:
  - `detectChanges(previous: ListingSnapshot | null, current: ListingSnapshot): EventRecord[]`
  - Compare each tracked field between consecutive snapshots
  - Return an array of events (may be 0, 1, or multiple events for a single snapshot comparison)
- [x] **1.6.3.2** Implement detection for each event type:
  - Title change: `previous.title !== current.title`
  - Short description change: `previous.shortDescription !== current.shortDescription`
  - Full description change: `previous.fullDescription !== current.fullDescription`
  - Version change: `previous.version !== current.version`
  - Permission change: compare sorted arrays
  - Translation count change: `previous.translationCount !== current.translationCount`
  - Screenshot count change: `previous.screenshotCount !== current.screenshotCount`
  - Badge change: compare badge flags objects
  - Rating milestone: floor(previous.rating) !== floor(current.rating)
  - User milestone: crosses 1K, 5K, 10K, 50K, 100K, 500K, 1M thresholds
- [x] **1.6.3.3** Generate human-readable `note` for each event: e.g., "Title changed from 'Old Title' to 'New Title'"

**Tests (event detector):**
- [x] No previous snapshot (first scan): returns empty array (no events)
- [x] Identical snapshots: returns empty array
- [x] Title changed: returns 1 title_change event with correct old/new values
- [x] Multiple changes simultaneously: returns multiple events (e.g., title + version)
- [x] Permission added: event contains the added permission name
- [x] Permission removed: event contains the removed permission name
- [x] Permissions reordered but same set: no event triggered
- [x] Rating 3.9 -> 4.0: triggers rating_milestone
- [x] Rating 4.0 -> 4.1: no milestone (same floor)
- [x] Rating 4.0 -> null (reviews deleted?): handled gracefully
- [x] Users 9500 -> 10000: triggers user_milestone at 10K
- [x] Users 10000 -> 10500: no milestone
- [x] Users 900 -> 1000: triggers user_milestone at 1K
- [x] Badge added: triggers badge_change
- [x] Description whitespace-only change: decide - trigger or ignore? (Recommend: ignore whitespace-only changes)

#### 1.6.4 Scheduler

- [x] **1.6.4.1** Create `src/background/scheduler.ts`:
  - `setupAlarms()` - called on install/startup
  - `handleDailyScanAlarm()` - called when dailyScan alarm fires
  - `handleProcessQueueAlarm()` - called when processQueue alarm fires
  - `triggerManualRefresh(projectId?: string)` - manual scan trigger
  - `pauseScanning()` / `resumeScanning()`
- [x] **1.6.4.2** In `handleDailyScanAlarm()`:
  - Check `dailyScanEnabled` setting, return early if disabled
  - Check `lastDailyScanDate`, return early if already scanned today
  - Run queue cleanup (completed > 7 days, failed > 30 days)
  - Build jobs via queue builder
  - Enqueue jobs
  - Set first `processQueue` alarm with 1 minute delay
- [x] **1.6.4.3** In `handleProcessQueueAlarm()`:
  - Reset any 'running' jobs to 'pending' (service worker may have restarted)
  - Call `processNextJob()`
  - If `hasMore`, schedule next `processQueue` alarm with returned delay
  - If `!hasMore`, update `lastDailyScanDate`, send `SCAN_COMPLETE` message
- [x] **1.6.4.4** In `triggerManualRefresh()`:
  - Clear all pending jobs from queue
  - Build new jobs (for specific project or all projects)
  - Enqueue and start processing

**Tests (scheduler) - mock chrome.alarms + DB:**
- [x] `setupAlarms()`: creates dailyScan alarm with `delayInMinutes: 1` and `periodInMinutes: 1440`
- [x] `handleDailyScanAlarm()`: skips if `dailyScanEnabled` is false
- [x] `handleDailyScanAlarm()`: skips if `lastDailyScanDate` is today
- [x] `handleDailyScanAlarm()`: builds and enqueues jobs when conditions met
- [x] `handleProcessQueueAlarm()`: resets running jobs before processing
- [x] `handleProcessQueueAlarm()`: schedules next alarm after successful job
- [x] `handleProcessQueueAlarm()`: updates lastDailyScanDate when no more jobs
- [x] `triggerManualRefresh()`: clears existing pending jobs before enqueueing new ones
- [x] `pauseScanning()`: sets dailyScanEnabled to false
- [x] Edge case: alarm fires but DB has no projects - no jobs created, scan completes immediately

---

### 1.7 Service Worker Entry Point (~3h) [depends: 1.6]

- [ ] **1.7.1** Create `src/background/index.ts`:
  - Register `chrome.runtime.onInstalled` listener -> call `setupAlarms()`, trigger first scan
  - Register `chrome.alarms.onAlarm` listener -> dispatch to `handleDailyScanAlarm()` or `handleProcessQueueAlarm()`
  - Register `chrome.runtime.onMessage` listener -> handle `TRIGGER_REFRESH`, `PAUSE_SCAN`, `RESUME_SCAN`, `CANCEL_SCAN`
- [ ] **1.7.2** Create `src/background/messaging.ts`:
  - `sendToUI(message: ServiceWorkerMessage)` - wraps `chrome.runtime.sendMessage` with try/catch (fails silently if no listeners)

**Tests:**
- [ ] `onInstalled` fires: alarms are set up
- [ ] `onAlarm('dailyScan')`: dispatches to daily scan handler
- [ ] `onAlarm('processQueue')`: dispatches to process queue handler
- [ ] `onMessage('TRIGGER_REFRESH')`: calls triggerManualRefresh
- [ ] `sendToUI()`: doesn't throw if no dashboard is open
- [ ] Unknown alarm name: ignored gracefully
- [ ] Unknown message type: ignored gracefully

---

### 1.8 Dashboard - Project Management (~8-10h) [depends: 1.2, 1.3]

#### 1.8.1 Composables

- [ ] **1.8.1.1** Create `src/dashboard/composables/useProjects.ts`:
  - `projects` - reactive ref of all projects
  - `loadProjects()` - load from IndexedDB
  - `createProject(name, ownExtensionUrl)` - parse extension ID from URL, create project + extension records
  - `deleteProject(id)` - delete project, handle extension cleanup (check projectRefs)
  - `addCompetitor(projectId, extensionUrl)` - add competitor extension to project
  - `removeCompetitor(projectId, extensionId)` - remove competitor, handle cleanup
- [ ] **1.8.1.2** Create `src/dashboard/composables/useExtensions.ts`:
  - `getExtensionsByProject(projectId)` - returns own + competitors
  - `getLatestSnapshot(extensionId)` - latest listing data
- [ ] **1.8.1.3** Create `src/dashboard/composables/useKeywords.ts`:
  - `keywords` - reactive ref for current project
  - `loadKeywords(projectId)`
  - `addKeyword(projectId, text)` - validate not duplicate in same project
  - `removeKeyword(id)`
- [ ] **1.8.1.4** Create `src/dashboard/composables/useServiceWorker.ts`:
  - Listen for messages from service worker
  - Expose reactive `scanProgress`, `lastScanStatus`, `queueStats`
  - Provide methods: `requestRefresh()`, `requestPause()`, `requestResume()`

**Tests (composables):**
- [ ] `createProject()`: creates project + extension records in DB
- [ ] `createProject()`: parses extension ID from full CWS URL (`chrome.google.com/webstore/detail/name/EXTENSION_ID`)
- [ ] `createProject()`: parses extension ID from short URL or raw ID
- [ ] `createProject()`: rejects invalid URLs/IDs
- [ ] `addCompetitor()`: adds extension ID to project's competitorIds, creates extension record
- [ ] `addCompetitor()`: if extension already exists in DB (from another project), adds projectRef
- [ ] `addCompetitor()`: rejects adding the same competitor twice to one project
- [ ] `removeCompetitor()`: removes from competitorIds, decrements projectRefs
- [ ] `removeCompetitor()`: when projectRefs becomes empty, marks for cleanup
- [ ] `deleteProject()`: removes project, handles all extension cleanup
- [ ] `addKeyword()`: rejects duplicate keyword text in same project
- [ ] `addKeyword()`: allows same keyword text in different projects

#### 1.8.2 Pages & Components

- [ ] **1.8.2.1** Create `src/dashboard/App.vue` with router-view and navigation sidebar
- [ ] **1.8.2.2** Create `src/dashboard/router.ts` with routes: `/` (home), `/project/:id` (project detail), `/settings`
- [ ] **1.8.2.3** Create `src/dashboard/pages/HomePage.vue`:
  - Project card grid (or empty state if no projects)
  - "Create Project" button/modal
  - Scan status banner (if scan running)
- [ ] **1.8.2.4** Create project creation modal:
  - Input: extension URL or ID
  - Auto-fetch extension name and icon on input (if possible, or after first scan)
  - Input: project name (default to extension name)
  - Submit creates project
- [ ] **1.8.2.5** Create `src/dashboard/pages/ProjectPage.vue`:
  - Tab navigation: Overview, Rankings, Extensions, Keywords, Events
  - Load project data on mount
- [ ] **1.8.2.6** Create **Overview Tab**:
  - Metric cards: total extensions tracked, total keywords, last scan date, scan status
  - Recent events list (last 10 events across all project extensions)
  - Quick rank change summary
  - Empty state: "No data yet. Run your first scan."
- [ ] **1.8.2.7** Create **Extensions Tab**:
  - Table: extension name, rating, users, version, last updated, permission risk score, quality score placeholder
  - "Add Competitor" button + modal
  - "Remove" button per competitor (with confirmation)
  - Click row -> expand to show snapshot history
  - Empty state: "Add competitor extensions to start tracking."
- [ ] **1.8.2.8** Create **Keywords Tab**:
  - Table: keyword text, positions for each tracked extension (latest), change since last scan
  - "Add Keyword" input + button
  - "Remove" button per keyword (with confirmation)
  - Empty state: "Add keywords to track search rankings."
- [ ] **1.8.2.9** Create **Events Tab**:
  - Chronological timeline of events
  - Filter by event type, extension
  - Empty state: "No changes detected yet. Events appear after your second scan."

#### 1.8.3 Rankings Tab & Chart

- [ ] **1.8.3.1** Create `src/dashboard/composables/useRankings.ts`:
  - `loadRankHistory(projectId, keywordId, dateRange)` - load rank snapshots for all project extensions
  - Transform into ApexCharts series format: one series per extension
- [ ] **1.8.3.2** Create `src/dashboard/components/charts/RankChart.vue`:
  - ApexCharts line chart
  - Y-axis inverted (position 1 at top)
  - X-axis: dates
  - One line per extension (different colors)
  - Handle `position: null` - show as gap in line or at bottom with "30+" label
  - Keyword selector dropdown
  - Date range picker
  - Legend with extension names
- [ ] **1.8.3.3** Handle chart edge cases:
  - Single data point: show as dot
  - No data: show empty state
  - All positions null: show "No extensions ranked in top 30 for this keyword"
  - 365+ days of data: ensure performance is acceptable, consider downsampling

**Tests (chart data transformation):**
- [ ] `loadRankHistory()`: correctly transforms DB records into ApexCharts series
- [ ] Null positions are represented correctly in the series
- [ ] Multiple extensions: one series per extension, correct colors
- [ ] Date range filtering: only includes snapshots within range
- [ ] Empty result: returns empty series array

---

### 1.9 Popup (~4h) [depends: 1.8.1]

- [ ] **1.9.1** Create `src/popup/App.vue`:
  - Scan status indicator (idle/running with progress/last run time)
  - Top 5 rank changes since last scan
  - Quick action buttons: "Open Dashboard", "Refresh Now", "Pause/Resume"
- [ ] **1.9.2** Implement "Open Dashboard": `chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') })`
- [ ] **1.9.3** Implement "Refresh Now": send `TRIGGER_REFRESH` message to service worker
- [ ] **1.9.4** Implement tier-aware behavior: if free tier and last scan > 7 days ago, show nudge
- [ ] **1.9.5** Implement badge count on extension icon: `chrome.action.setBadgeText({ text: '3' })` for number of notable changes

**Tests:**
- [ ] Rank changes display correctly (up arrows, down arrows, no change)
- [ ] "30+" displayed for position: null
- [ ] No scan data: shows "No scans yet" state
- [ ] Scan running: shows progress bar
- [ ] Badge clears after user opens popup

---

### 1.10 Integration Testing (~4h) [depends: 1.1-1.9]

End-to-end flows tested with mock fetch responses (no real CWS requests).

- [ ] **1.10.1** Full scan cycle: create project -> add extension -> add keywords -> trigger scan -> verify listing_snapshot saved -> verify rank_snapshots saved -> verify events detected
- [ ] **1.10.2** Second scan cycle: trigger another scan -> verify new snapshots -> verify change events detected
- [ ] **1.10.3** Queue resilience: simulate service worker restart mid-scan -> verify running jobs reset to pending -> verify scan resumes
- [ ] **1.10.4** Error handling: simulate fetch failures -> verify retry with backoff -> verify terminal failure after max retries
- [ ] **1.10.5** Extension removal: simulate 404 response -> verify extension marked 'removed' -> verify data preserved
- [ ] **1.10.6** Data retention: insert old snapshots -> run pruning -> verify old data deleted, recent preserved
- [ ] **1.10.7** Multiple projects: scan with 2 projects sharing a competitor -> verify only 1 listing_scan for shared extension
- [ ] **1.10.8** Manual refresh while scan running: trigger refresh -> verify old pending jobs cleared, new jobs enqueued

---

## Phase 2 - Intelligence (3-4 weeks)

### 2.1 Listing Quality Score (~6h) [depends: 0.3, Phase 1]

- [ ] **2.1.1** Create `src/shared/utils/quality-score.ts`:
  - `calculateQualityScore(snapshot: ListingSnapshot, thresholds: QualityThresholds): QualityScoreResult`
  - `QualityScoreResult` includes: total score (0-100), component scores (0-100 each), component weights, recommendations[]
- [ ] **2.1.2** Implement each scoring component using calibrated thresholds from Phase 0:
  - Title optimization (15%)
  - Short description (10%)
  - Full description (15%)
  - Visual assets (15%)
  - Ratings & reviews (15%)
  - Translations (10%)
  - Update freshness (10%)
  - Permissions (5%)
  - Developer profile (5%)
- [ ] **2.1.3** Generate actionable recommendations for low-scoring components: e.g., "Add 3 more screenshots to reach optimal count" or "Your description is 150 words - consider expanding to 400+"

**Tests:**
- [ ] Perfect listing (all optimal values): score near 100
- [ ] Empty listing (all zeros/nulls): score near 0
- [ ] Component weights sum to 100%
- [ ] Each component individually scores 0-100
- [ ] Total score is weighted average of components
- [ ] Recommendations generated for components scoring < 50
- [ ] No recommendations for components scoring > 80
- [ ] Edge case: rating is null (no reviews) - rating component scores 0, doesn't crash
- [ ] Edge case: lastUpdated is unparseable - update freshness scores 0

### 2.2 Listing Comparison View (~8h) [depends: Phase 1]

- [ ] **2.2.1** Create `src/dashboard/components/comparison/ListingCompare.vue`:
  - Extension selector (pick 2-4 from project)
  - Side-by-side layout
- [ ] **2.2.2** Implement text comparison for title, short description:
  - Character count
  - Keyword highlighting (tracked keywords highlighted in text)
- [ ] **2.2.3** Implement full description comparison:
  - Word count
  - Keyword density per tracked keyword
  - Readability score (Flesch-Kincaid or similar)
- [ ] **2.2.4** Implement permissions comparison:
  - Shared permissions
  - Unique to extension A / unique to extension B
  - Risk score comparison bar
- [ ] **2.2.5** Implement metrics comparison:
  - Bar charts for: rating, review count, user count, screenshot count, translation count
- [ ] **2.2.6** Implement keyword density matrix:
  - Table: rows = tracked keywords, columns = extensions
  - Cells = occurrence count in title / short desc / full desc

**Tests:**
- [ ] Comparing 2 extensions: all fields displayed side-by-side
- [ ] Keyword highlighting: correct words highlighted
- [ ] Permission diff: correctly identifies shared/unique
- [ ] Compare extension with itself: all values equal, no diff
- [ ] Compare with missing data: handles null/empty fields gracefully

### 2.3 Event Detection Enhancement (~4h) [depends: Phase 1]

- [ ] **2.3.1** Add event annotations to RankChart:
  - Vertical annotation lines using ApexCharts `xaxis.annotations`
  - Color-coded by event type
  - Tooltip on hover showing event details
- [ ] **2.3.2** Add event type filter toggles (checkboxes to show/hide specific event types on chart)
- [ ] **2.3.3** Implement event color scheme:
  - Red: permission_change
  - Blue: version_change
  - Green: rating_milestone, user_milestone
  - Orange: title_change, description_change
  - Gray: screenshot_change, translation_change, badge_change

**Tests:**
- [ ] Annotations appear at correct dates on chart
- [ ] Toggling filter hides/shows corresponding annotations
- [ ] Multiple events on same date: all annotations visible (stacked or grouped)
- [ ] No events: no annotations, no errors

### 2.4 Keyword Analysis (~6h) [depends: Phase 1]

- [ ] **2.4.1** Create `src/dashboard/components/tables/KeywordAnalysis.vue`:
  - Keyword frequency matrix
  - Gap analysis
  - Most used keywords
- [ ] **2.4.2** Implement keyword frequency matrix:
  - For each tracked keyword × extension: count in title, short desc, full desc
  - Highlight cells where user's extension has lower density than competitors
- [ ] **2.4.3** Implement keyword gap analysis:
  - Extract top keywords from competitor descriptions
  - Filter out keywords already tracked
  - Suggest keywords the user is missing
- [ ] **2.4.4** Implement keyword difficulty estimate:
  - For each keyword: average rating, user count, and quality score of top 5 ranking extensions
  - Score: higher average = harder keyword

**Tests:**
- [ ] Frequency matrix: correct counts for known text
- [ ] Gap analysis: correctly identifies keywords in competitors but not in user's extension
- [ ] Difficulty: correctly averages metrics across top rankers
- [ ] Edge case: keyword not found in any description - frequency is 0

### 2.5 Change Diff View (~4h) [depends: Phase 1]

- [ ] **2.5.1** Create `src/shared/utils/diff.ts`:
  - `computeTextDiff(oldText: string, newText: string): DiffSegment[]`
  - Each segment: `{ type: 'equal' | 'added' | 'removed', text: string }`
  - Use a word-level diff algorithm (not character-level)
- [ ] **2.5.2** Create `src/dashboard/components/comparison/DiffView.vue`:
  - Renders diff segments with color coding (green=added, red=removed, black=equal)
  - Used in event detail expansion
- [ ] **2.5.3** Create `src/dashboard/components/comparison/PermissionsDiff.vue`:
  - Shows added permissions (green) with their risk warnings
  - Shows removed permissions (red)
  - Shows unchanged permissions (gray)

**Tests (diff):**
- [ ] Identical strings: all segments are 'equal'
- [ ] Completely different strings: old is 'removed', new is 'added'
- [ ] Single word change: correctly shows surrounding context as 'equal'
- [ ] Empty old + non-empty new: all 'added'
- [ ] Non-empty old + empty new: all 'removed'
- [ ] Both empty: empty segments array
- [ ] Multi-paragraph text: handles newlines correctly

### 2.6 Database Migration v2 (~1h)

- [ ] **2.6.1** Add `this.version(2).stores({...})` to `CWSDatabase` constructor if new indexes or stores are needed
- [ ] **2.6.2** Test upgrade from v1 to v2 with populated data

---

## Phase 3 - AI & Translation Analysis (3-4 weeks)

### 3.1 OpenAI API Client (~4h)

- [ ] **3.1.1** Create `src/shared/utils/openai.ts`:
  - `OpenAIClient` class
  - Constructor takes API key
  - `chat(messages, options)` - wrapper for `/v1/chat/completions` endpoint
  - `estimateTokens(text)` - rough token count (chars / 4)
  - `estimateCost(inputTokens, outputTokens)` - cost estimate based on GPT-4o pricing
- [ ] **3.1.2** Implement error handling:
  - 401: invalid API key
  - 429: rate limited, suggest waiting
  - 402/insufficient_quota: no credits
  - Network error: generic retry message
- [ ] **3.1.3** Request `api.openai.com` host permission at runtime via `chrome.permissions.request()` when user enters API key

**Tests (mock fetch):**
- [ ] Successful chat: returns parsed response content
- [ ] 401 error: throws specific "invalid API key" error
- [ ] 429 error: throws specific "rate limited" error
- [ ] Network error: throws specific "connection failed" error
- [ ] `estimateTokens()`: roughly correct for known strings
- [ ] `estimateCost()`: matches expected GPT-4o pricing

### 3.2 Keyword Audit - "Why Is Competitor Higher?" (~6h) [depends: 3.1]

- [ ] **3.2.1** Create `src/dashboard/components/ai/AuditTool.vue`:
  - Selector: keyword + competitor extension
  - "Run Audit" button with cost estimate
  - Results display area
- [ ] **3.2.2** Create prompt template for audit:
  - Include both listings' data (title, descriptions, metrics)
  - Include keyword and ranking positions
  - Ask for structured analysis: relevance factors, metric advantages, actionable recommendations
- [ ] **3.2.3** Parse and display structured AI response
- [ ] **3.2.4** Add "Why higher?" contextual button in rankings table next to each competitor's rank
- [ ] **3.2.5** Cache audit results in IndexedDB (avoid re-running for same inputs)

**Tests:**
- [ ] Prompt includes all required data fields
- [ ] Token estimate is shown before running
- [ ] Cached result returned on re-run with same inputs
- [ ] Error states: API key missing, API error, empty response

### 3.3 AI Title & Description Generator (~4h) [depends: 3.1]

- [ ] **3.3.1** Create `src/dashboard/components/ai/Generator.vue`:
  - Keyword selector (multi-select from tracked keywords)
  - "Generate" button with cost estimate
  - Display: 3 title suggestions, 2 description suggestions
  - Copy button per suggestion
- [ ] **3.3.2** Create prompt template for generation
- [ ] **3.3.3** Implement "Regenerate" button

**Tests:**
- [ ] Prompt includes competitor listings and target keywords
- [ ] Suggestions displayed correctly
- [ ] Copy button works
- [ ] Error handling for API failures

### 3.4 AI Keyword Extraction (~4h) [depends: 3.1]

- [ ] **3.4.1** Create `src/dashboard/components/ai/KeywordExtractor.vue`:
  - Competitor selector (multi-select)
  - "Extract Keywords" button
  - Results: categorized keyword list (primary, secondary, long-tail)
  - "Add to tracking" button per keyword
- [ ] **3.4.2** Create prompt template for extraction
- [ ] **3.4.3** One-click "Add to tracking" adds keyword to project via `useKeywords`

**Tests:**
- [ ] Extracted keywords are displayed in categories
- [ ] "Add to tracking" creates keyword in DB
- [ ] Duplicate keyword detection: warns if keyword already tracked

### 3.5 AI Tools Tab (~2h) [depends: 3.2, 3.3, 3.4]

- [ ] **3.5.1** Create AI Tools tab in ProjectPage
- [ ] **3.5.2** Add OpenAI key status indicator (configured/not configured, test connection button)
- [ ] **3.5.3** Add AI analysis history (past audit results, past generations) with timestamps

### 3.6 Translation Manipulation Detection (~14-18h)

#### 3.6.1 Translation Fetching

- [ ] **3.6.1.1** Create `src/background/parsers/translation-parser.ts`:
  - Same parser interface but specifically for localized detail pages
  - Extracts: title, shortDescription, fullDescription for a given locale
- [ ] **3.6.1.2** Add `translation_audit` job type to queue processor:
  - Fetches `chrome.google.com/webstore/detail/[id]?hl=[locale]`
  - Parses response
  - Saves `translation_snapshot`
- [ ] **3.6.1.3** Create `src/dashboard/composables/useTranslationAudit.ts`:
  - `startAudit(projectId, extensionIds, locales)` - builds and enqueues translation_audit jobs
  - `getAuditResults(extensionId, date)` - load results from DB

**Tests:**
- [ ] Translation parser: extracts localized fields from fixture
- [ ] Queue builds correct number of jobs (extensions × locales)
- [ ] Audit for 3 extensions × 5 locales = 15 jobs created

#### 3.6.2 Detection Algorithms

- [ ] **3.6.2.1** Create `src/shared/utils/translation-checks.ts` with each detection function:

**Trick 1: Different Extension Name**
- [ ] `detectDifferentName(englishTitle, localizedTitle, locale, competitorNames): ManipulationFlags['differentName']`
- [ ] Latin-script locales: Levenshtein similarity < 0.5 = flagged
- [ ] Non-Latin-script locales: check if English brand words are present
- [ ] Check for competitor names in title

**Tests:**
- [ ] "AdBlock Plus" vs "AdBlock Plus" (es): not flagged (same name)
- [ ] "AdBlock Plus" vs "El Mejor Bloqueador" (es): flagged (< 50% similarity)
- [ ] "AdBlock Plus" vs "AdBlock Plus - 広告ブロッカー" (ja): not flagged (brand name retained)
- [ ] "AdBlock Plus" vs "広告ブロッカー" (ja): flagged (brand name absent)
- [ ] "AdBlock Plus" vs "uBlock Origin" (any locale): flagged (competitor name)
- [ ] Empty localized title: flagged

**Trick 2: Different Short Description**
- [ ] `detectDifferentShortDesc(english, localized, locale): ManipulationFlags['differentShortDesc']`

**Tests:**
- [ ] Similar descriptions in different languages: not flagged if similarity > 0.6 (for Latin)
- [ ] Completely different description: flagged
- [ ] Description replaced with "keyword1, keyword2, keyword3": flagged

**Trick 3: Competitor Names in Text**
- [ ] `detectCompetitorNames(title, shortDesc, fullDesc, competitorNames): ManipulationFlags['competitorNames']`

**Tests:**
- [ ] Description contains exact competitor name: flagged with match
- [ ] Description contains fuzzy match (1 char difference): flagged
- [ ] Description contains competitor name as part of a different word: not flagged (e.g., "block" in "blockchain")
- [ ] No competitor names: not flagged
- [ ] Competitor names array is empty: not flagged, no error

**Trick 4: Considerably More Extensive Description**
- [ ] `detectExtendedDescription(allLocaleDescriptions: Map<string, string>): Map<string, ManipulationFlags['extendedDescription']>`
- [ ] Calculate median length, flag locales > 2x median

**Tests:**
- [ ] All locales similar length: none flagged
- [ ] One locale 3x median length: flagged
- [ ] One locale exactly 2x median: not flagged (> 2x, not >=)
- [ ] Only 1 locale available: not flagged (can't compute meaningful median)
- [ ] 2 locales: uses average as median, still compares

**Trick 5: Keywords at End of Description**
- [ ] `detectKeywordsAtEnd(description: string): ManipulationFlags['keywordsAtEnd']`
- [ ] Detect: 3+ newlines followed by 5+ short lines (< 50 chars each)

**Tests:**
- [ ] Normal description: not flagged
- [ ] Description ending with "\n\n\n\nkeyword1\nkeyword2\nkeyword3\nkeyword4\nkeyword5": flagged
- [ ] Description ending with bullet-point list (legitimate): borderline - test behavior and decide threshold
- [ ] Description with newlines in middle (not at end): not flagged
- [ ] Empty description: not flagged

**Trick 6: Keywords Within Description**
- [ ] `detectKeywordsInline(description: string): ManipulationFlags['keywordsInline']`
- [ ] Detect comma-separated blocks, repeated similar sentences

**Tests:**
- [ ] Normal prose: not flagged
- [ ] "features: ad blocker, popup blocker, tracker blocker, script blocker, cookie blocker": flagged
- [ ] Single comma-separated pair ("fast and secure"): not flagged
- [ ] English keyword block inside non-English text: flagged

**Trick 7: Completely Different Description**
- [ ] `detectDifferentDescription(english, localized): ManipulationFlags['differentDescription']`
- [ ] Keyword/term overlap (Jaccard similarity of extracted terms)

**Tests:**
- [ ] Legitimate translation (many shared terms like brand names, tech terms): not flagged
- [ ] Completely unrelated text: flagged
- [ ] Same text (not translated): not flagged (high overlap)
- [ ] Empty localized description: flagged

**Trick 8: Untranslated English**
- [ ] `detectUntranslatedEnglish(text: string, expectedLocale: string): ManipulationFlags['untranslatedEnglish']`
- [ ] Basic heuristic: frequency of common English words (the, and, is, for, to, with, etc.)

**Tests:**
- [ ] English text with `expectedLocale='ja'`: flagged (high English ratio)
- [ ] Japanese text with `expectedLocale='ja'`: not flagged
- [ ] Mixed text (50% English, 50% Japanese): check ratio, may or may not flag depending on threshold
- [ ] Text with only English brand names in Japanese: not flagged (low English ratio)
- [ ] Empty text: not flagged

#### 3.6.3 Audit Report UI

- [ ] **3.6.3.1** Create "Run Translation Audit" button in project view
- [ ] **3.6.3.2** Locale selector (checkboxes, default selection)
- [ ] **3.6.3.3** Extension selector (which extensions to audit)
- [ ] **3.6.3.4** Progress display during audit (reuse scan progress pattern)
- [ ] **3.6.3.5** Create `src/dashboard/components/translation/AuditReport.vue`:
  - Summary card per extension: overall manipulation score
  - Breakdown by trick type with severity badges
  - Expandable details per locale showing flagged content
- [ ] **3.6.3.6** Create locale-vs-locale comparison table: rows = locales, columns = title/shortDesc/descLength
- [ ] **3.6.3.7** Export audit results as JSON

### 3.7 Database Migration v3 (~1h)

- [ ] **3.7.1** Add v3 migration if needed (translation_snapshots store if not created in v1)
- [ ] **3.7.2** Test v1 -> v3 upgrade path
- [ ] **3.7.3** Test v2 -> v3 upgrade path

---

## Phase 4 - Publish & Monetize (2-3 weeks)

### 4.1 LemonSqueezy Integration (~6h)

- [ ] **4.1.1** Create LemonSqueezy product and subscription plan ($9-12/mo)
- [ ] **4.1.2** Create `src/dashboard/composables/useLicense.ts`:
  - `validateLicense(key)` - call LemonSqueezy API
  - `checkLicenseStatus()` - check cached status, revalidate if > 24h
  - `currentPlan` - reactive ref: 'free' | 'pro' | 'expired'
  - `isProFeature(feature)` - check if feature requires Pro
- [ ] **4.1.3** Implement grace period: if validation fails, allow Pro access for 3 days using cached status
- [ ] **4.1.4** Request `api.lemonsqueezy.com` permission at runtime when user enters license key
- [ ] **4.1.5** Store license status in `chrome.storage.sync` (syncs across Chrome profiles)
- [ ] **4.1.6** Add plan indicator in dashboard header and popup

**Tests:**
- [ ] Valid license key: returns 'pro' status
- [ ] Invalid license key: returns 'free', shows error message
- [ ] Expired license: returns 'expired'
- [ ] API unreachable + cached 'pro' + within grace period: returns 'pro'
- [ ] API unreachable + cached 'pro' + past grace period: returns 'expired'
- [ ] API unreachable + no cached status: returns 'free'

### 4.2 Tier Gating (~4h) [depends: 4.1]

- [ ] **4.2.1** Create `src/shared/utils/tier-gates.ts`:
  - `canCreateProject(currentCount, plan)` - free: max 1, pro: unlimited
  - `canAddExtension(currentCount, plan)` - free: max 3 per project, pro: unlimited
  - `canAddKeyword(currentCount, plan)` - free: max 10 per project, pro: unlimited
  - `canUseDailyAutoScan(plan)` - pro only
  - `canUseFeature(feature, plan)` - general feature gate
- [ ] **4.2.2** Add gate checks to all relevant composables (useProjects, useKeywords, etc.)
- [ ] **4.2.3** Add upgrade prompts when free users hit limits: "Upgrade to Pro to track unlimited keywords"
- [ ] **4.2.4** Disable daily auto-scan for free tier (manual only)
- [ ] **4.2.5** Enforce 30-day data retention for free tier (auto-prune older data)

**Tests:**
- [ ] Free tier: creating 2nd project blocked
- [ ] Free tier: adding 4th extension blocked
- [ ] Free tier: adding 11th keyword blocked
- [ ] Pro tier: all limits lifted
- [ ] Downgrade from pro to free: existing data preserved, but new data subject to free limits
- [ ] Feature gates return correct boolean for each plan

### 4.3 Onboarding Flow (~4h)

- [ ] **4.3.1** Create `src/dashboard/components/onboarding/OnboardingWizard.vue`:
  - Step 1: Welcome + explanation
  - Step 2: Enter your extension URL
  - Step 3: Add 1-2 competitors (with skip option)
  - Step 4: Add 3-5 keywords (suggest popular terms)
  - Step 5: Trigger first scan
  - Step 6: Dashboard with progress
- [ ] **4.3.2** Show onboarding on first launch (check flag in settings)
- [ ] **4.3.3** Allow skipping onboarding
- [ ] **4.3.4** Show estimated scan time: "First scan takes ~X minutes"

### 4.4 Export & Backup (~4h)

- [ ] **4.4.1** Implement JSON export per project: all project data (extensions, keywords, snapshots, events)
- [ ] **4.4.2** Implement CSV export: rank history as CSV (date, keyword, extension, position)
- [ ] **4.4.3** Implement full database backup: all IndexedDB stores as single JSON
- [ ] **4.4.4** Implement restore from backup: validate schema, option to merge or replace
- [ ] **4.4.5** Add storage usage display in Settings: approximate size per store, total

**Tests:**
- [ ] Export JSON: contains all expected data for the project
- [ ] Export CSV: correct format, headers, data
- [ ] Backup: all stores included
- [ ] Restore: backup file loads correctly, data accessible
- [ ] Restore: invalid backup file shows error message
- [ ] Restore (merge): existing data preserved, new data added
- [ ] Restore (replace): all existing data cleared, backup data loaded
- [ ] Storage usage: returns reasonable numbers

### 4.5 Settings Page (~3h)

- [ ] **4.5.1** Create `src/dashboard/pages/SettingsPage.vue`:
  - Section: Scan Settings (queue delay, jitter, daily scan time, enable/disable)
  - Section: API Keys (OpenAI key input with test button, LemonSqueezy license key)
  - Section: Data Management (retention period, storage usage, prune now, backup, restore)
  - Section: Translation Audit (locale selector for default audit locales)
  - Section: About (version, links)
- [ ] **4.5.2** Validate all settings on change (delay >= 30s, retention >= 7 days, etc.)
- [ ] **4.5.3** "Test Connection" button for OpenAI (sends a tiny request to verify key)

### 4.6 CWS Listing Preparation (~3h)

- [ ] **4.6.1** Write CWS listing title (max 45 chars)
- [ ] **4.6.2** Write short description (max 132 chars)
- [ ] **4.6.3** Write full description (optimized based on own tool's analysis!)
- [ ] **4.6.4** Create screenshots (5+): dashboard, rankings chart, comparison view, translation audit, popup
- [ ] **4.6.5** Create promo tile images (small: 440x280, large: 920x680, marquee: 1400x560)
- [ ] **4.6.6** Create extension icon set (16, 48, 128)
- [ ] **4.6.7** Create privacy policy page (hosted on a simple site)
- [ ] **4.6.8** Submit to CWS for review

### 4.7 Final QA (~4h)

- [ ] **4.7.1** Full walkthrough: install fresh -> onboarding -> first scan -> view results
- [ ] **4.7.2** Test free tier: verify all limits enforced
- [ ] **4.7.3** Test Pro tier: verify all features unlocked
- [ ] **4.7.4** Test edge cases: no internet, CWS down, large data volumes
- [ ] **4.7.5** Performance check: dashboard with 365 days of data for 10 extensions × 20 keywords
- [ ] **4.7.6** Memory/storage check: verify IndexedDB usage after extended use
- [ ] **4.7.7** Cross-browser profile test: install on fresh Chrome profile, verify everything works

---

## Phase 5 - Advanced (Ongoing, Post-Launch)

### 5.1 Search Autocomplete Tracking

- [ ] **5.1.1** Investigate CWS autocomplete endpoint (network tab analysis)
- [ ] **5.1.2** Create autocomplete parser
- [ ] **5.1.3** Add autocomplete_scan job type
- [ ] **5.1.4** UI: keyword suggestions from autocomplete
- [ ] **5.1.5** Track autocomplete changes over time

### 5.2 New Competitor Alerts

- [ ] **5.2.1** During keyword scans, compare results with known competitor list
- [ ] **5.2.2** Flag new extensions in top 10 that aren't tracked
- [ ] **5.2.3** Show alerts in dashboard and popup
- [ ] **5.2.4** One-click "Add as competitor" from alert

### 5.3 Weekly Digest

- [ ] **5.3.1** Create digest builder: summarize week's rank changes, events, alerts
- [ ] **5.3.2** Show as Chrome notification or popup panel
- [ ] **5.3.3** Weekly alarm trigger

### 5.4 Review Sentiment Analysis

- [ ] **5.4.1** Parse review text from CWS detail pages (requires parser update)
- [ ] **5.4.2** Send reviews to OpenAI for sentiment + topic categorization
- [ ] **5.4.3** Dashboard: sentiment trend chart, topic breakdown, critical review flags

### 5.5 Search Pagination

- [ ] **5.5.1** Implement multi-page search scraping (page 2, 3, etc.)
- [ ] **5.5.2** Update rank_snapshot: position now possible beyond 30
- [ ] **5.5.3** Update UI: "30+" badge replaced with actual position
- [ ] **5.5.4** Add configurable search depth (1 page, 3 pages, 5 pages)

---

## Testing Summary

### Test Coverage Targets

| Module | Target | Rationale |
|--------|--------|-----------|
| IndexedDB layer (database.ts) | 95%+ | Foundation of all data operations |
| Parsers (listing, search, translation) | 95%+ | Most fragile, most likely to break when CWS changes |
| Queue system (processor, builder, scheduler) | 90%+ | Core reliability - bugs here mean lost data or infinite loops |
| Event detection | 90%+ | Incorrect events erode user trust |
| Permission risk scoring | 95%+ | Simple but must be accurate |
| Text analysis utilities | 90%+ | Used throughout, must be reliable |
| Translation detection algorithms | 85%+ | Complex heuristics, test known manipulation patterns |
| Tier gating | 95%+ | Revenue depends on correct enforcement |
| Quality score | 80%+ | Calibrated scores, but exact values less critical |
| UI composables | 70%+ | Business logic in composables, UI rendering tested manually |
| Vue components | Manual | Visual verification, interaction testing |

### Test File Organization

```
tests/
  mocks/
    chrome.ts              # chrome.* API mocks
    fetch.ts               # fetch() mock with response helpers
  fixtures/
    cws-detail-en.html     # Real CWS responses from Phase 0
    cws-detail-ja.html
    cws-detail-404.html
    cws-search-results.html
    cws-search-empty.html
  unit/
    db/
      database.test.ts
      migrations.test.ts
    parsers/
      listing-parser.test.ts
      search-parser.test.ts
      translation-parser.test.ts
    utils/
      permissions.test.ts
      quality-score.test.ts
      text-analysis.test.ts
      translation-checks.test.ts
      diff.test.ts
      dates.test.ts
      settings.test.ts
    queue/
      queue-builder.test.ts
      queue-processor.test.ts
      event-detector.test.ts
      scheduler.test.ts
    ai/
      openai-client.test.ts
    license/
      license-validation.test.ts
      tier-gates.test.ts
  integration/
    full-scan-cycle.test.ts
    queue-resilience.test.ts
    data-retention.test.ts
    export-import.test.ts
```

---

## Implementation Order Summary

```
Phase 0 (days 1-2):
  0.1 CWS Response Investigation
  0.2 Prototype Parsers
  0.3 Quality Score Calibration
  0.4 Test Infrastructure Setup

Phase 1 (weeks 1-6):
  Week 1:  1.1 Types → 1.2 IndexedDB Layer → 1.3 Settings Manager
  Week 2:  1.4 Parsers → 1.5 Utilities (permissions, text analysis, dates)
  Week 3:  1.6 Queue System (builder, processor, event detection, scheduler)
  Week 4:  1.7 Service Worker Entry Point → 1.8 Dashboard (composables, home, project pages)
  Week 5:  1.8 Dashboard (rankings chart, extensions/keywords/events tabs)
  Week 6:  1.9 Popup → 1.10 Integration Testing → Bug fixes

Phase 2 (weeks 7-10):
  Week 7:  2.1 Quality Score → 2.2 Comparison View
  Week 8:  2.3 Event Annotations → 2.4 Keyword Analysis
  Week 9:  2.5 Diff View → 2.6 Migration v2
  Week 10: Polish, bug fixes, performance tuning

Phase 3 (weeks 11-14):
  Week 11: 3.1 OpenAI Client → 3.2 Keyword Audit
  Week 12: 3.3 Generator → 3.4 Extractor → 3.5 AI Tools Tab
  Week 13: 3.6 Translation Detection (fetching, algorithms)
  Week 14: 3.6 Translation Detection (UI, report) → 3.7 Migration v3

Phase 4 (weeks 15-17):
  Week 15: 4.1 LemonSqueezy → 4.2 Tier Gating
  Week 16: 4.3 Onboarding → 4.4 Export/Backup → 4.5 Settings
  Week 17: 4.6 CWS Listing → 4.7 Final QA → Submit
```
