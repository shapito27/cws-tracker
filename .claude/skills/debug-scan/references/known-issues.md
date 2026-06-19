# Known CWS Failure Patterns

Reference document for diagnosing scan failures. Updated as new patterns are discovered.

## HTTP 429 — Rate Limiting

**Symptom:** `responseStatus: 429` in scan logs.

**Cause:** Too many requests to CWS in a short window.

**Fix:**
- Check delay/jitter configuration in `src/background/queue-processor.ts`
- Ensure randomized jitter is applied (never flat delays)
- Increase base delay between requests
- Verify queue processes ONE job at a time (never parallel CWS requests)

**Prevention:** Minimum 2-3 seconds between requests with +/- 1s random jitter.

---

## HTTP 404 — Extension Not Found

**Symptom:** `responseStatus: 404` for a specific extension ID.

**Cause:** Extension was delisted, removed, or the ID is invalid.

**Fix:**
- Verify the extension ID is correct (32 lowercase letters)
- Check if extension is still available at `https://chromewebstore.google.com/detail/<id>`
- Mark extension as inactive in the database if confirmed delisted

---

## Empty / 0-byte Response

**Symptom:** `responsePreview` is empty, `responseStatus` is 200.

**Cause:** CDN cache returned empty response, or request was silently blocked.

**Fix:**
- Retry the request after a longer delay
- Check if the proxy is stripping the response body
- Verify `Accept-Language` and `User-Agent` headers are being sent

---

## ParserError — Missing Required Field

**Symptom:** `ParserError` thrown with field name (e.g., `field: rating`).

**Cause:** CWS changed their HTML structure. The parser's CSS selectors or data extraction logic no longer matches.

**Fix:**
1. Run `/save-fixture` to capture the current CWS response
2. Compare against existing fixtures in `tests/fixtures/`
3. Create a NEW parser version (e.g., `listing-v2.ts`) — do NOT modify the existing parser
4. Update `parser-factory.ts` to detect and use the new version
5. Add the new fixture to parser tests

**Key files:**
- `src/background/parsers/types.ts` — Parser interfaces
- `src/background/parsers/listing-v1.ts` — Current listing parser
- `src/background/parsers/search-v1.ts` — Current search parser
- `src/background/parsers/parser-factory.ts` — Version selection logic

---

## Pagination / batchexecute Failures

**Symptom:** First page of search results works, page 2+ fails or returns empty.

**Cause:** CWS uses a `batchexecute` POST endpoint for pagination. The request requires:
- A valid CSRF/session token
- Specific POST body format with page token
- Correct `Content-Type` header

**Fix:**
- Check if `nextPageToken` from `SearchData` is being extracted correctly
- Verify the POST body format matches what CWS expects
- Ensure CSRF tokens are fresh (not cached from previous sessions)
- Reference: `tests/fixtures/cws-search-page2-batchexecute.html`

---

## Network / Fetch Errors

**Symptom:** `error` field populated, `responseStatus: null`.

**Cause:** DNS resolution failed, proxy is down, or network connectivity issue.

**Fix:**
- Check proxy health: `curl -s https://cws-tracker-proxy.<domain>.workers.dev/`
- Check `~/Projects/cws-tracker-proxy/src/index.ts` for recent changes
- Verify Cloudflare Worker is deployed and not hitting resource limits

---

## Service Worker Killed Mid-Scan

**Symptom:** Jobs stuck in `running` state. No new scan logs being created.

**Cause:** Chrome killed the service worker during a scan operation.

**Fix:**
- Verify `queue-processor.ts` resets `running` jobs to `pending` on startup
- Check that no `setTimeout`/`setInterval` is used (use `chrome.alarms` instead)
- Ensure state is persisted to IndexedDB, not in-memory variables

---

## Proxy CORS / Header Issues

**Symptom:** Fetch fails in service worker with CORS error.

**Cause:** Proxy not returning proper CORS headers, or CWS response headers are being passed through incorrectly.

**Fix:**
- Check proxy CORS configuration in `~/Projects/cws-tracker-proxy/src/index.ts`
- Ensure `Access-Control-Allow-Origin` is set for the extension origin
- Verify preflight (OPTIONS) requests are handled
