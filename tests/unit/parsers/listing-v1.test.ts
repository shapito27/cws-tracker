import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { listingParserV1, parseUserCount } from '../../../src/background/parsers/listing-v1.js';
import { ParserError } from '../../../src/background/parsers/types.js';
import type { ListingData } from '../../../src/background/parsers/types.js';

const FIXTURES_DIR = resolve(__dirname, '../../fixtures');

function loadFixture(name: string): string {
  return readFileSync(resolve(FIXTURES_DIR, name), 'utf8');
}

describe('listingParserV1', () => {
  describe('English detail page (uBlock Origin)', () => {
    let html: string;
    let result: ListingData;

    beforeAll(() => {
      html = loadFixture('cws-detail-en.html');
      result = listingParserV1.parse(html);
    });

    it('extracts the extension ID', () => {
      expect(result.extensionId).toBe('cjpalhdlnbpafiamejdnhcphjbkeiagm');
    });

    it('extracts the name', () => {
      expect(result.name).toBe('uBlock Origin');
    });

    it('extracts the short description', () => {
      expect(result.shortDescription).toBe(
        'Finally, an efficient blocker. Easy on CPU and memory.',
      );
    });

    it('extracts the full description', () => {
      expect(result.fullDescription).toContain('uBlock Origin');
      expect(result.fullDescription.length).toBeGreaterThan(100);
    });

    it('extracts the version', () => {
      expect(result.version).toBe('1.69.0');
    });

    it('extracts the developer name', () => {
      expect(result.developerName).toBe('Raymond Hill (gorhill)');
    });

    it('extracts developer email', () => {
      expect(result.developerEmail).toBe('ubo@raymondhill.net');
    });

    it('extracts developer ID', () => {
      expect(result.developerId).toBe('ufe0f3876bd6843cc72ff1855cf4a2cab');
    });

    it('extracts the rating', () => {
      expect(result.rating).toBeCloseTo(4.697, 2);
      expect(result.rating).toBeGreaterThan(0);
      expect(result.rating).toBeLessThanOrEqual(5);
    });

    it('extracts the rating count', () => {
      expect(result.ratingCount).toBe(35466);
    });

    it('sets reviewCount equal to ratingCount', () => {
      expect(result.reviewCount).toBe(result.ratingCount);
    });

    it('extracts the numeric user count', () => {
      expect(result.userCountNumeric).toBe(16000000);
    });

    it('formats the user count as display string', () => {
      expect(result.userCount).toBe('16,000,000+');
    });

    it('extracts the category', () => {
      expect(result.category).toBe('make_chrome_yours/privacy');
    });

    it('extracts the category ID', () => {
      expect(result.categoryId).toBe(22);
    });

    it('extracts the last updated date as YYYY-MM-DD', () => {
      expect(result.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('extracts the size', () => {
      expect(result.size).toBe('4.12MiB');
    });

    it('extracts the icon URL', () => {
      expect(result.iconUrl).toContain('https://lh3.googleusercontent.com/');
    });

    it('extracts screenshot URLs', () => {
      expect(result.screenshotUrls.length).toBeGreaterThan(0);
      result.screenshotUrls.forEach((url) => {
        expect(url).toContain('https://');
      });
    });

    it('sets screenshotCount from screenshotUrls length', () => {
      expect(result.screenshotCount).toBe(result.screenshotUrls.length);
      expect(result.screenshotCount).toBeGreaterThan(0);
    });

    it('extracts languages', () => {
      expect(result.languages.length).toBeGreaterThan(10);
      expect(result.languages).toContain('English');
    });

    it('extracts available locales (language codes)', () => {
      expect(result.availableLocales.length).toBeGreaterThan(10);
      expect(result.availableLocales).toContain('en');
    });

    it('sets translationCount from availableLocales length', () => {
      expect(result.translationCount).toBe(result.availableLocales.length);
      expect(result.translationCount).toBeGreaterThan(10);
    });

    it('extracts the support URL', () => {
      expect(result.supportUrl).toBe('https://github.com/uBlockOrigin/uBlock-issues');
    });

    it('extracts the privacy policy URL', () => {
      expect(result.privacyPolicyUrl).toBe(
        'https://github.com/gorhill/uBlock/wiki/Privacy-policy',
      );
    });

    it('extracts the browser min version', () => {
      expect(result.browserMinVersion).toBe('93.0');
    });

    it('extracts the featured badge flag', () => {
      expect(result.badgeFlags.featured).toBe(true);
    });

    it('defaults developerVerified to false', () => {
      expect(result.developerVerified).toBe(false);
    });

    it('defaults hasPromoVideo to false', () => {
      expect(result.hasPromoVideo).toBe(false);
    });

    it('extracts manifest JSON', () => {
      expect(result.manifestJson).toBeTruthy();
      const manifest = JSON.parse(result.manifestJson!);
      expect(manifest).toHaveProperty('manifest_version');
    });

    it('extracts permissions from manifest', () => {
      expect(result.permissions).toBeInstanceOf(Array);
      // uBlock Origin has permissions in its manifest
      expect(result.permissions.length).toBeGreaterThan(0);
    });

    it('extracts host permissions from manifest', () => {
      expect(result.hostPermissions).toBeInstanceOf(Array);
    });

    it('has version string', () => {
      expect(listingParserV1.version).toBe('listing-v1');
    });

    it('all fields are present and correctly typed', () => {
      expect(typeof result.extensionId).toBe('string');
      expect(typeof result.name).toBe('string');
      expect(typeof result.shortDescription).toBe('string');
      expect(typeof result.fullDescription).toBe('string');
      expect(typeof result.rating === 'number' || result.rating === null).toBe(true);
      expect(typeof result.ratingCount).toBe('number');
      expect(typeof result.reviewCount).toBe('number');
      expect(typeof result.userCount).toBe('string');
      expect(typeof result.userCountNumeric).toBe('number');
      expect(typeof result.version).toBe('string');
      expect(typeof result.lastUpdated).toBe('string');
      expect(typeof result.size).toBe('string');
      expect(Array.isArray(result.permissions)).toBe(true);
      expect(Array.isArray(result.hostPermissions)).toBe(true);
      expect(typeof result.screenshotCount).toBe('number');
      expect(Array.isArray(result.screenshotUrls)).toBe(true);
      expect(typeof result.hasPromoVideo).toBe('boolean');
      expect(typeof result.translationCount).toBe('number');
      expect(Array.isArray(result.availableLocales)).toBe(true);
      expect(Array.isArray(result.languages)).toBe(true);
      expect(typeof result.category).toBe('string');
      expect(typeof result.developerName).toBe('string');
      expect(typeof result.developerVerified).toBe('boolean');
      expect(typeof result.badgeFlags).toBe('object');
      expect(typeof result.iconUrl).toBe('string');
    });
  });

  describe('Japanese detail page (locale handling)', () => {
    let result: ListingData;

    beforeAll(() => {
      const html = loadFixture('cws-detail-ja.html');
      result = listingParserV1.parse(html);
    });

    it('extracts the same extension ID regardless of locale', () => {
      expect(result.extensionId).toBe('cjpalhdlnbpafiamejdnhcphjbkeiagm');
    });

    it('keeps the extension name (brand names not translated)', () => {
      expect(result.name).toBe('uBlock Origin');
    });

    it('returns the localized short description', () => {
      expect(result.shortDescription).toMatch(/[\u3040-\u9FFF]/);
    });

    it('returns the localized full description', () => {
      expect(result.fullDescription).toMatch(/[\u3040-\u9FFF]/);
    });

    it('has same numeric data as English page', () => {
      expect(result.rating).toBeCloseTo(4.697, 2);
      expect(result.ratingCount).toBe(35466);
      expect(result.userCountNumeric).toBe(16000000);
      expect(result.version).toBe('1.69.0');
    });

    it('has same structural data as English page', () => {
      expect(result.languages.length).toBeGreaterThan(10);
      expect(result.availableLocales.length).toBeGreaterThan(10);
      expect(result.screenshotUrls.length).toBeGreaterThan(0);
    });
  });

  describe('Spanish detail page (locale handling)', () => {
    let result: ListingData;

    beforeAll(() => {
      const html = loadFixture('cws-detail-es.html');
      result = listingParserV1.parse(html);
    });

    it('extracts the same extension ID', () => {
      expect(result.extensionId).toBe('cjpalhdlnbpafiamejdnhcphjbkeiagm');
    });

    it('returns Spanish short description', () => {
      expect(result.shortDescription.length).toBeGreaterThan(0);
    });

    it('has same version as other locales', () => {
      expect(result.version).toBe('1.69.0');
    });
  });

  describe('permissions extraction from manifest', () => {
    let result: ListingData;

    beforeAll(() => {
      const html = loadFixture('cws-detail-en.html');
      result = listingParserV1.parse(html);
    });

    it('extracts permissions array from manifest JSON', () => {
      expect(Array.isArray(result.permissions)).toBe(true);
      result.permissions.forEach((p) => {
        expect(typeof p).toBe('string');
      });
    });

    it('extracts host permissions array from manifest JSON', () => {
      expect(Array.isArray(result.hostPermissions)).toBe(true);
      result.hostPermissions.forEach((p) => {
        expect(typeof p).toBe('string');
      });
    });

    it('has broad host permission for uBlock Origin', () => {
      // uBlock Origin needs broad permissions to block ads on all sites
      const allPerms = [...result.permissions, ...result.hostPermissions];
      const hasBroad = allPerms.some(
        (p) => p === '<all_urls>' || p === '*://*/*' || p === 'http://*/*' || p === 'https://*/*',
      );
      expect(hasBroad).toBe(true);
    });
  });

  describe('badge flags', () => {
    it('has featured badge for uBlock Origin (featured extension)', () => {
      const html = loadFixture('cws-detail-en.html');
      const result = listingParserV1.parse(html);
      expect(result.badgeFlags.featured).toBe(true);
    });
  });

  describe('404 page (non-existent extension)', () => {
    it('throws ParserError for 404 page', () => {
      const html = loadFixture('cws-detail-404.html');
      expect(() => listingParserV1.parse(html)).toThrow(ParserError);
    });

    it('error includes parser version', () => {
      const html = loadFixture('cws-detail-404.html');
      try {
        listingParserV1.parse(html);
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ParserError);
        expect((e as ParserError).parserVersion).toBe('listing-v1');
      }
    });

    it('error has descriptive message', () => {
      const html = loadFixture('cws-detail-404.html');
      try {
        listingParserV1.parse(html);
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ParserError);
        expect((e as ParserError).message.length).toBeGreaterThan(10);
      }
    });
  });

  describe('edge cases', () => {
    it('throws ParserError for empty HTML', () => {
      expect(() => listingParserV1.parse('')).toThrow(ParserError);
    });

    it('throws ParserError for HTML without AF_initDataCallback', () => {
      expect(() => listingParserV1.parse('<html><body>Hello</body></html>')).toThrow(
        ParserError,
      );
    });

    it('throws ParserError for malformed callback data', () => {
      const html = "AF_initDataCallback({key: 'ds:0', hash: '2', data:[invalid json});";
      expect(() => listingParserV1.parse(html)).toThrow(ParserError);
    });

    it('throws ParserError for truncated response and does not crash', () => {
      const html = "AF_initDataCallback({key: 'ds:0', hash: '2', data:[[\"cjpalhdlnbpafi";
      expect(() => listingParserV1.parse(html)).toThrow(ParserError);
    });
  });
});

describe('parseUserCount', () => {
  it('parses "9,000+" as 9000', () => {
    expect(parseUserCount('9,000+')).toBe(9000);
  });

  it('parses "10,000,000+" as 10000000', () => {
    expect(parseUserCount('10,000,000+')).toBe(10000000);
  });

  it('parses "0" as 0', () => {
    expect(parseUserCount('0')).toBe(0);
  });

  it('parses empty string as 0', () => {
    expect(parseUserCount('')).toBe(0);
  });

  it('parses "1K+" as 1000', () => {
    expect(parseUserCount('1K+')).toBe(1000);
  });

  it('parses "5M+" as 5000000', () => {
    expect(parseUserCount('5M+')).toBe(5000000);
  });

  it('parses "1.5K+" as 1500', () => {
    expect(parseUserCount('1.5K+')).toBe(1500);
  });

  it('parses plain number "42" correctly', () => {
    expect(parseUserCount('42')).toBe(42);
  });

  it('handles whitespace', () => {
    expect(parseUserCount('  9,000+  ')).toBe(9000);
  });

  it('parses "1B+" as 1000000000', () => {
    expect(parseUserCount('1B+')).toBe(1000000000);
  });

  it('returns 0 for non-numeric text', () => {
    expect(parseUserCount('hello')).toBe(0);
  });

  it('parses "100" as 100', () => {
    expect(parseUserCount('100')).toBe(100);
  });
});
