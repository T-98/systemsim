import { useState } from 'react';
import { useStore } from '../../store';
import ComponentLibrary from './ComponentLibrary';
import TrafficEditor from './TrafficEditor';
import DesignPanel from './DesignPanel';

type SidebarTab = 'components' | 'design' | 'traffic';

export default function CanvasSidebar() {
  const appMode = useStore((s) => s.appMode);
  const [tab, setTab] = useState<SidebarTab>('components');

  const tabs: { id: SidebarTab; label: string; show: boolean }[] = [
    { id: 'components', label: 'Components', show: true },
    { id: 'design', label: 'Design', show: true },
    { id: 'traffic', label: 'Traffic', show: appMode === 'freeform' },
  ];

  return (
    <div className="flex flex-col h-full" style={{ width: 240, borderRight: '1px solid var(--border-color)' }}>
      <div
        className="flex gap-0.5"
        style={{
          padding: '8px 8px 0',
          borderBottom: '1px solid var(--border-color)',
        }}
      >
        {tabs.filter((t) => t.show).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '6px 10px',
              borderRadius: '6px 6px 0 0',
              fontSize: 12,
              fontWeight: 500,
              letterSpacing: '-0.12px',
              background: tab === t.id ? 'var(--bg-primary)' : 'transparent',
              color: tab === t.id ? 'var(--text-primary)' : 'var(--text-tertiary)',
              border: 'none',
              cursor: 'pointer',
              borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {tab === 'components' && <ComponentLibrary />}
        {tab === 'design' && <DesignPanel />}
        {tab === 'traffic' && <TrafficEditor />}
      </div>
    </div>
  );
}
