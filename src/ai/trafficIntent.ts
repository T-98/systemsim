/**
 * @file ai/trafficIntent.ts
 *
 * Client wrapper for /api/traffic-intent. Takes a natural-language
 * description and returns a validated TrafficProfile or a typed error.
 * Mirrors describeIntent's AICallResult-based discriminated union so UI
 * code can switch on `result.ok` and `result.kind` exhaustively.
 */

import type { TrafficProfile } from '../types';
import { callAIEndpoint, type AICallResult } from './_shared/aiClient';

export type TrafficIntentResult =
  | { ok: true; data: TrafficProfile }
  | { ok: false; kind: 'network' | 'rate_limit' | 'validation' | 'api_error' | 'aborted'; message: string };

export interface TrafficIntentRequest {
  description: string;
  signal?: AbortSignal;
}

export async function trafficIntent(req: TrafficIntentRequest): Promise<TrafficIntentResult> {
  const result: AICallResult<TrafficProfile> = await callAIEndpoint({
    endpoint: '/api/traffic-intent',
    body: { description: req.description },
    signal: req.signal,
    mapSuccess: (json) => {
      if (!json || typeof json !== 'object') return null;
      const obj = json as Partial<TrafficProfile>;
      if (typeof obj.profileName !== 'string') return null;
      if (typeof obj.durationSeconds !== 'number') return null;
      if (!Array.isArray(obj.phases)) return null;
      return obj as TrafficProfile;
    },
  });

  if (result.ok) return { ok: true, data: result.data };
  return { ok: false, kind: result.kind, message: result.message };
}
