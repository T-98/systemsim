import { describe, it, expect } from 'vitest';
import { migrateSession } from '../migrate';

describe('migrateSession', () => {
  it('accepts a valid current-format session', () => {
    const session = {
      systemsimVersion: '2.0',
      mode: 'freeform',
      design: {
        apiContracts: [{
          id: 'c1',
          method: 'GET',
          path: '/users',
          description: 'Get users',
          authMode: 'none',
          ownerServiceId: 's1',
        }],
        endpointRoutes: [],
        schemaMemory: {
          version: 1,
          entities: [{
            id: 'e1',
            name: 'users',
            fields: [],
            indexes: [],
            accessPatterns: [],
            assignedDbId: 'db1',
          }],
          relationships: [],
          aiNotes: '',
        },
      },
    };
    const result = migrateSession(session);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.migratedFields).toEqual([]);
    }
  });

  it('migrates pre-Phase-1 session (no entity.id, auth: boolean)', () => {
    const session = {
      systemsimVersion: '1.0',
      mode: 'scenario',
      design: {
        apiContracts: [{
          method: 'POST',
          path: '/users',
          description: 'Create user',
          auth: true,
        }],
        schemaMemory: {
          version: 1,
          entities: [{
            name: 'users',
            fields: [{ name: 'id', type: 'uuid', cardinality: 'high' }],
            indexes: [],
            accessPatterns: [],
          }],
          relationships: [],
          aiNotes: '',
        },
      },
    };
    const result = migrateSession(session);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.migratedFields).toContain('apiContract.id');
      expect(result.migratedFields).toContain('apiContract.authMode');
      expect(result.migratedFields).toContain('apiContract.ownerServiceId');
      expect(result.migratedFields).toContain('schemaEntity.id');
      expect(result.migratedFields).toContain('schemaEntity.assignedDbId');
      expect(result.migratedFields).toContain('design.endpointRoutes');

      const contract = result.data.design!.apiContracts![0];
      expect(contract.id).toBeDefined();
      expect(contract.authMode).toBe('jwt');
      expect(contract.ownerServiceId).toBeNull();

      const entity = result.data.design!.schemaMemory!.entities[0];
      expect(entity.id).toBeDefined();
      expect(entity.assignedDbId).toBeNull();

      expect(result.data.design!.endpointRoutes).toEqual([]);
    }
  });

  it('rejects malformed JSON with human-readable error', () => {
    const result = migrateSession({ design: { apiContracts: [{ method: 123 }] } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("couldn't be loaded");
      expect(result.error).not.toContain('ZodError');
    }
  });

  it('rejects completely invalid input', () => {
    const result = migrateSession('not an object');
    expect(result.ok).toBe(false);
  });

  it('handles session with no design field', () => {
    const result = migrateSession({ systemsimVersion: '1.0', mode: 'freeform' });
    expect(result.ok).toBe(true);
  });

  it('migrates auth: false to authMode: none', () => {
    const session = {
      design: {
        apiContracts: [{
          method: 'GET',
          path: '/health',
          description: 'Health check',
          auth: false,
        }],
      },
    };
    const result = migrateSession(session);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.design!.apiContracts![0].authMode).toBe('none');
    }
  });
});
