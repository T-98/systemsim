// Current-generation Claude models (4.6 family, as of 2026-04).
// Aliases auto-resolve to the latest snapshot. Same pricing as 4.5 family.
// Docs: https://platform.claude.com/docs/en/docs/about-claude/models

export const MODEL_ID = 'claude-sonnet-4-6';

// Vision-heavy endpoints (describe-intent) use Opus for better diagram reading.
// Cost is ~1.67x Sonnet per input token but vision topology accuracy is the V2I moat.
export const MODEL_ID_VISION = 'claude-opus-4-6';
