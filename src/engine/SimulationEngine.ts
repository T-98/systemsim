/**
 * @file SimulationEngine.ts
 *
 * The tick-based stochastic engine that IS the product. A per-second simulator
 * for the user's component graph: walks the graph from entry points, routes
 * traffic through components (server, cache, queue, DB, LB, etc), computes
 * per-component p50/p99/ρ/queueDepth each tick, and emits warnings before
 * things collapse.
 *
 * Core modeling:
 * - M/M/1-per-instance queueing via Little's Law (see QueueingModel.ts)
 * - Zipfian working-set cache model (see WorkingSetCache.ts)
 * - Wire latency propagation (latency compounds per hop)
 * - Hot shard Pareto distribution when shard key is low-cardinality or user_id
 *
 * Runs entirely in the browser. No backend simulation. The only server-side
 * code (api/*) is for LLM calls.
 *
 * Reproducibility: optional `seed` param uses a seeded PRNG (mulberry32) for
 * deterministic tests. When omitted, uses Math.random.
 *
 * Stressed mode: one-shot worst-case run. Peak RPS held, cold cache, wire p99.
 * See Decisions.md #10.
 */

import { v4 as uuid } from 'uuid';
import type {
  TrafficProfile,
  ComponentMetrics,
  HealthState,
  LogEntry,
  Particle,
  SimComponentData,
  WireConfig,
  EndpointRoute,
  SchemaMemoryBlock,
  ApiContract,
} from '../types';
import type { Node, Edge } from '@xyflow/react';
import { computeQueueing } from './QueueingModel';
import { computeCacheModel, networkAwareCacheLatency } from './WorkingSetCache';
import {
  type BreakerStatus,
  type CircuitBreakerConfig,
  type CircuitBreakerState,
  evaluateBreaker,
  makeBreakerState,
  resolveBreakerConfig,
} from './CircuitBreaker';
import { computeAmplification, readRetryPolicy } from './RetryPolicy';
import { computeAcceptanceRate, readBackpressureConfig } from './Backpressure';
import { topologicalOrder } from './graphTraversal';

interface ComponentState {
  id: string;
  type: string;
  config: Record<string, unknown>;
  health: HealthState;
  metrics: ComponentMetrics;
  // Internal state
  queueDepth: number;
  currentConnections: number;
  memoryUsed: number;
  cacheEntries: number;
  shardLoads: number[];
  accumulatedErrors: number;
  totalRequests: number;
  crashed: boolean;
  instanceCount: number;
  lastComputedLatencyMs: number;
  /**
   * Backpressure signal: acceptanceRate ∈ [0, 1], updated at end of tick
   * if `config.backpressure.enabled`. Upstream callers read the PREVIOUS
   * tick's value and scale forwarded RPS down by (1 - acceptanceRate).
   * Initialized to 1.0 (fully accepting) — no backpressure until observed.
   */
  acceptanceRate: number;
}

/**
 * Per-wire live state surfaced at end of each tick for UI consumption.
 * `breakerStatus` is null when no breaker is configured on the wire.
 */
export interface WireLiveState {
  breakerStatus: BreakerStatus | null;
  lastObservedErrorRate: number;
}

interface WireState {
  id: string;
  source: string;
  target: string;
  config: WireConfig;
  currentRps: number;
  /** Present iff wire.config.circuitBreaker was set. */
  breaker?: CircuitBreakerState;
  /** Resolved breaker config (with defaults applied). Present iff breaker present. */
  breakerConfig?: CircuitBreakerConfig;
  /**
   * Downstream errorRate observed at end of most recent tick with traffic.
   * Used by the NEXT tick's retry amplification and (indirectly, via
   * acceptanceRate) backpressure. Post fan-in-correctness fix this is the
   * target's true AGGREGATE errorRate, not the slice from a specific
   * inbound wire. When target sees no traffic for a tick, the previous
   * value is held (missing data is not health).
   */
  lastObservedErrorRate: number;
}

/**
 * Per-wire outcome of one tick's forwarding attempt. Populated during Phase B
 * (processor execution) and consumed at end of tick for breaker / retry /
 * backpressure book-keeping. Exposed via `tickOutcomes()` for tests that
 * want to assert the forwarding decisions directly.
 */
export interface WireTickOutcome {
  wireId: string;
  source: string;
  target: string;
  /** What the upstream processor asked us to send before resilience adjustments. */
  rpsNominal: number;
  /** What actually flowed after retry amplification × backpressure scaling (or 0 if breaker OPEN). */
  rpsEffective: number;
  /** Retry factor applied (1 when no retry policy or no prior error). */
  amplification: number;
  /** Target's acceptanceRate used to scale down (1 = pass-through, 0 = fully rejected). */
  appliedBackpressure: number;
}

/** Per-component inbound latency aggregator: numerator = Σ rps·accLat, denominator = Σ rps. */
interface InboundLatencyAccumulator {
  num: number;
  denom: number;
}

/**
 * Schema + routing information the engine consumes to shape traffic beyond
 * the raw graph topology. Every field is optional; absent fields fall back
 * to the pre-Phase-4 even-split-over-entry-points behavior so existing call
 * sites stay source-compatible.
 *
 * - `endpointRoutes` — first node of each `componentChain` becomes the
 *   per-endpoint traffic sink (Phase 4.2). The DB processor also reads these
 *   chains for read/write split and unindexed-scan attribution (Phase 4.3-4.4).
 * - `schemaMemory` — per-DB shard key + cardinality derivation (Phase 4.5)
 *   and table→DB resolution for scan-attribution.
 * - `requestMix` — weights keyed by either `EndpointRoute.endpointId` (uuid)
 *   or the contract's `"METHOD PATH"` form (e.g. `"POST /checkout"`). The
 *   second form is the shape authored scenarios use (see `src/scenarios/discord.ts`)
 *   and requires `apiContracts` to resolve. Keys that match neither fall into
 *   a "default" bucket distributed evenly across `entryPoints`.
 * - `apiContracts` — joined to `endpointRoutes` by `contract.id === route.endpointId`
 *   so the engine can match `"METHOD PATH"` keys in `requestMix`.
 */
export interface RoutingContext {
  endpointRoutes?: EndpointRoute[];
  schemaMemory?: SchemaMemoryBlock | null;
  requestMix?: Record<string, number>;
  apiContracts?: ApiContract[];
}

// Seeded PRNG (mulberry32) for reproducible simulations in tests
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Tick-based distributed-systems simulator. Instantiate with the graph +
 * traffic profile, then call `.tick()` each sim-second (driven by useSimulation).
 *
 * State is mutable across ticks: each `ComponentState` carries accumulated
 * queueDepth, errors, connections, etc., plus a one-shot `firedCallouts` set
 * so saturation warnings fire exactly once per run.
 */
export class SimulationEngine {
  private components: Map<string, ComponentState> = new Map();
  private wires: Map<string, WireState> = new Map();
  private adjacency: Map<string, string[]> = new Map(); // source -> [target ids]
  private reverseAdj: Map<string, string[]> = new Map(); // target -> [source ids]
  private trafficProfile: TrafficProfile;
  private time = 0;
  private tickInterval = 1; // seconds per tick (coarser for performance)
  private log: LogEntry[] = [];
  private particles: Particle[] = [];
  private particleIdCounter = 0;
  private entryPoints: string[] = [];
  private schemaShardKey: string | null = null;
  private schemaShardKeyCardinality: 'low' | 'medium' | 'high' = 'high';
  // Phase 4 routing context — additive; null/empty preserves pre-Phase-4 behavior.
  private endpointRoutes: EndpointRoute[] = [];
  private schemaMemory: SchemaMemoryBlock | null = null;
  private requestMix: Record<string, number> | null = null;
  private apiContracts: ApiContract[] = [];
  private lastLogTime: Map<string, number> = new Map(); // throttle logs per component
  private random: () => number; // seeded PRNG for reproducibility
  private firedCallouts: Set<string> = new Set(); // saturation warnings, once per component per run
  // Per-tick state — cleared at tick start. See tick() for the 3-phase model.
  private inboundRps: Map<string, number> = new Map();
  private inboundLat: Map<string, InboundLatencyAccumulator> = new Map();
  private wireOutcomes: Map<string, WireTickOutcome> = new Map();
  private processedThisTick: Set<string> = new Set();
  /**
   * Per-endpoint entry-RPS map populated by `seedInboundTraffic` and consumed
   * by downstream processors (DB read/write split, unindexed-scan multiplier —
   * Phase 4.3 / 4.4). Keyed by `EndpointRoute.endpointId`; value is the RPS
   * (per-tick units, same as `inboundRps`) actually routed to that endpoint's
   * `componentChain[0]` THIS tick — i.e., includes the redistribution of
   * stale-chain and unmatched weight. Stale endpoints are absent. Cleared at
   * tick start before seeding. Readers must treat this as an at-the-entry
   * signal; RPS may amplify (fan-out) or shrink (cache hit) along the chain,
   * so this is an attribution proxy, not the DB's exact inbound. See
   * Decisions §54 for the diagnostic-not-control-signal compromise.
   */
  private endpointShareRpsThisTick: Map<string, number> = new Map();
  // Cycle/back-edge traffic that couldn't be delivered this tick is carried into next tick.
  private pendingInbound: Map<string, { rps: number; latNum: number }> = new Map();
  private calloutEntries: WeakSet<LogEntry> = new WeakSet(); // entries that bypass the per-tick throttle
  private peakCacheHitRate: Map<string, number> = new Map(); // track peak hitRate per cache for miss-storm detection
  private stressedMode = false; // worst-case run: peak RPS held, cold cache, wire p99

