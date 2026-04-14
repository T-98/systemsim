// Mirrors the pattern of api/generate-diagram.ts — vision + tool_use + discriminated-union response.
// Accepts optional text and optional base64 image. Returns { intent, systemSpec, confidence }.
import { createAnthropicHandler } from './_shared/handler';
import { MODEL_ID_VISION } from './_shared/constants';
import {
  decodeBase64Image,
  isAllowedMime,
  validateImageMagicBytes,
  type AllowedMime,
} from './_shared/imageValidation';
import {
  DESCRIBE_INTENT_TOOL_SCHEMA,
  validateDescribeIntent,
} from '../src/ai/describeIntentSchema';
import {
  DESCRIBE_INTENT_SYSTEM_PROMPT,
  DESCRIBE_INTENT_PROMPT_VERSION,
  buildDescribeIntentUserText,
} from '../src/ai/describeIntentPrompt';

const MAX_PAYLOAD_BYTES = 6 * 1024 * 1024;
const MAX_DECODED_IMAGE_BYTES = 5 * 1024 * 1024;
const MIN_TEXT_LEN = 5;

export default createAnthropicHandler({
  endpointName: 'describe-intent',
  maxPayloadBytes: MAX_PAYLOAD_BYTES,
  handler: async ({ req, res, anthropic }) => {
    const body = req.body ?? {};
    const text = typeof body.text === 'string' ? body.text : undefined;
    const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64 : undefined;
    const mimeType = typeof body.mimeType === 'string' ? body.mimeType : undefined;

    const hasText = !!(text && text.trim().length >= MIN_TEXT_LEN);
    const hasImage = !!imageBase64;

    if (!hasText && !hasImage) {
      res.status(400).json({
        error: true,
        kind: 'validation',
        message: 'Describe your system or attach an image.',
      });
      return;
    }

    let validatedMime: AllowedMime | null = null;
    if (hasImage) {
      if (!mimeType || !isAllowedMime(mimeType)) {
        res.status(400).json({
          error: true,
          kind: 'validation',
          message: 'Image format not supported. Use PNG, JPEG, or WebP.',
        });
        return;
      }
      validatedMime = mimeType;

      let decoded: Buffer;
      try {
        decoded = decodeBase64Image(imageBase64!);
      } catch {
        res.status(400).json({
          error: true,
          kind: 'validation',
          message: "Couldn't read this image. Try a different file.",
        });
        return;
      }
      if (decoded.length === 0 || decoded.length > MAX_DECODED_IMAGE_BYTES) {
        res.status(413).json({
          error: true,
          kind: 'validation',
          message: 'Image too large even after resize. Try a smaller screenshot or compress the original PNG before uploading.',
        });
        return;
      }
      if (!validateImageMagicBytes(decoded, validatedMime)) {
        res.status(400).json({
          error: true,
          kind: 'validation',
          message: 'Image format not supported. Use PNG, JPEG, or WebP.',
        });
        return;
      }
    }

    const userText = buildDescribeIntentUserText({ text });

    type ContentBlock =
      | { type: 'text'; text: string }
      | { type: 'image'; source: { type: 'base64'; media_type: AllowedMime; data: string } };
    const content: ContentBlock[] = [];

    if (hasImage && validatedMime) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: validatedMime,
          data: imageBase64!.replace(/^data:[^;]+;base64,/, ''),
        },
      });
    }
    content.push({ type: 'text', text: userText });

    const response = await anthropic.messages.create({
      model: MODEL_ID_VISION,
      max_tokens: 3072,
      system: DESCRIBE_INTENT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: content as never }],
      tools: [DESCRIBE_INTENT_TOOL_SCHEMA as never],
      tool_choice: { type: 'tool', name: 'describe_intent' },
    });

    const toolBlock = response.content.find((b) => b.type === 'tool_use');
    if (!toolBlock || toolBlock.type !== 'tool_use') {
      res.status(502).json({
        error: true,
        kind: 'validation',
        message: "Couldn't read your diagram. Try a clearer image.",
      });
      return;
    }

    const validation = validateDescribeIntent(toolBlock.input);
    if (!validation.ok) {
      console.error('[describe-intent] validation failed:', validation.reason, {
        promptVersion: DESCRIBE_INTENT_PROMPT_VERSION,
      });
      res.status(422).json({
        error: true,
        kind: 'validation',
        message: "Couldn't read your diagram. Try a clearer image.",
        reason: validation.reason,
      });
      return;
    }

    res.status(200).json({
      ...validation.data,
      promptVersion: DESCRIBE_INTENT_PROMPT_VERSION,
    });
  },
});
