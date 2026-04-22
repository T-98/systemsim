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

### 46. Pulse-clear timer is ref-tracked so rapid clicks don't kill newer pulses

- **When:** Phase C2 (2026-04-18)
- **Context:** Clicking a log row with a componentId sets `pulseTarget = node:ID` for 600ms then clears. Naive implementation: one `setTimeout` per click → two rapid clicks leave two pending timers, the first fires mid-second-pulse and clears it early.
- **Decision:** Keep a `pulseTimerRef: useRef<Timeout | null>`. Each click cancels the previous timer via `clearTimeout` before installing a new one. Unmount cleanup clears any in-flight timer.
- **Why:** Rapid clicks are realistic (users scan the log). Race-safe timer management is cheap to implement and avoids visual jank.
- **Rejected:** No timer tracking (races). Storing timer in state (forces rerender on every click).
- **Source:** [src/components/panels/BottomPanel.tsx](src/components/panels/BottomPanel.tsx) `LogContent` `pulseTimerRef`.
