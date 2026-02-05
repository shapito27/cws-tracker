/**
 * Tests for event color scheme and constants.
 */
import { describe, it, expect } from 'vitest';
import {
  EVENT_TYPE_COLORS,
  EVENT_TYPE_LABELS,
  ALL_EVENT_TYPES,
  getEventTypeBadgeClass,
} from '@/shared/utils/event-colors';
import type { EventType } from '@/shared/types';

describe('event-colors', () => {
  describe('EVENT_TYPE_COLORS', () => {
    it('should define a color for every event type', () => {
      const allTypes: EventType[] = [
        'title_change',
        'description_change',
        'version_change',
        'permission_change',
        'rating_milestone',
        'user_milestone',
        'translation_change',
        'screenshot_change',
        'badge_change',
      ];
      for (const type of allTypes) {
        expect(EVENT_TYPE_COLORS[type]).toBeDefined();
        expect(EVENT_TYPE_COLORS[type]).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    });

    it('should use red for permission_change', () => {
      expect(EVENT_TYPE_COLORS.permission_change).toBe('#DC2626');
    });

    it('should use blue for version_change', () => {
      expect(EVENT_TYPE_COLORS.version_change).toBe('#2563EB');
    });

    it('should use green for milestones', () => {
      expect(EVENT_TYPE_COLORS.rating_milestone).toBe('#16A34A');
      expect(EVENT_TYPE_COLORS.user_milestone).toBe('#16A34A');
    });

    it('should use orange for title and description changes', () => {
      expect(EVENT_TYPE_COLORS.title_change).toBe('#D97706');
      expect(EVENT_TYPE_COLORS.description_change).toBe('#D97706');
    });

    it('should use gray for screenshot, translation, and badge changes', () => {
      expect(EVENT_TYPE_COLORS.screenshot_change).toBe('#6B7280');
      expect(EVENT_TYPE_COLORS.translation_change).toBe('#6B7280');
      expect(EVENT_TYPE_COLORS.badge_change).toBe('#6B7280');
    });
  });

  describe('EVENT_TYPE_LABELS', () => {
    it('should define a human-readable label for every event type', () => {
      for (const type of ALL_EVENT_TYPES) {
        expect(EVENT_TYPE_LABELS[type]).toBeDefined();
        expect(typeof EVENT_TYPE_LABELS[type]).toBe('string');
        expect(EVENT_TYPE_LABELS[type].length).toBeGreaterThan(0);
      }
    });

    it('should have correct labels', () => {
      expect(EVENT_TYPE_LABELS.permission_change).toBe('Permission Change');
      expect(EVENT_TYPE_LABELS.version_change).toBe('Version Change');
      expect(EVENT_TYPE_LABELS.title_change).toBe('Title Change');
    });
  });

  describe('ALL_EVENT_TYPES', () => {
    it('should contain all 9 event types', () => {
      expect(ALL_EVENT_TYPES).toHaveLength(9);
    });

    it('should include every type that has a color', () => {
      for (const type of ALL_EVENT_TYPES) {
        expect(EVENT_TYPE_COLORS[type]).toBeDefined();
        expect(EVENT_TYPE_LABELS[type]).toBeDefined();
      }
    });

    it('should have no duplicates', () => {
      const unique = new Set(ALL_EVENT_TYPES);
      expect(unique.size).toBe(ALL_EVENT_TYPES.length);
    });
  });

  describe('getEventTypeBadgeClass', () => {
    it('should return red badge classes for permission_change', () => {
      expect(getEventTypeBadgeClass('permission_change')).toBe('bg-red-100 text-red-800');
    });

    it('should return blue badge classes for version_change', () => {
      expect(getEventTypeBadgeClass('version_change')).toBe('bg-blue-100 text-blue-800');
    });

    it('should return green badge classes for milestones', () => {
      expect(getEventTypeBadgeClass('rating_milestone')).toBe('bg-green-100 text-green-800');
      expect(getEventTypeBadgeClass('user_milestone')).toBe('bg-green-100 text-green-800');
    });

    it('should return amber badge classes for title and description changes', () => {
      expect(getEventTypeBadgeClass('title_change')).toBe('bg-amber-100 text-amber-800');
      expect(getEventTypeBadgeClass('description_change')).toBe('bg-amber-100 text-amber-800');
    });

    it('should return gray badge classes for screenshot, translation, and badge changes', () => {
      expect(getEventTypeBadgeClass('screenshot_change')).toBe('bg-gray-100 text-gray-800');
      expect(getEventTypeBadgeClass('translation_change')).toBe('bg-gray-100 text-gray-800');
      expect(getEventTypeBadgeClass('badge_change')).toBe('bg-gray-100 text-gray-800');
    });

    it('should return a badge class for every event type', () => {
      for (const type of ALL_EVENT_TYPES) {
        const result = getEventTypeBadgeClass(type);
        expect(result).toContain('bg-');
        expect(result).toContain('text-');
      }
    });
  });
});
