/**
 * @file api/traffic-intent.ts
 *
 * Vercel Edge Function for traffic natural-language → structured
 * TrafficProfile. Uses Claude Sonnet 4.6 (text-only; no vision here).
 * Mirrors the describe-intent handler shape: tool_choice forces structured
 * output, validation rejects malformed shapes with 422 + a reason code.
 */

import { createAnthropicHandler } from './_shared/handler';
import { MODEL_ID } from './_shared/constants';
import {
  TRAFFIC_INTENT_TOOL_SCHEMA,
  validateTrafficIntent,
} from '../src/ai/trafficIntentSchema';
import {
  TRAFFIC_INTENT_SYSTEM_PROMPT,
  TRAFFIC_INTENT_PROMPT_VERSION,
  buildTrafficIntentUserText,
} from '../src/ai/trafficIntentPrompt';

const MAX_PAYLOAD_BYTES = 32 * 1024; // 32 KB — this endpoint only takes text.
const MIN_DESC_LEN = 4;
const MAX_DESC_LEN = 2000;

export default createAnthropicHandler({
  endpointName: 'traffic-intent',
  maxPayloadBytes: MAX_PAYLOAD_BYTES,
  handler: async ({ req, res, anthropic }) => {
    const body = req.body ?? {};
    const description = typeof body.description === 'string' ? body.description.trim() : '';

    if (description.length < MIN_DESC_LEN) {
      res.status(400).json({
        error: true,
        kind: 'validation',
        message: 'Describe the traffic you want (e.g. "ramp to 500 rps then spike to 5000 for 10s").',
      });
      return;
    }
    if (description.length > MAX_DESC_LEN) {
      res.status(400).json({
        error: true,
        kind: 'validation',
        message: 'Description too long.',
      });
      return;
    }

    const userText = buildTrafficIntentUserText(description);

    const response = await anthropic.messages.create({
      model: MODEL_ID,
      max_tokens: 1024,
      system: TRAFFIC_INTENT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userText }],
      tools: [TRAFFIC_INTENT_TOOL_SCHEMA as never],
      tool_choice: { type: 'tool', name: 'traffic_intent' },
    });

    const toolBlock = response.content.find((b) => b.type === 'tool_use');
    if (!toolBlock || toolBlock.type !== 'tool_use') {
      res.status(502).json({
        error: true,
        kind: 'validation',
        message: "Couldn't parse that traffic description. Try rewording it.",
      });
      return;
    }

    const validation = validateTrafficIntent(toolBlock.input);
    if (!validation.ok) {
      // Keep the structured reason code server-side only (Datadog / Vercel logs).
      // Don't expose internal validation identifiers to the client.
      console.error('[traffic-intent] validation failed:', validation.reason, {
        promptVersion: TRAFFIC_INTENT_PROMPT_VERSION,
      });
      res.status(422).json({
        error: true,
        kind: 'validation',
        message: "Couldn't parse that traffic description. Try rewording it.",
      });
      return;
    }

    res.status(200).json({
      ...validation.data,
      promptVersion: TRAFFIC_INTENT_PROMPT_VERSION,
    });
  },
});
