# Extension Reviews — Capture Pipeline Implementation Plan (Plan A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scan a CWS extension's reviews (own + competitors), store them, detect new/edited/reply changes, and surface them in a basic Reviews tab — with corpus depth capped by a configurable `reviewFetchLimit` (default 50).

**Architecture:** Mirror the existing autocomplete/rank pipeline. A new proxy `/reviews` endpoint returns raw review JSON; a versioned `reviews-v1` parser turns it into `ParsedReview[]`; a `review_scan` queue job (one per tracked extension, enqueued in the daily scan and triggerable manually) fetches + paginates in the SW, upserts into a new schema-v5 `reviews` table keyed by review UUID, and emits `EventRecord`s on change; a `useReviews` composable and `ReviewsTab.vue` display them.

**Tech Stack:** Vue 3 `<script setup>` + TypeScript (strict), Dexie v4 (IndexedDB), Vitest + fake-indexeddb + jsdom, Cloudflare Worker proxy (separate repo). Reference: design spec `docs/superpowers/specs/2026-07-03-extension-reviews-design.md`.

## Global Constraints

- **No `any`, no `@ts-ignore`.** All params/returns explicitly typed. (CLAUDE.md)
- **Parsers are versioned + fixture-tested.** Never mock parser internals; never make live CWS calls in tests. Fail loudly with `ParserError`. (CLAUDE.md)
- **All DB access via the `CWSDatabase` singleton `db`.** Schema bumps only via `db.version(N).stores()`. Never `await` external work inside a `db.transaction()`. Dates in indexes are `YYYY-MM-DD` strings; `Date` only for non-indexed metadata. (CLAUDE.md)
- **SW rules:** no `setTimeout`/`setInterval` for scheduling (use `chrome.alarms`); the in-job pagination `setTimeout` is allowed (SW stays alive during active processing, per `processKeywordScan`). Read state from IndexedDB every time. Register chrome listeners synchronously. (CLAUDE.md)
- **Queue:** one CWS request at a time; delay = base + randomized jitter; a non-empty `proxyUrl` is required to scan. (CLAUDE.md)
- **Post-implementation:** bump `manifest.json` (MINOR = feature), add `CHANGELOG.md` entry, mark TODO. DB migration ⇒ schema v5. (CLAUDE.md)
- **Import alias:** `@/` → `src/`. Cross-context imports via `@/shared/...`. SW never imports Vue/DOM.
- **Review field indices** (from spec §2.2, verified): `[0]`=reviewId, `[1]`=[name,avatar], `[2]`=rating, `[3]`=text, `[4]`/`[5]`=timestamps `[sec,nanos]`, `[6]`=helpful, `[8]`=devReply `[replyId,[author,avatar],text,tsA,tsB,…,lang]`, `[11]`=version, `[13]`=language, `[14]`=extId. Envelope `ds:1 = [[token],[reviews…],textReviewCount]`.

---

## File Structure

**New files:**
- `src/background/parsers/reviews-v1.ts` — `reviews-v1` parser (ds:1 + RPC page shapes → `ReviewsData`).
- `src/dashboard/composables/useReviews.ts` — analytics loaders (summary, list, text/empty, keyword counts).
- `src/dashboard/components/project/ReviewsTab.vue` — the tab UI.
- `tests/fixtures/reviews-website-broken-link-check.html` — captured `/reviews` page (page 1).
- `tests/unit/background/parsers/reviews-v1.test.ts`
- `tests/unit/shared/db/reviews.test.ts`
- `tests/unit/background/queue-builder-reviews.test.ts`
- `tests/unit/background/queue-processor-reviews.test.ts`
- `tests/unit/dashboard/composables/useReviews.test.ts`

**Modified files:**
- `src/background/parsers/types.ts` — `ReviewsParser`, `ReviewsData`, `ParsedReview`.
- `src/background/parsers/parser-factory.ts` + `index.ts` — `getReviewsParser()`.
- `src/shared/types/index.ts` — `Review`, `ReviewScanPayload`, `QueueJobType`, `EventType`.
- `src/shared/db/database.ts` — `version(5)`, `reviews` table, save/query methods, delete/prune threading.
- `src/background/queue-builder.ts` — priority, `createReviewScanJob`, `buildReviewScanJobs`, daily hook.
- `src/background/queue-processor.ts` — `processReviewScan`, `fetchReviewsWithLogging`, dispatch, `getJobDescription`.
- `src/background/scheduler.ts`, `src/shared/types/messages.ts`, `src/background/index.ts` — `'reviews'` `ScanType`.
- `src/shared/types/settings.ts`, `src/shared/utils/settings.ts` — `reviewFetchLimit`.
- `src/dashboard/pages/SettingsPage.vue`, `src/dashboard/composables/useSettings.ts` — settings input.
- `src/dashboard/pages/ProjectPage.vue` — tab registration (4 spots).
- `src/shared/utils/event-colors.ts` — review event colors.

