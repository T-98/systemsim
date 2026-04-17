/**
 * @file components/canvas/SimWireEdge.tsx
 *
 * XyFlow custom edge. Renders wires with config-driven style (thicker line
 * for higher throughput, dashed for queue wires, color by health).
 *
 * Phase 3.1+ circuit breaker visualization:
 * - Breaker OPEN: destructive-red dashed stroke (fail-fast, traffic dropped)
 * - Breaker HALF_OPEN: amber dashed stroke (probing)
 * - Breaker CLOSED or no breaker: default stroke
 * - Selected wire: accent-color outline regardless of breaker state
 */

import { memo } from 'react';
import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react';
import { useStore } from '../../store';
import type { WireConfig } from '../../types';

function SimWireEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  data,
}: EdgeProps & { data: { config: WireConfig } }) {
  const simulationStatus = useStore((s) => s.simulationStatus);
  const viewMode = useStore((s) => s.viewMode);
  const liveWireState = useStore((s) => s.liveWireStates[id]);
  const isRunning = simulationStatus === 'running' || simulationStatus === 'paused';
  // Show breaker state only while actively running. Once completed or idle,
  // stale colors would mislead users editing the graph post-run (Codex finding #2).
  const showBreakerState = simulationStatus === 'running' || simulationStatus === 'paused';

  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 8,
  });

  const strokeWidth = selected ? 2.5 : viewMode === 'aggregate' && isRunning ? 3 : 1.5;

  // Resolve stroke style from breaker state — only while the sim is actively
  // ticking (Codex finding #2). On 'idle'/'completed' we skip breaker colors so
  // users editing the graph don't see stale paint from a prior run.
  const breakerStatus = showBreakerState ? liveWireState?.breakerStatus : null;
  let stroke = selected ? 'var(--accent)' : 'var(--wire-color)';
  let dash: string | undefined;
  let opacity = 1;
  if (!selected) {
    if (breakerStatus === 'open') {
      stroke = 'var(--destructive)';
      dash = '6 4';
      opacity = 0.9;
    } else if (breakerStatus === 'half_open') {
      stroke = 'var(--warning)';
      dash = '6 4';
    }
  }

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke,
          strokeWidth,
          strokeDasharray: dash,
          opacity,
          transition: 'stroke-width 0.3s, stroke 0.3s, opacity 0.3s',
        }}
      />
      {isRunning && viewMode === 'aggregate' && !breakerStatus && (
        <BaseEdge
          id={`${id}-glow`}
          path={edgePath}
          style={{
            stroke: 'var(--accent)',
            strokeWidth: strokeWidth + 4,
            filter: 'blur(3px)',
            opacity: 0.25,
          }}
        />
      )}
    </>
  );
}

export default memo(SimWireEdge);
