# SIMFID Phase 4 — handoff for Commits 2-5 (2026-04-23)

**Purpose.** Continue Phase 4 implementation from where Commit 1 (and two codex-driven fix commits) left off. This document is self-contained so any agent (or human) can pick up the work without reading the prior conversation.

**Branch:** `feat/simfid-phase4-schema-driven`
**Parent plan:** [`docs/plans/2026-04-22-simfid-phases-4-8-revised.md`](2026-04-22-simfid-phases-4-8-revised.md) (authoritative — read it first)
**Research grounding:** [`docs/research/2026-04-22-simfid-fidelity-research.md`](../research/2026-04-22-simfid-fidelity-research.md)

---

## State of the branch at handoff time

```
9538f23 fix(engine): treat duplicate "METHOD PATH" as ambiguous, not last-wins
70d4169 fix(engine): requestMix matches "METHOD PATH" via ApiContract join
9770776 feat(engine): routing context + per-endpoint traffic distribution
ebb5e50 plan(simfid): revised Phases 4-8 plan grounded in research debrief
83ce973 docs(research): SIMFID fidelity + approach research debrief
```

- Branch is ahead of `main` by those 5 commits. No PR open yet.
- Full vitest suite: **378/378 green.** Playwright not yet re-run since Commit 1 shipped (the parent plan lists `simfid-phase4-schema-driven.spec.ts` as a deliverable — do not create it until after Commit 3 so the unindexed-scan callout actually fires).
- Pre-existing `tsc --noEmit` errors (~40) all trace to ReactFlow's `Node<SimComponentData>` generic constraint. They predate Phase 4 and are consistently ignored across the codebase (Canvas.tsx, debrief.ts, every engine test). Do not try to fix them as part of Phase 4.

### What Commit 1 delivered

- `RoutingContext` interface exported from [`src/engine/SimulationEngine.ts`](../../src/engine/SimulationEngine.ts): `{ endpointRoutes?, schemaMemory?, requestMix?, apiContracts? }`.
- Optional `routingContext?: RoutingContext` as the trailing positional param on `SimulationEngine`'s constructor. Additive — every pre-Phase-4 call site still works.
- `seedInboundTraffic(rpsPerTick, logs)` replaces the tick-start even-split. Full fallback layering per §4.2 of the parent plan.
- Three engine fields now populated from routing context: `this.endpointRoutes`, `this.schemaMemory`, `this.apiContracts`. **Commits 2-5 should read from these fields, not re-derive.**
- [`src/engine/useSimulation.ts`](../../src/engine/useSimulation.ts) passes the bag from store + profile into the engine.
- [`src/engine/__tests__/engineRoutingDistribution.test.ts`](../../src/engine/__tests__/engineRoutingDistribution.test.ts) — 7 passing tests, canonical reference for how to construct engines with routing context.

### Invariants learned from Commit 1 codex rounds

These are the rules the agent continuing the work MUST honor. Each cost a codex round to discover.

1. **`EndpointRoute.endpointId` is the uuid from `ApiContract.id`, not a path string.** If you need to match scenario-authored data keyed on paths, do it via the contract join (`contract.id === route.endpointId` → `"METHOD PATH"`). Commits 2-5 do not need this today, but if you add any new scenario-facing matching surface, reuse the `byMethodPath` pattern from `seedInboundTraffic`.
2. **Don't silently misroute. Warn and degrade.** Any case where user data is ambiguous (e.g., duplicate METHOD+PATH, stale `componentChain[0]`, schema→DB assignment dangling) should fire a one-shot callout via `this.fireCallout(logs, componentId, calloutType, message)` and fall through to a safe default. Silent misrouting is the behavior codex will catch.
3. **`fireCallout` dedupes on `componentId + ':' + calloutType`.** Collisions in the key produce swallowed warnings — bake the endpoint id / db id / table id into `calloutType`.
4. **Fan-in correctness (Decisions §52) is sacred.** The 3-phase tick model guarantees every component's processor runs exactly once per tick against the aggregate inbound. Anything Commits 2-5 add that writes to `inboundRps` / `inboundLat` / `state.metrics.*` must do so either during Phase A seeding or inside the component's own processor call during Phase B. Never write `state.metrics.errorRate` from a caller; compute inside the processor and let Phase C mirror it per wire.
5. **New `ComponentMetrics` fields must be additive + optional.** Breakers, retry, backpressure still read `state.metrics.errorRate` (the aggregate). Any per-DB-read or per-DB-write split must label itself as a diagnostic, not a control signal. This is the §4.3 compromise codex signed off on — do not change it.
6. **Scan factor is 10×, matching preflight's copy** ([`src/engine/preflight.ts:136`](../../src/engine/preflight.ts)). Not 8×, not 50×. Engine and preflight must agree.
7. **Never amend commits. Always create new ones.** User preference + gstack rule. If you need to fix something about the immediately prior commit, commit it as its own `fix(engine): <what>` with a reference to what it's correcting.

