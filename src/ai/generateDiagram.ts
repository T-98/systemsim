import type { CanonicalGraph } from '../types';

export type GenerateResult =
  | { ok: true; graph: CanonicalGraph }
  | { ok: false; kind: 'network' | 'rate_limit' | 'validation' | 'api_error' | 'aborted'; message: string };

interface GenerateOptions {
  text: string;
  mode?: 'generate' | 'remix';
  currentGraph?: { nodes: Array<{ type: string; label: string }>; edges: Array<{ source: string; target: string }> };
  signal?: AbortSignal;
}

export async function generateDiagram(options: GenerateOptions): Promise<GenerateResult> {
  const { text, mode = 'generate', currentGraph, signal } = options;

  try {
    const res = await fetch('/api/generate-diagram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, mode, currentGraph }),
      signal,
    });

    if (signal?.aborted) {
      return { ok: false, kind: 'aborted', message: 'Request cancelled.' };
    }

    const data = await res.json();

    if (res.ok && data.graph) {
      return { ok: true, graph: data.graph };
    }

    const kind = data.kind ?? 'api_error';
    const message = data.message ?? 'Something went wrong.';

    if (res.status === 429 || kind === 'rate_limit') {
      return { ok: false, kind: 'rate_limit', message };
    }
    if (kind === 'validation') {
      return { ok: false, kind: 'validation', message };
    }
    return { ok: false, kind: 'api_error', message };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, kind: 'aborted', message: 'Request cancelled.' };
    }
    if (err instanceof TypeError) {
      return { ok: false, kind: 'network', message: "Can't reach the service. Check your connection." };
    }
    return { ok: false, kind: 'api_error', message: 'Something went wrong.' };
  }
}
