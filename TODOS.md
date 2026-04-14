# TODOs

## Active plans (reference)

Two distinct plans are in flight. Do NOT conflate them.

| Tag | Plan | File | Target |
|---|---|---|---|
| `[V2I]` | **Vision-to-Intent** — Miro/Figma/Excalidraw → intent + system spec → canvas | `~/.gstack/projects/T-98-systemsim/ceo-plans/2026-04-13-vision-to-intent.md` | Translator shipped 2026-04-13 night; follow-up PR 2026-04-14 |
| `[SIMFID]` | **Simulation Fidelity** — IDE for system design, compiler errors, real Postgres/Redis, toxiproxy | `~/.gstack/projects/T-98-systemsim/ceo-plans/2026-04-13-simulation-fidelity.md` | EOW+ (probably 2026-04-17 or later) |

TODOs below are for the V2I plan only. The SIMFID plan tracks its own 8-phase implementation
inside its own plan file — do not duplicate items here.

---

## [V2I-FOLLOWUP] Followup PR — shipped 2026-04-14

The followup PR landed the features below on top of the translator:

- [x] **Persistent intent header on canvas** — editable, click-to-edit, survives `replaceGraph`, persists to SessionFile, cleared on template load
- [x] **Per-item confidence reveal panel** — collapsible "What did we see?" with low/med/high per-item
- [x] **Drag-and-drop image support** — drop zone with live overlay, accepts PNG/JPEG/WebP
- [x] **Re-derive from intent** — button on review screen re-calls describe-intent with edited intent text; refreshes components + connections
- [x] **Full E2E matrix** — 9 new specs in `e2e/vision-to-intent-followup.spec.ts`

### [V2I-FOLLOWUP] /design-review on live review mode screen
**What:** Run /design-review on the rendered review mode within 24h of shipping.
**Why:** Review mode is the bankrupt-and-fired risk surface. Post-ship rendered audit catches visual issues the CEO review spec couldn't.
**Effort:** S
**Priority:** P1
**Depends on:** V2I translator shipped.

### [V2I-FOLLOWUP] /devex-review boomerang (TTHW measurement)
**What:** Run `/devex-review` on the live vision-to-intent flow after 2 weeks of customer use. Measures real TTHW vs planned 90s, error rates, abandonment points.
**Why:** Closes the loop. Plan said 90s — did reality match? Surfaces friction points the plan missed.
**Effort:** S (~30 min)
**Priority:** P2
**Depends on:** V2I translator shipped + 2 weeks of customer use.

### [V2I-FOLLOWUP] Formalize DESIGN.md via /design-consultation
**What:** Run `/design-consultation` to extract the implicit design system from `src/index.css` into a documented DESIGN.md (tokens, typography, spacing scale, voice/tone rules, component conventions).
**Why:** Future design reviews and PRs need a stated source of truth. The codebase IS the system today, but a formal doc unblocks onboarding, enables /design-review to score against named principles, and prevents drift.
**Effort:** S (~30 min)
**Priority:** P2
**Depends on:** V2I translator shipped (so the new components are part of the system being documented).

### [V2I-FOLLOWUP] Prompt eval suite for describe-intent
**What:** Curated inputs (5 prose, 5 images across Miro/Figma/Excalidraw) + expected output shape + quality scoring rubric. Run on every prompt change.
**Why:** Catches prompt drift. Without it, we'll regress silently when we tweak the system prompt.
**Effort:** M (~1 hr curation + ~30 min scaffolding with CC)
**Priority:** P1
**Depends on:** V2I translator shipped.

### [V2I-FOLLOWUP] Full E2E matrix
**What:** Playwright coverage for all input modes (text, image, paste, drag-drop) × review actions (edit intent, edit spec, regenerate, back, generate).
**Why:** Tonight's ship has 2 happy-path E2E only. Full matrix catches regressions during follow-up work.
**Effort:** S (~30 min with CC)
**Priority:** P2
**Depends on:** V2I translator shipped + V2I-FOLLOWUP features landed (so the matrix is stable).

