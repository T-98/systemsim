/**
 * @file challenges/harness.ts
 *
 * Headless challenge execution (Decisions §72). Builds ReactFlow-shaped
 * nodes/edges from a challenge's CanonicalGraph using the SAME deterministic
 * `${type}-${index}` id scheme as the store's replaceGraph, applies optional
 * FixOps (label-addressed), runs the engine to completion, and returns an
 * EvaluatableRun. Used by the content test suite that proves every shipped
 * challenge fails broken and passes with its knownFix — and by any future
 * "reveal the answer" affordance.
 */

import type { Node, Edge } from '@xyflow/react';
import { SimulationEngine } from '../engine/SimulationEngine';
import { getCalibrationSet } from '../engine/calibration';
import { COMPONENT_DEFS } from '../types/components';
import { buildAdjacency, bfs, findEntryPoints } from '../engine/graphTraversal';
import type { SimComponentData, WireConfig, CanonicalGraph, ComponentMetrics, EndpointRoute, TableAccess, HealthState } from '../types';
import type { Challenge, FixOp, EvaluatableRun } from './types';

const emptyMetrics: ComponentMetrics = { rps: 0, p50: 0, p95: 0, p99: 0, errorRate: 0, cpuPercent: 0, memoryPercent: 0 };

export function buildGraph(graph: CanonicalGraph): { nodes: Node<SimComponentData>[]; edges: Edge<{ config: WireConfig }>[] } {
  const nodes: Node<SimComponentData>[] = graph.nodes.map((cn, i) => ({
    id: `${cn.type}-${i}`,
    type: 'simComponent',
    position: { x: 0, y: 0 },
    data: {
      type: cn.type,
      label: cn.label,
      config: { ...COMPONENT_DEFS[cn.type].defaultConfig, ...(cn.config ?? {}) },
      health: 'healthy' as HealthState,
      metrics: { ...emptyMetrics },
    },
  }));
  const edges: Edge<{ config: WireConfig }>[] = graph.edges.map((ce, i) => ({
    id: `edge-${i}`,
    source: ce.source,
    target: ce.target,
    type: 'simWire',
    data: {
      config: {
        throughputRps: ce.config?.throughputRps ?? 10000,
        latencyMs: ce.config?.latencyMs ?? 2,
        jitterMs: ce.config?.jitterMs ?? 1,
        ...(ce.config?.circuitBreaker ? { circuitBreaker: ce.config.circuitBreaker } : {}),
      },
    },
  }));
  return { nodes, edges };
}

function idByLabel(nodes: Node<SimComponentData>[], label: string): string {
  const n = nodes.find((x) => x.data.label === label);
  if (!n) throw new Error(`challenge harness: no node labeled "${label}"`);
  return n.id;
}

export function applyFix(
  nodes: Node<SimComponentData>[],
  edges: Edge<{ config: WireConfig }>[],
  ops: FixOp[],
): { nodes: Node<SimComponentData>[]; edges: Edge<{ config: WireConfig }>[] } {
  let ns = nodes.map((n) => ({ ...n, data: { ...n.data, config: { ...n.data.config } } }));
  let es = edges.map((e) => ({ ...e, data: { config: { ...e.data!.config } } }));
  for (const op of ops) {
    if (op.op === 'updateConfig') {
      const id = idByLabel(ns, op.label);
      ns = ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, config: { ...n.data.config, ...op.patch } } } : n));
    } else if (op.op === 'updateWireConfig') {
      const s = idByLabel(ns, op.sourceLabel);
      const t = idByLabel(ns, op.targetLabel);
      es = es.map((e) => (e.source === s && e.target === t ? { ...e, data: { config: { ...e.data!.config, ...op.patch } as WireConfig } } : e));
    } else if (op.op === 'addNode') {
      // New nodes get ids beyond the canonical range — never collides.
      ns = [...ns, {
        id: `${op.node.type}-fix-${ns.length}`,
        type: 'simComponent',
        position: { x: 0, y: 0 },
        data: {
          type: op.node.type,
          label: op.node.label,
          config: { ...COMPONENT_DEFS[op.node.type].defaultConfig, ...(op.node.config ?? {}) },
          health: 'healthy',
          metrics: { ...emptyMetrics },
        },
      }];
    } else if (op.op === 'addEdge') {
      es = [...es, {
        id: `edge-fix-${es.length}`,
        source: idByLabel(ns, op.sourceLabel),
        target: idByLabel(ns, op.targetLabel),
        type: 'simWire',
        data: { config: { throughputRps: 10000, latencyMs: 2, jitterMs: 1, ...(op.config ?? {}) } as WireConfig },
      }];
    } else if (op.op === 'removeEdge') {
      const s = idByLabel(ns, op.sourceLabel);
      const t = idByLabel(ns, op.targetLabel);
      es = es.filter((e) => !(e.source === s && e.target === t));
    }
  }
  return { nodes: ns, edges: es };
}

