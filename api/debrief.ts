import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';

const MAX_PAYLOAD_BYTES = 16 * 1024;

const SYSTEM_PROMPT = `You are a senior distributed systems engineer conducting a post-mortem review. You have just observed a simulation of a system architecture under realistic traffic. Your job is to ask Socratic questions that guide the engineer toward discovering what went wrong and why.

Rules:
- NEVER give direct answers or solutions
- Ask 3-5 specific questions tied to the metrics and failures you observed
- Reference exact numbers from the simulation (RPS, latency, error rates, shard distributions)
- Each question should lead the engineer toward discovering a specific failure mode
- Frame questions as "What would a senior engineer ask in this design review?"
- Be concise. One question per point.`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: true, message: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: true, message: 'API key not configured' });
  }

  const contentLength = req.headers['content-length'];
  if (contentLength && parseInt(contentLength) > MAX_PAYLOAD_BYTES) {
    return res.status(413).json({ error: true, message: 'Payload too large' });
  }

  const body = req.body;
  if (!body?.summary || typeof body.summary !== 'string') {
    return res.status(400).json({ error: true, message: 'Missing summary field' });
  }

  try {
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: body.summary }],
    });

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.type === 'text' ? b.text : '')
      .join('\n');

    const questions = text
      .split(/\n+/)
      .map((line) => line.replace(/^\d+[\.\)]\s*/, '').trim())
      .filter((line) => line.length > 10 && line.includes('?'));

    return res.status(200).json({ questions, summary: text });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[debrief] error:', message);
    return res.status(502).json({ error: true, message: 'AI service unavailable' });
  }
}
