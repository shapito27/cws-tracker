/**
 * Listing quality score calculator (Phase 2.1).
 *
 * Calculates a composite 0-100 quality score for a CWS extension listing
 * based on 9 weighted components. Thresholds are calibrated from real CWS
 * data documented in QUALITY_SCORE_THRESHOLDS.md.
 */

import type { ListingSnapshot } from '../types/index';
import { daysBetween, today } from './dates';

// ---------------------------------------------------------------------------
// Threshold constants (from QUALITY_SCORE_THRESHOLDS.md)
// ---------------------------------------------------------------------------

/** Thresholds for each quality score component. */
export interface QualityThresholds {
  title: {
    minLength: number;
    optimalMin: number;
    optimalMax: number;
    maxLength: number;
  };
  shortDescription: {
    minLength: number;
    optimalMin: number;
    maxLength: number;
  };
  fullDescription: {
    minWords: number;
    optimalMinWords: number;
    optimalMaxWords?: number;
    maxWords?: number;
  };
  screenshots: {
    optimalMin: number;
    optimalMax: number;
  };
  translations: {
    good: number;
    excellent: number;
  };
  rating: {
    excellent: number;
    good: number;
    fair: number;
  };
  reviews: {
    excellent: number;
    good: number;
    fair: number;
  };
  freshness: {
    fresh: number;
    recent: number;
    aging: number;
    stale: number;
  };
  permissionRisk: {
    low: number;
    medium: number;
    high: number;
  };
}

/** Default thresholds calibrated from CWS data analysis. */
export const DEFAULT_THRESHOLDS: QualityThresholds = {
  title: {
    minLength: 10,
    optimalMin: 20,
    optimalMax: 60,
    maxLength: 70,
  },
  shortDescription: {
    minLength: 40,
    optimalMin: 80,
    maxLength: 132,
  },
  fullDescription: {
    minWords: 50,
    optimalMinWords: 150,
    optimalMaxWords: 1000,
    maxWords: 1500,
  },
  screenshots: {
    optimalMin: 3,
    optimalMax: 5,
  },
  translations: {
    good: 10,
    excellent: 20,
  },
  rating: {
    excellent: 4.5,
    good: 4.0,
    fair: 3.5,
  },
  reviews: {
    excellent: 100,
    good: 50,
    fair: 10,
  },
  freshness: {
    fresh: 90,
    recent: 180,
    aging: 270,
    stale: 365,
  },
  permissionRisk: {
    low: 20,
    medium: 50,
    high: 80,
  },
};

// ---------------------------------------------------------------------------
// Major market locales for translation scoring
// ---------------------------------------------------------------------------

const MAJOR_MARKET_LOCALES = new Set([
  'en', 'es', 'pt_BR', 'fr', 'de', 'ja', 'zh_CN', 'zh_TW',
  'ko', 'ru', 'ar', 'hi', 'it', 'nl', 'pl', 'tr',
]);

// ---------------------------------------------------------------------------
// Component weights (must sum to 1.0)
// ---------------------------------------------------------------------------

export const COMPONENT_WEIGHTS = {
  title: 0.15,
  shortDescription: 0.10,
  fullDescription: 0.15,
  visualAssets: 0.15,
  ratingsReviews: 0.10,
  translations: 0.10,
  updateFreshness: 0.10,
  permissions: 0.10,
  developerProfile: 0.05,
} as const;

export type ComponentName = keyof typeof COMPONENT_WEIGHTS;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** Score breakdown for a single component. */
export interface ComponentScore {
  name: ComponentName;
  score: number;
  weight: number;
  weightedScore: number;
}

/** Actionable recommendation for improving a component. */
export interface Recommendation {
  component: ComponentName;
  message: string;
  priority: 'high' | 'medium' | 'low';
}

/** Full quality score result with breakdown. */
export interface QualityScoreResult {
  totalScore: number;
  components: ComponentScore[];
  recommendations: Recommendation[];
}

// ---------------------------------------------------------------------------
// Keyword-aware scoring options
// ---------------------------------------------------------------------------

/** Options for keyword-aware quality scoring. */
export interface KeywordScoreOptions {
  keyword: string;
}

