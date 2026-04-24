/**
 * @file engineReadWriteSplit.test.ts
 *
 * Phase 4.3 — DB read/write split with diagnostic errorRate fields.
 * `processDatabase` attributes inbound RPS to read vs write by walking
 * `endpointRoutes[].tablesAccessed` and joining tables to this DB via
 * `schemaMemory.entities[].assignedDbId`. Without usable attribution, it
 * falls back to the 70/30 default mix (see
 * `SimulationEngine.DB_FALLBACK_READ_SHARE`).
 *
 * Invariants exercised here:
 *   1. Per-endpoint attribution — read-only endpoint → readErrorRate=0 at
 *      low read utilization; write-only endpoint → writeErrorRate > 0 when
 *      its share exceeds writeThroughputRps.
 *   2. Aggregate `errorRate === max(readErrorRate, writeErrorRate,
 *      connectionPoolDropRate)` so breakers/retry/BP continue to observe
 *      the worst failure mode (fan-in correctness per Decisions §52).
 *   3. 70/30 fallback when no endpoint chain visits the DB — errorRate
 *      shape matches inboundReadRps = 0.7×rps and inboundWriteRps = 0.3×rps
 *      against the same capacities.
 *   4. `read_write` TableAccess mode contributes the endpoint's full share
 *      to BOTH buckets (per-operation semantics, not per-request half).
 *   5. No read-saturation / write-saturation callout when attribution is
 *      fallback (fallback is a modeling assumption, not a user signal).
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
    profileName: 'rw-split',
    durationSeconds,
    jitterPercent: 0,
    phases: [{ startS: 0, endS: durationSeconds, rps, shape: 'steady' as const, description: 'rw-split' }],
    requestMix,
    userDistribution: 'uniform',
  } as unknown as TrafficProfile;
}

function entity(id: string, assignedDbId: string | null): SchemaEntity {
  return {
    id,
    name: id,
    fields: [],
    indexes: [],
    accessPatterns: [],
    assignedDbId,
  };
}

function schema(entities: SchemaEntity[]): SchemaMemoryBlock {
  return { version: 1, entities, relationships: [], aiNotes: '' };
}

/**
 * Base topology: entry `svc` (api_gateway) → `db`. Two endpoints author-
 * land on svc: one read-only, one write-only, each touching a different
 * table on `db`. Used by the primary test and split-mode variants.
 */
function rwGraph(dbConfig: Record<string, unknown>) {
  const nodes = [
    node('svc', 'api_gateway', { isEntry: true, rateLimitRps: 1_000_000 }),
    node('db', 'database', dbConfig),
  ];
  const edges = [edge('svc-db', 'svc', 'db')];
  return { nodes, edges };
}