/**
 * Mirror of the store's setApiContracts BFS so headless runs get the same
 * endpointRoutes the app would build (entry → owner → first reachable DB).
 */
export function buildRoutes(
  nodes: Node<SimComponentData>[],
  edges: Edge<{ config: WireConfig }>[],
  challenge: Challenge,
): EndpointRoute[] {
  const contracts = challenge.starter.apiContracts ?? [];
  const schema = challenge.starter.schemaMemory ?? null;
  const simpleEdges = edges.map((e) => ({ source: e.source, target: e.target }));
  const simpleNodes = nodes.map((n) => ({ id: n.id, data: { config: n.data.config } }));
  const adj = buildAdjacency(simpleEdges);
  const entries = findEntryPoints(simpleNodes, simpleEdges);
  const dbIds = nodes.filter((n) => n.data.type === 'database').map((n) => n.id);

  return contracts
    .filter((c) => c.ownerServiceId)
    .map((c) => {
      let chain: string[] = [];
      const entry = entries[0];
      if (!entry && c.ownerServiceId) {
        // Store parity: entry-less graphs fall back to seeding at the owner.
        chain = [c.ownerServiceId];
      }
      if (entry && c.ownerServiceId) {
        const toOwner = bfs(adj, entry, c.ownerServiceId);
        if (toOwner) {
          chain = [...toOwner];
          for (const dbId of dbIds) {
            const toDb = bfs(adj, c.ownerServiceId, dbId);
            if (toDb) { chain = [...toOwner, ...toDb.slice(1)]; break; }
          }
        } else {
          chain = [c.ownerServiceId];
        }
      }
      const tablesAccessed: TableAccess[] = [];
      if (schema) {
        for (const entity of schema.entities) {
          if (entity.assignedDbId && dbIds.includes(entity.assignedDbId)) {
            tablesAccessed.push({
              tableId: entity.id,
              mode: c.method === 'GET' ? 'read' : c.method === 'DELETE' ? 'write' : 'read_write',
              indexed: entity.indexes.length > 0,
            });
          }
        }
      }
      return { endpointId: c.id, componentChain: chain, tablesAccessed, weight: 1, estimatedPayloadBytes: 200 };
    });
}

/** Run a challenge graph to completion headlessly; seeded for determinism. */
export function runChallenge(
  challenge: Challenge,
  opts: { fix?: FixOp[]; seed?: number } = {},
): { run: EvaluatableRun; nodes: Node<SimComponentData>[] } {
  let { nodes, edges } = buildGraph(challenge.graph);
  if (opts.fix) ({ nodes, edges } = applyFix(nodes, edges, opts.fix));

  const routes = buildRoutes(nodes, edges, challenge);
  const engine = new SimulationEngine(
    nodes,
    edges,
    challenge.starter.trafficProfile,
    undefined,
    undefined,
    opts.seed ?? 42,
    false,
    {
      endpointRoutes: routes,
      schemaMemory: challenge.starter.schemaMemory ?? null,
      requestMix: challenge.starter.trafficProfile.requestMix,
      apiContracts: challenge.starter.apiContracts ?? [],
    },
    // App parity: pass whatever calibration is loaded (empty in tests, so
    // determinism holds; real anchors would flow through like in-app).
    getCalibrationSet(),
  );

  const metricsTimeSeries: Record<string, ComponentMetrics[]> = {};
  while (!engine.isComplete()) {
    const r = engine.tick();
    for (const [id, m] of Object.entries(r.metrics)) {
      (metricsTimeSeries[id] ??= []).push({ ...m });
    }
  }
  return { run: { metricsTimeSeries, log: engine.getLog() }, nodes };
}
