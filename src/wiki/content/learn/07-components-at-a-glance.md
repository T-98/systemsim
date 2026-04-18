# Components at a glance

Six building blocks cover most of what you'll design. Deep-dives are in the Reference tab; this is the one-paragraph version of each.

**Server / Worker.** Stateless compute. Handles requests, talks to data layers, forwards to downstream workers. Configure CPU profile, processing time, instance count, max concurrent. The queueing math (Little's Law) lives here — utilization above ~85% is where latency collapses. See [§7 Performance Fundamentals](#docs/reference/7-performance-fundamentals-latency-throughput-percentiles).

**Database.** Persistent storage. Configure engine (postgres / cassandra / redis), sharding, read replicas, connection pool, replication lag, read/write throughput. The hot-shard model kicks in when `shardKey` includes "user" or cardinality is low. See [§11 Data Storage](#docs/reference/11-data-storage).

**Cache.** In-memory fronting for a slow store. Configure eviction (LRU / LFU / TTL-only), TTL, max memory, write strategy (through / back / around). Miss storms and stampedes are where caches fail — see [§10 Caching](#docs/reference/10-caching-full-curriculum).

**Message Queue.** Async buffering. Configure max depth, consumer groups, per-group parallelism, DLQ, retry count. Adds latency; lets you survive write bursts without back-pressuring the caller. See [§13 Message Queues](#docs/reference/13-message-queues--async-communication).

**Load Balancer.** Distributes across healthy instances. Configure algorithm, health-check interval / timeout, unhealthy threshold. Filters crashed or open-breaker downstreams; splits evenly across survivors. See [§9 Load Balancing](#docs/reference/9-load-balancing).

**API Gateway.** Front door. Configure rate limit RPS, burst, auth middleware, timeout. Rejects before the work reaches a server. See [§15 API Gateway](#docs/reference/15-api-gateway).

Next: [Configuring a component](#docs/learn/configuring-a-component).
