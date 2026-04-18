# Configuring a wire

Click a wire (any edge between two components), and the right panel switches to wire configuration.

## Three fields

- **Throughput (RPS)** — informational hint. The engine does *not* enforce this as a cap; it's a note to yourself about what the wire was specified to carry. Enforcement happens at component level (server concurrency, DB pool, etc.).
- **Latency (ms)** — base one-way latency added every time a request crosses this wire. Defaults to 2ms (intra-data-center), which is realistic.
- **Jitter (ms)** — uniform ± on top of latency. Sampled once per wire per tick (not per packet), so different ticks see different delays but all traffic in a given tick sees the same delay on that wire.

## How latency compounds

Latency accumulates across a path. A 4-hop chain with 50ms per wire adds 200ms to every downstream component's reported p50/p95/p99 — before the components add their own processing time. This is why over-hopping kills p99 even when each hop is fast.

Most components propagate the accumulated latency (Server, Cache, DB, API Gateway). Load Balancer and Queue do not (they report their own timing on different baselines). Don't sum LB latency + Server latency to get end-to-end — read the terminal component instead. See [§43 Wire-Level Configuration](#docs/reference/43-wire-level-configuration).

## Circuit breaker (opt-in)

Per-wire opt-in. When the downstream errors over threshold for N consecutive ticks, the breaker opens and traffic drops at this wire for a cooldown period. See [§40 Circuit Breaker State Machine](#docs/reference/40-circuit-breaker-state-machine) for the full state-machine + the fan-in caveat.

Next: [Traffic profiles](#docs/learn/traffic-profiles).
