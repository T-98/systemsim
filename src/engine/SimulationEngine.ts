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

  constructor(
    nodes: Node<SimComponentData>[],
    edges: Edge<{ config: WireConfig }>[],
    trafficProfile: TrafficProfile,
    schemaShardKey?: string,
    schemaShardKeyCardinality?: 'low' | 'medium' | 'high',
    seed?: number,
  ) {
    this.random = seed != null ? mulberry32(seed) : Math.random;
    this.trafficProfile = trafficProfile;
    this.schemaShardKey = schemaShardKey ?? null;
    this.schemaShardKeyCardinality = schemaShardKeyCardinality ?? 'high';

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
      this.wires.set(edge.id, {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        config: edge.data!.config,
        currentRps: 0,
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

    // Throttle logs: max 1 log per component per 2 seconds of sim time
    const throttled = newLogs.filter((entry) => {
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
        const jitter = (this.random() - 0.5) * 2 * wire.config.jitterMs;
        return Math.max(0, wire.config.latencyMs + jitter);
      }
    }
    return 0;
  }

  private forwardToDownstreams(sourceId: string, rps: number, accumulatedLatencyMs: number, logs: LogEntry[]) {
    const downstreams = this.adjacency.get(sourceId) ?? [];
    const rpsEach = rps / Math.max(downstreams.length, 1);
    for (const downstream of downstreams) {
      const wireLatency = this.getWireLatency(sourceId, downstream);
      this.processComponent(downstream, rpsEach, logs, accumulatedLatencyMs + wireLatency);
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

    const healthyDownstreams = downstreams.filter((d) => {
      const ds = this.components.get(d);
      return ds && !ds.crashed;
    });

    if (healthyDownstreams.length === 0) {
      state.metrics.errorRate = 1.0;
      state.accumulatedErrors += rps;
      state.metrics.p50 = 0;
      state.metrics.p99 = 0;
      if (rps > 0) {
        logs.push({ time: this.time, message: `${state.id}: No healthy backends. All requests failing.`, severity: 'critical', componentId: state.id });
      }
      return;
    }

    const rpsEach = rps / healthyDownstreams.length;
    for (const downstream of healthyDownstreams) {
      const wireLatency = this.getWireLatency(state.id, downstream);
      this.processComponent(downstream, rpsEach, logs, accumulatedLatencyMs + wireLatency);
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

    let passthrough = rps;
    if (q.dropRate > 0) {
      const dropped = rps * q.dropRate;
      passthrough = rps - dropped;
      state.metrics.errorRate = q.dropRate;
      state.accumulatedErrors += dropped;
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

    if (cacheResult.stampedeRisk) {
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
    const hitRate = (state.config.cacheHitRate as number) ?? 0.9;
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
        logs.push({
          time: this.time,
          message: `${state.id} CRASH. ${cpu > mem ? 'CPU' : 'Memory'} exhausted. Connection refused.`,
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
