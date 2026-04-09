import { useStore } from '../../store';
import { downloadDebriefHtml } from '../../ai/generateDebriefHtml';

export default function DebriefPanel() {
  const debrief = useStore((s) => s.debrief);
  const debriefVisible = useStore((s) => s.debriefVisible);
  const debriefLoading = useStore((s) => s.debriefLoading);
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
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                const state = useStore.getState();
                const latestRun = state.simulationRuns[state.simulationRuns.length - 1];
                if (latestRun && debrief) {
                  downloadDebriefHtml({ debrief, run: latestRun, nodes: state.nodes, edges: state.edges, scenarioId: state.scenarioId });
                }
              }}
              className="rounded-lg font-medium transition-all duration-200"
              style={{ padding: '6px 14px', fontSize: '12px', background: 'var(--accent)', color: 'white' }}
            >
              Download Report
            </button>
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

          {/* Questions — unified list from deterministic + AI sources */}
          {(debrief.questions.length > 0 || (debrief.aiQuestions && debrief.aiQuestions.length > 0)) && (
            <div style={{ marginBottom: '32px' }}>
              <h3
                className="uppercase font-medium"
                style={{ fontSize: '10px', letterSpacing: '0.2em', color: 'var(--text-tertiary)', marginBottom: '12px' }}
              >
                Questions for You
              </h3>
              <div className="space-y-3">
                {debrief.questions.map((q, i) => (
                  <div key={`d-${i}`} style={{ paddingLeft: '16px', borderLeft: '2px solid var(--accent)' }}>
                    <p className="italic leading-relaxed" style={{ fontSize: '14px', color: 'var(--text-secondary)', letterSpacing: '-0.224px' }}>{q}</p>
                  </div>
                ))}
                {debrief.aiQuestions?.map((q, i) => (
                  <div key={`ai-${i}`} style={{ paddingLeft: '16px', borderLeft: '2px solid var(--accent)' }}>
                    <p className="italic leading-relaxed" style={{ fontSize: '14px', color: 'var(--text-secondary)', letterSpacing: '-0.224px' }}>
                      {q}
                      <span style={{ marginLeft: '8px', fontSize: '10px', padding: '1px 6px', borderRadius: '4px', background: 'rgba(52,199,89,0.1)', color: 'var(--success)', fontStyle: 'normal', fontWeight: 500 }}>AI</span>
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AI loading/fallback status */}
          {debriefLoading && (
            <div style={{ marginBottom: '16px', padding: '12px 16px', background: 'rgba(0,113,227,0.06)', borderRadius: '8px', fontSize: '13px', color: 'var(--accent)' }}>
              Generating AI-powered questions...
            </div>
          )}
          {!debriefLoading && !debrief.aiAvailable && debrief.questions.length > 0 && (
            <div style={{ marginBottom: '16px', padding: '12px 16px', background: 'rgba(255,159,10,0.06)', borderRadius: '8px', fontSize: '13px', color: 'var(--warning)' }}>
              AI debrief unavailable — showing rule-based analysis only
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
  const getStatus = () => {
    if (score > 70) return { label: 'Pass', bg: 'rgba(52,199,89,0.1)', text: 'var(--success)' };
    if (score >= 40) return { label: 'Warn', bg: 'rgba(255,159,10,0.1)', text: 'var(--warning)' };
    return { label: 'Fail', bg: 'rgba(255,59,48,0.1)', text: 'var(--destructive)' };
  };
  const status = getStatus();
  return (
    <div
      className="flex items-center gap-1.5 rounded-lg"
      style={{ padding: '4px 10px', background: status.bg }}
    >
      <span style={{ fontSize: '12px', color: 'var(--text-tertiary)', letterSpacing: '-0.12px' }}>{label}</span>
      <span
        className="font-bold"
        style={{ fontSize: '12px', color: status.text, fontFamily: "'Geist Mono', monospace", letterSpacing: '-0.12px' }}
      >
        {status.label}
      </span>
    </div>
  );
}
