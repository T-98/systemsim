/**
 * @file engineKingman.test.ts
 *
 * Phase 4.6 — Kingman G/G/1 replaces M/M/1 in `QueueingModel.computeQueueing`
 * via a two-moment Whitt 1993 approximation:
 *
 *   waitTime ≈ ρ/(1 − ρ) × (Cₐ² + C_s²)/2 × processingTime
 *
 * Cₐ² derives from the traffic phase shape (prior, not measurement);
 * C_s² from the component's optional `config.serviceVariance` (default 1.0).
 * The `Cₐ² = C_s² = 1.0` case must collapse to M/M/1 exactly — that's the
 * back-compat invariant every pre-Phase-4.6 engine test implicitly
 * asserts.
 *
 * Invariants exercised here:
 *   1. DEGENERATE M/M/1 CASE: serviceVariance = 1.0 under a steady
 *      traffic phase reproduces the pre-Phase-4.6 waitTime formula
 *      `procTime × ρ/(1-ρ)` bit-identical.
 *   2. HIGH SERVICE VARIANCE extends latency. serviceVariance = 4.0 at
 *      the same utilization produces meaningfully higher p99 than 1.0.
 *   3. BURSTY ARRIVALS extend latency. A phase tagged `instant_spike`
 *      (Cₐ² = 4.0) produces higher p99 than `steady` at the same ρ.
 *   4. LOW SERVICE VARIANCE (near-deterministic) CUTS wait. 0.1
 *      produces lower p99 than 1.0 at identical ρ.
 *   5. NO TRAFFIC still returns zero wait — the degenerate branch at
 *      `arrivalRateRps <= 0` doesn't read variance params.
 */
import { describe, it, expect } from 'vitest';
import { computeQueueing } from '../QueueingModel';
import { SimulationEngine } from '../SimulationEngine';
import type { TrafficProfile, SimComponentData, WireConfig } from '../../types';
import type { Node, Edge } from '@xyflow/react';

const SEED = 42;

function node(id: string, type: string, config: Record<string, unknown> = {}): Node<SimComponentData> {
  return {
    id,
    position: { x: 0, y: 0 },
    data: {
      type: type as SimComponentData['type'],
      label: id,
      config: { instanceCount: 1, ...config },
      health: 'healthy',
      metrics: { rps: 0, p50: 0, p95: 0, p99: 0, errorRate: 0, cpuPercent: 0, memoryPercent: 0 },
    },
  } as Node<SimComponentData>;
}

function edge(id: string, source: string, target: string): Edge<{ config: WireConfig }> {
  return {
    id,
    source,
    target,
    data: { config: { throughputRps: 1_000_000, latencyMs: 0, jitterMs: 0 } },
  } as Edge<{ config: WireConfig }>;
}

function steady(rps: number): TrafficProfile {
  return {
    profileName: 'kg-steady',
    durationSeconds: 5,
    jitterPercent: 0,
    phases: [{ startS: 0, endS: 5, rps, shape: 'steady' as const, description: 'steady' }],
    requestMix: { default: 1 },
    userDistribution: 'uniform',
  } as unknown as TrafficProfile;
}

function spike(rps: number): TrafficProfile {
  return {
    profileName: 'kg-spike',
    durationSeconds: 5,
    jitterPercent: 0,
    phases: [{ startS: 0, endS: 5, rps, shape: 'instant_spike' as const, description: 'spike' }],
    requestMix: { default: 1 },
    userDistribution: 'uniform',
  } as unknown as TrafficProfile;
}