**Separate repo (`~/Projects/cws-tracker-proxy`):** `/reviews` endpoint + tests + deploy.

---

## Task 1: `reviews-v1` parser (page-1 / `ds:1`) + fixture

**Files:**
- Create: `src/background/parsers/reviews-v1.ts`
- Modify: `src/background/parsers/types.ts` (add interfaces), `src/background/parsers/parser-factory.ts` + `index.ts` (export `getReviewsParser`)
- Create fixture: `tests/fixtures/reviews-website-broken-link-check.html`
- Test: `tests/unit/background/parsers/reviews-v1.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ParsedReview {
    reviewId: string; extensionId: string;
    reviewerName: string; reviewerAvatar: string | null;
    rating: number; text: string;
    postedAtEpoch: number; updatedAtEpoch: number;
    helpfulCount: number;
    devReply: { author: string; text: string; atEpoch: number } | null;
    versionReviewed: string | null; language: string | null;
  }
  export interface ReviewsData { reviews: ParsedReview[]; textReviewCount: number | null; nextToken: string | null; }
  export interface ReviewsParser { readonly version: string; parse(json: string): ReviewsData; }
  ```
- Consumes: `extractCallbackData(html, 'ds:1', VERSION)` from `parsers/extract.ts`, `ParserError`, `safeGet`.

The parser's `parse(json)` accepts the **raw `ds:1` array JSON string** (page 1). The proxy extracts `ds:1` and passes it as `data`. Page-2+ (RPC) shape is handled in Task 9.

- [ ] **Step 1: Save the fixture.** Copy the captured page-1 HTML (already fetched during design at `scratchpad/reviews.html`) into the repo:
  ```bash
  cp "/tmp/claude-1000/-home-ruslan-Projects-cws-tracker/1f60859d-458c-4bd8-961c-028db9b19cd8/scratchpad/reviews.html" tests/fixtures/reviews-website-broken-link-check.html
  ```

- [ ] **Step 2: Add parser interfaces to `types.ts`.** Append the `ParsedReview`, `ReviewsData`, `ReviewsParser` interfaces (above) to `src/background/parsers/types.ts`.

- [ ] **Step 3: Write the failing test.** In `tests/unit/background/parsers/reviews-v1.test.ts`, load the fixture, extract the `ds:1` JSON the same way the proxy will (a small helper in the test that pulls the `ds:1` array via the existing `extractCallbackData`), and assert:
  ```ts
  import { readFileSync } from 'node:fs';
  import { resolve } from 'node:path';
  import { describe, it, expect } from 'vitest';
  import { reviewsParserV1 } from '@/background/parsers/reviews-v1';
  import { extractCallbackData } from '@/background/parsers/extract';

  const html = readFileSync(resolve(__dirname, '../../../fixtures/reviews-website-broken-link-check.html'), 'utf8');
  const ds1 = extractCallbackData(html, 'ds:1', 'test'); // array [[token],[reviews],count]
  const json = JSON.stringify(ds1);

  describe('reviews-v1', () => {
    it('parses all 10 page-1 reviews with every field', () => {
      const data = reviewsParserV1.parse(json);
      expect(data.reviews).toHaveLength(10);
      expect(data.textReviewCount).toBe(11);
      expect(typeof data.nextToken).toBe('string');
      const first = data.reviews[0];
      expect(first.reviewId).toBe('0e714621-2985-48ba-827c-fa45cd024c41');
      expect(first.reviewerName).toBe('Franklyn Moore');
      expect(first.rating).toBe(5);
      expect(first.text).toContain('GREAT Tool');
      expect(first.helpfulCount).toBe(1);
      expect(first.extensionId).toBe('aliiafckfmihheljnphnkpfhlnnjmkgk');
      expect(first.devReply?.author).toBe('Ben');
      expect(first.devReply?.text).toContain('thanks');
      expect(first.versionReviewed).toBe('3.4.29');
      expect(first.language).toBe('en');
      expect(first.postedAtEpoch).toBeGreaterThan(1_700_000_000);
    });
    it('throws ParserError on non-array JSON', () => {
      expect(() => reviewsParserV1.parse('{"x":1}')).toThrow();
    });
    it('returns empty reviews for an empty list envelope', () => {
      const data = reviewsParserV1.parse(JSON.stringify([[''], [], 0]));
      expect(data.reviews).toEqual([]);
      expect(data.textReviewCount).toBe(0);
    });
  });
  ```

