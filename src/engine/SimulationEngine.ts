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
  type CircuitBreakerConfig,
  type CircuitBreakerState,
  evaluateBreaker,
  makeBreakerState,
  resolveBreakerConfig,
} from './CircuitBreaker';
import { computeAmplification, readRetryPolicy } from './RetryPolicy';

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
   * Downstream errorRate observed after the most recent forward. Used by the
   * NEXT tick's retry amplification (3.2) and — in the future — backpressure
   * (3.3) so they can read the previous tick's outcome without peeking at
   * the aggregate target.metrics.errorRate mid-tick.
   */
  lastObservedErrorRate: number;
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
  private callStack: Set<string> = new Set(); // path-based cycle detection
  private firedCallouts: Set<string> = new Set(); // saturation warnings, once per component per run
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
    // Also reset per-wire "had traffic this tick" flag — set by forwardOverWire
    // when traffic actually flows, consumed by evaluateBreakers at end of tick.
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

    // Distribute traffic to entry points
    const rpsPerEntry = rpsPerTick / Math.max(this.entryPoints.length, 1);

    for (const entryId of this.entryPoints) {
      this.processComponent(entryId, rpsPerEntry, newLogs, 0);
    }

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

    // Advance per-wire circuit breakers based on this tick's downstream errorRate.
    this.evaluateBreakers(newLogs);

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

    return { metrics, healths, newLogs: throttled, particles: [...this.particles], time: this.time };
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
   * Single choke point for any traffic flowing from one component to another
   * over a wire. Phase 3 resilience logic hooks in here so processor code
   * doesn't need to know about them.
   *
   * Circuit breaker gate:
   * - OPEN: drop traffic entirely. No recurse, no latency, no cost.
   * - HALF_OPEN: let traffic flow. If the tick ends with the target healthy,
   *   breaker moves back toward CLOSED.
   * - CLOSED: normal forwarding.
   *
   * Retry + backpressure will extend this in 3.2 / 3.3.
   */
  private forwardOverWire(sourceId: string, targetId: string, rps: number, accumulatedLatencyMs: number, logs: LogEntry[]) {
    const wire = this.findWire(sourceId, targetId);
    if (wire?.breaker?.status === 'open') {
      return; // fail fast: circuit open, drop at the source
    }

    // Retry amplification: if the source has a retry policy and the downstream
    // was erroring last tick, amplify the effective RPS by the geometric sum
    // of the retry waves (1 + e + e² + … + e^maxRetries). This is how
    // real retry storms inflate load on an already-struggling downstream.
    //
    // Using previous-tick errorRate avoids needing multiple recursion passes
    // per tick and matches the one-tick propagation delay backpressure (3.3)
    // will also use.
    //
    // HALF_OPEN exception: the whole point of HALF_OPEN is to send a small
    // probe, not a replayed storm. Amplifying on a recovering downstream
    // would slam it with stale errors and guarantee re-open. Skip retries
    // during HALF_OPEN.
    let effectiveRps = rps;
    let amplification = 1;
    const sourceState = this.components.get(sourceId);
    const retryPolicy = sourceState ? readRetryPolicy(sourceState.config) : undefined;
    const breakerHalfOpen = wire?.breaker?.status === 'half_open';
    if (retryPolicy && wire && rps > 0 && wire.lastObservedErrorRate > 0 && !breakerHalfOpen) {
      amplification = computeAmplification(wire.lastObservedErrorRate, retryPolicy);
      effectiveRps = rps * amplification;
    }

    // Record that this wire actually served traffic this tick. HALF_OPEN
    // recovery requires at least one real probe to succeed, not just the
    // absence of failure. Without this, a quiet tick would silently be
    // counted as success and recover the breaker without validation.
    if (wire?.breaker && effectiveRps > 0) {
      wire.breaker.hadTrafficThisTick = true;
    }

    const wireLatency = this.getWireLatency(sourceId, targetId);
    this.processComponent(targetId, effectiveRps, logs, accumulatedLatencyMs + wireLatency);

    // Observe post-recursion errorRate for the next tick's retry decision.
    // Multi-inbound caveat: this is the target's AGGREGATE errorRate after
    // everyone's traffic, not this wire's slice. Close enough for the retry
    // signal; good enough that steady-state stabilizes within a couple ticks.
    if (wire) {
      const target = this.components.get(targetId);
      wire.lastObservedErrorRate = target?.metrics.errorRate ?? 0;
    }

    // One-shot callout when amplification crosses a meaningful threshold,
    // so the user sees the retry storm in the live log.
    if (amplification >= 1.5 && wire) {
      this.fireCallout(
        logs,
        sourceId,
        `retry-storm:${targetId}`,
        `${sourceId} → ${targetId}: retry storm amplifying load ${amplification.toFixed(1)}× at t=${Math.round(this.time)}s (downstream errorRate=${(wire.lastObservedErrorRate * 100).toFixed(0)}%)`,
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

  private forwardToDownstreams(sourceId: string, rps: number, accumulatedLatencyMs: number, logs: LogEntry[]) {
    const downstreams = this.adjacency.get(sourceId) ?? [];
    const rpsEach = rps / Math.max(downstreams.length, 1);
    for (const downstream of downstreams) {
      this.forwardOverWire(sourceId, downstream, rpsEach, accumulatedLatencyMs, logs);
    }
  }

  private processComponent(id: string, incomingRps: number, logs: LogEntry[], accumulatedLatencyMs: number) {
    const state = this.components.get(id);
    if (!state || state.crashed) {
      return;
    }

    // Path-based cycle detection: reject only if this node is on the current call path
    // Diamond topologies (LB→A→DB, LB→B→DB) work because DB is not on B's call stack
    if (this.callStack.has(id)) {
      logs.push({
        time: this.time,
        message: `${id}: Cycle detected — skipping to prevent infinite loop`,
        severity: 'warning',
        componentId: id,
      });
      return;
    }
    this.callStack.add(id);

    state.totalRequests += incomingRps;

    switch (state.type) {
      case 'load_balancer':
        this.processLoadBalancer(state, incomingRps, logs, accumulatedLatencyMs);
        break;
      case 'api_gateway':
        this.processApiGateway(state, incomingRps, logs, accumulatedLatencyMs);
        break;
      case 'server':
        this.processServer(state, incomingRps, logs, accumulatedLatencyMs);
        break;
      case 'cache':
        this.processCache(state, incomingRps, logs, accumulatedLatencyMs);
        break;
      case 'queue':
        this.processQueue(state, incomingRps, logs, accumulatedLatencyMs);
        break;
      case 'database':
        this.processDatabase(state, incomingRps, logs, accumulatedLatencyMs);
        break;
      case 'websocket_gateway':
        this.processWebSocketGateway(state, incomingRps, logs, accumulatedLatencyMs);
        break;
      case 'fanout':
        this.processFanout(state, incomingRps, logs, accumulatedLatencyMs);
        break;
      case 'cdn':
        this.processCdn(state, incomingRps, logs, accumulatedLatencyMs);
        break;
      case 'external':
        this.processExternal(state, incomingRps, logs, accumulatedLatencyMs);
        break;
      case 'autoscaler':
        this.processAutoscaler(state, incomingRps, logs, accumulatedLatencyMs);
        break;
    }

    this.callStack.delete(id);
  }

  private processLoadBalancer(state: ComponentState, rps: number, logs: LogEntry[], accumulatedLatencyMs: number) {
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
    for (const downstream of healthyDownstreams) {
      this.forwardOverWire(state.id, downstream, rpsEach, accumulatedLatencyMs, logs);
    }

    const lbProcessingMs = 0.5;
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

  private processApiGateway(state: ComponentState, rps: number, logs: LogEntry[], accumulatedLatencyMs: number) {
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

    this.forwardToDownstreams(state.id, passthrough, accumulatedLatencyMs + 2, logs);
  }

  private processServer(state: ComponentState, rps: number, logs: LogEntry[], accumulatedLatencyMs: number) {
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

    this.forwardToDownstreams(state.id, passthrough, accumulatedLatencyMs + q.p50Ms, logs);
  }

  private processCache(state: ComponentState, rps: number, logs: LogEntry[], accumulatedLatencyMs: number) {
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
    this.forwardToDownstreams(state.id, missRps, accumulatedLatencyMs + latency.p50, logs);
  }

  private processQueue(state: ComponentState, rps: number, logs: LogEntry[], accumulatedLatencyMs: number) {
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
    this.forwardToDownstreams(state.id, consumed, accumulatedLatencyMs + state.metrics.p50, logs);
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

  private processWebSocketGateway(state: ComponentState, rps: number, logs: LogEntry[], accumulatedLatencyMs: number) {
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

    this.forwardToDownstreams(state.id, rps, accumulatedLatencyMs + 2, logs);
  }

  private processFanout(state: ComponentState, rps: number, logs: LogEntry[], accumulatedLatencyMs: number) {
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

    this.forwardToDownstreams(state.id, outputRps, accumulatedLatencyMs + fanoutLatency, logs);
  }

  private processCdn(state: ComponentState, rps: number, logs: LogEntry[], accumulatedLatencyMs: number) {
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
    this.forwardToDownstreams(state.id, missRps, accumulatedLatencyMs + cdnLatency, logs);
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
