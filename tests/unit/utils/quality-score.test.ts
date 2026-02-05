/**
 * Tests for listing quality score calculator (Phase 2.1).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  calculateQualityScore,
  scoreTitle,
  scoreShortDescription,
  scoreFullDescription,
  scoreVisualAssets,
  scoreRatingsReviews,
  scoreTranslations,
  scoreUpdateFreshness,
  scorePermissions,
  scoreDeveloperProfile,
  DEFAULT_THRESHOLDS,
  COMPONENT_WEIGHTS,
} from '../../../src/shared/utils/quality-score';
import type {
  QualityThresholds,
  QualityScoreResult,
  ComponentName,
} from '../../../src/shared/utils/quality-score';
import type { ListingSnapshot } from '../../../src/shared/types/index';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Create a ListingSnapshot with reasonable defaults, overridable per field. */
function makeSnapshot(overrides: Partial<ListingSnapshot> = {}): ListingSnapshot {
  return {
    extensionId: 'abcdefghijklmnopabcdefghijklmnop',
    date: '2026-02-05',
    title: 'My Extension - Great Productivity Tool',
    shortDescription: 'A powerful productivity tool that helps you save time and stay organized throughout your workday. Install now.',
    fullDescription: 'My Extension is a powerful productivity tool.\n\nIt helps you manage tasks, organize bookmarks, and track your time efficiently.\n\nFeatures:\n- Task management\n- Bookmark organizer\n- Time tracker\n- Dashboard analytics\n\nGet started today and boost your productivity!',
    rating: 4.5,
    ratingCount: 150,
    reviewCount: 150,
    userCount: '50,000+',
    userCountNumeric: 50000,
    version: '2.1.0',
    lastUpdated: '2026-01-20',
    size: '1.2MiB',
    permissions: ['storage', 'alarms'],
    hostPermissions: [],
    permissionRiskScore: 0,
    badgeFlags: { featured: true },
    screenshotCount: 5,
    hasPromoVideo: true,
    translationCount: 25,
    availableLocales: [
      'en', 'es', 'fr', 'de', 'ja', 'zh_CN', 'zh_TW', 'ko', 'ru',
      'ar', 'hi', 'it', 'nl', 'pl', 'tr', 'pt_BR', 'sv', 'da',
      'fi', 'nb', 'cs', 'el', 'hu', 'ro', 'th',
    ],
    category: 'Productivity',
    developerName: 'Great Dev Inc.',
    developerVerified: true,
    listingQualityScore: null,
    scannedAt: new Date('2026-02-05T12:00:00Z'),
    ...overrides,
  };
}

/** Create a snapshot with all zeros/nulls/empty for "empty listing" tests. */
function makeEmptySnapshot(): ListingSnapshot {
  return {
    extensionId: 'abcdefghijklmnopabcdefghijklmnop',
    date: '2026-02-05',
    title: '',
    shortDescription: '',
    fullDescription: '',
    rating: null,
    ratingCount: 0,
    reviewCount: 0,
    userCount: '0',
    userCountNumeric: 0,
    version: '0.0.1',
    lastUpdated: '',
    size: '0.1MiB',
    permissions: [],
    hostPermissions: [],
    permissionRiskScore: 0,
    badgeFlags: {},
    screenshotCount: 0,
    hasPromoVideo: false,
    translationCount: 0,
    availableLocales: [],
    category: '',
    developerName: '',
    developerVerified: false,
    listingQualityScore: null,
    scannedAt: new Date('2026-02-05T12:00:00Z'),
  };
}

// ---------------------------------------------------------------------------
// Component weights
// ---------------------------------------------------------------------------

describe('COMPONENT_WEIGHTS', () => {
  it('sum to 1.0 (100%)', () => {
    const sum = Object.values(COMPONENT_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 10);
  });
});

// ---------------------------------------------------------------------------
// scoreTitle
// ---------------------------------------------------------------------------

