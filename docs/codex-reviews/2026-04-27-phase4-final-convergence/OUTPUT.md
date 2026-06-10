# Codex review output — `phase4-final-convergence`

**Reviewed at:** 2026-04-27 16:03 PDT
**Reviewer:** Codex desktop

## Findings

### Cross-commit composition

- **BLOCKER**: The documented per-route DB scaling limitation is not only diagnostic. With a route like `svc -> fanout(multiplier=10) -> db` whose `tablesAccessed` is `mode: 'write'`, `processFanout` correctly sends 10x RPS to the DB, but `computeDbArrivalFactor` caps route attribution at the seeded entry share. The amplified 9x remainder then falls through the 70/30 default split. Example: 100 routed writes fan out to 1000 DB writes; with `writeThroughputRps=500` and a large read capacity, code computes `100 attributed writes + 270 fallback writes = 370`, so `writeErrorRate=0` and aggregate `errorRate=0`, while the modeled topology is actually 1000 writes / 500 capacity and should trip the aggregate control signal. Because breakers/retry/backpressure read `metrics.errorRate`, the cap can silently hide real saturation in a realistic Discord-style fanout write path. This contradicts the "aggregate unaffected" language in Decisions and the parent plan. — `src/engine/SimulationEngine.ts:1531`, `src/engine/SimulationEngine.ts:1643`, `src/engine/SimulationEngine.ts:1984`, `src/engine/SimulationEngine.ts:2040`, `Decisions.md:705`, `docs/plans/2026-04-22-simfid-phases-4-8-revised.md:215` — addresses questions #3, #11, #12, #13

- **OK**: Read/write split and unindexed-scan multiplier compose without double-applying the same charge. The scan multiplier is a latency multiplier driven by `unindexedShare`; read/write saturation is an independent capacity/error calculation. A write route with `indexed: false` is therefore charged once for index-miss latency and once for write-side load, which matches the modeled phenomena. `read_write` remains intentionally per-operation, and the unique-share remainder prevents double-subtracting it. — `src/engine/SimulationEngine.ts:1623`, `src/engine/SimulationEngine.ts:1643`, `src/engine/SimulationEngine.ts:1886`, `src/engine/SimulationEngine.ts:1958` — addresses question #1

- **OK**: Kingman and hot-shard behavior do not double-count variance. Kingman is applied in `processServer` through `computeQueueing`; hot-shard behavior is a DB-local distribution/memory effect in `processDatabase`. They compose as path latency/load effects across different component processors, not as two multipliers on the same queueing formula. — `src/engine/SimulationEngine.ts:1268`, `src/engine/SimulationEngine.ts:1771`, `src/engine/QueueingModel.ts:108` — addresses question #2

### Per-commit

#### `c667e73`

- **OK**: `data.type === 'fanout'` is exhaustive for the current Dean-Barroso widget. `load_balancer` and `api_gateway` split aggregate RPS across downstreams but model one backend per request, and the only processor that multiplies one inbound request into N outbound deliveries is `fanout`. Removing the old multi-type gate does not remove any other inspector section. — `src/components/panels/ConfigPanel.tsx:213`, `src/engine/SimulationEngine.ts:1199`, `src/engine/SimulationEngine.ts:1251`, `src/engine/SimulationEngine.ts:2040` — addresses questions #6, #7

- **NIT**: User-facing knowledge docs still say the fan-out tail widget applies to "LB, fanout, api_gateway". Decisions has the round-7 correction, but `Knowledge.md` is stale and will preserve the exact misconception this commit fixed. The original parent-plan §4.7 wording is also stale, though less urgent because the progress log later corrects it. — `Knowledge.md:697`, `docs/plans/2026-04-22-simfid-phases-4-8-revised.md:117` — addresses question #13

#### `3f57b2a`

- **OK**: The non-deferred `Math.min(existing, dispatchedAtTickMs)` composes correctly with prior-tick deferred traffic and fresh in-tick traffic. Tick-start pending inbound seeds the target with the old timestamp; fresh same-tick delivery attempts to set the current tick timestamp but loses to the older value. If the fresh delivery arrives first, the later older delivery still lowers the map value before the target runs, provided the target has not already processed; if it has processed, the delivery is deferred and the pending branch uses the same min semantics. — `src/engine/SimulationEngine.ts:748`, `src/engine/SimulationEngine.ts:994`, `src/engine/SimulationEngine.ts:1023` — addresses question #8

- **OK**: Deeper cycles such as `A -> B -> C -> A -> D` follow the same invariant as the pinned `A -> B -> A -> C` case. At tick T+1, the deferred target gets `componentEarliestInboundMs=A:T`; each real in-tick hop writes that same earliest value onto the next target before that target processes; any cycle-closing edge defers with the same earliest timestamp. Multiple deferred branches converge by `Math.min` in both the `pendingInbound` branch and real-delivery branch. — `src/engine/SimulationEngine.ts:759`, `src/engine/SimulationEngine.ts:1001`, `src/engine/SimulationEngine.ts:1023` — addresses question #4

