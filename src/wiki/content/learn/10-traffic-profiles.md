# Traffic profiles

Every simulation needs load. Traffic profiles describe how RPS enters the system over time — flat, ramping, spiking, or shaped.

## Two ways to author

- **Phase table.** Rows of `{start, end, rps, shape, description}`. Shapes are `steady`, `ramp_up`, `ramp_down`, `spike`, `instant_spike`. Edit numbers directly.
- **Natural language.** Click in the textarea above the phases. Type "ramp from 5 to 100 rps over 30s, spike to 300 for 5s, cool down". Click **Generate**. The AI returns a valid profile and applies it.

## The phase curve preview

Above the table is a small SVG chart that shows the RPS curve derived from your phases. Hover anywhere for "t=12s, RPS=87". As you edit phase values, the curve re-renders live. Catches shape mistakes at a glance — a `ramp_up` that starts at a non-zero value looks wrong.

## Freeform vs scenario

- **Scenario mode** (default on templates like Discord Fanout): uses a hardcoded profile authored by the scenario. No editing.
- **Freeform mode**: you own the profile. Traffic tab in the left sidebar unlocks here.

Switch modes via `setAppMode('freeform')` or by starting a freeform session from scratch.

## `userDistribution` and `jitterPercent`

These ship on the profile but most components ignore them today:

- `userDistribution: 'pareto'` only nudges the DB hot-shard behavior — and only if the shard key cardinality is low or contains "user".
- `jitterPercent` is declared but not yet consumed. Don't waste time tuning it. Wire jitter (on each edge) is the active knob.

See [§44 Traffic Profile Semantics](#docs/reference/44-traffic-profile-semantics).

Next: [Preflight — fix before you run](#docs/learn/preflight--fix-before-you-run).
