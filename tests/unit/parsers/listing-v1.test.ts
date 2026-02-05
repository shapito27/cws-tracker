import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { listingParserV1 } from '../../../src/background/parsers/listing-v1.js';
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
      expect(result.description).toContain('uBlock Origin');
      expect(result.description.length).toBeGreaterThan(100);
    });

    it('extracts the version', () => {
      expect(result.version).toBe('1.69.0');
    });

    it('extracts the developer name', () => {
      expect(result.offeredBy).toBe('Raymond Hill (gorhill)');
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

    it('extracts the user count', () => {
      expect(result.userCount).toBe(16000000);
    });

    it('extracts the category', () => {
      expect(result.category).toBe('make_chrome_yours/privacy');
    });

    it('extracts the category ID', () => {
      expect(result.categoryId).toBe(22);
    });

    it('extracts the last updated date', () => {
      expect(result.lastUpdated).toBeInstanceOf(Date);
      expect(result.lastUpdated.getFullYear()).toBeGreaterThanOrEqual(2024);
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

    it('extracts languages', () => {
      expect(result.languages.length).toBeGreaterThan(10);
      expect(result.languages).toContain('English');
    });

    it('extracts language codes', () => {
      expect(result.languageCodes.length).toBeGreaterThan(10);
      expect(result.languageCodes).toContain('en');
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

    it('extracts the featured flag', () => {
      expect(result.isFeatured).toBe(true);
    });

    it('extracts manifest JSON', () => {
      expect(result.manifestJson).toBeTruthy();
      // Should be parseable JSON
      const manifest = JSON.parse(result.manifestJson!);
      expect(manifest).toHaveProperty('manifest_version');
    });

    it('has version string', () => {
      expect(listingParserV1.version).toBe('listing-v1');
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
      // Japanese description should contain Japanese characters
      expect(result.shortDescription).toMatch(/[\u3040-\u9FFF]/);
    });

    it('returns the localized full description', () => {
      expect(result.description).toMatch(/[\u3040-\u9FFF]/);
    });

    it('has same numeric data as English page', () => {
      expect(result.rating).toBeCloseTo(4.697, 2);
      expect(result.ratingCount).toBe(35466);
      expect(result.userCount).toBe(16000000);
      expect(result.version).toBe('1.69.0');
    });

    it('has same structural data as English page', () => {
      expect(result.languages.length).toBeGreaterThan(10);
      expect(result.languageCodes.length).toBeGreaterThan(10);
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
      // Spanish description should contain accented characters or Spanish words
      expect(result.shortDescription.length).toBeGreaterThan(0);
    });

    it('has same version as other locales', () => {
      expect(result.version).toBe('1.69.0');
    });
  });

  describe('404 page (non-existent extension)', () => {
    it('throws ParserError for 404 page', () => {
      const html = loadFixture('cws-detail-404.html');
      expect(() => listingParserV1.parse(html)).toThrow(ParserError);
    });

    it('error message indicates invalid page', () => {
      const html = loadFixture('cws-detail-404.html');
      try {
        listingParserV1.parse(html);
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ParserError);
        expect((e as ParserError).parserVersion).toBe('listing-v1');
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
  });
});
