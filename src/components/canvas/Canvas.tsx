import { useCallback, useRef, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useStore } from '../../store';
import SimComponentNode from '../nodes/SimComponentNode';
import SimWireEdge from './SimWireEdge';
import ParticleOverlay from './ParticleOverlay';
import type { ComponentType } from '../../types';

const nodeTypes = { simComponent: SimComponentNode };
const edgeTypes = { simWire: SimWireEdge };

export default function Canvas() {
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const onNodesChange = useStore((s) => s.onNodesChange);
  const onEdgesChange = useStore((s) => s.onEdgesChange);
  const onConnect = useStore((s) => s.onConnect);
  const setSelectedNodeId = useStore((s) => s.setSelectedNodeId);
  const setSelectedEdgeId = useStore((s) => s.setSelectedEdgeId);
  const addComponent = useStore((s) => s.addComponent);
  const simulationStatus = useStore((s) => s.simulationStatus);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);

  const rfInstance = useRef<ReactFlowInstance | null>(null);
  const isRunning = simulationStatus === 'running' || simulationStatus === 'paused';

  const onNodeClick = useCallback((_: React.MouseEvent, node: { id: string }) => {
    setSelectedNodeId(node.id);
  }, [setSelectedNodeId]);

  const onEdgeClick = useCallback((_: React.MouseEvent, edge: { id: string }) => {
    setSelectedEdgeId(edge.id);
  }, [setSelectedEdgeId]);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, [setSelectedNodeId, setSelectedEdgeId]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('application/systemsim-component') as ComponentType;
    if (!type || !rfInstance.current) return;

    const position = rfInstance.current.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    addComponent(type, position);
  }, [addComponent]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;

      // Undo/redo
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'Z' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }

      if (isRunning) return;

      // Component shortcuts
      const shortcuts: Record<string, ComponentType> = {
        l: 'load_balancer', g: 'api_gateway', s: 'server', h: 'cache',
        q: 'queue', d: 'database', w: 'websocket_gateway', f: 'fanout',
        n: 'cdn', e: 'external', a: 'autoscaler',
      };
      if (shortcuts[e.key.toLowerCase()] && !e.metaKey && !e.ctrlKey) {
        addComponent(shortcuts[e.key.toLowerCase()]);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [addComponent, undo, redo, isRunning]);

  return (
    <div className="flex-1 relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={isRunning ? undefined : onNodesChange}
        onEdgesChange={isRunning ? undefined : onEdgesChange}
        onConnect={isRunning ? undefined : onConnect}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onInit={(instance) => { rfInstance.current = instance; }}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={{ type: 'simWire' }}
        fitView
        proOptions={{ hideAttribution: true }}
        className="bg-[#08090D]"
        nodesDraggable={!isRunning}
        nodesConnectable={!isRunning}
        elementsSelectable={true}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#10121A" />
        <Controls
          showInteractive={false}
          className="!bg-[#0C0D14] !border-[#14161F] !rounded-lg [&>button]:!bg-[#0C0D14] [&>button]:!border-[#14161F] [&>button]:!text-[#5A6078] [&>button:hover]:!bg-[#14161F] [&>button:hover]:!text-[#8890A8]"
        />
        <MiniMap
          className="!bg-[#0A0B12] !border-[#14161F] !rounded-lg"
          nodeColor="#14161F"
          maskColor="#08090D40"
        />
        <ParticleOverlay />
      </ReactFlow>
    </div>
  );
}
