import { create } from 'zustand';
import {
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type Connection,
  applyNodeChanges,
  applyEdgeChanges,
} from '@xyflow/react';
import { v4 as uuid } from 'uuid';
import type {
  SimComponentData,
  WireConfig,
  SchemaMemoryBlock,
  NFR,
  ApiContract,
  SimulationRun,
  SimulationStatus,
  ViewMode,
  AppMode,
  AppView,
  TrafficProfile,
  Particle,
  LogEntry,
  HintMessage,
  ComponentMetrics,
  HealthState,
  AIDebrief,
  CanonicalGraph,
} from '../types';
import { COMPONENT_DEFS } from '../types/components';
import type { ComponentType } from '../types';
import { layoutGraph } from '../layout/dagre';

const emptyMetrics: ComponentMetrics = {
  rps: 0,
  p50: 0,
  p95: 0,
  p99: 0,
  errorRate: 0,
  cpuPercent: 0,
  memoryPercent: 0,
};

export interface AppState {
  // App
  appMode: AppMode;
  appView: AppView;
  scenarioId: string | null;
  theme: 'light' | 'dark';
  setAppMode: (mode: AppMode) => void;
  setAppView: (view: AppView) => void;
  setScenarioId: (id: string | null) => void;
  setTheme: (theme: 'light' | 'dark') => void;
  toggleTheme: () => void;

  // Canvas
  nodes: Node<SimComponentData>[];
  edges: Edge<{ config: WireConfig }>[];
  onNodesChange: OnNodesChange<Node<SimComponentData>>;
  onEdgesChange: OnEdgesChange<Edge<{ config: WireConfig }>>;
  onConnect: (connection: Connection) => void;
  addComponent: (type: ComponentType, position?: { x: number; y: number }) => string;
  removeComponent: (id: string) => void;
  updateComponentConfig: (id: string, config: Record<string, unknown>) => void;
  updateComponentLabel: (id: string, label: string) => void;
  updateWireConfig: (id: string, config: Partial<WireConfig>) => void;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  setSelectedNodeId: (id: string | null) => void;
  setSelectedEdgeId: (id: string | null) => void;

  // Design flow
  functionalReqs: string[];
  nonFunctionalReqs: NFR[];
  apiContracts: ApiContract[];
  setFunctionalReqs: (reqs: string[]) => void;
  setNonFunctionalReqs: (reqs: NFR[]) => void;
  setApiContracts: (contracts: ApiContract[]) => void;

  // Schema
  schemaMemory: SchemaMemoryBlock | null;
  schemaHistory: SchemaMemoryBlock[];
  schemaInput: string;
  setSchemaInput: (input: string) => void;
  setSchemaMemory: (schema: SchemaMemoryBlock) => void;
  revertSchema: (version: number) => void;

  // Simulation
  simulationStatus: SimulationStatus;
  simulationTime: number;
  simulationSpeed: number;
  viewMode: ViewMode;
  particles: Particle[];
  liveLog: LogEntry[];
  liveMetrics: Record<string, ComponentMetrics>;
  setSimulationStatus: (status: SimulationStatus) => void;
  setSimulationTime: (time: number) => void;
  setSimulationSpeed: (speed: number) => void;
  setViewMode: (mode: ViewMode) => void;
  setParticles: (particles: Particle[]) => void;
  addLogEntry: (entry: LogEntry) => void;
  clearLiveLog: () => void;
  updateLiveMetrics: (componentId: string, metrics: Partial<ComponentMetrics>) => void;
  updateComponentHealth: (componentId: string, health: HealthState) => void;
  resetSimulationState: () => void;

  // Traffic
  trafficProfile: TrafficProfile | null;
  setTrafficProfile: (profile: TrafficProfile) => void;

  // Runs
  simulationRuns: SimulationRun[];
  currentRunId: string | null;
  addSimulationRun: (run: SimulationRun) => void;
  setCurrentRunId: (id: string | null) => void;

