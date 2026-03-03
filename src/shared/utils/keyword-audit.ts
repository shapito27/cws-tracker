/**
 * Keyword audit - "Why Is Competitor Higher?" (Phase 3.2).
 *
 * Builds a structured prompt for GPT-4o to analyze why a competitor
 * outranks the user's extension for a given keyword, then parses
 * the AI response into a structured audit result.
 */

import type { ListingSnapshot, RankSnapshot, AutocompleteSnapshot, EventRecord, AuditPromptVariant } from '../types';
import { OpenAIClient } from './openai';
import type { ChatMessage } from './openai';
import { calculateQualityScore } from './quality-score';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Historical time-series data for enriched audit prompts. */
export interface AuditHistoricalContext {
  /** Rank snapshots for the selected keyword & own extension (sorted by date). */
  ownRankHistory: RankSnapshot[];
  /** Rank snapshots for the selected keyword & competitor (sorted by date). */
  compRankHistory: RankSnapshot[];
  /** Autocomplete snapshots for the selected keyword & own extension (sorted by date). */
  ownAutocompleteHistory: AutocompleteSnapshot[];
  /** Autocomplete snapshots for the selected keyword & competitor (sorted by date). */
  compAutocompleteHistory: AutocompleteSnapshot[];
  /** Events for own extension (sorted by date). */
  ownEvents: EventRecord[];
  /** Events for competitor extension (sorted by date). */
  compEvents: EventRecord[];
}

/** Position context for an additional (non-primary) keyword. */
export interface AdditionalKeywordContext {
  keyword: string;
  ownPosition: number | null;
  competitorPosition: number | null;
}

export interface AuditInput {
  keyword: string;
  ownListing: ListingSnapshot;
  competitorListing: ListingSnapshot;
  ownPosition: number | null;
  competitorPosition: number | null;
  /** Optional 7-day historical context. */
  history7d?: AuditHistoricalContext;
  /** Optional 14-day historical context. */
  history14d?: AuditHistoricalContext;
  /** Additional keywords with position context (non-primary). */
  additionalKeywords?: AdditionalKeywordContext[];
}

export interface AuditRecommendation {
  area: string;
  suggestion: string;
  priority: 'high' | 'medium' | 'low';
  impact?: string;
}

export interface AuditResult {
  keyword: string;
  ownExtensionId: string;
  competitorExtensionId: string;
  relevanceAnalysis: string;
  metricComparison: string;
  trendAnalysis: string;
  recommendations: AuditRecommendation[];
  rawResponse: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  createdAt: string;
  /** Additional keywords included in the audit (if multi-keyword). */
  additionalKeywords?: string[];
}

/** Cached audit result stored in IndexedDB. */
export interface CachedAuditResult extends AuditResult {
  id?: number;
  /** Cache key: hash of keyword + ownExtensionId + competitorExtensionId + date. */
  cacheKey: string;
}

/** Optional custom prompts from Settings. */
export interface CustomAuditPrompts {
  systemPrompt?: string;
  userPromptTemplate?: string;
  variant?: AuditPromptVariant;
}

// ---------------------------------------------------------------------------
// Default prompts
// ---------------------------------------------------------------------------

export const DEFAULT_AUDIT_SYSTEM_PROMPT = `You are a Chrome Web Store ASO (App Store Optimization) analyst specializing in keyword ranking diagnostics.

## Your Domain Knowledge
CWS search ranking is influenced by these factors (approximate weight order):
1. Keyword relevance — exact match in title > short description > full description
2. User base size and growth trajectory
3. Rating score and volume (both matter)
4. Update recency and frequency
5. Listing completeness — screenshots, localization count, promo video
6. Permission scope — fewer permissions = higher trust signal
7. Install retention and engagement (not directly visible in listing data)

## Your Task
Analyze why a competitor extension outranks the user's extension for a specific keyword (or set of keywords). Follow this reasoning process:

1. **Text relevance**: Compare how each listing's title, short description, and full description align with the keyword(s). Note exact-match vs partial-match placement.
2. **Metric gaps**: Identify the most impactful metric differences (users, ratings, quality score, etc.). Cite specific numbers from the data.
3. **Trend analysis**: If historical ranking/autocomplete data is provided, identify trajectory (improving, declining, stable) and correlate rank shifts with events (version updates, description changes, user milestones).
4. **Actionable recommendations**: Provide specific, implementable changes. Each recommendation should explain the expected impact.

## Output Format
Respond with valid JSON only (no markdown fences, no commentary outside JSON):
{
  "relevanceAnalysis": "2-3 paragraphs analyzing keyword alignment for both listings. Cite specific text from titles/descriptions.",
  "metricComparison": "2-3 paragraphs comparing metrics with specific numbers. Highlight the largest gaps.",
  "trendAnalysis": "1-2 paragraphs on ranking trajectory and correlation with events. Write 'No historical data provided.' if no trend data was given.",
  "recommendations": [
    {
      "area": "Category (e.g., Title, Description, Screenshots, Ratings, Localization, Permissions, Updates)",
      "suggestion": "Specific actionable change — not generic advice",
      "priority": "high|medium|low",
      "impact": "Expected outcome if implemented (e.g., 'Could improve keyword match score and move from #8 to top 5')"
    }
  ]
}

Provide 3-6 recommendations sorted by priority (high first). Every suggestion must reference actual data from the input — never give advice that could apply to any extension generically.`;

