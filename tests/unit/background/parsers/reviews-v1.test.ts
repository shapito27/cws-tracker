import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { reviewsParserV1 } from '@/background/parsers/reviews-v1';
import { extractCallbackData } from '@/background/parsers/extract';
import { ParserError } from '@/background/parsers/types';

// The proxy extracts the ds:1 array from the reviews page and passes it as the
// `data` string. Reproduce that here from the saved fixture.
const html = readFileSync(
  resolve(__dirname, '../../../fixtures/reviews-website-broken-link-check.html'),
  'utf8',
);
const ds1 = extractCallbackData(html, 'ds:1', 'test');
const json = JSON.stringify(ds1);

describe('reviews-v1', () => {
  it('parses all 10 page-1 reviews with every field', () => {
    const data = reviewsParserV1.parse(json);

    expect(data.reviews).toHaveLength(10);
    expect(data.textReviewCount).toBe(11);
    expect(typeof data.nextToken).toBe('string');
    expect((data.nextToken ?? '').length).toBeGreaterThan(100);

    const first = data.reviews[0];
    expect(first.reviewId).toBe('0e714621-2985-48ba-827c-fa45cd024c41');
    expect(first.reviewerName).toBe('Franklyn Moore');
    expect(first.reviewerAvatar).toContain('googleusercontent.com');
    expect(first.rating).toBe(5);
    expect(first.text).toContain('GREAT Tool');
    expect(first.helpfulCount).toBe(1);
    expect(first.extensionId).toBe('aliiafckfmihheljnphnkpfhlnnjmkgk');
    expect(first.devReply?.author).toBe('Ben');
    expect(first.devReply?.text).toContain('thanks');
    expect(first.versionReviewed).toBe('3.4.29');
    expect(first.language).toBe('en');
    expect(first.postedAtEpoch).toBeGreaterThan(1_700_000_000);
    expect(first.updatedAtEpoch).toBeGreaterThan(1_700_000_000);
  });

  it('parses every review with a valid rating and reviewId', () => {
    const data = reviewsParserV1.parse(json);
    for (const r of data.reviews) {
      expect(r.reviewId.length).toBeGreaterThan(0);
      expect(r.rating).toBeGreaterThanOrEqual(1);
      expect(r.rating).toBeLessThanOrEqual(5);
    }
  });

  it('throws ParserError on non-array JSON', () => {
    expect(() => reviewsParserV1.parse('{"x":1}')).toThrow(ParserError);
  });

  it('throws ParserError on invalid JSON', () => {
    expect(() => reviewsParserV1.parse('not json')).toThrow(ParserError);
  });

  it('throws ParserError on empty input', () => {
    expect(() => reviewsParserV1.parse('')).toThrow(ParserError);
  });

  it('returns an empty review list for an empty envelope', () => {
    const data = reviewsParserV1.parse(JSON.stringify([[''], [], 0]));
    expect(data.reviews).toEqual([]);
    expect(data.textReviewCount).toBe(0);
    expect(data.nextToken).toBeNull();
  });

  it('reads a review with no developer reply as devReply null', () => {
    const envelope = [
      ['tok'],
      [['rid', ['Jane', null], 4, 'ok', [1774000000, 0], [1774000000, 0], 0, null, null, null, null, '1.0.0', null, 'en', 'extid']],
      1,
    ];
    const data = reviewsParserV1.parse(JSON.stringify(envelope));
    expect(data.reviews).toHaveLength(1);
    expect(data.reviews[0].devReply).toBeNull();
    expect(data.reviews[0].text).toBe('ok');
  });
});
