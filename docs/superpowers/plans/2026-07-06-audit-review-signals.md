# Audit Review Signals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich the AI keyword-audit prompt with a compact, hedged "Review Signals" block derived from captured reviews (velocity, recent rating trend, version-correlated rating, dev-reply rate, language spread, and keyword-in-reviews), framed as diagnostic + keyword-discovery context rather than a ranking lever.

**Architecture:** A new pure module `review-analysis.ts` computes signals from stored `Review[]` + the latest `ListingSnapshot` and renders one markdown block. `keyword-audit.ts` gains a single `{{reviewSignals}}` placeholder (mirroring the existing `{{keywordPositions}}` pattern) that is injected into all three prompt variants only when review data exists. `AuditTool.vue` loads reviews for both extensions and passes them into `AuditInput`. One LLM call; no schema change.

**Tech Stack:** TypeScript (strict, ES2022), Vue 3 `<script setup>`, Vitest + fake-indexeddb, Dexie.

## Global Constraints

- No `any`, no `@ts-ignore`; all params/returns explicitly typed (copied verbatim from CLAUDE.md).
- Type check with `npm run typecheck` (vue-tsc), NOT plain tsc.
- Pure utilities in `src/shared/utils/` — no Vue/DOM/`window`/`chrome.*` imports.
- Reviews are a **capped recent-text sample** (≤ `reviewFetchLimit`, default 50). Every rendered number must be labeled as a sample, never the full population.
- Prompt copy must NOT attribute rank *causation* to reviews and must NOT invent numeric ranking weights.
- Post-implementation: bump `manifest.json` (MINOR) + add `CHANGELOG.md` entry.
- Conventional commits; end commit messages with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File Structure

- **Create** `src/shared/utils/review-analysis.ts` — `ReviewSignals`/`KeywordHit`/`VersionRating`/`ComputeReviewOptions` types, `computeReviewSignals()`, `renderReviewBlock()`. Pure.
- **Create** `tests/unit/utils/review-analysis.test.ts` — unit tests for the above.
- **Modify** `src/shared/utils/keyword-audit.ts` — extend `AuditInput`, add `REVIEW_SIGNALS_NOTE`, append note to 3 system prompts, add `{{reviewSignals}}` to 3 user templates, add placeholder entry + wiring in `buildPlaceholderValues`.
- **Modify** `tests/unit/utils/keyword-audit.test.ts` — assert `{{reviewSignals}}` fills when reviews present and is empty when absent.
- **Modify** `src/dashboard/components/ai/AuditTool.vue` — load reviews per extension, pass into the 3 `AuditInput` build sites.
- **Modify** `manifest.json`, `CHANGELOG.md` — version bump + entry.

---

## Task 1: Pure review-analysis module

**Files:**
- Create: `src/shared/utils/review-analysis.ts`
- Test: `tests/unit/utils/review-analysis.test.ts`

**Interfaces:**
- Consumes: `Review`, `ListingSnapshot` from `../types`; `today`, `daysBetween` from `./dates`.
- Produces:
  - `interface ReviewSignals { capturedCount: number; totalRatings: number | null; textReviewCount: number | null; capturedAvgRating: number | null; lifetimeAvgRating: number | null; recentCount: number; priorCount: number; recentAvgRating: number | null; devReplyRatePct: number; devReplyRateLowPct: number | null; languages: string[]; versionRatings: VersionRating[]; keywordHits: KeywordHit[]; }`
  - `interface KeywordHit { keyword: string; fullWord: number; partial: number; }`
  - `interface VersionRating { version: string; count: number; avgRating: number; }`
  - `interface ComputeReviewOptions { referenceDate?: string; textReviewCount?: number | null; recentWindowDays?: number; recentSampleSize?: number; }`
  - `function computeReviewSignals(reviews: Review[], listing: ListingSnapshot | null, keywords: string[], options?: ComputeReviewOptions): ReviewSignals`
  - `function renderReviewBlock(own: ReviewSignals | null, comp: ReviewSignals | null): string`

- [ ] **Step 1: Write the failing test file**

Create `tests/unit/utils/review-analysis.test.ts`:

```ts
/**
 * Tests for review-analysis (audit review signals).
 */
import { describe, it, expect } from 'vitest';
import {
  computeReviewSignals,
  renderReviewBlock,
  type ReviewSignals,
} from '../../../src/shared/utils/review-analysis';
import type { Review, ListingSnapshot } from '../../../src/shared/types';

const REF = '2026-07-06';

function makeReview(overrides: Partial<Review> = {}): Review {
  const posted = overrides.postedDate ?? '2026-07-01';
  return {
    reviewId: 'r-' + Math.abs(hash(posted + (overrides.text ?? '') + (overrides.rating ?? 5))),
    extensionId: 'ext-own-id-12345678901234567890',
    reviewerName: 'Alice',
    reviewerAvatar: null,
    rating: 5,
    text: 'Great extension',
    postedDate: posted,
    updatedDate: posted,
    postedAtEpoch: Date.parse(posted + 'T00:00:00') / 1000,
    updatedAtEpoch: Date.parse(posted + 'T00:00:00') / 1000,
    helpfulCount: 0,
    devReplyAuthor: null,
    devReplyText: null,
    devReplyDate: null,
    hasText: (overrides.text ?? 'Great extension').trim().length > 0,
    versionReviewed: '1.0.0',
    language: 'en',
    contentHash: 'h',
    firstSeenAt: new Date(),
    lastSeenAt: new Date(),
    lastChangedAt: null,
    isDeleted: false,
    ...overrides,
  };
}

// tiny deterministic hash so reviewId is stable without Math.random
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function makeListing(overrides: Partial<ListingSnapshot> = {}): ListingSnapshot {
  return {
    extensionId: 'ext-own-id-12345678901234567890',
    date: '2026-07-05',
    title: 'My Extension',
    shortDescription: 'short',
    fullDescription: 'full',
    rating: 4.2,
    ratingCount: 150,
    reviewCount: 150,
    userCount: '50,000+',
    userCountNumeric: 50000,
    version: '1.5.0',
    lastUpdated: '2026-06-15',
    size: '2.5MiB',
    permissions: [],
    hostPermissions: [],
    permissionRiskScore: 20,
    badgeFlags: {},
    screenshotCount: 3,
    hasPromoVideo: false,
    translationCount: 5,
    availableLocales: ['en'],
    category: 'Productivity',
    developerName: 'Dev Inc',
    developerEmail: null,
    developerVerified: false,
    listingQualityScore: 72,
    scannedAt: new Date(),
    ...overrides,
  };
}

describe('computeReviewSignals()', () => {
  it('counts captured reviews and averages ratings', () => {
    const reviews = [makeReview({ rating: 5 }), makeReview({ rating: 3 })];
    const s = computeReviewSignals(reviews, makeListing(), [], { referenceDate: REF });
    expect(s.capturedCount).toBe(2);
    expect(s.capturedAvgRating).toBe(4);
    expect(s.lifetimeAvgRating).toBe(4.2);
    expect(s.totalRatings).toBe(150);
  });

  it('splits recent vs prior 30-day windows by postedDate', () => {
    const reviews = [
      makeReview({ postedDate: '2026-07-01' }), // 5 days ago -> recent
      makeReview({ postedDate: '2026-06-20' }), // 16 days -> recent
      makeReview({ postedDate: '2026-06-01' }), // 35 days -> prior
      makeReview({ postedDate: '2026-04-01' }), // 96 days -> neither
    ];
    const s = computeReviewSignals(reviews, null, [], { referenceDate: REF });
    expect(s.recentCount).toBe(2);
    expect(s.priorCount).toBe(1);
  });

  it('computes recent-average from the most recent sample', () => {
    const reviews = [
      makeReview({ postedDate: '2026-07-05', rating: 2 }),
      makeReview({ postedDate: '2026-07-04', rating: 2 }),
      makeReview({ postedDate: '2026-01-01', rating: 5 }),
    ];
    const s = computeReviewSignals(reviews, null, [], { referenceDate: REF, recentSampleSize: 2 });
    expect(s.recentAvgRating).toBe(2);
  });

  it('computes dev-reply rates overall and for low (<=3) reviews', () => {
    const reviews = [
      makeReview({ rating: 5, devReplyText: 'thanks' }),
      makeReview({ rating: 2, devReplyText: 'sorry, fixing' }),
      makeReview({ rating: 1, devReplyText: null }),
    ];
    const s = computeReviewSignals(reviews, null, [], { referenceDate: REF });
    expect(s.devReplyRatePct).toBe(67);
    expect(s.devReplyRateLowPct).toBe(50);
  });

  it('collects distinct languages sorted', () => {
    const reviews = [
      makeReview({ language: 'es' }),
      makeReview({ language: 'en' }),
      makeReview({ language: 'en' }),
    ];
    const s = computeReviewSignals(reviews, null, [], { referenceDate: REF });
    expect(s.languages).toEqual(['en', 'es']);
  });

  it('groups version ratings, newest version first, max 2', () => {
    const reviews = [
      makeReview({ versionReviewed: '2.0.0', rating: 3, postedDate: '2026-07-05' }),
      makeReview({ versionReviewed: '2.0.0', rating: 3, postedDate: '2026-07-04' }),
      makeReview({ versionReviewed: '1.0.0', rating: 5, postedDate: '2026-06-01' }),
      makeReview({ versionReviewed: '0.9.0', rating: 4, postedDate: '2026-05-01' }),
    ];
    const s = computeReviewSignals(reviews, null, [], { referenceDate: REF });
    expect(s.versionRatings).toEqual([
      { version: '2.0.0', count: 2, avgRating: 3 },
      { version: '1.0.0', count: 1, avgRating: 5 },
    ]);
  });

  it('counts keyword full-word vs partial (substring) review hits', () => {
    const reviews = [
      makeReview({ text: 'best password manager ever' }),
      makeReview({ text: 'the passwords sync well' }), // partial only
      makeReview({ text: 'no mention here' }),
    ];
    const s = computeReviewSignals(reviews, null, ['password'], { referenceDate: REF });
    expect(s.keywordHits).toEqual([{ keyword: 'password', fullWord: 1, partial: 2 }]);
  });

  it('handles empty reviews without throwing', () => {
    const s = computeReviewSignals([], makeListing(), ['x'], { referenceDate: REF });
    expect(s.capturedCount).toBe(0);
    expect(s.capturedAvgRating).toBeNull();
    expect(s.devReplyRatePct).toBe(0);
    expect(s.devReplyRateLowPct).toBeNull();
  });
});

describe('renderReviewBlock()', () => {
  const own: ReviewSignals = computeReviewSignals(
    [makeReview({ rating: 4, text: 'good vpn', devReplyText: 'thanks' })],
    makeListing(),
    ['vpn'],
    { referenceDate: REF, textReviewCount: 60 },
  );

  it('returns empty string when both sides are null', () => {
    expect(renderReviewBlock(null, null)).toBe('');
  });

  it('returns empty string when both sides have zero captured reviews', () => {
    const empty = computeReviewSignals([], makeListing(), [], { referenceDate: REF });
    expect(renderReviewBlock(empty, empty)).toBe('');
  });

  it('renders a labeled block with an own column when data exists', () => {
    const block = renderReviewBlock(own, null);
    expect(block).toContain('Review Signals');
    expect(block).toContain('sample'); // sample-labeling guardrail
    expect(block).toContain('No review scan yet'); // competitor side missing
    expect(block).toContain('vpn');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/utils/review-analysis.test.ts`