- [ ] **Step 3b: Run to verify it fails.** `npx vitest run tests/unit/background/parsers/reviews-v1.test.ts` → FAIL (module not found).

- [ ] **Step 4: Implement `reviews-v1.ts`.** Parse the envelope `[[token], [reviews…], count]`; map each review by the verified indices; `nextToken` = `env[0]?.[0] ?? null`; `textReviewCount` = `typeof env[2] === 'number' ? env[2] : null`. Guard required fields (`reviewId` string, `rating` number) with `ParserError`. Skeleton:
  ```ts
  import type { ParsedReview, ReviewsData, ReviewsParser } from './types.js';
  import { ParserError } from './types.js';
  const VERSION = 'reviews-v1';
  const epoch = (t: unknown): number => Array.isArray(t) && typeof t[0] === 'number' ? t[0] : 0;
  function parseReview(r: unknown[]): ParsedReview | null {
    const reviewId = typeof r[0] === 'string' ? r[0] : '';
    if (!reviewId) return null;
    const reviewer = Array.isArray(r[1]) ? r[1] : [];
    const reply = Array.isArray(r[8]) ? r[8] as unknown[] : null;
    const rating = typeof r[2] === 'number' ? r[2] : 0;
    if (rating < 1 || rating > 5) throw new ParserError('Invalid rating', VERSION, 'rating');
    return {
      reviewId,
      extensionId: typeof r[14] === 'string' ? r[14] : '',
      reviewerName: typeof reviewer[0] === 'string' ? reviewer[0] : '',
      reviewerAvatar: typeof reviewer[1] === 'string' ? reviewer[1] : null,
      rating,
      text: typeof r[3] === 'string' ? r[3] : '',
      postedAtEpoch: epoch(r[4]),
      updatedAtEpoch: epoch(r[5]),
      helpfulCount: typeof r[6] === 'number' ? r[6] : 0,
      devReply: reply ? {
        author: Array.isArray(reply[1]) && typeof reply[1][0] === 'string' ? reply[1][0] : '',
        text: typeof reply[2] === 'string' ? reply[2] : '',
        atEpoch: epoch(reply[3]),
      } : null,
      versionReviewed: typeof r[11] === 'string' ? r[11] : null,
      language: typeof r[13] === 'string' ? r[13] : null,
    };
  }
  export const reviewsParserV1: ReviewsParser = {
    version: VERSION,
    parse(json: string): ReviewsData {
      let env: unknown;
      try { env = JSON.parse(json); } catch { throw new ParserError('Invalid JSON', VERSION); }
      if (!Array.isArray(env)) throw new ParserError('Response is not an array', VERSION);
      const list = Array.isArray(env[1]) ? env[1] as unknown[] : [];
      const reviews: ParsedReview[] = [];
      for (const entry of list) { if (Array.isArray(entry)) { const p = parseReview(entry); if (p) reviews.push(p); } }
      return {
        reviews,
        textReviewCount: typeof env[2] === 'number' ? env[2] : null,
        nextToken: Array.isArray(env[0]) && typeof env[0][0] === 'string' && env[0][0] ? env[0][0] : null,
      };
    },
  };
  ```

- [ ] **Step 5: Wire the factory.** In `parser-factory.ts` add `export function getReviewsParser(): ReviewsParser { return reviewsParserV1; }` and re-export from `parsers/index.ts` (mirror `getAutocompleteParser`).

- [ ] **Step 6: Run tests → PASS.** `npx vitest run tests/unit/background/parsers/reviews-v1.test.ts`.