  constructor(
    nodes: Node<SimComponentData>[],
    edges: Edge<{ config: WireConfig }>[],
    trafficProfile: TrafficProfile,
    schemaShardKey?: string,
    schemaShardKeyCardinality?: 'low' | 'medium' | 'high',
    seed?: number,
    stressedMode = false,
    routingContext?: RoutingContext,
  ) {
    this.random = seed != null ? mulberry32(seed) : Math.random;
    this.trafficProfile = trafficProfile;
    this.schemaShardKey = schemaShardKey ?? null;
    this.schemaShardKeyCardinality = schemaShardKeyCardinality ?? 'high';
    this.stressedMode = stressedMode;
    this.endpointRoutes = routingContext?.endpointRoutes ?? [];
    this.schemaMemory = routingContext?.schemaMemory ?? null;
    this.apiContracts = routingContext?.apiContracts ?? [];
    // Prefer the explicit routing-context mix; fall back to the mix embedded in
    // the TrafficProfile so callers that haven't been updated still get
    // per-endpoint routing if the profile has matching keys.
    this.requestMix = routingContext?.requestMix ?? trafficProfile.requestMix ?? null;

    // Initialize component states
    for (const node of nodes) {
      const shardCount = (node.data.config.shardCount as number) ?? 1;
      this.components.set(node.id, {
        id: node.id,
        type: node.data.type,
        config: { ...node.data.config },
        health: 'healthy',
        metrics: this.emptyMetrics(),
        queueDepth: 0,
        currentConnections: 0,
        memoryUsed: 0,
        cacheEntries: 0,
        shardLoads: new Array(Math.max(shardCount, 1)).fill(0),
        accumulatedErrors: 0,
        totalRequests: 0,
        crashed: false,
        instanceCount: (node.data.config.instanceCount as number) ?? 1,
        lastComputedLatencyMs: 0,
        acceptanceRate: 1.0,
      });
    }

    // Initialize wire states and adjacency
    for (const edge of edges) {
      const cfg = edge.data!.config;
      const hasBreaker = cfg.circuitBreaker !== undefined;
      this.wires.set(edge.id, {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        config: cfg,
        currentRps: 0,
        breaker: hasBreaker ? makeBreakerState() : undefined,
        breakerConfig: hasBreaker ? resolveBreakerConfig(cfg.circuitBreaker) : undefined,
        lastObservedErrorRate: 0,
      });

      if (!this.adjacency.has(edge.source)) this.adjacency.set(edge.source, []);
      this.adjacency.get(edge.source)!.push(edge.target);

      if (!this.reverseAdj.has(edge.target)) this.reverseAdj.set(edge.target, []);
      this.reverseAdj.get(edge.target)!.push(edge.source);
    }

    // Find entry points: explicit isEntry flag OR zero-indegree
    const explicit: string[] = [];
    const zeroIndegree: string[] = [];
    for (const node of nodes) {
      if ((node.data as any)?.config?.isEntry === true) {
        explicit.push(node.id);
      }
      const incoming = this.reverseAdj.get(node.id);
      if (!incoming || incoming.length === 0) {
        zeroIndegree.push(node.id);
      }
    }
    this.entryPoints = explicit.length > 0 ? explicit : zeroIndegree;
  }

  private emptyMetrics(): ComponentMetrics {
    return { rps: 0, p50: 0, p95: 0, p99: 0, errorRate: 0, cpuPercent: 0, memoryPercent: 0 };
  }

  private fireCallout(logs: LogEntry[], componentId: string, calloutType: string, message: string) {
    const key = `${componentId}:${calloutType}`;
    if (this.firedCallouts.has(key)) return;
    this.firedCallouts.add(key);
    const entry: LogEntry = { time: this.time, message, severity: 'warning', componentId };
    // Bypass the per-tick throttle: firedCallouts already guarantees one-shot,
    // and we don't want a competing warning on the same component to swallow it.
    this.calloutEntries.add(entry);
    logs.push(entry);
  }

  private throttledLog(logs: LogEntry[], entry: LogEntry, intervalSeconds = 2): boolean {
    const key = entry.componentId ?? entry.message.slice(0, 30);
    const last = this.lastLogTime.get(key) ?? -Infinity;
    if (this.time - last < intervalSeconds) return false;
    this.lastLogTime.set(key, this.time);
    logs.push(entry);
    return true;
  }

  getTime(): number {
    return this.time;
  }

  getLog(): LogEntry[] {
    return this.log;
  }

  getParticles(): Particle[] {
    return this.particles;
  }

  getComponentHealth(id: string): HealthState {
    return this.components.get(id)?.health ?? 'healthy';
  }

  getComponentMetrics(id: string): ComponentMetrics {
    return this.components.get(id)?.metrics ?? this.emptyMetrics();
  }

  getAllMetrics(): Record<string, ComponentMetrics> {
    const result: Record<string, ComponentMetrics> = {};
    this.components.forEach((state, id) => {
      result[id] = { ...state.metrics };
    });
    return result;
  }

  /**
   * Per-wire outcomes captured during the most recent tick. Exposed for
   * tests + future UI surfaces (wire-hover rich tooltip). Read-only snapshot —
   * callers should not mutate.
   */
  tickOutcomes(): WireTickOutcome[] {
    return Array.from(this.wireOutcomes.values());
  }

  /** Deferred back-edge traffic carried into the next tick's inbound. */
  pendingCount(): number {
    let n = 0;
    this.pendingInbound.forEach((p) => { if (p.rps > 0) n += 1; });
    return n;
  }

  isComplete(): boolean {
    return this.time >= this.trafficProfile.durationSeconds;
  }

  private getCurrentRps(): number {
    if (this.stressedMode) {
      // Stressed mode: hold the peak RPS for the full run
      let peak = 0;
      for (const phase of this.trafficProfile.phases) {
        if (phase.rps > peak) peak = phase.rps;
      }
      return peak;
    }
    for (const phase of this.trafficProfile.phases) {
      if (this.time >= phase.startS && this.time < phase.endS) {
        if (phase.shape === 'steady' || phase.shape === 'instant_spike') return phase.rps;
        if (phase.shape === 'ramp_down') {
          const progress = (this.time - phase.startS) / (phase.endS - phase.startS);
          const prevPhase = this.trafficProfile.phases.find(
            (p) => p.endS === phase.startS
          );
          const startRps = prevPhase ? prevPhase.rps : phase.rps;
          return startRps + (phase.rps - startRps) * progress;
        }
        if (phase.shape === 'ramp_up') {
          const progress = (this.time - phase.startS) / (phase.endS - phase.startS);
          return phase.rps * progress;
        }
        return phase.rps;
      }
    }
    return 0;
  }

  private addJitter(value: number, jitterPct: number): number {
    const jitter = (this.random() - 0.5) * 2 * (jitterPct / 100) * value;
    return Math.max(0, value + jitter);
  }

  /** Inbound-accumulator write with 0 upstream latency — used by entry seeding. */
  private seedAt(id: string, rps: number) {
    if (rps <= 0) return;
    this.inboundRps.set(id, (this.inboundRps.get(id) ?? 0) + rps);
    const acc = this.inboundLat.get(id) ?? { num: 0, denom: 0 };
    acc.denom += rps;
    this.inboundLat.set(id, acc);
  }

  /**
   * Seed each component's per-tick inbound accumulators with the tick's total
   * traffic. Per-endpoint routing when `endpointRoutes` + weights are available,
   * legacy even-split over `entryPoints` otherwise. See Phase 4.2 of
   * `docs/plans/2026-04-22-simfid-phases-4-8-revised.md` for the fallback
   * layering this implements.
   */
  private seedInboundTraffic(rpsPerTick: number, logs: LogEntry[]) {
    if (rpsPerTick <= 0) return;

    const fallbackEvenSplit = () => {
      const per = rpsPerTick / Math.max(this.entryPoints.length, 1);
      for (const id of this.entryPoints) this.seedAt(id, per);
    };

    if (this.endpointRoutes.length === 0) {
      fallbackEvenSplit();
      return;
    }

    // Pass 1 — partition requestMix into matched vs unmatched. A key matches if
    // it equals an endpointId (uuid shape) OR if it matches the "METHOD PATH"
    // form of the route's ApiContract (path-string shape, what checked-in
    // scenarios like `src/scenarios/discord.ts` author). Ambiguous "METHOD PATH"
    // (two contracts sharing the same method+path, which is a data bug in the
    // user's design) is treated as unmatched + warned, not silently misrouted.
    const matched: Array<{ route: EndpointRoute; weight: number }> = [];
    let unmatchedWeight = 0;
    if (this.requestMix) {
      const byMethodPath = new Map<string, EndpointRoute | null>();
      for (const contract of this.apiContracts) {
        const route = this.endpointRoutes.find((r) => r.endpointId === contract.id);
        if (!route) continue;
        const key = `${contract.method} ${contract.path}`;
        byMethodPath.set(key, byMethodPath.has(key) ? null : route);
      }
      for (const [key, weight] of Object.entries(this.requestMix)) {
        if (!Number.isFinite(weight) || weight <= 0) continue;
        const idMatch = this.endpointRoutes.find((r) => r.endpointId === key);
        const pathMatch = idMatch ? undefined : byMethodPath.get(key);
        if (pathMatch === null) {
          // Ambiguous METHOD+PATH — fall through to default bucket + warn once.
          this.fireCallout(
            logs,
            key,
            `routing-ambiguous:${key}`,
            `Two or more API contracts share "${key}" — requestMix key "${key}" is ambiguous, falling back to default bucket at t=${Math.round(this.time)}s`,
          );
          unmatchedWeight += weight;
          continue;
        }
        const route = idMatch ?? pathMatch;
        if (route) matched.push({ route, weight });
        else unmatchedWeight += weight;
      }
    }

    // Fallback layer 2: no endpoint-keyed weights in requestMix, but routes
    // carry a non-zero `weight` field — use those instead.
    if (matched.length === 0) {
      const routeWeightSum = this.endpointRoutes.reduce(
        (s, r) => s + (Number.isFinite(r.weight) && r.weight > 0 ? r.weight : 0),
        0,
      );
      if (routeWeightSum > 0) {
        for (const r of this.endpointRoutes) {
          if (Number.isFinite(r.weight) && r.weight > 0) matched.push({ route: r, weight: r.weight });
        }
        unmatchedWeight = 0;
      }
    }

    // Fallback layer 3: neither a matching mix key nor a non-zero route weight.
    if (matched.length === 0) {
      fallbackEvenSplit();
      return;
    }

    // Pass 2 — split matched into valid (chain head is a known node) and
    // invalid (stale chain → redistribute its share across valid matched).
    const totalMatchedWeight = matched.reduce((s, m) => s + m.weight, 0);
    const totalMixSum = totalMatchedWeight + unmatchedWeight;
    if (totalMixSum <= 0) {
      fallbackEvenSplit();
      return;
    }

    const valid: Array<{ route: EndpointRoute; weight: number }> = [];
    let invalidWeight = 0;
    for (const m of matched) {
      const head = m.route.componentChain[0];
      if (head && this.components.has(head)) valid.push(m);
      else {
        invalidWeight += m.weight;
        this.fireCallout(
          logs,
          head ?? m.route.endpointId,
          `routing-stale:${m.route.endpointId}`,
          `Endpoint ${m.route.endpointId} references node "${head ?? '<empty>'}" that isn't on the graph — redistributing its share across valid endpoints at t=${Math.round(this.time)}s`,
        );
      }
    }

    // If every matched endpoint was stale, degrade gracefully to a pure even
    // split over entry points so the full tick RPS still flows. The per-stale
    // callouts already named which endpoints broke; no extra signal needed.
    if (valid.length === 0) {
      void invalidWeight; // weights already accounted for by the per-endpoint callouts
      fallbackEvenSplit();
      return;
    }

    // Routed portion = full matched share (valid + invalid). Invalid share is
    // redistributed proportionally across valid endpoints via validWeightSum.
    const routedShareRps = (totalMatchedWeight / totalMixSum) * rpsPerTick;
    const validWeightSum = valid.reduce((s, v) => s + v.weight, 0);
    for (const v of valid) {
      const share = routedShareRps * (v.weight / validWeightSum);
      this.seedAt(v.route.componentChain[0], share);
      // Record the at-entry share so DB processor can attribute read/write
      // traffic to this endpoint. Accumulate in case the same endpointId
      // appears in multiple matched buckets.
      const prev = this.endpointShareRpsThisTick.get(v.route.endpointId) ?? 0;
      this.endpointShareRpsThisTick.set(v.route.endpointId, prev + share);
    }

    // Default bucket → even-split across entry points (matches legacy behavior
    // for the "/*" portion of traffic).
    const defaultRps = rpsPerTick - routedShareRps;
    if (defaultRps > 0 && this.entryPoints.length > 0) {
      const per = defaultRps / this.entryPoints.length;
      for (const id of this.entryPoints) this.seedAt(id, per);
    }
  }

