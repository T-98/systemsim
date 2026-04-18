/**
 * @file components/panels/liveLog/calloutPhrases.ts
 *
 * Maps known callout phrases in live-log messages to wiki topic keys.
 * The engine emits free-text messages (no structured topic field on
 * LogEntry — see [src/engine/SimulationEngine.ts:224](src/engine/SimulationEngine.ts)
 * `fireCallout`), so we parse the message text on the render side.
 *
 * Detection is best-effort: if no phrase matches, the row renders as
 * plain text. If a phrase matches, we wrap it in a hoverable element
 * that opens the topic's popover (shortDescription + "Learn more →").
 *
 * Source of phrases: grep for `logs.push` and `fireCallout` in
 * `src/engine/`. Keep this file in sync when new callouts are added.
 */

export interface CalloutPhrase {
  /** Topic registry key (e.g. `concept.circuitBreakerStates`). */
  topic: string;
  /**
   * Regex to find the phrase in a message. Authors declare source + flags
   * here (don't pre-add `g` — the scanner adds it once on module load).
   */
  pattern: RegExp;
}

const PHRASES_SOURCE: CalloutPhrase[] = [
  // Circuit breaker
  { topic: 'concept.circuitBreakerStates', pattern: /circuit breaker (opened|closed|half[- ]open|tripped)/i },
  { topic: 'concept.circuitBreakerStates', pattern: /breaker (opened|closed|half[- ]open|tripped)/i },

  // Retry storm
  { topic: 'concept.retryStorm', pattern: /retry (storm|amplification)/i },
  { topic: 'concept.retryStorm', pattern: /retries (amplifying|multiplied)/i },

  // Backpressure
  { topic: 'concept.backpressure', pattern: /signaling backpressure/i },
  { topic: 'concept.backpressure', pattern: /backpressure/i },

  // Saturation / utilization (Little's Law queueing).
  // Match the whole ρ value (including decimals) so "ρ=0.92" doesn't get truncated to "ρ=0".
  // Drop the broad /utilization/i — too many false positives on unrelated utilization mentions.
  { topic: 'concept.utilization', pattern: /ρ=\s*\d+(?:\.\d+)?/i },
  { topic: 'concept.utilization', pattern: /queueing collapse/i },

  // Cache failures
  { topic: 'concept.cacheStampede', pattern: /cache (stampede|miss storm)/i },

  // Hot shard
  { topic: 'concept.hotShard', pattern: /hot shard/i },
  { topic: 'concept.hotShard', pattern: /shard-\d+ memory/i },

  // p50/p95/p99
  { topic: 'concept.p50p95p99', pattern: /p(50|95|99)=/i },
];

/**
 * Pre-compiled regex objects with the `g` flag, built once at module load.
 * Avoids allocating a fresh RegExp per message per render in hot paths.
 */
export const CALLOUT_PHRASES: readonly Readonly<{ topic: string; pattern: RegExp }>[] = PHRASES_SOURCE.map((p) => ({
  topic: p.topic,
  pattern: new RegExp(p.pattern.source, p.pattern.flags.includes('g') ? p.pattern.flags : p.pattern.flags + 'g'),
}));

export interface PhraseMatch {
  topic: string;
  start: number;
  end: number;
  text: string;
}

/**
 * Scan a message for callout phrases. Returns non-overlapping matches in
 * order. If multiple patterns match the same range, the first declared
 * pattern wins (simple deterministic ordering).
 */
export function matchCalloutPhrases(message: string): PhraseMatch[] {
  const matches: PhraseMatch[] = [];
  for (const phrase of CALLOUT_PHRASES) {
    // Reset lastIndex because these are stateful global-flagged regexes reused across calls.
    phrase.pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = phrase.pattern.exec(message))) {
      const start = m.index;
      const end = m.index + m[0].length;
      // Skip if this range overlaps an earlier match.
      if (matches.some((existing) => rangesOverlap(existing, { start, end }))) continue;
      matches.push({ topic: phrase.topic, start, end, text: m[0] });
    }
  }
  // Sort by start position so the renderer can walk left-to-right.
  matches.sort((a, b) => a.start - b.start);
  return matches;
}

// Small per-message memoization — avoids re-segmenting the same string across
// re-renders (liveLog appends rarely change already-rendered messages).
const segmentCache = new Map<string, MessageSegment[]>();
const SEGMENT_CACHE_MAX = 500;

function rangesOverlap(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

export interface MessageSegment {
  kind: 'text' | 'phrase';
  text: string;
  topic?: string;
}

/**
 * Split a message into alternating text and phrase segments for render.
 * Memoized on the raw message string — liveLog entries are immutable once
 * appended, so repeated renders reuse the cached segmentation.
 */
export function segmentMessage(message: string): MessageSegment[] {
  const cached = segmentCache.get(message);
  if (cached) return cached;

  const matches = matchCalloutPhrases(message);
  const segs: MessageSegment[] = [];
  if (matches.length === 0) {
    segs.push({ kind: 'text', text: message });
  } else {
    let cursor = 0;
    for (const m of matches) {
      if (m.start > cursor) segs.push({ kind: 'text', text: message.slice(cursor, m.start) });
      segs.push({ kind: 'phrase', text: m.text, topic: m.topic });
      cursor = m.end;
    }
    if (cursor < message.length) segs.push({ kind: 'text', text: message.slice(cursor) });
  }

  if (segmentCache.size >= SEGMENT_CACHE_MAX) {
    // Drop the oldest entry (insertion-order Map) to keep the cache bounded.
    const firstKey = segmentCache.keys().next().value;
    if (firstKey !== undefined) segmentCache.delete(firstKey);
  }
  segmentCache.set(message, segs);
  return segs;
}

/** Test-only: reset the per-message memoization. */
export function __resetSegmentCacheForTests() {
  segmentCache.clear();
}