---

## The codex-after-every-commit rule

**Every commit inside Phase 4 gets an immediate `/codex consult` before you move to the next one.** Memory pointer: [`~/.claude/projects/-Users-divyanshkhare-DeveloperWorkArea-systemsim/memory/feedback_codex_after_each_phase.md`](~/.claude/projects/-Users-divyanshkhare-DeveloperWorkArea-systemsim/memory/feedback_codex_after_each_phase.md).

Workflow per commit:

1. Implement the commit + tests.
2. `pnpm vitest run` — all tests must pass. Full suite, not just the new one.
3. Update [API-Reference.md](../../API-Reference.md), [Decisions.md](../../Decisions.md), [Knowledge.md](../../Knowledge.md) as relevant (this is a hard rule — see memory `feedback_always_update_docs.md`).
4. `git commit` with the conventional message from §4.10 of the parent plan.
5. **Run `/codex consult`** with a prompt that:
   - Names the commit SHA + what it's supposed to do
   - Points to the specific files changed
   - Lists bug-focused questions (see the Commit 1 prompt in the session transcript as a template, or reuse the structure below)
   - Asks for verdicts labeled `BLOCKER / NIT / DEFENSIBLE / OK`
6. Surface the full codex output in a `CODEX SAYS` block to the user.
7. Fix real BLOCKERs as new commits (repeat codex cycle). Skip DEFENSIBLE NITs with a one-line justification recorded in the plan's Progress log.
8. Only then proceed to the next commit.

**Template for codex prompts (adapt per commit):**

```
IMPORTANT: Do NOT read or execute any files under ~/.claude/, ~/.agents/,
.claude/skills/, or agents/. Stay focused on repository code only.

You are a brutally honest technical reviewer. Review commit <SHA> on branch
feat/simfid-phase4-schema-driven.

What this commit is supposed to do: <paraphrase + link to plan section>

Files touched: <list, use `git show <SHA> -- <path>` to see each delta>

Bug-focused review — label each finding BLOCKER / NIT / DEFENSIBLE. Cite file:line.

1. <specific risk area #1>
2. <specific risk area #2>
...

One terse CODEX SAYS block. No rewriting.
```

Codex session is sticky — `.context/codex-session-id` holds the prior thread id, and resume reuses it so codex remembers the branch context from earlier commits. Use `codex exec resume <id> ...` when the session file exists.

---

## Commit 2 — read/write split with split error fields

**Plan reference:** §4.3 of [`docs/plans/2026-04-22-simfid-phases-4-8-revised.md`](2026-04-22-simfid-phases-4-8-revised.md).

### Scope

Database processor computes separate `readErrorRate` and `writeErrorRate` additive fields alongside the existing aggregate `errorRate`. `errorRate = max(readErrorRate, writeErrorRate)` so fan-in / breaker / retry / backpressure keep working against the aggregate.

### Where to edit

