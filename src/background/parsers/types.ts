/**
 * Parser interfaces and types for CWS HTML response parsing.
 * Parsers are versioned - when CWS changes their format, create a new
 * version rather than modifying the existing one.
 */

/** Parsed data from a CWS extension detail page */
export interface ListingData {
  extensionId: string;
  name: string;
  shortDescription: string;
  fullDescription: string;
  /** Average star rating (0-5). `null` if the extension has no ratings. */
  rating: number | null;
  /** Total number of star ratings. */
  ratingCount: number;
  /** Total number of text reviews. CWS does not distinguish; mirrors ratingCount. */
  reviewCount: number;
  /** Display-formatted user count (e.g. "16,000,000+"). */
  userCount: string;
  /** Raw numeric user count from CWS data. */
  userCountNumeric: number;
  version: string;
  /** Last updated date as YYYY-MM-DD string. */
  lastUpdated: string;
  size: string;
  /** Declared manifest permissions. Parsed from manifest JSON. */
  permissions: string[];
  /** Declared manifest host permissions. Parsed from manifest JSON. */
  hostPermissions: string[];
  screenshotCount: number;
  /** Screenshot URLs for UI display. */
  screenshotUrls: string[];
  /** Not currently extractable from CWS data; defaults to false. */
  hasPromoVideo: boolean;
  /** Number of supported locales. Derived from availableLocales.length. */
  translationCount: number;
  /** Locale codes (e.g. ["en", "ja", "de"]). */
  availableLocales: string[];
  /** Human-readable language names (e.g. ["English", "Japanese"]). */
  languages: string[];
  /** CWS category string (e.g. "make_chrome_yours/privacy"). */
  category: string;
  /** CWS numeric category ID. */
  categoryId: number | null;
  /** Publisher display name. */
  developerName: string;
  /** Not currently extractable from CWS data; defaults to false. */
  developerVerified: boolean;
  /** Badge flags such as "featured". */
  badgeFlags: Record<string, boolean>;
  /** Extension icon URL. */
  iconUrl: string;
  /** Developer/publisher website URL. */
  websiteUrl: string | null;
  /** Privacy policy URL. */
  privacyPolicyUrl: string | null;
  /** Support/issues URL. */
  supportUrl: string | null;
  /** Raw manifest.json string. */
  manifestJson: string | null;
  /** Developer contact email. */
  developerEmail: string | null;
  /** CWS developer ID. */
  developerId: string | null;
  /** Minimum Chrome version required. */
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
  /** 1-based position in search results. */
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

// ---------------------------------------------------------------------------
// Autocomplete (search suggestions)
// ---------------------------------------------------------------------------

/** A single extension suggestion from CWS search autocomplete. */
export interface AutocompleteSuggestionExtension {
  type: 'extension';
  name: string;
  extensionId: string;
  iconUrl: string;
  /** 1-based position in the autocomplete dropdown. */
  position: number;
}

/** A text-only suggestion from CWS search autocomplete. */
export interface AutocompleteSuggestionText {
  type: 'text';
  text: string;
  /** 1-based position in the autocomplete dropdown. */
  position: number;
}

/** A single autocomplete suggestion (extension or text). */
export type AutocompleteSuggestion =
  | AutocompleteSuggestionExtension
  | AutocompleteSuggestionText;

/** Parsed data from a CWS search autocomplete response. */
export interface AutocompleteData {
  suggestions: AutocompleteSuggestion[];
}

/** Interface that all autocomplete parsers must implement. */
export interface AutocompleteParser {
  readonly version: string;
  parse(json: string): AutocompleteData;
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

/** A single parsed review from a CWS extension `/reviews` page. */
export interface ParsedReview {
  /** Stable CWS review UUID — used as the upsert key and change-tracking id. */
  reviewId: string;
  extensionId: string;
  reviewerName: string;
  reviewerAvatar: string | null;
  /** Star rating, 1–5. */
  rating: number;
  /** Review body text. Empty string when the review carries no text. */
  text: string;
  /** Posted timestamp (Unix seconds). */
  postedAtEpoch: number;
  /** Updated/edited timestamp (Unix seconds). */
  updatedAtEpoch: number;
  /** "People found helpful" count. */
  helpfulCount: number;
  /** Developer reply ("answer"), or null if none. */
  devReply: { author: string; text: string; atEpoch: number } | null;
  /** Extension version the review was left on, if present. */
  versionReviewed: string | null;
  /** Review language code (e.g. "en"). */
  language: string | null;
}

/** Parsed data from a CWS reviews response (page 1 `ds:1` or a paginated RPC page). */
export interface ReviewsData {
  reviews: ParsedReview[];
  /** Total number of reviews with text, when reported by CWS (page-1 envelope). */
  textReviewCount: number | null;
  /** Continuation token for the next page, or null when there are no more pages. */
  nextToken: string | null;
}

/** Interface that all reviews parsers must implement. */
export interface ReviewsParser {
  readonly version: string;
  parse(json: string): ReviewsData;
}
