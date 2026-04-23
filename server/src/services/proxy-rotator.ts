import { upsertProxyHealth, getProxyHealth } from '../db/queries.js';

export interface ProxyConfig {
  id: string;
  url: string | null;
  type: 'direct' | 'datacenter' | 'residential';
  weight: number;
  maxConsecutiveFailures: number;
}

export interface ProxyHealthReport {
  proxyId: string;
  type: ProxyConfig['type'];
  totalRequests: number;
  totalFailures: number;
  consecutiveFailures: number;
  disabled: boolean;
  disabledUntil: number | null;
}

const COOLDOWN_MS: Record<ProxyConfig['type'], number> = {
  direct: 2 * 60_000,
  datacenter: 10 * 60_000,
  residential: 30 * 60_000,
};

interface HealthState {
  totalRequests: number;
  totalFailures: number;
  consecutiveFailures: number;
  disabledUntil: number | null;
}

export class ProxyRotator {
  private configs: ProxyConfig[];
  private health: Map<string, HealthState> = new Map();

  constructor(configs: ProxyConfig[]) {
    this.configs = configs;
    for (const c of configs) {
      this.health.set(c.id, {
        totalRequests: 0, totalFailures: 0,
        consecutiveFailures: 0, disabledUntil: null,
      });
    }
  }

  async getNextProxy(): Promise<ProxyConfig> {
    const now = Date.now();
    const available = this.configs.filter(c => {
      const h = this.health.get(c.id)!;
      return !h.disabledUntil || h.disabledUntil <= now;
    });

    if (available.length === 0) {
      throw new Error('No available proxies — all are disabled');
    }

    const totalWeight = available.reduce((sum, c) => sum + c.weight, 0);
    let random = Math.random() * totalWeight;
    for (const c of available) {
      random -= c.weight;
      if (random <= 0) return c;
    }
    return available[available.length - 1]!;
  }

  async reportSuccess(proxyId: string): Promise<void> {
    const h = this.health.get(proxyId);
    if (!h) return;

    h.totalRequests++;
    h.consecutiveFailures = 0;
    h.disabledUntil = null;

    this.persistHealth(proxyId, h);
  }

  async reportFailure(proxyId: string, _statusCode: number): Promise<void> {
    const h = this.health.get(proxyId);
    if (!h) return;

    const config = this.configs.find(c => c.id === proxyId);
    if (!config) return;

    h.totalRequests++;
    h.totalFailures++;
    h.consecutiveFailures++;

    if (h.consecutiveFailures >= config.maxConsecutiveFailures) {
      h.disabledUntil = Date.now() + COOLDOWN_MS[config.type];
    }

    this.persistHealth(proxyId, h);
  }

  getHealthReport(): ProxyHealthReport[] {
    const now = Date.now();
    return this.configs.map(c => {
      const h = this.health.get(c.id)!;
      return {
        proxyId: c.id,
        type: c.type,
        totalRequests: h.totalRequests,
        totalFailures: h.totalFailures,
        consecutiveFailures: h.consecutiveFailures,
        disabled: h.disabledUntil !== null && h.disabledUntil > now,
        disabledUntil: h.disabledUntil,
      };
    });
  }

  private persistHealth(proxyId: string, h: HealthState): void {
    upsertProxyHealth(proxyId, {
      total_requests: h.totalRequests,
      total_failures: h.totalFailures,
      consecutive_failures: h.consecutiveFailures,
      disabled_until: h.disabledUntil ? new Date(h.disabledUntil).toISOString() : null,
      last_success_at: h.consecutiveFailures === 0 ? new Date().toISOString() : undefined,
      last_failure_at: h.consecutiveFailures > 0 ? new Date().toISOString() : undefined,
    }).catch((err) => {
      console.warn(`[proxy-rotator] Failed to persist health for ${proxyId}:`,
        err instanceof Error ? err.message : err);
    });
  }

  /**
   * Load persisted health state from DB. Should be called once during
   * service initialization so that a restart doesn't re-enable proxies
   * that were disabled pre-restart.
   */
  async loadHealthFromDB(): Promise<void> {
    for (const c of this.configs) {
      try {
        const record = await getProxyHealth(c.id);
        if (!record) continue;
        this.health.set(c.id, {
          totalRequests: record.total_requests ?? 0,
          totalFailures: record.total_failures ?? 0,
          consecutiveFailures: record.consecutive_failures ?? 0,
          disabledUntil: record.disabled_until ? new Date(record.disabled_until).getTime() : null,
        });
      } catch (err) {
        console.warn(`[proxy-rotator] Failed to load health for ${c.id}:`,
          err instanceof Error ? err.message : err);
      }
    }
  }
}
