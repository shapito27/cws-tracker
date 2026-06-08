/**
 * Core TypeScript types and interfaces for CWS Tracker.
 *
 * Conventions:
 * - Auto-increment IDs are `number` (Dexie `++id`), optional when creating.
 * - Extension IDs are `string` (CWS 32-char ID).
 * - Indexed date fields use `string` (YYYY-MM-DD) for human-readable sorting.
 * - Non-indexed timestamps use `Date` objects.
 */

// Re-export sibling modules
export type {
  ScanProgressMessage,
  ScanCompleteMessage,
  NewEventMessage,
  ScanErrorMessage,
  QueueStatusMessage,
  TriggerRefreshMessage,
  PauseScanMessage,
  ResumeScanMessage,
  CancelScanMessage,
  ServiceWorkerMessage,
  DashboardMessage,
  ScanType,
  ScanPhase,
} from './messages';

export type { Settings, SubscriptionStatus, AuditPromptVariant } from './settings';

// ---------------------------------------------------------------------------
// Enumerations (string literal unions)
// ---------------------------------------------------------------------------

/** Types of changes detected between listing snapshots. */
export type EventType =
  | 'title_change'
  | 'description_change'
  | 'version_change'
  | 'permission_change'
  | 'rating_milestone'
  | 'user_milestone'
  | 'translation_change'
  | 'screenshot_change'
  | 'badge_change'
  | 'rank_change'
  | 'size_change';

/** Queue job variants. */
export type QueueJobType = 'listing_scan' | 'keyword_scan' | 'translation_audit' | 'autocomplete_scan';

/** Lifecycle states of a queue job. */
export type QueueJobStatus = 'pending' | 'running' | 'completed' | 'failed';

/** Tracking status of an extension. */
export type ExtensionStatus = 'active' | 'removed' | 'error';

// ---------------------------------------------------------------------------
// Core data models
// ---------------------------------------------------------------------------

/**
 * A tracking project grouping one owned extension, competitors, and keywords.
 *
 * Dexie indexes: `++id`
 */