export const DEFAULT_AUDIT_USER_PROMPT_TEMPLATE = `Analyze why the competitor extension ranks higher for the keyword "{{keyword}}".

{{keywordPositions}}

## Your Extension
- **Title**: {{ownTitle}}
- **Position**: {{ownPosition}}
- **Short Description**: {{ownShortDescription}}
- **Full Description**:
<full-description>
{{ownFullDescription}}
</full-description>
- **Rating**: {{ownRating}}
- **Users**: {{ownUsers}}
- **Version**: {{ownVersion}}
- **Screenshots**: {{ownScreenshots}}
- **Translations**: {{ownTranslations}}
- **Quality Score**: {{ownQualityScore}}
- **Permission Risk**: {{ownPermissionRisk}}

## Competitor Extension
- **Title**: {{compTitle}}
- **Position**: {{compPosition}}
- **Short Description**: {{compShortDescription}}
- **Full Description**:
<full-description>
{{compFullDescription}}
</full-description>
- **Rating**: {{compRating}}
- **Users**: {{compUsers}}
- **Version**: {{compVersion}}
- **Screenshots**: {{compScreenshots}}
- **Translations**: {{compTranslations}}
- **Quality Score**: {{compQualityScore}}
- **Permission Risk**: {{compPermissionRisk}}

## Ranking Trends (last 14 days)
Your search rank: {{ownRankHistory14d}}
Competitor search rank: {{compRankHistory14d}}
Your autocomplete position: {{ownAutocomplete14d}}
Competitor autocomplete position: {{compAutocomplete14d}}

## Recent Changes & Events (last 14 days)
Your extension: {{ownEvents14d}}
Competitor: {{compEvents14d}}`;

// ---------------------------------------------------------------------------
// Variant B: Chain-of-Thought + Few-Shot
// ---------------------------------------------------------------------------

export const VARIANT_COT_SYSTEM_PROMPT = `You are a Chrome Web Store ASO (App Store Optimization) analyst specializing in keyword ranking diagnostics.

## Your Domain Knowledge
CWS search ranking is influenced by these factors (estimated weight):
1. **Keyword relevance (35-40%)** — exact match in title (strongest), short description, full description. Position and density matter.
2. **User base & growth (20-25%)** — total installs and recent growth trajectory signal product-market fit.
3. **Rating quality (15-20%)** — composite of average rating AND total rating volume. A 4.7 with 2,500 ratings outweighs a 4.9 with 50 ratings.
4. **Update recency (5-10%)** — extensions updated within the last 30 days receive a freshness boost.
5. **Listing completeness (5-10%)** — screenshot count, localization breadth, promo video presence.
6. **Permission scope (3-5%)** — fewer permissions = higher trust signal. High-risk permissions penalize ranking.
7. **Install retention (unmeasurable)** — not directly visible in listing data but influences ranking over time.

## Your Task
Analyze why a competitor extension outranks the user's extension for a specific keyword (or set of keywords). Use the scratchpad to reason step-by-step before giving your final analysis.

## Output Format
Respond with valid JSON only (no markdown fences, no commentary outside JSON):
{
  "scratchpad": "Your private reasoning: step through each ranking factor, note which favors whom and by how much. Calculate gaps. This field is for your working notes — be thorough.",
  "relevanceAnalysis": "2-3 paragraphs analyzing keyword alignment for both listings. Cite specific text from titles/descriptions.",
  "metricComparison": "2-3 paragraphs comparing metrics with specific numbers. Highlight the largest gaps.",
  "trendAnalysis": "1-2 paragraphs on ranking trajectory and correlation with events. Write 'No historical data provided.' if no trend data was given.",
  "recommendations": [
    {
      "area": "Category (e.g., Title, Description, Screenshots, Ratings, Localization, Permissions, Updates)",
      "suggestion": "Specific actionable change — not generic advice",
      "priority": "high|medium|low",
      "impact": "Expected outcome if implemented (e.g., 'Could improve keyword match score and move from #8 to top 5')"
    }
  ]
}

Provide 3-6 recommendations sorted by priority (high first). Every suggestion must reference actual data from the input.

## Few-Shot Example
Input summary: "Tab Sorter" (#7) vs "Smart Tab Manager" (#2) for keyword "tab manager"
Example output:
{
  "scratchpad": "Keyword 'tab manager': competitor has exact match in title ('Smart Tab Manager'), user has partial match ('Tab Sorter'). Users: 500K vs 12K — 41x gap, huge signal. Rating: 4.6/5 (3,200) vs 4.3/5 (89) — competitor wins on both score and volume. Screenshots: 5 vs 2. Translations: 18 vs 3. Competitor updated 5 days ago vs user 45 days ago. Biggest levers: title keyword match, user base gap, update frequency.",
  "relevanceAnalysis": "The competitor 'Smart Tab Manager' contains an exact match for 'tab manager' in its title, which is the strongest keyword relevance signal in CWS search. The user's extension 'Tab Sorter' only contains 'Tab' — missing 'manager' entirely. In the short descriptions, the competitor mentions 'manage your tabs' (semantic match), while the user focuses on 'sorting tabs by URL'. The competitor's full description uses 'tab manager' and variants 8 times vs 2 times in the user's description.",
  "metricComparison": "The most significant gap is the user base: 500,000+ vs 12,000+ users (41x difference). This alone is likely the primary ranking factor. Rating quality also favors the competitor: 4.6/5 with 3,200 ratings vs 4.3/5 with 89 ratings. The competitor has 5 screenshots vs 2, and 18 localizations vs 3.",
  "trendAnalysis": "No historical data provided.",
  "recommendations": [
    {"area": "Title", "suggestion": "Rename to 'Tab Sorter & Manager' to include exact keyword match for 'tab manager'", "priority": "high", "impact": "Title keyword match is the strongest relevance signal — could improve from #7 to #4-5"},
    {"area": "Description", "suggestion": "Add 'tab manager' phrase 3-4 more times naturally in the full description, especially in the first paragraph", "priority": "high", "impact": "Better keyword density in description reinforces title match"},
    {"area": "Updates", "suggestion": "Publish an update — current version is 45 days old vs competitor's 5 days", "priority": "medium", "impact": "Freshness boost from recent update could improve position by 1-2 spots"},
    {"area": "Screenshots", "suggestion": "Add 3 more screenshots showing key features", "priority": "medium", "impact": "Improves listing quality score and conversion rate"},
    {"area": "Localization", "suggestion": "Add at least 10 more locale translations (es, fr, de, ja, ko, zh_CN, pt_BR, ru, it, nl)", "priority": "low", "impact": "Broader locale coverage improves listing completeness signal"}
  ]
}`;