describe('scoreTitle()', () => {
  const t = DEFAULT_THRESHOLDS;

  it('returns 0 for empty title', () => {
    expect(scoreTitle('', t)).toBe(0);
  });

  it('returns 20 for very short title (< minLength)', () => {
    expect(scoreTitle('Hi', t)).toBe(20);
  });

  it('returns 100 for title in optimal range (20-60 chars)', () => {
    const title = 'My Great Extension Tool'; // 23 chars
    expect(scoreTitle(title, t)).toBe(100);
  });

  it('returns 100 at boundary of optimal range (20 chars)', () => {
    const title = '12345678901234567890'; // exactly 20
    expect(scoreTitle(title, t)).toBe(100);
  });

  it('returns 100 at boundary of optimal range (60 chars)', () => {
    const title = 'A'.repeat(60);
    expect(scoreTitle(title, t)).toBe(100);
  });

  it('returns 30 for overly long title (> maxLength)', () => {
    const title = 'A'.repeat(80);
    expect(scoreTitle(title, t)).toBe(30);
  });

  it('scales between minLength and optimalMin', () => {
    const title = 'A'.repeat(15); // Between 10 and 20
    const score = scoreTitle(title, t);
    expect(score).toBeGreaterThan(20);
    expect(score).toBeLessThan(100);
  });

  it('scales between optimalMax and maxLength', () => {
    const title = 'A'.repeat(65); // Between 60 and 70
    const score = scoreTitle(title, t);
    expect(score).toBeGreaterThan(30);
    expect(score).toBeLessThan(100);
  });
});

// ---------------------------------------------------------------------------
// scoreShortDescription
// ---------------------------------------------------------------------------

describe('scoreShortDescription()', () => {
  const t = DEFAULT_THRESHOLDS;

  it('returns 0 for empty description', () => {
    expect(scoreShortDescription('', t)).toBe(0);
  });

  it('returns low score for very short description', () => {
    const desc = 'A simple tool.'; // ~14 chars
    const score = scoreShortDescription(desc, t);
    expect(score).toBeLessThan(50);
    expect(score).toBeGreaterThan(0);
  });

  it('returns 100 for description at optimal length (80+ chars)', () => {
    const desc = 'A powerful productivity tool that helps you save time and stay organized. Install now free!';
    expect(desc.length).toBeGreaterThanOrEqual(80);
    expect(scoreShortDescription(desc, t)).toBe(100);
  });

  it('returns 100 for max-length description (132 chars)', () => {
    const desc = 'A'.repeat(132);
    expect(scoreShortDescription(desc, t)).toBe(100);
  });

  it('scales between minLength and optimalMin', () => {
    const desc = 'A'.repeat(60); // Between 40 and 80
    const score = scoreShortDescription(desc, t);
    expect(score).toBeGreaterThan(50);
    expect(score).toBeLessThan(100);
  });
});

// ---------------------------------------------------------------------------
// scoreFullDescription
// ---------------------------------------------------------------------------

describe('scoreFullDescription()', () => {
  const t = DEFAULT_THRESHOLDS;

  it('returns 0 for empty description', () => {
    expect(scoreFullDescription('', t)).toBe(0);
  });

  it('returns low score for very thin description (< minWords)', () => {
    const desc = 'This is a short description with only a few words.';
    const score = scoreFullDescription(desc, t);
    expect(score).toBeLessThan(30);
  });

  it('returns high score for well-structured description in optimal range', () => {
    const desc = [
      'My Extension is a powerful productivity tool that helps users manage their daily work with ease and efficiency.',
      'Whether you are a freelancer, a remote worker, or part of a large enterprise team, this tool is designed for you.',
      '',
      'It provides a comprehensive set of features designed for modern professionals who want to stay ahead:',
      '',
      '- Task management with priorities, deadlines, and recurring tasks for all your projects',
      '- Bookmark organization with folders, tags, and smart categories to keep everything tidy',
      '- Time tracking with detailed reports, charts, and exportable data for your records',
      '- Dashboard with analytics, insights, and customizable widgets for your workflow',
      '- Integration with popular tools like Google Calendar, Slack, Trello, and Notion',
      '',
      'Getting started is easy. Simply install the extension and you will see the icon in your browser toolbar.',
      'Click it to open the popup and begin organizing your work immediately. No account required to get started.',
      '',
      'Our users love the clean interface and powerful features that help them stay productive every single day.',
      'Join thousands of professionals around the world who trust our extension to manage their workflow.',
      'We are constantly improving and adding new features based on user feedback and industry best practices.',
    ].join('\n');

    const words = desc.trim().split(/\s+/).filter(w => w.length > 0);
    expect(words.length).toBeGreaterThanOrEqual(t.fullDescription.optimalMinWords);

    const score = scoreFullDescription(desc, t);
    expect(score).toBeGreaterThan(70);
  });

  it('penalizes descriptions over maxWords', () => {
    const desc = Array(1600).fill('word').join(' ');
    const score = scoreFullDescription(desc, t);
    // Should be lower than optimal but not zero
    expect(score).toBeLessThan(50);
    expect(score).toBeGreaterThan(0);
  });

  it('gives bonus for structured content (paragraphs, bullets)', () => {
    // Same word count, different structure
    const unstructured = Array(200).fill('word').join(' ');
    const structured = [
      Array(60).fill('word').join(' '),
      '',
      Array(60).fill('word').join(' '),
      '',
      '- ' + Array(20).fill('word').join(' '),
      '- ' + Array(20).fill('word').join(' '),
      '- ' + Array(20).fill('word').join(' '),
      '',
      Array(20).fill('word').join(' '),
    ].join('\n');

    const unstructuredScore = scoreFullDescription(unstructured, t);
    const structuredScore = scoreFullDescription(structured, t);
    expect(structuredScore).toBeGreaterThan(unstructuredScore);
  });
});

