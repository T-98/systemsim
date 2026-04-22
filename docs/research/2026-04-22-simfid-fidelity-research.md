# SIMFID fidelity research debrief

**Date:** 2026-04-22
**Context:** The SIMFID plan has Phases 4–7 ahead: schema-driven simulation, companion daemon + real Postgres, Redis Streams sidecar, and Fastify codegen + k6 traffic gen. The team asked whether "99.99999% or better" simulation fidelity is achievable, and whether the right path is full containers, pure algorithmic models, or a hybrid.
**Method:** Five parallel research agents surveyed (1) prior art in the distributed-sim landscape, (2) academic fidelity ceilings, (3) real-container pragmatics, (4) the algorithmic-only ceiling, and (5) hybrid / digital-twin patterns. This document synthesises their findings with cited sources.

---

## TL;DR

- **"99.99999% fidelity" is not an engineering target; it is a marketing phrase.** No rigorous literature in the distributed-systems domain claims it. The parts of reality a simulator would need to capture to reach that bar — metastability, coordinated-omission-free p99.99, rare-event tails, cache-coherence interference — are either provably out of reach of closed-form models or structurally invisible at 1:10 container scale-downs. If that number ships in customer-facing copy, practitioners like Kingsbury, Brooker, or Alvaro will notice.
- **A realistic ceiling is:** mean + p50 + p95 within ~10% of reality, p99 within 2× in steady state, p99.9+ qualitatively indicative but not quantitatively trustworthy. That is still a genuinely useful tool for architectural teaching — and that is the defensible market.
- **The industry has decisively shifted toward running real infrastructure for production-adjacent testing** (Gremlin, AWS FIS, Azure Chaos Studio, Chaos Mesh, Testcontainers). The one notable counter-example — deterministic simulation testing (FoundationDB, Antithesis, WarpStream, TigerBeetle) — requires the production code itself to be written in a sim-friendly runtime. **SystemSim cannot reach that class of fidelity from outside because it simulates someone else's architecture**, not its own.
- **Recommendation:** stay algorithmic-first as the interactive runtime; add *calibration* from real containers as the bridge to reality; make *Validation Mode* with real containers a **second opinion**, not the source of truth. This is the Omega / Google pattern — offline calibration, online algorithmic — and it is the only shape that survives the "drag a wire, see a result in under 1 second" constraint. Phases 4, 8, 5, 6, 7 in that order.

---

## Part 1 — The "99.99999%" question

Seven dimensions of fidelity in a distributed-systems simulator. Each has a published ceiling.

| Dimension | What a good algorithmic sim can claim | Why |
|---|---|---|
| Mean throughput, steady state, low ρ | within a few % of reality | Kingman's formula regime; Whitt 1993 validates this as "usually an excellent approximation" for two-moment inputs |
| p50 / p95 under moderate load | within 10–30% | queueing theory degrades gracefully here if arrival/service variance is modelled |
| p99 / p99.9 | routinely off by 1–3 orders of magnitude | Dean &amp; Barroso, "The Tail at Scale" CACM 2013; Leland et al. 1994 show internet traffic is self-similar, not Poisson, and closed-form models systematically under-predict tails |
| Metastable failure modes | can teach the pattern, cannot predict which system will go metastable when | Bronson HotOS '21 + Huang OSDI '22: metastability is path-dependent emergent behaviour from coupled retry × breaker × timeout loops. Even production doesn't reliably reproduce it |
| Coordination bugs (Raft / Paxos / MVCC races) | out of reach | TLA+ / Jepsen territory. A tick-based sim doesn't have the interleaving fidelity. Kingsbury's decade of Jepsen reports is evidence |
| Rare-event tails (p99.99+) | out of reach | Combinatorial fault space (Alvaro LDFI, SIGMOD '15). Even production doesn't see rare incidents during test windows |
| Hardware-class effects (GC, NUMA, page cache, disk variance) | out of reach for algorithmic sim; *divergent* in 1:10 containers | Gunther's Universal Scalability Law wraps this into fit-only α/β parameters; the ns-3 MPTCP fidelity study shows packet-level sims diverge from real hardware at microsecond timing |

**Bottom line:** the 99%-of-the-value that users want (teaching architectural intuition + catching qualitative failure modes + giving directional capacity guidance) is within algorithmic reach. The residual 1% — **absolute SLA prediction for a specific production workload** — is not, by anyone's serious measurement.

---

## Part 2 — The three approaches, compared

### A. Full algorithmic (no containers)

**What it can model:** Little's Law / Kingman G/G/1 queueing, Zipf-distributed cache working sets, geometric retry amplification (Brooker's math), Dean–Barroso fan-out tail amplification, Jackson / BCMP network composition, Monte Carlo parameter sweeps, metastability pattern encoding per Bronson / Huang.

