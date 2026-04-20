import { describe, it, expect } from 'vitest';
import { phaseLabel, progressPercent } from '@/shared/utils/scan-phase';

describe('phaseLabel', () => {
  it('returns "Queued" for phase=queued', () => {
    expect(phaseLabel('queued')).toBe('Queued');
  });

  it('returns "Scanning" for phase=running', () => {
    expect(phaseLabel('running')).toBe('Scanning');
  });

  it('returns "Waiting for next job" for phase=waiting', () => {
    expect(phaseLabel('waiting')).toBe('Waiting for next job');
  });

  it('returns "Finishing up" for phase=completing', () => {
    expect(phaseLabel('completing')).toBe('Finishing up');
  });

  it('defaults to "Scanning" when phase is undefined', () => {
    expect(phaseLabel(undefined)).toBe('Scanning');
  });
});

describe('progressPercent', () => {
  it('returns 0 when total is 0', () => {
    expect(progressPercent(0, 0, 'running')).toBe(0);
  });

  it('returns 50 for a single in-flight job (half-credit)', () => {
    expect(progressPercent(0, 1, 'running')).toBe(50);
  });

  it('returns 0 when queued (no in-flight credit)', () => {
    expect(progressPercent(0, 1, 'queued')).toBe(0);
  });

  it('returns 100 when completing the final job', () => {
    expect(progressPercent(1, 1, 'completing')).toBe(100);
  });

  it('includes half-credit mid-scan', () => {
    // 2 of 4 done, 1 running → (2 + 0.5) / 4 = 62.5 → rounds to 63
    expect(progressPercent(2, 4, 'running')).toBe(63);
  });

  it('no half-credit when waiting between jobs', () => {
    expect(progressPercent(2, 4, 'waiting')).toBe(50);
  });

  it('clamps to 100', () => {
    expect(progressPercent(10, 5, 'completing')).toBe(100);
  });

  it('defaults to no in-flight credit when phase is undefined', () => {
    expect(progressPercent(1, 4, undefined)).toBe(25);
  });
});