---

## [V2I-PHASE-2] After the follow-up PR (likely 2026-04-15+)

Larger features building on the V2I foundation.

### [V2I-PHASE-2] Multi-image Miro stitching
**What:** Accept 2+ images in the unified input, either stitching client-side (Canvas API) or passing multiple images to Claude vision in one tool_use call (supports up to 20).
**Why:** Miro boards often span multiple screens; customers will hit this limit.
**Context:** Ship single-image MVP first. If 2 customers ask for multi-image within 2 weeks, build this.
**Effort:** M (human) / S (CC)
**Priority:** P2
**Depends on:** V2I translator + FOLLOWUP shipped.

### [V2I-PHASE-2] Coherence score badge + bidirectional sync
**What:** Canvas shows a live "Vision ↔ Design: X%" badge. Intent edits reflow the graph. Canvas edits update the intent header.
**Why:** The 12-month moat. Nobody else does this. Makes coherence between vision and technical design an always-on gate.
**Pros:** Durable differentiation from Miro AI / Figma / Excalidraw AI tools.
**Cons:** Expensive (LLM-in-loop or embeddings on every graph mutation); own architecture plan needed.
**Context:** Deserves its own CEO plan + engineering plan. Requires production data from V2I Phase 1 to tune the similarity threshold.
**Effort:** XL (human) / L (CC)
**Priority:** P1 (post-V2I-FOLLOWUP)
**Depends on:** V2I translator + FOLLOWUP shipped; 2-4 weeks of user data.

### [V2I-PHASE-2] Intent version history
**What:** Every intent edit creates a snapshot. Debrief surfaces "Design diverged from intent at step 4 when you added Redis."
**Why:** Closes the loop between vision and debrief. Makes drift historically inspectable.
**Effort:** M
**Priority:** P2
**Depends on:** V2I translator + FOLLOWUP shipped; debrief integration.

### [V2I-PHASE-2] Simulation engine uses intent
**What:** Pass intent into the debrief prompt so AI questions reference the user's original vision.
**Why:** Closes the full loop: vision → design → simulation → debrief speaks back in vision-level language.
**Note:** This is V2I scope, NOT part of the SIMFID plan. SIMFID changes the engine math; this changes the debrief prompt.
**Effort:** S
**Priority:** P2
**Depends on:** V2I translator + FOLLOWUP shipped.

### [V2I-PHASE-2] Mobile responsive review mode
**What:** Make UnifiedInput, ReviewMode, and IntentHeader work on mobile viewport widths (< 768px).
**Why:** Founders occasionally demo on phones; YC Slack links open on mobile.
**Context:** Desktop-only for MVP. Add only if a customer asks.
**Effort:** M
**Priority:** P3
**Depends on:** V2I translator + FOLLOWUP shipped.

### [V2I-PHASE-2] Example image tiles on landing
**What:** 3-4 sample Miro/Figma/Excalidraw images pre-bundled as clickable tiles under the UnifiedInput.
**Why:** Zero-friction demo for new users without their own images.
**Effort:** XS
**Priority:** P3
**Depends on:** None.

### [V2I-PHASE-2] Image annotation mode
**What:** Let user draw arrows or highlight on the uploaded image before submitting, to clarify ambiguous parts.
**Why:** Handwritten Excalidraw especially benefits from user clarification.
**Effort:** L
**Priority:** P3
**Depends on:** V2I translator + FOLLOWUP shipped; feedback on per-item confidence usage.

---

## [SIMFID] Simulation Fidelity plan

This plan is tracked separately in `~/.gstack/projects/T-98-systemsim/ceo-plans/2026-04-13-simulation-fidelity.md`.
Do NOT duplicate SIMFID work items here. That plan has its own 8-phase implementation schedule and its own review chain.

Start date: likely 2026-04-17 or later (EOW+), after V2I translator + FOLLOWUP ship.
