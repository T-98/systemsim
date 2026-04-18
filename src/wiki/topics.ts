/**
 * @file wiki/topics.ts
 *
 * Topic registry — single source of truth for every wiki entry referenced
 * across the app. Every `<InfoIcon topic="..." />` and every "Learn more"
 * link resolves against this registry. Missing keys fall back to the
 * "Documentation coming soon." placeholder (InfoIcon never crashes).
 *
 * Phase A-scaffold: keys declared with empty `shortDescription` and empty
 * `body`. Phase A-content back-fills these from the knowledge base at
 * `system-design-knowledgebase.md`.
 *
 * Maintenance rule: anywhere in the app that references a topic key via
 * InfoIcon must resolve to a key declared here. The `/wiki/coverage`
 * debug route enforces this (flags unresolved keys at dev time).
 */

export type TopicCategory =
  | 'component'
  | 'config'
  | 'concept'
  | 'howto'
  | 'severity'
  /** Hand-written user-manual pages (the Learn track). */
  | 'userGuide'
  /** Auto-imported at build time from system-design-knowledgebase.md (the Reference track). */
  | 'reference';

export interface Topic {
  title: string;
  shortDescription: string;
  body: string;
  category: TopicCategory;
  relatedTopics?: string[];
  /** For how-to topics: JSON template key that the "Load in canvas" button consumes. Stub at A-scaffold. */
  howtoTemplate?: string;
}

const empty = (title: string, category: TopicCategory): Topic => ({
  title,
  shortDescription: '',
  body: '',
  category,
});

export const TOPICS: Record<string, Topic> = {
  // Components
  'component.server': empty('Server', 'component'),
  'component.database': empty('Database', 'component'),
  'component.cache': empty('Cache', 'component'),
  'component.queue': empty('Message Queue', 'component'),
  'component.loadBalancer': empty('Load Balancer', 'component'),
  'component.apiGateway': empty('API Gateway', 'component'),
  'component.websocketGateway': empty('WebSocket Gateway', 'component'),
  'component.fanout': empty('Fan-out', 'component'),
  'component.cdn': empty('CDN', 'component'),
  'component.external': empty('External Service', 'component'),
  'component.autoscaler': empty('Autoscaler', 'component'),

  // Wire + basic node configuration
  'config.throughputRps': empty('Throughput (RPS)', 'config'),
  'config.latencyMs': empty('Latency (ms)', 'config'),
  'config.jitterMs': empty('Jitter (ms)', 'config'),
  'config.instances': empty('Instance count', 'config'),
  'config.cpu': empty('CPU %', 'config'),
  'config.maxConnections': empty('Max connections', 'config'),
  'config.ttl': empty('Cache TTL', 'config'),
  'config.maxConcurrent': empty('Max concurrent', 'config'),
  'config.processingTimeMs': empty('Processing time (ms)', 'config'),
  'config.connectionPoolSize': empty('Connection pool size', 'config'),
  'config.readThroughputRps': empty('Read throughput (RPS)', 'config'),
  'config.writeThroughputRps': empty('Write throughput (RPS)', 'config'),
  'config.readReplicas': empty('Read replicas', 'config'),
  'config.replicationLagMs': empty('Replication lag (ms)', 'config'),
  'config.shardingEnabled': empty('Sharding enabled', 'config'),
  'config.shardCount': empty('Shard count', 'config'),
  'config.shardKey': empty('Shard key', 'config'),
  'config.isEntry': empty('Entry point', 'config'),

  // Load balancer
  'config.algorithm': empty('LB algorithm', 'config'),
  'config.healthCheckInterval': empty('Health check interval (ms)', 'config'),
  'config.healthCheckTimeout': empty('Health check timeout (ms)', 'config'),
  'config.unhealthyThreshold': empty('Unhealthy threshold', 'config'),

  // API gateway
  'config.rateLimitRps': empty('Rate limit (RPS)', 'config'),
  'config.rateLimitBurst': empty('Rate limit burst', 'config'),
  'config.authMiddleware': empty('Auth middleware', 'config'),
  'config.timeout': empty('Request timeout (ms)', 'config'),

  // Server
  'config.cpuProfile': empty('CPU profile', 'config'),
  'config.memoryProfile': empty('Memory profile', 'config'),
  'config.processingJitterMs': empty('Processing jitter (ms)', 'config'),
  'config.instanceCount': empty('Instance count', 'config'),

  // Cache
  'config.evictionPolicy': empty('Eviction policy', 'config'),
  'config.ttlSeconds': empty('TTL (seconds)', 'config'),
  'config.maxMemoryMb': empty('Max memory (MB)', 'config'),
  'config.writeStrategy': empty('Write strategy', 'config'),

  // Queue
  'config.maxDepth': empty('Max queue depth', 'config'),
  'config.consumerGroupCount': empty('Consumer groups', 'config'),
  'config.consumersPerGroup': empty('Consumers per group', 'config'),
  'config.dlqEnabled': empty('DLQ enabled', 'config'),
  'config.retryCount': empty('Retry count', 'config'),

  // Database
  'config.engine': empty('DB engine', 'config'),
  'config.consistencyModel': empty('Consistency model', 'config'),

  // WebSocket gateway
  'config.heartbeatInterval': empty('Heartbeat interval (ms)', 'config'),
  'config.connectionTimeout': empty('Connection timeout (ms)', 'config'),

  // Fan-out
  'config.multiplier': empty('Fan-out multiplier', 'config'),
  'config.deliveryMode': empty('Delivery mode', 'config'),
  'config.timeoutPerDownstream': empty('Timeout per downstream (ms)', 'config'),

  // CDN
  'config.cacheHitRate': empty('CDN cache hit rate', 'config'),
  'config.originPullLatencyMs': empty('Origin pull latency (ms)', 'config'),

  // External
  'config.name': empty('External service name', 'config'),
  'config.errorRate': empty('Error rate', 'config'),

  // Autoscaler
  'config.targetCpuThreshold': empty('Target CPU threshold (%)', 'config'),
  'config.minInstances': empty('Min instances', 'config'),
  'config.maxInstances': empty('Max instances', 'config'),
  'config.cooldownSeconds': empty('Cooldown (seconds)', 'config'),
  'config.scaleUpDelaySeconds': empty('Scale-up delay (seconds)', 'config'),

  // Retry
  'config.retry.maxRetries': empty('Max retries', 'config'),
  'config.retry.backoffMs': empty('Backoff (ms)', 'config'),

  // Backpressure
  'config.backpressure.enabled': empty('Backpressure enabled', 'config'),
  'config.backpressure.thresholdQueue': empty('Backpressure queue threshold', 'config'),

  // Circuit breaker
  'config.circuitBreaker.enabled': empty('Circuit breaker enabled', 'config'),
  'config.circuitBreaker.failureThreshold': empty('Failure threshold', 'config'),
  'config.circuitBreaker.failureWindow': empty('Failure window (ticks)', 'config'),
  'config.circuitBreaker.cooldownSeconds': empty('Cooldown (seconds)', 'config'),
  'config.circuitBreaker.halfOpenTicks': empty('Half-open probe ticks', 'config'),

  // Traffic profile
  'config.traffic.phases': empty('Traffic phases', 'config'),
  'config.traffic.shape': empty('Phase shape', 'config'),
  'config.traffic.jitterPercent': empty('Jitter %', 'config'),
  'config.traffic.durationSeconds': empty('Duration (seconds)', 'config'),
  'config.traffic.requestMix': empty('Request mix', 'config'),
  'config.traffic.userDistribution': empty('User distribution', 'config'),

  // Concepts
  'concept.utilization': empty('Utilization (ρ)', 'concept'),
  'concept.littlesLaw': empty("Little's Law", 'concept'),
  'concept.p50p95p99': empty('p50 / p95 / p99 percentiles', 'concept'),
  'concept.retryStorm': empty('Retry storm amplification', 'concept'),
  'concept.circuitBreakerStates': empty('Circuit breaker states', 'concept'),
  'concept.backpressure': empty('Backpressure propagation', 'concept'),
  'concept.cacheStampede': empty('Cache stampede', 'concept'),
  'concept.hotShard': empty('Hot shard', 'concept'),

  // How-tos (each pairs with a canvas template; stubs at A-scaffold)
  'howto.cacheStampede': { ...empty('Reproduce a cache stampede', 'howto'), howtoTemplate: 'cacheStampede' },
  'howto.hotShard': { ...empty('Reproduce a hot shard', 'howto'), howtoTemplate: 'hotShard' },
  'howto.retryStorm': { ...empty('Reproduce a retry storm', 'howto'), howtoTemplate: 'retryStorm' },
  'howto.breakerTrip': { ...empty('Trip a circuit breaker', 'howto'), howtoTemplate: 'breakerTrip' },
  'howto.backpressurePropagation': { ...empty('See backpressure propagate upstream', 'howto'), howtoTemplate: 'backpressurePropagation' },

  // Severity badges (live log)
  'severity.info': empty('Info', 'severity'),
  'severity.warning': empty('Warning', 'severity'),
  'severity.error': empty('Error', 'severity'),
  'severity.debrief': empty('Debrief', 'severity'),
  'severity.critical': empty('Critical', 'severity'),
};

