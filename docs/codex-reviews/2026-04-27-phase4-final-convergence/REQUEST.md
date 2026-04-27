# Codex review request — `phase4-final-convergence`

**Requested by:** Claude
**Requested at:** 2026-04-27
**Branch:** `feat/simfid-phase4-schema-driven`
**Base:** `main`
**Codex output goes in:** `OUTPUT.md` (sibling of this file)

---

## What to review

This is the **final convergence pass** for SIMFID Phase 4 after 7 rounds of iterative codex CLI review surfaced 15+ real correctness bugs. The CLI kept timing out on the latest few rounds (it ran `npm run build`, hit 50+ pre-existing ReactFlow TS errors, and burned its output budget). This review is being routed through Codex desktop instead.

The branch is **18 commits ahead of main**. Phase 4 itself ships in 5 feature commits (`9770776`, `803b047`, `d03b798`, `0040d89`, `1e23c3f`) plus 10 codex-driven fix commits (rounds 1–6) plus 4 round-7 commits that closed the last set of findings.

### Artifacts

- **Parent plan:** [`docs/plans/2026-04-22-simfid-phases-4-8-revised.md`](../../plans/2026-04-22-simfid-phases-4-8-revised.md) — Phase 4 spec, Phases 5–8 deferred. §4.11 "Progress log" tracks every codex round.
- **Round-7 handoff:** [`docs/plans/2026-04-24-simfid-phase4-final-handoff.md`](../../plans/2026-04-24-simfid-phase4-final-handoff.md) — what the round-7 commits were supposed to do, with prior-round invariants.
- **Earlier handoff (historical):** [`docs/plans/2026-04-23-simfid-phase4-handoff.md`](../../plans/2026-04-23-simfid-phase4-handoff.md) — context for Commits 2–5.
- **Research grounding:** [`docs/research/2026-04-22-simfid-fidelity-research.md`](../../research/2026-04-22-simfid-fidelity-research.md) — the algorithmic-first / calibration-second / Validation-Mode-as-second-opinion direction the plan locked in.
- **Decisions:** [`Decisions.md`](../../../Decisions.md) §53 (Phase 4 setup), §54 (read/write split semantics), §55 (10× scan factor), §56 (per-DB shard), §57 (Kingman G/G/1), §58 (fan-out tail viz), §59 (CO semantics), §60–§65 (the seven codex rounds).

### Commits to review (chronological)

```
9770776 feat(engine): routing context + per-endpoint traffic distribution
70d4169 fix(engine): requestMix matches "METHOD PATH" via ApiContract join
9538f23 fix(engine): treat duplicate "METHOD PATH" as ambiguous, not last-wins
4974f7a docs(plans): progress log + handoff for SIMFID Phase 4 Commits 2-5
803b047 feat(engine): read/write split with split error fields
d03b798 feat(engine): index coverage → latency multiplier (10x, matches preflight)
0040d89 feat(engine): per-DB shard cardinality from schemaMemory
1e23c3f feat(engine): Kingman G/G/1 + fan-out tail viz + dispatch-timestamp plumbing
7eeef5d fix(engine): fold unattributed DB traffic + unify unindexed-scan denominator
39f90c8 fix(engine): DB-arrival scaling + read_write unique-share + callout gate
8f31880 fix(engine): routed heads as topo roots + stale chains excluded from DB attribution
d4000e0 fix(engine): cap dbArrivalFactor at 1 + useSimulation skips legacy shardKey globals
580886e fix(engine): whole-chain seed validation + stressed-mode Ca² tracks peak RPS
520d70c fix(engine): ingress-bypass stale detection + unassigned-schema shard fallback + CO timestamp through pendingInbound
bf8035d docs(plans): final Phase 4 handoff with codex round 7's three remaining items
c667e73 fix(ui): gate tail-risk widget on fanout type only
3f57b2a fix(engine): propagate dispatchedAtTickMs through in-tick real-delivery hops
08e46e2 docs(decisions): document per-route DB scaling as a known limitation
0f86e2c docs(plans): mark Phase 4 round-7 closeout in parent plan §4.11
```