Expected: FAIL — cannot find module `review-analysis` / functions undefined.

- [ ] **Step 3: Write the module**

Create `src/shared/utils/review-analysis.ts`:

```ts
/**
 * Review analysis for the AI keyword audit.
 *
 * Computes a compact set of "review signals" from CAPTURED reviews (a recent,
 * text-only sample capped by reviewFetchLimit — NOT the full rating population)
 * and renders them into one markdown block for the audit prompt. Pure module:
 * no Vue/DOM/chrome imports.
 *
 * Signals are diagnostic + keyword-discovery context. They must never be
 * presented as population totals or as causal ranking factors (see the prompt's
 * REVIEW_SIGNALS_NOTE).
 */

import type { Review, ListingSnapshot } from '../types';
import { today, daysBetween } from './dates';

export interface KeywordHit {
  keyword: string;
  /** Reviews whose text contains the keyword as a whole word. */
  fullWord: number;
  /** Reviews whose text contains the keyword as a substring (partial). */
  partial: number;
}

export interface VersionRating {
  version: string;
  count: number;
  avgRating: number;
}

export interface ReviewSignals {
  /** Reviews actually captured/stored locally (the sample size). */
  capturedCount: number;
  /** Total ratings from the latest listing snapshot, or null. */
  totalRatings: number | null;
  /** CWS-reported text-review count if known, else null. */
  textReviewCount: number | null;
  /** Average star across captured reviews, or null. */
  capturedAvgRating: number | null;
  /** Lifetime average from the listing, or null. */
  lifetimeAvgRating: number | null;
  /** Captured reviews posted within the recent window. */
  recentCount: number;
  /** Captured reviews posted in the window immediately before that. */
  priorCount: number;
  /** Average star of the most recent captured sample, or null. */
  recentAvgRating: number | null;
  /** % of captured reviews with a developer reply (0-100). */
  devReplyRatePct: number;
  /** % of captured <=3-star reviews with a developer reply, or null if none. */
  devReplyRateLowPct: number | null;
  /** Distinct language codes among captured reviews, sorted. */
  languages: string[];
  /** Up to 2 versions (newest first) with captured count + avg star. */
  versionRatings: VersionRating[];
  /** Per-keyword review-hit counts. */
  keywordHits: KeywordHit[];
}

export interface ComputeReviewOptions {
  /** YYYY-MM-DD reference "now" for recency windows. Defaults to today(). */
  referenceDate?: string;
  /** CWS-reported text-review count for the extension, if known. */
  textReviewCount?: number | null;
  /** Recent-window size in days (default 30). */
  recentWindowDays?: number;
  /** Number of newest reviews used for the recent-average trend (default 10). */
  recentSampleSize?: number;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function hasReply(r: Review): boolean {
  return !!r.devReplyText && r.devReplyText.trim().length > 0;
}

function wholeWordRegex(keyword: string): RegExp {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i');
}

function computeVersionRatings(reviews: Review[]): VersionRating[] {
  const groups = new Map<string, { count: number; sum: number; latest: number }>();
  for (const r of reviews) {
    const v = r.versionReviewed;
    if (!v) continue;
    const g = groups.get(v) ?? { count: 0, sum: 0, latest: 0 };
    g.count += 1;
    g.sum += r.rating;
    g.latest = Math.max(g.latest, r.postedAtEpoch);
    groups.set(v, g);
  }
  return [...groups.entries()]
    .sort((a, b) => b[1].latest - a[1].latest)
    .slice(0, 2)
    .map(([version, g]) => ({ version, count: g.count, avgRating: round1(g.sum / g.count) }));
}

export function computeReviewSignals(
  reviews: Review[],
  listing: ListingSnapshot | null,
  keywords: string[],
  options: ComputeReviewOptions = {},
): ReviewSignals {
  const refDate = options.referenceDate ?? today();
  const windowDays = options.recentWindowDays ?? 30;
  const sampleSize = options.recentSampleSize ?? 10;

  const valid = reviews.filter((r) => r.rating >= 1 && r.rating <= 5);
  const capturedAvgRating =
    valid.length > 0 ? round1(valid.reduce((s, r) => s + r.rating, 0) / valid.length) : null;

  let recentCount = 0;
  let priorCount = 0;
  for (const r of reviews) {
    const age = daysBetween(r.postedDate, refDate);
    if (age < windowDays) recentCount += 1;
    else if (age < windowDays * 2) priorCount += 1;
  }

  const byRecent = [...valid].sort((a, b) => b.postedAtEpoch - a.postedAtEpoch).slice(0, sampleSize);
  const recentAvgRating =
    byRecent.length > 0 ? round1(byRecent.reduce((s, r) => s + r.rating, 0) / byRecent.length) : null;

  const withReply = reviews.filter(hasReply).length;
  const devReplyRatePct = reviews.length > 0 ? Math.round((withReply / reviews.length) * 100) : 0;
  const low = reviews.filter((r) => r.rating <= 3);
  const lowWithReply = low.filter(hasReply).length;
  const devReplyRateLowPct = low.length > 0 ? Math.round((lowWithReply / low.length) * 100) : null;

  const langSet = new Set<string>();
  for (const r of reviews) if (r.language) langSet.add(r.language);

  const keywordHits: KeywordHit[] = keywords.map((kw) => {
    const rx = wholeWordRegex(kw);
    const kwLower = kw.toLowerCase();
    let fullWord = 0;
    let partial = 0;
    for (const r of reviews) {
      const text = r.text ?? '';
      if (!text) continue;
      if (text.toLowerCase().includes(kwLower)) partial += 1;
      if (rx.test(text)) fullWord += 1;
    }
    return { keyword: kw, fullWord, partial };
  });

  return {
    capturedCount: reviews.length,
    totalRatings: listing?.ratingCount ?? null,
    textReviewCount: options.textReviewCount ?? null,
    capturedAvgRating,
    lifetimeAvgRating: listing?.rating ?? null,
    recentCount,
    priorCount,
    recentAvgRating,
    devReplyRatePct,
    devReplyRateLowPct,
    languages: [...langSet].sort(),
    versionRatings: computeVersionRatings(reviews),
    keywordHits,
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const NONE = 'No review scan yet';

function cell(s: ReviewSignals | null, fn: (s: ReviewSignals) => string): string {
  return s && s.capturedCount > 0 ? fn(s) : NONE;
}

function trendArrow(recent: number | null, lifetime: number | null): string {
  if (recent === null || lifetime === null) return '';
  if (recent < lifetime - 0.1) return ' ↓';
  if (recent > lifetime + 0.1) return ' ↑';
  return '';
}

function velocityText(s: ReviewSignals): string {
  const dir = s.recentCount > s.priorCount ? 'rising' : s.recentCount < s.priorCount ? 'falling' : 'flat';
  return `${s.recentCount} vs ${s.priorCount} (${dir})`;
}

function versionText(s: ReviewSignals): string {
  if (s.versionRatings.length === 0) return 'n/a';
  return s.versionRatings.map((v) => `${v.version}: ${v.avgRating}★ (n=${v.count})`).join('; ');
}

function keywordText(s: ReviewSignals): string {
  if (s.keywordHits.length === 0) return 'n/a';
  return s.keywordHits.map((k) => `${k.keyword}: ${k.fullWord}/${k.partial}`).join('; ');
}

/**
 * Render the compact own-vs-competitor review block, or '' when neither side
 * has captured reviews. Numbers are explicitly labeled as a recent sample.
 */
export function renderReviewBlock(own: ReviewSignals | null, comp: ReviewSignals | null): string {
  const ownHas = !!own && own.capturedCount > 0;
  const compHas = !!comp && comp.capturedCount > 0;
  if (!ownHas && !compHas) return '';

  const rows: Array<[string, (s: ReviewSignals) => string]> = [
    ['Captured reviews (sample size)', (s) => String(s.capturedCount)],
    ['Total ratings / CWS text reviews', (s) => `${s.totalRatings ?? 'n/a'} / ${s.textReviewCount ?? 'n/a'}`],
    ['Captured avg star', (s) => (s.capturedAvgRating ?? 'n/a').toString()],
    ['Lifetime avg (listing)', (s) => (s.lifetimeAvgRating ?? 'n/a').toString()],
    ['Recent avg (newest sample)', (s) => `${s.recentAvgRating ?? 'n/a'}${trendArrow(s.recentAvgRating, s.lifetimeAvgRating)}`],
    ['Velocity (last 30d vs prior 30d)', velocityText],
    ['Dev reply rate (all / ≤3★)', (s) => `${s.devReplyRatePct}% / ${s.devReplyRateLowPct === null ? 'n/a' : s.devReplyRateLowPct + '%'}`],
    ['Languages in sample', (s) => (s.languages.length ? `${s.languages.join(', ')} (${s.languages.length})` : 'n/a')],
    ['Recent version ratings', versionText],
    ['Keyword in reviews (full / partial)', keywordText],
  ];

  const lines = [
    '## Review Signals',
    '_Based on the most recent captured text reviews (a recent sample, NOT the full rating population). Use for diagnosis and keyword discovery; do not treat as a ranking score._',
    '',
    '| Signal | Your Extension | Competitor |',
    '|--------|----------------|------------|',
    ...rows.map(([label, fn]) => `| ${label} | ${cell(own, fn)} | ${cell(comp, fn)} |`),
  ];
  return lines.join('\n');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/utils/review-analysis.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Type check**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/shared/utils/review-analysis.ts tests/unit/utils/review-analysis.test.ts
git commit -m "$(cat <<'EOF'
feat(audit): add pure review-analysis module (signals + render)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Wire review signals into keyword-audit.ts

**Files:**
- Modify: `src/shared/utils/keyword-audit.ts`
- Test: `tests/unit/utils/keyword-audit.test.ts`

**Interfaces:**
- Consumes: `computeReviewSignals`, `renderReviewBlock` from `./review-analysis` (Task 1); `Review` from `../types`.
- Produces: `AuditInput` gains `ownReviews?`, `compReviews?`, `ownTextReviewCount?`, `compTextReviewCount?`; new `{{reviewSignals}}` placeholder available to all templates.

- [ ] **Step 1: Add imports and extend `AuditInput`**

In `src/shared/utils/keyword-audit.ts`, change the type import on line 9 to include `Review`:

```ts
import type { ListingSnapshot, RankSnapshot, AutocompleteSnapshot, EventRecord, AuditPromptVariant, Review } from '../types';
```

Add the review-analysis import directly below the `OpenAIClient` import (after line 13):

```ts
import { computeReviewSignals, renderReviewBlock } from './review-analysis';
```

Extend the `AuditInput` interface (after the `additionalKeywords?` field, before the closing `}`):

```ts
  /** Captured reviews for the own extension (optional). */
  ownReviews?: Review[];
  /** Captured reviews for the competitor extension (optional). */
  compReviews?: Review[];
  /** CWS-reported text-review count for own extension, if known. */
  ownTextReviewCount?: number | null;
  /** CWS-reported text-review count for competitor extension, if known. */
  compTextReviewCount?: number | null;
