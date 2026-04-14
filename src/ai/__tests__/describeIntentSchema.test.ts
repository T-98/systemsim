import { describe, it, expect } from 'vitest';
import {
  validateDescribeIntent,
  aggregateConfidence,
  DESCRIBE_INTENT_TOOL_SCHEMA,
  COMPONENT_TYPES,
} from '../describeIntentSchema';

describe('validateDescribeIntent', () => {
  const validInput = {
    intent: 'We let users vote on memes',
    components: [
      { label: 'API', type: 'server' },
      { label: 'Postgres', type: 'database' },
    ],
    connections: 'API --> Postgres',
    confidence: { intent: 'high', items: [] },
  };

  it('accepts a full valid payload', () => {
    const result = validateDescribeIntent(validInput);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.intent).toBe('We let users vote on memes');
    expect(result.data.components).toHaveLength(2);
    expect(result.data.connections).toBe('API --> Postgres');
    expect(result.data.confidence.intent).toBe('high');
  });

  it('rejects null', () => {
    expect(validateDescribeIntent(null)).toEqual({ ok: false, reason: 'malformed_json' });
  });

  it('rejects missing intent', () => {
    const { intent: _intent, ...rest } = validInput;
    void _intent;
    expect(validateDescribeIntent(rest)).toEqual({ ok: false, reason: 'malformed_json' });
  });

  it('rejects missing connections', () => {
    const { connections: _c, ...rest } = validInput;
    void _c;
    expect(validateDescribeIntent(rest)).toEqual({ ok: false, reason: 'malformed_json' });
  });

  it('rejects non-array components', () => {
    expect(
      validateDescribeIntent({ ...validInput, components: 'not an array' })
    ).toEqual({ ok: false, reason: 'malformed_json' });
  });

  it('rejects payload with zero valid components', () => {
    const result = validateDescribeIntent({
      ...validInput,
      components: [{ label: '', type: 'server' }, { label: 'X', type: 'not_a_type' }],
    });
    expect(result).toEqual({ ok: false, reason: 'no_components' });
  });

  it('deduplicates components by label+type', () => {
    const result = validateDescribeIntent({
      ...validInput,
      components: [
        { label: 'API', type: 'server' },
        { label: 'API', type: 'server' },
        { label: 'api', type: 'server' },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.components).toHaveLength(1);
  });

  it('allows same label with different type', () => {
    const result = validateDescribeIntent({
      ...validInput,
      components: [
        { label: 'cache', type: 'cache' },
        { label: 'cache', type: 'database' },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.components).toHaveLength(2);
  });

  it('caps components at 15', () => {
    const components = Array.from({ length: 25 }, (_, i) => ({
      label: `c${i}`,
      type: 'server',
    }));
    const result = validateDescribeIntent({ ...validInput, components });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.components).toHaveLength(15);
  });

  it('rejects when both intent and connections are empty', () => {
    const result = validateDescribeIntent({
      ...validInput,
      intent: '   ',
      connections: '\n\n',
    });
    expect(result).toEqual({ ok: false, reason: 'empty_output' });
  });

  it('allows empty connections when intent is present', () => {
    const result = validateDescribeIntent({
      ...validInput,
      connections: '',
    });
    expect(result.ok).toBe(true);
  });

  it('defaults confidence.intent to med if missing', () => {
    const { confidence: _c, ...rest } = validInput;
    void _c;
    const result = validateDescribeIntent(rest);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.confidence.intent).toBe('med');
    expect(result.data.confidence.items).toEqual([]);
  });

  it('drops malformed confidence items', () => {
    const result = validateDescribeIntent({
      ...validInput,
      confidence: {
        intent: 'high',
        items: [
          { name: 'Good', confidence: 'low', reasoning: 'fine' },
          { name: 'NoConf' },
          { confidence: 'low', reasoning: 'no name' },
          'garbage',
          null,
        ],
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.confidence.items).toHaveLength(1);
    expect(result.data.confidence.items[0].name).toBe('Good');
  });

  it('truncates intent to 800 chars', () => {
    const result = validateDescribeIntent({
      ...validInput,
      intent: 'x'.repeat(1500),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.intent.length).toBe(800);
  });

  it('truncates connections to 4000 chars', () => {
    const result = validateDescribeIntent({
      ...validInput,
      connections: 'y'.repeat(5000),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.connections.length).toBe(4000);
  });

  it('normalizes component labels', () => {
    const result = validateDescribeIntent({
      ...validInput,
      components: [{ label: '  nisa   agent  ', type: 'server' }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.components[0].label).toBe('nisa agent');
  });

  it('caps component labels at 60 chars', () => {
    const result = validateDescribeIntent({
      ...validInput,
      components: [{ label: 'x'.repeat(120), type: 'server' }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.components[0].label.length).toBe(60);
  });
});

describe('aggregateConfidence', () => {
  const base = {
    intent: 'a',
    components: [],
    connections: '',
  };

  it('returns low when intent is low', () => {
    expect(
      aggregateConfidence({
        ...base,
        confidence: { intent: 'low', items: [] },
      })
    ).toBe('low');
  });

  it('returns low when any item is low', () => {
    expect(
      aggregateConfidence({
        ...base,
        confidence: {
          intent: 'high',
          items: [
            { name: 'a', confidence: 'high', reasoning: '' },
            { name: 'b', confidence: 'low', reasoning: '' },
          ],
        },
      })
    ).toBe('low');
  });

  it('returns med when no low but any med', () => {
    expect(
      aggregateConfidence({
        ...base,
        confidence: {
          intent: 'high',
          items: [{ name: 'a', confidence: 'med', reasoning: '' }],
        },
      })
    ).toBe('med');
  });

  it('returns high when everything is high', () => {
    expect(
      aggregateConfidence({
        ...base,
        confidence: {
          intent: 'high',
          items: [{ name: 'a', confidence: 'high', reasoning: '' }],
        },
      })
    ).toBe('high');
  });
});

describe('DESCRIBE_INTENT_TOOL_SCHEMA', () => {
  it('declares the expected tool name', () => {
    expect(DESCRIBE_INTENT_TOOL_SCHEMA.name).toBe('describe_intent');
  });

  it('requires intent, components, connections, and confidence', () => {
    expect(DESCRIBE_INTENT_TOOL_SCHEMA.input_schema.required).toEqual([
      'intent',
      'components',
      'connections',
      'confidence',
    ]);
  });

  it('exposes the 6 MVP component types', () => {
    expect(COMPONENT_TYPES).toEqual([
      'load_balancer',
      'server',
      'database',
      'cache',
      'queue',
      'fanout',
    ]);
  });
});