Pull each diff with `git show <sha>`. The full branch diff is `git diff main..HEAD`.

### Test state

- **Vitest: 420/420 green.** The canonical sanity check is `pnpm vitest run`. Pre-Phase-4 baseline was 376; +44 new regression tests across the 7 codex rounds.
- **Playwright: 2/2 green** — `e2e/simfid-phase4-schema-driven.spec.ts` (`pnpm playwright test e2e/simfid-phase4-schema-driven.spec.ts`).

---

## Context — what each commit is supposed to do

The five Phase 4 feature commits are the foundation. The fix commits each respond to a specific codex finding from the prior CLI round (decisions §60 through §65 document the rounds).

### Feature commits (the 5-commit series the plan §4.10 specified)

- `9770776` — Add optional `RoutingContext` bag (`endpointRoutes`, `schemaMemory`, `requestMix`, `apiContracts`) as the constructor's last positional param. Replace tick-start even-split seed with per-endpoint routing using `requestMix` weights against `EndpointRoute.componentChain[0]`. Fallback layering: matched-mix → `EndpointRoute.weight` → legacy even-split. (Decisions §53.)
- `70d4169` — Match `requestMix` keys by both `endpointId` (uuid) AND `"METHOD PATH"` via the `apiContracts[i].id === endpointRoutes[j].endpointId` join. The Discord scenario authors mix keys as `"POST /event/everyone"` not as uuids. **Risk:** `byMethodPath` map should reject collisions, not silently overwrite.
- `9538f23` — Collisions in `byMethodPath` poison the entry to `null` (ambiguous); ambiguous keys fall to default bucket with one-shot `routing-ambiguous:<key>` callout.
- `803b047` — Read/write split. `ComponentMetrics` gains optional `readErrorRate` / `writeErrorRate`. Per-route attribution via `tablesAccessed` + schema join. Aggregate `errorRate = max(readErrorRate, writeErrorRate, poolDropRate)` so breakers/retry/BP keep reading the aggregate per the §52 fan-in invariant. **Risk areas codex hammered later:** unattributed-traffic remainder, read_write double-count, attribution-ratio gate on saturation callouts, DB-arrival scaling vs entry-share scaling.
- `d03b798` — Unindexed-scan latency multiplier `1 + (10−1) × unindexedShare`, locked to `preflight.ts:140`'s "10× slower" copy. One-shot callout per `(dbId, tableId)` above 5% share, hedged "may include unindexed access" wording. **Risk:** denominator consistency between the multiplier and the callout threshold.
- `0040d89` — Per-DB `resolveShardKeyForDb(dbId)` helper. 4-layer fallback: schema entity with `assignedDbId === dbId` → `state.config.shardKey` → legacy constructor globals → `{null, 'high'}`. **Risk:** legacy globals leaking across DBs when the schema is partially assigned.
- `1e23c3f` — Three-in-one: Kingman G/G/1 in `QueueingModel.computeQueueing` (Whitt 1993 two-moment, `serviceVariance` config + arrival-variance from phase shape); Dean-Barroso fan-out tail viz in `ConfigPanel.tsx`; coordinated-omission `WireTickOutcome.dispatchedAtTickMs` plumbing.

### Fix commits (codex rounds 1–6)

The progressive-tightening sequence. Each one closed findings the prior round flagged — codex CLI session IDs and per-round Decisions entries are all linked from the parent plan §4.11.

- Rounds 1–2 (`7eeef5d`, `39f90c8`) — DB attribution fundamentals.
- Round 3 (`8f31880`) — topo roots include routed heads + stale-chain detection in attribution.
- Round 4 (`d4000e0`) — `Math.min(1, ...)` cap on `dbArrivalFactor`; `useSimulation` stops projecting first-entity shardKey as a global.
- Round 5 (`580886e`) — whole-chain seed validation; stressed-mode Cₐ² tracks peak RPS not current-time RPS.
- Round 6 (`520d70c`) — ingress-bypass detection (head-with-predecessors-and-not-entry); restored shardKey legacy fallback for unassigned schemas; `componentEarliestInboundMs` map propagates earliest dispatch through `pendingInbound`.