```

- [ ] **Step 2: Add the hedged system-prompt note and append it to all three system prompts**

Directly above `DEFAULT_AUDIT_SYSTEM_PROMPT` (before line 98), add:

```ts
/** Shared, hedged guidance appended to every system prompt for the review block. */
export const REVIEW_SIGNALS_NOTE = `

## Interpreting the "Review Signals" block
If a "Review Signals" section is present, treat it as supplementary CONTEXT, not a ranking scorecard:
- Its numbers come from a recent sample of captured text reviews, NOT the full rating population — never present them as totals.
- Reviews correlate with popularity and lag ranking. Do NOT claim reviews cause the rank gap. Use them to (a) surface the words users actually use (keyword-discovery input for title/description) and (b) flag recent rating, velocity, or version-linked trends worth investigating.
- Do not invent numeric ranking weights for review signals.`;
```

Append the note to each of the three system-prompt consts by adding `+ REVIEW_SIGNALS_NOTE` immediately after their closing backtick. For `DEFAULT_AUDIT_SYSTEM_PROMPT` the closing line becomes:

```ts
Provide 3-6 recommendations sorted by priority (high first). Every suggestion must reference actual data from the input — never give advice that could apply to any extension generically.` + REVIEW_SIGNALS_NOTE;
```

For `VARIANT_COT_SYSTEM_PROMPT`, change its final closing backtick line (the one closing the few-shot `}` example) from:

