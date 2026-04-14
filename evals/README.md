# SystemSim Prompt Evals

Offline quality checks for the Anthropic prompts.

## Why

Prompt changes are silent regressions waiting to happen. Bump a sentence, ship, wake up to customers wondering why their diagrams came back half-right. Evals catch drift before it reaches the user.

## What's here

- `describe-intent/` — evals for the vision → structured-output prompt
  - `fixtures/` — paired input files: `*.input.json` or `*.input.png` + `*.expected.json`
  - `describeIntent.eval.ts` — the runner (`pnpm eval:describe-intent`)

## Running

Requires `ANTHROPIC_API_KEY` in the environment (same key the Vercel function uses).

```bash
ANTHROPIC_API_KEY=sk-ant-... pnpm eval:describe-intent
```

The runner:
1. Finds every `*.input.*` fixture under `describe-intent/fixtures/`
2. Calls `/api/describe-intent` locally for each (expects `pnpm dev` running, or bypass via direct SDK call — see `RUN_MODE` env var)
3. Scores each response against the matching `*.expected.json`
4. Prints a summary table + saves the raw outputs to `.evals-output/`

## Scoring

Each eval case has a deterministic scorer:

| Dimension | Pass criteria |
|---|---|
| `components_count` | Returned count within ±1 of expected |
| `component_types` | All expected types present (subset match) |
| `component_labels` | Each expected label appears (case/whitespace-insensitive) |
| `connections_count` | Returned count within ±2 of expected |
| `connection_pairs` | Each expected `source→target` edge present |
| `intent_voice` | Intent starts with first-person plural ("We ") |
| `intent_no_marketing` | Intent doesn't contain banned marketing phrases |
| `confidence_shape` | Response has intent + items[] with valid levels |

A case passes if ≥ 6/8 dimensions pass. Below that → regression flag.

## Adding a case

1. Drop `my-case.input.json` (text-only) or `my-case.input.png` + `my-case.input.txt` (image with optional text) into `describe-intent/fixtures/`
2. Drop `my-case.expected.json` with the shape:
   ```json
   {
     "components": [
       { "label": "Load Balancer", "type": "load_balancer" },
       { "label": "API Server", "type": "server" }
     ],
     "connections": [
       { "source": "Load Balancer", "target": "API Server" }
     ],
     "notes": "Optional reasoning for the eval author"
   }
   ```
3. Run the suite. Green means the current prompt holds against this case.

## Current status

**Infrastructure: ready. Fixtures: curation in progress.** Drop real customer diagrams (Miro screenshots that previously failed, prose descriptions from interview sessions) under `fixtures/` with their expected structure. Each fixture is worth more than 10 synthetic ones because it reflects real user input.

Priority cases to add (P1):
- The Nisa video pipeline Miro screenshot that exposed the original arrow-direction bug (pre-Opus-4.6)
- A founder-written text-only description of a meme/voting app
- An Excalidraw hand-drawn sketch (harder — tests Opus vision on informal inputs)
- A Figma-exported technical diagram
- A deliberately-ambiguous diagram (crossing arrows, unlabeled shapes) to verify low-confidence path