  /**
   * Advance the simulation by one tick (1 sim-second). Runs one full graph
   * traversal from every entry point, updates every component's metrics and
   * health, emits throttled log entries, and advances particle visuals.
   *
   * Called by useSimulation's setInterval at `1000 / simulationSpeed` ms.
   */
  tick(): {
    metrics: Record<string, ComponentMetrics>;
    healths: Record<string, HealthState>;
    newLogs: LogEntry[];
    particles: Particle[];
    time: number;
    wireStates: Record<string, WireLiveState>;
  } {
    const newLogs: LogEntry[] = [];
    const currentRps = this.getCurrentRps();
    const rpsPerTick = currentRps * this.tickInterval;

    // Log phase transitions
    for (const phase of this.trafficProfile.phases) {
      const phaseStart = phase.startS;
      if (Math.abs(this.time - phaseStart) < this.tickInterval && this.time >= phaseStart) {
        newLogs.push({
          time: this.time,
          message: phase.description,
          severity: phase.shape === 'instant_spike' ? 'critical' : 'info',
        });
      }
    }

    // Reset per-tick instantaneous metrics on non-crashed components. Processors
    // that run this tick will overwrite with real values; components whose
    // inbound traffic is blocked (breaker OPEN) will show truthful zeros instead
    // of stale values. Crashed components retain their last-known metrics so
    // users see WHY they crashed.
    //
    // Also reset per-wire "had traffic this tick" flag — set when effective
    // RPS flows through emitOutbound, consumed by evaluateBreakers at end of tick.
    this.components.forEach((state) => {
      if (state.crashed) return;
      state.metrics.rps = 0;
      state.metrics.errorRate = 0;
      state.metrics.p50 = 0;
      state.metrics.p95 = 0;
      state.metrics.p99 = 0;
      state.metrics.cpuPercent = 0;
      state.metrics.memoryPercent = 0;
    });
    this.wires.forEach((wire) => {
      if (wire.breaker) wire.breaker.hadTrafficThisTick = false;
    });

    // ── Phase A: topological order + per-tick accumulators ─────────────────
    //
    // Compute the dependency order so each component's processor runs exactly
    // once per tick (upstream before downstream). Back edges (cycle-closing
    // wires) are flagged; their contributions are deferred to pendingInbound
    // so we don't drop traffic around cycles.
    this.inboundRps.clear();
    this.inboundLat.clear();
    this.wireOutcomes.clear();
    this.processedThisTick.clear();
    this.endpointShareRpsThisTick.clear();

    // Merge any back-edge traffic that was deferred from the previous tick.
    // Each deferred hop incurs a full tick of scheduling delay (~tickInterval
    // seconds) in addition to the wire latency captured at deferral time —
    // add it to the latency numerator here so cycles don't under-report
    // accumulatedLatencyMs. pendingInbound is emptied; fresh deferrals added
    // during Phase B accumulate for the following tick.
    const tickDelayMs = this.tickInterval * 1000;
    this.pendingInbound.forEach((pending, id) => {
      if (pending.rps <= 0) return;
      this.inboundRps.set(id, (this.inboundRps.get(id) ?? 0) + pending.rps);
      const acc = this.inboundLat.get(id) ?? { num: 0, denom: 0 };
      acc.num += pending.latNum + pending.rps * tickDelayMs;
      acc.denom += pending.rps;
      this.inboundLat.set(id, acc);
    });
    this.pendingInbound.clear();

    const edgesForTopo = Array.from(this.wires.values()).map((w) => ({
      source: w.source,
      target: w.target,
    }));
    const { order, backEdges } = topologicalOrder(edgesForTopo, this.entryPoints);

    // Seed inbound traffic for this tick. Per-endpoint routing via
    // `endpointRoutes` + `requestMix` when available; legacy even-split over
    // `entryPoints` otherwise. Entry components have 0 upstream latency.
    this.seedInboundTraffic(rpsPerTick, newLogs);

    // ── Phase B: process every reachable component exactly once, in order ──
    //
    // Each processor sees its true aggregated inbound RPS (sum of every
    // inbound wire's effective RPS) and rps-weighted accumulated latency.
    // Processors emit outbound wire outcomes via emitOutbound, which updates
    // the downstream component's inbound accumulators before its turn.
    for (const id of order) {
      this.runComponent(id, newLogs, backEdges);
    }
    // Catch anything unreachable from entries but still part of the graph
    // (e.g., explicit entry flag on a node with no incoming path from others):
    // make sure we don't silently skip it.
    this.components.forEach((_, id) => {
      if (!this.processedThisTick.has(id)) {
        this.runComponent(id, newLogs, backEdges);
      }
    });

    // Update particles
    this.updateParticles(rpsPerTick);

    // Update all component metrics and health
    const metrics: Record<string, ComponentMetrics> = {};
    const healths: Record<string, HealthState> = {};

    this.components.forEach((state, id) => {
      this.updateComponentHealth(state, newLogs);
      metrics[id] = { ...state.metrics };
      healths[id] = state.health;
    });

    // ── Phase C: observe aggregate signals per wire ────────────────────────
    //
    // Every inbound wire to a given target now sees the SAME aggregate
    // errorRate (the target's true post-processing metric), not a last-
    // invocation-biased slice. Same no-traffic guard as acceptanceRate:
    // tick-start reset makes errorRate=0 for silent components; holding
    // the previous value beats falsely healing to 0. Missing data is not
    // health.
    this.wires.forEach((wire) => {
      const target = this.components.get(wire.target);
      if (!target) return;
      if (target.metrics.rps <= 0) return;
      wire.lastObservedErrorRate = target.metrics.errorRate;
    });

    // Advance per-wire circuit breakers based on this tick's aggregate
    // downstream errorRate (no longer biased by fan-in ordering).
    this.evaluateBreakers(newLogs);

    // Update per-component acceptanceRate (3.3 backpressure signal). Read
    // by next tick's emitOutbound so upstream callers scale their forwarded
    // RPS down when the downstream is saturated. One-tick propagation delay
    // matches real systems.
    //
    // No-traffic guard as above.
    this.components.forEach((state) => {
      if (state.crashed) return;
      if (!readBackpressureConfig(state.config)) return;
      if (state.metrics.rps <= 0) return; // no traffic = no new signal
      state.acceptanceRate = computeAcceptanceRate(state.metrics.errorRate);
    });

    // Throttle logs: max 1 log per (component, severity) per 2 seconds of sim time.
    // Callout entries bypass this entirely — firedCallouts already guarantees one-shot.
    const throttled = newLogs.filter((entry) => {
      if (this.calloutEntries.has(entry)) return true;
      const key = (entry.componentId ?? '') + ':' + entry.severity;
      const last = this.lastLogTime.get(key) ?? -Infinity;
      if (this.time - last < 2) return false;
      this.lastLogTime.set(key, this.time);
      return true;
    });

    this.log.push(...throttled);
    this.time += this.tickInterval;

    // Emit per-wire live state for UI rendering (breaker color, etc.)
    const wireStates: Record<string, WireLiveState> = {};
    this.wires.forEach((wire) => {
      wireStates[wire.id] = {
        breakerStatus: wire.breaker ? wire.breaker.status : null,
        lastObservedErrorRate: wire.lastObservedErrorRate,
      };
    });

    return { metrics, healths, newLogs: throttled, particles: [...this.particles], time: this.time, wireStates };
  }