  // AI Debrief
  debrief: AIDebrief | null;
  debriefVisible: boolean;
  debriefLoading: boolean;
  setDebrief: (debrief: AIDebrief | null) => void;
  setDebriefVisible: (visible: boolean) => void;
  setDebriefLoading: (loading: boolean) => void;

  // Hints
  hints: HintMessage[];
  addHint: (message: string) => void;
  dismissHint: (id: string) => void;

  // Config panel
  configPanelOpen: boolean;
  setConfigPanelOpen: (open: boolean) => void;

  // Log panel
  logPanelExpanded: boolean;
  setLogPanelExpanded: (expanded: boolean) => void;

  // Graph versioning
  graphVersion: number;

  // Replace entire graph (transactional, single undo op)
  replaceGraph: (graph: CanonicalGraph, options: { layout: 'auto' | 'preserve' }) => void;

  // Undo/Redo
  undoStack: { nodes: Node<SimComponentData>[]; edges: Edge<{ config: WireConfig }>[] }[];
  redoStack: { nodes: Node<SimComponentData>[]; edges: Edge<{ config: WireConfig }>[] }[];
  pushUndo: () => void;
  undo: () => void;
  redo: () => void;
}

export const useStore = create<AppState>((set, get) => ({
  // App
  appMode: 'scenario',
  appView: 'landing',
  scenarioId: null,
  theme: (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') as 'light' | 'dark',
  setAppMode: (mode) => set({ appMode: mode }),
  setAppView: (view) => set({ appView: view }),
  setScenarioId: (id) => set({ scenarioId: id }),
  setTheme: (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    set({ theme });
  },
  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark';
    document.documentElement.classList.toggle('dark', next === 'dark');
    set({ theme: next });
  },

  // Canvas
  nodes: [],
  edges: [],
  onNodesChange: (changes) => {
    set({ nodes: applyNodeChanges(changes, get().nodes) as Node<SimComponentData>[] });
  },
  onEdgesChange: (changes) => {
    set({ edges: applyEdgeChanges(changes, get().edges) as Edge<{ config: WireConfig }>[] });
  },
  onConnect: (connection) => {
    const { pushUndo } = get();
    pushUndo();
    const edge: Edge<{ config: WireConfig }> = {
      id: `wire-${uuid()}`,
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle ?? undefined,
      targetHandle: connection.targetHandle ?? undefined,
      type: 'simWire',
      animated: false,
      data: {
        config: { throughputRps: 10000, latencyMs: 2, jitterMs: 1 },
      },
    };
    set({ edges: [...get().edges, edge] });
  },
  addComponent: (type, position) => {
    const { pushUndo } = get();
    pushUndo();
    const def = COMPONENT_DEFS[type];
    const id = `${type}-${uuid().slice(0, 8)}`;
    const existingCount = get().nodes.length;
    const col = existingCount % 4;
    const row = Math.floor(existingCount / 4);
    const node: Node<SimComponentData> = {
      id,
      type: 'simComponent',
      position: position ?? { x: 300 + col * 250, y: 100 + row * 160 },
      data: {
        type,
        label: def.label,
        config: { ...def.defaultConfig },
        health: 'healthy',
        metrics: { ...emptyMetrics },
      },
    };
    set({ nodes: [...get().nodes, node] });
    return id;
  },
  removeComponent: (id) => {
    const { pushUndo } = get();
    pushUndo();
    set({
      nodes: get().nodes.filter((n) => n.id !== id),
      edges: get().edges.filter((e) => e.source !== id && e.target !== id),
      selectedNodeId: get().selectedNodeId === id ? null : get().selectedNodeId,
    });
  },
  updateComponentConfig: (id, config) => {
    set({
      nodes: get().nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, config: { ...n.data.config, ...config } } } : n
      ),
    });
  },
  updateComponentLabel: (id, label) => {
    set({
      nodes: get().nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, label } } : n
      ),
    });
  },
  updateWireConfig: (id, config) => {
    set({
      edges: get().edges.map((e) =>
        e.id === id ? { ...e, data: { config: { ...e.data!.config, ...config } } } : e
      ),
    });
  },
  selectedNodeId: null,
  selectedEdgeId: null,
  setSelectedNodeId: (id) => set({ selectedNodeId: id, selectedEdgeId: null, configPanelOpen: id !== null }),
  setSelectedEdgeId: (id) => set({ selectedEdgeId: id, selectedNodeId: null, configPanelOpen: id !== null }),

  // Design flow
  functionalReqs: [],
  nonFunctionalReqs: [],
  apiContracts: [],
  setFunctionalReqs: (reqs) => set({ functionalReqs: reqs }),
  setNonFunctionalReqs: (reqs) => set({ nonFunctionalReqs: reqs }),
  setApiContracts: (contracts) => set({ apiContracts: contracts }),

  // Schema
  schemaMemory: null,
  schemaHistory: [],
  schemaInput: '',
  setSchemaInput: (input) => set({ schemaInput: input }),
  setSchemaMemory: (schema) => {
    const history = get().schemaHistory;
    set({ schemaMemory: schema, schemaHistory: [...history, schema] });
  },
  revertSchema: (version) => {
    const history = get().schemaHistory;
    const target = history.find((s) => s.version === version);
    if (target) set({ schemaMemory: target });
  },

  // Simulation
  simulationStatus: 'idle',
  simulationTime: 0,
  simulationSpeed: 5,
  viewMode: 'particle',
  particles: [],
  liveLog: [],
  liveMetrics: {},
  setSimulationStatus: (status) => set({ simulationStatus: status }),
  setSimulationTime: (time) => set({ simulationTime: time }),
  setSimulationSpeed: (speed) => set({ simulationSpeed: speed }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setParticles: (particles) => set({ particles }),
  addLogEntry: (entry) => set({ liveLog: [...get().liveLog, entry] }),
  clearLiveLog: () => set({ liveLog: [] }),
  updateLiveMetrics: (componentId, metrics) => {
    const current = get().liveMetrics[componentId] ?? { ...emptyMetrics };
    set({
      liveMetrics: {
        ...get().liveMetrics,
        [componentId]: { ...current, ...metrics },
      },
    });
  },
  updateComponentHealth: (componentId, health) => {
    set({
      nodes: get().nodes.map((n) =>
        n.id === componentId ? { ...n, data: { ...n.data, health } } : n
      ),
    });
  },
  resetSimulationState: () => {
    set({
      simulationStatus: 'idle',
      simulationTime: 0,
      particles: [],
      liveLog: [],
      liveMetrics: {},
      debrief: null,
      debriefVisible: false,
      debriefLoading: false,
    });
    // Reset all node health
    set({
      nodes: get().nodes.map((n) => ({
        ...n,
        data: { ...n.data, health: 'healthy' as HealthState, metrics: { ...emptyMetrics } },
      })),
    });
  },

  // Traffic
  trafficProfile: null,
  setTrafficProfile: (profile) => set({ trafficProfile: profile }),

  // Runs
  simulationRuns: [],
  currentRunId: null,
  addSimulationRun: (run) => set({ simulationRuns: [...get().simulationRuns, run] }),
  setCurrentRunId: (id) => set({ currentRunId: id }),

  // AI Debrief
  debrief: null,
  debriefVisible: false,
  debriefLoading: false,
  setDebrief: (debrief) => set({ debrief }),
  setDebriefVisible: (visible) => set({ debriefVisible: visible }),
  setDebriefLoading: (loading) => set({ debriefLoading: loading }),

  // Hints
  hints: [],
  addHint: (message) => {
    const existing = get().hints;
    if (existing.length >= 2) return;
    if (existing.some((h) => h.message === message)) return;
    set({ hints: [...existing, { id: uuid(), message, dismissed: false }] });
  },
  dismissHint: (id) => {
    set({ hints: get().hints.map((h) => (h.id === id ? { ...h, dismissed: true } : h)) });
  },

  // Config panel
  configPanelOpen: false,
  setConfigPanelOpen: (open) => set({ configPanelOpen: open }),

  // Log panel
  logPanelExpanded: false,
  setLogPanelExpanded: (expanded) => set({ logPanelExpanded: expanded }),

  // Graph versioning
  graphVersion: 0,

  // Replace entire graph (transactional, single undo op)
  replaceGraph: (graph, options) => {
    const state = get();

    // R3.1: halt simulation if running
    if (state.simulationStatus !== 'idle') {
      state.resetSimulationState();
    }

    // R3.5: push ONE undo snapshot (force push even during sim, since we just reset)
    const undoSnapshot = {
      nodes: structuredClone(state.nodes),
      edges: structuredClone(state.edges),
    };

    // R3.2 + R3.3: build canonical nodes and edges
    const newNodes: Node<SimComponentData>[] = graph.nodes.map((cn, i) => {
      const def = COMPONENT_DEFS[cn.type];
      const id = `${cn.type}-${i}`;
      return {
        id,
        type: 'simComponent',
        position: (options.layout === 'preserve' && cn.position) ? cn.position : { x: 0, y: 0 },
        data: {
          type: cn.type,
          label: cn.label,
          config: cn.config ? { ...def.defaultConfig, ...cn.config } : { ...def.defaultConfig },
          health: 'healthy' as HealthState,
          metrics: { ...emptyMetrics },
        },
      };
    });

    const newEdges: Edge<{ config: WireConfig }>[] = graph.edges.map((ce, i) => ({
      id: `edge-${i}`,
      source: ce.source,
      target: ce.target,
      type: 'simWire',
      animated: false,
      data: {
        config: {
          throughputRps: ce.config?.throughputRps ?? 10000,
          latencyMs: ce.config?.latencyMs ?? 2,
          jitterMs: ce.config?.jitterMs ?? 1,
        },
      },
    }));

    // Run Dagre auto-layout before set() to avoid flash at (0,0)
    const finalNodes = options.layout === 'auto'
      ? layoutGraph(newNodes, newEdges)
      : newNodes;

    // R3.4 + R3.6: single atomic state update
    set({
      // Graph
      nodes: finalNodes,
      edges: newEdges,
      graphVersion: state.graphVersion + 1,
      // Clear selection + panels
      selectedNodeId: null,
      selectedEdgeId: null,
      configPanelOpen: false,
      // Clear simulation derived state
      liveMetrics: {},
      particles: [],
      liveLog: [],
      // Undo stack
      undoStack: [...state.undoStack.slice(-49), undoSnapshot],
      redoStack: [],
    });
  },

  // Undo/Redo
  undoStack: [],
  redoStack: [],
  pushUndo: () => {
    const { nodes, edges, undoStack, simulationStatus } = get();
    // Skip undo snapshots during simulation to prevent history pollution
    if (simulationStatus !== 'idle') return;
    set({
      undoStack: [...undoStack.slice(-49), { nodes: structuredClone(nodes), edges: structuredClone(edges) }],
      redoStack: [],
    });
  },
  undo: () => {
    const { undoStack, nodes, edges } = get();
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    set({
      undoStack: undoStack.slice(0, -1),
      redoStack: [...get().redoStack, { nodes: structuredClone(nodes), edges: structuredClone(edges) }],
      nodes: prev.nodes,
      edges: prev.edges,
    });
  },
  redo: () => {
    const { redoStack, nodes, edges } = get();
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    set({
      redoStack: redoStack.slice(0, -1),
      undoStack: [...get().undoStack, { nodes: structuredClone(nodes), edges: structuredClone(edges) }],
      nodes: next.nodes,
      edges: next.edges,
    });
  },
}));
