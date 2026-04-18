# See backpressure propagate upstream

Backpressure is the downstream saying "slow down" to the upstream. In SystemSim this is a one-tick-delayed signal: downstream computes `acceptanceRate = 1 − errorRate` at tick end; upstream reads it on the next tick and scales its forwarded RPS.

<CanvasEmbed template="backpressurePropagation" />

## What to watch for

- **Downstream saturates.** errorRate climbs. acceptanceRate drops.
- **One tick later, upstream's forwarded RPS drops** — the backpressure callout fires when applied scaling <= 0.7 (downstream rejecting ≥30%).
- **The cascade climbs.** If the upstream ALSO has backpressure enabled, its *own* upstream sees the pushback one tick later. The pressure propagates at one hop per tick.

## Why one-tick delay

Propagation matches real systems. The upstream can't know the downstream is saturated the same instant — there's always at least a network round-trip. In the sim, that round-trip is one 1-second tick. Zero-tick backpressure would be a fictional instant feedback loop.

## What backpressure doesn't fix

It drops *additional* load but doesn't un-saturate the downstream. Once the downstream's queue is full or its error rate is 1, backpressure keeps upstream from making it worse — but recovery requires the downstream's own capacity to catch up with the reduced inflow. See [§42 Backpressure Propagation](#docs/reference/42-backpressure-propagation).
