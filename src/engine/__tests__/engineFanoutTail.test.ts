/**
 * @file engineFanoutTail.test.ts
 *
 * Phase 4.7 — Dean-Barroso "Tail at Scale" (CACM 2013) compounding
 * math. For N fan-out downstreams, P(at_least_one_slow) = 1 − (1 − p)^N
 * where p = per-call probability of slow.
 *
 * The viz is UI-only (see `FanoutTailSection` in
 * `src/components/panels/ConfigPanel.tsx`), but the compounding math is
 * worth pinning so the rendered numbers match the textbook. These tests
 * exercise the pure math directly.
 *
 * Invariants exercised here:
 *   1. Dean-Barroso's headline number: at N=100 with p=0.01, P ≈ 0.63
 *      (the ~63% figure cited in the paper).
 *   2. N=1 degenerate case reduces to just `p`.
 *   3. N=0 (or negative) → P = 0 (no downstreams, no fan-out tail).
 *   4. p=0 → P = 0 regardless of N.
 *   5. p=1 → P = 1 for any N ≥ 1 (every call is slow → every request
 *      sees a slow leg).
 */
import { describe, it, expect } from 'vitest';

/**
 * Inline copy of the fan-out tail probability. Mirrors the calculation
 * in `ConfigPanel.tsx`'s `FanoutTailSection`. Kept local to this test
 * rather than exported from the engine — the calculation isn't an
 * engine input, it's a UI readout.
 */
function pFanoutSlow(n: number, pSingle: number): number {
  if (n < 1 || pSingle <= 0) return 0;
  if (pSingle >= 1) return 1;
  return 1 - Math.pow(1 - pSingle, n);
}

describe('Phase 4.7 — fan-out tail compounding (Dean-Barroso)', () => {
  it('matches Dean-Barroso\'s headline: N=100, p=0.01 → ~63% of requests see a slow leg', () => {
    const p = pFanoutSlow(100, 0.01);
    // 1 - 0.99^100 ≈ 0.634 — the "Tail at Scale" paper's canonical
    // illustration. Two-decimal precision is plenty for a teaching
    // number.
    expect(p).toBeCloseTo(0.634, 2);
  });

  it('N=1 reduces to per-call p — a single leg can\'t compound tails', () => {
    expect(pFanoutSlow(1, 0.01)).toBeCloseTo(0.01, 6);
    expect(pFanoutSlow(1, 0.5)).toBeCloseTo(0.5, 6);
  });

  it('N<1 or N=0 returns 0 — degenerate no-fan-out case', () => {
    expect(pFanoutSlow(0, 0.5)).toBe(0);
    expect(pFanoutSlow(-5, 0.5)).toBe(0);
  });

  it('p=0 returns 0 regardless of N — no individual slow means no compound slow', () => {
    expect(pFanoutSlow(100, 0)).toBe(0);
    expect(pFanoutSlow(1000, 0)).toBe(0);
  });

  it('p>=1 saturates to 1 for any N>=1', () => {
    expect(pFanoutSlow(1, 1)).toBe(1);
    expect(pFanoutSlow(10, 1)).toBe(1);
  });

  it('monotonically increases with N at fixed p', () => {
    let prev = 0;
    for (const n of [1, 2, 5, 10, 50, 100, 1000]) {
      const p = pFanoutSlow(n, 0.01);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });
});
