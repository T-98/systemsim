# Codex Reviews — Desktop-Agent Workflow

A simple file-handoff system for routing work to **OpenAI Codex (desktop agent)** for review, instead of the `codex` CLI which keeps timing out on this codebase's pre-existing TS errors.

**Why this exists.** The Codex CLI (v0.120.0) has known stdin deadlock bugs and tends to burn its output budget on `tsc` / `npm run build` runs before producing a verdict. The desktop agent doesn't have those constraints. This folder structure lets Claude prep a focused review request, the user runs it through Codex desktop on their own time, Codex writes the verdict back, and Claude reads it.

---

## Folder structure

Each review gets its own folder. **Folder names match the artifact being reviewed** so the trail is greppable.

```
docs/codex-reviews/
├── README.md                                     ← this file
├── _TEMPLATE.md                                  ← reusable request template
├── 2026-04-27-phase4-final-convergence/
│   ├── REQUEST.md                                ← what Claude writes for Codex
│   └── OUTPUT.md                                 ← what Codex writes back
├── 2026-04-22-simfid-phases-4-8-revised/         ← review keyed to a plan slug
│   ├── REQUEST.md
│   └── OUTPUT.md
└── …
```

### Naming convention

```
YYYY-MM-DD-<slug>/
```

- `YYYY-MM-DD` = the date the review is REQUESTED.
- `<slug>` = the artifact slug, matching:
  - A plan file name when reviewing a plan (`2026-04-22-simfid-phases-4-8-revised`).
  - A commit-batch slug when reviewing code (`phase4-final-convergence`, `commits-c667e73-to-3f57b2a`, etc.).
  - A descriptive slug when neither maps cleanly.

Inside each folder:
- `REQUEST.md` — Claude writes this. Codex reads it.
- `OUTPUT.md` — Codex writes this. Claude reads it on user signal.

---

## Protocol

### Claude side (writing the request)

1. Create the folder with the right naming convention.
2. Copy `_TEMPLATE.md` to `REQUEST.md` and fill in:
   - **Artifacts**: paths to plans + commit SHAs + file ranges to review.
   - **Specific questions**: bug-focused, numbered, with risk hypotheses.
   - **Expected output format**: BLOCKER / NIT / DEFENSIBLE / OK markers + final CONSENSUS line.
   - **Out of scope**: things Codex should NOT review (pre-existing tsc errors, unrelated tech debt, etc.).
3. Create an empty `OUTPUT.md` with a `<!-- Codex: write your review here -->` placeholder.
4. Tell the user the request is ready and where the OUTPUT.md will land.
5. Wait for user signal that Codex is done.

### User side

1. Open `REQUEST.md` in Codex desktop.
2. Tell Codex to write its verdict to the sibling `OUTPUT.md`.
3. When done, tell Claude something like *"codex review done"* or *"the codex review for <slug> is back"*.

### Claude side (reading the output)

1. Read `OUTPUT.md`.
2. Surface findings in a `CODEX SAYS` block to the user.
3. Triage: real BLOCKERs become new commits (and a new review round under a new dated folder); DEFENSIBLE / OK items get noted and skipped.
4. Update the relevant plan file's progress log so the review trail is preserved across sessions.

---

## What goes in REQUEST.md

The template covers it, but the high-leverage fields are:

- **Branch + base**: which branch and which base (almost always `main`).
- **Commit list**: explicit SHAs in chronological order. Don't say "everything new" — name each one.
- **File ranges**: when reviewing a specific bug-fix area, point at the line numbers, not just the file.
- **Out of scope**: pre-existing TS errors, unrelated lint debt, anything Codex would otherwise rabbit-hole into.
- **Specific questions**: bug-focused, with a hypothesis Codex can either confirm or reject. Vague "review this code" prompts produce vague reviews.
- **Output format spec**: explicit markers (BLOCKER / NIT / DEFENSIBLE / OK) so Claude can parse the response cleanly.

---

## What does NOT go in here

- One-off code-review questions that don't need an outside voice (use `/review` or just-Claude).
- Architectural research / brainstorming (use the `docs/research/` or `docs/plans/` flow).
- Plans that haven't been written yet (write the plan first; review it second).

---

## Index

Update this list when a new review folder is added. Reverse-chronological.

| Date | Slug | Status | Findings |
|---|---|---|---|
| 2026-04-27 | [`phase4-final-convergence`](2026-04-27-phase4-final-convergence/REQUEST.md) | awaiting Codex | TBD |