  private getWireLatency(sourceId: string, targetId: string): number {
    for (const wire of this.wires.values()) {
      if (wire.source === sourceId && wire.target === targetId) {
        if (this.stressedMode) {
          // Worst-case wire latency = base + full jitter
          return Math.max(0, wire.config.latencyMs + wire.config.jitterMs);
        }
        const jitter = (this.random() - 0.5) * 2 * wire.config.jitterMs;
        return Math.max(0, wire.config.latencyMs + jitter);
      }
    }
    return 0;
  }

  /** Find the wire (if any) running from source to target. */
  private findWire(sourceId: string, targetId: string): WireState | undefined {
    for (const wire of this.wires.values()) {
      if (wire.source === sourceId && wire.target === targetId) return wire;
    }
    return undefined;
  }

  /**
   * Emit the outcome of one wire's forwarding attempt: apply the circuit-
   * breaker gate, retry amplification, and backpressure scaling; attribute
   * the resulting effective RPS to the target's per-tick inbound accumulator
   * (or to `pendingInbound` if the edge is a back edge or the target was
   * already processed this tick).
   *
   * Replaces the recursive `forwardOverWire` — processors call this once per
   * outbound wire and the tick driver handles downstream scheduling via the
   * topological order. Fan-in is fixed because every inbound wire contributes
   * to the target's summed inbound BEFORE the target's processor runs, so
   * `target.metrics.*` reflect the aggregate, not any single slice.
   *
   * Circuit breaker gate:
   * - OPEN: drop traffic entirely. No latency attribution, no cost.
   * - HALF_OPEN: let traffic flow. Skips retry amp + backpressure (we want a
   *   clean probe, not a replayed storm or a throttled-to-zero probe).
   * - CLOSED: normal forwarding with retry + BP applied.
   */
  private emitOutbound(
    sourceId: string,
    targetId: string,
    rpsNominal: number,
    outboundAccLat: number,
    logs: LogEntry[],
    backEdges: Set<string>,
  ): void {
    const wire = this.findWire(sourceId, targetId);
    const wireId = wire?.id ?? `${sourceId}|${targetId}`;

    const outcome: WireTickOutcome = {
      wireId,
      source: sourceId,
      target: targetId,
      rpsNominal,
      rpsEffective: 0,
      amplification: 1,
      appliedBackpressure: 1,
    };

    if (wire?.breaker?.status === 'open') {
      // OPEN breaker drops everything at the source. Record the outcome so
      // tests can assert the zero-flow decision explicitly.
      this.wireOutcomes.set(wireId, outcome);
      return;
    }

    const halfOpen = wire?.breaker?.status === 'half_open';
    let eff = rpsNominal;

    // Retry amplification — geometric sum of retry waves, gated by previous-
    // tick observed errorRate on this wire. Skipped during HALF_OPEN so probes
    // don't replay stale failures and guarantee re-open.
    const sourceState = this.components.get(sourceId);
    const retryPolicy = sourceState ? readRetryPolicy(sourceState.config) : undefined;
    if (retryPolicy && wire && rpsNominal > 0 && wire.lastObservedErrorRate > 0 && !halfOpen) {
      outcome.amplification = computeAmplification(wire.lastObservedErrorRate, retryPolicy);
      eff = rpsNominal * outcome.amplification;
    }

    // Backpressure — target's previous-tick acceptanceRate scales us down.
    // Skipped during HALF_OPEN so probes flow at nominal rate.
    const targetState = this.components.get(targetId);
    if (targetState && readBackpressureConfig(targetState.config) && !halfOpen) {
      outcome.appliedBackpressure = targetState.acceptanceRate;
      eff *= outcome.appliedBackpressure;
    }

    outcome.rpsEffective = eff;

    const wireLatency = this.getWireLatency(sourceId, targetId);
    const targetAccLat = outboundAccLat + wireLatency;

    const edgeKey = `${sourceId}|${targetId}`;
    const deferred = backEdges.has(edgeKey) || this.processedThisTick.has(targetId);
    if (eff > 0) {
      if (deferred) {
        // Cycle closers (or delivery to an already-processed node) can't be
        // served this tick. Defer to next tick so traffic isn't silently
        // dropped. Crucially: we do NOT set `hadTrafficThisTick` on the wire's
        // breaker here — the request has not actually been delivered yet, so a
        // HALF_OPEN probe cannot advance toward CLOSED on an undelivered probe.
        // The NEXT tick's emitOutbound sees this as fresh inbound (merged in at
        // tick start) and only then sets `hadTrafficThisTick` if delivery
        // succeeds.
        const p = this.pendingInbound.get(targetId) ?? { rps: 0, latNum: 0 };
        p.rps += eff;
        p.latNum += eff * targetAccLat;
        this.pendingInbound.set(targetId, p);
      } else {
        // Real delivery this tick. Safe to mark the breaker as having seen
        // traffic and to contribute to the target's aggregated inbound.
        if (wire?.breaker) wire.breaker.hadTrafficThisTick = true;
        this.inboundRps.set(targetId, (this.inboundRps.get(targetId) ?? 0) + eff);
        const acc = this.inboundLat.get(targetId) ?? { num: 0, denom: 0 };
        acc.num += eff * targetAccLat;
        acc.denom += eff;
        this.inboundLat.set(targetId, acc);
      }
    }

    this.wireOutcomes.set(wireId, outcome);

    // One-shot callouts (unchanged from previous implementation).
    if (outcome.amplification >= 1.5 && wire) {
      this.fireCallout(
        logs,
        sourceId,
        `retry-storm:${targetId}`,
        `${sourceId} → ${targetId}: retry storm amplifying load ${outcome.amplification.toFixed(1)}× at t=${Math.round(this.time)}s (downstream errorRate=${(wire.lastObservedErrorRate * 100).toFixed(0)}%)`,
      );
    }
    if (outcome.appliedBackpressure < 1 && outcome.appliedBackpressure <= 0.7) {
      const scalePct = Math.round((1 - outcome.appliedBackpressure) * 100);
      this.fireCallout(
        logs,
        sourceId,
        `backpressure:${targetId}`,
        `${targetId} signaling backpressure (acceptanceRate=${outcome.appliedBackpressure.toFixed(2)}) — ${sourceId} scaling forwarded load down ${scalePct}% at t=${Math.round(this.time)}s`,
      );
    }
  }

  /**
   * End-of-tick breaker evaluation. Every wire with a breaker inspects its
   * target's current errorRate and advances its state machine. Transitions
   * are logged as warnings so users can see the breaker open/close.
   */
  private evaluateBreakers(logs: LogEntry[]) {
    for (const wire of this.wires.values()) {
      if (!wire.breaker || !wire.breakerConfig) continue;
      const target = this.components.get(wire.target);
      if (!target) continue;
      const transition = evaluateBreaker(
        wire.breaker,
        wire.breakerConfig,
        target.metrics.errorRate,
        this.time,
      );
      if (transition) {
        // Breaker transitions are already deduped by the state machine itself.
        // Bypass the per-tick throttle so close-together transitions (e.g.,
        // open → half_open followed by half_open → closed) both make it out.
        const entry: LogEntry = {
          time: this.time,
          message: `Circuit breaker ${wire.source} → ${wire.target}: ${transition.from} → ${transition.to}`,
          severity: transition.to === 'open' ? 'critical' : 'warning',
          componentId: wire.source,
        };
        this.calloutEntries.add(entry);
        logs.push(entry);

        // On OPEN → HALF_OPEN, clear the stale error signal. The downstream
        // may have recovered during cooldown, and we don't want the probe
        // request to trigger retry amplification based on an old failure.
        if (transition.from === 'open' && transition.to === 'half_open') {
          wire.lastObservedErrorRate = 0;
        }
      }
    }
  }

  /**
   * Split outbound RPS evenly across a component's downstream wires. Each
   * wire's outcome (effective RPS, amplification, backpressure) is computed
   * by emitOutbound. LB/fanout use this; processors with topology-specific
   * split logic (LB skipping crashed/OPEN downstreams) call emitOutbound
   * directly for each filtered target.
   */
  private emitToDownstreams(
    sourceId: string,
    rps: number,
    accumulatedLatencyMs: number,
    logs: LogEntry[],
    backEdges: Set<string>,
  ) {
    const downstreams = this.adjacency.get(sourceId) ?? [];
    const rpsEach = rps / Math.max(downstreams.length, 1);
    for (const downstream of downstreams) {
      this.emitOutbound(sourceId, downstream, rpsEach, accumulatedLatencyMs, logs, backEdges);
    }
  }

  /**
   * Phase-B driver: process a single component exactly once with its true
   * aggregated inbound. Reads `inboundRps[id]` and the rps-weighted inbound
   * accumulated latency, then dispatches to the type-specific processor.
   * Processors emit outbound wire outcomes via emitOutbound / emitToDownstreams
   * during their run — no recursion.
   */
  private runComponent(id: string, logs: LogEntry[], backEdges: Set<string>): void {
    if (this.processedThisTick.has(id)) return;
    this.processedThisTick.add(id);

    const state = this.components.get(id);
    if (!state) return;
    if (state.crashed) return;

    const incomingRps = this.inboundRps.get(id) ?? 0;
    const latAcc = this.inboundLat.get(id);
    const accumulatedLatencyMs =
      latAcc && latAcc.denom > 0 ? latAcc.num / latAcc.denom : 0;

    state.totalRequests += incomingRps;

    switch (state.type) {
      case 'load_balancer':
        this.processLoadBalancer(state, incomingRps, logs, accumulatedLatencyMs, backEdges);
        break;
      case 'api_gateway':
        this.processApiGateway(state, incomingRps, logs, accumulatedLatencyMs, backEdges);
        break;
      case 'server':
        this.processServer(state, incomingRps, logs, accumulatedLatencyMs, backEdges);
        break;
      case 'cache':
        this.processCache(state, incomingRps, logs, accumulatedLatencyMs, backEdges);
        break;
      case 'queue':
        this.processQueue(state, incomingRps, logs, accumulatedLatencyMs, backEdges);
        break;
      case 'database':
        this.processDatabase(state, incomingRps, logs, accumulatedLatencyMs);
        break;
      case 'websocket_gateway':
        this.processWebSocketGateway(state, incomingRps, logs, accumulatedLatencyMs, backEdges);
        break;
      case 'fanout':
        this.processFanout(state, incomingRps, logs, accumulatedLatencyMs, backEdges);
        break;
      case 'cdn':
        this.processCdn(state, incomingRps, logs, accumulatedLatencyMs, backEdges);
        break;
      case 'external':
        this.processExternal(state, incomingRps, logs, accumulatedLatencyMs);
        break;
      case 'autoscaler':
        this.processAutoscaler(state, incomingRps, logs, accumulatedLatencyMs);
        break;
    }
  }

