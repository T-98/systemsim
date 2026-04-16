/**
 * M/M/1-per-instance queueing approximation using Little's Law.
 *
 * ρ = λ / (c × μ)  where λ = arrival rate, c = instances, μ = service rate per instance
 * waitTime = processingTime × ρ / (1 - ρ)  (M/M/1 wait formula)
 *
 * Clamps ρ at 0.99 to avoid infinity. Above ρ=1 the queue grows unboundedly,
 * which we model as request drops instead.
 */

export interface QueueingInput {
  arrivalRateRps: number;
  processingTimeMs: number;
  instanceCount: number;
  maxConcurrentPerInstance: number;
}

export interface QueueingResult {
  utilization: number;
  waitTimeMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  dropRate: number;
}

export function computeQueueing(input: QueueingInput): QueueingResult {
  const { arrivalRateRps, processingTimeMs, instanceCount, maxConcurrentPerInstance } = input;

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

  const waitTimeMs = effectiveUtilization < 0.95
    ? processingTimeMs * effectiveUtilization / (1 - effectiveUtilization)
    : processingTimeMs * 19;

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