**Measured accuracy (vs reality):** CloudSim / DynamicCloudSim studies on AWS EC2 workflow execution report ~9% gap between simulated and measured finish time (Springer 2017). That's the neighbourhood for *qualitative* predictions when the model is actually calibrated.

**What it cannot model:** anything below the abstraction — GC pauses, kernel scheduler jitter, page-cache interactions, NUMA threshold effects, NIC packet loss, clock skew, gray partial-failure modes, coordination-primitive correctness, query-planner regressions.

**User experience:** fast, &lt;50ms re-renders on a canvas edit. No setup. Runs in a browser. Works on Chromebooks and locked-down corporate laptops.

### B. Full container-based (real Postgres / Redis / services on the user's machine)

**What it can model:** real query plans, real MVCC bloat, real connection-pool semantics, actual kernel-level lock contention, RDB-fork stalls, Kafka rebalance timing, Postgres autovacuum starvation, deadlocks, serialization failures. Classes of bugs the algorithmic sim is **structurally blind to**.

**Measured cost:** 4–6 GB RAM resident for a Postgres + Redis + 2 Fastify + k6 stack on a 16 GB Mac; 8 GB Macs will swap and thrash. Docker Desktop on macOS uses ~4.5× more RAM and ~6× longer cold-boot than OrbStack. VirtioFS bind-mount I/O is ~3× slower than native. Loopback RTT is sub-ms vs a production VPC's ~1–10ms — the same Postgres can test ~20× higher throughput than its real-VPC counterpart (CyberTec). Cold-start for a fresh 4-container stack is 90s–3min; warm 15–25s.

**Scale-down extrapolation problem:** if you run at 10 RPS locally and extrapolate to 100 RPS production, you are right in the linear regime and **catastrophically wrong near the saturation knee** (Perfmatrix). The whole point of a performance sim is to find the knee, and that is exactly where 1:10 extrapolation breaks.

**User experience:** at least one user in three will have an install problem (Docker not installed, 8 GB RAM, corporate virt blocked). Fans spin. Battery drains. Ships some real fidelity, at real cost.

### C. Hybrid — offline calibration, online algorithmic (Omega pattern)

**What it can model:** everything A can, but *with measured constants* instead of hand-coded defaults. The Uber Ballast / Capacity Recommendation Engine pattern: Redis ~100K ops/s, Kafka ~10 MB/s/partition, Postgres TPC-C NOPM, Maglev-style LB math as a ground truth, and relative adjustments in the UI for hardware class + workload mix.

**Where the real containers come in:** one-time (per Postgres / Redis major version, per hardware class) — run `EXPLAIN (ANALYZE, BUFFERS)` on seeded 1M / 10M / 100M-row datasets, run `redis-benchmark` with a Zipfian key distribution, run `wrk2` against a reference Fastify at 10–90% utilization, fit a queueing coefficient. Ship the constants as a `calibration.json` in the repo. Re-run when the ecosystem version bumps.

**Plus:** an opt-in *Validation Mode* powered by Testcontainers with `.withReuse(true)` — first click cold-starts in 5–10s, subsequent re-validations &lt;1s. Show simulated vs measured side-by-side. Color-code the delta: green &lt;10%, yellow 10–30%, red &gt;30%. Scientist's `compare` semantics (GitHub, 2016).

