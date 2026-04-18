# Configuring a component

Click a node, the right panel opens. Every field has an `(i)` next to it — click for a short description and a "Learn more" link into the Reference tab.

## What's on the panel

- **Label** — display name, editable.
- **Component type header** — Server / Database / Cache / etc. The `(i)` here links to the Reference page for this component type.
- **Type-specific fields** — CPU profile, instance count, throughput, pool size, TTL, shard key, etc. Defaults are deliberately middle-of-the-road (they won't win awards, they won't obviously break).
- **Entry-point toggle** — flip on if this component receives traffic from outside the system. Traffic profiles enter the graph here.
- **Retry policy** (on components that forward) — opt-in. Max retries, backoff, multiplier. Display-only backoff — SIMFID's retry model is geometric amplification at the RPS level. See [§41 Retry Storm Amplification](#docs/reference/41-retry-storm-amplification).
- **Backpressure** (on components that emit errorRate) — opt-in. Signals saturation to callers.
- **Delete component** — at the bottom. Disabled while the sim is running.

## When to change defaults

- **Scale forces it.** Pool size 100 is fine at 1k RPS, obviously wrong at 100k RPS.
- **A preflight item tells you.** Red items route here with a pulse; fix the field it's pointing at.
- **Debrief tells you.** "Server-1 peaked at ρ=0.94" means instance count is low. Bump it, re-run.

## When not to change defaults

When you're just exploring. The sim is cheaper than a real-world experiment; let it fail, read the debrief, then change one thing and re-run. Changing everything at once teaches you nothing.

Next: [Configuring a wire](#docs/learn/configuring-a-wire).
