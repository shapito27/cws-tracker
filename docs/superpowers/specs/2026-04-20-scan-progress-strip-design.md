# Scan Progress Strip — Design

**Date:** 2026-04-20
**Status:** Approved, ready for implementation plan

## Problem

The dashboard currently exposes scan-progress state in three places:

1. A status block at the bottom of the sidebar (`src/dashboard/App.vue:119-170`) showing phase, current job, progress bar, and countdown.
2. A per-project block on the project Overview tab (`src/dashboard/components/project/OverviewTab.vue:302-320`) with a "Scan Now" button, a bare `0/3` counter, and a "Next job at HH:MM:SS" line.
3. A "Next Scan" stat card on Overview (`OverviewTab.vue:293-299`) that flips to "Scanning…" in blue during a cycle.

The per-project counter (`0/3`) and "Next job at …" line are low-value duplicates of information already shown in the sidebar. The sidebar block itself is visually heavy and placed at the bottom, where it competes with idle-state "Last scan" text and splits attention from the nav.

## Goal

Consolidate scan progress into a single global surface — a thin horizontal strip at the top of the main content area — and clean up the per-project Overview accordingly.

## Design

### Placement

- New component `src/dashboard/components/ScanProgressStrip.vue`.
- Rendered inside `<main>` in `App.vue` as the first child, with `sticky top-0 z-10`.
- Wrapped in `v-if="scanStatus.isRunning"` — completely absent from the DOM when no scan is running (no visual footprint when idle).
- `App.vue` layout stays `flex-row` (sidebar + main). The strip sits above main content only; it does not span over the sidebar.

### Content (one line, left to right)

```
[spinner]  Running  ·  "Fetching listing: Read It Later App"  ━━━━━━━░░░  2/3  ·  next in 12s
```

| Element        | Source                                                                 | Notes                                                        |
| -------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------ |
| Activity icon  | `scanStatus.phase`                                                     | Pulsing blue dot when `running`, spinning SVG otherwise       |
| Phase label    | `phaseLabel(scanStatus.phase)`                                         | "Running" / "Waiting" / "Completing"                          |
| Current job    | `scanStatus.currentJob`                                                | `max-w-md truncate`, `title` attr for full text on hover     |
| Progress bar   | `progressPercent(completed, total, phase)`                             | Fixed `w-40`, `h-1.5`, blue-600 fill                          |
| Counter        | `{completed}/{total}`                                                  | Hidden when `total <= 1` (matches current sidebar rule)       |
| Countdown      | `scanStatus.nextProcessingAt` (live-tick at 1Hz)                       | "next in Ns", shown only during `phase === 'waiting'`         |

Styling: `px-6 py-2`, `bg-blue-50`, `border-b border-blue-100`, text `text-xs` except phase label which is `text-xs font-medium text-blue-700`.

### Responsive behaviour

When the main-content width narrows, elements collapse in this order:

1. Below ~900px: hide the current-job text.
2. Below ~700px: hide the countdown.
3. Progress bar and counter always remain visible.

### Data source

`ScanProgressStrip.vue` calls `useServiceWorker()` directly — no props. Self-contained, same pattern as the current sidebar block. The 1Hz countdown ticker (currently at `App.vue:22-55`) moves into the strip component.

### Changes to `App.vue`

- Remove the entire scan-status footer (lines 119-170), including the idle `lastScanDate` fallback line.
- Move the countdown `watch`/`setInterval` logic into `ScanProgressStrip.vue`.
- Remove now-unused imports (`phaseLabel`, `progressPercent`, `computed` for progress, etc.) if the strip component owns them.

### Changes to `OverviewTab.vue`

In `src/dashboard/components/project/OverviewTab.vue`:

- **Remove** the `{{ completed }}/{{ total }}` counter span (line 311-313).
- **Remove** the "Next job at …" paragraph (line 315-317).
- **Keep** the "Scan Now" button and its `disabled` / "Scanning…" state (line 303-310).
- **Keep** the `lastError` banner (line 318-320) — project-scoped errors stay near the per-project action.
- **Keep** the "Next Scan" stat card (line 293-299) unchanged.

### Out of scope

- `HomePage.vue`'s "Refresh All" button — unchanged.
- Per-keyword scan buttons in `KeywordPositionTable.vue` and `AcPositionTable.vue` — unchanged.
- Popup view — unchanged (separate Vue app, out of this design's scope).

## Testing

- Unit test for `ScanProgressStrip.vue`:
  - Renders nothing when `scanStatus.isRunning === false`.
  - Renders phase label, current job, progress bar, counter, and countdown when running.
  - Counter hidden when `total <= 1`.
  - Countdown hidden outside `waiting` phase.
  - Countdown ticks down at 1Hz (use fake timers).
- Existing `App.vue` test (if any) updated to reflect the removed sidebar block.
- Existing `OverviewTab.vue` tests updated to reflect removed counter + "Next job at" line.

## Versioning

- Bump `manifest.json` to the next MINOR version (UI feature).
- Add `CHANGELOG.md` entry: move scan-progress indicator to a global sticky strip; remove duplicate per-project counter and sidebar footer.
