# SIMFID Phase 4 — final handoff (2026-04-24)

**Purpose.** Pick up Phase 4 from where the codex-driven fix loop left off. Phase 4 is functionally complete — all 5 feature commits + 7 fix commits have landed, 419 vitest tests + 2 Playwright specs pass, and 7 codex review rounds have driven out 15+ real correctness bugs. **Three remaining items** close the last codex round 7 findings and call the phase done.

**Branch:** `feat/simfid-phase4-schema-driven`
**Parent plan:** [`docs/plans/2026-04-22-simfid-phases-4-8-revised.md`](2026-04-22-simfid-phases-4-8-revised.md)
**Prior handoff (now historical):** [`docs/plans/2026-04-23-simfid-phase4-handoff.md`](2026-04-23-simfid-phase4-handoff.md)
**Research grounding:** [`docs/research/2026-04-22-simfid-fidelity-research.md`](../research/2026-04-22-simfid-fidelity-research.md)

---

## State of the branch at handoff time

```
520d70c fix(engine): ingress-bypass stale detection + unassigned-schema shard fallback + CO timestamp through pendingInbound
580886e fix(engine): whole-chain seed validation + stressed-mode Ca² tracks peak RPS
d4000e0 fix(engine): cap dbArrivalFactor at 1 + useSimulation skips legacy shardKey globals
8f31880 fix(engine): routed heads as topo roots + stale chains excluded from DB attribution
39f90c8 fix(engine): DB-arrival scaling + read_write unique-share + callout gate
7eeef5d fix(engine): fold unattributed DB traffic + unify unindexed-scan denominator
4974f7a docs(plans): progress log + handoff for SIMFID Phase 4 Commits 2-5
1e23c3f feat(engine): Kingman G/G/1 + fan-out tail viz + dispatch-timestamp plumbing
0040d89 feat(engine): per-DB shard cardinality from schemaMemory
d03b798 feat(engine): index coverage → latency multiplier (10x, matches preflight)
803b047 feat(engine): read/write split with split error fields
9538f23 fix(engine): treat duplicate "METHOD PATH" as ambiguous, not last-wins
70d4169 fix(engine): requestMix matches "METHOD PATH" via ApiContract join
9770776 feat(engine): routing context + per-endpoint traffic distribution
```

- 14 commits ahead of `main`. No PR open yet.
- Full vitest suite: **419/419 green** (was 376 before Phase 4 — +43 new regression tests across 7 codex rounds).
- Playwright `simfid-phase4-schema-driven.spec.ts`: **2/2 green** (5.1s).
- Decisions added across the codex rounds: [§60](../../Decisions.md), [§61](../../Decisions.md), [§62](../../Decisions.md), [§63](../../Decisions.md), [§64](../../Decisions.md), [§65](../../Decisions.md). Plus baseline [§53–§59](../../Decisions.md) from the original feature commits.

### What 7 codex rounds drove out

Each round found bugs the prior round's fix exposed — convergence is real but slow:

| Round | Commit | Findings fixed |
|---|---|---|
| 1 | `7eeef5d` | Unattributed DB traffic dropped from r/w split + denominator mismatch in scan callout |
| 2 | `39f90c8` | `read_write` double-count + entry-share-vs-DB-arrival scaling + fallback-only callout gate |
| 3 | `8f31880` | Routed-head topo-roots + stale-chain DB attribution exclusion |
| 4 | `d4000e0` | `dbArrivalFactor` cap at 1 + useSimulation legacy globals |
| 5 | `580886e` | Whole-chain seed validation + stressed-mode Cₐ² tracks peak RPS |
| 6 | `520d70c` | Ingress-bypass stale-head + unassigned-schema shard fallback + CO timestamp through pendingInbound |
| 7 | (open) | LB widget incorrectly applies fanout tail math + multi-hop CO propagation + per-route DB scaling (architectural, deferred) |

---

## Round 7 findings — three remaining items