/**
 * Check if text contains the keyword as a whole word (case-insensitive).
 * Returns false for partial word matches (e.g., "tab" does NOT match "table").
 */
export function containsKeyword(text: string, keyword: string): boolean {
  if (!text || !keyword) return false;
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\b${escaped}\\b`, 'i');
  return regex.test(text);
}

/**
 * Score keyword density in text (0-100).
 * - 0 occurrences → 0
 * - 0.5–2.5% density → 100 (optimal)
 * - <0.5% → scales linearly 0–100
 * - 2.5–5% → scales 100→40 (over-optimization)
 * - >5% → 20 (keyword stuffing)
 */
export function scoreKeywordDensity(text: string, keyword: string): number {
  if (!text || !keyword) return 0;

  const words = text.trim().split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return 0;

  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
  const matches = text.match(regex);
  const occurrences = matches ? matches.length : 0;

  if (occurrences === 0) return 0;

  // Keyword may be multi-word, count words in keyword
  const keywordWordCount = keyword.trim().split(/\s+/).length;
  const density = (occurrences * keywordWordCount / words.length) * 100;

  if (density >= 0.5 && density <= 2.5) return 100;
  if (density < 0.5) return Math.round((density / 0.5) * 100);
  if (density <= 5) return Math.round(100 - 60 * ((density - 2.5) / 2.5));
  return 20;
}

// ---------------------------------------------------------------------------
// Individual component scoring functions
// ---------------------------------------------------------------------------

/**
 * Title optimization (15%).
 * Scores based on length being in the optimal range.
 * When keyword is provided: 70% length + 30% keyword presence.
 */
export function scoreTitle(
  title: string,
  thresholds: QualityThresholds,
  keyword?: string
): number {
  const len = title.length;
  const t = thresholds.title;

  let lengthScore: number;
  if (len === 0) {
    lengthScore = 0;
  } else if (len < t.minLength) {
    lengthScore = 20;
  } else if (len >= t.optimalMin && len <= t.optimalMax) {
    lengthScore = 100;
  } else if (len > t.maxLength) {
    lengthScore = 30;
  } else if (len < t.optimalMin) {
    lengthScore = 20 + 80 * ((len - t.minLength) / (t.optimalMin - t.minLength));
  } else {
    lengthScore = 100 - 70 * ((len - t.optimalMax) / (t.maxLength - t.optimalMax));
  }

  if (!keyword) return Math.round(lengthScore);

  const keywordScore = containsKeyword(title, keyword) ? 100 : 0;
  return Math.round(lengthScore * 0.7 + keywordScore * 0.3);
}

/**
 * Short description (10%).
 * Scores based on length utilization of the 132-char limit.
 * When keyword is provided: 70% length + 30% keyword presence.
 */
export function scoreShortDescription(
  shortDescription: string,
  thresholds: QualityThresholds,
  keyword?: string
): number {
  const len = shortDescription.length;
  const t = thresholds.shortDescription;

  let lengthScore: number;
  if (len === 0) {
    lengthScore = 0;
  } else if (len < t.minLength) {
    lengthScore = 20 + 30 * (len / t.minLength);
  } else if (len >= t.optimalMin) {
    lengthScore = 100;
  } else {
    lengthScore = 50 + 50 * ((len - t.minLength) / (t.optimalMin - t.minLength));
  }

  if (!keyword) return Math.round(lengthScore);

  const keywordScore = containsKeyword(shortDescription, keyword) ? 100 : 0;
  return Math.round(lengthScore * 0.7 + keywordScore * 0.3);
}

/**
 * Full description (15%).
 * Scores based on word count and basic structure detection.
 * No upper word limit penalty — once past optimalMinWords, lengthScore = 100.
 * When keyword is provided: 50% length + 25% structure + 25% density.
 */
export function scoreFullDescription(
  fullDescription: string,
  thresholds: QualityThresholds,
  keyword?: string
): number {
  if (fullDescription.length === 0) return 0;

  const words = fullDescription.trim().split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;
  const t = thresholds.fullDescription;

  // Word count scoring — no upper limit penalty
  let lengthScore: number;
  if (wordCount < t.minWords) {
    lengthScore = 20 * (wordCount / t.minWords);
  } else if (wordCount >= t.optimalMinWords) {
    lengthScore = 100;
  } else {
    lengthScore = 20 + 80 * ((wordCount - t.minWords) / (t.optimalMinWords - t.minWords));
  }

  // Structure scoring: detect paragraphs, line breaks, lists
  const paragraphs = fullDescription.split(/\n\s*\n/).filter(p => p.trim().length > 0).length;
  const hasLineBreaks = /\n/.test(fullDescription);
  const hasBulletPoints = /^[\s]*[-*\u2022]/m.test(fullDescription);

  let structureScore = 0;
  if (paragraphs >= 3) structureScore += 50;
  else if (paragraphs >= 2) structureScore += 30;
  else if (hasLineBreaks) structureScore += 15;

  if (hasBulletPoints) structureScore += 30;
  if (wordCount >= t.optimalMinWords) structureScore += 20;

  structureScore = Math.min(structureScore, 100);

  if (!keyword) {
    return Math.round(lengthScore * 0.7 + structureScore * 0.3);
  }

  const densityScore = scoreKeywordDensity(fullDescription, keyword);
  return Math.round(lengthScore * 0.5 + structureScore * 0.25 + densityScore * 0.25);
}

/**
 * Visual assets (15%).
 * Scores based on screenshot count and promo video.
 */
export function scoreVisualAssets(
  screenshotCount: number,
  hasPromoVideo: boolean,
  thresholds: QualityThresholds
): number {
  const t = thresholds.screenshots;

  // Screenshot scoring (80% of component)
  let screenshotScore: number;
  if (screenshotCount === 0) {
    screenshotScore = 0;
  } else if (screenshotCount >= t.optimalMin && screenshotCount <= t.optimalMax) {
    screenshotScore = 100;
  } else if (screenshotCount < t.optimalMin) {
    screenshotScore = 30 + 70 * (screenshotCount / t.optimalMin);
  } else {
    // More than optimalMax is fine, cap at 100
    screenshotScore = 100;
  }

  // Promo video bonus (20% of component)
  const videoScore = hasPromoVideo ? 100 : 0;

  return Math.round(screenshotScore * 0.8 + videoScore * 0.2);
}

/**
 * Ratings & reviews (15%).
 * Combines star rating quality with review quantity.
 */
export function scoreRatingsReviews(
  rating: number | null,
  reviewCount: number,
  thresholds: QualityThresholds
): number {
  const t = thresholds.rating;
  const r = thresholds.reviews;

  // Rating scoring (60% of component)
  let ratingScore: number;
  if (rating === null) {
    ratingScore = 0;
  } else if (rating >= t.excellent) {
    ratingScore = 100;
  } else if (rating >= t.good) {
    ratingScore = 70 + 30 * ((rating - t.good) / (t.excellent - t.good));
  } else if (rating >= t.fair) {
    ratingScore = 40 + 30 * ((rating - t.fair) / (t.good - t.fair));
  } else {
    ratingScore = 40 * (rating / t.fair);
  }

  // Review count scoring (40% of component)
  let reviewScore: number;
  if (reviewCount >= r.excellent) {
    reviewScore = 100;
  } else if (reviewCount >= r.good) {
    reviewScore = 70 + 30 * ((reviewCount - r.good) / (r.excellent - r.good));
  } else if (reviewCount >= r.fair) {
    reviewScore = 40 + 30 * ((reviewCount - r.fair) / (r.good - r.fair));
  } else if (reviewCount > 0) {
    reviewScore = 40 * (reviewCount / r.fair);
  } else {
    reviewScore = 0;
  }

  return Math.round(ratingScore * 0.6 + reviewScore * 0.4);
}

/**
 * Translations (10%).
 * Scores based on number of locales and coverage of major markets.
 */
export function scoreTranslations(
  translationCount: number,
  availableLocales: string[],
  thresholds: QualityThresholds
): number {
  const t = thresholds.translations;

  // Single locale means no translations done - return 0
  if (translationCount <= 1) return 0;

  // Locale count scoring (60% of component)
  let countScore: number;
  if (translationCount >= t.excellent) {
    countScore = 100;
  } else if (translationCount >= t.good) {
    countScore = 70 + 30 * ((translationCount - t.good) / (t.excellent - t.good));
  } else {
    // 2 to good-1
    countScore = 70 * ((translationCount - 1) / (t.good - 1));
  }

  // Major market coverage scoring (40% of component)
  const majorMarketsCovered = availableLocales.filter(
    locale => MAJOR_MARKET_LOCALES.has(locale)
  ).length;
  const majorMarketRatio = majorMarketsCovered / MAJOR_MARKET_LOCALES.size;
  const marketScore = Math.round(majorMarketRatio * 100);

  return Math.round(countScore * 0.6 + marketScore * 0.4);
}

/**
 * Update freshness (10%).
 * Scores based on how recently the extension was updated.
 */
export function scoreUpdateFreshness(
  lastUpdated: string,
  thresholds: QualityThresholds
): number {
  const t = thresholds.freshness;

  // Try to parse the date
  const todayStr = today();
  let daysSinceUpdate: number;
  try {
    daysSinceUpdate = daysBetween(lastUpdated, todayStr);
  } catch {
    return 0;
  }

  // Check for invalid dates that result in NaN
  if (isNaN(daysSinceUpdate)) return 0;

  if (daysSinceUpdate <= t.fresh) return 100;
  if (daysSinceUpdate <= t.recent) {
    return 80 + 20 * ((t.recent - daysSinceUpdate) / (t.recent - t.fresh));
  }
  if (daysSinceUpdate <= t.aging) {
    return 50 + 30 * ((t.aging - daysSinceUpdate) / (t.aging - t.recent));
  }
  if (daysSinceUpdate <= t.stale) {
    return 20 + 30 * ((t.stale - daysSinceUpdate) / (t.stale - t.aging));
  }
  return 0;
}

/**
 * Permissions (5%).
 * Inverse of permission risk score - lower risk = higher quality.
 */
export function scorePermissions(
  permissionRiskScore: number,
  thresholds: QualityThresholds
): number {
  const t = thresholds.permissionRisk;

  if (permissionRiskScore <= t.low) return 100;
  if (permissionRiskScore <= t.medium) {
    return 70 + 30 * ((t.medium - permissionRiskScore) / (t.medium - t.low));
  }
  if (permissionRiskScore <= t.high) {
    return 40 + 30 * ((t.high - permissionRiskScore) / (t.high - t.medium));
  }
  return 0;
}

/**
 * Developer profile (5%).
 * Scores based on verified status and developer name presence.
 */
export function scoreDeveloperProfile(
  developerName: string,
  developerVerified: boolean
): number {
  if (!developerName || developerName.trim().length === 0) return 0;
  if (developerVerified) return 100;
  return 40;
}

// ---------------------------------------------------------------------------
// Recommendation generation
// ---------------------------------------------------------------------------

function generateRecommendations(
  components: ComponentScore[],
  snapshot: ListingSnapshot,
  thresholds: QualityThresholds,
  keyword?: string
): Recommendation[] {
  const recommendations: Recommendation[] = [];

  for (const comp of components) {
    if (comp.score > 80) continue;

    const priority: 'high' | 'medium' | 'low' =
      comp.score < 30 ? 'high' : comp.score < 50 ? 'medium' : 'low';

    switch (comp.name) {
      case 'title': {
        const len = snapshot.title.length;
        const t = thresholds.title;
        if (len === 0) {
          recommendations.push({ component: 'title', message: 'Add a title to your extension listing.', priority });
        } else if (len < t.optimalMin) {
          recommendations.push({ component: 'title', message: `Your title is ${len} characters. Consider expanding to ${t.optimalMin}-${t.optimalMax} characters for better keyword coverage.`, priority });
        } else if (len > t.maxLength) {
          recommendations.push({ component: 'title', message: `Your title is ${len} characters, which may appear keyword-stuffed. Consider trimming to under ${t.maxLength} characters.`, priority });
        }
        break;
      }
      case 'shortDescription': {
        const len = snapshot.shortDescription.length;
        const t = thresholds.shortDescription;
        if (len === 0) {
          recommendations.push({ component: 'shortDescription', message: 'Add a short description to your listing.', priority });
        } else if (len < t.optimalMin) {
          recommendations.push({ component: 'shortDescription', message: `Your short description is ${len}/${t.maxLength} characters. Use more of the available space (aim for ${t.optimalMin}+ characters) to include keywords and a call-to-action.`, priority });
        }
        break;
      }
      case 'fullDescription': {
        const words = snapshot.fullDescription.trim().split(/\s+/).filter(w => w.length > 0);
        const wordCount = words.length;
        const t = thresholds.fullDescription;
        if (wordCount === 0) {
          recommendations.push({ component: 'fullDescription', message: 'Add a detailed description to your listing.', priority });
        } else if (wordCount < t.optimalMinWords) {
          recommendations.push({ component: 'fullDescription', message: `Your description is ${wordCount} words. Consider expanding to ${t.optimalMinWords}+ words with feature details, use cases, and keywords.`, priority });
        }
        const paragraphs = snapshot.fullDescription.split(/\n\s*\n/).filter(p => p.trim().length > 0).length;
        if (paragraphs < 3 && wordCount >= t.minWords) {
          recommendations.push({ component: 'fullDescription', message: 'Structure your description with multiple paragraphs, bullet points, and clear sections for better readability.', priority: 'low' });
        }
        break;
      }
      case 'visualAssets': {
        const t = thresholds.screenshots;
        if (snapshot.screenshotCount === 0) {
          recommendations.push({ component: 'visualAssets', message: `Add screenshots to your listing. Aim for ${t.optimalMin}-${t.optimalMax} screenshots showing key features.`, priority });
        } else if (snapshot.screenshotCount < t.optimalMin) {
          const needed = t.optimalMin - snapshot.screenshotCount;
          recommendations.push({ component: 'visualAssets', message: `Add ${needed} more screenshot${needed > 1 ? 's' : ''} to reach the optimal count of ${t.optimalMin}-${t.optimalMax}.`, priority });
        }
        if (!snapshot.hasPromoVideo) {
          recommendations.push({ component: 'visualAssets', message: 'Consider adding a promotional video to showcase your extension in action.', priority: 'low' });
        }
        break;
      }
      case 'ratingsReviews': {
        if (snapshot.rating === null) {
          recommendations.push({ component: 'ratingsReviews', message: 'Your extension has no ratings yet. Encourage users to leave reviews.', priority });
        } else if (snapshot.rating < thresholds.rating.good) {
          recommendations.push({ component: 'ratingsReviews', message: `Your rating is ${snapshot.rating.toFixed(1)} stars. Focus on fixing user complaints to improve your rating above ${thresholds.rating.good}.`, priority });
        }
        if (snapshot.reviewCount < thresholds.reviews.fair) {
          recommendations.push({ component: 'ratingsReviews', message: `You have ${snapshot.reviewCount} reviews. Aim for at least ${thresholds.reviews.fair} reviews to build credibility.`, priority });
        }
        break;
      }
      case 'translations': {
        if (snapshot.translationCount <= 1) {
          recommendations.push({ component: 'translations', message: `Your extension is only available in 1 locale. Translate to ${thresholds.translations.good}+ locales to reach more users.`, priority });
        } else if (snapshot.translationCount < thresholds.translations.good) {
          const needed = thresholds.translations.good - snapshot.translationCount;
          recommendations.push({ component: 'translations', message: `Add ${needed} more locale${needed > 1 ? 's' : ''} to reach ${thresholds.translations.good} supported locales. Focus on major markets.`, priority });
        }
        break;
      }
      case 'updateFreshness': {
        const todayStr = today();
        let daysSince: number;
        try {
          daysSince = daysBetween(snapshot.lastUpdated, todayStr);
        } catch {
          daysSince = Infinity;
        }
        if (daysSince > thresholds.freshness.recent) {
          recommendations.push({ component: 'updateFreshness', message: `Your extension was last updated ${daysSince} days ago. Regular updates signal active maintenance to users and CWS.`, priority });
        }
        break;
      }
      case 'permissions': {
        if (snapshot.permissionRiskScore > thresholds.permissionRisk.medium) {
          recommendations.push({ component: 'permissions', message: 'Your extension requests high-risk permissions. Consider if all permissions are necessary, as users see install warnings for risky permissions.', priority });
        }
        break;
      }
      case 'developerProfile': {
        if (!snapshot.developerVerified) {
          recommendations.push({ component: 'developerProfile', message: 'Verify your developer account on Chrome Web Store to build trust with users.', priority });
        }
        break;
      }
    }
  }

  // Keyword-specific recommendations
  if (keyword) {
    if (!containsKeyword(snapshot.title, keyword)) {
      recommendations.push({
        component: 'title',
        message: `Your title does not contain the keyword "${keyword}". Including the target keyword in the title is the strongest relevance signal.`,
        priority: 'high',
      });
    }
    if (!containsKeyword(snapshot.shortDescription, keyword)) {
      recommendations.push({
        component: 'shortDescription',
        message: `Your short description does not contain the keyword "${keyword}". Add it to improve keyword relevance.`,
        priority: 'medium',
      });
    }
    const density = scoreKeywordDensity(snapshot.fullDescription, keyword);
    if (density < 50) {
      recommendations.push({
        component: 'fullDescription',
        message: `Low keyword density for "${keyword}" in your full description. Consider adding the keyword naturally 2-4 more times.`,
        priority: 'medium',
      });
    }
  }

  return recommendations;
}

// ---------------------------------------------------------------------------
// Main quality score calculator
// ---------------------------------------------------------------------------

/**
 * Calculate a composite 0-100 quality score for a CWS extension listing.
 *
 * The score is a weighted average of 9 component scores (each 0-100).
 * Components are weighted according to their impact on listing visibility
 * and user trust, as documented in QUALITY_SCORE_THRESHOLDS.md.
 *
 * @param snapshot - The listing snapshot to evaluate
 * @param thresholds - Calibrated thresholds (defaults to DEFAULT_THRESHOLDS)
 * @returns Quality score result with total, component breakdown, and recommendations
 */
export function calculateQualityScore(
  snapshot: ListingSnapshot,
  thresholds: QualityThresholds = DEFAULT_THRESHOLDS,
  keywordOptions?: KeywordScoreOptions
): QualityScoreResult {
  const keyword = keywordOptions?.keyword;

  // Calculate individual component scores
  const rawScores: Record<ComponentName, number> = {
    title: scoreTitle(snapshot.title, thresholds, keyword),
    shortDescription: scoreShortDescription(snapshot.shortDescription, thresholds, keyword),
    fullDescription: scoreFullDescription(snapshot.fullDescription, thresholds, keyword),
    visualAssets: scoreVisualAssets(snapshot.screenshotCount, snapshot.hasPromoVideo, thresholds),
    ratingsReviews: scoreRatingsReviews(snapshot.rating, snapshot.reviewCount, thresholds),
    translations: scoreTranslations(snapshot.translationCount, snapshot.availableLocales, thresholds),
    updateFreshness: scoreUpdateFreshness(snapshot.lastUpdated, thresholds),
    permissions: scorePermissions(snapshot.permissionRiskScore, thresholds),
    developerProfile: scoreDeveloperProfile(snapshot.developerName, snapshot.developerVerified),
  };

  // Build component score objects
  const components: ComponentScore[] = (
    Object.keys(COMPONENT_WEIGHTS) as ComponentName[]
  ).map(name => ({
    name,
    score: Math.round(rawScores[name]),
    weight: COMPONENT_WEIGHTS[name],
    weightedScore: Math.round(rawScores[name] * COMPONENT_WEIGHTS[name] * 100) / 100,
  }));

  // Calculate weighted total
  const totalScore = Math.round(
    components.reduce((sum, c) => sum + c.score * c.weight, 0)
  );

  // Generate recommendations for low-scoring components
  const recommendations = generateRecommendations(components, snapshot, thresholds, keyword);

  return {
    totalScore: Math.min(Math.max(totalScore, 0), 100),
    components,
    recommendations,
  };
}