export const VARIANT_COT_USER_PROMPT_TEMPLATE = `Analyze why the competitor extension ranks higher for the keyword "{{keyword}}".

{{keywordPositions}}

## Positions & Trends
Your position: {{ownPosition}} | Competitor position: {{compPosition}}

### Ranking Trends (last 14 days)
Your search rank: {{ownRankHistory14d}}
Competitor search rank: {{compRankHistory14d}}
Your autocomplete position: {{ownAutocomplete14d}}
Competitor autocomplete position: {{compAutocomplete14d}}

### Recent Changes & Events (last 14 days)
Your extension: {{ownEvents14d}}
Competitor: {{compEvents14d}}

## Metrics Comparison
| Metric | Your Extension | Competitor |
|--------|----------------|------------|
| Users | {{ownUsers}} | {{compUsers}} |
| Rating | {{ownRating}} | {{compRating}} |
| Version | {{ownVersion}} | {{compVersion}} |
| Screenshots | {{ownScreenshots}} | {{compScreenshots}} |
| Translations | {{ownTranslations}} | {{compTranslations}} |
| Quality Score | {{ownQualityScore}} | {{compQualityScore}} |
| Permission Risk | {{ownPermissionRisk}} | {{compPermissionRisk}} |

## Listing Text
### Your Extension: {{ownTitle}}
- **Short Description**: {{ownShortDescription}}
- **Full Description**:
<full-description>
{{ownFullDescription}}
</full-description>

### Competitor: {{compTitle}}
- **Short Description**: {{compShortDescription}}
- **Full Description**:
<full-description>
{{compFullDescription}}
</full-description>`;

// ---------------------------------------------------------------------------
// Variant A: Rubric-Scored + Pre-Computed Deltas
// ---------------------------------------------------------------------------

export const VARIANT_RUBRIC_SYSTEM_PROMPT = `You are a Chrome Web Store ASO (App Store Optimization) analyst specializing in keyword ranking diagnostics.

## Your Domain Knowledge
CWS search ranking is determined by multiple factors. You will score each factor on a 1-5 scale for both extensions.

## Scoring Rubric
Score each factor from 1 (very weak) to 5 (very strong) for BOTH extensions:

1. **Keyword Relevance (Weight: 35%)**
   - 5: Exact keyword match in title + prominent in short & full description
   - 4: Exact match in title OR strong presence in short description
   - 3: Partial match in title, keyword present in descriptions
   - 2: Keyword only in full description, not in title or short description
   - 1: No meaningful keyword presence

2. **User Base & Growth (Weight: 25%)**
   - 5: 1M+ users
   - 4: 100K-999K users
   - 3: 10K-99K users
   - 2: 1K-9K users
   - 1: Under 1K users

3. **Rating Quality (Weight: 15%)**
   - 5: 4.5+ rating with 1,000+ reviews
   - 4: 4.0+ rating with 500+ reviews, OR 4.5+ with 100+ reviews
   - 3: 4.0+ rating with 100+ reviews
   - 2: 3.5+ rating OR fewer than 100 reviews
   - 1: Below 3.5 OR no ratings

4. **Update Recency (Weight: 10%)**
   - 5: Updated within last 7 days
   - 4: Updated within last 30 days
   - 3: Updated within last 90 days
   - 2: Updated within last 180 days
   - 1: Not updated in 180+ days

5. **Listing Completeness (Weight: 10%)**
   - 5: 5+ screenshots, 15+ locales, promo video
   - 4: 4+ screenshots, 10+ locales
   - 3: 3+ screenshots, 5+ locales
   - 2: 1-2 screenshots, few locales
   - 1: No screenshots or very minimal listing

6. **Permission Scope (Weight: 5%)**
   - 5: Risk score 0-10 (minimal permissions)
   - 4: Risk score 11-25
   - 3: Risk score 26-50
   - 2: Risk score 51-75
   - 1: Risk score 76-100 (very broad permissions)

## Your Task
1. Score each factor for both extensions using the rubric above.
2. Compute weighted totals.
3. Analyze the biggest factor gaps to explain the ranking difference.
4. Provide targeted recommendations for the areas with the largest gaps.

## Output Format
Respond with valid JSON only (no markdown fences, no commentary outside JSON):
{
  "relevanceAnalysis": "2-3 paragraphs analyzing keyword alignment. Reference the keyword occurrence counts from the input data and cite specific text.",
  "metricComparison": "2-3 paragraphs comparing metrics. Include your rubric scores for each factor (e.g., 'User Base: own=3, competitor=5'). Highlight the factors with the largest score gaps.",
  "trendAnalysis": "1-2 paragraphs on ranking trajectory and correlation with events. Write 'No historical data provided.' if no trend data was given.",
  "recommendations": [
    {
      "area": "Must match a rubric factor name: Keyword Relevance | User Base & Growth | Rating Quality | Update Recency | Listing Completeness | Permission Scope",
      "suggestion": "Specific actionable change tied to improving the rubric score for this factor",
      "priority": "high|medium|low",
      "impact": "Expected rubric score change and ranking impact (e.g., 'Would raise Keyword Relevance from 2 to 4, estimated +2-3 positions')"
    }
  ]
}

Provide 3-6 recommendations sorted by priority (high first). Focus on factors with the largest score gaps — those offer the biggest ranking improvement opportunity.`;