  private processLoadBalancer(state: ComponentState, rps: number, logs: LogEntry[], accumulatedLatencyMs: number, backEdges: Set<string>) {
    const downstreams = this.adjacency.get(state.id) ?? [];
    if (downstreams.length === 0) return;

    state.metrics.rps = rps / this.tickInterval;

    // Exclude crashed downstreams AND downstreams whose incoming wire has an
    // OPEN circuit breaker. The LB shouldn't route to something we've already
    // decided to fail-fast.
    const healthyDownstreams = downstreams.filter((d) => {
      const ds = this.components.get(d);
      if (!ds || ds.crashed) return false;
      const wire = this.findWire(state.id, d);
      if (wire?.breaker?.status === 'open') return false;
      return true;
    });

    if (healthyDownstreams.length === 0) {
      state.metrics.errorRate = 1.0;
      state.accumulatedErrors += rps;
      state.metrics.p50 = 0;
      state.metrics.p99 = 0;
      if (rps > 0) {
        logs.push({ time: this.time, message: `${state.id}: No healthy backends. All requests failing. Downstreams crashed or circuit breakers open.`, severity: 'critical', componentId: state.id });
      }
      return;
    }

    const rpsEach = rps / healthyDownstreams.length;
    const lbProcessingMs = 0.5;
    const outboundAccLat = accumulatedLatencyMs + lbProcessingMs;
    for (const downstream of healthyDownstreams) {
      this.emitOutbound(state.id, downstream, rpsEach, outboundAccLat, logs, backEdges);
    }

    // LB latency derives from PREVIOUS-tick downstream lastComputedLatencyMs
    // under the new ordering (downstream hasn't processed this tick yet when
    // LB runs). Acceptable one-tick lag, matches the same lag policy used by
    // retry + backpressure and by autoscaler's downstream observations.
    let maxDownstreamLatency = 0;
    for (const dsId of healthyDownstreams) {
      const ds = this.components.get(dsId);
      if (ds) {
        const wireLatency = this.getWireLatency(state.id, dsId);
        maxDownstreamLatency = Math.max(maxDownstreamLatency, ds.lastComputedLatencyMs + wireLatency);
      }
    }

    state.metrics.p50 = lbProcessingMs + maxDownstreamLatency * 0.7;
    state.metrics.p99 = lbProcessingMs + maxDownstreamLatency * 1.3;
    state.lastComputedLatencyMs = state.metrics.p50;
  }

  private processApiGateway(state: ComponentState, rps: number, logs: LogEntry[], accumulatedLatencyMs: number, backEdges: Set<string>) {
    const rateLimit = (state.config.rateLimitRps as number) ?? 10000;
    const rateLimitPerTick = rateLimit * this.tickInterval;

    let passthrough = rps;
    let rejected = 0;

    if (rps > rateLimitPerTick) {
      rejected = rps - rateLimitPerTick;
      passthrough = rateLimitPerTick;
    }

    state.metrics.rps = rps / this.tickInterval;
    state.metrics.errorRate = rps > 0 ? rejected / rps : 0;
    state.metrics.p50 = 2 + accumulatedLatencyMs;
    state.metrics.p99 = this.addJitter(10, 30) + accumulatedLatencyMs;
    state.lastComputedLatencyMs = state.metrics.p50;

    if (rejected > 0 && state.metrics.errorRate > 0.1) {
      logs.push({
        time: this.time,
        message: `${state.id}: Rate limiting active. ${Math.round(state.metrics.errorRate * 100)}% requests rejected.`,
        severity: 'warning',
        componentId: state.id,
      });
    }

    this.emitToDownstreams(state.id, passthrough, accumulatedLatencyMs + 2, logs, backEdges);
  }

  private processServer(state: ComponentState, rps: number, logs: LogEntry[], accumulatedLatencyMs: number, backEdges: Set<string>) {
    const maxConcurrent = (state.config.maxConcurrent as number) ?? 1000;
    const processingTime = (state.config.processingTimeMs as number) ?? 50;
    const instances = state.instanceCount;

    const arrivalRateRps = rps / this.tickInterval;

    const q = computeQueueing({
      arrivalRateRps,
      processingTimeMs: processingTime,
      instanceCount: instances,
      maxConcurrentPerInstance: maxConcurrent,
    });

    state.metrics.cpuPercent = q.utilization * 100;
    state.metrics.memoryPercent = q.utilization * 60 + this.random() * 10;
    state.metrics.rps = arrivalRateRps;

    state.metrics.p50 = q.p50Ms + accumulatedLatencyMs;
    state.metrics.p95 = q.p95Ms + accumulatedLatencyMs;
    state.metrics.p99 = q.p99Ms + accumulatedLatencyMs;
    state.lastComputedLatencyMs = q.p50Ms;

    if (q.utilization >= 0.85) {
      const headroom = Math.max(0, Math.round((1 - q.utilization) * 100));
      this.fireCallout(
        logs,
        state.id,
        'saturation',
        `${state.id} hit ρ=${q.utilization.toFixed(2)} at t=${Math.round(this.time)}s — ${headroom}% headroom before queueing collapse`,
      );
    }

    let passthrough = rps;
    if (q.dropRate > 0) {
      const dropped = rps * q.dropRate;
      passthrough = rps - dropped;
      state.metrics.errorRate = q.dropRate;
      state.accumulatedErrors += dropped;

      const serviceRate = Math.round(1000 / processingTime);
      const totalCapacity = serviceRate * instances;
      const neededInstances = Math.ceil(arrivalRateRps / serviceRate);
      this.throttledLog(logs, {
        time: this.time,
        message: `${state.id}: Dropping ${Math.round(q.dropRate * 100)}% of requests. ` +
          `Capacity: ${totalCapacity} RPS (${instances} instance${instances > 1 ? 's' : ''} × ${serviceRate} RPS each). ` +
          `Demand: ${Math.round(arrivalRateRps)} RPS. ` +
          `Try increasing to ${neededInstances}+ instances.`,
        severity: 'warning',
        componentId: state.id,
      });
    } else {
      state.metrics.errorRate = 0;
    }

    this.emitToDownstreams(state.id, passthrough, accumulatedLatencyMs + q.p50Ms, logs, backEdges);
  }

  private processCache(state: ComponentState, rps: number, logs: LogEntry[], accumulatedLatencyMs: number, backEdges: Set<string>) {
    const maxMemoryMb = (state.config.maxMemoryMb as number) ?? 1024;
    const ttlSeconds = (state.config.ttlSeconds as number) ?? 300;
    const evictionPolicy = (state.config.evictionPolicy as 'lru' | 'lfu' | 'ttl-only') ?? 'lru';

    const arrivalRateRps = rps / this.tickInterval;
    const keyCardinality = 100000;
    const avgValueBytes = 512;

    const cacheResult = computeCacheModel({
      rps: arrivalRateRps,
      cacheSizeMb: maxMemoryMb,
      ttlSeconds,
      evictionPolicy,
      keyCardinality,
      avgValueBytes,
      simTimeSeconds: this.time,
    });

    let hitRate = cacheResult.hitRate;

    if (this.stressedMode) {
      // Worst case: cold cache, no hits. Skip stampede modeling entirely —
      // a forced-cold cache is already the worst case, no "mass TTL expiry" applies.
      hitRate = 0;
    }

    if (!this.stressedMode && cacheResult.stampedeRisk) {
      const phaseTime = this.time % ttlSeconds;
      if (phaseTime < 2) {
        hitRate *= 0.3;
        if (!state.crashed) {
          logs.push({
            time: this.time,
            message: `${state.id}: Cache stampede detected. Mass TTL expiry causing DB flood.`,
            severity: 'critical',
            componentId: state.id,
          });
        }
      }
    }

    state.metrics.cacheHitRate = hitRate;
    state.metrics.rps = arrivalRateRps;
    state.metrics.memoryPercent = Math.min(100, (cacheResult.memoryUsedMb / maxMemoryMb) * 100);

    const peak = this.peakCacheHitRate.get(state.id) ?? 0;
    if (hitRate > peak) this.peakCacheHitRate.set(state.id, hitRate);
    if (hitRate <= 0.5 && peak >= 0.8) {
      this.fireCallout(
        logs,
        state.id,
        'miss-storm',
        `${state.id} hit rate fell from ${Math.round(peak * 100)}% to ${Math.round(hitRate * 100)}% at t=${Math.round(this.time)}s — likely stampede or key churn`,
      );
    }

    const latency = networkAwareCacheLatency(maxMemoryMb, ttlSeconds);
    state.metrics.p50 = latency.p50 + accumulatedLatencyMs;
    state.metrics.p99 = (hitRate > 0.5 ? latency.p99 : latency.p99 * 10) + accumulatedLatencyMs;
    state.lastComputedLatencyMs = latency.p50;

    const missRps = rps * (1 - hitRate);
    this.emitToDownstreams(state.id, missRps, accumulatedLatencyMs + latency.p50, logs, backEdges);
  }

