# Phase 0 Spike Results: CWS Response Format Investigation

**Date:** 2026-02-05
**Extension used:** `spike/` directory (MV3, versions 0.1.0 - 0.3.0)
**Test target:** uBlock Origin (`cjpalhdlnbpafiamejdnhcphjbkeiagm`)

---

## Critical Finding: CWS Domains Are Fully Restricted

**Chrome Web Store domains (`chromewebstore.google.com` and `chrome.google.com/webstore`) are protected by Chrome at multiple levels. No extension context can access CWS page content.**

This was tested exhaustively across 6 different approaches:

| # | Approach | Context | Result |
|---|----------|---------|--------|
| 1 | `fetch()` | Service Worker | CORS blocked (`No 'Access-Control-Allow-Origin' header`) |
| 2 | `fetch({ mode: 'no-cors' })` | Service Worker | Opaque response (status 0, empty body, no headers) |
| 3 | Content Script injection | CWS tab | Script never loads ("Receiving end does not exist") |
| 4 | `chrome.scripting.executeScript` | CWS tab | **"The extensions gallery cannot be scripted"** |
| 5 | `fetch()` | Offscreen Document | CORS blocked (same as #1) |
| 6 | `XMLHttpRequest` | Offscreen Document | Network error |
| 7 | `<iframe>` loading CWS | Offscreen Document | Cross-origin frame access blocked |
| 8 | Old CWS AJAX endpoints | Service Worker | CORS blocked |

### Why This Happens

Chrome maintains a **restricted domains list** that prevents extensions from:
- Making network requests to CWS domains (CORS enforced regardless of `host_permissions`)
- Injecting content scripts (even with explicit `matches` patterns)
- Using `chrome.scripting.executeScript` on CWS tabs
- Using `chrome.declarativeNetRequest` to modify CWS request/response headers

This is a security measure to prevent extensions from manipulating the Chrome Web Store itself.

---

## Decision Gate Result

The TODO specifies:

> **Decision Gate:** If CWS requires JS execution to render (Scenario C), STOP and revise architecture to content-script approach before proceeding.

**Result: Worse than Scenario C.** Not only does CWS require JS execution, but Chrome actively prevents ALL extension access to CWS domains. Neither direct fetch nor content script approaches work.

**Architecture revision is REQUIRED before proceeding.**

---

## Revised Architecture Options

### Option 1: Lightweight Proxy Service (Recommended)

**How it works:** Extension sends requests to a proxy server (e.g., Cloudflare Worker), which fetches CWS pages server-side and returns the content.

```
Extension SW → fetch("https://proxy.example.com/cws?id=xxx") → Proxy fetches CWS → Returns HTML/parsed data
```

**Pros:**
- Simple to implement (Cloudflare Workers free tier: 100K requests/day)
- No user interaction required - background scanning works
- Can parse server-side, reducing extension complexity
- Can add caching layer to reduce CWS load

**Cons:**
- Requires hosting infrastructure (even if free-tier)
- Adds a dependency on external service
- Privacy concern: proxy sees which extensions users track
- Proxy IP may get rate-limited by CWS

**Implementation:**
- Cloudflare Worker (~50 lines of code) that:
  1. Accepts extension ID or search query
  2. Fetches `chromewebstore.google.com` with standard browser User-Agent
  3. Returns raw HTML or pre-parsed JSON
- Extension calls proxy instead of CWS directly
- All parsing logic stays in the extension

### Option 2: User-Navigated Capture with webNavigation API

**How it works:** Detect when the user manually visits a CWS page, show a notification/badge, and ask them to click to capture data. Use `chrome.webNavigation` to detect CWS visits.

**Pros:**
- No external infrastructure
- Fully client-side
- No CORS issues (user's browser loads the page naturally)

**Cons:**
- Cannot do automated background scanning
- Requires user action for every data capture
- Poor UX for tracking many extensions/keywords
- Daily automated scans are impossible
- Fundamentally changes the product from "automated tracker" to "manual capture tool"

**Verdict:** Not viable for the intended product. Automated scanning is core functionality.

### Option 3: Hybrid - Proxy for Scanning + Client for Real-time

**How it works:** Combine Options 1 and 2.
- Background scans use proxy service
- When user happens to visit CWS, capture additional data opportunistically

**Pros:**
- Best of both worlds
- Can still work without proxy (degraded mode)

**Cons:**
- More complex to implement
- Still needs proxy for core functionality

### Option 4: Alternative Data Sources

Potential non-CWS sources for extension metadata:

| Source | Data Available | Feasibility |
|--------|---------------|-------------|
| `clients2.google.com/service/update2/crx` | Version, CRX download | Works from extensions, but very limited data |
| Chrome Web Store API (developer) | Own extensions only | Requires OAuth, only for publisher's extensions |
| Third-party APIs (e.g., Chrome Stats) | Varies | Dependency on third party, may have costs |
| Google Search `site:chromewebstore.google.com` | Titles, snippets | Unreliable, rate-limited, incomplete data |

**Verdict:** No single alternative source provides all the data needed (full description, screenshots, translations, permissions, etc.). Could supplement but not replace CWS page parsing.

---

## Recommendation

**Go with Option 1 (Proxy Service) using Cloudflare Workers.**

Rationale:
1. Free tier is sufficient for MVP and early users (100K requests/day)
2. Trivial to deploy and maintain
3. Preserves the core product experience (automated background scanning)
4. Parsing logic stays in the extension (proxy is just a fetch relay)
5. Can migrate to self-hosted if needed later
6. Other CWS tracking tools use the same approach

### Architecture Impact

The change affects:
- **Service Worker fetcher** (`src/background/`): Replace direct CWS fetch with proxy fetch
- **Manifest**: `host_permissions` change from CWS domains to proxy domain
- **Settings**: Add proxy URL configuration
- **Queue Processor**: Fetcher calls proxy instead of CWS
- **Privacy Policy**: Disclose that requests route through proxy

The change does NOT affect:
- Parsers (still parse CWS HTML, just received via proxy)
- IndexedDB layer
- Dashboard/UI
- Queue system logic
- Event detection

### Proxy Implementation

Implemented in `proxy/` directory as a Cloudflare Worker. See `proxy/README.md` for deployment instructions.

**Endpoints:**
- `GET /detail?id={extensionId}&hl={locale}` - Fetch extension detail page
- `GET /search?q={query}&hl={locale}` - Fetch search results page
- `GET /health` - Health check (no auth)

**Features:**
- API key authentication (X-API-Key header or ?key= parameter)
- CORS restricted to `chrome-extension://` origins + localhost
- In-memory rate limiting (30 req/min per API key)
- Cloudflare Cache API (5-minute TTL for successful responses)
- Input validation (32-char lowercase extension IDs, query length limits)
- Timeout handling (15s CWS fetch timeout → 504)
- Error classification (400 bad input, 401/403 auth, 429 rate limit, 502 CWS down, 504 timeout)

**Tests:** 22 passing (auth, CORS, validation, routing, error handling)

---

## CWS Response Format Analysis

Fixtures were captured via `curl` (server-side, bypassing browser restrictions) and saved to `tests/fixtures/`.

### Fixtures Captured

| File | Description | Size | HTTP Status |
|------|-------------|------|-------------|
| `cws-detail-en.html` | uBlock Origin detail page (English) | 635K | 200 |
| `cws-detail-ja.html` | uBlock Origin detail page (?hl=ja) | 639K | 200 |
| `cws-detail-es.html` | uBlock Origin detail page (?hl=es) | 637K | 200 |
| `cws-detail-404.html` | Non-existent extension | 877K | 200 (!) |
| `cws-search-results.html` | Search "ad blocker" | 569K | 200 |
| `cws-search-empty.html` | Search "xyznonexistentkeyword12345" | 428K | 200 |

### Response Format: Hybrid HTML + Embedded JSON

CWS uses a **hybrid approach**: server-rendered HTML with structured data embedded in `<script>` tags via `AF_initDataCallback()` functions.

```html
<script class="ds:0" nonce="...">AF_initDataCallback({key: 'ds:0', hash: '1', data:[...]})</script>
<script class="ds:1" nonce="...">AF_initDataCallback({key: 'ds:1', hash: '2', data:[...]})</script>
```

- **`ds:0`**: Page/layout configuration
- **`ds:1`**: Extension data (detail pages) or search results (search pages)
- Additional `_setImgSrc()` calls set image URLs for screenshots/icons

### Parsing Strategy: Extract AF_initDataCallback JSON

**Recommended approach:**
1. Use regex to extract `AF_initDataCallback({key: 'ds:1', ...})` content
2. Parse the inner data array as JSON
3. Navigate the nested array structure to extract fields

**Alternative approach:**
- Much metadata is also visible as rendered HTML text (name, description, rating)
- Could use DOM parsing as fallback
- But the JSON data in `ds:1` is more structured and reliable

### Detail Page Data Availability

All key fields are available in the raw HTML response:

| Field | Available | Location |
|-------|-----------|----------|
| Extension name | Yes | HTML text + `ds:1` data |
| Short description | Yes | `ds:1` data |
| Full description | Yes | HTML text + `ds:1` data |
| Rating (numeric) | Yes | HTML ("4.7 out of 5") + `ds:1` |
| Rating count | Yes | `ds:1` data |
| User count | Yes | HTML text + `ds:1` |
| Version | Yes | HTML text + `ds:1` |
| Last updated | Yes | `ds:1` data |
| Permissions | Yes | `ds:1` data |
| Screenshots | Yes | `_setImgSrc()` calls (14 for uBlock Origin) |
| Category | Yes | `ds:1` data |
| Developer name | Yes | HTML text + `ds:1` |
| Translations/locales | Yes | `ds:1` data |

### Search Results Data

Search results page (`ds:1` callback) contains an ordered array of extension objects:

- **Extension IDs**: Extractable in ranked order
- **Positions**: 1-based (first in array = position 1)
- **Results found in "ad blocker" search**: 10 extension IDs per page
- **First result**: `gighmmpiobklfepjocnamgkkbiglidom` (AdBlock)

### Non-Existent Extension (404 Behavior)

**Critical finding: HTTP status is always 200**, even for non-existent extensions.

Detection strategy:
- `ds:1` callback is **missing** or contains null/empty data structures
- Extension name string absent from HTML
- No `_setImgSrc()` calls for screenshots
- Must check for presence of extension data in response, NOT HTTP status code

### Locale Behavior (?hl= Parameter)

The `?hl=` parameter successfully localizes content:
- **English**: `<title>uBlock Origin - Chrome Web Store</title>`
- **Japanese**: `<title>uBlock Origin - Chrome ウェブストア</title>`
- **Spanish**: Title stays English, but Chrome Web Store UI text and some metadata localized
- Extension name typically stays the same (brand name)
- Description text is translated if developer provided translations
- Response structure is identical across locales (same `AF_initDataCallback` format)

### Empty Search Results

- Same structure as populated search (`ds:0` + `ds:1` callbacks present)
- `ds:1` contains null/empty nested arrays instead of extension objects
- Must check for empty/null data structures, not missing callbacks

---

## Other Observations

### Domain Migration
- `chrome.google.com/webstore/detail/{id}` (old) → redirects to new domain
- `chromewebstore.google.com/detail/{id}` (new) → canonical
- URL pattern: `chromewebstore.google.com/detail/{extension-name-slug}/{extension-id}`
- The slug in the URL is optional - ID alone works

---

## Test Evidence

### Spike v1 (Direct Fetch from Service Worker)
```
All fetch() calls: "Access-Control-Allow-Origin header not present"
fetch({ mode: 'no-cors' }): Opaque response, status 0, body empty
```

### Spike v2 (Tab + Content Script + chrome.scripting)
```
Content script: "Could not establish connection. Receiving end does not exist."
chrome.scripting.executeScript: "The extensions gallery cannot be scripted."
```

### Spike v3 (Offscreen Document: fetch + XHR + iframe)
```
Offscreen fetch(): "Failed to fetch" (CORS)
Offscreen XHR: "XHR network error"
Offscreen iframe: "Failed to read ... from accessing a cross-origin frame"
```

All tests returned null/empty data. No CWS content was accessible from any extension context.

---

## Phase 0.2: Prototype Parser Results

Parsers implemented in `src/background/parsers/` and tested against all 6 fixtures. **76 tests, all passing.**

### Data Structure Mapping

#### Detail Page (`ds:0` callback)

CWS detail pages use `ds:0` (not `ds:1`) as the main data callback.

**Extension card data** at `data[0]` (20 fields):

| Index | Field | Type | Example |
|-------|-------|------|---------|
| 0 | Extension ID | string | `"cjpalhdlnbpafiamejdnhcphjbkeiagm"` |
| 1 | Icon URL | string | `"https://lh3.googleusercontent.com/..."` |
| 2 | Name | string | `"uBlock Origin"` |
| 3 | Rating (avg) | number | `4.697287542998929` |
| 4 | Rating count | number | `35466` |
| 5 | Screenshot URL 1 | string | `"https://lh3.googleusercontent.com/..."` |
| 6 | Short description | string | `"Finally, an efficient blocker..."` |
| 7 | Website URL | string/null | `null` or `"http://example.com"` |
| 8-10 | Reserved | null | - |
| 11 | Category | array | `["make_chrome_yours/privacy", null, 22]` |
| 12 | Featured flag | number | `1` (1=featured, 0=not) |
| 13 | Promoted flag | number | `1` |
| 14 | User count | number | `16000000` |
| 15 | Reserved | null | - |
| 16 | Screenshot URL 2 | string | `"https://lh3.googleusercontent.com/..."` |
| 17 | Timestamp | array | `[1403571155, 736000000]` (seconds, nanos) |
| 18 | Manifest JSON | string | Full `manifest.json` as JSON string |
| 19 | Name (repeat) | string | `"uBlock Origin"` |

**Extended data** at `data[1-38]`:

| Index | Field | Type | Example |
|-------|-------|------|---------|
| 5 | Screenshots array | array | `[[1, "url"], [1, "url"], ...]` |
| 6 | Full description | string | Multi-paragraph text |
| 10 | Developer info | array | `["email", null, null, null, 1, "display name", ..., "devId"]` |
| 13 | Version | string | `"1.69.0"` |
| 14 | Last updated | array | `[seconds, nanoseconds]` |
| 15 | Size | string | `"4.12MiB"` |
| 16 | Language names | array | `["English", "Deutsch", ...]` (60 items) |
| 22 | Related extensions | array | 12 extension cards (same 20-field format) |
| 26 | Support URL | string | `"https://github.com/..."` |
| 27 | Browser min version | string | `"93.0"` |
| 33 | Privacy policy URL | string | `"https://github.com/.../Privacy-policy"` |
| 38 | Language codes | array | `["en", "de", "ja", ...]` (60 items) |

#### Search Results (`ds:1` callback)

Navigation path to results: `data[0][0][0][5][0][0]`

Each result is triple-nested: `item[0][0]` = 20-field extension card (same format as detail `data[0]`).

Pagination at `data[2]`: `[nextPageToken, null, null, totalCount]`

- 10 results per page
- Position = array index + 1
- Total count available (e.g., 342 for "ad blocker")

#### 404 Detection

- Only `ds:0` callback present (no `ds:1`)
- `ds:0` contains category/browse data, NOT extension data
- `data[0]` does NOT contain a 32-char extension ID at `[0][0]`
- Parser throws `ParserError` when extension ID is missing

#### Empty Search Detection

- Both `ds:0` and `ds:1` present
- Results array at `data[0][0][0][5][0][0]` is empty (`[]`)
- `data[2][3]` = `0` (total count)

### Fields Successfully Extracted

All fields specified in the PRD are extractable:

| Field | Detail Page | Search Results |
|-------|:-----------:|:--------------:|
| Extension ID | ✅ | ✅ |
| Name | ✅ | ✅ |
| Short description | ✅ | ✅ |
| Full description | ✅ | - |
| Version | ✅ | - |
| Developer name | ✅ | - |
| Developer email | ✅ | - |
| Rating (average) | ✅ | ✅ |
| Rating count | ✅ | ✅ |
| User count | ✅ | ✅ |
| Category | ✅ | ✅ |
| Last updated | ✅ | - |
| Size | ✅ | - |
| Languages (names) | ✅ | - |
| Language codes | ✅ | - |
| Icon URL | ✅ | ✅ |
| Screenshot URLs | ✅ | - |
| Website URL | ✅ | - |
| Privacy policy URL | ✅ | - |
| Support URL | ✅ | - |
| Featured flag | ✅ | ✅ |
| Manifest JSON | ✅ | - |
| Browser min version | ✅ | - |
| Search position | - | ✅ |
| Total result count | - | ✅ |
| Next page token | - | ✅ |

### Fields NOT Reliably Extractable

| Field | Issue |
|-------|-------|
| Daily active users | Not in CWS data - only total install count shown |
| Permissions (structured) | Available as raw manifest JSON string - must JSON.parse and extract |
| Individual review text | Not in the detail page data - requires separate review page |
| Install/uninstall trend | Not available - only current total user count |
| Developer response to reviews | Not in detail page data |
| Price/payment info | Not observed in test data (may appear for paid extensions) |

### Locale Consistency

Array indices are **identical** across all tested locales (en, ja, es):
- `data[0][0]` = extension ID (same)
- `data[0][2]` = name (same, brand names not translated)
- `data[0][3]` = rating (same)
- `data[0][6]` = short description (translated)
- `data[6]` = full description (translated)
- All other structural fields identical

**Conclusion:** One parser version handles all locales.
