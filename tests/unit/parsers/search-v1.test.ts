import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { searchParserV1 } from '../../../src/background/parsers/search-v1.js';
import { ParserError } from '../../../src/background/parsers/types.js';
import type { SearchData } from '../../../src/background/parsers/types.js';

const FIXTURES_DIR = resolve(__dirname, '../../fixtures');

function loadFixture(name: string): string {
  return readFileSync(resolve(FIXTURES_DIR, name), 'utf8');
}

describe('searchParserV1', () => {
  describe('search results page ("ad blocker")', () => {
    let html: string;
    let result: SearchData;

    beforeAll(() => {
      html = loadFixture('cws-search-results.html');
      result = searchParserV1.parse(html);
    });

    it('returns an array of results', () => {
      expect(result.results).toBeInstanceOf(Array);
      expect(result.results.length).toBeGreaterThan(0);
    });

    it('returns 10 results', () => {
      expect(result.results.length).toBe(10);
    });

    it('first result is AdBlock', () => {
      expect(result.results[0].extensionId).toBe('gighmmpiobklfepjocnamgkkbiglidom');
      expect(result.results[0].name).toBe('AdBlock — block ads across the web');
    });

    it('second result is Adblock Plus', () => {
      expect(result.results[1].extensionId).toBe('cfhdojbkjhnklbpkdaibdccddilifddb');
      expect(result.results[1].name).toBe('Adblock Plus - free ad blocker');
    });

    it('assigns correct position to each result', () => {
      result.results.forEach((entry, idx) => {
        expect(entry.position).toBe(idx + 1);
      });
    });

    it('extracts extension IDs as 32-char lowercase strings', () => {
      result.results.forEach((entry) => {
        expect(entry.extensionId).toMatch(/^[a-z]{32}$/);
      });
    });

    it('extracts names for all results', () => {
      result.results.forEach((entry) => {
        expect(entry.name.length).toBeGreaterThan(0);
      });
    });

    it('extracts ratings as numbers between 0 and 5', () => {
      result.results.forEach((entry) => {
        expect(entry.rating).toBeGreaterThanOrEqual(0);
        expect(entry.rating).toBeLessThanOrEqual(5);
      });
    });

    it('extracts user counts as positive numbers', () => {
      result.results.forEach((entry) => {
        expect(entry.userCount).toBeGreaterThanOrEqual(0);
      });
    });

    it('extracts short descriptions', () => {
      result.results.forEach((entry) => {
        expect(entry.shortDescription.length).toBeGreaterThan(0);
      });
    });

    it('extracts icon URLs', () => {
      result.results.forEach((entry) => {
        expect(entry.iconUrl).toContain('https://');
      });
    });

    it('returns total count', () => {
      expect(result.totalCount).toBeGreaterThan(0);
    });

    it('returns a next page token', () => {
      expect(result.nextPageToken).toBeTruthy();
      expect(typeof result.nextPageToken).toBe('string');
    });

    it('has version string', () => {
      expect(searchParserV1.version).toBe('search-v1');
    });

    it('contains known ad blocker extensions', () => {
      const ids = result.results.map((r) => r.extensionId);
      // AdBlock
      expect(ids).toContain('gighmmpiobklfepjocnamgkkbiglidom');
      // Adblock Plus
      expect(ids).toContain('cfhdojbkjhnklbpkdaibdccddilifddb');
      // AdGuard
      expect(ids).toContain('bgnkhhnnamicmpeenaelnjfhikgbkllg');
    });

    it('all results have all required fields', () => {
      result.results.forEach((entry) => {
        expect(entry).toHaveProperty('extensionId');
        expect(entry).toHaveProperty('name');
        expect(entry).toHaveProperty('iconUrl');
        expect(entry).toHaveProperty('rating');
        expect(entry).toHaveProperty('ratingCount');
        expect(entry).toHaveProperty('shortDescription');
        expect(entry).toHaveProperty('userCount');
        expect(entry).toHaveProperty('category');
        expect(entry).toHaveProperty('isFeatured');
        expect(entry).toHaveProperty('position');
      });
    });
  });

  describe('empty search results', () => {
    let result: SearchData;

    beforeAll(() => {
      const html = loadFixture('cws-search-empty.html');
      result = searchParserV1.parse(html);
    });

    it('returns empty results array', () => {
      expect(result.results).toEqual([]);
    });

    it('total count is 0', () => {
      expect(result.totalCount).toBe(0);
    });

    it('next page token is null', () => {
      expect(result.nextPageToken).toBeNull();
    });
  });

  describe('position numbering', () => {
    it('positions are 1-based (first result = position 1)', () => {
      const html = loadFixture('cws-search-results.html');
      const result = searchParserV1.parse(html);
      expect(result.results[0].position).toBe(1);
    });

    it('positions are sequential', () => {
      const html = loadFixture('cws-search-results.html');
      const result = searchParserV1.parse(html);
      for (let i = 0; i < result.results.length; i++) {
        expect(result.results[i].position).toBe(i + 1);
      }
    });
  });

  describe('extension ID format', () => {
    it('all extension IDs are correctly extracted (no URL fragments, no whitespace)', () => {
      const html = loadFixture('cws-search-results.html');
      const result = searchParserV1.parse(html);
      result.results.forEach((entry) => {
        expect(entry.extensionId).toMatch(/^[a-z]{32}$/);
        expect(entry.extensionId).not.toContain('/');
        expect(entry.extensionId).not.toContain(' ');
        expect(entry.extensionId).not.toContain('\n');
      });
    });
  });

  describe('edge cases', () => {
    it('throws ParserError for empty HTML', () => {
      expect(() => searchParserV1.parse('')).toThrow(ParserError);
    });

    it('throws ParserError for HTML without AF_initDataCallback', () => {
      expect(() => searchParserV1.parse('<html><body>Hello</body></html>')).toThrow(
        ParserError,
      );
    });

    it('throws ParserError for malformed callback data', () => {
      const html = "AF_initDataCallback({key: 'ds:1', hash: '2', data:[broken});";
      expect(() => searchParserV1.parse(html)).toThrow(ParserError);
    });

    it('throws ParserError for truncated search response', () => {
      const html = "AF_initDataCallback({key: 'ds:1', hash: '2', data:[[[";
      expect(() => searchParserV1.parse(html)).toThrow(ParserError);
    });
  });
});
