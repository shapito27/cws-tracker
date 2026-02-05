import { describe, it, expect } from 'vitest';
import { extractCallbackData, safeGet } from '../../../src/background/parsers/extract.js';
import { ParserError } from '../../../src/background/parsers/types.js';

describe('extractCallbackData', () => {
  it('extracts data for a given key', () => {
    const html = `AF_initDataCallback({key: 'ds:0', hash: '1', data:["hello","world"]});`;
    const result = extractCallbackData(html, 'ds:0', 'test');
    expect(result).toEqual(['hello', 'world']);
  });

  it('extracts nested array data', () => {
    const html = `AF_initDataCallback({key: 'ds:1', hash: '2', data:[[1,[2,3]],null,"test"]});`;
    const result = extractCallbackData(html, 'ds:1', 'test');
    expect(result).toEqual([[1, [2, 3]], null, 'test']);
  });

  it('returns null when key is not found', () => {
    const html = `AF_initDataCallback({key: 'ds:0', hash: '1', data:[1]});`;
    const result = extractCallbackData(html, 'ds:5', 'test');
    expect(result).toBeNull();
  });

  it('returns null for empty HTML', () => {
    const result = extractCallbackData('', 'ds:0', 'test');
    expect(result).toBeNull();
  });

  it('handles strings with escaped quotes', () => {
    const html = `AF_initDataCallback({key: 'ds:0', hash: '1', data:["she said \\"hello\\"",42]});`;
    const result = extractCallbackData(html, 'ds:0', 'test');
    expect(result).toEqual(['she said "hello"', 42]);
  });

  it('handles strings with brackets inside', () => {
    const html = `AF_initDataCallback({key: 'ds:0', hash: '1', data:["array [1,2,3] here",99]});`;
    const result = extractCallbackData(html, 'ds:0', 'test');
    expect(result).toEqual(['array [1,2,3] here', 99]);
  });

  it('extracts correct key when multiple callbacks exist', () => {
    const html = `
      AF_initDataCallback({key: 'ds:0', hash: '1', data:[10]});
      AF_initDataCallback({key: 'ds:1', hash: '2', data:[20]});
    `;
    expect(extractCallbackData(html, 'ds:0', 'test')).toEqual([10]);
    expect(extractCallbackData(html, 'ds:1', 'test')).toEqual([20]);
  });

  it('throws ParserError for invalid JSON', () => {
    const html = `AF_initDataCallback({key: 'ds:0', hash: '1', data:[undefined]});`;
    expect(() => extractCallbackData(html, 'ds:0', 'test')).toThrow(ParserError);
  });

  it('throws ParserError with correct version', () => {
    const html = `AF_initDataCallback({key: 'ds:0', hash: '1', data:[undefined]});`;
    try {
      extractCallbackData(html, 'ds:0', 'my-parser-v1');
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ParserError);
      expect((e as ParserError).parserVersion).toBe('my-parser-v1');
    }
  });
});

describe('safeGet', () => {
  it('navigates nested arrays', () => {
    const data = [[[1, 2, 3]]];
    expect(safeGet(data, 0, 0, 2)).toBe(3);
  });

  it('returns undefined for out-of-bounds access', () => {
    const data = [[1, 2]];
    expect(safeGet(data, 0, 5)).toBeUndefined();
  });

  it('returns undefined when traversing through null', () => {
    const data = [null, [1]];
    expect(safeGet(data, 0, 0)).toBeUndefined();
  });

  it('returns undefined when traversing through non-array', () => {
    const data = ['hello', [1]];
    expect(safeGet(data, 0, 0)).toBeUndefined();
  });

  it('returns the root with no path', () => {
    const data = [1, 2, 3];
    expect(safeGet(data)).toEqual([1, 2, 3]);
  });

  it('returns undefined for empty array', () => {
    expect(safeGet([], 0)).toBeUndefined();
  });
});