```ts
  ]
}`;
```
to:
```ts
  ]
}` + REVIEW_SIGNALS_NOTE;
```

For `VARIANT_RUBRIC_SYSTEM_PROMPT`, its closing line becomes:

```ts
Provide 3-6 recommendations sorted by priority (high first). Focus on factors with the largest score gaps — those offer the biggest ranking improvement opportunity.` + REVIEW_SIGNALS_NOTE;
```

- [ ] **Step 3: Add `{{reviewSignals}}` to all three user-prompt templates**

Append the placeholder at the very end of each user template, after its last line, inside the backticks:

For `DEFAULT_AUDIT_USER_PROMPT_TEMPLATE`, the final lines become:
```ts
## Recent Changes & Events (last 14 days)
Your extension: {{ownEvents14d}}
Competitor: {{compEvents14d}}

{{reviewSignals}}`;
```

For `VARIANT_COT_USER_PROMPT_TEMPLATE`, append after the competitor full-description block:
```ts
</full-description>

{{reviewSignals}}`;
```

For `VARIANT_RUBRIC_USER_PROMPT_TEMPLATE`, append after the competitor full-description block:
```ts
</full-description>

{{reviewSignals}}`;
```

- [ ] **Step 4: Register the placeholder in `AUDIT_PLACEHOLDERS`**

