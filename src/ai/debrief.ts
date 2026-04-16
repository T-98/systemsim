/**
 * @file ai/debrief.ts
 *
 * The deterministic half of the post-run debrief. Runs entirely in the
 * browser, no LLM call, shows up instantly when the simulation completes.
 *
 * Exports:
 * - `generateDebrief(ctx)`: the main entry — flags + questions + scores +
 *   summary + per-component peaks
 * - `computePerComponentPeaks(timeSeries, nodes)`: reduces the full metrics
 *   time-series to peak p50/p99/ρ/errors/queue per component, sorted by p99
 * - `checkForHints(nodes, edges, scenarioId)`: emits scenario-specific
 *   warnings before the simulation runs
 *
 * AI-augmented questions merge in async via `ai/anthropicDebrief.ts`. If that
 * times out, the deterministic debrief still stands on its own.
 */

import type { Node, Edge } from '@xyflow/react';
import type {
  SimComponentData,
  WireConfig,
  SchemaMemoryBlock,
  NFR,
  ApiContract,
  SimulationRun,
  AIDebrief,
  Scores,
  PerComponentSummary,
  ComponentMetrics,
  ComponentType,
} from '../types';
import { DISCORD_SOCRATIC_TEMPLATES } from '../scenarios/discord';

interface DesignContext {
  nodes: Node<SimComponentData>[];
  edges: Edge<{ config: WireConfig }>[];
  functionalReqs: string[];
  nonFunctionalReqs: NFR[];
  apiContracts: ApiContract[];
  schemaMemory: SchemaMemoryBlock | null;
  simulationRun: SimulationRun;
  scenarioId: string | null;
}

/**
 * Generate the full deterministic debrief from a completed simulation run.
 * Synchronous, LLM-free. AI questions merge in later via `anthropicDebrief`.
 */
export function generateDebrief(ctx: DesignContext): AIDebrief {
  const flags = runDeterministicChecks(ctx);
  const questions = generateSocraticQuestions(ctx);
  const scores = calculateScores(ctx, flags);
  const summary = generateSummary(ctx);
  const componentSummary = computePerComponentPeaks(
    ctx.simulationRun.metricsTimeSeries,
    ctx.nodes,
  );

  return { summary, questions, flags, scores, aiAvailable: false, componentSummary };
}

/**
 * Reduce a metrics time-series to per-component peaks. Peaks are `max(series)`
 * for each metric (not final-tick values). Rows sorted by p99 desc so the
 * worst offender surfaces at the top of the debrief table.
 *
 * ρ (rho) is derived per type: cpuPercent/100 for server/db, memoryPercent/100
 * for queue (= queueDepth/maxDepth), undefined for cache/LB (no natural
 * utilization metric).
 */
export function computePerComponentPeaks(
  metricsTimeSeries: Record<string, ComponentMetrics[]>,
  nodes: Node<SimComponentData>[],
): PerComponentSummary[] {
  const result: PerComponentSummary[] = [];

  for (const node of nodes) {
    const series = metricsTimeSeries[node.id];
    if (!series || series.length === 0) continue;

    let p50 = 0;
    let p99 = 0;
    let cpu = 0;
    let mem = 0;
    let errorRate = 0;
    let peakQueue = 0;

    for (const m of series) {
      if (m.p50 > p50) p50 = m.p50;
      if (m.p99 > p99) p99 = m.p99;
      if (m.cpuPercent > cpu) cpu = m.cpuPercent;
      if (m.memoryPercent > mem) mem = m.memoryPercent;
      if (m.errorRate > errorRate) errorRate = m.errorRate;
      if (m.queueDepth !== undefined && m.queueDepth > peakQueue) peakQueue = m.queueDepth;
    }

    result.push({
      id: node.id,
      name: node.data.label,
      type: node.data.type as ComponentType,
      p50: Math.round(p50),
      p99: Math.round(p99),
      rho: computeRho(node.data.type as ComponentType, cpu, mem),
      errorRate,
      peakQueue: peakQueue > 0 ? peakQueue : undefined,
    });
  }

  // Sort by p99 desc so the worst offender is on top
  result.sort((a, b) => b.p99 - a.p99);
  return result;
}

function computeRho(type: ComponentType, peakCpu: number, peakMem: number): number | undefined {
  if (type === 'server' || type === 'database') return peakCpu / 100;
  if (type === 'queue') return peakMem / 100; // memoryPercent = queueDepth/maxDepth
  return undefined;
}

