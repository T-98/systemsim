/**
 * @file ai/anthropicDebrief.ts
 *
 * Client-side wrapper for the /api/debrief Edge Function. Catches any
 * network / validation / LLM error and returns `null` so the deterministic
 * debrief stays visible. The UI shows an "AI debrief unavailable" banner on
 * null.
 */

/** Shape returned by the /api/debrief endpoint. */
export interface AIDebriefResult {
  questions: string[];
  summary: string;
}

/**
 * POST the simulation summary to /api/debrief. Returns `null` on any error —
 * the caller must fall back to the deterministic debrief.
 */
export async function fetchAIDebrief(
  simulationSummary: string,
  scenarioId?: string | null,
): Promise<AIDebriefResult | null> {
  try {
    const response = await fetch('/api/debrief', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary: simulationSummary, scenarioId: scenarioId ?? undefined }),
    });

    if (!response.ok) {
      console.warn(`AI debrief API returned ${response.status}`);
      return null;
    }

    const data = await response.json();

    if (data.error) {
      console.warn('AI debrief error:', data.message);
      return null;
    }

    if (!Array.isArray(data.questions)) {
      console.warn('AI debrief returned malformed response');
      return null;
    }

    return { questions: data.questions, summary: data.summary ?? '' };
  } catch (err) {
    console.warn('AI debrief fetch failed:', err);
    return null;
  }
}
