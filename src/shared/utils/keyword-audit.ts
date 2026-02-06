/**
 * Keyword audit - "Why Is Competitor Higher?" (Phase 3.2).
 *
 * Builds a structured prompt for GPT-4o to analyze why a competitor
 * outranks the user's extension for a given keyword, then parses
 * the AI response into a structured audit result.
 */

import type { ListingSnapshot, RankSnapshot } from '../types';
import { OpenAIClient } from './openai';
import type { ChatMessage } from './openai';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditInput {
  keyword: string;
  ownListing: ListingSnapshot;
  competitorListing: ListingSnapshot;
  ownPosition: number | null;
  competitorPosition: number | null;
}

export interface AuditRecommendation {
  area: string;
  suggestion: string;
  priority: 'high' | 'medium' | 'low';
}

export interface AuditResult {
  keyword: string;
  ownExtensionId: string;
  competitorExtensionId: string;
  relevanceAnalysis: string;
  metricComparison: string;
  recommendations: AuditRecommendation[];
  rawResponse: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  createdAt: string;
}

/** Cached audit result stored in IndexedDB. */
export interface CachedAuditResult extends AuditResult {
  id?: number;
  /** Cache key: hash of keyword + ownExtensionId + competitorExtensionId + date. */
  cacheKey: string;
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

// Note: Extension data is directly interpolated into the prompt without sanitization.
// This is acceptable because:
// 1. Data is public from Chrome Web Store (not user input)
// 2. AI output is only displayed to the user (no sensitive operations)
// 3. Descriptions are truncated to 500 chars to limit prompt size

export function buildAuditPrompt(input: AuditInput): ChatMessage[] {
  const { keyword, ownListing, competitorListing, ownPosition, competitorPosition } = input;

  const ownPos = ownPosition !== null ? `#${ownPosition}` : 'Not in top 30';
  const compPos = competitorPosition !== null ? `#${competitorPosition}` : 'Not in top 30';

  const systemMessage: ChatMessage = {
    role: 'system',
    content: `You are a Chrome Web Store ASO (App Store Optimization) expert. Analyze why one extension ranks higher than another for a specific keyword. Provide actionable, specific recommendations.

Respond in the following JSON format:
{
  "relevanceAnalysis": "Analysis of how each extension's listing relates to the keyword...",
  "metricComparison": "Comparison of key metrics that influence ranking...",
  "recommendations": [
    {"area": "Category name", "suggestion": "Specific actionable advice", "priority": "high|medium|low"},
    ...
  ]
}

Keep the relevance analysis to 2-3 paragraphs. Keep metric comparison to 2-3 paragraphs. Provide 3-6 recommendations sorted by priority (high first). Only output valid JSON, no markdown code fences.`,
  };

  const userMessage: ChatMessage = {
    role: 'user',
    content: `Analyze why the competitor extension ranks higher for the keyword "${keyword}".

## Your Extension
- **Title**: ${ownListing.title}
- **Position**: ${ownPos}
- **Short Description**: ${ownListing.shortDescription}
- **Full Description** (first 500 chars): ${ownListing.fullDescription.slice(0, 500)}
- **Rating**: ${ownListing.rating !== null ? `${ownListing.rating}/5 (${ownListing.ratingCount} ratings)` : 'No ratings'}
- **Users**: ${ownListing.userCount} (${ownListing.userCountNumeric})
- **Version**: ${ownListing.version}
- **Screenshots**: ${ownListing.screenshotCount}
- **Translations**: ${ownListing.translationCount} locales
- **Quality Score**: ${ownListing.listingQualityScore !== null ? ownListing.listingQualityScore : 'N/A'}
- **Permission Risk**: ${ownListing.permissionRiskScore}/100

## Competitor Extension
- **Title**: ${competitorListing.title}
- **Position**: ${compPos}
- **Short Description**: ${competitorListing.shortDescription}
- **Full Description** (first 500 chars): ${competitorListing.fullDescription.slice(0, 500)}
- **Rating**: ${competitorListing.rating !== null ? `${competitorListing.rating}/5 (${competitorListing.ratingCount} ratings)` : 'No ratings'}
- **Users**: ${competitorListing.userCount} (${competitorListing.userCountNumeric})
- **Version**: ${competitorListing.version}
- **Screenshots**: ${competitorListing.screenshotCount}
- **Translations**: ${competitorListing.translationCount} locales
- **Quality Score**: ${competitorListing.listingQualityScore !== null ? competitorListing.listingQualityScore : 'N/A'}
- **Permission Risk**: ${competitorListing.permissionRiskScore}/100`,
  };

  return [systemMessage, userMessage];
}

// ---------------------------------------------------------------------------
// Token estimation for the prompt
// ---------------------------------------------------------------------------

export function estimateAuditTokens(input: AuditInput): {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
} {
  const messages = buildAuditPrompt(input);
  const totalText = messages.map((m) => m.content).join('');
  const inputTokens = OpenAIClient.estimateTokens(totalText);
  // Estimate ~600 output tokens for a structured audit response
  const outputTokens = 600;
  const estimatedCostUsd = OpenAIClient.estimateCost(inputTokens, outputTokens);

  return { inputTokens, outputTokens, estimatedCostUsd };
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

export function parseAuditResponse(raw: string): {
  relevanceAnalysis: string;
  metricComparison: string;
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

    const recommendations: AuditRecommendation[] = [];
    if (Array.isArray(parsed.recommendations)) {
      for (const rec of parsed.recommendations) {
        if (rec && typeof rec.area === 'string' && typeof rec.suggestion === 'string') {
          const priority = ['high', 'medium', 'low'].includes(rec.priority)
            ? rec.priority as AuditRecommendation['priority']
            : 'medium';
          recommendations.push({ area: rec.area, suggestion: rec.suggestion, priority });
        }
      }
    }

    return { relevanceAnalysis, metricComparison, recommendations };
  } catch {
    // If parsing fails, return the raw text as relevance analysis
    return {
      relevanceAnalysis: raw,
      metricComparison: '',
      recommendations: [],
    };
  }
}

// ---------------------------------------------------------------------------
// Cache key generation
// ---------------------------------------------------------------------------

export function buildCacheKey(
  keyword: string,
  ownExtensionId: string,
  competitorExtensionId: string,
  date: string
): string {
  return `audit:${keyword}:${ownExtensionId}:${competitorExtensionId}:${date}`;
}

// ---------------------------------------------------------------------------
// Run audit
// ---------------------------------------------------------------------------

export async function runKeywordAudit(
  client: OpenAIClient,
  input: AuditInput
): Promise<AuditResult> {
  const messages = buildAuditPrompt(input);

  const response = await client.chat(messages, {
    model: 'gpt-4o',
    temperature: 0.7,
    maxTokens: 2048,
  });

  const parsed = parseAuditResponse(response.content);
  const costUsd = OpenAIClient.estimateCost(response.inputTokens, response.outputTokens);

  return {
    keyword: input.keyword,
    ownExtensionId: input.ownListing.extensionId,
    competitorExtensionId: input.competitorListing.extensionId,
    relevanceAnalysis: parsed.relevanceAnalysis,
    metricComparison: parsed.metricComparison,
    recommendations: parsed.recommendations,
    rawResponse: response.content,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    costUsd,
    createdAt: new Date().toISOString(),
  };
}