**Key insight:** hybrid is what the industry is already quietly doing, even when not branded as such. Netflix ChAP = real service + statistical canary (algorithmic decision layer). Stripe Game Days = real infra + fault generators. Toxiproxy = real app + real DB + synthetic network weather. Shadow traffic patterns (Netflix data-canary, SageMaker Shadow Variants, GitHub Scientist) are hybrid too.

---

## Part 3 — Five cross-cutting patterns from the literature

### 1. Real-infrastructure testing won the commercial fight

The entire commercial chaos-engineering stack — Gremlin, AWS Fault Injection Service, Azure Chaos Studio, Chaos Mesh, LitmusChaos — runs against real systems. AWS FIS is explicit: *"real actions on real AWS resources."* Testcontainers' positioning is *"the same services you use in production, not mocks."* The integration-test-mocks market is economically fragile (LocalStack's 2026 consolidation of Community + Pro into a single paid tier is a data point). The direction of travel is unambiguous.

### 2. Deterministic simulation is the prestige path, and out of reach for external sims

FoundationDB, Antithesis ($105M Series A led by Jane Street), WarpStream, TigerBeetle, Resonate — all use deterministic simulation testing where *production code itself runs inside a seeded, single-process discrete-event simulator*. FoundationDB runs reportedly 5–10M simulation hours/night and Jepsen declined to test it because the simulator was more aggressive than Jepsen itself. **But this requires your production system to be the simulator.** SystemSim simulates someone else's architecture, so this path is definitionally closed.

### 3. Calibration-driven models are the working engineer's truce

Uber Ballast, Uber Capacity Recommendation Engine, LinkedIn XLNT, Shopify Genghis, Google Omega (EuroSys 2013) — all of them calibrate an offline model against real measurements, then use the model for fast interactive decisions. Omega specifically built "a high-fidelity simulator that replays historic workload traces from Google production clusters and reuses much of the Google production schedulers code." The pattern is: **measure once, model many times.**

### 4. Public traces are force multipliers

Azure 2017 VM trace (~2.7M VMs, 30 days) published with SOSP'17 Resource Central; Alibaba cluster-trace-v2018 with DAG dependencies for 4K machines; Google Borg and Omega traces. These are what credibility in this domain looks like. If SystemSim ever published a seedable reference trace for common architectures, that would be a differentiator.

### 5. Coordinated omission is the simulator's original sin

Gil Tene's wrk2 / HdrHistogram work is built specifically to fix this: most latency measurements (and most simulators) advance the clock to the next scheduled event rather than driving load by wall-clock. The result is **systematic under-reporting of tail latency by 1–3 orders of magnitude.** If the SystemSim engine records latency as `t_response - t_dispatch_actual` instead of `t_response - t_dispatch_intended`, its own tail numbers are structurally wrong. Fix early or re-shoot later.

---

## Part 4 — Concrete recommendation for SIMFID Phases 4–7

**Phase order stays 4 → 8 → 5 → 6 → 7** with scope changes:

### Phase 4 — Schema-driven simulation (algorithmic; next up)

Unchanged scope from the CEO plan. Engine consumes `endpointRoutes` + `schemaMemory`, reads / writes split, per-DB shard cardinality. Codex flagged real issues with the plan draft — `tablesAccessed` in the store is coarse and the fan-in refactor means DB state is aggregate-only. Resolvable; worth revisiting the plan before execution.

**Net new work motivated by this research:**

- **Replace M/M/1 with Kingman G/G/1 wait formula**, threaded through `QueueingModel.ts`. Add per-component `serviceVariance` (Cs²) config. This is the single highest-ROI fidelity refinement — one formula, materially closer to reality. *(Sources: Kingman 1961; Whitt 1993.)*
- **Ship the Dean–Barroso fan-out tail math as a first-class visualization.** When the canvas shows an N-way scatter-gather, surface "1% slow server → 63% slow response" educationally. Pure algorithm; high pedagogical value.
- **Coordinated-omission-correct measurement.** Engine records `t_response - t_intended`, not `t_response - t_actual`. Fix before the simulator's own numbers get anchored in users' heads.

### Phase 8 (partial) — BOTE calculator + calibration profile loader

The CEO plan calls out Phase 8's math panel as *"independent, ship anytime."* This research says: ship sooner than "8th in line." Specifically:

- **Ship a `calibration.json` in the repo** per hardware class (laptop, cloud-small, cloud-medium) and per primitive major version (`postgres-16`, `redis-7`, `kafka-3`). Each entry: throughput anchor, service variance, failure-mode constants. *(Sources: LinkedIn Kafka benchmarks; Redis official docs; TPC-C.)*
- **BOTE math panel** — DAU → QPS → storage growth → concurrent connections. Standalone, no engine dep. This is the credibility-per-LOC champion.

### Phase 5 — Companion daemon + Testcontainers Validation Mode

Honest re-scope from the CEO plan's ambitions. The target is **not** "daemon that spins Postgres + Redis + Kafka + Fastify + k6 and gives you production-parity answers." That target doesn't work pragmatically (Docker-on-Mac noise, scale-down extrapolation failures, 30% of users have install problems). **The target is a calibration harness + Validation Mode "second opinion."**

- `npx systemsim-daemon` with `dockerode` and a WebSocket bridge (Dokploy-style).
- First use: runs the calibration suite once per hardware class (takes 2–5 min) and writes a local calibration profile. Feeds back into the browser model.
- Second use: *Validation Mode* — user clicks "Validate this scenario." Testcontainers spins warm Postgres + Redis (sub-second if reused, 5–10s cold) and runs the simulated workload through them. Show simulated vs measured side-by-side, color the delta, honest about scale-down extrapolation limits. Scientist pattern.
- **Cloud offload button** — "Run validation in the cloud." Fly Machines is the best fit (Firecracker microVMs, per-second billing, real private network, pennies per run). Modal / E2B / Daytona are single-sandbox-first and awkward for a 4-container topology.

### Phases 6 & 7 — Real Redis Streams sidecar; Fastify / k6 / nginx codegen

Can ship after Phase 5's Validation Mode proves the pattern works for Postgres. Phase 7's codegen becomes valuable once the daemon is there — right now it's a feature without a container.

**Cut from scope:** the "full end-to-end validation mode" framing from Phase 7. It implies production parity. Re-brand as "exportable Fastify scaffold" — a useful artifact that happens to be the same code the daemon benchmarks — rather than a fidelity claim.

---

## Part 5 — Honest market framing

Marc Brooker's "Simple Simulations for System Builders" (2022) is the template. His simulations of exponential-backoff-and-jitter are pure algorithm, generate graphs that teach, and he is explicit they are teaching tools, not predictors. That framing is durable and defensible.

**What to say publicly about SystemSim:**

- **"A simulator for distributed-systems design intuition"** — not a fidelity instrument.
- **"Captures directional behavior of well-understood failure modes: saturation, retry storms, cache stampede, hot shard, circuit-breaker recovery, backpressure propagation."**
- **"Calibrated against real Postgres / Redis / Kafka benchmarks"** (once Phase 5 ships calibration).
- **"Optional Validation Mode for second-opinion checks against your specific workload"** (once Phase 5 ships the daemon).

**What not to say:**

- Anything with a nines number. Not "99.99999%", not "99.9% accurate", nothing.
- "Production parity" — a known-false phrase in this domain.
- "Predicts your p99" — no simulator does this honestly.

The strongest pitch is the runnable-proof pitch already floated for KB credibility: *"every claim in the docs comes with a simulation you can run."* That is singular to SystemSim and does not require absolute fidelity to land.

---

## Appendix — Full bibliography

### Tail latency and measurement
- Dean, J. &amp; Barroso, L.A. "The Tail at Scale." CACM, Feb 2013. https://research.google/pubs/the-tail-at-scale/
- Tene, G. "How NOT to Measure Latency" (Strange Loop). https://www.youtube.com/watch?v=lJ8ydIuPFeU
- "On Coordinated Omission" (ScyllaDB). https://www.scylladb.com/2021/04/22/on-coordinated-omission/
- LatencyUtils (Tene). https://latencyutils.github.io/LatencyUtils/

