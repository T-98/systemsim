/**
 * @file WorkingSetCache.ts
 *
 * Zipfian working-set cache model. Replaces the old `0.85 + random() × 0.1`
 * dice roll with something that actually explains why caches fail.
 *
 * Models:
 * - Working set = min(keyCardinality, rps × ttlSeconds)
 * - Hit rate = min(1, (cacheSize / workingSet)^(1/zipfSkew)) with zipfSkew = 1.2
 * - Cold-start warmup: linear ramp over ttl × 0.5
 * - LRU scan penalty: × 0.85 when keyCardinality > 2 × cache capacity
 * - Stampede risk: rps > 1000 AND ttl < 60 AND hitRate > 0.7
 *
 * See Decisions.md #7.
 */

/** Input shape for computeCacheModel. */
export interface CacheModelInput {
  rps: number;
  cacheSizeMb: number;
  ttlSeconds: number;
  evictionPolicy: 'lru' | 'lfu' | 'ttl-only';
  keyCardinality: number;
  avgValueBytes: number;
  simTimeSeconds: number;
  zipfSkew?: number;
}

export interface CacheModelResult {
  hitRate: number;
  workingSetSize: number;
  memoryUsedMb: number;
  stampedeRisk: boolean;
}

const DEFAULT_ZIPF_SKEW = 1.2;
const BYTES_PER_MB = 1024 * 1024;

/**
 * Compute cache hit rate, memory pressure, and stampede risk from the current
 * load and configuration. Called each tick in processCache.
 */
export function computeCacheModel(input: CacheModelInput): CacheModelResult {
  const {
    rps,
    cacheSizeMb,
    ttlSeconds,
    evictionPolicy,
    keyCardinality,
    avgValueBytes,
    simTimeSeconds,
    zipfSkew = DEFAULT_ZIPF_SKEW,
  } = input;

  if (rps <= 0 || cacheSizeMb <= 0) {
    return { hitRate: 0, workingSetSize: 0, memoryUsedMb: 0, stampedeRisk: false };
  }

  const cacheCapacityEntries = (cacheSizeMb * BYTES_PER_MB) / Math.max(avgValueBytes, 64);

  const uniqueKeysPerWindow = Math.min(keyCardinality, rps * ttlSeconds);
  const workingSetSize = uniqueKeysPerWindow;

  let hitRate: number;
  if (workingSetSize <= 0) {
    hitRate = 0;
  } else {
    const coverageRatio = cacheCapacityEntries / workingSetSize;
    hitRate = Math.min(1, Math.pow(coverageRatio, 1 / zipfSkew));
  }

  if (simTimeSeconds < ttlSeconds * 0.5) {
    const warmupFraction = simTimeSeconds / (ttlSeconds * 0.5);
    hitRate *= Math.min(1, warmupFraction);
  }

  if (evictionPolicy === 'lru' && keyCardinality > cacheCapacityEntries * 2) {
    hitRate *= 0.85;
  }

  hitRate = Math.max(0, Math.min(1, hitRate));

  const entriesInCache = Math.min(cacheCapacityEntries, workingSetSize) * hitRate;
  const memoryUsedMb = (entriesInCache * avgValueBytes) / BYTES_PER_MB;

  const stampedeRisk = rps > 1000 && ttlSeconds < 60 && hitRate > 0.7;

  return {
    hitRate,
    workingSetSize: Math.round(workingSetSize),
    memoryUsedMb,
    stampedeRisk,
  };
}

/**
 * Derive cache access latency from shape. CDN-scale (long TTL) is slower
 * than single-node in-memory. Used by processCache + processCdn.
 */
export function networkAwareCacheLatency(cacheSizeMb: number, ttlSeconds: number): { p50: number; p99: number } {
  if (ttlSeconds > 3600) {
    return { p50: 20, p99: 100 };
  }
  if (cacheSizeMb > 4096) {
    return { p50: 1, p99: 5 };
  }
  return { p50: 0.5, p99: 2 };
}
