import { describe, it, expect } from 'vitest';
import { computeAcceptanceRate, readBackpressureConfig } from '../Backpressure';

describe('Backpressure', () => {
  describe('computeAcceptanceRate', () => {
    it('returns 1.0 when errorRate is 0 (healthy)', () => {
      expect(computeAcceptanceRate(0)).toBe(1);
    });

    it('returns 0 when errorRate is 1 (all failing)', () => {
      expect(computeAcceptanceRate(1)).toBe(0);
    });

    it('is a simple inverse: acceptanceRate = 1 - errorRate', () => {
      expect(computeAcceptanceRate(0.3)).toBeCloseTo(0.7, 6);
      expect(computeAcceptanceRate(0.5)).toBe(0.5);
      expect(computeAcceptanceRate(0.85)).toBeCloseTo(0.15, 6);
    });

    it('clamps inputs outside [0, 1]', () => {
      expect(computeAcceptanceRate(-0.5)).toBe(1);
      expect(computeAcceptanceRate(2)).toBe(0);
    });
  });

  describe('readBackpressureConfig', () => {
    it('returns undefined when no config', () => {
      expect(readBackpressureConfig({})).toBeUndefined();
    });

    it('returns undefined when enabled is false', () => {
      expect(readBackpressureConfig({ backpressure: { enabled: false } })).toBeUndefined();
    });

    it('returns undefined when enabled is missing', () => {
      expect(readBackpressureConfig({ backpressure: {} })).toBeUndefined();
    });

    it('returns the config when enabled is true', () => {
      expect(readBackpressureConfig({ backpressure: { enabled: true } })).toEqual({ enabled: true });
    });

    it('rejects null, arrays, primitives', () => {
      expect(readBackpressureConfig({ backpressure: null } as any)).toBeUndefined();
      expect(readBackpressureConfig({ backpressure: [true] } as any)).toBeUndefined();
      expect(readBackpressureConfig({ backpressure: 'enabled' } as any)).toBeUndefined();
    });
  });
});
