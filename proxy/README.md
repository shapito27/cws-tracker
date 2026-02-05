# CWS Tracker Proxy

Cloudflare Worker that proxies Chrome Web Store requests for the CWS Tracker extension.

Chrome blocks extensions from accessing CWS domains directly (CORS, content script injection, scripting API all restricted). This proxy fetches CWS pages server-side and returns content to the extension.

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/detail?id={extensionId}&hl={locale}` | Required | Fetch extension detail page |
| GET | `/search?q={query}&hl={locale}` | Required | Fetch search results page |
| GET | `/health` | None | Health check |

### Response Format

```json
{
  "url": "https://chromewebstore.google.com/detail/...",
  "status": 200,
  "html": "<!doctype html>...",
  "htmlLength": 650000,
  "fetchedAt": "2026-02-05T03:00:00.000Z"
}
```

### Authentication

Pass API key via header or query parameter:

```
X-API-Key: your-api-key
# or
/detail?id=...&key=your-api-key
```

## Development

```bash
npm install
npm run dev     # Start local dev server on :8787
npm test        # Run tests
```

## Deployment

```bash
# Login to Cloudflare
npx wrangler login

# Set API keys secret
npx wrangler secret put API_KEYS
# Enter: key1,key2,key3

# Deploy
npm run deploy
```

## Configuration

Environment variables (set via `wrangler secret put` or dashboard):

| Variable | Description | Example |
|----------|-------------|---------|
| `API_KEYS` | Comma-separated valid API keys | `key1,key2` |

## Rate Limits

- 30 requests per minute per API key (in-memory sliding window)
- 5-minute cache TTL for successful responses
- 15-second timeout for CWS fetches

## Error Codes

| Status | Meaning |
|--------|---------|
| 400 | Bad request (missing/invalid parameters) |
| 401 | Missing API key |
| 403 | Invalid API key |
| 404 | Unknown endpoint |
| 405 | Method not allowed (only GET supported) |
| 429 | Rate limit exceeded |
| 502 | CWS fetch failed |
| 504 | CWS fetch timed out |