- [`src/types/index.ts`](../../src/types/index.ts) around `ComponentMetrics` (add optional `readErrorRate?: number`, `writeErrorRate?: number`).
- [`src/engine/SimulationEngine.ts`](../../src/engine/SimulationEngine.ts) — find `processDatabase` (currently around line 1020-1200). Build the read/write inbound breakdown by walking `this.endpointRoutes`:

  ```
  for each endpoint E whose componentChain includes this DB id:
    for each TableAccess TA in E.tablesAccessed where TA.tableId lives on this DB:
      if TA.mode === 'read'       → inboundReadRps  += share(E)
      if TA.mode === 'write'      → inboundWriteRps += share(E)
      if TA.mode === 'read_write' → both += share(E)
  ```

  `share(E)` is the per-endpoint RPS computed the same way `seedInboundTraffic` does it — consider extracting a helper that returns `Map<endpointId, rps>` so both Commits 2, 3 (index coverage) and 4 (shard cardinality) can consume it.

  "Tables on this DB" requires the schema join: `schemaMemory.entities.filter(e => e.assignedDbId === dbId).map(e => e.id)` — tables belong to entities, and entities assign to DBs via `assignedDbId`.

- Capacity math:
  ```
  readCapacity  = readThroughputRps × (1 + readReplicas)
  writeCapacity = writeThroughputRps
  ```
  These knobs already exist on the DB component config.
- Saturation → errorRate: reuse the existing DB saturation curve. Apply it separately to read and write sides. Store `state.metrics.readErrorRate` and `state.metrics.writeErrorRate` on the component. Set `state.metrics.errorRate = Math.max(readErrorRate, writeErrorRate)`.

### Fallback — when there's no usable routing context

If `this.endpointRoutes` is empty OR no endpoint chain visits this DB, fall back to treating all inbound as a 70/30 read/write mix (matches typical load-generator defaults). Document the 70/30 as a constant at the top of `processDatabase` with a comment pointing to this handoff.

### Tests

Create `src/engine/__tests__/engineReadWriteSplit.test.ts`. Canonical case from §4.9.2 of the parent plan:

- DB with `readThroughputRps=1000`, `writeThroughputRps=100`, `readReplicas=1`.
- Two endpoints, one `mode: 'read'` and one `mode: 'write'`, each at 250 rps (500 total).
- Assert: `readErrorRate ≈ 0` (250 / 2000 = 12% utilization, no errors), `writeErrorRate > 0` (250 / 100 → saturated), `errorRate === max(readErrorRate, writeErrorRate) === writeErrorRate`.

Second test: fallback case (no routing context) — assert a 70/30 split of 500 rps produces `readErrorRate ≈ 0.x` and `writeErrorRate ≈ 0.y` consistent with the 350/150 breakdown against 2000/100 capacity.

### Docs to update

- **API-Reference.md** — add `readErrorRate?`, `writeErrorRate?` to the `ComponentMetrics` documentation.
- **Decisions.md** — new entry §54 documenting the "diagnostic, not control signal" semantics. Quote the §4.3 compromise verbatim.
- **Knowledge.md** — in the DB processor subsection, note the read/write split + the 70/30 fallback.

### Codex consult prompt (for this commit specifically)

Focus points:

1. Is `share(E)` computed consistently with `seedInboundTraffic`? Any double-counting when the same endpoint's chain visits the DB through multiple hops?
2. What happens when a DB has `readReplicas = 0`? `writeThroughputRps = 0`? Division-by-zero?
3. Does the fallback 70/30 branch interact correctly with existing hot-shard Pareto distribution (`src/engine/SimulationEngine.ts` around line 1119, `user` shard key heuristic)?
4. Do breaker evaluations (Phase C) still read the aggregate `errorRate` correctly? Any wire that now trips on one side but not the other?
5. Cross-check: does the UI's debrief assume single `errorRate` anywhere that the split would surprise?

---

## Commit 3 — index coverage → latency multiplier (10×)

**Plan reference:** §4.4.

### Scope

When an endpoint's `TableAccess.indexed === false` fires against a DB, the DB's baseline `dbLatency` gets multiplied by `(1 + (scanFactor - 1) × unindexedShare)` where `scanFactor = 10`.

### Where to edit

