export const config = { runtime: 'edge' };

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MAX_PAYLOAD_BYTES = 16 * 1024; // 16KB
const TIMEOUT_MS = 15_000;

const SYSTEM_PROMPT = `You are a senior distributed systems engineer conducting a post-mortem review. You have just observed a simulation of a system architecture under realistic traffic. Your job is to ask Socratic questions that guide the engineer toward discovering what went wrong and why.

Rules:
- NEVER give direct answers or solutions
- Ask 3-5 specific questions tied to the metrics and failures you observed
- Reference exact numbers from the simulation (RPS, latency, error rates, shard distributions)
- Each question should lead the engineer toward discovering a specific failure mode
- Frame questions as "What would a senior engineer ask in this design review?"
- Be concise. One question per point.`;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: true, message: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: true, message: 'API key not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate payload size
  const contentLength = req.headers.get('content-length');
  if (contentLength && parseInt(contentLength) > MAX_PAYLOAD_BYTES) {
    return new Response(JSON.stringify({ error: true, message: 'Payload too large' }), {
      status: 413,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: { summary: string; scenarioId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: true, message: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!body.summary || typeof body.summary !== 'string') {
    return new Response(JSON.stringify({ error: true, message: 'Missing summary field' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

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
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: body.summary }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text().catch(() => 'Unknown error');
      return new Response(JSON.stringify({ error: true, message: `Anthropic API error: ${response.status}` }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text ?? '';

    // Parse questions from the response (split on numbered lines or newlines)
    const questions = text
      .split(/\n+/)
      .map((line: string) => line.replace(/^\d+[\.\)]\s*/, '').trim())
      .filter((line: string) => line.length > 10 && line.includes('?'));

    return new Response(JSON.stringify({ questions, summary: text }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error && err.name === 'AbortError'
      ? 'Anthropic API timeout (15s)'
      : 'Anthropic API request failed';

    return new Response(JSON.stringify({ error: true, message }), {
      status: 504,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
