# Reproduce a cache stampede

A cache stampede happens when a popular key expires and every concurrent reader simultaneously misses, all racing to rebuild it against the origin. The origin collapses under the stampede; the cache stays empty; the problem compounds.

<CanvasEmbed template="cacheStampede" />

## What to watch for

- **Cache hit-rate crashes** the moment the key expires. Log shows a flood of misses.
- **DB connection utilization spikes** as every server instance hammers it simultaneously.
- **Server p99 explodes** — each request is now serialized behind the single cold DB.

## Fix direction

Turn on a **request-coalescer / single-flight lock** on the Cache component (rendering only one origin read per cold key while others wait). Or pre-warm on TTL-1. Or use stale-while-revalidate. See [§10 Caching — Full Curriculum](#docs/reference/10-caching-full-curriculum) §10.5 Failure Modes.
