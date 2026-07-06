/**
 * Reviews Parser v1 - Parses CWS extension `/reviews` data.
 *
 * The reviews page server-renders the newest reviews inline in an
 * `AF_initDataCallback({key: 'ds:1', ...})` block. The proxy extracts that
 * `ds:1` array and passes it here as the JSON string. Paginated pages (2+)
 * come from the CWS `batchexecute` reviews RPC; the proxy unwraps the envelope
 * and passes the inner payload. Both are handled by `parse`.
 *
 * ds:1 envelope layout (verified 2026-07-03):
 *   [ [continuationToken], [review, review, ...], textReviewCount ]
 *
 * Single review layout (array indices):
 *   [0]  reviewId (UUID)
 *   [1]  [reviewerName, avatarUrl]
 *   [2]  rating (1-5)
 *   [3]  message text ("" when rating-only)
 *   [4]  posted timestamp [seconds, nanos]
 *   [5]  updated timestamp [seconds, nanos]
 *   [6]  helpful count
 *   [8]  developer reply | null: [replyId, [author, avatar], text, tsA, tsB, ..., lang]
 *   [11] extension version reviewed
 *   [13] review language
 *   [14] extension id
 */

import type { ParsedReview, ReviewsData, ReviewsParser } from './types.js';
import { ParserError } from './types.js';

const VERSION = 'reviews-v1';

/** Extract Unix seconds from a CWS `[seconds, nanos]` timestamp array. */
function epochSeconds(ts: unknown): number {
  return Array.isArray(ts) && typeof ts[0] === 'number' ? ts[0] : 0;
}

/**
 * Parse a single review entry. Returns null for entries without a valid
 * review id (defensive against unexpected non-review entries).
 */
function parseReview(entry: unknown[]): ParsedReview | null {
  const reviewId = typeof entry[0] === 'string' ? entry[0] : '';
  if (!reviewId) return null;

  const rating = typeof entry[2] === 'number' ? entry[2] : 0;
  if (rating < 1 || rating > 5) {
    throw new ParserError(`Invalid rating ${rating}`, VERSION, 'rating');
  }

  const reviewer = Array.isArray(entry[1]) ? entry[1] : [];
  const reply = Array.isArray(entry[8]) ? (entry[8] as unknown[]) : null;
  const replyAuthorArr = reply && Array.isArray(reply[1]) ? reply[1] : [];

  return {
    reviewId,
    extensionId: typeof entry[14] === 'string' ? entry[14] : '',
    reviewerName: typeof reviewer[0] === 'string' ? reviewer[0] : '',
    reviewerAvatar: typeof reviewer[1] === 'string' ? reviewer[1] : null,
    rating,
    text: typeof entry[3] === 'string' ? entry[3] : '',
    postedAtEpoch: epochSeconds(entry[4]),
    updatedAtEpoch: epochSeconds(entry[5]),
    helpfulCount: typeof entry[6] === 'number' ? entry[6] : 0,
    devReply: reply
      ? {
          author: typeof replyAuthorArr[0] === 'string' ? replyAuthorArr[0] : '',
          text: typeof reply[2] === 'string' ? reply[2] : '',
          atEpoch: epochSeconds(reply[3]),
        }
      : null,
    versionReviewed: typeof entry[11] === 'string' ? entry[11] : null,
    language: typeof entry[13] === 'string' ? entry[13] : null,
  };
}

export const reviewsParserV1: ReviewsParser = {
  version: VERSION,

  parse(json: string): ReviewsData {
    if (!json || json.trim().length === 0) {
      throw new ParserError('Empty reviews response', VERSION);
    }

    let env: unknown;
    try {
      env = JSON.parse(json);
    } catch {
      throw new ParserError('Invalid JSON in reviews response', VERSION);
    }

    if (!Array.isArray(env)) {
      throw new ParserError('Reviews response is not an array', VERSION);
    }

    const list = Array.isArray(env[1]) ? (env[1] as unknown[]) : [];
    const reviews: ParsedReview[] = [];
    for (const entry of list) {
      if (Array.isArray(entry)) {
        const parsed = parseReview(entry);
        if (parsed) reviews.push(parsed);
      }
    }

    const nextToken =
      Array.isArray(env[0]) && typeof env[0][0] === 'string' && env[0][0].length > 0
        ? env[0][0]
        : null;

    return {
      reviews,
      textReviewCount: typeof env[2] === 'number' ? env[2] : null,
      nextToken,
    };
  },
};
