# Capacity estimator

Back-of-the-envelope capacity math, built in. You give it daily active users and a handful of assumptions; it gives you QPS, storage growth, and concurrent connections — the same numbers you'd scribble on a whiteboard before picking a single component.

## Where it lives

Freeform mode → **Traffic tab** in the left sidebar → **Pre-populate from capacity estimator →**. The estimator opens in the right inspector dock (the same dock that hosts the config panel when a node is selected). Outputs update live as you type.

## The inputs

- **Daily active users** (default 1,000,000). The headline scale number.
- **Actions per user per day** (default 10). Every request a user fires — page loads, posts, likes.
- **Read share** (default 0.8). Fraction of actions that are reads, 0–1. The rest are writes; only writes consume storage.
- **Payload per write** (default 1,024 bytes). Average bytes persisted per write action.
- **Retention** (default 365 days). How long written data is kept before deletion or archive.
- **Peak-to-average multiplier** (default 3×). Peak traffic as a multiple of the daily average. 3× is the industry rule of thumb — traffic is never flat.
- **Avg response time** (default 100 ms). How long a request stays in flight. This is the W in Little's Law.

## The outputs

- **Average QPS** — DAU × actions per user, spread evenly over the 86,400 seconds in a day.
- **Peak QPS** — average QPS × the peak multiplier.
- **Read QPS / Write QPS** — average QPS split by the read share.
- **Storage growth / month** — write QPS × payload bytes × the seconds in a 30-day month.
- **Storage at retention** — the same daily write volume held for the full retention window: your steady-state disk footprint.
- **Concurrent requests (avg / peak)** — Little's Law, N = QPS × W: requests in flight equals arrival rate times the time each request spends in the system.

## Apply to traffic profile

The **Apply to traffic profile** button projects the estimates into a two-phase profile:

1. A **steady baseline** at average QPS for roughly the first two-thirds of the run.
2. A **spike to peak QPS** for the remainder.

Your run duration, request mix, and user distribution are preserved — only the phases are replaced. The sidebar switches to the Traffic tab so you can see (and edit) the result before running. The button is disabled mid-run: the engine snapshots the profile at start, so an apply during a run would look applied without being applied.

## What these numbers are — and aren't

These are **offered-load estimates**, not behavior predictions. The estimator tells you how much traffic and data will arrive; it says nothing about whether your design survives it. Queueing, saturation, retry amplification, cache misses — that's the simulation's job. Estimate first, then run the sim and watch what the load actually does. The How-to tab's [Size a system from a guess](#docs/howto/capacityPlanning) scenario walks this loop end to end.

See [§5 Back-of-Envelope Resource Estimation](#docs/reference/5-back-of-envelope-resource-estimation) for the full whiteboard method and [§4 QPS Tiers & What They Imply](#docs/reference/4-qps-tiers-what-they-imply) for what your numbers mean architecturally.

This is the last page of the Learn track. Head to **Reference** (top nav) for deep-dives, or **How-to** for hands-on scenarios.
