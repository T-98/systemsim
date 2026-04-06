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
  const strokeColor = selected ? '#3B82F6' : '#3A3D4A';

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: strokeColor,
          strokeWidth,
          transition: 'stroke-width 0.3s',
        }}
      />
      {isRunning && viewMode === 'aggregate' && (
        <BaseEdge
          id={`${id}-glow`}
          path={edgePath}
          style={{
            stroke: '#3B82F640',
            strokeWidth: strokeWidth + 4,
            filter: 'blur(3px)',
          }}
        />
      )}
    </>
  );
}

export default memo(SimWireEdge);
