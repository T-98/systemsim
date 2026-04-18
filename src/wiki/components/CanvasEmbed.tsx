/**
 * @file wiki/components/CanvasEmbed.tsx
 *
 * Inline preview of a canvas template, embedded in docs pages. Fetches
 * `/templates/howto/<slug>.json`, renders a small read-only ReactFlow
 * preview, and offers two actions:
 *
 *   - **Take to canvas** — replaces the main canvas with this template
 *     and switches the app view to 'canvas'. Reuses the same store
 *     action TemplatePicker uses.
 *   - **Run inline** — deferred. The sim engine is currently coupled to
 *     the Zustand store; instantiating a scoped engine requires a small
 *     refactor tracked as a follow-up. The button is wired but labeled
 *     "coming soon" to keep the docs honest.
 *
 * Why not embed the full sim inline? Two reasons. First, a read-only
 * preview is the MVP of "see it, then take it to the canvas to play" —
 * that round-trip is the distinctive pattern, inline Run is polish on
 * top. Second, the engine's Math.random dependency + its coupling to
 * global `liveMetrics` / `liveLog` make a scoped run non-trivial and
 * we'd rather ship the round-trip today than gate it on a refactor.
 */

import { useEffect, useState } from 'react';
import { ReactFlow, Background, Controls, ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useStore } from '../../store';
import { COMPONENT_DEFS } from '../../types/components';
import type { CanonicalGraph } from '../../types';

interface TemplateFile {
  systemsimVersion?: string;
  metadata?: { name?: string; source?: string; tags?: string[] };
  nodes: { type: string; label: string; config?: Record<string, unknown> }[];
  edges: { source: string; target: string; config?: Record<string, unknown> }[];
}

/** Convert the JSON template shape to the store's CanonicalGraph. */
function toCanonical(tpl: TemplateFile): CanonicalGraph {
  // Node ids are `<type>-<index>` matching the convention in other templates.
  const nodes = tpl.nodes.map((n, i) => ({
    id: `${n.type}-${i}`,
    type: n.type as never,
    position: { x: 80 + i * 180, y: 80 },
    data: {
      label: n.label,
      type: n.type as never,
      config: n.config ?? {},
      health: 'healthy' as const,
      metrics: {
        rps: 0,
        p50: 0,
        p95: 0,
        p99: 0,
        errorRate: 0,
        cpuPercent: 0,
        memoryPercent: 0,
        activeConnections: 0,
      },
    },
  }));
  const edges = tpl.edges.map((e, i) => ({
    id: `e-${i}`,
    source: e.source,
    target: e.target,
    data: { config: (e.config ?? { throughputRps: 10000, latencyMs: 2, jitterMs: 1 }) as never },
  }));
  return { nodes: nodes as never, edges: edges as never };
}