  private processQueue(state: ComponentState, rps: number, logs: LogEntry[], accumulatedLatencyMs: number, backEdges: Set<string>) {
    const maxDepth = (state.config.maxDepth as number) ?? 10000000;
    const consumersPerGroup = (state.config.consumersPerGroup as number) ?? 5;
    const consumerGroups = (state.config.consumerGroupCount as number) ?? 1;
    const processingTimeMs = (state.config.processingTimeMs as number) ?? 10;
    const dlqEnabled = state.config.dlqEnabled as boolean;

    // Consumer throughput
    const totalConsumers = consumersPerGroup * consumerGroups;
    const consumerThroughput = (totalConsumers / processingTimeMs) * 1000 * this.tickInterval;

    // Add to queue
    state.queueDepth += rps;
    // Consume from queue
    const consumed = Math.min(state.queueDepth, consumerThroughput);
    state.queueDepth -= consumed;

    // Drop if over max depth
    let dropped = 0;
    if (state.queueDepth > maxDepth) {
      dropped = state.queueDepth - maxDepth;
      state.queueDepth = maxDepth;
      if (dlqEnabled) {
        state.accumulatedErrors += dropped;
      }
    }

    state.metrics.rps = rps / this.tickInterval;
    state.metrics.queueDepth = Math.round(state.queueDepth);
    state.metrics.errorRate = rps > 0 ? dropped / rps : 0;
    state.metrics.p50 = (state.queueDepth / Math.max(consumerThroughput / this.tickInterval, 1)) * 1000;
    state.metrics.p99 = state.metrics.p50 * 3;
    state.metrics.memoryPercent = (state.queueDepth / maxDepth) * 100;

    if (state.queueDepth >= maxDepth * 0.7) {
      const pct = Math.round((state.queueDepth / maxDepth) * 100);
      this.fireCallout(
        logs,
        state.id,
        'filling',
        `${state.id} queue at ${pct}% capacity (t=${Math.round(this.time)}s) — consumers not keeping up`,
      );
    }

    if (state.queueDepth > maxDepth * 0.8 && state.health !== 'critical') {
      logs.push({
        time: this.time,
        message: `${state.id}: Queue depth ${Math.round(state.queueDepth).toLocaleString()} messages. ${Math.round((state.queueDepth / maxDepth) * 100)}% capacity.`,
        severity: 'warning',
        componentId: state.id,
      });
    }

    if (dropped > 0) {
      logs.push({
        time: this.time,
        message: `${state.id}: Queue overflow. ${Math.round(dropped).toLocaleString()} messages ${dlqEnabled ? 'moved to DLQ' : 'DROPPED'}.`,
        severity: 'critical',
        componentId: state.id,
      });
    }

    state.lastComputedLatencyMs = state.metrics.p50;
    this.emitToDownstreams(state.id, consumed, accumulatedLatencyMs + state.metrics.p50, logs, backEdges);
  }

  /**
   * Phase 4.3 — read/write attribution fallback. Applies when the DB has no
   * usable per-endpoint attribution (no `endpointRoutes`, or no chain visits
   * this DB). Matches typical load-generator defaults; see Decisions §54 for
   * why 70/30 and not 80/20. Don't change in isolation — the unindexed-scan
   * multiplier (Phase 4.4) and the Kingman arrival-variance math (Phase 4.6)
   * assume this split shape for their fallback branches too.
   */
  private static readonly DB_FALLBACK_READ_SHARE = 0.7;

  /**
   * Phase 4.4 — latency multiplier for unindexed access. Must match
   * [`src/engine/preflight.ts:140`](preflight.ts) user-facing copy ("Queries
   * without indexes are 10x slower"). Changing this in one place and not the
   * other is a correctness regression; they MUST agree.
   */
  private static readonly SCAN_FACTOR = 10;

  /**
   * Phase 4.4 — threshold (fraction of this DB's routed inbound) above which
   * the one-shot unindexed-scan callout fires per `(dbId, tableId)` key. 5%
   * picks up meaningful scans while staying quiet for scenarios that model
   * tiny admin endpoints (1% of traffic hitting an un-indexed internal
   * table is not a finding worth surfacing).
   */
  private static readonly UNINDEXED_CALLOUT_THRESHOLD = 0.05;

  /**
   * Compute read vs write inbound RPS breakdown for a database from the
   * per-tick endpoint share map (populated by `seedInboundTraffic`) + the
   * `schemaMemory` table→DB join.
   *
   * Algorithm — walks every EndpointRoute whose `componentChain` visits this
   * DB id; for each such route, only `TableAccess` entries whose `tableId`
   * resolves (via `schemaMemory.entities[].assignedDbId`) to THIS DB are
   * counted. Mode semantics are per-operation, not per-request: `read_write`
   * adds the full endpoint share to both buckets (one request does both a
   * read AND a write), matching the plan's §4.3 algorithm.
   *
   * Fallback — when no endpoint contributes to either bucket, the full
   * inbound RPS splits `DB_FALLBACK_READ_SHARE / 1-DB_FALLBACK_READ_SHARE`
   * between read and write. A `null` return would force every call site to
   * handle the degenerate case; instead we always return a sensible shape.
   *
   * Edge cases: routes with `tablesAccessed` pointing to tables not on this
   * DB contribute zero; the endpoint visit itself is "ambient" and folded
   * into the untracked-remainder 70/30. Endpoints whose `tablesAccessed`
   * arrays are empty but whose chain visits this DB are treated as having
   * no read/write operations here (same rationale — we can't infer the
   * mode). Callers get back rps-per-tick in both fields (matching
   * `inboundRps` units).
   */
  private computeDbReadWriteBreakdown(
    dbId: string,
    totalInboundRps: number,
  ): { readRps: number; writeRps: number; attributed: boolean } {
    if (totalInboundRps <= 0) return { readRps: 0, writeRps: 0, attributed: false };

    // Early-out: no routing context at all → full 70/30 fallback.
    if (this.endpointRoutes.length === 0) {
      return {
        readRps: totalInboundRps * SimulationEngine.DB_FALLBACK_READ_SHARE,
        writeRps: totalInboundRps * (1 - SimulationEngine.DB_FALLBACK_READ_SHARE),
        attributed: false,
      };
    }

    // Table→DB join. Tables "live on" this DB iff their owning entity is
    // assigned to the DB via `assignedDbId`. For the common case where no
    // entities are mapped yet we keep the map empty — every TableAccess
    // lookup will miss, and the fallback branch below handles it.
    const tablesOnThisDb = new Set<string>();
    if (this.schemaMemory) {
      for (const entity of this.schemaMemory.entities) {
        if (entity.assignedDbId === dbId) tablesOnThisDb.add(entity.id);
      }
    }

    let routedReadRps = 0;
    let routedWriteRps = 0;
    for (const route of this.endpointRoutes) {
      if (!route.componentChain.includes(dbId)) continue;
      const share = this.endpointShareRpsThisTick.get(route.endpointId) ?? 0;
      if (share <= 0) continue;
      let touchedRead = false;
      let touchedWrite = false;
      for (const ta of route.tablesAccessed) {
        // If we know the schema join, filter to tables on this DB. If we
        // don't (empty schemaMemory or entity unassigned), accept any table
        // in the endpoint's list — better over-attribute than silently zero.
        if (tablesOnThisDb.size > 0 && !tablesOnThisDb.has(ta.tableId)) continue;
        if (ta.mode === 'read') touchedRead = true;
        else if (ta.mode === 'write') touchedWrite = true;
        else if (ta.mode === 'read_write') { touchedRead = true; touchedWrite = true; }
      }
      if (touchedRead) routedReadRps += share;
      if (touchedWrite) routedWriteRps += share;
    }

    // Nothing attributable (schema missing, tables unknown, or chains don't
    // visit) → 70/30 fallback on the full inbound, matching no-routing case.
    if (routedReadRps === 0 && routedWriteRps === 0) {
      return {
        readRps: totalInboundRps * SimulationEngine.DB_FALLBACK_READ_SHARE,
        writeRps: totalInboundRps * (1 - SimulationEngine.DB_FALLBACK_READ_SHARE),
        attributed: false,
      };
    }

    return { readRps: routedReadRps, writeRps: routedWriteRps, attributed: true };
  }

