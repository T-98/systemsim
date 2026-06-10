import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadCalibrationSet,
  parseCalibrationProfile,
  primeCalibration,
  getCalibrationSet,
  __resetCalibrationForTests,
  type CalibrationSet,
} from '../calibration';
import { SimulationEngine } from '../SimulationEngine';
import type { Node, Edge } from '@xyflow/react';
import type { SimComponentData, WireConfig, TrafficProfile } from '../../types';

// ── fetch stubs ─────────────────────────────────────────────────────────────

function okJson(body: unknown): Response {
  return { ok: true, json: async () => body } as unknown as Response;
}
function notFound(): Response {
  return { ok: false, json: async () => ({}) } as unknown as Response;
}

function emptyProfile(primitive: string, version: string) {
  return {
    primitive,
    version,
    hardwareClass: 'laptop-m-series-16gb',
    capturedAt: null,
    anchors: {
      serviceTimeMs: { p50: null, p99: null },
      serviceVariance: null,
      readThroughputRps: null,
      writeThroughputRps: null,
      connectionPoolExhaustionMs: null,
    },
    source: 'empty-default',
  };
}

// ── engine fixture ──────────────────────────────────────────────────────────

function makeNode(id: string, type: string, config: Record<string, unknown> = {}): Node<SimComponentData> {
  return {
    id,
    position: { x: 0, y: 0 },
    data: {
      type: type as SimComponentData['type'],
      label: id,
      config: { instanceCount: 1, ...config },
      health: 'healthy',
      metrics: { rps: 0, p50: 0, p95: 0, p99: 0, errorRate: 0, cpuPercent: 0, memoryPercent: 0 },
    },
  } as Node<SimComponentData>;
}

function makeEdge(id: string, source: string, target: string): Edge<{ config: WireConfig }> {
  return {
    id, source, target,
    data: { config: { throughputRps: 100000, latencyMs: 1, jitterMs: 0 } },
  } as Edge<{ config: WireConfig }>;
}

function profile(rps: number): TrafficProfile {
  return {
    profileName: 'cal-test',
    durationSeconds: 10,
    jitterPercent: 0,
    phases: [{ startS: 0, endS: 10, rps, shape: 'steady', description: 'steady' }],
    requestMix: {},
    userDistribution: 'uniform',
  };
}

function dbEngine(dbConfig: Record<string, unknown>, calibration?: CalibrationSet) {
  const nodes = [
    makeNode('lb', 'load_balancer', { isEntry: true }),
    makeNode('db', 'database', dbConfig),
  ];
  const edges = [makeEdge('e1', 'lb', 'db')];
  return new SimulationEngine(nodes, edges, profile(100), undefined, undefined, 42, false, undefined, calibration);
}

// ── loader ──────────────────────────────────────────────────────────────────

describe('loadCalibrationSet', () => {
  it('missing files → empty set (engine defaults apply)', async () => {
    const set = await loadCalibrationSet('laptop-m-series-16gb', async () => notFound());
    expect(set).toEqual({});
  });

  it('fetch throwing → empty set, no rejection', async () => {
    const set = await loadCalibrationSet('laptop-m-series-16gb', async () => {
      throw new Error('network down');
    });
    expect(set).toEqual({});
  });

  it('present files with all-null anchors parse with nulls preserved', async () => {
    const set = await loadCalibrationSet('laptop-m-series-16gb', async (url) => {
      const u = String(url);
      if (u.includes('postgres-16')) return okJson(emptyProfile('postgres', '16'));
      return notFound();
    });
    expect(set.postgres).toBeDefined();
    expect(set.postgres!.anchors.readThroughputRps).toBeNull();
    expect(set.postgres!.source).toBe('empty-default');
    expect(set.redis).toBeUndefined();
    expect(set.fastify).toBeUndefined();
  });

  it('partial anchors fill what is there, null the rest', async () => {
    const partial = {
      ...emptyProfile('postgres', '16'),
      anchors: {
        serviceTimeMs: { p50: 2.5 },
        readThroughputRps: 12000,
      },
      source: 'measured',
    };
    const set = await loadCalibrationSet('laptop-m-series-16gb', async (url) =>
      String(url).includes('postgres-16') ? okJson(partial) : notFound());
    const a = set.postgres!.anchors;
    expect(a.serviceTimeMs.p50).toBe(2.5);
    expect(a.serviceTimeMs.p99).toBeNull();
    expect(a.readThroughputRps).toBe(12000);
    expect(a.writeThroughputRps).toBeNull();
    expect(set.postgres!.source).toBe('measured');
  });

  it('malformed JSON shape → primitive absent', async () => {
    const set = await loadCalibrationSet('laptop-m-series-16gb', async () =>
      okJson({ totally: 'wrong' }));
    expect(set).toEqual({});
  });

  it('fetches the documented per-primitive paths', async () => {
    const urls: string[] = [];
    await loadCalibrationSet('laptop-m-series-16gb', async (url) => {
      urls.push(String(url));
      return notFound();
    });
    expect(urls.sort()).toEqual([
      '/calibration/laptop-m-series-16gb/fastify-5.json',
      '/calibration/laptop-m-series-16gb/postgres-16.json',
      '/calibration/laptop-m-series-16gb/redis-7.json',
    ]);
  });
});

