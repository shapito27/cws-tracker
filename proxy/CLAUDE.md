# CLAUDE.md - CWS Tracker Proxy

Cloudflare Worker that fetches Chrome Web Store pages on behalf of the extension, bypassing Chrome's restriction on extension access to CWS domains.

**This is a separate npm package** with its own `package.json`, `tsconfig.json`, and test config. It shares NO code with the main extension.

## Architecture

Single-file Worker (`src/index.ts`) handling all routing, auth, rate limiting, caching, and CWS fetching. No framework - plain Request/Response handlers.

### Endpoints

| Endpoint | Purpose | Key Params |
|----------|---------|------------|
| `GET /detail` | Fetch extension detail page | `id` (32-char CWS ID), `hl` (locale) |
| `GET /search` | Fetch search results (supports pagination) | `q` (query), `hl` (locale), `page` (optional) |
| `GET /health` | Health check | none |

### Security

- **Auth:** API key required via `X-API-Key` header or `?key=` query param. Keys defined in `wrangler.toml` `API_KEYS` var (comma-separated).
- **CORS:** Restricted to `chrome-extension://` origins only.
- **Rate limiting:** 30 requests/minute per API key. In-memory sliding window (per-isolate, resets on cold start).

### Caching

- 5-minute TTL using the Cache API.
- Build label for batchexecute requests cached for 1 hour.

### Pagination

Search results beyond page 1 use CWS `batchexecute` RPC endpoint. The Worker extracts the build label from initial search page HTML, then constructs batchexecute POST requests with the `zTyKYc` RPC method. Page size is 10 results.

## Tech Stack

- **Runtime:** Cloudflare Workers (V8 isolates, NOT Node.js)
- **Deploy:** Wrangler CLI (always use `npx wrangler`, never bare `wrangler`)
- **TypeScript:** Strict mode, ES2022, `@cloudflare/workers-types`
- **Testing:** Vitest with `@cloudflare/vitest-pool-workers` (runs tests inside Workers runtime via Miniflare)

## Commands

```bash
npm test              # Run all tests (22 tests covering auth, CORS, validation, routing, caching)
npm run test:watch    # Watch mode
npx wrangler dev      # Local dev server on port 8787
npx wrangler deploy   # Deploy to production
```

## Testing

Tests run inside a real Workers runtime (Miniflare), not Node.js. The `vitest.config.ts` injects test bindings:
- `API_KEYS`: `'test-key-1,test-key-2'`
- `ENVIRONMENT`: `'test'`

Tests use `SELF.fetch()` to make requests to the Worker (Workers pool auto-binds it).

## Key Constants

```
CWS_FETCH_TIMEOUT_MS  = 15,000ms
RATE_LIMIT_MAX        = 30 req/min/key
CACHE_TTL             = 300s (5 min)
BUILD_LABEL_CACHE_TTL = 3,600s (1 hour)
EXTENSION_ID_REGEX    = /^[a-z]{32}$/
MAX_SEARCH_QUERY      = 200 chars
```

## Rules

- No shared imports from `src/` of the main extension. This is a standalone package.
- Always validate extension IDs with the 32-char lowercase regex before forwarding to CWS.
- CWS fetches have a 15s timeout via `AbortController`.
- User-Agent header is spoofed to look like a real browser.
- Never expose internal error details to clients - return generic error messages.
- Rate limit is per-isolate (in-memory Map). It resets on cold starts - this is acceptable.
