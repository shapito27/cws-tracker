/**
 * Event type color scheme for chart annotations and UI elements.
 *
 * Color assignments per PRD 5.2.3 / TODO 2.3.3:
 * - Red: permission_change
 * - Blue: version_change
 * - Green: rating_milestone, user_milestone
 * - Orange: title_change, description_change
 * - Gray: screenshot_change, translation_change, badge_change
 */

import type { EventType } from '../types';

/** Hex color for each event type, used in chart annotations. */
export const EVENT_TYPE_COLORS: Record<EventType, string> = {
  permission_change: '#DC2626',   // red-600
  version_change: '#2563EB',      // blue-600
  rating_milestone: '#16A34A',    // green-600
  user_milestone: '#16A34A',      // green-600
  title_change: '#D97706',        // amber-600
  description_change: '#D97706',  // amber-600
  screenshot_change: '#6B7280',   // gray-500
  translation_change: '#6B7280',  // gray-500
  badge_change: '#6B7280',        // gray-500
};

/** Human-readable label for each event type. */
export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  title_change: 'Title Change',
  description_change: 'Description Change',
  version_change: 'Version Change',
  permission_change: 'Permission Change',
  rating_milestone: 'Rating Milestone',
  user_milestone: 'User Milestone',
  translation_change: 'Translation Change',
  screenshot_change: 'Screenshot Change',
  badge_change: 'Badge Change',
};

/** All event types in display order. */
export const ALL_EVENT_TYPES: EventType[] = [
  'permission_change',
  'version_change',
  'rating_milestone',
  'user_milestone',
  'title_change',
  'description_change',
  'screenshot_change',
  'translation_change',
  'badge_change',
];
