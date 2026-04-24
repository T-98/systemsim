# SIMFID Phases 4-8 — revised plan (2026-04-22)

**Branch:** `feat/simfid-phase4-schema-driven`
**Supersedes:** the Phase 4-only draft at `/tmp/phase4-plan.md` from earlier today.
**Grounded by:** [`docs/research/2026-04-22-simfid-fidelity-research.md`](docs/research/2026-04-22-simfid-fidelity-research.md) — 60+ source bibliography, five parallel research agents on fidelity ceilings, real-container pragmatics, algorithmic ceiling, prior art, and hybrid patterns.
**Codex's earlier Phase 4 critique addressed here:** provenance loss after the fan-in refactor, `tablesAccessed` being coarse in the store, `requestMix` defaulting to `{ default: 1.0 }`, read/write split composition with the breaker signal, scan-factor consistency with preflight's copy.

---

## The direction the research locked in

- **Algorithmic-first** as the interactive runtime (survives the under-1-second drag-a-wire constraint).
- **Calibration** as the bridge to reality — measure real Postgres / Redis / Kafka once, bake constants into the browser model, re-run per primitive major version.
- **Validation Mode** as an opt-in *second opinion*, not the source of truth. Scientist-style side-by-side display of simulated vs measured with color-coded drift.
- **No "nines" in public copy.** Teaching tool + directional predictor. Runnable-proof pitch: "every claim in the docs has a simulation you can run."
- **Honest re-scope** of Phase 5 (smaller, focused on calibration + second-opinion rather than production-parity) and Phase 7 (exportable Fastify scaffold rather than "full validation mode").

---

## Phase 4 — Schema-driven simulation + algorithmic fidelity refinements

Active work on the current branch. The research moved three items into scope for the same commit series.

### 4.1 Engine consumes routing context (`endpointRoutes`, `schemaMemory`, `requestMix`)

Extend the constructor with an optional `RoutingContext` bag so existing call sites stay working:

```ts
interface RoutingContext {
  endpointRoutes?: EndpointRoute[];
  schemaMemory?: SchemaMemoryBlock | null;
  requestMix?: Record<string, number>;
}

new SimulationEngine(nodes, edges, trafficProfile, shardKey?, cardinality?,
                    seed?, stressedMode?, routingContext?);
```

`useSimulation.ts` passes the bag from the store. No breaking change.

### 4.2 Per-endpoint traffic distribution (addresses codex: `requestMix` default)

`requestMix` today defaults to `{ default: 1.0 }` ([trafficIntentSchema.ts:144](src/ai/trafficIntentSchema.ts)). The plan treats any key not matching a known `endpointId` as the generic "/*" bucket and distributes that weight across entry points evenly (current behavior). Matching keys route to the first node of that endpoint's `componentChain`.

Fallback layering, explicit:

1. Both `endpointRoutes` and `requestMix` populated with matching keys → per-endpoint routing for matched, even-split across entries for the `default` remainder.
2. Only `endpointRoutes` populated → use `EndpointRoute.weight` (currently unused per codex). Normalize weights.
3. Neither populated → current even-split over `entryPoints`. No behavior change.
4. `componentChain[0]` references a node that isn't in the graph → redistribute that endpoint's share across valid routed endpoints, don't drop it (addresses codex: "missing chain → skip that endpoint share is wrong, it leaks load").

### 4.3 Read/write split on databases (addresses codex: composition with breaker)

DB processor computes separate `readErrorRate` and `writeErrorRate` fields alongside the existing aggregate `errorRate`. Processor path:

```
for this DB id:
  inboundReadRps  = Σ share(E) over endpoints E where this DB ∈ E.componentChain
                     AND any TableAccess of tables on this DB has mode in {read, read_write}
  inboundWriteRps = ditto for {write, read_write}

  readCapacity  = readThroughputRps × (1 + readReplicas)
  writeCapacity = writeThroughputRps

  readErrorRate  = saturation function of inboundReadRps / readCapacity
  writeErrorRate = saturation function of inboundWriteRps / writeCapacity
  errorRate = max(readErrorRate, writeErrorRate)  // compat with fan-in aggregate
```

New fields are additive on `ComponentMetrics`: `readErrorRate?`, `writeErrorRate?`. Breaker / retry / BP wires keep reading the aggregate `errorRate` via the fan-in Phase C path (no regression). UI and debrief consume the split fields when present.

**Label the split fields as DB diagnostics, not route-correct control signals.** Codex review calls this out explicitly: breakers and backpressure read the aggregate `errorRate`, so when a read-heavy endpoint shares a DB with a write-heavy one that's saturated, the read wire's breaker still trips on the aggregate even though its own path is healthy. That is acceptable *iff* the UI labels `readErrorRate` / `writeErrorRate` as "shared DB diagnostics" and reserves breaker/retry/backpressure semantics for the aggregate. Otherwise users will file it as a bug. Do not change breaker semantics to be per-wire-slice here (that would undo the 2026-04-22 fan-in correctness fix). Document in Decisions §53 when this ships.

