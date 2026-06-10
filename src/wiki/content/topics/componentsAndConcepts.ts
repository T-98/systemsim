/**
 * @file wiki/content/topics/componentsAndConcepts.ts
 *
 * Hand-written wiki content for the 11 component topics and 7 concept
 * topics declared as empty placeholders in `src/wiki/topics.ts`. The main
 * registry imports `COMPONENT_AND_CONCEPT_TOPICS` and merges it over the
 * placeholders (same pattern as the generated reference/learn/howto files).
 *
 * Every engine claim in these bodies is grounded in
 * `src/engine/SimulationEngine.ts` (processX functions),
 * `src/engine/QueueingModel.ts`, `src/engine/WorkingSetCache.ts`,
 * `src/engine/CircuitBreaker.ts` / `RetryPolicy.ts` / `Backpressure.ts`,
 * and the defaults in `src/types/components.ts` COMPONENT_DEFS.
 * Conceptual material distilled from `system-design-knowledgebase.md`
 * (§ references are auto-linked by the renderer).
 */

import type { Topic } from '../../topics';

export const COMPONENT_AND_CONCEPT_TOPICS: Record<string, Topic> = {
  // ── Components ──────────────────────────────────────────────────────────

  'component.server': {
    title: 'Server',
    shortDescription:
      'A pool of identical compute instances that processes requests. Latency comes from a queueing model that explodes as utilization nears 100%.',
    body:
      "Models a pool of identical stateless instances — app servers, workers, anything that burns CPU per request. Each instance serves `1000 / processingTimeMs` requests per second; total capacity is that times `instanceCount`.\n\n## Key config\n\n- `processingTimeMs` (default 50 → 20 RPS per instance) — service time per request.\n- `instanceCount` (default 3) — horizontal scale.\n- `maxConcurrent` (default 1000) — per-instance concurrency ceiling.\n- `processingJitterMs` (default 20) — display-level variance.\n- `cpuProfile` / `memoryProfile` are labels only; the engine derives CPU% from utilization, not from the profile.\n\n## How the engine treats it\n\nEach tick runs a Kingman G/G/1 approximation per instance (Whitt two-moment). Utilization ρ = arrival rate / (instances × service rate); wait ≈ `processingTimeMs × ρ/(1−ρ) × (Cₐ²+C_s²)/2`. With defaults (steady traffic, `serviceVariance` = 1.0) this collapses to M/M/1 exactly. CPU% = ρ × 100. Above ρ = 1 the overflow is dropped — `dropRate = 1 − 1/ρ` — and surfaces as `errorRate`. Bursty traffic phases (`spike`, `instant_spike`) raise the arrival-variance prior, so the same RPS queues harder (see §44). A second drop path uses Little's Law: when in-flight requests (λ × W) exceed `maxConcurrent × instanceCount`, the excess drops.\n\n## Failure modes to watch\n\n- One-shot saturation callout at ρ ≥ 0.85 — your headroom warning.\n- Health turns warning above 70% utilization, critical above 95%.\n- Above 98% the pool can crash (30% chance per tick) and stays down for the run.\n\nWire an Autoscaler at the server to grow `instanceCount` under load. The queueing math is §7; see also [Configuring a component](#docs/learn/configuring-a-component).",
    category: 'component',
    relatedTopics: [
      'config.processingTimeMs',
      'config.instanceCount',
      'config.maxConcurrent',
      'concept.utilization',
      'concept.littlesLaw',
      'component.autoscaler',
    ],
  },

  'component.database': {
    title: 'Database',
    shortDescription:
      'Persistent store with separate read and write capacity, a connection pool, optional replicas and shards. Usually the first thing to break.',
    body:
      "Models a persistent store (Postgres-like by default) whose capacity is split by side: read capacity = `readThroughputRps × (1 + readReplicas)`, write capacity = `writeThroughputRps`. Defaults: 50k reads, 20k writes, `connectionPoolSize` 100, 0 replicas, `replicationLagMs` 10.\n\n## How the engine treats it\n\n- **Read/write split.** When your design has endpoint routes + a schema, inbound traffic is attributed per table access (reads vs writes per endpoint). Without that, a fixed 70/30 read/write fallback applies — a modeling assumption, stated as such. Saturating either side raises that side's errorRate: `(utilization − 1) × 0.5`, capped at 0.9.\n- **Connection pool.** Unserved requests accumulate as connections. Above 80% pool use a callout fires; above 100%, queries fail.\n- **Latency.** Base 5 ms times a load curve `1 + utilization⁴ × 50` — flat until ~80%, then vertical. p99 adds `replicationLagMs`. Endpoints hitting tables without an index get a 10× scan multiplier on their share of traffic.\n- **Sharding.** With `shardingEnabled` + `shardCount`, a high-cardinality shard key splits load evenly. A low-cardinality key (or one containing \"user\") triggers a Pareto hot shard: 78% of load on one shard — see the Hot shard concept.\n- **Aggregate errorRate** = max(read saturation, write saturation, pool exhaustion). Circuit breakers, retries, and backpressure all read this aggregate; the split fields are diagnostic only.\n\n## Failure modes to watch\n\n- Pool exhaustion before throughput exhaustion — pool too small for the latency you're running at.\n- Read saturation → add replicas or a cache. Write saturation → shard or batch.\n- Hot shard and unindexed scans, both called out one-shot in the log.\n\nBackground: §11–12. Reproduce the skew case in [Reproduce a hot shard](#docs/howto/hotShard).",
    category: 'component',
    relatedTopics: [
      'config.readThroughputRps',
      'config.writeThroughputRps',
      'config.readReplicas',
      'config.connectionPoolSize',
      'config.shardCount',
      'concept.hotShard',
    ],
  },

  'component.cache': {
    title: 'Cache',
    shortDescription:
      'In-memory cache in front of the database. Hit rate comes from a Zipfian working-set model; misses pass through to downstream.',
    body:
      "Models an in-memory cache (Redis-like) that absorbs reads in front of slower storage. The simulator does NOT track individual keys — hit rate comes from a Zipfian working-set model: working set = min(100k keys, RPS × `ttlSeconds`), hit rate = `(capacity / workingSet)^(1/1.2)`, with key cardinality fixed at 100k keys of ~512 bytes. That's a deliberate simplification; per-key behavior (single-flight, negative caching) is not modeled.\n\n## Key config\n\n- `ttlSeconds` (default 300) — longer TTL = bigger working set covered = higher hit rate, more staleness.\n- `maxMemoryMb` (default 1024) — capacity in entries comes from this.\n- `evictionPolicy` (default lru) — LRU takes a ×0.85 hit-rate penalty when key cardinality exceeds 2× capacity (scan churn).\n- `writeStrategy` is recorded but not read by the engine.\n\n## How the engine treats it\n\n- **Cold start.** Hit rate ramps linearly from 0 over the first `ttl × 0.5` seconds — early ticks always hammer the origin.\n- **Misses flow downstream.** Forwarded RPS = inbound × (1 − hitRate). A 90% hit rate shields the DB from 90% of reads; a cold cache shields nothing.\n- **Latency.** 0.5 ms p50 (1 ms above 4 GB, 20 ms when TTL > 1 h — treated as CDN-tier). p99 is 10× worse when hit rate ≤ 50%.\n- **Stampede.** With RPS > 1000, TTL < 60 s, and a high hit rate, every TTL boundary triggers mass expiry: hit rate cut to 30% for ~2 s and the misses flood the DB (see the Cache stampede concept). A miss-storm callout fires when hit rate falls from ≥80% to ≤50%.\n- **Stressed runs** force a cold cache for the whole run — worst case, no warmup.\n\nFull caching curriculum: §10. Break it on purpose in [Reproduce a cache stampede](#docs/howto/cacheStampede).",
    category: 'component',
    relatedTopics: [
      'config.ttlSeconds',
      'config.maxMemoryMb',
      'config.evictionPolicy',
      'concept.cacheStampede',
      'component.database',
    ],
  },

  'component.queue': {
    title: 'Message Queue',
    shortDescription:
      'Async buffer between producers and consumers. Bursts pile up as queue depth; overflow drops messages or dead-letters them.',
    body:
      "Models an async buffer (Kafka/RabbitMQ-shaped) that decouples producer rate from consumer rate. The producer never blocks; the queue absorbs bursts as depth, and consumers drain at their own pace.\n\n## Key config\n\n- `consumerGroupCount` × `consumersPerGroup` ÷ `processingTimeMs` sets drain capacity: defaults (1 group × 5 consumers × 10 ms) = 500 msg/s.\n- `maxDepth` (default 10,000,000) — buffer size before overflow.\n- `dlqEnabled` — overflow goes to a dead-letter queue (counted as errors) instead of being silently dropped.\n- `retryCount` is recorded but not read by the engine.\n\n## How the engine treats it\n\nEach tick: inbound adds to `queueDepth`, consumers drain up to capacity, the remainder waits. Delivery latency is the queue's whole latency story: p50 = depth ÷ drain rate (in ms), p99 = 3× that. Depth past `maxDepth` overflows — messages drop (or dead-letter), setting `errorRate`. `memoryPercent` = depth/maxDepth, so health tracks fill level. A one-shot callout fires at 70% capacity; overflow logs as critical.\n\nConsumed messages forward downstream at the drain rate — this is the point: downstream sees at most consumer capacity, never the producer burst.\n\n## Failure modes to watch\n\n- **Consumers slower than producers.** Depth grows without bound until `maxDepth`. A queue hides overload as latency first (seconds, then minutes of delivery delay), then as loss. Watch depth trend, not just errors.\n- **Sized-to-hide.** A huge `maxDepth` means you find out about under-consumption hours late. Smaller depth + backpressure fails faster and more honestly.\n\nFix direction: more consumers, faster `processingTimeMs`, or shed load upstream. Background: §13; see also the Backpressure concept.",
    category: 'component',
    relatedTopics: [
      'config.maxDepth',
      'config.consumersPerGroup',
      'config.consumerGroupCount',
      'config.processingTimeMs',
      'config.dlqEnabled',
      'concept.backpressure',
    ],
  },

  'component.loadBalancer': {
    title: 'Load Balancer',
    shortDescription:
      'Splits incoming traffic evenly across healthy downstream instances and skips crashed ones. Latency tracks the slowest healthy backend.',
    body:
      "Models the first scaling move most systems make: something in front of a pool of backends that spreads requests across them (§9).\n\n## How the engine treats it\n\nEach tick the LB splits inbound RPS **evenly** across all wired downstreams, excluding crashed nodes and any wire whose circuit breaker is OPEN — it won't route to something the design already decided to fail fast on. If every backend is crashed or breakered, errorRate goes to 1.0 and a critical log fires.\n\nThe LB adds 0.5 ms of its own processing. Its reported latency derives from the **slowest healthy backend** (previous tick's latency + wire hop): p50 = 0.5 + 0.7 × max, p99 = 0.5 + 1.3 × max. One slow backend drags the whole pool's numbers — the slowest replica is the story.\n\n## Key config (and what's modeled)\n\n- `algorithm` (round-robin, least-connections, …) is recorded but the engine always splits evenly — algorithm choice is not yet simulated.\n- `healthCheckInterval` / `healthCheckTimeout` / `unhealthyThreshold` are likewise display-only; backend health comes from the engine's crash state, not from probes.\n\nThe simplification is honest: even-split round-robin over healthy backends, which is what the named defaults reduce to anyway.\n\n## Failure modes to watch\n\n- **Survivor pile-on.** When one backend crashes, its share lands on the survivors — each gets more load, runs hotter, and is likelier to crash next. The classic cascade.\n- **All-backends-down.** errorRate 1.0 at the LB; upstream retries (if configured) then amplify against a dead pool.\n\nPair wires from the LB with circuit breakers so failed backends are dropped from rotation rather than dragged along. See §9 and [Resilience patterns](#docs/learn/resilience-patterns).",
    category: 'component',
    relatedTopics: [
      'config.algorithm',
      'config.healthCheckInterval',
      'component.server',
      'config.circuitBreaker.enabled',
      'concept.utilization',
    ],
  },

  'component.apiGateway': {
    title: 'API Gateway',
    shortDescription:
      'Front door that enforces a hard requests-per-second rate limit. Traffic over the limit is rejected at the edge before it hits your system.',
    body:
      "Models the system's front door: a single entry component that enforces a hard rate limit before traffic reaches anything expensive (§15, §22). Not in the default component palette — load it from a template, a session, or the advanced palette.\n\n## How the engine treats it\n\nEach tick, passthrough = min(inbound, `rateLimitRps`). Everything above the limit is rejected at the gateway and counted in its `errorRate`; a warning logs when more than 10% of requests are being rejected. The gateway adds ~2 ms p50 / ~10 ms p99 of its own latency, then forwards the surviving traffic downstream.\n\n## Key config (and what's modeled)\n\n- `rateLimitRps` (default 10,000) — the only field the engine reads. This is a fixed per-tick ceiling, not a token bucket.\n- `rateLimitBurst`, `authMiddleware`, `timeout` are recorded but display-only in the current engine.\n\n## Why you'd use it\n\nRejection at the edge is cheap; collapse at the database is not. A gateway set just below your downstream capacity converts an `instant_spike` into a bounded stream plus a visible rejection rate — errors you chose, at the layer you chose. Compare with backpressure, which achieves a similar shaping reactively from the downstream side.\n\n## Failure modes to watch\n\n- **Limit set too high** — the gateway passes everything and you discover the real limit at the DB instead.\n- **Limit set too low** — steady-state traffic gets rejected; the errorRate at the gateway is your own config, not load.\n- Rejected traffic still counts against the run's error budget in the debrief — rate limiting is a trade, not a free fix.",
    category: 'component',
    relatedTopics: [
      'config.rateLimitRps',
      'config.rateLimitBurst',
      'component.loadBalancer',
      'concept.backpressure',
    ],
  },

  'component.websocketGateway': {
    title: 'WebSocket Gateway',
    shortDescription:
      'Holds persistent client connections for real-time delivery. Fails when accumulated connections exhaust its configured limit.',
    body:
      "Models the persistent-connection tier of a real-time system — chat, live feeds, presence. Where an HTTP server's cost is per request, a WebSocket gateway's cost is per **held connection**. Engine-supported but in the advanced palette, not the default six.\n\n## How the engine treats it\n\nConnections accumulate over the run: each tick adds 0.1 connections per inbound request and decays 0.1% of the total. `memoryPercent` = connections / `maxConnections`, so health tracks connection fill, not RPS. Latency is fixed and cheap — 2 ms p50, 15 ms p99 — because pushing a frame down an open socket costs almost nothing. The full inbound forwards downstream.\n\n## Key config (and what's modeled)\n\n- `maxConnections` (default 100,000) — the capacity that actually matters. A warning logs at 90% fill.\n- `heartbeatInterval` / `connectionTimeout` are recorded but display-only.\n\n## Failure modes to watch\n\n- **Slow exhaustion.** Because connections accumulate and barely decay, a long run at modest RPS can exhaust capacity even though every individual tick looks fine. Watch the memory% trend, not the instant value.\n- **Crash at the connection tier is expensive.** In real systems every dropped client reconnects at once (a thundering herd the simulator does not model — say so when reasoning about results).\n\nTypical topology: fan-out service → WebSocket gateway → clients, with a queue buffering the fan-out burst. See the Fan-out component and §24.",
    category: 'component',
    relatedTopics: [
      'config.maxConnections',
      'config.heartbeatInterval',
      'config.connectionTimeout',
      'component.fanout',
    ],
  },

  'component.fanout': {
    title: 'Fan-out',
    shortDescription:
      'Multiplies every inbound message into many downstream deliveries — one post becomes N notifications. The multiplier is the whole story.',
    body:
      "Models the write-amplification step of feed and notification systems: one inbound event becomes `multiplier` outbound deliveries (§24). One celebrity post → 500,000 timeline inserts. This is intentional traffic amplification; the retry storm is its accidental twin (§41).\n\n## How the engine treats it\n\nOutput RPS = inbound × `multiplier` (default 500,000), split evenly across downstream wires. Latency depends on `deliveryMode`: `parallel` costs a flat 10 ms; `sequential` costs `multiplier × 0.001` ms — 500 ms at the default multiplier, which is the point: sequential fan-out at scale is latency suicide. The engine also walks configured multipliers when attributing traffic to downstream databases, so a `service → fanout(10) → db` route correctly accounts the DB for 10× the entry traffic.\n\nSelecting a fan-out node shows the **tail-at-scale widget**: P(at least one slow leg) = 1 − (1 − 0.01)^N (Dean & Barroso, CACM 2013). At N = 100, ~63% of requests see at least one slow leg; at N = 500,000 it's a certainty. The 1% per-leg probability is a UI prior, not an engine measurement.\n\n## Key config\n\n- `multiplier` — the amplification factor. Everything downstream is sized against inbound × this.\n- `deliveryMode` — parallel vs sequential latency model.\n- `timeoutPerDownstream` is recorded but display-only.\n\n## Failure modes to watch\n\n- **Downstream sizing.** A 1 RPS trickle into a 500k fan-out is 500k wps at whatever comes next. Put a queue between fan-out and storage so the burst becomes depth instead of drops.\n- **Hot-key amplification.** Combine with a low-cardinality shard key and the amplified writes concentrate on one shard — see Hot shard.",
    category: 'component',
    relatedTopics: [
      'config.multiplier',
      'config.deliveryMode',
      'component.queue',
      'concept.retryStorm',
      'component.websocketGateway',
    ],
  },

  'component.cdn': {
    title: 'CDN',
    shortDescription:
      'Edge cache with a fixed, configured hit rate. Hits return at edge speed; misses pull from origin and continue downstream.',
    body:
      "Models an edge cache for static and cacheable content. Engine-supported but in the advanced palette, not the default six.\n\n## How the engine treats it\n\nUnlike the Cache component, the CDN's hit rate is **not modeled — it is your config, verbatim**: `cacheHitRate` (default 0.9). There is no working-set math, no warmup, no stampede. Per tick:\n\n- Blended latency = hitRate × 5 ms + (1 − hitRate) × `originPullLatencyMs` (default 200 ms). p99 is the full origin-pull latency — the tail is always a miss.\n- Misses forward downstream: forwarded RPS = inbound × (1 − hitRate). At the default 90%, your origin sees 10% of edge traffic.\n- `regions` is recorded but display-only.\n- **Stressed runs force hit rate to 0** — every request pulls origin. This is the run that tells you whether the origin survives a cold edge.\n\n## Key config\n\n- `cacheHitRate` — the single most load-bearing number on this component, and it's an assumption you typed in, not a simulation result. Treat it as a claim to challenge.\n- `originPullLatencyMs` — what a miss costs.\n\n## Failure modes to watch\n\n- **Optimistic hit rate.** Setting 0.95 because it sounds right hides 19/20ths of origin load. Run stressed ([Run stressed](#docs/learn/run-stressed)) to see the floor.\n- **Origin sized for the steady state.** Cache invalidation events and cold starts in real CDNs behave like the stampedes in §10 — the simulator only shows this if you lower the hit rate yourself.\n\nFor dynamic content caching with modeled hit rates, use the Cache component instead.",
    category: 'component',
    relatedTopics: [
      'config.cacheHitRate',
      'config.originPullLatencyMs',
      'component.cache',
      'concept.cacheStampede',
    ],
  },

  'component.external': {
    title: 'External Service',
    shortDescription:
      "A third-party dependency you don't control, modeled as fixed latency plus a fixed error rate. Terminal — nothing forwards past it.",
    body:
      "Models a third-party dependency — payment processor, email API, geocoder — as a fixed-behavior stub. You don't control its capacity, so the simulator doesn't model any: it never saturates, never queues, never crashes. Its failure behavior is whatever you configure. Engine-supported but in the advanced palette.\n\n## How the engine treats it\n\n- p50 = `latencyMs` (default 100), p99 = 3× that.\n- errorRate = `errorRate` (default 0.01) plus up to 0.02 of random jitter per tick — third parties are noisy even when healthy.\n- **Terminal node.** It forwards nothing downstream; the chain ends here.\n- `timeout` and `name` are recorded but display-only.\n\n## Why it matters\n\nThe external service is the canonical target for resilience patterns, because it's the dependency whose outage you can't fix — only contain (§21). Its errorRate feeds the same wire-level signals as every other component: a breaker on the wire trips when the error rate crosses the threshold; an upstream retry policy amplifies against it; backpressure has no effect (the stub doesn't saturate).\n\n## Failure modes to watch\n\n- **Coupling availability.** A synchronous call to a 99% external API caps your own availability at 99%, minus everything else. Chain two and you're below either.\n- **Retry amplification against an outage.** Set `errorRate` to 0.5, add an upstream retry policy, and watch the load double for zero benefit — then add a breaker and watch it stop. Walk through it in [Trip a circuit breaker](#docs/howto/breakerTrip).",
    category: 'component',
    relatedTopics: [
      'config.latencyMs',
      'config.errorRate',
      'config.timeout',
      'concept.circuitBreakerStates',
      'config.circuitBreaker.enabled',
    ],
  },

  'component.autoscaler': {
    title: 'Autoscaler',
    shortDescription:
      "Watches wired servers' CPU and adds or removes instances around a target threshold, with a realistic scale-up delay.",
    body:
      "Models reactive horizontal scaling — an ASG/HPA-like controller. Wire it **to** the server pool it should manage; it carries no traffic itself (its RPS is always 0). Engine-supported but in the advanced palette.\n\n## How the engine treats it\n\nEach tick it inspects every downstream component of type `server` (only servers — databases and caches are not scaled):\n\n- **Scale up.** If the server's CPU% exceeds `targetCpuThreshold` (default 70) and instances < `maxInstances` (default 20), add one instance — but only on ticks aligned to `scaleUpDelaySeconds` (default 30). That delay models real boot time and is the whole lesson: capacity arrives late.\n- **Scale down.** If CPU% falls below half the threshold and instances > `minInstances` (default 1), remove one instance immediately.\n- `cooldownSeconds` is recorded but not read by the current engine; the scale-up delay is the only timing control.\n\nBecause the server's CPU% is utilization (ρ × 100), the autoscaler is effectively holding ρ near `targetCpuThreshold`/100 — which is why 70 is a sane default: it keeps headroom below the ρ ≥ 0.85 saturation zone (see Utilization).\n\n## Failure modes to watch\n\n- **Steps beat ramps.** An `instant_spike` saturates the pool for the full 30 s before the first new instance lands — and one instance per 30 s may never catch a 10× step. Autoscaling absorbs ramps, not steps. Pair with a rate limit or queue for spikes.\n- **maxInstances as a silent ceiling.** Once pinned at max, the autoscaler goes quiet and the server saturates anyway. Check the scaling log lines in the live log.\n\nScaling sequence and when to scale what: §20.",
    category: 'component',
    relatedTopics: [
      'config.targetCpuThreshold',
      'config.minInstances',
      'config.maxInstances',
      'config.scaleUpDelaySeconds',
      'component.server',
      'concept.utilization',
    ],
  },

  // ── Concepts ────────────────────────────────────────────────────────────

  'concept.backpressure': {
    title: 'Backpressure propagation',
    shortDescription:
      'Saturated components advertise how much traffic they can accept; upstreams scale what they forward down by that rate one tick later.',
    body:
      "Backpressure is the saturated component pushing back instead of silently failing. In the simulator it's opt-in per component (`backpressure.enabled`) and works as a one-tick-delayed feedback signal (§42).\n\n## The mechanism\n\nAt end of tick, an enabled component computes `acceptanceRate = clamp(1 − errorRate, 0, 1)` from its aggregate error rate. On the **next** tick, every upstream wire multiplies its forwarded RPS by that value. errorRate 0.3 → upstreams send 70%. The one-tick delay is deliberate: real callers can't know about downstream saturation faster than a round trip.\n\nTwo guards matter:\n\n- **No-traffic guard.** A tick with zero RPS produces no new signal — the previous acceptanceRate holds. Without this, a dead component would read as errorRate 0 and \"heal\" by being quiet. Missing data is not health.\n- **HALF_OPEN bypass.** Circuit-breaker probe traffic flows at nominal rate so the probe is a clean sample.\n\n## Composition with retries\n\nUpstream retries amplify by `(1 + e + … + e^k)`; backpressure scales by `(1 − e)`. At steady state the two roughly cancel — which is why retries **plus** backpressure is a stable pattern while retries alone is not (§41).\n\nA callout fires when applied backpressure drops to 0.7 or below — the downstream is rejecting 30%+ of offered load.\n\nSee it propagate hop by hop in [See backpressure propagate upstream](#docs/howto/backpressurePropagation), and [Resilience patterns](#docs/learn/resilience-patterns) for when to enable it.",
    category: 'concept',
    relatedTopics: [
      'config.backpressure.enabled',
      'concept.retryStorm',
      'concept.circuitBreakerStates',
      'concept.utilization',
    ],
  },

  'concept.cacheStampede': {
    title: 'Cache stampede',
    shortDescription:
      'A hot key expires and every concurrent reader misses at once, flooding the origin. Modeled as mass TTL expiry, not per-key.',
    body:
      "The classic cache failure (§10): a hot key's TTL expires, thousands of concurrent readers all miss simultaneously, and all of them race to the origin at once. The origin collapses under load it normally never sees; the cache stays cold while the origin is too busy to refill it.\n\n## How the simulator models it\n\nThe cache has no per-key state, so the stampede is modeled at the aggregate level. A cache is **stampede-prone** when three conditions hold: RPS > 1000, `ttlSeconds` < 60, and hit rate > 0.7 — hot, short-lived, heavily-relied-upon. For a prone cache, every `ttlSeconds` boundary triggers mass expiry: hit rate is cut to 30% of normal for ~2 seconds, the miss flood forwards to the database, and a critical log fires. A separate one-shot miss-storm callout fires whenever hit rate falls from a peak of ≥80% to ≤50%.\n\nThis is mass-expiry-as-a-clock, not a simulation of one hot key — the rhythm (periodic DB floods at TTL intervals) is what matches reality.\n\n## Fixes\n\nIn the simulator: lengthen the TTL, or size the downstream DB to survive the periodic flood. In real systems the better tools are request coalescing (single-flight), jittered TTLs, and stale-while-revalidate — none of which are modeled, so a passing sim with a short TTL still deserves those in the real design.\n\nReproduce it: [Reproduce a cache stampede](#docs/howto/cacheStampede). Full failure-mode taxonomy (penetration, avalanche, stampede): §10.",
    category: 'concept',
    relatedTopics: [
      'component.cache',
      'config.ttlSeconds',
      'component.database',
      'concept.utilization',
    ],
  },

  'concept.circuitBreakerStates': {
    title: 'Circuit breaker states',
    shortDescription:
      'Per-wire breaker: CLOSED passes traffic, OPEN drops it all after repeated failures, HALF_OPEN sends probes before re-closing.',
    body:
      "A circuit breaker fails fast instead of piling load onto a failing dependency (§21, §40). In the simulator it's opt-in **per wire** and runs a three-state machine:\n\n- **CLOSED** — normal forwarding. A tick counts as failed when the target's aggregate errorRate exceeds `failureThreshold` (default 0.5). After `failureWindow` consecutive failed ticks (default 3) → OPEN.\n- **OPEN** — the wire drops everything at the source. No latency, no downstream cost; the failing target gets room to recover. After `cooldownSeconds` (default 10) → HALF_OPEN.\n- **HALF_OPEN** — traffic flows as probes. Retry amplification is suppressed and backpressure bypassed so the probe is a clean sample, and the stale pre-open error signal is zeroed. After `halfOpenTicks` consecutive healthy ticks **that actually carried traffic** (default 2) → CLOSED; any failed probe → straight back to OPEN.\n\nTwo engine details worth knowing: no-traffic ticks never count toward re-closing — a breaker can't heal in silence; and the Load Balancer drops OPEN-breakered backends from its rotation entirely, redistributing their share to survivors.\n\n## Where to put one\n\nOn wires to dependencies that fail independently of your load: external services, a database behind a cache, anything whose outage you want contained rather than amplified. Breaker transitions appear in the live log (`closed → open` is critical severity).\n\nTrip one on purpose: [Trip a circuit breaker](#docs/howto/breakerTrip). Configure via [Configuring a wire](#docs/learn/configuring-a-wire).",
    category: 'concept',
    relatedTopics: [
      'config.circuitBreaker.enabled',
      'config.circuitBreaker.failureThreshold',
      'config.circuitBreaker.cooldownSeconds',
      'concept.retryStorm',
      'concept.backpressure',
    ],
  },

  'concept.hotShard': {
    title: 'Hot shard',
    shortDescription:
      'One shard absorbs most of the traffic because the shard key skews. Modeled as 78% of load landing on a single shard.',
    body:
      "Sharding splits a database's data and write load across `shardCount` partitions — capacity per shard = write throughput ÷ shardCount. That only works if traffic splits evenly, and traffic only splits evenly if the shard key has high cardinality and even distribution (§12). Key by `user_id` on a platform with celebrities and one shard takes the beating while the rest idle.\n\n## How the simulator models it\n\nThe engine resolves the effective shard key per database: schema partition key (with its declared cardinality) first, then the DB node's own `shardKey` config, then nothing. If the resolved cardinality is low or medium — or the key name contains \"user\" — the load goes Pareto: **78% onto one shard**, 22% spread across the rest. High cardinality → even split, no drama.\n\nWhen the hot shard's load exceeds 80% of its per-shard capacity, memory pressure climbs and writes queue; past 85% the log shows shard-level critical warnings. Note the asymmetry: the database's aggregate RPS can look comfortably under capacity while one shard is dying — averages lie, here at the storage layer.\n\n## Fixes\n\n- **Better key.** Composite (`user_id, post_id`) or content-based keys restore cardinality.\n- **Special-case the heavy hitters** — the Twitter hybrid: fan-out-on-read for celebrities only (§25).\n- **Cache the hot shard's reads** so only writes hit it.\n\nReproduce it: [Reproduce a hot shard](#docs/howto/hotShard). Shard-key selection criteria: §12.",
    category: 'concept',
    relatedTopics: [
      'config.shardKey',
      'config.shardCount',
      'config.shardingEnabled',
      'component.database',
      'concept.cacheStampede',
    ],
  },

  'concept.littlesLaw': {
    title: "Little's Law",
    shortDescription:
      'L = λ × W: requests in flight equal arrival rate times time in system. Sizes pools and turns latency problems into capacity problems.',
    body:
      "`L = λ × W` — the average number of requests in the system equals arrival rate times average time in system. No assumptions about distributions; it just holds (§7).\n\nPractical use: at 500 RPS with 200 ms latency, you have 100 requests in flight on average. That number is what sizes thread pools, connection pools, and concurrency limits.\n\n## Where the engine applies it\n\nThe server's second drop path is Little's Law directly: in-flight = arrival rate × (total latency ÷ 1000). When that exceeds `maxConcurrent × instanceCount`, the excess is dropped — even if raw throughput capacity looks fine. The database's connection pool failure mode is the same law wearing different clothes: connections held = query rate × query latency, and when latency spikes, the pool exhausts at an RPS that was previously comfortable.\n\n## The coupling that bites\n\nλ and W are not independent in a loaded system. As utilization climbs, queueing inflates W (see Utilization); at fixed λ, inflated W inflates L; inflated L exhausts a concurrency limit somewhere; and a latency problem becomes an availability problem. This is why \"the DB got slow\" and \"the connection pool ran out\" arrive together — the second is the first, propagated through L = λ × W.\n\nWhen reading a run: any time you see errors appear while CPU still has headroom, check whether a concurrency or pool limit was hit, and do the L = λ × W arithmetic against the latency the sim is reporting.",
    category: 'concept',
    relatedTopics: [
      'concept.utilization',
      'config.maxConcurrent',
      'config.connectionPoolSize',
      'component.server',
      'concept.p50p95p99',
    ],
  },

  'concept.retryStorm': {
    title: 'Retry storm amplification',
    shortDescription:
      'Retries against a failing downstream multiply its load geometrically — the sicker it is, the harder it gets hit.',
    body:
      "Retries are load amplification pointed at the component least able to absorb it. The simulator models this at the RPS level rather than per request (§41): given an upstream retry policy with `maxRetries = k` and a downstream whose previous-tick error rate was `e`, effective forwarded load is\n\n`rps × (1 + e + e² + … + e^k)`\n\nThe geometric sum converges to `1/(1−e)`: e = 0.2 → 1.25×, e = 0.5 → 2×, e = 0.8 → 5×. The worse the downstream, the bigger the multiplier — retries accelerate collapse exactly when they can't help.\n\n## Engine details\n\n- The signal is the **previous tick's** aggregate downstream errorRate — upstream can't react instantly, so there's a one-tick lag, matching real propagation.\n- All retry waves bundle into the current tick's RPS. That loses the time-dispersion of real backoff but keeps the steady-state amplification, which is what determines whether the downstream survives.\n- `backoffMs` / `backoffMultiplier` are display-only: one-second ticks have no sub-second granularity to model backoff in. Real backoff still matters in production; the simulator just can't see it.\n- Retries are suppressed while a wire's breaker is HALF_OPEN, so recovery probes aren't a replayed storm.\n- A callout fires when amplification crosses 1.5× on any wire.\n\n## Containment\n\nCap `maxRetries` low, add a circuit breaker on the same wire (the breaker opening zeroes the storm), and enable downstream backpressure — the `(1−e)` scaling roughly cancels the retry sum at steady state. Reproduce it: [Reproduce a retry storm](#docs/howto/retryStorm).",
    category: 'concept',
    relatedTopics: [
      'config.retry.maxRetries',
      'config.retry.backoffMs',
      'concept.circuitBreakerStates',
      'concept.backpressure',
    ],
  },

  'concept.utilization': {
    title: 'Utilization (ρ)',
    shortDescription:
      'ρ = arrival rate over total service capacity. Wait time scales with ρ/(1−ρ): fine at 70%, painful at 85%, vertical at 95%.',
    body:
      "ρ = λ / (c × μ): arrival rate over instances × per-instance service rate. It's the single number that predicts whether a component is about to fall over, and it does so non-linearly (§7).\n\n## Why the curve is the lesson\n\nQueueing wait grows with `ρ/(1−ρ)`. Concretely, with a 50 ms service time and the default variance: at ρ = 0.5 you wait one extra service time (~50 ms); at ρ = 0.8, four (~200 ms); at ρ = 0.9, nine; at ρ = 0.95, nineteen — the engine's clamp, ~950 ms of wait. The last 10% of \"efficiency\" costs 10× the latency. This is why running hot is not thrift, it's a latency time bomb.\n\n## How the engine uses it\n\n- Servers compute ρ each tick (Kingman G/G/1; see the Server component). CPU% **is** ρ × 100.\n- ρ is clamped at 0.95 for the latency formula; above ρ = 1 the overflow drops: `dropRate = 1 − 1/ρ`.\n- Bursty traffic phases raise the variance factor, so the same ρ produces worse latency under spikes than under steady load.\n- Health bands: warning above 70%, critical above 95%, crash risk above 98%. A one-shot saturation callout fires at ρ ≥ 0.85.\n- The database's load curve (`1 + util⁴ × 50`) is the same idea with a different exponent.\n\n## Reading a run\n\nHeadroom is the product. Plan for ρ ≈ 0.6–0.7 at peak: it's the zone where a 30–50% surprise (spike, failed peer's redistributed load, retry amplification) doesn't push you over the knee. Pairs with Little's Law: rising ρ inflates latency, which inflates in-flight requests, which exhausts concurrency limits.",
    category: 'concept',
    relatedTopics: [
      'concept.littlesLaw',
      'component.server',
      'config.instanceCount',
      'config.processingTimeMs',
      'concept.p50p95p99',
    ],
  },
  'concept.p50p95p99': {
    title: 'p50 / p95 / p99 percentiles',
    shortDescription:
      'Latency percentiles: p50 is the median, p99 the worst 1%. Averages hide tail pain — percentiles expose it.',
    body:
      "A latency percentile answers \"what's the worst latency the fastest N% of requests see?\" p50 is the median — half of requests are faster. p95 leaves out the worst 5%; p99 the worst 1%. Distributed systems are judged on tails, not averages: a user issuing 100 requests per page load hits the p99 on most page loads (see §24 on fan-out tail compounding and §7 for the full percentile primer).\n\n## How the simulator computes them\n\nEach component's queueing result produces a total latency (service time plus capped queueing wait); percentiles are derived as fixed multipliers of it — p50 at 0.7×, p95 at 2×, p99 at 4× (§45). These are modeled priors that produce the right *shape* (tails grow much faster than the median as utilization climbs), not measurements. Closed-form models under-predict extreme tails — real p99.9s are driven by GC pauses, page faults, and noisy neighbors no formula sees (Dean & Barroso). Treat the simulator's p99 as directional.\n\n## Reading them in a run\n\nWatch the gap, not the absolute numbers: a p99 pulling away from p50 means queueing — utilization is approaching the knee. The per-component debrief table sorts by p99 for exactly this reason.",
    category: 'concept',
    relatedTopics: [
      'concept.utilization',
      'concept.littlesLaw',
      'config.processingTimeMs',
      'config.latencyMs',
    ],
  },
};
