/**
 * Tests for Queue Builder (Phase 1.6.1).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildDailyScanJobs,
  buildKeywordScanJobs,
  buildAutocompleteScanJobs,
  buildReviewScanJobs,
  PRIORITY_OWN_LISTING,
  PRIORITY_COMPETITOR_LISTING,
  PRIORITY_KEYWORD_SCAN,
  PRIORITY_AUTOCOMPLETE_SCAN,
  PRIORITY_REVIEW_SCAN,
} from '@/background/queue-builder';
import type { Project, Extension, Keyword, QueueJob, ReviewScanPayload } from '@/shared/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 1,
    name: 'Test Project',
    ownExtensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    competitorIds: [],
    keywordIds: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeExtension(id: string, overrides: Partial<Extension> = {}): Extension {
  return {
    id,
    name: `Extension ${id.slice(0, 6)}`,
    iconUrl: null,
    addedAt: new Date(),
    lastScannedAt: null,
    status: 'active',
    projectRefs: [1],
    ...overrides,
  };
}

function makeKeyword(id: number, text: string, projectId: number): Keyword {
  return { id, text, projectId, createdAt: new Date() };
}

const EXT_OWN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const EXT_COMP1 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const EXT_COMP2 = 'cccccccccccccccccccccccccccccccccc';
const EXT_COMP3 = 'dddddddddddddddddddddddddddddddd';
const EXT_COMP4 = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildDailyScanJobs', () => {
  it('single project, 1 extension, 2 keywords → 6 jobs (1 listing + 2 keyword + 2 autocomplete + 1 review)', () => {
    const projects = [makeProject({ ownExtensionId: EXT_OWN, keywordIds: [1, 2] })];
    const extensions = [makeExtension(EXT_OWN)];
    const keywords = [
      makeKeyword(1, 'ad blocker', 1),
      makeKeyword(2, 'privacy extension', 1),
    ];

    const jobs = buildDailyScanJobs(projects, extensions, keywords);

    expect(jobs).toHaveLength(6);

    // 1 listing scan
    const listingJobs = jobs.filter((j) => j.type === 'listing_scan');
    expect(listingJobs).toHaveLength(1);
    expect(listingJobs[0].payload).toEqual({ extensionId: EXT_OWN });

    // 2 keyword scans
    const keywordJobs = jobs.filter((j) => j.type === 'keyword_scan');
    expect(keywordJobs).toHaveLength(2);

    // 2 autocomplete scans
    const autocompleteJobs = jobs.filter((j) => j.type === 'autocomplete_scan');
    expect(autocompleteJobs).toHaveLength(2);

    // 1 review scan (per tracked extension)
    const reviewJobs = jobs.filter((j) => j.type === 'review_scan');
    expect(reviewJobs).toHaveLength(1);
    expect(reviewJobs[0].payload).toEqual({ extensionId: EXT_OWN });
  });

  it('single project, 5 extensions (1 own + 4 competitors), 10 keywords → 30 jobs', () => {
    const competitors = [EXT_COMP1, EXT_COMP2, EXT_COMP3, EXT_COMP4];
    const projects = [
      makeProject({
        ownExtensionId: EXT_OWN,
        competitorIds: competitors,
        keywordIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      }),
    ];
    const extensions = [
      makeExtension(EXT_OWN),
      ...competitors.map((id) => makeExtension(id)),
    ];
    const keywords = Array.from({ length: 10 }, (_, i) =>
      makeKeyword(i + 1, `keyword ${i + 1}`, 1)
    );

    const jobs = buildDailyScanJobs(projects, extensions, keywords);

    expect(jobs).toHaveLength(30);
    expect(jobs.filter((j) => j.type === 'listing_scan')).toHaveLength(5);
    expect(jobs.filter((j) => j.type === 'keyword_scan')).toHaveLength(10);
    expect(jobs.filter((j) => j.type === 'autocomplete_scan')).toHaveLength(10);
    expect(jobs.filter((j) => j.type === 'review_scan')).toHaveLength(5);
  });

  it('two projects sharing the same competitor → only 1 listing_scan for that extension', () => {
    const projects = [
      makeProject({
        id: 1,
        ownExtensionId: EXT_OWN,
        competitorIds: [EXT_COMP1],
      }),
      makeProject({
        id: 2,
        ownExtensionId: EXT_COMP2,
        competitorIds: [EXT_COMP1],
      }),
    ];
    const extensions = [
      makeExtension(EXT_OWN),
      makeExtension(EXT_COMP1),
      makeExtension(EXT_COMP2),
    ];
    const keywords: Keyword[] = [];

    const jobs = buildDailyScanJobs(projects, extensions, keywords);
    const listingJobs = jobs.filter((j) => j.type === 'listing_scan');

    // 3 unique extensions: EXT_OWN, EXT_COMP1, EXT_COMP2
    expect(listingJobs).toHaveLength(3);

    // EXT_COMP1 should only appear once
    const comp1Jobs = listingJobs.filter(
      (j) => (j.payload as { extensionId: string }).extensionId === EXT_COMP1
    );
    expect(comp1Jobs).toHaveLength(1);
  });

  it('two projects with the same keyword text → 2 keyword_scan + 2 autocomplete_scan jobs (no dedup)', () => {
    const projects = [
      makeProject({ id: 1, ownExtensionId: EXT_OWN }),
      makeProject({ id: 2, ownExtensionId: EXT_COMP1 }),
    ];
    const extensions = [makeExtension(EXT_OWN), makeExtension(EXT_COMP1)];
    const keywords = [
      makeKeyword(1, 'ad blocker', 1),
      makeKeyword(2, 'ad blocker', 2), // Same text, different keywordId
    ];

    const jobs = buildDailyScanJobs(projects, extensions, keywords);
    const keywordJobs = jobs.filter((j) => j.type === 'keyword_scan');
    const autocompleteJobs = jobs.filter((j) => j.type === 'autocomplete_scan');

    expect(keywordJobs).toHaveLength(2);
    expect(autocompleteJobs).toHaveLength(2);
  });

  it('priority ordering: own listing < competitor listing < keyword scan < autocomplete scan', () => {
    const projects = [
      makeProject({
        ownExtensionId: EXT_OWN,
        competitorIds: [EXT_COMP1],
        keywordIds: [1],
      }),
    ];
    const extensions = [makeExtension(EXT_OWN), makeExtension(EXT_COMP1)];
    const keywords = [makeKeyword(1, 'ad blocker', 1)];

    const jobs = buildDailyScanJobs(projects, extensions, keywords);

    const ownListing = jobs.find(
      (j) =>
        j.type === 'listing_scan' &&
        (j.payload as { extensionId: string }).extensionId === EXT_OWN
    );
    const compListing = jobs.find(
      (j) =>
        j.type === 'listing_scan' &&
        (j.payload as { extensionId: string }).extensionId === EXT_COMP1
    );
    const kwScan = jobs.find((j) => j.type === 'keyword_scan');
    const acScan = jobs.find((j) => j.type === 'autocomplete_scan');

    expect(ownListing!.priority).toBe(PRIORITY_OWN_LISTING);
    expect(compListing!.priority).toBe(PRIORITY_COMPETITOR_LISTING);
    expect(kwScan!.priority).toBe(PRIORITY_KEYWORD_SCAN);
    expect(acScan!.priority).toBe(PRIORITY_AUTOCOMPLETE_SCAN);

    // Verify ordering: own < competitor < keyword < autocomplete
    expect(ownListing!.priority).toBeLessThan(compListing!.priority);
    expect(compListing!.priority).toBeLessThan(kwScan!.priority);
    expect(kwScan!.priority).toBeLessThan(acScan!.priority);
  });

  it('empty project (no extensions, no keywords) → 0 jobs', () => {
    const projects = [
      makeProject({ ownExtensionId: '', competitorIds: [], keywordIds: [] }),
    ];
    const extensions: Extension[] = [];
    const keywords: Keyword[] = [];

    const jobs = buildDailyScanJobs(projects, extensions, keywords);

    expect(jobs).toHaveLength(0);
  });

  it('project with extensions but no keywords → listing_scan + review_scan jobs only (no keyword/autocomplete)', () => {
    const projects = [
      makeProject({
        ownExtensionId: EXT_OWN,
        competitorIds: [EXT_COMP1],
        keywordIds: [],
      }),
    ];
    const extensions = [makeExtension(EXT_OWN), makeExtension(EXT_COMP1)];
    const keywords: Keyword[] = [];

    const jobs = buildDailyScanJobs(projects, extensions, keywords);

    // 2 listing + 2 review (one per tracked extension), no keyword/autocomplete jobs.
    expect(jobs).toHaveLength(4);
    expect(jobs.filter((j) => j.type === 'listing_scan')).toHaveLength(2);
    expect(jobs.filter((j) => j.type === 'review_scan')).toHaveLength(2);
    expect(jobs.some((j) => j.type === 'keyword_scan' || j.type === 'autocomplete_scan')).toBe(false);
  });

  it('all jobs have correct initial status, retryCount, and scheduledAt', () => {
    const projects = [
      makeProject({
        ownExtensionId: EXT_OWN,
        competitorIds: [EXT_COMP1],
        keywordIds: [1],
      }),
    ];
    const extensions = [makeExtension(EXT_OWN), makeExtension(EXT_COMP1)];
    const keywords = [makeKeyword(1, 'ad blocker', 1)];

    const before = new Date();
    const jobs = buildDailyScanJobs(projects, extensions, keywords);
    const after = new Date();

    for (const job of jobs) {
      expect(job.status).toBe('pending');
      expect(job.retryCount).toBe(0);
      expect(job.maxRetries).toBe(3);
      expect(job.startedAt).toBeNull();
      expect(job.completedAt).toBeNull();
      expect(job.error).toBeNull();
      expect(job.scheduledAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(job.scheduledAt.getTime()).toBeLessThanOrEqual(after.getTime());
    }
  });

  it('no projects → 0 jobs', () => {
    const jobs = buildDailyScanJobs([], [], []);
    expect(jobs).toHaveLength(0);
  });

  it('competitor that is own extension in another project gets own priority', () => {
    const projects = [
      makeProject({
        id: 1,
        ownExtensionId: EXT_OWN,
        competitorIds: [EXT_COMP1],
      }),
      makeProject({
        id: 2,
        ownExtensionId: EXT_COMP1, // EXT_COMP1 is own in project 2
        competitorIds: [EXT_OWN],
      }),
    ];
    const extensions = [makeExtension(EXT_OWN), makeExtension(EXT_COMP1)];
    const keywords: Keyword[] = [];

    const jobs = buildDailyScanJobs(projects, extensions, keywords);
    const listingJobs = jobs.filter((j) => j.type === 'listing_scan');

    // Both EXT_OWN and EXT_COMP1 are "own" in at least one project
    expect(listingJobs).toHaveLength(2);
    for (const job of listingJobs) {
      expect(job.priority).toBe(PRIORITY_OWN_LISTING);
    }
  });
});

describe('buildKeywordScanJobs', () => {
  it('produces one keyword_scan job per keyword and no other types', () => {
    const keywords = [
      makeKeyword(1, 'ad blocker', 1),
      makeKeyword(2, 'privacy extension', 1),
      makeKeyword(3, 'password manager', 2),
    ];

    const jobs = buildKeywordScanJobs(keywords);

    expect(jobs).toHaveLength(3);
    expect(jobs.every((j) => j.type === 'keyword_scan')).toBe(true);
    expect(jobs.every((j) => j.priority === PRIORITY_KEYWORD_SCAN)).toBe(true);
    expect(jobs.every((j) => j.status === 'pending')).toBe(true);
  });

  it('payload carries keywordId and keyword text', () => {
    const keywords = [makeKeyword(42, 'ad blocker', 1)];

    const jobs = buildKeywordScanJobs(keywords);

    expect(jobs[0].payload).toEqual({ keywordId: 42, keyword: 'ad blocker' });
  });

  it('empty input → empty output', () => {
    expect(buildKeywordScanJobs([])).toEqual([]);
  });
});

describe('buildAutocompleteScanJobs', () => {
  it('produces one autocomplete_scan job per keyword and no other types', () => {
    const keywords = [
      makeKeyword(1, 'ad blocker', 1),
      makeKeyword(2, 'privacy extension', 1),
    ];

    const jobs = buildAutocompleteScanJobs(keywords);

    expect(jobs).toHaveLength(2);
    expect(jobs.every((j) => j.type === 'autocomplete_scan')).toBe(true);
    expect(jobs.every((j) => j.priority === PRIORITY_AUTOCOMPLETE_SCAN)).toBe(true);
    expect(jobs.every((j) => j.status === 'pending')).toBe(true);
  });

  it('payload carries keywordId and keyword text', () => {
    const keywords = [makeKeyword(7, 'privacy', 1)];

    const jobs = buildAutocompleteScanJobs(keywords);

    expect(jobs[0].payload).toEqual({ keywordId: 7, keyword: 'privacy' });
  });

  it('empty input → empty output', () => {
    expect(buildAutocompleteScanJobs([])).toEqual([]);
  });
});

describe('buildDailyScanJobs - review_scan jobs', () => {
  it('creates one review_scan per unique tracked extension (own + competitors, deduped)', () => {
    const projects = [
      makeProject({ id: 1, ownExtensionId: EXT_OWN, competitorIds: [EXT_COMP1, EXT_COMP2] }),
      // A second project sharing EXT_COMP1 should not double-count it.
      makeProject({ id: 2, ownExtensionId: EXT_COMP3, competitorIds: [EXT_COMP1] }),
    ];
    const extensions = [EXT_OWN, EXT_COMP1, EXT_COMP2, EXT_COMP3].map((id) => makeExtension(id));

    const jobs = buildDailyScanJobs(projects, extensions, []);
    const reviewJobs = jobs.filter((j) => j.type === 'review_scan');

    expect(reviewJobs).toHaveLength(4); // EXT_OWN, COMP1, COMP2, COMP3 — unique
    const ids = reviewJobs.map((j) => (j.payload as ReviewScanPayload).extensionId).sort();
    expect(ids).toEqual([EXT_OWN, EXT_COMP1, EXT_COMP2, EXT_COMP3].sort());
    expect(reviewJobs.every((j) => j.priority === PRIORITY_REVIEW_SCAN)).toBe(true);
    expect(reviewJobs.every((j) => j.maxRetries === 3)).toBe(true);
    expect(reviewJobs.every((j) => j.status === 'pending')).toBe(true);
  });
});

describe('buildReviewScanJobs', () => {
  it('creates one review_scan per unique extension id', () => {
    const jobs = buildReviewScanJobs([EXT_OWN, EXT_COMP1, EXT_OWN]);
    expect(jobs).toHaveLength(2);
    expect(jobs.every((j) => j.type === 'review_scan')).toBe(true);
    expect(jobs.every((j) => j.priority === PRIORITY_REVIEW_SCAN)).toBe(true);
    expect((jobs[0].payload as ReviewScanPayload).extensionId).toBe(EXT_OWN);
  });

  it('empty input → empty output', () => {
    expect(buildReviewScanJobs([])).toEqual([]);
  });
});
