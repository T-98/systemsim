import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
import { TOOL_SCHEMA, validateAndRewrite, applyLabelPresets } from '../src/ai/diagramSchema';
import { buildPrompt, PROMPT_VERSION } from '../src/ai/diagramPrompt';

const MAX_PAYLOAD_BYTES = 32 * 1024;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: true, kind: 'api_error', message: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: true, kind: 'api_error', message: 'API key not configured' });
  }

  const contentLength = req.headers['content-length'];
  if (contentLength && parseInt(contentLength) > MAX_PAYLOAD_BYTES) {
    return res.status(413).json({ error: true, kind: 'validation', message: 'Payload too large' });
  }

  const body = req.body;
  if (!body?.text || typeof body.text !== 'string' || body.text.trim().length < 10) {
    return res.status(400).json({ error: true, kind: 'validation', message: 'Description too short' });
  }

  const mode = body.mode === 'remix' ? 'remix' : 'generate';
  const { system, user } = buildPrompt({
    mode,
    userText: body.text,
    currentGraph: body.currentGraph,
  });

  try {
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system,
      messages: [{ role: 'user', content: user }],
      tools: [TOOL_SCHEMA as any],
      tool_choice: { type: 'tool', name: 'generate_system_diagram' },
    });

    const toolBlock = response.content.find((b) => b.type === 'tool_use');
    if (!toolBlock || toolBlock.type !== 'tool_use') {
      return res.status(502).json({ error: true, kind: 'validation', message: 'AI did not produce a diagram' });
    }

    const result = validateAndRewrite(toolBlock.input);
    if (!result.ok) {
      console.error(`[generate-diagram] validation failed: ${result.reason}`, { promptVersion: PROMPT_VERSION });
      return res.status(422).json({
        error: true,
        kind: 'validation',
        message: 'Generation failed. Try rephrasing your description.',
        reason: result.reason,
      });
    }

    const graphWithPresets = applyLabelPresets(result.graph);
    return res.status(200).json({ graph: graphWithPresets, promptVersion: PROMPT_VERSION });
  } catch (err: unknown) {
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: true, kind: 'rate_limit', message: 'Too many requests. Wait a moment.' });
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return res.status(502).json({ error: true, kind: 'network', message: "Couldn't reach the service. Try again." });
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[generate-diagram] error:', message);
    return res.status(502).json({ error: true, kind: 'api_error', message: 'Something went wrong. Try again.' });
  }
}
