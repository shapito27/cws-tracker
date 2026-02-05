/**
 * Listing Parser v1 - Parses CWS extension detail pages.
 *
 * CWS detail page structure (as of 2026-02):
 *   AF_initDataCallback({key: 'ds:0', hash: '2', data: [...]})
 *
 * ds:0 data layout:
 *   data[0]  = Extension card (20 fields): [id, iconUrl, name, rating, ratingCount,
 *              screenshot1, shortDesc, null, null, null, null, category, featured,
 *              promoted, userCount, null, screenshot2, timestamp, manifest, nameRepeat]
 *   data[5]  = Screenshots array: [[1, url], [1, url], ...]
 *   data[6]  = Full description text
 *   data[10] = Developer info: [email, null, null, null, 1, displayName, ..., developerId]
 *   data[13] = Version string
 *   data[14] = Last updated timestamp: [seconds, nanoseconds]
 *   data[15] = Size string (e.g., "4.12MiB")
 *   data[16] = Language names array
 *   data[22] = Related extensions array
 *   data[26] = Support URL
 *   data[27] = Browser min version
 *   data[33] = Privacy policy URL
 *   data[38] = Language codes array
 */

import { extractCallbackData, safeGet } from './extract.js';
import type { ListingData, ListingParser } from './types.js';
import { ParserError } from './types.js';

const VERSION = 'listing-v1';

/**
 * Parse a numeric user count into a display-formatted string.
 * Handles various input formats: "9,000+", "10,000,000+", "1K+", "0", etc.
 *
 * @param text - The user count string to parse
 * @returns The numeric user count
 */
export function parseUserCount(text: string): number {
  if (!text || text.trim() === '') return 0;

  const cleaned = text.trim().replace(/[,+]/g, '');

  // Handle abbreviated formats: "1K+", "5M+", etc.
  const abbrevMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*([KkMmBb])$/);
  if (abbrevMatch) {
    const num = parseFloat(abbrevMatch[1]);
    const suffix = abbrevMatch[2].toUpperCase();
    const multipliers: Record<string, number> = { K: 1_000, M: 1_000_000, B: 1_000_000_000 };
    return Math.round(num * (multipliers[suffix] ?? 1));
  }

  const parsed = parseInt(cleaned, 10);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Format a numeric user count into a display string.
 * e.g. 16000000 -> "16,000,000+"
 */
function formatUserCount(count: number): string {
  if (count <= 0) return '0';
  return count.toLocaleString('en-US') + '+';
}

/**
 * Parse a CWS timestamp array [seconds, nanoseconds] into a YYYY-MM-DD string.
 */
function parseTimestamp(ts: unknown): string {
  if (!Array.isArray(ts) || ts.length < 1 || typeof ts[0] !== 'number') {
    throw new ParserError('Invalid timestamp format', VERSION, 'lastUpdated');
  }
  const date = new Date(ts[0] * 1000);
  return date.toISOString().split('T')[0];
}

/**
 * Extract screenshot URLs from the screenshots array.
 * Each entry is [flag, url] where flag is typically 1.
 */
function parseScreenshots(screenshots: unknown): string[] {
  if (!Array.isArray(screenshots)) return [];
  return screenshots
    .filter((item): item is [number, string] =>
      Array.isArray(item) && item.length >= 2 && typeof item[1] === 'string',
    )
    .map((item) => item[1]);
}

/**
 * Extract permissions and host_permissions from a manifest JSON string.
 */
function parseManifestPermissions(manifestJson: string | null): {
  permissions: string[];
  hostPermissions: string[];
} {
  if (!manifestJson) return { permissions: [], hostPermissions: [] };

  try {
    const manifest = JSON.parse(manifestJson);
    const permissions = Array.isArray(manifest.permissions)
      ? manifest.permissions.filter((p: unknown): p is string => typeof p === 'string')
      : [];
    const hostPermissions = Array.isArray(manifest.host_permissions)
      ? manifest.host_permissions.filter((p: unknown): p is string => typeof p === 'string')
      : [];
    return { permissions, hostPermissions };
  } catch {
    return { permissions: [], hostPermissions: [] };
  }
}

