# Licensing Decision — CWS Tracker

**Date:** 2026-06-19
**Decision:** Release CWS Tracker as **source-available** under the
**PolyForm Noncommercial License 1.0.0** (`PolyForm-Noncommercial-1.0.0`),
with commercial use available under a separate paid license.

This document records the requirements, the reasoning, and the trade-offs
accepted, so the choice can be revisited later with full context.

---

## Requirements (from interview)

| Question | Decision |
|---|---|
| Goal of going public | Keep control / monetize — **not** a pure giveaway |
| A competitor selling a clone of the product | **Not acceptable** |
| OSI "open source" label | **Willing to give up** in exchange for control |
| Time-bomb auto-conversion to OSS (BSL/FSL style) | **No** — stays restricted permanently |
| Who may use it for free | **Noncommercial use only**; any commercial use needs a paid license |
| Contributions | **Required** to be made under an agreement that preserves the right to sell (DCO chosen) |
| Active commercial sales today | **No** — reserve the right now, sell later (LemonSqueezy) |

## Decision

- **Public license:** PolyForm Noncommercial License 1.0.0 — see [`LICENSE`](./LICENSE).
- **Commercial license:** offered separately, on request, to anyone needing
  commercial use. Contact: **benmakartni@gmail.com**.
- **Contributions:** accepted under the **Developer Certificate of Origin (DCO)**;
  every commit must be signed off. See [`CONTRIBUTING.md`](./CONTRIBUTING.md).
- **SPDX identifier in `package.json`:** `PolyForm-Noncommercial-1.0.0`
  (`"private": true` is retained to prevent accidental npm publish).

## Why PolyForm Noncommercial 1.0.0

It is the only license that satisfies every requirement above simultaneously:

- **Source-available, not open source** — matches the explicit choice to trade
  the OSI label for the ability to block commercial competitors. (Do **not**
  market this as "open source"; "source-available" is the correct term.)
- **Permanent** — no time-bomb; it never auto-converts to a permissive license.
- **Noncommercial only** — grants use *"for any purpose other than a commercial
  purpose,"* so all commercial users must obtain a separate paid license. This is
  a textbook **dual-licensing** setup and slots directly into the planned
  LemonSqueezy monetization.
- **Modern and lawyer-drafted** (the PolyForm Project / Heather Meeker): short,
  clear, and includes an explicit **patent grant**.
- **No dependency conflict** — the project's dependencies (Vue, Vite, Dexie,
  ApexCharts, etc.) are MIT/permissive, which impose no copyleft obligation, so a
  restrictive license can be applied to first-party code freely.

## Alternatives considered and rejected

| License | Why rejected |
|---|---|
| **MIT / Apache-2.0** | Permit commercial competitors to clone and sell. Fails the "no competitor clone" requirement. |
| **AGPL-3.0** | True open source; makes cloning *painful* (copyleft) but does **not** forbid commercial competition. Requirement was to forbid it. |
| **BSL 1.1 / FSL-1.1** | Have a time-bomb that converts to OSS after N years. Explicitly not wanted. |
| **Elastic License 2.0 / PolyForm Shield** | Allow general commercial use; only block hosting / building a *competing* product. Too permissive — the requirement is that **all** commercial use needs a paid license. |
| **PolyForm Noncommercial 1.0.0** | ✅ Chosen — non-commercial-only, permanent, source-available, with patent grant. |
| **CC BY-NC 4.0** | Rejected on principle: Creative Commons advises against using CC licenses for software (no patent grant, no source/distribution norms, ambiguous "NonCommercial" definition). |

## Accepted trade-offs / open risks

1. **Your target users are themselves commercial.** Extension developers and ASO
   agencies use a keyword tracker to make money, so under a strict noncommercial
   license **most real users technically need a paid license to use it at all.**
   Consequence: the free tier functions as a **trial / marketing funnel**, not a
   broad free product. Revenue then depends on (a) a smooth paid path being ready
   and (b) willingness to enforce. If broad free commercial *end-use* (while
   still blocking rival ASO tools) becomes the priority, switch to
   **PolyForm Shield** instead.

2. **Cannot be called "open source."** Avoid the term in marketing, GitHub
   topics, and store listings; use "source-available." Some contributors and
   communities are cool toward non-OSI licenses — expect fewer drive-by PRs.

3. **Enforcement is on you.** Source-available licenses are only as strong as the
   licensor's willingness to send notices and pursue violations. The license gives
   a 32-day cure window on first written notice (see `LICENSE` → Violations).

4. **Legal name on the copyright line.** The `LICENSE` currently reads
   `Copyright 2026 Ruslan (https://github.com/shapito27)`. For maximum
   enforceability, replace this with your **full legal name or company entity**
   before promoting the repo.

5. **The proxy is a separate repository** (`~/Projects/cws-tracker-proxy`,
   mirror `github.com/shapito27/cws-tracker-proxy`) and needs its **own** license
   decision. It can match this license or use something more permissive (e.g.,
   MIT) if you want the proxy to be freely reusable — decide deliberately.

## When to revisit

- You decide to actively sell commercial licenses → wire the `LICENSE`/README
  contact line to the LemonSqueezy purchase flow; consider the
  **Prosperity Public License** (built-in commercial trial) if you want a
  self-serve trial-then-pay model.
- Adoption stalls because real users can't use it → reconsider **PolyForm
  Shield** (allow commercial end-use, block only competitors) or **AGPL-3.0**
  (true open source, copyleft).
- You take on a co-founder/company → move copyright to the entity and consider a
  full **CLA** in place of the DCO.

## Files produced by this decision

- [`LICENSE`](./LICENSE) — PolyForm Noncommercial 1.0.0, with the Required Notice
  and commercial-contact header.
- [`README.md`](./README.md) — license summary + commercial-licensing blurb.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — DCO sign-off process for contributors.
- `package.json` — `"license": "PolyForm-Noncommercial-1.0.0"`.
