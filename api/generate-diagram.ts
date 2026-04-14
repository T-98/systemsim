import { createAnthropicHandler } from './_shared/handler';
import { MODEL_ID } from './_shared/constants';
import { TOOL_SCHEMA, validateAndRewrite } from '../src/ai/diagramSchema';
import { buildPrompt, PROMPT_VERSION } from '../src/ai/diagramPrompt';

const MAX_PAYLOAD_BYTES = 32 * 1024;

export default createAnthropicHandler({
  endpointName: 'generate-diagram',
  maxPayloadBytes: MAX_PAYLOAD_BYTES,
  handler: async ({ req, res, anthropic }) => {
    const body = req.body;
    if (!body?.text || typeof body.text !== 'string' || body.text.trim().length < 10) {
      res.status(400).json({ error: true, kind: 'validation', message: 'Description too short' });
      return;
    }

    const mode = body.mode === 'remix' ? 'remix' : 'generate';
    const { system, user } = buildPrompt({
      mode,
      userText: body.text,
      currentGraph: body.currentGraph,
    });

    const response = await anthropic.messages.create({
      model: MODEL_ID,
      max_tokens: 2048,
      system,
      messages: [{ role: 'user', content: user }],
      tools: [TOOL_SCHEMA as never],
      tool_choice: { type: 'tool', name: 'generate_system_diagram' },
    });

    const toolBlock = response.content.find((b) => b.type === 'tool_use');
    if (!toolBlock || toolBlock.type !== 'tool_use') {
      res.status(502).json({ error: true, kind: 'validation', message: 'AI did not produce a diagram' });
      return;
    }

    const result = validateAndRewrite(toolBlock.input);
    if (!result.ok) {
      console.error(`[generate-diagram] validation failed: ${result.reason}`, { promptVersion: PROMPT_VERSION });
      res.status(422).json({
        error: true,
        kind: 'validation',
        message: 'Generation failed. Try rephrasing your description.',
        reason: result.reason,
      });
      return;
    }

    res.status(200).json({ graph: result.graph, promptVersion: PROMPT_VERSION });
  },
});
