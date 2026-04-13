# SystemSim User Manual

## Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Set environment variables
# Create .env.local with:
ANTHROPIC_API_KEY=sk-ant-...          # Required for AI features
VITE_ENABLE_TEXT_TO_DIAGRAM=true      # Enable text-to-diagram (set to 'true')

# 3. Start the dev server
pnpm dev
# Opens at http://localhost:5180
```

## Landing Page

When you open the app, you'll see four entry points stacked vertically:

1. **Text-to-Diagram input** (top, if feature flag is on)
2. **Template grid** (5 cards)
3. **Guided Scenario card** (Discord notification fanout)
4. **Tertiary links** (blank canvas, load session)

---

## Flow 1: Start from a Template

1. On the landing page, scroll to "Or start from a template"
2. Click any template card (e.g., "Basic CRUD App")
3. The canvas opens with the diagram already laid out (Dagre auto-layout, left-to-right)
4. You should see nodes connected by wires

**What to verify:**
- Nodes appear with labels (e.g., "Load Balancer", "App Server", "Database")
- Wires (edges) connect the nodes
- The layout flows left-to-right, no overlapping nodes
- Clicking a node opens the config panel on the right

## Flow 2: Text-to-Diagram Generation

> Requires `VITE_ENABLE_TEXT_TO_DIAGRAM=true` and a valid `ANTHROPIC_API_KEY`

1. On the landing page, find the "Describe your system" text input
2. Type a system description, e.g.:
   ```
   A social media feed with a load balancer, three API servers,
   a Redis cache for hot posts, a fanout service for feed
   generation, and a sharded Postgres database
   ```
3. Click **Generate**
4. Watch the progress messages rotate: "Reading your description..." etc.
5. After 3-8 seconds, the canvas populates with an AI-generated diagram

**What to verify:**
- Progress text rotates while waiting
- Canvas shows nodes matching your description (types mapped: "Redis" becomes a cache node, etc.)
- Nodes are auto-laid-out with Dagre
- The privacy warning is visible below the text input

**Error cases to try:**
- Type fewer than 10 characters, click Generate: button should be disabled (grayed out)
- Type a very long description (>10,000 chars): amber warning appears
- Click Generate, then immediately click **Cancel**: should stay on landing page, no canvas flash
- If you get a "Generation failed" error: a "Try a template instead" link appears below

## Flow 3: Remix an Existing Diagram

> Requires the Anthropic API

1. Get a diagram on the canvas (via template or text-to-diagram)
2. In the top toolbar, click the **Remix** button (blue outline, right side)
3. A confirmation modal appears: "Replace current canvas?"
4. Click **Replace**
5. An inline input appears below the toolbar
6. Type a modification, e.g.: `Add a message queue between the API and database`
7. Click **Apply**
8. The canvas updates with the remixed diagram
9. A toast appears at the bottom: "Remixed. Cmd+Z to restore."

**What to verify:**
- Confirmation modal appears before remix (not skipped)
- Pressing Escape or clicking Cancel dismisses the modal
- The remix input accepts instructions and shows a spinner while processing
- After remix, node count may change (new components added)
- Press **Cmd+Z** (or Ctrl+Z): the previous diagram is fully restored

**Edge cases:**
- Remix button is disabled (grayed) during simulation
- Clicking Cancel in the remix input closes it without changes

## Flow 4: Run a Simulation

1. Get a diagram on the canvas
2. Click **Run** in the top toolbar (blue button)
3. Watch the simulation:
   - Timer counts up
   - Progress bar fills
   - Particles flow along wires (particle view) or metrics update (aggregate view)
   - Live log shows events at the bottom
   - Node health changes color (green/yellow/red)
4. Speed controls: click 1x, 2x, 5x, 10x to change simulation speed
5. Toggle between "Particle" and "Aggregate" view
6. When complete, click **Debrief**

**What to verify:**
- Particles animate along wires
- Nodes change health states under load
- Live log shows warnings and critical events
- Debrief panel opens with scores (Pass/Warn/Fail) and Socratic questions

## Flow 5: AI Debrief

1. After simulation completes, click **Debrief**
2. The debrief panel opens showing:
   - Scores: Coherence, Security, Performance (Pass/Warn/Fail)
   - Socratic questions from the rule-based engine
   - AI questions (if Anthropic API is available)
   - Pattern flags (detected issues)
3. Click **Download Report** to get an HTML report
4. Open the downloaded HTML file in any browser

**What to verify:**
- Scores show colored labels (green=Pass, amber=Warn, red=Fail)
- Questions are specific to your simulation results
- HTML report opens in browser with all sections
- Report includes architecture description, stats, timeline, bottleneck chain

## Flow 6: Save and Load Sessions

### Save
1. With a diagram on canvas, click **Save** in the toolbar
2. A JSON file downloads (e.g., `systemsim-freeform-1744411234567.json`)

### Load
1. On the landing page, click "Load session from file"
2. Pick the saved JSON file
3. Canvas opens with the restored diagram

**What to verify (CRITICAL):**
- All nodes are present after loading
- All wires (edges) are present after loading (this was previously broken, now fixed)
- Node positions are preserved
- Node configs are preserved (click a node, check config panel values)
- Save again after loading, compare file sizes: should be similar

## Flow 7: Guided Scenario (Discord)

1. On the landing page, click the "Guided Scenario" card
2. The Design Flow opens: requirements, NFRs, schema design
3. Complete the design flow (or skip ahead)
4. Canvas opens with components to place
5. Wire them up, then run the simulation

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Cmd+Z / Ctrl+Z | Undo |
| Cmd+Shift+Z / Ctrl+Shift+Z | Redo |
| V | Toggle particle/aggregate view |
| Delete / Backspace | Remove selected node |
| L | Add load balancer |
| S | Add server |
| D | Add database |
| H | Add cache |
| Q | Add queue |
| F | Add fanout |

## Running Tests

```bash
# Unit tests (114 tests)
pnpm test

# E2E tests (7 tests, needs Chromium installed)
pnpm test:e2e

# Install Playwright browsers (first time only)
npx playwright install chromium
```

## Feature Flags

| Flag | Default | Effect |
|------|---------|--------|
| `VITE_ENABLE_TEXT_TO_DIAGRAM` | `false` | Shows text input on landing page. Set to `'true'` in .env.local |

## Component Types (6 MVP types)

| Type | Shortcut | Description |
|------|----------|-------------|
| Load Balancer | L | Distributes traffic across instances |
| Server | S | Processes requests with CPU/memory |
| Database | D | Persistent storage with sharding |
| Cache | H | In-memory caching (Redis-like) |
| Queue | Q | Async message processing |
| Fanout | F | Multiplies messages to N downstream |
