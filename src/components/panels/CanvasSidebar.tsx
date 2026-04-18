/**
 * @file components/panels/CanvasSidebar.tsx
 *
 * Left-side tabbed sidebar with Components / Design / Traffic tabs. Tab
 * state lives in the store (`sidebarTab`) so preflight routing can switch
 * tabs from outside this component. Traffic tab only shows in freeform mode.
 *
 * Pulses when `pulseTarget === 'sidebar:{tabId}'` (see Preflight routing flow
 * in Knowledge.md).
 *
 * Width: 320px on viewports ≥1200px, collapses to a 44px rail (click to expand)
 * below that so the canvas keeps breathing room on smaller screens. Collapsed
 * state persists only for the session (panel-local state; not store-resident).
 */

import { useEffect, useState } from 'react';
import { useStore } from '../../store';
import ComponentLibrary from './ComponentLibrary';
import TrafficEditor from './TrafficEditor';
import DesignPanel from './DesignPanel';

type SidebarTab = 'components' | 'design' | 'traffic';

const COLLAPSE_BREAKPOINT = 1200;
const EXPANDED_WIDTH = 320;
const COLLAPSED_WIDTH = 44;

export default function CanvasSidebar() {
  const appMode = useStore((s) => s.appMode);
  const tab = useStore((s) => s.sidebarTab);
  const setTab = useStore((s) => s.setSidebarTab);
  const pulseTarget = useStore((s) => s.pulseTarget);

  const isSmallViewport = useMediaQuery(`(max-width: ${COLLAPSE_BREAKPOINT - 1}px)`);
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  // Default-collapsed on small viewports; user can override per-session.
  const collapsed = userToggled ?? isSmallViewport;

  const tabs: { id: SidebarTab; label: string; show: boolean }[] = [
    { id: 'components', label: 'Components', show: true },
    { id: 'design', label: 'Design', show: true },
    { id: 'traffic', label: 'Traffic', show: appMode === 'freeform' },
  ];

  return (
    <div
      data-testid="canvas-sidebar"
      data-collapsed={collapsed ? 'true' : 'false'}
      className="flex flex-col h-full relative"
      style={{
        width: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH,
        minWidth: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH,
        transition: 'width 180ms ease, min-width 180ms ease',
        borderRight: '1px solid var(--border-color)',
      }}
    >
      {collapsed ? (
        <button
          type="button"
          data-testid="sidebar-expand"
          onClick={() => setUserToggled(false)}
          title="Expand sidebar"
          style={{
            height: 44,
            background: 'transparent',
            color: 'var(--text-tertiary)',
            border: 'none',
            borderBottom: '1px solid var(--border-color)',
            cursor: 'pointer',
            fontSize: 18,
            fontWeight: 300,
          }}
        >
          ›
        </button>
      ) : null}
      {!collapsed && (<>
      <div
        className="flex items-center gap-0.5"
        style={{
          padding: '8px 8px 0',
          borderBottom: '1px solid var(--border-color)',
        }}
      >
        {tabs.filter((t) => t.show).map((t) => {
          const pulsing = pulseTarget?.startsWith(`sidebar:${t.id}`);
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={pulsing ? 'simfid-pulse' : ''}
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
          );
        })}
        <button
          type="button"
          data-testid="sidebar-collapse"
          onClick={() => setUserToggled(true)}
          title="Collapse sidebar"
          className="ml-auto"
          style={{
            width: 22,
            height: 22,
            borderRadius: 4,
            background: 'transparent',
            color: 'var(--text-tertiary)',
            border: 'none',
            cursor: 'pointer',
            fontSize: 14,
            lineHeight: 1,
            marginBottom: 2,
          }}
        >
          ‹
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {tab === 'components' && <ComponentLibrary />}
        {tab === 'design' && <DesignPanel />}
        {tab === 'traffic' && <TrafficEditor />}
      </div>
      </>)}
    </div>
  );
}

function useMediaQuery(query: string): boolean {
  const getMatch = () => typeof window !== 'undefined' && window.matchMedia(query).matches;
  const [matches, setMatches] = useState<boolean>(getMatch);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}
