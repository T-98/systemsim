# Run Stressed

Normal Run honors your traffic profile's phases — ramps, cool-downs, dips. Run Stressed throws that out and **holds the peak for the entire duration**, plus a few other worst-case toggles.

## What Stressed mode changes

- **Traffic** — `getCurrentRps()` returns `max(phases.rps)` regardless of tick time. No ramps, no cool-downs.
- **Wire latency** — instead of `latencyMs + uniform(-jitterMs, +jitterMs)`, every wire uses `latencyMs + jitterMs` (the top of the jitter window). Worst-case p99 on every hop.
- **Cache warmup** — caches start cold (0% hit rate) and don't pre-warm. You see the stampede against the origin before caches stabilize.
- **Everything else stays** — components, traffic mix, resilience toggles all unchanged.

## When to use it

- **Before shipping.** Run Stressed is closer to "how does this look during a real incident" than normal Run.
- **Before a capacity review.** Whoever challenges your architecture will imagine this. See it first.
- **To size something.** If you're deciding between 3 and 6 server instances, Stressed tells you which one survives.

## The debrief badge

Debrief shows a `[Stressed]` badge when the latest run used this mode. Scores are comparable within Stressed — a 7/10 Stressed is often a 9/10 normal. Don't mix them.

See [§40.3 + §43.3 + §44.4] for the implementation details ([§40 Circuit Breaker](#docs/reference/40-circuit-breaker-state-machine), [§43 Wire-Level Config](#docs/reference/43-wire-level-configuration), [§44 Traffic Profile](#docs/reference/44-traffic-profile-semantics)).

Next: [Save & load sessions](#docs/learn/save-and-load-sessions).
