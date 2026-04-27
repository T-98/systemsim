# Decisions

Every significant engineering or product decision made on SystemSim, with the reasoning, the alternatives we rejected, and a source (commit SHA, plan file, or memory entry).

**Rule:** if a decision is worth more than a week of work or changes a contract between subsystems, it goes here. Smaller calls live in commit messages.

**Format:**
- **Title** (what)
- **When**
- **Context** (what prompted it)
- **Decision** (what we did)
- **Why** (reasoning)
- **Rejected** (alternatives considered)
- **Source**

---

## Architecture

### 1. IR-based traffic flow via `EndpointRoute`

- **When:** SIMFID Phase 1, commit `03751c8` (2026-04-13)
- **Context:** Engine needed to know which DB tables are hit by which API contract, through which components, to validate data flow before running.
- **Decision:** Introduced `EndpointRoute { endpointId, componentChain, tablesAccessed, weight, estimatedPayloadBytes }`. When an `ApiContract` gets an `ownerServiceId`, the store BFS-walks the graph from that service to auto-generate routes.
- **Why:** Closes the loop between declared API shape, declared schema, and simulated runtime. Enables preflight ("this endpoint has no path to its owner service") and per-endpoint traffic modeling later.
- **Rejected:** Implicit ad-hoc tracking. Requiring users to declare routes by hand.
- **Source:** commit `03751c8`, [src/engine/graphTraversal.ts](src/engine/graphTraversal.ts), [src/store/index.ts](src/store/index.ts) `setApiContracts`.

### 2. Path-based cycle detection instead of flat visited-set