function runDeterministicChecks(ctx: DesignContext): string[] {
  const flags: string[] = [];
  const { nodes, edges } = ctx;

  // Auth check: any externally-facing route without auth
  const gateways = nodes.filter((n) => n.data.type === 'api_gateway');
  for (const gw of gateways) {
    if (gw.data.config.authMiddleware === 'none') {
      flags.push(`API Gateway "${gw.data.label}" has no auth middleware enabled.`);
    }
  }

  // No rate limiting on gateways
  for (const gw of gateways) {
    const rateLimit = gw.data.config.rateLimitRps as number;
    if (!rateLimit || rateLimit > 100000) {
      flags.push(`API Gateway "${gw.data.label}" rate limit is very high or unconfigured.`);
    }
  }

  // Queue without DLQ
  const queues = nodes.filter((n) => n.data.type === 'queue');
  for (const q of queues) {
    if (!q.data.config.dlqEnabled) {
      flags.push(`Queue "${q.data.label}" has no dead-letter queue configured.`);
    }
  }

  // Queue without retry config
  for (const q of queues) {
    const retryCount = q.data.config.retryCount as number;
    if (!retryCount || retryCount <= 0) {
      flags.push(`Queue "${q.data.label}" has no retry logic configured.`);
    }
  }

  // DB without indexes
  const dbs = nodes.filter((n) => n.data.type === 'database');
  for (const db of dbs) {
    const indexes = db.data.config.indexes as unknown[];
    if (!indexes || (Array.isArray(indexes) && indexes.length === 0)) {
      flags.push(`Database "${db.data.label}" has no indexes defined.`);
    }
  }

  // Single point of failure: only one instance of critical components
  const servers = nodes.filter((n) => n.data.type === 'server');
  for (const srv of servers) {
    if ((srv.data.config.instanceCount as number) <= 1) {
      const hasLb = edges.some((e) => e.target === srv.id && nodes.find((n) => n.id === e.source)?.data.type === 'load_balancer');
      if (!hasLb) {
        flags.push(`Server "${srv.data.label}" is a single instance with no load balancer — single point of failure.`);
      }
    }
  }

  // Consistency model mismatch
  for (const db of dbs) {
    if (db.data.config.consistencyModel === 'strong' && (db.data.config.readReplicas as number) > 0 && (db.data.config.replicationLagMs as number) > 0) {
      flags.push(`Database "${db.data.label}" claims strong consistency but has replication lag configured.`);
    }
  }

  // Cache without TTL consideration
  const caches = nodes.filter((n) => n.data.type === 'cache');
  for (const cache of caches) {
    const ttl = cache.data.config.ttlSeconds as number;
    if (ttl > 3600) {
      flags.push(`Cache "${cache.data.label}" TTL is ${ttl}s (${(ttl / 3600).toFixed(1)}h). Stale data risk.`);
    }
  }

  return flags;
}

function generateSocraticQuestions(ctx: DesignContext): string[] {
  const questions: string[] = [];
  const { nodes, simulationRun } = ctx;
  const log = simulationRun.log;
  const metrics = simulationRun.metricsTimeSeries;

  // Check for hot shard
  const dbs = nodes.filter((n) => n.data.type === 'database');
  for (const db of dbs) {
    const dbMetrics = metrics[db.id];
    if (dbMetrics) {
      const lastMetric = dbMetrics[dbMetrics.length - 1];
      if (lastMetric?.shardDistribution) {
        const max = Math.max(...lastMetric.shardDistribution);
        const total = lastMetric.shardDistribution.reduce((a, b) => a + b, 0);
        if (total > 0 && max / total > 0.5) {
          const pct = Math.round((max / total) * 100);
          questions.push(DISCORD_SOCRATIC_TEMPLATES.hotShard(pct));
        }
      }
    }
  }

  // Check for synchronous fanout (fanout directly connected to DB)
  const fanouts = nodes.filter((n) => n.data.type === 'fanout');
  for (const fo of fanouts) {
    const downstream = ctx.edges.filter((e) => e.source === fo.id);
    const directToDb = downstream.some((e) => nodes.find((n) => n.id === e.target)?.data.type === 'database');
    if (directToDb) {
      questions.push(DISCORD_SOCRATIC_TEMPLATES.syncFanout());
    }
  }

  // Check for queue overflow
  const queueOverflow = log.some((l) => l.message.includes('Queue overflow'));
  if (queueOverflow) {
    const queueNode = nodes.find((n) => n.data.type === 'queue');
    if (queueNode) {
      const maxDepth = (queueNode.data.config.maxDepth as number) ?? 0;
      questions.push(DISCORD_SOCRATIC_TEMPLATES.queueUndersized(maxDepth));
    }
  }

  // Check for cache stampede
  const stampede = log.some((l) => l.message.includes('Cache stampede'));
  if (stampede) {
    questions.push(DISCORD_SOCRATIC_TEMPLATES.cacheStampede());
  }

  // Check for connection pool exhaustion
  const connPoolExhaust = log.some((l) => l.message.includes('Connection pool exhaustion'));
  if (connPoolExhaust) {
    questions.push(DISCORD_SOCRATIC_TEMPLATES.noWriteBatch());
  }

  // General question if no specific issues
  if (questions.length === 0) {
    questions.push('Your system held up well. What would happen if the traffic spike lasted 10 minutes instead of 3 seconds? Where would the first bottleneck appear?');
  }

  return questions.slice(0, 5);
}

