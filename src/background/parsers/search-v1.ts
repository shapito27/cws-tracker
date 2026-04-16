/**
 * Search Parser v1 - Parses CWS search results pages.
 *
 * CWS search page structure (as of 2026-02):
 *   AF_initDataCallback({key: 'ds:1', hash: '2', data: [...]})
 *
 * ds:1 data layout:
 *   data[0][0][0][5][0][0] = Array of search result wrappers
 *     Each wrapper: [[extensionCard]] where extensionCard is the 20-field card
 *   data[2] = Pagination info: [nextPageToken, null, null, totalCount]
 *
 * Each extension card (20 fields):
 *   [0] = extension ID (32-char lowercase)
 *   [1] = icon URL
 *   [2] = name
 *   [3] = rating (number)
 *   [4] = rating count
 *   [5] = screenshot URL
 *   [6] = short description
 *   [7] = website URL or null
 *   [11] = category array ["category/subcategory", null, categoryId]
 *   [12] = badge flag A (1 or 0) — insufficient on its own for "Featured"
 *   [13] = badge flag B (1 or 0) — required alongside [12] for "Featured"
 *   [14] = user count
 *
 * Featured badge: require both [12] and [13] to be 1. [12] alone flips on for
 * many non-featured listings, producing false positives.
 */

import { extractCallbackData, safeGet } from './extract.js';
import type { SearchData, SearchParser, SearchResultEntry } from './types.js';
import { ParserError } from './types.js';

const VERSION = 'search-v1';

/**
 * Parse a single extension card from search results into a SearchResultEntry.
 */
function parseSearchCard(card: unknown[], position: number): SearchResultEntry | null {
  const extensionId = card[0];
  if (typeof extensionId !== 'string' || !/^[a-z]{32}$/.test(extensionId)) {
    return null;
  }

  const name = typeof card[2] === 'string' ? card[2] : '';
  const iconUrl = typeof card[1] === 'string' ? card[1] : '';
  const rating = typeof card[3] === 'number' ? card[3] : 0;
  const ratingCount = typeof card[4] === 'number' ? card[4] : 0;
  const shortDescription = typeof card[6] === 'string' ? card[6] : '';
  const userCount = typeof card[14] === 'number' ? card[14] : 0;

  const categoryArr = card[11];
  const category = Array.isArray(categoryArr) && typeof categoryArr[0] === 'string'
    ? categoryArr[0]
    : null;

  const isFeatured = card[12] === 1 && card[13] === 1;

  return {
    extensionId,
    name,
    iconUrl,
    rating,
    ratingCount,
    shortDescription,
    userCount,
    category,
    isFeatured,
    position,
  };
}

export const searchParserV1: SearchParser = {
  version: VERSION,

  parse(html: string): SearchData {
    const data = extractCallbackData(html, 'ds:1', VERSION);
    if (!data) {
      throw new ParserError(
        'ds:1 callback not found in search results',
        VERSION,
      );
    }

    // Navigate to the results array: data[0][0][0][5][0][0]
    const resultsWrapper = safeGet(data, 0, 0, 0, 5, 0, 0);

    // Empty search: data[0][0][0][5][0] = [[]] (empty inner array)
    if (!Array.isArray(resultsWrapper) || resultsWrapper.length === 0) {
      // Check pagination for total count
      const totalCount = safeGet(data, 2, 3);
      return {
        results: [],
        totalCount: typeof totalCount === 'number' ? totalCount : 0,
        nextPageToken: null,
      };
    }

    // Each item in resultsWrapper is [[extensionCard]] - double nested
    const results: SearchResultEntry[] = [];
    for (let i = 0; i < resultsWrapper.length; i++) {
      const wrapper = resultsWrapper[i];
      // Navigate: wrapper[0][0] = the 20-field extension card
      const card = safeGet(wrapper, 0, 0);
      if (!Array.isArray(card) || card.length < 15) continue;

      const entry = parseSearchCard(card, i + 1);
      if (entry) {
        results.push(entry);
      }
    }

    // Pagination at data[2]
    const paginationToken = safeGet(data, 2, 0);
    const nextPageToken = typeof paginationToken === 'string' ? paginationToken : null;

    const totalCountRaw = safeGet(data, 2, 3);
    const totalCount = typeof totalCountRaw === 'number' ? totalCountRaw : results.length;

    return {
      results,
      totalCount,
      nextPageToken,
    };
  },
};
