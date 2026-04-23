import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resetChromeMock, chromeMock } from '../../mocks/chrome';
import { useServerSync } from '@/dashboard/composables/useServerSync';
import { SERVER_URL } from '@/shared/types/settings';
import { SettingsManager } from '@/shared/utils/settings';
import { db } from '@/shared/db/database';

describe('useServerSync', () => {
  let settings: SettingsManager;

  beforeEach(async () => {
    resetChromeMock();
    (globalThis as unknown as { chrome: typeof chromeMock }).chrome = chromeMock;
    settings = new SettingsManager();
    await settings.setMultiple({
      deviceId: 'test-uuid',
      serverApiKey: 'test-api-key',
      subscriptionStatus: 'pro',
    });
    // Reset DB tables that the sync touches
    await db.projects.clear();
    await db.extensions.clear();
    await db.keywords.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('pushScanConfig', () => {
    it('sends local projects/keywords to server', async () => {
      await db.extensions.put({
        id: 'a'.repeat(32),
        name: 'MyExt', iconUrl: '',
        addedAt: new Date(), lastScannedAt: null,
        status: 'active', projectRefs: [1],
      });
      const projectId = await db.projects.add({
        name: 'Proj 1', ownExtensionId: 'a'.repeat(32),
        competitorIds: ['b'.repeat(32)], keywordIds: [],
        createdAt: new Date(), updatedAt: new Date(),
      });
      await db.keywords.add({
        text: 'ad blocker', projectId: projectId as number, createdAt: new Date(),
      });

      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );

      const { pushScanConfig } = useServerSync();
      const ok = await pushScanConfig();

      expect(ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        `${SERVER_URL}/api/scan-configs`,
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            'X-API-Key': 'test-api-key',
            'Content-Type': 'application/json',
          }),
        }),
      );
      const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
      expect(body.projects).toHaveLength(1);
      expect(body.projects[0].ownExtensionId).toBe('a'.repeat(32));
      expect(body.projects[0].competitorIds).toEqual(['b'.repeat(32)]);
      expect(body.projects[0].keywordTexts).toEqual(['ad blocker']);
    });

    it('does nothing for free tier (Pro-only feature)', async () => {
      await settings.set('subscriptionStatus', 'free');
      const fetchMock = vi.spyOn(globalThis, 'fetch');
      const { pushScanConfig } = useServerSync();
      const ok = await pushScanConfig();
      expect(ok).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns false when serverApiKey is missing', async () => {
      await settings.set('serverApiKey', null);
      const fetchMock = vi.spyOn(globalThis, 'fetch');
      const { pushScanConfig, error } = useServerSync();
      const ok = await pushScanConfig();
      expect(ok).toBe(false);
      expect(error.value).toBeTruthy();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns false on server error', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ error: 'bad request' }), { status: 400 }),
      );
      const { pushScanConfig, error } = useServerSync();
      const ok = await pushScanConfig();
      expect(ok).toBe(false);
      expect(error.value).toContain('bad request');
    });

    it('sends empty projects array when no local projects exist', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
      const { pushScanConfig } = useServerSync();
      await pushScanConfig();
      const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
      expect(body.projects).toEqual([]);
    });
  });

  describe('loadCrawlStatus', () => {
    it('fetches latest crawl status from server', async () => {
      const lastRun = '2026-04-23T03:15:00Z';
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({
          lastRun, successful: 100, failed: 2, nextRun: '2026-04-24T03:00:00Z',
        }), { status: 200 }),
      );

      const { crawlStatus, loadCrawlStatus } = useServerSync();
      await loadCrawlStatus();

      expect(crawlStatus.value).not.toBeNull();
      expect(crawlStatus.value!.lastRun).toBe(lastRun);
      expect(crawlStatus.value!.successful).toBe(100);
    });

    it('handles no previous runs gracefully', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({
          lastRun: null, successful: 0, failed: 0, nextRun: null,
        }), { status: 200 }),
      );

      const { crawlStatus, loadCrawlStatus } = useServerSync();
      await loadCrawlStatus();

      expect(crawlStatus.value).not.toBeNull();
      expect(crawlStatus.value!.lastRun).toBeNull();
    });

    it('sets crawlStatus to null when not Pro', async () => {
      await settings.set('subscriptionStatus', 'free');
      const fetchMock = vi.spyOn(globalThis, 'fetch');
      const { crawlStatus, loadCrawlStatus } = useServerSync();
      await loadCrawlStatus();
      expect(crawlStatus.value).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sets error on server failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('', { status: 500 }),
      );
      const { error, loadCrawlStatus } = useServerSync();
      await loadCrawlStatus();
      expect(error.value).toBeTruthy();
    });
  });
});
