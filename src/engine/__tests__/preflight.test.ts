import { describe, it, expect } from 'vitest';
import { runPreflight } from '../preflight';
import type { SchemaMemoryBlock } from '../../types';

function makeNode(id: string, type: string, label: string, config: Record<string, unknown> = {}) {
  return { id, data: { type, label, config } };
}

const baseSchema: SchemaMemoryBlock = {
  version: 1,
  entities: [
    { id: 'e1', name: 'users', fields: [{ name: 'id', type: 'uuid', cardinality: 'high' }], indexes: [{ field: 'id', type: 'btree' }], accessPatterns: [], assignedDbId: 'db1' },
  ],
  relationships: [],
  aiNotes: '',
};

describe('preflight errors', () => {
  it('flags no traffic profile', () => {
    const result = runPreflight({
      nodes: [makeNode('n1', 'server', 'Server')],
      edges: [],
      trafficProfile: null,
      schemaMemory: null,
      apiContracts: [],
      endpointRoutes: [],
    });
    expect(result.errors.some((e) => e.id === 'no-traffic')).toBe(true);
  });

  it('flags no entry point when all nodes have incoming edges', () => {
    const result = runPreflight({
      nodes: [makeNode('a', 'server', 'A'), makeNode('b', 'server', 'B')],
      edges: [{ source: 'a', target: 'b' }, { source: 'b', target: 'a' }],
      trafficProfile: null,
      schemaMemory: null,
      apiContracts: [],
      endpointRoutes: [],
    });
    expect(result.errors.some((e) => e.id === 'no-entry')).toBe(true);
  });

  it('flags disconnected components', () => {
    const result = runPreflight({
      nodes: [makeNode('a', 'server', 'A'), makeNode('b', 'server', 'B'), makeNode('c', 'server', 'Orphan')],
      edges: [{ source: 'a', target: 'b' }],
      trafficProfile: null,
      schemaMemory: null,
      apiContracts: [],
      endpointRoutes: [],
    });
    expect(result.errors.some((e) => e.id === 'disconnected-c')).toBe(true);
  });

  it('flags no schema when DB exists', () => {
    const result = runPreflight({
      nodes: [makeNode('db1', 'database', 'UsersDB')],
      edges: [],
      trafficProfile: null,
      schemaMemory: null,
      apiContracts: [],
      endpointRoutes: [],
    });
    expect(result.errors.some((e) => e.id === 'no-schema')).toBe(true);
  });

  it('flags unassigned tables', () => {
    const result = runPreflight({
      nodes: [makeNode('db1', 'database', 'UsersDB')],
      edges: [],
      trafficProfile: null,
      schemaMemory: {
        version: 1,
        entities: [{ id: 'e1', name: 'users', fields: [], indexes: [], accessPatterns: [], assignedDbId: null }],
        relationships: [],
        aiNotes: '',
      },
      apiContracts: [],
      endpointRoutes: [],
    });
    expect(result.errors.some((e) => e.id === 'unassigned-tables')).toBe(true);
  });

  it('flags no API contracts when server exists', () => {
    const result = runPreflight({
      nodes: [makeNode('s1', 'server', 'Server')],
      edges: [],
      trafficProfile: null,
      schemaMemory: null,
      apiContracts: [],
      endpointRoutes: [],
    });
    expect(result.errors.some((e) => e.id === 'no-api-contracts')).toBe(true);
  });

  it('flags orphaned API contracts without ownerServiceId', () => {
    const result = runPreflight({
      nodes: [makeNode('s1', 'server', 'Server')],
      edges: [],
      trafficProfile: null,
      schemaMemory: null,
      apiContracts: [{ id: 'c1', method: 'GET', path: '/users', description: '', authMode: 'none', ownerServiceId: null }],
      endpointRoutes: [],
    });
    expect(result.errors.some((e) => e.id === 'no-owner-service')).toBe(true);
  });

  it('flags no endpoint routes when contracts exist', () => {
    const result = runPreflight({
      nodes: [makeNode('s1', 'server', 'Server')],
      edges: [],
      trafficProfile: null,
      schemaMemory: null,
      apiContracts: [{ id: 'c1', method: 'GET', path: '/users', description: '', authMode: 'none', ownerServiceId: 's1' }],
      endpointRoutes: [],
    });
    expect(result.errors.some((e) => e.id === 'no-endpoint-routes')).toBe(true);
  });

  it('returns empty errors when all checks pass', () => {
    const result = runPreflight({
      nodes: [
        makeNode('lb', 'load_balancer', 'LB', { isEntry: true }),
        makeNode('s1', 'server', 'Server'),
        makeNode('db1', 'database', 'DB'),
      ],
      edges: [{ source: 'lb', target: 's1' }, { source: 's1', target: 'db1' }],
      trafficProfile: { profileName: 'test', durationSeconds: 60, phases: [{ startS: 0, endS: 60, rps: 100, shape: 'steady', description: '' }], requestMix: {}, userDistribution: 'uniform', jitterPercent: 5 },
      schemaMemory: baseSchema,
      apiContracts: [{ id: 'c1', method: 'GET', path: '/users', description: '', authMode: 'none', ownerServiceId: 's1' }],
      endpointRoutes: [{ endpointId: 'c1', componentChain: ['lb', 's1', 'db1'], tablesAccessed: [{ tableId: 'e1', mode: 'read', indexed: true }], weight: 1, estimatedPayloadBytes: 200 }],
    });
    expect(result.errors).toEqual([]);
  });
});

describe('preflight warnings', () => {
  it('warns on no indexes', () => {
    const result = runPreflight({
      nodes: [makeNode('db1', 'database', 'DB')],
      edges: [],
      trafficProfile: null,
      schemaMemory: {
        version: 1,
        entities: [{ id: 'e1', name: 'users', fields: [{ name: 'id', type: 'uuid', cardinality: 'high' }], indexes: [], accessPatterns: [], assignedDbId: 'db1' }],
        relationships: [],
        aiNotes: '',
      },
      apiContracts: [],
      endpointRoutes: [],
    });
    expect(result.warnings.some((w) => w.id === 'no-index-e1')).toBe(true);
  });

  it('warns on shard key low cardinality', () => {
    const result = runPreflight({
      nodes: [],
      edges: [],
      trafficProfile: null,
      schemaMemory: {
        version: 1,
        entities: [{ id: 'e1', name: 'users', fields: [{ name: 'status', type: 'text', cardinality: 'low' }], indexes: [], partitionKey: 'status', accessPatterns: [], assignedDbId: null }],
        relationships: [],
        aiNotes: '',
      },
      apiContracts: [],
      endpointRoutes: [],
    });
    expect(result.warnings.some((w) => w.id === 'shard-cardinality-e1')).toBe(true);
  });

  it('warns on no cache for read-heavy tables', () => {
    const result = runPreflight({
      nodes: [makeNode('db1', 'database', 'DB')],
      edges: [],
      trafficProfile: null,
      schemaMemory: {
        version: 1,
        entities: [{
          id: 'e1', name: 'users',
          fields: [{ name: 'id', type: 'uuid', cardinality: 'high' }],
          indexes: [{ field: 'id', type: 'btree' }],
          accessPatterns: [{ operation: 'read', frequency: 'very_high', pattern: 'lookup by id' }],
          assignedDbId: 'db1',
        }],
        relationships: [],
        aiNotes: '',
      },
      apiContracts: [],
      endpointRoutes: [],
    });
    expect(result.warnings.some((w) => w.id === 'no-cache-for-reads')).toBe(true);
  });
});
