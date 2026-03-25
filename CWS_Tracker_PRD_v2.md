# CWS Tracker - Product Requirements Document

**Chrome Web Store ASO & Competitive Intelligence Tool**

Version 2.0 | February 2026 | Author: Ruslan

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Product Vision & Goals](#2-product-vision--goals)
3. [Technical Architecture](#3-technical-architecture)
4. [Data Model](#4-data-model)
5. [Feature Specification](#5-feature-specification)
6. [Queue System - Detailed Design](#6-queue-system---detailed-design)
7. [UI/UX Design Guidelines](#7-uiux-design-guidelines)
8. [Security & Privacy](#8-security--privacy)
9. [Risks & Mitigations](#9-risks--mitigations)
10. [Project Structure](#10-project-structure)
11. [Manifest V3 Configuration](#11-manifest-v3-configuration)
12. [Development Milestones](#12-development-milestones)
13. [Open Questions & Future Considerations](#13-open-questions--future-considerations)

---

## 1. Executive Summary

CWS Tracker is a Chrome extension that provides App Store Optimization (ASO) and competitive intelligence for Chrome Web Store publishers. It enables extension developers to track keyword rankings, monitor competitor listings, detect listing manipulation tactics, and optimize their own listings for better visibility.

The tool fills a significant gap in the CWS ecosystem - while mobile app stores have mature ASO tools (Sensor Tower, AppFollow, App Annie), Chrome Web Store has virtually no equivalent. CWS Tracker aims to be the first comprehensive, developer-friendly ASO tool for Chrome extension publishers.

### 1.1 Key Value Propositions

- **Keyword Rank Tracking:** Monitor search positions for extensions across target keywords over time
- **Competitive Intelligence:** Track competitor listing changes, permission updates, and ranking movements
- **Translation Manipulation Detection:** Identify when competitors use CWS localization to stuff keywords, fake names, or spam descriptions
- **AI-Powered Optimization:** Generate optimized titles, descriptions, and extract high-value keywords using OpenAI
- **Listing Quality Scoring:** Composite score assessing listing completeness and adherence to best practices

### 1.2 Target Users

- **Primary:** Independent Chrome extension developers (indie makers) who want to improve their CWS visibility
- **Secondary:** Small teams and agencies managing multiple extensions
- **Tertiary:** Extension reviewers and security researchers analyzing CWS listings

---

## 2. Product Vision & Goals

### 2.1 Vision Statement

Become the essential ASO toolkit for every Chrome Web Store publisher, giving developers the same caliber of optimization and intelligence tools that mobile app developers have had for years.

### 2.2 Success Metrics

- **Personal use:** Measurable ranking improvement for tracked extensions within 30 days of optimization
- **Public launch:** 500+ weekly active users within 3 months of CWS publication
- **Revenue:** $700 MRR within 6 months of launching paid tier
- **Retention:** 60%+ monthly retention for Pro subscribers
- **Pricing:** $14/mo monthly or $120/year ($10/mo effective) via LemonSqueezy

### 2.3 Competitive Landscape

The Chrome Web Store ASO tool space is largely empty compared to mobile app store tools. The few existing solutions are:

| Tool | Type | Key Limitations |
|------|------|-----------------|
| CRXcavator | Security analysis | No ASO features, focused on permissions/risk |
| Chrome Stats | Public analytics | No keyword tracking, no personal optimization |
| Manual CWS Search | DIY approach | Time-consuming, no historical data, no automation |

CWS Tracker differentiates by combining keyword tracking, competitive intelligence, translation analysis, and AI optimization in a single privacy-first, client-side tool.

---

## 3. Technical Architecture

### 3.1 Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Extension Framework | Chrome Manifest V3 | Required for CWS publication, service worker-based |
| Frontend Framework | Vue 3 + Composition API | Lightweight reactivity, composable pattern fits dashboard UX |
| Build Tool | Vite + CRXJS Vite Plugin | Fast HMR, native TS support, CRXJS handles manifest generation, multi-entry builds, and HMR for Chrome extensions automatically |
| Language | TypeScript | Type safety critical for complex data models and IndexedDB schema |
| State Management | Vue 3 Composables (`ref`/`reactive`/`computed`) | Lightweight, no extra dependency. IndexedDB is source of truth - composables provide reactive access |
| Charts | ApexCharts + vue3-apexcharts | Built-in annotations/event markers on charts, interactive zoom |
| Styling | Tailwind CSS | Rapid UI development, consistent design system |
| Storage (bulk data) | Dexie.js (IndexedDB wrapper) | Promise-based API, built-in migrations, TypeScript support, ~40KB gzipped |
| Storage (settings) | chrome.storage.local | Fast access for settings, license status, last run timestamps |
| Scheduling | chrome.alarms API | MV3-compliant background task scheduling (1 min minimum) |
| Payments | LemonSqueezy | Subscription management, license validation, no backend needed |
| AI | OpenAI API (user-provided key) | GPT-4o for listing analysis, keyword extraction, optimization |

**Reference:** Development should follow the project's "Chrome Extension Development Quick Reference Guide" for MV3 best practices, service worker patterns, and build configuration.

### 3.2 Extension Architecture

The extension follows a standard MV3 architecture with three main contexts:

- **Service Worker (background.ts):** Handles all CWS scraping, queue management, chrome.alarms scheduling, and data persistence. This is the engine of the application - it runs scraping jobs, parses CWS HTML responses, and writes snapshots to IndexedDB.
- **Dashboard Page (dashboard.html):** Full-page Vue 3 application served from `chrome-extension://[id]/dashboard.html`. This is the primary UI - contains all charts, tables, comparison views, settings, and AI tools. Opens as a new tab.
- **Popup (popup.html):** Lightweight Vue 3 mini-app showing quick summary: recent rank changes, active alerts, last scan status, and shortcut buttons to open dashboard or trigger manual refresh.

### 3.3 Data Flow

The data flow follows a unidirectional pattern:

1. `chrome.alarms` fires at scheduled time (once daily or manual trigger)
2. Service worker reads the queue from IndexedDB, prioritizes jobs
3. For each job: fetch CWS page, parse response (HTML or embedded JSON - see 3.5), extract data
4. Write snapshot to IndexedDB (`listing_snapshots` or `rank_snapshots` store)
5. Compare with previous snapshot to detect changes, create events if found
6. Wait configured delay (60 seconds), proceed to next job
7. Service worker notifies dashboard via messaging (see 3.6)
8. Dashboard reads IndexedDB via composables, renders charts and tables reactively

### 3.4 CWS Scraping Strategy

CWS has no public API. All data is obtained by fetching and parsing responses from `chrome.google.com/webstore`.

**Approach:** `fetch()` from the MV3 service worker. The service worker can make cross-origin requests to CWS without CORS issues because Chrome extensions have host permissions.

**Rate Limiting Strategy:**

- Minimum 60-second delay between all requests (configurable in settings)
- Randomized jitter: actual delay = configured delay +/- 10 seconds (e.g., 50-70s for 60s setting)
- Exponential backoff on HTTP 429 or network errors (2x delay, max 10 min)
- Maximum 3 retries per job before marking as failed
- Daily scan window: all jobs complete in ~30 minutes for default configuration (see 6.5 for calculation)
- User-agent: default Chrome extension user-agent (no spoofing)

**Pages to Fetch:**

| Page Type | URL Pattern | Data Extracted |
|-----------|-------------|----------------|
| Extension Detail | `chrome.google.com/webstore/detail/[id]` | Title, description, rating, reviews, users, version, permissions, badges, screenshots, translations, last updated |
| Keyword Search | `chrome.google.com/webstore/search/[query]` | Ordered list of extension IDs in search results - one search returns positions for ALL tracked extensions |
| Localized Detail | `chrome.google.com/webstore/detail/[id]?hl=[locale]` | Localized title, short description, full description for translation analysis |

### 3.5 Phase 0 - Technical Spike (CWS Response Format)

**CRITICAL: This must be completed before development begins.**

The modern Chrome Web Store (redesigned ~2023) is heavily JavaScript-rendered. A plain `fetch()` from a service worker may not return fully rendered HTML. The response could be:

- **Scenario A:** Server-rendered HTML with data in the DOM - DOMParser works directly
- **Scenario B:** Data embedded as JSON in `<script>` tags or `__NEXT_DATA__` / similar hydration payloads - need to extract and parse JSON
- **Scenario C:** Requires JS execution to render - would need a completely different approach (content script injected into a CWS tab opened in background)

**Spike Tasks:**

1. From a MV3 service worker, `fetch()` a CWS extension detail page and a search results page
2. Inspect the raw response body for each
3. Determine which scenario applies and whether it differs between page types
4. Determine if the response differs based on browser locale or Google account state
5. Prototype a minimal parser for the actual response format
6. Document findings and update parser architecture accordingly

**Estimated time:** 2-4 hours. This de-risks the entire project. If Scenario C is the result, the architecture section needs significant revision (content script approach instead of service worker fetch).

**Parser Abstraction:** Regardless of which scenario applies, parsers should follow a stable interface so they can be swapped when CWS changes:

```typescript
interface ListingParser {
  parse(response: string): ListingData;
  version: string;
}

interface SearchParser {
  parse(response: string): SearchResultData;
  version: string;
}
```

This allows hot-swapping parser implementations without touching queue or storage logic. Consider versioning parsers so the extension can detect when a parser breaks (unexpected null fields) and alert the user.

### 3.6 Service Worker <-> Dashboard Communication

The service worker writes data to IndexedDB, but the dashboard Vue app needs to know when to refresh its views. The extension uses `chrome.runtime` messaging for real-time communication between contexts.

**Message Types (Service Worker -> Dashboard):**

| Message | Payload | Dashboard Action |
|---------|---------|------------------|
| `SCAN_PROGRESS` | `{ completed: number, total: number, currentJob: string }` | Update scan progress bar |
| `SCAN_COMPLETE` | `{ date: string, jobsCompleted: number, jobsFailed: number }` | Refresh all data views, show completion toast |
| `NEW_EVENT` | `{ event: EventRecord }` | Add to events timeline, update chart annotations |
| `SCAN_ERROR` | `{ jobId: string, error: string, retriesLeft: number }` | Show error notification if terminal failure |
| `QUEUE_STATUS` | `{ pending: number, running: number, failed: number }` | Update queue status indicator |

**Implementation:**

```typescript
// Service worker sends:
chrome.runtime.sendMessage({ type: 'SCAN_PROGRESS', payload: { completed: 15, total: 30, currentJob: 'keyword: ad blocker' } });

// Dashboard listens (in a composable like useServiceWorker.ts):
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SCAN_PROGRESS') {
    scanStore.updateProgress(message.payload);
  }
});
```

**Note:** `chrome.runtime.sendMessage` will silently fail if the dashboard tab is not open - this is fine. The dashboard always reads from IndexedDB on mount, so it gets current data regardless of whether it received real-time messages.

**Message Types (Dashboard -> Service Worker):**

| Message | Payload | Service Worker Action |
|---------|---------|----------------------|
| `TRIGGER_REFRESH` | `{ projectId?: string }` | Clear pending queue, rebuild and start scan |
| `PAUSE_SCAN` | `{}` | Pause queue processing |
| `RESUME_SCAN` | `{}` | Resume queue processing |
| `CANCEL_SCAN` | `{}` | Cancel all pending jobs, stop processing |

---

## 4. Data Model

All bulk data is stored in IndexedDB via Dexie.js with a typed wrapper class (`CWSDatabase` extending `Dexie`). The database uses snapshot-based event sourcing - every data point is stored as a timestamped snapshot, enabling historical charts and change detection.

Settings and small configuration values are stored in `chrome.storage.local` for fast access.

### 4.1 IndexedDB Stores

#### 4.1.1 projects

A project groups a user's own extension with its competitors and tracked keywords.

| Field | Type | Description |
|-------|------|-------------|
| id | string (auto) | Unique project ID |
| name | string | Project name (e.g., "Pinterest Pin Stats") |
| ownExtensionId | string | CWS extension ID of the user's own extension |
| competitorIds | string[] | CWS IDs of competitor extensions |
| keywordIds | string[] | IDs of tracked keywords |
| createdAt | Date | Project creation timestamp |
| updatedAt | Date | Last modification timestamp |

#### 4.1.2 extensions

Metadata for each tracked extension (both own and competitors).

| Field | Type | Description |
|-------|------|-------------|
| id | string | CWS extension ID (from URL) |
| name | string | Extension name (latest known) |
| addedAt | Date | When the extension was added to tracking |
| lastScannedAt | Date \| null | Last successful data fetch |
| status | string | 'active' \| 'removed' \| 'error' |
| projectRefs | string[] | List of project IDs that reference this extension (for cleanup) |

**Extension Lifecycle & Cleanup:**

When a user deletes a project or removes a competitor, the system must determine whether the extension is still referenced by any other project:

1. On removing an extension from a project: decrement its `projectRefs`. If `projectRefs` becomes empty, prompt the user: "This extension is no longer tracked in any project. Delete its historical data?" If yes, delete all associated `listing_snapshots`, `rank_snapshots`, `events`, and `translation_snapshots`. If no, keep the extension as an orphan (can be re-added later).
2. On deleting a project: iterate through all `competitorIds` and `ownExtensionId`, apply the same logic per extension.
3. Background cleanup: during daily scan startup, scan for orphaned extensions with empty `projectRefs` older than 30 days and auto-delete their data.

#### 4.1.3 keywords

Keywords tracked for rank position monitoring.

| Field | Type | Description |
|-------|------|-------------|
| id | string (auto) | Unique keyword ID |
| text | string | The keyword or phrase |
| projectId | string | Associated project |
| createdAt | Date | When keyword was added |

**Note on keyword coupling:** Keywords currently belong to exactly one project. If the same keyword text is tracked in multiple projects, it creates separate keyword records and separate rank_snapshot records. This means duplicate CWS searches for the same query. This is an accepted trade-off for schema simplicity. See Section 13 (Open Questions) for future optimization.

#### 4.1.4 listing_snapshots

Daily snapshots of extension listing data. One record per extension per scan day.

| Field | Type | Description |
|-------|------|-------------|
| id | string (auto) | Unique snapshot ID |
| extensionId | string | CWS extension ID |
| date | string (YYYY-MM-DD) | Snapshot date |
| title | string | Extension title |
| shortDescription | string | Short description (subtitle) |
| fullDescription | string | Full description text |
| rating | number | Average star rating (0-5) |
| ratingCount | number | Total number of ratings |
| reviewCount | number | Total number of reviews |
| userCount | string | User count string (e.g., "9,000+") |
| userCountNumeric | number | Parsed numeric user count |
| version | string | Current extension version |
| lastUpdated | string | Last updated date from CWS |
| size | string | Extension file size |
| permissions | string[] | List of declared permissions |
| hostPermissions | string[] | List of host permissions |
| permissionRiskScore | number | Calculated risk score (0-100) |
| badgeFlags | object | Featured, Editor's pick, etc. |
| screenshotCount | number | Number of screenshots |
| hasPromoVideo | boolean | Whether promo video exists |
| translationCount | number | Number of supported locales |
| availableLocales | string[] | List of locale codes |
| category | string | CWS category |
| developerName | string | Publisher name |
| developerVerified | boolean | Whether developer is verified |
| listingQualityScore | number | Calculated composite score (0-100) |
| scannedAt | Date | Exact scan timestamp |

#### 4.1.5 rank_snapshots

Keyword ranking data. One record per tracked extension found (or not found) in a keyword search.

**Important:** A single keyword search produces multiple rank_snapshot records - one for each tracked extension. The search is performed once per keyword, and positions of all tracked extensions are extracted from the same search results page.

| Field | Type | Description |
|-------|------|-------------|
| id | string (auto) | Unique snapshot ID |
| keywordId | string | Tracked keyword ID |
| extensionId | string | CWS extension ID |
| date | string (YYYY-MM-DD) | Snapshot date |
| position | number \| null | Rank position (1-based). `null` means the extension was not found in the first page of results (~20-30 results). This does NOT mean unranked - it means ranked beyond the scanned range. |
| totalResults | number | Total extensions in search results |
| scannedAt | Date | Exact scan timestamp |

#### 4.1.6 events

Detected changes between snapshots. Used for chart annotations and change history.

| Field | Type | Description |
|-------|------|-------------|
| id | string (auto) | Unique event ID |
| extensionId | string | CWS extension ID |
| date | string (YYYY-MM-DD) | When the change was detected |
| type | string | 'title_change' \| 'description_change' \| 'version_change' \| 'permission_change' \| 'rating_milestone' \| 'user_milestone' \| 'translation_change' \| 'screenshot_change' \| 'badge_change' |
| field | string | Specific field that changed |
| oldValue | string \| null | Previous value (stringified) |
| newValue | string \| null | New value (stringified) |
| note | string | Human-readable description of the change |

#### 4.1.7 translation_snapshots

Localized listing data fetched during manual translation audits.

| Field | Type | Description |
|-------|------|-------------|
| id | string (auto) | Unique snapshot ID |
| extensionId | string | CWS extension ID |
| locale | string | Locale code (e.g., "es", "zh_CN") |
| date | string (YYYY-MM-DD) | Audit date |
| title | string | Localized title |
| shortDescription | string | Localized short description |
| fullDescription | string | Localized full description |
| descriptionLength | number | Character count of full description |
| detectedLanguage | string \| null | Detected language of the content |
| manipulationFlags | ManipulationFlags | Structured flags for each manipulation type (see 4.1.7.1) |
| scannedAt | Date | Exact scan timestamp |

##### 4.1.7.1 ManipulationFlags Type Definition

```typescript
interface ManipulationFlags {
  differentName: {
    detected: boolean;
    similarity: number;       // 0-1, Levenshtein-based (Latin) or brand-name check (non-Latin)
    details?: string;
  };
  differentShortDesc: {
    detected: boolean;
    similarity: number;
    details?: string;
  };
  competitorNames: {
    detected: boolean;
    matches: string[];        // List of competitor names found
  };
  extendedDescription: {
    detected: boolean;
    ratio: number;            // This locale's length / median length across all locales
    details?: string;
  };
  keywordsAtEnd: {
    detected: boolean;
    excerpt?: string;         // First 200 chars of detected keyword block
  };
  keywordsInline: {
    detected: boolean;
    excerpt?: string;
  };
  differentDescription: {
    detected: boolean;
    similarity: number;       // Keyword overlap ratio (non-AI) or semantic score (AI)
  };
  untranslatedEnglish: {
    detected: boolean;
    englishRatio: number;     // 0-1, proportion of content detected as English
  };
}
```

#### 4.1.8 queue

Persistent job queue that survives service worker restarts (critical for MV3).

| Field | Type | Description |
|-------|------|-------------|
| id | string (auto) | Unique job ID |
| type | string | 'listing_scan' \| 'keyword_scan' \| 'translation_audit' |
| payload | object | Job-specific data (extensionId, keyword, locale, etc.) |
| status | string | 'pending' \| 'running' \| 'completed' \| 'failed' |
| priority | number | Job priority (lower = higher priority) |
| retryCount | number | Number of retry attempts |
| maxRetries | number | Maximum retries (default: 3) |
| scheduledAt | Date | When the job should execute |
| startedAt | Date \| null | When execution began |
| completedAt | Date \| null | When execution finished |
| error | string \| null | Error message if failed |

**Queue Cleanup Rules:**

- Completed jobs: delete after 7 days
- Failed (terminal) jobs: delete after 30 days (retained for debugging)
- Cleanup runs at the start of each daily scan cycle
- A manual "Clear Queue History" button is available in Settings

### 4.2 chrome.storage.local (Settings)

Settings and small configuration values are stored in `chrome.storage.local` rather than IndexedDB. This provides fast synchronous-like access via `chrome.storage.local.get()` and survives extension updates.

| Field | Type | Description |
|-------|------|-------------|
| openaiApiKey | string \| null | User's OpenAI API key (see Security section 8 for storage notes) |
| lemonSqueezyLicense | string \| null | License key for Pro tier |
| subscriptionStatus | string | 'free' \| 'pro' \| 'expired' |
| queueDelayMs | number | Base delay between requests (default: 60000) |
| queueJitterMs | number | Randomized jitter range (default: 10000, so delay = base +/- jitter) |
| dailyScanTime | string | Preferred daily scan time (HH:MM, default: "03:00") |
| dailyScanEnabled | boolean | Whether auto-scan is active |
| translationLocales | string[] | Locales to check during translation audit (default: see 5.3.6) |
| dataRetentionDays | number | How long to keep snapshots (default: 365) |
| lastDailyScanDate | string \| null | Date of last completed daily scan |
| parserVersion | string | Current parser version (for detecting parser breakage) |

### 4.3 IndexedDB Indexes

Key compound indexes for efficient querying:

- `listing_snapshots`: `[extensionId, date]` - fetch snapshots for an extension in a date range
- `rank_snapshots`: `[keywordId, extensionId, date]` - fetch rank history for a keyword-extension pair
- `rank_snapshots`: `[extensionId, date]` - fetch all ranks for an extension on a date
- `events`: `[extensionId, date]` - fetch events for chart annotations
- `translation_snapshots`: `[extensionId, date]` - fetch translation audit results
- `queue`: `[status, scheduledAt]` - fetch next pending job
- `queue`: `[status]` - count pending/running/failed jobs

### 4.4 Database Migration Strategy

Dexie.js handles schema migrations declaratively. Each version defines the full schema for stores that are new or changed. Dexie diffs the schemas automatically and creates/updates stores and indexes.

**Approach:**

- Each phase increments the database version: Phase 1 = v1, Phase 2 = v2, Phase 3 = v3, etc.
- Migrations are defined in the `CWSDatabase` class constructor:

```typescript
class CWSDatabase extends Dexie {
  projects!: Table<Project>;
  extensions!: Table<Extension>;
  // ... etc

  constructor() {
    super('cws-tracker');

    this.version(1).stores({
      projects: '++id, name',
      extensions: 'id, status',
      keywords: '++id, projectId',
      listing_snapshots: '++id, [extensionId+date], extensionId',
      rank_snapshots: '++id, [keywordId+extensionId+date], [extensionId+date]',
      events: '++id, [extensionId+date], type',
      translation_snapshots: '++id, [extensionId+date]',
      queue: '++id, [status+scheduledAt], status',
    });

    this.version(2).stores({
      // Phase 2: only list stores that change (others are preserved)
    });

    this.version(3).stores({
      // Phase 3: add or modify stores as needed
    }).upgrade(tx => {
      // Data migration logic if needed (e.g., backfill a new field)
    });
  }
}
```

- Only list stores/indexes that are new or changed in each version. Dexie preserves unchanged stores.
- Use `.upgrade(tx => ...)` for data migrations (backfilling fields, transforming records).
- Migrations must be additive. Never remove a store that has data without migrating it first.
- Test migrations with a populated database before each release.

---

## 5. Feature Specification

### 5.0 Phase 0 - Technical Spike

**Goal:** Validate core technical assumptions before writing production code. Duration: 2-4 hours.

**Tasks:**

1. **CWS Response Format Validation** (see Section 3.5 for details):
   - Fetch CWS detail page and search page from a MV3 service worker
   - Determine actual response format (server-rendered HTML, embedded JSON, or JS-required)
   - Determine if response varies by browser locale or Google account
   - Prototype a minimal parser

2. **Listing Quality Score Calibration:**
   - Analyze 20-30 top extensions across 3-4 different CWS categories
   - Record actual values for: title length, short description length, full description word count, screenshot count, translation count
   - Use actual data to set quality score thresholds (see 5.2.2) instead of arbitrary values
   - Document median and P90 values for each metric

3. **CWS Short Description Max Length:**
   - Verify the current CWS maximum character limit for short descriptions
   - CWS has changed limits historically; the quality score depends on accurate limits

**Exit Criteria:** A document with findings, confirmed parsing strategy, and calibrated quality score thresholds. If the CWS response requires JS rendering (Scenario C in 3.5), the architecture must be revised before proceeding to Phase 1.

---

### 5.1 Phase 1 - Core MVP

**Goal:** A fully functional keyword rank tracker and listing monitor for personal use. This phase delivers the core data collection pipeline, storage layer, and visualization dashboard.

#### 5.1.1 Project Management

**Description:** Users can create projects, each grouping their own extension with competitors and keywords.

**User Stories:**

- As a user, I can create a new project by providing my extension's CWS URL or ID
- As a user, I can add competitor extensions to a project by URL or ID
- As a user, I can add keywords to track for a project
- As a user, I can rename, edit, or delete projects
- As a user, I can see a list of all my projects on the dashboard home

**UI:** Dashboard home shows a card grid of projects. Each card shows: project name, own extension name + icon, competitor count, keyword count, last scan date. A "+" button opens a modal to create a new project. Clicking a project card opens the project detail view.

**Empty State:** When no projects exist (fresh install), show a centered welcome card with: brief explanation of CWS Tracker, a prominent "Create Your First Project" button, and a link to the onboarding guide.

#### 5.1.2 Extension Tracking

**Description:** Parse and store comprehensive listing data for all tracked extensions.

**Data Points to Parse from CWS Detail Page:**

- Title, short description, full description
- Star rating (average) and rating count
- Review count
- User count (both display string and parsed numeric)
- Current version and last updated date
- File size
- Permissions and host permissions (full list)
- Badges (Featured, Editor's Choice, etc.)
- Screenshot count and whether promo video exists
- Number of supported translations/locales
- Category
- Developer name and verification status

**Permission Risk Scoring:** Calculate a 0-100 risk score based on permissions. High-friction permissions that trigger scary install warnings get higher weights:

| Permission | Risk Weight | Install Warning |
|------------|-------------|-----------------|
| `<all_urls>` / broad host permissions | 30 | Read and change all your data on all websites |
| tabs | 20 | Read your browsing history |
| history | 25 | Read your browsing history |
| bookmarks | 15 | Read and change your bookmarks |
| webRequest | 15 | Observe and intercept network requests |
| cookies | 15 | Read cookies for all sites |
| activeTab | 5 | Access current tab on click (low friction) |
| storage, alarms, notifications | 0 | No warning shown |

#### 5.1.3 Keyword Rank Tracking

**Description:** Track where extensions appear in CWS search results for each keyword.

**Mechanism:** For each keyword, fetch the CWS search results page once. Parse the ordered list of all extension IDs from the results. For each tracked extension in the current project, record its position (1-based index). If an extension doesn't appear in the results, record position as `null`.

**Important distinction:** `position: null` means "not found in the first page of results (~20-30 results)." This does NOT mean the extension is unranked - it may be ranked at position 31+. The UI should display this as "30+" or "Not in top 30" rather than "Not ranked."

**Search Results Parsing:**

- CWS search returns paginated results (typically 20-30 per page)
- For MVP, parse the first page only (top ~20-30 results)
- A single keyword search yields rank data for ALL tracked extensions in the project
- Future optimization: paginate to find extensions ranked beyond page 1
- Store total result count for keyword difficulty estimation

**Job Count:** One CWS fetch per keyword (not per keyword-extension pair). See Section 6.5 for the corrected calculation.

#### 5.1.4 Queue System

**Description:** Persistent, resilient job queue that manages all CWS requests with rate limiting. This is the backbone of the data collection pipeline.

**Design Requirements:**

- **Persistence:** Queue is stored in IndexedDB, not memory. MV3 service workers can be terminated at any time - the queue must survive restarts.
- **Single Active Job:** Only one CWS request runs at a time. No parallel requests.
- **Delay:** 60-second base delay between requests with +/- 10s randomized jitter (configurable). Implemented via `chrome.alarms` since `setTimeout` doesn't survive service worker termination.
- **Retry:** Failed jobs retry up to 3 times with exponential backoff (2x delay per retry, max 10 minutes).
- **Priority:** Listing scans before keyword scans. User's own extensions before competitors.

**Queue Flow:**

1. Daily alarm fires (or user clicks "Refresh Now")
2. Queue cleanup: delete completed jobs older than 7 days, failed jobs older than 30 days
3. Queue builder creates jobs: 1 `listing_scan` per tracked extension + 1 `keyword_scan` per unique keyword
4. Jobs are written to IndexedDB queue store with `status='pending'`
5. Queue processor picks the highest-priority pending job, sets `status='running'`
6. Execute the job in a `try/catch` (fetch + parse + store snapshot)
7. On success: set job `status='completed'`, send progress message to dashboard, schedule next alarm with randomized delay
8. On failure: set job `status='failed'` or back to `'pending'` (if retries remain with increased delay), send error message to dashboard, schedule next alarm
9. On next alarm, pick next pending job and repeat
10. When no pending jobs remain, update `lastDailyScanDate`, send `SCAN_COMPLETE` message

**Estimated Run Times (10 extensions, 20 keywords):**

| Job Type | Count | Delay | Total Time |
|----------|-------|-------|------------|
| Extension listing scans | 10 | ~60s each | ~10 minutes |
| Keyword search scans | 20 | ~60s each | ~20 minutes |
| **Total** | **30 jobs** | - | **~30 minutes** |

**Note:** Each keyword search is performed once and yields rank data for all tracked extensions. The previous estimate of 200+ jobs was incorrect - it mistakenly counted one request per keyword-extension pair.

#### 5.1.5 Dashboard UI

**Description:** Full-page Vue 3 application at `dashboard.html` with the following views.

**Navigation Structure:**

- **Home:** Project card grid, quick stats summary, scan status
- **Project Detail:** Tab-based view for a selected project (Overview, Rankings, Extensions, Keywords, Events)
- **Overview Tab:** Key metrics cards (rank changes since last scan, rating changes, user growth), recent events timeline
- **Rankings Tab:** ApexCharts line chart showing rank positions over time. X-axis: dates. Y-axis: position (inverted, 1 at top). One line per extension per keyword. Keyword selector dropdown. Date range picker. Event markers on chart (annotations).
- **Extensions Tab:** Table of all tracked extensions with latest metrics. Sortable columns. Click to see extension detail and snapshot history.
- **Keywords Tab:** Table of tracked keywords with latest positions for each extension. Add/remove keywords.
- **Events Tab:** Chronological list of all detected changes across tracked extensions.
- **Settings:** Global settings page (API keys, scan schedule, queue delay, data retention, license management)

**Empty & Error States (all views):**

| State | What to Show |
|-------|-------------|
| No projects yet | Welcome card + "Create First Project" CTA |
| Project has no scans yet | Skeleton layout + "Run First Scan" button + expected time estimate |
| Scan in progress | Progress bar: "Scanning: 15/30 jobs - ~15 min remaining" |
| All scans failed | Error card with failure reasons + "Retry" button + link to Settings |
| No rank data for keyword | "Not in top 30" indicator with tooltip explaining the limitation |
| Extension removed from CWS | "Removed" badge on extension card, last known data preserved |
| IndexedDB quota near limit | Warning banner in dashboard header with link to data retention settings |
| Parser broken (unexpected nulls) | Alert: "CWS may have changed format. Check for extension updates." |

#### 5.1.6 Popup

**Description:** Lightweight popup showing quick status information.

**Contents:**

- Scan status indicator (idle, running with progress, last run time)
- Top 5 rank changes since last scan (up/down arrows with position change)
- Quick action buttons: "Open Dashboard", "Refresh Now", "Pause/Resume Scanning"
- Alert count badge on extension icon when notable changes detected

**Tier-Specific Behavior:**

- **Pro tier:** Shows "changes since last scan" (daily auto-scans mean this is typically "today's changes")
- **Free tier:** Shows "changes since last scan" with the last scan date prominently displayed. If last scan was > 7 days ago, show a nudge: "Last scanned X days ago" with a prominent "Refresh Now" button. No daily auto-scan on free tier, so changes reflect whatever was captured during the last manual refresh.

---

### 5.2 Phase 2 - Intelligence

**Goal:** Transform raw data into actionable insights through comparison, scoring, and change detection.

#### 5.2.1 Listing Comparison View

**Description:** Side-by-side comparison of extension listings for competitive analysis.

**Comparison Fields:**

- **Title:** Side-by-side with character count, keyword highlighting
- **Short Description:** Side-by-side with character count, keyword density
- **Full Description:** Side-by-side with word count, keyword frequency analysis, readability score
- **Permissions:** Diff view showing shared vs unique permissions, risk score comparison
- **Metrics:** Rating, reviews, users, screenshots, translations - bar chart comparison
- **Keyword Density:** For each tracked keyword, show frequency in title/short desc/full desc across extensions

**UI:** Select 2-4 extensions from the project to compare. Two-column layout (or horizontal scroll for 3-4). Diff highlighting for textual fields. Metrics comparison as small bar charts.

#### 5.2.2 Listing Quality Score

**Description:** A composite 0-100 score rating how well-optimized a listing is, similar to a Lighthouse score.

**Scoring Components:**

| Component | Weight | Scoring Criteria |
|-----------|--------|-----------------|
| Title optimization | 15% | Optimal length range*, contains primary keyword, no keyword stuffing |
| Short description | 10% | Optimal length range*, contains keywords, compelling CTA |
| Full description | 15% | Optimal word count*, structured with sections, contains keywords naturally |
| Visual assets | 15% | Optimal screenshot count*, has promo video, has promo tile images |
| Ratings & reviews | 15% | 4.0+ rating, 10+ reviews, recent reviews |
| Translations | 10% | 10+ locales supported, major markets covered |
| Update freshness | 10% | Updated within last 90 days |
| Permissions | 5% | Low permission risk score, no unnecessary broad permissions |
| Developer profile | 5% | Verified developer, developer website present |

**\* Calibration Required:** Thresholds marked with * must be calibrated during Phase 0 Technical Spike using real CWS data from top-ranking extensions. The Phase 0 analysis of 20-30 extensions will determine actual optimal ranges for title length, description length, screenshot count, and short description length. Do not hardcode arbitrary values.

Each component is scored 0-100 individually, then weighted. The dashboard shows both the composite score and a breakdown radar chart.

#### 5.2.3 Event Detection & Chart Annotations

**Description:** Automatically detect changes between daily snapshots and display them as annotations on the ranking chart.

**Detected Events:**

- **Title Change:** Compare title field between consecutive snapshots
- **Description Change:** Compare both short and full descriptions (use text diff)
- **Version Update:** New version string detected
- **Permission Change:** Permissions added or removed (high-impact alert)
- **Translation Change:** Translation count increased or decreased
- **Screenshot Change:** Screenshot count changed
- **Rating Milestone:** Rating crossed a whole number threshold (e.g., 3.9 to 4.0)
- **User Milestone:** User count crossed a major threshold (1K, 5K, 10K, etc.)
- **Badge Change:** Featured or Editor's Choice badge added/removed

**Chart Integration:** Events appear as vertical annotation lines on the ApexCharts ranking chart. Hovering shows the event details. Users can toggle event types on/off. Different colors for different event types (e.g., red for permission changes, blue for version updates, green for milestones).

#### 5.2.4 Keyword Analysis

**Description:** Analyze keyword usage across all tracked extensions to identify optimization opportunities.

**Features:**

- **Keyword Frequency Matrix:** Table showing how often each tracked keyword appears in each extension's title, short desc, and full desc
- **Keyword Gap Analysis:** Keywords that competitors use but the user's extension doesn't
- **Most Used Keywords:** Extract top keywords from all competitor descriptions combined
- **Keyword Difficulty Estimate:** Based on average rating, user count, and listing quality of top-ranking extensions for that keyword

#### 5.2.5 Change Diff View

**Description:** When an event is detected, provide a detailed diff showing exactly what changed. For text fields (title, descriptions), show inline diff with additions in green and deletions in red. For permission changes, show added/removed permissions with their risk implications.

---

### 5.3 Phase 3 - AI & Translation Analysis

**Goal:** Add AI-powered optimization tools and the translation manipulation detection engine.

#### 5.3.1 OpenAI API Integration

**Description:** Users provide their own OpenAI API key to unlock AI features. The key is stored in `chrome.storage.local` (see Section 8 for security notes).

**API Usage:**

- Model: GPT-4o (best balance of quality and cost for text analysis)
- All API calls made directly from service worker (no backend proxy needed)
- Cost estimation shown before each AI action (approximate token count)
- Error handling for rate limits, invalid keys, insufficient credits

#### 5.3.2 Keyword Audit - "Why Is Competitor Higher?"

**Description:** For a given keyword where a competitor outranks the user's extension, provide an AI-generated analysis explaining likely ranking factors.

**Analysis Inputs (sent to GPT-4o):**

- Both extensions' titles, short descriptions, full descriptions
- Keyword being analyzed
- Both extensions' metrics (rating, reviews, users, permissions, translations)
- Listing quality scores for both
- Keyword frequency in both listings

**Expected Output:** Structured analysis covering: keyword relevance scoring, metric advantages/disadvantages, specific actionable recommendations to improve ranking for this keyword.

#### 5.3.3 AI Title & Description Generator

**Description:** Generate optimized title and description suggestions based on top-ranking competitors for target keywords.

**Workflow:**

1. User selects target keywords for optimization
2. System collects top 5-10 ranking extensions' listings for those keywords
3. Sends to GPT-4o with prompt: "Generate an optimized title and description for a Chrome extension that [user's extension purpose]. Target keywords: [list]. Here are the top-ranking competitors' listings for reference: [data]. Generate suggestions that are unique, compelling, and naturally incorporate target keywords."
4. Display 3 title suggestions and 2 description suggestions
5. User can copy, edit, or regenerate

#### 5.3.4 AI Keyword Extraction

**Description:** Extract high-value keywords from competitor descriptions that the user might not be targeting.

**Workflow:** Send competitor descriptions to GPT-4o. Prompt asks to extract: primary keywords (high intent, directly related), secondary keywords (related topics, adjacent use cases), long-tail phrases (specific queries users might search). Results are displayed as a keyword suggestion list that can be one-click added to tracking.

#### 5.3.5 AI Tools Tab

**Description:** A dedicated tab in the project view for AI-powered tools.

**Tab Contents:**

- OpenAI API key status indicator and balance check
- Keyword Audit tool (select keyword + competitor, run analysis)
- Title/Description Generator (select target keywords, run generation)
- Keyword Extractor (select competitors, extract keywords)
- History of past AI analyses (stored locally)

**Contextual AI Buttons:** In addition to the dedicated tab, AI actions appear contextually throughout the UI. Examples: a "Why higher?" button next to each competitor's rank in the rankings table, an "Optimize" button in the listing comparison view, an "Extract keywords" button on each competitor's extension detail card.

#### 5.3.6 Translation Manipulation Detection

**Description:** The flagship differentiating feature. Analyze localized listings across multiple locales to detect manipulation tactics commonly used to game CWS search.

**Trigger:** Manual only - user clicks "Run Translation Audit" button. This creates `translation_audit` jobs in the queue for each extension x locale combination.

**Default Locales to Scan (configurable):** en, es, fr, de, pt_BR, ja, zh_CN, ko, ru, ar, hi, it, nl, pl, tr (15 locales)

**Locale Classification by Script Type:**

| Script Type | Locales | Implication for Detection |
|-------------|---------|---------------------------|
| Latin | en, es, fr, de, pt_BR, it, nl, pl, tr | Levenshtein distance works for name/description similarity |
| Non-Latin | ja, zh_CN, ko, ar, hi, ru | Levenshtein fails - use brand-name retention check + AI semantic comparison |

**Request Volume:** 15 locales x 10 extensions = 150 requests at ~60s delay = ~2.5 hours for a full audit. Users can select fewer locales or specific extensions to audit.

**Detection Algorithms:**

**1. Different Extension Name**

- **Latin-script locales:** Compare title using Levenshtein distance. Flag if similarity < 50%.
- **Non-Latin-script locales:** Check if the original brand name (or key Latin-character words) is still present in the localized title. Many legitimate translations retain the English brand name (e.g., "AdBlock Plus" stays the same in Japanese). Flag if brand name is completely absent AND no recognizable transliteration is found.
- **All locales:** Flag if title contains known competitor names.
- **AI-enhanced (optional):** Send English + localized titles to GPT-4o to assess if they refer to the same product.
- Severity: HIGH (strong signal of intentional manipulation)

**2. Different Short Description**

- Compare short description across locales
- For Latin-script locales: flag if similarity < 60% compared to English version
- For non-Latin-script locales: check keyword overlap using extracted Latin-character terms
- Flag if description is replaced with a keyword list (detect comma-separated patterns)
- Severity: MEDIUM

**3. Competitor Names in Text**

- Build a name list from all tracked competitors in the project
- Scan all localized titles, short descriptions, and full descriptions for competitor name matches
- Flag exact matches and fuzzy matches (Levenshtein distance < 3 for Latin text)
- Severity: HIGH

**4. Considerably More Extensive Description**

- Calculate description length (character count) for each locale
- Compute median description length across all locales
- Flag any locale where description length > 2x the median
- Flag especially if the extra content is in English (not the target locale language)
- Severity: MEDIUM-HIGH

**5. Keywords at End of Description**

- Detect pattern: description text followed by multiple newlines followed by comma-separated or line-separated single words/short phrases
- Regex: look for 3+ consecutive newlines followed by short lines (< 50 chars each) for 5+ lines
- Flag with excerpt showing the detected keyword block
- Severity: HIGH (very common manipulation tactic)

**6. Keywords Within Description**

- Detect blocks of comma-separated single words/phrases embedded in description text
- Look for repeated similar sentences with only 1-2 word variations (template-based keyword injection)
- Flag English keyword blocks within non-English descriptions
- Severity: MEDIUM

**7. Completely Different Description**

- For locales where a translation exists, compare semantic similarity to English description
- **Non-AI approach:** Compare keyword/term overlap between English and localized versions. Extract Latin-character terms from both and compute Jaccard similarity.
- **AI-enhanced:** Send both versions to GPT-4o to assess whether they describe the same product
- Severity: HIGH

**8. Untranslated English in Non-English Locales**

- Simple language detection: check if non-English locale content is predominantly English characters/words
- Use a basic language detection heuristic (common word frequency per language) or a lightweight library
- Flag if > 70% of content appears to be English in a non-English locale
- Severity: LOW-MEDIUM (could be accidental, but often combined with keyword stuffing)

**Translation Audit Report UI:**

- Summary card per extension showing overall manipulation score (0-100)
- Breakdown by manipulation type with severity badges (High/Medium/Low)
- Expandable details showing the specific flagged content with locale code
- Comparison table: locale vs locale showing title/description differences
- Export audit results as JSON for evidence/reporting

---

### 5.4 Phase 4 - Publish & Monetize

**Goal:** Prepare the extension for public release on CWS with freemium subscription model.

#### 5.4.1 LemonSqueezy Integration

**Description:** Subscription management using LemonSqueezy's JS SDK for license validation. No custom backend required.

**Implementation:**

- User enters license key in Settings (obtained from LemonSqueezy checkout page)
- Extension validates key via LemonSqueezy API on activation and periodically (every 24h)
- License status cached in `chrome.storage.sync` (syncs across Chrome profiles)
- Grace period: 3 days of Pro access if validation fails (network issues)
- Clear visual indicator of current plan in popup and dashboard header

#### 5.4.2 Server-Side Scanning (Pro Feature)

**Description:** Daily automated scanning that runs on the server regardless of whether the user's browser is open. This is the primary Pro feature and value proposition — users get daily ranking data without any manual action.

**Architecture:** Extends the existing Cloudflare Worker proxy with:

1. **Cloudflare D1** (SQLite) — Stores user scan configurations (which extensions/keywords to track) and scan results
2. **Cloudflare Cron Triggers** — Triggers daily scan cycle (one cron trigger, processes all Pro users)
3. **Sync API** — New endpoints for the extension to register scan configs and pull server-collected results

**Data flow:**
```
1. Extension registers scan config (projects, keywords, extensions) → D1
2. Cron Trigger fires daily → reads all Pro user configs from D1
3. Deduplicates queries (same keyword/extension across users = one fetch)
4. Fetches CWS via existing proxy logic (/detail, /search, /autocomplete)
5. Stores results in D1 (keyed by user + date)
6. Extension pulls latest results from D1 → merges into local IndexedDB → displays in dashboard
```

**New proxy endpoints:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/scan-configs` | PUT | Register/update user's scan configuration |
| `/api/scan-configs` | GET | Retrieve current scan configuration |
| `/api/results` | GET | Pull scan results since last sync (paginated) |
| `/api/results/latest` | GET | Pull most recent scan results only |

**Deduplication strategy:**
- Many users track the same popular extensions (uBlock Origin, Grammarly, etc.) and keywords ("ad blocker", "vpn")
- Before executing the daily scan, collect all unique (keyword, locale) and (extensionId, locale) pairs across all Pro users
- Fetch each unique pair once, then fan out results to all users who track it
- Estimated 50-70% overlap reduces CWS request volume significantly

**Cost analysis (50 Pro users):**
- ~78 requests/user/day × 50 users = 3,900 raw requests/day
- After deduplication: ~1,200-1,950 unique requests/day
- Cloudflare Workers free tier: 100K requests/day — ample headroom
- Cloudflare D1 free tier: 5GB storage, 5M reads/day — ample headroom
- Infrastructure cost: **$0/mo** until ~500+ users, then **$5/mo** (Workers Paid plan)

**CWS rate limiting mitigation:**
- Spread scans across 24-hour window with configurable delays and jitter (reuse existing queue delay pattern)
- ~1,200-1,950 requests/day ÷ 24h = ~1 request/minute (trivial load)
- Exponential backoff on 429/5xx errors (existing retry logic)

**Free tier behavior:** Manual scanning only, client-side via chrome.alarms (current architecture). No server storage. Data lives only in local IndexedDB with 14-day auto-prune.

**Pro tier behavior:** Server-side daily scanning. Results stored on server indefinitely. Extension syncs results on open. Future: web dashboard access, email/Slack alerts.

#### 5.4.3 Tier Structure

| Feature | Free | Pro ($14/mo or $120/yr) |
|---------|------|------------------------|
| Projects | 1 | Unlimited |
| Extensions per project | 3 (1 own + 2 competitors) | Unlimited |
| Keywords per project | 5 | Unlimited |
| Historical data retention | 14 days | Unlimited |
| Daily auto-scan | No (manual only) | Yes |
| Rank position chart | Yes | Yes |
| Listing comparison | Basic (2 extensions) | Full (unlimited) |
| Listing Quality Score | Yes | Yes |
| Event detection | Yes | Yes |
| Change diff view | No | Yes |
| Translation audit | No | Yes |
| AI Tools (BYOK) | No | Yes |
| Keyword audit | No | Yes |
| Export (CSV/JSON) | No | Yes |
| Backup/Restore | No | Yes |

#### 5.4.3 Onboarding Flow

**Description:** Guided setup for new users to get value quickly.

**Steps:**

1. Welcome screen explaining what CWS Tracker does
2. Create first project: enter your extension URL/ID
3. Add 1-2 competitors (or skip - suggest popular extensions in same category)
4. Add 3-5 keywords to track
5. Trigger first manual scan
6. Show dashboard with skeleton state and progress bar while scan runs (~30 minutes)
7. Notification when first scan completes

#### 5.4.4 Data Management

- **Export:** Export all data or per-project data as JSON or CSV. CSV format for spreadsheet analysis.
- **Backup:** Full database export as a single JSON file. Includes all stores.
- **Restore:** Import a backup file. Validates schema before import. Option to merge or replace.
- **Data Retention:** Configurable retention period. Background job prunes old snapshots beyond retention period.
- **Storage Usage:** Settings page shows current IndexedDB usage (approximate size) and record counts per store.

---

### 5.5 Phase 5 - Advanced (Post-Launch)

**Goal:** Advanced features driven by user feedback and market demand.

- **Search Autocomplete Tracking:** Monitor CWS search suggestions for tracked keywords. Track how autocomplete suggestions change over time. Use as a keyword discovery tool.
- **New Competitor Alerts:** Periodically search tracked keywords and flag new extensions entering the top results that aren't in the project's competitor list.
- **Weekly Digest:** Chrome notification or popup summary: rank changes, competitor changes, new events, action items.
- **Review Sentiment Analysis:** Use OpenAI to categorize reviews by topic and sentiment. Track sentiment trends over time. Flag critical negative reviews.
- **Category Ranking:** Track position within CWS categories (not just keyword search).
- **Related Extensions Tracking:** Monitor which extensions appear in the "Related" section of each tracked listing. Detect when user's extension appears on competitor pages.
- **Search Pagination:** Extend keyword search scraping to page 2+ of results, enabling tracking of extensions ranked beyond position 30.

---

## 6. Queue System - Detailed Design

The queue system is the most critical infrastructure component. It must be resilient to service worker termination, handle errors gracefully, and respect rate limits.

### 6.1 Job Lifecycle

Every job follows this lifecycle: PENDING -> RUNNING -> COMPLETED | FAILED. Failed jobs with retries remaining return to PENDING with an increased delay.

| State | Trigger | Action |
|-------|---------|--------|
| PENDING | Job created or retry scheduled | Waiting for processor to pick up |
| RUNNING | Processor dequeues job | CWS request in progress |
| COMPLETED | Successful parse + storage | Results saved, job retained for 7 days then auto-deleted |
| FAILED (retriable) | HTTP error, parse error, timeout | Increment retryCount, set back to PENDING with backoff delay |
| FAILED (terminal) | Max retries exceeded or fatal error | Log error, alert user, job retained for 30 days for debugging |

### 6.2 Backoff Strategy

| Retry # | Delay | Cumulative Wait |
|---------|-------|-----------------|
| 1 | 2 minutes | 2 minutes |
| 2 | 4 minutes | 6 minutes |
| 3 (final) | 8 minutes | 14 minutes |

### 6.3 Service Worker Resilience

MV3 service workers are event-driven and can be terminated by Chrome after ~30 seconds of inactivity. The queue must handle mid-execution termination:

- **On startup:** Check for any jobs with `status='running'`. Reset them to `'pending'` (they were interrupted by service worker termination).
- **Alarm scheduling:** Set the next `chrome.alarms` alarm AFTER job processing completes (success or failure), not before. This prevents race conditions where an alarm fires for the next job while the current job's error wasn't properly handled.
- **Alarm persistence:** `chrome.alarms.create('processQueue', { delayInMinutes: 1 })` persists across service worker restarts.
- **Atomic writes:** IndexedDB transactions are atomic - partial writes won't corrupt data.

### 6.4 Queue Processing Flow (Corrected)

```
1. Alarm fires (processQueue or dailyScan)
2. Check for 'running' jobs → reset to 'pending' (interrupted)
3. Pick highest-priority 'pending' job
4. If no pending jobs → scan complete, exit
5. Set job status = 'running'
6. try {
     Execute job (fetch CWS, parse, store snapshots)
     Set job status = 'completed'
     Send SCAN_PROGRESS message to dashboard
   } catch (error) {
     if (retryCount < maxRetries) {
       Set job status = 'pending', increment retryCount
       Set scheduledAt = now + backoff delay
     } else {
       Set job status = 'failed'
       Send SCAN_ERROR message to dashboard
     }
   }
7. Schedule next alarm: chrome.alarms.create('processQueue', {
     delayInMinutes: (queueDelayMs + randomJitter) / 60000
   })
```

### 6.5 Correct Job Count Calculation

A keyword search is performed once per keyword and returns positions for ALL tracked extensions. The job count is:

| Configuration | Listing Scans | Keyword Scans | Total Jobs | Time at 60s delay |
|---------------|---------------|---------------|------------|-------------------|
| 5 ext, 10 kw | 5 | 10 | 15 | ~15 min |
| 10 ext, 20 kw | 10 | 20 | 30 | ~30 min |
| 20 ext, 50 kw | 20 | 50 | 70 | ~70 min |
| 50 ext, 100 kw | 50 | 100 | 150 | ~2.5 hours |

The default configuration (10 extensions, 20 keywords) completes in approximately 30 minutes - well within the daily window. This is significantly more efficient than the per-keyword-per-extension approach.

**Note on keyword deduplication:** If the same keyword text exists in multiple projects, it currently creates separate queue jobs. A future optimization could deduplicate keyword searches and share results across projects.

### 6.6 Daily Scan Scheduling

The daily scan uses `chrome.alarms`:

- **On extension install:** Trigger first scan immediately via `chrome.runtime.onInstalled` listener, then set the recurring alarm:

```typescript
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('dailyScan', {
    delayInMinutes: 1,          // First run: 1 minute after install
    periodInMinutes: 1440       // Then every 24 hours
  });
});
```

- **When `dailyScan` alarm fires:** Check if `lastDailyScanDate` is today. If not, run queue cleanup, populate the queue, and start processing.
- **Manual trigger:** User clicks "Refresh Now" which clears existing pending jobs, repopulates the queue, and starts processing immediately.
- **Pause/Resume:** Toggle `dailyScanEnabled` setting. When paused, `dailyScan` alarm still fires but the handler returns early.

---

## 7. UI/UX Design Guidelines

### 7.1 Design Principles

- **Data-Dense but Readable:** Dashboard shows a lot of data - use cards, compact tables, and small multiples rather than spreading data across many pages.
- **Actionable:** Every data point should lead to an action. Show "Optimize" buttons next to low scores, "Why?" buttons next to competitor advantages.
- **Progressive Disclosure:** Summary first, details on click/expand. Don't overwhelm with all data at once.
- **Fast Perceived Performance:** Load from IndexedDB instantly. Show cached data while background scans run. Skeleton loaders for charts.
- **Graceful Degradation:** Every view must handle empty states, error states, and loading states. Users should never see a blank screen or cryptic error.

### 7.2 Color Scheme

- **Primary:** Blue (#2563EB) - actions, links, primary buttons
- **Success/Up:** Green (#16A34A) - rank improvements, positive changes
- **Warning:** Amber (#D97706) - medium severity flags, approaching limits
- **Danger/Down:** Red (#DC2626) - rank drops, high severity manipulation flags, permission risks
- **Neutral:** Slate grays for backgrounds, borders, secondary text
- **Chart palette:** Distinct colors per extension line (Blue, Orange, Green, Purple, Teal)

### 7.3 Key UI Components

- **Rank Change Badge:** Green up-arrow with "+N" or red down-arrow with "-N" for position changes. Gray dash for no change. "30+" badge for extensions not found in top results.
- **Quality Score Ring:** Circular progress indicator (like Lighthouse) with color-coded score (0-49 red, 50-79 amber, 80-100 green).
- **Manipulation Flag Badge:** Colored severity badges (HIGH: red, MEDIUM: amber, LOW: gray) with hover tooltip showing details.
- **Scan Progress Bar:** Shows "Scanning: 15/30 jobs - ~15 min remaining" with estimated time during active scans.
- **Event Timeline:** Vertical timeline with icons per event type, expandable to show diff details.
- **Extension Status Badge:** "Active" (green), "Removed" (red, for extensions taken down from CWS), "Error" (amber, for scan failures).

---

## 8. Security & Privacy

- **Data Storage:** All data stored locally in IndexedDB and chrome.storage. No data is sent to any server (except CWS for scraping and OpenAI for AI features when explicitly triggered by user).
- **OpenAI API Key:** Stored in `chrome.storage.local`, which is sandboxed per-extension by Chrome. No additional encryption is applied because in a client-side extension, the encryption key would need to be stored alongside the encrypted data, providing no meaningful additional security. The Chrome extension sandbox is the primary security boundary. The key is never logged or sent anywhere except directly to OpenAI's API endpoint.
- **LemonSqueezy License:** License key is validated against LemonSqueezy's API. Only the license key and extension version are sent - no usage data.
- **Permissions:** Extension requests minimal permissions. Required: `storage`, `alarms`. Host permission: `chrome.google.com/webstore/*` (for scraping). Optional host permissions (requested at runtime when needed): `api.openai.com/*`, `api.lemonsqueezy.com/*`.
- **No Analytics:** No telemetry, usage analytics, or crash reporting is collected. The extension is fully self-contained.
- **Data Portability:** Users can export all their data at any time via JSON backup. Data is never locked in.

---

## 9. Risks & Mitigations

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| CWS changes HTML/response structure, breaking parsers | High | Medium | Parser abstraction layer with versioned implementations (see 3.5). Quick-fix update cycle. Parser version tracking in settings to detect breakage automatically. Community bug reports. |
| CWS rate limits or blocks scraping requests | High | Medium | Conservative 60s delays with randomized jitter (+/- 10s). User-agent matches real Chrome. Graceful degradation (show cached data). Configurable delay for users who experience blocking. |
| CWS response format varies by browser locale or Google account | Medium | Medium | Phase 0 spike tests multiple locales. Parser handles both localized and non-localized response structures. |
| Service worker killed during scan | Medium | High | Persistent IndexedDB queue. Auto-reset 'running' jobs on startup. Alarm-after-processing pattern prevents race conditions. |
| IndexedDB storage grows too large | Medium | Medium | Data retention settings with auto-pruning. Queue cleanup rules. Storage usage monitor in Settings. Warn at 500MB. |
| CWS policy prohibits scraping | High | Low | Monitor CWS developer policies. No TOS violation identified currently. No automation beyond what a user does manually. Extension can pivot to content-script approach if needed. |
| Extension not found in first page of search results | Low | High | Clear UI distinction between "not in top 30" (position: null) vs truly unranked. Phase 5 adds pagination for deeper search. |
| OpenAI API costs concern users | Low | Medium | Show estimated cost before each AI action. Cache AI results. Limit context size sent to API. |
| LemonSqueezy API downtime | Low | Low | 3-day grace period for license validation. Cached subscription status. |
| CWS search results vary by geographic location | Medium | Medium | Document as known limitation. Results reflect the location of the user's browser. Cannot be controlled without a proxy (out of scope). |

---

## 10. Project Structure

```
cws-tracker/
  src/
    background/
      index.ts                  # Service worker entry point
      queue.ts                  # Queue manager class
      scheduler.ts              # Daily scan scheduling
      messaging.ts              # chrome.runtime message sending
      parsers/
        types.ts                # Parser interfaces (ListingParser, SearchParser)
        listing-parser.ts       # CWS detail page parser (versioned)
        search-parser.ts        # CWS search results parser (versioned)
        translation-parser.ts   # Localized listing parser (versioned)
    dashboard/
      App.vue                   # Dashboard root component
      main.ts                   # Dashboard Vue app entry
      router.ts                 # Vue Router config
      pages/
        HomePage.vue            # Project card grid
        ProjectPage.vue         # Project detail (tabs)
        SettingsPage.vue        # Global settings
      components/
        charts/
          RankChart.vue         # ApexCharts rank position chart
          QualityScoreRing.vue  # Circular score indicator
          MetricsComparison.vue # Bar chart comparison
        tables/
          ExtensionsTable.vue   # Extension list table
          KeywordsTable.vue     # Keyword rankings table
          EventsTimeline.vue    # Change events timeline
        comparison/
          ListingCompare.vue    # Side-by-side comparison
          DiffView.vue          # Text diff component
          PermissionsDiff.vue   # Permission comparison
        translation/
          AuditReport.vue       # Translation audit results
          ManipulationBadge.vue # Severity badge component
        ai/
          AuditTool.vue         # "Why higher?" tool
          Generator.vue         # Title/desc generator
          KeywordExtractor.vue  # AI keyword extraction
        common/
          EmptyState.vue        # Reusable empty state component
          ErrorState.vue        # Reusable error state component
          ScanProgress.vue      # Scan progress bar
          RankBadge.vue         # Rank change indicator (+N/-N/30+)
          StatusBadge.vue       # Extension status (Active/Removed/Error)
      composables/
        useProjects.ts          # Project CRUD operations
        useExtensions.ts        # Extension data access
        useKeywords.ts          # Keyword management
        useRankings.ts          # Rank snapshot queries
        useEvents.ts            # Event detection & queries
        useQueue.ts             # Queue status & control
        useSettings.ts          # Settings management
        useAI.ts                # OpenAI API wrapper
        useLicense.ts           # LemonSqueezy validation
        useServiceWorker.ts     # chrome.runtime message listener
    popup/
      App.vue                   # Popup root component
      main.ts                   # Popup Vue app entry
    shared/
      db/
        database.ts             # CWSDatabase class (extends Dexie) - schema, versions, and migrations in one file
        schema.ts               # TypeScript interfaces for all stores
      types/
        index.ts                # Shared TypeScript types
        messages.ts             # Message type definitions (SW <-> Dashboard)
      utils/
        permissions.ts          # Permission risk scoring
        quality-score.ts        # Listing quality calculator
        text-analysis.ts        # Keyword density, Levenshtein, etc.
        translation-checks.ts   # Manipulation detection algorithms
        diff.ts                 # Text diff utility
  public/
    dashboard.html              # Dashboard page HTML
    popup.html                  # Popup HTML
    icons/                      # Extension icons (16, 48, 128)
  manifest.json                 # MV3 manifest (source template - CRXJS generates production version)
  vite.config.ts                # Vite + CRXJS config
  tailwind.config.js            # Tailwind config
  tsconfig.json                 # TypeScript config
  package.json
  EXTENSION_DEV_GUIDE.md        # Chrome Extension Development Quick Reference Guide
```

---

## 11. Manifest V3 Configuration

**Note:** The manifest below is the source template. The CRXJS Vite Plugin (`@crxjs/vite-plugin`) processes this manifest during the build, resolving source paths (like `.ts` files) to their compiled outputs and handling content script injection, HMR during development, and production builds automatically.

```json
{
  "manifest_version": 3,
  "name": "CWS Tracker - Chrome Web Store ASO Tool",
  "version": "1.0.0",
  "description": "Track keyword rankings, monitor competitors, and optimize your Chrome Web Store listings.",
  "permissions": [
    "storage",
    "alarms",
    "notifications"
  ],
  "host_permissions": [
    "https://chrome.google.com/webstore/*"
  ],
  "optional_host_permissions": [
    "https://api.openai.com/*",
    "https://api.lemonsqueezy.com/*"
  ],
  "background": {
    "service_worker": "src/background/index.ts",
    "type": "module"
  },
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon-16.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png"
    }
  },
  "icons": {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  }
}
```

**Build Tooling:** The project uses `@crxjs/vite-plugin` to handle Chrome extension-specific build concerns:

- Generates production manifest with correct compiled asset paths
- Supports multi-entry builds (service worker, dashboard, popup)
- Provides HMR for Vue components during development
- Handles content security policy and web accessible resources

Refer to the "Chrome Extension Development Quick Reference Guide" (`EXTENSION_DEV_GUIDE.md`) for detailed build configuration, MV3 service worker patterns, and development workflow best practices.

---

## 12. Development Milestones

| Phase | Duration (Est.) | Key Deliverables | Exit Criteria |
|-------|----------------|------------------|---------------|
| Phase 0 - Technical Spike | 1-2 days | CWS response format validation, parser prototype, quality score calibration | Confirmed parsing strategy, calibrated thresholds, documented findings |
| Phase 1 - Core MVP | 4-6 weeks | Project management, extension tracking, keyword ranking, queue system, dashboard, popup | Can track 10 extensions + 20 keywords with daily scans completing in ~30 min, chart visualization working |
| Phase 2 - Intelligence | 3-4 weeks | Comparison view, quality score, event detection, keyword analysis, diff view | Can compare listings side-by-side with quality scores and event annotations on charts |
| Phase 3 - AI & Translation | 3-4 weeks | OpenAI integration, keyword audit, generators, translation manipulation detection | Can run translation audit and receive AI optimization suggestions |
| Phase 4 - Publish | 2-3 weeks | LemonSqueezy, onboarding, tier gating, export/backup, CWS listing | Extension published on CWS with working free/Pro tiers |
| Phase 5 - Advanced | Ongoing | Autocomplete, alerts, digest, sentiment analysis, search pagination | Features shipped based on user feedback and demand |

**Total estimated timeline to public launch (Phases 0-4): 12-17 weeks**

---

## 13. Open Questions & Future Considerations

1. **CWS HTML stability:** How often does CWS change its page structure? Need to monitor and version parsers. Consider a community-maintained parser definition file that can be updated without a full extension update.
2. **Search pagination:** Phase 1 only checks the first page of search results (~20-30 results). Extensions ranked 31+ are shown as "30+" in the UI. Phase 5 adds pagination. Should Phase 2 add it earlier?
3. **Geographic search variation:** CWS search results may vary by user location and language. This is a known limitation. Tracking would require a proxy or VPN, which is out of scope for a client-side extension. Document clearly in user-facing help.
4. **CWS search algorithm changes:** Rank positions may fluctuate due to algorithm changes, not listing changes. Could we detect potential algorithm shifts by looking for correlated rank changes across many extensions simultaneously?
5. **Extension removal detection:** If a tracked extension is removed from CWS, the fetcher will get a 404 or redirect. Mark the extension as `status='removed'` with last known data preserved. Show a "Removed" badge in the UI.
6. **Multi-browser future:** Should the architecture allow for Edge Add-ons support? The IndexedDB schema could accommodate a `store` field ('cws' \| 'edge') without breaking changes. Parser abstraction (Section 3.5) already supports this.
7. **Community features:** Should there be a shared keyword database or public ranking data? This would require a backend but could be a major differentiator. Evaluate post-launch based on user demand.
8. **Keyword deduplication across projects:** Currently, the same keyword text in multiple projects creates duplicate CWS search jobs. A future optimization could maintain a global keyword-to-projects mapping and deduplicate searches, sharing results across projects. This adds complexity to the queue builder but reduces request count for users with many projects.
9. **Keyword coupling trade-off:** Keywords belong to exactly one project (simple foreign key). If many users request cross-project keyword tracking, consider migrating to a many-to-many model with a `project_keywords` junction store. This would require a database migration (see 4.4).

---

## Appendix A: Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | Feb 2026 | Initial PRD |
| 2.0 | Feb 2026 | Fixed keyword scan count (200 -> 20-30 jobs). Added Phase 0 technical spike. Fixed settings storage contradiction. Added service worker <-> dashboard messaging. Added database migration strategy. Added extension lifecycle cleanup. Fixed Levenshtein for non-Latin scripts. Fixed queue alarm timing. Fixed alarm-before-processing race condition. Corrected manifest path notes. Specified CRXJS build plugin. Added queue cleanup rules. Defined ManipulationFlags type. Fixed API key security claims. Fixed free tier popup behavior. Added missing risks. Added empty/error states. Added parser abstraction. Referenced Chrome Extension Development Quick Reference Guide. |
