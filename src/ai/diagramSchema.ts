import type { CanonicalGraph, CanonicalNode, CanonicalEdge } from '../types';

const ALLOWED_TYPES = new Set([
  'load_balancer', 'server', 'database', 'cache', 'queue', 'fanout',
]);

const MAX_NODES = 15;
const MAX_EDGES = 30;
const MAX_LABEL_LENGTH = 40;

export type ValidationResult =
  | { ok: true; graph: CanonicalGraph }
  | { ok: false; reason: string };

interface RawAINode {
  ref: string;
  type: string;
  label: string;
}

interface RawAIEdge {
  source: string;
  target: string;
}

interface RawAIOutput {
  nodes: RawAINode[];
  edges: RawAIEdge[];
}

function normalizeLabel(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, ' ')
    .normalize('NFC')
    .replace(/[\n\r]/g, '')
    .replace(/[^\w\s\-_()/.]/g, '')
    .slice(0, MAX_LABEL_LENGTH)
    .trim();
}

export function validateAndRewrite(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'malformed_json' };
  }

  const output = raw as RawAIOutput;

  if (!Array.isArray(output.nodes) || output.nodes.length === 0) {
    return { ok: false, reason: 'no_nodes' };
  }

  if (output.nodes.length > MAX_NODES) {
    return { ok: false, reason: 'too_many_nodes' };
  }

  if (!Array.isArray(output.edges)) {
    return { ok: false, reason: 'malformed_json' };
  }

  if (output.edges.length > MAX_EDGES) {
    return { ok: false, reason: 'too_many_edges' };
  }

  // Validate and rewrite nodes
  const refToId = new Map<string, string>();
  const nodes: CanonicalNode[] = [];

  for (let i = 0; i < output.nodes.length; i++) {
    const raw = output.nodes[i];
    if (typeof raw.ref !== 'string' || typeof raw.type !== 'string' || typeof raw.label !== 'string') {
      return { ok: false, reason: 'malformed_json' };
    }
    if (!raw.ref || !raw.type || !raw.label) {
      return { ok: false, reason: 'malformed_json' };
    }
    if (!ALLOWED_TYPES.has(raw.type)) {
      return { ok: false, reason: 'invalid_type' };
    }
    if (refToId.has(raw.ref)) {
      return { ok: false, reason: 'duplicate_ref' };
    }
    const label = normalizeLabel(raw.label);
    if (label.length === 0) {
      return { ok: false, reason: 'malformed_json' };
    }
    const id = `${raw.type}-${i}`;
    refToId.set(raw.ref, id);
    nodes.push({
      type: raw.type as CanonicalNode['type'],
      label,
    });
  }

  // Validate and rewrite edges
  const edges: CanonicalEdge[] = [];
  for (const rawEdge of output.edges) {
    if (!rawEdge.source || !rawEdge.target) {
      return { ok: false, reason: 'malformed_json' };
    }
    const sourceId = refToId.get(rawEdge.source);
    const targetId = refToId.get(rawEdge.target);
    if (!sourceId || !targetId) {
      return { ok: false, reason: 'dangling_edge' };
    }
    if (sourceId === targetId) {
      return { ok: false, reason: 'self_loop' };
    }
    edges.push({ source: sourceId, target: targetId });
  }

  return { ok: true, graph: { nodes, edges } };
}

export const TOOL_SCHEMA = {
  name: 'generate_system_diagram',
  description: 'Generate a distributed system architecture diagram from a text description.',
  input_schema: {
    type: 'object' as const,
    required: ['nodes', 'edges'],
    properties: {
      nodes: {
        type: 'array' as const,
        description: 'System components. Max 15.',
        maxItems: MAX_NODES,
        items: {
          type: 'object' as const,
          required: ['ref', 'type', 'label'],
          properties: {
            ref: { type: 'string' as const, description: 'Local reference token (e.g. n1, n2). Used only for edge references.' },
            type: { type: 'string' as const, enum: [...ALLOWED_TYPES], description: 'Component type.' },
            label: { type: 'string' as const, maxLength: MAX_LABEL_LENGTH, description: 'Display name for this component.' },
          },
        },
      },
      edges: {
        type: 'array' as const,
        description: 'Connections between components. Max 30.',
        maxItems: MAX_EDGES,
        items: {
          type: 'object' as const,
          required: ['source', 'target'],
          properties: {
            source: { type: 'string' as const, description: 'ref token of the source node.' },
            target: { type: 'string' as const, description: 'ref token of the target node.' },
          },
        },
      },
    },
  },
};
