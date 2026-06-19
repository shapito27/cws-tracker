# Contributing to CWS Tracker

Thanks for your interest in contributing.

## License & the Developer Certificate of Origin (DCO)

CWS Tracker is **source-available, not open source**. It is licensed under the
[PolyForm Noncommercial License 1.0.0](./LICENSE): free for noncommercial use,
with a separate paid license required for commercial use.

Because the maintainer offers commercial licenses, **every contribution must be
made under the Developer Certificate of Origin (DCO)** so that contributed code
can be included in both the noncommercial and the commercial license.

### What this means

By signing off on a commit, you certify the [DCO 1.1](https://developercertificate.org/):
you wrote the code (or have the right to submit it) and you agree it can be
distributed under this project's license — including the maintainer's right to
relicense it commercially.

### How to sign off

Add a `Signed-off-by` line to every commit, using your real name and an email
you can be reached at:

```
Signed-off-by: Jane Doe <jane@example.com>
```

The easy way is to commit with the `-s` flag, which appends the line for you:

```bash
git commit -s -m "Fix ranking parser for empty results"
```

Forgot to sign off? Amend the most recent commit:

```bash
git commit --amend -s --no-edit
```

Pull requests with unsigned commits cannot be merged.

## Before you open a PR

1. `npm test` — all tests pass, no regressions.
2. `npm run typecheck` — zero errors.
3. Follow the conventions in `CLAUDE.md` (TypeScript strict, no `any`, Tailwind
   for styling, parser/queue/IndexedDB rules).
4. Bump `manifest.json` and add a `CHANGELOG.md` entry if your change ships a
   feature or fix.

## Commercial use

If you want to use CWS Tracker commercially, you don't need to contribute — you
need a commercial license. Contact **benmakartni@gmail.com**.
