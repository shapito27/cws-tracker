import { describe, it, expect } from 'vitest';
import { canCreateProject, canAddExtension, canAddKeyword, TIER_LIMITS } from '@/shared/utils/tier-gates';

describe('tier-gates', () => {
  describe('TIER_LIMITS', () => {
    it('defines free tier limits', () => {
      expect(TIER_LIMITS.free.maxProjects).toBe(1);
      expect(TIER_LIMITS.free.maxExtensionsPerProject).toBe(3);
      expect(TIER_LIMITS.free.maxKeywordsPerProject).toBe(5);
      expect(TIER_LIMITS.free.dataRetentionDays).toBe(14);
    });

    it('defines pro tier as unlimited', () => {
      expect(TIER_LIMITS.pro.maxProjects).toBe(Infinity);
      expect(TIER_LIMITS.pro.maxExtensionsPerProject).toBe(Infinity);
      expect(TIER_LIMITS.pro.maxKeywordsPerProject).toBe(Infinity);
      expect(TIER_LIMITS.pro.dataRetentionDays).toBe(Infinity);
    });
  });

  describe('canCreateProject', () => {
    it('allows free user to create first project', () => {
      expect(canCreateProject(0, 'free')).toBe(true);
    });

    it('blocks free user from creating second project', () => {
      expect(canCreateProject(1, 'free')).toBe(false);
    });

    it('blocks free user at higher counts', () => {
      expect(canCreateProject(5, 'free')).toBe(false);
    });

    it('allows pro user to create any number of projects', () => {
      expect(canCreateProject(0, 'pro')).toBe(true);
      expect(canCreateProject(10, 'pro')).toBe(true);
      expect(canCreateProject(100, 'pro')).toBe(true);
    });
  });

  describe('canAddExtension', () => {
    it('allows free user up to 3 extensions', () => {
      expect(canAddExtension(0, 'free')).toBe(true);
      expect(canAddExtension(1, 'free')).toBe(true);
      expect(canAddExtension(2, 'free')).toBe(true);
    });

    it('blocks free user at 3 extensions', () => {
      expect(canAddExtension(3, 'free')).toBe(false);
    });

    it('blocks free user above limit', () => {
      expect(canAddExtension(5, 'free')).toBe(false);
    });

    it('allows pro user unlimited extensions', () => {
      expect(canAddExtension(0, 'pro')).toBe(true);
      expect(canAddExtension(50, 'pro')).toBe(true);
    });
  });

  describe('canAddKeyword', () => {
    it('allows free user up to 5 keywords', () => {
      expect(canAddKeyword(0, 'free')).toBe(true);
      expect(canAddKeyword(4, 'free')).toBe(true);
    });

    it('blocks free user at 5 keywords', () => {
      expect(canAddKeyword(5, 'free')).toBe(false);
    });

    it('blocks free user above limit', () => {
      expect(canAddKeyword(10, 'free')).toBe(false);
    });

    it('allows pro user unlimited keywords', () => {
      expect(canAddKeyword(0, 'pro')).toBe(true);
      expect(canAddKeyword(100, 'pro')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles zero count for all functions', () => {
      expect(canCreateProject(0, 'free')).toBe(true);
      expect(canAddExtension(0, 'free')).toBe(true);
      expect(canAddKeyword(0, 'free')).toBe(true);
    });

    it('handles negative count gracefully', () => {
      expect(canCreateProject(-1, 'free')).toBe(true);
      expect(canAddExtension(-1, 'free')).toBe(true);
      expect(canAddKeyword(-1, 'free')).toBe(true);
    });
  });
});