  private processDatabase(state: ComponentState, rps: number, logs: LogEntry[], accumulatedLatencyMs: number) {
    const shardingEnabled = state.config.shardingEnabled as boolean;
    const shardCount = (state.config.shardCount as number) ?? 1;
    const connectionPoolSize = (state.config.connectionPoolSize as number) ?? 100;
    const writeThroughput = (state.config.writeThroughputRps as number) ?? 20000;
    const readThroughput = (state.config.readThroughputRps as number) ?? 50000;
    const readReplicas = (state.config.readReplicas as number) ?? 0;
    const replicationLag = (state.config.replicationLagMs as number) ?? 10;

    const totalThroughput = (writeThroughput + readThroughput * (1 + readReplicas));
    const throughputPerTick = totalThroughput * this.tickInterval;

    // Connection pool
    state.currentConnections += rps;
    const processedThisTick = Math.min(state.currentConnections, throughputPerTick);
    state.currentConnections -= processedThisTick;
    state.currentConnections = Math.max(0, state.currentConnections);

    const connectionUtilization = state.currentConnections / connectionPoolSize;
    state.metrics.activeConnections = Math.round(state.currentConnections);

    if (connectionUtilization >= 0.8) {
      this.fireCallout(
        logs,
        state.id,
        'pool-pressure',
        `${state.id} using ${Math.round(connectionUtilization * 100)}% of connection pool at t=${Math.round(this.time)}s — add replicas or pool size`,
      );
    }

    // Shard distribution
    if (shardingEnabled && shardCount > 1) {
      // Determine skew based on shard key cardinality
      const isLowCardinality = this.schemaShardKeyCardinality === 'low' || this.schemaShardKeyCardinality === 'medium';
      const shardKey = (state.config.shardKey as string) ?? '';
      const isUserIdShard = shardKey.toLowerCase().includes('user');

      if (isLowCardinality || isUserIdShard) {
        // Pareto distribution - hot shard
        const loads = new Array(shardCount).fill(0);
        const hotShard = 1; // shard-2 (0-indexed)
        for (let i = 0; i < shardCount; i++) {
          if (i === hotShard) {
            loads[i] = (rps * 0.78) / this.tickInterval; // 78% of load
          } else {
            loads[i] = (rps * 0.22 / (shardCount - 1)) / this.tickInterval;
          }
        }
        state.shardLoads = loads;
        state.metrics.shardDistribution = loads;

        // Hot shard effects
        const hotShardLoad = loads[hotShard];
        const shardCapacity = writeThroughput / shardCount;
        if (hotShardLoad > shardCapacity * 0.8 && !state.crashed) {
          const memPressure = Math.min(100, (hotShardLoad / shardCapacity) * 80);
          state.metrics.memoryPercent = memPressure;

          if (memPressure > 85 && this.time > 32) {
            logs.push({
              time: this.time,
              message: `${state.id} shard-2 memory: ${Math.round(memPressure)}%. Writes queuing.`,
              severity: memPressure > 90 ? 'critical' : 'warning',
              componentId: state.id,
            });
          }
        }
      } else {
        // Even distribution
        const loads = new Array(shardCount).fill(rps / shardCount / this.tickInterval);
        state.shardLoads = loads;
        state.metrics.shardDistribution = loads;
      }
    }

    // Overall metrics
    state.metrics.rps = rps / this.tickInterval;
    const utilizationPct = Math.min(100, (rps / (throughputPerTick || 1)) * 100);
    state.metrics.cpuPercent = utilizationPct;
    state.metrics.memoryPercent = Math.max(state.metrics.memoryPercent, utilizationPct * 0.6);

    // Latency increases dramatically under load
    const baseLatency = 5;
    const loadFactor = 1 + Math.pow(utilizationPct / 100, 4) * 50;
    const connectionPenalty = connectionUtilization > 0.8 ? (connectionUtilization - 0.8) * 500 : 0;
    const dbLatencyBase = baseLatency * loadFactor + connectionPenalty;

    // Phase 4.4 — unindexed-scan latency multiplier. Walks the same routed-
    // endpoint attribution used by the read/write split (above) and sums
    // the share (fraction of routed DB inbound) whose `TableAccess.indexed`
    // is false for tables resident on this DB. Resulting multiplier is
    // `1 + (SCAN_FACTOR - 1) × unindexedShare`; SCAN_FACTOR is locked to
    // preflight.ts's "10× slower" copy (Decisions §55).
    //
    // Denominator is routed-DB-visiting share, not total inbound: we don't
    // attribute unindexed-ness to fan-out amplification or to the default
    // bucket, where the TableAccess shape is unknown. This is the same
    // "attributed" gate the read-saturation callout uses — keeps the
    // multiplier honest under partial attribution.
    let unindexedShare = 0;
    const unindexedTablesThisTick: Array<{ tableId: string; endpointId: string; share: number }> = [];
    if (this.endpointRoutes.length > 0) {
      const tablesOnThisDb = new Set<string>();
      const tableNamesOnThisDb = new Map<string, string>();
      if (this.schemaMemory) {
        for (const ent of this.schemaMemory.entities) {
          if (ent.assignedDbId === state.id) {
            tablesOnThisDb.add(ent.id);
            tableNamesOnThisDb.set(ent.id, ent.name);
          }
        }
      }
      let routedDbShareSum = 0;
      let unindexedSum = 0;
      for (const route of this.endpointRoutes) {
        if (!route.componentChain.includes(state.id)) continue;
        const share = this.endpointShareRpsThisTick.get(route.endpointId) ?? 0;
        if (share <= 0) continue;
        // Only count shares tied to tables we can confirm live on this DB
        // (schema join) — or, when the schema is sparse, accept any table
        // in the endpoint's list (same fallback policy as read/write).
        let endpointCountedOnDb = false;
        for (const ta of route.tablesAccessed) {
          if (tablesOnThisDb.size > 0 && !tablesOnThisDb.has(ta.tableId)) continue;
          if (!endpointCountedOnDb) {
            routedDbShareSum += share;
            endpointCountedOnDb = true;
          }
          if (ta.indexed === false) {
            unindexedSum += share;
            unindexedTablesThisTick.push({
              tableId: ta.tableId,
              endpointId: route.endpointId,
              share,
            });
            // Each endpoint can touch several un-indexed tables; we credit
            // the full share to each for callout purposes but the aggregate
            // unindexedSum may then exceed routedDbShareSum — clamp below
            // before using in the multiplier so a 3-un-indexed-table
            // endpoint doesn't triple-weight the latency bump.
          }
        }
      }
      if (routedDbShareSum > 0) {
        unindexedShare = Math.min(1, unindexedSum / routedDbShareSum);
      }
    }
    const scanMultiplier = 1 + (SimulationEngine.SCAN_FACTOR - 1) * unindexedShare;
    const dbLatency = dbLatencyBase * scanMultiplier;

    state.metrics.p50 = dbLatency + accumulatedLatencyMs;
    state.metrics.p95 = dbLatency * 2 + accumulatedLatencyMs;
    state.metrics.p99 = dbLatency * 4 + replicationLag + accumulatedLatencyMs;
    state.lastComputedLatencyMs = dbLatency;

    // One-shot callouts per (dbId, tableId). Wording is deliberately hedged
    // ("may include unindexed access") because `TableAccess.indexed=false`
    // is coarse — a single false flag on a table covers every operation on
    // that table for that endpoint, even reads that the real engine might
    // push through an existing index. Caller gets the clue, not a verdict.
    if (unindexedShare > 0 && unindexedTablesThisTick.length > 0) {
      // Aggregate per-table across all endpoints visiting this DB with
      // unindexed access to that table, so the threshold check reflects
      // the TABLE's unindexed traffic on this DB, not any single
      // endpoint's.
      const perTable = new Map<string, { shareSum: number; endpoints: Set<string>; name: string }>();
      const routedDbShareSumLocal = this.endpointRoutes.reduce((acc, r) => {
        if (!r.componentChain.includes(state.id)) return acc;
        const share = this.endpointShareRpsThisTick.get(r.endpointId) ?? 0;
        return acc + share;
      }, 0);
      if (routedDbShareSumLocal > 0) {
        for (const hit of unindexedTablesThisTick) {
          const entry = perTable.get(hit.tableId) ?? { shareSum: 0, endpoints: new Set<string>(), name: hit.tableId };
          entry.shareSum += hit.share;
          entry.endpoints.add(hit.endpointId);
          // Prefer the human-readable entity name when we have it.
          if (this.schemaMemory) {
            const ent = this.schemaMemory.entities.find((e) => e.id === hit.tableId);
            if (ent) entry.name = ent.name;
          }
          perTable.set(hit.tableId, entry);
        }
        for (const [tableId, entry] of perTable) {
          const tableShare = Math.min(1, entry.shareSum / routedDbShareSumLocal);
          if (tableShare < SimulationEngine.UNINDEXED_CALLOUT_THRESHOLD) continue;
          const firstEp = entry.endpoints.values().next().value;
          const moreEps = entry.endpoints.size > 1 ? ` (+${entry.endpoints.size - 1} more)` : '';
          this.fireCallout(
            logs,
            state.id,
            `unindexed-scan:${tableId}`,
            `${state.id}: may include unindexed access on "${entry.name}" via ${firstEp}${moreEps} — ${Math.round(tableShare * 100)}% of routed traffic at t=${Math.round(this.time)}s — add an index`,
          );
        }
      }
    }

    // Phase 4.3 — read/write saturation. Diagnostic split attributed via
    // endpointRoutes + schemaMemory when available; 70/30 fallback otherwise.
    // The same saturation curve used by connection-pool exhaustion below
    // is applied per-side: errorRate = clamp(0, 0.9, (util - 1) * 0.5). This
    // is intentionally additive to — not a replacement for — connection-pool
    // errorRate; the aggregate takes max across all three so breakers/retry/
    // backpressure (which still read the aggregate `errorRate` per §52)
    // continue to trip on whichever failure mode hits first.
    const { readRps: inboundReadRps, writeRps: inboundWriteRps, attributed: rwAttributed } =
      this.computeDbReadWriteBreakdown(state.id, rps);
    const readCapacityPerTick = readThroughput * (1 + readReplicas) * this.tickInterval;
    const writeCapacityPerTick = writeThroughput * this.tickInterval;
    // Divide-by-zero guard: if a side has no capacity AND inbound > 0, that
    // side is fully saturated. If both are zero (inbound and capacity), we
    // report 0 errorRate on that side — there's nothing to fail.
    const readUtilization = readCapacityPerTick > 0
      ? inboundReadRps / readCapacityPerTick
      : inboundReadRps > 0 ? Infinity : 0;
    const writeUtilization = writeCapacityPerTick > 0
      ? inboundWriteRps / writeCapacityPerTick
      : inboundWriteRps > 0 ? Infinity : 0;
    const saturationErr = (u: number) => u > 1 ? Math.min(0.9, (u - 1) * 0.5) : 0;
    const readErrorRate = saturationErr(readUtilization);
    const writeErrorRate = saturationErr(writeUtilization);
    state.metrics.readErrorRate = readErrorRate;
    state.metrics.writeErrorRate = writeErrorRate;

    // Connection pool exhaustion — orthogonal failure mode (exhaust the pool
    // before you exhaust throughput = bad pool sizing). Still sets errorRate
    // aggregate so downstream breakers/retry/BP see it; preserved behavior.
    let poolDropRate = 0;
    if (connectionUtilization > 1) {
      poolDropRate = Math.min(0.9, (connectionUtilization - 1) * 0.5);
      state.accumulatedErrors += rps * poolDropRate;

      if (poolDropRate > 0.1) {
        logs.push({
          time: this.time,
          message: `${state.id}: Connection pool exhaustion. ${Math.round(poolDropRate * 100)}% of queries failing.`,
          severity: 'critical',
          componentId: state.id,
        });
      }
    }

    // Aggregate errorRate = max of all three failure modes. Control-signal
    // consumers (breakers, retry, backpressure) continue reading this
    // aggregate only; the split fields are strictly diagnostic (§54).
    state.metrics.errorRate = Math.max(readErrorRate, writeErrorRate, poolDropRate);

    // One-shot callouts per (dbId, side) when the attributed side saturates.
    // Only fires when attribution was actually available — with the 70/30
    // fallback the split is a modeling assumption, not a user-facing signal,
    // so warning about "write saturation" when we can't see their schema is
    // misleading.
    if (rwAttributed) {
      if (readErrorRate > 0.05) {
        this.fireCallout(
          logs,
          state.id,
          'read-saturation',
          `${state.id} read side saturated (${Math.round(readUtilization * 100)}% util, errorRate=${readErrorRate.toFixed(2)}) at t=${Math.round(this.time)}s — add read replicas or a cache`,
        );
      }
      if (writeErrorRate > 0.05) {
        this.fireCallout(
          logs,
          state.id,
          'write-saturation',
          `${state.id} write side saturated (${Math.round(writeUtilization * 100)}% util, errorRate=${writeErrorRate.toFixed(2)}) at t=${Math.round(this.time)}s — scale writes (sharding, batching, or a write-optimized store)`,
        );
      }
    }
  }