### 4.4 Index coverage → latency multiplier (addresses codex: scan-factor consistency)

Use **10×** to match the preflight message "Missing index on `<field>` — slower reads" which already tells users 10x slower ([preflight.ts:136](src/engine/preflight.ts)). The engine applies the same multiplier so runtime and preflight tell the same story.

```
for each endpoint E that visits this DB:
  for each TableAccess TA in E.tablesAccessed where TA.tableId lives on this DB:
    if TA.indexed === false:
      unindexedShare = share(E) × (inboundRpsOfMode(TA.mode) / this DB inbound)
      scanFactor = 10
      dbLatency *= (1 + (scanFactor - 1) × unindexedShare)
```

One-shot callout per `(DB, unindexed table)` pair when the unindexed share exceeds 5% of inbound. The `tablesAccessed` coarseness codex flagged means the engine will over-attribute in some cases; the callout wording says "may include unindexed reads on `<table>` via `<endpoint>`" rather than asserting scan.

### 4.5 Per-DB shard cardinality from schema

Replace the constructor's global `schemaShardKey + cardinality` with per-DB derivation:

```
for this DB id:
  assignedEntities = schemaMemory.entities.filter(e => e.assignedDbId === id)
  partition entity = first assignedEntities[*] with a partitionKey
  shardKey = partition entity's partitionKey field
  cardinality = partition field's `cardinality` OR 'low' if partitionKeyCardinalityWarning
```

Fallback order (per codex): per-DB schema derivation → DB node config `state.config.shardKey` → legacy constructor globals. The existing `user` hot-shard heuristic at [SimulationEngine.ts:1119](src/engine/SimulationEngine.ts) keeps working because it reads `state.config.shardKey` which now gets set from schema if present.

### 4.6 Kingman G/G/1 replaces M/M/1 (research: single highest-ROI refinement)

`QueueingModel.computeQueueing` today uses M/M/1 wait formula. Replace with Kingman's G/G/1 approximation:

```
W = ρ/(1 − ρ) × (Cₐ² + C_s²)/2 × τ
```

Where `Cₐ²` is coefficient-of-variation squared of inter-arrival times and `C_s²` is same for service times. Expose `serviceVariance` as a per-component config (default 1.0 = exponential = M/M/1 behavior). Arrival variance derived from traffic profile shape (steady=1.0, spike=~4.0, ramp=~2.0).

Whitt 1993 validates this as "usually an excellent approximation" for two-moment inputs. This is the single most important fidelity refinement per the algorithmic-ceiling research.

### 4.7 Dean-Barroso fan-out tail visualization (research: high pedagogical value, pure algorithm)

When an LB or fanout forks to N downstreams and the canvas view is on that component, compute and display:

```
P(slow response) = 1 − (1 − p_single_slow)^N
```

Side panel shows: "Each backend is slow 1% of the time. With N=100 scatter-gather, overall response is slow 63% of the time." Dean-Barroso CACM 2013 is the canonical reference.

Implementation: new component in the inspector panel that reads the selected LB's fanout factor and downstream p99 to produce the compounding tail math, with a sparkline showing how it scales with N. No engine change; pure UI derived from already-computed metrics.

### 4.8 Coordinated-omission-correct measurement (research: "simulator's original sin")

Every latency record inside the engine uses `t_response − t_intended_dispatch`, not `t_response − t_actual_dispatch`. When the engine is backed up (processor running late), the recorded latency reflects that backup rather than pretending the request "started" when the processor got to it.

**Codex-review correction:** the earlier draft of this plan claimed the current tick-based engine is "coordinated-omission-safe by construction." That's overstated. The engine still batches arrivals into 1-second ticks and defers backlog tick-to-tick ([`src/engine/SimulationEngine.ts:369-439`](src/engine/SimulationEngine.ts)), so a saturated component's latency reporting is not automatically CO-safe. Introduce an explicit `dispatchedAtTickMs` on the in-flight request record and record latency against it — scoped to the Phase B dispatch path, cheap. The claim in the engine docstring becomes "CO-correct within the 1-tick granularity" rather than "safe by construction." Phase 5's Validation Mode traces consume the same timestamps so simulated vs measured comparisons are apples-to-apples.

### 4.9 Tests (Phase 4 deliverable)

Each commit ships with vitest coverage:

1. `engineRoutingDistribution.test.ts` — three endpoints 0.6/0.3/0.1 at 1000 rps, first chain components see 600/300/100 aggregate inbound. Fallback to even-split confirmed.
2. `engineReadWriteSplit.test.ts` — DB with 1000 read cap / 100 write cap, 50/50 traffic at 500 rps total. `readErrorRate ≈ 0`, `writeErrorRate > 0`, aggregate `errorRate = max`.
3. `engineTableScan.test.ts` — `TableAccess.indexed=false` on 20% of traffic produces measurable p50 increase proportional to the unindexed share. Callout fires once.
4. `engineShardCardinality.test.ts` — two DBs, one low-cardinality partition, one high. Pareto hot-shard distribution on the low-card DB only.
5. `engineKingman.test.ts` — processor with `serviceVariance=4.0` shows meaningfully higher p99 than `serviceVariance=1.0` at same utilization. Validates the Kingman term.
6. `engineFanoutTail.test.ts` — p99 at N=100 fan-out with 1%-slow backends matches Dean-Barroso's ~63% compounding.
7. Playwright `simfid-phase4-schema-driven.spec.ts` — Discord scenario + an endpoint with a declared unindexed table. Run → live log shows the unindexed-scan callout with endpoint + table names.

