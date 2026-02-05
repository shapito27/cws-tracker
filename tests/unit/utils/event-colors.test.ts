/**
 * Tests for event color scheme and constants.
 */
import { describe, it, expect } from 'vitest';
import {
  EVENT_TYPE_COLORS,
  EVENT_TYPE_LABELS,
  ALL_EVENT_TYPES,
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
});