// ---------------------------------------------------------------------------
// scoreVisualAssets
// ---------------------------------------------------------------------------

describe('scoreVisualAssets()', () => {
  const t = DEFAULT_THRESHOLDS;

  it('returns 0 for no screenshots and no video', () => {
    expect(scoreVisualAssets(0, false, t)).toBe(0);
  });

  it('returns high score for optimal screenshots + video', () => {
    expect(scoreVisualAssets(5, true, t)).toBe(100);
  });

  it('returns high score for optimal screenshots without video', () => {
    const score = scoreVisualAssets(5, false, t);
    expect(score).toBe(80); // 100 * 0.8 + 0 * 0.2
  });

  it('scores partial screenshots', () => {
    const score = scoreVisualAssets(1, false, t);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(80);
  });

  it('handles more than optimalMax screenshots', () => {
    const score = scoreVisualAssets(10, false, t);
    expect(score).toBe(80); // 100 * 0.8 + 0 * 0.2
  });

  it('adds video bonus on top of screenshot score', () => {
    const withoutVideo = scoreVisualAssets(3, false, t);
    const withVideo = scoreVisualAssets(3, true, t);
    expect(withVideo).toBeGreaterThan(withoutVideo);
  });
});

// ---------------------------------------------------------------------------
// scoreRatingsReviews
// ---------------------------------------------------------------------------

describe('scoreRatingsReviews()', () => {
  const t = DEFAULT_THRESHOLDS;

  it('returns 0 for null rating and 0 reviews', () => {
    expect(scoreRatingsReviews(null, 0, t)).toBe(0);
  });

  it('returns high score for excellent rating and many reviews', () => {
    const score = scoreRatingsReviews(4.8, 200, t);
    expect(score).toBeGreaterThan(90);
  });

  it('scores rating 4.0 with 50 reviews as good', () => {
    const score = scoreRatingsReviews(4.0, 50, t);
    expect(score).toBeGreaterThanOrEqual(50);
    expect(score).toBeLessThan(90);
  });

  it('handles rating below fair threshold', () => {
    const score = scoreRatingsReviews(2.0, 5, t);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(40);
  });

  it('handles null rating with some reviews', () => {
    // Null rating = 0 for rating component, but reviews still count
    const score = scoreRatingsReviews(null, 100, t);
    expect(score).toBeGreaterThan(0);
    // Should be 0 * 0.6 + reviewScore * 0.4
    expect(score).toBe(Math.round(0 * 0.6 + 100 * 0.4));
  });

  it('handles good rating with 0 reviews', () => {
    const score = scoreRatingsReviews(4.5, 0, t);
    // Rating of 4.5 = 100, reviews = 0
    expect(score).toBe(Math.round(100 * 0.6 + 0 * 0.4));
  });

  it('scales review score between tiers', () => {
    const scoreLow = scoreRatingsReviews(4.0, 15, t);
    const scoreMid = scoreRatingsReviews(4.0, 50, t);
    const scoreHigh = scoreRatingsReviews(4.0, 100, t);
    expect(scoreLow).toBeLessThan(scoreMid);
    expect(scoreMid).toBeLessThan(scoreHigh);
  });
});