### 4.10 Commit sequencing (Phase 4)

Five commits, each reviewable:

1. `feat(engine): routing context + per-endpoint traffic distribution`
2. `feat(engine): read/write split with split error fields`
3. `feat(engine): index coverage → latency multiplier (10x, matches preflight)`
4. `feat(engine): per-DB shard cardinality from schemaMemory`
5. `feat(engine): Kingman G/G/1 + fan-out tail viz + dispatch-timestamp plumbing`

### 4.11 Progress log (updated 2026-04-23)

- [x] **Commit 1 — `9770776` `feat(engine): routing context + per-endpoint traffic distribution`** (2026-04-22)
  - `RoutingContext` exported from [SimulationEngine.ts](src/engine/SimulationEngine.ts), threaded through [useSimulation.ts](src/engine/useSimulation.ts).
  - `seedInboundTraffic` / `seedAt` helpers replace the legacy even-split seed.
  - Fallback layering as specified in §4.2 — matched `requestMix` → `EndpointRoute.weight` → legacy even-split.
  - Stale `componentChain[0]` fires one-shot `routing-stale:<endpointId>` callout + redistributes share.
  - 5 new tests in [engineRoutingDistribution.test.ts](src/engine/__tests__/engineRoutingDistribution.test.ts). Full suite 376/376.
  - Decisions [§53](Decisions.md), [Knowledge.md](Knowledge.md), [API-Reference.md](API-Reference.md) updated.
- [x] **Commit 1.5 — `70d4169` `fix(engine): requestMix matches "METHOD PATH" via ApiContract join`** (codex-flagged)
  - Codex review caught a feature cliff: `EndpointRoute.endpointId` is the uuid from `ApiContract.id`, but checked-in scenarios like [`src/scenarios/discord.ts`](src/scenarios/discord.ts) author `requestMix` keyed on `"POST /event/everyone"`. Keys silently fell through to even-split.
  - Fix: extended `RoutingContext` with `apiContracts?: ApiContract[]`. Matcher tries `endpointId` first, then `"METHOD PATH"` via the contract join.
  - Also cleaned a dead `effectiveDefault` local in the all-stale redistribution path (same review NIT).
  - +1 test covering the Discord-shape case. Full suite 377/377.
- [x] **Commit 1.6 — `9538f23` `fix(engine): treat duplicate "METHOD PATH" as ambiguous, not last-wins`** (codex-flagged)
  - Codex re-review caught a silent-misroute hole: `byMethodPath.set(...)` would overwrite on collision.
  - Fix: null-sentinel pattern. Duplicate METHOD+PATH keys poison the map entry; at match time `null` fires `routing-ambiguous:<key>` and the weight falls into the default bucket.
  - +1 test covering the ambiguous case. Full suite 378/378.
  - Codex final re-review on `9538f23` returned NIT only (un-routed duplicate contracts don't trigger ambiguity — policy call, accepted: an un-routed duplicate has no destination, so there's only one valid target for the mix key regardless).
- [x] **Commit 2 — `feat(engine): read/write split with split error fields`** (2026-04-24)
  - `ComponentMetrics` gains optional DB-only `readErrorRate` / `writeErrorRate` (additive; [src/types/index.ts](src/types/index.ts)).
  - `computeDbReadWriteBreakdown` attributes per-endpoint share via `endpointRoutes[].tablesAccessed` + `schemaMemory.entities[].assignedDbId`; `read_write` mode adds full share to BOTH sides (per-operation semantics). 70/30 fallback (`DB_FALLBACK_READ_SHARE`) when attribution unavailable.
  - Aggregate `errorRate = max(readErrorRate, writeErrorRate, connectionPoolDropRate)` — fan-in correctness (§52) preserved; breakers/retry/BP unchanged.
  - Per-side callouts (`read-saturation`, `write-saturation`) fire only when attribution available (modeling-assumption floor rule).
  - 6 new tests in [engineReadWriteSplit.test.ts](src/engine/__tests__/engineReadWriteSplit.test.ts). Full suite 384/384.
  - Decisions [§54](Decisions.md), [Knowledge.md](Knowledge.md), [API-Reference.md](API-Reference.md) updated. Codex unavailable in this sandbox → adversarial review deferred to end-of-phase (Agent subagent, per CLAUDE.md fallback).
