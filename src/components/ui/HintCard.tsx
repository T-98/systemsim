import { useStore } from '../../store';

export default function HintCard() {
  const hints = useStore((s) => s.hints);
  const dismissHint = useStore((s) => s.dismissHint);

  const activeHints = hints.filter((h) => !h.dismissed);
  if (activeHints.length === 0) return null;

  return (
    <div className="absolute bottom-4 left-4 z-30 space-y-2 max-w-sm">
      {activeHints.map((hint) => (
        <div
          key={hint.id}
          className="rounded-lg"
          style={{
            background: 'var(--bg-card)',
            boxShadow: 'var(--shadow-elevated)',
            padding: '16px',
            borderLeft: '2px solid var(--accent)',
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <p
              className="italic leading-relaxed"
              style={{ fontSize: '14px', color: 'var(--text-secondary)', letterSpacing: '-0.224px' }}
            >
              {hint.message}
            </p>
            <button
              onClick={() => dismissHint(hint.id)}
              className="shrink-0 transition-all duration-200"
              style={{ fontSize: '14px', color: 'var(--text-tertiary)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; }}
            >
              &times;
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
