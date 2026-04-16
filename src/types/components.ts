/**
 * @file types/components.ts
 *
 * Component registry. Single source of truth for every component type's
 * display metadata (label, icon category, keyboard shortcut, color) and
 * default config (instance count, processing time, pool size, etc.).
 *
 * `MVP_VISIBLE_TYPES` filters ComponentLibrary and keyboard shortcuts to a
 * focused 6-type subset. Hidden types still work in the engine and can be
 * loaded from templates or session files. See Decisions.md #13.
 *
 * Adding a new component type? Three places:
 * 1. Add to `ComponentType` union in types/index.ts
 * 2. Add entry to `COMPONENT_DEFS` here
 * 3. Add `processX` handler in SimulationEngine.ts
 */

import type { ComponentDef, ComponentType, ComponentCategory } from './index';

export const CATEGORY_COLORS: Record<ComponentCategory, string> = {
  ingress: '#3B82F6',
  compute: '#8B5CF6',
  data: '#10B981',
  messaging: '#F59E0B',
  delivery: '#EC4899',
  external: '#6B7280',
};

export const COMPONENT_DEFS: Record<ComponentType, ComponentDef> = {
  load_balancer: {
    type: 'load_balancer',
    label: 'Load Balancer',
    category: 'ingress',
    description: 'Distributes traffic across instances',
    shortcut: 'L',
    categoryColor: CATEGORY_COLORS.ingress,
    defaultConfig: {
      algorithm: 'round-robin',
      healthCheckInterval: 10000,
      healthCheckTimeout: 3000,
      unhealthyThreshold: 3,
    },
  },
  api_gateway: {
    type: 'api_gateway',
    label: 'API Gateway',
    category: 'ingress',
    description: 'Rate limiting, auth, routing',
    shortcut: 'G',
    categoryColor: CATEGORY_COLORS.ingress,
    defaultConfig: {
      rateLimitRps: 10000,
      rateLimitBurst: 1000,
      authMiddleware: 'none',
      timeout: 30000,
    },
  },
  server: {
    type: 'server',
    label: 'Server / Worker',
    category: 'compute',
    description: 'Processes requests with CPU/memory',
    shortcut: 'S',
    categoryColor: CATEGORY_COLORS.compute,
    defaultConfig: {
      cpuProfile: 'medium',
      memoryProfile: 'medium',
      maxConcurrent: 1000,
      processingTimeMs: 50,
      processingJitterMs: 20,
      instanceCount: 3,
    },
  },
  cache: {
    type: 'cache',
    label: 'Cache',
    category: 'data',
    description: 'In-memory caching (Redis-like)',
    shortcut: 'H',
    categoryColor: CATEGORY_COLORS.data,
    defaultConfig: {
      evictionPolicy: 'lru',
      ttlSeconds: 300,
      maxMemoryMb: 1024,
      writeStrategy: 'write-through',
    },
  },
  queue: {
    type: 'queue',
    label: 'Message Queue',
    category: 'messaging',
    description: 'Async message processing',
    shortcut: 'Q',
    categoryColor: CATEGORY_COLORS.messaging,
    defaultConfig: {
      maxDepth: 10000000,
      consumerGroupCount: 1,
      consumersPerGroup: 5,
      processingTimeMs: 10,
      dlqEnabled: false,
      retryCount: 3,
    },
  },
  database: {
    type: 'database',
    label: 'Database',
    category: 'data',
    description: 'Persistent storage with sharding',
    shortcut: 'D',
    categoryColor: CATEGORY_COLORS.data,
    defaultConfig: {
      engine: 'postgres',
      shardingEnabled: false,
      shardKey: '',
      shardCount: 1,
      readReplicas: 0,
      replicationLagMs: 10,
      consistencyModel: 'strong',
      indexes: [],
      readThroughputRps: 50000,
      writeThroughputRps: 20000,
      connectionPoolSize: 100,
    },
  },
  websocket_gateway: {
    type: 'websocket_gateway',
    label: 'WebSocket Gateway',
    category: 'delivery',
    description: 'Persistent connections for real-time',
    shortcut: 'W',
    categoryColor: CATEGORY_COLORS.delivery,
    defaultConfig: {
      maxConnections: 100000,
      heartbeatInterval: 30000,
      connectionTimeout: 60000,
    },
  },
  fanout: {
    type: 'fanout',
    label: 'Fan-out Service',
    category: 'compute',
    description: 'Multiplies messages to N downstream',
    shortcut: 'F',
    categoryColor: CATEGORY_COLORS.compute,
    defaultConfig: {
      multiplier: 500000,
      deliveryMode: 'parallel',
      timeoutPerDownstream: 5000,
    },
  },
  cdn: {
    type: 'cdn',
    label: 'CDN',
    category: 'delivery',
    description: 'Edge caching and content delivery',
    shortcut: 'N',
    categoryColor: CATEGORY_COLORS.delivery,
    defaultConfig: {
      cacheHitRate: 0.9,
      originPullLatencyMs: 200,
      regions: ['us-east', 'us-west', 'eu-west'],
    },
  },
  external: {
    type: 'external',
    label: 'External Service',
    category: 'external',
    description: 'Third-party API dependency',
    shortcut: 'E',
    categoryColor: CATEGORY_COLORS.external,
    defaultConfig: {
      name: 'External API',
      latencyMs: 100,
      errorRate: 0.01,
      timeout: 5000,
    },
  },
  autoscaler: {
    type: 'autoscaler',
    label: 'Autoscaler',
    category: 'compute',
    description: 'Auto-scales attached instances',
    shortcut: 'A',
    categoryColor: CATEGORY_COLORS.compute,
    defaultConfig: {
      targetCpuThreshold: 70,
      minInstances: 1,
      maxInstances: 20,
      cooldownSeconds: 60,
      scaleUpDelaySeconds: 30,
    },
  },
};

// MVP: only show these 6 types in the component library. Hidden types still work in engine/sessions.
export const MVP_VISIBLE_TYPES: Set<ComponentType> = new Set([
  'load_balancer', 'server', 'database', 'cache', 'queue', 'fanout',
]);

export const COMPONENT_CATEGORIES: { name: ComponentCategory; label: string; types: ComponentType[] }[] = [
  { name: 'ingress', label: 'Ingress', types: ['load_balancer', 'api_gateway'] },
  { name: 'compute', label: 'Compute', types: ['server', 'fanout', 'autoscaler'] },
  { name: 'data', label: 'Data', types: ['database', 'cache'] },
  { name: 'messaging', label: 'Messaging', types: ['queue'] },
  { name: 'delivery', label: 'Delivery', types: ['websocket_gateway', 'cdn'] },
  { name: 'external', label: 'External', types: ['external'] },
];