- [x] **Commit 3 — `feat(engine): index coverage → latency multiplier (10x, matches preflight)`** (2026-04-24)
  - `processDatabase` multiplies `dbLatency` by `1 + 9 × unindexedShare`. `SCAN_FACTOR = 10` class constant locked to [`src/engine/preflight.ts:140`](src/engine/preflight.ts) "10x slower" copy.
  - Denominator is routed-DB-visiting share (`endpointShareRpsThisTick`), not total inbound — doesn't attribute unindexed-ness to fan-out amplification or to the default bucket.
  - One-shot `unindexed-scan:<tableId>` callout fires per `(dbId, tableId)` above 5% share, hedged "may include unindexed access" wording.
  - Multiplier clamp: `unindexedShare = min(1, unindexedSum / routedDbShareSum)` — a single endpoint touching three un-indexed tables doesn't triple-weight.
  - 5 new tests in [engineTableScan.test.ts](src/engine/__tests__/engineTableScan.test.ts). Full suite 389/389.
  - Decisions [§55](Decisions.md), [Knowledge.md](Knowledge.md) updated. Codex unavailable → adversarial review deferred.
- [x] **Commit 4 — `feat(engine): per-DB shard cardinality from schemaMemory`** (2026-04-24)
  - New `resolveShardKeyForDb(dbId)` private helper on `SimulationEngine` — 4-layer fallback: `schemaMemory.entities[].assignedDbId` → `state.config.shardKey` → legacy constructor globals → `{null, 'high'}`.
  - `processDatabase` hot-shard branch consults the resolver instead of the constructor-level global. Existing single-DB tests keep working via layer 3.
  - Defensive: dangling `partitionKey` (field not in `entity.fields`) degrades to 'high' — no crash. Dangling `assignedDbId` (entity → deleted DB) is inert.
  - `partitionKeyCardinalityWarning === true` overrides the field's own cardinality.
  - 5 new tests in [engineShardCardinality.test.ts](src/engine/__tests__/engineShardCardinality.test.ts). Full suite 394/394.
  - [API-Reference.md](API-Reference.md) marks `schemaShardKey`/`schemaShardKeyCardinality` as legacy fallbacks; Decisions [§56](Decisions.md), [Knowledge.md](Knowledge.md) updated. Codex unavailable → adversarial review deferred.
- [x] **Commit 5 — `feat(engine): Kingman G/G/1 + fan-out tail viz + dispatch-timestamp plumbing`** (2026-04-24)
  - **Kingman:** `QueueingModel.computeQueueing` replaces M/M/1 with Whitt 1993 two-moment. `serviceVariance` (new optional config, default 1.0) and `arrivalVariance` (from phase shape — `getCurrentArrivalVariance()`) feed the formula. Degenerate case Cₐ²=C_s²=1.0 reproduces M/M/1 exactly — all 394 pre-Commit-5 tests keep passing.
  - **Fan-out tail viz:** `FanoutTailSection` in ConfigPanel.tsx — pure UI, Dean-Barroso `P = 1 - (1-p)^N` curve with synthetic `p_single_slow=0.01` threshold; N = fanout multiplier OR outbound wire count.
  - **CO plumbing:** `WireTickOutcome.dispatchedAtTickMs` stamped at emit time; engine docstring claim downgraded from "CO-safe by construction" to "CO-correct within 1-tick granularity."
  - 11 new tests split across `engineKingman.test.ts` (6) and `engineFanoutTail.test.ts` (6 — two files have 5 and 6 respectively, total 11). Full suite 405/405.
  - Playwright `simfid-phase4-schema-driven.spec.ts` created (2 tests: unindexed-scan callout fires; indexed regression guard). Not run in this sandbox — Playwright deferred to user's real machine.
  - Decisions [§57](Decisions.md), [§58](Decisions.md), [§59](Decisions.md); [Knowledge.md](Knowledge.md) queueing + CO + fan-out sections; [API-Reference.md](API-Reference.md) constructor annotations.
  - Codex unavailable → adversarial review deferred to end-of-phase subagent.
- [x] **Codex branch-vs-main review (2026-04-24)** — `codex review --base main` ran at the end of Phase 4. Verdict: **GATE: FAIL (1 × P1, 1 × P2).**
  - **[P1]** `attributeDbInbound` silently dropped unattributed DB inbound from the read/write split — a sparse-schema DB could look healthy while breakers / retry / backpressure missed real saturation. Fixed: partial-attribution remainder now distributes via the existing 70/30 default (`DB_FALLBACK_READ_SHARE`). §52 / §54 invariants preserved.
  - **[P2]** Unindexed-scan multiplier and callout used inconsistent denominators — the latency multiplier could spike hard while the user-visible warning silently dropped below 5%. Fixed: one `routedDbShareSum`, hoisted and reused in both the multiplier and the threshold check.
  - Two new regression tests ([engineReadWriteSplit.test.ts](src/engine/__tests__/engineReadWriteSplit.test.ts) `partial attribution distributes the unclassified remainder via the 70/30 default`, [engineTableScan.test.ts](src/engine/__tests__/engineTableScan.test.ts) `unindexed share + callout share use the SAME denominator`) encode the fixes against regression. Full suite 407/407 + Playwright 2/2 green. Decisions [§60](Decisions.md). Codex session: `019dbe91-106f-7e60-8802-7da147992aa9`.
