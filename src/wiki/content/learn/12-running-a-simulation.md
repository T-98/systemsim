# Running a simulation

The Run button (top-right toolbar) is everything. Preflight clean, button turns Apple Blue, click it.

## What happens

1. Engine ticks once per simulated second. Wall-clock runs at your selected speed (1×, 2×, 4×, 10×).
2. At each tick, the traffic profile's `getCurrentRps()` is evaluated, RPS is distributed to entry points, and the graph is walked in adjacency order. Each component computes its own metrics, forwards to downstreams via `forwardOverWire`, and writes back RPS, p50/p95/p99, error rate, resource usage.
3. Resilience features (opt-in) kick in: circuit breakers evaluate at tick end, retry amplification applies on the next tick's forward, backpressure scales down load on the tick after that.
4. Callouts fire once per `(component, type)` pair — e.g., the first time ρ>=0.85 at Server-1, you get a log line telling you about it. Repeats are throttled.
5. At duration end, the sim stops, AI debrief kicks off, and the bottom panel switches to the Debrief tab.

## Controls while running

- **Pause / Resume** — toolbar buttons. Internal state is preserved exactly.
- **Reset** — aborts the current run, clears metrics, returns to idle.
- **Speed** — 1× / 2× / 4× / 10×. Only affects wall-clock pacing; the sim math is unchanged.
- **View mode** — Particle (animated packets on wires) vs Aggregate (just numbers). Particles are pretty but slower at high RPS.

## A note on determinism

Runs are not bit-deterministic — jitter and Pareto sampling use `Math.random()`. Two runs of the same graph won't produce identical numbers, but aggregate behavior is stable. Don't compare runs digit-for-digit; compare shapes.

Next: [Reading the live log](#docs/learn/reading-the-live-log).
