# AGENTS.md

## Commands
- Use `npm install`; this repo has `package-lock.json` and no pnpm/yarn lockfile.
- `npm run dev` starts Vite with CRXJS HMR.
- `npm run build:only` builds to `dist/` only; prefer this for verification.
- `npm run build` and `npm run build:dev` also copy `dist/*` to `${CWS_DIST_DIR:?}/`, so they fail unless that env var is set.
- `npm test` runs all Vitest tests.
- Run one test with `npm test -- tests/path/to/file.test.ts`; do not use Jest flags like `--runInBand`.
- `npm run typecheck` runs `vue-tsc --noEmit` and checks `.vue` files.
- No lint script, CI workflow, pre-commit hook, or formatter config was found; local verification is `npm run typecheck` plus `npm test`.

## Repo-Local Agent Workflows
- `.claude/skills/` and `.claude/commands/` contain useful reusable workflows: `check` for parallel code review, `feature-done` for release-readiness checks, `smoke-test` for browser verification, `debug-scan` for scan failures, `save-fixture` for parser fixtures, and `deploy-proxy` for the separate proxy repo.
- Treat `.claude` workflows as guidance, not command truth; some embedded commands are stale. Prefer the commands in this file and `package.json` when they conflict.
- `.claude/agents/extension-code-reviewer.md` is the most complete review checklist for this extension: context boundaries, MV3 alarm usage, Dexie-only DB access, parser versioning, no `any`/`@ts-ignore`, no real network calls in tests, and scale checks.
- Detailed one-off learnings belong under `docs/`; `CLAUDE.md`/`AGENTS.md` should stay compact entry points.

## Architecture Boundaries
- MV3 entrypoint is `src/background/index.ts`; Chrome event listeners must be registered synchronously at top level.
- `src/background/` is the service worker: no DOM, Vue, or `window`; use `chrome.alarms`, not timers, for durable scheduling.
- `src/dashboard/` is the full Vue app; `src/popup/` is a separate lightweight Vue app.
- `src/shared/` is the only cross-context code: types, Dexie DB wrapper, and pure utilities.
- Chrome runtime messages can fail when the dashboard is closed; wrap `sendMessage` paths defensively.
- Router uses `createWebHashHistory()` because dashboard pages run under `chrome-extension://`.

## Data And Scanning
- All IndexedDB access goes through `CWSDatabase` / `db` in `src/shared/db/database.ts`; do not use raw `indexedDB.open()`.
- Actual Dexie schema is currently v5 and includes `reviews`; older docs mentioning v4 are stale.
- DB version bumps only for schema changes, independent of `manifest.json`.
- Do not await external work such as fetch/OpenAI inside a Dexie transaction.
- Indexed date fields use `YYYY-MM-DD` strings; `Date` objects are for non-indexed metadata.
- CWS scan queue is persisted in IndexedDB and processes one CWS request at a time; never parallelize CWS requests.
- A non-empty proxy URL is required for scans because CWS blocks extension-origin requests.
- The proxy is a separate repo at `~/Projects/cws-tracker-proxy`; do not edit proxy code in this repo.

## Parsers And Tests
- Parsers are versioned under `src/background/parsers/`; if CWS format breaks, add a new parser version instead of mutating old behavior blindly.
- Parser tests use saved fixtures in `tests/fixtures/`; never make real CWS/OpenAI/proxy network calls in tests.
- Vitest defaults to Node with `fake-indexeddb/auto`; component tests needing DOM should opt into jsdom.
- Use `tests/mocks/chrome.ts` for Chrome APIs and call `resetChromeMock()` in isolated tests.
- Test files mirror `src/` under `tests/unit/` and use `[source].test.ts` names.

## Frontend And Styling
- Vue code uses Composition API with `<script setup lang="ts">`; no Pinia.
- Tailwind is v4 through `@tailwindcss/vite`; there is no Tailwind or PostCSS config file.
- Import alias `@/` maps to `src/`.

## Release Workflow
- For shipped features/fixes, bump `manifest.json` and add a `CHANGELOG.md` entry; `package.json` version is not the extension release source.
- `dist/` is a build artifact/prebuilt extension output; do not hand-edit it.
- Contributions require DCO signoff if committing: use `git commit -s`.
