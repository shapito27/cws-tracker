export type Plan = 'free' | 'pro';

export const TIER_LIMITS = {
  free: {
    maxProjects: 1,
    maxExtensionsPerProject: 3,
    maxKeywordsPerProject: 5,
    dataRetentionDays: 14,
  },
  pro: {
    maxProjects: Infinity,
    maxExtensionsPerProject: Infinity,
    maxKeywordsPerProject: Infinity,
    dataRetentionDays: Infinity,
  },
} as const;

export function canCreateProject(currentCount: number, plan: Plan): boolean {
  return currentCount < TIER_LIMITS[plan].maxProjects;
}

export function canAddExtension(currentCount: number, plan: Plan): boolean {
  return currentCount < TIER_LIMITS[plan].maxExtensionsPerProject;
}

export function canAddKeyword(currentCount: number, plan: Plan): boolean {
  return currentCount < TIER_LIMITS[plan].maxKeywordsPerProject;
}
