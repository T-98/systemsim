# api/_shared

Shared helpers for Vercel Node API endpoints that call Anthropic.

Use `createAnthropicHandler` in every new endpoint so method check, API key
presence, payload cap, and Anthropic error mapping live in one place.

Pattern reference: see `api/describe-intent.ts` and `api/generate-diagram.ts`.

`constants.ts` owns `MODEL_ID`. Bump the Anthropic model in one place; all
endpoints follow.
