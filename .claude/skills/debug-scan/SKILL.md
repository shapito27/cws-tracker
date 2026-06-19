---
name: debug-scan
description: Diagnose scan failures by analyzing error patterns, proxy health, and known CWS issues
allowed-tools: Read, Grep, Glob, Bash(curl:*), Task
---

# Debug Scan Failures

Diagnose why scans are failing by checking error patterns, proxy health, and known issues.

## Instructions

### Step 1: Identify the failure context

Check `$ARGUMENTS` for specifics (e.g., extension ID, keyword, error message). If none provided, proceed with a general diagnostic.

### Step 2: Analyze scan log patterns

Read the scan logging infrastructure to understand what's captured:
- `src/shared/types/index.ts` — `ScanLog` interface (fields: responseStatus, error, requestUrl, etc.)
- `src/shared/db/database.ts` — scan_logs table and query methods
- `src/background/queue-processor.ts` — where scan logs are created during processing

Use Grep to search for error handling patterns:
```
Grep for: responseStatus, ParserError, 429, 404, error
In: src/background/
```

### Step 3: Check known error patterns

Cross-reference against known CWS failure patterns (see `references/known-issues.md` in this skill directory):

| Pattern | Symptom | Likely Cause |
|---------|---------|-------------|
| HTTP 429 | Rate limit exceeded | Too many requests; check jitter/delay settings |
| HTTP 404 | Extension not found | Invalid extension ID or delisted |
| Empty response | 0-byte body | CDN cache issue or blocked request |
| ParserError | Missing required field | CWS changed HTML format; parser needs update |
| Network error | fetch failed | Proxy down or DNS issue |
| CSRF/token error | batchexecute fails | Pagination token expired or format changed |

### Step 4: Check proxy health

If the error might be proxy-related, verify the proxy is responding:
```bash
curl -s -o /dev/null -w "%{http_code}" https://cws-tracker-proxy.<domain>.workers.dev/
```

Also check `~/Projects/cws-tracker-proxy/src/index.ts` for any recent changes that might affect request handling.

### Step 5: Check queue processor state

Read `src/background/queue-processor.ts` and look for:
- Jobs stuck in `running` state (should be reset on SW startup)
- Delay/jitter configuration (are requests too fast?)
- Error retry logic (does it back off appropriately?)

### Step 6: Provide diagnosis

Present findings:

```markdown
## Scan Failure Diagnosis

### Error Pattern
[What type of failure was detected]

### Root Cause
[Most likely cause based on evidence]

### Evidence
- [Specific code locations, log patterns, or proxy responses]

### Recommended Fix
1. [Step-by-step fix instructions]
2. [Include file paths and line numbers]

### Prevention
- [How to prevent this in the future]
```

If the issue requires a parser update, suggest running `/save-fixture` to capture a fresh CWS response and compare against existing fixtures.
