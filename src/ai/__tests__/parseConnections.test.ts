import { describe, it, expect } from 'vitest';
import {
  parseConnectionLine,
  parseConnections,
  buildCanonicalGraph,
  formatConnectionsForDisplay,
} from '../parseConnections';
import type { DetectedComponent } from '../describeIntentSchema';

describe('parseConnectionLine', () => {
  it('parses a simple arrow edge', () => {
    const result = parseConnectionLine('A --> B');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.edge).toEqual({ sourceLabel: 'A', targetLabel: 'B' });
  });

  it('parses an edge with a label', () => {
    const result = parseConnectionLine('raw video --extracted audio--> STT');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.edge).toEqual({
      sourceLabel: 'raw video',
      targetLabel: 'STT',
      edgeLabel: 'extracted audio',
    });
  });

  it('accepts unicode arrow →', () => {
    const result = parseConnectionLine('STT → nisa agent');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.edge.sourceLabel).toBe('STT');
    expect(result.edge.targetLabel).toBe('nisa agent');
  });

  it('ignores blank lines', () => {
    const result = parseConnectionLine('');
    expect(result).toEqual({ ok: false, reason: 'blank' });
  });

  it('ignores whitespace-only lines', () => {
    const result = parseConnectionLine('   ');
    expect(result).toEqual({ ok: false, reason: 'blank' });
  });

  it('ignores # comment lines', () => {
    const result = parseConnectionLine('# this is a comment');
    expect(result).toEqual({ ok: false, reason: 'blank' });
  });

  it('ignores // comment lines', () => {
    const result = parseConnectionLine('// this is a comment');
    expect(result).toEqual({ ok: false, reason: 'blank' });
  });

  it('rejects lines without an arrow', () => {
    const result = parseConnectionLine('A connects to B');
    expect(result).toEqual({ ok: false, reason: 'no_arrow' });
  });

  it('rejects lines with only a source', () => {
    const result = parseConnectionLine('A -->');
    expect(result).toEqual({ ok: false, reason: 'empty_side' });
  });

  it('handles labels with spaces and parens', () => {
    const result = parseConnectionLine(
      'nisa agent (background) --annotated json transcript--> transcript parser'
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.edge.sourceLabel).toBe('nisa agent (background)');
    expect(result.edge.targetLabel).toBe('transcript parser');
    expect(result.edge.edgeLabel).toBe('annotated json transcript');
  });

  it('preserves internal hyphens in component labels', () => {
    const result = parseConnectionLine('my-service --> other-service');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.edge.sourceLabel).toBe('my-service');
    expect(result.edge.targetLabel).toBe('other-service');
  });
});

describe('parseConnections', () => {
  const components: DetectedComponent[] = [
    { label: 'user uploads video', type: 'server' },
    { label: 'raw video', type: 'database' },
    { label: 'STT', type: 'server' },
    { label: 'nisa agent (background)', type: 'server' },
    { label: 'clip extractor', type: 'server' },
  ];

  it('parses a multi-line connection block', () => {
    const input = [
      'user uploads video --> raw video',
      'raw video --extracted audio--> STT',
      'STT --text transcript--> nisa agent (background)',
      'nisa agent (background) --> clip extractor',
    ].join('\n');
    const result = parseConnections(input, components);
    expect(result.errors).toEqual([]);
    expect(result.edges).toHaveLength(4);
    expect(result.edges[1].edgeLabel).toBe('extracted audio');
    expect(result.unusedComponents).toHaveLength(0);
  });

  it('flags unknown source components', () => {
    const result = parseConnections('mystery box --> STT', components);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toBe('unknown_source');
    expect(result.edges).toHaveLength(0);
  });

  it('flags unknown target components', () => {
    const result = parseConnections('STT --> mystery box', components);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toBe('unknown_target');
  });

  it('flags self-loops', () => {
    const result = parseConnections('STT --> STT', components);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toBe('self_loop');
  });

  it('flags lines missing arrows', () => {
    const result = parseConnections('STT connects to nisa agent', components);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toBe('no_arrow');
    expect(result.errors[0].lineNumber).toBe(1);
  });

  it('reports line numbers for errors in a multi-line block', () => {
    const input = [
      'user uploads video --> raw video',
      'not an edge line',
      'raw video --> STT',
    ].join('\n');
    const result = parseConnections(input, components);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].lineNumber).toBe(2);
    expect(result.edges).toHaveLength(2);
  });

  it('is case-insensitive and whitespace-tolerant on component labels', () => {
    const input = 'User   Uploads   Video   -->   RAW VIDEO';
    const result = parseConnections(input, components);
    expect(result.errors).toEqual([]);
    expect(result.edges).toHaveLength(1);
  });

  it('identifies unused components', () => {
    const input = 'user uploads video --> raw video';
    const result = parseConnections(input, components);
    expect(result.unusedComponents.map((c) => c.label)).toEqual([
      'STT',
      'nisa agent (background)',
      'clip extractor',
    ]);
  });

  it('ignores blank and comment lines', () => {
    const input = [
      '# Connections:',
      '',
      'user uploads video --> raw video',
      '// separator',
      'raw video --> STT',
    ].join('\n');
    const result = parseConnections(input, components);
    expect(result.errors).toEqual([]);
    expect(result.edges).toHaveLength(2);
  });
});

describe('buildCanonicalGraph', () => {
  const components: DetectedComponent[] = [
    { label: 'raw video', type: 'database' },
    { label: 'STT', type: 'server' },
    { label: 'nisa agent', type: 'server' },
  ];

  it('builds nodes in component order with type-indexed IDs', () => {
    const edges = [
      { sourceLabel: 'raw video', targetLabel: 'STT' },
      { sourceLabel: 'STT', targetLabel: 'nisa agent' },
    ];
    const graph = buildCanonicalGraph(components, edges);
    expect(graph.nodes).toHaveLength(3);
    expect(graph.nodes[0]).toEqual({ type: 'database', label: 'raw video' });
    expect(graph.edges).toEqual([
      { source: 'database-0', target: 'server-1' },
      { source: 'server-1', target: 'server-2' },
    ]);
  });

  it('skips edges with unknown labels silently (parseConnections should have caught them)', () => {
    const edges = [
      { sourceLabel: 'raw video', targetLabel: 'STT' },
      { sourceLabel: 'mystery', targetLabel: 'STT' },
    ];
    const graph = buildCanonicalGraph(components, edges);
    expect(graph.edges).toHaveLength(1);
  });

  it('handles case-insensitive label matching on edges', () => {
    const edges = [{ sourceLabel: 'RAW VIDEO', targetLabel: 'stt' }];
    const graph = buildCanonicalGraph(components, edges);
    expect(graph.edges).toEqual([{ source: 'database-0', target: 'server-1' }]);
  });
});

describe('formatConnectionsForDisplay', () => {
  it('round-trips simple edges', () => {
    const edges = [
      { sourceLabel: 'A', targetLabel: 'B' },
      { sourceLabel: 'B', targetLabel: 'C', edgeLabel: 'data' },
    ];
    expect(formatConnectionsForDisplay(edges)).toBe('A --> B\nB --data--> C');
  });

  it('returns empty string for no edges', () => {
    expect(formatConnectionsForDisplay([])).toBe('');
  });
});
