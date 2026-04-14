export type AICallResult<TData> =
  | { ok: true; data: TData }
  | { ok: false; kind: 'network' | 'rate_limit' | 'validation' | 'api_error' | 'aborted'; message: string };

export interface AICallOptions<TRequest, TData> {
  endpoint: string;
  body: TRequest;
  signal?: AbortSignal;
  mapSuccess: (json: unknown) => TData | null;
}

/**
 * Shared client caller for Anthropic-backed API endpoints.
 * Maps fetch/HTTP errors onto the discriminated `AICallResult` union.
 *
 * Caller responsibilities:
 *   - Build the request body shape the endpoint expects
 *   - Provide `mapSuccess` to pull the typed data out of the JSON response
 *     (return null to signal "server sent 200 but the shape is wrong" → api_error)
 */
export async function callAIEndpoint<TRequest, TData>(
  opts: AICallOptions<TRequest, TData>
): Promise<AICallResult<TData>> {
  try {
    const res = await fetch(opts.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts.body),
      signal: opts.signal,
    });

    if (opts.signal?.aborted) {
      return { ok: false, kind: 'aborted', message: 'Request cancelled.' };
    }

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      return { ok: false, kind: 'api_error', message: 'Server returned an unreadable response.' };
    }

    if (res.ok) {
      const parsed = opts.mapSuccess(data);
      if (parsed === null) {
        return { ok: false, kind: 'api_error', message: 'Unexpected server response.' };
      }
      return { ok: true, data: parsed };
    }

    const dataObj = (data ?? {}) as { kind?: string; message?: string };
    const kind = dataObj.kind ?? 'api_error';
    const message = dataObj.message ?? 'Something went wrong.';

    if (res.status === 429 || kind === 'rate_limit') {
      return { ok: false, kind: 'rate_limit', message };
    }
    if (kind === 'validation') {
      return { ok: false, kind: 'validation', message };
    }
    if (kind === 'network') {
      return { ok: false, kind: 'network', message };
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
