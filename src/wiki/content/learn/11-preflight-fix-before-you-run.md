# Preflight — fix before you run

Before you hit Run, SystemSim sanity-checks the graph and surfaces any issues as a preflight list. Red items block the run; yellow items warn but let you proceed.

## What preflight catches

- **No entry point.** Every graph needs at least one component marked as receiving external traffic. Without it, the sim has nothing to inject.
- **Orphan components.** Nodes with no wires in or out. They can't do anything.
- **Schema-to-DB mismatches.** A declared table not assigned to any database node, or a DB with no tables assigned.
- **Endpoints without a path to their owner service.** An API contract declared on a service with no reachable route.
- **SPOF hints.** Server with `instanceCount=1` behind no load balancer (not blocking, just a warning).
- **Write-heavy path with no queue** (warning) — if you're bursty, you probably want async buffering.

## Click-to-fix

Each item is a button. Click it and the app:
1. Switches to the right panel / sidebar tab.
2. Focuses the relevant component or field.
3. Pulses the target so you can't miss it.

## Bypassing preflight

You can't skip it from the UI — the Run button is disabled while blockers exist. Playwright tests bypass it via `window.__SYSTEMSIM_STORE__`, not a user-facing switch. The thinking: running a broken graph teaches you nothing; the 30 seconds spent fixing preflight pay for themselves in debrief clarity.

Next: [Running a simulation](#docs/learn/running-a-simulation).
