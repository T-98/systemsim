# Resilience patterns

Three opt-in resilience features. Each is off by default — on purpose, so you can run a naive design first, see it fail, then turn the feature on and see the difference.

## Retry policy (on the upstream)

When a downstream errors, upstream retries. Configured via a component's `retryPolicy = { maxRetries, backoffMs }` in the config panel. The engine models this as **geometric RPS amplification**: `rps × (1 + e + e² + … + e^k)` where `e` is last tick's downstream error rate.

**The gotcha.** Retries amplify load on an already-unhealthy downstream. Without a circuit breaker below, retries make bad worse. See [§41 Retry Storm Amplification](#docs/reference/41-retry-storm-amplification).

## Circuit breaker (per-wire)

Wire config → Circuit breaker toggle. When the downstream's aggregate error rate stays above `failureThreshold` for `failureWindow` ticks, the breaker opens and traffic at this wire drops. After `cooldownSeconds`, moves to HALF_OPEN; `halfOpenTicks` clean probes close it back.

**The gotcha.** Multi-inbound topologies have last-invocation bias — the breaker reads a single mutable `errorRate` on the target, so fan-in behavior is order-dependent. Documented limitation. See [§40 Circuit Breaker State Machine](#docs/reference/40-circuit-breaker-state-machine).

## Backpressure (on the downstream)

Component config → Backpressure toggle. When enabled, the component computes `acceptanceRate = 1 - errorRate` at tick end. Upstream readers scale their forwarded RPS down by this on the *next* tick. One-tick delay by design — real upstream can't know instantly.

**The gotcha.** No traffic ≠ healthy. If a tick has 0 RPS, backpressure skips its update (keeps the previous value). Avoids false recovery through quiet periods. See [§42 Backpressure Propagation](#docs/reference/42-backpressure-propagation).

## Composition: retry + backpressure

At steady state with single-inbound, `(1 + e + e² + …) × (1 − e) ≈ 1`. They cancel. That's why retries + backpressure is stable, while retries alone is unstable. Try both in the How-to tab's [Reproduce a retry storm](#docs/howto/retry-storm) scenario.

This is the last page of the Learn track. Head to **Reference** (top nav) for deep-dives, or **How-to** for five hands-on failure-mode scenarios.
