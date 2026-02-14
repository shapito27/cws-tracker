import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { autocompleteParserV1 } from '../../../src/background/parsers/autocomplete-v1.js';
import { ParserError } from '../../../src/background/parsers/types.js';
import type { AutocompleteData } from '../../../src/background/parsers/types.js';

const FIXTURES_DIR = resolve(__dirname, '../../fixtures');

function loadFixture(name: string): string {
  return readFileSync(resolve(FIXTURES_DIR, name), 'utf8');
}

describe('autocompleteParserV1', () => {
  describe('password manager query (mostly extensions)', () => {
    let json: string;
    let result: AutocompleteData;

    beforeAll(() => {
      json = loadFixture('cws-autocomplete-password-manager.json');
      result = autocompleteParserV1.parse(json);
    });

    it('returns 10 suggestions', () => {
      expect(result.suggestions).toHaveLength(10);
    });

    it('first suggestion is Dashlane extension', () => {
      const first = result.suggestions[0];
      expect(first.type).toBe('extension');
      if (first.type === 'extension') {
        expect(first.extensionId).toBe('fdjamakpfbbddfjaooikfcpapjohcfmg');
        expect(first.name).toBe('Dashlane — Password Manager');
        expect(first.position).toBe(1);
      }
    });

    it('last suggestion is a text suggestion (1Password)', () => {
      const last = result.suggestions[9];
      expect(last.type).toBe('text');
      if (last.type === 'text') {
        expect(last.text).toContain('1Password');
        expect(last.position).toBe(10);
      }
    });

    it('has 9 extension suggestions and 1 text suggestion', () => {
      const extSuggestions = result.suggestions.filter((s) => s.type === 'extension');
      const textSuggestions = result.suggestions.filter((s) => s.type === 'text');
      expect(extSuggestions).toHaveLength(9);
      expect(textSuggestions).toHaveLength(1);
    });

    it('all extension IDs are valid 32-char lowercase', () => {
      for (const s of result.suggestions) {
        if (s.type === 'extension') {
          expect(s.extensionId).toMatch(/^[a-z]{32}$/);
        }
      }
    });

    it('all extension suggestions have icon URLs', () => {
      for (const s of result.suggestions) {
        if (s.type === 'extension') {
          expect(s.iconUrl).toContain('https://');
        }
      }
    });

    it('positions are 1-based and sequential', () => {
      result.suggestions.forEach((s, idx) => {
        expect(s.position).toBe(idx + 1);
      });
    });

    it('contains known password managers', () => {
      const extIds = result.suggestions
        .filter((s) => s.type === 'extension')
        .map((s) => (s as { extensionId: string }).extensionId);
      // Bitwarden
      expect(extIds).toContain('nngceckbapebfimnlniiiahkandclblb');
      // LastPass
      expect(extIds).toContain('hdokiejnpimakedhajhdlcegeplioahd');
    });
  });

  describe('VPN query (mix of extensions and text)', () => {
    let json: string;
    let result: AutocompleteData;

    beforeAll(() => {
      json = loadFixture('cws-autocomplete-vpn.json');
      result = autocompleteParserV1.parse(json);
    });

    it('returns 10 suggestions', () => {
      expect(result.suggestions).toHaveLength(10);
    });

    it('first suggestion is a text suggestion (Hola VPN)', () => {
      const first = result.suggestions[0];
      expect(first.type).toBe('text');
      if (first.type === 'text') {
        expect(first.text).toContain('Hola VPN');
      }
    });

    it('has both extension and text suggestions', () => {
      const types = new Set(result.suggestions.map((s) => s.type));
      expect(types.has('extension')).toBe(true);
      expect(types.has('text')).toBe(true);
    });

    it('text suggestions have correct structure', () => {
      const textSuggestions = result.suggestions.filter((s) => s.type === 'text');
      expect(textSuggestions.length).toBeGreaterThan(0);
      for (const s of textSuggestions) {
        if (s.type === 'text') {
          expect(s.text.length).toBeGreaterThan(0);
          expect(s.position).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('version', () => {
    it('has correct version string', () => {
      expect(autocompleteParserV1.version).toBe('autocomplete-v1');
    });
  });

  describe('edge cases', () => {
    it('throws ParserError for empty string', () => {
      expect(() => autocompleteParserV1.parse('')).toThrow(ParserError);
    });

    it('throws ParserError for invalid JSON', () => {
      expect(() => autocompleteParserV1.parse('not json')).toThrow(ParserError);
    });

    it('throws ParserError for non-array JSON', () => {
      expect(() => autocompleteParserV1.parse('{"foo": "bar"}')).toThrow(ParserError);
    });

    it('returns empty suggestions for empty array', () => {
      const result = autocompleteParserV1.parse('[]');
      expect(result.suggestions).toEqual([]);
    });

    it('skips entries with invalid extension IDs', () => {
      const json = JSON.stringify([
        [null, ['Bad Extension', 'not-a-valid-id', 1, 'icon.png']],
        [null, ['Good Extension', 'abcdefghijklmnopqrstuvwxyzabcdef', 1, 'icon.png']],
      ]);
      const result = autocompleteParserV1.parse(json);
      expect(result.suggestions).toHaveLength(1);
      if (result.suggestions[0].type === 'extension') {
        expect(result.suggestions[0].extensionId).toBe('abcdefghijklmnopqrstuvwxyzabcdef');
      }
    });

    it('handles entries with unexpected structure gracefully', () => {
      const json = JSON.stringify([
        [null, ['Valid', 'abcdefghijklmnopqrstuvwxyzabcdef', 1, 'icon.png']],
        [42], // unexpected
        null, // unexpected
        'string', // unexpected
      ]);
      const result = autocompleteParserV1.parse(json);
      expect(result.suggestions).toHaveLength(1);
    });
  });
});