- **OK**: The extra `Map.get` plus conditional `Map.set` on in-tick delivery is not a realistic perf concern for this engine. It runs once per effective wire emission in a tick, in the same hot path that already does wire lookup, breaker/backpressure checks, inbound accumulator writes, and outcome storage. The new fan-in test directly asserts the regressed observable (`B -> C.dispatchedAtTickMs === 0`), so it is specific enough to catch the round-7 bug returning. — `src/engine/SimulationEngine.ts:924`, `src/engine/SimulationEngine.ts:1007`, `src/engine/SimulationEngine.ts:1030`, `src/engine/__tests__/fanIn.test.ts:176` — addresses questions #9, #10

#### `08e46e2`

- **BLOCKER**: The known-limitation text accurately describes the single-scalar `computeDbArrivalFactor` shape, but the assertion that aggregate `errorRate` and overall saturation behavior are unaffected is false for asymmetric read/write capacities or fanout-amplified writes. Since `state.metrics.errorRate` is derived from the per-side split, wrong side attribution can change the aggregate control signal, not just the diagnostic labels. This is the same issue as the cross-commit blocker above and should be fixed in code or downgraded in docs before convergence. — `src/engine/SimulationEngine.ts:1597`, `src/engine/SimulationEngine.ts:1944`, `src/engine/SimulationEngine.ts:1984`, `Decisions.md:700`, `Decisions.md:705` — addresses questions #11, #12

### Suspected docs inconsistency (question #5)

- **NIT**: Confirmed. Decisions §61 still lists "Clamping `dbArrivalFactor` at 1" under Rejected, while §63 later adopts the clamp. The cleanest fix is to leave §61 historically intact but add a short parenthetical in that bullet: "superseded by §63 after round 4 found default-bucket over-attribution." A rewrite is also fine, but a parenthetical keeps the review trail chronological. — `Decisions.md:694`, `Decisions.md:722`

### Anything else (question #13)

- **OK**: I did not find a novel code issue outside the aggregate-errorRate/per-route-scaling concern. The realistic topology still at risk is exactly the Discord-style fanout write path named above; cache/CDN-fronted APIs are already covered by the scale-down side of the factor and the existing tests.

## Verification

- `pnpm vitest run` — 30 files, 420 tests passed.
- `pnpm playwright test e2e/simfid-phase4-schema-driven.spec.ts` — 2 tests passed. First attempt failed under sandbox because the dev server could not bind `::1:5180`; reran with approval and it passed.

## CONSENSUS

`CONSENSUS: architectural concern, see above — needs human triage`

---

## Claude response (2026-04-27, post-triage)

**Verdict accepted in full.** Both BLOCKERs traced to the same root cause. Both NITs accepted as-is.

### Fix shipped

- **BLOCKER (fanout-amplified writes hide saturation)** — fixed in code via new `routeStaticAmplificationToNode(route, targetId)` private method that walks each route's chain prefix and multiplies entry share by `fanout.config.multiplier` for each fanout in the path. `computeDbArrivalFactor` divides by `Σ(entryShare × amp)` instead of `Σ entryShare`; the per-route loops in `computeDbReadWriteBreakdown` and the unindexed-scan path scale dbShare by amp. The `Math.min(1, …)` cap stays — it now correctly disambiguates default-bucket bleed (factor → ≥1, clamped) from fanout amplification (factor ≈ 1, full share attributed). Codex's worked example (`svc → fanout(10) → db`, 100 entry-rps, writeCap=500) now produces `writeErrorRate ≈ 0.5` and aggregate `errorRate ≈ 0.5` — breakers/retry/BP trip on real saturation.
- **NIT (stale fan-out widget wording)** — `Knowledge.md:697` and parent plan §4.7 line 117 updated to `fanout` only with a pointer to the round-7 §58 correction.
- **NIT (§61/§63 doc inconsistency)** — added a one-line parenthetical to §61's Rejected bullet pointing at §63 + §66.

### New regression test

[`engineReadWriteSplit.test.ts`](../../../src/engine/__tests__/engineReadWriteSplit.test.ts) `fanout-amplified writes saturate the DB — aggregate errorRate reflects real load`. Pins codex's exact worked example.

### Test state after fix

- Vitest **421/421** (was 420; +1 for the new regression).
- Playwright **2/2** (`simfid-phase4-schema-driven.spec.ts`).

### Decisions written

- New [§66](../../../Decisions.md) — round-8 fanout amplification restoration. Notes that §63's "loses fan-out amplification" trade-off is overridden.
- [§61](../../../Decisions.md) Rejected bullet — supersession parenthetical added.
- [§61 "Known limitation"](../../../Decisions.md) — narrowed to heterogeneous-DYNAMIC-filter case only (cache-hit-rate divergence). The fanout-amplification half is fixed; only dynamic-filter-divergence remains as a documented residual.
- [§63](../../../Decisions.md) — left intact for the historical record; §66 explicitly references it as overridden in the fanout-amplification half.

### Status

Phase 4 done. 19+ commits ahead of main. Ready for PR. The user opens PRs themselves; Claude provides title + body text on request.
