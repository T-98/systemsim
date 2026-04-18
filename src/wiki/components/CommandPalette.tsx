/**
 * @file wiki/components/CommandPalette.tsx
 *
 * ⌘K / Ctrl+K full-text search over every declared topic. Table stakes
 * for a docs product — matches react.dev, shadcn, Next.js. In-memory
 * Fuse.js (9KB gzipped) indexing title + shortDescription + body.
 *
 * Arrow keys navigate; Enter opens the topic (via `openWiki`); Escape
 * closes. Outside-click closes. Index rebuilds on every mount because
 * TOPICS is frozen at module load; it doesn't grow at runtime.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Fuse from 'fuse.js';
import { useStore } from '../../store';
import { TOPICS, lookupTopic, type TopicCategory } from '../topics';

interface SearchRecord {
  key: string;
  title: string;
  shortDescription: string;
  body: string;
  category: TopicCategory;
}

function buildIndex(): Fuse<SearchRecord> {
  const records: SearchRecord[] = Object.entries(TOPICS).map(([key, topic]) => ({
    key,
    title: topic.title,
    shortDescription: topic.shortDescription,
    // Truncate body to keep the index compact and search snappy at ~60+ entries.
    body: topic.body.slice(0, 800),
    category: topic.category,
  }));
  return new Fuse(records, {
    includeScore: true,
    threshold: 0.38,
    keys: [
      { name: 'title', weight: 2 },
      { name: 'shortDescription', weight: 1 },
      { name: 'body', weight: 0.5 },
    ],
  });
}

const CATEGORY_PILL: Record<TopicCategory, string> = {
  userGuide: 'Learn',
  reference: 'Reference',
  howto: 'How-to',
  component: 'Component',
  concept: 'Concept',
  config: 'Config',
  severity: 'Severity',
};

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // Remember the element that was focused before the palette opened, so we
  // can return focus to it on close (a11y requirement for role=dialog).
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const openWiki = useStore((s) => s.openWiki);

  const fuse = useMemo(() => buildIndex(), []);

  // Global ⌘K / Ctrl+K to toggle. Only treat Escape as ours while we're open,
  // so we don't swallow the key for unrelated dialogs elsewhere in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (!open) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      } else if (e.key === 'Tab') {
        // Focus trap: cycle Tab / Shift+Tab within the dialog's focusables.
        const container = dialogRef.current;
        if (!container) return;
        const focusables = container.querySelectorAll<HTMLElement>(
          'input, button, [href], [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && (active === first || !container.contains(active))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (active === last || !container.contains(active))) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Autofocus input on open; return focus to the opener on close.
  useEffect(() => {
    if (open) {
      previousFocusRef.current = (document.activeElement as HTMLElement) ?? null;
      setQuery('');
      setSelected(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    } else if (previousFocusRef.current) {
      // On close, restore focus. Use a rAF so this doesn't race the palette
      // unmount animation (none today, but future-proof).
      const el = previousFocusRef.current;
      previousFocusRef.current = null;
      requestAnimationFrame(() => el.focus?.());
    }
  }, [open]);

  const results = useMemo(() => {
    if (!query.trim()) {
      // Empty query: show a curated default set — the first few Learn
      // pages + the Reference landing. Keeps the palette feeling "warm"
      // without forcing text.
      const learn = Object.keys(TOPICS).filter((k) => k.startsWith('userGuide.')).slice(0, 6);
      const reference = Object.keys(TOPICS).filter((k) => k.startsWith('reference.1-')).slice(0, 2);
      const howto = Object.keys(TOPICS).filter((k) => k.startsWith('howto.')).slice(0, 3);
      return [...learn, ...reference, ...howto].map((key) => ({
        key,
        topic: lookupTopic(key),
        score: 0,
      }));
    }
    return fuse.search(query, { limit: 12 }).map((r) => ({
      key: r.item.key,
      topic: lookupTopic(r.item.key),
      score: r.score ?? 1,
    }));
  }, [query, fuse]);

  // Clamp selection as results list changes.
  useEffect(() => {
    if (selected >= results.length) setSelected(Math.max(0, results.length - 1));
  }, [results, selected]);

  const onSubmit = (key: string) => {
    openWiki(key);
    setOpen(false);
  };

  if (!open) {
    return null;
  }

  return (
    <div
      data-testid="command-palette"
      role="dialog"
      aria-modal="true"
      aria-label="Search documentation"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '15vh',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div
        ref={dialogRef}
        style={{
          width: 'min(640px, 90vw)',
          maxHeight: '65vh',
          background: 'var(--bg-sidebar)',
          border: '1px solid var(--border-color)',
          borderRadius: 12,
          boxShadow: 'var(--shadow-elevated)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <input
          ref={inputRef}
          data-testid="command-palette-input"
          type="text"
          value={query}
          placeholder="Search docs… (⌘K)"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSelected((s) => Math.min(results.length - 1, s + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSelected((s) => Math.max(0, s - 1));
            } else if (e.key === 'Enter' && results[selected]) {
              e.preventDefault();
              onSubmit(results[selected].key);
            }
          }}
          style={{
            width: '100%',
            padding: '14px 16px',
            fontSize: 15,
            background: 'transparent',
            color: 'var(--text-primary)',
            border: 'none',
            borderBottom: '1px solid var(--border-color)',
            outline: 'none',
            letterSpacing: '-0.24px',
            fontFamily: 'inherit',
          }}
        />
        <div
          data-testid="command-palette-results"
          style={{ overflowY: 'auto', flex: 1 }}
        >
          {results.length === 0 ? (
            <div
              data-testid="command-palette-empty"
              style={{ padding: 20, color: 'var(--text-tertiary)', fontSize: 13, textAlign: 'center' }}
            >
              No matches. Try a shorter query.
            </div>
          ) : (
            results.map((r, i) => {
              const isSel = i === selected;
              return (
                <button
                  key={r.key}
                  type="button"
                  data-testid="command-palette-item"
                  data-selected={isSel ? 'true' : 'false'}
                  data-topic={r.key}
                  onClick={() => onSubmit(r.key)}
                  onMouseEnter={() => setSelected(i)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '10px 16px',
                    background: isSel ? 'var(--bg-input)' : 'transparent',
                    color: 'var(--text-secondary)',
                    border: 'none',
                    borderLeft: isSel ? '2px solid var(--accent)' : '2px solid transparent',
                    cursor: 'pointer',
                    fontSize: 13,
                    letterSpacing: '-0.12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{r.topic.title}</span>
                    <span
                      style={{
                        fontSize: 10,
                        textTransform: 'uppercase',
                        letterSpacing: '0.6px',
                        color: 'var(--text-tertiary)',
                        border: '1px solid var(--border-color)',
                        padding: '1px 6px',
                        borderRadius: 4,
                      }}
                    >
                      {CATEGORY_PILL[r.topic.category]}
                    </span>
                  </div>
                  {r.topic.shortDescription && (
                    <div
                      style={{
                        fontSize: 12,
                        color: 'var(--text-tertiary)',
                        overflow: 'hidden',
                        display: '-webkit-box',
                        WebkitLineClamp: 1,
                        WebkitBoxOrient: 'vertical',
                      }}
                    >
                      {r.topic.shortDescription}
                    </div>
                  )}
                </button>
              );
            })
          )}
        </div>
        <div
          style={{
            padding: '8px 14px',
            fontSize: 11,
            color: 'var(--text-tertiary)',
            letterSpacing: '-0.12px',
            borderTop: '1px solid var(--border-color)',
            display: 'flex',
            gap: 14,
          }}
        >
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
