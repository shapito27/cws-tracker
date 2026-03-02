/**
 * Keyword audit - "Why Is Competitor Higher?" (Phase 3.2).
 *
 * Builds a structured prompt for GPT-4o to analyze why a competitor
 * outranks the user's extension for a given keyword, then parses
 * the AI response into a structured audit result.
 */

import type { ListingSnapshot, RankSnapshot, AutocompleteSnapshot, EventRecord } from '../types';
import { OpenAIClient } from './openai';
import type { ChatMessage } from './openai';

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
- **Full Description** (first 500 chars): {{ownFullDescription}}
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
- **Full Description** (first 500 chars): {{compFullDescription}}
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
// Placeholder system
// ---------------------------------------------------------------------------

/** Maximum characters from full description included in the prompt. */
const MAX_DESCRIPTION_LENGTH = 500;

/** All available placeholder keys with human-readable descriptions. */
export const AUDIT_PLACEHOLDERS: Record<string, string> = {
  keyword: 'The search keyword being analyzed',
  ownTitle: 'Your extension title',
  ownPosition: 'Your ranking position (e.g. "#3" or "Not in top 30")',
  ownShortDescription: 'Your short description',
  ownFullDescription: 'Your full description (first 500 chars)',
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
  compFullDescription: 'Competitor full description (first 500 chars)',
  compRating: 'Competitor rating',
  compUsers: 'Competitor user count',
  compVersion: 'Competitor version',
  compScreenshots: 'Competitor screenshot count',
  compTranslations: 'Competitor translation locale count',
  compQualityScore: 'Competitor quality score',
  compPermissionRisk: 'Competitor permission risk score (0-100)',

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

/** Build placeholder values from an AuditInput. */
export function buildPlaceholderValues(input: AuditInput): Record<string, string> {
  const { keyword, ownListing, competitorListing, ownPosition, competitorPosition } = input;

  const values: Record<string, string> = {
    keyword,
    ownTitle: ownListing.title,
    ownPosition: ownPosition !== null ? `#${ownPosition}` : 'Not in top 30',
    ownShortDescription: ownListing.shortDescription,
    ownFullDescription: ownListing.fullDescription.slice(0, MAX_DESCRIPTION_LENGTH),
    ownRating: ownListing.rating !== null
      ? `${ownListing.rating}/5 (${ownListing.ratingCount} ratings)`
      : 'No ratings',
    ownUsers: `${ownListing.userCount} (${ownListing.userCountNumeric})`,
    ownVersion: ownListing.version,
    ownScreenshots: String(ownListing.screenshotCount),
    ownTranslations: `${ownListing.translationCount} locales`,
    ownQualityScore: ownListing.listingQualityScore !== null
      ? String(ownListing.listingQualityScore)
      : 'N/A',
    ownPermissionRisk: `${ownListing.permissionRiskScore}/100`,
    compTitle: competitorListing.title,
    compPosition: competitorPosition !== null ? `#${competitorPosition}` : 'Not in top 30',
    compShortDescription: competitorListing.shortDescription,
    compFullDescription: competitorListing.fullDescription.slice(0, MAX_DESCRIPTION_LENGTH),
    compRating: competitorListing.rating !== null
      ? `${competitorListing.rating}/5 (${competitorListing.ratingCount} ratings)`
      : 'No ratings',
    compUsers: `${competitorListing.userCount} (${competitorListing.userCountNumeric})`,
    compVersion: competitorListing.version,
    compScreenshots: String(competitorListing.screenshotCount),
    compTranslations: `${competitorListing.translationCount} locales`,
    compQualityScore: competitorListing.listingQualityScore !== null
      ? String(competitorListing.listingQualityScore)
      : 'N/A',
    compPermissionRisk: `${competitorListing.permissionRiskScore}/100`,
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
// 3. Descriptions are truncated to 500 chars to limit prompt size

export function buildAuditPrompt(
  input: AuditInput,
  customPrompts?: CustomAuditPrompts,
): ChatMessage[] {
  const placeholders = buildPlaceholderValues(input);

  const customSystem = customPrompts?.systemPrompt?.trim();
  const systemContent = customSystem || DEFAULT_AUDIT_SYSTEM_PROMPT;

  const customUser = customPrompts?.userPromptTemplate?.trim();
  const userTemplate = customUser || DEFAULT_AUDIT_USER_PROMPT_TEMPLATE;

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
  const messages = buildAuditPrompt(input, customPrompts);
  const totalText = messages.map((m) => m.content).join('');
  const inputTokens = OpenAIClient.estimateTokens(totalText);
  // Estimate ~900 output tokens for enriched audit (trendAnalysis + impact fields)
  const outputTokens = 900;
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
  date: string
): string {
  const keywordPart = Array.isArray(keywords)
    ? [...keywords].sort().join(',')
    : keywords;
  return `audit:${keywordPart}:${ownExtensionId}:${competitorExtensionId}:${date}`;
}

// ---------------------------------------------------------------------------
// Run audit
// ---------------------------------------------------------------------------

export async function runKeywordAudit(
  client: OpenAIClient,
  input: AuditInput,
  customPrompts?: CustomAuditPrompts,
): Promise<AuditResult> {
  const messages = buildAuditPrompt(input, customPrompts);

  const response = await client.chat(messages, {
    model: 'gpt-4o',
    temperature: 0.7,
    maxTokens: 2048,
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