describe('Phase 4.3 — DB read/write split with diagnostic errorRate fields', () => {
  it('attributes read vs write via endpointRoutes + schemaMemory; errorRate = max(split, pool)', () => {
    // Canonical §4.9.2 case. Read capacity = 1000 × (1+1) = 2000 → read util
    // 250/2000 = 0.125 → readErrorRate = 0. Write capacity = 100 → write util
    // 250/100 = 2.5 → writeErrorRate = min(0.9, (2.5-1)*0.5) = 0.75. Aggregate
    // errorRate = 0.75. Connection pool at 10,000 conns can absorb the 500
    // rps of queued traffic, so poolDropRate = 0.
    const { nodes, edges } = rwGraph({
      readThroughputRps: 1000,
      writeThroughputRps: 100,
      readReplicas: 1,
      connectionPoolSize: 10_000,
    });
    const routes: EndpointRoute[] = [
      {
        endpointId: 'ep-read',
        componentChain: ['svc', 'db'],
        tablesAccessed: [{ tableId: 'posts', mode: 'read', indexed: true }],
        weight: 1,
        estimatedPayloadBytes: 0,
      },
      {
        endpointId: 'ep-write',
        componentChain: ['svc', 'db'],
        tablesAccessed: [{ tableId: 'events', mode: 'write', indexed: true }],
        weight: 1,
        estimatedPayloadBytes: 0,
      },
    ];
    const ctx: RoutingContext = {
      endpointRoutes: routes,
      schemaMemory: schema([entity('posts', 'db'), entity('events', 'db')]),
      requestMix: { 'ep-read': 0.5, 'ep-write': 0.5 },
    };
    const engine = new SimulationEngine(
      nodes, edges, profile(500, { 'ep-read': 0.5, 'ep-write': 0.5 }),
      undefined, undefined, SEED, false, ctx,
    );
    const { metrics } = engine.tick();
    const db = metrics.db;
    expect(db.readErrorRate).toBeDefined();
    expect(db.writeErrorRate).toBeDefined();
    expect(db.readErrorRate!).toBeCloseTo(0, 2);
    expect(db.writeErrorRate!).toBeGreaterThan(0.5);
    expect(db.errorRate).toBeCloseTo(Math.max(db.readErrorRate!, db.writeErrorRate!), 4);
  });

  it('falls back to 70/30 when no endpoint chain visits the DB', () => {
    // No routing context → 500 rps splits to 350 reads, 150 writes.
    // readCap = 1000*2 = 2000 → readUtil = 350/2000 = 0.175 → 0 errors.
    // writeCap = 100 → writeUtil = 150/100 = 1.5 → writeErr = 0.25.
    // Aggregate = max(0, 0.25, 0) = 0.25 (pool sized to 10k, no exhaustion).
    const { nodes, edges } = rwGraph({
      readThroughputRps: 1000,
      writeThroughputRps: 100,
      readReplicas: 1,
      connectionPoolSize: 10_000,
    });
    const engine = new SimulationEngine(
      nodes, edges, profile(500, { default: 1.0 }),
      undefined, undefined, SEED, false,
    );
    const { metrics } = engine.tick();
    const db = metrics.db;
    expect(db.readErrorRate!).toBeCloseTo(0, 2);
    expect(db.writeErrorRate!).toBeCloseTo(0.25, 2);
    expect(db.errorRate).toBeCloseTo(0.25, 2);
  });

  it('read_write TableAccess mode contributes the full endpoint share to BOTH buckets', () => {
    // Single endpoint with mode=read_write on one table. 300 rps attributes
    // 300 to reads AND 300 to writes (per-operation, not per-request split).
    // readCap = 1000*1 = 1000 → readUtil = 300/1000 = 0.3 → 0 errors.
    // writeCap = 200 → writeUtil = 300/200 = 1.5 → writeErr = 0.25.
    const { nodes, edges } = rwGraph({
      readThroughputRps: 1000,
      writeThroughputRps: 200,
      readReplicas: 0,
      connectionPoolSize: 10_000,
    });
    const routes: EndpointRoute[] = [
      {
        endpointId: 'ep-rw',
        componentChain: ['svc', 'db'],
        tablesAccessed: [{ tableId: 'events', mode: 'read_write', indexed: true }],
        weight: 1,
        estimatedPayloadBytes: 0,
      },
    ];
    const engine = new SimulationEngine(
      nodes, edges, profile(300, { 'ep-rw': 1 }),
      undefined, undefined, SEED, false,
      { endpointRoutes: routes, schemaMemory: schema([entity('events', 'db')]), requestMix: { 'ep-rw': 1 } },
    );
    const { metrics } = engine.tick();
    const db = metrics.db;
    expect(db.readErrorRate!).toBeCloseTo(0, 2);
    expect(db.writeErrorRate!).toBeCloseTo(0.25, 2);
  });

  it('fallback saturation does NOT fire a read/write-saturation callout (modeling-assumption floor)', () => {
    // Same shape as the 70/30 fallback test above (writeErr ≈ 0.25). With
    // no attribution, we must NOT surface a user-facing saturation callout
    // on a side we can't actually verify — that's what distinguishes
    // diagnostic from control-signal.
    const { nodes, edges } = rwGraph({
      readThroughputRps: 1000,
      writeThroughputRps: 100,
      readReplicas: 1,
      connectionPoolSize: 10_000,
    });
    const engine = new SimulationEngine(
      nodes, edges, profile(500, { default: 1.0 }),
      undefined, undefined, SEED, false,
    );
    const { newLogs } = engine.tick();
    expect(newLogs.some((l) => l.message.includes('saturated'))).toBe(false);
  });

  it('aggregate errorRate is the max of read/write/pool — breakers & retry still read the aggregate', () => {
    // With read saturated and write healthy, aggregate must equal
    // readErrorRate (≥ writeErrorRate, ≥ poolDropRate). This is the §52
    // fan-in invariant the Phase 4.3 compromise relies on.
    const { nodes, edges } = rwGraph({
      readThroughputRps: 100,
      writeThroughputRps: 10_000,
      readReplicas: 0,
      connectionPoolSize: 10_000,
    });
    const routes: EndpointRoute[] = [
      {
        endpointId: 'ep-read',
        componentChain: ['svc', 'db'],
        tablesAccessed: [{ tableId: 'posts', mode: 'read', indexed: true }],
        weight: 1,
        estimatedPayloadBytes: 0,
      },
    ];
    const engine = new SimulationEngine(
      nodes, edges, profile(250, { 'ep-read': 1 }),
      undefined, undefined, SEED, false,
      { endpointRoutes: routes, schemaMemory: schema([entity('posts', 'db')]), requestMix: { 'ep-read': 1 } },
    );
    const { metrics } = engine.tick();
    const db = metrics.db;
    // read util = 250/100 = 2.5 → readErr = min(0.9, 1.5*0.5) = 0.75
    expect(db.readErrorRate!).toBeCloseTo(0.75, 2);
    expect(db.writeErrorRate!).toBeCloseTo(0, 2);
    expect(db.errorRate).toBeCloseTo(db.readErrorRate!, 4);
  });

  it('zero writeThroughputRps saturates the write side immediately when writes are routed', () => {
    // Divide-by-zero guard: writeCap=0 AND inboundWriteRps>0 → writeUtilization
    // clamps to Infinity, errorRate clamps to 0.9 ceiling (not NaN, not
    // negative, not 1.0 which would falsely imply "everything dropped").
    const { nodes, edges } = rwGraph({
      readThroughputRps: 1000,
      writeThroughputRps: 0,
      readReplicas: 0,
      connectionPoolSize: 10_000,
    });
    const routes: EndpointRoute[] = [
      {
        endpointId: 'ep-write',
        componentChain: ['svc', 'db'],
        tablesAccessed: [{ tableId: 'events', mode: 'write', indexed: true }],
        weight: 1,
        estimatedPayloadBytes: 0,
      },
    ];
    const engine = new SimulationEngine(
      nodes, edges, profile(10, { 'ep-write': 1 }),
      undefined, undefined, SEED, false,
      { endpointRoutes: routes, schemaMemory: schema([entity('events', 'db')]), requestMix: { 'ep-write': 1 } },
    );
    const { metrics } = engine.tick();
    expect(metrics.db.writeErrorRate!).toBeCloseTo(0.9, 4);
    expect(Number.isFinite(metrics.db.errorRate)).toBe(true);
  });
});