export interface Project {
  /** Auto-increment primary key. Omit when creating. */
  id?: number;
  name: string;
  /** CWS extension ID of the user's own extension. */
  ownExtensionId: string;
  /** CWS extension IDs of competitor extensions. */
  competitorIds: string[];
  /** IDs of tracked keywords belonging to this project. */
  keywordIds: number[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A tracked Chrome extension (own or competitor).
 *
 * Dexie indexes: `id` (CWS extension ID, not auto-increment)
 */
export interface Extension {
  /** CWS 32-char extension ID (primary key, not auto-increment). */
  id: string;
  /** Display name (populated after first scan). */
  name: string;
  /** Extension icon URL for display. Not in PRD; added for dashboard UI needs. */
  iconUrl: string | null;
  addedAt: Date;
  lastScannedAt: Date | null;
  status: ExtensionStatus;
  /** Project IDs that reference this extension (for cleanup on delete). */
  projectRefs: number[];
}

/**
 * A keyword or phrase tracked for search ranking.
 *
 * Dexie indexes: `++id`, `projectId`
 */
export interface Keyword {
  /** Auto-increment primary key. Omit when creating. */
  id?: number;
  /** The search term or phrase. */
  text: string;
  /** Project this keyword belongs to. */
  projectId: number;
  createdAt: Date;
}

/**
 * A point-in-time snapshot of an extension's CWS listing.
 *
 * Dexie indexes: `[extensionId+date]`, `extensionId`
 *
 * Field mapping from parser `ListingData` → `ListingSnapshot`:
 *
 * Most fields map directly (parser now computes derived values):
 * | ListingData field  | ListingSnapshot field | Transformation                          |
 * |--------------------|-----------------------|-----------------------------------------|
 * | name               | title                 | direct                                  |
 * | fullDescription    | fullDescription       | direct                                  |
 * | shortDescription   | shortDescription      | direct                                  |
 * | developerName      | developerName         | direct                                  |
 * | rating             | rating                | direct (null if no ratings)             |
 * | ratingCount        | ratingCount           | direct                                  |
 * | reviewCount        | reviewCount           | direct (mirrors ratingCount)            |
 * | userCount          | userCount             | direct (formatted string)               |
 * | userCountNumeric   | userCountNumeric      | direct                                  |
 * | lastUpdated        | lastUpdated           | direct (YYYY-MM-DD)                     |
 * | size               | size                  | direct                                  |
 * | availableLocales   | availableLocales      | direct                                  |
 * | translationCount   | translationCount      | direct                                  |
 * | screenshotCount    | screenshotCount       | direct                                  |
 * | badgeFlags         | badgeFlags            | direct                                  |
 * | permissions        | permissions           | direct (from manifest)                  |
 * | hostPermissions    | hostPermissions       | direct (from manifest)                  |
 * | hasPromoVideo      | hasPromoVideo         | direct (defaults to false)              |
 * | developerVerified  | developerVerified     | direct (defaults to false)              |
 * | category           | category              | direct                                  |
 * | developerEmail     | developerEmail        | direct (null when not published)        |
 * | —                  | permissionRiskScore   | calculated by permission-risk utility   |
 * | —                  | listingQualityScore   | Phase 2 calculation; defaults to `null` |
 */
export interface ListingSnapshot {
  /** Auto-increment primary key. Omit when creating. */
  id?: number;
  extensionId: string;
  /** Indexed date: YYYY-MM-DD. */
  date: string;
  title: string;
  shortDescription: string;
  fullDescription: string;
  /** Average star rating (0-5). `null` if the extension has no ratings. */
  rating: number | null;
  /** Total number of ratings. */
  ratingCount: number;
  /** Total number of text reviews. CWS does not distinguish from ratingCount. */
  reviewCount: number;
  /** Display-formatted user count (e.g. "9,000,000+"). Derived from userCountNumeric. */
  userCount: string;
  /** Parsed numeric user count from CWS data. */
  userCountNumeric: number;
  version: string;
  /** Last updated date from CWS, stored as YYYY-MM-DD (parser returns Date). */
  lastUpdated: string;
  /** Extension file size string (e.g. "4.12MiB"). */
  size: string;
  /** Declared manifest permissions. Parsed from ListingData.manifestJson. */
  permissions: string[];
  /** Declared manifest host permissions. Parsed from ListingData.manifestJson. */
  hostPermissions: string[];
  /** Calculated permission risk score (0-100). */
  permissionRiskScore: number;
  /** Badge flags such as "featured". */
  badgeFlags: Record<string, boolean>;
  screenshotCount: number;
  /** Not currently extractable from CWS data; defaults to false. */
  hasPromoVideo: boolean;
  /** Number of supported locales. Derived from availableLocales.length. */
  translationCount: number;
  /** Locale codes (e.g. ["en", "ja", "de"]). Mapped from ListingData.languageCodes. */
  availableLocales: string[];
  /** CWS category string. */
  category: string;
  /** Publisher name. Mapped from ListingData.offeredBy. */
  developerName: string;
  /**
   * Developer contact email from CWS. `null` when not published by the developer.
   * Optional because pre-0.29.0 snapshots in IndexedDB lack this field entirely
   * (reads back as `undefined`); new snapshots always set it to `string | null`.
   */
  developerEmail?: string | null;
  /** Not currently extractable from CWS data; defaults to false. */
  developerVerified: boolean;
  /** Composite quality score (0-100). `null` until Phase 2 calculation. */
  listingQualityScore: number | null;
  /** Exact timestamp of this scan. */
  scannedAt: Date;
}

/**
 * A point-in-time search ranking record for one extension + keyword pair.
 *
 * Dexie indexes: `++id`, `[keywordId+extensionId+date]`, `[extensionId+date]`
 */
export interface RankSnapshot {
  /** Auto-increment primary key. Omit when creating. */
  id?: number;
  keywordId: number;
  extensionId: string;
  /** Indexed date: YYYY-MM-DD. */
  date: string;
  /**
   * 1-based rank position. `null` means the extension was not found in the
   * first page of results (display as "30+").
   */
  position: number | null;
  /** Total number of extensions in search results. */
  totalResults: number;
  scannedAt: Date;
}

/**
 * A detected change between consecutive listing snapshots.
 * Named `EventRecord` to avoid collision with the DOM `Event` type.
 *
 * Dexie indexes: `++id`, `[extensionId+date]`
 */
export interface EventRecord {
  /** Auto-increment primary key. Omit when creating. */
  id?: number;
  extensionId: string;
  /** Indexed date: YYYY-MM-DD. */
  date: string;
  type: EventType;
  /** The specific field that changed (e.g. "title", "permissions"). */
  field: string;
  /** Previous value, stringified. `null` for first-scan events. */
  oldValue: string | null;
  /** New value, stringified. */
  newValue: string | null;
  /** Human-readable description (e.g. "Title changed from 'X' to 'Y'"). */
  note: string;
  /** Exact timestamp when the change was detected. Not indexed. Absent on legacy records. */
  detectedAt?: Date;
}

// ---------------------------------------------------------------------------
// Queue system
// ---------------------------------------------------------------------------

/** Payload for a listing_scan job. */
export interface ListingScanPayload {
  extensionId: string;
}

/** Payload for a keyword_scan job. */
export interface KeywordScanPayload {
  keywordId: number;
  keyword: string;
}

/** Payload for a translation_audit job. */
export interface TranslationAuditPayload {
  extensionId: string;
  locale: string;
}

/** Payload for an autocomplete_scan job. */
export interface AutocompleteScanPayload {
  keywordId: number;
  keyword: string;
}

/** Discriminated union of all possible job payloads. */
export type QueueJobPayload =
  | ListingScanPayload
  | KeywordScanPayload
  | TranslationAuditPayload
  | AutocompleteScanPayload;

/**
 * A queued job in IndexedDB. Survives service worker restarts.
 *
 * Dexie indexes: `++id`, `[status+scheduledAt]`, `status`
 */
export interface QueueJob {
  /** Auto-increment primary key. Omit when creating. */
  id?: number;
  type: QueueJobType;
  payload: QueueJobPayload;
  status: QueueJobStatus;
  /** Lower number = higher priority. */
  priority: number;
  retryCount: number;
  maxRetries: number;
  /**
   * When the job should execute. Stored as Date; Dexie indexes Date objects
   * as numeric timestamps internally.
   */
  scheduledAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  /** Error message if the job failed. */
  error: string | null;
}

// ---------------------------------------------------------------------------
// Scan logging
// ---------------------------------------------------------------------------

/** Log level for scan log entries. */
export type ScanLogLevel = 'info' | 'warn' | 'error';

/**
 * A log entry recording a single CWS request/response during scanning.
 *
 * Dexie indexes: `++id`, `timestamp`, `jobId`
 */
export interface ScanLog {
  /** Auto-increment primary key. Omit when creating. */
  id?: number;
  /** ISO 8601 timestamp string (e.g. '2026-02-07T14:30:00.000Z'). Indexed. */
  timestamp: string;
  /** Queue job ID that produced this log (if applicable). */
  jobId: number | null;
  /** Job type (listing_scan, keyword_scan, etc.). */
  jobType: string;
  /** Log severity level. */
  level: ScanLogLevel;
  /** The URL that was requested. */
  requestUrl: string;
  /** HTTP status code of the response (null if network error). */
  responseStatus: number | null;
  /** Leading portion of the response body, truncated for storage (see SCAN_LOG_PREVIEW_LENGTH). */
  responsePreview: string;
  /** Duration of the request in milliseconds. */
  durationMs: number;
  /** Human-readable description of the job (e.g. extension ID, keyword). */
  jobDetail: string;
  /** Error message if the request failed. */
  error: string | null;
  /** HTTP method used for the request (e.g. 'GET'). Optional for backwards compat with pre-0.17.0 logs. */
  httpMethod?: string;
  /** 1-indexed page number for paginated keyword scan requests. null/undefined for non-paginated. */
  pageNumber?: number | null;
  /**
   * Discriminates the entry kind. Optional for backwards compat with pre-0.31.0 logs
   * (treat undefined as 'request').
   * - `'request'`: an actual HTTP request/response to CWS (has real timing + body preview).
   * - `'summary'`: a synthetic per-page diagnostic for a keyword scan (results found,
   *   tracked extensions matched, pagination stop reason). Carries no real duration or
   *   body; the UI folds it into its corresponding request row instead of showing it
   *   as a standalone request.
   */
  kind?: 'request' | 'summary';
}

// ---------------------------------------------------------------------------
// Translation manipulation detection (Phase 3, defined early for schema)
// ---------------------------------------------------------------------------

/** Flags for each translation manipulation trick. */
export interface ManipulationFlags {
  /** Trick 1: Extension name differs significantly across locales. */
  differentName: {
    detected: boolean;
    /** 0-1 Levenshtein-based similarity (Latin) or brand-name check (non-Latin). */
    similarity: number;
    details?: string;
  };
  /** Trick 2: Short description differs significantly. */
  differentShortDesc: {
    detected: boolean;
    similarity: number;
    details?: string;
  };
  /** Trick 3: Competitor names found in listing text. */
  competitorNames: {
    detected: boolean;
    /** Competitor names that were matched. */
    matches: string[];
  };
  /** Trick 4: Description length significantly exceeds median across locales. */
  extendedDescription: {
    detected: boolean;
    /** This locale's length / median length across all locales. */
    ratio: number;
    details?: string;
  };
  /** Trick 5: Keyword list appended at end of description. */
  keywordsAtEnd: {
    detected: boolean;
    /** First 200 chars of detected keyword block. */
    excerpt?: string;
  };
  /** Trick 6: Keyword stuffing inline within description. */
  keywordsInline: {
    detected: boolean;
    excerpt?: string;
  };
  /** Trick 7: Description is semantically unrelated to the English version. */
  differentDescription: {
    detected: boolean;
    /** Keyword overlap ratio (Jaccard similarity). */
    similarity: number;
  };
  /** Trick 8: Content left in English for a non-English locale. */
  untranslatedEnglish: {
    detected: boolean;
    /** Proportion of content detected as English (0-1). */
    englishRatio: number;
  };
}

/**
 * A snapshot of a localized listing for translation audit purposes.
 *
 * Dexie indexes: `++id`, `[extensionId+date]`
 */
export interface TranslationSnapshot {
  /** Auto-increment primary key. Omit when creating. */
  id?: number;
  extensionId: string;
  /** Locale code (e.g. "es", "zh_CN"). */
  locale: string;
  /** Indexed date: YYYY-MM-DD. */
  date: string;
  title: string;
  shortDescription: string;
  fullDescription: string;
  /** Character count of fullDescription. */
  descriptionLength: number;
  /** Detected language of the content (best-effort heuristic). */
  detectedLanguage: string | null;
  manipulationFlags: ManipulationFlags;
  scannedAt: Date;
}

// ---------------------------------------------------------------------------
// Search autocomplete tracking (Phase 5.1)
// ---------------------------------------------------------------------------

/**
 * A point-in-time record of which extensions CWS recommends in autocomplete
 * for a given keyword. Tracks whether a tracked extension appears as a
 * suggestion when users type the keyword into the CWS search box.
 *
 * Dexie indexes: `++id`, `[keywordId+extensionId+date]`, `[keywordId+date]`
 */
export interface AutocompleteSnapshot {
  /** Auto-increment primary key. Omit when creating. */
  id?: number;
  keywordId: number;
  /** The tracked extension that appeared in autocomplete. */
  extensionId: string;
  /** Indexed date: YYYY-MM-DD. */
  date: string;
  /** 1-based position in the autocomplete dropdown (1-10). null = not in autocomplete. */
  position: number | null;
  /** Extension name as shown in autocomplete (may differ from listing title). null when not found. */
  suggestedName: string | null;
  scannedAt: Date;
}

/**
 * Text-only keyword suggestions from CWS autocomplete for keyword discovery.
 * Stored per keyword per day.
 *
 * Dexie indexes: `++id`, `[keywordId+date]`
 */
export interface AutocompleteKeywordSuggestion {
  /** Auto-increment primary key. Omit when creating. */
  id?: number;
  keywordId: number;
  /** Indexed date: YYYY-MM-DD. */
  date: string;
  /** Text suggestions returned by CWS autocomplete. */
  suggestions: string[];
  scannedAt: Date;
}
