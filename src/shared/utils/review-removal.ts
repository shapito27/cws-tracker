/**
 * Review removal detection.
 *
 * A review that was stored earlier but is absent from a review scan has been
 * removed from CWS (the reviewer deleted it, or CWS moderated it — the two are
 * indistinguishable from outside). Absence only proves removal when the scan
 * could have seen the review, though: a scan fetches the newest `limit`
 * reviews, so an older stored review is simply outside the window.
 *
 * Deliberately conservative — a missed removal is caught later or never, a
 * false one tells the user a review vanished when it did not:
 * - An empty fetch proves nothing (an upstream failure also yields an empty
 *   envelope), so it flags nothing.
 * - A fetch is the complete list only when it is shorter than `limit` AND CWS
 *   returned no continuation token. The token is CWS itself saying more reviews
 *   exist, which also covers a server-side cap below `limit` and entries the
 *   parser skipped. Then everything stored but unseen is gone.
 * - A full fetch is a window. We do not know whether CWS orders it by posted or
 *   updated time, so a stored review counts as inside the window only when
 *   BOTH its timestamps are strictly newer than the oldest timestamp seen in
 *   the fetch (`max(minPosted, minUpdated)`, which is `minUpdated`). A fetched
 *   review with a missing timestamp (the parser yields 0) makes the boundary
 *   meaningless, so a window fetch containing one flags nothing.
 * - If one scan would flag most of the in-window reviews, treat it as a fetch
 *   anomaly and flag nothing.
 */

import type { Review } from '@/shared/types';

/** Above this many removals, more than half of the in-window set is an anomaly. */
const ANOMALY_MIN_REMOVED = 3;

export interface RemovalInput {
  /** Reviews already stored for the extension (including ones already marked removed). */
  stored: readonly Review[];
  /** Reviews returned by this scan. */
  fetched: readonly Pick<Review, 'reviewId' | 'postedAtEpoch' | 'updatedAtEpoch'>[];
  /** The `reviewFetchLimit` the scan asked for. */
  limit: number;
  /** True when CWS returned a continuation token, i.e. more reviews exist beyond this fetch. */
  moreAvailable: boolean;
}

export function findRemovedReviews({
  stored,
  fetched,
  limit,
  moreAvailable,
}: RemovalInput): Review[] {
  if (fetched.length === 0) return [];

  const seen = new Set(fetched.map((r) => r.reviewId));
  const complete = fetched.length < limit && !moreAvailable;

  let boundary = 0;
  if (!complete) {
    // An unparseable timestamp (0) would pull the boundary to the epoch and put
    // every stored review "inside" the window. Refuse rather than guess.
    if (fetched.some((r) => !(r.postedAtEpoch > 0) || !(r.updatedAtEpoch > 0))) return [];
    boundary = Math.min(...fetched.map((r) => r.updatedAtEpoch));
  }

  const candidates = stored.filter((r) => !r.removedAt && !seen.has(r.reviewId));
  const inWindowStored = stored.filter(
    (r) => !r.removedAt && (complete || (r.postedAtEpoch > boundary && r.updatedAtEpoch > boundary))
  );
  const removed = candidates.filter(
    (r) => complete || (r.postedAtEpoch > boundary && r.updatedAtEpoch > boundary)
  );

  if (removed.length > ANOMALY_MIN_REMOVED && removed.length * 2 > inWindowStored.length) {
    return [];
  }
  return removed;
}
