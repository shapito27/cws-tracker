/**
 * Review analysis for the AI keyword audit.
 *
 * Computes a compact set of "review signals" from CAPTURED reviews (a local
 * sample accumulated across scans, may include rating-only reviews — NOT the
 * full rating population)
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
    '_Based on the reviews captured locally for each extension — a sample accumulated across scans (may include rating-only reviews), NOT the full rating population. Use for diagnosis and keyword discovery; do not treat as a ranking score._',
    '',
    '| Signal | Your Extension | Competitor |',
    '|--------|----------------|------------|',
    ...rows.map(([label, fn]) => `| ${label} | ${cell(own, fn)} | ${cell(comp, fn)} |`),
  ];
  return lines.join('\n');
}
