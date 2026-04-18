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

import { useEffect, useMemo } from 'react';
import { useStore } from '../store';
import { listTopicKeys, lookupTopic, type TopicCategory } from './topics';
import type { WikiTab } from '../types';
import TopicNav from './components/TopicNav';
import TopicBody from './components/TopicBody';
import { parseDocsHash, writeDocsHash, topicKeyToSlug, slugToTopicKey } from './docsHash';

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
        className="flex items-center justify-between"
        style={{
          padding: '12px 20px',
          borderBottom: '1px solid var(--border-color)',
          background: 'var(--bg-sidebar)',
        }}
      >
        <div className="flex items-center gap-6">
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
            SystemSim Docs
          </div>
          <nav
            className="flex items-center gap-1"
            data-testid="docs-tabs"
            role="tablist"
            aria-label="Documentation sections"
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
                    padding: '6px 14px',
                    borderRadius: 6,
                    border: '1px solid transparent',
                    background: active ? 'var(--bg-input)' : 'transparent',
                    color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
                    borderColor: active ? 'var(--border-color)' : 'transparent',
                    fontSize: 13,
                    fontWeight: active ? 600 : 500,
                    letterSpacing: '-0.12px',
                    cursor: 'pointer',
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </nav>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', letterSpacing: '-0.12px' }}>
          {flatKeys.length} {activeTab.label.toLowerCase()} topics
          {focused ? ` · ${topicKeyToSlug(focused)}` : ''}
        </div>
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
            padding: '12px 0',
          }}
        >
          {activeTab.categoryOrder.map((cat) => {
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
                  {activeTab.categoryLabel[cat] ?? cat}
                </div>
                <TopicNav keys={keys} focusedKey={focused} onSelect={setFocused} />
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

// Re-export so existing imports keep working while callers migrate to the new name.
export { slugToTopicKey };