Codex round 7 surfaced these post-`520d70c`. Items 1 and 2 are bounded fixes; item 3 is a documented limitation (architectural trade-off the prior rounds already accepted in a different form).

### Item 1 — Restrict tail-at-scale explainer to `fanout` only

**Codex citation:** `[P1] Restrict tail-at-scale explainer to true fan-out components — src/components/panels/ConfigPanel.tsx:209-210`

**The bug.** [`FanoutTailSection`](../../src/components/panels/ConfigPanel.tsx) renders `P(slow) = 1 − (1−p)^N` for both `fanout` AND `load_balancer` component types. The math is correct for scatter-gather (every backend hits, slowest dominates), wrong for load-balancing (one backend per request, so tail is the single-backend tail, not compounding).

A user with a load_balancer fronting N=100 backends and `p_single_slow=0.01` currently sees the widget claim ~63% slow-response probability. The actual user-experienced probability is ~1% (whichever single backend served the request).

**Fix.**
- Open [`src/components/panels/ConfigPanel.tsx`](../../src/components/panels/ConfigPanel.tsx).
- Find where `FanoutTailSection` is rendered (search for the section's component name).
- Gate it on `selectedNode?.data.type === 'fanout'` only. Remove `'load_balancer'` from the gating predicate.
- Optional polish: render an alternative section for `load_balancer` showing the single-backend tail (= `p_single_slow`) plus a note explaining the difference between scatter-gather and load-balancing topologies. Skip if the parent plan didn't budget for it.

**Tests.**
- Existing [`engineFanoutTail.test.ts`](../../src/engine/__tests__/engineFanoutTail.test.ts) covers the math; no engine change needed.
- New Playwright assertion (or unit test on the component): when the user selects a `load_balancer` node, the tail-risk text should NOT appear. Skip if a unit-level component test isn't easy — manual verification + a code-review note is sufficient since this is a UI gating change.

**Decisions update.** Append a paragraph to [Decisions §58 (Phase 4.7 fan-out tail viz)](../../Decisions.md) clarifying the widget's scope: "fanout components only — load_balancer routes a request to ONE backend, so tail risk = single-backend p99." Or write a fresh §66 if you prefer a separate decision. Either works.

**Codex prompt for re-review.** "Round 7 [P1] LB-widget fix landed at <SHA>. ConfigPanel.tsx now gates the tail-risk widget on type === 'fanout' only. Confirm the fix doesn't regress fanout rendering, and that no other code path renders the same math against a load_balancer."

---

### Item 2 — Multi-hop CO propagation through in-tick deliveries

**Codex citation:** `[P2] Propagate deferred dispatch timestamps to delivered targets — src/engine/SimulationEngine.ts:1003-1011`

**The bug.** Round-6's `componentEarliestInboundMs` map is populated at tick-start from `pendingInbound`, so the FIRST component receiving deferred traffic emits with the correct `dispatchedAtTickMs`. But the in-tick real-delivery branch in [`emitOutbound`](../../src/engine/SimulationEngine.ts) (lines ~1003-1011, the `else` branch where `eff > 0` and `!deferred`) updates `inboundRps` and `inboundLat` for the target but never writes back to `componentEarliestInboundMs[targetId]`. So when the target later runs in this same tick and emits to its own downstream, the next outcome stamps `this.time * 1000` again — losing the propagated original-dispatch time.

A cycle like `A → B → A → C` exhibits this: tick T+1 merges deferred A inbound, A emits to B with correct earliest=T*1000, but when B emits to A's downstream (C), C sees fresh T+1*1000 because B's `componentEarliestInboundMs` was never seeded.

**Fix.** In `emitOutbound`'s real-delivery branch, after updating `inboundRps` and `inboundLat`, also propagate the dispatch time:

```ts
// In the existing `else` (non-deferred) branch — after the inboundRps/inboundLat updates:
const existingEarliest = this.componentEarliestInboundMs.get(targetId) ?? Number.POSITIVE_INFINITY;
this.componentEarliestInboundMs.set(targetId, Math.min(existingEarliest, dispatchedAtTickMs));
```

This guarantees that the timestamp originating from any deferred source propagates through every downstream emit in the same tick, regardless of how many hops it traverses.

**Tests.** Extend [`fanIn.test.ts`](../../src/engine/__tests__/fanIn.test.ts) `dispatchedAtTickMs on deferred back-edge paths preserves the original dispatch time` test. New variant:

```ts
it('dispatchedAtTickMs propagates through multi-hop in-tick paths after deferral (round 7 [P2])', () => {
  // Cycle A→B→A→C: tick 0 has A→B and back-edge B→A (deferred). Tick 1
  // merges into A's inbound; A emits to B; B emits to C in the SAME
  // tick. The B→C outcome must report dispatchedAtTickMs=0.
  // Pre-fix it stamps 1000 (tick-1 time) because B never inherits A's
  // earliest dispatch.
  const nodes = [
    node('a', 'api_gateway', { isEntry: true, rateLimitRps: 1_000_000 }),
    node('b', 'api_gateway', { rateLimitRps: 1_000_000 }),
    node('c', 'api_gateway', { rateLimitRps: 1_000_000 }),
  ];
  const edges = [
    edge('e_a_b', 'a', 'b'),
    edge('e_b_a', 'b', 'a'),  // back edge
    edge('e_b_c', 'b', 'c'),  // multi-hop tail
  ];
  const engine = new SimulationEngine(nodes, edges, steadyProfile(100), undefined, undefined, SEED);
  engine.tick();  // tick 0 — back edge defers
  engine.tick();  // tick 1 — pendingInbound merges, in-tick A→B→C
  const outcomes = engine.tickOutcomes();
  const bcOutcome = outcomes.find((o) => o.source === 'b' && o.target === 'c');
  expect(bcOutcome).toBeDefined();
  expect(bcOutcome!.dispatchedAtTickMs).toBe(0);
});
```

**Decisions update.** Append a paragraph to [§65](../../Decisions.md) noting the multi-hop completion: "round-7 follow-up extended the propagation to in-tick real deliveries; `componentEarliestInboundMs` now tracks the earliest dispatch across both deferred-pending and in-tick-delivered traffic."

**Codex prompt for re-review.** "Round 7 [P2-CO] fix landed at <SHA>. emitOutbound now propagates `dispatchedAtTickMs` through in-tick real-delivery hops too. Confirm the fix doesn't introduce extra map writes that would degrade tick-time perf, and that the back-edge branch still works correctly."

---

### Item 3 — Document per-route DB arrival scaling as a known limitation (no code change)

**Codex citation:** `[P2] Compute DB arrival scaling per route, not per database — src/engine/SimulationEngine.ts:1508-1526`

**Why we're documenting, not fixing.** `computeDbArrivalFactor` returns a single scalar for all routes reaching a given DB. When two routes have different upstream filter/amplification (e.g., one through a 90%-hit cache, one direct), per-route attribution shares are wrong even though the DB's total RPS is correct.

Fixing this requires either:
- **Per-provenance tracking** through the graph (undoes the §52 fan-in refactor — a Phase 3 invariant SIMFID Phase 3 was built around). Too invasive.
- **Per-chain filter modeling** — walk each route's chain, compute pass-through factor from each component's config (cache hit-rate, fanout multiplier, rate-limit cap), use that to compute per-route DB share. Bounded work but introduces new dependencies (cache hit-rate at tick-start before the cache has run; new accumulator state per component-per-tick). Worth doing as Phase 4.5b in a follow-up if user feedback shows the limitation is real.

**The accepted approximation today:** when ALL routes to a DB share the same upstream filter/amplification (the common case in current scenarios), per-route shares are exactly correct. When they differ, per-route shares are wrong but the DB's total inbound, total error rate, and total saturation are all correct — only per-side / per-table attribution can mislead.

**What to do.** Append a "Known limitation" subsection to [Decisions §61](../../Decisions.md) (or write §66 — author's call):

```markdown
### Known limitation — per-route DB arrival scaling assumes uniform upstream filtering

`computeDbArrivalFactor` collapses every route reaching a DB to a single scalar.
When routes' chains have heterogeneous filter/amplification (one through a cache,
one direct; one through a fanout multiplier, one not), per-route DB shares are
wrong even though the DB's total inbound is correct. This affects:

- `readErrorRate` / `writeErrorRate` per-side attribution — the saturated side
  may be reported wrong if the saturation is driven by a route that filters
  more than another.
- Unindexed-scan callout target naming — may name the wrong endpoint as the
  source of the unindexed traffic.

Aggregate `errorRate`, total DB RPS, and overall saturation behavior are unaffected
— breakers and backpressure (§52, §54) continue to react correctly to total load.

The fix would require either per-provenance tracking through the graph (undoes
the §52 fan-in refactor) or per-chain filter-walking with cache-hit-rate / fanout-
multiplier modeling. Deferred until user feedback shows the limitation matters
in practice. Codex round 7 [P2] flagged this; accepted as a documented
approximation — same trade-off codex flagged in round 4 [P1] in a different skin.
```

**No tests, no commit body fix.** Just the doc paragraph.

**Codex prompt for re-review:** none — this isn't a code change. The next codex review will see the documented limitation and (hopefully) accept it as out of scope.

---

## Workflow per item

Same cadence as the prior 7 rounds (memory pointer: `~/.claude/projects/-Users-divyanshkhare-DeveloperWorkArea-systemsim/memory/feedback_codex_after_each_phase.md`):

1. Implement the item (Item 1, 2, then 3 in that order — do not batch).
2. `pnpm vitest run` — must stay 419+/419+ green.
3. `pnpm playwright test e2e/simfid-phase4-schema-driven.spec.ts` — must stay 2/2.
4. Update [API-Reference.md](../../API-Reference.md), [Decisions.md](../../Decisions.md), [Knowledge.md](../../Knowledge.md) per the per-item guidance above (this is a hard rule; see memory `feedback_always_update_docs.md`).
5. Update this handoff's progress log (below).
6. Update the parent plan's §4.11 Progress log.
7. `git commit` with a `fix(engine|ui): <one-liner>` message.
8. Run `/codex consult` (or `codex review --base main`) per the per-item prompt template above.
9. Surface findings in a `CODEX SAYS` block. If real BLOCKERs surface, fix them as new commits before moving on. Skip DEFENSIBLE NITs with one-line justification.

After Item 3's documentation lands, run **one final `codex review --base main` pass** as the convergence check. If it passes (no P1/P2 findings, or only the documented per-route-scaling limitation), Phase 4 is done.

### Progress log for the three items

- [ ] **Item 1 — `fix(ui): gate tail-risk widget on fanout type only`**
- [ ] **Item 2 — `fix(engine): propagate dispatchedAtTickMs through in-tick real-delivery hops`**
- [ ] **Item 3 — `docs(decisions): document per-route DB scaling as a known limitation`**
- [ ] **Final codex pass for convergence**

---

## After all three items land — Phase 4 closeout

1. **Final `pnpm vitest run` + `pnpm playwright test e2e/simfid-phase4-schema-driven.spec.ts`** — full sanity check. Record counts in the PR description.
2. **Final `codex review --base main`** — must pass with no NEW P1/P2 findings (the per-route-scaling P2 is now documented, codex may or may not reflag it; if it does, point at the documented decision).
3. **Run `/review` (Claude's own self-review)** for a parallel code-review angle.
4. **Update the parent plan's §4.11 Progress log** to mark all three items done and note the convergence.
5. **Do not open a PR yourself.** Memory pointer: `feedback_pr_creation.md`. The user opens PRs; you provide the title + body text only. Draft body must include:
   - Summary of all 14 commits.
   - Test counts: 376 → 422+ vitest, 2/2 Playwright.
   - All 7 codex rounds + the convergence pass — total findings closed: 18+.
   - Decisions added: §53–§66 (whichever final number).
   - Links to the parent plan + research debrief + this handoff.
   - Known deferrals: per-route DB scaling (documented in §61 or §66), Phase 5+ scope.

---

## Files touched (cheat sheet for the items)

| Item | Files to edit |
|---|---|
| 1 | [`src/components/panels/ConfigPanel.tsx`](../../src/components/panels/ConfigPanel.tsx) `FanoutTailSection` gate, [`Decisions.md`](../../Decisions.md) §58 or new §66 |
| 2 | [`src/engine/SimulationEngine.ts`](../../src/engine/SimulationEngine.ts) `emitOutbound` real-delivery branch, [`src/engine/__tests__/fanIn.test.ts`](../../src/engine/__tests__/fanIn.test.ts) new test, [`Decisions.md`](../../Decisions.md) §65 paragraph |
| 3 | [`Decisions.md`](../../Decisions.md) §61 or new §66 only |

---

## Pointers into the existing codebase

- `seedInboundTraffic` (chain-validation reference): [`src/engine/SimulationEngine.ts`](../../src/engine/SimulationEngine.ts) — search for `seedInboundTraffic`.
- `emitOutbound` (where Item 2 edits): same file — search for `emitOutbound`. Real-delivery branch is the `else` after the deferred branch (~lines 1003-1011 at handoff time, but expect line numbers to drift).
- `componentEarliestInboundMs` (the map Item 2 extends): same file — search for the field name.
- `computeDbArrivalFactor` (Item 3 documentation target): same file — search for the method name.
- `FanoutTailSection` (Item 1 target): [`src/components/panels/ConfigPanel.tsx`](../../src/components/panels/ConfigPanel.tsx) — search for the section name.
- `routeReachesDbInLiveGraph` + `routeReachesNodeInLiveGraph` (live-graph validation helpers — reference for any future similar work): same engine file.

---

## Invariants to preserve

These are load-bearing. None of the three items should violate them.

1. **Aggregate `errorRate` remains the breaker/retry/backpressure control signal.** Per-side `readErrorRate` / `writeErrorRate` are diagnostics only. (Decisions §52, §54, §60.)
2. **Routed chain validity is a runtime check, not a preflight assumption.** Stale chains warn-and-degrade; never silently misroute. (§62, §64, §65.)
3. **Per-DB shard derivation is authoritative when schemaMemory is present and assigned.** Constructor globals are a legacy-fallback only path. (§56, §63, §65.)
4. **Fan-in correctness (3-phase tick, §52) is sacred.** Don't write to `inboundRps` / `inboundLat` / `state.metrics.*` outside Phase A seed or a component's own Phase B processor call.
5. **CO-correctness within 1-tick granularity.** `dispatchedAtTickMs` reflects the original request's dispatch time, not the emit time. (§59, §65, item 2 above.)
6. **Don't amend commits. Always create new ones** (project rule, see prior handoff).

---

## When to stop

If the final convergence codex pass surfaces yet more findings, judge:
- **Real BLOCKERs (data corruption, false-positive breaker trips on common topologies):** fix.
- **Edge-case correctness (specific topologies the user is unlikely to author):** document, defer.
- **Architectural changes (per-provenance tracking, per-chain filter modeling):** defer to Phase 4.5b. Don't undo the §52 fan-in refactor.

Phase 4 is unusually complex because it composes 5 interlocking modeling layers (routing, schema, read/write split, scan, Kingman). Codex correctly continues to find composition bugs because those layers DO interact in non-obvious ways. The 7-round + convergence cadence has been worth it. Knowing when to stop matters too — bug-tail length here is genuinely long, and architectural perfection isn't the goal.

Good luck.