// Merge in auto-generated reference topics at module load. The generator
// emits one entry per top-level `## N. Title` section of
// `system-design-knowledgebase.md`; see `scripts/generate-reference-topics.ts`.
// The stub below is a safe fallback when the generator hasn't run yet
// (e.g. fresh clone before `pnpm dev`); the real file overwrites it.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — generated file may not exist until Vite's first buildStart hook.
import { REFERENCE_TOPICS } from './generated/referenceTopics';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { USER_GUIDE_TOPICS, USER_GUIDE_ORDER } from './generated/learnTopics';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { HOWTO_TOPICS } from './generated/howtoTopics';

for (const [key, topic] of Object.entries(REFERENCE_TOPICS)) TOPICS[key] = topic;
for (const [key, topic] of Object.entries(USER_GUIDE_TOPICS)) TOPICS[key] = topic;
for (const [key, topic] of Object.entries(HOWTO_TOPICS as Record<string, Topic>)) TOPICS[key] = topic;

/** Ordered list of Learn topic keys, driving Prev/Next navigation. */
export const LEARN_ORDER: string[] = USER_GUIDE_ORDER;

/**
 * Lookup a topic, returning a safe placeholder if the key is unknown.
 * Never throws; every caller can render the result unconditionally.
 */
export function lookupTopic(key: string): Topic & { resolved: boolean } {
  const t = TOPICS[key];
  if (t) return { ...t, resolved: true };
  return {
    title: 'Unknown topic',
    shortDescription: 'Documentation coming soon.',
    body: 'Documentation coming soon.',
    category: 'concept',
    resolved: false,
  };
}

/** Returns every registered topic key. Used by the coverage route. */
export function listTopicKeys(): string[] {
  return Object.keys(TOPICS);
}
