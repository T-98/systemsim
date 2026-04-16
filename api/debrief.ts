/**
 * @file api/debrief.ts
 *
 * Vercel Edge Function that returns Socratic debrief questions for a
 * completed simulation. Client sends a compressed ~4K-token summary; we
 * call Claude Sonnet 4.6 with a "senior-engineer-post-mortem" system prompt
 * and parse 3-5 questions from the response.
 *
 * Errors fall back gracefully on the client side (deterministic debrief
 * stays visible). See Decisions.md #4, #30.
 */

import { createAnthropicHandler } from './_shared/handler';
import { MODEL_ID } from './_shared/constants';

const MAX_PAYLOAD_BYTES = 16 * 1024;

const SYSTEM_PROMPT = `You are a senior distributed systems engineer conducting a post-mortem review. You have just observed a simulation of a system architecture under realistic traffic. Your job is to ask Socratic questions that guide the engineer toward discovering what went wrong and why.

Rules:
- NEVER give direct answers or solutions
- Ask 3-5 specific questions tied to the metrics and failures you observed
- Reference exact numbers from the simulation (RPS, latency, error rates, shard distributions)
- Each question should lead the engineer toward discovering a specific failure mode
- Frame questions as "What would a senior engineer ask in this design review?"
- Be concise. One question per point.`;

export default createAnthropicHandler({
  endpointName: 'debrief',
  maxPayloadBytes: MAX_PAYLOAD_BYTES,
  handler: async ({ req, res, anthropic }) => {
    const body = req.body;
    if (!body?.summary || typeof body.summary !== 'string') {
      res.status(400).json({ error: true, kind: 'validation', message: 'Missing summary field' });
      return;
    }

    const response = await anthropic.messages.create({
      model: MODEL_ID,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: body.summary }],
    });

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('\n');

    const questions = text
      .split(/\n+/)
      .map((line) => line.replace(/^\d+[\.\)]\s*/, '').trim())
      .filter((line) => line.length > 10 && line.includes('?'));

    res.status(200).json({ questions, summary: text });
  },
});
