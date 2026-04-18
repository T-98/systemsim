/**
 * @file wiki/components/TopicNav.tsx
 *
 * Left-nav list for a single category. Renders each topic key as a button
 * that sets `store.wikiFocusedTopic` on click. Highlights the focused key.
 */

import { lookupTopic } from '../topics';

export default function TopicNav({
  keys,
  focusedKey,
  onSelect,
}: {
  keys: string[];
  focusedKey: string | null;
  onSelect: (key: string) => void;
}) {
  return (
    <div>
      {keys.map((key) => {
        const t = lookupTopic(key);
        const active = focusedKey === key;
        return (
          <button
            key={key}
            type="button"
            data-testid={`wiki-nav-item`}
            data-topic={key}
            data-active={active ? 'true' : 'false'}
            onClick={() => onSelect(key)}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '7px 16px',
              border: 'none',
              background: active ? 'var(--bg-input)' : 'transparent',
              color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontSize: 13,
              letterSpacing: '-0.12px',
              cursor: 'pointer',
              borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
              transition: 'background 140ms ease, color 140ms ease',
            }}
            onMouseEnter={(e) => {
              if (!active) e.currentTarget.style.background = 'var(--bg-input)';
            }}
            onMouseLeave={(e) => {
              if (!active) e.currentTarget.style.background = 'transparent';
            }}
          >
            {t.title}
          </button>
        );
      })}
    </div>
  );
}
