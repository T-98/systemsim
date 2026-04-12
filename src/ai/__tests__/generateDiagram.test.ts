import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateDiagram } from '../generateDiagram';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe('generateDiagram', () => {
  it('returns ok:true with graph on success', async () => {
    const graph = {
      nodes: [{ type: 'server', label: 'API' }],
      edges: [],
    };
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ graph }),
    });

    const result = await generateDiagram({ text: 'A simple server' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.graph).toEqual(graph);
  });

  it('returns rate_limit on 429', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      json: () => Promise.resolve({ kind: 'rate_limit', message: 'Too many' }),
    });

    const result = await generateDiagram({ text: 'test' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('rate_limit');
  });

  it('returns validation on validation error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 422,
      json: () => Promise.resolve({ kind: 'validation', message: 'Bad output' }),
    });

    const result = await generateDiagram({ text: 'test' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('validation');
      expect(result.message).toBe('Bad output');
    }
  });

  it('returns network on TypeError (fetch failure)', async () => {
    mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await generateDiagram({ text: 'test' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('network');
  });

  it('returns aborted when signal is aborted', async () => {
    const abortError = new DOMException('Aborted', 'AbortError');
    mockFetch.mockRejectedValue(abortError);

    const controller = new AbortController();
    controller.abort();

    const result = await generateDiagram({ text: 'test', signal: controller.signal });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('aborted');
  });

  it('sends correct request body', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ graph: { nodes: [], edges: [] } }),
    });

    await generateDiagram({ text: 'My system description', mode: 'remix' });

    expect(mockFetch).toHaveBeenCalledWith('/api/generate-diagram', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ text: 'My system description', mode: 'remix', currentGraph: undefined }),
    }));
  });
});
