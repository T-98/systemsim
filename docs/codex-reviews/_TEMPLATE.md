# Codex review request — `<slug>`

**Requested by:** Claude
**Requested at:** YYYY-MM-DD HH:MM
**Branch:** `<branch-name>`
**Base:** `main`
**Codex output goes in:** `OUTPUT.md` (sibling of this file)

---

## What to review

### Artifacts

- **Plan(s):**
  - [`docs/plans/<plan-file>.md`](../../plans/<plan-file>.md) — what's being implemented + the original codex critique it addressed
- **Handoff doc(s):**
  - [`docs/plans/<handoff-file>.md`](../../plans/<handoff-file>.md) — context for the work (if applicable)
- **Decisions:**
  - [`Decisions.md`](../../../Decisions.md) §X, §Y — the in-doc rationale
- **Research grounding (if relevant):**
  - [`docs/research/<research-file>.md`](../../research/<research-file>.md)

### Commits to review (chronological)

```
<sha1>  <one-line summary>
<sha2>  <one-line summary>
...
```

Pull each diff with:
```sh
git show <sha>
```

### File ranges (for narrow reviews)

If the review focuses on specific bug-fix areas, name the lines:

- `src/engine/SimulationEngine.ts:1003-1011` — `emitOutbound` non-deferred branch
- `src/engine/__tests__/fanIn.test.ts:150-180` — multi-hop CO regression test
- …

---

## Context — what each commit is supposed to do

Brief paraphrase of the intent + risk areas, one bullet per commit. Skip the "why this is awesome" framing; focus on what could be subtly wrong.

- `<sha1>`: <intent + the specific risk you want Codex to verify>
- `<sha2>`: <intent + risk>
- …

---

## Specific questions (bug-focused, numbered)

For each commit / area, list 2–4 questions Codex should answer. Each should have a hypothesis Codex can confirm or reject — vague "is this right?" produces vague reviews.

### `<sha1>` — questions

1. <Specific risk hypothesis with file:line ref>
2. <Edge case to verify>
3. <Performance concern, if any>

### `<sha2>` — questions

1. …

---

## Out of scope (don't burn budget on these)

- **Pre-existing TS errors.** The branch carries ~50 ReactFlow `Node<SimComponentData>` constraint errors that predate Phase 4. They're in `src/components/canvas/Canvas.tsx`, every `engine/__tests__/*.ts`, `src/store/index.ts`, etc. Documented as out-of-scope — DO NOT run `npm run build`, `tsc`, `pnpm build`. Use `pnpm vitest run` for the canonical sanity check (currently passes 420/420).
- **Lint debt** unrelated to the commits under review.
- **Architectural critique** beyond the specific risk areas listed. If you spot a deeper problem, NOTE it but don't redesign.

---

## Expected output format (write this in `OUTPUT.md`)

```markdown
# Codex review output — `<slug>`

**Reviewed at:** YYYY-MM-DD HH:MM
**Codex session:** <id if available>

## Findings

### `<sha1>` — `<commit summary>`

- **<BLOCKER | NIT | DEFENSIBLE | OK>**: <one-paragraph finding> — `<file>:<line>`
- **<…>**: <…>

### `<sha2>` — `<commit summary>`

- **<…>**: <…>

## Cross-commit composition

<Any concerns about how the commits interact, or "no cross-commit issues found".>

## Out-of-scope concerns (noted but not flagged)

<Things you spotted that are real but outside the requested scope. Optional.>

## CONSENSUS

`CONSENSUS: <one of:>`

- `convergence — no findings, ready to ship`
- `<N> findings remain — <one-line summary>`
- `architectural concern, see above — needs human triage`
```

---

## Trigger

User will tell Claude when this review is done. Until then, Claude waits and works on other things.
