import type {
  ApiContract,
  EndpointRoute,
  SchemaMemoryBlock,
  TrafficProfile,
  PreflightItem,
  PreflightResult,
} from '../types';
import { findEntryPoints, findDisconnected } from './graphTraversal';

interface PreflightInput {
  nodes: { id: string; data: { type: string; label: string; config: Record<string, unknown> } }[];
  edges: { source: string; target: string }[];
  trafficProfile: TrafficProfile | null;
  schemaMemory: SchemaMemoryBlock | null;
  apiContracts: ApiContract[];
  endpointRoutes: EndpointRoute[];
}

export function runPreflight(input: PreflightInput): PreflightResult {
  const errors: PreflightItem[] = [];
  const warnings: PreflightItem[] = [];

  if (!input.trafficProfile || input.trafficProfile.phases.length === 0) {
    errors.push({
      id: 'no-traffic',
      message: 'Add traffic profile',
      tooltip: 'Simulation needs load data. Define how many requests per second your system handles.',
      target: 'traffic',
    });
  }

  const entryPoints = findEntryPoints(input.nodes, input.edges);
  if (entryPoints.length === 0 && input.nodes.length > 0) {
    errors.push({
      id: 'no-entry',
      message: 'Mark an entry point on a component',
      tooltip: 'Entry points receive external traffic. Usually a load balancer or API gateway.',
      target: 'canvas',
    });
  }

  const disconnected = findDisconnected(input.nodes, input.edges);
  for (const id of disconnected) {
    const node = input.nodes.find((n) => n.id === id);
    if (node) {
      errors.push({
        id: `disconnected-${id}`,
        message: `${node.data.label} is disconnected`,
        tooltip: 'Every component needs at least one wire in or out to participate in the simulation.',
        target: 'canvas',
        targetComponentId: id,
      });
    }
  }

  const dbNodes = input.nodes.filter((n) => n.data.type === 'database');
  if (dbNodes.length > 0 && (!input.schemaMemory || input.schemaMemory.entities.length === 0)) {
    errors.push({
      id: 'no-schema',
      message: 'Define a data schema',
      tooltip: 'Databases need tables to simulate. Define entities in Design \u2192 Schema.',
      target: 'design',
      targetSubtab: 'schema',
    });
  }

  if (input.schemaMemory) {
    const unassigned = input.schemaMemory.entities.filter((e) => !e.assignedDbId);
    if (unassigned.length > 0) {
      const dbLabel = dbNodes[0]?.data.label ?? 'a database';
      errors.push({
        id: 'unassigned-tables',
        message: `Assign ${unassigned.length} table${unassigned.length > 1 ? 's' : ''} to ${dbLabel}`,
        tooltip: 'Unassigned tables can\u2019t be simulated. The engine needs to know which DB handles which queries.',
        target: 'config',
        targetComponentId: dbNodes[0]?.id,
      });
    }
  }

  const serverNodes = input.nodes.filter(
    (n) => n.data.type === 'server' || n.data.type === 'api_gateway',
  );
  if (serverNodes.length > 0 && input.apiContracts.length === 0) {
    errors.push({
      id: 'no-api-contracts',
      message: 'Define API endpoints',
      tooltip: 'Servers need endpoints to route traffic. Define at least one API contract.',
      target: 'design',
      targetSubtab: 'api',
    });
  }

  const orphanedContracts = input.apiContracts.filter((c) => !c.ownerServiceId);
  if (orphanedContracts.length > 0) {
    errors.push({
      id: 'no-owner-service',
      message: `${orphanedContracts.length} endpoint${orphanedContracts.length > 1 ? 's' : ''} missing owner service`,
      tooltip: 'Endpoints connect API contracts to the components and tables they use. Without them, the engine can\u2019t route traffic.',
      target: 'design',
      targetSubtab: 'api',
    });
  }

  if (input.apiContracts.length > 0 && input.endpointRoutes.length === 0) {
    errors.push({
      id: 'no-endpoint-routes',
      message: 'Define endpoint routes',
      tooltip: 'Endpoint routes map API contracts to component chains and tables. Without them, traffic has no path.',
      target: 'design',
      targetSubtab: 'api',
    });
  }

  // Warnings (don't block simulation)
  if (input.schemaMemory) {
    for (const entity of input.schemaMemory.entities) {
      if (entity.indexes.length === 0 && entity.fields.length > 0) {
        warnings.push({
          id: `no-index-${entity.id}`,
          message: `${entity.name} has no indexes`,
          tooltip: 'Queries without indexes are 10x slower. Add at least one index on frequently queried fields.',
          target: 'design',
        });
      }
    }

    const readHeavyEntities = input.schemaMemory.entities.filter((e) =>
      e.accessPatterns.some((p) => p.operation === 'read' && (p.frequency === 'high' || p.frequency === 'very_high')),
    );
    const cacheExists = input.nodes.some((n) => n.data.type === 'cache');
    if (readHeavyEntities.length > 0 && !cacheExists) {
      warnings.push({
        id: 'no-cache-for-reads',
        message: 'No cache for read-heavy tables',
        tooltip: 'High-frequency reads benefit from a cache layer upstream of the database.',
        target: 'canvas',
      });
    }

    for (const entity of input.schemaMemory.entities) {
      if (entity.partitionKey) {
        const field = entity.fields.find((f) => f.name === entity.partitionKey);
        if (field && field.cardinality === 'low') {
          warnings.push({
            id: `shard-cardinality-${entity.id}`,
            message: `${entity.name} shard key has low cardinality`,
            tooltip: 'Low-cardinality partition keys cause hot shards. Consider a higher-cardinality field.',
            target: 'design',
          });
        }
      }
    }
  }

  return { errors, warnings };
}
