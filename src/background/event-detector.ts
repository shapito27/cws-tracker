/**
 * Event Detection (Phase 1.6.3).
 *
 * Compares consecutive listing snapshots to detect changes and generate
 * EventRecord entries. Returns zero or more events per comparison.
 *
 * Rules:
 * - First scan (no previous snapshot): no events generated.
 * - Identical snapshots: no events.
 * - Whitespace-only description changes: ignored.
 * - Permission comparison: sorted sets, order doesn't matter.
 * - Rating milestones: floor(previous) !== floor(current).
 * - User milestones: crossing defined thresholds (1K, 5K, 10K, 50K, 100K, 500K, 1M).
 */

import type { ListingSnapshot, EventRecord, EventType } from '@/shared/types';
import { today } from '@/shared/utils/dates';

// ---------------------------------------------------------------------------
// User milestone thresholds
// ---------------------------------------------------------------------------

const USER_MILESTONES = [1_000, 5_000, 10_000, 50_000, 100_000, 500_000, 1_000_000];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect changes between a previous and current listing snapshot.
 *
 * @param previous  The previous snapshot, or `null` for the first scan.
 * @param current   The current (just-scanned) snapshot.
 * @returns Array of EventRecord entries (without `id`). May be empty.
 */
export function detectChanges(
  previous: ListingSnapshot | null,
  current: ListingSnapshot
): EventRecord[] {
  if (previous === null) {
    return [];
  }

  const events: EventRecord[] = [];
  const date = current.date || today();

  // Title change
  if (previous.title !== current.title) {
    events.push(createEvent(
      current.extensionId,
      date,
      'title_change',
      'title',
      previous.title,
      current.title,
      `Title changed from '${previous.title}' to '${current.title}'`
    ));
  }

  // Short description change (ignore whitespace-only)
  if (normalizeWhitespace(previous.shortDescription) !== normalizeWhitespace(current.shortDescription)) {
    events.push(createEvent(
      current.extensionId,
      date,
      'description_change',
      'shortDescription',
      previous.shortDescription,
      current.shortDescription,
      'Short description changed'
    ));
  }

  // Full description change (ignore whitespace-only)
  if (normalizeWhitespace(previous.fullDescription) !== normalizeWhitespace(current.fullDescription)) {
    events.push(createEvent(
      current.extensionId,
      date,
      'description_change',
      'fullDescription',
      previous.fullDescription,
      current.fullDescription,
      'Full description changed'
    ));
  }

  // Version change
  if (previous.version !== current.version) {
    events.push(createEvent(
      current.extensionId,
      date,
      'version_change',
      'version',
      previous.version,
      current.version,
      `Version changed from '${previous.version}' to '${current.version}'`
    ));
  }

  // Permission change (compare sorted sets)
  const prevPerms = [...previous.permissions].sort();
  const currPerms = [...current.permissions].sort();
  if (JSON.stringify(prevPerms) !== JSON.stringify(currPerms)) {
    const added = currPerms.filter((p) => !prevPerms.includes(p));
    const removed = prevPerms.filter((p) => !currPerms.includes(p));
    const parts: string[] = [];
    if (added.length > 0) parts.push(`added: ${added.join(', ')}`);
    if (removed.length > 0) parts.push(`removed: ${removed.join(', ')}`);
    events.push(createEvent(
      current.extensionId,
      date,
      'permission_change',
      'permissions',
      JSON.stringify(prevPerms),
      JSON.stringify(currPerms),
      `Permissions changed (${parts.join('; ')})`
    ));
  }

  // Host permission change (compare sorted sets)
  const prevHostPerms = [...previous.hostPermissions].sort();
  const currHostPerms = [...current.hostPermissions].sort();
  if (JSON.stringify(prevHostPerms) !== JSON.stringify(currHostPerms)) {
    const added = currHostPerms.filter((p) => !prevHostPerms.includes(p));
    const removed = prevHostPerms.filter((p) => !currHostPerms.includes(p));
    const parts: string[] = [];
    if (added.length > 0) parts.push(`added: ${added.join(', ')}`);
    if (removed.length > 0) parts.push(`removed: ${removed.join(', ')}`);
    events.push(createEvent(
      current.extensionId,
      date,
      'permission_change',
      'hostPermissions',
      JSON.stringify(prevHostPerms),
      JSON.stringify(currHostPerms),
      `Host permissions changed (${parts.join('; ')})`
    ));
  }

  // Translation count change
  if (previous.translationCount !== current.translationCount) {
    events.push(createEvent(
      current.extensionId,
      date,
      'translation_change',
      'translationCount',
      String(previous.translationCount),
      String(current.translationCount),
      `Translation count changed from ${previous.translationCount} to ${current.translationCount}`
    ));
  }

  // Screenshot count change
  if (previous.screenshotCount !== current.screenshotCount) {
    events.push(createEvent(
      current.extensionId,
      date,
      'screenshot_change',
      'screenshotCount',
      String(previous.screenshotCount),
      String(current.screenshotCount),
      `Screenshot count changed from ${previous.screenshotCount} to ${current.screenshotCount}`
    ));
  }

  // Size change
  if (previous.size !== current.size) {
    events.push(createEvent(
      current.extensionId,
      date,
      'size_change',
      'size',
      previous.size,
      current.size,
      `Size changed from '${previous.size}' to '${current.size}'`
    ));
  }

  // Badge change
  if (JSON.stringify(previous.badgeFlags) !== JSON.stringify(current.badgeFlags)) {
    events.push(createEvent(
      current.extensionId,
      date,
      'badge_change',
      'badgeFlags',
      JSON.stringify(previous.badgeFlags),
      JSON.stringify(current.badgeFlags),
      generateBadgeChangeNote(previous.badgeFlags, current.badgeFlags)
    ));
  }

  // Rating milestone: floor(previous) !== floor(current)
  if (previous.rating !== null && current.rating !== null) {
    if (Math.floor(previous.rating) !== Math.floor(current.rating)) {
      events.push(createEvent(
        current.extensionId,
        date,
        'rating_milestone',
        'rating',
        String(previous.rating),
        String(current.rating),
        `Rating milestone: ${previous.rating.toFixed(1)} → ${current.rating.toFixed(1)} (crossed ${Math.floor(current.rating)}-star threshold)`
      ));
    }
  }

  // User milestone: crossing defined thresholds
  const crossedMilestones = getUserMilestonesCrossed(
    previous.userCountNumeric,
    current.userCountNumeric
  );
  for (const milestone of crossedMilestones) {
    events.push(createEvent(
      current.extensionId,
      date,
      'user_milestone',
      'userCountNumeric',
      String(previous.userCountNumeric),
      String(current.userCountNumeric),
      `User milestone: crossed ${formatMilestone(milestone)} users (${previous.userCountNumeric} → ${current.userCountNumeric})`
    ));
  }

  return events;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createEvent(
  extensionId: string,
  date: string,
  type: EventType,
  field: string,
  oldValue: string | null,
  newValue: string | null,
  note: string
): EventRecord {
  return { extensionId, date, type, field, oldValue, newValue, note, detectedAt: new Date() };
}

/**
 * Normalize whitespace in a string for comparison purposes.
 * Collapses all runs of whitespace to a single space and trims.
 */
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Find which user-count milestones were crossed between two values.
 * Handles both upward and downward crossing (only upward generates events).
 */
function getUserMilestonesCrossed(
  previousCount: number,
  currentCount: number
): number[] {
  if (currentCount <= previousCount) return [];

  return USER_MILESTONES.filter(
    (milestone) => previousCount < milestone && currentCount >= milestone
  );
}

/**
 * Format a milestone number for display (e.g. 1000 → "1K", 1000000 → "1M").
 */
function formatMilestone(value: number): string {
  if (value >= 1_000_000) return `${value / 1_000_000}M`;
  if (value >= 1_000) return `${value / 1_000}K`;
  return String(value);
}

/**
 * Generate a human-readable note for badge flag changes.
 */
function generateBadgeChangeNote(
  previous: Record<string, boolean>,
  current: Record<string, boolean>
): string {
  const allKeys = new Set([...Object.keys(previous), ...Object.keys(current)]);
  const added: string[] = [];
  const removed: string[] = [];

  for (const key of allKeys) {
    const hadBadge = previous[key] === true;
    const hasBadge = current[key] === true;
    if (!hadBadge && hasBadge) added.push(key);
    if (hadBadge && !hasBadge) removed.push(key);
  }

  const parts: string[] = [];
  if (added.length > 0) parts.push(`gained: ${added.join(', ')}`);
  if (removed.length > 0) parts.push(`lost: ${removed.join(', ')}`);
  return `Badge changed (${parts.join('; ')})`;
}