export const VARIANT_RUBRIC_USER_PROMPT_TEMPLATE = `Analyze why the competitor extension ranks higher for the keyword "{{keyword}}".

{{keywordPositions}}

## Pre-Computed Comparison Summary
| Metric | Your Extension | Competitor | Delta |
|--------|----------------|------------|-------|
| Position | {{ownPosition}} | {{compPosition}} | {{positionGap}} |
| Users | {{ownUsers}} | {{compUsers}} | {{userRatio}} |
| Rating | {{ownRating}} | {{compRating}} | {{ratingDelta}} |
| Reviews | {{ownReviewCount}} | {{compReviewCount}} | {{reviewRatio}} |
| Quality Score | {{ownQualityScore}} | {{compQualityScore}} | {{qualityDelta}} |
| Screenshots | {{ownScreenshots}} | {{compScreenshots}} | {{screenshotDelta}} |
| Translations | {{ownTranslations}} | {{compTranslations}} | {{translationDelta}} |
| Permission Risk | {{ownPermissionRisk}} | {{compPermissionRisk}} | {{permissionDelta}} |

## Keyword Occurrence Analysis
| Location | Your Extension | Competitor |
|----------|----------------|------------|
| Title | {{ownKeywordInTitle}} matches | {{compKeywordInTitle}} matches |
| Short Description | {{ownKeywordInShortDesc}} matches | {{compKeywordInShortDesc}} matches |
| Full Description | {{ownKeywordInFullDesc}} matches | {{compKeywordInFullDesc}} matches |

## Ranking Trends (last 14 days)
Your search rank: {{ownRankHistory14d}}
Competitor search rank: {{compRankHistory14d}}
Your autocomplete position: {{ownAutocomplete14d}}
Competitor autocomplete position: {{compAutocomplete14d}}

## Recent Changes & Events (last 14 days)
Your extension: {{ownEvents14d}}
Competitor: {{compEvents14d}}

## Listing Details
### Your Extension: {{ownTitle}}
- **Version**: {{ownVersion}}
- **Short Description**: {{ownShortDescription}}
- **Full Description**:
<full-description>
{{ownFullDescription}}
</full-description>

### Competitor: {{compTitle}}
- **Version**: {{compVersion}}
- **Short Description**: {{compShortDescription}}
- **Full Description**:
<full-description>
{{compFullDescription}}
</full-description>`;

// ---------------------------------------------------------------------------
// Variant configuration
// ---------------------------------------------------------------------------

/** Model parameters per variant. */
export const VARIANT_CONFIG: Record<AuditPromptVariant, {
  temperature: number;
  maxTokens: number;
  estimatedOutputTokens: number;
}> = {
  default: { temperature: 0.7, maxTokens: 2048, estimatedOutputTokens: 900 },
  cot: { temperature: 0.4, maxTokens: 3072, estimatedOutputTokens: 1200 },
  rubric: { temperature: 0.3, maxTokens: 2048, estimatedOutputTokens: 900 },
};

// ---------------------------------------------------------------------------
// Placeholder system
// ---------------------------------------------------------------------------

