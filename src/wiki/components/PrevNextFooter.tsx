/**
 * @file wiki/components/PrevNextFooter.tsx
 *
 * Prev/Next navigation shown below the article body on Learn-track
 * topics. Uses `LEARN_ORDER` from topics.ts as the reading sequence.
 * Clicking either card updates `wikiFocusedTopic`; hash + right-rail
 * re-derive from that. Matches react.dev and tailwindcss.com's
 * pagination chrome but stays inside DESIGN.md tokens.
 */

import { useStore } from '../../store';
import { LEARN_ORDER, lookupTopic } from '../topics';

export default function PrevNextFooter({ topicKey }: { topicKey: string }) {
  const setFocused = useStore((s) => s.setWikiFocusedTopic);
  const idx = LEARN_ORDER.indexOf(topicKey);
  if (idx < 0) return null;

  const prevKey = idx > 0 ? LEARN_ORDER[idx - 1] : null;
  const nextKey = idx < LEARN_ORDER.length - 1 ? LEARN_ORDER[idx + 1] : null;
  if (!prevKey && !nextKey) return null;

  return (
    <nav
      data-testid="wiki-prev-next"
      aria-label="Learn track navigation"
      style={{
        marginTop: 48,
        paddingTop: 24,
        borderTop: '1px solid var(--border-color)',
        display: 'flex',
        gap: 16,
      }}
    >
      {prevKey ? (
        <Card direction="prev" topicKey={prevKey} onClick={() => setFocused(prevKey)} />
      ) : (
        <div style={{ flex: 1 }} aria-hidden="true" />
      )}
      {nextKey ? (
        <Card direction="next" topicKey={nextKey} onClick={() => setFocused(nextKey)} />
      ) : (
        <div style={{ flex: 1 }} aria-hidden="true" />
      )}
    </nav>
  );
}

function Card({
  direction,
  topicKey,
  onClick,
}: {
  direction: 'prev' | 'next';
  topicKey: string;
  onClick: () => void;
}) {
  const info = lookupTopic(topicKey);
  const isNext = direction === 'next';
  return (
    <button
      type="button"
      data-testid={`wiki-prev-next-${direction}`}
      data-topic={topicKey}
      onClick={onClick}
      style={{
        flex: 1,
        textAlign: isNext ? 'right' : 'left',
        padding: 16,
        borderRadius: 8,
        border: '1px solid var(--border-color)',
        background: 'var(--bg-card)',
        color: 'var(--text-primary)',
        cursor: 'pointer',
        transition: 'border-color 140ms ease, background 140ms ease',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border-strong)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; }}
    >
      <div
        style={{
          fontSize: 12,
          letterSpacing: '-0.12px',
          color: 'var(--text-tertiary)',
          marginBottom: 4,
        }}
      >
        {isNext ? 'Next' : 'Previous'}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: isNext ? 'flex-end' : 'flex-start',
          gap: 8,
          fontSize: 15,
          fontWeight: 600,
          letterSpacing: '-0.24px',
          color: 'var(--text-primary)',
        }}
      >
        {!isNext && <Arrow direction="left" />}
        <span>{info.title}</span>
        {isNext && <Arrow direction="right" />}
      </div>
    </button>
  );
}

function Arrow({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      {direction === 'left' ? (
        <path d="M19 12H5M12 19l-7-7 7-7" />
      ) : (
        <path d="M5 12h14M12 5l7 7-7 7" />
      )}
    </svg>
  );
}
