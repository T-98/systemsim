/**
 * Zipfian working-set cache model.
 *
 * Instead of rolling dice for cache hits, models:
 * - Working set size from key cardinality + RPS
 * - Hit rate = min(1, cacheSize / workingSetSize) adjusted by Zipf skew
 * - LRU penalty for scan-heavy workloads
 * - Stampede as function of TTL variance
 */

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

export function networkAwareCacheLatency(cacheSizeMb: number, ttlSeconds: number): { p50: number; p99: number } {
  if (ttlSeconds > 3600) {
    return { p50: 20, p99: 100 };
  }
  if (cacheSizeMb > 4096) {
    return { p50: 1, p99: 5 };
  }
  return { p50: 0.5, p99: 2 };
}