/** All available placeholder keys with human-readable descriptions. */
export const AUDIT_PLACEHOLDERS: Record<string, string> = {
  keyword: 'The search keyword being analyzed',
  ownTitle: 'Your extension title',
  ownPosition: 'Your ranking position (e.g. "#3" or "Not in top 30")',
  ownShortDescription: 'Your short description',
  ownFullDescription: 'Your full description',
  ownRating: 'Your rating (e.g. "4.5/5 (200 ratings)")',
  ownUsers: 'Your user count (e.g. "10,000+ (10000)")',
  ownVersion: 'Your extension version',
  ownScreenshots: 'Your screenshot count',
  ownTranslations: 'Your translation locale count',
  ownQualityScore: 'Your listing quality score',
  ownPermissionRisk: 'Your permission risk score (0-100)',
  compTitle: 'Competitor extension title',
  compPosition: 'Competitor ranking position',
  compShortDescription: 'Competitor short description',
  compFullDescription: 'Competitor full description',
  compRating: 'Competitor rating',
  compUsers: 'Competitor user count',
  compVersion: 'Competitor version',
  compScreenshots: 'Competitor screenshot count',
  compTranslations: 'Competitor translation locale count',
  compQualityScore: 'Competitor quality score',
  compPermissionRisk: 'Competitor permission risk score (0-100)',
  ownReviewCount: 'Your review/rating count (e.g. "150")',
  compReviewCount: 'Competitor review/rating count (e.g. "2500")',

  // Multi-keyword context
  keywords: 'Comma-separated list of all analyzed keywords',
  keywordPositions: 'Markdown table of all keywords with positions for both extensions',

  // Historical: Search rank history (selected keyword)
  ownRankHistory7d: 'Your search rank for selected keyword, last 7 days (date | position)',
  ownRankHistory14d: 'Your search rank for selected keyword, last 14 days (date | position)',
  compRankHistory7d: 'Competitor search rank for selected keyword, last 7 days (date | position)',
  compRankHistory14d: 'Competitor search rank for selected keyword, last 14 days (date | position)',

  // Historical: Autocomplete position history (selected keyword)
  ownAutocomplete7d: 'Your autocomplete position for selected keyword, last 7 days (date | position)',
  ownAutocomplete14d: 'Your autocomplete position for selected keyword, last 14 days (date | position)',
  compAutocomplete7d: 'Competitor autocomplete position for selected keyword, last 7 days (date | position)',
  compAutocomplete14d: 'Competitor autocomplete position for selected keyword, last 14 days (date | position)',

  // Historical: Events
  ownEvents7d: 'Your extension events/changes, last 7 days (date | event | details)',
  ownEvents14d: 'Your extension events/changes, last 14 days (date | event | details)',
  compEvents7d: 'Competitor events/changes, last 7 days (date | event | details)',
  compEvents14d: 'Competitor events/changes, last 14 days (date | event | details)',

  // Pre-computed deltas (Rubric variant)
  positionGap: 'Position gap with direction (e.g. "6 positions behind", "3 positions ahead")',
  userRatio: 'Competitor-to-own user ratio (e.g. "20x more")',
  ratingDelta: 'Rating difference (e.g. "+0.5")',
  reviewRatio: 'Review count ratio (e.g. "16.7x more")',
  qualityDelta: 'Quality score difference (e.g. "+17")',
  screenshotDelta: 'Screenshot count difference (e.g. "+2")',
  translationDelta: 'Translation count difference (e.g. "+15")',
  permissionDelta: 'Permission risk difference (e.g. "-5 (lower risk)")',

  // Keyword occurrence counts (Rubric variant)
  ownKeywordInTitle: 'Number of keyword occurrences in your title',
  ownKeywordInShortDesc: 'Number of keyword occurrences in your short description',
  ownKeywordInFullDesc: 'Number of keyword occurrences in your full description',
  compKeywordInTitle: 'Number of keyword occurrences in competitor title',
  compKeywordInShortDesc: 'Number of keyword occurrences in competitor short description',
  compKeywordInFullDesc: 'Number of keyword occurrences in competitor full description',
};

// ---------------------------------------------------------------------------
// Historical data formatters
// ---------------------------------------------------------------------------

const NO_RANK_DATA = 'No ranking data available for this period.';
const NO_AUTOCOMPLETE_DATA = 'No autocomplete data available for this period.';
const NO_EVENTS_DATA = 'No events detected in this period.';
const NO_DATA = 'No data available.';

/** Format rank snapshots into a compact date|position line. */
export function formatRankHistory(keyword: string, snapshots: RankSnapshot[], days: number): string {
  if (snapshots.length === 0) return NO_RANK_DATA;
  const byDate = new Map<string, RankSnapshot>();
  for (const s of snapshots) byDate.set(s.date, s);
  const parts: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const label = dateStr.slice(5); // MM-DD
    const snap = byDate.get(dateStr);
    if (snap) {
      parts.push(`${label}: ${snap.position !== null ? `#${snap.position}` : '30+'}`);
    } else {
      parts.push(`${label}: -`);
    }
  }
  return `"${keyword}" search rank (last ${days} days):\n${parts.join(' | ')}`;
}

/** Format autocomplete snapshots into a compact date|position line. */
export function formatAutocompleteHistory(keyword: string, snapshots: AutocompleteSnapshot[], days: number): string {
  if (snapshots.length === 0) return NO_AUTOCOMPLETE_DATA;
  const byDate = new Map<string, AutocompleteSnapshot>();
  for (const s of snapshots) byDate.set(s.date, s);
  const parts: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const label = dateStr.slice(5); // MM-DD
    const snap = byDate.get(dateStr);
    if (snap) {
      parts.push(`${label}: #${snap.position}`);
    } else {
      parts.push(`${label}: -`);
    }
  }
  return `"${keyword}" autocomplete position (last ${days} days):\n${parts.join(' | ')}`;
}