### Metastability + fault injection
- Bronson et al. "Metastable Failures in Distributed Systems." HotOS '21. https://sigops.org/s/conferences/hotos/2021/papers/hotos21-s11-bronson.pdf
- Huang et al. "Metastable Failures in the Wild." OSDI '22. https://www.usenix.org/system/files/osdi22-huang-lexiang.pdf
- Isaacs, Alvaro et al. "Analyzing Metastable Failures." HotOS '25. https://sigops.org/s/conferences/hotos/2025/papers/hotos25-106.pdf
- Brooker, M. "Metastability and Distributed Systems." https://brooker.co.za/blog/2021/05/24/metastable
- Alvaro et al. "Lineage-driven Fault Injection." SIGMOD '15. https://people.ucsc.edu/~palvaro/molly.pdf
- Jepsen analyses. https://jepsen.io/analyses

### Deterministic simulation testing (the prestige path)
- FoundationDB Simulation and Testing. https://apple.github.io/foundationdb/testing.html
- Wilson, W. "Testing Distributed Systems w/ Deterministic Simulation." Strange Loop 2014. https://www.youtube.com/watch?v=4fFDFbi3toc
- Antithesis — Deterministic Simulation Testing. https://antithesis.com/docs/resources/deterministic_simulation_testing/
- WarpStream — DST for entire SaaS. https://www.warpstream.com/blog/deterministic-simulation-testing-for-our-entire-saas

### Queueing theory
- Kingman's formula (Wikipedia). https://en.wikipedia.org/wiki/Kingman%27s_formula
- Whitt, W. "Approximations for the GI/G/m Queue." Columbia 1993. https://www.columbia.edu/~ww2040/ApproxGIGm1993.pdf
- Leland, Taqqu, Willinger, Wilson. "On the Self-Similar Nature of Ethernet Traffic." SIGCOMM '94. http://ccr.sigcomm.org/archive/1995/jan95/ccr-9501-leland.pdf
- Gunther, N. "Universal Scalability Law." https://www.perfdynamics.com/Manifesto/USLscalability.pdf

### Industry calibration + hybrid patterns
- Schwarzkopf et al. "Omega: flexible, scalable schedulers." EuroSys 2013. https://cs.brown.edu/people/malte/pub/papers/2013-eurosys-omega.pdf
- Cortez et al. "Resource Central." SOSP '17. https://www.microsoft.com/en-us/research/wp-content/uploads/2017/10/Resource-Central-SOSP17.pdf
- Kaldor et al. "Canopy." SOSP '17. https://cs.brown.edu/people/jcmace/papers/kaldor2017canopy.pdf
- Uber Ballast. https://www.uber.com/blog/introducing-ballast-an-adaptive-load-test-framework/
- Uber Capacity Recommendation Engine. https://www.uber.com/us/en/blog/capacity-recommendation-engine/
- Shopify Performance Testing at Scale. https://shopify.engineering/scale-performance-testing
- Shopify Capacity Planning. https://shopify.engineering/capacity-planning-shopify
- LinkedIn XLNT. https://engineering.linkedin.com/ab-testing/xlnt-platform-driving-ab-testing-linkedin
- GitHub Scientist. https://github.com/github/scientist
- Netflix Data Canary. https://netflixtechblog.medium.com/the-data-canary-how-netflix-validates-catalog-metadata-18b699d58e36
- Netflix ChAP — TechBlog. https://netflixtechblog.com/chap-chaos-automation-platform-53e6d528371f
- Basiri et al. "Automating Chaos Experiments in Production." arXiv 2017. https://arxiv.org/pdf/1702.05849

### Real-infra testing (the industry majority)
- Gremlin product. https://www.gremlin.com/product
- Chaos Mesh docs. https://chaos-mesh.org/docs/simulate-kernel-chaos-on-kubernetes/
- AWS FIS user guide. https://docs.aws.amazon.com/fis/latest/userguide/what-is.html
- Azure Chaos Studio. https://learn.microsoft.com/en-us/azure/chaos-studio/chaos-studio-overview
- Jepsen repo. https://github.com/jepsen-io/jepsen
- Shopify Toxiproxy. https://github.com/Shopify/toxiproxy
- Stripe Game Days. https://stripe.com/blog/game-day-exercises-at-stripe
- Testcontainers intro. https://testcontainers.com/guides/introducing-testcontainers/
- Testcontainers reusable containers. https://java.testcontainers.org/features/reuse/
- Stripe Veneur. https://github.com/stripe/veneur

