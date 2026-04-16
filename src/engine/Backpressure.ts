/**
 * @file Backpressure.ts
 *
 * Backpressure: each non-crashed component with backpressure enabled
 * computes an `acceptanceRate ∈ [0, 1]` at end of tick from its `errorRate`.
 * Upstream callers reading the PREVIOUS tick's `acceptanceRate` scale their
 * forwarded RPS down proportionally. One-tick propagation delay matches
 * real systems (upstream cannot instantly know downstream saturation).
 *
 * The feedback loop:
 *
 *   downstream errorRate ↑  →  acceptanceRate ↓  →  upstream forwards less
 *   next tick  →  downstream less saturated  →  acceptanceRate recovers
 *
 * Pairs naturally with retry storms (3.2): amplification pushes more in,
 * backpressure scales more out — net effect self-stabilizes around the
 * downstream's sustainable throughput.
 *
 * Opt-in via target component's `config.backpressure = { enabled: true }`.
 * Absent or disabled = no behavior change.
 */

export interface BackpressureConfig {
  enabled: boolean;
  // Future: smoothing: number (0-1), hysteresis, etc.
}

/**
 * Read a component's backpressure config from its config blob. Returns
 * undefined when disabled or absent — caller should treat that as "no
 * backpressure signal."
 */
export function readBackpressureConfig(config: Record<string, unknown>): BackpressureConfig | undefined {
  const raw = config.backpressure as Partial<BackpressureConfig> | undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  if (raw.enabled !== true) return undefined;
  return { enabled: true };
}

/**
 * Derive acceptanceRate from errorRate. Simple inverse: healthy tick
 * (errorRate = 0) → acceptanceRate = 1 (fully accepting). Failing tick
 * (errorRate = 1) → acceptanceRate = 0 (reject all). Clamped to [0, 1].
 */
export function computeAcceptanceRate(errorRate: number): number {
  return Math.max(0, Math.min(1, 1 - errorRate));
}
