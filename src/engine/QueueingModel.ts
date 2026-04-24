/**
 * @file QueueingModel.ts
 *
 * Per-instance G/G/1 queueing approximation via the Kingman / Whitt two-
 * moment formula (Whitt 1993). Makes the simulation teach the essential
 * lesson: at ρ → 1, latency explodes — and the bursty variants explode
 * faster than the memoryless one.
 *
 * ρ = λ / (c × μ)  where λ = arrival rate, c = instances, μ = service rate per instance
 *
 *   waitTimeMs ≈ (ρ / (1 − ρ)) × ((Cₐ² + C_s²) / 2) × serviceTime
 *
 * where Cₐ² is the squared coefficient of variation of interarrival times
 * (MODELED from the traffic-phase shape — see callers) and C_s² is the
 * squared coefficient of variation of service times (from `serviceVariance`
 * config, default 1.0). When Cₐ² = C_s² = 1.0 the formula collapses to
 * the M/M/1 special case exactly — pre-Phase-4.6 behavior is preserved
 * for every call site that doesn't opt in.
 *
 * Cₐ² is a modeled prior (not derived from observed inter-arrival times)
 * because the 1-second tick interval doesn't give us a per-request
 * arrival-gap sample to measure. Codex called this out explicitly in the
 * Phase 4.6 review — see Decisions §57.
 *
 * Reference: W. Whitt, "Approximations for the GI/G/m Queue," Production
 * and Operations Management 2 (1993) — the two-moment approximation
 * cited throughout the systems-performance literature.
 *
 * Clamps effective ρ at 0.95 to keep latency finite. Above ρ = 1, models
 * the overflow as request drops (dropRate = 1 − 1/ρ). Wait time capped at
 * 5000ms to keep stressed runs bounded. See Decisions §6 for the
 * original M/M/1 decision and §57 for the Kingman upgrade.
 */

/** Input shape for computeQueueing. */
export interface QueueingInput {
  arrivalRateRps: number;
  processingTimeMs: number;
  instanceCount: number;
  maxConcurrentPerInstance: number;
  /**
   * Cₐ² — squared coefficient of variation of interarrival times.
   *   - 1.0 (default): Poisson-style arrivals (memoryless) → M/M/1.
   *   - 2.0: mild burstiness (ramp phases).
   *   - 4.0 and above: hard burstiness (instant_spike phases). The
   *     Kingman formula is conservative for Cₐ² ≫ 1 — real systems
   *     under an instant 10× load step spike harder than Whitt 1993
   *     predicts, but the directionally-correct answer lands much
   *     closer than M/M/1's "ρ×τ/(1-ρ)" would.
   */
  arrivalVariance?: number;
  /**
   * C_s² — squared coefficient of variation of service times (per
   * request). Pulled from the component's `config.serviceVariance`.
   *   - 1.0 (default): exponential service distribution → M/M/1
   *     regression, bit-identical to pre-Phase-4.6 behavior.
   *   - <1.0: tighter-than-exponential (deterministic systems, batch
   *     workers that complete in consistent time). Cuts wait time.
   *   - >1.0: longer tail (GC pauses, variable I/O). Extends p99.
   */
  serviceVariance?: number;
}

export interface QueueingResult {
  utilization: number;
  waitTimeMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  dropRate: number;
}

/**
 * Compute queueing metrics (utilization, wait time, p50/p95/p99 latency,
 * drop rate) for a server-like component from its arrival rate and capacity.
 * See file docstring for the Kingman formula and the C² meanings.
 */
export function computeQueueing(input: QueueingInput): QueueingResult {
  const {
    arrivalRateRps,
    processingTimeMs,
    instanceCount,
    maxConcurrentPerInstance,
    arrivalVariance = 1.0,
    serviceVariance = 1.0,
  } = input;

  if (arrivalRateRps <= 0 || instanceCount <= 0) {
    return { utilization: 0, waitTimeMs: 0, p50Ms: processingTimeMs, p95Ms: processingTimeMs * 1.5, p99Ms: processingTimeMs * 2, dropRate: 0 };
  }

  const serviceRatePerInstance = 1000 / processingTimeMs;
  const totalServiceRate = serviceRatePerInstance * instanceCount;
  const rawUtilization = arrivalRateRps / totalServiceRate;

  let dropRate = 0;
  if (rawUtilization > 1) {
    dropRate = Math.min(0.95, 1 - (1 / rawUtilization));
  }

  const effectiveUtilization = Math.min(rawUtilization, 0.95);

  // Kingman two-moment approximation. When Ca2 = Cs2 = 1.0 the variance
  // factor is exactly 1.0 and this line collapses to the M/M/1 formula
  // `procTime × ρ / (1-ρ)` that pre-Phase-4.6 tests assert against.
  // Guard against negative variance inputs (defensive; callers should
  // validate but cheap to clamp here).
  const ca2 = Math.max(0, arrivalVariance);
  const cs2 = Math.max(0, serviceVariance);
  const varianceFactor = (ca2 + cs2) / 2;
  const waitTimeMs = effectiveUtilization < 0.95
    ? processingTimeMs * (effectiveUtilization / (1 - effectiveUtilization)) * varianceFactor
    : processingTimeMs * 19 * varianceFactor;

  const maxWaitMs = 5000;
  const clampedWaitMs = Math.min(waitTimeMs, maxWaitMs);
  const totalLatency = processingTimeMs + clampedWaitMs;

  const p50Ms = totalLatency * 0.7;
  const p95Ms = totalLatency * 2.0;
  const p99Ms = totalLatency * 4.0;

  const totalCapacity = maxConcurrentPerInstance * instanceCount;
  const concurrentRequests = arrivalRateRps * (totalLatency / 1000);
  if (dropRate === 0 && concurrentRequests > totalCapacity) {
    dropRate = Math.min(0.95, (concurrentRequests - totalCapacity) / concurrentRequests);
  }

  return {
    utilization: Math.min(rawUtilization, 1),
    waitTimeMs,
    p50Ms,
    p95Ms,
    p99Ms,
    dropRate,
  };
}
