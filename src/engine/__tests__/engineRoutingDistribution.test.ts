/**
 * @file engineRoutingDistribution.test.ts
 *
 * Phase 4.1 / 4.2 — per-endpoint traffic distribution. Before Phase 4 the
 * engine seeded `rpsPerTick / entryPoints.length` on every entry; now it
 * routes RPS per `endpointRoute.componentChain[0]` using weights from
 * `TrafficProfile.requestMix` (or `RoutingContext.requestMix`), with
 * documented fallback layering.
 *
 * These tests cover:
 *   1. Weighted routing when requestMix keys match endpointIds.
 *   2. Fallback to `EndpointRoute.weight` when requestMix has no matching keys.
 *   3. Fallback to legacy even-split when neither weights nor routes are present.
 *   4. Unmatched requestMix keys ("default") → even-split across entry points.
 *   5. Stale chain head (route → missing node) redistributes that share across
 *      the remaining valid endpoints instead of leaking load.
 */
import { describe, it, expect } from 'vitest';
import { SimulationEngine, type RoutingContext } from '../SimulationEngine';
import type { TrafficProfile, SimComponentData, WireConfig, EndpointRoute, ApiContract } from '../../types';
import type { Node, Edge } from '@xyflow/react';

const SEED = 42;

function node(id: string, type: string, config: Record<string, unknown> = {}): Node<SimComponentData> {
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

function edge(id: string, source: string, target: string, config: Partial<WireConfig> = {}): Edge<{ config: WireConfig }> {
  return {
    id,
    source,
    target,
    data: { config: { throughputRps: 100_000, latencyMs: 1, jitterMs: 0, ...config } },
  } as Edge<{ config: WireConfig }>;
}

function profile(rps: number, requestMix: Record<string, number>, durationSeconds = 10): TrafficProfile {
  return {
    name: 'routing',
    durationSeconds,
    jitterPercent: 0,
    phases: [{ startS: 0, endS: durationSeconds, rps, shape: 'steady' as const, description: 'routing' }],
    requestMix,
    userDistribution: 'uniform',
  } as unknown as TrafficProfile;
}

function route(endpointId: string, chain: string[], weight = 1): EndpointRoute {
  return { endpointId, componentChain: chain, tablesAccessed: [], weight, estimatedPayloadBytes: 0 };
}

describe('Phase 4.2 — per-endpoint traffic distribution', () => {
  it('routes rps per requestMix weight to each endpoint\'s chain head', () => {
    // Three independent API servers; each the head of a different endpoint.
    // Mix: checkout 0.6, search 0.3, healthz 0.1. At 1000 rps/tick, heads see
    // 600/300/100 respectively. No default-bucket weight present.
    const nodes = [
      node('checkoutSvc', 'api_gateway', { isEntry: true, rateLimitRps: 1_000_000 }),
      node('searchSvc', 'api_gateway', { isEntry: true, rateLimitRps: 1_000_000 }),
      node('healthSvc', 'api_gateway', { isEntry: true, rateLimitRps: 1_000_000 }),
    ];
    const edges: Edge<{ config: WireConfig }>[] = [];
    const routes: EndpointRoute[] = [
      route('checkout', ['checkoutSvc']),
      route('search', ['searchSvc']),
      route('healthz', ['healthSvc']),
    ];
    const routingContext: RoutingContext = {
      endpointRoutes: routes,
      requestMix: { checkout: 0.6, search: 0.3, healthz: 0.1 },
    };
    const engine = new SimulationEngine(
      nodes, edges, profile(1000, { checkout: 0.6, search: 0.3, healthz: 0.1 }),
      undefined, undefined, SEED, false, routingContext,
    );
    const { metrics } = engine.tick();
    expect(metrics.checkoutSvc.rps).toBeCloseTo(600, 0);
    expect(metrics.searchSvc.rps).toBeCloseTo(300, 0);
    expect(metrics.healthSvc.rps).toBeCloseTo(100, 0);
  });

  it('falls back to EndpointRoute.weight when requestMix has no matching keys', () => {
    // requestMix is the default {'default': 1.0}. Routes carry explicit weights.
    const nodes = [
      node('a', 'api_gateway', { isEntry: true, rateLimitRps: 1_000_000 }),
      node('b', 'api_gateway', { isEntry: true, rateLimitRps: 1_000_000 }),
    ];
    const edges: Edge<{ config: WireConfig }>[] = [];
    const routes: EndpointRoute[] = [
      route('epA', ['a'], 0.75),
      route('epB', ['b'], 0.25),
    ];
    const engine = new SimulationEngine(
      nodes, edges, profile(1000, { default: 1.0 }),
      undefined, undefined, SEED, false,
      { endpointRoutes: routes, requestMix: { default: 1.0 } },
    );
    const { metrics } = engine.tick();
    expect(metrics.a.rps).toBeCloseTo(750, 0);
    expect(metrics.b.rps).toBeCloseTo(250, 0);
  });

  it('falls back to legacy even-split when no endpoint routes are present', () => {
    // Baseline compatibility — pre-Phase-4 templates keep working.
    const nodes = [
      node('a', 'api_gateway', { isEntry: true, rateLimitRps: 1_000_000 }),
      node('b', 'api_gateway', { isEntry: true, rateLimitRps: 1_000_000 }),
    ];
    const edges: Edge<{ config: WireConfig }>[] = [];
    const engine = new SimulationEngine(
      nodes, edges, profile(1000, { default: 1.0 }),
      undefined, undefined, SEED, false,
    );
    const { metrics } = engine.tick();
    expect(metrics.a.rps).toBeCloseTo(500, 0);
    expect(metrics.b.rps).toBeCloseTo(500, 0);
  });

  it('unmatched requestMix weight spills into the default even-split bucket', () => {
    // 40% routed to checkout, 60% unmatched ("other") → spread over entryPoints (a, b).
    // At 1000 rps: checkout → 400; a and b each get the share of 600 remaining
    // PLUS (entry a also happens to be the chain head for checkout). So:
    //   a: 400 routed + 300 default = 700
    //   b: 0 routed + 300 default = 300
    const nodes = [
      node('a', 'api_gateway', { isEntry: true, rateLimitRps: 1_000_000 }),
      node('b', 'api_gateway', { isEntry: true, rateLimitRps: 1_000_000 }),
    ];
    const edges: Edge<{ config: WireConfig }>[] = [];
    const routes: EndpointRoute[] = [route('checkout', ['a'])];
    const engine = new SimulationEngine(
      nodes, edges, profile(1000, { checkout: 0.4, other: 0.6 }),
      undefined, undefined, SEED, false,
      { endpointRoutes: routes, requestMix: { checkout: 0.4, other: 0.6 } },
    );
    const { metrics } = engine.tick();
    expect(metrics.a.rps).toBeCloseTo(700, 0);
    expect(metrics.b.rps).toBeCloseTo(300, 0);
  });

  it('matches requestMix keys by "METHOD PATH" via ApiContract join (authored-scenario shape)', () => {
    // Scenarios like src/scenarios/discord.ts author requestMix keys as
    // "POST /event/everyone" — not as the uuid-shaped endpointIds that the UI
    // generates. The engine joins contract.id → route.endpointId so those
    // authored mixes actually land on the right chain head.
    const nodes = [
      node('fanoutSvc', 'api_gateway', { isEntry: true, rateLimitRps: 1_000_000 }),
      node('inboxSvc', 'api_gateway', { isEntry: true, rateLimitRps: 1_000_000 }),
    ];
    const edges: Edge<{ config: WireConfig }>[] = [];
    const contracts: ApiContract[] = [
      { id: 'uuid-fanout', method: 'POST', path: '/event/everyone', description: '', authMode: 'none', ownerServiceId: 'fanoutSvc' },
      { id: 'uuid-inbox',  method: 'GET',  path: '/notifications/inbox', description: '', authMode: 'none', ownerServiceId: 'inboxSvc' },
    ];
    const routes: EndpointRoute[] = [
      { endpointId: 'uuid-fanout', componentChain: ['fanoutSvc'], tablesAccessed: [], weight: 1, estimatedPayloadBytes: 0 },
      { endpointId: 'uuid-inbox',  componentChain: ['inboxSvc'],  tablesAccessed: [], weight: 1, estimatedPayloadBytes: 0 },
    ];
    const mix = { 'POST /event/everyone': 0.8, 'GET /notifications/inbox': 0.2 };
    const engine = new SimulationEngine(
      nodes, edges, profile(1000, mix),
      undefined, undefined, SEED, false,
      { endpointRoutes: routes, requestMix: mix, apiContracts: contracts },
    );
    const { metrics } = engine.tick();
    expect(metrics.fanoutSvc.rps).toBeCloseTo(800, 0);
    expect(metrics.inboxSvc.rps).toBeCloseTo(200, 0);
  });

  it('redistributes a stale chain head\'s share across remaining valid endpoints', () => {
    // `ghost` references a node that isn't in the graph. Its 0.25 share must NOT
    // be dropped — it redistributes proportionally across real endpoints.
    // Mix: real=0.75 valid, ghost=0.25 invalid; all routed (no default bucket).
    // After redistribution, the single valid endpoint `real` gets 100% of 1000.
    const nodes = [
      node('real', 'api_gateway', { isEntry: true, rateLimitRps: 1_000_000 }),
    ];
    const edges: Edge<{ config: WireConfig }>[] = [];
    const routes: EndpointRoute[] = [
      route('ep_real', ['real'], 1),
      route('ep_ghost', ['missingNode'], 1),
    ];
    const engine = new SimulationEngine(
      nodes, edges, profile(1000, { ep_real: 0.75, ep_ghost: 0.25 }),
      undefined, undefined, SEED, false,
      { endpointRoutes: routes, requestMix: { ep_real: 0.75, ep_ghost: 0.25 } },
    );
    const { metrics, newLogs } = engine.tick();
    expect(metrics.real.rps).toBeCloseTo(1000, 0);
    // One-shot warning fires once per stale endpoint.
    expect(newLogs.some((l) => l.message.includes('ep_ghost'))).toBe(true);
  });
});
