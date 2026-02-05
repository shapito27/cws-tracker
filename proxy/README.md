# CWS Tracker Proxy - Cloudflare Worker

Cloudflare Worker that proxies Chrome Web Store requests for the CWS Tracker extension.

Chrome blocks extensions from accessing CWS domains directly (CORS, content script injection, scripting API all restricted). This proxy fetches CWS pages server-side and returns content to the extension.

---

## Prerequisites

- A **Cloudflare account** (free plan is sufficient)
- **Node.js** 18+ installed locally
- **npm** installed

---

## Complete Deployment Guide

### Step 1: Create a Cloudflare Account

1. Go to [https://dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up)
2. Sign up with email and password
3. No domain or credit card is required for Workers free tier

**Free tier limits:**
- 100,000 requests per day
- 10ms CPU time per request
- Unlimited Workers

This is more than enough for the CWS Tracker extension.

### Step 2: Install Dependencies

```bash
cd proxy
npm install
```

This installs:
- **wrangler** - Cloudflare's CLI tool for developing, testing, and deploying Workers
- **@cloudflare/workers-types** - TypeScript types for the Workers runtime
- **vitest** + **@cloudflare/vitest-pool-workers** - Testing framework

### Step 3: Authenticate Wrangler with Cloudflare

```bash
npx wrangler login
```

This opens your browser and asks you to authorize Wrangler to access your Cloudflare account. Click **Allow**.

After authorization, Wrangler stores a token locally at `~/.wrangler/config/default.toml`. You won't need to login again on this machine.

To verify it worked:

```bash
npx wrangler whoami
```

This should print your Cloudflare account name and ID.

### Step 4: Generate Your API Key

The proxy requires an API key to prevent unauthorized use. **You create this key yourself** - it's not provided by Cloudflare. It's a shared secret between your extension and your proxy.

Generate a random key:

```bash
# Option A: Using openssl
openssl rand -hex 32

# Option B: Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Option C: Using Python
python3 -c "import secrets; print(secrets.token_hex(32))"
```

This produces something like:
```
a3f8b2c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1
```

**Save this key.** You'll need it in two places:
1. As a secret in Cloudflare Workers (Step 5)
2. In the extension's settings as the proxy API key (later)

### Step 5: Set the API Keys Secret

Secrets are encrypted environment variables that your Worker can read but that never appear in your code or dashboard in plain text.

```bash
npx wrangler secret put API_KEYS
```

When prompted, paste your API key and press Enter. If you want multiple keys (e.g., one for development, one for production), separate them with commas:

```
a3f8b2c4d5e6f7...key1,b4c9d0e1f2a3...key2
```

### Step 6: Deploy

```bash
npm run deploy
```

Wrangler will:
1. Bundle your TypeScript code
2. Upload it to Cloudflare's edge network
3. Print the URL of your deployed Worker

Output looks like:
```
Published cws-tracker-proxy (X.XX sec)
  https://cws-tracker-proxy.<your-subdomain>.workers.dev
```

**Save this URL.** This is your proxy endpoint.

### Step 7: Verify Deployment

Test the health endpoint (no auth needed):

```bash
curl https://cws-tracker-proxy.<your-subdomain>.workers.dev/health
```

Expected response:
```json
{"status":"ok","timestamp":"2026-02-05T...","version":"0.1.0"}
```

Test fetching an extension (auth required):

```bash
curl -H "X-API-Key: YOUR_API_KEY_HERE" \
  "https://cws-tracker-proxy.<your-subdomain>.workers.dev/detail?id=cjpalhdlnbpafiamejdnhcphjbkeiagm"
```

Expected: JSON response with `html` field containing the CWS page HTML.

---

## Local Development

### Run locally

```bash
npm run dev
```

Starts a local dev server at `http://localhost:8787`. For local dev, set the API_KEYS variable in `wrangler.toml` temporarily:

```toml
[vars]
API_KEYS = "dev-test-key"
```

**Important:** Remove this before committing. Use `wrangler secret put` for production keys.

### Run tests

```bash
npm test
```

22 tests covering auth, CORS, validation, routing, and error handling.

### Test locally with curl

```bash
# Health check
curl http://localhost:8787/health

# Fetch extension detail
curl -H "X-API-Key: dev-test-key" \
  "http://localhost:8787/detail?id=cjpalhdlnbpafiamejdnhcphjbkeiagm"

# Fetch search results
curl -H "X-API-Key: dev-test-key" \
  "http://localhost:8787/search?q=ad+blocker"

# Fetch with locale
curl -H "X-API-Key: dev-test-key" \
  "http://localhost:8787/detail?id=cjpalhdlnbpafiamejdnhcphjbkeiagm&hl=ja"
```

---

## API Reference

### Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/detail?id={extensionId}&hl={locale}` | Required | Fetch extension detail page |
| GET | `/search?q={query}&hl={locale}` | Required | Fetch search results page |
| GET | `/health` | None | Health check |

### Authentication

Pass API key via **either** method:

```
# Header (recommended for extension)
X-API-Key: your-api-key

# Query parameter (useful for quick testing)
/detail?id=...&key=your-api-key
```

### Response Format

Successful response (200):

```json
{
  "url": "https://chromewebstore.google.com/detail/cjpalhdlnbpafiamejdnhcphjbkeiagm?hl=en",
  "status": 200,
  "html": "<!doctype html>...",
  "htmlLength": 650000,
  "fetchedAt": "2026-02-05T03:00:00.000Z"
}
```

Error response:

```json
{
  "error": "Description of what went wrong"
}
```

### Parameters

**`/detail` endpoint:**

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `id` | Yes | - | Extension ID (32 lowercase letters) |
| `hl` | No | `en` | Locale code (e.g., `ja`, `es`, `zh-CN`) |

**`/search` endpoint:**

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `q` | Yes | - | Search query (max 200 chars) |
| `hl` | No | `en` | Locale code |

### Error Codes

| Status | Meaning | Example |
|--------|---------|---------|
| 400 | Bad request | Missing `id`, invalid extension ID format, query too long |
| 401 | No API key | Missing `X-API-Key` header and `key` param |
| 403 | Bad API key | Key not in the configured `API_KEYS` list |
| 404 | Bad route | Called an endpoint that doesn't exist |
| 405 | Bad method | Used POST/PUT/etc instead of GET |
| 429 | Rate limited | Exceeded 30 requests/minute for this API key |
| 502 | CWS error | Proxy couldn't fetch from Chrome Web Store |
| 504 | Timeout | CWS didn't respond within 15 seconds |

---

## How it Works

```
Extension                    Cloudflare Worker              Chrome Web Store
   |                              |                              |
   |  GET /detail?id=xxx&key=yyy  |                              |
   |----------------------------->|                              |
   |                              |  GET /detail/xxx?hl=en       |
   |                              |----------------------------->|
   |                              |                              |
   |                              |  200 OK (HTML page)          |
   |                              |<-----------------------------|
   |                              |                              |
   |  200 OK { html: "..." }      |                              |
   |<-----------------------------|                              |
```

1. Extension sends request to proxy with API key
2. Proxy validates API key and checks rate limits
3. Proxy fetches the CWS page server-side (no CORS issues)
4. Proxy wraps the HTML in JSON and returns it with CORS headers
5. Extension parses the HTML to extract extension data

### Security

- **API key auth**: Prevents unauthorized use of your proxy
- **CORS restriction**: Only `chrome-extension://` origins and `localhost` can call the proxy
- **Rate limiting**: 30 req/min per API key (in-memory sliding window)
- **Caching**: 5-minute TTL reduces load on CWS and speeds up responses
- **Input validation**: Extension IDs must be exactly 32 lowercase letters

### Caching

Successful responses are cached for 5 minutes using Cloudflare's Cache API. The `X-Cache` header indicates cache status:
- `X-Cache: HIT` - Served from cache
- `X-Cache: MISS` - Fresh fetch from CWS

---

## Cloudflare Dashboard Management

After deployment, you can manage the Worker at:

```
https://dash.cloudflare.com > Workers & Pages > cws-tracker-proxy
```

From the dashboard you can:
- View request analytics (requests/day, errors, latency)
- View real-time logs (Logs tab > Begin log stream)
- Update environment variables and secrets (Settings > Variables)
- Set up custom domains (Settings > Triggers > Custom Domains)
- Configure additional rate limiting rules (Security > WAF)

### Custom Domain (Optional)

By default your Worker is at `cws-tracker-proxy.<subdomain>.workers.dev`. To use a custom domain:

1. Add a domain to Cloudflare (free plan works)
2. Go to Worker > Settings > Triggers > Custom Domains
3. Add your domain (e.g., `api.cws-tracker.com`)

---

## Updating the Worker

After making code changes:

```bash
npm test           # Verify tests pass
npm run deploy     # Deploy updated code
```

The update is instant and zero-downtime.

---

## Cost

**Free tier covers all expected usage:**

| Limit | Free Tier | Expected Usage |
|-------|-----------|----------------|
| Requests/day | 100,000 | ~100-500 (10 extensions x 20 keywords x daily scan + retries) |
| CPU time/request | 10ms | ~2-5ms (simple fetch relay) |
| Workers | Unlimited | 1 |

You would need the paid plan ($5/month) only if you exceed 100K requests/day, which would require ~200 active users running full scans simultaneously.