/** Format event records into a multi-line table. */
export function formatEventsHistory(events: EventRecord[], days: number): string {
  if (events.length === 0) return NO_EVENTS_DATA;
  const lines = events.map((e) => `${e.date} | ${e.type} | ${e.note}`);
  return `Events (last ${days} days):\n${lines.join('\n')}`;
}

// ---------------------------------------------------------------------------
// Multi-keyword position table
// ---------------------------------------------------------------------------

/** Format a markdown table of keyword positions for both extensions. */
export function formatKeywordPositionsTable(
  primaryKeyword: string,
  primaryOwnPos: number | null,
  primaryCompPos: number | null,
  additional: AdditionalKeywordContext[],
): string {
  const fmtPos = (pos: number | null): string => pos !== null ? `#${pos}` : '30+';

  const rows: { keyword: string; own: string; comp: string }[] = [
    { keyword: primaryKeyword, own: fmtPos(primaryOwnPos), comp: fmtPos(primaryCompPos) },
    ...additional.map((a) => ({
      keyword: a.keyword,
      own: fmtPos(a.ownPosition),
      comp: fmtPos(a.competitorPosition),
    })),
  ];

  const lines = [
    '| Keyword | Your Position | Competitor Position |',
    '|---------|---------------|---------------------|',
    ...rows.map((r) => `| ${r.keyword} | ${r.own} | ${r.comp} |`),
  ];

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Placeholder value builder
// ---------------------------------------------------------------------------

/** Count case-insensitive whole-word occurrences of a keyword in text. */
export function countKeywordOccurrences(text: string, keyword: string): number {
  if (!text || !keyword) return 0;
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

/** Format a numeric delta with sign (e.g. "+5", "-3", "0"). */
function formatDelta(value: number): string {
  if (value > 0) return `+${value}`;
  return String(value);
}

/** Build placeholder values from an AuditInput. */
export function buildPlaceholderValues(input: AuditInput): Record<string, string> {
  const { keyword, ownListing, competitorListing, ownPosition, competitorPosition } = input;

  // Compute keyword-aware quality scores once and reuse
  const keywordOpts = { keyword };
  const ownQS = calculateQualityScore(ownListing, undefined, keywordOpts).totalScore;
  const compQS = calculateQualityScore(competitorListing, undefined, keywordOpts).totalScore;

  const values: Record<string, string> = {
    keyword,
    ownTitle: ownListing.title,
    ownPosition: ownPosition !== null ? `#${ownPosition}` : 'Not in top 30',
    ownShortDescription: ownListing.shortDescription,
    ownFullDescription: ownListing.fullDescription,
    ownRating: ownListing.rating !== null
      ? `${ownListing.rating}/5 (${ownListing.ratingCount} ratings)`
      : 'No ratings',
    ownUsers: `${ownListing.userCount} (${ownListing.userCountNumeric})`,
    ownVersion: ownListing.version,
    ownScreenshots: String(ownListing.screenshotCount),
    ownTranslations: `${ownListing.translationCount} locales`,
    ownQualityScore: `${ownQS}/100`,
    ownPermissionRisk: `${ownListing.permissionRiskScore}/100`,
    compTitle: competitorListing.title,
    compPosition: competitorPosition !== null ? `#${competitorPosition}` : 'Not in top 30',
    compShortDescription: competitorListing.shortDescription,
    compFullDescription: competitorListing.fullDescription,
    compRating: competitorListing.rating !== null
      ? `${competitorListing.rating}/5 (${competitorListing.ratingCount} ratings)`
      : 'No ratings',
    compUsers: `${competitorListing.userCount} (${competitorListing.userCountNumeric})`,
    compVersion: competitorListing.version,
    compScreenshots: String(competitorListing.screenshotCount),
    compTranslations: `${competitorListing.translationCount} locales`,
    compQualityScore: `${compQS}/100`,
    compPermissionRisk: `${competitorListing.permissionRiskScore}/100`,
    ownReviewCount: String(ownListing.ratingCount),
    compReviewCount: String(competitorListing.ratingCount),
  };

  // Multi-keyword context
  const additional = input.additionalKeywords ?? [];
  if (additional.length > 0) {
    const allKeywords = [keyword, ...additional.map((a) => a.keyword)];
    values.keywords = allKeywords.join(', ');
    values.keywordPositions = '## Keyword Positions Across All Analyzed Keywords\n\n' +
      formatKeywordPositionsTable(keyword, ownPosition, competitorPosition, additional);
  } else {
    values.keywords = keyword;
    values.keywordPositions = '';
  }

  // Historical: 7-day context
  if (input.history7d) {
    const h = input.history7d;
    values.ownRankHistory7d = formatRankHistory(keyword, h.ownRankHistory, 7);
    values.compRankHistory7d = formatRankHistory(keyword, h.compRankHistory, 7);
    values.ownAutocomplete7d = formatAutocompleteHistory(keyword, h.ownAutocompleteHistory, 7);
    values.compAutocomplete7d = formatAutocompleteHistory(keyword, h.compAutocompleteHistory, 7);
    values.ownEvents7d = formatEventsHistory(h.ownEvents, 7);
    values.compEvents7d = formatEventsHistory(h.compEvents, 7);
  } else {
    values.ownRankHistory7d = NO_DATA;
    values.compRankHistory7d = NO_DATA;
    values.ownAutocomplete7d = NO_DATA;
    values.compAutocomplete7d = NO_DATA;
    values.ownEvents7d = NO_DATA;
    values.compEvents7d = NO_DATA;
  }

  // Historical: 14-day context
  if (input.history14d) {
    const h = input.history14d;
    values.ownRankHistory14d = formatRankHistory(keyword, h.ownRankHistory, 14);
    values.compRankHistory14d = formatRankHistory(keyword, h.compRankHistory, 14);
    values.ownAutocomplete14d = formatAutocompleteHistory(keyword, h.ownAutocompleteHistory, 14);
    values.compAutocomplete14d = formatAutocompleteHistory(keyword, h.compAutocompleteHistory, 14);
    values.ownEvents14d = formatEventsHistory(h.ownEvents, 14);
    values.compEvents14d = formatEventsHistory(h.compEvents, 14);
  } else {
    values.ownRankHistory14d = NO_DATA;
    values.compRankHistory14d = NO_DATA;
    values.ownAutocomplete14d = NO_DATA;
    values.compAutocomplete14d = NO_DATA;
    values.ownEvents14d = NO_DATA;
    values.compEvents14d = NO_DATA;
  }

  // Pre-computed deltas (used by Rubric variant, available to all)
  const ownPos = ownPosition;
  const compPos = competitorPosition;
  if (ownPos !== null && compPos !== null) {
    const gap = ownPos - compPos;
    if (gap > 0) {
      values.positionGap = `${gap} positions behind`;
    } else if (gap < 0) {
      values.positionGap = `${-gap} positions ahead`;
    } else {
      values.positionGap = 'Same position';
    }
  } else if (ownPos === null && compPos !== null) {
    values.positionGap = '30+ behind';
  } else if (ownPos !== null && compPos === null) {
    values.positionGap = 'Ahead (competitor not in top 30)';
  } else {
    values.positionGap = 'N/A (both unranked)';
  }

  const ownUsers = ownListing.userCountNumeric;
  const compUsers = competitorListing.userCountNumeric;
  if (ownUsers > 0 && compUsers > 0) {
    const ratio = compUsers / ownUsers;
    values.userRatio = ratio >= 2 ? `${ratio.toFixed(1)}x more` : ratio <= 0.5 ? `${(1 / ratio).toFixed(1)}x fewer` : `${ratio.toFixed(1)}x`;
  } else {
    values.userRatio = 'N/A';
  }

  if (ownListing.rating !== null && competitorListing.rating !== null) {
    values.ratingDelta = formatDelta(+(competitorListing.rating - ownListing.rating).toFixed(1));
  } else {
    values.ratingDelta = 'N/A';
  }

  const ownReviews = ownListing.ratingCount;
  const compReviews = competitorListing.ratingCount;
  if (ownReviews > 0 && compReviews > 0) {
    const ratio = compReviews / ownReviews;
    values.reviewRatio = ratio >= 2 ? `${ratio.toFixed(1)}x more` : ratio <= 0.5 ? `${(1 / ratio).toFixed(1)}x fewer` : `${ratio.toFixed(1)}x`;
  } else {
    values.reviewRatio = 'N/A';
  }

  values.qualityDelta = formatDelta(compQS - ownQS);
  values.screenshotDelta = formatDelta(competitorListing.screenshotCount - ownListing.screenshotCount);
  values.translationDelta = formatDelta(competitorListing.translationCount - ownListing.translationCount);

  const permDiff = competitorListing.permissionRiskScore - ownListing.permissionRiskScore;
  values.permissionDelta = permDiff < 0
    ? `${permDiff} (lower risk)`
    : permDiff > 0
    ? `+${permDiff} (higher risk)`
    : '0 (same)';

  // Keyword occurrence counts
  values.ownKeywordInTitle = String(countKeywordOccurrences(ownListing.title, keyword));
  values.ownKeywordInShortDesc = String(countKeywordOccurrences(ownListing.shortDescription, keyword));
  values.ownKeywordInFullDesc = String(countKeywordOccurrences(ownListing.fullDescription, keyword));
  values.compKeywordInTitle = String(countKeywordOccurrences(competitorListing.title, keyword));
  values.compKeywordInShortDesc = String(countKeywordOccurrences(competitorListing.shortDescription, keyword));
  values.compKeywordInFullDesc = String(countKeywordOccurrences(competitorListing.fullDescription, keyword));

  return values;
}

/** Replace {{placeholder}} tokens in a template string with values. */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    if (key in values) {
      return values[key];
    }
    return match;
  });
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

