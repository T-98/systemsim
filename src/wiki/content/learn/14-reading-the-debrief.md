# Reading the debrief

After the sim completes, the bottom panel auto-switches to the Debrief tab. This is where the numbers become a story.

## What's in the debrief

- **Overall scores** — Scalability / Reliability / Performance, each on a 0–10 scale. These are computed from real metrics against real thresholds. See [§20 How to Scale a System](#docs/reference/20-how-to-scale-a-system) for the framing these scores draw from.
- **Per-component peak table** — for each node, its peak RPS, peak p99, peak CPU / memory / cache-hit rate / connection utilization, and whether it crashed. The table tells you where the sim hurt most.
- **Stressed badge** — appears if you ran with Run Stressed (worst-case mode). The scores apply under that condition.
- **AI debrief text** — 3–5 paragraphs from Claude reading your graph + the peak metrics + detected anti-patterns. Not a report card; more like a senior engineer looking over your shoulder.
- **AI questions** — 2–3 follow-ups. "What happens when the cache goes cold?" or "How does the DB behave if shard-2 doubles?". Not rhetorical — they're entry points for the next iteration.

## How to read the scores

- **10/10** means *on the specific profile you ran, nothing broke and saturation never climbed past ~70%*. It does not mean "your design is perfect." Different profile → different score.
- **6–9** means the design held but had pressure points. The per-component peak table tells you where. Pick one thing, tune it, re-run.
- **< 6** means something bad happened — crashes, sustained saturation, cascading failures. The AI paragraphs will name it.

## Download the debrief as HTML

There's a download button (top-right of the Debrief tab) that emits a self-contained HTML file — peak table, scores, AI narrative, your intent. Good for sharing a review before a real architecture meeting.

Next: [Run Stressed](#docs/learn/run-stressed).
