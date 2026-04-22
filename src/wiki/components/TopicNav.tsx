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
            aria-current={active ? 'page' : undefined}
            onClick={() => onSelect(key)}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '6px 24px',
              border: 'none',
              background: active ? 'var(--bg-hover)' : 'transparent',
              color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontSize: 13,
              fontWeight: active ? 600 : 400,
              letterSpacing: '-0.224px',
              cursor: 'pointer',
              transition: 'background 140ms ease',
            }}
            onMouseEnter={(e) => {
              if (!active) e.currentTarget.style.background = 'var(--bg-hover)';
            }}
            onMouseLeave={(e) => {
              if (!active) e.currentTarget.style.background = 'transparent';
            }}
            onFocus={(e) => {
              e.currentTarget.style.boxShadow = `inset 0 0 0 2px var(--accent-ring)`;
            }}
            onBlur={(e) => {
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            {t.title}
          </button>
        );
      })}
    </div>
  );
}