- [x] **Codex round 2 (2026-04-24) — Decisions §61.** Re-review of the §60 fix surfaced three deeper issues the round-1 fix exposed: [P1a] `read_write` share double-counted in the remainder calculation; [P1b] / [P2a] both the read/write split and the unindexed-scan multiplier attributed DB load from entry-point seed shares, ignoring upstream filter / amplification (cache / CDN / fan-out) — a 99%-hit-rate cache would still trip breakers on phantom saturation; [P2b] saturation callouts fired on sparse-schema DBs where the 70/30 filler drove the saturation. Fix: new `computeDbArrivalFactor` helper + unique-share `attributedRpsAtDb` + `attributionRatio >= 0.5` gate on the `attributed` return (which already gates callouts). Three new regression tests: `read_write share is counted ONCE`, `scales attributed DB load by the ACTUAL inbound`, `suppresses write-saturation callout when attribution is <50%`. Full suite 410/410 + Playwright 2/2 green.
- [x] **Codex round 3 (2026-04-24) — Decisions §62.** Third review pass found two bugs the round-2 scaling exposed: [P1 topo-roots] routed chain heads that are not graph entry points ran only in the Map-insertion-order catch-all, producing a persistent 1-tick lag on downstream DB metrics; [P1 stale-chain] both `computeDbArrivalFactor` and the scan path used `componentChain.includes(dbId)` without validating against the live graph — a stale chain referencing a removed edge still projected its entry share onto the DB, firing phantom diagnostics. Fix: (1) add routed chain heads to `topologicalOrder` roots; (2) new `routeReachesDbInLiveGraph` helper validates each consecutive pair in the chain against `this.adjacency` — replaces `componentChain.includes(dbId)` in all three callers. Two new regression tests: `a stale route chain does NOT project attribution onto the live DB`, `route heads that are not graph entry points still process in topological order`. Full suite 412/412 + Playwright 2/2 green.

**Handoff doc for agents continuing Commits 2–5:** [`docs/plans/2026-04-23-simfid-phase4-handoff.md`](docs/plans/2026-04-23-simfid-phase4-handoff.md) (now historical — Phase 4 fully shipped).

---

## Phase 8a — BOTE calculator + `calibration.json` scaffolding (pulled forward)

The CEO plan explicitly says the math panel is "independent, ship anytime." Research says ship sooner.

### 8a.1 BOTE math panel

