/**
 * Content hashing for review change detection.
 *
 * A review's "content" for change-detection purposes is its rating, text,
 * helpful count, and developer reply text. Timestamps are deliberately excluded
 * because CWS posted-vs-updated timestamp semantics are ambiguous; a content
 * hash is a robust signal that something a user would notice actually changed.
 */

/** Fields that constitute a review's user-visible content. */
export interface ReviewContent {
  rating: number;
  text: string;
  helpfulCount: number;
  devReplyText: string | null;
}

/**
 * Deterministic 32-bit hash of a review's content, returned as a string.
 * Not cryptographic — only needs to be stable and collision-resistant enough
 * to detect edits between scans.
 */
export function contentHashForReview(r: ReviewContent): string {
  const s = `${r.rating}|${r.text}|${r.helpfulCount}|${r.devReplyText ?? ''}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  }
  // Unsigned hex keeps it compact and index-friendly.
  return (h >>> 0).toString(16);
}
