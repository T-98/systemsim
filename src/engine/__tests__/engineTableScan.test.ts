/**
 * @file engineTableScan.test.ts
 *
 * Phase 4.4 — when an endpoint's `TableAccess.indexed === false` fires
 * against a DB, the DB's base latency gets multiplied by
 * `1 + (SCAN_FACTOR - 1) × unindexedShare` where `SCAN_FACTOR = 10`.
 * The constant is locked to preflight.ts's "10x slower" copy
 * (Decisions §55); these tests pin both the math and the one-shot
 * callout dedup.
 *
 * Invariants exercised here:
 *   1. Measurable p50 latency increase proportional to unindexed share —
 *      20% unindexed ⇒ 2.8× dbLatency (1 + 9×0.2).
 *   2. 0% unindexed traffic is a no-op — p50 stays on the pre-Phase-4.4
 *      curve.
 *   3. `unindexed-scan:<tableId>` callout fires exactly once over
 *      multiple ticks (`firedCallouts` dedup is per-run).
 *   4. Below-threshold unindexed share (< 5%) doesn't fire the callout
 *      even though the multiplier still applies.
 *   5. Multiple un-indexed tables produce distinct callouts (key includes
 *      `tableId`).
 */
import { describe, it, expect } from 'vitest';
import { SimulationEngine, type RoutingContext } from '../SimulationEngine';
import type {
  TrafficProfile,
  SimComponentData,
  WireConfig,
  EndpointRoute,
  SchemaMemoryBlock,
  SchemaEntity,
} from '../../types';
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

function edge(id: string, source: string, target: string, config: Partial<WireConfig> = {}): Edge<{ config: WireConfig }> {
  return {
    id,
    source,
    target,
    data: { config: { throughputRps: 1_000_000, latencyMs: 0, jitterMs: 0, ...config } },
  } as Edge<{ config: WireConfig }>;
}

function profile(rps: number, requestMix: Record<string, number>, durationSeconds = 10): TrafficProfile {
  return {
    profileName: 'scan',
    durationSeconds,
    jitterPercent: 0,
    phases: [{ startS: 0, endS: durationSeconds, rps, shape: 'steady' as const, description: 'scan' }],
    requestMix,
    userDistribution: 'uniform',
  } as unknown as TrafficProfile;
}

function entity(id: string, name: string, assignedDbId: string | null): SchemaEntity {
  return { id, name, fields: [], indexes: [], accessPatterns: [], assignedDbId };
}

function schema(entities: SchemaEntity[]): SchemaMemoryBlock {
  return { version: 1, entities, relationships: [], aiNotes: '' };
}

function dbGraph() {
  // DB is the entry point so there's no upstream api_gateway adding a
  // constant 2ms of accumulated latency that would dilute the multiplier
  // ratio under test. (Real topologies always have an upstream; the
  // multiplier still fires correctly — we just can't assert the 2.8×
  // directly on p50 without subtracting the constant.)
  const nodes = [
    node('db', 'database', {
      isEntry: true,
      readThroughputRps: 100_000,
      writeThroughputRps: 100_000,
      readReplicas: 0,
      connectionPoolSize: 10_000,
    }),
  ];
  const edges: Edge<{ config: WireConfig }>[] = [];
  return { nodes, edges };
}

