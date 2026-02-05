/**
 * Tests for permission risk scoring utilities (Phase 1.5.1).
 */

import { describe, it, expect } from 'vitest';
import {
  calculatePermissionRiskScore,
  getPermissionWarning,
  categorizePermissions,
} from '../../../src/shared/utils/permissions';

// ---------------------------------------------------------------------------
// calculatePermissionRiskScore
// ---------------------------------------------------------------------------

describe('calculatePermissionRiskScore()', () => {
  it('returns 0 for no permissions', () => {
    expect(calculatePermissionRiskScore([], [])).toBe(0);
  });

  it('returns 0 for only storage and alarms (zero-weight)', () => {
    expect(calculatePermissionRiskScore(['storage', 'alarms'], [])).toBe(0);
  });

  it('includes weight 30 for <all_urls> in permissions', () => {
    const score = calculatePermissionRiskScore(['<all_urls>'], []);
    expect(score).toBe(30);
  });

  it('scores tabs + history additively (20 + 25 = 45)', () => {
    const score = calculatePermissionRiskScore(['tabs', 'history'], []);
    expect(score).toBe(45);
  });

  it('clamps score to 100 maximum', () => {
    // <all_urls>(30) + history(25) + tabs(20) + bookmarks(15) + webRequest(15) + cookies(15) = 120 → clamped to 100
    const score = calculatePermissionRiskScore(
      ['<all_urls>', 'history', 'tabs', 'bookmarks', 'webRequest', 'cookies'],
      []
    );
    expect(score).toBe(100);
  });

  it('treats broad host permission *://*/* same as <all_urls> (weight 30)', () => {
    const score = calculatePermissionRiskScore([], ['*://*/*']);
    expect(score).toBe(30);
  });

  it('treats https://*/* as broad host permission (weight 30)', () => {
    const score = calculatePermissionRiskScore([], ['https://*/*']);
    expect(score).toBe(30);
  });

  it('treats http://*/* as broad host permission (weight 30)', () => {
    const score = calculatePermissionRiskScore([], ['http://*/*']);
    expect(score).toBe(30);
  });

  it('assigns low weight (5) for narrow host permission', () => {
    const score = calculatePermissionRiskScore([], ['https://example.com/*']);
    expect(score).toBe(5);
  });

  it('sums multiple narrow host permissions', () => {
    const score = calculatePermissionRiskScore(
      [],
      ['https://example.com/*', 'https://api.example.com/*']
    );
    expect(score).toBe(10);
  });

  it('combines permission weights and host permission weights', () => {
    // tabs(20) + narrow host(5) = 25
    const score = calculatePermissionRiskScore(
      ['tabs'],
      ['https://example.com/*']
    );
    expect(score).toBe(25);
  });

  it('returns 0 for unknown permissions (does not crash)', () => {
    const score = calculatePermissionRiskScore(
      ['someUnknownPermission', 'anotherUnknown'],
      []
    );
    expect(score).toBe(0);
  });

  it('handles mix of known, unknown, and host permissions', () => {
    // tabs(20) + unknownPerm(0) + narrow host(5) = 25
    const score = calculatePermissionRiskScore(
      ['tabs', 'unknownPerm'],
      ['https://example.com/*']
    );
    expect(score).toBe(25);
  });

  it('scores zero-weight permissions correctly alongside weighted ones', () => {
    // storage(0) + alarms(0) + notifications(0) + activeTab(5) = 5
    const score = calculatePermissionRiskScore(
      ['storage', 'alarms', 'notifications', 'activeTab'],
      []
    );
    expect(score).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// getPermissionWarning
// ---------------------------------------------------------------------------

describe('getPermissionWarning()', () => {
  it('returns warning text for <all_urls>', () => {
    expect(getPermissionWarning('<all_urls>')).toBe(
      'Read and change all your data on all websites'
    );
  });

  it('returns warning text for tabs', () => {
    expect(getPermissionWarning('tabs')).toBe('Read your browsing history');
  });

  it('returns warning text for history', () => {
    expect(getPermissionWarning('history')).toBe('Read your browsing history');
  });

  it('returns warning text for bookmarks', () => {
    expect(getPermissionWarning('bookmarks')).toBe(
      'Read and change your bookmarks'
    );
  });

  it('returns warning text for webRequest', () => {
    expect(getPermissionWarning('webRequest')).toBe(
      'Observe and intercept network requests'
    );
  });

  it('returns warning text for cookies', () => {
    expect(getPermissionWarning('cookies')).toBe('Read cookies for all sites');
  });

  it('returns warning text for activeTab', () => {
    expect(getPermissionWarning('activeTab')).toBe(
      'Access current tab on click'
    );
  });

  it('returns null for storage (no warning)', () => {
    expect(getPermissionWarning('storage')).toBeNull();
  });

  it('returns null for unknown permissions', () => {
    expect(getPermissionWarning('someUnknownPermission')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// categorizePermissions
// ---------------------------------------------------------------------------

describe('categorizePermissions()', () => {
  it('returns empty categories for empty array', () => {
    const result = categorizePermissions([]);
    expect(result).toEqual({ high: [], medium: [], low: [], none: [] });
  });

  it('categorizes high-risk permissions (weight >= 20)', () => {
    const result = categorizePermissions(['<all_urls>', 'history', 'tabs']);
    expect(result.high).toEqual(['<all_urls>', 'history', 'tabs']);
    expect(result.medium).toEqual([]);
    expect(result.low).toEqual([]);
    expect(result.none).toEqual([]);
  });

  it('categorizes medium-risk permissions (weight 10-19)', () => {
    const result = categorizePermissions(['bookmarks', 'webRequest', 'cookies']);
    expect(result.medium).toEqual(['bookmarks', 'webRequest', 'cookies']);
    expect(result.high).toEqual([]);
  });

  it('categorizes low-risk permissions (weight 1-9)', () => {
    const result = categorizePermissions(['activeTab']);
    expect(result.low).toEqual(['activeTab']);
  });

  it('categorizes no-risk permissions (weight 0)', () => {
    const result = categorizePermissions(['storage', 'alarms', 'notifications']);
    expect(result.none).toEqual(['storage', 'alarms', 'notifications']);
  });

  it('puts unknown permissions in none category', () => {
    const result = categorizePermissions(['unknownPerm']);
    expect(result.none).toEqual(['unknownPerm']);
  });

  it('correctly groups a mix of all risk levels', () => {
    const result = categorizePermissions([
      'history',      // high (25)
      'tabs',         // high (20)
      'bookmarks',    // medium (15)
      'cookies',      // medium (15)
      'activeTab',    // low (5)
      'storage',      // none (0)
      'unknownPerm',  // none (unknown)
    ]);
    expect(result.high).toEqual(['history', 'tabs']);
    expect(result.medium).toEqual(['bookmarks', 'cookies']);
    expect(result.low).toEqual(['activeTab']);
    expect(result.none).toEqual(['storage', 'unknownPerm']);
  });
});
