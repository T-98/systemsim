export type ComponentType =
  | 'load_balancer'
  | 'api_gateway'
  | 'server'
  | 'cache'
  | 'queue'
  | 'database'
  | 'websocket_gateway'
  | 'fanout'
  | 'cdn'
  | 'external'
  | 'autoscaler';

export type ComponentCategory = 'ingress' | 'compute' | 'data' | 'messaging' | 'delivery' | 'external';

export interface ComponentDef {
  type: ComponentType;
  label: string;
  category: ComponentCategory;
  description: string;
  shortcut: string;
  defaultConfig: Record<string, unknown>;
  categoryColor: string;
}

export type HealthState = 'healthy' | 'warning' | 'critical' | 'crashed';

export interface SimComponentData {
  type: ComponentType;
  label: string;
  config: Record<string, unknown>;
  health: HealthState;
  metrics: ComponentMetrics;
}

export interface ComponentMetrics {
  rps: number;
  p50: number;
  p95: number;
  p99: number;
  errorRate: number;
  cpuPercent: number;
  memoryPercent: number;
  queueDepth?: number;
  cacheHitRate?: number;
  activeConnections?: number;
  shardDistribution?: number[];
}

export interface WireConfig {
  throughputRps: number;
  latencyMs: number;
  jitterMs: number;
}

export interface TrafficPhase {
  startS: number;
  endS: number;
  rps: number;
  shape: 'steady' | 'spike' | 'instant_spike' | 'ramp_down' | 'ramp_up';
  description: string;
}

export interface TrafficProfile {
  profileName: string;
  durationSeconds: number;
  phases: TrafficPhase[];
  requestMix: Record<string, number>;
  userDistribution: 'uniform' | 'pareto';
  jitterPercent: number;
  largeServerConcentration?: number;
}

export interface NFR {
  attribute: string;
  target: string;
  scope: string;
}

export type AuthMode = 'none' | 'jwt' | 'oauth';

export interface ApiContract {
  id: string;
  method: string;
  path: string;
  description: string;
  authMode: AuthMode;
  ownerServiceId: string | null;
}

export interface SchemaField {
  name: string;
  type: string;
  cardinality: 'low' | 'medium' | 'high';
  notes?: string;
}

export interface SchemaIndex {
  field: string;
  type: 'btree' | 'hash' | 'composite';
}

export interface AccessPattern {
  operation: 'read' | 'write';
  frequency: 'low' | 'medium' | 'high' | 'very_high';
  pattern: string;
}

export interface SchemaEntity {
  id: string;
  name: string;
  fields: SchemaField[];
  indexes: SchemaIndex[];
  partitionKey?: string;
  partitionKeyCardinalityWarning?: boolean;
  accessPatterns: AccessPattern[];
  assignedDbId: string | null;
}

export interface TableAccess {
  tableId: string;
  mode: 'read' | 'write' | 'read_write';
  indexed: boolean;
}

export interface EndpointRoute {
  endpointId: string;
  componentChain: string[];
  tablesAccessed: TableAccess[];
  weight: number;
  estimatedPayloadBytes: number;
}

export interface SchemaRelationship {
  from: string;
  to: string;
  type: 'one_to_one' | 'one_to_many' | 'many_to_one' | 'many_to_many';
}

export interface SchemaMemoryBlock {
  version: number;
  entities: SchemaEntity[];
  relationships: SchemaRelationship[];
  aiNotes: string;
}

export interface SimulationRun {
  runId: string;
  timestamp: string;
  schemaVersion: number;
  trafficProfile: TrafficProfile;
  metricsTimeSeries: Record<string, ComponentMetrics[]>;
  log: LogEntry[];
  aiDebrief?: AIDebrief;
  scores?: Scores;
}

export interface LogEntry {
  time: number;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  componentId?: string;
}

export interface AIDebrief {
  summary: string;
  questions: string[];
  aiQuestions?: string[];
  flags: string[];
  scores: Scores;
  aiAvailable: boolean;
}

export interface Scores {
  coherence: number;
  security: number;
  performance: number;
}

export interface SessionFile {
  systemsimVersion: string;
  mode: 'scenario' | 'freeform';
  scenarioId: string | null;
  intent: string | null;
  session: {
    createdAt: string;
    lastModified: string;
  };
  design: {
    requirements: {
      functional: string[];
      nonFunctional: NFR[];
    };
    apiContracts: ApiContract[];
    endpointRoutes: EndpointRoute[];
    schemaMemory: SchemaMemoryBlock | null;
    schemaHistory: SchemaMemoryBlock[];
  };
  simulationRuns: SimulationRun[];
}

export interface CanonicalNode {
  type: ComponentType;
  label: string;
  position?: { x: number; y: number };
  config?: Record<string, unknown>;
}

export interface CanonicalEdge {
  source: string;
  target: string;
  config?: Partial<WireConfig>;
}

export interface CanonicalGraph {
  nodes: CanonicalNode[];
  edges: CanonicalEdge[];
}

export type SimulationStatus = 'idle' | 'running' | 'paused' | 'completed';
export type ViewMode = 'particle' | 'aggregate';
export type AppMode = 'scenario' | 'freeform';
export type AppView = 'landing' | 'design' | 'review' | 'canvas';

export interface Particle {
  id: string;
  wireId: string;
  progress: number;
  speed: number;
  status: 'in_flight' | 'success' | 'error';
}

export interface HintMessage {
  id: string;
  message: string;
  dismissed: boolean;
}

export type PreflightTarget = 'traffic' | 'design' | 'canvas' | 'config';
export type PreflightSubtab = 'api' | 'schema';

export interface PreflightItem {
  id: string;
  message: string;
  tooltip: string;
  target: PreflightTarget;
  targetSubtab?: PreflightSubtab;
  targetComponentId?: string;
}

export interface PreflightResult {
  errors: PreflightItem[];
  warnings: PreflightItem[];
}
