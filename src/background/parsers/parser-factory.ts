/**
 * Parser factory - returns the correct parser version based on settings.
 *
 * When CWS changes their page format and a parser breaks, a new parser
 * version is created. The factory selects the appropriate version based
 * on the configured `parserVersion` setting.
 */

import { listingParserV1 } from './listing-v1.js';
import { searchParserV1 } from './search-v1.js';
import type { ListingParser, SearchParser } from './types.js';

const LISTING_PARSERS: Record<string, ListingParser> = {
  'listing-v1': listingParserV1,
};

const SEARCH_PARSERS: Record<string, SearchParser> = {
  'search-v1': searchParserV1,
};

/**
 * Get a listing parser by version string.
 * Defaults to the latest version if no version is specified.
 *
 * @param version - Parser version string (e.g. "listing-v1"). Defaults to latest.
 * @returns The listing parser instance.
 * @throws Error if the requested parser version is not found.
 */
export function getListingParser(version?: string): ListingParser {
  const key = version ? `listing-${version}` : 'listing-v1';
  const parser = LISTING_PARSERS[key];
  if (!parser) {
    throw new Error(
      `Unknown listing parser version: "${key}". Available: ${Object.keys(LISTING_PARSERS).join(', ')}`,
    );
  }
  return parser;
}

/**
 * Get a search parser by version string.
 * Defaults to the latest version if no version is specified.
 *
 * @param version - Parser version string (e.g. "search-v1"). Defaults to latest.
 * @returns The search parser instance.
 * @throws Error if the requested parser version is not found.
 */
export function getSearchParser(version?: string): SearchParser {
  const key = version ? `search-${version}` : 'search-v1';
  const parser = SEARCH_PARSERS[key];
  if (!parser) {
    throw new Error(
      `Unknown search parser version: "${key}". Available: ${Object.keys(SEARCH_PARSERS).join(', ')}`,
    );
  }
  return parser;
}

/** Get all available listing parser versions. */
export function getAvailableListingParsers(): string[] {
  return Object.keys(LISTING_PARSERS);
}

/** Get all available search parser versions. */
export function getAvailableSearchParsers(): string[] {
  return Object.keys(SEARCH_PARSERS);
}
