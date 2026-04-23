import { Router } from 'express';
import { fetchDetail, fetchSearch, fetchAutocomplete, EXTENSION_ID_REGEX, MAX_SEARCH_QUERY_LENGTH } from '../services/cws-fetcher.js';

const router = Router();

router.get('/detail', async (req, res) => {
  const id = req.query['id'] as string | undefined;
  const hl = (req.query['hl'] as string) || 'en';

  if (!id) {
    res.status(400).json({ error: 'Missing required parameter: id' });
    return;
  }
  if (!EXTENSION_ID_REGEX.test(id)) {
    res.status(400).json({ error: 'Invalid extension ID. Must be 32 lowercase letters.' });
    return;
  }

  try {
    const result = await fetchDetail(id, hl);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('aborted')) {
      res.status(504).json({ error: 'CWS request timed out' });
      return;
    }
    res.status(502).json({ error: `CWS fetch failed: ${message}` });
  }
});

router.get('/search', async (req, res) => {
  const query = req.query['q'] as string | undefined;
  const hl = (req.query['hl'] as string) || 'en';
  const token = req.query['token'] as string | undefined;

  if (!query) {
    res.status(400).json({ error: 'Missing required parameter: q' });
    return;
  }
  if (query.length > MAX_SEARCH_QUERY_LENGTH) {
    res.status(400).json({ error: `Search query too long. Max ${MAX_SEARCH_QUERY_LENGTH} characters.` });
    return;
  }

  try {
    const result = await fetchSearch(query, hl, token);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('aborted')) {
      res.status(504).json({ error: 'CWS request timed out' });
      return;
    }
    res.status(502).json({ error: `CWS fetch failed: ${message}` });
  }
});

router.get('/autocomplete', async (req, res) => {
  const query = req.query['q'] as string | undefined;
  const hl = (req.query['hl'] as string) || 'en';

  if (!query) {
    res.status(400).json({ error: 'Missing required parameter: q' });
    return;
  }
  if (query.length > MAX_SEARCH_QUERY_LENGTH) {
    res.status(400).json({ error: `Search query too long. Max ${MAX_SEARCH_QUERY_LENGTH} characters.` });
    return;
  }

  try {
    const result = await fetchAutocomplete(query, hl);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('aborted')) {
      res.status(504).json({ error: 'CWS autocomplete request timed out' });
      return;
    }
    res.status(502).json({ error: `CWS autocomplete failed: ${message}` });
  }
});

export default router;