export const listingParserV1: ListingParser = {
  version: VERSION,

  parse(html: string): ListingData {
    const data = extractCallbackData(html, 'ds:0', VERSION);
    if (!data) {
      throw new ParserError(
        'ds:0 callback not found - page may be a 404 or invalid response',
        VERSION,
      );
    }

    // The extension card data is at data[0]
    const card = data[0];
    if (!Array.isArray(card) || card.length < 15) {
      throw new ParserError(
        'Extension card data missing or too short',
        VERSION,
      );
    }

    // Validate this is actually an extension detail page (not a 404/browse page)
    // A valid detail page has a 32-char lowercase extension ID at card[0]
    const extensionId = card[0];
    if (typeof extensionId !== 'string' || !/^[a-z]{32}$/.test(extensionId)) {
      throw new ParserError(
        'Not a valid extension detail page - no extension ID found at expected path',
        VERSION,
        'extensionId',
      );
    }

    const name = card[2];
    if (typeof name !== 'string' || name.length === 0) {
      throw new ParserError('Extension name is missing', VERSION, 'name');
    }

    const rawRating = card[3];
    if (typeof rawRating !== 'number') {
      throw new ParserError('Rating is not a number', VERSION, 'rating');
    }

    const ratingCount = card[4];
    if (typeof ratingCount !== 'number') {
      throw new ParserError('Rating count is not a number', VERSION, 'ratingCount');
    }

    // If no ratings, set rating to null
    const rating = ratingCount === 0 ? null : rawRating;

    const shortDescription = typeof card[6] === 'string' ? card[6] : '';
    const userCountNumeric = typeof card[14] === 'number' ? card[14] : 0;
    const iconUrl = typeof card[1] === 'string' ? card[1] : '';

    // Category at card[11] = ["category/subcategory", null, categoryId]
    const categoryArr = card[11];
    let category = '';
    let categoryId: number | null = null;
    if (Array.isArray(categoryArr) && categoryArr.length >= 1) {
      category = typeof categoryArr[0] === 'string' ? categoryArr[0] : '';
      categoryId = typeof categoryArr[2] === 'number' ? categoryArr[2] : null;
    }

    const isFeatured = card[12] === 1;

    // Full description at data[6]
    const fullDescription = typeof data[6] === 'string' ? data[6] : '';

    // Developer info at data[10]
    const devInfo = data[10];
    let developerEmail: string | null = null;
    let developerName = '';
    let developerId: string | null = null;
    if (Array.isArray(devInfo)) {
      developerEmail = typeof devInfo[0] === 'string' ? devInfo[0] : null;
      developerName = typeof devInfo[5] === 'string' ? devInfo[5] : '';
      developerId = typeof devInfo[10] === 'string' ? devInfo[10] : null;
    }

    // Version at data[13]
    const version = typeof data[13] === 'string' ? data[13] : '';
    if (!version) {
      throw new ParserError('Version string is missing', VERSION, 'version');
    }

    // Last updated at data[14]
    const lastUpdated = parseTimestamp(data[14]);

    // Size at data[15]
    const size = typeof data[15] === 'string' ? data[15] : '';

    // Language names at data[16], language codes at data[38]
    const languages = Array.isArray(data[16])
      ? (data[16] as unknown[]).filter((l): l is string => typeof l === 'string')
      : [];
    const availableLocales = Array.isArray(data[38])
      ? (data[38] as unknown[]).filter((l): l is string => typeof l === 'string')
      : [];

    // Screenshots at data[5]
    const screenshotUrls = parseScreenshots(data[5]);

    // Support URL at data[26]
    const supportUrl = typeof data[26] === 'string' ? data[26] : null;

    // Browser min version at data[27]
    const browserMinVersion = typeof data[27] === 'string' ? data[27] : null;

    // Privacy policy at data[33]
    const privacyPolicyUrl = typeof data[33] === 'string' ? data[33] : null;

    // Website URL - check card[7] (some extensions have it there)
    const websiteUrl = typeof card[7] === 'string' ? card[7] : null;

    // Manifest JSON at card[18]
    const manifestJson = typeof card[18] === 'string' ? card[18] : null;

    // Extract permissions from manifest
    const { permissions, hostPermissions } = parseManifestPermissions(manifestJson);

    return {
      extensionId,
      name,
      shortDescription,
      fullDescription,
      rating,
      ratingCount,
      reviewCount: ratingCount,
      userCount: formatUserCount(userCountNumeric),
      userCountNumeric,
      version,
      lastUpdated,
      size,
      permissions,
      hostPermissions,
      screenshotCount: screenshotUrls.length,
      screenshotUrls,
      hasPromoVideo: false,
      translationCount: availableLocales.length,
      availableLocales,
      languages,
      category,
      categoryId,
      developerName,
      developerVerified: false,
      badgeFlags: { featured: isFeatured },
      iconUrl,
      websiteUrl,
      privacyPolicyUrl,
      supportUrl,
      manifestJson,
      developerEmail,
      developerId,
      browserMinVersion,
    };
  },
};
