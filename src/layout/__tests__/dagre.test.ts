import { describe, it, expect } from 'vitest';
import { layoutGraph } from '../dagre';
import type { Node, Edge } from '@xyflow/react';
import type { SimComponentData, WireConfig } from '../../types';

function makeNode(id: string, type: string): Node<SimComponentData> {
  return {
    id,
    type: 'simComponent',
    position: { x: 0, y: 0 },
    data: {
      type: type as SimComponentData['type'],
      label: id,
      config: {},
      health: 'healthy',
      metrics: { rps: 0, p50: 0, p95: 0, p99: 0, errorRate: 0, cpuPercent: 0, memoryPercent: 0 },
    },
  } as Node<SimComponentData>;
}

function makeEdge(id: string, source: string, target: string): Edge<{ config: WireConfig }> {
  return {
    id,
    source,
    target,
    type: 'simWire',
    data: { config: { throughputRps: 10000, latencyMs: 2, jitterMs: 1 } },
  };
}

describe('layoutGraph', () => {
  it('returns empty array for empty input', () => {
    expect(layoutGraph([], [])).toEqual([]);
  });

  it('assigns positions to nodes', () => {
    const nodes = [makeNode('lb', 'load_balancer'), makeNode('srv', 'server')];
    const edges = [makeEdge('e1', 'lb', 'srv')];
    const result = layoutGraph(nodes, edges);

    expect(result).toHaveLength(2);
    // LR layout: lb should be left of srv
    expect(result[0].position.x).toBeLessThan(result[1].position.x);
    // Positions should be finite numbers
    expect(Number.isFinite(result[0].position.x)).toBe(true);
    expect(Number.isFinite(result[1].position.x)).toBe(true);
  });

  it('handles diamond topology (not a cycle)', () => {
    const nodes = [
      makeNode('lb', 'load_balancer'),
      makeNode('a', 'server'),
      makeNode('b', 'server'),
      makeNode('db', 'database'),
    ];
    const edges = [
      makeEdge('e1', 'lb', 'a'),
      makeEdge('e2', 'lb', 'b'),
      makeEdge('e3', 'a', 'db'),
      makeEdge('e4', 'b', 'db'),
    ];
    const result = layoutGraph(nodes, edges);
    expect(result).toHaveLength(4);
    // All nodes should have valid positions
    result.forEach((n) => {
      expect(Number.isFinite(n.position.x)).toBe(true);
      expect(Number.isFinite(n.position.y)).toBe(true);
    });
  });

  it('handles cyclic graph without crashing (back-edge excluded from layout)', () => {
    const nodes = [
      makeNode('a', 'server'),
      makeNode('b', 'server'),
      makeNode('c', 'server'),
    ];
    const edges = [
      makeEdge('e1', 'a', 'b'),
      makeEdge('e2', 'b', 'c'),
      makeEdge('e3', 'c', 'a'), // cycle
    ];
    const result = layoutGraph(nodes, edges);
    expect(result).toHaveLength(3);
    result.forEach((n) => {
      expect(Number.isFinite(n.position.x)).toBe(true);
    });
  });

  it('preserves node ids and data through layout', () => {
    const nodes = [makeNode('my-node', 'cache')];
    const result = layoutGraph(nodes, []);
    expect(result[0].id).toBe('my-node');
    expect(result[0].data.type).toBe('cache');
    expect(result[0].data.label).toBe('my-node');
  });
});
