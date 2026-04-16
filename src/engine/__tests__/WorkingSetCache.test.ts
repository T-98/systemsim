import { describe, it, expect } from 'vitest';
import { computeCacheModel, networkAwareCacheLatency } from '../WorkingSetCache';

describe('WorkingSetCache', () => {
  const baseInput = {
    rps: 1000,
    cacheSizeMb: 1024,
    ttlSeconds: 300,
    evictionPolicy: 'lru' as const,
    keyCardinality: 100000,
    avgValueBytes: 512,
    simTimeSeconds: 300,
  };

  it('returns zero hit rate at zero rps', () => {
    const r = computeCacheModel({ ...baseInput, rps: 0 });
    expect(r.hitRate).toBe(0);
  });

  it('returns high hit rate when cache is large relative to working set', () => {
    const r = computeCacheModel({ ...baseInput, cacheSizeMb: 4096 });
    expect(r.hitRate).toBeGreaterThan(0.8);
  });

  it('returns lower hit rate when cache is small relative to working set', () => {
    const r = computeCacheModel({ ...baseInput, cacheSizeMb: 10, keyCardinality: 1000000 });
    expect(r.hitRate).toBeLessThan(0.5);
  });

  it('cold cache has lower hit rate', () => {
    const cold = computeCacheModel({ ...baseInput, simTimeSeconds: 5 });
    const warm = computeCacheModel({ ...baseInput, simTimeSeconds: 300 });
    expect(cold.hitRate).toBeLessThan(warm.hitRate);
  });

  it('LRU penalty applies when cardinality is high', () => {
    const lru = computeCacheModel({ ...baseInput, keyCardinality: 5000000 });
    const lfu = computeCacheModel({ ...baseInput, keyCardinality: 5000000, evictionPolicy: 'lfu' });
    expect(lru.hitRate).toBeLessThan(lfu.hitRate);
  });

  it('detects stampede risk with high rps and low ttl', () => {
    const r = computeCacheModel({ ...baseInput, rps: 5000, ttlSeconds: 30 });
    expect(r.stampedeRisk).toBe(true);
  });

  it('no stampede risk with long ttl', () => {
    const r = computeCacheModel({ ...baseInput, ttlSeconds: 3600 });
    expect(r.stampedeRisk).toBe(false);
  });

  it('hit rate is between 0 and 1', () => {
    const r = computeCacheModel(baseInput);
    expect(r.hitRate).toBeGreaterThanOrEqual(0);
    expect(r.hitRate).toBeLessThanOrEqual(1);
  });

  it('Zipf skew increases hit rate', () => {
    const low = computeCacheModel({ ...baseInput, zipfSkew: 0.8 });
    const high = computeCacheModel({ ...baseInput, zipfSkew: 1.5 });
    expect(high.hitRate).toBeGreaterThanOrEqual(low.hitRate);
  });
});

describe('networkAwareCacheLatency', () => {
  it('returns CDN-tier latency for long TTL', () => {
    const r = networkAwareCacheLatency(1024, 7200);
    expect(r.p50).toBe(20);
    expect(r.p99).toBe(100);
  });

  it('returns cluster-tier latency for large cache', () => {
    const r = networkAwareCacheLatency(8192, 300);
    expect(r.p50).toBe(1);
    expect(r.p99).toBe(5);
  });

  it('returns single-node-tier latency for small cache', () => {
    const r = networkAwareCacheLatency(2048, 300);
    expect(r.p50).toBe(0.5);
    expect(r.p99).toBe(2);
  });
});
