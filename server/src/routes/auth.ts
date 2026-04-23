import { Router } from 'express';
import { createUser, findUserByApiKey } from '../db/queries.js';
import { registerRateLimit } from '../middleware/rate-limit.js';

const router = Router();

router.post('/register', registerRateLimit, async (req, res) => {
  const { uuid } = req.body as { uuid?: string };

  if (!uuid || typeof uuid !== 'string' || uuid.length < 8 || uuid.length > 128) {
    res.status(400).json({ error: 'Invalid uuid. Must be 8-128 characters.' });
    return;
  }

  const existing = await findUserByApiKey(uuid);
  if (existing) {
    res.json({ apiKey: existing.api_key, plan: existing.plan });
    return;
  }

  const user = await createUser(uuid, uuid);
  res.status(201).json({ apiKey: user.api_key, plan: user.plan });
});

export default router;
