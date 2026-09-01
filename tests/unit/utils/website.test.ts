import { describe, it, expect } from 'vitest';
import { websiteDomain, websiteHref } from '../../../src/shared/utils/website';

describe('websiteDomain', () => {
  it('returns a bare domain unchanged', () => {
    // The shape CWS stores for schemeless developer submissions.
    expect(websiteDomain('wizardstool.com')).toBe('wizardstool.com');
  });

  it('extracts the host from a full URL', () => {
    expect(websiteDomain('https://darkreader.org/')).toBe('darkreader.org');
    expect(websiteDomain('http://grammarly.com/')).toBe('grammarly.com');
  });

  it('strips a www. prefix', () => {
    expect(websiteDomain('https://www.joinhoney.com/')).toBe('joinhoney.com');
    expect(websiteDomain('www.example.com')).toBe('example.com');
  });

  it('drops paths, queries and ports', () => {
    expect(websiteDomain('https://example.com:8080/path?a=1#x')).toBe('example.com');
  });

  it('lowercases the host', () => {
    expect(websiteDomain('HTTPS://Example.COM')).toBe('example.com');
  });

  it('keeps subdomains other than www', () => {
    expect(websiteDomain('https://apps.example.co.uk/x')).toBe('apps.example.co.uk');
  });

  it('returns null for empty and missing values', () => {
    expect(websiteDomain(null)).toBeNull();
    expect(websiteDomain(undefined)).toBeNull();
    expect(websiteDomain('')).toBeNull();
    expect(websiteDomain('   ')).toBeNull();
  });

  it('returns null for values without a dotted hostname', () => {
    expect(websiteDomain('n/a')).toBeNull();
    expect(websiteDomain('coming soon')).toBeNull();
    expect(websiteDomain('localhost')).toBeNull();
  });

  it('rejects non-http(s) protocols', () => {
    expect(websiteDomain('javascript:alert(1)')).toBeNull();
    expect(websiteDomain('javascript://evil.com/%0aalert(1)')).toBeNull();
    expect(websiteDomain('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(websiteDomain('mailto:dev@example.com')).toBeNull();
    expect(websiteDomain('ftp://files.example.com')).toBeNull();
  });
});

describe('websiteHref', () => {
  it('adds https to a schemeless value', () => {
    expect(websiteHref('wizardstool.com')).toBe('https://wizardstool.com/');
  });

  it("preserves the developer's own scheme", () => {
    expect(websiteHref('http://grammarly.com/')).toBe('http://grammarly.com/');
  });

  it('preserves www, path and query', () => {
    expect(websiteHref('https://www.joinhoney.com/install?ref=cws')).toBe(
      'https://www.joinhoney.com/install?ref=cws',
    );
  });

  it('returns null for unusable values', () => {
    expect(websiteHref(null)).toBeNull();
    expect(websiteHref('')).toBeNull();
    expect(websiteHref('n/a')).toBeNull();
  });

  it('never returns a script-bearing href', () => {
    expect(websiteHref('javascript:alert(1)')).toBeNull();
    expect(websiteHref('javascript://evil.com/%0aalert(1)')).toBeNull();
    expect(websiteHref('data:text/html,<script>alert(1)</script>')).toBeNull();
  });
});
