/**
 * Parser interfaces and types for CWS HTML response parsing.
 * Parsers are versioned - when CWS changes their format, create a new
 * version rather than modifying the existing one.
 */

/** Parsed data from a CWS extension detail page */
export interface ListingData {
  extensionId: string;
  name: string;
  description: string;
  shortDescription: string;
  version: string;
  offeredBy: string;
  rating: number;
  ratingCount: number;
  userCount: number;
  category: string | null;
  categoryId: number | null;
  lastUpdated: Date;
  size: string;
  languages: string[];
  languageCodes: string[];
  iconUrl: string;
  screenshotUrls: string[];
  websiteUrl: string | null;
  privacyPolicyUrl: string | null;
  supportUrl: string | null;
  isFeatured: boolean;
  manifestJson: string | null;
  developerEmail: string | null;
  developerId: string | null;
  browserMinVersion: string | null;
}

/** A single extension entry in search results */
export interface SearchResultEntry {
  extensionId: string;
  name: string;
  iconUrl: string;
  rating: number;
  ratingCount: number;
  shortDescription: string;
  userCount: number;
  category: string | null;
  isFeatured: boolean;
  position: number;
}

/** Parsed data from a CWS search results page */
export interface SearchData {
  results: SearchResultEntry[];
  totalCount: number;
  nextPageToken: string | null;
}

/** Error thrown when a parser encounters unexpected/invalid data */
export class ParserError extends Error {
  constructor(
    message: string,
    public readonly parserVersion: string,
    public readonly field?: string,
  ) {
    super(`[Parser ${parserVersion}] ${message}${field ? ` (field: ${field})` : ''}`);
    this.name = 'ParserError';
  }
}

/** Interface that all listing (detail page) parsers must implement */
export interface ListingParser {
  readonly version: string;
  parse(html: string): ListingData;
}

/** Interface that all search results parsers must implement */
export interface SearchParser {
  readonly version: string;
  parse(html: string): SearchData;
}
