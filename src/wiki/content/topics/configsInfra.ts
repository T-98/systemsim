/**
 * @file wiki/content/topics/configsInfra.ts
 *
 * Wiki content for infrastructure-side config keys: wire fields, load
 * balancer, API gateway, server, autoscaler, fanout, CDN/external/misc.
 * Every claim about engine behavior is verified against
 * `src/engine/SimulationEngine.ts` and defaults against
 * `src/types/components.ts` COMPONENT_DEFS. Where a field is declared but
 * the engine ignores it, the body says so plainly.
 */

import type { Topic } from '../../topics';

export const CONFIG_INFRA_TOPICS: Record<string, Topic> = {
  // ── Wire + basic node configuration ────────────────────────────────────

  'config.throughputRps': {
    title: 'Throughput (RPS)',
    shortDescription:
      'Informational capacity note on a wire. The engine does NOT enforce it as a cap. Default 10,000 on new wires.',
    body: `# Throughput (RPS)

What the wire was *specified* to carry. New wires default to 10,000 RPS.

The engine does **not** read this field — traffic crossing a wire is never clipped to it. Enforcement happens at component level: server concurrency (\`maxConcurrent\` × instances), API gateway \`rateLimitRps\`, DB throughput and pool size. Treat this as a design annotation, like a comment on a network diagram.

Why keep it? Capacity intent matters when reviewing a design. §4 maps QPS tiers to architecture: under ~100 RPS a single box is fine; 1,000–100,000 RPS is where queues, microservices, and horizontal scaling earn their keep. Writing the expected RPS on each wire makes tier mismatches visible — a 50k-RPS wire feeding a 3-instance server with 50ms processing time (≈60 RPS capacity per instance) is a preflight-grade contradiction even though the sim will happily run it.

Mis-set symptom: none in the sim — which is exactly the trap. Don't expect the engine to warn when real traffic exceeds this number; watch component utilization instead.`,
    category: 'config',
    relatedTopics: ['config.latencyMs', 'config.jitterMs', 'config.maxConcurrent', 'config.rateLimitRps'],
  },

  'config.latencyMs': {
    title: 'Latency (ms)',
    shortDescription:
      'Base latency added per wire crossing (default 2ms on wires). On External Service nodes: round-trip latency, default 100ms.',
    body: `# Latency (ms)

Two homes, same idea.

**On a wire:** base one-way latency added every time a request crosses. Each tick the engine computes \`latencyMs + uniform(−jitterMs, +jitterMs)\` and adds it to the accumulated latency carried downstream. In Stressed mode it uses \`latencyMs + jitterMs\` — the top of the jitter window — on every hop. New wires default to 2ms, a realistic intra-datacenter figure.

**On an External Service:** the third-party call latency. Engine fallback is 100ms (component default 100ms). The node reports p50 = latency + accumulated, p99 = latency × 3.

Latency compounds across a path. Four 50ms hops add 200ms to every downstream component's reported percentiles before any processing time — over-hopping kills p99 even when each hop is fast (§7). Keep wires at single-digit ms unless you're deliberately modeling cross-region or third-party calls.

Mis-set symptom: every downstream component's p50/p95/p99 inflates by the same constant, and no amount of instance-scaling fixes it.`,
    category: 'config',
    relatedTopics: ['config.jitterMs', 'config.throughputRps', 'config.errorRate', 'config.processingTimeMs'],
  },

  'config.jitterMs': {
    title: 'Jitter (ms)',
    shortDescription:
      'Uniform ± variance on top of wire latency, sampled once per wire per tick. Default 1ms. Stressed mode pins it to +jitterMs.',
    body: `# Jitter (ms)

Random variance on a wire's latency. Each tick the engine adds \`uniform(−jitterMs, +jitterMs)\` to the wire's \`latencyMs\`, clamped at zero. New wires default to 1ms.

A modeling simplification: jitter is sampled **once per wire per tick**, not per request. All traffic crossing that wire in a given tick sees the same delay; different ticks see different delays. This is coarser than reality but consistent with the engine's tick-aggregate design.

In Stressed mode jitter stops being random — every wire uses \`latencyMs + jitterMs\`, the worst case, on every hop. That's why Stressed p99s are systematically higher even before saturation effects.

Value guidance: 1–5ms for intra-DC links, 10–30ms for cross-region, more only if you're modeling a flaky third-party path. Jitter is one of the few stochastic inputs, so runs are not bit-deterministic — compare shapes between runs, not digits.

Mis-set symptom: a large jitter makes downstream percentiles noisy tick-to-tick, which can mask (or fake) saturation signals you're trying to read.`,
    category: 'config',
    relatedTopics: ['config.latencyMs', 'config.throughputRps', 'config.processingJitterMs'],
  },

  'config.instances': {
    title: 'Instance count',
    shortDescription:
      'Legacy alias. The engine reads instanceCount, not instances — set instanceCount to change capacity.',
    body: `# Instance count

A legacy/alias key. The simulation engine initializes each component's live instance count from \`config.instanceCount\` (falling back to 1), and never reads a field named \`instances\`. If a session file or AI-generated config carries \`instances\`, it has no effect on the math.

The real knob is [\`instanceCount\`](#config.instanceCount): it divides arrival rate in the server queueing model (utilization ρ = λ·S / instances) and is the value the autoscaler mutates at runtime between \`minInstances\` and \`maxInstances\`.

If you think you scaled a server out and nothing changed — capacity warnings still cite the old count, CPU% unmoved — check which key you actually set. \`instanceCount\` is the one the engine consumes.`,
    category: 'config',
    relatedTopics: ['config.instanceCount', 'config.minInstances', 'config.maxInstances', 'config.maxConcurrent'],
  },

  'config.cpu': {
    title: 'CPU %',
    shortDescription:
      'Not a config input. CPU% is a computed metric — queueing utilization × 100 on servers. Setting a cpu config value changes nothing.',
    body: `# CPU %

CPU% in SystemSim is an **output**, not an input. The engine computes it per tick: on servers it's queueing utilization × 100 from the Kingman model (arrival rate × service time ÷ instances); on databases it's throughput utilization. A \`cpu\` value in a component's config is never read.

Why it matters anyway: CPU% drives real behavior. Above 70% a component's health turns to *warning*; above 95% *critical*; above 98% there's a 30% per-tick crash chance. The autoscaler watches downstream servers' CPU% against \`targetCpuThreshold\` to decide scale-up/down. And ρ ≥ 0.85 fires the saturation callout — the knee where queueing delay explodes (§7, §20).

To *change* CPU%, change the things that produce it: \`instanceCount\` (more divisor), \`processingTimeMs\` (less work per request), or upstream traffic (less arrival).

Mis-set symptom: editing a cpu config field and watching the metric not move — because the metric never came from config.`,
    category: 'config',
    relatedTopics: ['config.instanceCount', 'config.processingTimeMs', 'config.targetCpuThreshold', 'config.cpuProfile'],
  },

  'config.maxConnections': {
    title: 'Max connections',
    shortDescription:
      'WebSocket gateway connection ceiling. Default 100,000. Connection count vs this cap drives memory% and the 90% capacity warning.',
    body: `# Max connections

The WebSocket gateway's connection ceiling. Default 100,000 (engine fallback matches).

How the engine uses it: the gateway accumulates connections at 10% of inbound RPS per tick and decays them slowly (0.1%/tick). \`memoryPercent\` is reported as \`currentConnections / maxConnections × 100\` — so this cap directly sets how fast the node walks toward the 70% warning and 95% critical health thresholds. Crossing 90% of capacity fires a connection-capacity warning; sustained >95% memory can crash the node like any other component.

Sizing: persistent connections are a memory game, not a CPU game. A C10K-era box handles ~10k; modern tuned instances handle 100k–1M. For a chat/real-time design at very high concurrency (§4's "very high" tier), plan multiple gateway nodes behind an LB rather than one giant cap.

Note the simplification: connection growth is a fixed fraction of RPS, not per-user session modeling.

Mis-set symptom: a too-small cap shows the gateway "running hot" on memory and eventually crashing under traffic that the rest of the stack absorbs fine.`,
    category: 'config',
    relatedTopics: ['config.heartbeatInterval', 'config.connectionTimeout', 'config.instanceCount'],
  },

  'config.ttl': {
    title: 'Cache TTL',
    shortDescription:
      'Legacy alias. The engine reads ttlSeconds (default 300s), not ttl. TTL drives hit rate and stampede timing in the cache model.',
    body: `# Cache TTL

How long cached entries live before expiring. Note the key naming: the engine reads \`ttlSeconds\` (fallback 300s, matching the component default) — a field literally named \`ttl\` is not consumed.

What TTL does in the sim: it feeds the cache model's hit-rate computation, and it sets the **stampede clock**. When the model flags stampede risk, the engine checks \`time % ttlSeconds\` — in the first ~2 seconds after a mass expiry boundary, hit rate is slashed to 30% of normal and a critical "Cache stampede detected. Mass TTL expiry causing DB flood." log fires. Every cache miss is forwarded downstream, so the DB sees the flood directly.

Guidance (§10): longer TTL = higher hit rate but staler data and bigger synchronized-expiry cliffs. 60–600s suits read-heavy feeds; very short TTLs (<10s) keep data fresh but push most traffic through to origin, making the cache nearly decorative.

Mis-set symptom: periodic sawtooth — hit rate craters on a fixed cadence equal to the TTL, with matching DB error spikes.`,
    category: 'config',
    relatedTopics: ['config.maxConnections', 'config.connectionPoolSize', 'config.originPullLatencyMs'],
  },

  'config.maxConcurrent': {
    title: 'Max concurrent',
    shortDescription:
      'Per-instance in-flight request cap on servers. Default 1000. Exceeding maxConcurrent × instances drops the overflow.',
    body: `# Max concurrent

Per-instance cap on simultaneous in-flight requests at a server. Default 1000 (engine fallback matches).

How the engine consumes it: it's \`maxConcurrentPerInstance\` in the queueing model. Concurrency is derived via Little's Law (in-flight ≈ arrival rate × service time); when that exceeds \`maxConcurrent × instanceCount\`, the overflow becomes drop rate even if raw throughput utilization is below 1. It's a second, independent failure mode from CPU saturation — you can have idle CPU and still drop requests because the concurrency window is full.

Sizing intuition: at 50ms processing time, 1000 concurrent slots support ~20,000 RPS per instance — generous. The cap starts binding when processing time is long (slow downstream calls, big \`processingTimeMs\`): at 2s per request, 1000 slots = only 500 RPS. Size it as expected per-instance RPS × service time, with 2–3× headroom.

Mis-set symptom: server reports drops ("Dropping N% of requests") while CPU% looks unremarkable — the classic thread-pool-too-small signature.`,
    category: 'config',
    relatedTopics: ['config.processingTimeMs', 'config.instanceCount', 'config.connectionPoolSize', 'config.cpu'],
  },

  'config.processingTimeMs': {
    title: 'Processing time (ms)',
    shortDescription:
      'Service time per request. Servers: feeds the Kingman queueing model, default calibrated p50 or 50ms. Queues: per-message time, default 10ms.',
    body: `# Processing time (ms)

The service time — how long one unit of work takes, excluding queueing and network.

**On servers** it's the heart of the model: the engine resolves \`processingTimeMs ?? calibrated fastify p50 ?? 50\` and feeds it into the Kingman G/G/1 queueing formula as service time. Everything follows from it: utilization ρ = arrival rate × service time ÷ instances, wait time, and the reported p50/p95/p99. Capacity per instance ≈ 1000 / processingTimeMs RPS — 50ms means ~20 RPS per instance, which is why the drop-warning log suggests instance counts in exactly those terms.

**On queues** it's per-message consumer time (fallback 10ms, matching the queue default); consumer throughput = total consumers ÷ processingTimeMs × 1000.

Guidance: 5–20ms for cache-backed reads, 50–100ms for DB-touching work, 200ms+ for external-API or compute-heavy paths (§7). Halving processing time doubles capacity — often cheaper than doubling instances.

Mis-set symptom: too high and the server saturates at trivially low RPS (ρ ≥ 0.85 callout, then drops); unrealistically low and your design passes simulations it would fail in production.`,
    category: 'config',
    relatedTopics: ['config.maxConcurrent', 'config.instanceCount', 'config.processingJitterMs', 'config.cpu'],
  },

  'config.connectionPoolSize': {
    title: 'Connection pool size',
    shortDescription:
      'Database connection pool. Default 100. Backlogged connections beyond the pool produce errors; 80% utilization fires a callout.',
    body: `# Connection pool size

The database's connection pool. Default 100 (engine fallback matches).

How the engine uses it: each tick, inbound RPS adds to \`currentConnections\` and the DB drains what its read/write throughput allows. The backlog that remains is measured against the pool: utilization ≥ 80% fires the pool-pressure callout ("add replicas or pool size"); utilization > 1 produces a drop rate of \`min(0.9, (util − 1) × 0.5)\` and a critical "Connection pool exhaustion" log. Pool exhaustion is deliberately an **independent** failure mode from throughput saturation — exhausting the pool before exhausting throughput means the pool is undersized for the burst profile. The DB's aggregate errorRate is the max of read saturation, write saturation, and pool drops, and that aggregate is what circuit breakers, retries, and backpressure react to.

Sizing: real Postgres installs run 100–500 effective connections (often via PgBouncer). Scale the pool with sustained inbound RPS minus drain rate, not with peak RPS alone — the queue drains between bursts.

Mis-set symptom: DB throws errors while its CPU (throughput utilization) still looks healthy.`,
    category: 'config',
    relatedTopics: ['config.maxConcurrent', 'config.instanceCount', 'config.engine', 'config.processingTimeMs'],
  },

  'config.isEntry': {
    title: 'Entry point',
    shortDescription:
      'Marks a component as receiving external traffic. Traffic profile RPS is injected here. Without any flag, zero-indegree nodes are used.',
    body: `# Entry point

Flags a component as receiving traffic from outside the system. Each tick, the traffic profile's current RPS is injected at the entry points and flows through the graph from there.

Resolution rule (verified in topology seeding): if **any** node has \`isEntry: true\`, the explicit set wins — only those nodes receive injected traffic. If no node is flagged, the engine falls back to all zero-indegree nodes (nodes with no inbound wires). That fallback is convenient but fragile: add a wire into your implicit entry node and it silently stops being an entry. Flag explicitly.

Multiple entry points split the profile's RPS among them. Typical choices: the load balancer or API gateway for request/response systems, the WebSocket gateway for real-time, a queue for ingest-style designs.

Preflight blocks the Run button when a graph has no resolvable entry point — there'd be nothing to simulate.

Mis-set symptom: a sim where every component sits at 0 RPS, or where traffic enters at a deep internal node and your ingress tier never sees load.`,
    category: 'config',
    relatedTopics: ['config.throughputRps', 'config.rateLimitRps', 'config.algorithm', 'config.maxConnections'],
  },

  // ── Load balancer ───────────────────────────────────────────────────────

  'config.algorithm': {
    title: 'LB algorithm',
    shortDescription:
      'Declared balancing algorithm, default round-robin. The engine currently always splits evenly across healthy downstreams regardless.',
    body: `# LB algorithm

The load-balancing algorithm. Default \`round-robin\`.

Honest disclosure: the engine does not read this field. \`processLoadBalancer\` always divides inbound RPS **evenly** across healthy downstreams — \`rps / healthyCount\` — after filtering out crashed nodes and wires with an open circuit breaker. At tick-aggregate granularity, even-split is equivalent to round-robin, so the default is faithfully modeled; the other algorithms are declared intent only.

Why the field still matters as documentation (§9): round-robin assumes homogeneous backends and uniform request cost; least-connections adapts when request durations vary; consistent hashing pins sessions/keys to backends (cache-friendly, hot-key-prone); weighted variants handle heterogeneous instance sizes. When your design depends on one of these properties — say, session affinity for WebSockets — record it here so a reviewer (or the AI debrief) can hold you to it.

Mis-set symptom: none in the sim. But note what the LB *does* model: with all downstreams crashed or breaker-open, it fails 100% of traffic with a "No healthy backends" critical log.`,
    category: 'config',
    relatedTopics: ['config.healthCheckInterval', 'config.unhealthyThreshold', 'config.instanceCount', 'config.isEntry'],
  },

  'config.healthCheckInterval': {
    title: 'Health check interval (ms)',
    shortDescription:
      'Declared probe interval, default 10,000ms. Not consumed by the engine — LB health filtering reacts instantly to crashes and open breakers.',
    body: `# Health check interval (ms)

How often the load balancer probes its backends. Default 10,000ms (10s).

The engine does not consume this field. In the simulation, the LB's health view is **instantaneous and free**: each tick it filters out downstreams that are crashed or whose inbound wire has an open circuit breaker, with zero detection lag. Real systems can't do that — a backend that dies between probes keeps receiving traffic for up to one interval, which is exactly the failure window this setting controls.

Real-world guidance (§9): 5–10s intervals are typical; aggressive 1–2s intervals detect failure faster but multiply probe load across a large fleet (N backends × M LB nodes × 1/interval). Detection time ≈ interval × unhealthyThreshold — tune the pair together. The sim's instant detection means your design will look *more* resilient to backend death than reality; budget for the gap.

Mis-set symptom: none in the sim. In production, too-long intervals show up as error spikes lasting seconds after every instance failure.`,
    category: 'config',
    relatedTopics: ['config.healthCheckTimeout', 'config.unhealthyThreshold', 'config.algorithm'],
  },

  'config.healthCheckTimeout': {
    title: 'Health check timeout (ms)',
    shortDescription:
      'How long a health probe waits before counting as failure. Default 3,000ms. Declared only — the engine does not model probe timing.',
    body: `# Health check timeout (ms)

How long the load balancer waits for a health-probe response before counting it as a failure. Default 3,000ms.

Not consumed by the engine — the sim's LB sees backend health (crashed flag, breaker state) directly each tick, with no probe round-trip to time out. The field exists so designs carry realistic operational intent.

Real-world guidance (§9, §21): the timeout must sit **below** the check interval (a 3s timeout with a 10s interval is sane; a 12s timeout with a 10s interval means overlapping probes) and **above** the backend's p99 for the health endpoint, or you'll mark slow-but-alive instances dead during load spikes — the false-positive eviction that turns a latency wobble into a capacity loss, concentrating traffic on survivors and cascading. A common rule: timeout ≈ 2–3× the health endpoint's p99.

Mis-set symptom: none in the sim. In production, too-tight timeouts cause flapping — instances oscillating in and out of rotation precisely when the system is busiest.`,
    category: 'config',
    relatedTopics: ['config.healthCheckInterval', 'config.unhealthyThreshold', 'config.algorithm'],
  },

  'config.unhealthyThreshold': {
    title: 'Unhealthy threshold',
    shortDescription:
      'Consecutive failed probes before a backend is pulled from rotation. Default 3. Declared only — sim health filtering is instant.',
    body: `# Unhealthy threshold

How many consecutive failed health checks before the load balancer pulls a backend out of rotation. Default 3.

Not consumed by the engine. The sim's LB excludes a backend the moment it crashes or its wire's circuit breaker opens — effectively a threshold of zero with no probe history. The field records intent for the real system.

Why thresholds exist (§9): a single failed probe is weak evidence — GC pause, transient packet loss, one slow request. Requiring N consecutive failures trades detection speed for stability: detection time ≈ interval × threshold (10s × 3 = up to 30s of traffic to a dead node), but you avoid evicting healthy instances on noise. Most fleets run 2–3 for marking unhealthy and a similar or higher count for marking healthy again, so instances don't flap back in prematurely.

Note the related sim mechanism that *does* have a threshold: per-wire circuit breakers open after \`failureWindow\` consecutive bad ticks — that's the engine's actual eviction-by-evidence model.

Mis-set symptom: none in the sim.`,
    category: 'config',
    relatedTopics: ['config.healthCheckInterval', 'config.healthCheckTimeout', 'config.circuitBreaker.failureWindow'],
  },

  // ── API gateway ─────────────────────────────────────────────────────────

  'config.rateLimitRps': {
    title: 'Rate limit (RPS)',
    shortDescription:
      'API gateway hard cap, default 10,000 RPS. Traffic above the cap is rejected and counted as the gateway errorRate.',
    body: `# Rate limit (RPS)

The API gateway's request cap. Default 10,000 RPS (engine fallback matches).

How the engine consumes it: a hard per-tick ceiling. Inbound above \`rateLimitRps × tickInterval\` is rejected; the rest passes downstream. Rejections become the gateway's errorRate (\`rejected / rps\`), and when rejections exceed 10% a "Rate limiting active" warning logs. Rejection is the cheapest failure in the stack — refused requests never consume server concurrency or DB connections, which is the whole point of limiting at the edge (§22).

The model is a fixed cap, not a token bucket — no burst absorption, no per-caller buckets (see \`rateLimitBurst\`). One number, applied to aggregate traffic.

Sizing: set it just above your design's intended peak so legitimate spikes pass, and treat it as the circuit between "shed load gracefully at the front door" and "let the backend pick failures randomly under saturation". §4's QPS tiers are the sanity check — a 10k-RPS limit in front of a 60-RPS server farm means the limiter will never be what saves you.

Mis-set symptom: too low and the gateway itself reports high errorRate while downstream sits idle; too high and it's decorative — saturation happens downstream instead.`,
    category: 'config',
    relatedTopics: ['config.rateLimitBurst', 'config.timeout', 'config.authMiddleware', 'config.maxConcurrent'],
  },

  'config.rateLimitBurst': {
    title: 'Rate limit burst',
    shortDescription:
      'Declared burst allowance above the steady rate, default 1000. Not consumed — the sim models a fixed cap, not a token bucket.',
    body: `# Rate limit burst

The burst allowance — how far above the steady rate a caller may briefly go. Default 1000.

Not consumed by the engine. The sim's gateway applies \`rateLimitRps\` as a flat per-tick cap with no burst credit: a 1-tick spike above the cap is rejected even if the system was idle the tick before. A token bucket (§22.1) would behave differently — the bucket holds up to N tokens refilled at r/sec, so quiet periods bank capacity that bursts can spend, mapping to "10,000 RPS sustained, burst to 11,000". That's the semantics this field declares; the engine just doesn't implement it yet.

Practical implication for your runs: spiky traffic profiles (\`spike\`, \`instant_spike\` phases) will show gateway rejections that a real token-bucket limiter would have absorbed. If your design leans on burst tolerance, expect the sim to be pessimistic at the gateway and note it in your debrief reading.

Mis-set symptom: none in the sim — rejections track \`rateLimitRps\` alone.`,
    category: 'config',
    relatedTopics: ['config.rateLimitRps', 'config.timeout', 'config.throughputRps'],
  },

  'config.authMiddleware': {
    title: 'Auth middleware',
    shortDescription:
      "Declared auth scheme at the gateway ('none', JWT, etc.). Default 'none'. Not consumed — the sim adds no auth latency or rejections.",
    body: `# Auth middleware

Which authentication scheme the gateway applies — \`none\`, JWT validation, API keys, session lookup. Default \`none\`.

Not consumed by the engine: no added latency, no CPU cost, no auth-failure rejections regardless of the value. The field documents design intent.

What it would cost in reality (§17): JWT validation is CPU-only (~sub-millisecond signature check, no I/O — the reason JWTs exist at gateways), API-key or session validation adds a lookup — a cache hit is ~1ms, a DB round-trip 5–50ms **per request**, which at gateway position multiplies across your entire traffic volume. If your design validates sessions against a store, model that honestly by adding the latency to downstream \`processingTimeMs\` or routing gateway traffic through a cache node, since the sim won't add it for you.

Mis-set symptom: none in the sim. The risk runs the other way — a design that looks fast in simulation because per-request auth I/O was never accounted for.`,
    category: 'config',
    relatedTopics: ['config.rateLimitRps', 'config.timeout', 'config.processingTimeMs'],
  },

  'config.connectionTimeout': {
    title: 'Connection timeout (ms)',
    shortDescription:
      'WebSocket gateway idle-connection timeout, default 60,000ms. Not consumed — sim connections decay at a fixed rate instead.',
    body: `# Connection timeout (ms)

How long the WebSocket gateway keeps an unresponsive connection before closing it. Default 60,000ms (60s).

Not consumed by the engine. The sim models connection churn with a fixed decay — \`currentConnections\` shrinks by 0.1% per tick — rather than per-connection idle timers. Connection count therefore responds to inbound RPS and the decay constant, not to this field.

What it governs in reality: dead-connection reaping. Mobile clients drop off networks without a clean close; without a timeout (paired with heartbeats), zombies accumulate until \`maxConnections\` is full of ghosts. The timeout should be a small multiple of \`heartbeatInterval\` — commonly 2× — so a client gets at least one missed-heartbeat grace before eviction. 60s timeout over a 30s heartbeat is the standard pairing, which is exactly the component defaults.

Mis-set symptom: none in the sim. In production, too-long timeouts inflate connection counts toward the cap; too-short ones disconnect healthy clients on brief network blips, triggering reconnect storms.`,
    category: 'config',
    relatedTopics: ['config.heartbeatInterval', 'config.maxConnections', 'config.timeout'],
  },

  'config.timeout': {
    title: 'Request timeout (ms)',
    shortDescription:
      'Declared request deadline — 30,000ms default on API gateway, 5,000ms on External Service. Not consumed; the sim has no per-request timeouts.',
    body: `# Request timeout (ms)

How long to wait on a request before giving up. Defaults: 30,000ms on the API gateway, 5,000ms on External Service nodes.

Not consumed by the engine. The tick-aggregate model has no per-request lifecycle to time out — slowness shows up as rising percentiles and queueing drops, never as deadline expiry. The field declares intent.

Why the declared values matter (§21): timeouts are the foundation of resilience — every other pattern (retries, circuit breakers, fallbacks) presumes a bounded wait. Rules worth recording in your design: set timeouts from the downstream's p99 plus margin, not from hope; make them **decrease** down the call chain (gateway 30s > service 5s > DB query 1s), or an inner call can outlive the outer one that already gave up, doing work nobody will receive. The 30s gateway default is a last-resort backstop, not a target — user-facing requests that take 30s are already failures.

Mis-set symptom: none in the sim. Watch the breaker/retry configs instead — those are the engine's live failure-handling knobs.`,
    category: 'config',
    relatedTopics: ['config.timeoutPerDownstream', 'config.connectionTimeout', 'config.retry.maxRetries', 'config.circuitBreaker.enabled'],
  },

  // ── Server ──────────────────────────────────────────────────────────────

  'config.cpuProfile': {
    title: 'CPU profile',
    shortDescription:
      "Declared instance size class (small/medium/large), default 'medium'. Not consumed — server CPU% derives from queueing utilization only.",
    body: `# CPU profile

The server's declared CPU class — \`small\` / \`medium\` / \`large\`. Default \`medium\`.

Not consumed by the engine. Server CPU% is computed purely from the queueing model: utilization = arrival rate × \`processingTimeMs\` ÷ \`instanceCount\`, times 100. A "large" profile does not process requests faster or raise capacity; the profile is a label.

To model a bigger box, change what the engine actually reads: lower \`processingTimeMs\` (faster cores finish work sooner) or raise \`maxConcurrent\` (more parallelism per instance). To model more boxes, raise \`instanceCount\`. This is the standard vertical-vs-horizontal trade (§20): vertical scaling (the thing this field gestures at) is simple but has a ceiling and leaves a single point of failure; horizontal scaling is what the simulator — and the autoscaler — natively model.

Mis-set symptom: none. The trap is assuming "large" bought you headroom — your capacity math should come from \`1000 / processingTimeMs × instanceCount\` RPS, profile regardless.`,
    category: 'config',
    relatedTopics: ['config.memoryProfile', 'config.processingTimeMs', 'config.instanceCount', 'config.maxConcurrent'],
  },

  'config.memoryProfile': {
    title: 'Memory profile',
    shortDescription:
      "Declared memory size class, default 'medium'. Not consumed — server memory% is derived from utilization (util × 60 + noise).",
    body: `# Memory profile

The server's declared memory class — \`small\` / \`medium\` / \`large\`. Default \`medium\`.

Not consumed by the engine. A server's reported memoryPercent is a derived figure: utilization × 60 plus a little random noise — i.e., memory pressure is modeled as a shadow of CPU/queueing pressure, not as an independent resource with a configurable size. The profile value changes nothing.

What memory% still does: it participates in health. Component health takes \`max(cpu%, memory%)\` against the 70% warning / 95% critical / 98% crash-chance thresholds, so a saturated server can tip into critical via the memory figure. But you influence that through the same levers as CPU — \`instanceCount\`, \`processingTimeMs\`, upstream load — not through this field.

If your design is genuinely memory-bound (large working sets, in-process caches), the simulator's server model won't capture it; consider modeling the memory-heavy concern as an explicit Cache node, where \`maxMemoryMb\` *is* consumed and drives hit rate and eviction.

Mis-set symptom: none.`,
    category: 'config',
    relatedTopics: ['config.cpuProfile', 'config.instanceCount', 'config.processingTimeMs'],
  },

  'config.instanceCount': {
    title: 'Instance count',
    shortDescription:
      'Number of server instances. Default 3 (engine fallback 1). Divides load in the queueing model; the autoscaler mutates it live.',
    body: `# Instance count

How many identical instances a server runs. Component default 3; the engine falls back to 1 when unset.

This is the primary horizontal-scaling knob, and the engine consumes it directly: the queueing model computes utilization as arrival rate × service time ÷ \`instanceCount\`, so doubling instances halves ρ and pulls p99 off the hockey-stick. The concurrency cap also scales with it (\`maxConcurrent × instanceCount\`). Capacity per instance ≈ \`1000 / processingTimeMs\` RPS; the drop-warning log does this exact arithmetic for you ("3 instances × 20 RPS each... Try 8+ instances").

It's also the value the autoscaler mutates at runtime — +1 instance per \`scaleUpDelaySeconds\` window while downstream CPU exceeds \`targetCpuThreshold\`, down to \`minInstances\` when CPU falls below half the target. Manual count is your starting point, not necessarily the run's ending point.

Guidance (§20): size for ρ ≈ 0.6–0.7 at expected peak; ρ ≥ 0.85 fires the saturation callout because queueing delay explodes there. Run \`instanceCount: 1\` behind no LB and preflight flags it as a SPOF.

Mis-set symptom: too few → drop warnings naming the exact shortfall; absurdly many → a 10/10 score that taught you nothing.`,
    category: 'config',
    relatedTopics: ['config.processingTimeMs', 'config.maxConcurrent', 'config.minInstances', 'config.maxInstances', 'config.targetCpuThreshold'],
  },

  'config.processingJitterMs': {
    title: 'Processing jitter (ms)',
    shortDescription:
      'Declared per-request service-time variance, default 20ms. Not consumed — latency spread comes from the Kingman model and wire jitter.',
    body: `# Processing jitter (ms)

Declared variance in a server's per-request processing time. Default 20ms.

Not consumed by the engine. Server latency spread comes from two other places: the Kingman G/G/1 queueing model — which derives p50/p95/p99 from utilization, arrival variance (set by the traffic phase shape) and \`serviceVariance\` (an optional config, calibrated or 1.0 = M/M/1) — and per-wire \`jitterMs\` on the network legs. A \`processingJitterMs\` value adds nothing on top.

If you want fatter service-time tails, the live knob is \`serviceVariance\`: values above 1.0 widen the wait-time distribution in the Kingman formula, modeling heterogeneous request costs (some requests 10×, the classic p99 driver per §7). Wire \`jitterMs\` handles network-side variance.

Mis-set symptom: none — tuning this field and watching p99 not move is the tell. Reach for \`serviceVariance\` or wire jitter instead.`,
    category: 'config',
    relatedTopics: ['config.processingTimeMs', 'config.jitterMs', 'config.instanceCount'],
  },

  // ── Autoscaler ──────────────────────────────────────────────────────────

  'config.minInstances': {
    title: 'Min instances',
    shortDescription:
      'Autoscaler scale-down floor, default 1. Connected servers are never shrunk below this when CPU falls under half the target.',
    body: `# Min instances

The autoscaler's floor. Default 1 (engine fallback matches).

How the engine uses it: each tick, the autoscaler inspects its connected **server** downstreams (other component types are ignored). When a server's CPU% drops below \`targetCpuThreshold × 0.5\`, the autoscaler decrements its \`instanceCount\` — but never below \`minInstances\`. Note the asymmetry in the model: scale-down is immediate (one instance per qualifying tick, no delay or cooldown applied), while scale-up is gated by \`scaleUpDelaySeconds\`.

Sizing (§20): the floor is your availability and cold-start insurance. \`minInstances: 1\` is a SPOF and gives a traffic spike nothing to land on while scale-up lags; 2–3 covers instance failure and absorbs the first seconds of a ramp. Set the floor to handle your *baseline* traffic at comfortable utilization — the autoscaler should handle the variance above baseline, not the baseline itself.

Mis-set symptom: after a quiet phase, a spike arrives at a scaled-to-the-floor fleet — drops and saturation callouts during the climb back up.`,
    category: 'config',
    relatedTopics: ['config.maxInstances', 'config.targetCpuThreshold', 'config.scaleUpDelaySeconds', 'config.instanceCount'],
  },

  'config.maxInstances': {
    title: 'Max instances',
    shortDescription:
      'Autoscaler ceiling, default 20. Scale-up stops here even if downstream CPU stays above the target threshold.',
    body: `# Max instances

The autoscaler's ceiling. Default 20 (engine fallback matches).

How the engine uses it: scale-up adds one instance per \`scaleUpDelaySeconds\` window while a connected server's CPU% exceeds \`targetCpuThreshold\` — but only while \`instanceCount < maxInstances\`. At the ceiling, scaling stops and the server simply runs hot: CPU climbs, ρ ≥ 0.85 fires the saturation callout, drops begin, and above 98% utilization there's a per-tick crash chance.

Why a ceiling exists (§20): in production it's a cost guardrail and a blast-radius limit — a retry storm or a bug that manufactures load shouldn't be allowed to 100× your fleet. It also protects downstreams: every server you add forwards more traffic to the DB behind it, and DBs don't autoscale. A common failure: generous server ceiling, fixed connection pool → scaling "succeeds" while the database drowns.

Sizing: ceiling = peak design RPS ÷ per-instance capacity (\`1000 / processingTimeMs\`), plus margin. Then check the DB survives ceiling-level traffic.

Mis-set symptom: scaling log lines stop appearing while CPU stays pinned above target — the ceiling, not the threshold, has become the binding constraint.`,
    category: 'config',
    relatedTopics: ['config.minInstances', 'config.targetCpuThreshold', 'config.scaleUpDelaySeconds', 'config.connectionPoolSize'],
  },

  'config.targetCpuThreshold': {
    title: 'Target CPU threshold (%)',
    shortDescription:
      'Autoscaler trigger, default 70%. Scale up when a connected server exceeds it; scale down below half of it.',
    body: `# Target CPU threshold (%)

The CPU level the autoscaler steers connected servers toward. Default 70% (engine fallback matches).

How the engine consumes it — two trigger lines, both evaluated per tick against each connected server's CPU%:

- **Above the threshold** → scale up (+1 instance, gated by \`scaleUpDelaySeconds\`, capped at \`maxInstances\`). The log tells you: "Scaling server-1 to 4 instances. CPU was 82%."
- **Below half the threshold** (35% at default) → scale down (−1, floored at \`minInstances\`), immediately.

The gap between the two lines is the hysteresis band that prevents flapping — without it, scaling up would drop CPU below the trigger and immediately scale back down.

Why 70% is the canonical default (§20): it leaves headroom for the load increase that happens *during* the scale-up delay. CPU% on servers is queueing utilization, and §7's math is unforgiving above ρ ≈ 0.85 — a threshold of 90 means you start adding capacity after latency has already collapsed. Lower thresholds buy responsiveness at the cost of running more instances.

Mis-set symptom: threshold too high → saturation callouts and drops arrive before the first scaling event; too low → instance count oscillates with every traffic wobble.`,
    category: 'config',
    relatedTopics: ['config.minInstances', 'config.maxInstances', 'config.scaleUpDelaySeconds', 'config.cpu'],
  },

  'config.scaleUpDelaySeconds': {
    title: 'Scale-up delay (seconds)',
    shortDescription:
      'Pacing for autoscaler growth, default 30s. At most one +1-instance event per delay window; models real provisioning lag.',
    body: `# Scale-up delay (seconds)

How fast the autoscaler is allowed to add capacity. Default 30s (engine fallback matches).

How the engine consumes it: when a connected server's CPU exceeds \`targetCpuThreshold\`, the +1-instance event only fires on ticks where \`time % scaleUpDelaySeconds < tickInterval\` — effectively **one instance added per delay window**, per server. With the default, a server that needs 5 more instances takes ~2.5 simulated minutes to get them. Scale-down has no such gate; shrinking is immediate.

This models the real cost of scale-up (§20): VM boot, container pull, app start, warm-up — reacting to a spike takes 30s–minutes in production, and that lag is precisely why spikes hurt even autoscaled systems. The window between "spike arrives" and "capacity exists" is covered by your headroom (\`minInstances\`, threshold margin) or it's covered by drops.

Sizing: 30–60s is honest for container platforms; don't set 1–5s unless you're modeling pre-provisioned warm pools — it makes the autoscaler a magic wand and your debrief a lie.

Mis-set symptom: too long → every spike phase produces a drop trough before the scaling log lines catch up; too short → spikes look free, hiding a real-world failure mode.`,
    category: 'config',
    relatedTopics: ['config.targetCpuThreshold', 'config.maxInstances', 'config.cooldownSeconds', 'config.instanceCount'],
  },

  'config.cooldownSeconds': {
    title: 'Cooldown (seconds)',
    shortDescription:
      'Declared post-scaling quiet period, default 60s. Not consumed by the autoscaler — only scale-up pacing (scaleUpDelaySeconds) is modeled.',
    body: `# Cooldown (seconds)

The declared quiet period after a scaling action before another may fire. Default 60s on the autoscaler.

Not consumed by the engine's autoscaler. Verified behavior: scale-up is paced by \`scaleUpDelaySeconds\` only, and scale-down happens immediately whenever a server's CPU sits below half the target — no cooldown is checked in either direction. (Don't confuse this with the per-wire circuit breaker's \`cooldownSeconds\`, which **is** live — that one times the OPEN → HALF_OPEN transition and has its own wiki entry.)

What cooldown does in real autoscalers (§20): after adding capacity, metrics need time to reflect the new fleet — instances boot, load redistributes, CPU averages settle. Acting on pre-settlement readings causes over-shoot (scaling far past need) and flapping. AWS-style policies default to 60–300s for exactly this reason.

Practical consequence in the sim: scale-down can be twitchier than reality — a brief lull lets the fleet shrink instantly, and the next spike pays \`scaleUpDelaySeconds\` to climb back. If that pattern distorts a run, raise \`minInstances\` to blunt it.

Mis-set symptom: none in the sim.`,
    category: 'config',
    relatedTopics: ['config.scaleUpDelaySeconds', 'config.minInstances', 'config.targetCpuThreshold', 'config.circuitBreaker.cooldownSeconds'],
  },

  // ── Fan-out ─────────────────────────────────────────────────────────────

  'config.multiplier': {
    title: 'Fan-out multiplier',
    shortDescription:
      'Output amplification: downstream RPS = inbound × multiplier. Default 500,000 (celebrity-post scale). Also sets the tail-risk widget N.',
    body: `# Fan-out multiplier

How many downstream messages one inbound request becomes. Default 500,000 — deliberately celebrity-post scale (one tweet → half a million timeline deliveries).

How the engine consumes it: \`outputRps = inboundRps × multiplier\`, emitted to downstreams. This is the single most explosive knob in the simulator — 10 RPS in becomes 5M RPS out at the default, which will flatten any unbuffered downstream instantly. It also shapes the fanout's own latency: 10ms flat in \`parallel\` delivery mode, \`multiplier × 0.001\` ms in serial mode (500ms at the default — serial delivery of 500k messages is the point being made).

The multiplier also drives the **tail-risk widget** in the config panel: N in the Dean-Barroso compounding formula \`P(at least one slow) = 1 − (1 − 0.01)^N\` is the multiplier when > 1. At N = 500,000 that probability is effectively 100% — every fan-out sees slow legs; design for it (§24).

Guidance: put a queue between fanout and consumers — absorbing the write burst asynchronously is the canonical pattern (§13, §24). Size the multiplier to your real follower/subscriber distribution, not the maximum.

Mis-set symptom: downstream queue-depth explosions or instant DB saturation the moment any traffic reaches the fanout.`,
    category: 'config',
    relatedTopics: ['config.timeoutPerDownstream', 'config.maxConcurrent', 'config.connectionPoolSize', 'config.processingTimeMs'],
  },

  'config.timeoutPerDownstream': {
    title: 'Timeout per downstream (ms)',
    shortDescription:
      'Declared deadline for each fan-out delivery leg, default 5,000ms. Not consumed — the sim has no per-leg timeout mechanics.',
    body: `# Timeout per downstream (ms)

The declared deadline on each individual downstream delivery in a fan-out. Default 5,000ms.

Not consumed by the engine. The sim's fanout multiplies RPS and emits it in one aggregate step; there are no per-leg request lifecycles to time out, so slow or failed legs never expire — they just show up as downstream saturation and error rates.

Why the field matters as design intent (§24, §21): in a real scatter-gather, the *slowest* leg sets your response time, and the tail-risk math on this panel shows why — with N legs at p(slow) ≈ 1%, the probability of at least one slow leg is \`1 − 0.99^N\`, near-certain for any large N. Per-leg timeouts (paired with partial-result tolerance or hedged requests) are the standard countermeasure: cap each leg at the downstream's p99-plus-margin and return with what you have. A 5s timeout on a 50ms-p99 downstream is a backstop, not protection.

Mis-set symptom: none in the sim. Read downstream queue depth and error rates to see fan-out pain instead.`,
    category: 'config',
    relatedTopics: ['config.multiplier', 'config.timeout', 'config.retry.maxRetries'],
  },

  // ── CDN / external / misc ───────────────────────────────────────────────

  'config.originPullLatencyMs': {
    title: 'Origin pull latency (ms)',
    shortDescription:
      'Latency for CDN cache misses fetching from origin. Default 200ms. Blends into CDN p50 by miss rate; sets CDN p99 outright.',
    body: `# Origin pull latency (ms)

How long a CDN cache miss takes to fetch from origin. Default 200ms (engine fallback matches).

How the engine consumes it: CDN latency is a hit/miss blend — \`hitRate × 5ms + (1 − hitRate) × originPullLatencyMs\`. At the default 90% hit rate that's ~24.5ms p50. The CDN's p99 is set to the full origin latency, on the unforgiving logic that your slowest percentile *is* a miss. Misses are also forwarded downstream as real traffic (\`rps × (1 − hitRate)\`), so origin components feel exactly the miss volume.

Stressed mode forces the CDN cold (hit rate 0): every request pays full origin latency and the entire load lands on origin — worth a run before trusting any CDN-fronted design.

Value guidance: 50–100ms for same-continent origin pulls, 150–300ms cross-continent — edge-to-origin is a real WAN round trip plus origin render time. The whole CDN argument (§10) lives in the gap between 5ms edge hits and this number.

Mis-set symptom: an optimistic (low) value makes cold-cache and stressed runs look survivable when the real origin would be melting.`,
    category: 'config',
    relatedTopics: ['config.latencyMs', 'config.ttl', 'config.errorRate'],
  },

  'config.errorRate': {
    title: 'Error rate',
    shortDescription:
      "External Service baseline failure fraction (0–1). Default 0.01. Engine reports it plus up to +0.02 random noise each tick.",
    body: `# Error rate

The External Service's baseline failure fraction, 0–1. Default 0.01 (1%); engine fallback matches.

How the engine consumes it: each tick the node reports \`errorRate = configured + random() × 0.02\` — your floor plus up to two points of noise, modeling third-party flakiness you don't control. That observed errorRate is a live control signal for everything upstream: retry policies amplify their forwarded RPS geometrically off it (\`1 + e + e² + …\`), circuit breakers compare it against their failure threshold, and backpressure derives acceptance from it.

This makes the external node the cleanest fault injector in the simulator. Set 0.3–0.5 and watch a retry-configured upstream manufacture a retry storm (§41); add a breaker on the wire and watch it open. Real-world anchors: a healthy SaaS API runs 0.1–1%; a degraded one 5–20%; an outage 50%+.

One modeling note: external nodes are pure leaves — they report errors but never forward traffic, so their failure propagates upstream via control signals, not via dropped downstream flow.

Mis-set symptom: set near 1.0 with naive retries upstream, the amplified load can take out components that never touch the external service — the cascade is the lesson.`,
    category: 'config',
    relatedTopics: ['config.latencyMs', 'config.name', 'config.retry.maxRetries', 'config.circuitBreaker.failureThreshold'],
  },

  'config.name': {
    title: 'External service name',
    shortDescription:
      "Display label for the External Service node (default 'External API'). Cosmetic — the engine never reads it.",
    body: `# External service name

The External Service node's display label — "Stripe", "Twilio", "Auth0". Default \`External API\`. It identifies the node on the canvas, in logs, and in the AI debrief; the engine never reads it, so it changes no simulation math. Use a real vendor name anyway: it keeps the debrief narrative concrete and reminds you which \`latencyMs\` / \`errorRate\` figures you were modeling.`,
    category: 'config',
    relatedTopics: ['config.errorRate', 'config.latencyMs', 'config.timeout'],
  },

  'config.engine': {
    title: 'DB engine',
    shortDescription:
      "Database engine label, default 'postgres'. Cosmetic — engine math uses throughput/pool configs; calibration anchors are fixed to postgres.",
    body: `# DB engine

The database's engine label — default \`postgres\`. The simulation never reads it: a DB's behavior comes entirely from its numeric configs (\`readThroughputRps\`, \`writeThroughputRps\`, \`connectionPoolSize\`, sharding fields), and the calibration anchors that backfill unset throughputs are keyed to postgres regardless of this value. To model Cassandra-ish or Redis-ish behavior, set the numbers — e.g., much higher write throughput, eventual-consistency assumptions — rather than relying on the label (§11).`,
    category: 'config',
    relatedTopics: ['config.connectionPoolSize', 'config.processingTimeMs', 'config.name'],
  },

  'config.heartbeatInterval': {
    title: 'Heartbeat interval (ms)',
    shortDescription:
      'WebSocket gateway ping cadence, default 30,000ms. Not consumed — sim connection churn is a fixed decay, not heartbeat-driven.',
    body: `# Heartbeat interval (ms)

How often the WebSocket gateway pings connected clients to confirm they're alive. Default 30,000ms (30s).

Not consumed by the engine. Sim-side connection dynamics are a fixed model — connections grow at 10% of inbound RPS and decay 0.1% per tick — with no heartbeat traffic, no missed-ping detection, and no heartbeat CPU cost. The field records operational intent.

What it governs in reality: dead-peer detection and NAT keepalive. Mobile and home-router NATs silently drop idle mappings after 30–120s, so heartbeats below that window keep connections routable; missed heartbeats (usually paired with \`connectionTimeout\` ≈ 2× the interval — the component defaults are exactly 30s/60s) let the server reap zombies before they pile up against \`maxConnections\`. The trade: shorter intervals detect death faster and survive aggressive NATs, but at 1M connections a 30s heartbeat is already ~33k pings/sec of background load — halve the interval, double that.

Mis-set symptom: none in the sim. In production, too-long intervals show as ghost connections inflating counts; too-short as wasted bandwidth and battery drain on mobile clients.`,
    category: 'config',
    relatedTopics: ['config.connectionTimeout', 'config.maxConnections', 'config.timeout'],
  },
};
