# Reading the live log

The bottom panel's Live Log tab streams engine events as the sim runs. The three pieces to know about: severity, filters, and callouts.

## Severity

- **info** — benign observations ("sim started", "phase changed at t=30s").
- **warning** — saturation, retries kicking in, queue filling, cache misses rising. Yellow.
- **critical** — crashed components, 100% error rate, all downstreams unhealthy. Red.

The `(i)` next to each severity badge links to the Reference entry for that severity.

## Filter chips

- Top row has severity chips (info / warning / critical). Click to multi-select; empty = show all.
- Component dropdown narrows to events from one node. Useful when chasing one component's story.
- "N / M events" counter reflects shown / total.
- **Reset** clears both dimensions.

## Callout phrases

When the engine fires a known callout ("Circuit breaker opened on wire A→B", "server-1 hit ρ=0.92"), the key phrase gets underlined and gets its own `(i)`. Click it → mini-popover with a short description + "Learn more" → jumps to the Reference entry for that concept.

## Grouping

Rapid bursts (≥5 events from the same component with the same severity inside a 2-second window) collapse into one row: "6× server-1 warnings" with a chevron. Click the chevron to expand. The underlying log is untouched — grouping is visual only.

## Click-to-pulse

Click any row with a `componentId`: the app selects that node and pulses it on the canvas for 600ms. Fastest way to jump to "what was the engine talking about?"

Next: [Reading the debrief](#docs/learn/reading-the-debrief).
