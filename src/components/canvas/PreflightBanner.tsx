import { useMemo, useState } from 'react';
import { useStore } from '../../store';
import { runPreflight } from '../../engine/preflight';
import type { PreflightItem, PreflightTarget } from '../../types';

export default function PreflightBanner() {
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const trafficProfile = useStore((s) => s.trafficProfile);
  const schemaMemory = useStore((s) => s.schemaMemory);
  const apiContracts = useStore((s) => s.apiContracts);
  const endpointRoutes = useStore((s) => s.endpointRoutes);
  const simulationStatus = useStore((s) => s.simulationStatus);

  const result = useMemo(
    () =>
      runPreflight({
        nodes: nodes.map((n) => ({ id: n.id, data: { type: n.data.type, label: n.data.label, config: n.data.config } })),
        edges: edges.map((e) => ({ source: e.source, target: e.target })),
        trafficProfile,
        schemaMemory,
        apiContracts,
        endpointRoutes,
      }),
    [nodes, edges, trafficProfile, schemaMemory, apiContracts, endpointRoutes],
  );

  if (result.errors.length === 0 || simulationStatus !== 'idle') return null;

  return (
    <div
      role="region"
      aria-labelledby="preflight-heading"
      style={{
        background: 'rgba(255,159,10,0.08)',
        border: '1px solid rgba(255,159,10,0.2)',
        borderRadius: 8,
        padding: '12px 14px',
        margin: '8px 12px 0',
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--warning)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ flexShrink: 0 }}
          >
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
            <line x1="12" x2="12" y1="9" y2="13" />
            <line x1="12" x2="12.01" y1="17" y2="17" />
          </svg>
          <span
            id="preflight-heading"
            style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.224px' }}
          >
            Complete these to run the simulation
          </span>
        </div>
      </div>
      <ul className="mt-2" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {result.errors.map((item) => (
          <PreflightRow key={item.id} item={item} />
        ))}
      </ul>
    </div>
  );
}

function PreflightRow({ item }: { item: PreflightItem }) {
  const setSelectedNodeId = useStore((s) => s.setSelectedNodeId);
  const setSidebarTab = useStore((s) => s.setSidebarTab);
  const setDesignPanelTab = useStore((s) => s.setDesignPanelTab);
  const setPulseTarget = useStore((s) => s.setPulseTarget);
  const [hovered, setHovered] = useState(false);

  const handleClick = () => {
    if (item.target === 'config' && item.targetComponentId) {
      setSelectedNodeId(item.targetComponentId);
      setPulseTarget(`node:${item.targetComponentId}`);
      setTimeout(() => setPulseTarget(null), 1500);
      return;
    }
    if (item.target === 'traffic') {
      setSidebarTab('traffic');
      setPulseTarget('sidebar:traffic');
      setTimeout(() => setPulseTarget(null), 1500);
      return;
    }
    if (item.target === 'design') {
      setSidebarTab('design');
      if (item.targetSubtab) setDesignPanelTab(item.targetSubtab);
      setPulseTarget(`sidebar:design:${item.targetSubtab ?? 'api'}`);
      setTimeout(() => setPulseTarget(null), 1500);
      return;
    }
    if (item.target === 'canvas' && item.targetComponentId) {
      setSelectedNodeId(item.targetComponentId);
      setPulseTarget(`node:${item.targetComponentId}`);
      setTimeout(() => setPulseTarget(null), 1500);
      return;
    }
    if (item.target === 'canvas') {
      setPulseTarget('canvas:all');
      setTimeout(() => setPulseTarget(null), 1500);
    }
  };

  return (
    <li>
      <button
        type="button"
        onClick={handleClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        title={item.tooltip}
        aria-label={`${item.message} \u2014 ${targetLabel(item.target)}`}
        className="w-full flex items-center gap-2 transition-colors"
        style={{
          height: 32,
          padding: '0 4px',
          borderRadius: 4,
          background: hovered ? 'rgba(255,159,10,0.06)' : 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span
          style={{
            width: 16,
            height: 16,
            borderRadius: 4,
            border: '1px solid var(--border-color)',
            flexShrink: 0,
          }}
        />
        <span
          style={{
            flex: 1,
            fontSize: 13,
            color: 'var(--text-secondary)',
            letterSpacing: '-0.224px',
          }}
        >
          {item.message}
        </span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--text-tertiary)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>
    </li>
  );
}

function targetLabel(target: PreflightTarget): string {
  switch (target) {
    case 'traffic': return 'open Traffic editor';
    case 'design': return 'open Design tab';
    case 'canvas': return 'select on canvas';
    case 'config': return 'open Config panel';
  }
}
