import { describe, it, expect } from 'vitest';
import {
  computeBote,
  toTwoPhaseProfile,
  formatBytes,
  formatCount,
  DEFAULT_BOTE_INPUTS,
  type BoteInputs,
} from '../bote';

const BASE: BoteInputs = {
  dau: 1_000_000,
  actionsPerUserPerDay: 10,
  readRatio: 0.8,
  payloadBytes: 1_024,
  retentionDays: 365,
  peakMultiplier: 3,
  avgResponseTimeMs: 100,
};

describe('computeBote', () => {
  it('maps known DAU to known QPS (hand calculation)', () => {
    // 1M DAU × 10 actions / 86 400 s = 115.7407… QPS
    const e = computeBote(BASE);
    expect(e.avgQps).toBeCloseTo(115.7407, 3);
    expect(e.peakQps).toBeCloseTo(347.2222, 3);
    expect(e.readQps).toBeCloseTo(92.5926, 3);
    expect(e.writeQps).toBeCloseTo(23.1481, 3);
  });

  it('computes storage growth from write QPS × payload (hand calculation)', () => {
    const e = computeBote(BASE);
    // writes/day = 1M × 10 × 0.2 = 2M; bytes/day = 2M × 1024 = 2.048e9
    const bytesPerDay = 2_000_000 * 1_024;
    expect(e.storageBytesPerMonth).toBeCloseTo(bytesPerDay * 30, 0);
    expect(e.storageBytesAtRetention).toBeCloseTo(bytesPerDay * 365, 0);
  });

  it("computes concurrent connections via Little's Law (N = λ × W)", () => {
    const e = computeBote(BASE);
    expect(e.avgConcurrentConnections).toBeCloseTo(115.7407 * 0.1, 3);
    expect(e.peakConcurrentConnections).toBeCloseTo(347.2222 * 0.1, 3);
  });

  it('clamps malformed inputs instead of returning NaN', () => {
    const e = computeBote({
      dau: NaN,
      actionsPerUserPerDay: -5,
      readRatio: 7,
      payloadBytes: Infinity,
      retentionDays: -1,
      peakMultiplier: 0,
      avgResponseTimeMs: NaN,
    });
    for (const v of Object.values(e)) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(e.avgQps).toBe(0);
  });

  it('clamps peakMultiplier below 1 up to 1 (peak ≥ average)', () => {
    const e = computeBote({ ...BASE, peakMultiplier: 0.5 });
    expect(e.peakQps).toBeCloseTo(e.avgQps, 6);
  });

  it('readRatio 1.0 yields zero writes and zero storage growth', () => {
    const e = computeBote({ ...BASE, readRatio: 1 });
    expect(e.writeQps).toBe(0);
    expect(e.storageBytesPerMonth).toBe(0);
  });
});

describe('toTwoPhaseProfile', () => {
  it('builds a steady baseline phase followed by a peak spike phase', () => {
    const e = computeBote(BASE);
    const p = toTwoPhaseProfile(e, null, 60);
    expect(p.phases).toHaveLength(2);
    expect(p.phases[0]).toMatchObject({ startS: 0, endS: 40, rps: 116, shape: 'steady' });
    expect(p.phases[1]).toMatchObject({ startS: 40, endS: 60, rps: 347, shape: 'spike' });
    expect(p.durationSeconds).toBe(60);
    expect(p.profileName).toBe('BOTE estimate');
  });

  it('preserves requestMix and distribution from an existing profile', () => {
    const e = computeBote(BASE);
    const existing = {
      profileName: 'old',
      durationSeconds: 120,
      phases: [],
      requestMix: { 'GET /items': 1 },
      userDistribution: 'pareto' as const,
      jitterPercent: 12,
      largeServerConcentration: 0.4,
    };
    const p = toTwoPhaseProfile(e, existing, 60);
    expect(p.requestMix).toEqual({ 'GET /items': 1 });
    expect(p.userDistribution).toBe('pareto');
    expect(p.jitterPercent).toBe(12);
    expect(p.largeServerConcentration).toBe(0.4);
  });

  it('preserves the existing profile duration when no override is given', () => {
    const e = computeBote(BASE);
    const existing = {
      profileName: 'old',
      durationSeconds: 120,
      phases: [],
      requestMix: {},
      userDistribution: 'uniform' as const,
      jitterPercent: 5,
    };
    const p = toTwoPhaseProfile(e, existing);
    expect(p.durationSeconds).toBe(120);
    expect(p.phases[1].endS).toBe(120);
    expect(p.phases[0].endS).toBe(80);
  });

  it('floors phase RPS at 1 so tiny DAU still produces a runnable profile', () => {
    const e = computeBote({ ...BASE, dau: 10, actionsPerUserPerDay: 1 });
    const p = toTwoPhaseProfile(e, null);
    expect(p.phases[0].rps).toBeGreaterThanOrEqual(1);
    expect(p.phases[1].rps).toBeGreaterThanOrEqual(p.phases[0].rps);
  });
});

describe('formatters', () => {
  it('formatBytes humanizes base-1024 units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2_048)).toBe('2.0 KB');
    expect(formatBytes(61_440_000_000)).toBe('57.2 GB');
  });

  it('formatBytes rolls up when rounding crosses the unit boundary', () => {
    // 1 048 166 B = 1023.6 KB → rounds to 1024 KB → must render as MB.
    expect(formatBytes(1_048_166)).toBe('1.0 MB');
  });

  it('formatCount humanizes thousands/millions', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(115.7)).toBe('116');
    expect(formatCount(34.7)).toBe('34.7');
    expect(formatCount(2_300_000)).toBe('2.3M');
  });

  it('formatCount rolls up when rounding crosses the bucket boundary', () => {
    expect(formatCount(999.6)).toBe('1.0K');
  });
});

describe('DEFAULT_BOTE_INPUTS', () => {
  it('produces sane defaults end to end', () => {
    const e = computeBote(DEFAULT_BOTE_INPUTS);
    expect(e.avgQps).toBeGreaterThan(0);
    expect(e.peakQps).toBeGreaterThan(e.avgQps);
  });
});
