/**
 * Tests for word-level text diff utility (Phase 2.5).
 *
 * Covers all TODO 2.5 test cases including edge cases for
 * identical, completely different, single word change, empty inputs,
 * and multi-paragraph text.
 */

import { describe, it, expect } from 'vitest';
import { computeTextDiff, type DiffSegment } from '../../../src/shared/utils/diff';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract only text from segments of a given type. */
function textOfType(segments: DiffSegment[], type: DiffSegment['type']): string {
  return segments
    .filter(s => s.type === type)
    .map(s => s.text)
    .join('');
}

/** Reconstruct the "old" text from diff segments (equal + removed). */
function reconstructOld(segments: DiffSegment[]): string {
  return segments
    .filter(s => s.type === 'equal' || s.type === 'removed')
    .map(s => s.text)
    .join('');
}

/** Reconstruct the "new" text from diff segments (equal + added). */
function reconstructNew(segments: DiffSegment[]): string {
  return segments
    .filter(s => s.type === 'equal' || s.type === 'added')
    .map(s => s.text)
    .join('');
}

// ---------------------------------------------------------------------------
// Core diff tests (from TODO 2.5)
// ---------------------------------------------------------------------------

describe('computeTextDiff', () => {
  it('identical strings: all segments are equal', () => {
    const result = computeTextDiff('hello world', 'hello world');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: 'equal', text: 'hello world' });
  });

  it('completely different strings: old is removed, new is added', () => {
    const result = computeTextDiff('foo bar', 'baz qux');
    // Should contain removed and added segments
    const removedText = textOfType(result, 'removed');
    const addedText = textOfType(result, 'added');
    expect(removedText).toContain('foo');
    expect(removedText).toContain('bar');
    expect(addedText).toContain('baz');
    expect(addedText).toContain('qux');
    // No equal segments (words are completely different)
    const equalText = textOfType(result, 'equal');
    expect(equalText.trim()).toBe('');
  });

  it('single word change: correctly shows surrounding context as equal', () => {
    const result = computeTextDiff(
      'the quick brown fox',
      'the slow brown fox'
    );
    // "the" and "brown fox" should be equal
    // "quick" removed, "slow" added
    expect(reconstructOld(result)).toBe('the quick brown fox');
    expect(reconstructNew(result)).toBe('the slow brown fox');
    // Verify there are equal, removed, and added segments
    expect(result.some(s => s.type === 'equal')).toBe(true);
    expect(result.some(s => s.type === 'removed')).toBe(true);
    expect(result.some(s => s.type === 'added')).toBe(true);
  });

  it('empty old + non-empty new: all added', () => {
    const result = computeTextDiff('', 'hello world');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: 'added', text: 'hello world' });
  });

  it('non-empty old + empty new: all removed', () => {
    const result = computeTextDiff('hello world', '');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: 'removed', text: 'hello world' });
  });

  it('both empty: empty segments array', () => {
    const result = computeTextDiff('', '');
    expect(result).toEqual([]);
  });

  it('multi-paragraph text: handles newlines correctly', () => {
    const oldText = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
    const newText = 'First paragraph.\n\nModified paragraph.\n\nThird paragraph.';
    const result = computeTextDiff(oldText, newText);
    expect(reconstructOld(result)).toBe(oldText);
    expect(reconstructNew(result)).toBe(newText);
    // Should have some equal segments (first and third paragraphs)
    expect(result.some(s => s.type === 'equal')).toBe(true);
    // Should have changes for the middle paragraph
    expect(result.some(s => s.type === 'removed')).toBe(true);
    expect(result.some(s => s.type === 'added')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Additional edge cases
  // -------------------------------------------------------------------------

  it('word added at the end', () => {
    const result = computeTextDiff('hello world', 'hello world extra');
    expect(reconstructOld(result)).toBe('hello world');
    expect(reconstructNew(result)).toBe('hello world extra');
    expect(textOfType(result, 'added')).toContain('extra');
  });

  it('word removed from the beginning', () => {
    const result = computeTextDiff('first hello world', 'hello world');
    expect(reconstructOld(result)).toBe('first hello world');
    expect(reconstructNew(result)).toBe('hello world');
    expect(textOfType(result, 'removed')).toContain('first');
  });

  it('consecutive segments of same type are merged', () => {
    const result = computeTextDiff('a b c', 'x y z');
    // All words differ, so should merge into single removed + single added
    // (whitespace tokens may or may not merge, but word tokens should)
    for (let i = 1; i < result.length; i++) {
      // Adjacent segments should NOT have the same type (they should be merged)
      expect(result[i].type).not.toBe(result[i - 1].type);
    }
  });

  it('preserves whitespace in segments', () => {
    const oldText = 'hello  world';
    const newText = 'hello  world';
    const result = computeTextDiff(oldText, newText);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('hello  world');
  });

  it('handles single-word texts', () => {
    const result = computeTextDiff('hello', 'world');
    expect(textOfType(result, 'removed')).toBe('hello');
    expect(textOfType(result, 'added')).toBe('world');
  });

  it('handles text with only whitespace changes', () => {
    // Different whitespace between same words
    const result = computeTextDiff('hello world', 'hello  world');
    expect(reconstructOld(result)).toBe('hello world');
    expect(reconstructNew(result)).toBe('hello  world');
  });

  it('reconstruction invariant holds for complex diff', () => {
    const oldText = 'Ad Blocker Pro - Block Ads Fast and Securely';
    const newText = 'Ad Blocker Plus - Remove Ads Fast and Efficiently';
    const result = computeTextDiff(oldText, newText);
    expect(reconstructOld(result)).toBe(oldText);
    expect(reconstructNew(result)).toBe(newText);
  });

  it('handles text with special characters', () => {
    const oldText = 'version 1.0.0 (beta)';
    const newText = 'version 2.0.0 (stable)';
    const result = computeTextDiff(oldText, newText);
    expect(reconstructOld(result)).toBe(oldText);
    expect(reconstructNew(result)).toBe(newText);
  });

  it('handles very long identical prefix', () => {
    const common = 'word '.repeat(50).trim();
    const oldText = common + ' old_end';
    const newText = common + ' new_end';
    const result = computeTextDiff(oldText, newText);
    expect(reconstructOld(result)).toBe(oldText);
    expect(reconstructNew(result)).toBe(newText);
    expect(textOfType(result, 'removed')).toContain('old_end');
    expect(textOfType(result, 'added')).toContain('new_end');
  });

  it('handles very long identical suffix', () => {
    const common = 'word '.repeat(50).trim();
    const oldText = 'old_start ' + common;
    const newText = 'new_start ' + common;
    const result = computeTextDiff(oldText, newText);
    expect(reconstructOld(result)).toBe(oldText);
    expect(reconstructNew(result)).toBe(newText);
    expect(textOfType(result, 'removed')).toContain('old_start');
    expect(textOfType(result, 'added')).toContain('new_start');
  });

  it('handles text with line breaks within words (newline-delimited)', () => {
    const oldText = 'line1\nline2\nline3';
    const newText = 'line1\nchanged\nline3';
    const result = computeTextDiff(oldText, newText);
    expect(reconstructOld(result)).toBe(oldText);
    expect(reconstructNew(result)).toBe(newText);
  });
});
