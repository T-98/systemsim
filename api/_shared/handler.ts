import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';

export type HandlerErrorKind =
  | 'validation'
  | 'rate_limit'
  | 'network'
  | 'api_error';

export interface HandlerContext {
  req: VercelRequest;
  res: VercelResponse;
  anthropic: Anthropic;
}

export interface HandlerOptions {
  maxPayloadBytes: number;
  handler: (ctx: HandlerContext) => Promise<void>;
  endpointName: string;
}

/**
 * Wraps a Vercel Node handler with the common Anthropic-endpoint plumbing:
 *   - method check (POST only, 405)
 *   - ANTHROPIC_API_KEY presence check (500)
 *   - content-length guard against oversize payloads (413)
 *   - construction of an `Anthropic` SDK client passed into the handler
 *   - centralized Anthropic error mapping (rate_limit, network, api_error)
 *
 * Consumer handler signature:
 *   async ({ req, res, anthropic }) => {
 *     // validate body, build messages, call anthropic.messages.create,
 *     // then res.status(200).json(...)
 *   }
 *
 * Example:
 *   export default createAnthropicHandler({
 *     endpointName: 'describe-intent',
 *     maxPayloadBytes: 6 * 1024 * 1024,
 *     handler: async ({ req, res, anthropic }) => { ... },
 *   });
 */
export function createAnthropicHandler(opts: HandlerOptions) {
  return async function (req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: true, kind: 'api_error', message: 'Method not allowed' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: true, kind: 'api_error', message: 'API key not configured' });
    }

    const contentLength = req.headers['content-length'];
    if (contentLength && parseInt(contentLength) > opts.maxPayloadBytes) {
      return res.status(413).json({ error: true, kind: 'validation', message: 'Payload too large' });
    }

    const anthropic = new Anthropic({ apiKey });

    try {
      await opts.handler({ req, res, anthropic });
    } catch (err: unknown) {
      if (res.headersSent) {
        console.error(`[${opts.endpointName}] post-response error:`, err);
        return;
      }
      if (err instanceof Anthropic.RateLimitError) {
        return res.status(429).json({ error: true, kind: 'rate_limit', message: 'Too many requests. Wait a moment.' });
      }
      if (err instanceof Anthropic.APIConnectionError) {
        return res.status(502).json({ error: true, kind: 'network', message: "Couldn't reach the service. Try again." });
      }
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[${opts.endpointName}] error:`, message);
      return res.status(502).json({ error: true, kind: 'api_error', message: 'Something went wrong. Try again.' });
    }
  };
}