  private processWebSocketGateway(state: ComponentState, rps: number, logs: LogEntry[], accumulatedLatencyMs: number, backEdges: Set<string>) {
    const maxConnections = (state.config.maxConnections as number) ?? 100000;

    state.currentConnections += rps * 0.1;
    state.currentConnections -= state.currentConnections * 0.001 * this.tickInterval;

    state.metrics.rps = rps / this.tickInterval;
    state.metrics.activeConnections = Math.round(state.currentConnections);
    state.metrics.memoryPercent = (state.currentConnections / maxConnections) * 100;
    state.metrics.p50 = 2 + accumulatedLatencyMs;
    state.metrics.p99 = 15 + accumulatedLatencyMs;
    state.lastComputedLatencyMs = 2;

    if (state.currentConnections > maxConnections * 0.9) {
      logs.push({
        time: this.time,
        message: `${state.id}: ${Math.round((state.currentConnections / maxConnections) * 100)}% connection capacity.`,
        severity: 'warning',
        componentId: state.id,
      });
    }

    this.emitToDownstreams(state.id, rps, accumulatedLatencyMs + 2, logs, backEdges);
  }

  private processFanout(state: ComponentState, rps: number, logs: LogEntry[], accumulatedLatencyMs: number, backEdges: Set<string>) {
    const multiplier = (state.config.multiplier as number) ?? 500000;
    const deliveryMode = state.config.deliveryMode as string;

    const outputRps = rps * multiplier;
    state.metrics.rps = rps / this.tickInterval;
    state.metrics.cpuPercent = Math.min(100, (rps / this.tickInterval / 1000) * 80);
    const fanoutLatency = deliveryMode === 'parallel' ? 10 : multiplier * 0.001;
    state.metrics.p50 = fanoutLatency + accumulatedLatencyMs;
    state.metrics.p99 = fanoutLatency * 5 + accumulatedLatencyMs;
    state.lastComputedLatencyMs = fanoutLatency;

    if (outputRps > 0 && rps / this.tickInterval > 100) {
      logs.push({
        time: this.time,
        message: `${state.id}: Fanout generating ${Math.round(outputRps / this.tickInterval).toLocaleString()} msgs/s.`,
        severity: 'info',
        componentId: state.id,
      });
    }

    this.emitToDownstreams(state.id, outputRps, accumulatedLatencyMs + fanoutLatency, logs, backEdges);
  }

  private processCdn(state: ComponentState, rps: number, logs: LogEntry[], accumulatedLatencyMs: number, backEdges: Set<string>) {
    // Stressed: force cold CDN too, so every request hits origin.
    const hitRate = this.stressedMode ? 0 : ((state.config.cacheHitRate as number) ?? 0.9);
    const originLatency = (state.config.originPullLatencyMs as number) ?? 200;

    state.metrics.rps = rps / this.tickInterval;
    state.metrics.cacheHitRate = hitRate;
    const cdnLatency = hitRate * 5 + (1 - hitRate) * originLatency;
    state.metrics.p50 = cdnLatency + accumulatedLatencyMs;
    state.metrics.p99 = originLatency + accumulatedLatencyMs;
    state.lastComputedLatencyMs = cdnLatency;

    const missRps = rps * (1 - hitRate);
    this.emitToDownstreams(state.id, missRps, accumulatedLatencyMs + cdnLatency, logs, backEdges);
  }

  private processExternal(state: ComponentState, rps: number, logs: LogEntry[], accumulatedLatencyMs: number) {
    const latency = (state.config.latencyMs as number) ?? 100;
    const errorRate = (state.config.errorRate as number) ?? 0.01;

    state.metrics.rps = rps / this.tickInterval;
    state.metrics.p50 = latency + accumulatedLatencyMs;
    state.metrics.p99 = latency * 3 + accumulatedLatencyMs;
    state.metrics.errorRate = errorRate + (this.random() * 0.02);
    state.lastComputedLatencyMs = latency;
  }

  private processAutoscaler(state: ComponentState, _rps: number, logs: LogEntry[], _accumulatedLatencyMs: number) {
    const targetCpu = (state.config.targetCpuThreshold as number) ?? 70;
    const maxInstances = (state.config.maxInstances as number) ?? 20;
    const minInstances = (state.config.minInstances as number) ?? 1;
    const scaleUpDelay = (state.config.scaleUpDelaySeconds as number) ?? 30;

    // Look at connected server components
    const downstreams = this.adjacency.get(state.id) ?? [];
    for (const dsId of downstreams) {
      const ds = this.components.get(dsId);
      if (!ds || ds.type !== 'server') continue;

      if (ds.metrics.cpuPercent > targetCpu && ds.instanceCount < maxInstances) {
        // Scale up with delay
        if (this.time % scaleUpDelay < this.tickInterval) {
          ds.instanceCount = Math.min(maxInstances, ds.instanceCount + 1);
          logs.push({
            time: this.time,
            message: `${state.id}: Scaling ${dsId} to ${ds.instanceCount} instances. CPU was ${Math.round(ds.metrics.cpuPercent)}%.`,
            severity: 'info',
            componentId: state.id,
          });
        }
      } else if (ds.metrics.cpuPercent < targetCpu * 0.5 && ds.instanceCount > minInstances) {
        ds.instanceCount = Math.max(minInstances, ds.instanceCount - 1);
      }
    }
    state.metrics.rps = 0;
  }

  private updateComponentHealth(state: ComponentState, logs: LogEntry[]) {
    if (state.crashed) return;

    const cpu = state.metrics.cpuPercent;
    const mem = state.metrics.memoryPercent;
    const maxUtil = Math.max(cpu, mem);
    const prevHealth = state.health;

    if (maxUtil > 95 && state.type !== 'autoscaler') {
      // Check for crash
      if (maxUtil > 98 && this.random() < 0.3) {
        state.crashed = true;
        state.health = 'crashed';
        const resource = cpu > mem ? 'CPU' : 'Memory';
        let fix = '';
        if (state.type === 'server') {
          const procTime = (state.config.processingTimeMs as number) ?? 50;
          const serviceRate = Math.round(1000 / procTime);
          const rps = Math.round(state.metrics.rps);
          const needed = Math.ceil(rps / serviceRate);
          fix = ` At ${procTime}ms/request, each instance handles ${serviceRate} RPS. ` +
            `You're sending ${rps} RPS to ${state.instanceCount} instance${state.instanceCount > 1 ? 's' : ''}. ` +
            `Try ${needed}+ instances, or reduce processing time.`;
        } else if (state.type === 'database') {
          fix = ' Check connection pool size, add read replicas, or reduce upstream traffic.';
        }
        logs.push({
          time: this.time,
          message: `${state.id} CRASH. ${resource} exhausted.${fix}`,
          severity: 'critical',
          componentId: state.id,
        });
        return;
      }
      state.health = 'critical';
    } else if (maxUtil > 70) {
      state.health = 'warning';
    } else {
      state.health = 'healthy';
    }

    // Log state transitions
    if (prevHealth !== state.health && state.health === 'critical') {
      logs.push({
        time: this.time,
        message: `${state.id}: CRITICAL — CPU ${Math.round(cpu)}%, MEM ${Math.round(mem)}%.`,
        severity: 'critical',
        componentId: state.id,
      });
    }
  }

  private updateParticles(rps: number) {
    // Move existing particles
    this.particles = this.particles
      .map((p) => ({
        ...p,
        progress: p.progress + p.speed,
        status: p.progress + p.speed >= 1 ? ('success' as const) : p.status,
      }))
      .filter((p) => p.progress < 1.1);

    // Add new particles based on RPS
    const particlesToAdd = Math.min(20, Math.ceil(rps / 500));
    const wireEntries = [...this.wires.values()];

    for (let i = 0; i < particlesToAdd; i++) {
      const wire = wireEntries[Math.floor(this.random() * wireEntries.length)];
      if (!wire) continue;

      const sourceState = this.components.get(wire.source);
      const targetState = this.components.get(wire.target);
      if (sourceState?.crashed || targetState?.crashed) continue;

      const baseSpeed = 0.02 + this.random() * 0.03;
      const latencyFactor = wire.config.latencyMs > 50 ? 0.5 : 1;

      this.particles.push({
        id: `p-${this.particleIdCounter++}`,
        wireId: wire.id,
        progress: 0,
        speed: baseSpeed * latencyFactor,
        status: targetState?.crashed ? 'error' : 'in_flight',
      });
    }

    // Limit total particles
    if (this.particles.length > 200) {
      this.particles = this.particles.slice(-200);
    }
  }
}