- [ ] **Step 7: Commit.**
  ```bash
  git add src/background/parsers/reviews-v1.ts src/background/parsers/types.ts src/background/parsers/parser-factory.ts src/background/parsers/index.ts tests/fixtures/reviews-website-broken-link-check.html tests/unit/background/parsers/reviews-v1.test.ts
  git commit -m "feat(reviews): add reviews-v1 parser for CWS ds:1 review data"
  ```

---

## Task 2: Schema v5 `reviews` table, `Review` type, DB save/query + change detection

**Files:**
- Modify: `src/shared/types/index.ts` (add `Review`), `src/shared/db/database.ts` (table decl, `version(5)`, methods, delete/prune threading)
- Test: `tests/unit/shared/db/reviews.test.ts`

**Interfaces:**
- Produces `Review` (spec §5.3), and DB methods:
  ```ts
  // returns which reviewIds were newly inserted vs content-changed vs reply-added
  saveReviews(reviews: Review[]): Promise<{ new: string[]; edited: string[]; replied: string[] }>
  getReviews(extensionId: string): Promise<Review[]>
  getReviewsInRange(extensionId: string, startDate: string, endDate: string): Promise<Review[]>
  getStoredReviewIds(extensionId: string): Promise<Set<string>>
  ```
- Consumes: `contentHashForReview(r)` helper (below), `today()` from `@/shared/utils/dates`.

- [ ] **Step 1: Add `Review` interface** to `src/shared/types/index.ts` exactly as spec §5.3.

- [ ] **Step 2: Declare the table + migration** in `database.ts`. Add `reviews!: Table<Review, number>;` to the class fields, and:
  ```ts
  this.version(5).stores({
    reviews: '++id, &reviewId, extensionId, [extensionId+postedDate], [extensionId+rating]',
  });
  ```

- [ ] **Step 3: Write the failing test.** In `tests/unit/shared/db/reviews.test.ts` (use `fake-indexeddb` per existing db tests):
  ```ts
  import { describe, it, expect, beforeEach } from 'vitest';
  import { db } from '@/shared/db/database';
  import type { Review } from '@/shared/types';

  const base = (over: Partial<Review>): Review => ({
    reviewId: 'r1', extensionId: 'ext', reviewerName: 'A', reviewerAvatar: null,
    rating: 5, text: 'nice', postedDate: '2026-01-01', updatedDate: '2026-01-01',
    postedAtEpoch: 1, updatedAtEpoch: 1, helpfulCount: 0,
    devReplyAuthor: null, devReplyText: null, devReplyDate: null, hasText: true,
    versionReviewed: null, language: 'en', contentHash: '', firstSeenAt: new Date(),
    lastSeenAt: new Date(), lastChangedAt: null, isDeleted: false, ...over,
  });

  describe('reviews db', () => {
    beforeEach(async () => { await db.reviews.clear(); });
    it('inserts new reviews and reports them as new', async () => {
      const res = await db.saveReviews([base({ reviewId: 'r1' }), base({ reviewId: 'r2' })]);
      expect(res.new.sort()).toEqual(['r1', 'r2']);
      expect(await db.reviews.count()).toBe(2);
    });
    it('is idempotent — same content re-saved is neither new nor edited', async () => {
      const r = base({ reviewId: 'r1' });
      await db.saveReviews([r]);
      const res = await db.saveReviews([base({ reviewId: 'r1' })]);
      expect(res.new).toEqual([]); expect(res.edited).toEqual([]);
      expect(await db.reviews.count()).toBe(1);
    });
    it('detects an edited review by content change', async () => {
      await db.saveReviews([base({ reviewId: 'r1', text: 'old' })]);
      const res = await db.saveReviews([base({ reviewId: 'r1', text: 'new text' })]);
      expect(res.edited).toEqual(['r1']);
    });
    it('detects a newly added developer reply', async () => {
      await db.saveReviews([base({ reviewId: 'r1', devReplyText: null })]);
      const res = await db.saveReviews([base({ reviewId: 'r1', devReplyText: 'thanks!' })]);
      expect(res.replied).toEqual(['r1']);
    });
    it('preserves firstSeenAt across updates', async () => {
      await db.saveReviews([base({ reviewId: 'r1', firstSeenAt: new Date('2026-01-01') })]);
      await db.saveReviews([base({ reviewId: 'r1', text: 'edited', firstSeenAt: new Date('2099-01-01') })]);
      const stored = await db.reviews.where('reviewId').equals('r1').first();
      expect(stored!.firstSeenAt.getUTCFullYear()).toBe(2026);
    });
  });
  ```

