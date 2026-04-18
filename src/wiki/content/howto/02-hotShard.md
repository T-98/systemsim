# Reproduce a hot shard

A hot shard is when one partition of a sharded database receives disproportionately more traffic than the others — typically because the shard key is the user ID and your platform has power users (celebrities, largest-customer accounts). One shard saturates; the rest are idle.

<CanvasEmbed template="hotShard" />

## What to watch for

- **Shard-2 memory / connection-pool utilization** climbs past 80% while other shards sit near idle.
- **DB p99 is dominated by shard-2** — the slowest shard is the story.
- **A shard-2 memory callout** appears in the log once pressure climbs past 85%.

## Fix direction

- **Partition by content, not by user.** Hash on `(user_id, tweet_id)` or on `tweet_id` alone for a feed system.
- **Detect and split hot users** (the Twitter hybrid — celebs fan-out on read, everyone else on write). See [§25 CQRS & Read-Write Separation](#docs/reference/25-cqrs--read-write-separation) §25.4 Case Study.
- **Cache the hot shard's reads aggressively.**