export default function CanvasEmbed({ template }: { template: string }) {
  const [data, setData] = useState<TemplateFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const replaceGraph = useStore((s) => s.replaceGraph);
  const setAppView = useStore((s) => s.setAppView);
  const setAppMode = useStore((s) => s.setAppMode);
  const closeWiki = useStore((s) => s.closeWiki);

  useEffect(() => {
    let cancelled = false;
    // Defense-in-depth: the MarkdownBody splicer already validates the slug
    // via an allowlist regex, but duplicate the check here so this component
    // can't be misused by a caller that passes an unvalidated string.
    if (!/^[a-zA-Z0-9_-]+$/.test(template)) {
      setError('Invalid template slug.');
      return;
    }
    fetch(`/templates/howto/${encodeURIComponent(template)}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((json: TemplateFile) => {
        if (!cancelled) setData(json);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(`Couldn't load template: ${e.message}`);
      });
    return () => {
      cancelled = true;
    };
  }, [template]);

  if (error) {
    return (
      <div
        data-testid="canvas-embed-error"
        style={{
          padding: 16,
          borderRadius: 8,
          border: '1px dashed var(--destructive)',
          color: 'var(--destructive)',
          fontSize: 13,
          letterSpacing: '-0.12px',
        }}
      >
        {error}
      </div>
    );
  }
  if (!data) {
    return (
      <div
        data-testid="canvas-embed-loading"
        style={{
          padding: 16,
          borderRadius: 8,
          border: '1px dashed var(--border-color)',
          color: 'var(--text-tertiary)',
          fontSize: 13,
          letterSpacing: '-0.12px',
        }}
      >
        Loading preview…
      </div>
    );
  }

  // Keep our local graph render for the preview, but for the hand-off we
  // pass the raw `{nodes, edges}` shape the store's replaceGraph expects —
  // same call TemplatePicker makes.
  const graph = toCanonical(data);

  const handleTakeToCanvas = () => {
    replaceGraph({ nodes: data.nodes as never, edges: data.edges as never }, { layout: 'auto' });
    setAppMode('freeform');
    closeWiki();
    setAppView('canvas');
  };

  return (
    <div
      data-testid="canvas-embed"
      data-template={template}
      style={{
        margin: '20px 0',
        borderRadius: 10,
        border: '1px solid var(--border-color)',
        overflow: 'hidden',
        background: 'var(--bg-input)',
      }}
    >
      <div
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '-0.12px', color: 'var(--text-secondary)' }}>
          {data.metadata?.name ?? 'Template preview'}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="canvas-embed-run-inline"
            disabled
            title="Inline Run ships in a follow-up"
            style={{
              padding: '5px 10px',
              borderRadius: 6,
              background: 'transparent',
              color: 'var(--text-tertiary)',
              border: '1px solid var(--border-color)',
              cursor: 'not-allowed',
              fontSize: 12,
              opacity: 0.6,
              letterSpacing: '-0.12px',
            }}
          >
            Run inline (soon)
          </button>
          <button
            type="button"
            data-testid="canvas-embed-take-to-canvas"
            onClick={handleTakeToCanvas}
            style={{
              padding: '5px 12px',
              borderRadius: 6,
              background: 'var(--accent)',
              color: 'var(--text-on-accent, white)',
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
              letterSpacing: '-0.12px',
            }}
          >
            Take to canvas →
          </button>
        </div>
      </div>
      <div style={{ height: 200, background: 'var(--bg-primary)' }}>
        <ReactFlowProvider>
          <ReactFlow
            nodes={previewNodes(data)}
            edges={previewEdges(data)}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            proOptions={{ hideAttribution: true }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            panOnDrag={false}
            zoomOnScroll={false}
            zoomOnPinch={false}
            zoomOnDoubleClick={false}
            preventScrolling={false}
            style={{ background: 'var(--bg-primary)' }}
          >
            <Background gap={16} size={1} color="var(--border-color)" />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
      <div
        style={{
          padding: '8px 14px',
          fontSize: 11,
          color: 'var(--text-tertiary)',
          letterSpacing: '-0.12px',
          borderTop: '1px solid var(--border-color)',
          fontFamily: "'Geist Mono', monospace",
        }}
      >
        {graph.nodes.length} components · {graph.edges.length} wires · Tap "Take to canvas" to edit + run.
      </div>
    </div>
  );
}

// Keep the import even if unused in parts of the module to help bundlers.
void COMPONENT_DEFS;

/** Build plain ReactFlow nodes for the preview (no custom node type). */
function previewNodes(tpl: TemplateFile) {
  return tpl.nodes.map((n, i) => ({
    id: `${n.type}-${i}`,
    position: { x: 80 + i * 180, y: 40 + (i % 2) * 60 },
    data: { label: n.label },
    draggable: false,
    selectable: false,
  }));
}

function previewEdges(tpl: TemplateFile) {
  return tpl.edges.map((e, i) => ({
    id: `e-${i}`,
    source: e.source,
    target: e.target,
    animated: false,
  }));
}
