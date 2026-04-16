import { describe, it, expect } from 'vitest';
import { computeAmplification, readRetryPolicy } from '../RetryPolicy';

describe('RetryPolicy', () => {
  describe('computeAmplification', () => {
    it('returns 1.0 when errorRate is 0', () => {
      expect(computeAmplification(0, { maxRetries: 3 })).toBe(1);
    });

    it('returns 1.0 when maxRetries is 0', () => {
      expect(computeAmplification(0.8, { maxRetries: 0 })).toBe(1);
    });

    it('computes geometric sum: 1 + e + e² + ... + e^maxRetries', () => {
      // errorRate 0.5, maxRetries 3: 1 + 0.5 + 0.25 + 0.125 = 1.875
      expect(computeAmplification(0.5, { maxRetries: 3 })).toBeCloseTo(1.875, 3);
    });

    it('bounds amplification even at high errorRate', () => {
      // errorRate 0.9, maxRetries 5: 1 + 0.9 + 0.81 + 0.729 + 0.6561 + 0.59049 ≈ 4.686
      expect(computeAmplification(0.9, { maxRetries: 5 })).toBeCloseTo(4.686, 3);
      // Theoretical infinite retries: 1/(1 - 0.9) = 10
      expect(computeAmplification(0.9, { maxRetries: 100 })).toBeLessThan(10);
      expect(computeAmplification(0.9, { maxRetries: 100 })).toBeGreaterThan(9.9);
    });

    it('clamps errorRate outside [0, 1]', () => {
      expect(computeAmplification(-0.5, { maxRetries: 3 })).toBe(1);
      expect(computeAmplification(1.5, { maxRetries: 3 })).toBe(4); // clamps to 1: 1+1+1+1
    });
  });

  describe('readRetryPolicy', () => {
    it('returns undefined when no policy', () => {
      expect(readRetryPolicy({})).toBeUndefined();
    });

    it('returns undefined when maxRetries is 0 or negative', () => {
      expect(readRetryPolicy({ retryPolicy: { maxRetries: 0 } })).toBeUndefined();
      expect(readRetryPolicy({ retryPolicy: { maxRetries: -2 } })).toBeUndefined();
    });

    it('returns undefined when retryPolicy is malformed', () => {
      expect(readRetryPolicy({ retryPolicy: 'nope' })).toBeUndefined();
      expect(readRetryPolicy({ retryPolicy: { maxRetries: 'three' } })).toBeUndefined();
    });

    it('reads maxRetries and optional fields', () => {
      expect(readRetryPolicy({ retryPolicy: { maxRetries: 3 } })).toEqual({
        maxRetries: 3,
        backoffMs: undefined,
        backoffMultiplier: undefined,
      });
      expect(readRetryPolicy({ retryPolicy: { maxRetries: 3, backoffMs: 100, backoffMultiplier: 2 } })).toEqual({
        maxRetries: 3,
        backoffMs: 100,
        backoffMultiplier: 2,
      });
    });

    it('rejects non-finite maxRetries (Infinity would hang computeAmplification)', () => {
      expect(readRetryPolicy({ retryPolicy: { maxRetries: Infinity } })).toBeUndefined();
      expect(readRetryPolicy({ retryPolicy: { maxRetries: NaN } })).toBeUndefined();
    });

    it('rejects fractional maxRetries', () => {
      expect(readRetryPolicy({ retryPolicy: { maxRetries: 1.5 } })).toBeUndefined();
    });

    it('rejects arrays and null', () => {
      expect(readRetryPolicy({ retryPolicy: null } as any)).toBeUndefined();
      expect(readRetryPolicy({ retryPolicy: [3] } as any)).toBeUndefined();
    });

    it('rejects non-finite backoffMs but keeps valid maxRetries', () => {
      expect(readRetryPolicy({ retryPolicy: { maxRetries: 3, backoffMs: Infinity } })).toEqual({
        maxRetries: 3,
        backoffMs: undefined,
        backoffMultiplier: undefined,
      });
    });
  });
});
