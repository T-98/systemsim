/**
 * @file wiki/content/topics/configsDataTraffic.ts
 *
 * Hand-written wiki content for data-side configs (database, cache, queue),
 * resilience configs (circuit breaker, retry, backpressure), traffic-profile
 * fields, and the live-log severity legend. Every engine claim below was
 * verified against SimulationEngine.ts / CircuitBreaker.ts / RetryPolicy.ts /
 * Backpressure.ts / WorkingSetCache.ts at time of writing. Where a config is
 * NOT consumed by the tick engine (consistencyModel, writeStrategy, queue
 * retryCount, backpressure.thresholdQueue, traffic jitterPercent /
 * userDistribution), the body says so explicitly — honesty about the model
 * beats implying simulation depth that isn't there.
 *
 * Merged into the registry by the Phase A-content back-fill; keys and titles
 * must match the empty() declarations in src/wiki/topics.ts exactly.
 */

import type { Topic } from '../../topics';

export const CONFIG_DATA_TRAFFIC_TOPICS: Record<string, Topic> = {
  // ── Database ─────────────────────────────────────────────────────────────

  'config.readThroughputRps': {
    title: 'Read throughput (RPS)',
    shortDescription:
      'Reads per second one DB node serves. Effective read capacity = readThroughputRps × (1 + readReplicas). Default 50,000.',
    body: `# Read throughput (RPS)

How many reads per second a single database node can serve before the read side saturates.

The engine computes per-tick read capacity as \`readThroughputRps × (1 + readReplicas)\` — replicas multiply reads, never writes. Inbound read RPS is attributed from endpoint routes + schema when available, else a 70/30 read/write fallback split. When read utilization exceeds 100%, \`readErrorRate = min(0.9, (util − 1) × 0.5)\`, and the DB's aggregate \`errorRate\` is the **max** of read, write, and connection-pool error rates — breakers, retries, and backpressure all react to that aggregate. A one-shot "read side saturated" callout fires when attribution is trustworthy and the rate passes 5%.

Guidance (§11–12): ~50k simple indexed reads is a realistic single-node Postgres-class ceiling; size for your peak phase with 30–40% headroom, or front the DB with a cache (§10).

Undersized reads saturate, errors climb, and upstream retries amplify the load into collapse.`,
    category: 'config',
    relatedTopics: [
      'config.readReplicas',
      'config.writeThroughputRps',
      'component.database',
      'reference.12-database-scaling-partitioning-replication-consistent-hashing-cdc',
      'concept.retryStorm',
    ],
  },

  'config.writeThroughputRps': {
    title: 'Write throughput (RPS)',
    shortDescription:
      'Writes per second one DB node absorbs. Replicas do not help writes — only sharding splits write load. Default 20,000.',
    body: `# Write throughput (RPS)

How many writes per second the database absorbs before the write side saturates.

Unlike reads, write capacity is **not** multiplied by replicas — the engine uses \`writeThroughputRps\` flat per tick. Above 100% utilization, \`writeErrorRate = min(0.9, (util − 1) × 0.5)\`, folded into the aggregate \`errorRate = max(read, write, pool)\` that breakers, retry amplification, and backpressure consume. With sharding enabled, per-shard write capacity is \`writeThroughputRps / shardCount\`; the hot-shard model compares the hot shard's load against 80% of that to drive memory pressure. A one-shot "write side saturated" callout fires past 5% error when attribution is available.

Guidance (§12): ~20k writes/s is a generous single-node ceiling; scale writes with sharding, batching, or a write-optimized store — not replicas.

Classic failure: a fan-out emits millions of writes per event straight into the DB and the write side saturates within a tick or two.`,
    category: 'config',
    relatedTopics: [
      'config.shardingEnabled',
      'config.shardCount',
      'config.readThroughputRps',
      'reference.12-database-scaling-partitioning-replication-consistent-hashing-cdc',
      'howto.hotShard',
    ],
  },

  'config.readReplicas': {
    title: 'Read replicas',
    shortDescription:
      'Copies of the DB serving reads. Read capacity scales as readThroughputRps × (1 + N); writes are unaffected. Default 0.',
    body: `# Read replicas

Number of read-only copies of the database. Reads spread across primary + replicas; writes still funnel to one primary.

The engine scales read capacity linearly: \`readThroughputRps × (1 + readReplicas)\` per tick. Replicas also raise total throughput used to drain the connection backlog, so they relieve pool pressure too. They do nothing for the write side — write saturation is unchanged at any replica count.

The trade is staleness: replicas lag the primary by \`replicationLagMs\`, which the engine adds to the DB's p99. The post-run debrief flags the contradiction of claiming \`consistencyModel: strong\` while running replicas with non-zero lag.

Guidance (§12): 2–3 replicas covers most read-heavy designs; past that, a cache (§10) is usually cheaper than another replica.

Failure mode: piling on replicas to fix a write-bound DB does nothing — the write side stays saturated and keeps erroring.`,
    category: 'config',
    relatedTopics: [
      'config.readThroughputRps',
      'config.replicationLagMs',
      'config.consistencyModel',
      'reference.12-database-scaling-partitioning-replication-consistent-hashing-cdc',
    ],
  },

  'config.replicationLagMs': {
    title: 'Replication lag (ms)',
    shortDescription:
      'How far replicas trail the primary. Added to the DB p99 (tail reads hit a lagging replica). Default 10 ms.',
    body: `# Replication lag (ms)

How far read replicas trail the primary, in milliseconds.

The engine adds it to the database's **p99 only** — \`p99 = dbLatency × 4 + replicationLagMs + upstream latency\` — modeling the tail read that lands on a lagging replica. p50 and p95 are unaffected; most reads hit a fresh node. The lag has no effect on capacity math.

It also feeds a consistency-coherence check: the post-run debrief flags any DB configured with \`consistencyModel: strong\`, replicas > 0, and lag > 0 — you can't have all three.

Guidance (§12): same-region async replication runs single-digit to tens of ms; cross-region is 50–200ms+. The default 10ms models a healthy same-region pair.

Failure mode in real systems (beyond this model): read-your-own-writes breaks — a user posts, refreshes, and their post is missing because the read hit a stale replica.`,
    category: 'config',
    relatedTopics: [
      'config.readReplicas',
      'config.consistencyModel',
      'concept.p50p95p99',
      'reference.12-database-scaling-partitioning-replication-consistent-hashing-cdc',
    ],
  },

  'config.shardingEnabled': {
    title: 'Sharding enabled',
    shortDescription:
      'Splits the DB into shardCount partitions by shard key. With it off, the DB is one undivided write domain.',
    body: `# Sharding enabled

Whether the database is horizontally partitioned into \`shardCount\` shards keyed by the shard key.

The engine's shard model only activates when this is true **and** \`shardCount > 1\`. Each tick it distributes inbound load across shards: evenly when the shard key has high cardinality, or by a Pareto distribution (one shard takes 78%) when the resolved key is low/medium cardinality or contains "user" — the hot-shard failure mode. The per-shard load drives the \`shardDistribution\` metric and hot-shard memory pressure against per-shard write capacity (\`writeThroughputRps / shardCount\`).

With sharding off, none of that runs; the DB is a single write domain and write capacity is whatever one node provides.

Guidance (§12): shard when a single node can't hold the write rate or data volume — not before. Sharding with a skewed key is worse than not sharding: you pay the operational cost and still bottleneck on one hot partition.`,
    category: 'config',
    relatedTopics: [
      'config.shardCount',
      'config.shardKey',
      'concept.hotShard',
      'howto.hotShard',
      'reference.12-database-scaling-partitioning-replication-consistent-hashing-cdc',
    ],
  },

  'config.shardCount': {
    title: 'Shard count',
    shortDescription:
      'Number of partitions. Per-shard write capacity = writeThroughputRps / shardCount; a hot shard saturates its slice first.',
    body: `# Shard count

How many partitions the database is split into (active only with sharding enabled).

The engine divides write capacity across shards: each shard handles \`writeThroughputRps / shardCount\`. With a healthy high-cardinality key, load splits evenly and every shard sees \`rps / shardCount\`. With a skewed key, the Pareto branch puts 78% of load on one shard while the remaining shards split 22% — so the hot shard saturates at roughly \`0.8 × writeThroughputRps / shardCount\`, long before aggregate capacity is exhausted. The per-shard loads surface as the \`shardDistribution\` metric, and the debrief asks a hot-shard question when one shard carries over half the load.

Guidance (§12): more shards = more parallel write capacity but smaller per-shard headroom against skew. Pick shard count from data volume and write rate; pick the **key** to keep the distribution flat.

Raising shardCount does not fix a hot shard — it shrinks every shard's slice, including the hot one's.`,
    category: 'config',
    relatedTopics: [
      'config.shardingEnabled',
      'config.shardKey',
      'concept.hotShard',
      'reference.12-database-scaling-partitioning-replication-consistent-hashing-cdc',
    ],
  },

  'config.shardKey': {
    title: 'Shard key',
    shortDescription:
      'Field that routes rows to shards. Low cardinality or user-id keys trigger the Pareto hot-shard model: 78% of load on one shard.',
    body: `# Shard key

The field whose value decides which shard a row lands on. The single most important sharding decision.

The engine resolves the effective key per DB through a fallback ladder: schema memory's partition key (with its field cardinality) → this config field → legacy profile-level key → none. The hot-shard branch fires when the resolved cardinality is **low or medium**, or the key name contains "user" (the classic user-id-on-a-social-graph mistake): one shard takes 78% of load (Pareto), the rest split 22%. When the hot shard's load passes 80% of its write slice (\`writeThroughputRps / shardCount\`), memory pressure climbs and "writes queuing" warnings begin. High-cardinality keys distribute evenly.

Guidance (§12): pick a key with high cardinality **and** flat access — random IDs, composite keys, or hashed keys. user_id fails when a few users (large Discord servers, celebrities) dominate traffic.

A skewed key means one shard melts while its siblings idle.`,
    category: 'config',
    relatedTopics: [
      'concept.hotShard',
      'howto.hotShard',
      'config.shardCount',
      'config.shardingEnabled',
      'reference.12-database-scaling-partitioning-replication-consistent-hashing-cdc',
    ],
  },

  'config.consistencyModel': {
    title: 'Consistency model',
    shortDescription:
      'Strong, eventual, or causal. A design declaration — the tick engine does not simulate it; the debrief checks it for coherence.',
    body: `# Consistency model

What read guarantee the database claims: \`strong\` (every read sees the latest write), \`eventual\` (replicas converge over time), or \`causal\`.

Honest model note: the tick engine does **not** consume this field — latency, capacity, and error math run identically regardless. It is a design declaration the post-run debrief audits for coherence: a DB claiming \`strong\` while configured with read replicas and non-zero \`replicationLagMs\` gets flagged as a contradiction (strong consistency over lagging async replicas isn't a thing), and it costs coherence points in the score.

Guidance (§3, §12): pick per use case, not globally. Payments, inventory, and auth need strong; feeds, timelines, and counters tolerate eventual and gain latency + availability for it. Strong consistency across replicas implies synchronous replication, which shows up as write latency.

Declaring strong while building eventual is the most common design-review failure — the simulator's debrief exists to catch exactly that.`,
    category: 'config',
    relatedTopics: [
      'config.readReplicas',
      'config.replicationLagMs',
      'component.database',
      'reference.3-non-functional-requirements',
      'reference.12-database-scaling-partitioning-replication-consistent-hashing-cdc',
    ],
  },

  // ── Cache ────────────────────────────────────────────────────────────────

  'config.evictionPolicy': {
    title: 'Eviction policy',
    shortDescription:
      'LRU, LFU, or TTL-only. In the model, LRU takes a ×0.85 hit-rate penalty when key space exceeds 2× cache capacity.',
    body: `# Eviction policy

What the cache throws away when full: \`lru\` (least recently used), \`lfu\` (least frequently used), or \`ttl-only\` (nothing evicts early; entries just expire).

The engine's working-set model uses this in exactly one place: when the key space (fixed at 100k keys in the model) exceeds **2× the cache's entry capacity**, an LRU cache takes a ×0.85 hit-rate penalty — modeling scan-style churn evicting hot keys. \`lfu\` and \`ttl-only\` skip the penalty and are otherwise identical in the model; the dominant hit-rate driver is memory-vs-working-set coverage, not policy.

Guidance (§10): LRU is the right default for recency-skewed traffic; LFU resists one-off scans polluting the cache; TTL-only fits immutable-ish data where staleness, not capacity, is the constraint.

Failure mode: an undersized LRU cache under a wide key space churns — hit rate sags 15% below what coverage alone predicts, and that delta lands on the database.`,
    category: 'config',
    relatedTopics: [
      'config.maxMemoryMb',
      'config.ttlSeconds',
      'component.cache',
      'reference.10-caching-full-curriculum',
    ],
  },

  'config.ttlSeconds': {
    title: 'TTL (seconds)',
    shortDescription:
      'Entry lifetime. Sets the working-set window (rps × ttl) and the stampede cadence — short TTL + high RPS = mass-expiry DB floods.',
    body: `# TTL (seconds)

How long a cached entry lives before expiring. Default 300s.

The TTL shapes the engine's Zipfian working-set model twice. First, working set = \`min(keyCardinality, rps × ttlSeconds)\` — longer TTLs keep more unique keys live, which can **lower** hit rate if memory can't cover the bigger set. Second, expiry cadence: when stampede risk is detected (rps > 1000, ttl < 60, hit rate > 0.7), the first ~2 seconds of every TTL window slash hit rate to 30% and log "Cache stampede" — the modeled mass-expiry flood hitting the DB. Cold start also ramps: hit rate climbs linearly over the first \`ttl × 0.5\` seconds. TTLs over 3600s switch to CDN-tier latency (20ms p50), and the debrief flags them for staleness risk.

Guidance (§10): jittered, minutes-scale TTLs for hot read paths; avoid sub-minute TTLs at high RPS unless you add request coalescing.

Short TTL + heavy traffic = synchronized expiry, periodic DB hammering.`,
    category: 'config',
    relatedTopics: [
      'concept.cacheStampede',
      'howto.cacheStampede',
      'config.maxMemoryMb',
      'config.evictionPolicy',
      'reference.10-caching-full-curriculum',
    ],
  },

  'config.maxMemoryMb': {
    title: 'Max memory (MB)',
    shortDescription:
      'Cache size. Hit rate = min(1, (capacity ÷ working set)^(1/1.2)) — Zipfian coverage. Misses flow downstream to the DB.',
    body: `# Max memory (MB)

The cache's memory budget — the main lever on hit rate. Default 1024 MB.

The engine converts MB to entry capacity at a fixed 512 bytes per value, then computes hit rate from Zipfian coverage: \`min(1, (capacityEntries / workingSetSize)^(1/1.2))\`. Because real traffic is Zipf-skewed (skew 1.2), covering even a fraction of the working set captures most hits — half coverage yields roughly a 56% hit rate, not 50%. \`memoryPercent\` reflects entries actually resident; caches over 4096 MB get distributed-tier latency (1ms p50 vs 0.5ms). Whatever misses — \`rps × (1 − hitRate)\` — is forwarded to downstream components, usually the database.

Guidance (§10): size against the working set (\`rps × ttl\` capped by key cardinality), not total data. A "miss-storm" callout fires if hit rate collapses from a previous peak ≥80% to ≤50%.

Undersize it and the uncovered tail of the working set becomes permanent DB load.`,
    category: 'config',
    relatedTopics: [
      'config.ttlSeconds',
      'config.evictionPolicy',
      'component.cache',
      'concept.cacheStampede',
      'reference.10-caching-full-curriculum',
    ],
  },

  'config.writeStrategy': {
    title: 'Write strategy',
    shortDescription:
      'Write-through, write-back, or write-around. Design intent only — the tick engine does not simulate write-path caching.',
    body: `# Write strategy

How writes interact with the cache: \`write-through\` (write cache + DB synchronously), \`write-back\` (write cache now, flush to DB later), or \`write-around\` (write DB only; cache fills on read).

Honest model note: the tick engine does **not** consume this field. The simulated cache is a read-path working-set model — writes aren't routed through it, so the strategy changes no metric. It documents design intent and is the vocabulary the debrief and reviews use.

Guidance (§10): write-through buys consistency at the cost of write latency (two writes per write). Write-back gives the fastest writes and absorbs bursts, but a cache crash loses unflushed data — the classic durability trap. Write-around avoids polluting the cache with write-once data but guarantees a miss on first read.

In real systems the failure mode is picking write-back for data you can't afford to lose; the simulator can't show you that one — yet.`,
    category: 'config',
    relatedTopics: [
      'component.cache',
      'config.ttlSeconds',
      'config.maxMemoryMb',
      'reference.10-caching-full-curriculum',
    ],
  },

  'config.cacheHitRate': {
    title: 'CDN cache hit rate',
    shortDescription:
      'Fraction of requests the CDN serves from edge (default 0.9). Misses pull from origin at originPullLatencyMs and flow downstream.',
    body: `# CDN cache hit rate

The fraction of requests the CDN answers from edge cache, configured directly as a ratio (default 0.9).

Unlike the cache component — whose hit rate is **computed** from the Zipfian working-set model — the CDN uses this static configured ratio. Each tick: latency blends \`hitRate × 5ms + (1 − hitRate) × originPullLatencyMs\` for p50, with p99 pinned at the full origin-pull latency (the tail is always a miss). Miss traffic, \`rps × (1 − hitRate)\`, is forwarded to whatever sits behind the CDN. Stressed mode forces the hit rate to 0 — a cold CDN, every request hitting origin — which is the worst case the "Run stressed" button exists to show.

Guidance (§10): 0.85–0.95 is realistic for static assets with sane cache headers; far lower for personalized or rapidly-changing content.

At 0.9, a 10× traffic spike still multiplies origin load 10× — the CDN scales the slope, not the spike.`,
    category: 'config',
    relatedTopics: [
      'component.cdn',
      'config.originPullLatencyMs',
      'component.cache',
      'reference.10-caching-full-curriculum',
    ],
  },

  // ── Queue ────────────────────────────────────────────────────────────────

  'config.consumerGroupCount': {
    title: 'Consumer groups',
    shortDescription:
      'Independent consumer sets draining the queue. Total drain = groups × consumersPerGroup ÷ processingTimeMs × 1000 msg/s.',
    body: `# Consumer groups

How many independent consumer sets drain the queue (Kafka-style groups, each receiving the full stream in real systems).

In the engine the math is a flat multiplier: total consumers = \`consumerGroupCount × consumersPerGroup\`, and drain rate = \`totalConsumers / processingTimeMs × 1000\` messages/s. Each tick the queue adds inbound RPS to its depth, drains up to that rate, and forwards consumed messages downstream. Queue wait p50 = \`depth / drainRate\` seconds; p99 is 3× that. The model does not simulate per-group offsets or rebalancing — groups are pure parallelism.

Guidance (§13): one group per distinct downstream concern; scale **consumers per group** for throughput within a concern. Defaults (1 group × 5 consumers × 10ms) drain 500 msg/s.

If arrival rate exceeds drain rate, depth grows every tick — a "consumers not keeping up" callout fires at 70% of max depth, then overflow.`,
    category: 'config',
    relatedTopics: [
      'config.consumersPerGroup',
      'config.maxDepth',
      'component.queue',
      'reference.13-message-queues-async-communication',
    ],
  },

  'config.consumersPerGroup': {
    title: 'Consumers per group',
    shortDescription:
      'Parallel workers per group. The primary throughput lever: drain rate scales linearly with consumer count. Default 5.',
    body: `# Consumers per group

Parallel workers in each consumer group — the primary lever on queue drain rate.

The engine computes drain capacity as \`(consumerGroupCount × consumersPerGroup) / processingTimeMs × 1000\` messages per second, so throughput scales linearly with this number. Default 5 consumers at 10ms processing = 500 msg/s per group. Whatever the consumers can't drain accumulates as queue depth, which directly sets latency: p50 wait = \`depth / drainRate\` seconds. The engine logs a one-shot "consumers not keeping up" warning when depth crosses 70% of \`maxDepth\`.

Guidance (§13): size consumers from Little's Law — needed consumers ≈ arrival rate × processing time. A 10,000 msg/s burst with 10ms processing wants ~100 consumers to hold steady-state; fewer is fine only if the burst is short and \`maxDepth\` can buffer the difference.

Under-provisioned consumers turn a queue from a shock absorber into a latency bomb: depth, and therefore wait time, grows without bound until overflow.`,
    category: 'config',
    relatedTopics: [
      'config.consumerGroupCount',
      'config.maxDepth',
      'concept.littlesLaw',
      'reference.13-message-queues-async-communication',
    ],
  },

  'config.deliveryMode': {
    title: 'Delivery mode',
    shortDescription:
      'Fan-out delivery: parallel (flat 10 ms) or sequential (multiplier × 0.001 ms — latency grows with recipient count).',
    body: `# Delivery mode

How the fan-out component delivers to its downstream recipients: \`parallel\` or sequential.

The engine uses it for latency only — output volume is \`rps × multiplier\` either way. Parallel delivery costs a flat 10ms regardless of recipient count; sequential costs \`multiplier × 0.001\` ms, i.e. latency grows linearly with the fan-out size — 500k recipients = 500ms p50, with p99 at 5× that. The amplified RPS then hits every downstream wire at full force, which is why fan-out feeding a database directly is the canonical write-burst failure (§24).

Guidance: parallel matches real notification systems (concurrent pushes to a worker fleet); sequential models naive for-loop delivery and is mostly useful to demonstrate why nobody ships that.

Either way, delivery mode changes how *slow* the fan-out is, not how *much* it emits — the downstream flood is the multiplier's doing, and only a queue between fan-out and storage absorbs it.`,
    category: 'config',
    relatedTopics: [
      'component.fanout',
      'config.multiplier',
      'component.queue',
      'reference.24-fan-out-fan-in-parallel-processing-in-distributed-systems',
    ],
  },

  'config.dlqEnabled': {
    title: 'DLQ enabled',
    shortDescription:
      'Dead-letter queue for overflow. With it, overflowed messages are captured (still errors); without, they are silently dropped.',
    body: `# DLQ enabled

Whether the queue has a dead-letter queue to capture messages it can't keep.

In the engine this changes what happens at overflow. When depth exceeds \`maxDepth\`, the excess is removed either way — but with DLQ enabled the loss is recorded in the component's error accounting and the critical log reads "moved to DLQ" instead of "DROPPED". The overflow still counts against \`errorRate\` for that tick (a dead-lettered message did not reach its consumer), and the model does not simulate replaying the DLQ later. The post-run debrief flags every queue without a DLQ and deducts coherence points.

Guidance (§13): always enable it in real designs — a DLQ converts silent data loss into an inspectable, replayable backlog, and it's where poison messages go instead of crash-looping consumers.

Without a DLQ, overflow is permanent: the messages are gone and nothing downstream will ever know they existed.`,
    category: 'config',
    relatedTopics: [
      'config.maxDepth',
      'config.retryCount',
      'component.queue',
      'reference.13-message-queues-async-communication',
    ],
  },

  'config.maxDepth': {
    title: 'Max queue depth',
    shortDescription:
      'Buffer size before overflow. Depth drives wait latency (depth ÷ drain rate) and health; past maxDepth messages drop or dead-letter.',
    body: `# Max queue depth

How many messages the queue can hold before overflowing. Default 10,000,000.

Each tick the engine adds inbound RPS to the depth, drains up to consumer throughput, and checks the bound. Depth drives everything: wait latency p50 = \`depth / drainRate\` seconds (p99 = 3×), and \`memoryPercent = depth / maxDepth\` feeds component health — warning past 70%, critical past 95%, with crash risk near 98%. A one-shot "consumers not keeping up" callout fires at 70%; a warning logs past 80%; overflow logs critical and the excess is dropped (or dead-lettered if \`dlqEnabled\`), surfacing as \`errorRate\`.

Guidance (§13): size the buffer for your worst burst — roughly \`(arrivalRate − drainRate) × burstSeconds\`. A big depth buys time, not capacity; if consumers never catch up, you've only delayed the overflow and added latency in the meantime.

A nearly-full queue is itself a failure: messages sitting at 80% depth can wait minutes before processing.`,
    category: 'config',
    relatedTopics: [
      'config.consumersPerGroup',
      'config.dlqEnabled',
      'concept.littlesLaw',
      'concept.backpressure',
      'reference.13-message-queues-async-communication',
    ],
  },

  'config.retryCount': {
    title: 'Retry count',
    shortDescription:
      'Consumer redelivery attempts before dead-lettering. Design intent only — the tick engine does not simulate redelivery.',
    body: `# Retry count

How many times a consumer should retry a failed message before giving up (and, with a DLQ, dead-lettering it). Default 3.

Honest model note: the tick engine does **not** consume this field — consumer-side failures and redelivery aren't simulated, so the value changes no metric. It is a design declaration the post-run debrief audits: a queue with no retry count (or 0) gets flagged as "no retry logic configured" and costs coherence points. Don't confuse it with the wire-level \`retry.maxRetries\` policy, which **is** simulated and drives retry-storm amplification on request paths.

Guidance (§13): 3–5 attempts with backoff is conventional; pair it with a DLQ so poison messages exit the loop instead of cycling forever. Idempotent consumers are the prerequisite — redelivery means at-least-once, so duplicates will happen.

The real-world failure this guards against: one malformed message redelivered infinitely, pinning a consumer and stalling the partition behind it.`,
    category: 'config',
    relatedTopics: [
      'config.dlqEnabled',
      'config.retry.maxRetries',
      'component.queue',
      'reference.13-message-queues-async-communication',
    ],
  },

  // ── Circuit breaker (per-wire) ───────────────────────────────────────────

  'config.circuitBreaker.enabled': {
    title: 'Circuit breaker enabled',
    shortDescription:
      'Per-wire fail-fast switch. CLOSED → OPEN on sustained downstream errors; OPEN drops all traffic at the source until cooldown.',
    body: `# Circuit breaker enabled

Opt-in, per-wire fail-fast. Only wires with a breaker config get the state machine; everything else forwards unconditionally.

Three states (§40): **CLOSED** forwards normally while counting consecutive failed ticks — a tick fails when the target's aggregate \`errorRate\` exceeds \`failureThreshold\`. After \`failureWindow\` consecutive failures it goes **OPEN**: the source drops all traffic on that wire (zero RPS, no latency cost), and load balancers skip OPEN downstreams when splitting. After \`cooldownSeconds\` it moves to **HALF_OPEN**: probe traffic flows at nominal rate with retry amplification and backpressure deliberately suppressed; \`halfOpenTicks\` consecutive healthy ticks with real traffic close it, any failure re-opens it. Transitions are logged — opening is a critical entry.

Defaults: threshold 0.5, window 3 ticks, cooldown 10s, 2 probe ticks — tuned to trip on sustained failure, not one-tick blips.

Without a breaker, callers keep pouring (often retry-amplified) load into a dying downstream and follow it down (§21).`,
    category: 'config',
    relatedTopics: [
      'concept.circuitBreakerStates',
      'howto.breakerTrip',
      'config.circuitBreaker.failureThreshold',
      'config.retry.maxRetries',
      'reference.40-circuit-breaker-state-machine',
    ],
  },

  'config.circuitBreaker.failureThreshold': {
    title: 'Failure threshold',
    shortDescription:
      'errorRate (0–1) above which a tick counts as failed for the breaker. Default 0.5 — half the downstream requests erroring.',
    body: `# Failure threshold

The downstream error rate above which the breaker counts a tick as failed. Range 0–1, default 0.5.

At the end of every tick, each breaker-equipped wire compares its **target's aggregate** \`errorRate\` against this threshold (strictly greater-than). For a database that aggregate is \`max(readErrorRate, writeErrorRate, poolDropRate)\` — the breaker trips on whichever failure mode hits first. Failed ticks increment a consecutive counter; \`failureWindow\` of them in a row opens the breaker. One healthy tick resets the counter. The same comparison governs HALF_OPEN: a single failed probe tick re-opens immediately.

Tuning: 0.5 means "half of requests are failing" — a genuinely broken downstream, not a degraded one. Lower it (0.1–0.2) to fail fast on partial degradation; raise it to tolerate flaky-but-useful dependencies.

Set too low, the breaker flaps on transient blips and you lose real capacity; set too high, it never trips and provides nothing.`,
    category: 'config',
    relatedTopics: [
      'config.circuitBreaker.failureWindow',
      'config.circuitBreaker.enabled',
      'concept.circuitBreakerStates',
      'reference.40-circuit-breaker-state-machine',
    ],
  },

  'config.circuitBreaker.failureWindow': {
    title: 'Failure window (ticks)',
    shortDescription:
      'Consecutive failed ticks needed to trip CLOSED → OPEN. Default 3. One healthy tick resets the count.',
    body: `# Failure window (ticks)

How many **consecutive** failed ticks (downstream errorRate above \`failureThreshold\`) trip the breaker from CLOSED to OPEN. Default 3.

The counter is strict: any single healthy tick resets it to zero. That makes the window a persistence filter — a downstream must stay broken for the full window before the breaker reacts. With 1-second ticks, the default means three straight seconds above 50% errors before traffic is cut. The same window length is *not* reused in HALF_OPEN; there, one failed probe tick re-opens immediately, and \`halfOpenTicks\` governs recovery instead.

Tuning: shorter windows (1–2) protect aggressively but trip on single-tick spikes — a one-off saturation blip from an instant spike phase can open the breaker unnecessarily. Longer windows (5+) tolerate noise but leave callers hammering a corpse for those extra seconds, usually with retry amplification making it worse each tick.

The window is your tolerance for sustained pain before giving up on the dependency.`,
    category: 'config',
    relatedTopics: [
      'config.circuitBreaker.failureThreshold',
      'config.circuitBreaker.cooldownSeconds',
      'concept.circuitBreakerStates',
      'reference.40-circuit-breaker-state-machine',
    ],
  },

  'config.circuitBreaker.cooldownSeconds': {
    title: 'Cooldown (seconds)',
    shortDescription:
      'How long an OPEN breaker blocks all traffic before probing via HALF_OPEN. Default 10 s of simulation time.',
    body: `# Cooldown (seconds)

How long the breaker stays OPEN — dropping every request on the wire — before attempting recovery. Default 10 seconds of sim time.

While OPEN, the source emits zero RPS on the wire and load balancers route around it; the downstream gets a genuine breather instead of a retry storm. When the cooldown elapses, the breaker transitions to HALF_OPEN and the engine deliberately **clears the wire's stale error observation**, so the first probe isn't retry-amplified by a failure recorded before the cooldown. Probes then flow at nominal rate; success over \`halfOpenTicks\` closes the breaker, failure re-opens it and restarts the cooldown.

Tuning: the cooldown should cover the downstream's realistic recovery time — queue drain, autoscaler reaction, pool recycle. Too short and the breaker flaps open/half-open/open, hitting a still-saturated target with probes every few seconds. Too long and you serve errors from an already-healthy dependency.

10s suits this simulator's tick scale; real services often use 30–60s.`,
    category: 'config',
    relatedTopics: [
      'config.circuitBreaker.halfOpenTicks',
      'config.circuitBreaker.failureWindow',
      'concept.circuitBreakerStates',
      'reference.40-circuit-breaker-state-machine',
    ],
  },

  'config.circuitBreaker.halfOpenTicks': {
    title: 'Half-open probe ticks',
    shortDescription:
      'Consecutive healthy ticks with real traffic needed to close a HALF_OPEN breaker. Default 2. Quiet ticks do not count.',
    body: `# Half-open probe ticks

How many consecutive healthy probe ticks a HALF_OPEN breaker needs before declaring the downstream recovered and closing. Default 2.

Two engine details matter. First, **a probe must actually run**: ticks where no traffic flowed on the wire don't advance the success count — otherwise a quiet traffic phase would silently close the breaker without a single request validating the downstream. Second, probes are clean samples: while HALF_OPEN, the engine suppresses retry amplification (no replaying stale failures) and backpressure scaling (no throttled-to-zero probes), so the downstream is judged on nominal-rate traffic. Any failed tick during HALF_OPEN re-opens immediately and restarts the cooldown.

Tuning: 1 tick closes fastest but trusts a single good second; higher values demand sustained proof at the cost of staying degraded longer. 2–3 is the sane range at this tick scale.

Set it high against a marginal downstream and the breaker can oscillate — almost-recovered, re-opened, repeat.`,
    category: 'config',
    relatedTopics: [
      'config.circuitBreaker.cooldownSeconds',
      'config.circuitBreaker.enabled',
      'concept.circuitBreakerStates',
      'howto.breakerTrip',
      'reference.40-circuit-breaker-state-machine',
    ],
  },

  // ── Retry policy ─────────────────────────────────────────────────────────

  'config.retry.maxRetries': {
    title: 'Max retries',
    shortDescription:
      'Retries per failed request. Amplifies load geometrically: rps × (1 + e + e² + … + e^k) where e = downstream error rate.',
    body: `# Max retries

How many times this component retries a failed downstream request — and therefore how hard it amplifies load into an unhealthy dependency.

The engine models retries as RPS amplification, not per-request replays (§41): \`amplifiedRps = rps × (1 + e + e² + … + e^maxRetries)\`, where \`e\` is the downstream's **previous-tick** aggregate error rate (real callers can't know failure instantly — one-tick delay). The series is bounded by \`1/(1−e)\`: at e=0.5, infinite retries cap at 2×; at e=0.8, 5×. All retry waves bundle into the current tick — a simplification that loses time-dispersion but keeps steady-state amplification right. The value must be a finite positive integer or the whole policy is ignored. Amplification is suppressed while the wire's breaker is HALF_OPEN, and a retry-storm callout fires when the factor crosses 1.5×.

Guidance (§21): 1–2 retries, paired with a breaker and backpressure. Retries help transient blips; against a saturated downstream they only accelerate collapse.`,
    category: 'config',
    relatedTopics: [
      'concept.retryStorm',
      'howto.retryStorm',
      'config.retry.backoffMs',
      'config.circuitBreaker.enabled',
      'reference.41-retry-storm-amplification',
    ],
  },

  'config.retry.backoffMs': {
    title: 'Backoff (ms)',
    shortDescription:
      'Wait before the first retry. Display-only in this model — 1-second ticks cannot resolve sub-second waits; maxRetries does the work.',
    body: `# Backoff (ms)

The delay before the first retry attempt (with an optional exponential multiplier for subsequent ones).

Honest model note: this field is **display-only**. The engine runs on one-second ticks, so sub-second retry spacing has no granularity to simulate — every retry wave is bundled into the same tick's amplified RPS, and only \`maxRetries\` affects the math. The field exists so designs document what a real retry policy would configure, and so reviews can check you didn't forget backoff entirely.

Guidance (§21): in real systems, exponential backoff **with jitter** is the difference between retries that heal and retries that synchronize. A fleet retrying after a fixed 100ms produces coordinated waves that re-saturate the downstream on a metronome; jitter de-correlates the herd. Start around 100ms, double per attempt, cap at a few seconds.

The failure the real knob prevents — synchronized retry waves — is exactly the storm the simulator's geometric amplification model collapses into a single tick.`,
    category: 'config',
    relatedTopics: [
      'config.retry.maxRetries',
      'concept.retryStorm',
      'reference.41-retry-storm-amplification',
      'reference.21-microservice-resilience-timeouts-retries-circuit-breakers-fallbacks',
    ],
  },

  // ── Backpressure ─────────────────────────────────────────────────────────

  'config.backpressure.enabled': {
    title: 'Backpressure enabled',
    shortDescription:
      'Component publishes acceptanceRate = 1 − errorRate; upstreams scale forwarded RPS by last tick’s value. One-tick delay.',
    body: `# Backpressure enabled

Per-component opt-in for downstream pushback. When enabled, the component computes \`acceptanceRate = 1 − errorRate\` (clamped to [0,1]) at the end of each tick, and every upstream multiplies its forwarded RPS by the **previous tick's** value — a one-tick propagation delay, matching the reality that callers can't instantly sense downstream saturation (§42).

Engine details worth knowing: the signal starts at 1.0 (fully accepting) and only updates on ticks with traffic — a quiet tick holds the last value rather than falsely healing to "accepting". Crashed components keep signaling from their frozen final metrics, so a dead, saturated database doesn't advertise full acceptance. Scaling is skipped while the wire's breaker is HALF_OPEN (probes flow clean), and a callout fires when acceptance drops to 0.7 or below.

Paired with retries, the two compose: amplification pushes in, backpressure scales out, stabilizing near sustainable throughput. Without it, retry-amplified load compounds unchecked into the failing component.`,
    category: 'config',
    relatedTopics: [
      'concept.backpressure',
      'howto.backpressurePropagation',
      'config.retry.maxRetries',
      'config.backpressure.thresholdQueue',
      'reference.42-backpressure-propagation',
    ],
  },

  'config.backpressure.thresholdQueue': {
    title: 'Backpressure queue threshold',
    shortDescription:
      'Queue depth at which backpressure would engage. Reserved — the current engine derives the signal from errorRate, not depth.',
    body: `# Backpressure queue threshold

The queue depth at which a component would start signaling backpressure.

Honest model note: this field is **reserved and currently ignored by the engine**. The implemented backpressure signal is derived purely from error rate — \`acceptanceRate = 1 − errorRate\`, updated end-of-tick — with no queue-depth input; the config reader consumes only \`enabled\`. Depth-based triggering (along with smoothing and hysteresis) is noted as future work in the engine source. Today, a component with deep-but-not-yet-erroring queues signals nothing until errors actually appear.

Why a depth threshold matters in real systems (§42, §13): queue depth is a *leading* indicator — depth grows ticks before errors do, so depth-triggered backpressure pushes back while there's still headroom, where error-triggered backpressure reacts only after requests start failing.

Until the engine consumes it, treat this as documentation of intent: where you'd want pushback to begin, not where the simulation makes it begin.`,
    category: 'config',
    relatedTopics: [
      'config.backpressure.enabled',
      'concept.backpressure',
      'config.maxDepth',
      'reference.42-backpressure-propagation',
    ],
  },

  // ── Traffic profile ──────────────────────────────────────────────────────

  'config.traffic.durationSeconds': {
    title: 'Duration (seconds)',
    shortDescription:
      'Total run length in sim-seconds (1 tick = 1 s). The run completes when time reaches this; phases beyond it never execute.',
    body: `# Duration (seconds)

Total length of the simulation run, in simulated seconds. One engine tick = one sim-second, so this is also the tick count.

The engine runs until \`time ≥ durationSeconds\`, then stops and hands the full log + metrics time-series to the debrief. Each tick's RPS comes from whichever phase covers the current time; any moment not covered by a phase produces zero traffic, and phases extending past the duration are simply cut off. Stressed mode ignores phase timing entirely — it holds the peak phase's RPS for the whole duration.

Guidance (§44): make the run long enough for slow failure modes to express themselves — cache warmup runs for half the TTL, breaker cooldowns are 10s by default, queue depth compounds tick by tick, and autoscalers react on 30s delays. A 30s run can look healthy while a 180s run of the same design ends in collapse.

Too short a duration is the easiest way to grade a broken design as passing.`,
    category: 'config',
    relatedTopics: [
      'config.traffic.phases',
      'config.traffic.shape',
      'reference.44-traffic-profile-semantics',
    ],
  },

  'config.traffic.jitterPercent': {
    title: 'Jitter %',
    shortDescription:
      'Declared arrival-time noise (0–100). Profile metadata — burstiness in the engine comes from phase shape, not this field.',
    body: `# Jitter %

Declared relative noise on request arrival times, 0–100. Editor default 15; the AI traffic generator also defaults to 15 unless you describe unusually regular arrivals.

Honest model note: the tick engine does **not** read this field. Arrival burstiness is modeled through the phase **shape** instead — each shape maps to a Kingman arrival-variance prior (steady 1.0, ramps/spike 2.0, instant_spike 4.0) that feeds the queueing formula. Per-request arrival gaps don't exist at 1-second tick granularity, so a percent-jitter on arrivals has nothing to perturb. Don't confuse it with the wire-level \`jitterMs\`, which **is** simulated (uniform ± on each hop's latency) — that's where latency noise in your results comes from.

So treat this as workload documentation: a statement about how bursty you believe arrivals are, useful context for reviews and the debrief narrative.

The practical trap is expecting this slider to stress your design — use an instant_spike phase for that.`,
    category: 'config',
    relatedTopics: [
      'config.traffic.shape',
      'config.jitterMs',
      'config.traffic.phases',
      'reference.44-traffic-profile-semantics',
    ],
  },

  'config.traffic.phases': {
    title: 'Traffic phases',
    shortDescription:
      'Timeline of {startS, endS, rps, shape} segments. Each tick reads the covering phase for RPS and arrival variance.',
    body: `# Traffic phases

The run's timeline: an ordered list of segments, each with \`startS\`, \`endS\`, a target \`rps\`, a \`shape\`, and a description.

Every tick, the engine finds the phase covering the current time and derives two things from it: the tick's RPS (held flat, ramped, or spiked per the shape) and the Kingman arrival-variance prior fed into every server's queueing math. Gaps between phases produce zero traffic. When a phase begins, its description is pushed to the live log — as a critical entry for \`instant_spike\` phases, info otherwise — so you can correlate metric changes with workload changes. Stressed mode bypasses the timeline: it holds the single highest phase RPS for the entire run, using that phase's (worst-case) arrival variance.

Guidance (§44): good profiles tell a story — warm-up steady, ramp to peak, a spike event, ramp down. The spike is where designs actually fail; the steady phases establish the baseline that makes the failure legible.`,
    category: 'config',
    relatedTopics: [
      'config.traffic.shape',
      'config.traffic.durationSeconds',
      'config.traffic.requestMix',
      'reference.44-traffic-profile-semantics',
    ],
  },

  'config.traffic.requestMix': {
    title: 'Request mix',
    shortDescription:
      'Per-endpoint traffic weights, keyed by endpoint id or "METHOD PATH". Unmatched weight splits evenly over entry points.',
    body: `# Request mix

Traffic weights per endpoint — how the tick's total RPS is divided across your API.

Keys match either an endpoint id or the contract's \`"METHOD PATH"\` form (e.g. \`"POST /checkout"\`; the latter needs API contracts to resolve). The engine seeds each matched endpoint's share at the head of its component chain, then walks a fallback ladder: keys that match nothing fall into a default bucket split evenly across entry points; if **no** mix keys match, per-route weights are used; failing that, pure even split — the pre-routing legacy behavior. Ambiguous METHOD+PATH keys (two contracts sharing one) are warned and defaulted rather than misrouted, and endpoints whose chains no longer match the live graph have their share redistributed with a callout. The mix also drives DB read/write attribution: which endpoints hit which tables decides each database's read vs write load.

Guidance (§44): weight by real traffic shape — read endpoints usually dominate 10:1. A mix that under-weights your write path will hide write saturation entirely.`,
    category: 'config',
    relatedTopics: [
      'config.traffic.phases',
      'config.readThroughputRps',
      'config.writeThroughputRps',
      'config.isEntry',
      'reference.44-traffic-profile-semantics',
    ],
  },

  'config.traffic.shape': {
    title: 'Phase shape',
    shortDescription:
      'How RPS evolves within a phase, and its burstiness: steady Cₐ²=1, ramps/spike 2, instant_spike 4 (Kingman arrival variance).',
    body: `# Phase shape

How traffic behaves inside a phase — both the RPS curve and how bursty arrivals are.

RPS curve: \`steady\` and \`instant_spike\` hold the phase's RPS flat (the spike is instant because the *previous* phase was lower); \`ramp_up\` climbs linearly from zero to the target; \`ramp_down\` descends from the previous phase's RPS; \`spike\` holds its elevated value. Burstiness: each shape sets the squared coefficient of arrival variation (Cₐ²) in the Kingman queueing formula — \`steady\` 1.0 (Poisson, exact M/M/1), ramps and \`spike\` 2.0, \`instant_spike\` 4.0. That term scales queueing delay linearly via (Cₐ² + Cₛ²)/2, so the same average RPS hurts up to ~2.5× more when it arrives in bursts. This is a modeled prior, not a measurement — ticks are too coarse to observe real arrival gaps. \`instant_spike\` phase entries also log as critical.

Failure mode: a design sized for steady arrivals at 80% utilization tips into queueing collapse the moment an instant spike quadruples arrival variance.`,
    category: 'config',
    relatedTopics: [
      'config.traffic.phases',
      'concept.utilization',
      'concept.littlesLaw',
      'concept.p50p95p99',
      'reference.44-traffic-profile-semantics',
    ],
  },

  'config.traffic.userDistribution': {
    title: 'User distribution',
    shortDescription:
      'Uniform vs pareto user activity. Profile metadata — in-engine skew comes from shard-key cardinality and the Zipfian cache model.',
    body: `# User distribution

Whether traffic comes evenly from all users (\`uniform\`) or is concentrated in a heavy-tailed minority (\`pareto\` — celebrities, huge servers, power users).

Honest model note: the tick engine does **not** read this field. The skew effects you actually see in a run enter elsewhere: the **shard-key cardinality** drives the hot-shard Pareto branch (78% of load on one shard), and the cache's **Zipfian working-set model** (skew 1.2) bakes in heavy-tailed key popularity unconditionally. The AI traffic generator sets \`pareto\` when your description hints at celebrity/power-user dynamics, and the field documents that workload assumption for the debrief and reviews.

Guidance: if your workload is genuinely pareto, make the model feel it where it's actually simulated — give the sharded DB a low-cardinality or user-based shard key and watch one shard absorb the whales.

The trap: declaring pareto here and expecting skewed load without a skewed shard key — the simulation will stay perfectly, misleadingly even.`,
    category: 'config',
    relatedTopics: [
      'config.shardKey',
      'concept.hotShard',
      'config.traffic.requestMix',
      'reference.44-traffic-profile-semantics',
    ],
  },

  // ── Severity legend (live log) ───────────────────────────────────────────

  'severity.info': {
    title: 'Info',
    shortDescription:
      'Narrative events, not problems: traffic phase starts, autoscaler scale-ups, fan-out volume notes. Throttled per component.',
    body: `# Info

Narrative, not alarm. Info entries mark what the simulation is *doing*: a traffic phase starting (its description from the profile), the autoscaler adding instances, a fan-out reporting its output volume.

Logs are throttled to one entry per component and severity per 2 sim-seconds, so info lines won't flood the feed. Use them as timeline anchors — when a metric bends, the nearest info line usually names the workload change that caused it. No action needed.`,
    category: 'severity',
    relatedTopics: [
      'severity.warning',
      'severity.critical',
      'config.traffic.phases',
    ],
  },

  'severity.warning': {
    title: 'Warning',
    shortDescription:
      'Degrading but not failing: saturation callouts, queue filling, retry storms, backpressure, miss-storms, rate limiting.',
    body: `# Warning

Something is degrading and the engine can see the collapse coming. Most one-shot callouts land here: server saturation (ρ ≥ 0.85), connection-pool pressure, queue filling past 70%, retry storms amplifying ≥ 1.5×, backpressure scaling, cache miss-storms, unindexed-scan and read/write saturation findings — plus recurring rate-limit rejections and request drops. Breaker transitions other than opening also log as warnings.

Callouts fire once per component per run and name a concrete fix. A warning is the cheapest moment to intervene.`,
    category: 'severity',
    relatedTopics: [
      'severity.critical',
      'severity.info',
      'concept.utilization',
      'concept.retryStorm',
    ],
  },

  'severity.error': {
    title: 'Error',
    shortDescription:
      'Reserved level. The engine currently emits only info, warning, and critical — failures surface as warning or critical entries.',
    body: `# Error

Reserved severity level. The simulation engine currently emits only **info**, **warning**, and **critical** — there is no event class between "degrading" and "failing" in the model, so nothing logs at error today.

Where you'd expect errors, look at the metrics instead: per-component \`errorRate\` (and the DB's read/write/pool split) is the continuous error signal that breakers, retries, and backpressure react to. The log reports threshold crossings of that signal as warnings (degrading) or criticals (failing).`,
    category: 'severity',
    relatedTopics: [
      'severity.warning',
      'severity.critical',
      'config.errorRate',
    ],
  },

  'severity.critical': {
    title: 'Critical',
    shortDescription:
      'Active failure: breaker opens, queue overflow, pool exhaustion, cache stampede, no healthy backends, component crash.',
    body: `# Critical

Active failure — requests are being lost right now. Fired when a circuit breaker opens, a queue overflows, connection-pool exhaustion fails queries, a cache stampede floods the DB, a load balancer runs out of healthy backends, health crosses critical, or a component **crashes** (CPU/memory past 98%; crash messages include a sizing fix). An \`instant_spike\` phase start also logs critical.

Crashed components freeze their final metrics so you can read why they died; criticals reduce the debrief's performance score.`,
    category: 'severity',
    relatedTopics: [
      'severity.warning',
      'concept.circuitBreakerStates',
      'concept.cacheStampede',
      'config.maxDepth',
    ],
  },

  'severity.debrief': {
    title: 'Debrief',
    shortDescription:
      'Post-run analysis entries, not live engine logs: deterministic design flags, Socratic questions, scores, per-component peaks.',
    body: `# Debrief

Entries sourced from the post-run debrief, not the live engine. When a run completes, a deterministic analyzer reads the full log and metrics time-series and produces design flags (missing auth, no DLQ, consistency contradictions, single points of failure), Socratic questions triggered by what actually happened (hot shard, stampede, overflow), coherence/security/performance scores, and per-component peak p50/p99/ρ/errors.

It runs instantly in the browser; AI-augmented questions merge in when available. Treat debrief items as design-review feedback, not runtime events.`,
    category: 'severity',
    relatedTopics: [
      'severity.critical',
      'severity.warning',
      'config.consistencyModel',
      'config.dlqEnabled',
    ],
  },
};
