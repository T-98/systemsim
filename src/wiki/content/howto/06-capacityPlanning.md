# Size a system from a guess, then prove it wrong

Most designs start with a gut-feel guess: "two app servers should be plenty." This scenario takes that guess, runs the back-of-envelope math against it, and lets the simulation deliver the verdict. The design below was sized by vibes — 2 server instances at 50ms per request is 40 RPS of capacity (2 × 1000/50 = 2 × 20 RPS per instance).

<CanvasEmbed template="capacityPlanning" />

## Run it

1. **Take the template to the canvas**, then open the **Traffic tab** in the left sidebar and click **Pre-populate from capacity estimator →**.
2. **Plug in the workload**: 1,000,000 daily active users, 10 actions per user per day. Keep the defaults — 3× peak multiplier, 100ms response time. The estimator reads back ~116 average QPS and ~347 peak QPS.
3. **Click Apply to traffic profile.** You get a two-phase profile: a steady ~116 RPS baseline for two-thirds of the run, then a spike to ~347 RPS.
4. **Run.** Watch the App Server.

## What to watch for

- **The saturation callout fires almost immediately** — even the *baseline* 116 RPS is ~2.9× the server's 40 RPS capacity. The gut-feel guess didn't survive the average, let alone the peak.
- **The spike makes it brutal.** At ~347 RPS demand against 40 RPS capacity, the server drops nearly 9 in 10 requests. The log spells it out: capacity, demand, and the instance count you'd actually need.
- **p99 explodes** as utilization pins at the queueing ceiling — latency collapse arrives before the drop counter does.

## Fix direction

- **Size for peak, not average.** Sizing for the 116 RPS average (6 instances × 20 RPS = 120 RPS) still dies at the 347 RPS spike. That's the lesson: average-based sizing always dies at peak, and peak is ~3× average as a rule of thumb — see [§5 Back-of-Envelope Resource Estimation](#docs/reference/5-back-of-envelope-resource-estimation).
- **Leave queueing headroom.** 18 instances (360 RPS) technically covers the peak, but at ρ ≈ 0.96 the queue makes latency unusable. Aim for ρ ≤ ~0.7 at peak — 25 instances here.
- **Re-check the tier.** ~350 peak QPS sits in the medium tier — load balancer, replicas, caching — not a two-box stack. See [§4 QPS Tiers & What They Imply](#docs/reference/4-qps-tiers-what-they-imply).
