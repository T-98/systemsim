/**
 * @file wiki/WikiRoute.tsx
 *
 * Top-level wiki page. Left nav (topics grouped by category) + main pane
 * (title + body + "Load in canvas" stub for how-to entries). Arrow-key
 * navigation through the nav list. Deep-link target comes from
 * `store.wikiFocusedTopic`.
 *
 * Content is deliberately empty at Phase A-scaffold — bodies get filled
 * from the system-design-knowledgebase.md at Phase A-content. Empty-state
 * copy reassures the user ("Content coming soon").
 */

import { useEffect, useMemo, useRef } from 'react';
import { useStore } from '../store';
import { listTopicKeys, lookupTopic, type TopicCategory } from './topics';
import TopicNav from './components/TopicNav';
import TopicBody from './components/TopicBody';

const CATEGORY_ORDER: TopicCategory[] = ['component', 'concept', 'config', 'howto', 'severity'];
const CATEGORY_LABEL: Record<TopicCategory, string> = {
  component: 'Components',
  concept: 'Concepts',
  config: 'Configuration',
  howto: 'How-tos',
  severity: 'Log severity',
};

export default function WikiRoute() {
  const focused = useStore((s) => s.wikiFocusedTopic);
  const setFocused = useStore((s) => s.setWikiFocusedTopic);
  const closeWiki = useStore((s) => s.closeWiki);

  const allKeys = useMemo(() => listTopicKeys(), []);
  const grouped = useMemo(() => {
    const out = new Map<TopicCategory, string[]>();
    for (const cat of CATEGORY_ORDER) out.set(cat, []);
    for (const key of allKeys) {
      const t = lookupTopic(key);
      out.get(t.category)?.push(key);
    }
    return out;
  }, [allKeys]);

  // Flat ordered list for arrow-key navigation.
  const flatKeys = useMemo(() => {
    const out: string[] = [];
    for (const cat of CATEGORY_ORDER) {
      const keys = grouped.get(cat);
      if (keys) out.push(...keys);
    }
    return out;
  }, [grouped]);

  // Default-focus the first key if none is set (and no deep-link).
  useEffect(() => {
    if (!focused && flatKeys.length > 0) {
      setFocused(flatKeys[0]);
    }
  }, [focused, flatKeys, setFocused]);

  const currentIndex = focused ? flatKeys.indexOf(focused) : -1;
  const navRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeWiki();
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      if (flatKeys.length === 0) return;
      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      const next = currentIndex < 0
        ? 0
        : (currentIndex + delta + flatKeys.length) % flatKeys.length;
      setFocused(flatKeys[next]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentIndex, flatKeys, setFocused, closeWiki]);

  return (
    <div
      className="h-screen flex flex-col"
      style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
    >
      <header
        className="flex items-center justify-between"
        style={{
          padding: '14px 20px',
          borderBottom: '1px solid var(--border-color)',
          background: 'var(--bg-sidebar)',
        }}
      >
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={closeWiki}
            data-testid="wiki-back"
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              background: 'transparent',
              border: '1px solid var(--border-color)',
              color: 'var(--text-secondary)',
              fontSize: 13,
              cursor: 'pointer',
              letterSpacing: '-0.12px',
            }}
          >
            ← Back
          </button>
          <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.24px' }}>
            SystemSim Wiki
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', letterSpacing: '-0.12px' }}>
          {flatKeys.length} topics · content coming soon
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <nav
          ref={navRef}
          data-testid="wiki-nav"
          aria-label="Wiki topics"
          className="overflow-y-auto"
          style={{
            width: 280,
            borderRight: '1px solid var(--border-color)',
            background: 'var(--bg-sidebar)',
            padding: '12px 0',
          }}
        >
          {CATEGORY_ORDER.map((cat) => {
            const keys = grouped.get(cat) ?? [];
            if (keys.length === 0) return null;
            return (
              <div key={cat} data-testid={`wiki-nav-group-${cat}`} style={{ marginBottom: 12 }}>
                <div
                  style={{
                    padding: '6px 16px',
                    fontSize: 11,
                    textTransform: 'uppercase',
                    letterSpacing: '0.6px',
                    color: 'var(--text-tertiary)',
                    fontWeight: 600,
                  }}
                >
                  {CATEGORY_LABEL[cat]}
                </div>
                <TopicNav
                  keys={keys}
                  focusedKey={focused}
                  onSelect={setFocused}
                />
              </div>
            );
          })}
        </nav>

        <main
          className="flex-1 overflow-y-auto"
          data-testid="wiki-main"
          style={{ padding: '32px 48px' }}
        >
          <TopicBody topicKey={focused} />
        </main>
      </div>
    </div>
  );
}