describe('parseCalibrationProfile', () => {
  it('rejects non-objects and missing primitive/version', () => {
    expect(parseCalibrationProfile(null)).toBeNull();
    expect(parseCalibrationProfile('nope')).toBeNull();
    expect(parseCalibrationProfile({ version: '16' })).toBeNull();
  });

  it('coerces non-numeric anchor values to null', () => {
    const p = parseCalibrationProfile({
      primitive: 'postgres',
      version: '16',
      anchors: { readThroughputRps: 'fast', serviceVariance: Infinity },
    });
    expect(p!.anchors.readThroughputRps).toBeNull();
    expect(p!.anchors.serviceVariance).toBeNull();
  });
});

// ── module cache ────────────────────────────────────────────────────────────

describe('primeCalibration / getCalibrationSet', () => {
  beforeEach(() => __resetCalibrationForTests());

  it('starts empty and stays empty when files are absent (jsdom fetch fails)', async () => {
    expect(getCalibrationSet()).toEqual({});
    primeCalibration();
    primeCalibration(); // idempotent — no throw, single fetch round
    await new Promise((r) => setTimeout(r, 0));
    expect(getCalibrationSet()).toEqual({});
  });
});

// ── engine fallback behavior ────────────────────────────────────────────────

describe('engine calibration fallback', () => {
  it('null anchors → bit-identical metrics vs no calibration at all', () => {
    const emptySet: CalibrationSet = {
      postgres: parseCalibrationProfile(emptyProfile('postgres', '16'))!,
      fastify: parseCalibrationProfile(emptyProfile('fastify', '5'))!,
    };
    const a = dbEngine({}, undefined);
    const b = dbEngine({}, emptySet);
    const ra = a.tick();
    const rb = b.tick();
    expect(rb.metrics['db']).toEqual(ra.metrics['db']);
  });

  it('calibrated read/write throughput becomes the default for an unset DB config', () => {
    // 100 rps inbound vs calibrated capacity 50+50=100 → utilization 100%.
    // Hard-coded defaults (50k+20k) would put utilization near zero.
    const set: CalibrationSet = {
      postgres: parseCalibrationProfile({
        ...emptyProfile('postgres', '16'),
        anchors: {
          serviceTimeMs: { p50: null, p99: null },
          serviceVariance: null,
          readThroughputRps: 50,
          writeThroughputRps: 50,
          connectionPoolExhaustionMs: null,
        },
        source: 'measured',
      })!,
    };
    const calibrated = dbEngine({}, set);
    const stock = dbEngine({});
    const rc = calibrated.tick();
    const rs = stock.tick();
    expect(rc.metrics['db'].cpuPercent).toBeGreaterThan(90);
    expect(rs.metrics['db'].cpuPercent).toBeLessThan(5);
  });

  it('explicit per-component config wins over calibration', () => {
    const set: CalibrationSet = {
      postgres: parseCalibrationProfile({
        ...emptyProfile('postgres', '16'),
        anchors: {
          serviceTimeMs: { p50: null, p99: null },
          serviceVariance: null,
          readThroughputRps: 50,
          writeThroughputRps: 50,
          connectionPoolExhaustionMs: null,
        },
        source: 'measured',
      })!,
    };
    // Config says 50k read / 20k write → 100 rps is a rounding error.
    const engine = dbEngine({ readThroughputRps: 50000, writeThroughputRps: 20000 }, set);
    const r = engine.tick();
    expect(r.metrics['db'].cpuPercent).toBeLessThan(5);
  });

  it('calibrated fastify p50 becomes the server processingTimeMs default', () => {
    const set: CalibrationSet = {
      fastify: parseCalibrationProfile({
        ...emptyProfile('fastify', '5'),
        anchors: {
          serviceTimeMs: { p50: 500, p99: null },
          serviceVariance: null,
          readThroughputRps: null,
          writeThroughputRps: null,
          connectionPoolExhaustionMs: null,
        },
        source: 'measured',
      })!,
    };
    const nodes = [
      makeNode('lb', 'load_balancer', { isEntry: true }),
      makeNode('srv', 'server', { instanceCount: 1, maxConcurrent: 1000 }),
    ];
    const edges = [makeEdge('e1', 'lb', 'srv')];
    const calibrated = new SimulationEngine(nodes.map((n) => ({ ...n })), edges, profile(100), undefined, undefined, 42, false, undefined, set);
    const stock = new SimulationEngine(nodes.map((n) => ({ ...n })), edges, profile(100), undefined, undefined, 42, false, undefined, undefined);
    // 500ms service time → 1 instance handles 2 rps → saturated at 100 rps.
    // Stock default 50ms → 20 rps capacity... also saturated; compare p50
    // instead: queueing on a 10× slower service time is dramatically larger.
    const rc = calibrated.tick();
    const rs = stock.tick();
    expect(rc.metrics['srv'].cpuPercent).toBeGreaterThanOrEqual(rs.metrics['srv'].cpuPercent);
    expect(rc.metrics['srv'].p50).toBeGreaterThan(rs.metrics['srv'].p50);
  });
});
