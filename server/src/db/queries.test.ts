import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();

vi.mock('./client.js', () => ({
  pool: {
    query: (...args: unknown[]) => mockQuery(...args),
  },
}));

import { upsertProxyHealth } from './queries.js';

describe('upsertProxyHealth (SQL injection protection)', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
  });

  it('allows whitelisted fields', async () => {
    await upsertProxyHealth('proxy-1', {
      total_requests: 5,
      total_failures: 1,
      consecutive_failures: 1,
    });

    expect(mockQuery).toHaveBeenCalledOnce();
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain('total_requests');
    expect(sql).toContain('total_failures');
    expect(sql).toContain('consecutive_failures');
  });

  it('ignores unknown/dangerous field names', async () => {
    await upsertProxyHealth('proxy-1', {
      total_requests: 5,
      'total_requests; DROP TABLE users; --': 666,
      'foo': 'bar',
    });

    expect(mockQuery).toHaveBeenCalledOnce();
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).not.toContain('DROP');
    expect(sql).not.toContain('--');
    expect(sql).not.toContain('foo');
  });

  it('skips the query entirely when no whitelisted fields are present', async () => {
    await upsertProxyHealth('proxy-1', {
      'evil_column': 1,
      'DROP TABLE users': 2,
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('skips undefined values (avoids clobbering with nulls)', async () => {
    await upsertProxyHealth('proxy-1', {
      total_requests: 5,
      last_success_at: undefined,
    });
    const values = mockQuery.mock.calls[0]![1] as unknown[];
    // Only proxyId and total_requests should be in values
    expect(values).toEqual(['proxy-1', 5]);
  });

  it('handles empty updates object', async () => {
    await upsertProxyHealth('proxy-1', {});
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
