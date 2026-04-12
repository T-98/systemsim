// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import type { CanonicalGraph } from '../../types';
import { useStore } from '../index';

beforeEach(() => {
  useStore.setState({
    nodes: [],
    edges: [],
    undoStack: [],
    redoStack: [],
    graphVersion: 0,
    simulationStatus: 'idle',
    selectedNodeId: null,
    selectedEdgeId: null,
    configPanelOpen: false,
    liveMetrics: {},
    particles: [],
    liveLog: [],
  });
});

describe('replaceGraph', () => {
  it('replaces nodes and edges in a single operation', () => {
    const graph: CanonicalGraph = {
      nodes: [
        { type: 'load_balancer', label: 'LB' },
        { type: 'server', label: 'API' },
      ],
      edges: [{ source: 'load_balancer-0', target: 'server-1' }],
    };

    useStore.getState().replaceGraph(graph, { layout: 'preserve' });

    const state = useStore.getState();
    expect(state.nodes).toHaveLength(2);
    expect(state.edges).toHaveLength(1);
    expect(state.nodes[0].id).toBe('load_balancer-0');
    expect(state.nodes[1].id).toBe('server-1');
    expect(state.edges[0].source).toBe('load_balancer-0');
    expect(state.edges[0].target).toBe('server-1');
  });

  it('assigns canonical ids as type-index', () => {
    const graph: CanonicalGraph = {
      nodes: [
        { type: 'database', label: 'Primary DB' },
        { type: 'cache', label: 'Redis' },
        { type: 'database', label: 'Replica DB' },
      ],
      edges: [],
    };

    useStore.getState().replaceGraph(graph, { layout: 'preserve' });

    const ids = useStore.getState().nodes.map((n) => n.id);
    expect(ids).toEqual(['database-0', 'cache-1', 'database-2']);
  });

  it('merges config with defaults from COMPONENT_DEFS', () => {
    const graph: CanonicalGraph = {
      nodes: [
        { type: 'server', label: 'API', config: { instanceCount: 5 } },
      ],
      edges: [],
    };

    useStore.getState().replaceGraph(graph, { layout: 'preserve' });

    const config = useStore.getState().nodes[0].data.config;
    expect(config.instanceCount).toBe(5);
    expect(config.cpuProfile).toBe('medium');
  });

  it('uses defaults when no config provided', () => {
    const graph: CanonicalGraph = {
      nodes: [{ type: 'cache', label: 'Redis' }],
      edges: [],
    };

    useStore.getState().replaceGraph(graph, { layout: 'preserve' });

    const config = useStore.getState().nodes[0].data.config;
    expect(config.ttlSeconds).toBe(300);
    expect(config.evictionPolicy).toBe('lru');
  });

  it('preserves positions when layout is preserve', () => {
    const graph: CanonicalGraph = {
      nodes: [
        { type: 'server', label: 'API', position: { x: 100, y: 200 } },
      ],
      edges: [],
    };

    useStore.getState().replaceGraph(graph, { layout: 'preserve' });

    expect(useStore.getState().nodes[0].position).toEqual({ x: 100, y: 200 });
  });

  it('sets position to (0,0) when layout is auto (Dagre not yet installed)', () => {
    const graph: CanonicalGraph = {
      nodes: [
        { type: 'server', label: 'API', position: { x: 100, y: 200 } },
      ],
      edges: [],
    };

    useStore.getState().replaceGraph(graph, { layout: 'auto' });

    expect(useStore.getState().nodes[0].position).toEqual({ x: 0, y: 0 });
  });

  it('pushes exactly one undo snapshot', () => {
    useStore.setState({
      nodes: [{ id: 'old', type: 'simComponent', position: { x: 0, y: 0 }, data: {} as any }],
      edges: [],
    });

    const graph: CanonicalGraph = {
      nodes: [{ type: 'server', label: 'New' }],
      edges: [],
    };

    useStore.getState().replaceGraph(graph, { layout: 'preserve' });

    const state = useStore.getState();
    expect(state.undoStack).toHaveLength(1);
    expect(state.undoStack[0].nodes).toHaveLength(1);
    expect(state.undoStack[0].nodes[0].id).toBe('old');
  });

  it('undo restores previous graph', () => {
    useStore.setState({
      nodes: [{ id: 'original', type: 'simComponent', position: { x: 0, y: 0 }, data: {} as any }],
      edges: [],
    });

    const graph: CanonicalGraph = {
      nodes: [{ type: 'server', label: 'Replaced' }],
      edges: [],
    };

    useStore.getState().replaceGraph(graph, { layout: 'preserve' });
    expect(useStore.getState().nodes[0].id).toBe('server-0');

    useStore.getState().undo();
    expect(useStore.getState().nodes[0].id).toBe('original');
  });

  it('bumps graphVersion', () => {
    expect(useStore.getState().graphVersion).toBe(0);

    useStore.getState().replaceGraph({ nodes: [], edges: [] }, { layout: 'preserve' });
    expect(useStore.getState().graphVersion).toBe(1);

    useStore.getState().replaceGraph({ nodes: [], edges: [] }, { layout: 'preserve' });
    expect(useStore.getState().graphVersion).toBe(2);
  });

  it('clears selection and config panel', () => {
    useStore.setState({
      selectedNodeId: 'some-node',
      selectedEdgeId: 'some-edge',
      configPanelOpen: true,
    });

    useStore.getState().replaceGraph({ nodes: [], edges: [] }, { layout: 'preserve' });

    const state = useStore.getState();
    expect(state.selectedNodeId).toBeNull();
    expect(state.selectedEdgeId).toBeNull();
    expect(state.configPanelOpen).toBe(false);
  });

  it('clears simulation derived state', () => {
    useStore.setState({
      liveMetrics: { 'comp-1': { rps: 100 } as any },
      particles: [{ id: 'p1' } as any],
      liveLog: [{ time: 0, message: 'test', severity: 'info' }],
    });

    useStore.getState().replaceGraph({ nodes: [], edges: [] }, { layout: 'preserve' });

    const state = useStore.getState();
    expect(state.liveMetrics).toEqual({});
    expect(state.particles).toEqual([]);
    expect(state.liveLog).toEqual([]);
  });

  it('resets simulation if running', () => {
    useStore.setState({ simulationStatus: 'running' });

    useStore.getState().replaceGraph({
      nodes: [{ type: 'server', label: 'API' }],
      edges: [],
    }, { layout: 'preserve' });

    expect(useStore.getState().simulationStatus).toBe('idle');
    expect(useStore.getState().nodes).toHaveLength(1);
  });

  it('handles duplicate types wired together', () => {
    const graph: CanonicalGraph = {
      nodes: [
        { type: 'server', label: 'API Server' },
        { type: 'server', label: 'Worker Server' },
        { type: 'database', label: 'Primary DB' },
      ],
      edges: [
        { source: 'server-0', target: 'database-2' },
        { source: 'server-1', target: 'database-2' },
      ],
    };

    useStore.getState().replaceGraph(graph, { layout: 'preserve' });

    const state = useStore.getState();
    expect(state.nodes).toHaveLength(3);
    expect(state.nodes[0].data.label).toBe('API Server');
    expect(state.nodes[1].data.label).toBe('Worker Server');
    expect(state.edges).toHaveLength(2);
    expect(state.edges[0].source).toBe('server-0');
    expect(state.edges[0].target).toBe('database-2');
    expect(state.edges[1].source).toBe('server-1');
    expect(state.edges[1].target).toBe('database-2');
  });

  it('applies wire config defaults', () => {
    const graph: CanonicalGraph = {
      nodes: [
        { type: 'load_balancer', label: 'LB' },
        { type: 'server', label: 'API' },
      ],
      edges: [{ source: 'load_balancer-0', target: 'server-1', config: { throughputRps: 50000 } }],
    };

    useStore.getState().replaceGraph(graph, { layout: 'preserve' });

    const wire = useStore.getState().edges[0];
    expect(wire.data!.config.throughputRps).toBe(50000);
    expect(wire.data!.config.latencyMs).toBe(2);
    expect(wire.data!.config.jitterMs).toBe(1);
  });
});