// ---------------------------------------------------------------------------
// scoreTranslations
// ---------------------------------------------------------------------------

describe('scoreTranslations()', () => {
  const t = DEFAULT_THRESHOLDS;

  it('returns 0 for single locale (English only)', () => {
    expect(scoreTranslations(1, ['en'], t)).toBe(0);
  });

  it('returns 0 for zero locales', () => {
    expect(scoreTranslations(0, [], t)).toBe(0);
  });

  it('returns high score for 20+ locales with major markets', () => {
    const locales = [
      'en', 'es', 'fr', 'de', 'ja', 'zh_CN', 'zh_TW', 'ko', 'ru',
      'ar', 'hi', 'it', 'nl', 'pl', 'tr', 'pt_BR', 'sv', 'da', 'fi', 'nb',
    ];
    const score = scoreTranslations(locales.length, locales, t);
    expect(score).toBeGreaterThan(90);
  });

  it('scores partial locale coverage', () => {
    const score = scoreTranslations(5, ['en', 'es', 'fr', 'de', 'ja'], t);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(90);
  });

  it('penalizes missing major market locales', () => {
    // 20 locales but not major markets
    const obscureLocales = Array.from({ length: 20 }, (_, i) => `xx_${i}`);
    const majorLocales = [
      'en', 'es', 'fr', 'de', 'ja', 'zh_CN', 'zh_TW', 'ko', 'ru',
      'ar', 'hi', 'it', 'nl', 'pl', 'tr', 'pt_BR', 'sv', 'da', 'fi', 'nb',
    ];

    const scoreObscure = scoreTranslations(20, obscureLocales, t);
    const scoreMajor = scoreTranslations(20, majorLocales, t);
    expect(scoreMajor).toBeGreaterThan(scoreObscure);
  });
});

// ---------------------------------------------------------------------------
// scoreUpdateFreshness
// ---------------------------------------------------------------------------

