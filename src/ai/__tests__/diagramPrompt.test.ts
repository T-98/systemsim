import { describe, it, expect } from 'vitest';
import { buildPrompt, PROMPT_VERSION } from '../diagramPrompt';

describe('buildPrompt', () => {
  it('exports a prompt version string', () => {
    expect(PROMPT_VERSION).toBe('1.0');
  });

  it('returns system + user for generate mode', () => {
    const result = buildPrompt({ mode: 'generate', userText: 'A load balancer and two servers' });
    expect(result.system).toContain('ALLOWED COMPONENT TYPES');
    expect(result.system).toContain('load_balancer');
    expect(result.user).toBe('A load balancer and two servers');
  });

  it('includes current graph description in remix mode', () => {
    const result = buildPrompt({
      mode: 'remix',
      userText: 'Add a read replica',
      currentGraph: {
        nodes: [
          { type: 'server', label: 'API' },
          { type: 'database', label: 'DB' },
        ],
        edges: [{ source: 'server-0', target: 'database-1' }],
      },
    });
    expect(result.user).toContain('Current system diagram');
    expect(result.user).toContain('API');
    expect(result.user).toContain('DB');
    expect(result.user).toContain('Add a read replica');
    expect(result.user).toContain('COMPLETE updated diagram');
  });

  it('falls back to generate mode when no currentGraph provided', () => {
    const result = buildPrompt({ mode: 'remix', userText: 'Some text' });
    expect(result.user).toBe('Some text');
    expect(result.user).not.toContain('Current system diagram');
  });

  it('system prompt includes mapping table', () => {
    const result = buildPrompt({ mode: 'generate', userText: 'test' });
    expect(result.system).toContain('CDN');
    expect(result.system).toContain('Elasticsearch');
    expect(result.system).toContain('Kafka');
  });

  it('system prompt includes rules about max nodes and edges', () => {
    const result = buildPrompt({ mode: 'generate', userText: 'test' });
    expect(result.system).toContain('Max 15 nodes');
    expect(result.system).toContain('max 30 edges');
  });

  it('system prompt includes edge direction rules', () => {
    const result = buildPrompt({ mode: 'generate', userText: 'test' });
    expect(result.system).toContain('EDGE DIRECTION');
    expect(result.system).toContain('source is the data producer');
    expect(result.system).toContain('target is the data consumer');
  });

  it('system prompt includes queue producer/consumer example', () => {
    const result = buildPrompt({ mode: 'generate', userText: 'test' });
    expect(result.system).toContain('EXAMPLE 2');
    expect(result.system).toContain('Matching Engine');
    expect(result.system).toContain('queue feeds consumer');
  });
});
