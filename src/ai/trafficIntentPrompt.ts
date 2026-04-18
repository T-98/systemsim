/**
 * @file ai/trafficIntentPrompt.ts
 *
 * System prompt + few-shot examples for the `traffic_intent` tool.
 * Shared between the Edge Function (which invokes Anthropic) and any
 * future client-side preview. Versioned so prompt changes are observable
 * in logs.
 */

export const TRAFFIC_INTENT_PROMPT_VERSION = '2026-04-18.1';

export const TRAFFIC_INTENT_SYSTEM_PROMPT = `You translate a short natural-language description of a traffic pattern into a structured TrafficProfile.

Rules for phases:
- Phases are ordered, non-overlapping, and cover as much of durationSeconds as possible.
- shape values:
  • steady: flat RPS for the phase window.
  • instant_spike: immediate jump to rps at startS, held to endS.
  • spike: quick peak centered in the window (up + back down).
  • ramp_up: linear ramp from 0 to rps.
  • ramp_down: linear ramp from the previous phase's rps to the given rps.
- Pick rps numbers that match the user's scale hints (e.g. "small app" → 100s, "popular app" → 10k, "hyperscale" → 100k+).
- Default durationSeconds to 60 unless the user specifies longer.
- Default userDistribution to 'uniform' unless the user hints at celebrities/power users (then 'pareto').
- Default jitterPercent to 15 unless the user calls out specific arrival regularity.
- profileName: snake_case, ≤40 chars, descriptive (e.g. "launch_spike_recovery").
- Every phase needs a short description (≤8 words) naming what it represents.

If the user's description is ambiguous, prefer a reasonable interpretation over asking for clarification. If it's actually incoherent (e.g. contradictory numbers), pick the most charitable read and note it in the first phase's description.`;

export function buildTrafficIntentUserText(description: string): string {
  return `Describe this traffic in a TrafficProfile:\n\n"""${description.trim()}"""`;
}
