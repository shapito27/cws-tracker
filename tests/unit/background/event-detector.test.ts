/**
 * Tests for Event Detection (Phase 1.6.3).
 */

import { describe, it, expect } from 'vitest';
import { detectChanges } from '@/background/event-detector';
import type { ListingSnapshot } from '@/shared/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSnapshot(overrides: Partial<ListingSnapshot> = {}): ListingSnapshot {
  return {
    extensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    date: '2026-02-05',
    title: 'My Extension',
    shortDescription: 'A great extension',
    fullDescription: 'This is a full description of the extension.',
    rating: 4.2,
    ratingCount: 150,
    reviewCount: 150,
    userCount: '10,000+',
    userCountNumeric: 10_000,
    version: '1.0.0',
    lastUpdated: '2026-01-15',
    size: '1.5MiB',
    permissions: ['storage', 'alarms'],
    hostPermissions: [],
    permissionRiskScore: 0,
    badgeFlags: {},
    screenshotCount: 3,
    hasPromoVideo: false,
    translationCount: 5,
    availableLocales: ['en', 'es', 'fr', 'de', 'ja'],
    category: 'productivity/tools',
    developerName: 'Test Developer',
    developerEmail: null,
    developerVerified: false,
    listingQualityScore: null,
    scannedAt: new Date('2026-02-05T10:00:00Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('detectChanges', () => {
  it('no previous snapshot (first scan) → empty array', () => {
    const current = makeSnapshot();
    const events = detectChanges(null, current);
    expect(events).toEqual([]);
  });

  it('identical snapshots → empty array', () => {
    const previous = makeSnapshot();
    const current = makeSnapshot();
    const events = detectChanges(previous, current);
    expect(events).toEqual([]);
  });

  it('title changed → 1 title_change event', () => {
    const previous = makeSnapshot({ title: 'Old Title' });
    const current = makeSnapshot({ title: 'New Title' });
    const events = detectChanges(previous, current);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('title_change');
    expect(events[0].field).toBe('title');
    expect(events[0].oldValue).toBe('Old Title');
    expect(events[0].newValue).toBe('New Title');
    expect(events[0].note).toContain('Old Title');
    expect(events[0].note).toContain('New Title');
  });

  it('multiple changes simultaneously → multiple events', () => {
    const previous = makeSnapshot({
      title: 'Old Title',
      version: '1.0.0',
    });
    const current = makeSnapshot({
      title: 'New Title',
      version: '2.0.0',
    });
    const events = detectChanges(previous, current);

    expect(events).toHaveLength(2);
    const types = events.map((e) => e.type);
    expect(types).toContain('title_change');
    expect(types).toContain('version_change');
  });

  it('permission added → event contains added permission', () => {
    const previous = makeSnapshot({ permissions: ['storage'] });
    const current = makeSnapshot({ permissions: ['storage', 'tabs'] });
    const events = detectChanges(previous, current);

    const permEvent = events.find((e) => e.field === 'permissions');
    expect(permEvent).toBeDefined();
    expect(permEvent!.type).toBe('permission_change');
    expect(permEvent!.note).toContain('tabs');
    expect(permEvent!.note).toContain('added');
  });

  it('permission removed → event contains removed permission', () => {
    const previous = makeSnapshot({ permissions: ['storage', 'tabs'] });
    const current = makeSnapshot({ permissions: ['storage'] });
    const events = detectChanges(previous, current);

    const permEvent = events.find((e) => e.field === 'permissions');
    expect(permEvent).toBeDefined();
    expect(permEvent!.note).toContain('tabs');
    expect(permEvent!.note).toContain('removed');
  });

  it('permissions reordered but same set → no event', () => {
    const previous = makeSnapshot({ permissions: ['tabs', 'storage', 'alarms'] });
    const current = makeSnapshot({ permissions: ['alarms', 'tabs', 'storage'] });
    const events = detectChanges(previous, current);

    const permEvents = events.filter((e) => e.field === 'permissions');
    expect(permEvents).toHaveLength(0);
  });

  it('rating 3.9 → 4.0 → triggers rating_milestone', () => {
    const previous = makeSnapshot({ rating: 3.9 });
    const current = makeSnapshot({ rating: 4.0 });
    const events = detectChanges(previous, current);

    const ratingEvent = events.find((e) => e.type === 'rating_milestone');
    expect(ratingEvent).toBeDefined();
    expect(ratingEvent!.note).toContain('4');
  });

  it('rating 4.0 → 4.1 → no milestone (same floor)', () => {
    const previous = makeSnapshot({ rating: 4.0 });
    const current = makeSnapshot({ rating: 4.1 });
    const events = detectChanges(previous, current);

    const ratingEvents = events.filter((e) => e.type === 'rating_milestone');
    expect(ratingEvents).toHaveLength(0);
  });

  it('rating 4.0 → null → handled gracefully (no crash)', () => {
    const previous = makeSnapshot({ rating: 4.0 });
    const current = makeSnapshot({ rating: null });
    const events = detectChanges(previous, current);

    // No rating milestone event (null rating)
    const ratingEvents = events.filter((e) => e.type === 'rating_milestone');
    expect(ratingEvents).toHaveLength(0);
  });

  it('users 9500 → 10000 → triggers user_milestone at 10K', () => {
    const previous = makeSnapshot({ userCountNumeric: 9500 });
    const current = makeSnapshot({ userCountNumeric: 10_000 });
    const events = detectChanges(previous, current);

    const milestoneEvent = events.find((e) => e.type === 'user_milestone');
    expect(milestoneEvent).toBeDefined();
    expect(milestoneEvent!.note).toContain('10K');
  });

  it('users 10000 → 10500 → no milestone', () => {
    const previous = makeSnapshot({ userCountNumeric: 10_000 });
    const current = makeSnapshot({ userCountNumeric: 10_500 });
    const events = detectChanges(previous, current);

    const milestoneEvents = events.filter((e) => e.type === 'user_milestone');
    expect(milestoneEvents).toHaveLength(0);
  });

  it('users 900 → 1000 → triggers user_milestone at 1K', () => {
    const previous = makeSnapshot({ userCountNumeric: 900 });
    const current = makeSnapshot({ userCountNumeric: 1000 });
    const events = detectChanges(previous, current);

    const milestoneEvent = events.find((e) => e.type === 'user_milestone');
    expect(milestoneEvent).toBeDefined();
    expect(milestoneEvent!.note).toContain('1K');
  });

  it('badge added → triggers badge_change', () => {
    const previous = makeSnapshot({ badgeFlags: {} });
    const current = makeSnapshot({ badgeFlags: { featured: true } });
    const events = detectChanges(previous, current);

    const badgeEvent = events.find((e) => e.type === 'badge_change');
    expect(badgeEvent).toBeDefined();
    expect(badgeEvent!.note).toContain('featured');
    expect(badgeEvent!.note).toContain('gained');
  });

  it('whitespace-only description change → no event', () => {
    const previous = makeSnapshot({ fullDescription: 'Hello  world\n\ntest' });
    const current = makeSnapshot({ fullDescription: 'Hello world\ntest' });
    const events = detectChanges(previous, current);

    const descEvents = events.filter(
      (e) => e.type === 'description_change' && e.field === 'fullDescription'
    );
    expect(descEvents).toHaveLength(0);
  });

  it('version change generates human-readable note', () => {
    const previous = makeSnapshot({ version: '1.0.0' });
    const current = makeSnapshot({ version: '2.0.0' });
    const events = detectChanges(previous, current);

    const versionEvent = events.find((e) => e.type === 'version_change');
    expect(versionEvent!.note).toBe("Version changed from '1.0.0' to '2.0.0'");
  });

  it('translation count change generates event', () => {
    const previous = makeSnapshot({ translationCount: 5 });
    const current = makeSnapshot({ translationCount: 8 });
    const events = detectChanges(previous, current);

    const translationEvent = events.find((e) => e.type === 'translation_change');
    expect(translationEvent).toBeDefined();
    expect(translationEvent!.note).toContain('5');
    expect(translationEvent!.note).toContain('8');
  });

  it('screenshot count change generates event', () => {
    const previous = makeSnapshot({ screenshotCount: 3 });
    const current = makeSnapshot({ screenshotCount: 5 });
    const events = detectChanges(previous, current);

    const screenshotEvent = events.find((e) => e.type === 'screenshot_change');
    expect(screenshotEvent).toBeDefined();
    expect(screenshotEvent!.note).toContain('3');
    expect(screenshotEvent!.note).toContain('5');
  });

  it('size change generates size_change event', () => {
    const previous = makeSnapshot({ size: '1.5MiB' });
    const current = makeSnapshot({ size: '2.1MiB' });
    const events = detectChanges(previous, current);

    const sizeEvent = events.find((e) => e.type === 'size_change');
    expect(sizeEvent).toBeDefined();
    expect(sizeEvent!.field).toBe('size');
    expect(sizeEvent!.oldValue).toBe('1.5MiB');
    expect(sizeEvent!.newValue).toBe('2.1MiB');
    expect(sizeEvent!.note).toContain('1.5MiB');
    expect(sizeEvent!.note).toContain('2.1MiB');
  });

  it('identical size → no size_change event', () => {
    const previous = makeSnapshot({ size: '1.5MiB' });
    const current = makeSnapshot({ size: '1.5MiB' });
    const events = detectChanges(previous, current);

    expect(events.find((e) => e.type === 'size_change')).toBeUndefined();
  });

  it('first scan with size set → no size_change event', () => {
    const current = makeSnapshot({ size: '1.5MiB' });
    const events = detectChanges(null, current);

    expect(events.find((e) => e.type === 'size_change')).toBeUndefined();
  });

  it('empty previous size → no spurious size_change (data-availability churn)', () => {
    // Parser falls back to '' when CWS does not return a string for the size
    // slot. The next scan with a real size must not produce a phantom event.
    const previous = makeSnapshot({ size: '' });
    const current = makeSnapshot({ size: '1.5MiB' });
    const events = detectChanges(previous, current);

    expect(events.find((e) => e.type === 'size_change')).toBeUndefined();
  });

  it('size disappears in current scan → no spurious size_change', () => {
    const previous = makeSnapshot({ size: '1.5MiB' });
    const current = makeSnapshot({ size: '' });
    const events = detectChanges(previous, current);

    expect(events.find((e) => e.type === 'size_change')).toBeUndefined();
  });

  it('massive user jump crosses multiple milestones', () => {
    const previous = makeSnapshot({ userCountNumeric: 500 });
    const current = makeSnapshot({ userCountNumeric: 100_000 });
    const events = detectChanges(previous, current);

    const milestoneEvents = events.filter((e) => e.type === 'user_milestone');
    // Crosses 1K, 5K, 10K, 50K, 100K
    expect(milestoneEvents).toHaveLength(5);
  });

  it('user count decrease → no milestone events', () => {
    const previous = makeSnapshot({ userCountNumeric: 50_000 });
    const current = makeSnapshot({ userCountNumeric: 10_000 });
    const events = detectChanges(previous, current);

    const milestoneEvents = events.filter((e) => e.type === 'user_milestone');
    expect(milestoneEvents).toHaveLength(0);
  });

  it('badge removed → triggers badge_change with "lost"', () => {
    const previous = makeSnapshot({ badgeFlags: { featured: true } });
    const current = makeSnapshot({ badgeFlags: {} });
    const events = detectChanges(previous, current);

    const badgeEvent = events.find((e) => e.type === 'badge_change');
    expect(badgeEvent).toBeDefined();
    expect(badgeEvent!.note).toContain('lost');
    expect(badgeEvent!.note).toContain('featured');
  });

  it('host permission change detected separately from permissions', () => {
    const previous = makeSnapshot({
      permissions: ['storage'],
      hostPermissions: ['https://example.com/*'],
    });
    const current = makeSnapshot({
      permissions: ['storage'],
      hostPermissions: ['https://example.com/*', 'https://other.com/*'],
    });
    const events = detectChanges(previous, current);

    const hostPermEvent = events.find((e) => e.field === 'hostPermissions');
    expect(hostPermEvent).toBeDefined();
    expect(hostPermEvent!.type).toBe('permission_change');
    expect(hostPermEvent!.note).toContain('other.com');
  });

  it('all events have correct extensionId and date', () => {
    const previous = makeSnapshot({
      title: 'Old',
      version: '1.0',
      screenshotCount: 1,
    });
    const current = makeSnapshot({
      title: 'New',
      version: '2.0',
      screenshotCount: 5,
    });
    const events = detectChanges(previous, current);

    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.extensionId).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      expect(event.date).toBe('2026-02-05');
    }
  });
});
