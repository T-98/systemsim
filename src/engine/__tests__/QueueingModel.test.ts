import { describe, it, expect } from 'vitest';
import { computeQueueing } from '../QueueingModel';

describe('QueueingModel', () => {
  it('returns zero wait time at zero load', () => {
    const r = computeQueueing({ arrivalRateRps: 0, processingTimeMs: 50, instanceCount: 3, maxConcurrentPerInstance: 1000 });
    expect(r.utilization).toBe(0);
    expect(r.waitTimeMs).toBe(0);
    expect(r.dropRate).toBe(0);
  });

  it('computes low utilization correctly', () => {
    const r = computeQueueing({ arrivalRateRps: 10, processingTimeMs: 50, instanceCount: 3, maxConcurrentPerInstance: 1000 });
    expect(r.utilization).toBeLessThan(0.5);
    expect(r.waitTimeMs).toBeLessThan(r.p50Ms);
    expect(r.dropRate).toBe(0);
  });

  it('shows increasing latency as utilization rises', () => {
    const low = computeQueueing({ arrivalRateRps: 10, processingTimeMs: 50, instanceCount: 1, maxConcurrentPerInstance: 1000 });
    const high = computeQueueing({ arrivalRateRps: 18, processingTimeMs: 50, instanceCount: 1, maxConcurrentPerInstance: 1000 });
    expect(high.p50Ms).toBeGreaterThan(low.p50Ms);
    expect(high.p99Ms).toBeGreaterThan(low.p99Ms);
    expect(high.utilization).toBeGreaterThan(low.utilization);
  });

  it('clamps utilization at 1.0', () => {
    const r = computeQueueing({ arrivalRateRps: 100, processingTimeMs: 50, instanceCount: 1, maxConcurrentPerInstance: 1000 });
    expect(r.utilization).toBeLessThanOrEqual(1);
  });

  it('produces drops when concurrent requests exceed capacity', () => {
    const r = computeQueueing({ arrivalRateRps: 50000, processingTimeMs: 100, instanceCount: 1, maxConcurrentPerInstance: 100 });
    expect(r.dropRate).toBeGreaterThan(0);
  });

  it('more instances reduce utilization', () => {
    const one = computeQueueing({ arrivalRateRps: 15, processingTimeMs: 50, instanceCount: 1, maxConcurrentPerInstance: 1000 });
    const three = computeQueueing({ arrivalRateRps: 15, processingTimeMs: 50, instanceCount: 3, maxConcurrentPerInstance: 1000 });
    expect(three.utilization).toBeLessThan(one.utilization);
    expect(three.p99Ms).toBeLessThan(one.p99Ms);
  });

  it('p50 < p95 < p99', () => {
    const r = computeQueueing({ arrivalRateRps: 15, processingTimeMs: 50, instanceCount: 1, maxConcurrentPerInstance: 1000 });
    expect(r.p50Ms).toBeLessThan(r.p95Ms);
    expect(r.p95Ms).toBeLessThan(r.p99Ms);
  });
});
