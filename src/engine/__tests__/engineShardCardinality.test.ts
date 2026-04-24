/**
 * @file engineShardCardinality.test.ts
 *
 * Phase 4.5 — per-DB shard key + cardinality derivation. The engine
 * used to rely on a single constructor-level `schemaShardKey` +
 * `schemaShardKeyCardinality` global, which couldn't represent
 * multi-DB scenarios (one DB hot-sharding, another cleanly sharded).
 * `resolveShardKeyForDb(dbId)` now walks four fallback layers:
 *
 *   1. `schemaMemory.entities[].assignedDbId === dbId` with a
 *      `partitionKey` — cardinality from `partitionKeyCardinalityWarning`
 *      (→ 'low') or the partition field's own `cardinality`.
 *   2. `state.config.shardKey` on the DB itself.
 *   3. Legacy constructor globals (back-compat).
 *   4. `{ null, 'high' }` (no hot-shard model).
 *
 * Invariants exercised here:
 *   1. Two DBs in one engine — low-cardinality partition on DB-A,
 *      high-cardinality on DB-B — DB-A shows Pareto hot-shard skew
 *      (>30% on one shard), DB-B shows roughly even distribution.
 *   2. `partitionKeyCardinalityWarning === true` overrides the field's
 *      own cardinality (author explicitly marked it hot).
 *   3. `partitionKey` naming a field NOT in `entity.fields` degrades
 *      gracefully to 'high' cardinality (defensive, no crash).
 *   4. `schemaMemory === null` → falls through to legacy constructor
 *      globals, preserving pre-Phase-4.5 behavior.
 *   5. Dangling `assignedDbId` on an entity (references a DB node that
 *      was deleted) — resolver for the missing DB returns defaults, no
 *      crash, no bleed-over onto a different DB.
 */
