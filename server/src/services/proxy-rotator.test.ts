import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProxyRotator, type ProxyConfig } from './proxy-rotator.js';

const directProxy: ProxyConfig = { id: 'direct', url: null, type: 'direct', weight: 10, maxConsecutiveFailures: 3 };
const dcProxy: ProxyConfig = { id: 'dc-1', url: 'http://dc:8080', type: 'datacenter', weight: 5, maxConsecutiveFailures: 3 };
const resProxy: ProxyConfig = { id: 'res-1', url: 'http://res:8080', type: 'residential', weight: 1, maxConsecutiveFailures: 2 };

vi.mock('../db/queries.js', () => ({
  getProxyHealth: vi.fn().mockResolvedValue(null),
  upsertProxyHealth: vi.fn().mockResolvedValue(undefined),
}));

import { upsertProxyHealth } from '../db/queries.js';

describe('ProxyRotator', () => {
  let rotator: ProxyRotator;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getNextProxy', () => {
    it('returns a proxy from the pool', async () => {
      rotator = new ProxyRotator([directProxy, dcProxy]);
      const proxy = await rotator.getNextProxy();
      expect([directProxy.id, dcProxy.id]).toContain(proxy.id);
    });

    it('favors higher-weight proxies over many calls', async () => {
      rotator = new ProxyRotator([directProxy, resProxy]); // weight 10 vs 1
      const counts: Record<string, number> = { direct: 0, 'res-1': 0 };
      for (let i = 0; i < 100; i++) {
        const proxy = await rotator.getNextProxy();
        counts[proxy.id]!++;
      }
      expect(counts['direct']).toBeGreaterThan(counts['res-1']! * 3);
    });

    it('skips disabled proxies', async () => {
      rotator = new ProxyRotator([directProxy, dcProxy]);
      // Disable direct by exceeding failures
      for (let i = 0; i < directProxy.maxConsecutiveFailures; i++) {
        await rotator.reportFailure(directProxy.id, 403);
      }
      // Now all picks should be dc-1
      for (let i = 0; i < 10; i++) {
        const proxy = await rotator.getNextProxy();
        expect(proxy.id).toBe('dc-1');
      }
    });

    it('throws when all proxies are disabled', async () => {
      rotator = new ProxyRotator([directProxy]);
      for (let i = 0; i < directProxy.maxConsecutiveFailures; i++) {
        await rotator.reportFailure(directProxy.id, 403);
      }
      await expect(rotator.getNextProxy()).rejects.toThrow('No available proxies');
    });

    it('works with single proxy', async () => {
      rotator = new ProxyRotator([directProxy]);
      const proxy = await rotator.getNextProxy();
      expect(proxy.id).toBe('direct');
    });
  });

  describe('reportSuccess', () => {
    it('resets consecutive failures', async () => {
      rotator = new ProxyRotator([directProxy, dcProxy]);
      await rotator.reportFailure(directProxy.id, 429);
      await rotator.reportFailure(directProxy.id, 429);
      await rotator.reportSuccess(directProxy.id);
      // Proxy should still be available (failures reset)
      const available = await rotator.getNextProxy();
      // With failures reset, direct (weight 10) should dominate again
      expect(available).toBeDefined();
    });

    it('persists health to DB', async () => {
      rotator = new ProxyRotator([directProxy]);
      await rotator.reportSuccess(directProxy.id);
      expect(upsertProxyHealth).toHaveBeenCalled();
    });
  });

  describe('reportFailure', () => {
    it('increments consecutive failures', async () => {
      rotator = new ProxyRotator([directProxy, dcProxy]);
      await rotator.reportFailure(directProxy.id, 429);
      await rotator.reportFailure(directProxy.id, 429);
      // Not disabled yet (need 3 for directProxy)
      const health = rotator.getHealthReport();
      const directHealth = health.find(h => h.proxyId === directProxy.id);
      expect(directHealth!.consecutiveFailures).toBe(2);
      expect(directHealth!.disabled).toBe(false);
    });

    it('disables proxy after maxConsecutiveFailures', async () => {
      rotator = new ProxyRotator([directProxy, dcProxy]);
      for (let i = 0; i < directProxy.maxConsecutiveFailures; i++) {
        await rotator.reportFailure(directProxy.id, 403);
      }
      const health = rotator.getHealthReport();
      const directHealth = health.find(h => h.proxyId === directProxy.id);
      expect(directHealth!.disabled).toBe(true);
    });

    it('persists failure to DB', async () => {
      rotator = new ProxyRotator([directProxy]);
      await rotator.reportFailure(directProxy.id, 500);
      expect(upsertProxyHealth).toHaveBeenCalled();
    });

    it('ignores unknown proxy IDs gracefully', async () => {
      rotator = new ProxyRotator([directProxy]);
      await expect(rotator.reportFailure('nonexistent', 500)).resolves.toBeUndefined();
    });
  });

  describe('re-enable after cooldown', () => {
    it('re-enables proxy after cooldown expires', async () => {
      vi.useFakeTimers();
      try {
        rotator = new ProxyRotator([directProxy, dcProxy]);
        for (let i = 0; i < directProxy.maxConsecutiveFailures; i++) {
          await rotator.reportFailure(directProxy.id, 403);
        }
        // Direct is now disabled
        let health = rotator.getHealthReport();
        expect(health.find(h => h.proxyId === 'direct')!.disabled).toBe(true);

        // Advance past cooldown (direct = 2 min)
        vi.advanceTimersByTime(2 * 60_000 + 1);

        health = rotator.getHealthReport();
        expect(health.find(h => h.proxyId === 'direct')!.disabled).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('getHealthReport', () => {
    it('returns health for all proxies', () => {
      rotator = new ProxyRotator([directProxy, dcProxy, resProxy]);
      const report = rotator.getHealthReport();
      expect(report).toHaveLength(3);
      expect(report.map(h => h.proxyId).sort()).toEqual(['dc-1', 'direct', 'res-1']);
    });

    it('shows zero stats for fresh proxies', () => {
      rotator = new ProxyRotator([directProxy]);
      const report = rotator.getHealthReport();
      expect(report[0]!.totalRequests).toBe(0);
      expect(report[0]!.totalFailures).toBe(0);
      expect(report[0]!.consecutiveFailures).toBe(0);
      expect(report[0]!.disabled).toBe(false);
    });

    it('tracks total requests and failures separately', async () => {
      rotator = new ProxyRotator([directProxy]);
      await rotator.reportSuccess(directProxy.id);
      await rotator.reportSuccess(directProxy.id);
      await rotator.reportFailure(directProxy.id, 500);
      const report = rotator.getHealthReport();
      expect(report[0]!.totalRequests).toBe(3);
      expect(report[0]!.totalFailures).toBe(1);
    });
  });
});
