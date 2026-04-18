# Your canvas

The canvas is where everything lives. Components as boxes, wires as edges, layout auto-arranged but manually re-arrangeable.

## The three panels

- **Left sidebar.** Components you can drop onto the canvas (Components tab), the graph structure (Design tab), and traffic profiles (Traffic tab, freeform mode only).
- **Center canvas.** The graph itself. Drag to pan, scroll to zoom, click to select, drag nodes to rearrange.
- **Right config panel.** Opens when you click a node or wire. Everything configurable about the selected element is here.

## Keyboard + mouse basics

- **Click** a component → selects it, opens right panel.
- **Click** a wire → selects wire, shows wire config (throughput, latency, jitter, optional circuit breaker).
- **Drag from a node's handle** → create a new wire to another node.
- **Delete key** → remove selected component or wire.
- **⌘+/-** → zoom. **Space+drag** or middle-drag → pan.
- **?** → open the docs focused on what's currently selected.

## The live-pulse convention

When something needs your attention — a preflight item you clicked, a log row you clicked, a node referenced by a debrief question — the canvas pulses the relevant node with a brief accent glow. 1.5 seconds, then fades. If you're looking elsewhere you can still spot it.

Next: [Components at a glance](#docs/learn/components-at-a-glance).
