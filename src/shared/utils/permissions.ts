/**
 * Permission risk scoring utilities (Phase 1.5.1).
 *
 * Calculates a 0-100 risk score based on Chrome extension permissions.
 * High-friction permissions that trigger install warnings get higher weights.
 * Weights from PRD Section 5.1.2.
 */

// ---------------------------------------------------------------------------
// Permission weights (from PRD)
// ---------------------------------------------------------------------------

/** Risk weight for each known Chrome permission. */
const PERMISSION_WEIGHTS: Record<string, number> = {
  '<all_urls>': 30,
  history: 25,
  tabs: 20,
  bookmarks: 15,
  webRequest: 15,
  cookies: 15,
  activeTab: 5,
  // Zero-weight (no install warning)
  storage: 0,
  alarms: 0,
  notifications: 0,
  contextMenus: 0,
  identity: 0,
  idle: 0,
  management: 0,
  power: 0,
  runtime: 0,
  sessions: 0,
  topSites: 0,
  unlimitedStorage: 0,
  webNavigation: 0,
};

/** Install warning text for permissions that trigger one. */
const PERMISSION_WARNINGS: Record<string, string> = {
  '<all_urls>': 'Read and change all your data on all websites',
  history: 'Read your browsing history',
  tabs: 'Read your browsing history',
  bookmarks: 'Read and change your bookmarks',
  webRequest: 'Observe and intercept network requests',
  cookies: 'Read cookies for all sites',
  activeTab: 'Access current tab on click',
};

/** Risk categories for permissions. */
interface PermissionCategories {
  high: string[];
  medium: string[];
  low: string[];
  none: string[];
}

/** Weight for a narrow host permission (single domain). */
const NARROW_HOST_WEIGHT = 5;

/** Weight for a broad host permission (all sites). */
const BROAD_HOST_WEIGHT = 30;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the host permission pattern matches all URLs.
 * Broad patterns include: "*:\/\/*\/*", "http:\/\/*\/*", "https:\/\/*\/*".
 */
function isBroadHostPermission(pattern: string): boolean {
  return (
    pattern === '<all_urls>' ||
    pattern === '*://*/*' ||
    pattern === 'http://*/*' ||
    pattern === 'https://*/*'
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Calculate a 0-100 risk score based on declared permissions and host permissions.
 *
 * - Known permissions use their PRD-defined weight.
 * - Unknown permissions get weight 0 (no crash).
 * - Broad host permissions (e.g. "*:\/\/*\/*") are treated like "<all_urls>" (weight 30).
 * - Narrow host permissions (single domain) get a low weight (5).
 * - Final score is clamped to [0, 100].
 */
export function calculatePermissionRiskScore(
  permissions: string[],
  hostPermissions: string[]
): number {
  let score = 0;

  for (const perm of permissions) {
    const weight = PERMISSION_WEIGHTS[perm];
    score += weight !== undefined ? weight : 0;
  }

  for (const host of hostPermissions) {
    if (isBroadHostPermission(host)) {
      score += BROAD_HOST_WEIGHT;
    } else {
      score += NARROW_HOST_WEIGHT;
    }
  }

  return Math.min(Math.max(score, 0), 100);
}

/**
 * Returns the install warning text for a permission, or `null` if the
 * permission does not trigger a warning.
 */
export function getPermissionWarning(permission: string): string | null {
  return PERMISSION_WARNINGS[permission] ?? null;
}

/**
 * Categorize an array of permissions by risk level.
 *
 * - high: weight >= 20
 * - medium: weight 10-19
 * - low: weight 1-9
 * - none: weight 0 or unknown
 */
export function categorizePermissions(permissions: string[]): PermissionCategories {
  const categories: PermissionCategories = {
    high: [],
    medium: [],
    low: [],
    none: [],
  };

  for (const perm of permissions) {
    const weight = PERMISSION_WEIGHTS[perm];
    if (weight === undefined || weight === 0) {
      categories.none.push(perm);
    } else if (weight >= 20) {
      categories.high.push(perm);
    } else if (weight >= 10) {
      categories.medium.push(perm);
    } else {
      categories.low.push(perm);
    }
  }

  return categories;
}
