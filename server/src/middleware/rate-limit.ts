import rateLimit from 'express-rate-limit';
import type { Request } from 'express';

export const proxyRateLimit = rateLimit({
  windowMs: 60_000,
  limit: (req: Request) => (req.user?.plan === 'pro' ? 60 : 30),
  keyGenerator: (req: Request) => req.user?.id ?? req.ip ?? 'unknown',
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded. Try again in a minute.' },
});

export const registerRateLimit = rateLimit({
  windowMs: 3600_000,
  limit: 5,
  keyGenerator: (req: Request) => req.ip ?? 'unknown',
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many registrations. Try again later.' },
});
