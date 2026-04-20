import type { ScanPhase } from '@/shared/types';

/**
 * Map a ScanPhase to a user-facing label. Undefined/legacy messages
 * without a phase default to the 'running' label.
 */
export function phaseLabel(phase: ScanPhase | undefined): string {
  switch (phase ?? 'running') {
    case 'queued':
      return 'Queued';
    case 'running':
      return 'Scanning';
    case 'waiting':
      return 'Waiting for next job';
    case 'completing':
      return 'Finishing up';
  }
}

/**
 * Progress percentage with "half-credit" for the in-flight job so the bar
 * always visibly advances — even on single-job scans (0% → 50% → 100%).
 */
export function progressPercent(
  completed: number,
  total: number,
  phase: ScanPhase | undefined
): number {
  if (total <= 0) return 0;
  const inFlight = phase === 'running' ? 0.5 : 0;
  const pct = ((completed + inFlight) / total) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}