### Round 7 commits (the final handoff items)

- `c667e73` — Narrow `FanoutTailSection`'s render gate from `load_balancer | fanout | api_gateway` to `data.type === 'fanout'` only. Dean-Barroso math `1 − (1−p)^N` only applies to scatter-gather; LBs/api-gateways route ONE request to ONE backend, so the widget claimed ~63% slow on a 100-backend LB at p=1% when the actual rate is ~1%. Decisions §58 round-7 paragraph appended.
- `3f57b2a` — Round-6's `componentEarliestInboundMs` was seeded only from `pendingInbound` at tick-start. When the FIRST hop receiving deferred traffic emitted to its own downstream IN THE SAME TICK, the next outcome stamped fresh `this.time * 1000` because `emitOutbound`'s real-delivery branch never wrote back to the map. Cycle `A→B→A→C` exposed it. Fix: in non-deferred branch, after `inboundRps`/`inboundLat` updates, also `componentEarliestInboundMs[targetId] = Math.min(existing, dispatchedAtTickMs)`. New `fanIn.test.ts` `multi-hop in-tick paths` test.
- `08e46e2` — Pure docs. Adds a "Known limitation" subsection to Decisions §61 documenting the per-route DB arrival scaling approximation (when routes have heterogeneous upstream filter/amplification, per-side / per-table attribution can mislead, but aggregate stays correct). Architectural fix deferred to Phase 4.5b.
- `0f86e2c` — Pure docs. Marks the round-7 closeout in the parent plan §4.11 progress log.

---

## Specific questions (bug-focused)

Highest-leverage areas first. CLI round 8 attempted to cover all of these but timed out — that's why we're here.

### Cross-commit composition

The 5 layers (routing, schema, read/write split, scan, Kingman) interact in non-obvious ways. The whole reason codex CLI rounds 1–7 found bugs is that the layers expose each other.

1. **Read/write split + unindexed-scan multiplier.** Do they double-apply to anything? Specifically: when a route's `tablesAccessed` declares both `mode: 'write'` and `indexed: false`, does the latency multiplier compose correctly with the write-side saturation, or does the route get charged twice?
2. **Kingman + hot-shard.** When `serviceVariance > 1` AND a DB has Pareto hot-shard distribution, do shard-local utilizations compose correctly with Kingman's per-component waits? Or does the hot-shard amplifier interact with Cₐ² in a way that double-counts variance?
3. **DB-arrival scaling + fan-in correctness.** `computeDbArrivalFactor` is `Math.min(1, totalInboundRps / entryShareToDb)`. The §52 fan-in invariant guarantees aggregate `errorRate` is correct. Does the round-4 cap interact with any path that reads aggregate `errorRate` such that the cap silently hides real saturation?
4. **CO multi-hop propagation + cycles deeper than 2.** The new test pins A→B→A→C. Does the propagation correctly handle deeper cycles like A→B→C→A→D, or A→B→A→C with multiple deferred branches? Walk through the `componentEarliestInboundMs` updates step by step.

### Suspected docs inconsistency (Claude's own pre-flag)

Claude noticed during the CLI round 8c traces that codex was about to flag this just before timing out:

5. **Decisions §61 "Rejected: Clamping `dbArrivalFactor` at 1"** ([`Decisions.md`](../../../Decisions.md) line ~694) contradicts §63's actual decision to clamp at 1 (round-4 fix `d4000e0`). The §61 entry was written for round 2; round 4 reversed the rejection. The §61 "Known limitation" subsection that round-7's Item 3 added (lines ~698–707) documents the consequence of clamping, but the older "Rejected" bullet wasn't updated. The code state IS consistent (the cap is in place); the doc trail is contradictory. Confirm or reject; suggest the cleanest fix (parenthetical cross-ref vs. rewrite).

