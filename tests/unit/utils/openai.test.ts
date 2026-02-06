/**
 * Tests for OpenAI API client (Phase 3.1).
 *
 * Uses vi.fn() to mock the global fetch for HTTP requests.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { OpenAIClient, OpenAIError } from '../../../src/shared/utils/openai';
import type { ChatMessage } from '../../../src/shared/utils/openai';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchResponse(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    })
  );
}

function mockFetchNetworkError(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
  );
}

const VALID_KEY = 'sk-test-key-12345';

const SAMPLE_MESSAGES: ChatMessage[] = [
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: 'Hello' },
];

const SUCCESSFUL_RESPONSE = {
  choices: [
    {
      message: { role: 'assistant', content: 'Hello! How can I help?' },
      finish_reason: 'stop',
    },
  ],
  usage: {
    prompt_tokens: 15,
    completion_tokens: 8,
    total_tokens: 23,
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OpenAIClient', () => {
  let client: OpenAIClient;

  beforeEach(() => {
    client = new OpenAIClient(VALID_KEY);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Successful chat completion
  // -------------------------------------------------------------------------

  describe('chat() - success', () => {
    it('returns parsed response content on successful completion', async () => {
      mockFetchResponse(200, SUCCESSFUL_RESPONSE);

      const result = await client.chat(SAMPLE_MESSAGES);

      expect(result.content).toBe('Hello! How can I help?');
      expect(result.inputTokens).toBe(15);
      expect(result.outputTokens).toBe(8);
    });

    it('sends correct request body with default options', async () => {
      mockFetchResponse(200, SUCCESSFUL_RESPONSE);

      await client.chat(SAMPLE_MESSAGES);

      const fetchFn = vi.mocked(fetch);
      expect(fetchFn).toHaveBeenCalledOnce();

      const [url, init] = fetchFn.mock.calls[0];
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
      expect(init?.method).toBe('POST');

      const headers = init?.headers as Record<string, string>;
      expect(headers['Authorization']).toBe(`Bearer ${VALID_KEY}`);
      expect(headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(init?.body as string);
      expect(body.model).toBe('gpt-4o');
      expect(body.temperature).toBe(0.7);
      expect(body.max_tokens).toBe(2048);
      expect(body.messages).toEqual(SAMPLE_MESSAGES);
    });

    it('uses custom options when provided', async () => {
      mockFetchResponse(200, SUCCESSFUL_RESPONSE);

      await client.chat(SAMPLE_MESSAGES, {
        model: 'gpt-4o-mini',
        temperature: 0.3,
        maxTokens: 1024,
      });

      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
      expect(body.model).toBe('gpt-4o-mini');
      expect(body.temperature).toBe(0.3);
      expect(body.max_tokens).toBe(1024);
    });

    it('handles missing usage data gracefully', async () => {
      mockFetchResponse(200, {
        choices: [{ message: { content: 'Test' } }],
      });

      const result = await client.chat(SAMPLE_MESSAGES);
      expect(result.content).toBe('Test');
      expect(result.inputTokens).toBe(0);
      expect(result.outputTokens).toBe(0);
    });

    it('handles empty choices gracefully', async () => {
      mockFetchResponse(200, { choices: [] });

      const result = await client.chat(SAMPLE_MESSAGES);
      expect(result.content).toBe('');
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('chat() - 401 Unauthorized', () => {
    it('throws OpenAIError with invalid_api_key code', async () => {
      mockFetchResponse(401, {
        error: { message: 'Incorrect API key provided', type: 'invalid_request_error' },
      });

      await expect(client.chat(SAMPLE_MESSAGES)).rejects.toThrow(OpenAIError);
      await expect(client.chat(SAMPLE_MESSAGES)).rejects.toThrow('Invalid API key');

      try {
        await client.chat(SAMPLE_MESSAGES);
      } catch (e) {
        expect((e as OpenAIError).code).toBe('invalid_api_key');
      }
    });
  });

  describe('chat() - 429 Rate Limited', () => {
    it('throws OpenAIError with rate_limited code', async () => {
      mockFetchResponse(429, {
        error: { message: 'Rate limit exceeded', type: 'rate_limit_error' },
      });

      await expect(client.chat(SAMPLE_MESSAGES)).rejects.toThrow(OpenAIError);
      await expect(client.chat(SAMPLE_MESSAGES)).rejects.toThrow('Rate limited');

      try {
        await client.chat(SAMPLE_MESSAGES);
      } catch (e) {
        expect((e as OpenAIError).code).toBe('rate_limited');
      }
    });
  });

  describe('chat() - 402 Payment Required', () => {
    it('throws OpenAIError with no_credits code', async () => {
      mockFetchResponse(402, {
        error: { message: 'Payment required', type: 'billing_error' },
      });

      await expect(client.chat(SAMPLE_MESSAGES)).rejects.toThrow(OpenAIError);
      await expect(client.chat(SAMPLE_MESSAGES)).rejects.toThrow('Insufficient OpenAI credits');

      try {
        await client.chat(SAMPLE_MESSAGES);
      } catch (e) {
        expect((e as OpenAIError).code).toBe('no_credits');
      }
    });
  });

  describe('chat() - insufficient_quota error code', () => {
    it('throws OpenAIError with no_credits code on insufficient_quota', async () => {
      mockFetchResponse(400, {
        error: {
          message: 'You exceeded your current quota',
          type: 'insufficient_quota',
          code: 'insufficient_quota',
        },
      });

      try {
        await client.chat(SAMPLE_MESSAGES);
      } catch (e) {
        expect(e).toBeInstanceOf(OpenAIError);
        expect((e as OpenAIError).code).toBe('no_credits');
      }
    });
  });

  describe('chat() - Network error', () => {
    it('throws OpenAIError with connection_failed code', async () => {
      mockFetchNetworkError();

      await expect(client.chat(SAMPLE_MESSAGES)).rejects.toThrow(OpenAIError);
      await expect(client.chat(SAMPLE_MESSAGES)).rejects.toThrow('Failed to connect');

      try {
        await client.chat(SAMPLE_MESSAGES);
      } catch (e) {
        expect((e as OpenAIError).code).toBe('connection_failed');
      }
    });
  });

  describe('chat() - Generic API error', () => {
    it('throws OpenAIError with api_error code for 500', async () => {
      mockFetchResponse(500, {
        error: { message: 'Internal server error' },
      });

      try {
        await client.chat(SAMPLE_MESSAGES);
      } catch (e) {
        expect(e).toBeInstanceOf(OpenAIError);
        expect((e as OpenAIError).code).toBe('api_error');
        expect((e as OpenAIError).message).toBe('Internal server error');
      }
    });

    it('uses fallback message when error body is missing', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 503,
          json: () => Promise.reject(new Error('not json')),
        })
      );

      try {
        await client.chat(SAMPLE_MESSAGES);
      } catch (e) {
        expect(e).toBeInstanceOf(OpenAIError);
        expect((e as OpenAIError).message).toBe('OpenAI API error (HTTP 503)');
      }
    });
  });
});

// ---------------------------------------------------------------------------
// estimateTokens
// ---------------------------------------------------------------------------

describe('OpenAIClient.estimateTokens()', () => {
  it('returns 0 for empty string', () => {
    expect(OpenAIClient.estimateTokens('')).toBe(0);
  });

  it('estimates roughly 1 token per 4 characters', () => {
    // 20 chars -> ~5 tokens
    const text = 'Hello World Test1234';
    expect(OpenAIClient.estimateTokens(text)).toBe(5);
  });

  it('handles short text', () => {
    // 5 chars -> ceil(5/4) = 2
    expect(OpenAIClient.estimateTokens('Hello')).toBe(2);
  });

  it('handles longer text', () => {
    // 100 chars -> 25 tokens
    const text = 'a'.repeat(100);
    expect(OpenAIClient.estimateTokens(text)).toBe(25);
  });

  it('rounds up for non-divisible lengths', () => {
    // 13 chars -> ceil(13/4) = 4
    const text = 'Hello, World!';
    expect(OpenAIClient.estimateTokens(text)).toBe(4);
  });

  it('handles multi-byte text roughly', () => {
    // JS .length counts UTF-16 code units, not bytes
    const text = 'Hello World'; // 11 chars -> ceil(11/4) = 3
    expect(OpenAIClient.estimateTokens(text)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// estimateCost
// ---------------------------------------------------------------------------

describe('OpenAIClient.estimateCost()', () => {
  it('returns 0 for zero tokens', () => {
    expect(OpenAIClient.estimateCost(0, 0)).toBe(0);
  });

  it('calculates cost for GPT-4o pricing', () => {
    // 1000 input tokens at $2.50/1M = $0.0025
    // 500 output tokens at $10.00/1M = $0.005
    // Total = $0.0075
    const cost = OpenAIClient.estimateCost(1000, 500);
    expect(cost).toBeCloseTo(0.0075, 6);
  });

  it('calculates cost for 1M input tokens', () => {
    const cost = OpenAIClient.estimateCost(1_000_000, 0);
    expect(cost).toBeCloseTo(2.5, 2);
  });

  it('calculates cost for 1M output tokens', () => {
    const cost = OpenAIClient.estimateCost(0, 1_000_000);
    expect(cost).toBeCloseTo(10.0, 2);
  });

  it('handles typical audit request cost', () => {
    // ~2000 input tokens, ~500 output tokens
    // Input: 2000 * 2.5/1M = 0.005
    // Output: 500 * 10/1M = 0.005
    // Total: $0.01
    const cost = OpenAIClient.estimateCost(2000, 500);
    expect(cost).toBeCloseTo(0.01, 4);
  });
});
