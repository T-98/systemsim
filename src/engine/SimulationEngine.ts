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
  private lastLogTime: Map<string, number> = new Map(); // throttle logs per component
  private random: () => number; // seeded PRNG for reproducibility
  private firedCallouts: Set<string> = new Set(); // saturation warnings, once per component per run
  // Per-tick state — cleared at tick start. See tick() for the 3-phase model.
  private inboundRps: Map<string, number> = new Map();
  private inboundLat: Map<string, InboundLatencyAccumulator> = new Map();
  private wireOutcomes: Map<string, WireTickOutcome> = new Map();
  private processedThisTick: Set<string> = new Set();
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
  ) {
    this.random = seed != null ? mulberry32(seed) : Math.random;
    this.trafficProfile = trafficProfile;
    this.schemaShardKey = schemaShardKey ?? null;
    this.schemaShardKeyCardinality = schemaShardKeyCardinality ?? 'high';
    this.stressedMode = stressedMode;

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

    // Seed entry points with the tick's total RPS divided evenly. Entry
    // components have no upstream latency — accLat starts at 0.
    const rpsPerEntry = rpsPerTick / Math.max(this.entryPoints.length, 1);
    for (const entryId of this.entryPoints) {
      this.inboundRps.set(entryId, (this.inboundRps.get(entryId) ?? 0) + rpsPerEntry);
      // Entry latency denominator is rpsPerEntry; numerator is 0 (0 upstream latency).
      const acc = this.inboundLat.get(entryId) ?? { num: 0, denom: 0 };
      acc.denom += rpsPerEntry;
      this.inboundLat.set(entryId, acc);
    }

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
    const dbLatency = baseLatency * loadFactor + connectionPenalty;
    state.metrics.p50 = dbLatency + accumulatedLatencyMs;
    state.metrics.p95 = dbLatency * 2 + accumulatedLatencyMs;
    state.metrics.p99 = dbLatency * 4 + replicationLag + accumulatedLatencyMs;
    state.lastComputedLatencyMs = dbLatency;

    // Connection pool exhaustion
    if (connectionUtilization > 1) {
      const dropRate = Math.min(0.9, (connectionUtilization - 1) * 0.5);
      state.metrics.errorRate = dropRate;
      state.accumulatedErrors += rps * dropRate;

      if (dropRate > 0.1) {
        logs.push({
          time: this.time,
          message: `${state.id}: Connection pool exhaustion. ${Math.round(dropRate * 100)}% of queries failing.`,
          severity: 'critical',
          componentId: state.id,
        });
      }
    } else {
      state.metrics.errorRate = 0;
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