- [`src/engine/SimulationEngine.ts`](../../src/engine/SimulationEngine.ts) `processDatabase`. Immediately after computing the base `dbLatency = baseLatency × loadFactor + connectionPenalty`, iterate endpoints visiting this DB and apply the multiplier by share.
- The `10×` constant must match [`src/engine/preflight.ts:136`](../../src/engine/preflight.ts) — preflight currently tells users "Missing index on `<field>` — slower reads" and the copy says 10×. **If preflight's multiplier changes, this commit must change in lockstep.**

### Callout

One-shot per `(dbId, tableId)` when the unindexed share exceeds 5% of DB inbound:

```
fireCallout(logs, dbId, `unindexed-scan:${tableId}`,
  `${dbId}: possible unindexed access on "${tableName}" via ${endpointId} — add an index`);
```

Wording from §4.4 uses "may include unindexed reads via …" because `tablesAccessed` is coarse (per codex's earlier review of the original plan). Do not assert "scan" — say "may include unindexed access."

### Tests

`src/engine/__tests__/engineTableScan.test.ts`. Canonical case:

- DB with `TableAccess.indexed = false` on 20% of traffic.
- Assert measurable p50 latency increase proportional to the unindexed share.
- Assert callout fires exactly once.

### Codex consult prompt

1. Does the `(1 + (scanFactor - 1) × share)` math match the parent plan's example (`7% × 0.01 = 7% latency hit for 1% of traffic unindexed`)?
2. Share denominator — is it the DB's total inbound RPS post-routing-context, or pre-? Any off-by-one when Commit 2's split is also active?
3. Does the callout fire correctly across multiple runs of the same engine instance (`firedCallouts` set persists)?
4. Preflight drift — did preflight.ts change the 10× copy since this commit was written?

---

## Commit 4 — per-DB shard cardinality from schemaMemory

**Plan reference:** §4.5.

### Scope

Replace the constructor-level global `schemaShardKey + schemaShardKeyCardinality` with a per-DB derivation from `this.schemaMemory.entities`. Keep the constructor args as a legacy fallback — do NOT break existing tests.

### Where to edit

- [`src/engine/SimulationEngine.ts`](../../src/engine/SimulationEngine.ts) `processDatabase`. Find where `this.schemaShardKey` is read (probably in the hot-shard Pareto branch around line 1119). Replace with a helper:

  ```ts
  private resolveShardKeyForDb(dbId: string): { shardKey: string | null; cardinality: 'low' | 'medium' | 'high' } {
    // 1. schemaMemory: first entity assigned to this DB that has a partitionKey.
    //    cardinality derives from either partitionKeyCardinalityWarning (→ 'low')
    //    or the field's own `cardinality` value.
    // 2. state.config.shardKey on the DB node (if set).
    // 3. Legacy constructor-level this.schemaShardKey.
    // 4. null / 'high' if none of the above.
  }
  ```

- The existing `user` hot-shard heuristic should keep working because the helper still returns `state.config.shardKey`-derived results when schema derivation yields nothing. **Before committing, grep for every call site reading `this.schemaShardKey` / `this.schemaShardKeyCardinality` and route them through the new helper.**

### Tests

`src/engine/__tests__/engineShardCardinality.test.ts`:

- Two DBs, one with a `partitionKey` field on an assigned entity whose `cardinality='low'`, one with `cardinality='high'`.
- Run both under hot-shard traffic. Assert the low-cardinality DB shows Pareto hot-shard distribution on `shardLoads`, the high-cardinality DB does not.

### Docs

- Decisions.md new entry — per-DB shard derivation supersedes the constructor global.
- API-Reference.md — note `schemaShardKey` / `schemaShardKeyCardinality` constructor args are now legacy fallbacks.

### Codex consult prompt

1. Does the helper resolve correctly when `schemaMemory` is null (scenario without schema pass)?
2. What happens when an entity's `partitionKey` names a field that isn't in `entity.fields`? Defensive handling?
3. Does the hot-shard Pareto heuristic ever run when the DB has no incoming traffic this tick? Check tick-start zero-ing.
4. Dangling `assignedDbId` (schema references a DB that was deleted from the graph) — does the helper degrade gracefully?

---

## Commit 5 — Kingman G/G/1 + fan-out tail viz + dispatch-timestamp plumbing

**Plan reference:** §4.6, §4.7, §4.8.

### Scope (three-in-one — the largest commit of Phase 4)

1. **Kingman G/G/1** replaces M/M/1 in [`src/engine/QueueingModel.ts`](../../src/engine/QueueingModel.ts) `computeQueueing`. Formula:
   ```
   W = ρ/(1 − ρ) × (Cₐ² + C_s²)/2 × τ
   ```
   - `C_s²` reads a new optional component config `serviceVariance` (default `1.0` = exponential, reproduces M/M/1 behavior for backward compat).
   - `Cₐ²` is modeled from the traffic phase: `steady → 1.0`, `ramp_up/ramp_down → ~2.0`, `instant_spike → ~4.0`. Per codex's earlier review of the plan, `Cₐ²` is a **modeled prior**, not a measured property — do not try to derive it from observed inter-arrival times.
   - Whitt 1993 validates the two-moment approximation. Cite in the docstring.

2. **Dean-Barroso fan-out tail visualization** — pure UI, no engine change. When the inspector panel has an LB or `fanout` component selected, compute `P(slow) = 1 − (1 − p_single_slow)^N` using the selected component's fanout factor + the downstream component's observed `p99`. Sparkline showing how it scales with N. Location likely in `src/components/panels/ConfigPanel.tsx` or a new inspector section. Reference: Dean & Barroso, "The Tail at Scale," CACM 2013.

3. **Coordinated-omission plumbing** — add `dispatchedAtTickMs: number` to the in-flight request record used by Phase B. Record latency against `t_response − dispatchedAtTickMs`, not `t_response − t_actual_dispatch`. Update the engine docstring's CO claim from "CO-safe by construction" (which codex called overstated) to "CO-correct within the 1-tick granularity" — see the change already made in §4.8 of the parent plan.

### Tests

- `engineKingman.test.ts` — `serviceVariance=4.0` must show meaningfully higher p99 than `serviceVariance=1.0` at the same utilization. Also: `serviceVariance=1.0` must reproduce pre-Commit-5 behavior exactly (no regression in existing suite).
- `engineFanoutTail.test.ts` — the compounding math: p99 at N=100 fan-out with 1%-slow backends matches Dean-Barroso's ~63%.
- Playwright `simfid-phase4-schema-driven.spec.ts` — Discord scenario run, assert the unindexed-scan callout (from Commit 3) fires and the log shows the endpoint + table.

### Docs

- Decisions.md — three new entries (Kingman, fan-out viz, CO semantics).
- Knowledge.md — update `## Queueing math` subsection with the Kingman formula.
- API-Reference.md — new `serviceVariance?: number` in component config docs.

### Codex consult prompt

1. Kingman degenerate case: when `Cₐ² = C_s² = 1.0`, the formula reduces exactly to M/M/1. Does the code produce bit-identical results to pre-commit behavior in that case?
2. Phase-mapping for arrival variance — is the `spike → 4.0` / `ramp → 2.0` / `steady → 1.0` mapping defensible? Any phase shape unhandled?
3. Fan-out viz math — is `p_single_slow` sourced from the actually-observed `p99` or a synthetic threshold? Document.
4. Dispatch-timestamp plumbing — does every path that records latency (server, cache, DB, queue, LB) route through the new timestamp, or did something get missed?
5. Does the engine docstring at the top of `SimulationEngine.ts` still claim "CO-safe by construction" anywhere? It shouldn't — find-and-replace with "CO-correct within 1-tick granularity."

---

## General hygiene checklist — run before each commit

1. `pnpm vitest run` — every test green, not just the new one. Record the count in the commit message.
2. Grep for dead code, unused imports, unused locals. `pnpm eslint` if it's set up (it may not be).
3. Update the three doc files ([API-Reference.md](../../API-Reference.md), [Decisions.md](../../Decisions.md), [Knowledge.md](../../Knowledge.md)) — this is not optional.
4. Update this handoff doc's Progress log (below) marking the commit done.
5. Update the parent plan's §4.11 Progress log.
6. Commit message follows `feat(engine): <what>` from §4.10 of the parent plan.
7. Run `/codex consult` immediately after the commit. Fix real BLOCKERs as new commits.
8. Move on.

### Progress log for Commits 2-5 (update as you go)

- [x] Commit 2 — `feat(engine): read/write split with split error fields` (2026-04-24; 384/384 vitest; see Decisions §54; codex unavailable in this sandbox → adversarial review deferred to end-of-phase Agent subagent)
- [ ] Commit 3 — `feat(engine): index coverage → latency multiplier (10x, matches preflight)`
- [ ] Commit 4 — `feat(engine): per-DB shard cardinality from schemaMemory`
- [ ] Commit 5 — `feat(engine): Kingman G/G/1 + fan-out tail viz + dispatch-timestamp plumbing`

---

## After Commit 5 — closing out Phase 4

1. End-of-phase codex review on the combined diff vs. `main`. Prompt should ask codex to re-check the composition of all five commits, especially:
   - Read/write split interacting with the unindexed-scan multiplier (does the scan multiplier apply to both read and write latency, or only reads?)
   - Kingman interacting with hot-shard distribution (do shard-local utilizations compose correctly with Kingman's per-component waits?)
   - Fan-out viz reading the right downstream metric (the commit might need post-Commit-5 adjustments if p99 is now Kingman-shaped).
2. Run the full Playwright suite — `pnpm playwright test`. The existing 40 specs must all still pass; the new `simfid-phase4-schema-driven.spec.ts` is part of Commit 5's deliverable.
3. **Do not open a PR yourself.** Memory pointer: `feedback_pr_creation.md`. The user opens PRs; you provide the title + body text only. Draft body should include:
   - Summary of the five commits.
   - Test counts before and after.
   - Codex review outcomes per commit (include session IDs if available).
   - Links to the parent plan + research debrief.
   - Known deferrals (Phase 5+, and any DEFENSIBLE NITs skipped with reasoning).
4. Run `/review` (Claude's own review) for a final self-check before handing the PR body to the user.

---

## Files you will touch in Commits 2-5 (cheat sheet)

| Commit | Engine files | Test files | Docs |
|---|---|---|---|
| 2 | SimulationEngine.ts, types/index.ts | engineReadWriteSplit.test.ts | API-Reference, Decisions §54, Knowledge |
| 3 | SimulationEngine.ts | engineTableScan.test.ts | Decisions §55, Knowledge |
| 4 | SimulationEngine.ts | engineShardCardinality.test.ts | API-Reference, Decisions §56 |
| 5 | SimulationEngine.ts, QueueingModel.ts, ConfigPanel.tsx (or new inspector section) | engineKingman.test.ts, engineFanoutTail.test.ts, e2e/simfid-phase4-schema-driven.spec.ts | API-Reference, Decisions §57-59, Knowledge |

Commits 2 and 3 share a helper you should probably extract: the per-endpoint share map `Map<endpointId, rps>` that `seedInboundTraffic` computes. Either expose it as a private method on the engine or memoize it per-tick. Pulling it out once is cheaper than doing it twice (once for read/write split, once for index-coverage multiplier).

---

## Pointers into the existing codebase

- `seedInboundTraffic` (reference for per-endpoint share logic): [`src/engine/SimulationEngine.ts:456`](../../src/engine/SimulationEngine.ts) approx.
- `processDatabase` (where Commits 2, 3, 4 all edit): same file, search `processDatabase`.
- `QueueingModel.computeQueueing` (where Commit 5's Kingman lands): [`src/engine/QueueingModel.ts`](../../src/engine/QueueingModel.ts).
- `fireCallout`: same file as engine, search `private fireCallout`.
- `topologicalOrder`: [`src/engine/graphTraversal.ts`](../../src/engine/graphTraversal.ts).
- Fan-in 3-phase tick (context for invariant #4 above): [`src/engine/__tests__/fanIn.test.ts`](../../src/engine/__tests__/fanIn.test.ts) + Decisions §52.

Good luck.
