import { describe, it, expect } from 'vitest';
import { parseBatchExecuteResponse, SEARCH_RPC_METHOD, AUTOCOMPLETE_RPC_METHOD } from './cws-fetcher.js';

describe('parseBatchExecuteResponse', () => {
  describe('chunked format (rt=c)', () => {
    it('extracts search data from length-prefixed chunks', () => {
      const response = `)]}'\n` +
        `130\n` +
        `[["wrb.fr","${SEARCH_RPC_METHOD}","[[\\"result-data\\"]]",null,null,null,"generic"]]\n` +
        `25\n` +
        `[["di",12345]]\n`;

      const result = parseBatchExecuteResponse(response, SEARCH_RPC_METHOD);
      expect(result).toBe('[["result-data"]]');
    });

    it('extracts autocomplete data from chunked response', () => {
      const response = `)]}'\n` +
        `120\n` +
        `[["wrb.fr","${AUTOCOMPLETE_RPC_METHOD}","[\\"suggestion1\\"]",null,null,null,"generic"]]\n`;

      const result = parseBatchExecuteResponse(response, AUTOCOMPLETE_RPC_METHOD);
      expect(result).toBe('["suggestion1"]');
    });

    it('skips chunks for other RPC methods', () => {
      const response = `)]}'\n` +
        `80\n` +
        `[["wrb.fr","otherMethod","irrelevant",null,null,null,"generic"]]\n` +
        `100\n` +
        `[["wrb.fr","${SEARCH_RPC_METHOD}","[[\\"correct\\"]]",null,null,null,"generic"]]\n`;

      const result = parseBatchExecuteResponse(response, SEARCH_RPC_METHOD);
      expect(result).toBe('[["correct"]]');
    });

    it('handles security prefix with varying formats', () => {
      const variants = [
        ")]}'\n",
        ")]}",
        "}",
        "",
      ];
      for (const prefix of variants) {
        const response = `${prefix}\n[["wrb.fr","${SEARCH_RPC_METHOD}","data",null,null,null,"generic"]]\n`;
        const result = parseBatchExecuteResponse(response, SEARCH_RPC_METHOD);
        expect(result).toBe('data');
      }
    });
  });

  describe('non-chunked format', () => {
    it('extracts from flat JSON array', () => {
      const response = `[["wrb.fr","${SEARCH_RPC_METHOD}","[[\\"flat-data\\"]]",null,null,null,"generic"]]`;
      const result = parseBatchExecuteResponse(response, SEARCH_RPC_METHOD);
      expect(result).toBe('[["flat-data"]]');
    });

    it('extracts from nested JSON array', () => {
      const response = `[[["wrb.fr","${SEARCH_RPC_METHOD}","nested-data",null,null,null,"generic"]]]`;
      const result = parseBatchExecuteResponse(response, SEARCH_RPC_METHOD);
      expect(result).toBe('nested-data');
    });
  });

  describe('error cases', () => {
    it('throws when RPC method not found', () => {
      const response = `[["wrb.fr","wrongMethod","data",null]]`;
      expect(() => parseBatchExecuteResponse(response, SEARCH_RPC_METHOD))
        .toThrow(`${SEARCH_RPC_METHOD} response not found`);
    });

    it('throws for empty response', () => {
      expect(() => parseBatchExecuteResponse('', SEARCH_RPC_METHOD))
        .toThrow(`${SEARCH_RPC_METHOD} response not found`);
    });

    it('throws for garbage text', () => {
      expect(() => parseBatchExecuteResponse('this is not json at all', SEARCH_RPC_METHOD))
        .toThrow(`${SEARCH_RPC_METHOD} response not found`);
    });

    it('throws when data field is not a string', () => {
      const response = `[["wrb.fr","${SEARCH_RPC_METHOD}",12345,null]]`;
      expect(() => parseBatchExecuteResponse(response, SEARCH_RPC_METHOD))
        .toThrow(`${SEARCH_RPC_METHOD} response not found`);
    });

    it('throws for response with only prefix', () => {
      expect(() => parseBatchExecuteResponse(`)]}'\n`, SEARCH_RPC_METHOD))
        .toThrow(`${SEARCH_RPC_METHOD} response not found`);
    });
  });

  describe('edge cases', () => {
    it('handles data containing escaped quotes', () => {
      const data = '[[null,["ad blocker",["extid123"]]]]';
      const response = `[["wrb.fr","${SEARCH_RPC_METHOD}",${JSON.stringify(data)},null,null,null,"generic"]]`;
      const result = parseBatchExecuteResponse(response, SEARCH_RPC_METHOD);
      expect(result).toBe(data);
    });

    it('handles empty lines between chunks', () => {
      const response = `)]}'\n\n\n` +
        `100\n` +
        `[["wrb.fr","${SEARCH_RPC_METHOD}","found",null,null,null,"generic"]]\n\n`;
      const result = parseBatchExecuteResponse(response, SEARCH_RPC_METHOD);
      expect(result).toBe('found');
    });

    it('handles whitespace-padded lines', () => {
      const response = `  [["wrb.fr","${SEARCH_RPC_METHOD}","trimmed",null,null,null,"generic"]]  `;
      const result = parseBatchExecuteResponse(response, SEARCH_RPC_METHOD);
      expect(result).toBe('trimmed');
    });
  });
});
