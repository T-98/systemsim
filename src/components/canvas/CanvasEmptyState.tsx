/**
 * @file components/canvas/CanvasEmptyState.tsx
 *
 * Empty-canvas guidance overlay (design-review F-02). Before this, the
 * guided scenario dropped users onto a blank canvas with a disabled Run
 * and no direction — "guided" with no guide. Renders only when the graph
 * has zero nodes; disappears on the first component.
 *
 * Scenario mode: restates the scenario goal and gives the first concrete
 * step. Freeform: shortcut hints. Pointer events pass through except on
 * the card itself so the canvas stays drag-and-droppable.
 */

import { useStore } from '../../store';
import { DISCORD_SCENARIO_ID, DISCORD_BRIEF } from '../../scenarios/discord';

export default function CanvasEmptyState() {
  const nodes = useStore((s) => s.nodes);
  const appMode = useStore((s) => s.appMode);
  const scenarioId = useStore((s) => s.scenarioId);

  if (nodes.length > 0) return null;

  const isScenario = appMode === 'scenario' && scenarioId === DISCORD_SCENARIO_ID;

  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{ pointerEvents: 'none', zIndex: 4 }}
      data-testid="canvas-empty-state"
    >
      <div
        style={{
          maxWidth: 460,
          padding: '24px 28px',
          borderRadius: 11,
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          pointerEvents: 'auto',
        }}
      >
        {isScenario ? (
          <>
            <div
              className="uppercase font-medium"
              style={{ fontSize: 10, letterSpacing: '0.2em', color: 'var(--accent)', marginBottom: 8 }}
            >
              Your mission
            </div>
            <div style={{ fontSize: 14, color: 'var(--text-primary)', letterSpacing: '-0.224px', lineHeight: 1.55, marginBottom: 12 }}>
              {DISCORD_BRIEF.description}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', letterSpacing: '-0.12px', lineHeight: 1.55 }}>
              Start where traffic enters: add a <strong>Load Balancer</strong> (press
              {' '}<Kbd>L</Kbd>) or drag one in from the left. Then give events somewhere
              to go — servers (<Kbd>S</Kbd>), a queue (<Kbd>Q</Kbd>), a fan-out service
              (<Kbd>F</Kbd>) — and wire them by dragging between the dots.
            </div>
          </>
        ) : (
          <>
            <div
              className="uppercase font-medium"
              style={{ fontSize: 10, letterSpacing: '0.2em', color: 'var(--text-tertiary)', marginBottom: 8 }}
            >
              Blank canvas
            </div>
            <div style={{ fontSize: 14, color: 'var(--text-primary)', letterSpacing: '-0.224px', lineHeight: 1.55, marginBottom: 12 }}>
              Drag a component in from the left, or press a shortcut:
              {' '}<Kbd>L</Kbd> load balancer, <Kbd>S</Kbd> server, <Kbd>D</Kbd> database,
              {' '}<Kbd>H</Kbd> cache, <Kbd>Q</Kbd> queue.
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-tertiary)', letterSpacing: '-0.12px', lineHeight: 1.55 }}>
              Wire components by dragging between the connection dots. The checklist
              above tracks what the simulation still needs.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      style={{
        display: 'inline-block',
        padding: '1px 6px',
        borderRadius: 4,
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border-color)',
        color: 'var(--text-secondary)',
        fontSize: 11,
        fontFamily: 'inherit',
        margin: '0 1px',
      }}
    >
      {children}
    </kbd>
  );
}
