import { describe, it, expect } from 'vitest';
import { bfs, buildAdjacency, findEntryPoints, findDisconnected, isReachable } from '../graphTraversal';

describe('bfs', () => {
  it('finds linear path A→B→C', () => {
    const adj = buildAdjacency([
      { source: 'A', target: 'B' },
      { source: 'B', target: 'C' },
    ]);
    expect(bfs(adj, 'A', 'C')).toEqual(['A', 'B', 'C']);
  });

  it('finds shortest path in diamond A→B→D + A→C→D', () => {
    const adj = buildAdjacency([
      { source: 'A', target: 'B' },
      { source: 'A', target: 'C' },
      { source: 'B', target: 'D' },
      { source: 'C', target: 'D' },
    ]);
    const path = bfs(adj, 'A', 'D');
    expect(path).not.toBeNull();
    expect(path!.length).toBe(3);
    expect(path![0]).toBe('A');
    expect(path![path!.length - 1]).toBe('D');
  });

  it('handles cyclic graph without infinite loop', () => {
    const adj = buildAdjacency([
      { source: 'A', target: 'B' },
      { source: 'B', target: 'A' },
      { source: 'B', target: 'C' },
    ]);
    expect(bfs(adj, 'A', 'C')).toEqual(['A', 'B', 'C']);
  });

  it('returns null when no path exists', () => {
    const adj = buildAdjacency([
      { source: 'A', target: 'B' },
    ]);
    expect(bfs(adj, 'A', 'C')).toBeNull();
  });

  it('returns [from] when from === to', () => {
    const adj = buildAdjacency([]);
    expect(bfs(adj, 'A', 'A')).toEqual(['A']);
  });

  it('returns null on empty graph', () => {
    const adj = buildAdjacency([]);
    expect(bfs(adj, 'A', 'B')).toBeNull();
  });
});

describe('findEntryPoints', () => {
  it('returns explicit isEntry nodes over zero-indegree', () => {
    const nodes = [
      { id: 'A', data: { config: { isEntry: true } } },
      { id: 'B', data: { config: {} } },
      { id: 'C', data: { config: {} } },
    ];
    const edges = [{ source: 'A', target: 'B' }, { source: 'B', target: 'C' }];
    expect(findEntryPoints(nodes, edges)).toEqual(['A']);
  });

  it('falls back to zero-indegree when no explicit isEntry', () => {
    const nodes = [
      { id: 'A', data: { config: {} } },
      { id: 'B', data: { config: {} } },
    ];
    const edges = [{ source: 'A', target: 'B' }];
    expect(findEntryPoints(nodes, edges)).toEqual(['A']);
  });

  it('returns empty when all nodes have incoming edges and no isEntry', () => {
    const nodes = [
      { id: 'A', data: { config: {} } },
      { id: 'B', data: { config: {} } },
    ];
    const edges = [
      { source: 'A', target: 'B' },
      { source: 'B', target: 'A' },
    ];
    expect(findEntryPoints(nodes, edges)).toEqual([]);
  });

  it('returns multiple entry points', () => {
    const nodes = [
      { id: 'A', data: { config: { isEntry: true } } },
      { id: 'B', data: { config: { isEntry: true } } },
      { id: 'C', data: { config: {} } },
    ];
    const edges = [
      { source: 'A', target: 'C' },
      { source: 'B', target: 'C' },
    ];
    expect(findEntryPoints(nodes, edges)).toEqual(['A', 'B']);
  });
});

describe('findDisconnected', () => {
  it('returns nodes with no wires', () => {
    const nodes = [
      { id: 'A', data: {} },
      { id: 'B', data: {} },
      { id: 'C', data: {} },
    ];
    const edges = [{ source: 'A', target: 'B' }];
    expect(findDisconnected(nodes, edges)).toEqual(['C']);
  });

  it('returns empty when all connected', () => {
    const nodes = [
      { id: 'A', data: {} },
      { id: 'B', data: {} },
    ];
    const edges = [{ source: 'A', target: 'B' }];
    expect(findDisconnected(nodes, edges)).toEqual([]);
  });

  it('returns all when no edges', () => {
    const nodes = [
      { id: 'A', data: {} },
      { id: 'B', data: {} },
    ];
    expect(findDisconnected(nodes, [])).toEqual(['A', 'B']);
  });
});

describe('isReachable', () => {
  it('returns true for reachable target', () => {
    const adj = buildAdjacency([{ source: 'A', target: 'B' }]);
    expect(isReachable(adj, 'A', 'B')).toBe(true);
  });

  it('returns false for unreachable target', () => {
    const adj = buildAdjacency([{ source: 'A', target: 'B' }]);
    expect(isReachable(adj, 'B', 'A')).toBe(false);
  });

  it('returns true for self', () => {
    const adj = buildAdjacency([]);
    expect(isReachable(adj, 'A', 'A')).toBe(true);
  });
});
