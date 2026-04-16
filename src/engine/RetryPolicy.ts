/**
 * @file RetryPolicy.ts
 *
 * Retry storm modeling for the simulation engine. When an upstream component
 * (LB, server, API gateway) forwards traffic to a downstream that is erroring,
 * retries amplify the effective RPS hitting that downstream. In the real
 * world this is one of the top causes of cascading failure: a slightly-
 * unhealthy database gets hit with 3-5x its nominal load as every caller
 * dutifully retries.
 *
 * Model:
 *
 *   Each upstream may have `config.retryPolicy = { maxRetries, backoffMs?,
 *   backoffMultiplier? }`. When forwarding over a wire whose downstream's
 *   errorRate (from the PREVIOUS tick) was > 0, the effective RPS is:
 *
 *     amplifiedRps = rps × (1 + e + e² + … + e^maxRetries)
 *
 *   where e = last tick's observedErrorRate. Bounded by 1/(1−e) in the limit.
 *
 * Why previous tick: we can't observe errorRate until the downstream processes
 * the request, and we can't re-recurse mid-tick without losing the per-tick
 * aggregate metrics. Using the previous tick's observation matches the
 * one-tick propagation delay planned for backpressure (3.3).
 *
 * Same-tick bundling is a simplification: real retries span seconds, our ticks
 * are 1s. The aggregate amplification factor is what matters for capacity
 * modeling ("your DB is taking 3x its nominal load because of retries").
 */

export interface RetryPolicy {
  /** max retries per failed request (0 = no retries, same as no policy) */
  maxRetries: number;
  /** wait before first retry in ms (display only — not used to delay simulation ticks) */
  backoffMs?: number;
  /** exponential backoff multiplier (display only) */
  backoffMultiplier?: number;
}

/**
 * Compute the RPS amplification factor given a downstream errorRate and a
 * retry policy. Returns 1.0 when no retries would fire (errorRate = 0 or
 * maxRetries = 0).
 *
 * Geometric sum: `1 + e + e² + … + e^maxRetries`.
 */
export function computeAmplification(errorRate: number, policy: RetryPolicy): number {
  if (errorRate <= 0 || policy.maxRetries <= 0) return 1;
  const e = Math.min(1, Math.max(0, errorRate));
  let factor = 1;
  let power = e;
  for (let i = 0; i < policy.maxRetries; i++) {
    factor += power;
    power *= e;
  }
  return factor;
}

/**
 * Read a component's retry policy off its config object. Returns undefined
 * when no policy is configured (default behavior: no retries, no amplification).
 */
export function readRetryPolicy(config: Record<string, unknown>): RetryPolicy | undefined {
  const raw = config.retryPolicy as Partial<RetryPolicy> | undefined;
  // Reject null, arrays, primitives, functions — only plain objects.
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const n = raw.maxRetries;
  // maxRetries must be a finite, positive integer. Reject Infinity (hangs
  // computeAmplification's loop), NaN, fractions (1.5 retries is nonsense),
  // zero and negative (= no retries, same as no policy).
  if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return undefined;
  return {
    maxRetries: n,
    backoffMs: typeof raw.backoffMs === 'number' && Number.isFinite(raw.backoffMs) ? raw.backoffMs : undefined,
    backoffMultiplier: typeof raw.backoffMultiplier === 'number' && Number.isFinite(raw.backoffMultiplier) ? raw.backoffMultiplier : undefined,
  };
}
