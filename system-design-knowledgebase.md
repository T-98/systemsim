# SystemSim — System Design Knowledge Base

> **Authorial memory for the SystemSim learning layer.**
>
> Content curated from internal SIMFID runtime concepts. Organized for learning, not reference lookups. Tradeoffs foregrounded. Real-world anchors throughout.
>
> **Used by:** wiki copy generation (hand-curated from this document), info-icon popover content, in-app "Learn more" links, future AI help features.
>
> **Not served verbatim.** Wiki cards are *curated derivatives* in ReactFlow-catalog style: short text + diagram + pre-configured exercise. This file is the well from which that curation draws.

---

## Contents

### Part I — Design Thinking
1. [How to Approach Designing a System](#1-how-to-approach-designing-a-system)
2. [Core Challenges in Web-Scale Design](#2-core-challenges-in-web-scale-design)
3. [Non-Functional Requirements](#3-non-functional-requirements)
4. [QPS Tiers & What They Imply](#4-qps-tiers--what-they-imply)
5. [Back-of-Envelope Resource Estimation](#5-back-of-envelope-resource-estimation)

### Part II — Fundamentals
6. [Architecture Patterns — Monolith vs Microservices](#6-architecture-patterns--monolith-vs-microservices)
7. [Performance Fundamentals — Latency, Throughput, Percentiles](#7-performance-fundamentals--latency-throughput-percentiles)
8. [High Availability & Fault Tolerance](#8-high-availability--fault-tolerance)

### Part III — Building Blocks
9. [Load Balancing](#9-load-balancing) *(populated in Scaling Services pass)*
10. [Caching — Full Curriculum](#10-caching--full-curriculum) *(populated in Scaling Services pass)*
11. [Data Storage](#11-data-storage) *(populated in Data Storage pass)*
12. [Database Scaling — Partitioning, Replication, Consistent Hashing](#12-database-scaling) *(populated in How to Scale Databases pass)*
13. [Message Queues & Async Communication](#13-message-queues--async-communication) *(populated in Microservices pass)*
14. [Batch & Stream Processing](#14-batch--stream-processing) *(populated in Big Data pass)*

### Part IV — API Layer
15. [API Gateway](#15-api-gateway)
16. [REST Design](#16-rest-design)
17. [Authentication — API Keys, Sessions, JWT](#17-authentication)
18. [Authorization — RBAC, ABAC, OAuth](#18-authorization)
19. [Pagination — Offset, Cursor, Time-Series](#19-pagination)

### Part V — Scaling & Resilience
20. [How to Scale a System](#20-how-to-scale-a-system)
21. [Microservice Resilience — Circuit Breaker, Retries, Timeouts, Fallbacks](#21-microservice-resilience)
22. [Rate Limiting — Token Bucket, Leaky Bucket, Sliding Window](#22-rate-limiting)

### Part VI — Patterns & Templates
23. [Saga — Distributed Transactions with Compensating Actions](#23-saga--distributed-transactions-with-compensating-actions)
24. [Fan-Out / Fan-In — Parallel Processing in Distributed Systems](#24-fan-out--fan-in--parallel-processing-in-distributed-systems)
25. [CQRS & Read-Write Separation](#25-cqrs--read-write-separation)
26. [Pre-Computing — Compute on Write vs Compute on Read](#26-pre-computing--compute-on-write-vs-compute-on-read)
27. [Unique ID Generators — Snowflake, UUID, ULID](#27-unique-id-generators--snowflake-uuid-ulid)

### Part VII — Extended Patterns & Case Studies
33. [Cache-First Pattern for High-Volume Systems](#33-cache-first-pattern-for-high-volume-systems)
34. [Two-Stage Processing Pattern](#34-two-stage-processing-pattern)
35. [Database-Per-Microservice](#35-database-per-microservice)
36. [Database Optimization Techniques](#36-database-optimization-techniques)
37. [Multi-System Data Sync via Change Data Capture](#37-multi-system-data-sync-via-change-data-capture)
38. [Case Study — High-Performance Comment System with Kafka + Redis](#38-case-study--high-performance-comment-system-with-kafka--redis)
39. [Case Study — Scalable Services with Message Queues and Caching](#39-case-study--scalable-services-with-message-queues-and-caching)

### Part VIII — SIMFID Runtime (internal, not from source material)
40. [Circuit Breaker State Machine](#40-circuit-breaker-state-machine)
41. [Retry Storm Amplification](#41-retry-storm-amplification)
42. [Backpressure Propagation](#42-backpressure-propagation)
43. [Wire-Level Configuration](#43-wire-level-configuration)
44. [Traffic Profile Semantics](#44-traffic-profile-semantics)

---

# Part I — Design Thinking

## 1. How to Approach Designing a System

System design is about reasoning from first principles, not memorizing buzzwords. The approach:

1. **Clarify functional requirements.** What exactly does the system do? For a WhatsApp-like chat: does it support group chat, video calls, read receipts, offline sync? Naming what's in *and out* of scope is half the work.
2. **Clarify non-functional requirements.** Scalability, latency, availability, consistency, security, efficiency. These drive the architecture far more than features do.
3. **Back-of-envelope resource estimation.** DAU, peak QPS, read/write ratio, storage per record, bandwidth. Numbers shape choices — you can't pick a DB before you know if you're at 100 QPS or 100K.
4. **High-level design.** Sketch major components and how they talk. Don't over-specify yet.
5. **Core entities + API endpoints.** Data model + interface contract.
6. **Detailed design.** Pick one critical piece and go deep — why *that* shard key, why *eventual* consistency here, why *this* cache pattern.

The tradeoff lens runs through all of it. Every choice closes some doors and opens others. Name both sides.

## 2. Core Challenges in Web-Scale Design

Four patterns show up in every large system. Each has a canonical response.

**Challenge 1 — Too many concurrent users.** One server collapses under load.
*Response:* horizontally scale stateless app servers behind a load balancer. Add read replicas to the database so reads don't queue behind writes.

**Challenge 2 — Too much data to move around.** One DB can't hold it all, and queries get slow anyway.
*Response:* shard by user ID (or another natural key) using a lookup table or hash function. Each shard holds a slice. The router picks the right shard per request.

**Challenge 3 — System must stay fast and responsive.** Some work (image transcoding, notifications, analytics) is too slow to do synchronously.
*Response:* pull slow work off the request path. Writes hit a message queue; a worker pool drains it asynchronously. User gets a fast ack, work happens later.

**Challenge 4 — Inconsistent (outdated) states.** Replicas lag the primary. Caches go stale. Two nodes receive conflicting writes.
*Response:* accept eventual consistency for most reads. Use last-write-wins or CRDTs for conflicts. Use strong consistency only where it's worth the latency cost (payments, inventory). The CAP theorem forces a choice — pick two of consistency, availability, partition-tolerance, and be honest about which two.

**Summary.** Web-scale systems replicate logic and data, shard their problem space, and process slow work asynchronously. The result is an eventually-consistent app serving all users on arbitrarily large data, gradually adding machines as the user base grows. This is the core philosophy of modern large-scale data-intensive systems.

## 3. Non-Functional Requirements

**Availability.** Staying online. Achieved by redundancy (multiple instances), failover (detect failure, reroute), multi-region deployment.

**Scalability.** Handling growth. Achieved by stateless services, autoscaling, caching, partitioning.

**Latency.** Speed of responses. Achieved by CDNs, edge compute, read replicas, DB index tuning, async processing.

**Consistency.** Data accuracy across replicas. Strong = every reader sees the latest write, higher latency. Eventual = replicas converge over time, faster but reads may lag. Pick per use case: payments need strong, timelines tolerate eventual.

Each NFR has its own design patterns:
- Availability → load balancing + replication
- Scalability → autoscaling + horizontal scaling + caching
- Latency → CDN + edge compute + async work
- Consistency → consensus protocols, quorum reads/writes, synchronous replication

Most real systems trade some dimensions against others. A design that claims to maximize all four is almost always wrong about one of them.

## 4. QPS Tiers & What They Imply

The right architecture depends on load tier. Picking the wrong tier is over-engineering (or under-).

**Low QPS (1–100).** Monolithic app, single DB. LAMP-style stack. Single server or small cluster. Don't shard; don't microservice. Startup early days.

**Medium QPS (100–1,000).** Horizontal scaling with a load balancer, read replicas, caching layer. Single application, multiple instances. Still monolithic on the app side usually. Mid-market SaaS.

**High QPS (1,000–100,000).** Microservices, message queues, distributed systems. Each service scales independently. Event-driven patterns. Late-stage SaaS, popular mobile apps.

**Very High QPS (100,000+).** Globally distributed, multi-region, streaming architectures, heavy caching with CDN edge. Netflix-class. Here you're building for the 99th percentile of the 99th percentile.

**Worked example — cross-system stack suggestions by tier:**
- Ecommerce (high QPS, mixed read/write): Cassandra or DynamoDB for product catalog, MySQL/Aurora for orders, Elasticsearch for search, Redis for cart
- Social media (very high QPS, read-heavy): Kafka for event stream, Redis for feed cache, DynamoDB for user data, Cassandra for activity
- Analytics platform (write-heavy bursts, complex reads): Kafka for ingest, Spark/Flink for processing, Snowflake or Hadoop for warehouse
- Ticket booking (moderate QPS, strong consistency on writes): PostgreSQL/Aurora with row-level locking, message queues for downstream integrations
- Chat (very high concurrent connections, small payloads): Cassandra for message history, RabbitMQ/Kafka for delivery, Redis for presence, WebSockets for real-time

## 5. Back-of-Envelope Resource Estimation

Before designing, know your load.

**How to describe it.**
- **Requests per second.** Peak, not average. Twitter-scale: 100K+ tweets/sec at peak.
- **Read/write ratio.** Social feeds: 100:1 reads to writes. Analytics: 1:1 or write-heavy.
- **Storage per record × record count × replication factor.** 1KB/record × 1B records × 3 replicas = 3TB.
- **Bandwidth.** Video systems dominated by egress; text systems by request count.

**Concurrent connections.** Not the same as requests per second. Chat systems hold persistent connections; REST APIs don't. WhatsApp: ~2B persistent connections, radically different infra from a 1M RPS REST service.

**Worked example — Uber at peak hour.**
- Assume 1M active riders, each making 10 requests/min during peak
- Peak = 1M × 10 / 60 ≈ 170K RPS
- If each request is 2KB: ~340MB/s ingress, matching egress
- That number drives every architecture choice

**Ratios that matter:**
- **Read/write ratio.** Determines replica strategy, cache aggressiveness, query budget
- **Concurrent connection count.** Determines socket budget, keepalive strategy, connection pool sizing
- **Data growth rate.** Determines storage roadmap, archival strategy, shard count over time

Write these numbers down *before* you pick tools. The same "build a feed system" problem has radically different answers at 100 DAU vs 100M DAU.

---

# Part II — Fundamentals

## 6. Architecture Patterns — Monolith vs Microservices

**Monolith.** One codebase, one deploy artifact, all components in-process.

*Pros:* simple, fast in-process calls, easy to debug, one source of truth for data, tight consistency without distributed-systems pain.

*Cons:* scaling is all-or-nothing, single-language lock-in, large team coordination gets painful, failure in one module can take down the whole thing, higher tech debt over time.

**Microservices.** Services split by business capability, deploying independently, communicating over the network.

*Pros:* independent deploys, independent scaling, technology diversity per service, smaller team ownership, fault isolation across services.

*Cons:* distributed-system complexity (network failures, partial outages), data consistency across services is hard, operational overhead (monitoring, deployment, service discovery, circuit breaking), higher infrastructure cost.

**The advice.** Monolith first. Extract services when you feel actual pain — a specific module needs to scale independently, a team bottleneck demands independent deploys, or different parts of the system genuinely need different tech. Premature microservices are the most common architectural mistake. Martin Fowler's guidance: start monolithic, and don't even think about extracting services until the pain of *not* doing it is obvious and real.

**When monolith-first goes wrong.** Two cases where you actually want microservices from day one: (1) you're building a platform where third parties will own parts of the system (API gateway over N external owners), and (2) you have multiple radically different scaling profiles baked into the product (video transcoding + user auth + billing, each with wildly different compute shapes).

## 7. Performance Fundamentals — Latency, Throughput, Percentiles

### Latency vs Response Time

Latency is a subset of response time. Response time = network latency + queuing delay + processing time + interaction time (client rendering, input wait).

Real-time apps with sub-100ms expectations (online gaming, conferencing, trading) can't just "throw more servers at it" — every layer of the stack has to be engineered for the bound.

### Percentiles, not averages

Measure at percentiles. Averages lie.

- **p50 (median).** Typical request.
- **p95.** Worse than 95% of requests. First sign something's wrong.
- **p99 (tail latency).** The slowest 1%. Dominates perceived experience for heavy users. Someone making 100 requests per session hits the tail on average.

**Tail latency matters more than average.** Google Cloud Spanner publishes average and p99 separately; the gap tells you how predictable the system is. High tail with low average means queuing, contention, or garbage collection pauses.

### Throughput

Requests per second the system can handle. Scaled via:

- **Replication.** Primary handles writes, N replicas handle reads. Read throughput scales linearly with replicas (until primary-to-replica sync becomes the bottleneck).
- **Partitioning / sharding.** Split data across instances. Write throughput scales with shards.
- **Message queues.** Producer throughput decouples from consumer throughput. Queue absorbs bursts.

### Little's Law (implied, not explicit in source)

`L = λ × W`

Where L = average number of requests in the system, λ = arrival rate (RPS), W = average time in system (latency).

Practical use: if average latency is 200ms and arrival rate is 500 RPS, you have 100 requests in flight on average. Size your thread/connection pool accordingly. When utilization (ρ = λ/μ) approaches 1, queue length explodes non-linearly — which is why 85% CPU is the yellow zone and 95% is the red zone.

### Managing latency

CDN for static assets. Read replicas close to users. Async for slow work. Edge compute for time-sensitive logic. Monitor the distribution, not just the mean.

## 8. High Availability & Fault Tolerance

### Uptime math

| Availability | Downtime per year | Downtime per day |
|---|---|---|
| 99% (two nines) | 3.65 days | 14.4 minutes |
| 99.9% (three nines) | 8.76 hours | 1.44 minutes |
| 99.99% (four nines) | 52.56 minutes | 8.64 seconds |
| 99.999% (five nines) | 5.26 minutes | 0.864 seconds |

Each "nine" is ~10× harder and usually ~10× more expensive. Five-nines means your system can be down for at most ~5 minutes across the entire year.

### SLA (Service Level Agreement)

Contract between provider and customer. Violations trigger credits.

Example — Google Compute Engine: 99.95% monthly uptime for instances in multiple zones. Below that, credits scale with severity (below 99.0% → 25% credit, below 95.0% → 50% credit).

When consuming cloud services, your achievable uptime is bounded by theirs. A 99.99% app on top of a 99.95% DB can't actually hit 99.99%.

### How to achieve HA

**Redundancy.** N+1 (and sometimes N+2) everything. No single point of failure.

**Load balancing.** Detect dead instances, reroute traffic.

**Data replication.** Multi-region for critical data. Sync replication = strong consistency + higher write latency. Async = eventual consistency + faster writes.

**Health monitoring + auto-recovery.** Liveness/readiness probes in Kubernetes. Cloud-native: AWS EC2 Auto Recovery, GCP Managed Instance Groups.

### Tech stacks

- **AWS:** HAProxy, Keepalived, Route53, Auto Scaling Groups, Multi-AZ RDS, CloudFront
- **GCP:** Cloud Load Balancing, Cloud SQL Auto Scaling, Traffic Director, regional/multi-regional storage
- **Azure:** Load Balancer, Cosmos DB (multi-region writes), Traffic Manager

### Availability vs Fault Tolerance

**Fault tolerance** is a design property — the system keeps working through failures with zero perceived downtime.

**Availability** is a measurable outcome — what fraction of time the system was up.

FT implies HA; HA doesn't require full FT. Most real systems target HA via redundancy + graceful degradation, accepting brief availability dips during failover rather than paying for true FT.

---

# Part III — Building Blocks

## 9. Load Balancing

A load balancer sits in front of a pool of servers and spreads incoming requests across them. It's the first scaling move most apps make.

### Why it exists

Any single server has capacity limits. When load exceeds what one box can handle, you have two choices: buy a bigger box (vertical scaling — bounded) or add more boxes (horizontal scaling — boundless until the database cracks). Horizontal scaling needs something in front to pick which box handles each request. That's the load balancer.

### What it does, concretely

- **Distribute requests.** Per-request routing across N backend instances.
- **Health check.** Probe backends periodically (`GET /health`). Yank unhealthy ones from rotation.
- **Failover.** If an instance dies mid-request, retry on another.
- **TLS termination.** Decrypt once at the LB, pass plaintext to backends (simpler backends, centralized cert management).

### Algorithms

- **Round-robin.** Next request to next server in the list. Simple, assumes homogeneous backends.
- **Least-connections.** Send to the instance with the fewest active connections. Better under long-lived connections (WebSockets, long-polling).
- **Weighted round-robin.** Give beefier instances more traffic proportional to capacity.
- **IP hash.** Hash(client IP) → server. Sticky routing — same client lands on same server. Useful for session affinity without a shared store.
- **Random.** Surprisingly effective at scale; avoids the herding problems of deterministic algorithms.

### L4 vs L7

- **L4 (Transport layer — TCP/UDP).** Just forwards bytes. Fast, protocol-agnostic. Can't make routing decisions based on URL or headers.
- **L7 (Application layer — HTTP).** Understands HTTP. Routes by path, method, header, cookie. Can rewrite requests, do A/B splits, insert headers. Slightly higher overhead.

Most modern web apps want L7 (Nginx, HAProxy, Envoy, cloud LBs). L4 shows up in ultra-high-throughput or non-HTTP scenarios.

### Layered LB

Real systems layer them:
- **DNS-level GSLB** routes to the nearest region.
- **Regional L7 LB** routes to the right service.
- **Service-level LB** (or Kubernetes Service + kube-proxy) routes to specific pods.

Each layer has its own health checks, algorithms, and failure domain.

### Common tools

- **Nginx** — L7 reverse proxy. Most common open source choice. Config: `upstream { server ...; } + server { location / { proxy_pass http://upstream; } }`.
- **HAProxy** — high-performance L4/L7. Common in finance / latency-sensitive.
- **Envoy** — modern L7 with deep observability. Used by Istio / service meshes.
- **Cloud LBs** — AWS ELB/ALB/NLB, GCP Cloud Load Balancing, Azure Load Balancer. Managed, integrate with auto-scaling.

### Tradeoffs

The LB is a single point of failure by default — make it redundant (active-passive with keepalived, active-active behind DNS). It's also a latency hop; budget 1-5ms per pass. And it's where TLS termination happens — secure it accordingly.

## 10. Caching — Full Curriculum

Caching is the single highest-leverage performance technique in most systems. This section covers the full curriculum: mental model, patterns, failure modes, operations, infrastructure.

### 10.1 Mental Model — Time-Bounded Copies

A cache is a **time-bounded copy** of data that lives between a fast-but-volatile store (RAM) and a slow-but-durable store (DB, disk, network).

The core tradeoff: **data freshness vs access speed**. Every cache entry is stale the instant it's written. The question is whether "stale by N milliseconds" is acceptable for this read. For product catalogs: yes, seconds of staleness is fine. For current account balance: no, must be fresh.

**Three questions to answer for every cache:**
1. **What do I cache?** Hot data (accessed often) and expensive-to-recompute data (joins, aggregations, rendered views).
2. **How long?** TTL. Shorter = fresher but lower hit rate. Longer = higher hit rate but more staleness.
3. **What gets evicted?** When memory fills, which entry dies to make room?

**Hit rate formula:** `hit_rate = hits / (hits + misses)`. A 90% hit rate means 90% of reads skip the DB. Most production caches target 90%+.

**Typical cache types by storage tier:**
- **In-process** — variables, HashMaps in app memory. Zero network hop. Dies with process.
- **Local** — Memcached/Redis on same box. 0.1ms access. Survives process restart.
- **Remote** — Redis/Memcached cluster over network. 0.5-2ms access. Shared across app servers.
- **CDN** — edge nodes near users. 10-50ms. Public, shared across users.

### 10.2 Read Patterns — Cache-Aside vs Read-Through

**Cache-Aside (lazy loading)** — **app is in control.**

```
1. App checks cache for key
2. If hit: return value
3. If miss: app queries DB, stores in cache, returns
```

- Pros: app has full control over what gets cached, which DB is queried, and how misses are handled.
- Cons: every call site has to implement the pattern (or wrap in a helper). Bugs in one caller can bypass cache.
- When to use: default for most apps. Flexible, explicit, debuggable.

**Read-Through** — **cache is in control.**

```
1. App asks cache for key
2. Cache returns value (fetching from DB on miss transparently)
```

The cache manages the DB fetch. App code just asks the cache; the cache has a "loader" function that knows how to fetch from DB on miss.

- Pros: app code is cleaner, less duplication. Cache knows what's authoritative.
- Cons: requires a cache library that supports loaders (not just a key-value store). Harder to debug. Less flexible per-call-site.
- When to use: when access patterns are uniform and you want clean call sites.

**Comparison table:**

| Aspect | Cache-Aside | Read-Through |
|---|---|---|
| Who fetches on miss | App | Cache library |
| Complexity | Simple cache, smart app | Smart cache, simple app |
| Flexibility per call | High | Low |
| Visibility into DB hits | Easy (in app logs) | Harder (cache internals) |
| Language support | Any KV cache | Needs loader support |

### 10.3 Write Patterns — Write-Through, Write-Behind, Write-Around

**Write-Through** — synchronous dual-write.

```
App writes → cache + DB (both, synchronously) → return
```

- Pros: cache always consistent with DB.
- Cons: every write pays DB latency. Write failures are tricky (cache succeeded, DB failed?).

**Write-Behind (Write-Back)** — async DB flush.

```
App writes → cache (return immediately) → background worker flushes batches to DB
```

- Pros: fast writes (cache speed). Batches DB writes for efficiency.
- Cons: **data loss if cache crashes before flush.** Requires durable cache or careful crash handling. Ordering complexity (write reordering across keys).
- When to use: write-heavy workloads where some loss is acceptable (analytics, metrics).

**Write-Around** — bypass cache on write.

```
App writes → DB only → cache populated lazily on next read
```

- Pros: write-once-read-never data doesn't pollute cache.
- Cons: first read after write is always a miss.
- When to use: large blobs, append-only logs, audit trails.

**Choosing a write pattern:**

| Pattern | Write latency | Durability | Consistency | Best for |
|---|---|---|---|---|
| Write-Through | Slow (DB-bound) | Durable | Strong | Read-heavy, critical data |
| Write-Behind | Fast (cache-bound) | Risk of loss | Eventual | Write-heavy, metrics |
| Write-Around | Normal (DB-bound) | Durable | Strong (with lazy read) | Write-once-read-never |

### 10.4 Failure Modes — Penetration, Avalanche, Stampede

The three canonical cache failures.

**Cache Penetration.** Queries for data that doesn't exist in DB.

Every request misses cache, hits DB, DB returns nothing, nothing gets cached — next identical request does it all again. A malicious actor querying random IDs can DoS your DB through an otherwise-healthy cache.

*Defenses:*
- **Cache negative results.** Store `null` for missing keys with a short TTL.
- **Bloom filter.** Probabilistic "does this key exist?" check in front of cache. Saves DB round-trip for definitely-missing keys.
- **Input validation.** Reject obviously malformed IDs before they reach the cache layer.

**Cache Avalanche.** Many keys expire at the same time → burst of DB load as everything re-populates simultaneously.

Common cause: startup scripts load a batch of keys with identical TTLs → they all expire at the same wall-clock moment.

*Defenses:*
- **Jittered TTLs.** `ttl = base + random(0, spread)`. Spreads expirations across time.
- **Tiered caches.** L1 in-process + L2 remote. L1 cushions L2 re-population bursts.
- **Never-expire + background refresh.** Keep keys indefinitely, refresh asynchronously.

**Cache Stampede (Thundering Herd).** A single hot key expires; many concurrent requests all miss; all hit DB at once.

This is the classic failure mode. One Redis key for `/api/feed/trending` expires, 10,000 concurrent users all miss, 10,000 DB queries hit the origin at once.

*Defenses:*
- **Request coalescing (single-flight).** First miss triggers fetch; concurrent misses wait on the in-flight result. Library support: Go's `singleflight`, Node `p-memoize`.
- **Stale-while-revalidate.** Serve stale value while one worker refreshes in background.
- **Mutex / lock.** Only one worker fetches; others wait briefly or serve stale.
- **Probabilistic early expiration.** Each client, on read, has a small chance of triggering refresh *before* expiry — amortizes the stampede.

### 10.5 Eviction — LRU, LFU, Memory Math

When the cache fills, something has to go. The eviction policy decides what.

**LRU (Least Recently Used)** — evict the key not accessed for the longest time.

- Assumes **temporal locality**: recently accessed things are likely to be accessed again.
- Works for most workloads. Default choice.
- Implementation: doubly linked list + hash map. O(1) access + eviction.

**LFU (Least Frequently Used)** — evict the key with the fewest accesses.

- Assumes **popularity locality**: items accessed often will keep being accessed.
- Better for content systems (Netflix thumbnails, news sites).
- Higher memory overhead (counters) and trickier to implement with good performance.
- Variants: approximate LFU (Redis), windowed LFU.

**FIFO, Random, TTL-only** — exist, but rarely the right choice for general caching.

**Memory math.** Size your cache to cover the working set:

```
cache_size = working_set × (safety_factor, typically 1.2–1.5)
```

Where working set = keys accessed within a typical window (last hour, last day).

- Under-sized cache: high eviction rate, low hit rate, thrashing.
- Over-sized cache: wasted RAM, but hit rate asymptotes — diminishing returns past ~95% hit rate.

Rule of thumb: profile eviction rate. Sustained eviction during steady traffic = undersized. Eviction spikes during new feature launches = working set grew — resize.

### 10.6 Invalidation — TTL, Purge, Stale-While-Revalidate

Three strategies, pick based on freshness requirements.

**TTL (Time-To-Live).** Every entry has an expiry. After expiry, next read is a miss.

- Pros: dead simple, bounded staleness, no write-time coupling.
- Cons: serves stale data within TTL window. Short TTL = lower hit rate.
- Typical values: 10s for hot public data, 60s for user profiles, 5min for rarely-changing config.

**Explicit Purge (Write-Time Invalidation).** On every write to DB, delete the corresponding cache key.

- Pros: immediate consistency after writes.
- Cons: tight coupling (every write path must know which keys to invalidate). The dual-write problem (see §10.11).
- Common bug: forgetting to invalidate some cache key for a rare write path.

**Stale-While-Revalidate (SWR).** Serve stale value immediately; refresh asynchronously in background.

- Pros: best latency, bounded staleness.
- Cons: requires async worker, more complex.
- Pattern: HTTP `Cache-Control: max-age=60, stale-while-revalidate=300`. Browser/CDN serves cached for 60s, then serves stale up to 5min while refresh happens.

**TTL as a safety net.** Even when using explicit purge, set a TTL. If your purge logic has a bug, TTL ensures eventual freshness.

### 10.7 Key Design

Keys are the cache's API. Get them wrong and everything else suffers.

**Structure:** `<app>:<version>:<entity>:<id>[:<field>]`

Examples:
- `checkout:v2:cart:user_4717`
- `feed:v1:timeline:user_4717:page_0`
- `session:v1:sess_abc123`

**Namespacing.** The `<app>` prefix isolates tenants sharing one cache cluster. Prevents accidental collisions.

**Versioning.** The `<version>` lets you ship schema changes without a full flush. When you change how user profiles are serialized, bump `v2` — old `v1` keys still exist but new reads populate `v2` keys. Old keys expire naturally.

**Identity scoping.** Per-user data MUST include the user ID in the key. A key like `cart:current` without user ID is an authorization bug waiting to happen.

**Pitfalls:**
- **User input in keys.** Escape or hash user-provided strings. `user:john_doe; DROP TABLE` — nothing will actually drop, but key collisions and log-injection are possible.
- **No versioning.** Schema change → you need a full cache flush, which spikes DB load. Versioned keys let new and old coexist.
- **Missing identity.** `session:current` leaks one user's session to the next request.

### 10.8 Cold Start

When a cache comes up empty (after deploy, crash, or scale-out event), every read is a miss. All traffic slams the DB.

Effectively a system-wide stampede.

**Strategies:**
- **Gradual traffic cutover.** Route a small fraction of traffic to the new instance; ramp up as hit rate climbs.
- **Pre-populate from snapshot.** Dump hot keys from the old instance (RDB dump for Redis), restore on new instance.
- **Background prewarming.** Before serving traffic, run a script that fetches the top-N hot keys from DB and populates cache.
- **Tiered caching.** L1 (in-process) + L2 (remote). L1 warms naturally; L2 is what needs prewarming.

**Monitoring.** Hit rate should climb from ~0% at boot toward steady-state within minutes. If it stays low, something's wrong (wrong key format, TTL too short, working set larger than expected).

### 10.9 Distributed Caching — Consistent Hashing + Redis Cluster

When one cache node isn't enough, you shard.

**Naive sharding: `shard = hash(key) % N`.** Works — until you add or remove a node. Then N changes, and almost every key moves to a different shard. Mass invalidation.

**Consistent hashing.** Map both keys and nodes onto a ring (e.g., 0 to 2^32). Each key goes to the first node clockwise. Adding a node claims a slice of the ring; only keys in that slice move.

- **Virtual nodes.** Each physical node claims many positions on the ring. Smooths out hot-spotting and rebalancing.
- **Key churn on resize.** With consistent hashing: ~1/N keys move when adding/removing one node. With modulo: ~(N-1)/N keys move. Massive improvement.

**Redis Cluster** uses a fixed 16384 hash slots. Each node owns a range of slots. Keys map to slots via `CRC16(key) % 16384`. Adding a node redistributes some slots; clients learn topology via `MOVED` redirects.

**Client-side vs server-side hashing.**
- Client-side: clients know the ring, compute the shard themselves. One network hop. Must keep clients in sync.
- Server-side: a proxy routes. Adds a hop but centralizes topology.

### 10.10 Cache High Availability

Caches go down. Plan for it.

**Replication (leader-follower).** One primary, N replicas. Writes go to primary, async-sync to replicas. Reads can fan out to replicas.

- Redis native replication: `replicaof <primary-host> <port>`.
- Replicas catch up from primary backlog; full resync on large drift.

**Sentinels.** Separate processes that monitor primary health. On primary failure, sentinels elect a new primary from replicas and reconfigure clients.

- Quorum-based decisions (e.g., 3 sentinels, majority agrees primary is down).
- Redis Sentinel mode: dedicated process, separate from data path.

**Redis Cluster.** Built-in sharding + replication + failover. Each shard has primary + replicas; cluster handles failover automatically.

**Cache as a non-critical path.** Design your app to survive cache being down — fall back to DB (with degraded latency) rather than erroring out. The cache is a performance layer, not a correctness layer.

### 10.11 Consistency — The Dual-Write Problem

Writing to both cache and DB means they can diverge.

**The race:**
1. Service A writes to DB: value = X
2. Service B writes to DB: value = Y
3. Service B invalidates cache (or writes Y to cache)
4. Service A (slower) invalidates cache (or writes X to cache) — but DB already has Y
5. Cache now has X, DB has Y. Divergence.

**Mitigations:**

- **Delete on write, not update.** Forces re-read on next request, which sees current DB state. Safer than "update cache with written value."
- **Order: write DB first, then invalidate cache.** The opposite order leaks stale reads post-invalidation.
- **Short TTL as safety net.** Caps divergence duration.
- **CDC (Change Data Capture).** Stream DB changes to cache invalidator (Debezium reading MySQL binlog). Serializes all invalidations through one source of truth.
- **Versioning.** Store version alongside value; writes include version; stale writes detected.

**The honest truth:** strong consistency between cache and DB is impossible without distributed transactions, which defeat the purpose of caching. Pick "eventually consistent with short bounded staleness" and design around it.

### 10.12 Caching Tiers — Browser, CDN, App, DB

Real systems layer caches. Each tier has different invalidation, capacity, and TTL.

| Tier | Where | Typical TTL | Capacity | Invalidation |
|---|---|---|---|---|
| Browser | Client | seconds to hours | ~MB per origin | `Cache-Control`, hard refresh |
| CDN | Edge (Cloudflare, Fastly) | seconds to days | GB+ | Purge API, surrogate keys |
| Application | Redis/Memcached | seconds to minutes | GB to TB | TTL, explicit delete |
| Database | Buffer pool, query plan cache | N/A (managed) | RAM size | DB internal |

**Cache on the way down:** browser hit = zero network. CDN hit = one edge hop. App cache hit = one network hop, no DB. DB cache hit = disk I/O avoided.

**Invalidation propagation:** when a write happens, you may need to invalidate all tiers. CDN purge APIs + explicit app-cache delete + instructing browsers via `Cache-Control: no-cache` on writes.

### 10.13 CDN vs Application Cache

| Dimension | CDN | Application Cache |
|---|---|---|
| Sharing | Shared across users | Per-user or per-session possible |
| Content type | Static, public | Dynamic, private OK |
| Location | Near user (edge) | Near app |
| Typical TTL | Hours to days | Seconds to minutes |
| Capacity | Very large | Large |
| Cost model | Per-request + bandwidth | RAM |
| Best for | Images, JS, CSS, public API responses | User profiles, feeds, session data |

**CDN wins:** offload bandwidth, sub-50ms latency to users globally, no app capacity consumed.

**App cache wins:** fine-grained invalidation, per-user content, lower round-trip for dynamic data the same user re-requests.

**Origin shielding.** CDN still hits origin on miss. Without proper cache headers + request coalescing, a cold CDN region can stampede your origin.

### 10.14 Security & Observability

**Security: what NOT to cache.**

- **Auth-sensitive data without identity scoping.** Cache key `user:profile` (no user ID) serves one user's data to another. Always scope by user/tenant.
- **Auth tokens / sessions in public CDN.** `Cache-Control: public` on an authenticated endpoint can leak tokens to next user.
- **PII without TTL controls.** Cached emails, SSNs, payment info bypass DB-level access controls and retention policies.

Rules:
- Cache only the fields needed for display.
- Encrypt sensitive values at rest in cache.
- Short TTL on PII.
- Include cache stores in GDPR / data-retention procedures.

**Observability: four key metrics.**

| Metric | Formula / Source | What it tells you |
|---|---|---|
| **Hit rate** | `hits / (hits + misses)` | Cache effectiveness. Target 90%+. |
| **Latency (p50/p95/p99)** | Cache op completion time | Network health, cache sizing. |
| **Eviction rate** | Evictions per second | Memory pressure. Spikes = working set grew. |
| **Memory usage** | Current / max | Capacity planning. >90% = resize soon. |

**Sample alert thresholds:**
- Hit rate drops below 85% for 5 minutes
- p99 latency exceeds 5ms
- Eviction rate 10× baseline
- Memory > 90% of configured max

**Cache without monitoring is a black box.** These metrics are non-negotiable for any production cache.

## 11. Data Storage

Databases are not one category. The landscape fragmented into specialized stores because no single engine handles every workload well. This section covers the shape of that landscape and how to choose.

### 11.1 The Role of Storage

Storage holds the application's long-term state. Everything a system knows between restarts lives here.

**Six common data types, roughly:**
- **Relational** (users, orders, inventory) — structured, normalized, high-consistency.
- **Document / JSON** (user profiles, product catalogs) — semi-structured, flexible schema.
- **Key-value** (session, cache, counters) — flat lookup, highest speed.
- **Blob / object** (images, videos, backups) — unstructured bytes.
- **Full-text** (product search, support tickets) — rich text indexed for queries.
- **Analytical** (event logs, metrics) — append-heavy, scan-oriented.

Most real systems use several. Polystore is the norm, not the exception.

### 11.2 SQL Databases (Relational)

**Examples:** PostgreSQL, MySQL, SQL Server, Oracle.

**What makes them SQL:**
- **Tables** with a fixed schema — columns with types, constraints, defaults.
- **Relations** via foreign keys. JOIN across tables at query time.
- **ACID transactions** — atomic, consistent, isolated, durable. Multi-statement writes either all succeed or all roll back.
- **SQL** — declarative query language, widely taught and tooled.

**Why they still dominate:**
- Strong consistency out of the box.
- Rich query expressiveness (aggregations, joins, window functions).
- Decades of operational knowledge. "Just use Postgres" is almost never wrong.

**Use for:**
- Money, inventory, orders — anything where you need transactional integrity.
- Anything with meaningful relations between entities.
- Moderate QPS workloads — a beefy Postgres handles 10K-100K QPS.

**Where they struggle:**
- Very high write throughput without sharding overhead.
- Schema evolution at large scale (ALTER TABLE locks or requires online tooling).
- Semi-structured data that would need wide tables with sparse columns.

### 11.3 NoSQL — Four Flavors

"NoSQL" is a terrible name (meaning "not-only SQL") for a category that actually splits into four sub-categories.

#### Key-Value Stores

**Examples:** Redis, Memcached, DynamoDB (mostly), Riak.

**Model:** flat map — key to value, no structure inside the value.

**Wins:**
- Fastest operations. Sub-millisecond reads at scale.
- Simple horizontal scale via hashing.
- Tiny operational footprint.

**Uses:**
- Session storage (keyed by session ID).
- Caches (keyed by cache key).
- Counters, rate limiters, feature flags.
- Real-time leaderboards (Redis sorted sets).

**Limits:** no rich queries. Everything is "get/set by key." Range queries require pre-computed indexes or secondary structures.

#### Document Databases

**Examples:** MongoDB, Couchbase, DynamoDB (with rich item shapes), Firestore.

**Model:** collections of JSON-like documents. Flexible schema — different documents can have different fields. Query by document ID or by indexed fields within documents.

**Wins:**
- No ORM translation layer. App stores what it works with (JSON ↔ object).
- Schema evolves without migrations — just add a new field.
- Good for per-entity access patterns.

**Uses:**
- User profiles, product catalogs, content management.
- Per-entity records where relations are shallow.

**Limits:** JOIN-like queries are clumsy. Cross-document transactions limited. Denormalization becomes the pattern, which means consistency on updates is harder (update both copies atomically? or accept drift?).

#### Wide-Column Stores

**Examples:** Cassandra, HBase, DynamoDB (with composite keys).

**Model:** rows indexed by partition key + sort key, with columns added dynamically per row. Can hold vast numbers of columns per row.

**Wins:**
- Hyper-scale write throughput via sharding by partition key.
- Time-series and per-entity-sequential access patterns are native.
- Tunable consistency (Cassandra: QUORUM, ONE, ALL).

**Uses:**
- Time-series (metrics, events).
- User-scoped feeds (`user_id` → sorted events).
- High-volume writes where relational overhead is prohibitive.

**Limits:** must know access patterns up front — you design the schema around your queries, not around the entities.

#### Graph Databases

**Examples:** Neo4j, ArangoDB, Amazon Neptune.

**Model:** nodes + edges with properties on both. Query language traverses relationships (Cypher, Gremlin).

**Wins:**
- Relationship-heavy queries ("friends of friends who also like jazz") are fast and readable.

**Uses:**
- Social graphs, fraud detection, recommendation engines, knowledge graphs.

**Limits:** smaller ecosystem, more specialized. Don't graph-store data that's not deeply relational.

### 11.4 SQL vs NoSQL — Choosing

The honest answer: **either works for most cases.** "Just use Postgres" is a valid default. Pick NoSQL when you have a specific reason.

**Pick SQL when:**
- You need transactions (banking, inventory).
- Data is highly relational with non-trivial joins.
- Consistency requirements are strong.
- You have moderate QPS.

**Pick NoSQL when:**
- You have genuinely semi-structured data (diverse product attributes, configs).
- You need horizontal write scale beyond what a single primary can handle.
- Your access patterns are simple, fast, and known up front.
- Eventual consistency is acceptable.

**Polystore reality.** A large ecommerce platform might use:
- Postgres for orders, payments, inventory (ACID).
- MongoDB for the product catalog (flexible attributes per category).
- Redis for sessions and cart (fast, TTL-based).
- Elasticsearch for search.
- S3 for product images.
- Snowflake for analytics.

Six stores, each chosen for one job. Operational cost is real, but the alternative — forcing all this into one DB — is worse.

### 11.5 OLTP vs OLAP

Two fundamentally different workloads that the same word "database" describes.

**OLTP — Online Transaction Processing.**

- Writes dominate or are balanced with reads.
- Queries touch few rows (single-record lookups, small scans).
- Latency-sensitive (user-facing).
- Row-oriented storage (all columns of one row together on disk).
- Examples: Postgres, MySQL, DynamoDB, MongoDB.

**OLAP — Online Analytical Processing.**

- Read-dominant, bulk scans across billions of rows.
- Aggregations, groupings, complex joins.
- Latency-tolerant (minutes to hours for dashboards).
- Column-oriented storage (all values of one column together — compresses well, skips unread columns).
- Examples: Snowflake, BigQuery, Redshift, ClickHouse, Druid.

**Why the split matters.** Running analytical queries against your OLTP database tanks production performance. The pattern: OLTP handles live traffic; ETL/ELT or CDC streams data to an OLAP warehouse for analysis.

**Comparison:**

| Dimension | OLTP | OLAP |
|---|---|---|
| Primary workload | Transactional writes + reads | Analytical queries |
| Typical query | One record or small range | Scan billions, aggregate |
| Latency | ms | seconds to minutes |
| Storage | Row-oriented | Column-oriented |
| Consistency | Strong, ACID | Eventually consistent (stale batch loads) |
| Schema | Normalized | Star / snowflake (denormalized) |
| Indexing | B-tree, hash | Column zone maps, bitmaps |

### 11.6 Blob / Object Storage

For files that don't fit relational or document models — images, videos, backups, build artifacts, logs.

**Examples:** Amazon S3, Google Cloud Storage, Azure Blob Storage, Cloudflare R2.

**Model:** flat keyspace (the "bucket"), each object is an opaque byte blob with metadata. Upload, download, delete. No in-place updates (you replace the whole object).

**Wins:**
- Durable (S3: 11 nines — 99.999999999%). You lose more data to other causes before S3 loses yours.
- Cheap (cents per GB-month).
- Infinite scale (no capacity to pre-provision).
- HTTP-accessible — serve directly from storage, or front with CDN.

**Uses:**
- User-uploaded content (images, videos, documents).
- Backups, audit logs.
- Static website assets.
- Data lakes for analytics.
- Build artifacts.

**Access patterns:**
- Direct client upload/download via signed URLs (skip app server).
- Lifecycle policies (auto-archive to cheaper tier after 90 days; delete after 7 years).

Storage classes: hot (frequent access) → warm → cold → archive (Glacier). Each step cheaper storage but slower/more expensive retrieval.

### 11.7 Full-Text Search

SQL `LIKE '%apple%'` does not scale. Full-text search engines do.

**Examples:** Elasticsearch, OpenSearch, Solr, Meilisearch, Typesense, Algolia.

**Model:** documents are indexed into an inverted index — for each token, the list of documents containing it. Ranking algorithms (TF-IDF, BM25) score results by relevance.

**Features beyond LIKE:**
- **Tokenization + stemming** — "running" and "runs" match "run."
- **Relevance ranking** — best match first, not just any match.
- **Faceting** — aggregate counts per category in the result set.
- **Typo tolerance** — fuzzy matching.
- **Synonyms** — "sofa" and "couch" treated as equivalent.

**Uses:**
- E-commerce search (product catalog).
- Log search (Elasticsearch is the "E" in ELK).
- Knowledge bases, documentation sites.
- Autocomplete / suggest.

**Pattern:** full-text index sits *alongside* the authoritative DB. Writes go to the DB, then to the index (CDC or app-level dual-write). Reads hit the index for search queries; fetch details from DB.

### 11.8 Storage Engines — How DBs Actually Write

Every DB has a storage engine that decides how data is laid out on disk. The two dominant approaches are B-trees and LSM trees.

#### B-Tree (the read-optimized default)

**Structure:** a balanced tree. Each node has keys (sorted) and pointers to child nodes. Leaves hold actual values (or pointers to them).

**Lookup:** O(log n) — descend from root, comparing at each node, until you find the key.

**Update in place:** find the key, modify the leaf, rewrite that page.

**Pros:**
- Fast reads — logarithmic depth.
- Supports range queries (leaves are sorted; walk forward).
- Mature, well-understood.

**Cons:**
- Random writes are expensive (update in place means write amplification when pages don't match disk sector boundaries).
- Fragmentation over time (needs periodic vacuum/rebuild).

**Used by:** Postgres, MySQL InnoDB, SQLite, most OLTP relational DBs.

#### LSM Tree (the write-optimized alternative)

**Structure:** incoming writes go to an in-memory sorted buffer (**memtable**). When the memtable fills, it's flushed to disk as an immutable **SSTable** (sorted string table). Over time, many SSTables accumulate; a background **compaction** process merges them.

**Lookup:** check memtable → check SSTables in order (newest first). Bloom filters skip SSTables that definitely don't contain the key.

**Pros:**
- Very fast writes — just an append to the memtable.
- Great for write-heavy workloads (time-series, logs, ingest pipelines).
- Compression-friendly (immutable SSTables compress well).

**Cons:**
- Read amplification (must check multiple SSTables).
- Space amplification during compaction.
- Write amplification from compaction (data written multiple times as it migrates between levels).

**Used by:** Cassandra, RocksDB, LevelDB, HBase, DynamoDB (internals).

#### SSTable Format

Sorted string tables — the on-disk format for LSM levels.

**Key properties:**
- Immutable. Written once, never modified.
- Sorted by key. Enables binary-search lookup.
- Usually paired with a sparse index (keys every N entries, fits in memory).
- Often has a Bloom filter header (fast "is this key definitely not here?" check).

**Lifecycle:** memtable fills → flushed to a new SSTable → periodically compacted with others (merge sort, keep latest value per key, discard deletions).

#### B-tree vs LSM — which to use?

| Workload | Better pick |
|---|---|
| Read-heavy, point lookups + small ranges | B-tree |
| Write-heavy, append-style ingestion | LSM |
| Mixed, transactional | B-tree (most RDBMSs) |
| Time-series, log ingestion | LSM |
| Need predictable latency | B-tree (fewer compaction hiccups) |

You rarely pick a storage engine directly. You pick a database; the engine is implied. But knowing which one is under the hood helps predict where the DB will be fast and where it will stall.

### 11.9 Choosing the Right Storage Solution

A practical decision tree:

1. **Is it transactional (money, inventory, counters that must be exact)?** → Start with SQL.
2. **Is it a file (image, video, document)?** → Blob / object storage.
3. **Is it a search query (text matching, relevance)?** → Full-text search.
4. **Is it analytical (scans, aggregations, reports)?** → OLAP (columnar warehouse).
5. **Is it high-velocity, simple key lookup (sessions, caches, counters)?** → Key-value.
6. **Is it flexible-schema entity data (user profiles, catalog)?** → Document DB.
7. **Is it relationship-heavy (social graph, fraud network)?** → Graph DB.

When in doubt, SQL. When specifically solving a problem SQL struggles with, pick the specialized store.

## 12. Database Scaling — Partitioning, Replication, Consistent Hashing, CDC

Most systems don't hit app-server scaling limits — they hit DB limits. This section covers the DB-specific scaling toolkit.

### 12.1 The Database Scaling Toolkit

Same sequence as general scaling, DB-specific:

1. **Vertical.** Beefier DB instance. Fast fix, bounded ceiling.
2. **Read replicas.** Primary handles writes; replicas handle reads. Linear read scaling.
3. **Partitioning / sharding.** Split data across multiple DBs. Write scaling.
4. **Multi-leader / leaderless.** More exotic. Accept more complexity for more flexibility.

Each step compounds: you can have a sharded cluster where each shard has replicas.

### 12.2 Partitioning (Sharding)

Split data across multiple DB instances. Each instance (shard) holds a slice; cross-shard queries are expensive or impossible.

**Horizontal partitioning.** Split rows. `users 1-1M` on shard 1, `users 1M-2M` on shard 2. Most common meaning of "sharding."

**Vertical partitioning.** Split columns. Frequently-accessed columns on one table; rarely-accessed BLOBs on another. Less common.

**Functional partitioning.** Different services own different tables. Overlaps with microservices decomposition.

### 12.3 Sharding Strategies

**Range-based.** Partition by value range. `user_id 1-1M → shard A, 1M-2M → shard B`.
- Pros: simple, supports range queries (`SELECT * WHERE created_at BETWEEN ...`) within a shard.
- Cons: hot shards if data skews (most activity in recent user IDs). Manual rebalancing.

**Hash-based.** `shard = hash(user_id) % N`.
- Pros: even distribution.
- Cons: range queries span all shards (scatter-gather). Resizing is catastrophic (almost every key moves).

**Consistent hashing.** (See §12.6.) Solves the resizing problem.

**Directory-based (lookup table).** Central service maps key → shard.
- Pros: flexible (can rebalance by updating the table).
- Cons: lookup service is single point of failure; adds a hop.

### 12.4 Shard Key Selection

The shard key determines which data lands where. Get it wrong and you're stuck.

**Criteria for a good shard key:**

1. **High cardinality.** Many distinct values, so data distributes.
2. **Even distribution.** No single value should hold the bulk of traffic.
3. **Matches access patterns.** If you always query by user_id, shard by user_id — keeps each query to one shard.
4. **Stable.** Key shouldn't change over the row's lifetime (re-sharding is painful).

**Common choices:**
- User ID (great for user-scoped apps).
- Geographic region (compliance + latency wins, but uneven populations cause skew).
- Tenant ID (SaaS multi-tenancy).
- Time bucket (time-series, but older data gets cold — some shards go idle).

**Hot shards.** When one value dominates (Taylor Swift's tweets on `user_id` shard), that shard becomes a bottleneck. Mitigations: sub-shard hot keys, cache them harder, special-case in app.

### 12.5 Rebalancing — The Hard Problem

When you add or remove shards, data has to move. Rebalancing strategies:

**Fixed number of partitions.** Pre-create many small partitions (say 1000) on few machines. When you scale out, redistribute partitions without moving data within them. Elasticsearch does this.

**Dynamic partitioning.** Partitions split when they grow past a threshold; merge when they shrink. HBase, Cassandra do this. Harder operationally.

**Partitioning by hash with consistent hashing.** (See §12.6.) Minimal data movement on resize.

**Backfilling during rebalance.** Keep reads/writes on old shards while copying to new; switch over once copy completes; dual-write window handles in-flight changes.

### 12.6 Consistent Hashing

The key technique for distributing keys across nodes with minimal churn on resize.

**The problem with modulo.** `shard = hash(key) % N`. Change N from 3 to 4, and ~75% of keys map to a different shard. Mass key movement. Cache invalidation storm. Partition rebalance from hell.

**The ring.**

Map both keys and nodes onto a circular range (0 to 2^32-1).

```
        Node A (position 10)
         /
Key (hash 15) → clockwise → lands on Node B
         \
         Node B (position 20)
             \
             Node C (position 30)
```

Each key walks clockwise around the ring until it hits the first node. That node owns the key.

**Why this matters.** Adding a new node claims the section between itself and the previous node. Only keys in that section move. Removing a node hands its section to the next clockwise node. Again, only the displaced section moves.

**Expected movement.** Adding one node to an N-node ring moves approximately 1/(N+1) of keys. Removing one moves 1/N. Both way better than modulo.

**Virtual nodes.** Each physical node claims many positions on the ring (say, 100 each). Distributes load more evenly (naive 3-node rings can have one node with a much larger section). Also smooths rebalancing.

**Where you see it.**
- Redis Cluster (with a twist — uses fixed 16384 hash slots instead of a ring, but same idea).
- Cassandra partitioner.
- DynamoDB.
- Content delivery networks (key = URL, node = edge server).
- Distributed caches (Memcached's ketama client).

### 12.7 MySQL Partitioning (concrete example)

MySQL supports native partitioning at the table level:

```sql
CREATE TABLE comments (
  comment_id INT NOT NULL,
  page_id INT NOT NULL,
  user_id INT NOT NULL,
  content TEXT,
  created_time DATETIME
)
PARTITION BY RANGE (year(created_time)) (
  PARTITION p2019 VALUES LESS THAN (2020),
  PARTITION p2020 VALUES LESS THAN (2021),
  PARTITION p2021 VALUES LESS THAN (2022),
  PARTITION p2022 VALUES LESS THAN (2023)
);
```

Now `SELECT * FROM comments PARTITION (p2021)` queries only the 2021 data. Old partitions can be detached and archived without downtime.

This is partitioning *within* a single MySQL instance — helpful for query performance and archival, but doesn't scale beyond one box. True horizontal scale requires sharding across instances (Vitess, Citus, application-level sharding).

### 12.8 Replication

Replication keeps copies of the same data across multiple machines. Why:

- **Read scaling.** Reads can fan out to replicas.
- **Availability.** A replica can take over when the primary dies.
- **Geographic latency.** Replicas in the user's region reduce round-trip time.

### 12.9 Replication Architectures

**Single-leader (leader-follower).**
```
Writes ──> Leader ──async──> Follower 1
                    ──async──> Follower 2
Reads ──> Leader or any Follower
```
Most common. Simple mental model. Failover moderate complexity.

- **Synchronous replication.** Leader waits for follower acks before confirming write. Strong consistency, slower writes.
- **Asynchronous replication.** Leader confirms immediately; followers catch up. Fast writes, replication lag — reads from followers may be stale.
- **Semi-sync.** Leader waits for at least one follower (any, or specific). Balance of above.

**Multi-leader.**
```
Region A Leader ──> Region A Followers
   ↕ (cross-region async replication)
Region B Leader ──> Region B Followers
```
Writes can go to either leader. Each region serves local traffic at full speed. Conflict resolution is complex (what if both regions write to the same row at the same time?).

- Use: multi-region deployments where write latency matters.
- Tools: MySQL with Galera, PostgreSQL with BDR, Cassandra (per-row leader-less-ish).

**Leaderless (Dynamo-style).**
```
Writes go to any node, replicated to N nodes with quorum.
Reads check R nodes and merge.
W + R > N ensures reads see recent writes.
```
- Use: high-availability, no single point of failure.
- Tools: Cassandra, Riak, DynamoDB (to some extent).
- Tradeoffs: complex conflict handling, eventual consistency by default.

### 12.10 Replication Lag

In async replication, followers lag the leader. A read immediately after a write may not see that write.

**User-visible symptoms:**
- User posts a comment, refreshes, doesn't see it.
- User changes settings, the next page still shows old settings.
- Account balance updates inconsistently.

**Mitigations:**
- **Read-your-writes consistency.** After a write, pin that user's reads to the leader for a brief window.
- **Monotonic reads.** Always read from the same replica (sticky sessions for reads). Prevents seeing "time go backwards" across requests.
- **Synchronous replication on critical paths.** Accept the latency hit where freshness matters (payments, inventory).
- **CDC + message queue.** Downstream systems subscribe to changes; eventually consistent with bounded staleness.

### 12.11 Failover

When the leader dies, a follower must take over. This is where replication gets operationally tricky.

**Detection.** Heartbeats. If the leader misses N beats, mark it down. Too aggressive → false failovers. Too lax → long downtime.

**Election.** Which follower gets promoted? Usually the one with the most up-to-date data.

**Old leader returning.** The failed leader may rejoin with stale writes not yet replicated. These need reconciliation (usually discarded — "last writer wins") or the leader needs to roll back to the safe state.

**Split brain.** Network partition separates leader from followers. Followers elect a new leader. Partition heals — now there are two leaders. One must yield; data written to the wrong leader during the split is lost or must be merged.

**Quorum-based approaches (Raft, Paxos).** Reduce split-brain risk by requiring majority agreement for leadership and commits. Used in etcd, Consul, CockroachDB.

### 12.12 Hands-on — Redis Leader-Follower

```bash
# Start leader on port 6379 (default)
redis-server

# Start follower on port 6380, pointed at leader
redis-server --port 6380 --replicaof 127.0.0.1 6379
```

```python
import redis
primary = redis.StrictRedis(host='localhost', port=6379, db=0)
replica = redis.StrictRedis(host='localhost', port=6380, db=0)

primary.set('key', 'value')
print(primary.get('key'))  # -> value
print(replica.get('key'))  # -> value (via replication)

# Writing to replica fails
replica.set('key', 'value')  # ReadOnlyError
```

The follower is read-only. On leader crash, with Redis Sentinel or Cluster configured, the follower can be promoted automatically.

### 12.13 Change Data Capture (CDC)

**The dual-write problem.** An app writes to both the DB and a downstream system (search index, cache, analytics). Failure modes:

- **Partial failures.** DB write succeeds, search write fails. Data diverges.
- **Race conditions.** Two updates arrive at DB in order A→B but reach search as B→A. Final states don't match.
- **Tight coupling.** Every write path has to know about every downstream. Adding analytics means changing every writer.

**CDC is the answer.** Instead of writing twice, write once (to DB) and let downstream systems subscribe to the DB's change log.

**Architecture:**
```
App ──write──> Database ──> WAL / binlog
                                   │
                             (CDC connector: Debezium)
                                   │
                                   ↓
                              Message broker (Kafka)
                                   │
          ┌────────────────────────┼────────────────────────┐
          ↓                        ↓                        ↓
        Search                   Cache                  Analytics
```

- Database writes to its own transaction log (Postgres WAL, MySQL binlog) for durability anyway.
- CDC connector (Debezium is canonical) tails the log and publishes change events to Kafka.
- Downstream consumers subscribe — search, cache, analytics, warehouse.

**Why CDC wins:**
- **Decoupling.** App doesn't know about downstreams. New consumer = new subscription, no app change.
- **Ordering.** Changes stream in the order they were committed. No race conditions.
- **Completeness.** Every committed change shows up. Partial failures in app can't lose data downstream.
- **Efficiency.** Tailing the log is cheap; only modified rows stream. No polling, no full scans.

**Tradeoffs:** operational complexity (Debezium, Kafka, schema evolution). For a simple app with one downstream, dual-writes + reconciliation might suffice. CDC becomes essential when:
- Multiple downstream consumers
- Ordering matters
- You can't change app code

**Common tools:**
- **Debezium** — open source, supports MySQL, Postgres, MongoDB, others. Publishes to Kafka.
- **AWS DMS** — managed CDC for AWS databases.
- **Fivetran, Airbyte** — CDC connectors for warehouse loading.

### 12.14 Backfill & Reprocessing

CDC streams forward from a starting offset. To include historical data, run a **backfill**:

1. Snapshot the DB (`pg_dump` or read full tables).
2. Pipe into Kafka.
3. Consumers process the backfill, then catch up to live CDC stream.

**Reprocessing** applies the same logic — if you change how the downstream processes events, replay from an earlier Kafka offset. Kafka's retention makes this possible; most other queues don't.

## 13. Message Queues & Async Communication

When one service needs to talk to another, the choice is synchronous (wait for response) or asynchronous (fire-and-forget via a message). Both have a place. The wrong choice cascades failures.

### 13.1 The communication problem

Monolith: call a function. Microservices: cross a network boundary. Now you face latency, partial failures, protocol choices, discovery of where the target service lives, and coupling of availability.

**Two fundamental modes:**

- **Synchronous.** Caller sends a request and waits for a response. Caller blocks. Simple mental model. Examples: REST, gRPC.
- **Asynchronous.** Caller sends a message and moves on. Response (if any) comes later. Examples: message queues, pub/sub.

### 13.2 Synchronous Communication — REST, gRPC

**REST (HTTP + JSON).**

- Human-readable, universally tooled, works across languages and runtimes.
- Uses standard HTTP verbs and status codes.
- Most common for external-facing APIs; common for internal too.
- Costs: HTTP/JSON overhead (especially for chatty internal communication).

**gRPC (HTTP/2 + Protobuf).**

- Binary protocol, much lower overhead than REST.
- Strongly typed contracts (`.proto` files generate client + server stubs).
- Streaming support (server push, bidirectional).
- Best for internal service-to-service in polyglot environments.
- Costs: less tooling maturity, harder to debug over the wire, hard to call from a browser.

**When to pick:**

| Dimension | REST | gRPC |
|---|---|---|
| External API | ✓ | ✗ (no browser) |
| Internal, polyglot services | Works | Better |
| Latency-critical | OK | Better (binary) |
| Streaming | Hacky (SSE, long-poll) | First-class |
| Debugging / tooling | Mature | Improving |

### 13.3 The Simplicity Advantage (and the Coupling Trap)

Synchronous calls match how developers think: "call this function, get the result." That simplicity is real and valuable.

The trap: **synchronous coupling of availability.** If Service A calls Service B synchronously, then A is down whenever B is down. Chain three services and your uptime multiplies: 99.9% × 99.9% × 99.9% = 99.7%. Each hop costs you nines.

The fix isn't always to go async. It's often:
1. Cache B's responses in A (reduce dependency)
2. Add resilience patterns (timeout + retry + circuit breaker + fallback — see §21)
3. Make truly synchronous work small; push everything else async

### 13.4 Asynchronous Communication — Messaging

A **message** is a packet with a body, routing info, metadata (headers, correlation ID, timestamp), and a recipient specification (queue name, topic, routing key).

A **message broker** (RabbitMQ, Kafka, SQS, Redis Streams) is the infrastructure that accepts messages from producers, stores them durably, and delivers them to consumers.

**Three core messaging patterns:**

**One-way fire-and-forget.** Producer sends, doesn't care about response.
```
Service A ──message──> Queue ──> Service B
```
Use: notifications, logging, events.

**One-way with feedback channel.** Producer sends; eventual response comes back via a separate channel.
```
Service A ──request──> Queue_req ──> Service B
Service A <─response── Queue_resp <── Service B
```
Use: long-running jobs (image processing), batch workflows.

**Two-way async request-response.** Correlation ID ties request to response. Caller waits on the response queue.
```
Service A ──request (corr_id=42)──> Service B
Service A <──response (corr_id=42)── Service B
```
Use: when sync feels right but you want producer to survive consumer downtime.

### 13.5 Two Broker Architectures — AMQP vs Log-Based

Message queues split into two fundamentally different architectures.

**AMQP-style (RabbitMQ, traditional).**

- Messages flow through the broker once. When a consumer acknowledges a message, it's **deleted** from the queue.
- Rich routing (exchanges, bindings, routing keys). Supports complex topologies (fan-out, topic-based, header-based).
- Low-latency, low-throughput (relative to log-based).
- Good for transient workflows where messages have a specific intended consumer.

**Log-based (Kafka, Kinesis, Pulsar).**

- Messages are **appended to an immutable log** indexed by offset. Multiple consumers read at their own offsets — the log is shared.
- Messages persist (for a configurable retention: days, weeks, forever). A new consumer can replay from the beginning.
- Partitions enable parallel consumption: one partition = one consumer in the group at a time.
- Very high throughput (millions of msgs/sec per broker cluster).
- Good for event sourcing, stream processing, audit logs, system-of-record replay.

**Comparison:**

| Aspect | AMQP (RabbitMQ) | Log-based (Kafka) |
|---|---|---|
| Storage model | Queue — deleted on ack | Log — retained for window |
| Replay | No (once consumed, gone) | Yes (rewind to any offset) |
| Throughput | 10Ks msgs/sec | Millions msgs/sec |
| Routing | Rich (exchanges, bindings) | Simple (topic + partition key) |
| Consumers | Compete for messages | Each consumer has its own offset |
| Best for | Task queues, RPC, workflows | Event streams, analytics, replay |

### 13.6 Kafka — the canonical log-based broker

**Core concepts:**

- **Event.** A single record — JSON, Avro, or Protobuf-encoded. Key + value + timestamp.
- **Topic.** A named stream of events, like a table. Append-only log.
- **Partition.** A topic is split into N partitions. Each partition is an ordered log. Events with the same key go to the same partition (preserving per-key ordering). No ordering guarantee across partitions.
- **Broker.** A Kafka server. A cluster has many brokers. Partitions are distributed across brokers.
- **Replication.** Each partition has a leader (handles reads/writes) + N followers (replicate). If the leader dies, a follower gets promoted.
- **Producer.** Writes events to topics. Chooses partition via key hash (or explicit assignment, or round-robin if no key).
- **Consumer + Consumer Group.** Consumers read from topics. In a group, partitions are divided among members; one partition is consumed by exactly one member at a time. Scales by adding consumers up to the partition count.
- **Offset.** Position in the log. Consumers track their offset per partition. Commits allow resuming after crash/restart.

**Key operational quirks:**
- Number of consumers in a group ≤ partition count (extras sit idle).
- Adding partitions later is possible but breaks key-to-partition mapping for existing keys.
- Retention is a function of disk, not consumption — a message sits in the log until its retention window passes, whether consumed or not.

**Ecosystem:**
- **Kafka Connect.** Source/sink connectors (DB → Kafka, Kafka → Elasticsearch). Avoids writing glue code.
- **Schema Registry.** Central schema store; producers register schemas, consumers validate. Prevents silent data-shape drift.
- **Kafka Streams / Flink.** Stream processing on top of Kafka.

**Setup essentials:**
- Multiple partitions for parallelism (default-8 is a starting point; tune).
- Multiple consumers in a group to parallelize work.
- Replication factor ≥ 3 for production durability.

### 13.7 Message Queue Patterns — 1:1, Pub/Sub, Competing Consumers, Fan-Out

**Point-to-point (1:1, competing consumers).**
```
Producer ──> Queue ──> [Consumer1, Consumer2, Consumer3]
```
Many consumers share one queue. Each message is delivered to exactly one consumer. Use: work distribution (image processing, order fulfillment).

**Pub/Sub (1-to-many, fan-out).**
```
Producer ──> Topic ──> [Subscriber1]
                  └──> [Subscriber2]
                  └──> [Subscriber3]
```
Every subscriber gets every message. Use: notifications, cache invalidation broadcast, analytics tapping into order events.

**Routing / topic-based.** Messages tagged with routing keys; subscribers select patterns. `orders.created.*` delivers to subscribers interested in all new orders regardless of region.

**Priority queues.** Some messages are more urgent; brokers reorder delivery. Use: VIP customer orders, retry of failed high-priority jobs.

**Delayed / scheduled.** Messages delivered at a future time. Use: scheduled reminders, rate-limited retries.

**Dead letter queue (DLQ).** Messages that fail repeatedly (poison messages) are moved to a separate queue for inspection, not lost. Use: catch-all for bad payloads, downstream failures.

### 13.8 Redis as a Queue (lightweight use case)

Redis supports queue patterns via:
- **Lists** — LPUSH/BRPOP for simple FIFO queues.
- **Streams** (Redis 5+) — log-based queue similar to Kafka but in-memory-first.
- **Pub/Sub channels** — fire-and-forget, no persistence.

Works well for lightweight workloads (background job queues, image download workers). Doesn't scale to Kafka-level throughput or offer the same durability guarantees, but operational simplicity is a huge win for small teams.

### 13.9 Service Discovery

In microservices, services need to find each other. "Service B is at what IP?" is a non-trivial question when Service B has 20 instances that come and go.

**Two flavors:**

**Client-side discovery.** Client queries a registry (Consul, Eureka, Zookeeper) for healthy instances of Service B, then load-balances among them itself.
- Pros: no extra hop, client picks its own LB algorithm.
- Cons: every client language needs library support.

**Server-side discovery.** Client sends request to a well-known load balancer / API gateway, which queries the registry and forwards.
- Pros: language-agnostic clients.
- Cons: extra hop, LB becomes critical infrastructure.

**Service Registry.** The source of truth. Instances register themselves on boot (self-registration) or are registered by the platform (Kubernetes Services + endpoints).

**Health checks.** Registry probes each registered instance; unhealthy ones are removed from rotation.

**Kubernetes specifics.** Built-in service discovery via DNS. `service-name.namespace.svc.cluster.local` resolves to the service's ClusterIP. kube-proxy forwards to healthy pods. Most Kubernetes apps get this "for free."

**Beyond Kubernetes.** Consul, Eureka (Netflix), Zookeeper, etcd, AWS Cloud Map. Typically paired with the API gateway or service mesh (Istio, Linkerd) for routing.

### 13.10 Choosing: sync vs async

Not a religion. Two decision axes:

1. **Does the caller need the result to continue?** If yes → sync (with resilience). If no → async.
2. **Is the downstream work fast and reliable?** If yes → sync is fine. If slow or flaky → async absorbs the pain.

A real system uses both. Order service: sync call to payment (caller needs the result), async emit to fulfillment queue (caller doesn't wait on shipping).

**Rule of thumb:** lean async for anything whose unavailability shouldn't block the user, anything slow, anything fan-out. Keep sync for fast, reliable, caller-blocking operations.

## 14. Batch & Stream Processing

*Populated during Big Data pass.*

---

# Part IV — API Layer

## 15. API Gateway

A single entry point in front of a microservices backend. Clients talk to the gateway; the gateway fans out to services.

**Why have one.** Without a gateway, clients need to know about every service, handle authentication for each, deal with heterogeneous protocols, and re-implement cross-cutting concerns. A gateway centralizes all of that.

**Key features.**
- **Request routing.** Path-based dispatch to the right service.
- **Load balancing.** Across service instances.
- **Authentication and authorization.** Centralized, so services don't reimplement it.
- **Rate limiting and throttling.** Protects the backend.
- **Protocol translation.** Client speaks HTTP/REST; services speak gRPC internally.
- **Request and response transformation.** Shape data for clients, hide internal shapes.
- **Monitoring and analytics.** Centralized request logs, traces, per-client usage.

**Solutions.**
- Cloud-based: AWS API Gateway, Google Cloud Endpoints, Azure API Management
- Open source: Kong, Tyk, Ambassador
- Self-hosted / enterprise: Nginx Plus, WSO2

**Tradeoffs.** A gateway is a single point of failure you need to make redundant and a latency hop you need to budget for. In very small systems it's overhead. In multi-service systems it's basically mandatory.

## 16. REST Design

REST is one of many possible API design styles. Its principles:

- **Stateless.** Each request carries all info needed to process it. No server-side session state.
- **Resource-based.** URIs represent resources, not actions. `/books/123` not `/getBook?id=123`.
- **Uniform interface.** Standard HTTP methods: GET (read), POST (create), PUT/PATCH (update), DELETE (delete).
- **Standard status codes.** 200 OK, 201 Created, 400 Bad Request, 404 Not Found, 500 Internal Error.

**Best practices.**
- **Use the right method.** Don't POST for everything.
- **Use the right status code.** 200-for-errors breaks clients and makes monitoring useless.
- **Consistent plurality.** `/books/123`, not `/book/123`. Pick one and stick with it.
- **Consistent naming.** `/books/123/authors` follows predictably from `/books`. Inconsistency breeds bugs.
- **Always paginate list endpoints.** Returning all rows in one response is a DoS waiting to happen.

**Twitter timeline example.** `GET /users/{id}/timeline` returns recent tweets (and retweets, and mentions) with pagination. Payload: `{ id, user, content, timestamp, media[], retweetOf?, mentions[] }`.

## 17. Authentication — API Keys, Sessions, JWT

Authentication answers *"who are you?"* — different from authorization (*"what can you do?"*).

### API Keys

**What it is.** Application identity. A long random string issued to a client application, sent in `Authorization: Bearer <key>` or similar.

**When to use.** Service-to-service calls. Programmatic access. No user context needed.

**Pros.** Easy to rotate. Simple to implement. No per-user state on the server.

**Cons.** Coarse-grained (one key = one app's full access). No user-level audit trail. If leaked, attackers get everything that key could do.

### Sessions

**What it is.** Server-side state keyed by a session ID. Client stores the session ID in a cookie; every request the server looks up the session.

**When to use.** Rich user context. Traditional web apps with server-rendered pages. You need immediate revocation (logout = delete session server-side).

**Pros.** Rich context per user. Immediate revocation. Well-understood security model.

**Cons.** Scales worse — either sticky sessions (a specific user goes to a specific server) or shared session store (Redis, DB). Sticky sessions fight load balancing; shared stores add infrastructure.

### JWT (JSON Web Tokens) — self-contained tokens

**What it is.** A signed token containing user ID, claims, permissions, and expiration. Client sends it in `Authorization: Bearer <jwt>`. Server verifies the signature and trusts the contents without looking anything up.

**When to use.** Horizontal scale. Stateless microservices. Clients across domains (mobile, SPA, third-party).

**Pros.** Stateless — no shared session store needed. Self-describing — the service can read claims without a DB lookup. Works well across services (JWT issued by auth service, consumed by N other services).

**Cons.** Hard to revoke before expiration (the token is valid until its `exp` claim, even if the user's account is deleted). Workarounds: short expiry + refresh tokens, or an expensive revocation list.

### Comparison

| Pattern | Who issues | Where state lives | Immediate revocation | Horizontal scale |
|---|---|---|---|---|
| API Key | Server | Server (key → app mapping) | Yes (revoke key) | OK |
| Session | Server | Server (session store) | Yes (delete session) | Sticky or shared store |
| JWT | Auth server | Client (token payload) | Hard (short expiry + refresh) | Excellent |

**Hybrid is common.** GitHub uses all three: API keys for CLI tools, sessions for web login, JWT for internal service-to-service.

## 18. Authorization — RBAC, ABAC, OAuth

Authorization answers *"what can you do?"* — assumes authentication already happened.

### RBAC — Role-Based Access Control

**Shape.** Users have roles. Roles have permissions. Permission = (action, resource).

**When to use.** Simple, coarse-grained domains. Most enterprise software. Clear org hierarchy.

**Pros.** Easy to reason about. Easy to audit. Well-supported in frameworks.

**Cons.** Combinatorial explosion when roles multiply ("editor in project X but reviewer in project Y"). Role proliferation over time.

### ABAC — Attribute-Based Access Control

**Shape.** Permissions depend on attributes of user, resource, and context. A policy engine evaluates rules at request time.

Example: "Users with clearance ≥ SECRET can read documents with classification ≤ SECRET, but only if the document's project matches one of the user's projects, and only during business hours."

**When to use.** Fine-grained policies. Regulated industries. Per-row authorization. Multi-dimensional access rules.

**Pros.** Fine-grained and dynamic. Policies expressible as code.

**Cons.** Harder to debug. Performance cost of policy evaluation on every request. Requires consistent attribute sourcing.

### OAuth — Delegated Authorization

**Shape.** Third parties get scoped permissions on behalf of users. "Lark wants to read your Google Docs" — user approves scopes (`docs.read`, `email.read`), Google issues a token scoped to those permissions.

**Flow.**
1. User initiates action in third-party app (Lark)
2. Third-party redirects user to the resource owner (Google) with requested scopes
3. User authenticates + approves scopes
4. Resource owner issues a token to third-party scoped to those permissions
5. Third-party calls resource APIs with that token

**When to use.** Any time a third party needs access to user resources on another service. Google / Facebook / GitHub login. Integrations.

**Pros.** Users don't share passwords. Granular scope control. Revocable.

**Cons.** More complex flows. Token management overhead. Phishable if users don't understand scope prompts.

### Choosing

| Pattern | Complexity | Flexibility | Use case |
|---|---|---|---|
| API Key | Low | Low | Internal service identity |
| RBAC | Medium | Medium | Enterprise apps, clear hierarchy |
| ABAC | High | Very high | Fine-grained, regulated |
| OAuth | Medium-High | Medium-High | Third-party integrations |

Production systems often combine: RBAC for coarse app permissions + ABAC for fine-grained data access + OAuth for third-party integrations.

## 19. Pagination — Offset, Cursor, Time-Series

Never return all rows. Paginate.

### Offset-based

```sql
SELECT * FROM tweets ORDER BY created_at DESC LIMIT 20 OFFSET 40
```

**Pros.** Dead simple. Supports arbitrary jumps ("page 5").

**Cons.** Degrades on large offsets (DB walks all skipped rows). Unstable under inserts — new rows can shift everything and cause duplicates or skips.

**When to use.** Admin dashboards. Small datasets. Stable data.

### Cursor-based (Keyset)

```sql
SELECT * FROM tweets WHERE created_at < ? ORDER BY created_at DESC LIMIT 20
```

The cursor is an opaque token encoding "where we were last." Response includes the next cursor.

**Pros.** Scales to arbitrary dataset size (uses the index). Stable under inserts.

**Cons.** Can't jump to arbitrary page. Cursor must be carefully designed (stable sort key, tiebreaker for equal sort values).

**When to use.** Social feeds. Activity logs. Anywhere users scroll forward indefinitely.

### Time-Series

```sql
SELECT * FROM events WHERE timestamp BETWEEN ? AND ? ORDER BY timestamp ASC
```

Keyset pagination specialized for timestamp-ordered data.

**Pros.** Self-sorting. Efficient on time-indexed tables. Natural for event streams.

**Cons.** Requires stable time ordering. Clock skew between producers can cause misordering.

**When to use.** Monitoring dashboards. Log viewers. Time-range queries.

### Real-world considerations

- **Consistency.** If a row is deleted during pagination, offset-based pagination shifts everything; cursor-based just skips that row.
- **Performance.** Cursor + right index = O(log n). Offset with large offsets = O(n).
- **Response format.** Include `{ data, nextCursor?, total? }`. Don't make clients guess.
- **Stable sort.** For cursor pagination, include a tiebreaker (`ORDER BY created_at DESC, id DESC`) so equal timestamps don't cause dupes.

---

# Part V — Scaling & Resilience

## 20. How to Scale a System

A toolkit of specific techniques, ordered by when you typically reach for them.

### Decomposition

Split a monolith into services when components have different scaling profiles or deploy cadences. Don't decompose prematurely.

### Vertical Scaling

Move to a bigger machine. AWS: `t3.micro` (2 vCPU, 1GB RAM) → `t2.xlarge` (64 vCPU, 768GB RAM).

**Pros.** Simple — no code changes.

**Cons.** You eventually run out of machine. Cost scales super-linearly at the high end.

### Horizontal Scaling

Add identical instances behind a load balancer. Requires stateless services (or externalized session state).

**Pros.** Scales linearly until the DB becomes the bottleneck. Fault tolerant.

**Cons.** Requires stateless design. Load balancer and service discovery infrastructure.

**The typical evolution:**
1. **Single server.** App + DB on one $5/mo VPS. Deploy, DNS, done. Plenty for 100 QPS.
2. **Vertical scaling.** Bigger VPS. $10/mo → $100/mo. Works until the box hits limits (AWS max x1.16xlarge has 64 vCPU / 976 GiB — you will run out of server eventually).
3. **Horizontal scaling.** Multiple smaller boxes behind an LB. The LB forwards requests to healthy backends. Adds deployment complexity but scales further.
4. **DB becomes bottleneck.** Next move: read replicas, then sharding.

The step from single-box to horizontal usually forces **externalizing session state** (otherwise users get logged out when their sticky box dies). That's why statelessness comes before horizontal scale — see next subsection.

### Stateless vs Stateful Services

A **stateless** service treats every request as self-contained. No per-user state lives in the service process; it all comes from the request itself or an external store (DB, cache, session store).

A **stateful** service holds state in-process — session data, in-memory caches, live connections.

**Why stateless is the default for scaling:**
- Any instance can serve any request → trivial load balancing
- Instances can die without losing user work → trivial failover
- Auto-scaling just adds/removes boxes without warm-up complexity

**Common stateful patterns (and how to make them stateless):**

| Stateful | Stateless equivalent |
|---|---|
| In-memory session | Session store (Redis) keyed by session ID cookie |
| Sticky sessions (LB routes to same box) | Stateless app + shared session store |
| In-process cache of user data | Shared cache cluster (Redis) |
| WebSocket connection state | Connection broker (e.g., Redis pub/sub, message queue) |

**Migration recipe:** identify all in-memory per-user state → move to external store → change code to fetch on request → verify → remove sticky-session config.

**When statefulness is inherent** (long-lived connections, gaming, real-time collaboration), the design pattern is "stateful shards" — partition users across instances, each instance owns its shard, coordination via distributed coordination (Zookeeper, etcd, or the cluster's own gossip).

### Auto Scaling

Scale the instance pool based on load signals. Adds capacity during spikes, removes it during valleys.

**Types:**
- **Reactive (threshold-based).** Scale when a metric crosses a line. Classic: CPU > 70% → add one instance; CPU < 30% → remove one. Also: RPS, queue depth, response time, custom metrics.
- **Scheduled.** Known recurring patterns — scale up at 8am weekdays, scale down at 8pm. Cheapest for predictable traffic.
- **Predictive.** ML-based on historical patterns. Scales proactively ahead of anticipated load. Still evolving; available on AWS, GCP.

**Key parameters:**
- **Cooldown period.** Minimum time between scaling events. Prevents flapping (scale up, scale down, scale up, repeat) when metric hovers at threshold.
- **Warm-up time.** How long a new instance takes before it's serving real traffic (boot, code load, cache warm). During warm-up, it counts in the pool but shouldn't get traffic yet.
- **Min / max capacity.** Floors and ceilings. Floor = baseline capacity for off-peak. Ceiling = cost cap.

**Only works well for stateless services.** Stateful services pay rebalancing cost on scale events (moving data, migrating connections) — auto-scaling them rarely pays off.

**Tradeoff.** Aggressive scaling = responsive but overshoots and costs more. Conservative scaling = cheaper but risks falling behind during fast spikes. Tune based on acceptable latency degradation during scale-out lag.

**Cloud-managed examples:**
- AWS Auto Scaling Groups + target tracking policies
- GCP Managed Instance Groups with autoscaler
- Kubernetes Horizontal Pod Autoscaler

### Serverless — The Evolution Endpoint

The progression of compute abstractions:

**Physical → VM → Container → Serverless**

Each step smaller, denser, more abstracted.

- **Physical servers** — you own the box.
- **Virtual machines** — hypervisor slices hardware; you still manage the OS.
- **Containers** — OS shared; you manage the runtime and app.
- **Serverless functions** — platform manages everything; you upload code.

**Serverless tradeoffs:**

*Wins:* auto-scaling from zero, per-invocation pricing, no server management, fast iteration.

*Losses:* cold starts (50-500ms for first invocation), vendor lock-in, limited runtime control, debugging is harder, not good for long-running connections, per-invocation cost gets expensive at very high volume.

**When serverless is the right answer:**
- Event-driven, infrequent or spiky workloads (form processing, cron jobs, webhooks)
- New products where scale is unknown
- Glue code between services

**When it isn't:**
- Long-running connections (WebSockets, streaming)
- Very latency-sensitive (cold starts kill p99)
- Heavy CPU workloads at sustained high volume
- Stateful workloads (forces you to externalize everything)

Modern serverless platforms (AWS Lambda, Google Cloud Functions, Vercel Functions with Fluid Compute) have dramatically reduced cold-start penalties, but the fundamental tradeoffs still apply.

### Partitioning (Sharding)

Split data across multiple DB instances. User-ID ranges, geographic partitions, hash-based.

**Pros.** Write throughput scales with shard count.

**Cons.** Cross-shard queries are expensive or impossible. Rebalancing is painful (consistent hashing helps).

### Caching

Redis or Memcached for short-term hot storage.

**Patterns.** Read hits cache first, falls through to DB on miss (cache-aside). Write-through or write-back depending on consistency needs.

**Dramatically reduces DB load** for read-heavy workloads.

### Message Queues

Decouple producers from consumers. Write path doesn't block on slow work.

**Enables** async processing, retries, rate-limiting downstream services.

### Separating Read and Write (CQRS)

Command and query sides have different scaling requirements.

**Writes** go to the system of record.
**Reads** go to optimized views (cached, denormalized, indexed differently).

**Change Data Capture** (Debezium reading MySQL binlog) keeps the read side in sync.

### Adapting to changing requirements

Architecture should make priority changes cheap. The sales-alert example: an ecommerce platform that can reshuffle which products get priority placement without a code deploy has built well. The one that needs a migration for every business ask has built brittle.

## 21. Microservice Resilience — Timeouts, Retries, Circuit Breakers, Fallbacks

A distributed system is one where the failure of a machine you didn't know existed can render your machine unusable. Four patterns defend against that. They compose.

### 21.1 Why failures cascade

Service B takes 1000 requests/sec normally. A memory leak makes GC pauses grow. Response time climbs from 50ms to 5 seconds. Service A sends requests and waits. A's thread pool fills, new requests queue. A's callers time out. A's callers' callers time out. Within seconds, an issue confined to B has crashed the whole graph.

This is the **cascading failure**. The root cause is always the same: **one slow or broken service holds resources in its upstream callers**, which then run out of capacity and fail themselves.

Four patterns prevent this:

1. **Timeouts** — prevent indefinite waiting.
2. **Retries** — handle transient failures.
3. **Circuit breakers** — stop calling failing services.
4. **Fallbacks** — degrade gracefully when calls fail.

They layer. A real request: timeout → retry on failure → circuit breaker tracks failures → if circuit opens, fallback. Each is insufficient alone.

### 21.2 Timeouts

Set a deadline on every outbound call. If the response doesn't arrive in time, abort and free resources.

**Without timeouts:** a 30-second deadlock in Service B holds Service A's threads for 30 seconds. Under load, A runs out of threads and dies.

**With timeouts:** after 2 seconds (say), A abandons the call. The thread returns to the pool. A stays alive; it may return a degraded response.

**Setting the right value.**
- **Too short:** false failures on slow-but-valid responses. Wasted retries. More load on the downstream.
- **Too long:** weak protection; under saturation, all threads get pinned.
- **Rule of thumb:** `timeout = p99_normal × 1.5` or so. Measure the actual normal distribution, add a safety multiplier.

**Different timeout levels.**
- **Connection timeout.** How long to wait to establish a TCP connection. Short — if the host is reachable, this should be sub-second.
- **Read/request timeout.** How long to wait for the response body. Longer — tuned to actual service p99.
- **Total timeout.** Caps total time including retries. Prevents retry storms from adding up to minutes.

**Implementation (HTTP clients):** every framework has a timeout config — `fetch` AbortController, Node `axios.timeout`, Python `requests.get(timeout=2)`, Go `context.WithTimeout`. Default is usually *no timeout*, which is the worst possible default. Override always.

**Propagation.** Downstream call timeouts should be *shorter* than the caller's total budget. If the user waited 3s and you have 2s left, your downstream call must timeout in ≤2s, or you'll still respond late. Propagate the deadline via `X-Request-Deadline` header or OpenTelemetry baggage.

### 21.3 Retries

Some failures are transient — network packet drop, brief congestion, momentary GC pause. A retry fixes it.

**When retries help:**
- Network errors (connection refused, reset, timeout)
- HTTP 503 (service temporarily unavailable)
- HTTP 429 (rate limited, with `Retry-After` header)

**When retries HURT:**
- **Non-idempotent operations** (POST that creates a record). Retrying may create duplicates.
- **Permanent errors** (400 bad request, 404 not found). The request was never going to work.
- **Under saturation.** The downstream is already overwhelmed. Retrying makes it worse — **retry storm**.

**Exponential backoff.**

Don't retry immediately. If the service is overloaded, an immediate retry just adds to the pile. Instead, back off:

```
retry_1: wait 1s
retry_2: wait 2s
retry_3: wait 4s
retry_4: wait 8s
```

Each retry waits twice as long. Gives the downstream time to recover.

**Jitter.**

If 1000 clients all retry after exactly 2s, they hit the downstream simultaneously — a **synchronized retry storm**. Add randomness:

```python
wait = min(base × 2**attempt, max_wait) + random(0, jitter_max)
```

Jitter desynchronizes the thundering herd.

**Retry limits.**

Cap total retry attempts — typically 3 to 5. More and you're creating load without recovering.

**Retry budget.** Global limit on retry rate as a fraction of request rate. E.g., allow 10% of requests to be retries cluster-wide. Protects downstream during partial outage.

### 21.4 Circuit Breakers

A circuit breaker is a state machine that **stops calling a failing service** to give it time to recover and to prevent cascading failure in the caller.

It's physically analogous to an electrical breaker: when current spikes, it trips, opening the circuit. Manual or automatic reset closes it again.

**Three states:**

**CLOSED (normal).** Calls pass through. The breaker tracks failures (rate or count) over a rolling window.

**OPEN (tripped).** If failures exceed threshold, breaker opens. All calls **fail immediately** without hitting the downstream. Usually returns cached data or a fallback. After a cooldown period, breaker moves to HALF-OPEN.

**HALF-OPEN (probing).** Breaker allows a small number of probe requests through. If they succeed, breaker closes (normal). If they fail, breaker re-opens (another cooldown).

**Diagram:**
```
    CLOSED ──(failure threshold exceeded)──> OPEN
       ↑                                       │
       │                                       │ (after cooldown)
       │                                       ↓
       └──(probes succeed)── HALF_OPEN ←───────┘
                    │
                    └──(probes fail)──> OPEN
```

**Configuration parameters:**

- **Failure threshold.** Rate (50% of requests fail) or count (20 failures in a row). Rate is more robust under varying load.
- **Rolling window.** Over how long do we measure? 10 seconds, 60 seconds. Too short = noisy, trips on brief spikes. Too long = slow to react.
- **Cooldown (open duration).** How long to stay OPEN before probing. Enough for the downstream to recover (30s–5min typical).
- **Half-open probes.** Number of probe requests allowed in HALF-OPEN (1–5). More = faster recovery detection but more load on a possibly-still-broken service.

**Monitoring.** Track state transitions, failure rate, open duration. Frequent trips indicate either an unstable downstream or an aggressively tuned breaker.

**Common libraries:** Netflix Hystrix (legacy), Resilience4j (Java), Polly (.NET), opossum (Node). Service meshes (Istio, Linkerd) can implement breakers transparently at the sidecar level.

**Implementation gotcha:** the breaker needs per-dependency instance state. If Service A calls Services B, C, D — three breakers, not one. B's failures shouldn't close C's circuit.

### 21.5 Fallbacks

When a downstream is down, return *something useful* instead of an error.

**Types of fallbacks:**

**Cached response.** Serve the last-known-good value from cache. Slightly stale is usually fine for non-critical reads.
- Product catalog: cached list is fine.
- Search results: yesterday's results are fine.
- Recommendation feed: popular items as fallback for personalized.

**Default value.** Return a baseline response.
- User preferences down → show defaults.
- Recommendations down → show top-sellers.
- User avatar down → show initials.

**Graceful degradation.** Return partial functionality.
- Search down → return empty results with message.
- Real-time notifications down → fetch later via refresh.
- Maps down → show address text instead.

**Stubbed response.** Placeholder data that's obviously degraded but not broken.
- "Loading preferences..." while actual preferences are unavailable.
- "Recommendations coming soon" instead of an error page.

**Fallback caveats.**

- **Don't lie with fallbacks.** Indicate degradation somehow (UI hint, different styling, log it). Users silently getting fallback data is a silent correctness bug.
- **Fallback ≠ silent retry.** Fallback is explicit. It knows the real thing failed.
- **Fallbacks have their own failure modes.** Cache miss on fallback, default-value service being down. Test the fallback path.

### 21.6 Combining Patterns — The Layered Defense

A single request under the full stack:

```
1. Request arrives
2. Set timeout (deadline propagated from caller)
3. Check circuit breaker state
   - CLOSED: proceed
   - OPEN: skip directly to fallback
   - HALF-OPEN: probe allowed, proceed if quota remains
4. Make the call with timeout
5. On failure:
   - Retryable + retry budget remaining → retry with exponential backoff + jitter
   - Non-retryable or retries exhausted → return fallback
6. Update circuit breaker (success/failure)
```

**Example — recommendation service down:**
- Request comes in, needs recommendations
- Circuit breaker for recs is OPEN (previous failures)
- Skip the call entirely, hit fallback
- Fallback: popular items from cache
- Return to user with "Showing popular picks" label

Four patterns, each simple. Layered, they turn a brittle graph of services into one that degrades gracefully under partial failures.

This is exactly what SIMFID simulates — see Part VIII (SIMFID Runtime) for the runtime implementation notes.

## 22. Rate Limiting

Rate limiting caps how many requests a caller can make in a given window. It protects downstream systems from abuse, enforces fair-use across tenants, and smooths traffic into a predictable shape.

Without it, one noisy neighbor can exhaust a shared pool — a single buggy client retrying aggressively can drive p99 latency off a cliff for everyone else. With it, you choose who gets throttled rather than letting saturation pick randomly.

**Where it lives.** Edge (API gateway, CDN), per-service (middleware in front of handlers), or deep in the stack (DB connection pool, background queue). The closer to the edge, the cheaper the rejection.

### 22.1 Token Bucket

A bucket holds up to `N` tokens and refills at rate `r` tokens/second. Each request costs one token. No token available → reject.

```
refill rate: r tokens/sec
          │
          ▼
       ┌──────┐
       │ ●●●● │  capacity N
       │ ●●   │
       └───┬──┘
           │ 1 token per request
           ▼
        request → allowed if token available, else 429
```

- **Pros:** allows bursts up to capacity (user can spend all `N` at once), then smooths to the refill rate. Maps cleanly to "100 requests per minute, burst up to 20".
- **Cons:** state per caller (bucket level, last-refill timestamp). In a distributed setup, the bucket lives in Redis or a dedicated limiter — now you've added a network hop per request.
- **Real-world:** AWS API throttling, Stripe's rate limiter, most public APIs. Classic default when "bursty but bounded" matches the workload.

### 22.2 Leaky Bucket

Requests enter a fixed-size queue. A constant-rate worker drains the queue. Queue full → reject.

```
incoming ─▶ ┌─────────┐
            │ queue   │  ──(drip at rate r)──▶ handler
            └─────────┘
```

The difference from token bucket: leaky bucket **enforces a smooth output rate** — no bursts pass through. Token bucket lets bursts through as long as tokens are available.

- **Pros:** output traffic is perfectly smooth. Ideal when the downstream can't tolerate spikes (e.g. writes to a database with tight connection limits).
- **Cons:** added latency (requests queue), and bursts get delayed, not allowed-then-smoothed. Feels worse to a human caller who wants their spike through *now*.
- **Real-world:** network shapers, classic traffic-shaping in routers, payment-processor rate governors.

### 22.3 Fixed Window Counter

Count requests per caller per fixed time window (e.g. minute). At window boundary, reset.

```
minute 12:00 │ count: 87 / 100 → allow
minute 12:01 │ count: 0  (reset)
```

- **Pros:** simple. One integer per caller per window. Cheap in Redis with `INCR` + `EXPIRE`.
- **Cons:** **boundary burst problem.** A caller can send 100 at 12:00:59 and another 100 at 12:01:00 — 200 requests in two seconds, but no window "saw" more than 100.
- **When to use:** when approximate limits are fine and you want cheap state. Many real APIs use this despite the bursty edge.

### 22.4 Sliding Window Log

Store a timestamp for every request. On each request, drop timestamps older than the window, count the rest, compare to limit.

- **Pros:** perfectly accurate. No boundary problem. Can report exact "requests in last 60 seconds".
- **Cons:** memory per caller = N timestamps. At 1000 req/min per caller, that's a list of 1000 entries. For millions of callers, this hurts.

### 22.5 Sliding Window Counter

Hybrid of fixed window and sliding log. Keep two counters (current window, previous window) and interpolate based on how far into the current window you are.

```
request at t, where t = 0.3 into the current minute:
  effective_count = current_minute_count + previous_minute_count * (1 - 0.3)
```

- **Pros:** close to sliding-log accuracy, fixed-window memory cost. A common production choice at companies like Cloudflare.
- **Cons:** interpolation assumes a uniform arrival distribution across the previous window. Skewed traffic (a burst clustered at the start or end of the previous minute) can make the estimate materially off in either direction. Benchmark with your actual workload before relying on it for strict-correctness use cases.

### 22.6 Choosing a strategy

| Strategy | Memory per caller | Accuracy | Allows bursts | Best for |
|---|---|---|---|---|
| Token Bucket | O(1) | Exact | Yes, up to capacity | Bursty bounded APIs |
| Leaky Bucket | O(queue size) | Exact | No (smooths output) | Downstream-protection, no spikes allowed |
| Fixed Window | O(1) | Boundary bursts | Yes (up to 2× limit at boundary) | Cheap, approximate |
| Sliding Log | O(limit) | Exact | Yes, up to limit inside the window | Low-volume, strict accuracy |
| Sliding Window Counter | O(1) | Approximate | Yes, up to limit | High-volume production default |

Note: sliding-log and sliding-window-counter are **counters**, not shapers. They allow a burst up to the configured limit inside the window. Only leaky bucket actively smooths output.

### 22.7 Distributed rate limiting

Single-node limiters don't work behind a load balancer — each node sees a fraction of traffic. Options:

- **Central store** (Redis). Every request increments a shared counter. One network hop per request, but atomic and accurate. Use Lua scripts for atomicity.
- **Local-with-sync.** Each node enforces a share of the global limit (e.g. 100 req/min global, 10 nodes → 10 each). Periodically sync usage. Drifts at small scales but avoids the per-request hop.
- **Probabilistic** (e.g. Cloudflare's approach at extreme scale). Accept some slop; sample.

Under high load, the limiter itself can become a bottleneck. Measure. A rate limiter that adds 5ms to p99 on a 20ms API is not protecting you — it's hurting you.

### 22.8 Failure mode: fail-open vs fail-closed

When the rate-limiter backend (Redis) is down, should the app **allow everything** (fail-open) or **reject everything** (fail-closed)?

- **Fail-open** — protects user experience; risks amplifying an outage (everyone gets unlimited).
- **Fail-closed** — protects the downstream; risks turning a limiter outage into a full app outage.

There's no universal right answer. A payment API usually fails-closed (can't risk unlimited charges). A read-mostly content API usually fails-open. Name the choice explicitly.

### 22.9 Related in SIMFID

See §43 Wire-Level Configuration for `throughputRps` — the same concept applied as a per-wire flow cap, which behaves like a leaky-bucket shape on wire-level traffic.

---

# Part VI — Patterns & Templates

## 23. Saga — Distributed Transactions with Compensating Actions

A saga is a sequence of local transactions across multiple services, where each step has a **compensating action** that undoes it. If any step fails, the saga runs compensations for every completed step, in reverse order.

This is the answer to "ACID across services" — when each service owns its own database (§35), you can't use a distributed transaction (2PC) without coupling them into one locking group. Sagas trade atomicity for **eventual consistency with explicit rollback**.

### 23.1 The problem sagas solve

Classic case: a travel booking.

1. Charge the card ($500)
2. Reserve the hotel
3. Book the flight
4. Reserve a rental car

Each step lives in a different service (payments, hotels, flights, cars). If step 3 fails, step 1 and 2 already happened. The database is globally inconsistent: money charged, hotel held, no flight, no car.

**The naive fix** — wrap everything in a distributed transaction — doesn't scale. Each service has to lock resources until the coordinator commits. One slow step drags everyone. One failed coordinator leaves locks dangling. 2PC is correct but operationally brittle.

**The saga fix:** each step commits locally. On failure, fire **compensating actions** in reverse:
- Step 3 failed → "refund flight charge" (no-op, flight wasn't booked), "release hotel hold", "refund payment".

Compensations are not magic rollbacks. They're **semantic reversals** — refund, release, cancel, credit — which you write as ordinary local transactions.

### 23.2 Two coordination styles

**Choreography.** No central coordinator. Each service listens for events and reacts.

```
[Payment] ──"paid"──▶ [Hotel]
[Hotel]   ──"held"──▶ [Flight]
[Flight]  ──"booked"──▶ [Car]
[Car]     ──"failed"──▶ [Flight]     (compensate)
[Flight]  ──"cancelled"──▶ [Hotel]   (compensate)
[Hotel]   ──"released"──▶ [Payment]  (compensate)
```

- **Pros:** loose coupling, no single point of failure, each service owns its own logic.
- **Cons:** the flow is invisible — to understand "what does a booking saga do?", you have to read every service's event handlers. Debugging is archaeology. Cyclic dependencies creep in.

**Orchestration.** A central coordinator drives the saga explicitly.

```
[Orchestrator]
   │
   ├─▶ Payment  : charge
   ├─▶ Hotel    : reserve
   ├─▶ Flight   : book       ──failed──┐
   └─◀─── compensation chain ◀──────────┘
```

- **Pros:** the flow is one artifact — easy to read, test, version. Failure handling is explicit.
- **Cons:** the orchestrator itself is state-ful and must be durable (AWS Step Functions, Temporal, Camunda). Becomes a single point of coupling if services talk only via it.

Choose orchestration for complex, long-lived sagas (booking, onboarding). Choose choreography for short, well-understood flows (2–3 steps, mostly linear).

### 23.3 What sagas can't do

- **Isolation.** During the saga, other transactions see intermediate state. Idempotency keys prevent *duplicate* processing, but they do **not** prevent concurrent oversell — two sagas racing for the last hotel room both see it as available until one commits. Solving that requires explicit concurrency control at the contested resource: optimistic concurrency (version counters), pessimistic locks with short timeouts, or **reservation semantics** (hold the room for N seconds while the saga progresses, release on abort). Without one of those, sagas alone permit double-booking.
- **Strict rollback.** Compensation is not a rewind — it's a new transaction. A charge gets refunded, not un-made. Customers may see the charge and the refund both in their statement.
- **Cross-saga atomicity.** Two concurrent sagas can interleave in ways a local ACID DB would never allow.

The rule: sagas give you **eventual consistency with explicit reversal paths**, not transactional isolation. Sell that to the business before picking the pattern.

### 23.4 Implementation checklist

- Every step has a documented compensation. No compensation → that step is the commit point; everything after must be idempotent-retry-only.
- Every step is **idempotent**. The saga engine retries on transient failure.
- Every step has a unique step ID logged before and after — so you can replay or audit.
- Timeouts on every step. A step that hangs forever halts the saga without even raising a failure.
- Compensations themselves must be idempotent and retry-safe.

## 24. Fan-Out / Fan-In — Parallel Processing in Distributed Systems

Fan-out/fan-in splits one request into N parallel sub-tasks, runs them in parallel, and reassembles the results. It's how you turn a sequential 10-step job into a parallel one that finishes in the time of the slowest step.

```
            ┌──▶ worker 1 ──┐
request ─▶ [split]  worker 2   [merge] ─▶ response
            └──▶ worker N ──┘
```

### 24.1 When it pays off

The speedup is bounded by Amdahl's Law: if 20% of the work is sequential (split + merge + whatever can't parallelize), the max speedup is 5x no matter how many workers you add.

Good candidates:
- Image transcoding: one upload → thumbnails at N sizes, all independent.
- Search fan-out: one query → N shards, merge top-K.
- Report generation: one dashboard → N widget computations in parallel.
- LLM agent tool calls: one turn → N tool invocations, merge back into the next prompt.

Bad candidates:
- Work with tight data dependencies between steps.
- Very short tasks where orchestration overhead dominates.

### 24.2 Fan-out patterns

**Synchronous fan-out.** The caller blocks until every branch returns.

- Simple to implement (Promise.all, goroutine wait group, Java CompletableFuture).
- Latency = slowest branch. One slow shard = slow whole response.
- Partial failure: usually means "whole request fails" — which may or may not be right.

**Asynchronous fan-out via a queue.** The coordinator publishes N messages to a queue; workers drain and complete; a merger subscribes to completion events and reassembles.

- Decouples caller from worker pool scaling.
- Enables retry without the caller holding a connection.
- Adds latency (queue hops) — not worth it for fast, small tasks.

### 24.3 Fan-in reassembly

The merge step has to know when all branches are done. Options:

- **Fixed fan-out count.** Caller knows N upfront. Merger waits for N completions.
- **Scatter-gather with timeout.** Wait up to `T` ms, return whatever has arrived. Good for search (missing a slow shard is often better than a slow response).
- **State machine.** Each completion updates a persistent state (Redis hash, DB row). When the count hits N, the merger fires. Survives merger crashes.

### 24.4 The slowest-branch problem

If one branch routinely takes 10× the others, fan-out makes things worse, not better — you're still bounded by the slow one, and you've added coordination overhead.

Common fix: **hedged requests.** Issue branch requests with a short timeout. If a branch is slow, send a second request to another replica. Return whichever comes back first.

Google's search and Cassandra-family stores use variants of this (e.g. "speculative retries"). The actual load overhead and p99 improvement depend on the hedge-trigger threshold, tail-latency distribution, and replica count — measure for your workload, don't assume a universal ratio.

### 24.5 Related in SIMFID

The dual to fan-out is **retry storms** (§41) — one failure, N retries, multiplied along a chain. Both are "traffic amplification" patterns; one is intentional (parallelism), the other accidental (saturation). Understanding one helps you diagnose the other.

## 25. CQRS & Read-Write Separation

### Read-Write Separation

Most systems have asymmetric read/write patterns. Social media: 100:1 reads to writes. E-commerce catalog: 1000:1. IoT telemetry: reversed, write-heavy.

This asymmetry is an opportunity to optimize each path separately.

**The classic pattern — database replication.**

```
Client (writes) ────────> Primary DB
                            │
                            ├── async replicate ──> Replica 1 ──> Client (reads)
                            ├── async replicate ──> Replica 2 ──> Client (reads)
                            └── async replicate ──> Replica 3 ──> Client (reads)
```

Primary takes all writes. Replicas handle reads. Scale reads by adding replicas.

- **Pros:** scales read capacity linearly, improves availability (read survives primary downtime), replicas can be geographically distributed for lower read latency.
- **Cons:** **replication lag** — reads may be stale by milliseconds to seconds. Failover is complex (promoting a replica, updating clients). Write capacity still bounded by a single primary.

### CQRS — Command Query Responsibility Segregation

CQRS takes read-write separation further: **the write side and read side are architecturally distinct.**

```
Client ──commands──> Write Service ──> Write DB (normalized, transactional)
                                          │
                                          └── events ──> Read Service ──> Read DB (denormalized)
                                                                              │
Client ──queries──────────────────────────────────────────────────────────────┘
```

The write side stores data in the shape that matches the business logic (normalized, ACID, transactional). The read side stores data in the shape that matches how clients query (denormalized, indexed per query pattern, pre-joined).

An async event stream (usually a message queue, or Change Data Capture) keeps the read side eventually consistent with the write side.

**When CQRS makes sense:**
- Read and write models diverge significantly (e.g., write as events, read as aggregated dashboards)
- Very different scaling profiles (write-heavy audit log, read-heavy timeline)
- Complex queries that are expensive against the normalized write model

**When it's overkill:**
- Simple CRUD with symmetric read/write — just use replication or a single DB
- Small teams that can't afford the operational complexity of two data stores

### Push vs Pull Model

Two fundamental approaches to moving data between producer and consumer.

**Push.** Producer sends data to consumer as soon as it's available.

- Pros: low latency, consumer doesn't waste cycles polling.
- Cons: producer needs to know all consumers (fan-out), hard to slow down (backpressure), consumer might be offline or overwhelmed.
- Examples: webhooks, WebSocket pushes, message queue deliveries, pub/sub.

**Pull.** Consumer polls producer for new data.

- Pros: consumer controls its rate, simple (no connection tracking), consumer can be intermittent.
- Cons: polling overhead (requests that return "nothing new"), higher latency (bounded by poll interval).
- Examples: cron jobs, database polling, HTTP long-polling, Kafka consumer groups pulling from brokers.

**Hybrid approaches.**
- **Long polling.** Consumer opens a request; server holds it open until data is available or a timeout. Push-like latency, pull-like simplicity.
- **Server-Sent Events (SSE).** Server pushes over HTTP, consumer re-connects on drop.
- **WebSocket.** Bi-directional push/pull over a persistent connection.

### Case Study — Twitter Timeline (Push vs Pull)

The canonical example of when the choice matters.

**Fan-out on write (push).** When a user tweets, write that tweet into every follower's home timeline cache.

- Read path is blazing fast: just fetch the pre-computed timeline.
- Write path is horrifying at the edges: Taylor Swift tweeting means 90M writes. Huge write amplification, massive storage, eventual lag.

**Fan-out on read (pull).** When a user opens their timeline, gather recent tweets from everyone they follow and merge them.

- Write path is cheap: one row inserted.
- Read path is slow and expensive: merging timelines from hundreds of followed users on every page load.

**The hybrid Twitter actually uses.**
- **Regular users:** fan-out on write. Low write amplification, fast reads.
- **Celebrities (>1M followers):** fan-out on read. Avoid massive write amplification. Their tweets are merged in at read time.

The rule: **measure both costs (write amplification vs read expense) and pick where they balance.** Hybrid lets you draw different lines for different users.

This is the cleanest example of why "just use CQRS" isn't a universal answer — the right read-write split is workload-specific.

## 26. Pre-Computing — Compute on Write vs Compute on Read

A read returns data derived from raw facts. The core tradeoff is **when** to do the derivation: at write time (pre-compute, cache the result) or at read time (compute on demand).

This isn't caching in the TTL sense — it's about where the computation lives. A cache is what you reach for after deciding to compute-on-read; pre-computing removes read-time computation entirely.

### 26.1 The two extremes

**Compute on read.** Every query runs the full derivation. Raw facts only.

- Pros: simple, always fresh, low write cost.
- Cons: read latency grows with data and complexity. Expensive joins, aggregations, ranking — every read pays.
- Example: `SELECT COUNT(*) FROM orders WHERE user_id = ?` — fine at 1K orders per user, brutal at 10M.

**Compute on write.** Derivations happen in the write path. Reads just look up pre-computed results.

- Pros: blazing-fast reads. Read path is a key lookup, not a compute.
- Cons: write latency grows (have to derive on every write), write amplification (one write updates many read views), recomputation if derivation logic changes.
- Example: maintain a `user_stats` table with `order_count`, `lifetime_value`, `last_order_at`. Every order write updates the row. Reads become a single-row lookup.

### 26.2 When each wins

**Compute on read wins when:**
- Writes >> reads (no point caching what's rarely read).
- Derivation is cheap (simple filter, no aggregation).
- Data changes unpredictably and staleness is expensive.

**Compute on write wins when:**
- Reads >> writes (typical web app: 100:1 or more).
- Derivation is expensive (joins, aggregations, ranking).
- Read latency is user-facing (page load, dashboard).
- The derivation is stable (change rarely, so recomputes are rare).

### 26.3 Canonical examples

**Twitter timeline.** Fan-out on write (§25) is pre-computing — every tweet gets written into every follower's pre-computed timeline cache. Reads are O(1) lookups.

**Leaderboards.** Don't run `SELECT user_id, SUM(score) GROUP BY user_id ORDER BY 2 DESC LIMIT 100` on every pageload. Maintain a sorted set (Redis `ZADD`/`ZRANGE`) on every score write.

**Recommendation feeds.** Daily or hourly batch computes per-user recommendations; serving is a single key lookup. The freshness tradeoff is explicit: recommendations lag by a day, but reads are under 10ms.

**Search indexes.** An index is pre-computed lookup structure. Without it, every search is a full scan. With it, writes cost an index-update on every insert; reads cost a single index traversal.

### 26.4 Hybrid: lazy pre-compute

Compute on *first* read, then cache. Combines the two:
- Low write cost (no eager pre-compute).
- Low steady-state read cost (subsequent reads hit cache).
- First reader of cold data pays the cost.

Acceptable when: user-facing cold-start latency is tolerable (e.g. "your personalized page is loading..." spinner for new users).

### 26.5 The tradeoff crystalized

Pre-computing moves work from the read path to the write path. Since reads usually outnumber writes, and since reads are usually more latency-sensitive than writes, most production systems pre-compute more than feels "clean" at first.

The question isn't "should I pre-compute?" — it's "what's my read:write ratio, and what's my read-latency budget?". Those two numbers tell you where on the spectrum to sit.

## 27. Unique ID Generators — Snowflake, UUID, ULID

Distributed systems need IDs that are unique without a central authority. A DB auto-increment doesn't scale across shards; a lock-protected sequence doesn't scale at all. The solutions fall into a small number of families, each with different tradeoffs on size, orderability, and collision risk.

### 27.1 The three requirements

1. **Uniqueness.** Two generators on different machines must never produce the same ID. Near-zero collision probability is acceptable; outright collision is not.
2. **Orderability (optional).** IDs that sort by creation time let you range-scan recent rows, use the ID as a cursor for pagination, and build time-ordered streams without a separate timestamp column.
3. **Size.** 64-bit fits in a BIGINT and indexes fast. 128-bit is 2× the storage and wider indexes.

### 27.2 UUID v4 (random)

128-bit, random. `550e8400-e29b-41d4-a716-446655440000`.

- **Pros:** trivially unique (2^122 values, collision probability vanishes at realistic scale). No coordination. Standardized.
- **Cons:**
  - **Not orderable.** Random means index inserts scatter across the B-tree — bad for write throughput and cache locality (see §11 B-tree vs LSM).
  - **128 bits** — 2× the storage of a 64-bit ID, 2× the index size, worse for join performance at scale.

UUID v4 is the default for schemas where write throughput and scan-order don't matter. Stop using it if you see random-insert B-tree splits in your DB metrics.

### 27.3 Snowflake (time-ordered, 64-bit)

Twitter's design, widely copied. 64 bits, structured:

```
 1 bit │  41 bits        │  10 bits      │  12 bits
  sign │  timestamp (ms) │  machine ID   │  sequence
```

- **Timestamp:** milliseconds since a custom epoch. 41 bits = ~69 years of range.
- **Machine ID:** assigned per generator instance (host, worker, whatever). 10 bits = 1024 generators.
- **Sequence:** per-ms counter on that machine. 12 bits = 4096 IDs per ms per machine.

Pros:
- 64-bit, orderable by time, no coordination beyond machine-ID assignment.
- Extracting the timestamp from the ID is a bit-shift — cheap.

Cons:
- Machine-ID assignment needs coordination at deploy time (Zookeeper, config, etc).
- Clock skew across machines can cause IDs from different nodes to interleave oddly in sort order.
- 4096-per-ms-per-machine ceiling: if you burst past it, you either wait until next ms or roll over (bugs).

Used by: Twitter (obviously), Discord, Instagram (variant), Sony, most large-scale ID generators of the 2010s.

### 27.4 ULID (time-ordered, 128-bit, lexicographic)

26-char Crockford base32 string. First 10 chars = timestamp; last 16 = random.

```
01ARZ3NDEKTSV4RRFFQ69G5FAV
├─timestamp─┤├──── random ────┤
```

- **Pros:** 128-bit (UUID-compatible storage), lexicographically sortable, no coordination required (the random part is enough for uniqueness).
- **Cons:** 128 bits (vs Snowflake's 64). Human-readable (ok) but longer strings.

ULID is the "UUID but sortable" answer. If you need UUID-size and sort order and don't want the machine-ID coordination of Snowflake, ULID is the modern default.

### 27.5 UUID v7 (the modernization)

UUID v7 (standardized 2024) is essentially ULID in UUID format: timestamp-prefixed, random suffix, sorts by creation time, 128-bit.

- **Pros:** same as ULID, but fits in any UUID column. No schema migration if you're moving away from v4.
- **Cons:** 128 bits; less human-readable than ULID.

For new schemas in 2025+: UUID v7 is the sensible default. It replaces v4 for almost every use case and avoids Snowflake's coordination overhead.

### 27.6 Choosing

| ID type | Size | Orderable | Coordination | Best for |
|---|---|---|---|---|
| UUID v4 | 128b | No | None | Legacy, join-order doesn't matter |
| Snowflake | 64b | Yes (by time) | Machine-ID assignment | High-throughput, 64-bit columns |
| ULID | 128b | Yes (lex) | None | UUID-column migrations wanting order |
| UUID v7 | 128b | Yes (by time) | None | New schemas, modern default |
| DB auto-inc | 64b | Yes (insertion) | Central DB | Single-node systems only |

The right choice depends on write scale and storage shape. At 10K QPS on Postgres, UUID v7 is fine. At 1M QPS across 100 shards, Snowflake's 64 bits pay for themselves in index size.

---

# Part VII — Extended Patterns & Case Studies

## 33. Cache-First Pattern for High-Volume Systems

Cache-first means: on the read path, **the cache is the source of truth** during the request. The database is a slow fallback only for genuine misses, and sometimes not even that — some cache-first designs don't fall back to the DB at all for certain reads.

This is more aggressive than cache-aside (§10.2). Cache-aside is "check cache, then DB." Cache-first is "serve from cache; if not there, either reject, redirect, or queue the request, but do **not** let every miss hit the DB."

### 33.1 When cache-first pays off

- Read QPS is 10–1000× higher than the DB can sustain. Cache-aside still sends every miss to the DB — a burst of 10K misses can collapse the DB.
- The data can tolerate short unavailability more easily than staleness (e.g. feeds, leaderboards, product catalogs).
- The working set fits in cache with very high hit rate (>99%).

### 33.2 Ways to implement "miss → not-DB"

**Serve a default.** If the cache doesn't have it, return a safe default (empty list, placeholder, "loading").

**Queue the miss, refresh offline.** The miss triggers an async refresh job, the current request returns a stub, a subsequent request gets the populated cache. Useful for personalized feeds where "no feed yet" is acceptable.

**Reject with 503.** Rare, but explicit — "we don't serve cold reads." Only for internal services where the consumer knows what it's doing.

### 33.3 Keeping the cache full — the cache-warming problem

If the cache is authoritative, you have to keep it populated. Options:

- **Write-through** (§10.3). Every DB write updates the cache. Best consistency, adds write-path latency.
- **Change Data Capture** (§12 / §37). Stream DB changes into cache asynchronously. Decouples from the write path.
- **Periodic warm-up job.** Batch recompute-and-set for the hot working set.
- **Lazy first-read** (hybrid). On miss, compute in the background, serve placeholder, fill cache.

### 33.4 Risks

- **Stale data on disaster.** If the cache falls behind the DB (replication lag, CDC outage), cache-first will serve stale data indefinitely. Add freshness checks or hard TTLs.
- **Cold start.** After a cache flush (restart, failover), the cache is empty. Cache-first designs need explicit "warming" before accepting traffic — not the implicit warmup of cache-aside.

### 33.5 Related

- §10 Caching — patterns (cache-aside, read-through) and failure modes.
- §26 Pre-Computing — similar idea applied to derivations.
- §37 Multi-System CDC Sync — the usual mechanism for filling the cache from the authoritative store.

## 34. Two-Stage Processing Pattern

Split a request into two phases: an **acknowledgement stage** that's fast, bounded, and user-facing, and a **completion stage** that's slow, async, and happens behind the scenes. The user gets a "we got it" response in 50ms; the real work lands minutes later.

### 34.1 Canonical examples

- **Order placement.** Stage 1: validate, assign order ID, write to DB, return "order placed." Stage 2: charge card, reserve inventory, notify warehouse — async, can take seconds to minutes.
- **File upload → transcoding.** Stage 1: accept the upload, store the raw file, return an asset ID. Stage 2: transcode into web formats, generate thumbnails, extract metadata.
- **Email send.** Stage 1: queue the email, return 200. Stage 2: deliver via SMTP, handle bounces, update status.

The pattern is almost always: **synchronous acknowledgement, asynchronous fulfillment**.

### 34.2 Why two stages

Combining everything synchronously fails for the usual reason — one slow step (SMTP delivery, image transcoding, payment processor) inflates p99 across the board, and transient failures turn into user-visible errors instead of invisible retries.

Splitting lets you:
- **Meet tight response SLAs** even when downstream is slow or flaky.
- **Batch expensive work** (transcode 100 files at once, send 1000 emails per SMTP session).
- **Retry silently** when stage 2 fails, without the user seeing a 500.

### 34.3 Required ingredients

- A **durable queue** between the stages (Kafka, SQS, RabbitMQ). See §13.
- A **status model** the user can query: `pending`, `processing`, `complete`, `failed`. Stage 1 sets `pending`; stage 2 updates as it progresses.
- **Idempotency keys** on stage-2 work — the queue can redeliver, and stage 2 must not duplicate.
- **User feedback loop**: poll, push (websocket/webhook), or email — so the user eventually sees the outcome.

### 34.4 The failure boundary

Stage 1 commits what stage 2 depends on. If stage 1 returns success but stage 2 fails permanently, the system has "lied" to the user (their order is in DB but never actually happened).

The mitigations:
- **Compensating actions** (saga pattern, §23). If stage 2 fails, run the reversal.
- **Escalation**. After N retry failures, page a human or open a ticket.
- **Visible status**. Make the user aware something is pending so they can follow up.

Don't just hope stage 2 works. Explicitly design the "stage 2 gives up" branch.

### 34.5 Related

- §13 Message Queues — the substrate.
- §23 Saga — when stage 2 is itself a multi-step distributed operation.
- §38 Case Study: Kafka + Redis Comments — a concrete two-stage flow.

## 35. Database-Per-Microservice

Each microservice owns its own database. No other service reads or writes that DB directly. Integration happens via the service's API, not via SQL.

This is a defining constraint of microservice architecture — and the single most disruptive one when teams try to adopt microservices while keeping a shared database. A shared DB turns microservices into a **distributed monolith**: services appear independent but are deeply coupled through schema, transactions, and performance contention.

### 35.1 Why this matters

**Schema coupling.** If two services read the same table, renaming a column requires coordinated deploys. The schema becomes a contract neither team owns, and schema evolution becomes a cross-team ritual.

**Transactional coupling.** Shared DB invites shared transactions. Once `SELECT ... FOR UPDATE` crosses service boundaries, lock contention is everyone's problem. Long transactions block other services' writes.

**Operational coupling.** One DB = one blast radius. A slow query from service A steals IOPS from service B. One service's backup strategy is everyone's.

**Storage coupling.** All services stuck with the same DB technology. The one writing time-series can't use Clickhouse; the one doing full-text can't use Elastic; they all live in Postgres because someone picked it years ago.

### 35.2 What per-service DBs enable

- **Independent deploys.** Schema changes don't coordinate across teams.
- **Storage heterogeneity.** Each service picks the right DB for its shape (KV for sessions, relational for orders, search index for catalogs). See §11.
- **Blast radius isolation.** Service A's DB incident doesn't directly hit service B.
- **Independent scaling.** Scale the order-DB writes without touching the customer-DB reads.

### 35.3 The integration problem

Once DBs are separated, the question becomes: how do services share data? Four answers:

1. **API calls.** Service B asks service A's API for user data. Simplest; highest coupling at the call site; latency-sensitive.
2. **Events / CDC.** Service A publishes events (user-updated, order-placed); service B consumes them and maintains its own materialized copy. See §12 CDC + §37.
3. **Shared read replica.** A read-only replica exposed to other services — weaker than shared DB (read-only), but still couples schemas. Use only as a stepping stone.
4. **Backend-for-frontend aggregation.** A gateway service calls multiple backends and composes the response. Avoids service-to-service calls at the cost of a composition layer.

The event-driven path (option 2) is the strongest: low coupling, scales, decoupled deploys. It's also the most work to get right (event schemas, ordering, consistency).

### 35.4 The distributed transaction tax

The moment you split DBs, "transactional" operations across services have to become **sagas** (§23). There is no cheap fix for this. Teams that want ACID across services should either not split, or accept eventual consistency with explicit compensations.

### 35.5 Anti-patterns

- **Same physical DB, separate schemas.** Gives a thin illusion of separation but keeps all the coupling. Operational blast radius, contention, lock contention all remain.
- **ORM-managed shared schema.** One ORM library "owns" the schema, many services use it. Worse than shared DB: now two processes disagree about schema state.
- **Service A reading Service B's tables directly because "it's easier".** Starts a slow erosion back to the monolith.

### 35.6 Related

- §6 Monolith vs Microservices — the overarching tradeoff.
- §23 Saga — the transaction answer.
- §37 Multi-System CDC Sync — how to keep derived copies fresh.

## 36. Database Optimization Techniques

Before sharding (§12), before caching (§10), before rewriting in a new DB — wring the current one dry. A single Postgres or MySQL instance, well-tuned, handles more than most teams realize. The techniques below are the high-leverage ones for system design interviews and for real production tuning.

### 36.1 Indexing

An index is a pre-computed lookup structure that maps values to row locations. Without it, the DB scans the table — O(N) per query. With it, O(log N) for B-tree indexes or near-O(1) for hash indexes.

**When to add:**
- Column used in `WHERE`, `JOIN`, `ORDER BY`, or `GROUP BY`.
- High cardinality (many distinct values). Low-cardinality indexes (e.g. `boolean`) are often worse than no index.

**When to avoid:**
- Write-heavy tables with many indexes — every write updates every index (write amplification, see §11).
- Columns rarely queried.
- Wide multi-column indexes that duplicate other indexes.

**Composite indexes** follow the **leftmost-prefix rule.** `INDEX (a, b, c)` serves queries on `a`, `a+b`, `a+b+c` — but not `b` alone, not `c` alone. Order the columns by selectivity and query frequency.

### 36.2 Query rewriting

Often the query is the bottleneck, not the DB. Common wins:

- **Avoid `SELECT *`.** Fetches more data, blows through cache, forces the DB to reach every column even if you need two.
- **Limit and paginate.** Never return unbounded rows — always cap. Use keyset pagination (§19) instead of OFFSET for deep pages.
- **Push predicates down.** Filter in the DB, not in the app. `WHERE status = 'active'` at the DB beats fetching-all-then-filtering in Python.
- **Prefer `EXISTS` over `COUNT(*) > 0`.** Postgres short-circuits; COUNT scans.
- **Denormalize hot reads.** If a 5-table join is on every read path, denormalize to one wider table. Storage is cheap; query latency is not. See §26.

### 36.3 Schema design

- **Use the right type.** `VARCHAR(255)` for a 5-char code wastes index space. `INTEGER` for a boolean is bloat.
- **Normalize for writes, denormalize for reads.** Classic tradeoff — write-heavy schemas stay normal form; read-heavy schemas denormalize (duplicate columns, pre-joined tables).
- **Primary keys matter.** In MySQL InnoDB, the primary key determines physical row layout. Random UUIDs as PKs cause page splits and fragmentation. Use time-ordered IDs (§27) or auto-increment on single-node DBs.

### 36.4 Connection management

A DB has a finite connection pool. Each idle connection consumes memory. Each active connection occupies a server-side worker — **a process in Postgres, a thread in MySQL**, a session in Oracle. The mechanism varies; the scarcity is universal.

- **Use a connection pooler.** PgBouncer, ProxySQL. Apps share a small pool of long-lived connections rather than each process opening its own.
- **Keep transactions short.** Long transactions hold locks and block other writers. A single `SELECT` in an open transaction for 30s can stall a table.
- **Don't `SELECT ... FOR UPDATE` unless you actually need row-level locking.** It's easy to deadlock.

### 36.5 Caching the DB's own structures

Modern DBs already cache:
- **Buffer pool / page cache.** Recently-used pages kept in RAM. Size this to fit the working set (not the whole DB) — InnoDB `buffer_pool_size`, Postgres `shared_buffers`.
- **Query plan cache.** Prepared statements avoid repeated parsing. Parameterize every query; reuse prepared statements.

Tuning the DB's own memory is usually a bigger win than adding an external cache, unless you're at read QPS that has to bypass the DB entirely (then see §10 and §33).

### 36.6 When optimization isn't enough

At some point, the single instance caps out. The signs:
- Read replicas at saturation (replication lag growing).
- Writes hitting IOPS ceiling even on SSD.
- Schema changes taking hours (huge table).
- Working set no longer fits in RAM — cache hit rate falls off, every query goes to disk.

That's when you move to §12 (partitioning, replication, consistent hashing). But most teams ship early. Exhaust the single-node wins first — they're cheaper, and they usually buy you 2–3 more years of headroom.

### 36.7 Related

- §11 Data Storage — index internals (B-tree, LSM).
- §12 Database Scaling — when a single DB isn't enough.
- §19 Pagination — avoiding the OFFSET trap on deep pages.

## 37. Multi-System Data Sync via Change Data Capture

Systems that started as a single DB eventually sprout copies: search indexes, analytics warehouses, caches, per-service read models (§35). Keeping these copies fresh is the multi-system sync problem. The modern answer is **Change Data Capture (CDC)**: stream the DB's replication log into downstream consumers.

§12 covered CDC mechanics. This section covers its application as a sync pattern — what it enables, how it fails, and when to reach for it.

### 37.1 What CDC gives you

- **One canonical writer (the source DB), many readers.** The downstream copies are consumers of the log; they don't write to the source.
- **Near-real-time freshness.** Typical lag: sub-second to seconds. Enough to replace polling-based sync completely.
- **Decoupled deploy cycles.** The source DB doesn't know about its consumers. New consumers snap on; old ones drop off.
- **Replay.** The log is durable. A consumer can re-read from an earlier offset to rebuild state after a bug or a restart.

### 37.2 Typical sync flows

**DB → Search index.**
```
Postgres WAL ──▶ Debezium ──▶ Kafka ──▶ Elasticsearch indexer
```
Every row change produces an event. The indexer upserts into Elasticsearch. Search sees writes within a second, without the app doing dual writes.

**DB → Cache.**
```
Postgres WAL ──▶ Debezium ──▶ Redis materializer
```
The materializer writes `SET key value` for every row change, mirroring the DB into Redis. Reads hit Redis; writes go to Postgres and propagate. Solves the cache-DB dual-write problem (§10).

**DB → Analytics warehouse.**
```
Postgres WAL ──▶ Debezium ──▶ Kafka ──▶ Snowflake / BigQuery loader
```
Powers ELT (§14 Big Data). Warehouses see production writes within minutes without nightly dumps.

**DB → other service's read model.**
```
Service A's DB WAL ──▶ Kafka ──▶ Service B's projection
```
Service B maintains a local copy of the subset of service A's data it needs. The microservice-decoupling answer (§35).

### 37.3 Failure modes

**Schema drift.** Add a column to the source; downstream consumers don't know about it until redeploy. CDC events carry schema; Schema Registry (Confluent, etc.) is usually paired to enforce compatibility rules.

**Consumer lag.** A slow consumer falls behind. If the log retention is too short, the consumer loses catchup ability and has to do a full re-sync. Keep retention > max acceptable consumer outage.

**Ordering across aggregates.** With properly keyed transport (e.g. Kafka partitions keyed by entity ID, single-threaded consumer per partition), CDC preserves per-key order — all events for user 42 arrive in commit order. Global ordering across keys is not preserved, and per-key ordering only holds if the pipeline is set up for it: unkeyed partitioning, reorder-happy consumers, or mid-stream repartitioning can break it. Don't assume per-entity ordering without verifying the transport and consumer contract end-to-end.

**Deleted rows.** Soft deletes show up as updates; hard deletes show up as tombstones (Postgres logical replication emits them; MySQL binlog emits them). Consumers must handle both.

### 37.4 Alternatives and when they win

- **Dual writes.** App writes to DB and to search index in the same request. Simple, but no transaction → dual-write inconsistency (one succeeds, other fails). Use only if staleness is fine and the second write is best-effort.
- **Periodic batch sync.** Nightly job scans source, upserts into destination. Works for slow-changing data (CRM → warehouse). Fails for real-time needs.
- **Application-level events.** App publishes a "user-updated" event after committing. Requires discipline — every write path has to emit. CDC doesn't require discipline; it reads the log the DB is already writing.

CDC is the default for modern systems because it's decoupled from application code and catches every write. If you're building new, start with CDC over app events; if you've got app events already, migrating is rarely worth it until pain mounts.

### 37.5 Related

- §12 Database Scaling — CDC mechanics.
- §13 Message Queues — the transport.
- §14 Big Data — downstream stream processing on CDC streams.

## 38. Case Study — High-Performance Comment System with Kafka + Redis

A concrete integration of many patterns from this document. Problem: a social feed with millions of DAU; users post comments; every post, like, or reply triggers a write that fan-outs to lots of readers. Sustained ~50K writes/sec, 500K reads/sec, spiky around trending posts.

This case study shows how the individual patterns compose into a working system.

### 38.1 The read-write asymmetry

Reads outnumber writes 10:1. Writes are user-facing (comment submission) so they have to feel instant. Reads are high-QPS and must be fast.

No single DB handles both without bottlenecking somewhere. The move: **separate read and write paths** (§25 CQRS).

### 38.2 Architecture

```
                           ┌──── CDN ──── static rendered pages
                           │
Client ─▶ API Gateway ─┬──▶ Write service ─▶ Postgres (primary) ─▶ CDC ─▶ Kafka
                        │                                                     │
                        │                                                     ▼
                        │                              ┌────────────── materializer ─▶ Redis (sorted sets)
                        │                              │
                        └──────────▶ Read service ─────┘         Redis ─▶ cache-first (§33)
```

### 38.3 Write path — two-stage (§34)

1. **Stage 1 (sync).** API Gateway authenticates, rate-limits (§22 token bucket), assigns a comment ID (§27 Snowflake so comments sort by time), writes to Postgres, returns 200 to user. Target: ~50ms.
2. **Stage 2 (async).** Postgres WAL → CDC → Kafka. Kafka consumers:
   - Materializer updates Redis sorted set for the thread (`ZADD thread:<id> <timestamp> <commentId>`).
   - Notification worker fans out mentions/replies.
   - Moderation worker scans content.

User gets an instant acknowledgement. Everything expensive happens behind the scenes.

### 38.4 Read path — cache-first (§33)

- Thread top-N comments live in Redis as a sorted set (time-ordered).
- Individual comment bodies live in a Redis hash, keyed by comment ID.
- Read request fetches `ZREVRANGE thread:<id> 0 N-1`, then `HMGET` for the bodies.
- Postgres is only touched on cold cache (rare — the working set is hot).

Pre-computing (§26) wins the read path entirely: serving a thread is a Redis lookup, not a DB query with `ORDER BY created_at DESC LIMIT 20`.

### 38.5 Handling the hot-thread problem

A viral thread gets 10,000× the average traffic. Naively, it hammers the one Redis key that holds its sorted set.

- **Read replicas.** Redis replicas carry the read load. Writes go to primary, propagate to replicas.
- **Client-side caching.** Popular threads cached at the CDN or app layer for 1–5 seconds (staleness bounded).
- **Sharding by thread ID.** `thread:<id>` hashes to one of N Redis clusters. One viral thread lands on one shard, but most threads land elsewhere — blast radius contained.

If one thread saturates a shard, fall back to per-thread degradation: serve only the top 100 comments from cache; older comments fall through to DB.

### 38.6 Backpressure

Under sustained overload, Kafka consumer lag grows. That's the signal: stage 2 work is not keeping up.

- If lag < 5s: fine. This is normal burst handling.
- If lag > 30s: Redis reads may be stale; UI should indicate.
- If lag > 5min: shed load at the gateway. Reject new writes with 429 before accepting work that can't land.

The rate limiter at the gateway is the flow-control mechanism; Kafka lag is the signal.

### 38.7 What this shows

No one pattern is load-bearing. The architecture works because:
- §22 rate limits the write side.
- §25 CQRS separates reads and writes.
- §27 Snowflake IDs let comments sort by time without a query.
- §33 cache-first serves reads from Redis.
- §26 pre-computing bakes the thread view at write time.
- §34 two-stage defers expensive work behind a fast ack.
- §12 CDC keeps Redis in sync with Postgres.
- §10 sharding spreads hot keys.

This is the typical shape of a high-QPS real-time feed. Slack, Discord, Reddit, Twitter all sit near this architecture, varying in the specific pieces.

## 39. Case Study — Scalable Services with Message Queues and Caching

A more general sibling to §38: any service with high read QPS, bursty writes, and expensive derivations composes these same building blocks. This section makes the compose-pattern explicit so you can apply it without the comment-specific details.

### 39.1 The four-layer shape

```
Client ─▶ API Gateway ─▶ Stateless App Layer ─▶ Message Queue ─▶ Worker Pool
                               │                                   │
                               ▼                                   ▼
                             Cache                               Database
```

- **API Gateway.** Auth, rate limit, observability, routing. One public surface, many internal services behind it.
- **Stateless App Layer.** Handles read-path cache-hits and writes to the queue. Scales horizontally.
- **Cache.** Serves reads. Populated via CDC or write-through.
- **Message Queue.** Absorbs write bursts. Durable; holds work when workers are slow.
- **Worker Pool.** Drains the queue. Writes to DB. Updates the cache.
- **Database.** The authoritative store. Write-heavy, read-light — because the cache absorbs reads.

### 39.2 Why this composition

The shape isolates scaling concerns:

- **Read QPS.** Absorbed by the cache. Add cache replicas → horizontal read scale.
- **Write bursts.** Absorbed by the queue. Bursts become queue depth, not DB contention.
- **Slow derivations.** Happen in workers. Don't block the API response.
- **DB load.** Smoothed by the queue (bursts averaged out) and reduced by the cache (reads don't reach DB).

### 39.3 Failure mode walkthrough

**DB outage.** Writers queue work. Consumers pause. Reads continue from cache. When DB recovers, consumer catches up. User impact: writes eventually-durable, reads unaffected.

**Cache outage.** Reads bypass to DB. DB starts saturating. Gateway rate limits. Some reads degrade to 503s or stale data. User impact: slower response, possibly partial outage.

**Queue outage.** Writers hit a wall — can't enqueue. API returns 503. Reads continue from cache. User impact: write-side down, read-side up.

**App layer outage.** Load balancer sheds traffic to healthy instances. User impact: reduced capacity, slower p99.

### 39.4 The anti-pattern: synchronous everywhere

Without the queue, every write blocks on the DB. A DB blip becomes a user-facing outage. Without the cache, every read hits the DB. Read burst → DB saturation → p99 cliff.

The queue and the cache are load shock absorbers. Without them, a single-component slowdown anywhere in the stack becomes a user-visible symptom.

### 39.5 Applying this pattern

For a **high-QPS, read-dominated, latency-sensitive** path — feeds, catalogs, dashboards, public APIs — ask:
- "What absorbs bursts if this saturates?" (Often a queue, for the write side.)
- "What serves reads if this is slow?" (Often a cache, for the read side.)
- "What happens to user experience when this fails?" (If the answer is "site goes down," a shock absorber may be warranted.)

**Not every path wants this shape.** Synchronous transactional flows (payments, bookings with strict consistency, anything the user must know succeeded before they move on) don't tolerate the async semantics a queue introduces. Caches add staleness and invalidation complexity that's wrong for data that can never be stale (auth tokens, current balance, inventory near zero). The shape above is a strong default for read-heavy async-tolerant workloads — for strict-consistency paths, apply it selectively or not at all.

### 39.6 Related

- Everything. This is the **composition pattern** the rest of the KB assembles.

---

# Part VIII — SIMFID Runtime (Internal)

*These sections document SystemSim's simulation engine behavior. Not sourced from the external knowledge base — they describe what the sim actually does so the wiki can explain it accurately.*

## 40. Circuit Breaker State Machine

*To be written alongside the wiki copy for `microservice.circuitBreaker` topic. Document the three states (CLOSED, OPEN, HALF_OPEN), the transition conditions (failure-rate threshold over a rolling window to trip, cooldown seconds before half-open, halfOpenTicks probes before re-closing), and the relation to the academic state machine.*

## 41. Retry Storm Amplification

*To be written alongside `microservice.retries` topic. Document the geometric amplification pattern, why aggressive retries make things worse under saturation, and the SIMFID retry policy configuration (maxRetries, backoffMs).*

## 42. Backpressure Propagation

*To be written alongside `microservice.backpressure` topic. Document the one-tick propagation model, threshold-based signaling, and upstream pause behavior.*

## 43. Wire-Level Configuration

*To be written alongside `config.*` wire topics. Document throughputRps, latencyMs, jitterMs semantics and how they compose into end-to-end latency.*

## 44. Traffic Profile Semantics

*To be written alongside `config.traffic.*` topics. Document phase shapes (steady, ramp, spike), jitterPercent, requestMix, userDistribution.*

---

*Populating sections in this order: Scaling Services → Data Storage → How to Scale Databases → Microservices & Data Flow → Patterns & Templates → Big Data → SIMFID Runtime.*