import { describe, it, expect } from 'vitest';
import { SimulationEngine, type RoutingContext } from '../SimulationEngine';
import type {
  TrafficProfile,
  SimComponentData,
  WireConfig,
  SchemaMemoryBlock,
  SchemaEntity,
  SchemaField,
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

function profile(rps: number, durationSeconds = 5): TrafficProfile {
  return {
    profileName: 'shard-card',
    durationSeconds,
    jitterPercent: 0,
    phases: [{ startS: 0, endS: durationSeconds, rps, shape: 'steady' as const, description: 'shard-card' }],
    requestMix: { default: 1 },
    userDistribution: 'uniform',
  } as unknown as TrafficProfile;
}

function field(name: string, cardinality: 'low' | 'medium' | 'high'): SchemaField {
  return { name, type: 'string', cardinality };
}

function entity(
  id: string,
  assignedDbId: string | null,
  partitionKey?: string,
  fields: SchemaField[] = [],
  partitionKeyCardinalityWarning?: boolean,
): SchemaEntity {
  return {
    id,
    name: id,
    fields,
    indexes: [],
    partitionKey,
    partitionKeyCardinalityWarning,
    accessPatterns: [],
    assignedDbId,
  };
}

function schema(entities: SchemaEntity[]): SchemaMemoryBlock {
  return { version: 1, entities, relationships: [], aiNotes: '' };
}

describe('Phase 4.5 — per-DB shard cardinality from schemaMemory', () => {
  it('distinguishes hot-shard vs even-split across two DBs in one engine', () => {
    // DB-A: low cardinality → Pareto. DB-B: high cardinality → even split.
    // Both are entry points so each gets the full per-entry rps — but the
    // engine's even-split distributes rps across both, so each receives
    // 500 rps from a 1000 profile.
    const nodes = [
      node('dbA', 'database', { isEntry: true, shardingEnabled: true, shardCount: 4, readThroughputRps: 100_000, writeThroughputRps: 100_000 }),
      node('dbB', 'database', { isEntry: true, shardingEnabled: true, shardCount: 4, readThroughputRps: 100_000, writeThroughputRps: 100_000 }),
    ];
    const edges: Edge<{ config: WireConfig }>[] = [];
    const ctx: RoutingContext = {
      schemaMemory: schema([
        entity('entA', 'dbA', 'region', [field('region', 'low')]),
        entity('entB', 'dbB', 'id',     [field('id',     'high')]),
      ]),
    };
    const engine = new SimulationEngine(
      nodes, edges, profile(1000),
      undefined, undefined, SEED, false, ctx,
    );
    const { metrics } = engine.tick();
    const distA = metrics.dbA.shardDistribution!;
    const distB = metrics.dbB.shardDistribution!;
    expect(distA.length).toBe(4);
    expect(distB.length).toBe(4);
    const totalA = distA.reduce((s, v) => s + v, 0);
    const totalB = distB.reduce((s, v) => s + v, 0);
    expect(totalA).toBeGreaterThan(0);
    expect(totalB).toBeGreaterThan(0);
    const maxShareA = Math.max(...distA) / totalA;
    const maxShareB = Math.max(...distB) / totalB;
    // DB-A: hot shard concentrates 78% on one shard (see processDatabase).
    expect(maxShareA).toBeGreaterThan(0.7);
    // DB-B: even-split ~25% each, well under the 0.3 threshold the legacy
    // test uses to call hot-sharded.
    expect(maxShareB).toBeLessThan(0.3);
  });

  it('partitionKeyCardinalityWarning overrides the field cardinality', () => {
    // Field declared as 'high' but author marked partitionKey warning — that
    // explicit flag from the describe-intent pipeline trumps the field's
    // own cardinality.
    const nodes = [
      node('db', 'database', { isEntry: true, shardingEnabled: true, shardCount: 4, readThroughputRps: 100_000, writeThroughputRps: 100_000 }),
    ];
    const edges: Edge<{ config: WireConfig }>[] = [];
    const engine = new SimulationEngine(
      nodes, edges, profile(1000),
      undefined, undefined, SEED, false,
      { schemaMemory: schema([entity('ent', 'db', 'tenant_id', [field('tenant_id', 'high')], true)]) },
    );
    const { metrics } = engine.tick();
    const dist = metrics.db.shardDistribution!;
    const total = dist.reduce((s, v) => s + v, 0);
    expect(Math.max(...dist) / total).toBeGreaterThan(0.7);
  });

  it('degrades to high cardinality when partitionKey names a field not in entity.fields', () => {
    // Dangling partitionKey — author wrote 'orphan' but didn't add the
    // field. Resolver returns cardinality='high', so no Pareto skew.
    const nodes = [
      node('db', 'database', { isEntry: true, shardingEnabled: true, shardCount: 4, readThroughputRps: 100_000, writeThroughputRps: 100_000 }),
    ];
    const edges: Edge<{ config: WireConfig }>[] = [];
    const engine = new SimulationEngine(
      nodes, edges, profile(1000),
      undefined, undefined, SEED, false,
      { schemaMemory: schema([entity('ent', 'db', 'orphan', [field('present', 'low')])]) },
    );
    const { metrics } = engine.tick();
    const dist = metrics.db.shardDistribution!;
    const total = dist.reduce((s, v) => s + v, 0);
    expect(Math.max(...dist) / total).toBeLessThan(0.3);
  });

  it('with no schemaMemory, legacy constructor globals still drive the Pareto branch', () => {
    // Back-compat: no routing context at all, but constructor args pass
    // shardKey='user_id', cardinality='medium' — hot-shard fires.
    const nodes = [
      node('db', 'database', { isEntry: true, shardingEnabled: true, shardCount: 4, readThroughputRps: 100_000, writeThroughputRps: 100_000 }),
    ];
    const edges: Edge<{ config: WireConfig }>[] = [];
    const engine = new SimulationEngine(
      nodes, edges, profile(1000),
      'user_id', 'medium', SEED, false,
    );
    const { metrics } = engine.tick();
    const dist = metrics.db.shardDistribution!;
    const total = dist.reduce((s, v) => s + v, 0);
    expect(Math.max(...dist) / total).toBeGreaterThan(0.7);
  });

  it('useSimulation-style globals alongside schemaMemory leak across DBs — fixed by passing undefined (codex round 4 [P2])', () => {
    // Pre-fix useSimulation.ts derived `schemaShardKey` / `cardinality`
    // from the FIRST entity with a partitionKey and passed them as
    // constructor globals alongside the schemaMemory in `routingContext`.
    // `resolveShardKeyForDb(dbId)` falls back to those globals when a DB
    // has no assigned entity — so an unrelated DB inherited a foreign
    // partition key. This test documents the bug + the fix: construct
    // both ways and assert the behavioural difference.
    const nodes = [
      node('dbA', 'database', { isEntry: true, shardingEnabled: true, shardCount: 4, readThroughputRps: 100_000, writeThroughputRps: 100_000 }),
      node('dbB', 'database', { isEntry: true, shardingEnabled: true, shardCount: 4, readThroughputRps: 100_000, writeThroughputRps: 100_000 }),
    ];
    const edges: Edge<{ config: WireConfig }>[] = [];
    // Only dbA has an assigned entity with a low-cardinality partition key.
    const ctx: RoutingContext = {
      schemaMemory: schema([entity('entA', 'dbA', 'region', [field('region', 'low')])]),
    };

    // Pre-fix call pattern — globals derived from first entity.
    const preFixEngine = new SimulationEngine(
      nodes, edges, profile(1000),
      'region', 'low', SEED, false, ctx,
    );
    const preFixB = preFixEngine.tick().metrics.dbB.shardDistribution!;
    const preFixBMax = Math.max(...preFixB) / preFixB.reduce((s, v) => s + v, 0);
    // Bug: dbB's distribution is skewed because the global leaked.
    expect(preFixBMax).toBeGreaterThan(0.5);

    // Post-fix call pattern — globals are undefined; per-DB resolver
    // correctly returns (null, 'high') for dbB.
    const postFixEngine = new SimulationEngine(
      nodes, edges, profile(1000),
      undefined, undefined, SEED, false, ctx,
    );
    const postFixB = postFixEngine.tick().metrics.dbB.shardDistribution!;
    const postFixBMax = Math.max(...postFixB) / postFixB.reduce((s, v) => s + v, 0);
    // Fix: dbB's distribution is even — no inherited partition key.
    expect(postFixBMax).toBeLessThan(0.4);
  });

  it('dangling assignedDbId does not crash or bleed hot-shard behavior onto unrelated DBs', () => {
    // Entity assigned to a DB id that doesn't exist in the graph. DB-live
    // is high-cardinality — it must remain evenly distributed; the ghost
    // entity's low cardinality must NOT leak into the live DB's resolver.
    const nodes = [
      node('dbLive', 'database', { isEntry: true, shardingEnabled: true, shardCount: 4, readThroughputRps: 100_000, writeThroughputRps: 100_000 }),
    ];
    const edges: Edge<{ config: WireConfig }>[] = [];
    const engine = new SimulationEngine(
      nodes, edges, profile(1000),
      undefined, undefined, SEED, false,
      {
        schemaMemory: schema([
          entity('ghost', 'dbGhost', 'region', [field('region', 'low')]),
          entity('live',  'dbLive',  'id',     [field('id',     'high')]),
        ]),
      },
    );
    const { metrics } = engine.tick();
    const dist = metrics.dbLive.shardDistribution!;
    const total = dist.reduce((s, v) => s + v, 0);
    expect(Math.max(...dist) / total).toBeLessThan(0.3);
  });
});