- [ ] **Step 3b: Run → FAIL** (`db.saveReviews` undefined).

- [ ] **Step 4: Implement the helper + methods.** Add a pure `contentHashForReview` (in `src/shared/utils/` or inline in database.ts — prefer a small util `src/shared/utils/review-hash.ts` so the processor can reuse it):
  ```ts
  export function contentHashForReview(r: { rating: number; text: string; helpfulCount: number; devReplyText: string | null }): string {
    const s = `${r.rating}|${r.text}|${r.helpfulCount}|${r.devReplyText ?? ''}`;
    let h = 0; for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
    return String(h);
  }
  ```
  Implement `saveReviews` as an upsert-with-diff inside one `rw` transaction: for each incoming review, look up the existing row by `&reviewId`; if none → insert with `firstSeenAt=lastSeenAt=now`, push to `new`; if exists → compare `contentHash`; if changed, classify `edited` (and `replied` when `devReplyText` went null→non-null), preserve `existing.firstSeenAt` and `existing.id`, set `lastChangedAt=now`; always update `lastSeenAt=now`. `getReviews`/`getReviewsInRange`/`getStoredReviewIds` query by the `[extensionId+…]` indexes.

- [ ] **Step 5: Thread into cross-cutting methods.** Add `this.reviews.where('extensionId').equals(extensionId).delete()` to `deleteExtensionData`, and prune by `postedDate < beforeDate` in `pruneOldSnapshots` (match the existing enumeration style).

- [ ] **Step 6: Run tests → PASS.**

- [ ] **Step 7: Commit.** `git commit -m "feat(reviews): add schema v5 reviews table with change-detecting upsert"`

---

## Task 3: `review_scan` job type + queue-builder wiring

**Files:**
- Modify: `src/shared/types/index.ts` (`QueueJobType`, `ReviewScanPayload`, `QueueJobPayload`)
- Modify: `src/background/queue-builder.ts`
- Test: `tests/unit/background/queue-builder-reviews.test.ts`

**Interfaces:**
- Produces: `ReviewScanPayload = { extensionId: string }`; `createReviewScanJob(extensionId, now): QueueJob`; `buildReviewScanJobs(extensionIds: string[], now): QueueJob[]`; `PRIORITY_REVIEW_SCAN = 50`.

- [ ] **Step 1:** Add `'review_scan'` to `QueueJobType`; add `ReviewScanPayload` and include it in the `QueueJobPayload` union.

- [ ] **Step 2: Write failing test** asserting `buildDailyScanJobs` includes one `review_scan` job per tracked extension (own + competitors) and `buildReviewScanJobs(['a','b'])` returns two jobs with `type:'review_scan'`, `priority:50`, `maxRetries:3`, `payload.extensionId` set. Model on the existing `queue-builder` autocomplete test.

- [ ] **Step 2b: Run → FAIL.**

- [ ] **Step 3: Implement** `PRIORITY_REVIEW_SCAN`, `createReviewScanJob`, `buildReviewScanJobs`, and append `review_scan` jobs per tracked extension in `buildDailyScanJobs` (after autocomplete). Follow `createAutocompleteScanJob` exactly for the `QueueJob` field shape.

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit.** `git commit -m "feat(reviews): add review_scan job type and queue-builder wiring"`

---

## Task 4: Proxy `/reviews` endpoint (page 1) + tests + deploy

**Files (separate repo `~/Projects/cws-tracker-proxy`):** router + handler + tests. Follow the existing `/autocomplete` handler.

- [ ] **Step 1:** Read the proxy repo's `CLAUDE.md` and existing `/detail` + `/autocomplete` handlers.

