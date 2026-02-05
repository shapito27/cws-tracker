import { describe, it, expect } from 'vitest';
import {
  getListingParser,
  getSearchParser,
  getAvailableListingParsers,
  getAvailableSearchParsers,
} from '../../../src/background/parsers/parser-factory.js';
import { listingParserV1 } from '../../../src/background/parsers/listing-v1.js';
import { searchParserV1 } from '../../../src/background/parsers/search-v1.js';

describe('parser factory', () => {
  describe('getListingParser', () => {
    it('returns listing-v1 parser by default', () => {
      const parser = getListingParser();
      expect(parser).toBe(listingParserV1);
      expect(parser.version).toBe('listing-v1');
    });

    it('returns listing-v1 parser when explicitly requested', () => {
      const parser = getListingParser('listing-v1');
      expect(parser).toBe(listingParserV1);
    });

    it('throws for unknown parser version', () => {
      expect(() => getListingParser('listing-v999')).toThrow('Unknown listing parser version');
    });

    it('error message includes available versions', () => {
      try {
        getListingParser('listing-v999');
        expect.fail('Should have thrown');
      } catch (e) {
        expect((e as Error).message).toContain('listing-v1');
      }
    });
  });

  describe('getSearchParser', () => {
    it('returns search-v1 parser by default', () => {
      const parser = getSearchParser();
      expect(parser).toBe(searchParserV1);
      expect(parser.version).toBe('search-v1');
    });

    it('returns search-v1 parser when explicitly requested', () => {
      const parser = getSearchParser('search-v1');
      expect(parser).toBe(searchParserV1);
    });

    it('throws for unknown parser version', () => {
      expect(() => getSearchParser('search-v999')).toThrow('Unknown search parser version');
    });

    it('error message includes available versions', () => {
      try {
        getSearchParser('search-v999');
        expect.fail('Should have thrown');
      } catch (e) {
        expect((e as Error).message).toContain('search-v1');
      }
    });
  });

  describe('getAvailableListingParsers', () => {
    it('returns available listing parser versions', () => {
      const versions = getAvailableListingParsers();
      expect(versions).toContain('listing-v1');
      expect(versions.length).toBeGreaterThan(0);
    });
  });

  describe('getAvailableSearchParsers', () => {
    it('returns available search parser versions', () => {
      const versions = getAvailableSearchParsers();
      expect(versions).toContain('search-v1');
      expect(versions.length).toBeGreaterThan(0);
    });
  });
});