Add this entry to the `AUDIT_PLACEHOLDERS` object (next to `keywordPositions`, around line 457):

```ts
  reviewSignals: 'Compact own-vs-competitor review-signals block (velocity, recent trend, dev-reply rate, keyword mentions, languages). Empty when no reviews were captured.',
```

- [ ] **Step 5: Populate the placeholder in `buildPlaceholderValues`**

In `buildPlaceholderValues`, immediately before the final `return values;` (line 752), add:

```ts
  // Review signals block (empty string when no reviews captured on either side)
  const reviewKeywords = [keyword, ...additional.map((a) => a.keyword)].filter((k) => k.length > 0);
  const ownReviewSignals =
    input.ownReviews && input.ownReviews.length > 0
      ? computeReviewSignals(input.ownReviews, ownListing, reviewKeywords, {
          textReviewCount: input.ownTextReviewCount ?? null,
        })
      : null;
  const compReviewSignals =
    input.compReviews && input.compReviews.length > 0
      ? computeReviewSignals(input.compReviews, competitorListing, reviewKeywords, {
          textReviewCount: input.compTextReviewCount ?? null,
        })
      : null;
  values.reviewSignals = renderReviewBlock(ownReviewSignals, compReviewSignals);
```

Note: `additional` is already declared earlier in the function (`const additional = input.additionalKeywords ?? [];`), so reuse it.

