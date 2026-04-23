import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

function safeCompare(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers['x-admin-token'] as string | undefined;
  if (!token || !config.adminToken || !safeCompare(token, config.adminToken)) {
    res.status(403).json({ error: 'Forbidden.' });
    return;
  }
  next();
}
