import { z } from 'zod';
import { v4 as uuid } from 'uuid';

const SchemaFieldSchema = z.object({
  name: z.string(),
  type: z.string(),
  cardinality: z.enum(['low', 'medium', 'high']),
  notes: z.string().optional(),
});

const SchemaIndexSchema = z.object({
  field: z.string(),
  type: z.enum(['btree', 'hash', 'composite']),
});

const AccessPatternSchema = z.object({
  operation: z.enum(['read', 'write']),
  frequency: z.enum(['low', 'medium', 'high', 'very_high']),
  pattern: z.string(),
});

const SchemaEntitySchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  fields: z.array(SchemaFieldSchema),
  indexes: z.array(SchemaIndexSchema),
  partitionKey: z.string().optional(),
  partitionKeyCardinalityWarning: z.boolean().optional(),
  accessPatterns: z.array(AccessPatternSchema),
  assignedDbId: z.string().nullable().optional(),
});

const SchemaRelationshipSchema = z.object({
  from: z.string(),
  to: z.string(),
  type: z.enum(['one_to_one', 'one_to_many', 'many_to_one', 'many_to_many']),
});

const SchemaMemoryBlockSchema = z.object({
  version: z.number(),
  entities: z.array(SchemaEntitySchema),
  relationships: z.array(SchemaRelationshipSchema),
  aiNotes: z.string(),
});

const ApiContractSchema = z.object({
  id: z.string().optional(),
  method: z.string(),
  path: z.string(),
  description: z.string(),
  auth: z.boolean().optional(),
  authMode: z.enum(['none', 'jwt', 'oauth']).optional(),
  ownerServiceId: z.string().nullable().optional(),
});

const TableAccessSchema = z.object({
  tableId: z.string(),
  mode: z.enum(['read', 'write', 'read_write']),
  indexed: z.boolean(),
});

const EndpointRouteSchema = z.object({
  endpointId: z.string(),
  componentChain: z.array(z.string()),
  tablesAccessed: z.array(TableAccessSchema),
  weight: z.number(),
  estimatedPayloadBytes: z.number(),
});

const TrafficPhaseSchema = z.object({
  startS: z.number(),
  endS: z.number(),
  rps: z.number(),
  shape: z.enum(['steady', 'spike', 'instant_spike', 'ramp_down', 'ramp_up']),
  description: z.string(),
});

const TrafficProfileSchema = z.object({
  profileName: z.string(),
  durationSeconds: z.number(),
  phases: z.array(TrafficPhaseSchema),
  requestMix: z.record(z.string(), z.number()),
  userDistribution: z.enum(['uniform', 'pareto']),
  jitterPercent: z.number(),
  largeServerConcentration: z.number().optional(),
});

const SessionFileSchema = z.object({
  systemsimVersion: z.string().optional(),
  mode: z.enum(['scenario', 'freeform']).optional(),
  scenarioId: z.string().nullable().optional(),
  intent: z.string().nullable().optional(),
  session: z.object({
    createdAt: z.string(),
    lastModified: z.string(),
  }).optional(),
  design: z.object({
    requirements: z.object({
      functional: z.array(z.string()),
      nonFunctional: z.array(z.object({
        attribute: z.string(),
        target: z.string(),
        scope: z.string(),
      })),
    }).optional(),
    apiContracts: z.array(ApiContractSchema).optional(),
    endpointRoutes: z.array(EndpointRouteSchema).optional(),
    schemaMemory: SchemaMemoryBlockSchema.nullable().optional(),
    schemaHistory: z.array(SchemaMemoryBlockSchema).optional(),
  }).optional(),
  componentGraph: z.object({
    components: z.array(z.any()),
    wires: z.array(z.any()).optional(),
  }).optional(),
  simulationRuns: z.array(z.any()).optional(),
  trafficProfile: TrafficProfileSchema.optional(),
}).passthrough();

export type MigrateResult =
  | { ok: true; data: z.infer<typeof SessionFileSchema>; migratedFields: string[] }
  | { ok: false; error: string };

export function migrateSession(raw: unknown): MigrateResult {
  const parsed = SessionFileSchema.safeParse(raw);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const path = firstIssue?.path.join('.') ?? 'unknown';
    const msg = firstIssue?.message ?? 'Invalid format';
    return {
      ok: false,
      error: `This session file couldn't be loaded. Field "${path}": ${msg}. It may be from an incompatible version.`,
    };
  }

  const data = parsed.data;
  const migratedFields: string[] = [];

  if (data.design?.apiContracts) {
    for (const contract of data.design.apiContracts) {
      if (!contract.id) {
        contract.id = uuid();
        migratedFields.push('apiContract.id');
      }
      if (contract.authMode === undefined) {
        contract.authMode = contract.auth ? 'jwt' : 'none';
        migratedFields.push('apiContract.authMode');
      }
      if (contract.ownerServiceId === undefined) {
        contract.ownerServiceId = null;
        migratedFields.push('apiContract.ownerServiceId');
      }
    }
  }

  if (data.design?.schemaMemory?.entities) {
    for (const entity of data.design.schemaMemory.entities) {
      if (!entity.id) {
        entity.id = uuid();
        migratedFields.push('schemaEntity.id');
      }
      if (entity.assignedDbId === undefined) {
        entity.assignedDbId = null;
        migratedFields.push('schemaEntity.assignedDbId');
      }
    }
  }

  if (data.design && !data.design.endpointRoutes) {
    data.design.endpointRoutes = [];
    migratedFields.push('design.endpointRoutes');
  }

  return { ok: true, data, migratedFields: [...new Set(migratedFields)] };
}