Standalone component, no engine coupling. Inputs: DAU, actions-per-user, read/write ratio, payload size, retention window. Outputs: avg QPS, peak QPS (defaults to 3× avg or user-provided), storage growth per month, concurrent connections estimate (Little's Law: N = QPS × avg response time).

Location: new tab in the inspector panel when the canvas is empty or no node is selected. Also linked from the traffic panel as "pre-populate traffic profile from BOTE."

Pre-population: the BOTE output can overwrite `TrafficProfile.phases` with a two-phase profile (baseline avg, peak spike).

### 8a.2 `calibration.json` — ship the schema, empty defaults

`public/calibration/<hardware-class>/<primitive>-<version>.json`:

```json
{
  "primitive": "postgres",
  "version": "16",
  "hardwareClass": "laptop-m-series-16gb",
  "capturedAt": null,
  "anchors": {
    "serviceTimeMs": { "p50": null, "p99": null },
    "serviceVariance": null,
    "readThroughputRps": null,
    "writeThroughputRps": null,
    "connectionPoolExhaustionMs": null
  },
  "source": "empty-default"
}
```

Engine reads this at tick-start and uses it as the default for unset component configs. Users override per-component in the UI. Phase 5 populates these files with real measurements. For now they ship empty with hard-coded fallbacks so nothing breaks.

### 8a.3 Tests

- `bote.test.ts` — known-DAU → known-QPS mapping matches hand calculation.
- `calibration.loader.test.ts` — missing file → falls back to engine defaults. Present file with partial nulls → fills what's there.
- Playwright: BOTE panel renders, DAU input updates outputs live, "Pre-populate traffic profile" button fires and traffic panel reflects the values.

### 8a.4 Commits (Phase 8a)

1. `feat(bote): math panel with DAU/QPS/storage/connection estimates`
2. `feat(engine): calibration.json loader with empty defaults + engine fallback`

---

## Phase 5 — Companion daemon + Validation Mode (re-scoped)

**The re-scope is load-bearing.** The CEO plan positions this as "real Postgres / Redis / Kafka feed the simulator with measured latencies." The research says that framing overclaims — Docker-on-Mac noise, scale-down extrapolation breakage at the saturation knee, ~30% of users with install friction. Re-frame as **calibration harness + second-opinion Validation Mode**, not production parity.

### 5.1 `npx systemsim-daemon`

Separate package `packages/systemsim-daemon` (sibling to the main app). Ships as an npm bin. User runs `npx systemsim-daemon` alongside the web app.

Stack:
- `dockerode` for container lifecycle (lower-level than Testcontainers, gives us the control we need for a long-running daemon).
- Fastify with `@fastify/websocket` for the browser bridge.
- Testcontainers-Node only for its wait-strategy helpers and image pre-pull. **Do not use Ryuk** — we manage container lifecycle ourselves for a long-running daemon.
- Pinned digest images: `postgres:16.4-alpine`, `redis:7.4-alpine`, `grafana/k6:0.54`. Pre-pulled on daemon install.

Daemon detects OrbStack / Colima / Docker Desktop and warns if the user is on Docker Desktop with <16 GB RAM.

### 5.2 Calibration harness

First time the daemon runs, it executes the calibration suite and writes to `~/.systemsim/calibration/<hardware-class>.json`. Suite takes 2-5 minutes:

1. **Postgres:** seed 1M rows with `generate_series + random()` Zipfian hot-key distribution. Run `EXPLAIN (ANALYZE, BUFFERS)` on indexed and unindexed query shapes. Record rows-scanned-per-ms, buffer-hit-ratio, connection-pool exhaustion latency. Repeat for 10M rows if the user opts in ("realistic scale" option).
2. **Redis:** `redis-benchmark` with Zipfian keyset at varying hit rates (100%, 80%, 50%, 20%). Record per-op microseconds, cache-miss tail latency.
3. **Fastify reference service:** `wrk2` sweep from 10% to 90% utilization, record p50 and p99 at each point. Fit a queueing coefficient (not pure M/M/1 — real services have heavier tails).
4. Emit `calibration.json` in the format from Phase 8a.2.

Browser app auto-loads the calibration profile on next connect to the daemon. Shows a small pill in the header: "Calibrated: Postgres 16 on M-series laptop, 2026-04-22."

### 5.3 Validation Mode

Opt-in. User clicks "Validate" on any scenario. Daemon:

1. Uses Testcontainers with `.withReuse(true)` to keep containers warm across validations in a session.
2. Generates the Postgres DDL from `SchemaMemoryBlock`, seeds data matching the declared access patterns.
3. Generates a k6 script from `EndpointRoute` + `TrafficProfile`.
4. Runs k6 against the containerized services.
5. Streams metrics back over the WebSocket.
6. Browser displays **simulated vs measured side-by-side** (Scientist `compare` semantics). Delta color-coded: green <10%, yellow 10-30%, red >30%.

Cold start: 5-10s on first validation (container boot + seed). Warm: <1s for subsequent validations within the session. UI shows a "Validation containers ready" pill when warm.

**Framing in UI copy:** "Validation Mode runs a scaled-down container stack against your design. Useful as a second opinion for directional behavior. Scale-down extrapolation is not production parity — near saturation, measured values diverge. Use this to sanity-check the *shape* of your design, not its absolute p99."

### 5.4 "Run in cloud" button (Fly Machines)

When the user's laptop can't run the stack (detected via `systemsim doctor` checks: <16 GB RAM, Docker not installed, corporate virtualization blocked), the Validate button offers "Run in cloud." Backend spins 4 Fly Machines (Postgres, Redis, Fastify x2) per second-billed, tears down after run. Pennies per run. User auths with their Fly token in settings.

Cold start: sub-second boot per Fly Machines docs. Full-stack warm: 15-25s. Per-run cost: $0.01-0.05 depending on duration.

### 5.5 `systemsim doctor` command

`npx systemsim-daemon doctor` diagnoses environment before the user tries to run Validation Mode:

- Docker / OrbStack / Colima detection + version.
- Available RAM + disk.
- M-series vs Intel.
- Corporate virtualization block detection.
- Ports 5432, 6379, 3000 availability.
- Prints actionable fixes and optionally writes a capability report.

### 5.6 Tests

- Integration: `daemon.e2e.ts` runs the daemon, connects over WebSocket, runs Validation Mode against a minimal scenario, asserts the measured delta is within expected bounds.
- Unit: DDL generator unit tests (schema → CREATE TABLE round-trip), seeder (10K rows generated in-SQL <500ms), k6 script generator.
- Manual test plan: one new-user flow through `systemsim doctor → daemon → calibration → Validation` on a clean M-series laptop.

### 5.7 Commits (Phase 5)

Structured as their own PR on a separate branch:

1. `feat(daemon): package scaffold + dockerode + WebSocket bridge`
2. `feat(daemon): doctor command + environment detection`
3. `feat(daemon): calibration harness (Postgres, Redis, Fastify-reference)`
4. `feat(daemon): Validation Mode with Testcontainers reuse + Scientist compare UI`
5. `feat(daemon): "Run in cloud" offload to Fly Machines`

---

## Phase 6 — Redis Streams sidecar

Ships after Phase 5 proves the pattern with Postgres. Smaller than the CEO plan originally scoped it.

### 6.1 Scope

- Daemon adds a Redis Streams container (`redis:7.4-alpine` already pulled).
- `ioredis` client in the daemon publishes synthetic messages matching the canvas-declared queue topology.
- `XINFO STREAM` metrics streamed to UI: consumer lag, pending entries list (PEL) size, DLQ depth (via a separate stream).
- Browser renders queue depth gauge driven by real XINFO rather than only the algorithmic Little's-Law model.

### 6.2 Why not Kafka too

Original plan mentioned Kafka. Kafka adds meaningful container overhead (Zookeeper-less KRaft mode helps but still ~1 GB extra RAM). Redis Streams delivers similar consumer-lag + DLQ behavior at a fraction of the cost and maps to the `queue` component type SystemSim already has. Kafka ships if a concrete user pull-request names a Kafka-specific failure mode the current queue model misses; otherwise defer.

### 6.3 Commits (Phase 6)

1. `feat(daemon): Redis Streams producer + XINFO metrics bridge`
2. `feat(engine): queue component reads live XINFO when Validation Mode active`

---

## Phase 7 — Exportable Fastify scaffold (re-framed)

CEO plan framing: "Full end-to-end validation mode." Research framing: "exportable Fastify scaffold." Same codegen, honest positioning.

### 7.1 Scope

- Codegen from `EndpointRoute`: generates a Fastify route handler per endpoint with the declared input/output shapes, auth mode, and a placeholder business-logic stub.
- Nginx config emitted from the LB topology.
- k6 scenario emitted from `TrafficProfile`.
- `docker-compose.yml` wires the generated stack.
- User runs `npx systemsim export my-design && cd my-design && docker compose up`. Gets a real Fastify stack they can develop against and deploy.

### 7.2 Positioning

"Export your design as a Fastify starter kit. The code is the same scaffold we use to calibrate the simulator, so what you see in the sim matches what you're about to build." Not a fidelity claim. A starter-kit claim.

### 7.3 Commits (Phase 7)

1. `feat(codegen): Fastify routes from EndpointRoute`
2. `feat(codegen): nginx + docker-compose + k6 scenario`
3. `feat(cli): systemsim export <name>`

---

## Phase 8b — Math-vs-measured delta report (follows Phase 5)

With Phase 5 shipping calibration + Validation Mode, the closing piece is the delta report in the debrief:

- Run the algorithmic sim → produces predicted p50/p99.
- If Validation Mode was also run, debrief shows: "Sim predicted p99 = 120ms. Containerized measurement = 340ms. Delta +183%. Likely cause: unindexed `orders.user_id` query under 40% of traffic."
- Cause attribution uses the `TableAccess.indexed === false` flag + measured-slow queries via `pg_stat_statements` output from the daemon.

### 8b.1 Commits (Phase 8b)

1. `feat(debrief): sim-vs-measured delta panel with attribution`

---

## Dependencies + parallelism

- Phase 4 is unblocked and active on `feat/simfid-phase4-schema-driven`.
- Phase 8a can ship in parallel with Phase 4 on a separate branch; no conflict (BOTE is UI-only, calibration.json loader is in the engine but additive).
- Phase 5 depends on Phase 4 (routing context) + Phase 8a (calibration.json format). Starts on a new branch after Phase 4 and 8a land.
- Phase 6 depends on Phase 5 (daemon infra).
- Phase 7 is independent from 5/6 at the scaffold level but shares the DDL generator with Phase 5 calibration. Best shipped after Phase 5 so the generator is already proven.
- Phase 8b depends on Phase 5.

---

## What the research rules out + what we're consciously keeping

**Rules out:**
- "Production parity" claims anywhere in copy.
- Any "nines" **fidelity** claim in public copy (e.g. "SystemSim predicts your p99 with 99.9% accuracy"). In-context SLO examples for user scenarios (e.g., a Discord scenario that says "Discord's uptime target is 99.95%") are legitimate and stay — those describe the *system being simulated*, not the simulator. Codex audit flagged [`src/scenarios/discord.ts:51-55`](src/scenarios/discord.ts) and [`src/wiki/content/learn/03-describe-in-plain-english.md:13-16`](src/wiki/content/learn/03-describe-in-plain-english.md) — those are in-context examples, not product claims, and stay.
- Full Kafka container spin-up until proven needed.
- **Scope change from the research Phase 8 recommendation:** research listed `kafka-3` as one of the calibration.json primitives. The revised plan ships calibration scaffolding for Postgres + Redis + a generic Fastify service first, and adds a Kafka profile if and when Phase 6's Redis-Streams pattern proves insufficient for a user-reported failure mode. Codex flagged this as a valid but noted scope change.
- Relying on 1:10 extrapolation as the primary fidelity mechanism (Shopify Genghis and LinkedIn XLNT both publish this as a cross-check, not truth).

**Keeps:**
- Algorithmic runtime as the default simulator.
- Browser-only operation without the daemon installed (daemon is opt-in).
- The existing fan-in correctness model from 2026-04-22.
- Per-endpoint routing + schema-driven DB behavior from Phase 4.
- Runnable-proof framing for docs credibility (Phase 5 enables this fully).

---

## Public framing (recap from research)

- "SystemSim: a simulator for distributed-systems design intuition."
- "Run your design. Watch where it breaks. Fix it before your users do."
- "Every claim in the docs has a live simulation you can run."
- "Optional Validation Mode runs your design against real Postgres and Redis for a second-opinion sanity check."

---

## Asks for codex

1. **Does the research recommendation hold up?** You have access to `docs/research/2026-04-22-simfid-fidelity-research.md`. Read it. State clearly whether you **agree** or **disagree** with the core recommendation (algorithmic-first runtime, calibration-second bridge, Validation Mode as second opinion, no "nines" in copy). If you disagree, name which finding in the research is wrong and why.
2. **Is the re-scope of Phase 5 correct?** The CEO plan positioned it as "real Postgres feeds the simulator with measured latencies." The revised plan says "calibration harness + second-opinion Validation Mode, not production parity." Does that re-scope go too far (over-correcting from the original ambition)? Or not far enough (still claims too much)?
3. **Phase 4 provenance problem you flagged earlier.** You noted that after the fan-in refactor, DB-side read/write split is heuristic because DB runs on aggregate inbound, not per-route inbound. The revised plan exposes `readErrorRate` / `writeErrorRate` as additive split fields while keeping aggregate `errorRate` for the fan-in-correct breaker / BP signal. Does that composition work, or is there a case where a read-wire's breaker trips on write saturation and the user is confused?
4. **Kingman G/G/1 as "single highest-ROI fidelity refinement."** Research claims this. Agree or disagree. If agree, any gotchas in threading arrival variance through the tick scheduler that the plan doesn't address?
5. **Phase 6 Redis-only, Kafka-deferred.** The revised plan defers Kafka until a concrete user pull-request names a Kafka-specific failure mode. Reasonable trade or a hole that will bite us?
6. **Phase 7 re-frame from "validation mode" to "exportable Fastify scaffold."** Downgrade or clarification?
7. **Any claim in this plan** that the research document actually contradicts that I've glossed over?
8. **Final consensus statement**: end your review with either "CONSENSUS: agree with research-driven direction, approve plan" or "CONSENSUS: disagree, here's the alternative direction" with the specific divergence.

Be specific with file:line refs. Under 1500 words. The user will read your review + this plan side-by-side and make the final call.

---

## Final consensus (codex + research + plan)

**2026-04-22 — Codex review verdict:** `CONSENSUS: agree with research-driven direction, approve plan with 1st-priority fix explicit aggregate-breaker / coordinated-omission caveats.`

### What codex confirmed
- Algorithmic-first runtime is the right shape. The engine today is already a browser-local tick scheduler with no live-container input path, so the research-recommended architecture matches the actual code direction ([src/engine/SimulationEngine.ts:152-193](src/engine/SimulationEngine.ts), [src/engine/useSimulation.ts:177-192](src/engine/useSimulation.ts)).
- Phase 5 re-scope from "real Postgres feeds the simulator" to "calibration harness + second-opinion Validation Mode" is correct, not over-correction. The old framing doesn't match the current architecture at all.
- Kingman G/G/1 as the highest-ROI refinement. Gotcha: arrival variance `C_a²` should be treated as a modeled prior derived from `TrafficProfile.jitterPercent` + `userDistribution` ([src/types/index.ts:91-99](src/types/index.ts)), not a measured property.
- Phase 6 Redis-only, Kafka-deferred is reasonable given the generic `queue` component model ([src/types/index.ts:17-28](src/types/index.ts), [src/engine/SimulationEngine.ts:1021-1080](src/engine/SimulationEngine.ts)).
- Phase 7 re-frame is a clarification, not a downgrade.

### Priority fixes applied to this plan post-review
1. **Split-field labeling.** `readErrorRate` / `writeErrorRate` explicitly labeled as DB diagnostics, not route-correct control signals. Breaker / retry / backpressure keep reading aggregate `errorRate` from the fan-in-correct Phase C. (Phase 4.3 above.)
2. **Coordinated-omission claim tightened.** The "CO-safe by construction" language dropped; engine doc now says "CO-correct within 1-tick granularity" and the dispatch-timestamp plumbing lands as planned. (Phase 4.8 above.)
3. **"Nines" rule clarified.** Ban is on product-claim nines only. In-context SLO examples (Discord scenario, a learn page's "99.95% uptime target" for the system being simulated) are legitimate and stay.
4. **Kafka-deferred noted as a scope delta vs research.** Research Phase 8 mentioned `kafka-3` in calibration.json; revised plan ships without it until a concrete user need surfaces. Delta documented, not hidden.

### Where any future disagreement would land
If user research or a technical reviewer later finds:
- A concrete failure mode in real Kafka that the generic queue model can't teach → pull Kafka back into Phase 6 scope.
- A documented industry pattern for per-route-correct breaker signals that doesn't undo fan-in correctness → re-open Phase 4.3's compromise.
- A measurable fidelity win from exposing `C_a²` derivation as a measured property via Validation Mode → upgrade Phase 4.6's "modeled prior" to "calibrated constant."

Absent those, this is the direction we build.
