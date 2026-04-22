/**
 * @file wiki/WikiRoute.tsx
 *
 * Docs product shell. Three top-level tabs:
 *   - **Learn**     (category: 'userGuide')        — hand-written user manual.
 *   - **Reference** (category: 'reference' or the shared component/config/concept/severity set
 *                    that co-ports from the InfoIcon popovers)              — the 44-section KB.
 *   - **How-to**    (category: 'howto')            — canvas-loadable scenarios.
 *
 * Each tab shows a left sidebar filtered to its content, and a main pane
 * rendering the focused topic. Markdown bodies route through
 * `MarkdownBody`. Deep-link via `#docs/<tab>/<slug>` in the URL hash
 * (see [src/wiki/docsHash.ts](src/wiki/docsHash.ts)).
 *
 * Right-rail TOC + Prev/Next footer ship in P6; for now the shell is
 * tabs + sidebar + main. The `/wiki/coverage` route stays untouched —
 * still reachable via [src/wiki/components/CoverageDebugRoute.tsx](src/wiki/components/CoverageDebugRoute.tsx).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { listTopicKeys, lookupTopic, type TopicCategory } from './topics';
import type { WikiTab } from '../types';
import TopicNav from './components/TopicNav';
import TopicBody from './components/TopicBody';
import RightTocRail from './components/RightTocRail';
import { parseDocsHash, writeDocsHash, slugToTopicKey } from './docsHash';

interface TabDef {
  id: WikiTab;
  label: string;
  /** Which `TopicCategory` values this tab renders. First is the "primary" category for new topics. */
  categories: TopicCategory[];
  /** Order sidebar groups appear within the tab. */
  categoryOrder: TopicCategory[];
  categoryLabel: Record<string, string>;
}

const TABS: TabDef[] = [
  {
    id: 'learn',
    label: 'Learn',
    categories: ['userGuide'],
    categoryOrder: ['userGuide'],
    categoryLabel: { userGuide: 'User Guide' },
  },
  {
    id: 'reference',
    label: 'Reference',
    // Component / config / concept / severity live here too — they're the
    // InfoIcon-entered leaf pages that complement the long-form reference.
    categories: ['reference', 'component', 'concept', 'config', 'severity'],
    categoryOrder: ['reference', 'component', 'concept', 'config', 'severity'],
    categoryLabel: {
      reference: 'System Design',
      component: 'Components',
      concept: 'Concepts',
      config: 'Configuration',
      severity: 'Log severity',
    },
  },
  {
    id: 'howto',
    label: 'How-to',
    categories: ['howto'],
    categoryOrder: ['howto'],
    categoryLabel: { howto: 'Scenarios' },
  },
];

function getTab(id: WikiTab): TabDef {
  return TABS.find((t) => t.id === id) ?? TABS[0];
}

