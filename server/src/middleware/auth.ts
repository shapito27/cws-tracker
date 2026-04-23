import type { Request, Response, NextFunction } from 'express';
import { findUserByApiKey, updateLastSeen } from '../db/queries.js';

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; plan: 'free' | 'pro' };
    }
  }
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const apiKey = req.headers['x-api-key'] as string | undefined
    ?? req.query['key'] as string | undefined;

  if (!apiKey) {
    res.status(401).json({ error: 'Missing API key. Provide via X-API-Key header or ?key= parameter.' });
    return;
  }

  const user = await findUserByApiKey(apiKey);
  if (!user) {
    res.status(401).json({ error: 'Invalid API key.' });
    return;
  }

  req.user = { id: user.id, plan: user.plan };
  updateLastSeen(user.id).catch((err) => {
    console.warn(`[auth] Failed to update last_seen for ${user.id}:`,
      err instanceof Error ? err.message : err);
  });
  next();
}

export function requirePro(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.plan !== 'pro') {
    res.status(403).json({ error: 'Pro plan required.' });
    return;
  }
  next();
}
