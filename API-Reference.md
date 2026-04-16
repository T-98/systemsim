# API Reference

Complete reference for SystemSim's backend (Vercel Edge Functions) and frontend (React components + Zustand store).

**Conventions:**
- All backend endpoints are `POST` unless noted. All accept + return `application/json` unless noted.
- Error responses share a shape: `{ error: true, kind: 'validation' | 'rate_limit' | 'network' | 'api_error', message: string, reason?: string }`.
- All endpoints use the [createAnthropicHandler](api/_shared/handler.ts) wrapper, which centralizes method check, API key validation, payload-size limits, and Anthropic error mapping.
- All frontend components consume state via [useStore](src/store/index.ts). Store shape is documented under [Store](#store).

---

## Table of Contents

- [Backend](#backend)
    - [POST /api/debrief](#post-apidebrief)
    - [POST /api/generate-diagram](#post-apigenerate-diagram)
    - [POST /api/describe-intent](#post-apidescribe-intent)
    - [Shared helpers](#shared-helpers)
- [Frontend](#frontend)
    - [Views](#views)
    - [Canvas & nodes](#canvas--nodes)
    - [Panels](#panels)
    - [Toolbar & inputs](#toolbar--inputs)
    - [UI primitives](#ui-primitives)
- [Store](#store)
- [Simulation engine](#simulation-engine)
- [AI client modules](#ai-client-modules)
- [Types](#types)

---

## Backend

Three Vercel Edge Functions. All sit behind `/api/*` and require `ANTHROPIC_API_KEY` in env. See [DEPLOYMENT.md](DEPLOYMENT.md) or equivalent for deploy mechanics.

### POST /api/debrief

Generates Socratic debrief questions from a compressed simulation summary.

**File:** [api/debrief.ts](api/debrief.ts)

**Request:**

```json
{
  "summary": "string",       // compressed sim state, max 16KB
  "scenarioId": "string?"    // optional, for context
}
```

**Limits:**
- Payload max: `16 * 1024` bytes.
- LLM timeout: 15s (Anthropic call).

**Model:** `claude-sonnet-4-6` (`MODEL_ID` in [api/_shared/constants.ts](api/_shared/constants.ts)).

**System prompt:** "Senior distributed systems engineer conducting a post-mortem review. Ask 3-5 Socratic questions tied to metrics and failures. Never give direct answers. Reference exact numbers (RPS, latency, error rates)."

**Response 200:**

```json
{
  "questions": ["string", "..."],   // 3-5 Socratic questions
  "summary": "string"                // raw LLM text (also includes non-question output)
}
```

**Response 400:** Missing or invalid `summary`.

**Response 413:** Payload exceeds 16KB.

**Response 429 / 500 / 502:** See [HandlerErrorKind](#error-shape).

**Called from:** [src/ai/anthropicDebrief.ts](src/ai/anthropicDebrief.ts) `fetchAIDebrief`.

---

### POST /api/generate-diagram

Text-to-diagram: takes a natural-language system description, returns a canonical graph.

**File:** [api/generate-diagram.ts](api/generate-diagram.ts)

**Request:**

```json
{
  "text": "string",                  // system description, min 10 chars
  "mode": "generate" | "remix",      // default "generate"
  "currentGraph": { "nodes": [...], "edges": [...] }  // required for remix mode
}
```

**Limits:**
- Payload max: `32 * 1024` bytes.
- Min text length: 10 characters.

**Model:** `claude-sonnet-4-6` with tool-use (`generate_system_diagram` tool, schema in [src/ai/diagramSchema.ts](src/ai/diagramSchema.ts)).

**Response 200:**

```json
{
  "graph": {
    "nodes": [{ "type": "server", "label": "API", "position": { "x": 0, "y": 0 }, "config": {} }],
    "edges": [{ "source": "n1", "target": "n2", "config": { "latencyMs": 5, "jitterMs": 1, "throughputRps": 100000 } }]
  },
  "promptVersion": "string"          // prompt template version for debugging
}
```

**Response 400:** Description too short.

**Response 422:** LLM produced output that failed Zod validation. `reason` field gives the validation error.

**Called from:** [src/ai/generateDiagram.ts](src/ai/generateDiagram.ts).

---

### POST /api/describe-intent

Vision-to-intent: takes a system description (text) and/or an image (base64), returns structured intent + system spec.

**File:** [api/describe-intent.ts](api/describe-intent.ts)

**Request:**

```json
{
  "text": "string?",                 // optional, min 10 chars if provided
  "imageBase64": "string?",          // optional, required if no text
  "mimeType": "image/png" | "image/jpeg" | "image/webp"
}
```

At least one of `text` or `imageBase64` must be present.

**Limits:**
- Payload max: `6 * 1024 * 1024` bytes (6MB).
- Image decoded max: `5 * 1024 * 1024` bytes (5MB after base64 decode).
- Min text length: 10 characters.

**Image validation** ([api/_shared/imageValidation.ts](api/_shared/imageValidation.ts)):
- MIME whitelist: `image/png`, `image/jpeg`, `image/webp`.
- Magic-byte check against claimed MIME (prevents MIME-lying).

**Model:** `claude-opus-4-6` (`MODEL_ID_VISION`) with `describe_intent` tool-use (schema in [src/ai/describeIntentSchema.ts](src/ai/describeIntentSchema.ts)).

**Response 200:**

```json
{
  "intent": {
    "goal": "string",
    "scale": "string",
    "constraints": ["string"],
    "risks": ["string"]
  },
  "systemSpec": {
    "components": [{ "type": "server", "label": "string", "role": "string" }],
    "connections": [{ "from": "A", "to": "B", "label": "string" }]
  },
  "confidence": {
    "overall": 0.85,
    "intent": 0.9,
    "components": 0.85,
    "connections": 0.8
  },
  "promptVersion": "string"
}
```

**Response 400:** Missing input, unsupported MIME, malformed image, or text too short.

**Response 413:** Image too large after decode.

**Response 422:** LLM output failed schema validation.

**Response 502:** LLM returned no tool_use block (rare, catastrophic LLM failure).

**Called from:** [src/ai/describeIntent.ts](src/ai/describeIntent.ts).

---

### Shared helpers

#### `createAnthropicHandler(opts)`

**File:** [api/_shared/handler.ts](api/_shared/handler.ts)

Wraps a Vercel Node handler with common plumbing:
- Method check (POST only → 405)
- `ANTHROPIC_API_KEY` env check (→ 500 if missing)
- Content-length guard (→ 413 if exceeds `maxPayloadBytes`)
- Constructs an `Anthropic` SDK client, passes into handler context
- Centralized Anthropic error mapping (rate limit → 429, network → 503, other → 502)

**Signature:**
```ts
createAnthropicHandler({
  endpointName: string,
  maxPayloadBytes: number,
  handler: (ctx: { req, res, anthropic }) => Promise<void>
})
```

**All three endpoints use this.** Adding a new LLM endpoint means copying an existing file and calling `createAnthropicHandler` with the right config.

#### Image validation helpers

**File:** [api/_shared/imageValidation.ts](api/_shared/imageValidation.ts)

- `isAllowedMime(mime: string): mime is AllowedMime`
- `decodeBase64Image(base64: string): Buffer`
- `validateImageMagicBytes(buffer: Buffer, mime: AllowedMime): boolean` — validates buffer starts with the right signature for the claimed MIME. PNG: `89 50 4E 47 0D 0A 1A 0A`; JPEG: `FF D8 FF`; WebP: `52 49 46 46 ... 57 45 42 50`.

### Error shape

All endpoints return errors in this shape:

```json
{
  "error": true,
  "kind": "validation" | "rate_limit" | "network" | "api_error",
  "message": "string",
  "reason": "string?"           // optional schema-validation detail
}
```

`kind` mapping:
- `validation` → 400, 413, 422 (bad input, too big, LLM output malformed)
- `rate_limit` → 429 (Anthropic rate limited us)
- `network` → 503 (network to Anthropic failed)
- `api_error` → 500, 502, 405 (our bug, LLM catastrophic, wrong method)

---

## Frontend

### Views

#### `App`

**File:** [src/App.tsx](src/App.tsx)

Top-level router. Reads `appView` from store, renders one of:
- `'landing'` → `LandingPage` (+ `DesktopOnlyNotice`)
- `'design'` → `DesignFlow` (full-page)
- `'review'` → `ReviewMode` (+ `DesktopOnlyNotice`, after vision-to-intent)
- `'canvas'` → `Canvas` + `CanvasSidebar` + `ConfigPanel` + `Toolbar` + `BottomPanel` + `HintCard` + `IntentHeader`

Wraps everything in `ReactFlowProvider`.

#### `LandingPage`

**File:** [src/components/ui/LandingPage.tsx](src/components/ui/LandingPage.tsx)

First screen. Three paths:
1. **Discord scenario** (`startScenario`): sets Discord traffic + requirements, routes to design flow.
2. **Template picker** (`TemplatePicker` component): loads a canonical graph from `/public/templates/`.
3. **Text/image input** (`UnifiedInput` component): routes to vision-to-intent or text-to-diagram.

Env-gated: `VITE_ENABLE_TEXT_TO_DIAGRAM` controls whether the text-to-diagram flow is visible.

### Canvas & nodes

#### `Canvas`

**File:** [src/components/canvas/Canvas.tsx](src/components/canvas/Canvas.tsx)

Main XyFlow canvas. Renders `SimComponentNode` for each node, `SimWireEdge` for each edge, `ParticleOverlay` on top.

**Responsibilities:**
- XyFlow `ReactFlow` mount + config (connection mode, pan/zoom constraints, fit view)
- Keyboard shortcuts: `V` toggles view mode, `Delete` removes selected node, component-type hotkeys from [MVP_VISIBLE_TYPES](src/types/components.ts)
- Drag-from-library onto canvas → `addNode(type, position)`
- Handle connections via `onConnect` → `store.onConnect({source, target, ...})`
- Shows `PreflightBanner` above canvas

#### `SimComponentNode`

**File:** [src/components/nodes/SimComponentNode.tsx](src/components/nodes/SimComponentNode.tsx)

Memoized XyFlow node. Renders the box for a component.

**Displays:**
- Component icon + label + description
- Health border color (healthy/warning/critical/crashed)
- Live metrics when sim is running (RPS, p99, error %, CPU %, mem %, queue depth, cache hit %)
- Shard distribution bars for DB nodes with multiple shards
- Pulse animation when `pulseTarget === 'node:${id}'`
- "X" mark on crashed state

**Pulls from store:**
- `simulationStatus`, `liveMetrics[id]`, `pulseTarget`

#### `SimWireEdge`

**File:** [src/components/canvas/SimWireEdge.tsx](src/components/canvas/SimWireEdge.tsx)

XyFlow edge component. Renders the wire between two nodes with config-driven style (thicker for higher throughput, dashed for queue wires).

#### `ParticleOverlay`

**File:** [src/components/canvas/ParticleOverlay.tsx](src/components/canvas/ParticleOverlay.tsx)

SVG overlay that animates `store.particles` (traffic packets) along wires during simulation.

#### `PreflightBanner`

**File:** [src/components/canvas/PreflightBanner.tsx](src/components/canvas/PreflightBanner.tsx)

Banner at the top of the canvas. Lists errors + warnings. Each item is a clickable button; clicking routes to the fix location and triggers a pulse (see Flow 6 in [Knowledge.md](Knowledge.md)).

#### `IntentHeader`

**File:** [src/components/canvas/IntentHeader.tsx](src/components/canvas/IntentHeader.tsx)

Narrow header above the canvas in freeform mode. Shows the extracted intent (from vision-to-intent) and a "Re-derive components" button.

### Panels

#### `CanvasSidebar`

**File:** [src/components/panels/CanvasSidebar.tsx](src/components/panels/CanvasSidebar.tsx)

Left sidebar with three tabs (driven by `sidebarTab` store field):
- **Components** → `ComponentLibrary` (drag components onto canvas)
- **Design** → `DesignPanel` (inline requirements/API/schema editor)
- **Traffic** → `TrafficEditor` (freeform only)

Pulses on `pulseTarget === 'sidebar:*'`.

#### `ComponentLibrary`

**File:** [src/components/panels/ComponentLibrary.tsx](src/components/panels/ComponentLibrary.tsx)

Grid of draggable component chips. Filters to `MVP_VISIBLE_TYPES`. Drag transfers the component type; drop on canvas calls `store.addNode`.

#### `DesignPanel`

**File:** [src/components/panels/DesignPanel.tsx](src/components/panels/DesignPanel.tsx)

Inline version of DesignFlow for the sidebar. Sub-tabs: API and Schema. Uses `designPanelTab` store field.

#### `DesignFlow`

**File:** [src/components/panels/DesignFlow.tsx](src/components/panels/DesignFlow.tsx)

Full-page design editor. Shown at `appView === 'design'`. Sections:
1. Functional requirements
2. Non-functional requirements (NFRs — attribute, target, scope)
3. API contracts (method, path, auth, ownerServiceId)
4. Schema (paste SQL, parsed via [designFlowParser](src/components/panels/designFlowParser.ts))

On completion → `onComplete()` → `setAppView('canvas')`.

#### `TrafficEditor`

**File:** [src/components/panels/TrafficEditor.tsx](src/components/panels/TrafficEditor.tsx)

Traffic profile editor (freeform mode only). Lets users define phases (`startS, endS, rps, shape, description`), jitter %, user distribution.

#### `ConfigPanel`

**File:** [src/components/panels/ConfigPanel.tsx](src/components/panels/ConfigPanel.tsx)

Right-side panel showing config for `selectedNodeId`. Auto-opens when a node is clicked. Form fields driven by component type config schema.

**Key setters:** `updateComponentConfig(nodeId, configPatch)`.

#### `BottomPanel`

**File:** [src/components/panels/BottomPanel.tsx](src/components/panels/BottomPanel.tsx)

Bottom panel with two tabs:
- **Live Log** (`LogContent`): auto-scrolls, shows all `store.liveLog` entries colored by severity.
- **Debrief** (`DebriefContent`): only visible after sim completes. Shows:
    - Stressed badge (if `latestRun.stressedMode`)
    - Numeric score badges (Coherence / Security / Performance, 0-100)
    - Download Report button (→ [generateDebriefHtml](src/ai/generateDebriefHtml.ts))
    - What Happened summary
    - `PerComponentTable`: p50 | p99 | ρ | Errors | Peak Queue, sorted by p99 desc, severity-colored cells
    - Socratic questions (deterministic + AI-tagged)
    - AI loading/fallback banners
    - Patterns Detected flags

**Sub-components exported from this file:**
- `ScoreBadge` — numeric, colored (>70 green, ≥40 amber, else red)
- `PerComponentTable` — the peak metrics table
- `TabButton`, `LogContent`, `DebriefContent` — internal

`data-testid="bottom-panel"` + `data-testid="per-component-table"` + `data-testid="stressed-badge"` for E2E.

#### `LiveLog`

**File:** [src/components/panels/LiveLog.tsx](src/components/panels/LiveLog.tsx)

Standalone log component (superseded by `BottomPanel`'s `LogContent`). Kept for template compatibility.

#### `DebriefPanel`

**File:** [src/components/debrief/DebriefPanel.tsx](src/components/debrief/DebriefPanel.tsx)

Dead code (not imported by App). Superseded by `BottomPanel`'s `DebriefContent`. Don't modify; either use `BottomPanel` or delete in a future cleanup.

### Toolbar & inputs

#### `Toolbar`

**File:** [src/components/ui/Toolbar.tsx](src/components/ui/Toolbar.tsx)

Top bar. Contains:
- Logo + breadcrumb (scenario name + Design Flow link if scenario mode)
- Timer + progress bar (when sim is active)
- Speed buttons (1x / 2x / 5x / 10x)
- View toggle (Particle / Aggregate)
- Sim controls (Run / Run Stressed / Pause / Resume / Debrief / Reset)
- Remix button (when canvas has nodes and sim is idle)
- Save button (downloads session JSON)
- Theme toggle

**Key handlers:**
- `handleRun()` → `startSimulation(profile, false)`
- `handleRunStressed()` → `startSimulation(profile, true)`
- `handleStop()` → generates debrief, sets bottom panel tab
- `handleSave()` → builds session JSON, triggers download

#### `UnifiedInput`

**File:** [src/components/ui/UnifiedInput.tsx](src/components/ui/UnifiedInput.tsx)

Text input with image upload/paste. Submits to `/api/describe-intent` (vision-to-intent) or `/api/generate-diagram` (text-to-diagram, gated behind `VITE_ENABLE_TEXT_TO_DIAGRAM`).

#### `ImagePasteZone`

**File:** [src/components/ui/ImagePasteZone.tsx](src/components/ui/ImagePasteZone.tsx)

Drag-drop + paste handler. Resizes client-side to 1568px longest edge (JPEG) via `util/imageResize.ts` before base64 encoding.

#### `ImagePreviewChip`

**File:** [src/components/ui/ImagePreviewChip.tsx](src/components/ui/ImagePreviewChip.tsx)

Shows attached image as a chip with preview + remove button.

#### `RemixInput`

**File:** [src/components/ui/RemixInput.tsx](src/components/ui/RemixInput.tsx)

Inline remix text input. Submits current canvas + new intent to `/api/generate-diagram` with `mode: 'remix'`.

#### `TemplatePicker`

**File:** [src/components/ui/TemplatePicker.tsx](src/components/ui/TemplatePicker.tsx)

Grid of template thumbnails. Loads `/public/templates/*.json` (canonical graphs). On click → `replaceGraph(canonical)` + `setAppView('canvas')`.

#### `ReviewMode`

**File:** [src/components/ui/ReviewMode.tsx](src/components/ui/ReviewMode.tsx)

Shown at `appView === 'review'` after vision-to-intent returns. User can edit intent + components + connections before deriving the canvas.

#### `ConfidencePanel`

**File:** [src/components/ui/ConfidencePanel.tsx](src/components/ui/ConfidencePanel.tsx)

Shows per-dimension confidence (overall, intent, components, connections) returned by the vision API.

### UI primitives

#### `ConfirmModal`

**File:** [src/components/ui/ConfirmModal.tsx](src/components/ui/ConfirmModal.tsx)

Modal with title/body/confirm/cancel buttons. Used by Remix and destructive actions.

#### `UndoToast`

**File:** [src/components/ui/UndoToast.tsx](src/components/ui/UndoToast.tsx)

Bottom toast with message + auto-dismiss (4s). Used after Remix to show "Remixed. ⌘Z to restore."

#### `HintCard`

**File:** [src/components/ui/HintCard.tsx](src/components/ui/HintCard.tsx)

Floating hint card shown during canvas work (e.g., "Notification fanout can generate millions of writes/event. Queue between fanout and DB?"). Hints come from `store.hints`, emitted by [checkForHints](src/ai/debrief.ts).

#### `DesktopOnlyNotice`

**File:** [src/components/ui/DesktopOnlyNotice.tsx](src/components/ui/DesktopOnlyNotice.tsx)

Blocks mobile users with a "desktop-only" screen. MVP scope.

---

## Store

**File:** [src/store/index.ts](src/store/index.ts)

Zustand store. Single source of truth for all state.

### State shape

```ts
{
  // View state
  appMode: 'scenario' | 'freeform'
  appView: 'landing' | 'design' | 'review' | 'canvas'
  sidebarTab: 'components' | 'design' | 'traffic'
  designPanelTab: 'api' | 'schema'
  bottomPanelTab: 'log' | 'debrief'
  bottomPanelOpen: boolean
  logPanelExpanded: boolean
  theme: 'light' | 'dark'

  // Graph
  nodes: Node<SimComponentData>[]
  edges: Edge<{ config: WireConfig }>[]
  selectedNodeId: string | null
  hoveredNodeId: string | null

  // Vision-to-Intent
  intent: Intent | null
  systemSpec: SystemSpec | null
  confidence: Confidence | null

  // Design
  functionalReqs: string[]
  nonFunctionalReqs: NFR[]
  apiContracts: ApiContract[]
  endpointRoutes: EndpointRoute[]
  schemaMemory: SchemaMemoryBlock | null
  schemaHistory: SchemaMemoryBlock[]
  schemaInput: string

  // Simulation
  simulationStatus: 'idle' | 'running' | 'paused' | 'completed'
  simulationTime: number
  simulationSpeed: 1 | 2 | 5 | 10
  simulationRuns: SimulationRun[]
  currentRunId: string | null
  liveMetrics: Record<string, ComponentMetrics>
  liveLog: LogEntry[]
  particles: Particle[]
  viewMode: 'particle' | 'aggregate'

  // Debrief
  debrief: AIDebrief | null
  debriefVisible: boolean
  debriefLoading: boolean

  // Scenario
  scenarioId: string | null
  trafficProfile: TrafficProfile | null

  // UX
  pulseTarget: string | null        // e.g. "node:abc", "sidebar:design:schema"
  hints: HintMessage[]
}
```

### Key actions

| Action | Effect |
|---|---|
| `setAppView(view)` | Switches between landing / design / review / canvas |
| `setSidebarTab(tab)` / `setDesignPanelTab(tab)` / `setBottomPanelTab(tab)` | Tab switches |
| `setPulseTarget(target)` | Triggers pulse animation on `target` (cleared by `setTimeout` 1500ms) |
| `addNode(type, position)` | Appends a new node with default config for type |
| `removeNode(id)` | Removes node + incident edges |
| `onConnect({source, target, ...})` | Appends an edge with default wire config |
| `updateComponentConfig(id, patch)` | Merges `patch` into `nodes[id].data.config` |
| `updateWireConfig(edgeId, patch)` | Merges `patch` into edge wire config |
| `replaceGraph(canonical)` | Atomically replaces nodes + edges (used by templates, remix, vision-to-intent) |
| `setTrafficProfile(profile)` | Stores the profile; used when `Run` clicked |
| `setApiContracts(contracts)` | **Side effect:** if any contract has `ownerServiceId`, BFS-walks graph from that node and rebuilds `endpointRoutes` |
| `setSchemaMemory(schema)` | **Side effect:** pushes prior schema to `schemaHistory` |
| `setSimulationStatus(status)` | idle/running/paused/completed |
| `setSimulationTime(s)` | Updates the displayed timer |
| `updateLiveMetrics(id, metrics)` | Merges metrics for a component (called each tick) |
| `updateComponentHealth(id, health)` | Updates `nodes[id].data.health`, drives border color |
| `addLogEntry(entry)` | Appends to `liveLog` |
| `clearLiveLog()` | Empties `liveLog` (on sim start) |
| `addSimulationRun(run)` | Appends to `simulationRuns` array |
| `setDebrief(debrief)` | Sets debrief state (deterministic or merged with AI) |
| `setDebriefLoading(bool)` | Shows "Generating AI-powered questions..." |
| `resetSimulationState()` | Clears metrics/log/particles/status/time/currentRunId/debrief. Does NOT clear nodes/edges/design. |
| `undo()` / `redo()` | Graph undo/redo (guards: skips when `simulationStatus !== 'idle'`) |
| `toggleTheme()` | Toggles `document.documentElement.classList.dark` + stores preference |

### Window exposure

```js
window.__SYSTEMSIM_STORE__ = useStore  // for Playwright tests
```

Get state: `window.__SYSTEMSIM_STORE__.getState()`
Call action: `window.__SYSTEMSIM_STORE__.getState().setTrafficProfile(profile)`

---

## Simulation engine

**File:** [src/engine/SimulationEngine.ts](src/engine/SimulationEngine.ts)

### Class: `SimulationEngine`

```ts
new SimulationEngine(
  nodes: Node<SimComponentData>[],
  edges: Edge<{ config: WireConfig }>[],
  trafficProfile: TrafficProfile,
  schemaShardKey?: string,                              // for hot-shard detection
  schemaShardKeyCardinality?: 'low' | 'medium' | 'high',
  seed?: number,                                        // for reproducible tests
  stressedMode = false,                                 // worst-case run
)
```

### Public methods

| Method | Signature | Description |
|---|---|---|
| `tick()` | `() => { metrics, healths, newLogs, particles, time }` | Advances simulation by 1 sim-second. Returns updated state. |
| `isComplete()` | `() => boolean` | True when `time >= trafficProfile.durationSeconds` |
| `getTime()` | `() => number` | Current sim time in seconds |
| `getLog()` | `() => LogEntry[]` | Full log accumulated so far |
| `getParticles()` | `() => Particle[]` | Current particles (for visual rendering) |
| `getComponentHealth(id)` | `(string) => HealthState` | Current health of a component |
| `getComponentMetrics(id)` | `(string) => ComponentMetrics` | Current metrics of a component |
| `getAllMetrics()` | `() => Record<string, ComponentMetrics>` | Snapshot of all components' metrics |

### Hook: `useSimulation`

**File:** [src/engine/useSimulation.ts](src/engine/useSimulation.ts)

React hook that drives the engine. Returns:

```ts
{
  startSimulation: (profile: TrafficProfile, stressedMode?: boolean) => void
  stopSimulation:  (runId?: string, profile?: TrafficProfile) => void
  pauseSimulation: () => void
  resumeSimulation: () => void
}
```

Internally:
- `engineRef` holds current engine
- `timerRef` holds the setInterval
- `metricsHistoryRef` accumulates metrics time-series (for debrief)
- `stressedRef` holds the stressed flag (copied into `SimulationRun` on stop)
- `runTick()` is shared between start and resume

### Support modules

#### `QueueingModel`

**File:** [src/engine/QueueingModel.ts](src/engine/QueueingModel.ts)

`computeQueueing({ arrivalRateRps, processingTimeMs, instanceCount, maxConcurrentPerInstance })`
→ `{ utilization, waitTimeMs, p50Ms, p95Ms, p99Ms, dropRate }`

M/M/1-per-instance approximation via Little's Law. See [Decisions.md #6](Decisions.md).

#### `WorkingSetCache`

**File:** [src/engine/WorkingSetCache.ts](src/engine/WorkingSetCache.ts)

- `computeCacheModel({ rps, cacheSizeMb, ttlSeconds, evictionPolicy, keyCardinality, avgValueBytes, simTimeSeconds, zipfSkew? })`
    → `{ hitRate, workingSetSize, memoryUsedMb, stampedeRisk }`
- `networkAwareCacheLatency(cacheSizeMb, ttlSeconds)`
    → `{ p50, p99 }`

#### `Backpressure`

**File:** [src/engine/Backpressure.ts](src/engine/Backpressure.ts)

Target-signaled backpressure. Opt-in via target's `config.backpressure = { enabled: true }`.

**Types:**
- `BackpressureConfig` — `{ enabled: boolean }` (extensible: future smoothing, hysteresis)

**Exports:**
- `readBackpressureConfig(config): BackpressureConfig | undefined` — returns config iff `enabled: true`; rejects null, arrays, non-objects
- `computeAcceptanceRate(errorRate: number): number` — simple inverse `1 - errorRate`, clamped to `[0, 1]`

**Engine integration** (in [src/engine/SimulationEngine.ts](src/engine/SimulationEngine.ts)):
- `ComponentState.acceptanceRate: number` — init 1.0, updated end-of-tick when backpressure enabled AND `state.metrics.rps > 0`
- `forwardOverWire`: after retry amplification, if target's backpressure is enabled AND breaker is not HALF_OPEN, multiply `effectiveRps × target.acceptanceRate`
- One-shot callout emits when `appliedBackpressure ≤ 0.7` (includes 0 — the worst case)

**Config example:**
```ts
{ ...existingConfig, backpressure: { enabled: true } }
```

**Interaction rules:**
- **Breaker OPEN:** traffic already dropped upstream → backpressure doesn't run
- **Breaker HALF_OPEN:** backpressure suppressed (probe flows at nominal rate)
- **Target received 0 RPS this tick:** `acceptanceRate` NOT updated (no fresh signal; holds prior value)

#### `RetryPolicy`

**File:** [src/engine/RetryPolicy.ts](src/engine/RetryPolicy.ts)

Retry storm modeling. Upstream components opt-in via `config.retryPolicy`.

**Types:**
- `RetryPolicy` — `{ maxRetries: number, backoffMs?: number, backoffMultiplier?: number }`

**Exports:**
- `computeAmplification(errorRate: number, policy: RetryPolicy): number` — geometric sum `1 + e + e² + … + e^maxRetries`; returns 1.0 when errorRate = 0 or maxRetries = 0; clamps errorRate to [0, 1]
- `readRetryPolicy(config: Record<string, unknown>): RetryPolicy | undefined` — parses `config.retryPolicy`, returns undefined on missing/malformed/maxRetries<=0

**Engine integration** (in [src/engine/SimulationEngine.ts](src/engine/SimulationEngine.ts)):
- `WireState.lastObservedErrorRate: number` — updated after every forwardOverWire call; consumed by next tick's retry amplification
- `forwardOverWire` reads the source's retry policy, computes amplification from `wire.lastObservedErrorRate`, forwards `rps × amplification`, then records `target.metrics.errorRate` for the next tick
- One-shot callout emits to live log when amplification ≥ 1.5×

**Config example** (on any component that forwards to a downstream):
```ts
{ ...existingConfig, retryPolicy: { maxRetries: 3, backoffMs: 100, backoffMultiplier: 2 } }
```

`backoffMs` and `backoffMultiplier` are display-only fields in 3.2; the same-tick bundling model doesn't delay ticks by backoff.

#### `CircuitBreaker`

**File:** [src/engine/CircuitBreaker.ts](src/engine/CircuitBreaker.ts)

Per-wire circuit breaker state machine. Opt-in via `WireConfig.circuitBreaker`.

**Types:**
- `BreakerStatus` — `'closed' | 'open' | 'half_open'`
- `CircuitBreakerState` — `{ status, consecutiveFailureTicks, consecutiveSuccessTicks, cooldownUntilTime, hadTrafficThisTick }`
- `CircuitBreakerConfig` — `{ failureThreshold, failureWindow, cooldownSeconds, halfOpenTicks }`
- `BreakerTransition` — `{ from: BreakerStatus, to: BreakerStatus }`

**Defaults** (`DEFAULT_BREAKER_CONFIG`):
- `failureThreshold: 0.5` (errorRate above which a tick counts as failure)
- `failureWindow: 3` (consecutive failure ticks to trip CLOSED → OPEN)
- `cooldownSeconds: 10` (time in OPEN before trying HALF_OPEN)
- `halfOpenTicks: 2` (consecutive healthy probe ticks to return to CLOSED)

**Exports:**
- `makeBreakerState(): CircuitBreakerState` — fresh CLOSED state
- `resolveBreakerConfig(partial?): CircuitBreakerConfig` — applies defaults
- `evaluateBreaker(state, config, errorRate, currentTime): BreakerTransition | null` — advance the state machine by one tick; returns transition or null

**Engine integration** (in [src/engine/SimulationEngine.ts](src/engine/SimulationEngine.ts)):
- `WireState` gets optional `breaker` + `breakerConfig` (present iff `WireConfig.circuitBreaker` was set)
- `forwardOverWire(src, tgt, rps, accumulated, logs)` gates on breaker state — OPEN drops traffic; sets `hadTrafficThisTick = true` on the breaker when rps > 0
- `evaluateBreakers(logs)` runs at end of every tick; logs transitions bypass the throttle via `calloutEntries`
- `processLoadBalancer` excludes breaker-OPEN wires from its healthy-backend filter

**Type extension:**
```ts
interface WireConfig {
  throughputRps: number;
  latencyMs: number;
  jitterMs: number;
  circuitBreaker?: {                 // <-- NEW in Phase 3.1
    failureThreshold?: number;
    failureWindow?: number;
    cooldownSeconds?: number;
    halfOpenTicks?: number;
  };
}
```

#### `graphTraversal`

**File:** [src/engine/graphTraversal.ts](src/engine/graphTraversal.ts)

- `buildAdjacency(edges): Map<string, string[]>`
- `buildReverseAdjacency(edges): Map<string, string[]>`
- `bfs(start, adjacency): string[]`
- `findEntryPoints(nodes, reverseAdjacency): string[]`
- `findDisconnected(nodes, adjacency): string[]`
- `isReachable(from, to, adjacency): boolean`

#### `preflight`

**File:** [src/engine/preflight.ts](src/engine/preflight.ts)

- `runPreflight({ nodes, edges, trafficProfile, schemaMemory, apiContracts, endpointRoutes }): PreflightResult`
    → `{ errors: PreflightItem[], warnings: PreflightItem[] }`

Each item: `{ id, message, tooltip, target, targetSubtab?, targetComponentId? }`.

---

## AI client modules

### `src/ai/debrief.ts`

- `generateDebrief(ctx): AIDebrief` — deterministic, instant
- `computePerComponentPeaks(metricsTimeSeries, nodes): PerComponentSummary[]` — peak reducer sorted by p99 desc
- `checkForHints(nodes, edges, scenarioId): string[]` — pre-simulation hints (Discord-scoped for now)

### `src/ai/buildSimulationSummary.ts`

- `buildSimulationSummary(nodes, edges, run, shardKey?): string` — compresses sim state to ~4K tokens

### `src/ai/anthropicDebrief.ts`

- `fetchAIDebrief(summary: string, scenarioId: string | null): Promise<{ questions: string[] } | null>`

### `src/ai/generateDebriefHtml.ts`

- `generateDebriefHtml({ debrief, run, nodes, edges, scenarioId }): string`
- `downloadDebriefHtml(args)` — builds HTML, triggers blob download

### `src/ai/describeIntent.ts`

- `describeIntent({ text?, image? }): Promise<DescribeIntentResult>`

### `src/ai/generateDiagram.ts`

- `generateDiagram({ text, mode, currentGraph? }): Promise<{ graph: CanonicalGraph } | { error: true, message: string }>`

### `src/ai/parseConnections.ts`

- `parseConnections(spec): ParsedConnection[]` — turns intent-spec connections into graph-ready edges

---

## Types

**File:** [src/types/index.ts](src/types/index.ts)

Key types that cross module boundaries. Add new types here, not in component files.

### Graph

- `ComponentType` — discriminated union: `'load_balancer' | 'api_gateway' | 'server' | 'cache' | 'queue' | 'database' | 'websocket_gateway' | 'fanout' | 'cdn' | 'external' | 'autoscaler'`
- `HealthState` — `'healthy' | 'warning' | 'critical' | 'crashed'`
- `SimComponentData` — `{ type, label, config, health, metrics }`
- `ComponentMetrics` — `{ rps, p50, p95, p99, errorRate, cpuPercent, memoryPercent, queueDepth?, cacheHitRate?, activeConnections?, shardDistribution? }`
- `WireConfig` — `{ throughputRps, latencyMs, jitterMs }`
- `CanonicalNode`, `CanonicalEdge`, `CanonicalGraph` — template / save format

### Traffic

- `TrafficPhase` — `{ startS, endS, rps, shape, description }`
- `TrafficProfile` — `{ profileName, durationSeconds, phases, requestMix, userDistribution, jitterPercent, largeServerConcentration? }`

### Design

- `AuthMode` — `'none' | 'jwt' | 'oauth'`
- `ApiContract` — `{ id, method, path, description, authMode, ownerServiceId }`
- `SchemaField`, `SchemaIndex`, `AccessPattern`, `SchemaEntity`, `SchemaRelationship`, `SchemaMemoryBlock`
- `TableAccess`, `EndpointRoute` — IR for endpoint-to-table routing
- `NFR` — `{ attribute, target, scope }`

### Simulation

- `SimulationRun` — `{ runId, timestamp, schemaVersion, trafficProfile, metricsTimeSeries, log, aiDebrief?, scores?, stressedMode? }`
- `LogEntry` — `{ time, message, severity, componentId? }`
- `Particle` — `{ id, wireId, progress, speed, status }`

### Debrief

- `Scores` — `{ coherence, security, performance }` (each 0-100)
- `PerComponentSummary` — `{ id, name, type, p50, p99, rho?, errorRate, peakQueue? }`
- `AIDebrief` — `{ summary, questions, aiQuestions?, flags, scores, aiAvailable, componentSummary? }`

### Preflight

- `PreflightTarget` — `'traffic' | 'design' | 'canvas' | 'config'`
- `PreflightSubtab` — `'api' | 'schema'`
- `PreflightItem` — `{ id, message, tooltip, target, targetSubtab?, targetComponentId? }`
- `PreflightResult` — `{ errors: PreflightItem[], warnings: PreflightItem[] }`

### Session file format

- `SessionFile` — full save/load shape written by Toolbar's Save button, consumed by `migrateSession` in [src/migrate/migrate.ts](src/migrate/migrate.ts)

### Migration

- `migrateSession(unknown): { session: SessionFile, warnings: string[] } | { error: string }`
  — Zod-validated, gracefully migrates old session files (auth bool → authMode, synthesizes entity.id, etc.)

### Component registry

**File:** [src/types/components.ts](src/types/components.ts)

- `COMPONENT_DEFS: Record<ComponentType, ComponentDef>` — shortcut, default config, category color, description for each component type
- `MVP_VISIBLE_TYPES: Set<ComponentType>` — which types appear in ComponentLibrary and keyboard shortcuts

---

## Environment variables

- `ANTHROPIC_API_KEY` — required for all `/api/*` endpoints
- `VITE_ENABLE_TEXT_TO_DIAGRAM` — feature flag for the text-to-diagram input on landing page

---

## Testing

- Unit tests: `pnpm test` (Vitest, excludes `e2e/`)
- E2E tests: `pnpm exec playwright test` (Playwright, `e2e/` only)
- Single spec: `pnpm exec playwright test e2e/<spec>.spec.ts`
- Debug E2E: add `--headed --debug` flags

All E2E tests use `window.__SYSTEMSIM_STORE__` to inject scenarios and bypass preflight.