### Per-commit specifics

#### `c667e73` — LB widget gate

6. Is `data.type === 'fanout'` exhaustive? Are there other component types in the codebase that do scatter-gather and would benefit from the Dean-Barroso compounding math? Codex CLI round 8c mid-stream confirmed `fanout` is the only true scatter-gather processor, but please double-check.
7. Does the change to `ConfigPanel.tsx` remove anything else the old multi-type gate was needed for? (The old gate covered `load_balancer | fanout | api_gateway`.)

#### `3f57b2a` — CO multi-hop

8. Does `Math.min(existing, dispatchedAtTickMs)` in the non-deferred branch correctly compose when a target receives BOTH deferred-from-prior-tick traffic AND fresh in-tick traffic in the same tick? Walk through the `componentEarliestInboundMs` updates — both branches should converge on monotonic min.
9. Perf: the new write fires on EVERY in-tick delivery, including ones whose `dispatchedAtTickMs` equals the current tick (no deferral involvement). Is the per-emit `Map.get` + conditional `Map.set` a perf concern at any realistic graph size? CLI r8d said no but the analysis was light.
10. Does the new cycle test pin behavior tightly enough to catch a regression that re-introduces the round-7 [P2] bug? Or is the assertion too coarse?

#### `08e46e2` — Per-route DB scaling docs

11. Does the documented limitation accurately describe what `computeDbArrivalFactor` actually does, or has the code drifted from the description?
12. Is the asserted "Aggregate `errorRate`, total DB RPS, and overall saturation behavior are unaffected" correct given the round-2 / round-4 fixes? Verify against the actual control flow in `processDatabase`.

### Anything else

13. Anything in the 18-commit branch that's plausibly broken under realistic user topologies (the Discord scenario, a Reddit-cache-stampede shape, a CDN-fronted API) and isn't already covered by the §60–§65 decisions or the test suite?

---

## Out of scope (don't burn budget on these)

- **Pre-existing TS errors.** ~50 ReactFlow `Node<SimComponentData>` constraint errors that predate Phase 4. They're consistently ignored across the codebase (Canvas.tsx, debrief.ts, every engine test, store/index.ts, layout/dagre.ts). DO NOT run `npm run build`, `tsc`, `pnpm build`. Use `pnpm vitest run` instead — it passes 420/420.
- **Phases 5–8.** Out of scope for this branch. Deferred per the parent plan.
- **Architectural redesigns.** Per-provenance tracking through the graph (would undo the §52 fan-in refactor) is explicitly rejected as too invasive. Per-chain filter-walking for DB attribution is documented as a Phase 4.5b follow-up.
- **Lint debt** unrelated to the commits under review.

---

## Expected output format

Write your verdict to the sibling `OUTPUT.md` using this template:

```markdown
# Codex review output — `phase4-final-convergence`

**Reviewed at:** YYYY-MM-DD HH:MM
**Reviewer:** Codex desktop

## Findings

### Cross-commit composition

- **<BLOCKER | NIT | DEFENSIBLE | OK>**: <finding> — `<file>:<line>` — addresses question #<n>
- ...

### Per-commit

#### `c667e73`

- **OK | NIT | …**: <finding> — addresses question #<n>

#### `3f57b2a`

- ...

#### `08e46e2`

- ...

### Suspected docs inconsistency (question #5)

- <verdict + suggested fix shape>

### Anything else (question #13)

- <novel concern, or "none">

## CONSENSUS

`CONSENSUS: <one of:>`

- `convergence — no findings, ready to ship`
- `<N> findings remain — <one-line summary>`
- `architectural concern, see above — needs human triage`
```

---

## Trigger

Claude waits for the user to say *"codex review done"* (or similar) before reading `OUTPUT.md`.
