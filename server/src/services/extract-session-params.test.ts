import { describe, it, expect } from 'vitest';
import { extractSessionParams } from './cws-fetcher.js';

describe('extractSessionParams', () => {
  it('extracts all three params from valid CWS HTML', () => {
    const html = `
      <script>window.WIZ_global_data = {"cfb2h":"boq_chrome-webstore_20250320.01_p0","FdrFJe":"123456","SNlM0e":"csrf-token-abc"};</script>
    `;
    const result = extractSessionParams(html);
    expect(result).toEqual({
      bl: 'boq_chrome-webstore_20250320.01_p0',
      sid: '123456',
      at: 'csrf-token-abc',
    });
  });

  it('returns null when build label (cfb2h) is missing', () => {
    const html = `<script>window.WIZ_global_data = {"FdrFJe":"123","SNlM0e":"tok"};</script>`;
    expect(extractSessionParams(html)).toBeNull();
  });

  it('returns empty sid when FdrFJe is missing', () => {
    const html = `"cfb2h":"some-build-label","SNlM0e":"tok"`;
    const result = extractSessionParams(html);
    expect(result).not.toBeNull();
    expect(result!.sid).toBe('');
    expect(result!.bl).toBe('some-build-label');
  });

  it('returns empty at when neither SNlM0e nor S06Grb are present', () => {
    const html = `"cfb2h":"bl123","FdrFJe":"sid999"`;
    const result = extractSessionParams(html);
    expect(result).not.toBeNull();
    expect(result!.at).toBe('');
  });

  it('falls back to S06Grb when SNlM0e is absent', () => {
    const html = `"cfb2h":"bl-val","FdrFJe":"sid-val","S06Grb":"fallback-csrf"`;
    const result = extractSessionParams(html);
    expect(result!.at).toBe('fallback-csrf');
  });

  it('prefers SNlM0e over S06Grb when both present', () => {
    const html = `"cfb2h":"bl","FdrFJe":"sid","SNlM0e":"primary","S06Grb":"fallback"`;
    const result = extractSessionParams(html);
    expect(result!.at).toBe('primary');
  });

  it('returns null for empty string', () => {
    expect(extractSessionParams('')).toBeNull();
  });

  it('returns null for HTML with no WIZ_global_data', () => {
    const html = `<html><body><h1>Not a CWS page</h1></body></html>`;
    expect(extractSessionParams(html)).toBeNull();
  });

  it('handles build labels with special characters', () => {
    const html = `"cfb2h":"boq_chrome-webstore_20250320.01_p0-rc1"`;
    const result = extractSessionParams(html);
    expect(result!.bl).toBe('boq_chrome-webstore_20250320.01_p0-rc1');
  });

  it('handles params embedded deep in large HTML', () => {
    const padding = '<div>'.repeat(1000);
    const html = `${padding}"cfb2h":"deep-bl","FdrFJe":"deep-sid","SNlM0e":"deep-at"${padding}`;
    const result = extractSessionParams(html);
    expect(result).toEqual({ bl: 'deep-bl', sid: 'deep-sid', at: 'deep-at' });
  });
});
