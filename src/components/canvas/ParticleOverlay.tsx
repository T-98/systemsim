/**
 * @file components/canvas/ParticleOverlay.tsx
 *
 * SVG overlay that animates `store.particles` along wires during a running
 * simulation. Particles are emitted per tick by SimulationEngine based on
 * current RPS; their `progress` advances from 0 to 1 along the wire path.
 */

import { useEffect, useRef } from 'react';
import { useStore } from '../../store';
import { useReactFlow } from '@xyflow/react';

export default function ParticleOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particles = useStore((s) => s.particles);
  const viewMode = useStore((s) => s.viewMode);
  const simulationStatus = useStore((s) => s.simulationStatus);
  const edges = useStore((s) => s.edges);
  const { getNodes } = useReactFlow();

  useEffect(() => {
    if (viewMode !== 'particle' || simulationStatus !== 'running') return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.parentElement?.getBoundingClientRect();
    if (!rect) return;

    canvas.width = rect.width;
    canvas.height = rect.height;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const nodes = getNodes();
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    particles.forEach((p) => {
      const edge = edges.find((e) => e.id === p.wireId);
      if (!edge) return;

      const sourceNode = nodeMap.get(edge.source);
      const targetNode = nodeMap.get(edge.target);
      if (!sourceNode || !targetNode) return;

      const sx = (sourceNode.position.x + (sourceNode.measured?.width ?? 160));
      const sy = (sourceNode.position.y + (sourceNode.measured?.height ?? 40) / 2);
      const tx = targetNode.position.x;
      const ty = (targetNode.position.y + (targetNode.measured?.height ?? 40) / 2);

      const x = sx + (tx - sx) * p.progress;
      const y = sy + (ty - sy) * p.progress;

      const color = p.status === 'error' ? '#EF4444' : p.status === 'success' ? '#10B981' : '#ffffff';
      const radius = p.status === 'in_flight' ? 2.5 : 4;

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      if (p.status !== 'in_flight') {
        ctx.beginPath();
        ctx.arc(x, y, radius + 3, 0, Math.PI * 2);
        ctx.fillStyle = color + '40';
        ctx.fill();
      }
    });
  }, [particles, viewMode, simulationStatus, edges, getNodes]);

  if (viewMode !== 'particle' || simulationStatus !== 'running') return null;

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none z-10"
    />
  );
}
