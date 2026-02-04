# CWS Response Format Investigation Spike

This is a minimal MV3 extension for investigating Chrome Web Store response formats.

## How to Load

1. Open Chrome and go to `chrome://extensions`
2. Enable "Developer mode" (toggle in top-right)
3. Click "Load unpacked"
4. Select this `spike` folder

## How to Use

### Option 1: Click Extension Icon
Click the extension icon in Chrome toolbar to run all tests automatically. This takes several minutes due to rate limit testing (5 requests with 10s delays).

### Option 2: Use Console Commands
1. Go to `chrome://extensions`
2. Find "CWS Spike - Response Investigation"
3. Click "Service Worker" link to open DevTools
4. Use these commands in the console:

```javascript
// Run all tests (takes ~2 minutes)
await runAllTests()

// Run a single quick test
await runQuickTest()

// Individual tests
await testDetailPageNew()      // Fetch detail page (new domain)
await testDetailPageOld()      // Fetch detail page (old domain)
await testSearchPageNew()      // Fetch search results (new domain)
await testSearchPageOld()      // Fetch search results (old domain)
await testAcceptLanguage()     // Test Accept-Language header
await testHlParameter()        // Test ?hl= parameter for locales
await testNonExistent()        // Test 404 response
await testRapidFire()          // 5 rapid requests (no delay)
await testRateLimit()          // 5 requests with 10s delays
```

### Viewing Results

Results are saved to `chrome.storage.local`. To view:

```javascript
// In the service worker console:
chrome.storage.local.get('spikeResults', r => console.log(JSON.stringify(r, null, 2)))

// Or just get the object:
await getResults()
```

## Tests Performed

| Test | Description |
|------|-------------|
| Detail Page (old domain) | Fetches `chrome.google.com/webstore/detail/{id}` |
| Detail Page (new domain) | Fetches `chromewebstore.google.com/detail/{id}` |
| Search Page (old domain) | Fetches `chrome.google.com/webstore/search/{query}` |
| Search Page (new domain) | Fetches `chromewebstore.google.com/search/{query}` |
| Accept-Language | Tests en-US, ja, es, de, zh-CN headers |
| HL Parameter | Tests ?hl=en, ja, es, de, zh-CN |
| Non-Existent | Tests 404 handling with invalid extension ID |
| Rapid Fire | 5 requests with no delay (rate limit test) |
| Rate Limit | 5 requests with 10s delays |

## What to Look For

After running tests, analyze:

1. **Response Format**: Is data in HTML, JSON in script tags, or JS-rendered?
2. **Server-Rendered Content**: Can we extract data without JS execution?
3. **Localization**: Does Accept-Language or ?hl= affect content?
4. **Error Handling**: What does a 404 look like?
5. **Rate Limiting**: Does CWS return 429 for rapid requests?

## Extension ID Used

- uBlock Origin: `cjpalhdlnbpafiamejdnhcphjbkeiagm`
- Non-existent: `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1`