export default function WikiRoute() {
  const focused = useStore((s) => s.wikiFocusedTopic);
  const setFocused = useStore((s) => s.setWikiFocusedTopic);
  const closeWiki = useStore((s) => s.closeWiki);
  const tab = useStore((s) => s.wikiTab);
  const setTab = useStore((s) => s.setWikiTab);

  const activeTab = getTab(tab);
  const mainRef = useRef<HTMLElement | null>(null);
  const showToc = useMediaQuery('(min-width: 1280px)');

  // Topics visible in the current tab, grouped by category.
  const allKeys = useMemo(() => listTopicKeys(), []);
  const grouped = useMemo(() => {
    const out = new Map<TopicCategory, string[]>();
    for (const cat of activeTab.categoryOrder) out.set(cat, []);
    for (const key of allKeys) {
      const t = lookupTopic(key);
      if (!activeTab.categories.includes(t.category)) continue;
      out.get(t.category)?.push(key);
    }
    return out;
  }, [allKeys, activeTab]);

  // Flat ordered key list for arrow-key navigation, scoped to the active tab.
  const flatKeys = useMemo(() => {
    const out: string[] = [];
    for (const cat of activeTab.categoryOrder) {
      const keys = grouped.get(cat);
      if (keys) out.push(...keys);
    }
    return out;
  }, [grouped, activeTab]);

  // --- Hash sync (deep linking) ---------------------------------------------

  // On mount, parse the hash and apply it. Runs once.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const parsed = parseDocsHash(window.location.hash);
    if (parsed.tab) setTab(parsed.tab);
    if (parsed.topicKey && lookupTopic(parsed.topicKey).resolved) {
      setFocused(parsed.topicKey);
    }
    // Respond to hash changes initiated outside the app (back/forward, manual edit).
    const onHash = () => {
      const p = parseDocsHash(window.location.hash);
      if (p.tab) setTab(p.tab);
      if (p.topicKey) setFocused(p.topicKey);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Whenever tab or focused topic changes, write the hash.
  useEffect(() => {
    writeDocsHash(tab, focused);
  }, [tab, focused]);

  // If the focused topic doesn't belong to the active tab, pick the first
  // visible topic so the main pane isn't empty.
  useEffect(() => {
    if (focused) {
      const info = lookupTopic(focused);
      if (activeTab.categories.includes(info.category)) return;
    }
    if (flatKeys.length > 0) setFocused(flatKeys[0]);
  }, [focused, flatKeys, activeTab, setFocused]);

  // --- Keyboard nav (Escape closes, Arrow keys cycle within tab) -----------

  const currentIndex = focused ? flatKeys.indexOf(focused) : -1;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeWiki();
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      if (flatKeys.length === 0) return;
      // Ignore arrow events when focus is inside a form control / editable area.
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      const next = currentIndex < 0 ? 0 : (currentIndex + delta + flatKeys.length) % flatKeys.length;
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
        className="flex flex-col"
        style={{
          padding: '12px 24px',
          borderBottom: '1px solid var(--border-color)',
          background: 'var(--bg-nav)',
          backdropFilter: 'blur(20px) saturate(1.4)',
          WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <div className="flex items-center" style={{ gap: 24 }}>
          <button
            type="button"
            onClick={closeWiki}
            data-testid="wiki-back"
            aria-label="Back to canvas"
            style={{
              width: 32,
              height: 32,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 8,
              background: 'transparent',
              border: '1px solid var(--border-color)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.24px', color: 'var(--text-primary)' }}>
            System<span style={{ color: 'var(--accent)' }}>Sim</span> Docs
          </div>
          <nav
            className="flex items-center"
            style={{ gap: 4 }}
            data-testid="docs-tabs"
            aria-label="Documentation sections"
          >
            {TABS.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  data-testid={`docs-tab-${t.id}`}
                  data-active={active ? 'true' : 'false'}
                  onClick={() => {
                    setTab(t.id);
                    setFocused(null);
                  }}
                  style={{
                    padding: '8px 12px',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
                    color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
                    fontSize: 13,
                    fontWeight: active ? 600 : 500,
                    letterSpacing: '-0.12px',
                    cursor: 'pointer',
                    marginBottom: -1,
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center" style={{ gap: 12 }}>
          <button
            type="button"
            data-testid="wiki-cmdk"
            aria-label="Open search"
            onClick={() => {
              // Trigger the global CommandPalette listener.
              window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 10px 6px 12px',
              borderRadius: 8,
              background: 'var(--bg-input)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-tertiary)',
              fontSize: 12,
              letterSpacing: '-0.12px',
              cursor: 'pointer',
              minWidth: 200,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border-strong)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <span style={{ flex: 1, textAlign: 'left' }}>Search docs…</span>
            <kbd
              style={{
                fontSize: 10,
                fontFamily: 'inherit',
                padding: '1px 6px',
                borderRadius: 4,
                background: 'var(--bg-card-elevated)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-tertiary)',
              }}
            >
              ⌘K
            </kbd>
          </button>
        </div>

        <nav
          className="flex items-center"
          data-testid="docs-tabs"
          role="tablist"
          aria-label="Documentation sections"
          style={{
            borderTop: '1px solid var(--border-color)',
            padding: '0 20px',
            gap: '2px',
          }}
        >
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`docs-tab-${t.id}`}
                data-active={active ? 'true' : 'false'}
                onClick={() => {
                  setTab(t.id);
                  // Clear the focused topic so the effect above picks the first
                  // visible one for the new tab.
                  setFocused(null);
                }}
                style={{
                  padding: '8px 12px',
                  borderRadius: 0,
                  border: 'none',
                  background: 'transparent',
                  color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
                  fontSize: 13,
                  fontWeight: active ? 600 : 500,
                  letterSpacing: '-0.12px',
                  cursor: 'pointer',
                  borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
                  transition: 'color 150ms ease-out, border-bottom-color 150ms ease-out',
                  position: 'relative',
                  bottom: '-1px',
                }}
              >
                {t.label}
              </button>
            );
          })}
        </nav>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <nav
          data-testid="wiki-nav"
          aria-label={`${activeTab.label} topics`}
          className="overflow-y-auto"
          style={{
            width: 280,
            borderRight: '1px solid var(--border-color)',
            background: 'var(--bg-sidebar)',
            padding: '24px 0',
          }}
        >
          {activeTab.categoryOrder.map((cat) => {
            const keys = grouped.get(cat) ?? [];
            if (keys.length === 0) return null;
            return (
              <div key={cat} data-testid={`wiki-nav-group-${cat}`} style={{ marginBottom: 24 }}>
                <div
                  style={{
                    padding: '0 24px 8px',
                    fontSize: 12,
                    letterSpacing: '-0.12px',
                    color: 'var(--text-primary)',
                    fontWeight: 600,
                  }}
                >
                  {activeTab.categoryLabel[cat] ?? cat}
                </div>
                <TopicNav keys={keys} focusedKey={focused} onSelect={setFocused} />
              </div>
            );
          })}
        </nav>

        <main
          ref={mainRef}
          className="flex-1 overflow-y-auto"
          data-testid="wiki-main"
          style={{
            display: 'flex',
            gap: 32,
            padding: '48px 48px 96px',
          }}
        >
          <div style={{ flex: 1, minWidth: 0, maxWidth: 720 }}>
            <TopicBody topicKey={focused} />
          </div>
          {showToc && focused && (
            <RightTocRail
              markdown={lookupTopic(focused).body || ''}
              scrollRootRef={mainRef}
              topicKey={focused}
            />
          )}
        </main>
      </div>
    </div>
  );
}

// Re-export so existing imports keep working while callers migrate to the new name.
export { slugToTopicKey };

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