- [ ] **Step 6: Write the failing test**

In `tests/unit/utils/keyword-audit.test.ts`, add a `makeReview` helper near the other fixtures (after `makeCompetitorListing`, around line 96):

```ts
import type { Review } from '../../../src/shared/types';

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: 'rev-1',
    extensionId: 'ext-own-id-12345678901234567890',
    reviewerName: 'Alice',
    reviewerAvatar: null,
    rating: 4,
    text: 'love this productivity tool',
    postedDate: '2026-02-01',
    updatedDate: '2026-02-01',
    postedAtEpoch: Date.parse('2026-02-01T00:00:00') / 1000,
    updatedAtEpoch: Date.parse('2026-02-01T00:00:00') / 1000,
    helpfulCount: 0,
    devReplyAuthor: null,
    devReplyText: null,
    devReplyDate: null,
    hasText: true,
    versionReviewed: '1.5.0',
    language: 'en',
    contentHash: 'h',
    firstSeenAt: new Date(),
    lastSeenAt: new Date(),
    lastChangedAt: null,
    isDeleted: false,
    ...overrides,
  };
}
```

(If `Review` is already imported in the file's type import line, add it there instead of a second import.)

Then add this `describe` block at the end of the file:

```ts
describe('review signals in audit prompt', () => {
  it('injects a Review Signals block when reviews are provided', () => {
    const input: AuditInput = {
      ...SAMPLE_INPUT,
      ownReviews: [makeReview({ text: 'great productivity extension' })],
      compReviews: [makeReview({ reviewId: 'c1', rating: 5, text: 'best productivity app' })],
      ownTextReviewCount: 60,
      compTextReviewCount: 900,
    };
    const [, user] = buildAuditPrompt(input);
    expect(user.content).toContain('Review Signals');
    expect(user.content).toContain('Captured reviews');
  });

  it('omits the block (empty placeholder) when no reviews are provided', () => {
    const [, user] = buildAuditPrompt(SAMPLE_INPUT);
    expect(user.content).not.toContain('Review Signals');
    expect(user.content).not.toContain('{{reviewSignals}}');
  });

  it('appends the hedged note to every system prompt', () => {
    for (const v of ['default', 'cot', 'rubric'] as const) {
      expect(getVariantSystemPrompt(v)).toContain('Interpreting the "Review Signals" block');
    }
  });
});
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/utils/keyword-audit.test.ts`
Expected: PASS (new block + all existing tests still green).

- [ ] **Step 8: Type check**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 9: Commit**

```bash
git add src/shared/utils/keyword-audit.ts tests/unit/utils/keyword-audit.test.ts
git commit -m "$(cat <<'EOF'
feat(audit): inject hedged review-signals block into audit prompts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Load reviews in AuditTool.vue and pass into AuditInput

**Files:**
- Modify: `src/dashboard/components/ai/AuditTool.vue`

**Interfaces:**
- Consumes: `db.getReviews(extensionId)` (returns `Promise<Review[]>`); `Extension.reviewTextCount`; the extended `AuditInput` from Task 2.
- Produces: none (UI wiring).

- [ ] **Step 1: Import the Review type and declare a reviews ref**

Ensure `Review` is imported from the shared types (add to the existing type import in the `<script setup>` block):

```ts
import type { Review } from '@/shared/types';
```

Add a ref next to `snapshots` (after line 41):

```ts
const reviewsByExt = ref<Map<string, Review[]>>(new Map());
```

- [ ] **Step 2: Load reviews per extension in `onMounted`**

In `onMounted`, extend the snapshot-loading section. Change the block at lines 225-232 to also build a reviews map:

```ts
  // Load snapshots and ranks
  const newSnapshots = new Map<string, ListingSnapshot>();
  const newRanks = new Map<string, Map<number, RankSnapshot>>();
  const newReviews = new Map<string, Review[]>();

  for (const ext of extensions.value) {
    const snap = await getLatestSnapshot(ext.id);
    if (snap) newSnapshots.set(ext.id, snap);
    newRanks.set(ext.id, new Map());
    newReviews.set(ext.id, await db.getReviews(ext.id));
  }
```

Then, alongside `snapshots.value = newSnapshots;` (line 244), add:

```ts
  reviewsByExt.value = newReviews;
```

- [ ] **Step 3: Pass reviews into all three `AuditInput` builders**

Add these four fields to each of the three `AuditInput` object literals (`costEstimate` ~line 144, `previewMessages` ~line 173, and the run function ~line 389). In `costEstimate` and `previewMessages`, the own/competitor ids are `props.project.ownExtensionId` and `selectedCompetitorId.value`; in the run function they are the already-declared `ownExtId` and `compExtId`.

For `costEstimate` and `previewMessages`, add after `competitorPosition: ...,`:

```ts
    ownReviews: reviewsByExt.value.get(props.project.ownExtensionId),
    compReviews: reviewsByExt.value.get(selectedCompetitorId.value),
    ownTextReviewCount: extensions.value.find((e) => e.id === props.project.ownExtensionId)?.reviewTextCount ?? null,
    compTextReviewCount: extensions.value.find((e) => e.id === selectedCompetitorId.value)?.reviewTextCount ?? null,
```

For the run function's `input` (~line 389), add after `history14d,`:

```ts
      ownReviews: reviewsByExt.value.get(ownExtId),
      compReviews: reviewsByExt.value.get(compExtId),
      ownTextReviewCount: extensions.value.find((e) => e.id === ownExtId)?.reviewTextCount ?? null,
      compTextReviewCount: extensions.value.find((e) => e.id === compExtId)?.reviewTextCount ?? null,
```

- [ ] **Step 4: Type check**

Run: `npm run typecheck`
Expected: zero errors. (Confirms `Extension.reviewTextCount` and the new `AuditInput` fields line up.)

- [ ] **Step 5: Build to confirm the dashboard compiles**

Run: `npm run build:only`
Expected: build succeeds, no errors.

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/components/ai/AuditTool.vue
git commit -m "$(cat <<'EOF'
feat(audit): load reviews for both extensions and feed the audit prompt

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Version bump, changelog, full verification

**Files:**
- Modify: `manifest.json`
- Modify: `CHANGELOG.md`

**Interfaces:** none.

- [ ] **Step 1: Bump the manifest version (MINOR)**

Read the current `version` in `manifest.json` (currently `0.36.0`) and bump the MINOR: `0.36.0` → `0.37.0`.

- [ ] **Step 2: Add a CHANGELOG entry**

Add a new section at the top of the `CHANGELOG.md` entries (match the existing format/date style used by prior entries):

```markdown
## [0.37.0] - 2026-07-06

### Added
- AI keyword audit now includes a compact "Review Signals" block (review velocity, recent rating trend, version-correlated rating, developer-reply rate, language spread, and keyword-in-reviews for both extensions). Injected into all prompt variants only when reviews have been captured, and framed as diagnostic + keyword-discovery context (a recent sample, not the full rating population; not a causal ranking factor).
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: all tests pass, no regressions.

- [ ] **Step 4: Final type check**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add manifest.json CHANGELOG.md
git commit -m "$(cat <<'EOF'
chore(audit): bump to 0.37.0 and add review-signals changelog entry

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- 6 signals (keyword presence full/partial, velocity, recent trend, version-correlated, dev-reply rate, language) → Task 1 `computeReviewSignals` + Task 1 tests. ✓
- Review-count/rating comparison already carried by existing placeholders + the block's "Total ratings / CWS text reviews" row. ✓
- One composite `{{reviewSignals}}` placeholder mirroring `{{keywordPositions}}` → Task 2 Steps 3-5. ✓
- Conditional injection (omit when no data) → `renderReviewBlock` returns `''`; Task 1 + Task 2 tests. ✓
- Guardrails (sample labeling, three distinct counts, hedged note, no weights) → block subtitle + `REVIEW_SIGNALS_NOTE` (Task 2 Step 2). ✓
- New pure module + `AuditInput` extension + AuditTool wiring + fallback → Tasks 1-3. ✓
- MINOR bump + CHANGELOG, no schema change → Task 4. ✓
- Partial vs full keyword matching handled separately → `computeReviewSignals` keywordHits + test. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `computeReviewSignals`/`renderReviewBlock`/`ReviewSignals` names identical across Tasks 1-2; `AuditInput` fields (`ownReviews`, `compReviews`, `ownTextReviewCount`, `compTextReviewCount`) identical in Tasks 2-3; `db.getReviews` and `Extension.reviewTextCount` verified against source. ✓
