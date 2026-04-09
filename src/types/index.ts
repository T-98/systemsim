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

export interface ApiContract {
  method: string;
  path: string;
  description: string;
  auth: boolean;
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
  name: string;
  fields: SchemaField[];
  indexes: SchemaIndex[];
  partitionKey?: string;
  partitionKeyCardinalityWarning?: boolean;
  accessPatterns: AccessPattern[];
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
    schemaMemory: SchemaMemoryBlock | null;
    schemaHistory: SchemaMemoryBlock[];
  };
  simulationRuns: SimulationRun[];
}

export type SimulationStatus = 'idle' | 'running' | 'paused' | 'completed';
export type ViewMode = 'particle' | 'aggregate';
export type AppMode = 'scenario' | 'freeform';
export type AppView = 'landing' | 'design' | 'canvas';

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