- [ ] **Step 2: Write failing test** (`vitest`/`wrangler` test): `GET /reviews?id=<extId>&key=<valid>` returns `200` with JSON `{ data: string }` where `data` parses to an array whose `[1]` is the review list. `GET /reviews` without a valid key → `403`. Use a saved fixture HTML (the proxy repo's fixture pattern) — no live CWS calls in CI.

- [ ] **Step 3: Implement handler.** Without `token`: `GET https://chromewebstore.google.com/detail/x/<id>/reviews`, extract the `ds:1` `AF_initDataCallback` block (reuse/port the extension's extraction logic), return `{ data: JSON.stringify(ds1Array) }`. With `token`: deferred to Task 9 (return `501`/empty for now, or implement after the spike). Reuse the existing key-auth + CORS middleware.

- [ ] **Step 4: Run proxy tests → PASS.** `cd ~/Projects/cws-tracker-proxy && npm test`

- [ ] **Step 5: Deploy + smoke.** `npx wrangler deploy`; `curl "$PROXY/reviews?id=aliiafckfmihheljnphnkpfhlnnjmkgk&key=$KEY"` returns the envelope. (Proxy URL/key in memory `proxy-url`.)

- [ ] **Step 6: Commit in the proxy repo.** `git commit -m "feat: add /reviews endpoint (page 1 ds:1 extraction)"`

---

## Task 5: `processReviewScan` (page-1 fetch → parse → save → events) + dispatch

**Files:**
- Modify: `src/background/queue-processor.ts` (add `processReviewScan`, `fetchReviewsWithLogging`, dispatch case, `getJobDescription` branch)
- Modify: `src/shared/types/index.ts` (`EventType` += `'review_new' | 'review_edited' | 'review_reply'`)
- Modify: `src/shared/utils/event-colors.ts` (colors for the 3 new types)
- Test: `tests/unit/background/queue-processor-reviews.test.ts`

**Interfaces:**
- Consumes: `getReviewsParser()`, `db.saveReviews`, `db.getStoredReviewIds`, `ReviewScanPayload`, `contentHashForReview`, `today()`, `ProcessorDeps` (mockable `fetchPage`).
- Produces: emits `EventRecord`s and `NEW_EVENT` messages for `res.new/edited/replied`.

- [ ] **Step 1: Add the 3 `EventType` values** and their colors in `event-colors.ts`.

- [ ] **Step 2: Write the failing test.** Mock `deps.fetchPage` to return a proxy-style `{ data }` JSON (built from the fixture's `ds:1`), seed a project + tracked extension, run `processReviewScan`, assert reviews saved and a `review_new` event emitted for a first-time scan; on a second run with identical data assert no new events (idempotent). Model on the autocomplete processor test's dependency-injection setup.

- [ ] **Step 3: Run → FAIL.**

- [ ] **Step 4: Implement `fetchReviewsWithLogging(extensionId, token, settings, fetchPage, job)`** modeled on `fetchAutocompleteWithLogging`: build `new URL('/reviews', settings.proxyUrl)`, set `id`, optional `token`, `key`; parse `{ data }`; log with redaction; throw `HttpError` on non-ok; require `proxyUrl`.

- [ ] **Step 5: Implement `processReviewScan(job, deps)`** — page-1 only for now (pagination in Task 9):
  1. `payload.extensionId`; `settings = getWithDefaults()`.
  2. `const raw = await fetchReviewsWithLogging(extensionId, undefined, settings, deps.fetchPage, job)`.
  3. `const parsed = getReviewsParser().parse(raw)`.
  4. Map each `ParsedReview` → `Review` (compute `postedDate`/`updatedDate` from epochs via a `YYYY-MM-DD` helper, `hasText`, `contentHash`, `firstSeenAt/lastSeenAt=now`).
  5. `const res = await db.saveReviews(reviewRows)`.
  6. For each id in `res.new/edited/replied`, build an `EventRecord` (`type` accordingly, `date: today()`, human note e.g. `New ★{rating} review from "{name}"`), dedupe same-day same-type review events first (mirror `detectRankChanges`), `db.saveEvent`, `deps.sendMessage({type:'NEW_EVENT', …})`. Wrap event work in try/catch so it never fails the scan.
  7. Add `case 'review_scan': await processReviewScan(job, deps); break;` to `executeJob`, and a `getJobDescription` branch (`Reviews: <name> (<extId>)`).
  8. Handle `cwsStatus === 404` like `processListingScan` (mark removed) if the proxy surfaces it.

- [ ] **Step 6: Run → PASS.**

- [ ] **Step 7: Commit.** `git commit -m "feat(reviews): process review_scan jobs (page 1) with change events"`

---

## Task 6: Scheduler + messaging `'reviews'` ScanType (manual trigger)

**Files:** `src/shared/types/messages.ts` (`ScanType += 'reviews'`), `src/background/scheduler.ts` (`triggerManualRefresh` branch), `src/background/index.ts` (already routes `TRIGGER_REFRESH`).

- [ ] **Step 1: Write failing test** in the scheduler test: `triggerManualRefresh(projectId, 'reviews', deps)` enqueues `review_scan` jobs for the project's tracked extensions and clears prior pending jobs (mirror the existing `'autocomplete'` scheduler test).

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** `else if (scanType === 'reviews') jobs = buildReviewScanJobs(relevantExtensionIds, now);` and add `'reviews'` to `ScanType`.

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit.** `git commit -m "feat(reviews): add 'reviews' manual scan type"`

---

## Task 7: `reviewFetchLimit` setting

**Files:** `src/shared/types/settings.ts`, `src/shared/utils/settings.ts` (`DEFAULT_SETTINGS`, `validatePartial`), `src/dashboard/composables/useSettings.ts`, `src/dashboard/pages/SettingsPage.vue`.

- [ ] **Step 1: Write failing test** in the settings util test: default `reviewFetchLimit` is `50`; `validatePartial({ reviewFetchLimit: 5 })` clamps to the min (10); `{ reviewFetchLimit: 9999 }` clamps to max (500).

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — add `reviewFetchLimit: number` to `Settings`, `50` to `DEFAULT_SETTINGS`, a clamp branch in `validatePartial`, and a labeled numeric input in `SettingsPage.vue` ("Max reviews fetched per extension per scan (10–500)") bound through `useSettings`.

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit.** `git commit -m "feat(reviews): add configurable reviewFetchLimit setting (default 50)"`

---

## Task 8: `useReviews` composable + basic Reviews tab UI

**Files:**
- Create: `src/dashboard/composables/useReviews.ts`, `src/dashboard/components/project/ReviewsTab.vue`
- Modify: `src/dashboard/pages/ProjectPage.vue` (4 registration spots)
- Test: `tests/unit/dashboard/composables/useReviews.test.ts`

**Interfaces:**
- Produces:
  ```ts
  loadReviewSummary(extensionId): Promise<{ avgRating: number|null; totalRatings: number; textReviews: number; emptyReviews: number; ratingDistribution: number[]; capturedCount: number }>
  loadReviewList(extensionId, opts?: { sort?: 'date'|'rating'|'helpful'; minRating?: number; hasText?: boolean }): Promise<Review[]>
  loadReviewKeywords(extensionId, opts?: { minRating?: number; maxRating?: number }): Promise<{ term: string; count: number }[]>
  ```
- Consumes: `db.getReviews`, `db.getLatestListingSnapshot` (for `ratingCount`), `text-analysis.ts` keyword extraction.

- [ ] **Step 1: Write failing test** for `loadReviewSummary`: seed reviews (e.g. 3 with text ratings 5,4,1) + a listing snapshot with `ratingCount=5`; assert `textReviews===3`, `emptyReviews===2`, `ratingDistribution` bins correct, `avgRating` from captured reviews. And `loadReviewKeywords` returns descending-count terms, respecting a `minRating` filter.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `useReviews.ts`** as pure async loaders (mirror `useAutocomplete.ts` style). `emptyReviews = max(0, ratingCount − textReviewCount)` where `textReviewCount` = count of stored reviews with `hasText` (or the parser's `textReviewCount` when available via latest snapshot). Keywords via existing `extractKeywords`/`analyze` in `text-analysis.ts`.

- [ ] **Step 4: Implement `ReviewsTab.vue`** (basic, Tailwind only): extension selector (own + competitors from `useExtensions`), summary cards (avg rating, total/text/empty), a **"Refresh reviews"** button → `useServiceWorker().requestRefresh(project.id, 'reviews')`, and a review list (reviewer, rating stars, date, helpful, message, expandable dev reply). Empty state when no reviews. Loading state while fetching.

- [ ] **Step 5: Register the tab in `ProjectPage.vue`** — (a) `const ReviewsTab = defineAsyncComponent(() => import('../components/project/ReviewsTab.vue'));` (b) widen the `activeTab` union with `'reviews'`; (c) add `{ id: 'reviews' as const, label: 'Reviews', icon: [<chat/star svg path>] }` to `tabs`; (d) `<ReviewsTab v-else-if="activeTab === 'reviews'" :project="project" />`.

- [ ] **Step 6: Run composable test → PASS**; `npm run typecheck` → zero errors.

- [ ] **Step 7: Commit.** `git commit -m "feat(reviews): add useReviews composable and basic Reviews tab"`

---

## Task 9: Pagination — RPC spike + SW loop to `reviewFetchLimit`

**Files:** `src/background/queue-processor.ts` (`processReviewScan` loop), `src/background/parsers/reviews-v1.ts` (page-2 shape), proxy `/reviews?token=` branch, fixture `tests/fixtures/reviews-page2.json`.

- [ ] **Step 1: Spike (browser).** Navigate to the reviews page in the connected browser, scroll/click "load more", and `read_network_requests` filtered to `batchexecute`. Record: the RPC method id (rpcids), the request body shape carrying the continuation token, and the response inner-payload shape. Save a page-2 response as `tests/fixtures/reviews-page2.json`. **Document the findings in the design spec §2.4.**

- [ ] **Step 2: Extend the parser** to accept the page-2 payload shape (branch on shape; extract `reviews`, `nextToken`). Add a fixture test asserting page-2 parses to `ParsedReview[]` with a `nextToken`.

- [ ] **Step 3: Implement the proxy `token` branch** (Task 4 Step 3 deferred part): issue the `batchexecute` reviews RPC with the token, unwrap the envelope, return `{ data }`. Add a proxy test with the page-2 fixture. Deploy.

- [ ] **Step 4: Implement the SW pagination loop** in `processReviewScan`: loop pages via `fetchReviewsWithLogging(extId, token)`; accumulate `ParsedReview`s; between pages apply `paginationDelay(base+jitter)` (reuse the search-pagination constants); **stop when** collected ≥ `settings.reviewFetchLimit`, OR `nextToken` is null, OR the whole page's `reviewId`s are already in `getStoredReviewIds` and unchanged (incremental early-stop). Page-1 failure propagates; page-2+ failure keeps earlier pages (mirror `processKeywordScan`). Truncate to `reviewFetchLimit` before saving.

- [ ] **Step 5: Test the loop** with a mocked multi-page `fetchPage` (page1→token→page2→null): assert it stops at the cap; assert early-stop when page-2 ids are all already stored.

- [ ] **Step 6: Run all tests → PASS.**

- [ ] **Step 7: Commit.** `git commit -m "feat(reviews): paginate reviews up to reviewFetchLimit via load-more RPC"`

---

## Task 10: Version bump, CHANGELOG, TODO, smoke test

- [ ] **Step 1:** Bump `manifest.json` MINOR (e.g. `0.35.1` → `0.36.0`).
- [ ] **Step 2:** Add a `CHANGELOG.md` entry summarizing the reviews feature (capture, change tracking, configurable depth, Reviews tab).
- [ ] **Step 3:** Mark the relevant `CWS_Tracker_TODO.md` items (or add a Reviews group) as done.
- [ ] **Step 4: Full verify.** `npm test` (all pass) + `npm run typecheck` (zero errors).
- [ ] **Step 5: Smoke test** (via the smoke-test skill): `npm run build`, load `dist/` in Chrome, open a project's Reviews tab, click "Refresh reviews", confirm reviews populate and no console errors. Requires a configured proxy.
- [ ] **Step 6: Commit.** `git commit -m "chore(reviews): bump manifest to 0.36.0, changelog, todo"`

---

## Deferred to Plan B (analytics polish)

Rating-distribution & trend charts (ApexCharts), keyword cloud, sentiment gauge, competitor-comparison strip, and a dedicated recent-changes timeline view. Built once real review data is flowing from Plan A.

---

## Self-Review notes

- **Spec coverage:** §5.1 proxy → T4/T9; §5.2 parser → T1/T9; §5.3 DB → T2; §5.4 job → T3/T5; §5.5 triggers → T3/T6; §5.6 events → T5; §5.7 analytics (basic) → T8 (rich → Plan B); §5.8 tab → T8; §5.9 settings → T7. Requirement 1 (fields) → T1; 2 (change tracking) → T2/T5; 3 (keywords + text/empty) → T8; 4 (tab) → T8. Phasing/versioning → T10.
- **Timestamp ambiguity** handled by content-hash change detection (T2), independent of posted-vs-updated semantics.
- **Pagination unknown** isolated to T9 behind a spike; T1–T8 depend only on the verified page-1 shape.
