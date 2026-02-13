---
name: save-fixture
description: Fetch CWS response via proxy and save as test fixture for parser testing
allowed-tools: Bash(curl:*), Bash(npm test:*), Read, Write, Glob, AskUserQuestion
---

# Save CWS Response Fixture

Capture a live CWS response and save it as a test fixture for parser testing.

## Instructions

### Step 1: Parse arguments

Read `$ARGUMENTS` for:
- **Extension ID** (e.g., `cjpalhdlnbpafiamejdnhcphjbkeiagm`) — for listing fixtures
- **Search query** (e.g., `ad blocker`) — for search fixtures
- **Type**: `listing` or `search` (infer from the argument if not specified)

If no arguments provided, ask the user what to capture.

### Step 2: Fetch the response

For **listing** (detail page):
```bash
curl -s -H "Accept-Language: en-US" "https://chromewebstore.google.com/detail/<extension-id>" -o /tmp/cws-fixture.html
```

For **search** results:
```bash
curl -s -H "Accept-Language: en-US" "https://chromewebstore.google.com/search/<query>" -o /tmp/cws-fixture.html
```

If the proxy is needed (e.g., for bypassing restrictions), adjust the URL to go through the deployed proxy worker.

### Step 3: Validate the response

Read the first 200 characters of the captured response to verify:
- It's valid HTML (not an error page or redirect)
- It contains expected CWS content markers
- It's not empty or truncated

### Step 4: Save to fixtures directory

List existing fixtures to determine naming:
```
tests/fixtures/
```

Save with a descriptive name following the existing pattern:
- Listing: `cws-detail-<lang>-<date>.html` (e.g., `cws-detail-en-2026-02-13.html`)
- Search: `cws-search-<query>-<date>.html` (e.g., `cws-search-adblocker-2026-02-13.html`)

Ask the user to confirm the filename before saving.

### Step 5: Run parser tests

Run parser tests to check if current parsers handle the new fixture:
```bash
npm test -- --grep "parser"
```

### Step 6: Report results

```markdown
## Fixture Saved

| Field | Value |
|-------|-------|
| Type | listing / search |
| Source | URL |
| File | tests/fixtures/filename.html |
| Size | N KB |
| Parser compat | PASS / FAIL |

### Parser Test Results
[Test output summary]
```

If parser tests fail against the new fixture, suggest creating a new parser version (v2, v3, etc.) per the versioned parser strategy in `src/background/parsers/`.