function calculateScores(ctx: DesignContext, flags: string[]): Scores {
  const { nodes, simulationRun } = ctx;
  let coherence = 80;
  let security = 100;
  let performance = 80;

  // Deduct from security
  const authFlags = flags.filter((f) => f.includes('auth') || f.includes('Auth'));
  security -= authFlags.length * 20;
  const rateLimitFlags = flags.filter((f) => f.includes('rate limit'));
  security -= rateLimitFlags.length * 10;

  // Deduct from coherence
  const consistencyFlags = flags.filter((f) => f.includes('consistency'));
  coherence -= consistencyFlags.length * 15;
  const spofFlags = flags.filter((f) => f.includes('single point'));
  coherence -= spofFlags.length * 10;
  const dlqFlags = flags.filter((f) => f.includes('dead-letter') || f.includes('DLQ'));
  coherence -= dlqFlags.length * 10;

  // Performance scoring from simulation
  const log = simulationRun.log;
  const crashes = log.filter((l) => l.message.includes('CRASH'));
  performance -= crashes.length * 20;

  const overflows = log.filter((l) => l.message.includes('overflow') || l.message.includes('DROPPED'));
  performance -= overflows.length * 10;

  const criticals = log.filter((l) => l.severity === 'critical');
  performance -= Math.min(30, criticals.length * 2);

  // Bonus for good patterns
  const hasQueue = nodes.some((n) => n.data.type === 'queue');
  if (hasQueue) coherence += 5;

  const hasCache = nodes.some((n) => n.data.type === 'cache');
  if (hasCache) performance += 5;

  const hasDlq = nodes.some((n) => n.data.type === 'queue' && n.data.config.dlqEnabled);
  if (hasDlq) coherence += 5;

  return {
    coherence: Math.max(0, Math.min(100, coherence)),
    security: Math.max(0, Math.min(100, security)),
    performance: Math.max(0, Math.min(100, performance)),
  };
}

function generateSummary(ctx: DesignContext): string {
  const { simulationRun, nodes } = ctx;
  const log = simulationRun.log;

  const crashes = log.filter((l) => l.message.includes('CRASH'));
  const criticals = log.filter((l) => l.severity === 'critical');
  const hotShardLogs = log.filter((l) => l.message.includes('shard'));

  const parts: string[] = [];

  if (crashes.length > 0) {
    parts.push(`${crashes.length} component(s) crashed during the simulation.`);
  }
  if (hotShardLogs.length > 0) {
    parts.push('A hot shard was detected in the database layer, concentrating write load on a single partition.');
  }
  if (criticals.length > 0 && crashes.length === 0) {
    parts.push(`${criticals.length} critical events occurred but no component fully crashed.`);
  }
  if (crashes.length === 0 && criticals.length === 0) {
    parts.push('The system handled the traffic profile without critical failures.');
  }

  const hasQueue = nodes.some((n) => n.data.type === 'queue');
  if (!hasQueue) {
    parts.push('No message queue was used, meaning the fanout was processed synchronously.');
  }

  return parts.join(' ');
}

/**
 * Pre-simulation hints. Currently scoped to the Discord notification fanout
 * scenario; catches common anti-patterns (fanout direct to DB without queue,
 * user-id shard key with sharding enabled). Emitted as HintCards on canvas.
 */
export function checkForHints(
  nodes: Node<SimComponentData>[],
  edges: Edge<{ config: WireConfig }>[],
  scenarioId: string | null,
): string[] {
  if (scenarioId !== 'discord_notification_fanout') return [];

  const hints: string[] = [];
  const fanouts = nodes.filter((n) => n.data.type === 'fanout');
  const queues = nodes.filter((n) => n.data.type === 'queue');
  const dbs = nodes.filter((n) => n.data.type === 'database');

  // If fanout connects directly to DB without queue in between
  for (const fo of fanouts) {
    const foTargets = edges.filter((e) => e.source === fo.id).map((e) => e.target);
    const directToDb = foTargets.some((t) => dbs.some((db) => db.id === t));
    const hasQueueBetween = foTargets.some((t) => queues.some((q) => q.id === t));

    if (directToDb && !hasQueueBetween) {
      hints.push('Notification fanout can generate millions of writes per event. How would you prevent that write burst from hitting your DB directly?');
    }
  }

  // If DB has user_id as shard key
  for (const db of dbs) {
    const shardKey = (db.data.config.shardKey as string) ?? '';
    if (shardKey.toLowerCase().includes('user') && db.data.config.shardingEnabled) {
      hints.push("What does the distribution of large server memberships look like on your platform? How might that affect which users' shards receive the most writes?");
    }
  }

  return hints;
}