describe('Phase 4.4 — unindexed-scan latency multiplier (10×) + one-shot callout', () => {
  it('applies the (1 + 9×share) multiplier to dbLatency for 20% unindexed traffic', () => {
    // Two endpoints, 50/50 by weight. One reads table posts with indexed=false,
    // other reads table users with indexed=true. But we want 20% unindexed —
    // so weight the unindexed endpoint at 20% of total.
    const { nodes, edges } = dbGraph();
    const routes: EndpointRoute[] = [
      {
        endpointId: 'ep-scan',
        componentChain: ['db'],
        tablesAccessed: [{ tableId: 'posts', mode: 'read', indexed: false }],
        weight: 1,
        estimatedPayloadBytes: 0,
      },
      {
        endpointId: 'ep-ok',
        componentChain: ['db'],
        tablesAccessed: [{ tableId: 'users', mode: 'read', indexed: true }],
        weight: 1,
        estimatedPayloadBytes: 0,
      },
    ];
    const ctx: RoutingContext = {
      endpointRoutes: routes,
      schemaMemory: schema([entity('posts', 'posts', 'db'), entity('users', 'users', 'db')]),
      requestMix: { 'ep-scan': 0.2, 'ep-ok': 0.8 },
    };
    // Same topology, same RPS, same schema — but unindexed share = 0 in the
    // baseline run. Compare the DB's p50 directly.
    const baselineRoutes: EndpointRoute[] = [
      {
        ...routes[0],
        tablesAccessed: [{ tableId: 'posts', mode: 'read', indexed: true }],
      },
      routes[1],
    ];
    const baseline = new SimulationEngine(
      nodes, edges, profile(100, { 'ep-scan': 0.2, 'ep-ok': 0.8 }),
      undefined, undefined, SEED, false,
      { ...ctx, endpointRoutes: baselineRoutes },
    );
    const runWithScan = new SimulationEngine(
      nodes, edges, profile(100, { 'ep-scan': 0.2, 'ep-ok': 0.8 }),
      undefined, undefined, SEED, false,
      ctx,
    );
    const p50Baseline = baseline.tick().metrics.db.p50;
    const p50Scan = runWithScan.tick().metrics.db.p50;
    // Expected: 1 + 9×0.2 = 2.8× multiplier. Wire latency (0) + baseline
    // adds nothing, so ratio of p50s ≈ 2.8 when load is identical.
    expect(p50Baseline).toBeGreaterThan(0);
    const ratio = p50Scan / p50Baseline;
    expect(ratio).toBeCloseTo(2.8, 1);
  });

  it('no unindexed traffic → no multiplier, no callout', () => {
    const { nodes, edges } = dbGraph();
    const routes: EndpointRoute[] = [
      {
        endpointId: 'ep-ok',
        componentChain: ['db'],
        tablesAccessed: [{ tableId: 'users', mode: 'read', indexed: true }],
        weight: 1,
        estimatedPayloadBytes: 0,
      },
    ];
    const engine = new SimulationEngine(
      nodes, edges, profile(100, { 'ep-ok': 1 }),
      undefined, undefined, SEED, false,
      { endpointRoutes: routes, schemaMemory: schema([entity('users', 'users', 'db')]), requestMix: { 'ep-ok': 1 } },
    );
    const { newLogs, metrics } = engine.tick();
    expect(metrics.db.p50).toBeGreaterThan(0);
    expect(newLogs.some((l) => l.message.includes('unindexed'))).toBe(false);
  });

  it('callout fires exactly once across multiple ticks for the same (dbId, tableId)', () => {
    const { nodes, edges } = dbGraph();
    const routes: EndpointRoute[] = [
      {
        endpointId: 'ep-scan',
        componentChain: ['db'],
        tablesAccessed: [{ tableId: 'posts', mode: 'read', indexed: false }],
        weight: 1,
        estimatedPayloadBytes: 0,
      },
    ];
    const engine = new SimulationEngine(
      nodes, edges, profile(100, { 'ep-scan': 1 }, 5),
      undefined, undefined, SEED, false,
      { endpointRoutes: routes, schemaMemory: schema([entity('posts', 'posts', 'db')]), requestMix: { 'ep-scan': 1 } },
    );
    // Run 5 ticks; callout must appear exactly once across all logs.
    let firedCount = 0;
    for (let i = 0; i < 5; i++) {
      const { newLogs } = engine.tick();
      firedCount += newLogs.filter((l) => l.message.includes('unindexed access on "posts"')).length;
    }
    expect(firedCount).toBe(1);
  });

  it('below-threshold unindexed share (< 5%) does not fire the callout', () => {
    // ep-scan weighted at 1%, ep-ok at 99% — 1% unindexed share is below
    // the 5% threshold. Multiplier still applies (1 + 9×0.01 = 1.09) but
    // we don't warn on it.
    const { nodes, edges } = dbGraph();
    const routes: EndpointRoute[] = [
      {
        endpointId: 'ep-scan',
        componentChain: ['db'],
        tablesAccessed: [{ tableId: 'posts', mode: 'read', indexed: false }],
        weight: 1,
        estimatedPayloadBytes: 0,
      },
      {
        endpointId: 'ep-ok',
        componentChain: ['db'],
        tablesAccessed: [{ tableId: 'users', mode: 'read', indexed: true }],
        weight: 1,
        estimatedPayloadBytes: 0,
      },
    ];
    const engine = new SimulationEngine(
      nodes, edges, profile(100, { 'ep-scan': 0.01, 'ep-ok': 0.99 }),
      undefined, undefined, SEED, false,
      {
        endpointRoutes: routes,
        schemaMemory: schema([entity('posts', 'posts', 'db'), entity('users', 'users', 'db')]),
        requestMix: { 'ep-scan': 0.01, 'ep-ok': 0.99 },
      },
    );
    const { newLogs } = engine.tick();
    expect(newLogs.some((l) => l.message.includes('unindexed'))).toBe(false);
  });

  it('multiple un-indexed tables each produce a distinct one-shot callout', () => {
    // One endpoint touches both table-A (indexed=false) and table-B
    // (indexed=false); two distinct callout keys `unindexed-scan:A` and
    // `unindexed-scan:B` should fire, once each.
    const { nodes, edges } = dbGraph();
    const routes: EndpointRoute[] = [
      {
        endpointId: 'ep-multi',
        componentChain: ['db'],
        tablesAccessed: [
          { tableId: 'A', mode: 'read', indexed: false },
          { tableId: 'B', mode: 'read', indexed: false },
        ],
        weight: 1,
        estimatedPayloadBytes: 0,
      },
    ];
    const engine = new SimulationEngine(
      nodes, edges, profile(100, { 'ep-multi': 1 }, 3),
      undefined, undefined, SEED, false,
      { endpointRoutes: routes, schemaMemory: schema([entity('A', 'A', 'db'), entity('B', 'B', 'db')]), requestMix: { 'ep-multi': 1 } },
    );
    const accum: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { newLogs } = engine.tick();
      for (const l of newLogs) if (l.message.includes('unindexed')) accum.push(l.message);
    }
    expect(accum.length).toBe(2);
    expect(accum.some((m) => m.includes('"A"'))).toBe(true);
    expect(accum.some((m) => m.includes('"B"'))).toBe(true);
  });
});