// Note: Extension data is directly interpolated into the prompt without sanitization.
// This is acceptable because:
// 1. Data is public from Chrome Web Store (not user input)
// 2. AI output is only displayed to the user (no sensitive operations)

/** Get default system prompt for a variant. */
export function getVariantSystemPrompt(variant: AuditPromptVariant): string {
  switch (variant) {
    case 'cot': return VARIANT_COT_SYSTEM_PROMPT;
    case 'rubric': return VARIANT_RUBRIC_SYSTEM_PROMPT;
    default: return DEFAULT_AUDIT_SYSTEM_PROMPT;
  }
}

/** Get default user prompt template for a variant. */
export function getVariantUserPromptTemplate(variant: AuditPromptVariant): string {
  switch (variant) {
    case 'cot': return VARIANT_COT_USER_PROMPT_TEMPLATE;
    case 'rubric': return VARIANT_RUBRIC_USER_PROMPT_TEMPLATE;
    default: return DEFAULT_AUDIT_USER_PROMPT_TEMPLATE;
  }
}

export function buildAuditPrompt(
  input: AuditInput,
  customPrompts?: CustomAuditPrompts,
): ChatMessage[] {
  const variant = customPrompts?.variant ?? 'default';
  const placeholders = buildPlaceholderValues(input);

  const customSystem = customPrompts?.systemPrompt?.trim();
  const systemContent = customSystem || getVariantSystemPrompt(variant);

  const customUser = customPrompts?.userPromptTemplate?.trim();
  const userTemplate = customUser || getVariantUserPromptTemplate(variant);

  const userContent = fillTemplate(userTemplate, placeholders);

  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: userContent },
  ];
}