describe('session save → load round-trip (IRON RULE)', () => {
  it('preserves wires through save → load cycle', () => {
    const graph: CanonicalGraph = {
      nodes: [
        { type: 'load_balancer', label: 'LB', position: { x: 100, y: 50 } },
        { type: 'server', label: 'API', position: { x: 300, y: 50 } },
        { type: 'database', label: 'DB', position: { x: 500, y: 50 } },
      ],
      edges: [
        { source: 'load_balancer-0', target: 'server-1' },
        { source: 'server-1', target: 'database-2' },
      ],
    };

    useStore.getState().replaceGraph(graph, { layout: 'preserve' });

    // Simulate what Toolbar.handleSave produces
    const state = useStore.getState();
    const savedSession = {
      systemsimVersion: '1.0',
      mode: 'freeform',
      scenarioId: null,
      componentGraph: {
        components: state.nodes.map((n) => ({
          id: n.id,
          type: n.data.type,
          label: n.data.label,
          position: n.position,
          config: n.data.config,
        })),
        wires: state.edges.map((e) => ({
          id: e.id,
          from: { componentId: e.source, port: 'output' },
          to: { componentId: e.target, port: 'input' },
          config: e.data?.config,
        })),
      },
    };

    // Clear state
    useStore.setState({ nodes: [], edges: [] });
    expect(useStore.getState().edges).toHaveLength(0);

    // Simulate loadSessionFromJson logic
    const s = savedSession as any;
    const components = s.componentGraph.components;
    const wires = s.componentGraph.wires ?? [];

    const idByOriginal = new Map<string, number>();
    const canonicalNodes = components.map((comp: any, i: number) => {
      idByOriginal.set(comp.id, i);
      return { type: comp.type, label: comp.label, position: comp.position, config: comp.config };
    });

    const canonicalEdges = wires
      .filter((w: any) => idByOriginal.has(w.from.componentId) && idByOriginal.has(w.to.componentId))
      .map((w: any) => {
        const srcIdx = idByOriginal.get(w.from.componentId)!;
        const tgtIdx = idByOriginal.get(w.to.componentId)!;
        return {
          source: `${canonicalNodes[srcIdx].type}-${srcIdx}`,
          target: `${canonicalNodes[tgtIdx].type}-${tgtIdx}`,
          config: w.config,
        };
      });

    useStore.getState().replaceGraph({ nodes: canonicalNodes, edges: canonicalEdges }, { layout: 'preserve' });

    // IRON RULE: wires survive
    const loaded = useStore.getState();
    expect(loaded.nodes).toHaveLength(3);
    expect(loaded.edges).toHaveLength(2);
    expect(loaded.edges[0].source).toBe('load_balancer-0');
    expect(loaded.edges[0].target).toBe('server-1');
    expect(loaded.edges[1].source).toBe('server-1');
    expect(loaded.edges[1].target).toBe('database-2');
  });

  it('preserves positions through save → load cycle', () => {
    const graph: CanonicalGraph = {
      nodes: [
        { type: 'server', label: 'API', position: { x: 42, y: 99 } },
      ],
      edges: [],
    };

    useStore.getState().replaceGraph(graph, { layout: 'preserve' });

    const state = useStore.getState();
    const saved = {
      componentGraph: {
        components: state.nodes.map((n) => ({
          id: n.id, type: n.data.type, label: n.data.label,
          position: n.position, config: n.data.config,
        })),
        wires: [],
      },
    };

    useStore.setState({ nodes: [], edges: [] });

    const comps = saved.componentGraph.components;
    const idMap = new Map<string, number>();
    const cNodes = comps.map((c: any, i: number) => {
      idMap.set(c.id, i);
      return { type: c.type, label: c.label, position: c.position, config: c.config };
    });

    useStore.getState().replaceGraph({ nodes: cNodes, edges: [] }, { layout: 'preserve' });

    expect(useStore.getState().nodes[0].position).toEqual({ x: 42, y: 99 });
  });
});
