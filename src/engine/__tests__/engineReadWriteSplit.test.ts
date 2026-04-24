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

  it('dbArrivalFactor caps at 1 so default-bucket traffic is not absorbed into routed attribution (codex round 4 [P1])', () => {
    // 10% routed write + 90% default-bucket traffic at the same DB. Without
    // the cap, dbArrivalFactor would be totalInboundRps / routedEntryShare
    // = 100 / 10 = 10×, making the routed write share appear to be 100% of
    // DB inbound — the DB would be simulated as entirely-writes and saturate.
    // With the cap at 1, the routed 10 rps stays at 10 rps; the remaining 90
    // rps falls into the 70/30 remainder (63 read + 27 write). writeRps then
    // totals 37 rps / 50 cap = 74% util → writeErrorRate = 0 (no saturation).
    const { nodes, edges } = rwGraph({
      readThroughputRps: 1000,
      writeThroughputRps: 50,
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
    // Mix: 10% to the ONE routed endpoint, 90% to unmatched "default" bucket.
    const mix = { 'ep-write': 0.1, default: 0.9 };
    const engine = new SimulationEngine(
      nodes, edges, profile(100, mix),
      undefined, undefined, SEED, false,
      { endpointRoutes: routes, schemaMemory: schema([entity('events', 'db')]), requestMix: mix },
    );
    const { metrics } = engine.tick();
    // Without the cap: errorRate would be ~0.5 (fully saturated phantom
    // writes). With the cap: 0 (util = 37/50 = 74% < 100%).
    expect(metrics.db.writeErrorRate!).toBeCloseTo(0, 3);
    expect(metrics.db.errorRate).toBeLessThan(0.1);
  });

  it('a stale route chain (svc→db edge removed) does NOT project attribution onto the live DB (codex round 3 [P2])', () => {
    // Two routes attempt to reach `db`. `ep-legit` flows through `svc2 → db`
    // which is a real edge. `ep-stale` has chain ['svc1', 'db'] but the
    // svc1→db edge was never wired (graph-edit scenario the round-3
    // review named). Pre-fix, ep-stale's entry share polluted
    // dbArrivalFactor, and its `indexed: false` TableAccess would fire a
    // phantom unindexed-scan callout + scale down the read attribution
    // for ep-legit via over-sized entryShareToDb. Post-fix, stale routes
    // are filtered from attribution via routeReachesDbInLiveGraph.
    const nodes = [
      node('svc1', 'api_gateway', { isEntry: true, rateLimitRps: 1_000_000 }),
      node('svc2', 'api_gateway', { isEntry: true, rateLimitRps: 1_000_000 }),
      node('db', 'database', {
        readThroughputRps: 1000,
        writeThroughputRps: 1000,
        readReplicas: 0,
        connectionPoolSize: 10_000,
      }),
    ];
    // Only svc2 → db is wired. svc1 has no outbound edge.
    const edges = [edge('svc2-db', 'svc2', 'db')];
    const routes: EndpointRoute[] = [
      {
        endpointId: 'ep-legit',
        componentChain: ['svc2', 'db'],
        tablesAccessed: [{ tableId: 'events', mode: 'read', indexed: true }],
        weight: 1,
        estimatedPayloadBytes: 0,
      },
      {
        endpointId: 'ep-stale',
        componentChain: ['svc1', 'db'], // stale: svc1→db edge doesn't exist.
        tablesAccessed: [{ tableId: 'events', mode: 'write', indexed: true }],
        weight: 1,
        estimatedPayloadBytes: 0,
      },
    ];
    const mix = { 'ep-legit': 0.5, 'ep-stale': 0.5 };
    const engine = new SimulationEngine(
      nodes, edges, profile(500, mix),
      undefined, undefined, SEED, false,
      { endpointRoutes: routes, schemaMemory: schema([entity('events', 'db')]), requestMix: mix },
    );
    const { metrics } = engine.tick();
    // Only ep-legit's 250 rps actually reaches the DB. Its mode is 'read',
    // so routedReadRps = 250 (dbArrivalFactor = 250/250 = 1 — stale route
    // excluded from entryShareToDb). writeErrorRate must stay 0 — the stale
    // write route no longer attributes load the DB isn't seeing.
    expect(metrics.db.writeErrorRate!).toBeCloseTo(0, 3);
    expect(metrics.db.readErrorRate!).toBeCloseTo(0, 3);
  });

  it('route heads that are not graph entry points still process in topological order (codex round 3 [P1])', () => {
    // Graph: isolated node `side` → `sideDb`, no connection to the actual
    // entry point `main`. Route seeds traffic into `side` via
    // componentChain[0]. Pre-fix, `side` and `sideDb` would run only in
    // the Map-insertion-order catch-all; if `sideDb` was inserted first,
    // it would process 0 RPS this tick (persistent 1-tick lag). Post-fix,
    // `side` is added to topoRoots so the ordering is deterministic and
    // `sideDb` sees the forwarded traffic the same tick.
    const nodes = [
      // Intentional insertion order: sideDb BEFORE side, so the catch-all
      // loop would process sideDb first without the fix.
      node('main', 'api_gateway', { isEntry: true, rateLimitRps: 1_000_000 }),
      node('sideDb', 'database', {
        readThroughputRps: 1_000_000,
        writeThroughputRps: 1_000_000,
        readReplicas: 0,
        connectionPoolSize: 10_000,
      }),
      node('side', 'api_gateway', { isEntry: false, rateLimitRps: 1_000_000 }),
    ];
    const edges = [edge('side-sidedb', 'side', 'sideDb')];
    const routes: EndpointRoute[] = [
      {
        endpointId: 'ep-side',
        componentChain: ['side', 'sideDb'],
        tablesAccessed: [{ tableId: 'events', mode: 'write', indexed: true }],
        weight: 1,
        estimatedPayloadBytes: 0,
      },
    ];
    const mix = { 'ep-side': 1 };
    const engine = new SimulationEngine(
      nodes, edges, profile(100, mix),
      undefined, undefined, SEED, false,
      { endpointRoutes: routes, schemaMemory: schema([entity('events', 'sideDb')]), requestMix: mix },
    );
    const { metrics } = engine.tick();
    // Routed head → DB on the SAME tick, not with a one-tick lag.
    expect(metrics.sideDb.rps).toBeCloseTo(100, 0);
  });

  it('read_write share is counted ONCE in the remainder calculation, not twice (codex round 2 [P1a])', () => {
    // Before the round-2 fix, `attributedRps = routedReadRps + routedWriteRps`
    // double-counted `read_write` shares (they land in BOTH buckets), shrinking
    // the 70/30 remainder. Test: one read_write route + one unclassified
    // route at a write-starved DB. If the double-count bug returned, the
    // remainder would be too small and writeErrorRate would falsely read 0.
    const { nodes, edges } = rwGraph({
      readThroughputRps: 1_000_000,
      writeThroughputRps: 50,
      readReplicas: 0,
      connectionPoolSize: 10_000,
    });
    const routes: EndpointRoute[] = [
      // read_write on the shared table — share counts to both buckets,
      // must count ONCE in attributedRpsAtDb.
      {
        endpointId: 'ep-rw',
        componentChain: ['svc', 'db'],
        tablesAccessed: [{ tableId: 'events', mode: 'read_write', indexed: true }],
        weight: 1,
        estimatedPayloadBytes: 0,
      },
      // Unclassified — empty tablesAccessed, 60% of traffic.
      {
        endpointId: 'ep-unclassified',
        componentChain: ['svc', 'db'],
        tablesAccessed: [],
        weight: 1,
        estimatedPayloadBytes: 0,
      },
    ];
    const mix = { 'ep-rw': 0.4, 'ep-unclassified': 0.6 };
    const engine = new SimulationEngine(
      nodes, edges, profile(100, mix),
      undefined, undefined, SEED, false,
      { endpointRoutes: routes, schemaMemory: schema([entity('events', 'db')]), requestMix: mix },
    );
    const { metrics } = engine.tick();
    // attributedRpsAtDb = 40 (ep-rw counted once, even though it lands in both
    // buckets). remainder = 60, 70/30 → 18 rps write. Total write = 40 + 18 = 58.
    // 58 / 50 cap → 116% util → writeErrorRate = (1.16 - 1) * 0.5 = 0.08.
    // If the bug returned, attributedRps would be 80 (40+40), remainder=20 → 6
    // write, total = 46, util = 92% → writeErrorRate clamps to 0 (false negative).
    expect(metrics.db.writeErrorRate!).toBeGreaterThan(0.05);
    expect(metrics.db.writeErrorRate!).toBeLessThan(0.15);
  });

  it('scales attributed DB load by the ACTUAL inbound, not the entry-point seed (codex round 2 [P1b])', () => {
    // Route writes through an api_gateway with rateLimitRps=100 in front of
    // the DB. Entry-point share at `svc` = 1000 rps, but the gateway caps
    // forwarded traffic to 100 rps. The DB's real inbound is ~100 rps.
    //
    // Before the fix, routedWriteRps would be computed from the seeded 1000
    // rps share → writeUtil = 1000 / 300 ≈ 333% → writeErrorRate ≈ 0.9 on a
    // DB that's actually ~33% utilized. Breakers would trip on phantom load.
    // After the fix, dbArrivalFactor = 100 / 1000 = 0.1 → routedWriteRps = 100
    // → writeUtil = 33% → writeErrorRate = 0.
    const nodes = [
      node('svc', 'api_gateway', { isEntry: true, rateLimitRps: 100 }),
      node('db', 'database', {
        readThroughputRps: 1_000_000,
        writeThroughputRps: 300,
        readReplicas: 0,
        connectionPoolSize: 10_000,
      }),
    ];
    const edges = [edge('svc-db', 'svc', 'db')];
    const routes: EndpointRoute[] = [
      {
        endpointId: 'ep-write',
        componentChain: ['svc', 'db'],
        tablesAccessed: [{ tableId: 'events', mode: 'write', indexed: true }],
        weight: 1,
        estimatedPayloadBytes: 0,
      },
    ];
    const mix = { 'ep-write': 1 };
    const engine = new SimulationEngine(
      nodes, edges, profile(1000, mix),
      undefined, undefined, SEED, false,
      { endpointRoutes: routes, schemaMemory: schema([entity('events', 'db')]), requestMix: mix },
    );
    const { metrics } = engine.tick();
    // DB sees rate-limited arrival — should stay healthy.
    expect(metrics.db.rps).toBeLessThan(200);
    expect(metrics.db.writeErrorRate!).toBeCloseTo(0, 3);
  });

  it('suppresses write-saturation callout when attribution is <50% of DB inbound (codex round 2 [P2b])', () => {
    // Sparse-schema case: a small attributed read route + a large unclassified
    // route. Writes saturate via the 70/30 filler on the remainder, but since
    // classified routes only explain 10% of the DB's traffic, the user-visible
    // "write side saturated" callout would point at phantom load — suppress it.
    const { nodes, edges } = rwGraph({
      readThroughputRps: 1_000_000,
      writeThroughputRps: 30,
      readReplicas: 0,
      connectionPoolSize: 10_000,
    });
    const routes: EndpointRoute[] = [
      {
        endpointId: 'ep-read',
        componentChain: ['svc', 'db'],
        tablesAccessed: [{ tableId: 'events', mode: 'read', indexed: true }],
        weight: 1,
        estimatedPayloadBytes: 0,
      },
      {
        endpointId: 'ep-unclassified',
        componentChain: ['svc', 'db'],
        tablesAccessed: [],
        weight: 1,
        estimatedPayloadBytes: 0,
      },
    ];
    const mix = { 'ep-read': 0.1, 'ep-unclassified': 0.9 };
    const engine = new SimulationEngine(
      nodes, edges, profile(500, mix),
      undefined, undefined, SEED, false,
      { endpointRoutes: routes, schemaMemory: schema([entity('events', 'db')]), requestMix: mix },
    );
    const { metrics, newLogs } = engine.tick();
    // The write side DOES saturate numerically — 450 rps × 30% = 135 > 30 cap.
    expect(metrics.db.writeErrorRate!).toBeGreaterThan(0);
    // But the user-facing callout must NOT fire — classified routes were
    // only 10% of the DB's inbound; the saturation is driven by synthetic
    // 70/30 filler on unclassified traffic.
    expect(newLogs.some((l) => l.message.includes('write side saturated'))).toBe(false);
    expect(newLogs.some((l) => l.message.includes('read side saturated'))).toBe(false);
  });

  it('partial attribution distributes the unclassified remainder via the 70/30 default (codex [P1])', () => {
    // Mixed routing: one endpoint declares a `read` TableAccess, another
    // visits the DB but carries empty `tablesAccessed` (sparse-schema case
    // the describe-intent pipeline can produce). Pre-fix, the second
    // endpoint's RPS silently vanished from both readErrorRate and
    // writeErrorRate, letting the DB look healthy while saturating. Post-
    // fix, the remainder splits 70/30 like the no-routing fallback.
    const { nodes, edges } = rwGraph({
      readThroughputRps: 1_000_000,  // read side intentionally oversized — isolates the write-side test.
      writeThroughputRps: 30,
      readReplicas: 1,
      connectionPoolSize: 10_000,
    });
    const routes: EndpointRoute[] = [
      // Attributed read — 100 rps at weight 0.4 out of total 250 rps.
      {
        endpointId: 'ep-read',
        componentChain: ['svc', 'db'],
        tablesAccessed: [{ tableId: 'profiles', mode: 'read', indexed: true }],
        weight: 1,
        estimatedPayloadBytes: 0,
      },
      // Unattributed — 150 rps at weight 0.6. Empty tablesAccessed is the
      // real-world pattern for endpoints whose table access the schema pass
      // hasn't inferred yet.
      {
        endpointId: 'ep-unclassified',
        componentChain: ['svc', 'db'],
        tablesAccessed: [],
        weight: 1,
        estimatedPayloadBytes: 0,
      },
    ];
    const mix = { 'ep-read': 0.4, 'ep-unclassified': 0.6 };
    const engine = new SimulationEngine(
      nodes, edges, profile(250, mix),
      undefined, undefined, SEED, false,
      { endpointRoutes: routes, schemaMemory: schema([entity('profiles', 'db')]), requestMix: mix },
    );
    const { metrics } = engine.tick();
    const db = metrics.db;
    // Unattributed 150 rps → 30% write share → 45 rps write against 30 cap
    // → writeUtil = 1.5 → writeErrorRate = (1.5 - 1) × 0.5 = 0.25.
    expect(db.writeErrorRate!).toBeGreaterThan(0.2);
    expect(db.writeErrorRate!).toBeLessThan(0.35);
    // Read side stays healthy: 100 rps attributed + ~105 rps 70/30 remainder
    // = ~205 rps against the 2M-rps read capacity = 0 errors.
    expect(db.readErrorRate!).toBeCloseTo(0, 2);
    // Aggregate reflects the worst side — write saturation — per §52 so
    // breakers / retry / BP still observe the real failure mode.
    expect(db.errorRate).toBeCloseTo(db.writeErrorRate!, 4);
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
