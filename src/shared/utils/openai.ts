/**
 * OpenAI API client for CWS Tracker AI features (Phase 3.1).
 *
 * Wraps the OpenAI /v1/chat/completions endpoint. All API calls use the
 * user's own API key stored in chrome.storage.local.
 *
 * Designed for use from the dashboard context (not service worker) since
 * AI features are user-initiated and need DOM access for the UI.
 */

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class OpenAIError extends Error {
  constructor(
    message: string,
    public readonly code: 'invalid_api_key' | 'rate_limited' | 'no_credits' | 'connection_failed' | 'api_error'
  ) {
    super(message);
    this.name = 'OpenAIError';
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  /** Model to use. Defaults to 'gpt-4o'. */
  model?: string;
  /** Sampling temperature (0-2). Defaults to 0.7. */
  temperature?: number;
  /** Maximum tokens to generate. Defaults to 2048. */
  maxTokens?: number;
}

export interface ChatResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
}

// ---------------------------------------------------------------------------
// GPT-4o pricing (per 1M tokens, as of 2025)
// ---------------------------------------------------------------------------

/** GPT-4o input cost per token. $2.50 per 1M tokens. */
const GPT4O_INPUT_COST_PER_TOKEN = 2.5 / 1_000_000;
/** GPT-4o output cost per token. $10.00 per 1M tokens. */
const GPT4O_OUTPUT_COST_PER_TOKEN = 10.0 / 1_000_000;

// ---------------------------------------------------------------------------
// OpenAIClient
// ---------------------------------------------------------------------------

export class OpenAIClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.openai.com/v1';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Send a chat completion request to the OpenAI API.
   *
   * @throws {OpenAIError} On API or network errors.
   */
  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResponse> {
    const model = options.model ?? 'gpt-4o';
    const temperature = options.temperature ?? 0.7;
    const maxTokens = options.maxTokens ?? 2048;

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
        }),
      });
    } catch {
      throw new OpenAIError(
        'Failed to connect to OpenAI API. Check your internet connection.',
        'connection_failed'
      );
    }

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    const data = await response.json();

    const content = data.choices?.[0]?.message?.content ?? '';
    const inputTokens = data.usage?.prompt_tokens ?? 0;
    const outputTokens = data.usage?.completion_tokens ?? 0;

    return { content, inputTokens, outputTokens };
  }

  /**
   * Estimate the number of tokens in a text string.
   * Approximation: ~4 characters per token for English text.
   */
  static estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }

  /**
   * Estimate the cost of an API call in USD.
   * Uses GPT-4o pricing.
   */
  static estimateCost(inputTokens: number, outputTokens: number): number {
    return (
      inputTokens * GPT4O_INPUT_COST_PER_TOKEN +
      outputTokens * GPT4O_OUTPUT_COST_PER_TOKEN
    );
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async handleErrorResponse(response: Response): Promise<never> {
    let errorBody: { error?: { message?: string; type?: string; code?: string } } = {};
    try {
      errorBody = await response.json();
    } catch {
      // Non-JSON response, use status code only
    }

    const apiMessage = errorBody.error?.message ?? '';

    switch (response.status) {
      case 401:
        throw new OpenAIError(
          'Invalid API key. Please check your OpenAI API key in Settings.',
          'invalid_api_key'
        );

      case 429:
        throw new OpenAIError(
          'Rate limited by OpenAI. Please wait a moment and try again.',
          'rate_limited'
        );

      case 402:
        throw new OpenAIError(
          'Insufficient OpenAI credits. Please add credits to your OpenAI account.',
          'no_credits'
        );

      default: {
        // 402-like errors sometimes come as 400/403 with specific error codes
        if (errorBody.error?.code === 'insufficient_quota') {
          throw new OpenAIError(
            'Insufficient OpenAI credits. Please add credits to your OpenAI account.',
            'no_credits'
          );
        }
        throw new OpenAIError(
          apiMessage || `OpenAI API error (HTTP ${response.status})`,
          'api_error'
        );
      }
    }
  }
}
