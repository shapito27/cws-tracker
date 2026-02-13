---
name: smoke-test
description: Build extension, type-check, load in Chrome, and verify dashboard renders without errors
allowed-tools: Bash(npm run build:*), Bash(npx tsc:*), mcp__claude-in-chrome__tabs_context_mcp, mcp__claude-in-chrome__tabs_create_mcp, mcp__claude-in-chrome__navigate, mcp__claude-in-chrome__computer, mcp__claude-in-chrome__read_page, mcp__claude-in-chrome__find, mcp__claude-in-chrome__read_console_messages, mcp__claude-in-chrome__javascript_tool, Read
---

# Build & Browser Smoke Test

Build the extension, verify types, load it in Chrome, and check key pages render correctly.

## Instructions

### Step 1: Type check

Run TypeScript type checking:
```bash
npx tsc --noEmit
```

If type errors exist, report them and stop. Do NOT proceed with a build that has type errors.

### Step 2: Build

Run the production build:
```bash
npm run build
```

Verify the `dist/` directory was created and contains expected files (manifest.json, service worker, dashboard HTML).

### Step 3: Load extension in Chrome

Use Chrome MCP tools to load the built extension:
1. Get tab context with `tabs_context_mcp`
2. Create a new tab with `tabs_create_mcp`
3. Navigate to `chrome://extensions`
4. Enable Developer mode if needed
5. Click "Load unpacked" and select the `dist/` directory

Note: If the extension is already loaded, it may just need a reload/refresh.

### Step 4: Open dashboard

Navigate to the extension's dashboard page:
- The URL will be `chrome-extension://<extension-id>/src/dashboard/index.html`
- Find the extension ID from the extensions page

### Step 5: Check for errors

1. Take a screenshot of the dashboard
2. Read browser console messages filtered for errors:
   ```
   read_console_messages with pattern: "error|Error|ERR|warning|Warning"
   ```
3. Verify key UI elements are present (navigation, main content area)

### Step 6: Navigate key pages

If the dashboard has navigation, click through the main pages:
- Projects/Extensions list
- Rankings/Keywords
- Settings
- Logs

Take a screenshot of each and check console for new errors.

### Step 7: Report results

```markdown
## Smoke Test Report

| Step | Status | Details |
|------|--------|---------|
| Type check | PASS/FAIL | N errors |
| Build | PASS/FAIL | dist/ size |
| Extension load | PASS/FAIL | Extension ID |
| Dashboard render | PASS/FAIL | Screenshot attached |
| Console errors | PASS/FAIL | N errors found |
| Page navigation | PASS/FAIL | N/M pages OK |

### Console Errors (if any)
- [error details]

### Screenshots
[Attached screenshots of key pages]
```
