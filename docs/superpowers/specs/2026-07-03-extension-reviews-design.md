# Extension Reviews — Parsing & Analytics (Design Spec)

**Date:** 2026-07-03
**Status:** Design — pending final review
**Feature area:** ASO / competitive intelligence — review capture, change tracking, analytics, and a Reviews tab.

---

## 1. Goal

Capture, store, track, and analyze the user reviews shown on a Chrome Web Store
extension's `/reviews` page. Four user requirements:

1. **Parse & save reviews** — reviewer name, rating, message text, date, "people
   found it helpful" count, and developer replies ("answers").
2. **Regularly check for changes** — detect new and edited reviews (by updated
   date / content) on a recurring schedule.
3. **Analyze saved reviews** — keyword analysis of review text; count how many
   ratings have text vs. are rating-only ("empty").
4. **Reviews tab with analytics** — a new project tab with a polished UI/UX.

---

## 2. Feasibility findings (verified 2026-07-03)

The CWS reviews page (e.g.
`https://chromewebstore.google.com/detail/<slug>/<extId>/reviews`) **server-renders
the newest 10 reviews inline** in an `AF_initDataCallback({key:'ds:1', …})` block —
the same mechanism `listing-v1` already reads for `ds:0`. No login required. A
plain server-side GET returns all requested fields.

### 2.1 `ds:1` envelope layout

```
ds:1 = [
  [ continuationToken ],   // ds1[0][0] — base64 token (~376 chars) → fetch next page via RPC
  [ review, review, … ],   // ds1[1]    — newest reviews (10 per page), newest-first
  textReviewCount          // ds1[2]    — total number of reviews WITH text (e.g. 11)
]
```

### 2.2 Single review field map (array indices)

| Index | Field | Example |
|---|---|---|
| `[0]` | reviewId (stable UUID) | `0e714621-2985-48ba-827c-fa45cd024c41` |
| `[1]` | `[reviewerName, avatarUrl]` | `["Franklyn Moore", "https://…=s32"]` |
| `[2]` | rating (1–5) | `5` |
| `[3]` | message text (`""` if rating-only within the text-review list) | `"GREAT Tool…"` |
| `[4]` | timestamp A `[seconds, nanos]` | `2026-03-31T14:07:26Z` |
| `[5]` | timestamp B `[seconds, nanos]` | `2026-03-31T14:07:25Z` |
| `[6]` | helpful count | `1` |
| `[7]` | (unknown, `null`) | — |
| `[8]` | developer reply or `null` — `[replyId, [author, avatar], text, tsA, tsB, …, lang]` | `[…, "Ben", "Hi Franklyn…", 2026-03-31T16:57Z]` |
| `[11]` | extension version reviewed | `"3.4.29"` |
| `[13]` | review language | `"en"` |
| `[14]` | extension ID | `aliiafckfmihheljnphnkpfhlnnjmkgk` |

**Timestamp note:** `[4]` and `[5]` differ by ~1s in the sample (`[5]` slightly
earlier). Their exact posted-vs-updated semantics are not certain, so we **store
both** and use a **content hash** (rating + text + helpfulCount + replyText) as the
authoritative change signal, surfacing the later timestamp as "last updated" in the
UI. To be confirmed empirically against an edited review during implementation.

### 2.3 Text-vs-empty math (validated)

`textReviewCount` = `ds1[2]`; total ratings = listing card `card[4]`
(`ListingSnapshot.ratingCount`). **Empty (rating-only) = ratingCount − textReviewCount.**
Verified: 12 total − 11 text = 1 empty for the example extension.

### 2.4 Pagination / fetching more than 10 (RESOLVED — spike complete 2026-07-03)

The reviews-page HTML's `AF_dataServiceRequests` block maps `ds:1` to RPC method
**`x1DgCd`** with request payload `["<extId>", [<pageSize>], 2, null, null, null, 0]`
(`[0]`=extension id, `[1]`=`[pageSize]`, `[2]`=sort order). Verified directly against
`chromewebstore.google.com/_/ChromeWebStoreConsumerFeUi/data/batchexecute`:

