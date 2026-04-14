import type { ComponentType } from '../types';

export type ConfidenceLevel = 'low' | 'med' | 'high';

export const COMPONENT_TYPES: readonly ComponentType[] = [
  'load_balancer',
  'server',
  'database',
  'cache',
  'queue',
  'fanout',
];

export interface DetectedComponent {
  label: string;
  type: ComponentType;
}

export interface ConfidenceItem {
  name: string;
  confidence: ConfidenceLevel;
  reasoning: string;
}

export interface DescribeIntentOutput {
  intent: string;
  components: DetectedComponent[];
  connections: string;
  confidence: {
    intent: ConfidenceLevel;
    items: ConfidenceItem[];
  };
}

export type ValidationResult =
  | { ok: true; data: DescribeIntentOutput }
  | { ok: false; reason: string };

const MAX_INTENT_CHARS = 800;
const MAX_CONNECTIONS_CHARS = 4000;
const MAX_COMPONENTS = 15;
const MAX_ITEMS = 25;

function isConfidenceLevel(v: unknown): v is ConfidenceLevel {
  return v === 'low' || v === 'med' || v === 'high';
}

function isComponentType(v: unknown): v is ComponentType {
  return typeof v === 'string' && (COMPONENT_TYPES as readonly string[]).includes(v);
}

function normalizeLabel(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

function normalizeText(raw: string, maxLen: number): string {
  return raw
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, maxLen);
}

export function validateDescribeIntent(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'malformed_json' };
  }
  const r = raw as Record<string, unknown>;

  if (typeof r.intent !== 'string' || typeof r.connections !== 'string') {
    return { ok: false, reason: 'malformed_json' };
  }
  if (!Array.isArray(r.components)) {
    return { ok: false, reason: 'malformed_json' };
  }

  const intent = normalizeText(r.intent, MAX_INTENT_CHARS);
  const connections = normalizeText(r.connections, MAX_CONNECTIONS_CHARS);

  const components: DetectedComponent[] = [];
  const seenLabels = new Set<string>();
  for (const raw of r.components.slice(0, MAX_COMPONENTS)) {
    if (!raw || typeof raw !== 'object') continue;
    const c = raw as Record<string, unknown>;
    if (typeof c.label !== 'string' || !isComponentType(c.type)) continue;
    const label = normalizeLabel(c.label);
    if (!label) continue;
    const key = `${c.type}::${label.toLowerCase()}`;
    if (seenLabels.has(key)) continue;
    seenLabels.add(key);
    components.push({ label, type: c.type });
  }

  if (components.length === 0) {
    return { ok: false, reason: 'no_components' };
  }
  if (!intent && !connections) {
    return { ok: false, reason: 'empty_output' };
  }

  const confidenceRaw = r.confidence;
  let confidence = { intent: 'med' as ConfidenceLevel, items: [] as ConfidenceItem[] };
  if (confidenceRaw && typeof confidenceRaw === 'object') {
    const c = confidenceRaw as Record<string, unknown>;
    const intentConf = isConfidenceLevel(c.intent) ? c.intent : 'med';
    const items: ConfidenceItem[] = [];
    if (Array.isArray(c.items)) {
      for (const item of c.items.slice(0, MAX_ITEMS)) {
        if (!item || typeof item !== 'object') continue;
        const it = item as Record<string, unknown>;
        if (typeof it.name !== 'string') continue;
        if (!isConfidenceLevel(it.confidence)) continue;
        items.push({
          name: it.name.slice(0, 80),
          confidence: it.confidence,
          reasoning: typeof it.reasoning === 'string' ? it.reasoning.slice(0, 240) : '',
        });
      }
    }
    confidence = { intent: intentConf, items };
  }

  return {
    ok: true,
    data: { intent, components, connections, confidence },
  };
}

export function aggregateConfidence(out: DescribeIntentOutput): ConfidenceLevel {
  if (out.confidence.intent === 'low') return 'low';
  if (out.confidence.items.some((i) => i.confidence === 'low')) return 'low';
  if (out.confidence.intent === 'med') return 'med';
  if (out.confidence.items.some((i) => i.confidence === 'med')) return 'med';
  return 'high';
}

export const DESCRIBE_INTENT_TOOL_SCHEMA = {
  name: 'describe_intent',
  description:
    'Extract structured information from a system diagram or text description. Returns (1) the user\'s intent in plain English, (2) the detected components, (3) the connections between them in simple arrow-prose, and (4) per-item confidence.',
  input_schema: {
    type: 'object' as const,
    required: ['intent', 'components', 'connections', 'confidence'],
    properties: {
      intent: {
        type: 'string' as const,
        maxLength: MAX_INTENT_CHARS,
        description:
          "Plain-English description of what the user is building, in the founder's voice (first-person plural: 'We let users...'). No product-marketing language. 1-3 sentences.",
      },
      components: {
        type: 'array' as const,
        maxItems: MAX_COMPONENTS,
        description:
          'The components you detected in the diagram or description. Each component has a display label (as the user wrote it) and a system type from the 6 allowed types: load_balancer, server, database, cache, queue, fanout. Data artifacts (files, messages, transcripts, frames) should be mapped to database (object storage) OR inlined into the connection label, not a separate component.',
        items: {
          type: 'object' as const,
          required: ['label', 'type'],
          properties: {
            label: {
              type: 'string' as const,
              maxLength: 60,
              description: 'Display label, as the user labeled it.',
            },
            type: {
              type: 'string' as const,
              enum: [...COMPONENT_TYPES],
              description:
                'Component type. MAPPING: API gateway → load_balancer. Workers/consumers/processors → server. Kafka/RabbitMQ/SQS → queue. Redis/CDN → cache. Object storage/Postgres/Elasticsearch → database. Pub/sub → fanout.',
            },
          },
        },
      },
      connections: {
        type: 'string' as const,
        maxLength: MAX_CONNECTIONS_CHARS,
        description:
          'The connections between components, ONE PER LINE, in the format:\n  SOURCE_LABEL --> TARGET_LABEL\nOR (with optional edge label):\n  SOURCE_LABEL --LABEL--> TARGET_LABEL\n\nEach source and target MUST be a label that appears in the components array. Arrow direction is data-flow: source produces, target consumes. For queues, producer --> queue --> consumer. No ASCII diagrams, no pseudo-code, no bullets. Just one line per edge.\n\nExample:\n  user uploads video --> raw video\n  raw video --extracted audio--> STT\n  STT --text transcript--> nisa agent\n  nisa agent --> clip extractor',
      },
      confidence: {
        type: 'object' as const,
        required: ['intent', 'items'],
        properties: {
          intent: {
            type: 'string' as const,
            enum: ['low', 'med', 'high'],
            description: 'Overall confidence in the extracted intent.',
          },
          items: {
            type: 'array' as const,
            maxItems: MAX_ITEMS,
            description:
              "Per-component or per-edge confidence. Include any item whose identity, role, or connection was uncertain. Prefer honest 'low' over confident hallucination.",
            items: {
              type: 'object' as const,
              required: ['name', 'confidence', 'reasoning'],
              properties: {
                name: { type: 'string' as const, maxLength: 80 },
                confidence: { type: 'string' as const, enum: ['low', 'med', 'high'] },
                reasoning: {
                  type: 'string' as const,
                  maxLength: 240,
                  description: 'One sentence: why the confidence is low/med/high.',
                },
              },
            },
          },
        },
      },
    },
  },
};
