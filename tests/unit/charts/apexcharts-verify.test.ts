/**
 * @vitest-environment jsdom
 *
 * Verify ApexCharts and vue3-apexcharts packages are installed and importable.
 * ApexCharts requires a DOM environment, so this test uses jsdom.
 */
import { describe, it, expect } from 'vitest';

describe('ApexCharts integration', () => {
  it('apexcharts module resolves', async () => {
    const mod = await import('apexcharts');
    expect(mod).toBeDefined();
    expect(mod.default).toBeDefined();
  });

  it('vue3-apexcharts module resolves', async () => {
    const mod = await import('vue3-apexcharts');
    expect(mod).toBeDefined();
    expect(mod.default).toBeDefined();
  });
});
