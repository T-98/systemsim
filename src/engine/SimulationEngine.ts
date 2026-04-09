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

    // Find entry points (nodes with no incoming edges)
    for (const node of nodes) {
      const incoming = this.reverseAdj.get(node.id);
      if (!incoming || incoming.length === 0) {
        this.entryPoints.push(node.id);
      }
    }
    // If no entry points found, use the first node
    if (this.entryPoints.length === 0 && nodes.length > 0) {
      this.entryPoints.push(nodes[0].id);
    }
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
      this.processComponent(entryId, rpsPerEntry, newLogs);
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

  private processComponent(id: string, incomingRps: number, logs: LogEntry[]) {
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
        this.processLoadBalancer(state, incomingRps, logs);
        break;
      case 'api_gateway':
        this.processApiGateway(state, incomingRps, logs);
        break;
      case 'server':
        this.processServer(state, incomingRps, logs);
        break;
      case 'cache':
        this.processCache(state, incomingRps, logs);
        break;
      case 'queue':
        this.processQueue(state, incomingRps, logs);
        break;
      case 'database':
        this.processDatabase(state, incomingRps, logs);
        break;
      case 'websocket_gateway':
        this.processWebSocketGateway(state, incomingRps, logs);
        break;
      case 'fanout':
        this.processFanout(state, incomingRps, logs);
        break;
      case 'cdn':
        this.processCdn(state, incomingRps, logs);
        break;
      case 'external':
        this.processExternal(state, incomingRps, logs);
        break;
      case 'autoscaler':
        this.processAutoscaler(state, incomingRps, logs);
        break;
    }

    this.callStack.delete(id);
  }

  private processLoadBalancer(state: ComponentState, rps: number, logs: LogEntry[]) {
    const downstreams = this.adjacency.get(state.id) ?? [];
    if (downstreams.length === 0) return;

    state.metrics.rps = rps / this.tickInterval;
    state.metrics.p50 = 1;
    state.metrics.p99 = 3;

    // Distribute based on algorithm
    const algorithm = state.config.algorithm as string;
    const healthyDownstreams = downstreams.filter((d) => {
      const ds = this.components.get(d);
      return ds && !ds.crashed;
    });

    if (healthyDownstreams.length === 0) {
      state.metrics.errorRate = 1.0;
      state.accumulatedErrors += rps;
      if (rps > 0) {
        logs.push({ time: this.time, message: `${state.id}: No healthy backends. All requests failing.`, severity: 'critical', componentId: state.id });
      }
      return;
    }

    const rpsEach = rps / healthyDownstreams.length;
    for (const downstream of healthyDownstreams) {
      this.processComponent(downstream, rpsEach, logs);
    }
  }

  private processApiGateway(state: ComponentState, rps: number, logs: LogEntry[]) {
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
    state.metrics.p50 = 2;
    state.metrics.p99 = this.addJitter(10, 30);

    if (rejected > 0 && state.metrics.errorRate > 0.1) {
      logs.push({
        time: this.time,
        message: `${state.id}: Rate limiting active. ${Math.round(state.metrics.errorRate * 100)}% requests rejected.`,
        severity: 'warning',
        componentId: state.id,
      });
    }

    const downstreams = this.adjacency.get(state.id) ?? [];
    const rpsEach = passthrough / Math.max(downstreams.length, 1);
    for (const downstream of downstreams) {
      this.processComponent(downstream, rpsEach, logs);
    }
  }

  private processServer(state: ComponentState, rps: number, logs: LogEntry[]) {
    const maxConcurrent = (state.config.maxConcurrent as number) ?? 1000;
    const processingTime = (state.config.processingTimeMs as number) ?? 50;
    const instances = state.instanceCount;
    const totalCapacity = maxConcurrent * instances;
    const rpsCapacity = (totalCapacity / processingTime) * 1000 * this.tickInterval;

    state.currentConnections += rps;
    state.currentConnections = Math.max(0, state.currentConnections - rpsCapacity);

    const utilization = Math.min(1, state.currentConnections / totalCapacity);
    state.metrics.cpuPercent = utilization * 100;
    state.metrics.memoryPercent = utilization * 60 + this.random() * 10;
    state.metrics.rps = rps / this.tickInterval;

    // Latency increases with utilization
    const baseLatency = processingTime;
    const loadMultiplier = 1 + Math.pow(utilization, 3) * 20;
    state.metrics.p50 = baseLatency * loadMultiplier * 0.5;
    state.metrics.p95 = baseLatency * loadMultiplier * 1.5;
    state.metrics.p99 = baseLatency * loadMultiplier * 3;

    // Drop requests when overloaded
    let passthrough = rps;
    if (utilization > 0.95) {
      const dropRate = (utilization - 0.95) / 0.05;
      const dropped = rps * dropRate * 0.5;
      passthrough = rps - dropped;
      state.metrics.errorRate = dropped / Math.max(rps, 1);
      state.accumulatedErrors += dropped;
    } else {
      state.metrics.errorRate = 0;
    }

    const downstreams = this.adjacency.get(state.id) ?? [];
    const rpsEach = passthrough / Math.max(downstreams.length, 1);
    for (const downstream of downstreams) {
      this.processComponent(downstream, rpsEach, logs);
    }
  }

  private processCache(state: ComponentState, rps: number, logs: LogEntry[]) {
    const maxMemoryMb = (state.config.maxMemoryMb as number) ?? 1024;
    const ttlSeconds = (state.config.ttlSeconds as number) ?? 300;
    const writeStrategy = state.config.writeStrategy as string;

    // Simulate cache entries growing
    state.cacheEntries += rps * 0.3;
    // Evict based on TTL
    state.cacheEntries -= state.cacheEntries * (this.tickInterval / ttlSeconds);
    state.cacheEntries = Math.max(0, state.cacheEntries);

    state.memoryUsed = (state.cacheEntries / 100000) * maxMemoryMb * 0.001;
    state.metrics.memoryPercent = Math.min(100, (state.memoryUsed / maxMemoryMb) * 100);

    // Cache hit rate - starts high, drops under memory pressure or cold start
    let hitRate = 0.85 + this.random() * 0.1;
    if (state.cacheEntries < 100) hitRate = 0.1; // Cold cache
    if (state.metrics.memoryPercent > 90) hitRate *= 0.7; // Under pressure

    // Cache stampede detection: if many entries expired simultaneously
    const phaseTime = this.time % ttlSeconds;
    if (phaseTime < 1 && state.cacheEntries > 1000) {
      hitRate = 0.2; // Mass TTL expiry
      if (!state.crashed) {
        logs.push({
          time: this.time,
          message: `${state.id}: Cache stampede detected. Mass TTL expiry causing DB flood.`,
          severity: 'critical',
          componentId: state.id,
        });
      }
    }

    state.metrics.cacheHitRate = hitRate;
    state.metrics.rps = rps / this.tickInterval;
    state.metrics.p50 = 1;
    state.metrics.p99 = hitRate > 0.5 ? 5 : 50;

    // Misses go to downstream (DB)
    const missRps = rps * (1 - hitRate);
    const downstreams = this.adjacency.get(state.id) ?? [];
    const rpsEach = missRps / Math.max(downstreams.length, 1);
    for (const downstream of downstreams) {
      this.processComponent(downstream, rpsEach, logs);
    }
  }

  private processQueue(state: ComponentState, rps: number, logs: LogEntry[]) {
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

    // Forward consumed messages downstream
    const downstreams = this.adjacency.get(state.id) ?? [];
    const rpsEach = consumed / Math.max(downstreams.length, 1);
    for (const downstream of downstreams) {
      this.processComponent(downstream, rpsEach, logs);
    }
  }

  private processDatabase(state: ComponentState, rps: number, logs: LogEntry[]) {
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
    state.metrics.p50 = baseLatency * loadFactor + connectionPenalty;
    state.metrics.p95 = state.metrics.p50 * 2;
    state.metrics.p99 = state.metrics.p50 * 4 + replicationLag;

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

  private processWebSocketGateway(state: ComponentState, rps: number, logs: LogEntry[]) {
    const maxConnections = (state.config.maxConnections as number) ?? 100000;

    state.currentConnections += rps * 0.1;
    state.currentConnections -= state.currentConnections * 0.001 * this.tickInterval;

    state.metrics.rps = rps / this.tickInterval;
    state.metrics.activeConnections = Math.round(state.currentConnections);
    state.metrics.memoryPercent = (state.currentConnections / maxConnections) * 100;
    state.metrics.p50 = 2;
    state.metrics.p99 = 15;

    if (state.currentConnections > maxConnections * 0.9) {
      logs.push({
        time: this.time,
        message: `${state.id}: ${Math.round((state.currentConnections / maxConnections) * 100)}% connection capacity.`,
        severity: 'warning',
        componentId: state.id,
      });
    }

    const downstreams = this.adjacency.get(state.id) ?? [];
    const rpsEach = rps / Math.max(downstreams.length, 1);
    for (const downstream of downstreams) {
      this.processComponent(downstream, rpsEach, logs);
    }
  }

  private processFanout(state: ComponentState, rps: number, logs: LogEntry[]) {
    const multiplier = (state.config.multiplier as number) ?? 500000;
    const deliveryMode = state.config.deliveryMode as string;

    const outputRps = rps * multiplier;
    state.metrics.rps = rps / this.tickInterval;
    state.metrics.cpuPercent = Math.min(100, (rps / this.tickInterval / 1000) * 80);
    state.metrics.p50 = deliveryMode === 'parallel' ? 10 : multiplier * 0.001;
    state.metrics.p99 = state.metrics.p50 * 5;

    if (outputRps > 0 && rps / this.tickInterval > 100) {
      logs.push({
        time: this.time,
        message: `${state.id}: Fanout generating ${Math.round(outputRps / this.tickInterval).toLocaleString()} msgs/s.`,
        severity: 'info',
        componentId: state.id,
      });
    }

    const downstreams = this.adjacency.get(state.id) ?? [];
    const rpsEach = outputRps / Math.max(downstreams.length, 1);
    for (const downstream of downstreams) {
      this.processComponent(downstream, rpsEach, logs);
    }
  }

  private processCdn(state: ComponentState, rps: number, logs: LogEntry[]) {
    const hitRate = (state.config.cacheHitRate as number) ?? 0.9;
    const originLatency = (state.config.originPullLatencyMs as number) ?? 200;

    state.metrics.rps = rps / this.tickInterval;
    state.metrics.cacheHitRate = hitRate;
    state.metrics.p50 = hitRate * 5 + (1 - hitRate) * originLatency;
    state.metrics.p99 = originLatency;

    const missRps = rps * (1 - hitRate);
    const downstreams = this.adjacency.get(state.id) ?? [];
    const rpsEach = missRps / Math.max(downstreams.length, 1);
    for (const downstream of downstreams) {
      this.processComponent(downstream, rpsEach, logs);
    }
  }

  private processExternal(state: ComponentState, rps: number, logs: LogEntry[]) {
    const latency = (state.config.latencyMs as number) ?? 100;
    const errorRate = (state.config.errorRate as number) ?? 0.01;

    state.metrics.rps = rps / this.tickInterval;
    state.metrics.p50 = latency;
    state.metrics.p99 = latency * 3;
    state.metrics.errorRate = errorRate + (this.random() * 0.02);
  }

  private processAutoscaler(state: ComponentState, _rps: number, logs: LogEntry[]) {
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