- **When:** MVP bugfix, commit `f6c144e` (2026-04-11)
- **Context:** A flat visited set was silently starving leaf nodes in diamond topologies like `LB → A → DB`, `LB → B → DB`.
- **Decision:** `callStack: Set<string>` tracks only nodes on the current traversal path. Push on entry to `processComponent`, delete on exit. Cycle check is `callStack.has(id)`, not `visited.has(id)`.
- **Why:** Diamond topologies are legitimate. Only actual cycles (node X reaches itself via X's ancestors) should be rejected.
- **Rejected:** Flat visited set (broke diamonds). No cycle detection (infinite recursion on buggy graphs).
- **Source:** commit `f6c144e`, [src/engine/SimulationEngine.ts](src/engine/SimulationEngine.ts) `callStack` field.

### 3. Shared `runTick` for start/resume parity

- **When:** MVP bugfix, commit `f6c144e` (2026-04-11)
- **Context:** `resumeSimulation` was a copy-paste degrade of `startSimulation`: 10× speed (100ms timer instead of 1000ms/speed), and it skipped pushing to `metricsHistoryRef`, so post-resume metrics never made it into the debrief.
- **Decision:** Extracted the tick body to a shared `runTick()` called by both `startSimulation` and `resumeSimulation`.
- **Why:** Single source of truth prevents regressions. The debrief runs on `metricsHistoryRef.current`, so any gap there silently corrupts the report.
- **Rejected:** Patching resume in isolation (left divergent copies).
- **Source:** commit `f6c144e`, [src/engine/useSimulation.ts](src/engine/useSimulation.ts) `runTick`.

### 4. Vercel Edge Function proxy for Anthropic with graceful fallback

- **When:** MVP Phase 2, commits `028c09d` + `3e1ffee` (2026-04-04)
- **Context:** The client needs LLM calls (debrief questions, text-to-diagram, vision-to-intent) but cannot hold an API key, and we don't want to block the UI on a possibly-slow LLM.
- **Decision:** Each LLM feature has its own Edge Function under `api/`. Client ships a deterministic result first, then merges the LLM result async with a 15s timeout. On timeout/error, the deterministic result stays and a "AI debrief unavailable" banner appears.
- **Why:** Security (key stays server-side). UX doesn't regress when the API flakes. Users get useful output even offline.
- **Rejected:** Direct client-side API calls (key exposure). Blocking loading spinner (bad UX on long tails).
- **Source:** commits `028c09d`, `3e1ffee`. [api/debrief.ts](api/debrief.ts), [src/ai/anthropicDebrief.ts](src/ai/anthropicDebrief.ts).

### 5. Store exposed on `window.__SYSTEMSIM_STORE__` for E2E tests

- **When:** SIMFID Phase 2, commit `66f6ec3` (2026-04-15)
- **Context:** Playwright tests needed to set up high-RPS scenarios, bypass preflight, and inject specific configs without clicking through the UI.
- **Decision:** In dev and CI builds, the Zustand `useStore` is assigned to `window.__SYSTEMSIM_STORE__`. Tests call `store.getState().setTrafficProfile(...)` directly.
- **Why:** Scenario setup through UI clicks is flaky, slow, and doesn't scale to parameter sweeps (ρ=0.5 vs ρ=0.9).
- **Rejected:** UI-only testing (flaky, slow).
- **Source:** [src/store/index.ts](src/store/index.ts), used in [e2e/simfid-phase2-validation.spec.ts](e2e/simfid-phase2-validation.spec.ts), [e2e/simfid-phase3-debrief-numbers.spec.ts](e2e/simfid-phase3-debrief-numbers.spec.ts).

---

## Engine modeling

### 6. M/M/1 queueing via Little's Law, not polynomial heuristic

- **When:** SIMFID Phase 2, commit `66f6ec3` (2026-04-15)
- **Context:** Old engine used `Math.pow(utilization, 3) × 20` as a latency heuristic. It smoothed out the exponential latency blowup that happens as ρ → 1, so users never saw "queueing collapse."
- **Decision:** [src/engine/QueueingModel.ts](src/engine/QueueingModel.ts) with `waitTime = procTime × ρ / (1 - ρ)`, effective ρ clamped at 0.95 for latency calc, wait capped at 5000ms. Drop rate = `1 - 1/ρ` when ρ > 1.
- **Why:** Matches what senior engineers expect. Shows the cliff at ρ → 1 that drives capacity planning decisions.
- **Rejected:** Heuristic (unrealistic). Full markovian model (overkill for a teaching tool; latency explosion is the only thing that matters).
- **Source:** commit `66f6ec3`, [src/engine/QueueingModel.ts](src/engine/QueueingModel.ts).

### 7. Zipfian working-set cache model with cold-start warmup

- **When:** SIMFID Phase 2, commit `66f6ec3` (2026-04-15)
- **Context:** Old cache model was `0.85 + random() × 0.1` — a dice roll. No working-set concept, no way to express "your cache is smaller than your hot set."
- **Decision:** [src/engine/WorkingSetCache.ts](src/engine/WorkingSetCache.ts) models: `hitRate = min(1, (cacheSize/workingSet)^(1/zipfSkew))` with `zipfSkew = 1.2`, linear warmup over `ttl × 0.5`, LRU scan penalty (×0.85), stampede risk when `rps > 1000 && ttl < 60 && hitRate > 0.7`.
- **Why:** The 80-20 rule is the thing you're trying to teach. Zipf encodes it naturally. Cold-start warmup shows why "my cache hit rate is great" lies right after deploy.
- **Rejected:** Simple % config (doesn't explain failures). Full LRU simulator (too slow for interactive sim).
- **Source:** commit `66f6ec3`, [src/engine/WorkingSetCache.ts](src/engine/WorkingSetCache.ts).

### 8. Wire latency propagation per hop

- **When:** SIMFID Phase 2, commit `66f6ec3` (2026-04-15)
- **Context:** Engine processed graph traversal synchronously in one tick. Wire latency existed as a config field but was never applied.
- **Decision:** Every `processX` accepts an `accumulatedLatencyMs` argument. `forwardToDownstreams` adds `getWireLatency(source, target)` before recursing. Downstream components report `state.metrics.p50 = localLatency + accumulatedLatencyMs`.
- **Why:** Teaches latency compounding through layers. A request through 4 hops at 50ms wire = +200ms p50 minimum, independent of processing.
- **Rejected:** Ignoring wire latency (unrealistic).
- **Source:** commit `66f6ec3`, [src/engine/SimulationEngine.ts](src/engine/SimulationEngine.ts) `forwardToDownstreams`.

### 9. Load Balancer latency reflects slowest backend

- **When:** SIMFID Phase 2, commit `66f6ec3` (2026-04-15)
- **Context:** Old LB had hardcoded `p50 = 1ms, p99 = 3ms` regardless of backend state.
- **Decision:** `processLoadBalancer` computes LB p50 = `0.5ms + maxDownstream × 0.7`, p99 = `0.5ms + maxDownstream × 1.3`, where `maxDownstream = max over healthy children of (child.lastComputedLatencyMs + wireLatency)`.
- **Why:** Fan-out tail latency is dominated by the slowest child. Teaches why "p99 at the LB is p99-of-the-slowest," not the mean.
- **Rejected:** Fixed LB latency (loses fan-out visibility).
- **Source:** commit `66f6ec3`, [src/engine/SimulationEngine.ts](src/engine/SimulationEngine.ts) `processLoadBalancer`.

### 10. Stressed mode: peak-hold + cold cache + wire p99, one-shot

- **When:** SIMFID Phase 3, branch `feat/preflight-routing` (2026-04-16)
- **Context:** Users only ever saw one simulation per config. Couldn't answer "will this hold under worst-case?" without manually cranking RPS in the traffic editor.
- **Decision:** Added a `Run Stressed` button as a one-shot alternate (not a persistent toggle). When stressed: `getCurrentRps()` returns `max(phases.rps)`, caches + CDN force `hitRate = 0`, `getWireLatency()` returns `base + full jitter`, stampede logs are skipped (cold cache already is the worst case).
- **Why:** "Best case" is vanity and actively harmful (users screenshot best-case numbers and ship). Only worst case matters in production planning.
- **Rejected:** Persistent toggle (state bloat). Always-run-stressed (loses normal-case baseline). Best-vs-worst two-simulation mode (2× cost for little added insight; p50/p99 in the per-component table already expresses the band).
- **Source:** [src/engine/SimulationEngine.ts](src/engine/SimulationEngine.ts) `stressedMode` field, [src/components/ui/Toolbar.tsx](src/components/ui/Toolbar.tsx) `handleRunStressed`, [~/.claude/plans/velvety-singing-rossum.md](~/.claude/plans/velvety-singing-rossum.md).

### 11. Saturation callouts bypass the per-tick log throttle

- **When:** SIMFID Phase 3, during Codex review fix-up (2026-04-16)
- **Context:** A callout like "server hit ρ=0.87, 13% headroom" fires once via `firedCallouts: Set<string>`. The old per-tick throttle key was `componentId + severity`, so if another warning fired on the same component in the same tick, one of them was dropped. Since callouts are one-shot, a dropped callout is lost forever.
- **Decision:** Added `calloutEntries: WeakSet<LogEntry>` tracked in `fireCallout`. The per-tick throttle filter skips any entry in that WeakSet.
- **Why:** Callouts are already deduped by `firedCallouts`. Double-throttling just causes silent loss. The first Codex-proposed fix (include message prefix in the throttle key) would have caused spam on dynamic-number warnings like "Dropping 45% of requests" because the prefix changes each tick.
- **Rejected:** Message-prefix in throttle key (spam risk). Direct push to `this.log` bypassing `newLogs` (breaks UI which reads `newLogs`).
- **Source:** [src/engine/SimulationEngine.ts](src/engine/SimulationEngine.ts) `calloutEntries`, regression test in [src/engine/__tests__/SimulationEngine.test.ts](src/engine/__tests__/SimulationEngine.test.ts).

### 12a. Circuit breakers live per-wire, opt-in via WireConfig.circuitBreaker

- **When:** SIMFID Phase 3.1 (2026-04-16)
- **Context:** CEO plan §2.8 calls for per-wire circuit breakers. Existing tests and scenarios must not regress when the feature ships.
- **Decision:** New [src/engine/CircuitBreaker.ts](src/engine/CircuitBreaker.ts) with a three-state machine (`CLOSED → OPEN → HALF_OPEN → CLOSED`). `WireConfig.circuitBreaker?` is optional: presence enables, absence skips all breaker logic for that wire. `forwardOverWire` gates on breaker state. End-of-tick `evaluateBreakers` advances the state machine from the target component's errorRate. Transitions emit logs that bypass the per-tick throttle via `calloutEntries` WeakSet. Load Balancer's healthy-backend filter also excludes breaker-OPEN wires.
- **Why:** Opt-in preserves ~283 existing tests unchanged. Per-wire state matches the CEO plan's "refactor processComponent to iterate wires." Transition bypass prevents close-together `open → half_open → closed` events from being swallowed by the component-level throttle.
- **Rejected:** Always-on with defaults (would trip on existing overload scenarios and add spurious test noise). Component-level breakers (CEO plan explicitly says per-wire). Probe-rate sampling in HALF_OPEN (real breakers let only N% through — simplified to full traffic for simulation clarity; documented as a known approximation).
- **Source:** commits on `feat/simfid-phase3-resilience` branch; [src/engine/CircuitBreaker.ts](src/engine/CircuitBreaker.ts), [src/engine/SimulationEngine.ts](src/engine/SimulationEngine.ts) `forwardOverWire`, `evaluateBreakers`.

### 12b. HALF_OPEN requires actual probe traffic to count as success

- **When:** SIMFID Phase 3.1, Codex review fix (2026-04-16)
- **Context:** Initial 3.1 implementation treated "no failure this tick" as "success." A quiet phase (low or zero RPS) would silently tick the breaker back to CLOSED without a single real request validating the downstream.
- **Decision:** Added `hadTrafficThisTick: boolean` on `CircuitBreakerState`. `forwardOverWire` sets it true whenever traffic actually flows through the wire. In HALF_OPEN, `evaluateBreaker` only increments `consecutiveSuccessTicks` if `hadTrafficThisTick === true`. Reset at start of each tick.
- **Why:** Correctness. A breaker's whole purpose is to gate traffic around a failing downstream — recovering without a probe defeats it. Codex caught this in 3.1 review.
- **Rejected:** Probe-limit sampling (more complex, not needed for correctness). Counting quiet ticks as "success but with half credit" (opaque).
- **Source:** [src/engine/CircuitBreaker.ts](src/engine/CircuitBreaker.ts) `hadTrafficThisTick`, [src/engine/SimulationEngine.ts](src/engine/SimulationEngine.ts) `forwardOverWire`.

### 12c. Full instantaneous-metrics reset at start of every tick

- **When:** SIMFID Phase 3.1 (2026-04-16)
- **Context:** With breaker OPEN, downstream processors are skipped. Without a reset, `state.metrics.rps`, `errorRate`, `p99`, etc. would retain pre-trip values — the canvas and debrief would show 100 RPS on a component actually receiving 0.
- **Decision:** At the start of each tick, zero out `rps`, `errorRate`, `p50`, `p95`, `p99`, `cpuPercent`, `memoryPercent` on every NON-crashed component. Crashed components keep their last-known metrics so users see why they crashed. Processors overwrite with real values when they run.
- **Why:** Live metrics must reflect this tick's reality, not last tick's. Critical for breaker UX — OPEN means the component is visibly quiet.
- **Rejected:** Reset everything including crashed (loses crash context). Reset only `rps` (leaves `p99` / CPU stale on quiet ticks — Codex caught this). Historical metrics like `queueDepth` are accumulators and intentionally not reset.
- **Source:** [src/engine/SimulationEngine.ts](src/engine/SimulationEngine.ts) `tick()` reset loop.

### 12d. Retry storms use previous-tick errorRate + same-tick bundling

- **When:** SIMFID Phase 3.2 (2026-04-16)
- **Context:** CEO plan §2.6 calls for `round N = round(N-1) × errorRate` geometric retry amplification. Open question: how to model retry timing in a 1-second tick engine?
- **Decision:** New [src/engine/RetryPolicy.ts](src/engine/RetryPolicy.ts). Retry config lives on the **upstream** component (`config.retryPolicy = { maxRetries, backoffMs?, backoffMultiplier? }`). `WireState` gains `lastObservedErrorRate: number`, updated after each forward. In `forwardOverWire`, if upstream has a retry policy, amplification factor = `1 + e + e² + … + e^maxRetries` using **previous tick's** `lastObservedErrorRate` (not this tick's). All retry waves bundle into the same tick's RPS to the downstream.
- **Why:** We can't observe errorRate until after the downstream processes the request — can't retry within the same tick's processComponent call without re-entry. Using previous-tick observation matches the one-tick propagation delay planned for backpressure (3.3), is deterministic, and captures the "your DB is taking 3× nominal because of retry storms" capacity impact that's the whole point. Tick-0 has no history so amplification = 1 (no retry).
- **Rejected:** Multi-pass within same tick (target metrics overwritten each call, loses aggregate). Spreading retries across ticks (matches reality but the model would diverge for maxRetries > tick duration). Per-request retry queue (full discrete-event simulator; overkill).
- **Known side benefit:** `wire.lastObservedErrorRate` is **per-wire**, closing the multi-inbound breaker observability limitation from 3.1. Future refactor can also feed this into the breaker's failure signal for per-wire semantics.
- **Source:** [src/engine/RetryPolicy.ts](src/engine/RetryPolicy.ts), [src/engine/SimulationEngine.ts](src/engine/SimulationEngine.ts) `forwardOverWire` retry branch, `WireState.lastObservedErrorRate`.

### 12e. Retry suppression during HALF_OPEN + stale-signal reset on OPEN→HALF_OPEN

- **When:** SIMFID Phase 3.2, Codex review fix (2026-04-16)
- **Context:** Initial 3.2 implementation had two bugs: (1) retry amplification still fired when the breaker was HALF_OPEN — a probe tick would get slammed with stale-error amplification, guaranteeing re-OPEN; (2) if a wire's `lastObservedErrorRate` was 0.8 when the breaker tripped, that value persisted through the cooldown and the first HALF_OPEN probe would amplify 3× based on 20s-old data.
- **Decision:** (1) `forwardOverWire` skips retry amplification when `wire.breaker.status === 'half_open'`. (2) When `evaluateBreakers` transitions OPEN→HALF_OPEN, also reset `wire.lastObservedErrorRate = 0` so the probe forwards at nominal RPS.
- **Why:** HALF_OPEN semantic is "send a small test request, don't overwhelm the recovering downstream." Amplifying defeats the purpose. Resetting the error signal on transition prevents stale data from polluting the recovery attempt.
- **Rejected:** Decay `lastObservedErrorRate` over idle ticks (more complex, harder to reason about). Keep amplifying but reduce by some factor during HALF_OPEN (still wrong — any amplification at all on a probe can re-open the breaker).
- **Source:** [src/engine/SimulationEngine.ts](src/engine/SimulationEngine.ts) `forwardOverWire` `breakerHalfOpen` check + `evaluateBreakers` OPEN→HALF_OPEN reset.

### 12f. readRetryPolicy rejects Infinity / NaN / fractional maxRetries

- **When:** SIMFID Phase 3.2, Codex review fix (2026-04-16)
- **Context:** Original `readRetryPolicy` accepted any positive number for `maxRetries`. `Infinity` would hang `computeAmplification`'s for-loop. Fractional values gave nonsense retry counts.
- **Decision:** Validate `maxRetries` with `Number.isFinite(n) && Number.isInteger(n) && n > 0`. Reject arrays, null, functions. Also validate `backoffMs` / `backoffMultiplier` for finiteness.
- **Why:** Defensive parsing at system boundaries (config is user-editable). An Infinity would freeze the simulation.
- **Source:** [src/engine/RetryPolicy.ts](src/engine/RetryPolicy.ts) `readRetryPolicy`.

### 12g. Backpressure: opt-in, `acceptanceRate = 1 - errorRate`, one-tick delay

- **When:** SIMFID Phase 3.3 (2026-04-16)
- **Context:** CEO plan §2.7 calls for components to signal `acceptanceRate` per tick; upstream reads it to scale forwarded RPS. One-tick delay to match real propagation.
- **Decision:** New [src/engine/Backpressure.ts](src/engine/Backpressure.ts) with `computeAcceptanceRate(errorRate)` + `readBackpressureConfig(config)`. `ComponentState` gains `acceptanceRate: number` (init 1.0). End-of-tick hook updates the signal for non-crashed components with `config.backpressure = { enabled: true }`. `forwardOverWire`, after retry amplification, multiplies by `target.acceptanceRate` when the target opted in.
- **Why:** Symmetric with CircuitBreaker + RetryPolicy (opt-in via config field, evaluated end-of-tick, consumed next tick). Simple inverse `1 - errorRate` keeps the mental model clear: "what fraction of requests did the target succeed on last tick?"
- **Rejected:** Always-on (breaks existing scenarios). Per-wire backpressure (backpressure is a property of the target's state, not the wire; fan-in should share it). Smoothed EWMA (future enhancement; adds hysteresis).
- **Source:** [src/engine/Backpressure.ts](src/engine/Backpressure.ts), [src/engine/SimulationEngine.ts](src/engine/SimulationEngine.ts) `forwardOverWire` backpressure branch + end-of-tick update loop.

### 12h. Backpressure no-traffic guard + HALF_OPEN bypass

- **When:** SIMFID Phase 3.3, Codex review fix (2026-04-16)
- **Context:** Three real bugs Codex caught: (1) End-of-tick reset zeros `errorRate` for all non-crashed components. If the target gets 0 RPS this tick, the naive update computes `acceptanceRate = 1 - 0 = 1` and falsely heals the backpressure signal. (2) HALF_OPEN probe was getting scaled by stale `acceptanceRate` — if that was 0, the probe never landed and the breaker locked in HALF_OPEN forever. (3) Callout predicate `> 0 && <= 0.7` excluded `acceptanceRate = 0`, the worst case.
- **Decision:** (1) Skip the end-of-tick `acceptanceRate` update when `state.metrics.rps <= 0` (no fresh data → hold prior value). (2) Skip backpressure scaling in `forwardOverWire` when the breaker is HALF_OPEN (same reasoning as retry suppression — probes must flow at nominal rate). (3) Callout predicate `< 1 && <= 0.7` correctly includes 0.
- **Why:** Missing data is not health. Probes must actually land to validate recovery. Callouts must cover the worst case.
- **Rejected:** Decaying `acceptanceRate` over idle ticks (more complex). Forcing a minimum probe RPS during HALF_OPEN (opaque, better to just skip both upstream controls).
- **Source:** [src/engine/SimulationEngine.ts](src/engine/SimulationEngine.ts) `forwardOverWire` `breakerHalfOpen` guards + no-rps guard in end-of-tick update.

### 12i. Phase 3 UI: ConfigPanel toggles + wire color + showcase template

- **When:** SIMFID Phase 3 UI pass (2026-04-16)
- **Context:** Phase 3 engine work shipped entirely opt-in via config fields. Without UI surface, users could only enable features via devtools-console snippets — useless for manual validation or demos.
- **Decision:** Added four UI pieces in one pass:
  1. **Engine → store → UI** plumbing: `tick()` returns `wireStates: Record<edgeId, { breakerStatus, lastObservedErrorRate }>`. Store gains `liveWireStates` field, populated by `useSimulation` each tick.
  2. **ConfigPanel** gains three resilience sections: `CircuitBreakerSection` (on wire selection), `RetryPolicySection` (on forwarding components), `BackpressureSection` (on components whose processors emit errorRate).
  3. **SimWireEdge** renders breaker state: OPEN = destructive-red dashed, HALF_OPEN = amber dashed, CLOSED/null = default. Only during actively-running sim (avoids stale paint post-completion).
  4. **`resilience_showcase.json` template** pre-wires all three features on a 4-node graph (LB → API Gateway rate-limit → server w/ retries → DB w/ backpressure + breaker on the LB → gateway wire). One click from landing page; traffic profile designed to trip all three callouts in under 10s.
- **Why:** Opt-in is great for test stability, but features that can't be toggled via UI aren't really shipped. Adding UI makes the engine features dogfoodable, supports a real demo flow, and lets the design review process start critiquing resilience UX.
- **Rejected:** Single modal for wire config (floating modal adds UI complexity; extending the existing right-dock ConfigPanel handles both nodes and wires cleanly). Visual wire state in a separate overlay (easier but wastes the existing edge rendering hook).
- **Source:** commits on `feat/simfid-phase3-resilience` branch; [src/engine/SimulationEngine.ts](src/engine/SimulationEngine.ts) `WireLiveState` + tick() return; [src/components/canvas/SimWireEdge.tsx](src/components/canvas/SimWireEdge.tsx) breaker colors; [src/components/panels/ConfigPanel.tsx](src/components/panels/ConfigPanel.tsx) `CircuitBreakerSection` / `RetryPolicySection` / `BackpressureSection`; [public/templates/resilience_showcase.json](public/templates/resilience_showcase.json).

### 12j. Graph-version teardown: useSimulation stops the timer when the graph is replaced

- **When:** SIMFID Phase 3 UI, Codex review fix (2026-04-16)
- **Context:** `replaceGraph` only called `resetSimulationState()` which clears the store, but the simulation timer and `SimulationEngine` instance both live in `useRef` inside `useSimulation`. If the graph was replaced mid-run, the old engine would keep ticking and writing stale metrics/wireStates onto the newly-loaded graph. Codex caught this during Phase 3 UI review (finding #1).
- **Decision:** Added a `useEffect` in `useSimulation` that watches `graphVersion` (bumped by `replaceGraph`). On change (after the initial mount), it clears the interval, nulls out `engineRef` and `metricsHistoryRef`, and updates its stored version.
- **Why:** Correctness. Store state and engine state must stay in sync. The alternative (exposing `stopSimulation` through the store so `replaceGraph` can call it) would introduce a circular dependency between the store and the hook's lifecycle.
- **Source:** [src/engine/useSimulation.ts](src/engine/useSimulation.ts) `useEffect` on `graphVersion`.

### 12k. UI-level validation for retry + breaker numeric inputs

- **When:** SIMFID Phase 3 UI, Codex review fix (2026-04-16)
- **Context:** The new ConfigPanel sections let users type any value into numeric fields. `maxRetries: Infinity` hangs `computeAmplification`'s for-loop. The engine already rejects invalid policies via `readRetryPolicy`, but silently — so the toggle could look enabled while retries did nothing. Codex finding #3 + #5.
- **Decision:** Added UI helpers (`safeFiniteNumber`, `safePositiveInt`, `clampFinite`) and applied them to every numeric field in `CircuitBreakerSection` and `RetryPolicySection`. Fractional `maxRetries` → floored. Infinity/NaN → fallback. `failureThreshold` clamped to [0, 1]. Counts clamped to min 1.
- **Why:** Defense in depth. Engine validation is still the ground truth, but UI validation means the toggle's state reflects reality.
- **Source:** [src/components/panels/ConfigPanel.tsx](src/components/panels/ConfigPanel.tsx) helper functions + updated `onChange` handlers.

### 12l. Backpressure toggle gated to components that emit errorRate

- **When:** SIMFID Phase 3 UI, Codex review fix (2026-04-16)
- **Context:** Backpressure toggle was shown on all component types, but several processors never set `state.metrics.errorRate` (fanout, websocket_gateway, cdn, autoscaler, cache). Enabling backpressure on those did silently nothing. Codex finding #4.
- **Decision:** Added `canBackpressure(type)` helper returning true only for processors that meaningfully emit errorRate: `server`, `database`, `queue`, `api_gateway`, `external`, `load_balancer`. `BackpressureSection` is conditional on this check.
- **Why:** Don't expose a control that doesn't do anything. Hides the toggle instead of letting users click it and wonder why nothing happens.
- **Source:** [src/components/panels/ConfigPanel.tsx](src/components/panels/ConfigPanel.tsx) `canBackpressure` + conditional render.

### 12m. SimWireEdge shows breaker color only during actively-running sim

- **When:** SIMFID Phase 3 UI, Codex review fix (2026-04-16)
- **Context:** `liveWireStates` persists after simulation completes (it's useful for the debrief view). But edges were painted with breaker colors even on `completed` status, so a user editing the graph post-run would see stale colors from the old topology. Codex finding #2.
- **Decision:** SimWireEdge gates breaker color rendering on `simulationStatus === 'running' || 'paused'`. Once 'completed' or 'idle', edges render as normal regardless of `liveWireStates`.
- **Why:** Stale paint misleads. Post-run users are in edit mode; showing breaker colors suggests the wire is still in that state.
- **Source:** [src/components/canvas/SimWireEdge.tsx](src/components/canvas/SimWireEdge.tsx) `showBreakerState` check.

### 12. Saturation callouts fire without upper bound on ρ

- **When:** SIMFID Phase 3, Codex review fix (2026-04-16)
- **Context:** Original condition was `q.utilization >= 0.85 && q.utilization < 1`. If a scenario jumped from idle straight to ρ = 5 (heavy overload), the callout silently never fired.
- **Decision:** Removed the `< 1` upper bound on both server saturation and DB pool-pressure callouts. Clamp the "headroom %" at 0 so the message reads sensibly.
- **Why:** The callout's job is to warn about saturation. It should fire loudest at the worst case, not skip it.
- **Rejected:** Adding a separate "overload" callout (noisy, overlapping info).
- **Source:** [src/engine/SimulationEngine.ts](src/engine/SimulationEngine.ts) `processServer`, `processDatabase`.

---

## Product scope

### 13. 6 MVP component types

- **When:** MVP Phase 1, commit `e8fdd08` (2026-04-08)
- **Context:** Full library had 11 types. Cognitive load and UI clutter for a first-run user.
- **Decision:** `MVP_VISIBLE_TYPES` = LB, API Gateway, Server, Cache, Queue, Database. Hidden: WebSocket Gateway, Notification Bus, Fanout, CDN, External, Autoscaler. Hidden types still exist in the engine for template compatibility.
- **Why:** 6 types covers the core patterns (queueing, caching, sharding, fanout). Users can ramp to full library later.
- **Rejected:** All 11 types (overwhelms). 3 types (can't express core patterns).
- **Source:** commit `e8fdd08`, [src/types/components.ts](src/types/components.ts) `MVP_VISIBLE_TYPES`.

### 14. Templates-first landing page

- **When:** commit `05e2b74` (2026-04-04)
- **Context:** Blank canvas intimidated founders. "Where do I start?"
- **Decision:** Landing page shows a TemplatePicker (Discord fanout, URL shortener, Instagram feed, Uber dispatch, Basic CRUD) + a UnifiedInput for text/image-to-diagram. Blank freeform is a tertiary option.
- **Why:** Templates teach by example. "Start with Discord fanout, now add X" is a better onboarding conversation than staring at nothing.
- **Rejected:** Blank-first (bounced users). Wizard setup (inflexible).
- **Source:** commit `05e2b74`, `/public/templates/*.json`, [src/components/ui/TemplatePicker.tsx](src/components/ui/TemplatePicker.tsx).

### 15. Vision-to-intent over pure text-to-diagram

- **When:** V2I Phase 1, commit `1afcfb7` (2026-04-12)
- **Context:** Customer interviews showed founders *already have* Miro/Figma/Excalidraw diagrams. Translating an existing artifact is higher-confidence than generating prose → graph.
- **Decision:** `UnifiedInput` accepts text + image. Posts to `/api/describe-intent` (Claude Opus vision + tool_use). Returns `{ intent, systemSpec, confidence }`. User reviews + edits in `ReviewMode` before deriving components.
- **Why:** Vision grounds the output. The intermediate "review" step builds trust (user controls what becomes the canvas).
- **Rejected:** Text-only (customers had images). No review step (errors propagate to canvas).
- **Source:** commit `1afcfb7`, [api/describe-intent.ts](api/describe-intent.ts), [src/components/ui/UnifiedInput.tsx](src/components/ui/UnifiedInput.tsx), [src/components/ui/ReviewMode.tsx](src/components/ui/ReviewMode.tsx).

### 16. "0-to-1 greenfield" framing over "audit my system"

- **When:** Strategy, customer interview 2026-04-15
- **Context:** Senior engineer unprompted: "If I already have an architecture, I'm not switching because AI said to. Going 0-to-1, here's the blueprint, I'll act on it."
- **Decision:** Primary flows (templates, vision-to-intent, Discord scenario) bias toward greenfield design. Audit-existing is not in scope.
- **Why:** Primary segment validates 0-to-1 as the moat. Audit is a harder sell and competes with free ChatGPT.
- **Rejected:** "Analyze your system" as primary entry (weaker signal).
- **Source:** [memory/project_customer_interviews.md](~/.claude/projects/-Users-divyanshkhare-DeveloperWorkArea-systemsim/memory/project_customer_interviews.md).

### 17. Defer: RAG-over-tech-talks ("Context7 for system design")

- **When:** 2026-04-15
- **Context:** Same senior engineer: "Like Context7 but for system design. How Cloudflare actually solved distributed consistency, not generic tech talk."
- **Decision:** Noted as its own product track. Not bolted into SIMFID. Will get a separate CEO plan and possibly an MCP/skill.
- **Why:** Different architecture, different design review cycle. Mixing with SIMFID scope creep would drag both.
- **Rejected:** Bolting onto SIMFID plan.
- **Source:** [memory/project_customer_interviews.md](~/.claude/projects/-Users-divyanshkhare-DeveloperWorkArea-systemsim/memory/project_customer_interviews.md).

### 18. Defer: V2I Phase 2 (coherence score, bidirectional sync)

- **When:** 2026-04-14, `TODOS.md [V2I-PHASE-2]`
- **Context:** V1 ships intent extraction. V2 would show a live "Vision ↔ Design: X%" coherence badge and sync edits in both directions.
- **Decision:** Deferred. Needs 2-4 weeks of user data to tune thresholds.
- **Why:** Tuning coherence thresholds without real data would produce bad UX. Better to watch how users actually diverge intent vs canvas, then design the feedback.
- **Rejected:** Guess thresholds (fragile). Ship without the badge (misses differentiation).
- **Source:** [TODOS.md](TODOS.md) `[V2I-PHASE-2]`.

### 19. Reject: Drawing canvas (Excalidraw-like)

- **When:** 2026-04-01, [PRODUCT_VISION.md](PRODUCT_VISION.md)
- **Context:** Original wishlist had freehand drawing on canvas.
- **Decision:** Out of scope. Vision-to-intent solves the same user need (import existing diagram) more cheaply.
- **Why:** Drawing is UI complexity. Import is an LLM call. Second route subsumes the first.
- **Rejected:** Ship drawing (scope explosion).
- **Source:** [PRODUCT_VISION.md](PRODUCT_VISION.md).

### 20. Reject: Live node addition during running simulation

- **When:** 2026-04-01, [PRODUCT_VISION.md](PRODUCT_VISION.md)
- **Context:** Wishlist had "add components while sim is running" for "oh shit" incident-response feel.
- **Decision:** Out of scope. Pause-edit-resume already works.
- **Why:** Mid-flight graph mutation is architectural complexity. Unclear UX benefit.
- **Rejected:** Ship live mutation (risky).
- **Source:** [PRODUCT_VISION.md](PRODUCT_VISION.md).

---

## UX / UI patterns

### 21. Tabbed bottom panel replaces overlay debrief

- **When:** commit `d76e231` (2026-04-15)
- **Context:** Old `DebriefPanel` overlaid the canvas. The Live Log disappeared when the sim ended and the Debrief popped up. Users lost context.
- **Decision:** [BottomPanel.tsx](src/components/panels/BottomPanel.tsx) is a VS Code-style tabbed container (Live Log + Debrief). Log tab persists after sim, Debrief tab auto-activates on completion. Expand/collapse, close buttons, `data-testid="bottom-panel"` for E2E.
- **Why:** Users want to flip between "what just happened" (log) and "what it means" (debrief) without losing either.
- **Rejected:** Separate floating windows (context switching). Overlay (destroys log history).
- **Source:** commit `d76e231`, [src/components/panels/BottomPanel.tsx](src/components/panels/BottomPanel.tsx).

### 22. Preflight items route to fix locations with pulse

- **When:** commit `ca35183` (2026-04-15)
- **Context:** Preflight errors weren't actionable. "Define API endpoints" without telling the user *where* to define them.
- **Decision:** Each `PreflightItem` carries `target`, `targetSubtab`, `targetComponentId`. Clicking routes to the right tab / node + triggers `pulseTarget` store state, which drives a CSS pulse animation on the target.
- **Why:** Errors → actions → outcomes. Users shouldn't have to hunt.
- **Rejected:** Error list without routing (unhelpful). Separate help panel (extra clicks).
- **Source:** commit `ca35183`, [src/components/canvas/PreflightBanner.tsx](src/components/canvas/PreflightBanner.tsx).

### 23. Remix with confirm modal + undo toast

- **When:** commit `f366304` (2026-04-04)
- **Context:** Remix is a destructive generate (replaces the canvas). Needs clarity and recovery.
- **Decision:** Remix button in toolbar when canvas has nodes. Inline input expands. ConfirmModal for "Replace current canvas?" UndoToast after apply: "Remixed. ⌘Z to restore."
- **Why:** Explicit confirm + undo = safe destructive action. Apple-inspired inline feel.
- **Rejected:** Silent apply (no undo). Modal-only (extra click).
- **Source:** commit `f366304`, [src/components/ui/RemixInput.tsx](src/components/ui/RemixInput.tsx), [src/components/ui/ConfirmModal.tsx](src/components/ui/ConfirmModal.tsx), [src/components/ui/UndoToast.tsx](src/components/ui/UndoToast.tsx).

### 24. Light + dark mode via CSS variables

- **When:** commit `fc57f1c` (2026-04-02)
- **Context:** Many users code in dark rooms at night.
- **Decision:** Single accent color (Apple Blue `#0071e3` light, `#2997ff` dark). All tokens in `:root` and `:root.dark` in [src/index.css](src/index.css). Toggle button in toolbar toggles `document.documentElement.classList`.
- **Why:** Token system gives dark mode for free. No component-level theme logic.
- **Rejected:** System-preference only (no user choice). Per-component theming (drift).
- **Source:** commit `fc57f1c`, [src/index.css](src/index.css), [DESIGN.md](DESIGN.md).

### 25. Debrief shows raw scores, not Pass/Warn/Fail

- **When:** SIMFID Phase 3 (2026-04-16)
- **Context:** "Pass/Warn/Fail" is zero information density. Two runs both "Warn" could be 41 and 69. Engineers need the number.
- **Decision:** `ScoreBadge` displays the rounded score (0-100) colored by threshold (>70 green, >=40 amber, <40 red). Same applies in the downloaded HTML report. The per-component table shows p50, p99, ρ, errors, peak queue with individual severity colors per cell.
- **Why:** Real numbers are the SLO conversation. Labels obscure it.
- **Rejected:** Pass/Warn/Fail labels (information loss).
- **Source:** [src/components/panels/BottomPanel.tsx](src/components/panels/BottomPanel.tsx) `ScoreBadge`, [src/ai/generateDebriefHtml.ts](src/ai/generateDebriefHtml.ts).

### 26. Per-component peak table in debrief

- **When:** SIMFID Phase 3 (2026-04-16)
- **Context:** A single overall score tells the user "something is slow" but not *which component*. Engineers want to know which hop burns their latency budget.
- **Decision:** `PerComponentTable` at the top of the Debrief tab: one row per component, columns `p50 | p99 | ρ | Errors | Peak Queue`, sorted by p99 desc. Cells colored by severity (p99 <200ms green, <500ms amber, else red).
- **Why:** This IS the SLO conversation. The worst offender bubbles up automatically.
- **Rejected:** Summary metrics only (insufficient). Per-component chart (requires a chart lib; table is enough).
- **Source:** [src/components/panels/BottomPanel.tsx](src/components/panels/BottomPanel.tsx) `PerComponentTable`, [src/ai/debrief.ts](src/ai/debrief.ts) `computePerComponentPeaks`.

### 27. Design audit findings F-001 through F-005 fixed inline

- **When:** commits `a273d38`, `cd19304`, `d6bd110`, `7824f44`, `354bb19` (2026-04-14)
- **Context:** Design review surfaced 5 issues (heading hierarchy, contrast ratio, cramped header, invisible attach button, faded source chip) + 1 deferred (mobile touch targets).
- **Decision:** Five inline commits. F-006 (touch targets <44px) deferred to V2I Phase 2.
- **Why:** Small, high-impact fixes ship immediately. Touch targets are desktop-only MVP scope.
- **Rejected:** Ship with B+ design. Delay ship for mobile fixes.
- **Source:** commits `a273d38`, `cd19304`, `d6bd110`, `7824f44`, `354bb19`; [.gstack/projects/T-98-systemsim/designs/design-audit-20260414/](.gstack/projects/T-98-systemsim/designs/design-audit-20260414/).

---

## Process

### 28. Codex review after each phase of a multi-phase plan

- **When:** 2026-04-16, memory: [feedback_codex_after_each_phase.md](~/.claude/projects/-Users-divyanshkhare-DeveloperWorkArea-systemsim/memory/feedback_codex_after_each_phase.md)
- **Context:** SIMFID Phase 3 self-review missed 6 real bugs. Codex (GPT-5) caught all of them: throttle key regression, CDN not zeroed in stressed mode, fake stampede logs under stressed mode, saturation callouts skipping ρ≥1, `generateDebriefHtml` still rendering Pass/Warn/Fail, score-badge color/number boundary mismatch.
- **Decision:** After each phase of a plan is implemented + tested, before marking the phase complete, run `/codex` consult with a focused prompt pointing at the phase's files. Fix real bugs. Defensible findings get noted with reasoning.
- **Why:** Self-review is anchored. A fresh model catches what you missed. 6 bugs per phase × 3 phases × N plans = a lot of shipped regressions avoided.
- **Rejected:** Codex on every commit (noisy, expensive). No outside voice (misses cases).
- **Source:** [memory/feedback_codex_after_each_phase.md](~/.claude/projects/-Users-divyanshkhare-DeveloperWorkArea-systemsim/memory/feedback_codex_after_each_phase.md).

### 29. User creates PRs; Claude provides title + body text

- **When:** 2026-04-12, [feedback_pr_creation.md](~/.claude/projects/-Users-divyanshkhare-DeveloperWorkArea-systemsim/memory/feedback_pr_creation.md)
- **Context:** User prefers to click "Create PR" in GitHub themselves.
- **Decision:** After branch push, Claude prints a copy-ready PR title + body block. No `gh pr create`.
- **Why:** User retains control over PR timing and final phrasing.
- **Rejected:** Automated PR creation.
- **Source:** [memory/feedback_pr_creation.md](~/.claude/projects/-Users-divyanshkhare-DeveloperWorkArea-systemsim/memory/feedback_pr_creation.md).

### 30. Deterministic debrief ships first, AI merges async

- **When:** commits `028c09d` + `3e1ffee` (2026-04-04)
- **Context:** Anthropic API latency can spike to 10s+. Blocking the debrief on the LLM call makes the app feel broken.
- **Decision:** `generateDebrief` (deterministic, instant) sets the debrief store field. `fetchAIDebrief` runs async with 15s timeout. When it resolves, AI questions merge into `debrief.aiQuestions` and a green "AI" tag appears. On failure, banner reads "AI debrief unavailable — showing rule-based analysis only."
- **Why:** UX doesn't regress on API outage. Deterministic is always useful on its own.
- **Rejected:** Block UI on LLM (bad UX). Require AI (fragile).
- **Source:** commits `028c09d`, `3e1ffee`, [src/engine/useSimulation.ts](src/engine/useSimulation.ts) `stopSimulation`.

### 31. Playwright E2E with screenshots + HTML report per feature

- **When:** commit `28112e8` (2026-04-08), made standard in [feedback_playwright_validation.md](~/.claude/projects/-Users-divyanshkhare-DeveloperWorkArea-systemsim/memory/feedback_playwright_validation.md)
- **Context:** Engine + UI changes interact in ways unit tests miss.
- **Decision:** Every feature gets an E2E spec that (a) sets up the scenario via store injection, (b) runs the sim at 10× speed, (c) captures canvas + debrief screenshots + HTML debrief report, (d) writes artifacts to `test-results/{feature}/`.
- **Why:** Reproducible + visual evidence + regression catch.
- **Rejected:** Manual testing (doesn't scale). Unit tests only (misses integration).
- **Source:** commit `28112e8`, [e2e/simfid-phase2-validation.spec.ts](e2e/simfid-phase2-validation.spec.ts), [e2e/simfid-phase3-debrief-numbers.spec.ts](e2e/simfid-phase3-debrief-numbers.spec.ts).

### 32. Vitest for unit, Playwright for E2E, hard-separated

- **When:** commit `28112e8` (2026-04-08)
- **Context:** Both test runners exist; sharing them would pick up each other's files and slow everything down.
- **Decision:** `vite.config.ts` excludes `e2e/` from Vitest. `playwright.config.ts` targets only `e2e/`.
- **Why:** Fast unit feedback loop, separate E2E pipeline.
- **Rejected:** Single runner (slow, context overhead).
- **Source:** commit `28112e8`, [vite.config.ts](vite.config.ts), [playwright.config.ts](playwright.config.ts).

### 33. DESIGN.md enforces Apple aesthetic + AI-slop blacklist

- **When:** commit `1afcfb7` (2026-04-12)
- **Context:** AI-generated design regresses to purple gradients, centered-everything, emoji icons.
- **Decision:** [DESIGN.md](DESIGN.md) codifies tokens (single accent: Apple Blue), voice (direct, non-technical-founder-friendly), and a 10-item AI-slop blacklist. Design review is gate before shipping UI changes.
- **Why:** Explicit rules prevent drift. Tokens give consistency for free.
- **Rejected:** No design system (drifts). Taste-based review only (inconsistent).
- **Source:** [DESIGN.md](DESIGN.md), design audit commits `a273d38–354bb19`.

### 34. Runtime fidelity is the product moat

- **When:** Validated 2026-04-15
- **Context:** Senior engineer customer: simulation fidelity is the single biggest differentiator vs Miro AI / Figma AI / ChatGPT.
- **Decision:** SIMFID plan phases that deepen runtime realism (queueing math, Zipfian cache, wire latency, stressed mode, saturation callouts) take priority over surface-area expansion (more component types, more templates). Marketing and demo flow foreground runtime.
- **Why:** Runtime is hard to copy (requires deep distributed systems knowledge). Breadth commoditizes. Drawing tools are a race to the bottom.
- **Rejected:** Feature breadth (commoditizes). LLM-generation focus (users can use ChatGPT).
- **Source:** [memory/project_customer_interviews.md](~/.claude/projects/-Users-divyanshkhare-DeveloperWorkArea-systemsim/memory/project_customer_interviews.md), direction reflected in SIMFID Phase 1-3 scope.

### 35. KB `system-design-knowledgebase.md` is authorial memory, not served content

- **When:** KB Phase 0.6 (2026-04-17)
- **Context:** The wiki/info-card promise in PRODUCT_VISION.md lines 5–6 needs well-structured long-form content to draw from. Options: (a) serve the KB directly as wiki pages, (b) curate derivative wiki pages from the KB.
- **Decision:** KB is treated as **authorial memory** — long-form, prose-first, cross-referenced. Wiki copy in `src/wiki/topics.ts` is **curated derivatives** (1–2-sentence popovers, 3–5-paragraph wiki pages, diagrams, "Load in canvas" buttons). Never serve the KB verbatim.
- **Why:** Wiki needs pacing, diagrams, and product-specific context (how SIMFID models the concept) that a reference doc shouldn't carry. KB needs completeness and cross-references a wiki UI would fight. Two audiences, two voices.
- **Rejected:** Serving the KB as the wiki (loses product specificity; pace is wrong for UI consumption). Skipping the KB (forces the wiki writer to invent structure and leads to inconsistent voice across topics).
- **Source:** [/Users/divyanshkhare/.claude/plans/replicated-brewing-floyd.md](~/.claude/plans/replicated-brewing-floyd.md), [system-design-knowledgebase.md](system-design-knowledgebase.md) header.

### 36. KB structure: Part VII "Extended Patterns & Case Studies" for source material that didn't have canonical section slots

- **When:** KB Phase 0.6 (2026-04-17)
- **Context:** The original KB skeleton numbered §22 Rate Limiting through §27 Unique IDs under Parts V/VI. Five source articles (cache-first, two-stage, DB-per-service, DB optimization, CDC sync) plus two case studies (Kafka+Redis, MQ+cache) had no sections. Options: fold into existing sections (bloats them) or add new sections.
- **Decision:** Added **Part VII — Extended Patterns & Case Studies** with §33–§39. SIMFID Runtime shifts to Part VIII (§40–§44). TOC + cross-references updated.
- **Why:** Keeps the "one screen, one topic" constraint the topic registry needs. Case studies (§38, §39) are integration examples that benefit from standalone top-level status. Fold-into-§10 would have bloated Caching past readability.
- **Rejected:** Folding into existing sections (§10 becomes 500 lines). Separate docs per pattern (fragments the "one canonical source" invariant).
- **Source:** KB file revision 2026-04-17, Phase 0.6.

### 37. KB §14 Big Data is one mega-section, sub-headed — not 18 separate top-level §s

- **When:** KB Phase 0.7 (2026-04-17)
- **Context:** 18 source articles on batch and stream processing needed to land in the KB. Options: (a) 18 top-level sections (§14 → §31 or similar — would force renumbering again); (b) one mega-section §14 with 6 groups × multiple sub-headings, matching the shape §10 Caching established (343 lines, multi-sub-heading).
- **Decision:** Single §14 Batch & Stream Processing with sub-sections §14.1–§14.6 covering Foundations, Batch, Stream, Architectures, Delivery & Correctness, Serving Layer. Mirrors §10's shape.
- **Why:** Consistency with §10 (the only other mega-topic in the KB). Avoids a second round of TOC renumbering. Lets the wiki topic registry pick individual sub-sections (e.g. `concept.watermark` → §14.3.3) without a separate §-per-topic naming burden.
- **Rejected:** 18 top-level §s (churn in numbering, harder to navigate). Splitting across parts (batch in Part III, stream in Part V — loses the batch-stream-unified narrative).
- **Source:** KB file §14 revision 2026-04-17, Phase 0.7.

### 38. KB §40–§44 SIMFID Runtime docs cite code with file:line; fan-in caveats explicit

- **When:** KB Phase 0.8 (2026-04-18)
- **Context:** Part VIII of the KB documents what the simulator actually does (circuit breaker, retry storm, backpressure, wire config, traffic profile). First codex review found 8 contradictions between my initial docs and the code — e.g. LB does even split not weighted, wire jitter is per-call not per-packet, userDistribution and jitterPercent are declared but unused, multi-inbound resilience has last-invocation bias not clean per-wire behavior.
- **Decision:** Every §40–§44 subsection cites `src/engine/*.ts` file:line references. The fan-in caveat (components overwrite `state.metrics` per `processComponent` call, so in fan-in topologies breaker/retry/backpressure signals are last-invocation-biased) is documented explicitly in §40.6, §41.2, §42.5 — not hidden. The ForwardResult refactor that would fix it is named as deferred.
- **Why:** SIMFID's runtime fidelity is the product moat (Decisions §34). Docs that misrepresent engine behavior erode the moat. Grounding every claim in code reference + running codex review against the code catches drift during the writing pass itself.
- **Rejected:** Abstract "how it works" prose without file:line cites (lets drift sneak in). Hiding the fan-in limitation (users would trip over it and lose trust).
- **Source:** KB file §40–§44 revision 2026-04-18, Phase 0.8.

### 39. Wiki route uses appView state, not URL routing

- **When:** Phase A-scaffold (2026-04-18)
- **Context:** The original A-scaffold plan called for `/wiki` and `/wiki/coverage` URL routes with hash-based deep-links (`/wiki#component.server`). The codebase has no router installed — the app routes by state (`appView`) read from the Zustand store, with top-level components mounted conditionally in [src/App.tsx](src/App.tsx:28-52).
- **Decision:** Extended `AppView` with `'wiki' | 'wiki-coverage'` values. Deep-linking via a new `wikiFocusedTopic: string | null` store field. `openWiki(topic?)` and `openWikiCoverage()` store actions handle the transition; `closeWiki()` returns to the remembered `wikiReturnView`. No `react-router-dom` installed.
- **Why:** Adding a router would touch every top-level view + all nav paths (LandingPage, ReviewMode, DesignFlow, Canvas) for one feature. State routing matches the existing pattern and keeps scope tight. URL deep-linking (share a link to a topic) is a later concern; it can land alongside a broader router migration if it ever becomes worth it.
- **Rejected:** Installing React Router (scope creep). Using `window.location.hash` alone (wouldn't survive a reload without extra state wiring).
- **Source:** [src/App.tsx](src/App.tsx), [src/store/index.ts](src/store/index.ts) `wiki*` actions, [src/types/index.ts](src/types/index.ts) `AppView`.

### 40. Topic coverage enforced at dev time via `window.__SYSTEMSIM_TOPIC_REFS__`

- **When:** Phase A-scaffold (2026-04-18)
- **Context:** Every `<InfoIcon topic="..." />` reference across the app must resolve to a declared key in [src/wiki/topics.ts](src/wiki/topics.ts). Drift between what the UI references and what the registry declares is easy to introduce as new config fields, component types, or how-tos ship.
- **Decision:** Every mounted InfoIcon registers its topic into a `Set<string>` on `window.__SYSTEMSIM_TOPIC_REFS__`. The dev-only `/wiki/coverage` route (appView === 'wiki-coverage') reads the set and flags any reference that doesn't resolve. [e2e/wiki-coverage.spec.ts](e2e/wiki-coverage.spec.ts) asserts the unresolved count is exactly zero — this runs in CI on every change.
- **Why:** Static detection via grep/tsc doesn't work because many InfoIcon topic keys are computed (e.g. `config.${key}` on dynamic component config). A runtime check with an E2E assertion catches drift without coupling to TypeScript literals.
- **Rejected:** TypeScript template-literal types over topic keys (breaks on dynamic keys). Grep-based CI check (false negatives on computed strings).
- **Source:** [src/components/ui/InfoIcon.tsx](src/components/ui/InfoIcon.tsx) `registerRef`, [src/wiki/components/CoverageDebugRoute.tsx](src/wiki/components/CoverageDebugRoute.tsx), [e2e/wiki-coverage.spec.ts](e2e/wiki-coverage.spec.ts).

### 41. Left sidebar widens to 320px on ≥1200px, collapses to a 44px rail below

- **When:** Phase B1 (2026-04-18)
- **Context:** CanvasSidebar was 240px wide — too tight for the new traffic editor with PhaseCurve + NL input, but 320px steals canvas width on 13" laptops.
- **Decision:** Sidebar is 320px on viewports ≥1200px, collapses to a 44px rail below that. Manual expand / collapse available at any width via `sidebar-expand` / `sidebar-collapse` buttons. Collapsed state is panel-local (session-only), not persisted — explicit design choice to avoid "I don't know why my sidebar is collapsed" confusion across sessions.
- **Why:** 320px is the measured minimum for the traffic editor content to not wrap awkwardly. Below 1200px the canvas gets squeezed if the sidebar takes its share; auto-collapse preserves canvas affordance.
- **Rejected:** Fixed 320px always (breaks at 1024px). Drawer overlay always (loses at-a-glance context). Persisting collapse in the store (cross-session confusion).
- **Source:** [src/components/panels/CanvasSidebar.tsx](src/components/panels/CanvasSidebar.tsx), [e2e/traffic-panel-scroll.spec.ts](e2e/traffic-panel-scroll.spec.ts).

### 42. Traffic profile PhaseCurve is a shape-aware pure render, no store dep

- **When:** Phase B2 (2026-04-18)
- **Context:** Users were editing phases numerically without seeing the resulting RPS curve. The existing phase table requires spatial reasoning (start / end / rps columns) to imagine the shape.
- **Decision:** [src/components/panels/PhaseCurve.tsx](src/components/panels/PhaseCurve.tsx) renders a ~60px-tall SVG above the phase list. Each phase contributes shape-aware points (steady = flat, ramp = diagonal, spike = peak triangle, instant_spike = step jump). Hover tooltip shows `t=<s>s, RPS=<n>` derived by evaluating the phase at the hovered x-coordinate. Zero store dependency — pure render over props. Renders reactively via React state in TrafficEditor.
- **Why:** Visual preview eliminates the spatial-reasoning tax. Curve visualization exposes shape misuse (e.g. `ramp_up` with wrong startS immediately looks wrong). Pure render keeps the component cheap to reason about and test.
- **Rejected:** Live-simulation preview (expensive, stale vs user edits). A live Chart.js / visx dependency (bundle bloat for one 60px SVG).
- **Source:** [src/components/panels/PhaseCurve.tsx](src/components/panels/PhaseCurve.tsx), [e2e/traffic-phase-curve.spec.ts](e2e/traffic-phase-curve.spec.ts).

### 43. Natural-language traffic input via /api/traffic-intent (Sonnet 4.6 tool_choice)

- **When:** Phase B3 (2026-04-18)
- **Context:** The phase table UX requires understanding the `shape` enum and thinking in `{startS, endS, rps}` tuples — a gatekeeping abstraction for first-time users. Meanwhile the user almost always starts with a plain-English description of what they want to simulate ("ramp to 500 then spike to 8000 for 5 seconds").
- **Decision:** Added an NL textarea + Generate button that calls [/api/traffic-intent](api/traffic-intent.ts), a Vercel Edge Function using Claude Sonnet 4.6 with a `traffic_intent` tool_choice that forces structured output. Hand-rolled validator in [src/ai/trafficIntentSchema.ts](src/ai/trafficIntentSchema.ts) (matches describeIntentSchema pattern) rejects malformed shapes with internal reason codes logged server-side only. Client uses the shared `callAIEndpoint` helper for consistent `AICallResult` discriminated unions.
- **Why:** Claude Sonnet 4.6 is the right model for structured-JSON text tasks (Opus would be overkill here; describe-intent uses Opus only because it's vision-heavy). Tool-choice guarantees the model emits the right shape. Hand-rolled validator matches existing pattern for consistency. Abort-on-unmount via AbortController + AbortSignal propagated through callAIEndpoint.
- **Rejected:** Free-form Claude response + post-hoc parsing (fragile). Zod schema (inconsistent with describeIntentSchema). Not persisting the generation to the store (breaks "NL → canvas picks it up immediately" UX).
- **Source:** [api/traffic-intent.ts](api/traffic-intent.ts), [src/ai/trafficIntent.ts](src/ai/trafficIntent.ts), [src/ai/trafficIntentSchema.ts](src/ai/trafficIntentSchema.ts), [src/ai/trafficIntentPrompt.ts](src/ai/trafficIntentPrompt.ts), [src/components/panels/TrafficEditor.tsx](src/components/panels/TrafficEditor.tsx) `handleGenerate`.

### 44. Live log filter + group state is panel-local, not store-resident

- **When:** Phase C1 / C4 (2026-04-18)
- **Context:** The live log needed severity + component filters and collapsed group rows. Each has transient state (which chips are active, which groups are expanded). Options: put the state in the Zustand store (shared, survives remounts) or keep it local to the LogContent component (session-only).
- **Decision:** Panel-local state via `useState`. `filter` and `expanded` live in the component; unmount resets them.
- **Why:** Filter + expand states are inherently ephemeral — they shouldn't affect what any other component sees, and they shouldn't be persisted across sim runs or navigations. Keeping them out of the store avoids needless rerenders on every keystroke and keeps the store surface focused on simulation state.
- **Rejected:** Store-resident state (cross-component coupling; needless persistence; more rerender surface).
- **Source:** [src/components/panels/BottomPanel.tsx](src/components/panels/BottomPanel.tsx) `LogContent`.

### 45. Callout phrase detection via pre-compiled module-level regexes

- **When:** Phase C3 (2026-04-18)
- **Context:** Engine log entries carry only free-text messages — no structured topic field on `LogEntry` (confirmed in `SimulationEngine.ts:224` `fireCallout`). To link phrases like "Circuit breaker opened", "ρ=0.92", "signaling backpressure" to wiki topics, detection has to happen at render time.
- **Decision:** [src/components/panels/liveLog/calloutPhrases.ts](src/components/panels/liveLog/calloutPhrases.ts) declares a list of `{ topic, pattern }` pairs. Regexes are pre-compiled once at module load with the `g` flag (not rebuilt per call). `segmentMessage` splits a message into text + phrase segments and caches results in a bounded Map (500 entries, FIFO eviction). First-declared-pattern-wins on overlap.
- **Why:** Rebuilding RegExp objects per render per message was O(rows × patterns × length) in the hot path (codex flagged this). Module-level precompile + per-message memoization brings segmentation to near-free on re-render. Bounded cache avoids unbounded memory growth.
- **Rejected:** Adding a `topic?: string` field to `LogEntry` and plumbing it through the engine (touches every `fireCallout` call site; deferred). Per-render `new RegExp(source, 'g')` (measurably slower at scale).
- **Source:** [src/components/panels/liveLog/calloutPhrases.ts](src/components/panels/liveLog/calloutPhrases.ts), [src/components/panels/liveLog/LogGroupedRow.tsx](src/components/panels/liveLog/LogGroupedRow.tsx) `SingleRow`.

### 47. Docs product is three tabs (Learn / Reference / How-to) — react.dev-inspired IA

- **When:** Phase A-content (2026-04-18)
- **Context:** The wiki needed to serve two distinct audiences at once: beginners working through a linear manual ("how do I use SystemSim?") and experienced users looking up one concept ("what's CQRS?"). Plus a third surface for canvas-loadable failure scenarios. Single-tab / flat nav conflates the three.
- **Decision:** Three top-level tabs in `WikiRoute`:
  - **Learn** (`userGuide.*`) — 18 hand-written pages, ordered via `USER_GUIDE_ORDER` for Prev/Next.
  - **Reference** (`reference.*` + `component.*` + `concept.*` + `config.*` + `severity.*`) — 39 auto-imported KB sections + shared InfoIcon leaf pages.
  - **How-to** (`howto.*`) — 5 hand-written scenarios with `<CanvasEmbed>` previews + "Take to canvas" CTAs.
- **Why:** Matches react.dev's `/learn` vs `/reference` split, which multiple agent reviews surfaced as the cleanest pattern for dual-audience docs. Keeps the linear tutorial flow from bleeding into lookup territory.
- **Rejected:** Single flat sidebar (loses the linear track). React Router (scope creep; existing appView-state routing is consistent with Decisions §39). Separate domain / subdomain for docs (fragments canvas → doc routing).
- **Source:** [src/wiki/WikiRoute.tsx](src/wiki/WikiRoute.tsx), [src/wiki/docsHash.ts](src/wiki/docsHash.ts).

### 48. KB Reference content is auto-imported at build time, never hand-synced

- **When:** Phase A-content P2 (2026-04-18)
- **Context:** The 44-section system-design-knowledgebase.md is the authoritative source. Hand-copying sections into topic bodies would drift the moment the KB is edited.
- **Decision:** `scripts/generate-reference-topics.ts` runs as a Vite plugin at `buildStart` + watches the KB file during dev. Splits on `## N. Title`, emits `src/wiki/generated/referenceTopics.ts` merged into `TOPICS` at module load. Same pipeline also emits `USER_GUIDE_TOPICS` (from `src/wiki/content/learn/*.md`) and `HOWTO_TOPICS` (from `src/wiki/content/howto/*.md`).
- **Why:** Single source of truth. KB edit → docs update on save. Authoring learn/howto content as markdown files instead of TypeScript string literals makes voice review + long-form authoring actually comfortable.
- **Rejected:** Runtime fetch of markdown (adds loading states, breaks URL deep-linking). Inline TypeScript string literals (painful to author, no syntax highlighting).
- **Source:** [scripts/generate-reference-topics.ts](scripts/generate-reference-topics.ts), [vite.config.ts](vite.config.ts).

### 49. CanvasEmbed: inline preview + "Take to canvas" handoff; inline Run deferred

- **When:** Phase A-content P4 (2026-04-18)
- **Context:** react.dev's Sandpack is the gold standard for learn-by-doing docs. The SystemSim equivalent is a mini read-only canvas inline in how-to pages. Original plan approved the ambitious Option A (inline Run too).
- **Decision:** Ship the preview + "Take to canvas" button now. Inline Run is stubbed (button disabled, labeled "Run inline (soon)"). The sim engine is currently coupled to the global Zustand store's `liveMetrics` / `liveLog` — instantiating a scoped engine with its own state requires a small refactor that's out of scope for the ship-now pressure on this phase.
- **Why:** The preview + handoff round-trip delivers 80% of the learning value. The handoff — a button that drops the user into a fully editable canvas pre-loaded with the scenario — is the feature the plan's expected-outcome walkthrough actually requires. Inline Run is polish on top; shipping it now would delay the rest of A-content by an uncertain amount.
- **Rejected:** Link-only "Load this example" (the preview is the distinctive feature — a flat link would be the same as the stub we had at A-scaffold). Full inline Run with a shared store (would pollute main-canvas state).
- **Source:** [src/wiki/components/CanvasEmbed.tsx](src/wiki/components/CanvasEmbed.tsx), follow-up tracked to scope a scoped sim-engine instance.

### 50. DOMParser-based allowlist sanitizer for MarkdownBody, not regex

- **When:** Phase A-content P7 (2026-04-18)
- **Context:** A Claude subagent independent review of the markdown renderer found 4 critical regex-sanitizer bypasses: unclosed `<script>`, unquoted attributes, HTML-entity / whitespace tricks on `javascript:` URLs, and missing coverage for `<object>` / `<embed>` / `<form action=javascript:>` / `data:image/svg+xml` / SVG-with-inline-handlers.
- **Decision:** Replace the regex sanitizer with a DOMParser-based pass: parse the HTML, walk the tree, whitelist tags (17 allowed), whitelist per-tag attributes, scrub `href`/`src` against a URL protocol allowlist (`https?:`, `mailto:`, `#`, `/`), force `rel="noopener noreferrer"` on `target=_blank` links, and strip comments. SSR fallback: regex-strip all tags.
- **Why:** Regex sanitizers are bypass-prone in well-known ways. DOMParser gives us a structured walk that closes those classes of attacks. Adds no deps (browser-native). Content is still 100% internal today; this is defense-in-depth for future user-supplied content.
- **Rejected:** DOMPurify (new 20KB dep). Keeping the regex (known bypasses). `iframe srcdoc` approach (overengineered).
- **Source:** [src/wiki/components/MarkdownBody.tsx](src/wiki/components/MarkdownBody.tsx) `sanitize` + `sanitizeNode`.

### 51. `<CanvasEmbed>` extraction blanks code blocks before regex scan; validates slug

- **When:** Phase A-content P7 (2026-04-18)
- **Context:** The subagent review also flagged that `<CanvasEmbed template="x" />` written *inside* a fenced code block (for documentation purposes) would still be spliced as a live embed. Separately, the template slug was fetched as-is — a slug like `../../../secret` would traverse the path.
- **Decision:** `splitOnEmbeds` scans a copy of the markdown with code blocks blanked to whitespace (preserves indexes); embed hits are then applied against the original markdown. The slug is validated against `^[a-zA-Z0-9_-]+$` at both the splitter (skip invalid matches silently) and the CanvasEmbed component (refuse to fetch). Fetch also uses `encodeURIComponent`.
- **Why:** Code blocks are how we document the embed tag itself on Learn pages; they can't become live embeds. Slug validation at two boundaries ensures an upstream authoring mistake or a regression in the splitter can't produce an arbitrary fetch.
- **Rejected:** Parsing via `marked` first and then searching the HTML (harder; `marked`'s output for unknown HTML tags is inconsistent).
- **Source:** [src/wiki/components/MarkdownBody.tsx](src/wiki/components/MarkdownBody.tsx) `splitOnEmbeds`, [src/wiki/components/CanvasEmbed.tsx](src/wiki/components/CanvasEmbed.tsx) `useEffect` guard.

### 52. Fan-in ForwardResult refactor shipped — 3-phase tick supersedes §38's caveat

- **When:** 2026-04-22 (commit `bef3a01`)
- **Context:** §38 decided to ship the fan-in caveat explicitly ("components overwrite `state.metrics` per `processComponent` call, so in fan-in topologies breaker/retry/backpressure signals are last-invocation-biased") and document it in KB §40.6, §41.2, §42.5 rather than hide it. The deferred fix was named "ForwardResult refactor". Diamond + fan-in topologies were becoming real in user templates; correctness debt rather than cosmetic gap.
- **Decision:** Replaced the recursive `forwardOverWire` / `processComponent` / path-based `callStack` cycle-detection with a 3-phase per-tick model. Phase A: `topologicalOrder(edges, entries)` from `graphTraversal.ts` returns a topo order of components and a set of cycle-closing back edges. Phase B: each component's processor runs exactly once per tick with its true aggregated inbound (Σ effective RPS across every inbound wire) and an rps-weighted accumulated latency (Σ rps·accLat / Σ rps); processors emit outbound wire outcomes via the new `emitOutbound` / `emitToDownstreams` primitives (apply breaker / retry / BP there, attribute effective RPS to the target's inbound accumulator before its turn). Phase C: every wire's `lastObservedErrorRate` is written to `target.metrics.errorRate` (true aggregate) guarded by `target.metrics.rps > 0`. Same no-traffic guard policy as `acceptanceRate` (§12h). Back-edge traffic and late-to-target deliveries are queued in `pendingInbound` and merged into the next tick's inbound at tick start — cycles no longer silently drop traffic.
- **Why:** Three concrete correctness improvements. (1) Breakers no longer bias to whichever fan-in wire happened to recurse last. (2) Retry amplification on every inbound wire to the same target is equal (both reading the aggregate) — previously each wire amplified against a different mid-tick slice. (3) `acceptanceRate` reflects the target's true aggregate saturation, not a slice. Plus: cycles are handled structurally instead of logged-and-dropped; LB latency / autoscaler CPU reads are now consistently one-tick-lagged (matching the pre-existing lag of retry + BP), which is invisible at 1 Hz tick rate but much simpler to reason about.
- **Rejected:** A surgical fix that just memoized `processComponent` in-tick would still leave `state.metrics` overwrites (the state mutations inside each processor call — queue depth, connection pool, `accumulatedErrors` — can't be replayed or rewound without double-counting). Two-sub-pass latency aggregation (one downstream-first, one upstream-after) was considered to preserve same-tick latency math; rejected as over-engineering — the one-tick-lag cost is imperceptible.
- **Source:** [src/engine/SimulationEngine.ts](src/engine/SimulationEngine.ts) `tick` phases + `emitOutbound` + `runComponent`, [src/engine/graphTraversal.ts](src/engine/graphTraversal.ts) `topologicalOrder`, [src/engine/__tests__/fanIn.test.ts](src/engine/__tests__/fanIn.test.ts). KB §40.6 / §41.2 / §42.5 updated to describe the aggregate behavior instead of the caveat.

### 53. SIMFID Phase 4 — engine consumes a `RoutingContext` bag; per-endpoint traffic distribution

- **When:** 2026-04-22
- **Context:** Pre-Phase-4 the engine seeded `rpsPerTick / entryPoints.length` on every entry, treating `/checkout` and `/healthz` as indistinguishable. `TrafficProfile.requestMix` existed but was ignored; `EndpointRoute.componentChain` / `weight` / `tablesAccessed` were populated by the describe-intent pipeline (Phase 1) but never reached the runtime. Per-DB shard derivation also only knew the single global `schemaShardKey` constructor arg, not the per-entity `assignedDbId` in `SchemaMemoryBlock`.
- **Decision:** Extend the engine constructor with an optional `RoutingContext` bag (`endpointRoutes?`, `schemaMemory?`, `requestMix?`, `apiContracts?`) added as the last positional param to keep every existing call site compatible. `useSimulation` forwards the store's `endpointRoutes` + `apiContracts` + `schemaMemory` and the profile's `requestMix`. Tick-start seeding now routes each matched `requestMix` key to its endpoint's `componentChain[0]`; unmatched keys ("default") fall into a default bucket distributed evenly across `entryPoints`. `requestMix` keys match in two shapes: the uuid `endpointId` (UI-created contracts) OR `"METHOD PATH"` via the contract join (authored scenarios like `discord.ts` — `"POST /event/everyone"`). Fallback layering: matched-mix → `EndpointRoute.weight` → legacy even-split. Stale chain heads (route → missing node) redistribute their share across remaining valid endpoints instead of leaking load, and fire a one-shot `routing-stale:<endpointId>` callout.
- **Why:** Lets later Phase 4 commits (read/write split, unindexed-scan multiplier, per-DB shard cardinality, Kingman) attribute behavior per-endpoint without any more constructor churn. Keeps the fan-in correctness model (§52) intact — the split error fields introduced in Phase 4.3 are labeled DB diagnostics; breaker / retry / backpressure still read the aggregate `errorRate` from Phase C.
- **Rejected:** Making `RoutingContext` required (breaking change, not justified pre-v1). Reading the store directly inside the engine (engine stays a pure tick processor; `useSimulation` is the only plumbing boundary). Dropping stale-chain endpoints' share silently (load-leak bug codex flagged in the earlier draft plan).
- **Source:** [src/engine/SimulationEngine.ts](src/engine/SimulationEngine.ts) `RoutingContext` export + `seedInboundTraffic`, [src/engine/useSimulation.ts](src/engine/useSimulation.ts) `startSimulation`, [src/engine/__tests__/engineRoutingDistribution.test.ts](src/engine/__tests__/engineRoutingDistribution.test.ts). Full Phase 4-8 plan: [docs/plans/2026-04-22-simfid-phases-4-8-revised.md](docs/plans/2026-04-22-simfid-phases-4-8-revised.md).

### 57. SIMFID Phase 4.6 — Kingman G/G/1 replaces M/M/1; arrival variance is a modeled prior, not a measurement

- **When:** 2026-04-24
- **Context:** Pre-Phase-4.6 `QueueingModel.computeQueueing` used the M/M/1 wait-time formula `procTime × ρ/(1 − ρ)`. Research debrief flagged that this under-models bursty real systems: a memoryless arrival assumption makes instant-spike traffic look identical to steady traffic at the same ρ, which it demonstrably isn't. Rare-event tails — the thing users actually care about teaching — are precisely where Kingman's two-moment correction kicks in.
- **Decision:** Replace the formula with Kingman (Whitt 1993): `waitTime ≈ ρ/(1 − ρ) × (Cₐ² + C_s²)/2 × procTime`. `C_s²` comes from the component's new optional `config.serviceVariance` (default 1.0 = exponential service → M/M/1 special case, bit-identical to pre-Phase-4.6 behavior). `Cₐ²` comes from the current `TrafficPhase.shape`: `steady → 1.0`, `ramp_up | ramp_down | spike → 2.0`, `instant_spike → 4.0`. Phase mapping is a MODELED prior, not a measurement — the tick interval doesn't give us a per-request interarrival-gap sample. This is an explicit codex-flagged caveat: `Cₐ²` is a teaching knob, not a derived signal. Defensive: inputs are clamped to `max(0, var)` against negative user entries.
- **Why:** The degenerate case (Cₐ²=C_s²=1.0) preserves every existing test — we didn't want to commit a full recalibration pass inside Phase 4. Callers opt in by setting `serviceVariance` or running under a spike phase. Practitioners (Kingsbury, Brooker, Alvaro — the names the research debrief worried about) recognize Whitt 1993 on sight, so labeling the formula correctly matters.
- **Rejected:** Measuring `Cₐ²` from observed tick-level arrivals (not enough fidelity at 1-second bucket size — we'd be measuring Poisson noise, not arrival burstiness). Replacing M/M/1 with M/G/1 (equivalent at `Cₐ²=1`, buys nothing new). Phase-shape mapping of 1.0 / 3.0 / 9.0 (more dramatic curves but codex flagged 4.0 as the defensible upper bound for an instant step-load).
- **Source:** [src/engine/QueueingModel.ts](src/engine/QueueingModel.ts) file docstring + `QueueingInput.arrivalVariance` / `serviceVariance`, [src/engine/SimulationEngine.ts](src/engine/SimulationEngine.ts) `getCurrentArrivalVariance` + `processServer`, [src/engine/__tests__/engineKingman.test.ts](src/engine/__tests__/engineKingman.test.ts). Plan: [docs/plans/2026-04-22-simfid-phases-4-8-revised.md](docs/plans/2026-04-22-simfid-phases-4-8-revised.md) §4.6. Reference: W. Whitt, "Approximations for the GI/G/m Queue" (1993).

### 58. SIMFID Phase 4.7 — Dean-Barroso fan-out tail visualization (pure UI, synthetic-threshold prior)

- **When:** 2026-04-24
- **Context:** Fan-out tail risk — the thing Dean & Barroso wrote "The Tail at Scale" (CACM 2013) about — is invisible in a pure p50/p99 readout. A 100-way scatter-gather with p(slow)=1% per leg sees a slow leg on ~63% of requests; no per-component metric surfaces that. Users miss the lesson.
- **Decision:** Add a `FanoutTailSection` widget to `ConfigPanel.tsx`, visible when the selected component is `load_balancer | fanout | api_gateway`. Renders `P(at_least_one_slow) = 1 − (1 − p_single_slow)^N` across N = 1..max(N, 128) on a log-scaled SVG sparkline, with a dashed line at the component's actual `N` (the outbound wire count, or `config.multiplier` for `fanout`). `p_single_slow` is a **SYNTHETIC THRESHOLD** defaulting to 0.01 — the engine doesn't record a per-request p99 at tick granularity (see §59 on CO-correctness), so we can't derive it from live metrics without hand-waving. The choice is explicit and documented both in the tooltip and in Decisions.
- **Why:** Pure UI. Zero engine changes. The math is pinned in `engineFanoutTail.test.ts` so the Dean-Barroso headline number (N=100, p=0.01 → ~63%) is regression-guarded. Users get the lesson inline on the relevant component, not in a wiki article.
- **Rejected:** Deriving `p_single_slow` from downstream observed `p99` by picking an arbitrary latency threshold (that's two synthetic knobs masquerading as one; clearer to keep a single prior). Moving the widget to a wiki page (easier to miss; the inspector panel is where users already look). Offering a live slider that re-writes the engine config (out of scope — the widget is an explainer, not a setting).
- **Source:** [src/components/panels/ConfigPanel.tsx](src/components/panels/ConfigPanel.tsx) `FanoutTailSection` + `countDownstreams`, [src/engine/__tests__/engineFanoutTail.test.ts](src/engine/__tests__/engineFanoutTail.test.ts). Plan: [docs/plans/2026-04-22-simfid-phases-4-8-revised.md](docs/plans/2026-04-22-simfid-phases-4-8-revised.md) §4.7. Reference: Dean & Barroso, "The Tail at Scale" CACM 56(2), 2013.
- **Round 7 [P1] scope correction (2026-04-24):** the original gate showed `FanoutTailSection` for `load_balancer | fanout | api_gateway`. The Dean-Barroso compounding math is correct ONLY for **scatter-gather** topologies — every backend is hit per request, the slowest dominates. Load balancers and API gateways route ONE request to ONE backend; their user-experienced tail equals the single-backend p99 (≈ `p_single_slow` itself), NOT `1 − (1 − p)^N`. Showing 63% slow on a 100-backend LB at p=1% was an order-of-magnitude lie. Gate is now `data.type === 'fanout'` only. If a future commit wants to surface single-backend tail risk on LBs / api_gateways, it must use a separate widget with the correct math (single-leg p99), not this one.

### 59. SIMFID Phase 4.8 — CO-correct within 1-tick granularity, not "safe by construction"

- **When:** 2026-04-24
- **Context:** An earlier draft of the Phase 4 plan claimed the tick-based engine is "coordinated-omission-safe by construction." Codex flagged this as overstated: the engine batches arrivals into 1-second ticks and defers backlog via `pendingInbound`, so a saturated component's latency reporting is not automatically CO-safe — it IS coarse-grained in a controlled way, but only if we explicitly track the dispatch time on each request so deferred legs don't reset the clock.
- **Decision:** Add `dispatchedAtTickMs: number` to `WireTickOutcome`, stamped with `this.time * 1000` at the instant `emitOutbound` is called. The cross-tick `pendingInbound` merge already accounts for the tick-delay in the latency numerator (`acc.num += pending.latNum + pending.rps * tickDelayMs`), which is the correctness-critical piece; the new field formalizes the contract for downstream consumers (future Phase 5 Validation Mode traces) and for the engine docstring claim. The docstring now reads "CO-correct within 1-tick granularity" — the tick interval (1 sim-second) is the engine's bucket size, NOT an omission. Requests deferred one tick carry their original `dispatchedAtTickMs` and report latency that includes the scheduling delay, not just the wire hop.
- **Why:** Honest claim that survives reviewer scrutiny (Kingsbury, Brooker). A "CO-correct within 1-tick" engine is a defensible simulation choice; a "CO-safe by construction" claim on a tick-based engine is a lie by omission. Future Validation Mode (Phase 5) will cross-check simulated vs measured traces using the same timestamps, so they're apples-to-apples from day one.
- **Rejected:** Sub-tick dispatch timestamps (would require per-request event-driven scheduling — a rewrite, not a patch). Dropping the CO language entirely from the engine docstring (obscures what we actually do; teaching value matters). Recording timestamps only on some wires (asymmetry breaks the "CO-correct" claim).
- **Source:** [src/engine/SimulationEngine.ts](src/engine/SimulationEngine.ts) file docstring + `WireTickOutcome.dispatchedAtTickMs` + `emitOutbound`, [docs/plans/2026-04-22-simfid-phases-4-8-revised.md](docs/plans/2026-04-22-simfid-phases-4-8-revised.md) §4.8. Reference: ScyllaDB, "On Coordinated Omission" (2021).

### 56. SIMFID Phase 4.5 — per-DB shard cardinality derived from `schemaMemory`, constructor globals demoted to legacy fallback

- **When:** 2026-04-24
- **Context:** Pre-Phase-4.5 the engine carried a single `schemaShardKey` / `schemaShardKeyCardinality` pair set at construction — derived by `useSimulation.ts` from the FIRST entity with a `partitionKey`. Every DB in the graph used this one value, so a scenario with two DBs (one cleanly sharded, one low-cardinality) couldn't model reality — either both showed Pareto hot-shard or neither did.
- **Decision:** New private helper `resolveShardKeyForDb(dbId)` on `SimulationEngine`. Walks four fallback layers in order: (1) `schemaMemory.entities` — first entity whose `assignedDbId === dbId` with a `partitionKey`, cardinality from `partitionKeyCardinalityWarning === true` (→ 'low') or the field's own cardinality; (2) `state.config.shardKey` on the DB node; (3) legacy constructor globals; (4) `{ null, 'high' }` default. `processDatabase` consults the resolver at the hot-shard branch — same `isLowCardinality || isUserIdShard` decision, now per-DB. Dangling `partitionKey` refs (names a field not in `entity.fields`) degrade gracefully to `'high'` cardinality — defensive against authoring mistakes rather than flagging everything low. Dangling `assignedDbId` (entity assigned to a deleted DB node) is inert — the live DB's resolver simply can't find a matching entity and falls through.
- **Why:** Multi-DB scenarios now express per-DB shard behavior correctly. Existing single-DB test paths (`SimulationEngine.test.ts` "Database > should detect hot shard") continue passing via layer 3. `useSimulation.ts` can keep populating the constructor args until a later cleanup commit — no breaking call-site churn.
- **Rejected:** Making `schemaMemory` a required constructor arg (breaks call sites that don't have a schema yet — e.g., freeform mode before design). Overwriting the constructor globals mid-tick (cross-tick mutation is a readability liability). Looking up by `entity.name === dbName` instead of `assignedDbId` (names aren't unique; `assignedDbId` is the authoritative edge between schema and graph, shipped in §53).
- **Source:** [src/engine/SimulationEngine.ts](src/engine/SimulationEngine.ts) `resolveShardKeyForDb` + `processDatabase` hot-shard branch, [src/engine/__tests__/engineShardCardinality.test.ts](src/engine/__tests__/engineShardCardinality.test.ts). Plan: [docs/plans/2026-04-22-simfid-phases-4-8-revised.md](docs/plans/2026-04-22-simfid-phases-4-8-revised.md) §4.5.

### 55. SIMFID Phase 4.4 — unindexed-access latency multiplier locked to preflight's 10× copy

- **When:** 2026-04-24
- **Context:** Preflight's warning at [`src/engine/preflight.ts:140`](src/engine/preflight.ts) tells users that queries without indexes are "10x slower" but the engine never modeled it — a run with `SchemaEntity.indexes=[]` felt identical to one with complete coverage. Research debrief flagged this as the highest-leverage place to add fidelity because indexing is a first-principles lesson most users get wrong.
- **Decision:** `processDatabase` now applies `dbLatency *= 1 + (SCAN_FACTOR - 1) × unindexedShare` where `SCAN_FACTOR = 10` (class constant locked to preflight's copy). `unindexedShare` is the fraction of routed DB-visiting endpoint shares whose `TableAccess.indexed === false` for tables on this DB (schema join via `assignedDbId`). Denominator is routed-DB-visiting share (sum of `endpointShareRpsThisTick` over endpoints whose chain reaches this DB AND whose `tablesAccessed` resolves to ≥1 table here), NOT raw inbound RPS — we don't attribute unindexed-ness to fan-out amplification or to the default bucket, which would be speculative. When the schema join is sparse (no entities assigned to this DB yet) we accept any table in the endpoint's `tablesAccessed` array — better over-attribute than silently zero. A one-shot callout `unindexed-scan:<tableId>` fires per `(dbId, tableId)` when that single table's unindexed share exceeds 5%; wording uses "may include unindexed access" (not "scan") because `TableAccess.indexed` is coarse — one flag covers every operation on that table for that endpoint, even reads the real engine might push through an existing index. Multiplier clamp: `unindexedShare = min(1, unindexedSum / routedDbShareSum)` — a single endpoint touching three un-indexed tables doesn't triple-weight.
- **Why:** Users see the lesson preflight promises. 1% unindexed → 9% latency bump (noticeable but not dramatic); 50% unindexed → 5.5× (clearly broken). Keeps the math in one place and pins the constant to the user-facing copy so drift gets caught at review time. Callout threshold (5%) picks up meaningful scans without noise from tiny admin endpoints.
- **Rejected:** Denominator = total DB inbound (would let fan-out amplification dilute the signal — 1 routed unindexed endpoint behind a 10× fanout reads as 10% unindexed when it's 100%). Raising `SCAN_FACTOR` to 50× (matches the "full table scan" intuition better but drifts from preflight's tooltip). Firing callouts per-endpoint rather than per-table (dedup key collision — `fireCallout` keys on `componentId:calloutType`, and multiple endpoints hitting the same unindexed table would collide).
- **Source:** [src/engine/SimulationEngine.ts](src/engine/SimulationEngine.ts) `processDatabase` (scan multiplier) + `SCAN_FACTOR` + `UNINDEXED_CALLOUT_THRESHOLD`, [src/engine/preflight.ts:140](src/engine/preflight.ts) (copy source of truth), [src/engine/__tests__/engineTableScan.test.ts](src/engine/__tests__/engineTableScan.test.ts). Plan: [docs/plans/2026-04-22-simfid-phases-4-8-revised.md](docs/plans/2026-04-22-simfid-phases-4-8-revised.md) §4.4.

### 54. SIMFID Phase 4.3 — DB read/write split is a diagnostic signal, not a control signal

- **When:** 2026-04-24
- **Context:** Pre-Phase-4.3 `processDatabase` computed a single aggregate `errorRate` from connection-pool exhaustion. Research debrief flagged this as too coarse: a read-heavy workload saturating a write-throttled DB looked the same as a write-heavy workload, and users couldn't see *which side* was the problem. The natural fix is to split the signal — but that conflicts with the fan-in correctness invariant (§52) which says breakers/retry/backpressure all read the target's aggregate `errorRate`.
- **Decision:** `ComponentMetrics` gains two optional DB-only fields, `readErrorRate` and `writeErrorRate`. `processDatabase` attributes inbound rps to read vs write by walking `endpointRoutes[].tablesAccessed` and joining tables to this DB via `schemaMemory.entities[].assignedDbId`; modes are per-operation (`read_write` adds the endpoint's full share to BOTH sides, not half each). When no endpoint chain visits this DB or the routing context is empty, a 70/30 read/write fallback applies — matches typical load-generator defaults. Each side saturates independently against `readThroughputRps × (1 + readReplicas)` and `writeThroughputRps`, using the same `errorRate = clamp(0, 0.9, (util - 1) × 0.5)` curve that connection-pool exhaustion uses. Aggregate `errorRate = max(readErrorRate, writeErrorRate, connectionPoolDropRate)` so breakers, retry amplification, and backpressure (all unchanged) still see the worst failure mode. The per-side callouts (`read-saturation`, `write-saturation`, one-shot via `fireCallout` keyed on dbId+side) ONLY fire when attribution was available — fallback 70/30 is a modeling assumption, not a user-facing signal, so warning about "write saturation" on an un-attributed DB would be misleading. Divide-by-zero guarded: side with capacity=0 AND inbound>0 saturates to the 0.9 ceiling.
- **Why:** Keeps §52 intact — no control-signal surface area changes, just a richer diagnostic readout the debrief and inspector can show users. "Your DB is unhealthy" splits into "reads are fine, writes are 250% over capacity — add a queue, batch, or shard." Implementation cost is tiny (one helper + three fields) and every control path still funnels through the aggregate.
- **Rejected:** Separate breakers per side (would require per-side wire state, a breaking API change on WireConfig, and complicates fan-in aggregation). Making `errorRate = max(readErrorRate, writeErrorRate)` and dropping connection-pool from the aggregate (would hide pool exhaustion from breakers/retry — real regression). Per-request halving of `read_write` share (breaks the per-operation intuition — a request that does one read and one write loads the DB twice, not once).
- **Source:** [src/engine/SimulationEngine.ts](src/engine/SimulationEngine.ts) `processDatabase` + `computeDbReadWriteBreakdown` + `endpointShareRpsThisTick`, [src/types/index.ts](src/types/index.ts) `ComponentMetrics`, [src/engine/__tests__/engineReadWriteSplit.test.ts](src/engine/__tests__/engineReadWriteSplit.test.ts). Plan: [docs/plans/2026-04-22-simfid-phases-4-8-revised.md](docs/plans/2026-04-22-simfid-phases-4-8-revised.md) §4.3.

### 60. SIMFID Phase 4 post-merge codex review — unattributed DB traffic folds into the 70/30 default, and the unindexed-scan denominator is unified

- **When:** 2026-04-24 (follow-up commit on `feat/simfid-phase4-schema-driven` after `codex review --base main`).
- **Context:** Codex branch-vs-main review flagged two composition bugs in `processDatabase`. [P1]: when part of a DB's inbound is attributable via `endpointRoutes + tablesAccessed` and part isn't (default-bucket traffic, routes with empty `tablesAccessed`, partial `schemaMemory`), the unattributed remainder was silently dropped from the read/write split — the 70/30 fallback only kicked in when BOTH sides were zero. A sparse-schema DB could look healthy while genuinely saturated; breakers / retry / backpressure (which still read the aggregate `errorRate` per §52 / §54) would miss the real failure. [P2]: the unindexed-scan multiplier used `routedDbShareSum` (endpoints with `tablesAccessed` resolving to this DB) while the callout threshold used a separate `routedDbShareSumLocal` (every endpoint visiting the DB). The multiplier could spike hard while the `may include unindexed access` callout silently dropped below the 5% threshold — exactly the sparse-schema case where the warning is most useful.
- **Decision:** (P1) After computing `routedReadRps + routedWriteRps`, if the sum is strictly less than `totalInboundRps`, distribute the remainder via the same `DB_FALLBACK_READ_SHARE` (0.7) constant the no-attribution branch uses. Aggregate errorRate now reflects the DB's true load. `attributed: true` is still returned — the split is trusted for the classifiable portion and augmented for the rest. (P2) Hoist `routedDbShareSum` out of the multiplier block and reuse it verbatim as the callout denominator. Both now compute `unindexedShare = unindexedSum / routedDbShareSum`. The denominator counts every endpoint share visiting the DB (tables classified or not), which matches what a user means by "fraction of this DB's traffic that's unindexed."
- **Why:** Aggregate fan-in-correctness is load-bearing (§52). The split fields are diagnostic (§54), but they feed `errorRate = max(readErrorRate, writeErrorRate, poolErrorRate)`, and breakers watch that aggregate. A hidden-saturation bug in the split undoes the §52 guarantee. And the denominator-split bug made the scan multiplier and its warning silently disagree — users saw latency spikes they couldn't explain. Both fail the invariant the handoff doc names as rule #2: "Don't silently misroute. Warn and degrade."
- **Rejected:** Refusing to split when attribution was partial (would leave `attributed: false` for a case that IS partially attributable — loses the diagnostic). Using `totalInboundRps` as the callout denominator (would include default-bucket traffic that by construction doesn't contribute `TableAccess` info — dilutes the signal even when the schema is complete).
- **Source:** [src/engine/SimulationEngine.ts](src/engine/SimulationEngine.ts) `attributeDbInbound` partial-remainder branch + the hoisted `routedDbShareSum` in `processDatabase`'s unindexed-scan path. New tests: [engineReadWriteSplit.test.ts](src/engine/__tests__/engineReadWriteSplit.test.ts) `partial attribution distributes the unclassified remainder via the 70/30 default`, [engineTableScan.test.ts](src/engine/__tests__/engineTableScan.test.ts) `unindexed share + callout share use the SAME denominator`. Codex session: `019dbe91-106f-7e60-8802-7da147992aa9`.

### 61. SIMFID Phase 4 codex round 2 — DB-arrival scaling, `read_write` unique-share, fallback-only callout gate

- **When:** 2026-04-24 (follow-up to §60 after a second `codex review --base main` pass).
- **Context:** The first codex round (§60) fixed the no-remainder + denominator-mismatch bugs, but the re-review surfaced three deeper issues. [P1a] `attributedRps = routedReadRps + routedWriteRps` double-counted `read_write` routes (share landed in both buckets and was subtracted twice from the remainder). [P1b] / [P2a] both the read/write split and the unindexed-scan multiplier attributed DB load from `endpointShareRpsThisTick` — the seeded share at `componentChain[0]`, NOT the RPS that actually reaches the DB after upstream caches/CDNs filter or fan-outs amplify. A 99%-hit-rate cache between entry and DB would still have the DB attribute the full entry share — `writeErrorRate = 0.9` on a DB receiving 1% of the load, breakers tripping on phantom saturation. [P2b] `attributed: true` was returned whenever classified attribution was nonzero, so the user-visible `read-saturation` / `write-saturation` callouts fired even when the 70/30 filler on unclassified traffic drove the saturation — users chasing phantom hot spots in sparse-schema graphs.
- **Decision:** (1) Extract `computeDbArrivalFactor(dbId, totalInboundRps)` — returns `totalInboundRps / Σ(entry share of routes visiting this DB)` or 0 when no routes visit. Both the read/write split and the unindexed-scan walks now scale each route's contribution by this factor before summing. Routes now contribute their ACTUAL DB share, not their seeded entry share. (2) Track `attributedRpsAtDb` as the sum of UNIQUE-endpoint DB shares (counted once per route even when `read_write` hits both buckets) — that's the real remainder base for the 70/30 fallback. (3) Return an `attributionRatio` field; `attributed: true` iff `attributionRatio >= 0.5` (classified routes dominate). Saturation callouts already gate on `attributed`, so the gate is automatic.
- **Why:** The fan-in-correctness guarantee (§52) is load-bearing only when the aggregate `errorRate` reflects the DB's true saturation. Entry-share attribution was off by orders of magnitude on any topology with a cache / CDN / fan-out between the entry and the DB — the Discord scenario, the Reddit cache-stampede demo, and anything modeling a CDN-fronted API all fail silently or falsely without this scaling. The `read_write` double-count was a numerical bug my own §60 fix introduced. The callout gate matches the plan's §4.3 promise: "no user-facing warning on fallback-only data."
- **Rejected:** Clamping `dbArrivalFactor` at 1 (would silently discard fan-out amplification). Tracking per-route provenance through the graph (requires disassembling the §52 fan-in refactor — too invasive). Using `totalInboundRps` as the scan multiplier denominator directly (would include default-bucket traffic that by construction has no `TableAccess` info — dilutes the signal). The chosen denominator (`routedDbShareSum` post-scaling) still reflects only the DB's attributable load, consistent across the multiplier and the callout threshold (§60).
- **Known approximation:** When default-bucket traffic also reaches this DB, `dbArrivalFactor` over-attributes routes' share (the default's DB contribution mixes into `totalInboundRps` without a separate provenance track). The error is bounded by the default bucket's DB share ratio; in the pathological case of 100% default-bucket + 0 routes touching, `computeDbArrivalFactor` returns 0 and the caller falls back to pure 70/30 on `totalInboundRps` — safe.
- **Source:** [src/engine/SimulationEngine.ts](src/engine/SimulationEngine.ts) `computeDbArrivalFactor` (new), `computeDbReadWriteBreakdown` (refactored with `attributionRatio`), `processDatabase` scan path (uses `scanArrivalFactor`). New tests: [engineReadWriteSplit.test.ts](src/engine/__tests__/engineReadWriteSplit.test.ts) `read_write share is counted ONCE`, `scales attributed DB load by the ACTUAL inbound`, `suppresses write-saturation callout when attribution is <50%`. Full suite 410/410 + Playwright 2/2. Codex sessions: `019dbe91-106f-7e60-8802-7da147992aa9` (round 1), round 2 same session resumed post-commit.

### 62. SIMFID Phase 4 codex round 3 — routed chain heads are topo roots; stale route chains drop from DB attribution

- **When:** 2026-04-24 (third `codex review --base main` pass after §61).
- **Context:** Round 3 surfaced two more composition bugs that the round-2 scaling fix exposed. [P1 topo-roots] `topologicalOrder` was called with `this.entryPoints` only, but `seedInboundTraffic` writes to every route's `componentChain[0]` — which is not always a graph entry. When `setApiContracts` falls back to `componentChain: [ownerServiceId]` during a partially-wired graph edit, the routed head runs only in the Map-insertion-order catch-all loop after the main topo walk. If a downstream DB was inserted before the head, the DB processed 0 RPS that tick and the route's output deferred to the next tick. Persistent one-tick lag and order-dependent metrics. [P1 stale-chain] both `computeDbArrivalFactor` and `processDatabase`'s scan path used `route.componentChain.includes(dbId)` as the "does this route touch the DB" check, without validating the chain against the live graph. A route whose chain said `['svc', 'db']` after the svc→db edge was removed still projected its entry share onto whatever traffic the DB was currently receiving (via other paths) — poisoning `dbArrivalFactor` and firing phantom saturation / unindexed-scan diagnostics for a path that no longer exists.
- **Decision:** (1) Topological roots = `entryPoints ∪ { route.componentChain[0] : route ∈ endpointRoutes }`. Routed chain heads participate in the topo walk, not in the catch-all. (2) New private helper `routeReachesDbInLiveGraph(route, dbId)` walks the chain's prefix up to and including the DB and verifies each consecutive pair is still an edge in `this.adjacency` (cheap: a handful of Map lookups per route, only runs inside the DB processor's attribution loop). Replaced every `componentChain.includes(dbId)` call site with the live-graph check.
- **Why:** The handoff invariant "don't silently misroute; warn and degrade" (rule #2) generalizes: stale user data should be detected, not blindly trusted. Round-3 also closes the last remaining gap in the §52 fan-in invariant — a routed-but-not-entry head that runs order-dependently is functionally a silent correctness regression on whatever topology the user happens to author next. Both fixes are bounded — topo-root expansion is one `Set` union per tick; `routeReachesDbInLiveGraph` is linear in chain length and only runs for DB components.
- **Rejected:** Rebuilding routes from graph state at tick start (too expensive — BFS per route per tick). Adding a "route health" preflight check (useful but orthogonal — runtime should not silently misroute even if preflight missed a stale route). Firing a one-shot `route-stale:<endpointId>` callout at attribution time (considered; deferred — the seed-time `routing-stale` callout already covers the head-invalid case, and a mid-chain-broken route silently drops from DB attribution without user confusion on the DB itself; revisit if user research shows confusion).
- **Source:** [src/engine/SimulationEngine.ts](src/engine/SimulationEngine.ts) `tick()` topoRoots set (replaces `this.entryPoints` as the third arg to `topologicalOrder`), `routeReachesDbInLiveGraph` (new), `computeDbArrivalFactor` + `computeDbReadWriteBreakdown` + scan path (all three now call the live-graph check). New tests in [engineReadWriteSplit.test.ts](src/engine/__tests__/engineReadWriteSplit.test.ts): `a stale route chain (svc→db edge removed) does NOT project attribution onto the live DB`, `route heads that are not graph entry points still process in topological order`. Full suite 412/412 + Playwright 2/2.

### 63. SIMFID Phase 4 codex round 4 — cap `dbArrivalFactor` at 1; `useSimulation` stops projecting first-entity shardKey as global

- **When:** 2026-04-24 (fourth `codex review --base main` pass after §62).
- **Context:** Round 4 surfaced two remaining correctness gaps. [P1] `computeDbArrivalFactor = totalInboundRps / entryShareToDb` could scale routes' DB share UP when default-bucket (unmatched `requestMix`) traffic also reached the DB. A DB with 10% routed write traffic + 90% default-bucket traffic would be scaled to 100% writes — breakers, backpressure, and the unindexed-scan multiplier all materially wrong for mixed workloads. §61 had documented this as a "known approximation"; codex rejected that as not acceptable given it's the common case when authored requestMix is incomplete. [P2] `useSimulation.ts` pre-derived `schemaShardKey` / `schemaShardKeyCardinality` from the first entity in `schemaMemory` with a `partitionKey` and passed them as constructor globals alongside the `routingContext`. `resolveShardKeyForDb` falls back to those globals when a DB has no assigned entity — so an unrelated DB inherited a foreign partition key (the exact cross-DB bleed §56 was meant to eliminate).
- **Decision:** (1) Cap `dbArrivalFactor` at 1 via `Math.min(1, totalInboundRps / entryShareToDb)`. Routes' DB share can only scale DOWN from seeded (modeling upstream filter effects like cache hits) — never UP. Any `totalInboundRps` exceeding the routed entry-share falls into the remainder bucket and is distributed via the 70/30 default. (2) `useSimulation` now always passes `undefined` for `schemaShardKey` / `schemaShardKeyCardinality` when it has a `schemaMemory` — the engine's per-DB `resolveShardKeyForDb` is the authoritative source. Constructor globals remain as a legacy fallback for callers that construct the engine without a `routingContext` (existing tests).
- **Why:** The cap loses the ability to model fan-out amplification in routed-chain attribution, but Phase 4.7 explicitly positions fan-out as a UI visualization (§58), not an engine-attribution primitive — the trade is acceptable. The shard-key scope fix closes the last window where a sparse schema could produce wrong DB metrics. Both preserve the §52 fan-in invariant that aggregate `errorRate` remains load-bearing; neither breaks an existing test (framework's unit tests construct engines directly, not via useSimulation, and pass either explicit globals or none — both paths still work per the resolver's 4-layer fallback).
- **Rejected:** Tracking per-node provenance through the graph to distinguish fan-out amplification from default-bucket bleed (requires undoing the §52 fan-in refactor — too invasive). Making the cap configurable (YAGNI; no scenario has surfaced a legitimate >1 factor use case that the UI side of Phase 4.7 can't cover). Removing the legacy constructor globals entirely (breaks direct-construction tests and external callers that pass them without `routingContext` — the 4-layer fallback in `resolveShardKeyForDb` keeps them available but scoped to the no-schemaMemory case).
- **Source:** [src/engine/SimulationEngine.ts](src/engine/SimulationEngine.ts) `computeDbArrivalFactor` now clamps. [src/engine/useSimulation.ts](src/engine/useSimulation.ts) `startSimulation` passes `undefined` for globals. New tests: [engineReadWriteSplit.test.ts](src/engine/__tests__/engineReadWriteSplit.test.ts) `dbArrivalFactor caps at 1 so default-bucket traffic is not absorbed into routed attribution`, [engineShardCardinality.test.ts](src/engine/__tests__/engineShardCardinality.test.ts) `useSimulation-style globals alongside schemaMemory leak across DBs — fixed by passing undefined`. Full suite 414/414 + Playwright 2/2.

### 64. SIMFID Phase 4 codex round 5 — whole-chain seed validation + stressed arrival variance pulled from peak phase

- **When:** 2026-04-24 (fifth `codex review --base main` pass after §63).
- **Context:** Round 5 caught two edge-case correctness gaps the prior rounds didn't cover. [P1 seed-chain] `seedInboundTraffic` validated only that `componentChain[0]` existed in the graph, not that the rest of the chain was still a connected path. When a user added an upstream gateway/LB after routes were generated (a realistic mid-edit flow — `setApiContracts` preserves existing routes), the stale chain still injected traffic straight into its old head, bypassing the newly-added upstream. Rate limits, latency, and resilience on the new upstream were skipped entirely. [P2 stressed-Ca²] `getCurrentRps()` already overrode to peak RPS in `stressedMode`, but `getCurrentArrivalVariance()` still looked up the phase at `this.time`. A stressed run whose peak came from a later `instant_spike` phase would simulate early ticks at peak RPS with steady-phase Cₐ²=1, materially underestimating Kingman queueing wait in the mode that's supposed to be worst-case.
- **Decision:** (1) `seedInboundTraffic` now walks consecutive pairs in `componentChain` against the live `adjacency`; any missing node OR missing edge marks the route stale, its share redistributes to valid matched endpoints, and a `routing-stale:<endpointId>` callout fires with the chain JSON in the message. Head-only validation retired. (2) `getCurrentArrivalVariance()` in stressed mode now returns the Cₐ² of the phase whose RPS equals the peak; when multiple phases tie on RPS, the highest-variance shape wins. Normal mode unchanged.
- **Why:** Completeness Principle applied to edit-flow correctness. The old head-only check was "fire-and-forget" validation — the fix gives the user a loud signal when their routes and graph have drifted, and stops the engine from silently simulating a non-existent topology. Stressed-mode consistency is a smaller fix in code but critical for Decisions §57 / §10 ("stressed mode = worst-case run"): Kingman's whole value is capturing burstiness effects, and mismatched Cₐ² vs RPS defeats the purpose.
- **Rejected:** Warning-only stale-chain detection without redistribution (route's share would land nowhere — load leak; the round-1 rationale still applies). Computing a single Cₐ² for the whole stressed run from the max-variance phase even if it wasn't the peak (could be misleading — authors expect stressed-mode to reproduce the peak phase, not a synthetic combination).
- **Source:** [src/engine/SimulationEngine.ts](src/engine/SimulationEngine.ts) `seedInboundTraffic` whole-chain validation loop, `getCurrentArrivalVariance` stressed branch. New tests: [engineRoutingDistribution.test.ts](src/engine/__tests__/engineRoutingDistribution.test.ts) `a broken mid-chain edge is treated as stale`, [engineKingman.test.ts](src/engine/__tests__/engineKingman.test.ts) `stressed mode pulls arrival variance from the peak phase`. Full suite 416/416 + Playwright 2/2.

### 65. SIMFID Phase 4 codex round 6 — ingress-bypass stale-head detection + shard-key fallback refinement + dispatchedAtTickMs propagation through pendingInbound

- **When:** 2026-04-24 (sixth `codex review --base main` pass after §64).
- **Context:** Round 6 found three issues, one per area of Phase 4. [P1 ingress-bypass] round-5's whole-chain check only validated pairs PRESENT in `componentChain` — a single-node chain `['svc']` has no pairs, so the route always passed. If the user later added `lb → svc` in front, seeding still landed at `svc`, bypassing the new ingress. The fix needed a separate "does the head look like an entry point?" check. [P2 shard-key regression] round-4's `undefined`-global fix was too aggressive: it also broke single-DB hot-shard modeling for schemas where entities had `partitionKey` set but `assignedDbId === null` (older saves before the designer's DB-assignment step ran). Without the legacy global fallback, `resolveShardKeyForDb` returned `{null, 'high'}` for every DB and Pareto skew disappeared. [P2 deferred CO timestamp] `WireTickOutcome.dispatchedAtTickMs` was stamped with `this.time * 1000` at emit time, not with the request's ORIGINAL dispatch time. Deferred traffic through `pendingInbound` lost the original timestamp; downstream emits on the next tick reported requests as one tick younger than reality — breaking the "CO-correct within 1-tick granularity" promise in §59 for any consumer reading the field.
- **Decision:** (1) Extend `seedInboundTraffic`'s validity check: if `head` has predecessors in `this.reverseAdj` AND is not in `this.entryPoints` (explicit `isEntry=true` OR zero-indegree), the chain is stale regardless of what pairs it contains. Fires the same `routing-stale:<endpointId>` callout and redistributes. (2) `useSimulation` now inspects whether schemaMemory has any `assignedDbId !== null` entities; if YES, passes `undefined` globals (§63 cross-DB bleed rule); if NO, derives the legacy globals from the first `partitionKey`'d entity so older saves still hot-shard. (3) New `componentEarliestInboundMs` map populated from `pendingInbound` at tick-start tracks the earliest dispatch timestamp for each target receiving deferred traffic. `emitOutbound` now computes `dispatchedAtTickMs = Math.min(this.time * 1000, componentEarliestInboundMs[sourceId] ?? Infinity)` and forwards through the deferred-again path. `pendingInbound` struct gains `earliestDispatchMs: number` (min across concurrent deferrals to the same target).
- **Why:** The ingress-bypass rule generalizes from round 5's in-chain validation to include structural graph facts (head-has-predecessors) that the chain itself wouldn't expose. The shard-key refinement preserves a real useful behavior (single-DB hot-shard modeling) for users mid-migration. The CO propagation honors the §59 docstring claim and sets up future UI (wire-hover tooltip) to read the timestamp without getting a lie on deferred paths. All three are bounded — no algorithmic complexity change, no new tick-time work outside the deferred/cycle path.
- **Rejected:** Firing a louder warning when ingress-bypass is detected (the existing `routing-stale` callout message is sufficient once users see a node they expected to be loaded stay at 0 RPS). Changing the engine to skip the legacy globals entirely and require per-DB assignment (would break session-file loads for every pre-§56 save — too invasive for a correctness-only round). Tracking per-wire dispatch timestamps instead of per-component (would require reshaping `WireTickOutcome` into a list + add book-keeping on every hop — cost-benefit doesn't favor it given current consumer list is only `tickOutcomes()` for future UI).
- **Source:** [src/engine/SimulationEngine.ts](src/engine/SimulationEngine.ts) seed head-predecessor check + `pendingInbound` struct + `componentEarliestInboundMs` + `emitOutbound` timestamp math. [src/engine/useSimulation.ts](src/engine/useSimulation.ts) `startSimulation` unassigned-schema branch. New tests: [engineRoutingDistribution.test.ts](src/engine/__tests__/engineRoutingDistribution.test.ts) `a single-node chain whose head now has upstream predecessors is stale`, [engineShardCardinality.test.ts](src/engine/__tests__/engineShardCardinality.test.ts) `schemaMemory with partitionKey but NO assigned entities still produces hot-shard behavior`, [fanIn.test.ts](src/engine/__tests__/fanIn.test.ts) `dispatchedAtTickMs on deferred back-edge paths preserves the original dispatch time`. Full suite 419/419 + Playwright 2/2.

### 46. Pulse-clear timer is ref-tracked so rapid clicks don't kill newer pulses

- **When:** Phase C2 (2026-04-18)
- **Context:** Clicking a log row with a componentId sets `pulseTarget = node:ID` for 600ms then clears. Naive implementation: one `setTimeout` per click → two rapid clicks leave two pending timers, the first fires mid-second-pulse and clears it early.
- **Decision:** Keep a `pulseTimerRef: useRef<Timeout | null>`. Each click cancels the previous timer via `clearTimeout` before installing a new one. Unmount cleanup clears any in-flight timer.
- **Why:** Rapid clicks are realistic (users scan the log). Race-safe timer management is cheap to implement and avoids visual jank.
- **Rejected:** No timer tracking (races). Storing timer in state (forces rerender on every click).
- **Source:** [src/components/panels/BottomPanel.tsx](src/components/panels/BottomPanel.tsx) `LogContent` `pulseTimerRef`.
