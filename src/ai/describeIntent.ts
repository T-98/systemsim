import type { DescribeIntentOutput } from './describeIntentSchema';
import { callAIEndpoint, type AICallResult } from './_shared/aiClient';

export type DescribeIntentResult =
  | { ok: true; data: DescribeIntentOutput }
  | { ok: false; kind: 'network' | 'rate_limit' | 'validation' | 'api_error' | 'aborted'; message: string };

export interface DescribeIntentRequest {
  text?: string;
  imageBase64?: string;
  mimeType?: string;
  signal?: AbortSignal;
}

export async function describeIntent(req: DescribeIntentRequest): Promise<DescribeIntentResult> {
  const { text, imageBase64, mimeType, signal } = req;

  const result: AICallResult<DescribeIntentOutput> = await callAIEndpoint({
    endpoint: '/api/describe-intent',
    body: { text, imageBase64, mimeType },
    signal,
    mapSuccess: (json) => {
      const obj = json as DescribeIntentOutput | undefined;
      if (!obj || typeof obj.intent !== 'string' || typeof obj.connections !== 'string') return null;
      if (!Array.isArray(obj.components)) return null;
      return obj;
    },
  });

  if (result.ok) {
    return { ok: true, data: result.data };
  }
  return { ok: false, kind: result.kind, message: result.message };
}
