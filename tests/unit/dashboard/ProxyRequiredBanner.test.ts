// @vitest-environment jsdom

/**
 * Render tests for ProxyRequiredBanner — the banner appears only when no proxy
 * is configured, and exposes the one-click Deploy to Cloudflare action.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mount, flushPromises, RouterLinkStub } from '@vue/test-utils';
import { resetChromeMock } from '../../mocks/chrome';
import { SettingsManager } from '@/shared/utils/settings';
import { useProxyStatus } from '@/dashboard/composables/useProxyStatus';

const { default: ProxyRequiredBanner } = await import(
  '@/dashboard/components/ProxyRequiredBanner.vue'
);

const mountOpts = {
  global: { stubs: { 'router-link': RouterLinkStub } },
};

/** Sync the shared module-level proxy status with current mock storage. */
async function syncProxyStatus(): Promise<void> {
  await useProxyStatus().refreshProxyStatus();
}

describe('ProxyRequiredBanner', () => {
  beforeEach(async () => {
    resetChromeMock();
  });

  it('renders the banner with a Deploy to Cloudflare link when no proxy is set', async () => {
    await syncProxyStatus();
    const wrapper = mount(ProxyRequiredBanner, mountOpts);
    await flushPromises();

    expect(wrapper.find('[data-testid="proxy-required-banner"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('A proxy is required to scan');

    const deployLink = wrapper.find('a[href*="deploy.workers.cloudflare.com"]');
    expect(deployLink.exists()).toBe(true);
    expect(deployLink.attributes('href')).toContain(
      'github.com/shapito27/cws-tracker-proxy'
    );
  });

  it('hides the banner when a proxy URL is configured', async () => {
    await new SettingsManager().set('proxyUrl', 'https://proxy.example.com');
    await syncProxyStatus();

    const wrapper = mount(ProxyRequiredBanner, mountOpts);
    await flushPromises();

    expect(wrapper.find('[data-testid="proxy-required-banner"]').exists()).toBe(false);
  });
});
