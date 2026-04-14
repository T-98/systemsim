import { describe, it, expect, beforeEach, vi } from 'vitest';
import { describeIntent } from '../describeIntent';

describe('describeIntent client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns ok with parsed data on 200', async () => {
    const payload = {
      intent: 'We let users vote',
      components: [
        { label: 'API', type: 'server' },
        { label: 'Postgres', type: 'database' },
      ],
      connections: 'API --> Postgres',
      confidence: { intent: 'high', items: [] },
      promptVersion: '2.0',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => payload })
    );
    const result = await describeIntent({ text: 'a meme app' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.intent).toBe('We let users vote');
    expect(result.data.connections).toBe('API --> Postgres');
    expect(result.data.components).toHaveLength(2);
  });

  it('returns validation error on 400', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: true, kind: 'validation', message: 'Describe your system or attach an image.' }),
      })
    );
    const result = await describeIntent({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('validation');
    expect(result.message).toMatch(/Describe/);
  });

  it('returns rate_limit on 429', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({ error: true, kind: 'rate_limit', message: 'Slow down' }),
      })
    );
    const result = await describeIntent({ text: 'app' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('rate_limit');
  });

  it('returns network on TypeError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        throw new TypeError('Failed to fetch');
      })
    );
    const result = await describeIntent({ text: 'app' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('network');
  });

  it('returns aborted on AbortError', async () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortErr));
    const result = await describeIntent({ text: 'app' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('aborted');
  });

  it('returns api_error on malformed success JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ intent: 42, components: 'wrong' }) })
    );
    const result = await describeIntent({ text: 'app' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('api_error');
  });

  it('rejects success shape missing components array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ intent: 'x', connections: 'a --> b', confidence: { intent: 'high', items: [] } }),
      })
    );
    const result = await describeIntent({ text: 'app' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('api_error');
  });

  it('sends imageBase64 and mimeType in request body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        intent: 'x',
        components: [{ label: 'c', type: 'server' }],
        connections: '',
        confidence: { intent: 'high', items: [] },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await describeIntent({ imageBase64: 'aGVsbG8=', mimeType: 'image/png' });
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe('/api/describe-intent');
    const body = JSON.parse(call[1].body);
    expect(body.imageBase64).toBe('aGVsbG8=');
    expect(body.mimeType).toBe('image/png');
  });
});
