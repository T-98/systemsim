export const config = { runtime: 'edge' };

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MAX_PAYLOAD_BYTES = 32 * 1024;
const TIMEOUT_MS = 15_000;

import { TOOL_SCHEMA, validateAndRewrite } from '../src/ai/diagramSchema';
import { buildPrompt, PROMPT_VERSION } from '../src/ai/diagramPrompt';

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: true, kind: 'api_error', message: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return jsonResponse(500, { error: true, kind: 'api_error', message: 'API key not configured' });
  }

  const contentLength = req.headers.get('content-length');
  if (contentLength && parseInt(contentLength) > MAX_PAYLOAD_BYTES) {
    return jsonResponse(413, { error: true, kind: 'validation', message: 'Payload too large' });
  }

  let body: { text: string; mode?: 'generate' | 'remix'; currentGraph?: any };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: true, kind: 'validation', message: 'Invalid JSON' });
  }

  if (!body.text || typeof body.text !== 'string' || body.text.trim().length < 10) {
    return jsonResponse(400, { error: true, kind: 'validation', message: 'Description too short' });
  }

  const mode = body.mode === 'remix' ? 'remix' : 'generate';
  const { system, user } = buildPrompt({
    mode,
    userText: body.text,
    currentGraph: body.currentGraph,
  });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        system,
        messages: [{ role: 'user', content: user }],
        tools: [TOOL_SCHEMA],
        tool_choice: { type: 'tool', name: 'generate_system_diagram' },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.status === 429) {
      return jsonResponse(429, { error: true, kind: 'rate_limit', message: 'Too many requests. Wait a moment.' });
    }

    if (!response.ok) {
      return jsonResponse(502, { error: true, kind: 'api_error', message: `Anthropic API error: ${response.status}` });
    }

    const data = await response.json();

    const toolBlock = data.content?.find((b: any) => b.type === 'tool_use');
    if (!toolBlock?.input) {
      return jsonResponse(502, { error: true, kind: 'validation', message: 'AI did not produce a diagram' });
    }

    const result = validateAndRewrite(toolBlock.input);
    if (!result.ok) {
      console.error(`[generate-diagram] validation failed: ${result.reason}`, { promptVersion: PROMPT_VERSION });
      return jsonResponse(422, {
        error: true,
        kind: 'validation',
        message: 'Generation failed. Try rephrasing your description.',
        reason: result.reason,
      });
    }

    return jsonResponse(200, {
      graph: result.graph,
      promptVersion: PROMPT_VERSION,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      return jsonResponse(504, { error: true, kind: 'api_error', message: 'Request timed out. Try again.' });
    }
    return jsonResponse(502, { error: true, kind: 'network', message: "Couldn't reach the service. Try again." });
  }
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
