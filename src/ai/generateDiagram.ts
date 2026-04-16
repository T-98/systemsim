/**
 * @file ai/generateDiagram.ts
 *
 * Client wrapper for the /api/generate-diagram Edge Function. Text-to-diagram
 * and remix both use this. Returns a validated CanonicalGraph ready for
 * replaceGraph, or a typed error.
 */

import type { CanonicalGraph } from '../types';
import { callAIEndpoint, type AICallResult } from './_shared/aiClient';

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

  const result: AICallResult<CanonicalGraph> = await callAIEndpoint({
    endpoint: '/api/generate-diagram',
    body: { text, mode, currentGraph },
    signal,
    mapSuccess: (json) => {
      const obj = json as { graph?: CanonicalGraph };
      return obj && obj.graph ? obj.graph : null;
    },
  });

  if (result.ok) {
    return { ok: true, graph: result.data };
  }
  return { ok: false, kind: result.kind, message: result.message };
}
