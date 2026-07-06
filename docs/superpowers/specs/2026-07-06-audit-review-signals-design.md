# Design: Review signals in the AI audit prompt

**Date:** 2026-07-06
**Status:** Approved (pending spec review)
**Related:** `docs/superpowers/specs/2026-07-03-extension-reviews-design.md` (reviews capture pipeline, schema v5)

## Motivation

We now capture per-extension reviews (schema v5: `rating`, `text`, `postedDate`,
`helpfulCount`, `devReply*`, `versionReviewed`, `language`, plus listing-level
`ratingCount` and `reviewTextCount`). The keyword audit ("why does the competitor
outrank me for keyword X") currently reasons over listing text, metrics, ranking
trends, and events — but not reviews.

### The framing constraint (why this design is conservative)

Rank↔reviews correlation in observational data is **dominated by a popularity
confound**: popular extensions rank high, accumulate reviews, and tend to have
better keyword match all at once. A strong observed correlation proves little about
whether *improving reviews moves rank*. There is also **no public CWS ranking spec** —
any weight (incl. the existing prompt's "15-20% rating") is folklore.

Therefore reviews are added as **diagnostic + keyword-discovery context, not as a new
heavily-weighted ranking lever**. The prompt must not invite the model to attribute
rank causation to reviews.

## Decisions

1. **One LLM call, not several.** The audit's value is holistic single-pass synthesis
   across text + metrics + trends + reviews. A standalone review call loses cross-signal
   reasoning and, given the confound, over-narrates reviews in isolation. Rejected.
2. **Modular, conditionally-injected review partial.** A single self-contained function
   renders one compact "Review Signals" block shared by all three variants (Default,
   CoT, Rubric). Injected **only when own or competitor has ≥1 captured review**;
   otherwise omitted entirely (no `NO_DATA` padding).
3. **Approach = "Context block, hedged"** (chosen over Minimal and Full-reputation-factor).

## Signals (compact own-vs-competitor block)

All computed from **captured reviews only** (≤ `reviewFetchLimit`, default 50, newest-first,
text reviews). Every number is labeled as a sample, never the full population.

1. **Voice-of-customer keyword presence** — for each analyzed keyword, count of captured
   reviews whose text contains it: **full-word** (`\b…\b`) and **partial/substring**
   reported separately. Purpose: surface the words users actually use → mine for
   title/short-desc. (Keyword *discovery*, not a ranking signal.)
2. **Review velocity & recency** — captured reviews in the last 30 days vs the prior 30
   (from `postedDate`), with direction. Momentum proxy.
3. **Recent rating trend** — avg star of the most recent captured reviews vs the lifetime
   listing avg (`listing.rating`), with direction. Trajectory, *not* "distribution."
4. **Version-correlated rating** — avg star grouped by `versionReviewed` for the latest
   1–2 versions; flag if a recent version's reviews dropped. Ties into the existing
   events/version timeline.
5. **Developer reply rate** — % of captured reviews with a `devReplyText`, and % among
   ≤3-star reviews. Actionable best-practice signal.
6. **Language spread** — distinct `language` count + top languages. Validates the
   localization factor already in the prompt. (Nearly free.)

Also: extend the existing total-review-count + rating comparison (currently Rubric-only)
so the review block carries it in all three variants.

## Guardrails (baked into prompt text)

- Every review number labeled **"based on N most recent captured text reviews."**
- Keep three counts distinct: **total ratings** (`ratingCount`) vs **CWS text-review count**
  (`reviewTextCount`) vs **captured count** (what we stored).
- Short system-prompt note: reviews correlate with popularity; use them for **diagnosis +
  keyword discovery**; do **not** attribute rank causation; **no invented weights**.

## Components & data flow

- **New** `src/shared/utils/review-analysis.ts` (pure, no Vue/DOM):
  `computeReviewSignals(reviews: Review[], listing: ListingSnapshot | null, keywords: string[]): ReviewSignals`
  and a `renderReviewBlock(own: ReviewSignals | null, comp: ReviewSignals | null): string`
  returning `''` when both are null. Fully unit-testable.
- **`src/shared/utils/keyword-audit.ts`**:
  - Extend `AuditInput` with optional `ownReviews?: Review[]`, `compReviews?: Review[]`
    (raw reviews in; signals computed inside `buildPlaceholderValues`, mirroring how
    listings/history are handled).
  - Add a `{{reviewSignals}}` placeholder (the rendered block, or `''`) + entry in
    `AUDIT_PLACEHOLDERS`.
  - Insert `{{reviewSignals}}` into all three user-prompt templates.
  - Add the hedged review note to all three system prompts.
- **`src/dashboard/components/ai/AuditTool.vue`**: load reviews for own + competitor via
  `db.getReviews(extensionId)` at input-assembly sites; attach to `AuditInput`. No block
  when neither side has reviews.
- **Partial vs full keyword match**: `countKeywordOccurrences` is whole-word only; add a
  separate substring matcher for "partial." Report both counts so partial isn't noise.

## Testing

- New `tests/unit/utils/review-analysis.test.ts`: each signal, empty input, missing listing,
  keyword full-vs-partial, sample-size labeling, `renderReviewBlock` empty-when-null.
- Extend `tests/unit/utils/keyword-audit.test.ts`: `{{reviewSignals}}` fills when reviews
  present, resolves to `''` (block omitted) when absent.

## Versioning

- `manifest.json` MINOR bump; `CHANGELOG.md` entry. No schema change (reviews table already
  exists at v5).

## Out of scope

- Multiple/chained LLM calls; a dedicated review-analysis call.
- Full "reputation factor" rubric rewrite.
- Refactoring the CoT few-shot example.
- Persisting the discarded top-30 search cards / running a formal rank↔reviews correlation
  study (a separate, optional future step; noted in conversation).

## Risks

- Captured sample skews to recent + text-only reviews → all signals are directional, not
  population truth. Mitigated by explicit sample labeling.
- Competitor reviews exist only if that extension was review-scanned → block may be one-sided;
  render handles a null side gracefully.
