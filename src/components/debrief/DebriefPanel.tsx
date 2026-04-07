import { useStore } from '../../store';

export default function DebriefPanel() {
  const debrief = useStore((s) => s.debrief);
  const debriefVisible = useStore((s) => s.debriefVisible);
  const setDebriefVisible = useStore((s) => s.setDebriefVisible);

  if (!debrief || !debriefVisible) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 transition-transform">
      <div
        className="max-h-[60vh] overflow-y-auto"
        style={{
          background: 'var(--bg-card-elevated)',
          borderTop: '1px solid var(--border-color)',
          boxShadow: 'var(--shadow-elevated)',
        }}
      >
        <div
          className="flex items-center justify-between sticky top-0"
          style={{
            padding: '16px 32px',
            borderBottom: '1px solid var(--border-color)',
            background: 'var(--bg-card-elevated)',
          }}
        >
          <div className="flex items-center gap-4">
            <span
              className="font-semibold"
              style={{ fontSize: '17px', color: 'var(--text-primary)', letterSpacing: '-0.374px' }}
            >
              Post-Run Debrief
            </span>
            <div className="flex gap-3">
              <ScoreBadge label="Coherence" score={debrief.scores.coherence} />
              <ScoreBadge label="Security" score={debrief.scores.security} />
              <ScoreBadge label="Performance" score={debrief.scores.performance} />
            </div>
          </div>
          <button
            onClick={() => setDebriefVisible(false)}
            className="transition-all duration-200"
            style={{ color: 'var(--text-tertiary)', fontSize: '17px' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; }}
          >
            &times;
          </button>
        </div>

        <div className="max-w-3xl" style={{ padding: '32px' }}>
          {/* Summary */}
          <div style={{ marginBottom: '32px' }}>
            <h3
              className="uppercase font-medium"
              style={{ fontSize: '10px', letterSpacing: '0.2em', color: 'var(--text-tertiary)', marginBottom: '12px' }}
            >
              What Happened
            </h3>
            <p className="leading-relaxed" style={{ fontSize: '14px', color: 'var(--text-secondary)', letterSpacing: '-0.224px' }}>{debrief.summary}</p>
          </div>

          {/* Questions */}
          {debrief.questions.length > 0 && (
            <div style={{ marginBottom: '32px' }}>
              <h3
                className="uppercase font-medium"
                style={{ fontSize: '10px', letterSpacing: '0.2em', color: 'var(--text-tertiary)', marginBottom: '12px' }}
              >
                Questions for You
              </h3>
              <div className="space-y-3">
                {debrief.questions.map((q, i) => (
                  <div key={i} style={{ paddingLeft: '16px', borderLeft: '2px solid var(--accent)' }}>
                    <p className="italic leading-relaxed" style={{ fontSize: '14px', color: 'var(--text-secondary)', letterSpacing: '-0.224px' }}>{q}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Flags */}
          {debrief.flags.length > 0 && (
            <div style={{ marginBottom: '32px' }}>
              <h3
                className="uppercase font-medium"
                style={{ fontSize: '10px', letterSpacing: '0.2em', color: 'var(--text-tertiary)', marginBottom: '12px' }}
              >
                Patterns Detected
              </h3>
              <div className="space-y-1.5">
                {debrief.flags.map((flag, i) => (
                  <div
                    key={i}
                    style={{
                      fontSize: '14px',
                      color: 'var(--warning)',
                      fontFamily: "'Geist Mono', monospace",
                      letterSpacing: '-0.224px',
                    }}
                  >
                    {flag}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ScoreBadge({ label, score }: { label: string; score: number }) {
  const getColors = () => {
    if (score >= 80) return { bg: 'rgba(52,199,89,0.1)', text: 'var(--success)' };
    if (score >= 50) return { bg: 'rgba(255,159,10,0.1)', text: 'var(--warning)' };
    return { bg: 'rgba(255,59,48,0.1)', text: 'var(--destructive)' };
  };
  const colors = getColors();
  return (
    <div
      className="flex items-center gap-1.5 rounded-lg"
      style={{ padding: '4px 10px', background: colors.bg }}
    >
      <span style={{ fontSize: '12px', color: 'var(--text-tertiary)', letterSpacing: '-0.12px' }}>{label}</span>
      <span
        className="font-bold"
        style={{ fontSize: '12px', color: colors.text, fontFamily: "'Geist Mono', monospace", letterSpacing: '-0.12px' }}
      >
        {score}
      </span>
    </div>
  );
}
