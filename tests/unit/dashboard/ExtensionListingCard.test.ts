// @vitest-environment jsdom

/**
 * Render tests for ExtensionListingCard — focused on the developer website
 * from the CWS listing: it must render as a linked domain, stay absent when
 * the listing declares none, and never put a hostile value into the href.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import type { Extension, ListingSnapshot } from '@/shared/types';

const { default: ExtensionListingCard } = await import(
  '@/dashboard/components/project/ExtensionListingCard.vue'
);

const EXT = 'extaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function makeExtension(): Extension {
  return {
    id: EXT, name: 'My Ext', iconUrl: null, addedAt: new Date(), lastScannedAt: null,
    status: 'active', projectRefs: [1], reviewTextCount: 0,
  };
}

function makeListing(over: Partial<ListingSnapshot> = {}): ListingSnapshot {
  return {
    extensionId: EXT, date: '2026-03-01', title: 'My Ext', shortDescription: '',
    fullDescription: '', rating: 4.5, ratingCount: 2, reviewCount: 2, userCount: '835+',
    userCountNumeric: 835, version: '1.0', lastUpdated: '2026-03-01', size: '1MiB',
    permissions: [], hostPermissions: [], permissionRiskScore: 0, badgeFlags: {},
    screenshotCount: 0, hasPromoVideo: false, translationCount: 0, availableLocales: [],
    category: '', developerName: 'idevext', developerVerified: false,
    listingQualityScore: null, scannedAt: new Date(), ...over,
  };
}

function mountCard(snapshot: ListingSnapshot | undefined) {
  return mount(ExtensionListingCard, {
    props: { extension: makeExtension(), snapshot, extensionId: EXT, badge: null },
  });
}

/** The developer-website anchor, identified by its aria-label. */
function siteLink(wrapper: ReturnType<typeof mountCard>) {
  return wrapper.findAll('a').find((a) => a.attributes('aria-label')?.startsWith('Developer website'));
}

describe('ExtensionListingCard developer website', () => {
  it('renders a schemeless domain as a link with an https href', () => {
    const link = siteLink(mountCard(makeListing({ websiteUrl: 'wizardstool.com' })));
    expect(link).toBeDefined();
    expect(link!.text()).toBe('wizardstool.com');
    expect(link!.attributes('href')).toBe('https://wizardstool.com/');
  });

  it('shows the bare domain but links the full URL', () => {
    const link = siteLink(mountCard(makeListing({ websiteUrl: 'https://www.joinhoney.com/' })));
    expect(link!.text()).toBe('joinhoney.com');
    expect(link!.attributes('href')).toBe('https://www.joinhoney.com/');
  });

  it('opens in a new tab without leaking the referrer', () => {
    const link = siteLink(mountCard(makeListing({ websiteUrl: 'https://darkreader.org/' })));
    expect(link!.attributes('target')).toBe('_blank');
    expect(link!.attributes('rel')).toContain('noopener');
  });

  it('renders no website link when the listing declares none', () => {
    expect(siteLink(mountCard(makeListing({ websiteUrl: null })))).toBeUndefined();
  });

  it('renders no website link for pre-0.38.0 snapshots missing the field', () => {
    expect(siteLink(mountCard(makeListing()))).toBeUndefined();
  });

  it('drops a javascript: value instead of rendering it', () => {
    const wrapper = mountCard(makeListing({ websiteUrl: 'javascript:alert(1)' }));
    expect(siteLink(wrapper)).toBeUndefined();
    expect(wrapper.html()).not.toContain('javascript:alert');
  });

  it('keeps metadata separators balanced when the website is absent', () => {
    // One separator between each consecutive item; a dropped website must not
    // leave an orphaned "|".
    const withSite = mountCard(makeListing({ websiteUrl: 'wizardstool.com' }));
    const without = mountCard(makeListing({ websiteUrl: null }));
    const bars = (w: ReturnType<typeof mountCard>) =>
      w.findAll('span').filter((s) => s.text() === '|').length;
    expect(bars(withSite)).toBe(bars(without) + 1);
  });
});