- **Page size is slot `[1]`.** Requesting `[500]` returns 500 reviews **in a single
  call** (200 → 200, 100 → 100, 50 → 50). The response payload has the identical
  `[[token], [reviews…], textReviewCount]` shape as the inline `ds:1`, so `reviews-v1`
  parses it unchanged.
- **No build label, no session params, no CSRF token needed** — the RPC is public
  read-only data (like `QcU9bc` autocomplete). Confirmed working with `bl` omitted.
- **The continuation token does NOT advance** (tried slots [3]/[4]/[5] + offset [6];
  all returned page 1 or empty). Pagination is therefore *not* token-based — you simply
  request the page size you want.

**Consequence:** "up to `reviewFetchLimit`" is a **single** batchexecute call with
`[reviewFetchLimit]` as the page size (capped at 500, the setting's max). No SW
pagination loop, no token handling. The proxy `/reviews` endpoint issues this RPC and
returns the payload as `{ data }`; the page-1 inline-`ds:1` HTML path is unused.

---

## 3. Design decisions (resolved)

| Decision | Choice | Notes |
|---|---|---|
| **Corpus depth** | **Paginate up to a configurable cap, default 50** | New setting `reviewFetchLimit`. SW loops review pages (like keyword-search pagination), stopping at the cap, when `nextToken` is null, or when a full page is already-seen-and-unchanged (incremental stop keeps daily scans cheap). |
| **Scope** | **Own + competitors** | Review scan enqueued per tracked extension in a project (own + competitor IDs). Enables competitive review benchmarking. |
| **Cadence** | **Daily auto + manual "Refresh reviews"** | Review jobs added to the daily scan cycle (gated on proxy configured, like all scans) and triggerable on demand from the Reviews tab. |
| **Change events** | **Both timeline + Reviews tab** | New review, edited review (content changed), and new developer reply become `EventRecord`s and also drive a "Recent changes" list in the tab. Deletion detection deferred (unreliable with a bounded window). |

---

## 4. Architecture

Mirrors the existing proxy → queue → versioned-parser → Dexie → composable → tab
pipeline used by rankings and autocomplete.

```
Proxy /reviews endpoint   →   review_scan job   →   reviews-v1 parser   →   reviews DB table
  (page 1 HTML + RPC          (per extension,        (parse ds:1 /            (upsert by UUID,
   pages via token)            SW paginates)          RPC payload)             detect changes)
                                                                                     │
                                    Reviews tab   ←   useReviews composable   ←──────┘
                                  (+ Events timeline via EventRecord)
```

No new architectural concepts. `translation_audit` (a declared-but-unimplemented
job type) is *not* touched.

---

## 5. Components

### 5.1 Proxy (`~/Projects/cws-tracker-proxy` — separate repo)

Add a **`/reviews`** endpoint: `GET /reviews?id=<extId>&token=<optional>&key=<apiKey>`.
Response envelope is uniform and minimal — `{ data: <raw-json-string> }` — mirroring
`/autocomplete`'s convention. **All structural parsing (reviews, token, count) stays in
the extension's versioned parser** (per project rule: parsers are fixture-tested).

- Without `token` (page 1): fetch the `/detail/<slug>/<extId>/reviews` HTML, extract the
  `ds:1` block, return `{ data: <ds1-array-json> }`.
- With `token` (pages 2+): issue the CWS `batchexecute` reviews RPC and return the
  unwrapped inner payload as `{ data }`. The proxy strips the `batchexecute` envelope
  (as `/autocomplete` does for `QcU9bc`), leaving the raw review-page JSON.
- The `reviews-v1` parser accepts both the page-1 `ds:1` shape and the page-2+ RPC
  shape, extracting `{ reviews, textReviewCount, nextToken }` from each. If the two
  shapes diverge structurally, the parser branches on shape; exact page-2 layout is
  finalized after the Phase 0 spike.
- Proxy tests added for the new endpoint. Deployed via `npx wrangler deploy`.

> The exact CWS RPC method id, request body, and page-2 payload shape are filled in
> after the Phase 0 spike.

### 5.2 Parser — `reviews-v1` (`src/background/parsers/reviews-v1.ts`)

- Implements a new `ReviewsParser` interface in `parsers/types.ts`:
  `parse(json: string): ReviewsData` where
  `ReviewsData = { reviews: ParsedReview[]; textReviewCount: number | null; nextToken: string | null }`.
- Parses the `ds:1` array (page 1) and the RPC payload (pages 2+) into
  `ParsedReview` objects using the §2.2 field map. Resilient index access
  (`safeGet`), `ParserError` on missing required fields (reviewId, rating).
- Registered in `parser-factory.ts` (`getReviewsParser()`) and `parsers/index.ts`.
- Tested against saved fixtures in `tests/fixtures/` (a captured `/reviews` HTML and
  an RPC page-2 payload). No live CWS calls in tests.

`ParsedReview` shape:
```ts
interface ParsedReview {
  reviewId: string;
  extensionId: string;
  reviewerName: string;
  reviewerAvatar: string | null;
  rating: number;              // 1–5
  text: string;                // '' when rating-only
  postedAtEpoch: number;       // seconds
  updatedAtEpoch: number;      // seconds
  helpfulCount: number;
  devReply: { author: string; text: string; atEpoch: number } | null;
  versionReviewed: string | null;
  language: string | null;
}
```

### 5.3 Data model — schema **v5**, table `reviews`

Dexie migration:
```ts
this.version(5).stores({
  reviews: '++id, &reviewId, extensionId, [extensionId+postedDate], [extensionId+rating]',
});
```
`&reviewId` = unique index (upsert key). `[extensionId+postedDate]` for time-ordered
queries; `[extensionId+rating]` for distribution.

`Review` row (`src/shared/types/index.ts`):
```ts
interface Review {
  id?: number;
  reviewId: string;            // unique
  extensionId: string;
  reviewerName: string;
  reviewerAvatar: string | null;
  rating: number;
  text: string;                // '' if rating-only
  postedDate: string;          // YYYY-MM-DD (indexed)
  updatedDate: string;         // YYYY-MM-DD
  postedAtEpoch: number;
  updatedAtEpoch: number;
  helpfulCount: number;
  devReplyAuthor: string | null;
  devReplyText: string | null;
  devReplyDate: string | null;
  hasText: boolean;            // derived: text.trim().length > 0
  versionReviewed: string | null;
  language: string | null;
  contentHash: string;         // hash(rating|text|helpfulCount|devReplyText) — change signal
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastChangedAt: Date | null;
  isDeleted: boolean;          // reserved; always false in v1
}
```

DB methods (`CWSDatabase`): `saveReviews(reviews)` (upsert-by-reviewId with change
detection returning which were new/changed), `getReviews(extensionId, opts?)`,
`getReviewsInRange(extensionId, startDate, endDate)`, `getReviewStats(extensionId)`.
The new table is threaded into `deleteExtensionData(extensionId)` and
`pruneOldSnapshots(beforeDate)` (both enumerate every snapshot table).

> Reviews are entities, not per-day snapshots, so the upsert key is `reviewId` (not
> `[extensionId+date]`). Analytics are computed live from this table + the latest
> `ListingSnapshot.ratingCount`; no separate daily-aggregate table in v1.

### 5.4 Queue job — `review_scan`

- `QueueJobType` gains `'review_scan'`; `ReviewScanPayload = { extensionId: string }`
  added to the `QueueJobPayload` union.
- `queue-builder.ts`: `PRIORITY_REVIEW_SCAN` (e.g. `50`, after autocomplete);
  `createReviewScanJob(extensionId, now)`; a `review_scan` job appended per tracked
  extension in `buildDailyScanJobs`; standalone `buildReviewScanJobs(extensionIds)`
  for scoped manual scans.
- `queue-processor.ts`: `case 'review_scan'` → `processReviewScan(job, deps)`:
  1. Load settings; read `reviewFetchLimit`.
  2. Loop pages via `fetchReviewsWithLogging(extId, token)` (new logging-wrapped
     fetcher modeled on `fetchAutocompleteWithLogging`), with pagination delay+jitter
     between pages (as `processKeywordScan` does). Stop at `reviewFetchLimit`, when
     `nextToken` is null, or when a page is entirely already-seen-and-unchanged.
  3. Parse each page with `getReviewsParser()`.
  4. `db.saveReviews(...)`; collect new/changed for event detection.
  5. Emit `EventRecord`s + `NEW_EVENT` messages for new/edited/reply changes.
  - `getJobDescription` gains a `review_scan` branch (`Reviews: <name> (<extId>)`).

### 5.5 Scheduler / triggers

- Daily scan already enqueues via `buildDailyScanJobs` — review jobs ride along.
- `ScanType` (`messages.ts`) gains `'reviews'`; `scheduler.ts` `triggerManualRefresh`
  gains `else if (scanType === 'reviews') jobs = buildReviewScanJobs(...)`.
- UI: `useServiceWorker.requestRefresh(projectId, 'reviews')` from a "Refresh reviews"
  button; SW `index.ts` `TRIGGER_REFRESH` already routes to `triggerManualRefresh`.

### 5.6 Change detection & events

For each fetched review, `saveReviews` compares against the stored row by `reviewId`:
- **New** (`reviewId` unseen) → `EventRecord` type `review_new`.
- **Edited** (`contentHash` differs) → `review_edited`; `lastChangedAt` updated.
- **New developer reply** (reply appeared where there was none) → `review_reply`.

`EventType` union gains `'review_new' | 'review_edited' | 'review_reply'`. Events use
`extensionId` + `date = today()` (detection date), with a human-readable `note`
(e.g. `New ★1 review from "Jane": "…"`). Same-day rescans dedupe by deleting prior
same-type review events for the extension/date before re-inserting (mirrors
`detectRankChanges`). `event-colors.ts` gains colors for the new types.

### 5.7 Analytics — `useReviews` composable

Pure async loader functions (matching `useAutocomplete` style), reading from `db`:
- `loadReviewSummary(extensionId)` → `{ avgRating, totalRatings, textReviews, emptyReviews, ratingDistribution: number[5], capturedCount }` (joins latest `ListingSnapshot.ratingCount`).
- `loadReviewKeywords(extensionId, { minRating?, maxRating? })` → top terms/phrases via `text-analysis.ts` keyword extraction, filterable by rating band.
- `loadReviewSentiment(extensionId)` → sentiment breakdown via `text-analysis.ts`.
- `loadReviewTrend(extensionId, startDate, endDate)` → reviews-per-period + avg-rating trend.
- `loadReviewList(extensionId, { sort, filter })` → filterable/sortable rows.
- `loadRecentReviewChanges(extensionId, rangeDays)` → new/edited/reply items.
- `loadReviewComparison(extensions)` → per-extension avg rating / volume / sentiment (competitor benchmarking).

### 5.8 UI — Reviews tab (`ProjectPage.vue` + `components/project/ReviewsTab.vue`)

Register the tab in the four `ProjectPage.vue` spots (async import, `activeTab` union,
`tabs` array entry with an icon, `v-else-if` binding). `ReviewsTab.vue` layout:

- **Summary cards:** big avg rating; text-vs-empty donut; rating-distribution bars
  (5→1★); sentiment gauge.
- **Extension selector** (own + competitors) to switch which extension's reviews show.
- **Keyword analysis:** top terms as chips / lightweight cloud, filterable by star band.
- **Trend chart:** reviews over time + avg-rating line (ApexCharts wrapper).
- **Recent changes:** new/edited/reply list since last scans.
- **Review list:** sortable/filterable (rating, date, helpful, has-reply, has-text)
  with reviewer, rating, date, helpful count, message, and expandable developer reply.
- **Competitor comparison strip** (when >1 tracked extension).
- **"Refresh reviews"** button → `requestRefresh(projectId, 'reviews')`.

Tailwind only, follows the existing chart-color palette and empty-state conventions.

### 5.9 Settings — `reviewFetchLimit`

- `Settings` interface + `DEFAULT_SETTINGS` gain `reviewFetchLimit: number` (default
  **50**). `validatePartial` clamps to a sane range (e.g. 10–500).
- `SettingsPage.vue` + `useSettings` expose a numeric input ("Max reviews to fetch
  per extension per scan").

---

## 6. Build phasing

- **Phase 0 — RPC spike:** reverse-engineer the CWS reviews pagination `batchexecute`
  method via the browser; save a page-2 fixture. Deliverable: documented request +
  response shape.
- **Phase 1 — capture pipeline:** proxy `/reviews` endpoint; `reviews-v1` parser +
  fixtures/tests; schema v5 `reviews` table + DB methods; `review_scan` job wired
  into daily scan + manual refresh; `reviewFetchLimit` setting; change detection +
  events. Functional Reviews tab (summary cards, text/empty counts, review list).
- **Phase 2 — analytics polish:** keyword cloud, distribution/trend charts, sentiment,
  competitor comparison strip, recent-changes list.

---

## 7. Files to touch

| Layer | File(s) | Change |
|---|---|---|
| Proxy | `~/Projects/cws-tracker-proxy/*` | `/reviews` endpoint + tests + deploy |
| Parser | `parsers/types.ts`, `parsers/reviews-v1.ts`, `parser-factory.ts`, `parsers/index.ts` | `ReviewsParser`, `reviews-v1`, factory + barrel |
| Types | `shared/types/index.ts` | `Review`, `ReviewScanPayload`, `QueueJobType`, `EventType` additions |
| DB | `shared/db/database.ts` | `version(5)` migration, save/query methods, thread into delete/prune |
| Job build | `background/queue-builder.ts` | `PRIORITY_REVIEW_SCAN`, `createReviewScanJob`, `buildReviewScanJobs`, daily-scan hook |
| Processor | `background/queue-processor.ts` | `processReviewScan`, `fetchReviewsWithLogging`, dispatch, `getJobDescription` |
| Scheduler | `background/scheduler.ts`, `shared/types/messages.ts`, `background/index.ts` | `'reviews'` `ScanType` branch |
| Composable | `dashboard/composables/useReviews.ts` | analytics loaders |
| UI | `dashboard/pages/ProjectPage.vue`, `components/project/ReviewsTab.vue`, `components/charts/*`, `components/tables/*` | new tab + charts/tables |
| Settings | `shared/types/settings.ts`, `shared/utils/settings.ts`, `dashboard/pages/SettingsPage.vue`, `composables/useSettings.ts` | `reviewFetchLimit` |
| Events | `shared/utils/event-colors.ts` | colors for review event types |

---

## 8. Testing

- **Parser:** fixture-based (`tests/fixtures/reviews-*.html` / `-page2.json`) covering
  full review, rating-only, no-dev-reply, missing optional fields, empty list,
  malformed payload (→ `ParserError`).
- **DB:** `saveReviews` upsert idempotency; new/edited/reply detection via
  `contentHash`; `deleteExtensionData` / `pruneOldSnapshots` include `reviews`.
- **Processor:** `processReviewScan` pagination loop with mocked `fetchPage`
  (cap reached, `nextToken` null, incremental early-stop); event emission.
- **Analytics:** text-vs-empty math (ratingCount − textReviews), keyword extraction,
  distribution, filtering.
- **No live CWS network calls in any test.** All via `fake-indexeddb` + mocked fetch.

---

## 9. Edge cases

- Extension with **zero reviews** / rating-only extension → empty tab states,
  `textReviewCount = 0`.
- **404 / removed extension** during review scan → mark removed (as `listing_scan`
  does), job completes.
- **429 / 5xx / malformed** → retriable via existing backoff; page-1 failure
  propagates, page 2+ failure keeps earlier pages (mirrors search pagination).
- **SW killed mid-scan** → queue is in IndexedDB; `resetRunningJobs` on startup;
  already-saved reviews persist; next run resumes/re-scans idempotently.
- **Very active extension** (>`reviewFetchLimit` new reviews between scans) → capped;
  oldest new ones beyond the cap caught on subsequent scans as they surface.
- **Edited review where timestamps are ambiguous** → `contentHash` catches the change
  regardless of timestamp semantics.
- **Scale:** 10 extensions × 500 reviews cap = 5,000 rows — well within IndexedDB;
  queries are indexed by `[extensionId+…]`.

---

## 10. Versioning & process (per CLAUDE.md)

- Bump `manifest.json` **MINOR** (new feature). Add `CHANGELOG.md` entry.
- DB schema bumped to **v5** (migration added).
- Run `npm test` (all pass) + `npm run typecheck` (zero errors); no `any`/`@ts-ignore`.
- Smoke-test the loaded extension: Reviews tab renders, manual refresh runs a scan,
  reviews persist and analytics populate.
- Proxy repo: `npm test` + `npx wrangler deploy`; verify `/reviews` + `/health`.
