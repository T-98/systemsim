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
  const isRunning = simulationStatus === 'running';

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

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: selected ? 'var(--accent)' : 'var(--wire-color)',
          strokeWidth,
          transition: 'stroke-width 0.3s',
        }}
      />
      {isRunning && viewMode === 'aggregate' && (
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