// ---------------------------------------------------------------------------
// Token estimation for the prompt
// ---------------------------------------------------------------------------

export function estimateAuditTokens(
  input: AuditInput,
  customPrompts?: CustomAuditPrompts,
): {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
} {
  const variant = customPrompts?.variant ?? 'default';
  const messages = buildAuditPrompt(input, customPrompts);
  const totalText = messages.map((m) => m.content).join('');
  const inputTokens = OpenAIClient.estimateTokens(totalText);
  const outputTokens = VARIANT_CONFIG[variant].estimatedOutputTokens;
  const estimatedCostUsd = OpenAIClient.estimateCost(inputTokens, outputTokens);

  return { inputTokens, outputTokens, estimatedCostUsd };
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

export function parseAuditResponse(raw: string): {
  relevanceAnalysis: string;
  metricComparison: string;
  trendAnalysis: string;
  recommendations: AuditRecommendation[];
} {
  try {
    // Strip potential markdown code fences
    let cleaned = raw.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const parsed = JSON.parse(cleaned);

    const relevanceAnalysis = typeof parsed.relevanceAnalysis === 'string'
      ? parsed.relevanceAnalysis
      : '';

    const metricComparison = typeof parsed.metricComparison === 'string'
      ? parsed.metricComparison
      : '';

    const trendAnalysis = typeof parsed.trendAnalysis === 'string'
      ? parsed.trendAnalysis
      : '';

    const recommendations: AuditRecommendation[] = [];
    if (Array.isArray(parsed.recommendations)) {
      for (const rec of parsed.recommendations) {
        if (rec && typeof rec.area === 'string' && typeof rec.suggestion === 'string') {
          const priority = ['high', 'medium', 'low'].includes(rec.priority)
            ? rec.priority as AuditRecommendation['priority']
            : 'medium';
          const impact = typeof rec.impact === 'string' ? rec.impact : undefined;
          recommendations.push({ area: rec.area, suggestion: rec.suggestion, priority, impact });
        }
      }
    }

    return { relevanceAnalysis, metricComparison, trendAnalysis, recommendations };
  } catch {
    // If parsing fails, return the raw text as relevance analysis
    return {
      relevanceAnalysis: raw,
      metricComparison: '',
      trendAnalysis: '',
      recommendations: [],
    };
  }
}

// ---------------------------------------------------------------------------
// Cache key generation
// ---------------------------------------------------------------------------

export function buildCacheKey(
  keywords: string | string[],
  ownExtensionId: string,
  competitorExtensionId: string,
  date: string,
  variant: AuditPromptVariant = 'default',
): string {
  const keywordPart = Array.isArray(keywords)
    ? [...keywords].sort().join(',')
    : keywords;
  const variantSuffix = variant !== 'default' ? `:${variant}` : '';
  return `audit:${keywordPart}:${ownExtensionId}:${competitorExtensionId}:${date}${variantSuffix}`;
}

// ---------------------------------------------------------------------------
// Run audit
// ---------------------------------------------------------------------------

export async function runKeywordAudit(
  client: OpenAIClient,
  input: AuditInput,
  customPrompts?: CustomAuditPrompts,
): Promise<AuditResult> {
  const variant = customPrompts?.variant ?? 'default';
  const config = VARIANT_CONFIG[variant];
  const messages = buildAuditPrompt(input, customPrompts);

  const response = await client.chat(messages, {
    model: 'gpt-4o',
    temperature: config.temperature,
    maxTokens: config.maxTokens,
  });

  const parsed = parseAuditResponse(response.content);
  const costUsd = OpenAIClient.estimateCost(response.inputTokens, response.outputTokens);

  const result: AuditResult = {
    keyword: input.keyword,
    ownExtensionId: input.ownListing.extensionId,
    competitorExtensionId: input.competitorListing.extensionId,
    relevanceAnalysis: parsed.relevanceAnalysis,
    metricComparison: parsed.metricComparison,
    trendAnalysis: parsed.trendAnalysis,
    recommendations: parsed.recommendations,
    rawResponse: response.content,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    costUsd,
    createdAt: new Date().toISOString(),
  };

  if (input.additionalKeywords && input.additionalKeywords.length > 0) {
    result.additionalKeywords = input.additionalKeywords.map((a) => a.keyword);
  }

  return result;
}