### Component-level calibration anchors
- LinkedIn — Benchmarking Apache Kafka (2M writes/sec). https://engineering.linkedin.com/kafka/benchmarking-apache-kafka-2-million-writes-second-three-cheap-machines
- LinkedIn — Running Kafka at Scale. https://engineering.linkedin.com/kafka/running-kafka-scale
- Redis benchmarks (official docs). https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/benchmarks/
- Redis Enterprise 200M ops/sec. https://redis.io/blog/redis-enterprise-extends-linear-scalability-200m-ops-sec/
- PostgreSQL pgbench. https://www.postgresql.org/docs/current/pgbench.html
- PostgresBench (ClickHouse). https://clickhouse.com/blog/postgresbench
- Moppel — generate lots of PG test data fast. https://kmoppel.github.io/2022-12-23-generating-lots-of-test-data-with-postgres-fast-and-faster/
- Maglev NSDI '16. https://research.google.com/pubs/archive/44824.pdf
- TPC-C benchmark. https://www.tpc.org/tpcc/

### Simulators (academic + industrial)
- CloudSim Plus. https://cloudsimplus.org/
- CloudSim 7G. https://onlinelibrary.wiley.com/doi/full/10.1002/spe.3413
- "A Simplified Model for Simulating Workflow Execution in Cloud." Springer 2017. https://link.springer.com/chapter/10.1007/978-3-319-64203-1_23
- iFogSim2 vs FogNetSim++ comparative study (MDPI 2025). https://www.mdpi.com/1999-5903/17/9/382
- NS-3 MPTCP fidelity. https://pmc.ncbi.nlm.nih.gov/articles/PMC7766202/
- SimGrid accuracy. https://dl.acm.org/doi/10.4108/ICST.SIMUTOOLS2009.5592

### Container pragmatics
- "Why Docker Compose Is Actually Killing Your M1 Mac" — Sohail Saifi, Medium. https://medium.com/@sohail_saifi/why-docker-compose-is-actually-killing-your-m1-mac-the-performance-truth-no-one-talks-about-4357678c8584
- OrbStack vs Colima. https://docs.orbstack.dev/compare/colima
- Docker on macOS performance 2025 — Paolo Mainardi. https://www.paolomainardi.com/posts/docker-performance-macos-2025/
- Testcontainers-Node docs. https://node.testcontainers.org/features/containers/
- Testcontainers Desktop. https://testcontainers.com/desktop/docs/
- PostgreSQL Network Latency (CyberTec). https://www.cybertec-postgresql.com/en/postgresql-network-latency-does-make-a-big-difference/
- Fly Machines. https://fly.io/machines

### Design + teaching frames
- Brooker, M. "Simple Simulations for System Builders." https://brooker.co.za/blog/2022/04/11/simulation
- Brooker, M. "Exponential Backoff And Jitter" (AWS). https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
- Brooker, M. "Fixing retries with token buckets and circuit breakers." https://brooker.co.za/blog/2022/02/28/retries.html
- Bernhardt, G. "Boundaries" (SCNA 2012). https://www.destroyallsoftware.com/talks/boundaries
- Testing Distributed Systems — curated list. https://asatarin.github.io/testing-distributed-systems/

### Trace datasets
- Azure Public Dataset. https://github.com/Azure/AzurePublicDataset
- Alibaba cluster-trace-v2018. https://github.com/alibaba/clusterdata/blob/master/cluster-trace-v2018/trace_2018.md

### Differential / incremental computation
- Differential Dataflow — McSherry et al., CIDR 2013. https://www.cidrdb.org/cidr2013/Papers/CIDR13_Paper111.pdf

### Foundational context
- Bronson et al. "TAO: Facebook's Distributed Data Store." USENIX ATC '13. https://www.usenix.org/system/files/conference/atc13/atc13-bronson.pdf
- 12-Factor Dev/Prod Parity. https://12factor.net/dev-prod-parity