describe('Phase 4.6 — Kingman G/G/1 via Whitt 1993 two-moment', () => {
  it('degenerate case: Cₐ² = C_s² = 1.0 reproduces the M/M/1 formula exactly', () => {
    // Pre-Phase-4.6 formula: waitTime = procTime × ρ/(1-ρ). At ρ=0.5 with
    // procTime=10ms → waitTime = 10ms. Kingman: 10 × 0.5/(1-0.5) × (1+1)/2
    // = 10ms × 1 = 10ms. Bit-identical.
    const q = computeQueueing({
      arrivalRateRps: 50,
      processingTimeMs: 10,
      instanceCount: 1,
      maxConcurrentPerInstance: 1000,
      // variance omitted = defaults = 1.0
    });
    expect(q.utilization).toBeCloseTo(0.5, 6);
    expect(q.waitTimeMs).toBeCloseTo(10, 6);
  });

  it('high serviceVariance extends latency measurably at the same utilization', () => {
    const base = computeQueueing({
      arrivalRateRps: 80,
      processingTimeMs: 10,
      instanceCount: 1,
      maxConcurrentPerInstance: 1000,
      serviceVariance: 1.0,
    });
    const bursty = computeQueueing({
      arrivalRateRps: 80,
      processingTimeMs: 10,
      instanceCount: 1,
      maxConcurrentPerInstance: 1000,
      serviceVariance: 4.0,
    });
    // (1 + 4) / 2 = 2.5× the M/M/1 wait. At ρ=0.8 M/M/1 wait = 40, Kingman
    // with Cs²=4 wait = 100. p99 scales with totalLatency.
    expect(bursty.waitTimeMs / base.waitTimeMs).toBeCloseTo(2.5, 2);
    expect(bursty.p99Ms).toBeGreaterThan(base.p99Ms);
  });

  it('instant_spike phase shape produces higher server p99 than steady at same ρ', () => {
    // Two engines at identical RPS — one steady (Cₐ²=1.0), one spike
    // (Cₐ²=4.0). Spike wait = 5/2 = 2.5× steady at the same ρ.
    const nodes = [node('s', 'server', { isEntry: true, processingTimeMs: 10, maxConcurrent: 1000 })];
    const edges: Edge<{ config: WireConfig }>[] = [];
    const steadyEng = new SimulationEngine(nodes, edges, steady(80), undefined, undefined, SEED);
    const spikeEng = new SimulationEngine(nodes, edges, spike(80), undefined, undefined, SEED);
    const { metrics: ms } = steadyEng.tick();
    const { metrics: sp } = spikeEng.tick();
    expect(sp.s.p99).toBeGreaterThan(ms.s.p99);
    // Ratio should be roughly (1 + 4)/2 / (1+1)/2 = 2.5 at the same ρ.
    expect(sp.s.p99 / ms.s.p99).toBeGreaterThan(2.0);
    expect(sp.s.p99 / ms.s.p99).toBeLessThan(3.0);
  });

  it('low serviceVariance (near-deterministic) cuts wait below M/M/1', () => {
    const mm1 = computeQueueing({
      arrivalRateRps: 80,
      processingTimeMs: 10,
      instanceCount: 1,
      maxConcurrentPerInstance: 1000,
      serviceVariance: 1.0,
    });
    const deterministic = computeQueueing({
      arrivalRateRps: 80,
      processingTimeMs: 10,
      instanceCount: 1,
      maxConcurrentPerInstance: 1000,
      serviceVariance: 0.1,
    });
    // (1 + 0.1)/2 = 0.55× M/M/1 wait. At ρ=0.8 M/M/1 wait = 40ms; det = 22ms.
    expect(deterministic.waitTimeMs).toBeLessThan(mm1.waitTimeMs);
    expect(deterministic.waitTimeMs / mm1.waitTimeMs).toBeCloseTo(0.55, 2);
  });

  it('zero arrival rate returns zero wait regardless of variance params', () => {
    const q = computeQueueing({
      arrivalRateRps: 0,
      processingTimeMs: 10,
      instanceCount: 1,
      maxConcurrentPerInstance: 1000,
      arrivalVariance: 4.0,
      serviceVariance: 4.0,
    });
    expect(q.waitTimeMs).toBe(0);
    expect(q.utilization).toBe(0);
  });
});
