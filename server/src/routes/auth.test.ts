import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import authRouter from './auth.js';

vi.mock('../db/queries.js', () => ({
  findUserByApiKey: vi.fn(),
  createUser: vi.fn(),
  updateLastSeen: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../middleware/rate-limit.js', () => ({
  registerRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { findUserByApiKey, createUser } from '../db/queries.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/auth', authRouter);
  return app;
}

describe('POST /auth/register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers new user with valid UUID', async () => {
    vi.mocked(findUserByApiKey).mockResolvedValue(null);
    vi.mocked(createUser).mockResolvedValue({
      id: 'test-uuid-1234', api_key: 'test-uuid-1234', plan: 'free',
      license_key: null, created_at: new Date(), last_seen_at: new Date(),
    });

    const res = await request(createApp())
      .post('/auth/register')
      .send({ uuid: 'test-uuid-1234' });

    expect(res.status).toBe(201);
    expect(res.body.apiKey).toBe('test-uuid-1234');
    expect(res.body.plan).toBe('free');
    expect(createUser).toHaveBeenCalledWith('test-uuid-1234', 'test-uuid-1234');
  });

  it('returns existing user on re-register (idempotent)', async () => {
    vi.mocked(findUserByApiKey).mockResolvedValue({
      id: 'existing-uuid', api_key: 'existing-uuid', plan: 'pro',
      license_key: 'LS-key', created_at: new Date(), last_seen_at: new Date(),
    });

    const res = await request(createApp())
      .post('/auth/register')
      .send({ uuid: 'existing-uuid' });

    expect(res.status).toBe(200);
    expect(res.body.apiKey).toBe('existing-uuid');
    expect(res.body.plan).toBe('pro');
    expect(createUser).not.toHaveBeenCalled();
  });

  it('rejects missing uuid', async () => {
    const res = await request(createApp())
      .post('/auth/register')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid uuid');
  });

  it('rejects empty uuid', async () => {
    const res = await request(createApp())
      .post('/auth/register')
      .send({ uuid: '' });

    expect(res.status).toBe(400);
  });

  it('rejects uuid that is too short', async () => {
    const res = await request(createApp())
      .post('/auth/register')
      .send({ uuid: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('8-128');
  });

  it('rejects uuid that is too long', async () => {
    const res = await request(createApp())
      .post('/auth/register')
      .send({ uuid: 'x'.repeat(129) });

    expect(res.status).toBe(400);
  });

  it('rejects non-string uuid', async () => {
    const res = await request(createApp())
      .post('/auth/register')
      .send({ uuid: 12345 });

    expect(res.status).toBe(400);
  });

  it('accepts uuid at minimum length (8 chars)', async () => {
    vi.mocked(findUserByApiKey).mockResolvedValue(null);
    vi.mocked(createUser).mockResolvedValue({
      id: 'abcdefgh', api_key: 'abcdefgh', plan: 'free',
      license_key: null, created_at: new Date(), last_seen_at: new Date(),
    });

    const res = await request(createApp())
      .post('/auth/register')
      .send({ uuid: 'abcdefgh' });

    expect(res.status).toBe(201);
  });

  it('accepts uuid at maximum length (128 chars)', async () => {
    const longUuid = 'a'.repeat(128);
    vi.mocked(findUserByApiKey).mockResolvedValue(null);
    vi.mocked(createUser).mockResolvedValue({
      id: longUuid, api_key: longUuid, plan: 'free',
      license_key: null, created_at: new Date(), last_seen_at: new Date(),
    });

    const res = await request(createApp())
      .post('/auth/register')
      .send({ uuid: longUuid });

    expect(res.status).toBe(201);
  });
});
