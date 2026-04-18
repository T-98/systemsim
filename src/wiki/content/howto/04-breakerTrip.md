# Trip a circuit breaker

Circuit breakers do nothing when the downstream is healthy. This scenario forces a downstream over threshold long enough to trip the breaker, then watches it heal through the HALF_OPEN state.

<CanvasEmbed template="breakerTrip" />

## What to watch for

- **Traffic ramps. Downstream DB saturates, errorRate climbs past 0.5** — breaker threshold.
- **CLOSED → OPEN** — log shows "Circuit breaker opened." Traffic on the wire drops to zero.
- **Cooldown (10s default) elapses.** **OPEN → HALF_OPEN.** Log shows "half-open."
- **Probe ticks succeed** (2 clean ticks default). **HALF_OPEN → CLOSED.** Log shows "closed."
- **If the downstream is still saturated during probe**, you see **HALF_OPEN → OPEN** immediately. The breaker won't close until real recovery.

## The gotcha

A HALF_OPEN breaker needs *actual traffic* to recover. If traffic stops for the duration of the cooldown + probe window, the breaker stays HALF_OPEN indefinitely — it won't self-close on zero traffic. That's deliberate: "no one asked" isn't the same as "downstream is healthy." See [§40 Circuit Breaker State Machine](#docs/reference/40-circuit-breaker-state-machine) §40.4.
