/**
 * Tests for keyword audit - "Why Is Competitor Higher?" (Phase 3.2).
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { resetChromeMock } from '../../mocks/chrome';
import {
  buildAuditPrompt,
  buildPlaceholderValues,
  estimateAuditTokens,
  parseAuditResponse,
  buildCacheKey,
  runKeywordAudit,
  formatRankHistory,
  formatAutocompleteHistory,
  formatEventsHistory,
  type AuditInput,
  type AuditHistoricalContext,
} from '../../../src/shared/utils/keyword-audit';
import { OpenAIClient } from '../../../src/shared/utils/openai';
import { CWSDatabase } from '../../../src/shared/db/database';
import type { ListingSnapshot, RankSnapshot, AutocompleteSnapshot, EventRecord } from '../../../src/shared/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeListing(overrides: Partial<ListingSnapshot> = {}): ListingSnapshot {
  return {
    extensionId: 'ext-own-id-12345678901234567890',
    date: '2026-02-05',
    title: 'My Extension',
    shortDescription: 'A great extension for productivity',
    fullDescription: 'This extension helps you be more productive by automating tasks and providing insights into your workflow. It offers many features including task management, time tracking, and more.',
    rating: 4.2,
    ratingCount: 150,
    reviewCount: 150,
    userCount: '50,000+',
    userCountNumeric: 50000,
    version: '1.5.0',
    lastUpdated: '2026-01-15',
    size: '2.5MiB',
    permissions: ['storage', 'tabs'],
    hostPermissions: [],
    permissionRiskScore: 20,
    badgeFlags: {},
    screenshotCount: 3,
    hasPromoVideo: false,
    translationCount: 5,
    availableLocales: ['en', 'es', 'fr', 'de', 'ja'],
    category: 'Productivity',
    developerName: 'Dev Inc',
    developerVerified: false,
    listingQualityScore: 72,
    scannedAt: new Date(),
    ...overrides,
  };
}

function makeCompetitorListing(): ListingSnapshot {
  return makeListing({
    extensionId: 'ext-comp-id-12345678901234567890',
    title: 'Super Productivity Pro',
    shortDescription: 'The best productivity extension with AI-powered features',
    fullDescription: 'Super Productivity Pro is the leading productivity extension. With AI-powered task management, intelligent time tracking, and deep workflow analysis, it helps millions of users worldwide.',
    rating: 4.7,
    ratingCount: 2500,
    reviewCount: 2500,
    userCount: '1,000,000+',
    userCountNumeric: 1000000,
    version: '3.2.1',
    lastUpdated: '2026-02-01',
    screenshotCount: 5,
    translationCount: 20,
    availableLocales: Array.from({ length: 20 }, (_, i) => `locale${i}`),
    listingQualityScore: 91,
    permissionRiskScore: 15,
  });
}

const SAMPLE_INPUT: AuditInput = {
  keyword: 'productivity extension',
  ownListing: makeListing(),
  competitorListing: makeCompetitorListing(),
  ownPosition: 8,
  competitorPosition: 2,
};

const VALID_AI_RESPONSE = JSON.stringify({
  relevanceAnalysis: 'The competitor has stronger keyword presence in the title.',
  metricComparison: 'The competitor has significantly more users and higher ratings.',
  recommendations: [
    { area: 'Title', suggestion: 'Include "productivity" in your title', priority: 'high' },
    { area: 'Description', suggestion: 'Expand description with use cases', priority: 'medium' },
    { area: 'Screenshots', suggestion: 'Add 2 more screenshots', priority: 'low' },
  ],
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildAuditPrompt()', () => {
  it('includes all required data fields', () => {
    const messages = buildAuditPrompt(SAMPLE_INPUT);

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');

    const userContent = messages[1].content;

    // Both listings
    expect(userContent).toContain('My Extension');
    expect(userContent).toContain('Super Productivity Pro');

    // Keyword
    expect(userContent).toContain('productivity extension');

    // Positions
    expect(userContent).toContain('#8');
    expect(userContent).toContain('#2');

    // Metrics
    expect(userContent).toContain('4.2/5');
    expect(userContent).toContain('4.7/5');
    expect(userContent).toContain('150 ratings');
    expect(userContent).toContain('2500 ratings');
    expect(userContent).toContain('50,000+');
    expect(userContent).toContain('1,000,000+');

    // Quality scores
    expect(userContent).toContain('72');
    expect(userContent).toContain('91');
  });

  it('handles null positions', () => {
    const input: AuditInput = {
      ...SAMPLE_INPUT,
      ownPosition: null,
      competitorPosition: null,
    };
    const messages = buildAuditPrompt(input);
    const userContent = messages[1].content;

    expect(userContent).toContain('Not in top 30');
  });

  it('handles null rating', () => {
    const input: AuditInput = {
      ...SAMPLE_INPUT,
      ownListing: makeListing({ rating: null }),
    };
    const messages = buildAuditPrompt(input);
    const userContent = messages[1].content;

    expect(userContent).toContain('No ratings');
  });

  it('handles null quality score', () => {
    const input: AuditInput = {
      ...SAMPLE_INPUT,
      ownListing: makeListing({ listingQualityScore: null }),
    };
    const messages = buildAuditPrompt(input);
    const userContent = messages[1].content;

    expect(userContent).toContain('N/A');
  });

  it('truncates long descriptions to 500 chars', () => {
    const longDesc = 'A'.repeat(1000);
    const input: AuditInput = {
      ...SAMPLE_INPUT,
      ownListing: makeListing({ fullDescription: longDesc }),
    };
    const messages = buildAuditPrompt(input);
    const userContent = messages[1].content;

    // The prompt should contain only first 500 chars, not all 1000
    const matches = userContent.match(/A{500}/g);
    expect(matches).toBeTruthy();
    // Should not have 501+ consecutive A's from the user's listing
    expect(userContent).not.toContain('A'.repeat(501));
  });

  it('system prompt requests JSON format', () => {
    const messages = buildAuditPrompt(SAMPLE_INPUT);
    expect(messages[0].content).toContain('JSON');
    expect(messages[0].content).toContain('relevanceAnalysis');
    expect(messages[0].content).toContain('metricComparison');
    expect(messages[0].content).toContain('recommendations');
  });
});

describe('estimateAuditTokens()', () => {
  it('returns token and cost estimates', () => {
    const estimate = estimateAuditTokens(SAMPLE_INPUT);

    expect(estimate.inputTokens).toBeGreaterThan(0);
    expect(estimate.outputTokens).toBe(600);
    expect(estimate.estimatedCostUsd).toBeGreaterThan(0);
  });

  it('shows token estimate to user before running', () => {
    const estimate = estimateAuditTokens(SAMPLE_INPUT);

    // Verify the estimate is reasonable (system prompt + user data)
    expect(estimate.inputTokens).toBeGreaterThan(100);
    expect(estimate.inputTokens).toBeLessThan(5000);
    expect(estimate.estimatedCostUsd).toBeLessThan(1.0);
  });
});

describe('parseAuditResponse()', () => {
  it('parses valid JSON response', () => {
    const result = parseAuditResponse(VALID_AI_RESPONSE);

    expect(result.relevanceAnalysis).toBe('The competitor has stronger keyword presence in the title.');
    expect(result.metricComparison).toBe('The competitor has significantly more users and higher ratings.');
    expect(result.recommendations).toHaveLength(3);
    expect(result.recommendations[0].area).toBe('Title');
    expect(result.recommendations[0].priority).toBe('high');
  });

  it('handles response wrapped in markdown code fences', () => {
    const wrapped = '```json\n' + VALID_AI_RESPONSE + '\n```';
    const result = parseAuditResponse(wrapped);

    expect(result.relevanceAnalysis).toBe('The competitor has stronger keyword presence in the title.');
    expect(result.recommendations).toHaveLength(3);
  });

  it('handles invalid JSON by returning raw text as relevance analysis', () => {
    const raw = 'This is just plain text analysis without JSON format.';
    const result = parseAuditResponse(raw);

    expect(result.relevanceAnalysis).toBe(raw);
    expect(result.metricComparison).toBe('');
    expect(result.recommendations).toHaveLength(0);
  });

  it('handles empty response', () => {
    const result = parseAuditResponse('');

    expect(result.relevanceAnalysis).toBe('');
    expect(result.metricComparison).toBe('');
    expect(result.recommendations).toHaveLength(0);
  });

  it('handles missing fields in JSON', () => {
    const partial = JSON.stringify({ relevanceAnalysis: 'Analysis here' });
    const result = parseAuditResponse(partial);

    expect(result.relevanceAnalysis).toBe('Analysis here');
    expect(result.metricComparison).toBe('');
    expect(result.recommendations).toHaveLength(0);
  });

  it('defaults invalid priority to medium', () => {
    const withBadPriority = JSON.stringify({
      relevanceAnalysis: 'Test',
      metricComparison: 'Test',
      recommendations: [
        { area: 'Title', suggestion: 'Do X', priority: 'critical' },
      ],
    });
    const result = parseAuditResponse(withBadPriority);

    expect(result.recommendations[0].priority).toBe('medium');
  });

  it('skips recommendations with missing fields', () => {
    const withBadRecs = JSON.stringify({
      relevanceAnalysis: 'Test',
      metricComparison: 'Test',
      recommendations: [
        { area: 'Title', suggestion: 'Do X', priority: 'high' },
        { suggestion: 'No area' },
        { area: 'Desc' },
        null,
      ],
    });
    const result = parseAuditResponse(withBadRecs);

    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0].area).toBe('Title');
  });
});

describe('buildCacheKey()', () => {
  it('generates deterministic key from inputs', () => {
    const key1 = buildCacheKey('keyword', 'ext1', 'ext2', '2026-02-05');
    const key2 = buildCacheKey('keyword', 'ext1', 'ext2', '2026-02-05');

    expect(key1).toBe(key2);
  });

  it('generates different keys for different inputs', () => {
    const key1 = buildCacheKey('keyword1', 'ext1', 'ext2', '2026-02-05');
    const key2 = buildCacheKey('keyword2', 'ext1', 'ext2', '2026-02-05');
    const key3 = buildCacheKey('keyword1', 'ext1', 'ext2', '2026-02-06');

    expect(key1).not.toBe(key2);
    expect(key1).not.toBe(key3);
  });

  it('includes date for daily expiry', () => {
    const key = buildCacheKey('keyword', 'ext1', 'ext2', '2026-02-05');
    expect(key).toContain('2026-02-05');
  });
});

describe('runKeywordAudit()', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls OpenAI and returns structured result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: VALID_AI_RESPONSE } }],
            usage: { prompt_tokens: 500, completion_tokens: 200, total_tokens: 700 },
          }),
      })
    );

    const client = new OpenAIClient('sk-test-key');
    const result = await runKeywordAudit(client, SAMPLE_INPUT);

    expect(result.keyword).toBe('productivity extension');
    expect(result.ownExtensionId).toBe(SAMPLE_INPUT.ownListing.extensionId);
    expect(result.competitorExtensionId).toBe(SAMPLE_INPUT.competitorListing.extensionId);
    expect(result.relevanceAnalysis).toBeTruthy();
    expect(result.recommendations).toHaveLength(3);
    expect(result.inputTokens).toBe(500);
    expect(result.outputTokens).toBe(200);
    expect(result.costUsd).toBeGreaterThan(0);
    expect(result.createdAt).toBeTruthy();
  });
});

describe('Audit cache in database', () => {
  let testDb: CWSDatabase;

  beforeEach(async () => {
    resetChromeMock();
    testDb = new CWSDatabase(`test-audit-${Date.now()}`);
    await testDb.open();
  });

  afterEach(async () => {
    testDb.close();
    await testDb.delete();
  });

  it('stores and retrieves cached audit result', async () => {
    const cacheKey = buildCacheKey('keyword', 'ext1', 'ext2', '2026-02-05');
    const cached = {
      cacheKey,
      keyword: 'keyword',
      ownExtensionId: 'ext1',
      competitorExtensionId: 'ext2',
      relevanceAnalysis: 'Analysis',
      metricComparison: 'Comparison',
      recommendations: [{ area: 'Title', suggestion: 'Do X', priority: 'high' as const }],
      rawResponse: '{}',
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.001,
      createdAt: '2026-02-05T12:00:00Z',
    };

    await testDb.saveAuditResult(cached);
    const result = await testDb.getCachedAudit(cacheKey);

    expect(result).toBeDefined();
    expect(result!.keyword).toBe('keyword');
    expect(result!.relevanceAnalysis).toBe('Analysis');
    expect(result!.recommendations).toHaveLength(1);
  });

  it('returns undefined for non-existent cache key', async () => {
    const result = await testDb.getCachedAudit('nonexistent-key');
    expect(result).toBeUndefined();
  });

  it('returns cached result on re-run with same inputs', async () => {
    const cacheKey = buildCacheKey('keyword', 'ext1', 'ext2', '2026-02-05');
    const cached = {
      cacheKey,
      keyword: 'keyword',
      ownExtensionId: 'ext1',
      competitorExtensionId: 'ext2',
      relevanceAnalysis: 'Cached analysis',
      metricComparison: 'Cached comparison',
      recommendations: [],
      rawResponse: '{}',
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.001,
      createdAt: '2026-02-05T12:00:00Z',
    };

    await testDb.saveAuditResult(cached);

    // Simulate second lookup with same key
    const result = await testDb.getCachedAudit(cacheKey);
    expect(result!.relevanceAnalysis).toBe('Cached analysis');
  });

  it('clears all cached audits', async () => {
    const key1 = buildCacheKey('kw1', 'e1', 'e2', '2026-02-05');
    const key2 = buildCacheKey('kw2', 'e1', 'e2', '2026-02-05');

    await testDb.saveAuditResult({
      cacheKey: key1, keyword: 'kw1', ownExtensionId: 'e1', competitorExtensionId: 'e2',
      relevanceAnalysis: '', metricComparison: '', recommendations: [],
      rawResponse: '', inputTokens: 0, outputTokens: 0, costUsd: 0, createdAt: '',
    });
    await testDb.saveAuditResult({
      cacheKey: key2, keyword: 'kw2', ownExtensionId: 'e1', competitorExtensionId: 'e2',
      relevanceAnalysis: '', metricComparison: '', recommendations: [],
      rawResponse: '', inputTokens: 0, outputTokens: 0, costUsd: 0, createdAt: '',
    });

    await testDb.clearAuditCache();

    expect(await testDb.getCachedAudit(key1)).toBeUndefined();
    expect(await testDb.getCachedAudit(key2)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Historical data formatter tests
// ---------------------------------------------------------------------------

function makeRankSnapshot(date: string, position: number | null): RankSnapshot {
  return {
    keywordId: 1,
    extensionId: 'ext-own-id-12345678901234567890',
    date,
    position,
    totalResults: 100,
    scannedAt: new Date(),
  };
}

function makeAutocompleteSnapshot(date: string, position: number): AutocompleteSnapshot {
  return {
    keywordId: 1,
    extensionId: 'ext-own-id-12345678901234567890',
    date,
    position,
    suggestedName: 'My Extension',
    scannedAt: new Date(),
  };
}

function makeEvent(date: string, type: string, note: string): EventRecord {
  return {
    extensionId: 'ext-own-id-12345678901234567890',
    date,
    type: type as EventRecord['type'],
    field: type.replace('_change', ''),
    oldValue: 'old',
    newValue: 'new',
    note,
  };
}

describe('formatRankHistory()', () => {
  it('formats snapshots into compact date|position line', () => {
    // Use dates relative to today for stable tests
    const now = new Date();
    const d1 = new Date(now); d1.setDate(d1.getDate() - 2);
    const d2 = new Date(now); d2.setDate(d2.getDate() - 1);
    const d3 = new Date(now);

    const snaps = [
      makeRankSnapshot(d1.toISOString().slice(0, 10), 5),
      makeRankSnapshot(d2.toISOString().slice(0, 10), 3),
      makeRankSnapshot(d3.toISOString().slice(0, 10), 2),
    ];

    const result = formatRankHistory('password manager', snaps, 7);

    expect(result).toContain('"password manager" search rank (last 7 days):');
    expect(result).toContain('#5');
    expect(result).toContain('#3');
    expect(result).toContain('#2');
    // Days without data should show -
    expect(result).toContain(': -');
  });

  it('returns empty message for no snapshots', () => {
    const result = formatRankHistory('test keyword', [], 7);
    expect(result).toBe('No ranking data available for this period.');
  });

  it('shows 30+ for null positions', () => {
    const now = new Date();
    const snaps = [makeRankSnapshot(now.toISOString().slice(0, 10), null)];
    const result = formatRankHistory('test', snaps, 7);
    expect(result).toContain('30+');
  });
});

describe('formatAutocompleteHistory()', () => {
  it('formats snapshots into compact date|position line', () => {
    const now = new Date();
    const d1 = new Date(now); d1.setDate(d1.getDate() - 1);
    const d2 = new Date(now);

    const snaps = [
      makeAutocompleteSnapshot(d1.toISOString().slice(0, 10), 3),
      makeAutocompleteSnapshot(d2.toISOString().slice(0, 10), 1),
    ];

    const result = formatAutocompleteHistory('password manager', snaps, 7);

    expect(result).toContain('"password manager" autocomplete position (last 7 days):');
    expect(result).toContain('#3');
    expect(result).toContain('#1');
    expect(result).toContain(': -');
  });

  it('returns empty message for no snapshots', () => {
    const result = formatAutocompleteHistory('test keyword', [], 7);
    expect(result).toBe('No autocomplete data available for this period.');
  });
});

describe('formatEventsHistory()', () => {
  it('formats events into multi-line table', () => {
    const events = [
      makeEvent('2026-02-26', 'version_change', 'Version changed from 1.2.0 to 1.3.0'),
      makeEvent('2026-02-28', 'user_milestone', 'Users passed 50,000'),
    ];

    const result = formatEventsHistory(events, 7);

    expect(result).toContain('Events (last 7 days):');
    expect(result).toContain('2026-02-26 | version_change | Version changed from 1.2.0 to 1.3.0');
    expect(result).toContain('2026-02-28 | user_milestone | Users passed 50,000');
  });

  it('returns empty message for no events', () => {
    const result = formatEventsHistory([], 7);
    expect(result).toBe('No events detected in this period.');
  });
});

describe('buildPlaceholderValues() with historical context', () => {
  it('includes all 12 historical placeholder keys when context provided', () => {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    const history: AuditHistoricalContext = {
      ownRankHistory: [makeRankSnapshot(todayStr, 5)],
      compRankHistory: [makeRankSnapshot(todayStr, 2)],
      ownAutocompleteHistory: [makeAutocompleteSnapshot(todayStr, 3)],
      compAutocompleteHistory: [makeAutocompleteSnapshot(todayStr, 1)],
      ownEvents: [makeEvent(todayStr, 'version_change', 'Version update')],
      compEvents: [makeEvent(todayStr, 'title_change', 'Title changed')],
    };

    const input: AuditInput = {
      ...SAMPLE_INPUT,
      history7d: history,
      history14d: history,
    };

    const values = buildPlaceholderValues(input);

    // 7d placeholders
    expect(values.ownRankHistory7d).toContain('#5');
    expect(values.compRankHistory7d).toContain('#2');
    expect(values.ownAutocomplete7d).toContain('#3');
    expect(values.compAutocomplete7d).toContain('#1');
    expect(values.ownEvents7d).toContain('version_change');
    expect(values.compEvents7d).toContain('title_change');

    // 14d placeholders
    expect(values.ownRankHistory14d).toContain('#5');
    expect(values.compRankHistory14d).toContain('#2');
    expect(values.ownAutocomplete14d).toContain('#3');
    expect(values.compAutocomplete14d).toContain('#1');
    expect(values.ownEvents14d).toContain('version_change');
    expect(values.compEvents14d).toContain('title_change');
  });

  it('uses fallback text when historical context is undefined', () => {
    const values = buildPlaceholderValues(SAMPLE_INPUT);

    const historicalKeys = [
      'ownRankHistory7d', 'ownRankHistory14d', 'compRankHistory7d', 'compRankHistory14d',
      'ownAutocomplete7d', 'ownAutocomplete14d', 'compAutocomplete7d', 'compAutocomplete14d',
      'ownEvents7d', 'ownEvents14d', 'compEvents7d', 'compEvents14d',
    ];

    for (const key of historicalKeys) {
      expect(values[key]).toBe('No data available.');
    }
  });
});
