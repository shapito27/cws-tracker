# Changelog

All notable changes to CWS Tracker will be documented in this file.

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