describe('scoreUpdateFreshness()', () => {
  const t = DEFAULT_THRESHOLDS;

  // Use a fixed "today" for deterministic tests
  let dateNowSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(
      new Date('2026-02-05T12:00:00Z').getTime()
    );
    vi.useFakeTimers({ now: new Date('2026-02-05T12:00:00Z') });
  });

  afterEach(() => {
    vi.useRealTimers();
    dateNowSpy.mockRestore();
  });

  it('returns 100 for update within last 30 days', () => {
    expect(scoreUpdateFreshness('2026-01-20', t)).toBe(100);
  });

  it('returns 100 for update today', () => {
    expect(scoreUpdateFreshness('2026-02-05', t)).toBe(100);
  });

  it('returns ~80-100 for update 31-90 days ago', () => {
    expect(scoreUpdateFreshness('2025-12-01', t)).toBeGreaterThanOrEqual(80);
    expect(scoreUpdateFreshness('2025-12-01', t)).toBeLessThanOrEqual(100);
  });

  it('returns ~50-80 for update 91-180 days ago', () => {
    const score = scoreUpdateFreshness('2025-09-01', t);
    expect(score).toBeGreaterThanOrEqual(50);
    expect(score).toBeLessThanOrEqual(80);
  });

  it('returns ~20-50 for update 181-365 days ago', () => {
    const score = scoreUpdateFreshness('2025-05-01', t);
    expect(score).toBeGreaterThanOrEqual(20);
    expect(score).toBeLessThanOrEqual(50);
  });

  it('returns 0 for update over 365 days ago', () => {
    expect(scoreUpdateFreshness('2024-01-01', t)).toBe(0);
  });

  it('returns 0 for unparseable date', () => {
    expect(scoreUpdateFreshness('invalid-date', t)).toBe(0);
  });

  it('returns 0 for empty date', () => {
    expect(scoreUpdateFreshness('', t)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// scorePermissions
// ---------------------------------------------------------------------------

describe('scorePermissions()', () => {
  const t = DEFAULT_THRESHOLDS;

  it('returns 100 for risk score 0', () => {
    expect(scorePermissions(0, t)).toBe(100);
  });

  it('returns 100 for risk score at low threshold', () => {
    expect(scorePermissions(20, t)).toBe(100);
  });

  it('returns 70 for risk score at medium threshold', () => {
    expect(scorePermissions(50, t)).toBe(70);
  });

  it('returns 40 for risk score at high threshold', () => {
    expect(scorePermissions(80, t)).toBe(40);
  });

  it('returns 0 for risk score above high threshold', () => {
    expect(scorePermissions(100, t)).toBe(0);
  });

  it('scales between low and medium', () => {
    const score = scorePermissions(35, t);
    expect(score).toBeGreaterThan(70);
    expect(score).toBeLessThan(100);
  });
});

// ---------------------------------------------------------------------------
// scoreDeveloperProfile
// ---------------------------------------------------------------------------

describe('scoreDeveloperProfile()', () => {
  it('returns 100 for verified developer', () => {
    expect(scoreDeveloperProfile('Great Dev Inc.', true)).toBe(100);
  });

  it('returns 40 for unverified developer with name', () => {
    expect(scoreDeveloperProfile('Some Developer', false)).toBe(40);
  });

  it('returns 0 for empty developer name', () => {
    expect(scoreDeveloperProfile('', false)).toBe(0);
  });

  it('returns 0 for whitespace-only developer name', () => {
    expect(scoreDeveloperProfile('   ', false)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// calculateQualityScore - integration
// ---------------------------------------------------------------------------

describe('calculateQualityScore()', () => {
  let dateNowSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(
      new Date('2026-02-05T12:00:00Z').getTime()
    );
    vi.useFakeTimers({ now: new Date('2026-02-05T12:00:00Z') });
  });

  afterEach(() => {
    vi.useRealTimers();
    dateNowSpy.mockRestore();
  });

  it('scores a perfect listing near 100', () => {
    const snapshot = makeSnapshot();
    const result = calculateQualityScore(snapshot);
    expect(result.totalScore).toBeGreaterThanOrEqual(85);
    expect(result.totalScore).toBeLessThanOrEqual(100);
  });

  it('scores an empty listing near 0', () => {
    const snapshot = makeEmptySnapshot();
    const result = calculateQualityScore(snapshot);
    expect(result.totalScore).toBeLessThanOrEqual(10);
    expect(result.totalScore).toBeGreaterThanOrEqual(0);
  });

  it('returns exactly 9 component scores', () => {
    const result = calculateQualityScore(makeSnapshot());
    expect(result.components).toHaveLength(9);
  });

  it('each component scores 0-100', () => {
    const result = calculateQualityScore(makeSnapshot());
    for (const comp of result.components) {
      expect(comp.score).toBeGreaterThanOrEqual(0);
      expect(comp.score).toBeLessThanOrEqual(100);
    }
  });

  it('total score is weighted average of components', () => {
    const result = calculateQualityScore(makeSnapshot());
    const expected = Math.round(
      result.components.reduce((sum, c) => sum + c.score * c.weight, 0)
    );
    expect(result.totalScore).toBe(expected);
  });

  it('generates recommendations for components scoring < 50', () => {
    // Create a snapshot with weak short description and no screenshots
    const snapshot = makeSnapshot({
      shortDescription: 'Short.',
      screenshotCount: 0,
      hasPromoVideo: false,
    });
    const result = calculateQualityScore(snapshot);

    const shortDescRec = result.recommendations.filter(r => r.component === 'shortDescription');
    const visualRec = result.recommendations.filter(r => r.component === 'visualAssets');

    expect(shortDescRec.length).toBeGreaterThan(0);
    expect(visualRec.length).toBeGreaterThan(0);
  });

  it('generates no recommendations for components scoring > 80', () => {
    const snapshot = makeSnapshot();
    const result = calculateQualityScore(snapshot);

    // With a perfect snapshot, most components should score > 80
    // Check that high-scoring components don't get recommendations
    const highScoringComponents = result.components.filter(c => c.score > 80);
    for (const comp of highScoringComponents) {
      const recs = result.recommendations.filter(r => r.component === comp.name);
      expect(recs).toHaveLength(0);
    }
  });

  it('handles null rating without crashing', () => {
    const snapshot = makeSnapshot({ rating: null, ratingCount: 0, reviewCount: 0 });
    const result = calculateQualityScore(snapshot);
    expect(result.totalScore).toBeGreaterThanOrEqual(0);
    expect(result.totalScore).toBeLessThanOrEqual(100);

    const ratingComp = result.components.find(c => c.name === 'ratingsReviews');
    expect(ratingComp).toBeDefined();
    expect(ratingComp!.score).toBe(0);
  });

  it('handles unparseable lastUpdated without crashing', () => {
    const snapshot = makeSnapshot({ lastUpdated: 'not-a-date' });
    const result = calculateQualityScore(snapshot);
    expect(result.totalScore).toBeGreaterThanOrEqual(0);
    expect(result.totalScore).toBeLessThanOrEqual(100);

    const freshnessComp = result.components.find(c => c.name === 'updateFreshness');
    expect(freshnessComp).toBeDefined();
    expect(freshnessComp!.score).toBe(0);
  });

  it('totalScore is clamped to [0, 100]', () => {
    const result = calculateQualityScore(makeSnapshot());
    expect(result.totalScore).toBeGreaterThanOrEqual(0);
    expect(result.totalScore).toBeLessThanOrEqual(100);
  });

  it('works with custom thresholds', () => {
    const customThresholds: QualityThresholds = {
      ...DEFAULT_THRESHOLDS,
      title: {
        minLength: 5,
        optimalMin: 10,
        optimalMax: 80,
        maxLength: 100,
      },
    };
    const snapshot = makeSnapshot({ title: 'AB' }); // 2 chars, below custom minLength of 5
    const result = calculateQualityScore(snapshot, customThresholds);
    const titleComp = result.components.find(c => c.name === 'title');
    expect(titleComp!.score).toBe(20); // below minLength
  });

  it('recommendations have correct priority based on score', () => {
    const snapshot = makeSnapshot({
      title: '',
      shortDescription: 'A short.',
      screenshotCount: 0,
      hasPromoVideo: false,
    });
    const result = calculateQualityScore(snapshot);

    // Title is empty (score 0) -> high priority
    const titleRecs = result.recommendations.filter(r => r.component === 'title');
    if (titleRecs.length > 0) {
      expect(titleRecs[0].priority).toBe('high');
    }
  });

  it('recommendation messages mention actionable details', () => {
    const snapshot = makeSnapshot({
      screenshotCount: 1,
      hasPromoVideo: false,
    });
    const result = calculateQualityScore(snapshot);
    const visualRecs = result.recommendations.filter(r => r.component === 'visualAssets');

    // Should mention how many more screenshots to add
    if (visualRecs.length > 0) {
      const addScreenshotRec = visualRecs.find(r => r.message.includes('more screenshot'));
      expect(addScreenshotRec).toBeDefined();
    }
  });

  it('generates translation recommendations for low locale count', () => {
    const snapshot = makeSnapshot({
      translationCount: 1,
      availableLocales: ['en'],
    });
    const result = calculateQualityScore(snapshot);
    const transRecs = result.recommendations.filter(r => r.component === 'translations');
    expect(transRecs.length).toBeGreaterThan(0);
  });

  it('generates developer profile recommendation for unverified developer', () => {
    const snapshot = makeSnapshot({
      developerVerified: false,
    });
    const result = calculateQualityScore(snapshot);
    const devRecs = result.recommendations.filter(r => r.component === 'developerProfile');
    expect(devRecs.length).toBeGreaterThan(0);
    expect(devRecs[0].message).toContain('Verify');
  });

  it('generates permission recommendation for high-risk permissions', () => {
    const snapshot = makeSnapshot({
      permissionRiskScore: 70,
    });
    const result = calculateQualityScore(snapshot);
    const permRecs = result.recommendations.filter(r => r.component === 'permissions');
    expect(permRecs.length).toBeGreaterThan(0);
  });

  it('generates update freshness recommendation for stale extension', () => {
    const snapshot = makeSnapshot({
      lastUpdated: '2025-06-01',
    });
    const result = calculateQualityScore(snapshot);
    const freshRecs = result.recommendations.filter(r => r.component === 'updateFreshness');
    expect(freshRecs.length).toBeGreaterThan(0);
    expect(freshRecs[0].message).toContain('days ago');
  });
});
