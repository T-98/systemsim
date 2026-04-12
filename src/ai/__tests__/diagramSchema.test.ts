import { describe, it, expect } from 'vitest';
import { validateAndRewrite } from '../diagramSchema';

describe('validateAndRewrite', () => {
  it('accepts valid input and rewrites refs to canonical ids', () => {
    const result = validateAndRewrite({
      nodes: [
        { ref: 'n1', type: 'load_balancer', label: 'LB' },
        { ref: 'n2', type: 'server', label: 'API' },
      ],
      edges: [{ source: 'n1', target: 'n2' }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.nodes).toHaveLength(2);
    expect(result.graph.edges).toHaveLength(1);
    expect(result.graph.edges[0].source).toBe('load_balancer-0');
    expect(result.graph.edges[0].target).toBe('server-1');
  });

  it('rejects null input', () => {
    expect(validateAndRewrite(null)).toEqual({ ok: false, reason: 'malformed_json' });
  });

  it('rejects empty nodes array', () => {
    expect(validateAndRewrite({ nodes: [], edges: [] })).toEqual({ ok: false, reason: 'no_nodes' });
  });

  it('rejects too many nodes (>15)', () => {
    const nodes = Array.from({ length: 16 }, (_, i) => ({ ref: `n${i}`, type: 'server', label: `S${i}` }));
    expect(validateAndRewrite({ nodes, edges: [] })).toEqual({ ok: false, reason: 'too_many_nodes' });
  });

  it('rejects too many edges (>30)', () => {
    const nodes = [{ ref: 'n1', type: 'server', label: 'A' }, { ref: 'n2', type: 'server', label: 'B' }];
    const edges = Array.from({ length: 31 }, () => ({ source: 'n1', target: 'n2' }));
    expect(validateAndRewrite({ nodes, edges })).toEqual({ ok: false, reason: 'too_many_edges' });
  });

  it('rejects invalid component type', () => {
    const result = validateAndRewrite({
      nodes: [{ ref: 'n1', type: 'microservice', label: 'MS' }],
      edges: [],
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_type' });
  });

  it('rejects dangling edge (source ref not found)', () => {
    const result = validateAndRewrite({
      nodes: [{ ref: 'n1', type: 'server', label: 'A' }],
      edges: [{ source: 'n99', target: 'n1' }],
    });
    expect(result).toEqual({ ok: false, reason: 'dangling_edge' });
  });

  it('rejects dangling edge (target ref not found)', () => {
    const result = validateAndRewrite({
      nodes: [{ ref: 'n1', type: 'server', label: 'A' }],
      edges: [{ source: 'n1', target: 'n99' }],
    });
    expect(result).toEqual({ ok: false, reason: 'dangling_edge' });
  });

  it('rejects self-loops', () => {
    const result = validateAndRewrite({
      nodes: [{ ref: 'n1', type: 'server', label: 'A' }],
      edges: [{ source: 'n1', target: 'n1' }],
    });
    expect(result).toEqual({ ok: false, reason: 'self_loop' });
  });

  it('normalizes labels (trim, collapse whitespace, truncate)', () => {
    const result = validateAndRewrite({
      nodes: [{ ref: 'n1', type: 'server', label: '  My   Server  \n Name That Is Way Too Long For Display Purposes Here ' }],
      edges: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.nodes[0].label).toBe('My Server Name That Is Way Too Long For');
    expect(result.graph.nodes[0].label.length).toBeLessThanOrEqual(40);
  });

  it('handles same-label different-type nodes correctly', () => {
    const result = validateAndRewrite({
      nodes: [
        { ref: 'n1', type: 'server', label: 'API' },
        { ref: 'n2', type: 'cache', label: 'API' },
      ],
      edges: [{ source: 'n1', target: 'n2' }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.edges[0].source).toBe('server-0');
    expect(result.graph.edges[0].target).toBe('cache-1');
  });

  it('accepts single node with zero edges', () => {
    const result = validateAndRewrite({
      nodes: [{ ref: 'n1', type: 'database', label: 'DB' }],
      edges: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.nodes).toHaveLength(1);
    expect(result.graph.edges).toHaveLength(0);
  });

  it('rejects missing required fields', () => {
    expect(validateAndRewrite({ nodes: [{ ref: 'n1', type: 'server' }], edges: [] }))
      .toEqual({ ok: false, reason: 'malformed_json' });
    expect(validateAndRewrite({ nodes: [{ ref: 'n1', label: 'A' }], edges: [] }))
      .toEqual({ ok: false, reason: 'malformed_json' });
  });

  it('rejects non-string fields (type safety)', () => {
    expect(validateAndRewrite({ nodes: [{ ref: 'n1', type: 'server', label: {} }], edges: [] }))
      .toEqual({ ok: false, reason: 'malformed_json' });
    expect(validateAndRewrite({ nodes: [{ ref: 'n1', type: 123, label: 'A' }], edges: [] }))
      .toEqual({ ok: false, reason: 'malformed_json' });
  });

  it('rejects duplicate ref tokens', () => {
    expect(validateAndRewrite({
      nodes: [
        { ref: 'n1', type: 'server', label: 'A' },
        { ref: 'n1', type: 'database', label: 'B' },
      ],
      edges: [],
    })).toEqual({ ok: false, reason: 'duplicate_ref' });
  });

  it('rejects labels that normalize to empty string', () => {
    expect(validateAndRewrite({ nodes: [{ ref: 'n1', type: 'server', label: '   ' }], edges: [] }))
      .toEqual({ ok: false, reason: 'malformed_json' });
  });

  it('accepts all 6 MVP component types', () => {
    const types = ['load_balancer', 'server', 'database', 'cache', 'queue', 'fanout'];
    const nodes = types.map((t, i) => ({ ref: `n${i}`, type: t, label: t }));
    const result = validateAndRewrite({ nodes, edges: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.nodes).toHaveLength(6);
  });
});
