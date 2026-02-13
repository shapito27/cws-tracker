---
name: feature-done
description: Post-implementation review checklist — tests, types, version bump, CHANGELOG, TODO update
allowed-tools: Bash(npm test), Bash(npx tsc:*), Bash(git diff:*), Bash(git log:*), Read, Grep, Glob, Task
---

# Post-Implementation Review

Run the full review checklist from CLAUDE.md to verify a feature is ready.

<test_results>
!`npm test -- --reporter=verbose 2>&1 | tail -30`
</test_results>

<type_check>
!`npx tsc --noEmit 2>&1 | tail -20`
</type_check>

<current_version>
!`node -p "require('./manifest.json').version"`
</current_version>

<main_version>
!`git show main:manifest.json 2>/dev/null | node -p "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).version" 2>/dev/null || echo "unknown"`
</main_version>

<changelog_head>
!`head -20 CHANGELOG.md`
</changelog_head>

<git_status>
!`git status --short`
</git_status>

## Instructions

Run through ALL checklist items below. For each, determine PASS or FAIL with a brief explanation.

### Correctness

1. **All tests pass?** — Check `<test_results>`. If any test failed, report FAIL with the failure details.
2. **Feature matches PRD spec? TODO checkboxes updated?** — Ask the user which feature was implemented. Then read the relevant section of `CWS_Tracker_TODO.md` and verify checkboxes are checked. Read corresponding PRD section to verify spec match.

### Edge Cases

3. **Empty/null inputs handled?** — Use Grep to search new/changed files for potential unhandled null/empty cases. Check that functions validate inputs.
4. **Service worker killed mid-operation — recovers?** — Check if background code uses IndexedDB (not memory) for state. Verify queue processor resets `running` jobs on startup.
5. **CWS returns 404/429/malformed?** — Check error handling in any new fetch/parser code. Look for try/catch around CWS requests.
6. **Empty states for no projects/no data?** — If UI components were added, check for empty state handling (no items, loading states).

### Quality

7. **No `any` types or `@ts-ignore`?** — Use Grep across changed files for `any` type annotations and `@ts-ignore` comments.
8. **Async ops in try/catch? Errors human-readable?** — Check async functions in changed files have error handling.
9. **No context boundary violations?** — Verify background code doesn't import from dashboard/popup and vice versa. Only `src/shared/` should be cross-context.
10. **Works at scale?** — Review any queries or loops for performance with large datasets (365 days x 10 extensions x 20 keywords).

### Versioning

11. **`manifest.json` version bumped?** — Compare `<current_version>` vs `<main_version>`. Must be higher.
12. **`CHANGELOG.md` entry added?** — Check `<changelog_head>` has entry for current version.
13. **DB migration added if schema changed?** — If `database.ts` was modified, verify version was incremented.
14. **Extension loads and smoke test passes?** — Note: this requires manual verification or use `/smoke-test`.

### Report

Present results as a table:

```markdown
## Review Checklist Results

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 1 | Tests pass | PASS/FAIL | details |
| 2 | PRD spec match | PASS/FAIL | details |
...
| 14 | Smoke test | MANUAL | Requires browser verification |

## Summary
- Passed: X/14
- Failed: Y/14
- Manual: Z/14

## Action Items
1. [Any items that need fixing]
```

Use the Task tool to run checks 3-10 in parallel (launch 2 subagents: one for edge cases 3-6, one for quality 7-10) to speed up the review.
