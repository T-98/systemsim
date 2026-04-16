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
