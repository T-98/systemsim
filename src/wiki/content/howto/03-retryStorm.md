# Reproduce a retry storm

A retry storm is what happens when an upstream service aggressively retries a failing downstream. Each retry adds load; load causes more failures; more failures trigger more retries. The downstream crashes from the amplification, not the original fault.

<CanvasEmbed template="retryStorm" />

## What to watch for

- **Retry-storm callout** fires when the effective amplification factor on a wire crosses 1.5×.
- **DB error rate** climbs past 50% (real bugs start to compound with the retry pressure).
- **Server p99** explodes — each request is waiting through `maxRetries` downstream failures.

## Fix direction

1. **Turn on the circuit breaker** on the upstream's wire to the downstream. Traffic drops at this wire when the failure threshold trips; the downstream gets a chance to recover.
2. **Turn on backpressure** on the downstream. It signals saturation; the upstream scales down by `acceptanceRate`.
3. **At steady state, retries + backpressure compose to ~1×**: `(1 + e + e² + …) × (1 − e) ≈ 1`. That's why the combination is stable when retries alone are not. See [§41 Retry Storm Amplification](#docs/reference/41-retry-storm-amplification).
