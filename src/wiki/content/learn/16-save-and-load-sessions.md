# Save & load sessions

A session is everything the canvas needs to be reconstituted — nodes, wires, configs, traffic profile, intent text, scenario id if any.

## Save

Toolbar → **Save** button. Writes a JSON file (`systemsim-session-YYYYMMDD.json`) to your downloads. Portable: works across branches, different browsers, different SystemSim versions within the same major (schema migrations are automatic on load).

Use save when:
- You're going to close the tab and want to come back.
- You want to share the design with someone — DM them the JSON.
- You're about to try a risky change (adding 6 sharded DBs, ripping out the LB) and want an undo.

## Load

Landing page → *"Load session from file"* (tertiary link near the bottom). Pick the JSON. Drops you on the canvas with the graph restored.

## What's NOT in the save

- **Live metrics** — those are per-run; don't persist.
- **Debrief text** — each run generates fresh AI debrief.
- **Log history** — cleared between runs.

This is deliberate. The save file is your *design*; runs are what you do *with* the design.

## File format

Schema version is stamped at the top. Migration code in `src/migrate/` handles forward-compatibility when we change the shape. If you load a very old file that can't be migrated, you get a clear error (not silent data loss).

Next: [Remix — destructive regenerate](#docs/learn/remix).
