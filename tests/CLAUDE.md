# CLAUDE.md - CWS Tracker Tests

Test suite for the CWS Tracker extension. Uses Vitest with fake-indexeddb for database tests and jsdom where needed.

## Test Runner Configuration

- **Config:** `vitest.config.ts` (root)
- **Environment:** Node (not jsdom by default). Components needing DOM can set `// @vitest-environment jsdom`.
- **Setup:** `fake-indexeddb/auto` loaded via `setupFiles` - provides global IndexedDB in Node.
- **Path alias:** `@/` resolves to `src/` (same as main app).
- **Globals:** `true` - `describe`, `it`, `expect`, `vi`, `beforeEach`, `afterEach` available without imports.

## Directory Structure

```
tests/
  mocks/
    chrome.ts           # Full Chrome API mock (storage, alarms, runtime, action, tabs, permissions)
  fixtures/             # Saved CWS responses - NEVER modify these
    cws-detail-en.html  # English extension detail page
    cws-detail-es.html  # Spanish extension detail page
    cws-detail-ja.html  # Japanese extension detail page
    cws-detail-404.html # 404 response
    cws-search-results.html       # Search results page
    cws-search-empty.html         # Empty search results
    cws-search-page2-batchexecute.html  # Pagination via batchexecute
    cws-autocomplete-vpn.json             # Autocomplete (QcU9bc RPC) suggestions
    cws-autocomplete-password-manager.json
    cws-autocomplete-pinterest-wrapped.json
  unit/
    background/         # Service worker tests (queue, scheduler, events, messaging)
    parsers/            # Parser tests against fixtures
    db/                 # Database schema, queries, migrations
    composables/        # Vue composable tests
    dashboard/          # Dashboard component/page tests
    charts/             # Chart annotation and integration tests
    utils/              # Utility function tests
    popup/              # Popup state tests
    mocks/              # Chrome mock self-tests
  integration/
    scan-cycle.test.ts  # End-to-end: queue build -> process -> detect events -> store
```

## Chrome Mock (`tests/mocks/chrome.ts`)

Full in-memory mock for `chrome.storage.local`, `chrome.alarms`, `chrome.runtime`, `chrome.action`, `chrome.tabs`, and `chrome.permissions`. Installed globally via `(globalThis as Record<string, unknown>).chrome = chromeMock`.

### Key exports

| Export | Purpose |
|--------|---------|
| `chromeMock` | The mock object (assigned to `globalThis.chrome`) |
| `resetChromeMock()` | Reset all state - call in `beforeEach()` |
| `getCalls(method?)` | Get recorded calls, optionally filtered by method name |
| `clearCalls()` | Clear the call log |

### Test helpers (on the mock object)

- `chromeMock.alarms._fire(name)` - Trigger an alarm by name
- `chromeMock.runtime._fireInstalled(details)` - Trigger onInstalled
- `chromeMock.action._getBadgeText()` / `_getBadgeColor()` - Read badge state
- `chromeMock.permissions._granted` - Set of granted permissions

### Standard beforeEach pattern

```ts
import { resetChromeMock } from '../../mocks/chrome';
import { db } from '@/shared/db/database';

beforeEach(async () => {
  resetChromeMock();
  // Clear all DB tables for isolation
  await db.projects.clear();
  await db.extensions.clear();
  await db.keywords.clear();
  // ... etc
});
```

## Fixture-Based Parser Testing

Parser tests read saved HTML from `tests/fixtures/` and verify extraction. Never mock parser internals, never make real network calls.

```ts
import { readFileSync } from 'fs';
import { resolve } from 'path';

const html = readFileSync(
  resolve(__dirname, '../../fixtures/cws-detail-en.html'),
  'utf-8'
);
const result = parser.parse(html);
expect(result.name).toBe('...');
```

Adding new fixtures: use the `save-fixture` skill to fetch via proxy and save.

## Database Testing

Tests use `fake-indexeddb/auto` (loaded in setup). Each test should clear relevant tables in `beforeEach` for isolation. The `db` singleton from `@/shared/db/database` works out of the box.

For migration tests: create a separate `CWSDatabase` instance with a unique name to avoid conflicts with the singleton.

## Rules

- Test file names must match source: `queue-processor.ts` -> `queue-processor.test.ts`.
- Test file location mirrors `src/` structure under `unit/`.
- Never make real network calls (no CWS, no OpenAI, no proxy).
- Never modify fixture files - they represent real CWS responses captured at a specific time.
- Mock `fetch` with `vi.fn()` when testing code that makes HTTP requests.
- For composable tests that need `chrome.storage.local`, import and call `resetChromeMock()`.
- DB schema tests verify index structure. Query tests verify data operations. Keep them separate.
